# VirtualAppScreen / Native Host / Virtual Display Provider 设计

最后更新：2026-06-03

## 目标结论

SciForge 的虚拟屏幕目标不是“截取用户真实桌面”，而是：

```text
app 真实运行在 agent-owned virtual display / app surface 中
-> SciForge Screen 显示 live frame
-> 用户和 agent 的输入进入这个 app surface
-> 用户物理桌面、鼠标、键盘和当前焦点不被打扰
-> evidence 证明 frame、输入、产物和隔离性来自同一当前会话
```

产品层统一叫 `VirtualAppScreen`。终局 C 的权威边界是 `packages/` 下模块化的 `NativeVirtualAppScreenHost`，它拥有 session、surface、input、permission、grant 和 evidence writer。底层不要押宝一个跨平台虚拟显示器驱动，因为 macOS、Linux、Windows 的显示栈不同；要押宝统一的 host protocol，再把 `VirtualDisplayProvider` 降级为 host 内部平台 adapter。

推荐主线：

```text
VirtualAppScreen
-> NativeVirtualAppScreenHost
   -> host-owned session / surface / input queue / evidence writer
   -> platform adapters
   -> macOS CGVirtualDisplay / ScreenCaptureKit provider
   -> Windows Indirect Display Driver provider
   -> Linux Xpra / headless compositor provider
-> native presented surface or WebRTC low-latency frame transport
-> human fire-and-release input + automation barrier
-> before/after evidence + verifier + evidence ledger
```

当前实现只接受本地原生 app + Host-owned 平台虚拟显示/app surface 这一条真相源。`serve-web`、code-server、OpenVSCode、Xvfb/noVNC、RDP、QEMU/VM 和 shell/browser shortcut 都不能替代 Native Host 通过验收。高性能产品默认应使用 native presented surface、WebRTC 或等价低延迟 streaming transport；失败时进入 blocked/handoff/retry。

## Host-Owned, Reuse Under The Hood 原则

VirtualAppScreen 应自建 SciForge Native Host 作为权威控制面，但底层应优先复用成熟 OS API、驱动、编码库或开源组件，而不是重写显示驱动、远程桌面、编码器、VM 或窗口转发栈。

优先级固定为：

```text
1. SciForge Host protocol / grant / input / evidence control plane 自己拥有
2. 直接调用成熟 OS API、驱动、编码库或服务
3. 写最薄 platform adapter，负责 probe、lifecycle、refs、evidence 和 policy glue
4. 只在工具缺口明确、许可证/权限/性能不满足时自研最小 backend
5. 不 fork 大型工具，除非必须修复 upstream 缺陷并有退出计划
```

SciForge 自己不应该实现：

- 通用 VNC/RDP viewer。
- 通用视频编码/传输栈。
- 通用 VM hypervisor。
- 通用跨平台虚拟显示驱动。
- 通用 X11/Wayland/WindowServer/Windows compositor。

SciForge 应该实现：

- `NativeVirtualAppScreenHost` protocol、grant、session ownership、input queue 和 evidence writer。
- Host-owned `recordPreflight`，用于无 attached session 时记录当前 run 的 permission、driver、provider readiness、blocked/handoff/recheck refs 和 preflight-scoped ledger；它不能创建 live surface，也不能让 UI placeholder 冒充 Host preflight。
- Host-owned preflight/readiness refs 的一等传播：UI、dogfood、presentation viewer 和 runtime attach payload 必须保留 `nativeHostPreflight`、`preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef` 和 `hostReadinessRef`，并把它们视为 Host evidence，而不是 provider/UI placeholder evidence。
- provider discovery、install check、health check 和 readiness refs。
- VirtualAppScreen session lifecycle。
- app/window/session/display refs。
- Screen pane live surface binding。
- InputIntent、lease、approval、before/after evidence、verifier 和 user-acceptance manifest。
- 对已安装工具的最小 glue code 和 policy guard。

### 安装模型

每个 provider 必须支持三种状态：

| 状态 | 含义 | 行为 |
|---|---|---|
| `installed` | 本机已有工具、驱动或服务。 | 正常 probe 和 create session。 |
| `installable` | 当前平台有已知安装方式，但尚未安装或未授权。 | 返回 install hint，不自动提权安装驱动。 |
| `unsupported` | 当前平台没有可用 backend 或依赖不满足。 | fail closed，输出 blocked reason。 |

直接安装策略：

- 普通用户态工具可以给出自动安装命令或在用户确认后执行，例如 `brew install`、`apt install`、`winget install`、`npm install`、下载 release binary。
- 驱动、系统扩展、Screen Recording、Accessibility、kernel/system permission 必须显式 handoff 给用户确认，不能静默安装或授权。
- 工具版本、安装路径、health 输出、权限状态和 license family 必须写入 `adapterReadinessRef`。
- CI 和本地 smoke 可以写 readiness/blocked 诊断，但不能用 fixture、Xvfb/noVNC、web app surface 或 shell-only runner 代替 Host-owned 本地原生 virtual display/app surface 通过用户级验收。

### Provider / Reference Tool 清单

| 平台 | 首选复用工具 | 安装方式建议 | SciForge 只写什么 |
|---|---|---|---|
| macOS | SciForge Swift/native helper + ScreenCaptureKit；`node-mac-virtual-display` 类 bridge 仅作 PoC/reference | bundled native helper 或 npm/native dependency；必要权限走用户 handoff | Host adapter、ScreenCaptureKit capture、window placement、permission probe、evidence writer |
| Linux | Xpra 或 headless compositor | 系统包管理器安装 | Host adapter、session lifecycle、app launch、frame transport bridge、input/evidence refs |
| Windows | Windows IDD virtual display driver / Virtual-Display-Driver 类项目 | 用户确认安装驱动 | Host adapter、display/session lifecycle、Windows capture/input adapter |
| Low-latency reference | Sunshine/Moonlight style stack | dev-only install | performance benchmark/reference，不作为 host control plane |
| Third-party virtual screen UI | DeskPad / BetterDisplay / Mirage | manual research only | 调研、benchmark、诊断；不 mint host grant、不作为 acceptance owner |

### 不把工具成功当成验收成功

安装成功只代表 provider `installed`。用户级成功仍必须有当前 run 的：

- active `sessionRef`、`screenRef`、`targetAppRef`、`targetWindowRef`。
- live `frameStreamRef` 或 `currentFrameRef`。
- input lease、executor event、before/after frame。
- isolation flags。
- artifact/verifier/gui.present refs。

例如 `noVNC` 能打开页面不等于 Computer Use 成功；`Xvfb` 能创建 display 不等于 app 已完成任务；`node-mac-virtual-display` 能创建屏幕不等于输入隔离已满足。

## 术语

| 名称 | 含义 |
|---|---|
| `VirtualAppScreen` | 用户在 SciForge 右侧 `Screen` pane 看到和操作的一块 app 级虚拟屏幕。一个 screen 绑定一个 app/session/window。 |
| `NativeVirtualAppScreenHost` | Native surface/display/session 的权威 owner。负责 permission、session lifecycle、surface presentation、input queue、automation barrier、grant 和 evidence writer。React viewer、runtime command 和 provider adapter 都不是 live truth owner。 |
| `App Surface` | app 的可渲染、可输入、可验证界面层。VirtualAppScreen 用户级验收只接受原生虚拟 display、Xpra window、Windows IDD display 或 app protocol 绑定到同一 native provider 的 surface。 |
| `VirtualDisplayProvider` | Host 内部平台 adapter。负责创建/销毁虚拟显示资源、启动 app、绑定窗口、输出 frame stream、接收 scoped input、产出 readiness/evidence refs。 |
| `SurfaceTransport` | 把 provider frame 送到 GUI 的 transport。当前用户级 live path 只接受 native presented surface、WebRTC 或等价 Host-owned native frame stream；WebCodecs 是 implementation layer，MJPEG/PNG delta 只能 diagnostic/fallback。 |
| `InputIntent` | GUI 产生的终端等价鼠标/键盘/滚动/拖拽/菜单意图。GUI 不直接执行输入，只提交给 Computer Use action provider。 |
| `ActionAdapter` | 将 `InputIntent` 变成 app/window scoped action 的执行器，例如 AX/UIA/AT-SPI、app command、isolated virtual-display input。 |

## 为什么 backend/host 是核心

浏览器 viewer 只能显示已有屏幕；它不负责创建 virtual display、启动 app、移动窗口、持续渲染、隔离输入或证明没有影响物理桌面。

因此能力顺序必须是：

```text
1. Native Host 创建 agent-owned display/session
2. app 在这个 session 中真实运行并渲染
3. input 进入这个 session，而不是用户物理桌面
4. GUI viewer 把同一 live surface 展示到 Screen
5. evidence ledger 证明全部 refs 来自当前 session
```

`noVNC`、Guacamole 或普通 `<canvas>` viewer 只是第 4 步。没有第 1-3 步，它们只能显示空白或用户真实桌面，不能满足 VirtualAppScreen 的用户级验收。

## 不可变约束

- 每个 `VirtualAppScreen` 只能有一个 interactive truth：`liveSurfaceRef` / `frameStreamRef`。replay、旧 frame、PDF、snapshot、proxy page 都只能是 evidence，不得成为第二个可交互界面。
- app 窗口可以真实存在，但必须存在于 agent-owned virtual display/session 中，不占用用户物理屏幕，不抢用户当前工作焦点。
- 如果 provider 需要系统级鼠标、系统级键盘、focus steal、物理屏弹窗，当前 run 只能是 `diagnostic`、`requires-handoff` 或 `blocked`。
- GUI 只展示 refs 和发送 terminal-equivalent text / input intent；Computer Use action provider 拥有执行、lease、approval、verification 和 completion candidate。
- 大对象必须 refs-first：frame、视频、screenshot、trace、DOM/AX snapshot、provider payload、input log、artifact、audit 不得 inline 到主 payload。
- `userAcceptanceEligible=true` 必须有当前 run 的 app/session/window/frame/input/artifact/verifier/gui.present refs 和隔离 flags。

## Presentation Module 边界

虚拟屏幕 UI 必须作为 `packages/presentation/components` 下的独立 presentation module 维护。当前模块目录是：

```text
packages/presentation/components/virtual-screen-viewer
```

这个模块的边界是：

```text
virtual-screen-viewer
= render refs-first VirtualAppScreen payload
= show live/replay/blocked/observe-only state
= draw frame, actor cursor, annotation, timeline, isolation flags
= turn user gestures into terminal-equivalent InputIntent text
!= create virtual display
!= launch app
!= capture ScreenCaptureKit / Xpra frames
!= execute mouse or keyboard input
!= own lease, approval, verifier, completion, provider install, or app lifecycle
```

推荐拆分：

```text
packages/presentation/components/virtual-screen-viewer/
  manifest.ts
  contract.ts
  render.tsx
  input-intent.ts
  frame-model.ts
  isolation-model.ts
  fixtures/
  render.test.tsx
```

`contract.ts` 只包含 payload types、schema constants、normalizer 和 refs-first rejection helpers。`render.tsx` 只消费 normalized payload。`input-intent.ts` 只负责把 click/type/drag/scroll/hotkey/menu command 转成 terminal-equivalent text；它不得 import runtime provider、Computer Use executor 或 platform sidecar。

Provider/backend 代码必须放在 Computer Use 或 runtime adapter owner 下，例如：

```text
packages/actions/computer-use/virtual-app-screen-host/
src/runtime/computer-use/virtual-display-provider/   # migration shim / host-port implementation only
```

如果未来把 `virtual-screen-viewer` 发布成可复用 GUI package，它也只能通过 props/callback/ref contract 与 host 通信，不携带任何平台 provider。这样才能迁移到 Electron、Tauri、Web、Codex Desktop 或其它 GUI shell。

## Packages Module Boundary

终局模块边界固定为：

```text
packages/contracts/runtime
  -> shared VirtualAppScreenHost refs, schemas, pure validators

packages/actions/computer-use
  -> Computer Use action provider, scheduler, lease, approval, trace, acceptance

packages/actions/computer-use/virtual-app-screen-host
  -> NativeVirtualAppScreenHost package
  -> display/session/surface ownership
  -> permission/preflight/isolation
  -> frame/input transport
  -> host-owned evidence writer

packages/presentation/components/virtual-screen-viewer
  -> presentation only
  -> render native surface slot, replay, evidence, controls and overlay

src/runtime/computer-use
  -> workspace/current-run host adapter and migration shim only
```

`VirtualDisplayProvider` 是 Host 内部 platform adapter，不是产品级 truth owner。第三方虚拟屏幕软件可以成为 reference adapter 或 diagnostic adapter，但不能 mint `liveBindingAttachGrantRef`、不能直接执行产品输入、不能把自己的 UI/stream 当成 user-level acceptance。

## 当前 Contract / Smoke 对齐点

当前 contract/smoke 已经把 Native Host 路线收敛到 package-owned host，产品 runtime 也已进入 Host-backed attach 迁移期：

- `packages/actions/computer-use/virtual-app-screen-host/capability.manifest.json` 是 host package 的 single-truth manifest：session、surface、frame、permission、grant、ledger 都必须 host-owned；UI、fixture、replay、第三方 viewer 都是 forbidden live truth source。
- `src/contracts.ts` 是完整包级 contract；`src/in-memory-host.ts` + `src/ledger.ts` 是当前可运行的 fail-closed / contract-smoke host。顶层 `types.ts`、`errors.ts`、`evidence-ledger.ts` 只 re-export 该唯一 contract。默认无平台 adapter 时返回 blocked，contract-smoke adapter `diagnosticOnly=true`，只能证明 API/ledger/grant/barrier 形状。
- Dogfood smoke 当前从产品 UI 右侧 `Screen` 读取 DOM/ref chips/terminal-equivalent command，而不是直接调用 provider internals。它校验 `rightPane`、`runtimeCommandAcceptance`、`providerReadiness`、`permissionRefs`、`lastFrameRefs`、`lastInputRefs`、`vscodeOperation`、`humanIntervention`、`bounded`、`nativeHost`、`humanInputHotPath`、`automationBarrierRefs` 和 `backgroundEvidenceRefs`。
- UI/dogfood/presentation/runtime 对 Host preflight 已是 refs-first 一等传播：`nativeHostPreflight`、`preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef` 和 `hostReadinessRef` 必须跨 runtime attach、viewer normalization、DOM/ref chips 和 bounded manifest 保持 Host-owned。`computer-use:screen-activation/...` 只表示 UI activation request / provider-readiness placeholder，不能升级为 Host preflight、不能填充 Host ledger refs。
- `nativeHost`、`humanInputHotPath`、`automationBarrierRefs` 和 `backgroundEvidenceRefs` 已是 current smoke 的 passed gate：缺 Host session/surface/display refs、缺 fire-and-release input accepted refs、缺 automation barrier refs 或缺 background evidence refs 时，即使 Screen 呈 attached-shaped 状态也必须 blocked。它们是 fail-closed gate，不是用户级通过声明；真实通过仍需要 `diagnosticOnly=false` 的 platform provider evidence、live frame transport、hot-path input、automation barrier、takeover/resume 和 current-run ledger replay。
- Real-driver opt-in smoke 包括 `npm run smoke:virtual-app-screen-macos-real-driver:opt-in`、`npm run smoke:virtual-app-screen-macos-real-human-input:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in`、`npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in` 和 `npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in`。它们是显式 opt-in，不属于普通 `verify`；平台、权限、driver、target app/window、frame capture 或 isolated input/control hook 不满足时必须 blocked/fail-closed，不能把 driver evidence 升级成 product pass。Windows real-human-input 还必须先通过 passed Linux real closed-loop manifest gate，并满足 Windows `win32` / IDD driver 条件。
- Dogfood product smoke 和 real-driver opt-in smoke 是不同证据面：dogfood 证明产品 UI/right-pane gate 不假成功；real-driver opt-in 证明显式环境中的平台 attach/readFrame/native refs 或 Linux/macOS human-input ledger replay。Linux Xpra 的 isolated input 只在 agent-owned Xpra display + scoped `xdotool` 证据成立时有效，不能代表 macOS、Windows 或 general user-level pass。

这意味着当前可声明的进展是 “Native Host package contract、manifest、error taxonomy、ledger validator、Host-owned public attach refs、viewer/runtime grant validation 和 dogfood Native Host gates 已对齐”；还不能声明 “真实 Native Host 产品路径已通过”。

## Host Protocol / Provider Adapter Contract

`NativeVirtualAppScreenHost` 是 Computer Use 的 L1 resource adapter，通过 Codex native tool/plugin/MCP、`module.describe/query/read/invoke` 或 action-provider host port 暴露能力。公共能力必须是声明式、refs-first、fail-closed。`VirtualDisplayProvider` 是 Host 内部 platform adapter；它不能绕过 host 直接面向 GUI 或 user-level acceptance。

### describe

必须返回：

```ts
type NativeVirtualAppScreenHostDescription = {
  schemaVersion: 'sciforge.computer-use.native-virtual-app-screen-host.v1';
  hostId: string;
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  backendKind: string;
  protocol: Array<
    | 'describe'
    | 'probe'
    | 'createSession'
    | 'launchOrAttachApp'
    | 'attachSurface'
    | 'presentSurface'
    | 'readFrame'
    | 'sendHumanInput'
    | 'executeAutomationIntent'
    | 'pauseAgent'
    | 'resumeAgent'
    | 'closeSession'
    | 'validateGrant'
  >;
  supportedApps: string[];
  supportedTransports: Array<'native-presented-surface' | 'webrtc' | 'native-frame-stream'>;
  supportedInputAdapters: Array<'app-command' | 'ax' | 'uia' | 'at-spi' | 'virtual-display-input'>;
  capabilities: {
    createDisplay: boolean;
    launchApp: boolean;
    attachWindow: boolean;
    captureFrame: boolean;
    streamFrames: boolean;
    sendHumanInput: boolean;
    executeAutomationIntent: boolean;
    validateGrant: boolean;
    writeEvidenceLedger: boolean;
    backgroundRenderable: boolean;
    affectsPhysicalDisplay: boolean;
    requiresFocusSteal: boolean;
    sharedSystemInputUsed: boolean;
  };
  permissionRefs: string[];
  blockedReason?: string;
  diagnosticOnly: boolean;
  thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only';
};
```

### invoke intents

| Intent | 作用 | 输出 |
|---|---|---|
| `probe` | 只读检测 provider、权限、虚拟显示、capture 和 input 能力。 | `adapterReadinessRef`, `permissionRefs`, `driverRefs`, `providerRefs`, optional `handoffRef` / `recheckRef` |
| `createSession` | 创建 agent-owned display/session，不启动任务 app。 | `sessionRef` / `hostSessionRef`, `currentRunPointerRef`, `evidenceLedgerRef` |
| `launchOrAttachApp` | 在 session/display 中启动 app，或 attach 到已有目标 app。 | `targetAppRef`, `targetWindowRef`, `app.launched` ledger event |
| `attachSurface` | 绑定 live frame stream 并 mint host grant。 | `liveSurfaceRef`, `liveBindingAttachGrantRef`, `surfaceTransportRef`, `frameStreamRef` |
| `presentSurface` | 根据 host-issued grant 把 live surface present 到右侧 Screen。 | `presentedSurfaceRef` 或 `grant.validated` ledger event，plus `guiPresentRef` from evidence context |
| `readFrame` | 读取当前 host surface frame。 | `frameRef`, `currentFrameRef`, `frameHash`, `frameSequence`, `frameStreamRef` |
| `sendHumanInput` | 真人热路径输入，host queue accepted 后立即返回。 | `inputAcceptedRef`, `inputSequence`, `fireAndRelease=true`, `evidenceWillCatchUp=true` |
| `executeAutomationIntent` | 自动化动作，在 lease 下执行 scoped input 并等待 barrier/evidence。 | `automationBarrierRef`, before/after frame refs, `verifierRef`, `evidenceLedgerRef` |
| `validateGrant` | dereference / validate live attach grant 与当前 host session record。 | `grant.validated` ledger event 或 blocked `invalid-grant` |
| `pauseAgent` / `resumeAgent` | 暂停或恢复 agent queue；resume 必须带 readiness barrier。 | `agent.paused` / `agent.resumed` ledger event |
| `closeSession` | 安全关闭 session/display/app，避免关闭用户窗口。 | `session.closed` ledger event |

Permission handoff 当前通过 UI/terminal-equivalent `/computer-use permission-handoff` route、`permission.handoff` / `permission.recheck` ledger event 和 `handoffRef` / `recheckRef` 表达；它不是当前 `capability.manifest.json` 中单独的 Host public method。

真人输入不能等待 evidence 完整性；自动化动作不能只凭真人输入 ack 宣称完成。后台 evidence worker 负责把 frame/input/action ledger 追上当前 sequence。

### Readiness Record

每个 provider 在执行前必须产出：

```ts
type NativeHostReadinessRecord = {
  schemaVersion: 'sciforge.computer-use.native-virtual-app-screen-host.v1';
  status: 'ready' | 'blocked' | 'requires-handoff' | 'installable' | 'unsupported';
  adapterKind: string;
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  checkedAt: string;
  adapterReadinessRef: string;
  permissionRefs: string[];
  driverRefs: string[];
  providerRefs: string[];
  capabilities: NativeHostCapabilityFlags;
  diagnosticOnly: boolean;
  blockedReason?: string;
  handoffRef?: string;
  recheckRef?: string;
};
```

## 平台 Backend 推荐

### macOS

主线：SciForge Native Host helper 管理 virtual display / app surface + `ScreenCaptureKit` frame capture。

推荐顺序：

1. 自研 Swift/native helper，直接管理 virtual display、window placement、ScreenCaptureKit stream、permission probe 和 evidence writer。
2. `node-mac-virtual-display` 类 Node/native bridge，只作为 PoC/reference adapter，验证 create/destroy virtual display。
3. DeskPad / BetterDisplay / Mirage 类工具只作为人工对照、benchmark 或诊断验证，不作为 provider owner、host grant 或验收路径。

输入策略：

- 首选 app protocol / AX scoped action。
- Accessibility 可用于标准控件，但必须有 hit-test/action refs、before/after frame、verifier。
- CGEvent / shared system input 只能 diagnostic 或 explicit handoff，不能作为后台隔离成功证据。

macOS real-driver smoke 入口是 `npm run smoke:virtual-app-screen-macos-real-driver:opt-in`；macOS human-input/ledger replay 入口是 `npm run smoke:virtual-app-screen-macos-real-human-input:opt-in`。真实 runtime hooks 必须显式开启：`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1|true|yes|on`；target app 必须通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_*` 标量变量或 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 指定。human-input smoke 还需要 `SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER=1` 和 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND`，可选 args 通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON` 提供。内置 hook command 是 `npm run virtual-app-screen-macos-pid-scoped-ax-hook --silent`，只能在 env hook bridge 下运行，并且只允许 target pid/window scoped Accessibility hit-test/AXPress、AXValue 或 AX scroll action；CGEvent、System Events keystroke、共享键盘、共享 pointer 和焦点抢占都必须 blocked/diagnostic-only。外部 hook 在 `capabilityProbe=true` 调用中必须返回安全 `inputAdapterCapability`，正常 input/control 调用返回 refs-first evidence 和隔离字段。平台专用 script 只是 opt-in smoke 入口；缺 Screen Recording、Accessibility、driver helper、target app/window、readFrame、isolated input/control hook 或 Host ledger replay 条件时保持 blocked/fail-closed，不能声明 product pass。

### Linux

主线：Native Host adapter + Xpra 或 headless compositor。

推荐顺序：

1. Xpra app/window session：适合单 app surface 和 Linux GUI app。
2. Headless Wayland compositor + PipeWire/WebRTC：长期高性能路线。

输入策略：

- X session 内的 XTest/xdotool 只要绑定到 agent-owned virtual X display，就不影响用户物理桌面，可以作为 isolated input。
- 宿主全局输入、真实桌面 DISPLAY 输入必须 rejected 或 diagnostic。

Linux Xpra real-driver smoke 入口是 `npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in`，覆盖 attach、readFrame 和 Host-owned native refs。Linux Xpra real-human-input smoke 入口是 `npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in`，只在 `SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`、`xpra`、`xdotool` 和 agent-owned Xpra display 都满足时验证 Host runtime input、pause/resume 和 ledger replay。输入工具必须绑定 `DISPLAY=<session.display>`；如果会使用宿主真实 DISPLAY、全局键鼠、焦点抢占或无法证明 window 属于 Xpra session，必须 rejected/blocked。

### Windows

主线：Native Host adapter + Windows Indirect Display Driver (IDD) provider + Windows Graphics Capture / DXGI path。

Windows IDD real-driver smoke 入口是 `npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in`，由 shell-neutral Node launcher 设置 opt-in env 并支持 `--linux-manifest` / `--evidence-manifest` 参数，覆盖 opt-in attach、readFrame、Host-owned refs、`diagnosticOnly=false` evidence 和 Host ledger replay。它只在 `win32`、`SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`、driver/permission/target app 条件满足时允许真实 pass；普通平台或缺条件时必须 blocked/fail-closed，且 opted-in blocked attach 不能绿色通过实际 pass smoke。

推荐顺序：

1. IDD virtual display driver：创建虚拟显示器，让 app 窗口进入 agent display。
2. Windows Graphics Capture / Desktop Duplication 获取 frame。
3. UIA / app command 执行 scoped action。

输入策略：

- UIA、app command 优先。
- `SendInput` 是系统级输入；除非 provider 能证明输入只进入 agent-owned display/session 且不扰动用户，否则只能 diagnostic/handoff。

## Surface Transport 推荐 / 选型评估

选型评估必须平台中立：transport 选择由 Host 报告的 shell/provider/runtime capability refs、当前 run 的 surface/input/evidence refs 和实测 streamQuality refs 决定，不把选择硬编码到 macOS/Linux/Windows 任一平台。平台 adapter 可以暴露不同 capture、present、codec 或 reconnect 能力；产品层只消费 Host-owned refs-first 描述。

| Contract id | Candidate | 角色 | 优点 | 产品 live path gate |
|---|---|---|---|---|
| `native-presented-surface` | native presented surface | 桌面 shell 直接 present Host-owned surface/texture/window bounds；native frame stream 是同一类本地优化实现。 | 最低 copy/encode 开销，输入到 frame 延迟最低，适合本机 Electron/Tauri/WebView shell。 | 桌面优先主线；必须有 Host-minted `liveSurfaceRef` 或 `frameStreamRef`、`transportTelemetryRef`、grant/current-run refs、single interactive truth 和 bounded evidence refs。缺任一证明时 fail-closed 到 blocked/handoff/retry。 |
| `webrtc` | WebRTC | media track 承载 live frame，data channel 承载 fire-and-release input 或 Host route refs。 | 浏览器原生支持、跨进程/远程 shell 成熟、拥塞控制和 reconnect 生态完整。 | Web shell、远程 shell 或跨进程主线；pass 只接受 Host-owned media/data-channel refs、input/result refs 和 streamQuality refs，不能让 peer 或 viewer 成为第二 truth。缺 refs 或 fallbackRequired=true 时 fail-closed 到 blocked/handoff/retry 或 clearly marked fallback。 |
| `webcodecs` | WebCodecs | 浏览器/native codec primitive，可服务 WebRTC insertable stream、本地 encoded frame stream 或实验 encoder/decoder。 | 可降低 browser decode latency，便于做硬件 codec、backpressure 和 per-frame timing 实验。 | 评估为 implementation layer，不是 standalone product truth；必须挂在 Host-owned transport 上并保留 `liveSurfaceRef`/`frameStreamRef`、`transportTelemetryRef`、input causality refs 和 single interactive truth。无法证明 backpressure/reconnect/input-to-frame causality 时 fail-closed。 |
| `mjpeg-png-delta` | MJPEG/PNG delta | diagnostic/fallback only 的简单 frame diff/HTTP stream。 | 易实现、便于 provider bring-up、可用于低频 preflight 或 failure diagnosis。 | 不能作为 user-level live pass；只可在 clearly marked fallback、diagnostic 或 blocked artifact 中出现。若当前 run 使用它，必须写 `fallbackRequired=true`、fallback reason refs、bounded frame refs 和 no-live-pass decision refs。 |

产品 live path 固定 refs-first：frame bytes、视频、PNG/JPEG delta、codec payload 和 input logs 都不得 inline 到主 payload，只能通过 Host-owned refs 关联。无论候选 transport 是 native surface、WebRTC、WebCodecs 包装的 frame stream，还是 MJPEG/PNG delta fallback，它都只能呈现同一个 Host-owned live surface，不能成为第二套 interactive truth。

## Provider Stream Quality Measurement Contract

Provider-level stream quality measurement 是 VirtualDisplayProvider 自己产出的 bounded summary contract，不是 UI、viewer、runtime 或 browser adapter 后补的 pass 证据。contract owner 固定为 `owner=VirtualDisplayProvider`，surface/session truth 仍由 `hostSurfaceOwner=NativeVirtualAppScreenHost` 持有；产品层只消费 refs-first 结果，不读取原始 frame bytes、video chunk、provider payload 或 input log。

该 contract 复用现有 VirtualDisplay frame telemetry/transport 概念：`VirtualDisplayFrameTransportContract` 提供同一 live surface 的 media/data channel refs，`VirtualDisplayFrameTelemetrySummary` 提供 bounded end-to-end frame telemetry，`VirtualDisplaySurfaceTransportDescriptor` 关联 `liveSurfaceRef`、`frameStreamRef`、`currentFrameRef` 和 transport refs，`frameTransportReadiness` 把 readiness probe 里的 low-latency/drop/backpressure summary 暴露给 Host。

每个 provider 必须先写 refs，再让 Host/UI 消费。required refs 为：`frameTransportContractRef`、`frameTelemetryRef`、`providerStreamQualityRef`、`inputToFrameCausalityRef`、`reconnectProbeRef`、`boundedMetricSummaryRef`、`fallbackDecisionRef`。metric field source 固定是 `provider-owned-bounded-summary-ref`，`artifactPayloadMode=bounded-summary-refs-only`，`maxInlineEvidenceBytes=0`，每个字段 `inlineEvidence=forbidden`。

必需 metric fields：

| Field | Unit | Source |
|---|---|---|
| `latencyP50Ms` | ms | `provider-owned-bounded-summary-ref` |
| `latencyP95Ms` | ms | `provider-owned-bounded-summary-ref` |
| `framerateAvgFps` | fps | `provider-owned-bounded-summary-ref` |
| `framerateP5Fps` | fps | `provider-owned-bounded-summary-ref` |
| `inputToFrameP50Ms` | ms | `provider-owned-bounded-summary-ref` |
| `inputToFrameP95Ms` | ms | `provider-owned-bounded-summary-ref` |
| `reconnectP50Ms` | ms | `provider-owned-bounded-summary-ref` |
| `reconnectP95Ms` | ms | `provider-owned-bounded-summary-ref` |
| `sampleCount` | count | `provider-owned-bounded-summary-ref` |
| `fallbackRequired` | boolean | `provider-owned-bounded-summary-ref` |

`fallbackRequired=true` 必须 `status=fail-closed`：不能升级成 user-level live pass，`userLevelLivePassAllowed=false`，只允许 `allowedPresentationStates=fallback|blocked|handoff`。provider 还必须写 `fallbackDecisionRef`、fallback reason refs 和 bounded metric refs，UI 才能进入 clearly marked fallback；否则保持 blocked/handoff。

当前 real stream benchmark 状态仍是 `realRunStatus=pending-provider-samples`，`realStreamRunClaim=false`。只有真实 provider 在当前 run 产出 actual provider samples，并且 refs-first metric summary、input-to-frame causality 和 reconnect probe 都通过 Host validator 后，才能把该状态改成 real run evidence。

Checker 支持可选 sample manifest：`sampleManifestPath` 指向 `schemaVersion=sciforge.computer-use.virtual-app-screen-provider-stream-quality-sample-manifest.v1` 的 provider-owned bounded JSON。没有 manifest 时默认保持 `realRunStatus=pending-provider-samples` 和 `realStreamRunClaim=false`；有 manifest 也只表示 `sampleManifestStatus=provider-samples-validated`，不得声明 actual provider run completion。

sample manifest 必须包含 `providerRootRef`，且 `frameTransportContractRef`、`frameTelemetryRef`、`providerStreamQualityRef`、`inputToFrameCausalityRef`、`reconnectProbeRef`、`boundedMetricSummaryRef` 和 `fallbackDecisionRef` 都必须落在该 provider root 下。它还必须携带 Host-owned `currentRunPointerRef` 和 `currentRunLedgerRef`，用于把 provider metric samples 关联到当前 run，而不是让 provider refs 自己冒充 Host ledger/current-run truth。

manifest 的 `metrics` 只能包含 bounded summary numbers/booleans：`latencyP50Ms`、`latencyP95Ms`、`framerateAvgFps`、`framerateP5Fps`、`inputToFrameP50Ms`、`inputToFrameP95Ms`、`reconnectP50Ms`、`reconnectP95Ms`、`sampleCount` 和 `fallbackRequired`。`rawFrameBytes`、base64 image、video chunk、provider payload、input log 和 full trace 禁止 inline；需要回看时只能通过 refs/hash 读取外部 evidence。

## 状态机

这里的状态机描述 Screen UI 的 attach/control state；Host package 自身的 session status 更窄，当前 contract 使用 `created`、`app-attached`、`surface-attached`、`presented`、`paused`、`stopped`、`closed`、`blocked`。Dogfood manifest 的 `status` 又只有 `passed` 或 `blocked`。三者必须通过 refs 串联，不能互相冒充。

```text
no-session
-> provisioning
-> adapter-unavailable | permission-missing | blocked
-> attached
-> observe-only
-> controlling
-> paused
-> requires-handoff
-> closing
-> closed
```

关键状态语义：

| 状态 | 含义 |
|---|---|
| `no-session` | 没有 active VirtualAppScreen session。 |
| `provisioning` | 正在创建 virtual display/session 或启动 app。 |
| `adapter-unavailable` | provider 不存在、平台不支持或依赖缺失。 |
| `permission-missing` | 缺 Screen Recording、Accessibility 或 driver permission。 |
| `blocked` | provider 证明无法满足隔离或验收条件。 |
| `attached` | live surface 已绑定，Screen 可显示当前 frame。 |
| `observe-only` | 可显示 frame，但缺 input lease/action adapter，不能控制。 |
| `controlling` | 有 input lease 和 action adapter，用户/agent 输入可进入同一 surface。 |
| `requires-handoff` | 需要用户处理系统弹窗、权限、登录、多因素认证或前台交互。 |

## Evidence Bundle

每次用户级 run 至少要能引用：

- `targetAppRef`
- `targetWindowRef`
- `sessionRef`
- `displayGroupRef`
- `screenRef`
- `adapterReadinessRef`
- `liveSurfaceRef` / `frameStreamRef`
- `currentFrameRef`
- `beforeFrameRef` / `afterFrameRef`
- `inputIntentRef`
- `inputLeaseRef`
- `actionAdapterRef`
- `executorEventRef`
- `actorCursorRefs`
- `annotationOverlayRefs`
- `verificationRefs`
- `artifactRefs`
- `guiPresentRefs`
- `replayRef`
- `evidenceLedgerRef`
- `isolationFlags`

Isolation flags 必须显式：

```ts
type VirtualDisplayIsolationFlags = {
  affectsPhysicalDisplay: false;
  requiresFocusSteal: false;
  sharedSystemInputUsed: false;
  systemPointerMoved: false;
  systemKeyboardEventsSent: false;
  backgroundRenderable: true;
  singleInteractiveTruth: true;
  secondInteractiveSurfacePresent: false;
};
```

任何一项不能证明时，`userAcceptanceEligible` 必须是 `false`，并给出 `blockedReason` 或 `requires-handoff`。

## 性能目标

本地默认目标：

| 指标 | MVP | 目标 |
|---|---:|---:|
| frame rate | 15-30 fps | 30-60 fps |
| pointer-to-frame latency | < 250 ms | < 100 ms |
| keyboard-to-frame latency | < 200 ms | < 80 ms |
| first frame after attach | < 3 s | < 1 s |
| resize recovery | < 2 s | < 500 ms |

实现策略：

- adaptive resolution：默认 1280x720 或 1440x900，用户可切换 HiDPI。
- damage region / dirty rect 优先，避免全帧无脑传输。
- GPU encoder 优先：VideoToolbox(macOS)、Media Foundation/Direct3D(Windows)、VAAPI/NVENC/Linux 可选。
- pointer/cursor overlay 走 metadata/data channel，必要时 GUI 叠加 actor cursor，不强制编码进视频帧。
- 真人 input accepted ack 与 frame/evidence ack 解耦，保留 input sequence 和 timestamp；自动化 action 才要求 barrier、before/after frame refs 和 verifier refs 同步完成。

## 推荐实现阶段

### Phase 0：Native Host Package Boundary

- 建立 `packages/actions/computer-use/virtual-app-screen-host` package README、manifest、contract 和 validators。
- 定义 host protocol、grant validation、human input hot path、automation barrier 和 host-owned evidence writer。
- `src/runtime/computer-use` 只保留 host-port adapter / migration shim。

验收：文档、ownership manifest 和 package boundary 都指向 Native Host；没有 Host record 时 right pane 必须 blocked，不能用 artifact-shaped payload live attach。

### Phase 1：Provider Inventory 和安装探测

- 建立 host platform adapter registry，先登记可复用工具，而不是实现完整 backend。
- 为每个平台实现只读 `probe`：查找命令、库、驱动、服务、权限、版本和许可证摘要。
- 输出 `installed` / `installable` / `unsupported`，并给出 refs-first install hint。
- 不自动安装驱动或请求系统权限；这些必须走 explicit handoff。

验收：在没有安装工具时，Screen 返回清晰 `adapter-unavailable`；安装工具后能进入下一阶段 probe，不需要改代码。

### Phase 2：Contract 和 fail-closed gate

- 落地 `NativeVirtualAppScreenHostDescription`、readiness record、session lifecycle、transport refs。
- Screen pane 只接受 refs-first live surface 或 blocked/observe-only 状态。
- 没有真实 Host grant/provider record 时必须 blocked，不启动或抢占用户桌面 app。

### Phase 3：macOS Native Host PoC

- 优先写 SciForge Swift/native helper 创建 virtual display；`node-mac-virtual-display` 类 bridge 仅作 spike/reference。
- 启动低风险 app 到 virtual display。
- 用 ScreenCaptureKit 捕获 virtual display/window frame。
- 在 Screen pane present host-owned surface/current frame。
- 真人输入走 fire-and-release queue；自动化输入走 AX/app protocol + barrier。系统输入路径仅 diagnostic。

验收：app 窗口存在于 virtual display，用户物理屏不弹窗；Screen 能显示 current frame，blocked reason 清晰。

### Phase 4：Linux Provider

- 直接复用 Xpra app session 优先。
- 验证输入只进入 agent-owned DISPLAY。

验收：Linux GUI app 可在虚拟 session 中启动、显示、输入、before/after capture。

### Phase 5：Windows Provider

- 复用 Windows IDD virtual display driver 或 Virtual-Display-Driver 类项目。
- 捕获 virtual display frame。
- UIA/app-command input 优先。

验收：Windows app 窗口可进入虚拟显示器，Screen 显示 live frame，不影响用户当前桌面。

### Phase 6：Native/WebRTC Transport

- 桌面 shell 优先 native presented surface。
- Web shell / remote shell 优先复用成熟 WebRTC library 或 browser/native stack，不自研传输协议。
- Host -> native surface or WebRTC media track。
- Screen pane 消费 live surface。
- Human input 走 host route/data channel fire-and-release；automation intent 走 host route/data channel + barrier。
- VNC/noVNC、RDP、MJPEG 和 web app surface 只能出现在历史诊断文档中，不能作为当前用户级验收 transport。

验收：本地 30fps、低延迟输入、断线重连、single interactive truth。

### Phase 7：User-Level Acceptance

- 多 app profiles：Browser、VSCode/editor、Terminal、Notebook、PDF、CSV/table viewer。
- user-facing artifact 必须由当前 VirtualAppScreen action causality 生成。
- product smoke 拒绝 stale frame、shell-only artifact、shared system input、focus steal、physical popup。

## 工具选择顺序

### 主线

1. Platform-native virtual display provider + WebRTC transport.
2. NativeVirtualAppScreenHost package + native presented surface or WebRTC transport.
3. macOS: SciForge native helper + CGVirtualDisplay / ScreenCaptureKit provider.
4. Linux: Xpra or headless compositor provider.
5. Windows: Indirect Display Driver provider.

### 参考工具

| 工具 | 用途 |
|---|---|
| `node-mac-virtual-display` | macOS virtual display PoC。 |
| Xpra | Linux app/window session provider. |
| Virtual-Display-Driver / IDD sample | Windows provider reference. |
| Sunshine/Moonlight | low-latency streaming architecture reference. |
| DeskPad / BetterDisplay / Mirage | macOS virtual display UX/reference/diagnostic only. |

## 外部资料

- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Microsoft Indirect Display Driver model: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview
- MDN WebRTC API: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- Xpra platforms: https://github.com/Xpra-org/xpra/wiki/Platforms
- node-mac-virtual-display: https://github.com/enfp-dev-studio/node-mac-virtual-display
- Virtual Display Driver for Windows: https://github.com/VirtualDrivers/Virtual-Display-Driver
- Sunshine: https://github.com/LizardByte/Sunshine

## 和现有文档的关系

- `PROJECT_CU.md` 是 Computer Use 任务板和验收规则真相源。
- `VirtualAppScreenNativeHost.md` 是终局 C Native Host、packages 模块边界、输入热路径和 automation barrier 的设计真相源。
- `vision_computer_use_agent_mvp.md` 是 VirtualAppScreen 设计原则和 action/evidence 链路说明。
- 本文专门约束 virtual display/app surface backend 选择、跨平台策略、transport、Host protocol 和 provider adapter contract。
- `NativeExtensionOwnershipMap.md` 继续约束 GUI/TUI/Computer Use 的 ownership：GUI presentation 不执行 Computer Use，Host/provider/adapter 不做 L2 planning。
