# BioAgent - PROJECT.md

最后更新：2026-04-30

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；BioAgent 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；BioAgent 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 seed skill 候选。
- 开发者不应为一次任务缺口手工写死专用科研脚本；只能补通用协议、权限、安全边界、runner 能力、context contract、promotion 机制和 UI/artifact contract。
- TypeScript 主要负责 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排；科学任务执行代码优先作为 workspace-local Python/R/notebook/CLI artifact 生成。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。

## 任务板

### T047 Runtime Task 生成化与 AgentServer Context Contract

状态：已完成。

#### TODO
- [x] 删除已提交的 `src/runtime/python_tasks/` 任务脚本和 Python cache，并在 `.gitignore` 中禁止再次提交 `__pycache__/`、`*.pyc`。
- [x] 将 `skills/seed/*/skill.json` 中指向源码 Python 脚本的 `workspace-task` entrypoint 迁移为 generated capability / `agentserver-generation` contract。
- [x] 收敛 `workspace-runtime-gateway` 中按 skill id 分支执行固定 Python 文件的逻辑，只保留通用 workspace/evolved skill runner 与 AgentServer generation/repair runner。
- [x] 定义并实现 `contextEnvelope` 构造器，作为 AgentServer generation 和 repair 请求的统一上下文输入。
- [x] `contextEnvelope` 必须包含 project facts、workspace facts、scenario facts、session facts、recent messages、artifact refs、ExecutionUnit/code/log refs、priorAttempts、expected artifact/UI contracts。
- [x] 同一 session 首次调用 AgentServer 时就发送稳定的 workspace/project/session facts，避免 AgentServer 反复探索 `.bioagent` 结构、task I/O 协议和当前项目要求。
- [x] 让 BioAgent sessionId 映射到稳定的 AgentServer agent/session/native backend session；优先复用 Codex/Claude/Gemini 原生多轮 thread/session，而不是每轮新建 stage session。
- [x] AgentServer adapter 层支持 session-scoped native session 缓存，并保留 resume/read/compact/close 生命周期入口；只有跨 backend stage、一次性审查或显式隔离任务才使用 stage-scoped ephemeral session。
- [x] 将 `contextEnvelope` 持久化或可诊断化到 `.bioagent/debug/agentserver-*`，便于排查 context 丢失、事实不一致和无效探索。
- [x] 更新多轮 context 策略：最近 N 条消息作为 short-term memory；workspace session/artifact/execution/attempt refs 作为 long-term memory；合并时以 workspace refs 为事实来源。
- [x] 增加测试：同一 session 中第二轮“继续/修复/文件在哪里”请求必须携带上一轮 artifact refs、codeRef、stdoutRef、stderrRef、taskResult refs 和 sessionId。
- [x] 更新 README 和 UI fallback 文案，把“seed executable skill / 改用 seed skill”改为“workspace capability / generated task / evolved skill”。
- [x] 用 browser smoke 验证工作台/Settings/Workspace/Timeline/Builder/mobile 关键路径；用 AgentServer generation smoke 验证一轮生成任务和一轮继续/查询文件位置的多轮上下文链路。

### T048 AgentServer 长任务上下文与通用多轮执行闭环

状态：已完成（协议与自动化验证完成；真实在线模型 Browser E2E 仍取决于用户侧模型配置可用性）。

#### TODO
- [x] 将 `turns.jsonl` 明确为冷的原始审计账本：只用于追溯、恢复、范围读取和诊断，不作为每轮请求的完整热上下文输入。
- [x] 将 `current.jsonl` 明确为热的有界工作上下文：每轮 backend 调用只接收经过筛选、压缩和引用化的当前状态。
- [x] 所有大体积内容必须 artifact/ref 化：任务脚本、PDF、报告、stdout/stderr、大 JSON、tool result 不得完整内联进 active context。
- [x] 为每个任务产物记录稳定 artifact refs：包含路径、类型、来源 run/turn、摘要 preview、大小/hash、生成状态和可恢复信息。
- [x] 多轮追问优先从 artifact refs、execution refs、workspace refs 回答，例如“文件在哪里”“继续上次任务”“报告在哪”“修复上一轮失败”不得重新套模板或无依据重跑。
- [x] 接入 AgentServer context snapshot：BioAgent 不再自行拼接模板化历史，而是使用 AgentServer Core 提供的 session context、recent turns、persistent/memory、artifact refs 和 operational guidance。
- [x] 所有用户可见回答必须经过 agent backend 判断生成；BioAgent 只负责路由、上下文准备、执行恢复、artifact 展示和错误诊断，不返回预设模板式最终答案。
- [x] 生成任务代码后必须继续执行到用户目标完成：代码生成只是中间步骤，成功条件以 expected artifacts、报告内容、文件落盘和 UI contract 满足为准。
- [x] 失败必须进入下一轮上下文：保留 failureReason、attempt history、代码路径、输入路径、stdout/stderr refs、recoverActions 和 nextStep。
- [x] 支持 checkpoint/resume：长任务在 stage/run 边界持久化进度，AgentServer 或 backend 断开后可从 refs 和 checkpoint 继续，而不是丢失上下文。
- [x] 实现通用 compaction 策略：按 token 压力和语义安全点生成 partial/full compaction tag，记录被压缩 turn range、保留事实、约束、文件引用和恢复路径。
- [x] 区分 AgentServer Core 与 backend harness：Core 提供通用 context/ref/ledger contract；prefix/work/stable/dynamic 等 harness 策略只作为 backend 内部实现，不强制所有 backend 采用。
- [x] 首轮 AgentServer 调用必须发送稳定事实：workspace root、项目原则、artifact contract、runner contract、当前 sessionId、已有 refs 和用户目标，减少 backend 重复探索。
- [x] 增加端到端测试：真实多轮复杂任务必须完成“检索/下载/阅读/生成报告 -> 用户追问文件位置 -> 用户要求补充报告字段 -> backend 基于上一轮产物继续修改”。
- [x] 增加可靠性测试：模拟 AgentServer 重启、stream 断开、大 stdout、大报告、大 turns log，确认不会 OOM，且后续多轮可恢复。
- [x] 增加非文献场景测试：至少覆盖一个非 arXiv/论文任务，验证方案不是特定任务补丁，而是通用多轮执行能力。

#### 完成记录
- AgentServer `turns.jsonl` 写入大 turn 时生成可恢复 `contentRef`，`current.jsonl` 自动保持有界热窗口，并为移出的 turn range 写入 `partial_compaction` tag。
- BioAgent 在 generation / repair / context-answer 请求中接入 AgentServer Core `/context` snapshot，并将 ToolPayload artifacts 持久化为 `.bioagent/artifacts/*.json` 稳定 refs。
- 多轮 artifact/location/report follow-up 默认经 AgentServer context-answer 判断；正常用户可见回答不得回退到本地模板。
- 修复跨场景 artifact 串扰：同一 workspace 内不同 domain 不会误用 unrelated artifact refs。
- 验证：BioAgent `npm run verify:fast`；AgentServer `npm test`、`npm run build`、`npm run smoke:agent-server`；两边 `git diff --check`。

### T049 UI Capability Registry、UI Design Studio 与 Runtime View Planner

状态：首版已实现（运行期 view-plan-first、模块匹配诊断、runtime contract schema、AgentServer `displayIntent` 契约和 UI Design Studio MVP 已落地；完整可视化 authoring/publish 流程继续作为后续增量）。

#### 背景
- 当前结果视图仍偏向 `Scenario defaultSlots` / `UIManifest slots` 的堆叠展示，用户本轮真正想看的结果不够突出。
- 当用户提出跨场景或此前没见过的展示需求时，例如“展示 PDB 蛋白质结构”“给我易读 Markdown 报告”“把证据和结构联动起来”，结果区可能把 artifact 塞进不匹配的 slot，出现 empty paper-list、原始 JSON、低优先级关键信息淹没等问题。
- 设计文档要求“UI 跟 artifact 和 UIManifest 走，LLM 只生成结构化调用，不生成页面”。因此解决方向不是为每个需求写死页面，而是把用户展示意图编译成可校验、可降级、可复现的 UI module / view plan。
- 核心原则：动态发生在 UI 设计期，真正多轮科研运行期只做已发布 UI 模块的选择、组合和 artifact binding。

#### 目标
- 结果区优先呈现用户本轮明确要求的核心结果，而不是机械展示所有 slot。
- 用户可以先和 agent 设计自己需要的 UI；设计确认后发布成版本化 UI module package，后续多轮任务只复用这些模块。
- 运行期 AgentServer 只做三件事：判断当前目标需要什么展示能力；从已发布 UI 模块库中选择、组合、绑定 artifact；模块不足时触发可恢复的 `blocked-awaiting-ui-design`。
- 对 PDB/AlphaFold/结构坐标、Markdown 报告、证据矩阵、ExecutionUnit、日志和未知 artifact 都有稳定展示路径。
- 任何缺失字段、组件不支持或 artifact 不存在，都要显示明确原因和可恢复动作，不使用 demo 数据或空结果伪装成功。

#### 三层架构
- `UI Capability Registry`：保存已发布的 UI module package、view preset、artifact schema、view schema、交互能力、版本和迁移记录。模块必须 artifact-first，不按 prompt 关键词声明能力。
- `UI Design Studio`：用户和 agent 先对话设计展示页面，选择输入 artifact schema、组合组件、配置字段映射和交互，用 fixture 预览并通过 smoke 后发布模块。
- `Runtime View Planner`：运行期只执行 `DisplayIntent -> UI module matching -> artifact binding -> ResolvedViewPlan`，不临场发明 UI，也不生成未验证 React 代码。

#### UI Module Package Contract
```text
ui-module/
  module.json          # 模块 manifest、能力、版本、角色、fallback、安全边界
  artifact.schema.json # 接受什么 artifact type、必需字段、字段映射
  view.schema.json     # 支持什么展示参数，如 colorBy/highlightResidues/layoutMode
  interactions.json    # 能发出/接收什么交互事件
  renderer             # 受控渲染实现，优先内置组件/低代码 DSL
  fixtures/            # 示例数据，用于预览和 smoke
  tests.json           # contract/smoke 测试
  preview.md           # 给用户看的说明
```

#### 运行期规则
- `UI Module = 展示能力`，`View Preset = 模块的一种轻量配置`；常见布局优先沉淀为 preset，避免模块库膨胀。
- 模块声明消费 artifact type 和必需字段，例如 `structure-summary` 需要 `pdbId` 或 `dataRef`；用户怎么说由 AgentServer 理解，UI 怎么渲染由 artifact contract 决定。
- 运行期 `DisplayIntent` 必须引用 required artifact types、preferred modules、fallback acceptable modules、layout preference 和 acceptance criteria。
- 若无法匹配已发布模块，当前 run 写 checkpoint 并进入 `blocked-awaiting-ui-design`，打开 UI Design Studio；用户发布模块后按 `resumeRunId` 恢复原任务。
- 老 run 必须固定使用当时的 `moduleId@version`；模块 schema 变化需要 migration，不能破坏历史结果复现。
- 模块生命周期：`draft -> validated -> published -> deprecated`；团队高频展示需求从临时设计沉淀为标准模块或 view preset。
- 动态 UI 代码是最后路径：已有 UI module -> 新 View Preset -> 低代码/声明式 UI module -> sandboxed dynamic plugin。plugin 必须有 sandbox、权限、测试和回滚。
- 结果区从“slot-first 渲染”改成“view-plan-first 渲染”：首屏展示 primary result，其后是 supporting evidence、execution/provenance、raw inspector。
- fallback ladder：specialized scientific component -> generic visualization -> data-table/markdown-viewer -> file/log/JSON inspector -> empty state with explicit reason。

#### 完成记录
- 已在 UI domain 中加入 `UIModuleManifest`、`ViewPreset`、`DisplayIntent`、`ResolvedViewPlan`、module lifecycle 和 view section 类型，先建立 TypeScript contract。
- 已实现运行期 `UI Capability Registry` 首版，内置 report、protein structure、paper cards、evidence matrix、execution provenance、timeline、data table 和 generic inspector 模块。
- 已实现 `resolveViewPlan()`：按 active run artifacts / DisplayIntent / scenario default slots 生成 primary、supporting、provenance、raw 分区，并记录 module binding、missing fields、fallback reason 和 recoverActions。
- 结果区已改为 view-plan-first：首屏显示 Runtime View Planner 摘要、primary result、supporting evidence、provenance/raw；错配时自动选择更合适模块，不再让结构 artifact 作为 paper-list 主结果。
- 已加入 `UI设计` tab 和 UI Design Studio MVP：展示 module package contract、DisplayIntent、当前匹配状态和已发布模块表；模块不足时显示 `blocked-awaiting-ui-design` 风格的可恢复 blocker。
- 已增强 `molecule-viewer`，支持 `structure-summary`、`structure-3d-html`、`pdb-structure`、`protein-structure`、PDB/UniProt/dataRef/htmlRef 等结构输入，并对 HTML 结构视图使用 sandboxed iframe。
- 已增强 report/Markdown 路径，对 `research-report`、`markdown-report` 和 `.md` dataRef 优先展示可读文档壳，不把 AgentServer payload 直接暴露成主结果 JSON。
- 已新增 `runtimeContracts.ts`，登记 `UIModulePackage`、`DisplayIntent`、`ResolvedViewPlan` 和 `ObjectReference` schema，并用 smoke 覆盖 contract 校验。
- 已扩展 AgentServer/BioAgent ToolPayload：运行期可返回 `displayIntent`，BioAgent 将其持久化到 run raw 并由 Runtime View Planner 消费。
- 已保留 T050 删除状态；本轮没有引入长期 coding/guardian agent 复杂度。

#### TODO
- [x] 定义 `UIModuleManifest` / `ViewPreset` / `UIModuleLifecycle` / `DisplayIntent` / `ResolvedViewPlan` TypeScript 类型。
- [x] 建立 `UI Capability Registry` 首版：索引 module capabilities、artifact schema、view params、role defaults、fallback、安全边界和版本信息。
- [x] 建立 `UI Design Studio` MVP 页面：展示 module package contract、DisplayIntent、模块匹配状态和已发布模块表。
- [x] 补齐 `UIModulePackage` / `DisplayIntent` / `ResolvedViewPlan` JSON Schema，并把 schema 校验纳入 smoke。
- [ ] 将 UI Design Studio 从 MVP 扩展为完整 authoring：支持和 agent 对话生成 UI module 草案、选择 artifact schema、拖拽/组合组件、字段映射、交互配置、fixture 预览和发布。
- [x] 将 AgentServer 输出 contract 扩展为可选 `displayIntent`，要求它引用 artifact refs、artifact types 和 module capabilities，而不是凭关键词路由或临场生成 UI。
- [x] 实现 `resolveViewPlan()`：从 `DisplayIntent` / active run artifacts / scenario defaults 匹配已发布 UI module，绑定 artifacts，并输出 primary/supporting/provenance/raw 分区。
- [x] 实现 artifact/component/module 匹配校验首版：模块只能消费 manifest 声明支持的 artifact type；错配时降级到合适 fallback，并给出原因和 recoverActions。
- [x] 增强 `molecule-viewer`：支持 `structure-summary`、PDB ID、mmCIF/PDB `dataRef`、HTML 结构视图 ref；首屏优先展示结构而不是 paper empty state。
- [x] 增强 `report-viewer` / Markdown 路径：把 research-report、Markdown file ref、sections、agentserver report payload 渲染成易读文档壳，避免原始 JSON 成为主视图。
- [x] 增加 active run 结果区摘要：首屏显示 Runtime View Planner、核心 artifact 状态、主要查看组件和缺失项。
- [x] 增加结果区诊断面板：展示每个 slot 为什么被选中、绑定了哪个 artifact、字段是否满足、fallback 原因和 recoverActions。
- [x] 收窄运行期 supplemental artifact 生成：follow-up 只补当前 AgentServer 任务声明的 `expectedArtifacts`，避免被场景默认全量目标拖偏。
- [ ] 实现完整 `blocked-awaiting-ui-design` run lifecycle：当没有模块满足展示需求时 checkpoint 当前 run，打开 UI Design Studio，发布模块后按 `resumeRunId` 恢复。
- [ ] 实现 UI module 版本锁定与 migration 记录：历史 run 继续使用原 module version，schema 变化必须可迁移或保留旧渲染路径。
- [ ] 增加用户可调 UI：组件显隐、排序、聚焦、布局密度、保存/恢复 view preset；用户调整只影响 view state，不修改 artifact 原始数据。
- [ ] 增加 UI module lifecycle 测试：`draft -> validated -> published -> deprecated`，并验证团队共享模块不会破坏已有 run。
- [ ] 增加 browser E2E：用户在文献场景中要求“查 PDB 并在右侧可视化 3D 结构”，结果区必须优先展示结构查看器或清晰 fallback，不得出现 paper-list empty 作为主结果。
- [ ] 增加 browser E2E：用户要求“生成易读 Markdown 报告”，结果区必须展示 Markdown 文档视图，而不是原始 JSON 或低可读 payload。
- [ ] 增加 unknown-demand smoke：用户提出未注册展示需求时，系统必须走 `DisplayIntent -> module match -> blocked-awaiting-ui-design 或 fallback ladder`，稳定显示可解释状态和下一步建议。

### T051 Codebase Slimming 与 Workspace Runtime Retention

状态：已完成（workspace 产物已清理；task input compact/retention、workspace prune、UI registry 去重和首轮模块拆分已落地）。

#### 背景
- 本轮审查发现项目源码并不是主要体积来源；`workspace/.bioagent/task-inputs` 曾累计到约 50G，主要来自多轮复杂任务中大 JSON / referenced artifact input 反复落盘。
- 代码层面存在若干长期维护风险：`App.tsx`、`styles.css`、`workspace-runtime-gateway.ts` 过大；UI component/artifact capability mapping 在 UI registry、scenario compiler、tool client 和 runtime gateway 中存在重复真相源。
- 瘦身目标不是删除能力，而是减少重复路径、让运行期产物有保留策略，并把大内容改成 artifact/ref 化。

#### TODO
- [x] 清空 `workspace` 运行期产物，保留 `workspace/README.md` 与 `workspace/.gitkeep`。
- [x] 为 `.bioagent/task-inputs` 增加通用 retention：默认最多保留 160 个输入文件或 1GiB，总是保护当前任务输入；长期配置写入 `config.local.json` 的 `bioagent.taskInputRetention`，临时覆盖支持 `BIOAGENT_TASK_INPUT_MAX_FILES` / `BIOAGENT_TASK_INPUT_MAX_BYTES`。
- [x] 增加 task-input retention smoke，验证旧输入会被裁剪、当前/受保护输入不会被误删。
- [x] 将大型 task input 进一步改为 compact manifest：只保存 prompt、artifact refs、字段摘要、hash/size 和恢复路径；不得把完整大 artifact 重复内联到每轮输入。
- [x] 增加 `workspace:prune` 命令：可按目录、mtime、大小和 run/session 范围清理 `.bioagent/task-results`、`logs`、`debug`、`task-attempts`、`versions`。
- [x] 抽出 UI capability registry 唯一真相源：`App.tsx`、`componentElements.ts`、`bioagentToolsClient.ts` 共享 `uiModuleRegistry.ts` 中的 module capability、accepted artifact types 和 output artifact types。
- [x] 拆分 `src/ui/src/App.tsx` 首轮：抽出 runtime UI module registry；保留现有 `ChatPanel`、`ResultsRenderer`、`UIDesignStudioPanel`、`ArtifactInspectorDrawer` 等命名组件边界，避免本轮把 UI 行为重写成高风险大迁移。
- [x] 拆分 `src/ui/src/styles.css` 首轮：抽出 `styles/base.css` 承载字体、tokens、global reset 和 keyframes；业务样式继续保留现有选择器，避免视觉回归。
- [x] 拆分 `workspace-runtime-gateway.ts` 首轮：抽出 `workspace-runtime-events.ts`、`workspace-task-input.ts`、`workspace-retention.ts` 和 `tools/prune-workspace.ts`，让 gateway 不再持有事件发送、输入 compact、保留策略和清理命令。
- [x] 增加体积/重复度守门：`smoke:workspace-retention` 覆盖 20 轮模拟任务，检查 `.bioagent/task-inputs` 不会随大 artifact 线性膨胀到超过阈值。
- [x] 清理忽略目录中的大型测试产物：删除 `docs/test-artifacts/deep-scenarios` 与 T050 临时截图，只保留已跟踪的代表性 browser smoke artifacts。

#### 完成记录
- `workspace` 从约 51G 清到 4K；`docs/test-artifacts` 从约 73M 清到 824K。
- 新增 `buildWorkspaceTaskInput()`：大型 artifact data、长字符串、长 priorAttempts 会被替换为 compact manifest、hash、size、preview 和 refs。
- 新增 `workspace:prune` / `tools/prune-workspace.ts`，支持 dry-run / `--apply`、`--targets`、`--keep-days`、`--max-bytes`、`--run`、`--session`。
- 新增 `uiModuleRegistry.ts`，区分 `acceptsArtifactTypes`（UI 可消费）与 `outputArtifactTypes`（运行期 expected artifacts），避免 registry 抽取后把支撑输入误当作任务产出。
- 新增 `smoke:workspace-retention`，覆盖 retention、input compaction、20-run bounded growth 和 prune command。

### T052 Object Reference Interaction 与按需结果打开

状态：首版已实现（object refs 可由 AgentServer 返回并自动索引 artifacts；chat chips、右侧按对象聚焦、pin/compare 首版、Workspace Open Gateway 和安全 smoke 已落地；历史 retention 恢复提示继续后续增强）。

#### 背景
- 当前结果区已从 slot-first 收敛到 view-plan-first，但仍主要由系统自动选择右侧主视图；复杂任务里用户未必想立即看所有 artifacts。
- 更自然的交互方式是：Agent 在回答中引用关键对象，用户点击对象后再决定在右侧栏查看、用系统默认应用打开，或打开所在文件夹。
- 这能让对话保持简洁，让右侧结果栏从“自动堆叠结果”变成“用户当前关注对象的工作面板”。
- 该能力必须建立在稳定 object/ref contract 上，不能回到关键词路由，也不能让前端直接打开任意本地路径。

#### 目标
- Agent 回答可以包含可点击对象引用，例如 `PDB 7RPZ`、`research-report.md`、`evidence-matrix`、`task result folder`、`PPT draft`、`Word report`。
- 点击对象时，BioAgent 根据对象类型、artifact contract、UI module capability 和安全策略选择动作：右侧聚焦、Artifact Inspector、系统默认打开、Reveal in Finder、pin/compare。
- 右侧栏默认只显示当前选中的对象及其关联上下文；其它对象以 inline chips、引用列表或“更多对象”形式存在。
- 对象引用必须跨多轮、跨刷新、跨历史 run 可复现：同一个对象绑定 `runId`、`artifactId`、`version`、`dataRef`、`hash/size` 和 provenance。
- 外部打开必须经过受控 `Workspace Open Gateway`，只允许 workspace 内可信 artifact/ref；高风险文件类型需要阻止或确认。

#### Object Reference Contract
```json
{
  "id": "obj-7rpz",
  "title": "PDB 7RPZ",
  "kind": "artifact",
  "artifactType": "structure-summary",
  "ref": "artifact:structure-summary",
  "runId": "project-...",
  "preferredView": "molecule-viewer",
  "actions": ["focus-right-pane", "inspect", "open-external", "reveal-in-folder"],
  "provenance": {
    "dataRef": "https://files.rcsb.org/download/7RPZ.pdb",
    "producer": "execution-unit-id",
    "version": "1"
  }
}
```

#### 运行期规则
- AgentServer 可以在 ToolPayload / answer payload 中返回 `objectReferences`；BioAgent 校验 refs 后渲染为回答中的 object chips。
- BioAgent 负责把 object ref 解析成 artifact、file、folder、execution unit、run、scenario package 或 external URL；无法解析时显示可恢复诊断，不伪造对象。
- 点击 object chip 默认执行 `focus-right-pane`，由 Runtime View Planner 选择 UI module；右侧栏只展示该对象的 primary view、supporting context 和 actions。
- `open-external` / `reveal-in-folder` 走 Workspace Open Gateway；禁止打开 workspace 外路径，禁止自动执行脚本或可执行文件。
- PPT、Word、PDF、图片、CSV、HTML、文件夹等对象优先支持系统默认打开；同时保留右侧预览/Inspector fallback。
- 用户可以 pin 多个对象到右侧用于 compare，例如结构 + evidence matrix + report；pin 是 view state，不修改 artifact 数据。
- 对象引用需要进入 session history 和 artifact index，历史聊天中点击旧对象能恢复当时版本或提示已被 retention 清理。

#### 完成记录
- 已在 `domain.ts` 中定义 `ObjectReference` / `ObjectAction` / `ObjectResolution`，并在 `runtimeContracts.ts` 中补充 `ObjectReference` schema。
- 已扩展 AgentServer/BioAgent ToolPayload contract，支持 `displayIntent` 与 `objectReferences`；BioAgent normalize 阶段会把显式 refs 与关键 artifacts 自动索引为 clickable objects。
- 已在 chat message 中渲染 object chips，点击后右侧栏进入对象聚焦视图；object focus 通过 Runtime View Planner 选择已发布 UI module，而不是关键词路由。
- 已实现 `artifact:*` / `file:*` / `folder:*` / `url:*` 的首版 resolver，支持 artifact inspector、复制路径、pin/compare 和 synthetic workspace file/folder artifact fallback。
- 已新增 Workspace Open Gateway `/api/bioagent/workspace/open`，支持 `open-external`、`reveal-in-folder`、`copy-path`，校验路径必须位于 workspace 内并阻止脚本/可执行/宏文档等高风险文件。
- 已新增 smoke：runtime contract schema、object reference normalization、workspace open gateway 安全边界。

#### TODO
- [x] 定义 `ObjectReference` / `ObjectAction` / `ObjectResolution` TypeScript 类型和 JSON Schema。
- [x] 扩展 AgentServer/BioAgent ToolPayload contract，允许返回 `objectReferences`，并把关键 artifacts/files/runs 自动索引为对象。
- [x] 在 chat message 中渲染 object chips：支持 hover 摘要、状态、来源 run、快捷动作和缺失/过期提示。
- [x] 实现 object resolver：从 `artifact:*`、`file:*`、`folder:*`、`url:*` 解析到受控对象；`run:*`、`execution-unit:*`、`scenario-package:*` 先作为可聚焦对象保留，后续补完整详情面板。
- [x] 将点击 object chip 接入 Runtime View Planner：右侧栏按对象聚焦展示，而不是按整个 run 自动堆叠。
- [x] 增加 pin/compare 机制：用户可把多个对象固定到右侧；支持取消 pin，排序和持久化保存 view state 后续增强。
- [x] 实现 Workspace Open Gateway：支持 `open-external`、`reveal-in-folder`、`copy-path`，并校验路径位于 workspace 内。
- [x] 增加文件类型安全策略：脚本、可执行文件、宏文档、未知二进制默认不自动打开；敏感/外部路径必须提示或阻止。
- [x] 为 Markdown、PDF、Word、PPT、CSV、图片、HTML、文件夹、PDB/mmCIF/dataRef 添加打开和预览 fallback 首版：优先右侧 module/inspector，workspace 文件可走系统打开。
- [ ] 对历史 run 对象加入版本锁定和 retention 状态：对象被清理时显示恢复建议或可重新生成入口。
- [ ] 增加 browser smoke：Agent 回答引用 `research-report.md`，点击后右侧显示 Markdown 文档，外部打开走受控 gateway。
- [ ] 增加 browser smoke：Agent 回答引用 `PDB 7RPZ`，点击后右侧显示 molecule-viewer，且不自动展示无关 artifacts。
- [x] 增加 smoke：Agent 回答引用一个 workspace 文件夹，点击 `reveal-in-folder` 时只打开允许路径，workspace 外路径被拒绝。

### T053 Code Modularization Without Behavior Change

状态：待开始。

#### 背景
- 当前最大文件已经影响维护效率：`src/ui/src/App.tsx` 约 7.4k 行，`src/ui/src/styles.css` 约 4.7k 行，`src/runtime/workspace-runtime-gateway.ts` 约 4.0k 行。
- T049/T052 把 UI module、Runtime View Planner、Object Reference、Workspace Open Gateway 等关键能力稳定下来后，继续在超大文件中迭代会让定位、审查和回归测试成本快速上升。
- 模块化拆解的目标不是重写架构，而是保持行为不变，把已经稳定的职责边界显式化，让后续功能开发、测试和 agent 协作更快。

#### 为什么模块化会让开发更快
- 更短的上下文窗口：开发某个功能时只需要读对应模块，而不是反复扫描整个 `App.tsx` / gateway，大幅减少理解成本。
- 更低的回归风险：组件、view planner、object resolver、payload normalizer 各自有小边界，改动更容易被局部 smoke 覆盖。
- 更快的代码审查：diff 能集中在单一职责文件里，review 时不用在几千行文件中来回定位。
- 更适合 agent 工作流：可以把独立文件/目录作为明确 ownership，未来并行 worker 或人工协作不容易互相踩线。
- 更容易抽测试：纯函数如 `resolveViewPlan()`、object resolver、payload normalizer 从 UI 文件里移出后，可以直接做 unit/smoke。
- 更好的长期演进：UI Design Studio、Object Reference Interaction、Runtime Gateway 后续都会继续长大，模块边界现在定住，后面新增能力会更轻。

#### 拆分原则
- 不做一次性大迁移；每一批只移动一个稳定职责，保持行为不变。
- 优先抽纯函数和低耦合 UI 子树，再抽高状态组件；状态所有权暂时保留在现有父组件里，避免大面积重连。
- 每一步必须通过 `npm run typecheck`，涉及 UI/view planner 的步骤补跑对应 smoke。
- import/export 保持窄接口，不制造新的全局 registry 或循环依赖。
- CSS 拆分按功能域移动选择器，不改视觉 tokens、不重命名大量 class，避免视觉回归。
- 任何模块化提交都应该是“move-only 或 move+thin wrapper”，业务行为改动另起任务。

#### 目标目录形态
```text
src/ui/src/
  components/
    chat/
      ChatPanel.tsx
      ObjectReferenceChips.tsx
    results/
      ResultsRenderer.tsx
      PrimaryResult.tsx
      UIDesignStudioPanel.tsx
      ArtifactInspectorDrawer.tsx
    scenario/
      ScenarioBuilderPanel.tsx
  viewPlanner/
    resolveViewPlan.ts
    viewPlanTypes.ts
    objectResolver.ts
  api/
    agentProtocol.ts
    agentResponseNormalizer.ts
    objectReferenceNormalizer.ts
  styles/
    base.css
    chat.css
    results.css
    object-references.css
    ui-design-studio.css
    artifacts.css

src/runtime/
  agentserver-prompt.ts
  tool-payload-normalizer.ts
  artifact-persistence.ts
  repair-planner.ts
  generation-gateway.ts
  workspace-open-gateway.ts
```

#### TODO
- [ ] 建立模块化基线 smoke：记录当前 `App.tsx`、`styles.css`、`workspace-runtime-gateway.ts` 大小和关键 smoke 命令，作为拆分前后对照。
- [ ] 从 `App.tsx` 抽出 Object Reference UI：`ObjectReferenceChips`、`ObjectFocusBanner`、object action labels 与基础 resolver helper。
- [ ] 从 `App.tsx` 抽出 Runtime View Planner：`resolveViewPlan()`、`ResolvedViewPlanItem`、dedupe/rank/blocked-design helpers，并增加纯函数 smoke。
- [ ] 从 `App.tsx` 抽出 ResultsRenderer 族组件：`ResultsRenderer`、`PrimaryResult`、`ResultItemsSection`、`RegistrySlot`、`UIDesignStudioPanel`。
- [ ] 从 `App.tsx` 抽出 ChatPanel：保留现有 state contract，先只移动文件，不改发送/中断/stream 行为。
- [ ] 从 `App.tsx` 抽出 ArtifactInspectorDrawer 与 handoff preview，减少结果区组件依赖。
- [ ] 将 `agentClient.ts` 拆为 `agentProtocol.ts`、`agentResponseNormalizer.ts`、`objectReferenceNormalizer.ts`，并保持现有 public API `sendAgentMessageStream()` 不变。
- [ ] 将 `workspace-runtime-gateway.ts` 继续拆为 prompt 构建、ToolPayload normalization、artifact persistence、repair planning、generation orchestration。
- [ ] 将 `workspace-server.ts` 中 Workspace Open Gateway 移到独立模块，保留 HTTP route 只做 request/response glue。
- [ ] 将 `styles.css` 按功能域拆分，并在入口保持稳定 import 顺序；每次拆分后用浏览器 spot check 结果区和聊天区。
- [ ] 每批拆分后运行：`npm run typecheck`、相关 smoke、`npm run build`；最后补 `git diff --check`。
- [ ] 完成后更新 `PROJECT.md` 记录最终文件大小，目标是 `App.tsx < 2500` 行、`styles.css < 1800` 行、`workspace-runtime-gateway.ts < 1800` 行。
