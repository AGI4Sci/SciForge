"""Fail-closed controller client for a dedicated remote Windows VM worker.

This module does not ship a guest worker or provision infrastructure.  Without
an explicit HTTPS/mTLS configuration it remains unavailable.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import urlparse, urlunparse

import requests
from PIL import Image

from cua.capabilities import Verification
from cua.target import (
    TargetDescriptor, TargetKind, TargetOwnership, parse_target_descriptor,
    validate_safe_id,
)
from driver.backend import (
    ActionReceipt, BackendOpenContext, BackendOperationError, Observation,
    VerificationEvidence,
)
from driver.backends.isolated_desktop import (
    ISOLATED_DESKTOP_UNAVAILABLE, IsolatedProviderStatus,
)


REMOTE_WORKER_MANAGED_UNAVAILABLE = "REMOTE_WORKER_MANAGED_UNAVAILABLE"
_FIXED_PATHS = frozenset({
    "/v1/status", "/v1/handles/connect", "/v1/observe", "/v1/actions",
    "/v1/verify", "/v1/handles/cancel", "/v1/handles/close",
})
_MAX_IMAGE_PIXELS = 33_554_432
_SAFE_REVISION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")


class RemoteWorkerTransportError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, repr=False)
class RemoteWorkerConfig:
    endpoint: str = ""
    environment_id: str = ""
    ca_cert: str = ""
    client_cert: str = ""
    client_key: str = ""
    timeout_s: float = 10.0
    max_response_bytes: int = 12_582_912

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "RemoteWorkerConfig":
        values = os.environ if env is None else env
        try:
            timeout_s = float(values.get("SCIFORGE_CUA_REMOTE_WORKER_TIMEOUT_S", "10"))
        except ValueError:
            timeout_s = -1
        try:
            max_response_bytes = int(values.get(
                "SCIFORGE_CUA_REMOTE_WORKER_MAX_RESPONSE_BYTES", "12582912",
            ))
        except ValueError:
            max_response_bytes = -1
        return cls(
            endpoint=values.get("SCIFORGE_CUA_REMOTE_WORKER_URL", "").strip(),
            environment_id=values.get(
                "SCIFORGE_CUA_REMOTE_WORKER_ENVIRONMENT_ID", "",
            ).strip(),
            ca_cert=values.get("SCIFORGE_CUA_REMOTE_WORKER_CA_CERT", "").strip(),
            client_cert=values.get("SCIFORGE_CUA_REMOTE_WORKER_CLIENT_CERT", "").strip(),
            client_key=values.get("SCIFORGE_CUA_REMOTE_WORKER_CLIENT_KEY", "").strip(),
            timeout_s=timeout_s,
            max_response_bytes=max_response_bytes,
        )

    @property
    def configured(self) -> bool:
        return any((
            self.endpoint, self.environment_id, self.ca_cert,
            self.client_cert, self.client_key,
        ))

    def validated_endpoint(self) -> str:
        if not self.configured:
            raise ValueError("remote Windows worker is not configured")
        missing = [
            name for name, value in (
                ("URL", self.endpoint), ("ENVIRONMENT_ID", self.environment_id),
                ("CA_CERT", self.ca_cert), ("CLIENT_CERT", self.client_cert),
                ("CLIENT_KEY", self.client_key),
            ) if not value
        ]
        if missing:
            raise ValueError(f"remote Windows worker configuration is incomplete: {', '.join(missing)}")
        validate_safe_id(self.environment_id, "remote worker environment ID")
        parsed = urlparse(self.endpoint)
        if (
            parsed.scheme != "https" or not parsed.netloc or not parsed.hostname
            or parsed.username or parsed.password or parsed.params
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")
        ):
            raise ValueError("remote Windows worker URL must be an HTTPS origin without credentials or extra components")
        try:
            _ = parsed.port
        except ValueError as error:
            raise ValueError("remote Windows worker URL has an invalid port") from error
        for name, path in (
            ("CA certificate", self.ca_cert),
            ("client certificate", self.client_cert),
            ("client key", self.client_key),
        ):
            if not Path(path).is_file():
                raise ValueError(f"remote Windows worker {name} file is unavailable")
        if not 0.1 <= self.timeout_s <= 120:
            raise ValueError("remote Windows worker timeout must be between 0.1 and 120 seconds")
        if not 1_024 <= self.max_response_bytes <= 64 * 1024 * 1024:
            raise ValueError("remote Windows worker response limit must be between 1 KiB and 64 MiB")
        return urlunparse(("https", parsed.netloc, "", "", "", ""))


class RemoteWorkerTransport(Protocol):
    def request(
        self, method: str, path: str, body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]: ...


class RequestsRemoteWorkerTransport:
    def __init__(
        self,
        config: RemoteWorkerConfig,
        *,
        sender: Callable[..., Any] = requests.request,
    ) -> None:
        self.config = config
        self.endpoint = config.validated_endpoint()
        self._sender = sender

    def request(
        self, method: str, path: str, body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if path not in _FIXED_PATHS or method not in {"GET", "POST"}:
            raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", "remote worker route is not allowlisted")
        response = None
        try:
            response = self._sender(
                method,
                f"{self.endpoint}{path}",
                json=dict(body) if body is not None else None,
                timeout=(self.config.timeout_s, self.config.timeout_s),
                verify=self.config.ca_cert,
                cert=(self.config.client_cert, self.config.client_key),
                allow_redirects=False,
                stream=True,
                headers={"Accept": "application/json", "Cache-Control": "no-store"},
            )
            if 300 <= response.status_code < 400:
                raise RemoteWorkerTransportError("REMOTE_WORKER_REDIRECT", "remote worker redirects are forbidden")
            raw = bytearray()
            for chunk in response.iter_content(chunk_size=65_536):
                raw.extend(chunk)
                if len(raw) > self.config.max_response_bytes:
                    raise RemoteWorkerTransportError("REMOTE_WORKER_RESPONSE_TOO_LARGE", "remote worker response exceeds the configured limit")
            try:
                envelope = json.loads(bytes(raw).decode("utf-8"))
            except (UnicodeError, ValueError) as error:
                raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", "remote worker response is not valid JSON") from error
            if not isinstance(envelope, dict):
                raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", "remote worker response must be an object")
            if response.status_code >= 400 or envelope.get("ok") is False:
                error_value = envelope.get("error")
                code = error_value.get("code") if isinstance(error_value, Mapping) else None
                message = error_value.get("message") if isinstance(error_value, Mapping) else None
                raise RemoteWorkerTransportError(
                    str(code or "REMOTE_WORKER_ERROR"),
                    _safe_message(message or "remote worker rejected the request"),
                )
            data = envelope.get("data")
            if envelope.get("ok") is not True or not isinstance(data, dict):
                raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", "remote worker success envelope is invalid")
            return data
        except RemoteWorkerTransportError:
            raise
        except requests.RequestException as error:
            raise RemoteWorkerTransportError("REMOTE_WORKER_UNAVAILABLE", "remote worker transport failed") from error
        finally:
            if response is not None:
                response.close()


@dataclass(frozen=True)
class RemoteWorkerIdentity:
    environment_id: str
    machine_id: str
    boot_id: str
    interactive_session_id: str
    generation: str

    @classmethod
    def parse(cls, value: object) -> "RemoteWorkerIdentity":
        if not isinstance(value, Mapping) or set(value) != {
            "environmentId", "machineId", "bootId", "interactiveSessionId", "generation",
        }:
            raise RemoteWorkerTransportError("REMOTE_WORKER_IDENTITY_INVALID", "remote worker identity shape is invalid")
        try:
            return cls(*(
                validate_safe_id(value[field], f"remote worker {field}")
                for field in ("environmentId", "machineId", "bootId", "interactiveSessionId", "generation")
            ))
        except ValueError as error:
            raise RemoteWorkerTransportError(
                "REMOTE_WORKER_IDENTITY_INVALID", "remote worker identity value is invalid",
            ) from error

    @property
    def target_generation(self) -> str:
        digest = hashlib.sha256("\0".join((
            self.environment_id, self.machine_id, self.boot_id,
            self.interactive_session_id, self.generation,
        )).encode()).hexdigest()
        return f"remote:{digest}"

    def to_dict(self) -> dict[str, str]:
        return {
            "environmentId": self.environment_id,
            "machineId": self.machine_id,
            "bootId": self.boot_id,
            "interactiveSessionId": self.interactive_session_id,
            "generation": self.generation,
        }


@dataclass(repr=False)
class RemoteWorkerHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    identity: RemoteWorkerIdentity
    worker_handle_id: str
    capability_token: str = field(repr=False)
    closed: bool = False
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class RemoteWindowsWorkerProvider:
    """Attached-only P6a provider client. Managed lifecycle remains unavailable."""

    def __init__(
        self,
        config: RemoteWorkerConfig | None = None,
        transport: RemoteWorkerTransport | None = None,
    ) -> None:
        self.config = config or RemoteWorkerConfig.from_env()
        self._transport = transport
        self._identity: RemoteWorkerIdentity | None = None
        self._lock = threading.RLock()
        self._probe_cache: tuple[float, IsolatedProviderStatus] | None = None

    def probe(self) -> IsolatedProviderStatus:
        with self._lock:
            now = time.monotonic()
            if self._probe_cache is not None and self._probe_cache[0] > now:
                return self._probe_cache[1]
            try:
                identity, max_concurrency = self._status()
                self._identity = identity
                status = IsolatedProviderStatus(
                    available=True, max_concurrency=max_concurrency,
                )
                cache_seconds = 5.0
            except Exception as error:
                status = IsolatedProviderStatus(
                    available=False,
                    reason=f"{ISOLATED_DESKTOP_UNAVAILABLE}: {_safe_message(error)}",
                )
                cache_seconds = 10.0
            self._probe_cache = (now + cache_seconds, status)
            return status

    def discover_environments(
        self, filters: Mapping[str, Any] | None = None,
    ) -> list[TargetDescriptor]:
        with self._lock:
            identity = self._identity
        if identity is None:
            identity, _ = self._status()
            with self._lock:
                self._identity = identity
        return [self._target(identity)]

    def provision(self, spec: Mapping[str, Any]) -> TargetDescriptor:
        raise BackendOperationError(
            "P6a remote worker supports attached environments only",
            code=REMOTE_WORKER_MANAGED_UNAVAILABLE,
        )

    def connect(self, target: TargetDescriptor, context: BackendOpenContext) -> RemoteWorkerHandle:
        self._validate_target(target)
        identity, _ = self._status()
        self._match_target_identity(target, identity)
        payload = self._request("POST", "/v1/handles/connect", {
            "requestId": context.request_id,
            "environmentId": identity.environment_id,
            "expectedIdentity": identity.to_dict(),
        })
        self._assert_identity(payload, identity)
        handle_id = _safe_id(payload.get("handleId"), "remote worker handleId")
        token = payload.get("capabilityToken")
        if not isinstance(token, str) or not 16 <= len(token) <= 1_024 or any(c in token for c in "\r\n\0"):
            raise BackendOperationError("remote worker capability token is invalid", code="REMOTE_WORKER_PROTOCOL_ERROR")
        return RemoteWorkerHandle(target, context, identity, handle_id, token)

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        try:
            with h.lock:
                payload = self._request("POST", "/v1/observe", self._handle_body(h))
        except RemoteWorkerTransportError as error:
            raise BackendOperationError(
                "remote worker observation failed", code=error.code,
            ) from error
        with h.lock:
            self._assert_identity(payload, h.identity)
            revision = _revision(payload.get("revision"))
            encoded = payload.get("imageBase64")
            if not isinstance(encoded, str):
                raise BackendOperationError("remote worker observation omitted imageBase64", code="REMOTE_WORKER_PROTOCOL_ERROR")
            try:
                raw = base64.b64decode(encoded, validate=True)
                source = Image.open(io.BytesIO(raw))
                if source.width * source.height > _MAX_IMAGE_PIXELS:
                    raise ValueError("image dimensions exceed the safety limit")
                image = source.convert("RGB")
                image.load()
            except Exception as error:
                raise BackendOperationError("remote worker image is invalid", code="REMOTE_WORKER_PROTOCOL_ERROR") from error
            metadata = payload.get("metadata")
            return Observation(
                target_id=h.target.target_id,
                revision=revision,
                image=image,
                backend="isolated-desktop",
                metadata=dict(metadata) if isinstance(metadata, Mapping) else {},
            )

    def perform(
        self, handle: object, action: Mapping[str, Any], expected_revision: str,
    ) -> ActionReceipt:
        h = self._handle(handle)
        if h.context.cancellation.is_set():
            raise BackendOperationError("request was cancelled before remote worker action")
        action_id = f"action-{uuid.uuid4()}"
        try:
            with h.lock:
                payload = self._request("POST", "/v1/actions", {
                    **self._handle_body(h),
                    "actionId": action_id,
                    "expectedRevision": expected_revision,
                    "action": dict(action),
                })
        except Exception as error:
            raise BackendOperationError(
                "remote worker action outcome is unknown",
                code="ACTION_OUTCOME_UNKNOWN",
                may_have_taken_effect=True,
            ) from error
        try:
            self._assert_identity(payload, h.identity)
            if payload.get("actionId") != action_id or payload.get("revisionBefore") != expected_revision:
                raise ValueError("receipt identity mismatch")
            if not isinstance(payload.get("committed"), bool) or not isinstance(payload.get("mayHaveTakenEffect"), bool):
                raise ValueError("receipt flags are invalid")
        except Exception as error:
            raise BackendOperationError(
                "remote worker action receipt is invalid",
                code="ACTION_OUTCOME_UNKNOWN",
                may_have_taken_effect=True,
            ) from error
        return ActionReceipt(
            action_id=action_id,
            target_id=h.target.target_id,
            revision_before=expected_revision,
            committed=payload["committed"],
            may_have_taken_effect=payload["mayHaveTakenEffect"],
            backend_evidence={"workerGeneration": h.identity.generation},
        )

    def verify(
        self,
        handle: object,
        action: Mapping[str, Any],
        receipt: ActionReceipt,
        before: Observation,
    ) -> VerificationEvidence:
        h = self._handle(handle)
        try:
            with h.lock:
                payload = self._request("POST", "/v1/verify", {
                    **self._handle_body(h),
                    "actionId": receipt.action_id,
                    "revisionBefore": before.revision,
                    "action": dict(action),
                })
        except Exception as error:
            raise BackendOperationError(
                "remote worker verification is unavailable",
                code="ACTION_OUTCOME_UNKNOWN",
                may_have_taken_effect=receipt.may_have_taken_effect,
            ) from error
        self._assert_identity(payload, h.identity)
        try:
            status = Verification(payload.get("status"))
        except ValueError as error:
            raise BackendOperationError("remote worker verification status is invalid", code="REMOTE_WORKER_PROTOCOL_ERROR", may_have_taken_effect=receipt.may_have_taken_effect) from error
        revision_after = payload.get("revisionAfter")
        if revision_after is not None:
            revision_after = _revision(revision_after)
        details = payload.get("details")
        return VerificationEvidence(
            status=status,
            target_id=h.target.target_id,
            revision_after=revision_after,
            details=dict(details) if isinstance(details, Mapping) else {},
        )

    def cancel(self, handle: object, reason: str) -> None:
        h = self._handle(handle, allow_closed=True)
        h.context.cancellation.set()
        # Cancellation must be able to cross the transport while an action is
        # blocked waiting for its response. Do not take the per-handle operation
        # lock here; the capability token identifies the same live handle.
        if not h.closed:
            payload = self._request("POST", "/v1/handles/cancel", {
                **self._handle_body(h), "reason": _safe_message(reason),
            })
            self._assert_identity(payload, h.identity)

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle, allow_closed=True)
        with h.lock:
            if h.closed:
                return
            payload = self._request("POST", "/v1/handles/close", {
                **self._handle_body(h), "reason": _safe_message(reason),
            })
            self._assert_identity(payload, h.identity)
            h.closed = True

    def destroy(self, target: TargetDescriptor, reason: str) -> None:
        raise BackendOperationError(
            "P6a remote worker has no managed infrastructure control plane",
            code=REMOTE_WORKER_MANAGED_UNAVAILABLE,
        )

    def _status(self) -> tuple[RemoteWorkerIdentity, int]:
        self.config.validated_endpoint()
        payload = self._request("GET", "/v1/status")
        if payload.get("ready") is not True:
            raise RemoteWorkerTransportError("REMOTE_WORKER_NOT_READY", "remote Windows worker is not ready")
        identity = RemoteWorkerIdentity.parse(payload.get("identity"))
        if identity.environment_id != self.config.environment_id:
            raise RemoteWorkerTransportError("REMOTE_WORKER_IDENTITY_MISMATCH", "remote worker environment identity does not match configuration")
        max_concurrency = payload.get("maxConcurrency", 1)
        if not isinstance(max_concurrency, int) or isinstance(max_concurrency, bool) or max_concurrency != 1:
            raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", "P6a worker must report maxConcurrency=1")
        return identity, max_concurrency

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if self._transport is None:
            self._transport = RequestsRemoteWorkerTransport(self.config)
        return self._transport.request(method, path, body)

    def _target(self, identity: RemoteWorkerIdentity) -> TargetDescriptor:
        digest = hashlib.sha256(identity.environment_id.encode()).hexdigest()[:32]
        return parse_target_descriptor({
            "targetId": f"isolated-remote-{digest}",
            "kind": "isolated-desktop",
            "ownership": "attached",
            "locator": {"isolatedEnvironmentId": identity.environment_id},
            "backendHint": "isolated-desktop",
            "generation": identity.target_generation,
            "metadata": {"processName": "remote-windows-worker"},
        }, generate_id=False)

    def _validate_target(self, target: TargetDescriptor) -> None:
        if target.kind is not TargetKind.ISOLATED_DESKTOP or target.ownership is not TargetOwnership.ATTACHED:
            raise BackendOperationError("P6a remote worker accepts attached isolated-desktop targets only")
        if target.locator.get("isolatedEnvironmentId") != self.config.environment_id:
            raise BackendOperationError("remote worker target environment does not match configuration", code="TARGET_LOST")

    @staticmethod
    def _match_target_identity(target: TargetDescriptor, identity: RemoteWorkerIdentity) -> None:
        if target.generation != identity.target_generation:
            raise BackendOperationError("remote worker boot/session/generation changed", code="TARGET_LOST")

    @staticmethod
    def _assert_identity(payload: Mapping[str, Any], expected: RemoteWorkerIdentity) -> None:
        try:
            actual = RemoteWorkerIdentity.parse(payload.get("identity"))
        except (RemoteWorkerTransportError, ValueError) as error:
            raise BackendOperationError("remote worker identity is invalid", code="TARGET_LOST") from error
        if actual != expected:
            raise BackendOperationError("remote worker identity changed", code="TARGET_LOST")

    @staticmethod
    def _handle_body(handle: RemoteWorkerHandle) -> dict[str, Any]:
        return {
            "environmentId": handle.identity.environment_id,
            "handleId": handle.worker_handle_id,
            "capabilityToken": handle.capability_token,
            "expectedIdentity": handle.identity.to_dict(),
        }

    @staticmethod
    def _handle(handle: object, *, allow_closed: bool = False) -> RemoteWorkerHandle:
        if not isinstance(handle, RemoteWorkerHandle):
            raise TypeError("invalid remote worker handle")
        if handle.closed and not allow_closed:
            raise BackendOperationError("remote worker handle is closed", code="TARGET_LOST")
        return handle


def _safe_id(value: object, field_name: str) -> str:
    try:
        return validate_safe_id(value, field_name)
    except ValueError as error:
        raise RemoteWorkerTransportError("REMOTE_WORKER_PROTOCOL_ERROR", str(error)) from error


def _revision(value: object) -> str:
    if not isinstance(value, str) or not _SAFE_REVISION.fullmatch(value):
        raise BackendOperationError("remote worker revision is invalid", code="REMOTE_WORKER_PROTOCOL_ERROR")
    return value


def _safe_message(value: object) -> str:
    return re.sub(r"[\r\n\0]+", " ", str(value)).strip()[:512] or "remote worker error"
