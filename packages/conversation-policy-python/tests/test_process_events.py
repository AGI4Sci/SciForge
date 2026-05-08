from pathlib import Path
import importlib.util
import unittest


MODULE_PATH = Path(__file__).parents[1] / "src" / "sciforge_conversation" / "process_events.py"
spec = importlib.util.spec_from_file_location("process_events", MODULE_PATH)
process_events_module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(process_events_module)


class ProcessEventsTest(unittest.TestCase):
    def test_process_events_tracks_read_write_wait_and_next_step(self):
        result = process_events_module.process_events(
            [
                {
                    "type": "tool-call",
                    "toolName": "read_file",
                    "detail": '{"path":"/workspace/input/papers.csv"}',
                },
                {
                    "type": "tool-call",
                    "toolName": "write_file",
                    "detail": '{"path":"/workspace/tasks/review.py","content":"print(1)"}',
                },
                {
                    "type": "backend-silent",
                    "source": "agentserver",
                    "message": "AgentServer 45s 没有输出新事件，HTTP stream still waiting.",
                },
            ]
        )

        self.assertEqual(result["schemaVersion"], "sciforge.process-events.v1")
        self.assertEqual(result["current"]["phase"], "wait")
        self.assertEqual(result["current"]["waitingFor"], "AgentServer 返回")
        self.assertIn("下一步", result["summary"])
        self.assertEqual(result["timeline"][0]["reading"], ["/workspace/input/papers.csv"])
        self.assertEqual(result["timeline"][1]["writing"], ["/workspace/tasks/review.py"])
        self.assertTrue(all(event["type"] == "process-progress" for event in result["events"]))

    def test_process_events_prefers_active_step_over_completed_step(self):
        result = process_events_module.process_events(
            {
                "events": [
                    {"type": "stage-start", "message": "下一步：读取 stderr 并修复入口参数。"},
                    {"type": "tool-result", "status": "completed", "message": "write_file completed"},
                ]
            }
        )

        self.assertEqual(result["current"]["phase"], "plan")
        self.assertEqual(result["current"]["nextStep"], "下一步：读取 stderr 并修复入口参数。")

    def test_process_events_marks_failures_as_blocking(self):
        result = process_events_module.process_events(
            [
                {
                    "type": "tool-result",
                    "output": "Traceback: FileNotFoundError: missing /workspace/tasks/review.py",
                }
            ]
        )

        self.assertEqual(result["current"]["phase"], "error")
        self.assertEqual(result["current"]["status"], "failed")
        self.assertEqual(result["events"][0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
