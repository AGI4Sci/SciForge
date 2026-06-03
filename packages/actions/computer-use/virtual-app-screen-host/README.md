# Native VirtualAppScreen Host

状态：target package boundary，尚未承载完整产品实现。

本目录是 VirtualAppScreen 终局 C 的目标模块边界。新增通用 native host 语义应收敛到这里，而不是继续分散在 `src/runtime/computer-use`、GUI viewer、smoke 工具或平台 provider hook 中。

## Owner

`NativeVirtualAppScreenHost` 是 Computer Use 的 L1 native surface/control-plane package。它拥有：

- permission/preflight/readiness refs。
- virtual display / app surface lifecycle。
- target app launch/attach/window placement。
- surface transport descriptor 和 presentation grant。
- human input fire-and-release queue。
- automation barrier execution path。
- pause/resume/stop/close session control。
- host-owned frame/input/evidence ledger writer。
- platform adapter registry。

它不拥有：

- cross-module planning、repair、capability ranking 或 user-level completion。
- GUI rendering、React components、renderer registry 或 GUI private state。
- Computer Use scheduler policy 之外的 task brain。
- third-party virtual screen UI as product truth.

## Target Protocol

```text
describe
probe
recordPreflight
createSession
launchOrAttachApp
attachSurface
presentSurface
readFrame
sendHumanInput
executeAutomationIntent
recordPermissionHandoff
recordPermissionRecheck
pauseAgent
resumeAgent
closeSession
validateGrant
```

`recordPreflight` records Host-owned readiness, permission, driver, provider, blocked, handoff and recheck refs for the current run without creating a session or live surface. It writes a preflight-scoped ledger with `preflight.recorded`; UI placeholders and provider lifecycle refs must not become Host preflight truth. Human input must return after host queue acceptance. Automation must wait for barrier, after-frame evidence, verifier refs and ledger refs.

UI, dogfood, presentation and runtime payloads now propagate Host-owned `nativeHostPreflight`, `preflightRef`, `preflightLedgerRef`, `preflightLedgerEntryRef` and `hostReadinessRef` as first-class fields. These refs must be minted or validated by the host/ledger path. `computer-use:screen-activation/...` remains a UI activation placeholder for attach requests or provider-readiness placeholders; it must not impersonate Host preflight, Host readiness or Host ledger refs.

## Platform Adapters

Platform adapters are implementation details behind the host:

- macOS: virtual display/native helper + ScreenCaptureKit.
- Windows: IDD + Graphics Capture/DXGI/UIA.
- Linux: Xpra or headless compositor + PipeWire.

DeskPad, BetterDisplay, Mirage, Sunshine, noVNC/RDP/VNC and VM/container desktops may be used only for research, benchmark or diagnostic adapters. They must not mint user-level pass evidence or bypass host grants.

## Real-driver Opt-in Smoke

Real-driver smoke is intentionally opt-in and is not part of ordinary `verify`:

```bash
npm run smoke:virtual-app-screen-macos-real-driver:opt-in --silent
npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent
npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in --silent
npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent
npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in --silent
npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent
```

These scripts must block or fail closed when the platform, permissions, driver, target app/window, frame capture or isolated input/control hook is unavailable. Windows scripts use the shell-neutral `tools/run-virtual-app-screen-real-opt-in-smoke.ts` launcher, and a Windows opted-in blocked attach must fail the actual pass smoke after validating blocked evidence. Windows real-human-input also remains gated by a passed Linux real closed-loop manifest plus Windows IDD platform/driver conditions. A platform-specific opt-in smoke is driver evidence only; it must not be promoted to a product pass or replace `npm run smoke:virtual-app-screen-dogfood-product --silent`.

These docs must not claim that a real platform `diagnosticOnly=false` user-level pass is complete. Until live transport, isolated hot-path input/control, automation barrier, takeover/resume and current-run Host ledger replay all pass on a real platform provider, the correct product result remains blocked/fail-closed evidence.

macOS additionally requires runtime driver hooks to be explicitly enabled with `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1|true|yes|on`. The target app is supplied through `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_*` scalar variables or `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON`; the platform script is only the opt-in smoke entrypoint. `smoke:virtual-app-screen-macos-real-human-input:opt-in` also requires `SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT=1`, `SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER=1` and `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND`. The optional `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON` must be a JSON string array. The hook is an isolated platform adapter command: stdin receives typed input/control context; stdout returns safe `inputAdapterCapability` when `capabilityProbe=true`, then refs-first JSON for normal input/control calls. Host/provider validators still require provider-owned evidence, post-input `readFrame`, takeover/resume evidence and ledger replay.

Linux Xpra real-human-input smoke also requires `SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_HUMAN_INPUT=1`, `SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER=1`, `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`, `xpra`, `xdotool` and an agent-owned Xpra display. The built-in input hook must execute with `DISPLAY=<session.display>` and must not use the host desktop DISPLAY, shared system input or focus stealing. If the session display/window cannot be proven to belong to Xpra, the run must block rather than claim input execution.

Linux Xpra real-driver opt-in currently verifies attach, readFrame and Host-owned native refs. Until an isolated input/control hook is registered, input must remain blocked and must not report mutating execution.

Windows IDD real-driver opt-in currently verifies attach, readFrame, Host-owned native refs, `diagnosticOnly=false` evidence and Host ledger replay. It requires Windows `win32`, `SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER=1`, `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`, and real driver/permission/target app readiness; otherwise it must block/fail closed and the opted-in pass smoke must exit non-zero.
