"""Trace -> DAG extractor (1A core).

Renders an agent trace (kun/codex timeline items, each with a stable step id)
into text, asks the LLM for a typed claim-evidence graph as structured JSON,
then builds a ThreadGraph with shared-node dedup. The LLM only *extracts and
classifies* — it does not reason about or judge the science.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from .graph import ThreadGraph
from .llm import LLM
from .model import EdgeRel, NodeType

SYSTEM_PROMPT = """EDAG-TASK: extract
You convert an AI agent's trace into a typed claim-evidence graph. You ONLY
extract and classify what is already present; you NEVER add facts, reason about
correctness, or judge the science.

Node types:
- source: an external piece of evidence the agent brought in. `content` MUST be
  WHAT the source actually found/says — a concrete one-sentence finding, NOT just
  its title. Put the title / arXiv id / url / doi in `ref`.
  GOOD: content="Calibrated language models must hallucinate at a rate tied to the
  fraction of facts seen once in training", ref={"citation":"arXiv:2311.14648"}.
  BAD: content="[2311.14648] Calibrated Language Models Must Hallucinate".
  CRITICAL — a NAMED study, trial, dataset, guideline, review, or paper is a
  `source`, EVEN when the agent merely cites it inside its own prose (no separate
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
  incoming evidence usually means it was really a `source` (a restated finding) —
  reclassify it as `source`, or connect the evidence it draws on.
- Use `refines` when one statement narrows/qualifies another; `prerequisite` when
  one must hold before another.

Rules:
- The SAME evidence referenced in multiple steps must be ONE node (reuse tmp_id).
- Every node MUST set `trace_ref` to the EXACT id shown inside the [ ] brackets at
  the start of the trace line it came from. COPY that token verbatim — do not
  invent, renumber, or abbreviate it (ids look arbitrary, e.g. "item_7f3a", not "step-N").
- Output STRICT JSON only, no prose, no code fences:
{"nodes":[{"tmp_id":"n1","type":"source|reasoning|claim","content":"...",
"trace_ref":"<exact id copied from the [ ] bracket>","ref":{"url":"...","doi":"...","citation":"..."},
"source_type":"paper|preprint|guideline|dataset|news|blog|web|unknown","credibility":"high|medium|low",
"reasoning_type":"deduction|induction|synthesis"}],
"edges":[{"src":"n1","dst":"n2","rel":"supports|contradicts|refines|prerequisite"}]}
`ref`/`source_type`/`credibility` only on source nodes (omit unknown fields); `reasoning_type` only on reasoning."""


def render_trace(trace: list[dict]) -> str:
    """Flatten timeline items into '[step <id>] <kind>: <text>' lines."""
    lines: list[str] = []
    for item in trace:
        sid = item.get("id") or item.get("step_id") or f"step-{len(lines)}"
        kind = item.get("type", "message")
        if kind in ("tool_call", "function_call"):
            name = item.get("tool_name") or item.get("name") or "tool"
            args = item.get("arguments") or item.get("args") or ""
            text = f"call {name}({_short(args, 800)})"
        elif kind in ("tool_result", "function_result", "tool_output"):
            name = item.get("tool_name") or item.get("name") or "tool"
            text = f"result of {name}: {_short(item.get('content') or item.get('output') or '', 2000)}"
        else:
            # messages carry the agent's actual reasoning & final answer — keep
            # much more so the structure (tables, contradictions, factors) survives.
            role = item.get("role", "")
            text = _short(item.get("content") or item.get("text") or "", 6000)
            if role:
                text = f"({role}) {text}"
        lines.append(f"[{sid}] {kind}: {text}")
    return "\n".join(lines)


def _short(value: Any, limit: int = 1200) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[:limit] + " …"


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start:end + 1])
        raise


def extract_dag(
    trace: list[dict],
    llm: LLM,
    thread_id: str,
    *,
    created_by: str = "extractor",
    created_at: Optional[str] = None,
) -> ThreadGraph:
    rendered = render_trace(trace)
    raw = llm.chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"TRACE (thread {thread_id}):\n{rendered}"},
        ],
        temperature=0.0,
        max_tokens=4096,
    )
    parsed = _parse_json(raw)
    graph = build_graph(parsed, thread_id, created_by=created_by, created_at=created_at)
    resolve_trace_refs(graph, trace)
    return graph


def _trace_text(item: dict) -> str:
    """The searchable text of a trace item (mirrors render_trace's content)."""
    parts = [
        item.get("content"), item.get("text"), item.get("output"),
        item.get("tool_name") or item.get("name"),
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
    ids = [str(item.get("id")) for item in trace if item.get("id")]
    id_set = set(ids)
    item_tokens = {str(item.get("id")): _tokens(_trace_text(item)) for item in trace if item.get("id")}
    repaired = 0
    for node in graph.nodes.values():
        if node.trace_ref in id_set:
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
            node.trace_ref = best_id
            repaired += 1
    return repaired


def build_graph(
    parsed: dict,
    thread_id: str,
    *,
    created_by: str = "extractor",
    created_at: Optional[str] = None,
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
        if ntype == NodeType.SOURCE:
            if isinstance(raw_node.get("ref"), dict):
                extra["ref"] = {k: v for k, v in raw_node["ref"].items() if v}
            st = raw_node.get("source_type")
            if isinstance(st, str) and st.strip():
                extra["source_type"] = st.strip().lower()
            cr = raw_node.get("credibility")
            if isinstance(cr, str) and cr.strip().lower() in ("high", "medium", "low"):
                extra["credibility"] = cr.strip().lower()
        if ntype == NodeType.REASONING and raw_node.get("reasoning_type"):
            extra["reasoning_type"] = raw_node["reasoning_type"]
        node = graph.add_or_get_node(
            ntype, content,
            trace_ref=raw_node.get("trace_ref"),
            created_by=created_by, created_at=created_at,
            **extra,
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
