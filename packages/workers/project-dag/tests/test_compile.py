"""End-to-end tests for the canonical Project DAG workflow."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Artifact, ArtifactVersion, EdgeRel, NodeStatus, NodeType, SourceAnchor, SourceSelector,
)
from evidence_dag.snapshot import build_snapshot, snapshot_filename, snapshot_storage_key

from project_dag.contracts import remediation_candidate, select_a3_action
from project_dag.judge import Judge, StubJudge
from project_dag.service import Engine
from project_dag.store import Store


def make_judge() -> StubJudge:
    def distill(payload):
        goals = payload["active_goals"]
        return {
            "statement": payload["claim"], "claim_type": "finding",
            "mentioned_entities": ["pipeline"],
            "addresses_goal": goals[0]["id"] if goals else "none",
            "source_node_ids": [n["id"] for n in payload["subgraph"]["nodes"]],
            "confidence": 0.9,
        }

    def equiv(payload):
        new = payload["new"].lower().replace("again ", "")
        for claim in payload["pool"]:
            if claim["statement"].lower() == new:
                return {"relation": "equivalent", "target": claim["id"], "confidence": 0.95}
        return {"relation": "new", "target": None, "confidence": 0.9}

    return StubJudge({
        "distill": distill,
        "goal_match": lambda p: {
            "goal_id": p["active_goals"][-1]["id"] if p["active_goals"] else "none",
            "confidence": 0.92,
            "reason": "best active goal",
        },
        "entity_same": lambda p: {"same": p["name"].lower() == p["candidate"].lower(),
                                   "confidence": 0.95},
        "claim_equiv": equiv,
        "contradiction": lambda p: {"contradicts": False, "confidence": 0.9},
        "a1_verify": lambda p: {
            "entailment": {"result": "passed", "confidence": 0.91, "reason": "explicit support"},
            "applicability": {"result": "passed", "confidence": 0.86, "reason": "scope aligns"},
        },
        "a2_adversarial": lambda p: {
            "methodology": {"result": "uncertain", "confidence": 0.62,
                            "reason": "method metadata incomplete"},
            "reproducibility": {"result": "uncertain", "confidence": 0.6,
                                "reason": "not a local run"},
            "independence": {"result": "passed", "confidence": 0.88,
                             "reason": "stable artifact identity"},
        },
    })


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def write_snapshot(directory: str, thread_id: str, claims: list[tuple[str, str]],
                   version: int = 1, node_type: NodeType = NodeType.CLAIM,
                   artifact_kind: str = "paper", artifact_locator: str | None = None,
                   node_status: NodeStatus = NodeStatus.SUPPORTED) -> dict:
    graph = ThreadGraph(thread_id)
    for index, (claim_text, source_text) in enumerate(claims):
        artifact_id = f"artifact:{thread_id}:{index}"
        version_id = f"artifact-version:{thread_id}:{version}:{index}"
        anchor_id = f"anchor:{thread_id}:{version}:{index}"
        artifact = Artifact(
            artifact_id=artifact_id, kind=artifact_kind, created_at="2026-07-10T00:00:00Z",
            current_version_id=version_id, access_policy={"read": True},
        )
        artifact_version = ArtifactVersion(
            version_id=version_id, artifact_id=artifact_id,
            locator=artifact_locator or f"papers/{thread_id}-{index}.pdf",
            content_digest=_sha(source_text),
            version=str(version), size=len(source_text), media_type="application/pdf",
            observed_at="2026-07-10T00:00:00Z", availability="available",
            retention="reference",
        )
        anchor = SourceAnchor(
            anchor_id=anchor_id, artifact_id=artifact_id,
            artifact_version_id=version_id,
            selector=SourceSelector(type="pdf", page=index + 1, quote=source_text),
            anchor_digest=_sha(source_text), created_at="2026-07-10T00:00:00Z",
        )
        graph.attach_registry_records(artifact=artifact, artifact_version=artifact_version,
                                      source_anchor=anchor)
        source = graph.add_or_get_node(
            NodeType.SOURCE_ASSERTION, source_text, artifact_id=artifact_id,
            artifact_version_id=version_id, source_anchor_id=anchor_id,
            source_quality=0.9,
        )
        claim = graph.add_or_get_node(node_type, claim_text)
        claim.status = node_status
        graph.add_edge(source.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.94)
    snapshot = build_snapshot(graph, version=version, input_watermark=f"turn:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    serialized = provjson.dumps(graph)
    with open(os.path.join(directory, snapshot_filename(thread_id)), "w", encoding="utf-8") as handle:
        handle.write(serialized)
    historical_dir = os.path.join(directory, "snapshots", snapshot_storage_key(thread_id))
    os.makedirs(historical_dir, exist_ok=True)
    historical_path = os.path.join(
        historical_dir, f"{version:08d}-{snapshot.digest[7:]}.prov.json",
    )
    with open(historical_path, "x", encoding="utf-8") as handle:
        handle.write(serialized)
    return snapshot.to_dict()


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.engine = Engine(os.path.join(self.tmp.name, "project.db"), self.sessions,
                             judge=make_judge())
        self.project = "path:/workspace/a"
        self.goal = self.engine.create_goal(self.project, "Assess the pipeline")

    def tearDown(self):
        self.engine.store.close()
        self.tmp.cleanup()

    def enqueue(self, snapshots: list[dict], *, project: str | None = None,
                reason: str = "evidence_snapshot_committed", mode: str = "autonomous") -> dict:
        vector = [{"threadId": s["threadId"], "digest": s["digest"]} for s in snapshots]
        return self.engine.enqueue_update({
            "projectKey": project or self.project,
            "evidenceVector": vector,
            "capturedScope": {"includedSessions": [s["threadId"] for s in snapshots],
                              "excludedSessions": [], "isolatedSessions": []},
            "reason": reason, "priority": 5, "autonomyMode": mode,
        })

    def drain(self, project: str | None = None, limit: int = 5) -> list[dict]:
        out = []
        for _ in range(limit):
            update = self.engine.process_updates(project or self.project)
            audit = self.engine.process_audits(project or self.project)
            if update is not None:
                out.append(update)
            if update is None and audit is None:
                break
        return out

    def test_committed_snapshot_compiles_with_immutable_vector_and_provenance(self):
        evidence = write_snapshot(self.sessions, "sciforge:thr/1",
                                  [("pipeline improves accuracy", "paper says so")])
        self.enqueue([evidence])
        runs = self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertIsNotNone(latest)
        self.assertEqual(latest["evidenceVector"],
                         [{"threadId": "sciforge:thr/1", "digest": evidence["digest"]}])
        self.assertEqual(latest["status"], "committed")
        self.assertEqual(len(latest["assessments"]), 2)
        self.assertEqual({item["level"] for item in latest["assessments"]}, {"A0"})
        persisted_levels = {
            item["level"] for item in self.engine.workflow.assessments(
                self.project, latest["digest"])
        }
        self.assertEqual(persisted_levels, {"A0", "A1", "A2"})
        claim = latest["graph"]["claims"][0]
        provenance = self.engine.resolve_provenance(self.project, claim["id"], latest["digest"])
        self.assertTrue(provenance["reachesArtifact"])
        self.assertEqual(provenance["provenanceLevel"], "L3")
        self.assertNotIn("distill", {a["actor"] for a in latest["assessments"]
                                     if a["level"] in {"A1", "A2"}})
        self.assertGreaterEqual(len(runs), 1)

    def test_projects_with_different_goals_reuse_the_same_evidence_reference(self):
        evidence = write_snapshot(
            self.sessions, "shared-evidence",
            [("The shared result supports either project view.",
              "The immutable source records the shared result.")],
        )
        other_project = "path:/workspace/other-view"
        other_goal = self.engine.create_goal(other_project, "Interpret the shared result")

        self.enqueue([evidence], project=self.project, reason="manual_immediate")
        self.drain(self.project)
        self.enqueue([evidence], project=other_project, reason="manual_immediate")
        self.drain(other_project)

        primary = self.engine.workflow.latest_snapshot(self.project)
        other = self.engine.workflow.latest_snapshot(other_project)
        shared_vector = [{"threadId": "shared-evidence", "digest": evidence["digest"]}]
        self.assertEqual(primary["evidenceVector"], shared_vector)
        self.assertEqual(other["evidenceVector"], shared_vector)
        self.assertEqual(primary["graph"]["goals"][0]["root_id"], self.goal["root_id"])
        self.assertEqual(other["graph"]["goals"][0]["root_id"], other_goal["root_id"])
        self.assertEqual(primary["graph"]["claims"][0]["goal_id"], self.goal["root_id"])
        self.assertEqual(other["graph"]["claims"][0]["goal_id"], other_goal["root_id"])
        self.assertEqual(primary["graph"]["entities"][0]["project_key"], self.project)
        self.assertEqual(other["graph"]["entities"][0]["project_key"], other_project)
        self.assertNotEqual(primary["graph"]["entities"][0]["id"],
                            other["graph"]["entities"][0]["id"])
        self.assertNotEqual(primary["digest"], other["digest"])

    def test_project_database_does_not_copy_evidence_snapshot_envelopes(self):
        table = self.engine.store.q1(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_snapshot'")
        self.assertIsNone(table)
        columns = {row["name"] for row in self.engine.store.q("PRAGMA table_info(evidence)")}
        self.assertEqual(columns, {
            "id", "project_key", "thread_id", "snapshot_digest", "node_id",
        })
        canary = "RAW_SOURCE_CONTENT_MUST_NOT_ENTER_PROJECT_DB"
        evidence = write_snapshot(
            self.sessions, "reference-only",
            [("A derived project statement.", canary)],
        )
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        payload = self.engine.store.q1(
            "SELECT payload FROM project_snapshot WHERE project_key=?"
            " ORDER BY version DESC LIMIT 1", (self.project,))["payload"]
        self.assertNotIn(canary, payload)

    def test_entity_reconciliation_never_reads_or_mutates_another_project(self):
        def distill(payload):
            goals = payload["active_goals"]
            name = payload["claim"]
            return {
                "statement": f"Derived view for {name}.", "claim_type": "finding",
                "mentioned_entities": [name],
                "addresses_goal": goals[0]["id"] if goals else "none",
                "source_node_ids": [n["id"] for n in payload["subgraph"]["nodes"]],
                "confidence": 0.9,
            }

        self.engine.judge.handlers["distill"] = distill
        self.engine.judge.handlers["entity_same"] = lambda _p: {
            "same": True, "confidence": 0.95,
        }
        first = write_snapshot(self.sessions, "entity-a", [("pipeline", "source a")])
        self.enqueue([first], reason="manual_immediate"); self.drain()
        primary_entity = self.engine.workflow.latest_snapshot(
            self.project)["graph"]["entities"][0]

        other_project = "path:/workspace/entity-b"
        self.engine.create_goal(other_project, "Other entity view")
        self.engine.judge.calls.clear()
        second = write_snapshot(self.sessions, "entity-b", [("pipelines", "source b")])
        self.enqueue([second], project=other_project, reason="manual_immediate")
        self.drain(other_project)

        candidates = [payload.get("candidate") for task, payload in self.engine.judge.calls
                      if task == "entity_same"]
        self.assertNotIn("pipeline", candidates)
        other_entity = self.engine.workflow.latest_snapshot(
            other_project)["graph"]["entities"][0]
        self.assertNotEqual(primary_entity["id"], other_entity["id"])
        persisted_primary = self.engine.store.q1(
            "SELECT aliases FROM entity WHERE id=? AND project_key=?",
            (primary_entity["id"], self.project),
        )
        self.assertEqual(json.loads(persisted_primary["aliases"]), [])

    def test_supported_finding_uses_the_same_project_compile_path_as_claim(self):
        evidence = write_snapshot(
            self.sessions,
            "analysis-session",
            [("The analysis found a reproducible effect.", "The recorded output reports the effect.")],
            node_type=NodeType.FINDING,
        )
        self.enqueue([evidence], reason="manual_immediate")
        self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(len(latest["graph"]["claims"]), 1)
        self.assertEqual(latest["graph"]["claims"][0]["claim_type"], "finding")
        self.assertEqual(latest["graph"]["origins"][0]["session_id"], "analysis-session")

    def test_no_goal_claims_remain_visible_and_are_rematched_after_goal_creation(self):
        project = "path:/workspace/no-goal"
        evidence = write_snapshot(
            self.sessions, "no-goal-session",
            [("The experiment produced a measurable effect.",
              "The recorded output contains the measured effect.")],
        )
        self.enqueue([evidence], project=project, reason="manual_immediate")
        self.drain(project)

        unassigned = self.engine.workflow.latest_snapshot(project)
        self.assertEqual(len(unassigned["graph"]["claims"]), 1)
        claim = unassigned["graph"]["claims"][0]
        self.assertIsNone(claim["goal_id"])
        self.assertEqual(len(unassigned["graph"]["evidence"]), 1)
        self.assertTrue(any(
            edge["edge_type"] == "supports" and edge["dst"] == claim["id"]
            for edge in unassigned["graph"]["edges"]
        ))
        orphan = self.engine.store.q1(
            "SELECT * FROM review WHERE project_key=? AND review_type='orphan_claims'",
            (project,),
        )
        self.assertIsNotNone(orphan)
        orphan_payload = json.loads(orphan["payload"])
        self.assertEqual(orphan_payload["candidates"][0]["project_claim_id"], claim["id"])

        goal = self.engine.create_goal(project, "Measure the experimental effect")
        self.drain(project)
        assigned = self.engine.workflow.latest_snapshot(project)
        self.assertEqual(assigned["graph"]["claims"][0]["id"], claim["id"])
        self.assertEqual(assigned["graph"]["claims"][0]["goal_id"], goal["root_id"])
        self.assertTrue(any(
            edge["edge_type"] == "addresses"
            and edge["src"] == claim["id"] and edge["dst"] == goal["root_id"]
            for edge in assigned["graph"]["edges"]
        ))
        resolved = self.engine.store.q1("SELECT status FROM review WHERE id=?", (orphan["id"],))
        self.assertEqual(resolved["status"], "resolved")

    def test_runtime_trace_artifact_remains_l0_across_project_provenance(self):
        evidence = write_snapshot(
            self.sessions,
            "runtime-session",
            [("The agent reported a result.", "Visible agent output")],
            artifact_kind="log",
            artifact_locator="runtime:sciforge:runtime-session:item-1",
        )
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        claim_id = latest["graph"]["claims"][0]["id"]
        provenance = self.engine.resolve_provenance(self.project, claim_id, latest["digest"])
        self.assertEqual(provenance["provenanceLevel"], "L0")
        self.assertTrue(any(
            item["reason"] == "external_artifact_not_identified"
            for item in provenance["breakpoints"]
        ))

    def test_rejects_unknown_update_fields(self):
        with self.assertRaisesRegex(ValueError, "unknown update fields"):
            self.engine.enqueue_update({
                "projectKey": self.project,
                "evidenceVector": [{"threadId": "s1", "digest": _sha("x")}],
                "embeddedInput": {"threadId": "s1", "status": "updating"},
                "capturedScope": {"includedSessions": ["s1"]},
                "reason": "manual_update",
            })

    def test_rejects_missing_committed_snapshot_reference(self):
        with self.assertRaisesRegex(ValueError, "committed Evidence Snapshot.*unavailable"):
            self.engine.enqueue_update({
                "projectKey": self.project,
                "evidenceVector": [{"threadId": "s1", "digest": _sha("missing")}],
                "capturedScope": {
                    "includedSessions": ["s1"],
                    "excludedSessions": [],
                    "isolatedSessions": [],
                },
                "reason": "manual_update",
            })

    def test_evidence_commit_merges_persisted_membership_and_isolates_projects(self):
        s1 = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([s1]); self.drain()
        s2 = write_snapshot(self.sessions, "s2", [("claim two", "source two")])
        # Incremental event carries only the changed session. Persisted s1 is retained.
        self.enqueue([s2]); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual({v["threadId"] for v in latest["evidenceVector"]}, {"s1", "s2"})

        other = "path:/workspace/b"
        self.engine.create_goal(other, "Other workspace")
        s3 = write_snapshot(self.sessions, "s3", [("other claim", "other source")])
        self.enqueue([s3], project=other); self.drain(other)
        other_latest = self.engine.workflow.latest_snapshot(other)
        self.assertEqual([v["threadId"] for v in other_latest["evidenceVector"]], ["s3"])
        self.assertNotIn("s3", {v["threadId"] for v in latest["evidenceVector"]})

    def test_cross_session_shared_artifact_is_one_independent_source(self):
        first = write_snapshot(
            self.sessions, "shared-source-a",
            [("shared result", "identical immutable source")],
        )
        second = write_snapshot(
            self.sessions, "shared-source-b",
            [("again shared result", "identical immutable source")],
        )
        self.enqueue([first, second], reason="manual_immediate")
        update = self.engine.process_updates(self.project)
        graph = update["snapshot"]["graph"]
        self.assertEqual(len(graph["claims"]), 1)
        self.assertEqual(len(graph["evidence"]), 2)
        self.assertEqual(graph["claims"][0]["status"], "fragile")

        self.engine.process_audits(self.project)
        findings = self.engine.workflow.findings(self.project)
        self.assertTrue(any(
            finding["finding_type"] == "hidden_shared_source" for finding in findings
        ))

    def test_changed_digest_refreshes_same_id_support_and_artifact_provenance(self):
        first = write_snapshot(
            self.sessions, "s1", [("stable claim", "first source assertion")], version=1)
        self.enqueue([first], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]

        second = write_snapshot(
            self.sessions, "s1", [("stable claim", "replacement source assertion")], version=2)
        self.enqueue([second]); self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        status = self.engine.update_status(self.project)
        self.assertEqual(status["committedSnapshot"]["digest"], after["digest"])
        self.assertIsNotNone(status["previousCommittedSnapshot"])
        self.assertNotEqual(
            status["previousCommittedSnapshot"]["digest"], after["digest"])
        self.assertEqual(after["graph"]["claims"][0]["id"], claim_id)
        self.assertEqual(len(after["graph"]["claims"]), 1)
        evidence_ref = after["graph"]["evidence"][0]
        self.assertEqual(evidence_ref["thread_id"], "s1")
        self.assertEqual(evidence_ref["snapshot_digest"], second["digest"])
        self.assertNotIn("content", evidence_ref)
        detail = self.engine.claim_detail(self.project, claim_id, after["digest"])
        self.assertEqual([item["content"] for item in detail["supports"]],
                         ["replacement source assertion"])
        provenance = self.engine.resolve_provenance(self.project, claim_id, after["digest"])
        version = provenance["paths"][0]["sourceAssertions"][0]["artifactVersion"]
        self.assertEqual(version["version"], "2")
        self.assertEqual(version["contentDigest"], _sha("replacement source assertion"))
        historical = self.engine.resolve_provenance(self.project, claim_id, before["digest"])
        historical_version = historical["paths"][0]["sourceAssertions"][0]["artifactVersion"]
        self.assertEqual(historical_version["version"], "1")
        self.assertEqual(historical_version["contentDigest"], _sha("first source assertion"))

    def test_changed_digest_removes_claim_that_is_no_longer_eligible(self):
        first = write_snapshot(
            self.sessions, "s1", [("status-sensitive claim", "source assertion")], version=1)
        self.enqueue([first], reason="manual_immediate"); self.drain()
        self.assertEqual(len(self.engine.workflow.latest_snapshot(self.project)["graph"]["claims"]), 1)

        second = write_snapshot(
            self.sessions, "s1", [("status-sensitive claim", "source assertion")], version=2,
            node_status=NodeStatus.UNDETERMINED,
        )
        self.enqueue([second]); self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(after["evidenceVector"], [{"threadId": "s1", "digest": second["digest"]}])
        self.assertEqual(after["graph"]["claims"], [])
        self.assertEqual(after["graph"]["origins"], [])

    def test_scope_dispositions_survive_auto_updates_and_support_reinclude(self):
        s1 = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        s2 = write_snapshot(self.sessions, "s2", [("claim two", "source two")])
        self.enqueue([s1, s2], reason="manual_immediate"); self.drain()

        self.engine.enqueue_update({
            "projectKey": self.project,
            "evidenceVector": [{"threadId": "s1", "digest": s1["digest"]}],
            "capturedScope": {
                "includedSessions": ["s1"],
                "excludedSessions": ["s2"],
                "isolatedSessions": [],
            },
            "reason": "manual_immediate",
        })
        self.drain()
        excluded = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(excluded["evidenceVector"],
                         [{"threadId": "s1", "digest": s1["digest"]}])
        self.assertEqual(excluded["excludedSessions"], ["s2"])
        self.assertEqual(len(excluded["graph"]["claims"]), 1)
        self.assertEqual({origin["session_id"] for origin in excluded["graph"]["origins"]},
                         {"s1"})
        self.assertTrue(all(
            all(origin["session"] == "s1" for origin in json.loads(edge["meta"])["origins"])
            for edge in excluded["graph"]["edges"] if edge["edge_type"] == "supports"
        ))

        changed_s2 = write_snapshot(
            self.sessions, "s2", [("changed claim", "changed source")], version=2)
        self.enqueue([changed_s2]); self.drain()
        after_auto = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(after_auto["evidenceVector"],
                         [{"threadId": "s1", "digest": s1["digest"]}])
        self.assertEqual(after_auto["excludedSessions"], ["s2"])
        self.assertEqual(len(after_auto["graph"]["claims"]), 1)

        self.engine.enqueue_update({
            "projectKey": self.project,
            "evidenceVector": [
                {"threadId": "s1", "digest": s1["digest"]},
                {"threadId": "s2", "digest": changed_s2["digest"]},
            ],
            "capturedScope": {
                "includedSessions": ["s1", "s2"],
                "excludedSessions": [],
                "isolatedSessions": [],
            },
            "reason": "manual_immediate",
        })
        self.drain()
        re_included = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual({entry["threadId"] for entry in re_included["evidenceVector"]},
                         {"s1", "s2"})
        self.assertEqual(re_included["excludedSessions"], [])

    def test_goal_save_versions_and_agent_root_reframe_is_visible(self):
        updated = self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="human", actor_id="researcher",
            title="Assess pipeline rigorously")
        self.assertEqual(updated["version"], 2)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        proposal = self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="agent", actor_id="agent-1",
            title="A different research intent")
        self.assertTrue(proposal["proposal"])
        self.assertEqual(self.engine.goal_tree(self.project)[0]["title"],
                         "Assess pipeline rigorously")

    def test_goal_change_rematches_existing_claims_with_unchanged_evidence_vector(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([snapshot], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]

        child = self.engine.create_goal(
            self.project, "Focused follow-up", parent_root=self.goal["root_id"],
            actor_type="agent", actor_id="research-agent",
        )
        self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        claim = next(item for item in after["graph"]["claims"] if item["id"] == claim_id)
        self.assertNotEqual(after["digest"], before["digest"])
        self.assertEqual(after["evidenceVector"], before["evidenceVector"])
        self.assertEqual(claim["goal_id"], child["root_id"])
        self.assertEqual(claim["needs_regoal"], 0)
        self.assertTrue(any(item["id"] == claim_id for item in after["compileDiff"]["regoaled_claims"]))

    def test_policy_change_recompiles_the_same_evidence_vector(self):
        evidence = write_snapshot(self.sessions, "policy", [("claim", "source")])
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(before["policyVersion"], 1)

        policy = self.engine.configure_policy(self.project, {
            "autonomyMode": "supervised", "actorId": "researcher",
        })
        self.assertEqual(policy["policy_version"], 2)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        update = self.engine.process_updates(self.project)
        after = update["snapshot"]

        self.assertEqual(after["evidenceVector"], before["evidenceVector"])
        self.assertEqual(after["goalVersion"], before["goalVersion"])
        self.assertEqual(after["policyVersion"], 2)
        self.assertNotEqual(after["digest"], before["digest"])
        self.assertEqual(update["job"]["reason"], "policy_changed")

    def test_autonomy_modes_share_pipeline_but_only_checkpoints_block(self):
        self.engine.configure_policy(self.project, {
            "autonomyMode": "checkpointed", "checkpoints": ["claim_fragile"],
            "actorId": "researcher",
        })
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot], mode="checkpointed"); self.drain(limit=1)
        latest = self.engine.workflow.latest_snapshot(self.project)
        reviews = self.engine.workflow.reviews(self.project)
        self.assertTrue(reviews)
        self.assertEqual(reviews[0]["checkpoint"], "human")
        self.assertEqual(
            reviews[0]["payload"]["remediationCandidate"]["execution"], "record_only")
        self.assertFalse(self.engine.store.q(
            "SELECT id FROM decision_event WHERE project_key=?", (self.project,)))
        self.assertTrue(any(item["blocking"] for item in
                            self.engine.workflow.attention(self.project, latest["digest"])
                            if item["subject_type"] == "finding") is False)
        self.assertEqual(self.engine.update_status(self.project)["state"], "fresh")

    def test_autonomous_a3_decision_queues_new_snapshot_without_false_resolution(self):
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot]); first = self.engine.process_updates(self.project)
        self.assertEqual(first["job"]["status"], "succeeded")
        queued_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.assertEqual(queued_audit["status"], "queued")
        self.assertEqual(queued_audit["lane"], "P3")
        self.engine.process_audits(self.project)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        decisions = self.engine.store.q("SELECT * FROM decision_event WHERE project_key=?",
                                        (self.project,))
        self.assertTrue(any(d["action"] == "request_evidence" for d in decisions))
        review = self.engine.store.q1(
            "SELECT r.* FROM review r JOIN decision_event d ON d.review_id=r.id"
            " WHERE d.project_key=? AND d.action='request_evidence'",
            (self.project,),
        )
        candidate = json.loads(review["payload"])["remediationCandidate"]
        self.assertEqual(candidate["operation"], "collect_or_reingest_evidence")
        self.assertTrue(candidate["externalAction"])
        self.assertTrue(candidate["runtimePermissionRequired"])
        self.assertEqual(candidate["execution"], "record_only")
        self.engine.process_updates(self.project)
        self.engine.process_audits(self.project)
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertTrue(latest["graph"]["decisions"])
        output = latest["compileDiff"]["decision_outputs"][0]
        self.assertEqual(output["decisionId"], decisions[0]["id"])
        self.assertEqual(output["remediationCandidate"]["id"], candidate["id"])
        self.assertTrue(any(
            item["subject_type"] == "decision"
            for item in self.engine.workflow.attention(self.project, latest["digest"])
        ))
        self.assertTrue(any(f["status"] == "open" for f in
                            self.engine.workflow.findings(self.project)))
        self.assertIsNone(self.engine.process_updates(self.project))
        self.assertEqual(self.engine.store.q1(
            "SELECT COUNT(*) n FROM decision_event WHERE project_key=? AND action='request_evidence'",
            (self.project,))["n"], 1)

    def test_a3_action_contract_is_evidence_gated_and_never_executes_candidates(self):
        base = {
            "id": "finding:1", "finding_type": "claim_fragile",
            "subject_id": "claim:1", "target_digest": "project:1",
            "severity": "medium",
        }
        self.assertEqual(select_a3_action(base), "request_evidence")
        self.assertEqual(select_a3_action(
            {**base, "finding_type": "adversarial_methodology", "severity": "high"}),
            "challenge")
        self.assertEqual(select_a3_action(
            {**base, "finding_type": "stale_release_snapshot", "severity": "critical"}),
            "defer")
        self.assertEqual(select_a3_action(
            base, condition_cleared=True, evidence_supported=True), "resolve")
        override = {**base, "finding_type": "claim_conflicted", "severity": "critical"}
        self.assertEqual(select_a3_action(
            override, evidence_supported=False,
            allow_agent_critical_override=True), "challenge")
        self.assertEqual(select_a3_action(
            override, evidence_supported=True,
            allow_agent_critical_override=True), "override")
        candidate = remediation_candidate("request_evidence", base)
        self.assertEqual(candidate["execution"], "record_only")
        self.assertTrue(candidate["runtimePermissionRequired"])

    def test_autonomous_override_requires_assessments_and_is_carried_without_loop(self):
        self.engine.configure_policy(self.project, {
            "autonomyMode": "autonomous", "allowAgentCriticalOverride": True,
            "actorId": "researcher",
        })
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        committed = self.engine.workflow.latest_snapshot(self.project)
        self.engine.workflow._audit_l1(
            self.project, committed, self.engine.workflow.policy(self.project))
        claim_id = committed["graph"]["claims"][0]["id"]
        finding_id = self.engine.workflow._open_finding(
            self.project, committed["digest"], "claim_conflicted", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "critical",
            {"auditLevel": "L1", "reason": "test conflict"},
        )
        self.engine.store.conn.commit()
        self.engine.workflow._autonomous_review(
            self.project, committed["digest"], [finding_id], "autonomous", "L1")
        decision = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE finding_id=?", (finding_id,))
        self.assertEqual(decision["action"], "override")
        overridden = next(
            finding for finding in self.engine.workflow.findings(self.project)
            if finding["id"] == finding_id)
        self.assertEqual(overridden["status"], "overridden")
        self.assertIsNotNone(self.engine.store.q1(
            "SELECT id FROM risk_override WHERE decision_id=?", (decision["id"],)))
        self.engine.process_updates(self.project)
        newer = self.engine.workflow.latest_snapshot(self.project)
        inherited_id = self.engine.workflow._open_finding(
            self.project, newer["digest"], "claim_conflicted", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "critical",
            {"auditLevel": "L1", "reason": "same evidence conflict"},
        )
        self.engine.store.conn.commit()
        inherited = next(
            item for item in self.engine.workflow.findings(self.project)
            if item["id"] == inherited_id)
        self.assertEqual(inherited["status"], "overridden")
        self.assertEqual(inherited["details"]["inheritedDecisionId"], decision["id"])
        self.assertIsNotNone(self.engine.store.q1(
            "SELECT o.id FROM risk_override o JOIN finding f ON f.id=o.finding_id"
            " WHERE f.target_digest=? AND o.decision_id=?",
            (newer["digest"], decision["id"]),
        ))

    def test_new_evidence_can_auto_resolve_an_old_finding(self):
        first = write_snapshot(self.sessions, "s1", [("claim", "source")], version=1)
        self.enqueue([first]); self.engine.process_updates(self.project)
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]
        finding_id = self.engine.workflow._open_finding(
            self.project, before["digest"], "obsolete_condition", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "medium",
            {"auditLevel": "L0"},
        )
        self.engine.store.conn.commit()
        second = write_snapshot(self.sessions, "s1", [("claim", "new source")], version=2)
        self.enqueue([second]); self.engine.process_updates(self.project)
        current = self.engine.workflow.latest_snapshot(self.project)
        self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": current["digest"], "level": "L1",
            "reason": "verify replacement evidence", "priority": 10,
        })
        self.engine.process_audits(self.project)
        resolved = next(
            item for item in self.engine.workflow.findings(self.project)
            if item["id"] == finding_id)
        self.assertEqual(resolved["status"], "auto_resolved")
        decision = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE finding_id=?", (finding_id,))
        self.assertEqual(decision["action"], "resolve")
        self.assertEqual(decision["decided_by"], "agent")

    def test_human_supersession_is_append_only_and_recompiled(self):
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        self.engine.process_audits(self.project)
        prior = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE project_key=? ORDER BY created_at LIMIT 1",
            (self.project,))
        decision = self.engine.record_decision({
            "projectKey": self.project, "action": "supersede", "decidedBy": "human",
            "actorId": "researcher", "autonomyMode": "autonomous",
            "rationale": "new expert assessment", "alternatives": ["endorse"],
            "evidenceDigest": prior["evidence_digest"], "confidence": 0.95,
            "reversibility": "reversible", "supersedesId": prior["id"],
        })
        self.assertEqual(decision["supersedes_id"], prior["id"])
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")

    def test_compile_and_snapshot_commit_are_atomic_on_failure(self):
        first = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([first]); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        before_claims = self.engine.store.q("SELECT id FROM claim WHERE project_key=?",
                                            (self.project,))
        second = write_snapshot(self.sessions, "s1", [
            ("claim one", "source one"), ("claim two", "source two")], version=2)
        self.enqueue([second])
        with patch.object(self.engine.workflow, "_commit_project_snapshot",
                          side_effect=RuntimeError("injected snapshot failure")):
            with self.assertRaises(RuntimeError):
                self.engine.process_updates(self.project)
        after = self.engine.workflow.latest_snapshot(self.project)
        after_claims = self.engine.store.q("SELECT id FROM claim WHERE project_key=?",
                                           (self.project,))
        self.assertEqual(after["digest"], before["digest"])
        self.assertEqual(after_claims, before_claims)
        failed = self.engine.store.q1(
            "SELECT * FROM project_update_job"
            " WHERE project_key=? AND status='retry_scheduled'",
            (self.project,))
        self.assertIsNotNone(failed["next_attempt_at"])
        retry_status = self.engine.update_status(self.project)
        self.assertEqual(retry_status["state"], "retry_scheduled")
        self.assertEqual(retry_status["pending"], 1)
        self.assertIsNone(self.engine.process_updates(self.project))
        retried = self.engine.retry_update(failed["id"], actor="researcher")
        self.assertEqual(retried["status"], "queued")
        self.assertIsNone(retried["next_attempt_at"])

    def test_project_update_becomes_terminal_failed_after_retry_limit(self):
        snapshot = write_snapshot(self.sessions, "terminal", [("claim", "source")])
        self.enqueue([snapshot])
        with patch("project_dag.workflow.UPDATE_MAX_ATTEMPTS", 1), \
                patch.object(self.engine.workflow, "_commit_project_snapshot",
                             side_effect=RuntimeError("terminal failure")):
            with self.assertRaises(RuntimeError):
                self.engine.process_updates(self.project)
        failed = self.engine.store.q1(
            "SELECT * FROM project_update_job WHERE project_key=?", (self.project,))
        self.assertEqual(failed["status"], "failed")
        self.assertIsNone(failed["next_attempt_at"])
        status = self.engine.update_status(self.project)
        self.assertEqual(status["state"], "update_failed")
        self.assertEqual(status["pending"], 0)

    def test_queries_never_expose_inflight_graph_before_snapshot_commit(self):
        first = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([first]); self.drain()
        self.assertEqual(len(self.engine.claims(self.project)), 1)
        second = write_snapshot(self.sessions, "s1", [
            ("claim one", "source one"), ("claim two", "source two")], version=2)
        self.enqueue([second])
        entered, release = threading.Event(), threading.Event()
        original = self.engine.workflow._commit_project_snapshot

        def paused(*args, **kwargs):
            entered.set(); release.wait(2); return original(*args, **kwargs)

        errors = []
        with patch.object(self.engine.workflow, "_commit_project_snapshot", side_effect=paused):
            worker = threading.Thread(
                target=lambda: self._capture_error(errors, self.engine.process_updates, self.project))
            worker.start(); self.assertTrue(entered.wait(2))
            self.assertEqual(len(self.engine.claims(self.project)), 1)
            release.set(); worker.join(2)
        self.assertFalse(errors)
        self.assertEqual(len(self.engine.claims(self.project)), 2)

    def test_different_projects_prepare_models_concurrently_before_serial_commit(self):
        other_project = "path:/workspace/b"
        self.engine.create_goal(other_project, "Assess the other pipeline")
        first = write_snapshot(self.sessions, "parallel-a", [("claim a", "source a")])
        second = write_snapshot(self.sessions, "parallel-b", [("claim b", "source b")])
        self.enqueue([first], project=self.project)
        self.enqueue([second], project=other_project)

        barrier = threading.Barrier(2, timeout=2)
        transaction_states: list[bool] = []
        judge = self.engine.workflow.compiler.judge
        original_distill = judge.handlers["distill"]

        def concurrent_distill(payload):
            transaction_states.append(self.engine.store.conn.in_transaction)
            barrier.wait()
            return original_distill(payload)

        judge.handlers["distill"] = concurrent_distill
        errors: list[Exception] = []
        workers = [
            threading.Thread(
                target=self._capture_error,
                args=(errors, self.engine.process_updates, project),
            )
            for project in (self.project, other_project)
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(4)

        self.assertFalse(errors)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(transaction_states, [False, False])
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(self.project))
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(other_project))

    def test_dynamic_model_cache_misses_restart_outside_sqlite_transaction(self):
        engine = self.engine

        class TransactionCheckingLlm:
            def __init__(self):
                self.transaction_states: list[bool] = []

            def chat(self, messages, temperature=0.0):
                del temperature
                self.transaction_states.append(engine.store.conn.in_transaction)
                task = messages[0]["content"].splitlines()[0].split(":", 1)[1].strip()
                payload = json.loads(messages[1]["content"].split("\n(vote ", 1)[0])
                if task == "distill":
                    return json.dumps({
                        "statement": payload["claim"], "claim_type": "finding",
                        "mentioned_entities": [],
                        "addresses_goal": payload["active_goals"][0]["id"],
                        "source_node_ids": [
                            node["id"] for node in payload["subgraph"]["nodes"]
                        ],
                        "confidence": 0.9,
                    })
                if task == "claim_equiv":
                    return json.dumps({
                        "relation": "new", "target": None, "confidence": 0.9,
                    })
                if task == "contradiction":
                    return json.dumps({"contradicts": False, "confidence": 0.9})
                raise AssertionError(task)

        llm = TransactionCheckingLlm()
        judge = Judge(llm, engine.store)
        engine.judge = judge
        engine.workflow.compiler.judge = judge
        snapshot = write_snapshot(self.sessions, "dynamic-prepare", [
            ("first prepared claim", "first source"),
            ("second prepared claim", "second source"),
        ])
        self.enqueue([snapshot])

        result = engine.process_updates(self.project)

        self.assertIsNotNone(result)
        self.assertEqual(len(result["snapshot"]["graph"]["claims"]), 2)
        self.assertGreaterEqual(len(llm.transaction_states), 4)
        self.assertTrue(all(not state for state in llm.transaction_states))

    def test_same_project_compile_lock_is_scoped_by_project_key(self):
        compiler = self.engine.workflow.compiler
        held = compiler._project_lock(self.project)
        held.acquire()
        try:
            with compiler.compile_transaction(
                    "scheduled", [], project_key=self.project,
                    evidence_vector=[]) as same_project:
                self.assertTrue(same_project["skipped"])
                self.assertIn("for project", same_project["reason"])
            other_project = "path:/workspace/lock-b"
            with compiler.compile_transaction(
                    "scheduled", [], project_key=other_project,
                    evidence_vector=[]) as other:
                self.assertFalse(other.get("skipped", False))
                self.engine.store.conn.rollback()
        finally:
            held.release()

    def test_audit_sidechain_is_persistent_and_failure_does_not_fail_project_job(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot])
        with patch.object(self.engine.workflow, "_execute_audit") as execute:
            result = self.engine.process_updates(self.project)
            execute.assert_not_called()
        self.assertEqual(result["job"]["status"], "succeeded")
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(self.project))
        queued = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["target_digest"], result["snapshot"]["digest"])
        with patch.object(self.engine.workflow, "_audit_l0",
                          side_effect=RuntimeError("audit offline")):
            with self.assertRaises(RuntimeError):
                self.engine.process_audits(self.project)
        failed = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=? AND status='failed'",
            (self.project,))
        self.assertIn("audit offline", failed["error"])
        self.assertIsNotNone(failed["next_attempt_at"])
        retried = self.engine.retry_audit(failed["id"], actor="researcher")
        self.assertEqual(retried["status"], "queued")
        self.assertIsNone(retried["next_attempt_at"])
        completed = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(completed["status"], "completed")

    def test_restart_recovers_running_audit_without_losing_digest_or_attempts(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.engine.store.x(
            "UPDATE audit_run SET status='running',attempts=2,started_at=? WHERE id=?",
            ("2026-07-10T00:00:00Z", audit["id"]),
        )
        self.engine.store.conn.commit()
        db_path = self.engine.store.db_path
        self.engine.store.close()
        self.engine = Engine(db_path, self.sessions, judge=make_judge())
        recovered = self.engine.workflow.audit(audit["id"])
        self.assertEqual(recovered["status"], "queued")
        self.assertEqual(recovered["target_digest"], audit["target_digest"])
        self.assertEqual(recovered["attempts"], 2)
        self.assertIsNotNone(self.engine.process_audits(self.project))

    def test_restart_requeues_running_compile_with_same_desired_vector(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        queued = self.enqueue([snapshot])
        self.engine.store.x(
            "UPDATE project_update_job SET status='running',attempts=3,processing_version=1"
            " WHERE id=?", (queued["id"],),
        )
        self.engine.store.conn.commit()
        db_path = self.engine.store.db_path
        self.engine.store.close()
        self.engine = Engine(db_path, self.sessions, judge=make_judge())
        recovered = self.engine.workflow.job(queued["id"])
        self.assertEqual(recovered["status"], "queued")
        self.assertEqual(recovered["desiredEvidenceVector"], [
            {"threadId": "s1", "digest": snapshot["digest"]},
        ])
        completed = self.engine.process_updates(self.project)
        self.assertEqual(completed["job"]["status"], "succeeded")

    def test_audit_enqueue_is_idempotent_for_digest_level_and_policy(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); result = self.engine.process_updates(self.project)
        first = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": result["snapshot"]["digest"],
            "level": "L1", "reason": "manual", "priority": 1,
        })
        duplicate = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": result["snapshot"]["digest"],
            "level": "L1", "reason": "release_gate", "priority": 10,
        })
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual(duplicate["priority"], 10)
        self.assertEqual(self.engine.store.q1(
            "SELECT COUNT(*) n FROM audit_run WHERE request_key=?",
            (first["request_key"],),
        )["n"], 1)

    def test_p3_audit_waits_while_p2_compile_is_eligible(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        queued_audit = self.engine.store.q1(
            "SELECT id FROM audit_run WHERE project_key=? AND status='queued'", (self.project,))
        self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="human", actor_id="researcher",
            description="updated goal context",
        )
        self.assertIsNone(self.engine.process_audits(self.project))
        self.assertEqual(self.engine.workflow.audit(queued_audit["id"])["status"], "queued")
        self.assertIsNotNone(self.engine.process_updates(self.project))

    def test_non_versioned_database_is_rejected_without_compatibility_path(self):
        db_path = os.path.join(self.tmp.name, "legacy-graph.db")
        connection = sqlite3.connect(db_path)
        connection.executescript("""
        CREATE TABLE goal (
          id TEXT PRIMARY KEY, root_id TEXT NOT NULL, title TEXT NOT NULL,
          version INTEGER NOT NULL, t_created TEXT NOT NULL
        );
        """)
        connection.commit(); connection.close()

        with self.assertRaisesRegex(RuntimeError, "requires a clean project-view database"):
            Store(db_path)

    def test_new_snapshot_marks_older_queued_audit_stale(self):
        first = write_snapshot(self.sessions, "s1", [("claim", "source")], version=1)
        self.enqueue([first]); first_run = self.engine.process_updates(self.project)
        first_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE target_digest=?", (first_run["snapshot"]["digest"],))
        self.assertEqual(first_audit["status"], "queued")
        second = write_snapshot(self.sessions, "s1", [("claim", "new source")], version=2)
        self.enqueue([second]); second_run = self.engine.process_updates(self.project)
        self.assertEqual(self.engine.workflow.audit(first_audit["id"])["status"], "stale")
        current_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE target_digest=?",
            (second_run["snapshot"]["digest"],),
        )
        self.assertEqual(current_audit["status"], "queued")
        self.assertEqual(current_audit["target_digest"], second_run["snapshot"]["digest"])

    def test_release_gate_requires_l2_and_runtime_permission_for_external_action(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        queued = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": latest["digest"], "level": "L2",
            "reason": "release_gate", "priority": 10,
        })
        audit = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(audit["id"], queued["id"])
        with self.assertRaises(PermissionError):
            self.engine.workflow.create_release(
                project_key=self.project, project_snapshot_digest=latest["digest"],
                audit_digest=audit["digest"], created_by="agent", output_artifacts=[],
                external_action=True)
        release = self.engine.workflow.create_release(
            project_key=self.project, project_snapshot_digest=latest["digest"],
            audit_digest=audit["digest"], created_by="agent", output_artifacts=[],
            requested_status="candidate", external_action=True,
            runtime_authorization={"granted": True, "permissionId": "runtime:permit:1"})
        self.assertEqual(release["certification_status"], "candidate")

    def test_l1_audit_uses_assessment_ledger(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        calls: list[str] = []
        real_judge = self.engine.workflow.compiler.judge

        def tracked_judge(task, payload):
            calls.append(task)
            return real_judge(task, payload)

        with patch.object(self.engine.workflow.compiler, "judge", side_effect=tracked_judge):
            self.enqueue([snapshot])
            update = self.engine.process_updates(self.project)
            latest = update["snapshot"]
            self.assertFalse({"a1_verify", "a2_adversarial"} & set(calls))
            self.assertEqual({item["level"] for item in latest["assessments"]}, {"A0"})
            self.assertEqual(self.engine.store.q1(
                "SELECT COUNT(*) n FROM assessment WHERE target_digest=?"
                " AND level IN ('A1','A2')", (latest["digest"],))["n"], 0)

            queued = self.engine.enqueue_audit({
                "projectKey": self.project, "targetDigest": latest["digest"],
                "level": "L1", "reason": "test semantic verification", "priority": 10,
            })
            self.assertEqual(queued["level"], "L1")
            result = self.engine.process_audits(self.project)
            audit = result["audit"]

        self.assertEqual(audit["id"], queued["id"])
        self.assertEqual(audit["level"], "L1")
        self.assertEqual(calls.count("a1_verify"), 1)
        self.assertEqual(calls.count("a2_adversarial"), 1)
        self.assertEqual({
            row["level"] for row in self.engine.store.q(
                "SELECT level FROM assessment WHERE target_digest=?",
                (latest["digest"],),
            )
            if row["level"] in {"A0", "A1", "A2"}
        }, {"A0", "A1", "A2"})
        self.assertTrue(any(f["finding_type"].startswith("adversarial_")
                            for f in self.engine.workflow.findings(self.project)))

    def test_default_checkpointed_policy_queues_and_records_human_review_packet(self):
        self.assertEqual(self.engine.workflow.policy(self.project)["autonomy_mode"],
                         "checkpointed")
        self.engine.configure_policy(self.project, {
            "autonomyMode": "checkpointed", "checkpoints": ["claim_fragile"],
            "actorId": "research-lead",
        })
        snapshot = write_snapshot(
            self.sessions, "review-session", [("fragile conclusion", "single source")],
            node_status=NodeStatus.FRAGILE,
        )
        vector = [{"threadId": snapshot["threadId"], "digest": snapshot["digest"]}]
        self.engine.enqueue_update({
            "projectKey": self.project, "evidenceVector": vector,
            "capturedScope": {"includedSessions": [snapshot["threadId"]],
                              "excludedSessions": [], "isolatedSessions": []},
            "reason": "manual_immediate", "priority": 5,
        })
        self.engine.process_updates(self.project)

        graph_view = self.engine.graph(self.project)
        packet = graph_view["reviewPackets"][0]
        claim = graph_view["claims"][0]
        self.assertEqual(packet["status"], "pending")
        self.assertEqual(packet["recommendedAction"], "request_evidence")
        self.assertEqual(claim["humanReview"]["reviewPacketId"], packet["id"])
        self.assertEqual(graph_view["humanReview"]["pendingCount"], 1)
        self.assertIn(packet["id"], {
            review["id"] for review in self.engine.workflow.reviews(self.project)
        })
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            self.engine.record_review_result(self.project, packet["id"], {
                "action": "approve", "actorId": "research-lead",
                "rationale": "This UI is displaying an obsolete snapshot.",
                "expectedSnapshotDigest": "project:stale",
            })

        audit_job = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": graph_view["snapshot"]["digest"],
            "level": "L2", "reason": "review_gate_test", "priority": 20,
        })
        audit = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(audit["id"], audit_job["id"])
        blocked_release = self.engine.workflow.create_release(
            project_key=self.project,
            project_snapshot_digest=graph_view["snapshot"]["digest"],
            audit_digest=audit["digest"], created_by="research-lead",
            output_artifacts=[], requested_status="certified",
        )
        self.assertEqual(blocked_release["certification_status"], "blocked")

        requested = self.engine.record_review_result(self.project, packet["id"], {
            "action": "request_evidence", "actorId": "research-lead",
            "rationale": "Collect an independent source before final approval.",
        })
        self.assertEqual(requested["status"], "pending")
        self.assertEqual(self.engine.graph(self.project)["humanReview"]["gateStatus"], "pending")

        approved = self.engine.record_review_result(self.project, packet["id"], {
            "action": "approve", "actorId": "research-lead",
            "rationale": "The limitation is understood and accepted.",
        })
        self.assertEqual(approved["status"], "approved")
        updated = self.engine.graph(self.project)
        self.assertEqual(updated["reviewPackets"][0]["status"], "approved")
        self.assertEqual(updated["claims"][0]["humanReview"]["status"], "approved")
        self.assertEqual(updated["humanReview"]["gateStatus"], "approved")
        decisions = self.engine.store.q(
            "SELECT * FROM decision_event WHERE review_id=? ORDER BY created_at,id",
            (packet["id"],))
        self.assertEqual({decision["action"] for decision in decisions},
                         {"request_evidence", "endorse"})
        self.assertTrue(all(decision["decided_by"] == "human" for decision in decisions))
        event = self.engine.store.q1(
            "SELECT * FROM domain_event WHERE project_key=?"
            " AND event_type='HumanReviewResultRecorded'", (self.project,))
        self.assertIsNotNone(event)
        certified_release = self.engine.workflow.create_release(
            project_key=self.project,
            project_snapshot_digest=graph_view["snapshot"]["digest"],
            audit_digest=audit["digest"], created_by="research-lead",
            output_artifacts=[], requested_status="certified",
        )
        self.assertEqual(certified_release["certification_status"], "certified")

        for action, expected in (("reject", "rejected"), ("defer", "deferred")):
            review_id = f"review_packet_test_{action}"
            review_payload = {
                **packet, "id": review_id, "status": "pending",
                "snapshotDigest": graph_view["snapshot"]["digest"],
            }
            self.engine.store.x(
                "INSERT INTO review (id,project_key,subject_id,review_type,checkpoint,status,"
                "payload,created_at) VALUES (?,?,?,'human_review_packet','human','open',?,?)",
                (review_id, self.project, review_id, json.dumps(review_payload),
                 "2026-07-13T00:00:00Z"),
            )
            self.engine.store.conn.commit()
            result = self.engine.record_review_result(self.project, review_id, {
                "action": action, "actorId": "research-lead",
                "rationale": f"Human chose to {action} this packet.",
            })
            self.assertEqual(result["status"], expected)

    @staticmethod
    def _capture_error(errors, fn, *args):
        try:
            fn(*args)
        except Exception as exc:  # pragma: no cover - assertion aid
            errors.append(exc)


if __name__ == "__main__":
    unittest.main(verbosity=2)
