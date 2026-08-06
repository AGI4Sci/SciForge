"""Cancellation token compatibility types.

Cancellation ownership now lives in ``SessionRegistry``.  This module contains
no process-global request-id set.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class CancellationToken:
    event: threading.Event

    @property
    def cancelled(self) -> bool:
        return self.event.is_set()

    def wait(self, timeout: float | None = None) -> bool:
        return self.event.wait(timeout)
