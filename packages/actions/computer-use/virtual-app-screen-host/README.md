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
createSession
launchApp
attachSurface
presentSurface
sendHumanInput
executeAutomationIntent
readFrame
pause
resume
stop
closeSession
validateGrant
```

Human input must return after host queue acceptance. Automation must wait for barrier, after-frame evidence, verifier refs and ledger refs.

## Platform Adapters

Platform adapters are implementation details behind the host:

- macOS: virtual display/native helper + ScreenCaptureKit.
- Windows: IDD + Graphics Capture/DXGI/UIA.
- Linux: Xpra or headless compositor + PipeWire.

DeskPad, BetterDisplay, Mirage, Sunshine, noVNC/RDP/VNC and VM/container desktops may be used only for research, benchmark or diagnostic adapters. They must not mint user-level pass evidence or bypass host grants.
