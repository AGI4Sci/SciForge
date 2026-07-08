# Workspace Worker Package Integration Checklist

Date: 2026-07-08

Use this checklist when adding a first-party workspace preview worker under `packages/workers/workspace-*`.

## Required

- Add `package.json`, `tsconfig.json`, `README.md`, `src/contract.ts`, `src/service.ts`, `src/index.ts`, and focused `src/**/*.test.ts`.
- Keep `sciforge.lifecycleLayer` set to `workers`.
- Declare `sciforge.publicContract`, `sciforge.runtimeAdapter`, `sciforge.mcpServer`, and `sciforge.sideEffects`.
- Export the standard boundary: `.`, `./contract`, `./engine`, and `./service`.
- Add the package path to root `package.json` workspaces.
- Add root scripts named `<package-dir>:test` and `<package-dir>:typecheck`.
- Update `package-lock.json` workspace link and package entries.
- Keep parser/summary workers dependency-light. Put renderer, WebGL, tile, and large binary transport work in the preview plugin layer instead.

## Release Audit

Workspace preview worker packages are not bundled into the desktop release manifest by default. Before adding one to `scripts/release-worker-manifest.cjs`, record:

- why the worker must be bundled instead of lazy-installed or used through source workspace development;
- license and transitive dependency risk;
- native/WASM/binary assets and signing impact;
- Electron sandbox/CSP impact;
- package size impact;
- tests proving `electron-builder` asar unpack and `after-pack` validation still pass.

The current life-science preview workers intentionally leave `sciforge.distribution` unset and are absent from `scripts/release-worker-manifest.cjs` until that audit is done.
