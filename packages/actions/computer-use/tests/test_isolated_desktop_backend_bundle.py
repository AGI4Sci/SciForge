import json
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use.isolated_desktop_backend_bundle import (
    BACKEND_BUNDLE_SCHEMA_VERSION,
    DEFAULT_BASE_IMAGE,
    DEFAULT_IMAGE_TAG,
    DOCKERFILE_NAME,
    MANIFEST_NAME,
    REQUIRED_APT_PACKAGES,
    build_isolated_desktop_backend_bundle_manifest,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_isolated_desktop_backend_bundle_manifest_declares_docker_runtime(tmp_path):
    manifest = build_isolated_desktop_backend_bundle_manifest(output_dir=tmp_path / "bundle")

    assert manifest["schemaVersion"] == BACKEND_BUNDLE_SCHEMA_VERSION
    assert manifest["status"] == "spec-ready"
    assert manifest["backendKind"] == "linux-novnc-libreoffice-browser"
    assert manifest["packageRootRef"] == str(PACKAGE_ROOT)
    assert manifest["dockerfileRef"].endswith(f"sciforge_computer_use/{DOCKERFILE_NAME}")
    assert Path(manifest["dockerfileRef"]).is_file()
    assert manifest["dockerfilePathInBuildContext"] == f"sciforge_computer_use/{DOCKERFILE_NAME}"
    assert manifest["dockerfileSha256"]
    assert manifest["imageTag"] == DEFAULT_IMAGE_TAG
    assert manifest["baseImage"] == DEFAULT_BASE_IMAGE
    assert manifest["baseImageEnvVar"] == "SCIFORGE_DOCKER_BASE_IMAGE"
    assert manifest["requiredAptPackages"] == list(REQUIRED_APT_PACKAGES)
    assert all(check["ok"] for check in manifest["checks"])

    assert manifest["build"]["workingDirectoryRef"] == str(PACKAGE_ROOT)
    assert manifest["build"]["command"] == [
        "docker",
        "build",
        "--build-arg",
        f"PYTHON_BASE_IMAGE={DEFAULT_BASE_IMAGE}",
        "--build-arg",
        "DEBIAN_APT_MIRROR=",
        "--build-arg",
        "DEBIAN_SECURITY_APT_MIRROR=",
        "--build-arg",
        "APT_ACQUIRE_RETRIES=3",
        "-f",
        f"sciforge_computer_use/{DOCKERFILE_NAME}",
        "-t",
        DEFAULT_IMAGE_TAG,
        ".",
    ]
    assert manifest["build"]["baseImageOverrideEnv"] == "SCIFORGE_DOCKER_BASE_IMAGE"
    assert manifest["build"]["aptMirrorOverrideEnv"] == "SCIFORGE_DOCKER_DEBIAN_APT_MIRROR"
    assert manifest["build"]["securityAptMirrorOverrideEnv"] == "SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR"
    assert manifest["build"]["aptAcquireRetriesEnv"] == "SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES"
    assert manifest["run"]["backendReadinessCommand"][:8] == [
        "docker",
        "run",
        "--rm",
        "-v",
        "<output-dir>:/evidence",
        "--entrypoint",
        "python",
        DEFAULT_IMAGE_TAG,
    ]
    assert manifest["run"]["l1SmokeCommand"][:8] == [
        "docker",
        "run",
        "--rm",
        "--shm-size",
        "1g",
        "-p",
        "127.0.0.1:6089:6089",
        "-v",
    ]
    assert "--execute" in manifest["run"]["l1SmokeCommand"]
    assert "--privileged" not in manifest["run"]["l1SmokeCommand"]
    assert "--network=host" not in manifest["run"]["l1SmokeCommand"]
    assert manifest["run"]["l3WorkflowCommand"][:9] == [
        "docker",
        "run",
        "--rm",
        "--shm-size",
        "1g",
        "-p",
        "127.0.0.1:6090:6090",
        "-v",
        "<output-dir>:/evidence",
    ]
    assert "--execute" in manifest["run"]["l3WorkflowCommand"]
    assert "-m" in manifest["run"]["l3WorkflowCommand"]
    assert "sciforge_computer_use.isolated_desktop_l3_workflow_probe" in manifest["run"]["l3WorkflowCommand"]
    assert "--privileged" not in manifest["run"]["l3WorkflowCommand"]
    assert "--network=host" not in manifest["run"]["l3WorkflowCommand"]
    assert manifest["run"]["localhostOnlyPublishedPorts"] == {
        "l1NoVnc": "127.0.0.1:6089:6089",
        "l3NoVnc": "127.0.0.1:6090:6090",
    }
    assert manifest["run"]["hostEvidenceOutputDirEnv"] == "SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR"
    assert manifest["run"]["l3HostEvidenceOutputDirEnv"] == "SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR"
    assert manifest["runtimeContract"]["hostEvidenceOutputDirEnv"] == "SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR"
    assert manifest["runtimeContract"]["l3HostEvidenceOutputDirEnv"] == "SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR"
    assert manifest["runtimeContract"]["l3WorkflowProbe"].endswith("isolated_desktop_l3_workflow_probe --output-dir <dir> --execute")

    assert manifest["completionEvidenceRef"] is None
    assert manifest["diagnosticOnly"] is True
    assert manifest["realWindowEvidence"] is False
    assert manifest["userAcceptanceEligible"] is False
    assert manifest["backendCompleted"] is False
    assert manifest["l1SmokeCompleted"] is False
    assert manifest["l3WorkflowCompleted"] is False
    assert manifest["inputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert "not a running backend" in manifest["claimLimit"]
    assert "completed runner refs" in manifest["claimLimit"]
    assert Path(manifest["manifestRef"]).name == MANIFEST_NAME
    assert Path(manifest["manifestRef"]).is_file()


def test_isolated_desktop_backend_bundle_blocks_when_dockerfile_is_missing(tmp_path):
    manifest = build_isolated_desktop_backend_bundle_manifest(
        output_dir=tmp_path / "bundle",
        dockerfile_path=tmp_path / "missing.Dockerfile",
    )

    assert manifest["status"] == "blocked"
    assert manifest["dockerfileSha256"] is None
    assert any(check["category"] == "dockerfile-present" and not check["ok"] for check in manifest["checks"])
    assert manifest["completionEvidenceRef"] is None
    assert manifest["diagnosticOnly"] is True
    assert Path(manifest["manifestRef"]).is_file()


def test_isolated_desktop_backend_bundle_records_build_overrides(tmp_path):
    manifest = build_isolated_desktop_backend_bundle_manifest(
        output_dir=tmp_path / "bundle",
        base_image="hubproxy.docker.internal:5555/library/python:3.12-slim-bookworm",
        apt_mirror="https://mirror.example/debian",
        security_apt_mirror="https://mirror.example/debian-security",
        apt_acquire_retries="5",
        image_tag="sciforge-computer-use-isolated-backend:test",
    )

    assert manifest["status"] == "spec-ready"
    assert manifest["baseImage"] == "hubproxy.docker.internal:5555/library/python:3.12-slim-bookworm"
    assert manifest["aptMirror"] == "https://mirror.example/debian"
    assert manifest["securityAptMirror"] == "https://mirror.example/debian-security"
    assert manifest["aptAcquireRetries"] == "5"
    assert manifest["imageTag"] == "sciforge-computer-use-isolated-backend:test"
    assert "PYTHON_BASE_IMAGE=hubproxy.docker.internal:5555/library/python:3.12-slim-bookworm" in manifest["build"]["command"]
    assert "DEBIAN_APT_MIRROR=https://mirror.example/debian" in manifest["build"]["command"]
    assert "DEBIAN_SECURITY_APT_MIRROR=https://mirror.example/debian-security" in manifest["build"]["command"]
    assert "APT_ACQUIRE_RETRIES=5" in manifest["build"]["command"]


def test_isolated_desktop_backend_bundle_cli_writes_manifest(tmp_path):
    output_dir = tmp_path / "bundle"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_backend_bundle",
            "--output-dir",
            str(output_dir),
            "--base-image",
            "python:3.12-slim-bookworm",
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode == 0
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["schemaVersion"] == BACKEND_BUNDLE_SCHEMA_VERSION
    assert payload["status"] == "spec-ready"
    assert (output_dir / MANIFEST_NAME).is_file()


def test_isolated_desktop_backend_dockerfile_is_in_package_data():
    pyproject = (PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf8")

    assert "[tool.setuptools.package-data]" in pyproject
    assert "sciforge_computer_use" in pyproject
    assert DOCKERFILE_NAME in pyproject


def test_isolated_desktop_backend_dockerfile_supports_base_image_arg():
    dockerfile = (PACKAGE_ROOT / "sciforge_computer_use" / DOCKERFILE_NAME).read_text(encoding="utf8")

    assert "ARG PYTHON_BASE_IMAGE=python:3.12-slim-bookworm" in dockerfile
    assert "FROM ${PYTHON_BASE_IMAGE}" in dockerfile
    assert "ARG DEBIAN_APT_MIRROR=" in dockerfile
    assert "ARG DEBIAN_SECURITY_APT_MIRROR=" in dockerfile
    assert "ARG APT_ACQUIRE_RETRIES=3" in dockerfile
    assert 'Acquire::Retries="${APT_ACQUIRE_RETRIES}"' in dockerfile
