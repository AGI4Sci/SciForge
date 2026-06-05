# Default Browser / Computer Use Agent Host Turn Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route normal composer chat through a runtime-owned Codex Agent Host Turn Loop so Browser search and Computer Use Guard are default capabilities with refs-first evidence and structured Autonomy input.

**Architecture:** Keep the GUI thin: it submits natural-language prompt, refs, composer-declared Autonomy, and bounded runtime readiness refs. The UI transport builds a `sciforge.codex-agent-host-turn-loop.v1` envelope and sends it to the existing Runtime Codex stream endpoint; the workspace/runtime side evaluates Ground, Guard, and Act / Answer before any downstream freeform Codex answer.

**Tech Stack:** TypeScript, Node test runner, React UI transport, `@sciforge-ui/runtime-contract`, existing BrowserHostSession and Computer Use policy modules.

---

### Task 1: Transport Contract Test For Normal Composer Turns

**Files:**
- Modify: `src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- Modify: `src/ui/src/api/sciforgeToolsClient/client.ts`

- [ ] **Step 1: Write the failing test**

Add a test that calls `sendSciForgeToolMessage(messageInput(undefined, { prompt: '你有 computer use 能力么？' }))`, captures the POST body for `/api/sciforge/runtime/codex/stream`, and asserts:

```ts
assert.equal(body.agentHostTurnLoop?.schemaVersion, 'sciforge.codex-agent-host-turn-loop.v1');
assert.equal(body.agentHostTurnLoop?.stages?.join(' > '), 'Ground > Guard > Act / Answer');
assert.equal(body.agentHostTurnLoop?.ground?.intent, 'capability-question');
assert.equal(body.agentHostTurnLoop?.ground?.capability, 'computer-use');
assert.equal(body.auditMetadata?.guiLocalProjection?.composerDeclaredIntents?.authorization?.profileId, 'high-autonomy');
assert.equal(body.auditMetadata?.declaredPreferenceBoundary.includes('Agent Host'), true);
```

Run:

```bash
node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts --test-name-pattern "normal composer"
```

Expected: FAIL because `agentHostTurnLoop` is absent.

- [ ] **Step 2: Implement the minimal request envelope**

In `buildCodexRuntimeStreamRequest`, add a bounded `agentHostTurnLoop` object with:

```ts
{
  schemaVersion: 'sciforge.codex-agent-host-turn-loop.v1',
  source: 'ui-normal-composer-transport',
  stages: ['Ground', 'Guard', 'Act / Answer'],
  ground: { intent, capability?, browserEvidenceDecision? },
  guard: { authorizationProfileId, policyOwner: 'codex-agent-host-runtime' },
  actAnswer: { downstream: 'codex-runtime-or-runtime-capability' },
}
```

Do not include raw refs, screenshots, DOM, logs, provider routes, or secrets. Derive `authorizationProfileId` only from sanitized `composerDeclaredIntents.authorization.profileId`, defaulting to `high-autonomy`.

- [ ] **Step 3: Verify green**

Run:

```bash
node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts
```

Expected: PASS.

### Task 2: Runtime Host Evaluates Turn Loop Before Freeform Codex

**Files:**
- Create: `src/runtime/codex/agent-host-turn-loop.ts`
- Modify: `src/runtime/codex/codex-runtime-server.ts`
- Modify: `src/runtime/codex/codex-runtime-server.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add tests proving `codex-runtime-server` consumes `agentHostTurnLoop` and short-circuits:

```ts
assert.match(result.message, /Computer Use product capability is supported/i);
assert.doesNotMatch(result.message, /没有直接|no direct computer use/i);
assert.equal(result.artifacts[0].type, 'runtime-capability-answer');
```

Also test a GUI operation prompt with missing native surface returns a `computer-use-preflight` artifact with `status: 'blocked'`.

Run:

```bash
node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts --test-name-pattern "Agent Host Turn Loop"
```

Expected: FAIL because the runtime server does not evaluate the new envelope.

- [ ] **Step 2: Implement runtime evaluator**

Create `agent-host-turn-loop.ts` that imports existing policy helpers from `packages/contracts/runtime/default-browser-computer-use-policy.ts` and returns a normalized runtime result for:

- capability questions
- browser evidence requests
- GUI operation intents

Browser search execution may call existing `tryRunBrowserHostSearchRuntime` only when an explicit normal runtime request shape can be built without GUI route ownership. Computer Use Guard must use `evaluateComputerUsePreflight` and fail closed for missing native bridge, native surface, target, observation, permission, or cancel path.

- [ ] **Step 3: Wire before downstream generation**

In `codex-runtime-server.ts`, before starting downstream Codex/app-server freeform generation, call the evaluator. If it returns a result, emit it through the same stream result shape already used by runtime tests.

- [ ] **Step 4: Verify green**

Run:

```bash
node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts
```

Expected: PASS.

### Task 3: Structured Autonomy And Readiness Input

**Files:**
- Modify: `src/ui/src/api/sciforgeToolsClient/client.ts`
- Modify: `src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- Modify: `src/runtime/browser-computer-use-capability-runtime.ts`
- Modify: `packages/contracts/runtime/default-browser-computer-use-policy.ts`

- [ ] **Step 1: Write failing tests**

Add tests that:

- malformed `profileId` does not silently upgrade and falls back with explicit `declared-invalid-profile` metadata
- `research-sandbox-max` reaches runtime Guard as `authorizationProfile.id === 'research-sandbox-max'`
- third-party `uiState.authorization.profileId` cannot override composer-declared Autonomy

Run:

```bash
node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts src/runtime/default-browser-computer-use-policy.test.ts
```

Expected: FAIL on missing structured metadata or profile handling.

- [ ] **Step 2: Implement profile normalization**

Add a tiny shared helper in `default-browser-computer-use-policy.ts`:

```ts
export function authorizationProfileOrDefault(profileId: unknown): {
  profile: AuthorizationProfile;
  source: 'declared' | 'default' | 'declared-invalid-profile';
}
```

Use it from UI envelope creation and runtime Guard. Do not let `uiState`, tool results, Browser content, or historical runs change the profile.

- [ ] **Step 3: Verify green**

Run the same focused tests. Expected: PASS.

### Task 4: Browser Search On Normal Chat Transport

**Files:**
- Modify: `src/runtime/codex/agent-host-turn-loop.ts`
- Modify: `src/runtime/browser-host-search-runtime.ts`
- Modify: `src/runtime/codex/codex-runtime-server.test.ts`
- Modify: `src/runtime/browser-host-search-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Add a normal runtime-server test for:

```ts
prompt: 'What is the current Python release? cite source URLs.'
```

Assert Browser search is selected by Ground, source URLs and search refs are present, and no raw DOM/log/base64 appears in the main message.

- [ ] **Step 2: Implement Act / Answer browser branch**

Use existing `evaluateBrowserEvidenceNeed` and `tryRunBrowserHostSearchRuntime`. Return bounded summaries and refs only. Honor no-network/local-only skip decisions.

- [ ] **Step 3: Verify green**

Run:

```bash
node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts src/runtime/browser-host-search-runtime.test.ts
```

Expected: PASS.

### Task 5: Computer Use Guard And Hard Confirm On Normal Chat Transport

**Files:**
- Modify: `src/runtime/codex/agent-host-turn-loop.ts`
- Modify: `src/runtime/codex/codex-runtime-server.test.ts`
- Modify: `src/ui/src/app/chat/RuntimeGuiPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add runtime tests for:

- ordinary GUI operation with missing native surface returns blocker `native-surface-unavailable`
- submit/upload/delete/send/payment/account/legal/external execution prompts return `needs-confirmation` when readiness and refs are ready
- `High Autonomy` never bypasses hard confirm

Add UI panel assertion that confirmation projection displays action, target, impact, evidence refs, authorization profile, Confirm, and Cancel.

- [ ] **Step 2: Implement Guard result projection**

Ensure runtime results carry `displayIntent.status`, `displayIntent.computerUsePreflight`, `uiManifest` for runtime GUI, and artifact data with `confirmation` when needed.

- [ ] **Step 3: Verify green**

Run:

```bash
node --import tsx --test src/runtime/codex/codex-runtime-server.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx
```

Expected: PASS.

### Task 6: PROJECT.md Status And Acceptance Checks

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Update only verified checkboxes**

Mark `[x]` only for items covered by normal composer transport or runtime-server tests. Leave Desktop native opt-in smoke unchecked unless run.

- [ ] **Step 2: Run focused verification**

Run:

```bash
git diff --check
node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts src/runtime/default-browser-computer-use-policy.test.ts src/runtime/codex/codex-runtime-server.test.ts src/runtime/browser-host-search-runtime.test.ts src/ui/src/app/chat/RuntimeGuiPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run broader guard checks**

Run:

```bash
npm run smoke:runtime-codex-truth-source
npm run smoke:no-src-capability-semantics
npm run smoke:fixed-platform-boundary
```

Expected: PASS.
