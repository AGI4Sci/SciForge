from sciforge_computer_use.l3_artifact_bundle_evidence import (
    L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION,
    build_l3_artifact_bundle_evidence,
    validate_l3_artifact_bundle_evidence,
)


def test_l3_artifact_bundle_builder_and_validator_accept_happy_path():
    bundle = _valid_bundle()
    validation = validate_l3_artifact_bundle_evidence(bundle)

    assert bundle["schemaVersion"] == L3_ARTIFACT_BUNDLE_EVIDENCE_SCHEMA_VERSION
    assert bundle["status"] == "diagnostic-ready"
    assert bundle["diagnosticOnly"] is True
    assert bundle["rawPayloadWritten"] is False
    assert bundle["inlineImageWritten"] is False
    assert "completionEvidenceRef" not in bundle
    assert "userAcceptanceEligible" not in bundle
    assert bundle["artifactCausality"]["finalArtifactRef"] == bundle["finalArtifactRef"]
    assert bundle["artifactCausality"]["artifactValidationRef"] == bundle["artifactValidationRef"]
    assert bundle["directoryEvidence"]["fileListArtifactRef"] == bundle["fileListArtifactRef"]
    assert bundle["directoryEvidence"]["fileListDataRef"] == bundle["fileListDataRef"]
    assert bundle["directoryEvidence"]["previewObservationRef"] == bundle["previewObservationRef"]
    assert (
        bundle["directoryEvidence"]["directoryObservationAfterSaveRef"]
        == bundle["directoryObservationAfterSaveRef"]
    )
    assert bundle["presentationEvidence"]["guiPresentRef"] == bundle["guiPresentRef"]
    assert validation["ok"] is True
    assert validation["errors"] == []


def test_l3_artifact_bundle_validator_rejects_missing_refs():
    bundle = _valid_bundle()
    bundle["finalArtifactRef"] = ""
    bundle.pop("fileListDataRef")
    bundle["previewObservationRef"] = " "

    codes = _codes(validate_l3_artifact_bundle_evidence(bundle))

    assert "required_ref_missing" in codes
    assert "optional_ref_empty" in codes


def test_l3_artifact_bundle_validator_rejects_nested_ref_mismatches():
    bundle = _valid_bundle()
    bundle["artifactCausality"]["finalArtifactRef"] = "artifact:other/final.docx"
    bundle["artifactCausality"]["artifactValidationRef"] = (
        "artifact:other/validation.json"
    )
    bundle["directoryEvidence"]["fileListDataRef"] = "artifact:other/file-list.json"
    bundle["directoryEvidence"]["previewObservationRef"] = (
        "observation:other/preview.json"
    )
    bundle["presentationEvidence"]["guiPresentRef"] = "artifact:other/gui.present.json"

    codes = _codes(validate_l3_artifact_bundle_evidence(bundle))

    assert "artifact_causality_final_artifact_ref_mismatch" in codes
    assert "artifact_causality_validation_ref_mismatch" in codes
    assert "directory_evidence_ref_mismatch" in codes
    assert "presentation_gui_present_ref_mismatch" in codes


def test_l3_artifact_bundle_validator_rejects_completion_and_user_eligible_claims():
    bundle = _valid_bundle()
    bundle["status"] = "completed"
    bundle["completionEvidenceRef"] = "artifact:run/completion.json"
    bundle["userAcceptanceEligible"] = True
    bundle["l3WorkflowCompleted"] = True

    codes = _codes(validate_l3_artifact_bundle_evidence(bundle))

    assert "status_completed_forbidden" in codes
    assert "completion_evidence_ref_forbidden" in codes
    assert "user_acceptance_eligible_forbidden" in codes
    assert "completed_claim_forbidden" in codes


def test_l3_artifact_bundle_validator_rejects_shell_and_raw_refs():
    bundle = _valid_bundle()
    bundle["finalArtifactRef"] = "shell:write-final-artifact"
    bundle["fileListDataRef"] = "raw-payload:directory-listing"
    bundle["metadata"] = {
        "shellRef": "shell:ls",
        "rawPayloadRef": "raw-payload:tool-output",
    }

    codes = _codes(validate_l3_artifact_bundle_evidence(bundle))

    assert "shell_ref_forbidden" in codes
    assert "raw_payload_ref_forbidden" in codes


def _valid_bundle():
    return build_l3_artifact_bundle_evidence(
        final_artifact_ref="artifact:l3/final.docx",
        artifact_validation_ref="artifact:l3/final.validation.json",
        file_list_artifact_ref="artifact:l3/file-list.md",
        file_list_data_ref="artifact:l3/file-list.json",
        gui_present_ref="artifact:l3/gui.present.json",
        preview_observation_ref="observation:l3/preview.json",
        directory_observation_after_save_ref="observation:l3/directory-after-save.json",
    )


def _codes(validation):
    return {error["code"] for error in validation["errors"]}
