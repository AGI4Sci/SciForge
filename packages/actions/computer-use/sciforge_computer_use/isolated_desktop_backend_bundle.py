"""Refs-first manifest for the isolated desktop container bundle.

The bundle probe is intentionally specification-only. It verifies that the
package carries a Dockerfile and records reproducible build/run commands, but
it does not build an image, launch noVNC, capture screenshots, or execute GUI
input. Real backend completion belongs to the L1/L3 runner evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .isolated_desktop_contracts import BACKEND_KIND


BACKEND_BUNDLE_SCHEMA_VERSION = "sciforge.computer-use.isolated-desktop-backend-bundle.v1"
MANIFEST_NAME = "isolated-desktop-backend-bundle-manifest.json"
DOCKERFILE_NAME = "isolated_desktop_backend.Dockerfile"
DEFAULT_BASE_IMAGE = "python:3.12-slim-bookworm"
DEFAULT_IMAGE_TAG = "sciforge-computer-use-isolated-backend:local"
DEFAULT_CONTAINER_OUTPUT_MOUNT = "<output-dir>:/evidence"
DEFAULT_CONTAINER_OUTPUT_DIR = "/evidence"
DEFAULT_APT_ACQUIRE_RETRIES = "3"
DEFAULT_L1_EVIDENCE_OUTPUT_DIR_ENV = "SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR"
DEFAULT_L3_EVIDENCE_OUTPUT_DIR_ENV = "SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR"
DEFAULT_EVIDENCE_OUTPUT_DIR_ENV = DEFAULT_L1_EVIDENCE_OUTPUT_DIR_ENV

REQUIRED_APT_PACKAGES = (
    "ca-certificates",
    "chromium",
    "fonts-dejavu",
    "imagemagick",
    "libreoffice-writer",
    "novnc",
    "openbox",
    "scrot",
    "websockify",
    "x11vnc",
    "xdotool",
    "xvfb",
)

REQUIRED_DOCKERFILE_MARKERS = (
    "ARG PYTHON_BASE_IMAGE=python:3.12-slim-bookworm",
    "FROM ${PYTHON_BASE_IMAGE}",
    "ARG DEBIAN_APT_MIRROR=",
    "ARG DEBIAN_SECURITY_APT_MIRROR=",
    "ARG APT_ACQUIRE_RETRIES=3",
    'Acquire::Retries="${APT_ACQUIRE_RETRIES}"',
    "ENTRYPOINT",
    "sciforge_computer_use.isolated_desktop_l1_smoke_probe",
    "COPY sciforge_computer_use ./sciforge_computer_use",
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the isolated desktop backend container bundle manifest.")
    parser.add_argument("--output-dir", required=True, help="Directory where the bundle manifest is written.")
    parser.add_argument("--image-tag", default=DEFAULT_IMAGE_TAG, help="Docker image tag to record in build/run commands.")
    parser.add_argument("--base-image", default=DEFAULT_BASE_IMAGE, help="Python base image to record in Docker build commands.")
    parser.add_argument("--apt-mirror", default="", help="Optional Debian apt mirror URL to record in Docker build commands.")
    parser.add_argument(
        "--security-apt-mirror",
        default="",
        help="Optional Debian security apt mirror URL to record in Docker build commands.",
    )
    parser.add_argument(
        "--apt-acquire-retries",
        default=DEFAULT_APT_ACQUIRE_RETRIES,
        help="Apt Acquire::Retries value to record in Docker build commands.",
    )
    args = parser.parse_args(argv)

    manifest = build_isolated_desktop_backend_bundle_manifest(
        output_dir=Path(args.output_dir).expanduser(),
        image_tag=args.image_tag,
        base_image=args.base_image,
        apt_mirror=args.apt_mirror,
        security_apt_mirror=args.security_apt_mirror,
        apt_acquire_retries=args.apt_acquire_retries,
    )
    json.dump(manifest, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest["status"] == "spec-ready" else 1


def build_isolated_desktop_backend_bundle_manifest(
    *,
    output_dir: str | Path,
    package_root: str | Path | None = None,
    dockerfile_path: str | Path | None = None,
    image_tag: str = DEFAULT_IMAGE_TAG,
    base_image: str = DEFAULT_BASE_IMAGE,
    apt_mirror: str = "",
    security_apt_mirror: str = "",
    apt_acquire_retries: str = DEFAULT_APT_ACQUIRE_RETRIES,
) -> dict[str, Any]:
    """Write a manifest describing the package-owned Linux/noVNC Docker bundle."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_ref = (root / MANIFEST_NAME).resolve()
    resolved_package_root = Path(package_root).expanduser().resolve() if package_root else Path(__file__).resolve().parents[1]
    resolved_dockerfile = (
        Path(dockerfile_path).expanduser().resolve()
        if dockerfile_path
        else resolved_package_root / "sciforge_computer_use" / DOCKERFILE_NAME
    )
    dockerfile_text = resolved_dockerfile.read_text(encoding="utf8") if resolved_dockerfile.is_file() else ""
    dockerfile_rel = _relative_posix(resolved_dockerfile, resolved_package_root)
    checks = _bundle_checks(
        package_root=resolved_package_root,
        dockerfile_path=resolved_dockerfile,
        dockerfile_text=dockerfile_text,
    )
    status = "spec-ready" if all(check["ok"] for check in checks) else "blocked"
    blocked_reasons = [check["reason"] for check in checks if not check["ok"]]
    dockerfile_sha256 = hashlib.sha256(dockerfile_text.encode("utf8")).hexdigest() if dockerfile_text else None

    manifest: dict[str, Any] = {
        "schemaVersion": BACKEND_BUNDLE_SCHEMA_VERSION,
        "status": status,
        "category": "isolated-desktop-backend-container-spec" if status == "spec-ready" else "isolated-desktop-backend-container-spec-blocked",
        "backendKind": BACKEND_KIND,
        "reason": (
            "Package-owned Docker backend bundle spec is present; build/run still require an explicit Linux or Docker execution."
            if status == "spec-ready"
            else "; ".join(blocked_reasons)
        ),
        "blockedReasons": blocked_reasons,
        "manifestRef": str(manifest_ref),
        "packageRootRef": str(resolved_package_root),
        "dockerfileRef": str(resolved_dockerfile),
        "dockerfilePathInBuildContext": dockerfile_rel,
        "dockerfileSha256": dockerfile_sha256,
        "imageTag": image_tag,
        "baseImage": base_image,
        "baseImageEnvVar": "SCIFORGE_DOCKER_BASE_IMAGE",
        "aptMirror": apt_mirror,
        "aptMirrorEnvVar": "SCIFORGE_DOCKER_DEBIAN_APT_MIRROR",
        "securityAptMirror": security_apt_mirror,
        "securityAptMirrorEnvVar": "SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR",
        "aptAcquireRetries": apt_acquire_retries,
        "aptAcquireRetriesEnvVar": "SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES",
        "requiredAptPackages": list(REQUIRED_APT_PACKAGES),
        "requiredDockerfileMarkers": list(REQUIRED_DOCKERFILE_MARKERS),
        "checks": checks,
        "build": {
            "workingDirectoryRef": str(resolved_package_root),
            "contextRef": str(resolved_package_root),
            "command": [
                "docker",
                "build",
                "--build-arg",
                f"PYTHON_BASE_IMAGE={base_image}",
                "--build-arg",
                f"DEBIAN_APT_MIRROR={apt_mirror}",
                "--build-arg",
                f"DEBIAN_SECURITY_APT_MIRROR={security_apt_mirror}",
                "--build-arg",
                f"APT_ACQUIRE_RETRIES={apt_acquire_retries}",
                "-f",
                dockerfile_rel,
                "-t",
                image_tag,
                ".",
            ],
            "buildContextMustBePackageRoot": True,
            "baseImageOverrideEnv": "SCIFORGE_DOCKER_BASE_IMAGE",
            "aptMirrorOverrideEnv": "SCIFORGE_DOCKER_DEBIAN_APT_MIRROR",
            "securityAptMirrorOverrideEnv": "SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR",
            "aptAcquireRetriesEnv": "SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES",
        },
        "run": {
            "evidenceOutputMount": DEFAULT_CONTAINER_OUTPUT_MOUNT,
            "hostEvidenceOutputDirEnv": DEFAULT_EVIDENCE_OUTPUT_DIR_ENV,
            "l1HostEvidenceOutputDirEnv": DEFAULT_L1_EVIDENCE_OUTPUT_DIR_ENV,
            "l3HostEvidenceOutputDirEnv": DEFAULT_L3_EVIDENCE_OUTPUT_DIR_ENV,
            "backendReadinessCommand": [
                "docker",
                "run",
                "--rm",
                "-v",
                DEFAULT_CONTAINER_OUTPUT_MOUNT,
                "--entrypoint",
                "python",
                image_tag,
                "-m",
                "sciforge_computer_use.isolated_desktop_backend_probe",
                "--output-dir",
                f"{DEFAULT_CONTAINER_OUTPUT_DIR}/backend",
            ],
            "l1SmokeCommand": [
                "docker",
                "run",
                "--rm",
                "--shm-size",
                "1g",
                "-p",
                "127.0.0.1:6089:6089",
                "-v",
                DEFAULT_CONTAINER_OUTPUT_MOUNT,
                image_tag,
                "--output-dir",
                f"{DEFAULT_CONTAINER_OUTPUT_DIR}/l1",
                "--execute",
                "--display",
                ":99",
                "--vnc-port",
                "5909",
                "--novnc-port",
                "6089",
                "--timeout-seconds",
                "30",
                "--resource-lock-root",
                "/tmp/sciforge-computer-use-l1-locks",
            ],
            "l3WorkflowCommand": [
                "docker",
                "run",
                "--rm",
                "--shm-size",
                "1g",
                "-p",
                "127.0.0.1:6090:6090",
                "-v",
                DEFAULT_CONTAINER_OUTPUT_MOUNT,
                "--entrypoint",
                "python",
                image_tag,
                "-m",
                "sciforge_computer_use.isolated_desktop_l3_workflow_probe",
                "--output-dir",
                f"{DEFAULT_CONTAINER_OUTPUT_DIR}/l3",
                "--execute",
                "--display",
                ":100",
                "--vnc-port",
                "5910",
                "--novnc-port",
                "6090",
                "--timeout-seconds",
                "90",
                "--resource-lock-root",
                "/tmp/sciforge-computer-use-l3-locks",
            ],
            "localhostOnlyPublishedPorts": {"l1NoVnc": "127.0.0.1:6089:6089", "l3NoVnc": "127.0.0.1:6090:6090"},
            "forbiddenDockerOptions": ["--privileged", "--network=host", "--network", "host"],
        },
        "runtimeContract": {
            "entrypoint": "python -m sciforge_computer_use.isolated_desktop_l1_smoke_probe",
            "backendReadinessProbe": "python -m sciforge_computer_use.isolated_desktop_backend_probe --output-dir <dir>",
            "l1SmokeProbe": "python -m sciforge_computer_use.isolated_desktop_l1_smoke_probe --output-dir <dir> --execute",
            "l3WorkflowProbe": "python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe --output-dir <dir> --execute",
            "localhostOnlyNoVnc": True,
            "requiredEvidenceOutputMount": DEFAULT_CONTAINER_OUTPUT_MOUNT,
            "hostEvidenceOutputDirEnv": DEFAULT_EVIDENCE_OUTPUT_DIR_ENV,
            "l1HostEvidenceOutputDirEnv": DEFAULT_L1_EVIDENCE_OUTPUT_DIR_ENV,
            "l3HostEvidenceOutputDirEnv": DEFAULT_L3_EVIDENCE_OUTPUT_DIR_ENV,
            "requiredCompletedEvidenceRefs": [
                "completionEvidenceRef",
                "backendReadinessProofRef",
                "processRef",
                "resourceAllocationRef",
                "executorCommandEventLogRef",
                "targetWindowRef",
                "windowBoundPointerProofRef",
                "viewerManifestRef",
                "traceRefs",
                "screenshotRefs",
                "inputEventLogRef",
            ],
        },
        "traceRefs": [],
        "artifactRefs": [],
        "screenshotRefs": [],
        "completionEvidenceRef": None,
        "diagnosticOnly": True,
        "realWindowEvidence": False,
        "userAcceptanceEligible": False,
        "backendCompleted": False,
        "l1SmokeCompleted": False,
        "l3WorkflowCompleted": False,
        "inputExecuted": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "claimLimit": (
            "This bundle manifest only proves that a reproducible Linux/noVNC Docker spec is present in the package. "
            "It is not a Docker build log, not a running backend, and not L1/L3 completion evidence without completed runner refs."
        ),
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _bundle_checks(*, package_root: Path, dockerfile_path: Path, dockerfile_text: str) -> list[dict[str, Any]]:
    checks = [
        _check(dockerfile_path.is_file(), "dockerfile-present", f"Dockerfile not found: {dockerfile_path}."),
        _check((package_root / "pyproject.toml").is_file(), "pyproject-present", "Build context is missing pyproject.toml."),
        _check((package_root / "README.md").is_file(), "readme-present", "Build context is missing README.md."),
        _check((package_root / "sciforge_computer_use").is_dir(), "package-dir-present", "Build context is missing sciforge_computer_use/."),
    ]
    if dockerfile_text:
        for package_name in REQUIRED_APT_PACKAGES:
            checks.append(_check(
                package_name in dockerfile_text,
                f"apt-package:{package_name}",
                f"Dockerfile does not install required apt package {package_name}.",
            ))
        for marker in REQUIRED_DOCKERFILE_MARKERS:
            checks.append(_check(
                marker in dockerfile_text,
                f"dockerfile-marker:{marker}",
                f"Dockerfile is missing required marker {marker!r}.",
            ))
    return checks


def _check(ok: bool, category: str, reason: str = "") -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": "" if ok else reason}


def _relative_posix(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


__all__ = [
    "BACKEND_BUNDLE_SCHEMA_VERSION",
    "DEFAULT_BASE_IMAGE",
    "DEFAULT_IMAGE_TAG",
    "DOCKERFILE_NAME",
    "MANIFEST_NAME",
    "REQUIRED_APT_PACKAGES",
    "build_isolated_desktop_backend_bundle_manifest",
    "main",
]


if __name__ == "__main__":  # pragma: no cover - exercised by CLI tests.
    raise SystemExit(main())
