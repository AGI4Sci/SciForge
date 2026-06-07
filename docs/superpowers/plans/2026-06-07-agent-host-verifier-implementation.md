# Agent Host Verification Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Host the only source of user-visible completion truth, with scenario-selected verification, bounded repair status, and UI fail-closed behavior.

**Architecture:** Agent Host generates `AcceptanceSpec`, evaluates browser answer evidence into `AcceptanceEvaluation`, then emits `completionTruth` for the final UI projection. Browser Host marks low-information source pages as discovery-only evidence, and UI only renders `verified` when Agent Host provides satisfied completion truth. Old display-intent-derived verified paths are removed or made fail-closed.

**Tech Stack:** TypeScript, Node test runner, SciForge Browser bounded operation contract, SciForge runtime event normalization.

---

## File Structure

- Modify `/Applications/workspace/ailab/research/app/SciForge/src/runtime/codex/agent-host-turn-loop.ts`: add browser `AcceptanceEvaluation`, browser `completionTruth`, relative-window temporal intent, and fail-closed answer selection.
- Modify `/Applications/workspace/ailab/research/app/SciForge/src/runtime/codex/agent-host-turn-loop.test.ts`: add failing tests for homepage/login-only browser evidence, relative one-week acceptance, and satisfied browser completion truth.
- Modify `/Applications/workspace/ailab/research/app/SciForge/src/runtime/browser-host-session.ts`: classify source-constrained root/login/navigation pages as low information and mark them discovery-only when persisted.
- Modify `/Applications/workspace/ailab/research/app/SciForge/src/runtime/browser-host-session.test.ts`: add tests for source-constrained arXiv root/login discovery and non-completion source pages.
- Modify `/Applications/workspace/ailab/research/app/SciForge/src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts`: derive gui.present verification state from Agent Host `completionTruth`, not from `displayIntent.taskOutcome`.
- Modify `/Applications/workspace/ailab/research/app/SciForge/src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts`: add tests that taskOutcome/evidence refs alone cannot produce `verified`, and satisfied completion truth can.

### Task 1: Agent Host Browser Acceptance Evaluation

**Files:**
- Modify: `/Applications/workspace/ailab/research/app/SciForge/src/runtime/codex/agent-host-turn-loop.ts`
- Test: `/Applications/workspace/ailab/research/app/SciForge/src/runtime/codex/agent-host-turn-loop.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that:

```ts
test('Agent Host Turn Loop blocks browser answers when only low-information source pages are read', async () => {
  // Browser bounded operation returns completed with arXiv home/login pages.
  // Pages either have discoveryOnly true or finalUrl paths `/` and `/login`.
  // Expect result.displayIntent.status === 'blocked'.
  // Expect result.completionTruth.status === 'blocked'.
  // Expect message to mention low-information source pages and not summarize "Skip to main content".
});

test('Agent Host Turn Loop records relative-window temporal constraints for recent browser research', async () => {
  // Command text includes "最近一周".
  // Expect acceptanceSpec.constraints.temporal.kind === 'relative-window'.
  // Expect startDate and endDate to bracket the current local date.
});

test('Agent Host Turn Loop emits satisfied browser completionTruth for task-relevant source pages', async () => {
  // Browser bounded operation returns a concrete source page with sourcePageRef/textRef and task-relevant summary.
  // Expect result.completionTruth.status === 'satisfied'.
  // Expect completionTruth.validator === 'agent-host-browser-acceptance'.
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test src/runtime/codex/agent-host-turn-loop.test.ts
```

Expected: the new tests fail because browser acceptance evaluation, browser completion truth, and relative-window temporal constraints are not implemented.

- [ ] **Step 3: Implement minimal Agent Host acceptance evaluation**

Add browser-specific types:

```ts
type AgentHostCompletionTruthStatus = 'satisfied' | 'partial' | 'blocked' | 'completed';
type AgentHostAcceptanceEvaluationStatus = 'satisfied' | 'repairable' | 'partial' | 'blocked' | 'not_required';
```

Implement `browserOperationAcceptanceEvaluation(...)` to check:

- required source/page refs passed.
- at least one completion source summary exists.
- no completion summary is only homepage/login/navigation text.
- exact-date or relative-window temporal constraints are satisfied when structured dated items are available.

Emit browser `completionTruth` through `structuredResult(...)`:

```ts
completionTruth: {
  schemaVersion: 'sciforge.agent-host.completion-truth.v1',
  scope: 'user-task',
  status: 'satisfied' | 'partial' | 'blocked',
  evidenceRefs,
  validator: 'agent-host-browser-acceptance',
  reason,
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test src/runtime/codex/agent-host-turn-loop.test.ts
```

Expected: Agent Host tests pass.

### Task 2: Browser Host Low-Information Source Pages

**Files:**
- Modify: `/Applications/workspace/ailab/research/app/SciForge/src/runtime/browser-host-session.ts`
- Test: `/Applications/workspace/ailab/research/app/SciForge/src/runtime/browser-host-session.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that:

```ts
test('BrowserHostSession source constrained search treats arXiv root and login as low-information', async () => {
  // Query uses site:arxiv.org with results for https://arxiv.org/ and https://arxiv.org/login.
  // Expect source-site discovery to trigger or pages to be discoveryOnly.
  // Expect non-discovery read source page count to be 0 if no concrete paper/search page is discovered.
});

test('BrowserHostSession marks login and homepage source pages discoveryOnly for source-constrained research', async () => {
  // Persisted source pages for arXiv root/login should include discoveryOnly true.
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test src/runtime/browser-host-session.test.ts
```

Expected: new tests fail because `/login` and similar navigation pages are not treated as low-information completion-ineligible pages.

- [ ] **Step 3: Implement low-information classification**

Update `sourceConstrainedResultIsLowInformation(...)` and `sourcePageLooksLikeDiscoveryList(...)` so source-constrained root, login, account, help, about, contact, privacy, terms, and navigation-like pages are low-information. Persist such pages with `discoveryOnly: true` when they do not contain task-specific result content.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test src/runtime/browser-host-session.test.ts
```

Expected: Browser Host tests pass.

### Task 3: UI CompletionTruth Fail-Closed Projection

**Files:**
- Modify: `/Applications/workspace/ailab/research/app/SciForge/src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts`
- Test: `/Applications/workspace/ailab/research/app/SciForge/src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that:

```ts
test('SSE reader does not mark gui.present verified from taskOutcome and evidence refs alone', async () => {
  // done payload has displayIntent protocol-success/taskOutcome satisfied/status completed and evidence refs.
  // No completionTruth is present.
  // Expect verificationState.status === 'unverified'.
});

test('SSE reader marks gui.present verified only from satisfied Agent Host completionTruth', async () => {
  // done payload includes completionTruth status satisfied, scope user-task, validator agent-host-browser-acceptance, evidence refs.
  // Expect verificationState.status === 'verified' and verifierRef equals completionTruth.validator or gui.present source with completionTruth attached.
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts
```

Expected: first test fails because current UI infers verified from displayIntent/taskOutcome/evidence refs.

- [ ] **Step 3: Implement fail-closed projection**

Replace `guiPresentVerificationState(...)` logic with completion-truth-driven logic:

- `completionTruth.status === 'satisfied'` and scope `user-task` or `workflow` -> `verified`.
- `completionTruth.status === 'blocked'` -> `failed`.
- `completionTruth.status === 'partial'` -> `uncertain` or `partial`.
- missing completion truth -> `unverified`.

Do not use `displayIntent.taskOutcome` as proof of verified completion.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts
```

Expected: runtime event tests pass.

### Task 4: Regression And Chain Unification

**Files:**
- Modify tests only if failures reveal contract mismatches.

- [ ] **Step 1: Run cross-chain regression tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 packages/contracts/runtime/default-browser-computer-use-policy.test.ts src/runtime/browser-host-session-search.test.ts src/runtime/browser-host-session.test.ts src/runtime/browser-host-session-source-pages.test.ts src/runtime/codex/backend-event-normalization.test.ts src/runtime/codex/codex-runtime-server.test.ts src/runtime/codex/agent-host-turn-loop.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts
```

Expected: all tests pass, with UI `verified` only coming from Agent Host completion truth or existing validated Computer Use completion truth.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check -- src/runtime/codex/agent-host-turn-loop.ts src/runtime/codex/agent-host-turn-loop.test.ts src/runtime/browser-host-session.ts src/runtime/browser-host-session.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts
```

Expected: no output.

- [ ] **Step 3: Review anti-regression invariant**

Verify:

- No UI path derives `verified` from `displayIntent.taskOutcome` alone.
- Browser homepage/login-only pages cannot become completion evidence.
- Agent Host browser answers include `acceptanceSpec`, `acceptanceEvaluation`, and `completionTruth`.
- `not_required` or missing completion truth never renders as `verified`.
