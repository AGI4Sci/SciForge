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


@dataclass
class CdpAdapterHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    adapter_handle_id: str
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
        # The production backend is shared by ThreadingHTTPServer requests.
        # Use a fresh requests session per call instead of sharing mutable
        # connection state across request threads. Tests may inject a transport.
        self._session = session

    def probe(self) -> BackendCapabilities:
        reason: str | None = None
        available = bool(self.adapter_url and self.token)
        if not available:
            reason = "CDP adapter URL/token is not configured"
        else:
            try:
                payload = self._request("GET", "/v1/capabilities")
                available = payload.get("available") is True
                reason = None if available else str(payload.get("reason") or "CDP adapter unavailable")
            except Exception as error:  # availability probes must not break other backends
                available = False
                reason = f"CDP adapter probe failed: {error}"
        return BackendCapabilities(
            backend=BackendId.BROWSER_CDP,
            available=available,
            target_kinds=(TargetKind.BROWSER_PAGE,),
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
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        payload = self._request("GET", "/v1/targets")
        targets = payload.get("targets", [])
        if not isinstance(targets, list):
            raise RuntimeError("CDP adapter returned an invalid target list")
        return [parse_target_descriptor(item, generate_id=False) for item in targets]

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> CdpAdapterHandle:
        if target.kind is not TargetKind.BROWSER_PAGE:
            raise BackendOperationError("CDP backend only accepts browser-page targets")
        payload = self._request("POST", "/v1/handles/open", {
            "requestId": context.request_id,
            "target": target.to_dict(include_sensitive=True),
        })
        handle_id = payload.get("handleId")
        if not isinstance(handle_id, str) or not handle_id:
            raise RuntimeError("CDP adapter did not return a handleId")
        return CdpAdapterHandle(target, context, handle_id)

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        with h.lock:
            self._ensure_open(h)
            payload = self._request("POST", "/v1/observe", {"handleId": h.adapter_handle_id})
            if payload.get("targetId") != h.target.target_id:
                raise BackendOperationError("CDP adapter observed a different target")
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
                payload = self._request("POST", "/v1/action", {
                    "handleId": h.adapter_handle_id,
                    "actionId": action_id,
                    "expectedRevision": expected_revision,
                    "action": dict(action),
                })
        except BackendOperationError:
            raise
        except Exception as error:
            raise BackendOperationError(
                f"CDP adapter action failed: {error}", may_have_taken_effect=True,
            ) from error
        if payload.get("targetId") != h.target.target_id:
            raise BackendOperationError("CDP adapter action returned a different target", may_have_taken_effect=True)
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
            self._request("POST", "/v1/handles/cancel", {
                "handleId": h.adapter_handle_id, "reason": reason,
            })

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        with h.lock:
            if h.closed:
                return
            self._request("POST", "/v1/handles/close", {
                "handleId": h.adapter_handle_id, "reason": reason,
            })
            h.closed = True

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if not self.adapter_url or not self.token:
            raise RuntimeError("CDP adapter is not configured")
        sender = self._session.request if self._session is not None else requests.request
        response = sender(
            method,
            f"{self.adapter_url}{path}",
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            json=dict(body) if body is not None else None,
            timeout=self.timeout_s,
        )
        try:
            payload = response.json()
        except Exception as error:
            raise RuntimeError(f"CDP adapter returned non-JSON HTTP {response.status_code}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("CDP adapter returned a non-object response")
        if response.status_code >= 400 or payload.get("ok") is False:
            message = payload.get("error", {}).get("message") if isinstance(payload.get("error"), dict) else None
            raise RuntimeError(str(message or f"CDP adapter HTTP {response.status_code}"))
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
