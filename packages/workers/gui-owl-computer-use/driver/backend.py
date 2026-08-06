"""Backend contracts for target-bound Computer Use execution.

Backends own concrete target handles and side effects.  They never mutate the
session registry directly; the channel is the lifecycle authority between a
backend and the runner.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, runtime_checkable

from PIL import Image

from cua.capabilities import BackendCapabilities, Verification
from cua.target import TargetDescriptor


@dataclass(frozen=True)
class BackendOpenContext:
    request_id: str
    execute: bool
    settle_s: float
    show_overlay: bool
    cancellation: threading.Event
    screenshot_provider: Any | None = field(default=None, repr=False)


@dataclass(frozen=True)
class Observation:
    target_id: str
    revision: str
    image: Image.Image = field(repr=False)
    backend: str = ""
    captured_at: float = field(default_factory=time.time)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionReceipt:
    action_id: str
    target_id: str
    revision_before: str
    committed: bool
    may_have_taken_effect: bool
    backend_evidence: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class VerificationEvidence:
    status: Verification
    target_id: str
    revision_after: str | None = None
    details: Mapping[str, Any] = field(default_factory=dict)


class BackendOperationError(RuntimeError):
    """A backend failure with an explicit side-effect boundary."""

    def __init__(
        self,
        message: str,
        *,
        may_have_taken_effect: bool = False,
        code: str | None = None,
    ):
        super().__init__(message)
        self.may_have_taken_effect = may_have_taken_effect
        self.code = code


@runtime_checkable
class InputBackend(Protocol):
    def probe(self) -> BackendCapabilities: ...

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]: ...

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> object: ...

    def observe(self, handle: object) -> Observation: ...

    def perform(
        self,
        handle: object,
        action: Mapping[str, Any],
        expected_revision: str,
    ) -> ActionReceipt: ...

    def verify(
        self,
        handle: object,
        action: Mapping[str, Any],
        receipt: ActionReceipt,
        before: Observation,
    ) -> VerificationEvidence: ...

    def cancel(self, handle: object, reason: str) -> None: ...

    def close(self, handle: object, reason: str) -> None: ...
