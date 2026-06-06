# Computer Use Acceptance 与 Release 工作包

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 把 Computer Use acceptance 从 diagnostic harness 迁到 Desktop product path，并让 release gates 和文档真实反映状态。

**架构：** Acceptance 必须从 SciForge Desktop 普通聊天触发，使用 Electron/native host，生成 current-run evidence，并诚实分类 diagnostic-only path。Fast gates 覆盖 contracts；opt-in gates 覆盖真实 Desktop 和复杂 workflow。

**技术栈：** TypeScript smoke tools、Electron product shell、Runtime Codex transport、BrowserHostSession、live acceptance reports。

---

## 写域

只修改：

- `tools/computer-use-chat-live-*.ts`
- `tools/computer-use-long-task-pool/**`
- `tools/desktop-*.ts`
- `tests/smoke/**computer-use**.test.ts`
- `package.json` 中 smoke/release gate scripts
- `docs/Usage.md`
- `docs/Architecture.md`
- `docs/VirtualAppScreenArchitecture.md`
- `docs/NativeExtensionOwnershipMap.md`
- `docs/native-extension-ownership-map.json`

不要修改：

- Runtime core Act truth 或 adapter implementation，除非只是消费已导出的 evidence。
- Provider config 或 package evidence validators，除非通过已记录的 public API。

## 任务

### 1. Desktop product acceptance

- [x] 构建 `computer-use-chat-live-e2e:product-strict` 或等价命令：必须从普通 SciForge Desktop chat 进入，不能使用 slash/debug/isolated producer 作为 pass。
- [x] 要求 Electron product shell、dynamic Workspace Writer、Runtime Codex transport、Desktop native host、BrowserHostSession 或 WindowActionSession target、必要时 hard-confirm surface、current-run evidence bundle。
- [x] Product strict 缺 display group、screen identity、actor cursor provenance、user control refs、native sidecar isolation、action ledger、replay bundle、validator/ledger refs 时必须失败。
- [x] 当前 opt-in live E2E 已对 package diagnostic evidence 正确 fail closed。

### 2. Complex matrix 非 live 合同覆盖

以下 `[x]` 只表示 focused matrix tests 已定义 Desktop product intent case、证据 requirement 和 release-report fail-closed 口径；`smoke:computer-use-chat-live-complex-matrix:opt-in-isolated` / release report 未有当前 live 通过证据前，不代表复杂 matrix release acceptance 已通过。

- [x] 覆盖 Browser research -> local report case definition 和 evidence requirements。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 Browser form draft 和 submit hard-confirm requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 CSV/table workflow 的 file/artifact validator refs requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 file organization workflow 的可见 file manager evidence requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 terminal/notebook workflow 的 explicit terminal workflow 和 artifact validation requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 cross-app document workflow 的 Browser/source reader -> editor -> file preview evidence requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 visual disambiguation workflow 的 crop/OCR/vision translator 和 ambiguous-target blocked requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 viewport recovery workflow 的 scroll 和 viewport state refs requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 repair workflow 的 blocked repair manifest 和 fresh re-observation requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）
- [x] 覆盖 high-risk confirmation workflow 的 Cancel/Confirm authorization requirement。（evidence: `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts`; `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts`）

### 3. Release gates

- [x] 拆分 fast contract gates、Desktop native product gates、opt-in complex live gates。（evidence: `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts`）
- [x] `verify:fast` 只覆盖 contracts、security、no-hardcoded-success、no-legacy-path checks。（evidence: `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts`）
- [x] Product release gate 必须要求 Desktop Electron native host；Web/Vite pass 仍是 diagnostic。（evidence: `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts`）
- [x] Browser live acceptance 和 Computer Use live acceptance 先分开验证，再组合验证。（evidence: `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts`）
- [x] Hard-confirm product smoke 要求真实 in-process Electron runner，并拒绝伪造 manifest。

### 4. 文档

- [x] 更新 `docs/Usage.md`：Desktop CU 启动、权限、blocked recovery、strict smoke commands、diagnostic 与 product 含义。（docs audit: added product-strict command wording; existing startup/permission/blocked/product-vs-diagnostic wording confirmed current）
- [x] 更新 `docs/Architecture.md`：只补架构事实，不把 GUI 写成 executor。（docs audit: current wording keeps GUI as presentation/control and assigns execution to TUI Host / Desktop native Host / Computer Use package）
- [x] 保持 `docs/VirtualAppScreenArchitecture.md` 明确 legacy VirtualAppScreen 不是 product path。（docs audit: current wording confirmed legacy-only / diagnostic-only）
- [x] 只有实际 owner 变化时，才更新 native ownership docs/map。（docs audit: no owner change found; map left unchanged）
- [x] `packages/actions/computer-use/README.md` 已标明 package diagnostic 与 product acceptance 的区别。

## 验证命令

- [x] `npm run smoke:computer-use-chat-live-preflight:strict`（2026-06-06 rerun exited `0`; manifest status `ready`）
- [ ] `npm run smoke:computer-use-chat-live-e2e:opt-in`（2026-06-06 latest rerun exited `1`; submitted via native route, final visible status `repair-needed`; prior execute-stage observe-before-mutate scope mismatch has a contract-level repair, pending restarted-service opt-in live rerun）
- [x] `npm run smoke:desktop-computer-use-hard-confirm-product:strict`（2026-06-06 rerun exited `0`; manifest status `passed`）
- [x] `npm run smoke:desktop-browser-native-live-acceptance:strict`（2026-06-06 rerun exited `0`; manifest status `passed`）
- [ ] `npm run smoke:computer-use-chat-live-complex-matrix:opt-in-isolated`
- [ ] `npm run release:computer-use-chat-live-complex-matrix-report`
- [ ] `npm run computer-use-long:preflight`（2026-06-06 rerun exited `1`; real path failed closed）
- [ ] `npm run computer-use-long:run-matrix`（2026-06-06 rerun exited `1`; matrix stopped `repair-needed`）
- [ ] `npm run computer-use-long:validate-matrix`（2026-06-06 rerun exited `1`; release validation requires `passed`）
- [x] `npm run computer-use-long:validate-matrix -- --allow-repair-needed`
- [x] `git diff --check`（2026-06-06 global board audit exit `0`）
- [x] focused non-live preflight tests: `node --import tsx --test tools/computer-use-chat-live-preflight.test.ts tests/smoke/computer-use-chat-live-preflight.test.ts tests/smoke/model-router-computer-use-live-acceptance-preflight.test.ts` exited `0` with 18/18 passing.
- [x] focused non-live release gate/report tests: `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts` exited `0` with 10/10 passing.
- [x] focused non-live CU-LONG contract smoke: `npm run smoke:computer-use-long --silent` exited `0`.

### 2026-06-06 chat live / preflight rerun evidence

- `npm run smoke:computer-use-chat-live-preflight:strict` exited `0` with `SCIFORGE_CONFIG_PATH`, `SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop`, `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop`, workspace writer, Runtime Codex, and provider proxy configured. Final manifest: `docs/test-artifacts/computer-use-chat-live-preflight/manifest.json`; manifest status `ready`, missing env `[]`, policy violations `[]`.
- `npm run smoke:computer-use-chat-live-e2e:opt-in` latest rerun exited `1`. It passed preflight, submitted through the host-owned native route, emitted `computer-use.tui-host-actions`, and wrote final manifest `docs/test-artifacts/computer-use-chat-live-e2e/manifest.json`; manifest status `failed`, visible status `repair-needed`, issue `expected-completed-got-repair-needed`, release acceptance `not-evaluated`. Native-route artifacts include `.sciforge/vision-runs/computer-use-package-20260606085938067/vision-trace.json` and `tui-host-run-task-chain.json`. This is not a live release pass: current execution reached planner success (`open_app TextEdit`) and then failed closed at execute-stage observe-before-mutate with `displayGroupId display-group-1 != display-group-default`.
- Runtime Codex planner blocker moved forward in the same evidence wave: provider reconnect messages are normalized as `audit/provider-retry` instead of terminal failure; nested planner env now carries `SCIFORGE_PROXY_URL`/port bindings, and Runtime Codex config healed `packages/backend/.codex-runtime/codex-home/config.toml` to `base_url = "http://127.0.0.1:3891/v1"` for the current controlled service set. Regression evidence: `src/runtime/codex/codex-runtime-config.test.ts`, `src/runtime/codex/computer-use-text-planner.test.ts`, `src/runtime/codex/backend-event-normalization.test.ts`, `src/runtime/codex/codex-app-server-client.test.ts`, `src/runtime/vision-sense/sense-provider.test.ts`, and `src/runtime/vision-sense/computer-use-grounding.test.ts` passed in focused reruns.
- Deterministic continuation hydration fix: gateway host adapter now expands refs linked from `continuation-request.json` (`blockedManifestRef`, `repairHintRef`, `sameTraceSessionRef`) before sending bounded planner metadata. Regression evidence: `node --import tsx --test src/runtime/computer-use/host-adapter.test.ts` exited `0` with 15/15 passing; `node --import tsx --test tests/smoke/computer-use-chat-live-e2e.test.ts` exited `0` with 42/42 passing; `npm run typecheck --silent` exited `0`. This is not a live release pass; live Desktop/native completion blockers above remain open.
- Generic Computer Use routing fix: the UI client now attaches sanitized host-owned `runtimeIntent` for `/computer-use` requests with completion policy or CU task bindings, and the Runtime Codex HTTP/SSE endpoint gives an explicit `computer-use-native-route` intent priority over the generic Agent Host turn loop. Regression evidence: the new focused client test first failed with missing `runtimeIntent` and then passed; the new focused Runtime server test first routed through `agent_host_turn_loop` and then passed. Full follow-up evidence: `tests/smoke/computer-use-chat-live-e2e.test.ts` 42/42, `tests/smoke/computer-use-chat-live-complex-matrix.test.ts` 17/17, `src/runtime/codex/codex-runtime-server.test.ts` 36/36, `npm run typecheck --silent` exit `0`. A single-case complex matrix live rerun taken before restarting the workspace/Runtime services still failed via stale Agent Host/browser fallback, so opt-in complex matrix release acceptance remains open until restarted-service live rerun evidence exists.
- Execute-stage scope repair: package-bridge execute now only promotes observe-before-mutate `displayGroupId` / `screenId` onto display-fallback screen-global mutations, and does not promote observation `windowId` onto window-local actions. Regression coverage includes the prior display fallback mismatch and a stale observation `windowId` fail-closed case. Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts src/runtime/computer-use/independent-input-adapter.test.ts src/runtime/computer-use/package-bridge-capture-port.test.ts` exited `0` with 35/35 passing; release/readiness smoke `node --import tsx --test packages/actions/computer-use/product-path.test.ts tests/smoke/computer-use-chat-live-e2e.test.ts tests/smoke/computer-use-chat-live-complex-matrix.test.ts tests/smoke/computer-use-release-gate-scripts.test.ts tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts src/runtime/codex/codex-runtime-server.test.ts tests/smoke/cu-next-readiness-manifest.test.ts tests/smoke/cu-user-acceptance-manifest.test.ts` exited `0` with 143/143 passing; `npm run typecheck --silent`, `git diff --check`, `npm run smoke:no-hardcoded-success --silent`, and `npm run smoke:no-legacy-paths --silent` exited `0`. This is not a live release pass; opt-in live rerun remains open.
- Approval boundary hardening: host adapter, package process, and execute port now require matching approval provenance with prior boundary refs/sidecars and a `riskActionHash` before emitting or honoring `allow-confirmed`; bare `decisionRef` / `approvalRef`, mismatched provenance, and weak inline-only provenance fail closed. Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/package-bridge-process.test.ts src/runtime/computer-use/host-adapter.test.ts` exited `0` with 42/42 passing; `node --import tsx --test --test-name-pattern "approval|confirmed retry" src/runtime/computer-use/package-bridge.test.ts` exited `0` with 2/2 passing; `npm run typecheck --silent` exited `0`. This is not a live release pass; opt-in live rerun and remote-desktop freshness-window audit remain open.
- Runtime visual freshness hardening: package bridge no longer extends remote-desktop visual observe-before-mutate evidence to `300_000ms`; scheduler caps declared visual `freshnessCheck.maxAgeMs` to the generic max; simulated remote-desktop adapter writes synthesized visual freshness at `30_000ms` and blocks stale visual evidence in production validation before executor projection. Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts src/runtime/computer-use/independent-input-adapter.test.ts` exited `0` with 39/39 passing. This is not a live release pass; opt-in live rerun remains open.
- Acceptance freshnessCheckRef dereference: live acceptance validator now dereferences observe-before-mutate `freshnessCheckRef` through `refRecords` and rejects missing, non-local, stale, expired, invalid-timestamp, or older-than-`30_000ms` freshness records. CU-NEXT validate-run/readiness loaders and smoke fixtures materialize valid freshness records for the same refs-first contract. Fresh evidence: `node --import tsx --test --test-name-pattern "freshnessCheckRef|requires task-level live acceptance markers and bindings" tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/cu-next-runner.test.ts` exited `0` with 4/4 passing; `node --import tsx --test --test-name-pattern "real cu-user-acceptance builder output|readiness wrapper forwards explicit evidence inputs" tests/smoke/cu-next-readiness-manifest.test.ts tests/smoke/cu-next-runner.test.ts` exited `0` with 2/2 passing; `npm run typecheck --silent` and `git diff --check` exited `0`. Follow-up fixture closure added generic refs-first product support records for artifact validation, current-run save causality, independent action ledger, and evidence index refs; fresh evidence: `node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts` exited `0` with 39/39 passing. This is not a live release pass; opt-in live rerun remains open.
- Restarted-service opt-in live rerun: `npm run smoke:computer-use-chat-live-preflight:strict --silent` exited `0` against the restarted `5173`/`5174`/`5175`/`5176` dev service set. `npm run smoke:computer-use-chat-live-e2e:opt-in --silent` then exited `1` after submission and output materialization. The old execute-stage `displayGroupId display-group-1 != display-group-default` blocker is cleared in run `.sciforge/vision-runs/computer-use-package-20260606104239043`; current run completed 3 package actions and wrote `report.md`. The remaining release blocker is product-native acceptance: `docs/test-artifacts/computer-use-chat-live-e2e/manifest.json` has `liveAcceptanceCandidate=false` and 22 issues because `.sciforge/vision-runs/computer-use-package-20260606104239043/cu-user-acceptance-manifest.json` is still `productPathClassification.tier=package-diagnostic` / `diagnosticOnly=true` and lacks current-run product refs for codex app server, native plugin invocation, native platform sidecar isolation, user-control plane, observe-before-mutate freshness ref records, BrowserRuntime DOM/AX observation hints, and artifact validation ref records.

### 2026-06-06 CU-LONG long-task pool slice

Executed with `/Applications/workspace/ailab/research/app/SciForge/config.local.json` available. Runtime/LLM config was discoverable, but real Desktop/native or executable independent input adapter evidence was not present, so the real CU-LONG path failed closed.

`npm run computer-use-long:preflight` exited `1`:

```text
[failed] CU-LONG preflight failed
- [executor] Real CU-LONG preflight requires Desktop native host evidence or an executable independent input adapter provider; bridge or adapter names alone are diagnostic-only.
- [scheduler] Real run has no independent input adapter and shared system input is not explicitly allowed.
```

`npm run computer-use-long:run-matrix` exited `1` and wrote `/Applications/workspace/ailab/research/app/SciForge/docs/test-artifacts/computer-use-long-matrix/matrix-20260606070539/matrix-summary.json`:

```text
[repair-needed] CU-LONG matrix stopped
  passed scenarios:
  repair-needed scenarios: CU-LONG-001, CU-LONG-002, CU-LONG-003, CU-LONG-004, CU-LONG-005, CU-LONG-006, CU-LONG-007, CU-LONG-008, CU-LONG-009, CU-LONG-010
  summary: /Applications/workspace/ailab/research/app/SciForge/docs/test-artifacts/computer-use-long-matrix/matrix-20260606070539/matrix-summary.json
```

`npm run computer-use-long:validate-matrix` now exits `1` for a repair-needed matrix:

```text
[failed] CU-LONG matrix validation failed
- matrix.status must be passed; use --allow-repair-needed only for structural inspection of blocked repair manifests
```

Repair-manifest inspection remains available and exited `0`:

```text
npm run computer-use-long:validate-matrix -- --allow-repair-needed
[ok] CU-LONG matrix repair-needed structural inspection passed
  scenarios: CU-LONG-001, CU-LONG-002, CU-LONG-003, CU-LONG-004, CU-LONG-005, CU-LONG-006, CU-LONG-007, CU-LONG-008, CU-LONG-009, CU-LONG-010
  validated runs: 0
```

Repair manifest: `/Applications/workspace/ailab/research/app/SciForge/docs/test-artifacts/computer-use-long-matrix/matrix-20260606070539/repair-manifest.json`.

Precise blockers:

- `desktop-product-path`: missing Desktop native host evidence or executable independent input adapter provider.
- `input-isolation`: no independent input adapter and shared system input is not explicitly allowed.

Verified release-gate semantics: `validate-matrix` defaults to requiring `passed`; `--allow-repair-needed` is the explicit structural inspection mode for blocked repair manifests and is not a release pass. Regression evidence: `npm run smoke:computer-use-long` exited `0` after the CLI wording fix.

## 必须用户协助

- [x] Smoke tooling 和 docs 预计不需要用户协助。
- [ ] 只有 Desktop product smoke 触发真实 OS 权限弹窗、登录或不能自动确认的高风险外部动作时，才必须用户协助。
