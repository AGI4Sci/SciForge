# GUI Protocol 设计

最后更新：2026-06-07

## 文档目的与约束

这份文档只记录 SciForge GUI protocol 本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解 GUI 是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成完整 IPC schema、MCP tool schema 或 UI 测试用例。
- 文档只描述 GUI 自身的稳定边界、输入/展示原则、确认原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、模型路由或模块内部设计。
- 精确字段、GUI MCP tools、resource tree、runtime event normalizer 和测试真相源放在 `src/runtime/codex/gui-*`、`src/ui` 和对应 tests。
- 如果实现细节变复杂，优先更新 contract 和测试；本文件只补能帮助沟通和理解需求的原则。

## 定位

SciForge GUI 是输入、展示、确认和状态感知 surface，不是任务编排器，不是 hidden task router，也不是业务动作执行器。

GUI 只负责：

- 收集用户自然语言、选区、annotation、browser、window、artifact 等 refs。
- 展示 final answer、evidence refs、artifact refs、approval request、status 和 blocked recovery。
- 提供 hard-confirm、cancel、stop、takeover 等用户控制面。
- 暴露 read-only GUI resource tree 和 presentation intent。
- 管理确定性的本地 presentation state。

GUI 不负责：

- task planning。
- tool / module selection。
- risk policy。
- repair。
- completion truth。
- final answer。
- 根据用户文本直接调用 Browser / Computer Use / connector / artifact 业务动作。
- 从按钮文案、截图、历史 run 或 GUI projection 推断任务完成。

## 输入与展示边界

GUI 对外只输出用户意图和 refs，不输出隐藏任务计划。

GUI 可提交：

- 用户自然语言。
- refs 和 context bundle。
- autonomy profile / mode selection。
- confirmation / cancel / stop / takeover result。
- debug / expert 模式下的 terminal-equivalent text。

GUI 可接收并展示：

- final answer。
- evidence / artifact refs。
- approval request。
- status / blocked recovery。
- presentation intent。
- runtime event projection。

GUI 不能把 presentation intent 当成业务命令，也不能把本地 UI state 当成产品 truth。

## Resource Tree 原则

GUI resource tree 是只读语义资源树，用来让调用方感知当前界面状态。

它可以描述：

- focused panel。
- hot region。
- visible artifacts。
- selected refs。
- presentation capabilities。
- pending approval / blocked state。

它不能暴露：

- raw DOM 大 payload。
- secret / token / API key。
- 私有 provider config。
- 可绕过确认的执行入口。
- workspace writer 或外部 SDK 直接句柄。

## Confirmation 原则

GUI 可以收集用户确认，但不能自己决定高风险动作是否应该执行。

高风险确认必须满足：

- 明确展示动作、目标、风险和 refs。
- 用户确认 / 取消结果必须可审计。
- 确认结果只作为 approval evidence 回传。
- GUI 不得扩大权限、改写 action 或替调用方继续执行。

## Presentation Autonomy 原则

GUI 可以做确定性的 presentation autonomy，例如：

- 根据 artifact type 选择 renderer。
- 展开 / 折叠本地面板。
- 高亮当前 refs。
- 显示 blocked reason 和 repair readiness。
- 在本地保存非业务性的 presentation preference。

GUI 不能使用 LLM 猜测应该调用什么工具、点击什么控件或如何完成用户任务。

## 迁移口径

迁移目标：

- GUI 侧不再定义新的任务编排协议。
- GUI 业务动作入口收敛为用户文本、refs、confirmation result 和 presentation intent。
- 旧 GUI debug 控件、projection、fixture、snapshot replay 只能作为诊断材料。
- GUI MCP / resource tree 只暴露只读语义资源和受控 presentation intent。
- workspace、browser、desktop、connector 或 artifact 副作用必须由调用方通过对应模块执行。

## 契约真相源

长期 GUI protocol、MCP tools、resource tree、runtime event projection 和测试应放在：

- `src/runtime/codex/gui-extension-manifest.ts`
- `src/runtime/codex/gui-mcp-tools.ts`
- `src/runtime/codex/gui-mcp-server.ts`
- `src/ui/src`
- `src/ui/src/**/*.test.ts`
- `tests/smoke/*gui*`

本文件只保留设计原则和迁移口径。

## 相关文档

- [`Architecture.md`](Architecture.md)：总架构和 GUI 上下游边界。
- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：GUI 与桌面动作 evidence 的边界。
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：GUI 与 Browser session 展示面的边界。
