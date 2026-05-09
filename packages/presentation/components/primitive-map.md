# SciForge UI Data Primitive Map

本文档是 T080 兼容迁移的真相源，用于把当前 UI components、legacy artifact/component ids 映射到稳定 data primitives。不要另建 primitive 名称、preset 或 alias registry；未来重命名和兼容 adapter 都应与此表保持一致。

## Agent 快速契约

- 新 artifact contract 和 planner 词汇优先使用 `primitive` 名称。
- 当前 `componentId`、`moduleId` 和 legacy artifact types 在 manifests 与 app adapters 完成迁移前保留为兼容 alias。
- `volcano-plot`、`umap-viewer` 和未来 PCA/t-SNE/embedding scatter views 都视为 `point-set` presets。
- `heatmap-viewer` 视为 `matrix` preset。
- legacy component ids 在满足下方删除检查表之前只作为兼容 alias。不能因为已有 route target 就直接删除 legacy 目录。
- `unknown-artifact-inspector` 只作为不支持 payload 的 fallback，不是新的 primitive。
- Schema 草案位于 `packages/presentation/components/schemas/*.schema.json`；每个 schema 都包含 example payload。

## 当前组件映射

| Current componentId | Current moduleId | Current artifact aliases | Primitive | Preset/profile | Recommended renderer now | Future renderer target | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `report-viewer` | `research-report-document` | `research-report`, `markdown-report` | `document` | `markdown-report` | `report-viewer` | `document-viewer` | Preserve `report-viewer` as component alias while planner moves to `document`. |
| `paper-card-list` | `literature-paper-cards` | `paper-list` | `claim-evidence` | `literature-paper-list` | `paper-card-list` | `claim-evidence-viewer` or `record-set-viewer` | A paper list is evidence-bearing records; keep literature card presentation as a preset. |
| `network-graph` | `knowledge-network-graph` | `knowledge-graph` | `graph` | `knowledge-graph` | `network-graph` | `graph-viewer` | Requires `nodes` and `edges`. |
| `volcano-plot` | `omics-volcano-plot` | `omics-differential-expression`, `volcano-plot` | `point-set` | `volcano` | `volcano-plot` | `point-set-viewer` | Compatibility alias: `volcano-plot` -> `point-set` preset `volcano`. |
| `heatmap-viewer` | `omics-heatmap-viewer` | `omics-differential-expression`, `heatmap-viewer` | `matrix` | `heatmap` | `heatmap-viewer` | `matrix-viewer` | Compatibility alias: `heatmap-viewer` -> `matrix` preset `heatmap`. |
| `umap-viewer` | `omics-umap-viewer` | `omics-differential-expression`, `umap-viewer` | `point-set` | `umap` | `umap-viewer` | `point-set-viewer` | Compatibility alias: `umap-viewer` -> `point-set` preset `umap`; PCA/t-SNE should join this family. |
| `evidence-matrix` | `evidence-matrix-panel` | `evidence-matrix` | `claim-evidence` | `claim-evidence-matrix` | `evidence-matrix` | `claim-evidence-viewer` | Matrix layout is presentation; underlying primitive is claims linked to evidence. |
| `execution-unit-table` | `execution-provenance-table` | `*`, execution refs/log refs/code refs | `workflow-provenance` | `execution-unit-table` | `execution-unit-table` | `workflow-provenance-viewer` | Accepts any artifact but should render provenance views, not raw data tables. |
| `notebook-timeline` | `notebook-research-timeline` | `notebook-timeline`, timeline/log payloads | `workflow-provenance` | `research-notebook-timeline` | `notebook-timeline` | `workflow-provenance-viewer` | Use only for research log, decision timeline, or provenance narrative requests. |
| `data-table` | `generic-data-table` | `data-table`, `record-set`, row-like payloads | `record-set` | `generic-table` | `data-table` | `record-set-viewer` | Generic row/record fallback before raw inspector. |
| `molecule-viewer` | `protein-structure-viewer` | `structure-summary`, `structure-3d-html`, `pdb-file`, `structure-list`, `pdb-structure`, `protein-structure`, `mmcif-file`, `cif-file` | `structure-3d` | `molecule-structure` | `molecule-viewer` | `structure-3d-viewer` | External resources remain `declared-only`; workspace refs or manifest-declared demo assets only. |
| `scientific-plot-viewer` | `scientific-plot-viewer` | `plot-spec`, `point-set`, `matrix`, `record-set`, `time-series` | `plot-spec` | `plotly-compatible` | `scientific-plot-viewer` | `plot-spec-viewer` | Plotly-compatible source of truth for interactive scientific plots and derived export bundles. |
| `sequence-viewer` | `sequence-viewer` | `sequence`, `sequence-record`, `fasta`, `fasta-file`, `sequence-alignment` | `sequence-alignment` | `single-sequence` | `sequence-viewer` | `sequence-viewer` | Skeleton package; single-sequence profile uses `aligned: false`. |
| `alignment-viewer` | `sequence-alignment-viewer` | `sequence-alignment`, `multiple-sequence-alignment`, `pairwise-alignment`, `msa`, `alignment-file` | `sequence-alignment` | `alignment` | `alignment-viewer` | `sequence-alignment-viewer` | Skeleton package for aligned sequence rows. |
| `genome-track-viewer` | `genome-track-viewer` | `genome-track`, `genomic-range`, `bed-track`, `gff-track`, `vcf-variants`, `coverage-track` | `record-set` | `genome-track` | `genome-track-viewer` | `genome-track-viewer` | Skeleton package for gene model, variant, and coverage previews. |
| `image-annotation-viewer` | `image-annotation-viewer` | `image-volume`, `image-annotation`, `microscopy-image`, `pathology-image`, `gel-image`, `blot-image` | `image-volume` | `image-annotation` | `image-annotation-viewer` | `image-annotation-viewer` | Skeleton package for bbox/polygon/mask/comment anchors over declared image refs. |
| `spatial-omics-viewer` | `spatial-omics-viewer` | `spatial-map`, `spatial-omics`, `visium-spots`, `cell-coordinates`, `tissue-expression-map` | `spatial-map` | `spatial-omics` | `spatial-omics-viewer` | `spatial-omics-viewer` | Skeleton package for spot/cell coordinates with expression overlays. |
| `time-series-viewer` | `time-series-viewer` | `time-series`, `growth-curve`, `sensor-trace`, `longitudinal-measurement`, `plot-spec` | `time-series` | `time-series` | `time-series-viewer` | `time-series-viewer` | Skeleton package for ordered measurements. |
| `plate-layout-viewer` | `plate-layout-viewer` | `plate-layout`, `editable-design`, `assay-layout`, `well-map`, `screen-design` | `editable-design` | `plate-layout` | `plate-layout-viewer` | `plate-layout-viewer` | Skeleton package for 96/384-well maps. |
| `model-eval-viewer` | `model-eval-viewer` | `model-artifact`, `model-evaluation`, `classification-metrics`, `regression-metrics`, `model-report` | `model-artifact` | `model-evaluation` | `model-eval-viewer` | `model-artifact-viewer` | Skeleton package for ROC/PR/confusion matrix and model metrics. |
| `prediction-reviewer` | `prediction-reviewer` | `prediction-set`, `prediction-review`, `model-artifact`, `ai-predictions`, `record-set` | `record-set` | `prediction-review` | `prediction-reviewer` | `prediction-reviewer` | Skeleton package for human review of prediction rows. |
| `protocol-editor` | `protocol-editor` | `protocol`, `editable-design`, `experimental-protocol`, `method-document`, `workflow-protocol` | `editable-design` | `protocol` | `protocol-editor` | `protocol-editor` | Skeleton package for stepwise protocol patches. |
| `schema-form-editor` | `schema-form-editor` | `editable-design`, `schema-form`, `json-schema`, `form-artifact`, `parameter-set` | `editable-design` | `schema-form` | `schema-form-editor` | `editable-design-viewer` | Skeleton package for JSON Schema-backed field editing. |
| `comparison-viewer` | `comparison-viewer` | `artifact-diff`, `comparison-summary`, `record-set-diff`, `schema-diff`, `text-diff`, `model-comparison` | `record-set` | `artifact-diff` | `comparison-viewer` | `comparison-viewer` | Skeleton package for compact artifact diffs. |
| `publication-figure-builder` | `publication-figure-builder` | `figure-spec`, `plot-spec`, `publication-figure`, `plot-export-bundle`, `visual-annotation` | `figure-spec` | `publication-figure` | `publication-figure-builder` | `figure-viewer` | Skeleton package for multi-panel Plotly-compatible figure specs and export profiles. |
| `statistical-annotation-layer` | `statistical-annotation-layer` | `statistical-result`, `visual-annotation`, `plot-spec`, `figure-spec`, `comparison-summary` | `statistical-result` | `statistical-overlay` | `statistical-annotation-layer` | renderer overlay contract | Skeleton package for p value, CI, and effect-size visual annotations. |

### Fallback 组件

| Current componentId | Current moduleId | Accepts | Primitive role | Recommended renderer | Notes |
| --- | --- | --- | --- | --- | --- |
| `unknown-artifact-inspector` | `generic-artifact-inspector` | `*` | none/fallback | `unknown-artifact-inspector` | Safe JSON/ref/file/log fallback. It must not become a domain primitive or planner target unless no primitive renderer can accept the payload. |

## Primitive 目录

| Primitive | Schema draft | Primary current component(s) | Recommended renderer target | Legacy aliases and compatibility notes |
| --- | --- | --- | --- | --- |
| `document` | `schemas/document.schema.json` | `report-viewer` | `document-viewer` | `research-report`, `markdown-report`, `report-viewer`. |
| `record-set` | `schemas/record-set.schema.json` | `data-table`, `paper-card-list` fallback | `record-set-viewer` | `data-table`, row-like `paper-list`, `runtime-artifact.rows`. |
| `matrix` | `schemas/matrix.schema.json` | `heatmap-viewer` | `matrix-viewer` | `heatmap-viewer`, `omics-differential-expression.heatmap`; preset `heatmap`. |
| `point-set` | `schemas/point-set.schema.json` | `volcano-plot`, `umap-viewer` | `point-set-viewer` | `volcano-plot`, `umap-viewer`, `omics-differential-expression.points`, `omics-differential-expression.umap`; presets `volcano`, `umap`, future `pca`, `tsne`, `embedding-scatter`. |
| `graph` | `schemas/graph.schema.json` | `network-graph` | `graph-viewer` | `knowledge-graph`, `network-graph`. |
| `sequence-alignment` | `schemas/sequence-alignment.schema.json` | `data-table` fallback | `sequence-alignment-viewer` | Current manifests accept `sequence-alignment` in `data-table`; future renderer should own aligned residues/bases. |
| `structure-3d` | `schemas/structure-3d.schema.json` | `molecule-viewer` | `structure-3d-viewer` | `structure-summary`, `structure-3d-html`, `pdb-file`, `pdb-structure`, `protein-structure`, `mmcif-file`, `cif-file`, `molecule-viewer`. |
| `image-volume` | `schemas/image-volume.schema.json` | `unknown-artifact-inspector` fallback | `image-volume-viewer` | Covers images, microscopy, volume stacks, masks, and workspace image refs. |
| `time-series` | `schemas/time-series.schema.json` | `data-table` fallback | `time-series-viewer` | Use for ordered measurements; table view remains acceptable for simple rows. |
| `spatial-map` | `schemas/spatial-map.schema.json` | `unknown-artifact-inspector` fallback | `spatial-map-viewer` | Use for tissue coordinates, plates, physical layouts, or spatial omics. |
| `model-artifact` | `schemas/model-artifact.schema.json` | `unknown-artifact-inspector` fallback | `model-artifact-viewer` | Covers trained models, configs, metrics, checkpoints, and evaluation bundles. |
| `claim-evidence` | `schemas/claim-evidence.schema.json` | `evidence-matrix`, `paper-card-list` | `claim-evidence-viewer` | `evidence-matrix`, `paper-list`; matrix/cards are presets over claim/evidence links. |
| `workflow-provenance` | `schemas/workflow-provenance.schema.json` | `execution-unit-table`, `notebook-timeline` | `workflow-provenance-viewer` | Execution units, logs, code refs, timeline decisions, notebook events. |
| `editable-design` | `schemas/editable-design.schema.json` | `unknown-artifact-inspector` fallback | `editable-design-viewer` | For agent-editable plans, diagrams, schemas, prompts, notebook cells, or experimental designs. |
| `plot-spec` | `schemas/plot-spec.schema.json` | `volcano-plot`, `umap-viewer`, `heatmap-viewer` by preset | `plot-spec-viewer` | Plotly-compatible figure specs; can wrap point/matrix renderers when generated by analysis tools. |
| `figure-spec` | `schemas/figure-spec.schema.json` | `report-viewer` embedded/fallback | `figure-viewer` | Publication-ready composite figure layout; can reference plot/image/table primitives. |
| `statistical-result` | `schemas/statistical-result.schema.json` | `data-table`, `volcano-plot` by preset | `statistical-result-viewer` | Differential expression stats may project to `point-set` `volcano` plus `record-set`. |
| `visual-annotation` | `schemas/visual-annotation.schema.json` | overlay/fallback | renderer overlay contract | Annotation overlays for image, volume, structure, graph, figure, matrix, and point-set renderers. |
| `export-artifact` | `schemas/export-artifact.schema.json` | downloads/source bars/fallback | `export-artifact-viewer` | Export bundles, files, notebooks, PDFs, CSVs, HTML reports, or archive refs. |

## 兼容 Alias 规则

- app boundary 继续接受这些 `componentId` aliases：`volcano-plot`、`umap-viewer`、`heatmap-viewer`、`molecule-viewer`、`network-graph`、`report-viewer`、`paper-card-list`、`evidence-matrix`、`execution-unit-table`、`notebook-timeline` 和 `data-table`。
- Legacy component ids 只作为 replacement renderers 的 alias：`data-table` -> `record-table`，`network-graph` -> `graph-viewer`，`volcano-plot` / `umap-viewer` -> `point-set-viewer`，`heatmap-viewer` -> `matrix-viewer`，`molecule-viewer` / `molecule-viewer-3d` -> `structure-viewer`。
- planner 在 manifests 重命名前继续接受这些 `moduleId` aliases：`omics-volcano-plot`、`omics-umap-viewer`、`omics-heatmap-viewer`、`protein-structure-viewer`、`knowledge-network-graph`、`research-report-document`、`literature-paper-cards`、`evidence-matrix-panel`、`execution-provenance-table`、`notebook-research-timeline` 和 `generic-data-table`。
- Legacy artifact aliases 应先于 renderer selection 映射。例如 `omics-differential-expression` 带 `points` 时映射到 `point-set` preset `volcano`；带 `umap` 时映射到 `point-set` preset `umap`；带 `heatmap` 时映射到 `matrix` preset `heatmap`。
- Preset 是 renderer profile，不是新 primitive。把它们存入 `preset`、`profile` 或 view params，同时保持 `primitive` 稳定。
- 大型资产优先使用明确 data refs。`structure-3d`、`image-volume`、`export-artifact` 和外部文献资源必须遵守 manifest safety policy 与 workspace refs。

## Legacy Component 删除检查表

T080 兼容迁移期间，除非以下每项都满足并在同一变更中记录，否则不要删除 legacy component 目录：

- replacement component 已具备 renderer、fixtures、README、manifest、package exports、workbench demo 和覆盖 legacy 行为的 focused tests。
- 仓库范围 `rg` 确认没有直接 import legacy component 目录或 renderer。
- 历史 artifact/component ids 在 runtime UI manifest composition、scenario-core component selection 和 UI module registry helpers 中都有 alias fallback。
- `npm run packages:check`、`npm run typecheck` 和相关 UI/runtime/scenario focused tests 通过。
- 现有 scenario specs 与历史 runtime artifacts 仍能渲染或 fallback，且不丢失旧 `componentId`。

当前删除状态：

| Legacy componentId | Route target | Status | Deletion decision |
| --- | --- | --- | --- |
| `data-table` | `record-table` | alias fallback only | Deleted. `record-table` owns manifest, renderer, fixtures, Workbench demo, tests, and package export. |
| `network-graph` | `graph-viewer` | alias fallback only | Deleted. `graph-viewer` owns graph rendering and fixtures. |
| `volcano-plot` | `point-set-viewer` | alias fallback only | Deleted. `point-set-viewer` owns volcano-style point rendering via preset/data shape. |
| `umap-viewer` | `point-set-viewer` | alias fallback only | Deleted. `point-set-viewer` owns embedding scatter rendering via preset/data shape. |
| `heatmap-viewer` | `matrix-viewer` | alias fallback only | Deleted. `matrix-viewer` owns matrix/heatmap rendering and fixtures. |
| `molecule-viewer` | `structure-viewer` | alias fallback only | Deleted. `structure-viewer` owns declared structure refs, 1CRN demo assets, and structure metadata rendering. |
| `paper-card-list` | none | intentionally independent | Keep. Do not merge with evidence matrix or record table. |
| `evidence-matrix` | none | intentionally independent | Keep. Claim/evidence reasoning layout remains separate. |
| `execution-unit-table` | workflow-provenance route | intentionally independent view | Keep. Provenance table remains separate from notebook timeline. |
| `notebook-timeline` | workflow-provenance route | intentionally independent view | Keep. Timeline remains separate from execution table. |
| `unknown-artifact-inspector` | none | fallback only | Keep. It is the safety fallback, not a domain primitive. |
