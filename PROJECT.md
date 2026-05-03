# SciForge - PROJECT.md

最后更新：2026-05-03

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 开发者不应为一次任务缺口手工写死专用科研脚本；只能补通用协议、权限、安全边界、runner 能力、context contract、promotion 机制和 UI/artifact contract。
- TypeScript 主要负责 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排；科学任务执行代码优先作为 workspace-local Python/R/notebook/CLI artifact 生成。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。

## 任务板

### T080 科研 UI Components 原语化、独立发布与 Demo/README 契约

状态：计划中。

#### 背景
- `packages/ui-components` 当前已有 report、paper、molecule、network、omics plot/table、evidence、execution、timeline、inspector 等组件雏形，但 artifact 类型与视图类型混在一起：例如 `omics-differential-expression` 同时承载 volcano、heatmap、UMAP 三种视图数据。
- SciForge 的 UI components 目标不是堆领域专用小组件，而是沉淀面向科学研究的基础数据原语：document、record-set、matrix、point-set、graph、sequence、structure、image、time-series、evidence、provenance、editable-design。复杂科研任务应通过这些基本组件组合完成。
- 每个组件必须成为可独立发布包：包内自带 manifest、renderer、README、fixtures/demo 数据、必要 assets/styles/tests，不依赖 SciForge app 目录或兄弟组件的相对路径代码。
- 每个组件必须同时服务三类消费者：用户可预览效果，agent 可读 README 快速决策，人类开发者可维护和扩展。

#### 设计原则
- 区分 artifact schema 与 view preset：`point-set` 是数据原语，volcano/UMAP/PCA/t-SNE 是 preset；`matrix` 是数据原语，expression heatmap/attention map/confusion matrix 是 preset。
- UI 包以“可交互、可编辑、可引用”为核心：选择、筛选、标注、比较、编辑后的 patch/output artifact 都要有明确事件和输出契约。
- Demo 数据必须是真实形态的最小样例，不使用空壳或随机 toy 占位；每个 demo 要覆盖正常态、空态和至少一个交互/选择态。
- README 必须包含 `Agent quick contract` 与 `Human notes`：agent 能知道 accepts/requires/outputs/events/safety/fallback，人类能知道数据 schema、设计边界、测试方式、发布注意事项。
- 组件包不应从 `../types` 或 app 内部 import 私有实现；如需共享类型，应先发布稳定的 `@sciforge-ui/runtime-contract` 或将最小 contract 内置在包内。

#### 科学绘图策略
- Plotly 作为第一阶段唯一 agent-facing 标准：`plot-spec` 采用 Plotly-compatible JSON shape，用户预览、agent 修改、评论锚点、selection event 和默认导出都围绕同一份 spec，避免双渲染器不一致。
- Plotly 默认承担交互探索与常规导出：hover、zoom、selection、legend toggle、linked brushing、HTML 预览、SVG/PDF/PNG 导出都优先走 Plotly 能力。
- Matplotlib 只作为 fallback / advanced publication export backend：当 Plotly 无法满足期刊尺寸、特殊统计排版、字体/线宽精修或高分辨率导出要求时，才由同一 `plot-spec` 派生 Matplotlib script 和 export artifact。
- Vega-Lite / Vega 暂不进入第一阶段主闭环；可作为未来 import/export adapter，而不是默认 truth source。
- SciForge 的绘图真相源是 Plotly-compatible `plot-spec` / `figure-spec` artifact；Matplotlib 产物必须标记为 derived export，不反向成为主编辑状态。
- 交互图和投稿图要分层但不分裂状态：Plotly spec 服务探索和编辑，publication export profile 记录最终尺寸、字体、矢量/栅格、统计标注和审稿 QA。
- WebGL/Canvas 大图允许用于交互性能，但投稿导出必须检查是否被栅格化；需要记录 raster/vector 混合策略、分辨率和审稿可接受性。
- 每个科学绘图组件都要输出可复现 bundle：原始数据 ref、Plotly spec、export profile、可选 Matplotlib fallback script、导出文件、版本信息、人工编辑 patch。

#### 类型合并与重命名 TODO
- [ ] 将 `data-table` 升级/重命名规划为 `record-table`：消费 `record-set`、`table`、`dataframe`、`annotation-table`，继续作为 row-like artifact 的安全 fallback。
- [ ] 将 `network-graph` 泛化规划为 `graph-viewer`：消费通用 `graph`，通过 preset 支持 knowledge graph、PPI、pathway、causal graph、workflow DAG。
- [ ] 将 `volcano-plot` 与 `umap-viewer` 抽象到底层 `point-set-viewer`：volcano、UMAP、PCA、t-SNE、embedding scatter 作为独立 preset 或 manifest profile。
- [ ] 将 `heatmap-viewer` 从 `omics-differential-expression` 解耦为 `matrix-viewer`：支持 expression matrix、similarity matrix、attention map、confusion matrix、dose-response grid。
- [ ] 保留 `paper-card-list` 与 `evidence-matrix` 的独立性：前者是 source/document collection，后者是 claim-evidence reasoning structure，只通过引用互联。
- [ ] 将 `execution-unit-table` 与 `notebook-timeline` 的底层数据统一到 `workflow-provenance` / `research-timeline`，视图仍保持表格与时间线两个包。
- [ ] 将 `molecule-viewer` 扩展命名到 `structure-viewer` 路线：兼容 protein、ligand、complex、pocket、mutation/residue selection、trajectory snapshot。

#### 新增基础组件 TODO
- [ ] `sequence-viewer`：DNA/RNA/protein sequence、FASTA/FASTQ、feature annotation、motif/residue/base selection。
- [ ] `alignment-viewer`：pairwise alignment、MSA、BLAST hits、conservation、gap/mutation highlight。
- [ ] `genome-track-viewer`：BED/GFF/VCF/BAM coverage、gene model、variant track、genomic range selection。
- [ ] `image-annotation-viewer`：microscopy、pathology、gel/blot、region selection、mask/box/point annotation。
- [ ] `spatial-omics-viewer`：spot/cell coordinates、tissue image overlay、gene expression layer、cluster selection。
- [ ] `time-series-viewer`：training curves、longitudinal samples、kinetics、dose/time response、confidence bands。
- [ ] `plate-layout-viewer`：96/384 well plate、sample/condition/replicate mapping、well selection/editing。
- [ ] `model-eval-viewer`：ROC、PR、confusion matrix、calibration、error slices、benchmark comparison。
- [ ] `prediction-reviewer`：AI prediction set、人类确认/拒绝、batch edit、feedback artifact 输出。
- [ ] `protocol-editor`：stepwise protocol、materials、parameters、execution status、agent-generated protocol patch。
- [ ] `schema-form-editor`：任意 structured artifact 的字段编辑、validation、diff/patch 输出。
- [ ] `comparison-viewer`：artifact diff、version comparison、condition comparison、side-by-side/overlay 模式。
- [ ] `scientific-plot-viewer`：Plotly 优先的交互图组件，消费 Plotly-compatible `plot-spec`、`point-set`、`matrix`、`record-set`、`time-series` 等原语。
- [ ] `publication-figure-builder`：Nature/Science 风格多 panel figure 编排，支持 panel label、统一字体/线宽、legend、scale bar、导出 profile。
- [ ] `statistical-annotation-layer`：p value、CI、effect size、multiple testing、sample size、test method、significance bracket 等统计标注层。

#### 独立发布包 TODO
- [ ] 定义组件包标准目录：`package.json`、`README.md`、`manifest.ts/json`、`src/render.tsx`、`src/types.ts` 或 runtime contract 依赖、`fixtures/`、`assets/`、`tests/`。
- [ ] 修正每个包的 `package.json files/exports`，确保 renderer、fixtures/demo、README、assets、manifest 都会随包发布。
- [ ] 设计 `@sciforge-ui/runtime-contract`：只包含稳定 renderer props、artifact envelope、interaction events、safety/presentation metadata，避免每个包从 monorepo 相对路径拿类型。
- [ ] 建立组件包 publish checklist：无 app 私有 import、无 undeclared external resource、可离线 demo、README 完整、fixtures 可被 workbench 加载、测试通过。
- [ ] 为外部资源组件定义 declared-only 资源策略：例如 molecule structure、PDF/image、web accession 都必须通过 manifest 声明和 workspace ref 加载。

#### Demo 数据与 Workbench TODO
- [ ] 每个组件包必须提供 `fixtures/basic.ts` 或 `fixtures/basic.json`，用于正常预览。
- [ ] 每个组件包必须提供 `fixtures/empty.ts` 或 `fixtures/empty.json`，用于空态/缺字段预览。
- [ ] 每个交互型组件必须提供 `fixtures/selection.ts` 或等价 demo，覆盖 select/highlight/edit 事件。
- [ ] Demo 数据要使用科学上合理的最小样例：例如真实格式的 FASTA/PDB/mmCIF 片段、表达矩阵、graph nodes/edges、paper metadata、model metrics，而不是仅有 `foo/bar`。
- [ ] Component Workbench 要能列出所有组件、加载每个包的 demo、显示 README 摘要、展示 accepts/requires/outputs/events/safety。
- [ ] Workbench preview 要支持 agent 视角：给定 artifact schema，推荐可用组件和 fallback；给定组件，展示示例 artifact shape。
- [ ] Workbench preview 要支持人类视角：切换 basic/empty/selection/demo variants，复制 artifact JSON，查看 interaction event log。
- [ ] 科学绘图 demo 必须以 Plotly spec 为主，同时提供交互预览和静态导出预览：例如 Plotly HTML、SVG/PDF/PNG export；Matplotlib script 仅作为 fallback demo variant。
- [ ] Workbench 要能显示 figure QA：尺寸、DPI、字体、颜色 palette、色盲安全、panel label、legend、vector/raster 状态、数据来源和统计方法。

#### README 契约 TODO
- [ ] 每个 README 顶部必须有 `Agent quick contract`：`componentId`、`accepts`、`requires`、`outputs`、`events`、`fallback`、`safety`、`demo fixtures`。
- [ ] 每个 README 必须有人类维护说明：数据 schema、字段语义、交互事件、编辑输出、性能边界、外部资源限制、测试命令、发布注意事项。
- [ ] 每个 README 必须写明“何时不要使用该组件”，避免 agent 为装饰性目的生成无意义 companion artifact。
- [ ] 对 preset 型组件写明底层原语：例如 volcano 是 `point-set` preset，heatmap 是 `matrix` preset，knowledge graph 是 `graph` preset。
- [ ] README 示例必须与 fixtures 保持一致；发布前需要 smoke 校验 README 中的 fixture 路径存在。

#### 面向 AI + 生命科学的数据原语 TODO
- [ ] 建立 `document` schema：paper、report、protocol、supplement、PDF/Markdown、source provenance。
- [ ] 建立 `record-set` schema：表格、sample metadata、实验条件、benchmark rows、result list。
- [ ] 建立 `matrix` schema：row/column labels、values、annotations、normalization、missing values。
- [ ] 建立 `point-set` schema：coordinates、labels、groups、metrics、linked entity ids。
- [ ] 建立 `graph` schema：nodes、edges、types、relations、evidence refs、confidence。
- [ ] 建立 `sequence` / `alignment` schema：alphabet、features、coordinates、conservation、variant refs。
- [ ] 建立 `structure-3d` schema：coordinate ref、format、chains、ligands、residues、annotations、quality metrics。
- [ ] 建立 `image` / `volume` schema：image ref、channels、scale、regions、masks、annotations。
- [ ] 建立 `time-series` schema：time axis、series、condition、replicates、uncertainty。
- [ ] 建立 `spatial-map` schema：coordinates、image ref、cell/spot ids、feature overlays。
- [ ] 建立 `model-artifact` schema：checkpoint/ref、predictions、metrics、dataset split、model card。
- [ ] 建立 `claim-evidence` schema：claim、evidence item、source、support/refute/neutral、confidence、verification status。
- [ ] 建立 `workflow-provenance` schema：execution unit、params、environment、logs、input/output refs、lineage。
- [ ] 建立 `editable-design` schema：experimental design、plate layout、protocol params、primer/guide/assay design。
- [ ] 建立 Plotly-compatible `plot-spec` schema：data traces、layout、config、frames、selection、tooltip、annotation、export profile、fallback renderer metadata。
- [ ] 建立 `figure-spec` schema：multi-panel layout、panel ids、figure size、journal profile、typography、color palette、export targets。
- [ ] 建立 `statistical-result` schema：test name、effect size、CI、p value、adjusted p value、n、replicate structure、model formula、assumptions。
- [ ] 建立 `visual-annotation` schema：label、arrow、bracket、ROI、scale bar、threshold line、callout、linked data target。
- [ ] 建立 `export-artifact` schema：SVG/PDF/EPS/PNG/TIFF refs、DPI、vector/raster status、font embedding、checksum、generation script。

#### 科学绘图需求覆盖 TODO
- [ ] 支持基础统计图：scatter、line、bar、box、violin、ridge、histogram、density、ECDF、QQ plot。
- [ ] 支持矩阵/高维图：heatmap、clustered heatmap、correlation matrix、confusion matrix、attention map、distance matrix。
- [ ] 支持组学常用图：volcano、MA plot、PCA、UMAP/t-SNE、dot plot、gene set enrichment、pathway map、coverage track。
- [ ] 支持模型评估图：ROC、PR、calibration、residuals、learning curve、ablation、benchmark ranking、error slice。
- [ ] 支持不确定性表达：error bar、confidence band、credible interval、bootstrap distribution、replicate jitter、sample size display。
- [ ] 支持多 panel 期刊图：A/B/C panel labels、shared axis、aligned legends、inset、broken axis、scale bar、caption linkage。
- [ ] 支持交互编辑：鼠标选择点/区域、隐藏 series、调整阈值、修改颜色/标签、保存 annotation patch。
- [ ] 支持审稿导出：单栏/双栏尺寸 profile、矢量 PDF/SVG/EPS、高分辨率 TIFF/PNG、字体嵌入、色彩空间和导出 QA。
- [ ] 支持可复现脚本：从同一 Plotly-compatible `figure-spec` 生成 Plotly interactive HTML / static export；Plotly 不支持时再生成 Matplotlib fallback export，并记录 renderer versions。

#### 验收标准
- [ ] 新旧组件映射表完成：当前 11 个组件分别归入基础原语、preset 或 provenance/evidence 类别。
- [ ] 至少 1 个组件完成独立包样板改造，并作为后续包的模板。
- [ ] 每个已发布组件都有 README、basic demo、empty demo；交互组件另有 selection/edit demo。
- [ ] Component Workbench 能从包内 demo 数据预览每个组件，不依赖 app 内手写 demo seed。
- [ ] `npm run packages:check` 能验证 manifest、README、fixtures、exports、独立 import 边界。
- [ ] 不用 demo/空结果伪装真实科学任务输出；demo 仅用于组件预览，runtime artifact 仍必须来自真实任务或用户上传数据。

### T079 Computer Use 长对话 Context Window 复验与开销优化

状态：进行中。

#### 背景
- 需要用浏览器真实跑 20+ 轮复杂对话，确认 context window meter、AgentServer 会话复用、prefix cache / cache read 观测和 context compaction 事件在 UI 中一致。
- context window 的用户可见显示不能把 provider cumulative token usage 误读成当前窗口占用；provider usage 应作为成本/缓存观测，当前窗口优先使用 native/AgentServer/本地估算。
- 后续轮次应复用 AgentServer session / Core snapshot / stable conversation ledger，而不是每轮让 SciForge 重新塞完整背景。

#### TODO
- [x] 修正前端 context window 状态选择：忽略 provider-usage 作为 meter 主数据，保留其 token/cache 观测。
- [x] 修正 workspace runtime compaction 事件：preflight、context-window recovery、rate-limit retry 都输出标准 `contextCompaction` 与 after state。
- [x] 扩展浏览器 smoke：调低 max context window，覆盖 24 轮 ledger、两次 UI 可见 compaction 事件和 meter 回落。
- [x] 用 Computer Use 打开浏览器复测真实长任务路径，检查 meter、日志、结果区和 session 复用。
- [ ] 用真实人工浏览器对话跑满 20+ 轮，并观察至少两次真实 AgentServer/backend compaction tag。
- [x] 修复 persistent budget exceeded 时 context snapshot 阻断 compact/recovery 的 backend 路径，并复测 UI `last compacted`。
- [x] 修复运行中 contextWindowState 覆盖 preflight compaction timestamp，避免 `last compacted` 从真实时间回退到 `never`。
- [x] 放大并打通 AgentServer/SciForge 的可配置 context window：UI 设置的 `maxContextWindowTokens` 会进入 AgentServer context snapshot / budget，而不是继续被固定 20K 估算覆盖。
- [x] 增加通用 artifact 访问策略：后续轮默认 refs/summary-first，必要时 bounded excerpt，避免每轮把大 artifact 全量回放给 backend。
- [x] 换新研究话题用浏览器真实复测：GLP-1 receptor agonists 与 AD/认知衰退/神经炎症，不复用 KRAS/PDAC 案例。
- [x] 增加通用文献核验护栏：PMID/DOI/trial/citation 修正必须证明标题/年份/期刊/identifier 是同一篇 work；不匹配时保留原记录并标记 `needs-verification`。
- [x] 跑 focused tests / smoke，并记录剩余风险。

#### 当前结果
- 前端 meter 主状态只信任 native / AgentServer / 本地估算窗口；provider usage 仍显示在用量 badge 和日志中，用于观察 token/cache 成本，但不再误导为当前 context window 占用。
- preflight、context-window exceeded recovery、rate-limit retry 的压缩事件统一为 `contextCompaction`，并携带 after state，UI 能稳定显示“上下文压缩”。
- 24 轮浏览器 smoke 验证 conversationLedger append-only、recentConversation bounded、两次 UI 可见 compaction、压缩边界后 meter 允许下降、非压缩轮继续累计。
- Computer Use 可视检查打开了本地 SciForge，真实执行 KRAS G12D / PDAC 文献证据评估 5 轮：R1 生成 paper-list/knowledge-graph/research-plan，R2 生成 research-report，R3 生成 audit-report，R4 生成 corrected-knowledge-graph，R5 因 backend fetch failed / acceptance repair 未完成而失败。
- 真实 artifact 不是 toy/template：`paper-list.json` 约 10KB/12 篇，`research-report.json` 约 18KB，`audit-report.json` 约 31KB/43 issues，`corrected-knowledge-graph.json` 约 12KB/21 nodes/21 edges。
- 复现的真实问题：4K max window 下 R4/R5 meter 到 104%-132% exceeded，provider cumulative token usage 到 7.4M+，但 `last compacted` 仍为 never；AgentServer 当前 work 里已有 `full-moow6nxn-f9db85` compaction tag，UI 没有把它接入当前 SciForge meter。
- 已修复 AgentServer compact 路径：`/context` 仍保持 persistent hard budget gate，但 `/compact` 可在预算超限时读取当前 work；当前 work 已只有 compaction tag 时，`/compact` 返回最近真实 tag，而不是 `null`。
- AgentServer 实测 `/compact` 返回真实 tag：`full-moow6nxn-f9db85`，`kind=compaction`，`turns=turn_37-turn_40`，`mode=full`，`createdAt=2026-05-02T22:07:13.067Z`，summary 5 条。
- 通过 Computer Use 第 06 轮复测：发送后 UI 一度把 `last compacted` 从 `never` 更新为 `2026-05-02T22:07:13.067Z`，证明 SciForge 能接入 backend 真实 compaction tag；随后运行态 contextWindowState 又擦掉该 timestamp，已用前端合并逻辑和单测修复。
- 第 06 轮恢复性审计不是模板：backend 实际读取了 `paper-list`、`research-report`、`audit-report`、`corrected-knowledge-graph` 等已有 artifact 文件；但后续追问成本失控，用户中断前 provider usage 达到 `709879 in / 19888 out / 729767 total`，暴露“压缩后续问仍重复读/回放过多上下文”的真实成本问题。
- AgentServer 已支持 request/metadata 传入 `maxContextWindowTokens`，并有 preflight 单测覆盖 64K window；浏览器侧当前显示 `6,597 / 200,000 tokens`，provider cumulative usage 同屏达到 `2,190,662 total`，证明 UI meter 没有再把 provider usage 当作当前 context window。
- AgentServer responses bridge 已覆盖“大 tool output 历史回放前压缩”的通用路径，防止下一轮 replay 直接塞回完整工具输出，降低多轮续问成本。
- SciForge 两条 AgentServer handoff 路径都加入 `artifactAccessPolicy`：显式 refs、reusable artifact refs、recent execution refs 去重后进入 `agentContext`，并向用户可见事件说明“refs/summary 优先，核实时 bounded excerpt”。
- Computer Use 新话题真实复测 3 轮 GLP-1/AD：R1 生成 `glp1-ad-paper-list-round1.json`、`glp1-ad-evidence-matrix-round1.json`、`glp1-ad-knowledge-graph-round1.json`、`glp1-ad-research-plan-round1.json`、`glp1-ad-gap-list-round1.json`；R2 在 Workspace Writer 短暂不可用时走 AgentServer fallback，只产出审计摘要；R3 在 Writer 恢复后产出 `glp1-ad-correction-report-round3.json` 和 `glp1-ad-corrected-paper-list-round3.json`。
- R3 handoff 确实是 bounded/ref-first：页面显示 `handoff 22111/220000 bytes`，`5,528 normalized / 10,568 raw`，`saved 5,040`；后续运行 provider usage 很高，但 context window 仍保持几千 token 级别。
- GLP-1/AD artifact 不是 toy/template，但真实性核验结果不能接受为完全正确：例如 ELAD/liraglutide 把 protocol PMID `30944040` 当作结果修正来源，population cohort 被替换成 pooled RCT dementia paper，REWIND/dulaglutide 被拿来修正“GLP-1 RA vs other medications”的宽泛 cohort claim；这些都说明 backend 需要强制 title/identifier 同篇匹配，而不是搜索到相近主题就应用修正。
- 已在 AgentServer generation prompt 层加入通用 bibliographic verification contract，要求 `original_title` / `verified_title` / `title_match` / `identifier_match` / `verification_status` / `verification_notes` 可审计，并禁止把 title/topic mismatch 的检索结果当 correction 应用。
- Focused SciForge tests 通过：`npm run test -- src/ui/src/api/sciforgeToolsClient.test.ts src/ui/src/api/agentClient.test.ts src/ui/src/contextCompaction.test.ts` 实际执行全套相关 tests，`122 pass / 0 fail`；`npx tsc --noEmit --pretty false` 通过。
- Focused AgentServer tests 通过：`npm run test -- tests/agent-server-preflight-compaction.test.ts tests/codex-chat-responses-adapter.test.ts tests/codex-app-server-adapter.test.ts` 实际执行当前 tests，`93 pass / 0 fail`。
- 真实浏览器 20+ 人工轮次与至少两次真实 AgentServer/backend compaction tag 仍未完成；当前只有 smoke 证明 24 轮 UI 事件，两次真实 backend compaction 还需要继续压测。

### T078 多轮上下文复用、Context Window 计量与 Token 开销优化

状态：已完成。

#### 背景
- 10 轮以上复杂续问时，SciForge 需要像 Codex 桌面版一样复用同一会话背景：长期事实走 workspace refs 和稳定 ledger，最近消息负责短期意图。
- 当前 context window meter 存在误导风险：本地估算只看最近若干消息，长对话后可能不再单调；provider cumulative usage 又容易被误解成当前窗口占用。
- 多轮请求上下文要保持通用，不允许针对某个科研案例、artifact id 或组件写特殊补丁。

#### TODO
- [x] 用真实 UI 多轮对话暴露：artifact merge 旧结果覆盖新结果、重复 key、结果渲染未合并 artifact top-level/data/content 字段。
- [x] 修正 artifact/execution merge：后续响应优先，同时保持用户已有 session 对象不被丢弃。
- [x] 修正结果渲染 payload 合并：通用支持 top-level、data、content 三类 artifact 字段布局。
- [x] 将续问上下文摘要从“最早 N 个 artifact/execution”改为“最近 N 个”，避免后续轮次复用过期 workspace refs。
- [x] 增加稳定 conversation ledger 与 contextReusePolicy：全会话按 append-only 顺序保留短摘要和 digest，最近 16 条保留更完整意图窗口。
- [x] 修正 context window 本地估算：使用全会话消息、runs、artifact refs、execution refs 的轻量累计，不因超过 24 条消息而下降。
- [x] 增加 12+ 轮单测：验证 ledger 完整、最近窗口稳定、最新 artifact/execution refs 被使用、AgentContext 与 UIState 一致。
- [x] 使用浏览器/应用服务复测多轮续问体验，确认用户可见 meter、工作日志、结果区行为一致。
- [x] 跑完整验证：typecheck、test、build。

### T077 Design System / Theme Package 模块化

状态：已完成。

#### 背景
- 当前 UI 已有 `uiPrimitives.tsx`、CSS variables 和 dark/light theme，但基础组件、主题 token、页面布局样式仍散落在 `src/ui/src/app` 与多份 CSS 中。
- 白天模式和未来更多主题都需要统一 design token，而不是每个页面单独补丁。
- UI component packages、Scenario Builder、Chat、Results、Workspace Explorer 都应该复用同一套 primitives、tokens 和交互状态。

#### TODO
- [x] 新增 `packages/design-system`，定义 Button、IconButton、Badge、Card、TabBar、SectionHeader、EmptyState、Input、Select、Details、Panel 等基础组件。
- [x] 将 `src/ui/src/app/uiPrimitives.tsx` 迁移或适配到 design-system 包，保留兼容导出以降低一次性改动风险。
- [x] 建立语义 token：surface、surface-muted、surface-raised、border、text、accent、danger、warning、shadow、focus-ring、radius、spacing。
- [x] 将 dark/light theme 变量集中到 design-system，并让主 app 只挂载 theme class。
- [x] 梳理 CSS 中重复的 button/card/tab/badge/panel 样式，逐步收敛到 design-system。
- [x] 提供 README：Agent quick contract 说明可用 primitives 和 theme token；Human notes 说明视觉原则、可访问性、扩展方式。
- [x] 增加轻量测试或 smoke：验证核心组件可渲染、theme token 存在、dark/light class 生效。
- [x] 不阻塞 T073：本任务负责长期模块化结构，T073 可先修当前白天模式视觉；两者最终要合流。

#### 并行实现 Prompt
```text
你负责实现 SciForge 的 T077：Design System / Theme Package 模块化。

工作目录：/Applications/workspace/ailab/research/app/SciForge

目标：
1. 新增 packages/design-system，沉淀 SciForge 的基础 UI primitives 与 theme tokens。
2. 将现有 src/ui/src/app/uiPrimitives.tsx 迁移/代理到 design-system，保持现有页面不大面积破坏。
3. 建立 dark/light 通用语义 token，供 T073 白天模式视觉重做复用。

执行要求：
- 先阅读 src/ui/src/app/uiPrimitives.tsx、src/ui/src/styles/base.css、src/ui/src/styles/app-*.css。
- 优先创建包结构、types、README、exports，再做最小迁移。
- 不要在本任务里大规模重写所有页面样式；先保证 design-system 可用、可渐进迁移。
- 保持现有 import 兼容，必要时让 uiPrimitives.tsx re-export 新包。
- 主题 token 要用语义命名，避免页面继续依赖硬编码暗色。

验收：
- npm run typecheck
- npm run test
- npm run build
- package catalog 或新增 smoke 能检查 design-system 基本结构。

交付说明：
- 列出 packages/design-system 的结构。
- 说明哪些 primitives 已迁移，哪些仍待迁移。
- 说明 T073 如何复用这些 token。
```
