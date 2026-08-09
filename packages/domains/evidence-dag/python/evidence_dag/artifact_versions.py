"""Read-only ArtifactVersion projections consumed by Evidence compilation.

Artifact identity, version creation, content retention, and lifecycle events are
owned by ``@sciforge/domain-artifact-versions``.  This module validates the
public v1 projection carried in runtime trace items and builds an immutable
Evidence snapshot projection.  It never creates an Artifact or ArtifactVersion
identity and never writes an Artifact registry.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

from .model import Artifact, ArtifactVersion, SourceAnchor, SourceSelector, normalize_sha256

_REF_KEYS = {
    "artifactId", "versionId", "contentDigest", "byteLength", "mediaType",
    "availability", "retention", "accessPolicy",
}
_RECORD_KEYS = {"ref", "artifact", "version", "kind", "locator", "observedAt"}
_EVENT_KEYS = {
    "schemaVersion", "eventId", "sequence", "type", "artifactId", "versionId",
    "previousVersionId", "transactionId", "createdAt", "detail",
}
_EVENT_TYPES = {
    "artifact-created", "version-committed", "current-changed",
    "availability-changed", "artifact-moved", "artifact-content-changed",
    "artifact-missing", "artifact-restored", "materialized", "bundle-imported",
}
_AVAILABILITY = {"available", "missing", "remote"}
_RETENTION = {"snapshot", "reference"}
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_ISSUE_CODES = {
    "invalid-input", "stale-base", "idempotency-conflict", "artifact-not-found",
    "version-not-found", "invalid-dependency", "content-mismatch",
    "content-unavailable", "path-outside-workspace", "destination-exists",
    "bundle-invalid", "io-failure",
}


class ArtifactVersionProjectionError(ValueError):
    """A pinned projection is invalid or conflicts with a prior immutable ref."""


def digest_bytes(data: bytes) -> str:
    """Return the legacy Evidence digest representation for snapshot projection."""
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _strict_object(value: Any, allowed: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ArtifactVersionProjectionError(f"{label} must be an object")
    unexpected = set(value) - allowed
    if unexpected:
        raise ArtifactVersionProjectionError(
            f"{label} contains unsupported field(s): {', '.join(sorted(unexpected))}"
        )
    return value


def _required_text(value: Any, label: str, *, prefix: Optional[str] = None) -> str:
    text = str(value or "").strip()
    if not text or (prefix is not None and not text.startswith(prefix)):
        raise ArtifactVersionProjectionError(f"{label} is invalid")
    return text


def _validate_issue(raw: Any) -> dict[str, Any]:
    value = _strict_object(raw, {"code", "message", "details"}, "ArtifactVersionIssueV1")
    if value.get("code") not in _ISSUE_CODES or not str(value.get("message") or "").strip():
        raise ArtifactVersionProjectionError("ArtifactVersionIssueV1 is invalid")
    if "details" in value and not isinstance(value["details"], dict):
        raise ArtifactVersionProjectionError("ArtifactVersionIssueV1.details must be an object")
    return dict(value)


@dataclass(frozen=True)
class ArtifactVersionRefV1:
    artifact_id: str
    version_id: str
    content_digest: str
    byte_length: int
    media_type: Optional[str]
    availability: str
    retention: str
    access_policy: dict[str, Any]

    @classmethod
    def from_dict(cls, raw: Any) -> "ArtifactVersionRefV1":
        value = _strict_object(raw, _REF_KEYS, "ArtifactVersionRefV1")
        required = {
            "artifactId", "versionId", "contentDigest", "byteLength",
            "availability", "retention", "accessPolicy",
        }
        missing = required - set(value)
        if missing:
            raise ArtifactVersionProjectionError(
                f"ArtifactVersionRefV1 is missing: {', '.join(sorted(missing))}"
            )
        digest = str(value["contentDigest"] or "").strip().lower()
        if not _SHA256.fullmatch(digest):
            raise ArtifactVersionProjectionError("ArtifactVersionRefV1.contentDigest is invalid")
        byte_length = value["byteLength"]
        if not isinstance(byte_length, int) or isinstance(byte_length, bool) or byte_length < 0:
            raise ArtifactVersionProjectionError("ArtifactVersionRefV1.byteLength is invalid")
        availability = str(value["availability"])
        retention = str(value["retention"])
        if availability not in _AVAILABILITY or retention not in _RETENTION:
            raise ArtifactVersionProjectionError("ArtifactVersionRefV1 state is invalid")
        media_type = value.get("mediaType")
        if media_type is not None and (not isinstance(media_type, str) or "/" not in media_type):
            raise ArtifactVersionProjectionError("ArtifactVersionRefV1.mediaType is invalid")
        access_policy = _validate_access_policy(value.get("accessPolicy"))
        return cls(
            artifact_id=_required_text(value["artifactId"], "artifactId", prefix="artifact:"),
            version_id=_required_text(value["versionId"], "versionId", prefix="artifact-version:"),
            content_digest=digest,
            byte_length=byte_length,
            media_type=media_type,
            availability=availability,
            retention=retention,
            access_policy=access_policy,
        )

    def to_dict(self) -> dict[str, Any]:
        result = {
            "artifactId": self.artifact_id,
            "versionId": self.version_id,
            "contentDigest": self.content_digest,
            "byteLength": self.byte_length,
            "availability": self.availability,
            "retention": self.retention,
            "accessPolicy": dict(self.access_policy),
        }
        if self.media_type:
            result["mediaType"] = self.media_type
        return result


@dataclass(frozen=True)
class ArtifactVersionProjectionRecordV1:
    ref: ArtifactVersionRefV1
    artifact: Artifact
    version: ArtifactVersion
    raw_artifact: Optional[dict[str, Any]] = None
    raw_version: Optional[dict[str, Any]] = None

    @classmethod
    def from_dict(cls, raw: Any) -> "ArtifactVersionProjectionRecordV1":
        value = _strict_object(raw, _RECORD_KEYS, "Evidence ArtifactVersion projection")
        ref = ArtifactVersionRefV1.from_dict(value.get("ref"))
        raw_artifact = value.get("artifact")
        raw_version = value.get("version")
        if raw_artifact is not None:
            raw_artifact = _validate_artifact(raw_artifact, ref)
        if raw_version is not None:
            raw_version = _validate_version(raw_version, ref)
        kind = str(
            (raw_artifact or {}).get("kind") or value.get("kind") or "other"
        ).strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9._-]{0,63}", kind):
            raise ArtifactVersionProjectionError("Artifact projection kind is invalid")
        created_at = str((raw_artifact or {}).get("createdAt") or value.get("observedAt") or _now_iso())
        current_version_id = str(
            (raw_artifact or {}).get("currentVersionId") or ref.version_id
        )
        artifact = Artifact(
            artifact_id=ref.artifact_id,
            kind=kind,
            created_at=created_at,
            current_version_id=current_version_id,
            access_policy=dict(ref.access_policy),
        )
        storage = (raw_version or {}).get("storage") or {}
        locator = str(
            value.get("locator") or storage.get("locator") or f"artifact-version:{ref.version_id}"
        )
        observed_at = str((raw_version or {}).get("createdAt") or value.get("observedAt") or created_at)
        version = ArtifactVersion(
            version_id=ref.version_id,
            artifact_id=ref.artifact_id,
            locator=locator,
            content_digest=normalize_sha256(ref.content_digest),
            version=str((raw_version or {}).get("sequence")) if raw_version else None,
            size=ref.byte_length,
            media_type=ref.media_type,
            observed_at=observed_at,
            availability=ref.availability,
            retention=ref.retention,
            supersedes=(raw_version or {}).get("parentVersionId"),
        )
        return cls(
            ref=ref, artifact=artifact, version=version,
            raw_artifact=dict(raw_artifact) if raw_artifact else None,
            raw_version=dict(raw_version) if raw_version else None,
        )


def _validate_artifact(raw: Any, ref: ArtifactVersionRefV1) -> dict[str, Any]:
    allowed = {
        "artifactId", "kind", "label", "createdAt", "updatedAt",
        "currentVersionId", "versionCount",
    }
    value = _strict_object(raw, allowed, "ArtifactV1")
    required = {"artifactId", "kind", "createdAt", "updatedAt", "currentVersionId", "versionCount"}
    if required - set(value) or value.get("artifactId") != ref.artifact_id:
        raise ArtifactVersionProjectionError("ArtifactV1 does not match its pinned ref")
    return value


def _validate_access_policy(raw: Any) -> dict[str, Any]:
    value = _strict_object(
        raw, {"visibility", "principals", "allowExport"},
        "ArtifactVersionAccessPolicyV1",
    )
    if value.get("visibility") not in {"workspace", "restricted", "public"}:
        raise ArtifactVersionProjectionError("ArtifactVersion access visibility is invalid")
    principals = value.get("principals")
    if not isinstance(principals, list) or len(principals) > 1_000 or any(
        not isinstance(item, str) or not item.strip() or len(item) > 512
        for item in principals
    ):
        raise ArtifactVersionProjectionError("ArtifactVersion access principals are invalid")
    if value["visibility"] == "restricted" and not principals:
        raise ArtifactVersionProjectionError("Restricted ArtifactVersion access requires a principal")
    if not isinstance(value.get("allowExport"), bool):
        raise ArtifactVersionProjectionError("ArtifactVersion allowExport is invalid")
    return {
        "visibility": value["visibility"],
        "principals": list(principals),
        "allowExport": value["allowExport"],
    }


def _validate_version(raw: Any, ref: ArtifactVersionRefV1) -> dict[str, Any]:
    allowed = {
        "schemaVersion", "versionId", "artifactId", "parentVersionId", "sequence",
        "transactionId", "createdAt", "intent", "storage", "dependencies", "accessPolicy",
        "metadata",
    }
    value = _strict_object(raw, allowed, "ArtifactVersionV1")
    required = {
        "schemaVersion", "versionId", "artifactId", "sequence", "transactionId",
        "createdAt", "intent", "storage", "dependencies", "accessPolicy", "metadata",
    }
    if required - set(value) or value.get("schemaVersion") != 1:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 is incomplete")
    if value.get("versionId") != ref.version_id or value.get("artifactId") != ref.artifact_id:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 does not match its pinned ref")
    storage = value.get("storage")
    if not isinstance(storage, dict) or storage.get("contentDigest") != ref.content_digest:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 storage digest does not match its ref")
    if storage.get("byteLength") != ref.byte_length:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 byte length does not match its ref")
    if storage.get("mediaType") != ref.media_type or storage.get("mode") != ref.retention:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 storage does not match its ref")
    if _validate_access_policy(value.get("accessPolicy")) != ref.access_policy:
        raise ArtifactVersionProjectionError("ArtifactVersionV1 access policy does not match its ref")
    return value


@dataclass(frozen=True)
class ArtifactVersionLifecycleEventV1:
    event_id: str
    sequence: int
    event_type: str
    artifact_id: str
    version_id: str
    previous_version_id: Optional[str]
    created_at: str
    detail: dict[str, Any]

    @classmethod
    def from_dict(cls, raw: Any) -> "ArtifactVersionLifecycleEventV1":
        value = _strict_object(raw, _EVENT_KEYS, "ArtifactVersion lifecycle event")
        required = {
            "schemaVersion", "eventId", "sequence", "type", "artifactId",
            "versionId", "createdAt", "detail",
        }
        if required - set(value) or value.get("schemaVersion") != 1:
            raise ArtifactVersionProjectionError("ArtifactVersion lifecycle event is incomplete")
        sequence = value.get("sequence")
        if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
            raise ArtifactVersionProjectionError("ArtifactVersion lifecycle sequence is invalid")
        event_type = str(value.get("type"))
        if event_type not in _EVENT_TYPES or not isinstance(value.get("detail"), dict):
            raise ArtifactVersionProjectionError("ArtifactVersion lifecycle event is invalid")
        previous = value.get("previousVersionId")
        if previous is not None:
            previous = _required_text(previous, "previousVersionId", prefix="artifact-version:")
        return cls(
            event_id=_required_text(value["eventId"], "eventId", prefix="artifact-event:"),
            sequence=sequence,
            event_type=event_type,
            artifact_id=_required_text(value["artifactId"], "artifactId", prefix="artifact:"),
            version_id=_required_text(value["versionId"], "versionId", prefix="artifact-version:"),
            previous_version_id=previous,
            created_at=_required_text(value["createdAt"], "createdAt"),
            detail=dict(value["detail"]),
        )


class ArtifactVersionProjectionClient:
    """In-memory, read-only projection over refs carried by one Evidence update."""

    def __init__(
        self, trace: Iterable[dict[str, Any]], *, workspace_roots: Iterable[str] = (),
        locator_root: Optional[str] = None,
    ) -> None:
        self.workspace_roots = tuple(os.path.abspath(path) for path in workspace_roots if path)
        self.locator_root = os.path.abspath(locator_root) if locator_root else (
            self.workspace_roots[0] if self.workspace_roots else None
        )
        self.artifacts: dict[str, Artifact] = {}
        self.versions: dict[str, ArtifactVersion] = {}
        self.refs: dict[str, ArtifactVersionRefV1] = {}
        self.anchors: dict[str, SourceAnchor] = {}
        self.records_by_trace: dict[str, list[ArtifactVersionProjectionRecordV1]] = {}
        self.provenance_status_by_trace: dict[str, dict[str, Any]] = {}
        self.lifecycle_events: list[ArtifactVersionLifecycleEventV1] = []
        self.lifecycle_last_sequence = 0
        self.lifecycle_pending = False
        self.lifecycle_observed = False
        self._load(trace)

    def _load(self, trace: Iterable[dict[str, Any]]) -> None:
        events: dict[str, ArtifactVersionLifecycleEventV1] = {}
        for item in trace:
            if not isinstance(item, dict) or "evidenceArtifactVersions" not in item:
                continue
            trace_id = str(item.get("id") or item.get("step_id") or item.get("stepId") or "").strip()
            raw = item.get("evidenceArtifactVersions")
            self.lifecycle_observed = True
            if not isinstance(raw, dict):
                self.provenance_status_by_trace[trace_id] = {
                    "status": "failed", "reason": "Artifact version projection is not an object",
                }
                continue
            status = str(raw.get("status") or "")
            allowed_by_status = {
                "ready": {
                    "status", "versions", "lifecycleEvents", "lastSequence",
                    "lifecyclePending", "lifecycleIssue",
                },
                "pending": {
                    "status", "reason", "lifecycleEvents", "lastSequence",
                    "lifecyclePending",
                },
                "failed": {
                    "status", "issue", "lifecycleEvents", "lastSequence",
                    "lifecyclePending",
                },
            }
            allowed = allowed_by_status.get(status, {"status"})
            if set(raw) - allowed:
                self.provenance_status_by_trace[trace_id] = {
                    "status": "failed", "reason": "Artifact version projection shape is invalid",
                }
                continue
            raw_events = raw.get("lifecycleEvents", [])
            if not isinstance(raw_events, list):
                self.provenance_status_by_trace[trace_id] = {
                    "status": "failed", "reason": "Artifact lifecycle events must be an array",
                }
                continue
            for raw_event in raw_events:
                event = ArtifactVersionLifecycleEventV1.from_dict(raw_event)
                prior = events.get(event.event_id)
                if prior is not None and prior != event:
                    raise ArtifactVersionProjectionError(
                        f"Artifact lifecycle event conflict: {event.event_id}"
                    )
                events[event.event_id] = event
            last_sequence = raw.get("lastSequence")
            if last_sequence is not None:
                if not isinstance(last_sequence, int) or isinstance(last_sequence, bool) \
                        or last_sequence < 0:
                    raise ArtifactVersionProjectionError("Artifact lifecycle watermark is invalid")
                self.lifecycle_last_sequence = max(self.lifecycle_last_sequence, last_sequence)
            lifecycle_pending = raw.get("lifecyclePending")
            if lifecycle_pending is not None and not isinstance(lifecycle_pending, bool):
                raise ArtifactVersionProjectionError("Artifact lifecycle pending flag is invalid")
            self.lifecycle_pending = self.lifecycle_pending or lifecycle_pending is True
            if status == "pending" and str(raw.get("reason") or "").strip():
                self.provenance_status_by_trace[trace_id] = {
                    "status": status, "reason": str(raw.get("reason") or "").strip(),
                }
                continue
            if status == "failed" and isinstance(raw.get("issue"), dict):
                issue = _validate_issue(raw["issue"])
                self.provenance_status_by_trace[trace_id] = {
                    "status": status,
                    "reason": str(issue.get("message") or "Artifact version commit failed"),
                }
                continue
            if status != "ready" or not {"versions", "lifecycleEvents"}.issubset(raw):
                self.provenance_status_by_trace[trace_id] = {
                    "status": "failed", "reason": "Artifact version projection shape is invalid",
                }
                continue
            raw_versions = raw.get("versions")
            if not isinstance(raw_versions, list):
                self.provenance_status_by_trace[trace_id] = {
                    "status": "failed", "reason": "Ready projection requires a versions array",
                }
                continue
            records = [ArtifactVersionProjectionRecordV1.from_dict(value) for value in raw_versions]
            self.records_by_trace[trace_id] = records
            lifecycle_issue = raw.get("lifecycleIssue")
            if lifecycle_issue is not None:
                lifecycle_issue = _validate_issue(lifecycle_issue)
            self.lifecycle_pending = self.lifecycle_pending or isinstance(lifecycle_issue, dict)
            self.provenance_status_by_trace[trace_id] = {
                "status": "failed",
                "reason": str(lifecycle_issue.get("message") or "Artifact lifecycle pull failed"),
            } if isinstance(lifecycle_issue, dict) else {"status": "ready"}
            for record in records:
                prior = self.refs.get(record.ref.version_id)
                if prior is not None and prior != record.ref:
                    raise ArtifactVersionProjectionError(
                        f"Pinned ArtifactVersion ref conflict: {record.ref.version_id}"
                    )
                self.refs[record.ref.version_id] = record.ref
                self.artifacts[record.artifact.artifact_id] = Artifact.from_dict(
                    record.artifact.to_dict()
                )
                self.versions[record.version.version_id] = ArtifactVersion.from_dict(
                    record.version.to_dict()
                )
        self.lifecycle_events = sorted(events.values(), key=lambda item: (item.sequence, item.event_id))
        if self.lifecycle_events:
            self.lifecycle_last_sequence = max(
                self.lifecycle_last_sequence, self.lifecycle_events[-1].sequence
            )

    def status_for_trace(self, trace_refs: Iterable[str]) -> Optional[dict[str, Any]]:
        for trace_ref in trace_refs:
            status = self.provenance_status_by_trace.get(trace_ref)
            if status is not None:
                return dict(status)
        return None

    def records_for_trace(self, trace_refs: Iterable[str]) -> list[ArtifactVersionProjectionRecordV1]:
        records: list[ArtifactVersionProjectionRecordV1] = []
        seen: set[str] = set()
        for trace_ref in trace_refs:
            for record in self.records_by_trace.get(trace_ref, ()):
                if record.ref.version_id not in seen:
                    seen.add(record.ref.version_id)
                    records.append(record)
        return records

    def register(
        self, *, kind: str, locator: str, content_digest: Optional[str] = None,
        version: Optional[str] = None, size: Optional[int] = None,
        media_type: Optional[str] = None, observed_at: Optional[str] = None,
        retention: str = "reference", access_policy: Optional[dict[str, Any]] = None,
    ) -> tuple[Artifact, ArtifactVersion, str]:
        """Resolve an already-pinned ref; never create identity or write state."""
        del version, observed_at, retention, access_policy
        normalized_locator = self._normalize_locator(locator)
        normalized_digest = normalize_sha256(content_digest)
        candidates = []
        for version_record in self.versions.values():
            if version_record.locator != normalized_locator:
                continue
            if normalized_digest and version_record.content_digest != normalized_digest:
                continue
            if size is not None and version_record.size != size:
                continue
            if media_type is not None and version_record.media_type != media_type:
                continue
            artifact = self.artifacts.get(version_record.artifact_id)
            if artifact is not None and kind and kind != "other" and artifact.kind != kind:
                continue
            candidates.append((artifact, version_record))
        if len(candidates) != 1 or candidates[0][0] is None:
            raise ArtifactVersionProjectionError(
                "Artifact descriptor does not resolve to one pinned ArtifactVersionRef"
            )
        artifact, artifact_version = candidates[0]
        return artifact, artifact_version, "pinned"

    def create_anchor(
        self, artifact_id: str, selector: dict[str, Any], *,
        anchor_digest: Optional[str] = None, selected_content: Optional[str | bytes] = None,
        artifact_version_id: Optional[str] = None, created_at: Optional[str] = None,
        access_policy: Optional[dict[str, Any]] = None,
    ) -> SourceAnchor:
        artifact = self.artifacts.get(artifact_id)
        if artifact is None:
            raise ArtifactVersionProjectionError("unknown projected artifact")
        version_id = artifact_version_id or artifact.current_version_id
        version = self.versions.get(version_id)
        if version is None or version.artifact_id != artifact_id:
            raise ArtifactVersionProjectionError("ArtifactVersionRef does not belong to artifact")
        structured = SourceSelector.from_dict(selector)
        if selected_content is not None:
            raw = selected_content if isinstance(selected_content, bytes) else selected_content.encode("utf-8")
            actual = digest_bytes(raw)
            if anchor_digest and normalize_sha256(anchor_digest) != actual:
                raise ArtifactVersionProjectionError("anchorDigest does not match selected content")
            anchor_digest = actual
        elif structured.quote is not None:
            actual = digest_bytes(structured.quote.encode("utf-8"))
            if anchor_digest and normalize_sha256(anchor_digest) != actual:
                raise ArtifactVersionProjectionError("anchorDigest does not match selector.quote")
            anchor_digest = actual
        anchor_digest = normalize_sha256(anchor_digest)
        if not anchor_digest:
            raise ArtifactVersionProjectionError("anchorDigest or exact selected content is required")
        canonical = json.dumps({
            "artifactVersionId": version_id,
            "selector": structured.to_dict(),
            "anchorDigest": anchor_digest,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        anchor_id = f"anchor:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}"
        anchor = SourceAnchor(
            anchor_id=anchor_id, artifact_id=artifact_id, artifact_version_id=version_id,
            selector=structured, anchor_digest=anchor_digest, created_at=created_at or _now_iso(),
            access_policy=dict(access_policy or {}),
        )
        self.anchors.setdefault(anchor_id, anchor)
        return self.anchors[anchor_id]

    def state_digest(self) -> str:
        payload = json.dumps({
            "refs": [self.refs[key].to_dict() for key in sorted(self.refs)],
            "events": [event.event_id for event in self.lifecycle_events],
            "lifecyclePending": self.lifecycle_pending,
            "statuses": self.provenance_status_by_trace,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"

    def _normalize_locator(self, locator: str) -> str:
        locator = str(locator or "").strip()
        if not locator:
            raise ArtifactVersionProjectionError("artifact locator is required")
        scheme = urlparse(locator).scheme.lower()
        # The owner contract deliberately permits canonical locators beyond a
        # fixed URI allow-list (for example workspace: and snapshot:).  Evidence
        # treats every explicit scheme as opaque and never dereferences it.
        if scheme or locator.startswith("citation:"):
            return locator
        candidate = os.path.abspath(
            os.path.expanduser(locator) if os.path.isabs(locator) or not self.locator_root
            else os.path.join(self.locator_root, locator)
        )
        if self.workspace_roots:
            try:
                contained = any(
                    os.path.commonpath((root, candidate)) == root for root in self.workspace_roots
                )
            except ValueError:
                contained = False
            if not contained:
                raise ArtifactVersionProjectionError(
                    "local artifact locator is outside configured workspace roots"
                )
            return os.path.relpath(candidate, self.locator_root or self.workspace_roots[0]).replace(
                os.sep, "/"
            )
        return candidate

    def _absolute_locator(self, locator: str) -> Optional[str]:
        if urlparse(locator).scheme:
            return None
        if os.path.isabs(locator):
            return locator
        return os.path.abspath(os.path.join(self.locator_root, locator)) if self.locator_root else None
