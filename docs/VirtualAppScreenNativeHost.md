# Native VirtualAppScreen Host 设计

最后更新：2026-06-03

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

当前工作区已经有 `packages/actions/computer-use/virtual-app-screen-host` 包边界、contract smoke 骨架和 Host-backed runtime attach 迁移 shim。产品 attach 的 public session/surface/frame/grant/owner refs 已是 `computer-use:native-host/...`，provider lifecycle refs 只能作为 Host evidence；macOS `vscode-editor` 已有真实 `diagnosticOnly=false` attach/readFrame/human-input/takeover/resume/closeSession pass manifest，Linux Xpra 和 Windows IDD 的真实 provider pass 仍需各自平台实机证据。

- `capability.manifest.json` 声明 package 是 product truth owner，并把 `session`、`surface`、`frame`、`permission`、`grant`、`ledger` 的 single truth source 固定为 host-owned。
- `src/contracts.ts` 定义包级 public API、session model、error taxonomy、grant model、permission/readiness model 和 ledger event taxonomy。
- `src/in-memory-host.ts` 和 `src/ledger.ts` 是当前 smoke 可运行的 fail-closed / contract-smoke 形态：无平台 adapter 时返回 blocked；`recordPreflight` 可在无 attached session 时记录 Host-owned readiness/preflight refs 和 preflight-scoped ledger；human input / automation 会先经过 platform adapter gate，再由 Host 写入 public ledger refs；contract-smoke adapter 只能证明 API、grant、ledger 和 barrier contract，不等于真实平台通过。
- UI、dogfood、presentation viewer 和 runtime attach payload 现在把 Host-owned `nativeHostPreflight`、`preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef` 和 `hostReadinessRef` 作为一等字段传播。它们必须来自 `recordPreflight` / Host ledger，不能由 UI 自行合成。
- 顶层 `types.ts`、`errors.ts` 和 `evidence-ledger.ts` 只是兼容 re-export，不能成为第二套 contract 或实现源。
- `npm run smoke:virtual-app-screen-native-host --silent`、`smoke:computer-use-provider-readiness`、`smoke:computer-use-viewer`、`smoke:computer-use-fixtures` 和 `smoke:computer-use-user-acceptance-contract` 是当前 contract/gate evidence；它们验证 fail-closed、manifest/API parity、grant validation、ledger negative cases 和 viewer live-state guard。`smoke:computer-use-user-acceptance` 仅保留为 contract alias，不能被解读为 user-level pass。
- `smoke:virtual-app-screen-dogfood-product` 已把 `nativeHost`、`humanInputHotPath`、`automationBarrierRefs` 和 `backgroundEvidenceRefs` 纳入 passed gate；缺真实 Host refs 时 smoke 应保持 blocked，不能把 attached-shaped payload 当通过。
- Real-driver smoke 是显式 opt-in 入口：`npm run smoke:virtual-app-screen-macos-real-driver:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in`、`npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in`、`npm run smoke:virtual-app-screen-macos-real-human-input:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in` 和 `npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in`。它们不进入普通 `verify`，平台、权限、driver、target app/window、frame capture 或 isolated input/control hook 不满足时必须 blocked/fail-closed，不能升级成 product pass。
- macOS real-driver smoke 还要求真实 runtime hooks opt-in：`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1|true|yes|on`。目标 app 通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_*` 标量环境变量或 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 指定；平台专用 script 只是 opt-in smoke 入口，不代表默认产品路径。
- macOS real-human-input smoke 还要求 `SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER=1` 和 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND`。可选的 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON` 必须是 JSON string array。Hook 从 stdin 接收 typed input/control context；当 `capabilityProbe=true` 时，stdout 必须返回 `inputAdapterCapability`（例如 `mechanism=pid-scoped-ax` 或 app protocol），用于证明不是 CGEvent/shared system input；正常 input/control 调用 stdout 返回 refs-first JSON。Host/provider validators 仍要求 `mutatingActionExecuted=true`、`providerEvidenceWritten=true`、provider-owned evidence refs、post-input `readFrame`、takeover/resume control evidence 和 Host ledger replay。
- Linux Xpra real-driver smoke 当前验证 attach、readFrame 和 Host-owned native refs；Linux real-human-input smoke 还要求 `SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`、`xpra`、`xdotool` 和 agent-owned Xpra display。内置 input/control hook 只能用 `DISPLAY=<session.display>` 调用 `xdotool`，不能使用宿主真实 DISPLAY、全局键鼠、焦点抢占或 shared input；无法证明 display/session/window 属于 Xpra 时必须 blocked。
- Windows IDD real-driver smoke 当前验证 opt-in attach/readFrame 的 Host-owned native refs、`diagnosticOnly=false` evidence 和 Host ledger replay；Windows real-human-input smoke 还要求 `SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_HUMAN_INPUT=1`、passed Linux real closed-loop manifest、runtime input/control hook evidence、human input、takeover/pause、resume/readFrame 和 Host ledger replay。它们只在 `win32`、`SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`、driver/permission/target app 条件满足时允许真实 pass，否则必须 blocked/fail-closed。
- Dogfood product smoke 和 real-driver opt-in smoke 是不同证据面：前者从产品 UI/right pane 验证 fail-closed contract 和 Host gate，后者只在显式 opt-in 环境中验证真实 driver attach/readFrame/native refs 或 Linux/macOS/Windows human-input ledger replay。当前 macOS `vscode-editor` opt-in manifest 可证明该平台/目标 app 的真实闭环；Linux Xpra opt-in input 不能代表 macOS、Windows 或 general user-level pass，Windows IDD opt-in input 也仍被 Linux passed manifest 和 Windows platform/driver conditions gate 住。

因此文档里的 “Native Host 已存在” 只表示 package contract、manifest、ledger validator、Host-owned public attach refs 和 fail-closed smoke 路线已落位；除已经由 macOS `vscode-editor` real opt-in manifest 覆盖的平台/目标 app 外，用户级产品通过仍必须拿到目标真实 platform adapter 的 session/surface/frame/input/evidence，并证明 `diagnosticOnly=false`、hot-path input、automation barrier 和 current-run ledger replay。

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
recordPreflight()
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

这是 `capability.manifest.json` 和当前 `src/contracts.ts` smoke 认可的最小 public API。`recordPreflight` 只写 Host-owned preflight/readiness/blocked/handoff/recheck refs 和 `preflight.recorded` ledger event，不创建 session、surface 或 live refs；UI/dogfood 的一等 preflight 消费仍必须显式接入后才能声明产品层 preflight 完成。`getLedger` / `getPreflightLedger` 这类 package-local validator helper 可以存在于实现接口中，但不能作为产品 public surface；任何新增 public method 进入产品前都必须同步 manifest、ownership map 和 smoke。

当前 UI/dogfood/presentation/runtime 已接收并转发 Host preflight 字段：`nativeHostPreflight` 保存规范化 Host preflight 摘要，`preflightRef` 指向 Host readiness/preflight artifact，`preflightLedgerRef` 指向 preflight-scoped ledger，`preflightLedgerEntryRef` 指向当前 run 的 `preflight.recorded` entry，`hostReadinessRef` 指向 Host readiness evidence。`computer-use:screen-activation/...` 仍只是 UI activation placeholder，用于记录 right-pane activation request/provider-readiness placeholder；它不能冒充 Host preflight，也不能替代 Host-owned ledger refs。

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
- Real-driver opt-in smoke 只能作为平台 driver evidence；它必须保持 opt-in、fail-closed，且不能替代 dogfood product smoke 或普通 verify gate。
