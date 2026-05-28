"""Refs-first diagnostic bundle for L3 artifact, file-list, and gui.present refs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION = (
    "sciforge.computer-use.l3-artifact-bundle-evidence.v1"
)
L3_ARTIFACT_BUNDLE_EVIDENCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.l3-artifact-bundle-evidence-validation.v1"
)
L3_ARTIFACT_BUNDLE_SCHEMA_VERSION = L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION
L3_ARTIFACT_FILE_LIST_GUI_PRESENT_BUNDLE_SCHEMA_VERSION = (
    L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION
)
L3_ARTIFACT_FILE_LIST_GUI_PRESENT_BUNDLE_VALIDATION_SCHEMA_VERSION = (
    L3_ARTIFACT_BUNDLE_EVIDENCE_VALIDATION_SCHEMA_VERSION
)

REQUIRED_BUNDLE_REF_FIELDS = (
    "finalArtifactRef",
    "artifactValidationRef",
    "fileListArtifactRef",
    "fileListDataRef",
    "guiPresentRef",
)
OPTIONAL_BUNDLE_REF_FIELDS = (
    "previewObservationRef",
    "directoryObservationAfterSaveRef",
)

_NESTED_REF_FIELDS = {
    "artifactCausality": (
        "finalArtifactRef",
        "artifactValidationRef",
    ),
    "directoryEvidence": (
        "fileListArtifactRef",
        "fileListDataRef",
        "previewObservationRef",
        "directoryObservationAfterSaveRef",
    ),
    "presentationEvidence": (
        "guiPresentRef",
    ),
}

_FORBIDDEN_COMPLETION_REF_KEYS = {
    "completionEvidenceRef",
    "completedEvidenceRef",
}
_FORBIDDEN_COMPLETED_BOOL_KEYS = {
    "completed",
    "l3WorkflowCompleted",
    "workflowCompleted",
    "artifactBundleCompleted",
}


def build_l3_artifact_bundle_evidence(
    *,
    final_artifact_ref: str,
    artifact_validation_ref: str,
    file_list_artifact_ref: str,
    file_list_data_ref: str,
    gui_present_ref: str,
    preview_observation_ref: str | None = None,
    directory_observation_after_save_ref: str | None = None,
    artifact_causality: Mapping[str, Any] | None = None,
    directory_evidence: Mapping[str, Any] | None = None,
    presentation_evidence: Mapping[str, Any] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a diagnostic-only refs bundle without reading refs or claiming L3 completion."""

    refs = {
        "finalArtifactRef": final_artifact_ref,
        "artifactValidationRef": artifact_validation_ref,
        "fileListArtifactRef": file_list_artifact_ref,
        "fileListDataRef": file_list_data_ref,
        "guiPresentRef": gui_present_ref,
    }
    if preview_observation_ref is not None:
        refs["previewObservationRef"] = preview_observation_ref
    if directory_observation_after_save_ref is not None:
        refs["directoryObservationAfterSaveRef"] = directory_observation_after_save_ref

    directory_defaults = {
        "fileListArtifactRef": file_list_artifact_ref,
        "fileListDataRef": file_list_data_ref,
    }
    if preview_observation_ref is not None:
        directory_defaults["previewObservationRef"] = preview_observation_ref
    if directory_observation_after_save_ref is not None:
        directory_defaults["directoryObservationAfterSaveRef"] = (
            directory_observation_after_save_ref
        )

    bundle: dict[str, Any] = {
        "schemaVersion": L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION,
        "status": "diagnostic-ready",
        "category": "l3-artifact-file-list-gui-present-bundle",
        **refs,
        "requiredRefFields": list(REQUIRED_BUNDLE_REF_FIELDS),
        "optionalRefFields": list(OPTIONAL_BUNDLE_REF_FIELDS),
        "bundleRefs": dict(refs),
        "artifactCausality": _merged_mapping(
            {
                "finalArtifactRef": final_artifact_ref,
                "artifactValidationRef": artifact_validation_ref,
            },
            artifact_causality,
        ),
        "directoryEvidence": _merged_mapping(directory_defaults, directory_evidence),
        "presentationEvidence": _merged_mapping(
            {"guiPresentRef": gui_present_ref},
            presentation_evidence,
        ),
        "diagnosticOnly": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "claimLimit": (
            "Diagnostic refs bundle only; a future L3 runner must resolve these refs, "
            "perform same-session GUI evidence checks, and write any completed evidence."
        ),
    }
    if metadata:
        bundle["metadata"] = dict(metadata)
    return bundle


def validate_l3_artifact_bundle_evidence(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the diagnostic L3 artifact bundle shape without dereferencing refs."""

    errors: list[dict[str, Any]] = []
    if not isinstance(payload, Mapping):
        return _validation_result(
            None,
            errors=[
                _error(
                    "payload_not_mapping",
                    "L3 artifact bundle evidence must be a mapping.",
                    "$",
                    actual=type(payload).__name__,
                )
            ],
        )

    _validate_top_level(payload, errors)
    _validate_required_refs(payload, errors)
    _validate_nested_ref_matches(payload, errors)
    _validate_forbidden_claims(payload, "$", errors)
    return _validation_result(payload, errors=errors)


build_l3_artifact_file_list_gui_present_bundle = build_l3_artifact_bundle_evidence
build_l3_artifact_file_list_gui_present_bundle_evidence = (
    build_l3_artifact_bundle_evidence
)
validate_l3_artifact_file_list_gui_present_bundle = validate_l3_artifact_bundle_evidence
validate_l3_artifact_file_list_gui_present_bundle_evidence = (
    validate_l3_artifact_bundle_evidence
)


def _validate_top_level(payload: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if payload.get("schemaVersion") != L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION:
        errors.append(
            _error(
                "unsupported_schema_version",
                "L3 artifact bundle schemaVersion is invalid.",
                "$.schemaVersion",
                expected=L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION,
                actual=payload.get("schemaVersion"),
            )
        )
    if payload.get("diagnosticOnly") is not True:
        errors.append(
            _error(
                "diagnostic_only_required",
                "L3 artifact bundle must remain diagnosticOnly=true.",
                "$.diagnosticOnly",
                expected=True,
                actual=payload.get("diagnosticOnly"),
            )
        )
    if payload.get("rawPayloadWritten") is not False:
        errors.append(
            _error(
                "raw_payload_written_forbidden",
                "L3 artifact bundle must not write raw payloads.",
                "$.rawPayloadWritten",
                expected=False,
                actual=payload.get("rawPayloadWritten"),
            )
        )
    if payload.get("inlineImageWritten") is not False:
        errors.append(
            _error(
                "inline_image_written_forbidden",
                "L3 artifact bundle must not write inline images.",
                "$.inlineImageWritten",
                expected=False,
                actual=payload.get("inlineImageWritten"),
            )
        )


def _validate_required_refs(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    for field in REQUIRED_BUNDLE_REF_FIELDS:
        if _blank_string(payload.get(field)):
            errors.append(
                _error(
                    "required_ref_missing",
                    f"{field} must be a non-empty ref.",
                    f"$.{field}",
                    actual=payload.get(field),
                )
            )
    for field in OPTIONAL_BUNDLE_REF_FIELDS:
        if field in payload and _blank_string(payload.get(field)):
            errors.append(
                _error(
                    "optional_ref_empty",
                    f"{field} must be non-empty when present.",
                    f"$.{field}",
                    actual=payload.get(field),
                )
            )


def _validate_nested_ref_matches(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    for block_name, fields in _NESTED_REF_FIELDS.items():
        if block_name not in payload:
            continue
        block = payload.get(block_name)
        if not isinstance(block, Mapping):
            errors.append(
                _error(
                    "nested_evidence_not_mapping",
                    f"{block_name} must be a mapping when present.",
                    f"$.{block_name}",
                    actual=type(block).__name__,
                )
            )
            continue
        for field in fields:
            top_level_ref = payload.get(field)
            top_level_ref_present = not _blank_string(top_level_ref)
            if not top_level_ref_present:
                if field in block:
                    if _blank_string(block.get(field)):
                        errors.append(
                            _error(
                                _nested_missing_code(block_name),
                                f"{block_name}.{field} must be non-empty when present.",
                                f"$.{block_name}.{field}",
                                actual=block.get(field),
                            )
                        )
                    else:
                        errors.append(
                            _error(
                                _nested_without_top_level_code(block_name),
                                f"{block_name}.{field} has no matching top-level ref.",
                                f"$.{block_name}.{field}",
                                expected=f"top-level {field}",
                                actual=block.get(field),
                            )
                        )
                continue

            nested_ref = block.get(field)
            if _blank_string(nested_ref):
                errors.append(
                    _error(
                        _nested_missing_code(block_name),
                        f"{block_name}.{field} must match the top-level {field}.",
                        f"$.{block_name}.{field}",
                        expected=top_level_ref,
                        actual=nested_ref,
                    )
                )
            elif nested_ref != top_level_ref:
                errors.append(
                    _error(
                        _nested_mismatch_code(block_name, field),
                        f"{block_name}.{field} must match the top-level {field}.",
                        f"$.{block_name}.{field}",
                        expected=top_level_ref,
                        actual=nested_ref,
                    )
                )


def _validate_forbidden_claims(
    value: Any,
    path: str,
    errors: list[dict[str, Any]],
    *,
    ref_context: bool = False,
) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            key_path = f"{path}.{key}" if path != "$" else f"$.{key}"
            child_ref_context = ref_context
            if isinstance(key, str):
                normalized_key = _normalized_key(key)
                child_ref_context = child_ref_context or "ref" in normalized_key
                _validate_forbidden_key(key, nested, key_path, errors)
            _validate_forbidden_claims(
                nested,
                key_path,
                errors,
                ref_context=child_ref_context,
            )
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_forbidden_claims(
                nested,
                f"{path}[{index}]",
                errors,
                ref_context=ref_context,
            )
    elif ref_context:
        code = _forbidden_ref_value_code(value)
        if code:
            errors.append(
                _error(
                    code,
                    "Diagnostic L3 artifact bundles cannot cite shell or raw payload refs.",
                    path,
                    actual=value,
                )
            )


def _validate_forbidden_key(
    key: str,
    value: Any,
    path: str,
    errors: list[dict[str, Any]],
) -> None:
    normalized_key = _normalized_key(key)
    if key in _FORBIDDEN_COMPLETION_REF_KEYS:
        errors.append(
            _error(
                "completion_evidence_ref_forbidden",
                f"{key} is forbidden on diagnostic-only L3 artifact bundles.",
                path,
                actual=value,
            )
        )
    if key == "userAcceptanceEligible":
        errors.append(
            _error(
                "user_acceptance_eligible_forbidden",
                "Diagnostic L3 artifact bundles cannot declare user acceptance eligibility.",
                path,
                actual=value,
            )
        )
    if (
        key in {"status", "completionStatus"}
        and isinstance(value, str)
        and value.lower() == "completed"
    ):
        errors.append(
            _error(
                "status_completed_forbidden",
                "Diagnostic L3 artifact bundles cannot be marked completed.",
                path,
                expected="not completed",
                actual=value,
            )
        )
    if key in _FORBIDDEN_COMPLETED_BOOL_KEYS and value is True:
        errors.append(
            _error(
                "completed_claim_forbidden",
                f"{key}=true is forbidden on diagnostic-only L3 artifact bundles.",
                path,
                expected=False,
                actual=value,
            )
        )

    key_ref_code = _forbidden_ref_key_code(normalized_key)
    if key_ref_code:
        errors.append(
            _error(
                key_ref_code,
                f"{key} is forbidden on refs-first L3 artifact bundles.",
                path,
                actual=value,
            )
        )


def _forbidden_ref_key_code(normalized_key: str) -> str | None:
    if "ref" not in normalized_key:
        return None
    if (
        "shell" in normalized_key
        or "stdout" in normalized_key
        or "stderr" in normalized_key
    ):
        return "shell_ref_forbidden"
    if "rawpayload" in normalized_key:
        return "raw_payload_ref_forbidden"
    if "raw" in normalized_key:
        return "raw_ref_forbidden"
    return None


def _forbidden_ref_value_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    lower = stripped.lower()
    normalized = _normalized_key(stripped)
    if (
        lower.startswith(("shell:", "shell://", "stdout:", "stderr:"))
        or "/shell/" in lower
        or "/stdout/" in lower
        or "/stderr/" in lower
        or normalized.startswith(("shellref", "stdoutref", "stderrref"))
    ):
        return "shell_ref_forbidden"
    if "rawpayload" in normalized:
        return "raw_payload_ref_forbidden"
    if lower.startswith(("raw:", "raw://")) or normalized.startswith("rawref"):
        return "raw_ref_forbidden"
    return None


def _validation_result(
    payload: Mapping[str, Any] | None,
    *,
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    refs = _top_level_refs(payload) if isinstance(payload, Mapping) else {}
    return {
        "schemaVersion": L3_ARTIFACT_BUNDLE_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "payloadSchemaVersion": payload.get("schemaVersion") if payload else None,
        "status": payload.get("status") if payload else None,
        "diagnosticOnly": payload.get("diagnosticOnly") if payload else None,
        "refs": refs,
        "errors": errors,
        "warnings": [],
    }


def _top_level_refs(payload: Mapping[str, Any]) -> dict[str, str]:
    refs: dict[str, str] = {}
    for field in (*REQUIRED_BUNDLE_REF_FIELDS, *OPTIONAL_BUNDLE_REF_FIELDS):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            refs[field] = value
    return refs


def _merged_mapping(
    defaults: Mapping[str, Any],
    override: Mapping[str, Any] | None,
) -> dict[str, Any]:
    merged = dict(defaults)
    if override:
        merged.update(dict(override))
    return merged


def _blank_string(value: Any) -> bool:
    return not isinstance(value, str) or not value.strip()


def _normalized_key(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _nested_missing_code(block_name: str) -> str:
    return {
        "artifactCausality": "artifact_causality_ref_missing",
        "directoryEvidence": "directory_evidence_ref_missing",
        "presentationEvidence": "presentation_evidence_ref_missing",
    }.get(block_name, "nested_ref_missing")


def _nested_mismatch_code(block_name: str, field: str) -> str:
    if block_name == "artifactCausality" and field == "finalArtifactRef":
        return "artifact_causality_final_artifact_ref_mismatch"
    if block_name == "artifactCausality" and field == "artifactValidationRef":
        return "artifact_causality_validation_ref_mismatch"
    if block_name == "directoryEvidence":
        return "directory_evidence_ref_mismatch"
    if block_name == "presentationEvidence" and field == "guiPresentRef":
        return "presentation_gui_present_ref_mismatch"
    return "nested_ref_mismatch"


def _nested_without_top_level_code(block_name: str) -> str:
    return {
        "artifactCausality": "artifact_causality_ref_without_top_level",
        "directoryEvidence": "directory_evidence_ref_without_top_level",
        "presentationEvidence": "presentation_evidence_ref_without_top_level",
    }.get(block_name, "nested_ref_without_top_level")


def _error(
    code: str,
    message: str,
    path: str,
    *,
    expected: Any | None = None,
    actual: Any | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "path": path,
    }
    if expected is not None:
        error["expected"] = expected
    if actual is not None:
        error["actual"] = actual
    return error


__all__ = [
    "L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION",
    "L3_ARTIFACT_BUNDLE_EVIDENCE_VALIDATION_SCHEMA_VERSION",
    "L3_ARTIFACT_BUNDLE_SCHEMA_VERSION",
    "L3_ARTIFACT_FILE_LIST_GUI_PRESENT_BUNDLE_SCHEMA_VERSION",
    "L3_ARTIFACT_FILE_LIST_GUI_PRESENT_BUNDLE_VALIDATION_SCHEMA_VERSION",
    "OPTIONAL_BUNDLE_REF_FIELDS",
    "REQUIRED_BUNDLE_REF_FIELDS",
    "build_l3_artifact_bundle_evidence",
    "build_l3_artifact_file_list_gui_present_bundle",
    "build_l3_artifact_file_list_gui_present_bundle_evidence",
    "validate_l3_artifact_bundle_evidence",
    "validate_l3_artifact_file_list_gui_present_bundle",
    "validate_l3_artifact_file_list_gui_present_bundle_evidence",
]
