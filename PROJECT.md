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
- 错误必须作为下一轮自愈上下文保留下来：不得吞掉错误、不得用 demo/空结果伪装成功；runtime 必须把失败原因、日志/代码引用、缺失输入、可恢复动作和 next step 写入 `repair-needed` / `failed-with-reason` ExecutionUnit、attempt history 和可见 UI。
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


### T044 Self-evolving Skill Loop 与 Agent 自愈闭环

#### 目标说明
- 把“Agent 发现能力缺口 -> 生成/修复 workspace task -> 产出 artifact -> 形成 skill proposal -> 用户确认后进入隔离 skill 库 -> 后续运行可复用”做成产品级闭环。
- 自进化 skill 必须与 seed/preinstalled/stable workspace skills 隔离，避免一次运行生成的代码污染原本稳定能力。

#### 成功标准
- AgentServer-generated task 或 self-healed task 成功后，自动写入 `.bioagent/skill-proposals/<proposal-id>/proposal.json`，包含 task code ref、input/output/log refs、artifact schema、validation smoke、review checklist 和 promotion history。
- 用户确认前 proposal 不会进入可执行 skill registry；确认后安装到 `.bioagent/evolved-skills/<skill-id>/`，不写入 `skills/seed`、`skills/installed` 或稳定 `.bioagent/skills`。
- Skill Registry 显式读取四类来源：seed、stable workspace、evolved workspace、installed；路由时仍以 seed/stable 为优先，evolved skill 必须保留来源、review 状态和 validation smoke。
- 自愈失败、schema 不匹配、外部 API 限流、缺依赖等情况写入 attempt history；成功 self-healed run 生成 promotion candidate，但 review checklist 默认不通过安全项。
- 实际案例 smoke 覆盖：mock AgentServer 生成 workspace Python task，运行成功后产生 proposal；调用 accept API 后 evolved skill 被安装到隔离目录并被 registry 发现。

#### TODO
- [x] 定义 self-evolving skill 隔离路径：proposal 在 `.bioagent/skill-proposals`，用户确认后的 evolved skill 在 `.bioagent/evolved-skills`。
- [x] 新增 runtime promotion helper：从成功 AgentServer-generated / self-healed task 生成 `SkillPromotionProposal`。
- [x] 新增 workspace writer API：列出 proposal、确认安装 proposal，并返回隔离路径说明。
- [x] 扩展 Skill Registry：读取 `.bioagent/evolved-skills`，但不与 seed/preinstalled 物理混放。
- [x] 增加实际案例 smoke：生成任务 -> proposal -> accept -> registry discover evolved skill。
- [ ] Workbench UI 增加 “Skill proposal” 卡片：显示来源、代码、日志、review checklist、accept/reject 操作。
- [ ] 增加安全 gate：确认安装前检测硬编码绝对路径、凭证样式、私人文件引用、不可复现网络依赖。
- [ ] 增加反思队列：多次成功运行后自动提升 proposal 置信度，失败或 self-heal 过多则降级为 repair notes。

### T045 Multi-turn General Agent Work Loop

#### 目标说明
- Workbench 中的聊天必须像通用 coding/research agent 一样理解多轮目标并完成工作，而不是把最后一句话路由到一个窄 seed skill 后就结束。
- 当用户目标包含“阅读、总结、系统性报告、继续处理这些结果、写代码/生成 task、修复失败”等通用工作信号时，BioAgent 必须把完整上下文交给 AgentServer / workspace task generation；seed skill 只能作为可复现原语或被 AgentServer 生成的 task 调用。

#### 成功标准
- Runtime prompt 包含 Scenario 目标、最近多轮对话、已有 artifacts 概览和当前请求。
- `research-report` / `report-viewer` / 多轮续写类任务会强制走 AgentServer generation 或明确返回 repair-needed，不能静默降级为 “web_search returned N records”。
- AgentServer generation 收到 expected artifacts 与 UI contract，并生成协调 task 输出 report、paper-list、ExecutionUnit 等完整 ToolPayload。
- AgentServer 作为长期服务依赖随本地 dev runtime 一起启动并对齐端口，避免前端显示 ready 但通用 agent backend 实际不可用。
- AgentServer backend 不能在 BioAgent runtime 中写死；通过 `BIOAGENT_AGENTSERVER_BACKEND` 选择 Codex / Claude Code / OpenTeam 等后端，并把 backend 鉴权、模型、网络失败呈现为可恢复诊断。
- AgentServer 必须复用用户在 BioAgent 端配置的 LLM endpoint：Workbench 设置、workspace `.bioagent/config.json` 和项目根 `config.local.json` 的 provider / base URL / model / API key 都应随 run 传入 AgentServer，避免 AgentServer 使用过期或不同的本地模型配置。
- 本地 dev 启动 AgentServer 时，也必须把 BioAgent `config.local.json` 注入 `AGENT_SERVER_MODEL_*` / `AGENT_SERVER_ADAPTER_LLM_*` 环境变量，作为 backend fallback resolver 的统一配置来源。
- 前端 `native` 或不完整的模型设置不能覆盖 AgentServer fallback；只有包含明确 base URL 或 modelName 的 endpoint 才作为用户端 LLM 配置传递。
- 在本地 desktop/dev runtime 中，项目根 `config.local.json` 是 AgentServer LLM 的最高优先级来源；浏览器 localStorage 中的陈旧设置不能覆盖它。
- 浏览器设置与 AgentServer/runtime 必须共享同一个真相源：`config.local.json`。前端启动时从 Workspace Writer 读取该 JSON，设置保存时写回该 JSON；localStorage 只能作为临时兜底缓存，不能成为第二份长期配置。
- 所有可恢复错误都必须留给下一轮纠错：Workbench 展示 concise failure，ExecutionUnit metadata 保存 failureReason / recoverActions / nextStep，AgentServer prompt 读取 priorAttempts，下一轮可以基于这些证据继续修复。
- smoke 覆盖：arXiv 最新论文 + 阅读总结报告的多轮请求，以及 literature / structure / omics / knowledge 多场景复杂任务，即使 seed skill 可用，也必须路由到 AgentServer generation。
- 如果 AgentServer 返回的是自然语言工作结果而非 `taskFiles + entrypoint`，runtime 必须把结果桥接成可见 artifact / ExecutionUnit，并保留缺失 artifact 的 repair-needed 占位，不能把协议差异暴露成用户任务失败。
- 如果 AgentServer 把 `taskFiles + entrypoint` 包在 markdown fenced JSON 或 stage finalText 中返回，runtime 仍必须解析、写入并执行生成任务，而不是把生成代码当作普通报告文本。
- AgentServer generation parser 必须兼容合理的 shape 变体，例如 `entrypoint` 既可能是 `{ language, path }`，也可能是字符串路径。
- 如果 AgentServer 已经在 workspace 写入 task，只在 `taskFiles` 中返回路径引用，BioAgent 必须读取并归档现有文件后执行，不能把路径数组当普通文本结果。

#### TODO
- [x] 前端 project-tool 请求传递多轮对话、场景契约和已有 artifact 摘要。
- [x] 对报告/阅读/系统性总结等 open-ended work 设置 `forceAgentServerGeneration`，避免 seed skill 抢路由。
- [x] Runtime gateway 尊重 `forceAgentServerGeneration`，并在 AgentServer 不可用时返回可恢复失败而非半成品成功。
- [x] 增加实际案例 smoke：multi-turn arXiv report work routes to AgentServer generation。
- [x] 本地 `npm run dev` 默认启动 AgentServer 并统一使用 `BIOAGENT_AGENT_SERVER_PORT || 18080`。
- [x] Runtime gateway 支持 `BIOAGENT_AGENTSERVER_BACKEND`，不再把通用 agent generation 固定到单一 backend。
- [x] Runtime gateway 向 AgentServer 转发用户端 LLM endpoint，并在未显式传参时回退读取 workspace config / `config.local.json`。
- [x] `tools/dev.ts` 启动 AgentServer 时注入 BioAgent 本地 LLM 配置，避免 AgentServer backend fallback 继续使用旧 token。
- [x] 增加 backend failure smoke：AgentServer 401 / token / backend error 不再误报为 `taskFiles` 协议错误。
- [x] 增加 LLM endpoint smoke：确认 provider / base URL / model / API key 随 AgentServer run payload 传递。
- [x] 增加 fenced generation smoke：确认 AgentServer 返回 markdown fenced JSON 时，BioAgent 会执行生成 task。
- [x] 增加跨场景 smoke matrix：literature / structure / omics / knowledge 多轮复杂请求都走通用 AgentServer 工作流。
- [x] 增加 AgentServer direct text / ToolPayload bridge：真实 backend 不按 task generation shape 返回时仍保留工作产物。
- [ ] Workbench UI 将 “正在做什么 / 当前计划 / 正在写 task / 正在运行 / 正在修复” 作为更清晰的 agent progress 展示。







## 归档摘要
- T001 Agent 对话 API：已完成 AgentServer run/stream 接入、错误处理、排队 follow-up、响应 normalize。
- T002 Computer Use 真实可用性探索：已完成首页、设置、workspace、Agent prompt、导出、Resource Explorer smoke；记录见 `docs/ComputerUseSmoke.md`。
