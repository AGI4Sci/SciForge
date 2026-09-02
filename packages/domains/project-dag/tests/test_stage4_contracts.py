from __future__ import annotations

import os
import tempfile
import unittest

from project_dag.contracts import DECISION_POLICY_V1
from project_dag.judge import StubJudge
from project_dag.service import Engine


class Stage4ContractTests(unittest.TestCase):
    def make_engine(self):
        directory = tempfile.TemporaryDirectory()
        engine = Engine(os.path.join(directory.name, "project.db"), directory.name,
                        judge=StubJudge({}))
        self.addCleanup(engine.store.close)
        self.addCleanup(directory.cleanup)
        return engine

    def test_scope_draft_is_not_applied_until_explicit_apply(self):
        engine = self.make_engine()
        workspace = "/workspace/one-project"
        project = "path:" + workspace
        draft = engine.save_scope_draft({
            "workspaceRoot": workspace,
            "currentSessionId": "session-current",
            "actorId": "researcher",
        })
        self.assertEqual(draft["includedSessions"], ["session-current"])
        self.assertEqual(engine.workflow.scope_revisions(project), [])
        self.assertEqual(engine.workflow.scope_draft(project)["baseRevision"], 0)

    def test_project_key_rejects_unbound_project_identity(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            Engine.project_key(project="one-project")

    def test_project_key_requires_matching_absolute_workspace_roots(self):
        self.assertEqual(
            Engine.project_key(workspace_root="/workspace/lab",
                               project_root="/workspace/lab"),
            "path:/workspace/lab",
        )
        with self.assertRaisesRegex(ValueError, "same workspace"):
            Engine.project_key(workspace_root="/workspace/one",
                               project_root="/workspace/two")
        with self.assertRaisesRegex(ValueError, "absolute"):
            Engine.project_key(workspace_root="relative/workspace")

    def test_policy_rules_are_versioned_and_specialized_fails_closed(self):
        engine = self.make_engine()
        project = "path:/workspace/policy"
        policy = engine.workflow.policy(project)
        self.assertEqual(policy["decisionRules"]["public_external"]["quorum"], 1)
        self.assertEqual(policy["decisionRules"]["specialized_high_impact"]["trustedRoleSource"], None)
        with self.assertRaisesRegex(ValueError, "blocked_by_policy"):
            engine.workflow.record_decision(
                project_key=project, action="endorse", decided_by="human",
                actor_id="researcher", autonomy_mode="checkpointed",
                rationale="Specialized review is required.", alternatives=[],
                evidence_digest="project:" + "a" * 64, confidence=1.0,
                reversibility="reversible", action_class="specialized_high_impact",
                policy_ref=DECISION_POLICY_V1,
            )

    def test_agent_cannot_record_a_certified_action(self):
        engine = self.make_engine()
        with self.assertRaisesRegex(ValueError, "accountable human"):
            engine.workflow.record_decision(
                project_key="path:/workspace/agent", action="endorse", decided_by="agent",
                actor_id="agent-1", autonomy_mode="autonomous",
                rationale="Internal draft only.", alternatives=[],
                evidence_digest="project:" + "b" * 64, confidence=1.0,
                reversibility="reversible", action_class="certified_internal",
            )


if __name__ == "__main__":
    unittest.main()
