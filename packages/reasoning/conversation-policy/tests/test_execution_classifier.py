from sciforge_conversation.execution_classifier import classify_execution_mode


def test_existing_artifact_explanation_uses_direct_context_answer():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "new-task"},
            "artifacts": [{"artifactType": "table", "status": "done", "summary": "model metrics"}],
        }
    )

    assert decision["executionMode"] == "direct-context-answer"
    assert decision["reproducibilityLevel"] == "none"
    assert decision["stagePlanHint"] == []
    assert 0 <= decision["complexityScore"] <= 1
    assert decision["complexityScore"] < 0.25


def test_runtime_planning_skill_does_not_force_workspace_execution_for_direct_context():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "new-task"},
            "artifacts": [{"artifactType": "table", "status": "done", "summary": "model metrics"}],
            "selectedCapabilities": [{
                "id": "scenario.literature.agentserver-generation",
                "kind": "skill",
                "adapter": "agentserver:generation",
                "summary": "Runtime planning skill for literature tasks.",
            }],
        }
    )

    assert decision["executionMode"] == "direct-context-answer"
    assert "selected-action" not in decision["signals"]
    assert "external-action" not in decision["signals"]


def test_simple_current_events_search_uses_thin_reproducible_adapter():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "freshness": {"kind": "latest"}},
            "selectedTools": [{"id": "web.search", "summary": "Search current web pages.", "sideEffects": ["web"]}],
        }
    )

    assert decision["executionMode"] == "thin-reproducible-adapter"
    assert decision["reproducibilityLevel"] == "light"
    assert decision["stagePlanHint"] == ["search", "fetch", "emit"]
    assert "external-information-required" in decision["riskFlags"]


def test_simple_literature_search_uses_thin_reproducible_adapter():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "freshness": {"kind": "latest"}},
            "selectedCapabilities": [{
                "id": "literature.search",
                "kind": "tool",
                "domain": ["literature"],
                "sideEffects": ["search"],
            }],
        }
    )

    assert decision["executionMode"] == "thin-reproducible-adapter"
    assert decision["reproducibilityLevel"] == "light"
    assert decision["stagePlanHint"] == ["search", "emit"]
    assert "research" in decision["signals"]


def test_systematic_literature_review_routes_to_multi_stage_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "report", "taskRelation": "new-task"},
            "expectedArtifactTypes": ["research-report", "evidence-table"],
            "selectedCapabilities": [{"id": "literature.search", "domain": ["literature"], "sideEffects": ["search"]}],
            "selectedVerifiers": [{"id": "citation.checker", "summary": "Validate citations."}],
        }
    )

    assert decision["executionMode"] == "multi-stage-project"
    assert decision["reproducibilityLevel"] == "staged"
    assert decision["stagePlanHint"] == ["plan", "search", "analyze", "emit", "validate"]
    assert "multi-artifact-output" in decision["riskFlags"]


def test_full_text_download_or_reading_routes_to_multi_stage_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis"},
            "refs": [{"ref": "papers.json"}],
            "expectedArtifactTypes": ["pdf-bundle", "extraction-table"],
            "selectedTools": [{"id": "http.fetch", "summary": "Fetch remote full text PDFs.", "sideEffects": ["download"]}],
        }
    )

    assert decision["executionMode"] == "multi-stage-project"
    assert decision["reproducibilityLevel"] == "staged"
    assert "fetch" in decision["stagePlanHint"]
    assert "full-text-or-large-fetch" in decision["riskFlags"]


def test_code_modification_is_single_stage_task():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "workflow"},
            "refs": [{"ref": "src/parser.py"}],
            "selectedTools": [{"id": "filesystem.edit", "summary": "Edit workspace files.", "sideEffects": ["edit"]}],
        }
    )

    assert decision["executionMode"] == "single-stage-task"
    assert decision["reproducibilityLevel"] == "full"
    assert decision["stagePlanHint"] == ["analyze", "modify", "validate", "emit"]
    assert "code-or-workspace-side-effect" in decision["riskFlags"]


def test_file_exploration_is_single_stage_task():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis"},
            "selectedTools": [{"id": "filesystem.read", "summary": "Inspect workspace files.", "sideEffects": ["workspace-read"]}],
        }
    )

    assert decision["executionMode"] == "single-stage-task"
    assert decision["stagePlanHint"] == ["fetch", "analyze", "emit"]
    assert "needs-workspace-discovery" in decision["riskFlags"]


def test_long_high_uncertainty_task_routes_to_multi_stage_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskScale": "open-ended", "uncertainty": "high"},
            "expectedArtifactTypes": ["analysis.md"],
            "selectedTools": [{"id": "workspace.shell", "summary": "Run commands.", "sideEffects": ["execute"]}],
            "selectedVerifiers": [{"id": "result.validator"}],
        }
    )

    assert decision["executionMode"] == "multi-stage-project"
    assert decision["uncertaintyScore"] >= 0.5
    assert "long-running-or-open-ended" in decision["riskFlags"]


def test_recent_failure_routes_to_repair_or_continue_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "repair", "taskRelation": "repair"},
            "recentFailures": [{"stageId": "2-fetch", "failureReason": "timeout"}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert decision["reproducibilityLevel"] == "staged"
    assert "repair" in decision["signals"]
    assert "recent-failure" in decision["riskFlags"]


def test_no_execution_context_summary_with_failures_uses_direct_context_answer():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "new-task"},
            "turnExecutionConstraints": direct_context_constraints(reference_count=1),
            "currentReferenceDigests": [{
                "status": "ok",
                "sourceRef": "artifact:runtime-diagnostic",
                "digestText": "Current digest contains acceptance criteria and evidence gaps.",
            }],
            "expectedArtifactTypes": ["evidence-matrix"],
            "recentFailures": [{"stageId": "agentserver.generate", "status": "failed"}],
            "priorAttempts": [{"status": "repair-needed", "artifactRefs": ["artifact:runtime-diagnostic"]}],
        }
    )

    assert decision["executionMode"] == "direct-context-answer"
    assert "no-execution-directive" in decision["signals"]
    assert "expected-artifact-contract" in decision["signals"]
    assert decision["stagePlanHint"] == []


def test_no_execution_context_summary_accepts_current_reference_digests_as_context():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "new-task"},
            "turnExecutionConstraints": direct_context_constraints(reference_count=0),
            "currentReferenceDigests": [{
                "status": "ok",
                "sourceRef": "runtime://current-reference-digest/summary",
                "digestText": "Bounded current digest.",
            }],
        }
    )

    assert decision["executionMode"] == "direct-context-answer"
    assert "has-digests" in decision["signals"]
    assert decision["reproducibilityLevel"] == "none"


def test_historical_failures_alone_do_not_authorize_direct_context_answer():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "new-task"},
            "turnExecutionConstraints": direct_context_constraints(reference_count=0),
            "recentFailures": [{"stageId": "agentserver.generate", "status": "failed"}],
            "priorAttempts": [{"status": "repair-needed", "artifactRefs": ["artifact:old"]}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "repair" in decision["signals"]
    assert "has-digests" not in decision["signals"]
    assert "has-refs" not in decision["signals"]


def test_provider_route_repair_continuation_allows_bounded_execution():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {
                "goalType": "repair",
                "taskRelation": "repair",
                "requiredArtifacts": ["research-report"],
            },
            "selectedCapabilities": [
                {
                    "id": "provider.search",
                    "kind": "tool",
                    "domain": ["research"],
                    "sideEffects": ["search", "provider"],
                },
                {
                    "id": "provider.fetch",
                    "kind": "tool",
                    "domain": ["research"],
                    "sideEffects": ["fetch", "provider"],
                },
            ],
            "recentFailures": [{"stageId": "provider-first-preflight", "status": "repair-needed"}],
            "priorAttempts": [{"status": "repair-needed", "artifactRefs": ["artifact:failure-diagnostic"]}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "repair" in decision["signals"]
    assert "external-action" in decision["signals"]
    assert "execution-forbidden" not in decision["riskFlags"]


def test_prompt_keyword_text_alone_does_not_drive_execution_mode():
    decision = classify_execution_mode(
        {
            "prompt": "不要重跑，不要执行，不要调用 AgentServer，只基于当前 refs 回答。",
            "recentFailures": [{"status": "failed"}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "no-execution-directive" not in decision["signals"]


def test_continuation_routes_to_repair_or_continue_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "analysis", "taskRelation": "continue"},
            "artifacts": [{"artifactType": "stage-output", "status": "done"}],
            "priorAttempts": [{"status": "done", "artifactRefs": ["stage-output.json"]}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "continuation" in decision["signals"]


def test_mid_run_user_guidance_routes_to_continue_project():
    decision = classify_execution_mode(
        {
            "goalSnapshot": {"goalType": "workflow", "taskRelation": "continue"},
            "artifacts": [{"artifactType": "task-project", "status": "running"}],
            "userGuidanceQueue": [{"text": "只保留开放获取来源，不要付费来源。"}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "mid-run-guidance" in decision["signals"]
    assert "mid-run-guidance" in decision["riskFlags"]


def direct_context_constraints(reference_count: int):
    return {
        "schemaVersion": "sciforge.turn-execution-constraints.v1",
        "policyId": "sciforge.current-turn-execution-constraints.v1",
        "source": "runtime-contract.turn-constraints",
        "contextOnly": True,
        "agentServerForbidden": True,
        "workspaceExecutionForbidden": True,
        "externalIoForbidden": True,
        "codeExecutionForbidden": True,
        "preferredCapabilityIds": ["runtime.direct-context-answer"],
        "executionModeHint": "direct-context-answer",
        "initialResponseModeHint": "direct-context-answer",
        "reasons": ["current-context-only directive"],
        "evidence": {
            "hasPriorContext": reference_count > 0,
            "referenceCount": reference_count,
            "artifactCount": 0,
            "executionRefCount": 0,
            "runCount": 0,
        },
    }
