"""Append-only evidence ledger for Computer Use runs."""

from __future__ import annotations

import json
import re
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlsplit


EVIDENCE_RECORD_SCHEMA_VERSION = "sciforge.computer-use.evidence-record.v1"
EVIDENCE_INDEX_SCHEMA_VERSION = "sciforge.computer-use.evidence-index.v1"
EVIDENCE_SNAPSHOT_SCHEMA_VERSION = "sciforge.computer-use.evidence-snapshot.v1"
PLANNER_BRIEF_SCHEMA_VERSION = "sciforge.computer-use.planner-brief.v1"

EVIDENCE_RECORD_TYPES = {
    "observation",
    "region",
    "text",
    "visual-object",
    "vlm-claim",
    "grounding",
    "action",
    "verification",
    "artifact",
    "uncertainty",
    "completion-claim",
}
VISIBLE_STATE_EVIDENCE_TYPES = {
    "observation",
    "region",
    "text",
    "visual-object",
    "vlm-claim",
    "grounding",
}
STATE_CHANGING_ACTION_KINDS = {
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "focus",
    "save",
    "hover",
    "open_menu",
    "open_dropdown",
    "switch_tab",
    "switch_window",
    "switch_panel",
    "zoom",
    "page_down",
    "page_up",
}
READ_ONLY_EVIDENCE_ACTION_KINDS = {
    "recapture",
    "wait_until_stable",
    "crop",
    "ocr",
    "vlm_describe",
    "vlm_compare",
    "region_detection",
    "visual_table_inspection",
    "visual_image_inspection",
}
REDACTED_VALUE = "[REDACTED]"
SAFE_LEDGER_REF_SCHEMES = {"artifact", "trace", "approval"}
SAFE_LOCAL_REF_SUFFIXES = {
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".htm",
    ".html",
    ".jpeg",
    ".jpg",
    ".json",
    ".jsonl",
    ".log",
    ".md",
    ".ods",
    ".odt",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".tsv",
    ".txt",
    ".webp",
    ".xls",
    ".xlsx",
}
ARTIFACT_REF_SUFFIXES = {
    ".csv",
    ".doc",
    ".docx",
    ".json",
    ".jsonl",
    ".md",
    ".ods",
    ".odt",
    ".pdf",
    ".ppt",
    ".pptx",
    ".tsv",
    ".txt",
    ".xls",
    ".xlsx",
}
REF_KEY_NAMES = {
    "artifactref",
    "artifactrefs",
    "captureref",
    "capturerefs",
    "dataref",
    "datarefs",
    "evidenceref",
    "evidencerefs",
    "filelistartifactref",
    "filelistartifactrefs",
    "fileref",
    "filerefs",
    "finalartifactref",
    "finalartifactrefs",
    "outputref",
    "outputrefs",
    "path",
    "paths",
    "ref",
    "refs",
    "screenshotref",
    "screenshotrefs",
    "traceref",
    "tracerefs",
    "approvalref",
    "approvalrefs",
}
SENSITIVE_KEY_NAMES = {
    "authorization",
    "authheader",
    "base64",
    "body",
    "credential",
    "credentials",
    "dataurl",
    "header",
    "headers",
    "password",
    "payload",
    "raw",
    "rawbody",
    "rawpayload",
    "secret",
    "token",
}
DATA_URL_RE = re.compile(r"data:[^\s\"'<>]+", re.IGNORECASE)
HTTP_QUERY_URL_RE = re.compile(r"https?://[^\s\"'<>?]+\?[^\s\"'<>]+", re.IGNORECASE)
AUTHORIZATION_RE = re.compile(
    r"\bauthorization\s*[:=]\s*(?:bearer|basic)?\s*[^\s,;}\]]+",
    re.IGNORECASE,
)
SECRET_ASSIGNMENT_RE = re.compile(
    r"\b(?:api[_-]?key|access[_-]?key|refresh[_-]?token|token|secret|password|credential)s?\s*[:=]\s*[^\s,;}\]]+",
    re.IGNORECASE,
)
BEARER_TOKEN_RE = re.compile(r"\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
SENSITIVE_WORD_RE = re.compile(
    r"\b(?:authorization|api[_-]?key|access[_-]?key|token|secret|password|credential)s?\b",
    re.IGNORECASE,
)
BASE64_BLOB_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


class EvidenceLedger:
    """Small append-only ledger with rebuildable index/snapshot artifacts."""

    def __init__(self, output_dir: str | Path | None = None, *, run_id: str | None = None) -> None:
        self.output_dir = Path(output_dir).expanduser().resolve() if output_dir else None
        self.run_id = run_id or (self.output_dir.name if self.output_dir else "in-memory")
        self.records: list[dict[str, Any]] = []
        if self.output_dir is not None:
            self.output_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_request(cls, request: Any) -> "EvidenceLedger":
        metadata = _mapping(getattr(request, "metadata", None))
        output_dir = _first_string(
            metadata.get("evidenceOutputDir"),
            metadata.get("evidence_output_dir"),
            metadata.get("evidenceLedgerDir"),
            metadata.get("evidence_ledger_dir"),
            metadata.get("traceOutputDir"),
            metadata.get("trace_output_dir"),
        )
        run_id = _first_string(metadata.get("runId"), metadata.get("run_id"))
        return cls(output_dir, run_id=run_id)

    @property
    def log_ref(self) -> str | None:
        return str(self.output_dir / "evidence-log.jsonl") if self.output_dir else None

    @property
    def snapshot_ref(self) -> str | None:
        return str(self.output_dir / "evidence-snapshot.json") if self.output_dir else None

    @property
    def index_ref(self) -> str | None:
        return str(self.output_dir / "evidence-index.json") if self.output_dir else None

    @property
    def planner_brief_ref(self) -> str | None:
        return str(self.output_dir / "planner-brief.json") if self.output_dir else None

    def append_record(
        self,
        record_type: str,
        *,
        loop_phase: str,
        action_index: int | None = None,
        ref: str | None = None,
        refs: Sequence[str] | None = None,
        summary: str = "",
        confidence: float | None = None,
        tags: Sequence[str] | None = None,
        current: bool = True,
        derived_from: Sequence[str] | None = None,
        supports: Sequence[str] | None = None,
        contradicts: Sequence[str] | None = None,
        used_for_action: Sequence[str] | None = None,
        verified_by: Sequence[str] | None = None,
        invalidates: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> str:
        if record_type not in EVIDENCE_RECORD_TYPES:
            raise ValueError(f"Unsupported evidence record type: {record_type!r}.")
        record_id = f"ev-{len(self.records) + 1:06d}"
        safe_ref = _safe_ref_or_none(ref, allow_absolute_local=True)
        safe_refs = _safe_refs([*(refs or []), *([safe_ref] if safe_ref else [])], allow_absolute_local=True)
        record = {
            "schemaVersion": EVIDENCE_RECORD_SCHEMA_VERSION,
            "id": record_id,
            "sequence": len(self.records) + 1,
            "runId": self.run_id,
            "type": record_type,
            "loopPhase": loop_phase,
            "actionIndex": action_index,
            "ref": safe_ref,
            "refs": safe_refs,
            "summary": _redact_ledger_payload(summary),
            "confidence": confidence,
            "tags": _unique_strings(_redact_ledger_payload(list(tags or []))),
            "current": bool(current),
            "derivedFrom": _unique_strings(derived_from or []),
            "supports": _unique_strings(supports or []),
            "contradicts": _unique_strings(contradicts or []),
            "usedForAction": _unique_strings(used_for_action or []),
            "verifiedBy": _unique_strings(verified_by or []),
            "invalidates": _unique_strings(invalidates or []),
            "metadata": _redact_ledger_payload(_json_safe(dict(metadata or {}))),
        }
        record = _redact_ledger_payload(record)
        scope = _scope_from_value(record)
        if scope:
            record["scope"] = scope
        record["ref"] = _safe_ref_or_none(record.get("ref"), allow_absolute_local=True)
        record["refs"] = _safe_refs(record.get("refs"), allow_absolute_local=True)
        self.records.append(record)
        self.write()
        return record_id

    def append_observation(self, observation: Any, *, action_index: int | None, query: str | None) -> str:
        ref = str(getattr(observation, "ref", "") or "")
        artifacts = _mapping(getattr(observation, "artifacts", None))
        metadata = _mapping(getattr(observation, "metadata", None))
        observation_scope = _scope_from_value({
            "windowTarget": _json_safe(getattr(observation, "window_target", None)),
            "metadata": metadata,
        })
        record_id = self.append_record(
            "observation",
            loop_phase="evidence",
            action_index=action_index,
            ref=ref,
            refs=_refs_from_value({"artifacts": artifacts, "metadata": metadata}),
            summary=str(getattr(observation, "summary", "") or ""),
            tags=["current-observation"],
            metadata={
                "query": query,
                "windowTarget": _json_safe(getattr(observation, "window_target", None)),
                "artifacts": artifacts,
                "observationMetadata": metadata,
                "provenance": observation_scope,
            },
        )
        for text_index, text in enumerate(getattr(observation, "visible_texts", ()) or ()):
            self.append_record(
                "text",
                loop_phase="evidence",
                action_index=action_index,
                summary=str(text),
                tags=["visible-text"],
                derived_from=[record_id],
                metadata={"textIndex": text_index, "provenance": observation_scope},
            )
        for artifact_ref in _artifact_refs_from_observation(observation):
            self.append_record(
                "artifact",
                loop_phase="evidence",
                action_index=action_index,
                ref=artifact_ref,
                refs=[artifact_ref],
                summary="Artifact/file evidence from current observation.",
                tags=["artifact-evidence"],
                derived_from=[record_id],
                metadata={"provenance": observation_scope},
            )
        return record_id

    def append_grounding(
        self,
        grounding: Any,
        *,
        action_index: int,
        observation_record_id: str | None,
        target_description: str,
    ) -> str:
        ok = bool(getattr(grounding, "ok", False))
        return self.append_record(
            "grounding",
            loop_phase="action",
            action_index=action_index,
            summary=str(getattr(grounding, "reason", "") or target_description),
            confidence=getattr(grounding, "confidence", None),
            tags=["grounding", "grounding-ok" if ok else "grounding-failed"],
            derived_from=[observation_record_id] if observation_record_id else [],
            metadata={
                "ok": ok,
                "targetDescription": target_description,
                "x": getattr(grounding, "x", None),
                "y": getattr(grounding, "y", None),
                "coordinateSpace": getattr(grounding, "coordinate_space", None),
                "groundingMetadata": _mapping(getattr(grounding, "metadata", None)),
                "provenance": _scope_from_value(_mapping(getattr(grounding, "metadata", None))),
            },
        )

    def append_action(
        self,
        action: Any,
        execution: Any | None,
        *,
        action_index: int,
        before_record_id: str | None,
        grounding_record_id: str | None,
        observation_only: bool = False,
    ) -> str:
        action_kind = str(getattr(action, "kind", "") or "")
        mutates_screen = action_mutates_visible_state(action_kind, observation_only=observation_only)
        action_scope = _scope_from_value({
            "actionMetadata": _mapping(getattr(action, "metadata", None)),
            "execution": _json_safe(execution),
        })
        invalidates = self.current_visible_record_ids(scope=action_scope) if mutates_screen else []
        return self.append_record(
            "action",
            loop_phase="action",
            action_index=action_index,
            summary=_action_summary(action, execution),
            tags=["action", f"action:{action_kind}", "state-changing" if mutates_screen else "read-only"],
            derived_from=[ref for ref in (before_record_id, grounding_record_id) if ref],
            used_for_action=[before_record_id] if before_record_id else [],
            invalidates=invalidates,
            metadata={
                "actionKind": action_kind,
                "target": _json_safe(getattr(action, "target", None)),
                "textPresent": bool(getattr(action, "text", None)),
                "key": getattr(action, "key", None),
                "keys": list(getattr(action, "keys", ()) or ()),
                "direction": getattr(action, "direction", None),
                "amount": getattr(action, "amount", None),
                "actionMetadata": _mapping(getattr(action, "metadata", None)),
                "observationOnly": bool(observation_only),
                "mutatesScreen": mutates_screen,
                "execution": _json_safe(execution),
                "scope": action_scope,
            },
        )

    def append_verification(
        self,
        verification: Any,
        *,
        action_index: int,
        action_record_id: str | None,
        after_record_id: str | None,
    ) -> str:
        ok = bool(getattr(verification, "ok", False))
        done = bool(getattr(verification, "done", False))
        return self.append_record(
            "verification",
            loop_phase="action",
            action_index=action_index,
            summary=str(getattr(verification, "reason", "") or ""),
            confidence=getattr(verification, "confidence", None),
            tags=["verification", "verification-ok" if ok else "verification-failed", "done" if done else "not-done"],
            derived_from=[ref for ref in (action_record_id, after_record_id) if ref],
            verified_by=[after_record_id] if after_record_id else [],
            metadata={
                "ok": ok,
                "done": done,
                "changed": getattr(verification, "changed", None),
                "verificationMetadata": _mapping(getattr(verification, "metadata", None)),
                "provenance": _scope_from_value(_mapping(getattr(verification, "metadata", None))),
            },
        )

    def append_uncertainty(
        self,
        *,
        action_index: int | None,
        summary: str,
        tags: Sequence[str] | None = None,
        derived_from: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> str:
        return self.append_record(
            "uncertainty",
            loop_phase="task",
            action_index=action_index,
            summary=summary,
            tags=["blocking", *(tags or [])],
            derived_from=derived_from or [],
            metadata=metadata,
        )

    def append_completion_claim(
        self,
        *,
        action_index: int | None,
        summary: str,
        status: str,
        supports: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> str:
        return self.append_record(
            "completion-claim",
            loop_phase="task",
            action_index=action_index,
            summary=summary,
            tags=["completion", f"completion:{status}"],
            supports=supports or [],
            metadata={"status": status, **dict(metadata or {})},
        )

    def current_visible_record_ids(self, *, scope: Mapping[str, Any] | None = None) -> list[str]:
        index = build_evidence_index(self.records)
        current_ids = set(index["current"])
        return [
            record["id"]
            for record in self.records
            if record["id"] in current_ids and record["type"] in VISIBLE_STATE_EVIDENCE_TYPES
            and _scope_matches_invalidation(_record_scope(record), _normalized_scope(scope))
        ]

    def planner_brief(self) -> dict[str, Any]:
        return build_planner_brief(self.records)

    def refs(self) -> dict[str, str]:
        refs = {
            "evidenceLogRef": self.log_ref,
            "evidenceSnapshotRef": self.snapshot_ref,
            "evidenceIndexRef": self.index_ref,
            "plannerBriefRef": self.planner_brief_ref,
        }
        return {key: value for key, value in refs.items() if value}

    def result_diagnostics(self) -> dict[str, Any]:
        refs = self.refs()
        if not refs:
            return {
                "evidenceRecordCount": len(self.records),
                "evidenceLedgerSchemaVersion": EVIDENCE_RECORD_SCHEMA_VERSION,
            }
        return {
            **refs,
            "evidenceRecordCount": len(self.records),
            "evidenceLedgerSchemaVersion": EVIDENCE_RECORD_SCHEMA_VERSION,
        }

    def write(self) -> None:
        if self.output_dir is None:
            return
        log_path = self.output_dir / "evidence-log.jsonl"
        log_path.write_text(
            "".join(f"{json.dumps(record, sort_keys=True)}\n" for record in self.records),
            encoding="utf8",
        )
        _write_json(self.output_dir / "evidence-index.json", build_evidence_index(self.records))
        _write_json(self.output_dir / "evidence-snapshot.json", build_evidence_snapshot(self.records))
        _write_json(self.output_dir / "planner-brief.json", self.planner_brief())


def action_mutates_visible_state(action_kind: str, *, observation_only: bool = False) -> bool:
    normalized = action_kind.strip().lower().replace("-", "_")
    if observation_only or normalized in READ_ONLY_EVIDENCE_ACTION_KINDS:
        return False
    return normalized in STATE_CHANGING_ACTION_KINDS


def build_evidence_index(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    by_type: dict[str, list[str]] = {}
    by_ref: dict[str, list[str]] = {}
    by_action_index: dict[str, list[str]] = {}
    by_tag: dict[str, list[str]] = {}
    by_scope: dict[str, list[str]] = {}
    stale_by: dict[str, str] = {}
    stale_by_scope: dict[str, dict[str, str]] = {}
    record_ids: list[str] = []
    for record in records:
        record_id = str(record.get("id") or "")
        if not record_id:
            continue
        record_ids.append(record_id)
        by_type.setdefault(str(record.get("type") or ""), []).append(record_id)
        action_index = record.get("actionIndex")
        if action_index is not None:
            by_action_index.setdefault(str(action_index), []).append(record_id)
        for tag in _string_list(record.get("tags")):
            by_tag.setdefault(tag, []).append(record_id)
        for ref in _record_refs(record):
            by_ref.setdefault(ref, []).append(record_id)
        scope_key = _scope_key(_record_scope(record))
        if scope_key:
            by_scope.setdefault(scope_key, []).append(record_id)
        for invalidated in _string_list(record.get("invalidates")):
            stale_by[invalidated] = record_id
            invalidated_scope_key = _scope_key(_record_scope(_record_by_id(records, invalidated)))
            if invalidated_scope_key:
                stale_by_scope.setdefault(invalidated_scope_key, {})[invalidated] = record_id
    current = [
        record_id
        for record_id in record_ids
        if record_id not in stale_by and _record_by_id(records, record_id).get("current", True) is True
    ]
    current_by_scope: dict[str, list[str]] = {}
    for record_id in current:
        scope_key = _scope_key(_record_scope(_record_by_id(records, record_id)))
        if scope_key:
            current_by_scope.setdefault(scope_key, []).append(record_id)
    return {
        "schemaVersion": EVIDENCE_INDEX_SCHEMA_VERSION,
        "recordCount": len(record_ids),
        "current": current,
        "staleBy": stale_by,
        "staleByScope": stale_by_scope,
        "currentByScope": current_by_scope,
        "byType": by_type,
        "byRef": by_ref,
        "byActionIndex": by_action_index,
        "byTag": by_tag,
        "byScope": by_scope,
    }


def build_evidence_snapshot(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    index = build_evidence_index(records)
    current_ids = set(index["current"])
    current_records = [dict(record) for record in records if record.get("id") in current_ids]
    latest_observation = _latest_record(current_records, "observation")
    latest_observation_by_scope: dict[str, Any] = {}
    current_text_by_scope: dict[str, list[str]] = {}
    current_objects_by_scope: dict[str, list[dict[str, Any] | None]] = {}
    for record in current_records:
        scope_key = _scope_key(_record_scope(record))
        if not scope_key:
            continue
        if record.get("type") == "observation":
            latest_observation_by_scope[scope_key] = _brief_record(record)
        if record.get("type") == "text":
            current_text_by_scope.setdefault(scope_key, []).append(record.get("summary"))
        if record.get("type") == "visual-object":
            current_objects_by_scope.setdefault(scope_key, []).append(_brief_record(record))
    return {
        "schemaVersion": EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
        "recordCount": len(records),
        "currentRecordCount": len(current_records),
        "latestObservation": _brief_record(latest_observation),
        "latestObservationByScope": latest_observation_by_scope,
        "currentRecords": [_brief_record(record) for record in current_records],
        "currentText": [record.get("summary") for record in current_records if record.get("type") == "text"],
        "currentTextByScope": current_text_by_scope,
        "currentObjects": [_brief_record(record) for record in current_records if record.get("type") == "visual-object"],
        "currentObjectsByScope": current_objects_by_scope,
        "artifactEvidence": [_brief_record(record) for record in current_records if record.get("type") == "artifact"],
        "blockingUncertainty": [
            _brief_record(record)
            for record in current_records
            if record.get("type") == "uncertainty" and "blocking" in _string_list(record.get("tags"))
        ],
        "completionClaims": [_brief_record(record) for record in current_records if record.get("type") == "completion-claim"],
        "staleRecordIds": sorted(index["staleBy"]),
    }


def build_planner_brief(
    records: Sequence[Mapping[str, Any]],
    *,
    recent_action_limit: int = 5,
    scope: Mapping[str, Any] | None = None,
    screen_id: str | None = None,
    window_id: str | None = None,
) -> dict[str, Any]:
    requested_scope = _normalized_scope(scope or {"screenId": screen_id, "windowId": window_id})
    snapshot = build_evidence_snapshot(records)
    current_records = [
        record
        for record in records
        if record.get("id") in set(build_evidence_index(records)["current"])
        and _scope_matches_query(_record_scope(record), requested_scope)
    ]
    recent_actions = [
        _brief_record(record)
        for record in records
        if record.get("type") == "action" and _scope_matches_query(_record_scope(record), requested_scope)
    ][-recent_action_limit:]
    candidate_targets = [
        _brief_record(record)
        for record in current_records
        if record.get("type") in {"visual-object", "grounding"}
    ]
    completion_claims = [record for record in current_records if record.get("type") == "completion-claim"]
    blocking_uncertainty = snapshot["blockingUncertainty"]
    completion_gaps: list[str] = []
    if not completion_claims:
        completion_gaps.append("No current completion-claim evidence.")
    if blocking_uncertainty:
        completion_gaps.append("Blocking uncertainty remains current.")
    return {
        "schemaVersion": PLANNER_BRIEF_SCHEMA_VERSION,
        "scope": requested_scope,
        "latestObservation": _brief_record(_latest_record(current_records, "observation")) if requested_scope else snapshot["latestObservation"],
        "latestObservationByScope": snapshot["latestObservationByScope"],
        "currentText": snapshot["currentText"][:20],
        "currentTextForScope": [record.get("summary") for record in current_records if record.get("type") == "text"][:20],
        "currentObjects": snapshot["currentObjects"][:20],
        "currentObjectsForScope": [_brief_record(record) for record in current_records if record.get("type") == "visual-object"][:20],
        "candidateTargets": candidate_targets[-20:],
        "blockingUncertainty": blocking_uncertainty[-10:],
        "recentActions": recent_actions,
        "artifactEvidence": snapshot["artifactEvidence"][-20:],
        "completionGaps": completion_gaps,
    }


def _artifact_refs_from_observation(observation: Any) -> list[str]:
    return _unique_strings(
        ref
        for ref in _refs_from_value(
            {
                "artifacts": getattr(observation, "artifacts", None),
                "metadata": getattr(observation, "metadata", None),
            }
        )
        if _looks_like_artifact_ref(ref)
    )


def _action_summary(action: Any, execution: Any | None) -> str:
    kind = str(getattr(action, "kind", "") or "")
    reason = str(getattr(action, "reason", "") or "")
    message = str(getattr(execution, "message", "") or "") if execution is not None else ""
    return "; ".join(part for part in [kind, reason, message] if part)


def _brief_record(record: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "id": record.get("id"),
        "type": record.get("type"),
        "actionIndex": record.get("actionIndex"),
        "ref": record.get("ref"),
        "refs": _record_refs(record),
        "summary": record.get("summary"),
        "confidence": record.get("confidence"),
        "tags": _string_list(record.get("tags")),
        "scope": _record_scope(record),
        "derivedFrom": _string_list(record.get("derivedFrom")),
        "supports": _string_list(record.get("supports")),
    }


def _latest_record(records: Sequence[Mapping[str, Any]], record_type: str) -> Mapping[str, Any] | None:
    for record in reversed(records):
        if record.get("type") == record_type:
            return record
    return None


def _record_by_id(records: Sequence[Mapping[str, Any]], record_id: str) -> Mapping[str, Any]:
    for record in records:
        if record.get("id") == record_id:
            return record
    return {}


def _record_refs(record: Mapping[str, Any]) -> list[str]:
    return _unique_strings([
        *(_string_list(record.get("refs"))),
        *([str(record.get("ref"))] if isinstance(record.get("ref"), str) else []),
    ])


def _record_scope(record: Mapping[str, Any]) -> dict[str, str]:
    return _normalized_scope(record.get("scope") if isinstance(record.get("scope"), Mapping) else _scope_from_value(record))


def _scope_from_value(value: Any) -> dict[str, str]:
    found: dict[str, str] = {}
    _collect_scope_fields(value, found)
    return _normalized_scope(found)


def _collect_scope_fields(value: Any, found: dict[str, str]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = _normalize_ledger_key(key)
            if normalized in {"screenid", "screen"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("screenId", str(item).strip())
            elif normalized in {"windowid", "window"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("windowId", str(item).strip())
            elif normalized in {"actorid", "actor"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("actorId", str(item).strip())
            elif normalized in {"cursorid", "cursor"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("cursorId", str(item).strip())
            elif normalized in {"scopetype", "leasescope", "targetscope"} and isinstance(item, str) and item.strip():
                found.setdefault("scopeType", item.strip())
            if isinstance(item, (Mapping, list, tuple)):
                _collect_scope_fields(item, found)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_scope_fields(item, found)


def _normalized_scope(scope: Mapping[str, Any] | None) -> dict[str, str]:
    if not isinstance(scope, Mapping):
        return {}
    screen_id = _first_scope_string(scope, "screenId", "screen_id", "screen")
    window_id = _first_scope_string(scope, "windowId", "window_id", "window")
    actor_id = _first_scope_string(scope, "actorId", "actor_id", "actor")
    cursor_id = _first_scope_string(scope, "cursorId", "cursor_id", "cursor")
    scope_type = _first_scope_string(scope, "scopeType", "scope_type", "scope", "type")
    if not scope_type:
        scope_type = "window" if window_id else ("screen" if screen_id else "")
    scope_type = scope_type.strip().lower().replace("_", "-")
    if scope_type == "screen-global":
        scope_type = "screen"
    if scope_type == "window-local":
        scope_type = "window"
    normalized: dict[str, str] = {}
    if scope_type in {"screen", "window"}:
        normalized["scopeType"] = scope_type
    if screen_id:
        normalized["screenId"] = screen_id
    if window_id:
        normalized["windowId"] = window_id
        normalized.setdefault("scopeType", "window")
    if actor_id:
        normalized["actorId"] = actor_id
    if cursor_id:
        normalized["cursorId"] = cursor_id
    if normalized.get("scopeType") == "window" and not normalized.get("windowId"):
        normalized["scopeType"] = "screen" if normalized.get("screenId") else normalized["scopeType"]
    return normalized


def _first_scope_string(scope: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = scope.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    return None


def _scope_key(scope: Mapping[str, Any]) -> str:
    normalized = _normalized_scope(scope)
    screen_id = normalized.get("screenId")
    window_id = normalized.get("windowId")
    if screen_id and window_id:
        return f"screen:{screen_id}/window:{window_id}"
    if screen_id:
        return f"screen:{screen_id}"
    return ""


def _scope_matches_invalidation(record_scope: Mapping[str, Any], action_scope: Mapping[str, Any]) -> bool:
    action = _normalized_scope(action_scope)
    record = _normalized_scope(record_scope)
    if not action:
        return True
    action_screen = action.get("screenId")
    action_window = action.get("windowId")
    record_screen = record.get("screenId")
    record_window = record.get("windowId")
    if action_screen and record_screen and action_screen != record_screen:
        return False
    if action_screen and not record_screen:
        return True
    if action_window and record_window and action_window != record_window:
        return False
    return True


def _scope_matches_query(record_scope: Mapping[str, Any], requested_scope: Mapping[str, Any]) -> bool:
    requested = _normalized_scope(requested_scope)
    if not requested:
        return True
    record = _normalized_scope(record_scope)
    if requested.get("screenId") and record.get("screenId") != requested.get("screenId"):
        return False
    if requested.get("windowId") and record.get("windowId") != requested.get("windowId"):
        return False
    return True


def _refs_from_value(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, str):
        refs.extend(_safe_refs([value]))
    elif isinstance(value, Mapping):
        for key, item in value.items():
            if _is_ref_key(key) and not _is_sensitive_key(key):
                refs.extend(_safe_refs(_candidate_ref_strings(item)))
            if isinstance(item, (Mapping, list, tuple)):
                refs.extend(_refs_from_value(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_from_value(item))
    return _unique_strings(refs)


def _looks_like_artifact_ref(ref: str) -> bool:
    safe_ref = _safe_ref_or_none(ref)
    if not safe_ref:
        return False
    parts = urlsplit(safe_ref)
    if parts.scheme.lower() == "artifact":
        return True
    return Path(safe_ref.replace("\\", "/")).suffix.lower() in ARTIFACT_REF_SUFFIXES


def _redact_ledger_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        redacted_fields = 0
        result: dict[str, Any] = {}
        for key, item in value.items():
            if _is_sensitive_key(key):
                redacted_fields += 1
                continue
            result[str(key)] = _redact_ledger_payload(item)
        if redacted_fields:
            result["redactedFieldCount"] = redacted_fields
        return result
    if isinstance(value, (list, tuple)):
        return [_redact_ledger_payload(item) for item in value]
    if isinstance(value, str):
        return _redact_sensitive_text(value)
    return value


def _redact_sensitive_text(value: str) -> str:
    text = value
    text = DATA_URL_RE.sub(REDACTED_VALUE, text)
    text = HTTP_QUERY_URL_RE.sub(REDACTED_VALUE, text)
    text = AUTHORIZATION_RE.sub(REDACTED_VALUE, text)
    text = SECRET_ASSIGNMENT_RE.sub(REDACTED_VALUE, text)
    text = BEARER_TOKEN_RE.sub(REDACTED_VALUE, text)
    stripped = text.strip()
    if ";base64," in stripped.lower() or _looks_like_base64_blob(stripped):
        return REDACTED_VALUE
    if SENSITIVE_WORD_RE.search(stripped):
        return REDACTED_VALUE
    return text


def _safe_refs(values: Any, *, allow_absolute_local: bool = False) -> list[str]:
    if isinstance(values, str):
        candidates: Sequence[Any] = [values]
    elif isinstance(values, Sequence):
        candidates = values
    else:
        candidates = []
    return _unique_strings(
        ref
        for value in candidates
        for ref in [_safe_ref_or_none(value, allow_absolute_local=allow_absolute_local)]
        if ref
    )


def _safe_ref_or_none(value: Any, *, allow_absolute_local: bool = False) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or _has_unsafe_ref_payload(text):
        return None
    parts = urlsplit(text)
    if parts.scheme:
        scheme = parts.scheme.lower()
        if scheme not in SAFE_LEDGER_REF_SCHEMES:
            return None
        if parts.query or not (parts.netloc or parts.path):
            return None
        return text
    if allow_absolute_local and _is_local_absolute_file_ref(text):
        return text
    if _is_local_relative_file_ref(text):
        return text
    return None


def _has_unsafe_ref_payload(text: str) -> bool:
    lowered = text.lower()
    if any(character in text for character in ("\n", "\r", "\x00")):
        return True
    if len(text) > 2048:
        return True
    if lowered.startswith(("data:", "http://", "https://", "www.")):
        return True
    if ";base64," in lowered or "data:image/" in lowered:
        return True
    if "?" in text or "#" in text:
        return True
    if AUTHORIZATION_RE.search(text) or SECRET_ASSIGNMENT_RE.search(text) or BEARER_TOKEN_RE.search(text):
        return True
    if SENSITIVE_WORD_RE.search(text):
        return True
    return _looks_like_base64_blob(text)


def _is_local_relative_file_ref(text: str) -> bool:
    if text.startswith(("/", "\\", "~")) or "://" in text:
        return False
    normalized = text.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if not parts or any(part == ".." for part in parts):
        return False
    return Path(parts[-1]).suffix.lower() in SAFE_LOCAL_REF_SUFFIXES


def _is_local_absolute_file_ref(text: str) -> bool:
    if text.startswith(("//", "\\\\")):
        return False
    return Path(text).is_absolute() and Path(text).suffix.lower() in SAFE_LOCAL_REF_SUFFIXES


def _candidate_ref_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        refs: list[str] = []
        for item in value.values():
            refs.extend(_candidate_ref_strings(item))
        return refs
    if isinstance(value, (list, tuple)):
        refs = []
        for item in value:
            refs.extend(_candidate_ref_strings(item))
        return refs
    return []


def _is_ref_key(key: Any) -> bool:
    normalized = _normalize_ledger_key(key)
    return normalized in REF_KEY_NAMES or normalized.endswith("ref") or normalized.endswith("refs")


def _is_sensitive_key(key: Any) -> bool:
    normalized = _normalize_ledger_key(key)
    if normalized in SENSITIVE_KEY_NAMES:
        return True
    if any(token in normalized for token in ("authorization", "password", "credential", "secret", "token")):
        return True
    if any(token in normalized for token in ("apikey", "accesskey", "privatekey", "base64", "dataurl")):
        return True
    if "header" in normalized:
        return True
    if normalized.endswith("body") or normalized.startswith("raw"):
        return True
    return normalized == "payload" or normalized.startswith("rawpayload") or normalized.endswith("payload")


def _normalize_ledger_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _looks_like_base64_blob(text: str) -> bool:
    compact = "".join(text.split())
    if len(compact) < 32 or len(compact) % 4 != 0:
        return False
    if not BASE64_BLOB_RE.match(compact):
        return False
    return any(character in compact for character in "+/=")


def _json_safe(value: Any) -> Any:
    if is_dataclass(value):
        return {field.name: _json_safe(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if isinstance(item, (str, int, float)) and str(item)]
    return []


def _first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return None


def _unique_strings(values: Sequence[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf8")
