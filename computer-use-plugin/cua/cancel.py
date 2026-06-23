"""Thread-safe cancellation registry for in-flight computer-use runs.

The HTTP server runs each request on its own thread (ThreadingHTTPServer). A live
run loops for many steps on one thread; a separate `POST /computer-use/cancel
{requestId}` arrives on another thread and flips a flag the run checks between
steps (and right before each real action).

This is what makes "stop" actually stop the mouse/keyboard. Aborting the client
fetch alone does NOT stop the run: the server never sees the disconnect, so
without this flag the loop keeps driving the desktop to the end.
"""
from __future__ import annotations
import threading

_lock = threading.Lock()
_cancelled: "set[str]" = set()


def request_cancel(request_id: str) -> None:
    """Mark a run for cancellation (idempotent; safe from any thread)."""
    if not request_id:
        return
    with _lock:
        _cancelled.add(request_id)


def is_cancelled(request_id: str) -> bool:
    if not request_id:
        return False
    with _lock:
        return request_id in _cancelled


def clear(request_id: str) -> None:
    """Drop a run's flag once it has finished, so a reused id can't carry over."""
    if not request_id:
        return
    with _lock:
        _cancelled.discard(request_id)
