"""Coordinate transforms for the Vision Sense MVP."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence, Tuple


Point = Tuple[float, float]
BBox = Tuple[int, int, int, int]


@dataclass(frozen=True)
class Size:
    width: int
    height: int

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("width and height must be positive")


def _size(width: int | float, height: int | float) -> Size:
    return Size(int(width), int(height))


def _point(point: Sequence[float] | Point) -> Point:
    if len(point) != 2:
        raise ValueError("point must contain exactly two values")
    return float(point[0]), float(point[1])


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def pixel_to_normalized(
    point: Sequence[float] | Point,
    width: int,
    height: int,
    *,
    clamp: bool = True,
) -> Point:
    """Convert image pixel coordinates into normalized [0, 1] coordinates."""

    size = _size(width, height)
    x, y = _point(point)
    nx = x / size.width
    ny = y / size.height
    if clamp:
        nx = _clamp(nx, 0.0, 1.0)
        ny = _clamp(ny, 0.0, 1.0)
    return nx, ny


def normalized_to_pixel(
    point: Sequence[float] | Point,
    width: int,
    height: int,
    *,
    clamp: bool = True,
) -> Point:
    """Convert normalized [0, 1] coordinates into image pixel coordinates."""

    size = _size(width, height)
    nx, ny = _point(point)
    if clamp:
        nx = _clamp(nx, 0.0, 1.0)
        ny = _clamp(ny, 0.0, 1.0)
    return nx * size.width, ny * size.height


def screenshot_pixel_to_system(
    point: Sequence[float] | Point,
    *,
    device_pixel_ratio: float = 1.0,
    screen_origin: Sequence[float] | Point = (0.0, 0.0),
) -> Point:
    """Convert screenshot pixels into system mouse coordinates.

    Screenshots are usually in device pixels, while OS mouse APIs often use
    logical points. A 2x display therefore maps screenshot pixel (200, 100) to
    system coordinate (100, 50), plus the window/screen origin.
    """

    if device_pixel_ratio <= 0:
        raise ValueError("device_pixel_ratio must be positive")
    x, y = _point(point)
    ox, oy = _point(screen_origin)
    return ox + (x / device_pixel_ratio), oy + (y / device_pixel_ratio)


def system_to_screenshot_pixel(
    point: Sequence[float] | Point,
    *,
    device_pixel_ratio: float = 1.0,
    screen_origin: Sequence[float] | Point = (0.0, 0.0),
) -> Point:
    """Convert system mouse coordinates into screenshot pixels."""

    if device_pixel_ratio <= 0:
        raise ValueError("device_pixel_ratio must be positive")
    x, y = _point(point)
    ox, oy = _point(screen_origin)
    return (x - ox) * device_pixel_ratio, (y - oy) * device_pixel_ratio


def crop_window_from_point(
    point: Sequence[float] | Point,
    image_size: Sequence[int],
    *,
    radius_px: int = 128,
    radius_ratio: float | None = None,
    min_size: int = 1,
) -> BBox:
    """Build a clipped crop bbox around a point-only grounding result.

    KV-Ground may return only a single point. The MVP uses this helper to turn
    that point into a local crop window for a future second grounding pass.
    """

    if len(image_size) != 2:
        raise ValueError("image_size must contain width and height")
    size = _size(int(image_size[0]), int(image_size[1]))
    if radius_px < 0:
        raise ValueError("radius_px must be non-negative")
    if radius_ratio is not None and radius_ratio < 0:
        raise ValueError("radius_ratio must be non-negative")
    if min_size <= 0:
        raise ValueError("min_size must be positive")

    radius = float(radius_px)
    if radius_ratio is not None:
        radius = max(radius, min(size.width, size.height) * radius_ratio)

    x, y = _point(point)
    x1 = int(max(0, round(x - radius)))
    y1 = int(max(0, round(y - radius)))
    x2 = int(min(size.width, round(x + radius)))
    y2 = int(min(size.height, round(y + radius)))

    if x2 - x1 < min_size:
        x2 = min(size.width, x1 + min_size)
        x1 = max(0, x2 - min_size)
    if y2 - y1 < min_size:
        y2 = min(size.height, y1 + min_size)
        y1 = max(0, y2 - min_size)
    return x1, y1, x2, y2
