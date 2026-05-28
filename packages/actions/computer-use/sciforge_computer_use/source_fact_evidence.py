"""Refs-first source fact payload helpers for L3 derived content diagnostics."""

from __future__ import annotations

from typing import Any, Mapping, Sequence


SOURCE_FACT_EVIDENCE_SCHEMA_VERSION = (
    "sciforge.computer-use.source-fact-evidence.v1"
)
SOURCE_FACT_COMPAT_SCHEMA_VERSION = "sciforge.computer-use.source-fact.v1"
SOURCE_FACT_EVIDENCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.source-fact-evidence-validation.v1"
)

_FORBIDDEN_EXACT_KEYS = {
    "userAcceptanceEligible": "user_acceptance_eligible_forbidden",
    "completionEvidenceRef": "completion_evidence_ref_forbidden",
    "completedEvidenceRef": "completion_evidence_ref_forbidden",
    "completed": "completed_claim_forbidden",
}
_FORBIDDEN_KEY_TOKENS = {
    "rawpayloadref": "raw_payload_ref_forbidden",
    "rawpayloadrefs": "raw_payload_ref_forbidden",
    "rawpayloadpath": "raw_payload_ref_forbidden",
    "rawpayloaduri": "raw_payload_ref_forbidden",
    "rawpayloadurl": "raw_payload_ref_forbidden",
    "shellref": "shell_ref_forbidden",
    "shellrefs": "shell_ref_forbidden",
    "shellcommandref": "shell_ref_forbidden",
    "shellcommandrefs": "shell_ref_forbidden",
    "shellexecutionref": "shell_ref_forbidden",
    "shellexecutionrefs": "shell_ref_forbidden",
}


def build_source_fact_evidence_payload(
    *,
    fact: str,
    source_observation_ref: str,
    source_screenshot_ref: str,
    derived_content_refs: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build a diagnostic-only source fact payload without dereferencing refs."""

    return {
        "schemaVersion": SOURCE_FACT_EVIDENCE_SCHEMA_VERSION,
        "compatibleSourceFactSchemaVersion": SOURCE_FACT_COMPAT_SCHEMA_VERSION,
        "fact": fact,
        "sourceObservationRef": source_observation_ref,
        "sourceScreenshotRef": source_screenshot_ref,
        "derivedContentRefs": _ref_list(derived_content_refs),
        "diagnosticOnly": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
    }


def validate_source_fact_evidence_payload(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Validate the source observation -> supported fact -> derived content payload."""

    errors: list[dict[str, Any]] = []
    if not isinstance(payload, Mapping):
        return _validation_result(
            None,
            errors=[
                _error(
                    "payload_not_mapping",
                    "Source fact evidence payload must be a mapping.",
                    "$",
                    actual=type(payload).__name__,
                )
            ],
        )

    if payload.get("schemaVersion") != SOURCE_FACT_EVIDENCE_SCHEMA_VERSION:
        errors.append(
            _error(
                "unsupported_schema_version",
                "Source fact evidence schemaVersion is invalid.",
                "$.schemaVersion",
                expected=SOURCE_FACT_EVIDENCE_SCHEMA_VERSION,
                actual=payload.get("schemaVersion"),
            )
        )
    if payload.get("compatibleSourceFactSchemaVersion") != SOURCE_FACT_COMPAT_SCHEMA_VERSION:
        errors.append(
            _error(
                "compatible_source_fact_schema_missing",
                "Source fact evidence must declare compatibility with the L3 source-fact schema.",
                "$.compatibleSourceFactSchemaVersion",
                expected=SOURCE_FACT_COMPAT_SCHEMA_VERSION,
                actual=payload.get("compatibleSourceFactSchemaVersion"),
            )
        )
    if _blank_string(payload.get("fact")):
        errors.append(
            _error(
                "fact_missing",
                "Source fact evidence requires a non-empty fact.",
                "$.fact",
                actual=payload.get("fact"),
            )
        )
    if _blank_string(payload.get("sourceObservationRef")):
        errors.append(
            _error(
                "source_observation_ref_missing",
                "Source fact evidence requires a non-empty sourceObservationRef.",
                "$.sourceObservationRef",
                actual=payload.get("sourceObservationRef"),
            )
        )
    if _blank_string(payload.get("sourceScreenshotRef")):
        errors.append(
            _error(
                "source_screenshot_ref_missing",
                "Source fact evidence requires a non-empty sourceScreenshotRef.",
                "$.sourceScreenshotRef",
                actual=payload.get("sourceScreenshotRef"),
            )
        )
    if payload.get("diagnosticOnly") is not True:
        errors.append(
            _error(
                "diagnostic_only_required",
                "Source fact evidence must remain diagnosticOnly=true.",
                "$.diagnosticOnly",
                expected=True,
                actual=payload.get("diagnosticOnly"),
            )
        )
    if payload.get("rawPayloadWritten") is not False:
        errors.append(
            _error(
                "raw_payload_written_forbidden",
                "Source fact evidence must not write raw payloads.",
                "$.rawPayloadWritten",
                expected=False,
                actual=payload.get("rawPayloadWritten"),
            )
        )
    if payload.get("inlineImageWritten") is not False:
        errors.append(
            _error(
                "inline_image_written_forbidden",
                "Source fact evidence must not write inline image payloads.",
                "$.inlineImageWritten",
                expected=False,
                actual=payload.get("inlineImageWritten"),
            )
        )

    derived_content_refs = payload.get("derivedContentRefs")
    if not isinstance(derived_content_refs, list):
        errors.append(
            _error(
                "derived_content_refs_invalid",
                "Source fact evidence derivedContentRefs must be a refs-first list.",
                "$.derivedContentRefs",
                expected="list[str]",
                actual=derived_content_refs,
            )
        )
    elif any(_blank_string(ref) for ref in derived_content_refs):
        errors.append(
            _error(
                "derived_content_ref_empty",
                "Source fact evidence derivedContentRefs entries must be non-empty refs.",
                "$.derivedContentRefs",
                actual=derived_content_refs,
            )
        )

    _validate_forbidden_claims(payload, "$", errors)
    return _validation_result(payload, errors=errors)


build_source_fact_payload = build_source_fact_evidence_payload
validate_source_fact_payload = validate_source_fact_evidence_payload


def _validate_forbidden_claims(
    value: Any,
    path: str,
    errors: list[dict[str, Any]],
) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            key_path = f"{path}.{key}" if path != "$" else f"$.{key}"
            if isinstance(key, str):
                code = _FORBIDDEN_EXACT_KEYS.get(key)
                if code:
                    errors.append(
                        _error(
                            code,
                            f"{key} is forbidden on diagnostic-only source fact evidence.",
                            key_path,
                            actual=nested,
                        )
                    )
                normalized_key = _normalized_key(key)
                token_code = _forbidden_token_code(normalized_key)
                if token_code:
                    errors.append(
                        _error(
                            token_code,
                            f"{key} is forbidden on refs-first source fact evidence.",
                            key_path,
                            actual=nested,
                        )
                    )
                if key in {"status", "completionStatus"} and nested == "completed":
                    errors.append(
                        _error(
                            "completed_claim_forbidden",
                            "Source fact evidence cannot claim completion.",
                            key_path,
                            expected="not completed",
                            actual=nested,
                        )
                    )
            _validate_forbidden_claims(nested, key_path, errors)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_forbidden_claims(nested, f"{path}[{index}]", errors)


def _blank_string(value: Any) -> bool:
    return not isinstance(value, str) or not value.strip()


def _ref_list(value: Sequence[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def _normalized_key(key: str) -> str:
    return "".join(character for character in key.lower() if character.isalnum())


def _forbidden_token_code(normalized_key: str) -> str | None:
    if normalized_key in _FORBIDDEN_KEY_TOKENS:
        return _FORBIDDEN_KEY_TOKENS[normalized_key]
    if "shell" in normalized_key and "ref" in normalized_key:
        return "shell_ref_forbidden"
    if "rawpayload" in normalized_key and (
        "ref" in normalized_key
        or normalized_key.endswith(("path", "uri", "url"))
        or normalized_key == "rawpayload"
    ):
        return "raw_payload_ref_forbidden"
    return None


def _validation_result(
    payload: Mapping[str, Any] | None,
    *,
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": SOURCE_FACT_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "payloadSchemaVersion": (
            payload.get("schemaVersion") if isinstance(payload, Mapping) else None
        ),
        "diagnosticOnly": (
            payload.get("diagnosticOnly") if isinstance(payload, Mapping) else None
        ),
        "errors": errors,
    }


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
