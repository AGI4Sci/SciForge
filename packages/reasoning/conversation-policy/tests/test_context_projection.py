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
build_context_projection = _load_module("context_projection").build_context_projection


class ContextProjectionTest(unittest.TestCase):
    def test_explicit_reference_filters_stale_history(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "只根据 current.csv 总结。", "references": ["current.csv"]})
        policy = build_context_policy({"prompt": snapshot["rawPrompt"], "goalSnapshot": snapshot})
        plan = build_context_projection(
            {
                "goalSnapshot": snapshot,
                "contextPolicy": policy,
                "session": {
                    "messages": [
                        {"id": "m-old", "role": "assistant", "content": "旧任务结论来自 old.csv", "references": ["old.csv"]},
                        {"id": "m-current", "role": "user", "content": "current.csv 的新增结果", "references": ["current.csv"]},
                    ],
                    "runs": [
                        {"id": "r-old", "status": "done", "summary": "old.csv pipeline"},
                        {"id": "r-current", "status": "done", "summary": "read current.csv", "artifactRefs": ["current.csv"]},
                    ],
                },
            }
        )

        self.assertEqual([message["id"] for message in plan["selectedMessageRefs"]], ["m-current"])
        self.assertEqual([run["id"] for run in plan["selectedRunRefs"]], ["r-current"])
        self.assertIn({"id": "m-old", "reason": "not-current-reference-grounded"}, plan["pollutionGuard"]["excludedHistory"])

    def test_continue_previous_round_keeps_recent_conversation(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "继续上一轮，补充方法部分。"})
        policy = build_context_policy({"prompt": snapshot["rawPrompt"], "goalSnapshot": snapshot})
        plan = build_context_projection(
            {
                "goalSnapshot": snapshot,
                "contextPolicy": policy,
                "session": {"messages": [{"id": "m1", "role": "assistant", "content": "上一轮计划"}]},
            }
        )

        self.assertEqual(plan["mode"], "continue")
        self.assertEqual(plan["selectedMessageRefs"][0]["id"], "m1")
        self.assertEqual(plan["pollutionGuard"]["excludedHistory"], [])

    def test_repair_uses_failed_run_and_removes_inline_image_payloads(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "修复上一轮失败。"})
        policy = build_context_policy({"prompt": snapshot["rawPrompt"], "goalSnapshot": snapshot})
        plan = build_context_projection(
            {
                "goalSnapshot": snapshot,
                "contextPolicy": policy,
                "session": {
                    "runs": [
                        {"id": "r-ok", "status": "done", "summary": "completed"},
                        {"id": "r-fail", "status": "failed", "error": "bad screenshot data:image/png;base64,AAA"},
                    ]
                },
            }
        )

        self.assertEqual([run["id"] for run in plan["selectedRunRefs"]], ["r-fail"])
        self.assertNotIn("data:image", plan["selectedRunRefs"][0]["summary"])
        self.assertNotIn(";base64,", plan["selectedRunRefs"][0]["summary"])


if __name__ == "__main__":
    unittest.main()
