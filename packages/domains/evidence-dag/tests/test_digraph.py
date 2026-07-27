"""Focused contract tests for the package-owned directed-graph algorithms."""
from __future__ import annotations

import unittest

from evidence_dag.digraph import (
    DirectedGraph,
    ancestors,
    descendants,
    immediate_dominators,
    strongly_connected_components,
    topological_generations,
)


class DirectedGraphTests(unittest.TestCase):
    def test_ancestors_and_descendants_exclude_the_selected_node(self) -> None:
        graph = DirectedGraph()
        graph.add_nodes_from(("source", "left", "right", "claim", "isolated"))
        graph.add_edge("source", "left")
        graph.add_edge("source", "right")
        graph.add_edge("left", "claim")
        graph.add_edge("right", "claim")

        self.assertEqual(descendants(graph, "source"), {"left", "right", "claim"})
        self.assertEqual(ancestors(graph, "claim"), {"source", "left", "right"})
        self.assertEqual(descendants(graph, "isolated"), set())
        with self.assertRaises(KeyError):
            ancestors(graph, "missing")

    def test_strongly_connected_components_partition_cycles_and_singletons(self) -> None:
        graph = DirectedGraph()
        graph.add_nodes_from(("a", "b", "c", "d", "self", "isolated"))
        graph.add_edge("a", "b")
        graph.add_edge("b", "a")
        graph.add_edge("b", "c")
        graph.add_edge("c", "d")
        graph.add_edge("d", "c")
        graph.add_edge("self", "self")

        components = {
            frozenset(component)
            for component in strongly_connected_components(graph)
        }
        self.assertEqual(components, {
            frozenset(("a", "b")),
            frozenset(("c", "d")),
            frozenset(("self",)),
            frozenset(("isolated",)),
        })

    def test_topological_generations_are_layered_and_reject_cycles(self) -> None:
        graph = DirectedGraph()
        graph.add_nodes_from(("source", "isolated", "left", "right", "claim"))
        graph.add_edge("source", "left")
        graph.add_edge("source", "right")
        graph.add_edge("left", "claim")
        graph.add_edge("right", "claim")

        self.assertEqual(
            [set(generation) for generation in topological_generations(graph)],
            [{"source", "isolated"}, {"left", "right"}, {"claim"}],
        )

        cyclic = DirectedGraph()
        cyclic.add_edge("a", "b")
        cyclic.add_edge("b", "a")
        with self.assertRaisesRegex(ValueError, "acyclic"):
            list(topological_generations(cyclic))

    def test_immediate_dominators_choose_the_nearest_unavoidable_node(self) -> None:
        graph = DirectedGraph()
        graph.add_nodes_from(("root", "left", "right", "merge", "tail", "unreachable"))
        graph.add_edge("root", "left")
        graph.add_edge("root", "right")
        graph.add_edge("left", "merge")
        graph.add_edge("right", "merge")
        graph.add_edge("merge", "tail")

        self.assertEqual(immediate_dominators(graph, "root"), {
            "left": "root",
            "right": "root",
            "merge": "root",
            "tail": "merge",
        })


if __name__ == "__main__":
    unittest.main()
