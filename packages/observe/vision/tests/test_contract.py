import unittest
import importlib.util
from dataclasses import asdict, is_dataclass
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

import sciforge_vision_sense as vision_sense  # noqa: E402
from sciforge_vision_sense import (  # noqa: E402
    DEFAULT_MANIFEST,
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
            manifest.configSchema["modelRouter"]["groundingTranslatorCapability"],
            "model-router.capability.computer-use.grounding-translator",
        )
        self.assertNotIn("grounder", manifest.configSchema)
        self.assertNotIn("grounderRequest", manifest.inputs)
        self.assertNotIn("grounderResult", manifest.outputs)
        self.assertNotIn("kvGround", manifest.runtimeRequirements)
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

    def test_public_api_does_not_export_direct_grounder_adapter(self):
        manifest = DEFAULT_MANIFEST
        retired_contract = "_".join(["kv", "ground", "contract"])
        retired_module = ".".join(["sciforge_vision_sense", "_".join(["kv", "ground"])])
        retired_export_pattern = "|".join([
            "".join(["Kv", "Ground"]),
            "Grounder",
            "_".join(["KV", "GROUND"]),
        ])

        self.assertNotIn(retired_contract, manifest.capabilities)
        self.assertIsNone(importlib.util.find_spec(retired_module))
        for name in vision_sense.__all__:
            self.assertNotRegex(name, rf"(?:{retired_export_pattern})")

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
