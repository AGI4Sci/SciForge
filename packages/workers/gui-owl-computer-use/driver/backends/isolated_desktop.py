"""Isolated desktop provider SPI and backend adapter.

This module deliberately does not treat a Win32 desktop object as an isolated
input environment. A real provider must own an independent login/VM/RDP-style
environment and prove its availability.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    BackendOperationError,
    Observation,
    VerificationEvidence,
)


ISOLATED_DESKTOP_UNAVAILABLE = "ISOLATED_DESKTOP_UNAVAILABLE"
_ACTIONS = (
    "observe", "click", "left_click", "right_click", "double_click",
    "type", "key", "hotkey", "scroll", "wait",
)


@dataclass(frozen=True)
class IsolatedProviderStatus:
    available: bool
    reason: str | None = None
    max_concurrency: int = 0

    def __post_init__(self) -> None:
        if self.available and self.max_concurrency <= 0:
            raise ValueError("an available isolated provider must allow concurrency")
        if not self.available and not self.reason:
            raise ValueError("an unavailable isolated provider must provide a reason")


class IsolatedDesktopProvider(Protocol):
    """Infrastructure-owned implementation of an independent desktop."""

    def probe(self) -> IsolatedProviderStatus: ...

    def discover_environments(
        self, filters: Mapping[str, Any] | None = None,
    ) -> list[TargetDescriptor]: ...

    def provision(self, spec: Mapping[str, Any]) -> TargetDescriptor: ...

    def connect(self, target: TargetDescriptor, context: BackendOpenContext) -> object: ...

    def observe(self, handle: object) -> Observation: ...

    def perform(
        self, handle: object, action: Mapping[str, Any], expected_revision: str,
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

    def destroy(self, target: TargetDescriptor, reason: str) -> None: ...


class UnavailableIsolatedDesktopProvider:
    """Safe default: no external isolation infrastructure is configured."""

    def probe(self) -> IsolatedProviderStatus:
        return IsolatedProviderStatus(
            available=False,
            reason=f"{ISOLATED_DESKTOP_UNAVAILABLE}: no isolated desktop provider is configured",
        )

    def discover_environments(
        self, filters: Mapping[str, Any] | None = None,
    ) -> list[TargetDescriptor]:
        return []

    def provision(self, spec: Mapping[str, Any]) -> TargetDescriptor:
        raise BackendOperationError(
            "no isolated desktop provider is configured",
            code=ISOLATED_DESKTOP_UNAVAILABLE,
        )

    def connect(self, target: TargetDescriptor, context: BackendOpenContext) -> object:
        raise BackendOperationError(
            "no isolated desktop provider is configured",
            code=ISOLATED_DESKTOP_UNAVAILABLE,
        )

    def observe(self, handle: object) -> Observation:
        raise BackendOperationError("isolated desktop unavailable", code=ISOLATED_DESKTOP_UNAVAILABLE)

    def perform(self, handle: object, action: Mapping[str, Any], expected_revision: str) -> ActionReceipt:
        raise BackendOperationError("isolated desktop unavailable", code=ISOLATED_DESKTOP_UNAVAILABLE)

    def verify(self, handle: object, action, receipt, before) -> VerificationEvidence:
        raise BackendOperationError("isolated desktop unavailable", code=ISOLATED_DESKTOP_UNAVAILABLE)

    def cancel(self, handle: object, reason: str) -> None:
        return None

    def close(self, handle: object, reason: str) -> None:
        return None

    def destroy(self, target: TargetDescriptor, reason: str) -> None:
        return None


@dataclass
class IsolatedDesktopHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    provider_handle: object
    disconnected: bool = False
    destroyed: bool = False
    closed: bool = False
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class IsolatedDesktopBackend:
    """Adapt one configured provider to the common target-bound backend API."""

    def __init__(self, provider: IsolatedDesktopProvider | None = None) -> None:
        self.provider = provider or UnavailableIsolatedDesktopProvider()

    def probe(self) -> BackendCapabilities:
        try:
            status = self.provider.probe()
        except Exception as error:  # probes must not take down other backends
            status = IsolatedProviderStatus(
                available=False,
                reason=f"{ISOLATED_DESKTOP_UNAVAILABLE}: provider probe failed: {error}",
            )
        return BackendCapabilities(
            backend=BackendId.ISOLATED_DESKTOP,
            available=status.available,
            target_kinds=(TargetKind.ISOLATED_DESKTOP,),
            actions=_ACTIONS,
            effective_isolation=IsolationLevel.AGENT_ISOLATED,
            background_input=BackgroundInput.TARGETED,
            requires_host_focus=False,
            affects_user_input=False,
            uses_host_clipboard=False,
            supports_readback=("type", "key", "hotkey", "scroll"),
            lease_scope=LeaseScope.ENVIRONMENT,
            max_concurrency=status.max_concurrency if status.available else 0,
            reason=status.reason,
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        if not self.probe().available:
            return []
        targets = self.provider.discover_environments(filters)
        if any(target.kind is not TargetKind.ISOLATED_DESKTOP for target in targets):
            raise RuntimeError("isolated provider returned a non-isolated target")
        return targets

    def provision(self, spec: Mapping[str, Any]) -> TargetDescriptor:
        self._require_available()
        target = self.provider.provision(spec)
        if target.kind is not TargetKind.ISOLATED_DESKTOP:
            raise RuntimeError("isolated provider provisioned a non-isolated target")
        if target.ownership is not TargetOwnership.MANAGED:
            raise RuntimeError("provisioned isolated targets must be managed")
        return target

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> IsolatedDesktopHandle:
        if target.kind is not TargetKind.ISOLATED_DESKTOP:
            raise BackendOperationError("isolated backend only accepts isolated-desktop targets")
        self._require_available()
        return IsolatedDesktopHandle(target, context, self.provider.connect(target, context))

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        with h.lock:
            observation = self.provider.observe(h.provider_handle)
        if observation.target_id != h.target.target_id:
            raise BackendOperationError("isolated provider observed a different target", code="TARGET_LOST")
        return observation

    def perform(
        self, handle: object, action: Mapping[str, Any], expected_revision: str,
    ) -> ActionReceipt:
        h = self._handle(handle)
        if h.context.cancellation.is_set():
            raise BackendOperationError("request was cancelled before isolated action")
        with h.lock:
            receipt = self.provider.perform(h.provider_handle, action, expected_revision)
        if receipt.target_id != h.target.target_id:
            raise BackendOperationError("isolated provider acted on a different target", code="TARGET_LOST")
        return receipt

    def verify(self, handle: object, action, receipt, before) -> VerificationEvidence:
        h = self._handle(handle)
        with h.lock:
            evidence = self.provider.verify(h.provider_handle, action, receipt, before)
        if evidence.target_id != h.target.target_id:
            raise BackendOperationError("isolated provider verified a different target", code="TARGET_LOST")
        return evidence

    def cancel(self, handle: object, reason: str) -> None:
        h = self._handle(handle, allow_closed=True)
        with h.lock:
            if not h.closed:
                self.provider.cancel(h.provider_handle, reason)

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle, allow_closed=True)
        with h.lock:
            if h.closed:
                return
            if not h.disconnected:
                self.provider.close(h.provider_handle, reason)
                h.disconnected = True
            if h.target.ownership is TargetOwnership.MANAGED and not h.destroyed:
                self.provider.destroy(h.target, reason)
                h.destroyed = True
            h.closed = True

    def _require_available(self) -> None:
        capability = self.probe()
        if not capability.available:
            raise BackendOperationError(
                capability.reason or "isolated desktop unavailable",
                code=ISOLATED_DESKTOP_UNAVAILABLE,
            )

    @staticmethod
    def _handle(handle: object, *, allow_closed: bool = False) -> IsolatedDesktopHandle:
        if not isinstance(handle, IsolatedDesktopHandle):
            raise RuntimeError("invalid isolated desktop handle")
        if handle.closed and not allow_closed:
            raise BackendOperationError("isolated desktop handle is closed", code="TARGET_LOST")
        return handle
