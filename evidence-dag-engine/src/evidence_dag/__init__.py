"""Evidence-DAG engine (SciForge 证据 DAG, 阶段一).

Standalone, dependency-light (stdlib + networkx) Python module. One thread ==
one graph. Turns an agent trace into a typed claim-evidence DAG, verifies
supports edges with an NLI judge, and serialises to PROV-JSON.
"""
from .graph import ThreadGraph
from .model import Edge, EdgeRel, Node, NodeStatus, NodeType
from .service import Engine

__version__ = "0.1.0"

__all__ = [
    "ThreadGraph", "Engine",
    "Node", "Edge", "NodeType", "NodeStatus", "EdgeRel",
    "__version__",
]
