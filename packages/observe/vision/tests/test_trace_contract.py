from __future__ import annotations

import base64
import json
import pathlib
import sys
import tempfile
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.trace_contract import validate_computer_use_trace_contract_from_request  # noqa: E402


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


class TraceContractTest(unittest.TestCase):
    def test_validates_generic_computer_use_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            image = root / "before.png"
            image.write_bytes(PNG_1X1)
            trace_path = root / "vision-trace.json"
            trace_path.write_text(json.dumps(_valid_trace("before.png")), encoding="utf-8")

            result = validate_computer_use_trace_contract_from_request(
                {"tracePath": str(trace_path), "workspacePath": str(root)}
            )

        self.assertTrue(result.ok, result.issues)
        self.assertEqual(result.metrics.actionCount, 1)
        self.assertEqual(result.metrics.nonWaitActionCount, 1)
        self.assertEqual(result.checkedScreenshotRefs, ["before.png"])

    def test_rejects_inline_payloads_and_private_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            image = root / "before.png"
            image.write_bytes(PNG_1X1)
            trace = _valid_trace("before.png")
            trace["steps"][0]["plannedAction"]["domSelector"] = "#save"
            trace["inlinePayload"] = "data:image/png;base64,AAA"
            raw = json.dumps(trace)
            trace_path = root / "vision-trace.json"
            trace_path.write_text(raw, encoding="utf-8")

            result = validate_computer_use_trace_contract_from_request(
                {"tracePath": str(trace_path), "workspacePath": str(root)}
            )

        self.assertFalse(result.ok)
        self.assertTrue(any("base64" in issue for issue in result.issues))
        self.assertTrue(any("DOM/accessibility" in issue for issue in result.issues))


def _valid_trace(image_ref: str) -> dict[str, object]:
    window = {
        "windowId": 42,
        "title": "Target",
        "bounds": {"x": 0, "y": 0, "width": 100, "height": 80},
        "coordinateSpace": "window",
    }
    scheduler = {
        "mode": "serialized-window-actions",
        "lockId": "lock-1",
        "lockScope": "target-window",
        "focusPolicy": "require-focused-target",
        "interferenceRisk": "low",
    }
    ref = {
        "path": image_ref,
        "sha256": "a" * 64,
        "width": 1,
        "height": 1,
        "captureScope": "window",
        "windowId": 42,
        "bounds": {"x": 0, "y": 0, "width": 100, "height": 80},
    }
    return {
        "schemaVersion": "sciforge.vision-trace.v1",
        "config": {"dryRun": True, "windowTarget": window},
        "windowTarget": window,
        "scheduler": scheduler,
        "windowLifecycle": {"status": "stable-window"},
        "genericComputerUse": {
            "appSpecificShortcuts": [],
            "inputChannel": "generic-mouse-keyboard",
            "inputChannelContract": {
                "userDeviceImpact": "none",
                "highRiskConfirmationRequired": True,
            },
            "actionSchema": ["open_app", "click", "double_click", "drag", "type_text", "press_key", "hotkey", "scroll", "wait"],
            "coordinateContract": {"localCoordinateFrame": "window-local"},
            "verifierContract": {"screenshotScope": "window"},
        },
        "imageMemory": {"policy": "file-ref-only", "refs": [ref]},
        "steps": [
            {
                "kind": "gui-execution",
                "status": "done",
                "plannedAction": {"type": "click", "coordinateSpace": "window-local", "localX": 10, "localY": 20, "inputChannel": "generic-mouse"},
                "grounding": {"status": "provided", "coordinateSpace": "window-local", "localX": 10, "localY": 20},
                "beforeScreenshotRefs": [ref],
                "afterScreenshotRefs": [ref],
                "execution": {"inputChannel": "generic-mouse"},
                "verifier": {"windowConsistency": {"status": "same-target-window"}},
                "windowTarget": window,
                "scheduler": scheduler,
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
