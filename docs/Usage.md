# SciForge 使用与运维

最后更新：2026-05-19

本文只描述当前代码已经落地的用法。脚本真相源是 [`../package.json`](../package.json)，配置默认值真相源是 [`../src/ui/src/config.ts`](../src/ui/src/config.ts)。

架构目标已经调整为 **SciForge GUI 是 Codex backend 的 GUI extension**；见 [`Architecture.md`](Architecture.md) 和 [`TuiGuiProtocol.md`](TuiGuiProtocol.md)。最终形态默认连接 Codex app-server / CLI bridge，生产默认让 Codex 使用 DeepSeek `deepseek-v4-flash` 或用户配置的低成本 provider/proxy，不需要独立 AgentServer。本文件里的 `workspace writer`、`AgentServer`、`runtime gateway`、`scenario` 等仍是当前实现路径或迁移期兼容层，不代表最终职责归属。

## 快速启动

环境要求：

- Node.js 20+
- npm
- 一个本地 workspace 目录
- 目标架构下的 Codex app-server / CLI bridge，以及 DeepSeek provider/proxy 配置

安装依赖并启动完整本地工作台：

```bash
npm install
npm run dev
```

`npm run dev` 通过 [`../tools/dev.ts`](../tools/dev.ts) 同时启动 Vite UI 和 workspace writer。默认入口：

```text
UI: http://127.0.0.1:5173
Workspace writer: http://127.0.0.1:5174
```

只启动 UI：

```bash
npm run dev:ui
```

只启动 workspace writer：

```bash
npm run workspace:server
```

健康检查：

```bash
curl http://127.0.0.1:5174/health
```

## 配置

UI 配置存于浏览器 `localStorage`，workspace writer 的本地配置可通过 `/api/sciforge/config` 读写。示例文件是 [`../config.example.json`](../config.example.json)。

核心字段：

- `agentServerBaseUrl`：迁移期兼容字段。最终应替换为 Codex app-server / CLI bridge 连接配置。
- `workspaceWriterBaseUrl`：workspace writer，默认 `http://127.0.0.1:5174`。
- `workspacePath`：当前工作区根目录。代码会把传入的 `/.sciforge` 子路径归一回 workspace 根。
- `agentBackend`：当前允许值为 `codex`、`openteam_agent`、`claude-code`、`hermes-agent`、`openclaw`、`gemini`。
- `modelProvider`、`modelBaseUrl`、`modelName`、`apiKey`：迁移期兼容字段。最终应成为 Codex custom provider / provider proxy 配置；默认 provider 应为 DeepSeek，默认模型为 `deepseek-v4-flash`，不得静默 fallback 到 OpenAI。
- `requestTimeoutMs`：UI 等待 workspace stream 的超时，默认 900000ms。
- `maxContextWindowTokens`：上下文预算，默认 200000。
- `peerInstances`：双实例互修目标，字段见 [`../src/ui/src/domain.ts`](../src/ui/src/domain.ts) 的 `PeerInstance`。
- `feedbackGithubRepo`、`feedbackGithubToken`：反馈收件箱同步 GitHub Issue 时使用。

## Codex 实例隔离

开发 SciForge 的 Codex 和 SciForge 运行期 Codex 必须分开：

```text
Dev Codex
  model: GPT-5.5 或开发者选择的模型
  cwd: SciForge repo
  purpose: 修改 SciForge 代码

Runtime Codex
  profile: sciforge-runtime-deepseek
  model provider: DeepSeek deepseek-v4-flash 或 provider proxy
  cwd: 用户 workspace
  purpose: 服务 SciForge 用户任务
```

示例：

```bash
codex --model gpt-5.5 -C /path/to/SciForge
```

```bash
codex exec --json \
  --profile sciforge-runtime-deepseek \
  --cd "$SCIFORGE_USER_WORKSPACE" \
  --sandbox workspace-write \
  "$SCIFORGE_USER_TEXT_COMMAND"
```

Runtime Codex 不能静默继承开发者 profile；缺少 DeepSeek key、runtime profile 或 provider proxy 时必须 fail closed。完整迁移教程见 [`CodexRuntimeMigration.md`](CodexRuntimeMigration.md)。

## 常用工作流

场景工作台的内置 scenario 来自 [`../packages/scenarios/core/src/scenarioSpecs.ts`](../packages/scenarios/core/src/scenarioSpecs.ts)：

- `literature-evidence-review`：文献证据评估。
- `structure-exploration`：结构探索。
- `omics-differential-exploration`：组学差异分析。
- `biomedical-knowledge-graph`：生物医学知识图谱。

当前代码里，一次普通请求的实际路径是：

```text
ChatPanel
  -> runPromptOrchestrator
  -> sendSciForgeToolMessage
  -> /api/sciforge/tools/run/stream
  -> runWorkspaceRuntimeGateway
  -> Python conversation-policy
  -> context envelope + capability broker brief
  -> AgentServer/backend 选择能力并生成结果或 task
  -> validation / ContractValidationFailure repair loop
  -> ToolPayload + artifacts + ExecutionUnits
```

用户不需要手工拼现有 HTTP payload。选择 scenario、添加文件/结果引用、输入问题后，当前 SciForge 会把 turn、显式 refs、最近 run、artifact summary、组件选择和 backend 配置组装成 handoff payload。

上面是当前代码路径，不是目标路径。目标架构应删除 AgentServer 这一层，让 Codex app-server / CLI bridge 在终端中直接承担 agent host：

```text
GUI event
  -> terminal-equivalent text
  -> Codex app-server / CLI bridge
  -> Codex custom model provider
  -> DeepSeek deepseek-v4-flash / configured provider proxy by default
  -> native plugins / skills / tools / MCP
  -> read-only GUI resources for shell/hot-region/region-detail state
  -> intent-based gui.* tool calls for presentation
  -> GUI negotiate / render / confirm / collect input
```

所有算法、capability discovery、harness/policy、provider route 都应迁移为 TUI 原生扩展；GUI 自身通过只读 GUI resource tree、intent-based `gui.*` tools 和 progressive hot-region context 注入。GUI 的本地逻辑只覆盖 renderer、layout、focus、interaction mode、precondition、defer/reject/suggestion 等 presentation behavior，不承担任务推理。

## Workspace 产物

Workspace writer 会在当前 workspace 下维护 `.sciforge/` 状态。常见目录和文件：

- `.sciforge/workspace-state.json`：UI session、消息、run、artifact 和反馈状态。
- `.sciforge/task-attempts/`：迁移期任务尝试、失败原因、修复记录和输出引用；目标架构下应由 TUI CLI 的原生日志/事件流和 SciForge GUI refs 共同承载。
- `.sciforge/capability-evolution-ledger/`：能力组合、胶水代码、validation result、失败/修复和晋升候选的 compact ledger。
- `.sciforge/scenarios/<id>/`：workspace scenario package。
- `.sciforge/skill-proposals/<id>/`：可晋升 skill 候选。
- `.sciforge/evolved-skills/<id>/`：用户接受后的 workspace skill。
- `.sciforge/repair-worktrees/<run>/`：双实例互修 runner 创建的隔离目标 worktree。

文件预览、打开和 workspace 操作经由 [`../src/runtime/workspace-server.ts`](../src/runtime/workspace-server.ts) 的 `/api/sciforge/workspace/*` 与 `/api/sciforge/preview/*` 端点。

## 双实例互修

双实例互修是当前实现的自我进化主路径。推荐用两个 git worktree，各自运行完整 SciForge 实例：

```bash
npm run worktree:dual -- create
npm run dev:dual
```

默认端口：

```text
A  UI http://127.0.0.1:5173  writer http://127.0.0.1:5174
B  UI http://127.0.0.1:5273  writer http://127.0.0.1:5274
```

互修边界：

- 执行方实例通过目标实例的 `instance/manifest`、`feedback/issues` 和 repair result API 读取结构化 issue bundle。
- 修复写入发生在目标 repo 的 `.sciforge/repair-worktrees/<run>` 隔离 worktree。
- `repair-handoff-runner` 会 fail-closed：目标 workspace 不能等于、包含或被包含于执行方 repo/state/config/log 路径。
- 稳定版本同步不是自动漂移；只能通过 stable version `promote` 和 `sync-plan` 生成显式计划。

常用检查：

```bash
npm run smoke:dual-instance
npm run smoke:dual-worktree-instance
npm run smoke:repair-handoff-runner
npm run smoke:stable-version-registry
```

## Computer Use

当前通路由 `local.vision-sense` 触发。它是 sense plugin，负责把截图/图像/GUI 状态转成可审计文本信号和 trace refs；桌面执行由 runtime 的 generic Computer Use loop 和上游桌面 bridge 承担。

启用真实桌面 bridge：

```bash
export SCIFORGE_VISION_DESKTOP_BRIDGE=1
```

常用配置还包括：

- `SCIFORGE_VISION_CAPTURE_DISPLAYS`
- `SCIFORGE_VISION_PLANNER_BASE_URL`
- `SCIFORGE_VISION_PLANNER_API_KEY`
- `SCIFORGE_VISION_PLANNER_MODEL`
- `SCIFORGE_VISION_KV_GROUND_URL`
- `SCIFORGE_VISION_GROUNDER_LLM_BASE_URL`
- `SCIFORGE_VISION_GROUNDER_LLM_API_KEY`
- `SCIFORGE_VISION_GROUNDER_LLM_MODEL`

详细能力边界和排障见 [`../packages/observe/vision/README.md`](../packages/observe/vision/README.md) 与 [`../packages/actions/computer-use/README.md`](../packages/actions/computer-use/README.md)。

## Skill 晋升

迁移期 runtime 生成的成功 workspace task 可以生成 skill promotion proposal。真实逻辑在 [`../src/runtime/skill-promotion.ts`](../src/runtime/skill-promotion.ts)。目标架构下，skill/plugin 晋升应优先沉淀为 Codex 原生 tool、skill、plugin、MCP 或 slash command。

流程：

1. 成功或自愈后的 task 写入 `.sciforge/skill-proposals/<proposal>/proposal.json`。
2. Dashboard 或 API 可执行 accept、reject、archive、validate。
3. accept 会再次跑安全门，复制任务代码到 `.sciforge/evolved-skills/<skill>/` 并写 `skill.json`。
4. validate 会按 manifest 的 validation smoke 执行一次 workspace task。

相关 API：

- `GET /api/sciforge/skill-proposals/list`
- `POST /api/sciforge/skill-proposals/accept`
- `POST /api/sciforge/skill-proposals/validate`
- `POST /api/sciforge/skill-proposals/reject`
- `POST /api/sciforge/skill-proposals/archive`

## 验证命令

常用快速检查：

```bash
npm run typecheck
npm run test
npm run smoke:all
npm run build
```

快速完整验证：

```bash
npm run verify
```

最终架构边界检查：

```bash
npm run packages:check
npm run smoke:fixed-platform-boundary
npm run smoke:no-src-capability-semantics
npm run smoke:no-legacy-paths
npx tsx tests/smoke/smoke-official-packages.ts
```

迁移期兼容检查仍可能覆盖旧 AgentServer adapter；它们不是最终架构依赖。

更重的长任务和 Computer Use 回归：

```bash
npm run verify:deep
npm run smoke:browser
npm run smoke:vision-sense-runtime
npm run computer-use-long:preflight
```

文档相关 smoke：

```bash
npm run smoke:docs-scenario-package
```
