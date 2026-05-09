from __future__ import annotations

import pathlib
import sys
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.computer_use_policy import (  # noqa: E402
    action_ledger_completion,
    build_default_window_target,
    build_matrix_execution_plan,
    is_planner_only_evidence_task,
    rewrite_planner_action,
    should_tolerate_dense_ui_no_effect_action,
    visible_artifact_completion_gap,
)


class ComputerUsePolicyTest(unittest.TestCase):
    def test_planner_only_evidence_task_matches_trace_ref_requests(self) -> None:
        self.assertTrue(is_planner_only_evidence_task("Summarize trace refs, sha256, and action ledger only"))
        self.assertTrue(is_planner_only_evidence_task("汇总截图引用和失败诊断"))
        self.assertTrue(is_planner_only_evidence_task("总结 screenshot refs 和 action ledger。\nFail closed before high-risk click actions."))
        self.assertTrue(is_planner_only_evidence_task("refs-only final screen acceptance report; do not perform GUI actions"))
        self.assertFalse(is_planner_only_evidence_task("Click the Save button in the target window"))
        self.assertFalse(is_planner_only_evidence_task("Summarize trace refs, then click the visible result"))

    def test_matrix_plan_serializes_real_gui_and_parallelizes_dry_run(self) -> None:
        real = build_matrix_execution_plan(dry_run=False, scenario_count=10, requested_max_concurrency=4)
        dry = build_matrix_execution_plan(dry_run=True, scenario_count=10, requested_max_concurrency=3)

        self.assertEqual(real.mode, "serialized-real-gui")
        self.assertEqual(real.maxConcurrency, 1)
        self.assertEqual(dry.mode, "parallel-analysis")
        self.assertEqual(dry.maxConcurrency, 3)
        self.assertTrue(dry.realGuiSerialized)

    def test_default_window_target_uses_stable_dry_run_window(self) -> None:
        target = build_default_window_target(
            scenario_id="CU-LONG-006",
            run_id="fixture",
            round_number=2,
            dry_run=True,
        )

        self.assertEqual(target["mode"], "window-id")
        self.assertEqual(target["windowId"], 84002)
        self.assertEqual(target["coordinateSpace"], "window")

    def test_action_ledger_completion_matches_candidate_screening(self) -> None:
        steps = [
            _done_step({"type": "click", "targetDescription": "first evidence result link"}),
            _done_step({"type": "double_click", "targetDescription": "candidate article title"}),
            _done_step({"type": "click", "targetDescription": "third evidence article"}),
        ]

        result = action_ledger_completion("candidate evidence screening", steps)

        self.assertTrue(result["complete"])
        self.assertEqual(result["kind"], "candidate-evidence-screening")

    def test_action_ledger_completion_matches_creation_gap(self) -> None:
        incomplete_steps = [_done_step({"type": "open_app", "appName": "Microsoft PowerPoint"})]

        gap = visible_artifact_completion_gap("Create a slide with a title and body text", incomplete_steps)

        self.assertIn("Visible artifact task did not satisfy completion acceptance", gap)

    def test_rewrite_policy_moves_repeated_chat_text_to_submit(self) -> None:
        steps = [_done_step({"type": "type_text", "text": "missing refs", "targetDescription": "chat input"})]

        action = rewrite_planner_action(
            {"type": "type_text", "text": "missing refs", "targetDescription": "chat input"},
            desktop_platform="darwin",
            steps=steps,
            task="Trigger a low-risk expected failure in the chat input",
        )

        self.assertEqual(action["type"], "press_key")
        self.assertEqual(action["key"], "Enter")

    def test_rewrite_policy_turns_repeated_app_switch_into_open_app(self) -> None:
        action = rewrite_planner_action(
            {"type": "hotkey", "keys": ["Command", "Tab"], "targetDescription": "Finder window"},
            desktop_platform="darwin",
            steps=[],
            task="Open Finder",
        )

        self.assertEqual(action["type"], "open_app")
        self.assertEqual(action["appName"], "Finder")

    def test_dense_ui_no_effect_tolerance_is_route_scoped(self) -> None:
        steps = [
            _done_step(
                {"type": "click", "targetDescription": "Cancel button"},
                no_effect=True,
            )
        ]

        self.assertFalse(
            should_tolerate_dense_ui_no_effect_action(
                "Low-risk settings controls; do not submit",
                [*steps, _done_step({"type": "click", "targetDescription": "Cancel button"})],
                {"type": "click", "targetDescription": "Cancel button"},
            )
        )
        self.assertTrue(
            should_tolerate_dense_ui_no_effect_action(
                "Low-risk settings controls; do not submit",
                [*steps, _done_step({"type": "click", "targetDescription": "Close button"})],
                {"type": "click", "targetDescription": "Close button"},
            )
        )


def _done_step(action: dict[str, object], *, no_effect: bool = False) -> dict[str, object]:
    return {
        "kind": "gui-execution",
        "status": "done",
        "plannedAction": action,
        "verifier": {"pixelDiff": {"possiblyNoEffect": no_effect}},
    }


if __name__ == "__main__":
    unittest.main()
