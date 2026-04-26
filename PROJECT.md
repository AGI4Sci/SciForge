# BioAgent - PROJECT.md

最后更新：2026-04-26

## 使用约定
- 本文档作为 BioAgent 工程任务板使用，正文只保留正在推进或待推进的任务；已完成任务压缩到归档摘要。
- 产品与架构基准见 `docs/BioAgent_Project_Document.md`。
- 当前 Web UI 位于 `ui/`，本项目服务运行在 `http://localhost:5173/`；本地 workspace writer 运行在 `http://127.0.0.1:5174/`。
- AgentServer 是项目无关的通用“大脑”和 fallback backend；BioAgent 不应维护一个写死工具清单，而应优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码来解决用户请求。
- 如果确实定位到 AgentServer 通用能力缺口，可以修改 `/Applications/workspace/ailab/research/app/AgentServer`；修改必须泛化到协议、配置、通用工具连接、网络环境或 backend 能力层，并在对应 TODO 标明影响的 API / backend / tool 约定。
- Self-evolving skills 是 BioAgent 的核心原则：Agent 在完成用户工作时发现现有 skill 不满足需求，应优先在当前工作目录生成或修复 workspace-local skill/task，并把 Python/R/notebook/CLI 代码视为 skill 的执行组件；稳定成功后再通过验证、反思和用户确认沉淀到用户 skill 库或 seed skill 候选，而不是由开发者手工把一次任务缺口写死进项目代码。
- 自愈必须发生在 Agent 运行闭环内：当 artifact contract、外部 API、执行日志或用户目标暴露能力缺口时，Agent 应读取失败原因、生成/修改任务代码、重跑并记录 ExecutionUnit、attempt history 和 promotion candidate。开发者介入只能补通用协议、权限、安全边界、runner 能力和 promotion 机制；不应代替 Agent 为具体场景补专用分支。
- 语言边界必须显式：TypeScript 主要用于 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排壳；科学任务执行代码优先生成到 workspace 内的 Python 脚本 / notebook / package 中，并作为 artifact 的一部分沉淀。只有在性能、生态或既有科学工具要求时，才使用 R、C/C++、Rust、Julia、Shell、WASM 或其它语言；选择非 Python 语言必须在 ExecutionUnit 中记录原因、环境和可复现入口。
- BioAgent 不应把具体科学任务长期写死在 TypeScript backend 分支里。workspace runtime 只能作为通用能力原语和任务引导器；真实任务应尽量表现为 workspace-local code artifact，例如 `.bioagent/tasks/*.py`、`.bioagent/tasks/*.ipynb`、`.bioagent/tasks/*.R`，并输出标准 artifact JSON、日志和 ExecutionUnit。
- 研究时间线是一等公民：它是研究记忆、分支探索历史、belief dependency graph 的时间投影，也是未来研究编排层的状态基底。
- 代码路径必须尽量保持唯一真相源：引入新链路或发现冗余时必须删除、合并或明确降级旧链路，避免两个并行逻辑长期共存。

## 当前状态
- 已有 React + Vite Web UI，包含研究概览、Scenario 工作台、对齐工作台、研究时间线。
- 可组合 Scenario Package 方案已落地：Element Registry、Scenario/Skill/UI Compiler、Validation Gate、workspace package API、Scenario Builder、Scenario Library、versioned runs 与 promotion workflow 均已完成。
- 发布后的场景绑定 package/version、SkillPlan、UIPlan 和 runtime route decision；失败状态进入 validation/report/smoke，而不是静默降级为 demo success。
- 2026-04-25 完成产品化体验硬化阶段：首访 onboarding、Runtime Health、Package 导入/导出、Scenario Builder 渐进式编译、Workbench 运行恢复、Timeline 研究记忆、Workspace 资源管理、移动端布局、bundle 复现回归和测试 artifact 报告均已落地并进入 smoke/verify 链路。

---

## P0 - 当前阻塞
- 暂无架构性 P0 阻塞。
- 当前阶段已完成从“内置 Scenario preset + runtime override”到可组合、可编译、可发布 Scenario Package 系统的迁移。
- 产品化体验硬化 T033-T043 已完成；下一阶段任务应围绕 self-evolving skill loop、Agent 自愈闭环、AgentServer 后端能力泛化和 workspace-local task package 生态继续定义。

### T033 Scenario-first 产品形态收口

#### 目标说明
- 删除“不同 Agent 页面”作为产品主抽象，改为统一 Scenario workbench。ScenarioSpec 是一等公民；内置四个 preset 只是默认场景，不是页面分叉。

#### 成功标准
- 前端协议、工作台入口、session state、dashboard 文案都以 Scenario 为主语。
- `src/ui/src/scenarioSpecs.ts` 是前端场景契约唯一入口，声明 `skillDomain`、input/output artifact schema、scope declaration、default UIManifest slots 和 component policy。
- LLM/AgentServer prompt 只允许生成结构化 artifact、ExecutionUnit、claims 和 UIManifest；UI 不执行生成代码。
- workspace runtime 接收 `scenarioId + skillDomain`，skillDomain 只作为内部 skill matching 维度。
- README 与产品设计文档明确最终链路：`scenario.md -> ScenarioSpec -> skill/runtime -> artifact -> UIManifest -> component registry`。

#### TODO
- [x] 建立 `ScenarioSpec` 作为前端场景契约唯一入口。
- [x] 将 UI 状态和 session 主键改为 `ScenarioId` / `sessionsByScenario`。
- [x] 将 dashboard 与 workbench 文案切换为 Scenario preset / ScenarioSpec。
- [x] 将 workspace runtime 请求切换为 `scenarioId` + `skillDomain`。
- [x] 更新 README、PROJECT 和设计文档。

### T034 Computer Use 深度 UX 审计与回归基线

#### 目标说明
- 把“用起来顺不顺”变成可重复验证的工程资产，而不是一次性主观观察。
- 使用 in-app browser、Computer Use、Playwright smoke 和截图回归覆盖真实用户路径。

#### 成功标准
- 有一份 `docs/UXAudit.md`，记录 Dashboard、Package Catalog、Scenario Library、Workbench、Builder、Settings、Workspace、Timeline 的真实使用路径、截图、断点和优先级。
- smoke 覆盖首访、导入官方 package、导入本地 package、编译发布自定义 package、进入工作台、运行任务、失败恢复、导出 bundle、移动端宽度。
- 每条关键路径都有明确断言：页面是否跳转、主按钮是否可理解、错误是否可操作、空状态是否有下一步。
- Computer Use 审计记录真实浏览器多标签、缩放、侧栏宽度、焦点和可见区域问题。

#### TODO
- [x] 新增 `docs/UXAudit.md`，把本轮发现的体验问题结构化为 journey map。
- [x] 扩展 `tests/smoke/smoke-browser-workflows.ts`，覆盖 Settings、Workspace 侧栏、Timeline 和失败恢复。
- [x] 增加截图回归：desktop、mobile、窄侧栏、结果面板折叠、Builder 展开/收起状态。
- [x] 增加 UX 断言 helper：禁止裸 JSON 错误、禁止无说明 disabled 主按钮、禁止关键 CTA 不可见。
- [x] 给每次 smoke 输出用户路径摘要，而不只是技术 selector 结果。

### T035 首次使用与服务健康检查

#### 目标说明
- 用户第一次打开网页时，不应该先理解 AgentServer、workspace writer、package、skillDomain 等内部概念。
- 系统要主动检测运行环境，并给出可执行的下一步。

#### 成功标准
- 顶部 `Scenario Runtime` 状态升级为 health center，显示 UI、workspace writer、AgentServer、model backend、workspace path、package library 的状态。
- Dashboard 首屏给出“开始路径”：导入官方 package、导入本地 package、描述需求编译新场景、打开最近 workspace scenario。
- 服务不可用时展示修复建议，例如启动 `npm run workspace:server`、检查 `http://127.0.0.1:18080`、切换到 workspace seed skill。
- 所有网络/API 错误都被转换成用户可读提示，不出现 `{"ok":false,"error":"not found"}` 这类裸响应。

#### TODO
- [x] 实现 `RuntimeHealthPanel`，聚合 workspace writer、AgentServer、model provider、package library 状态。
- [x] Dashboard 增加 `Get Started` 操作区，按用户目标推荐下一步。
- [x] `workspaceClient` 与 `agentClient` 统一错误模型：`title`、`reason`、`recoverActions`、`diagnosticRef`。
- [x] 发送按钮禁用时显示原因：空输入、runtime 不可用、缺少必填输入、场景未发布等。
- [x] 增加 health smoke：关闭 AgentServer / workspace writer 时 UI 给出正确恢复动作。

### T036 Scenario Builder 渐进式体验

#### 目标说明
- Builder 当前功能强但信息密度过高，用户会直接看到大段 JSON 和大量组件按钮。
- 需要把它改成“描述需求 -> 推荐组合 -> 精修元素 -> 编译质量检查 -> 发布/运行”的渐进式工作流。

#### 成功标准
- Builder 默认展示自然语言需求、推荐结果、关键组件和质量摘要；JSON contract 默认折叠到高级视图。
- 每个 skill/tool/UI component 都有短说明、输入输出、为什么被推荐、风险或依赖。
- 自动推荐和手动选择可以互相切换，且用户能看到变更 diff。
- 发布前质量门用普通语言解释 blocking/warning/note，而不是只显示计数。

#### TODO
- [x] 将 Builder 拆成 Stepper：需求描述、推荐元素、编辑契约、质量检查、发布运行。
- [x] 给 element chips 增加详情 popover：用途、producer/consumer、fallback、依赖 profile。
- [x] JSON preview 默认折叠，仅在 `scenario/skill/ui/validation` 高级 tabs 中展开。
- [x] 增加“为什么推荐这些组件”的解释区，并记录到 package metadata。
- [x] 发布成功后提供两个明确动作：`进入工作台`、`导出 package`。

### T037 Package Catalog / Library 的完整产品体验

#### 目标说明
- package 应像真实可安装资产：可导入、打开、导出、复制、升级、冲突处理、归档和恢复。

#### 成功标准
- 官方 package 主按钮遵循用户意图：未导入时 `导入并打开`，已导入时 `打开`。
- 本地 package 导入支持 id 冲突处理：覆盖、另存为新 id、取消，并展示版本 diff。
- Scenario Library 支持搜索、过滤、排序、最近打开、来源标签和版本历史。
- 导出 package 前可预览包含内容：scenario、skillPlan、uiPlan、tests、qualityReport、version history。

#### TODO
- [x] 增加 package import conflict dialog：覆盖 / 重命名 / 取消。
- [x] Library 增加搜索与过滤：source、status、skillDomain、最近打开、质量状态。
- [x] 每个 package card 增加版本历史、quality badge、last run、失败次数。
- [x] 导出前显示 package manifest preview，并标记是否包含敏感 workspace refs。
- [x] 增加 package restore flow：archived package 可恢复到 Library。

### T038 Workbench 聊天与运行体验

#### 目标说明
- Workbench 是主工作区，必须让用户清楚知道“我现在在什么场景、用哪个 package 版本、下一步能做什么、失败怎么恢复”。

#### 成功标准
- 输入区有明确状态：可发送、缺输入、runtime 不可用、正在运行、可重试。
- AgentServer 不可用时，系统优先尝试稳定 seed/workspace skill；若仍失败，展示恢复动作，而不是只显示系统失败气泡。
- 每次 run 的 route decision、selectedSkill、runtimeProfile、fallbackReason 以用户可读形式展示。
- 历史消息、运行记录和 artifacts 可以按 run 聚合查看，避免聊天流和结果区割裂。

#### TODO
- [x] 输入区增加 `Run readiness` 小条：必填输入、runtime、package version、selected skill。
- [x] 失败消息卡片化，包含 `原因`、`自动尝试过什么`、`下一步动作`、`查看日志`。
- [x] 增加 retry / repair 按钮：重试当前 skill、改用 seed skill、打开设置、导出诊断包。
- [x] 聊天消息与右侧结果按 run id 互相高亮。
- [x] 历史会话列表展示 package/version 和最近运行状态。

### T039 结果区、Artifact 与 Handoff 体验

#### 目标说明
- 结果区目前能渲染组件，但空状态、handoff、artifact lineage 和多组件布局还不够像专业研究工具。

#### 成功标准
- 每个空状态都说明缺什么 artifact、哪个 skill 会产生它、如何运行或导入数据。
- Artifact 卡片显示来源、schema、producer skill、package version、可复现文件和可发送目标。
- Handoff 不只是按钮跳转，还要生成目标场景的输入草案，并保留来源引用。
- 结果区支持 focus mode、split view、collapse 和移动端单列切换。

#### TODO
- [x] 为每个 registry component 定义 `emptyState` 和 `recoverActions`。
- [x] 增加 Artifact Inspector 抽屉：schema、preview、lineage、files、handoff targets。
- [x] Handoff flow 增加确认预览：目标 package、传递字段、会创建的新 run。
- [x] 结果区增加 focus mode，允许只看图、只看证据、只看执行单元。
- [x] 移动端把聊天、Builder、结果区改成 tabs，而不是挤在同一滚动面。

### T040 Settings 与 Workspace 资源管理器体验

#### 目标说明
- 设置与工作目录是用户排障和复现的基础，必须可靠、可理解、不会误操作。

#### 成功标准
- 设置入口稳定打开，包含连接测试、模型配置、AgentServer、workspace writer、API key 保存状态和安全说明。
- Workspace 侧栏能解释当前路径、`.bioagent` 结构、最近 artifacts、logs、tasks，并支持安全打开/复制路径。
- 新建、重命名、删除等文件操作有明确确认和错误反馈；删除仍必须二次确认。

#### TODO
- [x] 修复/验证 Settings modal 打开路径，增加 smoke 覆盖。
- [x] 设置页增加 `Test connection`：AgentServer stream、workspace writer、model backend。
- [x] 修复 workspace snapshot 恢复策略：显式 workspace path 不再被“最近工作区”覆盖。
- [x] Workspace tree 增加 `.bioagent` 专用分组：tasks、logs、task-results、scenarios、exports。
- [x] 文件操作统一 toast/status，不让错误只出现在 sidebar title。
- [x] 增加 workspace path onboarding：不存在时可创建，权限不足时给出原因。

### T041 Research Timeline 与研究记忆

#### 目标说明
- 时间线应成为研究记忆和分支探索入口，而不是静态展示页。

#### 成功标准
- 每次 package import/publish、run、artifact 生成、handoff、失败恢复都写入 timeline event。
- Timeline 支持按 scenario/package/run/artifact 过滤，并能回到对应工作台状态。
- 用户可以把一次成功 run 标记为 reusable task / skill candidate / view preset candidate。
- 导出研究 bundle 时包含 timeline、package refs、artifacts、executionUnits 和复现说明。

#### TODO
- [x] 定义 timeline event schema，覆盖 package、run、artifact、handoff、failure、export。
- [x] Workbench run 完成后自动追加 timeline event。
- [x] Timeline UI 增加过滤、搜索、回放到场景、导出当前分支。
- [x] 增加 reusable candidate 标记入口，并进入 Scenario Library / Element Registry 候选区。
- [x] 增加 timeline smoke：运行任务后能在时间线找到对应事件并跳回。

### T042 可访问性、性能与视觉打磨

#### 目标说明
- 让 BioAgent 在桌面、窄屏、缩放、多标签真实使用下都稳定、清晰、不卡顿。

#### 成功标准
- 所有 icon button 有 tooltip/aria label；键盘可完成导入、打开、发布、发送、切换结果 tab。
- 图表和 heavy viewer 不再产生 Recharts width 警告或首屏布局跳动。
- Builder/Workbench/Library 在 390px、768px、1440px 下无文本溢出和关键 CTA 遮挡。
- 主 chunk 和重型 visualization chunk 保持在预算内，3Dmol eval 风险有明确隔离策略。

#### TODO
- [x] 增加 keyboard navigation smoke：Tab 顺序、Enter/Space 激活、Esc 关闭 modal。
- [x] 修复 Recharts width(-1) warning，确保 chart container 有稳定尺寸。
- [x] 增加 tooltip 系统，覆盖 icon-only 和专业术语按钮。
- [x] 移动端重排 Builder/Workbench/Results，避免信息过载。
- [x] 继续追踪 bundle budget 和 `3dmol` 替代/隔离路线。

### T043 端到端可靠运行与发布门禁

#### 目标说明
- 用户体验最终依赖运行时稳定：场景发布、任务执行、失败恢复、导出复现必须形成闭环。

#### 成功标准
- `npm run verify` 覆盖 unit、typecheck、build budget、browser smoke、workspace API smoke 和关键 runtime smoke。
- 每个官方 package 都有最小 dry-run/smoke case，并在 Package Catalog 显示质量状态。
- 发布 package 前执行 quality gate；失败时用户知道缺哪些 inputs / skills / components / runtime profiles。
- 导出 bundle 能在新 workspace 中重新导入并打开，不依赖旧 localStorage。

#### TODO
- [x] 收敛 `npm run verify`，区分 fast verify 和 full browser/runtime verify。
- [x] 为四个官方 packages 增加独立 package-level smoke fixture。
- [x] 增加导出 bundle -> 新 workspace 导入 -> 打开运行的回归测试。
- [x] Quality gate 纳入真实 runtime health 和 package version diff。
- [x] CI/本地报告输出 `docs/test-artifacts/index.html`，集中查看截图和日志。






## 归档摘要
- T001 Agent 对话 API：已完成 AgentServer run/stream 接入、错误处理、排队 follow-up、响应 normalize。
- T002 Computer Use 真实可用性探索：已完成首页、设置、workspace、Agent prompt、导出、Resource Explorer smoke；记录见 `docs/ComputerUseSmoke.md`。
