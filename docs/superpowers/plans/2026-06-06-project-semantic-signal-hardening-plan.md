# Project Semantic Signal Hardening Plan

> **Principle:** Keywords, regexes, filenames, status labels, and UI copy are feature detectors only. Final decisions that affect routing, permissions, writes, risk, or completion must be made from structured semantic signals and refs-first evidence.

**Goal:** Migrate SciForge decision boundaries away from keyword-only matching across browser, model routing, scenario routing, artifact mutation, direct-context/outcome gates, and vision-sense Computer Use.

**Status:** In progress on 2026-06-06. BrowserHostSession search/completion was already migrated; this plan expands the same rule to the rest of the project.

## Decision Boundary Inventory

- Browser evidence and query extraction: migrated to semantic signals.
- Runtime Codex SSE/WebSocket completion: migrated to structured terminal payload semantics.
- Runtime timeline grouping: lexical detectors remain presentation-only and carry a guard comment.
- Model-router modality routing: assigned to Worker A.
- Scenario routing and scenario element recommendations: assigned to Worker B.
- Artifact mutation/write fast path: assigned to Worker C.
- Direct-context, direct-answer, and task outcome gates: assigned to Worker D.
- Vision-sense Computer Use risk/routing/completion: assigned to Worker E.

## Required Code Comment Pattern

At every final decision boundary, keep a nearby comment with this meaning:

> Semantic decision principle: lexical detectors are bounded feature extractors only. Final routing, permission, write, safety, or completion truth must be reduced from structured semantic signals and refs-first evidence. If structured signals are missing or ambiguous on high-impact paths, fail closed instead of falling back to pure keyword matching.

## Verification Target

- Focused tests per changed module.
- `npx tsc -p tsconfig.desktop.build.json --noEmit`.
- A live UI-equivalent browser/completion smoke after integration if runtime-facing files change.
