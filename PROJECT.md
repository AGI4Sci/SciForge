# SciForge Project Protocol

Last updated: 2026-05-27

Current objective: continue developing `packages/actions/computer-use` as a Codex CLI discoverable Computer Use extension that can do complex visible work through its own virtual mouse and keyboard, without moving the user's real mouse, sending global keyboard events, or interrupting normal computer use.

GitHub sync point: old task history and completed package-closure evidence were committed and pushed to `origin/dev` as `691e22e` on 2026-05-27. The old task board can be recovered from Git history; keep this file focused on the next work.

## Current Scope

- Work only in `packages/actions/computer-use` unless a change is strictly required by that package boundary.
- Use Codex CLI plus the Computer Use extension package for complex work.
- Do not route validation through SciForge runtime, GUI, CU-NEXT, browser acceptance, AgentServer, or release gates unless the user explicitly moves the project into that integration phase.
- Complex tasks must go through package CLI/API/stdio/host-port boundaries and produce refs-first evidence: screenshots, trace, result JSON, artifact refs, verifier verdicts, and input isolation manifests.
- "Visible to the user" means the package produces a live or replayable view of the agent's virtual desktop/actions, such as a viewer HTML, frame sequence, annotated screenshots, or recording refs. It does not mean moving the user's physical pointer or typing into their active desktop.

## Non-Negotiable Rules

- The agent must maintain its own virtual pointer and keyboard state.
- `sharedSystemInputUsed`, `systemPointerMoved`, and `systemKeyboardEventsSent` must stay false for visible package workflows.
- Any real OS/global input path is diagnostic only unless separately approved and explicitly isolated from the user's active session.
- High-risk actions fail closed: send, delete, pay, publish, upload, permission changes, account actions, external submissions, or destructive local actions must return `needs-confirmation` / `approvalRequest`.
- `done=true` requires current visual evidence plus file/artifact evidence. Prior trace summaries or old screenshots are not enough.
- No secrets, raw provider payloads, inline images, data URLs, API keys, or Authorization headers may be written to tracked files, traces, manifests, or docs.
- Keep implementations generic. If a complex task exposes an algorithm bug, first add a small reusable fixture/probe/test, then repair the algorithm.
- Core package logic should stay in Python where practical.
- If a file approaches 2000 lines, split it or add a concrete split task here.

## Current Task Board

- [x] Sync current package-closure work to GitHub before deleting old tasks.
  Evidence 2026-05-27: commit `691e22e` pushed to `origin/dev`.
- [x] Build a visible Codex CLI run harness for Computer Use.
  Evidence 2026-05-27: `python -m sciforge_computer_use.visible_run` wraps the existing virtual desktop or target-bound host loop and writes `visible-run-viewer/index.html`, `visible-run-viewer-manifest.json`, frame refs, action timeline, virtual/target input event refs, `vision-trace.json`, and `computer-use-result.json`. Focused test `test_visible_run.py` passed, and a visible PPTX run completed under `/tmp/sciforge-computer-use-visible-pptx-20260527`.
- [ ] Add virtual mouse and keyboard overlay evidence.
  The visible viewer must show pointer moves, clicks, focus changes, typed text, hotkeys, scroll deltas, and save actions from the virtual input adapter. It must also prove no system pointer or global keyboard event was used.
- [ ] Test Computer Use making a PPT deck visibly.
  Create a multi-slide `.pptx` through the package workflow with title/content editing, at least one layout change, save hotkey/menu action, and final preview. Validate OOXML parts, slide count, absence of macros, rendered slide previews, save causality, virtual pointer/keyboard logs, and trace/result refs.
- [ ] Test Computer Use using Word software or a Word-compatible isolated document target.
  Create and save a `.docx` with heading, paragraph, bullet list, and a small table. The task must be visible in the package viewer, use virtual mouse/keyboard only, validate DOCX zip/XML structure, and return preview/screenshot/artifact refs. If Microsoft Word cannot be safely isolated, record a blocked manifest and run the same contract against a package-owned Word-compatible target until isolation is available.
- [ ] Add a cross-document workflow.
  Use the package workflow to read visible source material, create a Word report or PPT summary, save it, reopen/preview it, and return directory evidence. This should exercise observe -> plan -> locate -> execute -> observe -> verify across multiple visible panes without using DOM shortcuts or shell-written artifacts.
- [ ] Add a visible high-risk approval demo.
  Fill safe form fields with virtual input, then stop at a send/upload/delete-style action with `needs-confirmation`. The viewer should make clear what would happen next without executing it.
- [ ] Add application availability and isolation preflight.
  Detect whether Word, PowerPoint, LibreOffice, Pages/Keynote, or a package-owned document surface is available. Preflight must select an isolated target or produce a blocked manifest explaining why visible real-app testing cannot proceed safely.
- [ ] Promote reusable validators for visible artifacts.
  Keep PPTX validation, add DOCX validation, and make viewer evidence validation reusable across PPT, Word, CSV, forms, menus, and file preview workflows.
- [ ] Keep package docs aligned with the new visible-work phase.
  Update `packages/actions/computer-use/README.md` after the visible harness exists. Do not document commands that are only aspirational.

## Immediate TODO

- [x] Inspect the current target-bound host and virtual desktop probe for the smallest place to attach a replayable viewer.
- [x] Design the viewer manifest schema: frames, virtual input events, focused target, artifact refs, verifier verdicts, and isolation flags.
- [x] Add tests for viewer manifest validation before adding new PPT/Word fixtures.
- [ ] Add the PPT visible fixture and focused regression.
- [ ] Add the Word/DOCX visible fixture and focused regression.
- [ ] Run `PYTHONPATH=packages/actions/computer-use python -m pytest packages/actions/computer-use/tests -q`.
- [ ] Run `node --test --import tsx packages/actions/computer-use/provider-policy.test.ts packages/actions/computer-use/runtime-policy.test.ts` when package policy files change.
- [ ] Run `git diff --check` before every commit.

## Local Model Config

- Local Computer Use debugging may use ignored config files such as `config.computer-use.local.json`.
- These files may contain provider URLs, API keys, and model names; they must never be committed or printed.
- Text planning can use a cheap local/project text model. Optional VLM verifier evidence must use the model allowlist enforced by code and must prove model presence through sanitized diagnostics.

## Validation Rules

- Documentation-only changes: run `git diff --check`.
- Computer Use package changes: run the package-local Python suite.
- Policy/manifest TypeScript changes: run the focused Node tests above.
- Visible complex workflow claims require trace/result refs, screenshot/viewer refs, final artifact refs, verifier verdict, virtual input logs, and explicit isolation flags.
- Native or real-app blocked states are acceptable only when they write a blocked manifest with concrete missing capability, safety, or isolation reasons.

## Deferred Integration

These remain paused until the package-level visible workflow is stable:

- SciForge runtime bridge integration
- GUI `gui.present` / `gui.ask_user`
- CU-NEXT L2/L3 acceptance
- browser acceptance
- AgentServer/provider registry migration
- release gates and full-repo verification

## Required Reading

- [`packages/actions/computer-use/README.md`](packages/actions/computer-use/README.md)
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)
- [`packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md`](packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md)
- [`packages/observe/vision/README.md`](packages/observe/vision/README.md)

## Worktree Policy

- Development happens on `dev`; long-term branches should stay limited to `main` and `dev`.
- Local state such as `config.local.json`, `config.computer-use.local.json`, `.sciforge/**`, package caches, and runtime homes must not enter Git.
- Do not use `git reset --hard` or `git checkout --` to erase user changes.
- Clean only known generated caches, temporary workspaces, and build outputs.
