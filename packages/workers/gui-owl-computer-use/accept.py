#!/usr/bin/env python
"""真机验收小客户端 / Real-machine acceptance client.

向正在运行的 computer-use HTTP 服务发送几个示例任务并打印 trace。
Fires a few sample tasks at the running computer-use HTTP service and prints the trace.

用法 / Usage:
    python accept.py                         # dry-run (默认, 不动真机)
    python accept.py --execute               # 真机执行 (发送 execute+approve)
    python accept.py --task "打开记事本并输入 hello"   # 自定义单个任务
    python accept.py --url http://127.0.0.1:3900

仅用标准库 (urllib), 无需额外依赖。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import uuid

# 控制台用 UTF-8 输出, 避免中文在 GBK 控制台乱码。
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

# 默认示例任务 (Windows 上较安全、可观察) / default sample tasks.
DEFAULT_TASKS = [
    "open the Windows Start menu",
    "open Notepad",
    "type the text: Hello from GUI-Owl computer use",
]


def post(url: str, path: str, body: dict, timeout: float = 600.0) -> dict:
    req = urllib.request.Request(
        url.rstrip("/") + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:  # service returns JSON error bodies too
        try:
            return json.load(e)
        except Exception:  # noqa: BLE001
            return {"ok": False, "error": {"code": "HTTP", "message": f"{e.code} {e.reason}"}}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": {"code": "TRANSPORT", "message": str(e)}}


def print_result(task: str, res: dict) -> None:
    print("\n" + "=" * 78)
    print(f"TASK: {task}")
    if not res.get("ok"):
        err = res.get("error", {})
        print(f"  -> ERROR {err.get('code')}: {err.get('message')}")
        if err.get("blockedReason"):
            print(f"     blocked: {err['blockedReason']}")
        return
    data = res.get("data", {})
    print(f"  status={data.get('status')}  executed={data.get('executed')}  "
          f"steps={data.get('stepCount')}  screen={data.get('screen')}")
    for s in data.get("steps", []):
        mark = "OK" if s.get("executed") else ".."
        print(f"   [{mark}] step{s.get('step')}: {s.get('plan')}")
        print(f"        action={s.get('action')}  coords={s.get('coords')}")
        if s.get("exec_error"):
            print(f"        exec_error={s['exec_error']}")
    if res.get("summary"):
        print(f"  summary: {res['summary']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:3900")
    ap.add_argument("--execute", action="store_true", help="真机执行 (发送 execute+approve)")
    ap.add_argument("--task", action="append", help="自定义任务 (可重复); 不给则用默认列表")
    args = ap.parse_args()

    try:
        with urllib.request.urlopen(args.url.rstrip("/") + "/health", timeout=5) as r:
            json.load(r)
    except Exception as e:  # noqa: BLE001
        print(f"服务不可达 {args.url} : {e}\n请先运行 启动-sciforge-computer-use.ps1", file=sys.stderr)
        return 2

    tasks = args.task if args.task else DEFAULT_TASKS
    mode = "EXECUTE (真机)" if args.execute else "DRY-RUN (安全)"
    print(f"computer-use 验收 @ {args.url}  模式: {mode}  任务数: {len(tasks)}")

    for task in tasks:
        body = {"instruction": task, "requestId": str(uuid.uuid4())}
        if args.execute:
            body["execute"] = True
            body["approve"] = True
        print_result(task, post(args.url, "/computer-use/run", body))
    print("\n" + "=" * 78 + "\n验收结束。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
