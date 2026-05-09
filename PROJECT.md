# SciForge - PROJECT.md

最后更新：2026-05-09

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- Python conversation-policy package 是多轮对话策略算法的唯一真相源；TypeScript 只能保留 transport、runtime 执行边界和 UI 渲染，不再维护一套并行的策略推断算法。
- T096/T097 的 execution mode 策略只允许来自 Python classifier；TypeScript 的职责是字段透传、runtime shell、guard 调用、ref 持久化和 UI fallback，不允许用 prompt regex 或 provider/scenario 分支重建策略。
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

### T097 任务复杂度路由与 Reproducible Task Project Runtime

状态：已完成本轮验收，继续观察真实 backend mode 遵循和产品运行中的证据质量。本轮已完成 Python classifier、TS 字段透传、Task Project runtime/runner、WorkEvidence guard 接入、AgentServer prompt 边界、运行中 UI 最小展示、repair/continue stage 锚点、guidance adoption contract、guidance adoption runtime guard 和 stage adapter promotion proposal 入口。T097 负责任务复杂度路由和多阶段 Task Project runtime：每个用户请求先经过 Python 策略层判断任务类型、复杂度、不确定性、可复现需求和交互风险，再选择合适执行模式：已有上下文直答、薄可复现 adapter、单阶段 workspace task、多阶段 Task Project、或 repair/continuation。复杂任务应拆成可执行 stage，agent 每次只写/修改当前阶段所需代码，SciForge 执行后把阶段证据、失败和用户追加引导反馈给 agent，再进入下一阶段。

接口边界补充：`executionModePlan` 的策略字段由 `packages/conversation-policy-python/src/sciforge_conversation/execution_classifier.py` 产生；TS 只在 `src/runtime/conversation-policy/apply.ts`、`src/runtime/gateway/context-envelope.ts`、`src/runtime/gateway/agentserver-prompts.ts` 中做字段映射、裁剪和 prompt contract 展示。缺失时只能回退为 `unknown` / `backend-decides`，不能用 prompt regex 自行判断 mode。

与 T096 的关系：T097 决定“这轮应该怎么跑、拆几段、何时继续或修复”；T096 定义“每段运行必须留下什么证据、怎样判断失败、怎样把失败归一成可恢复上下文”。T097 的 Project/Stage runner 消费 T096 的 `WorkEvidence` schema 与 guard，不另建一套证据语义。

核心原则：

- 算法优先 Python：任务分类、复杂度评分、stage 规划、继续/修复策略应在 `packages/conversation-policy-python` 中实现，方便学生阅读、修改和写实验；TypeScript 只保留 request transport、workspace project/stage runner、artifact/ref 持久化和 UI 展示。
- Runtime shell 优先 TypeScript：project/stage 目录创建、输入输出落盘、命令执行、stream 转发、证据归档、UI 状态和 AgentServer 往返属于 TypeScript 执行壳；TypeScript 不复制 Python 的分类、复杂度评分或 stage 规划算法。
- 可复现性优先：依赖新检索、文件、命令、工具或产物的结果必须留下 project/stage code、input、output、stdout/stderr、WorkEvidence 和 artifact refs；只有纯解释已有上下文时才允许直接 ToolPayload。
- 分阶段优先于一次性大脚本：对长任务、高不确定性任务、多 provider 检索、多 artifact 产出、外部 I/O、需要用户中途纠偏的任务，AgentServer 应先生成 stage spec / 当前阶段代码，运行后再基于阶段反馈继续。
- 轻量任务不应走重型 pipeline：简单 search/fetch/current-events 查询可以走薄 adapter 或单阶段 project，限制 provider 数、结果数、超时和输出体积，但仍保留可复现证据链。
- Agent backend 负责策略和代码，SciForge 负责项目状态机、stage 执行、证据归档、失败守门、用户可见进度和下一轮 handoff。
- 所有路由规则、stage 类型和 adapter contract 必须面向通用任务形态；不得为单一 provider、scenario、prompt、论文站点、backend 或固定文案写特例。

简化流程：

```text
user request
  -> Python classifier
  -> execution mode
  -> AgentServer stage/task generation
  -> SciForge runner
  -> WorkEvidence
  -> next stage / repair / final payload
```

执行模式草案：

- `direct-context-answer`：只基于已有 refs / digest / session state 回答，不产生新外部 I/O。
- `thin-reproducible-adapter`：简单外部检索或轻量工具调用；生成最小 adapter/stage，输出 WorkEvidence 和简短结果。
- `single-stage-task`：一次可完成的本地计算、文件转换、窄范围分析或简单 artifact 生成。
- `multi-stage-project`：需要 plan -> search/fetch/read/analyze/validate/emit 多阶段反馈的任务。
- `repair-or-continue-project`：基于已有 project/stage 的失败、用户追加引导或上一轮 artifact 继续。

Todo：

- [x] 在 `packages/conversation-policy-python` 新增任务复杂度分类器：输入 prompt、refs、artifacts、expectedArtifactTypes、selected capabilities、recent failures，输出 `executionMode`、`complexityScore`、`uncertaintyScore`、`reproducibilityLevel`、`stagePlanHint` 和选择理由。
- [x] 为 Python 分类器建立可编辑规则与 fixture：覆盖简单问答、轻量搜索、新闻/current-events、文献调研、全文下载、代码修改、文件探索、长任务、repair、continuation、用户运行中追加引导；断言不依赖单一 provider/scenario/prompt。
- [x] 定义 Task Project schema 与持久化 helpers：`.sciforge/projects/<project-id>/project.json`、`plan.json`、`stages/<n>-<kind>.json`、`src/`、`artifacts/`、`evidence/`、`logs/`，每个 stage 记录 codeRef/inputRef/outputRef/stdoutRef/stderrRef/evidenceRefs/failureReason/nextStep，并支持 project/stage 创建、读取、更新、evidence refs 记录、bounded handoff 摘要和 recent project 列表。
- [x] 在 TypeScript runtime 增加 Project/Stage runner：创建 project、写入 stage code/input、执行当前 stage、调用 T096 guard 归档 WorkEvidence、验证 stage 输出、决定是否请求 AgentServer 生成下一 stage。
- [x] 改造 AgentServer handoff：把 Python 分类结果、执行模式和当前 project/stage/WorkEvidence 摘要放入 `CURRENT TURN SNAPSHOT`；要求多阶段模式下只返回下一阶段 patch/spec，不一次性生成整条 pipeline。
- [x] 将 Python `executionModePlan` 接入 GatewayRequest enrichment、context envelope 的 `sessionFacts`/`scenarioFacts` 和 AgentServer prompt；TypeScript 只透传稳定字段，缺失时回落到 `unknown`/`backend-decides`。
- [x] 增加 stage feedback loop 的 runtime handoff 基础：每阶段完成后把 T096 WorkEvidence 摘要、diagnostics/schema errors/verifier 摘要、artifact refs、recoverActions、用户追加 guidance 和失败诊断压成结构化摘要回传给 agent；handoff 已包含紧凑 guidance adoption contract，runtime guard 会要求 active guidance 都有结构化 adopted/deferred/rejected 决策和 reason，缺失时进入 repair-needed。
- [x] 增加中途可见进度 UI：主对话最小展示当前 project、stage、状态、最近 evidence/failure/recover/diagnostic/nextStep；右侧阶段性 artifact 展示继续作为后续增强。
- [x] 支持用户中途干预的 runtime 基础：追加消息进入 project guidance queue，下一阶段 handoff 读取 queued/deferred guidance，并提供 adopted/deferred/rejected 状态记录 helper；continuation selection 已把 repair/continue 锚定到最近 failed/repair-needed/blocked stage，成功后追加 guidance 时锚定最近 completed stage，避免从 stage one 重跑。
- [x] 建立 promotion 路径：成功稳定的 stage adapter 可以被提议为 reusable skill/package；Task Project 保留从一次性代码到可复用能力的演化证据，复用现有 skill-promotion safety gate、proposal manifest、validation smoke 和人工确认流程。
- [x] 增加 T097 端到端 smoke：同一任务分别触发 direct-context、thin adapter、single-stage、multi-stage、repair/continue 五种模式，断言选择理由、执行 refs、stage 证据、UI 状态和 repair guidance adoption 都稳定。
- [x] 补齐基础 UI+runtime 端到端矩阵：`tests/smoke/smoke-t097-execution-mode-matrix.ts` 用同一套 execution mode fixtures 验证 Python decision 字段、AgentServer handoff、runner refs、WorkEvidence、UI runtime 状态和 repair/continue handoff。
- [x] 补齐 browser 级 RunningWorkProcess DOM smoke：`tests/smoke/smoke-browser-workflows.ts` 使用通用 TaskProject/TaskStage/WorkEvidence fixture 验证默认紧凑展示 project/stage/status/evidence/failure/recover/diagnostic/nextStep，raw output 只在二级折叠中出现，且结构化字段优先于文本 fallback。

验收标准：

- [x] AgentServer handoff 已明确 direct-context/thin-adapter/single-stage/multi-stage/repair-continue 边界，要求 multi-stage 只返回下一阶段；仍需端到端运行矩阵持续验证 backend 遵循程度。
- [ ] 每个依赖外部 I/O 或本地执行的回答都有可复现 project/stage 证据链。
- [x] Python 分类策略可通过 fixture 独立测试和调参，TypeScript 不维护并行复杂度判断算法。
- [x] 多阶段 project 的 runtime handoff 能在失败、空结果、用户追加约束后从最近 stage 继续；backend 若遗漏采用/延后/拒绝声明，会被 guidance adoption guard fail closed 到 repair-needed。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/guidance-adoption-guard.test.ts`
- `node --import tsx --test src/runtime/task-projects.test.ts`
- `node --import tsx --test src/runtime/gateway/context-envelope.test.ts`
- `npx tsx tests/smoke/smoke-t097-execution-mode-matrix.ts`
- `npx tsx tests/smoke/smoke-agentserver-handoff-current-turn.ts`
- `python3 -m pytest packages/conversation-policy-python/tests`

### T096 WorkEvidence 结构化证据与通用恢复守门

状态：已完成本轮验收，继续观察真实 provider 字段漂移。本任务承接外部检索失败被伪装成成功结果的问题，目标是在不重写 agent backend 通用 search/fetch/read/command 能力的前提下，让 SciForge 提供一层薄的结构化证据 contract、失败归一化和 runtime guard。Agent backend 继续负责推理、选择 provider、制定 fallback 策略；SciForge 只负责把关键执行事实整理成低噪声、可审计、可恢复的信息，并阻止“空结果/缺证据/失败被吞掉”进入成功状态。

字段边界补充：WorkEvidence 的通用字段是 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`。`diagnostics` 和 `outputSummary` 只放低噪声事实，raw stdout、HTTP body、网页正文和长日志必须留在 refs。TaskStage 可以嵌入 `workEvidence` 摘要，但 TaskStage 不是 WorkEvidence，避免让 project schema 和 evidence schema 互相冒充。

与 T097 的关系：T096 是证据 schema、guard 和失败归一化层；T097 是任务复杂度路由和多阶段 project runtime 层。T096 不决定任务是否要拆成多阶段，也不维护复杂度算法；T097 不重新定义证据字段或失败语义，而是在每个 stage 边界调用 T096 的 WorkEvidence contract。

核心原则：

- SciForge 不维护领域专用搜索策略，不硬编码某个 provider、某个 scenario 或某条 prompt 的答案；只定义通用证据形状、失败语义和恢复边界。
- Backend 可以使用自己的原子工具和通用能力，但返回给 SciForge 的 search/fetch/read/write/command/validate 结果必须能被归一成 provider/query/status/resultCount/evidenceRefs/failureReason/recoverActions 等可审计字段或摘要。
- 可复现性优先于纯直答：凡是依赖新外部检索、本地文件、命令或产物生成的回答，默认应留下可运行任务、输入、输出、日志和证据 refs；轻量查询也应是薄 adapter/spec，而不是不可复现的临场自然语言回答。
- 轻量查询的优化目标不是绕过写代码，而是避免为一次性搜索生成重型 pipeline：优先复用稳定 runtime capability 或生成最小 adapter，限制 provider 数、结果数、超时、下载范围和输出体积。
- Raw stdout、HTTP body、网页正文和长日志继续保存在 workspace refs；handoff 给 agent 的默认内容应是结构化摘要、证据引用和可行动 nextStep。
- 外部检索、下载、API 调用、数据库查询等 I/O 任务如果没有明确失败诊断、provider status、fallback 尝试或可信空结果说明，不得被标记为高置信成功。
- Python 负责证据相关策略解释、repair/continuation 决策和可调规则；TypeScript 负责 runtime 执行壳里的事件适配、schema 校验、guard 调用、ref 持久化和 UI 投影。
- WorkEvidence 是跨 provider、跨 scenario、跨 backend 的通用 contract；不得为单一 provider、scenario、prompt 或固定错误文本增加专用成功/失败规则。

Todo：

- [x] 新增通用 `work-evidence-guard`：对 ToolPayload 做跨领域 evidence 检查，先覆盖“外部检索返回 0 结果但缺少 provider status / fallback / failed-with-reason”的 repair-needed 守门。
- [x] 将 generated task runner 接入 evidence guard：schema 合法、exitCode 为 0 但证据不足的检索结果也进入 repair，而不是展示为成功。
- [x] 为 generated task runner guard 增加 attempt history / repair smoke：覆盖 exitCode=0 且 0 result 无诊断进入 repair-needed、0 result 有 provider/fallback 诊断放行、command failed evidence 进入 repair-needed、正常 generated task 放行，并验证 refs 与 `failureReason` 保留。
- [x] 在 AgentServer generation/repair prompt 中补充外部 I/O reliability contract：要求 bounded timeout、retry/backoff、provider status、fallback 记录、失败时写 `failed-with-reason` ToolPayload。
- [x] 定义 runtime-side `WorkEvidence` schema：覆盖 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`，作为 UI WorkEvent 之外的审计/恢复真相源。
- [x] 新增 TypeScript backend tool event adapter：把 Codex/Claude/Gemini/Hermes/OpenTeam Agent 等 backend 的通用 search/fetch/read/command/validate tool stream 归一成 `WorkEvidence`，UI 的 `WorkEventKind` 优先消费该结构或降级到现有文本 classifier；不按 provider/scenario/prompt/固定错误文本写专用分支。
- [x] 将 `WorkEvidence` 摘要写入 Task Project stage 记录和 bounded handoff，让 agent backend 能从 project/stage 继续读取低噪声执行事实。
- [x] 将 `WorkEvidence` 摘要继续接入 attempt history / repair context 全链路，避免 repair/continuation 反复读取 raw logs。
- [x] 将轻量可复现 adapter 的证据要求沉淀为 WorkEvidence guard fixture；执行模式选择、是否走 adapter 或 Task Project 归 T097 处理。
- [x] 扩展 guard：覆盖 claim 声称 verified 但无 evidence refs、command exitCode 非 0 却成功、fetch timeout/429 被吞、artifact 缺少 dataRef/schema 字段等通用假成功模式。
- [x] 增加 runtime WorkEvidence schema 与 guard 单测：覆盖每个 guard、schema 校验和正常放行路径，并通过 `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts` 与 `npx tsc --noEmit`。
- [x] 增加 T096 端到端 fixture：模拟外部 provider 429、timeout、空结果、fallback 成功和 fallback 耗尽，验证 WorkEvidence、最终 payload 状态、attempt history、repair context 和下一轮 context envelope 都能表达真实状态；不重复覆盖 T097 execution mode 路由。
- [x] 扩展真实 AgentServer/backend stream smoke：经 `runWorkspaceRuntimeGateway`、AgentServer `/runs/stream` 协议和 UI runtime callbacks 验证 backend tool/provider events 可被通用 adapter 归一成 WorkEvidence，并进入 direct payload guard、attempt history、repair context、context envelope 和 UI process events。

验收标准：

- [x] Agent backend 仍负责策略和推理；SciForge 只提供证据归一化、失败守门、artifact/ref 持久化和恢复上下文，并保留可复现任务证据链。
- [x] 外部检索类任务在缺少 provider status/fallback/failure 证据时不会被标记为成功。
- [x] 下一轮 repair/continuation 能看到结构化 WorkEvidence 摘要，并据此换 provider、调整 query、请求用户补充或诚实失败；真实 AgentServer stream fixture 已覆盖 provider 429、timeout、empty result、fallback success、fallback exhausted 的 direct backend path。
- [x] 外部 I/O 的 `success` / `partial` / `empty` WorkEvidence 必须带 durable `evidenceRefs` 或 `rawRef`；无 ref 的 direct backend 成功会进入 `repair-needed`，避免不可复现直答伪装成可审计结果。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts`
- `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts`
- `node --import tsx --test src/ui/src/streamEventPresentation.test.ts`
- `npx tsx tests/smoke/smoke-t096-work-evidence-provider-fixtures.ts`

剩余风险：

- 已覆盖本地 AgentServer stream 协议、runtime direct payload path、stream `WorkEvidence` 到 UI `WorkEvent` atoms 的结构化优先链路，以及 snake_case、nested input/arguments/params、nested response/provider_status/request 字段漂移；长期真实 provider 运行中仍需把新增字段变体继续收敛到通用 adapter。
- Backend tool stream 到 WorkEvidence 的通用 adapter 已覆盖 search/fetch/read/command/validate 事实；低噪声摘要质量仍依赖 backend 是否提供 query/url/status/resultCount/ref 等结构化字段。
- 轻量 adapter 的证据要求已有 guard 与 runtime fixture 覆盖；无 durable refs 的外部 I/O 成功已会 repair-needed，剩余风险是产品运行中 backend 可能给出语义很弱但格式合法的 refs，需要靠后续审计质量测试收敛。

### T095 主对话栏 WorkEvent 原子事件层

状态：已完成本轮实现，继续跟踪后续增强。本任务承接 Cursor Agent 对标体验修复：主对话栏不直接平铺 raw stream，而是先把后台事件归纳成可复用的原子 WorkEvent，再由统一 presenter 决定“显示一句过程摘要、折叠详细内容、二级折叠 raw output”。目标是让复杂多轮任务，例如“检索最近一周 AI + 虚拟细胞的文章，并写总结报告”，在运行中持续显示 `Explored...`、`Searched...`、`Fetched...`、`Read...`、`Wrote...`、`Ran...`、`Waiting...` 等可理解摘要，同时避免把上下文窗口、usage、AgentServer JSON 和脚本 payload 直接淹没主对话。

实现语言原则：

- TypeScript 负责 UI 事件壳、stream presenter、React 展示策略和前端 fixture tests，因为这些逻辑紧贴浏览器主对话栏和 TS domain contract。
- Python 继续作为算法/策略唯一真相源，后续若要让 backend 主动发出结构化 work event hints，应落在 `packages/conversation-policy-python` 或 runtime policy bridge 中；TypeScript 只消费 schema，不复制长期策略算法。
- 原子事件必须是通用 schema / classifier / summarizer / display policy，不得按固定 prompt、固定 scenario、固定工具名、固定 DOM 或固定论文任务做特例补丁。

Todo：

- [x] 定义主对话栏原子事件分类：`plan`、`explore`、`search`、`fetch`、`read`、`write`、`command`、`wait`、`validate`、`artifact`、`recover`、`diagnostic`、`message`、`other`。
- [x] 新增 `src/ui/src/workEventAtoms.ts` 单文件原子事件层：集中维护事件类型、分类、摘要、raw 格式化和主对话栏可见性，后续针对 Search/Read/Fetch 等事件加强时只改这一处。
- [x] 改造 `streamEventPresentation.ts`：保留现有对外 API，但内部使用 WorkEvent 模块生成 worklog counts、operation line、raw output 和 summary，避免大文件继续堆分类规则。
- [x] 改造 `RunningWorkProcess.tsx`：运行中主对话栏只展示最近的高价值操作摘要；详细事件默认折叠，raw output 二级折叠。
- [x] 覆盖通用 fixture：AgentServer taskFiles payload 被显示为简洁写入摘要，不泄露脚本 JSON；上下文窗口和计划事件不进入 running live rows；搜索/读取/写入/执行/等待都有稳定摘要。
- [ ] 后续让 Python conversation policy/runtime 在合适时机发出结构化 `workEvent` hints，减少 TypeScript 对自然语言和 raw tool 文本的启发式归类。
- [ ] 扩展 `validate`、`artifact`、`recover` 的真实端到端 fixture：覆盖验收、产物引用、失败恢复和多轮追问上一轮对象。
- [x] 增加 browser smoke：用通用结构化 running work fixture 验证主对话栏 running 摘要、默认折叠、raw output 二级折叠和最终回答优先级；右侧结果栏对象渲染另行跟踪。

验收标准：

- [x] 主对话栏工作过程展示由原子事件模块驱动，不依赖单一任务或固定场景。
- [x] 默认视图可感知 agent 工作过程，但不平铺 raw JSON、长 stdout 或上下文诊断。
- [x] 相关 unit tests、typecheck 和生产 build 通过。

### T094 Cursor Agent 对标体验一致性测试矩阵

状态：进行中。本任务用于把 SciForge 的对话体验向 Cursor agent 的成熟交互模式靠齐。目标不是逐像素复刻 Cursor，也不要求底层行为、工具实现或文案完全一致；目标是同一批真实用户任务在 Cursor agent 和 SciForge 中都能形成一致的用户体验预期：用户能看懂 agent 正在做什么、关键过程默认不过载、可展开审计、有失败恢复线索、最终结果和执行过程边界清楚。

核心原则：

- 每个体验任务必须用同一套测试案例同时跑 Cursor agent 和 SciForge，记录两边的用户可见过程、折叠层级、最终回答、失败/等待状态和恢复入口。
- 对标的是体验语义，不是实现细节：Cursor 中的搜索、读取、fetch、工具输出、消息折叠和最终回答结构，可以映射到 SciForge 的 stream events、ExecutionUnit、artifact、notebook、object reference 和 workspace refs。
- 所有修改必须通用，不能为了某一个截图、某一个 scenario、某一个任务名或某一种 backend 做补丁；不得在代码里硬编码 `literature-evidence-review`、`arxiv_agent_harness`、固定文案片段、固定 DOM 路径或固定 tool 名称。
- 体验规则要沉淀为可复用模型：过程事件归类、折叠策略、摘要生成、失败恢复、对象引用、长任务等待状态都应由通用 schema / presenter / policy / fixture 驱动。
- 测试必须优先覆盖用户行为和可见状态：同一个任务在两边都应该能回答“当前在做什么、做过什么、哪里失败了、下一步怎么办、哪些输出可以点开验证”。

Todo：

- [x] 建立 Cursor/SciForge 对照测试清单：至少覆盖文献调研、代码修改、文件探索、长时间等待、工具失败恢复、多轮追问、运行中追加指令和最终结果审计；每个案例都记录 Cursor agent 的可见行为和 SciForge 的期望体验语义。
- [ ] 为“文献调研长任务”建立通用 UX fixture：同一 prompt 分别在 Cursor agent 和 SciForge 中运行，检查过程摘要是否默认折叠、展开后是否能看到搜索/抓取/读取/工具输出、最终报告是否不被 raw log 淹没；不得针对 arXiv、agent harness 或某个场景写死规则。
- [ ] 为“代码修改任务”建立通用 UX fixture：同一 repo 修改请求分别运行，检查是否展示读取文件、编辑文件、运行测试、失败重试和最终 diff/测试证据；SciForge 侧必须通过 ExecutionUnit / object reference / stream event 通用模型表达，不能按具体文件名或测试命令硬编码。
- [ ] 为“长时间无新事件/后台等待”建立通用 UX fixture：模拟 backend 60s+ 没有新事件但 HTTP stream 未结束，检查 Cursor 和 SciForge 都能给用户稳定的等待状态、最近真实事件、可能原因和安全的中止/继续入口；等待文案必须来自通用 process progress policy。
- [ ] 为“工具输出过长”建立通用 UX fixture：同一任务产生大段 stdout、JSON、网页正文或 raw tool output，检查两边都默认折叠低价值输出，只露出摘要和可展开入口；SciForge 侧不得把完整 raw payload 直接平铺到主消息。
- [ ] 为“多轮追问上一轮结果”建立通用 UX fixture：先生成报告/文件/图表，再追问“继续、修复、文件在哪里、基于上一轮补充”，检查 Cursor 和 SciForge 都能引用上一轮工作且不污染新任务；SciForge 侧必须依赖 workspace refs、artifact refs 和 conversation policy，不靠 prompt 字符串特判。
- [ ] 为“失败和恢复”建立通用 UX fixture：同一任务触发网络失败、模型失败、工具失败或验收失败，检查两边都能在主对话中给出可理解失败原因、已尝试动作、下一步恢复建议和可点击证据；SciForge 侧失败状态必须进入下一轮上下文。
- [x] 为“运行中追加用户引导”建立通用 UX fixture：任务执行中用户追加约束或纠偏，检查两边都能明确显示该引导已排队/已合并/被拒绝的状态；SciForge 侧不能靠单个场景定制，必须复用 guidance queue 和 run orchestration contract。
- [ ] 抽象“Cursor-like worklog presenter”验收标准：定义过程摘要、默认折叠、展开明细、raw output 二级折叠、最终回答优先级、失败状态 badge、复制/查看原始证据等通用规则，并为 React presenter 增加 fixture tests。
- [ ] 增加 browser smoke：在同一套 fixture session 下打开 SciForge，断言 running message 默认只展示紧凑过程摘要，展开后可见操作明细，最终 scenario message 默认收起执行审计，结果区仍能展示 artifact 和失败恢复入口。
- [ ] 增加人工对照记录模板：每个 Cursor/SciForge 对照案例记录“任务、输入、Cursor 观察、SciForge 观察、差异是否影响体验、是否需要通用修复、关联测试命令”，避免把一次性主观反馈变成代码特判。

对照测试矩阵 v1：

通用记录规则：每个案例用同一份用户输入分别在 Cursor agent 和 SciForge 中运行；记录时只比较用户可见体验语义，不比较底层工具名、DOM 结构、模型固定措辞、具体文件名、具体 backend 或特定 scenario 名称。自动化断言应基于稳定事件类型、可见状态、折叠层级、引用对象、错误状态和结果结构；人工观察项只判断可理解性、负载感、信任感和是否需要通用修复。

1. 文献调研长任务
   - 用户输入：要求 agent 围绕一个科研问题查找近期公开资料，筛选高质量证据，输出带来源、结论分级和不确定性的简短报告。
   - Cursor 观察点：是否展示检索、打开来源、阅读/摘要、整理证据等阶段；过程是否默认紧凑；展开后能否看到关键来源和原始证据入口；最终报告是否优先于日志。
   - SciForge 观察点：stream events 是否归并为研究阶段；ExecutionUnit 是否保存检索、读取、摘要和报告生成证据；artifact / object reference 是否可点开审计；raw 网页正文或工具输出是否二级折叠。
   - 体验一致性标准：两边都让用户知道“正在找证据、读证据、综合证据、输出结论”，并且默认视图不被原始日志淹没。
   - 可自动化断言：存在至少两个不同过程阶段；默认主消息中 raw payload 字符量低于预算；展开审计后存在来源引用或证据对象；最终回答和过程审计分区可区分。
   - 人工观察项：报告可信度是否可判断；来源是否足够可追溯；用户是否能在不展开所有日志的情况下理解进展。

2. 代码修改任务
   - 用户输入：要求 agent 在当前仓库中修复一个可复现的小缺陷或增加一个窄范围能力，并在完成后运行相关验证。
   - Cursor 观察点：是否展示文件探索、读取、编辑、测试、失败重试和最终 diff/验证结果；是否把命令输出和代码 diff 放在可审计但不过载的位置。
   - SciForge 观察点：是否用通用 ExecutionUnit / workspace refs 表达读取、编辑、验证和结果；修改文件、测试证据、失败重试是否被记录为对象引用；最终回答是否明确边界。
   - 体验一致性标准：两边都能回答“改了什么、为什么改、怎么验证、还有什么风险”，不要求展示完全相同命令或文案。
   - 可自动化断言：运行记录中存在读取、写入或补丁、验证三类事件；最终结果包含变更摘要和验证状态；失败验证不会被当作成功隐藏；引用对象不依赖固定文件名匹配。
   - 人工观察项：diff 是否容易定位；测试失败时是否能看懂下一步；是否避免把完整终端噪声铺在主对话里。

3. 文件探索与定位任务
   - 用户输入：要求 agent 找出某个功能、配置、契约或数据流大概在哪里实现，并说明关键入口、调用链和后续修改建议，但暂不改代码。
   - Cursor 观察点：是否展示搜索、打开候选文件、排除错误路径和总结调用链；是否区分“已确认位置”和“推测位置”。
   - SciForge 观察点：是否将搜索和读取归纳为探索阶段；workspace refs 是否指向被引用对象；结论是否和探索证据关联，而不是只给自然语言断言。
   - 体验一致性标准：两边都能让用户理解 agent 如何缩小范围，并能从结论跳回证据。
   - 可自动化断言：存在搜索/枚举类事件和读取类事件；最终回答包含多个可点击或可审计引用；主视图显示候选范围摘要，完整输出默认折叠。
   - 人工观察项：排除路径是否有解释；结论是否过度自信；用户是否能据此继续交给 agent 修改。

4. 长等待与静默后台任务
   - 用户输入：要求 agent 执行一个可能耗时的操作，例如长时间构建、批处理、远程请求或大文件分析，并让它完成后汇报。
   - Cursor 观察点：在 60s+ 无新可见事件但 run 未结束时，是否仍显示稳定运行状态、最近真实动作、可中止入口和合理等待说明。
   - SciForge 观察点：process progress policy 是否在静默窗口生成等待状态；最近事件、持续时间、可能原因和中止/继续入口是否通用展示；不会伪造不存在的新动作。
   - 体验一致性标准：两边都降低“卡死了吗”的不确定性，同时保留用户安全退出或继续等待的选择。
   - 可自动化断言：静默超过阈值后出现等待状态；等待状态引用最近真实事件；存在取消或停止入口；没有把等待提示写成固定任务名或 backend 名。
   - 人工观察项：等待文案是否诚实；用户能否判断是否要中止；等待状态是否过度频繁或打断最终结果。

5. 工具失败与恢复任务
   - 用户输入：要求 agent 完成一个需要外部工具、网络、测试命令或本地环境的任务，并通过断网、缺依赖、权限不足或命令失败制造一次失败。
   - Cursor 观察点：是否显示失败发生在哪一步、尝试过什么、失败证据在哪里、是否自动换路或请求用户补充。
   - SciForge 观察点：failureReason、attempt history、recoverActions、日志引用和 nextStep 是否进入运行状态和下一轮上下文；失败 badge 是否清楚但不过度占据主结果。
   - 体验一致性标准：两边都把失败解释成可行动的信息，而不是只暴露异常堆栈或静默结束。
   - 可自动化断言：失败事件包含原因类别、证据引用和恢复建议；最终状态不是 success；下一轮上下文能读取上一轮失败摘要；原始错误默认折叠。
   - 人工观察项：失败说明是否足够具体；恢复建议是否安全；用户是否能自然地追问“继续修复”。

6. 工具输出过长任务
   - 用户输入：要求 agent 运行会产生大量 stdout、JSON、表格、网页正文或日志的操作，并基于结果给出摘要。
   - Cursor 观察点：是否默认只显示摘要、关键片段和展开入口；是否允许查看完整输出；最终答案是否不被 raw output 推走。
   - SciForge 观察点：raw output 是否进入二级折叠或 artifact；主消息是否展示 compact summary、计数、截断说明和原始证据引用；复制/查看原始内容入口是否存在。
   - 体验一致性标准：两边都保留审计能力，同时默认保护主对话阅读体验。
   - 可自动化断言：超过预算的 payload 不直接出现在主消息；可展开区域或 artifact 保存原始内容；摘要包含输出规模或截断提示；最终回答显示在 raw output 之前或独立结果区。
   - 人工观察项：摘要是否覆盖用户关心的信息；展开层级是否自然；长输出是否影响滚动和定位。

7. 多轮追问上一轮结果
   - 用户输入：第一轮要求生成报告、文件、图表或代码修改；第二轮追问“继续完善上一轮结果”“文件在哪里”“基于刚才输出补一个限制条件”。
   - Cursor 观察点：是否能引用上一轮工作产物；是否避免把旧任务重新做一遍；是否清楚说明复用了哪些上下文。
   - SciForge 观察点：conversation policy 是否通过 workspace refs、artifact refs、session ledger 和 failure/acceptance state 恢复上下文；新一轮是否生成独立过程记录，不污染旧结果。
   - 体验一致性标准：两边都能自然延续上一轮，同时让用户区分旧产物和新动作。
   - 可自动化断言：第二轮 request context 包含上一轮对象引用摘要；最终回答引用旧产物但生成新轮状态；没有依赖固定追问文本做特判；旧 failure 状态在相关时可见。
   - 人工观察项：用户是否需要重复交代背景；上下文恢复是否过度带入无关历史；“文件在哪里”是否能直接定位。

8. 运行中追加用户引导
   - 用户输入：启动一个长任务后，在运行中追加约束、纠偏或优先级变化，例如要求缩小范围、跳过某类步骤、改用更保守输出格式。
   - Cursor 观察点：追加消息是否显示为已收到、排队、合并或无法应用；最终结果是否说明采用了哪些追加约束。
   - SciForge 观察点：guidance queue 和 run orchestration contract 是否记录追加引导状态；stream 是否展示被接收、延后或拒绝的原因；下一轮是否能看到该引导历史。
   - 体验一致性标准：两边都不让追加引导消失；若不能即时应用，也要给出可理解状态。
   - 可自动化断言：追加消息有明确状态；运行记录包含 guidance 接收时间和处理结果；最终回答或审计记录能引用追加约束；拒绝或延后不依赖固定任务类型。
   - 人工观察项：用户是否相信引导被听见；合并时机是否合理；冲突引导是否解释清楚。

9. 最终结果审计任务
   - 用户输入：要求 agent 完成一个多步任务后，明确给出最终结论、产物位置、关键证据、验证状态和未完成风险。
   - Cursor 观察点：最终回答是否和过程日志分离；是否有可展开的工作记录、产物链接、验证证据和剩余风险；失败或部分完成状态是否醒目。
   - SciForge 观察点：scenario message、artifact、ExecutionUnit、object reference 和 verifier 结果是否能组成可审计最终包；默认视图是否优先展示结果，审计内容可展开。
   - 体验一致性标准：两边都让用户先看到“结果是什么”，再能按需追溯“怎么来的”。
   - 可自动化断言：最终状态包含结果摘要、产物引用、证据引用和验证/风险字段；执行审计默认收起；失败或部分完成不会显示为完全成功；断言不匹配固定输出文本。
   - 人工观察项：结果边界是否诚实；证据链是否足够短而可用；用户是否能把结果交给下一轮继续。

验收标准：

- [ ] 至少 8 个真实任务案例完成 Cursor agent 与 SciForge 双跑对照，且每个案例都有可复用 fixture 或人工记录。
- [ ] SciForge 的对话体验在过程展示、折叠层级、失败恢复、最终结果优先级和多轮延续上与 Cursor agent 的用户预期一致，即使底层实现和文案不完全相同。
- [ ] 新增或修改的测试不依赖单一 scenario、单一 backend、固定任务名、固定文件名或固定模型输出文本。
- [ ] 任何 UX 修复都落在通用 presenter、policy、schema、runtime event normalizer 或 browser smoke 上，不在业务代码里硬编码特殊案例。
- [ ] `npm run typecheck -- --pretty false`、相关 unit tests 和 browser smoke 均通过。

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
