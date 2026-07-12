# AlphaFold 3 单论文绘图质量评估

## 测试对象

本轮选取 Abramson et al., “Accurate structure prediction of biomolecular interactions with AlphaFold 3”, Nature 2024 作为单论文深测对象。参考来源为 [Nature article](https://www.nature.com/articles/s41586-024-07487-w)，测试只读使用论文题目、研究对象、图型意图和 CNS 论文图风格，不复制原论文图，也不声称提取了真实原始数据。

临时产物目录：

`/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3`

核心输出：

- [before/after contact sheet](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-before-after-contact-sheet.png)
- [research brief JSON](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-research-brief.json)
- [评估结果 JSON](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-eval-results.json)

## 测试流程

新增 smoke 脚本 `scripts/scientific-plotting-alphafold3-eval.mjs`，并加入根脚本 `npm run smoke:scientific-plotting-alphafold3`。

流程为：

1. 调用 `scientific_plotting_research_brief` 生成 AlphaFold 3 的论文图意图、figure conclusion、证据链、图型选择和 prompt 基础。
2. 生成三类图：模型结构/机制图、benchmark 数据图、多 panel 综合图。
3. 先生成 first render，再调用 `image_generation_prepare/render`，由 Model Router 配置的图像模型做视觉 polish。
4. 对 before/after 运行 review，输出相似度评分、warnings、人工观察和 contact sheet。

## 结果摘要

| 图型 | first render | gpt-image-2 polish | 评分 | 观察 |
| --- | --- | --- | --- | --- |
| 模型结构/机制图 | [first](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-architecture-first.png) | [polished](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-architecture-polished.png) | 0.709 | 图像模型明显提升机制图的层级、版式和视觉表达，适合作为机制图最终 polish 层；但标签密度和配色仍需后续约束。 |
| Benchmark 数据图 | [first](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-benchmark-first.png) | [polished](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-benchmark-polished.png) | 0.549 | 受控渲染保留数据语义，但较朴素；图像模型 polish 后视觉更丰富，却可能改动数值、样本量、p 值或坐标含义，不能直接用于严格数据图。 |
| 多 panel 综合图 | [first](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-multipanel-first.png) | [polished](/Applications/workspace/ailab/research/app/DeepSeek-GUI/tmp/scientific-plotting-cns-quality-eval/alphafold3/alphafold3-multipanel-polished.png) | 0.679 | 多 panel 需要更强的 panel contract、统一版式和事实锁定。图像模型能改善整体观感，但仍需约束每个 panel 的数据和结论。 |

## 关键发现

- `scientific_plotting_research_brief` 能作为绘图前置阶段，把“直接画图”改成“先理解论文图意图和证据链”。这说明 Nature/CNS skill 增强层可以工作，但运行时必须显式调用该工具，否则 UI 中仍会表现为直接绘图。
- 受控 scientific plotting 适合数据图、统计图、热图和多 panel 的初稿，因为它能固定数据、坐标轴、图例和数值语义。
- `gpt-image-2` 适合机制图、summary figure、视觉说明图和最终版式 polish，但对 benchmark 数据图不能自由重绘。
- CNS 级论文图通常不是单张孤立图片，而是多个 panel 的证据组织。SciForge 下一步应把 multi-panel spec 升级为一等能力，而不是把多个模板简单拼接。

## 本轮修复

- 新增 AlphaFold 3 单论文 smoke 脚本和报告输出。
- 将 image-generation worker 的尺寸归一化到 16 的倍数，避免 `gpt-image-2` 或兼容 endpoint 因 `1280x900` 这类尺寸返回 provider error。本次 smoke 中 `1280x900` 会自动调整为 `1280x896` 并记录 warning。

## 后续优化建议

1. 增加 `dataFidelityGuard`：图像模型 polish 后必须检查坐标轴、数值标签、样本量、p 值、legend 和 panel caption，发现新增或篡改数据时自动降级或要求重绘。
2. 对严格数据图采用“代码/矢量重渲染 + 非数据 overlay”策略，不让图像模型直接重画柱、点、误差线和坐标轴。
3. 将 multi-panel spec 标准化：每个 panel 绑定数据源、结论、图型、caption、锁定事实和允许修改范围。
4. 在运行时策略中强制论文图流程：先 `scientific_plotting_research_brief`，再给用户确认图型/分析角度，最后生成 first render 和可选 polish。
5. VisualDocument 审改回路应输出结构化修改意图，例如“换颜色”“放大局部”“加 callout”，并根据图型选择 scientific plotting 或 image-generation，而不是只把自由文本交给模型。
