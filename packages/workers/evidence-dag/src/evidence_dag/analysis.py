"""Load-bearing & fragility analysis (承重 / 脆弱分析).

Answers the scientist's structural question: *if this study were retracted,
which of my conclusions collapse?* (e.g. the PREDIMED 2018 re-analysis).

Built on the `supports` sub-DAG via DOMINATOR analysis. Add a virtual root that
points at every source; a node `x` then **dominates** a derived node `c` iff
EVERY evidence path from the sources to `c` passes through `x`. Removing a
dominator disconnects `c` from all evidence — it is a single point of failure.

- load-bearing power of a node = how many derived nodes it dominates (would
  collapse without it). Sources AND pivotal reasoning steps both count.
- fragility of a conclusion = does it have any single point of failure (a
  dominator), how few independent sources back it, is it contradicted, and is
  its aggregate support below the verification bar.

Pure + deterministic; no LLM, no network. Phase 1 leaves the graph untouched —
this is a read-only view over the existing DAG.
"""
from __future__ import annotations

import networkx as nx

from .graph import ThreadGraph
from .model import EdgeRel, NodeType
from .verifier import noisy_or

_ROOT = "__sources_root__"
_DERIVED = (NodeType.CLAIM, NodeType.REASONING)


def _dominator_chain(idom: dict, node: str) -> list[str]:
    """Strict dominators of `node` (nearest first), excluding the root and self.

    Walk the immediate-dominator tree from `node` up to the root. Every entry is
    a node through which ALL source->node evidence paths must pass.
    """
    out: list[str] = []
    x = idom.get(node)
    while x is not None and x != _ROOT and x != node:
        out.append(x)
        nxt = idom.get(x)
        if nxt is None or nxt == x:
            break
        x = nxt
    return out


def analyze(graph: ThreadGraph, *, threshold: float = 0.7) -> dict:
    g = graph.supports_digraph()
    sources = [nid for nid, n in graph.nodes.items() if n.type == NodeType.SOURCE_ASSERTION]
    derived = [nid for nid, n in graph.nodes.items() if n.type in _DERIVED]
    source_set = set(sources)

    # virtual root -> every source, so "dominates" == "on every evidence path".
    g.add_node(_ROOT)
    for s in sources:
        g.add_edge(_ROOT, s)
    idom = nx.immediate_dominators(g, _ROOT) if sources else {}

    # aggregate support strength per node (same noisy-OR the verifier uses)
    incoming_nu: dict[str, list[float]] = {}
    for e in graph.edges.values():
        if e.rel == EdgeRel.SUPPORTS and e.nli_score is not None:
            incoming_nu.setdefault(e.dst, []).append(e.nli_score)
    # contradicts edges incident to a node, aggregated by STRENGTH (noisy-OR of ν),
    # not by count: a ν=0.05 contradiction must not flag a claim as hard as ν=0.95.
    # An UNSCORED contradicts edge counts as full strength (1.0) — a declared
    # contradiction we have not yet adjudicated still contests, conservatively; once
    # the verifier scores it (edge_contra), the real ν gates the `contested` verdict.
    contra_nu: dict[str, list[float]] = {}
    for e in graph.edges_of(EdgeRel.CONTRADICTS):
        nu = e.nli_score if e.nli_score is not None else 1.0
        contra_nu.setdefault(e.dst, []).append(nu)
        contra_nu.setdefault(e.src, []).append(nu)
    contra_strength_of: dict[str, float] = {
        nid: round(noisy_or(vs), 4) for nid, vs in contra_nu.items()
    }
    # support strength per derived node, reused by fragility / weakness / robust.
    strength_of: dict[str, float] = {
        c: round(noisy_or(incoming_nu.get(c, [])), 4) if incoming_nu.get(c) else 0.0
        for c in derived
    }

    # per-derived-node dominators + which sources back it
    doms: dict[str, list[str]] = {}
    n_sources_of: dict[str, int] = {}
    for c in derived:
        anc = nx.ancestors(g, c) if c in g else set()
        n_sources_of[c] = len(anc & source_set)
        doms[c] = _dominator_chain(idom, c) if c in idom else []

    # distinct immediate supports parents (in-degree on supports) per node —
    # how "multi-supported" a node LOOKS at first glance.
    n_parents: dict[str, int] = {}
    for e in graph.edges.values():
        if e.rel == EdgeRel.SUPPORTS and e.dst in graph.nodes:
            n_parents[e.dst] = n_parents.get(e.dst, 0) + 1

    # invert: a node's load-bearing power = how many derived nodes it dominates
    critical_for: dict[str, list[str]] = {}
    for c, ds in doms.items():
        for d in ds:
            critical_for.setdefault(d, []).append(c)

    def brief(nid: str) -> str:
        return (graph.nodes[nid].content or "")[:140]

    # --- load-bearing ranking ---------------------------------------------
    # Surface ONLY nodes that >=2 conclusions depend on (a node that dominates
    # exactly one conclusion is just that conclusion's own chain — not "load
    # bearing" in any interesting sense, and listing them all is noise).
    load_bearing = []
    for nid, deps in critical_for.items():
        node = graph.nodes.get(nid)
        if node is None or len(deps) < 2:
            continue
        load_bearing.append({
            "id": nid,
            "type": node.type.value,
            "content": brief(nid),
            "critical_for": sorted(deps),          # collapse if this is removed
            "critical_count": len(deps),
        })
    load_bearing.sort(key=lambda x: (-x["critical_count"], x["id"]))

    # --- hidden shared-source (假鲁棒) detection ---------------------------
    # 计划的标志性验收项:一个**看似多支持**的结论(≥2 条入边),若它的 dominator 链里
    # 含一个 SOURCE,说明那些看似独立的支持其实**全部 funnel through 同一来源**——
    # 「看着是 N 个支持,其实是 1 个来源」。这是 fragility 里最隐蔽的一种。
    pseudo_robust = []
    shared_source_of: dict[str, list[str]] = {}
    shared_reasoning_of: dict[str, list[str]] = {}
    for c in derived:
        if graph.nodes[c].type != NodeType.CLAIM or n_parents.get(c, 0) < 2:
            continue
        # A claim that LOOKS multi-supported (>=2 incoming edges) but whose every
        # evidence path funnels through ONE dominator is only as strong as that
        # single point. Two flavours:
        #   * shared SOURCE   — looks like N supports, really one paper;
        #   * shared REASONING — looks multi-sourced, but every path rests on one
        #     shared assumption/step. A raw source count can't see this one, so it
        #     was previously invisible: the conclusion read as robust.
        shared_src = [d for d in doms[c] if graph.nodes[d].type == NodeType.SOURCE_ASSERTION]
        shared_rea = [d for d in doms[c] if graph.nodes[d].type == NodeType.REASONING]
        if not shared_src and not shared_rea:
            continue
        if shared_src:
            shared_source_of[c] = shared_src
        if shared_rea:
            shared_reasoning_of[c] = shared_rea
        bottleneck = []
        if shared_src:
            bottleneck.append("source")
        if shared_rea:
            bottleneck.append("reasoning")
        pseudo_robust.append({
            "id": c, "type": "claim", "content": brief(c),
            "n_support_edges": n_parents[c],          # 看上去几路支持
            "bottleneck": bottleneck,                 # which kind(s) of single point
            "shared_source": shared_src,              # 实际就这一个(几个)来源
            "shared_source_brief": [brief(s) for s in shared_src],
            "shared_reasoning": shared_rea,           # …或全都过同一条推理/假设
            "shared_reasoning_brief": [brief(s) for s in shared_rea],
        })
    pseudo_robust.sort(key=lambda x: (-x["n_support_edges"], x["id"]))

    # --- fragility per conclusion -----------------------------------------
    # Fragility is a STRUCTURAL property, not "support is weak" (weak support is
    # already conveyed by the ν edge labels + Soundness). A conclusion is fragile
    # only if losing ONE thing breaks it: it has no source at all, it rests on a
    # single source (one retraction kills it), or it is directly contradicted.
    # Reasoning steps are plumbing — flag them only when ungrounded/contested,
    # NOT merely for resting on one source (that is the normal shape of a step).
    fragile = []
    for c in derived:
        node = graph.nodes[c]
        strength = strength_of[c]
        nsrc = n_sources_of[c]
        contra_strength = contra_strength_of.get(c, 0.0)
        is_contested = contra_strength >= threshold        # by STRENGTH, not count
        is_claim = node.type == NodeType.CLAIM
        is_pseudo = c in shared_source_of or c in shared_reasoning_of
        reasons = []
        if nsrc == 0:
            reasons.append("ungrounded — no source evidence")
        elif is_pseudo:
            # 看似多支持却同源 / 同假设:比「单源」更隐蔽,优先这条措辞
            n = n_parents.get(c, 0)
            if c in shared_source_of:
                reasons.append(f"pseudo-robust — {n} supports funnel through one source")
            else:
                reasons.append(f"pseudo-robust — {n} supports funnel through one shared assumption")
        elif nsrc == 1 and is_claim:
            reasons.append("rests on a single source")
        if is_contested:
            reasons.append(f"contested by a contradicts edge (strength {contra_strength:.2f})")
        if not reasons:
            continue
        fragile.append({
            "id": c,
            "type": node.type.value,
            "content": brief(c),
            "n_sources": nsrc,
            "spof": doms[c],                        # nodes whose removal ungrounds c
            "support_strength": strength,
            "contested": is_contested,              # strongly contested (ν ≥ threshold)
            "contradiction_strength": contra_strength,
            "pseudo_robust": is_pseudo,
            "shared_source": shared_source_of.get(c, []),
            "shared_reasoning": shared_reasoning_of.get(c, []),
            "reasons": reasons,
        })
    # most fragile first: ungrounded, then contested, then fewest sources
    fragile.sort(key=lambda x: (x["n_sources"] != 0, not x["contested"], x["n_sources"], x["id"]))

    # --- evidential weakness: a separate axis from structural fragility -------
    # A grounded CLAIM whose aggregate support is below the verification bar. This
    # is the `threshold`-driven view: fragility is STRUCTURAL (a single point of
    # failure), weakness is EVIDENTIAL (the support just is not strong enough). A
    # claim can be either, both, or neither. (Ungrounded claims are already covered
    # by structural fragility, so weakness only considers claims with a source.)
    weakly_supported = [
        {"id": c, "content": brief(c),
         "support_strength": strength_of[c], "n_sources": n_sources_of[c]}
        for c in derived
        if graph.nodes[c].type == NodeType.CLAIM
        and n_sources_of[c] > 0 and strength_of[c] < threshold
    ]
    weakly_supported.sort(key=lambda x: (x["support_strength"], x["id"]))
    weak_ids = {w["id"] for w in weakly_supported}
    # the highest-priority repair targets: structurally fragile AND under-supported.
    fragile_and_weak = sorted({f["id"] for f in fragile} & weak_ids)

    # robust now also demands the support clear the bar and any contradiction stay
    # below it — a weakly-supported claim (even multi-source) is no longer "robust".
    robust = [c for c in derived
              if n_sources_of[c] >= 2 and not doms[c]
              and contra_strength_of.get(c, 0.0) < threshold
              and strength_of[c] >= threshold]

    return {
        "threshold": threshold,
        "load_bearing": load_bearing,
        "fragile": fragile,                    # structural fragility (single point / contested)
        "weakly_supported": weakly_supported,  # evidential weakness (support < threshold)
        "fragile_and_weak": fragile_and_weak,  # both axes — repair these first
        "pseudo_robust": pseudo_robust,   # 假鲁棒:看似多支持实为同源
        "summary": {
            "n_sources": len(sources),
            "n_derived": len(derived),
            "n_fragile": len(fragile),
            "n_robust": len(robust),
            "n_pseudo_robust": len(pseudo_robust),
            "n_weakly_supported": len(weakly_supported),
            "n_fragile_and_weak": len(fragile_and_weak),
            "top_load_bearing": load_bearing[0]["id"] if load_bearing else None,
            "max_critical_count": load_bearing[0]["critical_count"] if load_bearing else 0,
        },
    }
