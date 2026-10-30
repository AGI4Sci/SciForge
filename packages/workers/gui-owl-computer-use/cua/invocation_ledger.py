"""Service-lifetime idempotency for trusted Computer Use invocations."""
from __future__ import annotations

import copy
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from .invocation_proof import InvocationIdentity


InvocationExecutor = Callable[[], dict[str, Any]]


class InvocationLedgerError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class _InvocationEntry:
    fingerprint: tuple[str, str]
    completed: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] | None = None
    error: BaseException | None = None


class InvocationLedger:
    """Executes each trusted invocation once and retains every terminal outcome.

    Entries deliberately remain for the lifetime of the service. Once the fixed
    capacity is reached, new invocations fail closed instead of evicting an old
    result and making that invocation executable again.
    """

    def __init__(self, max_entries: int = 4096) -> None:
        if max_entries <= 0:
            raise ValueError("invocation ledger capacity must be positive")
        self.max_entries = max_entries
        self._lock = threading.RLock()
        self._entries: dict[tuple[str, str, str, str, str], _InvocationEntry] = {}

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._entries)

    def execute(
        self,
        invocation: InvocationIdentity | None,
        *,
        operation: str,
        executor: InvocationExecutor,
    ) -> dict[str, Any]:
        # Only verifier-produced identities carry the signed argument digest.
        # Legacy/internal callers have no trusted invocation to deduplicate.
        if invocation is None or not invocation.argument_digest:
            return executor()

        key = (
            invocation.runtime_id,
            invocation.thread_id,
            invocation.turn_id,
            invocation.invocation_id,
            invocation.tool,
        )
        digest = invocation.argument_digest
        fingerprint = (operation, digest)
        execute_here = False
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                if entry.fingerprint != fingerprint:
                    raise InvocationLedgerError(
                        "IDEMPOTENCY_CONFLICT",
                        "the trusted invocation ID was already used with different input",
                    )
            else:
                if len(self._entries) >= self.max_entries:
                    raise InvocationLedgerError(
                        "INVOCATION_LEDGER_CAPACITY",
                        "the trusted invocation ledger is at capacity",
                    )
                entry = _InvocationEntry(fingerprint=fingerprint)
                self._entries[key] = entry
                execute_here = True

        if not execute_here:
            entry.completed.wait()
            if entry.error is not None:
                raise entry.error
            if entry.result is None:
                raise RuntimeError("trusted invocation completed without a result")
            return copy.deepcopy(entry.result)

        try:
            result = executor()
            stored_result = copy.deepcopy(result)
        except BaseException as error:
            with self._lock:
                entry.error = error
                entry.completed.set()
            raise
        with self._lock:
            entry.result = stored_result
            entry.completed.set()
        return result
