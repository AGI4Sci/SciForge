from __future__ import annotations

import pathlib
import sys
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.coarse_to_fine import (
    build_focus_region,
    build_focus_region_from_trace,
    build_region_semantic_verifier,
    build_verifier_planning_feedback,
)
from sciforge_vision_sense.verifier import pixel_diff_ratio, verify_pixel_change


class PixelDiffVerifierTest(unittest.TestCase):
    def test_pixel_diff_ratio_counts_byte_level_changes(self) -> None:
        before = b"a" * 100
        after = b"a" * 99 + b"b"

        self.assertEqual(pixel_diff_ratio(before, after), 0.01)

    def test_verify_pixel_change_marks_no_change_as_possibly_no_effect(self) -> None:
        result = verify_pixel_change(b"same-image", b"same-image")

        self.assertEqual(result.diff_ratio, 0.0)
        self.assertTrue(result.possibly_no_effect)

    def test_verify_pixel_change_marks_visible_change_as_effect(self) -> None:
        before = b"a" * 100
        after = b"b" + (b"a" * 99)

        result = verify_pixel_change(before, after)

        self.assertEqual(result.diff_ratio, 0.01)
        self.assertFalse(result.possibly_no_effect)

    def test_coarse_to_fine_focus_region_clips_to_source_image(self) -> None:
        region = build_focus_region(
            source_screenshot_ref="before.png",
            center_x=10,
            center_y=15,
            source_width=800,
            source_height=600,
            reason="small target",
        )

        self.assertEqual(region.sourceScreenshotRef, "before.png")
        self.assertEqual(region.coordinateFrame, "source-screenshot-pixels")
        self.assertEqual(region.x, 0)
        self.assertEqual(region.y, 0)
        self.assertGreaterEqual(region.width, 96)
        self.assertGreaterEqual(region.height, 80)

    def test_focus_region_from_trace_uses_grounding_and_screenshot_metadata(self) -> None:
        region = build_focus_region_from_trace(
            {"path": "window.png", "width": 1000, "height": 800},
            {"localX": 500, "localY": 400, "targetDescription": "Save button"},
        )

        assert region is not None
        self.assertEqual(region["sourceScreenshotRef"], "window.png")
        self.assertEqual(region["centerX"], 500)
        self.assertEqual(region["centerY"], 400)
        self.assertEqual(region["reason"], "Save button")

    def test_verifier_feedback_compacts_pixel_window_grounding_and_focus(self) -> None:
        feedback = build_verifier_planning_feedback(
            action={"type": "click"},
            status="done",
            grounding={"status": "provided", "targetDescription": "Save button", "localX": 12, "localY": 34},
            pixel_diff={"possiblyNoEffect": True, "pairs": [{"changedByteRatio": 0.0, "possiblyNoEffect": True}]},
            window_consistency={"status": "same-target-window", "sameWindow": True, "scopeOk": True},
            visual_focus={"region": {"x": 0, "y": 0, "width": 96, "height": 80}},
        )

        self.assertIn("pixel=no-visible-effect", feedback)
        self.assertIn("window=same-target-window", feedback)
        self.assertIn("grounding=provided", feedback)
        self.assertIn("focus=bbox", feedback)
        self.assertIn("avoid repeating same target", feedback)

    def test_region_semantic_verifier_classifies_focus_changes(self) -> None:
        semantic = build_region_semantic_verifier(
            action={"type": "click", "targetDescription": "small Save icon"},
            status="done",
            grounding={"targetDescription": "small Save icon"},
            pixel_diff={"possiblyNoEffect": False, "pairs": [{"changedByteRatio": 0.02}]},
            focus_pixel_diff={"possiblyNoEffect": False, "pairs": [{"changedByteRatio": 0.04}]},
            visual_focus={"region": {"x": 20, "y": 10, "width": 120, "height": 90}},
        )

        self.assertEqual(semantic["verdict"], "focused-target-reacted")
        self.assertIn("regionSemantic=focused-target-reacted", semantic["summary"])
        self.assertEqual(semantic["focusRegion"]["x"], 20)


if __name__ == "__main__":
    unittest.main()
