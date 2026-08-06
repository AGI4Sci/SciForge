"""Deterministic capability-driven backend selection."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cua.capabilities import BackendCapabilities, BackendId
from cua.isolation import (
    ApprovalRequired,
    IsolationDecision,
    IsolationUnavailable,
    RequestedIsolation,
    decide_isolation,
)
from cua.session_registry import RegistryError, SessionRegistry, TargetLease
from cua.target import TargetDescriptor

from .backend import BackendOpenContext, InputBackend


class RoutingError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class RouterSelection:
    backend: InputBackend
    capabilities: BackendCapabilities
    decision: IsolationDecision
    lease: TargetLease
    handle: object


class BackendRouter:
    def __init__(self, backends: Iterable[InputBackend] = ()) -> None:
        self._backends = tuple(backends)

    def capabilities(self) -> tuple[BackendCapabilities, ...]:
        return tuple(backend.probe() for backend in self._backends)

    def discover_targets(self) -> list[TargetDescriptor]:
        targets: dict[str, TargetDescriptor] = {}
        for backend in self._backends:
            capability = backend.probe()
            if not capability.available:
                continue
            for target in backend.discover_targets():
                targets.setdefault(target.target_id, target)
        return list(targets.values())

    def route(
        self,
        *,
        registry: SessionRegistry,
        request_id: str,
        target: TargetDescriptor,
        requested: RequestedIsolation,
        allow_degraded: bool,
        approval_context: bool,
        required_actions: tuple[str, ...],
        open_context: BackendOpenContext,
    ) -> RouterSelection:
        candidates: list[tuple[int, InputBackend, BackendCapabilities, IsolationDecision]] = []
        rejections: list[dict[str, str]] = []
        for backend in self._backends:
            capability = backend.probe()
            if not capability.available:
                rejections.append({"backend": capability.backend.value, "reason": capability.reason or "unavailable"})
                continue
            if target.kind not in capability.target_kinds:
                continue
            missing = sorted(set(required_actions) - set(capability.actions))
            if missing:
                rejections.append({"backend": capability.backend.value, "reason": f"unsupported actions: {', '.join(missing)}"})
                continue
            try:
                decision = decide_isolation(
                    requested,
                    capability.effective_isolation,
                    allow_degraded=allow_degraded,
                    approval_context=approval_context,
                )
            except ApprovalRequired as error:
                rejections.append({"backend": capability.backend.value, "reason": str(error)})
                continue
            except IsolationUnavailable as error:
                rejections.append({"backend": capability.backend.value, "reason": str(error)})
                continue
            priority = {
                BackendId.BROWSER_CDP: 0,
                BackendId.WINDOWS_UIA: 1,
                BackendId.ISOLATED_DESKTOP: 2,
                BackendId.STATIC_IMAGE: 3,
                BackendId.LEGACY_PYAUTOGUI: 4,
            }[capability.backend]
            candidates.append((priority, backend, capability, decision))

        if not candidates:
            if any("approval" in item["reason"] for item in rejections):
                code = "NEEDS_APPROVAL"
            elif any("requested isolation" in item["reason"] for item in rejections):
                code = "ISOLATION_UNAVAILABLE"
            else:
                code = "BACKEND_UNAVAILABLE"
            raise RoutingError(code, f"no backend can serve target {target.target_id}", details={"candidates": rejections})

        last_open_error: Exception | None = None
        for _, backend, capability, decision in sorted(candidates, key=lambda item: item[0]):
            try:
                lease = registry.acquire_lease(
                    request_id,
                    backend=capability.backend.value,
                    scope=capability.lease_scope,
                )
            except RegistryError as error:
                raise RoutingError(error.code, str(error), details=error.details) from error
            try:
                handle = backend.open(target, open_context)
            except Exception as error:  # open has not returned a usable handle
                registry.release_lease(lease.lease_id, "backend_open_failed")
                last_open_error = error
                continue
            # Once open() returns, the handle and lease must have one cleanup
            # owner. The service immediately wraps this selection in a Channel,
            # which handles cancellation and retryable close failures without a
            # second, divergent teardown path in the router.
            return RouterSelection(backend, capability, decision, lease, handle)

        raise RoutingError(
            "BACKEND_UNAVAILABLE",
            f"all matching backends failed before opening target {target.target_id}: {last_open_error}",
            details={"targetId": target.target_id},
        )
