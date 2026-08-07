"""Target-scoped Chromium backend backed by the trusted Node Playwright adapter."""
from __future__ import annotations

import base64
import io
import os
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

import requests
from PIL import Image

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput, Verification
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind, parse_target_descriptor
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    BackendOperationError,
    Observation,
    VerificationEvidence,
)


_ACTIONS = (
    "observe", "click", "left_click", "right_click", "double_click",
    "type", "key", "hotkey", "scroll", "wait",
)


class CdpAdapterResponseError(RuntimeError):
    def __init__(self, code: str, message: str, *, safe_to_retry: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.safe_to_retry = safe_to_retry


@dataclass
class CdpAdapterHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    adapter_handle_id: str
    generation: str
    adapter_url: str
    token: str = field(repr=False)
    revision: str = ""
    verification: dict[str, Mapping[str, Any]] = field(default_factory=dict)
    closed: bool = False
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class CdpAdapterBackend:
    """Bridge the Python channel contract to a loopback-only Node adapter."""

    def __init__(
        self,
        *,
        adapter_url: str | None = None,
        token: str | None = None,
        timeout_s: float = 10.0,
        session: requests.Session | None = None,
    ) -> None:
        self.adapter_url = (adapter_url if adapter_url is not None else os.getenv(
            "SCIFORGE_CUA_CDP_ADAPTER_URL", ""
        )).strip().rstrip("/")
        self.token = (token if token is not None else os.getenv(
            "SCIFORGE_CUA_CDP_ADAPTER_TOKEN", ""
        )).strip()
        self.timeout_s = timeout_s
        self._config_lock = threading.RLock()
        self._pending_lock = threading.RLock()
        self._pending_opens: dict[
            str, tuple[TargetDescriptor, BackendOpenContext, str, str]
        ] = {}
        # The production backend is shared by ThreadingHTTPServer requests.
        # Use a fresh requests session per call instead of sharing mutable
        # connection state across request threads. Tests may inject a transport.
        self._session = session

    def configure(self, adapter_url: str, token: str) -> None:
        """Atomically replace routing for future handles.

        Existing handles retain their original endpoint and credential so
        reconfiguration cannot redirect their actions or cleanup.
        """
        with self._config_lock:
            self.adapter_url = adapter_url.strip().rstrip("/")
            self.token = token.strip()

    def clear_configuration_if_matches(self, adapter_url: str) -> bool:
        with self._config_lock:
            if self.adapter_url != adapter_url.strip().rstrip("/"):
                return False
            self.adapter_url = ""
            self.token = ""
            return True

    def probe(self) -> BackendCapabilities:
        reason: str | None = None
        instance_id: str | None = None
        generation: str | None = None
        target_kinds = (TargetKind.BROWSER_PAGE,)
        available = bool(self.adapter_url and self.token)
        if not available:
            reason = "CDP adapter URL/token is not configured"
        else:
            try:
                payload = self._request("GET", "/v1/capabilities")
                available = payload.get("available") is True
                instance_id = payload.get("adapterInstanceId") if isinstance(
                    payload.get("adapterInstanceId"), str
                ) else None
                generation = payload.get("generation") if isinstance(
                    payload.get("generation"), str
                ) else None
                reported_kinds = payload.get("supportedTargetKinds")
                if isinstance(reported_kinds, list):
                    parsed_kinds = tuple(
                        kind for kind in (
                            TargetKind.BROWSER_PAGE,
                            TargetKind.ELECTRON_WEBCONTENTS,
                        ) if kind.value in reported_kinds
                    )
                    if parsed_kinds:
                        target_kinds = parsed_kinds
                if available and (not instance_id or not generation):
                    available = False
                    reason = "CDP adapter omitted lifecycle identity"
                if available:
                    reason = None
                elif reason is None:
                    reason = str(payload.get("reason") or "CDP adapter unavailable")
            except Exception:  # availability probes must not break other backends
                available = False
                reason = "CDP adapter probe failed"
        return BackendCapabilities(
            backend=BackendId.BROWSER_CDP,
            available=available,
            target_kinds=target_kinds,
            actions=_ACTIONS,
            effective_isolation=IsolationLevel.HOST_APP_SCOPED,
            background_input=BackgroundInput.SEMANTIC,
            requires_host_focus=False,
            affects_user_input=False,
            uses_host_clipboard=False,
            supports_readback=("type", "key", "hotkey", "scroll"),
            lease_scope=LeaseScope.TARGET,
            max_concurrency=64 if available else 0,
            reason=reason,
            may_activate_target=True,
            instance_id=instance_id,
            generation=generation,
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        payload = self._request("GET", "/v1/targets")
        targets = payload.get("targets", [])
        if not isinstance(targets, list):
            raise RuntimeError("CDP adapter returned an invalid target list")
        return [parse_target_descriptor(item, generate_id=False) for item in targets]

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> CdpAdapterHandle:
        if target.kind not in {
            TargetKind.BROWSER_PAGE, TargetKind.ELECTRON_WEBCONTENTS,
        }:
            raise BackendOperationError(
                "CDP backend only accepts browser-page or electron-webcontents targets",
                safe_to_retry=True,
            )
        if not target.generation:
            raise BackendOperationError(
                "CDP target is missing adapter generation", code="TARGET_LOST", safe_to_retry=True,
            )
        request = {
            "requestId": context.request_id,
            "target": target.to_dict(include_sensitive=True),
        }
        adapter_url, token = self._configuration()
        with self._pending_lock:
            pending = self._pending_opens.get(context.request_id)
            if pending is not None:
                prior_target, prior_context, adapter_url, token = pending
                if prior_target != target or prior_context.request_id != context.request_id:
                    raise BackendOperationError(
                        "CDP adapter request identity changed during pending open",
                        code="REQUEST_ID_CONFLICT",
                    )
            else:
                self._pending_opens[context.request_id] = (
                    target, context, adapter_url, token,
                )
        # Open is keyed by requestId in the trusted adapter. One replay can
        # recover a response lost after handle creation without duplicating it.
        try:
            payload = self._request_at(adapter_url, token, "POST", "/v1/handles/open", request)
        except CdpAdapterResponseError as error:
            if error.safe_to_retry:
                self._forget_pending_open(context.request_id)
            raise BackendOperationError(
                str(error), code=error.code, safe_to_retry=error.safe_to_retry,
            ) from error
        except Exception:
            try:
                payload = self._request_at(adapter_url, token, "POST", "/v1/handles/open", request)
            except CdpAdapterResponseError as error:
                if error.safe_to_retry:
                    self._forget_pending_open(context.request_id)
                raise BackendOperationError(
                    str(error), code=error.code, safe_to_retry=error.safe_to_retry,
                ) from error
            except Exception as error:
                raise BackendOperationError(
                    "CDP adapter open outcome is unknown after idempotent recovery failed",
                ) from error
        handle = self._handle_from_open_payload(
            payload, target, context, adapter_url, token,
        )
        self._forget_pending_open(context.request_id)
        return handle

    def recover_open(
        self, target: TargetDescriptor, context: BackendOpenContext,
    ) -> CdpAdapterHandle:
        """Recover one uncertain open through the adapter's requestId idempotency."""
        with self._pending_lock:
            pending = self._pending_opens.get(context.request_id)
        if pending is None:
            raise BackendOperationError(
                "CDP adapter has no pending open for this request",
                code="REQUEST_NOT_FOUND",
            )
        prior_target, prior_context, adapter_url, token = pending
        if prior_target != target or prior_context.request_id != context.request_id:
            raise BackendOperationError(
                "CDP adapter pending open identity changed",
                code="REQUEST_ID_CONFLICT",
            )
        request = {
            "requestId": context.request_id,
            "target": target.to_dict(include_sensitive=True),
        }
        try:
            payload = self._request_at(
                adapter_url, token, "POST", "/v1/handles/open", request,
            )
        except CdpAdapterResponseError as error:
            if error.safe_to_retry:
                self._forget_pending_open(context.request_id)
            raise BackendOperationError(
                str(error), code=error.code, safe_to_retry=error.safe_to_retry,
            ) from error
        except Exception as error:
            raise BackendOperationError(
                "CDP adapter open recovery outcome remains unknown",
            ) from error
        handle = self._handle_from_open_payload(
            payload, target, context, adapter_url, token,
        )
        self._forget_pending_open(context.request_id)
        return handle

    @staticmethod
    def _handle_from_open_payload(
        payload: Mapping[str, Any],
        target: TargetDescriptor,
        context: BackendOpenContext,
        adapter_url: str,
        token: str,
    ) -> CdpAdapterHandle:
        handle_id = payload.get("handleId")
        if not isinstance(handle_id, str) or not handle_id:
            raise BackendOperationError("CDP adapter did not return a handleId")
        if payload.get("targetId") != target.target_id or payload.get("generation") != target.generation:
            raise BackendOperationError("CDP adapter open returned mismatched identity")
        return CdpAdapterHandle(
            target, context, handle_id, target.generation, adapter_url, token,
        )

    def _forget_pending_open(self, request_id: str) -> None:
        with self._pending_lock:
            self._pending_opens.pop(request_id, None)

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        with h.lock:
            self._ensure_open(h)
            try:
                payload = self._request_at(
                    h.adapter_url, h.token, "POST", "/v1/observe",
                    {"handleId": h.adapter_handle_id},
                )
            except CdpAdapterResponseError as error:
                if error.code in {"TARGET_LOST", "BACKEND_UNAVAILABLE"}:
                    raise BackendOperationError(str(error), code=error.code) from error
                raise
            if payload.get("targetId") != h.target.target_id:
                raise BackendOperationError("CDP adapter observed a different target")
            if payload.get("generation") != h.generation:
                raise BackendOperationError("CDP adapter generation changed", code="TARGET_LOST")
            revision = payload.get("revision")
            encoded = payload.get("imageBase64")
            if not isinstance(revision, str) or not isinstance(encoded, str):
                raise RuntimeError("CDP adapter returned an invalid observation")
            image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))).convert("RGB")
            h.revision = revision
            metadata = payload.get("metadata")
            return Observation(
                target_id=h.target.target_id,
                revision=revision,
                image=image,
                backend=BackendId.BROWSER_CDP.value,
                metadata=metadata if isinstance(metadata, Mapping) else {},
            )

    def perform(
        self,
        handle: object,
        action: Mapping[str, Any],
        expected_revision: str,
    ) -> ActionReceipt:
        h = self._handle(handle)
        action_name = str(action.get("action") or "").lower()
        if action_name not in _ACTIONS:
            raise BackendOperationError(f"unsupported CDP action: {action_name}")
        if h.context.cancellation.is_set():
            raise BackendOperationError("request was cancelled before CDP action")
        action_id = f"action-{uuid.uuid4()}"
        try:
            with h.lock:
                self._ensure_open(h)
                payload = self._request_at(h.adapter_url, h.token, "POST", "/v1/action", {
                    "handleId": h.adapter_handle_id,
                    "actionId": action_id,
                    "expectedRevision": expected_revision,
                    "action": dict(action),
                })
        except BackendOperationError:
            raise
        except CdpAdapterResponseError as error:
            if error.code == "TARGET_LOST":
                raise BackendOperationError(
                    str(error), code="TARGET_LOST", may_have_taken_effect=True,
                ) from error
            raise BackendOperationError(
                f"CDP adapter action failed: {error}", may_have_taken_effect=True,
            ) from error
        except Exception as error:
            raise BackendOperationError(
                f"CDP adapter action failed: {error}", may_have_taken_effect=True,
            ) from error
        if payload.get("targetId") != h.target.target_id:
            raise BackendOperationError("CDP adapter action returned a different target", may_have_taken_effect=True)
        if payload.get("generation") != h.generation:
            raise BackendOperationError(
                "CDP adapter generation changed during action",
                code="TARGET_LOST",
                may_have_taken_effect=True,
            )
        verification = payload.get("verification")
        if not isinstance(verification, Mapping):
            raise BackendOperationError("CDP adapter omitted verification", may_have_taken_effect=True)
        h.verification[action_id] = verification
        return ActionReceipt(
            action_id=action_id,
            target_id=h.target.target_id,
            revision_before=expected_revision,
            committed=payload.get("committed") is True,
            may_have_taken_effect=payload.get("mayHaveTakenEffect") is True,
            backend_evidence={"adapter": "playwright-core"},
        )

    def verify(
        self,
        handle: object,
        action: Mapping[str, Any],
        receipt: ActionReceipt,
        before: Observation,
    ) -> VerificationEvidence:
        h = self._handle(handle)
        evidence = h.verification.pop(receipt.action_id, None)
        if evidence is None:
            raise BackendOperationError("CDP verification evidence is unavailable", may_have_taken_effect=True)
        try:
            status = Verification(str(evidence.get("status")))
        except ValueError as error:
            raise BackendOperationError("CDP adapter returned invalid verification", may_have_taken_effect=True) from error
        revision = evidence.get("revisionAfter")
        details = evidence.get("details")
        return VerificationEvidence(
            status=status,
            target_id=h.target.target_id,
            revision_after=revision if isinstance(revision, str) else None,
            details=details if isinstance(details, Mapping) else {},
        )

    def cancel(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        h.context.cancellation.set()
        if not h.closed:
            self._request_at(h.adapter_url, h.token, "POST", "/v1/handles/cancel", {
                "handleId": h.adapter_handle_id, "reason": reason,
            })

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        with h.lock:
            if h.closed:
                return
            self._request_at(h.adapter_url, h.token, "POST", "/v1/handles/close", {
                "handleId": h.adapter_handle_id, "reason": reason,
            })
            h.closed = True

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        adapter_url, token = self._configuration()
        return self._request_at(adapter_url, token, method, path, body)

    def _configuration(self) -> tuple[str, str]:
        with self._config_lock:
            return self.adapter_url, self.token

    def _request_at(
        self,
        adapter_url: str,
        token: str,
        method: str,
        path: str,
        body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not adapter_url or not token:
            raise RuntimeError("CDP adapter is not configured")
        sender = self._session.request if self._session is not None else requests.request
        try:
            response = sender(
                method,
                f"{adapter_url}{path}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=dict(body) if body is not None else None,
                timeout=self.timeout_s,
            )
        except Exception as error:
            raise RuntimeError("CDP adapter transport is unavailable") from error
        try:
            payload = response.json()
        except Exception as error:
            raise RuntimeError(f"CDP adapter returned non-JSON HTTP {response.status_code}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("CDP adapter returned a non-object response")
        if response.status_code >= 400 or payload.get("ok") is False:
            error_value = payload.get("error")
            message = error_value.get("message") if isinstance(error_value, dict) else None
            code = error_value.get("code") if isinstance(error_value, dict) else None
            safe_to_retry = (
                error_value.get("safeToRetry") is True
                if isinstance(error_value, dict) else False
            )
            raise CdpAdapterResponseError(
                str(code or "ADAPTER_ERROR"),
                str(message or f"CDP adapter HTTP {response.status_code}"),
                safe_to_retry=safe_to_retry,
            )
        data = payload.get("data", payload)
        if not isinstance(data, dict):
            raise RuntimeError("CDP adapter response data must be an object")
        return data

    @staticmethod
    def _handle(handle: object) -> CdpAdapterHandle:
        if not isinstance(handle, CdpAdapterHandle):
            raise TypeError("invalid CDP adapter handle")
        return handle

    @staticmethod
    def _ensure_open(handle: CdpAdapterHandle) -> None:
        if handle.closed:
            raise BackendOperationError("CDP adapter handle is closed")
