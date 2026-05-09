import unittest
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.coordinates import (
    crop_window_from_point,
    normalized_to_pixel,
    pixel_to_normalized,
    screenshot_pixel_to_system,
    system_to_screenshot_pixel,
)


class CoordinateTests(unittest.TestCase):
    def test_pixel_normalized_round_trip(self):
        normalized = pixel_to_normalized((320, 180), 640, 360)
        self.assertEqual(normalized, (0.5, 0.5))
        self.assertEqual(normalized_to_pixel(normalized, 640, 360), (320, 180))

    def test_normalized_clamps_by_default(self):
        self.assertEqual(pixel_to_normalized((900, -5), 800, 600), (1.0, 0.0))
        self.assertEqual(normalized_to_pixel((1.5, -0.25), 800, 600), (800, 0))

    def test_screenshot_system_conversion_uses_device_pixel_ratio(self):
        system = screenshot_pixel_to_system(
            (300, 150),
            device_pixel_ratio=2.0,
            screen_origin=(10, 20),
        )
        self.assertEqual(system, (160, 95))
        screenshot = system_to_screenshot_pixel(
            system,
            device_pixel_ratio=2.0,
            screen_origin=(10, 20),
        )
        self.assertEqual(screenshot, (300, 150))

    def test_crop_window_from_point_clips_to_image(self):
        self.assertEqual(crop_window_from_point((50, 40), (400, 300), radius_px=64), (0, 0, 114, 104))
        self.assertEqual(crop_window_from_point((390, 290), (400, 300), radius_px=32), (358, 258, 400, 300))

    def test_crop_window_can_use_ratio(self):
        self.assertEqual(
            crop_window_from_point((200, 100), (400, 200), radius_px=10, radius_ratio=0.25),
            (150, 50, 250, 150),
        )


if __name__ == "__main__":
    unittest.main()
