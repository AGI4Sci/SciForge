# Computer Use Backend capability matrix

This matrix is the release truth for the P1–P5 session-channel work. A backend
is selected only when its target, action and isolation capabilities satisfy the
request. A weaker backend is never an implicit fallback for a stronger request.

| Backend | Target kind | Observe | Actions | Host focus / user input / clipboard | Verification | Isolation / concurrency | Ownership cleanup | Controlled evidence | Not proved or unsupported |
|---|---|---|---|---|---|---|---|---|---|
| `browser-cdp` | Allowlisted Chromium page or managed Electron target with an explicitly opened trusted CDP endpoint | DOM/page screenshot and target metadata through the loopback Node adapter; capture activates the target tab inside that debugging browser | Target-scoped click, type/fill, key/hotkey, scroll and supported page operations | Does not use physical host input or clipboard, but observation may visibly switch the active tab/window in an attached non-headless debugging browser | Page/DOM readback; outcome is unknown when dispatch may have happened but the response is lost | `host-app-scoped`; exclusive target lease, different targets may run concurrently | Attached target detaches only; managed ownership may close its owned target | Test-owned headless browser: 5 passed, 1 explicit nondeterministic transport-cut skip; three pages did not cross | Ordinary Chrome without remote debugging, arbitrary third-party Electron, Office/VS Code, physical mouse isolation, or invisible background capture of an attached visible tab |
| `windows-uia` | PID/HWND/AutomationId-bound Windows UIA target; HWND also requires generation | Redacted semantic tree and supported Pattern state | Value, Invoke, Toggle, SelectionItem, RangeValue, Scroll when the target exposes the Pattern | No host focus for supported semantic Patterns; no physical keyboard/mouse or host clipboard | Pattern readback; unsupported or stale operations reject | `host-app-scoped`; exclusive target lease, different HWND targets may run concurrently | Attached handle closes without destroying the user window | Three project-owned native windows: 4 passed; Value/Invoke/Toggle, stale, cancel and target loss isolation | Office, VS Code, arbitrary providers, coordinate clicks, focus-dependent controls, physical key injection |
| `isolated-desktop` | Provider-owned or attached isolated environment | Provider-defined observation | Provider-defined operations | Must be declared by a real provider | Provider-defined, never inferred | Intended `agent-isolated`; exclusive environment lease | Attached disconnects only; managed disconnects then destroys; destroy failure retains lease | SPI, unavailable probe, mock lifecycle, TTL/reaper/cleanup tests | No RDP, VM, Hyper-V, Windows Sandbox, image, credential, network or application provider is shipped |
| `legacy-pyautogui` | `process-global:host-input-desktop` compatibility target | Host monitor screenshot | PyAutoGUI mouse/keyboard and compatibility actions | Requires host focus; affects user input; may use host clipboard | Usually `unverified`; semantic success cannot be invented | `host-approved`; one process-global lease for the entire task, never target-concurrent | Restores owned clipboard/configuration and releases only owned keys/buttons; close failure retains lease | Unit/control-plane tests prove whole-task serialization and cleanup behavior | P5 did not run real input smoke; not three-session isolation; not safe for background concurrent targets |
| `static-image` | Immutable image reference | Image only | No mutation | No focus/input/clipboard impact | `not-applicable` | Observation-only | No external resource | Contract and unit tests | Not a desktop control backend |

## Interpretation rules

- Threads, sessions, requests, targets and input channels are different
  concepts. Concurrent threads do not create multiple Windows input desktops.
- `requestedIsolation != effectiveIsolation` is visible. Degradation requires
  `allowDegraded=true` and carries `degradedReason`.
- `unverified` means the action result could not be read back reliably. It is
  neither verified success nor confirmed failure.
- `ACTION_OUTCOME_UNKNOWN` is not retryable and must not be replayed through a
  different backend.
- `cleanupPending` means the resource is quarantined and not safe to reuse.
- The default isolated provider intentionally reports
  `ISOLATED_DESKTOP_UNAVAILABLE`; an interface or mock is not real infrastructure.
