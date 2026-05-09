"""KV-Ground HTTP adapter for the Vision Sense MVP."""

from __future__ import annotations

import json
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
DEFAULT_REMOTE_PATH_PREFIXES: tuple[str, ...] = ()


@dataclass(frozen=True)
class KvGroundConfig:
    base_url: str | None = None
    timeout: float = 30.0
    remote_path_prefixes: Sequence[str] | None = None
    allow_service_local_paths: bool = False

    @classmethod
    def from_env(cls) -> "KvGroundConfig":
        return cls(
            base_url=os.environ.get(KV_GROUND_URL_ENV) or None,
            remote_path_prefixes=remote_path_prefixes_from_env(),
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


@dataclass(frozen=True)
class PredictResult:
    coordinates: Point | BBox
    text: str | None
    raw_text: str | None
    image_size: tuple[int, int] | None
    raw: Mapping[str, Any]
    crop_bbox: BBox | None = None
    normalized_coordinates: Point | None = None


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
        remote_path_prefixes: Sequence[str] | None = None,
        config: KvGroundConfig | Mapping[str, Any] | None = None,
    ) -> None:
        if config is not None:
            if isinstance(config, KvGroundConfig):
                base_url = config.base_url if base_url is None else base_url
                timeout = config.timeout
                allow_service_local_paths = config.allow_service_local_paths
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

        resolved_base_url = base_url or os.environ.get(KV_GROUND_URL_ENV)
        if not resolved_base_url:
            raise KvGroundError(
                f"KV-Ground base_url is required; pass base_url/config or set {KV_GROUND_URL_ENV}"
            )
        self.base_url = resolved_base_url.rstrip("/")
        self.timeout = timeout
        self.remote_image_uploader = remote_image_uploader
        self.allow_service_local_paths = allow_service_local_paths
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

        error = None
        if not ok:
            error = "KV-Ground health check returned ok=false"
        if ok and not isinstance(model_dir, str):
            error = "KV-Ground health check did not include a valid model_dir"
            ok = False

        return HealthResult(
            ok=ok,
            model_dir=model_dir if isinstance(model_dir, str) else None,
            cuda_available=cuda_available,
            gpu_count=gpu_count,
            raw=data,
            error=error,
        )

    def predict(self, image_path: str | os.PathLike[str] | ImageRef, text_prompt: str) -> PredictResult:
        if not text_prompt:
            raise ValueError("text_prompt must not be empty")

        image_value = self._resolve_image_path(image_path)
        data = self._json_request(
            "POST",
            "/predict/",
            body={"image_path": image_value, "text_prompt": text_prompt},
        )

        coordinates = _parse_coordinates(data.get("coordinates"))
        image_size = _parse_image_size(data.get("image_size"))
        normalized = None
        crop_bbox = None
        if image_size and len(coordinates) == 2:
            normalized = pixel_to_normalized(coordinates, image_size[0], image_size[1])
            crop_bbox = crop_window_from_point(coordinates, image_size)

        return PredictResult(
            coordinates=coordinates,
            text=_optional_str(data.get("text")),
            raw_text=_optional_str(data.get("raw_text")),
            image_size=image_size,
            raw=data,
            crop_bbox=crop_bbox,
            normalized_coordinates=normalized,
        )

    def _resolve_image_path(self, image_path: str | os.PathLike[str] | ImageRef) -> str:
        image_ref = classify_image_ref(image_path, remote_path_prefixes=self.remote_path_prefixes)
        if image_ref.kind in {ImageRefKind.HTTP_URL, ImageRefKind.REMOTE_PATH}:
            return image_ref.value

        local_path = os.fspath(image_ref.value)
        if self.remote_image_uploader is not None:
            return self.remote_image_uploader(local_path)
        if self.allow_service_local_paths:
            return str(Path(local_path))
        raise KvGroundError(
            "local_path image refs require remote_image_uploader or "
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
        response = None
        try:
            response = request.urlopen(req, timeout=self.timeout)
            raw = response.read()
        except Exception as exc:  # pragma: no cover - exact urllib errors vary by platform
            raise KvGroundError(f"KV-Ground {method} {path} failed: {exc}") from exc
        finally:
            close = getattr(response, "close", None)
            if close is not None:
                close()

        try:
            decoded = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise KvGroundError(f"KV-Ground {method} {path} returned invalid JSON") from exc
        if not isinstance(decoded, Mapping):
            raise KvGroundError(f"KV-Ground {method} {path} returned non-object JSON")
        return decoded


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


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
