# Codex / Subagent Message Presentation Notes

Last updated: 2026-05-21

## Baseline

- Keep the visible chat ordered from top to bottom by work progress, not by raw event arrival noise.
- Show the current phase as the active item; collapse completed phase details into a short summary that can be expanded.
- Keep raw SSE, JSONL, stdout, stderr, provider payloads, command ids, run ids, and audit refs out of the main visible path.
- Use semantic operation labels in the GUI. Avoid duplicate rows such as `Search Searched ...` or repeated wait notices that only differ by elapsed seconds.
- Waiting is useful only when it proves the stream is alive or tells the user what is blocked. Repeated transport silence should update one current wait state, not append a new visible row every time.

## 2026-05-21 Diff Comment Learnings

- Comment 1 maps to the running-message presentation layer. `RunningWorkProcess` should render a Codex-like timeline: completed steps collapsed, current step visible, full audit expandable below.
- Comment 2 maps to the transport/runtime progress layer. The GUI should receive a semantic progress event immediately after the Runtime Codex SSE request is accepted, then receive heartbeat progress while Codex CLI is alive but quiet.
- `docs/TuiGuiProtocol.md` and `docs/Architecture.md` keep the boundary clear: SciForge GUI may reorganize streamed events for presentation, but must not add task routing, provider selection, repair strategy, or completion judgment.
- The useful local tests are:
  - `src/ui/src/streamEventPresentation.test.ts` for timeline ordering, wait de-noising, and raw/audit hiding.
  - `src/runtime/codex/codex-runtime-server.test.ts` for immediate SSE progress before the adapter turn.
  - `src/ui/src/api/sciforgeToolsClient.policy.test.ts` for watchdog and bounded-stall behavior when transport silence still happens.

## Implementation Notes

- Visible running rows should be derived from structured stream events and `WorkEvidence`, then compacted for repeated wait/silence events.
- The fold summary should say what the user can act on: completed step count, current operation, and whether audit events are folded.
- Server-side progress and heartbeat events should remain transport/runtime facts. They must not fabricate assistant output or task semantics.

## 2026-05-21 Inline Reference / Meta / Width Learnings

- Subagent format that stayed useful: each explorer reported a short conclusion first, then code-path bullets with file links, then a minimal change recommendation. Keeping findings scoped by diff comment made integration faster than mixing UX notes with implementation notes.
- Inline file references should stay protocol-bound. The GUI may upgrade `AHE_Paper_Summary_CN.md` or any other file-like token only when it resolves uniquely to a current session/run artifact or to the verified workspace file index. Ambiguity or missing workspace evidence must leave the text plain.
- Right-pane preview should be driven through object focus and `packages/presentation` discovery. The chat renderer should emit `ObjectReference` clicks, while `ResultsRenderer` / `WorkspaceObjectPreview` choose the markdown/table/image/PDF/HTML/data renderer from the presentation catalog and preview descriptor.
- Workspace-backed inline refs are modality-agnostic. Markdown, tables, PDFs, images, HTML, JSON/data summaries, office files, and structure files should all become the same kind of `ObjectReference` when verified; the GUI should not special-case a single report filename.
- Confidence in the message meta row is display-only. The GUI may render explicit `message.confidence` from TUI/runtime/verifier payloads, but must not infer a default score from prose, logs, claim type, evidence badges, or acceptance state.
- Codex-like chat density is a width contract as much as a component contract: in the quiet shell, user and assistant message bodies should fill the main conversation column, while system notices can remain compact.
