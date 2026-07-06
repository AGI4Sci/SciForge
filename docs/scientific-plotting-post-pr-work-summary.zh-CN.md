# SciForge 绘图功能阶段总结

本文记录上次 PR 合并后，本分支围绕科研绘图与 artifact 审改链路新增和调整的主要工作。

## 主要变化

1. **四类能力回归 Workers MCP**
   科研绘图、图像生成、PPT Master、Canvas 均保持在 `packages/workers` 下以 MCP 形式提供能力。主应用只负责注册、配置、artifact 展示和右侧审改入口，不再在聊天层注入大段 workflow prompt。

2. **主对话 artifact 卡片**
   图片、科研图、PPTX 等 MCP 输出会在主聊天流中形成 artifact card。用户点击图片或 PPT artifact 后，系统按需导入当前对话的 Canvas，并切换到“图风格 -> 画布审改”。

3. **科研绘图增强**
   `@sciforge/scientific-plotting` 新增论文图意图分类、CNS/领域 skill 增强层、Nature skill catalog 读取、research brief、图型规划与多 panel/机制图/流程图方向的提示结构。目标是让模型先判断“该画什么论文图”，再决定走受控 Matplotlib、diagram spec 或图像模型 polish。

4. **图像模型 polish 与审改闭环**
   `@sciforge/image-generation` 支持从 Canvas review packet 生成编辑版 artifact。规则上要求保留原图语义，不覆盖原始 artifact，新版本插入画布右侧形成 before/after 对照。

5. **Canvas 从 tldraw 迁向 draw.io**
   Canvas worker 默认写入 `canvas.drawio.xml`，并保留旧 tldraw snapshot 兼容路径。前端改为 draw.io iframe 适配层：优先使用本地/self-host `VITE_SCIFORGE_DRAWIO_EMBED_URL`；未配置时提供一次性在线 draw.io 测试入口，避免默认外发 workspace 数据。

6. **合入本地 framework diagram layer 思路**
   已阅读本地 `feat/editable-diagram-layers` 分支，并将其中“FrameworkDiagramSpec / DiagramLayerManifest / 可编辑图层”的核心思路迁入当前 draw.io 架构。新实现不会恢复 tldraw：图像生成 worker 为 framework 图输出 sidecar JSON，Canvas worker 读取 `diagramLayerManifestPath` 后把节点、容器、文字和连线转成 draw.io 原生 cell，便于后续在画布中直接编辑。

## 和上一版 PR 的区别

上一版重点是让 artifact 能进入 tldraw Canvas 并完成基础标注。本分支重点转向“论文图生产质量”和“可编辑画布”：先把生成物以统一 artifact 协议展示，再让 Canvas 承接审改；同时引入 CNS/论文图规划，让科研绘图不再只输出单张简单统计图或方块流程图。

## 已验证

- `npm --workspace @sciforge/image-generation run test`：11 个测试通过。
- `npm --workspace @sciforge/canvas run test`：16 个测试通过。
- `npm run test -- MessageTimeline.tool-summary Workbench.sciforge-artifact`：36 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- Framework layer smoke：生成 Transformer framework 图，产出 `diagram-layers.json`，插入 draw.io 后得到 25 个 shape cell 和 10 条 edge。
- Canvas worker smoke：创建 draw.io XML、插入图片 artifact、导出审改包均通过。
- 本地 UI：图风格面板可切换“画布审改”，无本地 draw.io 时显示安全提示，可手动启用在线 draw.io iframe。

## 仍需注意

- draw.io Web 资源尚未打包进应用。正式提交前建议二选一：打包 self-host draw.io 静态资源，或保留“用户显式启用在线 draw.io”的安全边界。
- 本地 `feat/editable-diagram-layers` 的 tldraw 原生 shape 实现未直接合并；已迁移其 sidecar/分层编辑思想到 draw.io。若后续该分支还有 AutoFigure 式白名单编辑，可继续按 worker sidecar 方式吸收。
- 临时测试产物目录不应进入 PR。
