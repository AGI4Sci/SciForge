# Computer Use Evidence 与 Completion 工作包

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 让 Computer Use evidence、freshness、stale invalidation、artifact validation 和 completion guard 都基于 current-run、因果链和产品安全口径。

**架构：** Evidence ledger 是唯一算法记忆。Completion 归 Agent Host 和 package-owned live acceptance validation；GUI presentation、旧 run、fixture、模型自信只能支持 diagnostic，不能证明完成。

**技术栈：** TypeScript、package evidence contracts、live acceptance validator、artifact validators、runtime trace/result projection。

---

## 写域

只修改：

- `packages/actions/computer-use/evidence*.ts`
- `packages/actions/computer-use/live-acceptance-validator.ts`
- `packages/actions/computer-use/runtime-policy*.ts`
- `src/runtime/computer-use/package-bridge-evidence.ts`
- `src/runtime/computer-use/package-bridge-final-artifacts.ts`
- `src/runtime/computer-use/package-bridge-result.ts`
- `src/runtime/computer-use/package-bridge-trace.ts`
- `tools/computer-use-chat-live-completion-evidence.ts`
- 上述文件对应的 focused tests

不要修改：

- `src/desktop/**`
- GUI projection 文件
- provider config
- action adapter implementation，除非只是消费 evidence contract types

## 长文件拆分登记

- [x] `packages/actions/computer-use/live-acceptance-validator.ts` 当前超过 2000 行，已在 `PROJECT.md` 登记为 `registered-watch`；CU_04 后续触碰时优先拆分 schema validation、refs-first evidence checks、platform-specific live checks、report writer。
- [ ] Follow-up split task: while touching `packages/actions/computer-use/live-acceptance-validator.ts`, split the acceptance validator into focused modules before or alongside the freshness follow-up: schema/input validation, refs-first evidence dereference checks including `freshnessCheckRef` from `refRecords`, platform-specific live/product checks, and report writing. The split must preserve fail-closed behavior for stale/expired/too-old freshness records and keep CU_05 release acceptance blocked until focused validator tests and restarted-service opt-in live evidence pass.
- [x] `src/runtime/computer-use/package-bridge.test.ts` 当前超过 2000 行；作为 CU_04 focused regression test 临时登记，后续拆分 package bridge evidence fixtures、completion guard cases、product-path classification cases、trace/result adapter cases。
- [x] `tests/smoke/computer-use-chat-live-e2e.test.ts` 当前超过 2000 行；作为 CU_04 focused smoke test 临时登记，后续按 preflight、product-strict、approval、continuation、live-bundle validation 分组拆分。

## 任务

### 1. Evidence ledger contract

- [x] 定义 evidence ledger -> observation snapshot -> local controller brief compact contract，包含 owner/session/target、freshness、cost tier、scope、confidence 和 invalidation rule。
- [x] 按用途实现 evidence selection：target scope、visible state/clickability、text/label、role/state、executable target、after-action verification、completion handoff。
- [x] 在 trace 中登记 T0-T5 observation cost tier、升级原因、latency 和 model call count。
- [x] 已有 windowRef/targetRef 时默认 target/window-local observation；full screen 必须有明确 reason。
- [x] 强制结构化能力优先：BrowserHostSession/CDP/DOM/AX、app-native command、PTY/editor/file/validator 足够时，不升级到 vision 或 GUI click。

### 2. Action ledger 与 stale rules

- [x] 每个 mutating action 记录 before evidence、grounding evidence、executor event、after evidence、verification 和 freshness invalidation。
- [x] Placeholder verifier 和 synthetic stale-invalidation success refs 不能通过 materializer guards。
- [x] click/open/menu/navigation/scroll/type/save/window switch/focus takeover 必须 stale 相关 screenshot、OCR、object location、grounding、role/state 和 completion candidates。
- [x] Low-risk batch 只允许同一 target/lease；navigation、submit、save/export、upload/delete、modal、target movement、focus takeover 或 verifier failure 后强制 checkpoint。

### 3. Artifact validation 与 completion guard

- [x] 文件产物必须有 file refs、hash/metadata、format validator 和 saved-by-action index。
- [x] PPTX/DOCX/CSV/Markdown/report/image validators 输出 `artifactValidationRef`。
- [x] Completion guard 要求 current observation 或 artifact evidence、action causality、validator/verifier 支持、无 blocking uncertainty。
- [x] Verifier 必须检查内容、source refs、save action 和 current-run causality，不能只看文件存在。
- [x] Live completion guard 即使没有 task/producer CLI options，也会校验 current-run acceptance bundle。
- [x] Package diagnostic evidence 保持 `package-diagnostic` 分类，不能满足 product smoke。

### 4. Product path classification

- [x] TS package bridge 为 package diagnostic bundle 添加真实 `productPathClassification`。
- [x] 可新增 diagnostic-only current-run projector：只补单屏 display group/screen/window、单 actor cursor provenance、executor lease skeleton、diagnostic action causality、gui replay displayedRefs、evidence index refs；所有输出必须保留 `diagnosticOnly=true` / `packageDiagnosticOnly=true`。
- [x] 只有真实存在 Desktop/native hops、display group、actor cursor、user-control refs、native sidecar isolation、action ledger 和 replay bundle 时，才允许 product-smoke/native product path classification；package diagnostic、platform smoke 或缺 refs 均 fail closed。
- [x] 缺 refs 必须 fail closed；不能从 task id、scenario id、marker 或 package bundle shape 推断 `product-smoke` 或 native-backed product eligibility。
- [x] 不得伪造 multi-screen、multi-actor cursor、read-only cursor events、userControlPlane、BrowserHost DOM/AX observation、platform sidecar isolation、native replay bundle 或 `product-smoke` tier。

## 验证命令

- [x] `node --import tsx --test packages/actions/computer-use/evidence-contract.test.ts packages/actions/computer-use/product-path.test.ts packages/actions/computer-use/runtime-policy.test.ts` (35/35 pass)
- [x] `node --import tsx --test src/runtime/computer-use/package-bridge.test.ts src/runtime/computer-use/package-bridge-result.test.ts src/runtime/computer-use/package-bridge-policy.test.ts` (47/47 pass)
- [x] `node --import tsx --test tests/smoke/computer-use-chat-live-e2e.test.ts` (36/36 pass)
- [x] `npm run smoke:no-hardcoded-success --silent`
- [x] `npm run typecheck --silent`

## 必须用户协助

- [x] Evidence 和 validator 实现预计不需要用户协助。
