"""Target identity model for Computer Use protocol v2."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Any, Mapping


SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class TargetKind(str, Enum):
    BROWSER_PAGE = "browser-page"
    ELECTRON_WEBCONTENTS = "electron-webcontents"


class TargetOwnership(str, Enum):
    ATTACHED = "attached"
    MANAGED = "managed"


_LOCATOR_FIELDS = {
    TargetKind.BROWSER_PAGE: {"cdpEndpoint", "cdpTargetId"},
    TargetKind.ELECTRON_WEBCONTENTS: {"webContentsId", "cdpTargetId"},
}


@dataclass(frozen=True)
class DisplayDescriptor:
    monitor_id: str | None = None
    scale_factor: float | None = None
    viewport: tuple[int, int] | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if self.monitor_id is not None:
            result["monitorId"] = self.monitor_id
        if self.scale_factor is not None:
            result["scaleFactor"] = self.scale_factor
        if self.viewport is not None:
            result["viewport"] = list(self.viewport)
        return result


@dataclass(frozen=True)
class TargetDescriptor:
    target_id: str
    kind: TargetKind
    ownership: TargetOwnership = TargetOwnership.ATTACHED
    locator: Mapping[str, Any] = field(default_factory=dict, repr=False)
    display: DisplayDescriptor | None = None
    backend_hint: str | None = None
    generation: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "locator", MappingProxyType(dict(self.locator)))
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))

    def __repr__(self) -> str:
        return f"TargetDescriptor({self.to_dict(include_sensitive=False)!r})"

    def to_dict(self, *, include_sensitive: bool = True) -> dict[str, Any]:
        locator = dict(self.locator) if include_sensitive else _redact_locator(self.kind, self.locator)
        result: dict[str, Any] = {
            "targetId": self.target_id,
            "kind": self.kind.value,
            "ownership": self.ownership.value,
            "locator": locator,
        }
        if self.display is not None:
            result["display"] = self.display.to_dict()
        if self.backend_hint is not None:
            result["backendHint"] = self.backend_hint
        if self.generation is not None:
            result["generation"] = self.generation
        if self.metadata:
            result["metadata"] = (
                dict(self.metadata) if include_sensitive else _redact_metadata(self.metadata)
            )
        return result


def validate_safe_id(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not SAFE_ID_PATTERN.fullmatch(value):
        raise ValueError(
            f"{field_name} must be 1-128 characters using letters, numbers, '.', '_', ':' or '-'"
        )
    return value


def parse_target_descriptor(value: object, *, generate_id: bool = True) -> TargetDescriptor:
    if not isinstance(value, Mapping):
        raise ValueError("target must be an object")
    allowed = {
        "targetId", "kind", "ownership", "locator", "display",
        "backendHint", "generation", "metadata",
    }
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"target contains unsupported fields: {', '.join(sorted(unknown))}")

    try:
        kind = TargetKind(value.get("kind"))
    except (TypeError, ValueError) as exc:
        allowed_kinds = ", ".join(item.value for item in TargetKind)
        raise ValueError(f"target.kind must be one of: {allowed_kinds}") from exc

    raw_id = value.get("targetId")
    if raw_id is None and generate_id:
        target_id = f"target-{uuid.uuid4()}"
    else:
        target_id = validate_safe_id(raw_id, "target.targetId")

    try:
        ownership = TargetOwnership(value.get("ownership", TargetOwnership.ATTACHED.value))
    except ValueError as exc:
        raise ValueError("target.ownership must be 'attached' or 'managed'") from exc

    raw_locator = value.get("locator", {})
    if not isinstance(raw_locator, Mapping):
        raise ValueError("target.locator must be an object")
    unknown_locator = set(raw_locator) - _LOCATOR_FIELDS[kind]
    if unknown_locator:
        raise ValueError(
            f"target.locator has fields unsupported for {kind.value}: "
            f"{', '.join(sorted(unknown_locator))}"
        )
    locator = _validate_locator(kind, raw_locator)

    display = _parse_display(value.get("display"))
    backend_hint = _optional_short_string(value.get("backendHint"), "target.backendHint")
    generation = _optional_short_string(value.get("generation"), "target.generation")
    if generation is None:
        raise ValueError("CDP targets require target.generation")
    metadata = _parse_metadata(value.get("metadata"))
    return TargetDescriptor(
        target_id=target_id,
        kind=kind,
        ownership=ownership,
        locator=MappingProxyType(locator),
        display=display,
        backend_hint=backend_hint,
        generation=generation,
        metadata=MappingProxyType(metadata),
    )


def _validate_locator(kind: TargetKind, value: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(value)
    for integer_field in ("processId", "webContentsId"):
        if integer_field in result:
            raw = result[integer_field]
            if not isinstance(raw, int) or isinstance(raw, bool) or raw <= 0:
                raise ValueError(f"target.locator.{integer_field} must be a positive integer")
    for string_field, raw in result.items():
        if string_field in ("processId", "webContentsId"):
            continue
        if not isinstance(raw, str) or not raw.strip() or len(raw) > 2_048:
            raise ValueError(f"target.locator.{string_field} must be a non-empty string")
    if kind is TargetKind.BROWSER_PAGE and not {"cdpEndpoint", "cdpTargetId"}.issubset(result):
        raise ValueError("browser-page target requires cdpEndpoint and cdpTargetId")
    if kind is TargetKind.ELECTRON_WEBCONTENTS and not any(
        key in result for key in ("webContentsId", "cdpTargetId")
    ):
        raise ValueError("electron-webcontents target requires webContentsId or cdpTargetId")
    return result


def _parse_display(value: object) -> DisplayDescriptor | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("target.display must be an object")
    unknown = set(value) - {"monitorId", "scaleFactor", "viewport"}
    if unknown:
        raise ValueError(f"target.display contains unsupported fields: {', '.join(sorted(unknown))}")
    monitor_id = _optional_short_string(value.get("monitorId"), "target.display.monitorId")
    scale_factor = value.get("scaleFactor")
    if scale_factor is not None:
        if isinstance(scale_factor, bool) or not isinstance(scale_factor, (int, float)) or scale_factor <= 0:
            raise ValueError("target.display.scaleFactor must be a positive number")
        scale_factor = float(scale_factor)
    viewport = value.get("viewport")
    parsed_viewport: tuple[int, int] | None = None
    if viewport is not None:
        if (
            not isinstance(viewport, (list, tuple))
            or len(viewport) != 2
            or any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in viewport)
        ):
            raise ValueError("target.display.viewport must be [positive width, positive height]")
        parsed_viewport = (viewport[0], viewport[1])
    return DisplayDescriptor(monitor_id=monitor_id, scale_factor=scale_factor, viewport=parsed_viewport)


def _parse_metadata(value: object) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ValueError("target.metadata must be an object")
    allowed = {"title", "url", "processName", "publicLabel"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"target.metadata contains unsupported fields: {', '.join(sorted(unknown))}")
    result: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(raw, str) or len(raw) > 2_048:
            raise ValueError(f"target.metadata.{key} must be a string of at most 2048 characters")
        result[key] = raw
    return result


def _optional_short_string(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise ValueError(f"{field_name} must be a non-empty string of at most 256 characters")
    return value


def _redact_locator(kind: TargetKind, locator: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(locator)
    if kind is TargetKind.BROWSER_PAGE and "cdpEndpoint" in result:
        result["cdpEndpoint"] = "<redacted>"
    return result


def _redact_metadata(metadata: Mapping[str, str]) -> dict[str, str]:
    result = dict(metadata)
    for field_name in ("title", "url"):
        if field_name in result:
            result[field_name] = "<redacted>"
    return result
