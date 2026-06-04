# 视觉 Computer Use Agent — historical observe-side redirect

This observe-side copy is not the source of truth for Computer Use execution.
The maintained action-provider contract lives at:

- `packages/actions/computer-use/vision_computer_use_agent_mvp.md`
- `packages/actions/computer-use/README.md`
- `packages/actions/computer-use/action-provider.manifest.json`

## Current Boundary

- `packages/actions/computer-use` owns request/result schema, action loop, safety/approval policy, trace/result promotion, budget debit, host-port contract, executor adapter contract, target-bound evidence, artifact/file-list guards, and compact handoff.
- `packages/observe/vision` is an optional sense/provider layer only. It may provide visual observation helpers, focus-region/crop helpers, `qwen3.7-plus` VLM/visual grounding support, verifier feedback compression, temporary file-ref-only visual memory, and vision trace validation. It does not execute desktop actions, decide completion, own safety gates, or claim user-level success.
- `src/runtime`, GUI, CU-NEXT, browser acceptance, AgentServer, and release gates are later integration layers. They must not become the long-term owner of generic Computer Use policy.

## Non-Negotiable Current Rules

- Planner output stays generic and coordinate-free; coordinates come from a grounder/provider.
- High-risk actions return `needs-confirmation` / `approvalRequest`; GUI confirmation is owned by TUI Host, not by Computer Use or observe/vision.
- Completion for artifact-producing tasks must be proven by current visual/file evidence and refs-first trace/result records, not by prior-round ledgers, old screenshots, VLM guesses, or historical summaries.
- Optional VLM/semantic verification is metadata only. It cannot own coordinates, execution, safety, or completion. Raw provider payloads, inline images, data URLs, API keys, and base64 must not be written to trace or manifests.
- Target-bound evidence requires isolated input, target binding validation, current screenshot/trace/result refs, no OS/shared/system input side effects, and file/artifact causality where relevant.
- Shared/system input, clipboard paste, DOM/accessibility shortcuts, Playwright/DOM shortcuts, app-specific private APIs, and GUI-private state cannot satisfy the current target-bound isolated executor contract.

## Why This File Is Short

The previous long MVP copy duplicated execution policy from the action provider
and drifted out of date. Keeping this file as a redirect avoids two competing
contracts. Future observe/vision documentation should describe only optional
visual provider behavior and should link back to the action-provider docs for
execution, safety, completion, and evidence rules.
