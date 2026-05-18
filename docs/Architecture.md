# SciForge 架构

最后更新：2026-05-19

## 北极星

SciForge 是 TUI agent 的 GUI extension，不是 agent host。

> **TUI / agent host 拥有全部任务逻辑；GUI 把用户意图变成文本，并把自己作为 intent-based `gui.*` extension 暴露给 TUI。**

Codex backend 负责上下文、记忆、工具、插件、算法、修复和执行。SciForge 长期只支持 Codex backend；DeepSeek `deepseek-v4-flash` 是默认 model provider，而不是另一个 backend。SciForge GUI 负责人体工学输入、可视化展示、确认、输入收集和焦点控制。

## 最终分层

```text
GUI Shell
  translates user gestures to text
  maintains semantic GUI event bus and hot-region projection
  exposes a read-only virtual GUI resource tree for state inspection
  exposes intent-based gui.* tools to TUI agent
  negotiates placement, timing, conflicts and rendering

TUI Agent Host
  receives text
  owns reasoning, command parsing, context, memory, planning and repair
  uses native plugins / skills / tools / MCP / providers
  calls gui.* tools when it has presentation or user-interaction intent

Native Agent Extensions
  capability discovery, scientific algorithms, policy/harness, providers,
  verifiers, artifact generation, workspace operations
```

## 两个方向

### 1. GUI → TUI：全部是文本

GUI 所有用户动作都变成终端等价文本：

```text
点击删除文件      -> rm report.md
点击重试          -> /rerun run-123
点击修复          -> /recover run-123 --with-evidence
点击打开 artifact -> open artifacts/report.md
表单提交          -> /capabilities prefer literature.search pdf.extract
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

## GUI 状态投影

GUI 可以有内部逻辑，但它属于 presentation behavior。GUI 内部事件先进入 semantic event bus，再投影成 TUI 可用的 progressive context：

```text
DOM / pointer / keyboard / scroll / modal events
  -> GUI semantic event bus
  -> shell context + hot region context
  -> optional region detail or debug snapshot on request
```

默认只暴露 hot region，不暴露完整 DOM。Hot region 至少包含 focused panel、selected refs、interaction mode、lastChangeOrigin、available actions 和 revision。

## TUI 感知 GUI：只读虚拟资源树

TUI 不应该通过截图、DOM dump、ANSI buffer 或 GUI 私有对象理解界面状态。更稳的模型是把 GUI 看成一个只读虚拟资源树，像读文件系统一样分层探测：

```text
/gui/shell.json
/gui/hot-region.json
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
| GUI 展示哪个结果 | TUI 调 `gui.present`，GUI 决定 renderer/placement。 |
| 用户确认、补充输入 | TUI 调 `gui.ask_user`，GUI 收集后发文本。 |
| TUI 想知道 GUI 当前状态 | TUI 读只读 GUI resource tree 或调用 `gui.get_context`。 |
| GUI 布局、焦点、主题 | GUI 本地人体工学状态。 |

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
| Artifact schema / verifier | TUI 原生 tool 或 skill。 |
| GUI 展示、确认、输入收集 | SciForge GUI extension 暴露的 intent-based `gui.*` tools。 |

## Capability Discovery

Capability Discovery 不属于 GUI/runtime。用户若从 GUI 触发能力发现，GUI 只发送文本：

```text
/capabilities search "build an evidence matrix for recent papers"
/capabilities expand literature.search pdf.extract citation.verify
/capabilities plan --goal "build evidence matrix"
```

工具名可以沿用 `capability_discovery.search/expand/plan/explain`，但注册、权限、审计、provider readiness、progressive disclosure 都由 TUI host 原生机制负责。Discovery plan 不构成 completion evidence；展示必须通过 `gui.present` 或 `gui.ask_user`。

## Harness / Policy

Harness / Policy 属于 TUI 原生扩展。它可以决定 context refs、tool/provider budget、capability preference、verification depth、repair action、background continuation 和 progress milestones。

它可以通过 `gui.present`、`gui.ask_user`、`gui.notify`、`gui.set_status` 影响 GUI 展示，但不能把策略写进 GUI，也不能让 GUI 变成第二个 agent。

## UI Implementation Boundary

React/UI 只做 presentation behavior：

- user gesture -> command text。
- semantic event bus -> shell/hot-region context。
- read-only virtual GUI resources -> `list/read/search/stat/watch`。
- `gui.*` intent implementation。
- layout、focus、theme、draft、folding、selection。
- intent negotiation、precondition check、defer/reject/suggestion。

React/UI 不做 provider branch、capability ranking、repair policy、prompt route、workspace execution 或 task completion 判断。

## 成功标准

- 同一任务在纯 TUI 中可完成。
- 接入 SciForge GUI 后只增加展示和交互能力，不增加算法能力。
- 不需要独立 AgentServer；默认直接连接 Codex backend。
- 默认运行期不得消耗 OpenAI token，除非用户显式 opt in；生产默认应让 Codex backend 走 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy。
- GUI 没有 provider 分支、repair 策略、capability ranking、prompt route。
- 所有 GUI 按钮最终只发送文本。
- TUI 用原生机制调用 intent-based `gui.*` tools；GUI 可协商、延迟或拒绝。
- GUI 默认只向 TUI 披露 shell + hot region 状态。
- 算法模块可以直接给 Codex plugin / skill / tool / MCP 使用。
