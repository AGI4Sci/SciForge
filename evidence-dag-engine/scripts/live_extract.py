"""Live 1A check: real-LLM extraction on the fixture trace, then verify +
metrics + lossless PROV-JSON round-trip. Prints an auditable node/edge dump.

Usage (PowerShell):
  $env:EDAG_LLM_BASE_URL='http://35.220.164.252:3888/v1'
  $env:EDAG_LLM_API_KEY='sk-...'; $env:EDAG_LLM_MODEL='bailian/deepseek-v4-flash'
  python scripts/live_extract.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag import provjson  # noqa: E402
from evidence_dag.extractor import extract_dag  # noqa: E402
from evidence_dag.llm import OpenAICompatLLM  # noqa: E402
from evidence_dag.metrics import all_metrics  # noqa: E402
from evidence_dag.model import EdgeRel  # noqa: E402
from evidence_dag.verifier import verify  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "lk99_trace.json")


def main() -> None:
    with open(FIX, encoding="utf-8") as fh:
        fx = json.load(fh)
    llm = OpenAICompatLLM()
    print(f"== extracting via {llm.model} ==")
    g = extract_dag(fx["trace"], llm, fx["thread_id"])

    short = {n.id: n for n in g.nodes.values()}
    print(f"\n== NODES ({len(g.nodes)}) ==")
    for n in g.nodes.values():
        ref = f"  ref={n.ref}" if n.ref else ""
        print(f"  [{n.type.value:9}] ref@{n.trace_ref or '-':8} {n.content[:90]}{ref}")
    print(f"\n== EDGES ({len(g.edges)}) ==")
    for e in g.edges.values():
        print(f"  {e.rel.value:12} {short[e.src].type.value}->{short[e.dst].type.value}"
              f"   {short[e.src].content[:40]!r} -> {short[e.dst].content[:40]!r}")

    print("\n== CYCLE REPORT ==")
    print(json.dumps(g.detect_cycles(), ensure_ascii=False, indent=2))

    print("\n== VERIFY (NLI ν on supports edges) ==")
    diff = verify(g, llm, threshold=0.7)
    print(f"  scored {diff['supports_edges_scored']} supports edges; "
          f"{len(diff['status_changes'])} status change(s)")
    for e in g.edges_of(EdgeRel.SUPPORTS):
        print(f"    ν={e.nli_score}  {short[e.src].content[:35]!r} -> {short[e.dst].content[:35]!r}")

    print("\n== METRICS (AAR) ==")
    print(json.dumps(all_metrics(g), ensure_ascii=False, indent=2))

    # lossless round-trip
    reloaded = provjson.loads(provjson.dumps(g))
    assert reloaded.to_dict() == g.to_dict(), "PROV-JSON round-trip NOT lossless!"
    print("\n== PROV-JSON round-trip: LOSSLESS ✓ ==")

    # save artifacts for inspection
    out_dir = os.path.join(os.path.dirname(__file__), "..", "out")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "lk99.prov.json"), "w", encoding="utf-8") as fh:
        fh.write(provjson.dumps(g))
    print(f"   wrote {os.path.join(out_dir, 'lk99.prov.json')}")


if __name__ == "__main__":
    main()
