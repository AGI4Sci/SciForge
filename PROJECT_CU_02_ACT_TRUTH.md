# Computer Use Act Truth 与 Materializer 工作包

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 把默认聊天 Guard 接到 runtime-owned Computer Use Act truth 和 materialization，同时禁止 GUI projection 或 diagnostic evidence 冒充完成。

**架构：** Codex Agent Host 拥有用户级 reasoning 和 completion。此工作包只提供 runtime-owned readiness、permissions、target/session refs 和本地 GUI intent 的 action materialization。

**技术栈：** TypeScript、Runtime Codex、WindowActionSession、BrowserHostSession refs、package bridge host-port contract。

---

## 写域

只修改：

- `src/runtime/codex/agent-host-*.ts`
- `src/runtime/codex/codex-*.ts`
- `src/runtime/codex/computer-use-native-route*.ts`
- `src/runtime/window-action-session.ts`
- `src/runtime/computer-use/package-bridge*.ts` 中与 host-port integration 相关、且已和 package owner 协调的部分
- 上述文件对应的 focused tests

不要修改：

- `packages/backend/**`
- `src/desktop/**`
- `src/ui/**`，除非 runtimeIntent 字段变化必须同步 API type tests
- [`PROJECT_CU_04_EVIDENCE_COMPLETION.md`](PROJECT_CU_04_EVIDENCE_COMPLETION.md) 拥有的 live acceptance validator 内部

## 任务

### 1. Runtime-owned Act-time Truth Source

- [x] 定义 `CodexAgentHostActTimeTruthSource` 的默认产品实现。
- [x] 从 WindowActionSession store 返回 runtime-owned session ready refs、target refs、actor cursor refs、lease refs 和 fresh observation refs。
- [x] 从 Computer Use adapter registry 返回 adapter provider id、adapter refs、capability refs 和 input isolation metadata。
- [x] 从 permission ledger 返回 permission refs、app/window allowlist refs 和 risk preview refs。
- [x] 返回 stop/cancel/takeover refs，并证明 GUI confirmation/cancel/stop result 能通过 runtime-owned path 回到 Agent Host。
- [x] Ready 判定拒绝 GUI projection、Image pane、replay、fixture、raw URL、base64 和 secret refs。

### 2. Default Act Materializer

- [x] 实现 ready preflight 对应的默认 `computerUseActMaterializer` 产品源。
- [x] Materializer 接收 Host 已归一化的 local GUI objective / generic intent、target refs、authorization profile、permission refs 和 fresh observation refs。
- [x] Materializer 不重新解释完整用户任务；用户级 planning 仍归 Agent Host。
- [x] 注入 host ports：capture、crop、plan、locate、execute、verify、writeTrace、emitEvent。
- [x] 需要模型的 `plan` / `locate` / `verify` host ports 必须调用 Model Router-owned helper，不能直连 provider。
- [x] Materializer 只返回 runtime-owned evidence refs；缺 action evidence 时 blocked。
- [x] 将 `needs-confirmation` 映射成 Agent Host approval request / GUI hard-confirm projection。
- [x] 将 blocked / repair-needed 映射成结构化 recovery diagnostics。

### 3. WindowActionSession 产品 owner

- [x] 定义产品 schema：windowRef、target summary、bounds/scale/screen id、actorCursor、adapter refs、input lease、focus lease、authorization profile、permission refs、cancel refs、evidence ledger refs。
- [x] 支持从 BrowserHostSession、app window annotation/manual binding、high-confidence screen region auto-binding 创建或复用 session。
- [x] Actor cursor 必须可见，并与 action evidence 指向同一个 owner/session。
- [x] FocusLease 只在必须使用 focused system input 时进入；默认优先非抢焦点 adapter。
- [x] 失焦、窗口迁移、尺寸变化、遮挡、关闭、导航、滚动、输入后必须刷新 observation 或返回 stale/blocked。
- [x] GUI 只能展示 session 状态、actor cursor、确认、stop/cancel 控件；不能传 executor internals。

### 4. Sanitized Runtime Intent Binding

- [x] `/computer-use` native route 只透传 sanitized `completionEvidencePolicy`。
- [x] `/computer-use` native route 只透传 sanitized `computerUseNext` / `computerUseLong` task bindings。
- [x] 增加回归测试：拒绝 secret/raw scenario 字段，只保留 task id、scenario id、title、requirements 和 boolean safety boundary 字段。

## 验证命令

- [x] `node --import tsx --test src/runtime/codex/computer-use-native-route.test.ts src/runtime/codex/codex-runtime-server.test.ts src/runtime/codex/agent-host-computer-use-act-materializer.test.ts src/runtime/codex/agent-host-computer-use-act-loop.test.ts`
- [x] `node --import tsx --test src/runtime/codex/agent-host-browser-computer-use-act-materializer.test.ts src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts`
- [x] `node --import tsx --test src/ui/src/api/sciforgeToolsClient/computerUseWorkspaceGatewayRequest.test.ts`
- [x] `npm run typecheck --silent`
- [x] `npm run smoke:no-hardcoded-success --silent`

## 必须用户协助

- [x] 单元实现和验证预计不需要用户协助。
- [x] 只有 product smoke 触发真实 Desktop 权限弹窗时，才必须用户协助。
