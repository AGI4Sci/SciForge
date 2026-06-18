"""Reconcile / what-if 扰动引擎 (阶段二核心).

回答科学家在写操作前最想知道的问题:**「如果我弃用/撤稿这篇来源(或删掉这条边),
我的哪些结论会坍塌,为什么?」** 这就是提案 A–G 里的 B(deprecate_source)/
D(world_update 撤稿)/E(暴露冲突)的「先看后果」形态。

实现 = 计划里 Reconcile 回路的**确定性**版本:
  1) 标记受扰动节点的**下游可达子图**并报告其大小——这是「改动是局部的」的度量(Gate2
     增量要求)。phase-1 图只有几十个节点,直接全量重算 status 即可;真要增量,只需把重算
     限制在这个子图(其余可证明不变)。
  2) 在**存活的 supports 边**上重算支持度(无需重跑 NLI——删一个节点不会改变任何**残留**边
     的 ν,直接对缓存的 ν 重新 noisy-OR 聚合即可。这正是计划预留的「构建系统式
     early-cutoff 增量回退」,不是完整 ATMS 组合标签——保持简单);
  3) 重标状态 {supported / conflicting / invalidated / unverified};
  4) 产出 diff(翻转的节点)+ 每个翻转的「断裂依赖链」(它原来依赖、现在够不到的来源)。

**只读 what-if**:在图的逻辑视图上模拟,从不改动已存的图。纯 + 确定,无 LLM、无网络。
"""
from __future__ import annotations

from typing import Iterable

import networkx as nx

from .graph import ThreadGraph
from .model import EdgeRel, NodeType
from .verifier import noisy_or

_DERIVED = (NodeType.CLAIM, NodeType.REASONING)


def _surviving_supports(graph: ThreadGraph, rm_nodes: set[str], rm_edges: set[str]):
    """存活的 supports 边 (src, dst, ν)——剔除被扰动掉的端点/边。"""
    out = []
    for e in graph.edges.values():
        if e.rel != EdgeRel.SUPPORTS:
            continue
        if e.id in rm_edges or e.src in rm_nodes or e.dst in rm_nodes:
            continue
        out.append((e.src, e.dst, e.nli_score))
    return out


def _contested(graph: ThreadGraph, rm_nodes: set[str], rm_edges: set[str],
               add_contra: set[str]) -> set[str]:
    """带有(存活的)contradicts 边的节点 + 本次扰动新增矛盾的目标。"""
    c: set[str] = set(add_contra)
    for e in graph.edges.values():
        if e.rel != EdgeRel.CONTRADICTS:
            continue
        if e.id in rm_edges or e.src in rm_nodes or e.dst in rm_nodes:
            continue
        c.add(e.dst)
        c.add(e.src)
    return c


def _status_map(graph: ThreadGraph, *, threshold: float,
                rm_nodes: set[str] = frozenset(), rm_edges: set[str] = frozenset(),
                add_contra: set[str] = frozenset()) -> dict[str, tuple]:
    """每个节点 -> (status, aggregate_ν, set(可达的存活来源)).

    status ∈ {supported, conflicting, unverified}(source 恒 supported)。
    「invalidated」是一个**转移**概念(原本有来源、扰动后够不到任何来源),在 reconcile()
    里按 base→pert 的差异判定,不在这里产生。
    """
    surviving = _surviving_supports(graph, rm_nodes, rm_edges)
    incoming: dict[str, list[float]] = {}
    for _s, d, nu in surviving:
        if nu is not None:
            incoming.setdefault(d, []).append(nu)

    # 残留 supports 子图上,每个节点能反向走到哪些存活来源
    g = nx.DiGraph()
    g.add_nodes_from(n for n in graph.nodes if n not in rm_nodes)
    for s, d, _nu in surviving:
        g.add_edge(s, d)
    live_sources = {n for n, nd in graph.nodes.items()
                    if nd.type == NodeType.SOURCE and n not in rm_nodes}
    reach: dict[str, set[str]] = {}
    for n in g.nodes:
        reach[n] = (nx.ancestors(g, n) | {n}) & live_sources

    contested = _contested(graph, rm_nodes, rm_edges, add_contra)
    out: dict[str, tuple] = {}
    for nid, node in graph.nodes.items():
        if nid in rm_nodes:
            out[nid] = ("removed", 0.0, set())
            continue
        if node.type == NodeType.SOURCE:
            out[nid] = ("supported", 1.0, reach.get(nid, set()))
            continue
        agg = round(noisy_or(incoming.get(nid, [])), 4)
        srcs = reach.get(nid, set())
        if not srcs or agg < threshold:
            st = "unverified"
        elif nid in contested:
            st = "conflicting"
        else:
            st = "supported"
        out[nid] = (st, agg, srcs)
    return out


def _downstream(graph: ThreadGraph, seeds: Iterable[str]) -> set[str]:
    """沿 supports 边从 seeds 出发的下游可达闭包(含 seeds)——受影响子图。"""
    g = graph.supports_digraph()
    affected: set[str] = set()
    for s in seeds:
        if s in g:
            affected |= nx.descendants(g, s) | {s}
    return affected


def reconcile(graph: ThreadGraph, *, remove_nodes: Iterable[str] = (),
              remove_edges: Iterable[str] = (), add_contradicts: Iterable[str] = (),
              threshold: float = 0.7) -> dict:
    """模拟一次扰动,返回状态 diff + 断裂链解释 + 受影响子图度量。"""
    rm_nodes = {n for n in remove_nodes if n in graph.nodes}
    rm_edges = {e for e in remove_edges if e in graph.edges}
    add_contra = {n for n in add_contradicts if n in graph.nodes}

    base = _status_map(graph, threshold=threshold)
    pert = _status_map(graph, threshold=threshold, rm_nodes=rm_nodes,
                       rm_edges=rm_edges, add_contra=add_contra)

    # 受影响子图 = 被删节点 + 被删边的目标 + 新增矛盾目标 的下游闭包(增量证明)
    seeds: set[str] = set(rm_nodes) | set(add_contra)
    for eid in rm_edges:
        seeds.add(graph.edges[eid].dst)
    affected = _downstream(graph, seeds)

    def brief(nid: str) -> str:
        return (graph.nodes[nid].content or "")[:140]

    invalidated, weakened, conflicted, restored = [], [], [], []
    for nid, node in graph.nodes.items():
        if nid in rm_nodes or node.type == NodeType.SOURCE:
            continue
        b_st, _b_agg, b_src = base[nid]
        p_st, p_agg, p_src = pert[nid]
        if b_st == p_st:
            continue  # 状态未翻转 —— 只报真正发生变化的节点(no-op 扰动 => 空 diff)
        lost = sorted(b_src - p_src)
        entry = {
            "id": nid, "type": node.type.value, "content": brief(nid),
            "from": b_st, "to": p_st, "aggregate_nu": p_agg,
            "lost_sources": lost,  # 断裂链:它原来依赖、现在够不到的来源
        }
        # 这四条覆盖了 {supported,conflicting,unverified} 之间所有 b!=p 的转移(穷尽)。
        if p_st == "unverified" and not p_src:
            # 原本有来源支撑,扰动后一个来源都够不到了 → 坍塌
            entry["effect"] = "invalidated"
            entry["why"] = ("collapses — every evidence path passed through the removed "
                            f"{'/'.join(lost) if lost else 'item'}")
            invalidated.append(entry)
        elif p_st == "unverified":
            entry["effect"] = "weakened"
            entry["why"] = (f"support fell below {threshold:g} (ν={p_agg}) but still "
                            "reaches a source")
            weakened.append(entry)
        elif p_st == "conflicting":
            entry["effect"] = "now-conflicting"
            entry["why"] = "a contradicts edge now bears on a still-supported claim"
            conflicted.append(entry)
        else:  # p_st == "supported"
            entry["effect"] = "restored"
            entry["why"] = ("conflict resolved — the contradicting source was removed"
                            if b_st == "conflicting" else "support rose to/above threshold")
            restored.append(entry)

    invalidated.sort(key=lambda x: x["id"])
    n_derived = sum(1 for n in graph.nodes.values() if n.type in _DERIVED)
    return {
        "threshold": threshold,
        "perturbation": {
            "remove_nodes": sorted(rm_nodes),
            "remove_edges": sorted(rm_edges),
            "add_contradicts": sorted(add_contra),
        },
        "invalidated": invalidated,
        "weakened": weakened,
        "now_conflicting": conflicted,
        "restored": restored,
        "summary": {
            "affected_subgraph_size": len(affected),  # 只在此子图重算(增量)
            "n_derived": n_derived,
            "n_invalidated": len(invalidated),
            "n_weakened": len(weakened),
            "n_now_conflicting": len(conflicted),
            "blast_radius": len(invalidated) + len(weakened) + len(conflicted),
        },
    }
