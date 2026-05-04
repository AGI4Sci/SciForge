"""Text-signal adapter for Computer Use style actions.

The sense package is deliberately executor-agnostic: it can describe what a GUI
executor should do, but it does not own a desktop, browser, or MCP connection.
This module keeps that boundary explicit by serializing actions as text.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal, Mapping

from .types import (
    ModalityInput,
    SensePluginRequest,
    SensePluginTextEnvelope,
    SensePluginTextResult,
)


ComputerUseAction = Literal["click", "type_text", "press_key", "scroll", "wait"]
RiskLevel = Literal["low", "medium", "high"]
COMPUTER_USE_COMMAND_SCHEMA = "sciforge.computer-use.command.v1"

HIGH_RISK_PATTERN = re.compile(
    r"\b(send|submit|delete|remove|pay|purchase|buy|authorize|approve|publish|post|"
    r"发送|提交|删除|移除|付款|支付|购买|授权|批准|发布)\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class ComputerUseTextCommand:
    action: ComputerUseAction
    target: dict[str, Any] = field(default_factory=dict)
    text: str | None = None
    key: str | None = None
    direction: Literal["up", "down", "left", "right"] | None = None
    amount: int | float | None = None
    reason: str | None = None
    riskLevel: RiskLevel = "low"
    sourceModalityRefs: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def build_sense_plugin_request(
    text: str,
    modalities: list[ModalityInput | Mapping[str, Any]] | None = None,
    *,
    output_format: str = "application/json",
    target_use: str = "computer-use",
    allow_high_risk_actions: bool = False,
    metadata: Mapping[str, Any] | None = None,
) -> SensePluginRequest:
    """Build the shared `text + modalities -> text` request envelope."""

    return SensePluginRequest(
        text=text,
        modalities=[_coerce_modality(item) for item in modalities or []],
        outputFormat=output_format,
        targetUse=target_use,
        riskPolicy={"allowHighRiskActions": allow_high_risk_actions},
        metadata=dict(metadata or {}),
    )


def command_to_text(
    command: ComputerUseTextCommand | Mapping[str, Any],
    *,
    output_format: str = "application/json",
) -> str:
    """Serialize a Computer Use command as text for an external executor."""

    payload = _dataclass_or_mapping_to_dict(command)
    if output_format == "text/x-computer-use-command":
        return _plain_text_command(payload)
    if output_format == "application/x-ndjson":
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def computer_use_text_envelope(
    command: ComputerUseTextCommand | Mapping[str, Any],
    *,
    target_use: str | None = "computer-use",
    output_format: str = "application/json",
    metadata: Mapping[str, Any] | None = None,
) -> SensePluginTextEnvelope:
    """Wrap a Computer Use command in the generic text-only sense envelope."""

    command_text = command_to_text(command, output_format=output_format)
    return SensePluginTextEnvelope(
        kind="command",
        targetUse=target_use,
        text=command_text,
        format=output_format,
        metadata={
            "commandSchema": COMPUTER_USE_COMMAND_SCHEMA,
            "executorRequired": False,
            **dict(metadata or {}),
        },
    )


def envelope_to_text(envelope: SensePluginTextEnvelope | Mapping[str, Any]) -> str:
    """Serialize a text envelope; the sense-plugin wire output remains text."""

    return json.dumps(_dataclass_or_mapping_to_dict(envelope), ensure_ascii=False, separators=(",", ":"))


def computer_use_command_from_action(
    action: Any,
    *,
    grounding: Any | None = None,
    source_modality_refs: list[str] | None = None,
    reason: str | None = None,
) -> ComputerUseTextCommand:
    """Convert a runner/planner action plus optional grounding into text command data."""

    action_map = _dataclass_or_mapping_to_dict(action)
    kind = action_map.get("kind") or action_map.get("action")
    if kind not in {"click", "type_text", "press_key", "scroll", "wait"}:
        raise ValueError(f"Unsupported Computer Use action: {kind}")
    target_description = action_map.get("target_description") or action_map.get("targetDescription")
    target: dict[str, Any] = {}
    if target_description:
        target["description"] = target_description
    point = _grounding_point(grounding)
    if point:
        target.update(point)
    return ComputerUseTextCommand(
        action=kind,
        target=target,
        text=action_map.get("text"),
        key=action_map.get("key"),
        direction=action_map.get("direction"),
        amount=action_map.get("amount"),
        reason=reason or action_map.get("reason"),
        riskLevel=action_map.get("riskLevel") or action_map.get("risk_level") or "low",
        sourceModalityRefs=list(source_modality_refs or []),
        metadata={
            key: value
            for key, value in {
                "confidence": action_map.get("confidence"),
                "plannerMetadata": action_map.get("metadata"),
            }.items()
            if value is not None
        },
    )


def sense_text_result_for_computer_use(
    request: SensePluginRequest | Mapping[str, Any],
    command: ComputerUseTextCommand | Mapping[str, Any],
) -> SensePluginTextResult:
    """Return a text-only result, rejecting high-risk actions unless allowed."""

    req = _coerce_request(request)
    command_map = _dataclass_or_mapping_to_dict(command)
    command_risk = _classify_risk(req.text, command_map)
    if command_risk == "high" and not bool(req.riskPolicy.get("allowHighRiskActions")):
        envelope = SensePluginTextEnvelope(
            text=json.dumps(
                {
                    "status": "rejected",
                    "reason": "high-risk Computer Use action requires upstream confirmation",
                    "riskLevel": "high",
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            kind="command",
            targetUse=req.targetUse,
            format=req.outputFormat,
            metadata={
                "commandSchema": COMPUTER_USE_COMMAND_SCHEMA,
                "executorRequired": False,
            },
        )
        return SensePluginTextResult(
            text=envelope_to_text(envelope),
            format="application/json",
            status="rejected",
            reason="high-risk Computer Use action requires upstream confirmation",
            modality="vision",
        )
    safe_command = {**command_map, "riskLevel": command_risk}
    envelope = computer_use_text_envelope(
        safe_command,
        target_use=req.targetUse,
        output_format=req.outputFormat,
        metadata={
            "inputModalities": [item.kind for item in req.modalities],
        },
    )
    return SensePluginTextResult(
        text=envelope_to_text(envelope),
        format="application/json",
        status="ok",
        modality="vision",
        metadata={
            "targetUse": req.targetUse,
            "inputModalities": [item.kind for item in req.modalities],
        },
    )


def text_signal_from_vision_step(
    step: Any,
    *,
    output_format: str = "application/json",
) -> str:
    """Serialize a completed vision step as a Computer Use text signal."""

    command = _command_from_vision_step(step)
    return command_to_text(command, output_format=output_format)


def text_envelope_from_vision_step(
    step: Any,
    *,
    target_use: str | None = "computer-use",
    output_format: str = "application/json",
) -> str:
    """Serialize a completed vision step as a text-only command envelope."""

    command = _command_from_vision_step(step)
    envelope = computer_use_text_envelope(command, target_use=target_use, output_format=output_format)
    return envelope_to_text(envelope)


def _command_from_vision_step(step: Any) -> ComputerUseTextCommand:
    step_map = _dataclass_or_mapping_to_dict(step)
    action = step_map.get("planned_action") or step_map.get("plannedAction")
    if not action:
        raise ValueError("vision step has no planned action")
    grounding = step_map.get("grounding")
    refs = [
        ref
        for ref in [
            step_map.get("before_screenshot_ref") or step_map.get("beforeScreenshotRef"),
            step_map.get("after_screenshot_ref") or step_map.get("afterScreenshotRef"),
        ]
        if isinstance(ref, str) and ref
    ]
    command = computer_use_command_from_action(
        action,
        grounding=grounding,
        source_modality_refs=refs,
        reason=step_map.get("failure_reason") or step_map.get("failureReason"),
    )
    return command


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


def _coerce_request(value: SensePluginRequest | Mapping[str, Any]) -> SensePluginRequest:
    if isinstance(value, SensePluginRequest):
        return value
    return build_sense_plugin_request(
        str(value.get("text") or ""),
        modalities=value.get("modalities") if isinstance(value.get("modalities"), list) else [],
        output_format=str(value.get("outputFormat") or "application/json"),
        target_use=str(value.get("targetUse") or "computer-use"),
        allow_high_risk_actions=bool((value.get("riskPolicy") or {}).get("allowHighRiskActions"))
        if isinstance(value.get("riskPolicy"), Mapping)
        else False,
        metadata=value.get("metadata") if isinstance(value.get("metadata"), Mapping) else None,
    )


def _dataclass_or_mapping_to_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return {
        key: getattr(value, key)
        for key in dir(value)
        if not key.startswith("_") and not callable(getattr(value, key))
    }


def _grounding_point(grounding: Any | None) -> dict[str, float]:
    grounding_map = _dataclass_or_mapping_to_dict(grounding)
    point = grounding_map.get("point")
    if point is not None:
        point_map = _dataclass_or_mapping_to_dict(point)
        if "x" in point_map and "y" in point_map:
            return {"x": float(point_map["x"]), "y": float(point_map["y"])}
    if grounding_map.get("x") is not None and grounding_map.get("y") is not None:
        return {"x": float(grounding_map["x"]), "y": float(grounding_map["y"])}
    return {}


def _classify_risk(text: str, command: Mapping[str, Any]) -> RiskLevel:
    declared = command.get("riskLevel") or command.get("risk_level")
    if declared == "high":
        return "high"
    haystack = " ".join(str(value) for value in [text, command.get("text"), command.get("reason")] if value)
    if HIGH_RISK_PATTERN.search(haystack):
        return "high"
    return declared if declared in {"low", "medium"} else "low"


def _plain_text_command(command: Mapping[str, Any]) -> str:
    action = str(command.get("action") or "")
    target = command.get("target") if isinstance(command.get("target"), Mapping) else {}
    parts = [action]
    if target.get("x") is not None and target.get("y") is not None:
        parts.append(f"x={target['x']}")
        parts.append(f"y={target['y']}")
    if target.get("description"):
        parts.append(f"target={target['description']}")
    for key in ("text", "key", "direction", "amount", "riskLevel"):
        if command.get(key) is not None:
            parts.append(f"{key}={command[key]}")
    return " ".join(parts)
