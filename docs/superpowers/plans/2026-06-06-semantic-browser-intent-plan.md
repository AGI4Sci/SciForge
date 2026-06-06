# Semantic Browser Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brittle browser/search routing with semantic-signal-first intent classification and make valid BrowserHostSession results render as completed UI answers.

**Architecture:** Intent routing should derive a structured decision from semantic signals such as external freshness, citation need, browser operation, URL target, and explicit no-network constraints. Keyword and regex checks may remain as bounded feature detectors, but the final decision must be made from structured signals and tested across natural-language variants.

**Tech Stack:** TypeScript, Node test runner, SciForge runtime contracts, Runtime Codex SSE/WebSocket transport, BrowserHostSession.

**Final status (2026-06-06):** Implemented for BrowserHostSession browser evidence routing, BrowserHostSession UI completion, Runtime Codex SSE/WebSocket terminal-event semantics, Computer Use risk/profile classification, and semantic browser search query extraction. Live UI-equivalent verification for `查一下伊朗局势` now completes with focused query `伊朗局势` and no DSML/tool_calls leak.

---

### Task 1: Browser Evidence Semantic Decision Contract

**Files:**
- Modify: `packages/contracts/runtime/default-browser-computer-use-policy.ts`
- Modify: `src/runtime/default-browser-computer-use-policy.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving natural requests like `查一下伊朗局势`, `现在 Python 最新版本是什么，给来源`, and `帮我确认这个新闻` route to browser evidence, while `不要联网，只看本地 README` skips.

- [x] **Step 2: Run focused tests and confirm failures**

Run: `node --import tsx --test src/runtime/default-browser-computer-use-policy.test.ts`

- [x] **Step 3: Implement semantic-signal-first classification**

Introduce a small internal signal collector whose final decision is based on structured signals, not a single keyword regex. Add a code comment near the decision boundary: keyword patterns are feature detectors only and must not become the final policy.

- [x] **Step 4: Verify focused tests pass**

Run: `node --import tsx --test src/runtime/default-browser-computer-use-policy.test.ts`

### Task 2: Runtime Codex Browser Result UI Completion

**Files:**
- Modify: `src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts`
- Modify: `src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`

- [x] **Step 1: Write failing tests**

Add a Runtime Codex SSE test where `agent_host_turn_loop` selects `browser-host-search-runtime` and the terminal `done` payload contains BrowserHostSession search results but no `gui.present`. Expected result: completed answer with BrowserHostSession message, not `Runtime Codex 运行未完成`.

- [x] **Step 2: Run focused test and confirm failure**

Run: `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`

- [x] **Step 3: Implement semantic runtime completion projection**

Treat Agent Host browser/search runtime `done` payloads as refs-first visible results when they carry structured runtime evidence such as BrowserHostSession refs, selected runtime, execution units, or browser-search artifacts.

- [x] **Step 4: Verify focused test passes**

Run: `node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`

### Task 3: Guardrails Against Keyword-Only Regression

**Files:**
- Modify: `packages/contracts/runtime/default-browser-computer-use-policy.ts`
- Modify: `packages/contracts/runtime/events.ts` if completion classification needs comments
- Modify focused tests found by sub-agent review.

- [x] **Step 1: Add principle comments at decision boundaries**

Comments must state that regex/keywords are allowed only as evidence features; final routing/completion decisions must use structured semantic signals.

- [x] **Step 2: Add regression tests for keyword-absence and keyword-collision cases**

Use cases: browser evidence without literal “搜索”; local-only requests containing “最新” but explicitly forbidding network; successful BrowserHostSession result containing ordinary failure words in snippets should remain completed.

### Task 4: Verification

**Files:**
- No new production files unless required by implementation.

- [x] **Step 1: Run focused tests**

Run:
`node --import tsx --test src/runtime/default-browser-computer-use-policy.test.ts src/runtime/codex/codex-runtime-server.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts src/runtime/browser-host-session-search.test.ts`

- [x] **Step 2: Run live UI-equivalent WebSocket/SSE verification**

Send a Runtime Codex request for `通过内置浏览器搜索伊朗局势` through the same path the UI uses and confirm `agent_host_turn_loop`, `browser-host-search-runtime`, and a completed visible answer.

---

## Parallel Audit Findings

Three read-only sub-agents inspected related code paths. Their findings extend the same principle beyond the immediate browser-search bug:

- Runtime/browser policy: `default-browser-computer-use-policy.ts`, `agent-host-turn-loop.ts`, `browser-host-search-runtime.ts`, and Computer Use materializers had keyword-led routing/risk/completion boundaries. This implementation converts the browser evidence decision and Computer Use risk profile handling to structured signal reducers, with comments forbidding keyword-only final decisions.
- UI transport/completion: `runtimeEvents.ts`, `codexRealtimeSession.ts`, and `client.ts` can misclassify literal `error`/`failed` event labels or missing `gui.present` as terminal failure. This implementation makes BrowserHostSession Agent Host results complete without `gui.present`, and treats diagnostic `error`/`failed` events as nonterminal unless the payload structurally declares terminal failure.
- Broader migration candidates: model-router modality routing, vision-sense Computer Use policy, markdown artifact mutation fast path, direct-context fallback, scenario routing, and gateway outcome projection still have lexical fallback risks. Migrate each to a shared `SemanticRoutingSignals` style object before using them for routing, write, safety, or completion decisions. Existing keyword rules may remain only as low-confidence feature extractors or UI/audit grouping.
