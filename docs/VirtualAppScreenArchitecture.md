# VirtualAppScreen / Virtual Display Provider 设计

最后更新：2026-06-02

## 目标结论

SciForge 的虚拟屏幕目标不是“截取用户真实桌面”，而是：

```text
app 真实运行在 agent-owned virtual display / app surface 中
-> SciForge Screen 显示 live frame
-> 用户和 agent 的输入进入这个 app surface
-> 用户物理桌面、鼠标、键盘和当前焦点不被打扰
-> evidence 证明 frame、输入、产物和隔离性来自同一当前会话
```

产品层统一叫 `VirtualAppScreen`。底层不要押宝一个跨平台虚拟显示器驱动，因为 macOS、Linux、Windows 的显示栈不同；要押宝统一的 `VirtualDisplayProvider` contract，再为每个平台实现最强 backend。

推荐主线：

```text
VirtualAppScreen
-> VirtualDisplayProvider
   -> macOS CGVirtualDisplay / ScreenCaptureKit provider
   -> Windows Indirect Display Driver provider
   -> Linux Xpra / headless compositor provider
-> WebRTC low-latency frame transport
-> InputIntent data channel / host adapter
-> before/after evidence + verifier
```

当前实现只接受本地原生 app + 平台虚拟显示这一条真相源。`serve-web`、code-server、OpenVSCode、Xvfb/noVNC、RDP、QEMU/VM 和 shell/browser shortcut 都不能替代 native provider 通过验收。高性能产品默认应使用 native embedded surface、WebRTC 或等价低延迟 streaming transport；失败时进入 blocked/handoff/retry。

## Reuse-First 原则

VirtualAppScreen 的 backend 应优先复用并直接安装成熟工具，而不是重写显示驱动、远程桌面、编码器、VM 或窗口转发栈。

优先级固定为：

```text
1. 直接安装并调用成熟工具/驱动/服务
2. 写最薄 provider adapter，负责 probe、lifecycle、refs、evidence 和 policy
3. 只在工具缺口明确、许可证/权限/性能不满足时自研最小 backend
4. 不 fork 大型工具，除非必须修复 upstream 缺陷并有退出计划
```

SciForge 自己不应该实现：

- 通用 VNC/RDP viewer。
- 通用视频编码/传输栈。
- 通用 VM hypervisor。
- 通用跨平台虚拟显示驱动。
- 通用 X11/Wayland/WindowServer/Windows compositor。

SciForge 应该实现：

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
- CI 和本地 smoke 可以写 readiness/blocked 诊断，但不能用 fixture、Xvfb/noVNC、web app surface 或 shell-only runner 代替本地原生 virtual display provider 通过用户级验收。

### Provider 安装清单

| 平台 | 首选复用工具 | 安装方式建议 | SciForge 只写什么 |
|---|---|---|---|
| macOS | `node-mac-virtual-display` 或等价 CGVirtualDisplay bridge | npm/package dependency 或 bundled native helper；必要权限走用户 handoff | provider adapter、ScreenCaptureKit capture sidecar、window placement、permission probe |
| Linux | Xpra | 系统包管理器安装 | session lifecycle、app launch、frame transport bridge、input/evidence refs |
| Windows | Windows IDD virtual display driver / Virtual-Display-Driver 类项目 | 用户确认安装驱动 | provider probe、display/session lifecycle、Windows capture/input adapter |
| Low-latency reference | Sunshine/Moonlight style stack | dev-only install | performance benchmark/reference，不作为默认 provider API |

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
| `App Surface` | app 的可渲染、可输入、可验证界面层。VirtualAppScreen 用户级验收只接受原生虚拟 display、Xpra window、Windows IDD display 或 app protocol 绑定到同一 native provider 的 surface。 |
| `VirtualDisplayProvider` | L1 resource adapter。负责创建/销毁虚拟显示资源、启动 app、绑定窗口、输出 frame stream、接收 input intent、产出 readiness/evidence refs。 |
| `SurfaceTransport` | 把 provider frame 送到 GUI 的 transport。当前用户级验收只接受 WebRTC 或 native frame stream。 |
| `InputIntent` | GUI 产生的终端等价鼠标/键盘/滚动/拖拽/菜单意图。GUI 不直接执行输入，只提交给 Computer Use action provider。 |
| `ActionAdapter` | 将 `InputIntent` 变成 app/window scoped action 的执行器，例如 AX/UIA/AT-SPI、app command、isolated virtual-display input。 |

## 为什么 backend/host 是核心

浏览器 viewer 只能显示已有屏幕；它不负责创建 virtual display、启动 app、移动窗口、持续渲染、隔离输入或证明没有影响物理桌面。

因此能力顺序必须是：

```text
1. backend/host 创建 agent-owned display/session
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
packages/actions/computer-use/virtual-display-provider/
src/runtime/computer-use/virtual-display-provider/
```

如果未来把 `virtual-screen-viewer` 发布成可复用 GUI package，它也只能通过 props/callback/ref contract 与 host 通信，不携带任何平台 provider。这样才能迁移到 Electron、Tauri、Web、Codex Desktop 或其它 GUI shell。

## Provider Contract

`VirtualDisplayProvider` 是 Computer Use 的 L1 resource adapter，通过 `module.describe/query/read/invoke` 或 action-provider host port 暴露能力。公共能力必须是声明式、refs-first、fail-closed。

### describe

必须返回：

```ts
type VirtualDisplayProviderDescription = {
  providerId: string;
  platform: 'darwin' | 'linux' | 'win32';
  backendKind: string;
  supportedApps?: string[];
  supportedTransports: Array<'webrtc' | 'native-frame-stream'>;
  supportedInputAdapters: Array<'app-command' | 'ax' | 'uia' | 'at-spi' | 'virtual-display-input'>;
  capabilities: {
    createDisplay: boolean;
    launchApp: boolean;
    attachWindow: boolean;
    captureFrame: boolean;
    streamFrames: boolean;
    executeInputIntent: boolean;
    backgroundRenderable: boolean;
    affectsPhysicalDisplay: boolean;
    requiresFocusSteal: boolean;
    sharedSystemInputUsed: boolean;
  };
  permissionRefs?: string[];
  blockedReason?: string;
};
```

### invoke intents

| Intent | 作用 | 输出 |
|---|---|---|
| `probe` | 只读检测 provider、权限、虚拟显示、capture 和 input 能力。 | `adapterReadinessRef` |
| `createSession` | 创建 agent-owned display/session，不启动任务 app。 | `sessionRef`, `displayGroupRef`, `screenRef` |
| `launchApp` | 在 session/display 中启动 app，或 attach 到已有目标 app。 | `targetAppRef`, `targetWindowRef`, lifecycle event ref |
| `attachSurface` | 绑定 live frame stream。 | `liveSurfaceRef`, `frameStreamRef`, `currentFrameRef` |
| `executeInputIntent` | 在 lease 下执行 scoped input。 | `inputIntentRef`, `executorEventRef`, before/after frame refs |
| `pause` / `resume` | 暂停或恢复 capture/input。 | lifecycle event ref |
| `closeSession` | 安全关闭 session/display/app，避免关闭用户窗口。 | lifecycle event ref |
| `handoff` | 把无法隔离完成的动作交给用户。 | `handoffRef`, reason |

### Readiness Record

每个 provider 在执行前必须产出：

```ts
type VirtualDisplayReadiness = {
  schemaVersion: 'sciforge.virtual-display.readiness.v1';
  providerId: string;
  platform: string;
  backendKind: string;
  appIdentity?: Record<string, unknown>;
  windowIdentity?: Record<string, unknown>;
  displayIdentity?: Record<string, unknown>;
  captureSupported: boolean;
  liveSurfaceSupported: boolean;
  inputSupported: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
  systemPointerMoved: boolean;
  systemKeyboardEventsSent: boolean;
  singleInteractiveTruth: boolean;
  permissionRefs: string[];
  diagnosticRefs: string[];
  blockedReason?: string;
};
```

## 平台 Backend 推荐

### macOS

主线：`CGVirtualDisplay` / virtual display provider + `ScreenCaptureKit` frame capture。

推荐顺序：

1. `node-mac-virtual-display` 类 Node/native bridge，快速验证 create/destroy virtual display。
2. 自研 Swift sidecar，直接管理 virtual display、window placement、ScreenCaptureKit stream、permission probe。
3. DeskPad / BetterDisplay / Mirage 类工具只作为人工对照验证，不作为 provider 或验收路径。

输入策略：

- 首选 app protocol / AX scoped action。
- Accessibility 可用于标准控件，但必须有 hit-test/action refs、before/after frame、verifier。
- CGEvent / shared system input 只能 diagnostic 或 explicit handoff，不能作为后台隔离成功证据。

### Linux

主线：Xpra 或 headless compositor。

推荐顺序：

1. Xpra app/window session：适合单 app surface 和 Linux GUI app。
2. Headless Wayland compositor + PipeWire/WebRTC：长期高性能路线。

输入策略：

- X session 内的 XTest/xdotool 只要绑定到 agent-owned virtual X display，就不影响用户物理桌面，可以作为 isolated input。
- 宿主全局输入、真实桌面 DISPLAY 输入必须 rejected 或 diagnostic。

### Windows

主线：Windows Indirect Display Driver (IDD) provider + Windows Graphics Capture / DXGI path。

推荐顺序：

1. IDD virtual display driver：创建虚拟显示器，让 app 窗口进入 agent display。
2. Windows Graphics Capture / Desktop Duplication 获取 frame。
3. UIA / app command 执行 scoped action。

输入策略：

- UIA、app command 优先。
- `SendInput` 是系统级输入；除非 provider 能证明输入只进入 agent-owned display/session 且不扰动用户，否则只能 diagnostic/handoff。

## Surface Transport 推荐

| Transport | 角色 | 是否主线 |
|---|---|---|
| WebRTC | 低延迟 frame + data channel input，适合嵌入 SciForge Screen。 | 是 |
| native frame stream | 本机 Electron/Tauri/WebView 内部 transport，可作为 WebRTC 前的本地优化。 | 是 |
| Sunshine/Moonlight style | 高性能编码/低延迟设计参考，可用于实验。 | 参考，不作为默认 API |

WebRTC 是默认主线，因为它天然适合 browser-embedded low-latency media + data channel；SciForge Screen 可以直接消费同一 live surface，不需要第二个 viewer。

## 状态机

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
- input intent 和 frame ack 同步，保留 action index、timestamp、before/after frame refs。

## 推荐实现阶段

### Phase 0：Provider Inventory 和安装探测

- 建立 provider registry，先登记可复用工具，而不是实现 backend。
- 为每个平台实现只读 `probe`：查找命令、库、驱动、服务、权限、版本和许可证摘要。
- 输出 `installed` / `installable` / `unsupported`，并给出 refs-first install hint。
- 不自动安装驱动或请求系统权限；这些必须走 explicit handoff。

验收：在没有安装工具时，Screen 返回清晰 `adapter-unavailable`；安装工具后能进入下一阶段 probe，不需要改代码。

### Phase 1：Contract 和 fail-closed gate

- 落地 `VirtualDisplayProviderDescription`、readiness record、session lifecycle、transport refs。
- Screen pane 只接受 refs-first live surface 或 blocked/observe-only 状态。
- 没有真实 provider 时必须 blocked，不启动或抢占用户桌面 app。

### Phase 2：macOS PoC

- 直接复用 `node-mac-virtual-display` 类 Node/native bridge 创建 virtual display；只有 API 不满足时再写 Swift helper。
- 启动低风险 app 到 virtual display。
- 用 ScreenCaptureKit 捕获 virtual display/window frame。
- 在 Screen pane 显示 current frame。
- 输入先用 AX/app protocol；系统输入路径仅 diagnostic。

验收：app 窗口存在于 virtual display，用户物理屏不弹窗；Screen 能显示 current frame，blocked reason 清晰。

### Phase 3：Linux Provider

- 直接复用 Xpra app session 优先。
- 验证输入只进入 agent-owned DISPLAY。

验收：Linux GUI app 可在虚拟 session 中启动、显示、输入、before/after capture。

### Phase 4：Windows Provider

- 复用 Windows IDD virtual display driver 或 Virtual-Display-Driver 类项目。
- 捕获 virtual display frame。
- UIA/app-command input 优先。

验收：Windows app 窗口可进入虚拟显示器，Screen 显示 live frame，不影响用户当前桌面。

### Phase 5：WebRTC Transport

- 优先复用成熟 WebRTC library 或 browser/native stack，不自研传输协议。
- provider -> WebRTC media track。
- Screen pane 消费 live surface。
- InputIntent 走 WebRTC data channel 或 host route。
- VNC/noVNC、RDP、MJPEG 和 web app surface 只能出现在历史诊断文档中，不能作为当前用户级验收 transport。

验收：本地 30fps、低延迟输入、断线重连、single interactive truth。

### Phase 6：User-Level Acceptance

- 多 app profiles：Browser、VSCode/editor、Terminal、Notebook、PDF、CSV/table viewer。
- user-facing artifact 必须由当前 VirtualAppScreen action causality 生成。
- product smoke 拒绝 stale frame、shell-only artifact、shared system input、focus steal、physical popup。

## 工具选择顺序

### 主线

1. Platform-native virtual display provider + WebRTC transport.
2. macOS: CGVirtualDisplay / ScreenCaptureKit provider.
3. Linux: Xpra or headless compositor provider.
4. Windows: Indirect Display Driver provider.

### 参考工具

| 工具 | 用途 |
|---|---|
| `node-mac-virtual-display` | macOS virtual display PoC。 |
| Xpra | Linux app/window session provider. |
| Virtual-Display-Driver / IDD sample | Windows provider reference. |
| Sunshine/Moonlight | low-latency streaming architecture reference. |

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
- `vision_computer_use_agent_mvp.md` 是 VirtualAppScreen 设计原则和 action/evidence 链路说明。
- 本文专门约束 virtual display/app surface backend 选择、跨平台策略、transport 和 provider contract。
- `NativeExtensionOwnershipMap.md` 继续约束 GUI/TUI/Computer Use 的 ownership：GUI presentation 不执行 Computer Use，provider/adapter 不做 L2 planning。
