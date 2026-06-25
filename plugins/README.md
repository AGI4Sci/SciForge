# SciForge plug-in services

Standalone, **plug-and-play** services. Each service owns its own `package.json` as an npm
workspace and talks to the desktop app through HTTP rather than renderer imports. Model Router
translation services stay fail-open when absent; UI extensions such as Paper Radar are opt-in from
the Plugins page and start their local service only when the enabled UI panel calls it.

| Plug-in | Port | Endpoint | Translates | Upstream model(s) |
|---|---|---|---|---|
| [`vision-router-service`](./vision-router-service) | 3899 | `POST /vision/translate` | image / video frame → text | Qwen3.7-Plus (cloud, OpenAI-compatible) |
| [`paper-radar-service`](./paper-radar-service) | 3901 | `GET /health`, `POST /sync/profile`, `POST /digest` | paper metadata → ranked daily digest | arXiv OAI-PMH + bioRxiv API |

> The scientific-modality translator now lives as a **worker** at
> [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router) (port 3898,
> `POST /modality/translate`, four native-to-text experts), not as a plug-in. It is still gated
> inside Model Router by `SCIFORGE_SCIMODALITY_SERVICE_URL`.

Translation plug-ins follow the same contract: **translate-only** (return evidence/`ServiceResult`,
never a final answer), auto-detect input, own their own retry/robustness, and redact secrets from
traces. Paper Radar is a separate UI extension service, not a Model Router translator.

## How the app uses them

- **Vision**: the model router translates image inputs via its `translators.vision` provider
  (Qwen). The `vision-router-service` packages that same translate-only behavior as a standalone
  service for reuse outside the router.
- **Scientific**: now a worker — see
  [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router). Gated inside
  Model Router by `SCIFORGE_SCIMODALITY_SERVICE_URL`. GUI/Kun/Codex pass workspace-local
  `input_object` refs; only Model Router reads explicit scientific files and calls the worker
  (which calls the GPU expert-translator). When unset or unreachable, Model Router falls back to
  readable raw file text where safe — no runtime-side service calls.
- **Paper Radar**: enabled from `Plugins → Extensions`. The Workbench only shows the Paper Radar
  right panel after the extension key is installed, and the Electron main process starts
  `paper-radar-service` on demand for Paper Radar IPC calls in development builds.

## Run a plug-in

```bash
npm --workspace sciforge-vision-router-service run start         # :3899
npm --workspace sciforge-paper-radar-service run start           # :3901
npm --workspace sciforge-paper-radar-service test                # service e2e/unit tests

# The scientific-modality translator is now a worker (packages/workers/sci-modality-router):
npm --workspace @sciforge/sci-modality-router run start          # :3898
npm --workspace @sciforge/sci-modality-router run test           # stubbed unit tests
```

The scientific expert models themselves (the GPU "provider" behind `sci-modality-router-service`)
are deployed separately on the GPU server — see the GPU deployment docs.
