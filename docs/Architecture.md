# SciForge 架构

最后更新：2026-06-07

## 唯一产品链路

SciForge 是 Codex backend 的 GUI / Browser / Desktop 能力面，不是 Agent Host，也不是第二条智能链路。

系统层级必须保持为：

```text
SciForge UI
  -> CodexAppServerAdapter
  -> Codex / Agent Host  唯一智能载体
      -> 调用 MCP tools / actions
      -> 需要模型时统一走 Model Router /v1/responses
      -> 基于证据和 verifier 决策
      -> gui.present 最终回答
```

`CodexAppServerAdapter` 是 SciForge 与 Codex / Agent Host 的唯一桥接层。`Model Router /v1/responses` 是 Codex 使用的多模态模型 API 服务层，不是与 `CodexAppServerAdapter` 并列的任务上游，也不是可以直接生成用户可见回答的第二个 Agent Host。

## 所有权

Codex / Agent Host 拥有：

- 用户意图理解。
- task plan。
- MCP tools / actions 调用。
- tool / module 选择。
- approval / risk policy。
- repair。
- verifier 选择和 completion truth。
- `gui.present` 最终回答。

SciForge 拥有：

- GUI 输入与展示。
- Browser / Computer Use / Desktop 能力面。
- refs-first evidence、artifact refs、action refs。
- hard-confirm / stop / cancel / blocked recovery 的 UI 投影。
- 把用户输入、附件对象和上下文交给 `CodexAppServerAdapter`。

Model Router 拥有：

- `/v1/responses` 兼容的多模态模型服务。
- text reasoner、vision translator 或其它注册 provider 的受控调用。
- `input_object` 的模态识别、读取、翻译和内部 descriptor 缓存。
- refs-first trace 和 provider-safe diagnostics。

## 禁止链路

以下链路都不允许作为产品路径保留：

- `SciForge UI -> Model Router -> 用户可见 final answer`。
- `Runtime Codex -> Model Router -> message/done 直答`。
- `Agent Host 外部的视觉/音频/文档 translator 旁路`。
- `Browser / Computer Use / GUI 控件 -> 自行总结并回答用户`。
- `slash command / runtime gateway / module fallback -> 绕过 Codex / Agent Host 完成任务`。

多模态对象必须作为结构化 `input_object` 进入 Codex turn。Codex / Agent Host 需要模型能力时，再通过统一 Model Router 服务读取或补充模态证据。外部层不得通过专门 prompt、专门视觉链路或附件顺序猜测来完成模态翻译。

## 模块边界

Browser、Computer Use、Desktop 和其它模块只能作为 Codex / Agent Host 可调用的 tools / actions。模块返回：

- operation result。
- evidence refs。
- action refs。
- artifact refs。
- approval request。
- blocked reason。
- compact observation。

模块不得返回用户级 final answer，也不得声明用户级 completion truth。

## 用户级验收

用户级验收只能由 Codex / Agent Host 产出，并通过 `gui.present` 投影给 SciForge UI。

完成必须有同一 current run 的 evidence 支撑：

- Browser 任务需要 source page refs / page text refs。
- GUI action 需要 before evidence / grounding refs / executor event / after evidence / stale invalidation。
- Artifact 任务需要 final artifact refs / validator refs。
- 高风险动作需要 approval refs。

tool 文本、GUI projection、旧截图、历史 run、fixture、package probe 或模型自信不能替代用户级完成。

## 风险授权

approval / risk policy 由 Codex / Agent Host 拥有。SciForge、Browser、Computer Use 和 Desktop 只投影 Host 的权限状态、confirmation UI、blocked reason 和 evidence，不自行决定用户级风险是否可执行。

在 Host 声明 full-access co-work permission envelope 的当前 session 内，保存用户真实文件、批量替换或跨文件修改不因“真实文件 / 保存 / 批量 / 跨文件”类别本身要求 confirmation。它们仍必须绑定 current-run session refs、target refs、Host decision/action evidence 和 permission refs；批量或跨文件修改必须由 Host 基于每次 observe refs 拆成多次单步 primitive，不能交给 Computer Use core 做 task planning。

必须 hard-confirm 的边界是 submit / send / publish / upload / delete / pay / authorize、改变外部账号/安全/法律/财务状态、不可逆外部副作用，或超出当前 session scope 的跨 app / 跨窗口 / 跨账号副作用。窗口、文件或目标不明确时，Host 应先用可用视觉 / AX / text / title / visible file / editor refs 尝试确认唯一目标；证据不足或冲突时返回 `needs-confirmation` / `blocked`。

## 相关文档

- [`ModelRouterArchitecture.md`](ModelRouterArchitecture.md)：Model Router 服务层边界。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser 能力面。
- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：Computer Use 能力面。
