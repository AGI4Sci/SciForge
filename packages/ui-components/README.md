# @sciforge-ui/components

## Agent quick contract
- This package aggregates published SciForge UI component manifests.
- Agents should read each selected component package's `README.md` `Agent quick contract` section first.
- `primitive-map.md` is the compatibility source for mapping current component/artifact IDs to stable data primitives and future renderer names.
- Schema drafts for primitives live in `schemas/*.schema.json`; each file includes an example payload for agent and workbench smoke usage.
- Every component README must expose the same top-level contract fields: `componentId`, `accepts`, `requires`, `outputs`, `events`, `fallback`, `safety`, and `demo fixtures`.
- `availableComponentIds` is an allowlist, not a command to generate every matching artifact.
- If no selected component accepts an object, use `unknown-artifact-inspector` or the preview/system-open fallback path.

## Human notes
Each child directory is intentionally shaped like a publishable UI component package. The manifest is the machine-readable contract; the README is split so agents can scan a short operational section while humans can maintain richer design and testing notes below it.

### Component package structure
- `package.json`: publishable package metadata. Keep `private` unset or `false`.
- `manifest.ts`: machine-readable module contract consumed by the SciForge view planner.
- `render.tsx`: package-native renderer entry. It receives `UIComponentRendererProps` and may use explicit shell helpers for app-owned chrome such as downloads, source bars, empty states, markdown, and workspace file reads.
- `fixtures/`: minimal empty and populated payload examples for local debugging and regression tests.
- `render.test.tsx`: lightweight renderer contract tests using fixtures.
- `README.md`: agent-facing contract plus human maintenance notes.

### Renderer contract
Renderers should treat `artifact.data` and `slot.props` as untrusted runtime payloads, render useful empty states, avoid fetching network resources unless the manifest declares them, and keep interaction events aligned with `manifest.ts`. New component packages should target this renderer interface; legacy in-app adapters only exist for components that have not been migrated yet.

### README contract
Each component README has an `Agent quick contract` followed by `Human notes`. Human notes should keep the same maintenance subsections: data schema, interaction/edit output semantics, performance/resource limits, when not to use, and testing/publishing notes. Preset components must name their underlying primitive, for example volcano and UMAP as `point-set` presets, heatmap as a `matrix` preset, and knowledge graph as a `graph` preset.

Scientific plotting components are Plotly-first. `scientific-plot-viewer`, model evaluation, time-series plotting, statistical result views, publication figure builders, and export bundles should treat Plotly-compatible `plot-spec`/`figure-spec` as the editable source of truth. Matplotlib artifacts are fallback or advanced publication exports derived from the same spec, never the primary editing state.

### Testing and publishing
At minimum, published component packages must have `package.json`, `manifest.ts`, and `README.md`. The current sample packages, `report-viewer` and `data-table`, additionally require `render.tsx`, `fixtures/`, and renderer tests. Before publishing or changing a package contract, run `npm run packages:check`, `npm run typecheck`, and `npm run test`.
