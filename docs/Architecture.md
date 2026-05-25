# SciForge 架构

最后更新：2026-05-24

## 北极星

SciForge 是 TUI agent 的 GUI extension，不是 agent host。

> **TUI / agent host 拥有全部任务逻辑；GUI 把用户意图变成文本，并把自己作为 intent-based `gui.*` extension 暴露给 TUI。**

Codex backend 负责上下文、记忆、工具、插件、算法、修复和执行。SciForge 长期只支持 Codex backend；DeepSeek `deepseek-v4-flash` 是默认 model provider，而不是另一个 backend。SciForge GUI 负责人体工学输入、可视化展示、确认、输入收集和焦点控制。

## 最终分层

```text
GUI Shell
  将用户手势翻译成文本
  维护语义 GUI event bus 和 hot-region projection
  暴露只读虚拟 GUI resource tree 供 TUI 探测状态
  向 TUI agent 暴露 intent-based gui.* tools
  协商 placement、timing、conflicts 和 rendering

TUI Agent Host
  接收文本
  拥有 reasoning、command parsing、context、memory、planning 和 repair
  使用原生 plugins / skills / tools / MCP / providers
  有 presentation 或 user-interaction intent 时调用 gui.* tools

Native Agent Extensions
  capability discovery、scientific algorithms、policy/harness、providers、
  verifiers、artifact generation、workspace operations
  只向 TUI Agent Host 暴露原生 tool/plugin/MCP/provider/worker surface
  不直接 import 或调用 GUI implementation
```

## 两个方向

### 1. GUI → TUI：全部是文本

GUI 所有用户动作都变成终端等价文本：

```text
点击删除文件      -> rm report.md
点击重试          -> /rerun run-123
点击修复          -> /recover run-123 --with-evidence
点击打开 artifact -> open artifacts/report.md
表单提交          -> /capabilities plan --prefer literature.search pdf.extract
```

没有 `deleteFile(path)`、`triggerRecover(actionId)`、`updateCapabilityPreference(patch)` 这类 GUI -> TUI 业务函数。

### 2. TUI → GUI：表达 GUI intent

TUI 通过原生 tool/plugin 机制调用 GUI intent tools：

```text
gui.present(...)
gui.ask_user(...)
gui.notify(...)
gui.set_status(...)
gui.apply_batch(...)
gui.get_context(...)
```

这些 tools 只表达 presentation、confirmation、input、focus 和 GUI-local transaction 意图。GUI 根据 hot region、interaction mode、lastChangeOrigin、revision 和 precondition 决定执行、延迟、拒绝或建议替代方案。真实任务操作仍由 TUI agent 和它的原生 tools 完成。

## 拓展模块交互模型

所有 native extension 包，包括 Computer Use、飞书/微信连接器、verifier、provider、policy 和 skill，都只直接和 **TUI Agent Host** 通信。GUI 需要参与展示、确认或输入时，也必须由 TUI Host 调用 `gui.*`；extension package 自身不得 import、调用或依赖 React/UI、renderer registry、Workbench、AnnotationSidebar 或 GUI 私有状态。

统一信息流：

```text
User / GUI gesture
  -> terminal-equivalent text
  -> TUI Agent Host
  -> native extension module
  -> refs-first result | approval request | repair hint | compact payload
  -> TUI Agent Host
  -> gui.present / gui.ask_user / gui.notify / gui.set_status
  -> GUI Shell
```

这个模型把 GUI 定义为 TUI Host 可调用的 presentation/input service，而不是 extension 的依赖。Extension package 只暴露 typed request/result、manifest、trace/audit refs 和必要的 host port contract；TUI Host 负责把这些结果映射成 `ToolPayload`、事件流、`gui.present` 或 `gui.ask_user`。

高风险副作用必须走同一条路径。Computer Use 的发送、删除、支付、授权、发布、外部提交，或飞书连接器的真实发送/同步/删除，不直接弹 GUI，也不直接执行；extension 返回 `needs-confirmation`、`approvalRequest`、`draftRef` 或 `auditRef`，TUI Host 决定是否调用 `gui.ask_user` 收集确认，确认后再发起下一次受控调用。

Computer Use 的验收也按这个边界组织。基础真实输入 smoke 只能证明 action provider、Grounder、Executor 和 Verifier 链路可用；用户级 success 至少需要完成一个真实桌面产物任务，例如制作并保存一页 PPT。目标打通需要覆盖多 App 工作流，例如 Browser/资料页、slide app、Finder/保存对话框和 SciForge GUI 结果展示。GUI 在这些验收中仍只发送终端等价文本、展示 refs 和收集确认，不直接执行桌面操作。

## GUI 状态投影

GUI 可以有内部逻辑，但它属于 presentation behavior。GUI 内部事件先进入 semantic event bus，再投影成 TUI 可用的 progressive context：

```text
DOM / pointer / keyboard / scroll / modal events
  -> GUI semantic event bus
  -> shell context + hot region context
  -> optional region detail or debug snapshot on request
```

默认只暴露 hot region，不暴露完整 DOM。Hot region 至少包含 focused panel、selected refs、interaction mode、lastChangeOrigin、available actions 和 revision。

## 全局注释侧栏

`AnnotationSidebar` 属于 GUI Shell 的 input/presentation 层。它可以在工作台和非工作台页面打开，负责点选对象、维护 `※1` / `※2` 引用 chips、澄清问题和对象关系、预览修改、保存反馈，并在低风险条件下承载 quick action；它不是第二套 agent host，也不是复杂 repair/control surface。

顶部 `注释` 入口打开全局侧栏，不再把注释讨论塞进工作台主 composer。工作台主 composer 保持执行、研究和普通对话职责；工作台里的主聊天消息、结果面板、项目树、设置入口和反馈收件箱条目只是可被引用的 GUI 对象。

注释侧栏复用主 conversation kernel 的 session、references、structured stream/event 和 GUI-TUI 对话能力。无副作用的整理/预览/保存反馈使用 `annotation-plan-only` envelope；低风险小改动使用 `annotation-quick-action` envelope，并必须保持单对象、局部、可解释、可回退。复杂改动、跨对象关系、repair、GitHub、commit、push、PR 和 merge 必须进入收件箱。

`annotation-plan-only` 边界由主 conversation kernel 和 runtime transport 双层保证：`runPromptOrchestrator` 对该 turn 本地生成 intent draft 响应并跳过 target lookup、context compaction、runtime 和 repair stage；`sendSciForgeToolMessage` 对漏到 Codex Runtime transport 的 plan-only envelope 直接拒绝。quick action 不复用这个 lane，避免 UI 暗示执行但底层仍是 plan-only。

保存注释时，GUI 生成本地 feedback inbox `annotation-plan` record，包括引用对象、原始描述、澄清问答摘要、action log、修改建议、验收标准、URL/route、selector/DOM path 和 screenshot/evidence refs。复杂后续 repair/code/GitHub sync 必须由用户在收件箱中显式启动，并经过对应确认边界。

## 内置浏览器运行时

SciForge 的内置浏览器是 TUI/Codex runtime 的 `browser_runtime` capability，不是 GUI 自己实现的网页 agent。GUI 可以展示 browser session、tabs、当前 URL、截图 refs、DOM snapshot refs、console/network refs 和 human takeover 状态，也可以把按钮转换成 `/browser ...` 这类终端等价文本；但 GUI 不判断网页任务意图、不选择 Playwright provider、不拼 browser prompt、不把网页正文或截图 base64 写进 workspace state。

默认浏览器路径使用 `playwright_browser_automation`：headless、isolated、后台运行，不附着用户主浏览器。需要登录、验证码、2FA、账户权限或人工接管时，才显式切到 `playwright_edge_browser` visible takeover，并要求用户确认。截图、DOM、console、network 和下载结果必须 refs-first；projection 只保存 ref、摘要、尺寸/hash/targetRect 等可审计元数据。

详细设计见 [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)。

## TUI 感知 GUI：只读虚拟资源树

TUI 不应该通过截图、DOM dump、ANSI buffer 或 GUI 私有对象理解界面状态。更稳的模型是把 GUI 看成一个只读虚拟资源树，像读文件系统一样分层探测：

```text
/gui/shell.json
/gui/hot-region.json
/gui/capabilities/presentation.json
/gui/renderers/<componentId>.json
/gui/regions/<regionId>/summary.md
/gui/regions/<regionId>/refs.json
/gui/regions/<regionId>/actions.json
/gui/debug/dom-summary.json
```

TUI 使用原子读操作获取状态：

| 操作 | 作用 |
|---|---|
| `gui.list(path)` | 列出可见的 GUI resource 子节点。 |
| `gui.read(path)` | 读取某个 resource 的语义快照。 |
| `gui.search(query, scope)` | 在语义索引里搜索 ref、标题、可见文本、action label。 |
| `gui.stat(path)` | 获取 revision、更新时间、大小、披露级别和权限。 |
| `gui.watch(path)` | 订阅语义变化事件，而不是低级 DOM 事件。 |

如果目标 TUI host 支持 MCP resources、LSP-like resources 或原生 context provider，应优先复用这些机制；否则把同名操作作为 `gui.*` read-only tools 注入。它们只读 GUI 语义状态，不触发任务操作。

这个模型解决两件事：

- TUI 可用熟悉的 `list/read/search/stat/watch` 组合逐层探测 GUI，而不需要一次吃完整页面。
- GUI 可以隐藏大多数同时无关的区域，只暴露 shell、hot region 和按需 region detail。

`gui.search` 不是让 TUI grep 原始 DOM。它搜索的是 GUI projector 生成的语义文本和结构化 refs；debug resource 只用于审计/排障，默认不进入 agent context。

## 双目录能力发现

能力分成两个目录，不能混在一起：

1. **任务能力目录**：skills、tools、plugins、MCP、provider、verifier、harness 和 capability discovery 都属于 TUI/Codex 原生生态。GUI 想触发发现时，只发送终端等价文本，例如 `/capabilities search`、`/capabilities expand`、`/capabilities plan`、`/capabilities explain`。
2. **展示能力目录**：`packages/presentation/components` 里的 renderer、viewer、workbench 组件属于 GUI extension。它们只说明“GUI 能怎么展示某类 artifact/ref”，不说明“任务应该调用哪个算法或工具”。

GUI 展示能力通过只读资源暴露给 TUI：

```text
/gui/capabilities/presentation.json
/gui/renderers/<componentId>.json
```

TUI 的最小发现流程是：

```text
gui.list('/gui/capabilities')
gui.read('/gui/capabilities/presentation.json')
gui.search({ query: 'markdown report viewer', scope: '/gui/capabilities' })
gui.present({ ref: 'artifacts/report.md', hint: 'markdown' })
```

这个方案的可靠性来自单一归属：TUI 不 import React 组件、不维护 GUI renderer registry；GUI 不注册任务 skills/tools、不做 capability ranking。双方只通过现有的 `gui.read/search` 和 `gui.present` 协作。

## GUI 智能边界

GUI 不是无脑像素壳，也不是第二个 agent。它应该“对任务无知，对呈现聪明”：

- 可以做：布局选择、renderer 选择、焦点保护、modal 排队、hot region 投影、interaction mode 识别、revision/precondition 检查、defer/reject/suggestion、GUI-local batch transaction。
- 不可以做：任务意图分类、算法选择、provider route、capability ranking、repair strategy、workspace 执行、结果真伪判断、completion 判断。

换句话说，GUI 的智能是确定性的 presentation autonomy；TUI agent 的智能是任务推理和行动决策。这样 GUI 不会变重，也不会退化成完全无法保护用户交互状态的被动视图。

## 为什么不定义新的 plugin API

事实前提：

1. Codex CLI / app-server 已经能在终端 host 边界后提供 agent 能力和富客户端事件流。
2. Codex 已经有原生 plugin、skill、tool、MCP 和 custom model provider 配置。
3. TUI 接受的信息用文本就够。
4. GUI 作为 TUI 可调用的 extension，比 GUI 自己用 LLM 猜 UI 操作更稳定。

因此 SciForge 不应定义第二套 agent extension runtime。它只定义 GUI 作为 extension 时的最小 tool surface，且这个 surface 通过目标 TUI 的原生机制注入。

## 职责归属

| 问题 | 归属 |
|---|---|
| 用户文本是什么意思 | TUI agent。 |
| 调哪个工具、provider、插件 | TUI agent / 原生扩展系统。 |
| capability discovery | TUI 原生扩展。 |
| harness / policy / repair | TUI 原生扩展。 |
| 文件读写、命令执行、验证 | TUI 原生 tools。 |
| `packages/presentation/components` 中的 GUI 组件 | GUI extension 的展示能力目录；TUI 通过 `/gui/capabilities/presentation.json` 与 `/gui/renderers/<componentId>.json` 只读发现。 |
| GUI 展示哪个结果 | TUI 调 `gui.present`，GUI 决定 renderer/placement。 |
| 用户确认、补充输入 | TUI 调 `gui.ask_user`，GUI 收集后发文本。 |
| 全局注释侧栏 | GUI Shell input/presentation；复用主 conversation kernel 的整理/预览 lane，并可触发低风险 `annotation-quick-action`。 |
| 从注释进入 repair/code/GitHub | 反馈收件箱中的显式用户动作和确认边界。 |
| TUI 想知道 GUI 当前状态 | TUI 读只读 GUI resource tree 或调用 `gui.get_context`。 |
| GUI 布局、焦点、主题 | GUI 本地人体工学状态。 |

## 引用与右侧预览契约

agent 回复、报告正文和消息 metadata 中出现的 artifact/file/run 引用必须尽量变成结构化 object reference，而不是只能显示成普通文本。可解析引用包括显式 `artifact:`、`file:`、`run:` ref，也包括能精确匹配当前 session artifact 或 workspace file 的裸文件名，例如 `arxiv_multi_agent_report_20260521.md`。

裸文件名只能在“已解析到真实 artifact/file”时升级为可点击引用，避免把任意 Markdown 代码片段误当成文件。用户点击这类引用时，GUI 应聚焦右侧面板，并用展示能力目录中的合适 renderer 预览；TUI 也可以显式调用：

```ts
gui.present({
  intent: 'focus-existing',
  ref: 'artifacts/arxiv_multi_agent_report_20260521.md',
  hint: 'markdown'
})
```

右侧预览是 GUI 展示能力，不是任务能力。预览失败时 GUI 可以提示缺少 artifact/file/ref，但不能因此推断任务失败或成功。

## 旧概念映射

| 旧概念 | 新归属 |
|---|---|
| Conversation Kernel / ledger | TUI agent host session log。 |
| Runtime Bridge | 连接 TUI 的薄 adapter，不承载业务。 |
| Capability Gateway | TUI 原生 tool/provider 生态。 |
| Capability Discovery | TUI 原生 extension。 |
| Harness / Conversation Policy | TUI 原生 policy extension。 |
| ProjectionApi | `gui.present` / `gui.get_context` / GUI 本地 view state。 |
| UserActionApi | 文本命令生成器。 |
| Scenario package | TUI skill/plugin/context，不是 GUI runtime。 |

## Native Extension Model

SciForge 不定义新的 agent extension API。所有算法和策略扩展都使用目标 TUI host 的原生机制：

- Codex CLI plugin / skill / tool / MCP。
- 第三方软件连接器，例如飞书 CLI、飞书 API、微信/企业微信 bridge，也属于 TUI 侧 tool / MCP / worker / connector。
- Codex custom model provider / `model_providers.<id>.base_url`。
- 必要时的本地 Codex provider proxy。

默认生产集成目标是上游 Codex backend + custom model provider，优先通过配置接入 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider endpoint。GUI 启动或连接 Codex app-server / Codex CLI 进程，把用户操作翻译成文本写入该进程，再消费其结构化事件流或 JSONL 输出。SciForge 不再要求常驻 AgentServer；历史 `AgentServer` / `runtime gateway` 只能作为当前代码兼容层或迁移来源，不是最终架构依赖。

迁移只做两阶段：Phase 1 使用 `codex exec --json` 作为轻量事件源；Phase 2 抽出 `AgentCliAdapter` 隔离进程和 JSONL 细节。Codex app-server 暂不作为主迁移路径，等需要长期 thread、审批和富客户端状态时再接入。细节见 [`CodexRuntimeMigration.md`](CodexRuntimeMigration.md)。

因此 SciForge 不再定义 `registerCommand`、`registerTool`、`registerPolicy`、`HarnessRuntime`、`CapabilityGateway` 或自己的 TUI plugin manifest。

典型归属：

| 能力 | 归属 |
|---|---|
| 文献检索、PDF 解析、引用核验 | TUI 原生 plugin/tool/skill。 |
| 数据分析、统计、绘图 | TUI 原生 plugin/tool/skill。 |
| Capability Discovery | TUI 原生 plugin/tool/skill。 |
| Harness / policy / budget / repair | TUI 原生 policy/plugin/skill。 |
| Provider route / MCP / remote worker | TUI 原生 provider/tool 生态。 |
| 外部软件连接器，如飞书、微信、企业微信 | TUI 原生 connector/tool/MCP/worker；repo 内 adapter 放在 `packages/connectors`。 |
| Computer Use | TUI 原生 action provider；repo 内能力主体放在 `packages/actions/computer-use`，可消费 `packages/observe/vision` 的 sense 输出，桌面/远程执行通过 TUI Host ports 接入。 |
| Artifact schema / verifier | TUI 原生 tool 或 skill。 |
| GUI 展示、确认、输入收集 | SciForge GUI extension 暴露的 intent-based `gui.*` tools。 |

外部连接器和 Computer Use 遵守同一条边界：GUI 不直接调用第三方 SDK、CLI、桌面自动化、Computer Use executor 或 API。GUI 按钮只生成终端等价文本，例如 `/connectors feishu draft-message ...` 或 `/computer-use run ...`；TUI 决定是否调用 connector/action provider。拓展模块输出 refs-first 结果，例如 external refs、artifact refs、trace refs、draft refs、approval request、audit refs；发送、删除、同步、桌面输入等有外部副作用的操作必须经过 TUI 侧 approval / dry-run / idempotency 规则，并由 TUI Host 通过 `gui.ask_user` 收集确认。

## Desktop Packaging Direction

SciForge 的本地软件形态应复用现有 React + Vite GUI、Node/TypeScript workspace runtime、`packages/backend` proxy 和上游 Codex CLI bridge，而不是重写一套原生 UI 或 agent host。第一阶段桌面壳选型为 **Electron**：

- Electron main process 负责窗口、菜单、协议、系统权限、日志目录、自动更新入口和本地 runtime 生命周期。
- Vite build 产物作为 renderer 加载；React/UI 继续遵守上面的 presentation boundary，不引入 Electron-only 业务逻辑。
- Workspace server、backend proxy、Codex CLI 作为受控本地进程或 sidecar 被 Electron main 启停和监控。
- Renderer 与 runtime 通过受控 IPC 或 `127.0.0.1` loopback contract 通信；不得让 UI 直接散落进程管理、端口探测或平台判断。

Tauri 暂不进入短中期主线。它可以作为长期优化项重新评估，前提是 runtime launcher、进程边界、AppData 状态目录、密钥存储和平台 adapter 已经稳定；在此之前，Tauri 会迫使 Node runtime、Codex CLI sidecar 和文件/进程权限过早迁移到 Rust command 层，增加当前迁移风险。

到中期为止，桌面化目标不是改变 agent 架构，而是把现有本地 Web + 本地服务产品化：

- 保留 Web/desktop 双运行能力，开发期仍可通过 Vite + workspace server 验证。
- 把开发启动脚本与生产 runtime launcher 分开。
- 将固定开发端口、仓库内 runtime state、shell/platform 特例和明文密钥逐步移出 UI/runtime 业务层。
- macOS、Windows、Linux 的差异统一收敛到 desktop/platform service，而不是散落到 React 组件或 Codex adapter。

## Capability Discovery

Capability Discovery 不属于 GUI/runtime。用户若从 GUI 触发能力发现，GUI 只发送文本：

```text
/capabilities search "build an evidence matrix for recent papers"
/capabilities expand literature.search pdf.extract citation.verify
/capabilities plan --goal "build evidence matrix"
/capabilities explain literature.search
```

工具名可以沿用 `capability_discovery.search/expand/plan/explain`，但注册、权限、审计、provider readiness、progressive disclosure 都由 TUI host 原生机制负责。Discovery plan 不构成 completion evidence；展示必须通过 `gui.present` 或 `gui.ask_user`。

## Harness / Policy

Harness / Policy 属于 TUI 原生扩展。它可以决定 context refs、tool/provider budget、capability preference、verification depth、repair action、background continuation 和 progress milestones。

它可以通过 `gui.present`、`gui.ask_user`、`gui.notify`、`gui.set_status` 影响 GUI 展示，但不能把策略写进 GUI，也不能让 GUI 变成第二个 agent。

## Confidence / 置信度契约

`confidence` 是 TUI/verifier/harness 对结果可信度的可解释输出，不是 GUI 根据日志、文案或默认值猜出来的分数。GUI 只能渲染 TUI 明确给出的 `confidence` 与 `confidenceExplanation`；如果缺失，GUI 应隐藏百分比或显示“未评分”，不得补一个默认 78%。

推荐的 TUI 侧计算形态是：

```text
effectiveConfidence = clamp(min(sourceScore ?? evidenceDefault, evidenceCap) - penalties, 0, 1)
```

其中 `sourceScore` 是工具、verifier 或 provider 自带分数；`evidenceDefault` 和 `evidenceCap` 由证据等级决定；`penalties` 来自缺失证据、过期来源、验证失败、partial/zero-result、冲突 claim 等可审计因素。

| 证据等级 | 默认值 | 上限 | 说明 |
|---|---:|---:|---|
| 已复现或 verifier 通过，且有输出/evidence refs | 0.90 | 0.95 | 最高可信，但仍保留人工复核空间。 |
| 工具/provider 支撑，且有 audit refs | 0.75 | 0.85 | 有外部或本地执行证据，但未完整复现。 |
| 只有引用/ref 支撑，未复现 | 0.65 | 0.75 | 适合文献摘要、引用型结论。 |
| 纯模型推断或弱证据解释 | 0.45 | 0.55 | 必须在解释中标注不确定性。 |
| 阻断、失败、证据缺失或冲突未解 | 0.20 | 0.35 | 只能表达低可信或待修复。 |
| 没有结果 | 0.00 | 0.00 | 不展示为可信结论。 |

常见 penalty 建议：缺少直接 evidence ref `-0.15`，来源过期或未验证 `-0.10`，验证失败 `-0.25`，partial/zero-result `-0.20`，关键 claim 冲突未解决 `-0.20`。最终展示必须带简短解释，例如“工具执行通过，缺少全文复现，扣 0.10”。

## UI Implementation Boundary

React/UI 只做 presentation behavior：

- 用户手势 -> 命令文本。
- semantic event bus -> shell/hot-region context。
- 只读虚拟 GUI resources -> `list/read/search/stat/watch`。
- `gui.*` intent 的执行。
- layout、focus、theme、draft、folding、selection。
- intent negotiation、precondition check、defer/reject/suggestion。

React/UI 不做 provider branch、capability ranking、repair policy、prompt route、workspace execution 或 task completion 判断。
React/UI 也不直接执行 Computer Use、连接器 CLI、外部 API 或桌面 bridge；这些能力只能作为 TUI-owned extension 被 TUI Host 调用。

## 成功标准

- 同一任务在纯 TUI 中可完成。
- 接入 SciForge GUI 后只增加展示和交互能力，不增加算法能力。
- 不需要独立 AgentServer；默认直接连接 Codex backend。
- 默认运行期不得消耗 OpenAI token，除非用户显式 opt in；生产默认应让 Codex backend 走 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy。
- GUI 没有 provider 分支、repair 策略、capability ranking、prompt route。
- 所有 GUI 按钮最终只发送文本。
- 全局注释侧栏是连续反馈入口：澄清/预览/保存反馈使用无副作用 lane，低风险小改动使用 quick action，复杂执行进入收件箱。
- 注释、反馈和收件箱的用户级验收必须使用 Codex in-app browser，并覆盖工作台页面和至少一个非工作台页面。
- TUI 用原生机制调用 intent-based `gui.*` tools；GUI 可协商、延迟或拒绝。
- GUI 默认只向 TUI 披露 shell + hot region 状态。
- 算法模块可以直接给 Codex plugin / skill / tool / MCP 使用。
- 可解析 artifact/file 引用可以在右侧面板预览；无法解析的普通代码片段不得伪装成对象引用。
- GUI 不制造默认 confidence；所有百分比都必须来自 TUI/verifier/harness 的可解释输出。
