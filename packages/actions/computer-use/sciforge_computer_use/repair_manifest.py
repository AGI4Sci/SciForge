"""Validation for refs-first blocked repair manifests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


REPAIR_MANIFEST_SCHEMA_VERSION = "sciforge.computer-use.repair-manifest.v1"
REPAIR_MANIFEST_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.repair-manifest-validation.v1"

_FAILED_STAGE_CATEGORIES = {
    "request-validation": "request-validation",
    "host-port-validation": "host-port-validation",
    "planner": "planning",
    "planning": "planning",
    "grounding": "grounding",
    "execution": "execution",
    "verification": "verification",
    "final-artifact-evidence": "artifact-evidence",
    "directory-evidence": "artifact-evidence",
    "cli": "cli",
    "desktop-preflight": "preflight",
    "host-port-probe": "probe",
    "native-capture-probe": "probe",
    "native-stdio-probe": "probe",
    "plugin-probe": "probe",
    "semantic-verifier-probe": "probe",
    "virtual-desktop-probe": "probe",
}


def validate_repair_manifest(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate a blocked-repair-manifest record without accepting inline payloads."""

    try:
        manifest, manifest_ref = _load_manifest_with_ref(manifest_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            None,
            manifest_ref=str(manifest_or_ref),
            require_existing_refs=require_existing_refs,
            errors=[_error("manifest_load_failed", f"Repair manifest could not be loaded: {exc}.", "$")],
        )

    errors: list[dict[str, Any]] = []
    if manifest.get("schemaVersion") != REPAIR_MANIFEST_SCHEMA_VERSION:
        errors.append(_error(
            "unsupported_schema_version",
            "Repair manifest schemaVersion is invalid.",
            "$.schemaVersion",
            expected=REPAIR_MANIFEST_SCHEMA_VERSION,
            actual=manifest.get("schemaVersion"),
        ))

    status = _string_or_none(manifest.get("status"))
    if not status:
        errors.append(_error("status_missing", "Repair manifest status is missing.", "$.status"))
    elif status == "completed":
        errors.append(_error(
            "status_completed_forbidden",
            "Blocked repair manifest status must not be completed.",
            "$.status",
            expected="not completed",
            actual=status,
        ))

    failed_stage = _string_or_none(manifest.get("failedStage"))
    failed_stage_category = _FAILED_STAGE_CATEGORIES.get(failed_stage or "")
    if not failed_stage:
        errors.append(_error("failed_stage_missing", "failedStage is missing.", "$.failedStage"))
    elif failed_stage_category is None:
        errors.append(_error(
            "failed_stage_unknown",
            "failedStage must be one of the known repairable failure classifications.",
            "$.failedStage",
            expected=sorted(_FAILED_STAGE_CATEGORIES),
            actual=failed_stage,
        ))

    result_ref = _string_or_none(manifest.get("resultRef"))
    trace_refs = _refs_from_explicit_list(manifest.get("traceRefs"))
    screenshot_refs = _refs_from_explicit_list(manifest.get("screenshotRefs"))
    final_observation_ref = _string_or_none(manifest.get("finalObservationRef"))
    if not result_ref:
        errors.append(_error("result_ref_missing", "Repair manifest must include resultRef.", "$.resultRef"))
    if not trace_refs:
        errors.append(_error("trace_refs_missing", "Repair manifest must include traceRefs.", "$.traceRefs"))
    if not screenshot_refs and not final_observation_ref:
        errors.append(_error(
            "visual_or_observation_ref_missing",
            "Repair manifest must include screenshotRefs or finalObservationRef.",
            "$.screenshotRefs",
        ))

    for key, expected in (
        ("realWindowEvidence", None),
        ("diagnosticOnly", None),
        ("inputExecuted", None),
        ("sharedSystemInputUsed", None),
        ("rawPayloadWritten", False),
        ("inlineImageWritten", False),
    ):
        value = manifest.get(key)
        if not isinstance(value, bool):
            errors.append(_error(
                f"{_snake(key)}_missing",
                f"{key} must be an explicit boolean.",
                f"$.{key}",
                expected="boolean",
                actual=value,
            ))
        elif expected is not None and value is not expected:
            errors.append(_error(
                f"{_snake(key)}_not_false",
                f"{key} must be false for refs-first repair manifests.",
                f"$.{key}",
                expected=expected,
                actual=value,
            ))

    if manifest.get("diagnosticOnly") is True and manifest.get("realWindowEvidence") is True:
        errors.append(_error(
            "diagnostic_manifest_promoted_to_real_window",
            "diagnosticOnly=true cannot be promoted to realWindowEvidence=true.",
            "$",
        ))
    if manifest.get("realWindowEvidence") is False and manifest.get("diagnosticOnly") is not True:
        errors.append(_error(
            "package_local_manifest_not_diagnostic",
            "Package-local repair manifests with realWindowEvidence=false must remain diagnosticOnly=true.",
            "$.diagnosticOnly",
            expected=True,
            actual=manifest.get("diagnosticOnly"),
        ))
    if manifest.get("realWindowEvidence") is False and manifest.get("inputExecuted") is True:
        errors.append(_error(
            "package_local_input_execution_forbidden",
            "Package-local repair manifests cannot claim inputExecuted=true.",
            "$.inputExecuted",
            expected=False,
            actual=True,
        ))
    if manifest.get("sharedSystemInputUsed") is True:
        errors.append(_error(
            "shared_system_input_forbidden",
            "Blocked repair manifests cannot use shared system input as success evidence.",
            "$.sharedSystemInputUsed",
            expected=False,
            actual=True,
        ))

    failure_diagnostics = _mapping(manifest.get("failureDiagnostics"))
    if failure_diagnostics.get("realWindowEvidence") is False and manifest.get("realWindowEvidence") is True:
        errors.append(_error(
            "package_local_failure_promoted_to_real_window",
            "failureDiagnostics.realWindowEvidence=false cannot be promoted to manifest realWindowEvidence=true.",
            "$.realWindowEvidence",
            expected=False,
            actual=True,
        ))

    if manifest.get("realWindowEvidence") is True:
        errors.extend(_real_window_manifest_errors(manifest))

    inline_issues = _inline_payload_issues(manifest)
    for issue in inline_issues:
        errors.append(_error("inline_payload_forbidden", issue, "$"))

    if require_existing_refs:
        errors.extend(_existing_ref_errors([
            result_ref,
            *trace_refs,
            *screenshot_refs,
            final_observation_ref,
            *_refs_from_explicit_list(manifest.get("artifactRefs")),
            *_refs_from_explicit_list(manifest.get("finalArtifactRefs")),
            _string_or_none(manifest.get("finalArtifactRef")),
            _string_or_none(manifest.get("probeManifestRef")),
            _string_or_none(manifest.get("scenarioRef")),
        ]))

    return _validation_result(
        manifest,
        manifest_ref=manifest_ref,
        require_existing_refs=require_existing_refs,
        errors=errors,
        failed_stage_category=failed_stage_category,
    )


validateRepairManifest = validate_repair_manifest


def _real_window_manifest_errors(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if manifest.get("diagnosticOnly") is not False:
        errors.append(_error(
            "real_window_manifest_diagnostic_only",
            "realWindowEvidence=true requires diagnosticOnly=false.",
            "$.diagnosticOnly",
            expected=False,
            actual=manifest.get("diagnosticOnly"),
        ))
    if manifest.get("inputExecuted") is not True:
        errors.append(_error(
            "real_window_manifest_input_not_executed",
            "realWindowEvidence=true requires inputExecuted=true.",
            "$.inputExecuted",
            expected=True,
            actual=manifest.get("inputExecuted"),
        ))
    if not _refs_from_explicit_list(manifest.get("realWindowEvidenceRefs")):
        errors.append(_error(
            "real_window_evidence_refs_missing",
            "realWindowEvidence=true requires explicit realWindowEvidenceRefs.",
            "$.realWindowEvidenceRefs",
        ))
    binding = _mapping(manifest.get("targetBindingValidation"))
    if binding.get("ok") is not True:
        errors.append(_error(
            "target_binding_validation_missing",
            "realWindowEvidence=true requires successful targetBindingValidation.",
            "$.targetBindingValidation",
        ))
    if binding and binding.get("executeChangesTargetEnvironment") is not True:
        errors.append(_error(
            "target_binding_execution_not_real_target",
            "targetBindingValidation must prove execution changes the target environment.",
            "$.targetBindingValidation.executeChangesTargetEnvironment",
            expected=True,
            actual=binding.get("executeChangesTargetEnvironment"),
        ))
    if binding and binding.get("realWindowEvidenceCapable") is not True:
        errors.append(_error(
            "target_binding_real_window_capability_missing",
            "targetBindingValidation must prove real-window evidence capability.",
            "$.targetBindingValidation.realWindowEvidenceCapable",
            expected=True,
            actual=binding.get("realWindowEvidenceCapable"),
        ))
    return errors


def _validation_result(
    manifest: Mapping[str, Any] | None,
    *,
    manifest_ref: str | None,
    require_existing_refs: bool,
    errors: list[dict[str, Any]],
    failed_stage_category: str | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": REPAIR_MANIFEST_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "manifestRef": manifest_ref,
        "status": manifest.get("status") if manifest else None,
        "errors": errors,
        "warnings": [],
        "requireExistingRefs": bool(require_existing_refs),
        "failedStage": manifest.get("failedStage") if manifest else None,
        "failedStageCategory": failed_stage_category,
        "resultRef": manifest.get("resultRef") if manifest else None,
        "traceRefs": _refs_from_explicit_list(manifest.get("traceRefs")) if manifest else [],
        "screenshotRefs": _refs_from_explicit_list(manifest.get("screenshotRefs")) if manifest else [],
        "finalObservationRef": manifest.get("finalObservationRef") if manifest else None,
        "realWindowEvidence": manifest.get("realWindowEvidence") if manifest else None,
        "diagnosticOnly": manifest.get("diagnosticOnly") if manifest else None,
        "inputExecuted": manifest.get("inputExecuted") if manifest else None,
        "sharedSystemInputUsed": manifest.get("sharedSystemInputUsed") if manifest else None,
    }


def _load_manifest_with_ref(
    value: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> tuple[Mapping[str, Any], str | None]:
    if isinstance(value, Mapping):
        return value, None
    text = str(value)
    path = Path(value).expanduser()
    if path.exists() or resolver is None:
        parsed = json.loads(path.read_text(encoding="utf8"))
        if not isinstance(parsed, Mapping):
            raise TypeError("Repair manifest JSON root must be an object.")
        return parsed, str(path.resolve())
    resolved = resolver(text)
    payload, resolved_ref = _load_manifest_with_ref(resolved, resolver=None)
    return payload, text if resolved_ref is None else resolved_ref


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _refs_from_explicit_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return _unique_strings(item.strip() for item in value if isinstance(item, str) and item.strip())


def _unique_strings(values: Any) -> list[str]:
    seen: set[str] = set()
    refs: list[str] = []
    for value in values:
        if isinstance(value, str) and value not in seen:
            seen.add(value)
            refs.append(value)
    return refs


def _inline_payload_issues(value: Any) -> list[str]:
    issues: list[str] = []
    _collect_inline_payload_issues(value, issues, path="$")
    return _unique_strings(issues)


def _collect_inline_payload_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if normalized in {"rawpayload", "rawscreenshot", "rawimage", "base64", "imagebase64", "inlinedata"}:
                issues.append(f"Repair manifest contains forbidden inline payload key {key_text!r} at {path}.")
            _collect_inline_payload_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_inline_payload_issues(item, issues, path=f"{path}[{index}]")
        return
    if isinstance(value, str) and ("data:" in value or ";base64," in value):
        issues.append(f"Repair manifest contains forbidden inline data/base64 string at {path}.")


def _existing_ref_errors(refs: Sequence[Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for ref in _unique_strings(ref for ref in refs if isinstance(ref, str) and ref.strip()):
        if _is_durable_ref(ref):
            continue
        if not Path(ref).expanduser().is_file():
            errors.append(_error(
                "manifest_ref_not_found",
                "Repair manifest ref must point to an existing local file.",
                "$",
                actual=ref,
            ))
    return errors


def _is_durable_ref(value: str) -> bool:
    return value.startswith(("artifact:", "trace:", "screenshot:", "observation:"))


def _snake(value: str) -> str:
    chars: list[str] = []
    for char in value:
        if char.isupper() and chars:
            chars.append("_")
        chars.append(char.lower())
    return "".join(chars)


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


__all__ = [
    "REPAIR_MANIFEST_SCHEMA_VERSION",
    "REPAIR_MANIFEST_VALIDATION_SCHEMA_VERSION",
    "validate_repair_manifest",
    "validateRepairManifest",
]
