# SciForge - PROJECT.md

最后更新：2026-05-17

## 当前目标

用 Codex in-app browser 对 SciForge 进行真实、复杂、多轮的科研与 coding 端到端任务牵引。P1-P6 不是替项目“找通过证据”，而是代替真实用户严格使用、评测和挑战 SciForge：只要网页主回复没有真正解决用户问题，就必须判失败、记录证据、用 sub agents 定位并修复通用根因。

产品方向更新（2026-05-17）：默认用户体验应是一个通用聊天工作台，而不是让普通用户先理解或配置“场景”。场景、Scenario Builder、UI allowlist、失败策略、契约、质量检查、发布运行等信息默认属于调试/高级自定义面板；专业化优先由 SciForge 暴露 `capability_discovery` 原子 API，让 AgentServer/backend 在能力不足、任务需要专业组件、provider 失败或验证失败时自主检索、展开和规划 skills/tools/artifacts/verifiers/UI 模块；用户只在高风险权限、凭据、文件或偏好 profile 上显式介入。该模块目前是 **partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation**，专项设计见 [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)。网页端与执行层必须进一步解耦：UI 只通过函数式 Projection/UserAction API 展示、预览和干预数据，不直接解释 AgentServer 原文、handoff、stdout/stderr 或 workspace 内部结构；专项设计见 [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)。

所有修改必须通用：不能为某个 prompt、端口、backend、provider、文件名、论文题目、错误文本或浏览器会话写特例。多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)，harness 行为入口参考 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)。

## 历史归档

- 2026-05-14/15 旧 CAP/PKG/GT/PSM/MEM/H022 与早期稳定性任务：[`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。
- 2026-05-16 Browser Multiturn Stability Sprint、PBT/P1/P2/P3/P4/ARC/MTG 长任务板与 issue 细节：[`docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`](docs/archive/PROJECT-history-2026-05-16-browser-sprint.md)。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。
- [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)：partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation 的层次化能力检索与集成模块，定义 agent-callable discovery API、分层揭示、审计和实现任务。
- [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)：目标状态的 UI / 执行层解耦方案，定义函数式 Projection/UserAction API、canonical view models、completion-candidate 和 debug folding 边界。

## 不变原则

- 真实 browser 优先：每个活动进程必须用 Codex in-app browser 完成端到端多轮任务；terminal smoke 只能作为补充验证，不能替代用户可见证据。
- 任务成功优先：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地解决；只显示 `satisfied`、只恢复 refs、只无 raw leak、只无 Projection wait 都不是充分条件。
- 反假成功优先：网页里“有回答”不等于成功。如果用户要求调研、下载、阅读全文、写报告、复现实验、修改代码或生成 artifact，主回复必须证明这些动作实际完成、内容是否正确；只给概述、计划、空泛引用、`Verification: 未验证`、recover action、refs 列表或错误包装，全部算 `TaskSuccess=false`。
- 速度不能靠快失败冒充：可以更早展示计划、进度、partial answer 和 recover action，但不能跳过 provider/tool、artifact grounding、verification boundary 或最终质量。
- 所有修复必须通用：修架构薄腰、contract、profile、manifest、Projection、ArtifactDelivery、gateway、policy 或 UI boundary，不写 prompt/provider/session/端口特例。
- Capability 必须成为生成层可执行 authoring contract：已有 ready provider/tool route 时，backend prompt 必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton。
- Capability Discovery 必须成为 agent 可调用的原子能力（partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation）：初始 context 只暴露极简 API brief；agent 自主调用 `search/expand/plan/explain` 做分层揭示；runtime/harness 只负责预算、权限、审计、no-secret/no-endpoint leakage 和 provider-first preflight 兜底。当前已有 contract/service/manifest/tiny brief/generated-task helper bridge、AgentServer stream-side tool-result bridge、session-bundle audit records、workspace ledger replay event、bounded retry consumption bridge、`ProjectionApi.getCapabilityPlanSummary` 最小用户摘要和 debug folding action boundary；仍需补齐真实 P1-P6 browser 验收；设计细节以 [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md) 为准。
- 多轮记忆边界保持 Single-Agent runtime contract：Workspace Kernel ledger/ref store 是事实源；AgentServer Context Core 负责 retrieval/compaction/handoff；backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- UI / 执行层解耦必须函数化（目标设计）：网页端只能通过 `ProjectionApi`、`UserActionApi`、`ProjectionSubscriptionApi` 等稳定函数读取 projection、预览 artifact、订阅状态和提交用户动作；这些 API 是语义函数 contract，不绑定 HTTP。UI 不得从 raw ToolPayload、AgentServer direct text、handoff JSON、stdout/stderr 或 task attempt 中推断完成态。设计细节以 [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md) 为准。
- 设计和实现保持同一真相源：代码改变 contract 时同步更新相关设计文档和本文件。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并；旧兼容逻辑若与最终 contract 冲突，默认移除。
- 长文件治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先按职责拆分；超过 3000 行视为维护风险。
- 通用聊天优先：普通用户不应被场景名、builder tabs、内部 run id、contract/allowlist/debug 细节打断；这些信息应折叠到高级/调试视图，主界面只暴露问题输入、自动能力选择摘要、主要答案、关键 artifact 和下一步行动。
- 自主能力发现优先：除非用户明确进入自定义模式，SciForge 应让 backend 基于当前 compact brief 和 `capability_discovery` API 自主检索、展开、组合 skills/tools/UI/verifier；用户最多需要确认高风险操作、补充凭据/文件、或修正自动选择。
- 主回复判定优先：评测时以网页主回复是否真的解决用户问题为第一标准；结果面板、执行单元、证据矩阵和 debug refs 只能作为审计证据，不能替代用户可读答案。

## 当前 Milestone：Strict User-Proxy Evaluation + UX Simplification Gauntlet

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：并行启动 P1-P6 独立网页进程，由每个进程代替真实用户严格使用 SciForge。每个进程必须完成“真实任务 -> 严格评测 -> UX 冗余/失败复现 -> sub-agent 通用修复 -> browser 复验 -> 更新 PROJECT.md -> 同步 GitHub”的闭环。历史残余 run、旧 evidence 和旧 `done` 结论不作为本轮成功依据。

### Milestone Gates

- [ ] **Browser E2E Gate**：每个进程必须像真实人类一样在 in-app browser 中点击、查看、选择 artifact、reload 和继续追问；默认直接从 Web UI 与 workspace 产物判断结果，不为每轮维护第二份 evidence。
- [ ] **Lightweight Trace Gate**：每个自主探索 milestone 只需在 `PROJECT.md` 记录结论级信息：用户目标、当前状态、关键 run/session 或 workspace artifact、success/failure reason、root boundary 和下一步。
- [ ] **Escalated Evidence Gate**：只有失败、假成功、修复前后对比、UI 与 workspace 证据不一致、或 milestone 提交前需要验收凭据时，才保存截图/DOM/console/network/timing 等完整 evidence。
- [ ] **Hard Requirements Gate**：每轮先列出用户 hard requirements；只有逐条证明完成，才可判 `TaskSuccess=true`。
- [ ] **Strict Evaluation Gate**：P1-P6 必须代替用户判断主回复是否真的解决问题；“有文字输出但未完成动作”必须判失败。
- [ ] **Universal Chat Gate**：普通用户入口必须表现为通用聊天；专业化由 agent 调用 `capability_discovery` 后选择 skills/tools/verifier/UI 完成，场景名称和 Scenario Builder 不得成为完成任务的前置心智负担。
- [ ] **Discovery API Gate**：完成 [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md) 中 partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation 的 API 闭环；AgentServer handoff 必须包含极简 `capability_discovery` API brief，且 backend/generated task 必须能通过稳定 Gateway/tool-call/helper surface 真实调用 `search/expand/plan/explain` 并消费结果；完整 registry/schema/examples/providers 只能通过 search/expand/plan/explain 分层揭示，不得一次性注入 prompt。
- [ ] **UI/API Decoupling Gate**：落实 [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md) 的函数式 Projection/UserAction API；网页端只消费 canonical view models 和 action results，不直接读取或解释 raw execution/handoff/debug 数据。
- [ ] **Debug Surface Gate**：Scenario Builder、UI allowlist、Artifacts、失败策略、场景契约、质量检查、发布运行、run/audit/raw payload 等默认折叠为调试/高级面板；除非用户主动展开，否则不能挤占主任务界面。
- [ ] **Answer-First Results Gate**：右侧结果区先显示“最终是否解决、主答案、关键证据、下一步”，再折叠运行细节；如果需要人工处理，应说明缺什么，而不是把大量 audit/debug 内容作为主结果。
- [ ] **Root-Cause Gate**：每个 P0/P1 失败必须定位到 policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence 边界。
- [ ] **General Fix Gate**：修复后必须证明没有 prompt/provider/task 特例，并补 targeted tests 或 conformance fixture。
- [ ] **Speed Gate**：记录首个有用反馈和最终收敛时间；慢路径必须进入 discovered task。
- [ ] **Sync Gate**：完成一个 milestone 后更新本文件、提交并 push 到 `origin/main`。

### Sub-agent Protocol

- [ ] 每个进程尽可能使用 sub agents 加速推进：browser 复现、代码勘察、root-cause 定位、通用修复、测试补齐、workspace 证据核查可以并行拆分。
- [ ] 每批 sub agents 必须围绕一个明确 milestone 工作；启动前在对应 `P*-TASK` 或 `DISC-*` 下写清目标、owner、预期验收方式。
- [ ] Process owner 负责整合 sub agent 结果，避免多个 sub agents 修改同一文件、重复记录证据或覆盖 workspace 产物。
- [ ] 完成一个 milestone 后，必须更新 `PROJECT.md`、提交并 push GitHub、关闭上一批 sub agents，再启动下一批 sub agents。
- [ ] 可以动态发现新任务、调整中间任务和重排优先级；调整必须服务最终目标：真实用户任务成功率更高、速度更快、修复更通用。
- [ ] 如果 sub agent 发现的问题不是当前 milestone blocker，也要写入 `Discovered Task Queue`，不能用临时代码绕过。

### Worker 打勾规则

- [ ] Worker 认领任务后，将对应状态改为 `in_progress`，并写清本批自主探索目标。
- [ ] 每完成一个有意义的探索 milestone，更新任务状态和结论；不要求每轮都截图、dump DOM 或维护 evidence manifest。
- [ ] 每完成一条验收，立即勾选对应验收项；不能用“后续会补”提前打勾。
- [ ] 发现新通用问题时，追加到 `Discovered Task Queue`，并至少勾选“最小复现”或说明 blocker。
- [ ] 任务全绿后，将状态改为 `done`，在 Activity Log 增加一行摘要，并同步 GitHub。

## 并行进程矩阵

每个进程独立端口、workspace、state 和 config。机器资源不足时先跑 P1-P4，P5/P6 排队。

| 进程 | 严评主题 | UI | Writer | AgentServer | Workspace | State | Config |
|---|---|---:|---:|---:|---|---|---|
| P1 | 今日 arXiv / 全文科研调研 | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
| P2 | 数据分析 / 可复现实验 | 5273 | 5274 | 18180 | `workspace/parallel/p2` | `.sciforge/parallel/p2` | `.sciforge/parallel/p2/config.local.json` |
| P3 | 论文复现 / 代码调试 | 5373 | 5374 | 18280 | `workspace/parallel/p3` | `.sciforge/parallel/p3` | `.sciforge/parallel/p3/config.local.json` |
| P4 | SciForge 自我改进 coding | 5473 | 5474 | 18380 | `workspace/parallel/p4` | `.sciforge/parallel/p4` | `.sciforge/parallel/p4/config.local.json` |
| P5 | 方法学评审 / 实验设计 | 5573 | 5574 | 18480 | `workspace/parallel/p5` | `.sciforge/parallel/p5` | `.sciforge/parallel/p5/config.local.json` |
| P6 | 长上下文记忆 / 交付物迭代 | 5673 | 5674 | 18580 | `workspace/parallel/p6` | `.sciforge/parallel/p6` | `.sciforge/parallel/p6/config.local.json` |

启动模板：

```bash
SCIFORGE_INSTANCE=p2 \
SCIFORGE_INSTANCE_ID=p2 \
SCIFORGE_UI_PORT=5273 \
SCIFORGE_WORKSPACE_PORT=5274 \
SCIFORGE_AGENT_SERVER_PORT=18180 \
SCIFORGE_WORKSPACE_PATH=workspace/parallel/p2 \
SCIFORGE_STATE_DIR=.sciforge/parallel/p2 \
SCIFORGE_LOG_DIR=.sciforge/parallel/p2/logs \
SCIFORGE_CONFIG_PATH=.sciforge/parallel/p2/config.local.json \
SCIFORGE_WORKSPACE_WRITER_URL=http://127.0.0.1:5274 \
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18180 \
npm run dev
```

## Active Task Board

P1-P6 不再使用固定剧本。每个进程只给定人类使用者角色和探索方向，由 worker 自主选择真实任务、调整中间任务、提出新问题，并代表用户严格验收 SciForge。任务可以成功，也可以失败；失败更有价值，但必须转化为通用修复或明确 discovered task。

新一轮任务重点（2026-05-17）：除了功能正确性，每个进程都要挑战“通用聊天 + agent 自主能力发现 + 分层揭示 + 低冗余结果区”的产品假设。任何需要普通用户理解场景 builder、手工配置大批 allowlist、从 run/debug/audit 噪声中找答案、或把未解决问题藏在结果细节里的体验，都必须记录为失败或 UX blocker。

每个进程至少完成一个自主探索 milestone。一个 milestone 的最小闭环是：

- [ ] 选择一个真实用户目标，并写清为什么它属于本进程方向。
- [ ] 用 in-app browser 自然使用 SciForge，不预设“为了通过测试”的提示词。
- [ ] 记录用户 hard requirements，并用网页主回复、artifact、refs、运行结果逐条验收。
- [ ] 判定 `TaskSuccess` 与 `AnswerQuality`，允许判失败。
- [ ] 对失败启动 sub agents：复现、定位、修复、测试、evidence、PROJECT 回写。
- [ ] 完成后更新本文件、提交并 push GitHub、关闭当前 sub agents。

### UX-SYSTEM Universal Chat / Capability Discovery / Debug Folding

状态：active
Owner：Orchestrator + P1-P6
Browser：P1-P6 各自端口
目标：把 SciForge 的默认体验从“选择场景并调 builder”推进到“通用聊天入口 + `capability_discovery` 原子 API + agent 自主检索/展开/规划能力 + answer-first 交付；高级用户仍可进入调试/自定义面板”。

UX-SYSTEM-TASK-20260517-universal-chat-entry：

- 状态：partial P4 shell fix landed / blocked-on-P1-P6-browser-validation
- 用户问题：顶部“文献证据评估场景”等场景标题让用户以为必须先选/理解专业场景；普通用户真正需要的是一个通用聊天界面。
- P4 复验（2026-05-17）：Codex in-app browser 打开 `http://127.0.0.1:5473/`，title `SciForge`、console error 0、默认 DOM 未命中 `ToolPayload` / `stdout` / `stderr` / `raw payload`，但首屏仍显示 `Scenario Runtime` 和 `文献证据评估场景`；因此 Universal Chat Gate 仍不能打勾，root boundary 仍是 UI shell / default profile presentation。
- P4 修复后复验（2026-05-17）：默认 shell 文案改为 `聊天工作台`、`SciForge · ready`、`SciForge 工作台`、`Ask SciForge` 和 `当前上下文`；Codex in-app browser 重新打开 `http://127.0.0.1:5473/`，title `SciForge`、console error 0，默认 DOM 不再命中 `Scenario Runtime` / `Execution Unit` / `文献证据评估场景` / `ToolPayload` / `stdout` / `stderr` / `raw payload`。该修复只关闭 P4 默认 shell blocker；Universal Chat Gate 仍需 P1-P6 跨领域 browser 验收。
- 产品假设：默认入口应是通用 `Ask SciForge` 工作台；场景/模板只是后台 profile 或高级筛选，不是主导航心智模型。用户可以用自然语言要求“查论文”“分析 CSV”“修代码”“复现实验”，AgentServer/backend 在需要时调用 `capability_discovery` 找到合适 skills/tools/artifacts。
- 并行验证：P1-P6 分别在独立端口从空白/默认页面发起一个跨领域任务，禁止先打开 Scenario Builder 配置；记录 handoff 是否暴露 discovery API brief、agent 是否在能力不足时调用 discovery、是否给出清晰能力选择摘要、是否能完成或诚实失败。
- 失败判据：用户必须手动选场景、必须知道专业 tab、或主回复依赖“当前场景”才可理解；自动选错能力但 UI 不允许轻量修正；场景名/内部 profile 成为主答案的一部分。
- 修复方向：引入通用聊天默认 shell；场景选择改为后台 profile badge 或高级菜单；保留 `Target Instance`/selected object 等上下文，但以“当前上下文”呈现，不要求用户理解 scenario package。
- 验收：Browser 复验至少覆盖 literature、data analysis、coding/self-improvement 三类任务；主入口无需打开 builder 即可提交、追踪、查看答案与关键 artifact。

UX-SYSTEM-TASK-20260517-capability-discovery-api：

- 状态：partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation
- Owner：capability_discovery owner / Codex
- Root boundary：Capability Manifest Registry / Capability Discovery service / Gateway invocation surface / AgentServer handoff brief / generated-task authoring contract。Discovery 只 search/expand/plan/explain，不执行用户任务；执行仍必须走 `invoke_capability` / Capability Gateway。
- 本批自主探索目标（2026-05-17）：实现 agent-callable `capability_discovery` 原子能力最小闭环，初始 handoff 只暴露 tiny API brief；完整 registry/schema/examples/providers 只能通过 progressive disclosure 获取；输出必须有 ref/audit 形状和 no-secret/no-endpoint/no-workspace-root leakage guard；补 targeted tests 证明 discovery recommendation/plan 不会被当作任务完成证据。
- Sub-agent 批次计划：1) explorer 勘察 registry/broker/handoff/generated-task 入口与现有 tests；2) worker 可在 disjoint files 上补 tests 或文档回写；owner 负责实现整合、PROJECT 同步与最终验收。
- 当前事实（capability_discovery owner 2026-05-17）：已完成 `packages/contracts/runtime/capability-discovery.ts` contract/types、核心 `capability_discovery` manifest、`src/runtime/capability-discovery.ts` service、AgentServer context-envelope tiny brief、generation prompt tiny brief、generated-task authoring guidance、generated-task helper bridge、AgentServer stream-side tool-call -> tool-result bridge、session-bundle sanitized audit record、workspace ledger/replay event refs、bounded retry result consumption、leakage guard 和 targeted tests；生成任务可通过 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)` 调用 bounded discovery；AgentServer stream 若发出 `capability_discovery.*` tool-call，Gateway 会执行 discovery、emit `tool-result`、写入 `records/capability-discovery/*.json` 和 `ledger/events.jsonl`；若单向 stream 无终态结果，dispatch retry 一次并把 compact `capabilityDiscoveryToolResults` 放入 context envelope / generation request / input-runtime metadata；discovery recommendation/plan 标记为 `not-evidence`，不能成为任务完成证据。
- Blocker：当前不能标 done，因为同一 HTTP NDJSON stream 内真正双向 tool response 明确不在本 milestone 范围；已落地的消费 contract 是 bounded retry handoff，会在 discovery tool-call 无终态结果时把 compact `capabilityDiscoveryToolResults` 带入第二次 backend 请求。`ProjectionApi.getCapabilityPlanSummary` 现在可从 discovery search/plan tool-result 生成最小用户摘要并过滤 endpoint/token/workspace-root debug refs，默认 Results UI 能力摘要卡片已接线；能力发现记录已折叠进 debug/advanced UI，并通过 `UserActionApi.openDebugAudit` 语义动作记录安全 refs。剩余未闭环的是真实 P1-P6 browser 验收。
- Sub-agent 结果：Harvey 只读核查确认当前是 contract + tiny handoff brief + runtime service 雏形，最大风险是 contract-only 未接入运行时；建议下一步补失败先行测试：generated task helper 或 Gateway invocation 能真实调用 `capability_discovery.search`，且 discovery plan/recommendation 不能被 ToolPayload/Projection 当作 task success。
- 验证：P4 added generated-task helper invocation coverage in `node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 11/11；`node --import tsx --test src/runtime/capability-discovery.test.ts packages/contracts/runtime/capability-manifest.test.ts` 5/5；capability_discovery owner added AgentServer stream transport / ledger replay coverage in `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts` 9/9 and combined discovery/generated-task suite 25/25；backend retry consumption coverage in `node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts` 6/6；latest combined dispatch/stream/discovery suite `node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts` 19/19；`npm run typecheck` 通过。
- 用户问题：Scenario Builder 中 Skills、Tools、Artifacts、失败策略、契约、质量检查等信息太多；真正有价值的用户配置应少而专业，甚至由 SciForge 在请求后自动选择。
- 设计文档：[`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)，状态为 partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation；当前代码已有 contract、service、manifest、handoff tiny brief、generated-task helper bridge、AgentServer stream-side tool-result/audit bridge、workspace ledger/replay refs、bounded retry result consumption、最小 `CapabilityPlanSummary` projection、debug folding action boundary 和 tests；默认 Results UI 能力摘要卡片已接线，剩余真实 P1-P6 browser 验收尚未闭环。
- 产品假设：默认不让 runtime 固定触发能力检索，而是在初始 context 暴露 `capability_discovery` 原子 API。AgentServer/backend 在当前 compact brief 不足、任务需要专业组件、provider/preflight 失败、verification/repair 需要换路时，自主调用 discovery。
- API 任务：定义并实现/接入 `capability_discovery.search`、`capability_discovery.expand`、`capability_discovery.plan`、`capability_discovery.explain` 的 contract；search 返回轻量候选，expand 只展开被点名能力，plan 返回组合和缺口，explain 面向 UI/audit。
- 并行验证：P1-P6 每个进程选择一个真实任务，记录 agent 是否主动调用 discovery、调用是否分层揭示、是否能在失败后追加/切换能力而不要求用户重填 builder。
- 失败判据：完整 registry/schema/provider 被一次性塞进 prompt；需要用户浏览大量 allowlist 才能开始；系统选错工具后没有 discovery-based 重新规划；discovery 泄漏 endpoint/secret/workspace root；discovery plan 被误当成任务完成证据。
- 修复方向：把 Scenario Builder 降级为 `Advanced / Debug / Customize` 面板；普通模式只显示 discovery plan summary、权限/风险确认和能力选择解释。能力选择与 discovery 调用记录进入审计区。
- 验收：每个进程至少一次无需手动配置 tools/skills 完成或诚实失败；失败时 UI 能说明“缺少哪个能力/权限/证据”，并提供“重新发现能力/启用 provider/补充文件”的单步恢复按钮。

UX-SYSTEM-TASK-20260517-discovery-progressive-disclosure：

- 状态：partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation
- Owner：capability_discovery owner / Codex
- Root boundary：Capability Discovery progressive disclosure / audit refs / leakage guard / handoff budget。该任务与 `capability-discovery-api` 同批推进；本轮不实现复杂学习系统，只保留从 traces/provider failures/verification/repair outcomes 沉淀 demand/ranking/failure/repair hints 的扩展点。
- 当前事实（capability_discovery owner 2026-05-17）：service-level progressive disclosure 已有基础：search 返回 compact candidates；expand 只展开指定 capability，并按 include / schema byte budget 揭示 schemas/examples/providers/validators/repair hints；plan 返回 steps、fallback、missing provider/permission、expected artifacts、user confirmations，并显式 `completionEvidence=not-evidence`；explain 支持 user/debug/audit 粒度；输出和 prompt compaction 均执行 endpoint/auth/workspace-root/secret 防泄漏。Generated-task helper、AgentServer stream-side Gateway 调用桥、session-bundle audit record、workspace ledger/replay refs、bounded retry result consumption、最小 `ProjectionApi.getCapabilityPlanSummary`、默认 Results UI 能力计划卡和 debug folding action boundary 已落地；尚未完成真实 P1-P6 browser 验收。
- 设计文档：[`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)。
- 用户问题：能力生态会越来越大，如果每轮都把所有 manifest、schema、examples 和 provider 状态交给 backend，会拖慢、污染上下文，也让 agent 难以聚焦。
- 产品假设：discovery 必须 progressive disclosure：初始 brief 极小，search 只给候选摘要，expand 只展开少量能力，plan 只给组合和缺口，真正执行仍走 `invoke_capability`。
- 实现任务：为 discovery 输出定义 ref/audit record；记录 query、candidate ids、expanded ids、excluded reasons、provider readiness、budget debits 和 no-secret/no-endpoint 检查。
- 并行验证：用 P1 文献/PDF、P2 数据分析、P4 coding 三类任务检查 prompt/handoff 没有完整 registry 膨胀；agent 仍能通过 discovery 找到必要能力。
- 失败判据：初始 context 包含大 schema/examples；expand 不受 topK/预算约束；discovery 返回内部 endpoint/auth；agent 需要靠固定 prompt 特例才知道能力存在。
- 验收：targeted tests 覆盖 search-only、expand-selected、plan-with-missing-provider、no-secret/no-endpoint leakage、audit replay。

UX-SYSTEM-TASK-20260517-ui-execution-decoupling：

- 状态：in_progress
- Owner：UI-Execution Decoupling Owner
- 本批自主探索目标（2026-05-17）：实现最小函数式 Projection/UserAction API 闭环，让网页端通过 canonical view model 做 projection-only restore、manual artifact preview、selected artifact action、retry/recover 和 completion-candidate salvage；默认 projection 不暴露 raw ToolPayload、AgentServer direct text、handoff、stdout/stderr、task attempts 或 workspace 内部文件结构。
- Sub agents：Explorer-A 只读勘察 UI preview/action/raw-leak 边界与现有测试；Explorer-B 只读勘察 runtime/projection completion-candidate、repair/retry 与 salvage 边界。Owner 负责实现、测试、browser 复验、PROJECT/docs 回写和 git 同步。
- 当前事实（Orchestrator 2026-05-17）：已建立最小 `ProjectionApi` / `UserActionApi` 类型入口、UI action boundary、manual preview action、selected artifact action、retry action 和 completion-candidate projection 读取；generated task pre-output / parse-output failure 可扫描 partial evidence 并写入 `displayIntent.completionCandidate`，UI 投影为 `repair-needed/unverified`，不会从 raw ToolPayload 推断 success。
- UI-Execution Owner 补充（2026-05-17）：默认消息 key info / evidence rows / execution detail 会把 `ToolPayload`、`taskFiles`、`stdout/stderr` 等内部术语 scrub 成用户可读“结构化任务结果 / generated task files / execution logs”。真实页面 smoke（Playwright isolated；Codex in-app browser MCP 因旧 Edge profile transport closed 暂不可用）打开 `http://127.0.0.1:5173/`，console error 为 0，默认 DOM raw term matches 为 `[]`。
- UI-Execution Owner 补充（2026-05-17 续）：已补最小 `ProjectionSubscriptionApi` 本地 contract；`UserActionApi.loadArtifactPreview` 现在产出 typed `load-artifact-preview` source action；`WorkspaceObjectPreview` 的大文件手动加载会先通过 `UserActionApi.loadArtifactPreview`，再进入现有 workspace preview hydration；`UserActionApi` 继续补齐 `selectObject`、`triggerRecover`、`approveResult`、`cancelRun`、`openDebugAudit` 语义动作，selected-object/recover/cancel/debug-audit 不再只能停留在底层 action creator。Targeted tests 覆盖 subscription 不泄漏 raw AgentServer text、manual preview action source、artifact preview button action boundary、selected-object/recover/approval/cancel/open-debug-audit action result。
- Blocker / 缺口：还不是“UI 只消费 ProjectionApi”；现有组件仍直接调用 `conversationProjectionForSession`、`runPresentationState` 和 audit helpers。`WorkspaceObjectPreview` 已把手动加载动作前置到 `UserActionApi.loadArtifactPreview`，并把 workspace preview hydration 下沉到可替换 `ArtifactPreviewHydrationApi` adapter；默认 adapter 仍访问 workspace preview client，尚未完全收敛为 ProjectionApi。ResultsRenderer 选择类 object actions 已迁到 async `UserActionApi.selectObject` flow，recover buttons 已迁到 async `UserActionApi.triggerRecover` flow，运行细节展开已迁到 async `UserActionApi.openDebugAudit` flow。通用 AgentServer handoff drift / 已存在 `tool_payload.json` / artifacts 的 import-verify-confirm transaction 尚未闭环；普通 embedded projection 的 raw leak scrub/conformance 也还需补齐。当前为 partial foundation，不能标 UI/API Decoupling Gate done。
- 设计文档：[`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)，状态为 partial foundation / in_progress；当前代码已有 Projection、ArtifactDelivery、preview、run/audit refs、最小函数 API 与部分 salvage 基础，但 UI 与 runtime/workspace writer/AgentServer handoff 仍有耦合。
- Sub-agent 结果：Mendel 只读核查确认当前满足“最小函数 API 雏形 + 部分 candidate salvage”，但未满足完整 `docs/UIExecutionDecoupling.md` / `PROJECT.md` 最小闭环验收；建议保持 in_progress。
- 验证：`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/ui/src/app/projectionApi.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/agentserver-prompts.test.ts` 通过 81/81；同批 targeted suite 通过 47/47；UI-Execution Owner 追加 `node --import tsx --test src/ui/src/app/projectionApi.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/app/uiActionBoundary.test.ts` 通过 36/36；续跑 `node --import tsx --test src/ui/src/app/projectionApi.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/app/uiActionBoundary.test.ts` 通过 15/15；继续补 recover/cancel 后同 suite 通过 16/16；迁移 ResultsRenderer recover buttons 后 `node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 通过 41/41；迁移 debug audit 展开后同 suite 通过 43/43；迁移 object selection 后同 suite 通过 45/45；补默认 raw/debug 术语 scrub 后同 suite 通过 45/45；`node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts packages/contracts/runtime/work-evidence.test.ts` 通过 13/13；`npm run typecheck` 通过。Codex in-app browser P4 打开 `http://127.0.0.1:5473/`，title `SciForge`，console error 0，default DOM raw term matches `[]`；UI-Execution Owner 隔离 Edge fallback 打开 `http://127.0.0.1:5173/`，title `SciForge`，console error 0，default DOM raw term matches `[]`；但默认 shell 仍显示 `Scenario Runtime` / `文献证据评估场景`，Universal Chat Gate 仍 open。
- 用户问题：任务实际上已经写出 report/artifacts/ToolPayload 时，网页仍可能只看到 contract failure，因为 UI 只能消费当前 gateway 投影，不能通过稳定函数发现 completion candidate 或触发导入/验证。
- 产品假设：网页端必须只通过函数式 `ProjectionApi`、`UserActionApi`、`ProjectionSubscriptionApi` 展示、预览、订阅和干预数据；这些 API 是语义函数 contract，不绑定 HTTP 协议。HTTP/RPC/IPC/本地调用只是实现适配层。
- API 任务：定义 canonical view models：`ConversationProjectionView`、`RunProjectionView`、`ArtifactPreview`、`ExecutionTraceView`、`CapabilityPlanSummary`、`UserActionResult`；将 artifact preview、select object、retry/recover、approve result、cancel run、capability preference 等用户动作收敛为函数调用。
- 稳定性任务：实现 `completion-candidate` / salvage 路径；当合法 `tool_payload.json` 或 expected artifacts 已经存在但 handoff 失败时，runtime 生成候选 projection，UI 展示“发现可用结果，待导入/验证/确认”，而不是只显示失败。
- 失败判据：UI 组件直接读取 raw ToolPayload、AgentServer direct text、handoff JSON、stdout/stderr、task attempts 或 workspace 文件来推断主答案；用户动作通过拼 prompt 或直接改 state 完成；HTTP route 名称被当成架构 contract；存在真实 artifact 但没有任何 projection/action 可发现。
- 验收：targeted tests 覆盖 projection-only restore、manual artifact preview action、selected artifact action、retry with repair evidence、completion candidate salvage、default projection no raw leak；Browser 复验至少覆盖一次“artifact 已存在但 handoff 漂移”的恢复路径。

UX-SYSTEM-TASK-20260517-answer-first-results-panel：

- 状态：todo
- 用户问题：结果区堆叠当前聚焦 run、需要人工处理、审计摘要、可复现执行单元、raw refs 等信息，普通用户很难判断问题是否解决。
- 产品假设：结果区默认按用户任务组织：`任务是否解决`、`主答案/报告`、`关键证据`、`下一步/恢复按钮`；运行细节、execution units、audit refs、raw payload、diagnostics 全部折叠到调试抽屉。
- 并行验证：P1-P6 对完成、失败、partial、selected artifact follow-up 四种结果拍一次用户视角评测：不展开调试信息时，用户能否在 10 秒内判断任务是否完成、缺什么、点哪里继续。
- 失败判据：主回复未解决但右侧大量 debug 内容让人误判成功；`needs-human`/`Verification: 未验证` 没有转成可理解的下一步；用户必须阅读 execution unit 或 raw artifact 才知道发生了什么。
- 修复方向：ResultPresentation 增加 answer-first summary model；debug details 分层折叠；fail/partial 状态使用明确用户语言；`run id`、`protocol`、`claim type`、`payload` 默认隐藏。
- 验收：Browser 复验至少覆盖一个成功任务和一个故意失败任务；不展开 debug 面板即可理解状态和下一步。

UX-SYSTEM-TASK-20260517-strict-user-proxy-process：

- 状态：todo
- 用户问题：多进程评测容易只证明“系统有输出”，而不是证明“用户问题被解决”。
- 进程规则：每个 P 进程在自己的端口、workspace、state、config 下运行；必须用 Codex in-app browser 代替真实用户点击、输入、选择 artifact、reload、追问；terminal 只能辅助核查 workspace/测试。
- 严评规则：只要网页主回复没有真正完成用户硬需求，必须判 `TaskSuccess=false`，记录可见证据，启动 sub agents 并行定位通用根因；不能用“生成了 artifact / 有 refs / 有 audit / 可以恢复”替代成功。
- Discovery 规则：失败复盘时必须检查 agent 是否知道 `capability_discovery` 存在、是否应该调用而未调用、是否调用后没有展开正确能力、或是否 discovery plan 没有接入 `invoke_capability` 执行。
- Sub-agent 拆分建议：一个 agent 做 browser 复现和证据，一个 agent 做代码边界勘察，一个 agent 实施通用修复，一个 agent 补测试/回归；写集合必须 disjoint，owner 负责合并。
- 动态追加：任何进程发现新的 UX 冗余、假成功、能力选择失败、结果区误导或恢复困难，都追加到 `Discovered Task Queue`，并标注最小复现、根边界、建议 owner。
- 验收：每个 milestone 结束时必须更新本文件中的任务状态、Activity Log 和 handoff；如果完成修复，提交并 push GitHub。

### P1 Human Researcher - Literature / Full-text Discovery

状态：in_progress
Owner：P1
Browser：`http://127.0.0.1:5173/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

本批自主探索目标：以真实科研用户身份要求 SciForge 调研今日/最新 arXiv 上 agentic RL 相关论文，明确硬需求为检索来源、论文身份、全文/PDF 获取、证据位置、中文报告 artifact 和后续 selected artifact 追问；若主回复把摘要/计划/未验证文本冒充全文调研，则判 `TaskSuccess=false` 并定位通用边界。

P1-TASK-20260517-agentic-rl-arxiv-fulltext：

- 用户目标：调研 2026-05-17 最近 48 小时 arXiv 上 agentic RL / agentic reinforcement learning 新论文，生成中文报告 artifact。
- Hard requirements：列出检索来源/query、arXiv ID/标题/作者/提交或更新日期/链接；必须打开 PDF/全文并给章节/页码/段落证据；若为空或未读全文必须如实失败；不得把 provider metadata 或摘要冒充完成。
- 首轮严格判定：`TaskSuccess=false`，`AnswerQuality=fake-success`。旧 run `project-literature-evidence-review-mp8tloty-oud91r` / session `session-literature-evidence-review-mp8tihhb-wtv54f` / task `generated-literature-6a700e26bab3` 在 Web UI 显示 `satisfied`，但主回复和 report 只写 `provider-grounded metadata until full-text verification`，verification 为 `unverified`，artifact rows 还混入无关 Crossref 中文教育/党建结果并残留旧 pancreatic/spatial 默认字段。
- Root boundary：Gateway generated-task provider-first recovery adapter 在只拿到 candidate metadata、无全文/PDF/引用验证证据时仍写 `executionUnits.status=done`、`claimType=evidence-matrix`，导致 TaskOutcome/Projection 把未完成科研任务标成 satisfied。
- 通用修复：`src/runtime/gateway/generated-task-runner-generation-lifecycle.ts` 的 deterministic provider-route recovery adapter 现在 fail-closed：metadata-only recovery 输出 `claimType=failed-with-reason`、`executionUnits.status=failed-with-reason`、保留 evidence/report artifacts 为诊断材料，去掉旧领域默认值，并改善 query 抽取以过滤硬要求文本；不含 prompt/端口/provider/论文题目特例。
- Browser 复验：重新启动 P1 后，同类请求恢复到 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b`；Web UI 显示 `运行需要恢复` / `recoverable`，Projection `visibleAnswer.status=repair-needed`，`protocol=protocol-failed; task=needs-work`，reload 后仍保持 recoverable，旧 satisfied 文本未覆盖最新失败状态。
- Workspace refs：`workspace/parallel/p1/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8tqrn8-hj97yf/task-results/generated-literature-24bfd7f7036b.json`、`.../task-results/generated-literature-24bfd7f7036b-research-report-provider-recovery.md`、`.../tasks/generated-literature-24bfd7f7036b/.sciforge/generated-tasks/provider-first-recovery-6285a0364c41.py`。
- 验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts` 通过；`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 通过；`npm run typecheck` 当前失败在既有/并行改动的 `direct-answer-payload.test.ts`、`task-attempt-history.ts`、`appStateModels.test.ts` 等类型问题，非本 P1 修改边界。

P1-TASK-20260517-selected-report-followup：

- 用户目标：选中上一轮 `research-report-provider-recovery` / provider metadata diagnostic artifact 后追问“仅基于选中报告，哪些全文证据已读取、哪些没有读取、下一步如何恢复”，验证 selected artifact follow-up 是否只用被选 artifact。
- Hard requirements：必须明确基于 selected artifact；不得混入旧 satisfied DOM、未选中的最新 artifact 或外部新检索；如果选中报告只有 metadata diagnostic，必须回答“未完成全文阅读/不可判成功”，不能补造 arXiv/PDF 证据。
- 首轮严格判定：`TaskSuccess=false`，`AnswerQuality=partial/unsafe-boundary`。Browser 选中旧 run 的 `research-report-provider-recovery` 后追问，run `project-literature-evidence-review-mp8udstw-qn7v7q` / 后续重试 `project-literature-evidence-review-mp8ujrbk-2kkf50` 走 direct-context fast path，但输出被旧 `answer-only` 分支包装成“基于上一轮可见答案直接回答”，没有明确只基于 selected report，边界不够硬。
- Root boundary：`direct-context-fast-path` 的中文 selected report 追问会先命中泛化的 answer-only transform；对“全文/PDF/验证状态”这类 selected artifact 问题缺少专用回答分支，导致旧可见答案摘要优先于被选 report 证据状态。
- 通用修复：`src/runtime/gateway/direct-context-fast-path.ts` 新增 selected report evidence-status 分支，优先识别 selected report + PDF/full-text/verification/completion 问题；只从选中 refs 对应的 report/artifact/file context 提取依据，metadata-only report 明确输出“没有记录已读取/已验证 arXiv PDF/全文证据，不能支持全文调研已完成”，并避开未选 artifact、claim、execution/audit 噪声。
- Browser 复验：重启 P1 后，同一 selected report follow-up 得到 run `project-literature-evidence-review-mp8ul9wo-57z13n`；Web UI 最新摘要明确“只基于当前选中的 research-report-provider-recovery”，列出未记录任何已读取/下载/验证过的 arXiv PDF/全文证据，结论为不能支持“全文调研已完成”，下一步为逐篇读取 PDF/全文并做 citation/title/date 校验。
- Workspace refs：`workspace/parallel/p1/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8tihhb-wtv54f/records/session.json` 中 run `project-literature-evidence-review-mp8ul9wo-57z13n`；`versions/version-mp8ul9xh-ye5gwh.json` 保留同一回答与 selected `artifact:research-report-provider-recovery` 证据链。
- 验证：`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts` 通过；`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/artifact-reference-context.test.ts` 通过。

P1-TASK-20260517-arxiv-pdf-comparison：

- 状态：done
- 用户目标：作为科研用户，请 SciForge 调研最近 30 天 arXiv 上 multi-agent reinforcement learning / credit assignment 相关新论文，选择 2 篇最相关论文，打开 PDF/全文做中文对比报告和 evidence matrix。
- Hard requirements：必须列出检索来源/query、arXiv ID/标题/作者/提交或更新日期/PDF 链接；必须证明读取 PDF/全文并给出章节/页码/段落或表图位置；必须比较方法、实验设置、核心贡献、局限和可复现实验建议；如果无法找到最近 30 天论文或无法读取全文，必须明确失败，不得用 provider metadata、摘要、旧报告或未验证候选冒充完成。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5173/` 自然提交任务、查看主回复和 artifact；从 workspace task-result/report/records 核对是否有全文证据；若失败，定位 gateway / provider / PDF retrieval / verification / Projection / ArtifactDelivery 通用边界并补测试。
- 严格判定：`TaskSuccess=false`，`AnswerQuality=diagnostic-only/fail-closed`。Browser 真实提交 run `project-literature-evidence-review-mp8ve48s-dvv447` / session `session-literature-evidence-review-mp8vbn9x-0gdt4d` / task `generated-literature-673eefe8d9a8` 后，Web UI 显示 `repair-needed`、`protocol=protocol-failed; task=needs-work`，主回复明确 required verification still unverified，未把 provider metadata 冒充全文调研完成。
- Workspace refs：`workspace/parallel/p1/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8vbn9x-0gdt4d/task-results/generated-literature-673eefe8d9a8.json`、`.../task-results/generated-literature-673eefe8d9a8-research-report-provider-recovery.md`、`.../records/runs.json`。
- Root boundary：AgentServer generated task 仍两次绕过 ready `web_search`/`web_fetch` provider route 而触发 provider-first preflight；deterministic recovery 只能用 provider metadata 产出诊断 artifacts，未完成 PDF/full-text/citation verification。该边界已由 `P1-TASK-20260517-agentic-rl-arxiv-fulltext` 的通用 fail-closed 修复治理，当前复验确认 Projection/ArtifactDelivery 没有回退到 fake success。
- 验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts` 通过。

P1-TASK-20260517-arxiv-provider-fallback：

- 状态：done
- 用户目标：继续 P1 文献/full-text 方向，修复 arXiv 查询在 DuckDuckGo 不可用时落到 Crossref/EuropePMC 噪声 metadata 的通用 provider 边界；同时保持“没有全文/PDF 证据就 fail-closed”。
- Hard requirements：显式 arXiv 查询必须优先走 arXiv API；返回结果要包含 arXiv ID、abs 链接、PDF 链接、作者、发布时间/更新时间和摘要片段；若 arXiv API 无结果/失败，不得掉到 Crossref/EuropePMC 噪声；provider metadata 只能作为诊断，不能标记全文调研成功；recovery query 不能丢失 arXiv ID，也不能把 “do not use crossref” 里的否定对象带进 query。
- Root boundary：`packages/workers/web-worker/src/web-tools.ts` 旧 fallback 顺序只有 DuckDuckGo -> EuropePMC -> Crossref；显式 arXiv intent 在 DuckDuckGo 失败后会被 general scholarly providers 污染。`generated-task-runner-generation-lifecycle.ts` 的 provider-first recovery `_search_query` 还会丢弃 `1706.02275` 这类数字 arXiv ID，并把否定句中的 provider 名称纳入查询。
- 通用修复：`web_search` 新增 arXiv API fallback，清洗 instruction-heavy query 为 `all:term AND all:term` 或 `id:<arxivId>`，解析 Atom entry 为 title/url/snippet/arxivId/published/updated/authors/pdfUrl；显式 arXiv query 在 arXiv API 无结果或失败时直接 fail-closed，不再继续 EuropePMC/Crossref。provider-first recovery adapter 现在优先保留 arXiv ID，并剔除 `do not/don't/never/avoid use ...` 否定 provider 指令。
- Browser 复验：P1 `http://127.0.0.1:5173/` 真实提交 arXiv ID 任务，run `project-literature-evidence-review-mp8wpm4a-tuokwx` / session `session-literature-evidence-review-mp8wosla-a8idth` / task `generated-literature-d12315ab3d4d` 显示 `repair-needed` / `failed`，providerResultSummary 为 `provider: arxiv-api`、`query: arXiv 1706.02275`，返回 `Multi-Agent Actor-Critic for Mixed Cooperative-Competitive Environments`、`arXiv:1706.02275v4`、abs/PDF 链接与作者；主回复仍明确 metadata 不是全文验证证据，没有 fake success。
- Workspace refs：`workspace/parallel/p1/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8wosla-a8idth/task-results/generated-literature-d12315ab3d4d.json`、`.../task-results/generated-literature-d12315ab3d4d-research-report-provider-recovery.md`。
- 验证：`node --import tsx --test packages/workers/web-worker/src/web-worker.test.ts` 通过；`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts packages/workers/web-worker/src/web-worker.test.ts` 通过 16/16；`npm run typecheck` 当前仍失败在并行 dirty 的 `src/runtime/gateway/artifact-materializer.test.ts` 类型问题，非本 P1 修改边界。

P1-TASK-20260517-browser-rendered-web-tool：

- 状态：done
- 用户目标：联网核对是否有更通用的“像正常浏览器一样”网页检索工具，并先封装成 SciForge 可用 provider，作为 arXiv API / DuckDuckGo / 静态 fetch 失效时的通用恢复路径。
- Hard requirements：工具必须基于真实浏览器渲染而不是再写一个静态 scraper；必须走 SciForge tool-worker / capability manifest / provider-first route；必须能读取 JavaScript 渲染后的页面正文和链接；通用 `web_search` 在普通 DuckDuckGo fetch 失败时可先尝试 browser-rendered search，再落到学术 provider；不得绕过 provider-first 合同直接让 generated task 用 requests/httpx。
- Root boundary：旧 `web_search`/`web_fetch` 只能做 HTTP fetch 与静态 HTML 解析，遇到搜索页反爬、JS 渲染页面、PDF/full-text 入口页时缺少真实 browser 级工具；AgentServer/generated-task 也不知道 `browser_search`/`browser_fetch` provider route，容易回到直接网络库或只产出 metadata diagnostic。
- 通用修复：`@sciforge/web-worker` 新增 `browser_search` 与 `browser_fetch`，使用已有 `playwright-core`/Chromium headless 打开页面；`browser_fetch` 返回 rendered text/title/status/links，`browser_search` 默认走 rendered Bing 搜索并保留 DuckDuckGo engine 选项。`web_search` 现在在普通 DuckDuckGo HTML 失败后优先尝试 `playwright-chromium` browser search；显式 arXiv intent 仍优先 arXiv API 并保留 submittedDate window。新增 observe capability manifests、registry discovery、worker manifest/provider adapters、browser intent route inference 与 provider-first guidance。
- 验证：本机 Playwright Chromium 已安装；真实 `browser_fetch` 打开本地 JS 页面并读到 `Rendered browser content from JavaScript`；真实 `web_search` 在 DuckDuckGo fetch failed 后走 `provider=playwright-chromium` / `engine=bing-rendered` 返回结果；arXiv 30 天查询仍返回 `provider=arxiv-api`、`providerQuery=...submittedDate:[202604180000 TO 202605172359]`、first `2605.14558v1`。`node --import tsx --test packages/workers/web-worker/src/web-worker.test.ts src/runtime/gateway/capability-provider-preflight.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-payload-preflight.test.ts` 通过 41/41；`npm run typecheck` 当前失败在并行 dirty 的 `artifact-materializer.test.ts` 与 `direct-context-fast-path.test.ts` 类型问题，非本 P1 修改边界。

P1-TASK-20260517-edge-playwright-mcp-observe：

- 状态：done
- 用户目标：把已验证的 `Microsoft Edge + @playwright/mcp` 可见浏览器工具封装到 `packages/observe`，让 SciForge 能把它作为可发现、可路由的 observe capability，而不是只依赖 Codex 全局 MCP 配置。
- Hard requirements：必须使用 `--browser=msedge`，默认 headed，不加 `--headless`；必须支持独立持久化 profile；必须能为 P1/P2 等并行进程生成互不冲突的 `--user-data-dir`；必须注册 capability manifest 和 provider route；runtime preflight 必须能在登录、验证码、点击、滚动、填表、下载等交互浏览器需求中识别该能力。
- 通用修复：`packages/observe/web/mcp/playwright-edge.ts` 新增 Edge MCP 配置生成器、Codex TOML snippet、HTTP endpoint helper、provider availability/toolProviderRoutes projection 和 parallel server config；`packages/observe/web/mcp/playwright-edge-provider.ts` / `playwright-edge-provider-cli.ts` 新增实际 MCP client adapter，通过官方 `@modelcontextprotocol/sdk` 连接 `/mcp` 并调用 Playwright MCP browser tools；`packages/observe/web/capabilities/playwright_edge_browser.manifest.json` 注册 `playwright_edge_browser` observe capability；registry 默认加载该 manifest；capability preflight 新增 interactive browser automation intent，generated-task provider invocation 会把该 MCP provider 转成可执行 node-cli adapter，而不是误当普通 `/invoke` HTTP worker。
- Web 端补强：真实 Browser 复验暴露两层 Web-only 问题：`vision-sense on` 会抢走显式 Edge MCP 请求，以及 AgentServer 可能生成不写 `outputPath` 的临时代码。已新增 `config.local.json -> SciForgeConfig.toolProviderRoutes -> uiState.toolProviderRoutes` 通道，`vision-sense-runtime` 对显式 `playwright_edge_browser`/Edge MCP 意图让路，并新增 `playwright-edge-browser-runtime` 确定性 stage 直接调用已配置 MCP provider，不再依赖 LLM 现场生成适配器。
- 验证：真实启动 `npx @playwright/mcp@latest --browser=msedge --user-data-dir=/Users/zhangyanggao/.pw-mcp-edge-profile --viewport-size=1440x900 --output-dir=/Users/zhangyanggao/.pw-mcp-edge-output --port 8931` 后，`node --import tsx packages/observe/web/mcp/playwright-edge-provider-cli.ts invoke --mcp-url http://localhost:8931/mcp '{"url":"https://example.com","maxChars":800}'` 返回 `Example Domain` 正文且 `edgeDetected=true` / UA 含 `Edg/148`；同一 CLI search `Playwright MCP Microsoft Edge` 成功打开搜索结果并读取页面文本；live generated-task 通过 `invoke_capability(task_input, "playwright_edge_browser", {"url":"https://example.com"})` 成功输出 `Example Domain`，task input adapter 为 `kind=node-cli`、`providerId=sciforge.observe.playwright-edge-mcp`。`node --import tsx --test packages/observe/web/mcp/playwright-edge.test.ts src/runtime/gateway/capability-provider-preflight.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 通过 31/31；`node --import tsx tests/smoke/smoke-unified-capability-graph.ts` 通过；`npm run smoke:capability-manifest-registry` 通过并显示 `capabilityManifests: 18`；`npm run typecheck` 通过。另顺手修复并行 dirty 的 generated-task rerun command 类型问题：缺失 `inputRel` 时不注入 rerun command，`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts` 通过 6/6。
- Web 复验：P1 `http://127.0.0.1:5173/` 真实提交 Edge MCP 任务，最终 run `project-literature-evidence-review-mp92lzy9-wzsqpd` / session `session-literature-evidence-review-mp928fqv-on0bsc` 为 completed；EU `EU-playwright-edge-browser-0e5566abb384` 显示 `tool=playwright_edge_browser`、`params={"url":"https://example.com","mcpUrl":"http://localhost:8931/mcp","mode":"read"}`；artifact `playwright-edge-browser-result-0e5566abb384` 返回 `Title: Example Domain`、`providerDiagnostics.edgeDetected: true`、UA 含 `Edg/148.0.0.0`。补充测试 `node --import tsx --test src/runtime/playwright-edge-browser-runtime.test.ts src/runtime/vision-sense-runtime.test.ts src/ui/src/config.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts` 通过 39/39，`npm run typecheck` 通过。

人类角色：一个真实科研用户，希望 SciForge 帮自己完成前沿文献发现、全文阅读、证据整理和研究判断。

探索方向：arXiv / bioRxiv / PubMed / Europe PMC / 论文 PDF / citation grounding / 中文或英文系统报告。

自主任务建议，worker 可自由选择或改写：

- [x] 今日 arXiv 上 agentic RL 相关论文调研、下载、阅读全文、中文总结报告。
- [ ] 某个生物医学主题的最新论文证据矩阵与研究假设生成。
- [ ] 对一组论文 PDF 做对比阅读，输出方法、实验、局限和复现实验建议。

严评重点：

- [x] 不能把摘要阅读冒充全文阅读。
- [x] 不能把 `Verification: 未验证` 或空泛综述算成功。
- [x] 必须证明检索来源、论文身份、全文获取、证据位置和报告 artifact。
- [x] selected artifact follow-up 必须只基于被选中的报告/论文证据。

### P2 Human Data Scientist - Data Analysis / Reproducibility

状态：done
Owner：P2
Browser：`http://127.0.0.1:5273/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P2，2026-05-17）：作为真实数据科学用户，要求 SciForge 生成一个含 batch/timepoint/treatment 的实验数据集，完成 EDA、统计检验、图表、可复跑脚本和后续基于 selected artifact 的解释；严格检查样本量、效应方向、检验假设、限制、artifact 与复跑命令。

本轮结论（P2，2026-05-17）：`TaskSuccess=false` / `AnswerQuality=partial -> degraded-result`。首轮真实 browser run `project-biomedical-knowledge-graph-mp8tlixq-6f9o7q` / session bundle `workspace/parallel/p2/.sciforge/sessions/2026-05-16_workspace-biomedical-knowledge-graph--kras-g12d----mp8tirby_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tirby-mp8tj1w8-undhy3` 生成了 CSV、EDA、统计/robustness markdown、PNG 图和 Python 脚本，但网页主回复为 `satisfied` 且 `Verification: 未验证`，同时 robustness 产物报告“控制 batch 降低/修正效应”却给出控制前后相同 drugA@48h 系数，属于假成功。通用修复落在 gateway validation：`result-metric-consistency` 现在拦截高误差成功声明和 robustness/confounder 解释与系数矛盾的 payload。复验 run `project-literature-evidence-review-mp8u8rr9-uf09xt` / session `workspace/parallel/p2/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tirby-mp8u1k3k-3y1sgc` 对同类任务投影为 `task=needs-work` / `degraded-result`，主结果明确“required verification is still unverified; this cannot be counted as a completed task”。selected `Research-Report` follow-up run `project-literature-evidence-review-mp8u9wmk-maz5si` 只基于选中 artifact 返回 partial/degraded，没有补造未选中 CSV/图表证据。

P2-TASK-20260517-rerun-command-chart-grounding：

- 状态：done
- 用户目标：以真实数据科学用户身份要求 SciForge 生成一个可复跑的药物响应/时间点数据分析包，包含 CSV、EDA、统计模型、图表、脚本和一条能直接执行的 rerun command；随后选中图表 artifact 追问图表能否单独支持统计结论。
- Hard requirements：必须有可打开的 CSV/报告/图表/脚本 artifact；必须给出样本量、效应方向、检验假设、限制；rerun command 必须能在 workspace 中实际执行或如实给出 blocker；selected chart follow-up 必须只基于被选图表，不得补用未选 CSV/报告/历史消息；未验证或复跑失败不得投影为完成。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5273/` 自然提交任务、查看 artifacts、在 workspace 执行 rerun command 或等价脚本命令、选择图表 artifact 追问、reload 后确认最终状态；失败时定位通用 gateway / verification / ArtifactDelivery / Projection 边界。
- 本轮结论（2026-05-17）：真实 Browser session `session-literature-evidence-review-mp8wlp9d-vnc9b8` / initial run `project-literature-evidence-review-mp8wou1d-rgyqkr` 暴露了 `simulated_data.csv`、`report.md`、`boxplot_response.png`、`coefficient_plot.png` 等用户可见引用，并保持 `protocol-success; task=needs-work` / `degraded-result`，没有把 `Verification: 未验证` 冒充 completed。workspace 中执行 `python analysis.py --inputPath . --outputPath .` 成功生成 CSV、两张 PNG、`evidence_matrix.json`、`notebook_timeline.json` 和 `report.md`；报告包含 144 total samples、每个 batch/treatment/timepoint cell 12 samples、drugA@48h 正向效应、p value/CI、模型假设和 batch/confounding 限制。
- 失败边界与修复：首轮 selected chart follow-up `project-literature-evidence-review-mp8x6css-7e2oe3` / `project-literature-evidence-review-mp8x9hls-dbnj15` 会因缺失 expected artifacts 或审计上下文混入 sibling CSV/report/evidence，严格判 `TaskSuccess=false`。通用修复收窄 `direct-context-fast-path` 的 explicit selected-only payload/context/audit scope，chart-only sufficiency answer 绕过缺失 sibling artifact preflight；plain AgentServer file refs 现在会物化成可见 artifacts；ArtifactDelivery 会暴露 file-backed CSV/PNG，并把 workspace-relative refs 复制进 session `task-results`；Python generated-task policy 增加 `to_markdown`/`tabulate` 依赖约束。
- 复验：post-fix Browser run `project-literature-evidence-review-mp8xnujs-y8j1qv` 只基于选中 `boxplot_response.png` 回答：单张图只能支持视觉假设，不能单独证明 drugA@48h 统计显著或 batch-confounding 结论；缺失 sample-level data、sample sizes、test/model、effect size/direction、p value/CI、assumptions/diagnostics、batch labels 与 adjusted/stratified comparison。本地 records 核查 `usedContextRefs` 只含 `artifact:boxplot_response`、`boxplot_response.png`、`artifact-type:image-png` 和对应 digest，没有 `report`、`simulated_data.csv`、`evidence_matrix` 或 `notebook_timeline`。仍显示 `Verification: 未验证` / partial，这是正确的诚实降级。
- 验证：`npx tsx --test src/runtime/gateway/direct-context-fast-path.test.ts` 44/44、`npx tsx --test src/runtime/gateway/artifact-materializer.test.ts` 8/8、`npx tsx --test src/runtime/gateway/direct-answer-payload.test.ts` 16/16、`npx tsx --test packages/skills/runtime-policy.test.ts` 8/8 通过。

P2-TASK-20260517-messy-clinical-qc-sensitivity：

- 状态：done
- 用户目标：以真实数据科学用户身份要求 SciForge 创建/分析一份 messy clinical-style CSV：包含 site/batch、treatment、baseline severity、age、sex、outcome、missingness、离群值和 protocol deviation；输出 QC、缺失机制检查、主模型、稳健回归或敏感性分析、图表、可复跑脚本和报告，并随后选中 QC/缺失 artifact 追问结论是否受缺失/离群影响。
- Hard requirements：必须有用户可打开的 raw/cleaned CSV、QC 或 missingness 表、报告、至少两张图、脚本或 notebook；报告必须给出样本量、缺失比例、离群定义、模型/检验假设、效应方向、估计值或区间、敏感性分析前后差异和限制；rerun command 必须真实可执行或如实给 blocker；selected QC/missingness follow-up 必须只基于被选 artifact，不得补用未选报告/CSV/历史；未验证或复跑失败不得投影为完成。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5273/` 自然提交任务、打开/查看 artifacts、从 workspace 执行 rerun command 或等价脚本、选择 QC/missingness artifact 追问、reload 后确认状态；失败时定位通用 gateway / verification / ArtifactDelivery / Projection / selected-reference 边界。
- 本轮结论（2026-05-17）：真实 Browser session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp91pqzw-lc5clt` / generated task `generated-literature-6605f03ada94` 产出 `raw_data.csv`、`cleaned_data.csv`、`missingness_report.csv`、`analysis_report.md`、`clinical_analysis_package.py`、`boxplot_outcome_by_treatment.png`、`missingness_heatmap.png` 等可打开 artifacts。报告给出 165 patients、缺失率、离群值规则、primary adjusted treatment effect `-15.51`（95% CI `-21.3` to `-9.73`, `p=0.0`）、sensitivity excluding outliers/protocol deviations `-16.51`（95% CI `-22.85` to `-10.16`, `p=0.0`）、模型假设与 site/batch/protocol-deviation 限制。
- 复跑验证：报告和 payload 中的 rerun command 被规范为 session-bundle 绝对路径命令，实际执行 `cd '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2' && python '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp91pqzw-lc5clt/tasks/generated-literature-6605f03ada94/clinical_analysis_package.py' '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp91pqzw-lc5clt/task-inputs/generated-literature-6605f03ada94.json' '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp91pqzw-lc5clt/task-results/generated-literature-6605f03ada94.rerun.json'` 成功写出 `.rerun.json`；随后 re-materialize 确认 `analysis_report.md`、artifact metadata 与 inline `data.markdown/content` 均保留真实命令，不再回退到 `<inputPath>` / `input.json output.json`。
- 失败边界与修复：首轮暴露 failed run 长期 waiting、generated Python schema/type drift、`outputPath` 被当目录、placeholder rerun command 与报告/payload 漂移、plain direct text 假装 reproducible package、selected QC follow-up 被 chart-only 分支/未 hydrate CSV 表值污染。通用修复覆盖 terminal repair projection、continuation compact recovery clues、stats design numeric coercion、failed-with-reason terminal ToolPayload、payload-preflight strict retry、outputPath-directory alias detector、exact rerun command post-materialization patch、file-backed readable artifact hydration、direct-text guard retry，以及 selected QC/missingness 只读 fast path 的 UI artifact hydration。
- selected QC/missingness 复验：post-fix Browser run `project-literature-evidence-review-mp973bbv-j37z9x` 对选中的 `missingness-report` 回答 `Answered only from the selected QC/missingness reference`，列出 `total patients: 165 (100%)`、`missing baseline severity: 14 (8.5%)`、`missing outcome week 8: 11 (6.7%)`、`outcome outliers: 3 (1.8%)`、`protocol deviations: 24 (14.5%)`，结论为这些 QC 负担只能提示需要 sensitivity/imbalance checks，不能单独证明或推翻 treatment-effect conclusion。records 核查 refs/citations/evidence 只含 selected `missingness_report.csv`、`artifact:missingness-report`、direct-context summary 与 verification，不含 report、cleaned CSV、charts 或 evidence matrix。
- 验证：真实 in-app Browser 复验通过；`npx tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/artifact-materializer.test.ts src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-payload-preflight.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts packages/observe/web/mcp/playwright-edge.test.ts packages/skills/runtime-policy.test.ts src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results-renderer-execution-model.test.ts` 通过 183/183。

P2-TASK-20260517-universal-data-chat-discovery：

- 状态：done / strict-eval closed; remaining UX-SYSTEM blockers tracked centrally
- 用户目标：普通数据分析用户不打开 Scenario Builder、不手工配置 skills/tools，直接在默认聊天入口要求 SciForge 对一份 messy assay CSV 做数据读取、QC、分组统计、可视化、复跑脚本和可核查结论，并观察系统是否自动发现/选择数据分析能力。
- 为什么属于 P2：该任务核心是数据上传/读取、统计分析、图表、可复现实验包与结果区可理解性，正好覆盖 P2 数据分析 / 可复现实验方向，同时挑战本轮 UX-SYSTEM 的通用聊天、capability discovery 和 answer-first 假设。
- Hard requirements：默认入口必须能直接提交任务，不能要求普通用户理解场景名或 builder；handoff/records 必须只暴露极简 `capability_discovery` brief 或等价能力摘要，不能一次性泄漏完整 registry/schema/provider endpoint/workspace root；若需要专业能力，应有 discovery/search/expand/plan/explain 或明确缺失能力说明；主回复必须说明数据是否实际读取、样本量/变量、QC、统计方法、效应方向、图表和复跑命令；右侧结果区默认应 answer-first，不能要求用户从 run id、audit refs、execution unit 或 raw payload 中拼答案。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5273/` 自然提交任务、查看默认页面和结果区、必要时打开 artifact/reload/追问；终端只辅助核查 workspace records/handoff 与测试。失败时定位 root boundary：Capability Discovery / AgentServer handoff / Projection / ArtifactDelivery / UI execution decoupling / answer-first presentation。
- Sub-agent 批次计划：Explorer-A 只读勘察 capability discovery contract、handoff brief 和 records 中的泄漏/缺失；Explorer-B 只读勘察 UI 默认入口、结果区、artifact preview 与 debug folding 代码和现有测试。Owner C-P2 负责 browser 复现、证据、通用修复、测试、PROJECT 回写和 git 同步；sub agents 不写 `PROJECT.md`。
- 本轮结论（2026-05-17）：`TaskSuccess=false` / `AnswerQuality=failed -> repair-needed but UI restore degraded`。真实 Browser clean rerun `http://127.0.0.1:5273/` session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis` 直接从默认聊天提交 messy assay CSV 分析目标；没有打开 Scenario Builder，但默认 shell 仍显示 `文献证据评估场景`、`Scenario Runtime`、搜索框 `Execution Unit...` 和场景 code `literature-evidence-review@1.0.0`。首个有用反馈约 1s，90s 后仍 running 且右侧为 `主结果等待 ConversationProjection`；最终 records 中 run `run:task-card:f5u2f3` / task `generated-literature-2182f65faaaa` 为 `protocol-failed; task=needs-work`，根因是 generated `run_analysis.py` 第 90 行 `df´l[col]` 非 ASCII 字符导致 Python `SyntaxError: invalid character '´' (U+00B4)`，未生成 raw/cleaned CSV、报告、脚本复跑结果或图表。Browser reload 后同一 session 没有显示 terminal `repair-needed` 或 SyntaxError 下一步，仍显示 `主结果等待 ConversationProjection`，严格判失败。
- Discovery / handoff 核查（2026-05-17）：handoff `.../handoffs/2026-05-17T09-58-12-251Z-agentserver-generation-f4e6d72b00.json` 含 tiny `capabilityDiscovery` brief（`sciforge.capability-discovery.tiny-brief.v1`、`search/expand/plan/explain`、无 `inputSchema/outputSchema` 大包），但只读 Explorer-A 确认当前缺真正 agent-callable Gateway/helper invocation surface：service 与 prompt guidance 已有，generated task helper 没有 `capability_discovery` 函数，`invoke_capability` 仍主要是 provider route alias。完整 raw handoff 仍包含 AgentServer workspace absolute path，并出现 endpoint/baseUrl/token 等非 discovery 字段，不满足本 P2 hard requirement 的“普通 records/handoff 不要求用户理解内部路径/端点”体验边界。
- Root boundary：Capability Discovery（缺 callable invocation surface）/ AgentServer handoff（仍以 literature scenario 和内部 workspace/endpoint facts 为中心）/ generated-task execution（Python syntax invalid char 未被通用修复）/ Projection + UI restore（terminal repair-needed records reload 后未恢复到结果区）/ Answer-first presentation（默认空态暴露 `ConversationProjection` 内部术语）。
- Sub-agent 结果：Explorer-A 只读确认 discovery contract/service/manifest/tiny brief/test 已存在，但 `capability_discovery.search/expand/plan/explain` 尚未成为 AgentServer 可调用 runtime tool；Explorer-B 只读确认结果区默认基本 answer-first 且 raw/debug 多数折叠，但默认 shell 仍残留 `Scenario Runtime`、`Execution Unit` 和无 Projection 内部术语。
- 收口结论（2026-05-17）：该 P2 strict-eval milestone 保持 `TaskSuccess=false`，因为用户要求的数据读取/QC/统计/图表/复跑包没有在主回复中实际完成；这是正确的严评结论，不改写为成功。P2 原始 root blockers 已由通用修复关闭：`DISC-20260517-P2-002` 的 generated helper / AgentServer stream-side invocation surface 已补齐，stream 只产出 discovery tool-call 且无终态结果时会 bounded retry 并携带 compact `capabilityDiscoveryToolResults`；`DISC-20260517-P2-003` reload 后 terminal repair-needed projection 已恢复；`DISC-20260517-P2-004` generated Python syntax preflight 已在执行前拦截非法 Unicode/语法错误。剩余 `CapabilityPlanSummary` 默认 UI 接线、通用聊天入口和 answer-first polish 归入 UX-SYSTEM 主线，不在 P2 task 重复登记。
- 验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts src/ui/src/app/projectionApi.test.ts` 通过 46/46；`npm run typecheck` 通过。历史首轮验证 `node --import tsx --test src/runtime/capability-discovery.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/agentserver-prompts.test.ts packages/contracts/runtime/capability-manifest.test.ts` 通过 29/29；旧 registry sourceCounts 失败来自并行 registry 变更，当前未作为 P2 blocker 继续跟踪。

人类角色：一个需要快速分析实验数据并复现结论的数据科学/科研用户。

探索方向：CSV/TSV 数据读取、EDA、统计检验、图表、脚本/notebook、复跑命令、敏感性分析。

自主任务建议，worker 可自由选择或改写：

- [x] 生成或导入一个含 batch/timepoint/treatment 的实验数据集并分析。
- [x] 让 SciForge 对一个有 confounder 的数据场景做统计解释和 robustness check。
- [x] 要求导出可复跑 notebook/script，再基于 selected artifact 解释结论。

严评重点：

- [x] 不能只有聊天文字，必须有可打开的数据、报告、图表或脚本 artifact。
- [x] 统计结论必须包含样本量、效应方向、检验假设和限制。
- [x] 复跑命令必须真实可执行或给出真实 blocker。
- [x] 图表/报告 follow-up 必须基于 selected artifact 内容。

### P3 Human Reproducer - Paper Reproduction / Code Debug

状态：done
Owner：P3
Browser：`http://127.0.0.1:5373/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

人类角色：一个尝试复现论文核心方法、调试失败并判断复现可信度的研究者。

探索方向：最小可运行 demo、代码生成、运行验证、metric consistency、repair loop、ablation/baseline。

本批自主探索目标（P3，2026-05-17）：

- [x] 真实用户目标：让 SciForge 复现一个 Logistic growth ODE 参数估计 toy experiment，生成最小可运行 Python demo、实际运行、报告拟合指标和复现可信度。
- [x] Hard requirements：必须生成代码 artifact；必须实际运行或给出真实 blocker；必须报告参数估计、RMSE/误差等 metric；若运行失败必须 bounded repair 并重新验证；最终网页主回复、代码、workspace 产物和指标必须一致。
- [x] 验收方式：用 in-app browser 在 `http://127.0.0.1:5373/` 自然提交任务、打开/查看产物、选择 artifact 追问复现可信度、reload 后继续追问；必要时保存升级 evidence。
- [x] Sub-agent 分工：P3 owner 负责 browser 操作和最终严格判定；sidecar agents 并行做 P3 环境/产物核查、失败 root-boundary 定位和 targeted tests 建议。

本轮结论（P3，2026-05-17）：首轮真实 browser run `project-literature-evidence-review-mp8tmbus-d780yv` / task `generated-literature-8ef4985b7dc3` 生成并运行 Logistic growth ODE fitting demo，workspace 产物含 `logistic_fit_demo.py`、`generated-literature-8ef4985b7dc3-reproduction-report.md`、JSON output 与 stdout/stderr logs；报告给出 `r true 0.5000 -> fitted 0.4767, error 4.67%`、`K true 200.0 -> fitted 201.5, error 0.77%`、`RMSE 4.3505`、`Reproduction success: YES`。严格追问 selected reproduction report 时，首轮 follow-up `project-literature-evidence-review-mp8u57o6-r229qf` 和重试 `project-literature-evidence-review-mp8ughrj-g0hk8z` 被旧 direct-context legacy fallback 误判成 planning-register，输出预算/时间线/风险登记表，严格判 `TaskSuccess=false` for follow-up。通用修复后，复验 run `project-literature-evidence-review-mp8unjqv-z81dk6` 改为直接回答 selected report 的可信度、精确指标、剩余风险和下一步验证；继续从网页端严评又发现 selected-report literal facts / PASS-FAIL follow-up 在 fallback direct-context 路径上仍可能被 required verification 降为 partial，且旧 partial run 会抢占右侧结果焦点；已在 `P3-TASK-20260517-selected-report-web-followup-hardening` 通用关闭。

P3-TASK-20260517-logistic-ode-reproduction：

- 用户目标：复现 paper-style ODE 参数拟合核心思想，生成可运行 Python demo，运行并报告 true/fitted `r`、`K`、RMSE、percent errors 和是否可信。
- Hard requirements 验收：代码 artifact 存在并被 executionUnit 引用；output JSON 记录 `runtimeFingerprint`、`codeRef`、`stdoutRef`、`stderrRef`、`outputRef`；report 指标与网页主回复一致，且误差低于 15% 阈值；没有 Torch 依赖，使用 bounded differential evolution + least-squares fallback。
- 首轮严格判定：initial reproduction `TaskSuccess=true` for toy reproduction；selected report credibility follow-up `TaskSuccess=false` before fix，因为用户问“是否可信/指标/最大风险/下一步验证”却被 generic `risk(s)` regex 路由成 planning register。
- Root boundary：`src/runtime/gateway/direct-context-fast-path.ts` 的 `answerOnlyTransformRequestedLegacyFallback` 把普通 selected report “risk” 问句当作 `answer-only-planning-register`；同时 selected reproduction/report QA 缺少优先于 answer-only transform 的专用直接回答分支。
- 通用修复：收窄 planning-register legacy trigger，只保留 explicit budget/timeline/milestone/risk-register/unresolved-risk 变换请求；新增 selected report QA 分支，从 selected refs 对应 report/artifact/file context 提取 verdict、metric、risk 和 validation step；不绑定 P3、端口、run id 或 Logistic prompt。
- 额外 hardening：`direct-answer-payload` 现在拦截声称已运行/复现/测试成功但没有 durable workspace execution evidence 的纯文本；`result-metric-consistency` 扩展常见 prose percent-error 解析；UI draft 更新相同长文本时保持引用不变，避免 textarea onChange 最大更新深度循环。
- Browser 复验：重启 P3 Vite 后，在 in-app browser 选择 reproduction report 并提交同一 follow-up，run `project-literature-evidence-review-mp8unjqv-z81dk6` 的 response 为 “Answered directly from the selected report”，列出 `Reproduction success: YES`、`r true 0.5000, fitted 0.4767, error 4.67%`、`K true 200.0, fitted 201.5, error 0.77%`、`RMSE 4.3505`，最大风险为 synthetic/fixed-seed/toy/noisy setup，下一步为 multiple seeds/noise levels。
- Workspace refs：`workspace/parallel/p3/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp8tkh0o-tdin1l/tasks/generated-literature-8ef4985b7dc3/logistic_fit_demo.py`、`.../task-results/generated-literature-8ef4985b7dc3-reproduction-report.md`、`.../task-results/generated-literature-8ef4985b7dc3.json`、`.../records/session.json`。
- 验证：`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/result-metric-consistency-guard.test.ts src/ui/src/app/sciforgeApp/appStateModels.test.ts` 通过 62/62；`npm run typecheck` 当前仍被并行/既有 `src/runtime/gateway/result-presentation-contract.test.ts(221,7)` 的 `methodology` skillDomain 类型错误阻塞，非 P3 修改引入。

P3-TASK-20260517-selected-report-web-followup-hardening：

- 状态：done
- 用户目标：继续从网页端严评 selected `reproduction-report` follow-up，尤其是 PASS/FAIL、反事实阈值、Random seed/Optimizer 等只读事实追问，确认主回复和右侧结果面板是否真的完成而不是只“看起来有回答”。
- Hard requirements：必须只基于当前选中的 `reproduction-report`；不能复用旧 credibility summary 或未选 sibling artifact；PASS/FAIL 必须逐项重算；literal facts 不能吞掉后续字段；只读 direct-context answer 的 visible unverified verification 不能把已回答任务降为 partial；reload/点击文件后右侧结果不能被旧 partial run 抢焦点。
- 首轮严格判定：`TaskSuccess=false` for affected follow-ups。Web run `project-literature-evidence-review-mp8x2i3v-czzbd5` 的 PASS/FAIL 追问被旧 credibility summary 路径污染并显示 partial；`project-literature-evidence-review-mp8x962l-dlt3li` 的 Random seed/Optimizer 追问虽有目标字段但仍被 required verification 包装成 degraded-result；旧 partial/recoverable run 会在同 session 新 satisfied run 后恢复右侧焦点。
- Root boundary：`direct-context-fast-path` 对 selected report 的事实/审计问答太窄，fallback payload 本身没有携带 canonical direct-context 请求线索时，runtime verification policy 仍消费 Agent Harness required policy；UI recovery focus 只看旧 recoverable run，没有同 session newer satisfied supersession。
- 通用修复：selected-only 与 prompt-named filename context scoping 覆盖 fallback direct-context payload；currentReferenceDigest 指名文件会补成可读 research-report artifact，artifact policy 会把 metadata/delivery 中的 readable refs 提升为 direct-context ref；新增 selected report PASS/FAIL audit、counterfactual threshold、literal field extraction、rerun-info 与 evidence-boundary branches；literal facts 从 flattened browser text 的 statement parts 读取字段，避免 `Random seed` 吃到 `Optimizer/Bounds`；全文/PDF evidence-status 分支只在明确提到 PDF/full-text/arXiv/全文读取/引用验证时触发，避免把普通“能否支持结论”误套成全文调研模板；runtime verification contract 现在从 payload 自身识别 `sciforge.direct-context-fast-path`，对无显式 verifier/human/release/high-risk 的只读 direct-context answer 记录 visible unverified 但 non-blocking；UI recoverable focus 会跳过已被同 session 更新 satisfied/validated run supersede 的旧 partial。
- Browser 复验：重启 P3 服务后，在 `http://127.0.0.1:5373/` 真实选择 `reproduction-report` 并提交 `※1 只基于当前选中的 reproduction-report，报告里的 Random seed 是几？Optimizer 是什么？请只回答这两项，不要给可信度总结。`，run `project-literature-evidence-review-mp8y1gwb-znebcn` 显示 `protocol=protocol-success; task=satisfied`，主回复只列 `Random seed: 42` 与 `Optimizer: differential_evolution (polish=True) → fallback least_squares if needed`；右侧结果视图显示核心结果 `reproduction-report`，没有“只得到部分结果”。
- 追加 Web 严评：按用户要求继续从网页端追问不同问题类型。反事实阈值 run `project-literature-evidence-review-mp8yhqlk-ey9v03` 正确重算为 r FAIL、K PASS、RMSE FAIL，整体不能判成功；literal facts run `project-literature-evidence-review-mp8ykrqp-xx1if2` 只回答 `Random seed: 42` 与 optimizer，未吞 `Headings/Bounds`；rerun-info 首轮 `project-literature-evidence-review-mp8yzzm6-ipaore` 暴露只剩 digest、未列出脚本名，修复后 C5 run `project-literature-evidence-review-mp8zctwn-m1xbol` 同时携带 digest 与合成 report body，回答“完整 rerun command 未给出；脚本路径 `logistic_fit_demo.py`（报告只给出脚本名，不是完整路径）；缺工作目录/依赖/输入位置”；evidence-boundary 首轮 `project-literature-evidence-review-mp8z1qr9-w8kpnj` 曾把“证据边界”误当 `Bounds`，修复后 D2 run `project-literature-evidence-review-mp8z4jz3-g14adu` 与 E2 run `project-literature-evidence-review-mp8zgfzr-ypld2u` 均为 `task=satisfied` / `resultPresentation.status=complete` / `verification.required=false`，E2 明确不能外推真实数据、复杂模型、随机种子稳健、噪声水平、第三方复跑和独立验证集。
- Workspace refs：`workspace/parallel/p3/.sciforge/workspace-state.json` archived session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp8koxek-mp8tkh0o-tdin1l`，latest run `project-literature-evidence-review-mp8y1gwb-znebcn` 记录 `displayIntent.verification.nonBlocking=true`、`verificationResults[0].diagnostics.required=false`、`resultPresentation.status=complete`、`conversationProjection.visibleAnswer.status=satisfied`。
- 验证：`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts packages/contracts/runtime/artifact-policy.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/verification-policy.test.ts` 通过 79/79；`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts` 通过 5/5；`npm run typecheck` 通过。

P3-TASK-20260517-buggy-paper-code-repair-loop：

- 状态：done
- 用户目标：像论文复现用户一样，把 workspace 中一个有 bug 的最小 ODE/optimization 复现实验交给 SciForge，要求它读取代码、定位失败、修改/生成 patch、实际重跑测试，并给出修复证据和可信度报告。
- 为什么属于 P3：该任务覆盖论文复现 / 代码调试方向的核心动作：读代码、运行失败、定位 root cause、patch、rerun、报告 metric 和 remaining risks。
- Hard requirements：必须基于 workspace 代码而不是泛泛建议；必须实际运行原始失败或给出真实 blocker；必须修改或生成修复后的代码 artifact；必须重跑并报告命令、stdout/stderr 或可核查 refs；主回复不能只说“建议修复”或用 debug/audit 噪声替代结论；如果能力不足必须诚实失败并给出 root boundary。
- 本批 sub-agent 分工：P3 owner 负责 browser 自然使用、严格验收和 PROJECT 同步；sidecar agents 并行核查 workspace/session 产物、勘察 repair-loop / ArtifactDelivery / Projection 边界和建议 targeted tests。
- 首轮严格判定：`TaskSuccess=false` / `AnswerQuality=failed/projectionless-runaway`。真实 Browser 在 `http://127.0.0.1:5373/` 默认聊天提交 `buggy_inverse_square_decay.py` 调试任务；首轮命中 stale `capability_discovery: name must be non-empty` registry failure，重启后 run 进入 AgentServer stream，读取脚本、跑出原始失败 `RMSE 6.6277`，定位 `amplitude / distance` vs expected `amplitude / distance^2`，并写出 `fixed_inverse_square_decay.py` / `buggy_inverse_square_decay_fixed.py`，但网页长期停留 `running` / `主结果等待 ConversationProjection`，`records/runs.json` 和 `records/execution-units.json` 为空；用户硬需求没有可见完成。
- Root boundary：AgentServer / Runtime Bridge / Projection。bounded harness 已声明 `maxWallMs=30000`、`maxToolCalls=2`、`costUnits=2`，但 `agentServerGenerationTokenGuardLimit` 被置空，导致 backend stream 可消耗 650k+ tokens 且在有 workspace write side effects 后仍无 terminal ToolPayload / Projection；同时默认 UI 仍显示 `文献证据评估场景`、`Scenario Runtime`、`Execution Unit` 和内部 `ConversationProjection` 空态，属于 Universal Chat / Answer-first UX blocker。
- 通用修复：`src/runtime/gateway/agentserver-stream.ts` 恢复非 prompt 特例的 token guard：repair-continuation 上限 60k-120k；bounded/quick harness 预算上限 80k-180k；普通长流允许到 160k-400k。触发后复用现有 convergence guard/failure recovery，避免 projectionless wait。
- Browser 复验：重启 P3 后同一任务 run `project-literature-evidence-review-mp9ltnn6-nu2nse` 在 214,465 tokens 触发 guard（limit 180,000），网页投影为 `protocol=protocol-failed; task=needs-work`，右侧显示 `运行需要恢复` / recoverable，而不是永久 `主结果等待 ConversationProjection`。严格结论仍是 `TaskSuccess=false`，因为 SciForge 未把已写出的修复脚本和复跑结果转成主回复/report；该剩余通用缺口登记为 `DISC-20260517-P3-003`。
- Workspace refs：原始脚本 `workspace/parallel/p3/buggy_inverse_square_decay.py`；backend 写出的修复脚本 `workspace/parallel/p3/fixed_inverse_square_decay.py`、`workspace/parallel/p3/buggy_inverse_square_decay_fixed.py`；失败/复验 session `workspace/parallel/p3/.sciforge/sessions/2026-05-17_workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp9liwqr-61ht34/` 与 `workspace/parallel/p3/.sciforge/sessions/2026-05-17_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp9liwqr-61ht34/`。
- 验证：`python workspace/parallel/p3/buggy_inverse_square_decay.py` 原始失败，`RMSE 6.6277`；`python workspace/parallel/p3/fixed_inverse_square_decay.py` 通过，`RMSE 0.3608685583720119`、`amplitude=120.26978183646752`、`offset=3.292200473366757`；`node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts` 通过 6/6。

P3-TASK-20260517-weighted-survival-auc-debug:

- 状态：done
- 用户目标：像论文复现/代码调试用户一样，让 SciForge 读取当前 workspace 的 `weighted_survival_auc.py` 与 `test_weighted_survival_auc.py`，先运行失败单测，定位 IPCW pair weight / tie-credit bug，修改代码，复跑同一 pytest，并在主回复中报告 root cause、patch summary、命令、测试结果和 remaining risks。
- 为什么属于 P3：该任务覆盖论文复现指标实现调试，硬需求是读代码、跑单测、定位公式实现错误、生成 patch、复跑验证，而不是写解释或导出已有 artifact。
- Hard requirements：必须基于当前 workspace 文件；必须运行 `python -m pytest test_weighted_survival_auc.py -q` 或明确真实 blocker；必须定位 pairwise IPCW 权重/平局 credit 错误；必须修改或生成修复代码；必须复跑同一命令并报告结果；网页主回复不得用旧 script/artifact、audit refs 或 recover action 冒充成功。
- 首轮严格判定：`TaskSuccess=false` / `AnswerQuality=fake-success`。Browser run `project-literature-evidence-review-mp9n4v5g-7dgp5u` 和 `project-literature-evidence-review-mp9n8dw6-1zh8j9` 在用户明确要求 debug/read/pytest/modify/rerun 时，仍被 `local-reproducible-method-runtime` 用旧 `fixed_inverse_square_decay.py` artifact refs 短路为 `protocol-success; task=satisfied`，主回复未读 `weighted_survival_auc.py`、未跑 pytest、未定位或修改目标 bug。
- Root boundary：Gateway / local reproducible-method runtime / stale current artifact refs。该 runtime 只应处理“导出现有复现方法/脚本/命令”的请求，不能在 fresh code-debug / test-run / patch 请求里把当前 refs 当成完成证据。
- 通用修复：`src/runtime/local-reproducible-method-runtime.ts` 新增 fresh code debug/execution 意图守卫，覆盖 debug/read code/pytest/unit tests/failing tests/run/rerun/root cause/patch/modify/edit/repair/bug 和中文调试/修复/单测/运行测试等任务类别；守卫按意图类别工作，不绑定 P3、端口、run id、文件名或论文题目。反回归测试证明 stale script ref 存在时调试请求返回 `undefined` 继续进入正常 coding/execution 路径，同时 `fixed_*.py` 这类文件名仍可被正常导出，避免把文件名误当“fix action”。
- Browser 复验：重启 P3 后同一 weighted AUC debug 请求不再被旧 artifact export 短路；latest run `project-literature-evidence-review-mp9nc705-mhop0i` 进入 AgentServer generation，并在 209,334 tokens 触发 convergence guard（limit 180,000），网页投影为 `protocol=protocol-failed; task=needs-work` / `运行需要恢复`。严格结论仍是 `TaskSuccess=false`，因为网页主回复没有交付 root cause、patch summary、pytest rerun 或可核查修复报告；该剩余通用缺口登记为 `DISC-20260517-P3-004`。
- Workspace/evidence refs：任务文件 `workspace/parallel/p3/weighted_survival_auc.py`、`workspace/parallel/p3/test_weighted_survival_auc.py`；session `workspace/parallel/p3/.sciforge/sessions/2026-05-17_literature-evidence-review_session-p3-candidate-browser/records/runs.json`；browser 复验证据 `workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-code-debug-after-runtime-guard.png`。
- 验证：`python -m pytest workspace/parallel/p3/test_weighted_survival_auc.py -q` 当前 2/2 通过，说明 workspace 代码已被修成 product IPCW pair weights，但网页主回复未把该 side effect 交付给用户；`node --import tsx --test src/runtime/local-reproducible-method-runtime.test.ts` 通过 5/5；`npm run typecheck` 通过。

自主任务建议，worker 可自由选择或改写：

- [x] 复现一个小型 ODE / optimization / ML toy experiment。
- [x] 让 SciForge 生成代码后主动运行、发现失败、修复并重新验证。
- [x] 选择失败报告 artifact，要求判断复现是否成功并提出下一步实验。

严评重点：

- [x] 不能声称代码可运行但没有运行/验证证据。
- [x] 指标失败时不能宣称成功。
- [x] Repair 必须 bounded，不得无限循环。
- [x] 代码、指标、报告和网页主回复必须一致。

P3-TASK-20260517-dependency-aware-metric-debug:

- 状态：done
- 用户目标：像论文复现/代码调试用户一样，让 SciForge 调试 workspace 中一个最小 metric reproduction 脚本：它错误地硬依赖一个不存在的 third-party 包，并且当前实现的 baseline formula 有数值 bug。用户要求系统读取代码和测试、运行失败、判断是安装依赖还是写通用 fallback、修改代码、复跑测试，并在主回复给出 root cause、patch summary、命令、测试结果和 remaining risks。
- 为什么属于 P3：该任务覆盖论文复现 / 代码调试方向里最常见的“复现实验缺依赖 + 指标实现错误”组合，必须证明 SciForge 能自然处理代码读取、依赖/能力判断、测试执行、patch、复跑和可核查证据，而不是只给建议或暴露 debug refs。
- Hard requirements：必须基于当前 workspace 文件；必须运行 `python -m pytest test_kernel_mmd.py -q` 或明确真实 blocker；必须识别 `paper_metric_kernel.py` 对缺失包 `fastmmd` 的不必要硬依赖；必须修改代码以提供本地 NumPy fallback 且修复 biased/unbiased MMD denominator bug；必须复跑同一 pytest 并报告结果；如果需要能力发现，主流程应通过受控 discovery / capability 路径而不是要求普通用户理解场景 builder；网页主回复不得用旧 artifact、audit refs、recover action 或“已写入文件”冒充成功。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5373/` 自然提交任务；用 workspace 文件、pytest 输出、session records 和必要截图核查；先严格判 `TaskSuccess`，失败则定位 root boundary 并只做通用修复。
- 本批 sub-agent 分工：P3 owner 负责 workspace seed、browser 自然使用、代码定位、通用修复、测试和 PROJECT 同步；本轮未启用 sub-agent，避免与正在变动的 gateway/harness 文件产生写冲突。
- Baseline：`python -m pytest workspace/parallel/p3/test_kernel_mmd.py -q` 在故意未修的 seed 上因 `ModuleNotFoundError: No module named 'fastmmd'` 失败，符合用户任务的初始缺依赖条件。
- 首轮严格判定：`TaskSuccess=false` / `AnswerQuality=failed/runaway-stale-continuity`。Browser run `project-literature-evidence-review-mp9p2jgz-zoej21` 在 fresh code-debug 请求中继承 stale repair continuity：handoff 显示 `expectedArtifactTypes=research-report,paper-list,evidence-matrix,notebook-timeline`、scenario component ids、`priorAttemptCount=4`、`harnessSummary.intentMode=repair`，最终 204,072 tokens 触发 convergence guard。网页主回复没有读取/修复/复跑目标代码。
- Root boundary（已修）：Agent Harness / Gateway / AgentServer handoff。fresh 论文复现代码调试任务不应从旧 repair context、旧场景 artifact defaults 或 stale prior attempts 推断 continuity；malformed AgentServerGenerationResponse 也不应丢失已发生的 workspace side-effect WorkEvidence。
- 通用修复：`agent-harness-continuity-decision` 只有在 request refs/current refs/recent execution refs/run metadata 中存在具体 failed/recover-action/failure-evidence 目标时才启用 repair continuity；`agent-harness-shadow` 不再把无目标 stale repair policy 或 stale harness contract 注入新任务；`gateway-request` 对 fresh code debug/execution prompt 清空 scenario default expected artifacts / component ids，除非用户明确请求 paper list/evidence matrix/report 等科研 artifact；`agentserver-generation-dispatch` 只在真实 continuity/repair 时附带 prior attempts，并在 malformed generation response failure diagnostics 中保留 workspace side-effect evidence。
- Browser 复验：中间 run `project-literature-evidence-review-mp9plv5x-1kmgni` 已不再继承 scenario artifacts，AgentServer 曾实际把 `paper_metric_kernel.py` 改为 NumPy fallback 且本地 pytest 2/2 通过，但主回复因 malformed response parser failure 未交付 hard requirements；该 failure path 已补 side-effect diagnostics 测试。最终重置 seed 后 run `project-literature-evidence-review-mp9pzl5a-e56fsc` 的 handoff 已变为 `expectedArtifactTypes=[]`、`selectedComponentIds=[]`、`priorAttemptCount=0`、`repairContinuation=false`、`harnessSummary.intentMode=fresh`，证明 stale continuity/场景默认污染已通用关闭；严格结论仍是 `TaskSuccess=false`，因为 generated Python entrypoint syntax preflight 终止后没有 bounded repair/regeneration 或用户可核查主回复，该剩余通用缺口登记为 `DISC-20260517-P3-005`。
- Workspace/evidence refs：任务文件 `workspace/parallel/p3/paper_metric_kernel.py`、`workspace/parallel/p3/test_kernel_mmd.py`；首轮证据 `workspace/parallel/p3/.sciforge/evidence/p3-kernel-mmd-convergence-failure.png` / `.json`；最终复验证据 `workspace/parallel/p3/.sciforge/evidence/p3-kernel-mmd-fresh-routing-syntax-preflight.png` / `.json`；最终 run `project-literature-evidence-review-mp9pzl5a-e56fsc`。
- 验证：`node --import tsx --test src/runtime/gateway/agent-harness-continuity-decision.test.ts src/runtime/gateway/gateway-request.test.ts src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agent-harness-shadow.test.ts` 29/29 通过；`python -m pytest workspace/parallel/p3/test_kernel_mmd.py -q` 当前 seed 仍按设计暴露 `fastmmd` blocker，供后续 browser/debug 复现。

### P4 Human Developer - SciForge Coding / Self-improvement

状态：done
Owner：P4
Browser：`http://127.0.0.1:5473/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

本批自主探索目标：以真实开发者身份要求 SciForge 阅读自身 runtime/gateway 与 task-attempt 相关代码，找出一个能提升 coding-agent 交付可信度的通用小改进，形成补丁/测试/PR summary 与 risk checklist；若主回复只给建议、未真实读取代码、未生成可核查 patch 或未说明验证边界，则判 `TaskSuccess=false` 并定位到 gateway / AgentServer / ArtifactDelivery / UI restore 等通用边界。

本轮结论（P4，2026-05-17）：`TaskSuccess=false` / `AnswerQuality=failed` for the Web UI attempt, because run `project-literature-evidence-review-mp8tl06x-50de0d` in session `session-literature-evidence-review-mp8tjlyj-zuo9g4` failed with recoverable `AgentServer generation stopped by convergence guard after 147091 total tokens (limit 80000)` and produced no patch artifact. Browser reload after restart still showed `failed` / `运行需要恢复`, not fake satisfied. P4 owner completed the coding hard requirements directly in repo with a generic runtime contract patch: `TaskAttemptRecord` and `TaskRunCard` now carry `codingDeliverySummary` with read files, planned/modified files, patch refs, verification commands, risk checklist and generality statement; summaries are hydrated from attempt records or task output payloads and projected as durable refs.

P4 验收：

- [x] 真实用户目标：把 SciForge 当 coding agent，要求它阅读自身 task-attempt / task-run-card 代码并生成通用交付可信度补丁。
- [x] Hard requirements：网页主回复未完成 patch，严格判失败；P4 owner 实际读取并修改 `src/runtime/task-attempt-history.ts`、`src/runtime/runtime-types.ts`、`packages/contracts/runtime/task-run-card.ts`、`packages/contracts/runtime/index.ts` 及对应测试。
- [x] 通用修复：新增 `sciforge.coding-delivery-summary.v1` contract，不绑定 prompt、P4、端口、backend 或文件名；非 coding task 可缺省该字段。
- [x] Targeted tests：`npx tsx src/runtime/task-attempt-history.test.ts` 9/9 pass；`npx tsx packages/contracts/runtime/task-run-card.test.ts` 10/10 pass；`npm run typecheck` pass。
- [x] Browser 复验：`http://127.0.0.1:5473/` reload 后原失败 run 仍显示 `failed` / `运行需要恢复`，没有把失败包装成满意结果。
- [x] Sub-agent 勘察完成：direct-answer 伪成功、workspace file containment、repair fixed evidence gate 等非当前 blocker 已进入 Discovered Task Queue。

人类角色：一个把 SciForge 当 coding agent 使用的开发者，要求它阅读本仓库、提出通用改进、实现补丁并说明风险。

探索方向：代码理解、selected file grounding、patch planning、测试生成、PR summary、artifact presentation。

P4-TASK-20260517-universal-chat-coding-discovery：

- 状态：done
- 用户目标：从普通聊天入口直接要求 SciForge 自查“默认结果区是否把 run/debug/audit 噪声放在用户答案前面”，让它定位代码边界、提出通用修复、生成 patch、运行相关测试，并给出 PR summary / risk checklist。
- 为什么属于 P4：这是 SciForge 自我改进 coding 任务，要求系统理解本仓库 UI/runtime 边界、识别通用 UX blocker、修改代码并验证；同时覆盖本轮 UX-SYSTEM 的 universal chat、capability discovery、answer-first results 和 UI/execution decoupling 假设。
- Hard requirements：不打开 Scenario Builder 或手工配置 allowlist；主回复必须说明读取了哪些代码边界、修改了哪些文件、patch 如何通用、运行了哪些测试及结果；如果不能真实修改/测试必须明确失败；不得把 discovery plan、audit refs、recover action、debug 输出或“satisfied”文本当作 coding 成功证据。
- Sub-agent 批次计划：Explorer-A 只读勘察 capability discovery / handoff brief 当前实现缺口；Explorer-B 只读勘察结果区 answer-first / debug folding UI 边界；P4 owner 负责 Browser 复现、必要通用修复、测试、PROJECT 回写与 git 同步，避免 sub agents 修改文件。
- 验收方式：Browser `http://127.0.0.1:5473/` 自然提交任务并 reload/查看 artifact；用 workspace records 和相关测试核对主回复、artifact、refs、patch/test evidence 是否满足硬需求；若失败，定位 root boundary 并追加 discovered task 或完成通用修复。
- 首轮严格判定：`TaskSuccess=false` / `AnswerQuality=failed+UX-blocker`。真实 Browser 在 `http://127.0.0.1:5473/` 不打开 Scenario Builder 提交 coding/self-improvement 任务；新用户消息写入 session `session-literature-evidence-review-mp8tjlyj-zuo9g4` / versions `version-mp9lgdkn-7v5xgu`、`version-mp9lgdq7-wemdym`，页面直接显示 `Invalid capability manifest registry: capability_discovery: name must be non-empty`，没有 patch、测试或 PR summary；右侧仍聚焦旧 run `project-literature-evidence-review-mp8tl06x-50de0d` 并默认展开/暴露 execution-unit、audit、run id 等调试内容，普通用户难以判断新任务是否已执行。
- Root boundary：Capability Manifest Registry / Capability Discovery invocation surface / UI restore + result debug folding。discovery contract/service/tiny brief 已存在，但 generated-task helper 缺少 `capability_discovery.*` 调用桥，导致 agent 只能看到 brief/guidance；结果区失败态默认打开 audit details，把旧 run 调试噪声放在用户答案前。
- 通用修复：`sciforge_task` helper 现在支持 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)`，从 bounded task routes 做 progressive disclosure，过滤 endpoint/auth/token/workspace root，且 plan 输出 `completionEvidence=not-evidence`；helper import hint 暴露 discovery helper；结果区 `shouldDefaultOpenRunAuditDetails` 改为默认折叠，保留显式“查看运行细节”入口。
- Browser 复验：reload `http://127.0.0.1:5473/` 后 `Invalid capability manifest registry` 不再可见；`可复现执行单元` 不再默认出现在正文；所有 result/debug `<details>` 均为 closed，用户先看到“运行需要恢复”和失败原因，debug/audit 需要主动展开。
- Sub-agent 结果：Explorer-A 确认 discovery 有 contract/service/tiny handoff/tests，但缺 agent-callable generated-task/Gateway invocation surface；Explorer-B 确认 chat presentation 已基本 answer-first，但右侧 result panel 会默认展示 run id / 执行单元 / audit details，建议在 `results-renderer-execution-model` 与 `ResultsRenderer` 边界修复。
- 验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 11/11；`node --import tsx --test src/ui/src/app/results-renderer-execution-model.test.ts` 24/24；`node --import tsx --test src/runtime/capability-discovery.test.ts packages/contracts/runtime/capability-manifest.test.ts` 5/5；`npm run typecheck` 通过。

自主任务建议，worker 可自由选择或改写：

- [ ] 让 SciForge 分析某个 runtime/gateway/UI 模块并提出小改进。
- [ ] 让 SciForge 实现一个测试 helper 或修复一个通用边界。
- [ ] 选择 patch/report artifact，要求生成 PR summary 和 risk checklist。

严评重点：

- [x] 不能通过修改 `PROJECT.md` 或输出建议来伪造 coding 成功。
- [x] SciForge 必须真实读取目标代码或 selected file 内容。
- [x] 生成 patch 时必须说明通用性、验证命令和风险。
- [x] 如果需要人工接管，必须给出真实 blocker 和可执行下一步。

### P5 Human Methodologist - Experimental Design / Review

状态：done
Owner：P5
Browser：`http://127.0.0.1:5573/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P5，2026-05-17）：作为真实 PI / 方法学 reviewer，要求 SciForge 审查一个受预算和样本获取限制的 single-cell perturbation biomarker 实验设计，并交付可执行 protocol、reviewer critique、mitigation checklist；严格检查用户约束是否改变设计、controls/bias/failure modes/sample size 假设是否具体、reload 后最终 protocol 与约束是否保持。

P5 结论（2026-05-17）：首轮真实 Browser run 在 `http://127.0.0.1:5573/` 生成 single-cell perturbation biomarker protocol/checklist artifact，workspace session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_workspace-biomedical-knowledge-graph--kras-g12d----mp8tjp68_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8tk2oo-zbhhol`，主 artifact `task-results/generated-knowledge-e4be5b9cba2d-sc-biomarker-protocol-checklist.md` 覆盖 endpoints、paired donor/blocking/randomization、controls、sample size/power、batch/QC、10 个 failure modes、go/no-go 与约束如何改变设计；但 UI 显示 `Verification: 未验证` / `degraded-result` 的同时仍有 completed/satisfied 口径，严格判 `TaskSuccess=false` / `AnswerQuality=fake-success/partial`。

P5 修复边界（2026-05-17）：Projection / ConversationKernel / ResultPresentation 现在区分 protocol success 与 user-task success；required verification 为 unverified、或当前请求显式要求 verification 但没有 pass verdict 时，不能采用 `displayIntent.taskOutcome=satisfied`，terminal visible text 与 result presentation 会降级为 partial/needs-work，并保留 artifact draft summary 与 verifier/human-approval 下一步。

P5 复验（2026-05-17）：targeted `node --import tsx --test src/runtime/gateway/result-presentation-contract.test.ts src/runtime/conversation-kernel.test.ts tests/smoke/smoke-conversation-kernel-final-shape.ts` 通过 28/28。Browser 新跑 `Post-fix P5 verification gate check` 后不再出现 `task=satisfied`，页面显示 `protocol-failed; task=needs-work` / `repair-needed` / `Verification: 未验证`，没有“审查完成/已完成”主口径；同时暴露新的 AgentServer repair-boundary follow-up，已登记 `DISC-20260517-P5-001`。

P5-TASK-20260517-longitudinal-microbiome-rct：

- 状态：done
- 用户目标：作为 PI / 方法学 reviewer，请 SciForge 审查并重写一个受预算、伦理和 dropout 限制的 longitudinal microbiome RCT protocol：36 名 IBS 患者，probiotic vs placebo，baseline/week4/week8 stool metagenomics + symptom score，最多 108 个 sequencing libraries，预计 20% dropout，抗生素暴露不可完全排除，两家 clinic 招募，6 个月内完成。
- Hard requirements：必须输出可执行 protocol/checklist artifact；明确 primary/secondary endpoints 和不可回答问题；给出 stratification/blocking/randomization/blinding、placebo/negative/positive controls、样本量与 dropout/power 假设、batch/QC、抗生素/饮食/clinic confounding 处理；至少 10 个 bias/failure modes + mitigation；给出 analysis plan、validation plan、go/no-go criteria；明确哪些约束改变了设计；如果无法验证，不得声称完成。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5573/` 自然提交任务、查看主回复与 artifact、reload 后继续追问“如果预算降到 72 libraries 如何改设计”；逐条核查 hard requirements，若主回复空泛、未体现约束、selected/reload follow-up 污染或 unverified 仍 satisfied，则判失败并定位通用边界。
- P5 结论（2026-05-17）：`TaskSuccess=true` for artifact delivery, `AnswerQuality=accurate/degraded` because required verification remains unverified and correctly projects `task=needs-work` instead of satisfied. Browser clean run at `http://127.0.0.1:5573/` produced `protocol=protocol-success; task=needs-work` without KRAS/stale contamination; session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8y5b23-boyhh6`, task `generated-literature-1a48fa75c4cf`, artifacts `generated-literature-1a48fa75c4cf-artifact-protocol-checklist.md` (217 lines), `generated-literature-1a48fa75c4cf-artifact-evidence-matrix.csv` (23 lines), and `generated-literature-1a48fa75c4cf-artifact-research-report.md`.
- P5 修复边界（2026-05-17）：关闭 file-backed markdown artifact 被 inline summary 覆盖、verified claims 缺 durable refs、explicit blocker/needs-work findings 被提升为 satisfied、以及 reload 后 read-only protocol budget follow-up 误路由 AgentServer 的通用边界；72-library follow-up 现在从当前 artifact 直接回答，并把 `week 0` 归一为 baseline，避免把 baseline 重复算作第四个时间点。
- P5 复验（2026-05-17）：targeted `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/payload-validation.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/artifact-materializer.test.ts` 通过 75/75。Browser reload 后追问“如果预算降到 72 libraries...”，最新回复为 direct-context：保留 36 名患者、从 3 个时间点压缩为 baseline + week 8 两个时间点、删除 week 4、总计 `36 × 2 = 72 libraries`；没有 AgentServer dispatch、没有 ContractValidationFailure、没有 `week 0`、没有 `task=satisfied`，仍标 `needs-work/blocker`。

人类角色：一个希望 SciForge 帮自己审查实验设计、发现偏差和改写 protocol 的 PI / reviewer / 方法学研究者。

探索方向：hypothesis、controls、sample size、power、bias、negative results、reviewer critique、preregistration protocol。

自主任务建议，worker 可自由选择或改写：

- [x] 审查一个 single-cell / perturbation / biomarker 实验设计。
- [x] 给出资源约束，要求 SciForge 重写 protocol。
- [x] 让 SciForge 生成 reviewer critique、mitigation 和执行 checklist。

严评重点：

- [x] 不能只有泛泛建议，必须形成可执行 protocol 或 checklist。
- [x] 用户约束必须真实改变设计。
- [x] controls、bias、failure modes 和 sample size 假设必须具体。
- [x] reload 后必须保持最终 protocol 和约束。

### P6 Human Project Owner - Long-context Memory / Deliverable Iteration

状态：done
Owner：P6
Browser：`http://127.0.0.1:5673/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P6，2026-05-17）：作为长期项目 owner，要求 SciForge 多轮构建一个可复现实验 mini grant/research package，包含 brief、决策记录、risk register、timeline/budget、约束变更后的全局更新，以及 reload 后继续追问；严格检查旧约束是否污染新结论、selected artifact follow-up 是否基于选中交付物、audit/raw 是否只作为可审计细节而不污染主回复。

P6 结论（2026-05-17）：`TaskSuccess=true` for long-context deliverable iteration after strict Web UI recheck. 真实 Browser 最终只读验收 run `project-literature-evidence-review-mp993stc-fv00af` 在 `http://127.0.0.1:5673/` 返回 `protocol=protocol-success; task=satisfied` / `resultPresentation.status=complete` / `visibleAnswer.status=satisfied`，主回复确认当前有效约束为 `$80,000 USD`、`9 months`、`no real patient data`、团队不变；`$120,000` 仅作为 v1 被替换历史出现，`$84,500` 不存在。

P6 交付物（2026-05-17）：session bundle `workspace/parallel/p6/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8yay7i-2e2jt9/task-results/research-package/` 下四个文件已落盘并互相一致：`project-brief.md` 当前 `Duration: 9 months` / `Total Budget: $80,000 USD`，`timeline-budget.md` 标题为 v2 且 budget table `Total = $80,000 / 100%`，`decision-log.md` 的 D-008 记录 `$120k/12mo -> $80k/9mo`，`risk-register.md` 的 R-011/R-012 覆盖压缩预算/时间线风险。精确 grep 未命中 `$84,500`、`Timeline Overview (12 Months)`、`**Duration:** 12 months`、`**Total Budget:** $120,000` 或 `$120,000 / 100%` 作为当前约束。

P6 修复边界（2026-05-17）：关闭 verified text-only claims 缺 durable artifact refs、soft harness lightweight verification 阻塞只读确认、旧 partial presentation 污染主回复、workspace-root 旧 artifact refs 覆盖 session bundle 新文件、`不要只回答` 被 direct-context 误识别为 answer-only、direct read-only answer 冒充 durable writeback、以及 `不要重写文件` 被误判为 writeback request 的通用边界。所有修复落在 payload validation、verification policy、artifact materializer、direct-context routing 和 task outcome/result presentation projection，没有端口/prompt/session 特例。

P6 复验（2026-05-17）：targeted `node --import tsx --test packages/contracts/runtime/verification-policy.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/payload-validation.test.ts src/runtime/gateway/work-evidence-guard.test.ts packages/contracts/runtime/work-evidence-policy.test.ts packages/observe/web/mcp/playwright-edge.test.ts src/runtime/gateway/artifact-materializer.test.ts src/runtime/gateway/direct-context-fast-path.test.ts` 通过 143/143。最终 Browser run `project-literature-evidence-review-mp993stc-fv00af` 主回复无 `Partial result artifacts`、`required verification`、`human approval`、`Draft result summary` 或后台验证包装泄漏。

人类角色：一个长期项目 owner，希望 SciForge 跨多轮保留目标、约束、决策记录和交付物，并能处理变更。

探索方向：长上下文、多 artifact、selected refs、约束变更、risk register、reload restore、audit/raw boundary。

自主任务建议，worker 可自由选择或改写：

- [x] 构建一个 mini grant / reproducibility audit / research package。
- [x] 多轮生成 brief、主文档、risk register、timeline、budget。
- [x] 中途改变关键约束，要求 SciForge 更新所有受影响结论。

严评重点：

- [x] 历史 DOM 成功片段不能覆盖最新 failed/recoverable 主回复。
- [x] 旧约束不得被当作新事实。
- [x] selected refs follow-up 必须基于选中 artifact。
- [x] audit/raw details 可审计但不得污染主结果。

## Discovered Task Queue

子进程执行时可以自行发现新任务，但必须按模板写入这里，不能直接把偶发现象塞进代码特例。

模板：

```markdown
### DISC-YYYYMMDD-NNN 简短标题

状态：partial fixed / targeted-tests-pass / browser-recheck-pending
发现者：P?
轻量证据：URL 或 workspace 路径、关键 run/session/artifact、用户可见现象、为什么失败
升级证据：仅在需要复现/修复/对比时补 DOM/screenshot/console/network/manifest
通用性说明：为什么这不是单个 prompt 或单个 provider 的偶发问题
疑似边界：policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence / docs

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [ ] 更新对应任务打勾状态和 Activity Log
```

当前发现队列：

### DISC-20260517-P3-003 Code repair side effects need completion-candidate salvage

状态：done
发现者：P3
轻量证据：Browser `http://127.0.0.1:5373/`；P3 code-debug run wrote `workspace/parallel/p3/fixed_inverse_square_decay.py` and `workspace/parallel/p3/buggy_inverse_square_decay_fixed.py`, and local rerun passes with `RMSE 0.3608685583720119`, but the Web task never produced a terminal ToolPayload/report before the convergence guard. Post-fix recheck run `project-literature-evidence-review-mp9ltnn6-nu2nse` correctly became recoverable `protocol-failed; task=needs-work`, but still did not surface the useful fixed artifacts as completion candidates.
升级证据：current P3 session dirs `workspace/parallel/p3/.sciforge/sessions/2026-05-17_workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp9liwqr-61ht34/` and `workspace/parallel/p3/.sciforge/sessions/2026-05-17_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp9liwqr-61ht34/`; browser salvage 验收截图 `workspace/parallel/p3/.sciforge/evidence/p3-completion-candidate-browser.png`。
通用性说明：Any coding/reproduction task can perform workspace write side effects before AgentServer finalization. Runtime should expose legal changed files / rerun outputs as `completion-candidate` or repair evidence without marking false success; this is not specific to inverse-square decay, P3, or the literature scenario.
根边界：AgentServer stream side-effect WorkEvidence / Runtime Bridge failure lifecycle / Projection completion-candidate / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

修复结论（P3，2026-05-17）：新增 generic AgentServer side-effect salvage：backend stream `write_file` / wrote / patched / saved 等通用事件会归一化为 `WorkEvidence(kind=write)`；AgentServer generation failure diagnostics 保留 bounded side-effect WorkEvidence；failure lifecycle 从 workspace 内合法写入文件生成 `displayIntent.completionCandidate`、supporting-evidence ArtifactDelivery 和 object refs，状态保持 `unverified/repair-needed`，不标 satisfied，且不泄漏绝对 workspace root。Browser 复验在 `http://127.0.0.1:5373/` 用 P3 code-debug candidate state 验证右侧显示 `run-p3-candidate-browser · recoverable`、`completion-candidate`、候选 `fixed_inverse_square_decay.py` 与导入/验证恢复动作；正文未出现 `satisfied`。验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts packages/contracts/runtime/work-evidence.test.ts` 18/18 通过；`npm run typecheck` 通过。

### DISC-20260517-P3-004 Code debug side effects on existing files are not surfaced after guard

状态：done
发现者：P3
轻量证据：Browser `http://127.0.0.1:5373/`；weighted AUC debug run `project-literature-evidence-review-mp9nc705-mhop0i` / session `workspace/parallel/p3/.sciforge/sessions/2026-05-17_literature-evidence-review_session-p3-candidate-browser/` 进入 AgentServer 后触发 convergence guard（209,334 tokens / limit 180,000），网页主回复为 recoverable runtime failure；local pytest `python -m pytest workspace/parallel/p3/test_weighted_survival_auc.py -q` 当前 2/2 通过，且 `workspace/parallel/p3/weighted_survival_auc.py` 已变为 product IPCW pair weights，但 Projection 没有把该 existing-file modification 作为 completion-candidate / repair evidence 展示给用户。
升级证据：browser 复验证据 `workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-code-debug-after-runtime-guard.png`、`workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-textual-write-event-recheck.png`、`workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-textual-write-event-recheck.json`；run records `workspace/parallel/p3/.sciforge/sessions/2026-05-17_literature-evidence-review_session-p3-candidate-browser/records/runs.json`；workspace task files `workspace/parallel/p3/weighted_survival_auc.py` 和 `workspace/parallel/p3/test_weighted_survival_auc.py`。通用修复已在 AgentServer generation dispatch 前后采集 workspace side-effect snapshot，并把 modified-existing-file / created-file 转成 bounded `WorkEvidence(kind=write)` 合并进 failure recovery / direct payload salvage；忽略 `.sciforge`、`node_modules` 等内部目录。
修复结论（2026-05-17）：AgentServer generation dispatch 现在会在请求前后对 workspace 做 bounded side-effect snapshot，忽略 `.sciforge` / dependency/cache 目录，只对常见代码、数据、报告文件记录 size/mtime/hash 变化；失败、HTTP error、run failure、direct payload/plain text 等路径都会把 stream WorkEvidence 与 workspace diff WorkEvidence 去重合并。P3 Browser 真实复验 run `project-literature-evidence-review-mp9o7cqm-4kn9ko` 又暴露 AgentServer 有些写入事件只有 `label/detail` 文本（如 `写入完成：/Applications/.../test_weighted_survival_auc.py`）而无结构化 `path`；`work-evidence-adapter` 已通用支持从 textual backend write event 中提取常见 workspace 文件路径并归一化为 `WorkEvidence(kind=write)`。该 evidence 仍只作为 `unverified/repair-needed` completion-candidate 输入，不会把写文件本身当成任务成功。
通用性说明：任何代码调试/论文复现任务都可能修改已有 workspace 文件而不是写新文件；修复不依赖 weighted AUC、P3、端口、具体文件名或错误文本。
疑似边界：AgentServer stream WorkEvidence / Runtime Bridge failure lifecycle / Projection completion-candidate / ArtifactDelivery / harness bounded code-debug loop

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests
- [x] 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P3-005 Generated task syntax preflight needs bounded repair before terminal code-debug failure

状态：todo
发现者：P3
轻量证据：Browser `http://127.0.0.1:5373/`；dependency-aware MMD debug final recheck run `project-literature-evidence-review-mp9pzl5a-e56fsc` 已通用修复 fresh handoff 污染，handoff 为 `expectedArtifactTypes=[]`、`selectedComponentIds=[]`、`priorAttemptCount=0`、`repairContinuation=false`、`harnessSummary.intentMode=fresh`，但网页主回复为 `SciForge runtime gateway needs repair or AgentServer task generation: 运行失败：Generated Python entrypoint failed syntax preflight before execution`，没有交付用户要求的 root cause、patch summary、pytest rerun、test result 或 remaining risks。
升级证据：browser 复验证据 `workspace/parallel/p3/.sciforge/evidence/p3-kernel-mmd-fresh-routing-syntax-preflight.png` / `.json`；任务 seed `workspace/parallel/p3/paper_metric_kernel.py`、`workspace/parallel/p3/test_kernel_mmd.py`；baseline `python -m pytest workspace/parallel/p3/test_kernel_mmd.py -q` 因缺失 `fastmmd` 失败。
通用性说明：任何代码调试/论文复现任务都可能生成语法错误的 execution entrypoint；syntax preflight fail-fast 是正确边界，但应触发 bounded repair/regeneration 或在有 side effects 时产生 coherent repair-needed/completion-candidate，而不是直接把内部生成错误作为终态主回复。该问题不依赖 MMD、P3、端口、provider、文件名或具体错误文本。
疑似边界：AgentServer / generated-task execution / repair loop / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P6-002 AgentServer JSON direct text was guarded instead of normalized

状态：done
发现者：P6
轻量证据：Browser `http://127.0.0.1:5673/`；fresh mini-grant run `project-literature-evidence-review-mp8v9o79-u3muni` / session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp8kqmtb-mp8v7xuf-3804nj`；debug `.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8kqmtb-mp8v7xuf-3804nj/debug/agentserver/2026-05-16T21-36-57-194Z-generation-9a823d3d.json` 中 `run.events[].result.finalText` 为 ToolPayload-like JSON，但 UI 主结果为 `needs-human` / `direct text looks like an unparsed ToolPayload or payload fragment`。
升级证据：同 session 下 artifacts `research-report.json` 与 `agentserver-direct-text-diagnostic-a458dd42a7.json`；后续 P6 最终复验 run `project-literature-evidence-review-mp993stc-fv00af` 为 `protocol-success; task=satisfied` / `resultPresentation.status=complete`，主回复没有 raw/diagnostic/verification 包装泄漏，并确认四个 research-package 文件当前约束一致。
通用性说明：任何 AgentServer 以 plain text channel 返回可解析 ToolPayload JSON、或 direct read-only answer 返回完整 artifact summary 时，gateway 应尽力 normalize 并按用户请求区分只读确认与 durable writeback，而不是把 artifact 变成诊断主结果或把未写盘回答冒充完成；不依赖 mini grant、literature 场景、端口或 provider。
疑似边界：gateway / AgentServer / Projection / ArtifactDelivery
修复结论（P6，2026-05-17）：payload validation 可把 verified text-only claims 绑定到 generated artifact refs；soft harness lightweight verification 默认可后台化；ResultPresentation/TaskOutcome 会用当前 complete presentation 重建旧 partial，并阻止 partial presentation 继承 satisfied；direct-context negated answer-only prompt `不要只回答` 会让位 backend；direct read-only answer 不能满足 durable writeback prompt；显式只读/不要重写 prompt 不再被误判为 writeback；workspace-relative artifact scoping 不会用旧 root copy 覆盖更新的 session-bundle 文件。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P6-001 Project deliverable artifacts should satisfy semantic expected types

状态：done
发现者：P6
轻量证据：Browser `http://127.0.0.1:5673/`；mini-grant run generated `project-brief.md`、`decision-log.md`、`risk-register.md`、`timeline-budget.md`，但 UI 继续修复 `Missing expected artifact types: paper-list, runtime-context-summary`，随后又因 markdown artifacts 未精确匹配 `research-report/evidence-matrix/notebook-timeline` 继续补跑。
升级证据：workspace bundle `.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8kqmtb-mp8v3f27-spqc9v/`；targeted tests `packages/presentation/interactive-views/index.test.ts`、`src/runtime/gateway/generated-task-runner-supplement-lifecycle.test.ts`、`src/runtime/gateway/direct-context-fast-path.test.ts`、`src/runtime/gateway/agentserver-stream.test.ts`、`src/runtime/conversation-policy/policy.test.ts` pass。
通用性说明：scenario default components are presentation hints, not hard artifact requirements for non-literature project deliverables; markdown files with stable ids such as `project-brief` and `risk-register` should count toward semantic artifact coverage.
疑似边界：capability / gateway / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P1-001 Provider metadata recovery was marked satisfied

状态：done
发现者：P1
轻量证据：Browser `http://127.0.0.1:5173/`；失败 run `project-literature-evidence-review-mp8tloty-oud91r` / session `session-literature-evidence-review-mp8tihhb-wtv54f` / task `generated-literature-6a700e26bab3`；用户可见现象为全文/PDF arXiv 调研请求被 `satisfied`，但主回复只说明 candidate provider metadata，verification 为 `unverified`，workspace artifact 含无关 Crossref metadata。
升级证据：修复后 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b`；Web UI 与 workspace Projection 均为 `repair-needed` / `protocol-failed; task=needs-work`，reload 后仍 recoverable。
通用性说明：任何 provider-first recovery adapter 只获得 metadata、无全文/PDF/引用验证证据时都不能关闭科研任务；问题不依赖 agentic RL、arXiv 日期、Crossref、端口或具体 prompt。
疑似边界：gateway / verification / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P2-001 Confounder robustness contradiction was marked satisfied

状态：done
发现者：P2
轻量证据：Browser `http://127.0.0.1:5273/`；首轮 run `project-biomedical-knowledge-graph-mp8tlixq-6f9o7q` / session bundle `workspace/parallel/p2/.sciforge/sessions/2026-05-16_workspace-biomedical-knowledge-graph--kras-g12d----mp8tirby_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tirby-mp8tj1w8-undhy3`；用户可见现象为数据分析任务投影 `satisfied` 且 `Verification: 未验证`，但 robustness markdown 中控制 batch 前后 drugA@48h 系数相同，解释却声称控制 batch 降低/修正效应。
升级证据：修复后真实 browser run `project-literature-evidence-review-mp8u8rr9-uf09xt` / session `workspace/parallel/p2/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tirby-mp8u1k3k-3y1sgc` 投影为 `protocol-success; task=needs-work` / `degraded-result`，主结果明确未验证不能算完成；selected artifact follow-up run `project-literature-evidence-review-mp8u9wmk-maz5si` 继续 partial/degraded。
通用性说明：任何统计、复现、robustness 或 sensitivity payload 只要数值比较与文字结论矛盾，都不能因有 artifact/脚本/图表而被判 completed；不依赖 P2 prompt、scenario、端口、文件名或 backend。
疑似边界：gateway / verification / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P2-002 Capability discovery brief exists but is not agent-callable

状态：done / original gap closed; superseded by UX-SYSTEM blocked-on-P1-P6-browser-validation
发现者：P2
轻量证据：P2 Browser `http://127.0.0.1:5273/`；session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis`；handoff `handoffs/2026-05-17T09-58-12-251Z-agentserver-generation-f4e6d72b00.json` 含 tiny `capabilityDiscovery` brief，但真实 data-analysis task 仍固定落到 `literature-evidence-review` / `agentserver.generate.literature`，没有 discovery search/expand/plan audit refs，也没有 discovery-based replan。Explorer-A 只读确认 `src/runtime/capability-discovery.ts` 有 service，`context-envelope` / `agentserver-generation-prompts` / generated task input 有 tiny brief，但没有 Gateway/tool handler 或 generated helper 函数让 AgentServer 调用 `capability_discovery.search/expand/plan/explain`。
升级证据：P2 复核（2026-05-17）确认原始 “brief exists but not callable” 缺口已被后续通用修复覆盖：generated task helper 支持 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)`，AgentServer stream 中的 `capability_discovery.*` tool-call 会被 Gateway 解析为受控 runtime call、emit `tool-result`、保持 `completionEvidence=not-evidence`，并在 session bundle 写入 sanitized `records/capability-discovery/*.json` audit record。验证 `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts src/ui/src/app/projectionApi.test.ts` 通过 39/39，`npm run typecheck` 通过。
通用性说明：任何普通聊天跨领域任务都会被告知 discovery 存在，但 backend 不能实际调用 discovery API 做能力检索/展开/规划时，系统仍会依赖旧 scenario/skill route；不依赖 P2、数据分析、端口或具体 CSV prompt。
结论：P2 原发现的 runtime invocation surface / generated helper / audit ref 缺口已关闭；backend result consumption 已由 bounded retry handoff 覆盖，最小 `ProjectionApi.getCapabilityPlanSummary` 也已能从 discovery tool-result 生成用户摘要，默认 Results UI 能力摘要卡片和 debug folding action boundary 已接线。仍未关闭的是更高层 `UX-SYSTEM-TASK-20260517-capability-discovery-api` 中记录的真实 P1-P6 browser 验收，不能用本 P2 task 再重复登记。
疑似边界：Capability Discovery / Gateway / AgentServer handoff / generated-task helper / audit refs / backend result consumption

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P2-003 Terminal repair-needed projection disappears after reload

状态：done
发现者：P2
轻量证据：P2 Browser `http://127.0.0.1:5273/`；session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis`；records `records/runs.json` 显示 run `run:task-card:f5u2f3` 为 `completed`，visible answer status `repair-needed`，diagnostic 为 generated Python `SyntaxError: invalid character '´'`；但 Browser reload 后右侧结果区仍显示 `主结果等待 ConversationProjection` / `当前 run 没有 ConversationProjection`，没有恢复 terminal repair-needed、SyntaxError 或下一步。
升级证据：P2 复验（2026-05-17）重新启动 P2 dev server 后用 Codex in-app Browser 打开 `http://127.0.0.1:5273/`，同一 session/run 已恢复为 answer-first `运行需要恢复` / `run:task-card:f5u2f3 · recoverable`，主区显示 generated Python failure diagnostic 和 `Repair runtime execution inputs, argv, sandbox, or output path and rerun.`；本地投影模型读取同一 `records/session.json` 得到 `projectionStatus=repair-needed`、`presentationKind=recoverable`、`projectionWaitAtTerminal=false`、`rawFallbackUsed=false`。结论：当前 restore/projection 路径已能显示 terminal repair-needed，不再等待缺失 Projection。
通用性说明：任何 failed/repair-needed terminal projection 如果 reload 后丢失，用户会误以为还在等待 projection 或无法判断失败原因；不依赖 P2 prompt、backend、provider 或具体 syntax error。
疑似边界：UI restore / Projection / persistence / answer-first results panel

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P2-004 Generated Python invalid Unicode syntax is not repaired before terminal failure

状态：done
发现者：P2
轻量证据：P2 Browser `http://127.0.0.1:5273/`；session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis`；task `generated-literature-2182f65faaaa` failed with `run_analysis.py` line 90 `df´l[col] = df_model[col].astype('category')`, Python `SyntaxError: invalid character '´' (U+00B4)`. No CSV/report/chart/script artifacts were completed; task correctly did not mark success, but failed after expensive AgentServer retries.
升级证据：通用修复在 `runGeneratedTaskExecutionLifecycle` 中新增 generated Python entrypoint syntax preflight：归档 taskFiles 之后、真实执行之前，用 Python `ast.parse` 只解析入口文件，不运行用户脚本；若解析失败，直接返回 `repair-needed` / `failed-with-reason` payload，带 `generated-task-python-syntax-preflight` blocker、task/input/output/stdout/stderr refs 和恢复动作。新增测试 `generated Python syntax preflight blocks invalid source before executing workspace side effects` 覆盖 `df´l` 类非法 Unicode 源码，并断言 side-effect marker 未执行。
通用性说明：Generated code can contain visually subtle Unicode confusables or invalid identifier characters across any Python task. Runtime should fail fast with syntax diagnostics and/or trigger bounded repair before long waiting, without prompt/file-name special cases.
疑似边界：AgentServer / generated-task execution / repair loop / gateway

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P4-002 Plain coding prose can be wrapped as satisfied without patch evidence

状态：done
发现者：P4
轻量证据：P4 sub-agent code review；`src/runtime/gateway/direct-answer-payload.ts` 的 plain text recovery can wrap ordinary backend prose as a ToolPayload with done/completed status, while coding prompts may lack `codeRef` / `diffRef` / `patchRefs` / `workEvidence`.
升级证据：targeted direct-answer smoke 证明 plain coding prose `I fixed... tests pass... PR ready` 在无 refs/文件路径/验证命令时落入 runtime diagnostic；同类文本若同时列出修改文件路径与验证命令，则仍可包装为 audited direct answer。当前 P4 browser run already failed instead of fake success, so this remains forward hardening rather than prompt-specific repair.
通用性说明：任何 coding/repair/PR-summary task that receives plain text like “fixed it” can be over-promoted unless completion requires durable patch/test evidence; not tied to P4 prompt, backend, or file names.
疑似边界：gateway / verification / ArtifactDelivery / Projection
修复结论（P4，2026-05-17）：plain direct-answer coding/reproduction completion guard 现在要求结构化 patch/test refs，或至少同时给出可识别修改文件路径和验证命令；`workspace` 这种泛词不再单独算 durable evidence。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P3-001 Direct-context answer remains partial when verification gate is unverified

状态：done
发现者：P3
轻量证据：Browser `http://127.0.0.1:5373/`；post-fix selected reproduction report follow-up run `project-literature-evidence-review-mp8w5b66-m62v5m` 直接回答 selected report 的 credibility/metrics/risk/next step，并投影为 `protocol-success` / `task=satisfied` / `resultPresentation.status=complete` / `visibleAnswer.status=satisfied`；verification 仍可见为 `unverified`，但 non-required visible marker 不再阻塞 direct-context satisfied。
升级证据：当前不保存额外 DOM；`workspace/parallel/p3/.sciforge/sessions/2026-05-16_workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8koxek-mp8tkh0o-tdin1l/records/session.json` 中 run `project-literature-evidence-review-mp8w5b66-m62v5m` 保存 response、task outcome projection、verification refs 与 complete result presentation；旧 run `project-literature-evidence-review-mp8unjqv-z81dk6` / `project-literature-evidence-review-mp8v8739-ktfrng` 保留了修复前的 partial/required-unverified 与 stale-presentation 对照。
通用性说明：任何 selected artifact/direct-context answer 即使内容正确，也可能因缺少合适的 lightweight verifier 被 Projection 降为 partial；这不是 P3 prompt 或 Logistic report 特例。
疑似边界：verification / Projection / direct-context answer policy
修复结论（P3/P4，2026-05-17）：Agent Harness 对 direct-context read-only answer 的 lightweight verification policy 改为“可见但非 required”，除非用户显式要求 required verifier / human approval / release gate、选择 verifier/action 或触发 high-risk；Projection 只在 `diagnostics.required === true` 的 unverified verdict 下阻塞 task success，普通 visible unverified 不再降级 direct-context 满足型回答；ResultPresentation 在 projection 重算为 satisfied 时会重建 runtime 生成的旧 needs-work/partial presentation，避免 timeline 与右侧结果面板口径不一致。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P3-002 Selected report fallback direct-context stayed partial and stale-focused

状态：done
发现者：P3
轻量证据：Browser `http://127.0.0.1:5373/`；旧 runs `project-literature-evidence-review-mp8x2i3v-czzbd5`、`project-literature-evidence-review-mp8x962l-dlt3li`、`project-literature-evidence-review-mp8xq79k-ijnap6` 显示 selected report follow-up 内容被旧 summary 污染或被 required verification 包成 partial；修复后 run `project-literature-evidence-review-mp8y1gwb-znebcn` 为 `protocol-success; task=satisfied`，主回复只给 `Random seed: 42` 与 optimizer，右侧结果视图不再显示“只得到部分结果”。
升级证据：workspace `workspace/parallel/p3/.sciforge/workspace-state.json` 中同 session latest run `project-literature-evidence-review-mp8y1gwb-znebcn` 记录 `verification.nonBlocking=true`、`diagnostics.required=false`、`resultPresentation.status=complete`、`visibleAnswer.status=satisfied`；旧 partial runs 保留 required-unverified 对照。
通用性说明：任何 fallback direct-context payload 只要缺少 request-side direct-context hints，都可能被 harness required verification 阻塞；任何 selected artifact factual follow-up 都可能遇到 flattened browser text 字段过捕获或旧 partial focus 恢复，不依赖 P3、Logistic report、端口或具体 prompt。
疑似边界：direct-context / verification / Projection / UI restore
修复结论（P3，2026-05-17）：runtime verification contract 从 payload 自身识别 `sciforge.direct-context-fast-path`，只读 direct-context answer 在无显式 verifier/human/release/high-risk 时 non-blocking；selected report field extraction 支持 flattened browser text；PASS/FAIL/counterfactual/literal fact 分支优先于 generic credibility summary；UI recoverable focus 跳过同 session 已被 newer satisfied run supersede 的旧 partial。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P4-003 Workspace file API needs active-workspace containment for write actions

状态：done
发现者：P4
轻量证据：P4 sub-agent code review；`src/runtime/server/workspace-file-api.ts` write/action routes resolve submitted paths directly, while coding-agent evidence depends on writes being inside the active workspace and auditable.
升级证据：targeted API smoke 使用临时 workspace 与 workspace 外临时目录验证：POST write 的绝对路径逃逸和 `..` 相对逃逸均返回 400；rename 到 workspace 外返回 400 且源文件保留；delete workspace 外文件返回 400 且外部文件内容保留。Browser `http://127.0.0.1:5473/` reload 后 SciForge shell、workspace file tree 与旧 P4 recoverable run 正常加载，console error 为 0。
通用性说明：Any workspace write/delete/rename route can affect trust in generated patch/artifact evidence if path containment is not enforced; not specific to SciForge self-improvement prompt.
疑似边界：workspace / gateway / persistence
修复结论（P4，2026-05-17）：`/api/sciforge/workspace/file` POST 与 `/api/sciforge/workspace/file-action` mutation 现在统一通过 active workspace root 解析 path/targetPath；UI workspace client 显式传 `workspacePath`，无 prompt/backend/端口/文件名特例。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P5-004 Generated-task syntax failure can remain as failed projection despite supplemental artifacts

状态：todo
发现者：P5
轻量证据：Browser `http://127.0.0.1:5573/`；clean P5 microbiome run in session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8y1pdp-7ymg7a` first task `generated-literature-99177170665d` failed with Python `SyntaxError: '(' was never closed`; supplemental task `generated-literature-1b4e7268e935` wrote `research-report.md` / `evidence-matrix.md` / `notebook-timeline.md`, but user-visible Projection stayed `protocol-failed; task=needs-work` and foregrounded the syntax failure.
升级证据：same session `records/task-attempts/generated-literature-99177170665d.json` and `task-results/generated-literature-1b4e7268e935.json`; later clean rerun `generated-literature-1a48fa75c4cf` succeeded, so this did not block the P5 milestone.
通用性说明：Any generated task can fail before writing its intended ToolPayload, while a supplement/recovery task may create useful artifacts; Projection should either clearly promote the repaired attempt or expose a single coherent repair-needed state, not mix failed primary and useful artifacts in an ambiguous terminal result.
疑似边界：generated-task execution / supplement lifecycle / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要的 browser 复验证据
- [ ] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P5-003 Read-only protocol budget follow-up routed to AgentServer instead of direct context

状态：done
发现者：P5
轻量证据：Browser `http://127.0.0.1:5573/`；after successful microbiome protocol artifact, reload follow-up “如果预算降到 72 libraries...” was treated as artifact mutation and dispatched to AgentServer, then produced no terminal backend events until manual interrupt/retry.
升级证据：post-fix clean Browser follow-up in session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8y5b23-boyhh6` answered directly from the current artifact: keep 36 patients, reduce from 3 to 2 timepoints, drop week 4, `36 × 2 = 72 libraries`, no AgentServer dispatch, no ContractValidationFailure, no `week 0`.
通用性说明：Any bounded “how should this artifact change under a hypothetical constraint?” question is read-only unless it asks to write/persist a new artifact; routing it to backend causes latency/stalls and stale context risk.
疑似边界：direct-context / runtime routing / AgentServer / UI reload
修复结论（P5，2026-05-17）：`direct-context-fast-path` recognizes read-only artifact revision questions, adds a protocol/library-budget adaptation branch, and normalizes `week 0` to baseline so baseline is not double-counted.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P5-002 Artifact delivery and evidence refs lost the durable protocol result

状态：done
发现者：P5
轻量证据：Browser `http://127.0.0.1:5573/`；early P5 microbiome success run `generated-literature-715f5276c957` wrote a full protocol markdown and evidence matrix, but readable/data refs could point to a short inline summary instead of the file-backed markdown, and verified claims with evidence prose could lack durable evidence refs.
升级证据：targeted tests added for file-backed markdown preference and verified-claim evidence ref binding; Browser post-fix run `generated-literature-1a48fa75c4cf` exposes protocol checklist/evidence matrix files directly in task-results and keeps `task=needs-work` under unverified requirements.
通用性说明：Any backend task that returns both inline summaries and file-backed artifacts can lose the primary deliverable if materialization prefers inline text; any verified claim without refs weakens WorkEvidence and follow-up grounding.
疑似边界：ArtifactDelivery / payload validation / Projection
修复结论（P5，2026-05-17）：Artifact materialization now prefers existing target-format file-backed readable refs, normalized payloads preserve object references, verified claims can inherit durable context/artifact refs, and blocker/needs-work findings prevent accidental satisfied projection.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

### DISC-20260517-P5-001 AgentServer repair can write outside generated-task boundary

状态：done
发现者：P5
轻量证据：Browser `http://127.0.0.1:5573/`；post-fix fresh run `project-literature-evidence-review-mp8uucnz-05uan0` 对 required-verification methodology artifact 请求没有再假成功，而是显示 `protocol-failed; task=needs-work` / `repair-needed`；failure reason 为 `Repair boundary rejected AgentServer repair because it changed repo source/config files outside the generated task boundary: .sciforge/task-results/generated-literature-7cf206f66041-attempt-2.json`。
升级证据：targeted smoke `smoke-repair-boundary-output-allowlist` 验证 `.sciforge/task-results/*` 与 session bundle `task-results/*` 会进入 repair-boundary allowedPaths，而 `PROJECT.md` 与 `src/runtime/gateway/generated-task-runner.ts` 仍进入 blockedPaths；`smoke-repair-boundary-guard` 通过真实 repair rerun 验证 task-result output 可 allowed、`PROJECT.md` 仍 blocked；P4 Browser `http://127.0.0.1:5473/` reload 后 SciForge shell/workspace tree 正常，console error 为 0；P5 Browser `http://127.0.0.1:5573/` 复核未再出现 `.sciforge/task-results/... outside the generated task boundary` 误报，后端长跑未收敛已安全中断，不作为成功证据。
通用性说明：任何 AgentServer generated-task repair 如果把 task-result JSON 或 repo/source/config 路径判为越界，都可能导致 recoverable run 无法产出用户 artifact；这不是 P5 prompt、compound 名称、端口或 browser 状态特例。
疑似边界：AgentServer / repair-boundary / generated-task output containment
修复结论（P4 接手，2026-05-17）：repair-boundary source-edit guard 现在区分 generated-task 输出目录与源码/配置；top-level 和 session-bundle 的 artifacts/task-results/logs/data/exports 可作为 repair 输出 evidence，源码与 PROJECT/config 仍受保护。

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要的 browser 复验证据
- [x] 更新对应任务打勾状态和 Activity Log

## 工作记录与证据策略

默认策略：worker 像真实用户一样直接在 Web UI 和 workspace 中查证据，不为每轮维护第二份 evidence。`PROJECT.md` 只记录任务管理和交接所需的结论级信息。

轻量记录，每个自主探索 milestone 至少写：

- [ ] owner / 进程 / URL 或 workspace。
- [ ] 用户目标和 hard requirements。
- [ ] 当前结论：`TaskSuccess`、`AnswerQuality`、success/failure reason。
- [ ] 关键 run/session/artifact 或 workspace 路径，仅记录足够后续找到上下文的信息。
- [ ] root boundary 或下一步假设。

升级记录，仅在以下情况保存 DOM/screenshot/console/network/timing/manifest：

- [ ] 出现失败、假成功或用户可见体验异常，需要交给 sub agents 复现。
- [ ] 修复前后需要对比。
- [ ] Web UI 与 workspace 产物、records 或 artifacts 不一致。
- [ ] milestone 准备提交/同步前，需要留下简短验收凭据。
- [ ] 问题涉及性能、stall、console error、network failure 或 reload/restore。

质量口径：

- `AnswerQuality=accurate`：具体回答当前问题，正确使用证据/selected refs/provider/tool/artifact，能被 DOM/record/artifact 检查。
- `AnswerQuality=partial`：有有用部分但缺关键结论、证据或交付物。
- `AnswerQuality=diagnostic-only`：只解释系统状态、refs、错误或 recover action，没有完成用户任务。
- `AnswerQuality=fake-success`：网页主回复有完整段落或看似有报告，但没有完成用户 hard requirements，例如未搜索当天来源、未下载/阅读全文、未运行代码、未生成要求的 artifact、未验证结论或只写“未验证”。`fake-success` 必须对应 `TaskSuccess=false`。
- `AnswerQuality=failed`：答非所问、空泛、不可读 ref、failed/repair-needed 污染主结果或 raw leak。

速度目标：

- `T_first_progress <= 3s`。
- `T_first_backend_event <= 15s`；超过必须有 visible waiting reason。
- 普通 fresh/continue `T_terminal_projection <= 60s`。
- provider/tool/repair `T_terminal_projection <= 120s`。
- terminal 时 `ProjectionWaitAtTerminal=0`。

## 验证命令

常用：

```bash
npm run typecheck
npm run smoke:single-agent-runtime-contract
npm run smoke:no-legacy-paths
npm run smoke:web-final-conformance
```

Milestone 完成门：

```bash
npm run verify:single-agent-final
```

Browser 验证必须使用 Codex in-app browser，不用普通 terminal smoke 替代。

## Activity Log

- 2026-05-17 - P3 - 完成 `P3-TASK-20260517-dependency-aware-metric-debug` strict-eval/fix/browser-recheck：真实 Browser 在 `http://127.0.0.1:5373/` 要求调试 `paper_metric_kernel.py` / `test_kernel_mmd.py`、处理缺失 `fastmmd` 与 MMD denominator bug、修改并复跑 pytest。首轮 run `project-literature-evidence-review-mp9p2jgz-zoej21` 被 stale repair continuity / scenario artifact defaults 污染并触发 convergence guard；通用修复要求 repair continuity 必须有具体 failed/recover target，fresh code debug/execution prompt 不再继承 scenario default expected artifacts / component ids，也不再附带 stale prior attempts，并让 malformed AgentServerGenerationResponse failure diagnostics 保留 workspace side-effect evidence。最终复验 run `project-literature-evidence-review-mp9pzl5a-e56fsc` handoff 已为 `expectedArtifactTypes=[]`、`selectedComponentIds=[]`、`priorAttemptCount=0`、`harnessSummary.intentMode=fresh`；严格仍 `TaskSuccess=false`，因为 generated Python syntax preflight 失败后没有 bounded repair/regeneration 或用户可核查主回复，登记为 `DISC-20260517-P3-005`。证据：`workspace/parallel/p3/.sciforge/evidence/p3-kernel-mmd-convergence-failure.png` / `.json`、`workspace/parallel/p3/.sciforge/evidence/p3-kernel-mmd-fresh-routing-syntax-preflight.png` / `.json`。验证：`node --import tsx --test src/runtime/gateway/agent-harness-continuity-decision.test.ts src/runtime/gateway/gateway-request.test.ts src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agent-harness-shadow.test.ts` 29/29 通过；P3 seed `python -m pytest workspace/parallel/p3/test_kernel_mmd.py -q` 当前按设计暴露 `fastmmd` blocker。
- 2026-05-17 - P4 - 收口 `UX-SYSTEM-TASK-20260517-universal-chat-entry` 的 P4 默认 shell blocker：顶部导航由 `场景工作台` 改为 `聊天工作台`，顶部 runtime badge 改为 `SciForge · ready`，搜索框去掉 `Execution Unit`，workbench 折叠标题改为 `SciForge 工作台`，聊天头部改为 `Ask SciForge` / `当前上下文`，assistant message meta 改为 `SciForge`；场景配置仍保留在展开后的高级 workbench chrome。Browser 复验 `http://127.0.0.1:5473/`：title `SciForge`、console error 0、默认 DOM 命中 `Ask SciForge` / `聊天工作台` / `SciForge · ready`，未命中 `Scenario Runtime` / `Execution Unit` / `文献证据评估场景` / `ToolPayload` / `stdout` / `stderr` / `raw payload`。验证：`node --import tsx --test src/ui/src/app/ChatPanel.test.ts src/ui/src/app/appShell/navigation.test.ts` 11/11、`npm run typecheck` 通过。剩余：P1-P6 跨领域 browser 验收仍需继续，不能只因 P4 shell smoke 判 Universal Chat Gate 全绿。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：默认结果区审计摘要不再把 `raw payload` 等执行层术语写入折叠 DOM，改为用户可读“结构化审计材料”；ResultsRenderer 回归测试新增默认渲染不出现 `raw payload` / `ToolPayload` / `stdout` / `stderr` / `task attempts` / `handoff JSON` 的断言。验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 45/45 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`。剩余：完整 ProjectionApi-only UI 迁移和 completion-candidate import/verify-confirm transaction 尚未闭环。
- 2026-05-17 - P4 - P4 收口共享 UI test 阻塞并复验：将新增 object reference selection action 测试改用现有 `testConfig()` fixture，恢复 `ResultsRenderer` suite；同时补 P4 Codex in-app browser smoke，`http://127.0.0.1:5473/` title `SciForge`、console error 0、default DOM raw term matches `[]`。但首屏仍显示 `Scenario Runtime` / `文献证据评估场景`，因此 Universal Chat Gate 继续 open。验证：`node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts packages/contracts/runtime/work-evidence.test.ts` 13/13、`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 45/45、`npm run typecheck` 通过。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：结果区 object reference 的 `focus-right-pane` / `inspect` / `pin` / `compare` 选择类动作现在先通过 `UserActionApi.selectObject` 记录 typed `select-object` action，再执行本地聚焦、检查、固定或对比；`copy-path` / `open-external` / `reveal-in-folder` 仍保持系统动作路径，不伪装成 selected-object。验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 45/45 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`。剩余：完整 ProjectionApi-only UI 迁移和 completion-candidate import/verify-confirm transaction 尚未闭环。

- 2026-05-17 - P3 - 关闭 `DISC-20260517-P3-004`：在前序 workspace side-effect snapshot 修复基础上，P3 Browser 重新提交 weighted AUC debug 请求，run `project-literature-evidence-review-mp9o7cqm-4kn9ko` 仍严格 `TaskSuccess=false`（主回复未交付 root cause/patch/pytest rerun），但暴露 AgentServer 写入事件只有 `label/detail` 文本、缺少结构化 `path` 时仍会漏掉 WorkEvidence。通用修复扩展 `work-evidence-adapter`：从 textual backend write event（如 `写入完成：/workspace/file.py`）提取常见 workspace 文件路径，归一化为 `WorkEvidence(kind=write,status=success)`，并继续只作为 unverified repair/completion-candidate evidence，不标 satisfied；不绑定 weighted AUC、P3、端口、文件名或错误文本。证据：`workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-textual-write-event-recheck.png` / `.json`。验证：`node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts packages/contracts/runtime/work-evidence.test.ts` 26/26 通过；`python -m pytest workspace/parallel/p3/test_weighted_survival_auc.py -q` 2/2 通过；P4 已修复共享 UI test fixture 后 `npm run typecheck` 通过。
- 2026-05-17 - capability_discovery owner - 收口 `UX-SYSTEM-TASK-20260517-capability-discovery-api` debug folding：`UserActionApi.openDebugAudit` 现在会把 `CapabilityPlanSummary` 的 safe discovery refs 合并进语义调试动作，并过滤 endpoint/token/workspace-root；默认 Results UI 能力计划卡的“能力发现记录”折叠区打开时也走 `requestOpenDebugAuditThroughUserActionApi`，避免静态 debug refs 绕过 action boundary。Browser smoke `http://127.0.0.1:5573/`：title `SciForge`，console 无 error，默认 audit details 未展开，页面未命中 `127.0.0.1` / `token=` / `Applications/workspace` / `ToolPayload` / `stdout` / `stderr`；证据 `workspace/parallel/capability_discovery/.sciforge/evidence/capability-discovery-debug-folding-browser.png` 和 `.json`。验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/runtime/gateway/agentserver-workspace-side-effects.test.ts` 61/61、`npm run typecheck` 通过。剩余：真实 P1-P6 browser 验收。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：ResultsRenderer 的运行细节展开已从直接 `createOpenDebugAuditUIAction` creator 迁到 `requestOpenDebugAuditThroughUserActionApi`，点击/展开时先调用 `UserActionApi.openDebugAudit`，再把返回的 typed `open-debug-audit` action 交给 workbench 记录；conformance test 改为要求 ResultsRenderer 走 UserActionApi helper。验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 43/43 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`。剩余：完整 ProjectionApi-only UI 迁移和 completion-candidate import/verify-confirm transaction 尚未闭环。
- 2026-05-17 - P3/P4 - 推进 `DISC-20260517-P3-004`：AgentServer generation dispatch 现在在 stream 请求前后采集 workspace side-effect snapshot，并把已有文件修改 / 新文件创建转成 bounded `WorkEvidence(kind=write)`，合并进 failure recovery、direct payload salvage 和 request-failure diagnostics；`.sciforge`、`node_modules` 等内部目录不进入用户证据。验证：`node --import tsx --test src/runtime/gateway/agentserver-workspace-side-effects.test.ts` 1/1、`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts` 58/58、`npm run typecheck` 通过。剩余：P3 weighted AUC 真实 browser 复验仍未补，故 `DISC-20260517-P3-004` 保持 in_progress。
- 2026-05-17 - P3 - 完成 `P3-TASK-20260517-weighted-survival-auc-debug` strict-eval/fix/browser-recheck：真实 Browser 在 `http://127.0.0.1:5373/` 要求调试 `weighted_survival_auc.py` / `test_weighted_survival_auc.py`、先跑 pytest、定位 IPCW pair weight / tie-credit bug、修改并复跑。首轮 run `project-literature-evidence-review-mp9n4v5g-7dgp5u` / `project-literature-evidence-review-mp9n8dw6-1zh8j9` 被 `local-reproducible-method-runtime` 用旧 `fixed_inverse_square_decay.py` refs 假成功短路；通用修复改为 fresh code debug/execution 意图守卫，不绑定 P3、端口、run id、文件名或论文题目，并补“`fixed_*.py` 文件名仍可导出”的反回归。复验 run `project-literature-evidence-review-mp9nc705-mhop0i` 不再 stale-export，转为 AgentServer convergence guard 后 recoverable；严格 `TaskSuccess=false`，因为主回复仍未交付 root cause/patch/pytest rerun。剩余 existing-file patch side effect 未投影为 completion-candidate 登记为 `DISC-20260517-P3-004`；证据 `workspace/parallel/p3/.sciforge/evidence/p3-weighted-auc-code-debug-after-runtime-guard.png`。验证：`node --import tsx --test src/runtime/local-reproducible-method-runtime.test.ts` 5/5、`python -m pytest workspace/parallel/p3/test_weighted_survival_auc.py -q` 2/2、`npm run typecheck` 通过。
- 2026-05-17 - P4 - 继续 SciForge self-improvement coding 边界收口：`local-reproducible-method-runtime` 只应复用已有 script/dataset artifact 导出复现方法，不能在用户明确要求 debug/fix/patch/read code/pytest/run tests 时用旧 artifact refs 直接“成功”短路真实代码修复任务。新增 fresh code debugging guard 和回归测试，覆盖 stale script ref 存在时仍返回 `undefined`，让请求继续进入正常 coding/execution 路径，且带输入前缀噪声时仍不被短路。验证：`node --import tsx --test src/runtime/local-reproducible-method-runtime.test.ts` 5/5 通过；P4 in-app browser smoke 打开 `http://127.0.0.1:5473/`，title `SciForge`，console error 0，默认 DOM 未命中 `Invalid capability manifest registry` / `可复现执行单元` / `ToolPayload` / `stdout` / `stderr` / `raw payload` / `execution-unit`。剩余：该 smoke 不是完整端到端 coding TaskSuccess，后续真实 self-improvement coding milestone 仍需从用户 hard requirements 逐条验收。
- 2026-05-17 - capability_discovery owner - 继续 `UX-SYSTEM-TASK-20260517-capability-discovery-api`：AgentServer stream-side `capability_discovery.*` tool-result 现在除 sanitized audit record 外，还会在 session bundle `ledger/events.jsonl` append `sciforge.workspace-ledger-event.v1` not-evidence decision event；tool-result `auditRefs` 同步带 ledger ref，且测试验证 ledger event 不泄漏 endpoint/token/workspace root。默认 Results UI 现在展示 `CapabilityPlanSummary` 能力计划卡，只显示安全 discovery refs，并保留“能力发现本身不是任务完成证据”的边界。后续 debug folding action boundary 已补齐；剩余真实 P1-P6 browser 验收。验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts` 58/58、`npm run typecheck` 通过。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：`WorkspaceObjectPreview` 不再在组件内直接调用 `readWorkspaceFile` / `readPreviewDescriptor` / `readPreviewDerivative`，而是通过可替换 `ArtifactPreviewHydrationApi` adapter 做 workspace preview hydration；测试断言组件源码不再直接调用 workspace read/descriptor/derivative 函数。验证：`node --import tsx --test src/ui/src/app/results/WorkspaceObjectPreview.test.ts` 7/7 通过。剩余：默认 hydration adapter 仍访问 workspace preview client，完整 ProjectionApi-only UI 迁移和 import/verify-confirm transaction 尚未闭环。
- 2026-05-17 - P4 - 继续 discovery/UI decoupling 收口：默认 ResultsRenderer 已接入 `CapabilityPlanSummary` 能力计划卡，并复用 `capabilityPlanSummaryForSession`，展示 discovery plan summary 与 safe debug refs，同时过滤 endpoint/token/workspace-root。后续 debug folding action boundary 已补齐；剩余真实 P1-P6 browser 验收。验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts` 39/39 通过；`npm run typecheck` 通过。
- 2026-05-17 - P4 - 继续 discovery/UI decoupling 收口：`ProjectionApi.getCapabilityPlanSummary` 现在可从 run raw / context envelope / metadata 中的 `capabilityDiscoveryToolResults` 读取 discovery search/plan tool-result，生成普通用户可读能力摘要，明确“能力发现本身不是任务完成证据”，并只保留 safe capability/discovery debug refs，过滤 endpoint/token/workspace-root 类泄漏。后续默认 ResultsRenderer 已展示 `CapabilityPlanSummary` 且 debug folding action boundary 已补齐；剩余真实 browser 验收仍未闭环。验证：`node --import tsx --test src/ui/src/app/projectionApi.test.ts` 7/7 通过；`npm run typecheck` 通过。
- 2026-05-17 - P3/P4 - 继续 code-debug side-effect salvage：AgentServer generation dispatch 新增 bounded workspace side-effect snapshot，失败/HTTP error/run failure/direct payload/plain text 路径都会合并 stream WorkEvidence 与 workspace diff WorkEvidence，捕获 existing-file patch / created-file 变化并作为 unverified repair evidence；该证据不标 satisfied。验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts packages/contracts/runtime/work-evidence.test.ts` 24/24 通过；`npm run typecheck` 通过。剩余：P3 weighted-AUC browser recheck 尚未补做，`DISC-20260517-P3-004` 保持 browser-recheck-pending。
- 2026-05-17 - capability_discovery owner - 继续 `UX-SYSTEM-TASK-20260517-capability-discovery-api` / `discovery-progressive-disclosure`：补齐 AgentServer discovery result consumption 的最小闭环。`readAgentServerRunStream` 收到 `capability_discovery.search|expand|plan|explain` tool-call 后仍由 Gateway 执行 discovery、emit `tool-result`、写 session-bundle sanitized audit record；若当前单向 stream 没有终态结果，`agentserver-generation-dispatch` 会 retry 一次，并把 compact `capabilityDiscoveryToolResults` 放入 context envelope、generation request、input/runtime metadata，供 backend 在第二次请求继续推理。该桥不声称支持同一 HTTP stream 内真正双向 tool response，且 discovery result 仍标记 `completionEvidence=not-evidence`。后续默认 Results UI `CapabilityPlanSummary` 卡片与 debug folding action boundary 已补齐；剩余真实 P1-P6 browser 验收。验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts` 6/6；`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts` 19/19；`npm run typecheck` 通过。
- 2026-05-17 - P3 - 关闭 `DISC-20260517-P3-003`：为 AgentServer generation failure 增加通用 side-effect completion-candidate salvage。Backend stream 的 `write_file` / wrote / patched / saved 等事件会归一化为 `WorkEvidence(kind=write)`；失败 diagnostics 保留 bounded side-effect evidence，failure lifecycle 将 workspace 内合法候选文件转成 `displayIntent.completionCandidate`、supporting-evidence ArtifactDelivery 和 object refs，状态保持 `unverified/repair-needed`，不标 satisfied 且不泄漏绝对 workspace root。Browser 复验 `http://127.0.0.1:5373/` 显示 `run-p3-candidate-browser · recoverable`、`completion-candidate`、候选 `fixed_inverse_square_decay.py` 与导入/验证恢复动作；证据 `workspace/parallel/p3/.sciforge/evidence/p3-completion-candidate-browser.png`。验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts packages/contracts/runtime/work-evidence.test.ts` 18/18 通过；`npm run typecheck` 通过。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：`UserActionApi` 新增 `triggerRecover` 和 `cancelRun`，与已有 `approveResult` 一起形成 recover / approval / cancel 的语义动作闭环；每个 action result 都返回 canonical projection，并从 projection audit refs 取恢复证据，测试断言不渲染 raw AgentServer text。验证：`node --import tsx --test src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts` 16/16 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`。剩余：ResultsRenderer recover buttons 仍需迁到 async `UserActionApi.triggerRecover` flow，workspace preview hydration 仍需从组件内 workspace read 继续下沉。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：ResultsRenderer 的 recover buttons 已从直接 `createTriggerRecoverUIAction` creator 迁到 `requestRecoverActionThroughUserActionApi`，点击时先调用 `UserActionApi.triggerRecover`，再把返回的 typed `trigger-recover` action 交给 workbench 记录和填入草稿；conformance test 改为要求 ResultsRenderer 走 UserActionApi helper。验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts` 41/41 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`，页面存在 recover button 样本 `Retry after provider recovery...`。剩余：workspace preview hydration 仍需从组件内 workspace read 继续下沉，completion-candidate import/verify-confirm transaction 仍未闭环。
- 2026-05-17 - UI-Execution Decoupling Owner - 继续 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`：补齐最小 `ProjectionSubscriptionApi` 本地 contract，订阅事件只发布 canonical `ConversationProjectionView` / `RunSummary`，不暴露 raw AgentServer text；`UserActionApi.loadArtifactPreview` 现在返回带 typed `load-artifact-preview` 的 `ArtifactPreview.sourceAction`；`WorkspaceObjectPreview` 的大文件“加载预览”先提交 `UserActionApi.loadArtifactPreview`，再进入现有 workspace preview hydration。验证：`node --import tsx --test src/ui/src/app/projectionApi.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts src/ui/src/app/uiActionBoundary.test.ts` 15/15 通过；`npm run typecheck` 通过；Codex in-app browser 仍 `Transport closed`，隔离 Playwright 打开 `http://127.0.0.1:5173/` 得到 title `SciForge`、console error 0、default DOM raw term matches `[]`。状态仍为 partial foundation：workspace preview hydration、retry/recover/import-verify-confirm 和全 UI ProjectionApi 迁移未完成。

- 2026-05-17 - P2 - 收口 `P2-TASK-20260517-universal-data-chat-discovery` 同步口径：该 milestone 仍保持真实用户任务 `TaskSuccess=false`，因为 messy assay CSV 分析包没有实际完成；但 P2 原始 root blockers 已完成通用关闭。`DISC-20260517-P2-002` 的 generated-task helper / AgentServer stream-side invocation surface 已补齐，且 dispatch 在 stream 只产出 discovery tool-call、没有终态结果时会 bounded retry，把 compact `capabilityDiscoveryToolResults` 放进第二次 backend 请求供消费；`ProjectionApi.getCapabilityPlanSummary` 已能从 discovery tool-result 生成最小用户摘要，默认 Results UI 能力摘要卡片已接线；`DISC-20260517-P2-003` reload 后 terminal `repair-needed` 可恢复；`DISC-20260517-P2-004` generated Python syntax preflight 已在真实执行前拦截非法 Unicode/语法错误。后续 debug folding action boundary 已补齐；通用聊天入口和 answer-first polish 仍归入 UX-SYSTEM 主线。验证：`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts src/ui/src/app/projectionApi.test.ts` 通过 47/47；`npm run typecheck` 通过。
- 2026-05-17 - P2 - 收口 `DISC-20260517-P2-002`：原始发现 “capability_discovery 只有 tiny brief / service，缺 agent-callable runtime invocation surface” 已由后续通用修复关闭。当前 generated-task helper 可通过 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)` 调用 discovery；AgentServer stream 的 `capability_discovery.*` tool-call 会由 Gateway 调用 `CapabilityDiscoveryService`，emit `tool-result`，写入 sanitized `records/capability-discovery/*.json` audit record，并保持 `completionEvidence=not-evidence`。验证 `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts src/ui/src/app/projectionApi.test.ts` 通过 39/39；`npm run typecheck` 通过。后续 ledger replay refs、默认 Results UI 能力摘要卡片与 debug folding action boundary 已补齐；browser 验收不再作为 P2-002 重复跟踪，归入 UX-SYSTEM `blocked-on-P1-P6-browser-validation` 主线。
- 2026-05-17 - capability_discovery owner - 继续 `UX-SYSTEM-TASK-20260517-capability-discovery-api` / `discovery-progressive-disclosure`：新增 `src/runtime/gateway/capability-discovery-tool-transport.ts`，`readAgentServerRunStream` 现在会把 AgentServer stream 中的 `capability_discovery.search|expand|plan|explain` tool-call 解析为受控 runtime call，调用 `CapabilityDiscoveryService` 后 emit `tool-result`，保持 `completionEvidence=not-evidence`，并在 session bundle `records/capability-discovery/*.json` 写入 sanitized audit record；AgentServer dispatch payload metadata 同步暴露极简 tool transport brief，不注入完整 registry/schema/provider endpoint。后续 bounded retry consumption、ledger replay refs、默认 `CapabilityPlanSummary` UI 卡片与 debug folding action boundary 已补齐；剩余 blocker 为真实 browser 验收。验证：`node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts` 9/9，`node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 25/25，`npm run typecheck` 通过。
- 2026-05-17 - P4 - 推进 `capability_discovery` AgentServer stream bridge：新增 `src/runtime/gateway/capability-discovery-tool-transport.ts`，Gateway 可解析 AgentServer stream 中 `capability_discovery.search|expand|plan|explain` tool-call，调用 runtime discovery service，emit `completionEvidence=not-evidence` 的 `tool-result` workspace event，并把 query/result/error 写入 session-bundle sanitized audit record；handoff/runtime metadata 同步暴露 stream tool transport brief。后续已补 bounded retry consumption；同一 HTTP stream 内真正双向 tool response 仍不作为本 milestone 要求。Browser smoke：P4 `http://127.0.0.1:5473/` 页面加载成功，console error 为 0，默认 result details 全部 closed，页面正文未命中 `Invalid capability manifest registry` / `可复现执行单元` / `ToolPayload` / `stdout` / `stderr` / `raw payload` / `execution-unit`。验证：`node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts` 9/9 通过，`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 12/12 通过，`node --import tsx --test src/ui/src/app/chat/RunExecutionProcess.test.ts src/ui/src/app/results-renderer-execution-model.test.ts` 30/30 通过，`npm run typecheck` 通过。
- 2026-05-17 - P2 - 继续 `P2-TASK-20260517-universal-data-chat-discovery` 后续修复：复验 `DISC-20260517-P2-003`，P2 Browser `http://127.0.0.1:5273/` 重新加载旧 session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis` 后右侧结果区已显示 `运行需要恢复` / `run:task-card:f5u2f3 · recoverable`，不再停在 `主结果等待 ConversationProjection`；同一 records 本地投影为 `projectionStatus=repair-needed`、`projectionWaitAtTerminal=false`、`rawFallbackUsed=false`。同时关闭 `DISC-20260517-P2-004`：在 generated-task execution lifecycle 增加 Python entrypoint syntax preflight，taskFiles 归档后、真正执行前用 `ast.parse` 检查入口文件，非法 Unicode/语法错误会变成 `generated-task-python-syntax-preflight` repair-needed payload，而不会运行用户脚本或进入昂贵执行失败。验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 12/12 通过；`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/task-attempt-history.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/projectionApi.test.ts` 49/49 通过；`npm run typecheck` 通过。
- 2026-05-17 - P3 - 完成 `P3-TASK-20260517-buggy-paper-code-repair-loop` strict-eval/fix/browser-recheck：真实 Browser 在 `http://127.0.0.1:5373/` 要求调试 `buggy_inverse_square_decay.py`，首轮重启后读到 bug、跑出原始失败 `RMSE 6.6277`、写出 `fixed_inverse_square_decay.py`，但 AgentServer stream 消耗 650k+ tokens 仍无 terminal Projection，严格判 `TaskSuccess=false`。通用修复恢复 harness-aware generation token guard；复验 run `project-literature-evidence-review-mp9ltnn6-nu2nse` 在 214,465 tokens 触发 guard（limit 180,000）并投影为 `protocol-failed; task=needs-work` / `运行需要恢复`，不再永久等待 ConversationProjection。目标测试 `node --import tsx --test src/runtime/gateway/agentserver-stream.test.ts` 通过 6/6；剩余 completion-candidate salvage 缺口登记为 `DISC-20260517-P3-003`。
- 2026-05-17 - P4 - 完成 `P4-TASK-20260517-universal-chat-coding-discovery`：真实 Browser 在 `http://127.0.0.1:5473/` 不打开 Scenario Builder 提交 SciForge self-improvement coding/UX 任务，首轮严格判 `TaskSuccess=false`，因为页面报 `Invalid capability manifest registry: capability_discovery: name must be non-empty` 且没有 patch/test/PR summary，右侧结果区还默认暴露旧 run execution-unit/audit/debug 噪声。通用修复为 generated-task helper 增加 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)` 调用桥，discovery 只从 bounded task routes 分层揭示并输出 `completionEvidence=not-evidence`，同时 result audit details 默认折叠。复验 reload 后 manifest 错误不再可见、`可复现执行单元` 不再默认出现在正文、debug details 全部 closed。验证 `node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 11/11、`node --import tsx --test src/ui/src/app/results-renderer-execution-model.test.ts` 24/24、`node --import tsx --test src/runtime/capability-discovery.test.ts packages/contracts/runtime/capability-manifest.test.ts` 5/5、`npm run typecheck` 通过。
- 2026-05-17 - P2 - 执行 `P2-TASK-20260517-universal-data-chat-discovery` strict UX/data-analysis 评测，结论 `TaskSuccess=false`。真实 Browser `http://127.0.0.1:5273/` 从默认聊天提交 messy assay CSV 分析目标（不打开 Scenario Builder），clean session `workspace/parallel/p2/.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mp9lnkme-2wlbis` / run `run:task-card:f5u2f3` / task `generated-literature-2182f65faaaa` 最终为 `protocol-failed; task=needs-work`，generated Python 因 `df´l[col]` 非 ASCII 字符触发 `SyntaxError: invalid character '´'`，未产出 raw/cleaned CSV、报告、脚本复跑结果或图表。Browser 首屏仍显示 `文献证据评估场景`、`Scenario Runtime`、搜索框 `Execution Unit...`；90s 内右侧持续 `主结果等待 ConversationProjection`，reload 后 records 中已有 terminal `repair-needed` 但 UI 仍未恢复 terminal projection。Explorer-A 确认 discovery contract/service/tiny brief 已有但缺 agent-callable Gateway/helper invocation surface；Explorer-B 确认结果区基础 answer-first 但默认 shell/empty state 仍泄漏内部术语。目标测试 `node --import tsx --test src/runtime/capability-discovery.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/agentserver-prompts.test.ts packages/contracts/runtime/capability-manifest.test.ts` 通过 29/29；追加 `DISC-20260517-P2-002`、`DISC-20260517-P2-003`、`DISC-20260517-P2-004`。
- 2026-05-17 - Orchestrator - 纠正 UX-SYSTEM 同步状态：根据只读 sub-agent Harvey/Mendel、P4 helper bridge 后续修复和本地测试，`capability_discovery-api` / `discovery-progressive-disclosure` 当前为 `partial generated-task callable / blocked-on-AgentServer-tool-transport`；已具备 contract/service/manifest/tiny brief/prompt guidance/generated-task helper bridge/tests，生成任务可通过 `invoke_capability(task_input, "capability_discovery.search|expand|plan|explain", input)` 调用 bounded discovery，但还缺 AgentServer/backend direct tool-call transport、持久 discovery audit refs 和 UI `CapabilityPlanSummary`。`ui-execution-decoupling` 当前为 partial foundation：已有最小 `ProjectionApi` / `UserActionApi`、UI action boundary、manual preview action 和部分 completion-candidate salvage，但 UI 尚未整体迁移到 ProjectionApi，WorkspaceObjectPreview 仍组件内读 workspace，通用 import/verify/confirm transaction 尚未闭环。验证：targeted suite 47/47 通过；`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/ui/src/app/projectionApi.test.ts src/runtime/gateway/context-envelope.test.ts src/runtime/gateway/agentserver-prompts.test.ts` 81/81 通过；`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/capability-discovery.test.ts packages/contracts/runtime/capability-manifest.test.ts src/runtime/gateway/agentserver-stream.test.ts` 22/22 通过；`npm run typecheck` 通过。
- 2026-05-17 - Orchestrator - 新增 [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)，将 UI 与执行层解耦单独成文：API 明确定义为函数式语义 contract（`ProjectionApi` / `UserActionApi` / `ProjectionSubscriptionApi`），不绑定 HTTP；网页端只消费 canonical projection、artifact preview 和 action result，不直接解释 AgentServer 原文、handoff、stdout/stderr、raw ToolPayload 或 task attempt。同步更新 `docs/Architecture.md`、`docs/SciForge-SingleAgent-Architecture.md`、`docs/AgentHarnessStandard.md`、`docs/README.md`、`docs/CapabilityDiscovery.md` 和 `PROJECT.md`，并新增 `UX-SYSTEM-TASK-20260517-ui-execution-decoupling`。
- 2026-05-17 - Orchestrator - 将层次化能力检索与集成设计抽成独立文档 [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)，并明确标注为待实现、与当前代码状态一致：已有 registry/broker/preflight/harness candidate/`invoke_capability` 基础设施，但没有统一 agent-callable `capability_discovery.search/expand/plan/explain` API。`SciForge-SingleAgent-Architecture.md`、`Architecture.md` 和 `AgentHarnessStandard.md` 已改为引用该专项文档，只保留架构边界摘要。
- 2026-05-17 - Orchestrator - 按用户最新决策更新设计文档和任务板：不再把能力检索设计成固定触发时机，而是把 `capability_discovery` 定义为 agent 可调用的原子能力。初始 context 只提供极简 API brief；AgentServer/backend 在 compact brief 不足、provider/preflight/verification/repair 需要换路、或 selected refs 暗示新能力时自主调用 `search/expand/plan/explain`；runtime/harness 只负责预算、权限、审计、progressive disclosure、no-secret/no-endpoint leakage 和 provider-first 兜底。同步更新 `docs/SciForge-SingleAgent-Architecture.md`、`docs/Architecture.md`、`docs/AgentHarnessStandard.md`，并把 PROJECT 的 `UX-SYSTEM` 任务改为 capability discovery API / progressive disclosure 主线。
- 2026-05-17 - Orchestrator - 按最新产品评论更新任务板：下一轮 P1-P6 不只严评功能正确性，还要系统挑战默认体验是否能回到通用聊天入口、是否能自动选择 skills/tools/verifiers/UI、Scenario Builder 是否降级为高级调试/自定义面板、结果区是否 answer-first 且默认隐藏 run/audit/raw 噪声。新增 `UX-SYSTEM` 四个任务包：`universal-chat-entry`、`auto-skill-tool-selection`、`answer-first-results-panel`、`strict-user-proxy-process`。后续多端口进程必须用 Codex in-app browser 代替真实用户；网页主回复没有真正解决 hard requirements 就判失败，并用 sub agents 定位和修复通用根因。
- 2026-05-17 - P6 - 完成 `P6 Human Project Owner - Long-context Memory / Deliverable Iteration` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5673/` 多轮构建并修订 mini grant/research package，最终 session bundle `workspace/parallel/p6/.sciforge/sessions/2026-05-16_literature-evidence-review_session-literature-evidence-review-mp8yay7i-2e2jt9/task-results/research-package/` 的 `project-brief.md`、`decision-log.md`、`risk-register.md`、`timeline-budget.md` 全部更新为 v2 `$80,000 / 9 months`，`timeline-budget.md` Total 为 `$80,000 / 100%`，D-008 记录 `$120k/12mo -> $80k/9mo`，risk register 覆盖压缩预算/时间线风险。最终 UI 只读验收 run `project-literature-evidence-review-mp993stc-fv00af` 为 `protocol-success; task=satisfied` / `resultPresentation.status=complete` / `visibleAnswer.status=satisfied`，主回复无 partial/verification/raw 泄漏，`$120,000` 仅作为 v1 历史替换出现。通用修复覆盖 verified text-only claim refs、soft background verification、stale partial presentation、workspace-root stale artifact clobber、negated answer-only routing、direct read-only vs durable writeback 区分和只读 no-rewrite prompt 判断。验证 `node --import tsx --test packages/contracts/runtime/verification-policy.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/payload-validation.test.ts src/runtime/gateway/work-evidence-guard.test.ts packages/contracts/runtime/work-evidence-policy.test.ts packages/observe/web/mcp/playwright-edge.test.ts src/runtime/gateway/artifact-materializer.test.ts src/runtime/gateway/direct-context-fast-path.test.ts` 通过 143/143。关闭 `DISC-20260517-P6-002`。
- 2026-05-17 - P2 - 完成 `P2-TASK-20260517-messy-clinical-qc-sensitivity`：真实 Browser 在 `http://127.0.0.1:5273/` 生成 messy clinical-style QC/sensitivity 分析包，session `session-literature-evidence-review-mp91pqzw-lc5clt` / task `generated-literature-6605f03ada94` 产出 raw/cleaned CSV、`missingness_report.csv`、`analysis_report.md`、脚本和两张 PNG。真实 rerun command 已在 workspace 执行并写出 `.rerun.json`，报告/payload/artifact inline data 均保留真实命令。post-fix selected `missingness-report` follow-up run `project-literature-evidence-review-mp973bbv-j37z9x` 只用被选 QC/missingness 表，列出 165 patients、14/8.5% baseline missing、11/6.7% outcome missing、3/1.8% outliers、24/14.5% protocol deviations，并明确这些值不能单独证明或推翻 treatment-effect conclusion；records refs/citations/evidence 未含 report、cleaned CSV、charts 或 evidence matrix。目标测试 183/183 通过。
- 2026-05-17 - P1 - 追加完成 Edge MCP Web 端复验：按用户要求不再用脚本冒充，真实 Browser 在 `http://127.0.0.1:5173/` 提交 `playwright_edge_browser` 任务。先暴露 `vision-sense` 抢路和 AgentServer 生成 task 不写 `outputPath` 两个 Web-only 问题；通用修复打通 `config.local.json` provider route 到 UI request，显式 Edge MCP 意图绕过 vision-sense，并新增 `playwright-edge-browser-runtime` 确定性调用 `sciforge.observe.playwright-edge-mcp`。复验 run `project-literature-evidence-review-mp92lzy9-wzsqpd` completed，EU `EU-playwright-edge-browser-0e5566abb384` 为 `tool=playwright_edge_browser`，artifact `playwright-edge-browser-result-0e5566abb384` 返回 `Example Domain`、`edgeDetected=true`、UA `Edg/148.0.0.0`。目标测试 39/39 与 `npm run typecheck` 通过。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-edge-playwright-mcp-observe`：将已验证的 Microsoft Edge + `@playwright/mcp` headed browser 工具封装进 `packages/observe/web`。新增 `playwright_edge_browser` observe manifest、Edge MCP config/parallel profile helpers、provider availability projection、preflight interactive browser automation routing，并补上实际 MCP client provider adapter；generated tasks 现在会把 `sciforge.observe.playwright-edge-mcp` 路由成 node-cli adapter，通过 `@modelcontextprotocol/sdk` 调用 `/mcp`，不是只停在可发现。live 验证启动 Edge MCP 后，provider CLI 读取 `https://example.com` 成功返回 `Example Domain`、UA `Edg/148`、`edgeDetected=true`，search `Playwright MCP Microsoft Edge` 成功打开搜索结果并读取正文；live generated-task 通过 `invoke_capability("playwright_edge_browser", {"url":"https://example.com"})` 成功调用同一浏览器 provider。目标测试 31/31、unified capability graph、capability manifest registry、generated-task output lifecycle 6/6 与 `npm run typecheck` 通过。
- 2026-05-17 - P3 - 追加完成 selected reproduction-report 多问题 Web 严评：按用户要求在 `http://127.0.0.1:5373/` 连续提交反事实阈值、Random seed/Optimizer、rerun command/script path、证据边界与复杂真实世界外推追问。C4 暴露 prompt 文件名只命中 digest、未读 report body，E 暴露普通“支持结论”被误套全文/PDF 模板；通用修复提升 artifact metadata/delivery readable refs、给 prompt-named currentReferenceDigest 合成可读 report artifact、收窄 full-text evidence-status 触发条件，并保留 non-blocking verification complete projection。复验 C5 `project-literature-evidence-review-mp8zctwn-m1xbol` 正确列出 `logistic_fit_demo.py` 但不补造完整路径/命令，E2 `project-literature-evidence-review-mp8zgfzr-ypld2u` 正确回答不能外推真实数据/复杂模型/seed/noise/复跑/外部验证；目标测试 79/79、generation lifecycle 5/5 与 `npm run typecheck` 通过。
- 2026-05-17 - P5 - 完成 `P5-TASK-20260517-longitudinal-microbiome-rct`：真实 Browser 在 `http://127.0.0.1:5573/` 作为 PI/methodology reviewer 提交 longitudinal microbiome RCT protocol 审查任务。通用修复覆盖 file-backed markdown artifact delivery、verified claims durable evidence refs、explicit blocker/needs-work projection、read-only protocol budget follow-up direct-context routing，以及 `week 0`/baseline 去重。复验 clean run `generated-literature-1a48fa75c4cf` / session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8y5b23-boyhh6` 显示 `protocol=protocol-success; task=needs-work`，生成 217-line protocol checklist 与 23-line evidence matrix，未被 KRAS 污染且未把 unverified 标成 satisfied。reload 后 72 libraries follow-up 直接回答：36 patients × 2 timepoints = 72，drop week 4，保留 baseline/week 8 primary endpoint，继续标 needs-work/blocker；无 AgentServer dispatch、无 ContractValidationFailure、无 `week 0`。验证 `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/payload-validation.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/artifact-materializer.test.ts` 通过 75/75。追加 `DISC-20260517-P5-002`、`DISC-20260517-P5-003`，并登记未关闭的 `DISC-20260517-P5-004`。
- 2026-05-17 - P3 - 完成 `P3-TASK-20260517-selected-report-web-followup-hardening` / 关闭 `DISC-20260517-P3-002`：真实 Browser 在 `http://127.0.0.1:5373/` 选择 `reproduction-report` 后提交 seed/optimizer follow-up，旧 runs `project-literature-evidence-review-mp8x2i3v-czzbd5`、`project-literature-evidence-review-mp8x962l-dlt3li` 曾被 stale credibility summary 或 required-unverified partial 污染；通用修复覆盖 selected-only context scoping、PASS/FAIL 与 literal fact extraction、payload-level direct-context non-blocking verification 和 UI stale partial focus suppression。复验 run `project-literature-evidence-review-mp8y1gwb-znebcn` 为 `protocol-success; task=satisfied`，主回复只列 `Random seed: 42` 与 `Optimizer: differential_evolution...`，右侧结果视图无“只得到部分结果”。目标测试 98/98 与 53/53 通过，`npm run typecheck` 通过。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-browser-rendered-web-tool`：联网核对后选择 Playwright/Chromium 作为通用浏览器级底座，而不是引入额外 LLM browser-agent 框架。`@sciforge/web-worker` 新增 `browser_search` / `browser_fetch`，observe manifests 与 registry 可发现，generated-task provider-first route 能识别 browser/rendered/JS/PDF/full-text intent；`web_search` 普通 DuckDuckGo fetch 失败时可尝试 `playwright-chromium` / `bing-rendered`，显式 arXiv 查询仍优先 arXiv API 与 submittedDate window。真实 browser tool check 读到 JS 渲染正文，targeted tests 41/41 通过；`npm run typecheck` 仍失败在并行 dirty 类型问题，非 P1 边界。
- 2026-05-17 - P2 - 完成 `P2-TASK-20260517-rerun-command-chart-grounding`：真实 Browser 在 `http://127.0.0.1:5273/` 生成可复跑药物响应数据分析包，initial run `project-literature-evidence-review-mp8wou1d-rgyqkr` 暴露 CSV/report/PNG refs 且因 `Verification: 未验证` 保持 `task=needs-work` / `degraded-result`。workspace 复跑 `python analysis.py --inputPath . --outputPath .` 成功生成 `simulated_data.csv`、`boxplot_response.png`、`coefficient_plot.png`、`evidence_matrix.json`、`notebook_timeline.json`、`report.md`，报告包含样本量、正向 drugA@48h effect、p value/CI、assumptions 与 batch/confounding limitations。首轮 selected-chart follow-up 曾混入 sibling artifacts 或被 missing expected artifacts 拦截，通用修复收窄 `direct-context-fast-path` explicit selected-only payload/context/audit scope，并补强 ArtifactDelivery、plain direct-answer file refs 和 generated Python dependency policy。post-fix Browser run `project-literature-evidence-review-mp8xnujs-y8j1qv` 只基于 `boxplot_response.png` 回答 chart-alone 不足以证明显著性或 confounding；records `usedContextRefs` 未含 report/CSV/evidence_matrix/notebook_timeline。验证 `npx tsx --test src/runtime/gateway/direct-context-fast-path.test.ts`、`npx tsx --test src/runtime/gateway/artifact-materializer.test.ts`、`npx tsx --test src/runtime/gateway/direct-answer-payload.test.ts`、`npx tsx --test packages/skills/runtime-policy.test.ts` 全部通过。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-arxiv-provider-fallback`：`web_search` 新增显式 arXiv API fallback 与 fail-closed 边界，DuckDuckGo 失败时不再把 arXiv 任务落到 Crossref/EuropePMC 噪声；provider-first recovery query 现在保留 arXiv ID 并剔除否定 provider 指令。P1 Browser run `project-literature-evidence-review-mp8wpm4a-tuokwx` / session `session-literature-evidence-review-mp8wosla-a8idth` / task `generated-literature-d12315ab3d4d` 返回 `provider: arxiv-api`、`query: arXiv 1706.02275` 与 `arXiv:1706.02275v4` metadata，同时继续投影为 `repair-needed` / `failed`，未把 metadata 冒充全文阅读。验证 `node --import tsx --test packages/workers/web-worker/src/web-worker.test.ts` 与 `node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts packages/workers/web-worker/src/web-worker.test.ts` 通过；`npm run typecheck` 仍失败在并行 `artifact-materializer.test.ts` 类型问题，非 P1 边界。
- 2026-05-17 - P3/P4 - 关闭并补强 `DISC-20260517-P3-001`：Agent Harness 对 direct-context read-only answer 的 lightweight verification policy 不再强制 required；selected artifact follow-up 可以保留可见 `Verification: unverified`，但作为 non-blocking/background verification 继续显示 direct answer，不再被 Projection 降为 partial；P4 追加修复 stale partial ResultPresentation 与 recomputed satisfied projection 的不一致。验证 `node --import tsx --test src/runtime/gateway/agent-harness-shadow.test.ts src/runtime/gateway/verification-policy.test.ts src/runtime/gateway/result-presentation-contract.test.ts src/runtime/gateway/direct-context-fast-path.test.ts` 通过 58/58；P3 Browser `http://127.0.0.1:5373/` post-fix run `project-literature-evidence-review-mp8w5b66-m62v5m` 为 `protocol-success` / `task=satisfied` / `resultPresentation.status=complete` / `visibleAnswer.status=satisfied`，console error 为 0。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-arxiv-pdf-comparison` 回归式 strict-eval：真实 Browser 在 `http://127.0.0.1:5173/` 请求最近 30 天 arXiv MARL/credit assignment 两篇论文 PDF/全文中文对比报告，run `project-literature-evidence-review-mp8ve48s-dvv447` / session `session-literature-evidence-review-mp8vbn9x-0gdt4d` / task `generated-literature-673eefe8d9a8` 未完成全文任务但正确投影为 `repair-needed` / `failed`，response 明确 provider metadata is not full-text verified evidence，没有冒充完成。验证 `node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts` 通过。
- 2026-05-17 - P4/P5 - 关闭并复核 `DISC-20260517-P5-001`：repair-boundary source-edit guard 不再把 generated-task output evidence 误判成源码/配置越界；`.sciforge/{artifacts,task-results,logs,data,exports}/` 与当前 session bundle 对应输出目录进入 allowed prefixes，`PROJECT.md` 与 `src/*` 等源码配置仍会 blocked。验证 `node --import tsx tests/smoke/smoke-repair-boundary-output-allowlist.ts`、`node --import tsx tests/smoke/smoke-repair-boundary-guard.ts`、`npm run typecheck` 通过；P4 Browser `http://127.0.0.1:5473/` reload 后 SciForge shell/workspace tree 正常、console error 为 0；P5 Browser `http://127.0.0.1:5573/` 复核未再出现 task-results 越界误报，长跑 backend 已安全中断且不计为成功证据。
- 2026-05-17 - P5 - 完成 `P5 Human Methodologist - Experimental Design / Review` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5573/` 请求 single-cell perturbation biomarker 实验设计 reviewer critique/protocol/checklist。首轮 session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_workspace-biomedical-knowledge-graph--kras-g12d----mp8tjp68_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8tk2oo-zbhhol` 生成 `generated-knowledge-e4be5b9cba2d-sc-biomarker-protocol-checklist.md`，内容具体但 UI 在 `Verification: 未验证` 下仍有 completed/satisfied 口径，严格判 `TaskSuccess=false` / `AnswerQuality=fake-success/partial`。修复 Projection / ConversationKernel / ResultPresentation 的 verification-required completion gate：required/unverified 或请求要求 verification 但无 pass verdict 时，一律降为 needs-work/partial 并给出 verifier/human-approval 下一步。验证 `node --import tsx --test src/runtime/gateway/result-presentation-contract.test.ts src/runtime/conversation-kernel.test.ts tests/smoke/smoke-conversation-kernel-final-shape.ts` 通过 28/28；post-fix Browser 新跑不再 `task=satisfied`，转为 `protocol-failed; task=needs-work` 并暴露 repair-boundary follow-up，已登记 `DISC-20260517-P5-001`。
- 2026-05-17 - P4 - 关闭 `DISC-20260517-P4-002`：plain AgentServer direct-answer recovery 对 coding/repair/reproduction completion claim 改为 evidence-gated；无结构化 `codeRef`/`diffRef`/`patchRefs`/`workEvidence`，且没有“修改文件路径 + 验证命令”的纯文本“fixed/tests pass/PR ready”会投影为 runtime diagnostic，不再包装为 satisfied direct answer。验证 `npx tsx src/runtime/gateway/direct-answer-payload.test.ts` 14/14、`npx tsx src/runtime/gateway/direct-context-fast-path.test.ts` 39/39、`npm run typecheck` 通过。
- 2026-05-17 - P3 - 完成 `P3-TASK-20260517-logistic-ode-reproduction` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5373/` 请求 Logistic growth ODE 参数估计 toy reproduction，首轮 run `project-literature-evidence-review-mp8tmbus-d780yv` / task `generated-literature-8ef4985b7dc3` 生成并运行 `logistic_fit_demo.py`，报告 `r` error 4.67%、`K` error 0.77%、RMSE 4.3505、`Reproduction success: YES`。selected reproduction report follow-up 首轮 `project-literature-evidence-review-mp8u57o6-r229qf` 与重试 `project-literature-evidence-review-mp8ughrj-g0hk8z` 被 legacy `risk(s)` transform 误路由为 planning register，严格判 follow-up `TaskSuccess=false`。通用修复收窄 `direct-context-fast-path` planning-register fallback、增加 selected report QA 分支，并补 plain direct-answer runtime evidence guard、metric prose parser 和 draft identity guard。复验 run `project-literature-evidence-review-mp8unjqv-z81dk6` 直接回答 selected report 的可信度、精确指标、最大风险和下一步验证；仍因 verification gate `unverified` 显示 partial，已登记 `DISC-20260517-P3-001`。验证 `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/direct-answer-payload.test.ts src/runtime/gateway/result-metric-consistency-guard.test.ts src/ui/src/app/sciforgeApp/appStateModels.test.ts` 通过 62/62。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-selected-report-followup` strict-eval/fix/browser-recheck 闭环：真实 Browser 选中旧 run 的 `research-report-provider-recovery` 后追问全文/PDF 证据状态，首轮 run `project-literature-evidence-review-mp8udstw-qn7v7q` 与重试 `project-literature-evidence-review-mp8ujrbk-2kkf50` 仍被泛化 answer-only 分支包装成“上一轮可见答案”，严格判 `TaskSuccess=false` / `AnswerQuality=partial/unsafe-boundary`。通用修复在 `direct-context-fast-path` 增加 selected report evidence-status 分支，metadata-only report 现在明确回答未记录已读/已验证 arXiv PDF/全文证据、不能支持全文调研已完成。复验 run `project-literature-evidence-review-mp8ul9wo-57z13n` 只基于当前选中的 report 输出恢复步骤；验证 `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts` 与 `node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts src/runtime/gateway/artifact-reference-context.test.ts` 通过。
- 2026-05-17 - P4 - 关闭 `DISC-20260517-P4-003`：workspace file write/create/rename/delete mutation 不再直接 `resolve()` 请求路径，而是通过 active workspace containment resolver 解析 path/targetPath；UI `writeWorkspaceFile` 与 `mutateWorkspaceFile` 显式携带 `workspacePath`。验证 `node --import tsx tests/smoke/smoke-workspace-file-api.ts` 覆盖绝对路径逃逸、`..` 相对逃逸、rename 出 workspace、delete workspace 外文件与正常写/删路径，`npm run typecheck` 通过；Browser `http://127.0.0.1:5473/` reload 后 SciForge shell/workspace tree 正常、console error 为 0。
- 2026-05-17 - P2 - 完成 `P2 Human Data Scientist - Data Analysis / Reproducibility` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5273/` 请求 batch/timepoint/treatment 数据分析、EDA、统计模型、robustness、图表和复跑脚本。首轮 run `project-biomedical-knowledge-graph-mp8tlixq-6f9o7q` 生成 CSV/图/脚本/artifact，但网页以 `satisfied` 展示未验证且统计解释与 robustness 系数矛盾，严格判 `TaskSuccess=false` / `AnswerQuality=partial/fake-success`。通用修复扩展 `result-metric-consistency` guard，拦截高误差成功声明和 robustness/confounder 解释与控制前后系数矛盾。复验 run `project-literature-evidence-review-mp8u8rr9-uf09xt` 变为 `task=needs-work` / `degraded-result`，selected `Research-Report` follow-up run `project-literature-evidence-review-mp8u9wmk-maz5si` 只基于选中 artifact 并保持 partial/degraded。验证 `node --import tsx --test src/runtime/gateway/result-metric-consistency-guard.test.ts src/runtime/gateway/result-presentation-contract.test.ts` 与 `npm run typecheck` 通过。关闭 `DISC-20260517-P2-001`。
- 2026-05-17 - P4 - 完成 `P4 Human Developer - SciForge Coding / Self-improvement` strict-eval/fix/browser-recheck 闭环：真实 Browser 在 `http://127.0.0.1:5473/` 提交 SciForge self-improvement coding 任务，run `project-literature-evidence-review-mp8tl06x-50de0d` / session `session-literature-evidence-review-mp8tjlyj-zuo9g4` 因 AgentServer generation convergence guard 停止而严格判 `TaskSuccess=false` / `AnswerQuality=failed`，reload 后仍显示 `failed` / `运行需要恢复` 而非 fake satisfied。P4 owner 实现通用 `codingDeliverySummary` contract，TaskAttempt/TaskRunCard 可保留 readFiles、planned/modified files、patchRefs、verificationCommands、riskChecklist 与 generalityStatement，并从 output payload hydrate。验证 `npx tsx src/runtime/task-attempt-history.test.ts`、`npx tsx packages/contracts/runtime/task-run-card.test.ts`、`npm run typecheck` 通过。追加 `DISC-20260517-P4-002` 与 `DISC-20260517-P4-003`。
- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-agentic-rl-arxiv-fulltext` strict-eval 闭环：真实 Browser 请求最近 48 小时 arXiv agentic RL 全文/PDF 中文报告，首轮判 `TaskSuccess=false` / `AnswerQuality=fake-success`，因为 provider-first recovery 只产出 metadata/unverified 仍被标 `satisfied`；修复 `generated-task-runner-generation-lifecycle` 的 deterministic provider-route recovery adapter，使 metadata-only recovery 输出 `failed-with-reason` 诊断而非完成态，并去除旧领域默认字段。复验 run `run:task-card:23z332` / session `session-literature-evidence-review-mp8tqrn8-hj97yf` / task `generated-literature-24bfd7f7036b` 在 Web UI 和 reload 后均为 `repair-needed` / recoverable。验证 `node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`、`node --import tsx --test src/runtime/gateway/generated-task-runner-output-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts` 通过；`npm run typecheck` 当前失败在既有/并行 TS 问题，非 P1 修改边界。关闭 `DISC-20260517-P1-001`。
- 2026-05-17 - Orchestrator - 按用户要求将 Browser E2E / evidence 规则改为轻量策略：worker 默认像真实人类一样直接在 Web UI 和 workspace 查证据，`PROJECT.md` 只记录结论级任务管理信息；只有失败、假成功、修复对比、UI/workspace 不一致或提交验收时才升级保存截图/DOM/console/network/manifest。
- 2026-05-17 - Orchestrator - 按用户要求将 P1-P6 从固定剧本改为开放式人类使用者角色：只保留探索方向、严评重点和自主 milestone 闭环，允许 worker 主动探索、调整任务、发现新问题并用 sub agents 修复。
- 2026-05-17 - Orchestrator - 应用户要求重写 `PROJECT.md` 当前任务板：删除 P1-P6 历史 run/evidence/旧 discovered task 残余，只保留原则、协议、端口矩阵、统一 evidence schema 和验证口径；重建 P1-P6 strict user-proxy evaluation 任务。

## Current Handoff

下一轮接手优先级：先执行 `UX-SYSTEM Universal Chat / Capability Discovery / Debug Folding`，再继续旧 discovered queue。P1-P6 应在各自端口用 Codex in-app browser 从普通用户视角挑战 SciForge：不预先打开 Scenario Builder，不手工配置大批 allowlist，直接提交真实跨领域请求，观察 handoff 是否暴露极简 `capability_discovery` API brief、agent 是否在能力不足时自主调用 search/expand/plan/explain、discovery 是否分层揭示且没有泄漏 endpoint/secret/schema 大包、最终是否通过 `invoke_capability` 执行并给出 answer-first 主回复。只要网页主回复没有真正解决用户 hard requirements，或用户必须从场景名、builder tabs、run/audit/raw payload、execution unit 噪声里自己拼答案，就判 `TaskSuccess=false` 或 UX blocker，记录证据并用 sub agents 定位通用根因。

具体下一步：`UX-SYSTEM-TASK-20260517-capability-discovery-api` 与 `UX-SYSTEM-TASK-20260517-discovery-progressive-disclosure` 当前为 partial backend retry consumption + ledger replay refs + default UI summary card + debug folding / blocked-on-P1-P6-browser-validation；生成任务路径已可调用 bounded discovery，AgentServer stream-side tool-call 已可转成 runtime `tool-result`、session audit record 和 session-bundle ledger event，stream 只产出 discovery tool-call、没有终态结果时会 bounded retry，把 compact `capabilityDiscoveryToolResults` 放入第二次 backend 请求，`ProjectionApi.getCapabilityPlanSummary` 也已能生成最小用户摘要，默认 Results UI 会展示能力计划卡，能力发现记录已折叠进 `UserActionApi.openDebugAudit` action boundary。下一步必须做真实 P1-P6 browser 验收，不能只靠 tiny brief / prompt guidance / stream audit / retry test / projection unit test / smoke page 判全绿。`UX-SYSTEM-TASK-20260517-ui-execution-decoupling` 当前为 partial foundation，下一步优先把 WorkspaceObjectPreview/manual preview、retry/recover/import/verify transaction 和默认 projection raw scrub 收敛到 ProjectionApi/UserActionApi。并行继续 `UX-SYSTEM-TASK-20260517-universal-chat-entry`、`UX-SYSTEM-TASK-20260517-answer-first-results-panel` 和 `UX-SYSTEM-TASK-20260517-strict-user-proxy-process`。每个进程仍使用独立端口/workspace/state/config；每个 milestone 都必须更新本文件、提交并 push GitHub、关闭上一批 sub agents，再启动下一批。旧 P1-P6 strict-eval/fix/reverify 闭环已完成，可作为回归样本；未关闭的 `DISC-20260517-P5-004` 保留，但不应抢占本轮 UX 简化主线，除非它在新的真实用户评测中再次成为 blocker。
