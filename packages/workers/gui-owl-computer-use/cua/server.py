"""Authenticated loopback HTTP boundary for the CDP control service."""
from __future__ import annotations

import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import result as R
from .config import CONFIG
from .invocation_proof import INVOCATION_HEADER, InvocationProofError, InvocationProofVerifier
from .runner import run_task
from .service import SERVICE

VERSION = "1.0.0"
PROOF_VERIFIER = InvocationProofVerifier(
    CONFIG.invocation_secret, mode=CONFIG.invocation_proof_mode,
    max_ttl_ms=CONFIG.invocation_proof_ttl_ms,
)
SERVICE.configure_approval_proof(CONFIG.invocation_proof_mode)


def _bearer(value: str | None) -> str:
    scheme, _, token = (value or "").strip().partition(" ")
    return token if scheme.lower() == "bearer" else ""


class Handler(BaseHTTPRequestHandler):
    service = SERVICE
    config = CONFIG
    verifier = PROOF_VERIFIER
    max_body_bytes = 1_048_576

    def log_message(self, *_args): pass

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        token = _bearer(self.headers.get("Authorization"))
        return bool(self.config.service_token and hmac.compare_digest(token, self.config.service_token))

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > self.max_body_bytes: raise ValueError("request body is too large")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict): raise ValueError("request body must be an object")
        return value

    def do_GET(self) -> None:
        if self.path == "/health": return self._send(200, R.ok({"status": "healthy"}))
        if self.path == "/version": return self._send(200, R.ok({"service": R.SERVICE_ID, "version": VERSION, "planner": False, "backend": "browser-cdp"}))
        if not self._authorized(): return self._send(401, R.err("UNAUTHENTICATED", "invalid bearer token"))
        routes = {
            "/computer-use/status": self.service.status,
            "/computer-use/capabilities": self.service.capabilities,
            "/computer-use/targets": self.service.list_targets,
        }
        handler = routes.get(self.path)
        return self._send(200, R.ok(handler()) if handler else R.err("NOT_FOUND", f"no route {self.path}"))

    def do_POST(self) -> None:
        if not self._authorized(): return self._send(401, R.err("UNAUTHENTICATED", "invalid bearer token"))
        try: body = self._body()
        except (ValueError, json.JSONDecodeError) as error:
            return self._send(400, R.err("INVALID_ARGUMENT", str(error)))
        if self.path == "/computer-use/backends/cdp/configure":
            result = self.service.configure_cdp_adapter(
                str(body.get("adapterUrl") or ""), str(body.get("adapterToken") or ""),
                expected_adapter_url=str(body.get("expectedAdapterUrl") or ""),
            )
            return self._send(200 if result.get("ok") else 400, result)
        if self.path == "/computer-use/reclaim-owner":
            try:
                result = self.service.reclaim_owner(
                    str(body.get("runtimeId") or ""), str(body.get("threadId") or ""),
                    str(body.get("turnId") or ""), str(body.get("reason") or "turn_terminal"),
                )
            except ValueError as error:
                result = R.err("INVALID_ARGUMENT", str(error))
            return self._send(200 if result.get("ok") else 400, result)
        if self.path == "/computer-use/reclaim-cleanup":
            return self._send(200, self.service.reclaim_cleanup())
        route = {
            "/computer-use/sessions/bind": ("computer_use_bind_target", self.service.bind_session),
            "/computer-use/run": ("computer_use", lambda value, identity: self.service.run(value, run_task, invocation=identity)),
            "/computer-use/cancel": ("computer_use_cancel", lambda value, identity: self.service.cancel(value, invocation=identity)),
            "/computer-use/sessions/release": ("computer_use_release_session", self.service.release_session),
        }.get(self.path)
        if route is None: return self._send(404, R.err("NOT_FOUND", f"no route {self.path}"))
        tool, operation = route
        try:
            proof_arguments = dict(body)
            if tool == "computer_use": proof_arguments.pop("requestId", None)
            identity = self.verifier.verify(
                self.headers.get(INVOCATION_HEADER), tool=tool, arguments=proof_arguments,
                expected_request_id=body.get("requestId") if isinstance(body.get("requestId"), str) else None,
            )
        except InvocationProofError as error:
            return self._send(403, R.err(error.code, str(error)))
        result = operation(body, identity)
        return self._send(200 if result.get("ok") else _status(result), result)


def _status(result: dict[str, Any]) -> int:
    code = result.get("error", {}).get("code")
    if code in {"SESSION_BUSY", "TARGET_BUSY", "CLEANUP_INCOMPLETE"}: return 409
    if code in {"UNAUTHENTICATED", "APPROVAL_PROOF_REQUIRED"}: return 403
    if code in {"TIMEOUT", "CANCEL_PENDING"}: return 408
    return 400


def main() -> None:
    ThreadingHTTPServer(("127.0.0.1", CONFIG.port), Handler).serve_forever()


if __name__ == "__main__": main()
