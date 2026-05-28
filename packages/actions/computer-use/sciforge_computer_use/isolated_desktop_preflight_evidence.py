"""Shared semantic validation for isolated desktop backend preflight payloads."""

from __future__ import annotations

from typing import Any, Mapping

from .isolated_desktop_contracts import (
    BACKEND_KIND,
    ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION,
)
from .trace import (
    _list_of_mappings,
    _mapping,
    _repair_replay_error,
    _string_or_none,
)

REQUIRED_BACKEND_COMPONENTS = (
    "virtualDisplay",
    "windowManager",
    "vncServer",
    "noVncProxy",
    "documentApp",
    "browser",
)


def validate_isolated_desktop_backend_preflight_payload(
    preflight: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    tier_label: str,
    allow_diagnostic_only: bool,
    require_acceptance_eligible: bool,
    expected_backend_kind: str = BACKEND_KIND,
) -> None:
    if preflight.get("schemaVersion") != ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "preflight_schema_invalid",
            f"{tier_label} preflightRef must resolve to an isolated desktop backend preflight manifest.",
            "$.preflightRef.schemaVersion",
            expected=ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION,
            actual=preflight.get("schemaVersion"),
        ))
    if preflight.get("status") != "ready":
        errors.append(_repair_replay_error(
            "preflight_not_ready",
            f"{tier_label} preflightRef must report status=ready.",
            "$.preflightRef.status",
            expected="ready",
            actual=preflight.get("status"),
        ))
    if preflight.get("backendKind") != expected_backend_kind:
        errors.append(_repair_replay_error(
            "preflight_backend_kind_mismatch",
            f"{tier_label} preflightRef backendKind must match the real Linux noVNC backend.",
            "$.preflightRef.backendKind",
            expected=expected_backend_kind,
            actual=preflight.get("backendKind"),
        ))
    platform_system = _platform_system(preflight)
    if platform_system != "Linux":
        errors.append(_repair_replay_error(
            "preflight_platform_not_linux",
            f"{tier_label} preflightRef must be for a Linux isolated desktop backend.",
            "$.preflightRef.platform.system",
            expected="Linux",
            actual=platform_system,
        ))
    if preflight.get("diagnosticOnly") is True and not allow_diagnostic_only:
        errors.append(_repair_replay_error(
            "preflight_diagnostic_only",
            f"{tier_label} preflightRef cannot be diagnostic-only evidence.",
            "$.preflightRef.diagnosticOnly",
            expected=False,
            actual=True,
        ))
    if preflight.get("userAcceptanceEligible") is False and require_acceptance_eligible:
        errors.append(_repair_replay_error(
            "preflight_not_acceptance_eligible",
            f"{tier_label} preflightRef cannot be a user-acceptance-ineligible probe.",
            "$.preflightRef.userAcceptanceEligible",
            expected="not false",
            actual=False,
        ))
    if preflight.get("readinessOnly") is True:
        errors.append(_repair_replay_error(
            "preflight_readiness_only",
            f"{tier_label} preflightRef cannot be a readiness-only probe.",
            "$.preflightRef.readinessOnly",
            expected=False,
            actual=True,
        ))
    if preflight.get("executeFailClosed") is True:
        errors.append(_repair_replay_error(
            "preflight_fail_closed",
            f"{tier_label} preflightRef cannot be a fail-closed execution probe.",
            "$.preflightRef.executeFailClosed",
            expected=False,
            actual=True,
        ))

    observed_components = _mapping(preflight.get("observedComponents"))
    missing_components: list[str] = []
    not_ready_components: dict[str, Any] = {}
    for name in REQUIRED_BACKEND_COMPONENTS:
        value = observed_components.get(name)
        if value is None:
            missing_components.append(name)
        elif not _observed_component_ready_or_path(value):
            not_ready_components[name] = value
    if missing_components:
        errors.append(_repair_replay_error(
            "preflight_observed_components_missing",
            f"{tier_label} preflightRef must include observed backend components for the isolated desktop.",
            "$.preflightRef.observedComponents",
            expected=sorted(REQUIRED_BACKEND_COMPONENTS),
            actual=missing_components,
        ))
    if not_ready_components:
        errors.append(_repair_replay_error(
            "preflight_observed_components_not_ready",
            f"{tier_label} preflightRef observed backend components must be ready or include resolved paths.",
            "$.preflightRef.observedComponents",
            actual=not_ready_components,
        ))
    if not _string_or_none(preflight.get("noVncWebRoot")):
        errors.append(_repair_replay_error(
            "preflight_novnc_web_root_missing",
            f"{tier_label} preflightRef must include a resolved noVNC web root.",
            "$.preflightRef.noVncWebRoot",
        ))

    failed_checks = [
        check
        for check in _list_of_mappings(preflight.get("preflightChecks"))
        if check.get("ok") is not True
    ]
    if failed_checks:
        errors.append(_repair_replay_error(
            "preflight_checks_not_ok",
            f"{tier_label} preflightRef cannot carry failed backend preflight checks.",
            "$.preflightRef.preflightChecks",
            actual=failed_checks,
        ))


def _platform_system(payload: Mapping[str, Any]) -> str | None:
    platform_value = payload.get("platform")
    if isinstance(platform_value, Mapping):
        return _string_or_none(platform_value.get("system"))
    direct = _string_or_none(platform_value)
    if direct:
        return direct
    for key in ("platformSystem", "os", "system"):
        value = _string_or_none(payload.get(key))
        if value:
            return value
    return None


def _observed_component_ready_or_path(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    component = _mapping(value)
    if not component:
        return False
    if component.get("ready") is True or component.get("ok") is True:
        return True
    if _string_or_none(component.get("path")) or _string_or_none(component.get("resolvedPath")):
        return True
    status = (_string_or_none(component.get("status")) or "").replace("_", "-").lower()
    return status in {"available", "found", "ok", "present", "ready", "running"}


__all__ = [
    "REQUIRED_BACKEND_COMPONENTS",
    "validate_isolated_desktop_backend_preflight_payload",
]
