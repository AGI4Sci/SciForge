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
from datetime import datetime
from typing import Any, Optional

from . import analysis as _analysis
from . import audit as _audit
from . import metrics as _metrics
from . import provjson
from .products import export_snapshot_products as _export_snapshot_products
from . import reconcile as _reconcile
from .access import (
    artifact_restricted,
    availability_restricted,
    graph_restricted,
    lineage_restricted,
    policy_restricted,
    project_event,
    project_graph,
    project_lineage,
    project_metrics,
    project_prov_json,
    project_registry_result,
    project_snapshot,
    project_summary,
    project_update_result,
    project_update_status,
    require_unrestricted,
    scope_restricted,
)
from .artifact_versions import ArtifactVersionProjectionClient
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
from .lineage import ingest_trace_lineage
from .llm import LLM, LLMCallError
from .model import EdgeRel, HumanReviewStatus, NodeStatus, NodeType
from .rerun import build_rerun_spec, compare_rerun_specs, output_values_for_spec
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
from .snapshot_storage import (
    atomic_publish_latest,
    read_snapshot_text,
    write_snapshot,
)
from .verifier import verify as _verify


class ReviewDecisionConflict(RuntimeError):
    """Raised when a decision is not bound to the current immutable snapshot."""


_EXECUTION_EVENT_SCHEMA = "sciforge.execution-event.v1"
_RUN_MANIFEST_KIND = "sciforge.create-loop.run-manifest"
_RUN_MANIFEST_SCHEMA = "sciforge.create-loop.run.v2"
_RERUN_SPEC_KIND = "sciforge.repro-spec"
_RERUN_SPEC_SCHEMA = "sciforge.rerun.v1"
_HOST_EXECUTION_BOUNDARY = "sciforge.host.execution-completed.v1"
_SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_EVENT_KEYS = frozenset({
    "schemaVersion", "eventId", "phase", "producer", "executionId", "runId",
    "activityId", "specDigest", "rerunOfRunId", "traceId", "scope",
    "workspaceRoot", "occurredAt", "payload", "artifacts",
})
_TRACE_WRAPPER_KEYS = frozenset({"id", "source_item_id", "sciforgeEvidenceEvent"})
_MARKER_KEYS = frozenset({
    "trustedBoundary", "eventKind", "hostBinding", "producer", "executionId", "runId",
    "activityId", "runtimeId", "threadId", "turnId", "occurredAt", "targetWatermark",
    "workspaceRoot",
})


def _bounded_text(value: Any, maximum: int = 512) -> Optional[str]:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return None
    return value if len(value) <= maximum else None


def _valid_timestamp(value: Any) -> bool:
    text = _bounded_text(value, 128)
    if text is None:
        return False
    try:
        datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError:
        return False
    return True


def _valid_producer(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"moduleId", "moduleVersion"} \
        and _bounded_text(value.get("moduleId")) is not None \
        and _bounded_text(value.get("moduleVersion"), 128) is not None


def _trusted_execution_marker(item: dict[str, Any]) -> Optional[dict[str, Any]]:
    marker = item.get("sciforgeEvidenceEvent")
    if not isinstance(marker, dict) or not set(marker).issubset(_MARKER_KEYS):
        return None
    required = {
        "trustedBoundary", "eventKind", "hostBinding", "producer", "executionId", "runId",
        "runtimeId", "threadId", "occurredAt", "targetWatermark",
    }
    if not required.issubset(marker) \
            or marker.get("trustedBoundary") != _HOST_EXECUTION_BOUNDARY \
            or marker.get("eventKind") != "execution-completed" \
            or not _valid_producer(marker.get("producer")) \
            or any(_bounded_text(marker.get(key)) is None for key in (
                "executionId", "runId", "runtimeId", "threadId", "targetWatermark",
            )) \
            or not _valid_timestamp(marker.get("occurredAt")):
        return None
    binding = marker.get("hostBinding")
    if not isinstance(binding, dict) or binding.get("contractVersion") != 1:
        return None
    sequence = binding.get("acceptanceSequence")
    watermark = str(marker["targetWatermark"])
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1 \
            or watermark.split(":", 1)[0] != str(sequence):
        return None
    workspace_binding = binding.get("workspaceBinding")
    if workspace_binding == "capability-caller":
        if set(binding) != {
            "contractVersion", "acceptanceSequence", "workspaceBinding", "workspaceRoot",
        }:
            return None
        root = _bounded_text(binding.get("workspaceRoot"), 4096)
        if root is None or marker.get("workspaceRoot") != root:
            return None
    elif workspace_binding == "unbound":
        if set(binding) != {
            "contractVersion", "acceptanceSequence", "workspaceBinding",
        } or "workspaceRoot" in marker:
            return None
    else:
        return None
    expected_keys = set(required)
    if workspace_binding == "capability-caller":
        expected_keys.add("workspaceRoot")
    for key in ("activityId", "turnId"):
        if key in marker:
            if _bounded_text(marker.get(key)) is None:
                return None
            expected_keys.add(key)
    if set(marker) != expected_keys:
        return None
    return marker


def _valid_execution_event(item: dict[str, Any], marker: dict[str, Any]) -> bool:
    event = {key: value for key, value in item.items() if key not in _TRACE_WRAPPER_KEYS}
    required = {
        "schemaVersion", "eventId", "phase", "producer", "executionId", "runId",
        "occurredAt", "artifacts",
    }
    if not required.issubset(event) or not set(event).issubset(_EVENT_KEYS) \
            or event.get("schemaVersion") != _EXECUTION_EVENT_SCHEMA \
            or event.get("phase") not in {"run_completed", "run_failed"} \
            or not _valid_producer(event.get("producer")) \
            or any(_bounded_text(event.get(key)) is None for key in (
                "eventId", "executionId", "runId",
            )) \
            or not _valid_timestamp(event.get("occurredAt")) \
            or not isinstance(event.get("artifacts"), list) \
            or len(event["artifacts"]) > 10_000:
        return False
    if event["producer"] != marker["producer"] \
            or event["executionId"] != marker["executionId"] \
            or event["runId"] != marker["runId"] \
            or event["occurredAt"] != marker["occurredAt"] \
            or event.get("activityId") != marker.get("activityId"):
        return False
    binding = marker["hostBinding"]
    if binding["workspaceBinding"] == "capability-caller":
        if event.get("workspaceRoot") != binding["workspaceRoot"]:
            return False
    elif "workspaceRoot" in event:
        return False
    if "specDigest" in event and not _SHA256_RE.fullmatch(str(event["specDigest"])):
        return False
    if "rerunOfRunId" in event and _bounded_text(event.get("rerunOfRunId")) is None:
        return False
    if "traceId" in event and _bounded_text(event.get("traceId")) is None:
        return False
    scope = event.get("scope")
    if scope is not None and (
        not isinstance(scope, dict) or not set(scope).issubset({"runtimeId", "threadId", "turnId"})
        or any(_bounded_text(value) is None for value in scope.values())
    ):
        return False
    normalized_scope = scope if isinstance(scope, dict) else {}
    explicit_runtime = normalized_scope.get("runtimeId")
    explicit_thread = normalized_scope.get("threadId")
    if bool(explicit_runtime) != bool(explicit_thread):
        return False
    if explicit_runtime:
        if explicit_runtime != marker["runtimeId"] or explicit_thread != marker["threadId"]:
            return False
    elif marker["runtimeId"] != f"domain:{event['producer']['moduleId']}" \
            or marker["threadId"] != f"execution:{event['executionId']}":
        return False
    if normalized_scope.get("turnId") != marker.get("turnId"):
        return False
    try:
        json.dumps(event, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, UnicodeError):
        return False
    return True


def _valid_run_manifest(value: Any) -> bool:
    if not isinstance(value, dict) or value.get("schema") != _RUN_MANIFEST_SCHEMA:
        return False
    required = {
        "source", "workflow", "input", "context", "comparator", "determinism",
        "workflowFingerprint", "inputFingerprint", "specFingerprint",
        "contextFingerprint", "outputFingerprint", "outputJson",
        "approvalFingerprint", "artifactRefs", "approvals",
    }
    if not required.issubset(value) or any(
        not _SHA256_RE.fullmatch(str(value.get(key) or "")) for key in (
            "workflowFingerprint", "inputFingerprint", "specFingerprint",
            "contextFingerprint", "outputFingerprint", "approvalFingerprint",
        )
    ) or not isinstance(value.get("artifactRefs"), list) \
            or not isinstance(value.get("approvals"), list):
        return False
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, UnicodeError):
        return False
    return True


def _is_canonical_execution_bundle(trace: list[dict[str, Any]]) -> bool:
    """Return true only for a complete SDK execution-event artifact bundle.

    These items already carry typed, digest-bound lineage.  Sending them through
    semantic extraction would make durable provenance depend on model availability
    and could also reinterpret canonical executor records.  Mixed or unrecognised
    traces deliberately fall back to the normal LLM extraction/review path.
    """
    if not trace:
        return False
    saw_terminal_event = False
    bundle_marker: Optional[dict[str, Any]] = None
    declared_artifacts: list[str] = []
    observed_artifacts: list[str] = []
    for item in trace:
        if not isinstance(item, dict):
            return False
        marker = _trusted_execution_marker(item)
        if marker is None:
            return False
        if bundle_marker is None:
            bundle_marker = marker
        elif bundle_marker != marker:
            return False
        if item.get("schemaVersion") == _EXECUTION_EVENT_SCHEMA:
            if saw_terminal_event or not _valid_execution_event(item, marker):
                return False
            saw_terminal_event = True
            for artifact in item["artifacts"]:
                canonical = _canonical_bundle_artifact(artifact)
                if canonical is None:
                    return False
                declared_artifacts.append(canonical)
            continue
        kind = item.get("kind")
        if kind == _RUN_MANIFEST_KIND:
            manifest = item.get("manifest")
            if not _valid_run_manifest(manifest):
                return False
        elif kind == _RERUN_SPEC_KIND:
            spec = item.get("spec")
            if not isinstance(spec, dict) or spec.get("schemaVersion") != _RERUN_SPEC_SCHEMA:
                return False
            try:
                validate_rerun_spec(spec)
            except (TypeError, ValueError):
                return False
        else:
            return False
        canonical = _canonical_bundle_artifact(item)
        if canonical is None:
            return False
        observed_artifacts.append(canonical)
    return saw_terminal_event and bool(declared_artifacts) \
        and sorted(declared_artifacts) == sorted(observed_artifacts)


def _canonical_bundle_artifact(value: Any) -> Optional[str]:
    """Canonicalize an embedded/flattened artifact for exact multiset binding."""
    if not isinstance(value, dict):
        return None
    projected = {
        key: item for key, item in value.items()
        if key not in _TRACE_WRAPPER_KEYS
    }
    try:
        return json.dumps(
            projected, ensure_ascii=False, allow_nan=False,
            sort_keys=True, separators=(",", ":"),
        )
    except (TypeError, ValueError, UnicodeError):
        return None


def _historical_rerun_refs(trace: list[dict[str, Any]]) -> frozenset[str]:
    refs: set[str] = set()
    for item in trace:
        if item.get("schemaVersion") == _EXECUTION_EVENT_SCHEMA:
            value = _bounded_text(item.get("rerunOfRunId"))
            if value:
                refs.add(value)
        manifest = item.get("manifest") if item.get("kind") == _RUN_MANIFEST_KIND else None
        if isinstance(manifest, dict):
            value = _bounded_text(manifest.get("rerunOfRunId"))
            if value:
                refs.add(value)
    return frozenset(refs)


def _mark_declared_semantic_nodes(graph: ThreadGraph) -> list[dict[str, str]]:
    """Expose declared execution conclusions without claiming NLI verification.

    Project DAG intentionally ignores ``open`` nodes.  A canonical executor has
    authoritatively declared these semantic records, but no independent model has
    judged their entailment, so ``fragile`` is the strongest honest promotion.
    Source assertions retain the verifier's normal trusted-terminal treatment.
    """
    changes: list[dict[str, str]] = []
    for node in graph.nodes.values():
        role = node.attributes.get("semanticRole")
        target: Optional[NodeStatus] = None
        if role == "evidence" and node.type == NodeType.SOURCE_ASSERTION:
            target = NodeStatus.SUPPORTED
        elif role in {"evidence", "conclusion"} and node.type in {
            NodeType.CLAIM, NodeType.CONCLUSION, NodeType.FINDING,
        }:
            target = NodeStatus.FRAGILE
        if target is None or node.status == target:
            continue
        before = node.status
        node.status = target
        changes.append({"node": node.id, "from": before.value, "to": target.value})
    return changes


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
        if access_policy is not None and not isinstance(access_policy, dict):
            raise ValueError("accessPolicy must be an object when supplied")
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
            workspace, project, scope_key = self._workspace_scope(
                workspace_root, project_root,
            )
            committed_scope = current_graph.meta.get("scope") \
                if current_graph is not None else None
            committed_workspace = committed_scope.get("workspaceRoot") \
                if isinstance(committed_scope, dict) else None
            committed_scope_key = committed_scope.get("scopeKey") \
                if isinstance(committed_scope, dict) else None
            if current_graph is not None and not (
                isinstance(committed_workspace, str)
                and committed_workspace.strip()
                and isinstance(committed_scope_key, str)
                and committed_scope_key.strip()
            ):
                raise ValueError(
                    "committed Evidence thread has no trusted workspace authority"
                )
            if committed_scope_key and committed_scope_key != scope_key:
                raise ValueError(
                    "workspaceRoot does not match the committed Evidence thread workspace"
                )
            staged = self._trace_staging.begin(
                thread_id=thread_id,
                target_watermark=str(target_watermark),
                trace=trace,
                committed_graph=current_graph,
                rebuild=rebuild,
            )
            incremental_trace = list(staged.trace)
            artifact_versions = ArtifactVersionProjectionClient(
                incremental_trace, workspace_roots=(project,), locator_root=workspace,
            )
            committed_projection_digest = current_graph.meta.get(
                "artifactVersionProjectionDigest"
            ) if current_graph is not None else None
            projection_digest = artifact_versions.state_digest() if incremental_trace else (
                committed_projection_digest or artifact_versions.state_digest()
            )
            no_op_against_committed = bool(
                current is not None
                and current_graph is not None
                and not rebuild
                and not incremental_trace
                and str(target_watermark) == current.input_watermark
                and committed_projection_digest == projection_digest
                and current_graph.meta.get("inputDigest")
            )
            input_digest = str(current_graph.meta["inputDigest"]) \
                if no_op_against_committed else self._update_input_digest(
                    thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                    trace=incremental_trace, workspace_root=workspace, project_root=project,
                    rebuild=rebuild, threshold=threshold,
                    access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                    artifact_version_projection_digest=projection_digest,
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
                    "accessPolicy": dict(access_policy or {}),
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
                "accessPolicy": dict(access_policy or {}),
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
                    "scopeKey": scope_key,
                    "accessPolicy": dict(access_policy or {}),
                }

                declared_execution_bundle = False
                if incremental_trace:
                    if _is_canonical_execution_bundle(incremental_trace):
                        # Parse deterministic execution lineage against the cloned
                        # committed graph.  A rerun manifest can name a baseline
                        # run from an earlier snapshot; parsing it in an empty
                        # delta graph would make that external id look dangling
                        # and silently discard rerun_of/replication edges.
                        before_nodes = set(graph.nodes)
                        before_edges = set(graph.edges)
                        lineage_delta = ingest_trace_lineage(
                            graph, incremental_trace, artifact_versions,
                            created_by="sdk-execution-lineage",
                            allowed_historical_rerun_refs=_historical_rerun_refs(
                                incremental_trace
                            ),
                        )
                        declared_execution_bundle = lineage_delta["envelopes"] > 0
                        if declared_execution_bundle:
                            graph.meta["extractionMode"] = "declared-execution-lineage"
                            graph.meta["declaredLineage"] = dict(lineage_delta)
                            delta = {
                                "new_nodes": [
                                    node_id for node_id in graph.nodes
                                    if node_id not in before_nodes
                                ],
                                "new_edges": [
                                    edge_id for edge_id in graph.edges
                                    if edge_id not in before_edges
                                ],
                            }
                    if not declared_execution_bundle:
                        if self.llm is None:
                            raise RuntimeError(
                                "no independent Model Router client configured for extraction/review"
                            )
                        extracted = extract_dag(
                            incremental_trace, self.llm, thread_id,
                            artifact_versions=artifact_versions,
                        )
                        if rebuild or base is None:
                            extracted.meta.update(graph.meta)
                            graph = extracted
                            delta = {"new_nodes": list(graph.nodes), "new_edges": list(graph.edges)}
                        else:
                            delta = graph.merge_from(extracted)
                else:
                    delta = {"new_nodes": [], "new_edges": []}

                input_digest = self._update_input_digest(
                    thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                    trace=incremental_trace, workspace_root=workspace, project_root=project,
                    rebuild=rebuild, threshold=threshold,
                    access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                    artifact_version_projection_digest=projection_digest,
                )
                graph.meta["inputDigest"] = input_digest
                graph.meta["traceIngestion"] = self._trace_staging.committed_metadata(staged)
                graph.meta["artifactVersionProjectionDigest"] = projection_digest
                status["inputDigest"] = input_digest
                self._sync_artifact_versions(graph, artifact_versions)
                self._trace_staging.persist_provisional_graph(
                    staged, graph, phase="verification",
                    temporary_edge_count=len(delta.get("new_edges") or []),
                )
                status.update({
                    "graphState": "provisional",
                    "traceStaging": staged.summary(),
                })
                self._persist_update_status(thread_id)
                if declared_execution_bundle:
                    declared_status_changes = _mark_declared_semantic_nodes(graph)
                    verification = {
                        "threshold": threshold,
                        "supports_edges_scored": 0,
                        "supports_edges_total": sum(
                            edge.rel == EdgeRel.SUPPORTS for edge in graph.edges.values()
                        ),
                        "contradicts_edges_scored": 0,
                        "status_changes": declared_status_changes,
                        "aggregates": {},
                        "mode": "declared-execution-lineage",
                        "status": "deferred",
                        "reason": "canonical_executor_records_preserved_without_model_scoring",
                    }
                    graph.meta["semanticVerification"] = {
                        "status": "deferred",
                        "reason": verification["reason"],
                    }
                elif graph.edges:
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

                semantic_edge_ids = set() if declared_execution_bundle else {
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
                if declared_execution_bundle:
                    graph.meta["adversarialReview"] = {
                        "status": "deferred",
                        "reason": "canonical_executor_records_preserved_without_model_review",
                    }
                elif self.llm is not None:
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
        threshold: float, access_policy: Optional[dict[str, Any]],
        artifact_version_projection_digest: str,
        rebuild_rationale: Optional[str],
    ) -> str:
        payload = json.dumps({
            "threadId": thread_id, "targetWatermark": target_watermark, "reason": reason,
            "trace": trace, "workspaceRoot": os.path.abspath(workspace_root),
            "projectRoot": os.path.abspath(project_root or workspace_root),
            "rebuild": rebuild, "threshold": threshold, "accessPolicy": access_policy or {},
            "rebuildRationale": rebuild_rationale,
            "schemaVersion": SCHEMA_VERSION, "extractorVersion": EXTRACTOR_VERSION,
            "verifierVersion": VERIFIER_VERSION,
            "artifactVersionProjectionDigest": artifact_version_projection_digest,
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
        result = {
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
        access_graph = committed_graph or self.provisional_graph(thread_id)
        if policy_restricted(status.get("accessPolicy")):
            synthetic = ThreadGraph(thread_id, {
                "scope": {"accessPolicy": status.get("accessPolicy")},
            })
            return project_update_status(synthetic, result)
        if access_graph is not None:
            return project_update_status(access_graph, result)
        return result

    def provisional_graph(self, thread_id: str) -> Optional[ThreadGraph]:
        """Return the isolated compile candidate, never the committed read model."""
        return self._trace_staging.provisional_graph(thread_id)

    def graph_view(self, thread_id: str) -> dict[str, Any]:
        """Return the committed graph after applying fail-closed read projection."""
        return project_graph(self.require(thread_id))

    def update_result_view(
        self, thread_id: str, result: dict[str, Any],
    ) -> dict[str, Any]:
        """Project a command response before it crosses the HTTP boundary."""
        graph = self.require(thread_id)
        update = result.get("update")
        if isinstance(update, dict) and policy_restricted(update.get("accessPolicy")):
            graph = ThreadGraph(thread_id, {
                "scope": {"accessPolicy": update.get("accessPolicy")},
            })
        return project_update_result(graph, result)

    def graph_summary(self, thread_id: str) -> dict[str, Any]:
        """Return a summary without parallel identity/cycle-path leakage."""
        return project_summary(self.require(thread_id))

    def snapshot_view(self, thread_id: str) -> dict[str, Any]:
        """Return committed snapshot metadata through the access projector."""
        graph = self.require(thread_id)
        snapshot = self.latest_snapshot(thread_id)
        if snapshot is None:
            raise KeyError(thread_id)
        return project_snapshot(graph, snapshot.to_dict())

    def provisional_graph_view(self, thread_id: str) -> Optional[dict[str, Any]]:
        """Return the staging graph after applying the same read projection."""
        graph = self.provisional_graph(thread_id)
        return project_graph(graph) if graph is not None else None

    def provisional_graph_summary(self, thread_id: str) -> Optional[dict[str, Any]]:
        graph = self.provisional_graph(thread_id)
        return project_summary(graph) if graph is not None else None

    def _sync_artifact_versions(
        self, graph: ThreadGraph, projection: ArtifactVersionProjectionClient,
    ) -> None:
        """Apply the owner domain's read-only refs/events without rewriting pins."""
        for version_id, ref in projection.refs.items():
            if version_id not in graph.artifact_versions:
                continue
            prior = graph.artifact_version_refs.get(version_id)
            if prior is not None and prior != ref:
                raise ValueError(f"conflicting immutable ArtifactVersionRef: {version_id}")
            graph.artifact_version_refs[version_id] = ref

        graph.meta["artifactVersionLifecycleWatermark"] = max(
            int(graph.meta.get("artifactVersionLifecycleWatermark") or 0),
            projection.lifecycle_last_sequence,
        )
        if projection.lifecycle_observed:
            graph.meta["artifactVersionLifecyclePending"] = projection.lifecycle_pending
        lifecycle_pending = bool(graph.meta.get("artifactVersionLifecyclePending"))

        stale_versions: set[str] = set()
        restored_versions: set[str] = set()
        review_versions: dict[str, str] = {}
        for event in projection.lifecycle_events:
            version = graph.artifact_versions.get(event.version_id)
            if event.event_type in {"artifact-missing"}:
                if version is not None:
                    version.availability = "missing"
                stale_versions.add(event.version_id)
                review_versions[event.version_id] = "artifact-missing"
            elif event.event_type in {"artifact-restored"}:
                if version is not None:
                    version.availability = "available"
                restored_versions.add(event.version_id)
            elif event.event_type == "availability-changed":
                availability = event.detail.get("availability")
                if version is not None and availability in {"available", "missing", "remote"}:
                    version.availability = availability
                if availability == "missing":
                    stale_versions.add(event.version_id)
            elif event.event_type == "artifact-content-changed":
                # A refresh event without a new committed version proves that
                # the bytes no longer match this pinned digest.
                if event.previous_version_id:
                    stale_versions.add(event.previous_version_id)
                    review_versions[event.previous_version_id] = "artifact-content-changed"
                else:
                    stale_versions.add(event.version_id)
                    review_versions[event.version_id] = "artifact-content-changed"
            elif event.event_type == "artifact-moved":
                review_versions[event.version_id] = "artifact-moved"
            elif event.event_type in {"version-committed", "current-changed"} \
                    and event.previous_version_id:
                stale_versions.add(event.previous_version_id)

        stale_roots: list[str] = []
        for node in graph.nodes.values():
            projection_status = str(
                node.attributes.get("artifactVersionProvenanceStatus") or ""
            ).strip().lower()
            if projection_status in {"pending", "failed"}:
                node.freshness = "stale"
                stale_roots.append(node.id)
                continue
            if not node.artifact_id:
                continue
            prior_review_reason = node.attributes.get("artifactVersionReviewReason")
            if lifecycle_pending:
                node.attributes["artifactVersionReviewRequired"] = True
                node.attributes["artifactVersionReviewReason"] = "lifecycle-backlog"
                node.freshness = "stale"
                stale_roots.append(node.id)
                continue
            if prior_review_reason == "lifecycle-backlog":
                node.attributes.pop("artifactVersionReviewRequired", None)
                node.attributes.pop("artifactVersionReviewReason", None)
                node.freshness = "fresh"
            projected_artifact = projection.artifacts.get(node.artifact_id)
            if projected_artifact is not None:
                graph.artifacts[projected_artifact.artifact_id] = type(projected_artifact).from_dict(
                    projected_artifact.to_dict()
                )
            artifact = graph.artifacts.get(node.artifact_id)
            referenced = graph.artifact_versions.get(node.artifact_version_id or "")
            if not artifact or not referenced:
                node.freshness = "stale"
                stale_roots.append(node.id)
                continue
            if referenced.version_id in review_versions:
                node.attributes["artifactVersionReviewRequired"] = True
                node.attributes["artifactVersionReviewReason"] = review_versions[
                    referenced.version_id
                ]
            if node.source_anchor_id and node.source_anchor_id in projection.anchors:
                anchor = projection.anchors[node.source_anchor_id]
                graph.source_anchors[anchor.anchor_id] = type(anchor).from_dict(anchor.to_dict())
            if referenced.availability == "missing" or referenced.version_id in stale_versions \
                    or artifact.current_version_id != referenced.version_id:
                node.freshness = "stale"
                stale_roots.append(node.id)
            elif node.freshness != "stale" or referenced.version_id in restored_versions \
                    or referenced.version_id in projection.refs:
                node.freshness = "fresh"
        if not stale_roots:
            return
        support_graph = graph.supports_digraph()
        stale_downstream: set[str] = set()
        for root in stale_roots:
            stale_downstream.update(descendants(support_graph, root))
        for node_id in stale_downstream:
            graph.nodes[node_id].freshness = "stale"

    # --- read models / audit side chain ----------------------------------
    def get(self, thread_id: str) -> Optional[ThreadGraph]:
        if thread_id in self._graphs:
            return self._graphs[thread_id]
        path = self._path(thread_id)
        if not path or not os.path.exists(path):
            return None
        graph = provjson.loads(read_snapshot_text(path, storage_dir=self.storage_dir))
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
            require_unrestricted(graph, "human review decision")
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
                    doc = json.loads(
                        read_snapshot_text(path, storage_dir=self.storage_dir),
                    )
                    snapshot = EvidenceSnapshot.from_dict((doc.get("edag:meta") or {}).get("snapshot") or {})
                    self._thread_id_cache[path] = (mtime, snapshot.thread_id)
                    found[snapshot.thread_id] = mtime
                except (OSError, ValueError, TypeError):
                    continue
        for thread_id in self._graphs:
            found[thread_id] = max(found.get(thread_id, 0.0), self._updated.get(thread_id, 0.0))
        return [key for key, _ in sorted(found.items(), key=lambda item: (-item[1], item[0]))]

    def list_threads_for_read(self) -> list[str]:
        """Hide restricted aggregate identities from the global thread index."""
        visible: list[str] = []
        for thread_id in self.list_threads():
            try:
                graph = self.get(thread_id)
            except (OSError, TypeError, ValueError):
                # A graph that cannot be verified is not a safe public index row.
                continue
            if graph is not None and not graph_restricted(graph):
                visible.append(thread_id)
        return visible

    def last_delta(self, thread_id: str) -> dict:
        delta = self._last_delta.get(thread_id, {"new_nodes": [], "new_edges": []})
        graph = self.get(thread_id)
        if graph is None or not graph_restricted(graph):
            return dict(delta)
        return {
            "new_node_count": len(delta.get("new_nodes") or []),
            "new_edge_count": len(delta.get("new_edges") or []),
            "accessRestricted": True,
        }

    def provenance(self, thread_id: str, node_id: str) -> dict:
        graph = self.require(thread_id)
        return project_lineage(graph, graph.provenance_path(node_id))

    def conclusion_lineage(
        self, thread_id: str, *, target_digest: str, conclusion_id: str,
    ) -> dict[str, Any]:
        graph, snapshot = self.snapshot_graph(thread_id, target_digest)
        result = graph.conclusion_lineage(conclusion_id)
        return {
            **project_lineage(graph, result),
            "snapshot": project_snapshot(graph, snapshot.to_dict()),
        }

    def rerun_spec(
        self, thread_id: str, *, target_digest: str, conclusion_id: str,
    ) -> dict[str, Any]:
        graph, snapshot = self.snapshot_graph(thread_id, target_digest)
        if lineage_restricted(graph, graph.conclusion_lineage(conclusion_id)):
            raise PermissionError("rerun export is unavailable for restricted evidence")
        return build_rerun_spec(graph, snapshot, conclusion_id)

    def compare_reruns(
        self,
        thread_id: str,
        *,
        baseline_digest: str,
        baseline_conclusion_id: str,
        candidate_digest: str,
        candidate_conclusion_id: str,
    ) -> dict[str, Any]:
        baseline_graph, baseline_snapshot = self.snapshot_graph(thread_id, baseline_digest)
        candidate_graph, candidate_snapshot = self.snapshot_graph(thread_id, candidate_digest)
        if lineage_restricted(
            baseline_graph, baseline_graph.conclusion_lineage(baseline_conclusion_id),
        ) or lineage_restricted(
            candidate_graph, candidate_graph.conclusion_lineage(candidate_conclusion_id),
        ):
            raise PermissionError("rerun comparison is unavailable for restricted evidence")
        baseline = build_rerun_spec(
            baseline_graph, baseline_snapshot, baseline_conclusion_id,
        )
        candidate = build_rerun_spec(
            candidate_graph, candidate_snapshot, candidate_conclusion_id,
        )
        return {
            "baseline": baseline,
            "candidate": candidate,
            "comparison": compare_rerun_specs(
                baseline,
                candidate,
                baseline_output_values=output_values_for_spec(baseline_graph, baseline),
                candidate_output_values=output_values_for_spec(candidate_graph, candidate),
            ),
        }

    def metrics(self, thread_id: str) -> dict:
        graph = self.require(thread_id)
        snapshot = self.latest_snapshot(thread_id)
        result = _metrics.all_metrics(
            graph,
            events=self._events_raw(thread_id=thread_id, limit=5000),
            audits=self._audit_runs_raw(thread_id),
            snapshot=snapshot.to_dict() if snapshot else None,
            snapshot_history=self._snapshot_history(thread_id),
        )
        return project_metrics(graph, result)

    def events(
        self, *, thread_id: Optional[str] = None, event_types=(),
        after_sequence: int = 0, limit: int = 500,
    ) -> list[dict[str, Any]]:
        events = self._events_raw(
            thread_id=thread_id, event_types=event_types,
            after_sequence=after_sequence, limit=limit,
        )
        return [
            project_event(event, restricted=self._event_restricted(event))
            for event in events
        ]

    def _events_raw(
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

    def _event_restricted(self, event: dict[str, Any]) -> bool:
        """Resolve event access from its owning thread/artifact; unknown is closed."""
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        thread_id = payload.get("threadId")
        if not isinstance(thread_id, str) and event.get("aggregateType") == "EvidenceThread":
            thread_id = event.get("aggregateId")
        if isinstance(thread_id, str) and thread_id:
            try:
                graph = self.get(thread_id)
            except (OSError, TypeError, ValueError):
                return True
            return graph is None or graph_restricted(graph)

        artifact_id = payload.get("artifactId")
        if not isinstance(artifact_id, str) and event.get("aggregateType") == "Artifact":
            artifact_id = event.get("aggregateId")
        if isinstance(artifact_id, str) and artifact_id:
            found = False
            for graph_thread_id in self.list_threads():
                try:
                    graph = self.get(graph_thread_id)
                except (OSError, TypeError, ValueError):
                    return True
                if graph is None or artifact_id not in graph.artifacts:
                    continue
                found = True
                if artifact_restricted(graph, artifact_id):
                    return True
            # Lifecycle payloads contain absolute paths.  If ownership cannot be
            # reconstructed after restart, do not guess that they are public.
            return not found
        # Global/system events have no graph from which a public grant can be
        # established.  Their payload is opaque unless an owner resolves.
        return True

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
                        graph = provjson.loads(
                            read_snapshot_text(path, storage_dir=self.storage_dir),
                        )
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
        graph = self.require(thread_id)
        require_unrestricted(graph, "analysis")
        return _analysis.analyze(graph, threshold=threshold)

    def reconcile(self, thread_id: str, *, remove_nodes=(), remove_edges=(),
                  add_contradicts=(), threshold: float = 0.7) -> dict:
        graph = self.require(thread_id)
        require_unrestricted(graph, "reconcile preview")
        return _reconcile.reconcile(
            graph, remove_nodes=remove_nodes, remove_edges=remove_edges,
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
        graph = provjson.loads(
            read_snapshot_text(matches[0], storage_dir=self.storage_dir),
        )
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

        if scope_restricted(graph):
            return {
                "resolved": False,
                "code": "access_restricted",
                "message": "Evidence preview is unavailable under the current access policy.",
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
        if artifact_restricted(graph, assertion.artifact_id):
            return {
                "resolved": False,
                "code": "access_restricted",
                "message": "Evidence preview is unavailable under the current access policy.",
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
        require_unrestricted(graph, "audit")
        if trigger == "auto":
            existing = next((
                run for run in self._audit_runs_raw(thread_id)
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
        runs = [run, *self._audit_runs_raw(thread_id)]
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
        graph = self.require(thread_id)
        require_unrestricted(graph, "audit history")
        return self._audit_runs_raw(thread_id)

    def _audit_runs_raw(self, thread_id: str) -> list[dict]:
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
        graph = self.require(thread_id)
        return project_prov_json(graph, provjson.to_prov_json(graph))

    def export_snapshot_products(
        self,
        thread_id: str,
        *,
        snapshot_digest: str,
        datacite_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Project one exact historical snapshot without consulting current/latest."""
        graph, snapshot = self.snapshot_graph(thread_id, snapshot_digest)
        return _export_snapshot_products(graph, snapshot, datacite_metadata)

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
            if read_snapshot_text(immutable_path, storage_dir=self.storage_dir) != content:
                raise RuntimeError("immutable Evidence Snapshot collision")
        else:
            write_snapshot(immutable_path, content, storage_dir=self.storage_dir)
        atomic_publish_latest(immutable_path, latest_path)

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
