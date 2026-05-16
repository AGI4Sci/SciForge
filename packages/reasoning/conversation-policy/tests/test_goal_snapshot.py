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

    def test_fresh_failure_reporting_request_does_not_inherit_repair_context(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "prompt": (
                    "请用最小检索验证 arXiv 是否可访问：搜索 CRISPR prime editing review，"
                    "返回 3 篇候选论文标题和来源；如果外部 provider 不可用，"
                    "请给出可恢复失败原因，不要编造结果。"
                ),
                "session": {
                    "messages": [],
                    "executionUnits": [],
                    "runs": [],
                    "artifacts": [],
                },
            }
        )

        self.assertEqual(snapshot["taskRelation"], "new-task")
        self.assertNotEqual(snapshot["goalType"], "repair")
        self.assertIn("do-not-import-stale-prior-task-assumptions", snapshot["acceptanceCriteria"])
        self.assertNotIn("freshness", snapshot)

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

    def test_current_named_artifact_only_emits_context_only_constraints(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "prompt": "Continue from the current memo artifact only. Summarize the risks.",
                "session": {"artifacts": [{"id": "memo-1"}]},
            }
        )

        self.assertEqual(snapshot["taskRelation"], "continue")
        self.assertEqual(snapshot["turnExecutionConstraints"]["executionModeHint"], "direct-context-answer")
        self.assertTrue(snapshot["turnExecutionConstraints"]["agentServerForbidden"])

    def test_answer_only_continuation_transform_emits_direct_context_constraints(self) -> None:
        snapshot = build_goal_snapshot(
            {
                "prompt": (
                    "Continue previous answer: compress the three points into one checklist "
                    "and explicitly reuse the previous conclusion. No new search, no code."
                ),
                "session": {
                    "messages": [{"id": "msg-prior", "role": "scenario"}],
                    "runs": [{"id": "run-prior", "status": "completed"}],
                    "artifacts": [{"id": "research-report"}],
                },
            }
        )

        self.assertEqual(snapshot["taskRelation"], "continue")
        self.assertEqual(snapshot["turnExecutionConstraints"]["executionModeHint"], "direct-context-answer")
        self.assertTrue(snapshot["turnExecutionConstraints"]["agentServerForbidden"])
        self.assertIn(
            "answer-only continuation transform can be satisfied from prior Projection/refs",
            snapshot["turnExecutionConstraints"]["reasons"],
        )

    def test_profile_intent_keyword_map_controls_intent_classification(self) -> None:
        request = {
            "prompt": "Please craft a dossier from the current notes.",
            "profile": {
                "intentKeywordMap": {
                    "report": [{"keywords": ["dossier"]}],
                    "continue": [{"keywords": ["current notes"]}],
                }
            },
            "session": {"messages": [{"id": "msg-prior", "role": "assistant"}]},
        }
        without_profile = build_goal_snapshot({
            "prompt": request["prompt"],
            "session": request["session"],
        })
        with_profile = build_goal_snapshot(request)

        self.assertEqual(without_profile["goalType"], "analysis")
        self.assertEqual(with_profile["goalType"], "report")
        self.assertEqual(with_profile["taskRelation"], "continue")


if __name__ == "__main__":
    unittest.main()
