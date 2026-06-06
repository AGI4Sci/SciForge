# Computer Use 并行实施总协调

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 把 [`PROJECT_CU.md`](PROJECT_CU.md) 拆成可并行执行的工作包，同时避免写域冲突和错误打勾。

**架构：** [`PROJECT_CU.md`](PROJECT_CU.md) 是 Computer Use 专项总板。`PROJECT_CU_*.md` 是并行工作包；每个 worker 只更新自己负责的工作包和对应代码写域，最后由集成者把真实验证过的状态同步回 [`PROJECT_CU.md`](PROJECT_CU.md)。

**技术边界：** Computer Use 新实现 TS-first；模型调用统一走 Model Router `/v1/responses`；Desktop/native product pass 必须 refs-first、current-run、runtime-owned。

---

## 全局规则

- [x] `packages/actions/computer-use` 下的新实现只用 TypeScript；Python 路径作废或保留为明确 diagnostic/legacy，不作为默认路径。
- [x] 不硬编码当前 URL、截图名、run id、agent id、bundle 路径、task id、scenario id 或历史 artifact。
- [x] package diagnostic、fixture、replay、DOM-only、AX-only、shell-written artifact、GUI projection 不能作为产品完成证据。
- [x] 大对象必须 refs-first：截图、trace、provider payload、日志、artifact、图片都引用 ref，不长期写入聊天正文或主上下文。
- [x] 产品通过必须来自当前 Desktop/native run。Web/Vite/dev 和 package-local harness 只能算 diagnostic，除非对应工作包证明真实 native product path；本项只表示分类和闸门口径已验证，不表示当前 Desktop/native product smoke 已通过。
- [ ] 如果发现其它 worker 正在改同一写域，立刻停止本地编辑，在工作包中记录冲突，并换到不重叠任务。
- [ ] 关闭正在运行的 subagent 或外部 worker 前，必须先发消息询问状态和是否可以关闭。

## 工作包索引

- [x] [`PROJECT_CU_01_ROUTER_MODEL.md`](PROJECT_CU_01_ROUTER_MODEL.md)：Model Router 模型面、TS-only package 边界、provider/config hygiene。
- [x] [`PROJECT_CU_02_ACT_TRUTH.md`](PROJECT_CU_02_ACT_TRUTH.md)：Act-time truth、default materializer、WindowActionSession product owner。
- [x] [`PROJECT_CU_03_NATIVE_GUI.md`](PROJECT_CU_03_NATIVE_GUI.md)：Desktop native adapters、BrowserHostSession live action、GUI control plane；strict hard-confirm product smoke 和 Browser native live acceptance 已有当前验证证据，非 strict smoke 仍按 diagnostic blocked 记录。
- [x] [`PROJECT_CU_04_EVIDENCE_COMPLETION.md`](PROJECT_CU_04_EVIDENCE_COMPLETION.md)：evidence ledger、freshness/stale、artifact completion guard。
- [ ] [`PROJECT_CU_05_ACCEPTANCE_RELEASE.md`](PROJECT_CU_05_ACCEPTANCE_RELEASE.md)：Desktop product acceptance、complex matrix、release gates。

## 当前已验证事实

- [x] TS package bridge 默认路径不再 spawn Python；host ports 走 TypeScript。
- [x] Embedded isolated-L3 completion evidence producer 已改为 TypeScript，并忽略 legacy Python env gates。
- [x] Runtime Codex host-owned `/computer-use` native route 只传 sanitized `completionEvidencePolicy` 和 CU task bindings。
- [x] BrowserHost / WindowActionSession materializer 不再合成 placeholder verifier 或 stale-invalidation success evidence。
- [x] Live completion guard 要求 current-run acceptance bundle，才允许 completed/request-submitted 通过。
- [x] Provider proxy 会把公开 `sciforge-router` alias 映射到配置的 upstream default model。
- [x] 当前 focused live/product-strict validators 仍 fail closed：`package-diagnostic` evidence 不能满足 Desktop/native `product-smoke`；Desktop native strict smoke 已在 `PROJECT_CU_03_NATIVE_GUI.md` 单独记录，chat live/complex matrix release acceptance 仍未通过。2026-06-06 restarted-service chat live E2E 已越过 Runtime Codex provider retry、stale `3892` provider URL、`isRecord` runtime blocker，以及 execute-stage `observe-before-mutate scope mismatch (displayGroupId display-group-1 != display-group-default)`；最新 blocker 是 current-run package bundle 仍投影为 `productPathClassification.tier=package-diagnostic`，缺 product-native `codex-app-server` / `codex-native-plugin` / platform sidecar / user-control / observe-before-mutate refs。失败证据：manifest `docs/test-artifacts/computer-use-chat-live-e2e/manifest.json`，run `.sciforge/vision-runs/computer-use-package-20260606104239043/vision-trace.json`。

## 集成者检查清单

- [x] 阅读每个变更过的 `PROJECT_CU_*.md`，确认新打勾项都有验证命令和证据路径。
- [x] 运行 `git diff --check`。（2026-06-06 global board audit exit `0`）
- [x] 代码集成后运行 `npm run typecheck --silent`。（2026-06-06 global board audit exit `0`）
- [x] 运行 `npm run smoke:no-legacy-paths --silent`。（2026-06-06 rerun exit `0`; no increased legacy paths: 1066 source files, 0 tracked findings）
- [x] 运行 `npm run smoke:no-hardcoded-success --silent`。（2026-06-06 global board audit exit `0`）
- [x] 运行各工作包列出的 focused tests。（2026-06-06 rerun: request-clarification、preflight focused batch、release gate/report、chat live E2E contracts、complex matrix contracts、Runtime Codex native-route regression、CU-LONG contract smoke 均 exit `0`；live Desktop chat E2E 和 opt-in complex matrix release acceptance 仍按下方证据保持 open）
- [x] 只有证据证明 scoped item 时，才更新 [`PROJECT_CU.md`](PROJECT_CU.md)。
- [x] [`PROJECT.md`](PROJECT.md) 只同步高层产品状态，不记录工作包流水。

### 2026-06-06 global board / focused-test audit evidence

- `git diff --check` exited `0`.
- `npm run typecheck --silent` exited `0`.
- `npm run smoke:no-legacy-paths --silent` exited `0`: `[ok] no increased legacy paths found: 1066 source files, 0 tracked findings.`
- `npm run smoke:no-hardcoded-success --silent` exited `0`: no release-path acceptance passphrases, sample science conclusions, prompt-specific success copy, or fake-success markers found.
- `node --import tsx --test packages/contracts/runtime/request-clarification-policy.test.ts src/runtime/request-clarification-runtime.test.ts` exited `0` with 5/5 passing.
- `node --import tsx --test tools/computer-use-chat-live-preflight.test.ts tests/smoke/computer-use-chat-live-preflight.test.ts tests/smoke/model-router-computer-use-live-acceptance-preflight.test.ts` exited `0` with 18/18 passing.
- `node --import tsx --test tests/smoke/computer-use-chat-live-e2e.test.ts` exited `0` with 42/42 passing.
- `node --import tsx --test tests/smoke/computer-use-chat-live-complex-matrix.test.ts` exited `0` with 17/17 passing.
- `node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts` exited `0` with 36/36 passing.
- `node --import tsx --test tests/smoke/computer-use-release-gate-scripts.test.ts tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts` exited `0` with 10/10 passing.
- `npm run smoke:computer-use-long --silent` exited `0`: `[ok] T084 Computer Use long task pool smoke passed`.

This audit did not prove live Desktop chat E2E completion, opt-in complex matrix release acceptance, or real CU-LONG matrix completion. Current live chat E2E reached the host-owned native route and submitted, but failed closed as `repair-needed`; complex matrix live rerun still needs restarted services after the Runtime explicit native-route priority fix.

### 2026-06-06 execute-stage scope repair wave

- Fixed package-bridge execute action scoping so display fallback screen-global mutations can inherit fresh `displayGroupId` / `screenId` from observe-before-mutate evidence without promoting observation `windowId` onto window-local actions.
- Added regression coverage for the prior display fallback mismatch and for stale observation `windowId` on a window-local action; the stale `windowId` case now fails closed with scheduler scope mismatch instead of silently using the stale observation as the lease scope.
- Added refs-first acceptance manifest input typing/passthrough for `evidenceIndex`, `evidenceIndexRef`, and `actionLedgerRef`.
- Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts src/runtime/computer-use/independent-input-adapter.test.ts src/runtime/computer-use/package-bridge-capture-port.test.ts` exited `0` with 35/35 passing.
- Fresh evidence: `node --import tsx --test packages/actions/computer-use/product-path.test.ts tests/smoke/computer-use-chat-live-e2e.test.ts tests/smoke/computer-use-chat-live-complex-matrix.test.ts tests/smoke/computer-use-release-gate-scripts.test.ts tests/smoke/computer-use-chat-live-complex-matrix-release-report.test.ts src/runtime/codex/codex-runtime-server.test.ts tests/smoke/cu-next-readiness-manifest.test.ts tests/smoke/cu-user-acceptance-manifest.test.ts` exited `0` with 143/143 passing.
- Fresh evidence: `npm run typecheck --silent`, `git diff --check`, `npm run smoke:no-hardcoded-success --silent`, and `npm run smoke:no-legacy-paths --silent` exited `0`; no-legacy reported 1080 source files and 0 tracked findings.
- This wave did not run or pass `npm run smoke:computer-use-chat-live-e2e:opt-in`; release acceptance remains open until a restarted-service opt-in live rerun passes.

### 2026-06-06 approval boundary hardening wave

- Tightened confirmed Computer Use approval flow across host adapter, package process, and execute port: `allow-confirmed` now requires a matching `approvalRef`, non-empty `riskActionHash`, and refs-first prior approval boundary evidence (`sourceApprovalRequestRef`, `sourceGuiAskUserRecordRef`, `sourceRiskAuditRef`) or the equivalent sidecar records.
- Explicit `humanApproval` / `decisionRef` without provenance now stays `fail-closed`; mismatched approval provenance is not forwarded to the package bridge; weak inline `source + approvalRequest + highRiskAction` provenance no longer approves high-risk actions.
- Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/package-bridge-process.test.ts src/runtime/computer-use/host-adapter.test.ts` exited `0` with 42/42 passing.
- Fresh evidence: `node --import tsx --test --test-name-pattern "approval|confirmed retry" src/runtime/computer-use/package-bridge.test.ts` exited `0` with 2/2 passing.
- Fresh evidence: `npm run typecheck --silent` exited `0`.
- This wave did not run or pass `npm run smoke:computer-use-chat-live-e2e:opt-in`; the restarted-service live rerun and Russell's remote-desktop freshness audit remain open follow-up work.

### 2026-06-06 runtime visual freshness hardening wave

- Removed the remote-desktop special case that promoted visual observe-before-mutate freshness to `300_000ms`; package bridge now keeps remote-desktop visual evidence on the generic `30_000ms` cap.
- Scheduler now caps declared visual `freshnessCheck.maxAgeMs` to the generic max, so a producer cannot self-extend stale screenshots, captures, grounding, or state refs by declaring a wider freshness window.
- Simulated remote-desktop independent adapter now writes synthesized observe-before-mutate sidecars with `freshnessCheck.maxAgeMs: 30_000`, and production-mode adapter validation blocks 60s-old visual evidence before executor projection or adapter state mutation.
- Fresh evidence: `node --import tsx --test src/runtime/computer-use/package-bridge-execute-port.test.ts src/runtime/computer-use/scheduler.test.ts src/runtime/computer-use/independent-input-adapter.test.ts` exited `0` with 39/39 passing.
- This wave did not run or pass `npm run smoke:computer-use-chat-live-e2e:opt-in`; the acceptance validator `freshnessCheckRef` dereference follow-up was completed in the next wave below.

### 2026-06-06 acceptance freshnessCheckRef dereference wave

- Live acceptance validator now requires each observe-before-mutate `freshnessCheckRef` to resolve through `refRecords` to a readable bundle-local freshness record; missing records, non-local refs, stale status, expired checks, invalid timestamps, or records older than the generic `30_000ms` visual cap fail closed.
- CU-NEXT validate-run and readiness manifest loaders now materialize the same refs-first freshness records instead of relying on manifest shape alone; smoke fixtures write valid freshness JSON for `freshness-check.json`.
- Fresh evidence: `node --import tsx --test --test-name-pattern "freshnessCheckRef|requires task-level live acceptance markers and bindings" tests/smoke/cu-next-live-acceptance-matrix.test.ts tests/smoke/cu-next-runner.test.ts` exited `0` with 4/4 passing.
- Fresh evidence: `node --import tsx --test --test-name-pattern "real cu-user-acceptance builder output|readiness wrapper forwards explicit evidence inputs" tests/smoke/cu-next-readiness-manifest.test.ts tests/smoke/cu-next-runner.test.ts` exited `0` with 2/2 passing; `npm run typecheck --silent` and `git diff --check` exited `0`.
- Follow-up fixture closure: CU-NEXT live acceptance fixtures now carry generic refs-first product support records for artifact validation, current-run save causality, independent action ledger, and evidence index refs. Fresh evidence: `node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts` exited `0` with 39/39 passing. This is not a live release pass; opt-in live rerun remains open.

### 2026-06-06 restarted-service opt-in live rerun

- Restarted `npm run desktop:dev` with `/Applications/workspace/ailab/research/app/SciForge/config.local.json`, remote-desktop independent adapter env, and fixed `5173`/`5174`/`5175`/`5176` service URLs; strict preflight exited `0` and wrote `docs/test-artifacts/computer-use-chat-live-preflight/manifest.json` with status `ready`, no missing env, no failed services, and no policy violations.
- `npm run smoke:computer-use-chat-live-e2e:opt-in --silent` exited `1` after submitting and materializing output. Current manifest `docs/test-artifacts/computer-use-chat-live-e2e/manifest.json` reports `status=failed`, `visibleStatus=output-materialized`, `requestSubmitted=true`, `liveAcceptanceCandidate=false`, and 22 live acceptance issues.
- The previous execute-stage display-group mismatch is no longer the blocker: current run `.sciforge/vision-runs/computer-use-package-20260606104239043` completed 3 package actions and wrote `report.md`. The remaining blocker is product acceptance classification/evidence: `.sciforge/vision-runs/computer-use-package-20260606104239043/cu-user-acceptance-manifest.json` is `productPathClassification.tier=package-diagnostic`, `diagnosticOnly=true`, `productSmokeEligible=false`, and lacks product-native refs for `codex-app-server`, `codex-native-plugin`, native platform sidecar isolation, user control, BrowserRuntime DOM/AX observation hints, observe-before-mutate freshness refs, and product artifact validation ref records.

## 必须用户协助

- [x] 拆分和普通实现不需要用户协助。
- [ ] 只有 macOS/Electron/Desktop native 权限弹窗、真实账号登录、支付/发送/上传/删除确认、或本机缺少 secrets 阻塞 product smoke 时，才需要用户协助。
