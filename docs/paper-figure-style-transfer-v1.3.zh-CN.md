# 论文图美学风格识别 v1.3

## 目标

v1.3 先建立“参考图风格识别”的受控底座：用户提供论文图、截图或裁剪后的 figure panel，SciForge 将其解析为结构化 `FigureStyleSpec v1`，再交给后续受控绘图工具使用。

本阶段只做本地识别和规划，不执行第三方脚本，不复制原始论文数据、标签或图像内容。

## 当前流程

1. 用户提出“按某篇文献/参考图/论文风格画同样效果”的科研绘图请求。
2. `scientific_skills_plan` 识别为绘图 + 风格参考任务，返回 `plottingWorkflow.styleReference`。
3. 右侧“图风格”面板支持选择或拖入 workspace 内参考图，自动转为 workspace 相对路径，并读取缩略图预览。
4. Renderer 或受控工具调用 `window.dsGui.extractFigureStyle(...)`，对应 IPC 为 `figure-style:extract`。
5. 主进程读取 workspace 内图片，提取颜色、背景、边距、轴线、网格、线宽、标记尺寸、导出偏好和置信度。
6. 输出 `FigureStyleSpec v1`，并可通过 `buildFigureStyleApplyPlan(...)` 生成 Matplotlib rcParams 和 SciForge DataFigure Engine 的下一步提示。

## API

```ts
await window.dsGui.extractFigureStyle({
  workspaceRoot: '/path/to/workspace',
  sourcePath: 'figures/reference.png',
  sourceType: 'image',
  figureId: 'Fig. 2A',
  notes: 'reference paper style'
})
```

返回值：

```ts
type FigureStyleExtractResult =
  | {
      ok: true
      spec: FigureStyleSpec
      applyPlan: FigureStyleApplyPlan
      diagnostics: FigureStyleExtractDiagnostics
    }
  | { ok: false; message: string }
```

## v1.3 边界

- 支持 workspace 内 `png`、`jpg`、`jpeg`、`webp`、`bmp` 图片。
- PDF 输入会降级返回提示：先导出或裁剪目标 figure 为图片。
- 不联网、不安装依赖、不运行论文仓库代码、不执行 K-Dense skill 脚本。
- 参考图只用于风格约束，不用于复制原图数据或受版权保护的表达。
- 生成结果需要把 `FigureStyleSpec` 与输出 artifact 一起保存，便于审计和复现。

## 已接入位置

- 主进程提取器：`src/main/figure-style-extractor.ts`
- 共享类型：`src/shared/figure-style.ts`
- IPC schema：`figureStyleExtractPayloadSchema`
- IPC channel：`figure-style:extract`
- 文件选择 IPC：`workspace:pick-file`
- Electron preload：`window.dsGui.extractFigureStyle`、`window.dsGui.pickWorkspaceFile`
- Dev browser bridge：`extractFigureStyle`、`pickWorkspaceFile`
- K-Dense planning：`plottingWorkflow.styleReference`
- 右侧工作台面板：`FigureStylePanel`，可选择/拖入参考图、预览缩略图、查看置信度/配色/Matplotlib 映射/受控绘图工作流，并保存 `.sciforge/figure-styles/*.json`

## 下一步建议

1. v1.7 接 Scientific Plotting MCP Provider：把已保存的 `FigureStyleSpec` 映射为受控 MCP 绘图参数，先支持 Matplotlib 静态 PNG。
2. v1.8 增加参考图 profile 和 template advice：区分 chart/matrix/schematic，减少“颜色像但模板语义不像”的盲调。
3. v1.9 做 PDF figure crop：从论文 PDF 中选择 figure 区域，裁剪成图片后复用当前图片提取器。
4. v2 做更完整图类型识别和模板化生成：面向 attention、architecture、scientific schematic、multi-panel chart 增加专用模板。

## v1.4 更新：输出质量校正与相似度评分

- Typography 推断改为保守出版图尺度：axis 7-8 pt、label 8-9 pt、title/panel 10-11 pt，避免输出图字体过大。
- Mark 推断限制在 Matplotlib 常用论文图范围，避免线宽和 marker 在小图预览中过粗。
- `palette.accent` 只保留高对比或高饱和前景色，避免浅色背景/网格被当作主色。
- 新增 `figure-style:evaluate`：输入 reference/output 两张 workspace 图片，返回 `FigureStyleSimilarityScore`，包含 overall、palette、background、axes、grid、layout、marks 和 warnings。
- 右侧“图风格”面板新增“风格评分”区，可选择生成图并显示摘要分数和偏差提示。

已知边界：评分用于诊断和调参，不是严格验收；PDF 裁剪和完整 DataFigure Engine 执行闭环仍留到后续版本。

## v1.5 更新：网格落地、透明图处理与真实论文 smoke

- `FigureStyleSpec v1` 的 `axes` 增加 `gridColor`、`gridAlpha`、`gridLineWidth`，让浅色网格不只停留在 `gridTone`，而能映射到 Matplotlib rcParams。
- `buildFigureStyleApplyPlan(...)` 增加更完整的 Matplotlib hints：spine 显隐、axisbelow、grid alpha/linewidth、tick direction/size/width、text/tick/label color、line width、marker size、errorbar capsize、legend font/face/edge color、savefig facecolor。
- 透明或大面积 alpha 的 PNG 会先按透明像素推断黑/白 matte 后再采样，并在 diagnostics 中提示 `Transparent reference image was composited before style sampling.`，避免 arXiv HTML 图这类 RGBA 资源把少量标签色误判为背景。
- 网格相似度从单纯比较网格像素比例，改为“网格存在性 + 强度 + 颜色”的组合评分；肉眼可见但密度不同的网格不再被直接打成 0。

真实论文 smoke 样本位于 `tmp/figure-style-paper-smoke`，只作本地验证资产，不进入运行时：

| 样本 | 来源 | 类型 | overall | 主要诊断 |
| --- | --- | --- | ---: | --- |
| `nature-2021-alphafold-fig2` | Nature 2021, AlphaFold Fig. 2 | 多面板 bar/errorbar/scatter | 0.842 | 轴线/脊线深浅仍有差异 |
| `nature-2020-numpy-fig1` | Nature 2020, NumPy Fig. 1 | 科研示意图/表格 | 0.773 | 版面边距与原图不同 |
| `neurips-2017-attention-x1` | NeurIPS 2017/arXiv HTML, Attention visualization | 深色透明 attention 图 | 0.854 | 版面边距不同，透明图已合成采样 |

结论：对标准论文数据图，当前 StyleSpec 已能稳定约束背景、主色、网格、字号和 marker 大小；对科研示意图和深色透明图，颜色/背景可以跟随，但布局与图元语义仍需要 DataFigure Engine 的图类型识别和模板化生成来继续提升。

## v1.6 更新：出图后自检与保守自动修复

- 新增 `figure-style:review`：输入 reference/output 两张 workspace 图片，先复用相似度评分，再输出 `status`、`issues` 和 `autoRepair`。
- `status` 分三类：
  - `pass`：达到阈值且无明显问题。
  - `repairable`：存在可自动修复的渲染问题，建议 DataFigure Engine 自动重绘一次。
  - `manual_review`：存在可能涉及图元语义或数据表达的问题，不能静默修改。
- 自动修复只允许改渲染参数，不改数据、统计、坐标标签或单位。当前可自动 patch：
  - 背景：`figure.facecolor`、`axes.facecolor`、`savefig.facecolor`、`savefig.transparent`
  - 配色：文本/坐标轴颜色和提取出的 palette
  - 轴线：spine 显隐、edge color、axis linewidth、tick direction/size/width
  - 网格：`axes.grid`、`grid.color`、`grid.alpha`、`grid.linewidth`
  - 布局：字号、legend 字号、参考图 aspect ratio、`constrained_layout` / `tight_layout` / `bbox_inches="tight"` 提示
- 对 `marks` 低分只给诊断，不做静默修复，因为 marker/line 密度可能反映真实数据量或图类型，不应由风格工具擅自改动。

推荐生成闭环：`extract FigureStyleSpec -> render output -> review output -> 若 status=repairable，用 autoRepair patch 重绘 -> 再 review 一次 -> 保存最终图和 review 报告`。

## v1.7 更新：Scientific Plotting MCP Provider

- 科研绘图被封装为 first-party MCP 能力，而不是 SciForge 主应用内核功能。入口为 `--scientific-plotting-mcp-server`。
- 新增 MCP tools：
  - `scientific_plotting_status`：报告 Matplotlib renderer、模板和 artifact 写入策略。
  - `scientific_plotting_plan`：根据任务意图推荐受控模板和输入要求，不输出 shell/Python 命令。
  - `scientific_plotting_render`：从结构化 JSON 数据生成 PNG artifact，可应用 `FigureStyleSpec`。
  - `scientific_plotting_review`：比较参考图和输出图，返回相似度评分、issues 和 auto-repair 建议。
- v1.7 支持受控模板：`line`、`scatter`、`bar`、`heatmap`、`schematic-grid`。
- `scientific_plotting_render` 默认写入 workspace 内 `.sciforge/figures/`，同时生成 `.manifest.json`，记录 renderer version、输入摘要、输出路径、review/repair history 和 warnings。
- 自动修复仍保持保守：如果渲染后 review 为 `repairable`，最多自动重绘一次，只修改字体、线宽、marker、grid、边距、背景和 palette 映射，不修改数据语义。
- 插件页新增 `Scientific Plotting MCP` 推荐项；用户显式添加后才写入 MCP config。`ppt_master` 推荐项、配置 schema 和 IPC 语义保持不变。

边界：K-Dense skills 仍只作为只读知识源和规划依据；v1.7 不执行第三方 skill 脚本，不安装依赖，不做 PDF 裁图，也不做完整论文图类型识别。

## v1.8 更新：参考图 profile、模板建议与模板级修复

- `scientific_plotting_plan` 支持从 `styleSpec`、`styleSpecPath` 或 `referencePath` 推断轻量 `referenceProfile`，输出：
  - `kind`：`chart`、`matrix`、`schematic`、`mixed`、`unknown`
  - `recommendedTemplate`：推荐受控模板
  - `confidence`、`reasons`、`risks`
- `scientific_plotting_review` 和 `scientific_plotting_render` 的结果、manifest 中新增 `templateAdvice`，用于解释：
  - 当前模板是否与参考图 profile 兼容。
  - 哪些低分更可能来自模板语义差异，而不是可继续自动修的颜色/字体问题。
  - 下一步是否应换模板或等待专用 renderer。
- `heatmap` 模板在存在参考风格时，会从 `FigureStyleSpec` 的 palette 构造受控 colormap；若用户给出非默认 domain colormap，则尊重用户输入。
- `schematic-grid` 模板增加蛇形节点布局、长标签换行/降字号、边缘箭头路由，避免箭头穿过文字。
- manifest 继续记录 repair history、review score、warnings，同时记录 `referenceProfile` 和 `templateAdvice`，便于 SciForge agent/UI 决策。

真实论文 MCP smoke 当前结果：

| 样本 | profile | template | overall | palette | 主要诊断 |
| --- | --- | --- | ---: | ---: | --- |
| `nature-2021-alphafold-fig2` | chart | bar | 0.695 | 0.772 | 网格可见度、mark 密度与原图不同 |
| `nature-2020-numpy-fig1` | schematic | schematic-grid | 0.669 | 0.765 | schematic 的 axes/grid 分数仅作诊断 |
| `neurips-2017-attention-x1` | matrix | heatmap | 0.651 | 0.820 | palette 已改善，mark 密度仍需 attention 专用模板 |

边界：v1.8 仍不做 PDF 裁剪、论文全文解析或任意代码执行；profile 是可解释启发式，不是模型级图像理解。下一阶段应优先做 PDF figure crop 和更细的专用模板包。

## v1.9 更新：MCP 参考图准备与 PDF figure crop

- Scientific Plotting MCP 新增 `scientific_plotting_prepare_reference`，用于把 workspace 内参考图片或论文 PDF 页面的指定区域裁剪为受控 PNG reference artifact。
- `scientific_plotting_status` 新增 `referencePreparation`：
  - `imageCrop: true`
  - `pdfCrop.available`
  - `pdfCrop.command`
  - 默认输出目录 `.sciforge/figure-references`
- 图片输入支持 `png`、`jpg`、`jpeg`、`webp`、`bmp`；PDF 输入通过 `pdftoppm` 渲染指定页，再按 crop box 裁剪。
- `cropBox` 支持两种单位：
  - `ratio`：`x/y/width/height` 为 0-1 的页面或图片比例，适合 UI 框选。
  - `pixel`：以渲染后的页面或图片像素为单位，适合精确复现。
- 输出包含：
  - 裁剪后的 PNG：`croppedImagePath`
  - 可选 StyleSpec JSON：`styleSpecPath`
  - `FigureStyleSpec v1`
  - 轻量 `referenceProfile`，用于建议 `bar`、`line`、`scatter`、`heatmap` 或 `schematic-grid` 模板。
- PDF 渲染器检测会优先使用 `SCIFORGE_PDFTOPPM`，随后尝试系统 `pdftoppm` 和 Codex bundled Poppler 路径；如果不可用，MCP 以 degraded 状态返回明确提示，不自动安装依赖。
- Profile 启发式补强：浅色背景、明确坐标轴、密集前景图元会优先视为 measured chart；即使浅网格在 PDF 渲染/缩放后检测不到，也不会轻易误判为 heatmap。

示例 MCP 调用参数：

```json
{
  "sourcePath": "papers/example.pdf",
  "sourceType": "pdf",
  "page": 3,
  "dpi": 160,
  "figureId": "fig-2a-reference",
  "cropBox": {
    "unit": "ratio",
    "x": 0.12,
    "y": 0.18,
    "width": 0.72,
    "height": 0.44
  }
}
```

本阶段仍然不做自动论文全文解析、不自动定位 figure、不执行第三方代码、不联网、不安装依赖。用户或 UI 需要先提供 PDF 页码和裁剪区域；之后再由 `scientific_plotting_plan/render/review` 继续完成受控绘图、评分和最多一次保守自动修复。

## v1.10 更新：UI 状态可视化与参考图准备入口

- `FigureStylePanel` 接入 Scientific Plotting MCP 状态：
  - 显示 Scientific Plotting MCP reference preparation 状态。
  - 显示 PDF crop 是否可用。
  - 支持手动刷新状态。
- 新增 GUI bridge / IPC：
  - `scientific-plotting:status`
  - `scientific-plotting:prepare-reference`
- Electron preload 和 dev browser bridge 均暴露：
  - `window.dsGui.getScientificPlottingStatus(...)`
  - `window.dsGui.prepareScientificPlottingReference(...)`
- 参考图面板新增受控 crop 参数：
  - PDF page
  - PDF render DPI
  - ratio crop box：`x/y/width/height`
- 用户选择 PDF 后，主按钮会执行“准备并提取 StyleSpec”：
  1. 调用受控 reference preparation。
  2. 将 PDF 指定页区域裁剪成 workspace 内 PNG。
  3. 自动把当前 reference path 切换到裁剪 PNG。
  4. 对裁剪 PNG 重新提取 StyleSpec。
- 图片 reference 仍可直接提取，也可通过“裁剪图片参考图”生成裁剪 artifact。
- 评分 workflow 继续使用当前 reference path，因此 PDF 裁剪后会以裁剪 PNG 作为相似度参考，而不是整页 PDF。

v1.10 验证：

- `npm run test -- src/renderer/src/components/figure-style/FigureStylePanel.test.ts src/preload/index.test.ts src/renderer/src/dev/dev-ds-gui-bridge.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
  - 4 files / 58 tests passed。
- `npm run typecheck`
  - passed。

边界：v1.10 仍使用手动 ratio crop 输入；还没有可视化拖拽框选、自动 figure 检测或论文全文解析。这些留给 v1.11/v2。

## v1.11 更新：顶刊/顶会风格 smoke 回归集

- 新增可重复执行的 style regression runner：
  - `scripts/scientific-plotting-style-regression.mjs`
  - package script：`npm run smoke:scientific-plotting-style`
- 回归集当前覆盖三类参考图：
  - `Nature 2021 AlphaFold Fig. 2`：测量型 bar/chart。
  - `Nature 2020 NumPy Fig. 1`：科研 schematic/workflow。
  - `NeurIPS 2017 Attention visualization`：深色 attention/heatmap。
- runner 行为：
  1. 检查 reference PNG 和 StyleSpec JSON 是否存在。
  2. 通过 stdio MCP 启动 `scientific_plotting`。
  3. 对每个 case 调用 `scientific_plotting_render`。
  4. 自动 review，必要时最多 repair 一次。
  5. 输出 PNG、manifest、`summary.json` 和 `summary.md`。
- 默认输出目录：
  - `tmp/scientific-plotting-style-regression`

v1.11 本地 smoke 结果：

| 样本 | 模板 | 状态 | overall | palette | 主要 warnings |
| --- | --- | --- | ---: | ---: | --- |
| Nature 2021 AlphaFold Fig. 2 | `bar` | repaired | 0.695 | 0.772 | grid visibility、foreground mark density |
| Nature 2020 NumPy Fig. 1 | `schematic-grid` | repaired | 0.669 | 0.765 | axis/spine、grid、layout |
| NeurIPS 2017 Attention visualization | `heatmap` | repaired | 0.651 | 0.820 | axes、layout、mark density |

v1.11 验证：

- `npm run smoke:scientific-plotting-style`
  - `failed: []`
  - 生成 3 张 repaired PNG。
  - 生成 3 个 manifest。
  - 生成 `summary.json` / `summary.md`。
- 手动视觉检查：
  - 三张图均非空，模板类型正确，artifact 路径和 manifest 正常。
  - 当前主要问题不是工具不可用，而是模板质量：标题/字号仍偏大、schematic 版面还偏通用、attention 需要专用 renderer。

下一阶段继续补齐更复杂模板：`multi-panel`、`box/violin`、更紧凑的 `schematic` 和论文图类型识别。

## v1.12 更新：专用模板扩展

v1.12 将科研绘图 MCP 从通用 `bar/heatmap` 往论文图常见形态推进：

- 新增受控模板：
  - `errorbar-bar`：分类柱状图 + 显式误差棒。
  - `attention-map`：无默认 colorbar 的 token alignment / attention matrix。
- `scientific_plotting_plan` 增加关键词识别：
  - attention / token alignment / 注意力 -> `attention-map`
  - errorbar / CI / uncertainty / 误差棒 / 置信区间 -> `errorbar-bar`
- 渲染器继续只执行 first-party Matplotlib 代码，不执行 K-Dense skill 脚本或用户代码。
- 字体继续保持出版图保守尺度：axis 约 7 pt、label 约 8 pt、title/panel 约 9-10 pt。
- `attention-map` 默认使用深色矩阵表达，关闭 colorbar，降低与 NeurIPS attention 参考图的结构差异。

v1.12 本地 smoke 结果：

| 样本 | 模板 | 状态 | overall | palette | 主要 warnings |
| --- | --- | --- | ---: | ---: | --- |
| Nature 2021 AlphaFold Fig. 2 | `errorbar-bar` | repaired | 0.706 | 0.775 | grid visibility、foreground mark density |
| Nature 2020 NumPy Fig. 1 | `schematic-grid` | repaired | 0.669 | 0.754 | axis/spine、grid、layout |
| NeurIPS 2017 Attention visualization | `attention-map` | repaired | 0.649 | 0.820 | axes、layout、mark density |

v1.12 验证：

- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 7 tests passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/preload/index.test.ts src/renderer/src/dev/dev-ds-gui-bridge.test.ts src/renderer/src/components/figure-style/FigureStylePanel.test.ts`
  - 6 files / 68 tests passed。
- `npm run typecheck`
  - passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failed: []`
  - 3 个 case 均生成 PNG 和 manifest。

v1.12 边界：

- `errorbar-bar` 已能表达误差棒，但 legend 仍可能遮挡右侧柱子。
- `attention-map` 结构比通用 heatmap 更接近参考图，但 axes/mark-density 诊断仍偏低。
- `schematic-grid` 仍是通用流程图，尚未覆盖复杂论文示意图的图形语义。

## v1.13 更新：版式诊断、legend 避让与 panel/title 修复

v1.13 聚焦“绘图后先审视，有错误自动修”的第一批版式问题：

- `bar` / `errorbar-bar` 的 legend 默认移动到图外右侧，避免覆盖数据主体。
- `errorbar-bar` 增加更保守的误差棒 capsize、elinewidth、capthick。
- 分类标签根据长度动态旋转，减少 x 轴标签互相挤压。
- 正值柱状图默认从 0 起，并为误差棒和 panel label 预留 y 轴头部空间。
- 长标题自动降低一档字号；有标题时 panel label 向左上偏移，避免 `A/B/C` 压住标题。
- manifest / attempt 新增 `rendererDiagnostics`：
  - `legendPlacement`
  - `categoryLabelRotation`
  - `savefigPadInches`
  - `layoutNotes`

v1.13 本地 smoke 结果：

| 样本 | 模板 | 状态 | overall | palette | 主要 warnings |
| --- | --- | --- | ---: | ---: | --- |
| Nature 2021 AlphaFold Fig. 2 | `errorbar-bar` | repaired | 0.731 | 0.797 | grid visibility、foreground mark density |
| Nature 2020 NumPy Fig. 1 | `schematic-grid` | repaired | 0.711 | 0.811 | axis/spine、grid |
| NeurIPS 2017 Attention visualization | `attention-map` | repaired | 0.659 | 0.820 | axes、foreground mark density |

v1.13 关键观察：

- AlphaFold 图的 legend 已从图内移到图外右侧，manifest 记录 `legendPlacement: outside-right`。
- 手动视觉检查确认 AlphaFold 的 panel label 不再与标题重叠，legend 不遮挡柱子。
- NumPy schematic 和 NeurIPS attention 图均非空、未裁切，panel label 未压标题。
- AlphaFold 的 overall 分数高于 v1.12，但仍低于“无网格 repair 触发”的单次结果；原因是 review 仍将 grid mismatch 视为可修复项，下一步需要让 chart review 更理解参考图中的浅网格/背景结构。

v1.13 验证：

- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 7 tests passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/preload/index.test.ts src/renderer/src/dev/dev-ds-gui-bridge.test.ts src/renderer/src/components/figure-style/FigureStylePanel.test.ts src/main/ppt-master-mcp-config.test.ts`
  - 7 files / 74 tests passed。
- `npm run typecheck`
  - passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failed: []`
  - 3 个 case 均生成 PNG、manifest、summary。

v1.13 边界：

- `schematic-grid` 仍需要更像论文示意图的专用布局和图元。
- `attention-map` 还需要更细的 token label / axis-free 模式，以减少 axes 诊断误差。
- 当前 review 分数仍是诊断工具，不应作为唯一质量门槛；人工视觉审核仍然必要。

下一阶段继续做图像侧模板识别、review 智能化和更复杂示意图 renderer。

## v1.14 更新：统计模板包与 multi-panel 受控渲染

v1.14 将 Scientific Plotting MCP 从单一图表模板扩展到论文常见统计图和组合图：

- 新增受控模板：
  - `box-violin`：组间分布、小提琴图、箱线图、可选个体点。
  - `histogram-density`：直方图 + first-party Gaussian KDE 密度线。
  - `multi-panel`：最多 6 个受控子图，当前支持 line / scatter / bar / errorbar-bar / heatmap / attention-map / box-violin / histogram-density / schematic-grid 子面板。
- `scientific_plotting_plan` 增加关键词识别：
  - violin / boxplot / strip plot / 组间分布 -> `box-violin`
  - histogram / density / KDE / 分布图 / 直方图 -> `histogram-density`
  - multi-panel / subplot / facet / 多面板 / 多子图 -> `multi-panel`
- 新增输入边界：
  - `box-violin`：最多 24 组，每组最多 6000 个点。
  - `histogram-density`：最多 12 个 series，每组最多 6000 个点，bins 限制 5-120。
  - `multi-panel`：最多 6 个子图，columns 限制 1-3，禁止递归嵌套 multi-panel。
- renderer 继续保持 v1 安全边界：
  - 不执行用户 Python / shell。
  - 不执行 K-Dense skill 脚本。
  - 只消费结构化 JSON。
  - 只写 workspace 内 artifact。
- v1.14 自动修复/审图改进：
  - `histogram-density` legend 移到图外右侧，避免遮挡分布主体。
  - density line 不再重复进入 legend，减少图例噪声。
  - multi-panel 中 matrix/attention 子图没有显式 tick labels 时自动隐藏像素坐标 tick。
  - `rendererDiagnostics` 新增 `multiPanelCount`。

v1.14 本地 smoke 结果：

| 样本 | 模板 | 状态 | overall | palette | 主要说明 |
| --- | --- | --- | ---: | ---: | --- |
| Nature 2021 AlphaFold Fig. 2 | `errorbar-bar` | repaired | 0.731 | 0.797 | 延续 v1.13，legend 在图外 |
| Nature 2020 NumPy Fig. 1 | `schematic-grid` | repaired | 0.711 | 0.811 | 延续 v1.13，仍需更强 schematic |
| NeurIPS 2017 Attention visualization | `attention-map` | repaired | 0.659 | 0.820 | 延续 v1.13，axes 诊断仍偏保守 |
| v1.14 Controlled box/violin | `box-violin` | rendered | - | - | 生成 violin + box + deterministic jitter points |
| v1.14 Controlled histogram/density | `histogram-density` | rendered | - | - | 生成 histogram + KDE，legend 在图外 |
| v1.14 Controlled multi-panel | `multi-panel` | rendered | - | - | 生成 4 个 controlled subpanels，manifest 记录 `multiPanelCount: 4` |

v1.14 生成 artifact：

- `tmp/scientific-plotting-style-regression/regression-v114-box-violin.png`
- `tmp/scientific-plotting-style-regression/regression-v114-histogram-density.png`
- `tmp/scientific-plotting-style-regression/regression-v114-multi-panel.png`
- 对应 manifest 均在同目录，文件名为 `.manifest.json`。

v1.14 验证：

- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 9 tests passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/preload/index.test.ts src/renderer/src/dev/dev-ds-gui-bridge.test.ts src/renderer/src/components/figure-style/FigureStylePanel.test.ts src/main/ppt-master-mcp-config.test.ts`
  - 7 files / 76 tests passed。
- `npm run typecheck`
  - passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failed: []`
  - 6 个 case 均生成 PNG 和 manifest。

v1.14 手动视觉检查：

- `box-violin`：非空、未裁切，包含 violin / box / 个体点，panel label 不压标题。
- `histogram-density`：非空、未裁切，legend 已移到右侧，不遮挡主体。
- `multi-panel`：非空、未裁切，4 个子图布局正常；attention 子图已隐藏默认像素坐标 tick。

v1.14 边界：

- `multi-panel` 当前是模板组合器，还不是完整的期刊 panel layout engine；复杂共享 legend、跨 panel 对齐、显著性标注留给后续版本。
- `box-violin` 在 multi-panel 子图里当前只做简化 violin，完整 box + jitter 只在顶层 `box-violin` 模板里启用。
- 图像侧 `referenceProfile` 仍不会可靠识别 box/violin/histogram，需要 v1.15 增强参考图类型识别。

下一阶段继续推进顶刊风格库、review 对浅网格/结构图的误报降低，以及 multi-panel 的共享 legend / panel spacing 质量。

## v1.15 更新：参考图入口档案与 specialized profile 增强

v1.15 把 `scientific_plotting_prepare_reference` 从“裁剪并返回临时结果”升级为可审计的参考图入口：

- 每次成功准备参考图都会写入 `.reference.json` manifest。
- `ScientificPlottingPrepareReferenceResult` 新增：
  - `referenceManifestPath`
  - `referenceManifest`
- reference manifest 记录：
  - 原始 source path/type/page/尺寸。
  - 归一化后的 pixel crop box。
  - 裁剪 PNG 路径。
  - 可选 `styleSpecPath`。
  - `referenceProfile`。
  - `nextWorkflow`：建议后续调用 `scientific_plotting_plan/render/review`，并明确继续使用裁剪 PNG 作为 review reference。
- `referenceProfile` 新增 `detectedTraits`：
  - aspect：wide / tall / balanced
  - background：light / dark / mid
  - axes：measured / minimal / none / unknown
  - grid：none / light / medium
  - markDensity：sparse / balanced / dense
  - colorMode
  - panelGrid
  - textSignals
- profile 识别增强：
  - `attention-map` 的专用 token alignment 信号优先于 generic heatmap。
  - `box-violin`、`histogram-density`、`multi-panel` 可由 StyleSpec source/figureId/notes 中的文本信号触发。
  - `multi-panel` 也会读取 `panelGrid` trait。
  - 对 specialized 模板会返回风险提示：当前是视觉 trait + 文本信号的启发式，仍需要视觉确认。

v1.15 安全边界不变：

- 不自动解析全文论文。
- 不自动联网下载论文。
- 不执行第三方 skill 脚本。
- 不运行用户传入代码。
- 不把 K-Dense 147 个 skill 展开为 MCP tools。
- prepare reference 只在 workspace 内写裁剪 PNG、StyleSpec JSON 和 reference manifest。

v1.15 验证：

- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 10 tests passed。
- `scientific-plotting-style-regression.mjs` smoke 已接入 `scientific_plotting_prepare_reference`：
  - 先准备 `v1.15 AlphaFold reference preparation`。
  - 再运行原有 6 个 controlled render/review case。
  - summary 会额外列出 prepared reference、cropped PNG、reference manifest 和 recommended template。

## v1.16 更新：数据到受控绘图参数映射

v1.16 新增只读 MCP tool：`scientific_plotting_map_data`。

目标是把“用户意图 + 数据”映射成可直接交给 `scientific_plotting_render` 的结构化 `renderRequest`，让 SciForge 更接近“识别该画什么，再调用绘图 MCP”的闭环。

支持的输入形态：

- template-ready JSON：已经符合某个受控模板 schema 的数据会直接通过。
- tabular rows / records：
  - `rows` / `records` / `table`
  - 或顶层数组对象。
- numeric matrix：
  - 自动映射为 `heatmap` 或 `attention-map`。
- numeric vector：
  - 自动映射为 `histogram-density`。
- explicit multi-panel：
  - 已符合 `multi-panel` schema 时直接通过。

tabular 映射能力：

- `condition/treatment/group/category` + numeric value -> `box-violin`。
- `time/epoch/step/dose` + numeric y + optional method/model -> `line` 或 `scatter`。
- categorical + summary value + optional error/sem/sd/ci -> `bar` 或 `errorbar-bar`。
- numeric value + optional grouping -> `histogram-density`。

输出内容：

- `selectedTemplate`
- `confidence`
- `renderRequest`
- `dataSummary`
- `mappingBasis`
- `alternatives`
- `warnings`
- `guardrails`

安全边界：

- `scientific_plotting_map_data` 不写文件、不渲染、不联网、不执行用户代码。
- 它只做数据结构整理和受控模板选择。
- 若 tabular summary 需要对重复行取均值，会在 `warnings` 中说明，要求渲染前确认。
- 实际 artifact 仍必须交给 `scientific_plotting_render` 生成。

v1.16 smoke 增加：

- `v1.16 Tabular distribution mapping`
  - 输入：9 行 treatment/response records。
  - mapping：`box-violin`，confidence 0.96。
  - render：生成 `regression-v116-tabular-distribution-map.png`。

v1.16 验证：

- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 12 tests passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts`
  - 3 files / 21 tests passed。
- `npm run typecheck`
  - passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failed: []`

v1.16 边界：

- 当前是启发式 column mapping，不是完整语义数据理解。
- 复杂统计计算、显著性标注、单位推断和论文 caption 解析仍留给后续版本。
- `renderScientificPlot` 仍会按 StyleSpec 自身重新给出 referenceProfile；这用于审计，不会覆盖 map tool 的 `selectedTemplate`。

## v1.17 更新：Typography/Layout QA 与出版字号校正

v1.17 继续提高输出质量，重点修正“标题、坐标轴文字、tick label 在 PNG 预览中过大”的问题。

新增能力：

- `FigureStyleSimilarityScore` 增加可选 `typography` 分数。
- `reviewFigureStyleOutput` 增加 `typography` issue：
  - 通过参考图与输出图的 label band ink pressure 判断文字区域是否过重。
  - 当 typography 明显不匹配时，给出可自动修复的 rcParams patch。
- `scientific_plotting_render` 在进入 Matplotlib renderer 前强制应用出版图 typography clamp：
  - title：约 6.8-8.2 pt。
  - axis label：约 6.5-7.2 pt。
  - tick / legend：约 5.6-6.2 pt。
  - panel label：约 7.8-8.4 pt。
- `rendererDiagnostics` 增加 `typography`：
  - `titleSize`
  - `labelSize`
  - `tickSize`
  - `legendSize`
  - `panelSize`
  - `publicationClampApplied`
- manifest 和 smoke summary 会展示实际应用字号，方便用户审核。

安全边界：

- typography repair 只修改 Matplotlib 样式参数。
- 不改变数据、统计计算、轴标签语义、单位或模板选择。
- K-Dense 仍只提供只读绘图知识，不执行第三方 skill 脚本。

v1.17 smoke 增加：

- `v1.17 Typography clamp`
  - 输入：故意传入 24pt title、18pt axis label、14pt tick 的内联 StyleSpec。
  - 输出：自动压缩为 title 6.9、label 7.2、tick 6.2。
  - artifact：`tmp/scientific-plotting-style-regression/regression-v117-typography-clamp.png`。
- v1.16 表格映射输出也同步应用 typography clamp：
  - title 7.3、label 7.2、tick 6.2。

v1.17 验证：

- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts`
  - 2 files / 19 tests passed。
- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts`
  - 4 files / 28 tests passed。
- `npm run typecheck`
  - passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failed: []`

v1.17 边界：

- typography score 是像素启发式，不做 OCR，也不读取真实字体度量。
- 对深色透明参考图、非坐标轴示意图、attention heatmap 等特殊图，typography score 可能提示 manual review；这符合当前 v1.x 的保守策略。
- 下一步应优先做 legend / annotation QA、文本重叠检测和模板级语义审图，而不是继续只压字号。

## v1.18 更新：Legend/Layout QA 与图例遮挡校正

v1.18 继续修正输出图质量，重点处理长图例、密集图例和 panel label/title 重叠风险。

新增能力：

- `rendererDiagnostics` 增加 `layoutQuality`：
  - `legendItemCount`
  - `legendColumnCount`
  - `legendOutsidePlot`
  - `legendOverlapRisk`
  - `textOverflowRisk`
  - `panelLabelAdjusted`
  - `warnings`
- Matplotlib renderer 在保存前做 bbox-based layout QA：
  - 长图例或密集图例自动放到右侧图外。
  - grouped bar、errorbar-bar、histogram-density 默认更倾向图外 legend。
  - panel label 与 title 同时存在时自动偏移 panel label。
  - 检测 legend 与 axes bbox 的交叠比例，输出 none/low/medium/high 风险。
- smoke summary 增加 `Layout QA` 列，方便快速查看 legend inside/outside、overlap risk 和 text risk。

安全边界：

- v1.18 只改字体、图例位置、边距、panel label 偏移等样式布局。
- 不改变数据、统计计算、模板选择或坐标轴语义。
- 仍然不执行 K-Dense skill 脚本；K-Dense 只作为只读规划知识。

v1.18 smoke 增加：

- `v1.18 Legend layout QA`
  - 输入：4 条长名称 line series，强制触发 dense legend。
  - 输出：legend 放到右侧图外，`legendOverlapRisk: none`，`warnings: []`。
  - artifact：`tmp/scientific-plotting-style-regression/regression-v118-legend-layout-qa.png`。
  - manifest：`tmp/scientific-plotting-style-regression/regression-v118-legend-layout-qa.manifest.json`。

v1.18 回归验证：

- 当前 v1.19 targeted suite 仍覆盖 v1.18 layout QA case。
- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 15 tests passed。
- `npm run --silent smoke:scientific-plotting-style`
  - v1.18 case generated PNG and manifest。
  - `failed: []`。

## v1.19 更新：Review Packet 与审核状态报告

v1.19 把“生成图之后给用户审核”的流程固化为 MCP 能力：新增 `scientific_plotting_review_packet`，从已有 SciForge render manifest 生成 Markdown + JSON 审核包。

新增能力：

- 新增共享类型：
  - `ScientificPlottingReviewPacketRequest`
  - `ScientificPlottingReviewPacketItem`
  - `ScientificPlottingReviewPacket`
  - `ScientificPlottingReviewPacketResult`
- 新增 engine 函数：`createScientificPlottingReviewPacket`。
- 新增 MCP tool：`scientific_plotting_review_packet`。
- `scientific_plotting_status` 增加 `reviewPackets`：
  - 默认输出目录：`.sciforge/figure-reviews`
  - 读取 render manifest。
  - 写入 Markdown 和 JSON。
- review packet 汇总每张图：
  - output PNG path
  - manifest path
  - template/status
  - similarity score
  - review status
  - repair history
  - typography/layout QA
  - warnings
  - recommended actions
- smoke 脚本自动生成 v1.19 审核包，并在 `summary.md` 增加 Review Packet 表。

安全边界：

- `scientific_plotting_review_packet` 只读取 SciForge render manifest。
- 它不重新渲染、不重新评分、不执行用户代码、不联网。
- 写入路径仍限制在 workspace 内。
- recommended actions 只建议受控绘图工具或人工审核，不输出 shell/Python 命令。
- ppt-master 的 server id、IPC、配置 schema 和推荐项不参与此工具，保持兼容。

v1.19 smoke 输出：

- review packet Markdown：
  - `tmp/scientific-plotting-style-regression/v119-scientific-plotting-review-packet.md`
- review packet JSON：
  - `tmp/scientific-plotting-style-regression/v119-scientific-plotting-review-packet.json`
- packet summary：
  - items：9
  - rendered：6
  - repaired：3
  - review failed：0
  - needs attention：3
  - average overall：0.642
- MCP tool list：
  - `scientific_plotting_status`
  - `scientific_plotting_plan`
  - `scientific_plotting_prepare_reference`
  - `scientific_plotting_map_data`
  - `scientific_plotting_render`
  - `scientific_plotting_review`
  - `scientific_plotting_review_packet`

v1.19 验证：

- `npm run typecheck`
  - passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 15 tests passed。
- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
  - 5 files / 58 tests passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failedReviewPacket: false`
  - `failed: []`

v1.19 边界：

- review packet 是审核材料，不是论文图最终验收器。
- 分数仍是可解释启发式，用于定位哪里不像；是否可用仍需要用户或 agent 视觉审核。
- 没有参考图的 controlled smoke case 会提示先使用 `scientific_plotting_review`，不会伪造相似度分数。
- 下一步应进入 v1.20：顶刊/顶会 style profile registry，把 AlphaFold / NumPy / Attention 等参考样式沉淀为可复用风格入口。

## v1.20 更新：顶刊/顶会 Style Profile Registry

v1.20 把常用论文图风格沉淀为 first-party MCP 可发现的 style profile。目标是让用户或 agent 不必每次都先提供 StyleSpec 文件；当任务表达为“按 Nature / NeurIPS / 某个参考论文风格画图”时，可以先选择内置 `styleProfileId`，再由受控绘图 MCP 渲染。

新增能力：

- 新增共享类型：
  - `ScientificPlottingStyleProfile`
  - `ScientificPlottingStyleProfileSummary`
  - `ScientificPlottingStyleProfilesRequest`
  - `ScientificPlottingStyleProfilesResult`
- 新增 engine 函数：`listScientificPlottingStyleProfiles`。
- 新增 MCP tool：`scientific_plotting_style_profiles`。
- `scientific_plotting_status` 增加 `styleProfiles`：
  - `builtIn`
  - `acceptsStyleProfileId`
  - `defaultProfileIds`
- `scientific_plotting_plan` 支持 `styleProfileId`：
  - 用 profile 的 `referenceProfile` 参与模板推荐。
  - 返回 `styleProfileId` 和不含完整 `styleSpec` 的 `styleProfile` 摘要。
- `scientific_plotting_map_data` 支持 `styleProfileId`：
  - 映射出的 `renderRequest` 会保留 `styleProfileId`。
- `scientific_plotting_render` 支持 `styleProfileId`：
  - 若未显式提供 `styleSpec/styleSpecPath`，使用内置 profile 的 `styleSpec`。
  - manifest 记录 `styleProfileId` 和 profile 摘要。
  - `requestHash` 纳入 `styleProfileId`，保证复现审计。

内置 v1.20 profiles：

- `nature-2021-alphafold-fig2`
  - 用途：Nature/AlphaFold 风格的浅色 benchmark、bar/errorbar、line、box-violin。
- `nature-2020-numpy-fig1`
  - 用途：Nature/NumPy 风格的科研示意图、schematic-grid、multi-panel。
- `neurips-2017-attention`
  - 用途：NeurIPS attention/heatmap 风格，适合 dark matrix/attention-map。
- `nature-publication-light`
  - 用途：通用 Nature-like light publication chart。
- `cell-systems-statistical`
  - 用途：生物医学统计比较、box-violin、errorbar-bar、multi-panel。

安全边界：

- style profile 是 SciForge first-party 静态结构化风格，不执行第三方代码。
- `styleProfileId` 只影响可控样式参数、referenceProfile 和审计 provenance。
- 若同时提供 `styleSpec/styleSpecPath` 与 `styleProfileId`，显式 StyleSpec 优先，profile 会被忽略并产生 warning。
- profile 不会推断统计显著性、样本量、单位或数据语义。
- K-Dense 仍只作为只读规划知识，不作为 profile 执行源。

v1.20 smoke 增加：

- `v1.20 Style profile registry`
  - 输入：`styleProfileId: nature-2021-alphafold-fig2`。
  - 输出：受控 line 图，manifest 记录 profile provenance。
  - artifact：`tmp/scientific-plotting-style-regression/regression-v120-style-profile-registry.png`。
  - manifest：`tmp/scientific-plotting-style-regression/regression-v120-style-profile-registry.manifest.json`。
- smoke summary 增加 Style Profiles 表：
  - 工具：`scientific_plotting_style_profiles`
  - 查询：`nature neurips attention`
  - 返回 profile ids：`neurips-2017-attention`、`nature-2021-alphafold-fig2`、`nature-2020-numpy-fig1`、`nature-publication-light`。
- Review Packet item 数量从 9 增加到 10，包含 v1.20 profile-driven output。

v1.20 验证：

- `npm run typecheck`
  - passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 17 tests passed。
- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
  - 5 files / 60 tests passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failedStyleProfiles: false`
  - `failedReviewPacket: false`
  - `failed: []`

v1.20 边界：

- 内置 profile 是“风格入口”，不是完整论文理解或自动 panel 裁剪。
- 对真实论文的精准复刻仍优先走 `prepare_reference -> extract StyleSpec -> render -> review -> review_packet`。
- 下一步应进入 v1.21：PDF/截图输入增强和自动 panel/profile selection，让用户给一篇论文或截图时，SciForge 能自动建议 `styleProfileId` 或生成新的 StyleSpec。

## v1.21 更新：参考图驱动的 Style Profile 自动选择

v1.21 把 v1.20 的静态 profile registry 接到真实参考图入口上：用户给论文截图、图片或 `prepare_reference` 产物后，SciForge 可以先本地抽取 `FigureStyleSpec`，再按可解释分数推荐最接近的内置 `styleProfileId`。这一步仍是 first-party MCP 能力，不执行第三方 skill、不联网、不读取 workspace 外路径。

新增能力：

- `scientific_plotting_style_profiles` 支持参考输入：
  - `referencePath`
  - `styleSpecPath`
  - `styleSpec`
  - `workspaceRoot`
- 返回结果新增：
  - `status: "matched"`
  - `referenceProfile`
  - `profileMatches[]`
  - `selectedProfile`
- `profileMatches[]` 每项包含：
  - `profileId`
  - `profile` 摘要
  - `score`
  - `reasons`
  - `cautions`
- `scientific_plotting_prepare_reference` 现在会把 profile 匹配结果写入 reference manifest：
  - `styleProfileMatches`
  - `recommendedStyleProfile`
  - `nextWorkflow.suggestedStyleProfileId`
  - `nextWorkflow.suggestedProfileTool`
- `scientific_plotting_plan` 在传入 `referencePath/styleSpec/styleSpecPath` 时，会返回候选 `styleProfileMatches`。若没有显式 profile，则把最高分 profile 作为推荐 `styleProfileId`。
- `scientific_plotting_map_data` 在只有 `referencePath`、没有持久 `styleSpecPath` 的情况下，会把最高分内置 profile 传入 `renderRequest.styleProfileId`，避免后续渲染退回默认样式。

匹配依据：

- 图类型：`referenceProfile.kind`、`recommendedTemplate`、profile 支持模板。
- 视觉 traits：背景明暗、轴线类型、网格强度、横纵比、panel grid、mark density、color mode。
- 颜色：背景相似度、accent palette 最近邻相似度。
- 文本 query：当用户同时输入 `query` 时，profile 元数据命中会作为轻量加分。

安全边界：

- 匹配器只读取 workspace 内图片或 StyleSpec JSON。
- 如果用户明确提供 `referencePath/styleSpecPath/styleSpec` 但无法读取或解析，会返回 `invalid_request`，不会静默退回关键词列表。
- `selectedProfile` 是候选风格入口，不代表论文语义、数据、统计检验或 panel 内容已经被理解。
- 精确复刻仍应优先使用 `prepare_reference` 产出的 `styleSpecPath`；profile 适合快速选型、缺少持久 StyleSpec 时兜底、以及跨图保持一致风格。

v1.21 smoke 增加：

- `scientific_plotting_style_profiles(referencePath=tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png)`。
- summary Markdown 新增 `Reference Style Match` 表，显示：
  - `selectedProfile`
  - `score`
  - top reasons
  - warnings
- `prepare_reference` 的 reference manifest 现在包含 `recommendedStyleProfile` 和 `styleProfileMatches`。

v1.21 验证：

- `npm run typecheck`
  - passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 19 tests passed。
- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
  - 5 files / 62 tests passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failedStyleProfiles: false`
  - `failedReferenceStyleProfiles: false`
  - `failedV2StyleTransfer: false`
  - `failedReviewPacket: false`
  - `failed: []`

v1.21 边界：

- 还没有做自动 PDF 多 panel 检测；当前仍由 `cropBox` 指定页面区域，或传入已经裁好的截图/图片。
- profile 匹配是启发式，目标是给 MCP 规划一个可解释初始点；最终是否像仍靠 render/review/review_packet 闭环判断。
- v2 之后若继续优化，应做自动图类型/panel 候选识别，把用户给的一页 PDF 或一张截图拆成可准备的候选 panel。

## v2 更新：Scientific Plotting Style Transfer MCP Workflow

v2 不再继续拆 v1.x 小迭代，而是把已有能力收束成一个可调用的 SciForge first-party MCP 工作流：`scientific_plotting_style_transfer`。它不是主应用核心功能，也不是第三方 skill 执行器；它是一个受控 MCP provider tool，用于把“参考论文图风格 + 用户结构化数据”变成可审计的 PNG artifact。

v2 一次调用完成：

1. 准备参考图：
   - 若传入 `reference.sourcePath`，调用 first-party `prepare_reference` 裁剪图片或 PDF 页。
   - 产出 cropped reference PNG、StyleSpec JSON、reference manifest。
2. 选择风格入口：
   - 优先使用裁剪参考图提取出的 `styleSpecPath`。
   - 同时运行 style profile matching，写入候选 profile 和 reasons。
   - 若没有持久 StyleSpec，则使用最高分 `styleProfileId` 作为受控兜底。
3. 绘图规划：
   - 调用 `scientific_plotting_plan`，返回模板建议、输入要求、guardrails。
4. 数据映射：
   - 调用 `scientific_plotting_map_data`，把 tabular/template-ready 数据映射到受控模板。
5. 渲染与审图：
   - 调用 `scientific_plotting_render` 生成 PNG。
   - 如果有 reference image，自动 review，并最多做 1 次 bounded style repair。
6. 审核包：
   - 调用 `scientific_plotting_review_packet` 生成 Markdown + JSON 审核包。
7. v2 manifest：
   - 额外写入 `*.style-transfer.json`，记录 reference、StyleSpec、template、profile、output、render manifest、review packet 和 guardrails。

新增共享类型：

- `ScientificPlottingStyleTransferReferenceInput`
- `ScientificPlottingStyleTransferRequest`
- `ScientificPlottingStyleTransferManifest`
- `ScientificPlottingStyleTransferResult`

新增 engine 函数：

- `runScientificPlottingStyleTransfer`

新增 MCP tool：

- `scientific_plotting_style_transfer`

v2 安全边界：

- 只执行 SciForge first-party controlled renderer。
- 不执行用户传入代码。
- 不执行 K-Dense skill 脚本。
- 不联网、不安装依赖。
- 所有 artifact 写入 workspace 内。
- auto-repair 只改字体、线宽、marker、grid、边距、背景、palette 映射，不改数据语义。
- reference figure 只作为风格参考，不复制论文数据、标签或受保护内容。

v2 smoke 输出：

- 输入参考图：
  - `tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png`
- v2 MCP tool：
  - `scientific_plotting_style_transfer`
- 预期 artifact：
  - cropped reference PNG：`tmp/scientific-plotting-style-regression/v2-scientific-plotting-reference.png`
  - output PNG：`tmp/scientific-plotting-style-regression/v2-scientific-plotting-style-transfer-repaired.png`
  - render manifest：`tmp/scientific-plotting-style-regression/v2-scientific-plotting-style-transfer.manifest.json`
  - review packet：`tmp/scientific-plotting-style-regression/v2-scientific-plotting-style-transfer-review-packet.md`
  - v2 manifest：`tmp/scientific-plotting-style-regression/v2-scientific-plotting-style-transfer.style-transfer.json`
- smoke review：
  - `status: completed`
  - `reviewStatus: manual_review`
  - `overall: 0.691`
  - `palette: 0.748`
  - `background: 1.000`
  - `layout: 0.873`
  - `typography: 0.895`
  - warnings：axes/spine、grid、foreground mark density 与参考图仍有差异。

v2 验证：

- `npm run typecheck`
  - passed。
- `npm run test -- src/main/scientific-plotting-engine.test.ts`
  - 1 file / 19 tests passed。
- `npm run test -- src/main/figure-style-extractor.test.ts src/main/scientific-plotting-engine.test.ts src/main/scientific-plotting-mcp-config.test.ts src/main/ppt-master-mcp-config.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
  - 5 files / 62 tests passed。
- `npm run build`
  - passed。
- `npm run --silent smoke:scientific-plotting-style`
  - `failedPreparedReferences: []`
  - `failedMappedRenders: []`
  - `failedStyleProfiles: false`
  - `failedReferenceStyleProfiles: false`
  - `failedV2StyleTransfer: false`
  - `failedReviewPacket: false`
  - `failed: []`

v2 边界与后续方向：

- v2 已形成可用的 MCP provider 工作流，但仍不做自动论文全文解析。
- PDF 多 panel 自动检测仍未启用；当前需要用户或 agent 提供 `cropBox`，或传入已裁好的参考图。
- 顶刊/顶会 profile registry 目前是 first-party 小集合，后续可以扩展但不影响 v2 主链路。
- 后续如果继续优化，应聚焦 profile registry 扩展、PDF panel detector、更多模板和真实论文图 regression set，而不是把绘图变成主应用核心功能。
