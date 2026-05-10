# SciForge - PROJECT.md

最后更新：2026-05-11

## 关键原则
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- Agent harness 是项目级策略资产，不允许散落在 UI、gateway、prompt builder、conversation policy 或 repair 分支里；探索预算、上下文选择、skill hints、tool-use policy、验证强度和用户可见进度必须通过可版本化 harness policy 与阶段 hook 注入。
- Agent 行为治理的唯一入口是 `packages/agent-harness` profile registry 与声明式 stage hook；新增治理入口必须先进入 harness contract/trace，再由 gateway、prompt、UI、repair loop 消费，不能以 TODO 名义保留第二套散落规则。
- `CapabilityManifest` 与 `CapabilityBudgetDebit` 只覆盖可被 broker/harness 选择、组合、计预算、验证、修复、渲染或审计的能力面；普通 internal helper 不为清单完整性强行 manifest 化，也不为非 invocation 写预算账。
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。
- 推进项目的时候尽可能多开sub agents，并行加速推进


## 根本方向

SciForge 的最终形态是 **Backend-first, Contract-enforced, Capability-driven, Harness-governed**。完整设计以 [`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture) 和 [`docs/Architecture.md#终极形态harness-governed-scientific-agent-os`](docs/Architecture.md#终极形态harness-governed-scientific-agent-os) 为准；本文件只保留围绕最终形态重构的任务板。

核心定位：

- SciForge 是 downstream scenario adapter，不是第二套 agent。
- Agent backend 负责用户意图理解、多轮指代、能力选择、任务规划、胶水代码生成、artifact 内容读取、失败诊断、继续执行和修复。
- SciForge 负责协议、capability registry、capability broker、workspace refs、执行边界、contract validation、artifact 持久化、view 渲染和机器可读错误回传。
- `src/` 是固定平台逻辑和运行时骨架；`packages/` 是即插即用能力生态。回答“系统怎么运行”的逻辑进 `src/`，回答“系统能做什么”的逻辑进 `packages/`。详见 [`docs/Architecture.md`](docs/Architecture.md#src-与-packages-边界固定平台-vs-插拔能力)。
- Packages 不只是代码复用单元，而是 capability contract 单元；observe、skills、actions、verifiers、views、memory、import/export 都应暴露可声明、可校验、可组合、可替换、可修复的 capability。
- Agent harness 是独立行为治理层；runtime 只提供稳定阶段 hook 和 enforcement，harness profile 负责决定 fresh/continuation/repair/audit 等模式下的探索范围、上下文预算、工具预算、skill 倾向、验证强度和用户可见进度。详见 [`docs/Architecture.md`](docs/Architecture.md#终极形态harness-governed-scientific-agent-os)。
- 胶水代码、执行 trace、validation failure、repair attempts 和 composed capability 下钻记录本身是资产；必须沉淀到 Capability Evolution Ledger，用于晋升高频组合、改进 validator、完善 repair hints 和训练 broker。
- 重构时必须删除历史遗留链路，只保留最新唯一逻辑和唯一真相源；不得为了兼容旧实现长期保留并行路径、prompt regex、场景特例、provider 特例或 UI 语义兜底。

## 重构守则

- 每个重构任务都必须先声明新的唯一真相源，再删除旧入口、旧 adapter、旧 fallback 和旧测试夹具。
- 临时兼容层必须有删除任务、删除条件和 smoke guard；没有删除计划的兼容层不允许合入。
- Backend-first 优先级高于 UI 侧聪明化：SciForge 不判断“用户是不是想看报告/上一轮/markdown”，只传 refs、capability brief 和 contract。
- Harness-governed 优先级高于 prompt 局部补丁：不得在某个 request path、scenario、provider 或 UI 分支里临时追加探索指令、工具约束、上下文规则或技能偏好；必须进入 harness hook/profile 或 capability manifest。
- `src/` 可以写死平台秩序，但不能写死 package 领域语义；`packages/` 可以扩展能力，但不能绕过 `src/` 的安全、refs、validation 和 persistence 边界。
- 所有 capability 输出都必须可代码校验；校验失败生成 `ContractValidationFailure` 返回 backend 修复，不在 SciForge 侧改写成成功。
- 高频稳定路径可以固化为 composed capability，但仍必须暴露 manifest、validator、repair hints 和 fallback，下钻后可由 backend 重新组合原子能力。
- 活跃 TODO 必须是可实现、可验证、可删除的具体任务；架构方向、唯一真相源、no-legacy/no-scattered 这类长期约束应放入关键原则、重构守则或 smoke guard，不作为开放式 TODO 挂在任务板里。
- 历史任务不再单独维护；如果仍有价值，必须并入下面的最终形态重构任务。

## 倒叙任务板

### T133 Real Paper Reproduction Loop：用细胞/表观遗传论文拉通真实科研复现能力

状态：规划中；目标是让 Codex 代替人类研究者，使用 SciForge 从真实科学数据、研究 topic 和已发表论文出发，使用computer use能力，从网页交互，通过多轮交互提示、工具调用、计算分析、证据组织和反证检查，复现或有理有据地质疑论文主要结论，并把全过程沉淀成可训练科学研究自动化模型的轨迹数据。本任务只允许沉淀通用能力、通用 contract、通用 harness/profile、通用 artifact schema 和通用 verifier；不得为下面 3 篇论文、特定文件名、特定 figure、特定 gene 或特定数据库写硬编码分支。

种子论文：

- `workspace/cell_papers/2020 Refined spatial temporal epigenomic profiling reveals intrinsic__connection between PRDM9-mediated H3K4me3 and__the fate of double-stranded breaks.pdf`：PRDM9-mediated H3K4me3、DSB hotspot fate、CO/NCO、meiotic prophase I、ChIP-seq/NOMe-seq/SPO11/DMC1。
- `workspace/cell_papers/2022_NRG_Histone post-translational__modifications — cause and__consequence of genome function.pdf`：histone PTM 的因果/结果框架、transcription/recombination/replication/repair/genome architecture 的通用理论背景。
- `workspace/cell_papers/2025_Cell Research_SETD1B-mediated broad H3K4me3 controls proper temporal patterns of gene expression critical for spermatid development.pdf`：SETD1B-RFX2 axis、broad H3K4me3、H3K27ac enhancer/promoter overlap、temporal gene expression、spermatid development。

Todo：

- [ ] T133-A 论文理解与 claim graph 任务：让 SciForge 读取 3 篇 PDF，抽取每篇论文的 main claims、key figures、实验设计、数据类型、物种/细胞阶段、关键变量、统计检验、外部数据依赖和可复现性风险，输出通用 `paper-claim-graph`、`figure-to-claim-map`、`reproduction-plan` artifact；阅读过程必须 refs-first，prompt 只携带 bounded summary、page/section locators 和 citation verification result。
- [ ] T133-B 数据与代码发现任务：基于论文中的 accession、supplementary tables、方法学和引用信息，使用通用文献/网页/数据库检索能力定位 GEO/SRA/ENA/ArrayExpress/figshare/GitHub/supplementary data 等可用数据源，输出 `dataset-inventory`、`data-access-plan`、`missing-data-report` 和下载预算审计；找不到数据时必须 structured partial/failure，不能伪造成功。
- [ ] T133-C 2020 PRDM9/DSB fate 复现任务：围绕“早形成 DSB 更开放、更倾向 CO fate，且 PRDM9-mediated H3K4me3 与 DSB fate 有内在联系”构造最小可执行复现链路，优先复现 peak overlap、stage-specific H3K4me3、open chromatin/NOMe signal、SPO11/DMC1/hotspot association、CO/NCO proxy enrichment；输出 `analysis-notebook`、`evidence-matrix`、`figure-reproduction-report` 和 `claim-verdict`。
- [ ] T133-D 2025 SETD1B/broad H3K4me3 复现任务：围绕“SETD1B-RFX2 介导 spermatid-specific broad H3K4me3，并控制基因表达强度与时间模式”构造最小可执行复现链路，优先复现 broad-vs-sharp H3K4me3 domain calling、H3K27ac/promoter/enhancer overlap、stage temporal expression pattern、Setd1b/Rfx2 perturbation 或相关公开数据对照；输出同一套通用 artifact，而不是为该论文定制 schema。
- [ ] T133-E 综述到机制假设任务：用 2022 NRG review 作为背景知识压力测试，让 SciForge 把“histone PTM 是 cause 还是 consequence”的概念框架转成可检验假设、反证标准和复现实验 checklist，并用于评估 2020/2025 两篇研究论文中的因果推断强度；输出 `mechanism-hypothesis-matrix` 和 `causal-evidence-rubric`。
- [ ] T133-F 多轮人类式提示轨迹任务：Codex 以研究者身份在 SciForge UI 中多轮推进同一复现任务，故意包含澄清、追问、失败修复、数据缺失、参数调整、结果解释、质疑论文结论和继续分析；每轮必须保存 prompt、selected refs、tool calls、generated code、stdout/stderr、artifact refs、verification results、repair attempts 和 human-readable rationale。
- [ ] T133-G 反证与负结果任务：为每篇论文至少设计一个可能推翻或削弱主结论的检查，例如 batch/stage confounding、peak caller/threshold sensitivity、gene length/expression confounding、replicate consistency、public dataset mismatch、annotation version drift；负结果必须能形成强质疑 artifact，而不是被 validation/repair 流程强行修成支持论文。
- [ ] T133-H 通用分析环境任务：建立可复用的 bioinformatics execution profile，声明常用工具需求、Python/R package、genome annotation/cache、下载预算、CPU/内存/时间预算和可降级策略；所有工具选择必须经 capability manifest/broker/harness，而不是在某个论文任务里写死命令。
- [ ] T133-I 科学复现 artifact schema 任务：沉淀通用 schema：`paper-claim-graph`、`dataset-inventory`、`analysis-plan`、`analysis-notebook`、`figure-reproduction-report`、`evidence-matrix`、`claim-verdict`、`negative-result-report`、`trajectory-training-record`；每个 schema 必须有 validator、repair hints、view manifest 和 refs-first 大对象策略。
- [ ] T133-J 复现质量 verifier 任务：建立通用 verifier，检查 claims 是否有对应 evidence、figure 是否有可执行代码或明确不可复现原因、数据 accession 是否核验、统计方法是否记录、参数是否可追溯、结论是否区分 reproduced/partially-reproduced/not-reproduced/contradicted；verifier 失败进入现有 validation/repair/audit pipeline。
- [ ] T133-K 训练数据导出任务：把一次完整复现过程导出为模型训练可用的 trajectory bundle，包含 state/action/observation、decision rationale、artifact lineage、失败与修复、人工式提示策略、最终 claim verdict；导出格式必须去除本地绝对敏感路径或以 workspace refs 替代。
- [ ] T133-L UI/交互压力测试任务：用上述复现任务测试 SciForge 是否能在长任务中清晰显示阶段进度、artifact 关系、失败原因、可继续操作点、证据矩阵、figure reproduction 状态和 claim verdict；发现问题只补通用 UI/contract/view 能力，不做论文专属展示。

验收标准：

- [ ] 至少完成 2020 和 2025 两篇研究论文各一个端到端复现 attempt，允许结论为 partial/not-reproduced/contradicted，但必须证据链完整。
- [ ] 2022 综述至少被用于生成可复用的因果证据 rubric，并实际评估 2020/2025 的主结论。
- [ ] 所有新增能力都通过 manifest/schema/verifier/harness/capability broker 暴露，不出现论文标题、文件名、gene 名或 figure id 驱动的硬编码逻辑。
- [ ] 每个 attempt 都能从 `trajectory-training-record` 重建：人类式多轮提示、工具调用、代码、输出、artifact、验证、失败、修复和最终 verdict。
- [ ] 数据不可得、工具失败、统计不支持论文结论时，SciForge 输出 structured negative result，而不是编造数据或把失败包装成成功。
- [ ] 相关 smoke/golden fixture 使用可脱敏的小样本或 mock provider，验证通用 contract 和 failure semantics，不依赖 live 数据源稳定性。

