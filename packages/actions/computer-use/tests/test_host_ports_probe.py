import json
import os
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use import validate_trace


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
TASK_B_PROBE = PACKAGE_ROOT / "fixtures" / "host-port-probe-task-b.json"
SHARED_INPUT_PROBE = PACKAGE_ROOT / "fixtures" / "host-port-probe-shared-input-blocked.json"


def run_probe(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use.host_ports_probe", *args],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_host_port_probe_runs_six_step_task_b_over_stdio(tmp_path):
    output_dir = tmp_path / "task-b-probe"
    completed = run_probe(
        "--request-json",
        json.dumps({
            "task": "complete task B through package-local host-port probe",
            "maxSteps": 8,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--probe-file",
        str(TASK_B_PROBE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    manifest_path = output_dir / "host-port-probe-manifest.json"
    result_path = output_dir / "computer-use-result.json"
    trace_path = output_dir / "vision-trace.json"

    assert payload["status"] == "completed"
    assert len(payload["steps"]) == 6
    assert payload["traceRefs"] == [str(trace_path.resolve())]
    assert Path(payload["finalArtifactRef"]).read_text(encoding="utf8").startswith("# Host Port Probe Task B")
    assert manifest_path.is_file()
    assert result_path.is_file()
    assert trace_path.is_file()

    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    assert manifest["schemaVersion"] == "sciforge.computer-use.host-port-probe-manifest.v1"
    assert manifest["mode"] == "scripted-host-ports"
    assert manifest["allowSharedInput"] is False
    assert manifest["note"].endswith("Scripted mode is not real desktop input evidence.")
    assert [call["port"] for call in manifest["hostPortCalls"]].count("execute") == 6
    assert "host-port-probe-task-b-file-list.json" in " ".join(payload["artifactRefs"])
    trace_validation = validate_trace(trace_path)
    assert trace_validation["ok"] is True
    assert payload["finalArtifactRef"] in trace_validation["finalArtifactRefs"]


def test_host_port_probe_blocks_shared_system_input_without_ack(tmp_path):
    output_dir = tmp_path / "shared-input-blocked"
    blocked = run_probe(
        "--request-json",
        json.dumps({"task": "click shared system input target", "maxSteps": 2}),
        "--probe-file",
        str(SHARED_INPUT_PROBE),
        "--output-dir",
        str(output_dir),
    )

    assert blocked.returncode == 1
    assert blocked.stderr == ""
    payload = json.loads(blocked.stdout)
    assert payload["status"] == "failed-with-reason"
    assert "Shared system input is disabled" in payload["reason"]
    manifest = json.loads((output_dir / "host-port-probe-manifest.json").read_text(encoding="utf8"))
    assert manifest["status"] == "failed-with-reason"
    assert manifest["allowSharedInput"] is False
