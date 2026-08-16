"""The single isolation contract supported by the CDP-only runtime."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class IsolationLevel(str, Enum):
    HOST_APP_SCOPED = "host-app-scoped"


class RequestedIsolation(str, Enum):
    HOST_APP_SCOPED = IsolationLevel.HOST_APP_SCOPED.value


class IsolationUnavailable(ValueError):
    """Raised when an effective backend cannot satisfy the requested isolation."""

    code = "ISOLATION_UNAVAILABLE"


@dataclass(frozen=True)
class IsolationDecision:
    requested: RequestedIsolation
    effective: IsolationLevel
    degraded: bool
    degraded_reason: str | None = None


def parse_requested_isolation(value: object, *, default: str = "host-app-scoped") -> RequestedIsolation:
    raw = default if value is None else value
    if not isinstance(raw, str):
        raise ValueError("requestedIsolation must be a string")
    try:
        return RequestedIsolation(raw)
    except ValueError as exc:
        allowed = ", ".join(item.value for item in RequestedIsolation)
        raise ValueError(f"requestedIsolation must be one of: {allowed}") from exc


def isolation_satisfies(effective: IsolationLevel, requested: RequestedIsolation) -> bool:
    return effective.value == requested.value


def decide_isolation(
    requested: RequestedIsolation,
    effective: IsolationLevel,
    *,
    allow_degraded: bool,
    approval_context: bool = False,
) -> IsolationDecision:
    """Return the exact CDP isolation decision; degradation is never allowed."""
    if isolation_satisfies(effective, requested):
        return IsolationDecision(requested=requested, effective=effective, degraded=False)
    raise IsolationUnavailable(
        f"requested isolation {requested.value} is unavailable; "
        f"effective isolation would be {effective.value}"
    )
