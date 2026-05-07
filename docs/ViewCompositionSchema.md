# View Composition Schema

View Composition 让 SciForge 在不生成新 UI 代码的情况下调整 artifact 的呈现方式。它属于 interactive views/renderers 层：负责选择组件、绑定 artifact、设置编码和同步关系，不负责执行动作、验证结论或调用 AgentServer。

## Slot 示例

一个 `UIManifest` slot 可以包含以下可选字段：

```json
{
  "componentId": "umap-viewer",
  "artifactRef": "omics-differential-expression",
  "encoding": {
    "colorBy": "cellCycle",
    "splitBy": "batch",
    "overlayBy": "treatment",
    "facetBy": "donor",
    "compareWith": ["run-a", "run-b"],
    "highlightSelection": ["TP53"],
    "syncViewport": true,
    "x": "umap1",
    "y": "umap2",
    "label": "sample"
  },
  "layout": {
    "mode": "side-by-side",
    "columns": 2,
    "height": 360
  },
  "selection": {
    "id": "selected-cells",
    "field": "cellId",
    "values": []
  },
  "sync": {
    "selectionIds": ["selected-cells"],
    "viewportIds": ["main-umap"]
  },
  "transform": [
    { "type": "filter", "field": "fdr", "op": "<=", "value": 0.05 },
    { "type": "limit", "value": 50 }
  ],
  "compare": {
    "artifactRefs": ["run-a", "run-b"],
    "mode": "side-by-side"
  }
}
```

## 字段语义

- `componentId`：从 allowlist 中选择的 renderer。未知组件必须降级到 `UnknownArtifactInspector`。
- `artifactRef`：被渲染 artifact 的稳定引用。
- `encoding`：字段到视觉编码的绑定，例如颜色、坐标、分面、标签和高亮。
- `layout`：slot 内部布局约束，不应表达页面级装饰。
- `selection`：当前选择状态的稳定 id 与字段。
- `sync`：多个 view 之间的 selection 或 viewport 同步关系。
- `transform`：只读视图变换，例如 filter、sort、limit；不得直接改写 artifact 原始数据。
- `compare`：多 artifact 对比视图设置。

## Phase 1 行为

- `colorBy` 已用于 UMAP 点簇和 network node type。
- composition 设置会显示在每个 slot 中；暂不支持的参数必须可见，不应静默忽略。
- 未知或不支持的 component id 使用 `UnknownArtifactInspector` 渲染。
- 动态 UI plugin 默认关闭。

## 与 Object References 的关系

View Composition 产生的是可观察、可交互的视图状态。用户或 agent 在 view 中选择对象时，应输出稳定 object refs，例如 artifact id、row id、node id、sequence range、schema path 或 trace ref。屏幕坐标只能作为辅助证据，不能成为跨 UI/CLI 的长期事实。

## 与 Action / Verifier 的关系

Renderer 可以发出 `select`、`inspect`、`filter-change`、`verify-accept` 等事件，但事件本身不执行外部动作，也不生成最终 verdict。需要改变 workspace、GUI、远程系统或实验设备时，交给 action provider；需要计算 pass/fail/reward/critique 时，交给 verifier。
