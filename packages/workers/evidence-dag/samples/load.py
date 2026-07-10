"""Load all sample traces into a running Evidence-DAG engine.

Each sample enters the same /updates compiler command used by automatic feeds.

Usage (engine must be running on :3897):
  SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token python samples/load.py
  EDAG_URL=http://127.0.0.1:3897 SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token python samples/load.py
"""
from __future__ import annotations

import glob
import json
import os
import urllib.request

URL = os.environ.get("EDAG_URL", "http://127.0.0.1:3897").rstrip("/")
API_KEY = os.environ.get("SCIFORGE_EVIDENCE_DAG_API_KEY", "").strip()
HERE = os.path.dirname(__file__)
WORKSPACE_ROOT = os.environ.get("EDAG_SAMPLE_WORKSPACE_ROOT", os.path.abspath(os.path.join(HERE, "../../../..")))
PROJECT_KEY = os.environ.get("EDAG_SAMPLE_PROJECT_KEY", "evidence-dag-samples")


def main() -> None:
    if not API_KEY:
        print("SCIFORGE_EVIDENCE_DAG_API_KEY is required")
        return
    files = sorted(glob.glob(os.path.join(HERE, "*.json")))
    if not files:
        print("no sample *.json found")
        return
    print(f"loading {len(files)} sample(s) into {URL} through /updates ...\n")
    for path in files:
        sample = json.load(open(path, encoding="utf-8"))
        tid = sample["thread_id"]
        watermark = str(sample["trace"][-1].get("id") or len(sample["trace"]))
        body = json.dumps({
            "threadId": tid,
            "targetWatermark": watermark,
            "reason": "manual_update",
            "priority": "P2",
            "workspaceRoot": WORKSPACE_ROOT,
            "projectRoot": WORKSPACE_ROOT,
            "projectKey": PROJECT_KEY,
            "trace": sample["trace"],
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{URL}/updates", data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}, method="POST",
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
