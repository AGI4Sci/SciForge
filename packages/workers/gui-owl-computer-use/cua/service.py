"""Process-level service authority for sessions, routing and channel cleanup."""
from __future__ import annotations

import time
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable

from driver.backend import BackendOpenContext
from driver.channel import ChannelError, SessionInputChannel
from driver.router import BackendRouter, RoutingError

from . import contract
from . import result as R
from .isolation import RequestedIsolation
from .invocation_proof import InvocationIdentity
from .session_registry import RegistryError, RequestState, SessionOwner, SessionRegistry
from .target import host_desktop_target, parse_target_descriptor, validate_safe_id


ChannelExecutor = Callable[[dict[str, Any], SessionInputChannel], dict[str, Any]]


def _utc_iso(epoch_seconds: float | None = None) -> str:
    value = time.time() if epoch_seconds is None else epoch_seconds
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _default_router() -> BackendRouter:
    from driver.backends.cdp_adapter import CdpAdapterBackend
    from driver.backends.isolated_desktop import IsolatedDesktopBackend
    from driver.backends.legacy_pyautogui import LegacyPyAutoGUIBackend
    from driver.backends.windows_uia import WindowsUIABackend

    return BackendRouter([
        CdpAdapterBackend(), WindowsUIABackend(), IsolatedDesktopBackend(),
        LegacyPyAutoGUIBackend(),
    ])


class ComputerUseService:
    def __init__(
        self,
        registry: SessionRegistry | None = None,
        router: BackendRouter | None = None,
        lease_ttl_seconds: float | None = None,
        server_instance_id: str | None = None,
    ) -> None:
        if lease_ttl_seconds is not None and lease_ttl_seconds <= 0:
            raise ValueError("lease_ttl_seconds must be positive")
        self.registry = registry or SessionRegistry()
        self.router = router or _default_router()
        self.lease_ttl_seconds = lease_ttl_seconds
        self._channels_lock = threading.RLock()
        self._channels: dict[str, SessionInputChannel] = {}
        self._lifecycle_lock = threading.RLock()
        self._lifecycle_state = "running"
        self._reaper_stop = threading.Event()
        self._reaper_thread: threading.Thread | None = None
        self._reaper_interval_seconds: float | None = None
        self._last_reaper_error: str | None = None
        self._approval_proof = "legacy-trust-boundary"
        self._server_instance_id = server_instance_id or f"cua-{uuid.uuid4()}"
        self._request_contexts: dict[str, dict[str, Any]] = {}
        self._recent_rejections: deque[dict[str, Any]] = deque(maxlen=20)

    def configure_approval_proof(self, mode: str) -> None:
        if mode not in {"required", "legacy"}:
            raise ValueError("approval proof mode must be required or legacy")
        self._approval_proof = (
            "invocation-proof-v1" if mode == "required" else "legacy-trust-boundary"
        )

    def run(
        self,
        value: object,
        executor: ChannelExecutor,
        *,
        channel_options: dict[str, Any] | None = None,
        invocation: InvocationIdentity | None = None,
    ) -> dict[str, Any]:
        with self._lifecycle_lock:
            if self._lifecycle_state != "running":
                return R.err(
                    "UNAVAILABLE",
                    "computer use service is shutting down and no longer accepts requests",
                    details={"reason": "service-shutting-down"},
                )
        try:
            request = contract.normalize_run_input(value)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))
        options = dict(channel_options or {})
        approved = invocation is not None or request["approve"]
        if request["execute"] and not (approved and bool(options.get("allow_execute", False))):
            return R.err(
                "NEEDS_APPROVAL",
                "Execution touches the real desktop and requires trusted approval.",
                blocked_reason="external-side-effect-requires-approval",
            )

        request_id = (
            invocation.request_id if invocation is not None
            else request.get("requestId") or f"request-{uuid.uuid4()}"
        )
        request["requestId"] = request_id
        request["approve"] = approved
        ephemeral = False
        session_id: str | None = None
        channel: SessionInputChannel | None = None
        request_started = False
        terminal_state = RequestState.FAILED
        terminal_reason = "request_failed"
        result: dict[str, Any]
        try:
            session, ephemeral = self._resolve_session(request, invocation)
            session_id = session.session_id
            deadline = (
                time.time() + request["deadlineMs"] / 1000.0
                if "deadlineMs" in request
                else None
            )
            self.registry.begin_request(session_id, request_id, deadline=deadline)
            request_started = True
            with self._channels_lock:
                self._request_contexts[request_id] = {
                    "runtimeId": session.owner.runtime_id,
                    "threadId": session.owner.thread_id,
                    "turnId": invocation.turn_id if invocation is not None else "",
                    "requestedIsolation": request["requestedIsolation"],
                }
            cancellation = self.registry.cancellation_event(request_id)
            open_context = BackendOpenContext(
                request_id=request_id,
                execute=request["execute"],
                settle_s=float(options.get("settle_s", 0.25)),
                show_overlay=bool(options.get("show_overlay", False)),
                cancellation=cancellation,
                screenshot_provider=options.get("screenshot_provider"),
            )
            # The natural-language request has no trusted action plan yet.  Route
            # on observation capability, then enforce each planned action at the
            # channel boundary before it reaches the backend.
            required_actions = ("observe",)
            selection = self.router.route(
                registry=self.registry,
                request_id=request_id,
                target=session.target,
                requested=RequestedIsolation(request["requestedIsolation"]),
                allow_degraded=request["allowDegraded"],
                approval_context=(not request["execute"]) or (
                    request["approve"] and bool(options.get("allow_execute", False))
                ),
                required_actions=required_actions,
                open_context=open_context,
                lease_ttl_seconds=self.lease_ttl_seconds,
            )
            channel = SessionInputChannel(
                registry=self.registry,
                session_id=session_id,
                request_id=request_id,
                target=session.target,
                lease=selection.lease,
                backend=selection.backend,
                handle=selection.handle,
                capabilities=selection.capabilities,
                isolation=selection.decision,
                cancellation=cancellation,
                deadline=deadline,
                lease_ttl_seconds=self.lease_ttl_seconds,
            )
            with self._channels_lock:
                self._channels[request_id] = channel
            if cancellation.is_set():
                raise RoutingError("CANCEL_PENDING", "request was cancelled while opening backend")
            self.registry.transition_request(request_id, RequestState.RUNNING)
            result = executor(request, channel)
            terminal_state, terminal_reason = self._terminal_from_result(result)
        except RoutingError as error:
            terminal_reason = error.code.lower()
            result = R.err(error.code, str(error), details=error.details)
        except RegistryError as error:
            terminal_reason = error.code.lower()
            result = R.err(error.code, str(error), details=error.details)
        except ChannelError as error:
            terminal_reason = error.code.lower()
            result = R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            terminal_reason = "invalid_argument"
            result = R.err("INVALID_ARGUMENT", str(error))
        except Exception as error:  # noqa: BLE001
            terminal_reason = "internal_error"
            result = R.err("INTERNAL_ERROR", str(error), retryable=False)

        # Exception paths use the same public error envelope as executor
        # results, so derive their Registry terminal state from that envelope
        # as well. In particular, cancellation during backend open must finish
        # as CANCELLED rather than inheriting the default FAILED state.
        if not result.get("ok"):
            terminal_state, terminal_reason = self._terminal_from_result(result)

        cleanup = channel.close(terminal_reason) if channel is not None else None
        cleanup_complete = cleanup is None or cleanup.lease_released
        if cleanup is not None and cleanup.errors:
            result.setdefault("warnings", []).extend(cleanup.errors)
        if cleanup is not None and not cleanup.lease_released:
            result = R.err(
                "CLEANUP_INCOMPLETE",
                "channel cleanup did not release its lease",
                details={"errors": cleanup.errors, "requestId": request_id},
            )
            terminal_state, terminal_reason = RequestState.FAILED, "cleanup_incomplete"

        if channel is not None and cleanup_complete:
            with self._channels_lock:
                self._channels.pop(request_id, None)
        if cleanup_complete:
            with self._channels_lock:
                self._request_contexts.pop(request_id, None)
        if request_started and cleanup_complete:
            try:
                self.registry.finish_request(
                    request_id,
                    terminal_state,
                    reason=terminal_reason,
                )
            except RegistryError:
                pass
        if ephemeral and session_id is not None and cleanup_complete:
            try:
                self.registry.close_session(session_id, force=True)
            except RegistryError:
                pass
        if not result.get("ok"):
            self._remember_rejection(result, request_id=request_id)
        return result

    def _resolve_session(
        self, request: dict[str, Any], invocation: InvocationIdentity | None = None,
    ):
        protocol = request["protocolVersion"]
        target_value = request.get("target")
        owner = (
            SessionOwner(invocation.runtime_id, invocation.thread_id)
            if invocation is not None else None
        )
        if protocol == contract.PROTOCOL_V1:
            resolved_owner = owner or SessionOwner("legacy-runtime", f"request-{uuid.uuid4()}")
            return self.registry.bind_session(resolved_owner, host_desktop_target()), True
        if "sessionId" in request:
            session = self.registry.get_session(request["sessionId"])
            self._assert_session_owner(session.owner, invocation)
            if target_value is not None:
                supplied = parse_target_descriptor(target_value)
                if supplied.target_id != session.target.target_id or supplied.kind is not session.target.kind:
                    raise ValueError("run target does not match the immutable session target")
            return session, False
        if target_value is None:
            raise ValueError("protocol v2 run requires sessionId or target")
        target = parse_target_descriptor(target_value)
        resolved_owner = owner or SessionOwner("mcp-local", f"ephemeral-{uuid.uuid4()}")
        return self.registry.bind_session(resolved_owner, target), True

    @staticmethod
    def _terminal_from_result(result: dict[str, Any]) -> tuple[RequestState, str]:
        if not result.get("ok"):
            code = result.get("error", {}).get("code")
            if code == "CANCEL_PENDING":
                return RequestState.CANCELLED, "cancelled"
            if code == "TIMEOUT":
                return RequestState.TIMED_OUT, "timed_out"
            if code == "TARGET_LOST":
                return RequestState.TARGET_LOST, "target_lost"
            return RequestState.FAILED, str(code or "failed").lower()
        status = result.get("data", {}).get("status")
        if status == "cancelled":
            return RequestState.CANCELLED, "cancelled"
        return RequestState.COMPLETED, "completed"

    def bind_session(
        self, value: object, invocation: InvocationIdentity | None = None,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "bind input must be an object")
        try:
            unknown = set(value) - {"sessionId", "owner", "target"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
            if invocation is not None:
                if "owner" in value:
                    raise ValueError("owner is supplied by the trusted invocation proof")
                owner = SessionOwner(invocation.runtime_id, invocation.thread_id)
            else:
                owner_value = value.get("owner")
                if not isinstance(owner_value, dict) or set(owner_value) != {"runtimeId", "threadId"}:
                    raise ValueError("owner must contain exactly runtimeId and threadId")
                owner = SessionOwner(
                    runtime_id=validate_safe_id(owner_value["runtimeId"], "owner.runtimeId"),
                    thread_id=validate_safe_id(owner_value["threadId"], "owner.threadId"),
                )
            target = parse_target_descriptor(value.get("target"))
            session = self.registry.bind_session(owner, target, session_id=value.get("sessionId"))
            return R.ok({
                "protocolVersion": contract.PROTOCOL_V2,
                "sessionId": session.session_id,
                "target": target.to_dict(include_sensitive=False),
                "state": session.state.value,
            })
        except RegistryError as error:
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def release_session(
        self, value: object, invocation: InvocationIdentity | None = None,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "release input must be an object")
        try:
            unknown = set(value) - {"sessionId", "reason", "force"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
            session_id = validate_safe_id(value.get("sessionId"), "sessionId")
            reason = value.get("reason", "client_release")
            if not isinstance(reason, str) or not reason or len(reason) > 256:
                raise ValueError("reason must be a non-empty string of at most 256 characters")
            force = value.get("force", False)
            if not isinstance(force, bool):
                raise ValueError("force must be a boolean")
            current = self.registry.get_session(session_id)
            self._assert_session_owner(current.owner, invocation)
            if current.active_request_id is not None and force:
                request_id = current.active_request_id
                self.registry.request_cancel(request_id, reason)
                with self._channels_lock:
                    channel = self._channels.get(request_id)
                if channel is None:
                    return R.err(
                        "CANCEL_PENDING",
                        "request cancellation is pending before channel ownership is established",
                        details={"requestId": request_id, "sessionId": session_id},
                    )
                cleanup = channel.close(reason)
                if not cleanup.lease_released:
                    return R.err(
                        "CLEANUP_INCOMPLETE",
                        "channel cleanup did not release its lease",
                        details={"errors": cleanup.errors, "requestId": request_id},
                    )
                with self._channels_lock:
                    self._channels.pop(request_id, None)
                self.registry.finish_request(request_id, RequestState.CANCELLED, reason=reason)
            session = self.registry.close_session(session_id, force=False)
            return R.ok({"sessionId": session.session_id, "targetId": session.target.target_id, "state": session.state.value, "reason": reason})
        except RegistryError as error:
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def cancel(
        self,
        value: object,
        legacy_canceller: Callable[[str], None] | None = None,
        invocation: InvocationIdentity | None = None,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "cancel input must be an object")
        try:
            unknown = set(value) - {"requestId", "sessionId", "reason"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
            request_id = validate_safe_id(value.get("requestId"), "requestId")
            if invocation is not None:
                active = self.registry.get_request(request_id)
                session = self.registry.get_session(active.session_id)
                self._assert_session_owner(session.owner, invocation)
            request = self.registry.request_cancel(request_id, str(value.get("reason", "user_stop")))
            terminal = request.state in {
                RequestState.COMPLETED, RequestState.FAILED, RequestState.CANCELLED,
                RequestState.TIMED_OUT, RequestState.TARGET_LOST,
            }
            status = "already-terminal" if terminal else "accepted"
            if not terminal:
                for lease in self.registry.snapshot()["leases"]:
                    if lease["requestId"] == request_id and lease["inFlightActionCount"] > 0:
                        status = "stopping"
                        break
            return R.ok({"requestId": request_id, "status": status, "state": request.state.value})
        except RegistryError as error:
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def status(self) -> dict[str, Any]:
        capabilities = self.router.capabilities()
        with self._channels_lock:
            channels = dict(self._channels)
            contexts = dict(self._request_contexts)
            rejections = list(self._recent_rejections)
        registry = self.registry.snapshot()
        sessions = {item["sessionId"]: item for item in registry["sessions"]}
        leases = {item["requestId"]: item for item in registry["leases"]}
        active = []
        for request in registry["requests"]:
            request_id = request["requestId"]
            session = sessions.get(request["sessionId"], {})
            lease = leases.get(request_id, {})
            channel = channels.get(request_id)
            context = contexts.get(request_id, {})
            active.append({
                "sessionId": request["sessionId"],
                "requestId": request_id,
                "targetId": request["targetId"],
                "leaseId": request.get("leaseId"),
                "runtimeId": context.get("runtimeId", session.get("runtimeId", "unknown")),
                "threadId": context.get("threadId", session.get("threadId", "unknown")),
                "turnId": context.get("turnId", ""),
                "backend": channel.capabilities.backend.value if channel else lease.get("backend"),
                "leaseScope": channel.capabilities.lease_scope.value if channel else lease.get("scope"),
                "requestedIsolation": (
                    channel.isolation.requested.value if channel else context.get("requestedIsolation", "auto")
                ),
                "effectiveIsolation": channel.isolation.effective.value if channel else None,
                "degraded": channel.isolation.degraded if channel else False,
                "degradedReason": channel.isolation.degraded_reason if channel else None,
                "verification": (
                    channel.last_verification.value if channel else "not-applicable"
                ),
                "state": request["state"],
                "updatedAt": _utc_iso(request.get("updatedAt")),
            })
        return {
            "serverInstanceId": self._server_instance_id,
            "updatedAt": _utc_iso(),
            "protocolVersion": contract.PROTOCOL_V2,
            "approvalProof": self._approval_proof,
            "backendsConnected": any(item.available for item in capabilities),
            "backends": [item.to_dict() for item in capabilities],
            "activeChannels": len(channels),
            "active": active,
            "lifecycleState": self._lifecycle_state,
            "cleanupPending": self.cleanup_pending(),
            "recentRejections": rejections,
            "reaper": {
                "running": self._reaper_thread is not None and self._reaper_thread.is_alive(),
                "intervalSeconds": self._reaper_interval_seconds,
                "leaseTtlSeconds": self.lease_ttl_seconds,
                "lastError": self._last_reaper_error,
            },
            "registry": registry,
        }

    def capabilities(self) -> dict[str, Any]:
        capabilities = self.router.capabilities()
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "backends": [item.to_dict() for item in capabilities],
            "approvalProof": self._approval_proof,
        }

    @staticmethod
    def _assert_session_owner(
        owner: SessionOwner, invocation: InvocationIdentity | None,
    ) -> None:
        if invocation is None:
            return
        if owner.runtime_id != invocation.runtime_id or owner.thread_id != invocation.thread_id:
            raise RegistryError(
                "SESSION_OWNER_MISMATCH",
                "session owner does not match the trusted invocation identity",
            )

    def list_targets(self) -> dict[str, Any]:
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "targets": [target.to_dict(include_sensitive=False) for target in self.router.discover_targets()],
        }

    def cleanup_pending(self) -> list[dict[str, Any]]:
        with self._channels_lock:
            channels = list(self._channels.values())
        return [
            {
                "requestId": channel.request_id,
                "sessionId": channel.session_id,
                "targetId": channel.target.target_id,
                "leaseId": channel.lease.lease_id,
                "backend": channel.capabilities.backend.value,
                "closed": channel.cleanup.closed,
                "leaseReleased": channel.cleanup.lease_released,
                "errors": [str(error)[:512] for error in channel.cleanup.errors],
            }
            for channel in channels
            if channel.cleanup.errors or channel.cancelled or self._lifecycle_state != "running"
        ]

    def _remember_rejection(self, result: dict[str, Any], *, request_id: str) -> None:
        error = result.get("error") if isinstance(result, dict) else None
        if not isinstance(error, dict):
            return
        with self._channels_lock:
            self._recent_rejections.append({
                "requestId": request_id,
                "code": str(error.get("code", "UNKNOWN"))[:128],
                "message": str(error.get("message", "request rejected"))[:512],
                "updatedAt": _utc_iso(),
            })

    def reap_once(self) -> dict[str, Any]:
        scan = self.registry.reap_expired()
        cleaned: list[str] = []
        pending: list[str] = []
        for request_id in scan["expiredRequests"]:
            if self._finish_after_channel_close(
                request_id, RequestState.TIMED_OUT, "lease_expired",
            ):
                cleaned.append(request_id)
            else:
                pending.append(request_id)
        return {**scan, "cleanedRequests": cleaned, "cleanupPending": pending}

    def mark_target_lost(self, target_id: str) -> dict[str, list[str]]:
        affected = self.registry.mark_target_lost(target_id)
        cleaned: list[str] = []
        pending: list[str] = []
        for request_id in affected:
            if self._finish_after_channel_close(
                request_id, RequestState.TARGET_LOST, "target_lost",
            ):
                cleaned.append(request_id)
            else:
                pending.append(request_id)
        return {"affectedRequests": affected, "cleanedRequests": cleaned, "cleanupPending": pending}

    def _finish_after_channel_close(
        self, request_id: str, state: RequestState, reason: str,
    ) -> bool:
        with self._channels_lock:
            channel = self._channels.get(request_id)
        if channel is None:
            return False
        cleanup = channel.close(reason)
        if not cleanup.lease_released:
            return False
        with self._channels_lock:
            self._channels.pop(request_id, None)
            self._request_contexts.pop(request_id, None)
        try:
            self.registry.finish_request(request_id, state, reason=reason)
        except RegistryError:
            pass
        return True

    def start_reaper(self, interval_seconds: float) -> None:
        if interval_seconds <= 0:
            raise ValueError("reaper interval must be positive")
        with self._lifecycle_lock:
            if self._lifecycle_state != "running":
                raise RuntimeError("cannot start reaper while service is shutting down")
            if self._reaper_thread is not None and self._reaper_thread.is_alive():
                return
            self._reaper_interval_seconds = interval_seconds
            self._reaper_stop.clear()
            self._reaper_thread = threading.Thread(
                target=self._reaper_loop,
                name="computer-use-lease-reaper",
                daemon=True,
            )
            self._reaper_thread.start()

    def configure_lifecycle(
        self,
        *,
        lease_ttl_seconds: float,
        reaper_interval_seconds: float,
        reaper_enabled: bool = True,
    ) -> None:
        if lease_ttl_seconds <= 0 or reaper_interval_seconds <= 0:
            raise ValueError("lease TTL and reaper interval must be positive")
        with self._lifecycle_lock, self._channels_lock:
            if self._lifecycle_state != "running" or self._channels:
                raise RuntimeError("lifecycle configuration must be set before requests start")
            self.lease_ttl_seconds = lease_ttl_seconds if reaper_enabled else None
            self._reaper_interval_seconds = reaper_interval_seconds if reaper_enabled else None
        if reaper_enabled:
            self.start_reaper(reaper_interval_seconds)

    def _reaper_loop(self) -> None:
        interval = self._reaper_interval_seconds or 1.0
        while not self._reaper_stop.wait(interval):
            try:
                self.reap_once()
                self._last_reaper_error = None
            except Exception as error:  # reaper must stay alive for later retries
                self._last_reaper_error = f"{type(error).__name__}: {error}"[:512]
                continue

    def shutdown(self) -> dict[str, Any]:
        with self._lifecycle_lock:
            self._lifecycle_state = "shutting-down"
            self.registry.begin_shutdown()
            self._reaper_stop.set()
            reaper = self._reaper_thread
        if reaper is not None and reaper is not threading.current_thread():
            reaper.join(timeout=max(1.0, (self._reaper_interval_seconds or 0.0) * 2))
        with self._channels_lock:
            channels = list(self._channels.values())
        for channel in channels:
            try:
                self.registry.request_cancel(channel.request_id, "server_stop")
            except RegistryError:
                pass
        for channel in channels:
            cleanup = channel.close("server_stop")
            if not cleanup.lease_released:
                continue
            with self._channels_lock:
                self._channels.pop(channel.request_id, None)
                self._request_contexts.pop(channel.request_id, None)
            try:
                self.registry.finish_request(
                    channel.request_id, RequestState.CANCELLED, reason="server_stop",
                )
            except RegistryError:
                pass
        snapshot = self.registry.snapshot()
        for session in snapshot["sessions"]:
            if session["activeRequestId"] is None:
                try:
                    self.registry.close_session(session["sessionId"])
                except RegistryError:
                    pass
        counts = self.registry.snapshot_counts()
        pending = self.cleanup_pending()
        with self._lifecycle_lock:
            if not pending and counts["activeLeases"] == 0:
                self._lifecycle_state = "stopped"
        return {
            **counts,
            "lifecycleState": self._lifecycle_state,
            "cleanupComplete": not pending and counts["activeLeases"] == 0,
            "cleanupPending": pending,
        }


SERVICE = ComputerUseService()
