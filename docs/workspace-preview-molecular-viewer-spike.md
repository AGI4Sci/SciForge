# Workspace Molecular Viewer Dependency Spike

Date: 2026-07-08

## Scope

The workspace preview plugin system needs a PyMOL-like molecular viewer for life-science files. This spike checks the first dependency choice for a renderer plugin that can observe, manipulate, select, annotate, and export molecular structures without weakening the rest of the workspace preview contract.

The first implementation target is interactive structure viewing for `.pdb`, `.cif`, `.mmcif`, `.sdf`, `.mol`, `.mol2`, and `.xyz`. Trajectory (`.xtc`, `.dcd`, `.trr`) and density map (`.mrc`, `.ccp4`) support remains a later large-asset/tile transport task.

## Current Package Snapshot

Collected with:

```sh
npm view molstar version license main module types dist.unpackedSize dependencies --json
npm view 3dmol version license main module types dist.unpackedSize dependencies --json
npm view ngl version license main module types dist.unpackedSize dependencies --json
```

| Package | Version | License | Unpacked size | Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| `molstar` | `5.10.1` | MIT | ~78 MB | large app/toolkit package | Best scientific depth, but brings server/UI-oriented dependencies such as `express`, `compression`, `swagger-ui-dist`, `rxjs`, and video encoder dependencies. Needs careful bundle and release audit before shipping in the renderer. |
| `3dmol` | `2.5.5` | BSD-3-Clause | ~21 MB | browser viewer bundle with types | Smaller and closer to an embeddable viewer. Good first target for bounded PDB/CIF/SDF/MOL/XYZ viewing, selection, style switching, and simple structure manipulation. |
| `ngl` | `2.4.0` | MIT | ~23 MB | UMD/ESM viewer package | Depends on `molstar` and `three`; useful fallback, but less attractive as a first dependency because it pulls another molecular stack underneath. |

## Renderer / Electron Constraints

- The current renderer CSP in `src/renderer/index.html` has `script-src 'self'` and no `worker-src` directive.
- Viewer libraries that use Web Workers, dynamic WASM, or blob workers need a targeted CSP update such as `worker-src 'self' blob:` and possibly a carefully reviewed WASM script policy.
- The first plugin should mount through a plain DOM container from React 19 rather than owning React state. The renderer wrapper should create and dispose the viewer instance in an effect-like boundary and keep selection state in the shared workspace preview session.
- WebGL must stay unframed inside the preview host content region, not inside nested decorative cards. Shared toolbar/inspector chrome owns actions, while the canvas owns manipulation.

## Recommendation

Use `3dmol` for the first molecular viewer plugin milestone.

Reasons:

- It is the smallest viable embeddable option among the checked packages.
- It does not require introducing Mol*'s larger app/server-shaped dependency tree in the first renderer migration.
- It covers the first milestone interactions: rotate, zoom, style switching, chain/residue/ligand selection, and bounded structure manipulation. Interactive measurement, advanced coloring, screenshots, and PNG export remain V2 capabilities that need explicit viewer-state and audit decisions.
- It lets the worker package stay responsible for bounded structure summaries while the renderer plugin handles manipulation and visual state.

Keep `molstar` as the second-stage candidate for advanced mmCIF, assemblies, trajectories, density maps, and richer scientific representations after the large-asset transport layer supports tiles/cache artifacts/object URLs. Treat `ngl` as fallback only if `3dmol` fails Electron/CSP testing, because its package currently depends on `molstar`.

## Implementation Gates

- Add the dependency only when `workspace-preview/molecular` renderer plugin wiring starts.
- Before merging the dependency, run the release package audit and record license/side-effect evidence.
- Add CSP tests with the narrowest worker/WASM policy needed by the chosen viewer.
- Verify desktop and localhost `5173` behavior with Playwright screenshots and a canvas-pixel nonblank check.
- Keep structure parsing in `@sciforge/workspace-molecular`; do not put file parsing or workspace file access into the renderer viewer.
