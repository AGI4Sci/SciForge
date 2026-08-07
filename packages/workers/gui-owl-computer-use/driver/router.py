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
from cua.session_registry import LeaseScope, RegistryError, SessionRegistry, TargetLease
from cua.target import TargetDescriptor, TargetKind

from .backend import BackendOpenContext, BackendOperationError, InputBackend


class RoutingError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict | None = None,
        pending_open: "PendingOpenSelection | None" = None,
    ):
        super().__init__(message)
        self.code = code
        self.details = details or {}
        self.pending_open = pending_open


@dataclass(frozen=True)
class RouterSelection:
    backend: InputBackend
    capabilities: BackendCapabilities
    decision: IsolationDecision
    lease: TargetLease
    handle: object


@dataclass(frozen=True)
class PendingOpenSelection:
    backend: InputBackend
    capabilities: BackendCapabilities
    target: TargetDescriptor
    context: BackendOpenContext
    lease: TargetLease


class BackendRouter:
    def __init__(self, backends: Iterable[InputBackend] = ()) -> None:
        self._backends = tuple(backends)

    def capabilities(self) -> tuple[BackendCapabilities, ...]:
        return tuple(backend.probe() for backend in self._backends)

    def backends(self) -> tuple[InputBackend, ...]:
        return self._backends

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
        lease_ttl_seconds: float | None = None,
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
            if (
                target.kind is TargetKind.ISOLATED_DESKTOP
                and any("ISOLATED_DESKTOP_UNAVAILABLE" in item["reason"] for item in rejections)
            ):
                code = "ISOLATED_DESKTOP_UNAVAILABLE"
            elif any("approval" in item["reason"] for item in rejections):
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
                    scope_key=self._scope_key(target, capability.lease_scope),
                    ttl_seconds=lease_ttl_seconds,
                )
            except RegistryError as error:
                raise RoutingError(error.code, str(error), details=error.details) from error
            try:
                handle = backend.open(target, open_context)
            except Exception as error:
                # An exception does not prove that a remote/native open had no
                # side effect. Only an explicit backend classification permits
                # releasing the lease and trying another candidate. Otherwise
                # retain the lease/request as cleanup-pending so a possibly
                # live handle can never overlap with a different backend.
                if isinstance(error, BackendOperationError) and error.safe_to_retry:
                    registry.release_lease(lease.lease_id, "backend_open_failed_safe")
                    last_open_error = error
                    continue
                raise RoutingError(
                    "CLEANUP_INCOMPLETE",
                    f"backend {capability.backend.value} open outcome is unknown; lease retained",
                    details={
                        "requestId": request_id,
                        "targetId": target.target_id,
                        "leaseId": lease.lease_id,
                        "backend": capability.backend.value,
                        "retainLease": True,
                    },
                    pending_open=PendingOpenSelection(
                        backend, capability, target, open_context, lease,
                    ),
                ) from error
            # Once open() returns, the handle and lease must have one cleanup
            # owner. The service immediately wraps this selection in a Channel,
            # which handles cancellation and retryable close failures without a
            # second, divergent teardown path in the router.
            return RouterSelection(backend, capability, decision, lease, handle)

        final_code = (
            last_open_error.code
            if isinstance(last_open_error, BackendOperationError) and last_open_error.code
            else "BACKEND_UNAVAILABLE"
        )
        raise RoutingError(
            final_code,
            f"all matching backends failed before opening target {target.target_id}: {last_open_error}",
            details={"targetId": target.target_id},
        )

    @staticmethod
    def _scope_key(target: TargetDescriptor, scope: LeaseScope) -> str | None:
        if scope is not LeaseScope.ENVIRONMENT:
            return None
        if target.kind is TargetKind.ISOLATED_DESKTOP:
            environment_id = target.locator.get("isolatedEnvironmentId")
            if isinstance(environment_id, str) and environment_id:
                return environment_id
        # An environment-scoped backend must never collapse unrelated targets
        # to a backend-global key merely because a provider omitted its locator.
        return target.target_id
