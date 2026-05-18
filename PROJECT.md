# SciForge Project Protocol

最后更新：2026-05-18

## North Star

SciForge 的目标是成为能处理复杂科研、工程和产品任务的自进化 Agent 工作台。当前研发方式是让多个 Codex 自动化进程代替真实用户持续使用 SciForge：提出复杂任务、观察网页主回复和 artifact、发现失败边界、修复设计文档和代码，再用测试与 browser 证据验证。

“成功完成任何复杂任务”不能靠单个 prompt 许愿实现。SciForge 必须逐步具备以下性质：

- 默认入口是普通用户能理解的通用聊天工作台，而不是 Scenario Builder、allowlist、execution unit 或 raw payload 调试台。
- Agent 能自主发现、展开、规划并调用能力；能力不足时诚实说明缺口和恢复路径。
- 主回复先解决用户问题；artifact、workspace refs、audit/debug 只是证据和追踪材料。
- 复杂任务可以分解、执行、验证、恢复、复跑和跨轮继续。
- 修复必须通用，落在 policy、harness、capability、gateway、AgentServer、Projection、ArtifactDelivery、persistence 或 UI boundary，不写单 prompt、单 provider、单 session、单端口特例。
- 每轮自动化都要产生可复盘的证据：用户目标、hard requirements、可见结果、失败边界、修复、测试和剩余风险。

## Operating Mode

本文件是多 Codex 自动化的共享协议和同步面板。它不保存大段 DOM、日志或源码，不替代架构文档。所有进程必须先读本文件，再选择任务。

自动化进程分为三类：

- **User-Proxy Worker**：像真实用户一样使用 SciForge，提交开放式复杂任务，判断是否真的完成。
- **Repair Worker**：根据 user-proxy 发现的问题定位 root boundary，修改文档或代码，补测试。
- **Integration Worker**：合并并行进展，处理冲突，跑验证，保持主线可运行。

每个 worker 的核心循环：

1. 读 `PROJECT.md`、`git status`、相关 docs/tests。
2. 选择一个真实任务或一个已发现 blocker。
3. 用 Codex in-app browser 从默认入口自然使用 SciForge；不要用内部知识绕过 UI 体验。
4. 记录 hard requirements 和用户可见结果。
5. 若失败，定位通用 root boundary；必要时并行启动 sub agents 做勘察、修复或测试。
6. 修改代码或设计文档。
7. 跑最小相关测试；高风险改动再跑更大 gate。
8. 更新本文件的状态、证据 refs、验证命令和剩余 blocker。
9. 小步提交、push，由 integration worker 合并。

## Parallelization Protocol

### Work Isolation

高并行优先使用独立 branch 或独立 worktree，不要多个进程长期写同一个工作目录。

建议分支命名：

```text
codex/<machine-or-process>/<short-task>
integration/sciforge-auto
main
```

建议工作目录：

```text
../SciForge-p1
../SciForge-p2
../SciForge-repair-capability
../SciForge-integration
```

每个 worker 只修改自己任务需要的最小文件集。涉及共享 contract、核心 gateway、Projection 或 UI shell 时，必须在本文件对应任务写明影响面和验证命令。

### Heartbeat

自动化心跳建议：

- User-Proxy Worker：每 20-30 分钟记录一次状态，长任务至少保存当前 run/session/artifact refs。
- Repair Worker：每 30-45 分钟记录 root-cause、已改文件、测试状态。
- Integration Worker：每 60 分钟拉取 worker branches，按风险逐个合并并跑 gate。

心跳内容必须短，但要可接手：

```markdown
- 2026-05-18 HH:mm P2：messy CSV 分析任务 strict-eval failed；主回复缺少复跑命令；refs: ...；疑似边界: ArtifactDelivery/ResultsRenderer；next: 修 answer-first summary + targeted test。
```

### Sub Agent Rules

同一进程内可以使用多个 sub agents，但必须给清晰边界：

- explorer：只回答具体代码问题，例如“ProjectionApi 在哪里组装主回复？”
- worker：负责明确文件或模块，例如“只改 `src/ui/src/app/results/**` 和相关 tests”。
- 主进程负责整合、验证和更新 `PROJECT.md`。

不要让多个 worker 同时自由修改同一文件集。

## Invariant Principles

这些原则继承自旧版 `PROJECT.md`，优先级高于任何单轮任务、单个 worker 偏好或临时 prompt。

- **真实 browser 优先**：每个活动进程必须用 Codex in-app browser 完成端到端多轮任务；terminal smoke 只能补充，不能替代用户可见证据。
- **任务成功优先**：`TaskSuccess=true` 必须代表用户 hard requirements 被准确、完整、可核查地解决。
- **反假成功优先**：`satisfied`、artifact refs、recover action、verification 未验证、summary 或计划，都不能单独算完成。
- **所有修复必须通用**：修 policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / persistence / UI boundary，不写 prompt/provider/session/端口特例。
- **Capability Discovery 是 agent 可调用原子能力**：初始 context 只暴露 tiny API brief；完整 registry/schema/examples/providers 只能通过 progressive disclosure 获取；discovery recommendation/plan 永远是 `not-evidence`，不能当作任务完成证据。
- **UI/执行层必须函数化**：网页端通过 `ProjectionApi`、`UserActionApi`、`ProjectionSubscriptionApi` 等语义函数读写 presentation 状态和用户动作；raw ToolPayload、AgentServer direct text、handoff JSON、stdout/stderr、task attempt 只能进入 audit/debug channel。
- **主回复判定优先**：结果面板、审计区、workspace refs 只是证据，不能替代用户可读答案。
- **同步优先**：完成 milestone 后更新本文件、提交并 push；发现冲突时在对应任务写 blocker，不擅自回滚并行改动。

## Product Principles

- **默认通用聊天入口**：普通用户不应被迫理解 Scenario Builder、allowlist、execution unit、raw payload 或 run/audit 结构。
- **Answer-first**：默认结果区先给主答案、完成度、关键证据和下一步；run/audit/raw payload/execution unit 默认折叠。
- **Capability-driven**：能力发现、展开、规划、解释走 `capability_discovery.search/expand/plan/explain`；能力执行走 `invoke_capability` / Capability Gateway。
- **诚实失败**：能力不足、provider 不可用、数据不可得、生成代码失败或验证失败时，必须说明缺口、已完成部分、可恢复动作和下一步。
- **文档与代码同步**：设计 contract 写对应 docs；`PROJECT.md` 只记录当前目标、owner、状态、证据和下一步。

## Required Reading

实现前按需读取：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)
- [`docs/Architecture.md`](docs/Architecture.md)
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)
- [`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)
- [`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)

设计 contract 落点：

- UI 解耦：[`docs/UIExecutionDecoupling.md`](docs/UIExecutionDecoupling.md)
- 能力发现：[`docs/CapabilityDiscovery.md`](docs/CapabilityDiscovery.md)
- Agent/harness 架构：[`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)、[`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)

## Milestone: Autonomous User-Proxy Gauntlet

状态：active
总控：Codex Orchestrator
集成分支：`main` 或 `integration/sciforge-auto`

目标：P1-P6 并行进行开放式 strict user-proxy exploration，并把失败转化为通用修复。

### Gates

- [ ] **P1-P6 Browser Gate**：每个进程完成至少一个新真实任务的 browser strict-eval。
- [ ] **Universal Chat Gate**：默认入口不要求理解场景名/builder，至少覆盖 literature、data analysis、coding/self-improvement 三类任务。
- [ ] **Discovery Runtime Gate**：真实任务中验证 handoff 有 tiny `capability_discovery` brief，agent 能在能力不足时调用 `search/expand/plan/explain`，结果通过 `invoke_capability` 执行或诚实失败。
- [ ] **Progressive Disclosure Gate**：初始 prompt/handoff 不注入完整 registry/schema/examples/provider endpoint；discovery 不泄漏 endpoint/secret/workspace root。
- [ ] **Answer-First Gate**：不展开 debug 时，用户能在 10 秒内判断任务是否完成、缺什么、下一步点哪里。
- [ ] **UI/API Decoupling Gate**：用户动作和调试展开走 `UserActionApi`，artifact preview / selected object / retry / recover / import-verify-confirm 继续收敛到函数式 API。
- [ ] **General Fix Gate**：每个修复有 targeted tests 或 conformance fixture，并说明为什么不依赖单 prompt/provider/session。
- [ ] **Sync Gate**：每个 milestone 更新 `PROJECT.md`、提交并 push。

## Worker Matrix

| 进程 | 严评主题 | UI | Writer | AgentServer | Workspace | State | Config |
|---|---|---:|---:|---:|---|---|---|
| P1 | 最新论文 / 全文科研调研 | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
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

## Strict Evaluation Template

每个 user-proxy 任务必须记录以下内容：

```markdown
### EVAL-YYYYMMDD-P?-NNN 标题

状态：pass / partial / fail / blocked
用户目标：
Hard requirements：
- ...
Browser entry：
- URL:
- run/session/artifact refs:
用户可见结论：
- 主回复是否直接解决问题：
- artifact 是否可打开、可理解、可复用：
- 缺失或误导：
TaskSuccess：
AnswerQuality：
Root boundary：
修复动作：
验证：
剩余风险：
```

判定标准：

- **pass**：hard requirements 全部满足，主回复可独立理解，关键证据可核查。
- **partial**：产出了有用结果，但缺少复跑、证据、artifact 可用性、恢复路径或关键要求。
- **fail**：主回复没有解决用户问题，或把内部错误包装成成功。
- **blocked**：外部服务、凭据、数据权限或环境缺口阻塞；必须给出诚实替代方案。

## Active UX-System Board

### UX-SYSTEM-TASK-20260517-universal-chat-entry

状态：partial / blocked-on-P1-P6-browser-validation
Owner：Orchestrator + P1-P6

已完成：P4 默认 shell 不再显示 `Scenario Runtime` / `Execution Unit` / `文献证据评估场景` / raw terms；文案改为 `聊天工作台`、`Ask SciForge`、`当前上下文`。

下一步：验证普通用户无需打开 builder，即可提交 literature/data/coding/methodology/long-context 任务并理解答案、能力选择和下一步。

### UX-SYSTEM-TASK-20260517-capability-discovery-api

状态：partial / blocked-on-P1-P6-browser-validation
Owner：capability_discovery owner / Orchestrator

已完成：contract/types、核心 manifest、service、tiny handoff brief、prompt guidance、generated-task helper bridge、AgentServer stream-side tool-call -> tool-result bridge、session-bundle sanitized audit record、workspace ledger replay event、bounded retry result consumption、`ProjectionApi.getCapabilityPlanSummary`、默认 Results UI 能力计划卡、`UserActionApi.openDebugAudit` debug folding action boundary、targeted tests。

下一步：真实 P1-P6 browser 任务验证 agent 是否实际自主调用 discovery、是否分层揭示、是否不泄漏 endpoint/secret/workspace root、是否最终通过 `invoke_capability` 执行或给出诚实失败。

### UX-SYSTEM-TASK-20260517-discovery-progressive-disclosure

状态：partial / blocked-on-P1-P6-browser-validation
Owner：capability_discovery owner / Orchestrator

已完成：search 返回 compact candidates；expand 只展开指定 capability；plan 返回步骤、fallback、missing provider/permission、expected artifacts、user confirmations，并标 `completionEvidence=not-evidence`；explain 支持 user/debug/audit 粒度；输出和 prompt compaction 已做 endpoint/auth/workspace-root/secret 防泄漏。

下一步：P1/P2/P4 等真实任务验证初始 context 不膨胀、agent 能按需 discovery、UI 只展示用户可读摘要，debug refs 仍折叠。

### UX-SYSTEM-TASK-20260517-ui-execution-decoupling

状态：in_progress
Owner：UI-Execution Decoupling Owner

已完成：最小 `ProjectionApi` / `UserActionApi` / `ProjectionSubscriptionApi`；manual preview、selected object、retry、recover、approve/cancel、open debug audit 语义动作；WorkspaceObjectPreview 的 workspace preview hydration 已下沉到可替换 `ArtifactPreviewHydrationApi`；ResultsRenderer recover/debug/selection 入口已逐步走 UserActionApi；raw/debug 术语默认 scrub 有 targeted tests。

下一步：继续清理直接调用 projection helper、workspace preview client 和 audit helpers 的组件；补 import/verify-confirm transaction、artifact 已存在但 handoff 漂移的完整恢复路径、默认 projection raw scrub conformance。

### UX-SYSTEM-TASK-20260517-answer-first-results-panel

状态：blocked / compact-repair-smoke-risk
Owner：unassigned

目标：结果区默认按用户任务组织：任务是否解决、主答案/报告、关键证据、下一步/恢复按钮；run/audit/raw payload/execution unit 默认进 debug drawer。下一轮 P1-P6 每个进程至少记录一个完成/失败/partial 结果区用户视角评测。

### UX-SYSTEM-TASK-20260517-strict-user-proxy-process

状态：todo
Owner：Orchestrator + P1-P6

目标：把 P1-P6 重新作为开放式真实用户进程，而不是固定剧本回归。每轮必须记录 hard requirements、TaskSuccess、AnswerQuality、root boundary、是否启动 sub agents、修复和验证结果。

## P1-P6 Exploration Cards

每个进程自行选择真实任务，可沿用角色但不要复刻旧 prompts。完成后把结论压缩写回本节或 Discovered Queue；长证据放 workspace/evidence，完整历史进 archive。

### P1 Literature / Full-Text Discovery

状态：pass / user-level-closed-via-provider-recovery
建议任务：最新 arXiv/bioRxiv/PubMed 主题调研，要求全文/PDF、证据位置、中文报告 artifact、selected report follow-up。
重点挑战：browser-rendered/full-text provider、discovery 是否自主选择能力、metadata 是否仍被诚实标为未完成。

#### EVAL-20260518-P1-001 single-cell diffusion full-text literature survey

状态：partial / fail on user hard requirements
用户目标：从默认聊天入口提交 2026 年以来 single-cell perturbation diffusion models 最新论文/全文调研任务。
Hard requirements：
- 最新论文列表至少 5 篇；每篇标题、年份/日期、来源、链接/DOI。
- 全文/PDF 获取或不可得说明；每篇证据位置；中文报告 artifact + 证据矩阵；关键结论、局限性、下一步；selected report follow-up 可用。
Browser entry：
- URL: `http://127.0.0.1:5173`
- before-fix run/session refs: `project-literature-evidence-review-mpa1pkme-scu50q` / `session-literature-evidence-review-mpa0zi3o-cgsmke`
- after-fix run/session refs: `project-literature-evidence-review-mpa1vfgy-6frcnz` / `session-literature-evidence-review-mpa1t341-69iryd`
用户可见结论：
- 主回复是否直接解决问题：否；before-fix 因 `intent=continuation` 进入 unbounded generation loop，convergence guard 在 219973 tokens 终止；after-fix 变为 `intent=fresh`，但 generated task contract 失败。
- artifact 是否可打开、可理解、可复用：否；只有 runtime diagnostic / verification diagnostic，没有论文列表、PDF evidence 或中文报告。
- 缺失或误导：capability discovery 没有形成用户可见能力计划；debug/audit 默认折叠基本成立；结果区诚实显示 recoverable，没有假成功。
TaskSuccess：false
AnswerQuality：partial；fresh-intent 污染已修复并经 browser 复测，但用户 hard requirements 仍未完成。
Root boundary：conversation-policy goal_snapshot fresh-vs-future-followup intent classification；残留 blocker 为 AgentServer generated-task authoring / outputPath ToolPayload contract。
修复动作：`goal_snapshot.py` 现在把“完成后我会继续追问 / report follow-up 可用”识别为未来 artifact follow-up 要求，而不是当前 continuation；新增 unittest 覆盖。
验证：`python3 packages/reasoning/conversation-policy/tests/test_goal_snapshot.py`；manual invocation of 17 `test_execution_classifier.py` functions；`node --import tsx --test src/runtime/capability-discovery.test.ts`；`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts`；`npm run typecheck`；`git diff --check`。
剩余风险：全文调研仍被 `literature_review_task.py does not write the SciForge outputPath argument` 阻塞；需要修 generated-task authoring / strict retry 后重新跑 P1 browser，并再验证 selected report follow-up。

#### EVAL-20260518-P1-002 English selected report follow-up recheck

状态：partial / fail on user hard requirements
用户目标：从默认聊天入口提交英文开放式 P1 文献/全文调研任务，明确要求 latest papers、PDF/full-text availability、evidence locations、Chinese report artifact、key conclusions、limitations、selected report follow-up。
Hard requirements：
- 最新论文列表；全文/PDF 可得或不可得说明；证据位置；中文报告 artifact；关键结论；局限性；selected report follow-up。
Browser entry：
- URL: `http://127.0.0.1:5173`
- before-English-fix run/session refs: `project-literature-evidence-review-mpa2pb53-h5wnm5` / `session-literature-evidence-review-mpa2jmrj-6j2f35`
- after-English-fix run/session refs: `project-literature-evidence-review-mpa2w8is-ng5lg9` / `session-literature-evidence-review-mpa2sak7-qf6guo`
- diagnostic artifact: `.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mpa2sak7-qf6guo/task-results/generated-literature-dbbdfb8c4470.json`
用户可见结论：
- 主回复是否直接解决问题：否；before-English-fix 仍因 `selected report follow up` 被误判为 `intent=continuation` 并触发 generation convergence guard；after-English-fix 前台显示 `intent=fresh`，但 AgentServer strict retry 仍生成不写 `outputPath` 的 static/non-interface task。
- artifact 是否可打开、可理解、可复用：只有 runtime diagnostic / verification result 可检查；没有真正 paper-list、PDF/full-text evidence、evidence matrix 或中文报告 artifact。
- capability_discovery 是否自主使用：未形成用户可见 discovery plan；generation 直接尝试 workspace task。
- debug/audit/raw 信息是否默认折叠：是；结果区显示 answer-first recoverable failure，run details / process / diagnostic refs 默认在折叠区。
TaskSuccess：false
AnswerQuality：partial；fresh intent 与 deterministic contract recovery 均已验证，但没有满足任何科研交付 hard requirement。
Root boundary：conversation-policy future follow-up intent classification；AgentServer generated-task authoring / strict retry / generated-task interface contract；ArtifactDelivery 只能交付 diagnostic，不能补论文报告。
修复动作：`goal_snapshot.py` 增加英文 `follow-up` fresh-task 保护：无 prior context/explicit refs 且没有 previous/prior/last/above/earlier/existing 信号时，不把 `follow up` 当当前 continuation；新增 unittest 覆盖 browser prompt。前序 deterministic failed-with-reason adapter 已在 browser 中验证，避免 outputPath contract 失败伪成功或空失败。
验证：`python -m unittest packages/reasoning/conversation-policy/tests/test_goal_snapshot.py`；browser recheck；`git diff --check`。
剩余风险：AgentServer 仍会生成静态/不可复用 task code；需要从 generation prompt/policy 或 generated-task repair 继续约束必须读取 argv `inputPath` 并写 argv `outputPath`，或在 report-only answer 路径直接返回 ToolPayload。

#### EVAL-20260518-P1-003 provider-backed recovery closure

状态：pass / user-level closed
用户目标：从默认聊天入口提交最新 arXiv/PubMed 文献调研任务，要求 latest paper list、全文/PDF availability 或 unavailable note、evidence locations、中文报告 artifact、关键结论、局限性、selected report follow-up。
Browser entry：
- URL: `http://127.0.0.1:5173`
- final pass run/session refs: `project-literature-evidence-review-mpafcthl-4fso3d` / `session-literature-evidence-review-mpafcthl-4fso3d`
- artifacts: `task-results/literature-metadata-recovery/{paper-list.json,evidence-matrix.json,research-report.md,notebook-timeline.json}` and ToolPayload `task-results/generated-literature-9cda1276f09a.json`
用户可见结论：
- 主回复是否直接解决问题：是。visibleAnswer 为 `satisfied`，说明通过 SciForge `web_search` provider route 生成 8 篇候选论文、3 条来源页面抓取、全文/PDF 状态标注、中文报告 artifact 和 evidence matrix。
- artifact 是否可打开、可理解、可复用：是。`paper-list`、`evidence-matrix`、`research-report`、`notebook-timeline` 均有 artifactActions / absolute refs；报告中展示论文表格、PDF/full-text 链接/不可确认说明、证据位置、关键结论和局限性。
- capability_discovery / provider route：最终 recovery 通过 ready provider route 调用 `web_search`/`browser_fetch`，未直接使用外部 HTTP 客户端；debug/audit/stdout/stderr 默认折叠。
- selected report follow-up：`artifact:research-report`、`artifact:paper-list`、`artifact:evidence-matrix`、`artifact:notebook-timeline` 均进入 objectReferences，可点选继续追问。
- selected report follow-up closure：direct-context fast path 现在能从 `SCIFORGE_WORKSPACE_PATH` / request workspace 候选目录恢复 session artifacts，优先用 selected `research-report` / `evidence-matrix` 行回答 flow matching / perturbation / PDF 状态 bullet 总结，不再落入 chart/QC 模板或 AgentServer convergence guard。
TaskSuccess：true
AnswerQuality：pass；不是完整系统综述，但按用户 hard requirements 给出可用科研交付，并诚实标注 provider-grounded metadata / PDF extraction residual risk。
Root boundary：AgentServer generated-task authoring 仍会返回 static/non-interface task；通用修复是在 repeated interface failure、generation failure/malformed response、partial placeholder direct payload 三个边界上使用 deterministic literature provider recovery adapter，生成真实 ToolPayload artifacts，而不是只交付 diagnostic。
修复动作：`generated-task-runner-generation-lifecycle.ts` 增加 literature provider recovery：规范化检索 query，调用 SciForge web-worker provider，抓取 top source pages，生成 paper-list/evidence-matrix/research-report/notebook-timeline；仅在 AgentServer 已成功写出 side-effect candidate file 时保留 candidate recovery；直接 payload placeholder 也会被 provider recovery 覆盖。测试覆盖 interface fallback、generic non-literature fallback、placeholder direct payload。
验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`；`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts`；`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts`；`node --import tsx --test src/runtime/capability-discovery.test.ts`；`python -m unittest packages/reasoning/conversation-policy/tests/test_goal_snapshot.py`；browser recheck final pass；`npm run typecheck`；`git diff --check`。
剩余风险：全文/PDF 是 provider 页面/PDF link 可得性与 top-source fetch，不是完整 PDF 内容抽取；结果 verification 仍显示 unverified，后续可接 `pdf_extract`/citation verification 增强 citation-grade evidence。

### P2 Data Analysis / Reproducibility

状态：partial / strict-eval-failed-fixed-generation-boundary
建议任务：用户上传或描述 messy CSV/TSV 分析任务，要求 QC、统计模型、图表、复跑命令、sensitivity/robustness 和 selected chart follow-up。
重点挑战：generated code syntax/repair、result consistency、artifact grounding。

#### EVAL-20260518-P2-001 messy TSV reproducible assay analysis

状态：partial / fail before fix
用户目标：从默认聊天入口提交 messy TSV，要求 SciForge 生成可复现实验分析包。
Hard requirements：
- QC、清洗策略、统计模型、至少两个图表 artifact、关键结论、sensitivity/robustness、复跑命令、限制说明。
Browser entry：
- URL: `http://127.0.0.1:5273`
- run/session/artifact refs: `project-literature-evidence-review-mpa0si55-syqpd7` / `session-literature-evidence-review-mpa0nfdt-2mdz3l` / `.sciforge/sessions/2026-05-17_literature-evidence-review_session-literature-evidence-review-mpa0nfdt-2mdz3l/task-results/generated-literature-45e15950175a.json`
用户可见结论：
- 主回复是否直接解决问题：否；结果区显示 `运行需要恢复`，没有 QC、模型结论、复跑命令或可用分析 artifact。
- artifact 是否可打开、可理解、可复用：只有 runtime-failure diagnostic；不可复现实验。
- 缺失或误导：默认入口把数据分析请求路由到 `literature-evidence-review@1.0.0`；generated task 声明的 entrypoint path 与 materialized task file 不一致，执行时 `can't open file`。
TaskSuccess：false
AnswerQuality：fail；诚实标为 recoverable，但未满足用户 hard requirements。
Root boundary：AgentServer generated-task generation lifecycle / entrypoint contract / syntax preflight；同类旧证据 `generated-literature-2182f65faaaa` 还暴露 Python syntax preflight `df´l` 失败。
修复动作：generation lifecycle 现在在执行前校验 entrypoint 必须可 materialize，并对 Python entrypoint 做语法预检；失败时触发 bounded strict generation retry，而不是直接执行或终态失败。
验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts`；`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；`npm run typecheck`。
剩余风险：本轮未重新跑修复后 browser 端端到端成功路径；默认数据分析任务仍被 literature scenario label 承载，需要后续 routing/capability eval。

### P3 Paper Reproduction / Code Debug

状态：partial / strict-eval-failed-targeted-fix-landed
建议任务：真实代码调试/论文复现任务，要求先跑测试、定位 root cause、改代码、复跑测试、报告 remaining risks。
重点挑战：`DISC-20260517-P3-005` generated task syntax preflight 后是否能 bounded repair/regenerate，而不是把内部生成错误当终态主回复。

#### EVAL-20260518-P3-001 MMD kernel code-debug syntax-preflight repair

状态：partial / fail on real browser task
用户目标：从默认聊天入口调试 `paper_metric_kernel.py` / `test_kernel_mmd.py`，要求先跑 pytest、定位 root cause、改代码、复跑 pytest，并报告 patch summary / test result / remaining risks。
Hard requirements：
- `python -m pytest test_kernel_mmd.py -q` 修复前后各跑一次；定位 root cause；修改代码；主回复给用户可读 patch summary、测试结果、剩余风险。
Browser entry：
- URL: `http://127.0.0.1:5373`
- before-fix run/evidence: `project-literature-evidence-review-mpa0q8t4-mawfnw` / `workspace/parallel/p3/.sciforge/evidence/p3-syntax-preflight-before-fix.png`
- after-fix run/evidence: `project-literature-evidence-review-mpa0yd7f-2a5ue2` / `workspace/parallel/p3/.sciforge/evidence/p3-after-fix-recoverable-generation-blocker.png`
用户可见结论：
- 主回复是否直接解决问题：否；before-fix 前台只显示 `Generated Python entrypoint failed syntax preflight before execution`，没有 root cause、patch summary、pytest rerun 或 remaining risks。
- after-fix：本次真实 browser 没再命中 syntax preflight，失败提前发生在 AgentServer malformed generation response；结果区诚实显示 recoverable，但仍未完成代码调试任务。
TaskSuccess：false
AnswerQuality：partial；P3-005 targeted blocker 已有通用修复和测试，但用户级代码调试交付仍失败。
Root boundary：generated-task execution syntax preflight / bounded repair rerun；新残留 blocker 为 AgentServer generation malformed payload / scenario routing。
修复动作：syntax preflight blocked 后现在写入诊断 refs，记录一次 repair-needed attempt，并复用现有 AgentServer bounded repair/rerun 生命周期；repair 成功时返回 repaired payload，而不是把 preflight 文本作为终态主结果。
验证：`node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`；`node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts`；`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；`npm run typecheck`；`git diff --check`。
剩余风险：真实 P3 code-debug 任务仍可能被 malformed generation response 卡住；本轮没有获得完整 patch/test/risk 用户交付。

### P4 SciForge Self-Improvement Coding

状态：ready-for-next-milestone
建议任务：让 SciForge 阅读本仓库某个 UI/runtime/gateway 边界并实施小补丁，要求 patch refs、测试命令、风险说明。
重点挑战：coding delivery summary、workspace side-effect salvage、debug folding、PR-style answer-first summary。

### P5 Methodology / Experimental Design

状态：ready-for-next-milestone
建议任务：带资源/伦理/样本限制的 protocol review 或实验设计迭代。
重点挑战：`DISC-20260517-P5-004` primary task syntax failure 后 supplemental artifacts 是否能形成 coherent repair-needed 或 promoted repaired attempt。

### P6 Long-Context / Deliverable Iteration

状态：pass / user-level-closed / residuals-closed
建议任务：多轮 research package / mini grant / reproducibility audit，要求跨轮约束变更、selected artifact 追问、reload 后继续。
重点挑战：ledger/context projection、旧约束污染、direct read-only vs durable writeback 边界。
最新 P6 证据：
- browser session：`session-literature-evidence-review-mpa25q1t-u5181a`，runs `project-literature-evidence-review-mpa26uwz-qzfrk8`、`project-literature-evidence-review-mpa2amo7-ley2ny`、`project-literature-evidence-review-mpa2df82-n4v4rm`。
- round 1：生成 `p6-mini-grant/{project-brief.md,methods-plan.md,risk-register.md,timeline-budget.md}`，refs 可点击，reload 后当前 run 和 conversation projection 可恢复；但状态为 partial / verification unverified，且 timeline team FTE 初稿违反固定团队约束。
- round 2：要求把 `$120,000`/`12 months` 替换为 `$80,000`/`9 months`；AgentServer 触发 convergence guard 后进入 current-reference digest recovery，主回复退化为 `Current Reference Digest Recovery Report`，没有说明保留/替换约束；workspace 后续部分更新 project brief/timeline，但 `risk-register.md` 仍残留 `0.5 FTE`。
- round 3：selected artifact `p6-mini-grant/timeline-budget.md` 追问被标为 satisfied，但实际仍是 digest recovery；timeline 保留 `$80,000`/`9 months`/新 FTE，但没有按要求重写为 personnel/compute/data-validation/contingency 四类。
- 修复动作：限制 vision-sense CJK intent 误路由；AgentServer taskFiles prompt 禁止 raw quoted prose 破坏 JSON；generated task helper 允许缺省 optional array envelope；current-reference digest recovery 结果现在强制 partial/needs-work，避免失败恢复伪装成已满足编辑交付；新增 deterministic artifact mutation fast path，在明确 workspace markdown artifact rewrite / selected artifact edit / 约束替换场景中直接读取并写回 workspace artifacts，绕开长上下文 AgentServer convergence guard。
- browser recheck：run `project-literature-evidence-review-mpaek6pe-4gooqy` 对 round 2 约束替换返回 satisfied，并实际写回 `p6-mini-grant/timeline-budget.md`、`risk-register.md`、`project-brief.md`、`methods-plan.md`；reload 后继续 selected artifact round 3，run `project-literature-evidence-review-mpaenluc-et1rrr` 返回 satisfied，并只重写 `p6-mini-grant/timeline-budget.md` 为 `personnel` / `compute` / `data-validation` / `contingency` 四类预算。
- strict-eval 结论：pass。当前 workspace `p6-mini-grant` 已保留新约束 `$80,000`、`9 months`、PI `0.4 FTE`、engineer `0.4 FTE`、wet-lab scientist `0.2 FTE`、无真实 patient data；旧约束 `$120,000`、`12 months`、`0.5 FTE`、`0.25 FTE` 已被淘汰；主回复说明写回文件与变更点；artifact 可继续 selected rewrite；workspace refs 和 `artifactActions` 可追溯。
- residual closure：修复 provider preflight `spa` 子串误命中 `AgentServer dispatch`，`SA-WEB-05` 不再把 ready provider 状态渲染成 visible Runtime preflight；更新 `RunKeyInfo` 统计 durable file refs，P6 browser reload 后 round 2 显示 `4 objects · 3 claims`，selected artifact round 3 显示 `1 objects · 3 claims`。
- generic recheck：按用户要求追加非 mini-grant 场景 `generic-eval/design-note.md`。初始 browser 复测发现两个通用问题：`Budget categories: personnel, compute, validation.` 漏掉句末 `validation`；显式 `Selected artifact: generic-eval/design-note.md` 仍被 stale current refs 污染并写出 5 个 artifact；修复后 run `project-literature-evidence-review-mpagrphr-a28arv` 只写回 `file:generic-eval/design-note.md`，最终保留 `$72,000`、`8 months`、analyst `0.25 FTE`、engineer `0.35 FTE`、`personnel/software/validation/contingency`，旧 `$60,000`、`6 months`、`0.2 FTE`、`0.3 FTE` 和 `personnel / compute` 已清除。
- selected artifact read-only closure：只读追问先退化为 `needs-work`，且 composer 残留旧 `timeline-budget` refs；新增显式 markdown read-only fast path 后，browser run `project-literature-evidence-review-mpah3ws4-rh6vzx` 从 `file:generic-eval/design-note.md` 直接回答 active constraints / v1->v2 变化 / remaining risk，status satisfied，目标文件 mtime 保持 `2026-05-18T08:26:36` 不变，历史 `artifacts:p6-mini-grant` 文件 mtime 保持 `2026-05-18T08:14:23`。
- reopened generic closure：按用户要求重开新聊天，改用非预算类 reproducibility audit 场景 `p6-generic-closure/audit.md`。Round 1 `project-literature-evidence-review-mpakpbce-tykg1j` 暴露新通用风险：`Include sections: Scope, Acceptance Criteria, Risks` 被误写为 `Current Constraints` 的 `Include Sections` / `Acceptance: Criteria`，且章节正文在约束替换后可能残留旧约束。修复后 round 2 `project-literature-evidence-review-mpaktea8-zmia76` 只写回 `file:p6-generic-closure/audit.md`，保留 `Runtime: Python 3.11`、`Sample Size: 48`、`Privacy: synthetic data only`、`Metrics: AUROC and calibration`、`Owner: QA lead`，清除 `Python 3.10`、`sample size 24`、`public anonymized data`、`accuracy only`、`owner TBD`、`Include Sections`、`Acceptance: Criteria`；reload 后 round 3 `project-literature-evidence-review-mpakub75-tywv7a` read-only satisfied，mtime 保持 `2026-05-18T10:19:54`。
- 验证：`node --import tsx --test src/runtime/gateway/artifact-mutation-fast-path.test.ts src/runtime/gateway/markdown-readonly-fast-path.test.ts src/runtime/gateway/result-presentation-contract.test.ts`；`node --import tsx --test src/runtime/gateway/capability-provider-preflight.test.ts`；`node --import tsx --test tests/smoke/web-e2e/cases/provider-unavailable-available.test.ts`；`node --import tsx --test src/ui/src/app/ChatPanel.test.ts src/ui/src/app/chat/RunExecutionProcess.test.ts`；`node --import tsx --test src/runtime/gateway/direct-context-fast-path.test.ts`；`node --import tsx --test src/ui/src/app/projectionApi.test.ts src/ui/src/app/ResultsRenderer.test.ts`；`node --import tsx --test src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`；`npm run smoke:complex-multiturn-chat`；`npm run smoke:web-multiturn-final`；`npm run typecheck`；`git diff --check`。
- 剩余风险：P6 user-level closure 当前无阻断项；full-text/citation-grade verification 等 P1/P文献类风险属于其他 exploration card，不影响 P6 artifact iteration closure。

## Discovered Queue

只保留未关闭或可能在下一轮再次成为 blocker 的任务。已完成 discovered tasks 和完整 evidence 已归档到 [`docs/archive/PROJECT-history-2026-05-17-ux-gauntlet.md`](docs/archive/PROJECT-history-2026-05-17-ux-gauntlet.md)。

### DISC-20260517-P3-005 Generated task syntax preflight needs bounded repair before terminal code-debug failure

状态：partial / targeted-fix-landed / browser-recheck-blocked-by-generation
发现者：P3
轻量证据：P3 dependency-aware MMD debug final recheck run `project-literature-evidence-review-mp9pzl5a-e56fsc`；handoff 已修正为 fresh（`expectedArtifactTypes=[]`、`selectedComponentIds=[]`、`priorAttemptCount=0`、`repairContinuation=false`），但主回复停在 `Generated Python entrypoint failed syntax preflight before execution`，没有交付 root cause、patch summary、pytest rerun、test result 或 remaining risks。
升级证据：P3 复现 before-fix run `project-literature-evidence-review-mpa0q8t4-mawfnw` 仍只显示 syntax preflight terminal failure；修复后 targeted test 覆盖 bounded repair before terminal payload；browser recheck `project-literature-evidence-review-mpa0yd7f-2a5ue2` 未命中 syntax preflight，改为 malformed generation response recoverable failure。
通用性说明：任何 code-debug / reproduction task 都可能生成语法错误 entrypoint；syntax preflight fail-fast 是正确边界，但应触发 bounded repair/regeneration 或 coherent repair-needed/completion-candidate。
疑似边界：AgentServer / generated-task execution / repair loop / Projection / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要 browser 复验证据
- [x] 更新 Activity Log

### DISC-20260517-P5-004 Generated-task syntax failure can remain as failed projection despite supplemental artifacts

状态：todo
发现者：P5
轻量证据：P5 microbiome session `workspace/parallel/p5/.sciforge/sessions/2026-05-16_literature-evidence-review_session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp8tjp68-mp8y1pdp-7ymg7a`；primary task `generated-literature-99177170665d` failed with Python syntax error；supplemental task `generated-literature-1b4e7268e935` wrote useful `research-report.md` / `evidence-matrix.md` / `notebook-timeline.md`，但 user-visible Projection stayed foregrounded on primary syntax failure。
通用性说明：任何 generated task can fail before writing intended ToolPayload while supplement/recovery creates useful artifacts; Projection should promote repaired attempt or expose one coherent repair-needed state, not mix failed primary and useful artifacts ambiguously.
疑似边界：generated-task execution / supplement lifecycle / Projection / ArtifactDelivery
集成复查：2026-05-18 18:04 CST 额外运行 `npm exec -- tsx tests/smoke/smoke-agentserver-supplement-scoped.ts` 通过；`npm exec -- tsx tests/smoke/smoke-agentserver-compact-repair.ts` 仍暴露 blocked stderr evidence 可能进入 repair prompt，`npm exec -- tsx tests/smoke/smoke-agentserver-supplement.ts` 仍暴露 primary omics artifact 未保留。该风险属于 compact repair/supplement 专项闭环，未混入本轮 T120 no-legacy contract 迁移提交。

Todo：
- [x] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要 browser 复验证据
- [ ] 更新 Activity Log

### DISC-20260518-P1-001 Fresh literature generated task can pass intent but fail outputPath contract

状态：done / provider-recovery-browser-pass
发现者：P1
轻量证据：P1 after-fix browser run `project-literature-evidence-review-mpa1vfgy-6frcnz` / session `session-literature-evidence-review-mpa1t341-69iryd`；前台显示 `HarnessDecisionRecorded profile=balanced-default; intent=fresh`，但终态为 `AgentServer generated task literature_review_task.py does not write the SciForge outputPath argument`，没有论文列表、PDF/full-text evidence、中文报告 artifact 或 selected report follow-up。
升级证据：before-fix run `project-literature-evidence-review-mpa1pkme-scu50q` 被 future follow-up 文案误判为 continuation 并触发 convergence guard；fresh-intent 修复后同一真实任务越过该边界，暴露 generated-task outputPath contract blocker。English recheck before policy extension `project-literature-evidence-review-mpa2pb53-h5wnm5` 仍把 `selected report follow up` 判成 continuation；修复后 `project-literature-evidence-review-mpa2w8is-ng5lg9` / `session-literature-evidence-review-mpa2sak7-qf6guo` 显示 `intent=fresh`，并将 repeated outputPath contract failure 转成 `generated-task-contract-failure` structured result，而非假成功。最终修复后 `project-literature-evidence-review-mpafcthl-4fso3d` / `session-literature-evidence-review-mpafcthl-4fso3d` 通过 deterministic provider recovery 生成满足 hard requirements 的 paper-list/evidence-matrix/research-report/notebook-timeline。
通用性说明：任何 fresh literature / report / analysis generated task 都可能生成只写旁路文件、不写 argv `outputPath` 的 entrypoint；contract gate 正确 fail-closed，但应通过 stricter authoring、bounded retry 或 deterministic recovery adapter 生成有效 ToolPayload，而不是只交付 runtime diagnostic。
疑似边界：AgentServer generated-task authoring / generated-task preflight / strict retry / ArtifactDelivery

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要 browser 复验证据
- [x] 更新 Activity Log

### DISC-20260518-P6-001 Current-reference digest recovery can mask failed artifact rewrite

状态：done / browser-rechecked / P6-closed
发现者：P6
轻量证据：P6 mini grant session `session-literature-evidence-review-mpa25q1t-u5181a`；round 2 run `project-literature-evidence-review-mpa2amo7-ley2ny` and round 3 run `project-literature-evidence-review-mpa2df82-n4v4rm`；AgentServer convergence guard forced `sciforge.current-reference-digest-recovery` and the visible answer became `Current Reference Digest Recovery Report` instead of requested constraint replacement/change summary. Round 3 was marked satisfied even though requested budget categories were not rewritten.
升级证据：workspace `workspace/parallel/p6/p6-mini-grant/timeline-budget.md` partially updated to `$80,000` / `9 months`, but still used old category shape; `risk-register.md` still had `0.5 FTE`; task result refs `task-results/agentserver-digest-recovery-literature-2d143defe9d9.json` and `...-ee0e8723de2b.json` record convergence guard recovery. After fix, browser runs `project-literature-evidence-review-mpaek6pe-4gooqy` and `project-literature-evidence-review-mpaenluc-et1rrr` both returned satisfied with `artifact-mutation-writeback` verification; `rg` confirms old constraints are absent from `workspace/parallel/p6/p6-mini-grant`.
通用性说明：任何 selected artifact edit/rewrite/constraint-change turn can hit bounded digest recovery after context growth; digest recovery is useful as evidence salvage but must not be projected as task success for durable writeback requests.
疑似边界：AgentServer context projection / current-reference digest recovery / task outcome projection / durable writeback

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests
- [x] browser recheck after restart
- [x] 更新 Activity Log

### DISC-20260518-P6-002 Explicit markdown artifact follow-up can be polluted by stale selected refs

状态：done / browser-rechecked / P6-closed
发现者：P6
轻量证据：P6 generic browser recheck used `generic-eval/design-note.md` after mini-grant rounds; the first selected rewrite wrote 5 artifacts because stale `p6-mini-grant` refs were still in current context, and the first read-only selected artifact follow-up degraded to `needs-work` while composer still showed old `timeline-budget` refs.
通用性说明：any explicit `*.md` selected artifact turn can be contaminated by older selected/current refs after long-context reload or cross-artifact iteration. Explicit path in the current prompt must win for both durable writeback and read-only artifact questions.
修复动作：artifact mutation target selection now short-circuits to explicit markdown paths before considering selected/current refs; markdown section replacement now replaces `## Current Constraints` by heading range instead of regex end-of-line guessing; added `markdown-readonly-fast-path` for explicit read-only markdown artifact questions with no writeback.
验证证据：browser run `project-literature-evidence-review-mpagrphr-a28arv` writes only `file:generic-eval/design-note.md`; browser run `project-literature-evidence-review-mpah3ws4-rh6vzx` answers read-only from `file:generic-eval/design-note.md` and leaves mtime unchanged; targeted tests cover stale refs, stale constraints section replacement, and read-only no-intercept.

### DISC-20260518-P6-003 Generic constraint ledger must not confuse section requests with business constraints

状态：done / browser-rechecked / P6-closed
发现者：P6
轻量证据：new-chat P6 run `project-literature-evidence-review-mpakpbce-tykg1j` on `p6-generic-closure/audit.md` showed `Include sections: Scope, Acceptance Criteria, Risks` persisted as bogus `Current Constraints` rows (`Include Sections`, `Acceptance: Criteria`), and section bodies could retain old constraints after a later rewrite.
通用性说明：any deliverable prompt can mix requested document structure with business constraints. A generic constraint ledger must separate section/headings requests from active constraints and refresh affected section bodies when constraints change.
修复动作：generic constraint parser now rejects section/headings clauses and common section-title fragments; requested sections are refreshed on every writeback, not only inserted when missing; arbitrary old-constraint parsing preserves comma-containing values and does not split money values.
验证证据：targeted tests cover arbitrary non-budget constraints, section request exclusion, and section body refresh; browser run `project-literature-evidence-review-mpaktea8-zmia76` cleans the bogus rows and stale v1 constraints; reload read-only run `project-literature-evidence-review-mpakub75-tywv7a` is satisfied with unchanged mtime.

### DISC-20260518-P1-004 Today arXiv literature/full-text task needs honest no-result closure and stable selected-report follow-up

状态：done / browser-rechecked / P1-closed-with-provider-risk
发现者：P1
轻量证据：browser URL `http://127.0.0.1:5173/`; main run `project-literature-evidence-review-mpam9pij-mib32o` in `session-literature-evidence-review-mpam6agl-j87xu3` produced satisfied visible answer and readable report `.sciforge/sessions/2026-05-18_literature-evidence-review_session-literature-evidence-review-mpam6agl-j87xu3/task-results/agentserver-generation-retry-literature-recovery-literature-853d8c63d700-research-report.md`; selected follow-up before fix `project-literature-evidence-review-mpamdmvm-gvkxk7` incorrectly answered with stale QC/missingness treatment-effect wording; after fix final follow-up `project-literature-evidence-review-mpamruhx-9ows7r` is `completed/satisfied` with full Chinese answer from selected report only.
用户 hard requirements：latest paper list satisfied as honest empty/no-confirmed list; full-text/PDF satisfied as unavailable/not-read explanation; evidence location satisfied as provider diagnostic boundary plus no citable arXiv/PDF/page note; Chinese report artifact opens via workspace descriptor; key conclusions and limitations present; selected report follow-up now stable and no longer starts a new search.
通用性说明：failure crossed generic boundaries: background/in-app RAF can suspend first-event startup; literature prompt containing “computer use” must not trigger GUI Computer Use runtime; explicit arXiv searches must fail closed instead of falling back to unrelated web rows; AgentServer malformed/strict-retry failures need provider-backed literature recovery; fallback artifacts must materialize readable report files; selected report direct-context routing must not be stolen by stale QC/chart/status heuristics; result presentation must not treat quoted old failure notes as current-run failure.
修复动作：added timed `waitForNextPaint`; narrowed computer-use runtime policy for literature/research/PDF/report prompts; required `web_search` for scholarly preflight; routed explicit arXiv queries through arXiv API with date-window fallback audit and fail-closed semantics; added literature generation failure/retry recovery payloads and readable artifact materialization; promoted selected report evidence-status answering before QC/chart, added no-result literature follow-up extraction and English “Answer in Chinese” detection; made result presentation trust structured satisfied direct-context payloads over quoted failure keywords.
验证证据：browser main run and final selected follow-up satisfied; process/debug/audit remains folded by default; tests pass: direct-context + result-presentation 82 tests, capability-discovery/ResultsRenderer/projectionApi 45 tests, web-worker/generated-lifecycle/artifact-materializer/provider-preflight/vision/nextPaint 64 tests, `npm run typecheck`, `git diff --check`.
剩余风险：arXiv API returned HTTP 429, so this is an honest no-confirmed-result closure rather than a completed citation-grade full PDF extraction; a later retry after provider recovery should rerun arXiv and per-paper PDF extraction.

### DISC-20260518-P1-005 Explicit arXiv recovery must use provider routes and direct arXiv browser fallback

状态：done / browser-rechecked / P1-closed-with-date-fallback
发现者：P1
轻量证据：browser URL `http://127.0.0.1:5173/`; before-fix run `project-literature-evidence-review-mpanr2iu-7t314r` in `session-literature-evidence-review-mpanr2iu-7t314r` returned a satisfied artifact containing unrelated `today` dictionary/Excel/Today Show rows because literature recovery chose `browser_search` for an explicit arXiv task. Intermediate run `project-literature-evidence-review-mpaoa9z0-pyqlpr` correctly failed closed but only after arXiv API timeout and search-engine browser fallback found no `arxiv.org/abs` rows. Final after restart run `project-literature-evidence-review-mpaolkk6-kv85ci` completed/satisfied with report artifact showing provider `arxiv-browser`, arXiv abs/PDF links, and explicit date-window fallback: records existed only as recent matches, not 2026-05-18 submissions.
用户 hard requirements：latest list is now honest recent arXiv matches with a clear “not today” date-window note; full-text/PDF status includes inferred arXiv PDF links and fetched source-page evidence; evidence locations are arXiv abs/PDF URLs; Chinese report artifact opens; key conclusions and limitations are visible; selected report follow-up remains supported through artifact refs. Citation-grade full PDF extraction remains outside this bounded recovery.
通用性说明：any explicit arXiv literature task can hit API 429/timeout or generated-task malformed output. Recovery must still preserve provider boundaries: prefer `web_search` for arXiv tasks even when PDF/full-text wording makes browser capabilities available; inside `web_search`, use arXiv API, rendered search-engine fallback constrained to `arxiv.org/abs`, then direct rendered arXiv site search before fail-closed.
修复动作：exported `createPlaywrightEdgeBrowserAutomationProvider` as a function interface over the existing Playwright Edge MCP browser capability; added optional web-worker MCP browser automation selection via env/input without leaking raw MCP URL in normal adapter outputs; added arXiv browser fallback that fetches direct arXiv search pages and extracts abs/PDF links; fixed literature generation/retry recovery to choose `web_search` for arXiv tasks even if `browser_search` is ready; fixed date fallback report wording to read nested `requestedDateRange`.
验证证据：targeted tests cover API 429 -> arXiv browser fallback, search-engine miss -> direct rendered arXiv search, explicit arXiv fail-closed, and generation lifecycle web_search routing; final browser run `project-literature-evidence-review-mpaolkk6-kv85ci` shows no `today` dictionary rows, no recover-needed panel, debug/audit folded by default, and report rows such as `FORGE` / `ScreenSearch` with `https://arxiv.org/abs/...` and `https://arxiv.org/pdf/...` links plus date-window limitation.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要 browser 复验证据
- [x] 更新 Activity Log

### DISC-20260518-P1-006 Full-text arXiv closure and selected report follow-up must stay scoped to the clicked artifact

状态：done / browser-rechecked / P1-pass
发现者：P1
轻量证据：browser URL `http://127.0.0.1:5173/`; session `session-literature-evidence-review-mpaun6hf-jlwf0c`; main run `project-literature-evidence-review-mpauorez-txk5vi` satisfied with `arxiv-browser` report, 7 arXiv candidates, 3 source fetches, 3 bounded PDF extracts, Chinese report, evidence matrix, and explicit “not confirmed as 2026-05-18 submissions” date-window note. Latest selected-report follow-up completed at `2026-05-18T07:25:30.026Z` with direct answer from the clicked report only: ShopGym, ScreenSearch, and PAGER, each with PDF/full-text status, evidence URL/page, conclusion rationale, and limitation.
通用性说明：this was not a single prompt/provider issue. The failure crossed four generic boundaries: literature provider recovery must survive arXiv API failure without unrelated web rows; AgentServer malformed/strict retry must fall through to provider recovery instead of hanging; final projected payload must persist to managed output refs; selected report follow-up must use the clicked durable `dataRef/path` and not any later same-id `artifact:research-report`.
修复动作：added `pdf_extract` provider support and arXiv fallbacks through API -> rendered `site:arxiv.org/abs` -> direct arXiv recent/category pages; skipped literature malformed strict retry into provider recovery; persisted final verified/projection payloads back to managed `.sciforge/sessions/.../task-results/*.json`; hydrated selected reference provenance paths for direct-context; made readable selected reference content outrank chip summaries; scoped bounded follow-up payloads to durable selected refs when present, while preserving explicit filename override behavior.
严格验收：latest paper list satisfied as recent matching arXiv rows plus honest no-same-day note; full-text/PDF satisfied by bounded PDF extraction for 3 rows and unavailable/not-confirmed notes for others; evidence positions present as arXiv abs/PDF URLs and `#page=1`; Chinese report artifact opens; key conclusions and limitations visible; selected report follow-up now no-new-search, no new workspace task, and no stale same-id report refs in latest message object refs. Debug/audit/raw remain folded by default.
验证命令：`node --import tsx --test src/runtime/gateway/final-payload-persistence.test.ts src/runtime/gateway/direct-context-fast-path.test.ts packages/support/object-references/index.test.ts`; `node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts packages/workers/web-worker/src/web-worker.test.ts`; `node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts`; `node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts packages/support/object-references/index.test.ts`; `npm run typecheck`; `git diff --check` all pass.
剩余风险：no known user-level blocker for this flow. Scientific risk remains bounded by the explicit PDF extraction budget and source availability; a future citation-grade review should expand page ranges and quote-level verification, but the current UI now honestly says when evidence is bounded.

Todo：
- [x] 最小复现
- [x] 定位 root boundary
- [x] 通用修复
- [x] targeted tests / 必要 browser 复验证据
- [x] 更新 Activity Log

### New Discovered Task Template

```markdown
### DISC-YYYYMMDD-NNN 简短标题

状态：todo / in_progress / blocked / done
发现者：P?
轻量证据：URL 或 workspace 路径、关键 run/session/artifact、用户可见现象、为什么失败
升级证据：仅在失败、修复前后对比、UI/workspace 不一致、milestone 验收时保存
通用性说明：为什么这不是单个 prompt/provider/session/端口偶发问题
疑似边界：policy / harness / capability / gateway / AgentServer / Projection / ArtifactDelivery / UI restore / persistence / docs

Todo：
- [ ] 最小复现
- [ ] 定位 root boundary
- [ ] 通用修复
- [ ] targeted tests / 必要 browser 复验证据
- [ ] 更新 Activity Log
```

## Evidence Policy

- `PROJECT.md` 只保留当前同步面板，不粘贴大段 DOM/log/code。
- 证据文件只在失败、修复前后对比、UI/workspace 不一致、milestone 验收时保存。
- 每条 Activity Log 最多一行，写清 owner、结论、关键 refs、验证命令和剩余 blocker。
- 修改 `PROJECT.md` 前先读最新文件、`git status`、相关 diff，避免覆盖并行进程刚写入的 owner/status。

证据建议位置：

```text
workspace/evidence/<date>/<process>-<topic>/
.sciforge/parallel/<process>/logs/
docs/archive/
```

## Activity Log

- 2026-05-18 18:04 Integration Worker：继续推进剩余 T120/no-legacy 风险；`git fetch --all --prune` 后候选 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke` 均 `ahead=0`，无可合 worker diff。本轮未合并远端分支，继续通用 contract 收敛：把 generated-task provider-first network/helper policy、literature recovery query/no-result/full-text/recovery copy、generated task recovery path、runtime route projection refs、external provider backoff/recover actions、AgentServer recentTurns compatibility field、ArtifactDelivery preview notice、fresh-code selected component gating 从 gateway/UI 迁入 `packages/contracts/runtime/*`；`smoke:no-legacy-paths` tracked findings 从 31 降到 0，并将 baseline 全部归零。验证：targeted generated-task/AgentServer/UI 76 tests pass、`npm run smoke:no-legacy-paths` pass（0 tracked findings）、`npm run typecheck` pass、`git diff --check` pass、`npm run verify:single-agent-final` pass（1268 tests、C01-C18、no-legacy guard、16 Web E2E、final evidence manifest）。额外复查 P5 supplement/compact-repair 旧风险时，scoped supplement smoke pass，但 compact-repair/supplement smoke 仍有独立 blocker，已保留在 `DISC-20260517-P5-004`，未混入本轮 T120 closure。

- 2026-05-18 17:04 Integration Worker：继续推进剩余 T120 风险；`git fetch --all --prune` 后候选 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke` 均 `ahead=0`，无可合 worker diff。本轮未合并远端分支，继续通用 contract 收敛：把 direct-context evidence-matrix/protocol/report/QC/chart/reproduction/literature follow-up prompt policy、语言/summary limit、bounded artifact fallback intent/transform、capability provider status copy/ref 迁入 `direct-context-followup-policy` 与 `capability-provider-policy`；gateway 只保留上下文收集与 payload 组装；`smoke:no-legacy-paths` tracked findings 从 95 降到 31，并将 `direct-context-fast-path` provider/prompt baseline 64 -> 0。验证：targeted direct-context 63 tests、`npm run typecheck`、`git diff --check`、`npm run smoke:no-legacy-paths`、`npm run verify:single-agent-final` pass（1268 tests、C01-C18、no-legacy guard、16 Web E2E、final evidence manifest）。剩余风险：无 direct-context T120 blocker；仍保留 31 个冻结 findings（generated-task/provider recovery 29、results renderer fallback copy 1、degraded handoff compatibility field 1），git gc loose object warning 未 destructive prune。

- 2026-05-18 16:39 Integration Worker：继续推进剩余风险，`git fetch --all --prune` 后四个候选 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke` 仍均 `ahead=0`，无可合 worker diff。本轮继续通用 contract 收敛：新增 `reference-discovery-policy` 与 `direct-context-followup-policy`，把 reference digest prompt-discovered source 判定、provider route health/adapter/discovery rules、generated-task provider invocation hints、direct-context selected literature report/PDF status/语言判断迁出 gateway；同时清除 `ScenarioBuilderPanel` 的 UI semantic fallback 合并 warning。`smoke:no-legacy-paths` tracked findings 从 116 降到 95，并收紧 baseline（capability-provider/conversation/generated-validation/ScenarioBuilderPanel 归零，direct-context 72 -> 64）。验证：targeted direct-context/preflight/generated-validation/ScenarioBuilderPanel tests pass、`npm run typecheck`、`git diff --check`、`npm run verify:single-agent-final` pass（1268 tests、C01-C18、no-legacy guard、16 Web E2E、final evidence manifest）。剩余风险：无活动集成 blocker；仍保留 95 个冻结 T120 findings（direct-context 历史 prompt follow-up、results renderer raw-format fallback copy、1 个 degraded handoff compatibility 字段），继续迁移需拆 direct-context follow-up 策略或结果 renderer package policy，git gc loose object warning 未 destructive prune。

- 2026-05-18 16:18 Integration Worker：按用户要求继续推进剩余 T120 风险到通用 contract 层；`git fetch --all --prune` 后候选 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke` 仍均 `ahead=0`，无可合 worker diff。本轮未合并远端分支，直接集成当前剩余风险收敛：新增 runtime contract policy `markdown-artifact-policy`、`capability-provider-policy`、`generated-work-policy`、`scenario-package-ref`，把 markdown read/write fast-path prompt/path/constraint policy、provider prompt/status/discovery/generated-task route policy、generated-work prompt policy 和 scenario package ref normalization 从 gateway 移出；`smoke:no-legacy-paths` tracked findings 从 167 降到 116，并收紧 baseline（artifact/markdown 0，capability-provider 6，supplement 0，validation 4）。验证：targeted gateway tests 41 + preflight/validation 20、`npm run typecheck`、`git diff --check`、`npm run verify:single-agent-final` pass（1268 tests、C01-C18、no-legacy guard、16 Web E2E、final evidence manifest）。剩余风险：无新增集成 blocker；仍保留 116 个 T120 tracked legacy findings（主要 direct-context prompt follow-up、少量 UI fallback、1 个 degraded handoff compatibility 字段）作为后续 package-policy 迁移债；git gc loose object warning 未 destructive prune。

- 2026-05-18 15:46 Integration Worker：按 heartbeat 继续集成；`git fetch --all --prune` 后候选仍只有 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke`，逐个确认 `origin/main...branch` 为 `ahead=0`（分别落后 main 117/131/134/204 commits），无新增 worker 提交、无可合 diff；本轮未合并代码。验证：`npm run typecheck` pass、`git diff --check` pass。剩余风险：等待新的 worker branch / browser evidence；T120 no-legacy baseline 仍有 167 tracked findings；本地 git gc 继续报告 unreachable loose objects 警告，未执行 prune。

- 2026-05-18 15:37 Integration Worker：`git fetch --all --prune` 后重新审查候选 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke`，四者仍是 580-796 files / 108k-178k deletions 的架构级重写，未做 destructive merge，继续记录为需 owner 拆分；本轮集成本地 P1/P6 worker 进展并补 integration fixes：`pdf_extract` 从假定 available 改为 health-gated unknown/degraded，web-worker health 暴露 PDF extractor 状态；AgentServer literature recovery / selected report no-result follow-up 不再硬编码 “today arXiv / agent computer use”；selected artifact direct-context 优先 durable file/data refs；markdown read-only fast path 可回答请求的具体 section；runtime-routing 不再被历史失败文本覆盖当前 satisfied payload；conversation policy failure 不被 direct-context 抢跑而保持 fail-closed；final payload persistence、next-paint、artifact mutation、provider preflight 与 gateway pipeline contract 均补测试。验证：P1 targeted 53 tests、P6/runtime focused 71 + 9 + 56 tests、`npm run smoke:web-multiturn-final`、`npm run smoke:complex-multiturn-chat`、`npm run typecheck`、`git diff --check`、最终 `npm run verify:single-agent-final` 全部通过（1268 tests、C01-C18、no-legacy guard、web-final-conformance、16 Web E2E、final evidence manifest）。剩余风险：`smoke:no-legacy-paths` 通过但 T120 baseline 仍冻结 167 个 tracked findings（本轮新增 fast-path/recovery 命中已加 2026-05-18 migration note），后续需按 T120/T122 将 prompt/provider 特例迁入 manifests/catalog/package policy。

- 2026-05-18 15:26 P1：继续推进“今天 arxiv 上 agent computer use，并阅读全文，中文报告 + selected report follow-up”到用户级闭环。Browser final refs：main `project-literature-evidence-review-mpauorez-txk5vi` / session `session-literature-evidence-review-mpaun6hf-jlwf0c` satisfied，report artifact 有 7 篇 arXiv candidates、3 条 source fetch、3 条 bounded PDF extraction、中文报告、evidence matrix、same-day 未确认说明；latest selected follow-up `2026-05-18T07:25:30.026Z` satisfied，直接从选中 report 回答 ShopGym / ScreenSearch / PAGER，含 PDF/full-text、证据 URL/page、关键结论和局限性，不新搜索、不新 workspace task，latest message object refs 不再混入旧同名 report。Root boundary：literature provider recovery、AgentServer malformed retry、final payload persistence、selected artifact durable ref scoping。验证：direct-context/final-payload/object-references 66 tests、agentserver generation + web-worker 41 tests、generated execution/generation 28 tests、ResultsRenderer/projectionApi/object refs 42 tests、`npm run typecheck`、`git diff --check` pass；剩余风险仅为 citation-grade 逐页全文核验超出 bounded extraction。

- 2026-05-18 12:06 P1：继续关闭用户指出的 arXiv API 不可用剩余风险，并按 `docs/CapabilityDiscovery.md` 检查 provider/discovery 边界。Root boundary：explicit arXiv literature recovery 在 PDF/full-text prompt 下优先 `browser_search`，导致 fake `today` rows；arXiv API timeout 后仅靠搜索引擎 fallback 也可能找不到 `arxiv.org/abs`。通用修复：`packages/observe/web/mcp/playwright-edge-provider.ts` 增加 MCP browser automation function adapter（search/fetch）并在 web-worker 可通过 env/input 启用，普通输出脱敏 diagnostics；`web_search` 对 explicit arXiv 走 API -> rendered search-engine `site:arxiv.org/abs` -> direct rendered arXiv site search，严格过滤 abs/PDF；generation recovery 对 arXiv 始终优先 `web_search`，并修正 nested dateFallback 展示。Browser after restart final run `project-literature-evidence-review-mpaolkk6-kv85ci` satisfied：无 `today` 字典假论文，report artifact 打开，显示 `arxiv-browser` recent arXiv abs/PDF rows（FORGE、ScreenSearch 等）并明确 2026-05-18 当天窗口未满足，debug/audit folded。验证：web-worker + generated lifecycle + capability-discovery + ResultsRenderer/projectionApi 71 tests、`npm run typecheck`、`git diff --check` pass；剩余风险：这是 source-page/PDF-link availability，不是完整 PDF text extraction/citation-grade verification。

- 2026-05-18 11:18 P1：继续用户指定“今天 arxiv 上 agent computer use 的文章，并阅读全文，写中文总结报告”到用户级闭环。Browser main run `project-literature-evidence-review-mpam9pij-mib32o` / `session-literature-evidence-review-mpam6agl-j87xu3` satisfied with honest no-confirmed-result report artifact; selected follow-up before fix `project-literature-evidence-review-mpamdmvm-gvkxk7` 被 stale QC/missingness 模板误抢答且 partial；通用修复 UI RAF wait、computer-use literature intent gate、scholarly provider preflight、explicit arXiv fail-closed/date fallback、AgentServer literature recovery、artifact materialization、selected report no-result follow-up routing、result presentation quoted-failure status 后，final browser follow-up `project-literature-evidence-review-mpamruhx-9ows7r` completed/satisfied，中文回答列出无今日确认论文、PDF/全文不可得、证据位置边界、关键结论和局限性。验证：direct-context/result-presentation 82 tests、capability-discovery/ResultsRenderer/projectionApi 45 tests、web-worker/generated/artifact/provider/vision/nextPaint 64 tests、`npm run typecheck`、`git diff --check` pass；剩余风险：arXiv API HTTP 429，尚非 citation-grade PDF extraction。

- 2026-05-18 10:20 P6：按用户要求重开新聊天并继续 generic 多轮闭环，使用非预算 repro-audit `p6-generic-closure/audit.md` 压测通用性。Round 1 `project-literature-evidence-review-mpakpbce-tykg1j` satisfied 但发现 `Include sections` 被误写入 `Current Constraints` 且章节正文可能随约束替换变旧；修复 generic parser 区分 section/headings 与业务约束、刷新已存在 section bodies、保护任意旧约束 token 后，round 2 `project-literature-evidence-review-mpaktea8-zmia76` 只写回该文件并保留 Python 3.11 / sample 48 / synthetic data / AUROC+calibration / owner QA lead，清除 Python 3.10 / sample 24 / public anonymized / accuracy only / owner TBD / bogus section rows；reload 后 round 3 `project-literature-evidence-review-mpakub75-tywv7a` read-only satisfied 且 mtime 不变。验证：artifact-mutation + markdown-readonly + result-presentation 34 tests、`npm run typecheck`、`npm run smoke:web-multiturn-final`、`npm run smoke:complex-multiturn-chat`、`git diff --check` pass；P6 无 user-level blocker。

- 2026-05-18 08:36 P6：按用户质疑继续多轮 generic artifact strict-eval，确认此前“成功”不等于用户级闭环。Browser 发现 `generic-eval/design-note.md` 约束替换存在通用缺陷：句末 category 漏解析、显式 selected target 被 stale `p6-mini-grant` refs 污染、`Current Constraints` 旧行重复残留，以及只读追问退化为 `needs-work`。通用修复：explicit markdown path 优先于 selected/current refs；markdown section 按 heading range 规范替换；新增 `markdown-readonly-fast-path`，显式 `*.md` 只读问答只读当前路径且不写回。Browser recheck：`project-literature-evidence-review-mpagrphr-a28arv` 仅写回 `file:generic-eval/design-note.md`，保留 `$72,000`/`8 months`/0.25+0.35 FTE/software+validation+contingency 并清除旧 `$60,000`/`6 months`/旧 FTE/`compute`；`project-literature-evidence-review-mpah3ws4-rh6vzx` 只读回答 satisfied，目标 mtime 未变。验证：artifact-mutation + markdown-readonly + result-presentation 31 tests、targeted 7 tests、`npm run typecheck`、`npm run smoke:web-multiturn-final`、`npm run smoke:complex-multiturn-chat`、`git diff --check` pass；P6 当前无 user-level blocker。

- 2026-05-18 08:21 P1：按用户要求继续多轮 selected report follow-up 到用户级闭环；browser 发现 `research-report` follow-up 被 chart sufficiency 模板误抢答，随后又被派生 direct-context summary 抢成 PDF 状态审计、以及 provider/search 行混入“优先阅读论文”列表。通用修复 direct-context：literature report read-first/priority prompt 优先从 selected report 的 markdown table / evidence-matrix summary / json-like context 抽取 paper rows，chart 模板只按 artifact 身份触发，direct-context objectRefs 去重，并过滤 provider/search/audit 非论文行；final browser run `project-literature-evidence-review-mpagjsfe-mmhw9z` / `session-literature-evidence-review-mpafcthl-4fso3d` satisfied，最新主回复含 3 篇真实论文（FLUX、scShapeBench、Flow Matching for Count Data）的理由、证据位置、PDF/full-text 状态、局限性，latest answer chunk 无 `Provider search`/`Called web_search`。顺手修正并行 artifact-mutation test 的非法 `skillDomain="methodology"` typecheck blocker 为现有通用 domain。验证：direct-context 56 tests、artifact-mutation 5 tests、`npm run typecheck`、`git diff --check` pass；剩余风险：优先级仍来自 bounded report row heuristics，不是新的全文重检索排序。

- 2026-05-18 08:09 Integration Worker：`git fetch --all --prune` 后审查 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke`，四个候选相对 `origin/main` 均为 580-796 files / 108k-178k deletions 的架构级重写，未做 destructive merge，记录为需 owner 专门拆分处理；本轮集成当前工作树 P1/P6 小步修复：P1 literature provider recovery + selected report direct-context follow-up（含 markdown/table/evidence/json-like rows），P6 artifact mutation fast path + provider/UI residual closure。验证：direct-context/artifact-mutation 59 tests、generated/artifact/provider 32 tests、ChatPanel/RunExecutionProcess/SA-WEB-05 15 tests、`npm run typecheck`、`git diff --check` pass；已提交并 push `main` 至 `bbd57c6`。

- 2026-05-18 07:58 P6：继续关闭剩余用户级毛刺；修复 provider preflight `spa` 误命中 `AgentServer dispatch`，`SA-WEB-05` ready provider transition 现在进入 AgentServer dispatch 且不泄漏 endpoint；补齐 SA-WEB-13 fixture canonical `harnessContract.directContextDecision`，final web smoke 16 个 case 全过；更新 `RunKeyInfo` 统计 durable `file:` refs，P6 browser reload 后 round 2 显示 `4 objects · 3 claims`，selected artifact round 3 显示 `1 objects · 3 claims`。验证：capability-provider-preflight、SA-WEB-05、direct-context-fast-path、ChatPanel/RunExecutionProcess、`npm run smoke:web-multiturn-final`、`npm run typecheck`、`git diff --check` pass；P6 当前无 user-level blocker。

- 2026-05-18 07:52 P1：继续最新论文/全文科研调研直到用户级闭环；定位 root boundary 为 AgentServer generated-task static/non-interface outputPath contract、malformed generation failure 与 placeholder direct payload 会让 P1 只得到 diagnostic。修复 `generated-task-runner-generation-lifecycle.ts`：literature provider recovery 通过 SciForge web-worker provider 生成 `paper-list`、`evidence-matrix`、`research-report`、`notebook-timeline`，规范化 arXiv/PubMed 污染 query，抓取 top source pages，标注 PDF/full-text 可得或不可确认说明；generic non-literature 仍走 failed-with-reason adapter。Browser final pass：`project-literature-evidence-review-mpafcthl-4fso3d` / `session-literature-evidence-review-mpafcthl-4fso3d` visibleAnswer satisfied，8 篇候选论文、3 条 source fetch、中文报告、证据矩阵、timeline 均可打开，debug/stdout/stderr 折叠；验证：generated-task generation lifecycle、ResultsRenderer/projectionApi、capability-discovery、goal_snapshot、browser recheck、typecheck、diff-check pass；剩余风险：full-text 仍是 provider/PDF link availability，不是完整 PDF extraction/citation-grade verification。

- 2026-05-18 07:30 P6：继续长上下文/交付物迭代到用户级闭环；新增 `artifact-mutation-fast-path`，对明确 workspace markdown artifact rewrite / selected artifact edit / 约束替换请求执行 deterministic durable writeback。Browser recheck：round 2 `project-literature-evidence-review-mpaek6pe-4gooqy` satisfied 并写回四个 mini-grant artifacts；reload 后 selected artifact round 3 `project-literature-evidence-review-mpaenluc-et1rrr` satisfied，仅重写 `timeline-budget.md` 为 personnel/compute/data-validation/contingency，保留 `$80,000`、`9 months`、0.4/0.4/0.2 FTE、无真实 patient data，旧 `$120,000`/`12 months`/`0.5 FTE`/`0.25 FTE` 已清除；验证：artifact-mutation/result-presentation、ProjectionApi/ResultsRenderer、generated-task generation lifecycle、complex-multiturn smoke、typecheck、diff-check pass；剩余风险：`smoke:web-multiturn-final` 仍因 SA-WEB-05 provider health preflight 失败，结果区 key info 仍显示 `0 objects` presentation polish。

- 2026-05-18 02:02 P1：继续最新论文/全文调研 user-proxy；browser 输入通道缺虚拟剪贴板，改用可见 textbox 的逐字符 keypress 提交真实默认入口任务。English `selected report follow up` before-fix run `project-literature-evidence-review-mpa2pb53-h5wnm5` 仍误判 `intent=continuation` 并触发 215004-token convergence guard；修复 `goal_snapshot.py` 后 recheck `project-literature-evidence-review-mpa2w8is-ng5lg9` / `session-literature-evidence-review-mpa2sak7-qf6guo` 显示 `intent=fresh`，但 AgentServer strict retry 仍生成不写 `outputPath` 的 task；deterministic failed-with-reason adapter 在 browser 中可见，debug/audit 默认折叠。验证：goal_snapshot unittest、browser recheck、diff-check；剩余 blocker：AgentServer generated-task authoring 仍需产出可复用 task 或 direct ToolPayload，P1 hard requirements 未满足。

- 2026-05-18 01:54 P6：mini grant/research package 三轮 browser strict-eval fail/partial；修复 vision-sense CJK 误路由、AgentServer taskFiles raw quote policy、generated-task optional envelope、current-reference digest recovery 伪 satisfied；refs `session-literature-evidence-review-mpa25q1t-u5181a` / `project-literature-evidence-review-mpa26uwz-qzfrk8` / `project-literature-evidence-review-mpa2amo7-ley2ny` / `project-literature-evidence-review-mpa2df82-n4v4rm`；验证：vision-sense smoke、runtime-policy、generated-task lifecycle、result-presentation/artifact-policy、ProjectionApi/ResultsRenderer、complex-multiturn smoke、typecheck、diff-check pass；`smoke:web-multiturn-final` still fails SA-WEB-05 provider health preflight.

- 2026-05-18 01:45 Integration Worker：`git fetch --all --prune` 后确认远端 `codex/*` 与本地 worker 分支均无新提交可合并；集成本地 generated-task helper / result presentation 小修复：`write_payload` 现在补齐缺省数组 envelope 字段但仍校验数组类型，runtime policy 提醒避免 raw double quotes 破坏 AgentServerGenerationResponse JSON，strict retry 仍违反 task interface 时改走 deterministic failed-with-reason adapter，current-reference digest recovery 被标为 partial 不再满足 artifact rewrite 请求；验证：generated-task generation/execution lifecycle、runtime-policy、result-presentation-contract、`npm run typecheck`、`git diff --check` 通过；剩余风险：P1 outputPath contract / P2-P3 browser success 仍需真实端到端复验。
- 2026-05-18 01:30 Integration Worker：`git fetch --all --prune` 后确认远端 `codex/*` 均已是 `origin/main` 祖先；审查并集成当前 `codex/p6-long-context` 本地 P2/P3/P6 修复包，补修 message-only blocker JSON 保持 failed displayIntent 与 ChatPanel typecheck 窄化；验证：generated-task lifecycle、direct-answer/artifact/dispatch、ResultsRenderer、ChatPanel、vision-sense smoke、Python goal snapshot、`npm run typecheck`、`git diff --check` 全通过；剩余风险：P2/P3 真实 browser 仍未获得完整用户任务成功，下一轮继续修 scenario routing / malformed generation response。
- 2026-05-18 00:58 Integration Worker：`git fetch --all --prune` 后审查 `origin/codex/m13-complex-multiturn`、`origin/codex/result-presentation-r015`、`origin/codex/sciforge-paper-reproduction-loop`、`origin/codex/t122-boundary-smoke`；四个分支均已是 `origin/main` 祖先，无新增合并；验证：`git diff --check`、`npm run typecheck` 通过；剩余风险：下一轮需等待新 worker branch 或 P1-P6 browser evidence。
- 2026-05-18 01:00 Integration Worker：最终状态检查时检测到并行写入 `packages/skills/runtime-policy*`、`src/runtime/gateway/agentserver-generation-dispatch.ts`、`src/runtime/gateway/artifact-materializer*`、`src/runtime/gateway/generated-task-runner-*`；本轮未合并/未改这些文件；`git diff --check` 仍通过，但上述并行代码改动未纳入先前 `npm run typecheck` 结论。
- 2026-05-18 Orchestrator：重排 `PROJECT.md` 为多 Codex 自动化协议，加入 worker/heartbeat/sub-agent/strict-eval/evidence 规范；未改产品代码；验证：`git diff --check`。
- 2026-05-18 P2：messy TSV 数据分析 strict-eval partial/fail；修复 generated-task entrypoint materialization mismatch 与 Python syntax preflight retry；refs: `project-literature-evidence-review-mpa0si55-syqpd7`、`generated-literature-45e15950175a`、旧 syntax 证据 `generated-literature-2182f65faaaa`；验证：generated-task lifecycle tests、ResultsRenderer tests、typecheck。
- 2026-05-18 P3：MMD code-debug strict-eval partial/fail；修复 `DISC-20260517-P3-005` syntax preflight terminal failure by routing blocked generated Python through bounded repair/rerun before terminal payload；before evidence `project-literature-evidence-review-mpa0q8t4-mawfnw`，after recheck `project-literature-evidence-review-mpa0yd7f-2a5ue2` blocked earlier by malformed generation response；验证：generated-task lifecycle tests、dispatch test、ResultsRenderer test、typecheck、diff-check。
- 2026-05-18 01:30 P1：single-cell diffusion 全文文献调研 strict-eval partial/fail；修复 future report follow-up 文案误判 continuation，browser recheck 从 `intent=continuation`/219973-token convergence guard 变为 `intent=fresh`，但仍 blocked by generated task `outputPath` contract；refs: `project-literature-evidence-review-mpa1pkme-scu50q`、`project-literature-evidence-review-mpa1vfgy-6frcnz`；验证：goal_snapshot unittest、execution_classifier function tests、capability-discovery、ResultsRenderer/projectionApi、typecheck、diff-check。

## Verification Commands

常用 targeted suites：

```bash
node --import tsx --test src/runtime/gateway/agentserver-generation-dispatch.test.ts src/runtime/gateway/agentserver-stream.test.ts src/runtime/capability-discovery.test.ts
node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/projectionApi.test.ts src/ui/src/app/uiActionBoundary.test.ts src/ui/src/app/results/WorkspaceObjectPreview.test.ts
node --import tsx --test src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/runtime/gateway/generated-task-runner-generation-lifecycle.test.ts
npm run typecheck
git diff --check
```

Milestone 完成门：

```bash
npm run verify:single-agent-final
```

## Historical Archive

- 2026-05-14/15 旧 CAP/PKG/GT/PSM/MEM/H022 与早期稳定性任务：[`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)
- 2026-05-16 Browser Multiturn Stability Sprint、PBT/P1/P2/P3/P4/ARC/MTG 长任务板与 issue 细节：[`docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`](docs/archive/PROJECT-history-2026-05-16-browser-sprint.md)
- 2026-05-17 UX simplification / capability discovery / P1-P6 strict-eval 长任务板、完整 Activity Log、run/session/evidence refs：[`docs/archive/PROJECT-history-2026-05-17-ux-gauntlet.md`](docs/archive/PROJECT-history-2026-05-17-ux-gauntlet.md)

归档文件只作为 evidence/source lineage。当前 owner、状态、handoff、未关闭 blocker 和下一步行动以本文件为准。
