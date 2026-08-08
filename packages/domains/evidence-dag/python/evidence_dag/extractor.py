"""Trace -> DAG extractor (1A core).

Renders an AgentRuntime trace (local runtime/Codex timeline items, each with a stable step id)
into text, asks the LLM for a typed claim-evidence graph as structured JSON,
then builds a ThreadGraph with shared-node dedup. The LLM only *extracts and
classifies* — it does not reason about or judge the science.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any, Optional
from urllib.parse import quote, unquote, urlparse

from .artifact_versions import ArtifactVersionProjectionClient, ArtifactVersionProjectionError
from .graph import ThreadGraph
from .lineage import ingest_trace_lineage
from .llm import (
    LLM,
    MAX_ADAPTIVE_OUTPUT_TOKENS,
    STRUCTURED_EXTRACTION_INITIAL_OUTPUT_TOKENS,
)
from .model import EdgeRel, NodeType

_MAX_EXTRACTION_ATTEMPTS = 2

SYSTEM_PROMPT = """EDAG-TASK: extract
You convert an AI agent's trace into a typed claim-evidence graph. You ONLY
extract and classify what is already present; you NEVER add facts, reason about
correctness, or judge the science.

Node types:
- source_assertion: a concrete assertion from an external piece of evidence. `content` MUST be
  WHAT the source actually found/says — a concrete one-sentence finding, NOT just
  its title. Put the title / arXiv id / url / doi in `ref`.
  GOOD: content="Calibrated language models must hallucinate at a rate tied to the
  fraction of facts seen once in training", ref={"citation":"arXiv:2311.14648"}.
  BAD: content="[2311.14648] Calibrated Language Models Must Hallucinate".
  CRITICAL — a NAMED study, trial, dataset, guideline, review, or paper is a
  `source_assertion`, EVEN when the agent merely cites it inside its own prose (no separate
  tool call/url). "The PREDIMED trial randomized 7,447 ...", "Dinu 2017 umbrella
  review found ...", "AHA/ACC 2019 guidelines recommend ..." are all `source`
  nodes (capture the finding in `content`, the name in `ref.citation`) — they are
  NOT reasoning. If a sentence reports what some external study/guideline says, it
  is a source; reasoning is the agent's OWN inference ABOUT those sources.
  For every source ALSO classify it:
  • `source_type` ∈ paper|preprint|guideline|dataset|news|blog|web|unknown
    (peer-reviewed article=paper; arXiv/bioRxiv etc.=preprint; clinical/officially
    issued recommendation=guideline; a dataset/registry=dataset; journalism=news;
    personal/company post=blog; a generic web page=web; can't tell=unknown).
  • `credibility` ∈ high|medium|low — judge THIS SPECIFIC source's trustworthiness,
    not just its type: a major peer-reviewed journal, a large RCT, an official
    guideline, or a reputable outlet (e.g. BBC, Reuters, Nature) → high; a small/
    unknown study, preprint, or mainstream-but-not-specialist outlet → medium; an
    anonymous blog, forum post, marketing page, or low-reputation site → low.
- reasoning: ONE distinct inference/analysis step the AGENT performs — weighing,
  comparing, generalizing, or qualifying the sources. NOT a restatement of what a
  cited study says (that is a `source`). Emit a SEPARATE reasoning node per
  distinct step, comparison, trade-off, or sub-conclusion. NEVER collapse a whole
  multi-step analysis into a single node.
- claim: a specific assertion/conclusion the agent stated.

Edge relations (src -> dst):
- supports:     src is evidence for dst (evidence -> conclusion)
- contradicts:  src conflicts with dst (extract it; do NOT resolve it)
- refines:      src refines/qualifies dst
- prerequisite: src must hold before dst

Extraction guidance (this is what makes the DAG informative):
- DECOMPOSE: prefer several focused nodes over one big blob. A long synthesis is
  multiple reasoning nodes plus the distinct claims it yields.
- FIND CONTRADICTIONS: actively look for tension/disagreement — between two
  sources, a source and a claim, or two claims (e.g. "scaling reduces errors" vs
  "larger models hallucinate more"). Emit `contradicts` edges for them; never drop
  a disagreement by making everything `supports`.
- CONNECT SPECIFICALLY: link each source to the SPECIFIC claim/reasoning it bears
  on. Do NOT funnel every source into one hub node.
- WIRE EVIDENCE TO CONCLUSIONS DIRECTLY: a claim must be reachable from the source
  evidence that backs it. When a source's finding directly supports a claim, emit
  `source -> claim` (do NOT detour through a reasoning paraphrase). Only insert a
  reasoning node between them when the agent actually adds an inference step.
- NO DANGLING REASONING: every reasoning node needs an incoming edge from the
  source(s) or upstream reasoning it is built on. A reasoning node with no
  incoming evidence usually means it was really a `source_assertion` (a restated finding) —
  reclassify it as `source_assertion`, or connect the evidence it draws on.
- Use `refines` when one statement narrows/qualifies another; `prerequisite` when
  one must hold before another.

Rules:
- The SAME evidence referenced in multiple steps must be ONE node (reuse tmp_id).
- Every node MUST set `trace_ref` to the EXACT id shown inside the [ ] brackets at
  the start of the trace line it came from. COPY that token verbatim — do not
  invent, renumber, or abbreviate it (ids look arbitrary, e.g. "item_7f3a", not "step-N").
- Output STRICT JSON only, no prose, no code fences:
{"nodes":[{"tmp_id":"n1","type":"source_assertion|reasoning|claim|finding|assumption","content":"...",
"trace_ref":"<exact id copied from the [ ] bracket>","ref":{"url":"...","doi":"...","citation":"..."},
"artifact":{"kind":"paper|dataset|code|notebook|image|log|model|other","locator":"URL, DOI, SWHID, or workspace-relative path","contentDigest":"sha256:...","version":"...","mediaType":"..."},
"selector":{"type":"pdf|text|table|figure|code|dataset|web","page":1,"section":"...","table":"...","figure":"...","rowRange":"1:4","columnNames":["..."],"lineRange":"1:4","quote":"exact bounded excerpt"},
"source_type":"paper|preprint|guideline|dataset|news|blog|web|unknown","credibility":"high|medium|low",
"reasoning_type":"deduction|induction|synthesis"}],
"edges":[{"src":"n1","dst":"n2","rel":"supports|contradicts|refines|prerequisite"}]}
`ref`/`artifact`/`selector`/`source_type`/`credibility` only on source_assertion nodes.
Never invent contentDigest. A selector quote must be exact source text, not a paraphrase.
Omit unknown fields; `reasoning_type` only on reasoning."""


class ExtractionOutputError(RuntimeError):
    """Typed structured-output failure without reflecting model output."""

    def __init__(self, code: str, detail: str, *, attempts: int = 1) -> None:
        self.code = code
        self.detail = detail
        self.attempts = attempts
        super().__init__(
            f"Evidence extraction failed after {attempts} attempts: {code}: {detail}"
        )


def render_trace(trace: list[dict]) -> str:
    """Flatten timeline items into '[step <id>] <kind>: <text>' lines."""
    lines: list[str] = []
    for item in trace:
        sid = _trace_id(item) or f"step-{len(lines)}"
        kind = _trace_kind(item)
        if kind in ("tool_call", "function_call"):
            name = _tool_name(item)
            args = item.get("arguments") or item.get("args") or ""
            text = f"call {name}({_short(args, 800)})"
        elif kind in ("tool_result", "function_result", "tool_output"):
            name = _tool_name(item)
            text = f"result of {name}: {_short(_trace_payload(item), 2000)}"
        else:
            # messages carry the agent's actual reasoning & final answer — keep
            # much more so the structure (tables, contradictions, factors) survives.
            role = item.get("role", "")
            text = _short(_trace_payload(item), 6000)
            if role:
                text = f"({role}) {text}"
        lines.append(f"[{sid}] {kind}: {text}")
    return "\n".join(lines)


def _trace_id(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("step_id") or item.get("stepId") or "").strip()


def _trace_source_id(item: dict[str, Any]) -> str:
    return str(item.get("source_item_id") or item.get("sourceItemId") or _trace_id(item)).strip()


def _trace_kind(item: dict[str, Any]) -> str:
    return str(item.get("type") or item.get("kind") or "message").strip().lower()


def _tool_name(item: dict[str, Any]) -> str:
    return str(item.get("tool_name") or item.get("toolName") or item.get("name") or "tool").strip()


def _trace_payload(item: dict[str, Any]) -> Any:
    kind = _trace_kind(item)
    if kind in {"tool_result", "function_result", "tool_output"}:
        for key in ("output", "content", "result", "text"):
            if item.get(key) not in (None, ""):
                return item[key]
        return ""
    for key in ("content", "text", "output"):
        if item.get(key) not in (None, ""):
            return item[key]
    return ""


def _short(value: Any, limit: int = 1200) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[:limit] + " …"


def _parse_json(raw: object) -> dict:
    if not isinstance(raw, str):
        raise ExtractionOutputError(
            "extractor_invalid_output_type",
            "Structured extraction output must be text containing a JSON object.",
        )
    raw = raw.strip()
    if not raw:
        raise ExtractionOutputError(
            "extractor_empty_output",
            "The model returned no structured extraction output.",
        )
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    if not raw:
        raise ExtractionOutputError(
            "extractor_empty_output",
            "The model returned no structured extraction output.",
        )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as original:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                parsed = json.loads(raw[start:end + 1])
            except json.JSONDecodeError as exc:
                raise ExtractionOutputError(
                    "extractor_invalid_json",
                    f"Structured output was invalid JSON at line {exc.lineno}, column {exc.colno}.",
                ) from exc
        else:
            raise ExtractionOutputError(
                "extractor_invalid_json",
                f"Structured output was invalid JSON at line {original.lineno}, column {original.colno}.",
            ) from original
    if not isinstance(parsed, dict):
        raise ExtractionOutputError(
            "extractor_invalid_shape",
            "Structured extraction output must be a JSON object.",
        )
    return parsed


def extract_dag(
    trace: list[dict],
    llm: LLM,
    thread_id: str,
    *,
    created_by: str = "extractor",
    created_at: Optional[str] = None,
    artifact_versions: Optional[ArtifactVersionProjectionClient] = None,
) -> ThreadGraph:
    rendered = render_trace(trace)
    trace_prompt = f"TRACE (thread {thread_id}):\n{rendered}"
    last_error: Optional[ExtractionOutputError] = None
    parsed: dict[str, Any] = {}
    for attempt in range(1, _MAX_EXTRACTION_ATTEMPTS + 1):
        repair_instruction = ""
        if last_error is not None:
            repair_instruction = (
                "\n\nYour previous response could not be accepted "
                f"({last_error.code}). Re-run the extraction from the TRACE and return one "
                "complete, non-empty JSON object only. Start with `{` and end with `}`."
            )
        raw = llm.chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT + repair_instruction},
                {"role": "user", "content": trace_prompt},
            ],
            temperature=0.0,
            max_tokens=(
                STRUCTURED_EXTRACTION_INITIAL_OUTPUT_TOKENS
                if attempt == 1 else MAX_ADAPTIVE_OUTPUT_TOKENS
            ),
        )
        try:
            parsed = _parse_json(raw)
            break
        except ExtractionOutputError as exc:
            last_error = exc
            if attempt >= _MAX_EXTRACTION_ATTEMPTS:
                raise ExtractionOutputError(
                    exc.code,
                    exc.detail,
                    attempts=attempt,
                ) from exc
    graph = build_graph(
        parsed, thread_id, created_by=created_by, created_at=created_at,
        artifact_versions=artifact_versions,
    )
    resolve_trace_refs(graph, trace)
    if artifact_versions is not None:
        attach_trace_artifacts(graph, trace, artifact_versions)
        ingest_trace_lineage(
            graph, trace, artifact_versions, created_by=created_by, created_at=created_at,
        )
    return graph


def _trace_text(item: dict) -> str:
    """The searchable text of a trace item (mirrors render_trace's content)."""
    parts = [
        _trace_payload(item), _tool_name(item),
    ]
    args = item.get("arguments") or item.get("args")
    if args is not None:
        parts.append(args if isinstance(args, str) else json.dumps(args, ensure_ascii=False))
    return " ".join(_short(p, 4000) for p in parts if p)


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def resolve_trace_refs(graph: ThreadGraph, trace: list[dict], *, min_overlap: float = 0.3) -> int:
    """Guarantee every node's `trace_ref` points at a REAL trace item id.

    LLMs do not reliably echo ids verbatim, so we repair: any node whose
    `trace_ref` is not a known item id is re-anchored to the trace item whose
    text has the highest token-containment overlap with the node's content
    (above `min_overlap`). Returns the number of nodes repaired. Deterministic.
    """
    ids = [_trace_id(item) for item in trace if _trace_id(item)]
    id_set = set(ids)
    item_tokens = {_trace_id(item): _tokens(_trace_text(item)) for item in trace if _trace_id(item)}
    repaired = 0
    for node in graph.nodes.values():
        if any(ref in id_set for ref in node.trace_refs):
            continue
        ntok = _tokens(node.content)
        if not ntok:
            continue
        best_id, best_score = None, min_overlap
        for iid, itok in item_tokens.items():
            if not itok:
                continue
            score = len(ntok & itok) / len(ntok)
            if score > best_score:
                best_id, best_score = iid, score
        if best_id is not None:
            node.trace_refs = [best_id]
            repaired += 1
    return repaired


_URL_RE = re.compile(r"https?://[^\s<>\]\[\"']+", re.IGNORECASE)
_DOI_RE = re.compile(r"(?<![\w.])10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
_PATH_KEYS = frozenset({
    "path", "relativepath", "filepath", "filename", "sourcepath", "inputpath",
    "outputpath", "fulloutputpath", "notebookpath", "datasetpath",
})
_URL_KEYS = frozenset({"url", "uri", "href", "sourceurl", "requesturl"})
_DOI_KEYS = frozenset({"doi"})
_CODE_SUFFIXES = frozenset({
    ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java", ".js", ".jsx",
    ".m", ".php", ".py", ".r", ".rb", ".rs", ".sh", ".sql", ".swift", ".ts",
    ".tsx", ".vue",
})
_DATA_SUFFIXES = frozenset({
    ".arrow", ".csv", ".feather", ".h5", ".hdf5", ".jsonl", ".nc", ".parquet",
    ".sav", ".tsv", ".xlsx",
})
_IMAGE_SUFFIXES = frozenset({".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tif", ".tiff"})
_MODEL_SUFFIXES = frozenset({".ckpt", ".joblib", ".onnx", ".pkl", ".pt", ".pth", ".safetensors"})


def attach_trace_artifacts(
    graph: ThreadGraph, trace: list[dict], registry: ArtifactVersionProjectionClient,
) -> int:
    """Attach only exact refs supplied by the ArtifactVersion owner.

    No locator is opened, hashed, registered, or rebound here.  Ambiguous,
    pending, and failed projections remain explicit fail-closed provenance.
    """
    contexts = _trace_contexts(trace)
    attached = 0
    for node in graph.nodes.values():
        if node.type != NodeType.SOURCE_ASSERTION:
            continue
        status = registry.status_for_trace(node.trace_refs)
        if status and status.get("status") in {"pending", "failed"}:
            node.attributes["artifactVersionProvenanceStatus"] = status["status"]
            node.attributes["artifactVersionProvenanceReason"] = status.get("reason")
            node.freshness = "stale"
            continue
        records = registry.records_for_trace(node.trace_refs)
        if node.artifact_version_id:
            records = [record for record in records if record.ref.version_id == node.artifact_version_id]
        if len(records) != 1:
            if records:
                node.attributes["artifactVersionProvenanceStatus"] = "failed"
                node.attributes["artifactVersionProvenanceReason"] = (
                    "Trace item maps to multiple ArtifactVersion refs."
                )
                node.freshness = "stale"
            continue
        record = records[0]
        artifact, version = record.artifact, record.version
        node.artifact_id = artifact.artifact_id
        node.artifact_version_id = version.version_id
        node.attributes.pop("artifactVersionProvenanceStatus", None)
        node.attributes.pop("artifactVersionProvenanceReason", None)
        context = next((contexts[ref] for ref in node.trace_refs if ref in contexts), None)
        anchor = None
        if context is not None:
            _item, source_item = context
            source_item_id = _trace_id(source_item)
            if source_item_id and source_item_id not in node.trace_refs:
                node.trace_refs.append(source_item_id)
            selected_content = _bounded_excerpt(_source_text(source_item), node.content) or \
                _bounded_excerpt(_canonical_trace_content(source_item), node.content)
            if selected_content:
                selector = _trace_selector(source_item, version.locator, selected_content)
                anchor = registry.create_anchor(
                    artifact.artifact_id, selector, selected_content=selected_content,
                    artifact_version_id=version.version_id,
                )
                node.source_anchor_id = anchor.anchor_id
        graph.attach_registry_records(
            artifact=artifact, artifact_version=version, source_anchor=anchor,
            artifact_version_ref=record.ref,
        )
        attached += 1
    return attached


def _trace_contexts(trace: list[dict]) -> dict[str, tuple[dict, dict]]:
    calls: dict[str, dict] = {}
    results: dict[str, dict] = {}
    for item in trace:
        call_id = str(item.get("callId") or item.get("call_id") or "").strip()
        if not call_id:
            continue
        if _trace_kind(item) in {"tool_call", "function_call"}:
            calls[call_id] = item
        elif _trace_kind(item) in {"tool_result", "function_result", "tool_output"}:
            results[call_id] = item
    contexts: dict[str, tuple[dict, dict]] = {}
    for item in trace:
        item_id = _trace_id(item)
        if not item_id:
            continue
        call_id = str(item.get("callId") or item.get("call_id") or "").strip()
        if _trace_kind(item) in {"tool_call", "function_call"} and call_id in results:
            contexts[item_id] = (item, results[call_id])
        else:
            contexts[item_id] = (calls.get(call_id, item), item)
    return contexts


def _canonical_trace_content(item: dict[str, Any]) -> str:
    payload = _trace_payload(item)
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _structured_trace_payload(item: dict[str, Any]) -> Any:
    """Decode the desktop's canonical JSON-string tool envelope when present."""
    payload = _trace_payload(item)
    if not isinstance(payload, str):
        return payload
    stripped = payload.strip()
    if not stripped.startswith(("{", "[")):
        return payload
    try:
        decoded = json.loads(stripped)
    except (json.JSONDecodeError, TypeError):
        return payload
    return decoded if isinstance(decoded, (dict, list)) else payload


def _source_text(item: dict[str, Any]) -> str:
    payload = _structured_trace_payload(item)
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        for key in ("content", "text", "body", "output", "stdout", "excerpt"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return _canonical_trace_content(item)


def _bounded_excerpt(value: str, semantic_hint: str, *, limit: int = 1200) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= limit:
        return text
    hint_tokens = _tokens(semantic_hint)
    candidates = [part.strip() for part in re.split(r"\n{2,}|(?<=[.!?。！？])\s+", text) if part.strip()]
    best = ""
    best_score = -1.0
    for candidate in candidates:
        tokens = _tokens(candidate)
        score = len(tokens & hint_tokens) / max(1, len(hint_tokens))
        if score > best_score:
            best, best_score = candidate, score
    if not best:
        best = text
    if len(best) <= limit:
        return best
    first_hint = next((token for token in sorted(hint_tokens) if token in best.lower()), "")
    center = best.lower().find(first_hint) if first_hint else 0
    start = max(0, center - limit // 3)
    return best[start:start + limit].strip()


def _trace_artifact_descriptor(
    call_item: dict[str, Any], source_item: dict[str, Any],
    registry: ArtifactVersionProjectionClient,
) -> Optional[dict[str, Any]]:
    # Failed tools prove the failure itself, not the requested file/URL bytes.
    if bool(source_item.get("isError") or source_item.get("is_error")):
        return None
    candidates: list[tuple[int, str]] = []
    structured_payload = _structured_trace_payload(source_item)
    _collect_structured_locators(structured_payload, candidates, priority=0)
    # source_refs may include citations merely mentioned inside the result;
    # an explicit locator field in the result envelope is more authoritative.
    _collect_source_ref_locators(source_item.get("source_refs"), candidates, priority=1)
    _collect_structured_locators(call_item.get("arguments") or call_item.get("args"), candidates, priority=1)
    for match in _URL_RE.findall(_canonical_trace_content(source_item)):
        candidates.append((2, match.rstrip(".,;:!?)")))
    for match in _DOI_RE.findall(_canonical_trace_content(source_item)):
        candidates.append((2, f"doi:{match.rstrip('.,;:!?')}"))
    unique: dict[str, tuple[int, str]] = {}
    for priority, locator in candidates:
        try:
            normalized = registry._normalize_locator(_normalize_locator_value(locator))
        except (OSError, TypeError, ValueError):
            continue
        absolute = registry._absolute_locator(normalized)
        if absolute and os.path.isdir(absolute):
            continue
        prior = unique.get(normalized)
        if prior is None or priority < prior[0]:
            unique[normalized] = (priority, normalized)
    if not unique:
        return None
    best_priority = min(value[0] for value in unique.values())
    best = sorted(locator for priority, locator in unique.values() if priority == best_priority)
    if len(best) != 1:
        return None
    locator = best[0]
    payload = structured_payload
    metadata = payload if isinstance(payload, dict) else {}
    digest = _sha256_metadata(metadata)
    return {
        "kind": _artifact_kind(locator),
        "locator": locator,
        "content_digest": digest,
        "version": _metadata_string(metadata, "version", "revision", "etag"),
        "media_type": _metadata_string(metadata, "mediaType", "media_type", "mimeType", "mime_type"),
        "retention": "reference",
        "_source_is_artifact_content": _trace_item_contains_artifact_content(source_item, locator),
    }


def _collect_structured_locators(value: Any, target: list[tuple[int, str]], *, priority: int) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized_key = re.sub(r"[^a-z]", "", str(key).lower())
            if isinstance(item, str) and item.strip():
                if normalized_key in _PATH_KEYS or normalized_key in _URL_KEYS:
                    target.append((priority, item.strip()))
                elif normalized_key in _DOI_KEYS:
                    target.append((priority, f"doi:{item.strip().removeprefix('doi:')}"))
            if isinstance(item, (dict, list, tuple)):
                _collect_structured_locators(item, target, priority=priority)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_structured_locators(item, target, priority=priority)


def _collect_source_ref_locators(value: Any, target: list[tuple[int, str]], *, priority: int) -> None:
    if not isinstance(value, list):
        return
    for raw in value:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "").strip().lower()
        locator = str(raw.get("value") or raw.get("locator") or "").strip()
        if not locator:
            continue
        if kind == "doi":
            target.append((priority, f"doi:{locator.removeprefix('doi:')}"))
        elif kind in {"file", "url", "uri", "swh", "swhid", "repository"}:
            target.append((priority, locator))


def _normalize_locator_value(value: str) -> str:
    locator = str(value or "").strip()
    parsed = urlparse(locator)
    if parsed.scheme.lower() == "file":
        return unquote(parsed.path)
    return locator


def _metadata_string(metadata: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    return None


def _sha256_metadata(metadata: dict[str, Any]) -> Optional[str]:
    for key in ("contentDigest", "content_digest", "sha256"):
        value = metadata.get(key)
        if value is None:
            continue
        raw = str(value).strip().lower()
        hex_value = raw[7:] if raw.startswith("sha256:") else raw
        if re.fullmatch(r"[0-9a-f]{64}", hex_value):
            return f"sha256:{hex_value}"
    return None


def _artifact_kind(locator: str) -> str:
    suffix = os.path.splitext(urlparse(locator).path)[1].lower()
    if suffix == ".pdf":
        return "paper"
    if suffix in _DATA_SUFFIXES:
        return "dataset"
    if suffix in _CODE_SUFFIXES:
        return "code"
    if suffix == ".ipynb":
        return "notebook"
    if suffix in _IMAGE_SUFFIXES:
        return "image"
    if suffix in {".log", ".out"}:
        return "log"
    if suffix in _MODEL_SUFFIXES:
        return "model"
    return "other"


def _trace_item_contains_artifact_content(item: dict[str, Any], locator: str) -> bool:
    if _trace_kind(item) not in {"tool_result", "function_result", "tool_output"}:
        return urlparse(locator).scheme.lower() in {"runtime", "trace"}
    if bool(item.get("isError") or item.get("is_error")):
        return False
    payload = _structured_trace_payload(item)
    tool_name = _tool_name(item).strip().lower().replace("-", "_")
    if not _tool_exposes_artifact_content(tool_name, locator, payload):
        return False
    scheme = urlparse(locator).scheme.lower()
    if scheme in {"http", "https", "doi", "swh", "swhid"}:
        if not any(token in tool_name for token in ("fetch", "read_url", "http", "browser", "web", "search")):
            return False
    if isinstance(payload, str):
        return bool(payload.strip())
    if not isinstance(payload, dict):
        return False
    return any(isinstance(payload.get(key), str) and payload[key].strip()
               for key in ("content", "text", "body", "output", "stdout", "excerpt"))


def _tool_exposes_artifact_content(tool_name: str, locator: str, payload: Any) -> bool:
    mutating = ("write", "edit", "patch", "delete", "remove", "move", "rename", "copy", "mkdir")
    if any(token in tool_name for token in mutating):
        return False
    readers = ("read", "fetch", "download", "open", "cat", "http", "browser", "web", "search")
    if any(token in tool_name for token in readers):
        return True
    if "bash" in tool_name and isinstance(payload, dict):
        full_output = payload.get("full_output_path") or payload.get("fullOutputPath")
        return isinstance(full_output, str) and full_output.strip() == locator
    return False


def _trace_selector(item: dict[str, Any], locator: str, selected_content: str) -> dict[str, Any]:
    payload = _structured_trace_payload(item)
    metadata = payload if isinstance(payload, dict) else {}
    suffix = os.path.splitext(urlparse(locator).path)[1].lower()
    scheme = urlparse(locator).scheme.lower()
    selector_type = (
        "web" if scheme in {"http", "https"} else
        "pdf" if suffix == ".pdf" else
        "dataset" if suffix in _DATA_SUFFIXES else
        "code" if suffix in _CODE_SUFFIXES or suffix == ".ipynb" else
        "figure" if suffix in _IMAGE_SUFFIXES else
        "text"
    )
    selector: dict[str, Any] = {"type": selector_type, "quote": selected_content}
    page = metadata.get("page") or metadata.get("pageNumber") or metadata.get("page_number")
    if isinstance(page, int) and page > 0:
        selector["page"] = page
    start = metadata.get("start_line") or metadata.get("startLine")
    end = metadata.get("end_line") or metadata.get("endLine")
    if isinstance(start, int) and isinstance(end, int) and start >= 1 and end >= start:
        selector["lineRange"] = f"{start}:{end}"
    return selector


def _runtime_locator(thread_id: str, item_id: str) -> str:
    stable_item = item_id or hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:16]
    return f"runtime:{quote(thread_id, safe='')}/{quote(stable_item, safe='')}"


def build_graph(
    parsed: dict,
    thread_id: str,
    *,
    created_by: str = "extractor",
    created_at: Optional[str] = None,
    artifact_versions: Optional[ArtifactVersionProjectionClient] = None,
) -> ThreadGraph:
    """Turn the extractor's JSON into a deduped ThreadGraph. Pure + testable.

    Hardened: tolerates ANY dict-shaped input — wrong types, missing keys,
    non-list nodes/edges, non-dict items — without raising. A malformed model
    response yields a (possibly empty) graph, never a crash.
    """
    if not isinstance(parsed, dict):
        parsed = {}
    graph = ThreadGraph(thread_id, meta={"source": "trace-extract"})
    tmp_to_id: dict[str, str] = {}

    raw_nodes = parsed.get("nodes", [])
    if not isinstance(raw_nodes, list):
        raw_nodes = []
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        try:
            ntype = NodeType(raw_node["type"])
        except (KeyError, ValueError, TypeError):
            continue
        content_raw = raw_node.get("content")
        content = (content_raw if isinstance(content_raw, str) else "").strip()
        if not content:
            continue
        extra: dict[str, Any] = {}
        attached = None
        if ntype == NodeType.SOURCE_ASSERTION:
            st = raw_node.get("source_type")
            if isinstance(st, str) and st.strip():
                extra["source_type"] = st.strip().lower()
            cr = raw_node.get("credibility")
            if isinstance(cr, str) and cr.strip().lower() in ("high", "medium", "low"):
                extra["credibility"] = cr.strip().lower()
            if artifact_versions is not None:
                pinned = artifact_versions.records_for_trace([
                    str(raw_node.get("trace_ref") or "")
                ])
                if len(pinned) == 1:
                    record = pinned[0]
                    attached = (record.artifact, record.version, None, record.ref)
                else:
                    try:
                        resolved = _register_source(raw_node, artifact_versions)
                        if resolved is not None:
                            artifact, artifact_version, source_anchor = resolved
                            attached = (
                                artifact, artifact_version, source_anchor,
                                artifact_versions.refs.get(artifact_version.version_id),
                            )
                    except (OSError, TypeError, ValueError):
                        attached = None
                if attached is not None:
                    artifact, artifact_version, source_anchor, _ref = attached
                    extra.update({
                        "artifact_id": artifact.artifact_id,
                        "artifact_version_id": artifact_version.version_id,
                        "source_anchor_id": source_anchor.anchor_id if source_anchor else None,
                    })
        if ntype == NodeType.REASONING and raw_node.get("reasoning_type"):
            extra["reasoning_type"] = raw_node["reasoning_type"]
        node = graph.add_or_get_node(
            ntype, content,
            trace_ref=raw_node.get("trace_ref"),
            created_by=created_by, created_at=created_at,
            **extra,
        )
        if attached is not None:
            artifact, artifact_version, source_anchor, pinned_ref = attached
            graph.attach_registry_records(
                artifact=artifact, artifact_version=artifact_version, source_anchor=source_anchor,
                artifact_version_ref=pinned_ref,
            )
        if raw_node.get("tmp_id"):
            tmp_to_id[str(raw_node["tmp_id"])] = node.id

    raw_edges = parsed.get("edges", [])
    if not isinstance(raw_edges, list):
        raw_edges = []
    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            continue
        try:
            rel = EdgeRel(raw_edge["rel"])
        except (KeyError, ValueError, TypeError):
            continue
        src = tmp_to_id.get(str(raw_edge.get("src")))
        dst = tmp_to_id.get(str(raw_edge.get("dst")))
        if src and dst:
            graph.add_edge(src, dst, rel, created_at=created_at)

    return graph


def _register_source(raw_node: dict[str, Any], registry: ArtifactVersionProjectionClient):
    ref = raw_node.get("ref") if isinstance(raw_node.get("ref"), dict) else {}
    supplied = raw_node.get("artifact") if isinstance(raw_node.get("artifact"), dict) else {}
    locator = supplied.get("locator")
    if not locator and ref.get("doi"):
        locator = f"doi:{ref['doi']}"
    if not locator and ref.get("url"):
        locator = ref["url"]
    if not locator and ref.get("citation"):
        locator = f"citation:{ref['citation']}"
    if not locator:
        return None
    source_type = str(raw_node.get("source_type") or "").lower()
    inferred_kind = "dataset" if source_type == "dataset" else \
        ("paper" if source_type in {"paper", "preprint", "guideline"} else "other")
    artifact, version, _outcome = registry.register(
        kind=supplied.get("kind") or inferred_kind,
        locator=str(locator),
        content_digest=supplied.get("contentDigest"),
        version=supplied.get("version"),
        size=supplied.get("size"),
        media_type=supplied.get("mediaType"),
        retention=supplied.get("retention", "reference"),
        access_policy=supplied.get("accessPolicy") if isinstance(supplied.get("accessPolicy"), dict) else None,
    )
    selector = raw_node.get("selector")
    anchor = None
    if isinstance(selector, dict):
        anchor = registry.create_anchor(
            artifact.artifact_id, selector, anchor_digest=raw_node.get("anchorDigest"),
            artifact_version_id=version.version_id,
        )
    return artifact, version, anchor
