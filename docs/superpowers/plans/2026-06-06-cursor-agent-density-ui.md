# Cursor Agent Density UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep SciForge functionality unchanged while making the workbench layout and control density feel closer to Cursor Agents.

**Architecture:** Treat this as a UI-only density pass. Prefer CSS/token-level edits for the shell, chat stream, composer, sidebar, and results dock; only touch TSX if an existing class hook is missing. Preserve current routes, adapters, runtime state, tabs, actions, and message rendering contracts.

**Tech Stack:** React 19, Vite, TypeScript, Node test runner, CSS modules-by-convention through `src/ui/src/styles/*.css`.

---

### Task 1: Add A UI Density Guard

**Files:**
- Create: `src/ui/src/app/cursorDensityStyle.test.ts`
- Modify: `src/ui/src/styles/app-06.css`

- [ ] **Step 1: Write the failing test**

Create `src/ui/src/app/cursorDensityStyle.test.ts` with assertions that the compact workbench layer exists and covers the shell, sidebar, chat, composer, and results dock selectors.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --import tsx --test src/ui/src/app/cursorDensityStyle.test.ts`
Expected: FAIL because the Cursor-density selectors are not present yet.

- [ ] **Step 3: Add the compact density CSS layer**

Append a named CSS section to `src/ui/src/styles/app-06.css`. Keep all rules visual-only and scoped to existing app classes.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --import tsx --test src/ui/src/app/cursorDensityStyle.test.ts`
Expected: PASS.

### Task 2: Tighten Shell, Sidebar, Chat, Composer, And Results Dock

**Files:**
- Modify: `src/ui/src/styles/app-06.css`
- Modify only if required: `src/ui/src/app/SciForgeApp.tsx`, `src/ui/src/app/ChatPanel.tsx`, `src/ui/src/app/results/ResultShell.tsx`

- [ ] **Step 1: Inspect existing class hooks**

Confirm the current DOM exposes stable class hooks for `.app-shell`, `.sidebar`, `.topbar`, `.workbench-canvas`, `.chat-panel`, `.results-panel`, `.message`, `.composer`, `.result-shell`, and tab/action controls.

- [ ] **Step 2: Apply visual-only density rules**

Reduce card-like shell decoration, tighten panel headers and sidebars, make assistant content read like a document stream, keep user messages as compact right-side bubbles, and make result tabs/action buttons fit a fixed dock pattern.

- [ ] **Step 3: Run focused functional tests**

Run:
`node --import tsx --test src/ui/src/app/chat/ChatComposer.test.tsx src/ui/src/app/results/ResultShell.test.tsx`
Expected: PASS, proving composer/results structure stayed intact.

### Task 3: Browser Visual Verification

**Files:**
- No required source edits.

- [ ] **Step 1: Reload `http://localhost:5173/`**

Use the in-app browser on the existing dev server.

- [ ] **Step 2: Capture desktop and app screenshots**

Compare the revised SciForge viewport against `/tmp/cursor-agent-window-crop.png` for layout density, panel hierarchy, and right dock behavior.

- [ ] **Step 3: Run build or typecheck smoke**

Run `npm run build` if time permits; otherwise run `npm run typecheck` and report the narrower verification.
