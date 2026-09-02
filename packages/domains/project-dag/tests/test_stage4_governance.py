from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from project_dag.contracts import (  # noqa: E402
    DECISION_POLICY_V1,
    PROJECT_INVALIDATION_POLICY_V1,
    classify_project_invalidation,
    normalize_scope,
    project_input_fingerprint,
)
from project_dag.store import Store  # noqa: E402
from project_dag.judge import StubJudge  # noqa: E402
from project_dag.service import Engine  # noqa: E402


class Stage4GovernanceTests(unittest.TestCase):
    def test_scope_is_revision_ready_and_preserves_reasons(self):
        scope = normalize_scope({
            "includedSessions": ["session-a"],
            "excludedSessions": ["session-b"],
            "isolatedSessions": ["session-c"],
            "reasons": {
                "session-b": "negative result retained outside synthesis",
                "session-c": "lineage requires separate review",
            },
        })
        self.assertEqual(scope["reasons"]["session-b"],
                         "negative result retained outside synthesis")

    def test_invalidation_policy_fails_closed_at_formal_gates(self):
        self.assertEqual(classify_project_invalidation("layout"), "non_material")
        self.assertEqual(classify_project_invalidation("evidenceVector"), "material")
        self.assertEqual(classify_project_invalidation("futureField"), "unknown")
        self.assertEqual(classify_project_invalidation("futureField", formal_gate=True), "material")

    def test_fingerprint_is_stable_for_complete_input_context(self):
        context = {
            "goalIntent": "measure effect",
            "capturedScope": {"includedSessions": ["s1"]},
            "evidenceVector": [{"threadId": "s1", "digest": "sha256:" + "a" * 64}],
            "policyRef": PROJECT_INVALIDATION_POLICY_V1,
        }
        self.assertEqual(project_input_fingerprint(context), project_input_fingerprint(dict(context)))

    def test_store_installs_stage4_append_only_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(os.path.join(directory, "project.db"))
            names = {row["name"] for row in store.q(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({
                "project_scope_revision", "project_goal_draft", "project_invalidation",
                "approval_record", "finding_event", "review_event",
            } <= names)
            self.assertEqual(DECISION_POLICY_V1, "decision-policy/v1")
            store.close()

    def test_upstream_invalidation_marks_stale_without_enqueuing_compile(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = Engine(os.path.join(directory, "project.db"), directory,
                            judge=StubJudge({}))
            project = "path:/workspace/invalidation"
            result = engine.mark_invalidation({
                "projectKey": project,
                "reason": "upstream_changed",
                "changedFields": ["evidenceVector"],
            })
            self.assertTrue(result["stale"])
            self.assertIsNone(engine.workflow.invalidation(project)["appliedFingerprint"])
            self.assertEqual(engine.workflow.status(project)["state"], "stale")
            self.assertIsNone(engine.store.q1(
                "SELECT 1 FROM project_update_job WHERE project_key=?", (project,)))
            engine.store.close()

    def test_exact_snapshot_cas_and_accountable_human_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = Engine(os.path.join(directory, "project.db"), directory,
                            judge=StubJudge({}))
            project = "path:/workspace/stage4"
            engine.create_goal(project, "Assess the result")
            receipt = engine.enqueue_update({
                "projectKey": project, "evidenceVector": [],
                "capturedScope": {
                    "includedSessions": [], "excludedSessions": [],
                    "isolatedSessions": [], "reasons": {},
                },
                "reason": "explicit_user_synthesis",
            })
            self.assertEqual(receipt["state"], "queued")
            snapshot = engine.process_updates(project)["snapshot"]
            self.assertEqual(
                engine.workflow.seal_snapshot(
                    project, expected_head_digest=snapshot["digest"])["digest"],
                snapshot["digest"],
            )
            with self.assertRaisesRegex(ValueError, "head changed"):
                engine.workflow.seal_snapshot(
                    project, expected_head_digest="project:" + "0" * 64)

            decision = engine.workflow.record_decision(
                project_key=project, action="endorse", decided_by="human",
                actor_id="research-lead", autonomy_mode="checkpointed",
                rationale="The exact baseline is sufficient for internal certification.",
                alternatives=["request_evidence"], evidence_digest=snapshot["digest"],
                confidence=0.9, reversibility="reversible",
            )
            approval = engine.workflow.record_approval(
                project_key=project, decision_id=decision["id"],
                attestor="research-lead", attestation="I accept responsibility.",
            )
            self.assertEqual(approval["projectSnapshot"], snapshot["digest"])
            self.assertEqual(approval["status"], "effective")
            with self.assertRaisesRegex(ValueError, "Agent"):
                engine.workflow.record_approval(
                    project_key=project, decision_id=decision["id"],
                    attestor="agent:reviewer", attestation="Automated sign-off.",
                )
            engine.store.close()


if __name__ == "__main__":
    unittest.main()
