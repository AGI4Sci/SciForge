# SciForge - PROJECT.md

最后更新：2026-05-17

## 当前目标

用 Codex in-app browser 对 SciForge 进行真实、复杂、多轮的科研与 coding 端到端任务牵引。P1-P6 不是替项目“找通过证据”，而是代替真实用户严格使用、评测和挑战 SciForge：只要网页主回复没有真正解决用户问题，就必须判失败、记录证据、用 sub agents 定位并修复通用根因。

所有修改必须通用：不能为某个 prompt、端口、backend、provider、文件名、论文题目、错误文本或浏览器会话写特例。多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)，harness 行为入口参考 [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)。

## 历史归档

- 2026-05-14/15 旧 CAP/PKG/GT/PSM/MEM/H022 与早期稳定性任务：[`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。
- 2026-05-16 Browser Multiturn Stability Sprint、PBT/P1/P2/P3/P4/ARC/MTG 长任务板与 issue 细节：[`docs/archive/PROJECT-history-2026-05-16-browser-sprint.md`](docs/archive/PROJECT-history-2026-05-16-browser-sprint.md)。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

## 不变原则

- 真实 browser 优先：每个活动进程必须用 Codex in-app browser 完成端到端多轮任务；terminal smoke 只能作为补充验证，不能替代用户可见证据。
- 任务成功优先：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地解决；只显示 `satisfied`、只恢复 refs、只无 raw leak、只无 Projection wait 都不是充分条件。
- 反假成功优先：网页里“有回答”不等于成功。如果用户要求调研、下载、阅读全文、写报告、复现实验、修改代码或生成 artifact，主回复必须证明这些动作实际完成、内容是否正确；只给概述、计划、空泛引用、`Verification: 未验证`、recover action、refs 列表或错误包装，全部算 `TaskSuccess=false`。
- 速度不能靠快失败冒充：可以更早展示计划、进度、partial answer 和 recover action，但不能跳过 provider/tool、artifact grounding、verification boundary 或最终质量。
- 所有修复必须通用：修架构薄腰、contract、profile、manifest、Projection、ArtifactDelivery、gateway、policy 或 UI boundary，不写 prompt/provider/session/端口特例。
- Capability 必须成为生成层可执行 authoring contract：已有 ready provider/tool route 时，backend prompt 必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton。
- 多轮记忆边界保持 Single-Agent runtime contract：Workspace Kernel ledger/ref store 是事实源；AgentServer Context Core 负责 retrieval/compaction/handoff；backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 设计和实现保持同一真相源：代码改变 contract 时同步更新相关设计文档和本文件。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并；旧兼容逻辑若与最终 contract 冲突，默认移除。
- 长文件治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先按职责拆分；超过 3000 行视为维护风险。

## 当前 Milestone：Strict User-Proxy Evaluation Gauntlet

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：并行启动 P1-P6 独立网页进程，由每个进程代替真实用户严格使用 SciForge。每个进程必须完成“真实任务 -> 严格评测 -> 失败复现 -> sub-agent 通用修复 -> browser 复验 -> 更新 PROJECT.md -> 同步 GitHub”的闭环。历史残余 run、旧 evidence 和旧 `done` 结论不作为本轮成功依据。

### Milestone Gates

- [ ] **Browser E2E Gate**：每个进程必须像真实人类一样在 in-app browser 中点击、查看、选择 artifact、reload 和继续追问；默认直接从 Web UI 与 workspace 产物判断结果，不为每轮维护第二份 evidence。
- [ ] **Lightweight Trace Gate**：每个自主探索 milestone 只需在 `PROJECT.md` 记录结论级信息：用户目标、当前状态、关键 run/session 或 workspace artifact、success/failure reason、root boundary 和下一步。
- [ ] **Escalated Evidence Gate**：只有失败、假成功、修复前后对比、UI 与 workspace 证据不一致、或 milestone 提交前需要验收凭据时，才保存截图/DOM/console/network/timing 等完整 evidence。
- [ ] **Hard Requirements Gate**：每轮先列出用户 hard requirements；只有逐条证明完成，才可判 `TaskSuccess=true`。
- [ ] **Strict Evaluation Gate**：P1-P6 必须代替用户判断主回复是否真的解决问题；“有文字输出但未完成动作”必须判失败。
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

每个进程至少完成一个自主探索 milestone。一个 milestone 的最小闭环是：

- [ ] 选择一个真实用户目标，并写清为什么它属于本进程方向。
- [ ] 用 in-app browser 自然使用 SciForge，不预设“为了通过测试”的提示词。
- [ ] 记录用户 hard requirements，并用网页主回复、artifact、refs、运行结果逐条验收。
- [ ] 判定 `TaskSuccess` 与 `AnswerQuality`，允许判失败。
- [ ] 对失败启动 sub agents：复现、定位、修复、测试、evidence、PROJECT 回写。
- [ ] 完成后更新本文件、提交并 push GitHub、关闭当前 sub agents。

### P1 Human Researcher - Literature / Full-text Discovery

状态：done
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

- 状态：in_progress
- 用户目标：以真实数据科学用户身份要求 SciForge 生成一个可复跑的药物响应/时间点数据分析包，包含 CSV、EDA、统计模型、图表、脚本和一条能直接执行的 rerun command；随后选中图表 artifact 追问图表能否单独支持统计结论。
- Hard requirements：必须有可打开的 CSV/报告/图表/脚本 artifact；必须给出样本量、效应方向、检验假设、限制；rerun command 必须能在 workspace 中实际执行或如实给出 blocker；selected chart follow-up 必须只基于被选图表，不得补用未选 CSV/报告/历史消息；未验证或复跑失败不得投影为完成。
- 验收方式：用 in-app browser 在 `http://127.0.0.1:5273/` 自然提交任务、查看 artifacts、在 workspace 执行 rerun command 或等价脚本命令、选择图表 artifact 追问、reload 后确认最终状态；失败时定位通用 gateway / verification / ArtifactDelivery / Projection 边界。

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

本轮结论（P3，2026-05-17）：首轮真实 browser run `project-literature-evidence-review-mp8tmbus-d780yv` / task `generated-literature-8ef4985b7dc3` 生成并运行 Logistic growth ODE fitting demo，workspace 产物含 `logistic_fit_demo.py`、`generated-literature-8ef4985b7dc3-reproduction-report.md`、JSON output 与 stdout/stderr logs；报告给出 `r true 0.5000 -> fitted 0.4767, error 4.67%`、`K true 200.0 -> fitted 201.5, error 0.77%`、`RMSE 4.3505`、`Reproduction success: YES`。严格追问 selected reproduction report 时，首轮 follow-up `project-literature-evidence-review-mp8u57o6-r229qf` 和重试 `project-literature-evidence-review-mp8ughrj-g0hk8z` 被旧 direct-context legacy fallback 误判成 planning-register，输出预算/时间线/风险登记表，严格判 `TaskSuccess=false` for follow-up。通用修复后，复验 run `project-literature-evidence-review-mp8unjqv-z81dk6` 改为直接回答 selected report 的可信度、精确指标、剩余风险和下一步验证；仍因 runtime verification gate 为 `unverified` 显示 partial，这是独立的 verification policy 边界，不能把 direct-context answer 的用户可见内容再误路由成 planning-register。

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

自主任务建议，worker 可自由选择或改写：

- [x] 复现一个小型 ODE / optimization / ML toy experiment。
- [ ] 让 SciForge 生成代码后主动运行、发现失败、修复并重新验证。
- [x] 选择失败报告 artifact，要求判断复现是否成功并提出下一步实验。

严评重点：

- [x] 不能声称代码可运行但没有运行/验证证据。
- [x] 指标失败时不能宣称成功。
- [x] Repair 必须 bounded，不得无限循环。
- [x] 代码、指标、报告和网页主回复必须一致。

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

状态：in_progress
Owner：P6
Browser：`http://127.0.0.1:5673/`
证据策略：默认使用 Web UI 与 workspace 直接核查；必要时才升级保存截图/DOM/console/manifest

当前自主探索目标（P6，2026-05-17）：作为长期项目 owner，要求 SciForge 多轮构建一个可复现实验 mini grant/research package，包含 brief、决策记录、risk register、timeline/budget、约束变更后的全局更新，以及 reload 后继续追问；严格检查旧约束是否污染新结论、selected artifact follow-up 是否基于选中交付物、audit/raw 是否只作为可审计细节而不污染主回复。

人类角色：一个长期项目 owner，希望 SciForge 跨多轮保留目标、约束、决策记录和交付物，并能处理变更。

探索方向：长上下文、多 artifact、selected refs、约束变更、risk register、reload restore、audit/raw boundary。

自主任务建议，worker 可自由选择或改写：

- [ ] 构建一个 mini grant / reproducibility audit / research package。
- [ ] 多轮生成 brief、主文档、risk register、timeline、budget。
- [ ] 中途改变关键约束，要求 SciForge 更新所有受影响结论。

严评重点：

- [ ] 历史 DOM 成功片段不能覆盖最新 failed/recoverable 主回复。
- [ ] 旧约束不得被当作新事实。
- [ ] selected refs follow-up 必须基于选中 artifact。
- [ ] audit/raw details 可审计但不得污染主结果。

## Discovered Task Queue

子进程执行时可以自行发现新任务，但必须按模板写入这里，不能直接把偶发现象塞进代码特例。

模板：

```markdown
### DISC-YYYYMMDD-NNN 简短标题

状态：todo
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

- 2026-05-17 - P1 - 完成 `P1-TASK-20260517-browser-rendered-web-tool`：联网核对后选择 Playwright/Chromium 作为通用浏览器级底座，而不是引入额外 LLM browser-agent 框架。`@sciforge/web-worker` 新增 `browser_search` / `browser_fetch`，observe manifests 与 registry 可发现，generated-task provider-first route 能识别 browser/rendered/JS/PDF/full-text intent；`web_search` 普通 DuckDuckGo fetch 失败时可尝试 `playwright-chromium` / `bing-rendered`，显式 arXiv 查询仍优先 arXiv API 与 submittedDate window。真实 browser tool check 读到 JS 渲染正文，targeted tests 41/41 通过；`npm run typecheck` 仍失败在并行 dirty 类型问题，非 P1 边界。
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

P1、P2、P3、P4 与 P5 已完成本轮 strict-eval/fix/reverify 闭环；P1 额外补强 arXiv provider fallback：显式 arXiv query 现在走 arXiv API、保留 arXiv ID、无结果时 fail-closed，且未完成全文证据时仍不冒充 success。P5 关闭 verification-required completion gate 的 fake-success 边界，P4 接手并关闭 `DISC-20260517-P5-001` generated-task output containment follow-up。P3 关闭 `DISC-20260517-P3-001`，direct-context read-only answer 的 visible unverified verification 现在是 non-blocking，不再把 satisfied direct answer 降为 partial。下一步由 P6 继续 long-context deliverable iteration strict-eval，或由任一 owner 继续从 discovered queue/真实用户路径中选择新的失败边界。每个进程继续按对应人类角色自由探索 SciForge；不要把任务剧本定死，也不要为了通过验收而写提示词。Worker 默认直接在 Web UI 点击查看、选择 artifact、reload、继续追问，并从 workspace 产物/records 中查证据；不要为每轮维护第二份 evidence。只有失败、假成功、修复对比、UI/workspace 不一致或 milestone 提交验收时，才升级保存截图/DOM/console/network/manifest。每个 milestone 结束后更新本文件、提交并 push GitHub、关闭上一批 sub agents，再启动下一批。
