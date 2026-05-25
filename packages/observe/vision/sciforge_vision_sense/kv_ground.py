"""KV-Ground HTTP adapter for the Vision Sense MVP."""

from __future__ import annotations

import json
import base64
import math
import mimetypes
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib import request
from urllib.parse import urlparse

from .coordinates import BBox, Point, crop_window_from_point, pixel_to_normalized


RemoteImageUploader = Callable[[str], str]


KV_GROUND_URL_ENV = "SCIFORGE_VISION_KV_GROUND_URL"
KV_GROUND_REMOTE_PATH_PREFIXES_ENV = "SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIXES"
KV_GROUND_UPLOAD_STRATEGY_ENV = "SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY"
DEFAULT_REMOTE_PATH_PREFIXES: tuple[str, ...] = ()
DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5


@dataclass(frozen=True)
class KvGroundConfig:
    base_url: str | None = None
    timeout: float = 30.0
    remote_path_prefixes: Sequence[str] | None = None
    allow_service_local_paths: bool = False
    upload_strategy: str = "inline"
    low_confidence_threshold: float | None = DEFAULT_LOW_CONFIDENCE_THRESHOLD

    @classmethod
    def from_env(cls) -> "KvGroundConfig":
        return cls(
            base_url=os.environ.get(KV_GROUND_URL_ENV) or None,
            remote_path_prefixes=remote_path_prefixes_from_env(),
            upload_strategy=os.environ.get(KV_GROUND_UPLOAD_STRATEGY_ENV) or "inline",
        )


def remote_path_prefixes_from_env(env: Mapping[str, str] | None = None) -> tuple[str, ...]:
    source = os.environ if env is None else env
    raw = source.get(KV_GROUND_REMOTE_PATH_PREFIXES_ENV, "")
    return tuple(prefix.strip() for prefix in raw.split(",") if prefix.strip())


class ImageRefKind(str, Enum):
    HTTP_URL = "http_url"
    REMOTE_PATH = "remote_path"
    LOCAL_PATH = "local_path"


@dataclass(frozen=True)
class ImageRef:
    value: str
    kind: ImageRefKind

    @classmethod
    def http_url(cls, value: str) -> "ImageRef":
        return cls(value=value, kind=ImageRefKind.HTTP_URL)

    @classmethod
    def remote_path(cls, value: str) -> "ImageRef":
        return cls(value=value, kind=ImageRefKind.REMOTE_PATH)

    @classmethod
    def local_path(cls, value: str) -> "ImageRef":
        return cls(value=value, kind=ImageRefKind.LOCAL_PATH)


@dataclass(frozen=True)
class HealthResult:
    ok: bool
    model_dir: str | None
    cuda_available: bool
    gpu_count: int
    raw: Mapping[str, Any]
    error: str | None = None
    diagnostics: tuple[str, ...] = ()


@dataclass(frozen=True)
class PredictResult:
    coordinates: Point | BBox
    text: str | None
    raw_text: str | None
    image_size: tuple[int, int] | None
    raw: Mapping[str, Any]
    crop_bbox: BBox | None = None
    normalized_coordinates: Point | None = None
    confidence: float | None = None
    diagnostics: tuple[str, ...] = ()


@dataclass(frozen=True)
class GrounderRequest:
    screenshot_ref: str
    target_description: str
    coordinate_space: str = "window-local"
    crop_bbox: BBox | None = None

    @classmethod
    def window(cls, screenshot_ref: str, target_description: str) -> "GrounderRequest":
        return cls(
            screenshot_ref=screenshot_ref,
            target_description=target_description,
            coordinate_space="window-local",
        )

    @classmethod
    def crop(cls, screenshot_ref: str, target_description: str, crop_bbox: BBox) -> "GrounderRequest":
        return cls(
            screenshot_ref=screenshot_ref,
            target_description=target_description,
            coordinate_space="crop-local",
            crop_bbox=crop_bbox,
        )


@dataclass(frozen=True)
class GrounderResult:
    screenshot_ref: str
    target_description: str
    coordinate_space: str
    coordinates: Point | BBox
    window_local_coordinates: Point | BBox
    crop_local_coordinates: Point | BBox | None
    confidence: float | None
    raw_text: str | None
    diagnostics: tuple[str, ...]
    raw: Mapping[str, Any]
    crop_bbox: BBox | None = None
    provider: str = "kv-ground"


class KvGroundError(RuntimeError):
    """Raised when KV-Ground returns an unusable response."""


def classify_image_ref(
    image_ref: str | os.PathLike[str] | ImageRef,
    *,
    remote_path_prefixes: Sequence[str] = DEFAULT_REMOTE_PATH_PREFIXES,
) -> ImageRef:
    """Classify an image reference as http_url, remote_path, or local_path.

    String inputs are intentionally conservative. HTTP(S) URLs are `http_url`;
    configured remote prefixes are `remote_path`; all other filesystem-looking
    values are `local_path`. Shared storage paths are deployment-specific, so
    callers should pass `remote_path_prefixes` or set
    `SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIXES`. For local paths, callers
    must provide an uploader or explicitly assert that the KV-Ground service can
    read the same path.
    """

    if isinstance(image_ref, ImageRef):
        return image_ref

    value = os.fspath(image_ref)
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        return ImageRef.http_url(value)
    if any(value.startswith(prefix) for prefix in remote_path_prefixes):
        return ImageRef.remote_path(value)
    if parsed.scheme and parsed.scheme not in {"file"}:
        return ImageRef.remote_path(value)
    return ImageRef.local_path(value)


class KvGroundClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: float = 30.0,
        remote_image_uploader: RemoteImageUploader | None = None,
        allow_service_local_paths: bool = False,
        upload_strategy: str = "inline",
        remote_path_prefixes: Sequence[str] | None = None,
        low_confidence_threshold: float | None = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
        config: KvGroundConfig | Mapping[str, Any] | None = None,
    ) -> None:
        if config is not None:
            if isinstance(config, KvGroundConfig):
                base_url = config.base_url if base_url is None else base_url
                timeout = config.timeout
                allow_service_local_paths = config.allow_service_local_paths
                upload_strategy = config.upload_strategy
                low_confidence_threshold = config.low_confidence_threshold
                if remote_path_prefixes is None:
                    remote_path_prefixes = config.remote_path_prefixes
            else:
                base_url = str(config.get("baseUrl") or config.get("base_url") or base_url or "")
                timeout = float(config.get("timeout") or config.get("timeoutSeconds") or timeout)
                allow_service_local_paths = bool(
                    config.get("allowServiceLocalPaths")
                    or config.get("allow_service_local_paths")
                    or allow_service_local_paths
                )
                if remote_path_prefixes is None:
                    raw_prefixes = config.get("remotePathPrefixes") or config.get("remote_path_prefixes")
                    if isinstance(raw_prefixes, str):
                        remote_path_prefixes = tuple(
                            prefix.strip() for prefix in raw_prefixes.split(",") if prefix.strip()
                        )
                    elif isinstance(raw_prefixes, Sequence):
                        remote_path_prefixes = tuple(str(prefix) for prefix in raw_prefixes)
                upload_strategy = str(
                    config.get("uploadStrategy")
                    or config.get("upload_strategy")
                    or upload_strategy
                    or "inline"
                )
                raw_threshold = config.get("lowConfidenceThreshold", config.get("low_confidence_threshold"))
                if raw_threshold is not None:
                    low_confidence_threshold = float(raw_threshold)

        resolved_base_url = base_url or os.environ.get(KV_GROUND_URL_ENV)
        if not resolved_base_url:
            raise KvGroundError(
                f"KV-Ground base_url is required; pass base_url/config or set {KV_GROUND_URL_ENV}"
            )
        self.base_url = resolved_base_url.rstrip("/")
        self.timeout = timeout
        self.remote_image_uploader = remote_image_uploader
        self.allow_service_local_paths = allow_service_local_paths
        self.upload_strategy = _normalize_upload_strategy(
            os.environ.get(KV_GROUND_UPLOAD_STRATEGY_ENV) or upload_strategy
        )
        self.low_confidence_threshold = _normalize_low_confidence_threshold(low_confidence_threshold)
        self.remote_path_prefixes = (
            remote_path_prefixes_from_env()
            if remote_path_prefixes is None
            else tuple(remote_path_prefixes)
        )

    def health(self) -> HealthResult:
        data = self._json_request("GET", "/health")
        ok = bool(data.get("ok"))
        model_dir = data.get("model_dir")
        cuda_available = bool(data.get("cuda_available", False))
        gpu_count = _coerce_int(data.get("gpu_count", 0), "gpu_count")

        diagnostics: list[str] = []
        if not ok:
            diagnostics.append("health failure: ok=false")
        if ok and not isinstance(model_dir, str):
            diagnostics.append("health failure: missing valid model_dir")
            ok = False
        error = "; ".join(diagnostics) or None

        return HealthResult(
            ok=ok,
            model_dir=model_dir if isinstance(model_dir, str) else None,
            cuda_available=cuda_available,
            gpu_count=gpu_count,
            raw=data,
            error=error,
            diagnostics=tuple(diagnostics),
        )

    def ground(self, request: GrounderRequest) -> GrounderResult:
        if not request.screenshot_ref.strip():
            raise ValueError("screenshot_ref must not be empty")
        if not request.target_description.strip():
            raise ValueError("target_description must not be empty")

        coordinate_space = _normalize_grounding_coordinate_space(
            request.coordinate_space,
            crop_bbox=request.crop_bbox,
        )
        prediction = self.predict(
            request.screenshot_ref,
            request.target_description,
            coordinate_space=coordinate_space,
        )
        crop_local_coordinates = prediction.coordinates if coordinate_space == "crop-local" else None
        window_local_coordinates = (
            _crop_local_to_window_local(prediction.coordinates, request.crop_bbox)
            if crop_local_coordinates is not None
            else prediction.coordinates
        )
        diagnostics = list(prediction.diagnostics)
        if crop_local_coordinates is not None:
            diagnostics.append("crop-local coordinates mapped to window-local coordinates")

        return GrounderResult(
            screenshot_ref=request.screenshot_ref,
            target_description=request.target_description,
            coordinate_space=coordinate_space,
            coordinates=prediction.coordinates,
            window_local_coordinates=window_local_coordinates,
            crop_local_coordinates=crop_local_coordinates,
            confidence=prediction.confidence,
            raw_text=prediction.raw_text,
            diagnostics=tuple(diagnostics),
            raw=prediction.raw,
            crop_bbox=request.crop_bbox,
        )

    def predict(
        self,
        image_path: str | os.PathLike[str] | ImageRef,
        text_prompt: str,
        *,
        coordinate_space: str | None = None,
    ) -> PredictResult:
        if not text_prompt:
            raise ValueError("text_prompt must not be empty")

        image_payload = self._resolve_image_payload(image_path)
        body: dict[str, Any] = {**image_payload, "text_prompt": text_prompt}
        if coordinate_space:
            body["coordinate_space"] = coordinate_space
        data = self._json_request(
            "POST",
            "/predict/",
            body=body,
        )

        coordinates = _parse_coordinates(data.get("coordinates"))
        image_size = _parse_image_size(data.get("image_size"))
        confidence = _parse_confidence(data.get("confidence"))
        diagnostics: list[str] = []
        normalized = None
        crop_bbox = None
        if image_size:
            _validate_coordinates_within_image(coordinates, image_size)
        if image_size and len(coordinates) == 2:
            normalized = pixel_to_normalized(coordinates, image_size[0], image_size[1])
            crop_bbox = crop_window_from_point(coordinates, image_size)
        if (
            confidence is not None
            and self.low_confidence_threshold is not None
            and confidence < self.low_confidence_threshold
        ):
            diagnostics.append(
                f"low confidence: {confidence:.3g} below threshold {self.low_confidence_threshold:.3g}"
            )

        return PredictResult(
            coordinates=coordinates,
            text=_optional_str(data.get("text")),
            raw_text=_optional_str(data.get("raw_text")),
            image_size=image_size,
            raw=data,
            crop_bbox=crop_bbox,
            normalized_coordinates=normalized,
            confidence=confidence,
            diagnostics=tuple(diagnostics),
        )

    def _resolve_image_payload(self, image_path: str | os.PathLike[str] | ImageRef) -> Mapping[str, Any]:
        image_ref = classify_image_ref(image_path, remote_path_prefixes=self.remote_path_prefixes)
        if image_ref.kind in {ImageRefKind.HTTP_URL, ImageRefKind.REMOTE_PATH}:
            return {"image_path": image_ref.value}

        local_path = os.fspath(image_ref.value)
        if self.remote_image_uploader is not None:
            return {"image_path": self.remote_image_uploader(local_path)}
        if self.allow_service_local_paths:
            return {"image_path": str(Path(local_path))}
        if self.upload_strategy == "inline":
            return _inline_image_payload(local_path)
        raise KvGroundError(
            "local_path image refs require inline upload, remote_image_uploader, or "
            "allow_service_local_paths=True for a service-readable path"
        )

    def _json_request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Accept": "application/json"}
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = request.Request(url, data=payload, headers=headers, method=method)
        operation = _operation_label(method, path)
        response = None
        try:
            response = request.urlopen(req, timeout=self.timeout)
            raw = response.read()
        except Exception as exc:  # pragma: no cover - exact urllib errors vary by platform
            if _is_timeout_error(exc):
                raise KvGroundError(
                    f"KV-Ground {operation} timed out after {self.timeout:g}s"
                ) from exc
            raise KvGroundError(f"KV-Ground {operation} failed: {exc}") from exc
        finally:
            close = getattr(response, "close", None)
            if close is not None:
                close()

        try:
            decoded = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise KvGroundError(f"KV-Ground {operation} returned invalid JSON") from exc
        if not isinstance(decoded, Mapping):
            raise KvGroundError(f"KV-Ground {operation} returned non-object JSON")
        return decoded


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _normalize_upload_strategy(value: str | None) -> str:
    normalized = (value or "inline").strip().lower()
    if normalized in {"inline", "base64"}:
        return "inline"
    if normalized in {"path", "remote-path", "service-local-path"}:
        return "path"
    return "inline"


def _normalize_low_confidence_threshold(value: float | None) -> float | None:
    if value is None:
        return None
    threshold = float(value)
    if not math.isfinite(threshold) or threshold < 0 or threshold > 1:
        raise KvGroundError("low_confidence_threshold must be between 0 and 1")
    return threshold


def _normalize_grounding_coordinate_space(value: str, *, crop_bbox: BBox | None) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    if crop_bbox is not None:
        if normalized not in {"", "crop", "crop-local", "focus-region", "focus-region-local"}:
            raise KvGroundError("crop grounding must use crop-local coordinate_space")
        return "crop-local"
    if normalized in {"", "window", "window-local"}:
        return "window-local"
    raise KvGroundError("grounding coordinate_space must be window-local or crop-local")


def _crop_local_to_window_local(coordinates: Point | BBox, crop_bbox: BBox | None) -> Point | BBox:
    if crop_bbox is None:
        raise KvGroundError("crop-local coordinates require crop_bbox")
    x1, y1, _x2, _y2 = crop_bbox
    if len(coordinates) == 2:
        return x1 + float(coordinates[0]), y1 + float(coordinates[1])
    return (
        x1 + int(coordinates[0]),
        y1 + int(coordinates[1]),
        x1 + int(coordinates[2]),
        y1 + int(coordinates[3]),
    )


def _operation_label(method: str, path: str) -> str:
    normalized_path = path.rstrip("/")
    if normalized_path == "/health":
        return "health check"
    if normalized_path == "/predict":
        return "predict"
    return f"{method} {path}"


def _is_timeout_error(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", None)
    return isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError) or "timed out" in str(exc).lower()


def _inline_image_payload(local_path: str) -> Mapping[str, Any]:
    path = Path(local_path)
    try:
        data = path.read_bytes()
    except FileNotFoundError as exc:
        raise KvGroundError(f"image path not found for inline upload: {local_path}") from exc
    except OSError as exc:
        raise KvGroundError(f"inline/base64 image upload failed for {local_path}: {exc}") from exc
    try:
        encoded = base64.b64encode(data).decode("ascii")
    except Exception as exc:
        raise KvGroundError(f"inline/base64 image upload failed for {local_path}: {exc}") from exc
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    return {
        "image_base64": encoded,
        "image_mime_type": mime_type,
    }


def _coerce_int(value: Any, field_name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise KvGroundError(f"KV-Ground field {field_name} must be an integer") from exc


def _parse_image_size(value: Any) -> tuple[int, int] | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        width = value.get("width")
        height = value.get("height")
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)) and len(value) == 2:
        width, height = value
    else:
        raise KvGroundError("KV-Ground image_size must be [width, height] or an object")
    width = _coerce_int(width, "image_size.width")
    height = _coerce_int(height, "image_size.height")
    if width <= 0 or height <= 0:
        raise KvGroundError("KV-Ground image_size width and height must be positive")
    return width, height


def _parse_confidence(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise KvGroundError("KV-Ground confidence must be a number between 0 and 1")
    try:
        confidence = float(value)
    except (TypeError, ValueError) as exc:
        raise KvGroundError("KV-Ground confidence must be a number between 0 and 1") from exc
    if not math.isfinite(confidence) or confidence < 0 or confidence > 1:
        raise KvGroundError("KV-Ground confidence must be a number between 0 and 1")
    return confidence


def _validate_coordinates_within_image(coordinates: Point | BBox, image_size: tuple[int, int]) -> None:
    width, height = image_size
    values = tuple(float(value) for value in coordinates)
    if not all(math.isfinite(value) for value in values):
        raise KvGroundError("KV-Ground coordinates must be finite numbers")

    if len(values) == 2:
        x, y = values
        if x < 0 or x > width or y < 0 or y > height:
            raise KvGroundError(
                f"KV-Ground coordinates outside image bounds: point=({x:g}, {y:g}), "
                f"image_size=({width}, {height})"
            )
        return

    x1, y1, x2, y2 = values
    if x1 > x2 or y1 > y2:
        raise KvGroundError(
            f"KV-Ground bbox coordinates must be ordered: bbox=({x1:g}, {y1:g}, {x2:g}, {y2:g})"
        )
    if x1 < 0 or x1 > width or x2 < 0 or x2 > width or y1 < 0 or y1 > height or y2 < 0 or y2 > height:
        raise KvGroundError(
            f"KV-Ground coordinates outside image bounds: bbox=({x1:g}, {y1:g}, {x2:g}, {y2:g}), "
            f"image_size=({width}, {height})"
        )


def _parse_coordinates(value: Any) -> Point | BBox:
    if isinstance(value, Mapping):
        if {"x", "y"}.issubset(value.keys()):
            return float(value["x"]), float(value["y"])
        if {"x1", "y1", "x2", "y2"}.issubset(value.keys()):
            return (
                _coerce_int(value["x1"], "coordinates.x1"),
                _coerce_int(value["y1"], "coordinates.y1"),
                _coerce_int(value["x2"], "coordinates.x2"),
                _coerce_int(value["y2"], "coordinates.y2"),
            )
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        if len(value) == 2:
            return float(value[0]), float(value[1])
        if len(value) == 4:
            return (
                _coerce_int(value[0], "coordinates[0]"),
                _coerce_int(value[1], "coordinates[1]"),
                _coerce_int(value[2], "coordinates[2]"),
                _coerce_int(value[3], "coordinates[3]"),
            )
    raise KvGroundError("KV-Ground coordinates must be a point or bbox")
