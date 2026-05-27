import json
import os
import subprocess
import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = PACKAGE_ROOT / "fixtures" / "six-step-file-evidence.fixture.json"


def run_cli(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use", *args],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_cli_six_step_file_evidence_fixture_persists_refs(tmp_path):
    output_dir = tmp_path / "six-step-file-evidence"

    completed = run_cli(
        "--request-json",
        json.dumps(
            {
                "task": "complete realistic complex task B with package-local file evidence",
                "maxSteps": 8,
                "metadata": {
                    "requiresFinalArtifact": True,
                    "requiresDirectoryEvidence": True,
                },
            }
        ),
        "--fixture-file",
        str(FIXTURE_PATH),
        "--fixture-output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    trace_path = (output_dir / "vision-trace.json").resolve()
    result_path = (output_dir / "computer-use-result.json").resolve()

    assert payload["status"] == "completed"
    assert len(payload["steps"]) >= 6
    assert payload["metrics"]["stepCount"] >= 6
    assert payload["traceRefs"] == [str(trace_path)]
    assert trace_path.is_file()
    assert result_path.is_file()

    for step in payload["steps"]:
        assert step["screenshotRefs"], step
        for ref in step["screenshotRefs"]:
            assert Path(ref).is_file()

    final_artifact_ref = payload["finalArtifactRef"]
    assert final_artifact_ref
    final_artifact_path = Path(final_artifact_ref)
    assert final_artifact_path.is_file()
    assert final_artifact_path.read_text(encoding="utf8").startswith("# Task B File Evidence")

    file_list_ref = str((output_dir / ".sciforge/vision-runs/fixture-task-b/task-b-file-list.json").resolve())
    file_list_data_ref = str((output_dir / ".sciforge/vision-runs/fixture-task-b/task-b-file-list-data.json").resolve())
    assert file_list_ref in payload["artifactRefs"]
    assert file_list_data_ref in payload["artifactRefs"]
    assert Path(file_list_ref).is_file()
    assert Path(file_list_data_ref).is_file()

    trace = json.loads(trace_path.read_text(encoding="utf8"))
    persisted_result = json.loads(result_path.read_text(encoding="utf8"))
    assert trace["finalArtifactRef"] == final_artifact_ref
    assert file_list_ref in trace["artifactRefs"]
    assert file_list_data_ref in trace["artifactRefs"]
    assert persisted_result == payload
