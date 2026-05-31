"""Action-time confirmation taxonomy for Computer Use.

The policy is intentionally package-local and side-effect free. It maps risky
GUI intents to the boundary shape that the TUI host can turn into refs-first
approval requests, while keeping login/payment/credential hand-off decisions
out of the Computer Use executor.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from .contracts import ActionPlan


ConfirmationCategory = Literal[
    "destructive-delete",
    "upload",
    "external-message",
    "login",
    "permission",
    "payment",
    "install-software",
    "sensitive-data-transfer",
    "system-settings",
]
ConfirmationMode = Literal["needs-confirmation", "hand-off-required"]
ConfirmationTiming = Literal["action-time"]


HAND_OFF_REQUIRED_CATEGORIES: frozenset[ConfirmationCategory] = frozenset({
    "login",
    "payment",
    "install-software",
    "sensitive-data-transfer",
})

_CATEGORY_PATTERNS: tuple[tuple[ConfirmationCategory, re.Pattern[str]], ...] = (
    ("payment", re.compile(r"\b(pay|payment|purchase|buy|checkout|billing|invoice|authorize charge)\b", re.IGNORECASE)),
    ("login", re.compile(r"\b(log[ -]?in|sign[ -]?in|authenticate|enter password|credential|2fa|mfa|passkey)\b", re.IGNORECASE)),
    ("install-software", re.compile(r"\b(install|update|upgrade|uninstall).*\b(app|software|package|extension|plugin)\b", re.IGNORECASE)),
    ("sensitive-data-transfer", re.compile(r"\b(send|share|upload|export|paste|copy).*\b(secret|token|credential|password|api[ -]?key|private key|ssn|passport|patient|phi|pii)\b", re.IGNORECASE)),
    ("destructive-delete", re.compile(r"\b(delete|remove|erase|discard|wipe|destroy|drop|truncate|overwrite|replace)\b", re.IGNORECASE)),
    ("upload", re.compile(r"\b(upload|attach|submit file|send file|publish file)\b", re.IGNORECASE)),
    ("external-message", re.compile(r"\b(?:send|submit|post|publish|reply)\b|\b(?:comment|message|email)\b.*\b(?:send|submit|post|publish|reply)\b|\b(?:send|submit|post|publish|reply)\b.*\b(?:comment|message|email)\b", re.IGNORECASE)),
    ("permission", re.compile(r"\b(grant|allow|approve|authorize|permission|access|share screen|screen recording|accessibility)\b", re.IGNORECASE)),
    ("system-settings", re.compile(r"\b(system settings|preferences|firewall|vpn|network settings|security settings|privacy settings|default browser)\b", re.IGNORECASE)),
)

_NEGATED_CLAUSE_RE = re.compile(
    r"\b(?:excluding|except|avoid|do not|don't|not|without)\b[^.;\n]*",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ConfirmationDecision:
    category: ConfirmationCategory
    mode: ConfirmationMode
    timing: ConfirmationTiming
    requires_confirmation: bool
    handoff_required: bool
    reason: str

    def as_metadata(self) -> dict[str, Any]:
        return {
            "confirmationCategory": self.category,
            "confirmationMode": self.mode,
            "confirmationTiming": self.timing,
            "requiresConfirmation": self.requires_confirmation,
            "handoffRequired": self.handoff_required,
        }


def classify_action_plan_for_confirmation(action: ActionPlan) -> ConfirmationDecision | None:
    """Classify a planned action into the Codex-style confirmation taxonomy."""

    text = _policy_text_for_action(action)
    if not text:
        return None
    for category, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text):
            handoff_required = category in HAND_OFF_REQUIRED_CATEGORIES
            mode: ConfirmationMode = "hand-off-required" if handoff_required else "needs-confirmation"
            return ConfirmationDecision(
                category=category,
                mode=mode,
                timing="action-time",
                requires_confirmation=True,
                handoff_required=handoff_required,
                reason=_reason_for_category(category, mode),
            )
    return None


def classify_mapping_for_confirmation(payload: Mapping[str, Any]) -> ConfirmationDecision | None:
    """Classify a native-tool or manifest-style action payload."""

    text = _strip_negated_clauses(" ".join(str(part) for part in _mapping_parts(payload) if part))
    for category, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text):
            handoff_required = category in HAND_OFF_REQUIRED_CATEGORIES
            mode: ConfirmationMode = "hand-off-required" if handoff_required else "needs-confirmation"
            return ConfirmationDecision(
                category=category,
                mode=mode,
                timing="action-time",
                requires_confirmation=True,
                handoff_required=handoff_required,
                reason=_reason_for_category(category, mode),
            )
    return None


def validate_confirmation_boundary(record: Mapping[str, Any]) -> dict[str, Any]:
    """Validate that a high-risk boundary stays at action-time confirmation."""

    category = str(record.get("confirmationCategory") or record.get("category") or "")
    mode = str(record.get("confirmationMode") or record.get("mode") or "")
    timing = str(record.get("confirmationTiming") or record.get("timing") or "")
    refs = [
        record.get("approvalRequestRef"),
        record.get("approvalRequestRefs"),
        record.get("draftRef"),
        record.get("auditRef"),
        record.get("handoffRef"),
    ]
    has_ref = any(_has_ref(value) for value in refs)
    issues: list[dict[str, Any]] = []

    if category and category not in {category for category, _pattern in _CATEGORY_PATTERNS}:
        issues.append({"id": "unknown-confirmation-category", "path": "confirmationCategory"})
    if mode and mode not in {"needs-confirmation", "hand-off-required"}:
        issues.append({"id": "invalid-confirmation-mode", "path": "confirmationMode"})
    if timing != "action-time":
        issues.append({
            "id": "invalid-confirmation-timing",
            "path": "confirmationTiming",
            "reason": "Computer Use confirmation must be bound to the action-time proposal, not session pre-approval.",
        })
    if not has_ref:
        issues.append({
            "id": "missing-confirmation-ref",
            "reason": "A confirmation boundary must carry approvalRequestRef, draftRef, auditRef, or handoffRef.",
        })
    if mode == "hand-off-required" and not _has_ref(record.get("handoffRef")):
        issues.append({
            "id": "missing-handoff-ref",
            "path": "handoffRef",
            "reason": "Hand-off required actions must carry a dedicated handoffRef.",
        })
    return {
        "ok": not issues,
        "schemaVersion": "sciforge.computer-use.confirmation-boundary-validation.v1",
        "issues": issues,
    }


def _policy_text_for_action(action: ActionPlan) -> str:
    parts = [
        action.kind or "",
        action.reason,
        action.key or "",
        action.app_name or "",
        action.target.description if action.target else "",
        action.target.region_description if action.target else "",
        " ".join(action.keys),
    ]
    if action.kind not in {"type_text", "click", "double_click", "drag", "scroll"}:
        parts.append(action.text or "")
    metadata = action.metadata
    for key in ("confirmationText", "riskCategory", "riskReason", "actionIntent", "targetDescription"):
        value = metadata.get(key)
        if isinstance(value, str):
            parts.append(value)
    return _strip_negated_clauses(" ".join(str(part) for part in parts if part))


def _mapping_parts(payload: Mapping[str, Any]) -> list[str]:
    parts: list[str] = []
    for key in ("kind", "actionKind", "type", "description", "targetDescription", "confirmationText", "riskCategory", "riskReason"):
        value = payload.get(key)
        if isinstance(value, str):
            parts.append(value)
    for key in ("action", "target", "metadata"):
        nested = payload.get(key)
        if isinstance(nested, Mapping):
            parts.extend(_mapping_parts(nested))
    return parts


def _strip_negated_clauses(text: str) -> str:
    return _NEGATED_CLAUSE_RE.sub(" ", text)


def _reason_for_category(category: ConfirmationCategory, mode: ConfirmationMode) -> str:
    if mode == "hand-off-required":
        return f"{category} Computer Use action requires user hand-off at action time."
    return f"{category} Computer Use action requires explicit action-time confirmation."


def _has_ref(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(_has_ref(entry) for entry in value)
    return False
