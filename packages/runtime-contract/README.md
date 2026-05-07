# @sciforge-ui/runtime-contract

本包保存独立 UI component package 需要依赖的稳定运行时类型。它不包含 renderer 实现、workspace 逻辑或浏览器 API。

## 包含内容

- `UIComponentManifest`
- `UIComponentRendererProps`
- `UIComponentRuntimeArtifact`
- `UIComponentRenderSlot`
- `UIComponentRenderHelpers`
- `UIComponentRenderer`
- `UIComponentWorkbenchDemo`
- 生命周期、section、dedupe、presentation 和 safety metadata 类型

## 不包含内容

- SciForge app 私有状态
- registry 实现
- planner/agent 逻辑
- Workbench seed data
- browser API 或数据获取代码
- 具体组件 schema 和 renderer 实现

## 迁移规则

新的 component manifest 应从 `@sciforge-ui/runtime-contract` 导入类型。旧代码仍可通过 `packages/ui-components/types.ts` 兼容重导出，但独立发布前应迁移到本包。

修改 contract 后至少运行：

```bash
npm run typecheck
```
