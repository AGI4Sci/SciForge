"""Readiness probe for the first isolated desktop backend.

This module does not launch noVNC, capture screenshots, or execute input. It
records whether the local host has the components needed for a future Linux
desktop + noVNC + LibreOffice/browser backend, and fails closed otherwise.
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import sys
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_contracts import (
    BACKEND_KIND,
    ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
)

ISOLATED_DESKTOP_BACKEND_SCHEMA = ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION
MANIFEST_NAME = "isolated-desktop-backend-probe-manifest.json"
NO_OS_INPUT_FLAGS = {
    "inputExecuted": False,
    "osInputExecuted": False,
    "realOsInputExecuted": False,
    "sharedSystemInputUsed": False,
    "systemPointerMoved": False,
    "systemKeyboardEventsSent": False,
}

REQUIRED_COMPONENTS: dict[str, tuple[str, ...]] = {
    "virtualDisplay": ("Xvfb",),
    "windowManager": ("openbox", "fluxbox", "xfwm4"),
    "vncServer": ("x11vnc", "x0vncserver"),
    "noVncProxy": ("websockify", "novnc_proxy"),
    "documentApp": ("libreoffice", "soffice"),
    "browser": ("chromium", "chromium-browser", "google-chrome", "firefox"),
}
NOVNC_WEB_ROOT_CANDIDATES = (
    "/usr/share/novnc",
    "/usr/local/share/novnc",
    "/opt/novnc",
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe isolated desktop backend readiness.")
    parser.add_argument("--output-dir", required=True, help="Directory where the backend manifest is written.")
    args = parser.parse_args(argv)

    manifest = build_isolated_desktop_backend_manifest(output_dir=Path(args.output_dir).expanduser())
    json.dump(manifest, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest["status"] == "ready" else 1


def build_isolated_desktop_backend_manifest(
    *,
    output_dir: str | Path,
    platform_system: str | None = None,
    command_resolver: Callable[[str], str | None] | None = None,
    path_exists: Callable[[str], bool] | None = None,
) -> dict[str, Any]:
    """Write a refs-first readiness manifest for the Linux noVNC backend."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_ref = (root / MANIFEST_NAME).resolve()
    system = platform_system or platform.system()
    resolver = command_resolver or shutil.which
    exists = path_exists or (lambda value: Path(value).exists())
    components = {
        name: _resolve_component(candidates, resolver)
        for name, candidates in REQUIRED_COMPONENTS.items()
    }
    novnc_web_root = _first_existing_path(NOVNC_WEB_ROOT_CANDIDATES, exists)
    checks = _backend_checks(system=system, components=components, novnc_web_root=novnc_web_root)
    status = "ready" if all(check["ok"] for check in checks) else "blocked"
    blocked_reasons = [check["reason"] for check in checks if not check["ok"]]
    manifest = {
        "schemaVersion": ISOLATED_DESKTOP_BACKEND_SCHEMA,
        "status": status,
        "category": "isolated-desktop-backend-ready" if status == "ready" else "isolated-desktop-backend-blocked",
        "backendKind": BACKEND_KIND,
        "reason": (
            "Linux noVNC desktop backend dependencies are present, but L1 smoke has not run."
            if status == "ready"
            else "; ".join(blocked_reasons)
        ),
        "blockedReasons": blocked_reasons,
        "manifestRef": str(manifest_ref),
        "platform": {"system": system, "machine": platform.machine()},
        "requiredComponents": {
            name: list(candidates)
            for name, candidates in REQUIRED_COMPONENTS.items()
        },
        "observedComponents": components,
        "noVncWebRootCandidates": list(NOVNC_WEB_ROOT_CANDIDATES),
        "noVncWebRoot": novnc_web_root,
        "preflightChecks": checks,
        "l1Smoke": {
            "required": [
                "start isolated Linux virtual display",
                "expose noVNC viewer for the thread session",
                "open a real GUI app such as LibreOffice or browser",
                "click a visible input field",
                "type text through isolated input",
                "click a visible button",
                "verify before/after screenshots, trace, input logs, and isolation flags",
            ],
            "status": "not-run",
            "completed": False,
            "realWindowEvidence": False,
        },
        "launchPlan": _launch_plan(components, novnc_web_root),
        "inputIsolation": {
            "required": REMOTE_DESKTOP_INPUT_CHANNEL,
            "sharedSystemInputAllowed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "claimLimit": "Readiness only; actual L1 smoke must produce result/trace/screenshot/input refs.",
        },
        "traceRefs": [],
        "artifactRefs": [],
        "screenshotRefs": [],
        "diagnosticOnly": True,
        "realWindowEvidence": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "projectClaimLimit": (
            "This manifest can justify a backend readiness or blocked state only. It does not complete "
            "PROJECT L1/L2/L3 until an actual isolated desktop run writes current screenshots, input logs, "
            "viewer refs, and verifier evidence."
        ),
        **NO_OS_INPUT_FLAGS,
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _backend_checks(
    *,
    system: str,
    components: Mapping[str, Mapping[str, Any]],
    novnc_web_root: str | None,
) -> list[dict[str, Any]]:
    checks = [
        _check(system == "Linux", "platform", "Isolated desktop backend MVP requires Linux."),
        _check(bool(novnc_web_root), "novnc-web-root", "noVNC web assets were not found."),
    ]
    for name in REQUIRED_COMPONENTS:
        checks.append(_check(
            bool(components[name].get("path")),
            name,
            f"Missing required backend component {name}: one of {', '.join(REQUIRED_COMPONENTS[name])}.",
        ))
    return checks


def _check(ok: bool, category: str, reason: str) -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": "" if ok else reason}


def _resolve_component(candidates: Sequence[str], resolver: Callable[[str], str | None]) -> dict[str, Any]:
    for command in candidates:
        resolved = resolver(command)
        if resolved:
            return {"status": "found", "command": command, "path": str(resolved), "candidates": list(candidates)}
    return {"status": "missing", "command": None, "path": None, "candidates": list(candidates)}


def _first_existing_path(candidates: Sequence[str], exists: Callable[[str], bool]) -> str | None:
    for candidate in candidates:
        if exists(candidate):
            return candidate
    return None


def _launch_plan(components: Mapping[str, Mapping[str, Any]], novnc_web_root: str | None) -> dict[str, Any]:
    return {
        "display": ":99",
        "commands": {
            "virtualDisplay": _path_or_placeholder(components, "virtualDisplay"),
            "windowManager": _path_or_placeholder(components, "windowManager"),
            "vncServer": _path_or_placeholder(components, "vncServer"),
            "noVncProxy": _path_or_placeholder(components, "noVncProxy"),
            "documentApp": _path_or_placeholder(components, "documentApp"),
            "browser": _path_or_placeholder(components, "browser"),
        },
        "noVncWebRoot": novnc_web_root,
        "status": "not-started",
        "noVncBackendStarted": False,
    }


def _path_or_placeholder(components: Mapping[str, Mapping[str, Any]], name: str) -> str | None:
    value = components.get(name, {})
    path = value.get("path")
    return str(path) if path else None


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


__all__ = [
    "BACKEND_KIND",
    "ISOLATED_DESKTOP_BACKEND_SCHEMA",
    "MANIFEST_NAME",
    "REQUIRED_COMPONENTS",
    "build_isolated_desktop_backend_manifest",
    "main",
]


if __name__ == "__main__":  # pragma: no cover - exercised by CLI tests.
    raise SystemExit(main())
