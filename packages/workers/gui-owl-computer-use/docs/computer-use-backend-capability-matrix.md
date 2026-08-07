# Computer Use Backend capability matrix

This matrix is the release truth for the P1–P5 session-channel work. A backend
is selected only when its target, action and isolation capabilities satisfy the
request. A weaker backend is never an implicit fallback for a stronger request.

| Backend | Target kind | Observe | Actions | Host focus / user input / clipboard | Verification | Isolation / concurrency | Ownership cleanup | Controlled evidence | Not proved or unsupported |
|---|---|---|---|---|---|---|---|---|---|
| `browser-cdp` | Attached Chromium page from an explicitly allowlisted loopback CDP endpoint, or SciForge-owned Electron `webContents` registered by the trusted main process | Browser capture uses target CDP; Electron capture uses the bound `webContents.capturePage()`; both bind opaque target identity and adapter generation | Target-scoped click, type, key/hotkey, scroll and wait through Playwright or Electron Debugger Protocol | Does not use physical host input or clipboard; Chromium reports `mayActivateTarget=true` because visible observation may switch its test/debugging tab; Electron capture does not require host activation | Target readback where implemented; post-dispatch response loss is always non-retryable `ACTION_OUTCOME_UNKNOWN` | `host-app-scoped`; exclusive target lease, different targets may run concurrently | Close releases only the attached handle; it never closes the Chromium page/browser or destroys Electron `webContents`; Electron detaches only a Debugger connection it owns | Test-owned headless and visible Chromium both cover three-page isolation; a real three-window Electron smoke covers screenshot/input/readback and zero handles | Managed Chromium, ordinary Chrome without remote debugging, arbitrary third-party Electron, Office/VS Code, physical mouse isolation, and invisible background capture of an attached visible Chromium tab are unavailable |
| `windows-uia` | PID/HWND/AutomationId-bound Windows UIA target; HWND also requires generation | Redacted semantic tree and supported Pattern state | Value, Invoke, Toggle, SelectionItem, RangeValue, Scroll when the target exposes the Pattern | No host focus for supported semantic Patterns; no physical keyboard/mouse or host clipboard | Pattern readback; unsupported or stale operations reject | `host-app-scoped`; exclusive target lease, different HWND targets may run concurrently | Attached handle closes without destroying the user window | Three project-owned native windows: 4 passed; Value/Invoke/Toggle, stale, cancel and target loss isolation | Office, VS Code, arbitrary providers, coordinate clicks, focus-dependent controls, physical key injection |
| `isolated-desktop` | Provider-owned or attached isolated environment | Provider-defined observation | Provider-defined operations | Must be declared by a real provider | Provider-defined, never inferred | Intended `agent-isolated`; exclusive environment lease | Attached disconnects only; managed disconnects then destroys; destroy failure retains lease | SPI, unavailable probe, mock lifecycle, TTL/reaper/cleanup plus P6a mTLS Controller/fake transport tests | P6a ships no Guest Worker, VM, certificate, credential or provisioning control plane; no real RDP/VM/Hyper-V/Sandbox environment has passed |
| `legacy-pyautogui` | `process-global:host-input-desktop` compatibility target | Host monitor screenshot | PyAutoGUI mouse/keyboard and compatibility actions | Requires host focus; affects user input; may use host clipboard | Usually `unverified`; semantic success cannot be invented | `host-approved`; one process-global lease for the entire task, never target-concurrent | Restores owned clipboard/configuration and releases only owned keys/buttons; close failure retains lease | Unit/control-plane tests plus one opt-in Win11 test-owned window smoke prove physical click/key/paste, `HOST_INPUT_BUSY`, text-clipboard restoration and cleanup; the fixture pins only its own Edit to en-US/no IME | Not three-session isolation; not safe for background concurrent targets; arbitrary user apps and non-text clipboard formats remain unverified |
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
  `ISOLATED_DESKTOP_UNAVAILABLE`. P6a's remote Worker Controller becomes a
  candidate only when every HTTPS/mTLS identity field is explicitly configured;
  a Controller client or fake transport is not real infrastructure.
