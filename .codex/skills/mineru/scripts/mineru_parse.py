#!/usr/bin/env python3
"""MinerU document parsing CLI.

No third-party dependencies. Standard API reads its token from MINERU_API_KEY.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


MINERU_BASE = "https://mineru.net"
AGENT_BASE = "https://mineru.net/api/v1/agent"
USER_AGENT = "SciForge-MinerU-Skill/1.0"


def open_with_retries(req: urllib.request.Request, timeout: int, attempts: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except urllib.error.HTTPError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(min(2 * attempt, 8))
    raise RuntimeError(f"Request failed after {attempts} attempts: {last_error}")


def request_json(method: str, url: str, payload: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "*/*", "User-Agent": USER_AGENT}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        raw = open_with_retries(req, timeout=60).decode("utf-8")
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code} from {url}: {body}") from err
    result = json.loads(raw)
    if result.get("code") != 0:
        raise RuntimeError(f"MinerU API error: {result.get('msg') or result}")
    return result


def put_file(url: str, path: Path) -> int:
    data = path.read_bytes()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Content-Type": ""}, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return int(res.status)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Upload failed with HTTP {err.code}: {body}") from err


def download(url: str, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"Accept": "*/*", "User-Agent": USER_AGENT})
    try:
        path.write_bytes(open_with_retries(req, timeout=300))
    except Exception:
        curl = subprocess.run(
            ["curl", "-L", "--retry", "3", "-A", USER_AGENT, "-o", str(path), url],
            text=True,
            capture_output=True,
            timeout=300,
        )
        if curl.returncode != 0:
            raise RuntimeError(curl.stderr.strip() or curl.stdout.strip() or "curl download failed")
    return path


def safe_name(value: str, fallback: str) -> str:
    raw = value.strip() or fallback
    out = "".join(c if c.isalnum() or c in "._-" else "-" for c in raw)
    out = "-".join(part for part in out.split("-") if part)
    return (out or fallback)[:120]


def api_token() -> str:
    token = os.environ.get("MINERU_API_KEY", "").strip()
    if not token:
        raise RuntimeError("MINERU_API_KEY is required for standard MinerU API mode.")
    return token


def parse_common_args(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "language": args.language,
        "enable_table": not args.disable_table,
        "is_ocr": args.ocr,
        "enable_formula": not args.disable_formula,
    }
    if args.pages:
        if args.mode.startswith("agent-"):
            payload["page_range"] = args.pages
        else:
            payload["page_ranges"] = args.pages
    return payload


def standard_options(args: argparse.Namespace) -> dict[str, Any]:
    payload = parse_common_args(args)
    payload["model_version"] = args.model_version
    if args.extra_format:
        payload["extra_formats"] = args.extra_format
    if args.no_cache:
        payload["no_cache"] = True
    return payload


def poll_standard_task(task_id: str, token: str, timeout: int, interval: int) -> dict[str, Any]:
    url = f"{MINERU_BASE}/api/v4/extract/task/{task_id}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = request_json("GET", url, token=token)["data"]
        state = data.get("state")
        if state == "done":
            return data
        if state == "failed":
            raise RuntimeError(f"MinerU task failed: {data.get('err_msg')}")
        print(f"state={state}", file=sys.stderr)
        time.sleep(interval)
    raise TimeoutError(f"Timed out waiting for task_id={task_id}")


def poll_standard_batch(batch_id: str, token: str, timeout: int, interval: int) -> list[dict[str, Any]]:
    url = f"{MINERU_BASE}/api/v4/extract-results/batch/{batch_id}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = request_json("GET", url, token=token)["data"]
        items = data.get("extract_result") or []
        states = [item.get("state") for item in items]
        if items and all(state == "done" for state in states):
            return items
        failed = [item for item in items if item.get("state") == "failed"]
        if failed:
            raise RuntimeError(f"MinerU batch failed: {failed}")
        print(f"states={states or ['waiting']}", file=sys.stderr)
        time.sleep(interval)
    raise TimeoutError(f"Timed out waiting for batch_id={batch_id}")


def poll_agent(task_id: str, timeout: int, interval: int) -> dict[str, Any]:
    url = f"{AGENT_BASE}/parse/{task_id}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = request_json("GET", url)["data"]
        state = data.get("state")
        if state == "done":
            return data
        if state == "failed":
            raise RuntimeError(f"MinerU agent task failed: {data.get('err_msg')}")
        print(f"state={state}", file=sys.stderr)
        time.sleep(interval)
    raise TimeoutError(f"Timed out waiting for task_id={task_id}")


def extract_zip(zip_path: Path, out_dir: Path) -> list[str]:
    extract_dir = out_dir / zip_path.stem
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)
    return [str(path) for path in sorted(extract_dir.rglob("*")) if path.is_file()]


def standard_url(args: argparse.Namespace) -> dict[str, Any]:
    token = api_token()
    payload = standard_options(args)
    payload["url"] = args.url
    if args.data_id:
        payload["data_id"] = args.data_id
    task_id = request_json("POST", f"{MINERU_BASE}/api/v4/extract/task", payload, token)["data"]["task_id"]
    result = poll_standard_task(task_id, token, args.timeout, args.interval)
    out_dir = Path(args.output_dir)
    try:
        zip_path = download(result["full_zip_url"], out_dir / f"{safe_name(args.data_id or task_id, 'mineru')}.zip")
        extracted = extract_zip(zip_path, out_dir)
        return {"mode": args.mode, "task_id": task_id, "full_zip_url": result["full_zip_url"], "zip_path": str(zip_path), "extracted_files": extracted}
    except Exception as exc:
        return {"mode": args.mode, "task_id": task_id, "full_zip_url": result["full_zip_url"], "download_error": str(exc)}


def standard_file(args: argparse.Namespace) -> dict[str, Any]:
    token = api_token()
    path = Path(args.file)
    payload = standard_options(args)
    file_entry: dict[str, Any] = {"name": path.name}
    if args.data_id:
        file_entry["data_id"] = args.data_id
    if args.pages:
        file_entry["page_ranges"] = args.pages
    payload["files"] = [file_entry]
    data = request_json("POST", f"{MINERU_BASE}/api/v4/file-urls/batch", payload, token)["data"]
    batch_id = data["batch_id"]
    put_file(data["file_urls"][0], path)
    items = poll_standard_batch(batch_id, token, args.timeout, args.interval)
    item = items[0]
    out_dir = Path(args.output_dir)
    try:
        zip_path = download(item["full_zip_url"], out_dir / f"{safe_name(args.data_id or path.stem, 'mineru')}.zip")
        extracted = extract_zip(zip_path, out_dir)
        return {"mode": args.mode, "batch_id": batch_id, "full_zip_url": item["full_zip_url"], "zip_path": str(zip_path), "extracted_files": extracted}
    except Exception as exc:
        return {"mode": args.mode, "batch_id": batch_id, "full_zip_url": item["full_zip_url"], "download_error": str(exc)}


def agent_url(args: argparse.Namespace) -> dict[str, Any]:
    payload = parse_common_args(args)
    payload["url"] = args.url
    task_id = request_json("POST", f"{AGENT_BASE}/parse/url", payload)["data"]["task_id"]
    result = poll_agent(task_id, args.timeout, args.interval)
    try:
        out_path = download(result["markdown_url"], Path(args.output_dir) / f"{safe_name(task_id, 'mineru')}.md")
        return {"mode": args.mode, "task_id": task_id, "markdown_url": result["markdown_url"], "markdown_path": str(out_path)}
    except Exception as exc:
        return {"mode": args.mode, "task_id": task_id, "markdown_url": result["markdown_url"], "download_error": str(exc)}


def agent_file(args: argparse.Namespace) -> dict[str, Any]:
    path = Path(args.file)
    payload = parse_common_args(args)
    payload["file_name"] = path.name
    data = request_json("POST", f"{AGENT_BASE}/parse/file", payload)["data"]
    task_id = data["task_id"]
    put_file(data["file_url"], path)
    result = poll_agent(task_id, args.timeout, args.interval)
    try:
        out_path = download(result["markdown_url"], Path(args.output_dir) / f"{safe_name(path.stem, 'mineru')}.md")
        return {"mode": args.mode, "task_id": task_id, "markdown_url": result["markdown_url"], "markdown_path": str(out_path)}
    except Exception as exc:
        return {"mode": args.mode, "task_id": task_id, "markdown_url": result["markdown_url"], "download_error": str(exc)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse documents with MinerU.")
    parser.add_argument("mode", choices=["standard-file", "standard-url", "agent-file", "agent-url"])
    parser.add_argument("target", help="Local file path for *-file modes, URL for *-url modes.")
    parser.add_argument("--output-dir", default="mineru-output")
    parser.add_argument("--language", default="ch")
    parser.add_argument("--pages", help="Page range, e.g. 1-10 or 2,4-6.")
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--disable-table", action="store_true")
    parser.add_argument("--disable-formula", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--model-version", default="vlm", choices=["pipeline", "vlm", "MinerU-HTML"])
    parser.add_argument("--extra-format", action="append", choices=["docx", "html", "latex"])
    parser.add_argument("--data-id")
    parser.add_argument("--no-cache", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.file = args.target
    args.url = args.target
    try:
        if args.mode == "standard-file":
            result = standard_file(args)
        elif args.mode == "standard-url":
            result = standard_url(args)
        elif args.mode == "agent-file":
            result = agent_file(args)
        else:
            result = agent_url(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
