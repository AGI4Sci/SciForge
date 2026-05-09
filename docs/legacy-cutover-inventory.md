# Legacy Cutover Inventory

This inventory is the human-readable companion to `smoke:no-legacy-paths`.
It tracks legacy routes that are still tolerated by baseline guards while the
backend-first capability architecture cuts over to one source of truth.

The smoke remains the enforcement mechanism. This document explains what each
legacy class means, where it should move, and what must be true before the
baseline can be reduced.

## Current Legacy Classes

| Class | Current Surface | New Source Of Truth | Cutover Rule |
| --- | --- | --- | --- |
| UI semantic fallback | UI response normalization, result view planning, workbench fallback display, scenario builder fallback hints | Backend response, object refs, UIManifest, package-owned view manifests | UI may explain missing bindings, but it must not infer user intent, artifact type, or renderer choice from prompts or hardcoded domain strings. |
| Provider/scenario/prompt special cases | Gateway prompt text, runtime UI manifest prompt parsing, skill registry prompt matching, skill catalog provider normalization | Capability manifests, package catalog metadata, broker policy, runtime transport contracts | Runtime can enforce transport and safety policy; provider, scenario, prompt, and domain selection must be manifest/catalog driven. |
| Legacy package facade re-exports | `src/ui/src/scenarioCompiler/*` and `src/ui/src/scenarioSpecs.ts` package facades | Stable `@sciforge/scenario-core/*` package entrypoints | UI callers should import stable package entrypoints directly once thin-shell migration removes compatibility facades. |
| Legacy adapter/compat re-export | Package or src modules exporting adapter/compat paths | Stable runtime entrypoints or package public exports | New code must use stable entrypoints; compatibility exports should shrink only with an explicit migration and baseline reduction. |
| Old payload normalizer / repair fallback | Runtime repair-needed assembly and direct payload fallback paths that predate `ContractValidationFailure` | `ContractValidationFailure`, backend repair contract, validation-to-repair pipeline | Failures should carry structured validation failure, recover actions, and related refs instead of free-text-only repair prompts. |
| Old preview resolver / object ref inference | UI preview and artifact helpers that infer display behavior from artifact/domain names | Backend artifact tools, stable object refs, package-owned view policy | Preview follows object refs and manifest bindings; no direct reliance on temporary `agentserver://` previews as final truth. |

## Reduction Rules

- Lower `tools/check-no-legacy-paths.ts` baseline only in the same change that removes or migrates the matching legacy path.
- Add a migration note for every new tolerated baseline entry. Untracked entries should fail CI.
- Prefer a new capability manifest, broker rule, runtime contract, or backend tool over another UI/runtime special case.
- When a legacy path is removed, update this inventory, the smoke baseline, and the relevant PROJECT item together.

## Target End State

- Backend-first request handling is the only successful answer path.
- Capability registry, broker, validation loop, artifact tools, and object refs are the only truth sources for routing and continuation.
- UI renders state, refs, artifacts, validation failures, and recover actions; it does not synthesize semantic answers.
- Packages own capability semantics; `src/` owns transport, safety, workspace refs, validation, repair, persistence, and ledger writing.
