# Computer Use Router 与 TS Package 工作包

> **给并行 worker：** 必须按 `superpowers:subagent-driven-development` 或等价的逐任务执行方式推进。所有任务用 checkbox（`- [ ]` / `- [x]`）记录状态。

**目标：** 让 Computer Use 的模型调用和 package-local 执行全部 TS-first、Model Router-owned、provider-safe、refs-first。

**架构：** `packages/actions/computer-use` 拥有 CU contract、policy、evidence schema 和 TS local action loop。Runtime bridge 可以调用 package API，但不能新增第二条 provider path，也不能恢复 Python 默认路径。

**技术栈：** TypeScript、`tsx`、Node test runner、Model Router `/v1/responses`、`config.local.json` provider 配置。

---

## 写域

只修改：

- `packages/actions/computer-use/**`
- `packages/backend/src/local-provider-config*.ts`
- `packages/backend/src/response-compat*.ts`
- `src/runtime/computer-use/package-bridge*.ts`
- `src/runtime/computer-use/types.ts`
- `tools/check-no-legacy-paths.ts`
- 上述文件对应的 focused tests

不要修改：

- `src/desktop/**`
- `src/ui/**`
- `src/runtime/codex/**`，除非只是 package bridge 测试所需的类型导入
- `tools/computer-use-long-task-pool/**`，除非与 [`PROJECT_CU_05_ACCEPTANCE_RELEASE.md`](PROJECT_CU_05_ACCEPTANCE_RELEASE.md) 协调 release 命令

## 任务

### 1. 模型调用清单

- [x] 枚举所有 CU 模型参与点：local action planner、screenshot describe、crop inspect、OCR/vision observation summarize、candidate disambiguation、grounding translator、before/after compare、verifier explanation。
- [x] 新增或更新测试，确保 CU 模型调用不能直接读取 provider URL、API key、raw model slug 或未注册 provider/profile。
- [x] 所有 CU 模型调用统一走 Model Router `/v1/responses`，只使用公开 profile/role：`textReasoner` 用于文本规划，`translators.vision` 用于视觉转译。
- [x] Trace 只记录 profile、role、modality refs、尺寸/hash、latency、status 和 bounded error summary。
- [x] 视觉失败必须显式返回 observation unavailable、blocked 或 Host 选择的 text fallback；不能假装看过图。

Evidence: `node --import tsx --test packages/actions/computer-use/provider-policy.test.ts packages/actions/computer-use/runtime-policy.test.ts` (15/15 pass), `node --import tsx --test packages/workers/model-router/src/router.test.ts` (24/24 pass). Red/green regressions added for public `/v1/responses` errors not echoing raw private-looking model/profile values.

### 2. TS-only package 边界

- [x] Default package bridge 不再为 `plan/locate/execute/verify/writeTrace/emitEvent` spawn Python。
- [x] Embedded isolated-L3 completion evidence producer 已用 TypeScript 实现。
- [x] 移除或隔离 `packages/actions/computer-use` 下剩余 package-local Python 默认 hook；如保留 legacy 文档，必须标成 diagnostic-only。
- [x] 确保 package action loop request/response schema 由 TypeScript 拥有，不依赖 `tools/computer-use-next/**`。
- [x] 为移除或隔离的 legacy path 增加 no-legacy-path 覆盖。

Evidence: `node --import tsx --test packages/actions/computer-use/runtime-policy.test.ts packages/actions/computer-use/product-path.test.ts packages/actions/computer-use/evidence-contract.test.ts` (35/35 pass), `node --import tsx --test packages/actions/computer-use/action-schema.test.ts tools/check-no-legacy-paths.test.ts` (6/6 pass), `npm run smoke:no-legacy-paths --silent` (pass).

### 3. Provider alias 与配置卫生

- [x] 公开 `sciforge-router` 和 `sciforge-router-*` alias 在 provider 调用前映射到配置的 upstream default model。
- [x] 增加 `runtimeCodexProxy`、`textLLM.env`、bare upstream base URL normalization、provider slug scrub 的回归测试。
- [x] 缺 provider config 时必须 fail closed，不能静默 fallback 到 raw env default。
- [x] Trace 和错误不能暴露 provider secret、token 或 raw private endpoint。

Evidence: `node --import tsx --test packages/backend/src/local-provider-config.test.ts packages/backend/src/response-compat.test.ts` (33/33 pass), `node --import tsx --test packages/workers/model-router/src/router.test.ts` (24/24 pass), `node --import tsx --test packages/actions/computer-use/provider-policy.test.ts packages/actions/computer-use/runtime-policy.test.ts` (15/15 pass).

### 4. Package diagnostic 分类

- [x] Package bridge acceptance 会把 package-only L3 bundle 分类为 `package-diagnostic`。
- [x] 扩展测试，证明 diagnostic evidence 不能满足 `product-smoke`。
- [x] 如果 `packages/actions/computer-use/README.md` wording 过期，更新 diagnostic/product split 说明。（audit: README already states package diagnostic cannot satisfy product-smoke and Python/legacy paths are diagnostic/historical only）

Evidence: `node --import tsx --test packages/actions/computer-use/runtime-policy.test.ts packages/actions/computer-use/product-path.test.ts packages/actions/computer-use/evidence-contract.test.ts` (35/35 pass, includes `package diagnostic classification cannot satisfy product-smoke live acceptance`).

## 验证命令

- [x] `node --import tsx --test packages/backend/src/local-provider-config.test.ts packages/backend/src/response-compat.test.ts`
- [x] `node --import tsx --test packages/actions/computer-use/runtime-policy.test.ts packages/actions/computer-use/product-path.test.ts packages/actions/computer-use/evidence-contract.test.ts`
- [x] `node --import tsx --test src/runtime/computer-use/package-bridge.test.ts src/runtime/computer-use/package-bridge-request.test.ts src/runtime/computer-use/package-bridge-process.test.ts src/runtime/computer-use/package-bridge-result.test.ts src/runtime/computer-use/package-bridge-policy.test.ts src/runtime/computer-use/package-bridge-verify-port.test.ts` (60/60 pass)
- [x] `npm run smoke:no-legacy-paths --silent`
- [x] `npm run smoke:no-hardcoded-success --silent`
- [x] `npm run typecheck --silent`

## 必须用户协助

- [x] 预计不需要用户协助。provider 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
