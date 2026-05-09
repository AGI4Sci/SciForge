"""Dataclass contracts for the SciForge Vision Sense MVP.

This package intentionally avoids pydantic and SciForge app-private imports so
the contract can be used by AgentServer, skills, and workspace-local task code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


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


@dataclass(slots=True)
class VisionAction:
    action: Literal["click", "type_text", "press_key", "scroll", "wait", "none"]
    targetDescription: str | None = None
    text: str | None = None
    key: str | None = None
    direction: Literal["up", "down", "left", "right"] | None = None
    amount: int | float | None = None
    reason: str | None = None
    confidence: float | None = None
    riskLevel: Literal["low", "medium", "high"] = "low"
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class GroundingResult:
    status: Literal["ok", "failed", "skipped"]
    textPrompt: str
    x: float | None = None
    y: float | None = None
    normalizedX: float | None = None
    normalizedY: float | None = None
    imageWidth: int | None = None
    imageHeight: int | None = None
    rawResponse: JsonMap = field(default_factory=dict)
    failureReason: str | None = None
    confidence: float | None = None


@dataclass(slots=True)
class PixelDiffResult:
    changedPixelRatio: float
    threshold: float = 0.005
    possiblyNoEffect: bool = False
    beforeScreenshotRef: ScreenshotRef | None = None
    afterScreenshotRef: ScreenshotRef | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class VisionStepRecord:
    stepIndex: int
    beforeScreenshotRef: ScreenshotRef
    screenSummary: str
    visibleTexts: list[JsonMap] = field(default_factory=list)
    completionCheck: JsonMap = field(default_factory=dict)
    plannedAction: VisionAction | None = None
    grounding: GroundingResult | None = None
    execution: JsonMap = field(default_factory=dict)
    afterScreenshotRef: ScreenshotRef | None = None
    pixelDiff: PixelDiffResult | None = None
    failureReason: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class VisionTaskRequest:
    task: str
    appWindowTarget: JsonMap = field(default_factory=dict)
    maxSteps: int = 30
    riskPolicy: JsonMap = field(default_factory=lambda: {"allowHighRiskActions": False})
    modelConfigRef: str | None = None
    grounderConfig: JsonMap = field(default_factory=dict)
    screenshotPolicy: JsonMap = field(
        default_factory=lambda: {
            "stabilityIntervalSeconds": 0.3,
            "stableChangeRatio": 0.01,
            "maxWaitSeconds": 8,
        }
    )
    artifactOutputDir: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class VisionTaskResult:
    status: Literal["succeeded", "failed", "cancelled", "max_steps"]
    reason: str
    steps: list[VisionStepRecord] = field(default_factory=list)
    finalScreenshotRef: ScreenshotRef | None = None
    artifacts: list[JsonMap] = field(default_factory=list)
    metrics: JsonMap = field(default_factory=dict)
    failureDiagnostics: JsonMap = field(default_factory=dict)
    metadata: JsonMap = field(default_factory=dict)
