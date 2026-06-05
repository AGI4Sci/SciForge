import unittest
from dataclasses import asdict, is_dataclass
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense import (  # noqa: E402
    DEFAULT_MANIFEST,
    KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
    KV_GROUND_URL_ENV,
    ModalityInput,
    ScreenshotRef,
    SenseManifest,
    SensePluginRequest,
    SensePluginTextEnvelope,
    SensePluginTextResult,
)


class VisionSenseContractTest(unittest.TestCase):
    def test_contract_types_are_sense_only_dataclasses(self):
        for contract in (
            SenseManifest,
            ModalityInput,
            SensePluginRequest,
            SensePluginTextResult,
            SensePluginTextEnvelope,
            ScreenshotRef,
        ):
            self.assertTrue(is_dataclass(contract), contract.__name__)

    def test_manifest_declares_sense_only_vision_contract(self):
        manifest = DEFAULT_MANIFEST

        self.assertEqual(manifest.modality, "vision")
        self.assertEqual(manifest.configSchema["vlm"]["defaultModel"], "sciforge-router")
        self.assertEqual(
            manifest.configSchema["grounder"]["kind"],
            "model-router.capability.computer-use.grounding-translator",
        )
        self.assertEqual(manifest.configSchema["grounder"]["baseUrlConfig"]["env"], KV_GROUND_URL_ENV)
        self.assertEqual(
            manifest.configSchema["grounder"]["remotePathPrefixesConfig"]["env"],
            KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
        )
        self.assertEqual(manifest.configSchema["grounder"]["contract"], "GrounderRequest -> GrounderResult")
        self.assertNotIn("predictEndpoint", manifest.configSchema["grounder"])
        self.assertFalse(manifest.runtimeRequirements["privateSciForgeImports"])
        self.assertFalse(manifest.runtimeRequirements["desktopExecutorRequired"])
        self.assertEqual(
            manifest.runtimeRequirements["computerUseExecutor"],
            "packages/actions/computer-use action provider",
        )
        self.assertIn("sense_plugin_text_output_contract", manifest.capabilities)
        self.assertNotIn("visual_action_planning_contract", manifest.capabilities)
        self.assertNotIn("computer_use_command_contract", manifest.capabilities)
        self.assertNotIn("request", manifest.inputs)
        self.assertNotIn("result", manifest.outputs)
        self.assertEqual(manifest.safety["executionBoundary"], "sensing-only")

    def test_manifest_declares_first_class_grounder_contract(self):
        manifest = DEFAULT_MANIFEST

        request_contract = manifest.inputs["grounderRequest"]
        result_contract = manifest.outputs["grounderResult"]

        self.assertEqual(request_contract["schema"], "GrounderRequest")
        self.assertEqual(
            request_contract["required"],
            {
                "screenshot_ref": "ScreenshotRef URI or service-readable screenshot reference",
                "target_description": "Natural-language description of the target to ground",
            },
        )
        self.assertEqual(request_contract["optional"]["crop_bbox"], "Window-local crop bounds as [x1, y1, x2, y2]")
        self.assertEqual(request_contract["coordinate_space"]["allowed"], ["window-local", "crop-local"])
        self.assertEqual(request_contract["coordinate_space"]["default"], "window-local")
        self.assertEqual(request_contract["coordinate_space"]["cropLocalRequires"], "crop_bbox")

        self.assertEqual(result_contract["schema"], "GrounderResult")
        self.assertIn("window_local_coordinates", result_contract["required"])
        self.assertIn("diagnostics", result_contract["required"])
        self.assertEqual(
            result_contract["required"]["coordinate_space"],
            "Normalized request coordinate space: window-local or crop-local",
        )
        self.assertIn("crop_local_coordinates", result_contract["optional"])
        self.assertIn("confidence", result_contract["optional"])
        self.assertIn("raw_text", result_contract["optional"])

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

    def test_sense_plugin_result_serializes_with_standard_library(self):
        result = SensePluginTextResult(
            text="Visible target: Upload button near the upper-right toolbar.",
            modality="vision",
            artifacts=[{"type": "vision-trace", "ref": ".sciforge/vision-runs/run-001/vision-trace.json"}],
        )

        payload = asdict(result)

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["modality"], "vision")
        self.assertEqual(payload["artifacts"][0]["type"], "vision-trace")


if __name__ == "__main__":
    unittest.main()
