# Plan Mode Prompt Module

This document records the prompt design used by SciForge's optional composer plan-mode wrapper.

## Source Behavior

The design was adapted from a historical local Claude Code plan-mode reference. The source names below are provenance notes, not current repository paths:

- `src/tools/EnterPlanModeTool/prompt.ts`: when plan mode should be used.
- `src/utils/messages.ts`: plan-mode workflow, including the interview-based loop.
- `src/tools/ExitPlanModeTool/prompt.ts`: plan approval semantics.

The important behavior is not "ask many questions". It is:

- Explore the relevant context first.
- Ask only questions that cannot be answered from code, attachments, or source material.
- Batch related questions and cap the first round.
- Write a concrete, approval-ready plan.
- Do not implement until the user approves the plan.

## Product Behavior

The feature is opt-in from the chat composer. When the user does not enable the toggle, the existing send path sends the original prompt unchanged. When enabled, SciForge wraps the user's prompt in a plan-mode prompt before sending it to the runtime.

The wrapper is standalone in `src/shared/long-horizon-prompt.ts` so it can be tested without rendering the composer or starting an agent runtime. The exported names still use `long-horizon` for compatibility with the current UI wiring, but the schema and generated text are plan-mode oriented.

## Prompt Template

The generated prompt contains:

- Original user request
- Workspace and attachment context
- Acceptance criteria
- Plan-mode policy
- Iterative planning workflow
- Good-question rules
- Clarifying question triage
- Plan structure
- Subagent delegation instructions
- Output contract

The template explicitly says the agent is in a planning phase and must not implement, edit files, change config, install dependencies, commit, push, or run destructive commands until the user approves the plan.

## Clarification Policy

The module detects obvious gaps in outcome, target artifact, acceptance criteria, constraints, and source material. If the prompt is too short or misses several facets, the generated prompt tells the runtime to ask the smallest useful question set before producing a final plan.

For source-dependent research tasks such as paper summaries, SciForge asks for source material or web-retrieval permission when no source is attached or referenced. This is why a query like "整理Deepseek-R1这篇论文的核心发现..." should ask what source to use before doing source-dependent work.

## Acceptance Checks

- Unchecked composer sends the original prompt through the existing path.
- Checked composer calls the shared builder and sends the expanded plan-mode prompt while preserving the user's visible display text.
- Prompt expansion includes explicit acceptance criteria.
- Prompt expansion blocks implementation until plan approval.
- Prompt expansion includes interview rules and subagent delegation.
- Prompt expansion handles at least ten different task shapes in tests.
- Lazy prompts produce clarification questions without exceeding the question budget.

## End-to-End Validation

The reusable harness is `scripts/long-horizon-e2e.mjs`. It still uses the legacy filename because it was created before the plan-mode rename.

Run:

```bash
node scripts/long-horizon-e2e.mjs setup
node scripts/long-horizon-e2e.mjs validate
```

`setup` creates ten isolated task directories under `temp/long-horizon-e2e`, writes each task's seed files, and generates a prompt with the production prompt builder. Each task is intended to be executed by an agent only after the plan is accepted.
