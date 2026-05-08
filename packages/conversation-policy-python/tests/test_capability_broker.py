from pathlib import Path

from sciforge_conversation.capability_broker import (
    CapabilityRequest,
    broker_capabilities,
    build_capability_brief,
    load_capability_manifests,
)


FIXTURES = Path(__file__).parent / "fixtures" / "capability_manifests"


def test_loads_manifest_directory_and_selects_top_relevant_capabilities():
    manifests = load_capability_manifests(FIXTURES)

    brief = build_capability_brief(
        CapabilityRequest(
            prompt="Find recent arXiv papers and summarize the evidence.",
            goal="Create a research report with paper metadata.",
            refs=[{"id": "artifact://seed-paper", "artifactType": "papers.json"}],
            scenario="literature evidence review",
            expected_artifacts=["research-report.md", "papers.json"],
            top_k=1,
            risk_tolerance="medium",
            cost_budget="medium",
        ),
        manifests,
    )

    assert brief["schemaVersion"] == 1
    assert [item["id"] for item in brief["selected"]] == ["literature.arxiv.search"]
    selected = brief["selected"][0]
    assert selected["kind"] == "skill"
    assert selected["typedService"] is True
    assert "inputSchema" not in selected
    assert "outputSchema" not in selected
    assert "internalAgent" not in selected
    assert selected["allowedOperations"] == ["search", "download", "summarize"]
    assert selected["expectedArtifacts"] == ["research-report.md", "papers.json"]

    excluded = {item["id"]: item["reason"] for item in brief["excluded"]}
    assert excluded["action.workspace.delete"] == "risk high exceeds tolerance medium"
    assert excluded["ui.table.viewer"] == "anti-trigger matched: not needed until structured table artifact exists"
    assert "sense.vision.gui" in excluded
    assert any(entry["id"] == "literature.arxiv.search" and not entry["excluded"] for entry in brief["auditTrace"])


def test_marks_internal_agent_only_when_manifest_declares_it():
    brief = broker_capabilities(
        {
            "prompt": "Use screenshot visual GUI understanding to inspect the app.",
            "goal": "Return a bounded observation trace.",
            "refs": [{"ref": "artifact://screen", "type": "screenshot"}],
            "modalities": ["screenshot"],
            "topK": 3,
            "riskTolerance": "medium",
        },
        manifest_paths=FIXTURES,
    )

    selected_by_id = {item["id"]: item for item in brief["selected"]}
    assert selected_by_id["sense.vision.gui"]["typedService"] is True
    assert selected_by_id["sense.vision.gui"]["internalAgent"] == "optional"

    for capability_id, item in selected_by_id.items():
        if capability_id != "sense.vision.gui":
            assert "internalAgent" not in item


def test_explicit_capability_id_can_override_relevance_and_kind_limit():
    manifests = [
        {
            "id": "tool.general.low",
            "kind": "tool",
            "summary": "General low cost helper.",
            "triggers": ["general"],
            "cost": "low",
            "risk": [],
        },
        {
            "id": "tool.explicit.high",
            "kind": "tool",
            "summary": "Expensive helper selected by id.",
            "triggers": ["unrelated"],
            "cost": "high",
            "risk": [],
        },
    ]

    brief = build_capability_brief(
        {
            "prompt": "Do a general task.",
            "topK": 1,
            "costBudget": "low",
            "explicitCapabilityIds": ["tool.explicit.high"],
        },
        manifests,
        kind_limits={"tool": 1},
    )

    ids = [item["id"] for item in brief["selected"]]
    assert "tool.explicit.high" in ids
    assert brief["selected"][0]["why"] == "explicit capability id requested"


def test_missing_config_and_invalid_manifest_are_audited_as_excluded():
    brief = build_capability_brief(
        {"prompt": "Search private assay database.", "availableConfig": {}},
        [
            {"id": "tool.private.assay", "kind": "tool", "triggers": ["assay"], "requiredConfig": ["ASSAY_TOKEN"]},
            {"id": "broken.kind", "kind": "widget"},
            {"kind": "tool"},
        ],
    )

    excluded = {item["id"]: item["reason"] for item in brief["excluded"]}
    assert excluded["tool.private.assay"] == "missing required config: ASSAY_TOKEN"
    assert excluded["broken.kind"] == "broken.kind has unsupported or missing kind"
    assert excluded["capability:2"] == "manifest at index 2 is missing id"
    assert len(brief["auditTrace"]) == 3
