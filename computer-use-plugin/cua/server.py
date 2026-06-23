"""HTTP ServiceResult API for the Computer-Use plugin (stdlib, zero-dep).

  GET  /health
  GET  /version
  POST /computer-use/run    -> ServiceResult<ComputerUseRun>

Request body for /computer-use/run:
  {
    "instruction": "open Notepad and type hello",
    "execute": false,            # default false -> dry-run (no real actions)
    "approve": false,            # must be true (and server CUA_ALLOW_EXECUTE=true) to act
    "imagePath": "..." | "imageBase64": "...",  # optional: use a static screen (test/headless)
    "requestId": "..."
  }

The screen source is the LOCAL desktop (this is meant to run on the user's Win/Mac
machine). imagePath/imageBase64 override it for testing or headless dry-runs.
"""
from __future__ import annotations
import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

from . import result as R
from . import cancel
from .config import CONFIG
from .runner import run_task

VERSION = "0.1.0"


def _screenshot_provider(body: dict):
    if body.get("imageBase64"):
        raw = base64.b64decode(body["imageBase64"].split(",")[-1])
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return lambda: img
    if body.get("imagePath"):
        img = Image.open(body["imagePath"]).convert("RGB")
        return lambda: img
    # live local desktop
    from driver.desktop import DesktopExecutor
    ex = DesktopExecutor(dry_run=not (body.get("execute") and body.get("approve")))
    return ex.screenshot


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "data": {"status": "healthy"}})
        if self.path == "/version":
            return self._send(200, {"ok": True, "data": {
                "service": R.SERVICE_ID, "version": VERSION,
                "model": CONFIG.model_name, "engine": "gui-owl-native",
                "allowExecute": CONFIG.allow_execute}})
        return self._send(404, R.err("NOT_FOUND", f"no route {self.path}"))

    def do_POST(self):
        if self.path not in ("/computer-use/run", "/computer-use/cancel"):
            return self._send(404, R.err("NOT_FOUND", f"no route {self.path}"))
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:  # noqa: BLE001
            return self._send(400, R.err("INVALID_ARGUMENT", f"bad json: {e}"))
        # Cancel: flip the flag the in-flight run checks between steps so it stops
        # driving the desktop. Runs on a separate thread from the run loop.
        if self.path == "/computer-use/cancel":
            rid = body.get("requestId")
            if not rid:
                return self._send(400, R.err("INVALID_ARGUMENT", "requestId is required"))
            cancel.request_cancel(rid)
            return self._send(200, {"ok": True, "data": {"cancelled": rid}})
        try:
            provider = _screenshot_provider(body)
            res = run_task(
                CONFIG, body.get("instruction", ""), provider,
                execute=bool(body.get("execute")), approve=bool(body.get("approve")),
                request_id=body.get("requestId"))
            code = 200 if res.get("ok") else (
                403 if res.get("error", {}).get("code") == "NEEDS_APPROVAL" else 400)
            return self._send(code, res)
        except Exception as e:  # noqa: BLE001
            return self._send(500, R.err("INTERNAL_ERROR", str(e), retryable=True))


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", CONFIG.port), Handler)
    print(f"computer-use plugin on http://127.0.0.1:{CONFIG.port} "
          f"(model={CONFIG.model_name} @ {CONFIG.model_base_url}, "
          f"allow_execute={CONFIG.allow_execute})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
