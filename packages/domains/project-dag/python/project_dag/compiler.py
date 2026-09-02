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

Model judgements are prepared before the write phase. Graph mutations,
watermarks, and the immutable Project Snapshot then commit as one short SQLite
transaction, so readers never observe a half-promoted state.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import threading
from contextlib import contextmanager, nullcontext
from collections.abc import Iterator
from typing import Any, Optional

from evidence_dag.model import Node, NodeStatus, NodeType

from .judge import Judge, JudgePreparationRequired
from .reader import SessionReader, supporting_subgraph
from .reconcile import incremental_reconcile
from .snapshot_integrity import validate_project_snapshot_row
from .store import Store, new_id, now_iso

_PROJECT_LOCKS: dict[tuple[str, str], threading.Lock] = {}
_PROJECT_LOCKS_GUARD = threading.Lock()

AUTO_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.60
POOL_K = 5
CLAIM_TYPES = frozenset({
    "hypothesis", "finding", "method_result", "negative_result",
    "decision", "conclusion",
})
_DISTINCT_CLAIM_SEMANTICS = frozenset({"decision", "conclusion"})
_DECLARED_EXECUTION_ACTOR = "sdk-execution-lineage"
_DECLARED_PROMOTION_TYPES = {
    ("evidence", NodeType.FINDING): "finding",
    ("conclusion", NodeType.CONCLUSION): "conclusion",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _claim_type(value: Any) -> str:
    return str(value) if value in CLAIM_TYPES else "finding"


def _declared_semantic_promotion(node: Node, subgraph: dict) -> Optional[dict]:
    """Map an SDK-declared semantic node without reinterpreting it via a model.

    The actor gate keeps ordinary extracted or legacy Evidence nodes on the
    existing Judge path.  The exact role/type pairs prevent a malformed role
    from silently changing epistemic semantics.  Source ids come from the
    canonical graph view, never from executor-facing external ids.
    """
    if (
        node.created_by != _DECLARED_EXECUTION_ACTOR
        or node.status != NodeStatus.FRAGILE
    ):
        return None
    role = node.attributes.get("semanticRole")
    claim_type = _DECLARED_PROMOTION_TYPES.get((role, node.type))
    statement = node.content.strip() if isinstance(node.content, str) else ""
    if claim_type is None or not statement:
        return None
    source_node_ids = [
        item["id"] for item in subgraph.get("nodes", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    if node.id not in source_node_ids:
        return None
    return {
        "statement": statement,
        "claim_type": claim_type,
        "mentioned_entities": [],
        "addresses_goal": "none",
        "source_node_ids": source_node_ids,
        # No semantic judgement was made.  Fragility is derived later from the
        # single declared Evidence root, not from this numeric placeholder.
        "confidence": 0.0,
    }


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


def _load_json_object(value: Any) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


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
    def _project_lock(self, project_key: str) -> threading.Lock:
        key = (os.path.abspath(self.store.db_path), project_key)
        with _PROJECT_LOCKS_GUARD:
            return _PROJECT_LOCKS.setdefault(key, threading.Lock())

    @contextmanager
    def compile_transaction(self, trigger: str = "scheduled", scope: Any = None,
                            *, project_key: str,
                            evidence_vector: Optional[list[dict]] = None) -> Iterator[dict]:
        """Parallel model preparation followed by one short serial commit.

        Different projects prepare concurrently.  The per-project lock rejects
        duplicate work for one project, while ``Store.transaction_lock`` only
        covers mutation plus immutable Project Snapshot insertion.
        """
        if not isinstance(scope, (list, tuple)):
            raise ValueError("compile scope must be an explicit Session list")
        lock = self._project_lock(project_key)
        if not lock.acquire(blocking=False):
            yield {"skipped": True, "reason": "compile already running for project"}
            return
        try:
            self._prepare_judgements(scope, project_key=project_key,
                                     evidence_vector=evidence_vector)
            while True:
                preparation: Optional[JudgePreparationRequired] = None
                with self.store.transaction_lock:
                    try:
                        forbid = getattr(self.judge, "model_calls_forbidden", None)
                        guard = forbid() if callable(forbid) else nullcontext()
                        with guard:
                            result = self._compile(
                                trigger, scope, project_key=project_key,
                                evidence_vector=evidence_vector)
                    except JudgePreparationRequired as required:
                        self.store.conn.rollback()
                        preparation = required
                    except Exception as exc:
                        self._mark_running_failed(exc)
                        raise
                    else:
                        try:
                            yield result
                        except Exception as exc:
                            self._mark_running_failed(exc)
                            raise
                        finally:
                            # The workflow normally commits graph + immutable
                            # snapshot inside the context. Any unfinished
                            # transaction is never allowed to leak.
                            if self.store.conn.in_transaction:
                                self.store.conn.rollback()
                        return
                assert preparation is not None
                warm_many = getattr(self.judge, "warm_many", None)
                if not callable(warm_many):
                    raise preparation
                warm_many([(
                    preparation.task_type, preparation.payload,
                    preparation.vote_seed,
                )])
        finally:
            lock.release()

    def _prepare_judgements(self, scope: Any, *, project_key: str,
                            evidence_vector: Optional[list[dict]]) -> None:
        """Warm input-stable compiler judgements before BEGIN IMMEDIATE.

        Distillation and Goal rematching dominate normal P2 latency and depend
        only on committed inputs. Entity votes are derived from those prepared
        distill outputs and the committed entity index. Dynamic claim matching
        remains in the serial phase because earlier insertions can change its
        candidate IDs; correctness takes precedence over speculative replay.
        """
        warm_many = getattr(self.judge, "warm_many", None)
        if not callable(warm_many):
            return
        with self.store.transaction_lock:
            goals = self.store.active_goals(project_key=project_key, scoped=True)
            goal_view = [{
                "id": goal["root_id"], "title": goal["title"],
                "description": goal["description"] or "",
            } for goal in goals]
            requests: list[tuple[str, dict, int]] = []
            for claim in self.store.q(
                    "SELECT * FROM claim WHERE project_key=? AND t_invalid IS NULL"
                    " AND needs_regoal=1 ORDER BY id", (project_key,)):
                requests.append(("goal_match", {
                    "claim": {
                        "id": claim["id"], "statement": claim["statement"],
                        "claim_type": claim["claim_type"],
                        "current_goal_id": claim["goal_id"],
                    },
                    "active_goals": goal_view,
                }, 0))

            session_ids = list(scope)
            expected = {
                entry["threadId"]: entry["digest"] for entry in (evidence_vector or [])
            }
            if evidence_vector is not None and set(session_ids) != set(expected):
                raise ValueError("compile scope must exactly match the captured evidence vector")
            distill_inputs: list[dict] = []
            for session_id in session_ids:
                try:
                    delta = self.reader.delta(
                        session_id, self.store.get_watermark(project_key, session_id),
                        expected.get(session_id))
                except (OSError, ValueError, KeyError):
                    continue
                if delta is None:
                    continue
                for node_id in delta.new_claim_ids:
                    node = delta.graph.nodes[node_id]
                    subgraph = supporting_subgraph(delta.graph, node_id)
                    if _declared_semantic_promotion(node, subgraph) is not None:
                        continue
                    payload = {
                        "claim": node.content,
                        "subgraph": subgraph,
                        "active_goals": goal_view,
                    }
                    distill_inputs.append(payload)
                    requests.append(("distill", payload, 0))

        outputs = warm_many(requests) if requests else []
        distill_outputs = outputs[-len(distill_inputs):] if distill_inputs else []
        entity_requests: list[tuple[str, dict, int]] = []
        with self.store.transaction_lock:
            live_entities = self.store.q(
                "SELECT * FROM entity WHERE project_key=? AND merged_into IS NULL",
                (project_key,),
            )
            for output in distill_outputs:
                context = output.get("statement", "")
                for name in output.get("mentioned_entities", []):
                    if not isinstance(name, str) or not name.strip():
                        continue
                    pool: list[tuple[float, dict]] = []
                    exact = False
                    for entity in live_entities:
                        aliases = [entity["canonical_name"]] + json.loads(entity["aliases"])
                        if any(_norm(alias) == _norm(name) for alias in aliases):
                            exact = True
                            break
                        similarity = max((_sim(name, alias) for alias in aliases), default=0.0)
                        if similarity >= 0.55:
                            pool.append((similarity, entity))
                    if exact:
                        continue
                    pool.sort(key=lambda item: -item[0])
                    for _, entity in pool[:3]:
                        payload = {
                            "name": name, "candidate": entity["canonical_name"],
                            "candidate_aliases": json.loads(entity["aliases"]),
                            "context": context,
                        }
                        entity_requests.extend(
                            ("entity_same", payload, vote_seed) for vote_seed in range(3))
        if entity_requests:
            warm_many(entity_requests)

    def _mark_running_failed(self, exc: Exception) -> None:
        stats = json.dumps({"errors": 1}, ensure_ascii=False)
        diff = json.dumps({"errors": [{"error": str(exc)}]}, ensure_ascii=False)
        try:
            self.store.conn.rollback()
            run_id = getattr(self, "_active_run_id", None)
            if run_id:
                self.store.x(
                    "INSERT OR REPLACE INTO compile_run"
                    " (id,trigger,scope,started_at,finished_at,status,stats,diff)"
                    " VALUES (?, 'scheduled', '[]', ?, ?, 'failed', ?, ?)",
                    (run_id, now_iso(), now_iso(), stats, diff),
                )
            self.store.conn.commit()
        except Exception:
            pass

    def _compile(self, trigger: str, scope: Any, *, project_key: str,
                 evidence_vector: Optional[list[dict]] = None) -> dict:
        st = self.store
        run_id = new_id("run")
        self._active_run_id = run_id
        st.x("BEGIN IMMEDIATE")
        st.x("INSERT INTO compile_run (id,trigger,scope,started_at) VALUES (?,?,?,?)",
             (run_id, trigger, json.dumps(scope), now_iso()))

        diff: dict[str, Any] = {
            "sessions": [], "added_claims": [], "merged_claims": [],
            "refined_claims": [], "invalidated_claims": [], "conflicts": [],
            "new_entities": [], "merged_entities": [], "review_enqueued": [],
            "orphans": [], "regoaled_claims": [], "decision_outputs": [],
            "relabelled": [], "errors": [],
        }
        touched: set[str] = set()

        self._collect_decision_outputs(project_key, diff)
        touched |= self._rematch_goals(project_key, run_id, diff)

        session_ids = list(scope)
        expected = {entry["threadId"]: entry["digest"] for entry in (evidence_vector or [])}
        if evidence_vector is not None and set(session_ids) != set(expected):
            raise ValueError("compile scope must exactly match the captured evidence vector")
        for index, sid in enumerate(session_ids):                      # Phase 0/1
            try:
                delta = self.reader.delta(
                    sid, st.get_watermark(project_key, sid), expected.get(sid))
            except (OSError, ValueError, KeyError) as exc:
                diff["errors"].append({"session": sid, "error": str(exc)})
                continue
            if delta is None:
                continue
            orphan_mark = len(diff["orphans"])   # roll back diff orphans if the session fails
            try:
                savepoint = f"session_{index}"
                st.x(f"SAVEPOINT {savepoint}")
                touched |= self._process_session(
                    delta,
                    run_id,
                    diff,
                    project_key=project_key,
                )
                st.set_watermark(project_key, sid, delta.dag_hash, delta.all_node_ids)
                st.x(f"RELEASE SAVEPOINT {savepoint}")
                diff["sessions"].append(sid)
            except JudgePreparationRequired:
                # This is control flow, not a bad session. The transaction
                # wrapper rolls back the optimistic attempt, prepares the
                # missing response without a write lock, then retries.
                st.x(f"ROLLBACK TO SAVEPOINT {savepoint}")
                st.x(f"RELEASE SAVEPOINT {savepoint}")
                raise
            except Exception as exc:               # noqa: BLE001 — session must roll back whole
                st.x(f"ROLLBACK TO SAVEPOINT {savepoint}")
                st.x(f"RELEASE SAVEPOINT {savepoint}")
                del diff["orphans"][orphan_mark:]  # candidates referenced now-rolled-back evidence
                diff["errors"].append({"session": sid, "error": str(exc)})

        if diff["orphans"]:                                  # Phase 7: enqueue once per run
            rid = st.enqueue_review(
                project_key, "orphan_claims",
                {"run_id": run_id, "candidates": diff["orphans"]})
            diff["review_enqueued"].append({"id": rid, "type": "orphan_claims"})

        if diff["errors"]:
            raise RuntimeError(json.dumps(diff["errors"], ensure_ascii=False))

        relabelled = incremental_reconcile(
            st, self.reader, project_key, touched, commit=False)          # Phase 6
        diff["relabelled"] = relabelled

        stats = {
            "sessions_compiled": len(diff["sessions"]),
            "claims_added": len(diff["added_claims"]),
            "claims_merged": len(diff["merged_claims"]),
            "claims_invalidated": len(diff["invalidated_claims"]),
            "conflicts": len(diff["conflicts"]),
            "review_enqueued": len(diff["review_enqueued"]),
            "decisions_applied": len(diff["decision_outputs"]),
            "orphans": len(diff["orphans"]),
            "errors": len(diff["errors"]),
        }
        st.x("UPDATE compile_run SET finished_at=?, status='done', stats=?, diff=? WHERE id=?",
             (now_iso(), json.dumps(stats), json.dumps(diff, ensure_ascii=False), run_id))
        # The transaction deliberately stays open. ProjectWorkflow inserts the
        # immutable Project Snapshot and commits graph+snapshot atomically.
        return {"run_id": run_id, "stats": stats, "diff": diff}

    def _collect_decision_outputs(self, project_key: str, diff: dict) -> None:
        """Expose only DecisionEvents not yet included in a committed snapshot.

        Decision commands and automatic A3 decisions reach the graph through
        the same compiler transaction.  ReviewItem candidates remain sidechain
        records; the immutable snapshot records their applied output in diff.
        """
        latest = self.store.q1(
            "SELECT * FROM project_snapshot WHERE project_key=?"
            " ORDER BY version DESC LIMIT 1", (project_key,),
        )
        committed: set[str] = set()
        if latest:
            payload = validate_project_snapshot_row(latest)
            committed = {
                decision.get("id")
                for decision in payload.get("graph", {}).get("decisions", [])
                if isinstance(decision, dict) and decision.get("id")
            }
        for decision in self.store.q(
                "SELECT * FROM decision_event WHERE project_key=? ORDER BY created_at,id",
                (project_key,)):
            if decision["id"] in committed:
                continue
            candidate = None
            if decision.get("review_id"):
                review = self.store.q1(
                    "SELECT payload FROM review WHERE id=?", (decision["review_id"],))
                if review:
                    review_payload = json.loads(review["payload"])
                    candidate = review_payload.get("remediationCandidate")
            diff["decision_outputs"].append({
                "decisionId": decision["id"],
                "reviewId": decision.get("review_id"),
                "findingId": decision.get("finding_id"),
                "action": decision["action"],
                "decidedBy": decision["decided_by"],
                "evidenceDigest": decision["evidence_digest"],
                "remediationCandidate": candidate,
            })

    def _rematch_goals(self, project_key: str, run_id: str, diff: dict) -> set[str]:
        """Apply persisted Goal changes without re-reading or reinterpreting Evidence.

        Goal saves mark only candidate claims with ``needs_regoal``. They are
        rematched here inside the same compiler transaction, so a goal-only
        update can commit a new immutable Project Snapshot even when every
        Evidence digest is unchanged.
        """
        claims = self.store.q(
            "SELECT * FROM claim WHERE project_key=? AND t_invalid IS NULL"
            " AND needs_regoal=1 ORDER BY id",
            (project_key,),
        )
        if not claims:
            return set()
        goals = self.store.active_goals(project_key=project_key, scoped=True)
        goal_view = [{
            "id": goal["root_id"], "title": goal["title"],
            "description": goal["description"] or "",
        } for goal in goals]
        valid_goal_ids = {goal["id"] for goal in goal_view}
        touched: set[str] = set()
        for claim in claims:
            match = self.judge("goal_match", {
                "claim": {
                    "id": claim["id"], "statement": claim["statement"],
                    "claim_type": claim["claim_type"], "current_goal_id": claim["goal_id"],
                },
                "active_goals": goal_view,
            })
            selected = match.get("goal_id")
            goal_id = selected if selected in valid_goal_ids else None
            for edge in self.store.alive_edges(src=claim["id"], edge_type="addresses"):
                self.store.close_edge(edge["id"])
            if goal_id is not None:
                self.store.add_edge(claim["id"], goal_id, "addresses", meta={
                    "run": run_id, "reason": "goal_changed",
                    "confidence": float(match.get("confidence", 0.0)),
                })
            else:
                review_id = self.store.enqueue_review(project_key, "goal_rematch", {
                    "claimId": claim["id"], "statement": claim["statement"],
                    "reason": match.get("reason", "no active goal matched"),
                    "runId": run_id,
                }, subject_id=claim["id"])
                diff["review_enqueued"].append({"id": review_id, "type": "goal_rematch"})
            self.store.x("UPDATE claim SET goal_id=?,needs_regoal=0 WHERE id=?",
                         (goal_id, claim["id"]))
            diff["regoaled_claims"].append({
                "id": claim["id"], "from": claim["goal_id"], "to": goal_id,
                "confidence": float(match.get("confidence", 0.0)),
            })
            touched.add(claim["id"])
        self._resolve_assigned_orphan_reviews(project_key)
        return touched

    def _resolve_assigned_orphan_reviews(self, project_key: str) -> None:
        """Close an orphan review once all of its materialized claims have Goals."""
        for review in self.store.q(
            "SELECT * FROM review WHERE project_key=? AND review_type='orphan_claims'"
            " AND status='open' ORDER BY created_at,id",
            (project_key,),
        ):
            payload = _load_json_object(review.get("payload"))
            candidates = payload.get("candidates")
            if not isinstance(candidates, list) or not candidates:
                continue
            materialized_candidates = [
                candidate for candidate in candidates if isinstance(candidate, dict)
                and isinstance(candidate.get("session"), str)
                and isinstance(candidate.get("node"), str)
            ]
            claim_ids = {
                candidate.get("project_claim_id")
                for candidate in materialized_candidates
                if isinstance(candidate.get("project_claim_id"), str)
            }
            if not claim_ids or any(
                not isinstance(candidate.get("project_claim_id"), str)
                for candidate in materialized_candidates
            ):
                continue
            assigned = all(
                (claim := self.store.q1(
                    "SELECT goal_id,t_invalid FROM claim WHERE id=? AND project_key=?",
                    (claim_id, project_key),
                )) is not None
                and (claim["t_invalid"] is not None or claim["goal_id"] is not None)
                for claim_id in claim_ids
            )
            if assigned:
                payload["resolution"] = "all materialized claims assigned or invalidated"
                self.store.x(
                    "UPDATE review SET status='resolved',payload=?,resolved_at=? WHERE id=?",
                    (json.dumps(payload, ensure_ascii=False), now_iso(), review["id"]),
                )
                self.store.x(
                    "INSERT INTO review_event (id,project_key,review_id,event_type,actor,payload,created_at)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (new_id("review-event"), project_key, review["id"],
                     "ReviewCandidateResolved", "project-compiler",
                     json.dumps({"reason": "all materialized claims assigned or invalidated"},
                                ensure_ascii=False), now_iso()),
                )

    # -------------------------------------------------------------- per session
    def _process_session(self, delta, run_id: str, diff: dict, *,
                         project_key: str) -> set[str]:
        st = self.store
        touched: set[str] = set()

        # rewritten history: claims promoted from vanished node ids go through
        # the conflict/invalidate path, never edited in place.
        for nid in delta.vanished_ids:
            for row in st.q("SELECT claim_id FROM claim_origin"
                            " WHERE project_key=? AND session_id=? AND node_id=?",
                            (project_key, delta.session_id, nid)):
                cid = row["claim_id"]
                self._drop_support_origin(cid, delta.session_id, nid)
                touched.add(cid)

        goals = st.active_goals(project_key=project_key, scoped=True)
        goal_view = [{"id": g["root_id"], "title": g["title"],
                      "description": g["description"] or ""} for g in goals]

        for node_id in delta.new_claim_ids:                       # Phase 2
            node = delta.graph.nodes[node_id]
            sub = supporting_subgraph(delta.graph, node_id)
            out = _declared_semantic_promotion(node, sub)
            declared_passthrough = out is not None
            if not declared_passthrough:
                out = self.judge("distill", {
                    "claim": node.content,
                    "subgraph": sub,
                    "active_goals": goal_view,
                })
            statement = out.get("statement")
            if not isinstance(statement, str) or not statement.strip():
                diff["errors"].append({
                    "session": delta.session_id,
                    "node": node_id,
                    "error": "distill returned no derived statement",
                })
                continue
            out = {
                **out,
                "statement": statement.strip(),
                # Evidence owns the native Conclusion identity. Project may
                # reconcile it, but model distillation cannot silently
                # downgrade it to a generic Finding during promotion.
                **({"claim_type": "conclusion"}
                   if node.type.value == "conclusion" else {}),
            }
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
            if goal_id == "none":                                  # -> graph + review (Phase 7)
                entity_ids = self._resolve_entities(
                    out.get("mentioned_entities", []), out.get("statement", ""), diff,
                    project_key=project_key)
                evidence_registration = self._register_evidence(
                    delta, node_id, project_key=project_key,
                    declared_passthrough=declared_passthrough)
                claim_id = self._match_and_insert(
                    delta, node_id, out, None, entity_ids, evidence_registration,
                    run_id, diff, touched, project_key=project_key,
                    declared_passthrough=declared_passthrough)
                diff["orphans"].append({
                    "session": delta.session_id, "node": node_id,
                    "project_claim_id": claim_id,
                    "statement": out["statement"],
                    "claim_type": out.get("claim_type"),
                    "source_node_ids": cited,
                    "evidence_ids": [item["id"] for item in evidence_registration["refs"]],
                })
                continue

            entity_ids = self._resolve_entities(                  # Phase 3
                out.get("mentioned_entities", []), out.get("statement", ""), diff,
                project_key=project_key)
            evidence_registration = self._register_evidence(
                delta, node_id, project_key=project_key,
                declared_passthrough=declared_passthrough)
            self._match_and_insert(                                # Phase 4/5
                delta, node_id, out, goal_id, entity_ids, evidence_registration,
                run_id, diff, touched, project_key=project_key,
                declared_passthrough=declared_passthrough)

        # A prior promoted claim that no longer has any current session origin
        # is not part of the live graph. Immutable Project Snapshots retain its
        # history; the mutable compiler state closes it instead of leaking the
        # stale contribution into later snapshots.
        for claim_id in sorted(touched):
            remaining = st.q1(
                "SELECT 1 AS present FROM claim_origin WHERE project_key=? AND claim_id=? LIMIT 1",
                (project_key, claim_id),
            )
            if remaining is not None:
                continue
            st.x(
                "UPDATE claim SET status='invalidated',t_invalid=?"
                " WHERE id=? AND project_key=? AND t_invalid IS NULL",
                (now_iso(), claim_id, project_key),
            )
            for edge in st.q(
                "SELECT id FROM edge WHERE t_invalid IS NULL AND (src=? OR dst=?)",
                (claim_id, claim_id),
            ):
                st.close_edge(edge["id"])

        # Orphans are enqueued ONCE for the whole run (see _compile), not per
        # session — otherwise every later session re-enqueues the accumulated
        # pool and the same orphan shows up as many review items.
        return touched

    def _drop_support_origin(self, claim_id: str, session_id: str, node_id: str) -> None:
        """Remove only the graph contribution of one vanished Evidence origin.

        Replication relations can connect two EvidenceRefs without touching the
        promoted Project Claim.  They still belong to the same origin and must
        be retired with it.  Project-authored ``derived_from`` edges (for
        example a claim refinement) have no ``origins`` metadata and are left
        alone.
        """
        st = self.store
        claim = st.q1("SELECT project_key FROM claim WHERE id=?", (claim_id,))
        if claim is None:
            return
        project_key = claim["project_key"]
        project_node_ids = {
            row["id"] for row in st.q(
                "SELECT id FROM claim WHERE project_key=? UNION ALL"
                " SELECT id FROM evidence WHERE project_key=?",
                (project_key, project_key),
            )
        }
        for edge in st.q(
                "SELECT * FROM edge WHERE t_invalid IS NULL"
                " AND edge_type IN ('supports','derived_from','replicates',"
                " 'fails_to_replicate','rerun_of') ORDER BY id"):
            if edge["src"] not in project_node_ids or edge["dst"] not in project_node_ids:
                continue
            meta = _load_edge_meta(edge)
            origins = meta.get("origins")
            if not isinstance(origins, list):
                continue
            kept = [
                origin for origin in origins
                if not (
                    isinstance(origin, dict)
                    and origin.get("session") == session_id
                    and origin.get("node") == node_id
                )
            ]
            if len(kept) == len(origins):
                continue
            if not kept:
                st.close_edge(edge["id"])
                continue
            meta["origins"] = kept
            first = next((origin for origin in kept if isinstance(origin, dict)), None)
            if first is not None:
                meta["session"] = first.get("session")
                meta["claim_node"] = first.get("node")
                if first.get("run") is not None:
                    meta["run"] = first["run"]
                else:
                    meta.pop("run", None)
            st.x("UPDATE edge SET meta=? WHERE id=?",
                 (json.dumps(meta, ensure_ascii=False), edge["id"]))
        st.x(
            "DELETE FROM claim_origin WHERE project_key=?"
            " AND claim_id=? AND session_id=? AND node_id=?",
            (project_key, claim_id, session_id, node_id),
        )

    # ------------------------------------------------------------ Phase 3: ER
    def _resolve_entities(self, names: list[str], context: str, diff: dict, *,
                          project_key: str) -> list[str]:
        st = self.store
        out: list[str] = []
        for name in names:
            if not (name or "").strip():
                continue
            live = st.q(
                "SELECT * FROM entity WHERE project_key=? AND merged_into IS NULL",
                (project_key,),
            )
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
                    st.x("UPDATE entity SET aliases=? WHERE id=? AND project_key=?",
                         (json.dumps(aliases, ensure_ascii=False), ent["id"], project_key))
                    diff["merged_entities"].append({"name": name, "into": ent["id"]})
                    out.append(ent["id"])
                    matched = True
                elif conf >= self.review_threshold:
                    prov = self._create_entity(project_key, name, provisional=True)
                    rid = st.enqueue_review(project_key, "entity_merge", {
                        "provisional": prov, "candidate": ent["id"],
                        "name": name, "candidate_name": ent["canonical_name"],
                        "confidence": conf})
                    diff["review_enqueued"].append({"id": rid, "type": "entity_merge"})
                    out.append(prov)
                    matched = True
                if matched:
                    break
            if not matched:
                eid = self._create_entity(project_key, name)
                diff["new_entities"].append({"id": eid, "name": name})
                out.append(eid)
        return out

    def _create_entity(self, project_key: str, name: str, *,
                       provisional: bool = False) -> str:
        eid = new_id("ent")
        self.store.x(
            "INSERT INTO entity (id,project_key,canonical_name,provisional,t_created)"
            " VALUES (?,?,?,?,?)",
            (eid, project_key, name.strip(), int(provisional), now_iso()),
        )
        return eid

    # ----------------------------------------------------- evidence registration
    def _register_evidence(self, delta, claim_node_id: str, *,
                           project_key: str,
                           declared_passthrough: bool = False) -> dict[str, Any]:
        """Register the complete deterministic upstream EvidenceRef closure.

        Model-selected citations remain a hallucination guard for distillation,
        but never define provenance coverage.  Every row is only the immutable
        ``threadId + snapshotDigest + nodeId + nodeType`` reference.
        """
        st = self.store
        lineage = delta.graph.conclusion_lineage(claim_node_id)
        node_ids = [item["id"] for item in lineage["nodes"]]
        lineage_edges = lineage["edges"]
        evidence_node_ids = set(
            lineage["coverage"]["components"].get("evidence", []))
        has_source_assertions = any(
            delta.graph.nodes[node_id].type.value == "source_assertion"
            for node_id in evidence_node_ids
        )
        refs: list[dict[str, str]] = []
        by_node: dict[str, str] = {}
        for node_id in node_ids:
            node = delta.graph.nodes[node_id]
            # A verbatim declared Finding/Conclusion remains the single direct
            # EvidenceRef for its Project claim.  Its entire upstream closure
            # is still attached below, but not reinterpreted as independent
            # semantic support.  Generic roots retain claim_origin only.
            if (
                node_id == claim_node_id
                and node.type.value != "conclusion"
                and not declared_passthrough
            ):
                continue
            node_type = node.type.value
            existing = st.q1(
                "SELECT id FROM evidence WHERE project_key=? AND thread_id=?"
                " AND snapshot_digest=? AND node_id=?",
                (project_key, delta.session_id, delta.dag_hash, node_id),
            )
            if existing:
                evidence_id = existing["id"]
            else:
                evidence_id = new_id("ev")
                st.x(
                    "INSERT INTO evidence"
                    " (id,project_key,thread_id,snapshot_digest,node_id,node_type)"
                    " VALUES (?,?,?,?,?,?)",
                    (evidence_id, project_key, delta.session_id, delta.dag_hash,
                     node_id, node_type),
                )
            by_node[node_id] = evidence_id
            if declared_passthrough:
                supports_project_claim = node_id == claim_node_id
            else:
                supports_project_claim = (
                    node_type == "source_assertion"
                    or (
                        not has_source_assertions
                        and node_id in evidence_node_ids
                        and node_id != claim_node_id
                    )
                )
            refs.append({
                "id": evidence_id,
                "nodeId": node_id,
                "nodeType": node_type,
                "projectEdge": "supports" if supports_project_claim else "derived_from",
            })

        relations: list[dict[str, str]] = []
        for edge in lineage_edges:
            rel = edge["rel"]
            if rel not in {"replicates", "fails_to_replicate", "rerun_of"}:
                continue
            src = "target" if edge["src"] == claim_node_id else by_node.get(edge["src"])
            dst = "target" if edge["dst"] == claim_node_id else by_node.get(edge["dst"])
            if src and dst and src != dst:
                relations.append({
                    "src": src, "dst": dst, "edgeType": rel,
                    "evidenceEdgeId": edge["id"],
                })
        return {"refs": refs, "relations": relations}

    # -------------------------------------------- Phase 4/5: match + conflicts
    def _match_and_insert(self, delta, node_id: str, out: dict, goal_id: Optional[str],
                          entity_ids: list[str], evidence_registration: dict[str, Any],
                          run_id: str, diff: dict, touched: set[str], *,
                          project_key: str,
                          declared_passthrough: bool = False) -> str:
        st = self.store
        statement = out.get("statement")
        if not isinstance(statement, str) or not statement.strip():
            raise ValueError("distill returned no derived statement")
        statement = statement.strip()

        claim_type = _claim_type(out.get("claim_type"))
        if declared_passthrough:
            # Exact declared facts are inserted without semantic coalescing or
            # contradiction inference.  Either judgement would require the
            # model whose absence this deterministic path is designed for.
            cid = self._insert_claim(
                delta, node_id, out, statement, goal_id, entity_ids,
                evidence_registration, run_id, project_key=project_key)
            touched.add(cid)
            diff["added_claims"].append({
                "id": cid, "statement": statement, "goal": goal_id,
            })
            return cid

        pool = self._candidate_pool(
            project_key, goal_id, entity_ids, claim_type=claim_type)
        pool = sorted(pool, key=lambda c: -_sim(statement, c["statement"]))[:POOL_K]

        relation, target, conf = "new", None, 1.0
        if pool:
            # Model-facing aliases keep preparation cache keys stable when an
            # earlier candidate in the same batch was inserted by a rolled-back
            # optimistic compile attempt with a different generated row id.
            target_aliases = {
                f"candidate_{index}": candidate["id"]
                for index, candidate in enumerate(pool)
            }
            m = self.judge("claim_equiv", {
                "new": statement,
                "pool": [
                    {"id": alias, "statement": candidate["statement"]}
                    for alias, candidate in zip(target_aliases, pool)
                ]})
            relation = m.get("relation", "new")
            target = target_aliases.get(m.get("target"))
            conf = float(m.get("confidence", 0.0))
            if m.get("target") is not None and target is None:
                relation, target = "new", None

        if relation == "equivalent" and target and conf >= self.auto_threshold:
            self._merge_into(target, delta.session_id, node_id, evidence_registration, run_id,
                             project_key=project_key)
            diff["merged_claims"].append({"into": target, "statement": statement,
                                          "session": delta.session_id})
            touched.add(target)
            return target

        cid = self._insert_claim(delta, node_id, out, statement, goal_id,
                                 entity_ids, evidence_registration, run_id,
                                 project_key=project_key)
        touched.add(cid)
        diff["added_claims"].append({"id": cid, "statement": statement, "goal": goal_id})

        if relation == "equivalent" and target and conf >= self.review_threshold:
            rid = st.enqueue_review(project_key, "claim_merge", {
                "new": cid, "target": target, "confidence": conf,
                "new_statement": statement})
            diff["review_enqueued"].append({"id": rid, "type": "claim_merge"})
        elif relation == "refines" and target:
            st.add_edge(cid, target, "derived_from", meta={"via": "refines", "run": run_id})
            diff["refined_claims"].append({"id": cid, "refines": target})
            touched.add(target)

        self._detect_conflicts(cid, statement, project_key, goal_id, entity_ids,
                               claim_type=claim_type,
                               exclude={target} if target else set(),
                               run_id=run_id, diff=diff, touched=touched)
        return cid

    def _candidate_pool(self, project_key: str, goal_id: Optional[str],
                        entity_ids: list[str], *,
                        claim_type: Optional[str] = None) -> list[dict]:
        """Alive claims on the same goal sharing >=1 entity (structure first,
        semantics second)."""
        st = self.store
        if goal_id is None:
            rows = st.q(
                "SELECT * FROM claim WHERE project_key=? AND t_invalid IS NULL"
                " AND goal_id IS NULL", (project_key,))
        else:
            rows = st.q(
                "SELECT * FROM claim WHERE project_key=? AND t_invalid IS NULL"
                " AND goal_id=?", (project_key, goal_id))
        if claim_type in _DISTINCT_CLAIM_SEMANTICS:
            rows = [row for row in rows if row["claim_type"] == claim_type]
        elif claim_type is not None:
            rows = [row for row in rows
                    if row["claim_type"] not in _DISTINCT_CLAIM_SEMANTICS]
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
                      goal_id: Optional[str], entity_ids: list[str],
                      evidence_registration: dict[str, Any],
                      run_id: str, *, project_key: str) -> str:
        return self._insert_claim_record(
            session_id=delta.session_id,
            node_id=node_id,
            out=out,
            statement=statement,
            goal_id=goal_id,
            entity_ids=entity_ids,
            evidence_registration=evidence_registration,
            run_id=run_id,
            project_key=project_key,
        )

    def _insert_claim_record(self, *, session_id: str, node_id: str, out: dict,
                             statement: str, goal_id: Optional[str],
                             entity_ids: list[str], evidence_registration: dict[str, Any],
                             run_id: str, project_key: str) -> str:
        st = self.store
        cid = new_id("claim")
        t = now_iso()
        ctype = _claim_type(out.get("claim_type"))
        st.x("INSERT INTO claim (id,project_key,statement,claim_type,confidence,goal_id,"
             "status,t_valid,t_created) VALUES (?,?,?,?,?,?,?,?,?)",
             (cid, project_key, statement, ctype, float(out.get("confidence", 0.5)),
              goal_id, "supported" if goal_id is not None else "undetermined", t, t))
        if goal_id is not None:
            st.add_edge(cid, goal_id, "addresses", meta={"run": run_id})
        for eid in entity_ids:
            st.add_edge(cid, eid, "mentions")
        self._attach_evidence_registration(
            cid, evidence_registration, session_id, node_id, run_id)
        st.x("INSERT OR IGNORE INTO claim_origin"
             " (claim_id,project_key,session_id,node_id,run_id) VALUES (?,?,?,?,?)",
             (cid, project_key, session_id, node_id, run_id))
        return cid

    def _merge_into(self, target: str, session_id: str, node_id: str,
                    evidence_registration: dict[str, Any], run_id: str, *,
                    project_key: str) -> None:
        """Equivalent claim re-confirmed: the existing claim gains a new support
        path + origin, no text rewrite. This is the cross-session robustness."""
        st = self.store
        self._attach_evidence_registration(
            target, evidence_registration, session_id, node_id, run_id, merged=True)
        st.x("INSERT OR IGNORE INTO claim_origin"
             " (claim_id,project_key,session_id,node_id,run_id) VALUES (?,?,?,?,?)",
             (target, project_key, session_id, node_id, run_id))

    def _attach_evidence_registration(
            self, claim_id: str, registration: dict[str, Any], session_id: str,
            node_id: str, run_id: str, *, merged: bool = False) -> None:
        """Attach typed refs without flattening provenance roles into support."""
        st = self.store
        ref_ids = {item["id"] for item in registration.get("refs", [])}
        for item in registration.get("refs", []):
            evidence_id = item["id"]
            node_type = item["nodeType"]
            edge_type = item["projectEdge"]
            src, dst = ((evidence_id, claim_id) if edge_type == "supports"
                        else (claim_id, evidence_id))
            existing = self.store.q1(
                "SELECT * FROM edge WHERE src=? AND dst=? AND edge_type=?"
                " AND t_invalid IS NULL ORDER BY id LIMIT 1",
                (src, dst, edge_type),
            )
            if existing:
                self._append_support_origin(existing, session_id, node_id, run_id)
                continue
            meta = _support_meta(run_id, session_id, node_id, merged=merged)
            meta["evidenceNodeType"] = node_type
            st.add_edge(src, dst, edge_type, meta=meta)

        for relation in registration.get("relations", []):
            src = claim_id if relation["src"] == "target" else relation["src"]
            dst = claim_id if relation["dst"] == "target" else relation["dst"]
            if src != claim_id and src not in ref_ids:
                continue
            if dst != claim_id and dst not in ref_ids:
                continue
            edge_type = relation["edgeType"]
            existing = self.store.q1(
                "SELECT * FROM edge WHERE src=? AND dst=? AND edge_type=?"
                " AND t_invalid IS NULL LIMIT 1", (src, dst, edge_type),
            )
            if existing:
                self._append_support_origin(existing, session_id, node_id, run_id)
                continue
            meta = _support_meta(run_id, session_id, node_id, merged=merged)
            meta["evidenceEdgeId"] = relation["evidenceEdgeId"]
            st.add_edge(src, dst, edge_type, meta=meta)

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
    def _detect_conflicts(self, cid: str, statement: str, project_key: str,
                          goal_id: Optional[str],
                          entity_ids: list[str], *, claim_type: str, exclude: set,
                          run_id: str, diff: dict, touched: set[str]) -> None:
        st = self.store
        pool = [c for c in self._candidate_pool(
                    project_key, goal_id, entity_ids, claim_type=claim_type)
                if c["id"] != cid and c["id"] not in exclude]
        pool = sorted(pool, key=lambda c: -_sim(statement, c["statement"]))[:POOL_K]
        for old in pool:
            r = self.judge("contradiction", {"a": statement, "b": old["statement"]})
            if not r.get("contradicts"):
                continue
            verdict = adjudicate(st, self.reader, cid, old["id"])
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
                rid = st.enqueue_review(project_key, "conflict", {
                    "a": cid, "b": old["id"],
                    "a_statement": statement, "b_statement": old["statement"],
                    "scores": verdict["why"]})
                diff["review_enqueued"].append({"id": rid, "type": "conflict"})
            diff["conflicts"].append({"a": cid, "b": old["id"],
                                      "resolved": bool(verdict["winner"])})


# ---------------------------------------------------------------- adjudication
def evidence_strength(store: Store, reader: SessionReader, claim_id: str) -> dict:
    """Deterministic, explainable support summary for one claim."""
    rows = store.q(
        """SELECT ev.* FROM edge e JOIN evidence ev ON ev.id = e.src
           WHERE e.dst=? AND e.edge_type='supports'
           AND e.t_invalid IS NULL""", (claim_id,))
    acc, hashes = 1.0, set()
    for ev in rows:
        resolved = reader.resolve_reference(
            ev["thread_id"], ev["snapshot_digest"], ev["node_id"])
        w = float(resolved["quality"])
        acc *= (1.0 - max(0.0, min(1.0, w)))
        hashes.add(resolved["sourceIdentity"])
    return {"strength": round(1.0 - acc, 4), "n_evidence": len(rows),
            "independent_sources": len(hashes)}


def adjudicate(store: Store, reader: SessionReader, a: str, b: str) -> dict:
    """Rule-only conflict verdict (no LLM): compare aggregate evidence strength
    and independent source count. The reasons land in edge.meta for audit."""
    sa, sb = evidence_strength(store, reader, a), evidence_strength(store, reader, b)
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
