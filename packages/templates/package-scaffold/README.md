# SciForge Package Scaffold

Use this template when adding a new reusable package, observe provider, action provider, verifier, presentation renderer, or skill-facing ability. Copy the relevant sections into the new package README and package metadata, then delete sections that do not apply.

## Placement Decision

1. If the primary entrypoint is `SKILL.md`, place it under `packages/skills/{tool_skills,pipeline_skills,domain_skills,meta_skills}`.
2. If it only observes external state and emits audit-friendly observations, place it under `packages/observe`.
3. If it changes external state, writes files, clicks UI, calls a mutating API, controls hardware, or executes a notebook/kernel, place the provider contract or manifest under `packages/actions`.
4. If it evaluates output, trace, artifact, or state, place it under `packages/verifiers`.
5. If it renders artifacts or exposes interactive object refs/events, place it under `packages/ui-components` today and optionally re-export from `packages/interactive-views`.
6. If it defines stable cross-package types, place it in `packages/runtime-contract` or a package-owned public export.

## Required README Sections

- Purpose: one paragraph naming the capability lifecycle layer.
- Agent contract: what an agent may read, call, or expect from the package.
- Owner boundary: what this package owns and what it must delegate.
- Side effects: `none`, `delegated-to-actions`, `requires-approval`, or `mutates-environment`.
- Inputs and outputs: stable schemas, refs, events, traces, or verdicts.
- Safety: approval, sandbox, rollback, privacy, trace, and failure behavior when applicable.
- Tests: exact commands that prove the package boundary still works.

## package.json Metadata

Top-level workspace packages must include:

```json
{
  "sciforge": {
    "lifecycleLayer": "contracts | reasoning | skills | observe | actions | verifiers | presentation | scenarios | support",
    "skillFacing": false,
    "sideEffects": "none | delegated-to-actions | requires-approval | mutates-environment",
    "publicContract": true,
    "runtimeAdapter": false
  }
}
```

## Import Rules

- Package code must not import `src/ui/src/**`, `src/runtime/**`, or `src/shared/**`.
- UI code should import package roots or exported subpaths, not package internals.
- Runtime adapters may consume package contracts and providers, but provider packages should not import runtime adapters back.
- Shared types move upward into `packages/runtime-contract` or a package public export before multiple owners depend on them.

## Verification

Run the narrow package tests first, then:

```bash
npm run typecheck
npm run smoke:module-boundaries
npm run packages:check
```
