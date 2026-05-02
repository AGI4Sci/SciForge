# BioAgent - PROJECT.md

最后更新：2026-05-02

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；BioAgent 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；BioAgent 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 seed skill 候选。
- 开发者不应为一次任务缺口手工写死专用科研脚本；只能补通用协议、权限、安全边界、runner 能力、context contract、promotion 机制和 UI/artifact contract。
- TypeScript 主要负责 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排；科学任务执行代码优先作为 workspace-local Python/R/notebook/CLI artifact 生成。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。

## 任务板

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
