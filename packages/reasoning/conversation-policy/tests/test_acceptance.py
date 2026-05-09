from sciforge_conversation.acceptance import evaluate_acceptance


def test_acceptance_requires_markdown_report_ref():
    result = evaluate_acceptance(
        {"requiredFormats": ["markdown"], "requiredArtifacts": [{"type": "research-report", "requiresMarkdown": True}]},
        {"status": "completed", "artifacts": [{"type": "research-report", "dataRef": ".sciforge/artifacts/report.json", "data": {"summary": "not markdown"}}]},
    )

    assert result["pass"] is False
    assert result["status"] == "rejected"
    assert any(failure["code"] == "missing-markdown-report" for failure in result["failures"])
    assert result["reason"]["code"] == "acceptance-failed"
    assert result["nextActions"]


def test_acceptance_accepts_markdown_report_ref():
    result = evaluate_acceptance(
        {"requiredFormats": ["markdown"], "requiredArtifacts": [{"type": "research-report", "requiresMarkdown": True}]},
        {"status": "completed", "artifacts": [{"type": "research-report", "markdownRef": ".sciforge/artifacts/report.md"}]},
    )

    assert result["pass"] is True
    assert result["failures"] == []


def test_acceptance_missing_output_cannot_pass():
    result = evaluate_acceptance({"requiredArtifacts": []}, {"status": "completed"})

    assert result["pass"] is False
    assert any(failure["code"] == "missing-output" for failure in result["failures"])
    assert result["reason"]
