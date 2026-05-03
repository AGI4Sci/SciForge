# @bioagent-ui/components

## Agent quick contract
- This package aggregates published BioAgent UI component manifests.
- Agents should read each selected component package's `README.md` `Agent quick contract` section first.
- `availableComponentIds` is an allowlist, not a command to generate every matching artifact.
- If no selected component accepts an object, use `unknown-artifact-inspector` or the preview/system-open fallback path.

## Human notes
Each child directory is intentionally shaped like a publishable UI component package. The manifest is the machine-readable contract; the README is split so agents can scan a short operational section while humans can maintain richer design and testing notes below it.

### Component package structure
- `package.json`: publishable package metadata. Keep `private` unset or `false`.
- `manifest.ts`: machine-readable module contract consumed by the BioAgent view planner.
- `render.tsx`: package-native renderer entry. It receives `UIComponentRendererProps` and may use explicit shell helpers for app-owned chrome such as downloads, source bars, empty states, markdown, and workspace file reads.
- `fixtures/`: minimal empty and populated payload examples for local debugging and regression tests.
- `render.test.tsx`: lightweight renderer contract tests using fixtures.
- `README.md`: agent-facing contract plus human maintenance notes.

### Renderer contract
Renderers should treat `artifact.data` and `slot.props` as untrusted runtime payloads, render useful empty states, avoid fetching network resources unless the manifest declares them, and keep interaction events aligned with `manifest.ts`. New component packages should target this renderer interface; legacy in-app adapters only exist for components that have not been migrated yet.

### Testing and publishing
At minimum, published component packages must have `package.json`, `manifest.ts`, and `README.md`. The current sample packages, `report-viewer` and `data-table`, additionally require `render.tsx`, `fixtures/`, and renderer tests. Before publishing or changing a package contract, run `npm run packages:check`, `npm run typecheck`, and `npm run test`.
