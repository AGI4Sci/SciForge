# SciForge plug-in services

Optional service modules. Model Router owns translator roles directly. Paper Radar now lives in the
`@sciforge/domain-paper-radar` domain package, backed by the `@sciforge/paper-radar` service/core
without a standalone plug-in or agent-protocol boundary.

> The scientific-modality translator now lives as a **worker** at
> [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router) (port 3898,
> `POST /modality/translate`, four native-to-text experts), not as a plug-in. It is configured
> inside Model Router as `translators.scientific`; the GUI sidecar may convert
> `SCIFORGE_SCIMODALITY_SERVICE_URL` / `SCIFORGE_SCIMODALITY_SERVICE_TOKEN` into that router role.

Paper Radar is a separate UI extension service, not a Model Router translator.

## Versioning-group DSH backend plugins

Runtime-plugin backends for the versioning domain group
(`feat/plugin-versioning-modules`, baseline `main @ e975be58`). Each plugin is a self-contained
DSH (detached session host) backend loaded through `ProcessExtensionHost`, with the cordis
`inject: ['tools']` / `apply(ctx, config)` shape. Tool arguments carry an explicit
`workspaceRoot` because the host does not forward caller identity into plugins (gap G1).
Shared protocol gaps and their current status are tracked in [GAPS.md](./GAPS.md).

| Plugin | Static counterpart | Tests | Notes |
| --- | --- | --- | --- |
| [`git-checkpoints`](./git-checkpoints) | `packages/domains/git-checkpoints` (main) | 21 | Git port fixture in DSH env; real `version-control.*` bridge blocked by G1. Auto-capture needs G2 turn events. |
| [`change-inspector`](./change-inspector) | `packages/domains/change-inspector` (main) | 32 | Snapshot-producing core; broker resource wrapping stays in the host thin layer (G3 option a). |
| [`research-checkpoints`](./research-checkpoints) | `packages/domains/research-checkpoints` (main) | 97 | Fail-closed artifact port fixture in DSH env (G1); turn-boundary forwarding blocked by G2. |
| [`scientific-plotting`](./scientific-plotting) | `packages/workers/scientific-plotting` (main) | 18 | `@napi-rs/canvas` stays external and loads in the isolated runner — G4 verified. Port-less engine degradation matches the static package contract. |

`research-dossier` is **not** part of this plugin group: its package
(`packages/domains/research-dossier`) has no main-process entrypoint — `sciforge.domain.json`
declares only a `renderer` entrypoint and `contract.ts` is just the right-panel activation
payload. There is no backend surface to migrate; its runtime pluginization belongs to the
renderer-side workstream.

Each plugin ships the same test battery: source-fidelity against the static sources, static
tests moved verbatim, capability-parity (static factory vs plugin operations over scripted
shared fakes), baseline goldens, DSH tool-surface checks, real `ProcessExtensionHost`
subprocess loading, and a clean-state handle audit.

## How the app uses them

- **Vision**: Model Router translates image inputs via its configured `translators.vision` provider.
  There is no standalone vision plug-in service; the router is the only vision translation chain.
- **Scientific**: now a worker — see
  [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router). Gated inside
  Model Router by the `translators.scientific` profile role; deployment env is only a sidecar/CLI
  input for generating that role.
  GUI, local runtime, Codex, and Claude pass workspace-local `input_object` refs; only Model Router reads explicit
  scientific files and calls the worker
  (which calls the GPU expert-translator). When unset or unreachable, Model Router falls back to
  readable raw file text where safe — no runtime-side service calls.
- **Paper Radar**: enabled from `Plugins → Extensions`. The Workbench only shows the Paper Radar
  right panel after the extension key is installed. UI and agent actions share the domain package's
  Capability Broker route, which calls the `@sciforge/paper-radar` service/core.

## Run a plug-in

```bash
npm --workspace @sciforge/paper-radar run test                   # worker/core tests

# The scientific-modality translator is now a worker (packages/workers/sci-modality-router):
npm --workspace @sciforge/sci-modality-router run start          # :3898
npm --workspace @sciforge/sci-modality-router run test           # stubbed unit tests
```

The scientific expert provider behind `@sciforge/sci-modality-router` is deployed separately after
license review; see the worker deployment docs.
