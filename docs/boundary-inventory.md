# T122 边界清单

最后更新：2026-05-10

机器可读来源是 [`../tools/check-boundary-inventory.ts`](../tools/check-boundary-inventory.ts)。运行方式：

```bash
npx tsx tools/check-boundary-inventory.ts
```

该工具会校验 inventory 中列出的路径仍存在，并输出 JSON。它不是新的 enforcement gate；真正阻止违规的命令仍是：

```bash
npm run smoke:fixed-platform-boundary
npm run packages:check
npm run smoke:module-boundaries
npm run smoke:no-src-capability-semantics
npm run smoke:long-file-budget
```

当前 T122 cutover 已完成：`smoke:fixed-platform-boundary`、`smoke:no-src-capability-semantics` 和 `smoke:no-legacy-paths` 都应保持 0 tracked warnings/findings。新增代码如果重新打开 guard 面，必须同时更新本 inventory、对应 smoke baseline、owner、删除条件和 focused smoke 证据。

## Fixed Platform Inventory

`src/` 固定平台回答“系统怎么运行”。当前清单由工具中的 `fixedPlatform` 数组维护，覆盖：

- `app-shell-ui-orchestration`：app shell、session state、chat/results orchestration、runtime-facing UI clients。
- `workspace-writer-server`：workspace HTTP API、路径约束、file/open endpoints、scenario writer、feedback/repair handoff。
- `runtime-gateway-transport`：AgentServer transport、request envelope、stream normalization、timeout/resume、backend diagnostics。
- `conversation-policy-bridge`：Python conversation-policy bridge 和 bounded projection。
- `capability-registry-loader-broker-shell`：registry loader、availability validation、matching shell、skill/package discovery。
- `validation-repair-loop`：ToolPayload validation、verifier policy normalization、repair prompts、generated task reruns。
- `refs-artifacts-persistence`：workspace refs、artifact materialization、preview/raw APIs、object ref handoff、task result persistence。
- `permission-safety-sandbox`：runtime safety gates、action confirmation、sandbox policy、external action containment。
- `ledger-task-projects-work-evidence`：Capability Evolution Ledger、task project lifecycle、WorkEvidence projection、attempt history。
- `boundary-smoke-guards`：import topology、ownership、metadata、catalog discovery 和 long-file budget checks。

维护规则：

- 新增固定平台项时，在工具里给出 `id`、`owns`、`paths`、`checks` 和 `notes`。
- 如果新增项涉及 package-owned 语义，先改成 package capability；不要把 domain/provider/component/scenario 特例写进 `src`。
- 如果迁移删除历史命中，同步降低相关 smoke baseline。

## Pluggable Capability Inventory

`packages/` 插拔能力回答“系统能做什么”。当前清单由工具中的 `pluggableCapabilities` 数组维护，覆盖：

- `runtime-contracts`：capability、handoff、artifact、ref、observe、execution、stream 和 validation failure contracts。
- `skills`：agent-facing `SKILL.md` packages、generated catalog、tool/pipeline/domain/meta skill organization。
- `observe-providers`：read-only observe providers、modality adapters、trace contracts。
- `action-providers`：environment-changing providers、action manifests、provider-local safety、trace、rollback、approval requirements。
- `verifiers`：verifier manifests、fixtures、agent/rule/schema verifier providers、verdict contracts、repair hints。
- `interactive-views`：artifact renderer manifests、schemas、fixtures、workbench demos、component registry exports。
- `design-system`：presentation primitives、tokens 和 renderer support helpers。
- `scenario-core`：scenario package contracts、compiler helpers、validation gates、quality gates。
- `reasoning-conversation-policy`：conversation strategy algorithms、classifier policy、context/recovery planning。
- `support-helpers`：artifact preview、object reference helpers 和 package scaffold template。

维护规则：

- package 可以声明 manifest、schema、validator、provider、examples、repair hints 和 provider-local side effects。
- package manifest、README 或 skill contract 不能声称拥有 runtime lifecycle、artifact persistence、workspace ref resolution、global safety 或 stream lifecycle。
- package 如果需要共享稳定类型，先提升到 `packages/contracts/runtime` 或包自己的 public export。

## Boundary-Heavy Long Files

`smoke:long-file-budget` 的硬阈值是 1500 行，1000 行以上为 watch。T122 cutover 后，boundary-heavy 文件都不应再吸收 package-owned 语义；若继续增长，应优先拆分 runtime 子流程、prompt contract 或 UI shell，而不是新增领域/provider/scenario 特例：

| File | Current target | Extraction direction |
| --- | --- | --- |
| `src/runtime/generation-gateway.ts` | 主入口只保留 gateway orchestration | stream/resume、repair rerun、task project handoff 继续下沉到 `src/runtime/gateway/*` |
| `src/runtime/workspace-server.ts` | route registration 保持薄层 | scenario routes、feedback/repair endpoints、file/open/preview handlers 下沉到 `src/runtime/server/*` |
| `src/ui/src/app/ResultsRenderer.tsx` | 顶层 result composition | artifact preview selection、notebook panels、handoff/export controls 下沉到 `src/ui/src/app/results/*` |
| `src/ui/src/app/ChatPanel.tsx` | chat orchestration | run status、message transforms、composer references 下沉到 `src/ui/src/app/chat/*` |
| `src/runtime/workspace-task-input.ts` | bounded handoff assembly | artifact digest、retention/budget reducers、fixture builders 拆到 runtime helpers |
| `src/runtime/gateway/agentserver-prompts.ts` | prompt contract text only | mode/capability/repair copy 分块，但仍留在 `src/runtime/gateway` |

阈值策略暂不调整：1500 行继续作为必须在 `PROJECT.md` 覆盖的 hard budget，1000 行继续作为 watch 输出。当前计划的价值是防止这些文件在后续产品迭代中继续吸收 package-owned 语义或 runtime 子流程。
