"""SciForge Project DAG — compiles per-thread evidence DAGs into one
goal-oriented, bi-temporal project graph.

Reuses the evidence-dag engine as a library: PROV-JSON parsing, the Model
Router LLM client, and the dominator-based load-bearing / fragility /
pseudo-robust analysis all come from `evidence_dag`; this package only adds
the cross-session layer (goals, entity resolution, claim matching, conflict
adjudication, review queue).
"""
from __future__ import annotations

import os
import sys

__version__ = "0.3.0"

# Make the sibling evidence-dag package importable without an install step —
# the two workers ship side by side in packages/workers/.
_EDAG_SRC = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "evidence-dag", "src"))
if _EDAG_SRC not in sys.path and os.path.isdir(_EDAG_SRC):
    sys.path.insert(0, _EDAG_SRC)
