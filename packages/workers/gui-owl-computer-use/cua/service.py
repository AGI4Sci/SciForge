"""Single-session CDP control authority and cleanup owner."""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Callable

from driver.backend import BackendOpenContext, BackendOperationError, RecoverableOpenBackend
from driver.channel import ChannelError, SessionInputChannel
from driver.router import BackendRouter, PendingOpenSelection, RoutingError

from . import contract, result as R
from .invocation_ledger import InvocationLedger, InvocationLedgerError
from .invocation_proof import InvocationIdentity
from .isolation import RequestedIsolation
from .session_registry import RegistryError, RequestState, SessionOwner, SessionRegistry
from .target import TargetDescriptor, parse_target_descriptor, validate_safe_id

ChannelExecutor = Callable[[dict[str, Any], SessionInputChannel], dict[str, Any]]


def _default_router() -> BackendRouter:
    from driver.backends.cdp_adapter import CdpAdapterBackend
    return BackendRouter([CdpAdapterBackend()])


class ComputerUseService:
    def __init__(self, registry: SessionRegistry | None = None,
                 router: BackendRouter | None = None,
                 lease_ttl_seconds: float | None = None,
                 server_instance_id: str | None = None,
                 invocation_ledger: InvocationLedger | None = None) -> None:
        self.registry = registry or SessionRegistry()
        self.router = router or _default_router()
        self.lease_ttl_seconds = lease_ttl_seconds
        self.server_instance_id = server_instance_id or f"cua-{uuid.uuid4()}"
        self.invocation_ledger = invocation_ledger or InvocationLedger()
        self._lock = threading.RLock()
        self._shutdown_lock = threading.RLock()
        self._channels: dict[str, SessionInputChannel] = {}
        self._request_owner: dict[str, SessionOwner] = {}
        self._cleanup_pending: dict[str, SessionInputChannel] = {}
        self._pending_open_cleanup: dict[str, PendingOpenSelection] = {}
        self._reclaim_sessions: set[str] = set()
        self._lifecycle_state = "running"
        self._approval_proof = "invocation-proof-v1"

    def configure_approval_proof(self, mode: str) -> None:
        if mode not in {"required", "legacy"}: raise ValueError("invalid proof mode")
        self._approval_proof = "invocation-proof-v1" if mode == "required" else "legacy-trust-boundary"

    def configure_cdp_adapter(self, adapter_url: str, token: str,
                              *, expected_adapter_url: str = "") -> dict[str, Any]:
        from driver.backends.cdp_adapter import CdpAdapterBackend
        backend = next((item for item in self.router.backends() if isinstance(item, CdpAdapterBackend)), None)
        if backend is None: return R.err("BACKEND_UNAVAILABLE", "CDP backend is not installed")
        if not adapter_url and expected_adapter_url:
            cleared = backend.clear_configuration_if_matches(expected_adapter_url)
            return R.ok({"configured": not cleared, "cleared": cleared})
        backend.configure(adapter_url, token)
        return R.ok({"configured": bool(adapter_url and token), "cleared": False})

    def bind_session(self, value: object,
                     invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        return self._invoke_once(
            "bind_session", invocation,
            lambda: self._bind_session(value, invocation),
        )

    def _bind_session(self, value: object,
                      invocation: InvocationIdentity | None) -> dict[str, Any]:
        try:
            if not isinstance(value, dict) or set(value) != {"target"}:
                raise ValueError("bind input must contain only target")
            owner = self._owner(invocation)
            target = self._resolve_public_target(parse_target_descriptor(value.get("target")))
            session = self.registry.bind_session(owner, target)
            return R.ok({"protocolVersion": 2, "sessionId": session.session_id,
                         "target": target.to_dict(include_sensitive=False), "state": session.state.value})
        except (ValueError, RegistryError) as error:
            return self._error(error)

    def run(self, value: object, executor: ChannelExecutor, *,
            channel_options: dict[str, Any] | None = None,
            invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        return self._invoke_once(
            "run", invocation,
            lambda: self._run(
                value, executor, channel_options=channel_options, invocation=invocation,
            ),
        )

    def _run(self, value: object, executor: ChannelExecutor, *,
             channel_options: dict[str, Any] | None = None,
             invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        if self._lifecycle_state != "running":
            return R.err("UNAVAILABLE", "computer use service is stopping")
        try:
            request = contract.normalize_run_input(value)
        except ValueError as error:
            code = "UNSUPPORTED_LEGACY_INSTRUCTION" if str(error).startswith("UNSUPPORTED_LEGACY_INSTRUCTION") else "INVALID_ARGUMENT"
            return R.err(code, str(error).split(": ", 1)[-1])
        request_id = invocation.request_id if invocation else request.get("requestId", f"request-{uuid.uuid4()}")
        session_id = request["sessionId"]
        channel: SessionInputChannel | None = None
        started = False
        quarantined = False
        result: dict[str, Any]
        try:
            session = self.registry.get_session(session_id)
            self._assert_owner(session.owner, invocation)
            deadline = time.time() + request["deadlineMs"] / 1000 if "deadlineMs" in request else None
            self.registry.begin_request(session_id, request_id, owner=session.owner, deadline=deadline)
            started = True
            cancellation = self.registry.cancellation_event(request_id)
            action = request["semanticAction"]
            required = _required_actions(action)
            selection = self.router.route(
                registry=self.registry, request_id=request_id, target=session.target,
                requested=RequestedIsolation.HOST_APP_SCOPED, allow_degraded=False,
                approval_context=True, required_actions=required,
                open_context=BackendOpenContext(
                    request_id=request_id, execute=True,
                    settle_s=float((channel_options or {}).get("settle_s", 0.25)),
                    show_overlay=False, cancellation=cancellation, deadline=deadline,
                ), lease_ttl_seconds=self.lease_ttl_seconds,
            )
            channel = SessionInputChannel(
                registry=self.registry, session_id=session_id, request_id=request_id,
                target=session.target, lease=selection.lease, backend=selection.backend,
                handle=selection.handle, capabilities=selection.capabilities,
                isolation=selection.decision, cancellation=cancellation, deadline=deadline,
                lease_ttl_seconds=self.lease_ttl_seconds,
            )
            with self._lock:
                self._channels[request_id] = channel
                self._request_owner[request_id] = session.owner
            self.registry.transition_request(request_id, RequestState.RUNNING)
            result = executor(request, channel)
        except RoutingError as error:
            if error.pending_open is not None:
                with self._lock: self._pending_open_cleanup[request_id] = error.pending_open
                quarantined = True
            result = self._error(error)
        except (ValueError, RegistryError, ChannelError) as error:
            result = self._error(error)
        except Exception as error:  # noqa: BLE001
            result = R.err("INTERNAL_ERROR", str(error), retryable=False)

        terminal, reason = _terminal(result)
        if channel is not None:
            cleanup = channel.close(reason)
            if not cleanup.lease_released:
                with self._lock: self._cleanup_pending[request_id] = channel
                return R.err("CLEANUP_INCOMPLETE", "channel cleanup did not release its lease",
                             details={"requestId": request_id, "errors": cleanup.errors})
            with self._lock:
                self._channels.pop(request_id, None)
                self._request_owner.pop(request_id, None)
        if started and not quarantined:
            try: self.registry.finish_request(request_id, terminal, reason=reason)
            except RegistryError: pass
        with self._lock:
            reclaim_after_run = session_id in self._reclaim_sessions
            if reclaim_after_run:
                self._reclaim_sessions.discard(session_id)
        if reclaim_after_run:
            try: self.registry.close_session(session_id)
            except RegistryError: pass
        return result

    def cancel(self, value: object, _legacy=None,
               invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        return self._invoke_once(
            "cancel", invocation,
            lambda: self._cancel(value, invocation=invocation),
        )

    def _cancel(self, value: object,
                invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        try:
            if not isinstance(value, dict) or set(value) - {"requestId", "reason"}:
                raise ValueError("cancel input is invalid")
            request_id = validate_safe_id(value.get("requestId"), "requestId")
            request = self.registry.get_request(request_id)
            session = self.registry.get_session(request.session_id)
            self._assert_owner(session.owner, invocation)
            reason = str(value.get("reason") or "user_stop")[:256]
            self.registry.request_cancel(request_id, reason)
            with self._lock: channel = self._channels.get(request_id)
            if channel: channel.request_cancel(reason)
            return R.ok({"requestId": request_id, "status": "accepted"})
        except (ValueError, RegistryError, ChannelError) as error:
            return self._error(error)

    def release_session(self, value: object,
                        invocation: InvocationIdentity | None = None) -> dict[str, Any]:
        return self._invoke_once(
            "release_session", invocation,
            lambda: self._release_session(value, invocation),
        )

    def _release_session(self, value: object,
                         invocation: InvocationIdentity | None) -> dict[str, Any]:
        try:
            if not isinstance(value, dict) or set(value) != {"sessionId"}:
                raise ValueError("release input must contain only sessionId")
            session_id = validate_safe_id(value["sessionId"], "sessionId")
            session = self.registry.get_session(session_id)
            self._assert_owner(session.owner, invocation)
            if session.active_request_id:
                cancelled = self._cancel(
                    {"requestId": session.active_request_id, "reason": "client_release"},
                    invocation=invocation,
                )
                if not cancelled.get("ok"): return cancelled
                return R.err("CANCEL_PENDING", "active request cancellation is pending", retryable=True)
            closed = self.registry.close_session(session_id)
            return R.ok({"sessionId": session_id, "targetId": closed.target.target_id,
                         "state": closed.state.value, "reason": "client_release"})
        except (ValueError, RegistryError) as error:
            return self._error(error)

    def reclaim_owner(self, runtime_id: str, thread_id: str, turn_id: str,
                      reason: str = "turn_terminal") -> dict[str, Any]:
        validate_safe_id(runtime_id, "runtimeId")
        validate_safe_id(thread_id, "threadId")
        validate_safe_id(turn_id, "turnId")
        reason = str(reason or "turn_terminal")[:256]
        released, pending = [], []
        for item in list(self.registry.snapshot()["sessions"]):
            if (item["runtimeId"], item["threadId"], item["turnId"]) != (runtime_id, thread_id, turn_id):
                continue
            session_id = item["sessionId"]
            if item["activeRequestId"]:
                with self._lock: self._reclaim_sessions.add(session_id)
                self.registry.request_cancel(item["activeRequestId"], reason)
                with self._lock: channel = self._channels.get(item["activeRequestId"])
                if channel: channel.request_cancel(reason)
                pending.append(session_id)
                continue
            self.registry.close_session(session_id)
            released.append(session_id)
        return R.ok({"released": released, "cleanupPending": pending, "reason": reason})

    def reclaim_cleanup(self) -> dict[str, Any]:
        reclaimed, pending = [], []
        with self._lock: items = list(self._cleanup_pending.items())
        for request_id, channel in items:
            cleanup = channel.close("cleanup_reclaim")
            if cleanup.lease_released:
                with self._lock:
                    self._cleanup_pending.pop(request_id, None)
                    self._channels.pop(request_id, None)
                    self._request_owner.pop(request_id, None)
                try: self.registry.finish_request(request_id, RequestState.FAILED, reason="cleanup_reclaimed")
                except RegistryError: pass
                reclaimed.append(request_id)
            else: pending.append(request_id)
        with self._lock: uncertain_opens = list(self._pending_open_cleanup.items())
        for request_id, selection in uncertain_opens:
            backend = selection.backend
            if not isinstance(backend, RecoverableOpenBackend):
                pending.append(request_id)
                continue
            try:
                handle = backend.recover_open(selection.target, selection.context)
                backend.close(handle, "cleanup_reclaim")
                self.registry.release_lease(selection.lease.lease_id, "cleanup_reclaim")
                self.registry.finish_request(
                    request_id, RequestState.FAILED, reason="cleanup_reclaimed"
                )
            except BackendOperationError as error:
                if not error.safe_to_retry:
                    pending.append(request_id)
                    continue
                self.registry.release_lease(selection.lease.lease_id, "open_proven_absent")
                self.registry.finish_request(
                    request_id, RequestState.FAILED, reason="open_proven_absent"
                )
            except Exception:  # an uncertain recovery must retain ownership
                pending.append(request_id)
                continue
            with self._lock: self._pending_open_cleanup.pop(request_id, None)
            reclaimed.append(request_id)
        return R.ok({"reclaimed": reclaimed, "cleanupPending": pending})

    def list_targets(self) -> dict[str, Any]:
        return {"protocolVersion": 2, "targets": [item.to_dict(include_sensitive=False) for item in self.router.discover_targets()]}

    def capabilities(self) -> dict[str, Any]:
        counts = self.registry.snapshot_counts()
        with self._lock:
            channels = len(self._channels)
            pending = len(self._cleanup_pending) + len(self._pending_open_cleanup)
        return {"protocolVersion": 2, "approvalProof": self._approval_proof,
                "backends": [item.to_dict() for item in self.router.capabilities()],
                "runtime": {"counts": counts, "activeChannels": channels,
                            "activeRequests": counts["requests"], "cleanupPending": pending,
                            "waiters": 0, "backendHandles": channels}}

    def status(self) -> dict[str, Any]:
        return {"serverInstanceId": self.server_instance_id, "protocolVersion": 2,
                "approvalProof": self._approval_proof, "lifecycleState": self._lifecycle_state,
                "registry": self.registry.snapshot(), "runtime": self.capabilities()["runtime"]}

    def _invoke_once(
        self,
        operation: str,
        invocation: InvocationIdentity | None,
        executor: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        try:
            return self.invocation_ledger.execute(
                invocation, operation=operation, executor=executor,
            )
        except InvocationLedgerError as error:
            return R.err(error.code, str(error), retryable=False)

    def shutdown(self) -> dict[str, Any]:
        with self._shutdown_lock:
            if self._lifecycle_state == "stopped":
                return R.ok({"status": "stopped", "counts": self.registry.snapshot_counts()})
            self._lifecycle_state = "stopping"
            with self._lock: channels = list(self._channels.items())
            for request_id, channel in channels:
                try: channel.request_cancel("server_stop")
                except Exception: pass
                cleanup = channel.close("server_stop")
                if cleanup.lease_released:
                    with self._lock:
                        self._channels.pop(request_id, None)
                        self._request_owner.pop(request_id, None)
                    try: self.registry.finish_request(request_id, RequestState.CANCELLED, reason="server_stop")
                    except RegistryError: pass
                else:
                    with self._lock: self._cleanup_pending[request_id] = channel
            self.reclaim_cleanup()
            with self._lock:
                cleanup_pending = len(self._cleanup_pending) + len(self._pending_open_cleanup)
            if cleanup_pending:
                return R.err(
                    "CLEANUP_INCOMPLETE", "service shutdown retained unresolved cleanup ownership",
                    details={"cleanupPending": cleanup_pending}, retryable=True,
                )
            counts = self.registry.shutdown()
            self._lifecycle_state = "stopped"
            return R.ok({"status": "stopped", "counts": counts})

    def _resolve_public_target(self, target: TargetDescriptor) -> TargetDescriptor:
        for candidate in self.router.discover_targets():
            if candidate.target_id == target.target_id:
                if candidate.generation != target.generation: raise ValueError("target generation changed")
                return candidate
        raise ValueError("target is not currently discoverable")

    @staticmethod
    def _owner(invocation: InvocationIdentity | None) -> SessionOwner:
        if invocation is None: return SessionOwner("local-runtime", "local-thread", "local-turn")
        return SessionOwner(invocation.runtime_id, invocation.thread_id, invocation.turn_id)

    @staticmethod
    def _assert_owner(owner: SessionOwner, invocation: InvocationIdentity | None) -> None:
        if invocation and (
            owner.runtime_id != invocation.runtime_id or
            owner.thread_id != invocation.thread_id or
            owner.turn_id != invocation.turn_id
        ):
            raise RegistryError("SESSION_OWNER_MISMATCH", "session owner does not match trusted invocation turn")

    @staticmethod
    def _error(error: Exception) -> dict[str, Any]:
        code = getattr(error, "code", "INVALID_ARGUMENT")
        return R.err(code, str(error), details=getattr(error, "details", None))


def _required_actions(action: dict[str, Any]) -> tuple[str, ...]:
    names = ["observe"]
    steps = action.get("steps", [action] if action["kind"] != "observe" else [])
    for step in steps:
        names.append({"press": "key", "scroll": "scroll"}.get(step["kind"], step["kind"]))
    return tuple(dict.fromkeys(names))


def _terminal(result: dict[str, Any]) -> tuple[RequestState, str]:
    code = result.get("error", {}).get("code") if not result.get("ok") else None
    if code == "CANCEL_PENDING": return RequestState.CANCELLED, "cancelled"
    if code == "TIMEOUT": return RequestState.TIMED_OUT, "timed_out"
    if code == "TARGET_LOST": return RequestState.TARGET_LOST, "target_lost"
    if code: return RequestState.FAILED, str(code).lower()
    return RequestState.COMPLETED, "completed"


SERVICE = ComputerUseService()
