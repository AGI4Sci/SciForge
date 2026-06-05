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
    "financial-transaction",
    "external-communication",
    "external-form-submission",
    "remote-data-mutation",
    "external-upload",
    "account-security-privacy",
    "legal-compliance",
    "external-system-execution",
    "access-control-bypass",
    "identity-spoofing",
    "bulk-account-registration",
    "irreversible-bulk-delete",
    "unclear-sensitive-data-transfer",
    "third-party-high-risk-instruction",
]
ConfirmationMode = Literal["needs-confirmation", "hand-off-required", "blocked"]
ConfirmationTiming = Literal["action-time"]


HAND_OFF_REQUIRED_CATEGORIES: frozenset[ConfirmationCategory] = frozenset({
    "access-control-bypass",
    "identity-spoofing",
    "bulk-account-registration",
    "irreversible-bulk-delete",
    "unclear-sensitive-data-transfer",
    "third-party-high-risk-instruction",
})

_CATEGORY_PATTERNS: tuple[tuple[ConfirmationCategory, re.Pattern[str]], ...] = (
    (
        "third-party-high-risk-instruction",
        re.compile(
            r"\b(?:third[ -]?party|external|website|webpage|page|site|vendor)\b"
            r"[^.;\n]*\b(?:instruction|prompt|message|content|script|request|says|asks|tells)\b"
            r"[^.;\n]*\b(?:pay|purchase|buy|subscribe|refund|withdraw|trade|transfer|wire|"
            r"send|post|publish|submit|upload|delete|remove|overwrite|archive|close|deploy|"
            r"migrat(?:e|ion)|create cloud|grant|invite|sign|accept)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "access-control-bypass",
        re.compile(
            r"\b(?:bypass|circumvent|evade|defeat|work around|workaround|break through|"
            r"skip|avoid)\b[^.;\n]*\b(?:captcha|access[ -]?control|login risk|"
            r"security barrier|permission gate|auth(?:entication)? gate|rate limit)\b"
            r"|\b(?:captcha|access[ -]?control|login risk|security barrier|permission gate|"
            r"auth(?:entication)? gate|rate limit)\b[^.;\n]*\b(?:bypass|circumvent|evade|"
            r"defeat|work around|workaround|break through|skip|avoid)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "identity-spoofing",
        re.compile(
            r"\b(?:pretend|pose|masquerade|impersonate|spoof)\b[^.;\n]*\b(?:as|identity|user|"
            r"customer|owner|admin|employee|person)\b"
            r"|\b(?:use|borrow)\b[^.;\n]*\b(?:someone else's|another person's|another user'?s)\b"
            r"[^.;\n]*\b(?:identity|account|credentials)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "bulk-account-registration",
        re.compile(
            r"\b(?:bulk|mass|many|multiple|\d{2,}|hundreds?|thousands?)\b[^.;\n]*"
            r"\b(?:register|create|sign[ -]?up|open)\b[^.;\n]*\b(?:account|user|profile)s?\b"
            r"|\b(?:register|create|sign[ -]?up|open)\b[^.;\n]*"
            r"\b(?:bulk|mass|many|multiple|\d{2,}|hundreds?|thousands?)\b[^.;\n]*"
            r"\b(?:account|user|profile)s?\b",
            re.IGNORECASE,
        ),
    ),
    (
        "irreversible-bulk-delete",
        re.compile(
            r"\b(?:irreversible|irreversibly|permanent|permanently|cannot be undone)\b[^.;\n]*"
            r"\b(?:bulk|mass|all|many|multiple|\d{2,}|hundreds?|thousands?)\b[^.;\n]*"
            r"\b(?:delete|remove|erase|wipe|destroy|drop|truncate)\b"
            r"|\b(?:bulk|mass|all|many|multiple|\d{2,}|hundreds?|thousands?)\b[^.;\n]*"
            r"\b(?:delete|remove|erase|wipe|destroy|drop|truncate)\b[^.;\n]*"
            r"\b(?:irreversible|irreversibly|permanent|permanently|cannot be undone)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "unclear-sensitive-data-transfer",
        re.compile(
            r"\b(?:send|share|upload|export|paste|copy|transfer)\b[^.;\n]*"
            r"\b(?:secret|token|credential|password|api[ -]?key|private key|ssn|passport|"
            r"patient|phi|pii|personal data|sensitive data)\b[^.;\n]*"
            r"\b(?:unclear|unknown|unspecified|untrusted|arbitrary|wherever|whatever|"
            r"whichever|somewhere|destination|endpoint|recipient)\b"
            r"|\b(?:unclear|unknown|unspecified|untrusted|arbitrary|wherever|whatever|"
            r"whichever|somewhere)\b[^.;\n]*"
            r"\b(?:destination|endpoint|recipient)\b[^.;\n]*"
            r"\b(?:secret|token|credential|password|api[ -]?key|private key|ssn|passport|"
            r"patient|phi|pii|personal data|sensitive data)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "financial-transaction",
        re.compile(
            r"\b(?:pay|payment|purchase|buy|checkout|billing|invoice|charge|"
            r"authorize charge|transfer funds?|wire funds?|bank transfer|subscribe|subscription|"
            r"paid plan|refund|withdraw|withdrawal|trade|trading|stock order|crypto order)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "external-upload",
        re.compile(
            r"\b(?:upload|attach|submit file|send file|publish file)\b[^.;\n]*"
            r"\b(?:external|remote|cloud|service|portal|vendor|site|server|file|image|"
            r"dataset|credential|report|document|upload)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "external-communication",
        re.compile(
            r"\b(?:send|reply|post|publish)\b[^.;\n]*"
            r"\b(?:email|message|comment|reply|ticket|post|thread|chat|dm|sms|support)\b"
            r"|\b(?:email|message|comment|reply|ticket|post|thread|chat|dm|sms|support)\b"
            r"[^.;\n]*\b(?:send|reply|post|publish|submit)\b"
            r"|\bsubmit\b[^.;\n]*\b(?:support ticket|ticket reply|case reply)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "external-form-submission",
        re.compile(
            r"\b(?:submit|register|apply|book|reserve|schedule|enroll|sign[ -]?up)\b"
            r"[^.;\n]*\b(?:form|registration|application|appointment|booking|reservation|"
            r"enrollment|signup|sign[ -]?up|rsvp)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "remote-data-mutation",
        re.compile(
            r"\b(?:delete|remove|erase|wipe|destroy|drop|truncate|overwrite|replace|archive|close)\b"
            r"[^.;\n]*\b(?:remote|cloud|server|external|account|customer|project|record|"
            r"database|repo|repository|document|data)\b"
            r"|\b(?:remote|cloud|server|external|account|customer|project|record|database|"
            r"repo|repository|document|data)\b[^.;\n]*"
            r"\b(?:delete|remove|erase|wipe|destroy|drop|truncate|overwrite|replace|archive|close)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "account-security-privacy",
        re.compile(
            r"\b(?:change|update|modify|set|reset|rotate|revoke|create|delete|invite|add|"
            r"remove|grant|allow|approve|authorize)\b[^.;\n]*"
            r"\b(?:account|security|privacy|billing|api[ -]?key|token|team(?: member)?|"
            r"permission|role|access|password|mfa|2fa|passkey|oauth|secret)\b"
            r"|\b(?:api[ -]?key|token|team(?: member)?|permission|role|access|password|mfa|"
            r"2fa|passkey|oauth|secret)\b[^.;\n]*"
            r"\b(?:change|update|modify|set|reset|rotate|revoke|create|delete|invite|add|"
            r"remove|grant|allow|approve|authorize)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "legal-compliance",
        re.compile(
            r"\b(?:accept|agree|sign|approve|authorize|execute)\b[^.;\n]*"
            r"\b(?:legal|compliance|contract|terms|terms of service|agreement|authorization|"
            r"consent|waiver|signature)\b"
            r"|\b(?:legal|compliance|contract|terms|terms of service|agreement|authorization|"
            r"consent|waiver|signature)\b[^.;\n]*"
            r"\b(?:accept|agree|sign|approve|authorize|execute)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "external-system-execution",
        re.compile(
            r"\b(?:deploy|release|rollback|provision|migrate|run migration|database migration|"
            r"db migration|create cloud|create .*cloud|create .*resource|ci/cd|cicd)\b"
            r"|\b(?:run|execute|start|trigger)\b[^.;\n]*"
            r"\b(?:deploy|deployment|migration|pipeline|ci/cd|cicd|cloud resource|"
            r"database migration|db migration)\b",
            re.IGNORECASE,
        ),
    ),
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
    blocked: bool = False

    def as_metadata(self) -> dict[str, Any]:
        return {
            "confirmationCategory": self.category,
            "confirmationMode": self.mode,
            "confirmationTiming": self.timing,
            "requiresConfirmation": self.requires_confirmation,
            "handoffRequired": self.handoff_required,
            "blocked": self.blocked,
        }


def classify_action_plan_for_confirmation(action: ActionPlan) -> ConfirmationDecision | None:
    """Classify a planned action into the Codex-style confirmation taxonomy."""

    text = _policy_text_for_action(action)
    if not text:
        return None
    for category, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text):
            return _decision_for_category(category)
    return None


def classify_mapping_for_confirmation(payload: Mapping[str, Any]) -> ConfirmationDecision | None:
    """Classify a native-tool or manifest-style action payload."""

    text = _strip_negated_clauses(" ".join(str(part) for part in _mapping_parts(payload) if part))
    for category, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text):
            return _decision_for_category(category)
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
    if mode and mode not in {"needs-confirmation", "hand-off-required", "blocked"}:
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


def _decision_for_category(category: ConfirmationCategory) -> ConfirmationDecision:
    blocked = category in HAND_OFF_REQUIRED_CATEGORIES
    mode: ConfirmationMode = "blocked" if blocked else "needs-confirmation"
    return ConfirmationDecision(
        category=category,
        mode=mode,
        timing="action-time",
        requires_confirmation=not blocked,
        handoff_required=blocked,
        reason=_reason_for_category(category, mode),
        blocked=blocked,
    )


def _reason_for_category(category: ConfirmationCategory, mode: ConfirmationMode) -> str:
    if mode == "blocked":
        return f"{category} Computer Use action is blocked by default and is not confirmable."
    if mode == "hand-off-required":
        return f"{category} Computer Use action requires user hand-off at action time."
    return f"{category} Computer Use action requires explicit action-time confirmation."


def _has_ref(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(_has_ref(entry) for entry in value)
    return False
