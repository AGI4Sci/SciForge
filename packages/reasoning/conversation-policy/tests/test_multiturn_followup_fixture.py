from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_conversation.contracts import request_from_json, to_json_dict  # noqa: E402
from sciforge_conversation.service import evaluate_request  # noqa: E402


class MultiTurnFollowupFixtureTest(unittest.TestCase):
    def test_followups_recover_report_file_and_chart_refs_without_polluting_new_tasks(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sciforge-policy-followup-") as workspace:
            root = pathlib.Path(workspace)
            (root / ".sciforge" / "artifacts").mkdir(parents=True)
            (root / ".sciforge" / "task-results").mkdir(parents=True)
            (root / ".sciforge" / "logs").mkdir(parents=True)
            (root / ".sciforge" / "tasks").mkdir(parents=True)
            for rel, payload in {
                ".sciforge/artifacts/report.md": "# Report\nRound one analysis.",
                ".sciforge/artifacts/table.csv": "gene,score\nTP53,0.91\nBRCA1,0.87\n",
                ".sciforge/artifacts/chart.json": json.dumps({"type": "scatter", "points": [[1, 2], [2, 3]]}),
                ".sciforge/task-results/round-one.json": json.dumps({"message": "round one done"}),
                ".sciforge/logs/round-one.stderr.log": "ValueError: missing axis label\n",
                ".sciforge/tasks/round-one.py": "print('round one')\n",
            }.items():
                (root / rel).write_text(payload, encoding="utf-8")

            base_session = _session_with_report_file_and_chart()

            for prompt, expected_mode in [
                ("继续", "continue"),
                ("文件在哪里", "continue"),
                ("基于上一轮补充方法说明", "continue"),
                ("修复上一轮输出里的图表轴标签", "repair"),
            ]:
                response = _evaluate(root, prompt, base_session)
                data = to_json_dict(response)
                self.assertEqual(data["contextPolicy"]["mode"], expected_mode)
                self.assertTrue(data["contextPolicy"]["historyReuse"]["allowed"])
                self.assertGreaterEqual(len(data["contextProjection"]["selectedMessageRefs"]), 1)
                self.assertIn("round-report", _entry_ids(data))
                self.assertIn("round-chart", _entry_ids(data))
                self.assertIn("file:.sciforge/artifacts/report.md", _clickable_refs(data))
                self.assertIn("file:.sciforge/artifacts/chart.json", _clickable_refs(data))

            fresh = _evaluate(root, "请分析一个全新的蛋白序列，不要沿用上一轮", base_session)
            fresh_data = to_json_dict(fresh)
            self.assertEqual(fresh_data["contextPolicy"]["mode"], "isolate")
            self.assertFalse(fresh_data["contextPolicy"]["historyReuse"]["allowed"])
            self.assertEqual(fresh_data["contextProjection"]["selectedMessageRefs"], [])
            self.assertNotIn("round-report", _entry_ids(fresh_data))
            self.assertEqual(fresh_data["artifactIndex"]["entries"], [])
            self.assertIn(
                {"id": "m-report", "reason": "isolated-new-task"},
                fresh_data["contextProjection"]["pollutionGuard"]["excludedHistory"],
            )


def _evaluate(root: pathlib.Path, prompt: str, session: dict[str, object]):
    return evaluate_request(
        request_from_json(
            {
                "schemaVersion": "sciforge.conversation-policy.request.v1",
                "requestId": f"fixture-{abs(hash(prompt))}",
                "turn": {"turnId": "turn-followup", "text": prompt, "refs": []},
                "session": session,
                "workspace": {"root": str(root)},
                "capabilities": [],
                "limits": {"maxInlineChars": 1200},
                "tsDecisions": {},
            }
        )
    )


def _session_with_report_file_and_chart() -> dict[str, object]:
    return {
        "sessionId": "session-followup",
        "scenarioId": "generic-analysis",
        "messages": [
            {
                "id": "m-report",
                "role": "assistant",
                "content": "Generated report, file table, and chart artifacts for round one.",
                "artifactRefs": ["artifact:round-report", "artifact:round-table", "artifact:round-chart"],
            }
        ],
        "runs": [
            {
                "id": "run-round-one",
                "status": "completed",
                "summary": "Round one generated report.md, table.csv, and chart.json.",
                "artifactRefs": ["artifact:round-report", "artifact:round-chart"],
            },
            {
                "id": "run-old-unrelated",
                "status": "completed",
                "summary": "Older unrelated docking workflow.",
                "artifactRefs": ["artifact:old-docking"],
            },
        ],
        "artifacts": [
            {
                "id": "round-report",
                "type": "research-report",
                "title": "Round report",
                "dataRef": ".sciforge/artifacts/report.md",
            },
            {
                "id": "round-table",
                "type": "record-set",
                "title": "Round table",
                "dataRef": ".sciforge/artifacts/table.csv",
            },
            {
                "id": "round-chart",
                "type": "plot-spec",
                "title": "Round chart",
                "dataRef": ".sciforge/artifacts/chart.json",
            },
        ],
        "executionUnits": [
            {
                "id": "unit-round-one",
                "status": "done",
                "tool": "workspace.generated-task",
                "outputRef": ".sciforge/task-results/round-one.json",
                "stderrRef": ".sciforge/logs/round-one.stderr.log",
                "codeRef": ".sciforge/tasks/round-one.py",
            }
        ],
    }


def _entry_ids(data: dict[str, object]) -> set[str]:
    index = data.get("artifactIndex")
    entries = index.get("entries") if isinstance(index, dict) else []
    return {str(item.get("id")) for item in entries if isinstance(item, dict)}


def _clickable_refs(data: dict[str, object]) -> set[str]:
    index = data.get("artifactIndex")
    entries = index.get("entries") if isinstance(index, dict) else []
    return {str(item.get("clickableRef")) for item in entries if isinstance(item, dict) and item.get("clickableRef")}


if __name__ == "__main__":
    unittest.main()
