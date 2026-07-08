"""Engine facade: everything the HTTP layer (and tests) call.

Owns the Store / SessionReader / Judge / Compiler wiring plus the flows that
are not the compile pipeline itself: review resolution compensation, human
action registration, the weekly report, and the time-machine snapshot.
"""
from __future__ import annotations

import json
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
    def compile(self, trigger: str = "manual", scope: Any = "all") -> dict:
        return self.compiler.compile(trigger, scope)

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
        """The weekly safety net: full relabel; report what it changed (a
        non-empty result means the incremental algorithm drifted)."""
        changed = full_reconcile(self.store)
        return {"changed": changed, "clean": not changed}

    # ---------------------------------------------------------------- goals
    def goal_tree(self) -> list[dict]:
        goals = self.store.active_goals()
        stats: dict[str, dict] = {}
        for g in goals:
            rows = self.store.q(
                "SELECT status, COUNT(*) n FROM claim WHERE goal_id=?"
                " AND t_invalid IS NULL GROUP BY status", (g["root_id"],))
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
                    parent_root: Optional[str] = None) -> dict:
        return self.store.create_goal(title, description=description,
                                      parent_root=parent_root)

    def update_goal(self, root_id: str, **changes: Any) -> dict:
        return self.store.update_goal(root_id, **changes)

    # --------------------------------------------------------------- claims
    def claims(self, *, goal_id: Optional[str] = None,
               as_of: Optional[str] = None) -> list[dict]:
        sql = "SELECT * FROM claim WHERE 1=1"
        args: list[Any] = []
        if goal_id:
            sql += " AND goal_id=?"; args.append(goal_id)
        if as_of:                                    # time machine
            sql += " AND t_valid<=? AND (t_invalid IS NULL OR t_invalid>?)"
            args += [as_of, as_of]
        else:
            sql += " AND t_invalid IS NULL"
        return self.store.q(sql + " ORDER BY t_created DESC", args)

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

    def analysis(self, goal_id: Optional[str] = None, threshold: float = 0.7) -> dict:
        return project_analysis(self.store, goal_id=goal_id, threshold=threshold)

    def graph(self) -> dict:
        """One-call payload for the 图谱 view: every ALIVE goal, claim, the
        evidence actually wired to those claims, and the alive edges between
        them. Dangling edges (an endpoint invalidated) are filtered out so the
        renderer never draws into a void."""
        goals = self.store.active_goals()
        claims = self.store.q("SELECT id,statement,claim_type,status,goal_id,"
                              "load_bearing,blast_radius FROM claim WHERE t_invalid IS NULL")
        # session/topic grouping + entity labels for the 图谱 group cards
        origins: dict[str, list[str]] = {}
        for r in self.store.q("SELECT claim_id, session_id FROM claim_origin"
                              " ORDER BY session_id"):
            origins.setdefault(r["claim_id"], []).append(r["session_id"])
        ent_names: dict[str, list[str]] = {}
        for r in self.store.q(
                """SELECT e.src AS claim_id, en.canonical_name AS name
                   FROM edge e JOIN entity en ON en.id = e.dst
                   WHERE e.edge_type='mentions' AND e.t_invalid IS NULL"""):
            ent_names.setdefault(r["claim_id"], []).append(r["name"])
        for c in claims:
            c["sessions"] = sorted(set(origins.get(c["id"], [])))
            c["entities"] = ent_names.get(c["id"], [])
        edges = self.store.q(
            "SELECT id,src,dst,edge_type,meta FROM edge WHERE t_invalid IS NULL"
            " AND edge_type IN ('addresses','supports','contradicts','derived_from')")
        claim_ids = {c["id"] for c in claims}
        goal_ids = {g["root_id"] for g in goals}
        ev_ids = {e["src"] for e in edges
                  if e["edge_type"] == "supports" and e["dst"] in claim_ids}
        evidence = [
            ev for ev in self.store.q(
                "SELECT id,evidence_type,content,source_hash,quality_score,"
                "trust_score,attestation_method FROM evidence WHERE t_invalid IS NULL")
            if ev["id"] in ev_ids
        ]
        keep = claim_ids | goal_ids | {ev["id"] for ev in evidence}
        edges = [e for e in edges if e["src"] in keep and e["dst"] in keep]
        return {"goals": goals, "claims": claims, "evidence": evidence, "edges": edges}

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
        elif item_type == "human_evidence":
            pass  # trust stays low until corroboration arrives; nothing to do
        return touched

    # --------------------------------------------------------- human actions
    def register_human_action(self, text: str, *, file_path: Optional[str] = None,
                              log_path: Optional[str] = None) -> dict:
        """One-line registration -> activity + human_attested evidence.
        Attestation auto-upgrades with whatever corroboration was attached."""
        import hashlib
        import os
        st = self.store
        out = self.judge("human_extract", {"text": text})
        act_id = new_id("act")
        t = now_iso()
        st.x("INSERT INTO activity (id,activity_type,description,started_at)"
             " VALUES (?,?,?,?)",
             (act_id, "human_action", out.get("description", text),
              out.get("happened_at") or t))
        method, trust, ref = "self_report", 0.3, None
        if file_path and os.path.exists(file_path):
            with open(file_path, "rb") as fh:
                h = hashlib.sha256(fh.read()).hexdigest()
            method, trust, ref = "artifact_hash", 0.8, f"{file_path}#sha256:{h}"
        elif log_path and os.path.exists(log_path):
            method, trust, ref = "log_corroborated", 0.6, log_path
        ev_id = new_id("ev")
        st.x("INSERT INTO evidence (id,evidence_type,content,content_ref,"
             "attestation_method,trust_score,t_valid) VALUES (?,?,?,?,?,?,?)",
             (ev_id, "human_attested", out.get("description", text), ref,
              method, trust, t))
        st.add_edge(ev_id, act_id, "generated_by")
        if method == "self_report":
            st.enqueue_review("human_evidence", {
                "evidence": ev_id, "activity": act_id, "text": text,
                "hint": "no corroboration; attach artifact or log to upgrade trust"})
        st.conn.commit()
        return {"activity": act_id, "evidence": ev_id,
                "attestation_method": method, "trust_score": trust}

    # ---------------------------------------------------------------- report
    def weekly_report(self, week_start: str, week_end: str) -> dict:
        """Structured weekly report aggregated from compile_run.diff. Every
        factual line carries its claim id (faithfulness hard constraint); no
        free-form LLM prose in v1."""
        st = self.store
        runs = st.q("SELECT * FROM compile_run WHERE started_at>=? AND started_at<?"
                    " AND status='done' ORDER BY started_at", (week_start, week_end))
        added, invalidated, conflicts = [], [], []
        for r in runs:
            d = json.loads(r["diff"]) if r["diff"] else {}
            added += [{**c, "run": r["id"]} for c in d.get("added_claims", [])]
            invalidated += [{**c, "run": r["id"]} for c in d.get("invalidated_claims", [])]
            conflicts += [{**c, "run": r["id"]} for c in d.get("conflicts", [])
                          if not c.get("resolved")]
        pending = self.review_items("pending")
        humans = st.q(
            """SELECT a.*, ev.attestation_method, ev.trust_score
               FROM activity a LEFT JOIN edge e
                 ON e.dst=a.id AND e.edge_type='generated_by' AND e.t_invalid IS NULL
               LEFT JOIN evidence ev ON ev.id=e.src
               WHERE a.activity_type='human_action'
                 AND a.started_at>=? AND a.started_at<?""", (week_start, week_end))
        by_goal: dict[str, list[dict]] = {}
        for c in added:
            by_goal.setdefault(c.get("goal") or "none", []).append(c)
        md = [f"# 周报 {week_start} ~ {week_end}", "", "## 进展"]
        for gid, items in by_goal.items():
            g = st.q1("SELECT title FROM goal WHERE root_id=? AND t_expired IS NULL", (gid,))
            md.append(f"### {g['title'] if g else gid}")
            md += [f"- {c['statement']} [{c['id']}]" for c in items]
        md += ["", "## 变故"]
        md += [f"- claim [{c['id']}] 失效（被 [{c.get('beaten_by')}] 裁决击败，规则：" +
               f"{(c.get('why') or {}).get('rule', '?')}）" for c in invalidated] or ["- 无"]
        md += ["", "## 未决",
               f"- 未决冲突 {len(conflicts)} 项，待复核 {len(pending)} 项"]
        md += ["", "## 人类操作记录"]
        md += [f"- {h['description']}（佐证：{h['attestation_method'] or 'self_report'}，"
               f"trust {h['trust_score'] if h['trust_score'] is not None else 0.3}）"
               for h in humans] or ["- 无"]
        return {"week_start": week_start, "week_end": week_end,
                "added": added, "invalidated": invalidated,
                "unresolved_conflicts": conflicts, "pending_review": len(pending),
                "human_actions": humans, "markdown": "\n".join(md)}

    # ----------------------------------------------------------- time machine
    def snapshot(self, as_of: str) -> dict:
        """Graph state at any historical date — one SQL filter, because nothing
        is ever deleted."""
        claims = self.claims(as_of=as_of)
        goals = self.store.q(
            "SELECT * FROM goal WHERE t_created<=? AND (t_expired IS NULL OR t_expired>?)",
            (as_of, as_of))
        edges = self.store.q(
            "SELECT * FROM edge WHERE t_valid<=? AND (t_invalid IS NULL OR t_invalid>?)",
            (as_of, as_of))
        return {"as_of": as_of, "goals": goals, "claims": claims, "edges": edges}
