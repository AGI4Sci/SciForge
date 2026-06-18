"""HTTP service exposing the engine, ServiceResult-shaped per Servic_Module_Template.md.

The module returns structured evidence (graph, provenance, metrics) only —
never a user-level final answer or completion truth.

Endpoints:
  GET  /health
  GET  /version
  POST /threads/{id}/ingest-trace        body {"trace":[...]}        -> graph summary
  GET  /threads/{id}/graph                                           -> full graph
  POST /threads/{id}/verify              body {"threshold":0.7}      -> status diff
  POST /threads/{id}/reconcile           body {"remove_nodes":[...]} -> what-if 扰动 diff
  GET  /threads/{id}/provenance?node=ID                              -> provenance sub-DAG
  GET  /threads/{id}/metrics                                         -> 4 AAR metrics
  GET  /threads/{id}/analysis?threshold=0.7                          -> load-bearing / fragility / pseudo-robust
  GET  /threads/{id}/prov-json                                       -> PROV-JSON export
  POST /threads/{id}/prov-json           body {"doc":{...}}          -> import/reload
"""
from __future__ import annotations

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from . import __version__
from .llm import OpenAICompatLLM
from .service import Engine

SERVICE_ID = "evidence-dag-engine"
_UI_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ui", "index.html")


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

    def log_message(self, *args):  # silence default stderr spam
        pass

    # --- helpers ------------------------------------------------------------
    def _cors(self) -> None:
        # Localhost dev tool: permissive CORS so the bundled UI (or any local
        # page) can call the API even from a different origin.
        self.send_header("Access-Control-Allow-Origin", "*")
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

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8"))
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
            return parts[1], parts[2]
        return None, None

    # --- routing ------------------------------------------------------------
    def do_GET(self):  # noqa: N802
        rid, started = uuid.uuid4().hex, _now()
        parsed = urlparse(self.path)
        path, qs = parsed.path, parse_qs(parsed.query)
        if path == "/health":
            return self._send(200, ok({"status": "ok"}, operation="health", request_id=rid, started=started))
        if path == "/version":
            return self._send(200, ok({"version": __version__, "service": SERVICE_ID},
                                      operation="version", request_id=rid, started=started))
        if path in ("/", "/ui", "/ui/"):
            html = _load_ui()
            if html is None:
                return self._send(404, err("NOT_FOUND", "UI not bundled", operation="ui", request_id=rid, started=started))
            return self._send_html(200, html)
        if path == "/threads":
            return self._send(200, ok({"threads": self.engine.list_threads()},
                                      operation="threads", request_id=rid, started=started))
        tid, action = self._thread_route(path)
        if not tid:
            return self._send(404, err("NOT_FOUND", f"no route for {path}", operation="get", request_id=rid, started=started))
        try:
            if action == "graph":
                g = self.engine.require(tid)
                return self._send(200, ok({"summary": g.summary(), "graph": g.to_dict()},
                                          summary=f"{len(g.nodes)} nodes / {len(g.edges)} edges",
                                          operation="graph", request_id=rid, started=started))
            if action == "metrics":
                return self._send(200, ok(self.engine.metrics(tid), operation="metrics", request_id=rid, started=started))
            if action == "analysis":
                thr = float((qs.get("threshold") or ["0.7"])[0])
                return self._send(200, ok(self.engine.analysis(tid, threshold=thr), operation="analysis", request_id=rid, started=started))
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
        tid, action = self._thread_route(urlparse(self.path).path)
        if not tid:
            return self._send(404, err("NOT_FOUND", f"no route for {self.path}", operation="post", request_id=rid, started=started))
        try:
            body = self._body()
            if action == "ingest-trace":
                trace = body.get("trace")
                if not isinstance(trace, list):
                    return self._send(400, err("INVALID_ARGUMENT", "body.trace must be a list", operation="ingest-trace", request_id=rid, started=started))
                # merge=true => accumulate this (delta) trace into the thread's
                # existing graph so the DAG grows across a conversation; default
                # false replaces the graph (whole-conversation re-extract).
                merge = bool(body.get("merge", False))
                g = self.engine.ingest_trace(tid, trace, merge=merge)
                delta = self.engine.last_delta(tid)
                # Auto-verify after ingest (default on) so ν/status are ready
                # immediately — the UI/poller sees a scored graph. In merge mode we
                # only score the edges this turn added (incremental); a full ingest
                # scores everything.
                auto_verify = body.get("verify", os.environ.get("EDAG_AUTO_VERIFY", "1") != "0")
                verified = None
                if auto_verify and self.engine.llm is not None:
                    try:
                        verified = self.engine.verify(tid, threshold=float(body.get("threshold", 0.7)),
                                                       only_unscored=merge)
                    except Exception:  # noqa: BLE001 — verify is best-effort; ingest already succeeded
                        verified = None
                added = f"+{len(delta['new_nodes'])} nodes / +{len(delta['new_edges'])} edges" if merge else \
                        f"{len(g.nodes)} nodes / {len(g.edges)} edges"
                return self._send(200, ok({"summary": g.summary(), "verified": verified is not None,
                                           "merged": merge, "delta": delta},
                                          summary=(f"merged {added} (now {len(g.nodes)} nodes / {len(g.edges)} edges)" if merge
                                                   else f"extracted {added}")
                                          + (f"; verified ({len(verified['status_changes'])} status changes)" if verified else ""),
                                          operation="ingest-trace", request_id=rid, started=started))
            if action == "verify":
                threshold = float(body.get("threshold", 0.7))
                return self._send(200, ok(self.engine.verify(tid, threshold=threshold),
                                          operation="verify", request_id=rid, started=started))
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
            if action == "prov-json":
                doc = body.get("doc")
                if not isinstance(doc, dict):
                    return self._send(400, err("INVALID_ARGUMENT", "body.doc must be a PROV-JSON object", operation="prov-json.import", request_id=rid, started=started))
                g = self.engine.import_prov_json(doc)
                return self._send(200, ok({"summary": g.summary()}, operation="prov-json.import", request_id=rid, started=started))
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
    if os.environ.get("EDAG_LLM_BASE_URL"):
        llm = OpenAICompatLLM()
    return Engine(llm, storage_dir=storage)


def serve(host: str = "127.0.0.1", port: int = 3897, engine: Optional[Engine] = None) -> None:
    Handler.engine = engine or build_engine()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"[{SERVICE_ID}] listening on http://{host}:{port}  (llm={'on' if Handler.engine.llm else 'off'})")
    httpd.serve_forever()


if __name__ == "__main__":
    serve(host=os.environ.get("EDAG_HOST", "127.0.0.1"),
          port=int(os.environ.get("EDAG_PORT", "3897")))
