"""Generic Computer Use safety policy."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .contracts import ActionPlan, RiskLevel


_HIGH_RISK_RE = re.compile(
    r"\b(send|submit|delete|remove|erase|pay|purchase|buy|authorize|login|"
    r"publish|post|upload|overwrite|replace|share|grant|approve|confirm)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RiskAssessment:
    level: RiskLevel
    blocked: bool
    needs_confirmation: bool
    reason: str


def assess_action_risk(action: ActionPlan, *, fail_closed: bool = True) -> RiskAssessment:
    """Classify a generic GUI action before execution."""

    text = " ".join(
        str(part)
        for part in [
            action.kind or "",
            action.reason,
            action.text or "",
            action.key or "",
            action.app_name or "",
            action.target.description if action.target else "",
            action.target.region_description if action.target else "",
            " ".join(action.keys),
        ]
        if part
    )
    explicit_high = action.risk_level == "high" or action.requires_confirmation
    inferred_high = bool(_HIGH_RISK_RE.search(text))
    if explicit_high or inferred_high:
        return RiskAssessment(
            level="high",
            blocked=fail_closed,
            needs_confirmation=True,
            reason="High-risk Computer Use action requires explicit upstream confirmation.",
        )
    if action.kind in {"hotkey", "drag"}:
        return RiskAssessment(
            level="medium",
            blocked=False,
            needs_confirmation=False,
            reason="Medium-risk generic GUI action allowed under current policy.",
        )
    return RiskAssessment(
        level="low",
        blocked=False,
        needs_confirmation=False,
        reason="Low-risk generic GUI action.",
    )

