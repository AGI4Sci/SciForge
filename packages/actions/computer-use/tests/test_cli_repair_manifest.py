import json
import os
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use import validateRepairManifest, validate_repair_manifest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[2]


def run_cli(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use", *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_cli_fixture_failure_writes_repair_manifest_then_repaired_fixture_succeeds(tmp_path):
    failed_dir = tmp_path / "ambiguous-failure"
    failed = run_cli(
        "--request-json",
        json.dumps({"task": "click the Save button", "maxSteps": 2}),
        "--fixture-file",
        "packages/actions/computer-use/fixtures/ambiguous-target-failure.fixture.json",
        "--fixture-output-dir",
        str(failed_dir),
    )

    assert failed.returncode == 1
    assert failed.stderr == ""
    failed_payload = json.loads(failed.stdout)
    repair_manifest_path = failed_dir / "blocked-repair-manifest.json"
    assert failed_payload["status"] == "failed-with-reason"
    assert failed_payload["failureDiagnostics"]["failedStage"] == "grounding"
    assert failed_payload["failureDiagnostics"]["repairManifestRef"] == str(repair_manifest_path.resolve())
    assert repair_manifest_path.is_file()
    repair_manifest = json.loads(repair_manifest_path.read_text(encoding="utf8"))
    assert repair_manifest["schemaVersion"] == "sciforge.computer-use.repair-manifest.v1"
    assert repair_manifest["failedStage"] == "grounding"
    assert "multiple matching Save buttons" in repair_manifest["reason"]
    assert repair_manifest["traceRefs"] == [str((failed_dir / "vision-trace.json").resolve())]
    assert repair_manifest["realWindowEvidence"] is False
    assert repair_manifest["diagnosticOnly"] is True
    assert repair_manifest["inputExecuted"] is False
    assert repair_manifest["sharedSystemInputUsed"] is False
    assert repair_manifest["rawPayloadWritten"] is False
    assert repair_manifest["inlineImageWritten"] is False
    assert repair_manifest["failureDiagnostics"].get("realWindowEvidence") is not True
    assert validateRepairManifest is validate_repair_manifest
    validation = validate_repair_manifest(repair_manifest_path, require_existing_refs=True)
    assert validation["ok"] is True
    assert validation["failedStageCategory"] == "grounding"
    assert validation["resultRef"] == str((failed_dir / "computer-use-result.json").resolve())

    repaired_dir = tmp_path / "ambiguous-repaired"
    repaired = run_cli(
        "--request-json",
        json.dumps({
            "task": "click the lower-right blue Save button",
            "maxSteps": 2,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--fixture-file",
        "packages/actions/computer-use/fixtures/ambiguous-target-repaired.fixture.json",
        "--fixture-output-dir",
        str(repaired_dir),
    )

    assert repaired.returncode == 0
    repaired_payload = json.loads(repaired.stdout)
    assert repaired_payload["status"] == "completed"
    final_artifact = Path(repaired_payload["finalArtifactRef"])
    assert final_artifact.read_text(encoding="utf8").startswith("# Repaired Save Target")
    assert not (repaired_dir / "blocked-repair-manifest.json").exists()


def test_repair_manifest_validator_rejects_inline_payloads_and_package_local_promotion(tmp_path):
    result_ref = tmp_path / "computer-use-result.json"
    trace_ref = tmp_path / "vision-trace.json"
    screenshot_ref = tmp_path / "after.png"
    for path in (result_ref, trace_ref, screenshot_ref):
        path.write_text("{}", encoding="utf8")

    valid = {
        "schemaVersion": "sciforge.computer-use.repair-manifest.v1",
        "status": "failed-with-reason",
        "reason": "ambiguous target",
        "failedStage": "grounding",
        "failureDiagnostics": {"failedStage": "grounding", "realWindowEvidence": False},
        "resultRef": str(result_ref),
        "traceRefs": [str(trace_ref)],
        "screenshotRefs": [str(screenshot_ref)],
        "realWindowEvidence": False,
        "diagnosticOnly": True,
        "inputExecuted": False,
        "sharedSystemInputUsed": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
    }
    assert validate_repair_manifest(valid, require_existing_refs=True)["ok"] is True

    promoted = {
        **valid,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "inputExecuted": True,
        "realWindowEvidenceRefs": [str(screenshot_ref)],
        "targetBindingValidation": {
            "ok": True,
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
        },
    }
    promoted_codes = {error["code"] for error in validate_repair_manifest(promoted)["errors"]}
    assert "package_local_failure_promoted_to_real_window" in promoted_codes

    inline = {**valid, "screenshotRefs": ["data:image/png;base64,AAAA"], "inlineImageWritten": True}
    inline_codes = {error["code"] for error in validate_repair_manifest(inline)["errors"]}
    assert "inline_payload_forbidden" in inline_codes
    assert "inline_image_written_not_false" in inline_codes

    missing_ref_codes = {
        error["code"]
        for error in validate_repair_manifest(
            {**valid, "resultRef": str(tmp_path / "missing-result.json")},
            require_existing_refs=True,
        )["errors"]
    }
    assert "manifest_ref_not_found" in missing_ref_codes
