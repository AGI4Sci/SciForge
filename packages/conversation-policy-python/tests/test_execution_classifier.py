from sciforge_conversation.execution_classifier import classify_execution_mode


def test_existing_artifact_explanation_uses_direct_context_answer():
    decision = classify_execution_mode(
        {
            "prompt": "解释这个已有结果表的置信区间是什么意思。",
            "artifacts": [{"artifactType": "table", "status": "done", "summary": "model metrics"}],
        }
    )

    assert decision["executionMode"] == "direct-context-answer"
    assert decision["reproducibilityLevel"] == "none"
    assert decision["stagePlanHint"] == []
    assert 0 <= decision["complexityScore"] <= 1
    assert decision["complexityScore"] < 0.25


def test_simple_current_events_search_uses_thin_reproducible_adapter():
    decision = classify_execution_mode(
        {
            "prompt": "查一下今天这个工具的最新发布状态，简单总结。",
            "selectedTools": [{"id": "web.search", "summary": "Search current web pages."}],
        }
    )

    assert decision["executionMode"] == "thin-reproducible-adapter"
    assert decision["reproducibilityLevel"] == "light"
    assert decision["stagePlanHint"] == ["search", "fetch", "emit"]
    assert "external-information-required" in decision["riskFlags"]


def test_simple_literature_search_uses_thin_reproducible_adapter():
    decision = classify_execution_mode(
        {
            "prompt": "搜索几篇关于 graph retrieval 的近期论文，给我标题和链接。",
            "selectedCapabilities": [{"id": "literature.search", "summary": "Search academic literature."}],
        }
    )

    assert decision["executionMode"] == "thin-reproducible-adapter"
    assert decision["reproducibilityLevel"] == "light"
    assert decision["stagePlanHint"] == ["search", "emit"]
    assert "research" in decision["signals"]


def test_systematic_literature_review_routes_to_multi_stage_project():
    decision = classify_execution_mode(
        {
            "prompt": "做一个系统性文献调研，比较近期研究证据，输出报告和证据表。",
            "expectedArtifactTypes": ["research-report", "evidence-table"],
            "selectedCapabilities": [{"id": "literature.search", "summary": "Search academic sources."}],
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
            "prompt": "下载这些记录对应的全文 PDF，并阅读全文提取方法和结论。",
            "refs": [{"ref": "papers.json"}],
            "expectedArtifactTypes": ["pdf-bundle", "extraction-table"],
            "selectedTools": [{"id": "http.fetch", "summary": "Fetch remote full text PDFs."}],
        }
    )

    assert decision["executionMode"] == "multi-stage-project"
    assert decision["reproducibilityLevel"] == "staged"
    assert "fetch" in decision["stagePlanHint"]
    assert "full-text-or-large-fetch" in decision["riskFlags"]


def test_code_modification_is_single_stage_task():
    decision = classify_execution_mode(
        {
            "prompt": "修改 src/parser.py，补上这个边界条件的测试。",
            "refs": [{"ref": "src/parser.py"}],
            "selectedTools": [{"id": "filesystem.edit", "summary": "Edit workspace files."}],
        }
    )

    assert decision["executionMode"] == "single-stage-task"
    assert decision["reproducibilityLevel"] == "full"
    assert decision["stagePlanHint"] == ["analyze", "modify", "validate", "emit"]
    assert "code-or-workspace-side-effect" in decision["riskFlags"]


def test_file_exploration_is_single_stage_task():
    decision = classify_execution_mode({"prompt": "探索工作区文件，找到当前入口路径。"})

    assert decision["executionMode"] == "single-stage-task"
    assert decision["stagePlanHint"] == ["fetch", "analyze", "emit"]
    assert "needs-workspace-discovery" in decision["riskFlags"]


def test_long_high_uncertainty_task_routes_to_multi_stage_project():
    decision = classify_execution_mode(
        {
            "prompt": "完成一个大型开放式分析，未知数据质量，全面比较多个方案然后验证。",
            "expectedArtifactTypes": ["analysis.md"],
            "selectedTools": [{"id": "workspace.shell", "summary": "Run commands."}],
            "selectedVerifiers": [{"id": "result.validator"}],
        }
    )

    assert decision["executionMode"] == "multi-stage-project"
    assert decision["uncertaintyScore"] >= 0.5
    assert "long-running-or-open-ended" in decision["riskFlags"]


def test_recent_failure_routes_to_repair_or_continue_project():
    decision = classify_execution_mode(
        {
            "prompt": "根据日志修复上一轮失败。",
            "recentFailures": [{"stageId": "2-fetch", "failureReason": "timeout"}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert decision["reproducibilityLevel"] == "staged"
    assert "repair" in decision["signals"]
    assert "recent-failure" in decision["riskFlags"]


def test_continuation_routes_to_repair_or_continue_project():
    decision = classify_execution_mode(
        {
            "prompt": "继续上一轮，从最新 artifact 接着生成最终表格。",
            "artifacts": [{"artifactType": "stage-output", "status": "done"}],
            "priorAttempts": [{"status": "done", "artifactRefs": ["stage-output.json"]}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "continuation" in decision["signals"]


def test_mid_run_user_guidance_routes_to_continue_project():
    decision = classify_execution_mode(
        {
            "prompt": "下一阶段继续生成表格。",
            "artifacts": [{"artifactType": "task-project", "status": "running"}],
            "userGuidanceQueue": [{"text": "只保留开放获取来源，不要付费来源。"}],
        }
    )

    assert decision["executionMode"] == "repair-or-continue-project"
    assert "mid-run-guidance" in decision["signals"]
    assert "mid-run-guidance" in decision["riskFlags"]
