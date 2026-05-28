from sciforge_computer_use.source_fact_evidence import (
    SOURCE_FACT_COMPAT_SCHEMA_VERSION,
    SOURCE_FACT_EVIDENCE_SCHEMA_VERSION,
    build_source_fact_evidence_payload,
    validate_source_fact_evidence_payload,
)


def test_source_fact_payload_builder_and_validator_accept_happy_path():
    payload = build_source_fact_evidence_payload(
        fact="The source table reports revenue of 42.",
        source_observation_ref="evidence/source-observation.json",
        source_screenshot_ref="evidence/source-screen.png",
        derived_content_refs=["artifacts/derived-summary.md"],
    )
    validation = validate_source_fact_evidence_payload(payload)

    assert payload["schemaVersion"] == SOURCE_FACT_EVIDENCE_SCHEMA_VERSION
    assert payload["compatibleSourceFactSchemaVersion"] == SOURCE_FACT_COMPAT_SCHEMA_VERSION
    assert payload["fact"] == "The source table reports revenue of 42."
    assert payload["sourceObservationRef"] == "evidence/source-observation.json"
    assert payload["sourceScreenshotRef"] == "evidence/source-screen.png"
    assert payload["derivedContentRefs"] == ["artifacts/derived-summary.md"]
    assert payload["diagnosticOnly"] is True
    assert payload["rawPayloadWritten"] is False
    assert payload["inlineImageWritten"] is False
    assert "userAcceptanceEligible" not in payload
    assert "completionEvidenceRef" not in payload
    assert validation["ok"] is True
    assert validation["errors"] == []


def test_source_fact_validator_rejects_missing_fact():
    payload = build_source_fact_evidence_payload(
        fact=" ",
        source_observation_ref="evidence/source-observation.json",
        source_screenshot_ref="evidence/source-screen.png",
    )

    codes = _codes(validate_source_fact_evidence_payload(payload))

    assert "fact_missing" in codes


def test_source_fact_validator_rejects_missing_source_refs():
    payload = build_source_fact_evidence_payload(
        fact="The source table reports revenue of 42.",
        source_observation_ref="",
        source_screenshot_ref=" ",
    )

    codes = _codes(validate_source_fact_evidence_payload(payload))

    assert "source_observation_ref_missing" in codes
    assert "source_screenshot_ref_missing" in codes


def test_source_fact_validator_requires_compat_schema_marker():
    payload = build_source_fact_evidence_payload(
        fact="The source table reports revenue of 42.",
        source_observation_ref="evidence/source-observation.json",
        source_screenshot_ref="evidence/source-screen.png",
    )
    payload.pop("compatibleSourceFactSchemaVersion")

    codes = _codes(validate_source_fact_evidence_payload(payload))

    assert "compatible_source_fact_schema_missing" in codes


def test_source_fact_validator_rejects_user_eligible_or_completion_evidence():
    payload = build_source_fact_evidence_payload(
        fact="The source table reports revenue of 42.",
        source_observation_ref="evidence/source-observation.json",
        source_screenshot_ref="evidence/source-screen.png",
    )
    payload["userAcceptanceEligible"] = True
    payload["completionEvidenceRef"] = "evidence/completion.json"

    codes = _codes(validate_source_fact_evidence_payload(payload))

    assert "user_acceptance_eligible_forbidden" in codes
    assert "completion_evidence_ref_forbidden" in codes


def test_source_fact_validator_rejects_shell_and_raw_payload_refs():
    payload = build_source_fact_evidence_payload(
        fact="The source table reports revenue of 42.",
        source_observation_ref="evidence/source-observation.json",
        source_screenshot_ref="evidence/source-screen.png",
    )
    payload["shellCommandRef"] = "logs/command.json"
    payload["derivedContent"] = {
        "rawPayloadRef": "private/raw-payload.json",
        "shell_execution_ref": "logs/shell.json",
        "raw_payload_ref": "private/raw-payload-snake.json",
    }

    codes = _codes(validate_source_fact_evidence_payload(payload))

    assert "shell_ref_forbidden" in codes
    assert "raw_payload_ref_forbidden" in codes


def _codes(validation):
    return {error["code"] for error in validation["errors"]}
