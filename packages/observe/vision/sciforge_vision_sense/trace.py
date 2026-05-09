"""Trace artifact IO and validation for vision-sense.

The core runner is dependency-injected and can work with in-memory screenshots.
This module is the package-level bridge that turns screenshot bytes into durable
file refs, then validates that a vision-trace never points at missing images.
It deliberately depends only on the Python standard library and public package
contracts so the package remains independently publishable.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import struct
import subprocess
from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol

from .observer import ScreenshotRef as ObserverScreenshotRef
from .types import ScreenshotRef


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True)
class ScreenshotFileMetadata:
    ref: str
    path: str
    sha256: str
    mimeType: str
    width: int
    height: int
    sizeBytes: int


@dataclass(frozen=True)
class TraceValidationResult:
    ok: bool
    checkedRefs: list[str]
    missingRefs: list[str]
    invalidRefs: list[str]
    diagnostics: list[str]


class SupportsCapture(Protocol):
    def capture(self) -> ObserverScreenshotRef:
        """Capture the current screen and return bytes or a readable file path."""


class TraceScreenshotStore:
    """Write screenshot files and convert them to portable trace refs."""

    def __init__(self, output_dir: str | Path, *, ref_prefix: str | None = None) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.ref_prefix = (ref_prefix or self.output_dir.as_posix()).rstrip("/")

    def write_png(self, name: str, image_bytes: bytes, *, metadata: Mapping[str, Any] | None = None) -> ScreenshotRef:
        if not name.endswith(".png"):
            name = f"{name}.png"
        width, height = png_dimensions(image_bytes)
        path = self.output_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image_bytes)
        digest = hashlib.sha256(image_bytes).hexdigest()
        return ScreenshotRef(
            uri=f"{self.ref_prefix}/{name}",
            mimeType="image/png",
            width=width,
            height=height,
            sha256=digest,
            metadata={
                **dict(metadata or {}),
                "path": path.as_posix(),
                "sizeBytes": len(image_bytes),
            },
        )

    def copy_png(self, name: str, source_path: str | Path, *, metadata: Mapping[str, Any] | None = None) -> ScreenshotRef:
        image_bytes = Path(source_path).read_bytes()
        return self.write_png(name, image_bytes, metadata=metadata)

    def ref_to_path(self, ref: str) -> Path:
        if ref.startswith("file:"):
            ref = ref.removeprefix("file:")
        if ref.startswith(self.ref_prefix):
            suffix = ref[len(self.ref_prefix):].lstrip("/")
            return self.output_dir / suffix
        candidate = Path(ref)
        if candidate.is_absolute():
            return candidate
        return candidate

    def metadata_for_ref(self, ref: str) -> ScreenshotFileMetadata:
        path = self.ref_to_path(ref)
        image_bytes = path.read_bytes()
        width, height = png_dimensions(image_bytes)
        return ScreenshotFileMetadata(
            ref=ref,
            path=path.as_posix(),
            sha256=hashlib.sha256(image_bytes).hexdigest(),
            mimeType="image/png",
            width=width,
            height=height,
            sizeBytes=len(image_bytes),
        )


class StaticPngScreenCaptureProvider:
    """Deterministic screenshot provider for tests and text-agent smokes."""

    def __init__(self, frames: list[bytes], *, prefix: str = "static-frame") -> None:
        if not frames:
            raise ValueError("StaticPngScreenCaptureProvider requires at least one frame")
        self._frames = list(frames)
        self._prefix = prefix
        self.capture_count = 0

    def capture(self) -> ObserverScreenshotRef:
        index = min(self.capture_count, len(self._frames) - 1)
        self.capture_count += 1
        return ObserverScreenshotRef(
            id=f"{self._prefix}-{self.capture_count:03d}",
            image_bytes=self._frames[index],
            mime_type="image/png",
        )


@dataclass(frozen=True)
class CaptureRect:
    x: int
    y: int
    width: int
    height: int


class MacOSScreencaptureProvider:
    """Optional stdlib-only macOS screenshot provider using `screencapture`.

    The provider is intentionally small and optional. It is useful for manual
    local smoke tests, while unit tests should use StaticPngScreenCaptureProvider.
    """

    def __init__(
        self,
        output_dir: str | Path,
        *,
        display_id: int | None = None,
        window_id: int | None = None,
        rect: CaptureRect | tuple[int, int, int, int] | None = None,
        include_cursor: bool = False,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.display_id = display_id
        self.window_id = window_id
        self.rect = _coerce_rect(rect)
        self.include_cursor = include_cursor
        self.capture_count = 0

    def capture(self) -> ObserverScreenshotRef:
        self.capture_count += 1
        path = self.output_dir / f"capture-{self.capture_count:03d}.png"
        command = build_macos_screencapture_command(
            path,
            display_id=self.display_id,
            window_id=self.window_id,
            rect=self.rect,
            include_cursor=self.include_cursor,
        )
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"screencapture failed: {detail or result.returncode}")
        return ObserverScreenshotRef(
            id=f"macos-capture-{self.capture_count:03d}",
            path=path.as_posix(),
            mime_type="image/png",
            metadata={
                "displayId": self.display_id,
                "windowId": self.window_id,
                "rect": asdict(self.rect) if self.rect else None,
            },
        )


def build_macos_screencapture_command(
    path: str | Path,
    *,
    display_id: int | None = None,
    window_id: int | None = None,
    rect: CaptureRect | None = None,
    include_cursor: bool = False,
) -> list[str]:
    command = ["screencapture", "-x"]
    if include_cursor:
        command.append("-C")
    if window_id is not None:
        command.append(f"-l{window_id}")
    elif rect is not None:
        command.append(f"-R{rect.x},{rect.y},{rect.width},{rect.height}")
    elif display_id is not None:
        command.append(f"-D{display_id}")
    command.append(Path(path).as_posix())
    return command


def capture_screenshot_to_store(
    provider: SupportsCapture,
    store: TraceScreenshotStore,
    name: str,
    *,
    metadata: Mapping[str, Any] | None = None,
) -> ScreenshotRef:
    captured = provider.capture()
    if captured.image_bytes is not None:
        return store.write_png(name, captured.image_bytes, metadata={"sourceId": captured.id, **dict(metadata or {})})
    if captured.path:
        return store.copy_png(name, captured.path, metadata={"sourceId": captured.id, **dict(metadata or {})})
    raise ValueError("captured screenshot has neither image_bytes nor path")


def write_trace_artifact(payload: Mapping[str, Any], path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(_jsonable(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_trace_artifact(path: str | Path, store: TraceScreenshotStore) -> TraceValidationResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return validate_trace_payload(payload, store)


def validate_trace_payload(payload: Mapping[str, Any], store: TraceScreenshotStore) -> TraceValidationResult:
    refs = sorted(set(_collect_screenshot_refs(payload)))
    missing: list[str] = []
    invalid: list[str] = []
    diagnostics: list[str] = []
    checked: list[str] = []
    for ref in refs:
        path = store.ref_to_path(ref)
        if not path.exists():
            missing.append(ref)
            diagnostics.append(f"missing screenshot ref: {ref}")
            continue
        try:
            store.metadata_for_ref(ref)
        except Exception as exc:  # pragma: no cover - exact error text is platform dependent.
            invalid.append(ref)
            diagnostics.append(f"invalid screenshot ref {ref}: {exc}")
            continue
        checked.append(ref)
    return TraceValidationResult(
        ok=not missing and not invalid,
        checkedRefs=checked,
        missingRefs=missing,
        invalidRefs=invalid,
        diagnostics=diagnostics,
    )


def enrich_screenshot_ref(ref: ScreenshotRef, store: TraceScreenshotStore) -> ScreenshotRef:
    metadata = store.metadata_for_ref(ref.uri)
    return ScreenshotRef(
        uri=ref.uri,
        mimeType=metadata.mimeType,
        width=metadata.width,
        height=metadata.height,
        sha256=metadata.sha256,
        metadata={**dict(ref.metadata), "path": metadata.path, "sizeBytes": metadata.sizeBytes},
    )


def png_dimensions(image_bytes: bytes) -> tuple[int, int]:
    if len(image_bytes) < 24 or not image_bytes.startswith(PNG_SIGNATURE):
        raise ValueError("image is not a PNG")
    width, height = struct.unpack(">II", image_bytes[16:24])
    if width <= 0 or height <= 0:
        raise ValueError("PNG dimensions must be positive")
    return width, height


def _coerce_rect(rect: CaptureRect | tuple[int, int, int, int] | None) -> CaptureRect | None:
    if rect is None:
        return None
    if isinstance(rect, CaptureRect):
        return rect
    x, y, width, height = rect
    return CaptureRect(int(x), int(y), int(width), int(height))


def _collect_screenshot_refs(value: Any, key: str = "") -> list[str]:
    refs: list[str] = []
    if isinstance(value, str):
        if key.lower().endswith("screenshotref") or (
            value.endswith(".png") and (".sciforge/" in value or value.startswith("file:") or value.startswith("/"))
        ):
            refs.append(value)
        return refs
    if isinstance(value, list):
        for item in value:
            refs.extend(_collect_screenshot_refs(item, key))
        return refs
    if isinstance(value, Mapping):
        for child_key, child_value in value.items():
            refs.extend(_collect_screenshot_refs(child_value, str(child_key)))
    return refs


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_jsonable(child) for child in value]
    return value
