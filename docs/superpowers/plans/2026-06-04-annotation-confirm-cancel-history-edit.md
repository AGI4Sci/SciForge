# Annotation Confirm Cancel History Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make annotation confirm/cancel semantics identical for buttons and keyboard in full-screen and app-window annotation, allow empty comments to save, and let saved annotation comments be edited later without changing evidence refs.

**Architecture:** Keep desktop capture refs-first: overlay submit/cancel remains inside the trusted annotation preload and main IPC path. Add a narrow Feedback Inbox comment-edit path that updates only `comment` and `updatedAt` in workspace state, leaving screenshots, bounds, window bindings, display metadata, and provider evidence untouched.

**Tech Stack:** Electron desktop overlay, React UI, Node smoke tests with `tsx`, TypeScript.

---

### Task 1: Desktop Overlay Empty-Comment Confirm Semantics

**Files:**
- Modify: `src/desktop/annotation-overlay.ts`
- Test: `tests/smoke/smoke-desktop-annotation-overlay.test.ts`

- [x] **Step 1: Write failing tests for empty-comment submit and shared confirm path**

Add or update focused smoke tests so that after a valid selection:

```ts
assert.equal(document.save.disabled, false);
document.comment.value = '';
document.save.dispatchEvent({ type: 'click' });
assert.equal(events.at(-1)?.event, 'annotation-selection-submitted');
assert.equal(events.at(-1)?.comment, '');
```

Add the matching keyboard assertion:

```ts
document.comment.value = '';
document.dispatchWindowKeyboard({ key: 'Enter' });
assert.equal(events.at(-1)?.event, 'annotation-selection-submitted');
assert.equal(events.at(-1)?.comment, '');
```

- [x] **Step 2: Run the focused overlay test and verify RED**

Run:

```bash
node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts
```

Expected: the new empty-comment submit assertions fail because `save.disabled` stays true or `submitSelected()` returns before emitting submit.

- [x] **Step 3: Implement minimal overlay change**

In `desktopAnnotationOverlayRendererHtml()`:

```js
function updateSaveState() {
  save.disabled = !selectedBounds;
}

function submitSelected() {
  if (!selectedBounds) return;
  api?.submitSelection?.({
    bounds: selectedBounds,
    comment: comment.value,
    display: displayPayload(selectedDisplay),
  });
}
```

Keep `Enter` before selection as no-op and keep `Shift+Enter` inside the textarea as newline-only.

- [x] **Step 4: Run the focused overlay test and verify GREEN**

Run:

```bash
node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts
```

Expected: all overlay smoke tests pass, including empty comment submit, Esc cancel, Enter no-selection no-op, and Shift+Enter multiline.

### Task 2: App-Window Annotation Exit Semantics

**Files:**
- Modify: `tests/smoke/smoke-desktop-electron-main.test.ts`
- Modify only if RED exposes a gap: `src/desktop/main.ts`, `src/desktop/app-window-picker.ts`, `src/ui/src/app/SciForgeApp.tsx`

- [x] **Step 1: Write failing tests for app-window cancel and confirm mode exit**

Add smoke assertions that app-window picker cancel returns `status: "blocked"` or `status: "cancelled"` without leaving overlay windows active, and that app-window overlay submit with an empty comment reaches the same capture path as screen-region:

```ts
assert.equal(result.status, 'captured');
assert.equal(result.comment, '');
assert.deepEqual(annotationOverlay.getState().visible, false);
```

For the UI bridge, add a source assertion in `src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts` if needed:

```ts
assert.match(appSource, /finally\s*\{[\s\S]*setDesktopAnnotationModeActive\(false\)/);
```

- [x] **Step 2: Run the app-window/main focused tests and verify RED or existing GREEN**

Run:

```bash
node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts
```

Expected: app-window empty-comment submit fails until Task 1 is implemented, or the test passes because app-window reuses the same overlay renderer after target selection.

- [x] **Step 3: Implement only the missing exit behavior**

If RED shows stale annotation mode in the UI, keep the existing `finally` guard and route all `cancelled`, `blocked`, and `captured` results through `setDesktopAnnotationModeActive(false)`. If RED shows stale native windows, call `annotationOverlay.cancel()` on app-window picker cancel before returning the cancelled start result. Do not expose begin/update/submit IPC to the public preload.

- [x] **Step 4: Run the focused app-window/main tests and verify GREEN**

Run:

```bash
node --import tsx --test tests/smoke/smoke-desktop-electron-main.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts
```

Expected: app-window cancel and submit both leave annotation mode inactive and no overlay window visible.

### Task 3: Feedback Inbox Comment-Only History Edit

**Files:**
- Modify: `src/ui/src/feedback/feedbackWorkspace.ts`
- Test: `src/ui/src/feedback/feedbackWorkspace.test.ts`
- Modify: `src/ui/src/app/SciForgeAppFeedbackActions.ts`
- Modify: `src/ui/src/app/SciForgeApp.tsx`
- Modify: `src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx`
- Test: `src/ui/src/app/sciforgeApp/FeedbackInboxPage.test.ts`
- Modify if needed: `src/ui/src/styles/app-feedback.css`

- [x] **Step 1: Write failing pure-model test for preserving evidence**

In `feedbackWorkspace.test.ts`, add:

```ts
const next = updateFeedbackCommentText(state, 'feedback-1', '', '2026-06-04T12:00:00.000Z');
const edited = next.feedbackComments?.find((item) => item.id === 'feedback-1');
assert.equal(edited?.comment, '');
assert.equal(edited?.updatedAt, '2026-06-04T12:00:00.000Z');
assert.deepEqual(edited?.screenshot, original.screenshot);
assert.deepEqual(edited?.metadata, original.metadata);
assert.equal(edited?.evidenceBundleRef, original.evidenceBundleRef);
```

- [x] **Step 2: Run pure-model test and verify RED**

Run:

```bash
node --import tsx --test src/ui/src/feedback/feedbackWorkspace.test.ts
```

Expected: import or function-not-found failure for `updateFeedbackCommentText`.

- [x] **Step 3: Implement pure workspace update**

Add:

```ts
export function updateFeedbackCommentText(
  state: SciForgeWorkspaceState,
  id: string,
  comment: string,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!id) return state;
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((item) => item.id === id
      ? { ...item, comment, updatedAt }
      : item),
  };
}
```

- [x] **Step 4: Add action and UI edit control tests**

Add an action method in `SciForgeAppFeedbackActions.ts`:

```ts
function updateFeedbackCommentTextAction(id: string, comment: string) {
  updateWorkspace((current) => updateFeedbackCommentText(current, id, comment, nowIso()));
}
```

Expose it as `updateFeedbackCommentText`, pass it from `SciForgeApp.tsx` into `FeedbackInboxPage`, and add a prop:

```ts
onCommentEdit: (id: string, comment: string) => void;
```

In `FeedbackInboxPage.test.ts`, assert the source contains the edit affordance and prop:

```ts
assert.match(feedbackInboxSource, /onCommentEdit/);
assert.match(feedbackInboxSource, /aria-label=\{`编辑反馈 \$\{item\.id\}`\}/);
assert.match(feedbackInboxSource, /textarea[\s\S]*value=\{editingCommentDraft\}/);
```

- [x] **Step 5: Implement minimal edit UI**

In `FeedbackInboxPage`, keep local state:

```ts
const [editingCommentId, setEditingCommentId] = useState<string | undefined>();
const [editingCommentDraft, setEditingCommentDraft] = useState('');
```

Render either the existing comment text plus an Edit button, or a textarea with Save/Cancel buttons. Save calls `onCommentEdit(item.id, editingCommentDraft)` and exits edit mode. Cancel exits edit mode without calling `onCommentEdit`. Allow an empty textarea value.

- [x] **Step 6: Run model and inbox tests and verify GREEN**

Run:

```bash
node --import tsx --test src/ui/src/feedback/feedbackWorkspace.test.ts src/ui/src/app/sciforgeApp/FeedbackInboxPage.test.ts
```

Expected: tests pass and source assertions prove narrow editing is wired.

### Task 4: Final Verification And Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-annotation-overlay-keyboard-multiscreen-design.md`

- [x] **Step 1: Run required verification commands**

Run:

```bash
node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts src/shared/annotation-reference-contract.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts src/ui/src/feedback/feedbackWorkspace.test.ts src/ui/src/app/sciforgeApp/FeedbackInboxPage.test.ts
npm run typecheck -- --pretty false
git diff --check
```

Expected: all commands pass. If `npm` is missing from shell `PATH`, run the same command with `PATH=/opt/homebrew/bin:$PATH`.

- [x] **Step 2: Update completion record**

Append the final evidence refs, verification commands, and status to the spec. The completion record must state that empty comments are allowed, confirm/cancel buttons and shortcuts share semantics, and history editing is comment-only.
