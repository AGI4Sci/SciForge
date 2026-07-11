"""HTTP service exposing the engine, ServiceResult-shaped per Servic_Module_Template.md.

The module returns structured evidence (graph, provenance, metrics) only —
never a user-level final answer or completion truth.

All graph writes enter POST /updates. Audit and Artifact commands are separate
side-chain/registry commands and never mutate a committed graph in place.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__
from .llm import ModelRouterLLM
from .service import Engine

SERVICE_ID = "evidence-dag-engine"
_UI_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "index.html")
API_TOKEN_ENV = "SCIFORGE_EVIDENCE_DAG_API_KEY"
MAX_JSON_BODY_BYTES_ENV = "SCIFORGE_EVIDENCE_DAG_MAX_BODY_BYTES"
DEFAULT_MAX_JSON_BODY_BYTES = 1_048_576
_READ_CHUNK_BYTES = 64 * 1024
_MAX_CHUNK_LINE_BYTES = 8192


class RequestBodyTooLarge(ValueError):
    pass


def _load_ui() -> Optional[str]:
    try:
        with open(_UI_PATH, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _provenance(operation: str, request_id: str, started: str) -> dict:
    return {"serviceId": SERVICE_ID, "operation": operation,
            "requestId": request_id, "startedAt": started, "completedAt": _now()}


def ok(data: Any, *, summary: Optional[str] = None, operation: str = "",
       request_id: str = "", started: str = "") -> dict:
    res: dict[str, Any] = {"ok": True, "data": data,
                           "provenance": _provenance(operation, request_id, started)}
    if summary:
        res["summary"] = summary
    return res


def err(code: str, message: str, *, retryable: bool = False, operation: str = "",
        request_id: str = "", started: str = "") -> dict:
    return {"ok": False, "error": {"code": code, "message": message, "retryable": retryable},
            "provenance": _provenance(operation, request_id, started)}


class Handler(BaseHTTPRequestHandler):
    engine: Engine = None  # type: ignore[assignment]
    api_token: str = ""
    max_json_body_bytes: int = DEFAULT_MAX_JSON_BODY_BYTES

    def log_message(self, *args):  # silence default stderr spam
        pass

    # --- helpers ------------------------------------------------------------
    def _cors(self) -> None:
        # The bundled UI is same-origin. For local development, allow explicit
        # same-host origins only instead of exposing the localhost API to any page.
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if origin and host:
            try:
                parsed = urlparse(origin)
                if parsed.scheme in ("http", "https") and parsed.netloc == host:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
            except ValueError:
                pass
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status: int, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _normalize_max_body_bytes(value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return DEFAULT_MAX_JSON_BODY_BYTES
        return parsed if parsed > 0 else DEFAULT_MAX_JSON_BODY_BYTES

    def _max_body_bytes(self) -> int:
        return self._normalize_max_body_bytes(self.max_json_body_bytes)

    def _configured_api_token(self) -> str:
        return (self.api_token or os.environ.get(API_TOKEN_ENV, "")).strip()

    def _request_bearer_token(self) -> str:
        header = self.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer":
            return ""
        return token.strip()

    def _require_auth(self, *, operation: str, request_id: str, started: str) -> bool:
        expected = self._configured_api_token()
        if not expected:
            self._send(503, err("UNAVAILABLE", f"{API_TOKEN_ENV} is required for Evidence DAG JSON APIs",
                                retryable=True, operation=operation, request_id=request_id, started=started))
            return False
        supplied = self._request_bearer_token()
        if not supplied or not hmac.compare_digest(supplied, expected):
            self._send(401, err("UNAUTHORIZED", "missing or invalid Evidence DAG bearer token",
                                operation=operation, request_id=request_id, started=started))
            return False
        return True

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _body(self) -> dict:
        transfer_encoding = self.headers.get("Transfer-Encoding", "")
        if any(part.strip().lower() == "chunked" for part in transfer_encoding.split(",")):
            raw = self._read_chunked_body()
            return self._parse_json_body(raw)
        if transfer_encoding and transfer_encoding.strip().lower() != "identity":
            raise ValueError(f"unsupported Transfer-Encoding: {transfer_encoding}")

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return {}
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 0:
            raise ValueError("invalid Content-Length")
        if length <= 0:
            return {}
        max_bytes = self._max_body_bytes()
        if length > max_bytes:
            raise RequestBodyTooLarge(f"JSON body exceeds {max_bytes} bytes")
        raw = self._read_fixed_body(length, max_bytes)
        return self._parse_json_body(raw)

    def _read_fixed_body(self, length: int, max_bytes: int) -> bytes:
        chunks: list[bytes] = []
        remaining = length
        total = 0
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, _READ_CHUNK_BYTES))
            if not chunk:
                raise ValueError("request body ended before Content-Length")
            total += len(chunk)
            if total > max_bytes:
                raise RequestBodyTooLarge(f"JSON body exceeds {max_bytes} bytes")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _read_chunked_body(self) -> bytes:
        max_bytes = self._max_body_bytes()
        chunks: list[bytes] = []
        total = 0
        while True:
            line = self.rfile.readline(_MAX_CHUNK_LINE_BYTES + 1)
            if not line:
                raise ValueError("chunked body ended before final chunk")
            if len(line) > _MAX_CHUNK_LINE_BYTES:
                raise RequestBodyTooLarge(f"chunk header exceeds {_MAX_CHUNK_LINE_BYTES} bytes")
            size_text = line.split(b";", 1)[0].strip()
            try:
                size = int(size_text, 16)
            except ValueError as exc:
                raise ValueError("invalid chunk size") from exc
            if size < 0:
                raise ValueError("invalid chunk size")
            if size == 0:
                self._consume_chunked_trailers()
                return b"".join(chunks)
            total += size
            if total > max_bytes:
                raise RequestBodyTooLarge(f"JSON body exceeds {max_bytes} bytes")
            chunk = self.rfile.read(size)
            if len(chunk) != size:
                raise ValueError("chunked body ended before declared chunk size")
            if self.rfile.read(2) != b"\r\n":
                raise ValueError("invalid chunk framing")
            chunks.append(chunk)

    def _consume_chunked_trailers(self) -> None:
        while True:
            line = self.rfile.readline(_MAX_CHUNK_LINE_BYTES + 1)
            if not line or line in (b"\r\n", b"\n"):
                return
            if len(line) > _MAX_CHUNK_LINE_BYTES:
                raise RequestBodyTooLarge(f"chunk trailer exceeds {_MAX_CHUNK_LINE_BYTES} bytes")

    @staticmethod
    def _parse_json_body(raw: bytes) -> dict:
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f"invalid JSON body: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("request body must be a JSON object")
        return parsed

    @staticmethod
    def _thread_route(path: str) -> tuple[Optional[str], Optional[str]]:
        # /threads/{id}/{action}
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 3 and parts[0] == "threads":
            return unquote(parts[1]), parts[2]
        return None, None

    # --- routing ------------------------------------------------------------
    def do_GET(self):  # noqa: N802
        rid, started = uuid.uuid4().hex, _now()
        parsed = urlparse(self.path)
        path, qs = parsed.path, parse_qs(parsed.query)
        if path == "/health":
            return self._send(200, ok({"status": "ok"}, operation="health", request_id=rid, started=started))
        if path in ("/", "/ui", "/ui/"):
            html = _load_ui()
            if html is None:
                return self._send(404, err("NOT_FOUND", "UI not bundled", operation="ui", request_id=rid, started=started))
            return self._send_html(200, html)
        if not self._require_auth(operation="get", request_id=rid, started=started):
            return
        if path == "/version":
            return self._send(200, ok({"version": __version__, "service": SERVICE_ID},
                                      operation="version", request_id=rid, started=started))
        if path == "/threads":
            return self._send(200, ok({"threads": self.engine.list_threads()},
                                      operation="threads", request_id=rid, started=started))
        if path == "/updates/status":
            tid = (qs.get("threadId") or [None])[0]
            if not tid:
                return self._send(400, err("INVALID_ARGUMENT", "?threadId= required",
                                           operation="updates.status", request_id=rid, started=started))
            return self._send(200, ok(self.engine.update_status(tid),
                                      operation="updates.status", request_id=rid, started=started))
        if path == "/events":
            tid = (qs.get("threadId") or [None])[0]
            event_types = [
                item.strip()
                for value in (qs.get("type") or [])
                for item in value.split(",") if item.strip()
            ]
            try:
                after_sequence = int((qs.get("afterSequence") or ["0"])[0])
                limit = int((qs.get("limit") or ["500"])[0])
                events = self.engine.events(
                    thread_id=tid, event_types=event_types,
                    after_sequence=after_sequence, limit=limit,
                )
            except ValueError as exc:
                return self._send(400, err("INVALID_ARGUMENT", str(exc),
                                           operation="events.list", request_id=rid, started=started))
            return self._send(200, ok({
                "events": events,
                "lastSequence": events[-1]["sequence"] if events else after_sequence,
            }, operation="events.list", request_id=rid, started=started))
        if path == "/audits":
            tid = (qs.get("threadId") or [None])[0]
            if not tid:
                return self._send(400, err("INVALID_ARGUMENT", "?threadId= required",
                                           operation="audits.list", request_id=rid, started=started))
            try:
                self.engine.require(tid)
                runs = self.engine.audit_runs(tid)
            except KeyError as exc:
                return self._send(404, err("NOT_FOUND", str(exc), operation="audits.list",
                                           request_id=rid, started=started))
            return self._send(200, ok({"runs": runs, "latest": runs[0] if runs else None},
                                      operation="audits.list", request_id=rid, started=started))
        tid, action = self._thread_route(path)
        if not tid:
            return self._send(404, err("NOT_FOUND", f"no route for {path}", operation="get", request_id=rid, started=started))
        try:
            if action == "graph":
                g = self.engine.require(tid)
                snapshot = self.engine.latest_snapshot(tid)
                return self._send(200, ok({"summary": g.summary(), "graph": g.to_dict(),
                                           "snapshot": snapshot.to_dict() if snapshot else None},
                                          summary=f"{len(g.nodes)} nodes / {len(g.edges)} edges",
                                          operation="graph", request_id=rid, started=started))
            if action == "metrics":
                return self._send(200, ok(self.engine.metrics(tid), operation="metrics", request_id=rid, started=started))
            if action == "analysis":
                thr = float((qs.get("threshold") or ["0.7"])[0])
                return self._send(200, ok(self.engine.analysis(tid, threshold=thr), operation="analysis", request_id=rid, started=started))
            if action == "snapshot":
                snapshot = self.engine.latest_snapshot(tid)
                if snapshot is None:
                    raise KeyError(tid)
                return self._send(200, ok(snapshot.to_dict(), operation="snapshot",
                                          request_id=rid, started=started))
            if action == "evidence-preview":
                preview_args = {
                    "snapshot_digest": (qs.get("snapshotDigest") or [""])[0].strip(),
                    "source_assertion_id": (qs.get("sourceAssertionId") or [""])[0].strip(),
                    "artifact_version_id": (qs.get("artifactVersionId") or [""])[0].strip(),
                    "source_anchor_id": (qs.get("sourceAnchorId") or [""])[0].strip(),
                }
                if not all(preview_args.values()) or any(
                    len(value) > 512 for value in preview_args.values()
                ) or not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", preview_args["snapshot_digest"]):
                    return self._send(400, err(
                        "INVALID_ARGUMENT",
                        "snapshotDigest, sourceAssertionId, artifactVersionId and sourceAnchorId are required",
                        operation="evidence-preview", request_id=rid, started=started,
                    ))
                return self._send(200, ok(
                    self.engine.trusted_evidence_preview(tid, **preview_args),
                    operation="evidence-preview", request_id=rid, started=started,
                ))
            if action == "provenance":
                node = (qs.get("node") or [None])[0]
                if not node:
                    return self._send(400, err("INVALID_ARGUMENT", "?node= required", operation="provenance", request_id=rid, started=started))
                return self._send(200, ok(self.engine.provenance(tid, node), operation="provenance", request_id=rid, started=started))
            if action == "prov-json":
                return self._send(200, ok(self.engine.export_prov_json(tid), operation="prov-json.export", request_id=rid, started=started))
        except KeyError as exc:
            return self._send(404, err("NOT_FOUND", f"not found: {exc}", operation=action or "get", request_id=rid, started=started))
        except Exception as exc:  # noqa: BLE001
            return self._send(500, err("INTERNAL_ERROR", str(exc), operation=action or "get", request_id=rid, started=started))
        return self._send(404, err("NOT_FOUND", f"no route for {path}", operation="get", request_id=rid, started=started))

    def do_POST(self):  # noqa: N802
        rid, started = uuid.uuid4().hex, _now()
        if not self._require_auth(operation="post", request_id=rid, started=started):
            return
        path = urlparse(self.path).path
        tid, action = self._thread_route(path)
        try:
            body = self._body()
            if path == "/updates":
                result = self.engine.update(
                    thread_id=str(body.get("threadId") or ""),
                    target_watermark=str(body.get("targetWatermark") or ""),
                    reason=str(body.get("reason") or ""), priority=str(body.get("priority") or ""),
                    trace=body.get("trace"), workspace_root=str(body.get("workspaceRoot") or ""),
                    project_key=str(body.get("projectKey") or ""),
                    project_root=body.get("projectRoot"), rebuild=bool(body.get("rebuild", False)),
                    rebuild_rationale=body.get("rebuildRationale"),
                    threshold=float(body.get("threshold", 0.7)),
                    access_policy=body.get("accessPolicy") if isinstance(body.get("accessPolicy"), dict) else None,
                    queued_at=body.get("queuedAt"),
                    correlation_id=body.get("correlationId"),
                    idempotency_key=body.get("idempotencyKey"),
                )
                snapshot = result["snapshot"]
                return self._send(200, ok(result,
                                          summary=f"Evidence Snapshot {snapshot['version']} committed at {snapshot['inputWatermark']}",
                                          operation="updates.create", request_id=rid, started=started))
            if path == "/audits":
                tid = str(body.get("threadId") or "")
                if not tid:
                    raise ValueError("threadId is required")
                current = self.engine.latest_snapshot(tid)
                requested = str(body.get("targetDigest") or "")
                level = str(body.get("level") or "")
                if not requested or not level:
                    raise ValueError("targetDigest and level are required")
                run = self.engine.audit(tid, target_digest=requested, level=level,
                                        trigger=str(body.get("trigger", "manual")),
                                        threshold=float(body.get("threshold", 0.7)))
                return self._send(200, ok(run,
                                          summary=f"{run['risk_digest']['total_findings']} finding(s)",
                                          operation="audits.create", request_id=rid, started=started))
            if path == "/artifacts":
                result = self.engine.register_artifact(
                    project_key=str(body.get("projectKey") or ""),
                    workspace_root=str(body.get("workspaceRoot") or ""),
                    project_root=body.get("projectRoot"), payload=body,
                )
                return self._send(200, ok(result, operation="artifacts.register",
                                          request_id=rid, started=started))
            if path == "/artifacts/resolve":
                result = self.engine.resolve_artifacts(
                    project_key=str(body.get("projectKey") or ""),
                    workspace_root=str(body.get("workspaceRoot") or ""),
                    project_root=body.get("projectRoot"),
                )
                return self._send(200, ok(result, operation="artifacts.resolve",
                                          request_id=rid, started=started))
            if path == "/artifacts/events/ack":
                result = self.engine.acknowledge_artifact_events(
                    project_key=str(body.get("projectKey") or ""),
                    workspace_root=str(body.get("workspaceRoot") or ""),
                    project_root=body.get("projectRoot"),
                    event_ids=body.get("eventIds") if isinstance(body.get("eventIds"), list) else [],
                )
                return self._send(200, ok(result, operation="artifacts.events.ack",
                                          request_id=rid, started=started))
            artifact_match = re.fullmatch(r"/artifacts/([^/]+)/(resolve|confirm-rebind)", path)
            if artifact_match:
                artifact_id = unquote(artifact_match.group(1))
                if artifact_match.group(2) == "resolve":
                    result = self.engine.resolve_artifact(
                        artifact_id, project_key=str(body.get("projectKey") or ""),
                        workspace_root=str(body.get("workspaceRoot") or ""),
                        project_root=body.get("projectRoot"),
                        candidate_locators=body.get("candidateLocators") or [],
                    )
                else:
                    registry = self.engine._registry(
                        str(body.get("projectKey") or ""),
                        workspace_root=str(body.get("workspaceRoot") or ""),
                        project_root=body.get("projectRoot"),
                    )
                    result = registry.confirm_rebind(artifact_id, str(body.get("locator") or ""))
                return self._send(200, ok(result, operation=f"artifacts.{artifact_match.group(2)}",
                                          request_id=rid, started=started))
            if not tid:
                return self._send(404, err("NOT_FOUND", f"no route for {self.path}", operation="post",
                                           request_id=rid, started=started))
            if action == "reconcile":
                # what-if 扰动:body {remove_nodes:[],remove_edges:[],add_contradicts:[],threshold}
                res = self.engine.reconcile(
                    tid,
                    remove_nodes=body.get("remove_nodes", []) or [],
                    remove_edges=body.get("remove_edges", []) or [],
                    add_contradicts=body.get("add_contradicts", []) or [],
                    threshold=float(body.get("threshold", 0.7)))
                s = res["summary"]
                return self._send(200, ok(res,
                                          summary=f"{s['n_invalidated']} invalidated / {s['blast_radius']} affected"
                                                  f" (subgraph {s['affected_subgraph_size']})",
                                          operation="reconcile", request_id=rid, started=started))
        except RequestBodyTooLarge as exc:
            return self._send(413, err("PAYLOAD_TOO_LARGE", str(exc), operation=action or "post", request_id=rid, started=started))
        except ValueError as exc:
            return self._send(400, err("INVALID_ARGUMENT", str(exc), operation=action or "post", request_id=rid, started=started))
        except KeyError as exc:
            return self._send(404, err("NOT_FOUND", f"not found: {exc}", operation=action or "post", request_id=rid, started=started))
        except RuntimeError as exc:
            return self._send(503, err("UNAVAILABLE", str(exc), retryable=True, operation=action or "post", request_id=rid, started=started))
        except Exception as exc:  # noqa: BLE001
            return self._send(500, err("INTERNAL_ERROR", str(exc), operation=action or "post", request_id=rid, started=started))
        return self._send(404, err("NOT_FOUND", f"no route for {self.path}", operation="post", request_id=rid, started=started))


def build_engine() -> Engine:
    storage = os.environ.get("EDAG_STORAGE_DIR")
    llm = None
    if os.environ.get("EDAG_MODEL_ROUTER_BASE_URL"):
        llm = ModelRouterLLM()
    return Engine(llm, storage_dir=storage)


def serve(host: str = "127.0.0.1", port: int = 3897, engine: Optional[Engine] = None) -> None:
    Handler.engine = engine or build_engine()
    Handler.api_token = os.environ.get(API_TOKEN_ENV, "").strip()
    Handler.max_json_body_bytes = Handler._normalize_max_body_bytes(
        os.environ.get(MAX_JSON_BODY_BYTES_ENV, DEFAULT_MAX_JSON_BODY_BYTES)
    )
    httpd = ThreadingHTTPServer((host, port), Handler)
    auth = "on" if Handler.api_token else "missing"
    print(f"[{SERVICE_ID}] listening on http://{host}:{port}  "
          f"(llm={'on' if Handler.engine.llm else 'off'}, auth={auth})")
    httpd.serve_forever()


def main() -> None:
    serve(host=os.environ.get("EDAG_HOST", "127.0.0.1"),
          port=int(os.environ.get("EDAG_PORT", "3897")))


if __name__ == "__main__":
    main()
