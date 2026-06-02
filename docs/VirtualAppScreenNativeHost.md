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

## 当前 Contract / Smoke 状态

当前工作区已经有 `packages/actions/computer-use/virtual-app-screen-host` 包边界、contract smoke 骨架和 Host-backed runtime attach 迁移 shim。产品 attach 的 public session/surface/frame/grant/owner refs 已是 `computer-use:native-host/...`，provider lifecycle refs 只能作为 Host evidence；真实 macOS / Linux / Windows `diagnosticOnly=false` provider user-level pass 仍未完成。

- `capability.manifest.json` 声明 package 是 product truth owner，并把 `session`、`surface`、`frame`、`permission`、`grant`、`ledger` 的 single truth source 固定为 host-owned。
- `src/contracts.ts` 定义包级 public API、session model、error taxonomy、grant model、permission/readiness model 和 ledger event taxonomy。
- `src/in-memory-host.ts` 和 `src/ledger.ts` 是当前 smoke 可运行的 fail-closed / contract-smoke 形态：无平台 adapter 时返回 blocked；human input / automation 会先经过 platform adapter gate，再由 Host 写入 public ledger refs；contract-smoke adapter 只能证明 API、grant、ledger 和 barrier contract，不等于真实平台通过。
- 顶层 `types.ts`、`errors.ts` 和 `evidence-ledger.ts` 只是兼容 re-export，不能成为第二套 contract 或实现源。
- `npm run smoke:virtual-app-screen-native-host --silent`、`smoke:computer-use-provider-readiness`、`smoke:computer-use-viewer`、`smoke:computer-use-fixtures` 和 `smoke:computer-use-user-acceptance` 是当前 contract/gate evidence；它们验证 fail-closed、manifest/API parity、grant validation、ledger negative cases 和 viewer live-state guard。
- `smoke:virtual-app-screen-dogfood-product` 已把 `nativeHost`、`humanInputHotPath`、`automationBarrierRefs` 和 `backgroundEvidenceRefs` 纳入 passed gate；缺真实 Host refs 时 smoke 应保持 blocked，不能把 attached-shaped payload 当通过。

因此文档里的 “Native Host 已存在” 只表示 package contract、manifest、ledger validator、Host-owned public attach refs 和 fail-closed smoke 路线已落位；用户级产品通过仍必须拿到真实 platform adapter 的 session/surface/frame/input/evidence，并证明 `diagnosticOnly=false`、hot-path input、automation barrier 和 current-run ledger replay。

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
launchOrAttachApp()
attachSurface()
presentSurface()
readFrame()
sendHumanInput()
executeAutomationIntent()
pauseAgent()
resumeAgent()
closeSession()
validateGrant()
```

这是 `capability.manifest.json` 和当前 `src/contracts.ts` smoke 认可的最小 public API。`getLedger` 这类 package-local validator helper 可以存在于实现接口中，但不能作为产品 public surface；任何新增 public method 进入产品前都必须同步 manifest、ownership map 和 smoke。

`presentSurface` 只接受 host-issued `liveBindingAttachGrantRef`，并写入 `grant.validated` ledger event。仅 artifact 字段完整不能触发 live presentation。

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

- `sessionRef` / `hostSessionRef`
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
- `currentRunPointerRef`

Runtime 和 validators 必须复验 ledger entry existence、hash、current-run ownership、session/surface consistency 和 sequence monotonicity。Shell hook 的 `providerEvidenceWritten=true` 只能是 contract hint，不能单独证明 user-level pass。

当前 contract ledger event type 固定为：

```text
session.created
app.launched
surface.attached
grant.validated
frame.read
human-input.accepted
automation.barrier-completed
permission.handoff
permission.recheck
agent.paused
agent.resumed
session.closed
```

Ledger entry 必须由 `native-virtual-app-screen-host` 写入，按 sequence 形成 sha256 chain，并拒绝 `ui:`、`gui-viewer:`、fixture、replay-fixture、snapshot-fixture 或 inline base64/data URL 作为 live truth。

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
- Host grant 被 dereference/validated，并产生 `grant.validated` ledger event；不信任 artifact-shaped payload。
- 真人输入 fire-and-release，并记录 `inputAcceptedRef`、`inputSequence` 和 `human-input.accepted` ledger event。
- 自动化动作产生 `automationBarrierRef`、before/after frame、verification 和 `automation.barrier-completed` ledger event。
- `gui.presentRef` 证明同一 Host surface 展示在右侧 Screen。
- 第三方虚拟屏工具若参与，只能出现在 diagnostic/reference 字段。
- Contract-smoke / in-memory host 可以证明 package contract，但只有真实 platform adapter 的 `diagnosticOnly=false`、background isolated rendering、single interactive truth 和当前 run ledger 才能成为产品通过。
