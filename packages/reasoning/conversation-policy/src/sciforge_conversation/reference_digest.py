"""Python compatibility bridge for bounded workspace reference digests."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Iterable, Mapping


SCHEMA_VERSION = "sciforge.reference-digest.v1"
DEFAULT_DIGEST_CHAR_BUDGET = 1_800
DEFAULT_EXCERPT_CHAR_BUDGET = 360

JsonMap = dict[str, Any]


@dataclass(frozen=True)
class ReferenceDigestOptions:
    workspace_root: str
    digest_char_budget: int = DEFAULT_DIGEST_CHAR_BUDGET
    excerpt_char_budget: int = DEFAULT_EXCERPT_CHAR_BUDGET
    max_references: int = 12
    max_csv_rows: int = 8
    max_json_items: int = 18


@dataclass(frozen=True)
class ReferenceDigest:
    schemaVersion: str
    id: str
    sourceRef: str
    sourceType: str
    status: str
    refSafe: bool
    path: str | None = None
    clickableRef: str | None = None
    mediaType: str | None = None
    sha256: str | None = None
    sizeBytes: int | None = None
    digestText: str = ""
    excerpts: list[JsonMap] = field(default_factory=list)
    metrics: JsonMap = field(default_factory=dict)
    omitted: JsonMap = field(default_factory=dict)
    audit: JsonMap = field(default_factory=dict)

    def to_dict(self) -> JsonMap:
        return asdict(self)


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists() and (parent / "src/runtime/gateway/conversation-reference-digest.ts").exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_REFERENCE_DIGEST_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(payload: Mapping[str, Any], export_name: str) -> Any:
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = f"""
import {{ readFileSync }} from 'node:fs';
import {{ {export_name} }} from './src/runtime/gateway/conversation-reference-digest.ts';
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
        raise RuntimeError(f"workspace reference digest bridge failed: {reason}")
    return json.loads(completed.stdout or "null")


def _options_payload(options: ReferenceDigestOptions) -> JsonMap:
    return {
        "workspaceRoot": options.workspace_root,
        "digestCharBudget": options.digest_char_budget,
        "excerptCharBudget": options.excerpt_char_budget,
        "maxReferences": options.max_references,
        "maxCsvRows": options.max_csv_rows,
        "maxJsonItems": options.max_json_items,
    }


def _digest_from_payload(payload: Mapping[str, Any]) -> ReferenceDigest:
    return ReferenceDigest(
        schemaVersion=str(payload.get("schemaVersion") or SCHEMA_VERSION),
        id=str(payload.get("id") or ""),
        sourceRef=str(payload.get("sourceRef") or ""),
        sourceType=str(payload.get("sourceType") or "path"),
        status=str(payload.get("status") or "unresolved"),
        refSafe=payload.get("refSafe") is not False,
        path=payload.get("path") if isinstance(payload.get("path"), str) else None,
        clickableRef=payload.get("clickableRef") if isinstance(payload.get("clickableRef"), str) else None,
        mediaType=payload.get("mediaType") if isinstance(payload.get("mediaType"), str) else None,
        sha256=payload.get("sha256") if isinstance(payload.get("sha256"), str) else None,
        sizeBytes=payload.get("sizeBytes") if isinstance(payload.get("sizeBytes"), int) else None,
        digestText=str(payload.get("digestText") or ""),
        excerpts=payload.get("excerpts") if isinstance(payload.get("excerpts"), list) else [],
        metrics=payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {},
        omitted=payload.get("omitted") if isinstance(payload.get("omitted"), dict) else {},
        audit=payload.get("audit") if isinstance(payload.get("audit"), dict) else {},
    )


def build_reference_digests(
    references: Iterable[Any] | None = None,
    *,
    prompt: str = "",
    workspace_root: str,
    options: ReferenceDigestOptions | None = None,
) -> list[ReferenceDigest]:
    opts = options or ReferenceDigestOptions(workspace_root=workspace_root)
    payload = {
        "references": list(references or []),
        "prompt": prompt,
        "workspaceRoot": workspace_root,
        "options": _options_payload(opts),
    }
    result = _from_gateway(payload, "buildConversationReferenceDigests")
    if not isinstance(result, list):
        raise RuntimeError("workspace reference digest bridge returned a non-list payload")
    return [_digest_from_payload(item) for item in result if isinstance(item, Mapping)]


def build_reference_digests_from_request(request: Mapping[str, Any]) -> list[JsonMap]:
    result = _from_gateway(dict(request), "buildConversationReferenceDigestsFromRequest")
    if not isinstance(result, list):
        raise RuntimeError("workspace reference digest bridge returned a non-list payload")
    return [dict(item) for item in result if isinstance(item, Mapping)]
