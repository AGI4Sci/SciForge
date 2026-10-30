"""Seed synthetic committed evidence with the installed dependency wheel."""
import json
from pathlib import Path
import sys
from evidence_dag.graph import ThreadGraph
from evidence_dag import provjson
from evidence_dag.snapshot import build_snapshot, snapshot_filename

root = Path(sys.argv[1])
evidence = root / 'evidence'
evidence.mkdir(parents=True, exist_ok=True)
graph = ThreadGraph('codex:t')
snapshot = build_snapshot(graph, version=1, input_watermark='turn:1')
graph.meta['snapshot'] = snapshot.to_dict()
(evidence / snapshot_filename('codex:t')).write_text(provjson.dumps(graph))
metadata = snapshot.to_dict()
metadata.pop('status')
(root / 'fixture.json').write_text(json.dumps(metadata))
