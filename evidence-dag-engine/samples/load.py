"""Load all sample traces into a running Evidence-DAG engine.

Each sample is a multi-turn agent trace; the engine extracts one DAG per thread
(extract + auto-verify), after which the threads show up in the web UI dropdown.

Usage (engine must be running on :3897):
  python samples/load.py                 # loads every samples/*.json
  EDAG_URL=http://127.0.0.1:3897 python samples/load.py
"""
from __future__ import annotations

import glob
import json
import os
import urllib.request

URL = os.environ.get("EDAG_URL", "http://127.0.0.1:3897").rstrip("/")
HERE = os.path.dirname(__file__)


def main() -> None:
    files = sorted(glob.glob(os.path.join(HERE, "*.json")))
    if not files:
        print("no sample *.json found")
        return
    print(f"loading {len(files)} sample(s) into {URL} (each does extract + auto-verify) ...\n")
    for path in files:
        sample = json.load(open(path, encoding="utf-8"))
        tid = sample["thread_id"]
        body = json.dumps({"trace": sample["trace"]}).encode("utf-8")
        req = urllib.request.Request(
            f"{URL}/threads/{tid}/ingest-trace", data=body,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        title = sample.get("title", tid)
        turns = sum(1 for it in sample["trace"] if it.get("type") == "message" and it.get("role") == "user")
        try:
            r = json.load(urllib.request.urlopen(req, timeout=900))
            print(f"  ✓ {title}")
            print(f"      thread={tid}  turns={turns}  items={len(sample['trace'])}  ->  {r.get('summary')}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {tid}: FAILED {exc}")
    print(f"\nopen {URL}/ and pick a thread from the dropdown.")


if __name__ == "__main__":
    main()
