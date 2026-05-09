# @sciforge-ui/runtime-contract

本包保存独立 UI component package 需要依赖的稳定运行时类型。它不包含 renderer 实现、workspace 逻辑或浏览器 API。

源码真相源位于 `packages/contracts/runtime`；发布包名和 import alias 继续保持 `@sciforge-ui/runtime-contract`。

## 包含内容

- `UIComponentManifest`
- `UIComponentRendererProps`
- `UIComponentRuntimeArtifact`
- `UIComponentRenderSlot`
- `UIComponentRenderHelpers`
- `UIComponentRenderer`
- `UIComponentWorkbenchDemo`
- 生命周期、section、dedupe、presentation 和 safety metadata 类型
- `RuntimeArtifact`、`PreviewDescriptor`、`ObjectReference`、`SciForgeReference`
- artifact preview action、object action、scenario instance id 等跨 package 纯类型
- session/message/run/execution unit/stream event/background completion event 等跨 runtime/UI 协议类型
- view-plan slot、display intent、resolved view plan 等组件选择协议类型
- AgentServer handoff、handoff payload 和 capability registry 契约
- conversation-policy request/response schema versions、fail-closed defaults 和 response normalizer
- observe provider capability brief、request/response、modality 和 invocation plan 纯协议类型/构造器

## 不包含内容

- SciForge app 私有状态
- registry 实现
- planner/agent 逻辑
- workspace/session store 具体实现
- session store 迁移、持久化和校验实现
- Workbench seed data
- browser API 或数据获取代码
- 具体组件 schema 和 renderer 实现

## 迁移规则

新的 component manifest 应从 `@sciforge-ui/runtime-contract` 导入类型。旧代码仍可通过 `packages/presentation/components/types.ts` 兼容重导出，但独立发布前应迁移到本包。

需要更窄依赖面时，优先使用明确子域入口：

- `@sciforge-ui/runtime-contract/app`
- `@sciforge-ui/runtime-contract/artifacts`
- `@sciforge-ui/runtime-contract/messages`
- `@sciforge-ui/runtime-contract/session`
- `@sciforge-ui/runtime-contract/stream`
- `@sciforge-ui/runtime-contract/execution`
- `@sciforge-ui/runtime-contract/events`
- `@sciforge-ui/runtime-contract/capabilities`
- `@sciforge-ui/runtime-contract/conversation-policy`
- `@sciforge-ui/runtime-contract/handoff`
- `@sciforge-ui/runtime-contract/handoff-payload`
- `@sciforge-ui/runtime-contract/observe`
- `@sciforge-ui/runtime-contract/view`
- `@sciforge-ui/runtime-contract/preview`
- `@sciforge-ui/runtime-contract/references`

修改 contract 后至少运行：

```bash
npm run typecheck
npm run smoke:runtime-contracts
```
