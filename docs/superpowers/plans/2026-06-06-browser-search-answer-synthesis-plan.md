# Clarification And Search Evidence Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unclear requests ask for clarification across runtime routes, and stop BrowserHostSession snippet-only search from presenting candidate snippets as fully understood final answers.

**Architecture:** Add a small request-clarification runtime before browser/search execution so ambiguity can short-circuit any scenario as `needs-human`. Keep the existing BrowserHostSession search runtime, but its primary message becomes an honest candidate-source handoff whenever only search-result snippets are available; the runtime marks the task as needing human input or additional source reading instead of `satisfied`.

**Tech Stack:** TypeScript, Node test runner, Gateway pipeline, BrowserHostSession runtime, Runtime Codex SSE client tests.

---

## Second-Phase File Map

- Create: `src/runtime/request-clarification-runtime.ts`
  - Owns generic ambiguity detection and `ToolPayload` creation for visible clarification questions.
- Create: `src/runtime/request-clarification-runtime.test.ts`
  - Covers ambiguous platform/trending requests and non-search pronoun-only tasks without current references.
- Modify: `src/runtime/generation-gateway.ts`
  - Adds a `request-clarification-runtime` stage after request enrichment and before browser/computer-use work.
- Modify: `src/runtime/browser-host-search-answer.ts`
  - Renames the result semantics from supported answer synthesis to candidate-source reporting unless source-page content exists.
- Modify: `src/runtime/browser-host-search-runtime.ts`
  - Maps `candidate-only` search evidence to `displayIntent.taskOutcome = needs-human`, execution unit `needs-human`, and confidence below answer-complete levels.
- Modify: tests in `src/runtime/browser-host-search-answer.test.ts`, `src/runtime/browser-host-search-runtime.test.ts`, and `src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`.

## Second-Phase Tasks

### Task A: Clarification Runtime

- [ ] Add failing tests for ambiguous requests:

```ts
assert.equal(tryRunRequestClarificationRuntime(request('搜索今天huggingface上最火的工作'))?.displayIntent?.status, 'needs-human');
assert.match(payload.message, /Hugging Face|范围|papers|models|datasets|Spaces|jobs/i);
assert.equal(tryRunRequestClarificationRuntime(request('帮我处理一下这个'))?.displayIntent?.status, 'needs-human');
```

- [ ] Implement `tryRunRequestClarificationRuntime(request)` with conservative detectors:
  - ranked/trending/latest request on a platform plus a generic object word such as `工作`, `work`, `thing`, `内容`, `项目`
  - pronoun-only operation such as `处理这个`, `fix this`, `summarize this` when no current references/artifacts exist
- [ ] Add the runtime stage before BrowserHostSession search.

### Task B: Search Evidence Integrity

- [ ] Update search-answer tests so snippet-only results produce `evidenceState: 'candidate-only'` and message text that says sources have not been opened/read.
- [ ] Update browser-search runtime tests so candidate-only output is `needs-human`, not `satisfied`.
- [ ] Keep refs, search-result artifacts, projection artifacts, and raw diagnostic summary intact for follow-up source reading.

### Task C: Verification

- [ ] Run focused tests:

```bash
node --import tsx --test src/runtime/request-clarification-runtime.test.ts src/runtime/browser-host-search-answer.test.ts src/runtime/browser-host-search-runtime.test.ts src/runtime/default-browser-computer-use-policy.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts
```

- [ ] Run typecheck:

```bash
npx tsc -p tsconfig.desktop.build.json --noEmit
```

## File Map

- Create: `src/runtime/browser-host-search-answer.ts`
  - Owns generic deterministic synthesis from structured search results.
  - Exports `browserHostSearchAnswerFromOutput`.
- Create: `src/runtime/browser-host-search-answer.test.ts`
  - Unit tests for language, empty results, thin evidence, and generic non-topic-specific behavior.
- Modify: `src/runtime/browser-host-search-runtime.ts`
  - Uses the synthesizer for `payload.message`.
  - Stores raw `browserHostSearchSummary` in search artifact data and diagnostic artifact.
- Modify: `src/runtime/browser-host-search-runtime.test.ts`
  - Updates runtime payload expectations from raw summary to synthesized answer.
  - Preserves refs-first artifact/projection assertions.
- Modify: `src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`
  - Updates existing BrowserHostSession completion fixture so primary chat content is synthesized and not a raw BrowserHostSession summary.

## Task 1: Add Search Answer Synthesizer Tests

**Files:**
- Create: `src/runtime/browser-host-search-answer.test.ts`
- Create in Task 2: `src/runtime/browser-host-search-answer.ts`

- [ ] **Step 1: Write the failing test file**

Add tests with this shape:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { browserHostSearchAnswerFromOutput } from './browser-host-search-answer.js';
import { BROWSER_HOST_SEARCH_SCHEMA, BROWSER_HOST_SESSION_PROVIDER_ID, BROWSER_HOST_SESSION_SCHEMA } from './browser-host-session.js';
import type { BrowserHostSearchOutput } from './browser-host-session.js';

test('synthesizes Chinese browser search results into a user-facing answer with sources', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: '通过内置浏览器搜索伊朗局势',
    output: searchOutput({
      query: '伊朗局势',
      results: [
        { title: '伊朗局势最新消息', url: 'https://news.example.cn/iran', snippet: '多方消息称地区紧张仍在持续，外交斡旋同步推进。' },
        { title: '国际社会关注中东局势', url: 'https://world.example.org/middle-east', snippet: '能源市场和周边安全形势受到影响。' },
      ],
    }),
  });

  assert.match(answer.message, /基于内置浏览器搜索结果/);
  assert.match(answer.message, /地区紧张仍在持续/);
  assert.match(answer.message, /外交斡旋/);
  assert.match(answer.message, /https:\/\/news\.example\.cn\/iran/);
  assert.doesNotMatch(answer.message, /^BrowserHostSession search:/);
  assert.deepEqual(answer.sourceUrls, ['https://news.example.cn/iran', 'https://world.example.org/middle-east']);
  assert.equal(answer.language, 'zh');
});

test('synthesizes English latest-version searches without topic-specific branching', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: 'Find the latest Python release and cite source URLs.',
    output: searchOutput({
      query: 'latest Python release',
      results: [
        { title: 'Python 3.14.0 release notes', url: 'https://www.python.org/downloads/release/python-3140/', snippet: 'Python 3.14.0 is the newest feature release.' },
        { title: 'Python downloads', url: 'https://www.python.org/downloads/', snippet: 'Download the latest version of Python.' },
      ],
    }),
  });

  assert.match(answer.message, /Based on the built-in browser search results/);
  assert.match(answer.message, /Python 3\.14\.0/);
  assert.match(answer.message, /https:\/\/www\.python\.org\/downloads\/release\/python-3140\//);
  assert.doesNotMatch(answer.message, /^BrowserHostSession search:/);
});

test('returns a readable limited-evidence answer when results are empty', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: 'Search for a very obscure query and cite sources.',
    output: searchOutput({ query: 'very obscure query', results: [] }),
  });

  assert.match(answer.message, /did not find bounded search results/i);
  assert.deepEqual(answer.sourceUrls, []);
  assert.equal(answer.evidenceState, 'empty');
});

function searchOutput(input: Partial<BrowserHostSearchOutput>): BrowserHostSearchOutput {
  return {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: input.query ?? 'query',
    engine: input.engine ?? 'bing',
    searchedAt: '2026-06-06T00:00:00.000Z',
    searchUrl: 'https://www.bing.com/search?q=query',
    finalUrl: 'https://www.bing.com/search?q=query',
    results: input.results ?? [],
    session: {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: 'search-session',
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'ready',
      workspacePath: '/tmp/workspace',
      requestedUrl: 'https://www.bing.com/search?q=query',
      url: 'https://www.bing.com/search?q=query',
      startedAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:01.000Z',
      viewport: { width: 1365, height: 900 },
      canGoBack: false,
      canGoForward: false,
      diagnostics: [],
    },
    searchResultRef: 'browser-host-session:search-session/search-results.json',
    ...input,
  };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/runtime/browser-host-search-answer.test.ts`

Expected: FAIL because `src/runtime/browser-host-search-answer.ts` does not exist.

## Task 2: Implement Generic Deterministic Synthesis

**Files:**
- Create: `src/runtime/browser-host-search-answer.ts`

- [ ] **Step 1: Write minimal implementation**

Create `browserHostSearchAnswerFromOutput` with this public shape:

```ts
import type { BrowserHostSearchOutput, BrowserHostSearchResult } from './browser-host-session-types.js';

export interface BrowserHostSearchAnswer {
  message: string;
  language: 'zh' | 'en';
  evidenceState: 'supported' | 'thin' | 'empty';
  sourceUrls: string[];
}

export function browserHostSearchAnswerFromOutput(input: {
  prompt: string;
  output: BrowserHostSearchOutput;
  maxResults?: number;
}): BrowserHostSearchAnswer {
  // Implementation is generic: no topic-specific branches.
}
```

Implementation rules:

- `language` is `zh` when the prompt or query contains CJK characters; otherwise `en`.
- Use up to 5 results with non-empty title or snippet.
- For each result, include title, useful snippet text, and URL.
- `evidenceState` is `empty` for zero usable results, `thin` when all snippets are empty or very short, otherwise `supported`.
- Chinese answer starts with `基于内置浏览器搜索结果，...`.
- English answer starts with `Based on the built-in browser search results, ...`.
- Empty-result answers must be user-facing and must not mention raw runtime internals.

- [ ] **Step 2: Run synthesizer tests**

Run: `node --import tsx --test src/runtime/browser-host-search-answer.test.ts`

Expected: PASS.

## Task 3: Integrate Synthesized Answers Into Browser Search Runtime

**Files:**
- Modify: `src/runtime/browser-host-search-runtime.ts`
- Modify: `src/runtime/browser-host-search-runtime.test.ts`

- [ ] **Step 1: Write failing runtime assertions**

In `browser-host-search-runtime.test.ts`, change the first payload assertions:

```ts
assert.match(payload.message, /Based on the built-in browser search results/);
assert.match(payload.message, /Host browser sessions/);
assert.match(payload.message, /https:\/\/example\.org\/browser-host/);
assert.doesNotMatch(payload.message, /^BrowserHostSession search:/);
```

Also assert the raw search summary is preserved in the search artifact:

```ts
assert.match(String(searchData?.browserHostSearchSummary), /BrowserHostSession search: host owned browser/);
```

- [ ] **Step 2: Run focused runtime test and verify failure**

Run: `node --import tsx --test src/runtime/browser-host-search-runtime.test.ts`

Expected: FAIL because runtime still uses `browserHostSearchSummary` as `payload.message`.

- [ ] **Step 3: Implement runtime integration**

In `src/runtime/browser-host-search-runtime.ts`:

- Import `browserHostSearchAnswerFromOutput`.
- Build `const summary = browserHostSearchSummary(...)`.
- Build `const answer = browserHostSearchAnswerFromOutput({ prompt: request.prompt, output });`.
- Return `message: answer.message`.
- Add `browserHostSearchSummary: summary` and `answerEvidenceState: answer.evidenceState` to the `browser-search-results` artifact data.
- Add a diagnostic artifact with the raw summary so process/results panes can inspect it.
- Keep BrowserHostSession projection, refs, execution units, claims, and object references.

- [ ] **Step 4: Run focused runtime tests**

Run: `node --import tsx --test src/runtime/browser-host-search-answer.test.ts src/runtime/browser-host-search-runtime.test.ts`

Expected: PASS.

## Task 4: Update Runtime Codex UI Completion Fixture

**Files:**
- Modify: `src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`

- [ ] **Step 1: Update existing BrowserHostSession fixture assertions**

In `Runtime Codex BrowserHostSession Agent Host result completes without gui.present`, change `message` to a synthesized Chinese answer, for example:

```ts
const message = [
  '基于内置浏览器搜索结果，伊朗局势的核心信息是：地区紧张仍在持续，相关报道同时提到外交斡旋、能源市场和周边安全影响。',
  '',
  '- 伊朗局势专题报道显示，相关事件仍在更新中。来源：https://news.sina.cn/zt_d/subject-1767894979',
  '- 另一条报道提到美伊互袭波及多国。来源：https://news.cctv.com/2026/06/03/example.shtml',
  '',
  '这些结论基于当前搜索结果摘要，具体事件仍需打开来源继续核验。'
].join('\n');
```

Then assert:

```ts
assert.match(response.message.content, /基于内置浏览器搜索结果/);
assert.match(response.message.content, /地区紧张仍在持续/);
assert.doesNotMatch(response.message.content, /^BrowserHostSession search:/);
assert.doesNotMatch(response.message.content, /Runtime Codex 运行未完成|gui\.present/i);
```

- [ ] **Step 2: Run UI client test and verify it passes**

Run: `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`

Expected: PASS.

## Task 5: Final Verification

**Files:**
- No new production files beyond the files above.

- [ ] **Step 1: Run focused verification**

Run:

```bash
node --import tsx --test \
  src/runtime/browser-host-search-answer.test.ts \
  src/runtime/browser-host-search-runtime.test.ts \
  src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck for touched TypeScript surfaces**

Run: `npx tsc -p tsconfig.desktop.build.json --noEmit`

Expected: PASS or report pre-existing unrelated failures with exact output.

- [ ] **Step 3: Inspect path-limited diff**

Run:

```bash
git diff -- \
  src/runtime/browser-host-search-answer.ts \
  src/runtime/browser-host-search-answer.test.ts \
  src/runtime/browser-host-search-runtime.ts \
  src/runtime/browser-host-search-runtime.test.ts \
  src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts
```

Expected: Diff only contains generic synthesis behavior and test updates. No topic-specific production branches.
