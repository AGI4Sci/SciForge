from sciforge_conversation.handoff_planner import plan_handoff


def test_handoff_budget_keeps_large_values_behind_refs():
    huge = "STDOUT " * 50_000
    result = plan_handoff(
        {
            "prompt": f"write a markdown report\n{huge}",
            "goal": {"requiredFormats": ["markdown"]},
            "budget": {"maxPayloadBytes": 40_000, "maxInlineStringChars": 1_000, "headChars": 200, "tailChars": 200},
            "artifacts": [
                {
                    "id": "report",
                    "type": "research-report",
                    "dataRef": ".sciforge/artifacts/report.json",
                    "data": {"markdown": huge},
                }
            ],
            "contextProjection": {"priorAttempts": [{"stderr": huge, "stderrRef": f".sciforge/logs/{i}.stderr"} for i in range(8)]},
        }
    )

    assert result["status"] == "ready"
    assert result["normalizedBytes"] <= 40_000
    serialized = str(result["payload"])
    assert huge[:10_000] not in serialized
    assert result["payload"]["artifacts"][0]["dataOmitted"] is True
    assert result["payload"]["requiredArtifacts"][0]["type"] == "research-report"
    assert any(decision["kind"] in {"prompt", "artifact-data", "prior-attempts"} for decision in result["decisions"])


def test_handoff_failure_is_structured_when_budget_cannot_fit_contract():
    result = plan_handoff(
        {
            "goal": {"requiredArtifacts": [{"type": "research-report", "requiresMarkdown": True}]},
            "budget": {"maxPayloadBytes": 10},
        }
    )

    assert result["status"] == "failed-with-reason"
    assert result["reason"]["code"] == "handoff-budget-exceeded"
    assert result["nextActions"]
