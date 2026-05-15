from __future__ import annotations

import pathlib
import sys
import unittest
import importlib.util


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(PACKAGE_ROOT))

_GOAL_SPEC = importlib.util.spec_from_file_location(
    "goal_snapshot_under_test",
    PACKAGE_ROOT / "sciforge_conversation" / "goal_snapshot.py",
)
assert _GOAL_SPEC and _GOAL_SPEC.loader
_GOAL_MODULE = importlib.util.module_from_spec(_GOAL_SPEC)
_GOAL_SPEC.loader.exec_module(_GOAL_MODULE)
build_goal_snapshot = _GOAL_MODULE.build_goal_snapshot


class GoalSnapshotTest(unittest.TestCase):
    def test_new_task_with_explicit_refs_prioritizes_current_references(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "turnId": "t-2",
                "prompt": "新任务：只根据 reports/current.csv 写 Markdown 总结，不要沿用上一轮。",
                "references": [{"path": "reports/current.csv"}],
            }
        )

        self.assertEqual(snapshot["taskRelation"], "new-task")
        self.assertEqual(snapshot["requiredReferences"], ["reports/current.csv"])
        self.assertTrue(snapshot["referencePolicy"]["explicitReferencesFirst"])
        self.assertFalse(snapshot["referencePolicy"]["allowHistoryFallback"])
        self.assertIn("do-not-import-stale-prior-task-assumptions", snapshot["acceptanceCriteria"])

    def test_continue_and_repair_are_distinct_goal_relations(self) -> None:
        continuation = build_goal_snapshot({"prompt": "继续上一轮，补齐 marker gene 表格。"})
        repair = build_goal_snapshot({"prompt": "读取上一轮日志，修复失败后重跑。"})

        self.assertEqual(continuation["taskRelation"], "continue")
        self.assertEqual(repair["taskRelation"], "repair")
        self.assertEqual(repair["goalType"], "repair")
        self.assertEqual(repair["freshness"]["kind"], "prior-run")

    def test_pure_multiturn_recall_is_continuation(self) -> None:
        snapshot = build_goal_snapshot({"prompt": "你还记得我一开始问的问题吗？"})

        self.assertEqual(snapshot["taskRelation"], "continue")
        self.assertTrue(snapshot["referencePolicy"]["allowHistoryFallback"])

    def test_missing_contract_fields_are_treated_as_empty_compat_values(self) -> None:
        # T093 explicitly asked not to modify contracts.py. Until contract fields
        # are finalized, module inputs may omit turnId/references/session fields.
        snapshot = build_goal_snapshot({"message": "分析这段结果并给出结论。"})

        self.assertEqual(snapshot["turnId"], "current-turn")
        self.assertEqual(snapshot["requiredReferences"], [])
        self.assertEqual(snapshot["taskRelation"], "new-task")

    def test_scoped_no_rerun_repair_continuation_does_not_forbid_execution(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "prompt": (
                    "请复用这次失败诊断继续，不要重跑无关步骤；修正生成任务，"
                    "必须使用 SciForge 已解析的 web_search/web_fetch provider route，"
                    "然后继续完成中文证据摘要。"
                ),
                "session": {
                    "executionUnits": [{"id": "EU-prior", "status": "repair-needed"}],
                    "runs": [{"id": "run-prior", "status": "repair-needed"}],
                },
            }
        )

        self.assertEqual(snapshot["taskRelation"], "repair")
        self.assertNotIn("turnExecutionConstraints", snapshot)

    def test_global_no_execution_still_emits_turn_constraints(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "prompt": "不要重跑、不要执行、不要调用 AgentServer，只基于当前 refs 回答。",
                "references": [{"ref": "artifact:prior-diagnostic"}],
            }
        )

        self.assertEqual(snapshot["turnExecutionConstraints"]["executionModeHint"], "direct-context-answer")
        self.assertTrue(snapshot["turnExecutionConstraints"]["workspaceExecutionForbidden"])


if __name__ == "__main__":
    unittest.main()
