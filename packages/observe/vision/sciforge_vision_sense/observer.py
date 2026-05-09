from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol, runtime_checkable

try:
    from .verifier import pixel_diff_ratio
except ImportError:  # pragma: no cover - supports direct module loading in tests.
    from verifier import pixel_diff_ratio  # type: ignore


DEFAULT_STABLE_DIFF_THRESHOLD = 0.01
DEFAULT_CAPTURE_INTERVAL_SECONDS = 0.3
DEFAULT_STABLE_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class ScreenshotRef:
    id: str
    image_bytes: bytes | None = None
    path: str | None = None
    mime_type: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


class ScreenCaptureProvider(Protocol):
    def capture(self) -> ScreenshotRef:
        """Capture the current screen and return a screenshot reference."""


@runtime_checkable
class SupportsReadImageBytes(Protocol):
    def read_image_bytes(self, screenshot_ref: ScreenshotRef) -> bytes:
        """Return encoded PNG/JPEG bytes for a previously captured screenshot."""


@dataclass(frozen=True)
class StabilityResult:
    stable: bool
    screenshot_ref: ScreenshotRef
    diff_ratio: float | None
    frames_captured: int
    elapsed_seconds: float
    reason: str


def read_screenshot_bytes(
    provider: ScreenCaptureProvider,
    screenshot_ref: ScreenshotRef,
) -> bytes:
    if screenshot_ref.image_bytes is not None:
        return screenshot_ref.image_bytes
    if isinstance(provider, SupportsReadImageBytes):
        return provider.read_image_bytes(screenshot_ref)
    raise ValueError(
        "ScreenshotRef has no image_bytes and provider does not implement "
        "read_image_bytes()."
    )


def wait_until_stable(
    provider: ScreenCaptureProvider,
    *,
    diff_threshold: float = DEFAULT_STABLE_DIFF_THRESHOLD,
    capture_interval_seconds: float = DEFAULT_CAPTURE_INTERVAL_SECONDS,
    timeout_seconds: float = DEFAULT_STABLE_TIMEOUT_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> StabilityResult:
    """Capture frames until two consecutive screenshots differ below threshold."""

    start_time = monotonic()
    previous_ref = provider.capture()
    previous_bytes = read_screenshot_bytes(provider, previous_ref)
    frames_captured = 1
    last_diff_ratio: float | None = None

    while True:
        elapsed_seconds = monotonic() - start_time
        remaining_seconds = timeout_seconds - elapsed_seconds
        if remaining_seconds <= 0:
            return StabilityResult(
                stable=False,
                screenshot_ref=previous_ref,
                diff_ratio=last_diff_ratio,
                frames_captured=frames_captured,
                elapsed_seconds=elapsed_seconds,
                reason="timeout",
            )

        sleep(min(capture_interval_seconds, remaining_seconds))
        elapsed_seconds = monotonic() - start_time
        if elapsed_seconds >= timeout_seconds:
            return StabilityResult(
                stable=False,
                screenshot_ref=previous_ref,
                diff_ratio=last_diff_ratio,
                frames_captured=frames_captured,
                elapsed_seconds=elapsed_seconds,
                reason="timeout",
            )

        current_ref = provider.capture()
        current_bytes = read_screenshot_bytes(provider, current_ref)
        frames_captured += 1
        last_diff_ratio = pixel_diff_ratio(previous_bytes, current_bytes)

        if last_diff_ratio < diff_threshold:
            return StabilityResult(
                stable=True,
                screenshot_ref=current_ref,
                diff_ratio=last_diff_ratio,
                frames_captured=frames_captured,
                elapsed_seconds=monotonic() - start_time,
                reason="stable",
            )

        previous_ref = current_ref
        previous_bytes = current_bytes
