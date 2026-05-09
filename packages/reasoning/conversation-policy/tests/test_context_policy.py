from __future__ import annotations

import pathlib
import sys
import unittest
import importlib.util


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(PACKAGE_ROOT))

def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(
        f"{name}_under_test",
        PACKAGE_ROOT / "sciforge_conversation" / f"{name}.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_context_policy = _load_module("context_policy").build_context_policy
build_goal_snapshot = _load_module("goal_snapshot").build_goal_snapshot


class ContextPolicyTest(unittest.TestCase):
    def test_new_task_isolates_history_even_when_session_has_prior_goal(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "新任务：分析 current.json。", "references": ["current.json"]})
        policy = build_context_policy(
            {
                "prompt": snapshot["rawPrompt"],
                "goalSnapshot": snapshot,
                "session": {
                    "messages": [
                        {"id": "old", "goalSnapshot": {"rawPrompt": "旧任务：Tabula Sapiens atlas"}}
                    ]
                },
            }
        )

        self.assertEqual(policy["mode"], "isolate")
        self.assertFalse(policy["historyReuse"]["allowed"])
        self.assertTrue(policy["pollutionGuard"]["dropStaleHistory"])
        self.assertEqual(policy["referencePriority"]["explicitReferences"], ["current.json"])

    def test_continue_previous_round_reuses_same_task_recent_context(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "继续上一轮，把报告补完。"})
        policy = build_context_policy({"prompt": snapshot["rawPrompt"], "goalSnapshot": snapshot})

        self.assertEqual(policy["mode"], "continue")
        self.assertTrue(policy["historyReuse"]["allowed"])
        self.assertEqual(policy["historyReuse"]["scope"], "same-task-recent-turns")

    def test_repair_previous_round_uses_failure_scope(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "修复上一轮失败，根据日志重跑。"})
        policy = build_context_policy({"prompt": snapshot["rawPrompt"], "goalSnapshot": snapshot})

        self.assertEqual(policy["mode"], "repair")
        self.assertTrue(policy["repairPolicy"]["includeFailureEvidence"])
        self.assertEqual(policy["historyReuse"]["scope"], "previous-run-and-failure-evidence")


if __name__ == "__main__":
    unittest.main()
