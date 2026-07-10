"""Engine facade: everything the HTTP layer (and tests) call.

Owns the Store / SessionReader / Judge / Compiler wiring plus the flows that
are not the compile pipeline itself, primarily review resolution compensation
and project-scoped graph/query helpers.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from .compiler import Compiler
from .judge import Judge
from .reader import SessionReader
from .reconcile import full_reconcile, incremental_reconcile, project_analysis
from .store import Store, new_id, now_iso


class Engine:
    def __init__(self, db_path: str, session_dir: str, llm: Any = None,
                 judge: Any = None) -> None:
        self.store = Store(db_path)
        self._mark_interrupted_compile_runs()
        self.reader = SessionReader(session_dir)
        self.judge = judge if judge is not None else Judge(llm, self.store)
        self.compiler = Compiler(self.store, self.reader, self.judge)

    # ------------------------------------------------------------- compile
    def compile(self, trigger: str = "manual", scope: Any = "all",
                *, workspace_root: Optional[str] = None,
                project_root: Optional[str] = None,
                project: Optional[str] = None,
                sessions: Optional[list[str]] = None) -> dict:
        explicit_sessions = self._clean_session_ids(sessions)
        project_key = self._project_key(
            workspace_root,
            project_root,
            project,
            sessions=explicit_sessions,
        )
        if scope == "all" and explicit_sessions is not None:
            scope = explicit_sessions
        elif scope == "all" and self._scope_requested(workspace_root, project_root, project):
            scope = []
        return self.compiler.compile(
            trigger,
            scope,
            goal_project_key=project_key,
            scoped_goals=project_key is not None,
        )

    def _mark_interrupted_compile_runs(self) -> None:
        self.store.x("UPDATE compile_run SET status='interrupted', finished_at=?"
                     " WHERE status='running'", (now_iso(),))
        self.store.conn.commit()

    def compile_runs(self, limit: int = 20) -> list[dict]:
        rows = self.store.q(
            "SELECT id,trigger,scope,started_at,finished_at,status,stats"
            " FROM compile_run ORDER BY started_at DESC LIMIT ?", (limit,))
        for r in rows:
            r["stats"] = json.loads(r["stats"]) if r["stats"] else None
        return rows

    def compile_run(self, run_id: str) -> Optional[dict]:
        r = self.store.q1("SELECT * FROM compile_run WHERE id=?", (run_id,))
        if r:
            r["stats"] = json.loads(r["stats"]) if r["stats"] else None
            r["diff"] = json.loads(r["diff"]) if r["diff"] else None
        return r

    def full_check(self) -> dict:
        """Full relabel safety net: report what it changed (a
        non-empty result means the incremental algorithm drifted)."""
        changed = full_reconcile(self.store)
        return {"changed": changed, "clean": not changed}

    # ---------------------------------------------------------------- goals
    def goal_tree(self, *, workspace_root: Optional[str] = None,
                  project_root: Optional[str] = None,
                  project: Optional[str] = None,
                  sessions: Optional[list[str]] = None) -> list[dict]:
        scope = self._project_scope(workspace_root, project_root, project, sessions=sessions)
        scoped_claim_ids: Optional[set[str]] = None
        goals = self.store.active_goals(
            project_key=scope.get("projectKey") if scope else None,
            scoped=scope is not None,
        )
        if scope is not None:
            scoped_claim_ids, _ = self._scoped_claim_and_support_ids(scope["sessions"])
            if scoped_claim_ids:
                scoped_goal_ids = {
                    r["goal_id"] for r in self.store.q(
                        "SELECT id,goal_id FROM claim WHERE t_invalid IS NULL")
                    if r["id"] in scoped_claim_ids and r.get("goal_id")
                }
                scoped_goal_ids.update(g["root_id"] for g in goals)
                goals = self._goals_in_scope(self.store.active_goals(), scoped_goal_ids)
        stats: dict[str, dict] = {}
        for g in goals:
            rows = self.store.q(
                "SELECT status, COUNT(*) n FROM claim WHERE goal_id=?"
                " AND t_invalid IS NULL GROUP BY status", (g["root_id"],))
            if scoped_claim_ids is not None:
                rows = []
                scoped_claims = [
                    c for c in self.store.q(
                        "SELECT id,status FROM claim WHERE goal_id=? AND t_invalid IS NULL",
                        (g["root_id"],))
                    if c["id"] in scoped_claim_ids
                ]
                by_status: dict[str, int] = {}
                for claim in scoped_claims:
                    by_status[claim["status"]] = by_status.get(claim["status"], 0) + 1
                rows = [{"status": status, "n": n} for status, n in by_status.items()]
            stats[g["root_id"]] = {r["status"]: r["n"] for r in rows}
        by_parent: dict[Optional[str], list[dict]] = {}
        for g in goals:
            g = dict(g)
            g["claim_stats"] = stats.get(g["root_id"], {})
            by_parent.setdefault(g["parent_id"], []).append(g)

        def build(parent: Optional[str]) -> list[dict]:
            return [{**g, "children": build(g["root_id"])}
                    for g in by_parent.get(parent, [])]
        return build(None)

    def create_goal(self, title: str, description: str = "",
                    parent_root: Optional[str] = None,
                    workspace_root: Optional[str] = None,
                    project_root: Optional[str] = None,
                    project: Optional[str] = None,
                    sessions: Optional[list[str]] = None) -> dict:
        project_key = self._project_key(workspace_root, project_root, project, sessions=sessions)
        return self.store.create_goal(title, description=description,
                                      parent_root=parent_root,
                                      project_key=project_key)

    def update_goal(self, root_id: str, **changes: Any) -> dict:
        return self.store.update_goal(root_id, **changes)

    # --------------------------------------------------------------- claims
    def claims(self, *, goal_id: Optional[str] = None,
               workspace_root: Optional[str] = None,
               project_root: Optional[str] = None,
               project: Optional[str] = None,
               sessions: Optional[list[str]] = None) -> list[dict]:
        scope = self._project_scope(workspace_root, project_root, project, sessions=sessions)
        scoped_claim_ids: Optional[set[str]] = None
        if scope is not None:
            scoped_claim_ids, _ = self._scoped_claim_and_support_ids(scope["sessions"])
        sql = "SELECT * FROM claim WHERE 1=1"
        args: list[Any] = []
        if goal_id:
            sql += " AND goal_id=?"; args.append(goal_id)
        sql += " AND t_invalid IS NULL"
        claims = self.store.q(sql + " ORDER BY t_created DESC", args)
        if scoped_claim_ids is not None:
            claims = [claim for claim in claims if claim["id"] in scoped_claim_ids]
        return claims

    def claim_detail(self, claim_id: str) -> Optional[dict]:
        c = self.store.q1("SELECT * FROM claim WHERE id=?", (claim_id,))
        if c is None:
            return None
        sup = self.store.q(
            """SELECT ev.*, e.t_invalid AS edge_t_invalid, e.meta AS edge_meta
               FROM edge e JOIN evidence ev ON ev.id=e.src
               WHERE e.dst=? AND e.edge_type='supports'""", (claim_id,))
        for ev in sup:
            ev["edge_meta"] = json.loads(ev["edge_meta"]) if ev["edge_meta"] else None
        contras = [e for e in
                   self.store.q("SELECT * FROM edge WHERE edge_type='contradicts'"
                                " AND (src=? OR dst=?)", (claim_id, claim_id))]
        origins = self.store.q("SELECT * FROM claim_origin WHERE claim_id=?", (claim_id,))
        mentions = self.store.q(
            """SELECT en.* FROM edge e JOIN entity en ON en.id=e.dst
               WHERE e.src=? AND e.edge_type='mentions' AND e.t_invalid IS NULL""",
            (claim_id,))
        return {**c, "supports": sup, "contradicts": contras,
                "origins": origins, "entities": mentions}

    def analysis(self, goal_id: Optional[str] = None, threshold: float = 0.7,
                 *, workspace_root: Optional[str] = None,
                 project_root: Optional[str] = None,
                 project: Optional[str] = None,
                 sessions: Optional[list[str]] = None) -> dict:
        scope = self._project_scope(workspace_root, project_root, project, sessions=sessions)
        if scope is None:
            return project_analysis(self.store, goal_id=goal_id, threshold=threshold)
        claim_ids, support_edge_ids = self._scoped_claim_and_support_ids(scope["sessions"])
        analysis = project_analysis(
            self.store,
            goal_id=goal_id,
            claim_ids=claim_ids,
            support_edge_ids=support_edge_ids,
            threshold=threshold,
        )
        analysis["scope"] = scope
        return analysis

    def graph(self, *, workspace_root: Optional[str] = None,
              project_root: Optional[str] = None,
              project: Optional[str] = None,
              sessions: Optional[list[str]] = None) -> dict:
        """One-call payload for the 图谱 view: every ALIVE goal, claim, the
        evidence actually wired to those claims, and the alive edges between
        them. Dangling edges (an endpoint invalidated) are filtered out so the
        renderer never draws into a void."""
        scope = self._project_scope(workspace_root, project_root, project, sessions=sessions)
        scoped_claim_ids: Optional[set[str]] = None
        scoped_support_edge_ids: Optional[set[str]] = None
        scoped_session_ids: Optional[set[str]] = None
        if scope is not None:
            scoped_session_ids = set(scope["sessions"])
            scoped_claim_ids, scoped_support_edge_ids = self._scoped_claim_and_support_ids(
                scope["sessions"])

        goals = self.store.active_goals(
            project_key=scope.get("projectKey") if scope else None,
            scoped=scope is not None,
        )
        claims = self.store.q("SELECT id,statement,claim_type,status,goal_id,"
                              "load_bearing,blast_radius FROM claim WHERE t_invalid IS NULL")
        if scoped_claim_ids is not None:
            claims = [c for c in claims if c["id"] in scoped_claim_ids]
            goal_ids_in_scope = {c["goal_id"] for c in claims if c.get("goal_id")}
            goal_ids_in_scope.update(g["root_id"] for g in goals)
            goals = self._goals_in_scope(self.store.active_goals(), goal_ids_in_scope)
        # session/topic grouping + entity labels for the 图谱 group cards
        origins: dict[str, list[str]] = {}
        for r in self.store.q("SELECT claim_id, session_id FROM claim_origin"
                              " ORDER BY session_id"):
            if scoped_claim_ids is not None and r["claim_id"] not in scoped_claim_ids:
                continue
            if scoped_session_ids is not None and r["session_id"] not in scoped_session_ids:
                continue
            origins.setdefault(r["claim_id"], []).append(r["session_id"])
        ent_names: dict[str, list[str]] = {}
        for r in self.store.q(
                """SELECT e.src AS claim_id, en.canonical_name AS name
                   FROM edge e JOIN entity en ON en.id = e.dst
                   WHERE e.edge_type='mentions' AND e.t_invalid IS NULL"""):
            if scoped_claim_ids is not None and r["claim_id"] not in scoped_claim_ids:
                continue
            ent_names.setdefault(r["claim_id"], []).append(r["name"])
        for c in claims:
            c["sessions"] = sorted(set(origins.get(c["id"], [])))
            c["entities"] = ent_names.get(c["id"], [])
        edges = self.store.q(
            "SELECT id,src,dst,edge_type,meta FROM edge WHERE t_invalid IS NULL"
            " AND edge_type IN ('addresses','supports','contradicts','derived_from')")
        claim_ids = {c["id"] for c in claims}
        goal_ids = {g["root_id"] for g in goals}
        if scoped_support_edge_ids is not None:
            edges = [e for e in edges
                     if e["edge_type"] != "supports" or e["id"] in scoped_support_edge_ids]
        ev_ids = {e["src"] for e in edges
                  if e["edge_type"] == "supports" and e["dst"] in claim_ids}
        evidence = [
            ev for ev in self.store.q(
                "SELECT id,evidence_type,content,content_ref,source_hash,quality_score,"
                "trust_score,attestation_method FROM evidence WHERE t_invalid IS NULL")
            if ev["id"] in ev_ids
        ]
        keep = claim_ids | goal_ids | {ev["id"] for ev in evidence}
        edges = [e for e in edges if e["src"] in keep and e["dst"] in keep]
        out = {"goals": goals, "claims": claims, "evidence": evidence, "edges": edges}
        if scope is not None:
            out["scope"] = scope
        return out

    # --------------------------------------------------------- project scope
    def _scope_requested(self, workspace_root: Optional[str],
                         project_root: Optional[str],
                         project: Optional[str]) -> bool:
        return any(self._clean(v) for v in (workspace_root, project_root, project))

    def _project_scope(self, workspace_root: Optional[str],
                       project_root: Optional[str],
                       project: Optional[str],
                       *, sessions: Optional[list[str]] = None) -> Optional[dict]:
        explicit_sessions = self._clean_session_ids(sessions)
        if explicit_sessions is None and not self._scope_requested(workspace_root, project_root, project):
            return None
        if explicit_sessions is not None:
            scope_sessions = explicit_sessions
            strategy = "explicit-sessions"
        else:
            scope_sessions = []
            strategy = "explicit-sessions-required"
        limitation = (
            "Project filtering uses explicit session ids supplied by the desktop app. "
            "Workspace/project names are labels and goal-scope keys, not a fallback "
            "session-discovery mechanism."
        )
        return {
            "workspaceRoot": self._clean(workspace_root),
            "projectRoot": self._clean(project_root),
            "project": self._clean(project),
            "projectKey": self._project_key(workspace_root, project_root, project,
                                            sessions=scope_sessions),
            "sessions": scope_sessions,
            "matched": bool(scope_sessions),
            "strategy": strategy,
            "limitation": limitation,
        }

    def _project_key(self, workspace_root: Optional[str],
                     project_root: Optional[str],
                     project: Optional[str],
                     *, sessions: Optional[list[str]] = None) -> Optional[str]:
        project_path = self._normalize_path(project_root) or self._normalize_path(workspace_root)
        if project_path:
            return f"path:{project_path}"
        project_name = self._clean(project)
        if project_name:
            return f"project:{project_name}"
        return None

    def _scoped_claim_and_support_ids(self, session_ids: list[str]) -> tuple[set[str], set[str]]:
        if not session_ids:
            return set(), set()
        placeholders = ",".join("?" for _ in session_ids)
        claim_ids = {
            r["claim_id"] for r in self.store.q(
                f"SELECT DISTINCT claim_id FROM claim_origin WHERE session_id IN ({placeholders})",
                session_ids)
        }
        if not claim_ids:
            return set(), set()
        support_edge_ids: set[str] = set()
        for edge in self.store.q(
                "SELECT id,src,dst,edge_type,meta FROM edge WHERE t_invalid IS NULL"
                " AND edge_type='supports'"):
            if edge["dst"] not in claim_ids:
                continue
            if self._edge_has_session(edge, set(session_ids)):
                support_edge_ids.add(edge["id"])
        return claim_ids, support_edge_ids

    def _edge_has_session(self, edge: dict, session_ids: set[str]) -> bool:
        if not session_ids:
            return False
        try:
            meta = json.loads(edge["meta"]) if edge.get("meta") else {}
        except (TypeError, ValueError):
            meta = {}
        if isinstance(meta, dict):
            session = meta.get("session")
            if isinstance(session, str) and session in session_ids:
                return True
            origins = meta.get("origins")
            if isinstance(origins, list):
                for origin in origins:
                    if isinstance(origin, dict) and origin.get("session") in session_ids:
                        return True
        return False

    def _goals_in_scope(self, goals: list[dict], goal_ids: set[str]) -> list[dict]:
        if not goal_ids:
            return []
        by_id = {g["root_id"]: g for g in goals}
        keep = set(goal_ids)
        frontier = list(goal_ids)
        while frontier:
            gid = frontier.pop()
            parent = by_id.get(gid, {}).get("parent_id")
            if parent and parent not in keep:
                keep.add(parent)
                frontier.append(parent)
        return [g for g in goals if g["root_id"] in keep]

    def _normalize_path(self, value: Optional[str]) -> Optional[str]:
        text = self._clean(value)
        if not text:
            return None
        return os.path.normcase(os.path.normpath(os.path.expanduser(text))).replace("\\", "/")

    def _clean_session_ids(self, sessions: Optional[list[str]]) -> Optional[list[str]]:
        if sessions is None:
            return None
        return sorted({
            value.strip()
            for value in sessions
            if isinstance(value, str) and value.strip()
        })

    def _clean(self, value: Any) -> Optional[str]:
        return value.strip() if isinstance(value, str) and value.strip() else None

    # ---------------------------------------------------------------- review
    def review_items(self, status: str = "pending") -> list[dict]:
        rows = self.store.q("SELECT * FROM review_item WHERE status=?"
                            " ORDER BY created_at", (status,))
        for r in rows:
            r["payload"] = json.loads(r["payload"])
        return rows

    def resolve_review(self, review_id: str, decision: str,
                       note: str = "", extra: Optional[dict] = None) -> dict:
        """decision in accepted/rejected/deferred. Compensation actions run in
        the same transaction as the status flip (§3.9 of the plan)."""
        st = self.store
        item = st.q1("SELECT * FROM review_item WHERE id=?", (review_id,))
        if item is None:
            raise KeyError(review_id)
        if item["status"] != "pending":
            raise ValueError(f"review {review_id} already {item['status']}")
        payload = json.loads(item["payload"])
        touched: set[str] = set()
        st.x("BEGIN")
        try:
            if decision == "accepted":
                touched = self._compensate(item["item_type"], payload, extra or {})
            elif decision == "rejected" and item["item_type"] == "entity_merge":
                st.x("UPDATE entity SET provisional=0 WHERE id=?",
                     (payload["provisional"],))
            st.x("UPDATE review_item SET status=?, resolved_at=?, resolution=? WHERE id=?",
                 (decision, now_iso(),
                  json.dumps({"note": note, **(extra or {})}, ensure_ascii=False),
                  review_id))
            st.conn.commit()
        except Exception:
            st.conn.rollback()
            raise
        changed = incremental_reconcile(st, touched) if touched else []
        return {"id": review_id, "decision": decision, "relabelled": changed}

    def _compensate(self, item_type: str, payload: dict, extra: dict) -> set[str]:
        st = self.store
        touched: set[str] = set()
        if item_type == "entity_merge":
            prov, target = payload["provisional"], payload["candidate"]
            st.x("UPDATE entity SET merged_into=?, provisional=0 WHERE id=?",
                 (target, prov))
            trow = st.q1("SELECT * FROM entity WHERE id=?", (target,))
            merged = json.loads(trow["merged_from"]) + [prov]
            aliases = sorted(set(json.loads(trow["aliases"]) + [payload["name"]]))
            st.x("UPDATE entity SET merged_from=?, aliases=? WHERE id=?",
                 (json.dumps(merged), json.dumps(aliases, ensure_ascii=False), target))
            st.add_edge(prov, target, "same_as", meta={"via": "review"})
            for e in st.alive_edges(dst=prov, edge_type="mentions"):
                st.close_edge(e["id"])
                st.add_edge(e["src"], target, "mentions", meta={"remapped_from": prov})
                touched.add(e["src"])
        elif item_type == "claim_merge":
            new, target = payload["new"], payload["target"]
            for e in st.alive_edges(dst=new, edge_type="supports"):
                st.close_edge(e["id"])
                st.add_edge(e["src"], target, "supports",
                            meta={"merged_from_claim": new, "via": "review"})
            st.x("INSERT OR IGNORE INTO claim_origin (claim_id,session_id,node_id,run_id)"
                 " SELECT ?, session_id, node_id, run_id FROM claim_origin WHERE claim_id=?",
                 (target, new))
            st.x("UPDATE claim SET t_invalid=?, status='invalidated' WHERE id=?",
                 (now_iso(), new))
            st.add_edge(target, new, "derived_from",
                        meta={"via": "review_merge"})
            touched.update((new, target))
        elif item_type == "conflict":
            winner = extra.get("winner")
            a, b = payload["a"], payload["b"]
            if winner not in (a, b):
                raise ValueError("conflict resolution requires extra.winner = a or b")
            loser = b if winner == a else a
            st.x("UPDATE claim SET t_invalid=?, status='invalidated' WHERE id=?",
                 (now_iso(), loser))
            st.x("UPDATE claim SET status='supported' WHERE id=? AND t_invalid IS NULL",
                 (winner,))
            st.add_edge(winner, loser, "contradicts",
                        meta={"resolution": "human", "review": payload})
            touched.update((a, b))
        elif item_type == "orphan_claims":
            # extra: {"goal_id": ...} adopt orphans into a goal -> they re-enter
            # the pipeline next compile (their session nodes were never
            # watermarked as claims, but we stored candidates in payload).
            goal_id = extra.get("goal_id")
            if goal_id:
                for cand in payload.get("candidates", []):
                    cid = new_id("claim")
                    t = now_iso()
                    st.x("INSERT INTO claim (id,statement,claim_type,goal_id,"
                         "t_valid,t_created) VALUES (?,?,?,?,?,?)",
                         (cid, cand["statement"],
                          cand.get("claim_type") or "finding", goal_id, t, t))
                    st.add_edge(cid, goal_id, "addresses", meta={"via": "orphan_adopt"})
                    for evid in cand.get("evidence_ids", []):
                        st.add_edge(evid, cid, "supports",
                                    meta={"via": "orphan_adopt"})
                    st.x("INSERT OR IGNORE INTO claim_origin (claim_id,session_id,"
                         "node_id) VALUES (?,?,?)",
                         (cid, cand["session"], cand["node"]))
                    touched.add(cid)
        return touched
