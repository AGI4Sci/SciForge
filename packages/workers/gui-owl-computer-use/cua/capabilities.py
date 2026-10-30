"""Backend capability truth model shared by routing and status surfaces."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from .isolation import IsolationLevel
from .session_registry import LeaseScope
from .target import TargetKind


class BackendId(str, Enum):
    BROWSER_CDP = "browser-cdp"


class Verification(str, Enum):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    FAILED = "failed"
    NOT_APPLICABLE = "not-applicable"


class BackgroundInput(str, Enum):
    SEMANTIC = "semantic"
    TARGETED = "targeted"
    NONE = "none"


@dataclass(frozen=True)
class BackendCapabilities:
    backend: BackendId
    available: bool
    target_kinds: tuple[TargetKind, ...]
    actions: tuple[str, ...]
    effective_isolation: IsolationLevel
    background_input: BackgroundInput
    requires_host_focus: bool
    affects_user_input: bool
    uses_host_clipboard: bool
    supports_readback: tuple[str, ...]
    lease_scope: LeaseScope
    max_concurrency: int
    reason: str | None = None
    may_activate_target: bool = False
    instance_id: str | None = None
    generation: str | None = None

    def __post_init__(self) -> None:
        if self.max_concurrency < 0:
            raise ValueError("max_concurrency cannot be negative")
        if self.available and self.max_concurrency == 0:
            raise ValueError("an available backend must allow at least one request")
        if not self.available and not self.reason:
            raise ValueError("an unavailable backend must provide a reason")

    def to_dict(self) -> dict[str, Any]:
        return {
            "backend": self.backend.value,
            "available": self.available,
            "targetKinds": [kind.value for kind in self.target_kinds],
            "actions": list(self.actions),
            "effectiveIsolation": self.effective_isolation.value,
            "backgroundInput": self.background_input.value,
            "requiresHostFocus": self.requires_host_focus,
            "affectsUserInput": self.affects_user_input,
            "usesHostClipboard": self.uses_host_clipboard,
            "supportsReadback": list(self.supports_readback),
            "leaseScope": self.lease_scope.value,
            "maxConcurrency": self.max_concurrency,
            "reason": self.reason,
            "mayActivateTarget": self.may_activate_target,
            "instanceId": self.instance_id,
            "generation": self.generation,
        }
