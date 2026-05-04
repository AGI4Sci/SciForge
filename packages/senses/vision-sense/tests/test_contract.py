import unittest
from dataclasses import asdict, is_dataclass
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense import (
    DEFAULT_MANIFEST,
    KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
    KV_GROUND_URL_ENV,
    GroundingResult,
    PixelDiffResult,
    ScreenshotRef,
    SenseManifest,
    VisionAction,
    VisionStepRecord,
    VisionTaskRequest,
    VisionTaskResult,
    SensePluginTextEnvelope,
)


class VisionSenseContractTest(unittest.TestCase):
    def test_contract_types_are_dataclasses(self):
        for contract in (
            SenseManifest,
            SensePluginTextEnvelope,
            VisionTaskRequest,
            VisionTaskResult,
            VisionStepRecord,
            VisionAction,
            ScreenshotRef,
            GroundingResult,
            PixelDiffResult,
        ):
            self.assertTrue(is_dataclass(contract), contract.__name__)

    def test_manifest_declares_default_vision_contract(self):
        manifest = DEFAULT_MANIFEST

        self.assertEqual(manifest.modality, "vision")
        self.assertEqual(
            manifest.configSchema["vlm"]["defaultModel"],
            "qwen3.6-plus",
        )
        self.assertEqual(
            manifest.configSchema["grounder"]["baseUrlConfig"]["env"],
            KV_GROUND_URL_ENV,
        )
        self.assertEqual(
            manifest.configSchema["grounder"]["remotePathPrefixesConfig"]["env"],
            KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
        )
        self.assertFalse(manifest.runtimeRequirements["privateSciForgeImports"])
        self.assertFalse(manifest.runtimeRequirements["desktopExecutorRequired"])
        self.assertIn("sense_plugin_text_output_contract", manifest.capabilities)
        self.assertIn("text_command_envelope_contract", manifest.capabilities)
        self.assertIn("SensePluginTextResult", manifest.outputs["sensePluginResult"])
        self.assertIn("SensePluginTextEnvelope", manifest.outputs["textEnvelope"])
        self.assertIn("click", manifest.safety["allowedActions"])

    def test_text_envelope_contract_is_generic_text_output(self):
        envelope = SensePluginTextEnvelope(
            kind="code",
            targetUse="analysis",
            text="print('ok')",
            format="text/x-python",
        )

        payload = asdict(envelope)

        self.assertEqual(payload["schemaVersion"], "sciforge.sense-plugin.text.v1")
        self.assertEqual(payload["kind"], "code")
        self.assertEqual(payload["targetUse"], "analysis")
        self.assertEqual(payload["text"], "print('ok')")
        self.assertEqual(payload["format"], "text/x-python")

    def test_request_defaults_are_mvp_safe(self):
        request = VisionTaskRequest(task="Open a low-risk page")

        self.assertEqual(request.maxSteps, 30)
        self.assertFalse(request.riskPolicy["allowHighRiskActions"])
        self.assertEqual(request.grounderConfig, {})
        self.assertEqual(request.screenshotPolicy["maxWaitSeconds"], 8)

    def test_result_trace_serializes_with_standard_library(self):
        before = ScreenshotRef(uri="file:///tmp/before.png", width=100, height=80)
        after = ScreenshotRef(uri="file:///tmp/after.png", width=100, height=80)
        action = VisionAction(action="click", targetDescription="Search input")
        grounding = GroundingResult(
            status="ok",
            textPrompt="Search input",
            x=42,
            y=24,
            imageWidth=100,
            imageHeight=80,
        )
        diff = PixelDiffResult(
            changedPixelRatio=0.01,
            beforeScreenshotRef=before,
            afterScreenshotRef=after,
        )
        step = VisionStepRecord(
            stepIndex=0,
            beforeScreenshotRef=before,
            screenSummary="A browser page with a search input.",
            visibleTexts=[{"text": "Search", "approximateRegion": "top"}],
            completionCheck={"done": False, "reason": "Need to search."},
            plannedAction=action,
            grounding=grounding,
            execution={"status": "ok"},
            afterScreenshotRef=after,
            pixelDiff=diff,
        )
        result = VisionTaskResult(
            status="succeeded",
            reason="Task completed",
            steps=[step],
            finalScreenshotRef=after,
            metrics={"stepCount": 1},
        )

        payload = asdict(result)

        self.assertEqual(payload["steps"][0]["plannedAction"]["action"], "click")
        self.assertEqual(payload["steps"][0]["grounding"]["x"], 42)
        self.assertEqual(payload["finalScreenshotRef"]["uri"], "file:///tmp/after.png")


if __name__ == "__main__":
    unittest.main()
