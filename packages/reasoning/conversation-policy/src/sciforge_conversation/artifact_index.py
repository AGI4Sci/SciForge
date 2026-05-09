"""Clickable, ref-safe artifact index construction."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from .reference_digest import ReferenceDigest, ReferenceDigestOptions, build_reference_digests


SCHEMA_VERSION = "sciforge.artifact-index.v1"


JsonMap = dict[str, Any]


@dataclass(frozen=True)
class ArtifactIndexEntry:
    id: str
    kind: str
    title: str
    ref: str
    clickableRef: str | None = None
    path: str | None = None
    artifactType: str | None = None
    status: str | None = None
    sha256: str | None = None
    sizeBytes: int | None = None
    summary: str = ""
    source: str = "artifact"
    audit: JsonMap = field(default_factory=dict)


@dataclass(frozen=True)
class ArtifactIndex:
    schemaVersion: str
    policy: str
    entries: list[ArtifactIndexEntry]
    digestRefs: list[str] = field(default_factory=list)
    omitted: JsonMap = field(default_factory=dict)
    audit: JsonMap = field(default_factory=dict)

    def to_dict(self) -> JsonMap:
        value = asdict(self)
        value["entries"] = [asdict(entry) for entry in self.entries]
        return value


def build_artifact_index(
    *,
    workspace_root: str,
    artifacts: Iterable[Mapping[str, Any]] | None = None,
    execution_units: Iterable[Mapping[str, Any]] | None = None,
    reference_digests: Iterable[ReferenceDigest | Mapping[str, Any]] | None = None,
    path_refs: Iterable[str] | None = None,
    max_entries: int = 80,
) -> ArtifactIndex:
    """Build a compact artifact/ref index suitable for handoff."""

    root = Path(workspace_root).expanduser().resolve()
    entries: list[ArtifactIndexEntry] = []
    omitted: JsonMap = {"entriesAfterLimit": 0, "inlinePayloads": 0, "unresolvedRefs": 0}

    for artifact in artifacts or []:
        _append(entries, _entry_from_artifact(artifact, root, omitted), max_entries, omitted)

    for unit in execution_units or []:
        for entry in _entries_from_execution_unit(unit, root, omitted):
            _append(entries, entry, max_entries, omitted)

    digest_refs: list[str] = []
    for digest in reference_digests or []:
        entry = _entry_from_digest(digest)
        if entry.clickableRef:
            digest_refs.append(entry.clickableRef)
        _append(entries, entry, max_entries, omitted)

    if path_refs:
        digests = build_reference_digests(
            list(path_refs),
            workspace_root=str(root),
            options=ReferenceDigestOptions(workspace_root=str(root), max_references=max_entries),
        )
        for digest in digests:
            entry = _entry_from_digest(digest)
            if entry.clickableRef:
                digest_refs.append(entry.clickableRef)
            _append(entries, entry, max_entries, omitted)

    entries = _dedupe_entries(entries)
    return ArtifactIndex(
        schemaVersion=SCHEMA_VERSION,
        policy="refs-and-bounded-summaries-only",
        entries=entries,
        digestRefs=_unique(digest_refs),
        omitted={key: value for key, value in omitted.items() if value},
        audit={"workspaceRoot": str(root), "entryCount": len(entries), "refSafe": True},
    )


def build_artifact_index_from_request(request: Mapping[str, Any]) -> JsonMap:
    workspace = request.get("workspace") if isinstance(request.get("workspace"), Mapping) else {}
    session = request.get("session") if isinstance(request.get("session"), Mapping) else {}
    limits = request.get("limits") if isinstance(request.get("limits"), Mapping) else {}
    index = build_artifact_index(
        workspace_root=str(workspace.get("root") or request.get("workspaceRoot") or "."),
        artifacts=session.get("artifacts") if isinstance(session.get("artifacts"), list) else [],
        execution_units=session.get("executionUnits") if isinstance(session.get("executionUnits"), list) else [],
        reference_digests=request.get("currentReferenceDigests") if isinstance(request.get("currentReferenceDigests"), list) else [],
        path_refs=request.get("pathRefs") if isinstance(request.get("pathRefs"), list) else [],
        max_entries=int(limits.get("maxArtifactIndexEntries") or 80),
    )
    return index.to_dict()


def _append(entries: list[ArtifactIndexEntry], entry: ArtifactIndexEntry | None, max_entries: int, omitted: JsonMap) -> None:
    if entry is None:
        return
    if len(entries) >= max_entries:
        omitted["entriesAfterLimit"] += 1
        return
    entries.append(entry)


def _entry_from_artifact(artifact: Mapping[str, Any], root: Path, omitted: JsonMap) -> ArtifactIndexEntry | None:
    ref = _first_text(artifact.get("ref"), artifact.get("dataRef"), artifact.get("path"), artifact.get("url"))
    if not ref:
        if any(key in artifact for key in ("data", "content", "markdown", "text", "payload")):
            omitted["inlinePayloads"] += 1
        return None
    path_meta = _path_metadata(ref, root)
    if path_meta is None and _looks_file_ref(ref):
        omitted["unresolvedRefs"] += 1
    summary = _bounded_summary(_first_text(artifact.get("summary"), artifact.get("title"), artifact.get("name")) or "")
    artifact_id = _first_text(artifact.get("id")) or _stable_id("artifact", ref)
    return ArtifactIndexEntry(
        id=artifact_id,
        kind="artifact",
        title=_first_text(artifact.get("title"), artifact.get("name"), artifact.get("type"), ref) or "artifact",
        ref=ref,
        clickableRef=path_meta.get("clickableRef") if path_meta else _clickable_ref(ref),
        path=path_meta.get("path") if path_meta else None,
        artifactType=_first_text(artifact.get("type"), artifact.get("artifactType")),
        status=_first_text(artifact.get("status")),
        sha256=path_meta.get("sha256") if path_meta else _first_text(artifact.get("sha256")),
        sizeBytes=path_meta.get("sizeBytes") if path_meta else _int_or_none(artifact.get("sizeBytes")),
        summary=summary,
        source="artifact",
        audit={"inlineFieldsExcluded": [key for key in ("data", "content", "markdown", "text", "payload") if key in artifact]},
    )


def _entries_from_execution_unit(unit: Mapping[str, Any], root: Path, omitted: JsonMap) -> list[ArtifactIndexEntry]:
    entries: list[ArtifactIndexEntry] = []
    unit_id = _first_text(unit.get("id")) or _stable_id("execution", str(unit))
    for key in ("outputRef", "stdoutRef", "stderrRef", "codeRef", "traceRef", "diffRef", "patchRef"):
        value = _first_text(unit.get(key))
        if not value:
            continue
        meta = _path_metadata(value, root)
        if meta is None and _looks_file_ref(value):
            omitted["unresolvedRefs"] += 1
        entries.append(
            ArtifactIndexEntry(
                id=_stable_id(unit_id, key, value),
                kind="execution-ref",
                title=f"{unit_id} {key}",
                ref=value,
                clickableRef=meta.get("clickableRef") if meta else _clickable_ref(value),
                path=meta.get("path") if meta else None,
                status=_first_text(unit.get("status")),
                sha256=meta.get("sha256") if meta else None,
                sizeBytes=meta.get("sizeBytes") if meta else None,
                summary=_bounded_summary(_first_text(unit.get("summary"), unit.get("failureReason")) or ""),
                source="executionUnit",
                audit={"executionUnitId": unit_id, "field": key},
            )
        )
    for log in unit.get("logs") if isinstance(unit.get("logs"), list) else []:
        if isinstance(log, Mapping):
            value = _first_text(log.get("ref"), log.get("path"))
            if value:
                meta = _path_metadata(value, root)
                entries.append(
                    ArtifactIndexEntry(
                        id=_stable_id(unit_id, "log", value),
                        kind="log-ref",
                        title=f"{unit_id} {_first_text(log.get('kind')) or 'log'}",
                        ref=value,
                        clickableRef=meta.get("clickableRef") if meta else _clickable_ref(value),
                        path=meta.get("path") if meta else None,
                        status=_first_text(unit.get("status")),
                        sha256=meta.get("sha256") if meta else None,
                        sizeBytes=meta.get("sizeBytes") if meta else None,
                        summary="",
                        source="executionUnit",
                        audit={"executionUnitId": unit_id, "field": "logs"},
                    )
                )
    return entries


def _entry_from_digest(digest: ReferenceDigest | Mapping[str, Any]) -> ArtifactIndexEntry:
    data = digest.to_dict() if isinstance(digest, ReferenceDigest) else dict(digest)
    ref = _first_text(data.get("clickableRef"), data.get("sourceRef"), data.get("path")) or "reference"
    return ArtifactIndexEntry(
        id=_first_text(data.get("id")) or _stable_id("digest", ref),
        kind="reference-digest",
        title=f"{_first_text(data.get('sourceType')) or 'reference'} digest",
        ref=ref,
        clickableRef=_first_text(data.get("clickableRef")),
        path=_first_text(data.get("path")),
        artifactType="reference-digest",
        status=_first_text(data.get("status")),
        sha256=_first_text(data.get("sha256")),
        sizeBytes=_int_or_none(data.get("sizeBytes")),
        summary=_bounded_summary(_first_text(data.get("digestText")) or ""),
        source="referenceDigest",
        audit={"sourceRef": _first_text(data.get("sourceRef")), "refSafe": data.get("refSafe") is not False},
    )


def _path_metadata(ref: str, root: Path) -> JsonMap | None:
    clean = ref.removeprefix("file:").split("#", 1)[0]
    if "://" in clean:
        return None
    candidate = Path(clean).expanduser()
    path = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        return None
    if not path.is_file():
        return None
    return {"path": rel, "clickableRef": f"file:{rel}", "sha256": _sha256(path), "sizeBytes": path.stat().st_size}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 128), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _dedupe_entries(entries: list[ArtifactIndexEntry]) -> list[ArtifactIndexEntry]:
    seen: set[str] = set()
    deduped: list[ArtifactIndexEntry] = []
    for entry in entries:
        key = entry.clickableRef or entry.ref or entry.id
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


def _bounded_summary(value: str, budget: int = 420) -> str:
    clean = " ".join(value.split())
    if len(clean) <= budget:
        return clean
    marker = f"... [truncated {len(clean) - budget} chars]"
    return clean[: max(0, budget - len(marker))].rstrip() + marker


def _clickable_ref(ref: str) -> str | None:
    return ref if ref.startswith("file:") else None


def _looks_file_ref(ref: str) -> bool:
    return ref.startswith("file:") or "/" in ref or "\\" in ref


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _stable_id(*parts: str) -> str:
    joined = ":".join(parts)
    return "artifact-index-" + hashlib.sha1(joined.encode("utf-8", errors="replace")).hexdigest()[:12]


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
