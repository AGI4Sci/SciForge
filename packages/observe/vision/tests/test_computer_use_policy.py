from __future__ import annotations

import pathlib
import sys
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.computer_use_policy import (  # noqa: E402
    build_default_window_target,
    build_matrix_execution_plan,
    is_planner_only_evidence_task,
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


if __name__ == "__main__":
    unittest.main()
