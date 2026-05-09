# Legacy Cutover Inventory

This inventory is the human-readable companion to `smoke:no-legacy-paths`.
It tracks legacy routes that are still tolerated by baseline guards while the
backend-first capability architecture cuts over to one source of truth.

The smoke remains the enforcement mechanism. This document explains what each
legacy class means, where it should move, and what must be true before the
baseline can be reduced.

This file is not a completion checklist. A PROJECT item can be checked only
after the source path is migrated, the matching baseline in
`tools/check-no-legacy-paths.ts` is reduced, and the relevant smoke passes.

## How To Use This Inventory

1. Pick one row from "Next Cutover Queue".
2. Move behavior to the listed source of truth without adding another prompt,
   scenario, provider, fallback, compat, or legacy branch.
3. Run `npm run smoke:no-legacy-paths` and the focused smoke for the touched
   runtime/package/UI area.
4. Lower only the exact file/rule baseline that shrank.
5. Update this inventory with the evidence and then update PROJECT if the
   milestone acceptance criteria are actually satisfied.

## Current Legacy Classes

| Class | Current Surface | New Source Of Truth | Cutover Rule |
| --- | --- | --- | --- |
| UI semantic fallback | UI response normalization, result view planning, workbench fallback display, scenario builder fallback hints | Backend response, object refs, UIManifest, package-owned view manifests | UI may explain missing bindings, but it must not infer user intent, artifact type, or renderer choice from prompts or hardcoded domain strings. |
| Provider/scenario/prompt special cases | Gateway prompt text, runtime UI manifest prompt parsing, skill registry prompt matching, skill catalog provider normalization | Capability manifests, package catalog metadata, broker policy, runtime transport contracts | Runtime can enforce transport and safety policy; provider, scenario, prompt, and domain selection must be manifest/catalog driven. |
| Legacy package facade re-exports | `src/ui/src/scenarioCompiler/*` and `src/ui/src/scenarioSpecs.ts` package facades | Stable `@sciforge/scenario-core/*` package entrypoints | UI callers should import stable package entrypoints directly once thin-shell migration removes compatibility facades. |
| Legacy adapter/compat re-export | Package or src modules exporting adapter/compat paths | Stable runtime entrypoints or package public exports | New code must use stable entrypoints; compatibility exports should shrink only with an explicit migration and baseline reduction. |
| Old payload normalizer / repair fallback | Runtime repair-needed assembly and direct payload fallback paths that predate `ContractValidationFailure` | `ContractValidationFailure`, backend repair contract, validation-to-repair pipeline | Failures should carry structured validation failure, recover actions, and related refs instead of free-text-only repair prompts. |
| Old preview resolver / object ref inference | UI preview and artifact helpers that infer display behavior from artifact/domain names | Backend artifact tools, stable object refs, package-owned view policy | Preview follows object refs and manifest bindings; no direct reliance on temporary `agentserver://` previews as final truth. |

## Next Cutover Queue

| Priority | Tracked Guard Surface | Owner Boundary | First Migration Step | Evidence Before Baseline Reduction |
| --- | --- | --- | --- | --- |
| P0 | `src/ui/src/api/agentClient/responseNormalization.ts#ui-semantic-fallback` | UI display only | Keep failure and object-ref projection, but move artifact/view intent inference to backend payload refs and UIManifest bindings. | Focused response normalization tests show no prompt/domain inference, `npm run smoke:no-legacy-paths` reports a lower count. |
| P0 | `src/ui/src/app/results/viewPlanResolver.ts#ui-semantic-fallback` | Package view manifests | Replace local fallback ranking with accepted artifact types and component aliases from `packages/presentation/components`. | View resolver tests cover manifest-driven selection and the file/rule count shrinks. |
| P0 | `src/runtime/runtime-ui-manifest.ts#provider-scenario-prompt-special-case` | Runtime binding shell plus package view policy | Keep slot validation in runtime, move prompt-driven component defaults to scenario/view package policy. | Runtime UI manifest smoke passes and prompt/scenario branch count decreases. |
| P1 | `src/runtime/gateway/agentserver-prompts.ts#provider-scenario-prompt-special-case` | Backend handoff contract | Replace provider-specific prompt text with capability brief, policy refs, and validation contract refs. | Gateway module smoke passes and prompt special-case count decreases. |
| P1 | `src/runtime/skill-registry/runtime-matching.ts#provider-scenario-prompt-special-case` | Skill package manifests/catalog | Move prompt/provider matching hints into generated skill catalog metadata. | Skill catalog smoke and `packages:check` pass with a reduced count. |
| P1 | `src/runtime/skill-markdown-catalog.ts#provider-scenario-prompt-special-case` | Skill package metadata | Store provider normalization in package metadata instead of runtime string rules. | Catalog generation stays stable and the guard count shrinks. |
| P2 | `src/ui/src/scenarioCompiler/*#legacy-package-facade-reexport` | `@sciforge/scenario-core/*` public exports | Change UI callers to package entrypoints, then delete the thin facade file by file. | Typecheck and scenario package smoke pass after each deleted facade. |
| P2 | `src/ui/src/scenarioSpecs.ts#legacy-package-facade-reexport` | `@sciforge/scenario-core/*` public exports | Replace imports with stable scenario-core entrypoints and delete the UI facade. | Typecheck and docs scenario/package smoke pass with baseline reduced by one. |
| P2 | Package/src `adapter`/`compat` re-exports | Stable package/runtime entrypoints | Add or document the stable entrypoint first, migrate callers, then remove compatibility exports. | Package boundary checks pass and no new re-export warning appears. |

## Reduction Rules

- Lower `tools/check-no-legacy-paths.ts` baseline only in the same change that removes or migrates the matching legacy path.
- Add a migration note for every new tolerated baseline entry. Untracked entries should fail CI.
- Prefer a new capability manifest, broker rule, runtime contract, or backend tool over another UI/runtime special case.
- When a legacy path is removed, update this inventory, the smoke baseline, and the relevant PROJECT item together.
- Do not update PROJECT for documentation-only clarification. Docs can mark the path, but code and guard evidence close the milestone.

## Target End State

- Backend-first request handling is the only successful answer path.
- Capability registry, broker, validation loop, artifact tools, and object refs are the only truth sources for routing and continuation.
- UI renders state, refs, artifacts, validation failures, and recover actions; it does not synthesize semantic answers.
- Packages own capability semantics; `src/` owns transport, safety, workspace refs, validation, repair, persistence, and ledger writing.
