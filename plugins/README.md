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
