import json

from sciforge_computer_use import ActionPlan, ExecutionOutcome, Observation
from sciforge_computer_use.evidence_ledger import (
    EvidenceLedger,
    action_mutates_visible_state,
    build_evidence_index,
    build_planner_brief,
)


def test_evidence_ledger_writes_log_index_snapshot_and_planner_brief(tmp_path):
    screen = tmp_path / "screen.png"
    artifact = tmp_path / "report.md"
    screen.write_bytes(b"screen")
    artifact.write_text("# Report\n", encoding="utf8")
    ledger = EvidenceLedger(tmp_path, run_id="ledger-test")

    observation_id = ledger.append_observation(
        Observation(
            ref=str(screen),
            summary="Editor shows report",
            visible_texts=("Report", "Save"),
            artifacts={"finalArtifactRef": "report.md"},
        ),
        action_index=0,
        query=None,
    )
    action_id = ledger.append_action(
        ActionPlan(kind="click", reason="click Save"),
        ExecutionOutcome(ok=True, message="clicked"),
        action_index=0,
        before_record_id=observation_id,
        grounding_record_id=None,
    )
    ledger.append_completion_claim(
        action_index=0,
        summary="diagnostic completion claim",
        status="blocked",
        supports=[action_id],
    )

    log_records = [
        json.loads(line)
        for line in (tmp_path / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]
    index = json.loads((tmp_path / "evidence-index.json").read_text(encoding="utf8"))
    snapshot = json.loads((tmp_path / "evidence-snapshot.json").read_text(encoding="utf8"))
    brief = json.loads((tmp_path / "planner-brief.json").read_text(encoding="utf8"))

    assert {record["type"] for record in log_records} >= {"observation", "text", "artifact", "action", "completion-claim"}
    assert index["byType"]["observation"] == [observation_id]
    assert index["staleBy"][observation_id] == action_id
    assert observation_id not in index["current"]
    assert snapshot["schemaVersion"] == "sciforge.computer-use.evidence-snapshot.v1"
    assert brief["schemaVersion"] == "sciforge.computer-use.planner-brief.v1"
    assert brief["recentActions"][-1]["id"] == action_id
    assert "report.md" in index["byRef"]


def test_evidence_ledger_redacts_payloads_and_only_indexes_safe_refs(tmp_path):
    ledger = EvidenceLedger(tmp_path, run_id="redaction-test")

    ledger.append_record(
        "observation",
        loop_phase="evidence",
        ref="data:image/png;base64,cmF3LWltYWdlLXNlY3JldA==",
        refs=[
            "artifact:/runs/redaction/report.md",
            "trace:/runs/redaction/trace.json",
            "approval:approve-report",
            "report.md",
            "https://example.test/screen.png?token=super-secret-token",
            "data:text/plain;base64,cmF3LWJvZHktc2VjcmV0",
        ],
        summary=(
            "Authorization: Bearer super-secret-token "
            "password=never-write-this data:text/plain;base64,cmF3LWJvZHktc2VjcmV0"
        ),
        metadata={
            "headers": {
                "Authorization": "Bearer super-secret-token",
                "X-Api-Key": "api-key-value",
            },
            "body": "raw-body-secret",
            "rawPayload": {"base64": "cmF3LWJvZHktc2VjcmV0"},
            "credential": "credential-value",
            "nested": {
                "finalArtifactRef": "report.md",
                "artifactRef": "artifact:/runs/redaction/report.md",
                "traceRef": "trace:/runs/redaction/trace.json",
                "approvalRef": "approval:approve-report",
                "badHttpRef": "https://example.test/screen.png?token=super-secret-token",
                "inlineDataRef": "data:image/png;base64,cmF3LWltYWdlLXNlY3JldA==",
                "plainText": "safe visible label",
            },
        },
    )

    output_text = "\n".join(
        (tmp_path / name).read_text(encoding="utf8")
        for name in [
            "evidence-log.jsonl",
            "evidence-index.json",
            "evidence-snapshot.json",
            "planner-brief.json",
        ]
    )

    for sensitive in [
        "super-secret-token",
        "never-write-this",
        "api-key-value",
        "raw-body-secret",
        "credential-value",
        "cmF3LWJvZHktc2VjcmV0",
        "cmF3LWltYWdlLXNlY3JldA",
        "data:image",
        "data:text",
        "https://example.test",
        "Authorization",
        "headers",
        "rawPayload",
        "base64",
        "credential",
    ]:
        assert sensitive not in output_text

    for safe_ref in [
        "report.md",
        "artifact:/runs/redaction/report.md",
        "trace:/runs/redaction/trace.json",
        "approval:approve-report",
    ]:
        assert safe_ref in output_text


def test_observation_only_action_does_not_stale_visible_records(tmp_path):
    ledger = EvidenceLedger(tmp_path)
    observation_id = ledger.append_observation(
        Observation(ref="screen.png", summary="Results panel visible", visible_texts=("Results",)),
        action_index=0,
        query=None,
    )
    action_id = ledger.append_action(
        ActionPlan(kind="wait", target=None, reason="wait until stable"),
        ExecutionOutcome(ok=True, metadata={"observationOnly": True}),
        action_index=0,
        before_record_id=observation_id,
        grounding_record_id=None,
        observation_only=True,
    )

    index = build_evidence_index(ledger.records)

    assert action_id in index["current"]
    assert observation_id in index["current"]
    assert index["staleBy"] == {}


def test_planner_brief_uses_current_records_after_staleness(tmp_path):
    ledger = EvidenceLedger(tmp_path)
    first = ledger.append_observation(
        Observation(ref="before.png", summary="Old screen", visible_texts=("Old",)),
        action_index=0,
        query=None,
    )
    ledger.append_action(
        ActionPlan(kind="scroll", reason="move viewport"),
        ExecutionOutcome(ok=True),
        action_index=0,
        before_record_id=first,
        grounding_record_id=None,
    )
    second = ledger.append_observation(
        Observation(ref="after.png", summary="New screen", visible_texts=("New",)),
        action_index=0,
        query="after-action",
    )

    brief = build_planner_brief(ledger.records)

    assert brief["latestObservation"]["id"] == second
    assert "New" in brief["currentText"]
    assert "Old" not in brief["currentText"]


def test_action_mutation_policy_keeps_read_only_evidence_operations_fresh():
    assert action_mutates_visible_state("click") is True
    assert action_mutates_visible_state("scroll") is True
    assert action_mutates_visible_state("focus") is True
    assert action_mutates_visible_state("save") is True
    assert action_mutates_visible_state("type_text") is True
    assert action_mutates_visible_state("crop") is False
    assert action_mutates_visible_state("ocr") is False
    assert action_mutates_visible_state("vlm_describe") is False
    assert action_mutates_visible_state("wait", observation_only=True) is False
