"""Dataclass contracts for the SciForge Vision Sense package.

This package intentionally avoids pydantic and SciForge app-private imports so
the sense-only contract can be used by AgentServer, skills, and workspace-local
task code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping


JsonMap = dict[str, Any]


@dataclass(slots=True)
class SenseManifest:
    id: str
    modality: str
    capabilities: list[str]
    inputs: JsonMap
    outputs: JsonMap
    configSchema: JsonMap
    safety: JsonMap
    runtimeRequirements: JsonMap
    observability: JsonMap
    version: str


@dataclass(slots=True)
class ModalityInput:
    kind: str
    ref: str
    mimeType: str | None = None
    role: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class SensePluginRequest:
    text: str
    modalities: list[ModalityInput] = field(default_factory=list)
    outputFormat: str = "application/json"
    targetUse: str | None = None
    riskPolicy: JsonMap = field(default_factory=lambda: {"allowHighRiskActions": False})
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class SensePluginTextResult:
    text: str
    format: str = "application/json"
    status: Literal["ok", "rejected", "failed"] = "ok"
    reason: str | None = None
    modality: str | None = None
    artifacts: list[JsonMap] = field(default_factory=list)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class SensePluginTextEnvelope:
    text: str
    kind: Literal["text", "command", "code", "coordinates"] = "text"
    schemaVersion: str = "sciforge.sense-plugin.text.v1"
    targetUse: str | None = None
    format: str = "text/plain"
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ScreenshotRef:
    uri: str
    mimeType: str = "image/png"
    width: int | None = None
    height: int | None = None
    capturedAt: str | None = None
    sha256: str | None = None
    metadata: JsonMap = field(default_factory=dict)


def build_sense_plugin_request(
    text: str,
    modalities: list[ModalityInput | Mapping[str, Any]] | None = None,
    *,
    output_format: str = "application/json",
    target_use: str | None = None,
    allow_high_risk_actions: bool = False,
    metadata: Mapping[str, Any] | None = None,
) -> SensePluginRequest:
    """Build the shared sense-only `text + modalities -> text` request envelope."""

    return SensePluginRequest(
        text=text,
        modalities=[_coerce_modality(item) for item in modalities or []],
        outputFormat=output_format,
        targetUse=target_use,
        riskPolicy={"allowHighRiskActions": allow_high_risk_actions},
        metadata=dict(metadata or {}),
    )


def _coerce_modality(value: ModalityInput | Mapping[str, Any]) -> ModalityInput:
    if isinstance(value, ModalityInput):
        return value
    return ModalityInput(
        kind=str(value.get("kind") or value.get("type") or "unknown"),
        ref=str(value.get("ref") or value.get("uri") or ""),
        mimeType=value.get("mimeType") if isinstance(value.get("mimeType"), str) else None,
        role=value.get("role") if isinstance(value.get("role"), str) else None,
        metadata=dict(value.get("metadata") or {}),
    )
