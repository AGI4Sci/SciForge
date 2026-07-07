# SciForge 任务板

更新时间：2026-07-08

## 当前状态

本阶段进入 Workspace 预览 / 编辑能力的渐进式架构迁移。目标是在不破坏现有 PDF、DOCX、Markdown、HTML、图片、文本预览编辑能力的前提下，最终实现可扩展的新插件系统，支持人类和 agent 共同观察、交互、选择、注释和编辑数据。科学模态先聚焦生命科学领域。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 Model Router。
- 所有 text / vision / scientific / image / speech / workflow / schedule 模型调用严格 Model Router-only；Codex / Claude / local runtime 只能作为执行 runtime，不持有上游模型旁路。
- 相同功能的工作链路需要统一，不要额外生出旁路；删除冗余，代码尽可能精简。
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

## 任务清单

- [ ] 【迁移基线】梳理现有 `WorkspaceFilePreviewPanel` 支持的文本、Markdown、HTML、PDF、DOCX、图片、注释、保存、visible context 行为，补齐关键回归清单，确认第一阶段不改变用户可见行为。
- [ ] 【Shared contract】新增 `src/shared/workspace-preview` 协议层，定义 plugin manifest、capabilities、preview session、structured selection、workspace observation、edit operation、export target 和格式解析规则。
- [ ] 【Main host / registry】新增 `src/main/services/workspace-preview` host 和 registry，负责路径安全、文件状态、读写调度、watch、IPC 边界和 worker client，不把格式细节继续写进通用文件服务。
- [ ] 【Renderer host / registry】新增 `src/renderer/src/workspace-preview` 的 `WorkspacePreviewHost`、插件 registry、共享 toolbar / breadcrumb / inspector / annotation chrome，并让右侧 workspace 查看器只依赖 host。
- [ ] 【Legacy adapter】把现有预览编辑能力先包装成 legacy plugin 接入新 host，保留 `readWorkspaceFile`、`readWorkspaceImage`、`writeWorkspaceFile`、`writeWorkspaceDocxText` 等旧 IPC，确保现有功能不回退。
- [ ] 【格式插件拆分】在行为稳定后逐步拆出 renderer 插件：text、markdown、html、image、pdf、docx；每个插件声明自己的 preview / edit / inspect / annotation / export 能力。
- [ ] 【Agent observation】为每个插件实现统一 `WorkspaceObservation` 输出，让 agent 能可靠观察当前文件、模式、可见文本、outline、selection、tables、slides、annotations 和可执行 actions。
- [ ] 【Edit operations】实现统一 edit operation / patch apply 通道，支持文本 range edit、表格单元格 edit、DOCX 段落 edit、PDF / DOCX annotation edit，并保留人工批准策略扩展点。
- [ ] 【Tabular worker plugin】新增 `packages/workers/workspace-tabular`，承载 `.csv` / `.tsv` / `.xlsx` / `.jsonl` / `.parquet` 等表格和数据集的解析、预览摘要、结构化选择、编辑、导入导出能力。
- [ ] 【CSV 插件首发】用新插件系统实现 `.csv` / `.tsv` 表格预览和编辑，支持排序、筛选、单元格编辑、行列增删、保存、撤销提示和 agent 可读 selection。
- [ ] 【Deck worker plugin】新增 `packages/workers/workspace-deck`，承载 `.pptx` / `.ppt` 的缩略图、slide outline、文本抽取、预览渲染、结构化编辑和导出；`.ppt` 先按 legacy / 转换格式处理。
- [ ] 【PPTX 插件首发】用新插件系统实现 `.pptx` 预览和受控编辑，支持 slide 列表、当前页观察、文本框选择、备注 / 批注、导出和 agent 可读 slides。
- [ ] 【Life science scope guard】建立生命科学格式优先级表和 plugin routing，确保当前阶段只扩展生命科学相关科学模态，非生命科学格式显示明确的延后支持状态。
- [ ] 【Molecular worker plugin】新增 `packages/workers/workspace-molecular`，承载 `.pdb`、`.cif`、`.mmcif`、`.sdf`、`.mol`、`.mol2`、`.xyz`、`.xtc`、`.dcd`、`.trr`、`.mrc`、`.ccp4` 等结构、轨迹和密度图解析摘要。
- [ ] 【Molecular viewer plugin】用成熟 WebGL 分子查看器实现类 PyMOL 交互：旋转、缩放、cartoon / surface / stick / ball-stick 表示、chain / residue / ligand 选择、距离 / 角度测量、pLDDT / B-factor 着色、截图和 agent 可读 selection。
- [ ] 【Sequence / genomics plugin】支持 `.fasta`、`.fa`、`.fastq`、`.gb`、`.gbk`、`.gff`、`.gtf`、`.bed`、`.vcf` 的预览、索引、区域选择、特征注释、变异摘要和 agent 可读 sequence / feature selection。
- [ ] 【Omics matrix plugin】支持 `.h5ad`、`.loom`、`.mtx`、`.h5`、`.hdf5`、`.zarr` 等组学 / 单细胞矩阵的摘要、分层 metadata、基因 / 细胞选择、低维 embedding 预览和安全的结构化编辑。
- [ ] 【Bioimaging plugin】支持 `.tif`、`.tiff`、`.ome.tiff`、`.czi`、`.svs`、`.ndpi` 等显微 / 病理影像的金字塔预览、通道切换、ROI 选择、标注、截图和 agent 可读 ROI / channel observation。
- [ ] 【Proteomics / spectra plugin】支持 `.mzML`、`.mzXML`、`.mgf`、`.fcs` 等生命科学仪器数据的摘要、峰图 / gating 预览、区域选择、注释和 agent 可读 spectrum / population selection。
- [ ] 【拖拽与复制粘贴】在 workspace 查看器中实现拖入文件 / 文件夹、内部移动、拖到会话作为附件、复制路径 / 内容、粘贴文件 / 截图 / 文本到当前目录，并处理冲突命名策略。
- [ ] 【迁移收口】当新插件系统覆盖现有格式并通过回归后，逐步删除旧单体分支逻辑，把 `WorkspaceFilePreviewPanel` 收敛为薄 wrapper 或完全替换为 `WorkspacePreviewHost`。
