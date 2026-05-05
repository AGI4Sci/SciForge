from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.visual_memory import (  # noqa: E402
    VisionMemoryTraceInput,
    build_visual_memory_block,
)


class VisualMemoryTest(unittest.TestCase):
    def test_visual_memory_block_is_file_ref_only_and_budgeted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            trace_path = pathlib.Path(tmp) / "vision-trace.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "config": {
                            "windowTarget": {
                                "windowId": 42,
                                "coordinateSpace": "window",
                                "bounds": {"x": 0, "y": 0, "width": 1000, "height": 800},
                            }
                        },
                        "scheduler": {
                            "lockId": "lock-1",
                            "lockScope": "target-window",
                            "focusPolicy": "require-focused-target",
                            "interferenceRisk": "low",
                        },
                        "imageMemory": {
                            "policy": "file-ref-only",
                            "refs": [
                                {
                                    "path": "before.png",
                                    "sha256": "a" * 64,
                                    "width": 1000,
                                    "height": 800,
                                    "displayId": 1,
                                    "captureScope": "window",
                                },
                                {
                                    "path": "focus.png",
                                    "sha256": "b" * 64,
                                    "width": 96,
                                    "height": 80,
                                    "displayId": 1,
                                    "captureScope": "focus-region",
                                    "focusRegion": {
                                        "sourceScreenshotRef": "before.png",
                                        "x": 10,
                                        "y": 20,
                                        "width": 96,
                                        "height": 80,
                                    },
                                },
                            ],
                        },
                        "steps": [
                            {
                                "kind": "gui-execution",
                                "status": "done",
                                "plannedAction": {"type": "click"},
                                "verifier": {
                                    "planningFeedback": "pixel=no-visible-effect | focus=bbox(10,20,96,80)",
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            block = build_visual_memory_block(
                [VisionMemoryTraceInput(path=str(trace_path), ref="evidence/round-01/vision-trace.json", label="round 1")],
                char_budget=2000,
            )

        self.assertEqual(block.policy, "file-ref-only")
        self.assertEqual(block.traceCount, 1)
        self.assertEqual(block.screenshotRefCount, 1)
        self.assertEqual(block.focusRefCount, 1)
        self.assertIn("trace=evidence/round-01/vision-trace.json", block.text)
        self.assertIn("screenshotMeta: before.png", block.text)
        self.assertIn("focusMeta: focus.png", block.text)
        self.assertIn("verifierFeedback: click: status=done", block.text)
        self.assertNotIn("data:image", block.text)
        self.assertNotIn(";base64,", block.text.lower())


if __name__ == "__main__":
    unittest.main()
