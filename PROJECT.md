# SciForge 项目协议

最后更新：2026-06-05

## 当前目标

SciForge 当前只围绕这次确认过的产品需求推进：

```text
用户意图 + refs-first context + Autonomy profile
  -> Codex Agent Host Turn Loop
     -> Ground: 需要什么事实/能力，当前 ready 吗
     -> Guard: 是否可自动、需确认、或必须 blocked
     -> Act / Answer: 搜索、执行、回答、请求确认或返回 blocker
  -> GUI 只展示状态、证据和确认界面
```

目标不是做一轮泛化 Workbench / Desktop 改造，而是让 SciForge 面向未来所有用户默认具备两类能力：

- 需要外部、实时、网页、引用或当前事实时，Agent Host 默认可以使用内置 Browser 搜索与网页证据。
- 用户表达 GUI 操作意图时，SciForge 在默认聊天 turn 中进入 `Guard`，不再固定回答“没有 computer use 能力”。

产品默认授权档位是 `High Autonomy`。这只表示普通低风险动作可以自动推进；支付、发送、提交、上传、删除、账号/安全、法律合规和外部系统执行等动作仍必须 hard-confirm。

设计依据见 [`docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md`](docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md)。该 spec 是需求方向，不等同于端到端实现已完成。

## 不可变原则

- 旧逻辑代码和最终目标冲突的时候，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- GUI 不是 agent host；任务推理、模型选择、tool/capability 编排、provider route 和 completion 判断归 Agent Host 或 runtime owner。
- GUI 只展示状态、收集授权、提交自然语言 intent、refs-first context、Autonomy profile 和确认/取消；debug/expert 才可生成 terminal-equivalent text；不得直接执行 Browser / Computer Use action。
- 不新增独立 turn router / gateway 产品层；默认聊天入口收敛到 Codex Agent Host Turn Loop，旧 gateway 只能作为迁移实现或 test harness。
- Runtime Codex 配置必须同时具备 `SCIFORGE_RUNTIME_API_KEY` 和 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` / upstream base URL；缺失时 fail closed，不静默 fallback。
- Browser live surface 必须由 BrowserHostSession + Desktop native host 提供；Vite/Web dev 只能显示 UI/diagnostic，不得假装 product-ready。
- Vite/Web dev 下 Browser / Computer Use live action 只能显示 blocked/diagnostic，不能冒充 Desktop native product pass。
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
| `packages/actions/computer-use/live-acceptance-validator.ts` | registered-watch | 拆分 schema validation、refs-first evidence checks、platform-specific live checks、report writer。 |
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

2026-06-05：Computer Use current-run live acceptance、completion/evidence classification、approval-chain 和 user-acceptance manifest helper 已迁入 `packages/actions/computer-use/**`；`src/runtime/**` 不得重新 import `tools/computer-use-next/**` 或 `tools/cu-user-acceptance-manifest`，`tools/computer-use-next/**` 只保留 CLI/smoke facade 或 tool-owned loader。

## 当前任务板：默认 Browser Search / Computer Use

状态原则：

- `[x]` 只能表示当前活动产品聊天链路或明确的文档调查项已经验证。
- `[ ]` 表示尚未实现、尚未接入活动聊天链路、只有局部测试通过，或还需要和用户确认取舍。
- 本文档是唯一活动任务板，不再新增 `PROJECT_*.md`。

### 0. 已确认事实

- [x] 根目录只保留一个 [`PROJECT.md`](PROJECT.md)；`PROJECT_workbench.md` 和 `PROJECT_desktop_actions.md` 已删除，旧任务只保留在 archive 中。
- [x] 需求 spec 已存在，但 spec 明确写着“当前文档更新不代表代码已经完成”。
- [x] Composer 已出现 `Autonomy` 选择项，且只保留 `Assisted Autonomy`、`High Autonomy`、`Research Sandbox Max` 三档；默认展示为 `High Autonomy`。
- [x] `generation-gateway` 已有局部 capability truth / Browser search / Computer Use Guard-like policy 与测试，但这不能证明正常聊天路径已经接入。
- [x] Desktop native Browser surface readiness 已有 Electron / Workspace Writer / UI 三层定义；Vite/Web dev 不应声明 product-ready。
- [x] 当前误答“我没有直接 computer use 能力”的最可能原因不是前端硬编码，而是正常 composer chat 绕过了 grounded capability truth，直接进入 Runtime Codex 生成。
- [x] 已确认简化命名：不新增 router；产品概念统一为 `Codex Agent Host Turn Loop`，内部只有 `Ground / Guard / Act-Answer` 三段。
- [x] 已确认边界：前端尽可能薄；Ground、Guard、Act/Answer 的决策逻辑都归 Codex/TUI Agent Host，GUI 只收集文本、refs、Autonomy 和确认结果。

### 1. P0：Codex Agent Host Turn Loop

- [x] 正常 composer chat 必须进入 Codex Agent Host Turn Loop，而不是直连 Runtime Codex。
- [x] Turn Loop 只保留三段：`Ground`、`Guard`、`Act / Answer`；不得新增独立 turn router、capability gateway 或前端决策层。
- [x] `Ground` 负责判断用户是否在问能力状态、是否需要网页事实、是否表达 GUI 操作意图、当前 Browser/CU 是否 ready、target/observation/refs 是否足够。
- [x] `Guard` 负责解释 Autonomy profile，并统一判断 auto / needs-confirmation / blocked；GUI、网页内容、模型输出、tool result 或历史 run 不能扩大授权。
- [x] `Act / Answer` 负责调用下游能力：Runtime Codex、BrowserHostSession、Computer Use adapter、本地 tools，或返回 answer、approval request、blocked recovery；Turn Loop 已支持注入 runtime-owned Computer Use Act materializer，并在缺少 runtime-owned action evidence 时 fail closed；默认产品入口已接入 composite Computer Use Act materializer，BrowserHostSession refs 仍走 BrowserHostSession low-risk adapter，VirtualAppScreen / NativeHost refs 可将单步 `GenericVisionAction` 转成 `VirtualScreenInputIntentCommand` 并经 runtime-owned input runtime 执行；多步 / artifact workflow completion claim、显式 user-level `completionTruth`、以及 package-bridge `workEvidence` 派生的 completion truth 已接入 package-owned current-run live acceptance validator，单步 action evidence、GUI 投影、fixture/replay 或历史 run 不能冒充产品完成；本地 `module.*` dynamic tools 已先过 Agent Host local tool Act policy，read/query/describe 可自动，workspace/external invoke 需要 approval + runtime-owned control path，`actions.execute` 不能从 generic local tool path 绕过 Computer Use Guard；默认 Computer Use Act materializer 已对 workflow / product / artifact completion 请求接入 Act loop wrapper，覆盖英文 `workflow/final artifact/report completion` 与中文“工作流/最终产物/报告产物完成”等意图，可按 step 刷新 runtime truth、重跑 preflight、累积 runtime-owned evidence；普通 artifact/generated-task `workEvidence` 只能作为证据累计，不能触发 completion loop 早停，只有显式 `completionTruth` 或可映射为 package-owned current-run completion truth 的 package-bridge `workEvidence` 才能结束 loop；并在预算耗尽或缺 observation / permission / stop-cancel path 时 fail closed，普通单步请求仍走原单步路径；sync legacy `/tools/run` 已封存为显式 `test` handoff + loopback `agentServerBaseUrl` 的 repair harness，最小 allowlist 拒绝 provider/action/model 路由字段和 workspace config/env fallback，runner 无 partial refs 的 runtime failure checkpoint 可进入 bounded repair rerun；缺 planner、缺 grounding、缺 runtime-owned evidence、缺 current frame / permission / validated grant / input lease / action adapter、diagnostic-only NativeHost、ungrounded pointer action、缺同轮 completion manifest 或 validator 拒绝时仍 fail closed。
- [x] 用户问“你有 computer use 能力么 / 你能操作浏览器么”时，正常聊天路径必须命中 Grounded capability truth，而不是让模型自由生成自我能力判断。
- [x] capability truth 不能只依赖手工塞进 `uiState` 的测试数据；默认聊天产品 route 已先走 runtime-side truth resolver，读取 Workspace Writer health、native adapter `/health`、BrowserHostSession state、target refs 和 fresh observation refs，并在 WindowActionSession、permission refs 或 stop/cancel path 无真实 runtime source 时 fail closed。
- [x] Act-time capability truth 必须继续接入真实 WindowActionSession store、Computer Use adapter registry、permission ledger 和 stop/cancel/takeover path materializer；runtime truth resolver 已支持注入 runtime-owner Act-time source 并拒绝 `gui.present` / `ui:*` 投影 refs 扩权；默认产品源已接入 in-memory WindowActionSession store、Computer Use adapter registry、permission ledger 和 stop/cancel/takeover store，能从 verified BrowserHostSession + native surface 产出 browser-target runtime-owned refs，也能从 runtime-owned active WindowActionSession refs 产出非 browser target/window-action/permission/stop-pause-remove refs；VirtualAppScreen NativeHost provider/native-host session store 已接入 act-time truth，要求 current frame read time、validated grant、permission refs、adapter readiness/action adapter、diagnosticOnly=false、single interactive truth 和 native-host stop/pause/close materializer；非 browser adapter registry 已支持 runtime-probe-only readiness contract；默认 composite Act materializer 已覆盖 VirtualAppScreen / NativeHost 单步 action execution，并补充 WindowActionSession 与 VirtualAppScreen NativeHost unsafe refs 回归矩阵；human takeover control/truth 已补齐 takeover/pause/resume/stop refs、`permissions.controlPath`、严格 action-shaped control ref 和 evidence-only cancel-path sanitizer；package-bridge workEvidence 到 Agent Host completionTruth adapter 已接入 Turn Loop sanitizer 和 Act loop 结束谓词；workflow / product / artifact completion 请求的 Act loop 已接入 runtime truth refresh 回调并每步重跑 preflight，普通 artifact/generated-task `workEvidence` 不再作为 completion 完成信号；sync legacy harness 边界已封口。
- [x] Web dev/Vite 下回答必须说明 `native-bridge-unavailable` 或对应 blocker；Desktop native ready 时必须说明可进入 Browser search 或 Computer Use Guard。
- [x] 新增端到端测试：从 UI normal composer request 或等价 transport request 发送“你有 computer use 能力么”，断言不出现固定否认文案，且返回 product capability + current readiness + next action。
- [x] 新增回归测试：历史消息不会被改写，但新 turn 必须使用新的 capability truth。

### 2. P0：默认内置 Browser 搜索接入活动聊天链路

- [x] 外部、实时、网页、引用、当前事实、URL 和 Browser refs 请求，在正常聊天链路中默认进入 Browser search/read evidence。
- [x] 用户明确禁止联网、要求只用本地上下文，或搜索会触发登录、付费、敏感数据传输、第三方动作时，默认不搜索。
- [x] Browser search 输出必须包含 source URL、时间、bounded summary 和 evidence refs；raw DOM、raw logs、cookie、token、完整私密 URL、截图 base64 不进入主 payload。
- [x] 新增端到端测试：普通聊天请求触发 Browser search runtime，而不是只在直接调用 `runWorkspaceRuntimeGateway` 的单元测试中通过。
- [x] 已确认 Browser 边界：Browser pane 是浏览器屏幕和控制面板，不是 Browser agent；聊天是否搜索由 Codex Agent Host 判断。
- [x] Browser pane direct actions 只提交用户明确 browser 操作意图；聊天中的网页事实搜索必须由 Codex Agent Host 触发。

### 3. P0：Computer Use 默认 Guard 接入活动聊天链路

- [x] 用户表达 GUI 操作意图时，正常聊天链路必须进入 Turn Loop `Guard`，不要求用户输入 `/computer-use`。
- [x] Guard 必须 fail closed：缺 native host、native surface、target binding、fresh observation、permission ref、Computer Use adapter 或 cancel path 时返回 blocker 与恢复建议。
- [x] 可自动执行、needs-confirmation、blocked 三类风险必须由 Host/runtime policy 判定；GUI、网页内容、模型输出或 tool result 不能扩大授权。
- [x] hard-confirm UI 必须展示 action、target、impact、evidence refs、authorization profile、Confirm / Cancel；确认只覆盖当前 action、action type 或当前 turn 的明确范围。
- [x] 新增端到端测试：普通聊天“帮我打开网页并点击...”进入 Guard；ready 时进入 action path，blocked 时给出具体 blocker。
- [x] 新增端到端测试：支付、发送、提交、上传、删除、账号/安全、法律合规和外部系统执行必须 hard-confirm，不因 `High Autonomy` 绕过。
- [x] 已确认 slash 边界：Computer Use 是默认能力，不是 slash command 功能；`/computer-use` 只保留为 debug/expert/smoke/diagnostic path。
- [x] ready Guard 不得把 GUI projection 当作 action-runner evidence；package-owned live acceptance/evidence helper 已阻断 `gui.present:*` 等 UI projection refs 冒充真实执行来源。

### 4. P0：Runtime readiness feed

- [x] 建立 Browser / Computer Use readiness projection owner：可以由 Workspace Writer 主动 probe，也可以由 UI 提交 bounded refs，但最终由 Agent Host/runtime 解释，不由模型猜测。
- [x] 正常 Runtime Codex 请求不得只把 Autonomy 和 readiness 放进 audit-only 文本；必须先经过 Codex Agent Host Turn Loop 的 Ground/Guard。
- [x] 如果保留 Runtime Codex 作为下游生成器，必须在它启动前注入 grounded capability facts，避免下游模型回答“我没有直接能力”。
- [x] Runtime Codex product route 必须优先使用 runtime truth resolver；UI/Web dev readiness projection 不能覆盖 Workspace Writer、native adapter health 或 BrowserHostSession 真实状态。
- [x] Desktop product path 必须使用 Electron dynamic workspace writer 跑 strict product smoke；Web dev source writer 只能作为 diagnostic，不得替代 Desktop native ready 状态。`smoke:desktop-computer-use-hard-confirm-product` 仍 fail-closed diagnostic；`smoke:desktop-computer-use-hard-confirm-product:strict` 会 opt-in 启动真实 Electron product shell、从 `sciforgeDesktop.getRuntimeConfig()` 校验 dynamic Workspace Writer `/health`，打开 Browser pane 建立真实 BrowserHostSession refs，再走 Runtime Codex hard-confirm probe。2026-06-05 fresh build 后 strict 已通过，manifest `canClaimPass=true`，证据覆盖 Electron product shell、dynamic Workspace Writer、native host、Runtime Codex SSE、Computer Use Guard/preflight surface 和 Confirm/Cancel hard-confirm surface。
- [x] Health / Guard evidence refs 必须 refs-first、bounded、脱敏，并能在聊天回答和 run audit 中追溯。

### 5. P1：旧链路去留

当前调查到的链路至少如下：

| 编号 | 链路 | 当前角色 | 问题 |
| --- | --- | --- | --- |
| C1 | Composer normal chat -> Codex Agent Host Turn Loop -> downstream Runtime Codex WS/SSE -> Codex app-server | 当前默认普通聊天 | 必须保持 policy-gated；若回退为直连 Runtime Codex 就会重新绕过 grounded capability truth。 |
| C2 | `/api/sciforge/tools/run/stream` -> `runWorkspaceRuntimeGateway` -> `generation-gateway` | legacy diagnostic / 直接 API / test harness | 不能重新成为默认产品入口。 |
| C3 | `generation-gateway` 内部 `codex-runtime-bridge` | legacy bridge / migration harness | 只能作为下游桥或测试基础，不能形成第二个默认入口。 |
| C4 | `/computer-use ...` commandText -> Runtime Codex host-owned native route | slash/approval debug 专用路径 | 不得作为普通 GUI 意图的必需入口。 |
| C5 | Runtime GUI approval / guidance / cancel realtime controls | 活动 run 控制通道 | 不是新聊天生成入口，但必须和 hard-confirm 兼容。 |
| C6 | Browser pane direct actions/search -> BrowserHostSession routes | 右侧 Browser surface 直接控制 | 不是聊天入口，不能成为第二个 Agent Host。 |
| C7 | annotation-plan-only / demo-local response | 本地特殊分支 | 不能影响默认能力判断。 |

已确认合并方向：

- [x] 默认聊天入口收敛为 `Composer -> Codex Agent Host Turn Loop -> downstream runtime`。
- [x] Runtime Codex 保留为下游生成/执行 runtime，不再作为绕过 policy 的默认入口。
- [x] Browser pane direct actions 保留为 BrowserHostSession 的 projection/action adapter，但其结果以 refs 进入 Agent Host，不直接决定聊天回答。
- [x] `/computer-use` slash path 降级为调试/专家入口；普通 GUI 意图由默认聊天 turn 的 Guard 处理。
- [x] 不新增独立 turn router / gateway 产品概念；旧 `generation-gateway` 可作为迁移实现基础，但文档和产品语义统一为 Codex Agent Host Turn Loop。
- [x] legacy `/tools/run/stream` diagnostic shim 在默认入口迁移完成后删除或封存为测试 harness。
- [x] legacy sync `/tools/run` 只保留显式 loopback repair harness；普通 payload、隐式 config/env AgentServer fallback 和 provider/action/model 路由字段必须 410 到 Runtime Codex stream。
- [x] 实现时消除 C1/C3 的重复入口：普通聊天必须先进 Turn Loop，Turn Loop 再按需调用 Runtime Codex。

### 6. P1：Composer Autonomy 成为真实授权输入

- [x] 输入栏显示三档授权模式，默认 `High Autonomy`。
- [x] 已确认 Autonomy 边界：GUI 只显示并提交 `profileId`；Codex Agent Host 解释授权含义并做风险判断。
- [x] `Autonomy` 不能只作为 audit/guiLocalProjection；必须成为 Codex Agent Host risk classifier 和 Guard 的结构化输入。
- [x] 授权档位作用域为当前用户 + 当前 workspace，并支持单轮 override；需要端到端验证而不是只验证 UI action log。
- [x] runtime 不能静默升级档位；第三方内容、模型输出或 tool result 不能修改档位。
- [ ] Team/admin 最大授权档位可作为未来扩展，但本轮不实现。

### 7. P1：验收与测试口径重置

- [x] 移除“局部测试 passed 即任务完成”的验收口径；端到端默认聊天链路未覆盖时不能标 `[x]`。
- [x] Capability answer tests 覆盖 ready、blocked、Web dev、native surface unavailable，并通过正常聊天 transport。
- [x] Browser default tests 覆盖 fresh/external/current/URL/search-needed 和 no-network/local-only 场景，并证明从 composer 进入 Browser search。
- [x] Computer Use Guard tests 覆盖 target、surface、observation、permission、cancel path 缺失的 fail-closed，并证明普通 GUI 意图会触发。
- [x] Desktop smoke 使用 Electron native host 验证 BrowserHostSession、native surface、Computer Use preflight 和 hard-confirm surface；Vite 只作为 diagnostic。当前已通过 Browser native strict smoke、focused Computer Use Guard/hard-confirm transport smoke、`smoke:desktop-computer-use-hard-confirm-product` 的 blocked-by-default/trusted-executor-only/dynamic-workspace-writer gate contract，以及 `smoke:desktop-computer-use-hard-confirm-product:strict` 真实 Electron executor；strict manifest `canClaimPass=true` 且包含 Confirm/Cancel hard-confirm surface。
- [x] Computer Use approval retry validator 防御性合并 GUI approval summary、approval sidecar 和 risk sidecar；缺 source sidecar 的 confirmed retry 必须 fail closed。
- [x] 文档改动至少运行 `git diff --check`；实现改动必须补充 focused tests 和 Desktop native product smoke。

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
3. 用户表达 GUI 操作意图时，SciForge 在默认聊天 turn 中进入 Guard。
4. 输入栏只展示三个授权档位，默认 `High Autonomy`，并能随本轮 request 进入 Codex Agent Host risk policy。
5. `High Autonomy` 不绕过 hard-confirm 或 blocked policy。
6. 缺 native host / native surface / target binding / fresh observation / permission refs / cancel path 时 fail closed。
7. GUI 始终是 projection 和授权收集层，不拥有 Agent Host、provider route、Computer Use executor 或 completion 判断。
8. 旧历史消息不需要改写；新消息必须走新的 grounded capability path。
9. 多步 / artifact workflow 的 product completion 不能由单步 action refs、GUI 投影、fixture/replay 或历史 run 冒充；必须由同一 current-run bundle 的 completion manifest/evidence refs 通过 package-owned live acceptance validator 后，才能提升为用户级完成。

## 相关文档

- [`docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md`](docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md)：默认能力设计。
- [`docs/Architecture.md`](docs/Architecture.md)：Agent Host Semantic Pipeline 和 GUI-as-extension。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：BrowserHostSession single truth 与 Desktop native Browser。
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)：Annotation / Image Evidence / Window Action 边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native / runtime / GUI ownership。
- [`docs/Usage.md`](docs/Usage.md)：Computer Use 使用、权限和验证说明。
