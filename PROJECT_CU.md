# SciForge Desktop Computer Use 计划

最后更新：2026-06-06

## 文档边界

本文是按当前用户指令从 [`PROJECT.md`](PROJECT.md) 拆出的 Computer Use 专项计划板。`PROJECT.md` 仍是总目标和总验收口径；本文只把“通过 SciForge 桌面 app 实现真正、复杂的 Computer Use 操作”拆成可执行阶段。

本文只列计划，不包含实现代码。

## 对齐本线程 Codex Agent 的定位

这里的 Codex 指本线程里正在工作的 Codex agent 形态，而不是另一个独立产品层或第二套 Computer Use agent。本文采用同样的能力组织方式：一个主 reasoning loop 负责理解任务、选择工具、审批、修复和判断完成；skills / plugins / MCP / native tools 只是它可调用的能力面。

```text
Codex-style Agent Host
  -> 拥有用户级任务理解、跨模块规划、tool 选择、approval、repair 和 completion 判断
  -> 通过 skills / plugins / MCP / native tools 发现和调用能力

Computer Use skill / plugin / action provider
  -> 暴露“观察和操作 GUI”的能力、边界、host-port contract 和安全策略
  -> 只负责窗口/屏幕局部动作循环、evidence、lease、grounding、execute、verify
  -> 不成为第二个 Agent Host，不拥有用户级 completion

Model Router /v1/responses
  -> 所有 textReasoner 与 translators.vision 模型调用的统一 facade
  -> Router 只做确定性模型编排和 refs-first trace，不做任务规划或完成判断
```

因此，Computer Use 不应该重复 Codex 主循环的大量 reasoning / planning 逻辑。能由主对话 Agent Host、普通 tool、MCP、Browser search、文件 API、terminal、artifact generator 或 verifier 完成的，优先走这些结构化能力。Computer Use 只在任务必须依赖当前 GUI pixels、窗口状态、视觉 grounding、真实输入、跨 app 可见操作或用户可见动作证据时介入。

Computer Use 内部可以保留“局部动作 planner”，但它的范围必须很窄：基于当前 observation 和用户/Host 给定的局部目标，输出下一步 generic GUI intent，例如 observe、crop、click target、type text、scroll、wait、save 或 blocked。它不能重新解释整个用户任务，不能跨模块选择下一步能力，不能宣布用户级完成。

## 已确认边界

- **CU 可以有局部长循环，但不能变成第二个主循环。** Computer Use 可以在同一个窗口、同一个 bound target 或同一个局部 GUI 目标内运行短到中等长度的 observe -> plan -> ground -> execute -> verify 循环。跨模块、跨任务阶段、用户级 repair 和最终完成判断仍回到 Codex-style Agent Host。
- **结构化能力优先于 GUI 操作。** 能用文件 API、terminal、MCP、Browser search、artifact generator、verifier 或 app-native command 完成的任务，优先走这些结构化能力。Computer Use 只在必须依赖当前 GUI pixels、窗口状态、视觉 grounding、真实输入或用户可见动作证据时介入。
- **shared system input 不是默认产品通过证据。** 没有 window-scoped、BrowserHostSession-scoped、app-native、PTY/editor 或 accessibility-scoped adapter 时，shared system input 只能作为 blocked、explicit handoff、diagnostic 或用户明确确认后的临时路径。它不能声明隔离、可靠或产品级 Computer Use pass。
- **完成证据必须来自当前 run 的因果链。** Completion 必须依赖当前 observation 或 artifact evidence、action causality、validator/verifier 支持和无 blocking uncertainty。文件存在、GUI 展示、模型自信、旧截图、旧 action history、fixture 或 shell-written artifact 都不能单独证明完成。
- **Skill 只负责能力说明和调用边界。** Computer Use skill 文档只说明何时使用 CU、如何传 refs/intent、风险边界、证据标准和禁止事项。复杂流程代码、provider route、executor 参数、scheduler policy、completion policy 不写进 skill；它们分别属于 Agent Host、Model Router、action provider、host ports 和 validators。

## 最终定位：GUI I/O 增强层

Computer Use 的最终定位不是“另一个 agent”，而是主 Agent Host 的 GUI I/O enhancement：

- **输入增强。** 把 Host 绑定的 target、当前窗口/屏幕状态、截图/crop/OCR、Model Router `translators.vision` observation、AX/DOM/UIA、PTY/editor/file/artifact、validator、action history 和 freshness metadata 统一成可审计 evidence ledger，再压缩成当前轮可用的 observation snapshot / controller brief。
- **输出增强。** 把 Host 给出的局部 GUI objective 或 generic intent 绑定到可执行 target，通过 WindowActionSession / scoped adapter 执行，并产出 before evidence、grounding evidence、executor event、after evidence、verification 和 stale invalidation。
- **Host 仍拥有任务脑。** 用户级任务理解、跨模块能力选择、风险审批、repair 编排、是否继续使用 Browser/file/verifier/connector、以及最终 completion 判断，都归 Codex-style Agent Host。

因此，Computer Use 专用算法代码只保留主对话无法自然覆盖的部分：窗口/屏幕观察、局部 controller、target grounding、executor lease、action ledger、freshness/stale、局部 verifier、blocked/approval handoff 和 evidence compaction。报告生成、跨 app 任务分解、artifact workflow、用户级 repair 和 completion policy 应尽量收回 Agent Host。

## 输入增强与证据组合

Computer Use 不应使用单一固定证据顺序，而应按证据用途组合。全局原则：

- **freshness > confidence。** 新的低成本证据通常优先于旧的高置信模型描述。
- **同 owner/session/target > 全局证据。** WindowActionSession / BrowserHostSession / app-native scoped evidence 优先于全屏或泛化推断。
- **结构化精确性 > 视觉摘要。** 文本、role、value、selected/disabled 等状态优先用 DOM/AX/UIA/PTY/file/validator。
- **可见像素 > 结构化 hint。** 可见存在、布局、遮挡、点击命中、视觉相似目标和图表/图片内容，以当前 screenshot/crop 为准。
- **Host binding > 模型坐标。** 模型可以建议目标描述或候选区域，最终可执行 binding 必须由 Host adapter / grounder 产出。
- **validator/artifact > 视觉印象。** 保存、导出、文件内容和用户级产物必须由 artifact refs、hash/metadata 和 validator 支持。

证据流水线收敛为：

```text
raw evidence refs
  -> evidence ledger
  -> observation snapshot
  -> local controller brief
  -> generic intent / blocked / needs-confirmation
```

按用途的默认优先级：

- Target scope：用户 annotation / manual binding -> WindowActionSession 或 BrowserHostSession targetRef -> native window metadata -> screen region auto-binding -> vision guess。
- 可见状态与可点击性：fresh window screenshot -> target crop -> OCR / Model Router vision observation -> DOM/AX hints -> prior action timeline。
- 文本与标签：DOM/AX/UIA/PTY/file text -> OCR -> Model Router vision translator -> visual inference。
- 元素 role/state：AX/UIA/DOM/app-native state -> visual cues -> OCR/vision summary。
- 可执行目标：Host adapter locator / hit-test / AX bounds / DOM rect -> crop visual grounding -> model suggested region -> blocked。
- Action 后验证：executor event + after screenshot/crop + structured state change + verifier/validator。
- Completion：Host 读取 current observation、artifact evidence、action causality、validator/verifier 和 blocking uncertainty；CU 只返回事实和 candidate refs。

## 效率策略

在能完成任务的前提下，Computer Use 必须提高操作效率。完成率、证据可信度和安全是硬约束；效率是约束内优化，主要来自少做 GUI、缩小观察范围、少调模型、少重复验证。

默认策略：

- **便宜证据先行。** 先读 session/window/action metadata 和结构化状态，再做 crop/OCR，最后才做整窗截图或视觉模型。
- **不确定才升级。** 只有目标不唯一、结构化证据不足、可见状态关键、或 verification 失败时，才升级到更重证据。
- **目标局部优先。** 已绑定窗口或区域时默认观察 target crop / window-local screenshot；只有 target 丢失、遮挡、多窗口冲突或用户要求全局屏幕时才看全屏。
- **同一 lease 下批量低风险动作。** 同一 target、同一表单或同一局部 GUI 内，允许合并低风险 type/tab/scroll/navigation 等短序列；每个 mutating action 仍写 ledger。
- **状态边界强制 checkpoint。** 导航、提交、保存/导出、上传/删除、窗口切换、modal、target 移动、focus takeover、高风险动作和 verifier failure 后必须重新 observe/verify。
- **缓存必须显式失效。** click/open/menu/navigation/scroll/type/save/window switch/focus takeover 会让相关 screenshot、OCR、object location、grounding 和 role/state cache stale。

建议把观察成本登记为 T0-T5：

```text
T0 session/window/action metadata
T1 DOM/AX/UIA/PTY/file structured state
T2 target crop / OCR
T3 fresh window screenshot
T4 Model Router vision translator
T5 before/after vision compare or verifier explanation
```

## 北极星

SciForge Desktop 的 Computer Use 不是一个单独按钮、slash command、截图回放、fixture、legacy VirtualAppScreen 或浏览器自动化 demo。目标形态是：

```text
用户在 SciForge Desktop 普通聊天输入 GUI 操作意图
  + refs-first context
  + Autonomy profile
  + 可选 annotation / browser / window refs
  -> Codex Agent Host Turn Loop
     Ground: 解析意图、绑定 target、收集当前 runtime / desktop / observation / permission 证据
     Guard: 判定 auto / needs-confirmation / blocked
     Act / Answer: 选择结构化能力或复用/创建 WindowActionSession，通过真实 host adapter 执行通用 GUI 动作
  -> Computer Use action loop
     observe/enrich -> evidence ledger -> observation snapshot -> local controller brief
     -> generic intent -> ground -> execute -> verify -> update-freshness
  -> GUI 只展示 actor cursor、状态、hard-confirm、Image/Evidence、blocked recovery 和 refs
  -> completion guard 基于当前 evidence、artifact validator 和 action causality 放行
```

最终用户看到的是 SciForge 桌面 app 在真实 Browser / app window / editor / terminal / file manager / notebook 等窗口里完成多步任务，并且每一步都有可审计的 before/after evidence、executor event、verification、artifact refs 和可停止/接管路径。

## “真正、复杂”的定义

只有同时满足以下条件，才能称为产品级 Computer Use 通过：

- 从 SciForge Desktop 普通聊天 turn 进入，不要求用户输入 `/computer-use`。
- 真实 Electron Desktop native host 在线；Web/Vite dev 只能返回 blocked/diagnostic。
- 目标是可见或可绑定的真实 BrowserHostSession、App window、Screen region 或 WindowActionSession。
- 每个 mutating action 都经过 before evidence、grounding evidence、executor event、after evidence 和 verification。
- Planner 不写裸坐标；坐标和可执行 binding 由 grounder / Host adapter 产生。
- evidence ledger 是唯一算法记忆；completion 不能来自模型自信、旧截图、fixture、DOM/AX 单独证据或 GUI projection。
- 支持多轮复杂任务：跨网页/文档/终端/编辑器/文件系统，能保存或生成真实 artifact，并由 validator 验证。
- 高风险动作 hard-confirm；缺 native host、target、fresh observation、permission ref、adapter 或 cancel path 必须 fail closed。
- 用户可以 stop / cancel / take over；失败时返回 blocked reason 和可恢复建议。

不计为通过：

- package-local fixture、target-bound diagnostic、isolated desktop legacy run、Docker/noVNC/RDP/M6 multi-screen historical smoke。
- 只读截图、Image/Evidence pane、PDF/document preview、frame stream、snapshot replay 或 GUI 私有状态。
- 只证明 Browser search、只证明 hard-confirm surface、只证明 focused runtime contract。
- shell 直接写文件后伪装成 GUI 完成。
- 仅靠 Playwright/DOM/AX/accessibility tree 完成任务而不进入 Computer Use action loop、lease、before/after evidence 和 completion guard。

## 已确认事实

- [x] `packages/actions/computer-use/vision_computer_use_agent_mvp.md` 已明确插件边界：Computer Use 插件只负责 refs-first evidence、视觉优先多信号理解、generic intent planning、Host adapter grounding/execution、verification、stale invalidation 和 fail-closed completion。
- [x] `PROJECT.md` 已确认默认产品入口是 `Codex Agent Host Turn Loop`，GUI 只提交自然语言、refs、Autonomy profile 和确认/取消。
- [x] `docs/ModelRouterArchitecture.md` 已确认 Model Router 是 provider-compatible `/v1/responses` 多模态 facade，不是新的 agent host；`textReasoner` 是 reasoning owner，`translators.vision` 只输出文本观察。
- [x] `src/runtime/codex/agent-host-turn-loop.ts` 已有 GUI-operation Guard，以及 runtime-owned Computer Use Act materializer 注入点。
- [x] `src/runtime/codex/agent-host-runtime-truth-resolver.ts` 已有 Act-time truth source 注入点，并会拒绝 `gui:*`、`ui:*`、fixture、replay、raw/base64/secret 等 refs 冒充真实执行证据。
- [x] `src/runtime/browser-host-computer-use.ts` 已有 BrowserHostSession 的 click/type/scroll/press 等 action adapter contract；它只覆盖 BrowserHostSession，不等同于全桌面 Computer Use。
- [x] `/computer-use` native route 仍可作为 debug/expert/smoke/diagnostic 入口，但不能是普通用户产品入口。
- [x] Desktop hard-confirm product smoke、Computer Use live matrix、CU-NEXT 和 package target-bound harness 已存在若干验证面，但它们还没有合成“默认聊天 -> Guard -> 真实 Act -> artifact/completion”的产品闭环。

## 不可变原则

- GUI 不是 Agent Host，也不是 Computer Use executor。GUI 只能展示、收集授权、提交 refs / Autonomy / confirmation result。
- 不新增独立 turn router/gateway 产品层。默认入口收敛到 `Composer -> Codex Agent Host Turn Loop -> Act / Answer`。
- Computer Use action 必须走 Agent Host / WindowActionSession / host adapter；Image/Evidence pane、截图 replay、frame stream、PDF、proxy render 不得成为第二个可交互目标。
- Browser live surface 必须由 BrowserHostSession + Desktop native host 提供；Web dev 只能 blocked/diagnostic。
- 大对象 refs-first；raw screenshot、base64、provider raw payload、secret、token、password、raw clipboard/IME text 不进入主 payload 或长期 trace。
- Computer Use 内所有模型调用必须统一走 Model Router `/v1/responses`，只通过公开 profile / role 选择 `textReasoner` 和 `translators.vision`，不得私接 provider、base URL、API key 或 raw model slug。
- Model Router 不是 Computer Use planner。Router 只做模态转译、bounded supplement loop、trace 和 provider-compatible 返回；任务规划、能力选择和 completion 仍归 Agent Host。
- runtime 不能静默 fallback 到未注册 provider/model/profile；缺配置 fail closed。
- `High Autonomy` 只允许低风险普通动作自动推进，不绕过 hard-confirm。
- Computer Use package 拥有 contract、局部 action loop、safety gate、evidence ledger 和 trace policy；`src/runtime` 只做 host adapter / bridge / event projection；GUI 只做 presentation。
- 业务代码单文件超过约 2000 行时，新增逻辑必须优先拆到 owner 模块或登记拆分任务。

## 当前差距

### G0：模型调用路径还需要统一收敛到 Model Router

现状：文档已有“Model Router vision translator”原则，但专项计划尚未把它写成硬验收。

目标：Computer Use 的文本 planner、视觉描述、crop inspection、candidate disambiguation、grounding translator、verifier explanation 等所有模型参与点，都通过 Model Router `/v1/responses` 和当前 workspace/profile 的 role 调用。Computer Use 代码只传 refs-first modality/input 和 instruction，不接触 provider secret、raw endpoint 或未注册 model。

### G1：Guard 已有，Act 还没有产品默认闭环

现状：`agent-host-turn-loop.ts` 在 preflight ready 后会等待 `computerUseActMaterializer`。没有 runtime-owned action evidence 时，它会 fail closed 到 `ready-for-act` 或 blocked。

目标：默认产品源必须把 ready Guard 接到真实 action runner/materializer，并返回 `window-action-session:*`、`computer-use:*`、`action-ledger:*`、`evidence:*`、`permission:*`、`cancel:*` 等 runtime-owned refs。

### G2：Act-time truth source 还未接入真实 store

现状：resolver 支持注入 `actTimeTruthSource`，并且 sanitizer 已写好。

目标：接入真实 WindowActionSession store、Computer Use adapter registry、permission ledger、fresh observation store、stop/cancel/takeover materializer。缺任一项时不能声称 ready。

### G3：Browser adapter 有形状，Desktop app/window adapter 还缺产品闭环

现状：BrowserHostSession 可以作为网页 action owner；窗口 capture、annotation、right-pane native OS UI runner、package harness 分散存在。

目标：统一成 WindowActionSession action owner，支持 Browser、app window、terminal/editor、file manager、notebook 等 target，并通过 adapter priority 选择 Browser/CDP、app-native command、PTY/editor extension、Accessibility/UIA/AT-SPI 或 explicit shared-input handoff。

### G3.5：专用算法代码需要收缩到不可替代部分

现状：如果把 Computer Use 写成独立 planner/agent，很容易和主对话 Turn Loop、Browser search、artifact workflow、verifier 和 Model Router 重复。

目标：专用代码只保留在主对话无法通用复用的部分：GUI action schema、WindowActionSession、lease/focus、host-port bridge、evidence ledger、freshness/stale、grounding binding、executor event、after-action verifier、risk handoff 和 completion evidence adapter。用户级 planning、跨模块选择、报告生成、artifact workflow 和 repair orchestration 应尽量复用主对话 Agent Host。

### G3.6：输入证据组合和效率策略尚未产品化

现状：现有文档强调 before/after evidence 和 freshness，但还没有把多来源证据组合、证据成本分层、模型调用升级条件和 batch/checkpoint 规则写成验收项。

目标：Computer Use 形成统一 evidence ledger -> observation snapshot -> local controller brief 管线；按 target scope、visible state、text/label、role/state、executable target、after-action verification 和 completion 等用途选择证据；在可靠完成前提下使用 T0-T5 成本分层、局部观察、结构化能力优先、低风险 batch 和显式 stale invalidation 降低延迟。

### G4：复杂任务验收仍被 diagnostic/legacy evidence 混淆

现状：有 CU-NEXT、computer-use-chat-live、model-router live acceptance、target-bound window probe、isolated desktop probes 等多套 harness。

目标：建立产品级 Desktop live acceptance：必须由 SciForge Desktop 普通聊天触发，使用当前 bundle evidence，完成复杂用户产物，禁止 fixture/package-local/shell/DOM-only 证据替代。

## P0：产品闭环

### 0.0 Model Router 统一模型面

- [ ] 明确 Computer Use 模型调用清单：local action planner、screenshot describe、crop inspect、OCR/vision observation summarize、candidate disambiguation、grounding translator、before/after compare、verifier explanation。
- [ ] 所有调用统一走 Model Router `/v1/responses`，使用 workspace/profile 解析出的 `textReasoner` 和 `translators.vision` role。
- [ ] Computer Use request / trace 只记录 router profile、role、trace refs、latency、status、modality refs、hash/尺寸和错误摘要。
- [ ] 禁止 Computer Use 直接读取或配置 provider URL、API key、raw model slug、未注册 provider/model/profile。
- [ ] 视觉失败时返回 observation unavailable / blocked 或让 Host 选择 text-only fallback；不得假装看过图。
- [ ] 验收：断言 CU 代码中没有绕过 Model Router 的模型 provider 调用；Model Router trace 能覆盖一次 describe + verifier 或 crop + disambiguation。

### 0.1 Runtime-owned Act-time Truth

- [ ] 定义 `CodexAgentHostActTimeTruthSource` 的默认产品实现，作为 runtime truth resolver 的唯一默认来源。
- [ ] 接入 WindowActionSession store：返回 session ready、target refs、actor cursor refs、lease refs、fresh observation refs。
- [ ] 接入 Computer Use adapter registry：返回 adapter provider id、adapter refs、capability refs、input isolation metadata。
- [ ] 接入 permission ledger：返回 session permission refs、app/window allowlist refs、risk preview refs。
- [ ] 接入 stop/cancel/takeover path：返回 cancel/stop/lease refs，并证明 GUI 可以发送确认/取消/停止结果到 Agent Host。
- [ ] 拒绝 GUI projection、Image pane、replay、fixture、raw URL/base64/secret refs 参与 ready 判定。
- [ ] 验收：普通聊天 GUI 操作意图在缺任一 runtime-owned ref 时 blocked，在 refs 完整时进入 `ready-for-act` 或 Act。

### 0.2 Runtime-owned Computer Use Act Materializer

- [ ] 实现默认 `computerUseActMaterializer` 产品源，接收 ready preflight，创建或复用 WindowActionSession。
- [ ] 将 Agent Host 已归一化的局部 GUI objective / generic intent、target refs、authorization profile、permission refs、fresh observation refs 转成 `packages/actions/computer-use` 的 request；不要让 materializer 重新解释完整用户任务。
- [ ] 注入 host ports：capture、crop、plan、locate、execute、verify、writeTrace、emitEvent。
- [ ] `plan` / `locate` / `verify` host ports 中涉及模型的部分统一调用 Model Router，不直接调用 provider。
- [ ] 所有 mutating action 写入 action ledger：before evidence、grounding evidence、executor event、after evidence、verification、freshness invalidation。
- [ ] materializer 只返回 runtime-owned evidence refs；没有 action evidence 时必须 blocked。
- [ ] 将 `needs-confirmation` 映射成 Agent Host approval request / GUI hard-confirm projection；确认后以新受控调用继续。
- [ ] 将 blocked / repair-needed 映射成可恢复 diagnostics，而不是自由文本道歉。
- [ ] 验收：ready Guard 不再停在 `ready-for-act`；至少一个低风险 BrowserHostSession action 能从普通聊天自动完成，并产生 action evidence refs。

### 0.3 WindowActionSession 产品 owner

- [ ] 明确 WindowActionSession schema：windowRef、target summary、bounds/scale/screen id、actorCursor、adapter refs、input lease、focus lease、authorization profile、permission refs、cancel refs、evidence ledger refs。
- [ ] 支持从三类来源创建/复用 session：BrowserHostSession、App window annotation/manual binding、high-confidence Screen region auto binding。
- [ ] Actor cursor 必须可见，并与 action evidence 指向同一个 session owner。
- [ ] FocusLease 只在必须使用 focused system input 时进入；默认优先非抢焦点 adapter。
- [ ] Session 失焦、窗口迁移、尺寸变化、遮挡、关闭、导航、滚动、输入后必须刷新 observation 或返回 stale/blocked。
- [ ] GUI 只能展示 session 状态、actor cursor、确认和 stop/cancel 控件；不得传 executor 参数。

### 0.4 Desktop native host adapters

- [ ] BrowserHostSession adapter：使用现有 `browser-host-computer-use` 作为网页动作 L0 handler，补齐 before/after verifier 和 completion evidence。
- [ ] App window capture adapter：读取 windowRef、bounds、scale、window-local crop、fresh screenshot refs。
- [ ] Accessibility/UI Automation/AT-SPI adapter：只作为 target hints、state snapshot、non-private action binding；不能绕过 action loop。
- [ ] Terminal / PTY adapter：用于 terminal session 内命令、输出 transcript、exit code 和 artifact refs；不把 shell 写文件伪装成 GUI artifact，除非任务明确选择 terminal workflow。
- [ ] Editor / local document adapter：优先 app-native/editor extension 或 Accessibility；保存动作必须有 input event 和 artifact validator。
- [ ] File manager adapter：支持可见文件选择、重命名、移动、目录 evidence； destructive remote/delete 操作 hard-confirm。
- [ ] Shared system input fallback：只允许 explicit handoff 或诊断，不作为默认产品 pass。

### 0.5 GUI projection 和用户控制面

- [ ] Composer 继续只提交自然语言、refs、Autonomy profile。
- [ ] Hard-confirm surface 展示 action、target、impact、evidence refs、authorization profile、Confirm / Cancel。
- [ ] Computer Use control plane 只产生 terminal-equivalent debug text 或 confirmation result，不执行动作。
- [ ] Image/Evidence pane 展示 annotation crop、before/after screenshot、artifact preview、action timeline、provenance。
- [ ] Browser pane / WindowActionSession surface 显示 actor cursor、focus/lease 状态、stop/takeover。
- [ ] GUI presentation 的 `gui.present` refs 不得进入 action-ready 或 completion 判定。

### 0.6 输入增强与效率基线

- [ ] 定义 evidence ledger -> observation snapshot -> local controller brief 的 compact contract，明确每条 evidence 的 owner/session/target、freshness、cost tier、scope、confidence 和 invalidation rule。
- [ ] 按用途实现证据选择策略：target scope、visible state/clickability、text/label、role/state、executable target、after-action verification 和 completion handoff。
- [ ] 引入 T0-T5 观察成本登记，并在 trace 记录每轮使用的 evidence tier、升级原因、latency 和模型调用次数。
- [ ] 默认局部观察：已有 windowRef/targetRef 时先 crop/window-local capture；全屏 capture 必须写明 target missing、occlusion、multi-window conflict 或 user-selected screen-region reason。
- [ ] 结构化能力优先：BrowserHostSession/CDP/DOM/AX、app-native command、PTY/editor/file/validator 能完成或验证时，不升级到视觉模型或裸 GUI 点击。
- [ ] 支持同一 target/lease 内低风险 action batch，但导航、保存、提交、上传、删除、window switch、modal、target moved、focus takeover 和 verifier failure 后强制 checkpoint。
- [ ] 每个 mutating action 都显式 stale 相关 screenshot、OCR、object location、grounding、role/state 和 completion candidate。
- [ ] 验收：复杂 matrix report 输出 observation tier histogram、vision call count、action retry count、checkpoint count、false-completion guard count 和 blocked escalation reason。

### 0.7 P0 验收

- [ ] Model Router：Computer Use 所有模型调用走 `/v1/responses`，trace 中只出现公开 profile/role 和 refs-first modality evidence。
- [ ] Unit / contract：runtime truth resolver 只接受 runtime-owned refs；GUI/UI/fixture/replay/raw refs 被拒绝。
- [ ] Runtime：普通聊天“帮我打开页面并点击...”进入 Guard；缺 host/target/observation/permission/cancel 时返回具体 blocker。
- [ ] Runtime：ready preflight 调用默认 Act materializer；缺 action evidence 时 blocked，不声称 completed。
- [ ] Desktop smoke：Electron product shell + native host + runtime-codex transport + hard-confirm surface 全链路通过。
- [ ] Browser live action：普通聊天触发 BrowserHostSession 可见 action，产生 before/after evidence 和 action ledger refs。
- [ ] High-risk：发送/提交/上传/删除/支付/账号安全/法律合规/外部执行全部 hard-confirm。
- [ ] Docs：`PROJECT.md` 只在实际验证后更新勾选；本文记录专项进度。

建议验证命令：

```bash
git diff --check
npm run smoke:runtime-codex-truth-source
npm run smoke:desktop-computer-use-hard-confirm-product
npm run smoke:desktop-browser-native-live-acceptance:strict
npm run smoke:computer-use-chat-live-preflight:strict
```

## P1：复杂 Computer Use 工作流

P1 的目标是从“能执行动作”推进到“能完成真实、多步、跨窗口任务”。每个 case 都必须从 SciForge Desktop 普通聊天触发，并生成当前 run 的 evidence bundle。

### 1.1 复杂任务矩阵

- [ ] Browser research -> local report：打开/搜索网页，提取来源，切到可见编辑器，写入报告，保存并由 text/markdown/docx validator 验证。
- [ ] Browser form draft：打开网页表单，填写草稿但不提交；提交按钮触发 hard-confirm。
- [ ] CSV/table workflow：打开本地 CSV/表格，筛选/计算/生成图表或摘要，保存报告，验证 CSV/file-list/artifact refs。
- [ ] File organization workflow：在可见文件管理器中查看目录、重命名/移动低风险样例文件，生成可见 index document，验证 directory evidence。
- [ ] Terminal/notebook workflow：在 terminal 或 notebook 执行研究脚本，读取 stdout/stderr/exit code，生成报告 artifact，不能只靠 terminal output 宣布用户级完成。
- [ ] Cross-app document workflow：Browser/source reader -> editor/word processor -> file preview/Image evidence，形成跨 app action causality。
- [ ] Visual disambiguation workflow：同名按钮/多候选目标，通过 crop/OCR/vision translator 消歧，拒绝不确定点击。
- [ ] Viewport recovery workflow：目标离屏时滚动恢复，记录 scroll action、viewport state refs、最终唯一选中目标。
- [ ] Repair workflow：失败后生成 blocked repair manifest，下一轮用新 evidence 收敛，不用旧 action history 当完成证据。
- [ ] High-risk confirmation workflow：可见高风险动作必须停在确认；Cancel 后不执行，Confirm 后只授权当前 action / action type / turn 范围。

### 1.2 Vision-first multi-signal grounding

- [ ] 默认从当前 screenshot/window crop/OCR/Model Router `translators.vision` observation 构造 planner brief。
- [ ] DOM/AX/terminal/file evidence 只能作为 hints 或 verifier context，必须进入 evidence ledger。
- [ ] Model Router `translators.vision` 统一处理 describe、compare、crop inspection、candidate disambiguation 和 verifier explanation。
- [ ] Planner 输出 generic intent；grounder/Host adapter 输出 binding 和 coordinates。
- [ ] 每次 mutating action 后旧 screenshot、OCR、object location、grounding 自动 stale。

### 1.3 Artifact 与 completion guard

- [ ] 文件产物必须有 file refs、hash/metadata、format validator、saved-by-action index。
- [ ] PPTX/DOCX/CSV/Markdown/report/image 等 validator 统一输出 artifactValidationRef。
- [ ] completion guard 要求当前 observation 或 artifact evidence、action causality、validator/verifier 支持、无 blocking uncertainty。
- [ ] verifier 不能只看最终文件存在；必须检查内容、来源 refs、保存动作和当前 run 因果链。
- [ ] GUI 展示、preview、Image pane screenshot 只能支持 completion，不能单独证明 completion。

### 1.4 Long-run reliability

- [ ] Run budget：maxSteps、time budget、model budget、action retry budget 清晰进入 trace。
- [ ] Stop condition：重复同一 blocker、目标不确定、窗口失效、权限缺失、artifact validator 失败时 blocked。
- [ ] Continuation：repair-needed 后下一轮保留 refs-first context，并重新 observe，不靠 prompt memory。
- [ ] Isolation：每个 case workspace/run bundle 隔离；跨 case 不复用旧 refs。
- [ ] Metrics：latency、vision calls、grounding confidence、action success rate、repair rate、hard-confirm rate、false completion rate。

### 1.5 P1 验收

- [ ] `computer-use-chat-live-complex-matrix` 迁移到 Desktop product path，不再以 slash/debug/isolated completion producer 作为 pass。
- [ ] 每个复杂 case 至少包含一个真实 mutating GUI action、一个 current observation、一个 verifier/artifact validator、一个 GUI presentation ref。
- [ ] Matrix report 明确区分 passed、blocked、needs-confirmation、repair-needed、diagnostic-only。
- [ ] 禁止 fixture/package-local/target-bound/readiness-only/shell-written/DOM-only/AX-only evidence 作为 completion。

建议验证命令：

```bash
npm run smoke:computer-use-chat-live-complex-matrix:opt-in-isolated
npm run release:computer-use-chat-live-complex-matrix-report
npm run computer-use-long:preflight
npm run computer-use-long:run-matrix
npm run computer-use-long:validate-matrix
```

上述命令在迁移完成前只能作为诊断；只有 Desktop product path 产生真实 evidence bundle 后才可打 P1 勾。

## P2：产品化与发布闸

### 2.1 Package / plugin / Codex app-server 集成

- [ ] `sciforge.computer-use` 通过 repo-local plugin / MCP / skill 被 Codex app-server 发现。
- [ ] Skill 文档只说明何时使用 Computer Use、如何提交 refs/intent、哪些风险必须确认、哪些证据才算通过；skill 不拥有 executor、provider route 或 completion 判断。
- [ ] 对外 tool surface 小而稳定：observe、click、type_text、scroll、press_key、propose_action、execute_scoped_action、get_replay_refs。
- [ ] 公共参数禁止裸全局坐标、GUI private state、provider route、executor lease、scheduler internals、raw screenshot/base64/secret。
- [ ] Package action loop 和 runtime materializer 共享同一 host-port contract。

### 2.2 Security / policy hardening

- [ ] Risk classifier 覆盖支付、发送、提交、上传、删除、账号/安全、法律/合规、外部执行、验证码/安全屏障、敏感数据传输。
- [ ] Third-party instruction isolation：网页/文档/邮件中的文字不能扩大授权或触发高风险动作。
- [ ] Secret sanitizer 覆盖 trace、artifact、logs、runtime events、GUI manifest、model router traces。
- [ ] Permission scope 可审计：app/window/display group、readable refs、input modalities、external side-effect policy。

### 2.3 Desktop release gates

- [ ] Release gate 必须包含 Desktop Electron native host，不接受 Web dev pass。
- [ ] Browser live acceptance 与 Computer Use live acceptance 分开验证，再组合验证。
- [ ] Hard-confirm product smoke 要求真实 in-process Electron runner，不接受伪造 manifest。
- [ ] Long task / complex matrix 默认不进 fast verify，但进入 opt-in release acceptance。
- [ ] `verify:fast` 保留 contract/security/no-hardcoded-success/no-legacy-path checks。

### 2.4 Documentation / operations

- [ ] `docs/Usage.md` 更新 Desktop CU 启动、权限、blocked recovery、smoke 说明。
- [ ] `docs/Architecture.md` 只补架构事实，不把 GUI 写成 executor。
- [ ] `docs/VirtualAppScreenArchitecture.md` 保持 legacy VirtualAppScreen 非目标。
- [ ] `packages/actions/computer-use/README.md` 标明 package diagnostic 与 product acceptance 的差异。
- [ ] `PROJECT.md` 只同步已验证总状态；本文保留专项细分。

## 优先实现顺序

1. 写清 Model Router 统一模型面：CU 内所有模型参与点只走 `/v1/responses` 的 profile/role。
2. 收缩 CU 定位：对齐本线程 Codex agent 的能力组织方式，作为 skill/plugin/action provider，不做第二个 Agent Host；局部 planner 只输出 generic GUI intent。
3. 定义输入增强和效率基线：evidence ledger -> observation snapshot -> local controller brief、T0-T5 观察成本、局部观察、升级/checkpoint/stale 规则。
4. 接通 Act-time truth source：WindowActionSession store、adapter registry、permission ledger、stop/cancel/takeover refs。
5. 接通默认 Computer Use Act materializer：ready preflight -> package action loop -> runtime-owned evidence refs。
6. 打通 BrowserHostSession 低风险 live action：普通聊天可自动执行一个网页动作并验证。
7. 打通 Desktop hard-confirm：普通聊天触发高风险网页/表单动作时暂停在确认面。
8. 建立 WindowActionSession 产品 schema 和 GUI projection：actor cursor、lease、evidence timeline、stop/takeover。
9. 增加 app window/editor/terminal/file-manager adapters 的最小产品路径。
10. 迁移 complex matrix 到 Desktop product path，禁止 diagnostic evidence 作为 completion。
11. 扩展 artifact validators 和 completion guard，覆盖 report/CSV/PPTX/DOCX/notebook/terminal workflow。
12. 把 release gate 分成 fast contract、Desktop native smoke、opt-in complex live acceptance 三层。

## 打勾规则

- `[x]` 只表示对应能力已经在当前产品路径验证：SciForge Desktop 普通聊天、runtime-owned refs、真实 native host 或明确的 fail-closed evidence。
- `[ ]` 表示尚未实现、尚未接入默认产品链路、只有局部 contract 通过、只有 diagnostic/fixture/legacy evidence，或还缺当前 run completion evidence。
- Web/Vite、package-local、target-bound diagnostic、isolated legacy、slash route、focused unit test 不能替代 Desktop product pass。
- 文档改动至少运行 `git diff --check`；实现改动必须补 focused tests 和 Desktop native product smoke。

## 非目标

- 不恢复旧 VirtualAppScreen 作为产品路线。
- 不做泛化 Workbench / Desktop 大改。
- 不新增独立 Computer Use router/gateway 作为普通用户入口。
- 不让 GUI、Image/Evidence pane、Browser pane、annotation overlay 或 previewer 拥有执行权。
- 不用系统外部浏览器、iframe、proxy、screenshot replay、frame stream、PDF/document projection 冒充 live surface。
- 不绕过 hard-confirm，不因为 `High Autonomy` 自动执行外部高风险动作。
- 不把 fixture、package-local、shell-written artifact、DOM/AX-only result 或旧 run trace 当成完成证据。

## 相关文件

- [`PROJECT.md`](PROJECT.md)
- [`docs/ModelRouterArchitecture.md`](docs/ModelRouterArchitecture.md)
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)
- [`packages/actions/computer-use/README.md`](packages/actions/computer-use/README.md)
- [`docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md`](docs/superpowers/specs/2026-06-05-default-browser-computer-use-design.md)
- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)
- [`docs/Usage.md`](docs/Usage.md)
- [`src/runtime/codex/agent-host-turn-loop.ts`](src/runtime/codex/agent-host-turn-loop.ts)
- [`src/runtime/codex/agent-host-runtime-truth-resolver.ts`](src/runtime/codex/agent-host-runtime-truth-resolver.ts)
- [`src/runtime/browser-host-computer-use.ts`](src/runtime/browser-host-computer-use.ts)
- [`tools/desktop-computer-use-hard-confirm-product-smoke-runner.ts`](tools/desktop-computer-use-hard-confirm-product-smoke-runner.ts)
- [`tools/computer-use-chat-live-complex-matrix.ts`](tools/computer-use-chat-live-complex-matrix.ts)
- [`tools/computer-use-long-task-pool.ts`](tools/computer-use-long-task-pool.ts)
