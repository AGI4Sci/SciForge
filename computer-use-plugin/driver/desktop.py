"""Cross-platform desktop executor (Windows / macOS / Linux).

This is the ONLY OS-dependent layer of the CUA stack: it captures the screen and
drives mouse/keyboard. The grounder (GUI-Owl) and planner (qwen) are remote,
OS-agnostic services. So the agent loop + this executor run ON the user's own
Windows/Mac machine, calling those services over the network.

Screenshot via mss (fast, multi-monitor, DPI-aware). Input via pyautogui. Text
entry via clipboard paste (pyperclip) — robust for unicode, no per-char timing.

Safety: every mutating action goes through _guard(); construct with dry_run=True
to log intended actions without touching the real mouse/keyboard.
"""
from __future__ import annotations
import platform
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import mss
import pyautogui
import pyperclip
from PIL import Image

pyautogui.FAILSAFE = True   # slam mouse to a corner to abort
pyautogui.PAUSE = 0.05


@dataclass
class DesktopExecutor:
    dry_run: bool = False
    monitor: int = 1                      # mss monitor index (1 = primary; 0 = all)
    settle_s: float = 0.25                # wait after an action for the UI to settle
    log: List[str] = field(default_factory=list)

    # --- perception -----------------------------------------------------------
    def screenshot(self) -> Image.Image:
        with mss.mss() as sct:
            mon = sct.monitors[self.monitor]
            raw = sct.grab(mon)
            return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

    def screen_size(self) -> Tuple[int, int]:
        with mss.mss() as sct:
            m = sct.monitors[self.monitor]
            return m["width"], m["height"]

    @property
    def os(self) -> str:
        return platform.system()  # 'Windows' | 'Darwin' | 'Linux'

    # --- actions (all coords are screenshot pixels of the captured monitor) ----
    def _guard(self, desc: str) -> bool:
        self.log.append(desc)
        if self.dry_run:
            return False
        return True

    def _to_screen(self, x: float, y: float) -> Tuple[int, int]:
        # mss monitor may have a non-zero origin (multi-monitor); pyautogui uses
        # global virtual-desktop coords, so add the monitor origin.
        with mss.mss() as sct:
            m = sct.monitors[self.monitor]
        return int(m["left"] + x), int(m["top"] + y)

    def click(self, x: float, y: float, button: str = "left", clicks: int = 1):
        sx, sy = self._to_screen(x, y)
        if self._guard(f"click({x:.0f},{y:.0f})->screen({sx},{sy}) {button} x{clicks}"):
            pyautogui.click(sx, sy, clicks=clicks, button=button, interval=0.08)
            time.sleep(self.settle_s)

    def double_click(self, x, y):
        self.click(x, y, clicks=2)

    def right_click(self, x, y):
        self.click(x, y, button="right")

    def middle_click(self, x, y):
        self.click(x, y, button="middle")

    def triple_click(self, x, y):
        self.click(x, y, clicks=3)

    def left_click_drag(self, x, y):
        """Press-and-drag from the CURRENT cursor position to (x, y)."""
        sx, sy = self._to_screen(x, y)
        if self._guard(f"left_click_drag(->{x:.0f},{y:.0f})"):
            pyautogui.dragTo(sx, sy, duration=0.5, button="left")
            time.sleep(self.settle_s)

    def move(self, x, y):
        sx, sy = self._to_screen(x, y)
        if self._guard(f"move({x:.0f},{y:.0f})"):
            pyautogui.moveTo(sx, sy, duration=0.15)

    def type_text(self, text: str, paste: bool = True):
        if self._guard(f"type_text({text[:40]!r}{'…' if len(text) > 40 else ''})"):
            if paste:
                prev = None
                try:
                    prev = pyperclip.paste()
                except Exception:
                    pass
                pyperclip.copy(text)
                pyautogui.hotkey("command" if self.os == "Darwin" else "ctrl", "v")
                time.sleep(0.1)
                if prev is not None:
                    try:
                        pyperclip.copy(prev)
                    except Exception:
                        pass
            else:
                pyautogui.typewrite(text, interval=0.02)
            time.sleep(self.settle_s)

    def press_key(self, *keys: str):
        if self._guard(f"press_key({'+'.join(keys)})"):
            if len(keys) > 1:
                pyautogui.hotkey(*keys)
            else:
                pyautogui.press(keys[0])
            time.sleep(self.settle_s)

    def scroll(self, amount: int, x: Optional[float] = None, y: Optional[float] = None):
        if x is not None and y is not None:
            self.move(x, y)
        if self._guard(f"scroll({amount})"):
            pyautogui.scroll(amount)
            time.sleep(self.settle_s)

    def drag(self, x1, y1, x2, y2):
        s1, s2 = self._to_screen(x1, y1), self._to_screen(x2, y2)
        if self._guard(f"drag({x1:.0f},{y1:.0f}->{x2:.0f},{y2:.0f})"):
            pyautogui.moveTo(*s1, duration=0.15)
            pyautogui.dragTo(*s2, duration=0.4, button="left")
            time.sleep(self.settle_s)
