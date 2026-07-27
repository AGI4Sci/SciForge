# Agent 运行时说明

SciForge 只支持两个可由用户选择的 Agent runtime：**Codex** 和 **Claude
Code**。新安装与迁移后的设置默认使用 Codex；Claude Code 需要用户显式选择。
SciForge 不再随包提供或展示自定义 Agent runtime，某个 runtime 失败时也不能
静默切换到另一个 runtime。

Code、Write、连接手机和定时任务应通过 runtime-neutral 的 `AgentRuntime`
contract 进入 Agent 工作流。Renderer 业务代码使用 `AgentRuntimeProvider` 和
`window.sciforge.agentRuntime` preload API，不能直接调用 Codex app-server
JSON-RPC 或 Claude Agent SDK。连接手机和定时任务会记录 runtime id，并保留按
runtime 分离的 thread mapping；所选 runtime 不支持后台工作流所需操作时必须
fail closed。

共享 contract、event 与 capability 形状见
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md)。

## 允许的扩展路径

1. Codex app-server JSON-RPC、可执行文件探测、配置、事件归一化、thread/event
   store 和进程生命周期代码集中在 `src/main/runtime/codex/`。
2. Claude Agent SDK 集成、可执行文件探测、配置、事件归一化和生命周期代码集中在
   `src/main/runtime/claude-code/`。
3. Runtime-neutral 的 adapter contract、host 编排、治理和共享生命周期行为放在
   `src/main/runtime/agent-runtime/`。
4. Runtime 事件在主进程中映射为共享 contract；renderer 显示映射放在
   `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`。
5. 共享集成点保持很薄：settings 类型/schema/migration、主进程 runtime 选择、
   renderer provider 注册和 Settings UI 可以知道 `codex | claude`。
6. 用户可见设置写入 `agents.codex` 或 `agents.claude`，并由
   `activeAgentRuntime` 记录当前选择。
7. 命令路径探测集中在各自 runtime 模块中；不要在 renderer 中探测 shell，也不要
   假设 GUI 进程继承了 login shell 的 `PATH`。
8. Model access 边界保持显式：provider API 凭据走 Model Router，登录态 coding
   subscription 走所选 runtime 的 adapter；两条路径不能静默 fallback。

## 禁止路径

- 不要恢复 SciForge Runtime、Kun、CodeWhale、Reasonix 或其他自定义 runtime
  进程、HTTP/SSE adapter、更新器或导入器。
- Codex 或 Claude Code 的可执行文件、登录、模型或 runtime 操作失败时，不要静默
  fallback 到另一个 runtime。
- 不要新增绕过 `AgentRuntimeProvider` 或中性
  `window.sciforge.agentRuntime` API 的 renderer 业务逻辑。
- 不要把 Codex 或 Claude 实现散落到各自 runtime 模块之外；允许的例外只有上面
  列出的薄集成点。
- 不要把 SciForge workspace service、Browser、Computer Use、VSCode app module
  或 artifact pipeline 混入 model-access 计费边界。
- 不要恢复面向已删除 provider 的 `AgentSwitcher`、`ConnectionStatusBar`、
  `RuntimeDiagnosticsDialog` 或 runtime self-check UI。
- 不要新增打开 runtime 控制面板的 `/usage` 或 `/runtime` 斜杠命令。

## 历史数据迁移规则

旧持久化 key 只能由 migration 或范围明确的历史清理逻辑读取。它们是历史输入，
不是新写入路径的兼容 API：

- `activeAgentRuntime: "sciforge"`、未知 runtime id，以及历史
  `agentProvider: codewhale | reasonix | deepseek-runtime` 选择统一归一化为
  `activeAgentRuntime: "codex"`。
- `agents.sciforge`、`agents.codewhale`、`agents.reasonix` 和历史 `deepseek`
  值不能再作为可选 runtime 设置展示，也不能被新代码使用。新的用户设置只写入
  `agents.codex` 或 `agents.claude`。
- 历史 `sciforge`、`codewhale`、`reasonix` thread mapping 只能在迁移需要时
  读取；新 mapping 使用 `codex` 或 `claude`，并由对应 runtime 管理。
- Remote-channel 代码中历史内部 `claw` 文件名或符号可以为兼容性保留，但不能
  成为用户可见或公开 API 名称。

## 验证清单

执行：

```bash
npm run typecheck
npm test
npm run build
```

手工冒烟：

- 新安装和迁移后的 settings 默认选择 Codex。
- Settings -> Agents 只展示 Codex 和 Claude Code，不出现 SciForge Runtime、Kun、
  CodeWhale 或 Reasonix 配置块。
- Codex 可以连接、创建和恢复 thread、流式返回、审批或拒绝工具、中断 turn，且
  可执行文件或登录错误有可操作提示。
- Claude Code 被显式选中后，可以完成其支持的共享操作，且不改写 Codex 设置或
  thread mapping。
- 所选 runtime 缺失或异常时明确失败，不自动切换到另一个 runtime。
- Write 的 inline 与选中文本助手使用当前 runtime，assistant thread 按 runtime
  隔离。
- 连接手机、定时任务和 workflow 保留所选 runtime id；不支持的操作 fail closed。
- 保存后的 settings 不会重新引入已删除 runtime 作为可选值。
