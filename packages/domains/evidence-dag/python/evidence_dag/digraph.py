"""Small deterministic directed-graph algorithms owned by the Evidence domain.

The Evidence engine needs only reachability, strongly connected components,
topological generations, and immediate dominators. Keeping that narrow surface
inside the package makes the Python sidecar self-contained and identical in
source and packaged applications.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator


class DirectedGraph:
    """Insertion-ordered directed graph with the operations Evidence consumes."""

    def __init__(self) -> None:
        self._successors: dict[str, dict[str, None]] = {}
        self._predecessors: dict[str, dict[str, None]] = {}

    @property
    def nodes(self) -> tuple[str, ...]:
        return tuple(self._successors)

    def __contains__(self, node: object) -> bool:
        return node in self._successors

    def add_node(self, node: str) -> None:
        self._successors.setdefault(node, {})
        self._predecessors.setdefault(node, {})

    def add_nodes_from(self, nodes: Iterable[str]) -> None:
        for node in nodes:
            self.add_node(node)

    def add_edge(self, source: str, target: str, **_attributes: object) -> None:
        self.add_node(source)
        self.add_node(target)
        self._successors[source].setdefault(target, None)
        self._predecessors[target].setdefault(source, None)

    def has_edge(self, source: str, target: str) -> bool:
        return target in self._successors.get(source, {})

    def successors(self, node: str) -> tuple[str, ...]:
        return tuple(self._successors.get(node, {}))

    def predecessors(self, node: str) -> tuple[str, ...]:
        return tuple(self._predecessors.get(node, {}))

    def remove_nodes_from(self, nodes: Iterable[str]) -> None:
        for node in tuple(dict.fromkeys(nodes)):
            if node not in self._successors:
                continue
            for predecessor in tuple(self._predecessors[node]):
                self._successors[predecessor].pop(node, None)
            for successor in tuple(self._successors[node]):
                self._predecessors[successor].pop(node, None)
            self._successors.pop(node, None)
            self._predecessors.pop(node, None)


def descendants(graph: DirectedGraph, source: str) -> set[str]:
    if source not in graph:
        raise KeyError(source)
    seen: set[str] = {source}
    stack = [source]
    while stack:
        current = stack.pop()
        for successor in graph.successors(current):
            if successor in seen:
                continue
            seen.add(successor)
            stack.append(successor)
    seen.remove(source)
    return seen


def ancestors(graph: DirectedGraph, target: str) -> set[str]:
    if target not in graph:
        raise KeyError(target)
    seen: set[str] = {target}
    stack = [target]
    while stack:
        current = stack.pop()
        for predecessor in graph.predecessors(current):
            if predecessor in seen:
                continue
            seen.add(predecessor)
            stack.append(predecessor)
    seen.remove(target)
    return seen


def strongly_connected_components(graph: DirectedGraph) -> Iterator[set[str]]:
    """Yield SCCs with iterative Kosaraju traversal."""
    visited: set[str] = set()
    finish_order: list[str] = []
    for start in graph.nodes:
        if start in visited:
            continue
        stack: list[tuple[str, bool]] = [(start, False)]
        while stack:
            node, exiting = stack.pop()
            if exiting:
                finish_order.append(node)
                continue
            if node in visited:
                continue
            visited.add(node)
            stack.append((node, True))
            for successor in reversed(graph.successors(node)):
                if successor not in visited:
                    stack.append((successor, False))

    assigned: set[str] = set()
    for start in reversed(finish_order):
        if start in assigned:
            continue
        component: set[str] = set()
        stack = [start]
        assigned.add(start)
        while stack:
            node = stack.pop()
            component.add(node)
            for predecessor in graph.predecessors(node):
                if predecessor not in assigned:
                    assigned.add(predecessor)
                    stack.append(predecessor)
        yield component


def topological_generations(graph: DirectedGraph) -> Iterator[tuple[str, ...]]:
    indegree = {
        node: len(graph.predecessors(node))
        for node in graph.nodes
    }
    generation = tuple(node for node in graph.nodes if indegree[node] == 0)
    emitted = 0
    while generation:
        yield generation
        emitted += len(generation)
        next_generation: list[str] = []
        for node in generation:
            for successor in graph.successors(node):
                indegree[successor] -= 1
                if indegree[successor] == 0:
                    next_generation.append(successor)
        generation = tuple(next_generation)
    if emitted != len(indegree):
        raise ValueError("Topological generations require an acyclic graph.")


def immediate_dominators(graph: DirectedGraph, start: str) -> dict[str, str]:
    """Return immediate dominators for nodes reachable from ``start``.

    Evidence graphs are intentionally bounded, so the standard iterative
    dominator-set algorithm is simpler and sufficiently fast here.
    """
    if start not in graph:
        raise KeyError(start)
    reachable = descendants(graph, start) | {start}
    dominators: dict[str, set[str]] = {
        node: ({start} if node == start else set(reachable))
        for node in reachable
    }
    changed = True
    while changed:
        changed = False
        for node in graph.nodes:
            if node == start or node not in reachable:
                continue
            predecessors = [
                predecessor
                for predecessor in graph.predecessors(node)
                if predecessor in reachable
            ]
            inherited = set.intersection(
                *(dominators[predecessor] for predecessor in predecessors)
            ) if predecessors else set()
            updated = inherited | {node}
            if updated != dominators[node]:
                dominators[node] = updated
                changed = True

    result: dict[str, str] = {}
    for node in graph.nodes:
        if node == start or node not in reachable:
            continue
        strict = dominators[node] - {node}
        if not strict:
            continue
        result[node] = max(
            strict,
            key=lambda candidate: (len(dominators[candidate]), candidate),
        )
    return result
