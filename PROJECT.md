# SciForge 任务板

更新时间：2026-07-08

## 当前状态

本阶段进入 Workspace 预览 / 编辑能力的渐进式架构迁移。目标是在不破坏现有 PDF、DOCX、Markdown、HTML、图片、文本预览编辑能力的前提下，最终实现可扩展的新插件系统，支持人类和 agent 共同观察、交互、选择、注释和编辑数据。科学模态先聚焦生命科学领域。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- 相同功能的工作链路需要统一，不要额外生出旁路；删除冗余，代码尽可能精简。
- LLM API 只能走 Model Router。
- 所有 text / vision / scientific / image / speech / workflow / schedule 模型调用严格 Model Router-only；Codex / Claude / local runtime 只能作为执行 runtime，不持有上游模型旁路。
- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- GUI 面板只允许承载检查、审批、标注、比较、选择等人类判断；纯执行能力下沉到 agent runtime / worker / workflow。
- `localhost:5173` Web 预览是一等支持面，必须有稳定 bridge、能力差异提示和白屏恢复路径。

---

## 收口规则

- 新增格式能力必须先进入统一 Workspace preview plugin contract，不再继续扩张单体预览面板。
- 旧预览 / 编辑能力先通过 legacy adapter 接入新 host，不做一次性大爆炸重写。
- 新旧 IPC 在迁移期并行保留；新插件稳定后再逐步迁移调用方。
- 科学模态当前阶段只排生命科学相关能力；地理、工程仿真、通用 3D 等非生命科学模态延后。
- 需要人工决策的点只记录，不实现。
- 性能相关改动先量化再实现；新增 guard / 边界检查必须说明 runtime cost。

---

## 已决策约束

- Office 先采用轻量结构化预览 / 编辑，不实现完整 Office 编辑内核；`.pptx` / `.xlsx` / `.docx` 的完整 Office 后端作为后续可选增强。
- 拖拽和复制粘贴按环境能力降级：Electron 桌面优先真实文件操作，Web 预览降级为下载、复制路径或复制内容。
- agent 对预览插件拥有最高权限：可观察、选择、生成 edit operation、应用修改并保存；仍需保留 audit trail、undo / diff summary 和可追踪操作记录。
- 科学模态先聚焦生命科学：分子结构、序列 / 基因组、组学矩阵、生物影像、质谱 / 蛋白组等优先；非生命科学模态不进入本阶段任务清单。

## 迁移基线回归清单

- `previewWorkspaceFile()` 事件路径、右侧面板打开、workspaceRoot fallback 和最小面板宽度不能回退。
- 文本预览保持安全 workspace 读取、二进制拒绝、1.5 MB 截断、line / column 定位、非截断文件编辑、dirty / saved / error 状态、`Mod-s` 保存和 `writeWorkspaceFile`。
- Markdown 保持 source / split / preview 模式、默认 preview、draft live preview、GFM / math / KaTeX / hardened links、相对 workspace 图片、图片粘贴、缩放和 source 保存。
- HTML 保持 source / preview 模式、默认 preview、tokenized 本地服务、相对资源、路径 containment、mtime cache bust、sandbox iframe、外部打开和保存后刷新。
- PDF 保持 generic `readWorkspaceFile` 加载、64 MB cap、base64 payload、`WritePdfViewer`、搜索 / 翻页 / 缩放 / 选择、annotation overlay、selection actions 和 annotation panel。
- DOCX 保持 generic `readWorkspaceFile`、`word/document.xml` 段落 / 样式提取、搜索、选择、annotation overlay、段落级编辑 / revert / save 和 `writeWorkspaceDocxText`。
- 图片保持 extension routing、`readWorkspaceImage`、12 MB cap、MIME allowlist、data URL、居中 object-contain 和缩放。
- PDF / DOCX annotation sidecar 保持 `.sciforge/pdf-annotations`、debounced save、target + mtime reload、thread select / hover / jump、resolve / reopen / delete / edit、PDF sidecar import/export、annotated PDF export、DOCX document-copy panel 和 Q/A turn persistence。
- Visible context 保持 right-panel 与 file-preview 注册、preview target resource、annotation sidecar resource、counts / selected / display metadata 和 agent access hints。

## 任务清单

- [x] 【迁移基线】梳理现有 `WorkspaceFilePreviewPanel` 支持的文本、Markdown、HTML、PDF、DOCX、图片、注释、保存、visible context 行为，补齐关键回归清单，确认第一阶段不改变用户可见行为。
- [x] 【Shared contract】新增 `src/shared/workspace-preview` 协议层，定义 plugin manifest、capabilities、preview session、structured selection、workspace observation、edit operation、export target 和格式解析规则。
- [ ] 【Main host / registry】新增 `src/main/services/workspace-preview` host 和 registry，负责路径安全、文件状态、读写调度、watch、IPC 边界和 worker client，不把格式细节继续写进通用文件服务。
- [x] 【Main host / registry foundation】新增非侵入式 main preview registry / host foundation，支持 legacy / planned / life-science manifest 路由、安全 open session、file state、bounded observation，且不读取大文件内容。
- [x] 【Main worker observation client foundation】新增 main preview worker client，把 tabular、deck、molecular、sequence、omics、bioimaging、spectra first-party worker summaries 映射成统一 `WorkspaceObservation`，并在 worker 不支持或超出轻量限制时回退 generic observation。
- [x] 【Workspace preview IPC bridge】新增 `workspacePreview:*` IPC / preload / dev bridge：listPlugins、open、observe、applyEdit、export、watch、unwatch、changed event；迁移期保留旧 `file:*` 通道。
- [x] 【Workspace preview IPC bridge foundation】新增 `workspacePreview:listPlugins`、`workspacePreview:open`、`workspacePreview:observe`、`workspacePreview:readRange`、`workspacePreview:applyEdit`、`workspacePreview:export`、`workspacePreview:watch`、`workspacePreview:unwatch`、`workspacePreview:changed` 的 main IPC / preload / dev bridge，并保留旧 `file:*` 通道。
- [x] 【Workspace preview host watch foundation】让 `workspacePreview:watch` 初始化和变更 snapshot 走 main preview host 的安全文件状态路径，只返回 path / size / mtime 等轻量信息，不再复用旧 eager content / image reader；旧 `file:watch-workspace` 行为保持不变。
- [ ] 【Workspace preview large asset transport】为科学大文件实现 range / tile / thumbnail / cache artifact / object URL 传输，避免分子结构、影像、组学矩阵、质谱等继续走 eager read / base64 预览路径。
- [x] 【Workspace preview range transport foundation】新增 session-scoped bounded byte range 读取基础，支持科学大文件后续按需读取，避免 host open 阶段 eager-load 文件内容。
- [x] 【Workspace preview asset descriptor foundation】新增 `describeAsset` host / IPC / preload / dev bridge，返回 byte-range、object-url、tile、thumbnail、cache-artifact 的统一传输策略描述，明确科学大文件默认禁止 eager read，并为后续插件解码器预留 tile / cache 状态。
- [x] 【Workspace preview descriptor-driven range transport client】将 renderer host / shell / outlet 的 asset descriptor 收敛进 `WorkspacePreviewHostState`，新增 range-only transport facade，统一暴露 byte-range read、strategy status 和 bounded text read；object-url / tile / thumbnail / cache-artifact 只表达 requires / deferred 状态，不新增 IPC 或独立解码旁路。
- [x] 【Renderer host / registry foundation】新增 `src/renderer/src/workspace-preview` 的非侵入式 `WorkspacePreviewHost` state helper 和插件 registry，支持 list / resolve / open / observe / readRange / applyEdit / export / watch / unwatch；旧右侧 workspace 查看器 wiring 和共享 toolbar / inspector chrome 仍在后续迁移任务里。
- [ ] 【Renderer shared chrome / panel wiring】在 `WorkspacePreviewHost` 基础上实现共享 toolbar / breadcrumb / inspector / annotation chrome，并让右侧 workspace 查看器逐步只依赖 host。
- [x] 【Renderer shared chrome skeleton】新增非侵入式 shared chrome view model 和薄 React shell，覆盖 toolbar actions、breadcrumb/title、empty/error/deferred/unsupported 状态、inspector summary，并补齐 molecular、sequence、omics、bioimaging、spectra 等生命科学 observation 展示。
- [x] 【Renderer panel shell foundation】新增非侵入式 `WorkspacePreviewPanelShell`，可通过 `WorkspacePreviewHost` open / observe / describeAsset，并复用共享 toolbar / inspector chrome；暂不替换现有右侧 workspace 查看器 wiring。
- [x] 【Renderer action runner foundation】新增非侵入式 toolbar action runner，在没有外部 `onAction` 覆盖时可从当前 observation / selection 推导 molecular、sequence、omics、bioimaging、spectra 的安全默认 action input，调用 `workspacePreview:invokeAction`，并把 worker 返回的 structured selection 写回 session；复杂人工参数继续留给后续专门控件。
- [x] 【Workbench preview bridge foundation】新增 `WorkspaceFilePreviewPanelBridge` 作为右侧 file panel 的最小风险接线层：Markdown、HTML、PDF、DOCX、图片等现有格式继续走 legacy panel；`.txt`、CSV / TSV / JSONL / NDJSON / XLSX、PPTX、生命科学格式和非生命科学 deferred 科学格式走 `WorkspacePreviewPanelShell`，并保留关闭 / 打开目录入口。
- [x] 【Workbench preview bridge route hardening】修复 tabular shell 路由误判：`.csv` / `.tsv` / `.jsonl` / `.ndjson` / `.xlsx` 只按显式 allowlist 进入 tabular shell，Markdown / PDF / DOCX / 图片 / `.ppt` / `.xls` 等继续留在 legacy 或既定 route；补 shared predicate 和 bridge shim 回归，防止普通后缀 fallback 再次把旧格式送入新 tabular viewer。
- [x] 【Workspace preview plugin outlet substrate】将新 shell 路径的 viewer 分发从 `WorkspaceFilePreviewPanelBridge` 收敛到 `WorkspacePreviewPluginOutlet`，统一 text / tabular / deck / life-science viewer 的 `applyEdit -> observe` 刷新链路和 deferred summary fallback；bridge 继续只负责 route、右侧按钮、visible context 和 legacy-vs-new-shell 边界。
- [x] 【Workspace preview renderer contribution registry】把 `WorkspacePreviewPluginOutlet` 推进为 renderer contribution registry，默认贡献 text / tabular / deck / molecular / sequence / omics / bioimaging / spectra viewer，并支持自定义 contribution 按 pluginId / modality / observation shape 接管渲染；新增格式无需再修改 bridge 或 outlet 主体分支。
- [x] 【Workspace preview visible-context foundation】为新 `WorkspacePreviewPanelShell` 路径注册 `right-sidebar.file-preview` visible context，向 agent 暴露 pluginId、modality、mode、selection kind、action count、asset transport、workspace resource 和 route reason；legacy panel 自有 visible context 保持不变。
- [x] 【Workspace preview shell observation visible-context payload】让新 `WorkspacePreviewPanelShell` visible context state 携带 bounded `WorkspaceObservation`，便于 agent 直接观察 CSV / PPTX / 生命科学预览的结构化状态；补 `.test.ts` shim，确保 bridge `.tsx` 测试进入默认 Vitest include。
- [x] 【Legacy panel observation visible-context wiring】在旧 `WorkspaceFilePreviewPanel` visible context 中挂载统一 `WorkspaceObservation` 摘要，覆盖 text / Markdown / HTML / PDF / DOCX / image 的 pluginId、modality、selection、actions、PDF / DOCX annotation 摘要，避免嵌入 PDF base64、图片 data URL 或完整 sidecar。
- [x] 【Workspace preview selection observation refresh foundation】在 main host observe 和 renderer host applyEdit 成功路径叠加 session selection，确保 worker observation / visible context 能立即反映最新 structured selection，并用 mock workerClient 单测钉住 host 层语义。
- [x] 【Renderer registry foundation】新增非侵入式 renderer preview registry skeleton，覆盖 legacy、text、markdown、html、image、pdf、docx、tabular、deck、life-science 插件描述和 deferred scope guard，暂不改现有 panel wiring。
- [x] 【WorkspaceFilePreviewPanel 回归测试】补 dedicated 组件 / 集成测试覆盖现有 mode switching、保存 UI、iframe / image rendering、annotation panel 和 visible-context registration，降低 legacy adapter 迁移风险。
- [ ] 【Legacy adapter】把现有预览编辑能力先包装成 legacy plugin 接入新 host，保留 `readWorkspaceFile`、`readWorkspaceImage`、`writeWorkspaceFile`、`writeWorkspaceDocxText` 等旧 IPC，确保现有功能不回退。
- [x] 【Legacy adapter observation foundation】新增 legacy result 到统一 `WorkspaceObservation` 的纯函数 adapter，覆盖 text、Markdown、HTML、PDF、DOCX、图片、selection 和可执行 actions，为后续 panel wiring 迁移提供低风险桥接层。
- [x] 【Text first-party plugin route foundation】将 `.txt` / `.text` / `.log` 从 legacy preview route 切到 `WorkspacePreviewPanelShell`，main registry 使用 first-party `text` manifest，host 输出 bounded `WorkspaceObservation.visibleText` / `text` 摘要，renderer `TextWorkspaceViewer` 复用统一 `text.replaceRange` edit operation 写回并刷新 observation。
- [ ] 【格式插件拆分】在行为稳定后逐步拆出 renderer 插件：text、markdown、html、image、pdf、docx；每个插件声明自己的 preview / edit / inspect / annotation / export 能力。
- [ ] 【Agent observation】为每个插件实现统一 `WorkspaceObservation` 输出，让 agent 能可靠观察当前文件、模式、可见文本、outline、selection、tables、slides、annotations 和可执行 actions。
- [x] 【Agent observation worker summaries foundation】将 first-party worker 输出接入 host `observe()`，覆盖 CSV/TSV/JSONL、PPTX 轻量摘要、PDB/CIF/SDF/MOL/XYZ、FASTA/FASTQ/GenBank/GFF/GTF/BED/VCF、MTX/H5AD placeholder、TIFF/OME-TIFF/CZI/SVS/NDPI placeholder、MGF/mzML/mzXML/FCS 摘要的 agent-readable observation 基线。
- [x] 【Agent observation life-science routing hardening】补齐 main worker client 对 MOL2、FASTA、CZI placeholder、H5AD-like embedding metadata 的路由 / observation 回归，确保生命科学 worker 输出能稳定映射到 shared `WorkspaceObservation`。
- [x] 【Life-science edit capability declaration hardening】收窄生命科学预览插件 manifest 的文件写入能力声明：保留 agent 最高权限、inspect / structured selection / annotations / worker action 交互，但在未实现真实写回前不自动暴露 `applyEdit` / `save`，host fallback observation 同步遵守该声明。
- [x] 【Workspace preview capability truthfulness hardening】收窄 workspace preview manifest 的虚标能力：tabular export 只声明当前 host 可执行的 CSV / TSV source-copy，生命科学插件只声明同源文件副本导出并移除通用持久 `annotations` 声明，避免 UI / agent 暴露未实现的转换 export、session export、ROI export 或 sidecar annotation 写回。
- [x] 【Life-science actionable observation context foundation】扩展统一 `WorkspaceObservation` 的生命科学上下文，保留 omics matrix / obs / var / metadata keys、bioimaging metadata-only tile plan、spectra ranges / sampled peaks / scan markers，并让 main worker client 和 renderer inspector 复用同一 bounded observation，不新增二进制 payload 旁路。
- [x] 【Worker action invocation foundation】新增 `workspacePreview:invokeAction` shared contract、main host / IPC / preload / dev bridge / renderer host 通道，并将 molecular、sequence、omics、bioimaging、spectra 的 first-party worker 纯内存选择、搜索、标注、导出 helper 接入带 audit 的统一 action invocation。
- [x] 【Worker action invocation hardening】补齐 main worker client action 回归：unsupported action 返回明确 `unsupported-action`，spectra range selection 不信任 caller-supplied peaks，bioimaging placeholder ROI annotation 不解码像素，molecular distance 在缺失坐标时返回明确 fallback。
- [x] 【Life-science inspect action invocation foundation】贯通已声明但未接入的生命科学 inspect / preview 动作：sequence feature / summary、omics metadata / capabilities、bioimaging metadata header / tile plan、spectra preview / scan inspection 均复用现有 bounded preview 对象返回，不新增解析旁路或文件写回承诺。
- [x] 【Tabular / deck worker action invocation foundation】将 tabular preview / inspect / query / selection / bounded row edit helper 和 deck slide / text selection helper 接入 main worker action dispatcher，并补 renderer action runner 默认输入；当前仅返回纯内存结果 / structured selection，不执行文件保存。
- [ ] 【Edit operations】实现统一 edit operation / patch apply 通道，支持文本 range edit、表格单元格 edit、DOCX 段落 edit、PDF / DOCX annotation edit，并保留 audit trail、undo / diff summary 和可追踪操作扩展点。
- [x] 【Edit operations foundation】新增 host / IPC 级 `applyEdit` foundation，支持文本 range edit 真实写回、分子 selection session 更新、路径匹配校验和 audit result；其他格式操作保留为后续插件实现。
- [x] 【Edit diff summary / undo hint foundation】为 workspace preview `applyEdit` 成功结果新增 bounded `diffSummary`，覆盖 text replace 和 CSV / TSV tabular edit 的 touched range / cells / rows / columns、counts、bounded previews 和 `undo.available:false` 提示；renderer host 保存最近一次 summary，bridge 显示非阻塞状态提示，不实现完整 undo 栈。
- [x] 【DOCX paragraph edit host foundation】将 `document.updateParagraph` 接入统一 workspace preview `applyEdit`，复用既有 DOCX OpenXML serializer 写回单段落，更新 session mtime / audit，并返回 bounded before/after diff summary；完整 Office 编辑内核和批注编辑继续延后。
- [x] 【PDF / DOCX annotation upsert host foundation】将 `annotation.upsert` 收敛为严格结构化 target，并接入统一 `workspacePreview.applyEdit`：host 复用现有 `.sciforge/pdf-annotations` sidecar load/save，支持 PDF rect anchor、DOCX quote/context anchor、已有 annotation 更新、sidecar-write audit 和 bounded diff summary，不接受任意 sidecar path 或 opaque JSON blob。
- [x] 【PDF / DOCX annotation observation foundation】让 main preview host 的 `observe()` 为 PDF / DOCX 统一注入 sidecar thread 级 `WorkspaceObservation.annotations` 摘要，并声明 `annotation.upsert` action；仅暴露 bounded status/page/title/preview，不泄漏完整 sidecar、rects、fingerprint、authors 或 transcript metadata。
- [ ] 【Tabular worker plugin】新增 `packages/workers/workspace-tabular`，承载 `.csv` / `.tsv` / `.xlsx` / `.jsonl` / `.parquet` 等表格和数据集的解析、预览摘要、结构化选择、编辑、导入导出能力。
- [x] 【Tabular worker skeleton】新增 `packages/workers/workspace-tabular` first-party worker skeleton，包含 zod contract、CSV / TSV bounded preview parser、列摘要、行数统计和 WorkspaceObservation-shaped summary。
- [x] 【Tabular JSONL expansion】增强 `packages/workers/workspace-tabular`，支持 `.jsonl` / NDJSON bounded preview、字段发现、nested value preview、row count estimate、WorkspaceObservation-shaped table summary 和纯内存 updateCell / insertRows helper。
- [x] 【Tabular XLSX bounded read-only preview foundation】增强 `packages/workers/workspace-tabular`，支持 `.xlsx` 首个 sheet 的 bounded 只读预览、header / previewRows / column summary / WorkspaceObservation 输出，并在 worker action 中仅开放 filter / sort / selection 等 read-only 能力，写回继续明确延后。
- [x] 【Tabular query / selection foundation】增强 `packages/workers/workspace-tabular`，新增 CSV / TSV / JSONL 共用 preview rows 的 filter、stable sort、structured cell selection summary 和 agent-readable visible text helper。
- [x] 【Tabular viewer baseline shell】新增非侵入式 renderer 表格 viewer 基线组件，基于 `WorkspaceObservation` 展示 table row / column 摘要、tabular selection ranges / cells、visibleText、actions 和 grid/editor 挂载占位，并接入 workspace preview shell 的 tabular observation 分支。
- [x] 【Tabular CSV / TSV write-back foundation】新增 worker 级 CSV / TSV delimited edit serializer 和 host `applyEdit` 写回分支，支持安全转义后的单元格更新、数据行插入、mtime / size session 更新、audit trail，并对 JSONL / XLSX 等非 delimited 格式明确降级。
- [x] 【Tabular bounded grid observation foundation】扩展 shared `WorkspaceObservation.tabular`，让 worker observe / preview action 返回 bounded header + previewRows，并让 renderer tabular viewer 渲染只读 bounded grid；需要人工输入的 edit / export toolbar 动作先明确禁用。
- [x] 【Tabular bounded grid filter / sort UI foundation】在 renderer tabular viewer 上实现 bounded preview 内的文本筛选和列排序状态，agent summary / visible text 只报告 filter / sort 状态，不改 worker、main、contract 或真实文件保存路径。
- [x] 【Tabular bounded cell edit UI foundation】在 renderer tabular viewer 中新增 bounded cell 编辑控件，生成 `tabular.updateCell` operation；无 apply handler 时明确禁用，接入 workspace preview bridge 后可调用 host `applyEdit` 并重新 observe 刷新预览。
- [x] 【Tabular bounded row insert UI foundation】在 renderer tabular viewer 中新增 bounded row insert 控件，生成 `tabular.insertRows` operation；支持 top / bottom / after visible row 入口，无 apply handler / observation / advertised action 时明确禁用，接入 workspace preview bridge 后复用 host `applyEdit` 并重新 observe 刷新预览。
- [x] 【Tabular row / column delete write-back foundation】新增 `tabular.deleteRows` / `tabular.deleteColumns` edit operation、worker 纯内存 helper、CSV / TSV header-aware 写回映射和 agent invoke action 基线；renderer 暂只展示并禁用 toolbar action，专门删除控件留给后续 UI slice。
- [x] 【Tabular column insert write-back foundation】新增 `tabular.insertColumns` edit operation、worker 纯内存 helper、CSV / TSV header-aware 写回映射和 agent invoke action 基线；renderer 既有列插入控件可复用该后端基础。
- [x] 【Tabular bounded column insert UI foundation】在 renderer tabular viewer 中新增 bounded column insert 控件，生成 `tabular.insertColumns` operation；支持 first / last / after visible column 入口，列值限定为 header + 当前 bounded rows，无 apply handler / observation / advertised action 时禁用。
- [x] 【Tabular row / column delete UI foundation】在 renderer tabular viewer 中新增 row / column delete 确认控件，生成 `tabular.deleteRows` / `tabular.deleteColumns` operation；无 apply handler / observation / advertised action 时禁用，接入 workspace preview bridge 后复用 host `applyEdit` 并重新 observe 刷新预览。
- [x] 【CSV / TSV first-party shell route foundation】右侧 workspace preview bridge 将 `.csv` / `.tsv` 首批白名单路由到新 `WorkspacePreviewPanelShell` 和 tabular viewer，避免过早宣称完整表格插件首发。
- [x] 【Tabular JSONL / XLSX read-only shell route foundation】右侧 workspace preview bridge 将 `.jsonl` / `.ndjson` / `.xlsx` 接入统一 tabular shell；JSONL / NDJSON / XLSX observation 仅广告 preview / inspect / filter / sort / selection，只读格式不暴露 `applyEdit` / `save` 或 tabular 写动作，CSV / TSV 写回链路保持不变。
- [x] 【Worker package integration checklist】新增 worker 包时同步 root workspaces、root scripts、package exports、tsconfig、MCP server tests、release-worker manifest / desktop bundling 审核，不允许只建孤立包目录。约束记录在 `docs/workspace-worker-package-integration-checklist.md`，并由 `src/main/worker-package-metadata.test.ts` 覆盖 root workspace / scripts / exports / release bundling guard。
- [x] 【Workspace worker package integration】将 `@sciforge/workspace-tabular`、`@sciforge/workspace-deck`、`@sciforge/workspace-molecular`、`@sciforge/workspace-sequence`、`@sciforge/workspace-omics`、`@sciforge/workspace-bioimaging`、`@sciforge/workspace-spectra` 接入 root npm workspaces、root test / typecheck scripts 和 package-lock workspace link，保持 release bundling 暂不启用。
- [x] 【CSV 插件首发】用新插件系统实现 `.csv` / `.tsv` 表格预览和编辑，支持排序、筛选、单元格编辑、行列增删、保存、撤销提示和 agent 可读 selection。
- [ ] 【Deck worker plugin】新增 `packages/workers/workspace-deck`，承载 `.pptx` / `.ppt` 的缩略图、slide outline、文本抽取、预览渲染、结构化编辑和导出；`.ppt` 先按 legacy / 转换格式处理。
- [x] 【Deck worker skeleton】新增 `packages/workers/workspace-deck` first-party worker skeleton，包含 zod contract、slide metadata summary、deck outline 和 WorkspaceObservation-shaped summary。
- [x] 【Deck PPTX summary expansion】增强 `packages/workers/workspace-deck`，支持从 PPTX OpenXML zip 轻量抽取 slide order、title、text snippet、notes preview、notes count 和 WorkspaceObservation-shaped deck summary；完整渲染 / 编辑仍留给 PPTX 插件首发。
- [x] 【Deck text element / selection foundation】增强 `packages/workers/workspace-deck`，抽取 bounded slide / notes text elements，并新增纯内存 slide selection、text query / kind / element selection helper，便于 agent 观察和定位汇报材料内容。
- [x] 【Deck selection contract hardening】统一 deck worker selection 输出到 shared `{ kind: 'deck', slideIds, elementIds? }` 结构，补测试防止旧 `slideId` / `slideIndex` 形状回流，确保 action runner 能把 PPTX slide/text 选择写回 session。
- [x] 【Deck text element visible selection foundation】扩展 shared `WorkspaceObservation.deck.textElements`、main worker client 和 deck viewer，让 PPTX bounded text element 能被 agent / 人类观察，并在 deck selection 中高亮已选 element。
- [x] 【Deck text element action runner foundation】增强 renderer action runner 的 `deck.selectText` 默认输入，优先使用当前 deck selection 对应 bounded text element，否则回退第一个可见 text element；没有 textElements 时明确失败，避免文本选择退化成 slide-only 选择。
- [x] 【Deck viewer baseline shell】新增非侵入式 renderer deck viewer 基线组件，基于 `WorkspaceObservation` 展示 slide outline、notes / visibleText、deck selection、actions 和 slide renderer/editor 挂载占位，并接入 workspace preview shell 的 deck observation 分支。
- [x] 【Deck current slide observation foundation】增强 renderer deck viewer，从 deck selection 或首张 slide 派生当前页，展示当前页 title、notes、bounded text elements，并写入 agent summary / stable data markers；仍不宣称像素级 slide 渲染。
- [x] 【Deck viewer slide / text selection UI foundation】在 deck viewer 的 slide outline 和 bounded text element 列表中增加选择按钮，统一生成 `workspace.setSelection` edit operation，经既有 host applyEdit 链路更新 session selection；不新增独立 selection 旁路。
- [x] 【Deck PPTX text element write-back foundation】新增 `deck.updateTextElement` edit operation、worker OpenXML 单文本元素替换、host `.pptx` 写回、mtime / size session 更新和 bounded diff summary；`.ppt` / 新增删除移动文本框继续明确延后。
- [x] 【Deck bounded text edit UI foundation】在 renderer deck viewer 中新增当前 / 选中文本元素 textarea 编辑入口，生成 `deck.updateTextElement` operation；接入 workspace preview bridge 后复用 host `applyEdit` 并重新 observe 刷新预览。
- [x] 【Workspace source-copy export foundation】让通用 `workspace-file` export 支持省略 path 时生成安全不冲突的同源格式副本，并让 renderer toolbar 只启用当前文件同扩展名导出；`.pptx` 可导出编辑后副本，`pdf` / `png` 等格式转换继续明确需要插件实现。
- [x] 【PPTX first-party shell route foundation】右侧 workspace preview bridge 将 `.pptx` 白名单路由到新 `WorkspacePreviewPanelShell` 和 deck viewer，`.ppt` 继续保留 legacy / 后续转换路径，避免误宣称完整 Office 编辑内核。
- [x] 【Deck PPTX comments read-only foundation】增强 `packages/workers/workspace-deck`，通过 PPTX relationship 读取 `commentAuthors` / `comments` part，输出 bounded comment summaries，并映射为统一 `WorkspaceObservation.annotations` 供 agent / 人类观察；批注编辑、回复 / resolve 和像素定位继续延后。
- [x] 【Deck capability declaration hardening】收窄 deck manifest 到首发真实能力：仅声明 `.pptx` 和同源 `pptx` source-copy export，移除未实现的 `.ppt`、`pdf`、`png` 转换能力声明；main / renderer registry 保持一致，避免 UI 或 agent 暴露假转换路径。
- [x] 【Deck PPTX slide wireframe preview foundation】增强 `.pptx` worker，从 OpenXML `presentation.xml` / slide shape transform 中抽取 slide size 和文本框 geometry，写入统一 `WorkspaceObservation.deck.slidePreviews`，renderer deck viewer 复用该 observation 渲染可点击 wireframe 文本框，不引入完整 Office 渲染内核或独立 selection 旁路。
- [x] 【PPTX 插件首发】用新插件系统实现 `.pptx` 预览和受控编辑，支持 slide 列表、当前页观察、文本框选择、备注 / 批注、导出和 agent 可读 slides。
- [x] 【Life science scope guard】建立生命科学格式优先级表和 plugin routing，确保当前阶段只扩展生命科学相关科学模态，非生命科学格式显示明确的延后支持状态。
- [ ] 【Molecular worker plugin】新增 `packages/workers/workspace-molecular`，承载 `.pdb`、`.cif`、`.mmcif`、`.sdf`、`.mol`、`.mol2`、`.xyz`、`.xtc`、`.dcd`、`.trr`、`.mrc`、`.ccp4` 等结构、轨迹和密度图解析摘要。
- [x] 【Molecular worker skeleton】新增 `packages/workers/workspace-molecular` first-party worker skeleton，包含 zod contract、PDB atom / residue / chain / ligand summary 和 WorkspaceObservation-shaped summary。
- [x] 【Molecular text parser expansion】增强 `packages/workers/workspace-molecular`，支持 PDB、mmCIF / CIF、SDF / MOL、XYZ 的轻量文本解析摘要；轨迹和密度图仍留给后续大文件 transport / viewer 阶段。
- [x] 【Molecular MOL2 expansion】增强 `packages/workers/workspace-molecular`，支持 Tripos MOL2 `MOLECULE` / `ATOM` / `BOND` / `SUBSTRUCTURE` 轻量解析，输出 molecule type、charge type、bond / substructure counts、元素统计、residue / ligand / chain summary 和 observation 摘要。
- [x] 【Molecular selection / measurement foundation】增强 `packages/workers/workspace-molecular`，新增 chain / residue / ligand / atom id / index / element 纯内存结构化选择，以及坐标可用时的距离测量；无坐标时明确返回降级 warning，不假造距离。
- [x] 【Molecular trajectory / density placeholder foundation】增强 `packages/workers/workspace-molecular`，识别 `.xtc` / `.dcd` / `.trr` 轨迹和 `.mrc` / `.ccp4` 密度图为安全 metadata placeholder observation，输出明确未解码 warning、trajectory / density representation 和只读 preview action，避免掉回泛型文件观察或假造帧 / 体素数据。
- [x] 【Molecular viewer dependency spike】优先验证 Mol*，失败则评估 3Dmol.js / NGL；覆盖 Electron CSP、worker-src / WASM、React 19 vanilla mount、bundle size、签名 / release audit 风险。结论记录在 `docs/workspace-preview-molecular-viewer-spike.md`：首发建议 3Dmol，Mol* 留作高级结构 / 密度 / 轨迹阶段。
- [x] 【Molecular viewer baseline shell】新增非侵入式 renderer 分子 viewer 基线组件，基于 `WorkspaceObservation` 展示结构摘要、selection、action 和 WebGL / 3Dmol 挂载占位；不引入真实 WebGL 依赖，不替换现有 legacy 面板。
- [x] 【Molecular 3Dmol bounded renderer foundation】新增 renderer 侧 `3dmol` 懒加载 adapter，分子 viewer 通过统一 workspace preview `asset` / `readRange` 读取小型 PDB / CIF / SDF / MOL2 / XYZ 文本结构并挂载真实 WebGL viewport；大文件、空文件和不支持格式保留摘要 fallback，不新增 IPC / file URL 旁路，并暂不宣称截图 / surface / 轨迹能力完成。
- [x] 【Molecular representation / selection bridge foundation】增强分子 viewer 的 3Dmol adapter 和 shell UI，支持 cartoon、cartoon+stick、stick、ball+stick 表示切换，chain / ligand / clear selection 生成统一 `molecular.setSelection` edit operation 并经 workspace preview host 刷新 observation；`molecular.measureDistance` 的 renderer 输入、worker 正向坐标计算和 host audit 路径补回归，surface、截图、角度测量、B-factor / pLDDT 着色和轨迹 / 密度交互继续保留在完整 viewer plugin 任务中。
- [ ] 【Molecular viewer plugin】用成熟 WebGL 分子查看器实现类 PyMOL 交互：旋转、缩放、cartoon / surface / stick / ball-stick 表示、chain / residue / ligand 选择、距离 / 角度测量、pLDDT / B-factor 着色、截图和 agent 可读 selection。
- [ ] 【Sequence / genomics plugin】支持 `.fasta`、`.fa`、`.fastq`、`.gb`、`.gbk`、`.gff`、`.gtf`、`.bed`、`.vcf` 的预览、索引、区域选择、特征注释、变异摘要和 agent 可读 sequence / feature selection。
- [x] 【Sequence / genomics worker skeleton】新增 `packages/workers/workspace-sequence` first-party worker skeleton，支持 FASTA / FASTQ / GenBank / GFF / GTF / BED / VCF 轻量摘要和 WorkspaceObservation-shaped sequence summary。
- [x] 【Sequence / genomics index foundation】增强 `packages/workers/workspace-sequence`，为 FASTA / FASTQ / GenBank / GFF / GTF / BED / VCF 输出 bounded indexed ranges、per-reference region summary、GenBank feature location 摘要，并新增纯内存 `selectRegion` helper 供 agent / renderer 做区域选择。
- [x] 【Sequence / genomics search foundation】增强 `packages/workers/workspace-sequence`，新增 preview-bounded 纯内存 search helper，支持 record / motif、reference、feature、variant、indexed range 搜索和 agent-readable selection / visible text。
- [x] 【Sequence / genomics viewer baseline shell】新增非侵入式 renderer 序列 / 基因组 viewer 基线组件，基于 `WorkspaceObservation` 展示 sequence count、length、alphabet、region / feature selection、actions 和 genome browser 挂载占位；不引入真实 genome browser 依赖。
- [x] 【Sequence bounded marker map foundation】扩展统一 `WorkspaceObservation.sequence`，携带 bounded references、features、indexedRanges 和 truncation flags；renderer 序列 viewer 渲染只读 SVG marker map 与可访问 marker list，并通过统一 `workspace.setSelection` edit operation / host observe 刷新 session selection；不读取完整序列、不引入 genome browser 依赖、不新增搜索 query 旁路。
- [ ] 【Omics matrix plugin】支持 `.h5ad`、`.loom`、`.mtx`、`.h5`、`.hdf5`、`.zarr` 等组学 / 单细胞矩阵的摘要、分层 metadata、基因 / 细胞选择、低维 embedding 预览和安全的结构化编辑。
- [x] 【Omics matrix worker skeleton】新增 `packages/workers/workspace-omics` first-party worker skeleton，支持 Matrix Market dimensions / nnz、metadata fallback、HDF5 / Zarr safe placeholder 和 WorkspaceObservation-shaped omics summary。
- [x] 【Omics metadata expansion】增强 `packages/workers/workspace-omics`，从 H5AD / Loom / HDF5 / Zarr JSON 或 key-value metadata 提取 `n_obs` / `n_vars`、shape、nnz、obs / var key counts、axis names 和 embedding names，继续保持二进制 payload placeholder-only。
- [x] 【Omics dataset selection foundation】增强 `packages/workers/workspace-omics`，新增 metadata-only dataset selection helper，支持 matrix id / name、obs / var keys、embedding names、axis ranges 选择，并对缺失请求返回 visible warning。
- [x] 【Omics shared selection foundation】扩展 shared `WorkspaceStructuredSelection` 和 renderer inspector，支持 omics matrix、obs / var key、embedding、axis range selection 进入 host/session/agent observation 通道。
- [x] 【Omics matrix viewer baseline shell】新增非侵入式 renderer 组学 viewer 基线组件，基于 `WorkspaceObservation` 展示 matrix shape、obs / var counts、embeddings、dataset selection、actions 和 matrix / embedding renderer 挂载占位；不解析二进制矩阵 payload。
- [x] 【Omics metadata matrix overview foundation】增强 renderer 组学 viewer，基于既有 `WorkspaceObservation.omics` 和 omics selection 渲染 metadata-only matrix overview、axis counts、matrix / obs / var / embedding / metadata chips 和 selected ranges；不假造 heatmap / scatter / embedding 坐标，不解析二进制矩阵 payload，不新增 selection 旁路。
- [ ] 【Bioimaging plugin】支持 `.tif`、`.tiff`、`.ome.tiff`、`.czi`、`.svs`、`.ndpi` 等显微 / 病理影像的金字塔预览、通道切换、ROI 选择、标注、截图和 agent 可读 ROI / channel observation。
- [x] 【Bioimaging worker skeleton】新增 `packages/workers/workspace-bioimaging` first-party worker skeleton，支持 TIFF / BigTIFF header sniff、OME XML dimensions / channel metadata、CZI / SVS / NDPI safe placeholder 和 WorkspaceObservation-shaped bioimaging summary。
- [x] 【Bioimaging tile / ROI selection foundation】增强 `packages/workers/workspace-bioimaging`，为 TIFF / OME-TIFF 生成 metadata-only tile pyramid plan，并新增 ROI clamp / selection、channel selection helper；CZI / SVS / NDPI 继续保持安全 placeholder。
- [x] 【Bioimaging ROI annotation / export foundation】增强 `packages/workers/workspace-bioimaging`，新增 metadata-only ROI annotation 和 ROI set JSON export helper，支持 OME-TIFF / CZI / SVS 等预览的可追踪 ROI / channel 标注，不包含像素、截图或真实 tile renderer。
- [x] 【Bioimaging viewer baseline shell】新增非侵入式 renderer 生物影像 viewer 基线组件，基于 `WorkspaceObservation` 展示 dimensions、channels、ROI/channel selection、annotations、actions 和 metadata-only tile viewport 挂载占位；不解码像素。
- [x] 【Bioimaging metadata tile overview foundation】增强 renderer 生物影像 viewer，基于既有 `WorkspaceObservation.bioimaging.dimensions` / `tilePlan` / channels 和 bioimaging selection 渲染 metadata-only virtual tile grid、tile transport markers 和 bounded ROI overlay；不解码像素、不读取 range / object URL、不声明截图或真实 tile renderer 已完成。
- [ ] 【Proteomics / spectra plugin】支持 `.mzML`、`.mzXML`、`.mgf`、`.fcs` 等生命科学仪器数据的摘要、峰图 / gating 预览、区域选择、注释和 agent 可读 spectrum / population selection。
- [x] 【Proteomics / spectra worker skeleton】新增 `packages/workers/workspace-spectra` first-party worker skeleton，支持 MGF spectrum / peak counts、mzML / mzXML scan markers、FCS safe placeholder 和 WorkspaceObservation-shaped spectra summary。
- [x] 【Proteomics / spectra range selection foundation】增强 `packages/workers/workspace-spectra`，输出 m/z / intensity range、sampled peaks、mzML / mzXML scan range metadata、FCS event axis / gating placeholder，并新增纯内存 `selectPeaksByRange` helper。
- [x] 【Proteomics / spectra annotation / export foundation】增强 `packages/workers/workspace-spectra`，新增 sampled peak / scan range annotation、bounded CSV / TSV / JSON peak-list export，以及 FCS population gate placeholder annotation；不解码真实 FCS event matrix。
- [x] 【Proteomics / spectra viewer baseline shell】新增非侵入式 renderer 谱图 viewer 基线组件，基于 `WorkspaceObservation` 展示 spectrum / peak counts、xAxis、range / peak selection、actions 和 bounded sampled peak plot / FCS gating 挂载占位；不绘制真实峰图或解析 FCS event matrix。
- [x] 【Proteomics / spectra bounded peak plot foundation】增强 renderer 谱图 viewer，把 `WorkspaceObservation.spectra.sampledPeaks`、`mzRange`、`intensityRange` 和 spectra selection ranges 渲染为轻量 SVG stem plot；没有 sampled peaks 但有 scanMarkers 时渲染 bounded scan marker strip；无可画数据或 FCS event matrix 时保留明确空状态 / placeholder，不新增二进制解码或 worker 旁路。
- [x] 【拖拽与复制粘贴】在 workspace 查看器中实现拖入文件 / 文件夹、内部移动、拖到会话作为附件、复制路径 / 内容、粘贴文件 / 截图 / 文本到当前目录，并处理冲突命名策略。
- [x] 【拖拽与复制粘贴 contract foundation】新增 workspace preview transfer contract，覆盖 drag-in / drag-out action、drag source / target、copy / paste payload、冲突命名策略，以及 Electron desktop 真实文件能力和 Web 预览下载 / 复制路径 / 复制内容降级能力。
- [x] 【Workspace 文件树 drag-out reference foundation】为右侧 workspace 文件树行写入稳定 `WorkspacePreviewDragSource` / workspace reference DataTransfer payload，并提供 `text/plain` 相对路径 fallback，作为拖到会话附件、内部移动、Electron 原生文件拖出的共同基础。
- [x] 【Workspace 文件树拖到会话 reference foundation】让 composer 识别 workspace 文件树的自定义 reference drag MIME 和标准 `WorkspacePreviewDragSource` fallback，拖到输入框时添加 `ComposerFileReference` 并插入对应 `@file` mention token；OS 文件 / 图片 / PDF 拖入路径保持不变。
- [x] 【Workspace 文件树内部 drop move/copy foundation】让右侧 workspace 文件树目录行和 root 空白区域消费 workspace reference drag payload，复用现有 `moveWorkspaceEntry` / `copyWorkspaceEntry` 执行树内移动或复制；同 workspace 默认 move、Option/Alt 或跨 workspace 默认 copy，并阻止目录拖进自身或子目录。
- [x] 【Workspace 文件树外部文件 drag-in import foundation】新增 `importWorkspaceEntries` 服务 / IPC / preload / dev bridge，支持从 Electron 文件拖拽导入外部文件或文件夹到 workspace 目录，复用冲突安全命名策略，并阻止把目录导入自身或子目录。
- [x] 【Workspace 文件树复制路径 / 内容 foundation】保留右键复制相对路径，并为文件项新增复制内容动作；复用 `readWorkspaceFile`，仅复制未截断文本和 DOCX plain text，PDF / 图片 / 截断大文件给出明确降级提示。
- [x] 【Workspace 文件树系统剪贴板 paste foundation】新增 `pasteWorkspaceClipboard` 服务 / IPC / preload / dev bridge，让右键 Paste 在无内部 copy/cut 项时把系统剪贴板图片保存为 PNG、文本保存为 `.txt` 到当前目录，并复用冲突安全命名策略。
- [x] 【Workspace 文件树系统剪贴板文件 paste foundation】扩展 `pasteWorkspaceClipboard`，识别系统剪贴板里的本地文件 / 文件夹路径（如 `text/uri-list`、GNOME copied-files、macOS / Windows bookmark 或 filename buffer），复用 `importWorkspaceEntries` 导入目标目录，并沿用冲突安全命名策略；无文件路径时继续回退图片 / 文本 paste。
- [x] 【Workspace 文件树 Electron native drag-out foundation】新增安全路径解析后的 `startWorkspaceNativeFileDrag` IPC / preload / dev bridge；桌面 sender 支持时调用 `webContents.startDrag` 拖出真实文件，Web / dev sender 返回明确降级并保留现有 reference drag payload。
- [x] 【Workspace 文件树 conflictPolicy integration foundation】将 workspace 文件树 copy / import / paste / move 统一接入 shared `WorkspaceFileConflictPolicy`，默认保持 rename，支持 overwrite / skip，ask / merge 明确拒绝为未实现，避免拖拽和粘贴链路各自维护冲突处理旁路。
- [ ] 【迁移收口】当新插件系统覆盖现有格式并通过回归后，逐步删除旧单体分支逻辑，把 `WorkspaceFilePreviewPanel` 收敛为薄 wrapper 或完全替换为 `WorkspacePreviewHost`。
