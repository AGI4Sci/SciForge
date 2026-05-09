"""Bounded, auditable digests for current-turn references.

The digest layer is deliberately ref-first: it records file refs, hashes,
sizes, structure, and short excerpts, but never returns a whole large source
document for handoff context.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping


SCHEMA_VERSION = "sciforge.reference-digest.v1"
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl"}
MAX_READ_BYTES = 1_000_000
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


def build_reference_digests(
    references: Iterable[Any] | None = None,
    *,
    prompt: str = "",
    workspace_root: str,
    options: ReferenceDigestOptions | None = None,
) -> list[ReferenceDigest]:
    """Resolve explicit refs plus prompt path mentions into bounded digests."""

    opts = options or ReferenceDigestOptions(workspace_root=workspace_root)
    root = Path(opts.workspace_root).expanduser().resolve()
    candidates = _expand_prompt_refs(
        _unique_refs([*_refs_from_values(references or []), *_refs_from_prompt(prompt)]),
        root,
    )
    digests: list[ReferenceDigest] = []
    omitted = 0
    for source_ref in candidates:
        if len(digests) >= opts.max_references:
            omitted += 1
            continue
        digests.append(digest_reference(source_ref, opts, workspace_root=root))
    if omitted and digests:
        digests[-1].omitted["referencesAfterLimit"] = omitted
    return digests


def digest_reference(
    source_ref: str | Mapping[str, Any],
    options: ReferenceDigestOptions,
    *,
    workspace_root: Path | None = None,
) -> ReferenceDigest:
    root = workspace_root or Path(options.workspace_root).expanduser().resolve()
    ref_text = _source_ref_text(source_ref)
    resolved = _resolve_workspace_path(ref_text, root)
    digest_id = _digest_id(ref_text)
    base_audit = {"sourceRef": ref_text, "workspaceRoot": str(root), "maxReadBytes": MAX_READ_BYTES}

    if resolved is None:
        return ReferenceDigest(
            schemaVersion=SCHEMA_VERSION,
            id=digest_id,
            sourceRef=ref_text,
            sourceType="path",
            status="unresolved",
            refSafe=True,
            digestText="Reference path was not readable inside the workspace.",
            omitted={"rawContent": "not-read"},
            audit={**base_audit, "reason": "outside-workspace-or-missing"},
        )

    path, rel = resolved
    if not path.is_file():
        return ReferenceDigest(
            schemaVersion=SCHEMA_VERSION,
            id=digest_id,
            sourceRef=ref_text,
            sourceType="path",
            status="unreadable",
            refSafe=True,
            path=rel,
            clickableRef=f"file:{rel}",
            digestText="Reference exists but is not a regular file.",
            omitted={"rawContent": "not-regular-file"},
            audit=base_audit,
        )

    stat = path.stat()
    suffix = path.suffix.lower()
    sha = _sha256_file(path)
    common = {
        "schemaVersion": SCHEMA_VERSION,
        "id": digest_id,
        "sourceRef": ref_text,
        "path": rel,
        "clickableRef": f"file:{rel}",
        "sha256": sha,
        "sizeBytes": stat.st_size,
        "refSafe": True,
        "audit": {**base_audit, "reader": "bounded"},
    }

    if suffix == ".pdf":
        return ReferenceDigest(
            **common,
            sourceType="pdf",
            status="unsupported",
            mediaType="application/pdf",
            digestText="PDF reference recorded with hash and size; text extraction is not enabled yet.",
            omitted={"rawContent": "pdf-extraction-unavailable", "bytes": stat.st_size},
        )

    if suffix not in TEXT_EXTENSIONS:
        return ReferenceDigest(
            **common,
            sourceType="path",
            status="metadata-only",
            mediaType=_media_type(suffix),
            digestText="Non-text reference recorded as metadata only.",
            omitted={"rawContent": "non-text-file", "bytes": stat.st_size},
        )

    text, truncated_bytes = _read_bounded_text(path)
    kind = _source_type_for_path(path)
    summary = _summarize_text_kind(text, kind, options)
    digest_text, truncated_chars = _clip_ref_safe(summary["digestText"], options.digest_char_budget)
    excerpts = _bounded_excerpts(summary["excerpts"], options.excerpt_char_budget)
    omitted = dict(summary.get("omitted") or {})
    if truncated_bytes:
        omitted["readBytesAfterLimit"] = truncated_bytes
    if truncated_chars:
        omitted["digestCharsAfterLimit"] = truncated_chars
    return ReferenceDigest(
        **common,
        sourceType=kind,
        status="ok",
        mediaType=_media_type(suffix),
        digestText=digest_text,
        excerpts=excerpts,
        metrics=summary.get("metrics") or {},
        omitted=omitted,
    )


def build_reference_digests_from_request(request: Mapping[str, Any]) -> list[JsonMap]:
    workspace = request.get("workspace") if isinstance(request.get("workspace"), Mapping) else {}
    limits = request.get("limits") if isinstance(request.get("limits"), Mapping) else {}
    workspace_root = str(workspace.get("root") or request.get("workspaceRoot") or ".")
    opts = ReferenceDigestOptions(
        workspace_root=workspace_root,
        digest_char_budget=int(limits.get("maxDigestChars") or limits.get("maxInlineChars") or DEFAULT_DIGEST_CHAR_BUDGET),
        excerpt_char_budget=int(limits.get("maxExcerptChars") or DEFAULT_EXCERPT_CHAR_BUDGET),
        max_references=int(limits.get("maxReferences") or 12),
    )
    turn = request.get("turn") if isinstance(request.get("turn"), Mapping) else {}
    digests = build_reference_digests(
        turn.get("references") if isinstance(turn.get("references"), list) else request.get("references") if isinstance(request.get("references"), list) else [],
        prompt=str(turn.get("prompt") or request.get("prompt") or ""),
        workspace_root=workspace_root,
        options=opts,
    )
    return [digest.to_dict() for digest in digests]


def _refs_from_values(values: Iterable[Any]) -> list[str]:
    refs: list[str] = []
    for value in values:
        if isinstance(value, str):
            refs.append(value)
        elif isinstance(value, Mapping):
            for key in ("ref", "path", "dataRef", "artifactRef", "url"):
                item = value.get(key)
                if isinstance(item, str) and item:
                    refs.append(item)
                    break
    return refs


def _refs_from_prompt(prompt: str) -> list[str]:
    if not prompt:
        return []
    pattern = re.compile(r"(?:file:)?(?:[./~]?[\w@%+=:,.-]+/)*[\w@%+=:,.-]+\.(?:md|markdown|json|jsonl|csv|tsv|txt|pdf)\b")
    return [match.group(0) for match in pattern.finditer(prompt)]


def _unique_refs(refs: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for ref in refs:
        clean = ref.strip().strip("`'\"")
        if not clean or clean in seen:
            continue
        seen.add(clean)
        unique.append(clean)
    return unique


def _expand_prompt_refs(refs: list[str], root: Path) -> list[str]:
    normalized = [_normalize_workspace_ref(ref) for ref in refs]
    sibling_dirs = [
        str(Path(ref).parent)
        for ref in normalized
        if "/" in ref and str(Path(ref).parent) != "."
    ]
    expanded: list[str] = []
    for ref in normalized:
        if "/" in ref or (root / ref).exists():
            expanded.append(ref)
            continue
        sibling = _resolve_in_sibling_dirs(ref, sibling_dirs, root)
        expanded.append(sibling or ref)
    return _unique_refs(expanded)


def _normalize_workspace_ref(ref: str) -> str:
    clean = ref.strip().removeprefix("file:").removeprefix("./")
    if clean.startswith("workspace/"):
        clean = clean[len("workspace/") :]
    return clean


def _resolve_in_sibling_dirs(ref: str, sibling_dirs: list[str], root: Path) -> str | None:
    for directory in sibling_dirs:
        candidate = f"{directory}/{ref}"
        if (root / candidate).exists():
            return candidate
    matches = list(root.rglob(ref))
    matches = [path for path in matches if path.is_file() and ".git" not in path.parts and "node_modules" not in path.parts]
    if len(matches) == 1:
        return matches[0].relative_to(root).as_posix()
    return None


def _source_ref_text(source_ref: str | Mapping[str, Any]) -> str:
    if isinstance(source_ref, str):
        return source_ref.strip()
    for key in ("ref", "path", "dataRef", "artifactRef", "url"):
        value = source_ref.get(key)
        if isinstance(value, str) and value:
            return value.strip()
    return str(source_ref)


def _resolve_workspace_path(ref: str, root: Path) -> tuple[Path, str] | None:
    clean = _normalize_workspace_ref(ref).split("#", 1)[0]
    if "://" in clean:
        return None
    candidate = Path(clean).expanduser()
    path = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        return None
    if not path.exists():
        return None
    return path, rel


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 128), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_bounded_text(path: Path) -> tuple[str, int]:
    data = path.read_bytes()
    truncated = max(0, len(data) - MAX_READ_BYTES)
    text = data[:MAX_READ_BYTES].decode("utf-8", errors="replace")
    return text.replace("\x00", ""), truncated


def _source_type_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in {".json", ".jsonl"}:
        return "json"
    if suffix in {".csv", ".tsv"}:
        return "csv"
    return "text"


def _summarize_text_kind(text: str, kind: str, options: ReferenceDigestOptions) -> JsonMap:
    if kind == "markdown":
        return _summarize_markdown(text)
    if kind == "json":
        return _summarize_json(text, options.max_json_items)
    if kind == "csv":
        return _summarize_csv(text, options.max_csv_rows)
    return _summarize_plain_text(text)


def _summarize_markdown(text: str) -> JsonMap:
    lines = [line.rstrip() for line in text.splitlines()]
    headings = [line.strip("# ").strip() for line in lines if re.match(r"^#{1,6}\s+", line)]
    bullets = [line.strip(" -*\t") for line in lines if re.match(r"^\s*[-*]\s+", line)]
    tables = [line.strip() for line in lines if "|" in line and len(line.strip()) > 3]
    excerpts = _line_excerpts(lines, include=lambda line: bool(line.strip()) and not re.match(r"^\s*[-#|]", line), limit=4)
    digest_lines = [
        f"Markdown digest: headings={len(headings)}, bullets={len(bullets)}, tableLines={len(tables)}.",
    ]
    if headings:
        digest_lines.append("Headings: " + "; ".join(_scrub_inline(item) for item in headings[:8]))
    if bullets:
        digest_lines.append("Representative bullets: " + "; ".join(_scrub_inline(item) for item in bullets[:5]))
    return {
        "digestText": "\n".join(digest_lines),
        "excerpts": excerpts,
        "metrics": {"lineCount": len(lines), "headingCount": len(headings), "bulletCount": len(bullets), "tableLineCount": len(tables)},
        "omitted": {"headingsAfterLimit": max(0, len(headings) - 8), "bulletsAfterLimit": max(0, len(bullets) - 5)},
    }


def _summarize_json(text: str, max_items: int) -> JsonMap:
    try:
        value = json.loads(text)
    except Exception as exc:
        return {
            "digestText": f"JSON digest: parse failed ({type(exc).__name__}); using bounded text preview only.",
            "excerpts": _line_excerpts(text.splitlines(), include=lambda line: bool(line.strip()), limit=4),
            "metrics": {"parseOk": False},
            "omitted": {},
        }
    paths: list[str] = []
    scalars: list[str] = []
    _walk_json(value, "$", paths, scalars, max_items)
    top_keys = sorted(value.keys()) if isinstance(value, dict) else []
    digest_lines = [f"JSON digest: root={type(value).__name__}, topKeys={', '.join(top_keys[:12]) or 'n/a'}."]
    if paths:
        digest_lines.append("Observed paths: " + "; ".join(paths[:max_items]))
    if scalars:
        digest_lines.append("Scalar samples: " + "; ".join(scalars[: min(8, max_items)]))
    return {
        "digestText": "\n".join(digest_lines),
        "excerpts": [],
        "metrics": {"parseOk": True, "topKeyCount": len(top_keys), "observedPathCount": len(paths)},
        "omitted": {"jsonPathsAfterLimit": max(0, len(paths) - max_items)},
    }


def _summarize_csv(text: str, max_rows: int) -> JsonMap:
    sample = text.splitlines()[: max_rows + 1]
    delimiter = "\t" if sample and "\t" in sample[0] and "," not in sample[0] else ","
    rows = list(csv.reader(sample, delimiter=delimiter))
    header = rows[0] if rows else []
    data_rows = rows[1:]
    excerpts = [
        {"kind": "csv-row", "row": index + 1, "text": _scrub_inline(dict(zip(header, row)).__repr__() if header else ", ".join(row))}
        for index, row in enumerate(data_rows[:max_rows])
    ]
    total_lines = len(text.splitlines())
    digest = f"CSV digest: columns={len(header)}, sampledRows={len(data_rows)}, totalLines={total_lines}. Headers: {', '.join(header[:24]) or 'n/a'}."
    return {
        "digestText": digest,
        "excerpts": excerpts,
        "metrics": {"columnCount": len(header), "sampledRowCount": len(data_rows), "lineCount": total_lines},
        "omitted": {"rowsAfterSample": max(0, total_lines - 1 - len(data_rows))},
    }


def _summarize_plain_text(text: str) -> JsonMap:
    lines = text.splitlines()
    return {
        "digestText": f"Text digest: lines={len(lines)}, nonEmptyLines={sum(1 for line in lines if line.strip())}.",
        "excerpts": _line_excerpts(lines, include=lambda line: bool(line.strip()), limit=6),
        "metrics": {"lineCount": len(lines)},
        "omitted": {},
    }


def _walk_json(value: Any, path: str, paths: list[str], scalars: list[str], max_items: int) -> None:
    if len(paths) >= max_items * 2:
        return
    if isinstance(value, Mapping):
        paths.append(f"{path}{{keys={len(value)}}}")
        for key, child in list(value.items())[:max_items]:
            _walk_json(child, f"{path}.{key}", paths, scalars, max_items)
    elif isinstance(value, list):
        paths.append(f"{path}[len={len(value)}]")
        for index, child in enumerate(value[: min(3, max_items)]):
            _walk_json(child, f"{path}[{index}]", paths, scalars, max_items)
    elif value is not None and len(scalars) < max_items:
        scalars.append(f"{path}={_scrub_inline(str(value))}")


def _line_excerpts(lines: list[str], *, include: Any, limit: int) -> list[JsonMap]:
    excerpts: list[JsonMap] = []
    for index, line in enumerate(lines, start=1):
        if include(line):
            text = _scrub_inline(line)
            if len(text) > 240:
                text = f"[long-line omitted chars={len(text)} sha1={hashlib.sha1(text.encode('utf-8', errors='replace')).hexdigest()[:12]}]"
            excerpts.append({"kind": "line", "lineStart": index, "lineEnd": index, "text": text})
        if len(excerpts) >= limit:
            break
    return excerpts


def _bounded_excerpts(excerpts: list[JsonMap], budget: int) -> list[JsonMap]:
    bounded: list[JsonMap] = []
    for excerpt in excerpts:
        item = dict(excerpt)
        text, truncated = _clip_ref_safe(str(item.get("text") or ""), budget)
        item["text"] = text
        if truncated:
            item["truncatedChars"] = truncated
        bounded.append(item)
    return bounded


def _clip_ref_safe(text: str, budget: int) -> tuple[str, int]:
    scrubbed = _scrub_inline(text)
    if len(scrubbed) <= budget:
        return scrubbed, 0
    marker = f"... [truncated {len(scrubbed) - budget} chars]"
    return scrubbed[: max(0, budget - len(marker))].rstrip() + marker, len(scrubbed) - budget


def _scrub_inline(text: str) -> str:
    text = re.sub(r"data:[^,\s]+,[A-Za-z0-9+/=_-]{80,}", "[data-url-redacted]", text)
    text = re.sub(r"\b[A-Za-z0-9+/]{240,}={0,2}\b", "[long-token-redacted]", text)
    return re.sub(r"\s+", " ", text).strip()


def _media_type(suffix: str) -> str:
    return {
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".json": "application/json",
        ".jsonl": "application/jsonl",
        ".csv": "text/csv",
        ".tsv": "text/tab-separated-values",
        ".txt": "text/plain",
        ".pdf": "application/pdf",
    }.get(suffix, "application/octet-stream")


def _digest_id(ref: str) -> str:
    return "ref-digest-" + hashlib.sha1(ref.encode("utf-8", errors="replace")).hexdigest()[:12]
