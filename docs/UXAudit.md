# BioAgent UX Audit

Last updated: 2026-04-25

## Scope

This audit captures the product hardening pass for the scalable Scenario Package model. The target user path is:

1. Open BioAgent for the first time.
2. Import an official or local package.
3. Compile a new scenario from a natural-language description.
4. Open the generated workbench.
5. Understand runtime readiness, run failures, and result empty states.
6. Export or archive reproducible package assets.

## Journey Map

### First Visit / Dashboard

- Expected: user sees a clear starting path without needing to understand AgentServer, workspace writer, package internals, or skill domains.
- Current coverage: `RuntimeHealthPanel`, `Get Started`, official package catalog, local package import, Scenario Library.
- Verified by: `npm run smoke:browser` first-visit assertions and `browser-smoke-desktop.png`.
- Remaining risks: health panel still probes optional AgentServer and can create noisy browser console network errors; needs a quieter probe strategy.

### Package Catalog / Scenario Library

- Expected: official packages behave like installable assets; local packages can be imported, opened, copied, exported, and archived.
- Current coverage: official `导入并打开`, local JSON import auto-opens the workbench, library cards expose open/copy/export/archive.
- Verified by: browser smoke local package import/export and official structure package import/open.
- Remaining risks: no conflict dialog for same package id/version; library lacks search/filter/sort and archived restore flow.

### Scenario Builder

- Expected: user starts with a description, sees recommended components, can refine elements, checks quality, and publishes/runs.
- Current coverage: generated draft preview, selectable skills/tools/components/artifacts/policies, quality gate, advanced JSON contract collapsed by default, publish/export actions.
- Verified by: browser smoke Builder compile, advanced contract tabs, draft save, publish, screenshots for collapsed and expanded states.
- Remaining risks: Builder is not yet a true stepper; element chips need detail popovers and recommendation reasons persisted into package metadata.

### Workbench Chat / Run

- Expected: user knows which package/version/skill/UI plan will run, why send is disabled, and how to recover from failures.
- Current coverage: run readiness strip, package version display, failed message recovery card, retry previous prompt action, settings guidance.
- Verified by: browser smoke run-readiness assertion.
- Remaining risks: retry/repair actions are not yet full buttons for seed skill, diagnostic bundle export, and selected repair route.

### Results / Artifacts / Handoff

- Expected: empty states explain missing artifacts and next actions; artifacts show lineage and handoff targets.
- Current coverage: empty result states include recovery hints; artifact source bar and downloads are visible when artifacts exist; result panel can collapse.
- Verified by: browser smoke collapsed-results screenshot and structure viewer screenshot.
- Remaining risks: no artifact inspector drawer; handoff lacks confirmation preview.

### Settings / Workspace

- Expected: settings opens reliably, connection diagnostics are visible, workspace path is understandable, file actions report outcomes.
- Current coverage: Settings dialog with Runtime Health and reload/recheck action; workspace sidebar opens and lists workspace entries; file actions keep inline status.
- Verified by: browser smoke Settings and Workspace assertions.
- Remaining risks: workspace tree needs a dedicated `.bioagent` grouping for tasks/logs/results/scenarios/exports and safer onboarding when a path is missing.

### Timeline

- Expected: package import/publish, runs, artifacts, handoffs, failures, and exports become navigable research memory.
- Current coverage: static timeline page plus alignment contract records.
- Verified by: browser smoke navigation to Timeline.
- Remaining risks: real package/run/artifact events are not yet written into a timeline event schema.

## Regression Assets

- `docs/test-artifacts/browser-smoke-desktop.png`
- `docs/test-artifacts/browser-smoke-mobile.png`
- `docs/test-artifacts/browser-smoke-structure.png`
- `docs/test-artifacts/browser-smoke-builder-collapsed.png`
- `docs/test-artifacts/browser-smoke-results-collapsed.png`

## Priority Backlog

1. Add package import conflict handling: overwrite, rename, cancel, and version diff preview.
2. Add library search/filter/sort and archived package restore.
3. Add real timeline event schema and write events for import, publish, run, artifact, handoff, failure, export.
4. Add artifact inspector drawer with schema, preview, lineage, files, and handoff targets.
5. Quiet optional AgentServer health probes and fix Recharts `width(-1)` warnings.
