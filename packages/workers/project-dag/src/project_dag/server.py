"""HTTP service for the project DAG, ServiceResult-shaped like the
evidence-dag sidecar (same auth model: required bearer token, else the JSON
APIs answer UNAVAILABLE rather than running open on localhost).

Endpoints:
  GET  /health | /version | /               (bundled UI)
  POST /compile                {"scope":"all"|["sid",...],"workspaceRoot?","projectRoot?","project?"}
  POST /full-check                          full relabel safety net, manual trigger
  GET  /compile-runs           ?limit=20
  GET  /compile-runs/{id}
  GET  /goals                  ?workspaceRoot=&projectRoot=&project=&session=
  POST /goals                  {"title","description?","parent_root?","workspaceRoot?","projectRoot?","project?","sessions?"}
  POST /goals/{root}/update    {"title?","description?","status?"}
  GET  /claims                 ?goal=&workspaceRoot=&projectRoot=&project=&session=
  GET  /claims/{id}
  GET  /analysis               ?goal=&threshold=0.7&workspaceRoot=&projectRoot=&project=
  GET  /graph                  ?workspaceRoot=&projectRoot=&project=
  GET  /review                 ?status=pending
  POST /review/{id}/resolve    {"decision","note?","extra?"}
"""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import project_dag  # noqa: F401
from project_dag import __version__
from project_dag.service import Engine

SERVICE_ID = "project-dag-engine"
API_TOKEN_ENV = "SCIFORGE_PROJECT_DAG_API_KEY"
_UI_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "index.html")
MAX_BODY = int(os.environ.get("SCIFORGE_PROJECT_DAG_MAX_BODY_BYTES", 1_048_576))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _session_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        values = value.split(",")
    elif isinstance(value, list):
        values = []
        for item in value:
            values.extend(item.split(",") if isinstance(item, str) else [item])
    else:
        values = [value]
    return [v.strip() for v in values if isinstance(v, str) and v.strip()]


def _query_sessions(raw_query: dict[str, list[str]]) -> list[str]:
    return _session_list(raw_query.get("session", []) + raw_query.get("sessions", []))


def ok(data: Any, op: str, rid: str, started: str) -> dict:
    return {"ok": True, "data": data,
            "provenance": {"serviceId": SERVICE_ID, "operation": op,
                           "requestId": rid, "startedAt": started,
                           "completedAt": _now()}}


def err(code: str, message: str, op: str, rid: str, started: str) -> dict:
    return {"ok": False,
            "error": {"code": code, "message": message, "retryable": False},
            "provenance": {"serviceId": SERVICE_ID, "operation": op,
                           "requestId": rid, "startedAt": started,
                           "completedAt": _now()}}


class Handler(BaseHTTPRequestHandler):
    engine: Engine = None  # type: ignore[assignment]
    api_token: str = ""

    def log_message(self, *args):
        pass

    # ------------------------------------------------------------- plumbing
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
        h = self.headers.get("Authorization", "")
        return h.startswith("Bearer ") and hmac.compare_digest(
            h[len("Bearer "):], self.api_token)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def _route(self, method: str) -> None:
        rid, started = uuid.uuid4().hex[:8], _now()
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        raw_q = parse_qs(u.query)
        q = {k: v[0] for k, v in raw_q.items()}
        q["_sessions"] = _query_sessions(raw_q)
        op = f"{method} {u.path}"

        if u.path == "/health":
            return self._send(200, {"ok": True, "service": SERVICE_ID})
        if u.path == "/" and method == "GET":
            try:
                with open(_UI_PATH, encoding="utf-8") as fh:
                    html = fh.read().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
            except OSError:
                self._send(404, err("NOT_FOUND", "no bundled UI", op, rid, started))
            return

        if not self._authed():
            return self._send(503 if not self.api_token else 401,
                              err("UNAVAILABLE" if not self.api_token else "UNAUTHORIZED",
                                  "missing/invalid bearer token", op, rid, started))
        if u.path == "/version":
            return self._send(200, ok({"version": __version__, "service": SERVICE_ID},
                                      op, rid, started))
        try:
            data = self._dispatch(method, parts, q)
        except KeyError as exc:
            return self._send(404, err("NOT_FOUND", str(exc), op, rid, started))
        except ValueError as exc:
            return self._send(400, err("BAD_REQUEST", str(exc), op, rid, started))
        except Exception as exc:  # noqa: BLE001
            return self._send(500, err("INTERNAL", str(exc), op, rid, started))
        if data is None:
            return self._send(404, err("NOT_FOUND", u.path, op, rid, started))
        self._send(200, ok(data, op, rid, started))

    # ------------------------------------------------------------- dispatch
    def _dispatch(self, method: str, parts: list[str], q: dict) -> Any:
        e = self.engine
        if method == "POST" and parts == ["compile"]:
            b = self._body()
            return e.compile("manual", b.get("scope", "all"),
                             workspace_root=b.get("workspaceRoot") or b.get("workspace_root"),
                             project_root=b.get("projectRoot") or b.get("project_root"),
                             project=b.get("project"),
                             sessions=_session_list(
                                 b.get("sessions") or b.get("sessionIds") or b.get("session")))
        if method == "POST" and parts == ["full-check"]:
            return e.full_check()
        if method == "GET" and parts == ["compile-runs"]:
            return e.compile_runs(int(q.get("limit", 20)))
        if method == "GET" and len(parts) == 2 and parts[0] == "compile-runs":
            return e.compile_run(parts[1])
        if method == "GET" and parts == ["goals"]:
            return e.goal_tree(workspace_root=q.get("workspaceRoot") or q.get("workspace_root"),
                               project_root=q.get("projectRoot") or q.get("project_root"),
                               project=q.get("project"),
                               sessions=q.get("_sessions"))
        if method == "POST" and parts == ["goals"]:
            b = self._body()
            return e.create_goal(b["title"], b.get("description", ""),
                                 b.get("parent_root"),
                                 workspace_root=b.get("workspaceRoot") or b.get("workspace_root"),
                                 project_root=b.get("projectRoot") or b.get("project_root"),
                                 project=b.get("project"),
                                 sessions=_session_list(
                                     b.get("sessions") or b.get("sessionIds") or b.get("session")))
        if method == "POST" and len(parts) == 3 and parts[0] == "goals" \
                and parts[2] == "update":
            return e.update_goal(parts[1], **self._body())
        if method == "GET" and parts == ["claims"]:
            return e.claims(goal_id=q.get("goal"),
                            workspace_root=q.get("workspaceRoot") or q.get("workspace_root"),
                            project_root=q.get("projectRoot") or q.get("project_root"),
                            project=q.get("project"),
                            sessions=q.get("_sessions"))
        if method == "GET" and len(parts) == 2 and parts[0] == "claims":
            return e.claim_detail(parts[1])
        if method == "GET" and parts == ["analysis"]:
            return e.analysis(q.get("goal"), float(q.get("threshold", 0.7)),
                              workspace_root=q.get("workspaceRoot") or q.get("workspace_root"),
                              project_root=q.get("projectRoot") or q.get("project_root"),
                              project=q.get("project"),
                              sessions=q.get("_sessions"))
        if method == "GET" and parts == ["graph"]:
            return e.graph(workspace_root=q.get("workspaceRoot") or q.get("workspace_root"),
                           project_root=q.get("projectRoot") or q.get("project_root"),
                           project=q.get("project"),
                           sessions=q.get("_sessions"))
        if method == "GET" and parts == ["review"]:
            return e.review_items(q.get("status", "pending"))
        if method == "POST" and len(parts) == 3 and parts[0] == "review" \
                and parts[2] == "resolve":
            b = self._body()
            return e.resolve_review(parts[1], b["decision"], b.get("note", ""),
                                    b.get("extra"))
        return None

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")


def _scheduler(engine: Engine, stop: threading.Event) -> None:
    """Daily 00:00 compile with catch-up: on start (machine was off at
    midnight) run once if there was no scheduled run today, then poll."""
    def ran_today() -> bool:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        row = engine.store.q1(
            "SELECT 1 FROM compile_run WHERE trigger='scheduled'"
            " AND started_at LIKE ? || '%'", (today,))
        return row is not None

    while not stop.is_set():
        try:
            if not ran_today():
                engine.compile("scheduled", "all")
        except Exception:  # noqa: BLE001 — scheduler must never die
            pass
        stop.wait(600)


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

    Handler.engine = engine
    Handler.api_token = os.environ.get(API_TOKEN_ENV, "")

    stop = threading.Event()
    if os.environ.get("PDAG_SCHEDULE", "1") not in ("0", "false", "off"):
        threading.Thread(target=_scheduler, args=(engine, stop),
                         daemon=True).start()

    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"[project-dag] listening on http://{host}:{port} "
          f"(sessions: {session_dir}, db: {db_path}, "
          f"llm: {'router' if llm else 'OFFLINE'})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        srv.server_close()


if __name__ == "__main__":
    main()
