# BioAgent - PROJECT.md

最后更新：2026-05-03

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；BioAgent 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；BioAgent 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 开发者不应为一次任务缺口手工写死专用科研脚本；只能补通用协议、权限、安全边界、runner 能力、context contract、promotion 机制和 UI/artifact contract。
- TypeScript 主要负责 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排；科学任务执行代码优先作为 workspace-local Python/R/notebook/CLI artifact 生成。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。

## 任务板

### T079 Computer Use 长对话 Context Window 复验与开销优化

状态：进行中。

#### 背景
- 需要用浏览器真实跑 20+ 轮复杂对话，确认 context window meter、AgentServer 会话复用、prefix cache / cache read 观测和 context compaction 事件在 UI 中一致。
- context window 的用户可见显示不能把 provider cumulative token usage 误读成当前窗口占用；provider usage 应作为成本/缓存观测，当前窗口优先使用 native/AgentServer/本地估算。
- 后续轮次应复用 AgentServer session / Core snapshot / stable conversation ledger，而不是每轮让 BioAgent 重新塞完整背景。

#### TODO
- [x] 修正前端 context window 状态选择：忽略 provider-usage 作为 meter 主数据，保留其 token/cache 观测。
- [x] 修正 workspace runtime compaction 事件：preflight、context-window recovery、rate-limit retry 都输出标准 `contextCompaction` 与 after state。
- [x] 扩展浏览器 smoke：调低 max context window，覆盖 24 轮 ledger、两次 UI 可见 compaction 事件和 meter 回落。
- [x] 用 Computer Use 打开浏览器复测真实长任务路径，检查 meter、日志、结果区和 session 复用。
- [ ] 用真实人工浏览器对话跑满 20+ 轮，并观察至少两次真实 AgentServer/backend compaction tag。
- [x] 修复 persistent budget exceeded 时 context snapshot 阻断 compact/recovery 的 backend 路径，并复测 UI `last compacted`。
- [x] 修复运行中 contextWindowState 覆盖 preflight compaction timestamp，避免 `last compacted` 从真实时间回退到 `never`。
- [x] 放大并打通 AgentServer/BioAgent 的可配置 context window：UI 设置的 `maxContextWindowTokens` 会进入 AgentServer context snapshot / budget，而不是继续被固定 20K 估算覆盖。
- [x] 增加通用 artifact 访问策略：后续轮默认 refs/summary-first，必要时 bounded excerpt，避免每轮把大 artifact 全量回放给 backend。
- [x] 换新研究话题用浏览器真实复测：GLP-1 receptor agonists 与 AD/认知衰退/神经炎症，不复用 KRAS/PDAC 案例。
- [x] 增加通用文献核验护栏：PMID/DOI/trial/citation 修正必须证明标题/年份/期刊/identifier 是同一篇 work；不匹配时保留原记录并标记 `needs-verification`。
- [x] 跑 focused tests / smoke，并记录剩余风险。

#### 当前结果
- 前端 meter 主状态只信任 native / AgentServer / 本地估算窗口；provider usage 仍显示在用量 badge 和日志中，用于观察 token/cache 成本，但不再误导为当前 context window 占用。
- preflight、context-window exceeded recovery、rate-limit retry 的压缩事件统一为 `contextCompaction`，并携带 after state，UI 能稳定显示“上下文压缩”。
- 24 轮浏览器 smoke 验证 conversationLedger append-only、recentConversation bounded、两次 UI 可见 compaction、压缩边界后 meter 允许下降、非压缩轮继续累计。
- Computer Use 可视检查打开了本地 BioAgent，真实执行 KRAS G12D / PDAC 文献证据评估 5 轮：R1 生成 paper-list/knowledge-graph/research-plan，R2 生成 research-report，R3 生成 audit-report，R4 生成 corrected-knowledge-graph，R5 因 backend fetch failed / acceptance repair 未完成而失败。
- 真实 artifact 不是 toy/template：`paper-list.json` 约 10KB/12 篇，`research-report.json` 约 18KB，`audit-report.json` 约 31KB/43 issues，`corrected-knowledge-graph.json` 约 12KB/21 nodes/21 edges。
- 复现的真实问题：4K max window 下 R4/R5 meter 到 104%-132% exceeded，provider cumulative token usage 到 7.4M+，但 `last compacted` 仍为 never；AgentServer 当前 work 里已有 `full-moow6nxn-f9db85` compaction tag，UI 没有把它接入当前 BioAgent meter。
- 已修复 AgentServer compact 路径：`/context` 仍保持 persistent hard budget gate，但 `/compact` 可在预算超限时读取当前 work；当前 work 已只有 compaction tag 时，`/compact` 返回最近真实 tag，而不是 `null`。
- AgentServer 实测 `/compact` 返回真实 tag：`full-moow6nxn-f9db85`，`kind=compaction`，`turns=turn_37-turn_40`，`mode=full`，`createdAt=2026-05-02T22:07:13.067Z`，summary 5 条。
- 通过 Computer Use 第 06 轮复测：发送后 UI 一度把 `last compacted` 从 `never` 更新为 `2026-05-02T22:07:13.067Z`，证明 BioAgent 能接入 backend 真实 compaction tag；随后运行态 contextWindowState 又擦掉该 timestamp，已用前端合并逻辑和单测修复。
- 第 06 轮恢复性审计不是模板：backend 实际读取了 `paper-list`、`research-report`、`audit-report`、`corrected-knowledge-graph` 等已有 artifact 文件；但后续追问成本失控，用户中断前 provider usage 达到 `709879 in / 19888 out / 729767 total`，暴露“压缩后续问仍重复读/回放过多上下文”的真实成本问题。
- AgentServer 已支持 request/metadata 传入 `maxContextWindowTokens`，并有 preflight 单测覆盖 64K window；浏览器侧当前显示 `6,597 / 200,000 tokens`，provider cumulative usage 同屏达到 `2,190,662 total`，证明 UI meter 没有再把 provider usage 当作当前 context window。
- AgentServer responses bridge 已覆盖“大 tool output 历史回放前压缩”的通用路径，防止下一轮 replay 直接塞回完整工具输出，降低多轮续问成本。
- BioAgent 两条 AgentServer handoff 路径都加入 `artifactAccessPolicy`：显式 refs、reusable artifact refs、recent execution refs 去重后进入 `agentContext`，并向用户可见事件说明“refs/summary 优先，核实时 bounded excerpt”。
- Computer Use 新话题真实复测 3 轮 GLP-1/AD：R1 生成 `glp1-ad-paper-list-round1.json`、`glp1-ad-evidence-matrix-round1.json`、`glp1-ad-knowledge-graph-round1.json`、`glp1-ad-research-plan-round1.json`、`glp1-ad-gap-list-round1.json`；R2 在 Workspace Writer 短暂不可用时走 AgentServer fallback，只产出审计摘要；R3 在 Writer 恢复后产出 `glp1-ad-correction-report-round3.json` 和 `glp1-ad-corrected-paper-list-round3.json`。
- R3 handoff 确实是 bounded/ref-first：页面显示 `handoff 22111/220000 bytes`，`5,528 normalized / 10,568 raw`，`saved 5,040`；后续运行 provider usage 很高，但 context window 仍保持几千 token 级别。
- GLP-1/AD artifact 不是 toy/template，但真实性核验结果不能接受为完全正确：例如 ELAD/liraglutide 把 protocol PMID `30944040` 当作结果修正来源，population cohort 被替换成 pooled RCT dementia paper，REWIND/dulaglutide 被拿来修正“GLP-1 RA vs other medications”的宽泛 cohort claim；这些都说明 backend 需要强制 title/identifier 同篇匹配，而不是搜索到相近主题就应用修正。
- 已在 AgentServer generation prompt 层加入通用 bibliographic verification contract，要求 `original_title` / `verified_title` / `title_match` / `identifier_match` / `verification_status` / `verification_notes` 可审计，并禁止把 title/topic mismatch 的检索结果当 correction 应用。
- Focused BioAgent tests 通过：`npm run test -- src/ui/src/api/bioagentToolsClient.test.ts src/ui/src/api/agentClient.test.ts src/ui/src/contextCompaction.test.ts` 实际执行全套相关 tests，`122 pass / 0 fail`；`npx tsc --noEmit --pretty false` 通过。
- Focused AgentServer tests 通过：`npm run test -- tests/agent-server-preflight-compaction.test.ts tests/codex-chat-responses-adapter.test.ts tests/codex-app-server-adapter.test.ts` 实际执行当前 tests，`93 pass / 0 fail`。
- 真实浏览器 20+ 人工轮次与至少两次真实 AgentServer/backend compaction tag 仍未完成；当前只有 smoke 证明 24 轮 UI 事件，两次真实 backend compaction 还需要继续压测。

### T078 多轮上下文复用、Context Window 计量与 Token 开销优化

状态：已完成。

#### 背景
- 10 轮以上复杂续问时，BioAgent 需要像 Codex 桌面版一样复用同一会话背景：长期事实走 workspace refs 和稳定 ledger，最近消息负责短期意图。
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
你负责实现 BioAgent 的 T077：Design System / Theme Package 模块化。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 新增 packages/design-system，沉淀 BioAgent 的基础 UI primitives 与 theme tokens。
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

### T076 Object Reference / Chat Context Package 模块化

状态：已完成。

#### 背景
- 当前 object reference、BioAgentReference、DOM selection、uploaded artifact reference、object chip 展开、run/message/file/artifact 引用互转等逻辑主要散在 `ChatPanel.tsx` 与 `ResultsRenderer.tsx`。
- 这些逻辑决定多轮对话中“基于这个对象继续”“点击对象预览”“批注转上下文”等能力，应该成为稳定的上下文指针系统。
- 拆出独立包后，Chat、Results、Feedback、Component Workbench、未来 Notebook/Timeline 都能复用同一套引用语义。

#### TODO
- [x] 新增 `packages/object-references` 或 `src/ui/src/references` 过渡模块，定义 reference normalization、conversion、trust/status、display label、stable selector/hash。
- [x] 从 `ChatPanel.tsx` 抽出 BioAgentReference/ObjectReference 互转：message/run/artifact/file/ui-element/selection 引用构造。
- [x] 从 `ChatPanel.tsx` 抽出 object chip 数据逻辑：可信对象排序、隐藏对象展开、label/icon/status 计算。
- [x] 从上传文件链路抽出 uploaded artifact -> BioAgentReference/ObjectReference 的构造逻辑。
- [x] 从 DOM selection/feedback 链路抽出 stable selector、selected text reference、element path/hash。
- [x] 为 ResultsRenderer 提供统一 `referenceToPreviewTarget` 或 `referenceToArtifactLookup` helper，减少两边重复猜 ref。
- [x] 增加单测覆盖：artifact ref 标准化、file ref/path ref、UI element ref、selection ref、重复 reference merge、可信对象排序。
- [x] 更新 README：说明该包是 BioAgent 的对象记忆和上下文指针系统，不负责渲染 UI 或执行任务。

#### 并行实现 Prompt
```text
你负责实现 BioAgent 的 T076：Object Reference / Chat Context Package 模块化。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 把 ChatPanel.tsx / ResultsRenderer.tsx 中的对象引用、上下文引用、DOM selection reference、uploaded artifact reference 逻辑抽成可复用模块。
2. 建立稳定的 ObjectReference/BioAgentReference normalization 和 conversion API。
3. 不改变用户可见行为：object chips、点击聚焦、上传文件引用、多轮上下文都不能回退。

执行要求：
- 先阅读 ChatPanel.tsx 中 referenceForUploadedArtifact、objectReferenceForUploadedArtifact、ObjectReferenceChips、BioAgentReferenceChips、DOM selection reference 相关函数。
- 再阅读 ResultsRenderer.tsx 中 artifactForObjectReference、pathForObjectReference、WorkspaceObjectPreview 相关引用解析。
- 优先抽纯函数，避免一开始移动大型 React 组件。
- 新增 focused tests，保证 artifact:*、file:、folder:、url:、ui-element、selection 等 ref 都能稳定转换。
- 如果选择 packages/object-references，需要设置 package.json、types、README；如果先用 src/ui/src/references，README 中说明后续提升为 package。

验收：
- npm run typecheck
- npm run test
- npm run build

交付说明：
- 列出迁出的函数和新 API。
- 说明 ChatPanel/ResultsRenderer 还剩哪些引用逻辑未迁移。
- 说明如何被 Feedback/Timeline 复用。
```

### T075 Runtime Gateway Adapter 化与 Repair/Context/Artifact 模块拆分

状态：已完成。

#### 背景
- `src/runtime/generation-gateway.ts` 当前超过 5000 行，混合 AgentServer 请求、workspace runner、context window、repair/rerun、payload normalization、artifact materialization、rate-limit diagnostics 等职责。
- 该文件是 BioAgent 运行时最关键的中枢，但过长会导致 bug 定位困难、backend 扩展困难、用户意图被 prompt/context 改写时难以追踪。
- 需要先在 `src/runtime/gateway/*` 内部模块化，稳定后再考虑提升为 `packages/runtime-gateway`。

#### TODO
- [x] 新建 `src/runtime/gateway/`，按职责拆出纯模块和 adapter。
- [x] 拆出 `gateway-request.ts`：normalizeGatewayRequest、selected components、expected artifacts、LLM endpoint config。
- [x] 拆出 `agentserver-adapter.ts`：AgentServer generation/repair/stream/read status 请求。
- [x] 拆出 `context-envelope.ts`：buildContextEnvelope、compact context、workspace tree summary、context budget。
- [x] 拆出 `payload-normalizer.ts`：parse/coerce/normalize ToolPayload、claims、artifacts、uiManifest、executionUnits。
- [x] 拆出 `artifact-materializer.ts`：artifact refs 持久化、file/csv/text ref 读取、artifact data enrichment。
- [x] 拆出 `repair-policy.ts`：repair-needed payload、repair prompt、retry budget、recover actions、failure diagnostics。
- [x] 拆出 `workspace-runner-adapter.ts`：runPythonWorkspaceSkill、workspace task result 转 ToolPayload。
- [x] 为每个模块补 focused tests 或迁移已有 smoke 覆盖，保证外部 `runWorkspaceRuntimeGateway` API 不变。
- [x] 拆分过程中保持行为兼容，不做 prompt 策略重写；只做边界整理和测试。

#### 并行实现 Prompt
```text
你负责实现 BioAgent 的 T075：Runtime Gateway Adapter 化与 Repair/Context/Artifact 模块拆分。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 将 src/runtime/generation-gateway.ts 拆成 src/runtime/gateway/* 模块。
2. 保持 runWorkspaceRuntimeGateway 外部 API 和现有行为不变。
3. 让 AgentServer adapter、context envelope、payload normalizer、artifact materializer、repair policy、workspace runner 边界清晰。

执行要求：
- 先用 rg 查看 generation-gateway.ts 的函数分布和已有 smoke tests。
- 从纯函数开始迁移，例如 payload normalization、context normalization、request normalization。
- 每次迁移一组函数后跑 typecheck 或相关测试，避免大爆炸。
- 不重写 prompt 策略，不改变 repair/rerun 语义；本任务是模块化，不是行为重构。
- 注意不要破坏 src/runtime/workspace-server.ts 和 smoke tests 对 gateway 的调用。

验收：
- npm run typecheck
- npm run test
- 至少运行相关 smoke：smoke:agentserver-generation、smoke:agentserver-acceptance-repair、smoke:workspace-scenarios、smoke:runtime-contracts
- npm run build

交付说明：
- 列出新建 gateway 模块。
- 说明 generation-gateway.ts 还保留哪些 orchestration 逻辑。
- 说明未来如何提升为 packages/runtime-gateway。
```

### T074 Scenario Compiler Package 独立化

状态：已完成。

#### 背景
- `src/ui/src/scenarioCompiler/*` 已经相对模块化，负责将 skills/tools/artifacts/UI components/用户选择编译成 `ScenarioPackage`、`SkillPlan`、`UIPlan` 与 quality report。
- 这套能力不应长期绑定在 UI 源码目录下；Scenario Builder、AgentServer、CLI、tests、workspace package authoring 都应该复用同一个 compiler core。
- 独立后可以把“场景编译规则”与“页面交互”分离，降低 UI 改动污染 runtime contract 的风险。

#### TODO
- [x] 新增 `packages/scenario-core`，迁移或代理 scenario compiler 类型和纯函数。
- [x] 明确 package 输入：skill manifests、tool manifests、ui component manifests、scenario specs、用户 selection/draft。
- [x] 明确 package 输出：ScenarioPackage、SkillPlan、UIPlan、ValidationReport、QualityReport、ElementRegistry。
- [x] 将 `src/ui/src/scenarioCompiler/*` 中可纯函数化的逻辑移入 package，UI 目录保留薄 adapter 或 re-export。
- [x] 去除 compiler 对 React/UI 页面状态的隐式依赖，确保 Node smoke/CLI 可直接调用。
- [x] 更新 ScenarioBuilderPanel 使用 package API，不再直接耦合内部文件路径。
- [x] 为 package 增加 README：Agent quick contract 说明如何编译；Human notes 说明扩展 artifact/component/skill registry 的规则。
- [x] 迁移/新增测试，保持现有 scenarioPackage、elementRegistry、runtimeSmoke、qualityGate 测试通过。
- [x] 保持当前 packages/skills、packages/tools、packages/ui-components 聚合入口仍是 compiler 的唯一能力来源。

#### 并行实现 Prompt
```text
你负责实现 BioAgent 的 T074：Scenario Compiler Package 独立化。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 新增 packages/scenario-core，将 src/ui/src/scenarioCompiler 中的纯编译逻辑独立成可复用 package。
2. Scenario Builder、测试和未来 CLI 都通过该 package 编译 ScenarioPackage/SkillPlan/UIPlan/QualityReport。
3. 保持现有行为和测试不回退。

执行要求：
- 先阅读 src/ui/src/scenarioCompiler/*、src/ui/src/app/ScenarioBuilderPanel.tsx、packages/skills、packages/tools、packages/ui-components。
- 从类型和纯函数开始迁移，避免把 React 组件或浏览器 API 带进 package。
- 可以先让 src/ui/src/scenarioCompiler/* re-export packages/scenario-core，降低改动面。
- 保持 element registry 的唯一来源：packages/skills、packages/tools、packages/ui-components。
- 不要改 UI 视觉，不要重写 Scenario Builder 交互。

验收：
- npm run typecheck
- npm run test
- npm run build
- 重点关注 scenarioPackage、elementRegistry、runtimeSmoke、qualityGate 相关测试。

交付说明：
- 列出 packages/scenario-core 的结构和导出 API。
- 标明哪些旧文件已变成 adapter/re-export。
- 说明后续 AgentServer/CLI 如何复用 compiler core。
```

### T073 白天模式视觉系统重做与全局 Style 覆盖

状态：已完成。

#### 背景
- 当前项目已加入 `theme: dark | light` 与顶部切换按钮，但白天模式只是初步变量替换，视觉效果粗糙，部分 UI 仍保留深色背景、深色边框或暗色阴影。
- 用户希望整个项目真正支持“白天/黑夜”两种 style，而不是少量区域换色；Workspace explorer、Scenario Builder、Chat、Results、Component Workbench、Settings、反馈批注层都应统一。
- 该任务应把主题能力沉淀为可维护的 design token / component style 体系，避免后续每个页面单独补丁。

#### TODO
- [x] 盘点所有硬编码暗色 CSS：`rgba(5, 8, 16, ...)`、`rgba(10, 15, 26, ...)`、深色 slate/blue 背景、固定白字等，替换为语义变量。
- [x] 扩展主题 token：surface、surface-muted、surface-raised、border、border-strong、text-primary、text-secondary、accent、warning、danger、shadow、focus-ring。
- [x] 为白天模式重新设计视觉基调：干净、科研工具感、低噪音、清晰层级，不使用大面积单一浅蓝或灰蒙蒙背景。
- [x] 覆盖核心布局：sidebar/activity bar、topbar、dashboard、workbench grid、chat panel、composer、results panel、settings modal、component workbench、scenario builder、workspace explorer、feedback overlay。
- [x] 白天模式下所有按钮、输入框、badge、tab、card、details、scrollbar、object chip、message key info 都要有足够对比度和 hover/focus 状态。
- [x] 保持黑夜模式视觉不回退；主题变量改造必须不破坏当前 dark style。
- [x] 增加主题 smoke 检查：至少验证 dark/light class 生效、关键 CSS 变量存在、硬编码暗色样式数量下降。
- [x] 使用浏览器或截图检查桌面宽屏与窄屏下白天模式没有文字重叠、不可读、局部仍黑底的问题。

#### 并行实现 Prompt
```text
你负责实现 BioAgent 的 T073：白天模式视觉系统重做与全局 Style 覆盖。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 让 app 的 light theme 真正可用、好看、统一，而不是只替换少量 CSS 变量。
2. 将 CSS 中页面级硬编码暗色逐步收敛到语义 token，保持 dark theme 不回退。
3. 覆盖 sidebar、workspace explorer、topbar、chat、composer、results、scenario builder、component workbench、settings modal、feedback overlay。

执行要求：
- 先用 rg 扫描 src/ui/src/styles 下的硬编码深色背景/边框/文字。
- 优先改 theme token 和共用组件样式，再补页面局部样式。
- 不要引入新的设计系统库。
- 不要做营销式大渐变或装饰性背景；保持科研工作台气质。
- 检查所有输入框、按钮、chips、badges、details、scrollbar 在 light mode 下可读。
- 如果需要新增测试，优先加轻量 smoke/token 检查。

验收：
- npm run typecheck
- npm run test
- npm run build
- 浏览器中切到白天模式，至少检查 workbench、scenario builder、results、workspace explorer、settings。

交付说明：
- 列出改动文件。
- 说明哪些硬编码暗色被替换成 token。
- 说明 dark mode 如何保证不回退。
```

### T072 Package-native UI Components 与 Artifact Preview Runtime 模块化

状态：待实施。

#### 背景
- `packages/ui-components/*` 已经有 `package.json`、`manifest.ts`、`README.md`，但真实渲染实现仍集中在 `src/ui/src/app/ResultsRenderer.tsx`。
- Artifact preview 相关逻辑也仍混在 ResultsRenderer 中，包括 descriptor 归一化、workspace object preview、PDF/image/text/table/json/html/structure fallback 和 preview actions。
- 用户希望 packages 下面的模块像真正独立发布包一样工作：每个 UI component 可以独立调试、测试、发布，再由主 app registry 组合。
- 本任务先覆盖两个模块化方向：“UI Component Packages 真正独立化”和“Artifact Preview 独立包”，不处理 Runtime Gateway 大拆分。

#### TODO
- [x] 定义组件包运行时接口：每个 `packages/ui-components/<name>` 除 `manifest.ts` 外，新增 `render.tsx` 或等价入口，导出该组件的 renderer。
- [x] 先迁移两个样板组件：`report-viewer` 与 `data-table`，让它们从 `ResultsRenderer.tsx` 移到各自 package 内。
- [x] 为样板组件增加 `fixtures/` 与轻量测试，验证 manifest、renderer、空状态、基础 payload 渲染契约。
- [x] 新增 `packages/artifact-preview` 包，承载 PreviewDescriptor 归一化、DescriptorPreview、WorkspaceObjectPreview、preview actions 和 fallback registry。
- [x] 将 ResultsRenderer 改为“view plan + slot binding shell”：只选择 module、artifact、focus object，把渲染委托给 component package 或 artifact-preview package。
- [x] 保持现有 object focus、PDF/image preview、system-open fallback、evidence/result tab 行为不回退。
- [x] 建立迁移边界：未迁移组件继续走 legacy renderer adapter，但新包接口是唯一目标路径。
- [x] 更新 `packages/ui-components/README.md`，说明 component package 的文件结构、agent quick contract、人类维护说明、测试和发布标准。
- [x] 更新 package catalog 校验，至少检查 published component package 是否有 manifest、README、package.json；样板包还要有 renderer 和 fixtures。
- [x] 运行 typecheck/test/build，必要时补充 focused unit test，防止 ResultsRenderer 行为回退。

#### 并行实现 Prompt
```text
你负责实现 BioAgent 的 T072：Package-native UI Components 与 Artifact Preview Runtime 模块化。

工作目录：/Applications/workspace/ailab/research/app/BioAgent

目标：
1. 让 packages/ui-components 下的组件包从“只有 manifest”升级为“包含 renderer/fixtures/tests 的可独立发布模块”。
2. 先迁移 report-viewer 和 data-table 两个样板组件。
3. 新增 packages/artifact-preview，用于承载 PreviewDescriptor 归一化、WorkspaceObjectPreview、DescriptorPreview、preview actions 和 fallback registry。
4. ResultsRenderer 退回为结果区 shell，不再继续堆所有组件/preview 实现。

执行要求：
- 先阅读 ResultsRenderer.tsx 中 ReportViewerSlot、DataTableSlot、WorkspaceObjectPreview、DescriptorPreview、normalizeArtifactPreviewDescriptor 相关逻辑。
- 设计最小 package renderer 接口，避免一次性迁移所有组件。
- 优先保证行为兼容：object focus、report 渲染、data table、PDF/image preview、system-open fallback 不回退。
- 未迁移组件可以保留 legacy adapter，但新样板组件必须从 packages 导入 renderer。
- 不要大规模改视觉样式；视觉任务由 T073 负责。
- 更新 packages/ui-components/README.md 和 package catalog 校验。

验收：
- npm run typecheck
- npm run test
- npm run build
- 至少新增或更新测试覆盖 report-viewer/data-table package renderer 与 artifact-preview descriptor 归一化。

交付说明：
- 列出新增 package 结构。
- 标明哪些逻辑已从 ResultsRenderer 移出。
- 标明哪些组件仍走 legacy adapter，后续如何继续迁移。
```

### T071 Tools 递归 SKILL.md 发现与 Package Source 收敛

状态：已完成。

#### 背景
- 用户重新整理了 `packages/tools`，要求 tool 和 skill 一样只维护 `SKILL.md`，任意目录深度都可以被发现。
- 用户明确边界：`skill 是 agent 可选择的工作策略，tool 是 skill 可调用的执行资源。`
- `scp-skill`、`markdown-skill` 不应继续作为 package source；`packages/skills` 与 `packages/tools` 在来源语义上应对等，统一为 `package`，SCP、ClawHub 等只作为 provider/tag 元数据。

#### TODO
- [x] 扩展递归 Markdown catalog，支持 `packages/tools/**/SKILL.md` 发现和 tool manifest 生成。
- [x] 将 skill/tool package source 收敛为 `package`，保留 `scp`、`clawhub` 等 provider 信息在 tags/metadata 中。
- [x] 新增 `packages/tools/clawhub/playwright-mcp/SKILL.md`，记录 ClawHub Playwright MCP 的 MCP 启动契约。
- [x] 更新 `packages/skills/README.md` 与 `packages/tools/README.md`，分别说明 agent quick contract、人类阅读说明，以及 skill/tool 边界。
- [x] `packages:check` 校验 skills/tools 生成清单与当前 `SKILL.md` 文件集合一致。

### T070 递归 SKILL.md 发现与 Markdown-only Skill Registry

状态：已完成。

#### 背景
- 用户重新整理了 `packages/skills`，要求 agent 使用 skill 时只读取 `SKILL.md`，不依赖额外 `manifest.json` 或手写 TypeScript 清单。
- `packages/skills` 目录层级不固定，可能是 `packages/skills/installed/scp/.../SKILL.md`、`packages/skills/installed/xejrax/.../SKILL.md` 或更深层结构。
- 因此 skill registry 必须递归发现任意层级 `SKILL.md`，并从 Markdown/frontmatter/正文推断 id、description、domain、artifact types 和 runtime contract。

#### TODO
- [x] 新增递归 `SKILL.md` catalog parser，支持 frontmatter skill 和普通 Markdown skill。
- [x] Runtime skill registry 改为每次从 `packages/skills/**/SKILL.md` 发现 package skills，不再从 `packages/skills/index.ts` 读取运行时事实。
- [x] 前端使用的 `packages/skills/index.ts` 改为由 `npm run skills:generate` 从当前 `SKILL.md` 自动生成，避免手写清单漂移。
- [x] `npm run packages:check` 自动重新生成 skill catalog，并校验生成结果与当前 `SKILL.md` 文件集合一致。
- [x] 支持任意目录深度下的 `SKILL.md`，当前验证发现 122 个 skills，其中 121 个 SCP skills 与 1 个本地 pdf-extract skill。
- [x] Scenario Builder/Element Registry 改为接受 Markdown skill packages，不再要求 core/seed skill 存在。
- [x] Built-in scenario 默认 skill plan 改为 Agent backend generated capability，避免旧固定 skill id 污染用户意图。
- [x] 更新 smoke/unit 测试，验证 SKILL.md registry、SCP skill 发现、pdf-extract skill 发现和 unavailable workspace skill 隔离。

### T069 Packages-only Skills/Tools 运行时重构与旧目录清理

状态：已完成。

#### 背景
- 用户确认 `seed skills` 没有继续作为独立旧目录维护的价值；skills/tools 的唯一事实来源应是 `packages/skills` 与 `packages/tools`。
- `packages` 下的内容必须自成模块、可独立发布，不能引用 `workspace/skills`、`skills/seed`、`skills/installed` 或 UI 旧 catalog。
- 若新包化架构与旧逻辑冲突，优先删除旧代码并重写运行时入口，保持干净的唯一来源。

#### TODO
- [x] 运行时 skill registry 改为从 `packages/skills` 聚合内置 skill package，并只额外读取当前 workspace 的 `.bioagent/evolved-skills`。
- [x] 删除 `skills/seed` 旧目录，不再把 seed skill 当作独立运行时根。
- [x] 删除前端 `scpSkillCatalog` 旧 catalog，扩展/技能侧栏改为直接读取 `packages/skills` 与 `packages/tools`。
- [x] Workspace server 的稳定技能根声明改为 `packages/skills` 与 `.bioagent/evolved-skills`。
- [x] Package 校验器增加 legacy path guard，禁止 `packages/**` 引用 `skills/seed`、`skills/installed`、`workspace/skills` 或旧 catalog。
- [x] Smoke 测试改为验证 package skill/tool 架构，不再假设 `skills/installed/scp` 或 `skills/seed` 存在。
- [x] 保持 self-evolving skills 隔离：新技能只进入 workspace `.bioagent/evolved-skills`，不会写回内置 packages。

### T068 Packages 化能力目录、README 双层文档与完整元素 Registry

状态：已完成。

#### 背景
- 组件工作台证明了“用户勾选组件白名单，再由 Agent 查询/配置”的模式更稳定；下一步应把每个 UI 组件拆成可独立发布的代码包，而不是继续把 manifest 写死在主应用 registry。
- 用户进一步确认：所有 skills 和 tools 也应整理成独立发布包，统一放在 `packages/` 下，而不是散落在主应用、旧 seed 目录和 SCP catalog 里。
- 每个组件包都需要 README，但 README 要分两层：Agent 只读取最短的 `Agent quick contract`，人类维护者阅读更完整的设计、测试、fallback 和发布说明。
- 批注指出 Scenario Builder 中支持的 skills/tools/artifacts 不全：元素面板仍按当前 domain 和固定截断展示，且底层 registry 漏掉部分 SKILL.md/SCP 派生工具，导致用户以为系统能力比真实能力少。
- 若旧逻辑和新包化结构冲突，优先删除旧的主应用硬编码清单，改为从组件包 manifest 聚合，保证唯一真相源干净。

#### TODO
- [x] 新增 `packages/ui-components` workspace 包，作为 UI component package 聚合入口。
- [x] 为每个已发布组件建立独立目录、`package.json`、`manifest.ts` 和 `README.md`。
- [x] 新增 `packages/skills` workspace 包，将现有 SKILL.md/SCP skills 机械整理为独立 skill package。
- [x] 新增 `packages/tools` workspace 包，将 built-in/native/fallback/SKILL.md/SCP 派生工具整理为独立 tool package。
- [x] README 统一拆分为 `Agent quick contract` 与 `Human notes`，方便 agent 只读必要短契约，人类阅读详细说明。
- [x] 主应用 `uiModuleRegistry` 删除旧硬编码数组，改为从 `packages/ui-components` 聚合 manifest。
- [x] 根 `package.json`/`tsconfig.json` 纳入组件、skill、tool 包目录，后续可独立测试、发布和类型检查。
- [x] Scenario Builder 的组件候选从完整 component registry 派生，不再局限于当前 scenario allowed/default 集合。
- [x] Scenario Builder 的 skills/tools/artifacts 面板展示完整 registry，并按当前 domain/已选择优先排序，不再截断成 24 个。
- [x] Element registry 补入遗漏 package skill 与 SKILL.md/SCP 派生 tool entries，解决批注中 skills/tools/artifacts 不全的问题。
- [x] 增加 packages README/manifest 一致性校验，确保 agent quick contract 与 manifest 不漂移。
- [x] 增加 packages 发布前质量门禁，确认子包具备独立 `package.json`、version 和非 private 发布条件。

### T067 独立 UI Component Workbench 与可选组件白名单

状态：已完成。

#### 背景
- 用户确认更稳定的工作模式：UI 设计/组件调试应从对话结果面板中拆出来，作为单独页面维护；每个支持组件先在组件库中模块化封装、契约化描述、逐项调试和测试。
- 对话过程中，用户选择本轮允许使用的 UI 组件；Agent 只能从用户勾选的组件库白名单里查询、配置和生成 UI manifest，而不是把场景默认组件当成用户意图。
- 组件库之外的对象仍应走 descriptor-driven preview 或 system-open fallback，不应为了“看起来完整”自动生成 paper-list、evidence-matrix、notebook-timeline 等无关对象。

#### TODO
- [x] 新增独立“组件工作台”导航页，集中展示已注册 UI module 的生命周期、输入 artifact types、输出 artifact types、必需字段、交互事件、安全策略和 fallback。
- [x] 组件页面支持逐个勾选/取消、按生命周期和关键词筛选、批量选择 published 组件、清空选择，并生成本轮组件 contract JSON。
- [x] 组件选择从 UI 页传入对话运行时，作为 `availableComponentIds` 白名单进入 AgentServer/workspace runtime。
- [x] 保持原始意图优先：`availableComponentIds` 只是可查询组件库，`selectedComponentIds` 仍只由当前用户 prompt 显式点名推导，不再强制生成默认 artifacts。
- [x] Workbench manifest banner 标注当前组件库来源与白名单数量，避免误认为 scenario defaults 被强制执行。
- [x] 将结果面板里的“UI设计”调试入口下线，避免组件治理逻辑分散在对话结果区。
- [x] 增加/更新单测覆盖：用户选择组件后请求体包含 `availableComponentIds`，但通用 PDF/skill 问题仍保持 `backend-decides`，不生成默认 evidence objects。

### T066 批注回归：Object Preview、对象展开与原始意图透传

状态：已完成。

#### 背景
- 批注指出 T065 虽已标完成，但上传 PDF object chip 点击后右侧仍没有稳定预览：前端拿到 artifact 自带的轻量 `previewDescriptor` 后没有继续向 Workspace Writer 补全 `rawUrl`，导致 streaming preview 没真正接上。
- 回答中的 object reference strip 会显示 `+N objects`，但该控件只是静态 badge，无法展开检查被隐藏对象。
- 多轮对话中 BioAgent 仍把 Scenario 默认 UI 组件转换成 `expectedArtifactTypes`，让 AgentServer 生成 paper-list、evidence-matrix、notebook-timeline 等当前用户未要求的对象，污染原始意图。

#### TODO
- [x] 上传 artifact 的 object ref 改为标准 `artifact:*`，并带上 path/provenance 与系统打开、打开文件夹、复制路径动作。
- [x] ResultsRenderer 在静态 descriptor 缺少 `rawUrl` 或 lazy derivative 信息时，继续调用 Workspace Writer descriptor API 并合并 streaming descriptor，PDF/图片点击后可进入右侧内联预览。
- [x] object reference strip 将 `+N objects` 改为可展开/收起按钮，隐藏对象可直接查看和点击聚焦。
- [x] 增加本轮 artifact intent 推断：只从原始用户 prompt 的显式需求推导 expected artifacts，不再由场景默认组件强制生成 paper-list/evidence-matrix/notebook-timeline。
- [x] AgentServer handoff 文案改为 backend-decides 优先；expectedArtifactTypes 为空时由 backend 根据原始用户意图决定最小输出。
- [x] UI Design Studio 展示受支持的 object reference kinds、preview descriptor kinds 和 preview actions，明确稳定预览集合与 system-open fallback。
- [x] 增加/更新单测覆盖：上传 PDF 上下文不泄漏 dataUrl、通用 PDF 处理不强塞默认 evidence objects、显式 artifact 列表仍按用户文本顺序传递。

### T065 通用 Artifact Preview Contract 与按需派生预览

状态：已完成。

#### 背景
- 批注指出大 PDF（例如 31MB）仍然无法稳定内联预览：当前链路依赖 Workspace Writer 将整个二进制文件读成 base64，超过预览上限后前端只能显示错误。
- 用户指出 PDF artifact 不应一开始就携带全文、缩略图、页索引、图表区域等所有派生内容；这会增加 artifact 负担、污染上下文，也不利于任何场景泛化。
- 更合理的通用模型是：初始 artifact 只保存原始文件和轻量 metadata；当用户打开预览、搜索、引用页码/区域、请求总结时，再通过统一 preview API 按需生成/缓存派生物。
- 该任务必须覆盖所有 BioAgent 支持的预览类型，形成 backend 可稳定使用的 artifact/preview contract，而不是为当前 PDF、当前论文或当前文献场景打专门补丁。

#### 设计原则
- Artifact 轻量化：原始 artifact 只包含 `id/type/path/dataRef/mimeType/size/hash/title` 等必要 metadata，不默认内联大文件、全文、base64 或完整 JSON。
- 预览按需派生：全文提取、缩略图、分页索引、表格 schema、结构 viewer bundle 等都作为 lazy preview derivative，通过用户动作或 backend 明确请求生成。
- 前后端契约稳定：backend 返回 `previewDescriptor`，前端根据 descriptor 选择预览器；Workspace Writer 负责 raw streaming、range、derivative cache 和安全路径解析。
- 降级体验稳定：内联预览失败时不能把错误作为主结果；应展示可用替代视图（文本摘要、缩略图、metadata、系统打开、复制引用），详细错误折叠到 diagnostics。
- 引用语义优先：用户引用的是文件、页码、区域、表格行列、分子残基、图像 ROI 等语义对象，而不是 base64 或脆弱 DOM/path 字符串。
- Backend-neutral：Codex/OpenTeam/Hermes/Gemini 等 backend 都通过同一 contract 使用 preview，不依赖某个 agent 的特殊输出格式。

#### Preview Descriptor 草案
- `kind`: `pdf | image | markdown | text | json | table | html | structure | office | folder | binary`
- `source`: `path | dataRef | artifact | url`
- `mimeType`, `sizeBytes`, `hash`, `title`
- `rawUrl`: Workspace Writer 可流式读取的稳定 URL；大文件必须支持 `Range`。
- `inlinePolicy`: `inline | stream | thumbnail | extract | external | unsupported`
- `derivatives`: 可选派生物声明，例如 `textRef`、`thumbRef`、`pagesRef`、`schemaRef`、`previewHtmlRef`、`structureBundleRef`。
- `actions`: `open-inline`、`system-open`、`copy-ref`、`extract-text`、`make-thumbnail`、`select-region`、`select-page`、`select-rows`、`inspect-metadata`。
- `diagnostics`: 只放折叠诊断，不作为主视图内容。

#### TODO
- [x] 定义 `PreviewDescriptor` / `PreviewDerivative` / `ArtifactPreviewAction` domain types，并写入 artifact contract 文档。
- [x] 统一 artifact normalization：从 `path/dataRef/objectReference/artifact.metadata` 生成 descriptor，不再让各组件各自猜字段。
- [x] Workspace Writer 增加 raw file streaming API：支持 workspace-relative path、absolute path 安全校验、`Content-Type`、`Content-Length`、`ETag/hash`、`Range`。
- [x] Workspace Writer 增加 preview descriptor API：`GET /api/bioagent/preview/descriptor?ref=...`，返回稳定 descriptor 和可用 action。
- [x] Workspace Writer 增加 derivative cache API：按需生成并缓存 text/thumb/pages/schema/html/structure bundle，缓存 key 使用 path/hash/action/options。
- [x] PDF：默认只保存原 PDF；预览走 raw streaming/PDF.js；按需生成 `textRef`、`pagesRef`、首页/指定页 thumbnail；支持页码和 normalized region 引用。
- [x] Image/SVG：默认 raw streaming；按需生成 thumbnail；支持 normalized ROI 引用；大图不走 base64 JSON。
- [x] Markdown/Text：小文件可直接读取；大文件分块读取、搜索和 excerpt；主视图显示标题、前若干段和目录。
- [x] JSON：默认展示 schema/key summary；按需表格化 rows/items/records；大 JSON 支持路径选择和 excerpt，不默认全量渲染。
- [x] CSV/TSV/XLSX：按需读取表头、行数、列类型和前 N 行；支持 row/column range 引用；大表格分页。
- [x] HTML：优先 sandboxed preview；不安全或过大时展示截图/文本摘要/system-open；禁止任意脚本影响 BioAgent 页面。
- [x] PDB/CIF/mmCIF：按需生成 3D viewer bundle 或轻量结构 metadata；支持 chain/residue/ligand selection 引用。
- [x] Office/PPTX/DOCX：默认 metadata + system-open；按需转文本/缩略图（可选依赖），失败时展示明确能力缺口。
- [x] Folder：展示目录摘要、文件类型统计和可筛选列表；支持文件选择引用，不递归读取大目录。
- [x] Unknown/Binary：展示 metadata、hash、size、可打开/复制引用；不尝试内联。
- [x] 前端 ResultsRenderer 改为 descriptor-driven preview registry：每个 kind 一个稳定组件和统一 fallback。
- [x] 将当前 base64 PDF/image 内联链路降级为小文件兼容路径，大文件必须走 raw streaming。
- [x] 预览失败 UI 改为“已切换到备用预览/可执行动作”，详细错误折叠到 diagnostics，避免主结果区反复出现 ENOENT/limit 文案。
- [x] Backend 输出指南：要求 AgentServer/skill 只输出轻量 artifact + descriptor hints；派生内容由 preview API 按需生成。
- [x] 引用协议扩展：支持 `file:...#page=...`、`file-region:...`、`table-range:...`、`structure-selection:...` 等稳定 locator。
- [x] 增加单元测试：descriptor 归一化、路径安全、各类型 fallback、preview action 选择、错误折叠。
- [x] 增加 smoke/browser 测试：大 PDF streaming、图片 ROI、CSV 分页、JSON schema、PDB viewer fallback、Office metadata fallback。
- [x] 迁移旧 artifact：兼容现有 `path/dataRef/metadata`，逐步补 descriptor，不破坏历史 workspace。

### T064 Workspace-relative Preview Path 与失败任务重试修复

状态：已完成。

#### 背景
- 批注指出上传 PDF 仍然无法预览：结果区读取 `.bioagent/uploads/...` 时，Workspace Writer 把相对路径解析到了 BioAgent repo 根目录，而上传文件实际写在当前 `workspacePath/.bioagent/uploads/...`。
- 当前任务失败信息显示 AgentServer backend stage failure / invalid tool call id，修复前端预览路径后，需要让用户能够点击已上传对象重新聚焦、预览和引用，再发起同一任务重试。
- 实测重试时还暴露了两个环境/遥测问题：AgentServer 未在 `18080` 运行会导致 `fetch failed`；provider 累计 token usage 不能再被 UI 估算成 context window 占用。

#### TODO
- [x] Workspace Writer GET `/workspace/file` 支持 `workspacePath + relative path`，并拒绝越界路径。
- [x] 前端 `readWorkspaceFile` 请求携带当前 `config.workspacePath`，确保 `.bioagent/uploads/...`、`.bioagent/artifacts/...` 等相对 ref 从工作区根解析。
- [x] 保留 absolute path 兼容，避免破坏已有文件 API。
- [x] 扩展可引用文件类型：PDF/图片/SVG 走内联预览，Office 文档/表格/演示文稿作为可引用对象安全展示。
- [x] 修正 context window 估算：运行日志里的 provider usage 不再推高上下文窗口 meter。
- [x] 启动 AgentServer `18080` 并重试用户任务，确认新 run 完成并产出 summary-report / evidence-matrix / paper-list / notebook-timeline。
- [x] 增加 smoke 覆盖：通过 `workspacePath` 读取相对路径文件。
- [x] 运行 typecheck、build 与 workspace-file smoke 验证。

### T063 Object-focused Result Viewer、引用校验与 Context Budget 收敛

状态：已完成。

#### 背景
- 批注指出结果区信息过载：当前聚焦 run、artifact、preview、核心结果、恢复建议和所有模块同时出现，用户无法按需查看对象。
- 回答中的 object/file chips 里混入了未完成或不可读路径，例如 `summary-report.md`、`output` 等 ref，容易让用户误以为文件已经可用。
- context window meter 显示很快到顶，其中一部分来自把 provider 累计 token usage 当作真实 context window 使用量，另一部分来自前端 handoff 仍携带过长历史、artifact preview 和 reference payload。

#### UX/Runtime 原则
- 用户点击对象才展示对象：右侧结果视图优先显示当前 focused object；清除后回到默认结果。
- 默认结果只展示少量核心内容；更多结果、运行审计和 raw payload 默认折叠。
- 文件预览按类型处理：Markdown/JSON/CSV/TSV/图片/PDF/HTML/文本走内联预览；大 PDF/图片允许 workspace writer 以 base64 返回预览，不把二进制塞进聊天文本。
- 引用必须可解释：artifact refs 优先展示；file/path refs 默认标记为点击后验证，失败时在右侧给出明确原因。
- context window 只在有明确 context telemetry 时显示窗口占用；provider usage 只作为运行指标，不再冒充真实上下文窗口。

#### TODO
- [x] 结果区支持 focused object 模式：点击 object chip 后右侧只优先展示该对象，提供清除展示按钮。
- [x] 收敛默认结果区：object focus 存在时隐藏其它自动推断模块，更多内容折叠。
- [x] Workspace Writer 放宽 PDF/图片二进制预览大小限制，支持上传 PDF/图片内联预览。
- [x] 回答对象 chip 区分可用 artifact 与待验证 file/path，避免未完成文件默认显得已完成。
- [x] context window normalizer 不再用 provider cumulative usage 推断真实 window ratio。
- [x] 缩短前端 AgentServer prompt/metadata 中的历史、artifact data preview 和 reference payload。
- [x] 运行 typecheck/build 验证。

### T062 Codex-like Quiet Conversation Shell

状态：已完成。

#### 背景
- 用户提供了桌面截图 `codex1.png` 和 `codex2.png`，希望 BioAgent 继续向 Codex 桌面端的用户体验靠拢。
- 截图中的核心体验不是改颜色或增加装饰，而是让正文对话更安静：用户消息右置、Agent 回答直接阅读、工具/浏览器/Node/命令过程折叠成一行审计记录、底部输入区像独立 composer 托盘。
- 该改动必须通用适配所有 workspace/scenario/backend，不为当前科研案例写死 UI 或逻辑。

#### UX 对齐原则
- 对话优先：主要回答和用户输入保持阅读区中心，减少运行日志、边框和深色卡片对注意力的争夺。
- 工作过程可审计但默认收起：Runs、stream events、token/backend 指标以低对比行呈现，展开后仍保留 raw copy。
- 输入区像 Codex composer：底部常驻、圆角托盘，保留点选引用、上传、context meter、中断和发送，同时沿用 BioAgent 原有配色。
- 不改变全局配色：侧栏、topbar、背景和结果区保持原有视觉基调，只调整对话节奏与信息层级。
- 结果区保持稳定：科研 artifact、PDF/图片预览、Evidence Matrix 和 ExecutionUnit 不因外观调整丢失可用性。

#### TODO
- [x] 阅读并记录 `codex1.png` / `codex2.png` 的 UX 特征，转成通用验收标准。
- [x] 在 PROJECT.md 新增 Codex-like quiet conversation shell 任务和 TODO。
- [x] 给 Workbench 增加 quiet shell 入口 class，便于后续持续迭代。
- [x] 将聊天消息改成 Codex-like 节奏：用户输入右置，Agent/系统消息更像正文而不是厚重卡片。
- [x] 将工作过程、run strip 和 stream events 降低为默认折叠的审计行。
- [x] 将 composer 改为底部输入托盘，保留引用、上传、context window 和发送控制。
- [x] 回退浅色 app shell/sidebar/topbar 覆盖，保持 BioAgent 原有暗色视觉基调。
- [x] 运行 typecheck/build 验证。

### T061 Codex-like Canvas Shell 与 Context Hover 细节

状态：已完成。

#### 背景
- 用户希望 BioAgent 的聊天工作区更接近 Codex 桌面版的“画布”体验：内容流、运行过程和结果区在同一工作面上自然伸缩，而不是强烈的固定卡片拼接。
- context window 进度条需要在鼠标悬浮或键盘聚焦时展示具体使用情况，不能只依赖浏览器原生 title。
- 该改动必须通用适配所有 scenario/backend，不绑定当前 KRAS、论文或任何单一案例。

#### TODO
- [x] 给 Workbench 增加 canvas shell 语义 class，弱化固定卡片感，保留聊天/结果区的可伸缩与折叠能力。
- [x] 将 context window meter 扩展为 hover/focus popover，展示 used/window/remaining、source/status、backend/model、阈值、压缩与 budget。
- [x] 增加模型层单测，保证 hover 明细中的精确 token/window/remaining 信息可用。
- [x] 用 in-app browser 截图验证 BioAgent 页面视觉效果；Codex 宿主窗口截图受平台安全限制，不绕过。

### T060 Codex-style Agent 工作过程呈现

状态：已完成。

#### 背景
- 用户希望 BioAgent 的多轮对话体验更接近 Codex 桌面版：关键状态、结果和失败原因直接可见，探索、工具调用、stdout/stderr、usage 等过程信息默认折叠为灰色工作日志，可按需展开。
- 现状更像“运行日志面板”：后台事件、token usage、context window、tool delta 混在一个常开区域，容易抢走真正回答和关键状态的注意力。
- 该改动必须 backend-neutral，不能为某个论文、某个场景或某个 agent backend 打补丁。

#### UX 对齐原则
- 关键内容显性：最终回答、失败原因、需要用户处理的 blocker、权限/中断/修复状态、重要 artifact/object refs 必须直接显示。
- 过程内容折叠：探索、阶段切换、工具调用、token usage、健康 context window、text delta、raw event 默认进入灰色折叠工作日志。
- 渐进展开：工作日志默认只显示一行当前状态和计数；展开后每条事件仍保留可折叠详情和 raw copy。
- 语义分层：usage/cost 只显示为运行指标，不冒充 context window；context window 只有明确遥测时才进入 meter。
- 多轮连续：运行中引导、修复、续问和历史 run 都沿用同一套展示规则，不能按当前案例特殊处理。

#### TODO
- [x] 抽象通用 stream event presentation：把事件分类为 key/background/debug，并生成可读摘要、badge、默认折叠状态。
- [x] 改造 ChatPanel 运行中消息：只展示最新关键状态；后台探索和运行细节进入灰色折叠工作日志。
- [x] 改造工作日志 UI：默认收起，展开后每条事件可单独展开，支持复制 raw，保留 token/context 指标但降低视觉权重。
- [x] 增加单元测试：usage-update 不再显示成关键工作内容；context 警告/失败/修复事件保持可见；text delta 合并后进入后台过程。
- [x] 用实际多轮对话案例验证：第一轮轻量任务、第二轮续问/引导，确认关键内容可见、过程日志折叠、展开后可审计。

### T059 全局产品反馈与 Codex 修改闭环

状态：进行中。

#### 背景
- 用户希望 BioAgent 像 Codex 桌面端一样，在任意页面位置留下评论、选择目标对象，并把评论、截图/定位和运行时上下文统一保存。
- 多个用户后续会一起使用产品，反馈需要汇总成结构化 comment bundle，Codex 再按批量评论统一修改代码、发布稳定版本。
- GitHub Issue 可作为团队协作出口，但不应成为原始反馈事实层；原始反馈必须保存在 workspace-local、机器可读的 bundle 中。

#### UX 原则
- 用户只管使用和评论：全局评论模式一键开启，点选任意 UI 元素后填写反馈。
- 评论必须保存可复现上下文：URL、viewport、selector、文本片段、scenario/session/run、artifact/execution 摘要、app version/build id。
- 多用户反馈要可归并：每条 comment 有 author、status、requestId、priority 和 tag；一组 comments 可导出为 Codex change request。
- GitHub Issue 是可选同步出口：issue 只引用/摘要 feedback bundle，不替代原始 JSON。
- 不阻塞正常科研流程：评论层是轻量浮层，退出后不影响当前页面交互。

#### TODO
- [x] 在 PROJECT.md 记录 feedback capture / request / GitHub issue 分层方案。
- [x] 扩展 workspace state/domain：增加 `feedbackComments` 与 `feedbackRequests`，支持多用户 author、status、target、runtime context。
- [x] 增加全局评论模式：任意页面点选元素，捕获 selector、文本、坐标、viewport 和当前运行时摘要。
- [x] 增加反馈收件箱页面：查看、筛选、标记状态、复制/导出 selected feedback bundle。
- [x] 反馈随 workspace snapshot/localStorage 持久化，后续多用户可通过同一 workspace writer 汇总。
- [ ] 增加 GitHub Issue 同步出口：将 selected feedback request 格式化为 issue body，并关联 bundle id。
- [ ] 增加真实截图能力：优先用浏览器/host 能力生成 marker screenshot；无权限时保留 DOM/viewport 定位作为 fallback。
- [ ] 增加 Codex change request 生成器：自动把多条 comments 聚合成验收标准、影响范围和实现建议。
- [ ] 增加 feedback 状态回写：修复 PR/commit/release 后把对应 comments 标记为 fixed 或 needs-discussion。




### T058 BioAgent Context Window 圆形进度条与自动压缩体验

状态：已规划。

#### 背景
- 当前聊天里已有 token usage 文本，但缺少 context window 总量、占比、阈值和压缩状态；用户无法判断“是不是快满了”。
- 用户希望 BioAgent 侧有圆形进度条，并在 context window 快满时自动触发压缩。
- 这个 UI 必须 backend-neutral：不同 backend 的 native/fallback 压缩差异只显示成统一状态，例如“上下文健康 / 接近上限 / 正在压缩 / 已压缩 / 需要等待 provider”。

#### UX 原则
- 圆形进度条默认放在聊天输入区或 runtime 状态附近，轻量常驻；hover/click 展开详情。
- 进度来源分级展示：`native` 最可信，`provider-usage` 次之，`agentserver-estimate` 显示为估算，`unknown` 显示为未探测。
- 阈值建议：`watch` 70%，`autoCompact` 85%，`hardBlock` 92%；具体值允许 scenario/backend/workspace 配置。
- 自动压缩优先在“下一轮发送前”或 backend 空闲时触发；只有 backend 明确支持 mid-turn compaction 时才在运行中触发。
- 用户不需要选择 backend-specific 操作；只看到统一按钮/状态：“压缩上下文”“已自动压缩”“需要稍后重试”。

#### TODO
- [x] 扩展 BioAgent stream event/domain type：支持 `contextWindowState`、`contextCompaction`、`contextWindowRatio`、`contextWindowSource`。
- [x] 在 ChatPanel / Runtime Health 附近增加圆形 context meter：显示比例、状态色、模型/窗口大小、最近一次压缩时间。
- [x] meter hover 展示说明：used/window、usage source、backend、compact capability、auto threshold、最近 compact result。
- [x] 当 `ratio >= autoCompactThreshold` 且没有 active turn 时，发送下一轮前自动调用 AgentServer compact/preflight；运行中只显示 pending compact。
- [x] 当用户点击 meter 或“压缩上下文”时，调用统一 compact API；成功后刷新 state，并在聊天中轻量记录一条 system observation。
- [x] 如果 source 是估算或 unknown，UI 用不同样式提示“估算/未知”，但仍允许手动 compact。
- [x] 自动压缩必须可审计：每次 compact 写入 reason、before/after、backend capability、audit refs。
- [x] compact 失败时不要打断用户输入；显示可恢复状态，并让下一轮请求带上 compact failure ref 交给 backend 处理。
- [x] 增加前端测试：不同 ratio/status/source 的显示、自动 compact 阈值、防重复触发、backend unsupported fallback。
- [x] 增加 browser E2E：多轮对话让 usage 接近阈值，确认 meter 变色、preflight 自动 compact、用户侧体验一致。
