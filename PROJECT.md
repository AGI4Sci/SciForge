# SciForge 当前需求：Agent Host 唯一智能体与工具边界

最后更新：2026-06-08

## 核心判断

SciForge 的唯一智能体是 Codex / Agent Host。Agent Host 的模型能力统一来自 Model Router `/v1/responses`；凡是需要推理、规划、语言生成或多模态理解的 Host step，都通过 Model Router 获得模型能力。

Model Router 不是第二个 agent。它对外只是 OpenAI-compatible 的多模态模型 API 边界，负责 provider / protocol / modality translation，不拥有用户任务、对象记忆、workflow、completion truth 或 final answer。

`browser_search`、`browser_read`、Computer Use、artifact/verifier 等都是暴露给 Agent Host 的 tools / actions。工具不具备用户级智能；是否调用、何时调用、如何解释结果，都由 Agent Host 决定。`gui.present` / `gui.ask_user` / `gui_present` / `gui_ask_user` / `moduleId=gui` completion surface 只属于 unsupported legacy / dynamic-tool shim，不是产品 final-answer 路径。

## 主链路

```text
User / SciForge UI
  -> CodexAppServerAdapter
  -> Codex App Server protocol events
  -> Codex / Agent Host
      -> calls Model Router /v1/responses as model substrate
      -> may call MCP tools/actions: browser_search / browser_read / computer_use / artifacts
      -> owns workflow, evidence ledger, object context, repair, completion truth, turn lifecycle
      -> emits assistant final message / tool / approval / done events
  -> FinalAnswerEnvelope
  -> SciForge UI projection
```

SciForge UI 接收用户输入、附件对象和上下文，并把它们交给 Agent Host。UI 可以展示状态、证据、产物和恢复路径，但不生成答案，不判断任务完成，也不替 Agent Host 选择工具。

## Agent Host 拥有

Agent Host 负责：

- 用户意图理解。
- workflow / long-running task rhythm。
- 结构化对象上下文和可复用 observation / descriptor。
- Model Router 调用。
- Browser / Computer Use / artifact / verifier 等 tools / actions 选择。
- approval、risk policy、repair 和 blocker 判断。
- completion truth 和用户级 final answer。
- 是否继续工作、是否结束 turn。

## Model Router 边界

Model Router 负责：

- 暴露 `/v1/responses` 兼容 API。
- 选择注册 profile / role / provider。
- 把 text、image、`input_object` 等输入翻译成上游 provider 协议。
- 把 provider tool-call / text output 翻译回 `/v1/responses` 输出。
- 写 refs-first trace、latency 和 provider-safe diagnostics。
- 做短期模态翻译缓存，例如按 `profile + content hash` 复用同一图片的 vision observation，避免重复 vision translator 成本。

Model Router 不负责：

- 用户任务规划。
- 工具选择或跨工具 workflow。
- final-answer / UI projection 决策。
- Browser / Desktop / artifact 动作。
- 对象记忆或长期 descriptor ownership。
- repair、approval、risk policy。
- completion truth 或用户级 final answer。

短期模态翻译缓存只是性能优化，不是对象记忆。缓存命中只能把已有视觉 observation 提供给当前模型调用；是否足够、是否需要更细粒度追问、是否继续任务，仍由 Agent Host 决定。

## GUI projection 与 legacy shim

唯一产品展示链路是 Codex App Server protocol events -> assistant final message -> `FinalAnswerEnvelope` -> SciForge UI projection。

SciForge UI 可以确定性展示 Codex App Server 事件中的用户可见状态，例如：

- `progress`：阶段进展。
- `partial_result`：阶段性结果。
- `final_answer`：Agent Host 认为当前用户请求已经完成。
- `blocker`：无法继续，需要说明原因。
- `needs_human`：需要用户输入或人工接管。

一次本地 presentation ack 不表示 turn 必须结束。长程任务中，UI 可以持续展示 progress / partial result / approval / blocked recovery；最终是否结束 turn 由 Codex App Server turn lifecycle 和 Agent Host completion truth 决定。

最终用户可见答案来自 Codex App Server assistant final message，并由 SciForge 归一成 `FinalAnswerEnvelope`。`title` 或其它展示元数据不能替代正文。UI 不补写、不改写、不生成最终答案。

产品路径不得向 Codex app-server 注册或注入 `gui.present`、`gui.ask_user`、`gui_present`、`gui_ask_user` 或 `moduleId=gui` completion surface；旧动态工具请求必须作为 unsupported dynamic tool fail closed，不能降级成展示或 completion truth。

## 多模态对象策略

附件和引用对象必须以结构化 `input_object` / runtime input object 进入 Agent Host，不通过 prompt 拼接或附件顺序猜测。

Agent Host 应维护同一 turn / thread 内的对象上下文：

- 已有视觉 observation / descriptor 足够时，后续追问直接复用。
- 不足时，Agent Host 再调用 Model Router，让 Router 做模态翻译。
- 同一图片重复进入 Router 时，Router 可用短期 translation cache 避免重复 vision translator。
- repair 或再次呈现不应默认重新看图，应优先复用已有 observation。

upload 后异步 materializer 可以作为未来优化，但不是当前必需路径。

## 模块与工具边界

Browser、Computer Use、Desktop、artifact、verifier 等都只是 Host tools / actions 或能力模块。它们返回：

- operation result。
- refs-first evidence。
- source / page text refs。
- before / after action evidence。
- artifact refs。
- validator refs。
- approval request。
- blocked reason 和 repair hint。

模块和工具不得返回用户级 final answer，也不得声明用户级 completion truth。

## 用户级验收

用户级验收只能由 Agent Host 基于 current run evidence 产出，并通过 Codex App Server assistant final message / events 进入 `FinalAnswerEnvelope`。

典型证据要求：

- Browser 任务：需要 source page refs / page text refs，搜索结果页本身不能作为完成证据。
- GUI action：需要 before evidence / grounding refs / executor event / after evidence / stale invalidation。
- Artifact 任务：需要 final artifact refs / validator refs。
- 高风险动作：需要 approval refs。
- 多模态任务：需要当前对象的 observation / descriptor，或明确说明无法检查。

tool 文本、GUI 投影、旧截图、历史 run、fixture、package probe 或模型自信不能替代用户级完成。

## 打勾规则

- `[x]` 只能表示普通聊天入口的当前产品链路已经达到用户级验收。
- Contract test、module operation test、fixture、package probe、legacy diagnostic、GUI projection、手动脚本或局部 smoke 通过，不能单独打 `[x]`。
- blocked 也可以通过用户级验收，但必须说明缺失条件、保留 evidence refs，并给出可恢复路径。
- 如果 final answer 不能让用户确认任务结果，或者缺 source / action / artifact / validator / observation refs，不得打 `[x]`。

## Runtime / Router 配置边界

Runtime Codex 必须使用 Model Router 作为模型入口。服务环境必须提供 `SCIFORGE_RUNTIME_API_KEY`，并通过 `SCIFORGE_MODEL_ROUTER_BASE_URL` / `SCIFORGE_MODEL_ROUTER_URL` / `SCIFORGE_MODEL_ROUTER_PORT` 指向 Router `/v1` endpoint；Runtime model 必须是 public alias，例如 `sciforge-router`。

`config.local.json` 只能作为 Model Router 成员模型配置来源，不能作为 Runtime Codex 直连 provider 配置。缺 Runtime API key、Model Router `/v1` base URL、runtime profile、router route 或必要 evidence 时必须 fail closed / blocked，不能把旧 fallback、历史 run 或诊断结果当作产品完成。

## 非目标

- 不实现 SciForge 侧第二个 Agent Host。
- 不实现 SciForge 侧 task router、planner、workflow engine 或 completion engine。
- 不让 Model Router 拥有对象记忆、workflow、repair 或 final answer。
- 不把 Browser Search、Computer Use、runtime gateway、slash command 或 GUI 控件做成产品任务入口。
- 不让 GUI projection 隐式结束 turn。
- 不用诊断路径替代普通聊天用户级验收。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：总架构边界。
- [`docs/ModelRouterArchitecture.md`](docs/ModelRouterArchitecture.md)：Model Router 多模态 API 边界。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser 工具边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use 工具边界。
- [`docs/runbooks/model-router-runtime-codex-runbook.md`](docs/runbooks/model-router-runtime-codex-runbook.md)：Runtime Codex 使用 Model Router 的运行手册。
