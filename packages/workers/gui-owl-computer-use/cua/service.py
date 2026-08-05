"""Process-level Computer Use service container.

P1 centralizes protocol validation and registry authority.  Concrete channels
and backends remain disconnected until P2, so v2 execution fails closed.
"""
from __future__ import annotations

from typing import Any, Callable

from . import contract
from . import result as R
from .session_registry import RegistryError, SessionOwner, SessionRegistry
from .target import parse_target_descriptor, validate_safe_id


LegacyExecutor = Callable[[dict[str, Any]], dict[str, Any]]
LegacyCanceller = Callable[[str], None]


class ComputerUseService:
    def __init__(self, registry: SessionRegistry | None = None) -> None:
        self.registry = registry or SessionRegistry()

    def run(self, value: object, legacy_executor: LegacyExecutor) -> dict[str, Any]:
        try:
            request = contract.normalize_run_input(value)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))
        if request["protocolVersion"] == contract.PROTOCOL_V2:
            return contract.v2_backend_unavailable(request)
        return legacy_executor(request)

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
            session = self.registry.bind_session(
                owner, target, session_id=value.get("sessionId")
            )
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
            session = self.registry.close_session(session_id, force=force)
            return R.ok({
                "sessionId": session.session_id,
                "targetId": session.target.target_id,
                "state": session.state.value,
                "reason": reason,
            })
        except RegistryError as error:
            return R.err(error.code, str(error), details=error.details)
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def cancel(self, value: object, legacy_canceller: LegacyCanceller) -> dict[str, Any]:
        if not isinstance(value, dict):
            return R.err("INVALID_ARGUMENT", "cancel input must be an object")
        try:
            unknown = set(value) - {"requestId", "sessionId", "reason"}
            if unknown:
                raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
            request_id = validate_safe_id(value.get("requestId"), "requestId")
            request = self.registry.request_cancel(
                request_id, str(value.get("reason", "user_stop"))
            )
            return R.ok({
                "requestId": request_id,
                "status": "stopped" if request.state.value in {
                    "completed", "failed", "cancelled", "timed-out", "target-lost"
                } else "accepted",
                "state": request.state.value,
            })
        except RegistryError as error:
            if error.code != "REQUEST_NOT_FOUND":
                return R.err(error.code, str(error), details=error.details)
            legacy_canceller(request_id)
            return R.ok({
                "requestId": request_id,
                "status": "accepted",
                "state": "legacy-cancel-pending",
            })
        except ValueError as error:
            return R.err("INVALID_ARGUMENT", str(error))

    def status(self) -> dict[str, Any]:
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "approvalProof": "legacy-trust-boundary",
            "backendsConnected": False,
            "registry": self.registry.snapshot(),
        }

    def capabilities(self) -> dict[str, Any]:
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "backends": [],
            "reason": "backend capability probes are connected in P2/P3",
            "approvalProof": "legacy-trust-boundary",
        }

    def list_targets(self) -> dict[str, Any]:
        return {
            "protocolVersion": contract.PROTOCOL_V2,
            "targets": [],
            "reason": "target providers are connected in P2/P3",
        }

    def shutdown(self) -> dict[str, int]:
        return self.registry.shutdown()


SERVICE = ComputerUseService()
