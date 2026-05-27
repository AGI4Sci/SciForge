from sciforge_computer_use import (
    ActionPlan,
    ActionTarget,
    ComputerUseRequest,
    ExecutionOutcome,
    Grounding,
    Observation,
    Verification,
    result_to_trace,
    run_computer_use_task,
)


class FakeSense:
    def __init__(self, refs=None, artifacts=None, metadata=None):
        self.refs = list(refs or ["before.png", "after.png"])
        self.artifacts = artifacts or {}
        self.metadata = metadata or {}
        self.observe_count = 0

    def observe(self, request, history, query=None):
        ref = self.refs[min(self.observe_count, len(self.refs) - 1)]
        self.observe_count += 1
        return Observation(
            ref=ref,
            summary=f"screen {ref}",
            artifacts=self.artifacts,
            metadata=self.metadata,
        )

    def query(self, observation, question, history):
        return {"answer": observation.summary}

    def locate(self, observation, target, history):
        return Grounding(ok=True, x=10, y=20, confidence=0.9)


class FakePlanner:
    def __init__(self, plans):
        self.plans = list(plans)

    def plan(self, request, observation, history):
        return self.plans[min(len(history), len(self.plans) - 1)]


class FakeExecutor:
    def execute(self, action, grounding, request):
        return ExecutionOutcome(ok=True, message="executed")


class FakeVerifier:
    def __init__(self, metadata=None):
        self.metadata = metadata or {}

    def verify(self, request, before, after, action, execution, history):
        return Verification(ok=True, done=True, reason="verified", changed=True, metadata=self.metadata)


def test_planner_metadata_cannot_satisfy_required_final_artifact_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report",
            max_steps=1,
            metadata={"requiresFinalArtifact": True},
        ),
        FakeSense(refs=["final.png"]),
        FakePlanner([
            ActionPlan(
                done=True,
                reason="planner says report is complete",
                metadata={"finalArtifactRef": ".sciforge/vision-runs/planner-only/report.md"},
            )
        ]),
        FakeExecutor(),
        FakeVerifier(),
    )

    assert result.status == "failed-with-reason"
    assert result.final_artifact_refs == ()
    assert result.failure_diagnostics["failedStage"] == "final-artifact-evidence"
    assert result.failure_diagnostics["plannerFinalArtifactRefs"] == [
        ".sciforge/vision-runs/planner-only/report.md"
    ]
    trace = result_to_trace(result)
    assert trace["finalArtifactRef"] is None
    assert trace["finalArtifactRefs"] == []


def test_final_observation_artifact_satisfies_required_final_artifact_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report",
            max_steps=1,
            metadata={"acceptance": {"requiresFinalArtifact": True}},
        ),
        FakeSense(
            refs=["final.png"],
            artifacts={"finalArtifactRef": ".sciforge/vision-runs/final-observation/report.md"},
        ),
        FakePlanner([ActionPlan(done=True, reason="final report is visible")]),
        FakeExecutor(),
        FakeVerifier(),
    )

    assert result.status == "completed"
    assert result.final_artifact_refs == (".sciforge/vision-runs/final-observation/report.md",)


def test_verifier_metadata_satisfies_required_final_artifact_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report",
            max_steps=1,
            metadata={"artifactPolicy": {"requiresFinalArtifact": True}},
        ),
        FakeSense(refs=["before.png", "after.png"]),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="Create report"))]),
        FakeExecutor(),
        FakeVerifier(
            metadata={
                "finalArtifactRefs": [
                    ".sciforge/vision-runs/verifier/report.md",
                ],
            }
        ),
    )

    assert result.status == "completed"
    assert result.final_artifact_refs == (".sciforge/vision-runs/verifier/report.md",)


def test_directory_evidence_requires_file_list_artifact_and_data_refs():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report and prove directory contents",
            max_steps=1,
            metadata={
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        ),
        FakeSense(
            refs=["before.png", "final.png"],
            artifacts={"finalArtifactRef": ".sciforge/vision-runs/final/report.md"},
        ),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="Create report"))]),
        FakeExecutor(),
        FakeVerifier(),
    )

    assert result.status == "failed-with-reason"
    assert result.final_artifact_refs == ()
    assert result.failure_diagnostics["failedStage"] == "directory-evidence"
    assert result.failure_diagnostics["finalArtifactRefs"] == [
        ".sciforge/vision-runs/final/report.md"
    ]
    assert result.failure_diagnostics["finalObservationScreenshotRef"] == "final.png"
    assert result.failure_diagnostics["fileListArtifactRefs"] == []
    assert result.failure_diagnostics["fileListDataRefs"] == []


def test_planner_metadata_cannot_satisfy_required_directory_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report and prove directory contents",
            max_steps=1,
            metadata={
                "requiresFinalArtifact": True,
                "fileListEvidenceRequired": True,
            },
        ),
        FakeSense(
            refs=["final.png"],
            artifacts={"finalArtifactRef": ".sciforge/vision-runs/final-observation/report.md"},
        ),
        FakePlanner([
            ActionPlan(
                done=True,
                reason="planner says report and directory evidence are complete",
                metadata={
                    "fileListArtifactRef": ".sciforge/vision-runs/planner/file-list.json",
                    "fileListDataRef": ".sciforge/vision-runs/planner/file-list-data.json",
                },
            )
        ]),
        FakeExecutor(),
        FakeVerifier(),
    )

    assert result.status == "failed-with-reason"
    assert result.final_artifact_refs == ()
    assert result.failure_diagnostics["failedStage"] == "directory-evidence"
    assert result.failure_diagnostics["finalArtifactRefs"] == [
        ".sciforge/vision-runs/final-observation/report.md"
    ]
    assert result.failure_diagnostics["fileListArtifactRefs"] == []
    assert result.failure_diagnostics["fileListDataRefs"] == []


def test_verifier_metadata_satisfies_required_directory_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="create final report and prove directory contents",
            max_steps=1,
            metadata={
                "acceptance": {
                    "requiresFinalArtifact": True,
                    "requiresFileListEvidence": True,
                },
            },
        ),
        FakeSense(refs=["before.png", "final.png"]),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="Create report"))]),
        FakeExecutor(),
        FakeVerifier(
            metadata={
                "finalArtifactRef": ".sciforge/vision-runs/verifier/report.md",
                "fileListArtifactRef": ".sciforge/vision-runs/verifier/file-list.json",
                "fileListDataRef": ".sciforge/vision-runs/verifier/file-list-data.json",
            }
        ),
    )

    assert result.status == "completed"
    assert result.final_artifact_refs == (".sciforge/vision-runs/verifier/report.md",)
