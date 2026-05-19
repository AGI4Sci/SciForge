# AgentServer 遗留路径清理报告

最后更新：2026-05-19

范围：Worker D 对 `src/runtime/gateway/**`、`src/runtime/generation-gateway.ts`、`src/runtime/workspace-runtime-gateway.ts`、package smoke 脚本，以及 `tests/smoke/smoke-agentserver-*.ts` 中 AgentServer-first 默认路径的清点。

## 当前默认路径

当前 workspace server 仍会进入 AgentServer-first gateway：

```text
src/runtime/workspace-server.ts
  -> src/runtime/sciforge-tools.ts
  -> src/runtime/workspace-runtime-gateway.ts
  -> src/runtime/generation-gateway.ts
  -> STAGE_CODEX_RUNTIME_BRIDGE，当 request/runtimeBridge 显式选择 codex-exec-json
  -> STAGE_AGENTSERVER_GENERATION
  -> src/runtime/gateway/generated-task-runner.ts
  -> src/runtime/gateway/agentserver-generation-dispatch.ts
```

`src/runtime/workspace-runtime-gateway.ts` 目前是兼容导出，不是中性 bridge。它必须保留，因为 `src/runtime/sciforge-tools.ts`、现有 smokes 和多个 runtime tests 仍直接 import 它。

`src/runtime/generation-gateway.ts` 仍是当前 runtime pipeline。它会 import AgentServer context window、prompt、generation dispatch、stream parsing、backend diagnostics、payload recovery 和 generated task execution 相关模块。删除或改名这些模块会破坏当前 fallback 路径。

`src/runtime/codex/**` 已经出现在共享 worktree 中，但还不能视为 AgentServer 路径的已验证替代。在本轮清理检查中，`npm run typecheck` 仍失败于 `src/runtime/codex/codex-exec-json-adapter.ts`，并且 targeted gateway policy smoke 在新增 `codex-runtime-bridge` 阶段后仍有 stage-list 期望未同步。在这些 bridge 检查通过前，不应 quarantine 或删除 AgentServer smoke 集合。

## UI Import 状态

import check 没有发现 UI 直接 import `src/runtime/gateway/**`、`src/runtime/generation-gateway.ts` 或 `src/runtime/workspace-runtime-gateway.ts`。

UI 仍直接 import `src/runtime/conversation-kernel/**` 中的投影类型或模型：

- `src/ui/src/app/conversation-projection-view-model.ts`
- `src/ui/src/app/chat/sessionHistoryEdit.ts`
- `src/ui/src/exportPolicy.ts`

这些文件必须保留。它们是 projection/model 依赖，不是 AgentServer dispatch 依赖，但在迁移到中性 GUI/runtime contracts 之前，仍会阻止对 runtime projection 代码做大范围删除。

## Package Smoke 脚本

`package.json` 的默认 `smoke:all` 链路仍包含 AgentServer smoke。当前 `smoke:all` 中的 AgentServer 项是：

- `smoke:agentserver-unavailable`
- `smoke:agentserver-generation`
- `smoke:agentserver-context-window`
- `smoke:agentserver-artifact-followup`
- `smoke:agentserver-compact-repair`
- `smoke:agentserver-supplement`
- `smoke:agentserver-general-work`
- `smoke:agentserver-general-work-matrix`
- `smoke:agentserver-backend-matrix`
- `smoke:agentserver-direct-text`
- `smoke:agentserver-backend-failure`
- `smoke:agentserver-llm-endpoint`
- `smoke:agentserver-fenced-generation`
- `smoke:agentserver-path-only`
- `smoke:agentserver-timeout-resume`
- `smoke:agentserver-repair`
- `smoke:agentserver-acceptance-repair`
- `smoke:workspace-agentserver-repair`

`smoke:all` 之外还存在其他 AgentServer 定向脚本，包括 `smoke:agentserver-broker-payload`、`smoke:agentserver-prompt-policy-prose` 和 `smoke:agentserver-repair-budget`。

本轮不重命名、不 quarantine 这些脚本，因为 Codex runtime bridge 的替代覆盖尚未通过。当前 final gate 包含 `smoke:single-agent-runtime-contract`、`smoke:no-legacy-paths`、`smoke:web-final-conformance`、`smoke:web-multiturn-final` 和 `smoke:single-agent-final-evidence`，但它们还不能替代上面所有 AgentServer runtime-module smoke。

## AgentServer Smoke 文件

`tests/smoke/smoke-agentserver-*.ts` 下的已跟踪 AgentServer smoke 文件全部保留：

- `tests/smoke/smoke-agentserver-acceptance-repair.ts`
- `tests/smoke/smoke-agentserver-backend-failure-diagnostic.ts`
- `tests/smoke/smoke-agentserver-backend-matrix.ts`
- `tests/smoke/smoke-agentserver-broker-payload.ts`
- `tests/smoke/smoke-agentserver-compact-repair.ts`
- `tests/smoke/smoke-agentserver-context-window-contract.ts`
- `tests/smoke/smoke-agentserver-direct-text-bridge.ts`
- `tests/smoke/smoke-agentserver-entrypoint-direct-retry.ts`
- `tests/smoke/smoke-agentserver-fenced-generation.ts`
- `tests/smoke/smoke-agentserver-fresh-task-ignores-prior-attempts.ts`
- `tests/smoke/smoke-agentserver-general-work-matrix.ts`
- `tests/smoke/smoke-agentserver-general-work.ts`
- `tests/smoke/smoke-agentserver-generation.ts`
- `tests/smoke/smoke-agentserver-handoff-current-turn.ts`
- `tests/smoke/smoke-agentserver-llm-endpoint.ts`
- `tests/smoke/smoke-agentserver-no-rerun-direct.ts`
- `tests/smoke/smoke-agentserver-path-only-taskfiles-retry.ts`
- `tests/smoke/smoke-agentserver-path-only-taskfiles.ts`
- `tests/smoke/smoke-agentserver-repair-budget.ts`
- `tests/smoke/smoke-agentserver-repair.ts`
- `tests/smoke/smoke-agentserver-stage-taskfile-summary.ts`
- `tests/smoke/smoke-agentserver-stage-taskfiles.ts`
- `tests/smoke/smoke-agentserver-stream-text-generation.ts`
- `tests/smoke/smoke-agentserver-supplement-scoped.ts`
- `tests/smoke/smoke-agentserver-supplement.ts`
- `tests/smoke/smoke-agentserver-text-generation-fallback.ts`
- `tests/smoke/smoke-agentserver-timeout-resume.ts`
- `tests/smoke/smoke-agentserver-unavailable-diagnostics.ts`

## 清理决策

删除文件：无。

原因：import check 证明 AgentServer-first 模块仍位于当前 fallback 路径上；Codex CLI bridge 替代路径尚未通过 typecheck 和 targeted smoke。没有任何 AgentServer 文件在本轮被证明是纯死代码或生成残留。

保留文件：

- `src/runtime/generation-gateway.ts`：当前 runtime pipeline，仍包含 AgentServer dispatch stage。
- `src/runtime/workspace-runtime-gateway.ts`：active server/tests 仍使用的兼容导出；本轮已补充明确退役条件。
- `src/runtime/gateway/agentserver-*.ts`：generation dispatch、prompt/context、stream parsing、recovery、diagnostics 的 active dependency。
- `tests/smoke/smoke-agentserver-*.ts`：在 Codex bridge replacement coverage 成立前保留 legacy coverage。
- `package.json` 的 AgentServer smoke scripts：保留，避免在替代测试通过前降低覆盖。
- UI 对 `src/runtime/conversation-kernel/**` 的投影 import：保留，因为当前 UI 仍直接依赖。

## 退役条件

只有满足以下全部条件后，才能删除或移动 AgentServer gateway 文件：

1. `src/runtime/codex/**` 存在，并成为 workspace server 默认路径。
2. 默认路径不再 import `src/runtime/generation-gateway.ts` 或 `src/runtime/gateway/agentserver-*.ts`。
3. Codex bridge tests 覆盖 JSONL normalization、stderr audit events、exit code mapping、cancel cleanup、fail-closed runtime config、DeepSeek profile visibility 和 OpenAI opt-in behavior。
4. browser final acceptance 从默认聊天入口开始，并能展示来自 Codex bridge 的 provider/model/profile/workspace/command id。
5. `smoke:all` 不再依赖 AgentServer scripts 提供默认路径信心。
6. UI 对 runtime projection internals 的 import 已迁移到中性 GUI/runtime contracts 或 package entrypoints。
7. `npm run smoke:no-legacy-paths`、`npm run smoke:single-agent-runtime-contract`、targeted Codex bridge tests、`npm run typecheck`、`npm run build` 和 `git diff --check` 全部通过。

## 下一步安全清理补丁

Worker A 的 bridge 通过后，下一轮清理应以机械迁移为主：

1. 让 `src/runtime/sciforge-tools.ts` 或 workspace server route 调用 Codex bridge entrypoint。
2. 保留 `src/runtime/workspace-runtime-gateway.ts` 作为一个迁移窗口内的 legacy shim。
3. 只有在 Codex bridge smokes 覆盖同等默认路径风险后，才把 AgentServer smokes 移入 legacy/migration aggregate。
4. 删除任何 `src/runtime/gateway/agentserver-*.ts` 前必须先跑 import checks。
