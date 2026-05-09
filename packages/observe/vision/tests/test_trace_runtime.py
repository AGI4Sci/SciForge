from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense import (  # noqa: E402
    CaptureRect,
    StaticPngScreenCaptureProvider,
    TextAgentDecision,
    TraceScreenshotStore,
    VisionAction,
    VisionTaskRequest,
    ScpUploadTarget,
    build_macos_screencapture_command,
    build_scp_command,
    capture_screenshot_to_store,
    png_dimensions,
    run_text_agent_vision_task,
    validate_trace_payload,
)


PNG_1X1_A = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
PNG_1X1_B = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c6360f8ff1f0005fe02fea73581e80000000049454e44ae426082"
)


class TwoStepTextAgent:
    def decide(self, request, screenshot_ref, history):
        if not history:
            return TextAgentDecision(
                done=False,
                reason="focus chat input first",
                screenSummary="SciForge workbench with chat input, send button, result panel, failed diagnostic block.",
                visibleObjects=[
                    {"kind": "chat-input", "ref": screenshot_ref},
                    {"kind": "send-button", "ref": screenshot_ref},
                    {"kind": "result-panel", "ref": screenshot_ref},
                    {"kind": "failed-run-diagnostic", "ref": screenshot_ref},
                ],
                plannedAction=VisionAction(
                    action="click",
                    targetDescription="chat input box",
                    reason="low-risk focus action",
                ),
                grounding={"x": 410, "y": 690, "description": "chat input box"},
                confidence=0.9,
            )
        return {
            "done": True,
            "reason": "stop before send",
            "screenSummary": "Input is the next target; stop before high-risk send.",
            "visibleObjects": [{"kind": "send-button", "ref": screenshot_ref}],
            "plannedAction": {"action": "none", "reason": "do not send"},
            "confidence": 0.95,
        }


class TraceRuntimeTest(unittest.TestCase):
    def test_png_dimensions_reads_header(self):
        self.assertEqual(png_dimensions(PNG_1X1_A), (1, 1))

    def test_store_writes_real_png_and_validates_trace_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = TraceScreenshotStore(tmp, ref_prefix=".sciforge/vision-runs/unit")
            ref = store.write_png("step-000-before.png", PNG_1X1_A)
            self.assertTrue((Path(tmp) / "step-000-before.png").exists())
            self.assertEqual(ref.uri, ".sciforge/vision-runs/unit/step-000-before.png")
            self.assertEqual(ref.width, 1)
            self.assertEqual(ref.height, 1)
            self.assertEqual(len(ref.sha256 or ""), 64)

            validation = validate_trace_payload({"finalScreenshotRef": ref.uri}, store)
            self.assertTrue(validation.ok)
            self.assertEqual(validation.checkedRefs, [ref.uri])

    def test_trace_validation_fails_missing_screenshot_ref(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = TraceScreenshotStore(tmp, ref_prefix=".sciforge/vision-runs/unit")
            validation = validate_trace_payload(
                {"finalScreenshotRef": ".sciforge/vision-runs/unit/missing.png"},
                store,
            )
            self.assertFalse(validation.ok)
            self.assertEqual(validation.missingRefs, [".sciforge/vision-runs/unit/missing.png"])

    def test_capture_provider_materializes_png_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            provider = StaticPngScreenCaptureProvider([PNG_1X1_A])
            store = TraceScreenshotStore(tmp, ref_prefix=".sciforge/vision-runs/capture")
            ref = capture_screenshot_to_store(provider, store, "screen.png")

            self.assertEqual(ref.uri, ".sciforge/vision-runs/capture/screen.png")
            self.assertTrue((Path(tmp) / "screen.png").exists())

    def test_text_agent_runtime_writes_valid_trace_and_real_screenshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            provider = StaticPngScreenCaptureProvider([PNG_1X1_A, PNG_1X1_B])
            result = run_text_agent_vision_task(
                VisionTaskRequest(task="complex low-risk GUI test", maxSteps=2),
                text_agent=TwoStepTextAgent(),
                capture_provider=provider,
                output_dir=tmp,
                ref_prefix=".sciforge/vision-runs/text-agent",
                run_id="text-agent",
            )

            self.assertTrue(result["validation"]["ok"])
            trace = result["trace"]
            self.assertEqual(trace["status"], "succeeded")
            self.assertEqual(trace["metrics"]["stepCount"], 2)
            self.assertEqual(trace["metrics"]["screenshotCount"], 7)
            serialized = json.dumps(trace)
            self.assertNotIn("data:image", serialized)
            self.assertIn("computerUseTextSignal", serialized)
            for ref in result["validation"]["checkedRefs"]:
                path = Path(tmp) / ref.split(".sciforge/vision-runs/text-agent/", 1)[1]
                self.assertTrue(path.exists(), ref)

    def test_macos_screencapture_command_can_target_display_window_or_rect(self):
        self.assertEqual(
            build_macos_screencapture_command("out.png", display_id=2),
            ["screencapture", "-x", "-D2", "out.png"],
        )
        self.assertEqual(
            build_macos_screencapture_command("out.png", window_id=123, display_id=2),
            ["screencapture", "-x", "-l123", "out.png"],
        )
        self.assertEqual(
            build_macos_screencapture_command("out.png", rect=CaptureRect(10, 20, 300, 200), include_cursor=True),
            ["screencapture", "-x", "-C", "-R10,20,300,200", "out.png"],
        )

    def test_scp_upload_command_is_batch_mode_and_port_aware(self):
        command = build_scp_command(
            "/tmp/screen.png",
            ScpUploadTarget(
                host="kv-ground.example.test",
                port=22022,
                user="vision",
                remote_dir="/srv/kv-ground/screens",
            ),
            "screen.png",
        )

        self.assertEqual(command[:5], ["scp", "-P", "22022", "-o", "BatchMode=yes"])
        self.assertEqual(command[-2], "/tmp/screen.png")
        self.assertEqual(
            command[-1],
            "vision@kv-ground.example.test:/srv/kv-ground/screens/screen.png",
        )


if __name__ == "__main__":
    unittest.main()
    build_macos_screencapture_command,
