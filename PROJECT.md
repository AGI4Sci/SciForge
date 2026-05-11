# SciForge - PROJECT.md

最后更新：2026-05-11

## 当前目标

把 SciForge 的 harness 从“完整复杂任务治理系统”升级为 **Latency-first、分层、模块化、可研究的实时调度框架**。

核心目标不是为某个文献、代码、GUI 或数据任务做特例提速，而是让任何场景都先走最小可行路径，尽早回答用户问题；只有在证据收益明确、用户要求明确、预算允许时，才逐层升级到更深的工具调用、验证、修复、后台执行和审计。

## 开工前必读

任何 agent 在执行本项目任务前，必须先读本文件和与任务相关的设计文档，避免凭局部代码印象破坏系统边界。

- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Contract-enforced / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。
- [`docs/Usage.md`](docs/Usage.md)：网页端使用流程、多 backend、论文复现/自我进化/Computer Use 操作路径。
- [`docs/Extending.md`](docs/Extending.md)：新增 capability、artifact、view、scenario、package 时的扩展方式。
- [`README.md`](README.md)：产品定位、快速启动、核心概念和当前能力范围。

## 设计判断

当前 harness 已经抽离出了不少正确边界：

- `HarnessContract` 已集中承载 intent、context、capability、budget、verification、repair、progress、presentation。
- `HarnessProfile` 和 callback/stage 机制已经使策略不再散落在 UI 或 prompt builder。
- merge 规则、trace、audit note、progress/presentation plan 已经形成可重建的治理层。
- profile 如 `fast-answer`、`balanced-default`、`research-grade`、`debug-repair`、`privacy-strict` 已经具备可配置雏形。

但它还没有完全成为理想的“分层模块化 harness 框架”：

- profile 偏静态，缺少请求级 `latencyTier` 作为第一决策。
- stage 是完整枚举，但执行时缺少 `criticalPath` / `auditPath` 分层。
- merge 规则安全性强，但 latency 维度不够灵活，容易只升级、不降级。
- 验证和 repair 已抽离，但粒度仍偏粗，普通任务可能承担研究级成本。
- progress/silence policy 有结构，但缺少硬性的 `partialResultDeadline`。
- capability 选择缺少通用 cheap-first 升级序列，容易过早进入 project/runtime/generation 深流程。

因此下一阶段的重点是：**保留 harness-governed 的可审计性，同时把默认执行路径变轻、变快、变可中断。**

## 不变原则

- 不为具体场景、prompt、论文、artifact 名称或任务类型写特例；所有修改必须通用、适应任何场景
- UI 只消费 runtime contract、artifact schema、view manifest、presentation contract 和结构化事件。
- Prompt builder 不是策略真相源；策略必须来自 harness contract、capability manifest 或可信 runtime policy。
- Safety policy 继续 fail closed；latency、验证、上下文和 repair 深度必须可按层级收缩。
- 复杂任务要可审计，但审计路径不能阻塞用户看到第一份可读结果。
- 任何长任务都必须产出 structured partial/failure，而不是等总超时后只显示 runtime trace。

## 任务板

### H001 Latency Tier 作为第一决策

职责：在 harness contract 中引入通用 `latencyTier`，让所有场景先判断回答深度，再选择 context、capability、budget、verification、repair 和 presentation。

建议层级：

- `instant`：不调用外部工具，直接回答或基于当前上下文回答。
- `quick`：少量工具调用，几十秒内必须产出答案。
- `bounded`：有明确工具链，但 Top-K、下载、验证、repair 都受限。
- `deep`：用户明确要求深入研究、复现、长报告或严格验证。
- `background`：超出交互预算后后台继续，前台先返回 partial。

Todo：

- [x] 在 `HarnessContract` / `HarnessDecision` / trace 中加入 `latencyTier`。
- [x] 增加 latency tier classifier，优先基于用户显式要求、风险、side effect、上下文可用性和预计成本判断。
- [x] 为每个 tier 定义默认 context budget、tool budget、verification、repair、progress、presentation policy。
- [x] 增加 smoke：同一请求在不同 tier 下产生不同预算和 stage plan。

验收：

- [x] 简单问题不会默认进入深度 project/runtime/generation。
- [x] 深度请求仍可显式升级，不破坏科研复现和严格验证能力。

### H002 Critical Path / Audit Path 分层执行

职责：把 harness stage 分成用户等待路径和审计补录路径，保证主答案不被完整 trace、ledger、replay metadata 阻塞。

建议分层：

- Critical path：intent、latency tier、minimal context、capability、budget、run、result presentation。
- Audit path：full trace、budget ledger、repair telemetry、provenance expansion、replay metadata。

Todo：

- [x] 给每个 `HarnessStage` 标注 `critical`、`audit` 或 `external`。
- [x] 支持 `criticalPathOnly` evaluation mode，quick/instant 只执行必要 hook。
- [x] audit path 改成异步或 post-result materialization，不阻塞 first answer。
- [x] trace 中记录哪些 audit hook 是 deferred、skipped 或 completed。

验收：

- [x] quick 任务能跳过非必要 audit hook，但仍保留可解释的 minimal trace。
- [x] deep/background 任务仍可生成完整 audit record。

### H003 Cheap-First Capability Escalation

职责：把 capability 选择从“直接选择完整能力”改成通用 cheap-first 升级序列。

通用顺序：

1. 当前上下文直接回答。
2. 轻量读取 metadata / summary / refs。
3. 单工具精确执行。
4. 少量工具组合。
5. workspace task / generated code。
6. deep agent project。
7. repair rerun / background continuation。

Todo：

- [x] 在 `CapabilityDecision` 中加入 `escalationPlan` 或 `candidateTiers`。
- [x] 为 capability manifest 增加 cost class、latency class、side effect class。
- [x] 让 broker 先尝试低成本候选，失败或 evidence insufficient 时再升级。
- [x] 每次升级必须写明收益、成本和停止条件。

验收：

- [x] 普通任务不会直接进入最重能力。
- [x] 升级路径可从 trace 重建。

### H004 分层 Verification Policy

职责：把 verification 从单一强度改成可组合层级，避免普通任务承担研究级验证成本。

建议层级：

- `shape`：输出结构合法。
- `reference`：引用、artifact、file ref 可解析。
- `claim`：关键结论有证据或明确 uncertainty。
- `recompute`：需要重算、重跑或复现。
- `audit`：严格审计级验证。

Todo：

- [x] 将 `VerificationPolicy.intensity` 扩展为 `verificationLayers`。
- [x] quick 默认只跑 `shape` + `reference`。
- [x] bounded 默认跑 `shape` + `reference` + `claim`。
- [x] deep/reproduction 才启用 `recompute` / `audit`。
- [x] validator 输出 presentation-friendly partial，而不是把用户丢进 raw schema failure。

验收：

- [x] 成功/partial/failure 都能快速形成用户可读结果。
- [x] 严格验证能力保留，但只在需要时触发。

### H005 Repair Budget 与 Partial-First 策略

职责：repair 不再默认吞掉用户等待时间。失败时先给 partial，再决定是否继续 repair 或后台处理。

Todo：

- [x] 在 `RepairContextPolicy` 中加入 per-tier repair budget。
- [x] quick/bounded 只允许 cheap repair，失败立即 materialize partial/failure。
- [x] deep/background 可多轮 repair，但每轮必须产生 checkpoint artifact。
- [x] 重复失败、无代码变化、无新 evidence 时停止 repair。
- [x] repair 结果必须进入 `ResultPresentationContract` 的 failure reason、impact、recover actions。

验收：

- [x] 不再出现长时间 repair 后只剩 runtime trace 的用户体验。
- [x] 每个 repair attempt 都可审计，但不阻塞主回复。

### H006 Progress Deadline 与 First Result SLA

职责：把 progress 从“有事件就展示”升级为 deadline-driven 调度。

建议默认 deadline：

- intent/context：1-3 秒。
- capability selection：1-5 秒。
- first partial/result：15-30 秒。
- bounded artifact：1-3 分钟。
- deep task：转后台或请求确认。

Todo：

- [x] 在 `ProgressPlan` 中加入 `firstResultDeadlineMs`、`phaseDeadlines`、`backgroundAfterMs`。
- [x] silence policy 到期时优先 materialize partial，而不是只显示 still working。
- [x] 超过 first result deadline 必须生成 `result-presentation` 或 `partial-result` event。
- [x] UI 展示“已完成部分”和“仍在后台继续的部分”。

验收：

- [x] 任意任务在 first result deadline 前有可读状态或 partial。
- [x] 长任务自动后台化，不把用户锁在等待态。

### H007 Presentation-First Runtime Contract

职责：确保所有路径都先产出用户可读 result presentation，再补审计细节。

Todo：

- [x] 让 runtime 在 quick/bounded/deep/failure 都强制 materialize `ResultPresentationContract`。
- [x] presentation contract 标注 `complete`、`partial`、`needs-human`、`background-running`。
- [x] 主回复只消费 presentation contract；process/raw/diagnostics 默认折叠。
- [x] 对 no-result、raw-only、trace-only 输出增加 no-legacy guard。

验收：

- [x] 用户永远先看到答案、partial 或失败原因，而不是 raw ToolPayload/trace。
- [x] 审计信息仍可展开和导出。

### H008 分层 Harness 模块化研究框架

职责：把 harness 从“若干 profile + callbacks”整理成更适合实验和研究的模块组合框架。

建议模块：

- Intent module：识别任务目标、风险和是否可直接回答。
- Latency module：选择 `latencyTier` 和 first-result SLA。
- Context module：选择最小上下文和 refs。
- Capability module：cheap-first 能力选择和升级。
- Budget module：按 tier 分配时间、工具、下载、token、provider。
- Verification module：选择 verification layers。
- Repair module：选择 repair 策略和停止条件。
- Progress module：deadline、background、cancel、interaction。
- Presentation module：结果层级、引用密度、诊断折叠。
- Audit module：异步 trace、ledger、replay 和训练数据。

Todo：

- [x] 定义 `HarnessModule` 接口，模块声明 owned stages、inputs、outputs、cost、default tier applicability。
- [x] profile 只组合模块和参数，不直接承载大量策略逻辑。
- [x] 增加 module registry 和 module-level smoke coverage。
- [x] 支持实验配置：同一 fixture 用不同 module stack replay，比较 latency、cost、quality、failure rate。
- [x] 输出 harness research report：每个模块对耗时、成功率、用户等待的影响。

验收：

- [x] 新增或替换策略不需要改核心 runtime。
- [x] 可以系统性研究“更快、更准、更省”的 harness 组合。

### H009 Profile 简化与默认策略重设

职责：把默认 profile 从 balanced-heavy 调整为 fast-first，并让 deep 能力显式升级。

Todo：

- [x] 重新定义 `balanced-default`：默认 quick/bounded，不默认 deep。
- [x] `fast-answer` 收敛为 instant/quick。
- [x] `research-grade` 和领域 profile 只在用户要求深度、严格验证或复现时启用。
- [x] 增加 profile selection trace：为什么选择当前 profile，为什么没有选择更深 profile。
- [x] 对历史 profile 加 migration note，避免旧行为被误判为 regression。

验收：

- [x] 默认用户请求更迅速、直接。
- [x] 高风险/高深度任务仍可通过显式 profile 或 classifier 升级。

### H010 Harness Latency Benchmark

职责：建立不依赖具体业务场景的 benchmark，评估 harness 提速是否真实有效。

Fixture 维度：

- simple Q&A。
- current-context follow-up。
- small retrieval。
- artifact summarization。
- code fix。
- GUI action。
- data table analysis。
- partial/failure recovery。
- deep research request。

Todo：

- [x] 为每类 fixture 定义 expected latency tier、max first result time、max tool calls、expected presentation sections。
- [x] 增加 `smoke:harness-latency-tiers`。
- [x] 增加 replay benchmark，输出 cost/latency/quality summary。
- [x] 把 benchmark 纳入 `verify:fast` 或单独的 non-live smoke。

验收：

- [x] harness 改动可以量化“更快、更直接”，而不是只凭主观感觉。
- [x] deep 能力没有被提速改动破坏。

## 当前里程碑

- [x] M1：完成 `latencyTier` contract 与默认 tier budgets。
- [x] M2：实现 critical path / audit path 分层。
- [x] M3：实现 cheap-first capability escalation。
- [x] M4：实现 verification layers 与 per-tier repair budget。
- [x] M5：实现 first result deadline 和 partial-first progress。
- [x] M6：把 profile 改造成 module stack 配置。
- [x] M7：建立 harness latency benchmark，并用 smoke 固化。

## 已清理内容

旧的科研复现、论文、raw-data、UI 缺口等任务板已从当前 PROJECT backlog 中移除。相关历史仍保留在 git 历史、docs、fixtures、smoke 和已提交代码中；当前 PROJECT 只追踪下一阶段的通用 harness 分层与提速工作。
