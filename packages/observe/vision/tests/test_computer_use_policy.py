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
    is_high_risk_gui_request,
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

    def test_high_risk_request_uses_semantic_action_signal(self) -> None:
        self.assertTrue(is_high_risk_gui_request("Confirm the visible payment to complete the purchase."))
        self.assertTrue(is_high_risk_gui_request("Approve access for the external authorization dialog."))
        self.assertFalse(is_high_risk_gui_request("Read the confirmation dialog and do not approve anything."))
        self.assertFalse(is_high_risk_gui_request("Inspect the approval screen without confirming the purchase."))
        self.assertFalse(is_high_risk_gui_request("Read the checkout prompt and do not authorize or pay."))
        self.assertFalse(is_high_risk_gui_request("Describe the checkout screen without purchasing."))
        self.assertFalse(is_high_risk_gui_request("Inspect the Submit button label without clicking it."))
        self.assertFalse(is_high_risk_gui_request("Describe where the Delete button is; do not press it."))

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

    def test_screenshot_grounded_creation_does_not_trigger_window_recovery_completion(self) -> None:
        steps = [
            _done_step({"type": "click", "targetDescription": "title placeholder"}),
            _done_step({"type": "type_text", "text": "SciForge Computer Use Acceptance"}),
            _done_step({"type": "click", "targetDescription": "subtitle placeholder"}),
        ]

        result = action_ledger_completion(
            "Create a PowerPoint slide. Use screenshot-grounded Computer Use only.",
            steps,
        )

        self.assertFalse(result["complete"])

    def test_creation_completion_rejects_browser_navigation_before_editor_content(self) -> None:
        steps = [
            _done_step(
                {"type": "click", "targetDescription": "address bar"},
                app_name="Microsoft Edge",
            ),
            _done_step(
                {"type": "type_text", "text": "http://127.0.0.1:18082/source-page.html"},
                app_name="Microsoft Edge",
            ),
            _done_step(
                {"type": "open_app", "appName": "Microsoft PowerPoint"},
                app_name="Microsoft PowerPoint",
            ),
        ]

        result = action_ledger_completion(
            "Create a PowerPoint slide from a browser source page.",
            steps,
        )

        self.assertFalse(result["complete"])

    def test_creation_completion_requires_requested_fact_body_not_title_only(self) -> None:
        steps = [
            _done_step({"type": "open_app", "appName": "Microsoft PowerPoint"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint title placeholder"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "type_text", "text": "SciForge L3 Computer Use Acceptance"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint body placeholder"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint slide content area"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint slide content area"}, app_name="Microsoft PowerPoint"),
        ]

        result = action_ledger_completion(
            "Create one slide containing three visible source facts.",
            steps,
        )

        self.assertFalse(result["complete"])

    def test_creation_completion_rejects_rich_slide_structure_only_fallback(self) -> None:
        steps = [
            _done_step({"type": "open_app", "appName": "Microsoft PowerPoint"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint title placeholder"}, app_name="Microsoft PowerPoint"),
            _done_step(
                {"type": "type_text", "text": "SciForge L3 Computer Use Acceptance"},
                app_name="Microsoft PowerPoint",
                no_effect=True,
            ),
            _done_step({"type": "click", "targetDescription": "PowerPoint body placeholder"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint slide content area"}, app_name="Microsoft PowerPoint"),
            _done_step({"type": "click", "targetDescription": "PowerPoint slide content area"}, app_name="Microsoft PowerPoint"),
        ]

        result = action_ledger_completion(
            "Create a PowerPoint slide with three source facts as body bullets.",
            steps,
        )

        self.assertFalse(result["complete"])

    def test_action_ledger_completion_keeps_explicit_window_recovery(self) -> None:
        steps = [
            _done_step({"type": "open_app", "appName": "PowerPoint"}),
            _done_step({"type": "click", "targetDescription": "restore target window button"}),
        ]

        result = action_ledger_completion("Recover the target window after occlusion", steps)

        self.assertTrue(result["complete"])
        self.assertEqual(result["kind"], "window-recovery")

    def test_file_manager_completion_accepts_preselected_finder_window(self) -> None:
        steps = [
            _done_step({"type": "click", "targetDescription": "Finder download file list"}, app_name="Finder"),
            _done_step({"type": "click", "targetDescription": "new folder menu item in Finder"}, app_name="Finder"),
            _done_step({"type": "press_key", "key": "Enter"}, app_name="Finder"),
            _done_step({"type": "double_click", "targetDescription": "test folder in Finder file list"}, app_name="Finder"),
        ]

        result = action_ledger_completion(
            "Use the file manager to create or enter a low-risk test folder and record file list refs.",
            steps,
        )

        self.assertTrue(result["complete"])
        self.assertEqual(result["kind"], "file-manager")

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


def _done_step(action: dict[str, object], *, no_effect: bool = False, app_name: str | None = None) -> dict[str, object]:
    return {
        "kind": "gui-execution",
        "status": "done",
        "plannedAction": action,
        "windowTarget": {"appName": app_name} if app_name else {},
        "verifier": {"pixelDiff": {"possiblyNoEffect": no_effect}},
    }


if __name__ == "__main__":
    unittest.main()
