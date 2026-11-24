"""Bounded exact reads over the existing snapshot files and decision journal.

Material-only graph selection uses the earliest (version, digest) verified
snapshot containing the full ref, within this thread only. A capped search
cannot establish that ordering and returns missing, never latest.
"""
from __future__ import annotations

import re
import json
from copy import deepcopy
from datetime import datetime
from .access import require_unrestricted, policy_restricted, project_graph, project_summary, project_snapshot, graph_restricted
from .artifact_versions import ArtifactVersionRefV1
from .events import normalize_timestamp
from .review_receipt import project_review_receipt

SNAPSHOT_LIMIT = 128
EVENT_LIMIT = 1000


def check_current_access(engine, thread_id):
    current = engine.get(thread_id)
    if current is not None:
        require_unrestricted(current, "historical read")
    # Pending updates can carry a stricter policy than the last publication.
    status = engine.update_status(thread_id)
    if status.get("accessRestricted"):
        raise PermissionError("historical read is unavailable for restricted evidence")


def exact_graph(engine, thread_id, digest, ref=None):
    check_current_access(engine, thread_id)
    graph, snapshot = engine.snapshot_graph(thread_id, digest)
    require_unrestricted(graph, "historical read")
    if ref is not None:
        expected = ArtifactVersionRefV1.from_dict(ref)
        if policy_restricted(expected.access_policy):
            raise PermissionError("material access restricted")
        actual = graph.artifact_version_refs.get(expected.version_id)
        if actual != expected:
            raise ValueError("material version does not match snapshot")
        require_unrestricted(graph, "material binding")
    return graph, snapshot


def can_review(engine, thread_id, graph, snapshot):
    current = engine.latest_snapshot(thread_id)
    return bool(current and current.digest == snapshot.digest and not graph_restricted(graph)
                and not engine.update_status(thread_id).get("accessRestricted"))


def read_graph(engine, thread_id, snapshot_digest=None, artifact_ref=None):
    explicit = snapshot_digest is not None or artifact_ref is not None
    if not explicit:
        return {"graph": engine.graph_view(thread_id), "summary": engine.graph_summary(thread_id),
                "snapshot": engine.snapshot_view(thread_id), "layer": "committed",
                "canReview": can_review(engine, thread_id, engine.require(thread_id), engine.latest_snapshot(thread_id))}
    if snapshot_digest is None:
        check_current_access(engine, thread_id)
        expected = ArtifactVersionRefV1.from_dict(artifact_ref)
        if policy_restricted(expected.access_policy):
            raise PermissionError("material access restricted")
        directory = engine._snapshot_dir(thread_id)
        try:
            names = engine._storage.listdir(directory) if directory else []
        except FileNotFoundError:
            names = []
        digests = {"sha256:" + match.group(1) for name in names
                   if (match := re.fullmatch(r".*-([0-9a-f]{64})\.prov\.json", name))}
        current = engine.latest_snapshot(thread_id)
        if current is not None:
            digests.add(current.digest)
        if len(digests) > SNAPSHOT_LIMIT:
            return {"binding": {"status": "missing", "reason": "snapshot_search_bounded"}}
        matches = []
        for digest in sorted(digests):
            graph, snapshot = engine.snapshot_graph(thread_id, digest)
            if graph.artifact_version_refs.get(expected.version_id) == expected:
                require_unrestricted(graph, "material binding")
                matches.append((snapshot.version, snapshot.digest))
        if not matches:
            return {"binding": {"status": "missing", "reason": "material_snapshot_missing"}}
        snapshot_digest = min(matches)[1]
    graph, snapshot = exact_graph(engine, thread_id, snapshot_digest, artifact_ref)
    return {"graph": project_graph(graph), "summary": project_summary(graph),
            "snapshot": project_snapshot(graph, snapshot.to_dict()), "layer": "committed",
            "canReview": can_review(engine, thread_id, graph, snapshot),
            "binding": {"status": "resolved", "snapshotDigest": snapshot.digest}}


def read_reviews(engine, thread_id, snapshot_digest, artifact_ref=None, as_of=None):
    cutoff = normalize_timestamp(as_of) if as_of is not None else None
    graph, _snapshot = exact_graph(engine, thread_id, snapshot_digest, artifact_ref)
    require_unrestricted(graph, "human review export")
    # Do not infer old receipt scope from today's packet. Material membership is
    # proven only by targets on the stored receipt and exact snapshot nodes.
    targets = None
    if artifact_ref is not None:
        targets = {node.id for node in graph.nodes.values()
                   if node.artifact_version_id == artifact_ref["versionId"]}
        targets.add(artifact_ref["versionId"])
    rows, reasons, seen_ids, seen_keys = [], set(), {}, {}
    output_bytes = 0
    events = engine._event_store.read(event_types=("HumanReviewDecisionRecorded",),
                                     aggregate_id=thread_id, limit=EVENT_LIMIT + 1)
    if len(events) > EVENT_LIMIT:
        reasons.add("event_scan_bounded")
    for event in events[:EVENT_LIMIT]:
        payload = event.get("payload") or {}
        if event.get("aggregateType") != "EvidenceThread" or payload.get("threadId") != thread_id:
            continue
        if not payload.get("snapshotDigest"):
            reasons.add("legacy_snapshot_scope_unknown")
            continue
        if payload.get("snapshotDigest") != snapshot_digest:
            continue
        when = normalize_timestamp(event["occurredAt"])
        if cutoff and datetime.fromisoformat(when.replace("Z", "+00:00")) > datetime.fromisoformat(cutoff.replace("Z", "+00:00")):
            continue
        receipt = project_review_receipt(payload)
        scope = receipt.get("scope") or {}
        if scope.get("kind") == "unknown":
            reasons.add("legacy_scope_unknown")
            if targets is not None:
                continue
        elif (scope.get("snapshotDigest") != snapshot_digest or
              scope.get("reviewPacketId") != payload.get("reviewPacketId")):
            reasons.add("receipt_scope_mismatch")
            continue
        if targets is not None and not targets.intersection(scope.get("targetIds") or []):
            reasons.add("material_scope_not_proven")
            continue
        row = {key: deepcopy(event[key]) for key in ("eventId", "sequence", "idempotencyKey", "occurredAt", "type", "persistent")}
        row.update({key: deepcopy(payload[key]) for key in
                    ("threadId", "snapshotDigest", "reviewPacketId", "action", "actor", "rationale")})
        row["reviewReceipt"] = receipt
        if payload.get("targetOutcomes") is not None:
            row["targetOutcomes"] = deepcopy(payload["targetOutcomes"])
        old_id, old_key = seen_ids.get(row["eventId"]), seen_keys.get(row["idempotencyKey"])
        if old_id is not None or old_key is not None:
            if (old_id is not None and old_id != row) or (old_key is not None and old_key != row):
                reasons.add("duplicate_event_conflict")
            continue
        seen_ids[row["eventId"]] = row
        seen_keys[row["idempotencyKey"]] = row
        output_bytes += len(json.dumps(row, ensure_ascii=False).encode("utf-8"))
        if output_bytes > 2 * 1024 * 1024:
            reasons.add("review_output_bounded")
            break
        rows.append(row)
    rows.sort(key=lambda row: (row["sequence"], row["eventId"]))
    return {"status": "partial" if reasons else "available", "records": rows,
            "scope": {"threadId": thread_id, "snapshotDigest": snapshot_digest,
                      "artifactVersionRef": deepcopy(artifact_ref)},
            "reasons": sorted(reasons), **({"asOf": as_of} if as_of is not None else {})}
