import importlib
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

import sciforge_vision_sense as vision_sense  # noqa: E402
from sciforge_vision_sense import build_sense_plugin_request  # noqa: E402


class ComputerUseBoundaryDeletionTest(unittest.TestCase):
    def test_sense_request_builder_is_text_and_modality_only(self):
        request = build_sense_plugin_request(
            "Describe the Upload button for an external action provider.",
            modalities=[{"kind": "screenshot", "ref": "artifact:screen-001.png"}],
            target_use="computer-use-observation",
            metadata={"traceOutputDir": ".sciforge/vision-runs/current"},
        )

        self.assertEqual(request.text, "Describe the Upload button for an external action provider.")
        self.assertEqual(request.modalities[0].kind, "screenshot")
        self.assertEqual(request.modalities[0].ref, "artifact:screen-001.png")
        self.assertEqual(request.targetUse, "computer-use-observation")
        self.assertEqual(request.metadata["traceOutputDir"], ".sciforge/vision-runs/current")

    def test_old_text_command_api_is_not_exported(self):
        for name in (
            "COMPUTER_USE_COMMAND_SCHEMA",
            "ComputerUseTextCommand",
            "command_to_text",
            "computer_use_command_from_action",
            "computer_use_text_envelope",
            "sense_text_result_for_computer_use",
            "text_envelope_from_vision_step",
            "text_signal_from_vision_step",
        ):
            self.assertFalse(hasattr(vision_sense, name), name)

    def test_old_positive_computer_use_modules_stay_deleted(self):
        for module_name in (
            "sciforge_vision_sense.computer_use",
            "sciforge_vision_sense.executor",
            "sciforge_vision_sense.planner",
            "sciforge_vision_sense.runner",
            "sciforge_vision_sense.text_agent_runtime",
        ):
            with self.subTest(module_name=module_name):
                with self.assertRaises(ModuleNotFoundError):
                    importlib.import_module(module_name)


if __name__ == "__main__":
    unittest.main()
