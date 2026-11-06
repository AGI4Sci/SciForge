# User Decisions

A trusted domain package with separate main and renderer entrypoints. The manifest contributes the `user-decisions.request` capability, provider-neutral routing guidance, and the SDK `chat.user-input` presenter. Generated composition discovers all three; the Host has no package-ID branch.

## Contract and execution

Agents on Codex, Claude Code, DSH and Pi discover and invoke the same capability through the existing SciForge capability tool surface. Questions contain stable IDs, text, and up to eight uniquely labelled options, optionally with stable option IDs and a recommendation. Prefer 1–3 questions and 2–4 options. Empty options mean free text. Other/free text is always available. The result distinguishes submitted answers from cancellation. A selected answer retains its exact option label and includes any additional context in its value.

The SDK user-input port accepts data only. The Host captures the runtime, thread, turn, call and cancellation signal from the active authenticated capability invocation. The original tool call stays pending until an explicit answer or cancellation, and returns the result directly to the requesting runtime. No extra conversation, synthetic user message, runtime-specific questionnaire tool or new IPC endpoint is introduced. Questionnaires never grant approval for an external write.

The Host owns request lifecycle, validates complete answers, rejects cross-session and stale responses, and retains bounded receipts for duplicate submission. Its existing runtime journal stores requested/resolved events and their transcript item projection. Codex maps this projection to its existing request tool records; Claude and DSH use their journal projections; Pi persists it in its own event journal. Existing native user input uses the same presenter and response API. The normal runtime interrupt signal cancels pending Host input.

## UI

The package owns both the conversation card and the floating window, exposed through one SDK presenter contract. The foreground conversation opens its first pending question; nested/background conversation cards can open it explicitly. There is no preselected answer. The floating window is non-modal: no backdrop, inert background or focus trap. Automatic opening never steals keyboard focus. Drag its title bar or focus the title bar and use arrow keys to move it; its position stays within the viewport and is retained for later requests. Escape, close and Later dismiss the floating window without cancelling the request. Drafts survive closing and switching conversations within the desktop window session. Explicit Cancel returns cancellation to the tool. A failed submit keeps the draft editable and can be retried.

A process restart cannot resume an in-flight provider tool call. Historical unresolved Host requests are therefore presented as cancelled, and their old request IDs cannot resume a new turn. Submitted answers remain in the transcript. No answer is fabricated on timeout or restart.

Runtime executables still need to be installed/configured, support tool calling, and have the SciForge Host tool bridge enabled. The generic capability does not depend on native `request_user_input` support. Remote sessions use their existing runtime event and response routes.

## Verification

Run package tests and typecheck, domain composition checks, capability governance checks, the runtime Host/service and adapter tests, renderer replay tests, full regression, and source/packaged Electron smoke after building.
