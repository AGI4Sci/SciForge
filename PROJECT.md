# SciForge 项目任务板

最后更新：2026-05-21

当前目标：把 SciForge 的聊天体验蒸馏成 Codex / subagent 式体验。重点不是让 SciForge 和某个 prompt 输出一模一样，而是学习 Codex 如何按任务进度动态决定展示什么、折叠什么、把什么放到主回答、把什么放到过程或审计里，以及整体布局如何降低用户认知负担。

旧任务和历史清单已从本入口移除。后续只围绕“Codex 用户体验蒸馏”推进。

## 核心原则

- 参考对象是 Codex 桌面端和 subagent 对话，而不是旧 SciForge 页面。
- 每轮工作都要开启 subagent，并让 subagent 承担并行观察、对照、审查或局部实现任务；主会话负责整合和最终写入。
- 不要求 subagent 和 SciForge 输入相同信息；验收目标是信息呈现体验一致。
- 提问要足够复杂，覆盖规划、工具调用、中间状态、失败或部分完成、最终回答，才能观察完整折叠行为。
- 用户首先看到答案和关键进度；raw JSON、SSE、stdout、stderr、provider/model/profile、run id、command id、内部审计默认折叠或隐藏。
- 折叠策略必须随任务进度变化：等待、执行、产出、失败、恢复、完成时展示不同层级的信息。
- 用户级浏览器验收只使用 Codex in-app browser，从默认聊天入口开始；不要用 Computer Use 替代用户体验验收。
- 代码实现后必须用 targeted tests、`npm run typecheck`、`git diff --check` 和 in-app browser 证据关闭任务。
- Runtime Codex 配置文档必须同时说明 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy 的 upstream base URL 要求，避免把运行失败误判成 UI 展示问题。

## 工作协议

1. 先启动至少两个 subagent：
   - 一个观察 Codex / subagent 对话格式，输出“展示、折叠、布局”基线。
   - 一个观察 SciForge 当前页面和 DOM，列出不一致处和泄露的内部信息。
2. 任务较大时继续分波次启动 subagent：
   - explorer：只读对照、定位代码、审查风险。
   - worker：只改明确分配的文件集合，避免互相覆盖。
   - reviewer：在主会话集成后检查遗漏、回归和体验偏差。
3. 主会话保持整合权：
   - 先读 subagent 输出，再决定实际代码路径。
   - 不直接复制 subagent 文案；把它们蒸馏成 SciForge 的交互规则。
   - 不回滚用户已有改动；遇到冲突先说明并绕开。
4. 每完成一阶段就清理无用 subagent，必要时重启新的 subagent 做下一阶段验证。

## Task 1：采集 Codex / Subagent 体验基线

- [x] 记录 subagent 在复杂任务中的对话结构：主回答、进度、工具结果、错误、审计信息分别如何出现。
- [x] 记录 Codex 如何随进度动态折叠信息：任务开始、运行中、工具调用后、失败时、完成时各展示什么。
- [x] 记录布局规律：消息宽度、元信息位置、按钮密度、过程折叠区、引用和结果入口。
- [x] 输出一份可执行基线：哪些内容必须主显，哪些默认折叠，哪些只进 debug/audit。

## Task 2：盘点 SciForge 当前差距

- [x] 从默认聊天入口检查 SciForge 可见文本、DOM 属性、右侧面板、composer、侧边栏和过程折叠区。
- [x] 标记所有不应主显的信息：raw JSON、event type、run id、provider/model/profile、workspace command、verification 内部状态、debug refs。
- [x] 标记所有布局不一致：过重的 badge、过多的 metadata、结果面板抢占主回答、空状态像调试面板。
- [x] 形成修复清单，并按“用户主路径优先”排序。

## Task 3：重做聊天信息层级

- [x] 用户消息只展示用户输入和用户明确选择的上下文，不展示后来 runtime 附加的内部 refs。
- [x] assistant 消息优先展示最终回答；过程、验证、恢复建议和执行摘要放到折叠区。
- [x] 运行中消息只展示关键状态和当前动作，不滚动刷屏低价值事件。
- [x] 失败消息给出短原因、可执行下一步和折叠诊断，不把堆栈或原始 payload 放进主回答。
- [x] 多轮追问要清楚表达“正在延续哪个对象或回答”，避免像新任务。

## Task 4：实现动态折叠策略

- [x] 建立统一规则：什么事件在 waiting/running/partial/failed/completed 状态下主显、折叠或隐藏。
- [x] 把 raw logs、SSE、JSONL、stdout/stderr、provider payload、重复 token/usage 更新收进 audit。
- [x] 保留可展开的过程证据，但折叠标题必须是用户语义，例如“过程”“验证”“恢复线索”，不是内部类型名。
- [x] 对复杂任务验证：同一条任务从执行到完成期间，信息层级能随状态自然变化。

## Task 5：对齐布局和控件体验

- [x] composer 对齐 Codex：输入框、发送/中断、附件/选择对象、模型/权限/工作区提示保持低噪声。
- [x] 侧边栏对齐 Codex：新聊天、搜索、线程、项目、插件、自动化、设置的权重清晰。
- [x] 右侧面板只在有结果或对象预览时承担主视图角色；空状态要短，不像系统日志。
- [x] 引用 chip、artifact、file、run、report 的点击和预览行为稳定，且不暴露内部 ref 噪声。

## Task 6：验收和回归

- [ ] 使用 Codex in-app browser 从 `http://localhost:5173/` 默认聊天入口执行复杂多轮任务。
- [ ] 验收必须覆盖：第一轮回答、运行中折叠、失败或部分完成状态、artifact/引用点击、第二轮追问、最终回答。
- [x] DOM 检查 forbidden terms：`native-message`、`live-runtime-codex`、`raw JSONL`、`stdout`、`stderr`、`provider`、`run id`、`ConversationProjection`、`ArtifactDelivery` 等不应出现在主体验中。
- [x] 跑对应 targeted tests、`npm run typecheck -- --pretty false`、`git diff --check`。
- [x] 大范围 runtime/GUI 改动再跑 `npm run verify:single-agent-final`。

## 当前 TODO

- [x] 为下一轮实现启动第一波 subagent：Codex/subagent 基线观察、SciForge DOM 差距扫描、折叠策略代码定位。
- [x] 设计一条足够复杂的验收 prompt，能触发规划、工具进度、引用、失败恢复或部分结果、最终总结。
- [x] 把观察结果转成 `ChatPanel`、`RunningWorkProcess`、`ResultsRenderer`、`ChatComposer` 的具体修改任务。
- [x] 增加 forbidden-term 回归测试，防止内部运行时词重新进入主聊天或 DOM。
- [x] 用 in-app browser 截图和 DOM 摘要记录每轮前后差异。
- [x] 修复运行中 `运行细节`：按 Codex 风格自上而下展示当前执行轨迹，阶段完成后折叠成摘要，完整过程仍可展开。
- [x] 修复 Runtime Codex stream 首包与静默等待：SSE 接收后立即推送语义进展，Codex CLI 暂时无 JSONL 时用 heartbeat 保持前端实时状态。
- [x] 将本轮 subagent 观察和修改经验记录到 `docs/CodexSubagentMessagePresentation.md`。
- [x] 修复 assistant 正文中的裸文件名引用：唯一命中当前 session/run artifact 时可点击，并在右侧通过 presentation 组件预览。
- [x] 将引用升级改成通用 `ObjectReference` 候选索引：session artifact 与已验证 workspace 文件都可命中，支持 markdown/table/pdf/image/html/json 等多模态预览，缺失或歧义时保持纯文本。
- [x] 修复 assistant meta 行置信度：只渲染 runtime/TUI/verifier 显式给出的 `message.confidence`，不由 GUI 推断默认值。
- [x] 修复主对话栏宽度：quiet shell 下用户和 SciForge 消息体铺满主聊天列，减少左右空白。

## 完成定义

- 用户在 SciForge 里阅读多轮对话时，感到信息层级、节奏和折叠方式接近 Codex / subagent。
- 主回答区域没有调试噪声；过程信息可追溯但默认不打扰。
- 复杂任务、多轮追问、对象引用和失败恢复都能保持同一套呈现规则。
- 所有改动都有测试或 in-app browser 证据支撑。

## Runtime 验收矩阵引用

- [x] R-PROTO-04 GUI presentation catalog discovery：第一轮生成多类型 artifacts；第二轮要求 agent 通过 `gui.list/read/search` 说明 GUI 当前能用哪些 renderer 预览这些 artifacts；第三轮让 TUI 调 `gui.present` 聚焦其中一个 artifact。必须证明 discovery 来自 `/gui/capabilities/presentation.json` 或 `/gui/renderers/<componentId>.json`，不是 React import、AgentServer gateway 或 GUI task ranking。
  - 证据：docs/test-artifacts/real-tasks/R-PROTO-04/manifest.json status passed；smoke:real-task-matrix 已验证。

- [x] R-PROTO-05 Inline artifact reference right-panel preview：第一轮生成至少两个 markdown/table artifacts，其中一个在 assistant 文本里以裸文件名 inline code 出现；第二轮点击该裸文件名并验证右侧面板预览；第三轮切换到不可解析 inline code 和重复 basename 场景。必须证明只有可解析真实对象会升级为引用，且预览不改变 task truth。
  - 证据：docs/test-artifacts/real-tasks/R-PROTO-05/manifest.json status passed；smoke:real-task-matrix 已验证。

- [x] R-VERIFY-02 Confidence source and explanation：第一轮生成无 verifier confidence 的普通回答，必须不显示默认百分比；第二轮生成 tool-backed 或 verifier-backed result，要求输出 `confidenceExplanation`；第三轮制造 partial/blocked 或 contradictory evidence，验证 confidence 降低并列出 penalties。必须证明 GUI 不计算 confidence，所有分数来自 TUI/verifier/harness payload。
  - 证据：docs/test-artifacts/real-tasks/R-VERIFY-02/manifest.json status passed；smoke:real-task-matrix 已验证。

## 未勾项说明

- Task 6 中两项 live Runtime Codex browser E2E 仍保持未勾：当前 `docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json` 为 blocked，原因是服务环境缺少 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy upstream base URL。配置补齐后重跑 `npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict`。
