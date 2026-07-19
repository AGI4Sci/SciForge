# 科研工作流

SciForge 的一个完整回合通常是：**提出问题 → 规划 → 采集资料/数据 → 人工干预 → 执行 → 审阅证据 → 固化产物**。下面的配方可直接作为线程或 Workflow 的起点。

## 论文阅读与写作

1. 在 Paper Radar / `research_search` 中建立关键词、排除词和来源范围。
2. 把目标论文或 PDF 放入 Write，使用文本搜索和视觉锚点批注。
3. 让 Agent 只整理“主张—原文位置—不确定性”，不要先写结论。
4. 在批注包中确认引用，再生成综述段落、实验记录或 rebuttal 草稿。
5. 导出 Markdown / HTML / PDF / DOCX，并保留批注与 trace 作为可复查上下文。

## 复现论文代码与实验

1. 选择论文代码的 workspace，先让 Agent 阅读 README、依赖和数据入口。
2. 让它生成执行计划，明确环境、输入、预期输出和停止条件。
3. 只读检查通过后，逐次批准安装依赖、运行命令和写入文件。
4. 用 Changes / diff 审查改动；用日志和产物记录失败，不要只保留最终成功结果。
5. 将命令、参数、版本和结果摘要写入实验笔记或 Evidence DAG。

示例提示：

> 先不要运行。请从当前仓库找出复现实验的最短路径，列出需要的输入、预计产物、可能失败点和每一步需要我确认的副作用。

## 科学对象理解

科学 translator 当前优先处理蛋白序列（`.fasta` / `.fa` / `.faa`）、蛋白结构（`.pdb` / `.cif` / `.mmcif`）和小分子表示（`.smi` / `.smiles`）；单细胞表达通过对应 worker 接入。其他文件仍可作为 workspace artifact 引用，但不应假设会被通用模型直接理解；论文列出的 `.vcf`、`.bed`、`.gff`、`.mgf` 路径会 fail closed。推荐流程：

1. 把原始文件作为 workspace artifact 引用，不要把大文件全文复制到 prompt。
2. 让科学 translator 先生成带 modality、expert id、provenance 的文本证据。
3. 人工检查 translator 的 raw output、置信度和适用范围。
4. 再让主 Agent 基于证据做比较、假设整理或实验设计；把“证据”与“推测”分开记录。

## 图表、Canvas 与汇报

1. 用 Scientific Plotting 从结构化数据和 `FigureStyleSpec` 生成受控图表。
2. 在 Canvas 中查看、批注和形成 review packet；图像模型输出只当视觉草稿。
3. 对坐标、数值、legend、样本量、p 值和结论做人工锁定检查。
4. 将确认后的 figure、证据和叙事交给 PPT Master，完成布局 QA 后导出 PPTX。

## Workflow 与长任务

- 把搜索、清洗、分析、人工审批和输出拆成可观察节点；每个节点保留状态与结果。
- 计划触发、手动触发和 webhook 触发共享同一 workflow 数据结构。
- 长任务使用 Plan、side conversation 或 child agents 分解；每次恢复时先查看已有证据和未完成 Todo。
- Connect phone / Schedule 适合提醒与人工值守。当前非 SciForge Runtime 的后台 runtime 路径可能 fail closed，生产使用前请先做一次手动冒烟。

## 产物验收清单

- 输入、版本、参数和 workspace 路径可追溯。
- 每个自动结论都有来源、工具结果或人工批注。
- 生成图表有 manifest，事实层未被图像模型改写。
- 失败、拒绝和人工修改没有被覆盖掉。
- 最终交付物与 review packet、trace 或 Evidence DAG 能互相定位。
