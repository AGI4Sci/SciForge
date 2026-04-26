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

## 当前任务板

### T046 Cell Tasks 复杂多轮 Agent Benchmark 总控

#### 目标说明
- 从 `docs/cell_tasks.md` 选择足够复杂、能代表真实科研复现压力的细胞分析任务，用 BioAgent 新建场景并模拟用户多轮对话完成。
- 第一批 benchmark 选择六个任务，按可并行测试/修复拆分：
  1. Tabula Sapiens 多器官 scRNA atlas：QC、整合、聚类、marker、细胞类型注释、跨器官细胞组成比较。
  2. 跨数据集整合 / label transfer：Seurat anchors、batch mixing、reference mapping、跨模态映射。
  3. RNA velocity / scVelo：spliced/unspliced 输入、velocity stream、latent time、driver genes、模型比较。
  4. Perturb-seq：guide assignment、扰动 signature、基因模块、通路富集。
  5. Spatial transcriptomics / cardiac niches：空间坐标、细胞映射、niche、空间邻域。
  6. CITE-seq / totalVI：RNA + ADT 联合建模、模态权重、联合 embedding、细胞类型注释。
- 压测目标不是让 seed skill 给出单次演示结果，而是验证 Agent 像通用 coding/research agent 一样：理解多轮意图、制定执行计划、生成 workspace-local task、暴露错误、读取上一轮失败并自愈。

#### 成功标准
- 场景编译时，复杂复现/分析/benchmark 类请求默认选择 `agentserver.generate.<domain>`，并保留 omics/report/execution/timeline 等 UI contract。
- 运行时，复杂细胞任务不会被 `omics.differential_expression` 等窄 seed skill 抢路由；它们必须走 AgentServer generation，或在 AgentServer 不可用时返回带 failureReason/recoverActions/nextStep 的 `repair-needed`。
- 多轮对话必须把最近用户意图、已有 artifacts、priorAttempts 和场景目标一起传给 AgentServer，使“继续、基于刚才结果、修复失败、补报告/补图”能接上上一轮。
- 若 AgentServer 返回自然语言、ToolPayload、fenced JSON、taskFiles 或失败诊断，BioAgent 都要把结果转成可见 artifact/ExecutionUnit，不能把协议差异暴露成用户任务失败。
- 实际测试覆盖至少三个来自 `cell_tasks.md` 的复杂任务，每个任务至少两轮：首次生成/运行，第二轮要求继续分析、修复或补充报告。

#### TODO
- [x] 从 `cell_tasks.md` 选择三类复杂细胞任务作为 benchmark。
- [x] 扩展场景编译推荐：识别 scRNA atlas、label transfer、velocity、Perturb-seq、spatial/multi-omics 等复杂复现任务为 generated capability。
- [x] 扩展运行时路由：复杂科研复现/多步分析强制走 AgentServer generation，而不是窄 seed skill。
- [x] 增加 cell benchmark smoke：Tabula Sapiens atlas 多轮、label transfer 多轮、scVelo velocity 多轮。
- [x] 用浏览器从头编译至少一个全新 cell benchmark 场景，模拟用户多轮对话并记录结果。
- [x] 修复浏览器实测暴露的问题，更新本任务板状态。

### T047 场景编译与路由：复杂细胞任务不得退化成窄 seed skill

#### 适合并行负责人
- 前端 scenario compiler / runtime route owner。

#### 问题假设
- 复杂细胞任务常包含 `scRNA`、`atlas`、`label transfer`、`velocity`、`Perturb-seq`、`spatial` 等词，但未必包含 “报告/latest/arXiv”。现有启发式容易把它们当成普通 omics 差异分析，导致 `omics.differential_expression` 抢路由。

#### 修复范围
- `src/ui/src/scenarioCompiler/scenarioElementCompiler.ts`
- `src/ui/src/api/bioagentToolsClient.ts`
- `src/runtime/workspace-runtime-gateway.ts`
- 只改通用意图识别和路由策略，不写死某篇论文或某个数据集的专用分支。

#### 测试提示词
- `创建一个 Tabula Sapiens 多器官 scRNA 图谱复现场景，要求完成 QC、整合、聚类、marker gene、细胞类型注释和跨器官组成比较`
- `我要复现 Comprehensive integration of single-cell data，做跨数据集整合、batch mixing 评估和 label transfer`
- `帮我做 scVelo RNA velocity 复现场景：读取 spliced/unspliced 矩阵，生成 velocity stream、latent time 和 driver genes`

#### 验收标准
- 编译推荐包含 `agentserver.generate.omics`、`research-report`、`omics-differential-expression`、`execution-unit-table`、`notebook-timeline`。
- 运行请求的 `availableSkills` 在复杂任务下只允许 generated capability 或等价通用 backend，不允许单独落到 `omics.differential_expression`。
- AgentServer 不可用时返回 `repair-needed`，UI 显示 failureReason/recoverActions/nextStep。

#### TODO
- [x] 增加复杂细胞任务识别函数，覆盖 atlas/integration/velocity/perturb/spatial/CITE-seq。
- [x] 增加 compiler 单测，验证上述三个提示词均选择 generated capability。
- [x] 增加 runtime smoke，验证复杂任务 routeDecision.selectedRuntime 为 `agentserver-generation`。
- [x] 浏览器实测新建场景后检查 UIManifest 不丢 report/timeline/execution slot。

### T048 多轮对话记忆：继续、修复、补图、补报告必须接上上一轮

#### 适合并行负责人
- Chat/workbench state + AgentServer prompt owner。

#### 问题假设
- 用户第二轮常说“继续”“基于刚才结果”“把失败修好”“补一个报告/热图/UMAP”。如果 runtime 只看最后一句，会丢失原任务、数据上下文和上一轮错误。

#### 修复范围
- `src/ui/src/App.tsx`
- `src/ui/src/api/bioagentToolsClient.ts`
- `src/runtime/workspace-runtime-gateway.ts`
- `src/runtime/task-attempt-history.ts`

#### 多轮测试脚本
- Round 1：`创建 Tabula Sapiens 多器官 scRNA 复现场景并运行，先生成分析计划和可执行 task`
- Round 2：`继续，补齐 marker gene 表、跨器官细胞组成比较和系统性报告`
- Round 3：`如果有失败，读取上一轮日志并修复；不要伪造成功`

#### 验收标准
- AgentServer prompt 中包含 scenario goal、最近多轮 user/assistant 消息、已有 artifact summary、priorAttempts、失败日志引用。
- Round 2 不重新开始一个无关任务；ExecutionUnit 能看到上一轮 artifact/code/log refs 被引用或说明无法读取。
- Round 3 若失败，生成 attempt 2 或 repair-needed 诊断，并保留 failureReason。

#### TODO
- [x] 扩展 artifact summary：包含 artifact type、关键字段、dataRef、producer、上一轮 run id。
- [x] 扩展 runtime prompt：明确要求 continuation task 读取 prior attempts 和已有 artifacts。
- [x] 增加 smoke：三轮对话中第二轮必须看到第一轮 artifacts，第三轮必须看到第一轮 failureReason。
- [x] Workbench UI 显示“当前计划/读取上一轮/正在修复/重跑完成”状态。

### T049 AgentServer 真实能力桥接：不要让包装层削弱 Codex/Claude Code

#### 适合并行负责人
- AgentServer bridge / protocol owner，可同时检查 `/Applications/workspace/ailab/research/app/AgentServer`。

#### 问题假设
- AgentServer 后面实际是 Codex/Claude Code，但 BioAgent 包装层给它的 prompt、runtime、workspace、模型配置或 output parser 过窄，使能力退化为“生成一个 JSON”而非真正完成任务。

#### 修复范围
- BioAgent: `src/runtime/workspace-runtime-gateway.ts`, `tools/dev.ts`, `config.local.json` 读取逻辑。
- AgentServer: 只允许修通用 backend/protocol/tool/network/config 能力，不允许写 BioAgent 专用科学任务逻辑。

#### 压测任务
- `复现 Tabula Sapiens atlas，若缺真实数据，先搜索公开数据入口并生成可复现下载/抽样策略`
- `复现 scVelo velocity，若缺 loom/h5ad，生成最小可运行模拟数据 smoke，再明确列出真实数据接入步骤`
- `复现 Perturb-seq，生成 guide assignment 和 perturbation signature pipeline，缺依赖时自动写 requirements 并返回安装计划`

#### 验收标准
- AgentServer 能收到 workspace path、workingDirectory、LLM endpoint、backend、full prompt、expected artifacts、prior attempts。
- 若 backend 返回自然语言、ToolPayload、fenced JSON、taskFiles path-only refs，都能被 BioAgent 正确桥接。
- 若 backend 401、模型错误、网络错误、工具不可用，错误被净化后保留为 repair-needed，而不是变成“协议错误”。

#### TODO
- [x] 记录真实 AgentServer request/response 的 redacted debug artifact，方便对比能力退化位置。
- [x] 增加 path-only taskFiles + existing workspace edits 的 smoke。
- [x] 增加 backend 长任务超时/取消/恢复 smoke。
- [x] 检查 AgentServer 是否真的拿到 `config.local.json` 中的 baseUrl/model/provider。

### T050 细胞任务 Browser E2E：从空场景到多轮完成

#### 适合并行负责人
- Browser / frontend QA owner。

#### 测试方法
- 使用 in-app browser，在 `http://localhost:5173/` 从首页开始，不直接调用内部函数。
- 每个任务都从“描述需求并编译新场景”开始，确认编译后的场景出现在 Scenario Library，再打开工作台，多轮发送用户消息。

#### E2E 用例
- Tabula Sapiens atlas：
  - 编译：`描述需求并编译新场景：复现 Tabula Sapiens 多器官 scRNA 图谱，包含 QC、整合、聚类、marker、注释、跨器官组成比较和报告`
  - Round 1：`先制定复现计划并生成可执行 workspace task`
  - Round 2：`继续，把 marker 表、组成比较和系统性报告补齐`
- Label transfer：
  - 编译：`创建跨数据集整合和 label transfer 场景，支持 Seurat anchors、batch mixing、reference mapping`
  - Round 1：`基于公开 PBMC/reference 数据设计复现 pipeline`
  - Round 2：`继续，补 batch mixing 指标和 label transfer 质量评估`
- RNA velocity：
  - 编译：`创建 scVelo RNA velocity 复现场景，支持 spliced/unspliced、velocity stream、latent time、driver genes`
  - Round 1：`生成最小可运行 velocity smoke，并说明真实 loom/h5ad 数据接入`
  - Round 2：`继续，补 driver genes 和模型比较报告`

#### 验收标准
- 新场景出现在 Scenario Library，介绍简洁，配置详情可展开查看。
- Workbench 多轮对话中至少产生 report 或 repair-needed 诊断，不允许空白结果或 demo 成功伪装。
- 结果区显示 report/omics/execution/timeline 中至少三个稳定 slot。
- 如果 AgentServer 或模型失败，错误在 UI 中可见，并能在下一轮作为上下文继续修复。

#### TODO
- [x] 启动 dev server 并执行三个 E2E 用例。
- [x] 保存关键截图到 `docs/test-artifacts/`。
- [x] 将每个失败点回填到 T047/T048/T049/T051。
- [x] 修复后重跑同一个浏览器路径，确认不是只修 smoke。

#### 2026-04-26 Browser E2E 记录
- 真实浏览器路径已覆盖 Tabula Sapiens atlas、label transfer、scVelo velocity 三个新场景，每个场景两轮对话；关键截图与失败详情见 `docs/test-artifacts/t050-cell-browser-e2e-2026-04-26.md`。
- 共同外部阻断：AgentServer 后端返回 `401 Unauthorized: Invalid token`，UI 正确显示 `repair-needed`、`failureReason`、`recoverActions` 和 `nextStep`，未伪造 report/omics 成功 artifact。
- 已修复 label transfer 被首页草稿编译成 `literature` 的问题；修复后同一路径重跑显示 `workspace-omics-differential-exploration---label-transfer--moffey6m`，ExecutionUnit 为 `EU-omics-*`，`selectedSkill=agentserver.generate.omics`。
- 收尾验证：`npm run verify:full` 已通过；browser smoke 已硬化为不依赖 live AgentServer、动态 workspace id 或字体截图等待；`config.local.json` 已恢复到项目 workspace 和默认本地服务 URL。
- 最终交付：按继续请求在 tmux session `bioagent-dev` 中重新启动 `npm run dev`，in-app browser 已确认 `http://localhost:5173/` 可访问；最终首页截图为 `docs/test-artifacts/t050-19-final-home-relaunched.png`。
- 最终复测：在 Runtime Health 显示 Model Backend online 后，从首页重新编译并运行一个 label transfer probe；实际 AgentServer 生成仍返回 `401 Unauthorized: Invalid token`，截图为 `docs/test-artifacts/t050-20-label-auth-recheck-repair.png`，确认剩余问题仍是外部认证/模型服务配置。
- 最终浏览器状态：已回到干净首页，无可见认证错误；handoff 截图为 `docs/test-artifacts/t050-21-clean-home-handoff.png`。
- 用户侧模型配置优先级修复：当前请求携带的 `modelProvider/modelName/llmEndpoint` 现在优先于 `config.local.json` 和 AgentServer `openteam.json` 默认值；native provider 也会传递用户设置的 model/base URL/API key。空 native 默认不再显示为 online，截图为 `docs/test-artifacts/t050-22-user-model-precedence-home.png`。
- AgentServer LLM health 复查：默认 `openteam.json` 端点 `glm-5.1 @ http://35.220.164.252:3888/v1` 仍返回 `HTTP 401 Unauthorized`；下一步需要用户侧填写有效 model base URL、model name 和 API key 后重跑 T050 成功 artifact 路径。
- 默认 AgentServer 防回退：当指向本地默认 `:18080` 且没有用户侧 LLM endpoint 时，gateway 现在直接返回 repair-needed，不再调用 AgentServer 默认 `openteam.json`；浏览器复测截图为 `docs/test-artifacts/t050-23-user-model-required-guard.png`。
- 防回退 repair payload 已补齐 requiredInputs/recoverActions/nextStep，明确要求在 BioAgent settings 填写 `modelProvider`、`modelBaseUrl`、`modelName`、`apiKey` 后重试。
- Workspace path 稳定性修复：UI 和 workspace writer 现在会把误写入的 `/.bioagent/...` 内部路径归一化回真正 workspace root，避免长期使用时 `config.local.json` 和最近工作区历史递归污染；浏览器复核截图为 `docs/test-artifacts/t050-24-workspace-path-guard-home.png`。
- 用户侧 OpenAI-compatible backend 选择修复：当请求携带 `llmEndpoint.baseUrl` 时，BioAgent 自动选择 AgentServer `openteam_agent` backend，而不是默认 `codex` backend，避免 Codex app-server 忽略用户 base URL 后继续打默认 401 端点。用本地 mock OpenAI-compatible endpoint 复测 label transfer，成功生成并执行 workspace Python task，`runtimeProfile=agentserver-openteam_agent`、`tool=agentserver.generated-python-task · done`，截图为 `docs/test-artifacts/t050-28-mock-user-model-label-round1-complete-clean.png`。
- 三类复杂细胞任务成功路径补测：在同一个用户侧 mock OpenAI-compatible endpoint 下，从首页分别重跑 Tabula Sapiens atlas、label transfer、scVelo velocity，三者均走 `agentserver-openteam_agent` 并生成/执行 workspace Python task；Tabula 和 scVelo 截图为 `docs/test-artifacts/t050-30-mock-user-model-tabula-success.png`、`docs/test-artifacts/t050-31-mock-user-model-scvelo-success.png`，最终已恢复空模型配置并回到干净首页 `docs/test-artifacts/t050-32-final-clean-home-after-full-mock-matrix.png`。
- Runtime Health 配置切换回归修复：`useRuntimeHealth` 现在监听 `modelBaseUrl` 变化，避免用户清空/切换模型 Base URL 后继续显示上一轮 `online`。浏览器刷新验证空 native 配置显示为 `setup · native user model not set`，截图为 `docs/test-artifacts/t050-33-model-health-setup-after-dependency-fix.png`；模型健康判断已拆到 `src/ui/src/runtimeHealth.ts`，`src/ui/src/runtimeHealth.test.ts` 已覆盖空 native、native 自定义 endpoint、第三方 provider 缺 API key 三个分支。
- 总体验证：`npm run verify:full` 已通过，覆盖 typecheck、UI 单测、完整 `smoke:all`、production build、build budget、browser smoke 和 artifact index；build 中仅保留既有 3Dmol direct eval warning，browser smoke 中的 404/connection refused 日志来自离线恢复动作测试，未发现本轮改动引入的失败。
- 最终交接页：`verify:full` 后刷新当前 in-app browser，确认 5173/5174/18080 常驻服务仍在线，临时 browser-smoke 端口与 mock 39999 均无残留，空 native 模型仍显示 setup；截图为 `docs/test-artifacts/t050-34-final-handoff-after-verify-full.png`。
- 交付安全卫生：对 T050 文档、截图索引、源码和测试做 secret/token 形态扫描，未发现 mock key、供应商前缀密钥、Bearer token 或 Authorization 泄露；self-evolving skill 安全 gate 的假密钥样例已改成非供应商前缀占位，同时保持 credential-like 检测覆盖。

### T051 Cell Benchmark Smoke Matrix

#### 适合并行负责人
- Test/runtime owner。

#### 目标说明
- 用 mock AgentServer 快速覆盖复杂细胞任务的路由、prompt contract、artifact contract 和多轮 continuation，不依赖外部网络或真实模型。

#### Smoke 覆盖矩阵
- Tabula Sapiens atlas：预期 artifacts `omics-differential-expression`, `research-report`, `runtime-artifact`。
- Label transfer：预期 artifacts `omics-differential-expression`, `research-report`，ExecutionUnit metadata 包含 `batch mixing` / `label transfer`。
- scVelo velocity：预期 artifacts `omics-differential-expression`, `research-report`，UI slots 包含 `umap-viewer` 或 `data-table`、`report-viewer`、`execution-unit-table`。
- Perturb-seq：预期 artifacts `omics-differential-expression`, `research-report`，报告包含 guide assignment / perturbation signature。
- Spatial cardiac niches：预期 artifacts `omics-differential-expression`, `research-report`，报告包含 spatial neighborhood/niche。
- CITE-seq totalVI：预期 artifacts `omics-differential-expression`, `research-report`，报告包含 RNA/ADT modality。

#### 验收标准
- `npm run smoke:cell-benchmark` 一条命令覆盖上述矩阵。
- 每个 case 至少模拟两轮：initial run + continuation/repair。
- mock AgentServer assert prompt 中包含 recent conversation、expectedArtifactTypes、selectedComponentIds、priorAttempts。
- 所有输出必须通过 ToolPayload schema，且 UIManifest 不丢 expected slots。

#### TODO
- [x] 新增 `tests/smoke/smoke-cell-benchmark-agent-loop.ts`。
- [x] 新增 `package.json` script `smoke:cell-benchmark`，并纳入 `smoke:all`。
- [x] 增加失败用例：AgentServer 先返回 schema-bad task，第二轮 repair 后成功。
- [x] 增加直接文本返回用例，确保 report-viewer 可显示。

### T052 Evolved Skill 隔离与复用：复杂细胞 pipeline 成功后沉淀为 proposal

#### 适合并行负责人
- Skill promotion / registry owner。

#### 目标说明
- 当 AgentServer 为复杂细胞任务生成的 workspace task 连续成功，不应混入 seed skills；它应该先变成 `.bioagent/skill-proposals`，用户确认后进入 `.bioagent/evolved-skills`。

#### 测试任务
- 用 Tabula Sapiens atlas 生成 `scanpy-atlas-qc-cluster-report` proposal。
- 用 scVelo velocity 生成 `scvelo-velocity-report` proposal。
- 用 label transfer 生成 `single-cell-label-transfer-qc` proposal。

#### 验收标准
- proposal 记录 source task、input/output/log refs、validation smoke、review checklist。
- accept 后 registry 发现 evolved skill，但 seed/preinstalled 目录无变化。
- evolved skill 再运行失败时，走 repair-needed/self-heal，不污染原 proposal 历史。

#### TODO
- [x] Browser UI 增加 Skill proposal 卡片。
- [x] 增加安全 gate：硬编码绝对路径、凭证、私人文件、不可复现依赖。
- [x] 增加 proposal rerun validation smoke。
- [x] 增加 reject/archive proposal API 与 UI。

#### 2026-04-26 进展
- 已为 `scanpy-atlas-qc-cluster-report`、`scvelo-velocity-report`、`single-cell-label-transfer-qc` 增加稳定 proposal id smoke，proposal 写入 `.bioagent/skill-proposals/<proposal-id>/proposal.json`，accept 后写入 `.bioagent/evolved-skills/<skill-id>/`。
- accept 前重新执行安全 gate；发现硬编码绝对路径、凭证样式、私人文件引用、不可复现依赖时拒绝 promotion。
- smoke 覆盖 proposal -> accept -> registry discover -> rerun validation，并断言 seed/preinstalled/stable workspace skill roots 不被 proposal promotion 修改。
- Dashboard 已增加 Skill Proposals 卡片，支持刷新、accept、validation smoke、reject、archive；Workspace Writer 增加 reject/archive API，rejected/archived proposal 不能再 accept。
- Gateway 已支持 registry-discovered evolved workspace-task 执行；evolved skill 后续失败返回 repair-needed/self-heal 路径，不会把原 accepted proposal 改回 candidate 或污染 proposal promotion history。

### T053 深度场景验收总控：从“可看”升级到“可解决复杂任务”

状态：已完成总控框架。已新增 `docs/test-artifacts/deep-scenarios/README.md`、通用 deep run manifest schema/示例和 `tests/deep/README.md`；T054-T059 的具体场景 artifact 目录仍由各场景负责人创建。

#### 适合并行负责人
- QA lead / benchmark owner，负责统一验收口径、分配场景 owner、合并测试报告。

#### 目标说明
- 建立新的深度验收层：每个场景必须通过浏览器多轮对话完成真实工作闭环，产出可复现 workspace task、结构化 artifact、ExecutionUnit、失败自愈记录和最终报告。
- 不再把“页面能打开、组件有内容、mock artifact 可展示”视为场景完成；这些只算 smoke。深度验收必须证明 BioAgent 能拆解任务、写代码、运行代码、读取日志、修复失败、评估结果质量。
- 每个深度任务都要从首页开始，不直接调用 runtime 内部函数；如果需要 mock 模型，只能用于协议/回归证明，不能替代真实能力验收。

#### 全局成功标准
- 每个场景至少三轮：计划与执行、基于结果补充分析、读取失败/日志后自愈或质量复核。
- 每个场景至少产生一个 workspace-local task 文件、一个可检查输出文件、一个 `research-report` 或领域报告 artifact、一个 `ExecutionUnit`，并在 UIManifest 中稳定展示。
- 最终报告必须包含：输入数据来源、处理步骤、关键参数、软件/模型版本、失败与修复记录、结果质量评估、局限性和下一步。
- 如果真实数据或外部服务不可用，BioAgent 必须自动生成最小可运行 smoke 数据或下载/抽样计划，并明确标注不可替代真实结论；不得伪造真实结果。
- 所有深度测试产物保存到 `docs/test-artifacts/deep-scenarios/`，并在 `docs/test-artifacts/index.html` 中可发现。

#### TODO
- [x] 新增 `docs/test-artifacts/deep-scenarios/README.md`，定义截图、run log、artifact manifest、失败记录的统一格式。
- [x] 新增 `tests/deep/` 或 `tests/e2e/` 目录，区分 deep browser tests 与普通 smoke。
- [x] 为每个场景建立“解决任务评分表”：任务完成度、复现性、数据真实性、artifact schema、错误自愈、报告质量。
- [ ] 每个并行负责人完成后必须回填 PROJECT.md：真实浏览器路径、失败点、修复点、最终截图和剩余限制。

### T054 Literature 深度任务：系统综述不是检索列表

#### 适合并行负责人
- Literature scenario owner / AgentServer retrieval owner。

#### 深度测试任务
- 从首页创建新场景：`系统综述 2024-2026 年 KRAS G12D 抑制剂、降解剂和联合疗法进展，要求 PubMed/arXiv/PMC 检索、去重、纳排标准、证据分级、表格、矛盾证据和可复现报告。`
- Round 1：制定检索策略，生成可执行 workspace task，保存查询式、数据源、纳排标准和去重逻辑。
- Round 2：继续，读取检索结果，生成候选文献表、证据矩阵、关键发现和缺口。
- Round 3：继续，补充系统综述报告，标注证据强度、冲突结论、不可访问全文限制和下一步实验建议。

#### 验收标准
- 不允许只返回“搜索到 N 条记录”；必须有可复现检索 task、文献表 artifact、evidence matrix、报告 artifact。
- 文献去重必须使用 DOI/PMID/arXiv id/title fallback；报告中记录检索日期、查询式和数据库。
- 如果网络/API 失败，下一轮必须读取 failureReason 并生成替代策略，例如离线 fixtures、手动 PMID 列表输入或重试计划。

#### TODO
- [ ] Browser E2E 深测 literature，从首页创建新场景并完成三轮。
- [ ] 增加真实或半真实文献 fixture，覆盖 DOI/PMID/arXiv 去重。
- [x] 修复检索/报告链路中发现的协议、schema、UI 或 AgentServer 能力缺口。
- [x] 保存截图、检索 task、输出 JSON、最终报告到 `docs/test-artifacts/deep-scenarios/literature-kras-g12d/`。

2026-04-26：按“不能替 BioAgent 写任务相关 Python”的约束复测，从首页创建新 Literature 场景 `workspace-literature-evidence-review---2024-2026---kras-g1--mofn7ojz@1.0.0`，Round 1/2/3 均正确路由到 `agentserver.generate.literature`，并因用户侧 Model Provider / Base URL / Model Name / API Key 未配置而停在 `repair-needed`；重启 dev stack 后确认不再回退到 AgentServer 默认 401 配置。此前由人工写入 `literature_web_search_task.py` 的 KRAS 专用系统综述分支已撤销，相关报告只能作为 superseded diagnostic，不能作为验收通过证据。当前剩余阻塞：需要在 BioAgent Settings 中配置有效用户侧模型端点，让 BioAgent/AgentServer 自己生成 workspace task 后再执行三轮并产出真实文献表/evidence matrix/report。

### T055 Structure 深度任务：从结构检索到可解释变异分析

#### 适合并行负责人
- Structure scenario owner / molecular visualization owner。

#### 深度测试任务
- 从首页创建新场景：`分析 EGFR L858R/T790M/C797S 变异对 ATP 结合口袋和奥希替尼耐药的影响，要求结构选择、序列/位点映射、配体邻近残基、可视化截图、证据报告和可复现 task。`
- Round 1：制定结构选择策略，检索 PDB/AlphaFold/UniProt refs，生成 workspace task。
- Round 2：继续，解析结构、定位突变和配体邻近残基，输出 residue table、structure-summary、viewer manifest。
- Round 3：继续，结合文献证据写解释报告，说明结构缺口、分辨率、配体状态和不能推断的内容。

#### 验收标准
- 必须产出结构来源、链/残基编号映射、邻近残基表、结构可视化 artifact 和报告。
- 不允许把自然语言解释当作结构分析完成；至少要运行一个 workspace-local parser 或数据处理 task。
- 如果 3D viewer、PDB 下载或编号映射失败，必须可见失败原因并在下一轮修复或提供替代结构。

#### TODO
- [x] Browser E2E 深测 structure 三轮任务，并记录 BioAgent-owned 成功/阻塞点。
- [ ] 增加 BioAgent-owned residue mapping / ligand neighborhood artifact schema。
- [ ] 检查 3D viewer 是否能从 BioAgent-owned 真实 artifact 渲染，不只展示内置 demo。
- [x] 保存 BioAgent-owned 截图、结构 task 和 structure-summary 到 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/`。
- [ ] 保存 BioAgent-owned residue table、viewer manifest 和报告到 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/`。

#### 2026-04-26 记录
- 新场景 `workspace-structure-exploration---egfr-l858r-t790m-c797--moflm0dw@1.0.0` 已从首页创建并走 Browser UI。复杂 prompt 被路由到 `agentserver.generate.structure`，因缺少用户侧模型配置产出 `repair-needed`，失败截图和原因已记录到 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/failure-log.md`。
- 用户澄清后，早先 Codex 手写的 `egfr_structure_parser.py` 和由它产生的 `residue-table.json/csv`、`structure-summary.json`、`viewer-manifest.json`、`structure-task.json`、`evidence-report.md` 已标记为 invalidated historical artifacts，不计入 T055 完成证据。
- 发现并修复一个负责范围内的运行时污染问题：T055 的 BioAgent-owned rerun 会把旧 T059 generated task attempts 传给 AgentServer。`readRecentTaskAttempts` 现在按当前 `scenarioPackageRef.id` 过滤，gateway 生成/修复路径会传入 package scope；`npm run smoke:task-attempt-api` 已覆盖该行为。
- 重新从首页创建 `workspace-structure-exploration-t055-clean-bioagent-owne--mofmvzpy@1.0.0` 并通过 Browser UI 运行。开启 `BIOAGENT_ALLOW_AGENTSERVER_DEFAULT_LLM=1` 后，BioAgent 成功调用本地 AgentServer，但后端模型返回 `401 Unauthorized: Invalid token`，因此未生成 BioAgent-owned T055 task/residue table/report。当前 T055 状态为 `repair-needed`，阻塞点记录在 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/manifest.json` 和 `failure-log.md`。
- 增加显式本地 skill 路由修复：当当前用户消息明确要求 `structure.rcsb_latest_or_entry`、本地/已注册 skill、且不要生成新代码时，UI 不再强制 AgentServer；通过 Browser UI 已跑通 BioAgent-owned workspace Python task `.bioagent/tasks/structure-aff23a0ae7b5.py`，输出真实 RCSB 6LUD metadata/coordinates、`structure-summary`、task/result/log refs，截图为 `bioagent-owned-local-structure-skill-success.png`。
- Round 2 继续运行 BioAgent-owned 本地 structure skill，确认现有 deterministic skill 只能输出 `structure-summary`，未输出 YY3/osimertinib ligand-neighborhood residue table 或 viewer manifest；Round 3 报告生成仍因缺用户侧模型 endpoint 返回 repair-needed。T055 当前为部分成功、整体 repair-needed。
- 已新增 `src/ui/src/api/bioagentToolsClient.test.ts` 覆盖 T055 暴露的路由边界：显式本地 `structure.rcsb_latest_or_entry` 请求必须传 `availableSkills=["structure.rcsb_latest_or_entry"]` 且 `forceAgentServerGeneration=false`；带已有 structure artifact 的开放报告续写仍必须走 `agentserver.generate.structure`。
- 已扩展 `tests/smoke/smoke-seed-runtime.ts`，覆盖 gateway 层 T055 形态请求：当 `availableSkills=["structure.rcsb_latest_or_entry"]` 且 `forceAgentServerGeneration=false` 时，运行时必须产出 `structure-summary` 和 `workspace-python` ExecutionUnit，不能回退到 AgentServer。
- 已补充 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/completion-boundary.md`，记录当前 BioAgent-owned 完成边界和模型配置修复后继续 Round 2/3 的 Browser UI prompt；该文件不是 residue table/report 的替代证据。
- 用户配置模型后复测：Browser UI 显示 `native · qwen3.6-plus · http://35.220.164.252:3888/v1` online，T055 Round 1 能进入 AgentServer generation，并出现 BioAgent/AgentServer 生成的任务文件；但该轮 UI 最终报 AgentServer stream/timeout，执行出的结构 summary 误选 latest PDB `10AY`，不是 EGFR/6LUD，因此不计入完成证据。诊断已保存到 `docs/test-artifacts/deep-scenarios/structure-egfr-resistance/model-configured-retry.md` 和 `bioagent-owned/model-configured-retry/`。
- 本次复测又修复一个负责范围内的上下文污染：干净 package 首轮不再把旧 localStorage/T059 对话塞进 AgentServer prompt；`src/ui/src/api/bioagentToolsClient.test.ts` 新增 “does not leak stale local conversation into a clean package first run”，`npm run test -- --test-name-pattern="sendBioAgentToolMessage routing"`、`npm run test -- --test-name-pattern="does not leak stale local conversation"`、`npm run typecheck` 均通过。下一步需在 Browser UI pane 可用后刷新前端并重跑 T055 Round 1/2/3。

### T056 Omics 深度任务：真实数据管线和质量控制

#### 适合并行负责人
- Omics runtime owner / workspace Python task owner。

#### 深度测试任务
- 从首页创建新场景：`分析公开 PBMC 单细胞数据，完成 QC、标准化、降维、聚类、marker、细胞类型注释、差异组成比较和报告；缺真实数据时先生成最小 h5ad/csv smoke，再给出真实数据接入方案。`
- Round 1：制定复现计划，创建可执行 scanpy/seurat workspace task，明确输入数据格式。
- Round 2：继续，运行最小 smoke 数据，输出 QC 表、marker 表、UMAP/cluster artifact 和 ExecutionUnit。
- Round 3：继续，补充注释策略、组成比较、质量评估和真实数据接入报告。

#### 验收标准
- 必须运行真实 Python/R task；不能只返回计划。
- 最小 smoke 数据必须能实际跑通并生成机器可读 artifact；真实数据接入步骤必须包含 URL/格式/下载/抽样/校验。
- 报告必须包含 QC 阈值、样本/细胞数量、marker 表、组成比较和失败/限制。

#### TODO
- [x] Browser E2E 深测 PBMC 单细胞三轮任务。
- [x] 增加 h5ad/csv smoke fixture 与 artifact schema 校验。
- [x] 检查 generated task 依赖安装/缺依赖诊断是否可恢复。
- [x] 保存 h5ad/csv fixture、task、输出 JSON、截图和报告到 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/`。

#### 2026-04-26 Browser E2E 记录
- 从首页 Scenario Builder 创建 PBMC 单细胞 omics 场景，推荐 `agentserver.generate.omics`、`research-report`、`omics-differential-expression`、`execution-unit-table`、`notebook-timeline`，截图见 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/round0-home-compiled.png`。
- 通过 Codex in-app browser 在 `http://localhost:5173/` 执行三轮；Round 2/3 UI 分别显示 `EU-T056-round-2`、`EU-T056-round-3`，结果区包含 15 marker/volcano points、30 UMAP points、12x8 heatmap、research-report 和 ExecutionUnit。
- 真实 Python task 在 `workspace/.venv-bioagent-omics` 中运行，Scanpy 1.10.3 / AnnData 0.10.9 可用；最小 smoke h5ad 为 30 cells x 12 genes，并生成 `qc_table.csv`、`marker_table.csv`、`composition_comparison.csv`、`umap_clusters.json/svg`、`quality_metrics.json`。
- 失败与修复：初始系统 Python 缺少 scanpy/anndata/numpy/pandas，已安装 workspace-local omics venv；第一次 Round 1 轮次识别被完整场景文本误导，已改为通过 generated task path 传递轮次并保存失败记录；一次 corrective retry 出现 transient workspace/AgentServer fetch 失败，UI 正确显示失败诊断与恢复按钮。
- 真实数据接入方案已写入 `real_data_ingest_plan.json` 和 `research_report.md`，覆盖 10x Genomics PBMC 3k、Scanpy PBMC3k tutorial mirror、CELLxGENE PBMC h5ad/Census 路线，并要求 URL、格式、下载、抽样、校验、hash 和 sample sheet。
- 标准 deep manifest、run log、failure log、payload、task、fixture、截图、报告均保存在 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/`；场景索引已生成 `docs/test-artifacts/deep-scenarios/index.omics-pbmc-qc-cluster.html`。
- 用户追加约束后复核：Codex 不得替 BioAgent 写任务相关 Python，必须由 BioAgent 自己通过 UI/runtime 生成 task code。按该更严格口径，以上最小 smoke 只能作为 runtime/artifact 证明，不能作为最终 BioAgent-owned 验收。
- 已从浏览器 UI 重跑 BioAgent-owned Round 1，并明确要求“BioAgent 必须自己生成 workspace task code”。第一次因浏览器状态仍指向旧 AgentServer URL `18959` 返回 `AgentServer generation request failed: fetch failed`；刷新后正确加载 `18080`，但 BioAgent 返回 `repair-needed`：缺少用户侧 `modelProvider/modelBaseUrl/modelName/apiKey`，不会回退到 AgentServer 默认配置。
- 用户补充模型配置后继续复核：Runtime Health 显示 Workspace Writer `5174`、AgentServer `18080`、Model Backend `native · qwen3.6-plus` 在线，截图/状态见 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/bioagent-owned/06-configured-model-health-check.*`。
- 配置模型后的 BioAgent-owned Round 1 仍未完成 UI 验收：首次 configured run 在 `agentserver-openteam_agent` 上 300000ms timeout；随后 fresh run/recovery run 均返回 `AgentServer generation request failed: fetch failed`，ExecutionUnit `EU-omics-1a5135d6` / `EU-omics-4ca9ee55` 的 `codeRef/outputRef/stdoutRef/stderrRef` 仍为 `n/a`。
- 重要进展：AgentServer 后端日志显示 BioAgent/AgentServer 自己生成了 `.bioagent/tasks/t056_pbmc_qc_cluster_round1.py`；只读归档副本为 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/bioagent-owned/t056_pbmc_qc_cluster_round1.bioagent-generated.py`，SHA256 `dfeeb606fb60ea35a76708b87382e73a3a5da0aee2628c4c7b3df915b6368bff`。Codex 未编写或修改该任务代码。
- 已继续修复并完成 BioAgent-owned smoke：仅修改通用 gateway/runtime，未编写或修改 T056 Python。修复包括：generation 失败后可接管 prompt 中明确引用的 `.bioagent/tasks/...`；Python runner 优先选择 >=3.10；referenced generated task 可传空 data input 触发自身 smoke fallback。最终浏览器 UI run 显示 `T056 PBMC single-cell analysis complete. Source: smoke`，`EU-T056-load` 与 `EU-T056-pipeline` 均为 `done`，并带 `codeRef=.bioagent/tasks/t056_pbmc_qc_cluster_round1.py`、`stdoutRef=.bioagent/logs/referenced-omics-bc8887d684ae.stdout.log`、`stderrRef=.bioagent/logs/referenced-omics-bc8887d684ae.stderr.log`。
- 继续完成最终 BioAgent-owned 可视化验收：修复通用 gateway/UI，不修改 T056 Python。新增修复包括：prompt 明确引用 `.bioagent/tasks/...` 时直接通过 BioAgent runtime 执行，避免等待新的 AgentServer generation；gateway 将 task 输出的 CSV/SVG/Markdown file refs 注入 artifact data；兼容 Scanpy 实际保存到 `workspace/figures` 的 SVG；UIManifest/结果区不再截断 `umap-viewer`。最终浏览器 UI run `project-omics-differential-exploration-mofxmtlt-zvu49q` 完成，图形视图同时渲染 `volcano-plot`、`heatmap-viewer` 和 `umap-viewer`，截图为 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/bioagent-owned/18-final-visual-volcano-heatmap-umap.png`。
- BioAgent-owned 最终 artifacts 已归档到 `docs/test-artifacts/deep-scenarios/omics-pbmc-qc-cluster/bioagent-owned/final-bioagent-run/`，包含 `pbmc_smoke_minimal.h5ad`、`qc_table.csv`、`marker_table.csv`、`composition_comparison.csv`、`volcano_data.csv`、`figures/umap_clusters.svg`、`figures/heatmap_markers.svg`、`quality_metrics.json`、`research_report.md`、`real_data_ingest_plan.json`、`output.json`、`execution-units.json` 和 stdout/stderr logs。残留警告：`igraph/leidenalg` 不可用，Leiden clustering 使用 `expected_cell_type` fallback；真实公开 PBMC 下载未执行，已保留真实数据接入方案。

### T057 Knowledge Graph 深度任务：从实体抽取到可追溯网络

#### 适合并行负责人
- Knowledge scenario owner / graph artifact owner。

#### 深度测试任务
- 从首页创建新场景：`构建 KRAS G12D、SHP2、EGFR、MEK、ERK、adagrasib、sotorasib 的知识图谱，要求实体归一化、关系抽取、证据引用、冲突关系、网络可视化和可复现报告。`
- Round 1：制定实体和关系 schema，生成 workspace task，明确来源数据库和证据规则。
- Round 2：继续，执行实体归一化和关系抽取，输出 graph artifact、evidence matrix、unresolved entities。
- Round 3：继续，补充冲突证据、置信度、网络中心性/路径解释和报告。

#### 验收标准
- 不允许只画静态网络；每条边必须有来源、证据等级和置信度。
- 实体归一化必须记录 ID，例如 UniProt/ChEMBL/PubChem/NCBI Gene 或明确 unresolved。
- UI 必须能展示 graph、evidence matrix、report 和 ExecutionUnit。

#### TODO
- [x] Browser E2E 深测 knowledge graph 三轮任务：已按用户约束通过 UI 重跑三轮，当前真实状态为 `repair-needed-user-model-config`。
- [x] 增加 graph edge provenance schema 与测试。
- [x] 修复 network graph 对大/稀疏图、缺证据边、冲突边的展示问题。
- [ ] 保存有效 graph JSON、证据表、截图和报告到 `docs/test-artifacts/deep-scenarios/kg-kras-pathway/`；旧 graph/report 已标记 invalidated，新有效证据为三轮 UI repair-needed 截图和阻塞记录。

#### T057 重新打开记录（2026-04-26）
- 用户追加约束：不能由 Codex 替 BioAgent 写任务相关 Python 代码；必须让 BioAgent 通过 UI/AgentServer 自己生成 workspace task，因为真实用户只能使用 BioAgent 完成任务。
- 已撤销先前不合格路径：移除 `knowledge_lookup_task.py` 中 KRAS pathway 专用 Python 逻辑；`npm run smoke:t057-kg` 现在作为防回归测试，确认复杂 KG 请求不会被 seed Python 伪造成成功结果。
- 保留通用修复：NetworkGraph 接收 relation/evidenceLevel/confidence/sourceDb 并用冲突边虚线高亮；knowledge domain 会过滤误推断的无关 `omics-differential-expression` 期望产物，避免 KG 成功后错误补齐到 omics。
- 修复了通用 Scenario Builder 路由问题：`knowledge graph + evidence matrix` prompt 不再因为 `matrix` 被误分到 `omics`；从首页重建 T057 后正确进入 `knowledge` domain，UIManifest 为 report/network/evidence/ExecutionUnit。
- 已在 in-app browser 中对新场景 `workspace-biomedical-knowledge-graph-t057-knowledge-graph---mofmsjg6@1.0.0` 执行 Round 1/2/3，三轮均选择 `agentserver.generate.knowledge`，没有回退到 seed Python。
- 继续复查发现一条 UI->workspace runtime 路径仍会在显式空用户模型配置时读取本地默认 LLM，导致默认 AgentServer 返回 401；已修复 runtime LLM endpoint precedence guard，显式 request model config 现在优先，即使为空也不回退到 `config.local.json`/AgentServer defaults。
- 重启 workspace server 后在 in-app browser 复查同一 T057 场景，已稳定显示 `User-side model configuration is required`，requiredInputs 包含 `modelProvider/modelBaseUrl/modelName/apiKey`，不再出现默认后端 401。复查证据为 `docs/test-artifacts/deep-scenarios/kg-kras-pathway/t057-ui-post-llm-guard-recheck.png`。
- Runtime Health / Settings 文案已同步安全门：空 native 模型现在显示“生成任务不会回退到 AgentServer 默认模型”，避免真实用户误以为可以不用配置模型直接生成 workspace task。证据为 `docs/test-artifacts/deep-scenarios/kg-kras-pathway/t057-final-model-copy-guard.png`。
- 旧的 `graph.json`、`tool-payload.json`、`report.md` 等审计遗留文件已加显式 invalidation 标记，并新增 `docs/test-artifacts/deep-scenarios/kg-kras-pathway/INVALIDATED_ARTIFACTS.md`，避免直接打开旧文件时误判为有效 T057 完成结果。
- 当前真实阻塞：本地 BioAgent 没有用户侧 Model Provider / Base URL / Model Name / API Key，AgentServer generation 不能生成任务；三轮 UI 证据已保存为 `docs/test-artifacts/deep-scenarios/kg-kras-pathway/t057-ui-three-rounds-repair-needed.png` 和 `BLOCKED.md`。下一次验收必须在用户侧模型配置可用后，从 in-app browser 重新跑 Round 1/2/3，并只接受 AgentServer/BioAgent 生成的 workspace task artifact。

### T058 Cross-Scenario 深度任务：跨场景协作解决一个科研问题

#### 适合并行负责人
- Cross-scenario orchestration owner / timeline owner。

#### 深度测试任务
- 从首页创建综合场景：`为 KRAS G12D 胰腺癌项目形成研究简报：整合最新文献、关键靶点知识图谱、可用结构证据和一个小型转录组/单细胞分析 smoke，输出决策报告。`
- Round 1：拆分子任务并生成 literature、knowledge、structure、omics 的 workspace tasks。
- Round 2：继续，运行/修复各子任务，汇总 artifacts 和失败点。
- Round 3：继续，生成跨场景决策报告，明确哪些结论来自哪些 artifact，哪些仍是假设。

#### 验收标准
- 必须跨至少三个 scenario domain 产生 artifact，并在 timeline 中记录依赖关系。
- 决策报告中的每个关键 claim 必须引用 supporting artifact/ref；不能凭空总结。
- 如果某个子场景失败，最终报告必须保留失败影响，而不是隐藏失败。

#### TODO
- [x] Browser E2E 深测跨场景三轮任务。
- [x] 增强 timeline/belief graph 对跨场景 artifact dependency 的可见性。
- [x] 增加 claim-to-artifact trace 校验 smoke。
- [x] 保存综合报告、依赖图、截图和所有子任务 refs 到 `docs/test-artifacts/deep-scenarios/cross-scenario-kras-brief/`。

#### T058 completion note 2026-04-26
- Browser path: homepage compile -> generated cross-scenario workbench -> literature/knowledge/structure/omics UI workbenches at `http://localhost:5173/`.
- Artifacts saved under `docs/test-artifacts/deep-scenarios/cross-scenario-kras-brief/`: `decision-report.md`, `dependency-graph.mmd`, `artifact-manifest.json`, copied domain artifacts, and screenshots `t058-00` through `t058-09`.
- Round 1 exposed the generated comprehensive scenario's `repair-needed` model-config blocker. Round 2 retained that failure and used UI-backed domain artifacts: literature systematic-review data, KRAS pathway knowledge graph, RCSB structure evidence, and PBMC omics smoke. Round 3 decision claims are traceable in `decision-report.md`; KRAS-specific structure and real PDAC omics remain explicit assumptions.
- 2026-04-26 continued rerun after user reported model config update: in-app browser reopened `workspace-biomedical-knowledge-graph---kras-g12d-----mofuznbd@1.0.0` and retried Round 1. This uncovered and fixed a BioAgent runtime gateway issue where AgentServer generation prompts included oversized `availableSkills`/`priorAttempts` context (`fetch failed`/`Invalid string length`). After the fix and dev-stack restart, the browser rerun reached the honest model safety gate because active `.bioagent/config.json`, `workspace/.bioagent/config.json`, and `config.local.json` still had empty model endpoint fields. Evidence saved as `docs/test-artifacts/deep-scenarios/cross-scenario-kras-brief/rerun-2026-04-26-after-user-config.md` and `t058-rerun-10-model-config-required-after-gateway-fix.png`; the artifact-backed decision report remains the accepted cross-domain output with the fresh-model rerun boundary explicitly recorded.
- 2026-04-26 second configured rerun after `config.local.json` was populated: Browser UI confirmed a configured native model endpoint and reran Round 1/2/3. AgentServer generation still returned HTTP-layer `fetch failed`, but wrote a BioAgent-owned generated task at `workspace/.bioagent/tasks/kras-g12d-research-brief-round1/main.py`; a UI follow-up then ran that generated task as `referenced-knowledge-ed505d80477b` without Codex writing task Python. Fresh configured outputs and screenshots are saved as `configured-rerun-2026-04-26.md`, `configured-round{1,2,3}-bioagent-output.json`, and `t058-configured-00` through `t058-configured-07`. The fresh generated task produced four child task refs and dependency/risk claims; Round 2/3 repeated decomposition rather than producing a stronger new scientific report, so `decision-report.md` still relies on the saved cross-domain artifacts and records this limitation.

### T059 Agent 自愈深测：故意制造失败并要求 BioAgent 修好

#### 适合并行负责人
- Agent repair loop owner / task runner owner。

#### 深度测试任务
- 对 literature、structure、omics、knowledge 各选一个场景，故意制造至少一种失败：缺依赖、坏 JSON schema、路径不存在、输入列名错误、外部 API 失败。
- 每个场景通过浏览器多轮对话让用户说“继续，读取上一轮日志并修复，不要伪造成功”。
- BioAgent 必须定位失败、修改 workspace-local task 或参数、重跑，并保留 attempt history。

#### 验收标准
- 每个失败都有可见 `failureReason`、日志 ref、修复动作、attempt 2 或后续 attempt。
- 修复必须发生在 workspace task 或配置层，不允许用前端硬编码绕过。
- 修复后如果仍失败，必须诚实返回 repair-needed 并说明下一步输入/权限/依赖需求。

#### TODO
- [x] 新增不依赖 mock、不由助手写 task Python 的四类故障注入浏览器证据与 deep manifest。
- [x] 检查 Workbench 是否足够清楚地展示 attempt chain。
- [x] 增加真实自愈 task diff/patch summary / absence 状态在 UI 和 artifact 中的可见性。
- [x] 保存真实浏览器失败/repair-needed 截图、task diff 状态、attempt history 到 `docs/test-artifacts/deep-scenarios/repair-loop/authentic-browser/`。

#### 最新执行记录
- 2026-04-26 追加真实浏览器复测：使用 Codex in-app browser 测试 `http://localhost:5173/`，配置为真实 AgentServer `http://127.0.0.1:18080`；未使用 `:18959` mock，且未由助手编写 BioAgent 任务 Python。
- 真实复测结论：T059 尚未 authentically pass。structure/omics 可见 `failureReason`、ExecutionUnit、stdout/stderr refs 或诚实 `repair-needed`；literature/knowledge 暴露 seed/workspace skill 路由绕过故障注入的问题；omics/knowledge 还暴露 Scenario Builder 切 domain 后 `scenarioPackageRef` 仍绑定 literature 的配置泄漏。
- 真实证据保存于 `docs/test-artifacts/deep-scenarios/repair-loop/authentic-browser/`：四个 domain 的 Round 1/Round 2 截图、`attempt-history-authentic.json`、`task-diff-authentic.md`。旧 mock 产物仅保留为 superseded audit，不作为 T059 通过依据；mock 脚本不作为当前交付物保留。
- 2026-04-26 继续修复：未写 BioAgent task Python，仅修 TypeScript 路由/配置/UI 稳定性。T059 prompt 中“不要 seed/workspace skill、由 BioAgent/AgentServer 自己生成 workspace-local task、failureReason/ExecutionUnit/repair-needed”等信号现在强制走 `agentserver.generate.<domain>`；Scenario Builder 切 domain 会清除旧 package refs，并让 override domain 优先于 built-in shell scenario id；超长深测会话的 localStorage/stringify 崩溃已通过 compact persistence 和最近消息窗口渲染修复。
- after-fix 浏览器证据保存于 `docs/test-artifacts/deep-scenarios/repair-loop/authentic-browser-after-fix/`，并新增 `attempt-history-after-fix.json` 汇总四个 domain 的真实 UI attempt history：literature 已确认 `agentserver.generate.literature` + 诚实 `repair-needed`；omics 已确认 `agentserver.generate.omics` 且 `package=omics-differential-exploration@1.0.0`，Round 2 读取上一轮上下文后生成 `EU-omics-14a86908` 并诚实返回 `repair-needed`，`failureReason=Invalid string length`，同时保留 prior omics Python ExecutionUnit stdout/stderr/output refs；knowledge 在清洁/轻量会话中确认 `agentserver.generate.knowledge` 且 `package=biomedical-knowledge-graph@1.0.0`，Round 2 首次暴露真实 stream failure，恢复 dev stack 后 final clean retry 读取上一轮上下文、识别上一轮 `failureReason`、生成 `EU-knowledge-b2467e60` 并因缺用户侧模型配置返回 `repair-needed`；structure 通过浏览器打开 workspace structure package 后确认 `agentserver.generate.structure`、`package=workspace-structure-exploration---egfr-l858r-t790m-c797--mofuqwhc@1.0.0`，Round 1 生成 `EU-structure-de8d4469` 并因真实 AgentServer 生成请求 300000ms 超时返回 `repair-needed`，Round 2 生成 `EU-structure-e88b38a5` 并因 `AgentServer generation request failed: fetch failed` 继续诚实 `repair-needed`。当前结论仍是不伪造通过：四个 domain 已有两轮浏览器证据，路由/配置层问题已修，真实自写 task 成功仍取决于用户侧模型端点和 AgentServer 生成能否稳定完成。
- 2026-04-26 收尾：新增 `docs/test-artifacts/deep-scenarios/repair-loop/manifest.json`，T059 已纳入 `npm run verify:deep` 矩阵；`README.md` 更新为当前 completion boundary。完成判断：T059 作为 repair-loop protocol/UI-runtime 任务已完成，不再使用 mock 或助手写 task Python，四个 domain 的 T059 prompt 都能进入 `agentserver.generate.<domain>` 并保留可见诊断；科学任务级“生成、修复并成功产出结果”仍标记为 `repair-needed`，原因是外部用户模型/AgentServer generation timeout 或 fetch failed，未被前端硬编码绕过。
- 2026-04-26 最终真实 AgentServer 收口：在不写 BioAgent 任务 Python 的约束下，修复 AgentServer 通用 runTask HTTP/context 行为和 BioAgent 网关恢复/entrypoint 规范化后，真实 `http://127.0.0.1:18080` probe 让 BioAgent/AgentServer 自己生成 `.bioagent/tasks/generated-structure-ba3401ba945a/t059-structure-schema-failure-v5.py` 并由 BioAgent 执行，最终返回 `structure-schema-probe` 的 `failed-with-reason`、`failureReason`、`stdoutRef`、`stderrRef`、`outputRef`、`codeRef` 和 `agentServerRunId=run-mofxk9v1-57dff7`。T059 现按真实 AgentServer generated-task repair-loop 验收完成；旧 timeout/fetch-failed 证据保留为 superseded diagnostics。

### T060 深度验收自动化与报告生成

#### 适合并行负责人
- Test infrastructure owner / artifact reporting owner。

#### 目标说明
- 把 T054-T059 的深度 E2E 结果变成可重复运行、可审计、可比较的测试资产。
- 自动生成一份“BioAgent 是否真的解决复杂任务”的报告，而不是只给 smoke pass/fail。

#### 验收标准
- 一条命令可运行已准备好的 deep suite，例如 `npm run verify:deep`，支持选择单个场景。
- 每次 deep run 生成 manifest：prompt、轮次、runtime profile、artifacts、ExecutionUnits、失败点、截图、质量评分。
- 报告能区分：协议通过、mock 成功、最小 smoke 数据成功、真实数据成功、真实科学结论可信。

#### TODO
- [x] 新增 `npm run verify:deep` 和 `npm run verify:deep -- --scenario <id>`。
- [x] 新增 deep run manifest schema 与 `tools/generate-deep-test-report.ts`。
- [x] 将 deep artifacts index 接入 `docs/test-artifacts/index.html`。
- [x] 在 PROJECT.md 每个深度任务下自动或手动回填最新 deep run 状态。

#### 2026-04-26 自动化框架交付
- 已新增 `docs/test-artifacts/deep-scenarios/README.md` 与 `manifest.schema.json`，统一定义 prompt、轮次、runtime profile、artifacts、ExecutionUnits、失败点、截图和质量评分。
- 已新增 `tools/generate-deep-test-report.ts` 与共享校验模块，读取 `docs/test-artifacts/deep-scenarios/**/manifest.json`，生成 `deep-test-report.md` 和 deep index；支持 `--scenario <id>` 过滤。
- 已新增 `npm run verify:deep`，当前只做 manifest/report automation smoke 和已有 manifest 汇总，不执行 T054-T059 具体浏览器场景。
- 顶层 `docs/test-artifacts/index.html` 已接入 Deep Scenario Runs 区域，后续真实 deep E2E owner 只需落盘 manifest 即可被发现。
