"""Authenticated HTTP service for the canonical Project DAG workflow."""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from project_dag import __version__
from project_dag.service import Engine

SERVICE_ID = "project-dag-engine"
API_TOKEN_ENV = "SCIFORGE_PROJECT_DAG_API_KEY"
_UI_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "index.html")
MAX_BODY = int(os.environ.get("SCIFORGE_PROJECT_DAG_MAX_BODY_BYTES", 1_048_576))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ok(data: Any, op: str, rid: str, started: str) -> dict:
    return {"ok": True, "data": data, "provenance": {
        "serviceId": SERVICE_ID, "operation": op, "requestId": rid,
        "startedAt": started, "completedAt": _now(),
    }}


def err(code: str, message: str, op: str, rid: str, started: str,
        *, retryable: bool = False) -> dict:
    return {"ok": False, "error": {
        "code": code, "message": message, "retryable": retryable,
    }, "provenance": {
        "serviceId": SERVICE_ID, "operation": op, "requestId": rid,
        "startedAt": started, "completedAt": _now(),
    }}


class Handler(BaseHTTPRequestHandler):
    engine: Engine = None  # type: ignore[assignment]
    api_token: str = ""

    def log_message(self, *args):
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        if not self.api_token:
            return False
        header = self.headers.get("Authorization", "")
        return header.startswith("Bearer ") and hmac.compare_digest(
            header[len("Bearer "):], self.api_token)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        body = json.loads((self.rfile.read(length) if length else b"{}").decode("utf-8"))
        if not isinstance(body, dict):
            raise ValueError("request body must be an object")
        return body

    def _route(self, method: str) -> None:
        rid, started = uuid.uuid4().hex[:8], _now()
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.split("/") if part]
        query = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        op = f"{method} {parsed.path}"
        if parsed.path == "/health":
            return self._send(200, {"ok": True, "service": SERVICE_ID})
        if parsed.path == "/" and method == "GET":
            try:
                with open(_UI_PATH, encoding="utf-8") as handle:
                    html = handle.read().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
            except OSError:
                self._send(404, err("NOT_FOUND", "no bundled UI", op, rid, started))
            return
        if not self._authed():
            code = "UNAVAILABLE" if not self.api_token else "UNAUTHORIZED"
            return self._send(503 if not self.api_token else 401,
                              err(code, "missing/invalid bearer token", op, rid, started))
        if parsed.path == "/version":
            return self._send(200, ok({"version": __version__, "service": SERVICE_ID},
                                      op, rid, started))
        try:
            data = self._dispatch(method, parts, query)
        except KeyError as exc:
            return self._send(404, err("NOT_FOUND", str(exc), op, rid, started))
        except PermissionError as exc:
            return self._send(403, err("RUNTIME_PERMISSION_REQUIRED", str(exc), op, rid, started))
        except ValueError as exc:
            return self._send(400, err("BAD_REQUEST", str(exc), op, rid, started))
        except RuntimeError as exc:
            return self._send(503, err("UNAVAILABLE", str(exc), op, rid, started,
                                       retryable=True))
        except Exception as exc:  # noqa: BLE001
            return self._send(500, err("INTERNAL", str(exc), op, rid, started))
        if data is None:
            return self._send(404, err("NOT_FOUND", parsed.path, op, rid, started))
        self._send(200, ok(data, op, rid, started))

    def _project_key(self, query: dict, body: dict | None = None) -> str:
        value = (body or {}).get("projectKey") or query.get("projectKey")
        if isinstance(value, str) and value.strip():
            value = value.strip()
            if os.path.isabs(os.path.expanduser(value)):
                return self.engine.project_key(workspace_root=value)
            return value
        return self.engine.project_key(
            (body or {}).get("workspaceRoot") or query.get("workspaceRoot"),
            (body or {}).get("projectRoot") or query.get("projectRoot"),
            (body or {}).get("project") or query.get("project"),
        )

    def _dispatch(self, method: str, parts: list[str], query: dict) -> Any:
        engine = self.engine
        if method == "POST" and parts == ["updates"]:
            body = self._body()
            body["projectKey"] = self._project_key(query, body)
            return engine.enqueue_update(body)
        if method == "GET" and parts == ["updates", "status"]:
            return engine.update_status(self._project_key(query))
        if method == "GET" and parts == ["updates", "history"]:
            return engine.update_history(self._project_key(query), int(query.get("limit", 20)))
        if method == "POST" and len(parts) == 3 and parts[0] == "updates" \
                and parts[2] == "retry":
            body = self._body()
            return engine.retry_update(parts[1], actor=body.get("actorId", "human"))
        if method == "GET" and parts == ["snapshots", "latest"]:
            return engine.workflow.latest_snapshot(self._project_key(query))
        if method == "GET" and len(parts) == 2 and parts[0] == "snapshots":
            return engine.workflow.snapshot(parts[1])
        if method == "GET" and parts == ["goals"]:
            return engine.goal_tree(self._project_key(query))
        if method == "POST" and parts == ["goals"]:
            body = self._body()
            return engine.create_goal(
                self._project_key(query, body), body["title"], body.get("description", ""),
                body.get("parentRoot"), body.get("actorType", "human"),
                body.get("actorId", "user"),
            )
        if method == "POST" and len(parts) == 3 and parts[0] == "goals" \
                and parts[2] == "update":
            body = self._body()
            project_key = self._project_key(query, body)
            actor_type = body.pop("actorType")
            actor_id = body.pop("actorId")
            reframe = bool(body.pop("reframe", False))
            body.pop("projectKey", None)
            return engine.update_goal(project_key, parts[1], actor_type=actor_type,
                                      actor_id=actor_id, reframe=reframe, **body)
        if method == "GET" and parts == ["claims"]:
            return engine.claims(self._project_key(query), query.get("goal"))
        if method == "GET" and len(parts) == 2 and parts[0] == "claims":
            return engine.claim_detail(self._project_key(query), parts[1], query.get("snapshot"))
        if method == "GET" and parts == ["graph"]:
            return engine.graph(self._project_key(query))
        if method == "GET" and parts == ["analysis"]:
            return engine.analysis(self._project_key(query), query.get("goal"),
                                   float(query.get("threshold", 0.7)))
        if method == "GET" and len(parts) == 2 and parts[0] == "provenance":
            return engine.resolve_provenance(
                self._project_key(query), parts[1], query["snapshotDigest"])
        if method == "GET" and parts == ["findings"]:
            return engine.workflow.findings(self._project_key(query), query.get("status"))
        if method == "GET" and parts == ["reviews"]:
            return engine.workflow.reviews(self._project_key(query), query.get("status", "open"))
        if method == "POST" and len(parts) == 3 and parts[0] == "reviews" \
                and parts[2] == "decision":
            body = self._body()
            return engine.record_review_result(
                self._project_key(query, body), parts[1], body)
        if method == "GET" and parts == ["attention"]:
            return engine.workflow.attention(self._project_key(query), query.get("snapshotDigest"))
        if method == "GET" and parts == ["assessments"]:
            return engine.workflow.assessments(
                self._project_key(query), query.get("snapshotDigest"))
        if method == "GET" and parts == ["audits"]:
            return engine.workflow.audits(
                self._project_key(query), int(query.get("limit", 20)))
        if method == "GET" and len(parts) == 2 and parts[0] == "audits":
            return engine.workflow.audit(parts[1])
        if method == "POST" and parts == ["audits"]:
            body = self._body()
            body["projectKey"] = self._project_key(query, body)
            return engine.enqueue_audit(body)
        if method == "POST" and len(parts) == 3 and parts[0] == "audits" \
                and parts[2] == "retry":
            body = self._body()
            return engine.retry_audit(parts[1], actor=body.get("actorId", "human"))
        if method == "POST" and parts == ["decisions"]:
            return engine.record_decision(self._body())
        if method == "POST" and parts == ["policy"]:
            body = self._body()
            return engine.configure_policy(self._project_key(query, body), body)
        if method == "POST" and parts == ["releases"]:
            body = self._body()
            return engine.workflow.create_release(
                project_key=self._project_key(query, body),
                project_snapshot_digest=body["projectSnapshotDigest"],
                audit_digest=body["auditDigest"], created_by=body["createdBy"],
                output_artifacts=body.get("outputArtifacts") or [],
                requested_status=body.get("requestedStatus", "candidate"),
                runtime_authorization=body.get("runtimeAuthorization"),
                external_action=bool(body.get("externalAction", False)),
            )
        return None

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")


def _update_worker(engine: Engine, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            worked = engine.process_updates()
        except Exception:  # noqa: BLE001 - durable job retains error and is retryable
            worked = None
        stop.wait(0.2 if worked is not None else 1.0)


def _audit_worker(engine: Engine, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            worked = engine.process_audits()
        except Exception:  # noqa: BLE001 - P3 job retains error/backoff metadata
            worked = None
        stop.wait(0.5 if worked is not None else 2.0)


def main() -> None:
    session_dir = os.environ.get("PDAG_SESSION_DIR") \
        or os.environ.get("EDAG_STORAGE_DIR") or "./threads"
    db_path = os.environ.get("PDAG_DB_PATH", "./project.db")
    host = os.environ.get("PDAG_HOST", "127.0.0.1")
    port = int(os.environ.get("PDAG_PORT", "3898"))
    llm = None
    if os.environ.get("EDAG_MODEL_ROUTER_BASE_URL"):
        from evidence_dag.llm import ModelRouterLLM
        llm = ModelRouterLLM()
    engine = Engine(db_path, session_dir, llm=llm)
    audit_engine = Engine(db_path, session_dir, llm=llm)
    Handler.engine = engine
    Handler.api_token = os.environ.get(API_TOKEN_ENV, "")
    stop = threading.Event()
    update_thread = threading.Thread(
        target=_update_worker, args=(engine, stop), daemon=True)
    audit_thread = threading.Thread(
        target=_audit_worker, args=(audit_engine, stop), daemon=True)
    update_thread.start()
    audit_thread.start()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[project-dag] listening on http://{host}:{port} "
          f"(sessions: {session_dir}, db: {db_path}, "
          f"llm: {'router' if llm else 'OFFLINE'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        update_thread.join(timeout=5)
        audit_thread.join(timeout=5)
        if not update_thread.is_alive():
            engine.store.close()
        if not audit_thread.is_alive():
            audit_engine.store.close()


if __name__ == "__main__":
    main()
