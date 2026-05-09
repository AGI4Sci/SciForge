from __future__ import annotations

from dataclasses import dataclass


DEFAULT_POSSIBLY_NO_EFFECT_THRESHOLD = 0.005


@dataclass(frozen=True)
class PixelDiffResult:
    """Byte-level image diff result for screenshot payloads."""

    ratio: float
    changed_bytes: int
    total_bytes: int


@dataclass(frozen=True)
class PixelChangeVerification:
    diff_ratio: float
    possibly_no_effect: bool
    threshold: float = DEFAULT_POSSIBLY_NO_EFFECT_THRESHOLD


def pixel_diff_ratio(before_image_bytes: bytes, after_image_bytes: bytes) -> float:
    """Return the changed byte ratio between two encoded PNG/JPEG screenshots.

    The MVP intentionally stays framework-free and dependency-light. PNG/JPEG
    payloads are compared at byte level, which is deterministic and sufficient
    for detecting whether a GUI action likely changed the rendered screen.
    """

    return pixel_diff(before_image_bytes, after_image_bytes).ratio


def pixel_diff(before_image_bytes: bytes, after_image_bytes: bytes) -> PixelDiffResult:
    total_bytes = max(len(before_image_bytes), len(after_image_bytes))
    if total_bytes == 0:
        return PixelDiffResult(ratio=0.0, changed_bytes=0, total_bytes=0)

    shared_length = min(len(before_image_bytes), len(after_image_bytes))
    changed_bytes = abs(len(before_image_bytes) - len(after_image_bytes))
    changed_bytes += sum(
        1
        for before_byte, after_byte in zip(
            before_image_bytes[:shared_length], after_image_bytes[:shared_length]
        )
        if before_byte != after_byte
    )
    return PixelDiffResult(
        ratio=changed_bytes / total_bytes,
        changed_bytes=changed_bytes,
        total_bytes=total_bytes,
    )


def verify_pixel_change(
    before_image_bytes: bytes,
    after_image_bytes: bytes,
    *,
    possibly_no_effect_threshold: float = DEFAULT_POSSIBLY_NO_EFFECT_THRESHOLD,
) -> PixelChangeVerification:
    diff_ratio = pixel_diff_ratio(before_image_bytes, after_image_bytes)
    return PixelChangeVerification(
        diff_ratio=diff_ratio,
        possibly_no_effect=diff_ratio < possibly_no_effect_threshold,
        threshold=possibly_no_effect_threshold,
    )
