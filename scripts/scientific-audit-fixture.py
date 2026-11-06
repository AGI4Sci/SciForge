"""Fixed isolated structural fixture; no extraction model or scientific run."""
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packages/domains/evidence-dag/python'))
from evidence_dag.audit import run_audit
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, NodeType
from evidence_dag.reconcile import reconcile

start = perf_counter()
graph = ThreadGraph('synthetic-audit')
source = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, 'One common experimental origin')
a = graph.add_or_get_node(NodeType.REASONING, 'Analysis A of that origin')
b = graph.add_or_get_node(NodeType.REASONING, 'Analysis B of that origin')
claim = graph.add_or_get_node(NodeType.CONCLUSION, 'Two apparent supports establish benefit')
for left, right in [(source, a), (source, b), (a, claim), (b, claim)]:
    graph.add_edge(left.id, right.id, EdgeRel.SUPPORTS, nli_score=0.95)
audit = run_audit(graph, run_id='audit:fixed-origin')
impact = reconcile(graph, remove_nodes=[source.id])
print(json.dumps({'claimId': claim.id, 'audit': audit, 'impact': impact, 'latencyMs': (perf_counter() - start) * 1000}))
