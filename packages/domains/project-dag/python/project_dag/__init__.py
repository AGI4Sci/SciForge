"""SciForge Project DAG — compiles per-thread evidence DAGs into one
goal-oriented, bi-temporal project graph.

Reuses the evidence-dag engine as a library: PROV-JSON parsing, the Model
Router LLM client, and the dominator-based load-bearing / fragility /
pseudo-robust analysis all come from `evidence_dag`; this package only adds
the cross-session layer (goals, entity resolution, claim matching, conflict
adjudication, review queue).
"""
from __future__ import annotations

__version__ = "1.0.0"
