"""Package-local native tool debug surface for Computer Use.

The module intentionally stays below ``packages/actions/computer-use``. It
models the Codex native tool/MCP shape without depending on SciForge runtime or
GUI code. Mutating tools fail closed unless their request carries scoped
executor provenance; even then this debug surface only writes diagnostic refs
and never moves shared system input by itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


NATIVE_TOOL_MANIFEST_SCHEMA = "sciforge.computer-use.native-tool-manifest.v1"
NATIVE_TOOL_RESULT_SCHEMA = "sciforge.computer-use.native-tool-result.v1"
NATIVE_TOOL_REF_RECORD_SCHEMA = "sciforge.computer-use.native-tool-ref-record.v1"

PUBLIC_NATIVE_TOOL_NAMES = (
    "get_app_state",
    "observe",
    "click",
    "type_text",
    "scroll",
    "press_key",
    "propose_action",
    "execute_scoped_action",
    "get_replay_refs",
)
READ_ONLY_TOOLS = {"get_app_state", "observe", "propose_action", "get_replay_refs"}
MUTATING_FACADE_TOOLS = {"click", "type_text", "scroll", "press_key", "execute_scoped_action"}
MUTATING_ACTION_KINDS = {
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "open_menu",
    "save",
}
FORBIDDEN_PUBLIC_KEYS = {
    "providerRoute",
    "provider_route",
    "routeProvider",
    "guiPrivateState",
    "gui_private_state",
    "privateGuiState",
    "schedulerState",
    "scheduler_state",
    "schedulerInternals",
    "scheduler_internals",
    "executorAdapterRef",
    "executor_adapter_ref",
    "leaseId",
    "lease_id",
    "leaseScope",
    "lease_scope",
    "globalX",
    "globalY",
}
FORBIDDEN_INLINE_KEYS = {
    "rawScreenshot",
    "raw_screenshot",
    "inlineImage",
    "inline_image",
    "rawProviderPayload",
    "raw_provider_payload",
    "requestBody",
    "request_body",
    "base64",
}
SECRET_KEY_RE = re.compile(r"(authorization|api[-_]?key|token|secret|password|credential)", re.IGNORECASE)
DATA_IMAGE_RE = re.compile(r"^data:image/", re.IGNORECASE)
LONG_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]{120,}={0,2}$")


def get_native_tool_manifest() -> dict[str, Any]:
    """Return a compact native-tool manifest for Codex debug integration."""

    return {
        "schemaVersion": NATIVE_TOOL_MANIFEST_SCHEMA,
        "providerId": "sciforge.computer-use",
        "productionHost": "Codex app-server native tool/plugin/MCP",
        "diagnosticOnlyUntilHostBound": True,
        "guiExecutesActions": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "tools": [
            {
                "name": "get_app_state",
                "function": "module.invoke",
                "intent": "computer_use.get_app_state",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId", "screenId"],
                "returnsRefs": ["appStateRef", "observationRef", "visibleScreenRefs"],
            },
            {
                "name": "observe",
                "function": "module.invoke",
                "intent": "computer_use.observe",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId", "screenId"],
                "returnsRefs": ["appStateRef", "observationRef", "visibleScreenRefs"],
            },
            {
                "name": "click",
                "function": "module.invoke",
                "intent": "computer_use.click",
                "sideEffect": "scoped-desktop-action",
                "requiredFields": [
                    "screenId",
                    "actorId",
                    "cursorId",
                    "target",
                    "appStateRef",
                    "screenshotRef",
                    "accessibilitySnapshotRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                ],
                "returnsRefs": ["actionProposalRef", "executorLeaseRef", "executorEventRef", "blockedManifestRef"],
                "notes": "Facade only: internally projects to scoped proposal, lease, executor event, and evidence refs.",
            },
            {
                "name": "type_text",
                "function": "module.invoke",
                "intent": "computer_use.type_text",
                "sideEffect": "scoped-desktop-action",
                "requiredFields": [
                    "screenId",
                    "actorId",
                    "cursorId",
                    "target",
                    "text",
                    "appStateRef",
                    "screenshotRef",
                    "accessibilitySnapshotRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                ],
                "returnsRefs": ["actionProposalRef", "executorLeaseRef", "executorEventRef", "blockedManifestRef"],
                "notes": "Facade only: text is projected into the scoped executor contract after freshness refs are present.",
            },
            {
                "name": "scroll",
                "function": "module.invoke",
                "intent": "computer_use.scroll",
                "sideEffect": "scoped-desktop-action",
                "requiredFields": [
                    "screenId",
                    "actorId",
                    "cursorId",
                    "target",
                    "delta",
                    "appStateRef",
                    "screenshotRef",
                    "accessibilitySnapshotRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                ],
                "returnsRefs": ["actionProposalRef", "executorLeaseRef", "executorEventRef", "blockedManifestRef"],
                "notes": "Facade only: public args do not expose scheduler leases or provider routes.",
            },
            {
                "name": "press_key",
                "function": "module.invoke",
                "intent": "computer_use.press_key",
                "sideEffect": "scoped-desktop-action",
                "requiredFields": [
                    "screenId",
                    "actorId",
                    "cursorId",
                    "target",
                    "key",
                    "appStateRef",
                    "screenshotRef",
                    "accessibilitySnapshotRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                ],
                "returnsRefs": ["actionProposalRef", "executorLeaseRef", "executorEventRef", "blockedManifestRef"],
                "notes": "Facade only: key events require scoped evidence and a host-bound executor.",
            },
            {
                "name": "propose_action",
                "function": "module.invoke",
                "intent": "computer_use.propose_action",
                "sideEffect": "none",
                "requiredFields": ["screenId", "actorId", "cursorId", "action", "target"],
                "approval": "riskLevel=high stops as needs-confirmation",
                "returnsRefs": ["actionProposalRef", "approvalRequestRef"],
            },
            {
                "name": "execute_scoped_action",
                "function": "module.invoke",
                "intent": "computer_use.execute_scoped_action",
                "sideEffect": "scoped-desktop-action",
                "requiredFields": [
                    "screenId",
                    "actorId",
                    "cursorId",
                    "proposalRef",
                    "action",
                    "target",
                    "appStateRef",
                    "screenshotRef",
                    "accessibilitySnapshotRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                ],
                "approval": "required for high risk proposals before executor projection",
                "returnsRefs": ["executorLeaseRef", "executorEventRef", "blockedManifestRef"],
            },
            {
                "name": "get_replay_refs",
                "function": "module.invoke",
                "intent": "computer_use.get_replay_refs",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId"],
                "returnsRefs": ["replayBundleRef"],
            },
        ],
        "unsupported": [
            "gui.present",
            "gui.ask_user",
            "move_cursor-public-tool",
            "bare-global-coordinate-execute",
            "shared-system-input",
            "inline-raw-screenshot",
            "provider-raw-payload",
            "provider-route-parameter",
            "gui-private-state-parameter",
            "scheduler-internals-parameter",
        ],
    }


def get_mcp_tool_schemas() -> list[dict[str, Any]]:
    """Return MCP-compatible tool descriptions for the stable public surface."""

    return [
        {
            "name": tool["name"],
            "description": _tool_description(tool),
            "inputSchema": _input_schema_for_tool(tool["name"], list(tool.get("requiredFields") or [])),
        }
        for tool in get_native_tool_manifest()["tools"]
    ]


def validate_native_tool_payload(tool: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a native-tool payload without executing anything."""

    if tool not in _tool_names():
        return _validation(False, f"unsupported_tool:{tool}")
    if not isinstance(payload, Mapping):
        return _validation(False, "payload_must_be_object")

    forbidden = _find_forbidden_inline_payloads(payload)
    if forbidden:
        return _validation(False, "forbidden_inline_payload", forbiddenPaths=forbidden)

    required = _required_fields_for_tool(tool)
    missing = [field for field in required if field not in payload or payload.get(field) in (None, "")]
    if missing:
        return _validation(False, "missing_required_fields", missingFields=missing)

    if tool in {"click", "type_text", "scroll", "press_key", "propose_action", "execute_scoped_action"}:
        provenance = _validate_actor_cursor_provenance(payload)
        if not provenance["ok"]:
            return provenance

    if tool == "propose_action":
        return _validate_action_proposal(payload)
    if tool in MUTATING_FACADE_TOOLS:
        return _validate_scoped_execution({**dict(payload), "_tool": tool})
    if tool == "get_replay_refs":
        return _validate_replay_request(payload)
    return _validation(True)


def dispatch_native_tool(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Dispatch a package-local native Computer Use debug tool."""

    validation = validate_native_tool_payload(tool, payload)
    if not validation["ok"]:
        return _result(
            tool,
            "failed",
            validation["reason"],
            validation=validation,
            refs=[],
        )

    out = Path(output_dir).expanduser().resolve() if output_dir is not None else None
    if tool in {"get_app_state", "observe"}:
        state_ref = _write_ref(out, "app-state", {
            "kind": "app-state",
            "tool": tool,
            "displayGroupId": payload["displayGroupId"],
            "screenId": payload["screenId"],
            "windowId": payload.get("windowId"),
            "appRef": payload.get("appRef"),
            "sourceObservationRef": payload.get("observationRef"),
            "captureStreamRef": payload.get("captureStreamRef"),
            "accessibilitySnapshotRef": payload.get("accessibilitySnapshotRef"),
            "screenshotRef": payload.get("screenshotRef"),
            "readOnly": True,
        })
        return _result(
            tool,
            "completed",
            "App-state debug ref recorded.",
            refs=[state_ref],
            value={
                "appStateRef": state_ref,
                "observationRef": state_ref,
                "visibleScreenRefs": [state_ref],
            },
        )

    if tool == "propose_action":
        action = _record(payload["action"])
        risk_level = str(payload.get("riskLevel") or action.get("riskLevel") or "low")
        proposal_ref = _write_ref(out, "action-proposal", {
            "kind": "action-proposal",
            "displayGroupId": payload.get("displayGroupId"),
            "screenId": payload["screenId"],
            "windowId": payload.get("windowId"),
            "actorId": payload["actorId"],
            "cursorId": payload["cursorId"],
            "action": action,
            "target": payload["target"],
            "riskLevel": risk_level,
            "approvalState": "needs-confirmation" if risk_level == "high" else "not-required",
        })
        if risk_level == "high":
            approval_ref = _write_ref(out, "approval-request", {
                "kind": "approval-request",
                "proposalRef": proposal_ref,
                "riskLevel": "high",
                "screenId": payload["screenId"],
                "actorId": payload["actorId"],
                "cursorId": payload["cursorId"],
                "draftRef": payload.get("draftRef"),
            })
            return _result(
                tool,
                "needs-confirmation",
                "High-risk proposal stopped before executor projection.",
                refs=[proposal_ref, approval_ref],
                approvalRequest={
                    "approvalRequestRef": approval_ref,
                    "proposalRef": proposal_ref,
                    "riskLevel": "high",
                },
                value={"actionProposalRef": proposal_ref, "approvalRequestRef": approval_ref},
            )
        return _result(
            tool,
            "completed",
            "Action proposal recorded.",
            refs=[proposal_ref],
            value={"actionProposalRef": proposal_ref},
        )

    if tool in MUTATING_FACADE_TOOLS:
        return _dispatch_mutating_facade(tool, payload, out)

    replay_ref = _write_ref(out, "replay-bundle", {
        "kind": "multi-screen-replay-bundle",
        "displayGroupId": payload["displayGroupId"],
        "frames": payload.get("frames", []),
        "cursorOverlayRefs": _string_list(payload.get("cursorOverlayRefs")),
        "leaseOwnerRefs": _string_list(payload.get("leaseOwnerRefs")),
        "beforeEvidenceRefs": _string_list(payload.get("beforeEvidenceRefs")),
        "afterEvidenceRefs": _string_list(payload.get("afterEvidenceRefs")),
        "completionEvidenceEligible": False,
    })
    return _result(
        tool,
        "completed",
        "Replay bundle refs recorded.",
        refs=[replay_ref],
        value={"replayBundleRef": replay_ref},
    )


dispatchNativeTool = dispatch_native_tool
getNativeToolManifest = get_native_tool_manifest
validateNativeToolPayload = validate_native_tool_payload


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a package-local Computer Use native debug tool.")
    parser.add_argument("--tool", required=True, choices=sorted(_tool_names()))
    parser.add_argument("--payload-json", help="Tool payload JSON. If omitted, stdin is read as JSON.")
    parser.add_argument("--output-dir", help="Directory for refs-first sidecars.")
    args = parser.parse_args(argv)

    try:
        payload = _load_payload(args.payload_json)
        result = dispatch_native_tool(args.tool, payload, output_dir=args.output_dir)
    except Exception as exc:  # noqa: BLE001 - CLI must keep stdout structured.
        result = _result(args.tool, "failed", f"native_tool_error:{exc}", refs=[])
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") in {"completed", "needs-confirmation"} else 1


def _tool_names() -> set[str]:
    return {tool["name"] for tool in get_native_tool_manifest()["tools"]}


def _required_fields_for_tool(tool: str) -> list[str]:
    for entry in get_native_tool_manifest()["tools"]:
        if entry["name"] == tool:
            return list(entry.get("requiredFields") or [])
    return []


def _tool_description(tool: Mapping[str, Any]) -> str:
    text = f"{tool.get('intent')}: {tool.get('sideEffect')}."
    notes = tool.get("notes")
    return f"{text} {notes}" if isinstance(notes, str) and notes else text


def _input_schema_for_tool(tool: str, required_fields: Sequence[str]) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "displayGroupId": {"type": "string"},
        "screenId": {"type": "string"},
        "windowId": {"type": "string"},
        "actorId": {"type": "string"},
        "cursorId": {"type": "string"},
        "target": {
            "type": "object",
            "description": "Screen/window/element/region scoped target. Bare global coordinates are rejected.",
            "additionalProperties": True,
        },
        "action": {
            "type": "object",
            "description": "Generic GUI action. Provider routes and scheduler internals are rejected.",
            "additionalProperties": True,
        },
        "text": {"type": "string"},
        "textRef": {"type": "string"},
        "delta": {"type": ["number", "object"]},
        "key": {"type": "string"},
        "button": {"type": "string"},
        "riskLevel": {"type": "string", "enum": ["low", "medium", "high"]},
        "proposalRef": {"type": "string"},
        "appStateRef": {"type": "string"},
        "screenshotRef": {"type": "string"},
        "accessibilitySnapshotRef": {"type": "string"},
        "beforeEvidenceRefs": {"type": "array", "items": {"type": "string"}},
        "groundingRefs": {"type": "array", "items": {"type": "string"}},
        "observationRef": {"type": "string"},
        "captureStreamRef": {"type": "string"},
        "cursorOverlayRefs": {"type": "array", "items": {"type": "string"}},
        "leaseOwnerRefs": {"type": "array", "items": {"type": "string"}},
        "afterEvidenceRefs": {"type": "array", "items": {"type": "string"}},
        "frames": {"type": "array", "items": {"type": "object"}},
    }
    if tool == "get_replay_refs":
        properties["displayGroupId"] = {"type": "string"}
    return {
        "type": "object",
        "required": list(required_fields),
        "properties": properties,
        "additionalProperties": True,
    }


def _validate_actor_cursor_provenance(payload: Mapping[str, Any]) -> dict[str, Any]:
    for key in ("screenId", "actorId", "cursorId"):
        if not isinstance(payload.get(key), str) or not str(payload.get(key)).strip():
            return _validation(False, "invalid_actor_cursor_provenance", field=key)
    return _validation(True)


def _validate_cursor_position(payload: Mapping[str, Any]) -> dict[str, Any]:
    position = payload.get("position")
    if not isinstance(position, Mapping):
        return _validation(False, "invalid_cursor_position")
    x = position.get("x")
    y = position.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _validation(False, "invalid_cursor_position")
    if x < 0 or y < 0:
        return _validation(False, "invalid_cursor_position")
    return _validation(True)


def _validate_action_proposal(payload: Mapping[str, Any]) -> dict[str, Any]:
    public_internals = _find_forbidden_public_parameters(payload)
    if public_internals:
        return _validation(False, "forbidden_public_parameter", forbiddenPaths=public_internals)
    action = payload.get("action")
    target = payload.get("target")
    if not isinstance(action, Mapping):
        return _validation(False, "invalid_action")
    if not isinstance(target, Mapping):
        return _validation(False, "invalid_target")
    action_kind = str(action.get("kind") or action.get("type") or "")
    if action_kind in MUTATING_ACTION_KINDS and _is_bare_global_target(target):
        return _validation(False, "bare_global_coordinate_target")
    if not isinstance(target.get("scope"), str):
        return _validation(False, "missing_target_scope")
    return _validation(True)


def _validate_scoped_execution(payload: Mapping[str, Any]) -> dict[str, Any]:
    public_internals = _find_forbidden_public_parameters(payload)
    if public_internals:
        return _validation(False, "forbidden_public_parameter", forbiddenPaths=public_internals)

    action = _action_for_tool(str(payload.get("_tool") or ""), payload)
    proposal_validation = _validate_action_proposal({
        "screenId": payload.get("screenId"),
        "actorId": payload.get("actorId"),
        "cursorId": payload.get("cursorId"),
        "action": action,
        "target": payload.get("target"),
    })
    if not proposal_validation["ok"]:
        return proposal_validation
    target = payload.get("target")
    if isinstance(target, Mapping):
        target_scope = str(target.get("scope") or "")
        if target_scope.startswith("window") and not (payload.get("windowId") or target.get("windowId")):
            return _validation(False, "missing_window_id_for_window_scope")
    if not isinstance(payload.get("appStateRef"), str) or not payload.get("appStateRef"):
        return _validation(False, "missing_app_state_ref")
    if not isinstance(payload.get("screenshotRef"), str) or not payload.get("screenshotRef"):
        return _validation(False, "missing_screenshot_ref")
    if not isinstance(payload.get("accessibilitySnapshotRef"), str) or not payload.get("accessibilitySnapshotRef"):
        return _validation(False, "missing_accessibility_snapshot_ref")
    if not _string_list(payload.get("beforeEvidenceRefs")):
        return _validation(False, "missing_before_evidence_refs")
    if not _string_list(payload.get("groundingRefs")):
        return _validation(False, "missing_grounding_refs")
    return _validation(True)


def _validate_replay_request(payload: Mapping[str, Any]) -> dict[str, Any]:
    frames = payload.get("frames", [])
    if frames is None:
        frames = []
    if not isinstance(frames, list):
        return _validation(False, "invalid_replay_frames")
    for index, frame in enumerate(frames):
        if not isinstance(frame, Mapping):
            return _validation(False, "invalid_replay_frame", index=index)
        if frame.get("placeholder") is True and not frame.get("screenshotRef"):
            return _validation(False, "placeholder_only_replay_frame", index=index)
        if frame.get("screenshotRef") and not frame.get("screenId"):
            return _validation(False, "missing_screen_id_for_replay_frame", index=index)
    return _validation(True)


def _dispatch_mutating_facade(tool: str, payload: Mapping[str, Any], output_dir: Path | None) -> dict[str, Any]:
    action = _action_for_tool(tool, payload)
    risk_level = str(payload.get("riskLevel") or action.get("riskLevel") or "low")
    target = _record(payload["target"])
    evidence_refs = _scoped_evidence_refs(payload)

    proposal_ref = str(payload.get("proposalRef") or "")
    refs: list[str] = []
    if not proposal_ref:
        proposal_ref = _write_ref(output_dir, "action-proposal", {
            "kind": "action-proposal",
            "publicFacadeTool": tool,
            "displayGroupId": payload.get("displayGroupId"),
            "screenId": payload["screenId"],
            "windowId": payload.get("windowId") or target.get("windowId"),
            "actorId": payload["actorId"],
            "cursorId": payload["cursorId"],
            "action": action,
            "target": target,
            "riskLevel": risk_level,
            "approvalState": "needs-confirmation" if risk_level == "high" else "not-required",
            "sourceAppStateRef": payload.get("appStateRef"),
            "sourceScreenshotRef": payload.get("screenshotRef"),
            "sourceAccessibilitySnapshotRef": payload.get("accessibilitySnapshotRef"),
            "groundingRefs": _string_list(payload.get("groundingRefs")),
        })
        refs.append(proposal_ref)

    if risk_level == "high":
        approval_ref = _write_ref(output_dir, "approval-request", {
            "kind": "approval-request",
            "proposalRef": proposal_ref,
            "riskLevel": "high",
            "screenId": payload["screenId"],
            "windowId": payload.get("windowId") or target.get("windowId"),
            "actorId": payload["actorId"],
            "cursorId": payload["cursorId"],
            "draftRef": payload.get("draftRef"),
            "evidenceRefs": evidence_refs,
        })
        refs.append(approval_ref)
        return _result(
            tool,
            "needs-confirmation",
            "High-risk scoped action stopped before executor projection.",
            refs=refs,
            approvalRequest={
                "approvalRequestRef": approval_ref,
                "proposalRef": proposal_ref,
                "riskLevel": "high",
            },
            value={"actionProposalRef": proposal_ref, "approvalRequestRef": approval_ref},
        )

    lease_scope = _lease_scope_for_payload(payload, target)
    lease_id = f"lease-{_digest({'tool': tool, 'proposalRef': proposal_ref, 'scope': lease_scope})}"
    lease_ref = _write_ref(output_dir, "executor-lease", {
        "kind": "executor-lease",
        "leaseId": lease_id,
        "leaseScope": lease_scope,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": payload["screenId"],
        "windowId": payload.get("windowId") or target.get("windowId"),
        "actorId": payload["actorId"],
        "cursorId": payload["cursorId"],
        "sourceProposalRef": proposal_ref,
        "schedulerProjection": "package-local-native-facade",
        "publicSchedulerInternalsExposed": False,
    })
    executor_event_ref = _write_ref(output_dir, "executor-event", {
        "kind": "executor-event",
        "publicFacadeTool": tool,
        "proposalRef": proposal_ref,
        "leaseRef": lease_ref,
        "leaseScope": lease_scope,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": payload["screenId"],
        "windowId": payload.get("windowId") or target.get("windowId"),
        "actorId": payload["actorId"],
        "cursorId": payload["cursorId"],
        "action": action,
        "target": target,
        "appStateRef": payload.get("appStateRef"),
        "screenshotRef": payload.get("screenshotRef"),
        "accessibilitySnapshotRef": payload.get("accessibilitySnapshotRef"),
        "beforeEvidenceRefs": _string_list(payload.get("beforeEvidenceRefs")),
        "groundingRefs": _string_list(payload.get("groundingRefs")),
        "evidenceRefs": evidence_refs,
        "executorProjection": {
            "kind": "host-bound-scoped-executor",
            "status": "pending",
            "providerRoutePublicParameter": False,
        },
        "mutatingActionExecuted": False,
        "diagnosticOnly": True,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    })
    blocked_ref = _write_ref(output_dir, "blocked-manifest", {
        "kind": "blocked-manifest",
        "blockedAt": tool,
        "proposalRef": proposal_ref,
        "executorLeaseRef": lease_ref,
        "executorEventRef": executor_event_ref,
        "reason": (
            "Package-local native tool facade projected the request into scoped "
            "proposal, lease, executor event, and evidence refs, but did not "
            "perform real desktop input."
        ),
        "requiresHostBoundExecutor": True,
        "diagnosticOnly": True,
    })
    return _result(
        tool,
        "blocked",
        "Scoped action requires a host-bound executor adapter outside package-local debug mode.",
        refs=[*refs, lease_ref, executor_event_ref, blocked_ref],
        value={
            "actionProposalRef": proposal_ref,
            "executorLeaseRef": lease_ref,
            "executorEventRef": executor_event_ref,
            "blockedManifestRef": blocked_ref,
            "evidenceRefs": evidence_refs,
        },
    )


def _action_for_tool(tool: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    if tool == "click":
        return {"kind": "click", "button": payload.get("button", "left")}
    if tool == "type_text":
        return {"kind": "type_text", "textRef": payload.get("textRef"), "text": payload.get("text")}
    if tool == "scroll":
        return {"kind": "scroll", "delta": payload.get("delta")}
    if tool == "press_key":
        return {"kind": "press_key", "key": payload.get("key")}
    return _record(payload.get("action"))


def _lease_scope_for_payload(payload: Mapping[str, Any], target: Mapping[str, Any]) -> dict[str, Any]:
    target_scope = str(target.get("scope") or "")
    window_id = payload.get("windowId") or target.get("windowId")
    if target_scope.startswith("window") or window_id:
        return {
            "kind": "window",
            "screenId": payload["screenId"],
            "windowId": window_id,
        }
    return {
        "kind": "screen",
        "screenId": payload["screenId"],
    }


def _scoped_evidence_refs(payload: Mapping[str, Any]) -> list[str]:
    refs: list[str] = []
    for key in ("appStateRef", "screenshotRef", "accessibilitySnapshotRef"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            refs.append(value)
    refs.extend(_string_list(payload.get("beforeEvidenceRefs")))
    refs.extend(_string_list(payload.get("groundingRefs")))
    ordered: list[str] = []
    for ref in refs:
        if ref not in ordered:
            ordered.append(ref)
    return ordered


def _is_bare_global_target(target: Mapping[str, Any]) -> bool:
    coordinate_space = str(target.get("coordinateSpace") or target.get("coordinate_space") or "").lower()
    has_xy = isinstance(target.get("x"), (int, float)) and isinstance(target.get("y"), (int, float))
    has_scope_binding = any(target.get(key) for key in ("screenId", "windowId", "elementRef", "regionRef", "bounds"))
    return coordinate_space in {"global", "system", "desktop"} or (has_xy and not has_scope_binding)


def _find_forbidden_public_parameters(value: Any, *, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            item_path = f"{path}.{key_text}"
            if key_text in FORBIDDEN_PUBLIC_KEYS:
                found.append(item_path)
            found.extend(_find_forbidden_public_parameters(item, path=item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_find_forbidden_public_parameters(item, path=f"{path}[{index}]"))
    return found


def _find_forbidden_inline_payloads(value: Any, *, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            item_path = f"{path}.{key_text}"
            if key_text in FORBIDDEN_INLINE_KEYS or SECRET_KEY_RE.search(key_text):
                found.append(item_path)
            found.extend(_find_forbidden_inline_payloads(item, path=item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_find_forbidden_inline_payloads(item, path=f"{path}[{index}]"))
    elif isinstance(value, str):
        stripped = value.strip()
        if DATA_IMAGE_RE.match(stripped) or LONG_BASE64_RE.match(stripped):
            found.append(path)
    return found


def _write_ref(output_dir: Path | None, prefix: str, payload: Mapping[str, Any]) -> str:
    if output_dir is None:
        digest = _digest({"prefix": prefix, "payload": payload})
        return f"computer-use-native:{prefix}/{digest}.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "schemaVersion": NATIVE_TOOL_REF_RECORD_SCHEMA,
        "createdAt": _now(),
        **dict(payload),
    }
    digest = _digest(record)
    path = output_dir / f"{prefix}-{digest}.json"
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf8")
    return str(path)


def _result(
    tool: str,
    status: str,
    reason: str,
    *,
    refs: Sequence[str],
    value: Mapping[str, Any] | None = None,
    validation: Mapping[str, Any] | None = None,
    approvalRequest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schemaVersion": NATIVE_TOOL_RESULT_SCHEMA,
        "tool": tool,
        "status": status,
        "reason": reason,
        "refs": list(refs),
        "value": dict(value or {}),
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    if validation is not None:
        result["validation"] = dict(validation)
    if approvalRequest is not None:
        result["approvalRequest"] = dict(approvalRequest)
    return result


def _validation(ok: bool, reason: str = "ok", **extra: Any) -> dict[str, Any]:
    return {"ok": ok, "reason": reason, **extra}


def _record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str) and value:
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item]
    if isinstance(value, tuple):
        return [item for item in value if isinstance(item, str) and item]
    return []


def _load_payload(value: str | None) -> Mapping[str, Any]:
    raw = value if value is not None else input()
    parsed = json.loads(raw or "{}")
    if not isinstance(parsed, Mapping):
        raise ValueError("payload must be a JSON object")
    return parsed


def _digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
