"""Isolation vocabulary and routing decisions for Computer Use protocol v2.

This module is deliberately independent from concrete backends.  P1 freezes the
contract; P2 will use the same helpers from the backend router.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class IsolationLevel(str, Enum):
    AGENT_ISOLATED = "agent-isolated"
    HOST_APP_SCOPED = "host-app-scoped"
    HOST_GLOBAL = "host-global"
    HOST_APPROVED = "host-approved"


class RequestedIsolation(str, Enum):
    AUTO = "auto"
    AGENT_ISOLATED = IsolationLevel.AGENT_ISOLATED.value
    HOST_APP_SCOPED = IsolationLevel.HOST_APP_SCOPED.value
    HOST_GLOBAL = IsolationLevel.HOST_GLOBAL.value
    HOST_APPROVED = IsolationLevel.HOST_APPROVED.value


_STRENGTH = {
    IsolationLevel.HOST_APPROVED: 0,
    IsolationLevel.HOST_GLOBAL: 1,
    IsolationLevel.HOST_APP_SCOPED: 2,
    IsolationLevel.AGENT_ISOLATED: 3,
}


class IsolationUnavailable(ValueError):
    """Raised when an effective backend cannot satisfy the requested isolation."""

    code = "ISOLATION_UNAVAILABLE"


class ApprovalRequired(ValueError):
    code = "NEEDS_APPROVAL"


@dataclass(frozen=True)
class IsolationDecision:
    requested: RequestedIsolation
    effective: IsolationLevel
    degraded: bool
    degraded_reason: str | None = None


def parse_requested_isolation(value: object, *, default: str = "auto") -> RequestedIsolation:
    raw = default if value is None else value
    if not isinstance(raw, str):
        raise ValueError("requestedIsolation must be a string")
    try:
        return RequestedIsolation(raw)
    except ValueError as exc:
        allowed = ", ".join(item.value for item in RequestedIsolation)
        raise ValueError(f"requestedIsolation must be one of: {allowed}") from exc


def isolation_satisfies(effective: IsolationLevel, requested: RequestedIsolation) -> bool:
    if requested is RequestedIsolation.AUTO:
        return True
    return _STRENGTH[effective] >= _STRENGTH[IsolationLevel(requested.value)]


def decide_isolation(
    requested: RequestedIsolation,
    effective: IsolationLevel,
    *,
    allow_degraded: bool,
    approval_context: bool = False,
) -> IsolationDecision:
    """Return an explicit decision; never silently weaken an explicit request.

    ``auto`` accepts the router's strongest available backend.  Falling all the
    way to the compatibility-only host-approved backend is still surfaced as a
    degradation so callers cannot mistake it for target isolation.
    """
    if effective is IsolationLevel.HOST_APPROVED and not approval_context:
        raise ApprovalRequired("host-approved isolation requires trusted approval context")
    if requested is RequestedIsolation.AUTO:
        degraded = effective is IsolationLevel.HOST_APPROVED
        return IsolationDecision(
            requested=requested,
            effective=effective,
            degraded=degraded,
            degraded_reason="AUTO_SELECTED_HOST_APPROVED" if degraded else None,
        )
    if isolation_satisfies(effective, requested):
        return IsolationDecision(requested=requested, effective=effective, degraded=False)
    if not allow_degraded:
        raise IsolationUnavailable(
            f"requested isolation {requested.value} is unavailable; "
            f"effective isolation would be {effective.value}"
        )
    return IsolationDecision(
        requested=requested,
        effective=effective,
        degraded=True,
        degraded_reason=(
            f"REQUESTED_{requested.value.upper().replace('-', '_')}_UNAVAILABLE"
        ),
    )
