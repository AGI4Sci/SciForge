# SciForge 使用与运维

最后更新：2026-05-24

本文描述当前代码已经落地的用法，以及当前目标架构要求的操作边界。脚本真相源是 [`../package.json`](../package.json)，配置默认值真相源是 [`../src/ui/src/config.ts`](../src/ui/src/config.ts)。

架构目标已经调整为 **SciForge GUI 是 Codex backend 的 GUI extension**；见 [`Architecture.md`](Architecture.md) 和 [`TuiGuiProtocol.md`](TuiGuiProtocol.md)。最终形态默认连接 Codex app-server / CLI bridge，生产默认让 Codex 使用 DeepSeek/proxy `bailian/deepseek-v4-flash` 或用户配置的低成本 provider/proxy，不需要独立 AgentServer。本文件里的 `workspace writer`、`AgentServer`、`runtime gateway`、`scenario` 等仍是当前实现路径或迁移期兼容层，不代表最终职责归属。

## 快速启动

环境要求：

- Node.js 20+
- npm
- 一个本地 workspace 目录
- 目标架构下的 Codex app-server / CLI bridge，以及 DeepSeek provider/proxy 配置；Runtime Codex browser/release acceptance secret 只放进进程环境变量，ignored local config key 只可作为本机 proxy 调试 fallback

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
- `modelProvider`、`modelBaseUrl`、`modelName`、`apiKey`：迁移期兼容字段。最终应成为 Codex custom provider / provider proxy 配置；默认 provider 应为 DeepSeek/proxy，当前 Runtime Codex smoke gate 要求 `bailian/deepseek-v4-flash`，不得静默 fallback 到 OpenAI。不要把 Runtime Codex secret 写入这些字段；使用 `SCIFORGE_RUNTIME_API_KEY`。
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
  model provider: DeepSeek/proxy bailian/deepseek-v4-flash
  cwd: 用户 workspace
  purpose: 服务 SciForge 用户任务
```

示例：

```bash
codex --model gpt-5.5 -C /path/to/SciForge
```

```bash
codex exec --json \
  --config sandbox_workspace_write.network_access=true \
  --profile sciforge-runtime-deepseek \
  --cd "$SCIFORGE_USER_WORKSPACE" \
  --sandbox workspace-write \
  "$SCIFORGE_USER_TEXT_COMMAND"
```

Runtime Codex 不能静默继承开发者 profile；缺少 `SCIFORGE_RUNTIME_API_KEY`、runtime profile 或 provider proxy upstream 时必须 fail closed。完整迁移教程见 [`CodexRuntimeMigration.md`](CodexRuntimeMigration.md)。
需要文献、PDF、PubMed、动态网页等外部检索时，Runtime Codex 仍使用 `workspace-write`，但必须显式启用 `sandbox_workspace_write.network_access=true`；SciForge 的 runtime home 和 runtime adapter 会自动写入并传递该配置。

## Runtime Codex no-secret 配置

当前 smoke gate 要求 Runtime Codex 使用隔离 profile：

```text
profile: sciforge-runtime-deepseek
provider: sciforge-deepseek-proxy
model: bailian/deepseek-v4-flash
env_key: SCIFORGE_RUNTIME_API_KEY
wire_api: responses
proxy base_url: http://127.0.0.1:3891/v1
```

Browser/release acceptance 使用的 Runtime Codex 密钥只进入启动 Runtime Codex / provider proxy 的 service 环境，不写入 git、`config.local.json`、manifest 或 acceptance notes：

```bash
export SCIFORGE_RUNTIME_API_KEY="<provider-api-key>"
export SCIFORGE_PROXY_UPSTREAM_BASE_URL="https://your-openai-compatible-endpoint.example/v1"
```

如果不想把 upstream URL 放进 shell 环境，可以只把非 secret 的 upstream/model 写进被 `.gitignore` 忽略的 `config.local.json`。不要把这里的 `apiKey` 当成验收或 release secret：

```json
{
  "codexProxy": {
    "upstreamBaseUrl": "https://your-openai-compatible-endpoint.example/v1",
    "defaultModel": "bailian/deepseek-v4-flash"
  }
}
```

Browser/release acceptance 会把 `config.local.json` 或 `.sciforge/**/config.local.json` 里的 `apiKey` / secret-like key 视为本地 proxy 调试 fallback，并在缺少 service 环境 `SCIFORGE_RUNTIME_API_KEY` 时 fail closed；这些配置文件里的 key 不能作为用户级验收或 release gate 的 Runtime Codex secret 来源。

生成或刷新隔离的 Runtime Codex home：

```bash
npm run backend:codex-runtime:setup -- --overwrite --proxy-base-url http://127.0.0.1:3891/v1
```

启动本地 provider proxy：

```bash
npm run backend:codex-proxy
```

`npm run smoke:runtime-codex-browser-acceptance` 是当前 `npm run verify:single-agent-final` 的一部分。默认模式会验证 fail-closed evidence；如果缺少 `SCIFORGE_RUNTIME_API_KEY` 或 provider proxy upstream base URL，会写出 blocked manifest/notes，而不是假装通过。

`npm run smoke:runtime-provider-preflight` / `GET /healthz?check=upstream` 只做 live default-chat 前的 provider upstream 分诊（`config-missing`、`provider-auth`、`rate-limited`、`upstream-outage`、`repo-bug`）。`verify:single-agent-final` 和 `verify:single-agent-release` 会在 browser acceptance 前运行它，但它的结果仍是 `releaseAcceptance: not-evaluated`，不等同于 browser/release acceptance passed。

真实 release rerun 必须先在 Codex in-app browser 的默认聊天入口完成 live Runtime Codex 验收，并确认非 seed 的第二轮答案可见，然后启用 strict gate：

```bash
npm run smoke:runtime-codex-browser-acceptance:strict
```

strict gate 只接受 `manifest.status === "passed"`，并要求 provider/model/profile、workspace、command id、live `gui.present` 结果、折叠 audit、selected-ref follow-up 和 multi-turn second-turn answer 都有真实浏览器证据。

涉及注释、反馈收件箱或 repair 控制面的用户级验收必须同样使用 Codex in-app browser，且必须覆盖工作台页面和至少一个非工作台页面。两处都要从可见 `注释` 入口进入全局 `AnnotationSidebar`，点选多个对象，完成 plan-only 澄清或跳过澄清，保存到反馈收件箱，并确认生成的是 `annotation-plan` record。只验证旧的“顶部注释 -> 工作台主 composer”路径不能作为通过证据。

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
  -> DeepSeek/proxy bailian/deepseek-v4-flash / configured provider proxy by default
  -> native plugins / skills / tools / MCP
  -> read-only GUI resources for shell/hot-region/region-detail state
  -> intent-based gui.* tool calls for presentation
  -> GUI negotiate / render / confirm / collect input
```

所有算法、capability discovery、harness/policy、provider route 都应迁移为 TUI 原生扩展；GUI 自身通过只读 GUI resource tree、intent-based `gui.*` tools 和 progressive hot-region context 注入。GUI 的本地逻辑只覆盖 renderer、layout、focus、interaction mode、precondition、defer/reject/suggestion 等 presentation behavior，不承担任务推理。

## 注释与反馈收件箱

当前注释收敛目标是全局 `AnnotationSidebar`。用户在工作台或非工作台页面点击 `注释` 后，应进入同一条流程：

1. 在页面上点选一个或多个 UI 对象，侧栏为它们分配 `※1`、`※2` 等引用 token。
2. 侧栏复用主 conversation kernel 的消息、引用和 stream/event 能力，但请求必须处于 `annotation-plan-only` 模式。
3. Plan-only 模式只能做需求澄清、选择题、摘要和 feedback draft；不能写 workspace、启动 repair、运行 code、提交 GitHub issue 或触发其他外部副作用。
4. 用户可以跳过澄清，也可以完成 1-3 个短问题后保存。
5. 保存只生成反馈收件箱 `annotation-plan` record，包含引用对象、原始描述、澄清摘要、修改建议、验收标准、页面 URL/route、selector/DOM path 和截图/evidence refs。

工作台主 composer 不承载注释讨论。它仍是执行、研究和普通对话入口；工作台里的消息、结果面板、项目树、设置入口和反馈收件箱条目只是注释侧栏可以引用的对象。

如果用户要把某条 `annotation-plan` 变成 repair/code/GitHub sync，必须先进入反馈收件箱，对该条记录点击显式 repair/code/sync 操作，并通过对应确认边界。侧栏保存本身不能自动触发这些动作。

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

双实例互修是迁移期的开发诊断模式，不是最终默认 runtime ownership。默认自修复路线必须收敛为 Codex 原生 skill/plugin/MCP/slash command 或外部 supervisor；否则保持退役状态。需要验证旧互修边界时，可以用两个 git worktree，各自运行完整 SciForge 实例：

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

文档-only 修改至少运行：

```bash
git diff --check
```

快速完整验证：

```bash
npm run verify
```

单 agent final / release 验证：

```bash
npm run verify:single-agent-final
npm run verify:single-agent-release
```

`verify:single-agent-release` 会先执行 strict Runtime Codex browser acceptance，缺少 live Runtime Codex service secret 时会立刻 fail closed；strict browser gate 通过后才继续执行 desktop package directory gate 和后续 release 检查。

注释、反馈收件箱和 repair UI 的 browser acceptance 证据必须来自 Codex in-app browser，并记录工作台页面与非工作台页面两条路径。证据中应能看到全局 `AnnotationSidebar`、多对象引用、`annotation-plan-only` 保存和反馈收件箱记录；terminal smoke、API probe 或外部浏览器只能作为辅助诊断。

桌面 package 验证：

```bash
npm run desktop:package:dir
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
