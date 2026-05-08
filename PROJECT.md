# SciForge - PROJECT.md

最后更新：2026-05-08

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- Python conversation-policy package 是多轮对话策略算法的唯一真相源；TypeScript 只能保留 transport、runtime 执行边界和 UI 渲染，不再维护一套并行的策略推断算法。
- 当 senses、skills、tools、verifiers、ui-components 增多时，主 agent 只消费 capability broker 生成的紧凑 capability brief；能力模块默认是 typed service/adapter，只有开放式、多步推理模块才声明内部 planner/小 agent，UI components 只负责按 schema 渲染。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。
- Computer Use 必须走 window-based 主路径：观察、grounding、坐标映射和动作执行都绑定目标窗口/窗口内容坐标，而不是全屏全局猜测；并行长测必须隔离目标窗口、输入通道和 trace，不抢占用户真实鼠标键盘。

## 任务板

### T093 Python Conversation Policy 与 Capability Broker 模块化改造

状态：已完成。承接已合并到 `docs/Architecture.md` 的多轮对话恢复与 Capability Broker 设计。目标是把多轮对话策略、历史恢复、引用摘要、验收恢复和能力选择从 TypeScript runtime 里的散落规则，逐步迁移为可分工、可测试、可审计的 Python policy engine；TypeScript 保留 UI、stream、workspace writer 和 AgentServer 调用壳。

核心原则：

- Python 负责算法：goal snapshot、context policy、memory/retrieval、reference digest、artifact index、capability broker、handoff plan、acceptance、recovery、process events。
- TypeScript 负责工程壳：React UI 状态、HTTP/stream/abort、workspace writer、AgentServer payload、结果渲染和 Python bridge。
- 主 agent 不读取完整 capability registry，只读取 broker 生成的少量 capability brief。
- 能力模块默认是 typed service/adapter；内部 LLM/小 agent 只用于 GUI/vision/computer-use、复杂文献检索、代码修复、多步实验设计等开放式复杂模块，并且必须藏在稳定 schema 后面。
- UI components 不做推理，只声明可渲染 artifact/schema，由 runtime 根据 broker 和 artifact type 选择。
- 所有 Python/TS 交互走版本化 JSON contract；runtime 主路径直接应用 Python policy response，旧 TS 策略启发式不再保留。

Todo：

- [x] 新建 `packages/conversation-policy-python/`：包含 `pyproject.toml`、`src/sciforge_conversation/`、`tests/fixtures/`，先实现 `contracts.py`、`service.py` 和 request/response schema version。
- [x] 实现 `goal_snapshot.py`、`context_policy.py`、`memory.py`：覆盖新任务隔离、继续上一轮、修复上一轮、显式引用优先、历史污染防护。
- [x] 实现 `reference_digest.py`、`artifact_index.py`：支持 Markdown/PDF/JSON/CSV/path refs 的 bounded digest，输出 clickable/ref-safe artifact index，不直接把长正文塞进 handoff。
- [x] 实现 `capability_broker.py`：读取 capability manifest，按 prompt/goal/refs/场景/风险/成本/历史信号筛选 top-k，输出 compact brief、excluded reasons 和 audit trace。
- [x] 实现 `handoff_planner.py`、`acceptance.py`、`recovery.py`：把 handoff budget、必需 artifact、markdown report/ref 验收、silent stream、missing output、repair/digest recovery 做成 Python 决策。
- [x] 实现 `process_events.py`：把 raw backend/tool/workspace 事件归纳为用户可读阶段，保证多轮长任务能看到“正在读什么、写什么、等待什么、下一步是什么”。
- [x] 增加 TS bridge active mode：TypeScript runtime 调用 Python policy engine，并把 Python response 写回 context/handoff/digest/capability/acceptance/recovery 运行态。
- [x] 增加测试：Python fixture unit tests、golden tests、过去失败场景 regression、TS bridge smoke、长任务多轮对话 smoke。
- [x] 更新文档：把真实 contract、manifest 字段、迁移开关、fallback 策略和调试方法同步到 `docs/Architecture.md` 与 `docs/Extending.md`。

验收标准：

- [x] Python package 可独立运行单测，不依赖真实 AgentServer 或前端页面。
- [x] TS runtime 主路径调用 Python policy；浏览器端不再维护 goal/context/memory/reference digest/acceptance 的并行算法。
- [x] capability brief 小而可解释；主 agent 不需要看到完整 registry 才能选择能力。
- [x] 默认能力模块没有内部 agent；只有 manifest 明确声明 `internalAgent` 的复杂能力可以使用内部 planner/小 agent。
- [x] 用户可见过程信息从 raw stream 变成稳定阶段模型，长任务不会只显示永久 running。
- [x] 覆盖关键回归：上下文隔离、继续上一轮、显式 refs、digest recovery、缺 markdown report、silent stream、运行中追加引导。
- [x] `npm run typecheck -- --pretty false`、相关 TS smoke、Python pytest/golden tests 均通过。

### T092 双实例 Agent 互修与稳定同步

状态：进行中。本任务取代此前内嵌 Repair Agent System 方案。SciForge 不再在单个运行中的应用里放置一个自修复 agent，也不再让反馈收件箱直接启动内嵌修复 runner。新方向是维护两个彼此独立、地位并列的 SciForge Agent/App 实例：一个稳定实例可以修复另一个实例的代码，被修复的一方可以变动，执行修复的一方必须保持稳定；当双方都通过核验后，用户或主 Agent 可以显式把较新的稳定版本同步给落后的一方。用户体验上采用“修改方主对话栏交互式修复，被修改方反馈收件箱结构化沉淀结论”的模式：A 的主聊天栏选择目标实例 B，用户用自然语言引导 A 修复 B 的 issue；B 的反馈收件箱只展示修复状态、diff/commit、测试证据、人工核验结论和 GitHub 同步结果。

核心原则：

- 双实例并列：例如 Main Agent 和 Repair Agent 都是完整 SciForge 应用/agent 实例，拥有独立进程、端口、workspace writer、状态目录、日志、配置和 git worktree；真实互修优先使用 `SciForge-A/` 与 `SciForge-B/` 两个 git worktree，而不是只在同一个 checkout 内创建两个 workspace 子目录。
- 修复别人时自己稳定：A 修复 B 时，A 的运行代码、执行器、权限策略和配置不得被本次任务修改；B 修复 A 时同理。
- 交替修复：允许 A 修 B，也允许 B 修 A，但每次只能由当前稳定的一方执行修复。
- 显式同步：只有修复完成、测试证据充分、人工核验或自动核验通过后，才能把最新稳定版本复制/同步给另一方；同步不是运行中自动漂移。
- 反馈收件箱降级为 handoff：反馈收件箱继续负责收集评论、页面定位、运行时上下文和 GitHub Issue 同步，但不再内嵌 Repair Agent 面板或直接执行修复。
- 对话栏承担交互：复杂澄清、修复策略选择、重试和用户纠偏都发生在执行方 A 的主对话栏；被修改方 B 不弹出小型 agent 工作台。
- 结构化 API 优先：A 不通过视觉/DOM 探索 B 的页面来找 issue，而是读取 B 暴露的 instance manifest、feedback issue、handoff bundle 和 repair result API。

Todo：

- [x] 删除单实例内嵌 Repair Agent 代码路径，包括 `repair-agent-system/`、反馈卡片修复按钮、Repair Agent 面板、Workspace Writer repair endpoint、runner contract 和相关样式。
- [x] 定义双实例开发配置契约：`agentId`、`role`、`appPort`、`workspaceWriterPort`、`workspacePath`、`repoPath`、`stateDir`、`logDir`、`configLocalPath`、`counterpart`；由 Workspace Writer manifest 和 dev env/profile 暴露，后续 UI peer settings 可复用。
- [x] 定义 peer instances 配置与设置页 UI：保存 Main/Repair/Peer 实例的 `name`、`appUrl`、`workspaceWriterUrl`、`workspacePath`、`role`、`trustLevel` 和 `enabled`。
- [x] 支持开发环境同时启动两个独立 SciForge 实例，并确保端口、状态目录、workspace writer、runtime session 和日志互不共享；`npm run dev:dual` 默认从 `SciForge-A/` 与 `SciForge-B/` worktree 启动，A 使用 `5173/5174` + `.sciforge-a/`，B 使用 `5273/5274` + `.sciforge-b/`。
- [x] 文档明确 worktree-first 推荐部署：`SciForge-A/` 与 `SciForge-B/` 各自运行一份应用，`workspacePath` 指向对应 worktree 根目录，AgentServer 默认共享 `18080`。
- [x] 增加 worktree-first 开发脚本与 smoke：`npm run worktree:dual -- status|create|clean` 支持检测/创建/清理 `SciForge-A` 与 `SciForge-B`；`npm run smoke:dual-worktree-instance` 临时创建双 worktree、启动 A/B writer，并验证 manifest repo root、workspacePath、stateDir、configLocalPath 和跨实例写入隔离。
- [x] 实现互修 handoff 协议与 runner contract：`executorInstance`、`targetInstance`、`targetWorkspacePath`、`targetWorkspaceWriterUrl`、`issueBundle`、`expectedTests`、`githubSyncRequired`；稳定实例 A 可通过 `/api/sciforge/repair-handoff/run` 接收 B 的 issue bundle，在 B repo 下创建 `.sciforge/repair-worktrees/<run>` 与 `codex/repair-handoff/...` 隔离分支/worktree，使用目标 worktree 作为 AgentServer `cwd/workingDirectory` 执行修复、测试、diff/patch 证据收集，并写回 B 的 `/repair-result`。
- [x] Runner 明确 fail-closed：`targetWorkspacePath` 不能等于或包含/被包含于 executor repo/worktree，且不能与 executor `stateDir`、`configLocalPath`、`logDir` 相交；runner 自身测试日志和 patch artifact 不混入业务 changed files。
- [x] Runner 输出结构化 result：`summary`、`changedFiles`、`diffRef`、`refs.patchRef`、`testResults`、`humanVerification`、`executorInstance`、`targetInstance`、隔离 branch/worktree metadata；目标实例 `/repair-result` 保存 `diffRef` 和 `commit` 字段。
- [x] 给主对话栏增加 Target Instance 选择器：默认当前实例，可选择 Peer 实例；选中 Peer 后，聊天任务明确标记为“读取并修改目标实例 workspace”。
- [x] 主对话栏支持从目标实例拉取 issue：用户可说“修复 B 的反馈 #id / GitHub #number”，A 通过 B 的结构化 API 获取 issue、页面定位、截图证据、GitHub 元数据和验收要求，并在 AgentServer payload 中携带可调用的 repair handoff runner endpoint/contract。
- [x] 被修改方反馈收件箱增加 handoff / repair result 状态：展示 `assigned`、`analyzing`、`patching`、`testing`、`needs-human-verification`、`fixed`、`blocked`、`github-synced`。
- [x] 实现目标实例 API：`GET /api/sciforge/instance/manifest`、`GET /api/sciforge/feedback/issues`、`GET /api/sciforge/feedback/issues/:id`、`POST /api/sciforge/feedback/issues/:id/repair-runs`、`POST /api/sciforge/feedback/issues/:id/repair-result`。
- [x] 实现 GitHub 回写链路：被修改方收到 repair result 后，把摘要、changed files、测试结果、人工核验结论和 commit/PR/patch ref 追加到关联 GitHub Issue；不自动关闭 Issue；未配置 token 时 fail-safe 标记 `skipped` 并记录原因，不提交真实 token。
- [x] 实现稳定版本注册表：记录每个实例的稳定 commit、版本、测试结果、promotedAt、来源实例和同步状态；`promote` 必须显式确认且有测试证据。
- [x] 实现显式稳定同步计划动作：`sync-plan` 只生成 diff、测试要求、备份点和回滚说明，不写入目标实例，不自动漂移。
- [x] 在 UI 中把“修复”改为“交给另一实例处理”或同类 handoff 入口，展示目标实例、当前状态、测试证据、GitHub 回写结果和下一步，而不是展示内嵌 Repair Agent 过程。
- [x] 增加 focused smoke：`npm run smoke:repair-handoff-runner` 模拟 A 执行 B 的修复，确认写入发生在 B 的 isolated repair worktree，不发生在 A 或 B 当前 checkout，并验证 executor 路径 fail-closed；`npm run smoke:dual-worktree-instance` 覆盖双 worktree writer 隔离。
- [x] 更新 README 的 worktree-first 运行说明、环境变量示例、smoke 命令和故障排查；后续真实互修、核验、同步和回滚说明随 handoff / stable registry 落地继续补充。

验收标准：

- [x] 单实例应用中不再出现内嵌 Repair Agent runner、repair endpoint 或自修复面板。
- [x] 两个实例可以并行运行，且配置、端口、状态目录、日志互不污染。
- [x] 当前稳定实例可以对另一个实例的代码做真实修改，并输出 diff、测试日志和结论；已通过 `npm run smoke:repair-handoff-runner` 验证 A 修 B 的真实 isolated worktree 路径。
- [x] 默认 dev profile 和 smoke 覆盖 worktree 模式：验证 `workspacePath` 指向两个不同 git worktree 根目录时，A 写 B 的 repair result / patch artifact 不会污染 A，B 写 A 同理；已运行 `npm run typecheck`、`npm run smoke:dual-instance`、`npm run smoke:dual-worktree-instance`。
- [x] 用户可以在 A 的主对话栏选择 B 作为 Target Instance，并通过一句自然语言触发对 B 的指定反馈/GitHub Issue 修复。
- [x] B 的反馈收件箱能在无需用户复制粘贴的情况下看到 A 写回的结构化修复结论、测试证据和 GitHub 同步状态。
- [x] 任一实例修复另一个实例时，自己的运行代码和稳定版本注册信息不会被本次修复任务改写；runner 对 executor repo/worktree、stateDir、configLocalPath、logDir 执行 fail-closed 边界检查。
- [x] 同步较新稳定版本必须是显式动作，并且有测试证据、备份和回滚说明；当前实现提供显式 `promote` / `sync-plan`，不自动应用同步。

### T088 长文件语义模块化治理

状态：已完成。本任务承接 PROJECT.md 的代码膨胀治理原则：源码文件超过 1000 行进入 watch list；超过 1500 行必须有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。拆分必须按职责命名，不能机械拆成 `part1/part2`；如果短期无法完全解耦，也要先拆出有语义的文件并保持主入口只做流程编排。本轮已完成三个 blocker 文件的语义拆分，所有非生成源码主文件均低于 1500 行。

#### 当前超阈值文件
- `src/runtime/generation-gateway.ts`：已从约 4213 行降到约 1412 行；AgentServer context window、prompt/config、direct answer payload、payload validation、artifact reference context 和 run output parsing 已拆到 `src/runtime/gateway/*` 语义模块。
- `src/ui/src/app/SciForgeApp.tsx`：已从约 2332 行降到约 1363 行；`Sidebar`、`TopBar`、`SettingsDialog` 已拆到 `src/ui/src/app/appShell/ShellPanels.tsx`。
- `src/ui/src/app/ResultsRenderer.tsx`：已从约 2254 行降到约 1438 行；workspace object preview 已拆到 `src/ui/src/app/results/WorkspaceObjectPreview.tsx`，execution/evidence/notebook 面板已拆到 `src/ui/src/app/results/ExecutionNotebookPanels.tsx`。
- `packages/skills/catalog.ts`：约 6855 行，属于生成 skill catalog，维持 `tools/check-long-file-budget.ts` 中的 generated-file exemption，不手工拆分。

#### Watch list
- `src/ui/src/styles/app-04.css`：约 2130 行，已采用 app style 分片，但仍需继续按页面/组件职责收缩。
- `src/ui/src/styles/app-05.css`：约 1708 行，已采用 app style 分片，但仍需继续按页面/组件职责收缩。
- `src/ui/src/app/ChatPanel.tsx`：约 1453 行，接近强制任务阈值，后续新增逻辑前应先抽出 composer、run status、handoff/trace 子模块。
- `src/ui/src/styles/app-03.css`：约 1389 行，继续 watch。
- `src/runtime/workspace-server.ts`：约 1372 行，继续 watch，后续 server route 增长应抽 route/diagnostics 模块。
- `src/ui/src/api/sciforgeToolsClient.test.ts`：约 1320 行，继续 watch，后续按 runtime events、workspace files、task attempts、artifact IO 分测试文件。
- `src/ui/src/styles/app-01.css`：约 1165 行，继续 watch。
- `tools/longform-regression.ts`：约 1133 行，继续 watch，后续按 prepare/status/validation/reporting 拆工具模块。
- `tests/smoke/smoke-vision-sense-runtime-bridge.ts`：约 1078 行，继续 watch，后续按 contract fixtures、runtime bridge、trace validation 拆测试 helper。
- `tests/smoke/smoke-browser-workflows.ts`：约 1073 行，继续 watch，后续按 browser harness、reference workflows、assertions 拆 helper。
- `src/ui/src/app/Dashboard.tsx`：约 1002 行，继续 watch，新增 dashboard 逻辑前先抽 panel/section 子组件。

#### TODO
- [x] 拆分 `src/runtime/generation-gateway.ts`：保留 gateway 主入口只做 request orchestration；抽出 AgentServer request/response adapter、context compaction/handoff builder、artifact normalization、backend failure recovery、acceptance repair rerun、stream event translation 和 diagnostics 子模块。当前已拆出 `agentserver-context-window.ts`、`agentserver-prompts.ts`、`direct-answer-payload.ts`、`payload-validation.ts`、`artifact-reference-context.ts` 和 `agentserver-run-output.ts`；`npm run smoke:runtime-gateway-modules` 通过。
- [x] 拆分 `src/ui/src/app/SciForgeApp.tsx`：保留 App shell 只做顶层状态组装和路由；抽出 workspace/session state hooks、Scenario Builder wiring、runtime settings panel、context window meter、tool/skill selection、run lifecycle controls 和 layout/navigation 子组件。当前已抽出 app shell panels，主文件降到 1500 行以下；`npm run typecheck -- --pretty false` 通过。
- [x] 拆分 `src/ui/src/app/ResultsRenderer.tsx`：保留 renderer 主入口只做 artifact/view dispatch；抽出 execution unit renderer、artifact card renderer、trace/vision preview、failure diagnostics、research artifact views、table/graph/chart previews 和 reusable result shell。当前已抽出 workspace object preview、uploaded data URL preview、evidence matrix、execution panel 和 notebook timeline，主文件降到 1500 行以下；`npm run typecheck -- --pretty false` 通过。
- [x] 复查现有 CSS 分片：`src/ui/src/styles/app-01.css` 到 `app-06.css` 不能只是体积切片，后续应逐步迁移为按 app shell、chat panel、results renderer、scenario builder、dashboard、shared controls 命名的语义样式文件；当前记录为 watch list，后续触碰样式大块时按语义文件名迁移并配 browser smoke。
- [x] 对 `src/ui/src/app/ChatPanel.tsx`、`src/runtime/workspace-server.ts`、`tools/longform-regression.ts` 和大型 smoke/test 文件建立后续拆分任务；当前均低于 1500 行并记录在 watch list，任何新增功能若让它们越过 1500 行，必须先补 PROJECT.md 任务或同步抽模块。
- [x] 运行 `npm run smoke:long-file-budget` 并保持通过；后续每次新增超过阈值的源码文件，都必须在 PROJECT.md 记录语义拆分计划或在 `tools/check-long-file-budget.ts` 中给出明确生成文件豁免。

#### 验收
- [x] `npm run smoke:long-file-budget` 通过，并在输出中将 1500 行以上非生成源码标记为 tracked。
- [x] 三个 blocker 文件均有落地拆分 PR/commit：`src/runtime/generation-gateway.ts`、`src/ui/src/app/SciForgeApp.tsx`、`src/ui/src/app/ResultsRenderer.tsx` 主文件分别降到 1500 行以下。
- [x] 拆分后的模块命名全部按职责表达，不出现 `part1` / `part2` / `chunk` 这类无语义名称。
- [x] 相关 focused tests、typecheck 和必要 smoke 通过；用户可见行为保持一致。已运行 `npm run typecheck -- --pretty false`、`npm run smoke:long-file-budget`、`npm run smoke:runtime-gateway-modules`。
