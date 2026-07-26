"""Evidence compiler facade with one update path and immutable snapshots."""
from __future__ import annotations

import hashlib
import glob
import json
import os
import re
import threading
import time
import uuid
from dataclasses import replace
from typing import Any, Optional

from . import analysis as _analysis
from . import audit as _audit
from . import metrics as _metrics
from . import provjson
from . import reconcile as _reconcile
from .artifacts import ArtifactRegistry
from .assessment import assessment_identity, bind_target_digest, run_a0, run_a1, run_a2
from .digraph import descendants
from .human_review import (
    DEFAULT_POLICY,
    attach_human_reviews,
    remap_review_packet_assessment_ids,
    select_a2_targets,
)
from .events import EventStore, utc_now_iso
from .extractor import ExtractionOutputError, extract_dag
from .graph import ThreadGraph
from .incremental import TraceStagingCache, watermark_regresses
from .llm import LLM, LLMCallError
from .model import EdgeRel, HumanReviewStatus
from .snapshot import (
    EXTRACTOR_VERSION,
    SCHEMA_VERSION,
    EvidenceSnapshot,
    VERIFIER_VERSION,
    build_snapshot,
    compute_snapshot_digest,
    snapshot_artifact_digests,
    snapshot_filename,
    snapshot_storage_key,
)
from .verifier import verify as _verify


class ReviewDecisionConflict(RuntimeError):
    """Raised when a decision is not bound to the current immutable snapshot."""


def evidence_update_error(error: BaseException) -> dict[str, Any]:
    """Canonical diagnostic persisted and returned for compiler failures."""
    if isinstance(error, LLMCallError):
        return {
            "type": type(error).__name__,
            "code": error.code,
            "message": str(error),
            "retryable": error.retryable,
            "attempts": error.attempts,
            "incompleteReason": error.incomplete_reason,
            "responseStatus": error.response_status,
        }
    if isinstance(error, ExtractionOutputError):
        return {
            "type": type(error).__name__,
            "code": error.code,
            "message": str(error),
            "retryable": False,
            "attempts": error.attempts,
            "incompleteReason": None,
            "responseStatus": None,
        }
    return {
        "type": type(error).__name__,
        "code": "evidence_update_failed",
        "message": str(error),
        "retryable": isinstance(error, RuntimeError),
        "attempts": 1,
        "incompleteReason": None,
        "responseStatus": None,
    }


class Engine:
    def __init__(self, llm: Optional[LLM] = None, *, storage_dir: Optional[str] = None) -> None:
        self.llm = llm
        self.storage_dir = storage_dir
        self._graphs: dict[str, ThreadGraph] = {}
        self._snapshots: dict[str, EvidenceSnapshot] = {}
        self._updates: dict[str, dict[str, Any]] = {}
        self._audit_runs: dict[str, list[dict]] = {}
        self._updated: dict[str, float] = {}
        self._last_delta: dict[str, dict] = {}
        self._registries: dict[str, ArtifactRegistry] = {}
        self._lock = threading.RLock()
        self._compile_locks: dict[str, threading.RLock] = {}
        # Read-path caches keyed by file mtime; snapshot files are immutable
        # and the latest file is atomically replaced, so mtime is authoritative.
        self._thread_id_cache: dict[str, tuple[float, str]] = {}
        self._history_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._trace_staging = TraceStagingCache(storage_dir)
        if storage_dir:
            os.makedirs(storage_dir, exist_ok=True)
        self._event_store = EventStore(
            os.path.join(storage_dir, "events", "evidence-domain-events.json")
            if storage_dir else None
        )

    @staticmethod
    def _safe_key(value: str) -> str:
        slug = re.sub(r"[^A-Za-z0-9._-]", "_", value)[:80] or "scope"
        suffix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
        return f"{slug}-{suffix}"

    def _path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, snapshot_filename(thread_id)) \
            if self.storage_dir else None

    def _snapshot_dir(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, "snapshots", snapshot_storage_key(thread_id)) \
            if self.storage_dir else None

    @staticmethod
    def _verified_snapshot(
        graph: ThreadGraph, *, thread_id: str, target_digest: Optional[str] = None,
    ) -> EvidenceSnapshot:
        """Verify the immutable envelope before exposing a persisted graph."""
        snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get("snapshot") or {})
        if snapshot.thread_id != thread_id:
            raise ValueError("snapshot threadId does not match requested thread")
        if target_digest is not None and snapshot.digest != target_digest:
            raise ValueError("immutable snapshot identity mismatch")
        actual_digest = compute_snapshot_digest(
            graph,
            input_watermark=snapshot.input_watermark,
            schema_version=snapshot.schema_version,
            extractor_version=snapshot.extractor_version,
            verifier_version=snapshot.verifier_version,
        )
        if actual_digest != snapshot.digest:
            raise ValueError(
                "Evidence Snapshot digest mismatch;"
                f" envelope={snapshot.digest}, computed={actual_digest}"
            )
        actual_artifact_digests = tuple(snapshot_artifact_digests(graph))
        if actual_artifact_digests != snapshot.artifact_digests:
            raise ValueError(
                "Evidence Snapshot artifactDigests mismatch;"
                f" envelope={list(snapshot.artifact_digests)},"
                f" computed={list(actual_artifact_digests)}"
            )
        return snapshot

    def _audit_path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, f"{self._safe_key(thread_id)}.audit.json") \
            if self.storage_dir else None

    def _update_path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, f"{self._safe_key(thread_id)}.update.json") \
            if self.storage_dir else None

    @staticmethod
    def _workspace_scope(
        workspace_root: str, project_root: Optional[str],
    ) -> tuple[str, str, str]:
        if not str(workspace_root or "").strip():
            raise ValueError("workspaceRoot is required")
        workspace = os.path.abspath(workspace_root)
        project = os.path.abspath(project_root or workspace_root)
        real_workspace = os.path.realpath(workspace)
        real_project = os.path.realpath(project)
        try:
            if os.path.commonpath((real_workspace, real_project)) != real_workspace:
                raise ValueError("projectRoot must be contained by workspaceRoot")
        except ValueError as exc:
            raise ValueError("projectRoot must be contained by workspaceRoot") from exc
        identity = json.dumps(
            {"workspaceRoot": real_workspace, "projectRoot": real_project},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        scope_key = f"workspace:{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"
        return workspace, project, scope_key

    def _registry(
        self, *, workspace_root: str, project_root: Optional[str],
    ) -> ArtifactRegistry:
        workspace, project, scope_key = self._workspace_scope(workspace_root, project_root)
        # Guard the check-then-create: concurrent HTTP handlers must never end
        # up with two Registry instances writing the same persistent file.
        with self._lock:
            registry = self._registries.get(scope_key)
            if registry is None:
                registry_path = os.path.join(
                    self.storage_dir, "artifact-registries", f"{self._safe_key(scope_key)}.json",
                ) if self.storage_dir else None
                registry = ArtifactRegistry(
                    registry_path, workspace_roots=(project,), locator_root=workspace,
                )
                self._registries[scope_key] = registry
            return registry

    def _compile_lock(self, thread_id: str) -> threading.RLock:
        """Serialize one thread without blocking independent DAG compiles or readers."""
        with self._lock:
            return self._compile_locks.setdefault(thread_id, threading.RLock())

    # --- single compiler command -----------------------------------------
    def update(
        self,
        *,
        thread_id: str,
        target_watermark: str,
        reason: str,
        priority: str,
        trace: Optional[list[dict]],
        workspace_root: str,
        project_root: Optional[str] = None,
        rebuild: bool = False,
        rebuild_rationale: Optional[str] = None,
        threshold: float = 0.7,
        access_policy: Optional[dict[str, Any]] = None,
        queued_at: Optional[str] = None,
        correlation_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        if not thread_id or not str(target_watermark):
            raise ValueError("threadId and targetWatermark are required")
        if not workspace_root:
            raise ValueError("workspaceRoot is required")
        if not reason or not priority:
            raise ValueError("reason and priority are required")
        if trace is not None and not isinstance(trace, list):
            raise ValueError("trace must be a list when supplied")
        if rebuild and reason not in {"schema_upgrade", "corruption_recovery", "reinterpretation"}:
            raise ValueError("rebuild requires an explicit advanced rebuild reason")
        if rebuild and not str(rebuild_rationale or "").strip():
            raise ValueError("rebuildRationale is required for rebuild")
        if not rebuild and rebuild_rationale is not None:
            raise ValueError("rebuildRationale is only valid when rebuild=true")

        # Model extraction and verification can take minutes. A process-wide lock
        # made status reads and unrelated threads wait for the whole compile.
        with self._compile_lock(thread_id):
            current = self.latest_snapshot(thread_id)
            current_graph = self.get(thread_id) if current is not None else None
            if current is not None and not rebuild and watermark_regresses(
                current.input_watermark, str(target_watermark),
            ):
                raise ValueError(
                    "targetWatermark must not precede the committed input watermark"
                )
            workspace, project, _scope_key = self._workspace_scope(
                workspace_root, project_root,
            )
            registry = self._registry(workspace_root=workspace, project_root=project)
            staged = self._trace_staging.begin(
                thread_id=thread_id,
                target_watermark=str(target_watermark),
                trace=trace,
                committed_graph=current_graph,
                rebuild=rebuild,
            )
            incremental_trace = list(staged.trace)
            registry_digest = registry.state_digest()
            committed_registry_digest = (
                current_graph.meta.get("artifactRegistryDigest")
                if current_graph is not None else None
            )
            no_op_against_committed = bool(
                current is not None
                and current_graph is not None
                and not rebuild
                and not incremental_trace
                and str(target_watermark) == current.input_watermark
                and committed_registry_digest == registry_digest
                and current_graph.meta.get("inputDigest")
            )
            input_digest = str(current_graph.meta["inputDigest"]) \
                if no_op_against_committed else self._update_input_digest(
                    thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                    trace=incremental_trace, workspace_root=workspace, project_root=project,
                    rebuild=rebuild, threshold=threshold,
                    access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                    # Artifact lifecycle is an input even when the runtime trace and
                    # watermark are unchanged. Omitting it would make content changes
                    # incorrectly replay the old snapshot.
                    registry_digest=registry_digest,
                )
            previous_status = self._updates.get(thread_id) or self._load_update_status(thread_id)
            prior_input_digest = (previous_status or {}).get("inputDigest") or (
                current_graph.meta.get("inputDigest") if current_graph is not None else None
            )
            event_key = str(
                idempotency_key
                or ((previous_status or {}).get("eventIdempotencyKey")
                    if current is not None and prior_input_digest == input_digest else None)
                or input_digest
            )
            queued_event = self._event_store.append(
                "EvidenceUpdateQueued",
                aggregate_type="EvidenceThread",
                aggregate_id=thread_id,
                idempotency_key=event_key,
                occurred_at=queued_at,
                correlation_id=correlation_id,
                payload={
                    "threadId": thread_id,
                    "targetWatermark": str(target_watermark),
                    "reason": reason,
                    "priority": priority,
                    "workspaceRoot": workspace,
                    "projectRoot": project,
                    "inputDigest": input_digest,
                    **staged.summary(),
                },
            )
            if current is not None and prior_input_digest == input_digest:
                replay = {
                    "id": f"evidence-update:{uuid.uuid4().hex}", "threadId": thread_id,
                    "state": "fresh", "desiredWatermark": str(target_watermark),
                    "currentWatermark": current.input_watermark, "reason": reason, "priority": priority,
                    "inputDigest": input_digest, "snapshotDigest": current.digest,
                    "eventIdempotencyKey": event_key, "queuedEventId": queued_event["eventId"],
                    "startedAt": utc_now_iso(), "completedAt": utc_now_iso(), "error": None,
                }
                self._updates[thread_id] = replay
                self._persist_update_status(thread_id)
                self._trace_staging.complete(staged)
                return {
                    "update": replay, "snapshot": current.to_dict(),
                    "delta": {"new_nodes": [], "new_edges": []}, "verification": None,
                    "idempotent": True, "events": [queued_event],
                }

            status = {
                "id": f"evidence-update:{uuid.uuid4().hex}",
                "threadId": thread_id,
                "state": "updating",
                "desiredWatermark": str(target_watermark),
                "reason": reason,
                "priority": priority,
                "inputDigest": input_digest,
                "eventIdempotencyKey": event_key,
                "queuedEventId": queued_event["eventId"],
                "startedAt": utc_now_iso(),
                "error": None,
                "graphState": "staging",
                "traceStaging": staged.summary(),
            }
            self._updates[thread_id] = status
            self._persist_update_status(thread_id)
            try:
                base = None if rebuild else current_graph
                graph = ThreadGraph.from_dict(base.to_dict()) if base is not None else ThreadGraph(thread_id)
                graph.meta["inputDigest"] = input_digest
                graph.meta["scope"] = {
                    "workspaceRoot": workspace,
                    "projectRoot": project,
                    "accessPolicy": dict(access_policy or {}),
                }

                if incremental_trace:
                    if self.llm is None:
                        raise RuntimeError("no independent Model Router client configured for extraction/review")
                    extracted = extract_dag(
                        incremental_trace, self.llm, thread_id, artifact_registry=registry,
                    )
                    if rebuild or base is None:
                        extracted.meta.update(graph.meta)
                        graph = extracted
                        delta = {"new_nodes": list(graph.nodes), "new_edges": list(graph.edges)}
                    else:
                        delta = graph.merge_from(extracted)
                else:
                    delta = {"new_nodes": [], "new_edges": []}

                # Extraction may register the first observed ArtifactVersion.
                # Persist the post-extraction Registry digest so replaying the
                # same trace remains idempotent while later lifecycle changes
                # still invalidate the compiler input.
                input_digest = self._update_input_digest(
                    thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                    trace=incremental_trace, workspace_root=workspace, project_root=project,
                    rebuild=rebuild, threshold=threshold,
                    access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                    registry_digest=registry.state_digest(),
                )
                graph.meta["inputDigest"] = input_digest
                graph.meta["traceIngestion"] = self._trace_staging.committed_metadata(staged)
                graph.meta["artifactRegistryDigest"] = registry.state_digest()
                status["inputDigest"] = input_digest
                self._sync_registry(graph, registry)
                self._trace_staging.persist_provisional_graph(
                    staged, graph, phase="verification",
                    temporary_edge_count=len(delta.get("new_edges") or []),
                )
                status.update({
                    "graphState": "provisional",
                    "traceStaging": staged.summary(),
                })
                self._persist_update_status(thread_id)
                if graph.edges:
                    if self.llm is None:
                        raise RuntimeError("no independent verifier configured")
                    verification = _verify(
                        graph, self.llm, threshold=threshold, only_unscored=not rebuild,
                    )
                else:
                    verification = {
                        "threshold": threshold, "supports_edges_scored": 0,
                        "supports_edges_total": 0, "contradicts_edges_scored": 0,
                        "status_changes": [], "aggregates": {},
                    }

                semantic_edge_ids = {
                    edge_id for edge_id in (delta.get("new_edges") or [])
                    if edge_id in graph.edges and graph.edges[edge_id].rel in {
                        EdgeRel.SUPPORTS, EdgeRel.CONTRADICTS,
                    }
                }
                pending = [*run_a0(graph), *run_a1(
                    graph, threshold=threshold, verifier_version=VERIFIER_VERSION,
                    target_edge_ids=semantic_edge_ids,
                )]
                a2_targets = select_a2_targets(
                    graph,
                    changed_node_ids=delta.get("new_nodes") or [],
                    changed_edge_ids=delta.get("new_edges") or [],
                )
                if self.llm is not None:
                    pending.extend(run_a2(
                        graph, self.llm, reviewer_version=VERIFIER_VERSION,
                        target_ids=set(a2_targets),
                    ))
                else:
                    raise RuntimeError("A2 independent reviewer is required for Evidence Snapshot commit")
                # A0 re-checks the whole graph each compile; keeping only checks
                # that changed (new target, new result, new rationale) stops the
                # append-only ledger from growing with every unchanged compile.
                # A genuinely changed verdict has a different identity and is kept.
                recorded = {assessment_identity(existing) for existing in graph.assessments}
                pending = [item for item in pending if assessment_identity(item) not in recorded]
                computed_at = utc_now_iso()
                pending, graph.review_packets = attach_human_reviews(
                    graph, pending, delta=delta, computed_at=computed_at,
                    policy=DEFAULT_POLICY,
                )
                graph.review_policy_version = DEFAULT_POLICY.version
                prior_assessment_count = len(graph.assessments)
                graph.assessments.extend(pending)

                candidate = build_snapshot(
                    graph, version=(current.version + 1 if current else 1),
                    input_watermark=str(target_watermark),
                )
                if current is not None and candidate.digest == current.digest:
                    status.update({
                        "state": "fresh", "completedAt": utc_now_iso(),
                        "currentWatermark": current.input_watermark, "snapshotDigest": current.digest,
                        "graphState": "committed",
                    })
                    self._persist_update_status(thread_id)
                    self._trace_staging.complete(staged)
                    return {"update": dict(status), "snapshot": current.to_dict(),
                            "delta": {"new_nodes": [], "new_edges": []}, "verification": verification,
                            "idempotent": True, "events": [queued_event]}

                bound = bind_target_digest(pending, candidate.digest)
                graph.assessments[prior_assessment_count:] = bound
                graph.review_packets = remap_review_packet_assessment_ids(
                    graph.review_packets,
                    {before.assessment_id: after.assessment_id for before, after in zip(pending, bound)},
                )
                for assessment in bound:
                    edge = graph.edges.get(assessment.target_id)
                    if edge is not None and assessment.assessment_id not in edge.assessment_ids:
                        edge.assessment_ids.append(assessment.assessment_id)
                graph.meta["snapshot"] = candidate.to_dict()
                self._commit_snapshot(graph, candidate)
                self._graphs[thread_id] = graph
                self._snapshots[thread_id] = candidate
                self._last_delta[thread_id] = delta
                self._updated[thread_id] = time.time()
                status.update({
                    "state": "fresh", "completedAt": utc_now_iso(),
                    "currentWatermark": candidate.input_watermark,
                    "snapshotDigest": candidate.digest,
                    "graphState": "committed",
                })
                self._persist_update_status(thread_id)
                committed_event = self._event_store.append(
                    "EvidenceSnapshotCommitted",
                    aggregate_type="EvidenceThread",
                    aggregate_id=thread_id,
                    idempotency_key=candidate.digest,
                    occurred_at=status["completedAt"],
                    correlation_id=correlation_id or queued_event.get("correlationId"),
                    causation_id=queued_event["eventId"],
                    payload={
                        "threadId": thread_id,
                        "snapshotDigest": candidate.digest,
                        "snapshotVersion": candidate.version,
                        "inputWatermark": candidate.input_watermark,
                        "queuedEventId": queued_event["eventId"],
                        "updateId": status["id"],
                        "startedAt": status["startedAt"],
                        "completedAt": status["completedAt"],
                    },
                )
                self._trace_staging.complete(staged)
                return {
                    "update": dict(status), "snapshot": candidate.to_dict(), "delta": delta,
                    "verification": verification, "idempotent": False,
                    "events": [queued_event, committed_event],
                }
            except Exception as exc:
                self._trace_staging.fail(staged, exc)
                status.update({
                    "state": "error", "completedAt": utc_now_iso(),
                    "error": evidence_update_error(exc),
                    "graphState": "failed",
                    "traceStaging": staged.summary(),
                })
                self._persist_update_status(thread_id)
                raise

    @staticmethod
    def _update_input_digest(
        *, thread_id: str, target_watermark: str, reason: str, trace: Optional[list[dict]],
        workspace_root: str, project_root: Optional[str], rebuild: bool,
        threshold: float, access_policy: Optional[dict[str, Any]], registry_digest: str,
        rebuild_rationale: Optional[str],
    ) -> str:
        payload = json.dumps({
            "threadId": thread_id, "targetWatermark": target_watermark, "reason": reason,
            "trace": trace, "workspaceRoot": os.path.abspath(workspace_root),
            "projectRoot": os.path.abspath(project_root or workspace_root),
            "rebuild": rebuild, "threshold": threshold, "accessPolicy": access_policy or {},
            "rebuildRationale": rebuild_rationale,
            "schemaVersion": SCHEMA_VERSION, "extractorVersion": EXTRACTOR_VERSION,
            "verifierVersion": VERIFIER_VERSION, "artifactRegistryDigest": registry_digest,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"

    def update_status(self, thread_id: str) -> dict[str, Any]:
        # update() replaces committed graph/snapshot objects atomically, so the
        # last valid snapshot remains readable while its successor is compiled.
        status = dict(self._updates.get(thread_id) or self._load_update_status(thread_id) or {})
        snapshot = self.latest_snapshot(thread_id)
        committed_graph = self.get(thread_id) if snapshot is not None else None
        staging = self._trace_staging.status(thread_id)
        if (
            staging is not None
            and staging.get("status") == "failed"
            and isinstance(status.get("error"), dict)
        ):
            staging = {**staging, "error": dict(status["error"])}
        return {
            "threadId": thread_id,
            "status": status.get("state", "fresh" if snapshot else "dirty"),
            "desiredWatermark": status.get("desiredWatermark"),
            "currentWatermark": status.get("currentWatermark") or
                (snapshot.input_watermark if snapshot else None),
            "error": status.get("error"),
            "updateId": status.get("id"),
            "queuedEventId": status.get("queuedEventId"),
            "reason": status.get("reason"),
            "priority": status.get("priority"),
            "snapshot": snapshot.to_dict() if snapshot else None,
            "nodeCount": len(committed_graph.nodes) if committed_graph is not None else 0,
            "edgeCount": len(committed_graph.edges) if committed_graph is not None else 0,
            "graphState": status.get("graphState") or (
                staging.get("status") if staging else "committed" if snapshot else "absent"
            ),
            "staging": staging,
        }

    def provisional_graph(self, thread_id: str) -> Optional[ThreadGraph]:
        """Return the isolated compile candidate, never the committed read model."""
        return self._trace_staging.provisional_graph(thread_id)

    def _sync_registry(self, graph: ThreadGraph, registry: ArtifactRegistry) -> None:
        stale_roots: list[str] = []
        for node in graph.nodes.values():
            if not node.artifact_id:
                continue
            artifact = registry.artifacts.get(node.artifact_id)
            referenced = registry.versions.get(node.artifact_version_id or "")
            if not artifact or not referenced:
                node.freshness = "stale"
                stale_roots.append(node.id)
                continue
            graph.artifacts[artifact.artifact_id] = type(artifact).from_dict(artifact.to_dict())
            graph.artifact_versions[referenced.version_id] = type(referenced).from_dict(referenced.to_dict())
            current = registry.versions.get(artifact.current_version_id)
            if current:
                graph.artifact_versions[current.version_id] = type(current).from_dict(current.to_dict())
            if node.source_anchor_id and node.source_anchor_id in registry.anchors:
                anchor = registry.anchors[node.source_anchor_id]
                graph.source_anchors[anchor.anchor_id] = type(anchor).from_dict(anchor.to_dict())
            if referenced.availability == "missing" or artifact.current_version_id != referenced.version_id:
                node.freshness = "stale"
                stale_roots.append(node.id)
            else:
                node.freshness = "fresh"
        if not stale_roots:
            return
        support_graph = graph.supports_digraph()
        stale_downstream: set[str] = set()
        for root in stale_roots:
            stale_downstream.update(descendants(support_graph, root))
        for node_id in stale_downstream:
            graph.nodes[node_id].freshness = "stale"

    # --- Artifact Registry commands --------------------------------------
    def register_artifact(
        self, *, workspace_root: str, project_root: Optional[str], payload: dict[str, Any],
    ) -> dict[str, Any]:
        registry = self._registry(workspace_root=workspace_root, project_root=project_root)
        artifact, version, outcome = registry.register(
            kind=payload.get("kind", "other"), locator=payload.get("locator", ""),
            content_digest=payload.get("contentDigest"), version=payload.get("version"),
            size=payload.get("size"), media_type=payload.get("mediaType"),
            retention=payload.get("retention", "reference"),
            access_policy=payload.get("accessPolicy") if isinstance(payload.get("accessPolicy"), dict) else None,
        )
        anchor = None
        if isinstance(payload.get("selector"), dict):
            anchor = registry.create_anchor(
                artifact.artifact_id, payload["selector"], anchor_digest=payload.get("anchorDigest"),
                artifact_version_id=version.version_id,
            )
        return {"outcome": outcome, "artifact": artifact.to_dict(), "artifactVersion": version.to_dict(),
                "sourceAnchor": anchor.to_dict() if anchor else None}

    def resolve_artifact(
        self, artifact_id: str, *, workspace_root: str,
        project_root: Optional[str], candidate_locators: list[str],
    ) -> dict[str, Any]:
        result = self._registry(
            workspace_root=workspace_root, project_root=project_root,
        ).resolve(
            artifact_id, candidate_locators=candidate_locators,
        )
        event = result.get("event")
        if isinstance(event, dict):
            workspace, project, _scope_key = self._workspace_scope(
                workspace_root, project_root,
            )
            result = {**result, "domainEvent": self._event_store.append_lifecycle(
                event, workspace_root=workspace, project_root=project,
            )}
        return result

    def resolve_artifacts(
        self, *, workspace_root: str, project_root: Optional[str],
    ) -> dict[str, Any]:
        """Scan one workspace-scoped Registry and locate affected Evidence snapshots."""
        workspace, project, _scope_key = self._workspace_scope(workspace_root, project_root)
        registry = self._registry(
            workspace_root=workspace, project_root=project,
        )
        events = registry.resolve_all()
        domain_events = [
            self._event_store.append_lifecycle(
                event, workspace_root=workspace, project_root=project,
            )
            for event in events
        ]
        changed_ids = {event["artifactId"] for event in events}
        affected: list[dict[str, Any]] = []
        if changed_ids:
            for thread_id in self.list_threads():
                graph = self.get(thread_id)
                if graph is None:
                    continue
                scope = (graph.meta or {}).get("scope") or {}
                if (
                    scope.get("workspaceRoot") != workspace
                    or scope.get("projectRoot") != project
                ):
                    continue
                used = sorted({
                    node.artifact_id for node in graph.nodes.values()
                    if node.artifact_id in changed_ids
                })
                if not used:
                    continue
                snapshot = self.latest_snapshot(thread_id)
                if snapshot is None:
                    continue
                affected.append({
                    "threadId": thread_id,
                    "targetWatermark": snapshot.input_watermark,
                    "artifactIds": used,
                })
        return {
            "events": events,
            "domainEvents": domain_events,
            "affectedThreads": affected,
            "scope": {
                "workspaceRoot": workspace,
                "projectRoot": project,
            },
        }

    def acknowledge_artifact_events(
        self, *, workspace_root: str, project_root: Optional[str],
        event_ids: list[str],
    ) -> dict[str, Any]:
        registry = self._registry(
            workspace_root=workspace_root, project_root=project_root,
        )
        acknowledged = registry.acknowledge_events(event_ids)
        return {"acknowledged": acknowledged, "pending": len(registry.pending_events)}

    # --- read models / audit side chain ----------------------------------
    def get(self, thread_id: str) -> Optional[ThreadGraph]:
        if thread_id in self._graphs:
            return self._graphs[thread_id]
        path = self._path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as fh:
            graph = provjson.loads(fh.read())
        snapshot = self._verified_snapshot(graph, thread_id=thread_id)
        self._apply_review_decisions(graph, snapshot.digest)
        self._graphs[thread_id] = graph
        self._snapshots[thread_id] = snapshot
        return graph

    def require(self, thread_id: str) -> ThreadGraph:
        graph = self.get(thread_id)
        if graph is None:
            raise KeyError(thread_id)
        return graph

    @staticmethod
    def _decision_status(action: str) -> HumanReviewStatus:
        try:
            return {
                "approve": HumanReviewStatus.APPROVED,
                "reject": HumanReviewStatus.REJECTED,
                "defer": HumanReviewStatus.DEFERRED,
                "request_evidence": HumanReviewStatus.PENDING,
            }[action]
        except KeyError as exc:
            raise ValueError(
                "action must be approve, reject, defer, or request_evidence"
            ) from exc

    @classmethod
    def _apply_review_decision_to_graph(
        cls,
        graph: ThreadGraph,
        *,
        packet_id: str,
        action: str,
        actor: str,
        reviewed_at: str,
    ) -> dict[str, Any]:
        status = cls._decision_status(action)
        index = next((
            index for index, packet in enumerate(graph.review_packets)
            if packet.review_packet_id == packet_id
        ), None)
        if index is None:
            raise KeyError(packet_id)
        current = graph.review_packets[index]
        blocking = (
            current.level.value == "required"
            and status != HumanReviewStatus.APPROVED
        )
        updated = replace(
            current,
            status=status,
            blocking=blocking,
            reviewed_by=actor,
            reviewed_at=reviewed_at,
        )
        graph.review_packets[index] = updated
        for assessment_index, assessment in enumerate(graph.assessments):
            review = assessment.human_review
            if review is None or review.review_packet_id != packet_id:
                continue
            graph.assessments[assessment_index] = replace(
                assessment,
                human_review=replace(
                    review,
                    status=status,
                    blocking=blocking,
                    reviewed_by=actor,
                    reviewed_at=reviewed_at,
                ),
            )
        return updated.to_dict()

    def _apply_review_decisions(self, graph: ThreadGraph, snapshot_digest: str) -> None:
        events = self._event_store.read(
            event_types=("HumanReviewDecisionRecorded",), limit=5000,
        )
        for event in events:
            payload = event.get("payload") or {}
            if payload.get("threadId") != graph.thread_id:
                continue
            if payload.get("snapshotDigest") != snapshot_digest:
                continue
            try:
                self._apply_review_decision_to_graph(
                    graph,
                    packet_id=str(payload.get("reviewPacketId") or ""),
                    action=str(payload.get("action") or ""),
                    actor=str(payload.get("actor") or ""),
                    reviewed_at=str(event.get("occurredAt") or payload.get("reviewedAt") or ""),
                )
            except (KeyError, ValueError):
                # The immutable event remains auditable even if a later policy
                # version no longer exposes the packet in this read model.
                continue

    def record_review_decision(
        self,
        thread_id: str,
        packet_id: str,
        *,
        action: str,
        expected_snapshot_digest: str,
        actor: str,
        rationale: str,
        idempotency_key: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Record a human disposition without rewriting an immutable snapshot."""
        packet_id = str(packet_id or "").strip()
        actor = str(actor or "").strip()
        rationale = str(rationale or "").strip()
        expected_snapshot_digest = str(expected_snapshot_digest or "").strip()
        action = str(action or "").strip().lower()
        self._decision_status(action)
        if not packet_id or not actor or not rationale or not expected_snapshot_digest:
            raise ValueError(
                "reviewPacketId, expectedSnapshotDigest, actor, and rationale are required"
            )
        with self._compile_lock(thread_id):
            snapshot = self.latest_snapshot(thread_id)
            if snapshot is None:
                raise KeyError(thread_id)
            if snapshot.digest != expected_snapshot_digest:
                raise ReviewDecisionConflict(
                    "snapshot changed; reload review packets before recording a decision"
                )
            graph = self.require(thread_id)
            if not any(packet.review_packet_id == packet_id for packet in graph.review_packets):
                raise KeyError(packet_id)
            decision_time = utc_now_iso()
            if idempotency_key:
                event_key = str(idempotency_key).strip()
            else:
                identity = json.dumps({
                    "threadId": thread_id,
                    "snapshotDigest": snapshot.digest,
                    "reviewPacketId": packet_id,
                    "action": action,
                    "actor": actor,
                    "rationale": rationale,
                }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                event_key = "review-decision:" + hashlib.sha256(
                    identity.encode("utf-8")
                ).hexdigest()[:32]
            decision_payload = {
                "threadId": thread_id,
                "snapshotDigest": snapshot.digest,
                "reviewPacketId": packet_id,
                "action": action,
                "actor": actor,
                "rationale": rationale,
                "checker": {
                    "actorType": "human",
                    "actor": actor,
                    "method": "review-decision-api-v1",
                    "authority": "override",
                },
            }
            event = self._event_store.append(
                "HumanReviewDecisionRecorded",
                aggregate_type="EvidenceThread",
                aggregate_id=thread_id,
                idempotency_key=event_key,
                correlation_id=correlation_id,
                payload=decision_payload,
                occurred_at=decision_time,
            )
            if event.get("payload") != decision_payload:
                raise ReviewDecisionConflict(
                    "idempotency key was already used for a different review decision"
                )
            packet = self._apply_review_decision_to_graph(
                graph,
                packet_id=packet_id,
                action=str(event["payload"]["action"]),
                actor=str(event["payload"]["actor"]),
                reviewed_at=str(event["occurredAt"]),
            )
            return {
                "snapshot": snapshot.to_dict(),
                "reviewPacket": packet,
                "decision": dict(event["payload"]),
                "event": event,
            }

    def latest_snapshot(self, thread_id: str) -> Optional[EvidenceSnapshot]:
        if thread_id in self._snapshots:
            return self._snapshots[thread_id]
        graph = self.get(thread_id)
        return EvidenceSnapshot.from_dict(graph.meta["snapshot"]) if graph else None

    def list_threads(self) -> list[str]:
        found: dict[str, float] = {}
        if self.storage_dir:
            for filename in os.listdir(self.storage_dir):
                if not filename.endswith(".prov.json"):
                    continue
                path = os.path.join(self.storage_dir, filename)
                try:
                    mtime = os.path.getmtime(path)
                    cached = self._thread_id_cache.get(path)
                    if cached is not None and cached[0] == mtime:
                        found[cached[1]] = mtime
                        continue
                    with open(path, encoding="utf-8") as fh:
                        doc = json.load(fh)
                    snapshot = EvidenceSnapshot.from_dict((doc.get("edag:meta") or {}).get("snapshot") or {})
                    self._thread_id_cache[path] = (mtime, snapshot.thread_id)
                    found[snapshot.thread_id] = mtime
                except (OSError, ValueError, TypeError):
                    continue
        for thread_id in self._graphs:
            found[thread_id] = max(found.get(thread_id, 0.0), self._updated.get(thread_id, 0.0))
        return [key for key, _ in sorted(found.items(), key=lambda item: (-item[1], item[0]))]

    def last_delta(self, thread_id: str) -> dict:
        return self._last_delta.get(thread_id, {"new_nodes": [], "new_edges": []})

    def provenance(self, thread_id: str, node_id: str) -> dict:
        return self.require(thread_id).provenance_path(node_id)

    def metrics(self, thread_id: str) -> dict:
        snapshot = self.latest_snapshot(thread_id)
        return _metrics.all_metrics(
            self.require(thread_id),
            events=self.events(thread_id=thread_id, limit=5000),
            audits=self.audit_runs(thread_id),
            snapshot=snapshot.to_dict() if snapshot else None,
            snapshot_history=self._snapshot_history(thread_id),
        )

    def events(
        self, *, thread_id: Optional[str] = None, event_types=(),
        after_sequence: int = 0, limit: int = 500,
    ) -> list[dict[str, Any]]:
        if limit < 1 or limit > 5000:
            raise ValueError("limit must be between 1 and 5000")
        # Audit/Finding events aggregate by their own identity, so thread
        # filtering also checks the durable payload instead of inventing a
        # duplicate per-thread event.
        events = self._event_store.read(
            event_types=event_types, after_sequence=after_sequence, limit=5000,
        )
        if thread_id is not None:
            events = [
                event for event in events
                if event.get("aggregateId") == thread_id
                or (isinstance(event.get("payload"), dict)
                    and event["payload"].get("threadId") == thread_id)
            ]
        return events[:limit]

    def _snapshot_history(self, thread_id: str) -> list[dict[str, Any]]:
        directory = self._snapshot_dir(thread_id)
        snapshots: dict[str, dict[str, Any]] = {}
        if directory and os.path.isdir(directory):
            for path in glob.glob(os.path.join(directory, "*.prov.json")):
                try:
                    # Historical snapshot files are immutable: verify each file
                    # once and serve later reads from the mtime-keyed cache.
                    mtime = os.path.getmtime(path)
                    cached = self._history_cache.get(path)
                    if cached is None or cached[0] != mtime:
                        with open(path, encoding="utf-8") as fh:
                            graph = provjson.loads(fh.read())
                        snapshot = self._verified_snapshot(graph, thread_id=thread_id)
                        cached = (mtime, snapshot.to_dict())
                        self._history_cache[path] = cached
                    entry = cached[1]
                    snapshots[str(entry["digest"])] = dict(entry)
                except (OSError, TypeError, ValueError):
                    continue
        current = self.latest_snapshot(thread_id)
        if current is not None:
            snapshots[current.digest] = current.to_dict()
        return sorted(snapshots.values(), key=lambda item: int(item["version"]))

    def analysis(self, thread_id: str, *, threshold: float = 0.7) -> dict:
        return _analysis.analyze(self.require(thread_id), threshold=threshold)

    def reconcile(self, thread_id: str, *, remove_nodes=(), remove_edges=(),
                  add_contradicts=(), threshold: float = 0.7) -> dict:
        return _reconcile.reconcile(
            self.require(thread_id), remove_nodes=remove_nodes, remove_edges=remove_edges,
            add_contradicts=add_contradicts, threshold=threshold,
        )

    def snapshot_graph(self, thread_id: str, target_digest: str) -> tuple[ThreadGraph, EvidenceSnapshot]:
        current = self.latest_snapshot(thread_id)
        if current is not None and current.digest == target_digest:
            graph = self.require(thread_id)
            self._verified_snapshot(graph, thread_id=thread_id, target_digest=target_digest)
            return graph, current
        directory = self._snapshot_dir(thread_id)
        if not directory:
            raise KeyError(target_digest)
        matches = glob.glob(os.path.join(directory, f"*-{target_digest.removeprefix('sha256:')}.prov.json"))
        if len(matches) != 1:
            raise KeyError(target_digest)
        with open(matches[0], encoding="utf-8") as fh:
            graph = provjson.loads(fh.read())
        snapshot = self._verified_snapshot(
            graph, thread_id=thread_id, target_digest=target_digest,
        )
        return graph, snapshot

    def trusted_evidence_preview(
        self,
        thread_id: str,
        *,
        snapshot_digest: str,
        source_assertion_id: str,
        artifact_version_id: str,
        source_anchor_id: str,
    ) -> dict[str, Any]:
        """Re-fetch one opaque evidence tuple from a verified committed snapshot."""
        try:
            graph, snapshot = self.snapshot_graph(thread_id, snapshot_digest)
        except (KeyError, TypeError, ValueError):
            return {
                "resolved": False,
                "code": "snapshot_mismatch",
                "message": "Pinned committed Evidence Snapshot was not found or failed verification.",
            }

        assertion = graph.nodes.get(source_assertion_id)
        if (
            assertion is None
            or assertion.type.value != "source_assertion"
            or assertion.artifact_version_id != artifact_version_id
            or assertion.source_anchor_id != source_anchor_id
            or not assertion.artifact_id
        ):
            return {
                "resolved": False,
                "code": "provenance_mismatch",
                "message": "SourceAssertion tuple is absent from the pinned Evidence Snapshot.",
            }
        artifact = graph.artifacts.get(assertion.artifact_id)
        version = graph.artifact_versions.get(artifact_version_id)
        anchor = graph.source_anchors.get(source_anchor_id)
        if (
            artifact is None
            or version is None
            or anchor is None
            or version.artifact_id != assertion.artifact_id
            or anchor.artifact_id != assertion.artifact_id
            or anchor.artifact_version_id != artifact_version_id
        ):
            return {
                "resolved": False,
                "code": "provenance_mismatch",
                "message": "Committed ArtifactVersion and SourceAnchor links are inconsistent.",
            }
        scope = graph.meta.get("scope") if isinstance(graph.meta.get("scope"), dict) else {}
        return {
            "resolved": True,
            "threadId": thread_id,
            "snapshotDigest": snapshot.digest,
            "workspaceRoot": scope.get("workspaceRoot"),
            "sourceAssertion": assertion.to_dict(),
            "artifact": artifact.to_dict(),
            "artifactVersion": version.to_dict(),
            "sourceAnchor": anchor.to_dict(),
            "accessPolicy": dict(scope.get("accessPolicy") or {}),
        }

    def audit(
        self, thread_id: str, *, target_digest: str, level: str = "L0",
        trigger: str = "manual", threshold: float = 0.7,
    ) -> dict:
        graph, snapshot = self.snapshot_graph(thread_id, target_digest)
        if trigger == "auto":
            existing = next((
                run for run in self.audit_runs(thread_id)
                if run.get("target_digest") == target_digest and run.get("trigger") == trigger and
                run.get("threshold") == threshold
            ), None)
            if existing is not None:
                self._record_audit_events(existing)
                return existing
        run = _audit.run_audit(
            graph, threshold=threshold, trigger=trigger, level=level,
            run_id=f"audit:{uuid.uuid4().hex[:12]}", target_digest=snapshot.digest,
        )
        runs = [run, *self.audit_runs(thread_id)]
        self._audit_runs[thread_id] = runs[:50]
        self._persist_audit(thread_id)
        self._record_audit_events(run)
        return run

    def _record_audit_events(self, run: dict[str, Any]) -> None:
        completed = self._event_store.append(
            "AuditCompleted",
            aggregate_type="AuditRun",
            aggregate_id=str(run["id"]),
            idempotency_key=str(run["id"]),
            occurred_at=run.get("completed_at"),
            payload={
                "threadId": run.get("thread_id"),
                "auditRunId": run.get("id"),
                "targetDigest": run.get("target_digest"),
                "level": run.get("level"),
                "trigger": run.get("trigger"),
                "status": run.get("status"),
                "startedAt": run.get("started_at"),
                "completedAt": run.get("completed_at"),
                "findingCount": len(run.get("findings") or []),
            },
        )
        for finding in run.get("findings") or []:
            fingerprint = str(finding.get("fingerprint") or finding.get("id") or "")
            if not fingerprint:
                continue
            self._event_store.append(
                "FindingOpened",
                aggregate_type="AuditFinding",
                aggregate_id=fingerprint,
                idempotency_key=f"{run.get('target_digest')}|{fingerprint}",
                occurred_at=run.get("completed_at"),
                causation_id=completed["eventId"],
                payload={
                    "threadId": run.get("thread_id"),
                    "auditRunId": run.get("id"),
                    "targetDigest": run.get("target_digest"),
                    "findingId": finding.get("id"),
                    "fingerprint": fingerprint,
                    "targetId": finding.get("target_id"),
                    "findingType": finding.get("finding_type"),
                    "severity": finding.get("severity"),
                    "status": finding.get("status"),
                },
            )

    def audit_runs(self, thread_id: str) -> list[dict]:
        if thread_id in self._audit_runs:
            return self._mark_audit_staleness(thread_id, self._audit_runs[thread_id])
        path = self._audit_path(thread_id)
        runs: list[dict] = []
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            runs = doc.get("runs") or []
        self._audit_runs[thread_id] = runs
        return self._mark_audit_staleness(thread_id, runs)

    def _mark_audit_staleness(self, thread_id: str, runs: list[dict]) -> list[dict]:
        snapshot = self.latest_snapshot(thread_id)
        current = snapshot.digest if snapshot else None
        return [{**run, "stale": run.get("target_digest") != current} for run in runs]

    def export_prov_json(self, thread_id: str) -> dict:
        return provjson.to_prov_json(self.require(thread_id))

    # --- atomic persistence -----------------------------------------------
    def _commit_snapshot(self, graph: ThreadGraph, snapshot: EvidenceSnapshot) -> None:
        latest_path = self._path(graph.thread_id)
        if not latest_path:
            return
        snapshot_dir = self._snapshot_dir(graph.thread_id)
        assert snapshot_dir is not None
        os.makedirs(snapshot_dir, exist_ok=True)
        content = provjson.dumps(graph)
        immutable_path = os.path.join(
            snapshot_dir, f"{snapshot.version:08d}-{snapshot.digest[7:]}.prov.json",
        )
        if os.path.exists(immutable_path):
            with open(immutable_path, encoding="utf-8") as fh:
                if fh.read() != content:
                    raise RuntimeError("immutable Evidence Snapshot collision")
        else:
            self._atomic_write(immutable_path, content)
        self._atomic_write(latest_path, content)

    @staticmethod
    def _atomic_write(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "x", encoding="utf-8") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _persist_update_status(self, thread_id: str) -> None:
        path = self._update_path(thread_id)
        if path and thread_id in self._updates:
            self._atomic_write(path, json.dumps(self._updates[thread_id], ensure_ascii=False, indent=2))

    def _load_update_status(self, thread_id: str) -> Optional[dict[str, Any]]:
        path = self._update_path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as fh:
            status = json.load(fh)
        if status.get("state") == "updating":
            message = "worker restarted during update; retry through /updates"
            status = {**status, "state": "error", "graphState": "failed", "error": {
                "type": "InterruptedUpdate",
                "code": "evidence_update_interrupted",
                "message": message,
                "retryable": True,
                "attempts": 0,
                "incompleteReason": None,
                "responseStatus": None,
            }}
            self._trace_staging.interrupt(thread_id, message)
            self._updates[thread_id] = status
            self._persist_update_status(thread_id)
        return status

    def _persist_audit(self, thread_id: str) -> None:
        path = self._audit_path(thread_id)
        if path:
            self._atomic_write(path, json.dumps({
                "threadId": thread_id, "runs": self._audit_runs.get(thread_id, []),
            }, ensure_ascii=False, indent=2))

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
