from sciforge_conversation.recovery import plan_recovery


def test_silent_stream_uses_digest_recovery_when_digest_refs_exist():
    result = plan_recovery(
        {"code": "silent-stream", "message": "silent stream guard fired", "stdoutRef": ".sciforge/logs/run.stdout"},
        [{"ref": "digest:current", "path": ".sciforge/digests/current.json"}],
        [],
    )

    assert result["action"] == "digest-recovery"
    assert result["ok"] is True
    assert result["reason"]["code"] == "silent-stream"
    assert ".sciforge/digests/current.json" in result["evidenceRefs"]


def test_missing_output_routes_to_repair_with_next_actions():
    result = plan_recovery({"code": "missing-output", "detail": "no output"}, [], [])

    assert result["action"] == "repair"
    assert result["reason"]["code"] == "missing-output"
    assert result["nextActions"]


def test_recovery_budget_exhaustion_returns_failed_with_reason():
    result = plan_recovery(
        {"code": "missing-markdown-report", "detail": "report missing", "maxRecoveryAttempts": 1},
        [{"ref": "digest:current"}],
        [{"action": "repair", "stderrRef": ".sciforge/logs/repair.stderr"}],
    )

    assert result["action"] == "failed-with-reason"
    assert result["ok"] is False
    assert result["reason"]["code"] == "missing-markdown-report"
    assert result["nextActions"]
