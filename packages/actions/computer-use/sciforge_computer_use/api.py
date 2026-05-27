"""Public shims for the Computer Use action provider API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from .loop import run_task
from .repair_manifest import validate_repair_manifest
from .trace import (
    build_repair_replay_evidence,
    build_target_bound_real_window_probe_evidence,
    build_viewport_recovery_evidence,
    compact_result,
    validate_repair_replay_evidence,
    validate_target_bound_real_window_probe_evidence,
    validate_trace,
    validate_viewport_recovery_evidence,
)
from .virtual_input_adapter import (
    build_target_bound_input_adapter_manifest,
    validate_input_adapter_manifest_for_real_desktop,
)


def get_manifest() -> dict[str, Any]:
    """Return the bundled action-provider manifest."""

    manifest_path = Path(__file__).resolve().parents[1] / "action-provider.manifest.json"
    parsed = json.loads(manifest_path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Computer Use manifest root must be a JSON object.")
    return dict(parsed)


getManifest = get_manifest
runTask = run_task
validateTrace = validate_trace
compactResult = compact_result
buildRepairReplayEvidence = build_repair_replay_evidence
validateRepairReplayEvidence = validate_repair_replay_evidence
buildViewportRecoveryEvidence = build_viewport_recovery_evidence
validateViewportRecoveryEvidence = validate_viewport_recovery_evidence
buildTargetBoundRealWindowProbeEvidence = build_target_bound_real_window_probe_evidence
validateTargetBoundRealWindowProbeEvidence = validate_target_bound_real_window_probe_evidence
buildTargetBoundInputAdapterManifest = build_target_bound_input_adapter_manifest
validateInputAdapterManifestForRealDesktop = validate_input_adapter_manifest_for_real_desktop
validateRepairManifest = validate_repair_manifest


__all__ = [
    "build_repair_replay_evidence",
    "buildRepairReplayEvidence",
    "build_viewport_recovery_evidence",
    "buildViewportRecoveryEvidence",
    "build_target_bound_real_window_probe_evidence",
    "buildTargetBoundRealWindowProbeEvidence",
    "build_target_bound_input_adapter_manifest",
    "buildTargetBoundInputAdapterManifest",
    "compact_result",
    "compactResult",
    "get_manifest",
    "getManifest",
    "runTask",
    "run_task",
    "validate_repair_replay_evidence",
    "validateRepairReplayEvidence",
    "validate_trace",
    "validateTrace",
    "validate_viewport_recovery_evidence",
    "validateViewportRecoveryEvidence",
    "validate_target_bound_real_window_probe_evidence",
    "validateTargetBoundRealWindowProbeEvidence",
    "validate_input_adapter_manifest_for_real_desktop",
    "validateInputAdapterManifestForRealDesktop",
    "validate_repair_manifest",
    "validateRepairManifest",
]
