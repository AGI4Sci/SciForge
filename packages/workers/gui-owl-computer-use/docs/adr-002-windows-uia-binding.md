# ADR-002: Windows UIA uses a pinned comtypes binding

- Status: accepted for P3b
- Date: 2026-08-06
- Decision owner: Computer Use session-channel project

## Context

The P3 Windows backend needs direct access to the system UI Automation client
interfaces while preserving the worker's small dependency surface. The
repository did not previously declare a UIA library. Relying on a package that
happens to exist in a developer venv would make source and packaged behavior
diverge.

## Decision

Use `comtypes==1.4.16` on Windows only and generate bindings from the operating
system's `UIAutomationCore.dll` at runtime. The version is exact, not a lower
bound. PyPI metadata declares Python 3.9+, which includes the worker's Python
3.11 runtime. The upstream license grants permissive use, modification and
redistribution rights with copyright/license notice retention.

Do not add `pywinauto`. It includes useful higher-level discovery behavior but
also a wider abstraction and dependency surface that this backend does not
need. The backend should expose only control patterns it probes directly.

## Threading and lifecycle consequence

COM element pointers are not stored in `SessionInputChannel` handles or shared
between `ThreadingHTTPServer` threads. Each provider operation initializes COM
on the calling thread, resolves the target from its immutable descriptor,
revalidates PID/HWND/runtime identity, performs one bounded operation, releases
the COM references and uninitializes that thread. The channel handle stores
only a target identity fingerprint and Python-owned state.

## Capability truth

`probe.available=false` on non-Windows hosts, when `comtypes` is missing, or
when `UIAutomationCore.dll` cannot be loaded. Unsupported/focus-requiring
operations are rejected. The backend must never fall back to PyAutoGUI,
PostMessage, clipboard paste or `SetFocus` while claiming background UIA.

## Verification

Value, toggle, selection, range and scroll actions read the corresponding
pattern state after the operation. Invoke without an observable semantic state
change is `unverified`, not `verified`. A lost/reused HWND or changed runtime
identity is `TARGET_LOST`.

## References checked

- PyPI JSON metadata for `comtypes 1.4.16` (Python `>=3.9`).
- `enthought/comtypes` tag `1.4.16`, `LICENSE.txt` (permissive MIT-style terms).
- Microsoft UI Automation client and control-pattern interfaces supplied by
  Windows `UIAutomationCore.dll`.
