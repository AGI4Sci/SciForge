"""Diagnostic-only action plan contract for isolated desktop L3 workflows."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l3-workflow-action-plan.v1"
)
ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l3-workflow-action-plan-validation.v1"
)

L3_WORKFLOW_ACTION_PHASES = ("source", "writer", "save", "preview", "validate")
REQUIRED_PER_ACTION_REFS = ("screenshotRef", "observationRef")

_ACTION_SPECS = (
    {
        "phase": "source",
        "appRole": "source-reader",
        "expectedModality": "observation",
        "requiredRefs": ("screenshotRef", "observationRef", "sourceRef"),
    },
    {
        "phase": "writer",
        "appRole": "artifact-writer",
        "expectedModality": "keyboard-and-pointer",
        "requiredRefs": ("screenshotRef", "observationRef", "draftArtifactRef"),
    },
    {
        "phase": "save",
        "appRole": "artifact-writer",
        "expectedModality": "gui-save",
        "requiredRefs": ("screenshotRef", "observationRef", "finalArtifactRef"),
    },
    {
        "phase": "preview",
        "appRole": "file-preview",
        "expectedModality": "gui-pointer",
        "requiredRefs": ("screenshotRef", "observationRef", "previewRef"),
    },
    {
        "phase": "validate",
        "appRole": "artifact-validator",
        "expectedModality": "observation",
        "requiredRefs": ("screenshotRef", "observationRef", "artifactValidationRef"),
    },
)

_ALLOWED_STATUSES = ("planned", "blocked", "draft")
_FORBIDDEN_TOP_LEVEL_KEYS = (
    "userAcceptanceEligible",
    "completedEvidenceRef",
    "completionEvidenceRef",
)
_FORBIDDEN_REF_TOKENS = (
    "shell",
    "stdout",
    "stderr",
    "rawpayload",
    "inlineimage",
    "payload",
)


def build_isolated_desktop_l3_workflow_action_plan(
    *,
    workflow_ref: str | None = None,
    actions: Sequence[Mapping[str, Any]] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a refs-first L3 workflow action plan without claiming completion."""

    plan: dict[str, Any] = {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION,
        "status": "planned",
        "category": "isolated-desktop-l3-workflow-action-plan",
        "workflowKind": "multi-app-document-artifact",
        "diagnosticOnly": True,
        "workflowRef": workflow_ref,
        "phaseOrder": list(L3_WORKFLOW_ACTION_PHASES),
        "requiredRefs": list(REQUIRED_PER_ACTION_REFS),
        "actions": (
            [_copy_action(action) for action in actions]
            if actions is not None
            else _default_actions()
        ),
        "executionPolicy": {
            "executeGui": False,
            "writeCompletedEvidence": False,
            "readShellArtifacts": False,
            "declareUserAcceptanceEligibility": False,
        },
        "claimLimit": (
            "Diagnostic action plan only; required refs must be produced by a real "
            "same-session L3 runner before completed evidence can be considered."
        ),
    }
    if metadata:
        plan["metadata"] = dict(metadata)
    return plan


def validate_isolated_desktop_l3_workflow_action_plan(
    plan_or_ref: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate the L3 workflow action plan contract without dereferencing refs."""

    try:
        plan, plan_ref = _load_plan_with_ref(plan_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            None,
            plan_ref=str(plan_or_ref),
            errors=[
                _error(
                    "plan_load_failed",
                    f"Isolated desktop L3 workflow action plan could not be loaded: {exc}.",
                    "$",
                )
            ],
        )

    errors: list[dict[str, Any]] = []
    _validate_top_level(plan, errors)
    _validate_actions(plan.get("actions"), errors)
    return _validation_result(plan, plan_ref=plan_ref, errors=errors)


build_l3_workflow_action_plan = build_isolated_desktop_l3_workflow_action_plan
validate_l3_workflow_action_plan = validate_isolated_desktop_l3_workflow_action_plan


def _default_actions() -> list[dict[str, Any]]:
    return [
        {
            "actionIndex": index,
            "phase": spec["phase"],
            "appRole": spec["appRole"],
            "expectedModality": spec["expectedModality"],
            "requiredRefs": list(spec["requiredRefs"]),
        }
        for index, spec in enumerate(_ACTION_SPECS, start=1)
    ]


def _copy_action(action: Mapping[str, Any]) -> dict[str, Any]:
    copied = dict(action)
    refs = copied.get("requiredRefs")
    if isinstance(refs, tuple):
        copied["requiredRefs"] = list(refs)
    return copied


def _validate_top_level(plan: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if plan.get("schemaVersion") != ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION:
        errors.append(_error(
            "unsupported_schema_version",
            "L3 workflow action plan schemaVersion is invalid.",
            "$.schemaVersion",
            expected=ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION,
            actual=plan.get("schemaVersion"),
        ))
    status = plan.get("status")
    if status == "completed":
        errors.append(_error(
            "status_completed_forbidden",
            "L3 workflow action plans cannot be marked completed.",
            "$.status",
            expected="not completed",
            actual=status,
        ))
    elif status not in _ALLOWED_STATUSES:
        errors.append(_error(
            "status_invalid",
            "L3 workflow action plan status must remain diagnostic.",
            "$.status",
            expected=list(_ALLOWED_STATUSES),
            actual=status,
        ))
    if plan.get("diagnosticOnly") is not True:
        errors.append(_error(
            "diagnostic_only_required",
            "L3 workflow action plans must remain diagnosticOnly=true.",
            "$.diagnosticOnly",
            expected=True,
            actual=plan.get("diagnosticOnly"),
        ))
    for key in _FORBIDDEN_TOP_LEVEL_KEYS:
        if key in plan:
            code = (
                "user_acceptance_eligible_forbidden"
                if key == "userAcceptanceEligible"
                else "completed_evidence_field_forbidden"
            )
            errors.append(_error(
                code,
                f"{key} is forbidden on diagnostic-only L3 workflow action plans.",
                f"$.{key}",
                actual=plan.get(key),
            ))
    if _string_list(plan.get("phaseOrder")) != list(L3_WORKFLOW_ACTION_PHASES):
        errors.append(_error(
            "phase_order_invalid",
            "L3 workflow action plan phaseOrder must be source -> writer -> save -> preview -> validate.",
            "$.phaseOrder",
            expected=list(L3_WORKFLOW_ACTION_PHASES),
            actual=plan.get("phaseOrder"),
        ))
    _validate_required_refs(plan.get("requiredRefs"), "$.requiredRefs", errors)

    policy = _mapping(plan.get("executionPolicy"))
    for key in (
        "executeGui",
        "writeCompletedEvidence",
        "readShellArtifacts",
        "declareUserAcceptanceEligibility",
    ):
        if policy.get(key) is not False:
            errors.append(_error(
                "execution_policy_mismatch",
                f"executionPolicy.{key} must be false for a diagnostic-only plan.",
                f"$.executionPolicy.{key}",
                expected=False,
                actual=policy.get(key),
            ))


def _validate_actions(value: Any, errors: list[dict[str, Any]]) -> None:
    if not isinstance(value, list):
        errors.append(_error(
            "actions_missing",
            "L3 workflow action plan requires an actions list.",
            "$.actions",
        ))
        return
    actions = [_mapping(action) for action in value]
    if len(actions) != len(_ACTION_SPECS):
        errors.append(_error(
            "action_count_invalid",
            "L3 workflow action plan must contain source, writer, save, preview, and validate actions.",
            "$.actions",
            expected=len(_ACTION_SPECS),
            actual=len(actions),
        ))

    seen_indexes: set[int] = set()
    previous_index: int | None = None
    for position, action in enumerate(actions):
        path = f"$.actions[{position}]"
        expected = _ACTION_SPECS[position] if position < len(_ACTION_SPECS) else None
        action_index = _int_or_none(action.get("actionIndex"))
        if "actionIndex" not in action or action_index is None:
            errors.append(_error(
                "action_index_missing",
                "Each L3 workflow action must include an integer actionIndex.",
                f"{path}.actionIndex",
                expected="integer",
                actual=action.get("actionIndex"),
            ))
        else:
            if action_index in seen_indexes:
                errors.append(_error(
                    "action_index_duplicate",
                    "L3 workflow actionIndex values must be unique.",
                    f"{path}.actionIndex",
                    actual=action_index,
                ))
            if previous_index is not None and action_index <= previous_index:
                errors.append(_error(
                    "action_index_not_monotonic",
                    "L3 workflow actionIndex values must increase monotonically.",
                    f"{path}.actionIndex",
                    expected=f"> {previous_index}",
                    actual=action_index,
                ))
            seen_indexes.add(action_index)
            previous_index = action_index

        if expected is None:
            continue
        for key in ("phase", "appRole", "expectedModality"):
            if action.get(key) != expected[key]:
                errors.append(_error(
                    f"{_camel_to_snake(key)}_mismatch",
                    f"L3 workflow action {key} does not match the canonical contract.",
                    f"{path}.{key}",
                    expected=expected[key],
                    actual=action.get(key),
                ))
        _validate_required_refs(action.get("requiredRefs"), f"{path}.requiredRefs", errors)
        refs = _string_list(action.get("requiredRefs"))
        for required_ref in expected["requiredRefs"]:
            if required_ref not in refs:
                errors.append(_error(
                    "required_action_ref_missing",
                    f"{required_ref} is required for the {expected['phase']} action.",
                    f"{path}.requiredRefs",
                    expected=required_ref,
                    actual=refs,
                ))


def _validate_required_refs(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    refs = _string_list(value)
    if not refs:
        errors.append(_error(
            "required_refs_missing",
            "requiredRefs must be a non-empty list of ref field names.",
            path,
            expected="non-empty string list",
            actual=value,
        ))
        return
    for required_ref in REQUIRED_PER_ACTION_REFS:
        if required_ref not in refs:
            errors.append(_error(
                "required_screenshot_observation_ref_missing",
                f"{required_ref} must be listed in requiredRefs.",
                path,
                expected=required_ref,
                actual=refs,
            ))
    for ref in refs:
        normalized = ref.replace("-", "").replace("_", "").lower()
        if any(token in normalized for token in _FORBIDDEN_REF_TOKENS):
            errors.append(_error(
                "shell_or_payload_ref_forbidden",
                "Diagnostic L3 workflow action plans cannot require shell artifact or raw payload refs.",
                path,
                actual=ref,
            ))


def _load_plan_with_ref(
    value: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> tuple[Mapping[str, Any], str | None]:
    if isinstance(value, Mapping):
        return value, None
    text = str(value)
    path = Path(value).expanduser()
    if path.exists() or resolver is None:
        payload = json.loads(path.read_text(encoding="utf8"))
        if not isinstance(payload, Mapping):
            raise TypeError("plan ref did not resolve to a JSON object")
        return payload, str(path.resolve())
    resolved = resolver(text)
    if resolved is None:
        raise TypeError("resolver returned None")
    payload, resolved_ref = _load_plan_with_ref(resolved, resolver=None)
    return payload, text if resolved_ref is None else resolved_ref


def _validation_result(
    plan: Mapping[str, Any] | None,
    *,
    plan_ref: str | None,
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    actions = plan.get("actions") if plan else None
    action_mappings = [_mapping(action) for action in actions] if isinstance(actions, list) else []
    return {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "planRef": plan_ref,
        "status": plan.get("status") if plan else None,
        "diagnosticOnly": plan.get("diagnosticOnly") if plan else None,
        "errors": errors,
        "warnings": [],
        "phases": [action.get("phase") for action in action_mappings],
        "actionIndexes": [
            action.get("actionIndex")
            for action in action_mappings
            if "actionIndex" in action
        ],
    }


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _error(
    code: str,
    message: str,
    path: str,
    *,
    expected: Any | None = None,
    actual: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "path": path,
        "severity": "error",
    }
    if expected is not None:
        payload["expected"] = expected
    if actual is not None:
        payload["actual"] = actual
    return payload


def _camel_to_snake(value: str) -> str:
    chars: list[str] = []
    for char in value:
        if char.isupper() and chars:
            chars.append("_")
        chars.append(char.lower())
    return "".join(chars)
