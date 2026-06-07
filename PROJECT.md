# SciForge 当前需求：模块化能力与用户级验收

最后更新：2026-06-07

## 用户真正要什么

用户在普通聊天里提出任务，例如：

- “搜索并总结本周前沿 AI 大模型进展。”
- “帮我在当前页面填写这些字段，但不要提交。”
- “帮我做一页 PPT，并给我可验证文件。”

用户不是在请求一个 Browser agent 或 Computer Use agent。用户要的是一个可验收结果：有来源、有动作证据、有产物验证，或者明确说明为什么 blocked。

## 总体决策

SciForge 是 Codex backend 的 GUI / Browser / Desktop 能力面，不是第二个 Agent Host。

```text
用户普通聊天 turn
  -> Codex backend Agent Host
     -> 理解用户任务
     -> 拆出局部目标、风险边界和证据要求
     -> 调用 SciForge 模块 primitive
     -> 基于 evidence 形成 completion truth
     -> 生成用户可见 final answer
  -> SciForge UI 展示回答、证据、产物、确认和 blocked recovery
```

Browser、Computer Use 和未来拓展模块只提供两类能力：

- 信息输入：read / observe / search / capture / source evidence。
- 局部操作执行：模块自有 primitive，以及不承载智能的局部组合 primitive。

模块不得拥有用户级 task plan、repair、completion truth 或 final answer。

## 当前只做什么

先把基本模块做扎实，不扩展复杂矩阵。

P0 只包含：

1. Browser source evidence：搜索、打开、读取来源，并返回 refs-first source/page evidence。
2. Computer Use primitive：`computer_use.bind`、`computer_use.observe`、`computer_use.act`、`computer_use.run_procedure`、`computer_use.control`。
3. Codex backend 将 source / action / artifact evidence 转成 completion truth 和 final answer。

P1 只包含：

1. 一页 PPT / artifact 用户级验收路径。

## Primitive 契约

模块 primitive 是 Host 调用的 typed intent，不是新顶层 API，也不是工作流引擎。

每次调用必须满足：

- 一个 owner module。
- 一个 target scope。
- 一个局部目标。
- 有 `sessionRef`、`budget`、`riskPolicy`、`requiredEvidence` 和 `stopConditions`。
- 不嵌套调用其它模块。
- 配置不得表达跨模块 `if/else/loop` 工作流。
- 模块只能返回 refs-first result、blocked reason 和 repair hint，不能自动 repair。

统一返回状态：

```text
completed
partial
blocked
needs-confirmation
failed
```

Model Router 可以在 primitive 内部做局部辅助，但只能用于：

- 截图 / crop / 页面片段描述。
- 候选目标消歧。
- 候选 next intent。
- before / after 比较。
- 不确定性解释。

Model Router 不得改变 risk policy，不得决定跨模块下一步，不得绕过确认，不得自动 repair，不得产出 completion truth 或 final answer。

## Browser 基本模块

Browser 返回 source page refs 和 page text refs。Browser 不做：

- 开放式探索。
- 查询改写。
- 来源取舍。
- 最终总结。
- 跨模块 repair。

Browser 用户级验收：

- 普通聊天请求“搜索并总结本周前沿 AI 大模型进展”能由 Codex backend 调用 Browser source evidence 能力。
- Browser 返回实际打开并读取过的 source page refs / page text refs。
- 搜索结果页本身不能作为完成证据。
- Codex backend 基于 source evidence 生成 final answer，并在回答中给出来源。
- 来源不足、页面打不开、证据冲突或结果明显不相关时，final answer 必须是 partial / blocked，不能编造完成。
- 用户禁止联网或要求只用本地上下文时，不调用 Browser，并说明依据。

## Computer Use 基本模块

Computer Use 当前只保留五个 primitive：

- `computer_use.bind`：绑定 Host 指定目标，建立 scoped session。
- `computer_use.observe`：读取已绑定 target 的当前状态。
- `computer_use.act`：在已绑定 target 上执行一个 Host 指定的原子动作。
- `computer_use.run_procedure`：执行 Host 指定的无智能局部步骤序列，用来降低 Agent Host 往返成本。
- `computer_use.control`：暂停、停止或释放 session。

Computer Use 不做：

- 用户任务理解。
- PPT 内容设计。
- 跨 app workflow planning。
- 提交 / 发送 / 上传 / 删除 / 支付。
- 用户级完成判断。

Computer Use 用户级验收：

- 普通聊天请求低风险 GUI 局部操作时，Codex backend 能调用 Computer Use primitive，不要求 `/computer-use`。
- 每个改变界面的 action 都有 current target-bound before evidence、grounding refs、executor event、after evidence 和 stale invalidation。
- 每个独立 Computer Use 会话有独立输入 adapter 和独立光标标志，不影响用户正常使用鼠标键盘。
- final answer 由 Codex backend 基于 action evidence 生成，说明局部目标是否完成。
- 高风险动作必须返回 `needs-confirmation`，由 GUI 收集确认；未确认不得执行。
- 缺 native host、target binding、fresh evidence、permission refs、scoped executor 或 stop / cancel path 时，必须 blocked，并说明恢复路径。

## Artifact / PPT 用户级验收

PPT 场景用于证明“用户级完成”不能由 Computer Use 自己宣布。

- 普通聊天请求“做一页 PPT”时，Codex backend 判断走 artifact generator 还是 Computer Use 局部动作。
- 如果走 artifact path，completion truth 必须包含 final artifact refs 和 validator refs。
- 如果走 Computer Use path，Computer Use 只提供局部 GUI action evidence；最终 PPT 完成仍必须由 artifact refs + validator refs 支撑。
- final answer 必须给出可检查的 PPT artifact ref、验证结果和未完成事项。

## 打勾规则

- `[x]` 只能表示普通聊天入口的当前产品链路已经达到用户级验收。
- Contract test、module operation test、fixture、package probe、legacy diagnostic、GUI projection、手动脚本或局部 smoke 通过，不能单独打 `[x]`。
- blocked 也可以通过用户级验收，但必须说明缺失条件、保留 evidence refs，并给出可恢复路径。
- 如果 final answer 不能让用户确认任务结果，或者缺 source / action / artifact / validator refs，不得打 `[x]`。

## Runtime Codex 配置边界

Runtime Codex / provider proxy 的 browser/release 验收必须从 service 环境读取 `SCIFORGE_RUNTIME_API_KEY`。本地 `config.toml`、`config.local.json` 或 `.sciforge/**/config.local.json` 里的 secret-like key 只能作为 provider proxy 调试 fallback，不能满足 Browser / release acceptance。

provider proxy 还必须能解析 OpenAI-compatible upstream base URL，例如通过 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` 或非 secret 的本地 upstream 配置。缺 Runtime API key、upstream base URL、runtime profile、provider route 或 browser source/page evidence 时必须 fail closed / blocked，不能把旧 BrowserHostSearch、配置 fallback、历史 run 或诊断结果当作产品完成。

## 非目标

- 不实现 SciForge 侧 task router、planner、workflow engine 或 completion engine。
- 不把 Browser Search、Computer Use、runtime gateway、slash command 或 GUI 控件做成产品任务入口。
- 不设计完整多模块 workflow DSL。
- 不扩展 release matrix。
- 不用诊断路径替代普通聊天用户级验收。

## 文档地图

- [`docs/Architecture.md`](docs/Architecture.md)：总架构边界。
- [`docs/BrowserRuntimeArchitecture.md`](docs/BrowserRuntimeArchitecture.md)：Browser 模块边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use 模块边界。
- [`PROJECT_CU.md`](PROJECT_CU.md)：Computer Use 分阶段任务清单。
