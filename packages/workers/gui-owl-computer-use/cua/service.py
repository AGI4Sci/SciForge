"""Process-level service authority for sessions, routing and channel cleanup."""
from __future__ import annotations

import time
import threading
import uuid
from typing import Any, Callable

from driver.backend import BackendOpenContext
from driver.channel import SessionInputChannel
from driver.router import BackendRouter, RoutingError

from . import contract
from . import result as R
from .isolation import RequestedIsolation
from .session_registry import RegistryError, RequestState, SessionOwner, SessionRegistry
from .target import host_desktop_target, parse_target_descriptor, validate_safe_id


ChannelExecutor = Callable[[dict[str, Any], SessionInputChannel], dict[str, Any]]


def _default_router() -> BackendRouter:
    from driver.backends.legacy_pyautogui import LegacyPyAutoGUIBackend

    return BackendRouter([LegacyPyAutoGUIBackend()])


class ComputerUseService:
    def __init__(
        self,
        registry: SessionRegistry | None = None,
        router: BackendRouter | None = None,
    ) -> None:
        self.registry = registry or SessionRegistry()
        self.router = router or _default_router()
        self._channels_lock = threading.RLock()
        self._channels: dict[str, SessionInputChannel] = {}

    def run(
        self,
        value: object,
        executor: ChannelExecutor,
        *,
        channel_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            request = contract.normalize_run_input(value)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))
        options = dict(channel_options or {})
        if request["execute"] and not (
            request["approve"] and bool(options.get("allow_execute", False))
        ):
            return R.err(
                "NEEDS_APPROVAL",
                "Execution touches the real desktop and requires trusted approval.",
                blocked_reason="external-side-effect-requires-approval",
            )

        request_id = request.get("requestId") or f"request-{uuid.uuid4()}"
        request["requestId"] = request_id
        ephemeral = False
        session_id: str | None = None
        channel: SessionInputChannel | None = None
        request_started = False
        terminal_state = RequestState.FAILED
        terminal_reason = "request_failed"
        try:
            session, ephemeral = self._resolve_session(request)
            session_id = session.session_id
            deadline = (
                time.time() + request["deadlineMs"] / 1000.0
                if "deadlineMs" in request
                else None
            )
            self.registry.begin_request(session_id, request_id, deadline=deadline)
            request_started = True
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
            )
            with self._channels_lock:
                self._channels[request_id] = channel
            self.registry.transition_request(request_id, RequestState.RUNNING)
            result = executor(request, channel)
            terminal_state, terminal_reason = self._terminal_from_result(result)
            cleanup = channel.close(terminal_reason)
            if cleanup.errors:
                result.setdefault("warnings", []).extend(cleanup.errors)
            if not cleanup.lease_released:
                result = R.err(
                    "CLEANUP_INCOMPLETE",
                    "channel cleanup did not release its lease",
                    details={"errors": cleanup.errors, "requestId": request_id},
                )
                terminal_state, terminal_reason = RequestState.FAILED, "cleanup_incomplete"
            return result
        except RoutingError as error:
            terminal_reason = error.code.lower()
            return R.err(error.code, str(error), details=error.details)
        except RegistryError as error:
            terminal_reason = error.code.lower()
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            terminal_reason = "invalid_argument"
            return R.err("INVALID_ARGUMENT", str(error))
        except Exception as error:  # noqa: BLE001
            terminal_reason = "internal_error"
            return R.err("INTERNAL_ERROR", str(error), retryable=False)
        finally:
            if channel is not None:
                channel.close(terminal_reason)
                with self._channels_lock:
                    self._channels.pop(request_id, None)
            if request_started:
                try:
                    self.registry.finish_request(
                        request_id,
                        terminal_state,
                        reason=terminal_reason,
                    )
                except RegistryError:
                    pass
            if ephemeral and session_id is not None:
                try:
                    self.registry.close_session(session_id, force=True)
                except RegistryError:
                    pass

    def _resolve_session(self, request: dict[str, Any]):
        protocol = request["protocolVersion"]
        target_value = request.get("target")
        if protocol == contract.PROTOCOL_V1:
            owner = SessionOwner("legacy-runtime", f"request-{uuid.uuid4()}")
            return self.registry.bind_session(owner, host_desktop_target()), True
        if "sessionId" in request:
            session = self.registry.get_session(request["sessionId"])
            if target_value is not None:
                supplied = parse_target_descriptor(target_value)
                if supplied.target_id != session.target.target_id or supplied.kind is not session.target.kind:
                    raise ValueError("run target does not match the immutable session target")
            return session, False
        if target_value is None:
            raise ValueError("protocol v2 run requires sessionId or target")
        target = parse_target_descriptor(target_value)
        owner = SessionOwner("mcp-local", f"ephemeral-{uuid.uuid4()}")
        return self.registry.bind_session(owner, target), True

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

    def bind_session(self, value: object) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "bind input must be an object")
        try:
            unknown = set(value) - {"sessionId", "owner", "target"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
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

    def release_session(self, value: object) -> dict[str, Any]:
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
                channel.close(reason)
                self.registry.finish_request(request_id, RequestState.CANCELLED, reason=reason)
            session = self.registry.close_session(session_id, force=False)
            return R.ok({"sessionId": session.session_id, "targetId": session.target.target_id, "state": session.state.value, "reason": reason})
        except RegistryError as error:
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def cancel(self, value: object, legacy_canceller: Callable[[str], None] | None = None) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "cancel input must be an object")
        try:
            unknown = set(value) - {"requestId", "sessionId", "reason"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
            request_id = validate_safe_id(value.get("requestId"), "requestId")
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
            active_channels = len(self._channels)
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "approvalProof": "legacy-trust-boundary",
            "backendsConnected": any(item.available for item in capabilities),
            "activeChannels": active_channels,
            "registry": self.registry.snapshot(),
        }

    def capabilities(self) -> dict[str, Any]:
        capabilities = self.router.capabilities()
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "backends": [item.to_dict() for item in capabilities],
            "approvalProof": "legacy-trust-boundary",
        }

    def list_targets(self) -> dict[str, Any]:
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "targets": [target.to_dict(include_sensitive=False) for target in self.router.discover_targets()],
        }

    def shutdown(self) -> dict[str, int]:
        with self._channels_lock:
            channels = list(self._channels.values())
        for channel in channels:
            try:
                self.registry.request_cancel(channel.request_id, "server_stop")
            except RegistryError:
                pass
        for channel in channels:
            channel.close("server_stop")
        return self.registry.shutdown()


SERVICE = ComputerUseService()
