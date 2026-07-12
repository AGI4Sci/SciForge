# Scientific Plotting 数据图实战评估

## 背景

本轮没有提交 PR，只在本地增强 `@sciforge/scientific-plotting`。我克隆并阅读了 GitHub 仓库 `DRZ-hang/paper-figures`，它的核心价值不是替代 SciForge 绘图，而是补强“论文数据 -> 图表规划 -> 统计图/表 -> 自检报告”的工作流。测试使用其中 `heart-failure-survival` 案例，数据为 299 例心衰患者临床记录。

## 已做修改

- 新增只读外部 skill catalog 项：`Paper Figures Data-First Workflow`，作为 CNS/领域绘图前的规划增强源。
- `scientific_plotting_research_brief` 新增 `paperFigureProductionPlan`，在已知论文信息和原始数据时规划 baseline table、关键变量比较图、相关性热图、KM、生存/森林图、ROC、多 panel summary。
- `paperFigureProductionPlan` 进一步新增 `compositionPlan`：明确论文级 figure 应先生成受控子图，再交给图像模型做 panel stitching、callout、局部放大和视觉统一，最后进入 VisualDocument 审改迭代。
- `box-violin` 与 `multi-panel` 内的 `box-violin` 支持 violin + box + jitter points + 组间显著性括号，用于更接近论文数据图。
- 补充 targeted tests，确认 paper-figures catalog、paper-level plan、统计/多 panel 渲染能力可用。

## 本地测试

测试脚本输出目录：

`/Users/yhh/Downloads/SciForge-gui/tmp/sciforge-paper-figures-eval/heart-failure/`

生成图包括：

- `sciforge-heart-failure-spearman-heatmap-repaired.png`
- `sciforge-heart-failure-key-predictors-repaired.png`
- `sciforge-heart-failure-ef-creatinine-scatter.png`
- `sciforge-heart-failure-km-draft-repaired.png`

关键预测因子图现在已具备论文图常见结构：小提琴分布、箱线图、散点、显著性括号。与参考图相比仍有差距：panel A/B、样本量/统计方法标注、版式密度和 Nature 风格统一性还需要继续增强。

## 发现的问题

- SciForge 目前缺专用 Kaplan-Meier、forest/effect-size、ROC、三线表模板，因此只能用通用 line/scatter/heatmap 近似一部分论文图。
- 论文级 figure 通常是多 panel 组合，而不是单张图；当前计划已将其拆成 `controlled_subfigures -> image2_composition -> canvas_review_iteration`。
- 图像模型阶段首选 `gpt-image-2`；如果该模型不可用，则使用 Model Router 当前配置的可用图像模型做拼版、callout、局部放大和视觉统一。图像模型不得改写数据、坐标轴、统计结论、样本量或论文事实。
- 当前 shell 状态检查中 image-generation worker 未看到 Model Router 环境变量，因此 CLI 显示 `placeholder/configured=false`；真实模型可用性应以后续 App 运行时的 Model Router 配置为准。
- 按主进程逻辑临时启动 Model Router sidecar 后，`image_generation_render` 已通过 `image-endpoint` 跑通一次 AlphaFold 3 多 panel composition smoke，输出：`/Users/yhh/Downloads/SciForge-gui/tmp/model-router-image-smoke/.sciforge/images/alphafold3-composition-smoke.png`。该图验证了图像模型可用，但仍只是 composition smoke，后续要接真实受控子图 manifests 才能评估论文级质量。

## 下一步

优先补专用统计模板和 paper-level figure report；随后执行“受控数据图 first render -> 图像模型拼版/美化 -> VisualDocument 审改 -> 新版本”的闭环测试，并用近年 CNS/Nature 论文的多 panel 图作为对照持续调参。

## vNext 协议：Skill Selection + Image Delta Polish

本轮进一步把“论文级绘图”拆成可审计的四段：`skill selection -> research brief -> controlled subfigures -> delta polish -> VisualDocument review`。`scientific_plotting_research_brief` 现在会返回 `selectedSkillProfile`，明确本次使用哪组只读 skill/profile。优先级固定为 `kdense -> cns -> domain -> image-delta`：K-Dense 作为出版级绘图基座，`nature-skills` 作为 CNS/Nature 工作流增强层，领域 skill 按论文内容补充，image-delta 只负责最后的视觉增量。

`paperFigureProductionPlan.compositionPlan` 新增 `imagePolishDeltaPlan`，模式固定为 `delta_only`。它会列出需要图像模型参与的 panel、允许的操作和必须锁定的科学事实。允许操作只包括 `panel_stitching`、`callout_overlay`、`zoom_inset`、`visual_unification`、`typography_cleanup`、`mechanism_visual_draft`；数值、坐标轴、legend、样本量、p 值、效应方向和论文结论必须保持不变。

`@sciforge/image-generation` 也同步增加 guardrail：没有参考图、受控子图 manifest 或 research brief 证据的科学图仍会被拦截；带有 `imagePolishDeltaPlan` 的请求可进入图像模型，但 manifest 会标记为 `usagePolicy.role = visual_composition_base`，并记录 `lockedFacts` 与 `sourceControlledArtifacts`。这意味着图像模型输出只是拼版/标注/局部放大的视觉草稿，不是最终科学数据图；最终事实层仍以后续 deterministic overlay 和 VisualDocument review 为准。
