# UI App Owner Notes

`src/ui/src/app` owns the React app shell, page composition, panels, chat orchestration, and user interaction flows. It should stay thin around reusable capability logic so feature teams can work in packages, runtime, and UI without hidden cross-dependencies.

## New Code Placement

- Put reusable renderers, manifests, fixtures, design primitives, object reference helpers, and artifact preview helpers in `packages/*`.
- Put gateway, workspace server, task runner, verification gate, and file-system behavior in `src/runtime`.
- Put app-only state wiring, page layout, panel composition, and user events in `src/ui/src/app`.

## Import Boundaries

- Prefer package root imports or package.json exported subpaths.
- Avoid relative deep imports into package `src` internals from UI app code.
- Do not import runtime private files directly from UI app code; go through `src/ui/src/api/*` clients or shared contracts.

Verify before handing off UI/module-boundary work:

```bash
npm run smoke:module-boundaries
```
