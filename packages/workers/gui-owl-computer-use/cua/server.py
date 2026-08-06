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
import hmac
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

from PIL import Image

from . import result as R
from .config import CONFIG
from .runner import run_task
from .service import SERVICE

VERSION = "0.1.0"


def _bearer_token(value: Optional[str]) -> str:
    if not value:
        return ""
    scheme, _, token = value.strip().partition(" ")
    if scheme.lower() != "bearer" or not token:
        return ""
    return token.strip()


def _auth_error() -> dict:
    # If execution is enabled, require an explicit token even before checking the
    # request header. This prevents an accidentally unauthenticated live sidecar.
    if not CONFIG.service_token and CONFIG.allow_execute:
        return R.err(
            "UNAUTHENTICATED",
            "CUA_SERVICE_TOKEN is required when CUA_ALLOW_EXECUTE=true.",
            blocked_reason="sidecar-auth-required")
    return R.err("UNAUTHENTICATED", "missing or invalid bearer token")


def _check_auth(header_value: Optional[str]) -> Optional[dict]:
    if not CONFIG.service_token and not CONFIG.allow_execute:
        return None
    if not CONFIG.service_token:
        return _auth_error()
    token = _bearer_token(header_value)
    if hmac.compare_digest(token, CONFIG.service_token):
        return None
    return _auth_error()


def _screenshot_provider(body: dict):
    if body.get("imageBase64"):
        raw = base64.b64decode(body["imageBase64"].split(",")[-1])
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return lambda: img
    if body.get("imagePath"):
        img = Image.open(body["imagePath"]).convert("RGB")
        return lambda: img
    return None


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
                "model": CONFIG.model_router_model, "engine": "sciforge-model-router",
                "endpoint": "responses",
                "protocolVersion": 2,
                "backendsConnected": SERVICE.status()["backendsConnected"],
                "approvalProof": "legacy-trust-boundary",
                "allowExecute": CONFIG.allow_execute,
                "authRequired": bool(CONFIG.service_token or CONFIG.allow_execute)}})
        if self.path == "/computer-use/status":
            return self._send(200, {"ok": True, "data": SERVICE.status()})
        if self.path == "/computer-use/capabilities":
            return self._send(200, {"ok": True, "data": SERVICE.capabilities()})
        if self.path == "/computer-use/targets":
            return self._send(200, {"ok": True, "data": SERVICE.list_targets()})
        return self._send(404, R.err("NOT_FOUND", f"no route {self.path}"))

    def do_POST(self):
        if self.path not in (
            "/computer-use/run", "/computer-use/cancel",
            "/computer-use/sessions/bind", "/computer-use/sessions/release",
        ):
            return self._send(404, R.err("NOT_FOUND", f"no route {self.path}"))
        auth_error = _check_auth(self.headers.get("Authorization"))
        if auth_error:
            return self._send(401, auth_error)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:  # noqa: BLE001
            return self._send(400, R.err("INVALID_ARGUMENT", f"bad json: {e}"))
        # Cancel: flip the flag the in-flight run checks between steps so it stops
        # driving the desktop. Runs on a separate thread from the run loop.
        if self.path == "/computer-use/cancel":
            res = SERVICE.cancel(body)
            return self._send(200 if res.get("ok") else 400, res)
        if self.path == "/computer-use/sessions/bind":
            res = SERVICE.bind_session(body)
            return self._send(200 if res.get("ok") else 400, res)
        if self.path == "/computer-use/sessions/release":
            res = SERVICE.release_session(body)
            return self._send(200 if res.get("ok") else 409, res)

        def execute_channel(request: dict, channel) -> dict:
            return run_task(
                CONFIG, request["instruction"], channel,
                execute=request["execute"], approve=request["approve"],
            )

        try:
            res = SERVICE.run(
                body,
                execute_channel,
                channel_options={
                    "allow_execute": CONFIG.allow_execute,
                    "settle_s": CONFIG.settle_s,
                    "show_overlay": CONFIG.show_overlay,
                    "screenshot_provider": (
                        _screenshot_provider(body)
                        if body.get("imagePath") or body.get("imageBase64")
                        else None
                    ),
                },
            )
            code = 200 if res.get("ok") else (
                403 if res.get("error", {}).get("code") == "NEEDS_APPROVAL" else
                503 if res.get("error", {}).get("code") == "BACKEND_UNAVAILABLE" else 400)
            return self._send(code, res)
        except Exception as e:  # noqa: BLE001
            return self._send(500, R.err("INTERNAL_ERROR", str(e), retryable=True))


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", CONFIG.port), Handler)
    print(f"computer-use plugin on http://127.0.0.1:{CONFIG.port} "
          f"(model-router={CONFIG.model_router_model} @ {CONFIG.model_router_base_url}, "
          f"allow_execute={CONFIG.allow_execute}, "
          f"auth_required={bool(CONFIG.service_token or CONFIG.allow_execute)})")
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
        SERVICE.shutdown()


if __name__ == "__main__":
    main()
