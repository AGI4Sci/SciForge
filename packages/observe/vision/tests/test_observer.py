from __future__ import annotations

import pathlib
import sys
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.observer import ScreenshotRef, wait_until_stable


class FakeProvider:
    def __init__(self, frames: list[bytes]) -> None:
        self._frames = frames
        self.capture_count = 0

    def capture(self) -> ScreenshotRef:
        index = min(self.capture_count, len(self._frames) - 1)
        self.capture_count += 1
        return ScreenshotRef(id=f"frame-{self.capture_count}", image_bytes=self._frames[index])


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class ScreenObserverTest(unittest.TestCase):
    def test_wait_until_stable_returns_after_two_low_diff_frames(self) -> None:
        provider = FakeProvider(
            [
                b"a" * 200,
                (b"b" * 4) + (b"a" * 196),
                (b"b" * 3) + (b"a" * 197),
            ]
        )
        clock = FakeClock()

        result = wait_until_stable(
            provider,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

        self.assertTrue(result.stable)
        self.assertEqual(result.reason, "stable")
        self.assertEqual(result.frames_captured, 3)
        self.assertLess(result.diff_ratio or 1.0, 0.01)

    def test_wait_until_stable_times_out_when_frames_keep_changing(self) -> None:
        provider = FakeProvider([b"a" * 100, b"b" * 100, b"a" * 100, b"b" * 100])
        clock = FakeClock()

        result = wait_until_stable(
            provider,
            timeout_seconds=0.9,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

        self.assertFalse(result.stable)
        self.assertEqual(result.reason, "timeout")
        self.assertGreaterEqual(result.elapsed_seconds, 0.9)

    def test_wait_until_stable_treats_threshold_as_configurable(self) -> None:
        provider = FakeProvider([b"a" * 100, b"b" + (b"a" * 99)])
        clock = FakeClock()

        result = wait_until_stable(
            provider,
            diff_threshold=0.02,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

        self.assertTrue(result.stable)
        self.assertEqual(result.diff_ratio, 0.01)


if __name__ == "__main__":
    unittest.main()
