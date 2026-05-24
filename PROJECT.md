# SciForge 项目协议

最后更新：2026-05-24

当前目标：把 SciForge 的 `注释` 能力收敛为一条 **连续反馈体验**。用户在工作台和非工作台页面都可以点选多个 UI 对象，把它们作为 `※1`、`※2` 这类引用 token 进入反馈侧栏。侧栏负责说清楚问题、对象关系和验收意图，也可以承载低风险即时小改动；反馈收件箱负责复杂改动的管理、确认、审计、GitHub 同步和 Runtime Codex repair。即时修改不是独立模式，只是侧栏里的 low-risk quick action；高风险或范围不清的请求必须进入收件箱。

## 当前决策

- `注释` 按钮打开全局注释侧栏，而不是把注释讨论塞进工作台主聊天框。
- 工作台本身也是可注释页面；主聊天栏、结果面板、左侧项目树、设置入口和反馈收件箱都只是可被引用的对象。
- 工作台和非工作台页面使用同一套反馈流程：点选对象 -> 侧栏澄清意图/关系 -> 预览、小改动或送入收件箱。
- 注释侧栏不是第二套对话系统。它是主对话能力的 intent-first projection：UI 容器独立，对话接口和会话逻辑复用主 conversation kernel。
- 注释侧栏可以复用现有 `SciForgeReference`、引用 token、stream/event 展示、截图/DOM target、feedback evidence bundle 和 feedback inbox 数据模型；不要复制一套引用、证据或聊天协议。
- `annotation-plan-only` envelope 仍用于“整理/预览/保存反馈”这条无副作用 lane。
- `annotation-quick-action` envelope 用于侧栏里的低风险即时小改动：只能处理单对象、局部、可解释、可回退的小范围 copy/style 类请求；不能 GitHub sync、commit、push、PR、merge 或启动 repair handoff。
- 范围不清、跨对象关系、跨文件推理、外部同步、repair、批量操作和高风险写入必须进入反馈收件箱确认。
- Agent 应鼓励澄清，可以提出 1-3 个短问题，也可以给出 2-3 个选择项和自由输入；用户可以跳过讨论直接保存。

## 当前事实

SciForge 当前路线是 **反馈收件箱优先，Runtime Codex/Codex CLI 后端修复，GUI 作为 TUI extension 和 repair control surface**。

核心架构：

- Codex CLI / TUI 拥有 agent 逻辑、上下文、记忆、工具、插件、修复和执行。
- SciForge GUI 是翻译壳、观察层和可复用展示层，不是 agent host。
- GUI -> runtime 只发送 terminal-equivalent text command。
- runtime -> GUI 只返回 normalized events、audit events 或 intent-based `gui.*` results。
- GUI 可以做 deterministic presentation behavior，不能做 provider route、capability ranking、repair policy、prompt assembly 或 completion 判断。
- 多轮对话以 Codex CLI thread/session 为权威状态源；SciForge 只保存 thread id、attempt id、UI metadata 和 evidence refs，继续对话时调用 Codex 原生 resume，而不是拼 GUI transcript。
- `docs/` 是产品/架构/协议/用法真相源；backend runtime migration 真相源是 `packages/backend/CodexRuntimeMigration.md`。
- 短中期桌面化选择 Electron；Tauri 只作为 runtime launcher、app data、secret storage 和 platform service 稳定后的长期优化项。


## 不可妥协原则

- 用户级 browser 验收必须使用 Codex in-app browser，从真实可见入口开始；系统浏览器、macOS `open`、外部 Chrome 只能作为辅助诊断。
- 每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`。
- 所有修改必须通用，不能为当前案例写硬编码补丁。
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成的 TODO 需要打勾，并补充 evidence、日期和最终状态。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-as-TUI-extension 总架构。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影和执行边界。
- [`docs/FeedbackInboxDesignPrinciples.md`](docs/FeedbackInboxDesignPrinciples.md)：反馈收件箱设计原则。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：provider route、verifier、repair 等能力归属。
- [`docs/Usage.md`](docs/Usage.md)：当前启动、配置、运维和 workspace 产物说明。

## 当前基线

- 顶部已经有可见 `注释` 按钮和页面元素选择层。
- 当前注释模式可以高亮目标、采集 target snapshot、生成本地 feedback bundle、保存到反馈收件箱。
- 右键仍可打开原有单对象反馈评论表单。
- 最近同步点 `bbde383` 已推送到 `origin/dev`，包含当前工作区状态和基础多对象引用改动。
- 现有工作台主聊天仍是执行/研究入口；接下来要把注释讨论从主聊天入口中解耦，统一进入全局侧栏。

## 当前任务板：全局注释侧栏

### AN-01 全局侧栏信息架构

- [x] 设计并实现全局 `AnnotationSidebar` 容器，在任何页面打开后固定显示在右侧或等价侧栏区域。
- [x] 顶部展示反馈流状态、当前页面 URL/route 和退出/收起控制。
- [x] 侧栏中展示已引用对象 chips，chip 显示 `※n`、对象标题、类型和移除按钮。
- [x] 侧栏底部提供简洁输入框和保存/放弃/继续澄清入口。
- [x] 工作台主 composer 在注释模式下不承载注释讨论，只显示必要提示或保持不干扰。
- [x] 侧栏输入和消息列表复用主对话 composer/message/stream 模型的能力边界，避免实现第二套聊天状态机。

### AN-02 统一对象引用采集

- [x] 注释模式左键点选任意页面对象，连续加入侧栏引用区并分配稳定 `※n` token。
- [x] 右键保留“添加精准反馈评论”的能力，但默认路径是加入侧栏引用区。
- [x] 支持引用工作台内部对象，包括主聊天消息、结果面板、左侧项目树、设置按钮和反馈收件箱条目。
- [x] 移除或迁移当前“点选后写入主 composer”的工作台专属行为，避免两套注释入口。
- [x] 引用对象继续使用 `SciForgeReference` 和现有 scrub/safe reference 策略。

### AN-03 Intent-First 讨论与动作协议

- [x] 给注释侧栏建立反馈状态机：drafting、clarifying、ready-to-save、saved、discarded。
- [x] 定义 `annotation-plan-only` conversation envelope，复用主对话 kernel 的 session、references、guidance queue 和 structured events。
- [x] 为主 conversation kernel 增加 annotation-plan-only policy：只允许澄清、选择题、摘要和 feedback draft，不允许进入执行/repair/code path。
- [x] 定义 `annotation-quick-action` lane：低风险小改动可从侧栏启动，但不能 GitHub sync、commit、push、PR、merge 或 repair handoff。
- [x] 明确复杂 side effects 边界：范围不清或高风险请求必须进收件箱确认和审计。
- [x] 允许 agent 生成澄清问题、选择题和需求摘要，但输出必须保持为 feedback draft。
- [x] 选择题 UI 支持 2-3 个推荐选项和自由输入，适合“像 Claude 一样”连续澄清。
- [x] 用户可以随时跳过澄清，直接把当前描述和引用保存为反馈草稿。

### AN-04 反馈收件箱沉淀

- [x] 保存时生成结构化 feedback record：引用对象列表、原始用户描述、澄清问答摘要、修改建议、验收标准、页面 URL、selector/DOM path、截图 refs。
- [x] 在反馈收件箱中区分 `annotation-plan` 来源和传统单对象 comment。
- [x] 反馈条目默认处于 open/draft-ready 状态，不自动 repair。
- [x] 从反馈收件箱启动 repair/code 必须有显式按钮和确认边界。
- [x] GitHub issue sync 只发送 scrubbed summary 和公开 evidence refs，不发送 raw transcript 或 secret。

### AN-05 视觉与交互细节

- [x] 侧栏宽度、层级和移动端行为不能遮挡关键页面内容；窄屏可转为底部 sheet。
- [x] 注释模式 hover highlight、selected outline 和侧栏 chips 需要颜色/编号一致。
- [x] 提供清晰文案：“先说清楚，再选择下一步”。
- [x] 支持 Esc 退出注释模式，但不丢弃已写草稿，除非用户选择放弃。
- [x] 保存成功后给出反馈收件箱入口和本地 evidence 状态。

### AN-06 数据与持久化

- [x] 为注释侧栏草稿定义最小持久化模型，避免刷新或页面切换时丢失关键草稿。
- [x] 草稿中保存引用对象、用户输入、澄清问答和 evidence refs，避免保存 raw DOM 或敏感 provider/runtime 内容。
- [x] 如果页面切换，侧栏保留草稿并标注原始页面 URL。
- [x] 截图和 target evidence 继续复用现有 `captureFeedbackScreenshotEvidence` / feedback bundle 写入路径。

### AN-07 测试与验证

- [x] Unit/model tests：引用加入、移除、token 分配、草稿状态机、quick-action 风险判断和 plan-only side-effect guard。
- [x] Component tests：侧栏渲染、选择题、保存/放弃、工作台和非工作台一致行为。
- [x] Feedback inbox tests：annotation-plan record 入队、展示、repair 显式启动边界。
- [x] `git diff --check`。
- [x] `npm run typecheck`，如被已有无关错误阻塞，需要记录具体错误和归属。
- [x] Codex in-app browser 验收：在工作台页面和至少一个非工作台页面各完成一次点选、多对象讨论、保存到反馈收件箱。

### AN-08 文档与收敛

- [x] 更新 `docs/FeedbackInboxDesignPrinciples.md`，说明全局注释侧栏和 feedback inbox 的关系。
- [x] 更新 `docs/Architecture.md` 或 `docs/TuiGuiProtocol.md`，说明反馈侧栏、quick action 和收件箱执行边界。
- [x] 删除或归档与主 composer 注释讨论相关的旧文案，避免用户误解。
- [x] 更新 smoke/verification docs，明确 browser 验收必须覆盖工作台和非工作台页面。

### AN-09 Evidence（2026-05-24）

- [x] Targeted tests passed: `node --import tsx --test src/ui/src/feedback/AnnotationSidebar.test.tsx src/ui/src/feedback/annotationPlanModel.test.ts src/ui/src/feedback/FeedbackCaptureLayer.test.tsx src/ui/src/app/sciforgeApp/FeedbackInboxPage.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts src/ui/src/themeTokens.test.ts`（pass 54 / skipped 13 / fail 0）。
- [x] `git diff --check` passed。
- [x] `npm run typecheck` 已执行并记录阻塞：当前失败来自既有 desktop preload / production shell planner / workspace-directory-picker test / ShellPanels sidebar project + sidebar model test / smoke-sidebar-project-switch / vite config 类型问题，和本轮 annotation sidebar 改动无直接归属。
- [x] Codex in-app browser 验收通过：工作台页面和反馈收件箱页面都完成了注释侧栏点选、保存，并在反馈收件箱中看到 `annotation-plan` record。
- [x] 侧栏遮挡修复已验收：桌面端 `AnnotationSidebar` 为 right sidecar，latest browser geometry 显示 `mainRight=630`、`sidebarLeft=630`、`position=relative`、`overlap=false`、`.feedback-layer` `pointer-events=none/background=transparent`。
- [x] 侧栏输入复用 `ChatComposer` shell 和 `MessageContent` 展示，隐藏上传/点选/收起/resize 等执行型 chrome，保留主 composer 的输入、快捷发送和 disabled 边界。
- [x] 侧栏澄清回合接入 `runPromptOrchestrator` 的 `annotation-plan-only` 分支，只把 intent draft 写回侧栏，不污染主 workbench session。
- [x] `runPromptOrchestrator` 增加 `annotation-plan-only` 本地 policy：看到 turnMode/envelope 后只返回 plan draft event/message/run，不做 target lookup、preflight compaction、runtime transport 或 repair stage；malformed envelope fail-closed。
- [x] `sendSciForgeToolMessage` 增加 transport fail-closed guard：任何漏到 Codex Runtime transport 的 `annotation-plan-only` 请求直接拒绝，测试证明 turnMode-only、envelope-only 和 malformed envelope 都未发生 fetch。
- [x] 反馈侧栏新增 action ladder：保存反馈、预览修改、应用小改动、复杂改动进收件箱；小改动使用独立 quick-action 风险判断和 action log。
- [x] 清理旧 `.annotation-field` CSS，并修正 light theme 下 `.feedback-layer` 不再绘制全屏 overlay，避免视觉遮挡页面。
- [x] Codex in-app browser 复验：侧栏澄清展示 `注释计划` stream/event 和 `runtime transport ... skipped`，保存后反馈收件箱出现 `annotation-plan local feedback-mpj5oebe-ouqn2h`。

## 验证规则

- 文档或任务板修改：`git diff --check`。
- 代码修改：`npm run typecheck`、touched areas 的 targeted tests、`git diff --check`。
- 反馈收件箱、GitHub sync 或 repair backend 修改：再跑匹配 touched area 的 targeted tests，并用 Codex in-app browser 完成至少一条用户级验收。
- Runtime/Codex CLI/provider 修改：再跑 `npm run smoke:runtime-provider-preflight`，并证明 Codex CLI backend 被调用，不能 silent fallback 到当前 Codex App 或其他 provider。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档说明

- 旧 Codex realtime session、terminal viewer、repair terminal 和真实多轮压测任务已从 active board 删除；当前状态由 Git history、相关 docs 和 commits 保留。
- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
