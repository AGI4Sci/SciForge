# Browser Runtime 设计

最后更新：2026-06-07

## 文档目的与约束

这份文档只记录 Browser Runtime 本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解 Browser 是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成 TypeScript contract、JSON schema 或测试用例。
- 文档只描述 Browser 自身的稳定边界、primitive、证据原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、界面呈现、模型路由或产品工作流设计。
- 精确字段、schema、MCP tool definition、validator 和测试真相源放在 `packages/actions/browser-runtime`。
- 历史路径只保留必要迁移口径，不作为新设计的主叙事。
- 如果实现细节变复杂，优先更新 package contract 和测试；本文件只补能帮助沟通和理解需求的原则。

## 定位

Browser 是可调用的网页信息输入与局部浏览器操作 runtime，不是 Browser agent，也不是搜索总结工具。

Browser 只负责：

- 执行调用方明确请求的浏览器 primitive。
- 维护 BrowserHostSession / tab scope、页面状态、导航状态和可审计 artifact。
- 返回结构化 observation、diagnostics 和 refs-first evidence。
- 对危险、越界、预算不足或证据不足的请求 fail closed。

Browser 不负责：

- 查询改写。
- 来源取舍。
- 事实综合。
- 最终总结。
- 跨模块 repair。
- 用户级 completion truth。
- 判断用户意图是否完成。
- 根据特定站点、语言或领域写场景策略。

## 外部边界

Browser 不直接面向用户表达的完整任务。调用方必须先给出明确 query、URL、session、ref、budget、risk policy 或下载约束。

Browser 返回网页状态、页面内容 refs、下载 artifact refs、diagnostics、blocked reason 和 repair hints；调用方负责继续推理、修复、验证和生成最终答复。

Browser pane 只能作为 BrowserHostSession 的展示和控制面板，不能成为 Browser 的任务语义入口。

## Primitive Surface

Browser 新 public surface 只暴露这些 primitive：

| primitive | 作用 | 边界 |
| --- | --- | --- |
| `browser.search` | 用调用方给定 query 做候选发现，并为每个可用候选返回可直接传给 `browser.read` 的 `readInput`。 | 不读取结果页正文、不总结答案、不改写 query。 |
| `browser.navigate` | 将调用方给定 URL 绑定到一个 BrowserHostSession，并执行一次导航。 | 不读取长正文、不判断来源是否满足任务、不代表用户级完成。 |
| `browser.observe` | 观察现有 session 当前状态。 | 不导航、不读取长正文、不完成任务级判断。 |
| `browser.read` | 读取当前页面或给定 URL 的网页内容并物化 refs。 | 不下载文件、不抽象成最终结论、不跨页面继续搜索。 |
| `browser.extract` | 对已读 refs 做纯结构解析。 | 不访问网络、不决定下一步、不做任务级语义验收。 |
| `browser.download` | 把调用方指定的远程资源下载为受控 artifact。 | 不保存到任意本地路径、不自动执行/打开文件、不总结文件内容。 |

所有 primitive 都必须使用 refs-first envelope。未知字段默认拒绝或进入 diagnostics，不能静默改变语义。

面向模型或 MCP provider 的直接工具名使用安全 alias：`browser_search`、`browser_navigate`、`browser_observe`、`browser_read`、`browser_extract`、`browser_download`。这些 alias 只是调用入口名，内部必须注入对应 input schemaVersion，并路由回同一个 Browser module dispatcher intent（例如 `browser_search` -> `moduleId=browser, intent=browser.search`）。它们不能形成第二条搜索、读取或总结链路。

旧的 `browser.search_read`、`browser.open_read`、`browser.open` 和 `executeBoundedOperation` 浏览器组合入口已经退出 public surface。新实现必须拒绝这些 intent，不能把它们作为兼容 alias、内部兜底或产品 truth。

## Session 与 Artifact 原则

- 每个 primitive 只绑定一个 BrowserHostSession / tab scope，除非输入明确要求新建 session。
- `search` 只产出候选结果、search refs、`readInput` 和 repair hints；搜索结果页不是用户级完成证据。调用方要回答网页内容、新闻、论文、来源或引用问题时，必须继续调用 `read` 或说明候选不可用。
- `navigate` 只证明导航尝试和当前 session 状态。
- `read` 只证明页面内容已被物化为 source page / page text refs。
- `extract` 只解析已有 refs，不访问网络。
- `download` 只能写入受控 session artifact scope，并返回 hash、大小、MIME 和 artifact refs。
- 下载后的内容理解属于后续 reader / parser / verifier，不属于 Browser。

## 风险与确认

Browser 可以识别浏览器动作风险并返回 `needs-confirmation`，但不能自己决定高风险动作是否应该执行。

必须返回 `needs-confirmation` 的典型情况：

- 跨站点表单提交。
- credential-like 输入。
- 上传、删除、支付、账号或安全设置变更。
- 下载超过调用方声明的预算或类型约束。
- 调用方没有提供有效 approval ref。

确认由调用方收集。Browser 只验证 approval ref 是否匹配当前 action risk envelope。

## Evidence 原则

Browser evidence 必须 refs-first。可作为局部证据的对象包括：

- search result refs。
- session / navigation refs。
- frame / screenshot / DOM / AX refs。
- source page / page text / HTML refs。
- download artifact refs。
- console / network diagnostics refs。

`search` 返回的 URL 只能作为候选和下一步输入，不能作为已读取来源。`search` 成功时应提供结构化 `repairHints[].machineReadable.candidateReadInputs`，让调用方不需要从说明文字中猜测如何进入 `read`。如果一个 Host turn 连续执行 search 而没有 read / navigate / extract 进展，Host adapter 可以触发通用预算保护并返回 `browser_search_only_budget_exhausted`，要求调用方读取已有候选或报告 blocker。

raw HTML 大 payload、cookies、credentials、downloaded bytes、raw screenshot、data URL、base64、API key 和 secret 不得进入 primitive body 或 public diagnostics。

## 局部感知原则

Browser primitive 默认不做任务级语义判断。

如果某个 adapter 需要模型或其它感知组件做局部辅助，它只能输出 refs-first observation，例如页面片段摘要、候选结果质量解释、视觉 / 文本消歧或 before / after 差异说明。

这类局部感知组件不能在 Browser 内部：

- 改写 query。
- 决定下一页要打开什么。
- 判断何时停止。
- 改变 risk policy。
- 自动 repair。
- 产出 completion truth。
- 生成 final answer。

调用方可以读取 Browser refs 后自行调用模型或 verifier；这不属于 Browser primitive 内部职责。

## 迁移口径

历史路径包括 `executeBoundedOperation` 浏览器组合入口、`browser.search_read`、`browser.open_read`、`browser.open`、Browser pane dogfood、iframe / proxy render、snapshot replay 和历史 browser pane runbook。

迁移目标：

- 搜索和读取拆为 `search` / `navigate` / `read` / `extract`。
- 下载进入 `download`，不能混在 `read` 或页面解析里。
- Browser pane 只展示和控制 session，不承载任务智能。
- 旧组合路径必须删除或显式拒绝，不能转译为 primitive chain，也不能作为产品 truth。
- 查询策略、来源取舍、停止条件、验证和最终总结都移到调用方。

迁移期如果遇到旧调用，唯一允许行为是 fail closed，并返回 unsupported intent / repair hint；不允许静默兼容。

## 用户级验收

Browser 只能提供网页局部证据，不能单独提供用户级验收。

可作为 Browser 局部证据的对象：

- current-run search / navigation / read / extract / download refs。
- source page refs 和 page text refs。
- download artifact refs。
- diagnostics 和 blocked reason refs。
- 必要时由调用方关联的 verifier refs。

禁止把这些对象当作产品 truth：

- iframe。
- proxy render。
- screenshot / snapshot replay。
- frame stream。
- 系统外部浏览器。
- 历史 run。
- 只读搜索结果页。
- Browser primitive 的 `status=completed`，除非调用方另有 current-run completion truth 和必要 source / verifier refs。

## 契约真相源

长期 contract、MCP-compatible tool schema、validator 和测试应放在：

- `packages/actions/browser-runtime/index.ts`
- `packages/actions/browser-runtime/mcp.ts`
- `packages/actions/browser-runtime/action-provider.manifest.json`
- `packages/actions/browser-runtime/*.test.ts`

本文件只保留设计原则和迁移口径。

## 相关文档

- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：Computer Use primitive runtime 的同构设计。
- [`Architecture.md`](Architecture.md)：总架构和 Browser 上下游边界。
