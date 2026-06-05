# SciForge 项目协议

最后更新：2026-06-05

## 当前目标

SciForge 当前只围绕这次确认过的产品需求推进：

```text
用户意图 + refs-first context + Autonomy profile
  -> Agent Host / runtime capability policy
  -> 默认 Browser search 或 Computer Use preflight
  -> auto action / hard-confirm / blocked recovery
  -> GUI 只展示状态和收集授权
```

目标不是做一轮泛化 Workbench / Desktop 改造，而是让 SciForge 面向未来所有用户默认具备两类能力：

- 需要外部、实时、网页、引用或当前事实时，Agent Host 默认可以使用内置 Browser 搜索与网页证据。
- 用户表达 GUI 操作意图时，SciForge 直接进入 Computer Use 预检，不再固定回答“没有 computer use 能力”。

产品默认授权档位是 `High Autonomy`。这只表示普通低风险动作可以自动推进；支付、发送、提交、上传、删除、账号/安全、法律合规和外部系统执行等动作仍必须 hard-confirm。

设计依据见 [`docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md`](docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md)。该 spec 是需求方向，不等同于端到端实现已完成。

## 不可变原则

- 旧逻辑代码和最终目标冲突的时候，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- GUI 不是 agent host；任务推理、模型选择、tool/capability 编排、provider route 和 completion 判断归 Agent Host 或 runtime owner。
- GUI 只展示状态、收集授权、提交 terminal-equivalent intent 和 refs-first context；不得直接执行 Browser / Computer Use action。
- Browser live surface 必须由 BrowserHostSession + Desktop native host 提供；Vite/Web dev 只能显示 UI/diagnostic，不得假装 product-ready。
- Computer Use action 必须走 Agent Host / WindowActionSession / host adapter；Image/Evidence pane、截图 replay、frame stream、PDF、proxy render 不能成为第二个可交互目标。
- 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- 不得静默 fallback 到未注册 provider/model/profile；缺配置必须 fail closed 或显式降级说明。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。

## 长文件拆分登记

本节用于满足“业务代码单文件超过约 2000 行时必须拆分或登记拆分任务”的不可变规则。登记不是永久豁免；后续触碰对应文件时应优先把新增逻辑迁到更小 owner 模块，并保持现有测试不回退。

| 文件 | 2026-06-05 状态 | 后续拆分方向 |
| --- | --- | --- |
| `src/runtime/browser-host-session.ts` | registered-watch | 拆分 session lifecycle、risk ledger、native adapter driver、search/automation summary。 |
| `src/ui/src/app/appShell/ShellPanels.tsx` | registered-watch | 拆分 sidebar shell、project/thread rows、background agent projection、panel layout owner。 |
| `tools/computer-use-next/live-acceptance-validator.ts` | registered-watch | 拆分 schema validation、refs-first evidence checks、platform-specific live checks、report writer。 |
| `src/ui/src/app/chat/cursorAgentProcess.ts` | registered-watch | 拆分 sanitizer、row projection、folding model、object-ref route。 |
| `src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` | touched-this-round-registered | 拆分 runtime event schema、public metadata sanitizer、GUI event projection、failure classification。 |
| `tools/computer-use-next/virtual-app-screen-vscode-smoke.ts` | registered-watch | 拆分 preflight、launch/session attach、input workflow、verifier/report sections。 |
| `packages/presentation/components/virtual-screen-viewer/render.tsx` | registered-watch | 拆分 viewer shell、frame renderer、controls、diagnostic overlays。 |
| `src/ui/src/api/workspaceClient.ts` | registered-watch | 拆分 file API、task/session API、artifact refs、diagnostics clients。 |
| `src/runtime/workspace-server.ts` | registered-watch | 拆分 route groups、workspace file service、task lifecycle、evidence endpoints。 |
| `tools/computer-use-next/product-smoke-matrix.ts` | registered-watch | 拆分 case registry、manifest builder、gate validation、CLI/report output。 |
| `src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx` | registered-watch | 拆分 list model、detail view、diagnostics panel、repair action controls。 |
| `src/ui/src/api/sciforgeToolsClient/client.ts` | registered-watch | 拆分 runtime failure metadata、public metadata scrubber、request builders。 |
| `src/ui/src/app/SciForgeApp.tsx` | registered-watch | 拆分 shell composition、runtime wiring、workspace/session providers、modal orchestration。 |

## T122 源码语义迁移登记

`docs/native-extension-src-semantics-baseline.json` 是当前活跃 T122 基线：它只登记既有 `src/**` 中尚未迁移到 package-owned manifest/policy 的 capability semantics。新增或增加这些语义必须优先迁入 package-owned policy；只有明确登记迁移债时才允许更新该基线。

## 当前任务板：默认 Browser Search / Computer Use

状态原则：

- `[x]` 只能表示当前活动产品聊天链路或明确的文档调查项已经验证。
- `[ ]` 表示尚未实现、尚未接入活动聊天链路、只有局部测试通过，或还需要和用户确认取舍。
- 本文档是唯一活动任务板，不再新增 `PROJECT_*.md`。

### 0. 已确认事实

- [x] 根目录只保留一个 [`PROJECT.md`](PROJECT.md)；`PROJECT_workbench.md` 和 `PROJECT_desktop_actions.md` 已删除，旧任务只保留在 archive 中。
- [x] 需求 spec 已存在，但 spec 明确写着“当前文档更新不代表代码已经完成”。
- [x] Composer 已出现 `Autonomy` 选择项，且只保留 `Assisted Autonomy`、`High Autonomy`、`Research Sandbox Max` 三档；默认展示为 `High Autonomy`。
- [x] `generation-gateway` 已有局部 capability truth / Browser search / Computer Use preflight policy 与测试，但这不能证明正常聊天路径已经接入。
- [x] Desktop native Browser surface readiness 已有 Electron / Workspace Writer / UI 三层定义；Vite/Web dev 不应声明 product-ready。
- [x] 当前误答“我没有直接 computer use 能力”的最可能原因不是前端硬编码，而是正常 composer chat 绕过了 grounded capability truth，直接进入 Runtime Codex 生成。

### 1. P0：统一普通聊天的能力事实入口

- [ ] 正常 composer chat 必须先进入一个统一 turn router / Agent Host policy stage，再由该 router 决定 Browser search、Computer Use preflight、Runtime Codex 或其它能力。
- [ ] 用户问“你有 computer use 能力么 / 你能操作浏览器么”时，正常聊天路径必须命中 capability truth，而不是让模型自由生成自我能力判断。
- [ ] capability truth 必须读取当前 workspace writer、BrowserHostSession、native surface、WindowActionSession、Computer Use adapter、target binding、fresh observation、permission refs 和 stop/cancel path；不能只依赖手工塞进 `uiState` 的测试数据。
- [ ] Web dev/Vite 下回答必须说明 `native-bridge-unavailable` 或对应 blocker；Desktop native ready 时必须说明可进入 Browser search 或 Computer Use preflight。
- [ ] 新增端到端测试：从 UI normal composer request 或等价 transport request 发送“你有 computer use 能力么”，断言不出现固定否认文案，且返回 product capability + current readiness + next action。
- [ ] 新增回归测试：历史消息不会被改写，但新 turn 必须使用新的 capability truth。

### 2. P0：默认内置 Browser 搜索接入活动聊天链路

- [ ] 外部、实时、网页、引用、当前事实、URL 和 Browser refs 请求，在正常聊天链路中默认进入 Browser search/read evidence。
- [ ] 用户明确禁止联网、要求只用本地上下文，或搜索会触发登录、付费、敏感数据传输、第三方动作时，默认不搜索。
- [ ] Browser search 输出必须包含 source URL、时间、bounded summary 和 evidence refs；raw DOM、raw logs、cookie、token、完整私密 URL、截图 base64 不进入主 payload。
- [ ] 新增端到端测试：普通聊天请求触发 Browser search runtime，而不是只在直接调用 `runWorkspaceRuntimeGateway` 的单元测试中通过。
- [ ] 确认并记录 Browser pane direct actions 与聊天 Browser search 的边界：Browser pane 可以操作当前 BrowserHostSession，但聊天的事实搜索仍归 Agent Host policy。

### 3. P0：Computer Use 默认预检接入活动聊天链路

- [ ] 用户表达 GUI 操作意图时，正常聊天链路必须直接进入 Computer Use preflight，不要求用户输入 `/computer-use`。
- [ ] Preflight 必须 fail closed：缺 native host、native surface、target binding、fresh observation、permission ref、Computer Use adapter 或 cancel path 时返回 blocker 与恢复建议。
- [ ] 可自动执行、needs-confirmation、blocked 三类风险必须由 Host/runtime policy 判定；GUI、网页内容、模型输出或 tool result 不能扩大授权。
- [ ] hard-confirm UI 必须展示 action、target、impact、evidence refs、authorization profile、Confirm / Cancel；确认只覆盖当前 action、action type 或当前 turn 的明确范围。
- [ ] 新增端到端测试：普通聊天“帮我打开网页并点击...”进入 preflight；ready 时进入 action path，blocked 时给出具体 blocker。
- [ ] 新增端到端测试：支付、发送、提交、上传、删除、账号/安全、法律合规和外部系统执行必须 hard-confirm，不因 `High Autonomy` 绕过。

### 4. P0：Runtime readiness feed

- [ ] 建立 Browser / Computer Use readiness projection owner：可以由 Workspace Writer 主动 probe，也可以由 UI 提交 bounded refs，但最终由 Agent Host/runtime 解释，不由模型猜测。
- [ ] 正常 Runtime Codex 请求不得只把 Autonomy 和 readiness 放进 audit-only 文本；需要有受边界保护的结构化 public metadata 或先经过 gateway。
- [ ] 如果保留 Runtime Codex 作为下游生成器，必须在它启动前注入 grounded capability facts，避免下游模型回答“我没有直接能力”。
- [ ] Desktop product path 必须优先使用 Electron dynamic workspace writer；Web dev source writer 只能作为 diagnostic，不得覆盖 Desktop native ready 状态。
- [ ] Health/preflight evidence refs 必须 refs-first、bounded、脱敏，并能在聊天回答和 run audit 中追溯。

### 5. P1：聊天链路梳理与合并决策

当前调查到的链路至少如下：

| 编号 | 链路 | 当前角色 | 问题 |
| --- | --- | --- | --- |
| C1 | Composer normal chat -> `runPromptOrchestrator` -> `sendSciForgeToolMessage` -> Runtime Codex WS/SSE -> Codex app-server | 当前默认普通聊天 | 没有结构化 Browser/CU readiness；会绕过 gateway capability truth。 |
| C2 | `/api/sciforge/tools/run/stream` -> `runWorkspaceRuntimeGateway` -> `generation-gateway` | 局部 policy / legacy diagnostic / 直接 API | 有 capability truth 与 Browser search policy，但不是普通聊天默认入口。 |
| C3 | `generation-gateway` 内部 `codex-runtime-bridge` | gateway 内的 Codex 下游桥 | 和 C1 形成重复入口，需要决定是否保留。 |
| C4 | `/computer-use ...` commandText -> Runtime Codex host-owned native route | slash/approval 专用 Computer Use 路径 | 仍依赖 slash command，不满足“GUI 意图默认预检”。 |
| C5 | Runtime GUI approval / guidance / cancel realtime controls | 活动 run 控制通道 | 不是新聊天生成入口，但必须和 hard-confirm 兼容。 |
| C6 | Browser pane direct actions/search -> BrowserHostSession routes | 右侧 Browser surface 直接控制 | 不是聊天入口，不能成为第二个 Agent Host。 |
| C7 | annotation-plan-only / demo-local response | 本地特殊分支 | 不能影响默认能力判断。 |

待讨论的合并方向：

- [ ] 推荐方向：保留一个默认聊天入口 `Composer -> Turn Router / Agent Host Gateway -> policy stages -> downstream runtime`；Runtime Codex 只作为下游执行/生成能力，不再作为绕过 policy 的默认入口。
- [ ] Browser pane direct actions 保留为 BrowserHostSession 的 projection/action adapter，但其结果以 refs 进入 Agent Host，不直接决定聊天回答。
- [ ] `/computer-use` slash path 降级为调试/专家入口；普通 GUI 意图由 preflight 自动路由。
- [ ] legacy `/tools/run/stream` diagnostic shim 在默认入口迁移完成后删除或封存为测试 harness。
- [ ] 决定 C1 与 C3 是否合并：若 gateway 成为唯一入口，C1 应改为调用 gateway；若 Runtime Codex 保留直连，则必须在 C1 前增加同等 policy gate。

### 6. P1：Composer Autonomy 成为真实授权输入

- [x] 输入栏显示三档授权模式，默认 `High Autonomy`。
- [ ] `Autonomy` 不能只作为 audit/guiLocalProjection；必须成为 Agent Host risk classifier 和 Computer Use preflight 的结构化输入。
- [ ] 授权档位作用域为当前用户 + 当前 workspace，并支持单轮 override；需要端到端验证而不是只验证 UI action log。
- [ ] runtime 不能静默升级档位；第三方内容、模型输出或 tool result 不能修改档位。
- [ ] Team/admin 最大授权档位可作为未来扩展，但本轮不实现。

### 7. P1：验收与测试口径重置

- [ ] 移除“局部测试 passed 即任务完成”的验收口径；端到端默认聊天链路未覆盖时不能标 `[x]`。
- [ ] Capability answer tests 覆盖 ready、blocked、Web dev、native surface unavailable，并通过正常聊天 transport。
- [ ] Browser default tests 覆盖 fresh/external/current/URL/search-needed 和 no-network/local-only 场景，并证明从 composer 进入 Browser search。
- [ ] Computer Use preflight tests 覆盖 target、surface、observation、permission、cancel path 缺失的 fail-closed，并证明普通 GUI 意图会触发。
- [ ] Desktop smoke 使用 Electron native host 验证 BrowserHostSession、native surface、Computer Use preflight 和 hard-confirm surface；Vite 只作为 diagnostic。
- [ ] 文档改动至少运行 `git diff --check`；实现改动必须补充 focused tests 和 Desktop native product smoke。

## 非目标

- 不做泛化 Workbench / Desktop 投影任务。
- 不新增或保留 `PROJECT_*.md` 活动任务板。
- 不把 GUI 升级为 Agent Host。
- 不用 iframe、proxy、screenshot replay、frame stream、PDF、document projection 或系统浏览器冒充 Browser live surface。
- 不做和本需求无关的 Model Router、图片理解、sidebar、右侧 pane、文件 viewer 或通用桌面重构。
- 不移除 hard-confirm，也不允许任何默认档位绕过真实外部影响确认。

## 当前验收标准

1. 用户问“你有 computer use 能力么”时，新的普通聊天 turn 必须说明产品能力、当前 runtime readiness 和下一步动作；blocked 时给出具体原因。
2. 需要当前网页事实或引用来源的任务默认使用内置 Browser search，并产出 refs-first evidence。
3. 用户表达 GUI 操作意图时，SciForge 直接进入 Computer Use preflight。
4. 输入栏只展示三个授权档位，默认 `High Autonomy`，并能随本轮 request 进入 Agent Host risk policy。
5. `High Autonomy` 不绕过 hard-confirm 或 blocked policy。
6. 缺 native host / native surface / target binding / fresh observation / permission refs / cancel path 时 fail closed。
7. GUI 始终是 projection 和授权收集层，不拥有 Agent Host、provider route、Computer Use executor 或 completion 判断。
8. 旧历史消息不需要改写；新消息必须走新的 grounded capability path。

## 相关文档

- [`docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md`](docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md)：默认能力设计。
- [`docs/Architecture.md`](docs/Architecture.md)：Agent Host Semantic Pipeline 和 GUI-as-extension。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：BrowserHostSession single truth 与 Desktop native Browser。
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)：Annotation / Image Evidence / Window Action 边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native / runtime / GUI ownership。
- [`docs/Usage.md`](docs/Usage.md)：Computer Use 使用、权限和验证说明。
