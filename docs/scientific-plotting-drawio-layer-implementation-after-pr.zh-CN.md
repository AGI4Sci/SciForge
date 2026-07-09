# 上次 PR 后：科研绘图、draw.io 画布与图层切分实现说明

本文参考 `/Users/yhh/Downloads/绘图和图层切分设计.md` 的写法，记录上次 artifact/Canvas PR 之后，本地分支围绕科研绘图、图像生成、draw.io 画布和 framework 图层切分新增的主要实现。这里不把测试产物、临时图片和一次性脚本作为交付重点，只说明已经进入当前项目代码结构的功能。

## 绘图部分

### Workers MCP 形态

当前绘图相关能力仍然保持在 `packages/workers` 下，以 MCP worker 形式提供，而不是塞回聊天路由：

- `@sciforge/scientific-plotting`：科研绘图、论文图规划、StyleSpec、受控数据图渲染。
- `@sciforge/image-generation`：图像生成、framework 图 full draft、图像 polish、Canvas 审改后的重绘。
- `@sciforge/canvas`：artifact 进入画布、draw.io XML 存储、审改包、组件展开。
- `@sciforge/ppt-master`：PPT 生成和导出，继续作为独立 worker 保持兼容。

主应用只负责 MCP 注册、artifact card 展示、右侧图风格面板和 Canvas 入口。这样可以避免把科研绘图、PPT、生图写成聊天层关键词路由，也避免把大段 workflow prompt 暴露在用户消息里。

### 论文图流程增强

科研绘图不再只按“用户说画图 -> 直接生成一张图”处理，而是加入了论文图前置规划：

1. `scientific_plotting_research_brief` 先判断任务属于数据图、机制图、模型结构图、方法流程图、多 panel summary figure 还是视觉示意图。
2. 生成 `selectedSkillProfile`，明确本次采用的 skill/profile。
3. 生成 `paperFigureProductionPlan`，描述 figure conclusion、证据链、图型选择、数据需求、panel 组合和输出风格。
4. 对受控数据图优先走 `scientific_plotting_render`。
5. 对 framework / summary / mechanism 图，先形成图意图和结构化 prompt，再交给 image-generation 做 full draft 或 delta polish。
6. 输出 artifact card，用户点击后进入 Canvas 审改。

Skill 选择优先级已经固定为：

`K-Dense 基座 -> CNS/Nature 工作流 skill -> 领域 skill -> image delta polish`

其中 `nature-skills` 被作为 CNS 论文图 workflow 增强层加入只读 catalog，包含 `nature-figure`、`nature-reader`、`nature-data`、`nature-academic-search`、`nature-literature-pipeline` 等。它不替代 K-Dense，也不执行第三方脚本，只用于让模型在绘图前形成更像论文 figure 的设计逻辑。

### Image Delta Polish

Stage 4 已从“让图像模型重新画一张科学图”改为 **delta-only image polish**。它的职责是视觉增量，而不是替代受控科学图：

- 允许：panel 拼接、callout、局部放大、视觉统一、字体清理、机制图视觉草稿。
- 锁定：数值、坐标轴、legend、样本量、p 值、效应方向、论文结论。
- manifest 会标注 `usagePolicy.role = visual_composition_base`，避免把 image model 输出误认为最终科学数据图。

这解决了之前“让模型换颜色却生成茶壶/风景图”一类问题的方向：图像模型只能基于受控子图、参考图或 research brief 做有限增量。

## draw.io 画布部分

### 从 tldraw 迁移到 draw.io

上次 PR 的 Canvas 主要是 tldraw 形态。本地最新实现已经切到 draw.io：

- Canvas worker 默认写入 `.sciforge/canvases/<canvasId>/canvas.drawio.xml`。
- 旧 tldraw snapshot 只做兼容，不再作为主交互层。
- 前端通过 draw.io iframe 打开画布。
- 支持本地/self-host draw.io：优先读取 `VITE_SCIFORGE_DRAWIO_EMBED_URL`。
- 新增本地 draw.io server 探测逻辑，查找项目 `.sciforge/drawio-webapp` 或打包资源 `drawio-webapp`。
- 没有本地 draw.io 时，UI 会提示用户显式启用在线 diagrams.net，不静默外发 workspace 数据。

draw.io 的定位是“人类可视化编辑器”：负责移动、删除、框选、连线、文本、箭头和版面调整。SciForge worker 继续负责 workspace 安全边界、manifest、artifact 引用和审改包。

### 主对话 Artifact Card

图片、科研图和 PPTX 输出现在会在主聊天流中形成 artifact card。点击 artifact 后：

1. 系统按当前 workspace 和当前 thread/canvasId 导入 Canvas。
2. 右侧切换到“图风格 -> 画布审改”。
3. draw.io 中展示对应图片或 PPT artifact。
4. 用户在画布中编辑、标注或调整。
5. “发送修改”导出 review packet，并让运行时选择合适 MCP 工具生成新版本。

这个流程是后续审改闭环的核心：主聊天负责结果呈现，画布负责人工修改意图，worker 负责把修改变成新的 artifact。

## 图层部分

### Related Work 对应关系

你文档里提到两类路线：

- AutoFigure-Edit：先生图，再做 SAM/SAM3 分割、局部编辑、SVG 模板重建。
- LiveFigure：先生成可编辑组件，再拼装为 PPTX/图像，靠 actor/critic 多轮修复。

当前实现选择的是更保守的混合路线：

1. framework 图先生成 full draft PNG。
2. 同时写出结构 sidecar：`diagram-spec`、`framework-design-plan`、`diagram-layers`、`boxlib`、`component manifest` 等。
3. Canvas 里不直接把整张图当死图片处理，而是支持读取 component manifest 并展开为 draw.io 可选择对象。
4. 对局部重绘，优先通过 componentId / blockId / bbox 回到 image-generation worker。

它不像 LiveFigure 那样完全从矢量组件开始，也不像 AutoFigure-Edit 那样完全依赖视觉分割；当前目标是先把“可选中、可定位、可审改”跑通。

### Framework 图绘制

`@sciforge/image-generation` 已加入 framework 绘制协议：

- `FrameworkDiagramSpec v1`：描述节点、箭头、区域和图型意图。
- `FrameworkDesignPlan v1`：描述画布比例、panel、regions、arrowStrategy、textStrategy、styleStrategy 和 checklist。
- `image_generation_plan` 会对 framework 请求返回确认型 plan。
- 用户确认后，`image_generation_render` 生成 full draft PNG。
- render 同时输出 sidecar 文件，用于后续拆分、编辑和审计。

普通流程图仍然走轻量 `DrawingBrief`，不强制套 framework 多 panel 或高密度论文版式。这样可以减少“简单流程图被画成很重的论文 framework 图”的误判。

### Component Segmentation 与局部重绘

新增两个 image-generation MCP 工具：

- `image_generation_segment_components`
- `image_generation_edit_components`

它们用于从 framework PNG 生成 `FrameworkComponentManifest v1`，并支持基于 componentId / segmentId 做局部重绘。manifest 中记录：

- source image
- component-base image
- component bbox / pixelBbox
- semanticLayer
- parentBlockId / blockId
- component asset path
- segmentation preview
- warnings

当前组件切分配置已经暴露到 status 中：

- `SCIFORGE_COMPONENT_SEGMENTATION_RUNNER`
- `SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH`

兼容说明：历史 FastSAM 环境变量仍保留为 alias，但产品语义已经改为通用 component segmentation runner，可接 FastSAM、SAM 类模型或实现 SciForge component JSON 协议的自研切分器。

但需要注意：本地代码目前仍以 fallback/hitbox 路径为主，外部 segmentation runner/model 还没有形成完整产品化配置页和稳定质量验证。因此当前“展开组件”更准确地说是“基于 manifest 的可选区域展开”，不是最终版 SAM 级组件分割。

### draw.io 中的组件展开

Canvas worker 新增：

- `sciforge_canvas_split_artifact_components`

它会读取 framework component manifest，并在 draw.io 里生成带 metadata 的可选对象。最新实现已经从“把每个 crop 图像切片塞进画布”改为“插入可选择 hitbox / component cell”，避免画布上出现一堆文字碎片或重复图片。

每个组件 cell 会记录：

- `componentId`
- `segmentId`
- `blockId`
- `parentBlockId`
- `semanticLayer`
- `sourceManifestPath`
- `pixelBbox`

用户选中这些 cell 后，审改包可以把选中区域和批注一起交给 image-generation 的局部重绘工具。

## 当前仍需修正的问题

1. **组件切分 runner 还不是完整能力**
   目前只暴露了 runner/model 配置和 fallback 说明。真正稳定的模型探测、失败降级、输出质量验证和多模型适配矩阵还需要继续做。

2. **批注 UX 还要收敛**
   draw.io 原生可以画箭头、框和文字，但 SciForge 仍需要一个明确的“批注内容输入”入口，避免用户不知道如何把修改意图传给模型。

3. **局部重绘需要更强约束**
   image model 只能改选中组件或指定区域，不能因为一句“换颜色”重画成无关图。当前已通过 delta polish 和 locked facts 做了方向性约束，但还要继续加强 review packet 到 edit prompt 的映射。

4. **论文级 figure 仍缺专用模板**
   KM、forest plot、ROC、多 panel summary、机制图、图像 panel 等仍需要专门模板和 deterministic overlay，不能全靠 image model。

5. **测试产物不能进入 PR**
   当前本地有多个临时目录和实验输出，后续提交前需要清理，只保留 worker、schema、UI、测试和文档。

## 和上次 PR 的核心区别

上次 PR 重点是“artifact 能进入 Canvas，并能做基础审改”。这次本地实现重点已经向两件事推进：

1. **论文级绘图流程**
   从“直接画一张图”升级为“skill 选择 -> research brief -> 受控子图 -> image delta polish -> Canvas 审改”。

2. **可编辑图层**
   从“整图插入画布”升级为“framework 图带 sidecar manifest，Canvas 可展开为可选区域，未来可按组件局部重绘”。

因此这轮不是单纯换画布，也不是单纯加 image generation，而是在把 SciForge 的科研绘图从结果展示推进到“论文图规划、生成、审改和局部迭代”的闭环。
