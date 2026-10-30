"""Emit one Evidence-built shared rerun spec for the TypeScript contract test."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
sys.path.insert(0, os.path.dirname(__file__))

from evidence_dag.rerun import build_rerun_spec  # noqa: E402
from test_reproducibility_v3 import build_graph  # noqa: E402


temporary, graph, conclusion, snapshot, _delta = build_graph(include_approval=True)
try:
    print(json.dumps(
        build_rerun_spec(graph, snapshot, conclusion.id),
        ensure_ascii=False,
        separators=(",", ":"),
    ))
finally:
    temporary.cleanup()
