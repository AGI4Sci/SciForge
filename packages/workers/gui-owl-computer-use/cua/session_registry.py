"""Thread-safe session/request/target-lease registry for Computer Use v2.

P1 establishes identity and atomic ownership rules without opening any real
desktop backend.  Backend handles and cleanup hooks are introduced in P2.
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Callable

from .target import TargetDescriptor, validate_safe_id


class SessionState(str, Enum):
    READY = "ready"
    BUSY = "busy"
    CLOSING = "closing"
    CLOSED = "closed"
    FAILED = "failed"


class RequestState(str, Enum):
    RECEIVED = "received"
    ROUTING = "routing"
    RUNNING = "running"
    VERIFYING = "verifying"
    CANCELLING = "cancelling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed-out"
    TARGET_LOST = "target-lost"


TERMINAL_REQUEST_STATES = {
    RequestState.COMPLETED,
    RequestState.FAILED,
    RequestState.CANCELLED,
    RequestState.TIMED_OUT,
    RequestState.TARGET_LOST,
}

ALLOWED_REQUEST_TRANSITIONS = {
    RequestState.RECEIVED: {RequestState.ROUTING, RequestState.CANCELLING},
    RequestState.ROUTING: {RequestState.RUNNING, RequestState.CANCELLING},
    RequestState.RUNNING: {RequestState.VERIFYING, RequestState.CANCELLING},
    RequestState.VERIFYING: {RequestState.RUNNING, RequestState.CANCELLING},
    RequestState.CANCELLING: set(),
}


class LeaseScope(str, Enum):
    TARGET = "target"
    ENVIRONMENT = "environment"
    PROCESS_GLOBAL = "process-global"


class LeaseMode(str, Enum):
    EXCLUSIVE = "exclusive"


class LeaseState(str, Enum):
    ACTIVE = "active"
    CANCELLING = "cancelling"
    RELEASING = "releasing"
    RELEASED = "released"


@dataclass(frozen=True)
class SessionOwner:
    runtime_id: str
    thread_id: str


@dataclass
class SessionRecord:
    session_id: str
    owner: SessionOwner
    target: TargetDescriptor
    state: SessionState = SessionState.READY
    active_request_id: str | None = None
    created_at: float = field(default_factory=time.time)
    last_used_at: float = field(default_factory=time.time)


@dataclass
class RequestRecord:
    request_id: str
    session_id: str
    target_id: str
    state: RequestState = RequestState.RECEIVED
    lease_id: str | None = None
    deadline: float | None = None
    cancel_reason: str | None = None
    cancellation: threading.Event = field(default_factory=threading.Event, repr=False)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


@dataclass
class TargetLease:
    lease_id: str
    session_id: str
    request_id: str
    target_id: str
    backend: str
    scope: LeaseScope
    scope_key: str
    mode: LeaseMode = LeaseMode.EXCLUSIVE
    state: LeaseState = LeaseState.ACTIVE
    in_flight_actions: int = 0
    acquired_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    expires_at: float | None = None
    release_reason: str | None = None
    suspected_stale: bool = False


class RegistryError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class SessionRegistry:
    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.time,
        tombstone_limit: int = 256,
    ) -> None:
        self._clock = clock
        self._tombstone_limit = max(1, tombstone_limit)
        self._lock = threading.RLock()
        self._sessions: dict[str, SessionRecord] = {}
        self._requests: dict[str, RequestRecord] = {}
        self._leases_by_id: dict[str, TargetLease] = {}
        self._lease_ids_by_scope_key: dict[str, str] = {}
        self._released_leases: "OrderedDict[str, TargetLease]" = OrderedDict()
        self._tombstones: "OrderedDict[str, RequestRecord]" = OrderedDict()
        self._closed = False
        self._generation = 0

    def bind_session(
        self,
        owner: SessionOwner,
        target: TargetDescriptor,
        *,
        session_id: str | None = None,
    ) -> SessionRecord:
        sid = validate_safe_id(session_id, "sessionId") if session_id else f"session-{uuid.uuid4()}"
        validate_safe_id(owner.runtime_id, "owner.runtimeId")
        validate_safe_id(owner.thread_id, "owner.threadId")
        with self._lock:
            self._ensure_open()
            if sid in self._sessions:
                raise RegistryError("SESSION_ID_CONFLICT", f"session {sid} already exists")
            now = self._clock()
            record = SessionRecord(
                session_id=sid,
                owner=owner,
                target=target,
                created_at=now,
                last_used_at=now,
            )
            self._sessions[sid] = record
            self._bump()
            return self._copy_session(record)

    def begin_request(
        self,
        session_id: str,
        request_id: str,
        *,
        owner: SessionOwner | None = None,
        deadline: float | None = None,
    ) -> RequestRecord:
        validate_safe_id(request_id, "requestId")
        with self._lock:
            self._ensure_open()
            if request_id in self._requests or request_id in self._tombstones:
                raise RegistryError("REQUEST_ID_CONFLICT", f"request {request_id} already exists")
            session = self._require_session(session_id)
            self._check_owner(session, owner)
            if session.state is not SessionState.READY or session.active_request_id is not None:
                raise RegistryError(
                    "SESSION_BUSY",
                    f"session {session_id} already has an active request",
                    details={"activeRequestId": session.active_request_id},
                )
            now = self._clock()
            record = RequestRecord(
                request_id=request_id,
                session_id=session_id,
                target_id=session.target.target_id,
                deadline=deadline,
                created_at=now,
                updated_at=now,
            )
            self._requests[request_id] = record
            session.active_request_id = request_id
            session.state = SessionState.BUSY
            session.last_used_at = now
            self._bump()
            return self._copy_request(record)

    def acquire_lease(
        self,
        request_id: str,
        *,
        backend: str,
        scope: LeaseScope = LeaseScope.TARGET,
        scope_key: str | None = None,
        ttl_seconds: float | None = None,
    ) -> TargetLease:
        with self._lock:
            self._ensure_open()
            request = self._require_request(request_id)
            if request.lease_id is not None:
                raise RegistryError("LEASE_ALREADY_ACTIVE", f"request {request_id} already has a lease")
            resolved_key = self._scope_key(request, backend, scope, scope_key)
            active_lease_id = self._lease_ids_by_scope_key.get(resolved_key)
            if active_lease_id is not None:
                active = self._leases_by_id[active_lease_id]
                code = "HOST_INPUT_BUSY" if scope is LeaseScope.PROCESS_GLOBAL else "TARGET_BUSY"
                raise RegistryError(
                    code,
                    f"lease scope {resolved_key} is already active",
                    details={
                        "activeLeaseId": active.lease_id,
                        "activeSessionId": active.session_id,
                        "targetId": active.target_id,
                    },
                )
            now = self._clock()
            if ttl_seconds is not None and ttl_seconds <= 0:
                raise ValueError("ttl_seconds must be positive")
            lease = TargetLease(
                lease_id=f"lease-{uuid.uuid4()}",
                session_id=request.session_id,
                request_id=request_id,
                target_id=request.target_id,
                backend=backend,
                scope=scope,
                scope_key=resolved_key,
                acquired_at=now,
                updated_at=now,
                expires_at=now + ttl_seconds if ttl_seconds is not None else None,
            )
            self._leases_by_id[lease.lease_id] = lease
            self._lease_ids_by_scope_key[resolved_key] = lease.lease_id
            request.lease_id = lease.lease_id
            request.state = RequestState.ROUTING
            request.updated_at = now
            self._bump()
            return replace(lease)

    def transition_request(self, request_id: str, state: RequestState) -> RequestRecord:
        if state in TERMINAL_REQUEST_STATES:
            raise ValueError("use finish_request for terminal states")
        with self._lock:
            request = self._require_request(request_id)
            if state not in ALLOWED_REQUEST_TRANSITIONS[request.state]:
                raise RegistryError(
                    "INVALID_STATE_TRANSITION",
                    f"cannot transition request from {request.state.value} to {state.value}",
                )
            request.state = state
            request.updated_at = self._clock()
            self._bump()
            return self._copy_request(request)

    def request_cancel(self, request_id: str, reason: str = "user_stop") -> RequestRecord:
        with self._lock:
            request = self._requests.get(request_id)
            if request is None:
                terminal = self._tombstones.get(request_id)
                if terminal is not None:
                    return self._copy_request(terminal)
                raise RegistryError("REQUEST_NOT_FOUND", f"request {request_id} was not found")
            request.cancel_reason = reason
            request.cancellation.set()
            request.state = RequestState.CANCELLING
            request.updated_at = self._clock()
            if request.lease_id:
                lease = self._leases_by_id[request.lease_id]
                lease.state = LeaseState.CANCELLING
                lease.updated_at = request.updated_at
            self._bump()
            return self._copy_request(request)

    def release_lease(self, lease_id: str, reason: str) -> TargetLease:
        self.begin_release(lease_id, reason)
        return self.finish_release(lease_id)

    def begin_release(self, lease_id: str, reason: str) -> TargetLease:
        with self._lock:
            lease = self._leases_by_id.get(lease_id) or self._released_leases.get(lease_id)
            if lease is None:
                raise RegistryError("LEASE_NOT_FOUND", f"lease {lease_id} was not found")
            if lease.state is LeaseState.RELEASED:
                return replace(lease)
            lease.state = LeaseState.RELEASING
            lease.release_reason = reason
            lease.updated_at = self._clock()
            self._bump()
            return replace(lease)

    def finish_release(self, lease_id: str) -> TargetLease:
        with self._lock:
            lease = self._leases_by_id.get(lease_id) or self._released_leases.get(lease_id)
            if lease is None:
                raise RegistryError("LEASE_NOT_FOUND", f"lease {lease_id} was not found")
            if lease.state is LeaseState.RELEASED:
                return replace(lease)
            if lease.state is not LeaseState.RELEASING:
                raise RegistryError("INVALID_STATE_TRANSITION", "lease release has not begun")
            lease.state = LeaseState.RELEASED
            lease.updated_at = self._clock()
            self._lease_ids_by_scope_key.pop(lease.scope_key, None)
            request = self._requests.get(lease.request_id)
            if request is not None and request.lease_id == lease_id:
                request.lease_id = None
                request.updated_at = lease.updated_at
            self._leases_by_id.pop(lease_id, None)
            self._released_leases[lease_id] = lease
            while len(self._released_leases) > self._tombstone_limit:
                self._released_leases.popitem(last=False)
            self._bump()
            return replace(lease)

    def begin_action(self, lease_id: str) -> TargetLease:
        with self._lock:
            lease = self._require_active_lease(lease_id)
            lease.in_flight_actions += 1
            lease.updated_at = self._clock()
            self._bump()
            return replace(lease)

    def heartbeat_lease(self, lease_id: str, ttl_seconds: float) -> TargetLease:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        with self._lock:
            lease = self._require_active_lease(lease_id)
            now = self._clock()
            lease.updated_at = now
            lease.expires_at = now + ttl_seconds
            lease.suspected_stale = False
            self._bump()
            return replace(lease)

    def finish_action(self, lease_id: str) -> TargetLease:
        with self._lock:
            lease = self._leases_by_id.get(lease_id)
            if lease is None:
                raise RegistryError("LEASE_NOT_FOUND", f"lease {lease_id} was not found")
            if lease.state not in (LeaseState.ACTIVE, LeaseState.CANCELLING):
                raise RegistryError("INVALID_STATE_TRANSITION", "lease cannot finish an action")
            if lease.in_flight_actions <= 0:
                raise RegistryError("INVALID_STATE_TRANSITION", "lease has no in-flight action")
            lease.in_flight_actions -= 1
            lease.updated_at = self._clock()
            self._bump()
            return replace(lease)

    def reap_expired(self) -> dict[str, list[str]]:
        with self._lock:
            now = self._clock()
            suspected: list[str] = []
            expired_requests: list[str] = []
            for lease in list(self._leases_by_id.values()):
                if lease.expires_at is None or lease.expires_at > now:
                    continue
                if lease.in_flight_actions > 0:
                    lease.suspected_stale = True
                    lease.updated_at = now
                    suspected.append(lease.lease_id)
                    continue
                expired_requests.append(lease.request_id)
            for request_id in expired_requests:
                self.request_cancel(request_id, "lease_expired")
            if suspected:
                self._bump()
            return {"suspectedStale": suspected, "expiredRequests": expired_requests}

    def mark_target_lost(self, target_id: str) -> list[str]:
        with self._lock:
            affected = [
                request.request_id
                for request in self._requests.values()
                if request.target_id == target_id
            ]
            for request_id in affected:
                self.request_cancel(request_id, "target_lost")
            return affected

    def finish_request(
        self,
        request_id: str,
        state: RequestState,
        *,
        reason: str | None = None,
    ) -> RequestRecord:
        if state not in TERMINAL_REQUEST_STATES:
            raise ValueError("finish_request requires a terminal state")
        with self._lock:
            request = self._requests.get(request_id)
            if request is None:
                terminal = self._tombstones.get(request_id)
                if terminal is not None:
                    return self._copy_request(terminal)
                raise RegistryError("REQUEST_NOT_FOUND", f"request {request_id} was not found")
            if request.lease_id is not None:
                self.release_lease(request.lease_id, reason or state.value)
            now = self._clock()
            request.state = state
            request.updated_at = now
            if reason:
                request.cancel_reason = reason
            session = self._require_session(request.session_id)
            if session.active_request_id == request_id:
                session.active_request_id = None
                if session.state not in (SessionState.CLOSING, SessionState.CLOSED):
                    session.state = SessionState.READY
                session.last_used_at = now
            self._requests.pop(request_id, None)
            self._tombstones[request_id] = request
            while len(self._tombstones) > self._tombstone_limit:
                self._tombstones.popitem(last=False)
            self._bump()
            return self._copy_request(request)

    def close_session(self, session_id: str, *, force: bool = False) -> SessionRecord:
        with self._lock:
            session = self._require_session(session_id)
            if session.active_request_id is not None:
                if not force:
                    raise RegistryError(
                        "SESSION_BUSY",
                        f"session {session_id} still has an active request",
                        details={"activeRequestId": session.active_request_id},
                    )
                request_id = session.active_request_id
                self.request_cancel(request_id, "session_closed")
                self.finish_request(request_id, RequestState.CANCELLED, reason="session_closed")
            session.state = SessionState.CLOSED
            session.last_used_at = self._clock()
            result = self._copy_session(session)
            self._sessions.pop(session_id, None)
            self._bump()
            return result

    def begin_shutdown(self) -> dict[str, int]:
        """Close admission and signal active requests without releasing handles."""
        with self._lock:
            if not self._closed:
                self._closed = True
                self._bump()
            for request in self._requests.values():
                request.cancellation.set()
                request.cancel_reason = "server_stop"
                if request.state not in TERMINAL_REQUEST_STATES:
                    request.state = RequestState.CANCELLING
                request.updated_at = self._clock()
                if request.lease_id:
                    lease = self._leases_by_id.get(request.lease_id)
                    if lease is not None and lease.state is LeaseState.ACTIVE:
                        lease.state = LeaseState.CANCELLING
                        lease.updated_at = request.updated_at
            if self._requests:
                self._bump()
            return self.snapshot_counts()

    def shutdown(self) -> dict[str, int]:
        with self._lock:
            self.begin_shutdown()
            for request_id in list(self._requests):
                self.finish_request(request_id, RequestState.CANCELLED, reason="server_stop")
            for session_id in list(self._sessions):
                session = self._sessions.pop(session_id)
                session.state = SessionState.CLOSED
            self._bump()
            return self.snapshot_counts()

    def snapshot_counts(self) -> dict[str, int]:
        with self._lock:
            return {
                "sessions": len(self._sessions),
                "requests": len(self._requests),
                "activeLeases": len(self._lease_ids_by_scope_key),
                "tombstones": len(self._tombstones),
                "releasedLeaseTombstones": len(self._released_leases),
            }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "counts": self.snapshot_counts(),
                "closed": self._closed,
                "generation": self._generation,
                "sessions": [
                    {
                        "sessionId": session.session_id,
                        "targetId": session.target.target_id,
                        "runtimeId": session.owner.runtime_id,
                        "threadId": session.owner.thread_id,
                        "state": session.state.value,
                        "activeRequestId": session.active_request_id,
                        "createdAt": session.created_at,
                        "updatedAt": session.last_used_at,
                    }
                    for session in self._sessions.values()
                ],
                "requests": [
                    {
                        "requestId": request.request_id,
                        "sessionId": request.session_id,
                        "targetId": request.target_id,
                        "leaseId": request.lease_id,
                        "state": request.state.value,
                        "createdAt": request.created_at,
                        "updatedAt": request.updated_at,
                    }
                    for request in self._requests.values()
                ],
                "leases": [
                    {
                        "leaseId": lease.lease_id,
                        "sessionId": lease.session_id,
                        "requestId": lease.request_id,
                        "targetId": lease.target_id,
                        "backend": lease.backend,
                        "scope": lease.scope.value,
                        "mode": lease.mode.value,
                        "state": lease.state.value,
                        "expiresAt": lease.expires_at,
                        "inFlightActionCount": lease.in_flight_actions,
                        "suspectedStale": lease.suspected_stale,
                        "acquiredAt": lease.acquired_at,
                        "updatedAt": lease.updated_at,
                    }
                    for lease in self._leases_by_id.values()
                ],
            }

    def get_session(self, session_id: str) -> SessionRecord:
        with self._lock:
            return self._copy_session(self._require_session(session_id))

    def get_request(self, request_id: str) -> RequestRecord:
        with self._lock:
            request = self._requests.get(request_id) or self._tombstones.get(request_id)
            if request is None:
                raise RegistryError("REQUEST_NOT_FOUND", f"request {request_id} was not found")
            return self._copy_request(request)

    def cancellation_event(self, request_id: str) -> threading.Event:
        """Return the registry-owned live cancellation token for a channel."""
        with self._lock:
            return self._require_request(request_id).cancellation

    def _ensure_open(self) -> None:
        if self._closed:
            raise RegistryError("REGISTRY_CLOSED", "session registry is closed")

    def _require_session(self, session_id: str) -> SessionRecord:
        session = self._sessions.get(session_id)
        if session is None:
            raise RegistryError("SESSION_NOT_FOUND", f"session {session_id} was not found")
        return session

    def _require_request(self, request_id: str) -> RequestRecord:
        request = self._requests.get(request_id)
        if request is None:
            raise RegistryError("REQUEST_NOT_FOUND", f"request {request_id} was not found")
        return request

    def _require_active_lease(self, lease_id: str) -> TargetLease:
        lease = self._leases_by_id.get(lease_id)
        if lease is None:
            raise RegistryError("LEASE_NOT_FOUND", f"lease {lease_id} was not found")
        if lease.state is not LeaseState.ACTIVE:
            raise RegistryError("INVALID_STATE_TRANSITION", "lease is not active")
        return lease

    @staticmethod
    def _check_owner(session: SessionRecord, owner: SessionOwner | None) -> None:
        if owner is not None and owner != session.owner:
            raise RegistryError("SESSION_OWNER_MISMATCH", "session belongs to another runtime thread")

    @staticmethod
    def _scope_key(
        request: RequestRecord,
        backend: str,
        scope: LeaseScope,
        scope_key: str | None,
    ) -> str:
        if scope is LeaseScope.TARGET:
            return f"target:{request.target_id}"
        if scope_key:
            return f"{scope.value}:{scope_key}"
        if scope is LeaseScope.PROCESS_GLOBAL:
            return "process-global:host-input-desktop"
        return f"environment:{backend}"

    @staticmethod
    def _copy_session(record: SessionRecord) -> SessionRecord:
        return replace(record)

    @staticmethod
    def _copy_request(record: RequestRecord) -> RequestRecord:
        copied = replace(record)
        copied.cancellation = threading.Event()
        if record.cancellation.is_set():
            copied.cancellation.set()
        return copied

    def _bump(self) -> None:
        self._generation += 1
