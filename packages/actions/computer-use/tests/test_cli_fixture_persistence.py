import json
import os
import subprocess
import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
LEGACY_PYTHON_DIAGNOSTIC_ENV = "SCIFORGE_COMPUTER_USE_LEGACY_PYTHON_DIAGNOSTIC"


def run_cli(*args, stdin=None, diagnostic=True):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    if diagnostic:
        env[LEGACY_PYTHON_DIAGNOSTIC_ENV] = "1"
    else:
        env.pop(LEGACY_PYTHON_DIAGNOSTIC_ENV, None)
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use", *args],
        cwd=PACKAGE_ROOT,
        input=stdin,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_cli_fails_closed_without_diagnostic_env():
    completed = run_cli(
        "--request-json",
        json.dumps({"task": "create a local report", "maxSteps": 1}),
        "--fixture-json",
        json.dumps({"plans": [{"done": True, "reason": "would otherwise complete"}]}),
        diagnostic=False,
    )

    assert completed.returncode == 1
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["status"] == "failed-with-reason"
    assert LEGACY_PYTHON_DIAGNOSTIC_ENV in payload["message"]
    assert payload["failureDiagnostics"]["failedStage"] == "legacy-python-diagnostic-gate"


def test_cli_fixture_file_persists_trace_and_result_with_local_final_refs(tmp_path):
    output_dir = tmp_path / "fixture-run"
    final_artifact_fixture_ref = ".sciforge/vision-runs/fixture/final-report.md"
    fixture = {
        "capture": [
            {"ref": ".sciforge/vision-runs/fixture/before-1.png", "summary": "before click"},
            {"ref": ".sciforge/vision-runs/fixture/after-1.png", "summary": "after click"},
            {"ref": ".sciforge/vision-runs/fixture/before-2.png", "summary": "before type"},
            {
                "ref": ".sciforge/vision-runs/fixture/after-2.png",
                "summary": "after type",
                "artifacts": {"finalArtifactRef": final_artifact_fixture_ref},
            },
        ],
        "plans": [
            {"type": "click", "targetDescription": "local input"},
            {"type": "type_text", "text": "closed loop"},
        ],
        "grounding": {"ok": True, "x": 12, "y": 34, "confidence": 0.95},
        "execution": [
            {"ok": True, "message": "clicked"},
            {"ok": True, "message": "typed"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "continue"},
            {"ok": True, "done": True, "reason": "final artifact visible"},
        ],
        "files": {
            final_artifact_fixture_ref: "# Fixture report\n\nclosed loop\n",
        },
    }
    fixture_path = tmp_path / "fixture.json"
    fixture_path.write_text(json.dumps(fixture), encoding="utf8")

    completed = run_cli(
        "--request-json",
        json.dumps({"task": "create a local report", "maxSteps": 3}),
        "--fixture-file",
        str(fixture_path),
        "--fixture-output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    trace_path = (output_dir / "vision-trace.json").resolve()
    result_path = (output_dir / "computer-use-result.json").resolve()
    final_artifact_path = (output_dir / final_artifact_fixture_ref).resolve()

    assert payload["status"] == "completed"
    assert payload["traceRefs"] == [str(trace_path)]
    assert payload["finalArtifactRef"] == str(final_artifact_path)
    assert payload["finalArtifactRefs"] == [str(final_artifact_path)]
    assert [step["action"]["kind"] for step in payload["steps"]] == ["click", "type_text"]
    assert len(payload["steps"]) == 2

    assert trace_path.is_file()
    assert result_path.is_file()
    assert (output_dir / ".sciforge/vision-runs/fixture/before-1.png").read_bytes().startswith(b"\x89PNG")
    final_artifact_text = final_artifact_path.read_text(encoding="utf8")
    assert final_artifact_text.startswith("# Fixture report\n\nclosed loop\n")
    trace = json.loads(trace_path.read_text(encoding="utf8"))
    persisted_result = json.loads(result_path.read_text(encoding="utf8"))
    assert trace["traceRefs"] == [str(trace_path)]
    assert trace["finalArtifactRef"] == str(final_artifact_path)
    assert persisted_result == payload
