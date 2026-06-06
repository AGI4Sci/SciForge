# SciForge 使用与运维

最后更新：2026-06-06

本文描述当前代码已经落地的用法，以及当前目标架构要求的操作边界。脚本真相源是 [`../package.json`](../package.json)，配置默认值真相源是 [`../src/ui/src/config.ts`](../src/ui/src/config.ts)。

架构目标已经调整为 **SciForge GUI 是 Codex backend 的 GUI extension**；见 [`Architecture.md`](Architecture.md) 和 [`TuiGuiProtocol.md`](TuiGuiProtocol.md)。最终形态默认连接 Codex app-server，产品入口统一为默认聊天 turn：GUI 只提交自然语言文本、refs、Autonomy profile 和确认/取消；Codex/TUI Agent Host 在 `Codex Agent Host Turn Loop` 内完成 `Ground`、`Guard`、`Act / Answer`。生产默认让 Codex 使用 SciForge Model Router public alias/profile，由 `textReasoner` 和 `translators.vision` 等 role 解析实际 provider，不需要独立 AgentServer、turn router 或 gateway 产品层。Runtime Codex 是 downstream runtime，不是默认聊天 product owner。本文件里的 `workspace writer`、`AgentServer`、`runtime gateway`、`scenario` 等仍是当前实现路径或迁移期兼容层，不代表最终职责归属。

## 快速启动

环境要求：

- Node.js 20+
- npm
- 一个本地 workspace 目录
- 目标架构下的 Codex app-server，以及 SciForge Model Router public alias/profile 配置；Runtime Codex browser/release acceptance secret 只放进进程环境变量，ignored local config key 只可作为本机 router/proxy 调试 fallback

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

- `agentServerBaseUrl`：迁移期兼容字段。最终应替换为 Codex app-server 连接配置。
- `workspaceWriterBaseUrl`：workspace writer，默认 `http://127.0.0.1:5174`。
- `workspacePath`：当前工作区根目录。代码会把传入的 `/.sciforge` 子路径归一回 workspace 根。
- `agentBackend`：当前允许值为 `codex`、`openteam_agent`、`claude-code`、`hermes-agent`、`openclaw`、`gemini`。
- `modelProvider`、`modelBaseUrl`、`modelName`、`apiKey`：迁移期兼容字段。最终应成为 Codex custom provider / Model Router 配置；默认 provider 应为 SciForge Model Router public alias/profile，当前 Runtime Codex smoke gate 要求 `textReasoner` role alias，不得静默 fallback 到 OpenAI。不要把 Runtime Codex secret 写入这些字段；使用 `SCIFORGE_RUNTIME_API_KEY`。
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
  profile: sciforge-runtime-default
  model provider: SciForge Model Router
  model alias: textReasoner
  cwd: 用户 workspace
  purpose: 服务 SciForge 用户任务
```

示例：

```bash
codex --model gpt-5.5 -C /path/to/SciForge
```

```bash
codex app-server --listen stdio://
```

Runtime Codex 不能静默继承开发者 profile；缺少 `SCIFORGE_RUNTIME_API_KEY`、runtime profile 或 Model Router profile/role 配置时必须 fail closed。完整迁移教程见 [`CodexRuntimeMigration.md`](../packages/backend/CodexRuntimeMigration.md)。
需要文献、PDF、PubMed、动态网页等外部检索时，Runtime Codex 仍使用 `workspace-write`，但必须显式启用 `sandbox_workspace_write.network_access=true`；SciForge 的 runtime home 和 runtime adapter 会自动写入并传递该配置。

## Runtime Codex no-secret 配置

当前 smoke gate 要求 Runtime Codex 使用隔离 profile，并只公开 Model Router alias/role：

```text
profile: sciforge-runtime-default
provider: sciforge-model-router
model alias: textReasoner
env_key: SCIFORGE_RUNTIME_API_KEY
wire_api: responses
router base_url: <service-managed-model-router-responses-url>
```

Browser/release acceptance 使用的 Runtime Codex 密钥只进入启动 Runtime Codex / Model Router 的 service 环境，不写入 git、`config.local.json`、manifest 或 acceptance notes：

```bash
export SCIFORGE_RUNTIME_API_KEY="<provider-api-key>"
export SCIFORGE_TEXT_BASE_URL="https://your-text-provider-compatible-endpoint.example/v1"
export SCIFORGE_TEXT_MODEL="<private-text-reasoner-model>"
export SCIFORGE_TEXT_API_KEY="$SCIFORGE_RUNTIME_API_KEY"
export SCIFORGE_VISION_BASE_URL="https://your-vision-provider-compatible-endpoint.example/v1"
export SCIFORGE_VISION_MODEL="<private-vision-translator-model>"
export SCIFORGE_VISION_API_KEY="$SCIFORGE_RUNTIME_API_KEY"
```

如果不想把 upstream URL 放进 shell 环境，可以只把非 secret 的 upstream/model alias 写进被 `.gitignore` 忽略的 `config.local.json`。不要把这里的 `apiKey` 当成验收或 release secret：

```json
{
  "codexProxy": {
    "upstreamBaseUrl": "https://your-openai-compatible-endpoint.example/v1",
    "defaultModel": "textReasoner"
  }
}
```

Browser/release acceptance 会把 `config.local.json` 或 `.sciforge/**/config.local.json` 里的 `apiKey` / secret-like key 视为本地 proxy 调试 fallback，并在缺少 service 环境 `SCIFORGE_RUNTIME_API_KEY` 时 fail closed；这些配置文件里的 key 不能作为用户级验收或 release gate 的 Runtime Codex secret 来源。

生成或刷新隔离的 Runtime Codex home：

```bash
npm run backend:codex-runtime:setup -- --overwrite --proxy-base-url <model-router-responses-url>
```

启动本地 Model Router：

```bash
npm run backend:model-router -- --host 127.0.0.1 --port 3892
```

### Runtime Codex service-env/browser acceptance 复测路径

当前 no-secret browser acceptance 的本地复测必须从 service 环境取 Runtime Codex key；`config.local.json` 或 `.sciforge/**/config.local.json` 里的 `apiKey` / secret-like key 只用于本机 provider proxy 分诊，不能让 browser/release acceptance 通过。

先做不含 secret 的端口分诊：

```bash
curl -fsS http://127.0.0.1:5173/ >/dev/null
curl -fsS http://127.0.0.1:6173/health
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:3892/health
```

Computer Use 通过 Model Router 的 `translators.vision` role 获取视觉观察，不把固定视觉 provider 或 raw model slug 写成产品默认值。当前本地服务拓扑为：

```text
UI:                http://127.0.0.1:5173/
Workspace writer: http://127.0.0.1:6173/health
Runtime Codex:     http://127.0.0.1:18080/health
Model Router:      http://127.0.0.1:3892/health
```

no-secret 启动顺序示例：

```bash
export SCIFORGE_UI_PORT=5173
export SCIFORGE_WORKSPACE_PORT=6173
export SCIFORGE_RUNTIME_CODEX_PORT=18080
export SCIFORGE_MODEL_ROUTER_PORT=3892
export SCIFORGE_WORKSPACE_PATH="$PWD/workspace/parallel/p1"
export SCIFORGE_RUNTIME_API_KEY="<set-in-service-env-only>"
export SCIFORGE_TEXT_BASE_URL="https://text-provider-compatible-endpoint.example/v1"
export SCIFORGE_TEXT_MODEL="<private-text-reasoner-model>"
export SCIFORGE_TEXT_API_KEY="$SCIFORGE_RUNTIME_API_KEY"
export SCIFORGE_VISION_BASE_URL="https://vision-provider-compatible-endpoint.example/v1"
export SCIFORGE_VISION_MODEL="<private-vision-translator-model>"
export SCIFORGE_VISION_API_KEY="$SCIFORGE_RUNTIME_API_KEY"

npm run backend:codex-runtime:setup -- --overwrite --proxy-base-url http://127.0.0.1:3892/v1
npm run backend:model-router -- --host 127.0.0.1 --port 3892
SCIFORGE_WORKSPACE_PORT=6173 npm run workspace:server
SCIFORGE_RUNTIME_CODEX_PORT=18080 node --import tsx src/runtime/codex/codex-runtime-standalone-server.ts
npm run dev:ui -- --host 127.0.0.1 --port 5173 --strictPort
```

`SCIFORGE_RUNTIME_API_KEY` 的真实值必须由启动 Runtime Codex / Model Router 的 service manager、shell 或 CI secret store 注入；不要把真实值写进本文件、manifest、blocked note、`config.local.json` 或 `.sciforge/**/config.local.json`。

复测顺序：

```bash
npm run smoke:runtime-provider-preflight
npm run smoke:runtime-codex-browser-acceptance
SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance
```

provider preflight 和 config fallback 只能说明 upstream/secret-source 分诊状态；Codex in-app browser 的默认聊天入口只能作为 Web UI / Runtime Codex smoke。涉及真实 Browser Pane 的 product acceptance，必须使用 Desktop Electron native host 的 `WebContentsView` live acceptance。

`npm run smoke:runtime-codex-browser-acceptance` 是当前 `npm run verify:single-agent-final` 的一部分。默认模式会验证 fail-closed evidence；如果缺少 `SCIFORGE_RUNTIME_API_KEY` 或 Model Router role 配置，会写出 blocked manifest/notes，而不是假装通过。

`npm run smoke:runtime-provider-preflight` / `GET /healthz?check=upstream` 只做 live default-chat 前的 provider upstream 分诊（`config-missing`、`provider-auth`、`rate-limited`、`upstream-outage`、`repo-bug`）。`verify:single-agent-final` 和 `verify:single-agent-release` 会在 browser acceptance 前运行它，但它的结果仍是 `releaseAcceptance: not-evaluated`，不等同于 browser/release acceptance passed。

真实 release rerun 必须先完成 Web UI / Runtime Codex smoke，并确认非 seed 的第二轮答案可见；涉及 Browser Pane 的 release gate 还必须通过 Desktop Electron native host live acceptance。Web strict gate：

```bash
npm run smoke:runtime-codex-browser-acceptance:strict
```

strict gate 只接受 `manifest.status === "passed"`，并要求 provider/model/profile、workspace、command id、live `gui.present` 结果、折叠 audit、selected-ref follow-up 和 multi-turn second-turn answer 都有 Web UI 证据。它不能替代 Desktop Electron native Browser evidence。

涉及注释、反馈收件箱或 repair 控制面的 Web UI smoke 可以使用 Codex in-app browser，且必须覆盖工作台页面和至少一个非工作台页面。涉及真实窗口 overlay、window capture、native Browser 或 native input 的验收必须在 Desktop Electron native host 中完成。只验证旧的“顶部注释 -> 工作台主 composer”路径不能作为通过证据。

## 常用工作流

场景工作台的内置 scenario 来自 [`../packages/scenarios/core/src/scenarioSpecs.ts`](../packages/scenarios/core/src/scenarioSpecs.ts)：

- `literature-evidence-review`：文献证据评估。
- `structure-exploration`：结构探索。
- `omics-differential-exploration`：组学差异分析。
- `biomedical-knowledge-graph`：生物医学知识图谱。

当前代码里，一次普通聊天请求的实际路径是：

```text
ChatPanel
  -> runPromptOrchestrator
  -> sendSciForgeToolMessage
  -> /api/sciforge/runtime/codex/stream
  -> Codex Agent Host Turn Loop
  -> Ground / Guard / Act-Answer
  -> Runtime Codex, BrowserHostSession, Computer Use Guard, or blocked/confirmation projection
```

`/api/sciforge/tools/run/stream` 只保留为显式 `/computer-use diagnostic --legacy-workspace-gateway` 迁移诊断 shim，不是普通聊天或产品执行入口。

用户不需要手工拼现有 HTTP payload。选择 scenario、添加文件/结果引用、输入问题后，当前 SciForge 会把 turn、显式 refs、最近 run、artifact summary、组件选择和 backend 配置组装成 handoff payload。

上面是当前代码路径，不是目标路径。目标架构应删除 AgentServer 这一层，让 Codex app-server 直接承担 agent host，不新增独立 turn router/gateway 产品层：

```text
GUI event
  -> natural-language text + refs + Autonomy profile + confirm/cancel
  -> Codex app-server / Codex TUI Agent Host
  -> Codex Agent Host Turn Loop
     Ground: resolve user intent, refs, BrowserHostSession/search/read evidence, workspace and GUI resources
     Guard: check autonomy, permissions, capability readiness, hard-confirm and blocked policy
     Act / Answer: answer directly or invoke native plugins / skills / tools / MCP
  -> Codex custom model provider
  -> SciForge Model Router public alias/profile
  -> textReasoner / translators.vision roles
  -> read-only GUI resources for shell/hot-region/region-detail state
  -> intent-based gui.* tool calls for presentation
  -> GUI negotiate / render / confirm / collect input
```

所有算法、capability discovery、harness/policy、provider route 都应迁移为 TUI 原生扩展；GUI 自身通过只读 GUI resource tree、intent-based `gui.*` tools 和 progressive hot-region context 注入。GUI 的本地逻辑只覆盖 renderer、layout、focus、interaction mode、precondition、defer/reject/suggestion 等 presentation behavior，不承担任务推理、turn routing、gateway policy 或 capability ranking。

## 注释与反馈收件箱

当前注释收敛目标是全局 `AnnotationSidebar`。用户在工作台或非工作台页面点击 `注释` 后，应进入同一条流程：

1. 在页面上点选一个或多个 UI 对象，侧栏为它们分配 `※1`、`※2` 等引用 token。
2. 侧栏复用主 conversation kernel 的消息、引用和 stream/event 能力；整理/预览使用 `annotation-plan-only`，低风险小改动使用 `annotation-quick-action`。
3. 用户可以跳过澄清，也可以完成 1-3 个短问题后选择保存反馈、预览修改、应用小改动或把复杂改动送入收件箱。
4. 低风险小改动只适合单对象、局部、可解释、可回退的 copy/style 类请求；GitHub sync、repair handoff、commit、push、PR、merge 和复杂写入必须进收件箱。
5. 保存会生成反馈收件箱 `annotation-plan` record，包含引用对象、原始描述、澄清摘要、action log、修改建议、验收标准、页面 URL/route、selector/DOM path 和截图/evidence refs。

工作台主 composer 不承载注释讨论。它仍是执行、研究和普通对话入口；工作台里的消息、结果面板、项目树、设置入口和反馈收件箱条目只是注释侧栏可以引用的对象。

如果用户要把某条 `annotation-plan` 变成复杂 repair/code/GitHub sync，必须先进入反馈收件箱，对该条记录点击显式 repair/code/sync 操作，并通过对应确认边界。侧栏保存本身不能自动触发这些复杂动作。

## Workspace 产物

Workspace writer 会在当前 workspace 下维护 `.sciforge/` 状态。常见目录和文件：

- `.sciforge/workspace-state.json`：UI session、消息、run、artifact 和反馈状态。
- `.sciforge/task-attempts/`：迁移期任务尝试、失败原因、修复记录和输出引用；目标架构下应由 TUI CLI 的原生日志/事件流和 SciForge GUI refs 共同承载。
- `.sciforge/capability-evolution-ledger/`：能力组合、胶水代码、validation result、失败/修复和晋升候选的 compact ledger。
- `.sciforge/scenarios/<id>/`：workspace scenario package。
- `.sciforge/vision-runs/<run-id>/`：Computer Use run bundle，包含 refs-first trace、截图、focus crops、host-port evidence、`gui.present` record、user-acceptance manifest 和最终产物文件。Artifact-producing task 的最终产物必须能在 result/trace/`ToolPayload` 中以 bundle-local `finalArtifactRef` / `finalArtifactRefs` 找到。
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

当前目标通路由 TUI/Agent Host 调用 `packages/actions/computer-use` 的 `runTask(request, hostPorts)`。Computer Use 是 GUI I/O augmentation layer，不是 planner/agent：输入侧增强 Host 对当前 GUI 的观察，输出侧增强 Host 对局部 GUI 目标的 ground / execute / verify。`local.vision-sense` / `packages/observe/vision` 是可选 sense provider，只负责截图、视觉观察、focus region、Model Router `translators.vision` 观察和 verifier feedback；桌面动作由 Computer Use action provider 经 Host ports 执行。GUI 只提交自然语言文本、refs-first context、Autonomy profile 和确认/取消/stop 输入，并由 TUI/Agent Host 决定是否调用 `gui.present` / `gui.ask_user`。

产品默认不再要求用户输入 `/computer-use` 才进入能力路径，也不为 Browser Search / Computer Use 新增独立普通用户入口。当用户表达网页或桌面 GUI 操作意图时，Codex/TUI Agent Host 在默认聊天 turn 的 `Ground` 阶段读取 refs、BrowserHostSession、screen/window/app state 和 search/read evidence，在 `Guard` 阶段检查 Autonomy、permission refs、capability readiness、hard-confirm / blocked policy，再在 `Act / Answer` 阶段回答或调用 Computer Use / Browser observe/action 能力。`/computer-use` 只保留给 debug、expert、smoke 和 diagnostic；回答“是否具备 Computer Use/Browser 能力”时，必须基于当前 runtime health、BrowserHostSession、native surface 和 Guard 状态，而不是固定自述。

Browser pane 的目标体验采用 Desktop Electron native host：Browser 由 `BrowserHostSession` 持有 live browser owner，桌面主画面使用同一 session 的 `WebContentsView` native embedded adapter。Browser pane 只是 `BrowserHostSession` 的 display/control panel，不是 Browser agent，也不是 Browser Search 的普通用户产品入口。右侧旧 Screen pane 已迁移为 Image / Evidence Pane；它只展示 screenshot、crop、Browser evidence、window capture、artifact preview 和 replay/history image，不拥有 live control surface。frame-stream、WebRTC、canvas、`/frame` route、截图、PDF、document、proxy materialization、replay 和旧 frame 只用于 evidence/artifact 或审计，不作为第二个可交互画面，也不能替代当前 live Browser 或 Window Action 验收。无法 attach native surface 时必须 blocked / handoff / retry diagnostics，不能自动切到替代交互路径。

### Desktop Computer Use product path

Desktop CU 的产品入口必须是 SciForge Desktop Electron shell 里的普通聊天 turn。Web/Vite、Codex in-app browser、终端 probe、`/computer-use`、package harness、isolated desktop producer 和旧 workspace gateway 只能作为 smoke、diagnostic、historical regression 或迁移排查；即使它们写出 completed-looking evidence，也不能声明 Desktop product pass。

本地启动 Desktop shell 时，先按上文提供 Runtime Codex、Model Router、workspace writer 和 `SCIFORGE_RUNTIME_API_KEY` service-env，再启动 Electron host：

```bash
npm run desktop:dev
```

生产壳或打包壳复测使用：

```bash
npm run desktop:start:prod
npm run desktop:package:dir
```

一个可声明产品验收的 Desktop CU run 至少要从默认聊天输入进入，并在 current run bundle 中同时留下 Electron product shell、dynamic workspace writer、Runtime Codex transport、Desktop native host、`BrowserHostSession` 或 `WindowActionSession` target、permission / allowlist refs、必要 hard-confirm refs、action ledger、native sidecar or scoped adapter evidence、before/after evidence、viewer/replay refs、verifier/artifact refs 和 `gui.present` refs。GUI 仍只展示、确认、收集 stop/cancel 和投影 refs；它不是 executor，也不能把用户界面私有状态提升为完成证据。

Desktop permission 先由 Host / platform sidecar 做 preflight，而不是由文档或 GUI 假设成功。macOS Accessibility / Screen Recording、Windows UI Automation、native window capture、WebContents/WebView binding、target window binding、scoped input adapter、focus lease、display group 和 actor cursor provenance 都要产生 refs-first readiness 或 denial diagnostics。缺权限、缺 target、用户未确认 OS 弹窗、shared system input 未显式允许，或 native sidecar 只能 dry-run 时，结果只能是 `blocked`、`handoff`、`retry` 或 diagnostic manifest；不能写成 product pass。

Blocked recovery 是正常产品路径的一部分。被阻断的 run 必须写出 current-run blocked manifest、block reason、缺失 permission/capability refs、repair hint 和可重试 probe；恢复时只能在用户补权限、重新选择 target、提供当前 approval ref 或 Host 重新观察后继续，并要写 fresh re-observation 与新的 causality refs。不能用旧 screenshot、历史 trace、prior-round completion、package-local repair replay 或 action history 直接恢复为完成。高风险外部动作停在 `needs-confirmation` 可以是正确的 hard-confirm stop projection；它不是 diagnostic failure，也不等于动作已执行。

迁移期 package bridge / diagnostic adapter 会把 Computer Use request、host ports、package result、`gui.present` / `gui.ask_user` action metadata 和 trace 绑定起来，证明 process boundary 与 refs-first contract。若本机兼容排查仍调用 `python -m sciforge_computer_use --host-port-stdio`，该路径必须显式标成 legacy diagnostic / historical regression；product/default acceptance 不能引用 Python、pytest、Docker/noVNC、isolated desktop 或 M6 作为通过证据。当前产品路径以 TypeScript host-port contract、WindowActionSession evidence projection 和 current-run refs 为准；最终验收仍必须完成真实 WindowActionSession evidence、Desktop native 可见证据和 current-run user artifact / verifier bundle。历史 L2/L3 命名只作为旧验收层级语境保留，不替代当前 L0/L1/L2 架构分层。

每个 package bridge / diagnostic run 还会写 `.sciforge/vision-runs/<run-id>/tui-host-run-task-chain.json`，把 `computer-use-request.json`、`host-ports.json`、`tool-payload.json`、`vision-trace.json` 和可选 `gui-present.json` / `gui-ask-user.json` 绑定成 refs-first 链路清单；trace 的 `packageBridge.tuiHostRunTaskChainRef` 会指向它。这个清单方便 CU-NEXT 和人工复核定位链路 evidence，但不等同于真实任务完成。

目标生产能力应采用 Codex 风格标准插件形态：repo-local `plugin.json`、`.mcp.json` 和 skill 文档声明 `sciforge.computer-use`，由 Codex CLI / app-server 在默认聊天 turn 内发现和调用；它不是普通用户的 slash 入口。插件对外只暴露小工具面：`get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action` 和 `get_replay_refs`。这些工具必须转入 Computer Use package 的 scheduler、approval request、evidence 和 replay contract；approval 决策、repair 和用户级 completion 仍归 Agent Host。不得把 GUI private state、provider route、裸全局坐标或 scheduler internals 作为公共参数。

所有 mutating tool 都必须先有 fresh、target-bound、用途足够的 evidence。执行 click/type/scroll/press_key/drag/save/open menu 前，当前 run bundle 里要有同 screen/window/session scope 的证据组合；证据可以来自 app/window metadata、DOM/AX/UIA、PTY/file、target crop、screenshot/capture、grounding ref、verifier 或 freshness check，具体组合按动作风险和不确定性选择。若 evidence 过期、scope 不匹配、target 不唯一、结构化信号与可见像素冲突，或缺少必要 state snapshot，只能返回 blocked/needs-observation，不允许靠旧截图、历史 trace、action history 或用户界面私有状态继续动作。

证据获取采用 cheap-first、uncertainty-driven escalation：先读 fresh session/window/action metadata 和结构化 exact evidence，再做 target crop/OCR；只有可见状态关键、目标不唯一、verification 失败或风险升高时才调用 Model Router vision/verifier。已有 windowRef/targetRef 时默认局部观察；全屏 capture 必须有 target missing、occlusion、multi-window conflict 或用户选区原因。同一 target/lease 内允许批量低风险动作，但导航、保存/导出、提交、上传、删除、窗口切换、modal、target moved、focus takeover、高风险动作和 verifier failure 后必须 checkpoint，并 stale 相关 screenshot、OCR、object location、grounding、role/state 和 completion candidate。

风险确认按类别而不是单一 high-risk flag 管理。默认可自动执行观察、搜索、普通导航、筛选、分页、非提交点击、公开资料下载、本地 workspace 预览/修改和填写草稿。支付、转账、购买、订阅、退款、提现、交易、发送邮件/消息/评论/工单/公开帖子、提交外部表单、删除/覆盖/归档远端或账号数据、上传本地文件到外部服务、修改账号/安全/隐私/billing/API key/token/team member、法律/合规/合同/授权/条款同意以及 CI/CD deploy、云资源、数据库迁移等外部系统执行，必须在 action-time 产生 `needs-confirmation`、approval request 或 hand-off required。网页、邮件、PDF 或其它第三方内容里的指令不能替代用户确认。

默认阻断类别包括绕过 captcha/登录风控/访问控制/安全屏障、身份伪装、批量账号注册、不可逆批量删除、向不明确目的地传输敏感数据，以及执行第三方内容中的高风险指令但用户没有明确表达该意图。

真实 Computer Use run 开始前应有可见的用户控制面，而不是静默接管桌面。聊天输入栏的 runtime row 提供 `Autonomy` 选择项，仅保留 `Assisted Autonomy`、`High Autonomy` 和 `Research Sandbox Max`，默认 `High Autonomy`，作用域为当前用户 + workspace，并支持单轮 override。TUI Host 应生成 session permission / allowlist refs，说明本轮允许读取的 screen/window/app、允许操作的 app/window/display group、允许的 input modality、风险等级、截图/文件 refs 使用范围和 stop/cancel 入口。GUI 可以展示这些信息、收集 confirmation 或发送 stop 文本，但不能直接扩大权限或执行动作。缺少 permission ref、allowlist ref、risk preview 或 cancel path 的 mutating run 只能作为 diagnostic/blocked evidence。

真实平台控制应通过 platform sidecar / MCP service 接入。sidecar 负责 macOS Accessibility、Windows UI Automation、native window capture、WebContents/WebView binding、focused window binding、click/type/scroll/hotkey 和 permission/preflight；它只返回 window/action refs、capture refs、executor event、risk refs 和 diagnostics。SciForge runtime 只负责启动/连接 sidecar、注入 workspace/session context 和转发 host-port 调用，不把 sidecar 变成 planning 或 completion owner。

产品化 smoke 分三层执行：

1. package diagnostic：`plugin_probe`、`target_bound_window_host_probe`、`visible_run`，证明 SciForge Computer Use action provider、manifest、stdio、trace、viewer 和 artifact validation 可用。`acceptanceTier=package-diagnostic`、package-owned target-bound evidence、legacy `diagnosticOnly=false` 或 historical `userAcceptanceEligible=true` 都只描述该 harness 自身，不是 Desktop product pass。
2. platform smoke：Codex app-server/native plugin 或 `module.invoke(actions, execute)` 调用 SciForge Computer Use，再经 Desktop native host、platform sidecar / WindowActionSession 完成一个真实单 app 输入任务，要求 action adapter route、真实 window/capture refs、permission refs 和 executor lease refs。它证明 native path 可用，但仍需要任务级 artifact/verifier evidence 才能声明用户级完成。
3. product smoke：从 Desktop Electron 普通聊天进入，真实 artifact 任务、多 app workflow、高风险 confirmation stop、blocked recovery 和 viewer/replay evidence 全部使用当前 bundle refs。只有这一层可作为用户级完成证据。

当前严格/opt-in smoke 的含义：

```bash
npm run smoke:computer-use-chat-live-preflight:strict
npm run smoke:desktop-computer-use-hard-confirm-product:strict
npm run smoke:desktop-browser-native-live-acceptance:strict
npm run smoke:computer-use-chat-live-e2e:product-strict
npm run smoke:computer-use-chat-live-e2e:opt-in
npm run smoke:computer-use-chat-live-complex-matrix:opt-in-isolated
npm run release:computer-use-chat-live-complex-matrix-report
```

`release:computer-use-chat-live-complex-matrix-report` 会先以非 strict artifact-prep 模式刷新 split aggregate artifact，再生成 strict `release-report.json`。最终退出码由 strict release report 决定，`live-preflight-not-ready`、package diagnostic 或缺 current-run L3 evidence 仍必须 fail closed。

`smoke:computer-use-chat-live-preflight:strict` 只证明 live acceptance 前置条件和 fail-closed 分类。`smoke:desktop-computer-use-hard-confirm-product:strict` 与 `smoke:desktop-browser-native-live-acceptance:strict` 分别验证 Desktop hard-confirm 和 native Browser live surface 的产品路径条件。`smoke:computer-use-chat-live-e2e:product-strict` 只在 evidence 明确来自普通 Desktop chat、Electron product shell、Desktop native host、当前 `BrowserHostSession` / `WindowActionSession`、permission refs、action ledger、hard-confirm refs、artifact/verifier refs 和 bounded replay bundle 时，才可声明 Desktop CU product acceptance；缺这些 refs 必须 fail closed。`smoke:computer-use-chat-live-e2e:opt-in`、complex matrix 和 release report 目前仍可引用 embedded isolated desktop L3 / package diagnostic evidence；它们适合回归和迁移报告，不能替代 Desktop Electron native host + current-run WindowActionSession / BrowserHostSession evidence。

启用真实桌面 bridge：

```bash
export SCIFORGE_VISION_DESKTOP_BRIDGE=1
```

Computer Use 的局部 next-action selector、视觉观察、crop inspection、候选消歧、grounding translator 和 verifier explanation 都通过 Model Router `/v1/responses` 完成，并由 workspace/profile role 选择 `textReasoner` 或 `translators.vision`。Computer Use live/product preflight 不再接受独立 grounding service 作为 ready 条件。

真实输入优先使用目标 app/window 的独立 action adapter。Browser pane 的桌面高性能路径已经采用 `WebContentsView` native embedded adapter；普通窗口动作通过 WindowActionSession 路由到 app-native command、Accessibility/UI Automation/AT-SPI、BrowserHostSession/CDP/Playwright 或显式 `shared-system-input` evidence。截图投影只属于 Image / Evidence 查看器，不承担替代交互路径。

```bash
export SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop
export SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop
```

未注册可执行 provider 的 `remote-desktop` 或 `virtual-hid` 会 fail closed。没有独立 adapter 时，系统鼠标键盘是 shared system input：只能在低风险、聚焦窗口 smoke 中显式允许，执行期间不要和用户手动输入并发：

```bash
export SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT=1
```

每轮 Computer Use 输出应写到 `.sciforge/vision-runs/<run-id>/`，trace 只保存 file refs、before/after screenshot refs、focus crop refs、sha256、尺寸、target description、坐标、router profile/role/alias、受限 provider metadata、executor lease、verifier verdict、approval/audit refs 和 diagnostics，不内联截图/base64、provider URL、API key、raw model slug 或 raw provider payload。产物型任务完成时，应检查 package result、`vision-trace.json`、`tool-payload.json` 和 `gui-present.json` 是否同时暴露同一个 bundle-local `finalArtifactRef`；`gui.present` 的 displayed refs 必须包含该 ref 和 trace 摘要。`gui.present` 只能证明用户可见展示，不能替代 executor、artifact validator 或 Host completion。

常用配置还包括：

- `SCIFORGE_VISION_CAPTURE_DISPLAYS`
- `SCIFORGE_RUNTIME_API_KEY`
- `SCIFORGE_COMPUTER_USE_PLANNER_PROFILE`：迁移期/诊断字段，只能映射到 Model Router 的局部 next-action selector role；不得表示 Computer Use 拥有用户级 planner，也不得绕过 `/v1/responses` profile/role。
- `SCIFORGE_RUNTIME_BASE_URL` / `SCIFORGE_PROXY_UPSTREAM_BASE_URL`：Model Router provider-compatible `/v1/responses` endpoint。
- `SCIFORGE_RUNTIME_PROVIDER` / `SCIFORGE_RUNTIME_MODEL`：公开 provider alias 和 public model alias，默认分别为 `sciforge-model-router` 与 `sciforge-router`；带 raw provider/model 词的值即使伪装成公开前缀，也只能归一为默认公开 alias，不能进入 UI、metadata 或 audit 输出。

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

注释、反馈收件箱和 repair UI 的 Web smoke 证据可以来自 Codex in-app browser，并记录工作台页面与非工作台页面两条路径。真实窗口 overlay、window capture、native Browser 或 native input 的产品证据必须来自 Desktop Electron native host；terminal smoke、API probe 或外部浏览器只能作为辅助诊断。

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
npm run computer-use-long:run-matrix
npm run computer-use-long:validate-matrix
```

`computer-use-long:validate-matrix` 默认是 release gate：matrix 必须是 `passed` 才返回成功。若 `run-matrix` 因缺 Desktop native host、independent input adapter、权限或其他真实产品路径 evidence 而写出 `repair-needed` summary，使用 `npm run computer-use-long:validate-matrix -- --allow-repair-needed` 只做结构化 repair manifest 检查；它不能作为通过验收。

文档相关 smoke：

```bash
npm run smoke:docs-scenario-package
```
