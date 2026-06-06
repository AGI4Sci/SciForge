# SciForge 架构

最后更新：2026-06-06

## 北极星

SciForge 是 TUI agent 的 GUI extension，不是 agent host。

> **TUI / agent host 拥有全部任务逻辑；GUI 把用户意图变成文本，并把自己作为 `module.*` GUI extension 暴露给 TUI；`gui.*` 只作为迁移 shim。**

Codex Agent Host 负责上下文、记忆、工具、插件、算法、修复和执行。SciForge 长期只支持 Codex backend 作为 Agent Host 集成；默认运行期 provider 指向 SciForge Model Router 的公开 alias/profile，由 router profile 选择 text reasoner 与 modality translators，而不是把某个具体上游模型写成产品事实。SciForge GUI 负责人体工学输入、可视化展示、确认、输入收集和焦点控制。

当前产品默认入口是一个普通聊天 turn，而不是 Browser Search、Computer Use、turn router/gateway 或 runtime gateway 的独立产品层。GUI 只提交自然语言文本、结构化 refs、Autonomy profile 和确认/取消；Codex/TUI Agent Host 在同一个 `Codex Agent Host Turn Loop` 中决策：`Ground` 收集 workspace、BrowserHostSession、WindowActionSession/evidence 等上下文，`Guard` 按风险、授权和 autonomy profile 判定是否确认、handoff 或阻断，`Act / Answer` 决定调用 Browser/Computer Use/connector/workspace 等能力或直接回答。Runtime Codex 是 downstream runtime adapter，不是默认聊天 product owner。能力声明必须来自 runtime health、BrowserHostSession、native surface、target binding、authorization profile 和 evidence refs，而不是模型固定自述。默认 `High Autonomy` 不等于无审批；发送、提交、上传、删除、支付、账号/安全、法律合规和外部系统执行等动作仍必须 hard-confirm。

## 最终分层

```text
GUI Shell
  将用户手势翻译成文本
  维护语义 GUI event bus 和 hot-region projection
  暴露只读虚拟 GUI resource tree 供 TUI 探测状态
  向 TUI agent 暴露 GUI module intents；legacy gui.* 只在 adapter shim 中存在
  协商 placement、timing、conflicts 和 rendering

TUI Agent Host
  接收文本
  拥有 reasoning、command parsing、context、memory、planning 和 repair
  使用原生 plugins / skills / tools / MCP / providers
  有 presentation 或 user-interaction intent 时调用 GUI module intents

Native Agent Extensions
  capability discovery、scientific algorithms、policy/harness、providers、
  verifiers、artifact generation、workspace operations
  只向 TUI Agent Host 暴露原生 tool/plugin/MCP/provider/worker surface
  不直接 import 或调用 GUI implementation
```

## Codex Agent Host Turn Loop 与 Semantic Pipeline

SciForge 的跨模块组合由 `Codex Agent Host Turn Loop` 驱动，并采用 Agent Host Semantic Pipeline 组织模块调用，而不是让 GUI、runtime、turn router 或 gateway 成为第二个 agent host。

默认聊天 turn 的产品语义只有三段：`Ground` 读取用户文本、refs、workspace、BrowserHostSession、WindowActionSession 和其它证据；`Guard` 结合 autonomy profile、policy、approval 和 handoff 规则判断是否继续；`Act / Answer` 要么调用 Browser、Computer Use、connector、workspace 等模块，要么直接回答。Browser Search 和 Computer Use 是这个 loop 中可被选择的能力，不是平行产品入口。

> **Agent Host 负责编排；模块只暴露统一的标准函数；复杂功能通过 typed semantic pipeline 组合完成；GUI 也是一个特殊模块。**

面向更一般软件工程范式、开源项目资源封装、UI/memory/skills/tools/project 关系和 resource graph 的完整设计见 [`SemanticModuleEngineering.md`](SemanticModuleEngineering.md)。外部通讯渠道的输入、Web 聊天端投影和可插拔 channel plugin 设计见 [`ChannelPluginArchitecture.md`](ChannelPluginArchitecture.md)。

这借鉴 Linux 管道的小工具组合思想，但管道中传递的不是裸字节流，而是 typed envelope、resource ref、operation result、approval request 和可审计 trace。

| 角色 | 职责 |
|---|---|
| Agent Host | Codex app-server 或 Claude Code 等成熟 agent host。负责推理、规划、模块选择、调用顺序、重试、取消、repair 和 pipeline trace。 |
| Module | 单步能力提供者。只通过标准函数暴露资源、能力和意图，不直接调用其它模块。 |
| Runtime Adapter | 把 Codex app-server、Claude stream-json、MCP 或本地进程事件规范化为 SciForge 内部事件和 trace。 |
| GUI Module | 特殊模块。提供热状态、展示、确认、用户输入和 presentation autonomy，但不拥有任务推理或 capability ranking。 |

### L0/L1/L2 边界

最简单的判断：

> **L2 负责想清楚怎么做；L1 负责把一类复杂资源整理成统一接口；L0 负责把一个具体动作做掉。**

```text
User / GUI text
  -> L2 Root Agent Host
     -> module.describe/query/read/invoke
        -> optional L1 Resource Adapter
           -> L0 Module Handler
```

| 层级 | 是什么 | 典型例子 | 关键边界 |
|---|---|---|---|
| L2 Root Agent Host | 当前任务的总控。 | Codex app-server、Claude Code backend adapter。 | 一个 active task 只应有一个 L2；它负责规划、选择模块、串联步骤、approval、repair 和 trace。 |
| L1 Resource Adapter | 某一类资源或外部系统的适配层，可选。 | GUI resource adapter、browser adapter、memory store adapter、某个开源桌面应用 adapter。 | 只管理同一资源域；不做跨模块任务规划，不决定任务下一步。 |
| L0 Module Handler | 具体能力的叶子实现。 | `read file`、`search memory`、`present panel`、`verify output`、`desktop click`。 | 只执行本动作；不直接调用其它模块，不判断任务是否完成。 |

放在哪一层的规则：

- 能用一个 handler 完整表达的能力，直接放 L0。
- 一组 L0 共享登录、session、cache、index、事件订阅、ref 解析或版本兼容时，再加 L1。
- 多个无关模块要被串起来完成任务时，不加 L1；这属于 L2 semantic pipeline。
- 一个任务里不要有两个 L2 同时决定下一步。多个 L2 只适合多个独立会话、多个 workspace 或明确的 federation 边界。

不管 L0 是否经过 L1，L2 看到的公共入口始终只有同名 `module.*` 函数。L1 只是把复杂资源整理清楚，不能扩大公共 API 面。

所有暴露给 Agent Host 的边界模块都必须通过同名函数进入；内部 helper、纯算法函数、React component、validator 和 package-private adapter 不需要直接实现这组函数。在运行形态上，可以是每个模块实现同名 handler，也可以是一个中央 dispatcher 接收 `moduleId` 后转发。对 Agent Host 来说，canonical public surface 始终只有：

```text
module.describe
module.query
module.read
module.invoke
```

语义边界：

| 函数 | 语义 | 副作用 |
|---|---|---|
| `module.describe` | 发现模块、resource kind、intent、权限、成本、延迟和可选 facet。 | 无 |
| `module.query` | 查找候选对象、能力、记忆、skill、资源或动作入口。 | 无 |
| `module.read` | 读取一个具体 ref 的小型语义内容或 metadata。 | 无 |
| `module.invoke` | 请求模块执行一个明确 intent。可能返回结果、approval request 或 operation ref。 | 可有 |

`module.describe` 是唯一硬必备能力。模块如果不支持 `query`、`read` 或 `invoke`，必须在 `describe` 中声明不支持；Host 对未声明能力的调用应 fail closed，而不是猜测 fallback。

`list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为特定 `invoke` intent。这样公共函数少，但能力不被削弱。

`events`、`refs`、`approval`、`subscription/watch` 和 `batch` 是按需 facet，不是所有模块的必备项。它们必须能被 `module.describe` 查询到；没有被声明的 facet，Agent Host 不得假设存在。

| Facet | 何时需要 | 例子 |
|---|---|---|
| `events` | 长任务、实时进度、partial message、tool lifecycle。 | browser run、computer-use、Claude stream-json、Codex app-server turn。 |
| `refs` | 大 payload、敏感内容、可复用对象、审计证据。 | file ref、artifact ref、trace ref、memory ref、screenshot ref。 |
| `approval` | 有外部副作用、高风险写入、发送、删除、支付、授权。 | connector send、desktop input、workspace destructive action。 |
| `subscription` | 热状态或缓存变化。 | GUI hot region、browser tab state、long-running index status。 |
| `batch` | 多步 GUI-local transaction 或需要 revision/precondition。 | `gui.apply_batch`、bulk annotation update。 |

推荐的 `describe` 输出至少包含 module id/title/summary、resource kinds/ref prefixes、intent names/side effect/approval/operation-return flags、supported facets 和 inline/latency limits。具体注册仍走 Codex dynamic tools、MCP、Claude Code MCP tools 或本地 adapter；这不是新的 plugin runtime。

跨模块交互由 Agent Host 组合，不允许模块之间互相 import 或直接调用：

```text
module.query(memory, "用户之前如何定义 GUI-TUI 边界")
  -> module.read(memoryRef)
  -> module.query(skills, "pdf extraction")
  -> module.invoke(capabilities, "plan", ...)
  -> module.invoke(actions, "run", ...)
  -> module.invoke(verifier, "check", ...)
  -> module.invoke(gui, "present", ...)
```

默认是 trace-first：Agent Host 可以隐式组合模块，但必须记录结构化 pipeline trace；高风险、长任务、跨外部系统或多副作用流程，应先生成显式 pipeline plan。GUI 可以展示 pipeline trace、approval request 和运行状态，但不决定 pipeline。模块可以返回 suggested next steps，但下一步是否执行由 Agent Host 决定。

GUI 模块的 canonical 调用也是 `module.*`。迁移期只能在 adapter shim 中继续暴露 host-specific `gui.*` alias，例如 `gui.present`、`gui.read`、`gui.search`。稳定设计以 `module.describe/query/read/invoke` 为主接口，`gui.*` 只是 GUI 模块的兼容映射。

## 两个方向

### 1. GUI → TUI：文本、refs、Autonomy profile 和确认/取消

GUI 默认只提交自然语言文本、结构化 refs、Autonomy profile 和确认/取消结果，不调用 Browser、Computer Use、connector 或 workspace 业务函数。Debug/expert surface 可以生成终端等价文本，但不能成为普通用户默认入口：

```text
普通输入          -> "请总结 artifacts/report.md 的证据强度"
选中对象后追问    -> text: "这些异常点是什么？", refs: ["artifacts/table.csv"]
Autonomy 选择     -> autonomyProfile: "high"
确认/取消         -> confirmationResult: "confirm" | "cancel"
debug/expert      -> "/rerun run-123"
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

GUI-origin 常见信息流：

```text
User / GUI gesture
  -> natural-language text + refs / Autonomy profile / confirmation result
  -> TUI Agent Host
  -> native extension module
  -> refs-first result | approval request | repair hint | compact payload
  -> TUI Agent Host
  -> gui.present / gui.ask_user / gui.notify / gui.set_status
  -> GUI Shell
```

这个模型把 GUI 定义为 TUI Host 可调用的 presentation/input service，而不是 extension 的依赖。Extension package 只暴露 typed request/result、manifest、trace/audit refs 和必要的 host port contract；产物型 extension 结果必须用 refs-first `finalArtifactRef` / `finalArtifactRefs` 标明当前 run bundle 的最终产物。TUI Host 负责把这些结果映射成 `ToolPayload`、事件流、`gui.present` 或 `gui.ask_user`。

并非所有外部通讯都必须走 `GUI gesture -> TUI -> connector -> GUI` 这条交互链。飞书、微信、企业微信、邮件或 webhook 这类通讯入口可以有一条 **agent input intake** 路径：connector 只把外部消息规范化成 Agent Host 的输入 envelope，相当于用户在 Web/GUI 输入栏提交了一段带 provenance 的文本。

```text
External message / webhook / chat command
  -> connector intake adapter
  -> dedupe / auth scope / redaction / provenance refs
  -> TUI Agent Host input queue or thread
  -> normal Agent Host semantic pipeline
  -> optional gui.notify / gui.present
```

输入型 connector 不需要 GUI 参与，也不需要先调用 `module.invoke(connector)`；它是 Agent Host 的输入 producer，职责是把外部消息、附件和上下文转换为文本、refs 和 metadata。它不能绕过 Agent Host 直接执行 workspace、发送消息或判断任务完成。GUI 可以选择展示 inbox、通知和 trace，但这只是可见性增强，不是任务启动的必经路径。

外部消息进入 Agent Host 后必须写入同一条 thread ledger，并投影成 Web 聊天端可见的用户消息，而不是只作为后台 trigger 存在。Web 聊天端展示 channel badge、sender、conversation/source refs、attachments、audit/debug refs 和 delivery 状态；这些 projection 来自 Agent Host thread events，不来自 connector 直接写 GUI 状态。

高风险副作用必须走同一条受控 Host 路径。Computer Use 的发送、删除、支付、授权、发布、外部提交，或飞书连接器的真实发送/同步/删除，不直接弹 GUI，也不直接执行；extension 返回 `needs-confirmation`、`approvalRequest`、`draftRef` 或 `auditRef`，TUI Host 决定是否调用 `gui.ask_user` 或外部通道的显式确认机制收集确认，确认后再发起下一次受控调用。

Computer Use / Window Action 的验收也按这个边界组织。基础真实输入 smoke 只能证明 action provider、Model Router grounding translator、Executor 和 Verifier 链路可用；用户级 success 必须包含真实用户产物、当前 WindowActionSession evidence、action causality、artifact/verifier refs、`gui.present` refs 和 bounded before/after evidence。目标打通需要覆盖多 app/window/session 工作流，例如 Browser/资料页、notebook/terminal 实验、editor/report artifact 和 SciForge Image/Evidence 展示。GUI 在这些验收中仍只提交自然语言/ref intent、Autonomy profile、确认/取消或展示 refs，不直接执行桌面操作；`gui.present` 只能证明用户可见展示，不能替代 executor、validator 或 action/evidence 证据。

Desktop product acceptance 是同一边界的更强实例：入口必须是 SciForge Desktop Electron shell 的普通聊天 turn，执行链路必须经过 Codex/TUI Agent Host、Desktop native host、`BrowserHostSession` 或 `WindowActionSession`、platform sidecar / scoped adapter、permission refs、hard-confirm refs、current-run evidence bundle 和 artifact/verifier refs。Web/Vite、terminal probe、slash/debug route、package diagnostic、legacy isolated desktop/noVNC/Docker/RDP/M6 evidence 和 shape-only validator 可以进入诊断矩阵，但不能升级为产品完成。GUI 在这里仍是 presentation/control surface：显示 native surface、permission、confirmation、stop/cancel、actor cursor、Image/Evidence 和 `gui.present` 投影；它不持有 executor lease，不扩大 authorization，也不决定 completion truth。

Generated-task 的 `completionCandidate`、ArtifactDelivery 和普通 artifact/workEvidence refs 只是可恢复或可展示证据，不能提升为 Agent Host 的 `completionTruth`。用户级 workflow completion 必须由 runtime owner 产出同一 current-run 的 verifier manifest/evidence refs，并通过 package-owned validator 或受控 truth adapter；未验证候选产物只能投影为 repair-needed/unverified。

Computer Use action provider 是 Agent Host 的 GUI I/O augmentation layer，不是第二个 planner/agent。输入增强包括 observe、screenshot、crop、OCR、Model Router vision observation、AX/DOM/UIA hints、PTY/editor/file/artifact evidence、freshness 和 action history；输出增强包括 ground/bind、execute、before/after evidence、local verify、action ledger 和 stale invalidation。用户级任务理解、跨模块规划、approval 决策、repair 和 completion 仍归 Agent Host。

Computer Use action provider 可以消费 `packages/observe/vision` 的 observation、focus-region、grounding 和 verifier feedback，但执行所有桌面/远程/dry-run action 的 owner 仍是 `packages/actions/computer-use` 以及 TUI Host 注入的 host ports。当前终局不是隔离 VirtualAppScreen，而是 **Host-owned real window/app action**：用户和 agent 面对正常系统窗口；SciForge 用 WindowActionSession、windowRef、actorCursor、adapter route 和 before/after evidence 解释动作。底层优先使用 BrowserHostSession/CDP/Playwright、app-native command、editor extension、terminal PTY、Accessibility/UI Automation/AT-SPI、Model Router vision translator 生成的 grounding/observation，或显式 shared-system-input evidence。证据组合按用途选择，而不是固定流水线：文本、role、value 和 artifact 内容优先结构化 exact evidence；可见性、遮挡、布局、焦点、点击可达性和最终人类可见结果优先 fresh screenshot/crop；freshness > confidence，同 owner/session/target evidence 优先；cheap evidence first，不确定、冲突或风险升高时再升级到 crop/OCR/vision/verifier。`vision-sense` 不拥有 executor、scheduler、desktop bridge、MCP 会话或用户级完成判断；它只产生 refs-first 的视觉信号。Computer Use 不按具体上游模型类型做产品级分叉；router profile 的 `textReasoner` 是 reasoning owner，`translators.vision` 只把截图、crop 或 ref 转译成文本观察。截图、crop、replay、PDF 或 document export 只能作为 evidence/artifact，不作为第二个可交互屏幕，也不是交互 fallback。Computer Use trace 只记录 surface/window refs、截图 refs、focus crop refs、sha256、尺寸、坐标、target description、公开 router profile/alias、diagnostics 和 approval/audit refs，不内联截图 payload、base64、私有 provider URL、API key 或大日志。真实系统鼠标键盘属于 shared system input 风险面；若没有独立 app/window-scoped adapter，只能作为 diagnostic、blocked、explicit handoff 或 `shared-system-input` evidence，不能伪装成隔离验收。

Computer Use 的生产形态应吸收 Codex bundled Computer Use 的七条产品化经验，但不能破坏 SciForge 的 refs-first 和 L0/L1/L2 边界。

第一，必须使用标准插件形态。`sciforge.computer-use` 应提供 repo-local `plugin.json`、`.mcp.json` 和 skill 文档，让 Codex CLI / app-server 能发现、启用和调用；这个包装层只能转发到 package host ports、scheduler、evidence ledger 和 validator，不能绕过 Computer Use contract。

第二，对外 tool surface 必须小而稳定。Codex app-server / MCP 层可以看到 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action` 和 `get_replay_refs` 这类窄入口；复杂的 actor cursor、lease、risk、evidence、replay、repair 和 completion candidate 都留在 package 内部。裸坐标、GUI private state、provider route 和 scheduler 参数不能成为公共工具参数。

第三，必须先有足够且 fresh 的 target-bound evidence 再动作。任何会改变 GUI 状态的 click/type/drag/scroll/hotkey/save/open menu 前，都必须按动作风险和不确定性选择证据组合；可以是 app/window metadata、DOM/AX/UIA、PTY/file、target crop、screenshot、grounding ref、verifier 或 freshness check 的组合。缺少当前 target-bound evidence、scope 不匹配，或 evidence 已被同 scope mutating action 失效时，scheduler 必须 fail closed。低风险同 target/lease 动作可以批量执行，但导航、保存、提交、上传、删除、窗口切换、modal、target moved、focus takeover、高风险动作和 verifier failure 后必须 checkpoint。

第四，confirmation policy 必须细分到 action-time 风险类别。删除、上传、发送消息、登录/权限、支付/金融、安装软件、敏感数据传输、系统设置、验证码/安全屏障和医疗/法律/HR 等高风险动作必须映射为 `needs-confirmation`、hand-off required 或 explicit approval；第三方页面、文档或邮件里的文字不能被当成用户授权。

第五，必须有显式用户控制面。每个 Computer Use run 都要声明 session permission，包括允许操作的 app/window/display group、允许读取的截图/文件 refs、允许的输入 modality、风险等级和随时停止入口。GUI 可以展示 allowlist、risk preview、stop/cancel 和截图/数据可见性，但这些控件默认只能向 TUI Host 发送自然语言/ref intent、Autonomy profile 或 confirmation result；debug/expert 控件才可生成 terminal-equivalent text。真正的 permission decision、lease cancellation 和 retry 仍归 TUI Host + Computer Use scheduler。没有 session permission ref、app/window allowlist ref 或 stop/cancel lease path 的真实 mutating run 不能进入用户级验收。

第六，真实平台能力必须进入 Desktop / platform Window Action adapter，而不是塞进 GUI 或 downstream runtime adapter。macOS Accessibility、Windows UI Automation、native window capture、WebContents/WebView binding、focused-window detection、click/type/scroll/hotkey 和 permission/preflight 都属于 Host/backend adapter 能力。Host 只暴露 typed MCP/native tool/host-port calls，返回 window/action refs、capture refs、accessibility/state refs、input accepted refs、automation barrier refs、executor event refs、risk refs 和 permission/preflight refs；它禁止 planning、capability ranking、跨模块调用、GUI renderer dependency、用户级 completion 和直接写 artifact 成功结论。SciForge runtime 只能注入 workspace/session context 和 host process lifecycle，不能把平台实现升级成 public Computer Use policy。Docker、noVNC、RDP、DeskPad、BetterDisplay、Mirage 和 Sunshine/Moonlight 只描述 backend packaging、历史诊断证据、reference adapter 或 benchmark，不再作为当前 active gate、产品验收 owner 或第二交互真相源。

第七，产品化 smoke 必须从 package diagnostic 前进到 Desktop native / real window path。默认 release gate 仍不运行长耗时 live tests，但 active backlog 至少要覆盖：Codex app-server/native plugin 调用 SciForge Computer Use、WindowActionSession active gate、adapter readiness、BrowserRuntime DOM/AX observation refs 作为只读 hint、research workflow user-acceptance manifest、高风险 confirmation stop、blocked recovery 和 Image/Evidence 可见证据。package-owned target-bound harness 只能证明 contract 和 diagnostic；Docker/noVNC/RDP/M6 multi-screen run 只能作为 legacy diagnostic、historical evidence、backend packaging 或 sidecar/ref historical regression 复验，不能替代 native app-server/native plugin + app/window/session adapter contract + current bundle evidence，也不能阻塞当前路线。

Strict smoke 的产品含义也必须按 owner 读：Desktop hard-confirm 和 Desktop native Browser live acceptance 可以证明对应 Desktop product surface；chat live preflight、package bridge、embedded isolated L3 completion producer 和 complex matrix report 只能证明 readiness、迁移兼容或诊断覆盖，除非其 evidence 明确来自 Desktop Electron native host、当前 `BrowserHostSession` / `WindowActionSession`、permission refs、executor lease、artifact/verifier refs 和 bounded replay bundle。

Computer Use 的 L0/L1/L2 边界必须比一般 action provider 更严格。L2 是 `Codex Agent Host Turn Loop`；生产形态由 Codex app-server 承载，Codex CLI/native plugin host 只作为 expert/debug/smoke/diagnostic host。L2 负责任务规划、跨模块 pipeline、approval、repair 和用户级 completion；Computer Use package 不能成为第二个任务大脑。L1 只能是 Computer Use / Window Action 资源适配层，管理 target app/window/session、actor cursor、input intent、executor lease、evidence 和 replay refs，以及 backend/provider lifecycle；它不做跨模块 planning、capability ranking、prompt route 或 completion 判断。L0 是单动作 handler，例如 capture、crop、ground、execute、verify、writeTrace、emitEvent。多鼠标在产品语义上先是 actor cursor / intent / overlay；真实 OS multi-pointer 或 multi-seat 只是未来可替换 executor backend，不进入 planner、GUI 或 schema 的核心假设。历史 AgentServer、runtime gateway、`codex exec --json` 和 `/computer-use` debug/expert/smoke/diagnostic route 只能作为 legacy/test-only/diagnostic adapter；新增生产路径应收敛到默认聊天 turn -> Codex app-server + native tool/plugin/MCP。

Computer Use 文件责任按生产路径拆成下表，任何新增代码都应落到对应层，而不是把 runtime 或 GUI 重新变成半个 L2。

| 区域 | 层级 | 允许做 | 禁止做 |
|---|---|---|---|
| Codex Agent Host Turn Loop / Codex app-server native tool/plugin/MCP | L2 Root Agent Host | 默认聊天 turn、Ground/Guard/Act/Answer、跨模块 pipeline、approval、repair、用户级 completion 和 pipeline trace。 | 把 `codex exec --json`、AgentServer、Workspace Gateway 或 `/computer-use` 当作普通用户产品入口或 fallback。 |
| Codex CLI/native plugin | L2 debug host | 本地 expert/debug/smoke/diagnostic，复用同一 Computer Use native surface。 | 成为 rich-client production runtime 或默认聊天 product owner。 |
| `packages/actions/computer-use` | L1/L0 owner | request/result schema、session/display group/screen/cursor/lease/replay contract、domain-local action loop、scheduler、executor adapter contract、safety、trace、L0 handler routing。 | 直接调用 GUI、browser、file、verifier 或决定用户级 completion。 |
| `packages/actions/computer-use/virtual-app-screen-host` | deprecated compatibility | 历史 VirtualAppScreen trace / fixture / regression 的兼容读取和迁移辅助。 | planning、completion、GUI import、scheduler policy、workspace write policy、把第三方虚拟屏幕 UI 当 product truth，或作为当前 active product gate。 |
| `packages/observe/vision` | L0 sense provider | capture/crop/OCR、Model Router vision translator/grounding 输出、verifier feedback 和 file-ref-only visual memory。 | 执行 click/type/drag/scroll/hotkey/save，或拥有 scheduler/lease。 |
| `src/runtime/computer-use` | host adapter | 注入 workspace/session context、platform host ports、downstream runtime event projection 和 legacy diagnostic shim。 | 保存 generic Computer Use policy，暴露新增 public API，或绕过 package contract。 |
| Platform adapter / MCP service | L0 platform backend | Host 背后的 OS-specific capture、accessibility/state snapshot、focused-window binding、executor command、permission/preflight 和 isolation report。 | planning、completion、GUI presentation、workspace write policy、provider ranking、mint host grant 或绕过 scheduler/approval。 |
| User control surface | GUI/TUI presentation + L2 policy | 展示 session permission、app/window allowlist、risk preview、stop/cancel、confirmation 和 data visibility refs。 | 直接执行动作、私自扩大 permission、把 allowlist 当 completion evidence。 |
| GUI presentation / viewer overlay | GUI module | 渲染 Image/Evidence refs、WindowActionSession actor cursor overlay、lease owner、proposal 状态、confirmation UI 和 `gui.present` 投影。 | 执行 Computer Use action、传 executor 参数或把 placeholder frame 当 completion evidence。 |
| Acceptance validator | L0/L1 validator | 拒绝缺 provenance、缺 lease、裸全局坐标、shared-input acceptance、placeholder-only viewer、跨 bundle refs 和 stale evidence。 | 根据旧截图、GUI 私有状态或 action history 推断完成。 |

Computer Use L1 的 allowed/forbidden 矩阵是强约束：允许管理 WindowActionSession、window/screen refs、actor cursor、human stop/cancel、automation barrier、screen/window scoped lease、host grant、evidence ledger、replay refs、adapter readiness、backend lifecycle 和 L0 handler routing；禁止 planning、capability ranking、prompt route、workspace write policy、GUI renderer dependency、跨模块调用、retry/repair policy 和用户级 completion。L0 handler 只执行一个动作，不能再调用其它模块。L2 可以读取 L1 返回的 evidence、blocked、approval、repair hint 和 candidate completion refs，但是否继续调用 browser/file/verifier/gui 只能由 L2 决定。

Docker/container/noVNC/RDP 只描述 backend packaging、sandbox、dependency、filesystem/network policy、viewer transport 和 resource lifecycle；它们不是并发协作模型，也不是 one task == one container == one mouse 的产品抽象。并发语义只能来自 Native Host display group、actor cursor、scheduler lease、automation barrier、executor adapter 和 replay/evidence contract。

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

`annotation-plan-only` 边界由主 conversation kernel 和 runtime transport 双层保证：`runPromptOrchestrator` 对该 turn 本地生成 intent draft 响应并跳过 target lookup、context compaction、runtime 和 repair stage；`sendSciForgeToolMessage` 对漏到 downstream Runtime Codex transport 的 plan-only envelope 直接拒绝。quick action 不复用这个 lane，避免 UI 暗示执行但底层仍是 plan-only。

保存注释时，GUI 生成本地 feedback inbox `annotation-plan` record，包括引用对象、原始描述、澄清问答摘要、action log、修改建议、验收标准、URL/route、selector/DOM path 和 screenshot/evidence refs。复杂后续 repair/code/GitHub sync 必须由用户在收件箱中显式启动，并经过对应确认边界。

## 内置浏览器运行时

SciForge 的内置 Browser Pane 是 host-owned `BrowserHostSession` 的 display/control panel；`BrowserHostSession` 是 live browser owner。`browser_runtime` 是 Codex/TUI Agent Host 可在 Ground 或 Act 阶段使用的 capability，不是 GUI 自己实现的网页 agent，也不是独立 Browser agent。GUI 可以展示 browser session、tabs、当前 URL、Desktop Electron `WebContentsView` live surface、截图 refs、DOM snapshot refs、console/network refs 和 human takeover 状态；默认聊天仍只提交自然语言文本、refs、Autonomy profile 和确认/取消。GUI 不判断网页任务意图、不选择 Playwright provider、不拼 browser prompt、不把网页正文或截图 base64 写进 workspace state。

当 turn loop 需要浏览器能力时，`BrowserHostSession` 持有真实 Chromium/CDP session、action channel、live surface 和 evidence refs；底层可以接 `playwright_browser_automation`、native embedded browser adapter 或同一 session 的 host frame-stream，但 BrowserHostSession 仍是唯一 live browser owner。需要登录、验证码、2FA、账户权限或人工接管时，才显式进入 visible takeover / handoff，并要求用户确认。截图、DOM、console、network、PDF/document projection 和下载结果必须 refs-first；projection 只保存 ref、摘要、尺寸/hash/targetRect 等可审计元数据，不能作为 Browser pane 的第二画面真相源或交互 fallback。

实现分层必须保持三段式：纯 schema/helper 放在 `@sciforge-ui/runtime-contract/browser-runtime`；TUI provider wrapper、manifest 和 Playwright MCP adapter 放在 `packages/observe/web`；右侧结果区和工作台展示放在 `packages/presentation/components/browser-workbench` 或 `src/ui` host 装配层。`src/ui/**` 只能 import shared contract 与 GUI presentation package，不得 import `@sciforge-observe/web/browser-runtime`。Computer Use 可以消费 BrowserRuntime 产出的 DOM/AX snapshot refs、stable target refs 或 PageQuery refs，但它们只能作为 observation、target hint、freshness check 或 verifier context；DOM/AX/Playwright 不能成为 Computer Use executor 或 completion evidence。

详细设计见 [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)。

## 右侧结果交互模块

Cursor/Codex agent 风格的右侧结果区由 `ResultShell` 和 package-owned presentation modules 组合，而不是由 `src/ui` 为每种能力手写独立结果卡。右侧栏按对象类型渲染 Browser、Screen、Terminal、Files、References 和 Results preview；点击 object ref 的默认语义是 focus/open 对象，只有显式 Attach/Pick/上下文菜单才把引用插回输入框。

### ResultShell pane contract

每个 pane 必须声明 object kind、ref prefix、可见状态、required refs、allowed actions 和 redaction rule。未知对象进入 typed unsupported state，并展示可复制的 ref；不得退回 raw JSON/log dump。大 payload、截图、录屏、terminal transcript、DOM/AX snapshot、artifact、audit、replay 和 provider output 必须 refs-first；GUI projection 只能保存 ref、摘要、尺寸/hash、live surface handle/ref 和 redacted diagnostics。

| Pane / 组件 | GUI package owner | Host / TUI owner | 必须保持的边界 |
|---|---|---|---|
| Results / `ResultShell` | 路由 object ref、placement、loading/empty/error/blocked/unsupported 状态和 object action UI。 | TUI 负责决定哪些 artifact/file/image/table/report/interactive view 是可预览结果。 | Results 不展示普通 chat answer，不从日志推断 completion，不内联 provider payload。 |
| Browser / `browser-workbench` | 渲染 browser projection、typed state、tabs、Desktop Electron `WebContentsView` live surface、snapshot/log refs、Open/Back/Forward/Reload/Stop/Snapshot/State/Takeover/Copy URL/Open External 命令。 | `BrowserHostSession` / `packages/observe/web` / TUI `browser_runtime` 拥有 provider、CDP/Playwright/native browser adapter、登录接管、DOM/AX/console/network/screenshot/search refs、非桌面 diagnostic/evidence stream 和网页动作。 | GUI 默认只发自然语言/ref intent 或 declared intent，debug/expert 才生成 `/browser ...` 文本；不选择 provider、不跨域读取 DOM、不把 iframe/proxy/snapshot/旧 frame/系统 popup 当 live browser、第二真相源或交互 fallback、不判断网页任务完成。 |
| Image / Evidence / `image-evidence-viewer` | 渲染截图、crop、Browser evidence、window capture、artifact preview、replay/history image、annotation overlay 和 provenance。 | BrowserHostSession、WindowActionSession、Global Annotation、artifact preview 和 ref materializer 拥有证据生成与 refs。 | GUI 不执行 Computer Use action，不持有 executor lease，不接收 raw screenshot/base64/provider payload；截图/replay/PDF/document 只能是证据或静态对象，不是第二个交互真相源或交互 fallback。 |
| Terminal / `terminal-session-viewer` | 渲染 host-owned live surface 或 transcript fallback、cwd、status、rows/cols、exit code、Copy/Download/Stop/Focus/Resize/Input/Paste intents。 | TUI/Host PTY adapter 拥有 process、socket、stdin、resize、stop、copy/download materialization 和 transcript refs。 | Terminal pane 不展示 Active result、agent answer、trace dump、activity/environment summary；stopped/error session 不能继续输入。 |
| Files / `workspace-file-viewer` | 渲染 workspace tree、选中文件、只读/编辑草稿、dirty/cancel/save/error 状态、copy/open/toggle view intents。 | Host workspace adapter 拥有 list/read/write、路径规范化、权限、冲突处理、大文件/二进制策略和持久化。 | 默认只读；显式 Edit 后才允许草稿；GUI 不直接写 workspace，不把绝对私有路径作为长期上下文。 |
| References | 按 artifact/file/browser/screen/terminal/evidence/provenance 等 kind 分组展示 refs、focus/open/copy/pin。 | TUI/Host 拥有 ref 生成、provenance、audit、bundle-local validity 和 materializer。 | References 是 object inspector，不是 raw event log；未知 ref 显示 unsupported，不展示未脱敏 provider JSON。 |

`packages/presentation/interactive-views` 负责把 UI manifest slot、artifact type 和 prompt 明示的 view request 路由到这些 package renderer。`src/ui` 只装配 helper 和 host adapter，不在结果区重新实现 browser/screen/terminal/file/reference 的业务语义，也不越过 Agent Host 直接执行 browser、Computer Use、terminal 或 workspace action。

### Cursor Agent 对照记录

状态：已用 Computer Use 只读观察 Cursor Agents 窗口并形成通用对照清单（2026-05-31）。记录仅保留稳定信息架构：左侧线程/仓库与项目入口、中间聊天与 Worked/Thought 折叠过程、右侧对象/文件预览 tab；不得记录当前坐标、当前 URL、具体历史 run id 或一次性截图路径作为产品逻辑。

通用行为清单：

- 右侧栏按对象打开和聚焦，Browser、Image、Terminal、Files、References 各自有独立状态；普通回答留在聊天区。
- Terminal 只像终端：session 标题、cwd、running/stopped/error、stdout/stderr/transcript、exit code、输入、stop、copy/download、focus/resize；agent trace 和 answer summary 不混入终端。
- Browser 像网页工作台：地址栏和导航命令可见；Desktop 主体是 host-owned `WebContentsView` native surface；不可 attach、网络失败或权限阻断必须给原因和恢复/hand-off 动作，但不能创建交互 fallback；自动化观察和动作属于 host runtime。
- Image 像视觉证据栏：主体展示截图、crop、Browser evidence、window capture、artifact preview 和 replay/history image；actor cursor 和真实输入状态属于 WindowActionSession/Browser projection，replay/snapshot 只作证据，不能作为备用交互面。
- Files 像文件查看器/编辑器：默认只读、显式编辑、保存失败保留草稿；多 tab 状态互不污染。
- References 像 provenance inspector：按对象类型分组，支持 open/focus/copy/pin；不把 raw trace/provider payload 当 UI。
- 所有 pane 的按钮都是 focus/open、declared intent、confirmation/cancel 或 debug/expert terminal-equivalent text；不会因为点击 citation 就自动把 ref 塞进 composer。

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
| `module.query({ moduleId: 'gui', scope })` | 列出或搜索可见 GUI resource 子节点。 |
| `module.read({ ref: 'gui:/...' })` | 读取某个 resource 的语义快照。 |
| `module.read({ ref, includeMeta: true })` | 获取 revision、更新时间、大小、披露级别和权限。 |
| `module.invoke({ moduleId: 'gui', intent: 'subscribe' })` | 订阅语义变化事件，而不是低级 DOM 事件。 |

如果目标 TUI host 支持 MCP resources、LSP-like resources 或原生 context provider，应优先复用这些机制；否则只能由 adapter shim 把同名操作作为 `gui.*` read-only tools 注入。它们只读 GUI 语义状态，不触发任务操作。

这个模型解决两件事：

- TUI 可用熟悉的 `list/read/search/stat/watch` 组合逐层探测 GUI，而不需要一次吃完整页面。
- GUI 可以隐藏大多数同时无关的区域，只暴露 shell、hot region 和按需 region detail。

GUI resource search 不是让 TUI grep 原始 DOM。它搜索的是 GUI projector 生成的语义文本和结构化 refs；debug resource 只用于审计/排障，默认不进入 agent context。迁移期可继续暴露 `gui.list/read/search/stat/watch` alias；稳定范式中的 canonical 入口是 `module.query/read/invoke`。

## 双目录能力发现

能力分成两个目录，不能混在一起：

1. **任务能力目录**：skills、tools、plugins、MCP、provider、verifier、harness 和 capability discovery 都属于 TUI/Codex 原生生态。GUI 想触发发现时，默认提交自然语言文本、refs 和 Autonomy profile；debug/expert 控件才生成 `/capabilities search`、`/capabilities expand`、`/capabilities plan`、`/capabilities explain` 这类终端等价文本。
2. **展示能力目录**：`packages/presentation/components` 里的 renderer、viewer、workbench 组件属于 GUI extension。它们只说明“GUI 能怎么展示某类 artifact/ref”，不说明“任务应该调用哪个算法或工具”。

GUI 展示能力通过只读资源暴露给 TUI：

```text
/gui/capabilities/presentation.json
/gui/renderers/<componentId>.json
```

TUI 的最小发现流程是：

```text
module.query({ moduleId: 'gui', scope: 'gui:/capabilities' })
module.read({ ref: 'gui:/capabilities/presentation.json' })
module.query({ moduleId: 'gui', query: 'markdown report viewer', scope: 'gui:/capabilities' })
module.invoke({ moduleId: 'gui', intent: 'present', input: { ref: 'artifacts/report.md', hint: 'markdown' } })
```

这个方案的可靠性来自单一归属：TUI 不 import React 组件、不维护 GUI renderer registry；GUI 不注册任务 skills/tools、不做 capability ranking。双方只通过标准 `module.*` 函数协作；`gui.*` 只能作为 host-specific adapter alias 暂留。

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

agent 回复、报告正文和消息 metadata 中出现的 artifact/file/run 引用必须尽量变成结构化 object reference，而不是只能显示成普通文本。可解析引用包括显式 `artifact:`、`file:`、`run:` ref，也包括 Computer Use run bundle 内的 `finalArtifactRef` / `finalArtifactRefs` 和能精确匹配当前 session artifact 或 workspace file 的裸文件名，例如 `arxiv_multi_agent_report_20260521.md`。

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
- Codex custom model provider / `model_providers.<id>.base_url`；默认指向 SciForge Model Router 的 `/v1/responses` facade。
- 必要时的本地 Codex provider proxy。

默认聊天 turn 的 Agent Host 集成目标是上游 Codex app-server + custom model provider，默认 provider 指向 SciForge Model Router；router profile 再解析 text reasoner、vision translator、trace root 和补问预算。GUI 启动或连接 Codex app-server，把用户自然语言、refs、Autonomy profile 和确认/取消写入 agent host，再消费其 thread/turn/item/approval 事件流。`codex exec --json` 只作为 legacy/test-only 兼容和历史证据；Claude Code stream-json 可作为可选 downstream runtime adapter。SciForge 不再要求常驻 AgentServer；历史 `AgentServer` / `runtime gateway` 只能作为当前代码兼容层或迁移来源，不是最终架构依赖，也不得出现在新增 public API 中。

迁移目标应收敛为 `CodexAppServerAdapter` 生产默认、`CodexExecJsonAdapter` legacy/test-only、`ClaudeStreamJsonAdapter` 可选。现有 `AgentCliAdapter` 继续隔离进程和事件细节，但不能把 `codex exec --json` 视为产品 fallback。细节见 [`CodexRuntimeMigration.md`](../packages/backend/CodexRuntimeMigration.md)。

因此 SciForge 不再定义 `registerCommand`、`registerTool`、`registerPolicy`、`HarnessRuntime`、`CapabilityGateway` 或自己的 TUI plugin manifest。

典型归属：

| 能力 | 归属 |
|---|---|
| 文献检索、PDF 解析、引用核验 | TUI 原生 plugin/tool/skill。 |
| 数据分析、统计、绘图 | TUI 原生 plugin/tool/skill。 |
| Capability Discovery | TUI 原生 plugin/tool/skill。 |
| Harness / policy / budget / repair | TUI 原生 policy/plugin/skill。 |
| Provider route / MCP / remote worker | TUI 原生 provider/tool 生态。 |
| 外部软件连接器，如飞书、微信、企业微信 | TUI 原生 connector/tool/MCP/worker；repo 内 adapter 放在 `packages/connectors`。可作为 Agent Host 的输入 intake，也可作为受控外部资源/动作模块。 |
| Computer Use | TUI 原生 action provider；repo 内能力主体放在 `packages/actions/computer-use`，可消费 `packages/observe/vision` 的 sense/grounding/verifier 输出，桌面/远程/dry-run 执行通过 TUI Host ports 接入，并在产物任务中输出 bundle-local `finalArtifactRef` / `finalArtifactRefs`。 |
| Artifact schema / verifier | TUI 原生 tool 或 skill。 |
| GUI 展示、确认、输入收集 | SciForge GUI module 暴露的 `module.invoke({ moduleId: 'gui', intent })`；`gui.*` 只作为 adapter shim。 |

外部连接器和 Computer Use 遵守同一条边界：GUI 不直接调用第三方 SDK、CLI、桌面自动化、Computer Use executor 或 API。默认 GUI 只提交自然语言文本、refs、Autonomy profile 和确认/取消；expert/debug 控件可以生成终端等价文本，例如 `/connectors feishu draft-message ...`，但普通 Computer Use 需求仍由默认聊天 turn 触发，`/computer-use` 只保留 debug/expert/smoke/diagnostic 用途。外部聊天消息也可以由 connector intake 直接进入 Agent Host input queue，等价于 Web 端输入栏提交。TUI 决定是否调用 connector/action provider。拓展模块输出 refs-first 结果，例如 external refs、artifact refs、trace refs、draft refs、approval request、audit refs；发送、删除、同步、桌面输入等有外部副作用的操作必须经过 TUI 侧 approval / dry-run / idempotency 规则，并由 TUI Host 通过 `gui.ask_user` 或外部通道中的明确确认收集确认。

## Desktop Packaging Direction

SciForge 的本地软件形态应复用现有 React + Vite GUI、Node/TypeScript workspace runtime、`packages/backend` proxy 和上游 Codex app-server，而不是重写一套原生 UI 或 agent host。第一阶段桌面壳选型为 **Electron**：

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

工具名可以在迁移期通过 adapter shim 沿用 `capability_discovery.search/expand/plan/explain`，但 canonical surface 是 `module.query/read/invoke(moduleId='capabilities')`；注册、权限、审计、provider readiness、progressive disclosure 都由 TUI host 原生机制负责。Discovery plan 不构成 completion evidence；展示必须通过 GUI module intent，legacy host 可由 shim 转成 `gui.present` 或 `gui.ask_user`。

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

- 用户输入/选择 -> 自然语言文本、refs、Autonomy profile 或 confirmation result。
- debug/expert 手势 -> 终端等价文本。
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
- 默认运行期不得消耗 OpenAI token，除非用户显式 opt in；生产默认应让 Codex backend 走 SciForge Model Router 的公开 alias/profile，由私有 router config 选择具体上游 provider。
- GUI 没有 provider 分支、repair 策略、capability ranking、prompt route。
- 默认 GUI 只发送自然语言文本、refs、Autonomy profile 和确认/取消；debug/expert 按钮最多生成终端等价文本。
- 全局注释侧栏是连续反馈入口：澄清/预览/保存反馈使用无副作用 lane，低风险小改动使用 quick action，复杂执行进入收件箱。
- 注释、反馈和收件箱的 Web UI smoke 可以使用 Codex in-app browser 或 `localhost:5173`；涉及真实 Browser Pane、窗口捕获、全局 overlay 或 native input 的产品验收必须使用 Desktop Electron native host。
- TUI 用原生机制调用 intent-based `gui.*` tools；GUI 可协商、延迟或拒绝。
- GUI 默认只向 TUI 披露 shell + hot region 状态。
- 算法模块可以直接给 Codex plugin / skill / tool / MCP 使用。
- 可解析 artifact/file 引用可以在右侧面板预览；无法解析的普通代码片段不得伪装成对象引用。
- GUI 不制造默认 confidence；所有百分比都必须来自 TUI/verifier/harness 的可解释输出。
