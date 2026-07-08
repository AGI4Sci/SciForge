"""The incremental compile pipeline: session evidence-DAGs -> project DAG.

Phases (mirrors the construction plan, adapted to content-addressed ids):
  0  collect dirty sessions (file hash vs watermark)
  1  per-session delta (new eligible claim nodes + vanished node ids)
  2  distill claim candidates (LLM) + evidence registration/dedup
  3  entity resolution (text recall + vote gate)
  4  claim matching (equivalent / refines / new)
  5  conflict detection (LLM yes/no) + RULE-based adjudication
  6  incremental reconcile (relabel affected subgraph)
  7  orphan pool + run stats/diff

Each session commits as ONE SQLite transaction together with its watermark:
a crash mid-compile loses at most the in-flight session, never leaves a
half-promoted state.
"""
from __future__ import annotations

import difflib
import json
import re
import threading
from typing import Any, Optional

from .judge import Judge
from .reader import SessionReader, source_ancestors, source_quality, supporting_subgraph
from .reconcile import full_reconcile, incremental_reconcile
from .store import Store, new_id, now_iso

_LOCK = threading.Lock()

AUTO_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.60
POOL_K = 5


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _support_origin(session_id: str, node_id: str, run_id: Optional[str] = None) -> dict:
    out = {"session": session_id, "node": node_id}
    if run_id is not None:
        out["run"] = run_id
    return out


def _support_meta(run_id: str, session_id: str, node_id: str,
                  *, merged: bool = False) -> dict:
    meta: dict[str, Any] = {
        "run": run_id,
        "session": session_id,
        "claim_node": node_id,
        "origins": [_support_origin(session_id, node_id, run_id)],
    }
    if merged:
        meta["merged"] = True
    return meta


def _load_edge_meta(edge: dict) -> dict:
    if not edge.get("meta"):
        return {}
    try:
        meta = json.loads(edge["meta"])
    except (TypeError, ValueError):
        return {}
    return meta if isinstance(meta, dict) else {}


class Compiler:
    def __init__(self, store: Store, reader: SessionReader, judge: Judge,
                 *, auto_threshold: float = AUTO_THRESHOLD,
                 review_threshold: float = REVIEW_THRESHOLD) -> None:
        self.store = store
        self.reader = reader
        self.judge = judge
        self.auto_threshold = auto_threshold
        self.review_threshold = review_threshold

    # ------------------------------------------------------------------ entry
    def compile(self, trigger: str = "manual", scope: Any = "all") -> dict:
        if not _LOCK.acquire(blocking=False):
            return {"skipped": True, "reason": "compile already running"}
        try:
            return self._compile(trigger, scope)
        except Exception as exc:
            self._mark_running_failed(exc)
            raise
        finally:
            _LOCK.release()

    def _mark_running_failed(self, exc: Exception) -> None:
        stats = json.dumps({"errors": 1}, ensure_ascii=False)
        diff = json.dumps({"errors": [{"error": str(exc)}]}, ensure_ascii=False)
        try:
            self.store.conn.rollback()
            self.store.x(
                "UPDATE compile_run SET finished_at=?, status='failed',"
                " stats=COALESCE(stats, ?), diff=COALESCE(diff, ?)"
                " WHERE status='running'",
                (now_iso(), stats, diff),
            )
            self.store.conn.commit()
        except Exception:
            pass

    def _compile(self, trigger: str, scope: Any) -> dict:
        st = self.store
        run_id = new_id("run")
        st.x("INSERT INTO compile_run (id,trigger,scope,started_at) VALUES (?,?,?,?)",
             (run_id, trigger, json.dumps(scope), now_iso()))
        st.conn.commit()

        diff: dict[str, Any] = {
            "sessions": [], "added_claims": [], "merged_claims": [],
            "refined_claims": [], "invalidated_claims": [], "conflicts": [],
            "new_entities": [], "merged_entities": [], "review_enqueued": [],
            "orphans": [], "relabelled": [], "errors": [],
        }
        touched: set[str] = set()

        session_ids = (self.reader.list_sessions() if scope == "all"
                       else list(scope))
        for sid in session_ids:                      # Phase 0/1
            try:
                delta = self.reader.delta(sid, st.get_watermark(sid))
            except (OSError, ValueError, KeyError) as exc:
                diff["errors"].append({"session": sid, "error": str(exc)})
                continue
            if delta is None:
                continue
            orphan_mark = len(diff["orphans"])   # roll back diff orphans if the session fails
            try:
                st.x("BEGIN")
                touched |= self._process_session(delta, run_id, diff)
                seen = (st.get_watermark(sid) or {}).get("processed_ids", set())
                st.set_watermark(sid, delta.dag_hash,
                                 set(seen) | delta.all_node_ids)
                st.conn.commit()
                diff["sessions"].append(sid)
            except Exception as exc:               # noqa: BLE001 — session must roll back whole
                st.conn.rollback()
                del diff["orphans"][orphan_mark:]  # candidates referenced now-rolled-back evidence
                diff["errors"].append({"session": sid, "error": str(exc)})

        if diff["orphans"]:                                  # Phase 7: enqueue once per run
            rid = st.enqueue_review(
                "orphan_claims", {"run_id": run_id, "candidates": diff["orphans"]})
            diff["review_enqueued"].append({"id": rid, "type": "orphan_claims"})
            st.conn.commit()

        relabelled = incremental_reconcile(st, touched)      # Phase 6
        diff["relabelled"] = relabelled

        stats = {
            "sessions_compiled": len(diff["sessions"]),
            "claims_added": len(diff["added_claims"]),
            "claims_merged": len(diff["merged_claims"]),
            "claims_invalidated": len(diff["invalidated_claims"]),
            "conflicts": len(diff["conflicts"]),
            "review_enqueued": len(diff["review_enqueued"]),
            "orphans": len(diff["orphans"]),
            "errors": len(diff["errors"]),
        }
        st.x("UPDATE compile_run SET finished_at=?, status='done', stats=?, diff=? WHERE id=?",
             (now_iso(), json.dumps(stats), json.dumps(diff, ensure_ascii=False), run_id))
        st.conn.commit()
        return {"run_id": run_id, "stats": stats, "diff": diff}

    # -------------------------------------------------------------- per session
    def _process_session(self, delta, run_id: str, diff: dict) -> set[str]:
        st = self.store
        touched: set[str] = set()

        # rewritten history: claims promoted from vanished node ids go through
        # the conflict/invalidate path, never edited in place.
        for nid in delta.vanished_ids:
            for row in st.q("SELECT claim_id FROM claim_origin WHERE session_id=? AND node_id=?",
                            (delta.session_id, nid)):
                cid = row["claim_id"]
                self._drop_support_origin(cid, delta.session_id, nid)
                touched.add(cid)

        goals = st.active_goals()
        goal_view = [{"id": g["root_id"], "title": g["title"],
                      "description": g["description"] or ""} for g in goals]

        for node_id in delta.new_claim_ids:                       # Phase 2
            node = delta.graph.nodes[node_id]
            sub = supporting_subgraph(delta.graph, node_id)
            out = self.judge("distill", {
                "claim": node.content,
                "subgraph": sub,
                "active_goals": goal_view,
            })
            valid_ids = {n["id"] for n in sub["nodes"]}
            cited = [x for x in out.get("source_node_ids", []) if x in valid_ids]
            if not cited:
                # hard validation failed — hallucinated grounding, drop candidate
                diff["errors"].append({"session": delta.session_id, "node": node_id,
                                       "error": "distill cited no real source_node_ids"})
                continue

            goal_id = out.get("addresses_goal") or "none"
            if goal_id != "none" and goal_id not in {g["id"] for g in goal_view}:
                goal_id = "none"
            if goal_id == "none":                                  # -> orphan pool (Phase 7)
                diff["orphans"].append({
                    "session": delta.session_id, "node": node_id,
                    "statement": out.get("statement", node.content),
                    "claim_type": out.get("claim_type"),
                    "source_node_ids": cited,
                    # register evidence NOW so adoption can wire supports edges
                    "evidence_ids": self._register_evidence(delta, cited),
                })
                continue

            entity_ids = self._resolve_entities(                  # Phase 3
                out.get("mentioned_entities", []), out.get("statement", ""), diff)
            evidence_ids = self._register_evidence(delta, cited)
            self._match_and_insert(                                # Phase 4/5
                delta, node_id, out, goal_id, entity_ids, evidence_ids,
                run_id, diff, touched)

        # Orphans are enqueued ONCE for the whole run (see _compile), not per
        # session — otherwise every later session re-enqueues the accumulated
        # pool and the same orphan shows up as many review items.
        return touched

    def _drop_support_origin(self, claim_id: str, session_id: str, node_id: str) -> None:
        """Remove only the support path contributed by one vanished claim node."""
        st = self.store
        for edge in st.alive_edges(dst=claim_id, edge_type="supports"):
            meta = _load_edge_meta(edge)
            origins = meta.get("origins")
            if isinstance(origins, list):
                kept = [
                    o for o in origins
                    if not (
                        isinstance(o, dict)
                        and o.get("session") == session_id
                        and o.get("node") == node_id
                    )
                ]
                if len(kept) == len(origins):
                    continue
                if kept:
                    meta["origins"] = kept
                    first = next((o for o in kept if isinstance(o, dict)), None)
                    if first is not None:
                        meta["session"] = first.get("session")
                        meta["claim_node"] = first.get("node")
                        if first.get("run") is not None:
                            meta["run"] = first.get("run")
                    st.x("UPDATE edge SET meta=? WHERE id=?",
                         (json.dumps(meta, ensure_ascii=False), edge["id"]))
                else:
                    st.close_edge(edge["id"])
                continue

            # Backward compatibility for support edges written before origins
            # were tracked. This preserves other sessions' supports.
            if meta.get("session") == session_id:
                st.close_edge(edge["id"])

    # ------------------------------------------------------------ Phase 3: ER
    def _resolve_entities(self, names: list[str], context: str, diff: dict) -> list[str]:
        st = self.store
        out: list[str] = []
        for name in names:
            if not (name or "").strip():
                continue
            live = st.q("SELECT * FROM entity WHERE merged_into IS NULL")
            exact = None
            pool: list[tuple[float, dict]] = []
            for ent in live:
                cands = [ent["canonical_name"]] + json.loads(ent["aliases"])
                if any(_norm(a) == _norm(name) for a in cands):
                    exact = ent
                    break
                best = max((_sim(name, a) for a in cands), default=0.0)
                if best >= 0.55:
                    pool.append((best, ent))
            if exact is not None:
                out.append(exact["id"])
                continue
            pool.sort(key=lambda t: -t[0])
            matched = False
            for _, ent in pool[:3]:
                same, conf = self.judge.entity_votes({
                    "name": name, "candidate": ent["canonical_name"],
                    "candidate_aliases": json.loads(ent["aliases"]),
                    "context": context})
                if not same:
                    continue
                if conf >= self.auto_threshold:
                    aliases = sorted(set(json.loads(ent["aliases"]) + [name]))
                    st.x("UPDATE entity SET aliases=? WHERE id=?",
                         (json.dumps(aliases, ensure_ascii=False), ent["id"]))
                    diff["merged_entities"].append({"name": name, "into": ent["id"]})
                    out.append(ent["id"])
                    matched = True
                elif conf >= self.review_threshold:
                    prov = self._create_entity(name, provisional=True)
                    rid = st.enqueue_review("entity_merge", {
                        "provisional": prov, "candidate": ent["id"],
                        "name": name, "candidate_name": ent["canonical_name"],
                        "confidence": conf})
                    diff["review_enqueued"].append({"id": rid, "type": "entity_merge"})
                    out.append(prov)
                    matched = True
                if matched:
                    break
            if not matched:
                eid = self._create_entity(name)
                diff["new_entities"].append({"id": eid, "name": name})
                out.append(eid)
        return out

    def _create_entity(self, name: str, *, provisional: bool = False) -> str:
        eid = new_id("ent")
        self.store.x("INSERT INTO entity (id,canonical_name,provisional,t_created)"
                     " VALUES (?,?,?,?)", (eid, name.strip(), int(provisional), now_iso()))
        return eid

    # ----------------------------------------------------- evidence registration
    def _register_evidence(self, delta, cited_node_ids: list[str]) -> list[str]:
        """Register the SOURCE ancestors of the cited nodes as evidence rows.
        Node ids are content hashes, so `source_hash` = node id gives us
        cross-session dedup (same finding cited twice == one evidence row)."""
        st = self.store
        out: list[str] = []
        source_ids: set[str] = set()
        for nid in cited_node_ids:
            node = delta.graph.nodes.get(nid)
            if node is not None and node.type.value == "source":
                source_ids.add(nid)
            source_ids.update(source_ancestors(delta.graph, nid))
        for sid in sorted(source_ids):
            existing = st.q1("SELECT id FROM evidence WHERE source_hash=? AND t_invalid IS NULL",
                             (sid,))
            if existing:
                out.append(existing["id"])
                continue
            node = delta.graph.nodes[sid]
            evid = new_id("ev")
            st.x("INSERT INTO evidence (id,evidence_type,content,content_ref,source_hash,"
                 "quality_score,t_valid) VALUES (?,?,?,?,?,?,?)",
                 (evid, "external_source" if node.ref else "agent_derived",
                  node.content, f"{delta.session_id}#{sid}", sid,
                  source_quality(delta.graph, sid), now_iso()))
            out.append(evid)
        return out

    # -------------------------------------------- Phase 4/5: match + conflicts
    def _match_and_insert(self, delta, node_id: str, out: dict, goal_id: str,
                          entity_ids: list[str], evidence_ids: list[str],
                          run_id: str, diff: dict, touched: set[str]) -> None:
        st = self.store
        statement = out.get("statement") or delta.graph.nodes[node_id].content

        pool = self._candidate_pool(goal_id, entity_ids)
        pool = sorted(pool, key=lambda c: -_sim(statement, c["statement"]))[:POOL_K]

        relation, target, conf = "new", None, 1.0
        if pool:
            m = self.judge("claim_equiv", {
                "new": statement,
                "pool": [{"id": c["id"], "statement": c["statement"]} for c in pool]})
            relation = m.get("relation", "new")
            target = m.get("target")
            conf = float(m.get("confidence", 0.0))
            if target is not None and target not in {c["id"] for c in pool}:
                relation, target = "new", None

        if relation == "equivalent" and target and conf >= self.auto_threshold:
            self._merge_into(target, delta.session_id, node_id, evidence_ids, run_id)
            diff["merged_claims"].append({"into": target, "statement": statement,
                                          "session": delta.session_id})
            touched.add(target)
            return

        cid = self._insert_claim(delta, node_id, out, statement, goal_id,
                                 entity_ids, evidence_ids, run_id)
        touched.add(cid)
        diff["added_claims"].append({"id": cid, "statement": statement, "goal": goal_id})

        if relation == "equivalent" and target and conf >= self.review_threshold:
            rid = st.enqueue_review("claim_merge", {
                "new": cid, "target": target, "confidence": conf,
                "new_statement": statement})
            diff["review_enqueued"].append({"id": rid, "type": "claim_merge"})
        elif relation == "refines" and target:
            st.add_edge(cid, target, "derived_from", meta={"via": "refines", "run": run_id})
            diff["refined_claims"].append({"id": cid, "refines": target})
            touched.add(target)

        self._detect_conflicts(cid, statement, goal_id, entity_ids,
                               exclude={target} if target else set(),
                               run_id=run_id, diff=diff, touched=touched)

    def _candidate_pool(self, goal_id: str, entity_ids: list[str]) -> list[dict]:
        """Alive claims on the same goal sharing >=1 entity (structure first,
        semantics second)."""
        st = self.store
        rows = st.q("SELECT * FROM claim WHERE t_invalid IS NULL AND goal_id=?", (goal_id,))
        if not entity_ids:
            return rows
        eset = set(entity_ids)
        out = []
        for c in rows:
            ments = {e["dst"] for e in st.alive_edges(src=c["id"], edge_type="mentions")}
            if ments & eset or not ments:
                out.append(c)
        return out

    def _insert_claim(self, delta, node_id: str, out: dict, statement: str,
                      goal_id: str, entity_ids: list[str], evidence_ids: list[str],
                      run_id: str) -> str:
        st = self.store
        cid = new_id("claim")
        t = now_iso()
        ctype = out.get("claim_type")
        if ctype not in ("hypothesis", "finding", "method_result",
                         "negative_result", "decision"):
            ctype = "finding"
        st.x("INSERT INTO claim (id,statement,claim_type,confidence,goal_id,"
             "t_valid,t_created) VALUES (?,?,?,?,?,?,?)",
             (cid, statement, ctype, float(out.get("confidence", 0.5)), goal_id, t, t))
        st.add_edge(cid, goal_id, "addresses", meta={"run": run_id})
        for eid in entity_ids:
            st.add_edge(cid, eid, "mentions")
        for evid in evidence_ids:
            st.add_edge(evid, cid, "supports",
                        meta=_support_meta(run_id, delta.session_id, node_id))
        st.x("INSERT OR IGNORE INTO claim_origin (claim_id,session_id,node_id,run_id)"
             " VALUES (?,?,?,?)", (cid, delta.session_id, node_id, run_id))
        return cid

    def _merge_into(self, target: str, session_id: str, node_id: str,
                    evidence_ids: list[str], run_id: str) -> None:
        """Equivalent claim re-confirmed: the existing claim gains a new support
        path + origin, no text rewrite. This is the cross-session robustness."""
        st = self.store
        existing = {e["src"]: e for e in st.alive_edges(dst=target, edge_type="supports")}
        for evid in evidence_ids:
            if evid not in existing:
                st.add_edge(evid, target, "supports",
                            meta=_support_meta(run_id, session_id, node_id, merged=True))
            else:
                self._append_support_origin(existing[evid], session_id, node_id, run_id)
        st.x("INSERT OR IGNORE INTO claim_origin (claim_id,session_id,node_id,run_id)"
             " VALUES (?,?,?,?)", (target, session_id, node_id, run_id))

    def _append_support_origin(self, edge: dict, session_id: str, node_id: str,
                               run_id: str) -> None:
        st = self.store
        meta = _load_edge_meta(edge)
        origin = _support_origin(session_id, node_id, run_id)
        origins = meta.get("origins")
        if not isinstance(origins, list):
            origins = []
            if meta.get("session") is not None and meta.get("claim_node") is not None:
                origins.append(_support_origin(str(meta["session"]),
                                               str(meta["claim_node"]),
                                               meta.get("run")))
        if any(
            isinstance(o, dict)
            and o.get("session") == session_id
            and o.get("node") == node_id
            for o in origins
        ):
            return
        origins.append(origin)
        meta["origins"] = origins
        st.x("UPDATE edge SET meta=? WHERE id=?",
             (json.dumps(meta, ensure_ascii=False), edge["id"]))

    # ------------------------------------------------------- Phase 5: conflicts
    def _detect_conflicts(self, cid: str, statement: str, goal_id: str,
                          entity_ids: list[str], *, exclude: set,
                          run_id: str, diff: dict, touched: set[str]) -> None:
        st = self.store
        pool = [c for c in self._candidate_pool(goal_id, entity_ids)
                if c["id"] != cid and c["id"] not in exclude]
        pool = sorted(pool, key=lambda c: -_sim(statement, c["statement"]))[:POOL_K]
        for old in pool:
            r = self.judge("contradiction", {"a": statement, "b": old["statement"]})
            if not r.get("contradicts"):
                continue
            verdict = adjudicate(st, cid, old["id"])
            touched.update((cid, old["id"]))
            if verdict["winner"]:
                loser, winner = verdict["loser"], verdict["winner"]
                t = now_iso()
                st.x("UPDATE claim SET t_invalid=?, status='invalidated' WHERE id=?",
                     (t, loser))
                st.add_edge(winner, loser, "contradicts",
                            meta={"resolution": "rule", "run": run_id, **verdict["why"]})
                diff["invalidated_claims"].append({"id": loser, "beaten_by": winner,
                                                   "why": verdict["why"]})
            else:
                st.x("UPDATE claim SET status='undetermined' WHERE id=?", (cid,))
                st.x("UPDATE claim SET status='undetermined' WHERE id=?", (old["id"],))
                st.add_edge(cid, old["id"], "contradicts",
                            meta={"resolution": "unresolved", "run": run_id,
                                  **verdict["why"]})
                rid = st.enqueue_review("conflict", {
                    "a": cid, "b": old["id"],
                    "a_statement": statement, "b_statement": old["statement"],
                    "scores": verdict["why"]})
                diff["review_enqueued"].append({"id": rid, "type": "conflict"})
            diff["conflicts"].append({"a": cid, "b": old["id"],
                                      "resolved": bool(verdict["winner"])})


# ---------------------------------------------------------------- adjudication
def evidence_strength(store: Store, claim_id: str) -> dict:
    """Deterministic, explainable support summary for one claim."""
    rows = store.q(
        """SELECT ev.* FROM edge e JOIN evidence ev ON ev.id = e.src
           WHERE e.dst=? AND e.edge_type='supports'
           AND e.t_invalid IS NULL AND ev.t_invalid IS NULL""", (claim_id,))
    acc, hashes = 1.0, set()
    for ev in rows:
        w = ev["trust_score"] if ev["evidence_type"] == "human_attested" else ev["quality_score"]
        w = float(w if w is not None else 0.5)
        if ev["evidence_type"] == "human_attested" and \
                (ev["attestation_method"] or "self_report") == "self_report":
            w *= 0.5                       # uncorroborated human word discounts
        acc *= (1.0 - max(0.0, min(1.0, w)))
        hashes.add(ev["source_hash"] or ev["id"])
    return {"strength": round(1.0 - acc, 4), "n_evidence": len(rows),
            "independent_sources": len(hashes)}


def adjudicate(store: Store, a: str, b: str) -> dict:
    """Rule-only conflict verdict (no LLM): compare aggregate evidence strength
    and independent source count. The reasons land in edge.meta for audit."""
    sa, sb = evidence_strength(store, a), evidence_strength(store, b)
    why = {"a": a, "b": b, "a_score": sa, "b_score": sb}
    if abs(sa["strength"] - sb["strength"]) >= 0.2:
        w, l = (a, b) if sa["strength"] > sb["strength"] else (b, a)
        why["rule"] = "strength margin >= 0.2"
        return {"winner": w, "loser": l, "why": why}
    if sa["independent_sources"] >= 2 and sb["independent_sources"] <= 1:
        why["rule"] = "independent sources 2+ vs <=1"
        return {"winner": a, "loser": b, "why": why}
    if sb["independent_sources"] >= 2 and sa["independent_sources"] <= 1:
        why["rule"] = "independent sources 2+ vs <=1"
        return {"winner": b, "loser": a, "why": why}
    why["rule"] = "no clear winner"
    return {"winner": None, "loser": None, "why": why}
