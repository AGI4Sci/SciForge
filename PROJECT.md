# SciForge 项目协议

最后更新：2026-05-20

当前基线：`dev@ba12a22` 已推送。上一轮通用修复已完成本地配置单一真相源、Runtime Codex native message 呈现、provider retry/audit 折叠和 401/502 脱敏恢复原因；`verify:single-agent-final` 通过。当前工作区继续补了 Runtime Codex audit bundle、provider proxy scrub、real-task evidence manifest gate、SA-WEB-19 大文件 bounded diagnostics、SA-WEB-20/21/22 数据压测离线覆盖、SA-WEB-23/24/28 GUI protocol 离线覆盖、SA-WEB-29 native resume artifact follow-up 离线覆盖、SA-WEB-30 长上下文 constraint 稳定性离线覆盖、SA-WEB-31/32 literature/web 离线覆盖、SA-WEB-33/34 code/dirty-worktree 离线覆盖、SA-WEB-35 scientific reviewer/verifier 离线覆盖、SA-WEB-36 capability/skill/Computer Use 离线覆盖、SA-WEB-37 run/resume lifecycle 离线覆盖、SA-WEB-38 provider/security/audit 离线覆盖、R-RUN-01 service lifecycle evidence ledger、R-RUN-02 cancellation evidence ledger、R-RESUME-02 restore/native-continuity evidence gate、desktop production launcher/shell/packaging preflight contracts、desktop Electron main/preload entrypoint、desktop sidecar bundling、production/packaged Electron lifecycle smoke、directory-level Electron package artifact inspection、desktop live acceptance evidence schema、Runtime Codex strict release gate、AgentServer compatibility quarantine、selected-report durable direct-context follow-up、runtime provider upstream diagnostic preflight 和 native-only visible-not-live-acceptance/session-lineage 边界。2026-05-20 已从 Codex in-app browser 默认聊天入口完成共享 Runtime Codex live browser acceptance：service env/provider preflight 为 `ready`，strict browser gate 通过，覆盖 single-turn visible answer、多轮 native resume recall、`gui.present` artifact object reference 和 selected-artifact follow-up。该共享 browser gate 不能替代 31 个 R-* 任务各自的三轮 live evidence，也不能替代 desktop packaged/production window 内真实 Runtime Codex 用户运行。

本文件是当前执行任务板。已完成的 parallel worker 细账、旧 P1-P6 run log 和历史方案只保留在 Git history / `docs/archive/` 中，不再作为当前实现入口。

## 当前事实

SciForge 当前路线是 **保留 UI/packages，Runtime Codex 优先，GUI 作为 TUI extension，下一步收敛 desktop 边界**。

核心架构：

- Codex CLI / TUI 拥有 agent 逻辑、上下文、记忆、工具、插件、修复和执行。
- SciForge GUI 是翻译壳、观察层和可复用展示层，不是 agent host。
- GUI -> runtime 只发送 terminal-equivalent text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent-based `gui.*` results。
- GUI 可以做 deterministic presentation behavior，不能做 provider route、capability ranking、repair policy、prompt assembly 或 completion 判断。
- 多轮对话以 Codex CLI thread/session 为权威状态源；SciForge 只保存 thread id、attempt id、UI metadata 和 evidence refs，继续对话时调用 Codex 原生 resume，而不是拼 GUI transcript。
- `docs/` 是产品/架构/协议/用法真相源；backend runtime migration 真相源是 `packages/backend/CodexRuntimeMigration.md`。
- 短中期桌面化选择 Electron；Tauri 只作为 runtime launcher、app data、secret storage 和 platform service 稳定后的长期优化项。

LLM API 信息：
Runtime secret env: `SCIFORGE_RUNTIME_API_KEY`，不要把 API key、token 或 credential 写入仓库文件。
Runtime upstream env: `SCIFORGE_PROXY_UPSTREAM_BASE_URL`，本机调试使用 ignored local config 或 shell 环境变量。

必须保留：

- `src/ui/**` 现有页面体验和视觉结构；runtime / desktop 迁移期间不允许换成临时 demo shell。
- `packages/**` 中的 contracts、presentation components、skills、workers、observe/actions/verifiers 等可复用资产。
- `docs/` 当前设计方向，`docs_old/` 旧方案快照。

可以清理或重写：

- `src/runtime/**` 旧 AgentServer-first gateway / harness / generation / workspace runtime 链路。
- 迁移期配置字段、脚本名和测试名中的 AgentServer-first 语义。
- 临时缓存、构建产物、无引用实验残留。

## 不可妥协原则

- 成本透明，provider/model/profile/workspace/command id 必须可见、可审计、可测试。
- Runtime Codex 默认使用 DeepSeek / provider proxy：`sciforge-runtime-deepseek` profile，当前集成使用 `bailian/deepseek-v4-flash`。
- Runtime Codex browser/release acceptance 的 secret 只允许来自 service 环境变量 `SCIFORGE_RUNTIME_API_KEY`；ignored local config 中的 secret-like key 只能作为本机 provider proxy 调试 fallback，不能满足用户级 browser/release acceptance。provider proxy upstream base URL 必须来自 `SCIFORGE_PROXY_UPSTREAM_BASE_URL`、CLI `--upstream-base-url` 或 ignored `config.local.json` 的 `upstreamBaseUrl`，缺 release secret 或 upstream 必须 fail closed。
- Runtime Codex 不得静默继承 Developer Codex profile。
- raw provider SSE、raw Codex JSONL、stdout、stderr、plugin warning 只进 audit/debug，默认折叠，不进入主回复 DOM 或 foreground waiting summary。
- Runtime Codex native assistant message 可以作为主回复展示，但不能自动变成 live acceptance pass；`gui.present` / structured projection / evidence refs 才能支撑强验收。
- 用户级 browser 验收必须使用 Codex in-app browser，从默认聊天入口开始；系统浏览器、macOS `open`、外部 Chrome、Playwright 只能作为辅助诊断。
- 多 agent / 多 server 验收前必须做端口预检；并行实例端口按 `parallelProfile` 记录实际端口。
- 恢复上下文、续跑或总结时不得使用模板化“完成”结论替代真实工作；必须重新核对当前 git 状态、目标文件、测试输出、evidence 路径和用户最新意图。
- 验收必须从用户意图反推：每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`，不能写 `passed`。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。
- 已经完成的TODO需要打勾
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 代码路径保持唯一真相源：发现冗余链路时删除、合并旧链路，避免长期并行实现。
- 必须实现用户级验收：真正准确解决了用户的问题、优化用户体验


## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口，概括 SciForge GUI-as-TUI-extension 的总原则、权威文档列表和核心边界。
- [`docs/Architecture.md`](docs/Architecture.md)：当前总架构真相源，定义 GUI、TUI agent host、native extensions、desktop packaging 和职责归属。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：当前 TUI/GUI 协议真相源，规定 GUI 输入必须变成终端等价文本，TUI 通过只读 GUI resources 和 `gui.*` intent tools 感知/驱动 GUI。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native extension 归属说明，明确 capability discovery、harness/policy、provider route、verifier、skill promotion、Computer Use 和 repair 的 Codex 原生归属。
- [`docs/Usage.md`](docs/Usage.md)：当前可运行代码的启动、配置、运维、workspace 产物和迁移期兼容路径说明，不能把其中的旧 AgentServer 路径当作最终架构。
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)：Runtime Codex 迁移路线，定义 `codex exec --json`、profile 隔离、DeepSeek/provider proxy、native resume 和桌面 productization gate。
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)：Codex CLI 兼容层说明，记录不 fork Codex、运行期隔离、DeepSeek streaming tool-call 修复、事件分层和升级检查清单。

## 当前基线

已知阻塞：

- `npm run smoke:runtime-provider-preflight` 在 service env 注入 `SCIFORGE_RUNTIME_API_KEY` 和 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` 后返回 `ready`。provider proxy `GET /healthz?check=upstream` 会在 live default-chat 前把 upstream 状态分成 `config-missing`、`provider-auth`、`rate-limited`、`upstream-outage`、`repo-bug` 或 `ready`，并对 raw body/header/token 做 scrub；ignored `.sciforge` config 中的 secret-like fallback 仍只能作为本地 provider proxy 调试 fallback，不能满足 browser/release acceptance。
- `SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance` 已于 2026-05-20 通过；证据写入 `docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json`、DOM/screenshot 和 `live-browser-acceptance-passed-20260520.md`。live default-chat command ids 包括 single-turn `codex-command-mpdcm8jt-fncfjd`、native resume recall `codex-command-mpdcmhbp-arg0xq`、artifact creation `codex-command-mpdetnoh-kiygex` 和 selected follow-up `codex-command-mpdeum7v-q0u93x`；selected refs 为 `.sciforge/artifacts/live-selected-report-20260520b.md` 与 `artifact:live-selected-report-20260520b`，最终 visible answer 为 `green-phase`。
- `npm run smoke:runtime-codex-browser-acceptance:strict` 是 release gate 的共享 browser 子门；当前 strict browser gate 已通过，但 `npm run verify:single-agent-release` 仍必须继续 desktop package gate、R-* 任务级 live evidence 和后续 release 检查。默认 `npm run verify:single-agent-final` 只证明离线 contracts 与 fail-closed evidence，不等于 release pass。
- Runtime Codex native assistant message 可以作为前台可见回答呈现，但现在标记为 `visible-not-live-acceptance`，`liveAcceptanceEligible: false`；只有 `gui.present` / structured projection / evidence refs 才能支撑强 live acceptance。selected artifact follow-up 的 native resume session id 现在优先来自 selected artifact/object lineage，找不到时才 fallback latest run。
- 历史 live browser run 曾记录 provider `502` 或 `Runtime Codex exited with code 1`，这些只保留为历史失败/修复前 evidence；当前通过证据必须以 2026-05-20 的 strict manifest、DOM、screenshot、selected refs 和 Runtime Codex audit bundle 为准。
- Desktop launcher、Electron main/preload production entrypoint、pure TS production shell 和 packaging preflight contracts 已存在；`desktop:build` 会生成 `dist-ui`、`dist-desktop`、`dist-desktop/preload.cjs` 和 bundled JS sidecars，`desktop:package:dir` 已生成 `dist-desktop-packages/mac-arm64/SciForge.app`，并串起 artifact inspection 与 packaged Electron lifecycle smoke。asar 内含 `dist-ui/index.html`、`dist-desktop/src/desktop/main.js`、`dist-desktop/preload.cjs` 和 bundled sidecars，且生产包检查会拒绝 `dist-desktop/**` compiled test/spec JS。`src/desktop/production-artifact-inspector.ts` 能无 secret 检查 `.app` / `app.asar`、packaged `package.json` main、compiled main/preload、renderer artifact hash、bundled sidecar ownership 和 no Vite dev URL。`npm run smoke:desktop-electron-lifecycle` 与 `npm run smoke:desktop-packaged-electron-lifecycle` 已证明 production/packaged window 从 build artifact cold start、使用动态端口、隔离 appData/workspace/log paths，并由 Electron main 启动 workspace server、provider proxy、Runtime Codex sidecar 且 clean shutdown；但还没有 packaged/production window 内真实 Runtime Codex 多轮任务、artifact follow-up 和 selected-artifact follow-up acceptance。
- AgentServer-first 代码路径仍是迁移债务；当前 `smoke:no-legacy-paths` 是 no-increase gate，不是完全移除证明。默认 `smoke:all` 和 `smoke:real-task-matrix` 不再直接运行 AgentServer-first smoke 脚本；旧覆盖隔离在显式 `npm run verify:legacy-agentserver-compat` / `npm run smoke:legacy-agentserver-compat`。`npm run smoke:runtime-codex-truth-source` 负责防止 package/docs/real-task matrix 层把 AgentServer 重新提升为 release truth source。
- `npm run smoke:real-task-matrix` 默认校验 31 个 R-* 与 `docs/test-artifacts/real-tasks/**/manifest.json` 的 evidence contract，并串联 no-secret offline gates；当前共享 browser acceptance 已通过，但这些 R-* 仍需要各自的三轮 live evidence 才能打勾。需要生成/刷新 ignored `blocked` scaffold 时显式运行 `npm run smoke:real-task-matrix:update`。任何 `passed` manifest 必须有三轮 live evidence、visible UI、audit refs、provider/model/profile 和 artifact 或 explicit no-artifact reason。
- `SA-WEB-20/21/22` 已补足 R-DATA-01/02/03 的 fixture-level 三轮覆盖：long-format messy CSV + covariate coefficient comparison、schema drift confounder reinterpretation、two-table lineage/reproducibility。它们是离线 web-e2e contracts，不是 live default-chat pass。
- `SA-WEB-23/24` 已补足 R-PROTO-02/03 的 fixture-level 三轮覆盖：progressive GUI resource probing 和 `gui.ask_user` clarification commandText 回灌。它们是离线 web-e2e contracts，不是 live default-chat pass。
- `SA-WEB-28` 已补足 R-PROTO-01 的 fixture-level 覆盖：open/retry/export/recover/delete 可见 GUI action 必须归约为 terminal-equivalent `commandText`，携带 refs/audit trace，不能带 hidden business payload 或 GUI 本地业务执行。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-29` 已补足 R-RESUME-01 的 fixture-level 覆盖：Runtime Codex 初始任务暴露 `codexSessionId` 和 artifact/ref，selected-artifact follow-up 的 `commandText` 只能包含新 user request + selected refs，不能 replay GUI transcript 或 full artifact body，并显式覆盖 native resume unsupported 时的 `blocked: unsupported resume`。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-30` 已补足 R-MEM-01 的 fixture-level 覆盖：长上下文和无关 literature/data artifacts 后，最终回答必须找回原始 constraint，且无关 artifact refs 不得污染 visible answer、visible artifacts 或 final audit refs。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-31` 已补足 R-LIT-01/R-LIT-03 的 fixture-level 覆盖：latest/today arXiv-style 检索记录 queries、candidate list、PDF/read state、blocked reasons、中文报告路径和 reorder axes；selected-report follow-up 必须证明 scoped 到 selected refs 而不是 latest artifact。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-32` 已补足 R-LIT-02/R-WEB-01 的 fixture-level 覆盖：arXiv/PubMed/Semantic Scholar/web 矛盾证据按 quality/confounder/dataset/replication risk 分层，dynamic web 表保留 fetched/rendered/Cloudflare/403/timeout/empty/cached fallback 状态，不能补写 blocked content。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-33/34` 已补足 R-CODE-01/R-CODE-02 的 fixture-level 覆盖：targeted failing test -> root cause -> generic source fix -> targeted rerun，不得改 output artifacts 伪装 source fix；dirty worktree repair 必须证明 user/protected files byte-stable 且没有 reset/revert。它们是离线 web-e2e contracts，不是 live default-chat pass。
- `SA-WEB-35` 已补足 R-METHOD-01/R-KG-01/R-BIO-01/R-VERIFY-01 的 fixture-level 覆盖：protocol v2 dependent artifacts、contradiction-aware evidence graph、single-cell reviewer rejection 和 verifier critique repair 都必须有 artifact/UI/audit refs 对齐。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-36` 已补足 R-CAP-01/R-SKILL-01/R-CU-01 的 fixture-level 覆盖：capability discovery 是 TUI-native plan，不是 GUI ranking 或 completion evidence；skill promotion 是 Codex-native skill/plugin/MCP/slash-command proposal；Computer Use raw refs 只能折叠进 audit evidence，React/UI 不得执行 Computer Use actions。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-37` 已补足 R-RUN-01/R-RUN-02/R-RESUME-02 的 fixture-level 覆盖：stale process cleanup、actual fallback port、browser refresh recovery、cancelled-run partial artifact、safe remainder continuation 和 GUI restore/native continuity distinction 都必须可断言。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-38` 已补足 R-BUDGET-01/R-SEC-01/R-AUDIT-01/R-FAIL-01 的 fixture-level 覆盖：Runtime Codex DeepSeek profile/provider/model/workspace/command transparency、silent OpenAI fallback fail-closed、raw stream/secret scrub、bounded failed-run audit export 和 provider outage fresh-dispatch recovery 都必须可断言。它是离线 web-e2e contract，不是 live default-chat pass。
- `SA-WEB-13` 已从 AgentServer route 语义迁移为 Runtime Codex/runtime-dispatch 或 blocked-with-evidence 语义；offline fixture 只保留兼容 run evidence，不是 release truth source。
- `smoke:real-task-offline-gates` 会串联 literature/web、data、code、scientific、capability/skill/CU、protocol、provider/security、run/resume/memory 和 desktop live-acceptance schema gate；`smoke:real-task-matrix` 现在会执行这些 no-secret R-* 类别 gate，而不是只检查脚本名，保证对应 R-* 不再只有任务板文字。
- Provider proxy 的 `/v1/responses`、`/v1/models`、`/v1/chat/completions` 非 2xx 上游错误必须返回 scrubbed public error 和 audit metadata，不能把 HTML/SSE/JSON provider body 或 credential headers 透传给前台。
- Runtime Codex audit bundle 必须写 bounded/scrubbed `manifest.json`、`raw-jsonl.scrubbed.jsonl`、`stderr.scrubbed.log`、`normalized-events.jsonl`；manifest refs 必须可解析且文件大小不能超过各自 maxBytes。
- `sciforge.service-lifecycle-evidence.v1` 已定义 R-RUN-01 的离线 service lifecycle evidence ledger，pass claim 必须记录 actual port、stale process cleanup 或 verified-not-running、port conflict recovery、code-change restart、readiness check 和 Codex in-app browser refresh；不能假定默认端口或缺浏览器刷新证据。
- `sciforge.cancellation-evidence.v1` 已定义 R-RUN-02 的离线 cancel/partial/safe-continuation ledger，第三轮 continuation 必须从 `safeRemainder` 计划，不能 boundaryless resume cancelled run。
- R-RESUME-02 的 `passed` evidence gate 现在必须同时记录 `restoredGuiStateSource` 和 Runtime Codex `nativeContinuity`，Projection-only restore 不能冒充 native resume continuity。
- `sciforge.desktop.live-acceptance-evidence.v1` 已定义 R-DESK-01/R-PKG-01 的 live desktop acceptance evidence ledger，pass claim 必须是 cold-started production Electron 或 packaged app、dist-ui renderer、带 provider/profile/model/workspace/command id 和 audit refs 的 Runtime Codex real task、selected-artifact follow-up、main/platform-owned sidecars、dynamic ports、app data/log paths 和 clean shutdown；production shell、packaging preflight 或 directory package artifact alone 必须 blocked。

执行规则：

- 当前任务板只保留真实多轮压测任务；能通过压测暴露并修复的问题，不再拆成重复的实现 TODO。
- 每个压测任务完成后直接把对应 `- [ ]` 改成 `- [x]`，并在该行或下一行补 evidence 路径、运行日期和最终状态。
- 每个失败压测都要产出一个可执行修复点；修复点进入代码和测试，不在 `PROJECT.md` 复制成另一套任务清单。
- 除非新的失败任务证明必要，不重开 worker branch 考古、大范围盲 rename/delete、seed/demo 成功声明、非 Codex browser acceptance 或 prompt-specific hardcode。

## 真实多轮压测任务板

所有任务默认从 Codex in-app browser 默认聊天入口 `http://localhost:5173/` 开始；标注 desktop 的任务除外。每个任务都是用户代理评估：评估者像真实用户一样操作，不调用内部 API，不用 seed/demo/fixture 代替成功。

通过条件：

- 至少三轮真实交互：初始目标、约束变化或追问、最终导出/验证/诊断。
- 创建对象的任务至少包含一次 selected ref 或 artifact follow-up。
- 如果 external retrieval/provider/runtime 失败，必须带 evidence 标为 `blocked` 或 `partial`。
- Pass 必须同时有 visible UI、workspace artifact 或明确无产物理由、audit refs、命令/测试输出；缺一项不能打勾。
- 修复必须泛化到 task type、provider、artifact name 和用户输入变化，不能硬编码当前案例。

### 文献与外部证据

- [x] R-LIT-01 当日 arXiv agentic RL 全文报告：检索今日或最新 `agentic RL` 论文，下载 PDF，阅读全文，写中文报告；第二轮按方法、环境/任务、证据强度、benchmark、局限性重排；第三轮导出 search queries、PDF/read 状态、blocked reasons 和 artifact path。必须明确 live/cached/failed 状态，UI 未展示 answer/artifact 或 artifact path 不存在时不能 pass。
  - 当前证据：p11 提供三轮 Runtime Codex、`gui.present`、visible DOM/截图/audit/artifact 证据；p12 补齐 live arXiv retrieval、7 篇 PDF 下载和 full-text extraction，并生成中文全文报告、重排报告、export status 和 final gate。根 manifest 已升级为 `passed`、`releaseEligible=true`、`readyForProjectCheckoff=true`，证据位于 `docs/test-artifacts/real-tasks/R-LIT-01/live-20260520-p11/` 与 `docs/test-artifacts/real-tasks/R-LIT-01/live-20260520-p12/`；`real-task-evidence-schema`、`smoke:real-task-literature-web-gates` 和 `smoke:real-task-matrix` 已通过。

- [x] R-LIT-02 多来源矛盾结论综合：围绕一个具体 biomedical 或 ML claim 同时查 arXiv/PubMed/Semantic Scholar/网页来源，找出相互冲突结论；第二轮要求按 evidence quality、confounders、datasets、replication risk 分层；第三轮改写成谨慎 grant proposal 结论并导出 citations。必须保留不确定性，不能把矛盾压平成单边结论。
  - 当前证据：p15 从 Codex in-app browser 默认聊天入口完成三轮 live Runtime Codex，最终 run `codex-command-mpe6w57l-dg3hmm` 通过 `gui.present` 展示 `R_LIT_02_GRANT_READY`，导出谨慎 grant conclusion、citations JSON/BibTeX 和 final status；根 manifest 状态为 `passed`、`releaseEligible=true`、`readyForProjectCheckoff=true`，证据位于 `docs/test-artifacts/real-tasks/R-LIT-02/live-20260520-p15/` 与 `workspace/parallel/r-lit-02-p15/`。

- [x] R-LIT-03 选中旧报告追问：同一 session 中创建或打开至少两个 literature reports，选中旧报告后询问只属于它的 PDF/full-text evidence status；第二轮切换 selection 后问同类问题；第三轮导出 evidence matrix 和 next papers。必须证明 follow-up scoped 到 selected refs，而不是 latest artifact。
  - 当前证据：p13 从 Codex in-app browser 默认聊天入口完成三轮 live Runtime Codex selected-report follow-up，同一 native session 中 old/new selected refs 分别生成 `gui.present`，arXiv PDF/abstract checks 返回 HTTP 200，第三轮导出 selected-scope audit、evidence matrix 和 next papers，`latestArtifactUsed=false`。根 manifest 已升级为 `passed`、`releaseEligible=true`、`readyForProjectCheckoff=true`，证据位于 `docs/test-artifacts/real-tasks/R-LIT-03/live-20260520-p13/` 和 `workspace/parallel/r-lit-03-p13/`；`smoke:real-task-literature-web-gates` 已通过。

- [x] R-WEB-01 Dynamic web 与 blocked evidence：请求一个需要 JS-rendered page 或 browser fetch 的事实核查；第二轮与另一个来源对照；第三轮导出 fetched/rendered/blocked/cached evidence 表。Cloudflare、403、timeout、空页面和 cached fallback 必须显式标注，不能补写不存在的页面内容。
  - 当前证据：p19 从 Codex in-app browser 默认聊天入口完成三轮 live Runtime Codex，runs `codex-command-mpe797i0-fkjzez`、`codex-command-mpe7bfhw-k7h9x6`、`codex-command-mpe7j5o9-ydgmz9` 均 `done/0` 且 `gui.present applied=true`，最终展示 `R_WEB_01_P19_FINAL_TABLE_READY` 并导出 fetched/rendered/blocked/cached evidence table；p17 normalized table 作为 supporting evidence 保留真实 timeout/blocked rows 且 `extractedSignals=null`，未补写 blocked content。根 manifest 状态为 `passed`、`releaseEligible=true`、`readyForProjectCheckoff=true`，证据位于 `docs/test-artifacts/real-tasks/R-WEB-01/live-20260520-p19/`、`workspace/parallel/r-web-01-p19/` 和 supporting `workspace/parallel/r-web-01-p16-or-new/.sciforge/artifacts/r-web-01-p17-final-evidence-table.normalized.json`。

### 数据、统计与可复现分析

- [x] R-DATA-01 纵向 messy CSV 分析：上传或粘贴 subject/group/timepoint/batch/outcome 混乱表格，要求清洗、EDA、模型、图和脚本；第二轮加入 batch/timepoint covariates 并解释 coefficient changes；第三轮从生成脚本 rerun 并导出 report、cleaned data、chart。Statistics、chart 和 text 必须一致。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，runs `codex-command-mpdpjdp1-3uzm2m`、`codex-command-mpdpsadg-ipgwrb`、`codex-command-mpdpvgnx-cfmd57` 生成 cleaned CSV、EDA、初始 OLS、batch/timepoint covariate model、coefficient-change evidence、final report/chart/rerun log；`r-data-01-stats-consistency.json` 证明 final report、cleaned data、chart 和模型统计 13/13 一致，manifest、DOM/截图、command texts 和 selected-ref evidence 位于 `docs/test-artifacts/real-tasks/R-DATA-01/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-DATA-02 Schema drift 与因果重解释：先分析列名泛泛且有 missing values 的表；第二轮透露一列其实是 site/batch confounder 并要求重解释；第三轮导出 notebook-style method section。不得硬编码 treatment/placebo/biomarker 假设，必须说明哪些 earlier artifact refs 仍有效。
  - Evidence: `docs/test-artifacts/real-tasks/R-DATA-02/manifest.json`, live default-chat commands `codex-command-mpdksyog-0odklb`, `codex-command-mpdl092e-913njx`, `codex-command-mpdl2ugi-8zrj08`; selected ref `artifact:r-data-02-confounder-reinterpretation`, final `gui.present` marker `R_DATA_02_METHOD_READY`, and schema drift proof in `schema-drift-evidence.json`.

- [x] R-DATA-03 两表合并和 lineage：给两个字段不一致的数据表和后续映射规则，要求合并、异常检查、指标计算；第二轮修改 mapping 和过滤条件；第三轮导出 cleaned data、mapping artifact、lineage、复现命令。必须能从导出产物追溯每个最终列和过滤规则。
  - Evidence: `docs/test-artifacts/real-tasks/R-DATA-03/manifest.json`, live default-chat commands `codex-command-mpdm35ui-3qiut3`, `codex-command-mpdm6ylv-72d8pg`, `codex-command-mpdmv01u-xv8lx4`, `codex-command-mpdmzquu-nrof6o`, `codex-command-mpdn2dn1-lnxvoz`; failed provider/proxy attempts `codex-command-mpdmahtf-1yiqmb` and `codex-command-mpdmmsg2-iu7pde` were not reused as success evidence; final `gui.present` marker `R_DATA_03_LINEAGE_COLUMN_TRACE_READY`, lineage proof in `lineage-validation-evidence.json`.

- [x] R-DATA-04 大文件摘要和按需读取：要求分析大日志或大文本，只允许摘要、索引和 refs；第二轮追问某个异常片段；第三轮导出诊断和读取片段清单。不得把全文塞入 prompt 或 GUI transcript，必须按需读取 bounded refs。
  - Evidence: `docs/test-artifacts/real-tasks/R-DATA-04/manifest.json`, live default-chat commands `codex-command-mpdjz9kl-p6n5yz`, `codex-command-mpdk1od1-wzg90g`, `codex-command-mpdkgiwt-2zgdyb`; selected ref `artifact:r-data-04-snippet-diagnosis`, final `gui.present` marker `R_DATA_04_DIAGNOSTIC_READY`, and bounded read proof in `large-file-bounded-read-evidence.json`.

### 代码修复、仓库协作与运行生命周期

- [x] R-CODE-01 SciForge 自改进补丁：从一个真实 failing targeted test 或 browser failure 开始，要求诊断 root cause；第二轮要求只做通用最小修复并 rerun targeted test；第三轮输出 changed files、commands run、risk list、是否需要 broader tests。不得编辑 output artifacts 伪装 source fix。
  - 当前证据：p8 从 Codex in-app browser 默认聊天入口 `http://127.0.0.1:5174/` 完成三轮 live Runtime Codex：turn1 诊断真实 targeted failure 为 runtime projection `repair_needed` status 被 UI normalizer 丢弃；turn2 确认 `conversation-projection-view-model.ts` 的通用最小修复并 rerun `node --import tsx --test src/ui/src/app/projectionApi.test.ts` 9/9 通过；turn3 输出 changed files、commands run、risk list、broader tests 建议、command ids/audit refs、visible UI status 和 explicit no-artifact reason。根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-CODE-01/live-20260520-p8/`。

- [x] R-CODE-02 Dirty worktree 协作修复：预先存在用户未提交改动，再要求修复另一区域 failing behavior；第二轮用户修改约束或指出不可动文件；第三轮导出 diff summary 和未触碰用户改动证明。不得 reset/revert 用户改动。
  - 当前证据：p8 从 Codex in-app browser 默认聊天入口 `http://127.0.0.1:5174/` 完成三轮 live Runtime Codex：turn1 在 dirty worktree 中复现 targeted router failure 并确认 protected/user 改动边界；turn2 只修改 `workspace/parallel/r-code-02-p8/repair-owned/repairable-router.mjs` 并 rerun `node workspace/parallel/r-code-02-p8/repair-owned/repairable-router.test.mjs` 通过；turn3 导出 diff summary、untouched proof、forbidden-command audit、commands run 和 selected-ref exemption。`PROJECT.md` digest drift 被记录为外部并发漂移，未 reset/revert/checkout/restore；根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-CODE-02/live-20260520-p8/`。

- [x] R-RUN-01 服务生命周期和端口恢复：修改运行时代码后要求自动重启本地服务；第二轮制造端口占用或旧进程残留；第三轮验证新服务 ready、实际端口、browser 页面刷新和旧进程清理。必须记录实际端口，不能假定默认端口可用。
  - 当前证据：p5 三轮 live default-chat Runtime Codex 完成 runtime/service lifecycle code change、owned stale port recovery、browser refresh、readiness 和旧进程清理；canonical service lifecycle ledger validator 与 recovery plan 均通过，根 manifest 已通过 evidence schema、service lifecycle gate、run/resume/memory gate、real-task matrix 和 `git diff --check`。

- [x] R-RUN-02 Cancel、partial 和 safe continuation：启动会写文件或调用外部工具的长任务，中途 cancel；第二轮询问已完成、partial、不可逆 side effects；第三轮只继续 safe remainder 并导出 cancellation evidence。不能把 cancelled run 当成无边界 resume。当前证据：p2 三轮 live default-chat Runtime Codex 完成 user-visible cancel boundary、partial artifact、irreversible side effects、unsafe remainder 阻断和 safeRemainder-only continuation；根 manifest 已通过 evidence schema、run/resume/memory gate、real-task matrix 和 `git diff --check`。

### GUI/TUI 协议、多轮状态与用户交互

- [x] R-PROTO-01 Text-only GUI action contract：创建或打开 artifact 后用 open/retry/export/recover/delete 等可见 GUI action；第二轮询问发送给 Runtime Codex 的精确 command/ref；第三轮换 panel 或 selected object 重复并导出 action/audit trace。每个 GUI action 必须归约为 terminal-equivalent text，hidden business payload 失败。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，runs `codex-command-mpdo8l89-viuxn9`、`codex-command-mpdoc0hm-rljovx`、`codex-command-mpdof7rb-6jkja5` 生成 current/old report、action seed trace、exact command/ref trace 和 final action/audit trace；`gui-action-command-trace-evidence.json` 证明 open/retry/export/recover/delete 都是 `terminalEquivalent=true` 的 `commandText`，带 refs/auditTraceRef/dispatchRoute，且 `hiddenBusinessPayloadAbsent=true`、`localBusinessExecutionAbsent=true`、`artifactBodyAbsent=true`、`deleteFileAbsent=true`，manifest/DOM/截图/command texts 位于 `docs/test-artifacts/real-tasks/R-PROTO-01/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-PROTO-02 Progressive GUI resource probing：同屏生成多个 artifacts、messages、focused editor/composer state；第二轮问只需 shell/hot-region context 的 UI-state 问题；第三轮问需要 region detail 的窄问题并要求列出 resource reads。不得默认读取 full DOM/debug snapshots。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，runs `codex-command-mpdnbuzo-auwyzc`、`codex-command-mpdnfsyk-emj4su`、`codex-command-mpdnv0r6-kh1je4` 生成 alpha/beta/gamma artifacts、shell/hot-region audit 和 region-detail audit；`gui-resource-probing-evidence.json` 证明 resource reads 顺序为 `shell -> hot-region -> region-detail`、`fullDomRead=false`、`debugSnapshotRead=false`、`detailReadCount=1`，manifest/DOM/截图/command texts 位于 `docs/test-artifacts/real-tasks/R-PROTO-02/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-PROTO-03 `gui.ask_user` 澄清：提出有两种合理解释的任务，例如删除多个 artifacts 中的一个或选择 dataset；第二轮回答 GUI clarification prompt 后修改 constraint；第三轮输出 final artifact 和 decision log。澄清必须是 `gui.ask_user` 或等效 intent，user confirmation 必须以文本重新进入 TUI。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，runs `codex-command-mpdla92s-crqk0j`、`codex-command-mpdlh69c-nivd6m`、`codex-command-mpdlksvk-xx5q0h`、`codex-command-mpdlqr1r-gf4cjv` 生成 gui.ask_user 等效澄清 intent、文本重新进入的用户确认、final artifact 与 decision log；`gui-ask-user-equivalent-evidence.json` 证明 `userConfirmationCommandTextMatchesTurn2=true`、`localBusinessFunctionCalls=[]`、`appliedChoiceInGui=false`，manifest/DOM/截图/command texts 位于 `docs/test-artifacts/real-tasks/R-PROTO-03/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-RESUME-01 Native session resume 与 artifact follow-up：运行真实 Runtime Codex task 生成 artifact 并暴露 `codexSessionId`；第二轮选中 artifact 做依赖 prior reasoning 的 follow-up；第三轮要求 derived artifact 和 resume metadata。`commandText` 只能是新 user request 加 refs，不能 replay GUI transcript 或 full artifact body；native resume 不可用时必须 `blocked: unsupported resume`。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，最终 run `codex-command-mpdi2i13-xyxfie` 通过 native resume 延续 source session，selected refs 仅指向 `artifact:r-resume-01-clean-source`，生成 derived artifact 并呈现 `CLEAN_DERIVED_6_READY`；manifest、DOM/截图、`commandText`、resume metadata 和 selected-ref evidence 位于 `docs/test-artifacts/real-tasks/R-RESUME-01/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-RESUME-02 Browser refresh 与 cross-session recovery：长任务产生至少一个 artifact/ref 后刷新 browser 或开新 tab；第二轮从 restored session 继续同一目标并询问 current state summary；第三轮导出 final result 并验证不是只靠前端内存。必须区分 restored GUI state 和 Runtime Codex native session continuity。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，turn1 生成 `artifact:r-resume-02-refresh-source`，实际刷新 browser 后 turn2 通过同一 native `codexSessionId=019e438a-c988-7da2-a3c4-7c6202229710` 恢复并生成 `artifact:r-resume-02-restored-state`，turn3 选中该 ref 生成 final artifact 并呈现 `R_RESUME_02_FINAL_READY`；manifest、DOM/截图、`commandText`、native continuity evidence 和 selected-ref evidence 位于 `docs/test-artifacts/real-tasks/R-RESUME-02/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-MEM-01 长上下文约束稳定性：第一轮给一个具体原始 constraint；第二轮跑一个无关 literature/data task，制造 artifacts、failures 和长上下文；第三轮问“最初 constraint 是什么，当前结果是否遵守”。必须找回原 constraint，且无关 artifact refs 不得污染答案。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，turn1 记录原始 constraint，turn2 生成 literature/data/long-context noise artifacts 且保留同一 native `codexSessionId=019e4394-e0c3-7122-a573-ec4b346fd508`，turn3 未选择无关 refs 并以 prose-only `gui.present` 回答原始 constraint 和遵守状态；manifest、DOM/截图、`commandText`、long-context stability evidence 和 selected-ref policy 位于 `docs/test-artifacts/real-tasks/R-MEM-01/`，状态为 `passed`、`releaseEligible=true`。

### Provider、成本、安全与审计

- [x] R-BUDGET-01 Low-cost provider 透明度：在 runtime profile 为 `sciforge-runtime-deepseek` 时运行需要 tool use 和 visible artifact 的任务；第二轮询问 provider/model/profile/workspace/command id 以及是否联系 OpenAI；第三轮修改 budget/provider settings 并带 allow/deny condition retry。缺少 DeepSeek/proxy/profile 时必须 fail closed，禁止 silent OpenAI fallback。
  - 当前证据：2026-05-20 从 Codex in-app browser 默认聊天入口完成 task-specific live attempt，最终 run `codex-command-mpdisgl5-j39fdq` 通过 native resume 和 selected ref `artifact:r-budget-01-provider-audit` 验证 provider/model/profile/workspace/command id、`allowOpenAiRuntime=false` 下禁止 OpenAI fallback、low-cost budget retry allow/deny 条件，并生成 `R_BUDGET_01_BUDGET_RETRY_READY` 的 `gui.present`；manifest、DOM/截图、provider audit、budget retry 和 selected-ref evidence 位于 `docs/test-artifacts/real-tasks/R-BUDGET-01/`，状态为 `passed`、`releaseEligible=true`。

- [x] R-SEC-01 Secret 与 raw-stream scrub：触发 provider/config failure，产生 stderr、upstream SSE 或 HTML/error body；第二轮要求 user-readable diagnosis；第三轮导出 raw audit bundle 并提供 corrected config retry。API keys、token endpoints、raw provider bodies 和 plugin challenge HTML 不得进入 primary reply DOM。当前证据：p3 三轮 live default-chat Runtime Codex 完成 provider/config failure、user-readable diagnosis、scrubbed raw audit bundle 与 corrected config retry；primary DOM 与 scrubbed evidence 的 forbidden leak check 通过，根 manifest 已通过 evidence schema、provider/security gate、real-task matrix 和 `git diff --check`。

- [x] R-AUDIT-01 Failed-run audit export：创建带 stderr/raw JSONL 的 failed run；第二轮不 rerun，只要求解释失败、可复用文件和下一步；第三轮导出 audit bundle。Export 必须包含 run id、command id、provider/model/profile、evidence refs，且 refs bounded/scrubbed。当前证据：p5 三轮 live default-chat Runtime Codex 完成 failed-run audit export，scrubbed/bounded audit bundle 与 leak check 通过；根 manifest 已通过 evidence schema、provider/security gate、real-task matrix 和 `git diff --check`。

- [x] R-FAIL-01 Provider outage recovery：模拟或遇到 429/502/DNS/timeout；第二轮询问这是 repo bug、provider bug 还是 config bug；第三轮 provider 恢复或 config 变更后 retry。第一次 failure 必须是 repair-needed/blocked，recovery 不能复用 failed output 当 success evidence。当前证据：p4 三轮 live default-chat Runtime Codex 完成 provider 502 repair-needed、provider-gateway 分类和 fresh recovery；initial/recovery run 与 command id 均不同，`reusedFailedOutputAsSuccessEvidence=false`，根 manifest 已通过 evidence schema、provider/security gate、real-task matrix 和 `git diff --check`。

### 科研工作流、验证器与能力边界

- [x] R-METHOD-01 Protocol package reviewer loop：从 literature/data artifact 生成 experimental protocol package；第二轮修改 budget/timeline/exclusion criteria；第三轮导出 risk register、decision log、preregistration checklist。v2 必须一致更新所有 dependent files，旧值只能作为 history。
  - 当前证据：p8 从 Codex in-app browser 默认聊天入口完成三轮 live Runtime Codex：turn1 从 literature/data artifacts 生成 `r-method-01-protocol-package-v1`；turn2 修改 budget/timeline/exclusion criteria 并生成 v2；turn3 导出 risk register、decision log、preregistration checklist 与 dependent consistency proof。`dependent-file-consistency.json` 和 verifier 证明所有 current refs 指向 `artifact:r-method-01-protocol-package-v2`，旧 v1 值只作为 history/取代说明保留；根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-METHOD-01/live-20260520-p8/`。

- [x] R-KG-01 Biomedical evidence graph 更新：围绕 biomedical relation 生成 evidence graph、sources、confidence；第二轮加入 contradictory paper 或 condition；第三轮导出 evidence matrix 和 “what would change my mind”。Graph edges 必须有 evidence refs，contradictions 必须改变 confidence。
  - 当前证据：p12 三轮真实 Runtime Codex 通过 force-non-streaming provider proxy `http://127.0.0.1:3892/v1` 完成：turn1 生成 BRAF V600E metastatic melanoma evidence graph/sources/summary 且 PubMed E-utilities source retrieval `4/4` reached；turn2 加入 colorectal cancer contradiction sources `3/3` reached，pan-tissue claim confidence 从 `very_high` 降为 `medium`，melanoma-conditioned claim 保持 `very_high`；turn3 导出 evidence matrix 与 what-would-change-my-mind。三轮 `gui.present` 均 `applied=true`，根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-KG-01/live-20260520-p12/`。

- [x] R-BIO-01 Single-cell perturbation reviewer loop：生成 single-cell perturbation biomarker protocol 和 reviewer critique；第二轮要求 verification checklist 和 failure modes；第三轮 reviewer 拒绝关键 assumption 后修订 protocol package。没有 evidence 的 verification 不能 pass，修订不能只改 chat prose。当前证据：p4 三轮 live default-chat Runtime Codex 同一 native session 完成，turn3 使用 selected refs 修订 protocol package v2、failure modes 与 revision evidence；最终截图捕获超时已如实记录，最终状态由 DOM、Runtime manifest 与 artifact refs 证明；根 manifest 已通过 evidence schema、scientific gate、real-task matrix 和 `git diff --check`。

- [x] R-VERIFY-01 Verifier critique 不是 completion：生成带 validation criteria 的 analysis artifact；第二轮让 verifier critique/reject 一部分；第三轮 repair artifact 并解释 verification evidence 变化。Verifier output 是 evidence/critique，不是 completion；pass 需要 artifact、UI status、audit refs 对齐。当前证据：p3 三轮 live default-chat Runtime Codex 同一 native session 完成，turn2 verifier critique 为 `rejected` 且 `is_task_completion=false`，turn3 生成 repaired v2 artifact；证据包在 `docs/test-artifacts/real-tasks/R-VERIFY-01/live-20260520-p3/`，根 manifest 已通过 evidence schema、scientific gate、real-task matrix 和 `git diff --check`。

- [x] R-CAP-01 Capability discovery progressive disclosure：提出 required capability 不明显的任务；第二轮询问为何选某 tool/provider 及 alternatives；第三轮改用另一 capability route 继续。Capability discovery 必须是 TUI-native planning，不是 GUI ranking；discovery plan 不是 completion evidence。当前证据：p2 三轮 live default-chat Runtime Codex 同一 native session 完成，turn1/turn2 选择并解释 `tui-native-planner`，turn3 切换到 `workspace-ref-reader`；根 manifest 已通过 evidence schema、capability/skill/CU gate、real-task matrix 和 `git diff --check`。

- [x] R-SKILL-01 Skill promotion 作为 Codex-native artifact：完成一个可重复任务后要求 skill promotion proposal；第二轮修改 scope、safety gates、validation commands；第三轮询问安装/调用位置。Promotion target 必须是 Codex-native skill/plugin/MCP/slash command shape，workspace proposal 只是 staging evidence。当前证据：三轮 live default-chat Runtime Codex 均完成并保持同一 native session，最终 UI 展示 `R_SKILL_01_FINAL_READY`；证据包在 `docs/test-artifacts/real-tasks/R-SKILL-01/`，并通过 evidence schema、capability/skill/CU gate、real-task matrix 和 `git diff --check`。

### 桌面、Computer Use 与产品边界

- [x] R-CU-01 Computer Use evidence folding：执行需要 screenshot/GUI perception 或 desktop bridge evidence 的任务；第二轮要求解释感知、动作和 captured evidence；第三轮导出 audit 并验证 raw screenshots/log refs 折叠。React/UI 不得直接执行 Computer Use actions。当前证据：p6 三轮 live default-chat Runtime Codex 同一 native session 完成，final folded audit 证明 raw screenshot/runtime-log refs 均为 audit-only folded refs 且 `uiExecutedComputerUseActions=false`；最终截图捕获超时已如实记录，最终可见状态由 DOM 与前序 raw screenshots 证明，根 manifest 已通过 evidence schema、capability/skill/CU gate、real-task matrix 和 `git diff --check`。

- [x] R-DESK-01 Desktop cold-start 用户运行：从 cold start 启动 packaged 或 production-mode Electron app；第二轮运行真实 Runtime Codex task、打开 artifact、做 selected-artifact follow-up；第三轮退出并验证 clean shutdown。Renderer 必须加载 build artifact，不是 Vite dev URL。
  - 当前证据：p9 cold-started packaged Electron app `dist-desktop-packages/mac-arm64/SciForge.app`，renderer 加载 `app.asar/dist-ui/index.html` 而不是 Vite dev URL；在 packaged renderer 中完成真实 Runtime Codex task `codex-command-desktop-p9-packaged-real-task`，打开 `artifact:desktop-p9-live-report`，再用 `codex-command-desktop-p9-selected-artifact-followup` 完成 selected-artifact follow-up；退出后验证 Electron-main-owned sidecars clean shutdown、动态端口释放、appData/log refs 持久化。根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-DESK-01/live-20260520-p9/`。

- [x] R-PKG-01 不依赖 dev-server 的 desktop packaging gate：无 Vite dev server 启动 production-mode Electron 或 packaged app；第二轮验证 workspace server、provider proxy、Runtime Codex sidecar lifecycle；第三轮检查 logs、app data paths、fixed dev ports 不成为 production contract。Runtime sidecar lifecycle 必须由 Electron main/platform service 拥有。
  - 当前证据：p9 在无 Vite dev-server 条件下启动 packaged app，renderer 来自 `app.asar/dist-ui/index.html`，workspace server/provider proxy/Runtime Codex sidecars 由 Electron main 拥有并使用动态端口 `64523/64524/64525`；真实 Runtime Codex task、artifact open、selected-artifact follow-up、sidecar logs/appData paths 和 clean shutdown 都有持久证据。根 manifest 状态为 `passed`、`releaseEligible=true`，证据位于 `docs/test-artifacts/real-tasks/R-PKG-01/live-20260520-p9/`。

## 压测后的最低验证

- 文档或任务板修改：`git diff --check`。
- 代码修改：`npm run typecheck`、touched areas 的 targeted tests、`git diff --check`。
- Runtime/GUI/acceptance 修改：再跑 `npm run smoke:runtime-provider-preflight`、`npm run smoke:runtime-codex-browser-acceptance` 和至少一个匹配 touched area 的 R-* 真实 browser 压测。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档

- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- Git history 保存已删除 source files 和旧 task logs。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
