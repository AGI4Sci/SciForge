"""Independent simulated input adapter for Computer Use host executors.

This adapter deliberately does not import or call OS input APIs. It gives a
host-port executor a package-local way to apply generic GUI actions as virtual
pointer and keyboard state transitions, with durable JSON refs for inspection.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, fields, is_dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from .contracts import (
    ActionPlan,
    ActionTarget,
    ComputerUseRequest,
    ExecutionOutcome,
    Grounding,
)
from .isolated_desktop_contracts import REMOTE_DESKTOP_INPUT_CHANNEL
from .safety import assess_action_risk


VIRTUAL_INPUT_ADAPTER_ID = "sciforge.computer-use.virtual-input-adapter"
VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA = "sciforge.computer-use.virtual-input-adapter-manifest.v1"
VIRTUAL_INPUT_METADATA_SCHEMA = "sciforge.computer-use.virtual-input-metadata.v1"
VIRTUAL_INPUT_STATE_SCHEMA = "sciforge.computer-use.virtual-input-state.v1"
VIRTUAL_POINTER_STATE_SCHEMA = "sciforge.computer-use.virtual-pointer-state.v1"
VIRTUAL_KEYBOARD_STATE_SCHEMA = "sciforge.computer-use.virtual-keyboard-state.v1"
INPUT_ADAPTER_TARGET_BINDING_SCHEMA = "sciforge.computer-use.input-adapter-target-binding.v1"
INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA = "sciforge.computer-use.input-adapter-target-binding-validation.v1"
INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA = "sciforge.computer-use.input-adapter-manifest-validation.v1"
INPUT_ADAPTER_BINDING_STATUS_BOUND = "bound"
INPUT_ADAPTER_BINDING_STATUS_UNBOUND = "unbound"
INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY = "virtual-state-only"
VIRTUAL_INPUT_CHANNEL = "virtual-session"
VIRTUAL_INPUT_ADAPTER_STATUS = "independent-simulated-input-adapter"
TARGET_BOUND_READY_INPUT_CHANNEL_VALUES = frozenset({
    "isolated-window",
    "target-bound-simulated-input",
    "independent-simulated-input-adapter",
    REMOTE_DESKTOP_INPUT_CHANNEL,
})

SUPPORTED_SIMULATED_ACTIONS = (
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "wait",
    "focus",
    "save",
)

_INPUT_MODE_KEYS = {
    "adaptermode",
    "executionmode",
    "inputadapter",
    "inputadapterstatus",
    "inputchannel",
    "inputmode",
    "inputsource",
    "inputtransport",
    "sideeffectmode",
}
_ALLOWED_INPUT_MODES = {
    "",
    "dry-run",
    "simulated",
    "state-only",
    "virtual",
    "virtual-session",
    VIRTUAL_INPUT_ADAPTER_STATUS,
}
_BLOCKED_INPUT_MODES = {
    "applescript",
    "global-keyboard",
    "global-mouse",
    "global-system",
    "native",
    "native-input",
    "os",
    "os-input",
    "pynput",
    "pyautogui",
    "quartz",
    "real",
    "real-input",
    "real-os",
    "shared-input",
    "shared-system",
    "system",
    "system-input",
    "xdotool",
}
BLOCKED_INPUT_MODE_VALUES = frozenset(_BLOCKED_INPUT_MODES)
_DIAGNOSTIC_TARGET_ENVIRONMENT_TOKENS = (
    "diagnostic",
    "dryrun",
    "dry-run",
    "fixture",
    "mock",
    "package-local",
    "scripted",
    "simulated-only",
    "state-only",
    "test",
    "virtual",
)
_DIAGNOSTIC_EXECUTOR_PROVIDER_TOKENS = (
    "accessibility",
    "applescript",
    "ax",
    "clipboard",
    "diagnostic",
    "directfilewrite",
    "dom",
    "failclosed",
    "filewrite",
    "osascript",
    "playwright",
    "privateapi",
    "puppeteer",
    "selenium",
    "shell",
    "stateonly",
    "virtualinputstate",
)


@dataclass(frozen=True)
class VirtualInputApplyResult:
    """Result of applying one action to the virtual input state."""

    state: Mapping[str, Any]
    outcome: ExecutionOutcome
    state_refs: Mapping[str, str]


class VirtualInputAdapter:
    """Host-port executor adapter that records simulated input state only."""

    def __init__(
        self,
        state_dir: str | Path,
        *,
        session_id: str | None = None,
        initial_state: Mapping[str, Any] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        self.state_dir = Path(state_dir).expanduser().resolve()
        self.state = (
            _normalize_state(initial_state)
            if initial_state is not None
            else create_virtual_input_state(session_id=session_id, metadata=metadata)
        )
        self.state_refs = write_virtual_input_state_refs(self.state, self.state_dir)
        self.state = {**dict(self.state), "stateRefs": dict(self.state_refs)}

    def execute(
        self,
        action: ActionPlan | Mapping[str, Any],
        grounding: Grounding | Mapping[str, Any] | None,
        request: ComputerUseRequest | Mapping[str, Any] | None = None,
    ) -> ExecutionOutcome:
        """Apply one action as a simulated state transition."""

        applied = apply_virtual_input_action(
            self.state,
            action,
            grounding,
            request,
            state_dir=self.state_dir,
        )
        self.state = dict(applied.state)
        self.state_refs = dict(applied.state_refs)
        return applied.outcome

    apply_action = execute

    def manifest(self) -> dict[str, Any]:
        return get_virtual_input_adapter_manifest(state_refs=self.state_refs)

    def metadata(self) -> dict[str, Any]:
        return build_virtual_input_metadata(state_refs=self.state_refs)


def create_virtual_input_state(
    *,
    session_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a JSON-serializable virtual pointer and keyboard state."""

    safe_session_id = _safe_ref_segment(session_id or "virtual-input")
    return {
        "schemaVersion": VIRTUAL_INPUT_STATE_SCHEMA,
        "adapterId": VIRTUAL_INPUT_ADAPTER_ID,
        "sessionId": safe_session_id,
        "stepIndex": 0,
        "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
        "inputChannel": VIRTUAL_INPUT_CHANNEL,
        "inputIsolation": {
            "independent": True,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "pointer": {
            "schemaVersion": VIRTUAL_POINTER_STATE_SCHEMA,
            "x": None,
            "y": None,
            "coordinateSpace": "observation",
            "focusedTarget": None,
            "lastTarget": None,
            "lastButton": None,
            "clickCount": 0,
            "dragCount": 0,
            "scrollOffset": {"x": 0.0, "y": 0.0},
        },
        "keyboard": {
            "schemaVersion": VIRTUAL_KEYBOARD_STATE_SCHEMA,
            "activeApp": None,
            "focusedTarget": None,
            "lastKeySequence": [],
            "keyEventCount": 0,
            "textInput": {
                "totalCharacters": 0,
                "lastTextLength": 0,
                "lastTextSha256": None,
            },
            "saveCount": 0,
            "saveRefs": [],
            "lastSaveRef": None,
        },
        "actionLog": [],
        "stateRefs": {},
        "metadata": _safe_metadata(metadata or {}),
    }


def apply_virtual_input_action(
    state: Mapping[str, Any],
    action: ActionPlan | Mapping[str, Any],
    grounding: Grounding | Mapping[str, Any] | None = None,
    request: ComputerUseRequest | Mapping[str, Any] | None = None,
    *,
    state_dir: str | Path | None = None,
) -> VirtualInputApplyResult:
    """Apply one generic action to virtual state and optionally write refs."""

    current_state = _normalize_state(state)
    plan = _coerce_action_plan(action)
    block_code, block_reason = _fail_closed_reason(plan, request)
    if block_reason:
        next_state, state_update = _record_action(
            current_state,
            plan,
            grounding,
            status="blocked",
            state_update_kind="blocked",
            details={"blockedCode": block_code, "blockedReason": block_reason},
        )
        state_refs, next_state = _maybe_write_state_refs(next_state, state_dir)
        metadata = build_virtual_input_metadata(
            state_refs=state_refs,
            action_kind=_action_kind(plan),
            state_update=state_update,
            blocked=True,
            reason=block_reason,
            extra={"blockedCode": block_code},
        )
        return VirtualInputApplyResult(
            state=next_state,
            outcome=ExecutionOutcome(
                ok=False,
                blocked=True,
                message=block_reason,
                metadata=metadata,
            ),
            state_refs=state_refs,
        )

    next_state, state_update = _apply_supported_action(current_state, plan, grounding)
    state_refs, next_state = _maybe_write_state_refs(next_state, state_dir)
    metadata = build_virtual_input_metadata(
        state_refs=state_refs,
        action_kind=_action_kind(plan),
        state_update=state_update,
        blocked=False,
    )
    return VirtualInputApplyResult(
        state=next_state,
        outcome=ExecutionOutcome(
            ok=True,
            message=f"Simulated {plan.kind} as a virtual input state update.",
            metadata=metadata,
        ),
        state_refs=state_refs,
    )


def write_virtual_input_state_refs(
    state: Mapping[str, Any],
    state_dir: str | Path,
) -> dict[str, str]:
    """Persist combined, pointer, and keyboard state JSON refs."""

    normalized = _normalize_state(state)
    output_dir = Path(state_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    session_id = _safe_ref_segment(str(normalized.get("sessionId") or "virtual-input"))
    step_index = int(normalized.get("stepIndex") or 0)
    prefix = f"{session_id}-{step_index:04d}"
    refs = {
        "virtualInputStateRef": str((output_dir / f"{prefix}-input-state.json").resolve()),
        "virtualPointerStateRef": str((output_dir / f"{prefix}-pointer-state.json").resolve()),
        "virtualKeyboardStateRef": str((output_dir / f"{prefix}-keyboard-state.json").resolve()),
    }
    pointer_payload = {
        **dict(normalized["pointer"]),
        "stateRef": refs["virtualPointerStateRef"],
        "parentStateRef": refs["virtualInputStateRef"],
    }
    keyboard_payload = {
        **dict(normalized["keyboard"]),
        "stateRef": refs["virtualKeyboardStateRef"],
        "parentStateRef": refs["virtualInputStateRef"],
    }
    input_payload = {
        **normalized,
        "stateRefs": refs,
        "pointer": pointer_payload,
        "keyboard": keyboard_payload,
    }
    _write_json(Path(refs["virtualPointerStateRef"]), pointer_payload)
    _write_json(Path(refs["virtualKeyboardStateRef"]), keyboard_payload)
    _write_json(Path(refs["virtualInputStateRef"]), input_payload)
    return refs


def load_virtual_input_state(ref: str | Path) -> dict[str, Any]:
    """Load a previously written virtual input state ref."""

    parsed = json.loads(Path(ref).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Virtual input state ref must contain a JSON object.")
    return dict(parsed)


def build_virtual_input_metadata(
    *,
    state_refs: Mapping[str, str] | None = None,
    action_kind: str | None = None,
    state_update: Mapping[str, Any] | None = None,
    blocked: bool = False,
    reason: str | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build metadata for an ExecutionOutcome emitted by this adapter."""

    refs = dict(state_refs or {})
    metadata = {
        "schemaVersion": VIRTUAL_INPUT_METADATA_SCHEMA,
        "adapterId": VIRTUAL_INPUT_ADAPTER_ID,
        "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
        "inputChannel": VIRTUAL_INPUT_CHANNEL,
        "executionMode": "simulated",
        "sideEffectClass": "virtual-state-only",
        "actionKind": action_kind,
        "simulatedStateUpdated": not blocked,
        "stateRefWritten": bool(refs),
        "stateRefs": refs,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "mouseMoved": False,
        "keyboardEventsSent": False,
        "blocked": blocked,
        "reason": reason,
        "stateUpdate": dict(state_update or {}),
    }
    metadata.update(refs)
    if extra:
        metadata.update(_safe_metadata(extra))
    return metadata


virtual_input_metadata = build_virtual_input_metadata


def get_virtual_input_adapter_manifest(
    *,
    state_refs: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return a manifest fragment host executors can advertise."""

    manifest = {
        "schemaVersion": VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA,
        "id": VIRTUAL_INPUT_ADAPTER_ID,
        "kind": "host-port-executor-adapter",
        "status": "ready",
        "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
        "inputChannel": VIRTUAL_INPUT_CHANNEL,
        "executorProvider": "virtual-input-state-executor",
        "hostPortUsage": {
            "port": "execute",
            "call": "VirtualInputAdapter.execute(action, grounding, request)",
            "returns": "ExecutionOutcome",
        },
        "supportedActions": list(SUPPORTED_SIMULATED_ACTIONS),
        "stateSchemas": {
            "input": VIRTUAL_INPUT_STATE_SCHEMA,
            "pointer": VIRTUAL_POINTER_STATE_SCHEMA,
            "keyboard": VIRTUAL_KEYBOARD_STATE_SCHEMA,
        },
        "stateRefs": dict(state_refs or {}),
        "bindingStatus": "unbound",
        "bindingManifestSchema": INPUT_ADAPTER_TARGET_BINDING_SCHEMA,
        "targetBindingRequiredForRealDesktopEvidence": True,
        "executeChangesTargetEnvironment": False,
        "realWindowEvidenceCapable": False,
        "sideEffects": {
            "simulatedStateOnly": True,
            "realOsInput": False,
            "sharedSystemInput": False,
            "systemPointerMove": False,
            "systemKeyboardEvent": False,
        },
        "failClosedFor": [
            "unsupported-action",
            "high-risk-action",
            "real-input-mode",
            "shared-system-input",
        ],
        "blockedInputModes": sorted(_BLOCKED_INPUT_MODES),
        "projectConstraint": (
            "Maintains virtual pointer and keyboard state refs only; it never "
            "moves the OS pointer or sends global keyboard events."
        ),
    }
    return manifest


def build_target_bound_input_adapter_manifest(
    *,
    executor_provider: str,
    input_channel: str = "isolated-window",
    adapter_id: str = "sciforge.computer-use.target-bound-input-adapter",
    supported_actions: Sequence[str] | None = None,
    state_refs: Mapping[str, str] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the host-declared manifest required before real desktop preflight.

    This manifest still does not prove a task succeeded. It only declares that a
    host-owned executor is target-bound, isolated from shared OS input, and
    capable of changing a verifiable target environment.
    """

    actions = list(supported_actions or SUPPORTED_SIMULATED_ACTIONS)
    return {
        "schemaVersion": VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA,
        "id": adapter_id,
        "kind": "host-port-executor-adapter",
        "status": "ready",
        "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
        "inputChannel": input_channel,
        "executorProvider": executor_provider,
        "hostPortUsage": {
            "port": "execute",
            "call": "host-owned target-bound executor applies generic GUI actions",
            "returns": "ExecutionOutcome",
        },
        "supportedActions": actions,
        "stateSchemas": {
            "input": VIRTUAL_INPUT_STATE_SCHEMA,
            "pointer": VIRTUAL_POINTER_STATE_SCHEMA,
            "keyboard": VIRTUAL_KEYBOARD_STATE_SCHEMA,
        },
        "stateRefs": dict(state_refs or {}),
        "bindingStatus": "requires-target-binding",
        "bindingManifestSchema": INPUT_ADAPTER_TARGET_BINDING_SCHEMA,
        "targetBindingRequiredForRealDesktopEvidence": True,
        "executeChangesTargetEnvironment": True,
        "realWindowEvidenceCapable": True,
        "sideEffects": {
            "simulatedStateOnly": False,
            "realOsInput": False,
            "sharedSystemInput": False,
            "systemPointerMove": False,
            "systemKeyboardEvent": False,
        },
        "failClosedFor": [
            "unsupported-action",
            "high-risk-action",
            "unbound-target-environment",
            "real-input-mode",
            "shared-system-input",
        ],
        "blockedInputModes": sorted(_BLOCKED_INPUT_MODES),
        "claimLimit": (
            "Declares a target-bound independent input adapter for desktop preflight only; "
            "it is not B/C/verifier completion evidence without a real run trace."
        ),
        "metadata": _safe_metadata(metadata or {}),
    }


def validate_input_adapter_manifest_for_real_desktop(
    value: Mapping[str, Any] | str | Path | None,
) -> dict[str, Any]:
    """Validate that an input adapter manifest can participate in ready preflight."""

    manifest_ref: str | None = None
    try:
        if value is None:
            manifest: Mapping[str, Any] = {}
        else:
            manifest = load_input_adapter_manifest(value)
            if not isinstance(value, Mapping):
                manifest_ref = str(Path(value).expanduser().resolve())
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        manifest = {}
        manifest_ref = str(value) if value is not None else None
        load_error = f"adapter manifest could not be loaded: {exc}"
    else:
        load_error = ""
    errors: list[str] = []
    if load_error:
        errors.append(load_error)
    errors.extend(_real_desktop_adapter_manifest_errors_from_payload(manifest))
    return {
        "schemaVersion": INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA,
        "ok": not errors,
        "errors": errors,
        "adapterManifestRef": manifest_ref,
        "schemaRef": manifest.get("schemaVersion"),
        "inputAdapterStatus": manifest.get("inputAdapterStatus"),
        "inputChannel": manifest.get("inputChannel"),
        "executorProvider": manifest.get("executorProvider"),
        "executeChangesTargetEnvironment": manifest.get("executeChangesTargetEnvironment"),
        "realWindowEvidenceCapable": manifest.get("realWindowEvidenceCapable"),
    }


def load_input_adapter_manifest(value: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    path = Path(value).expanduser()
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("Input adapter manifest root must be an object.")
    return parsed


def build_input_adapter_target_binding_manifest(
    *,
    binding_status: str = INPUT_ADAPTER_BINDING_STATUS_UNBOUND,
    target_environment_kind: str | None = None,
    target_window_resolved: bool = False,
    execute_changes_target_environment: bool = False,
    real_window_evidence_capable: bool = False,
    adapter_manifest_ref: str | None = None,
    target_window_ref: str | None = None,
    evidence_refs: Sequence[str] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a refs-first target binding manifest for independent input adapters.

    The default manifest is intentionally unbound. A host must explicitly prove
    a bound target environment before real desktop preflight can become ready.
    """

    return {
        "schemaVersion": INPUT_ADAPTER_TARGET_BINDING_SCHEMA,
        "bindingStatus": binding_status,
        "targetEnvironmentKind": target_environment_kind,
        "targetWindowResolved": bool(target_window_resolved),
        "executeChangesTargetEnvironment": bool(execute_changes_target_environment),
        "realWindowEvidenceCapable": bool(real_window_evidence_capable),
        "adapterManifestRef": adapter_manifest_ref,
        "targetWindowRef": target_window_ref,
        "evidenceRefs": [ref for ref in evidence_refs or [] if isinstance(ref, str) and ref],
        "osInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "metadata": _safe_metadata(metadata or {}),
    }


def load_input_adapter_target_binding_manifest(value: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    """Load a target binding manifest from a mapping or local JSON ref."""

    if isinstance(value, Mapping):
        return value
    path = Path(value).expanduser()
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("Input adapter target binding manifest root must be an object.")
    return parsed


def validate_input_adapter_target_binding_manifest(
    value: Mapping[str, Any] | str | Path | None,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate that a target binding can support real desktop evidence claims."""

    manifest_ref: str | None = None
    try:
        if value is None:
            manifest = {}
        else:
            manifest = load_input_adapter_target_binding_manifest(value)
            if not isinstance(value, Mapping):
                manifest_ref = str(Path(value).expanduser().resolve())
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        manifest = {}
        manifest_ref = str(value) if value is not None else None
        load_error = f"binding manifest could not be loaded: {exc}"
    else:
        load_error = ""
    errors: list[str] = []
    if load_error:
        errors.append(load_error)
    if manifest.get("schemaVersion") != INPUT_ADAPTER_TARGET_BINDING_SCHEMA:
        errors.append("binding manifest schemaVersion is not sciforge.computer-use.input-adapter-target-binding.v1")
    if manifest.get("bindingStatus") != INPUT_ADAPTER_BINDING_STATUS_BOUND:
        errors.append("bindingStatus must be bound")
    target_environment_kind = _string_or_empty(manifest.get("targetEnvironmentKind"))
    if not target_environment_kind:
        errors.append("targetEnvironmentKind is required")
    elif _target_environment_is_diagnostic_or_virtual(target_environment_kind):
        errors.append("targetEnvironmentKind must describe a real target-bound environment, not virtual/diagnostic/state-only")
    adapter_manifest_ref = _string_or_empty(manifest.get("adapterManifestRef"))
    target_window_ref = _string_or_empty(manifest.get("targetWindowRef"))
    evidence_refs = _string_values(manifest.get("evidenceRefs"))
    if not adapter_manifest_ref:
        errors.append("adapterManifestRef is required")
    if not target_window_ref:
        errors.append("targetWindowRef is required")
    if not evidence_refs:
        errors.append("evidenceRefs must include at least one ref")
    if require_existing_refs:
        for label, ref in (
            ("adapterManifestRef", adapter_manifest_ref),
            ("targetWindowRef", target_window_ref),
        ):
            if ref and not Path(ref).expanduser().is_file():
                errors.append(f"{label} must point to an existing local file")
        if adapter_manifest_ref and Path(adapter_manifest_ref).expanduser().is_file():
            errors.extend(validate_input_adapter_manifest_for_real_desktop(adapter_manifest_ref)["errors"])
        for ref in evidence_refs:
            if not Path(ref).expanduser().is_file():
                errors.append("evidenceRefs must point to existing local files")
                break
    if manifest.get("targetWindowResolved") is not True:
        errors.append("targetWindowResolved must be true")
    if manifest.get("executeChangesTargetEnvironment") is not True:
        errors.append("executeChangesTargetEnvironment must be true")
    if manifest.get("realWindowEvidenceCapable") is not True:
        errors.append("realWindowEvidenceCapable must be true")
    if manifest.get("osInputExecuted") is not False:
        errors.append("osInputExecuted must be false")
    if manifest.get("sharedSystemInputUsed") is not False:
        errors.append("sharedSystemInputUsed must be false")
    if manifest.get("systemPointerMoved") is not False:
        errors.append("systemPointerMoved must be false")
    if manifest.get("systemKeyboardEventsSent") is not False:
        errors.append("systemKeyboardEventsSent must be false")
    return {
        "schemaVersion": INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA,
        "ok": not errors,
        "errors": errors,
        "requireExistingRefs": bool(require_existing_refs),
        "bindingManifestRef": manifest_ref,
        "bindingStatus": manifest.get("bindingStatus"),
        "targetEnvironmentKind": target_environment_kind or manifest.get("targetEnvironmentKind"),
        "adapterManifestRef": adapter_manifest_ref or None,
        "targetWindowRef": target_window_ref or None,
        "evidenceRefs": evidence_refs,
        "targetWindowResolved": manifest.get("targetWindowResolved"),
        "executeChangesTargetEnvironment": manifest.get("executeChangesTargetEnvironment"),
        "realWindowEvidenceCapable": manifest.get("realWindowEvidenceCapable"),
    }


def _real_desktop_adapter_manifest_errors_from_payload(parsed: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    if parsed.get("schemaVersion") != VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA:
        errors.append("adapter manifest schemaVersion is not sciforge.computer-use.virtual-input-adapter-manifest.v1")
    if parsed.get("inputAdapterStatus") != VIRTUAL_INPUT_ADAPTER_STATUS:
        errors.append("adapter manifest inputAdapterStatus must be independent-simulated-input-adapter")
    input_channel = _normalize_mode(_string_or_empty(parsed.get("inputChannel")))
    if input_channel not in {_normalize_mode(value) for value in TARGET_BOUND_READY_INPUT_CHANNEL_VALUES}:
        errors.append("adapter manifest inputChannel must be target-bound isolated input")
    executor_provider = _normalize_mode(_string_or_empty(parsed.get("executorProvider"))).replace("-", "")
    if not executor_provider or any(token in executor_provider for token in _DIAGNOSTIC_EXECUTOR_PROVIDER_TOKENS):
        errors.append("adapter manifest executorProvider must be target-bound and non-diagnostic")
    if parsed.get("executeChangesTargetEnvironment") is not True:
        errors.append("adapter manifest executeChangesTargetEnvironment must be true")
    if parsed.get("realWindowEvidenceCapable") is not True:
        errors.append("adapter manifest realWindowEvidenceCapable must be true")
    if parsed.get("targetBindingRequiredForRealDesktopEvidence") is not True:
        errors.append("adapter manifest targetBindingRequiredForRealDesktopEvidence must be true")
    side_effects_value = parsed.get("sideEffects")
    if not isinstance(side_effects_value, Mapping):
        errors.append("adapter manifest sideEffects must be declared")
        side_effects: Mapping[str, Any] = {}
    else:
        side_effects = side_effects_value
    if side_effects.get("simulatedStateOnly") is not False:
        errors.append("adapter manifest sideEffects.simulatedStateOnly must be false")
    if side_effects.get("realOsInput") is not False:
        errors.append("adapter manifest sideEffects.realOsInput must be false")
    if side_effects.get("sharedSystemInput") is not False:
        errors.append("adapter manifest sideEffects.sharedSystemInput must be false")
    if side_effects.get("systemPointerMove") is not False:
        errors.append("adapter manifest sideEffects.systemPointerMove must be false")
    if side_effects.get("systemKeyboardEvent") is not False:
        errors.append("adapter manifest sideEffects.systemKeyboardEvent must be false")
    return errors


def _target_environment_is_diagnostic_or_virtual(value: str) -> bool:
    normalized = _normalize_mode(value).replace("_", "-")
    compact = normalized.replace("-", "")
    return any(token.replace("-", "") in compact for token in _DIAGNOSTIC_TARGET_ENVIRONMENT_TOKENS)


def _apply_supported_action(
    state: Mapping[str, Any],
    plan: ActionPlan,
    grounding: Grounding | Mapping[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    kind = _action_kind(plan)
    if kind in {"click", "double_click"}:
        details = _pointer_to_grounding_details(kind, plan, grounding)
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind=kind,
            details=details,
        )
    if kind == "focus":
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="focus",
            details=_pointer_to_grounding_details(kind, plan, grounding),
        )
    if kind == "type_text":
        text = plan.text or ""
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="text-input",
            details={
                "textLength": len(text),
                "textSha256": _sha256(text) if text else None,
            },
        )
    if kind in {"press_key", "hotkey"}:
        keys = _plan_keys(plan)
        state_update_kind = "save" if _is_save_intent(plan) else "key-input"
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind=state_update_kind,
            details={
                "keys": keys,
                "saveRef": _save_ref(plan, state) if state_update_kind == "save" else None,
            },
        )
    if kind == "save":
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="save",
            details={"saveRef": _save_ref(plan, state)},
        )
    if kind == "scroll":
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="scroll",
            details=_scroll_details(plan),
        )
    if kind == "drag":
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="drag",
            details=_pointer_to_grounding_details(kind, plan, grounding),
        )
    if kind == "open_app":
        return _record_action(
            state,
            plan,
            grounding,
            status="simulated",
            state_update_kind="open-app",
            details={"appName": plan.app_name or _target_record(plan).get("description")},
        )
    return _record_action(
        state,
        plan,
        grounding,
        status="simulated",
        state_update_kind="wait",
        details={},
    )


def _record_action(
    state: Mapping[str, Any],
    plan: ActionPlan,
    grounding: Grounding | Mapping[str, Any] | None,
    *,
    status: str,
    state_update_kind: str,
    details: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    next_state = _normalize_state(state)
    next_state["stepIndex"] = int(next_state.get("stepIndex") or 0) + 1
    pointer = dict(next_state["pointer"])
    keyboard = dict(next_state["keyboard"])
    target = _target_record(plan)
    grounding_record = _grounding_record(grounding)
    kind = _action_kind(plan)

    if state_update_kind in {"click", "double_click", "focus", "drag"}:
        _apply_grounding_to_pointer(pointer, grounding_record)
        pointer["focusedTarget"] = target or None
        pointer["lastTarget"] = target or None
        keyboard["focusedTarget"] = target or keyboard.get("focusedTarget")
    if state_update_kind == "double_click":
        pointer["lastButton"] = "left"
        pointer["clickCount"] = int(pointer.get("clickCount") or 0) + 2
    elif kind == "click":
        pointer["lastButton"] = "left"
        pointer["clickCount"] = int(pointer.get("clickCount") or 0) + 1
    elif state_update_kind == "drag":
        pointer["dragCount"] = int(pointer.get("dragCount") or 0) + 1
    elif state_update_kind == "text-input":
        text_input = dict(keyboard.get("textInput") or {})
        text_length = int(details.get("textLength") or 0)
        text_input["totalCharacters"] = int(text_input.get("totalCharacters") or 0) + text_length
        text_input["lastTextLength"] = text_length
        text_input["lastTextSha256"] = details.get("textSha256")
        keyboard["textInput"] = text_input
    elif state_update_kind == "key-input":
        keys = list(details.get("keys") or [])
        keyboard["lastKeySequence"] = keys
        keyboard["keyEventCount"] = int(keyboard.get("keyEventCount") or 0) + 1
    elif state_update_kind == "save":
        keys = list(details.get("keys") or [])
        if keys:
            keyboard["lastKeySequence"] = keys
            keyboard["keyEventCount"] = int(keyboard.get("keyEventCount") or 0) + 1
        save_ref = str(details.get("saveRef") or _save_ref(plan, state))
        save_refs = list(keyboard.get("saveRefs") or [])
        save_refs.append(save_ref)
        keyboard["saveRefs"] = save_refs
        keyboard["lastSaveRef"] = save_ref
        keyboard["saveCount"] = int(keyboard.get("saveCount") or 0) + 1
    elif state_update_kind == "scroll":
        scroll = dict(pointer.get("scrollOffset") or {})
        scroll["x"] = float(scroll.get("x") or 0.0) + float(details.get("deltaX") or 0.0)
        scroll["y"] = float(scroll.get("y") or 0.0) + float(details.get("deltaY") or 0.0)
        pointer["scrollOffset"] = scroll
    elif state_update_kind == "open-app":
        keyboard["activeApp"] = details.get("appName")
    elif state_update_kind == "blocked":
        pass

    next_state["pointer"] = pointer
    next_state["keyboard"] = keyboard
    state_update = {
        "kind": kind,
        "stateUpdateKind": state_update_kind,
        "status": status,
        "details": _safe_metadata(details),
        "target": target or None,
        "grounding": grounding_record or None,
        "simulated": True,
        "osSideEffect": False,
    }
    entry = {
        "index": next_state["stepIndex"],
        "kind": kind,
        "status": status,
        "stateUpdateKind": state_update_kind,
        "target": target or None,
        "grounding": grounding_record or None,
        "metadata": _safe_metadata(plan.metadata),
        "stateUpdate": state_update,
        "inputChannel": VIRTUAL_INPUT_CHANNEL,
        "simulated": True,
        "osSideEffect": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    next_state["actionLog"] = [*list(next_state.get("actionLog") or []), entry]
    next_state["lastAction"] = entry
    return next_state, state_update


def _fail_closed_reason(
    plan: ActionPlan,
    request: ComputerUseRequest | Mapping[str, Any] | None,
) -> tuple[str | None, str | None]:
    input_mode = _blocked_input_mode(plan, request)
    if input_mode:
        return (
            "real-input-mode",
            (
                "Virtual input adapter rejects real/shared system input mode "
                f"{input_mode!r}; only virtual-session state updates are allowed."
            ),
        )
    kind = _action_kind(plan)
    if not kind:
        return "empty-action", "Virtual input adapter received no action kind; failing closed."
    if kind not in SUPPORTED_SIMULATED_ACTIONS:
        return (
            "unsupported-action",
            f"Virtual input adapter does not support action kind {kind!r}; failing closed.",
        )
    risk = assess_action_risk(plan, fail_closed=True)
    if risk.blocked or risk.needs_confirmation or risk.level == "high":
        return "high-risk-action", risk.reason
    return None, None


def _blocked_input_mode(
    plan: ActionPlan,
    request: ComputerUseRequest | Mapping[str, Any] | None,
) -> str | None:
    for value in [
        *_input_mode_values(plan.metadata),
        *_input_mode_values(_request_metadata(request)),
    ]:
        normalized = _normalize_mode(value)
        if normalized in _ALLOWED_INPUT_MODES:
            continue
        if normalized in _BLOCKED_INPUT_MODES:
            return normalized
        if ("shared" in normalized and "system" in normalized) or (
            "real" in normalized and "input" in normalized
        ):
            return normalized
        if normalized.startswith(("os-", "system-", "global-")):
            return normalized
    return None


def _input_mode_values(value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized_key = str(key).replace("_", "").replace("-", "").lower()
            if normalized_key in _INPUT_MODE_KEYS:
                values.extend(_string_values(item))
            elif isinstance(item, (Mapping, list, tuple)):
                values.extend(_input_mode_values(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            values.extend(_input_mode_values(item))
    return values


def _normalize_state(state: Mapping[str, Any] | None) -> dict[str, Any]:
    base = create_virtual_input_state()
    if not isinstance(state, Mapping):
        return base
    merged = copy.deepcopy(dict(state))
    merged.setdefault("schemaVersion", VIRTUAL_INPUT_STATE_SCHEMA)
    merged.setdefault("adapterId", VIRTUAL_INPUT_ADAPTER_ID)
    merged.setdefault("sessionId", base["sessionId"])
    merged.setdefault("stepIndex", 0)
    merged.setdefault("inputAdapterStatus", VIRTUAL_INPUT_ADAPTER_STATUS)
    merged.setdefault("inputChannel", VIRTUAL_INPUT_CHANNEL)
    merged.setdefault("inputIsolation", base["inputIsolation"])
    merged.setdefault("pointer", base["pointer"])
    merged.setdefault("keyboard", base["keyboard"])
    merged.setdefault("actionLog", [])
    merged.setdefault("stateRefs", {})
    merged.setdefault("metadata", {})
    return _json_safe(merged)


def _maybe_write_state_refs(
    state: Mapping[str, Any],
    state_dir: str | Path | None,
) -> tuple[dict[str, str], dict[str, Any]]:
    if state_dir is None:
        return {}, dict(state)
    refs = write_virtual_input_state_refs(state, state_dir)
    return refs, {**dict(state), "stateRefs": refs}


def _coerce_action_plan(action: ActionPlan | Mapping[str, Any]) -> ActionPlan:
    if isinstance(action, ActionPlan):
        return action
    if not isinstance(action, Mapping):
        return ActionPlan(reason="Virtual input adapter received a non-mapping action.")
    target_value = action.get("target")
    if isinstance(target_value, ActionTarget):
        target = target_value
    elif isinstance(target_value, str):
        target = ActionTarget(description=target_value)
    elif isinstance(target_value, Mapping):
        target = ActionTarget(
            description=str(target_value.get("description") or target_value.get("targetDescription") or ""),
            region_description=target_value.get("region_description") or target_value.get("targetRegionDescription"),
            ref=target_value.get("ref"),
        )
    elif action.get("targetDescription"):
        target = ActionTarget(
            description=str(action.get("targetDescription")),
            region_description=action.get("targetRegionDescription"),
            ref=action.get("targetRef"),
        )
    else:
        target = None
    return ActionPlan(
        kind=action.get("kind") or action.get("type"),  # type: ignore[arg-type]
        target=target,
        text=action.get("text"),
        key=action.get("key"),
        keys=tuple(str(key) for key in action.get("keys") or []),
        direction=action.get("direction"),
        amount=float(action.get("amount") or 1.0),
        app_name=action.get("app_name") or action.get("appName"),
        done=bool(action.get("done") or False),
        reason=str(action.get("reason") or ""),
        risk_level=action.get("risk_level") or action.get("riskLevel") or "low",  # type: ignore[arg-type]
        requires_confirmation=bool(action.get("requires_confirmation") or action.get("requiresConfirmation") or False),
        metadata=_safe_metadata(action.get("metadata") or {}),
    )


def _request_metadata(request: ComputerUseRequest | Mapping[str, Any] | None) -> Mapping[str, Any]:
    if isinstance(request, ComputerUseRequest):
        return request.metadata
    if isinstance(request, Mapping):
        value = request.get("metadata")
        return value if isinstance(value, Mapping) else {}
    return {}


def _action_kind(plan: ActionPlan) -> str:
    return str(plan.kind or "").strip()


def _target_record(plan: ActionPlan) -> dict[str, Any]:
    if plan.target is not None:
        return {
            "description": plan.target.description,
            "regionDescription": plan.target.region_description,
            "ref": plan.target.ref,
        }
    if plan.app_name:
        return {"description": plan.app_name, "regionDescription": None, "ref": None}
    return {}


def _grounding_record(grounding: Grounding | Mapping[str, Any] | None) -> dict[str, Any]:
    if grounding is None:
        return {}
    if isinstance(grounding, Grounding):
        return {
            "ok": grounding.ok,
            "x": grounding.x,
            "y": grounding.y,
            "coordinateSpace": grounding.coordinate_space,
            "confidence": grounding.confidence,
            "reason": grounding.reason,
            "metadata": _safe_metadata(grounding.metadata),
        }
    if isinstance(grounding, Mapping):
        coordinates = grounding.get("coordinates")
        x = grounding.get("x")
        y = grounding.get("y")
        if isinstance(coordinates, Sequence) and not isinstance(coordinates, str) and len(coordinates) >= 2:
            x, y = coordinates[0], coordinates[1]
        return {
            "ok": bool(grounding.get("ok", x is not None and y is not None)),
            "x": float(x) if x is not None else None,
            "y": float(y) if y is not None else None,
            "coordinateSpace": str(grounding.get("coordinateSpace") or grounding.get("coordinate_space") or "observation"),
            "confidence": grounding.get("confidence"),
            "reason": str(grounding.get("reason") or grounding.get("message") or ""),
            "metadata": _safe_metadata(grounding.get("metadata") or {}),
        }
    return {}


def _apply_grounding_to_pointer(pointer: dict[str, Any], grounding_record: Mapping[str, Any]) -> None:
    if grounding_record.get("x") is not None:
        pointer["x"] = grounding_record.get("x")
    if grounding_record.get("y") is not None:
        pointer["y"] = grounding_record.get("y")
    if grounding_record.get("coordinateSpace"):
        pointer["coordinateSpace"] = grounding_record.get("coordinateSpace")


def _pointer_to_grounding_details(
    kind: str,
    plan: ActionPlan,
    grounding: Grounding | Mapping[str, Any] | None,
) -> dict[str, Any]:
    return {
        "action": kind,
        "target": _target_record(plan) or None,
        "grounding": _grounding_record(grounding) or None,
    }


def _scroll_details(plan: ActionPlan) -> dict[str, float | str]:
    amount = float(plan.amount or 1.0)
    direction = str(plan.direction or "down").lower()
    if direction == "up":
        return {"direction": direction, "deltaX": 0.0, "deltaY": -amount}
    if direction == "left":
        return {"direction": direction, "deltaX": -amount, "deltaY": 0.0}
    if direction == "right":
        return {"direction": direction, "deltaX": amount, "deltaY": 0.0}
    return {"direction": "down", "deltaX": 0.0, "deltaY": amount}


def _plan_keys(plan: ActionPlan) -> list[str]:
    keys = [str(key) for key in plan.keys if str(key).strip()]
    if not keys and plan.key:
        keys = [str(plan.key)]
    return keys


def _is_save_intent(plan: ActionPlan) -> bool:
    metadata = plan.metadata
    intent = str(metadata.get("intent") or metadata.get("actionIntent") or "").strip().lower()
    if intent == "save":
        return True
    keys = [key.strip().lower() for key in _plan_keys(plan)]
    normalized = ["command" if key in {"cmd", "meta"} else key for key in keys]
    return normalized in (["command", "s"], ["ctrl", "s"], ["control", "s"])


def _save_ref(plan: ActionPlan, state: Mapping[str, Any]) -> str:
    metadata = plan.metadata
    for key in ("saveRef", "savedStateRef", "finalArtifactRef", "artifactRef", "outputRef"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    session_id = _safe_ref_segment(str(state.get("sessionId") or "virtual-input"))
    step_index = int(state.get("stepIndex") or 0) + 1
    return f"virtual-save:{session_id}:{step_index:04d}"


def _safe_metadata(value: Mapping[str, Any] | Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {"value": _json_safe(value)}
    safe: dict[str, Any] = {}
    for key, item in value.items():
        key_text = str(key)
        normalized = key_text.replace("_", "").replace("-", "").lower()
        if any(token in normalized for token in ("secret", "password", "credential", "token", "apikey")):
            safe[key_text] = "[REDACTED]"
        else:
            safe[key_text] = _json_safe(item)
    return safe


def _json_safe(value: Any) -> Any:
    if is_dataclass(value):
        return {field.name: _json_safe(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _string_values(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple)):
        return [item for nested in value for item in _string_values(nested)]
    return []


def _string_or_empty(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalize_mode(value: str) -> str:
    return value.strip().replace("_", "-").lower()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf8")).hexdigest()


def _safe_ref_segment(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.strip())
    return cleaned.strip("-") or "virtual-input"


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(_json_safe(payload), indent=2, sort_keys=True)}\n", encoding="utf8")


__all__ = [
    "SUPPORTED_SIMULATED_ACTIONS",
    "BLOCKED_INPUT_MODE_VALUES",
    "TARGET_BOUND_READY_INPUT_CHANNEL_VALUES",
    "VIRTUAL_INPUT_ADAPTER_ID",
    "VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA",
    "VIRTUAL_INPUT_ADAPTER_STATUS",
    "VIRTUAL_INPUT_CHANNEL",
    "VIRTUAL_INPUT_METADATA_SCHEMA",
    "VIRTUAL_INPUT_STATE_SCHEMA",
    "INPUT_ADAPTER_BINDING_STATUS_BOUND",
    "INPUT_ADAPTER_BINDING_STATUS_UNBOUND",
    "INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY",
    "INPUT_ADAPTER_TARGET_BINDING_SCHEMA",
    "INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA",
    "VirtualInputAdapter",
    "VirtualInputApplyResult",
    "apply_virtual_input_action",
    "build_input_adapter_target_binding_manifest",
    "build_target_bound_input_adapter_manifest",
    "build_virtual_input_metadata",
    "create_virtual_input_state",
    "get_virtual_input_adapter_manifest",
    "INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA",
    "load_input_adapter_manifest",
    "load_input_adapter_target_binding_manifest",
    "load_virtual_input_state",
    "validate_input_adapter_manifest_for_real_desktop",
    "validate_input_adapter_target_binding_manifest",
    "virtual_input_metadata",
    "write_virtual_input_state_refs",
]
