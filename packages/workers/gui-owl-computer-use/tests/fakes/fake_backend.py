from __future__ import annotations

import threading


class FakeBackend:
    """A target-keyed state store; it never touches the host desktop."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values: dict[str, list[str]] = {}

    def write(self, target_id: str, value: str) -> None:
        with self._lock:
            self._values.setdefault(target_id, []).append(value)

    def read(self, target_id: str) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._values.get(target_id, ()))
