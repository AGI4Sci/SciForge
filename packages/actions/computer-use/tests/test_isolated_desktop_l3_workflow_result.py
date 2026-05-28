import json
from pathlib import Path

import pytest

from sciforge_computer_use.isolated_desktop_l3_workflow_evidence import (
    validate_isolated_desktop_l3_workflow_evidence,
)
from sciforge_computer_use.isolated_desktop_l3_workflow_result import (
    ISOLATED_DESKTOP_L3_COMPLETION_ASSEMBLY_SCHEMA_VERSION,
    MANIFEST_NAME,
    assemble_isolated_desktop_l3_workflow_completion,
)

from test_isolated_desktop_l3_workflow_evidence import valid_l3_evidence_payload


@pytest.fixture(autouse=True)
def _relative_modality_tokens_resolve_in_tmp(tmp_path, monkeypatch):
    (tmp_path / "pointer").write_text("", encoding="utf8")
    monkeypatch.chdir(tmp_path)


def test_l3_completion_assembler_writes_evidence_only_after_validator_accepts(tmp_path, monkeypatch):
    payload = valid_l3_evidence_payload(tmp_path)

    assembly = assemble_isolated_desktop_l3_workflow_completion(
        payload=payload,
        output_dir=tmp_path,
    )

    assert assembly["schemaVersion"] == ISOLATED_DESKTOP_L3_COMPLETION_ASSEMBLY_SCHEMA_VERSION
    assert assembly["status"] == "completed"
    assert assembly["diagnosticOnly"] is False
    assert assembly["userAcceptanceEligible"] is True
    assert assembly["l3WorkflowCompleted"] is True
    assert assembly["partialRefsPromoted"] is False
    assert assembly["validation"]["ok"] is True
    assert assembly["errors"] == []
    assert Path(assembly["manifestRef"]).name == MANIFEST_NAME
    assert Path(assembly["manifestRef"]).is_file()
    assert assembly["completionEvidenceRef"]
    evidence_ref = Path(assembly["completionEvidenceRef"])
    evidence_path = tmp_path / assembly["completionEvidenceRef"]
    assert evidence_ref.is_file()
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    assert evidence["status"] == "completed"
    assert evidence["finalArtifactRef"] == "source-summary.docx"
    assert not any(Path(ref.split("#", 1)[0]).is_absolute() for ref in _completion_refs(evidence))
    assert validate_isolated_desktop_l3_workflow_evidence(evidence)["ok"] is True
    monkeypatch.chdir(tmp_path.parent)
    assert validate_isolated_desktop_l3_workflow_evidence(evidence_path)["ok"] is True


def test_l3_completion_assembler_blocks_and_does_not_write_completion_ref_when_invalid(tmp_path):
    payload = valid_l3_evidence_payload(tmp_path)
    payload.pop("finalArtifactRef")

    assembly = assemble_isolated_desktop_l3_workflow_completion(
        payload=payload,
        output_dir=tmp_path,
    )

    assert assembly["status"] == "blocked"
    assert assembly["diagnosticOnly"] is True
    assert assembly["userAcceptanceEligible"] is False
    assert assembly["l3WorkflowCompleted"] is False
    assert assembly["completionEvidenceRef"] is None
    assert assembly["candidateEvidenceWritten"] is False
    assert not (tmp_path / "isolated-desktop-l3-workflow-evidence.json").exists()
    assert "required_ref_missing" in _codes(assembly)


def test_l3_completion_assembler_requires_existing_refs(tmp_path):
    payload = valid_l3_evidence_payload(tmp_path)

    assembly = assemble_isolated_desktop_l3_workflow_completion(
        payload=payload,
        output_dir=tmp_path,
        require_existing_refs=False,
    )

    assert assembly["status"] == "blocked"
    assert assembly["completionEvidenceRef"] is None
    assert "existing_refs_required_for_l3" in _codes(assembly)


def test_l3_completion_assembler_rejects_partial_namespace_refs(tmp_path):
    payload = valid_l3_evidence_payload(tmp_path)
    payload["partialRunRef"] = str(tmp_path / "partial-run.json")
    payload["partialRuntimeRefs"] = {"executorCommandEventLogRef": str(tmp_path / "partial-command-log.json")}

    assembly = assemble_isolated_desktop_l3_workflow_completion(
        payload=payload,
        output_dir=tmp_path,
    )

    assert assembly["status"] == "blocked"
    assert assembly["completionEvidenceRef"] is None
    assert _codes(assembly) == {"partial_refs_forbidden"}


def _codes(assembly):
    return {error["code"] for error in assembly["errors"]}


def _completion_refs(value):
    if isinstance(value, dict):
        refs = []
        for key, item in value.items():
            if key.endswith("Ref") and isinstance(item, str):
                refs.append(item)
            elif key.endswith("Refs") and isinstance(item, list):
                refs.extend(ref for ref in item if isinstance(ref, str))
            refs.extend(_completion_refs(item))
        return refs
    if isinstance(value, list):
        refs = []
        for item in value:
            refs.extend(_completion_refs(item))
        return refs
    return []
