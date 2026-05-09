"""GUI execution contract for the Vision Sense MVP.

The executor is the only boundary allowed to know how screenshot-space points
become real GUI/system coordinates. The runner stays purely algorithmic and
testable: it asks a grounder for a visual point, then passes that point to an
executor.

Text input contract: ``type_text`` means clipboard paste. MVP executors should
place the whole text on the clipboard and paste once instead of typing
character by character, because per-key typing is slow and unstable across GUI
targets.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


ScrollDirection = Literal["up", "down", "left", "right"]


@dataclass(frozen=True)
class Point:
    """A point in screenshot coordinate space."""

    x: float
    y: float


@dataclass(frozen=True)
class ExecutionResult:
    """Result returned by a GUI executor after attempting one action."""

    ok: bool = True
    message: str | None = None


class GuiExecutor(Protocol):
    """Minimal GUI action interface used by the VisionTask runner."""

    def click(self, point: Point) -> ExecutionResult | None:
        """Click a screenshot-space point after executor-side coordinate mapping."""

    def type_text(self, text: str) -> ExecutionResult | None:
        """Paste the complete text from the clipboard; do not type per character."""

    def press_key(self, key: str) -> ExecutionResult | None:
        """Press a single key such as ``Enter``, ``Escape``, or ``Tab``."""

    def scroll(
        self, direction: ScrollDirection, amount: float
    ) -> ExecutionResult | None:
        """Scroll in one direction by an executor-defined amount."""
