"""Tests for multiturn continuation logic in goal_snapshot and service pipeline.

Covers:
- MT-001: _infer_task_relation with has_prior_context=True defaults to "continue"
- MT-002: Full policy via batch bridge returns context_mode='continue' for continue turns
- MT-003: Backward-compatibility of existing task relation cases
"""

from __future__ import annotations

import pathlib
import sys
import time
import unittest

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_conversation.goal_snapshot import (
    _infer_task_relation,
    _has_prior_context,
    build_goal_snapshot,
)


class InferTaskRelationMultiturnTest(unittest.TestCase):
    """MT-001: _infer_task_relation must default to 'continue' when has_prior_context=True."""

    def test_natural_followup_with_prior_context_is_continue(self) -> None:
        """No keyword, no refs, but prior session context → must be 'continue'."""
        result = _infer_task_relation("Can you explain more?", False, True)
        self.assertEqual(result, "continue", "Natural follow-up with prior context should be 'continue'")

    def test_natural_followup_no_prior_context_is_new_task(self) -> None:
        """No keyword, no refs, no prior context → 'new-task'."""
        result = _infer_task_relation("What is KRAS?", False, False)
        self.assertEqual(result, "new-task")

    def test_explicit_refs_with_prior_context_is_continue(self) -> None:
        """User selects a specific artifact from prior session → continuation with scope."""
        result = _infer_task_relation("Tell me more about this result", True, True)
        self.assertEqual(result, "continue", "Explicit refs with prior context should be 'continue'")

    def test_explicit_refs_no_prior_context_is_new_task(self) -> None:
        """Explicit refs but no prior context (first turn with refs) → 'new-task'."""
        result = _infer_task_relation("Summarize this file", True, False)
        self.assertEqual(result, "new-task")

    def test_explicit_new_task_keyword_overrides_prior_context(self) -> None:
        result = _infer_task_relation("New task: analyze X", False, True)
        self.assertEqual(result, "new-task")

    def test_continue_keyword_is_continue(self) -> None:
        result = _infer_task_relation("继续上一轮任务", False, True)
        self.assertEqual(result, "continue")

    def test_repair_keyword_with_prior_context_is_repair(self) -> None:
        result = _infer_task_relation("修复之前的错误", False, True)
        self.assertEqual(result, "repair")

    def test_chinese_followup_without_keyword_with_prior_context_is_continue(self) -> None:
        """A common real-world case: no explicit continue keyword in Chinese second turn."""
        result = _infer_task_relation("能进一步解释一下 RAS 通路的机制吗？", False, True)
        self.assertEqual(result, "continue", "Chinese follow-up without keyword, prior context → 'continue'")

    def test_english_elaboration_with_prior_context_is_continue(self) -> None:
        result = _infer_task_relation("Can you elaborate on the pathway mechanisms?", False, True)
        self.assertEqual(result, "continue")

    def test_question_about_results_with_prior_context_is_continue(self) -> None:
        result = _infer_task_relation("What does this mean for treatment options?", False, True)
        self.assertEqual(result, "continue")


class HasPriorContextTest(unittest.TestCase):
    """_has_prior_context should detect any non-empty session field."""

    def test_empty_session_has_no_prior_context(self) -> None:
        req = {"session": {"messages": [], "runs": [], "artifacts": [], "executionUnits": []}}
        self.assertFalse(_has_prior_context(req))

    def test_messages_signal_prior_context(self) -> None:
        req = {"session": {"messages": [{"id": "m1", "role": "user"}], "runs": [], "artifacts": [], "executionUnits": []}}
        self.assertTrue(_has_prior_context(req))

    def test_runs_signal_prior_context(self) -> None:
        req = {"session": {"messages": [], "runs": [{"id": "r1"}], "artifacts": [], "executionUnits": []}}
        self.assertTrue(_has_prior_context(req))

    def test_artifacts_signal_prior_context(self) -> None:
        req = {"session": {"messages": [], "runs": [], "artifacts": [{"id": "artifact:report"}], "executionUnits": []}}
        self.assertTrue(_has_prior_context(req))


class GoalSnapshotContinuationTest(unittest.TestCase):
    """build_goal_snapshot integration: with prior context → taskRelation='continue'."""

    def test_second_turn_no_keyword_has_continue_relation(self) -> None:
        snapshot = build_goal_snapshot({
            "prompt": "Can you elaborate on the pathway mechanisms?",
            "references": [],
            "session": {
                "messages": [{"id": "m1", "role": "user"}, {"id": "m2", "role": "assistant"}],
                "runs": [{"id": "r1", "status": "completed"}],
                "artifacts": [{"id": "artifact:report"}],
                "executionUnits": [],
            },
        })
        self.assertEqual(snapshot["taskRelation"], "continue",
                         "Second turn without keyword but with prior session should be 'continue'")
        self.assertIn("continue-from-relevant-prior-state", snapshot["acceptanceCriteria"])
        self.assertTrue(snapshot["referencePolicy"]["allowHistoryFallback"])

    def test_first_turn_no_prior_context_is_new_task(self) -> None:
        snapshot = build_goal_snapshot({
            "prompt": "What is KRAS G12D mutation?",
            "references": [],
            "session": {"messages": [], "runs": [], "artifacts": [], "executionUnits": []},
        })
        self.assertEqual(snapshot["taskRelation"], "new-task")


class PolicyBatchSpeedTest(unittest.TestCase):
    """MT-002: Full policy batch should complete well under the 8000ms gateway timeout."""

    def test_fresh_turn_completes_under_2000ms(self) -> None:
        from sciforge_conversation.service import handle_payload
        payload = {
            "schemaVersion": "sciforge.conversation-policy.request.v1",
            "turn": {"prompt": "What is KRAS G12D mutation?", "references": []},
            "session": {"sessionId": "speed-fresh", "scenarioId": "literature",
                        "messages": [], "runs": [], "artifacts": [], "executionUnits": []},
            "workspace": {"root": "/tmp"},
            "capabilities": [],
            "limits": {},
        }
        t0 = time.time()
        result = handle_payload(payload)
        elapsed_ms = (time.time() - t0) * 1000
        self.assertLess(elapsed_ms, 2000,
                        f"Fresh policy took {elapsed_ms:.0f}ms; must be < 2000ms (batch approach)")
        self.assertIn("contextPolicy", result)

    def test_continue_turn_completes_under_2000ms(self) -> None:
        from sciforge_conversation.service import handle_payload
        payload = {
            "schemaVersion": "sciforge.conversation-policy.request.v1",
            "turn": {"prompt": "Can you elaborate on the pathway mechanisms?",
                     "references": [{"ref": "artifact:prior-report", "title": "Prior report"}]},
            "session": {
                "sessionId": "speed-continue",
                "scenarioId": "literature",
                "messages": [{"id": "m1", "role": "user"}, {"id": "m2", "role": "assistant"}],
                "runs": [{"id": "r1", "status": "completed"}],
                "artifacts": [{"id": "artifact:prior-report", "type": "research-report"}],
                "executionUnits": [],
                "contextReusePolicy": {"mode": "continue", "historyReuse": {"allowed": True}},
            },
            "workspace": {"root": "/tmp"},
            "capabilities": [],
            "limits": {},
        }
        t0 = time.time()
        result = handle_payload(payload)
        elapsed_ms = (time.time() - t0) * 1000
        self.assertLess(elapsed_ms, 2000,
                        f"Continue policy took {elapsed_ms:.0f}ms; must be < 2000ms (batch approach)")
        ctx = result.get("contextPolicy", {})
        self.assertEqual(ctx.get("mode"), "continue",
                         "Continue turn must return contextPolicy.mode='continue'")

    def test_continue_turn_context_mode_is_continue(self) -> None:
        """MT-001 + MT-002 combined: batch returns mode='continue' for second-turn follow-up."""
        from sciforge_conversation.service import handle_payload
        payload = {
            "schemaVersion": "sciforge.conversation-policy.request.v1",
            "turn": {"prompt": "What does this mean for treatment options?", "references": []},
            "session": {
                "sessionId": "multiturn-mode",
                "scenarioId": "literature",
                "messages": [{"id": "m1", "role": "user"}, {"id": "m2", "role": "assistant"}],
                "runs": [{"id": "r1", "status": "completed"}],
                "artifacts": [{"id": "artifact:report", "type": "research-report"}],
                "executionUnits": [{"id": "eu1", "tool": "sciforge.literature", "status": "done"}],
            },
            "workspace": {"root": "/tmp"},
            "capabilities": [],
            "limits": {},
        }
        result = handle_payload(payload)
        ctx = result.get("contextPolicy", {})
        self.assertEqual(ctx.get("mode"), "continue",
                         "Natural follow-up with prior context must return contextPolicy.mode='continue' (MT-001 fix)")


if __name__ == "__main__":
    unittest.main()
