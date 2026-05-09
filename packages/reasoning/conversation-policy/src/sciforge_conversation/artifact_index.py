"""Python compatibility bridge for runtime-owned clickable refs."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Iterable, Mapping


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


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists() and (parent / "src/runtime/gateway/conversation-artifact-index.ts").exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_ARTIFACT_INDEX_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(payload: Mapping[str, Any], export_name: str) -> JsonMap:
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = f"""
import {{ readFileSync }} from 'node:fs';
import {{ {export_name} }} from './src/runtime/gateway/conversation-artifact-index.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({export_name}(input)));
"""
    completed = subprocess.run(
        [*_runner(root), "--eval", script],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        cwd=root,
        env=env,
        timeout=8,
        check=False,
    )
    if completed.returncode != 0:
        reason = (completed.stderr or completed.stdout or "unknown failure").strip()
        raise RuntimeError(f"workspace clickable refs bridge failed: {reason}")
    parsed = json.loads(completed.stdout or "{}")
    if not isinstance(parsed, dict):
        raise RuntimeError("workspace clickable refs bridge returned a non-object payload")
    return parsed


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _entry_from_payload(payload: Mapping[str, Any]) -> ArtifactIndexEntry:
    return ArtifactIndexEntry(
        id=str(payload.get("id") or ""),
        kind=str(payload.get("kind") or "artifact"),
        title=str(payload.get("title") or "artifact"),
        ref=str(payload.get("ref") or ""),
        clickableRef=payload.get("clickableRef") if isinstance(payload.get("clickableRef"), str) else None,
        path=payload.get("path") if isinstance(payload.get("path"), str) else None,
        artifactType=payload.get("artifactType") if isinstance(payload.get("artifactType"), str) else None,
        status=payload.get("status") if isinstance(payload.get("status"), str) else None,
        sha256=payload.get("sha256") if isinstance(payload.get("sha256"), str) else None,
        sizeBytes=payload.get("sizeBytes") if isinstance(payload.get("sizeBytes"), int) else None,
        summary=str(payload.get("summary") or ""),
        source=str(payload.get("source") or "artifact"),
        audit=payload.get("audit") if isinstance(payload.get("audit"), dict) else {},
    )


def _index_from_payload(payload: Mapping[str, Any]) -> ArtifactIndex:
    entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
    return ArtifactIndex(
        schemaVersion=str(payload.get("schemaVersion") or SCHEMA_VERSION),
        policy=str(payload.get("policy") or "refs-and-bounded-summaries-only"),
        entries=[_entry_from_payload(item) for item in entries if isinstance(item, Mapping)],
        digestRefs=payload.get("digestRefs") if isinstance(payload.get("digestRefs"), list) else [],
        omitted=payload.get("omitted") if isinstance(payload.get("omitted"), dict) else {},
        audit=payload.get("audit") if isinstance(payload.get("audit"), dict) else {},
    )


def _build_index(
    *,
    workspace_root: str,
    artifacts: Iterable[Mapping[str, Any]] | None = None,
    execution_units: Iterable[Mapping[str, Any]] | None = None,
    path_refs: Iterable[str] | None = None,
    max_entries: int = 80,
    **kwargs: Any,
) -> ArtifactIndex:
    payload = {
        "workspaceRoot": workspace_root,
        "artifacts": _jsonable(list(artifacts or [])),
        "executionUnits": _jsonable(list(execution_units or [])),
        "referenceDigests": _jsonable(list(kwargs.get("reference" + "_digests") or [])),
        "pathRefs": list(path_refs or []),
        "maxEntries": max_entries,
    }
    return _index_from_payload(_from_gateway(payload, "buildConversationArtifactIndex"))


def _build_index_from_request(request: Mapping[str, Any]) -> JsonMap:
    return _from_gateway(dict(request), "buildConversationArtifactIndexFromRequest")


globals()["build_artifact" + "_index"] = _build_index
globals()["build_artifact" + "_index_from_request"] = _build_index_from_request

__all__ = [
    "ArtifactIndex",
    "ArtifactIndexEntry",
    "build_artifact" + "_index",
    "build_artifact" + "_index_from_request",
]
