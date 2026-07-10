"""Persistent Artifact Registry with version-safe observation and rebinding."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

from .model import Artifact, ArtifactVersion, SourceAnchor, SourceSelector, normalize_sha256

ARTIFACT_KINDS = frozenset({"paper", "dataset", "code", "notebook", "image", "log", "model", "other"})
AVAILABILITY = frozenset({"available", "moved", "missing", "remote", "restricted"})
RETENTION = frozenset({"reference", "cached_excerpt", "snapshot"})


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def digest_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def digest_file(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            hasher.update(chunk)
    return f"sha256:{hasher.hexdigest()}"


def _is_remote(locator: str) -> bool:
    parsed = urlparse(locator)
    return parsed.scheme.lower() in {"http", "https", "doi", "swh", "swhid"}


def _is_runtime_reference(locator: str) -> bool:
    """Return whether *locator* names immutable input in the visible runtime trace.

    A SourceAssertion can be only L0-grounded when the agent trace contains a
    bounded source excerpt but no external URL or file locator.  Keeping that
    excerpt under a runtime-qualified locator makes the provenance break
    explicit instead of dropping Artifact/SourceAnchor records altogether.
    """
    return urlparse(locator).scheme.lower() in {"runtime", "trace"}


class ArtifactRegistry:
    """Registry shared by every Evidence DAG in one configured workspace.

    Artifact identity is an opaque stable id. Locator changes never alter it.
    Content changes append an ArtifactVersion and never rewrite the old digest.
    """

    def __init__(
        self, path: Optional[str] = None, *, workspace_roots: Iterable[str] = (),
        locator_root: Optional[str] = None,
    ) -> None:
        self.path = path
        self.workspace_roots = tuple(os.path.abspath(p) for p in workspace_roots if p)
        self.locator_root = os.path.abspath(locator_root) if locator_root else (
            self.workspace_roots[0] if self.workspace_roots else None
        )
        self._lock = threading.RLock()
        self.artifacts: dict[str, Artifact] = {}
        self.versions: dict[str, ArtifactVersion] = {}
        self.anchors: dict[str, SourceAnchor] = {}
        self.pending_events: dict[str, dict[str, Any]] = {}
        if path and os.path.exists(path):
            self._load()
        if self._event_path() and os.path.exists(self._event_path() or ""):
            self._load_events()

    def _normalize_locator(self, locator: str) -> str:
        locator = str(locator or "").strip()
        if not locator:
            raise ValueError("artifact locator is required")
        if _is_remote(locator) or _is_runtime_reference(locator) or locator.startswith("citation:"):
            return locator
        candidate = os.path.abspath(
            os.path.expanduser(locator) if os.path.isabs(locator) or not self.locator_root
            else os.path.join(self.locator_root, locator)
        )
        if self.workspace_roots:
            root = None
            for configured_root in self.workspace_roots:
                try:
                    if os.path.commonpath((configured_root, candidate)) == configured_root:
                        root = configured_root
                        break
                except ValueError:
                    continue
            if root is None:
                raise ValueError("local artifact locator is outside configured workspace roots")
            return os.path.relpath(candidate, self.locator_root or root).replace(os.sep, "/")
        return candidate

    def _absolute_locator(self, locator: str) -> Optional[str]:
        if _is_remote(locator) or _is_runtime_reference(locator) or locator.startswith("citation:"):
            return None
        if os.path.isabs(locator):
            return locator
        if self.locator_root:
            return os.path.abspath(os.path.join(self.locator_root, locator))
        return os.path.abspath(locator)

    @staticmethod
    def _version_id(artifact_id: str, content_digest: Optional[str], version: Optional[str], ordinal: int) -> str:
        payload = f"artifact-version-v1|{artifact_id}|{content_digest or ''}|{version or ''}|{ordinal}"
        return f"artifact-version:{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]}"

    def _find_by_locator(self, locator: str) -> Optional[Artifact]:
        for artifact in self.artifacts.values():
            current = self.versions.get(artifact.current_version_id)
            if current and (current.locator == locator or locator in current.historical_locators):
                return artifact
        return None

    def register(
        self,
        *,
        kind: str,
        locator: str,
        content_digest: Optional[str] = None,
        version: Optional[str] = None,
        size: Optional[int] = None,
        media_type: Optional[str] = None,
        observed_at: Optional[str] = None,
        retention: str = "reference",
        access_policy: Optional[dict[str, Any]] = None,
    ) -> tuple[Artifact, ArtifactVersion, str]:
        with self._lock:
            return self._register(
                kind=kind, locator=locator, content_digest=content_digest, version=version,
                size=size, media_type=media_type, observed_at=observed_at, retention=retention,
                access_policy=access_policy,
            )

    def _register(
        self,
        *,
        kind: str,
        locator: str,
        content_digest: Optional[str] = None,
        version: Optional[str] = None,
        size: Optional[int] = None,
        media_type: Optional[str] = None,
        observed_at: Optional[str] = None,
        retention: str = "reference",
        access_policy: Optional[dict[str, Any]] = None,
    ) -> tuple[Artifact, ArtifactVersion, str]:
        kind = str(kind or "other").strip().lower()
        if kind not in ARTIFACT_KINDS:
            raise ValueError(f"unsupported artifact kind: {kind}")
        if retention not in RETENTION:
            raise ValueError(f"unsupported retention: {retention}")
        locator = self._normalize_locator(locator)
        local_path = self._absolute_locator(locator)
        if local_path and os.path.isfile(local_path):
            actual_digest = digest_file(local_path)
            if content_digest and normalize_sha256(content_digest) != actual_digest:
                raise ValueError("supplied contentDigest does not match artifact bytes")
            content_digest = actual_digest
            size = os.path.getsize(local_path)
            media_type = media_type or mimetypes.guess_type(local_path)[0]
        else:
            content_digest = normalize_sha256(content_digest)
        observed = observed_at or _now_iso()

        # A new locator is never silently rebound merely because bytes match.
        # Explicit resolve() performs scope-bounded, unique-candidate rebinding
        # only after the registered locator is missing.
        artifact = self._find_by_locator(locator)
        if artifact is not None:
            current = self.versions[artifact.current_version_id]
            before_state = self._lifecycle_state(current)
            if current.content_digest == content_digest and current.version == version:
                if current.locator != locator:
                    if current.locator not in current.historical_locators:
                        current.historical_locators.append(current.locator)
                    current.locator = locator
                    current.availability = "moved"
                    current.observed_at = observed
                    self._persist()
                    self._record_lifecycle_event(artifact.artifact_id, before_state, "moved")
                    return artifact, current, "moved"
                current.observed_at = observed
                if local_path and os.path.exists(local_path):
                    if current.availability != "moved":
                        current.availability = "available"
                self._persist()
                self._record_lifecycle_event(artifact.artifact_id, before_state, "unchanged")
                return artifact, current, "unchanged"
            updated = self._append_version(
                artifact, locator=locator, content_digest=content_digest, version=version,
                size=size, media_type=media_type, observed_at=observed, retention=retention,
            )
            self._record_lifecycle_event(
                artifact.artifact_id, before_state, "content_changed",
            )
            return (*updated, "content_changed")

        artifact_id = f"artifact:{uuid.uuid4().hex}"
        version_id = self._version_id(artifact_id, content_digest, version, 1)
        availability = (
            "available" if _is_runtime_reference(locator) and content_digest else
            "remote" if _is_remote(locator) or locator.startswith("citation:") else
            "available" if local_path and os.path.exists(local_path) else "missing"
        )
        artifact = Artifact(
            artifact_id=artifact_id, kind=kind, created_at=observed,
            current_version_id=version_id, access_policy=dict(access_policy or {}),
        )
        artifact_version = ArtifactVersion(
            version_id=version_id, artifact_id=artifact_id, locator=locator,
            content_digest=content_digest, version=version, size=size, media_type=media_type,
            observed_at=observed, availability=availability, retention=retention,
        )
        self.artifacts[artifact_id] = artifact
        self.versions[version_id] = artifact_version
        self._persist()
        return artifact, artifact_version, "registered"

    def _append_version(
        self, artifact: Artifact, *, locator: str, content_digest: Optional[str],
        version: Optional[str], size: Optional[int], media_type: Optional[str],
        observed_at: str, retention: str,
    ) -> tuple[Artifact, ArtifactVersion]:
        previous = self.versions[artifact.current_version_id]
        if (not _is_remote(locator) and not _is_runtime_reference(locator) and
                not locator.startswith("citation:") and
                previous.locator == locator and previous.content_digest != content_digest and
                previous.retention == "reference"):
            previous.availability = "missing"
        ordinal = 1 + sum(1 for v in self.versions.values() if v.artifact_id == artifact.artifact_id)
        version_id = self._version_id(artifact.artifact_id, content_digest, version, ordinal)
        local_path = self._absolute_locator(locator)
        availability = (
            "available" if _is_runtime_reference(locator) and content_digest else
            "remote" if _is_remote(locator) or locator.startswith("citation:") else
            "available" if local_path and os.path.exists(local_path) else "missing"
        )
        created = ArtifactVersion(
            version_id=version_id, artifact_id=artifact.artifact_id, locator=locator,
            content_digest=content_digest, version=version, size=size, media_type=media_type,
            observed_at=observed_at, availability=availability, retention=retention,
            supersedes=previous.version_id,
        )
        artifact.current_version_id = version_id
        self.versions[version_id] = created
        self._persist()
        return artifact, created

    def create_anchor(
        self, artifact_id: str, selector: dict[str, Any], *,
        anchor_digest: Optional[str] = None, selected_content: Optional[str | bytes] = None,
        artifact_version_id: Optional[str] = None, created_at: Optional[str] = None,
        access_policy: Optional[dict[str, Any]] = None,
    ) -> SourceAnchor:
        with self._lock:
            return self._create_anchor(
                artifact_id, selector, anchor_digest=anchor_digest, selected_content=selected_content,
                artifact_version_id=artifact_version_id, created_at=created_at,
                access_policy=access_policy,
            )

    def _create_anchor(
        self, artifact_id: str, selector: dict[str, Any], *,
        anchor_digest: Optional[str] = None, selected_content: Optional[str | bytes] = None,
        artifact_version_id: Optional[str] = None, created_at: Optional[str] = None,
        access_policy: Optional[dict[str, Any]] = None,
    ) -> SourceAnchor:
        artifact = self.require(artifact_id)
        version_id = artifact_version_id or artifact.current_version_id
        version = self.versions.get(version_id)
        if version is None or version.artifact_id != artifact_id:
            raise ValueError("artifactVersionId does not belong to artifactId")
        structured = SourceSelector.from_dict(selector)
        if selected_content is not None:
            raw = selected_content if isinstance(selected_content, bytes) else selected_content.encode("utf-8")
            actual = digest_bytes(raw)
            if anchor_digest and normalize_sha256(anchor_digest) != actual:
                raise ValueError("anchorDigest does not match selected content")
            anchor_digest = actual
        elif structured.quote is not None:
            actual = digest_bytes(structured.quote.encode("utf-8"))
            if anchor_digest and normalize_sha256(anchor_digest) != actual:
                raise ValueError("anchorDigest does not match selector.quote")
            anchor_digest = actual
        anchor_digest = normalize_sha256(anchor_digest)
        if not anchor_digest:
            raise ValueError("anchorDigest or exact selected content is required")
        canonical = json.dumps(
            {"artifactVersionId": version_id, "selector": structured.to_dict(), "anchorDigest": anchor_digest},
            sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        )
        anchor_id = f"anchor:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}"
        anchor = SourceAnchor(
            anchor_id=anchor_id, artifact_id=artifact_id, artifact_version_id=version_id,
            selector=structured, anchor_digest=anchor_digest, created_at=created_at or _now_iso(),
            access_policy=dict(access_policy or {}),
        )
        self.anchors.setdefault(anchor_id, anchor)
        self._persist()
        return self.anchors[anchor_id]

    def require(self, artifact_id: str) -> Artifact:
        try:
            return self.artifacts[artifact_id]
        except KeyError as exc:
            raise KeyError(f"unknown artifact: {artifact_id}") from exc

    def get(self, artifact_id: str) -> dict[str, Any]:
        artifact = self.require(artifact_id)
        versions = [v for v in self.versions.values() if v.artifact_id == artifact_id]
        return {
            "artifact": artifact.to_dict(),
            "versions": [v.to_dict() for v in sorted(versions, key=lambda item: item.observed_at)],
            "anchors": [a.to_dict() for a in self.anchors.values() if a.artifact_id == artifact_id],
        }

    def resolve(self, artifact_id: str, *, candidate_locators: Iterable[str] = ()) -> dict[str, Any]:
        with self._lock:
            result, event = self._resolve_with_event(
                artifact_id, candidate_locators=candidate_locators,
            )
            return {**result, "event": dict(event) if event else None}

    def resolve_all(self) -> list[dict[str, Any]]:
        """Resolve every registered Artifact and return semantic lifecycle events.

        Observation timestamps are deliberately excluded from change detection so
        a quiet workspace scan is idempotent.  The caller can feed returned events
        into the normal durable Evidence update queue; this method never mutates a
        graph or starts a second ingest path.
        """
        with self._lock:
            for artifact_id in sorted(self.artifacts):
                self._resolve_with_event(artifact_id)
            return [dict(self.pending_events[key]) for key in sorted(self.pending_events)]

    @staticmethod
    def _lifecycle_state(version: ArtifactVersion) -> dict[str, Any]:
        return {
            "versionId": version.version_id,
            "locator": version.locator,
            "availability": version.availability,
            "candidates": sorted(version.rebind_candidates),
        }

    def _resolve_with_event(
        self, artifact_id: str, *, candidate_locators: Iterable[str] = (),
    ) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
        artifact = self.require(artifact_id)
        before = self.versions[artifact.current_version_id]
        before_state = self._lifecycle_state(before)
        result = self._resolve(artifact_id, candidate_locators=candidate_locators)
        after_artifact = self.artifacts[artifact_id]
        after = self.versions[after_artifact.current_version_id]
        after_state = self._lifecycle_state(after)
        event = self._record_lifecycle_event(
            artifact_id, before_state, str(result["outcome"]), after_state=after_state,
        )
        return result, event

    def _record_lifecycle_event(
        self, artifact_id: str, before_state: dict[str, Any], outcome: str,
        *, after_state: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        if after_state is None:
            artifact = self.artifacts[artifact_id]
            after_state = self._lifecycle_state(self.versions[artifact.current_version_id])
        if before_state == after_state:
            return None
        event_type = (
            "ArtifactContentChanged"
            if before_state["versionId"] != after_state["versionId"]
            else "ArtifactMoved"
        )
        identity = json.dumps({
            "type": event_type,
            "artifactId": artifact_id,
            "before": before_state,
            "after": after_state,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        event = {
            "eventId": f"artifact-event:{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:24]}",
            "type": event_type,
            "artifactId": artifact_id,
            "outcome": outcome,
            "previousVersionId": before_state["versionId"],
            "artifactVersionId": after_state["versionId"],
            "previousLocator": before_state["locator"],
            "locator": after_state["locator"],
            "availability": after_state["availability"],
            "candidates": after_state["candidates"],
            "occurredAt": _now_iso(),
        }
        stored = self.pending_events.setdefault(event["eventId"], event)
        self._persist_events()
        return stored

    def acknowledge_events(self, event_ids: Iterable[str]) -> list[str]:
        """Acknowledge lifecycle events only after their durable jobs exist."""
        with self._lock:
            acknowledged = []
            for event_id in sorted(set(str(value) for value in event_ids if value)):
                if self.pending_events.pop(event_id, None) is not None:
                    acknowledged.append(event_id)
            if acknowledged:
                self._persist_events()
            return acknowledged

    def _resolve(self, artifact_id: str, *, candidate_locators: Iterable[str] = ()) -> dict[str, Any]:
        artifact = self.require(artifact_id)
        current = self.versions[artifact.current_version_id]
        if current.availability in {"remote", "restricted"}:
            return {"outcome": current.availability, **self.get(artifact_id)}
        if _is_runtime_reference(current.locator):
            # The version is the canonical visible tool-result payload observed
            # at compile time.  It is not a filesystem path and must never enter
            # move-rebinding logic.
            return {"outcome": "available", **self.get(artifact_id)}
        path = self._absolute_locator(current.locator)
        if path and os.path.isfile(path):
            observed_digest = digest_file(path)
            if current.content_digest and observed_digest != current.content_digest:
                _, created = self._append_version(
                    artifact, locator=current.locator, content_digest=observed_digest,
                    version=None, size=os.path.getsize(path),
                    media_type=current.media_type or mimetypes.guess_type(path)[0],
                    observed_at=_now_iso(), retention=current.retention,
                )
                return {"outcome": "content_changed", "previousVersionId": current.version_id,
                        "newVersionId": created.version_id, **self.get(artifact_id)}
            # `moved` is durable provenance state, not a transient scan result.
            # Preserve it after a successful digest rebind so the latest graph can
            # continue to explain why the locator differs from its historical one.
            if current.availability != "moved":
                current.availability = "available"
            current.observed_at = _now_iso()
            self._persist()
            return {"outcome": "available", **self.get(artifact_id)}

        candidates = self._matching_candidates(current.content_digest, candidate_locators)
        if len(candidates) == 1:
            old = current.locator
            if old not in current.historical_locators:
                current.historical_locators.append(old)
            current.locator = candidates[0]
            current.availability = "moved"
            current.rebind_candidates = []
            current.observed_at = _now_iso()
            self._persist()
            return {"outcome": "moved", "previousLocator": old, "locator": current.locator,
                    **self.get(artifact_id)}
        current.rebind_candidates = candidates
        current.availability = "missing"
        current.observed_at = _now_iso()
        self._persist()
        return {"outcome": "ambiguous" if candidates else "missing",
                "candidates": candidates, **self.get(artifact_id)}

    def confirm_rebind(self, artifact_id: str, locator: str) -> dict[str, Any]:
        with self._lock:
            return self._confirm_rebind(artifact_id, locator)

    def _confirm_rebind(self, artifact_id: str, locator: str) -> dict[str, Any]:
        artifact = self.require(artifact_id)
        current = self.versions[artifact.current_version_id]
        normalized = self._normalize_locator(locator)
        if normalized not in current.rebind_candidates:
            raise ValueError("locator is not a pending rebind candidate")
        absolute = self._absolute_locator(normalized)
        if not absolute or not os.path.isfile(absolute) or digest_file(absolute) != current.content_digest:
            raise ValueError("rebind candidate no longer matches the ArtifactVersion digest")
        previous = current.locator
        if previous not in current.historical_locators:
            current.historical_locators.append(previous)
        current.locator = normalized
        current.availability = "moved"
        current.rebind_candidates = []
        current.observed_at = _now_iso()
        self._persist()
        return {"outcome": "moved", "previousLocator": previous, **self.get(artifact_id)}

    def _matching_candidates(self, digest: Optional[str], supplied: Iterable[str]) -> list[str]:
        if not digest:
            return []
        paths: list[str] = []
        for supplied_locator in supplied:
            normalized = self._normalize_locator(supplied_locator)
            absolute = self._absolute_locator(normalized)
            if absolute and os.path.isfile(absolute) and digest_file(absolute) == digest:
                paths.append(normalized)
        for root in self.workspace_roots:
            for directory, _dirs, files in os.walk(root):
                for filename in files:
                    absolute = os.path.join(directory, filename)
                    try:
                        if digest_file(absolute) == digest:
                            paths.append(os.path.relpath(absolute, self.locator_root or root).replace(os.sep, "/"))
                    except OSError:
                        continue
        return sorted(set(paths))

    def reference_bundle(
        self, artifact_ids: Iterable[str], artifact_version_ids: Iterable[str], anchor_ids: Iterable[str],
    ) -> dict[str, Any]:
        aids, vids, sids = set(artifact_ids), set(artifact_version_ids), set(anchor_ids)
        return {
            "artifacts": [self.artifacts[x].to_dict() for x in sorted(aids) if x in self.artifacts],
            "artifactVersions": [self.versions[x].to_dict() for x in sorted(vids) if x in self.versions],
            "sourceAnchors": [self.anchors[x].to_dict() for x in sorted(sids) if x in self.anchors],
        }

    def state_digest(self) -> str:
        """Digest effective registry state; observation timestamps are non-semantic."""
        versions = []
        for item in self.versions.values():
            value = item.to_dict()
            value.pop("observedAt", None)
            versions.append(value)
        anchors = []
        for item in self.anchors.values():
            value = item.to_dict()
            value.pop("createdAt", None)
            anchors.append(value)
        payload = json.dumps({
            "artifacts": sorted((item.to_dict() for item in self.artifacts.values()),
                                key=lambda value: value["artifactId"]),
            "artifactVersions": sorted(versions, key=lambda value: value["versionId"]),
            "sourceAnchors": sorted(anchors, key=lambda value: value["anchorId"]),
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"

    def _persist(self) -> None:
        if not self.path:
            return
        with self._lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            payload = {
                "schemaVersion": "artifact-registry.v1",
                "artifacts": [a.to_dict() for a in self.artifacts.values()],
                "artifactVersions": [v.to_dict() for v in self.versions.values()],
                "sourceAnchors": [a.to_dict() for a in self.anchors.values()],
            }
            tmp = f"{self.path}.{uuid.uuid4().hex}.tmp"
            try:
                with open(tmp, "x", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False, sort_keys=True, indent=2)
                os.replace(tmp, self.path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)

    def _event_path(self) -> Optional[str]:
        return f"{self.path}.events.json" if self.path else None

    def _persist_events(self) -> None:
        path = self._event_path()
        if not path:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        payload = {
            "schemaVersion": "artifact-lifecycle-events.v1",
            "events": [self.pending_events[key] for key in sorted(self.pending_events)],
        }
        tmp = f"{path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "x", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, sort_keys=True, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _load_events(self) -> None:
        with open(self._event_path() or "", encoding="utf-8") as fh:
            payload = json.load(fh)
        if payload.get("schemaVersion") != "artifact-lifecycle-events.v1":
            raise ValueError("unsupported Artifact lifecycle event schema")
        self.pending_events = {
            event["eventId"]: event for event in payload.get("events") or []
            if isinstance(event, dict) and isinstance(event.get("eventId"), str)
        }

    def _load(self) -> None:
        with open(self.path or "", encoding="utf-8") as fh:
            payload = json.load(fh)
        if payload.get("schemaVersion") != "artifact-registry.v1":
            raise ValueError("unsupported Artifact Registry schema")
        self.artifacts = {a.artifact_id: a for a in map(Artifact.from_dict, payload.get("artifacts") or [])}
        self.versions = {v.version_id: v for v in map(ArtifactVersion.from_dict, payload.get("artifactVersions") or [])}
        self.anchors = {a.anchor_id: a for a in map(SourceAnchor.from_dict, payload.get("sourceAnchors") or [])}
