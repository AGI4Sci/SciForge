"""Desktop mouse overlay for Computer-Use runs.

When the agent drives the user's real desktop, the OS cursor moves but it is
easy to miss WHERE the agent is acting and WHEN it is in control. This module
paints a translucent, always-on-top, **click-through** overlay on the real
screen that:

  * shows a "Computer Use 进行中" banner while the agent is in control,
  * draws a highlight ring that follows the agent's target point, and
  * plays a ripple animation at each click.

Design constraints:
  * It must NEVER block the agent's own clicks -> the window is click-through
    (Windows: WS_EX_LAYERED | WS_EX_TRANSPARENT via ctypes; a transparent color
    key makes the empty areas invisible). Reliable click-through is only
    guaranteed on Windows, so the full overlay is enabled there; on other
    platforms it degrades to a no-op rather than risk intercepting input.
  * It must NEVER break execution. Every Tk/ctypes call is guarded; any failure
    silently disables the overlay and the run continues.
  * Tk must run on a single thread, so the overlay owns a daemon thread with its
    own mainloop and accepts thread-safe commands through a queue.

The overlay is driven by explicit backend hooks.  It never monkeypatches global
input functions, so opening and closing one run cannot alter another run's
execution path.
"""
from __future__ import annotations

import platform
import queue
import threading
import time
from typing import Optional

_TRANSPARENT_KEY = "#010203"  # near-black color key painted fully transparent
_RING_COLOR = "#00E5FF"
_RIPPLE_COLOR = "#FFD54A"
_BANNER_BG = "#1E1E1E"
_BANNER_FG = "#FFFFFF"
_RING_R = 26


def overlay_supported() -> bool:
    """Full click-through overlay is only trusted on Windows."""
    return platform.system() == "Windows"


class DesktopOverlay:
    """A single-instance, thread-safe desktop overlay.

    Public methods are safe to call from any thread; they enqueue commands that
    the Tk thread drains. If the overlay cannot start it becomes a silent no-op
    (``self.active`` stays False).
    """

    def __init__(self, banner_text: str = "🖱  Computer Use 进行中 — agent 正在操作桌面"):
        self.banner_text = banner_text
        self.active = False
        self._cmds: "queue.Queue[tuple]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._hidden_ack = threading.Event()
        self._closed = threading.Event()

    # --- lifecycle ------------------------------------------------------------
    def start(self) -> "DesktopOverlay":
        if not overlay_supported():
            return self
        self._thread = threading.Thread(target=self._run, name="cua-overlay", daemon=True)
        self._thread.start()
        # Wait briefly for the Tk loop to come up; don't block the run if it can't.
        self._ready.wait(timeout=3.0)
        return self

    def close(self, timeout: float = 2.0) -> None:
        """Tear down the overlay and BLOCK until the Tk thread has destroyed it.

        Destroying Tk objects on their owning thread (not the GC on some other
        thread at interpreter exit) avoids ``Tcl_AsyncDelete`` crashes.
        """
        if not self._thread:
            return
        if self.active:
            self._cmds.put(("close",))
        self._closed.wait(timeout=timeout)
        self._thread.join(timeout=timeout)
        self.active = False

    def hide(self, timeout: float = 0.6) -> None:
        """Hide the overlay and BLOCK until it is off-screen.

        Call before capturing a screenshot so the ring/banner do not pollute the
        grounder's observation. No-op (returns immediately) if inactive.
        """
        if not self.active:
            return
        self._hidden_ack.clear()
        self._cmds.put(("hide",))
        self._hidden_ack.wait(timeout=timeout)

    def show(self) -> None:
        if self.active:
            self._cmds.put(("show",))

    # --- thread-safe drawing API ---------------------------------------------
    def move_to(self, x: float, y: float) -> None:
        if self.active:
            self._cmds.put(("move", float(x), float(y)))

    def ripple(self, x: float, y: float) -> None:
        if self.active:
            self._cmds.put(("ripple", float(x), float(y)))

    # --- Tk thread internals --------------------------------------------------
    def _run(self) -> None:
        try:
            self._run_tk()
        finally:
            # Signal close() that the Tk thread has fully exited (windows
            # destroyed on THIS thread), and unblock any waiter on startup.
            self.active = False
            self._ready.set()
            self._hidden_ack.set()
            self._closed.set()

    def _run_tk(self) -> None:
        try:
            import tkinter as tk
        except Exception:  # noqa: BLE001 - no Tk -> no overlay
            return
        try:
            root = tk.Tk()
            root.withdraw()
            win = tk.Toplevel(root)
            win.overrideredirect(True)
            win.attributes("-topmost", True)
            sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
            win.geometry(f"{sw}x{sh}+0+0")
            try:
                win.attributes("-transparentcolor", _TRANSPARENT_KEY)
            except Exception:  # noqa: BLE001
                pass
            canvas = tk.Canvas(win, width=sw, height=sh, bg=_TRANSPARENT_KEY,
                               highlightthickness=0, bd=0)
            canvas.pack()
            self._make_click_through(win)

            # persistent banner (top-center)
            bx, by = sw // 2, 28
            canvas.create_rectangle(bx - 230, by - 18, bx + 230, by + 18,
                                    fill=_BANNER_BG, outline=_RING_COLOR, width=1,
                                    tags="banner")
            canvas.create_text(bx, by, text=self.banner_text, fill=_BANNER_FG,
                               font=("Segoe UI", 11, "bold"), tags="banner")

            # highlight ring (hidden until first move)
            ring = canvas.create_oval(-99, -99, -99, -99, outline=_RING_COLOR, width=4)
            dot = canvas.create_oval(-99, -99, -99, -99, fill=_RING_COLOR, outline="")

            state = {"canvas": canvas, "ring": ring, "dot": dot, "win": win, "root": root}
            self.active = True
            self._ready.set()

            def drain() -> None:
                stop = False
                try:
                    while True:
                        cmd = self._cmds.get_nowait()
                        if cmd[0] == "close":
                            stop = True
                            break
                        if cmd[0] == "move":
                            self._draw_move(state, cmd[1], cmd[2])
                        elif cmd[0] == "ripple":
                            self._draw_ripple(state, cmd[1], cmd[2])
                        elif cmd[0] == "hide":
                            try:
                                state["win"].withdraw(); state["win"].update_idletasks()
                            except Exception:  # noqa: BLE001
                                pass
                            self._hidden_ack.set()
                        elif cmd[0] == "show":
                            try:
                                state["win"].deiconify()
                                state["win"].attributes("-topmost", True)
                                self._make_click_through(state["win"])
                            except Exception:  # noqa: BLE001
                                pass
                except queue.Empty:
                    pass
                if stop:
                    state["root"].quit()   # break out of mainloop; teardown happens below
                    return
                state["root"].after(25, drain)

            after_id = root.after(25, drain)
            root.mainloop()
            # Teardown on THIS (the Tk) thread so no Tcl object is finalized by
            # the GC on another thread at exit (-> Tcl_AsyncDelete crash).
            try:
                root.after_cancel(after_id)
            except Exception:  # noqa: BLE001
                pass
            try:
                win.destroy(); root.destroy()
            except Exception:  # noqa: BLE001
                pass
            state.clear()
            del canvas, win, root
            import gc
            gc.collect()
        except Exception:  # noqa: BLE001 - any GUI failure disables the overlay
            pass

    def _draw_move(self, state, x: float, y: float) -> None:
        c = state["canvas"]
        c.coords(state["ring"], x - _RING_R, y - _RING_R, x + _RING_R, y + _RING_R)
        c.coords(state["dot"], x - 3, y - 3, x + 3, y + 3)
        c.tag_raise(state["ring"]); c.tag_raise(state["dot"])

    def _draw_ripple(self, state, x: float, y: float) -> None:
        c = state["canvas"]
        rip = c.create_oval(x - 6, y - 6, x + 6, y + 6, outline=_RIPPLE_COLOR, width=4)

        def grow(r: int) -> None:
            if r > 60:
                try:
                    c.delete(rip)
                except Exception:  # noqa: BLE001
                    pass
                return
            try:
                c.coords(rip, x - r, y - r, x + r, y + r)
                c.itemconfig(rip, width=max(1, 5 - r // 14))
            except Exception:  # noqa: BLE001
                return
            state["root"].after(18, lambda: grow(r + 9))

        grow(6)

    @staticmethod
    def _make_click_through(win) -> None:
        """Windows-only: set WS_EX_LAYERED | WS_EX_TRANSPARENT so clicks pass through."""
        if platform.system() != "Windows":
            return
        try:
            import ctypes

            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x00080000
            WS_EX_TRANSPARENT = 0x00000020
            WS_EX_TOOLWINDOW = 0x00000080  # keep out of the taskbar/alt-tab
            hwnd = ctypes.windll.user32.GetParent(win.winfo_id())
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            style |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW
            ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
        except Exception:  # noqa: BLE001
            pass


# --- process-level explicit manager -----------------------------------------


class OverlayManager:
    """Own at most one host-desktop overlay for the process-global lease."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._owner: str | None = None
        self._overlay: DesktopOverlay | None = None

    def open(self, owner: str) -> None:
        with self._lock:
            if self._owner == owner:
                return
            if self._owner is not None:
                raise RuntimeError("overlay is already owned by another request")
            overlay = DesktopOverlay().start()
            self._owner = owner
            self._overlay = overlay

    def before_observe(self, owner: str) -> None:
        with self._lock:
            if self._owner == owner and self._overlay is not None:
                self._overlay.hide()

    def after_observe(self, owner: str) -> None:
        with self._lock:
            if self._owner == owner and self._overlay is not None:
                self._overlay.show()

    def before_action(
        self,
        owner: str,
        action: str,
        x: float | None,
        y: float | None,
    ) -> None:
        with self._lock:
            if self._owner != owner or self._overlay is None or x is None or y is None:
                return
            self._overlay.move_to(x, y)
            if "click" in action or "drag" in action:
                self._overlay.ripple(x, y)

    def close(self, owner: str) -> None:
        with self._lock:
            if self._owner != owner:
                return
            overlay = self._overlay
            self._owner = None
            self._overlay = None
        if overlay is not None:
            overlay.close()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "active": bool(self._overlay and self._overlay.active),
                "owner": self._owner,
            }


OVERLAY_MANAGER = OverlayManager()


if __name__ == "__main__":  # manual visual test: python -m driver.overlay
    ov = DesktopOverlay().start()
    if not ov.active:
        print("overlay not active (unsupported platform or no Tk display)")
    else:
        print("overlay up; sweeping ring + ripples for 6s ...")
        import math
        t0 = time.time()
        while time.time() - t0 < 6:
            t = time.time() - t0
            x = 400 + 300 * math.cos(t)
            y = 300 + 200 * math.sin(t)
            ov.move_to(x, y)
            if int(t * 2) % 2 == 0:
                ov.ripple(x, y)
            time.sleep(0.2)
        ov.close()
        time.sleep(0.3)
