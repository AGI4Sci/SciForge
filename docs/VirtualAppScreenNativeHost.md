# Native VirtualAppScreen Host 设计

最后更新：2026-06-02

## 目标结论

VirtualAppScreen 的终局 C 是 `packages/` 下模块化的 **Native VirtualAppScreen Host**，而不是 provider hook、第三方虚拟屏幕 UI 或 React viewer 拼装。

```text
SciForge Screen pane
-> GUI host adapter attaches bounds / overlays / controls
-> NativeVirtualAppScreenHost
   -> owns session, surface, input queue, permissions, grants, evidence writer
   -> calls platform adapters
      -> macOS virtual display / ScreenCaptureKit / native helper
      -> Windows IDD / Graphics Capture / UIA
      -> Linux Xpra or headless compositor / PipeWire
```

React viewer 只展示 host-owned surface 和 refs-first overlay。Runtime 只装配 workspace/current-run context、host lifecycle 和 command routing。Computer Use action provider 拥有 scheduler、lease、risk、approval、automation barrier 和 completion candidate，但不直接实现 OS display/capture/input。

## Package 边界

目标 package：

```text
packages/actions/computer-use/virtual-app-screen-host/
```

允许职责：

- Host protocol、manifest、public entrypoint 和 package-local validators。
- Permission/preflight、install/readiness refs、isolation report。
- Virtual display/app surface lifecycle。
- Target app launch/attach/window placement。
- Native/streaming surface presentation descriptor。
- Human input queue 和 automation input executor。
- Pause/resume/stop、安全 close 或 session pause。
- `liveBindingAttachGrantRef` mint/validate/dereference。
- Host-owned session/frame/input/evidence ledger writer。
- Platform adapter registry。

禁止职责：

- 跨模块 planning、repair、capability ranking 或用户级 completion。
- React/UI import、renderer registry dependency 或 GUI private state。
- 绕过 Computer Use lease/approval/evidence 的 app shortcut。
- 把 noVNC/RDP/VNC、DeskPad、BetterDisplay、Mirage、Sunshine 或 VM UI 当产品 truth owner。
- 写 raw screenshot/base64/provider payload/secret 到主 payload。

## Host Protocol

公共 host 能力必须 refs-first、fail-closed，并可通过 Codex native tool/plugin/MCP 或 `module.*` 装配：

```text
describe()
probe()
createSession()
launchApp()
attachSurface()
presentSurface()
sendHumanInput()
executeAutomationIntent()
readFrame()
pause()
resume()
stop()
closeSession()
validateGrant()
```

`presentSurface` 只接受 host-issued grant 和 safe surface descriptor。仅 artifact 字段完整不能触发 live presentation。

## 输入路径

真人交互和自动化必须分开。

```text
sendHumanInput
-> enqueue mouse/key event in host input queue
-> return inputAcceptedRef + inputSequence immediately
-> background evidence worker catches up
```

真人点击、抬起、拖拽、键盘输入不能等待 OCR、snapshot、frame hash、ledger 写入或 verifier。它的验收重点是体感和输入没有打到用户物理桌面。

```text
executeAutomationIntent
-> check lease / permission / freshness
-> send scoped action
-> wait automationBarrierRef
-> require afterFrameRef + verifierRef + evidenceLedgerRef
```

Computer Use 自动化仍然 evidence-first。它不能把 `inputAcceptedRef` 当成任务完成证据。

## Evidence

Host-owned evidence writer 至少写：

- `hostSessionRef`
- `surfaceOwnerRef`
- `displayOwnerRef`
- `targetAppRef`
- `targetWindowRef`
- `liveSurfaceRef`
- `surfaceTransportRef`
- `frameStreamRef`
- `currentFrameRef`
- `inputAcceptedRef`
- `automationBarrierRef`
- `beforeFrameRef` / `afterFrameRef`
- `permissionHandoffRef` / `recheckRef`
- `evidenceLedgerRef`

Runtime 和 validators 必须复验 ledger entry existence、hash、current-run ownership、session/surface consistency 和 sequence monotonicity。Shell hook 的 `providerEvidenceWritten=true` 只能是 contract hint，不能单独证明 user-level pass。

## Transport

桌面 shell 优先 native embedded/presented surface。Web shell、远程 shell 或跨进程场景使用 WebRTC / binary frame stream / canvas stream，但这些都只是同一个 host-owned surface 的 transport。

Frame stream 不能成为第二个交互真相源。Replay、snapshot、PDF、document、old frame 和 `/frame` route 只能是 evidence、manual inspection 或 explicit handoff。

## 第三方工具定位

现成工具可以帮助验证底层能力：

- DeskPad / BetterDisplay / Mirage：macOS virtual display UX 和权限对照。
- `node-mac-virtual-display` / Swift helper：macOS virtual display bridge 参考。
- Xpra：Linux app/window session 参考。
- Windows IDD sample / Virtual-Display-Driver：Windows virtual display driver 参考。
- Sunshine/Moonlight：低延迟编码和 transport benchmark。

它们不得成为 SciForge 的 host control plane。产品通过必须来自 SciForge host-issued session refs、surface refs、input refs、grant refs 和 evidence ledger。

## 验收

Native Host 相关实现不能只证明 “看见一帧”。最低 product path evidence：

- right pane 通过 Host provision/attach/present。
- Host grant 被 dereference/validated，不信任 artifact-shaped payload。
- 真人输入 fire-and-release，并记录 input accepted sequence。
- 自动化动作产生 automation barrier、after frame、verification 和 ledger。
- `gui.presentRef` 证明同一 Host surface 展示在右侧 Screen。
- 第三方虚拟屏工具若参与，只能出现在 diagnostic/reference 字段。
