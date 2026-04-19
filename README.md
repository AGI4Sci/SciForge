# BioAgent

This repository has been reset to keep only:

- The integrated React web UI in `ui/`
- Product/design documentation in `docs/`
- Lightweight frontend project config

The current UI merges the best parts of the two early prototypes:

- `bioagent-platform.jsx`: product structure, workbench layout, pipeline, notebook, and alignment workspace.
- `bioagent-glm.html`: polished dark BioAgent visual language, evidence/claim tags, agent cards, and scientific canvas visualization style.

## Run The UI

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

## AgentServer Mode

The workbench chat panel calls AgentServer directly:

```text
POST http://127.0.0.1:18080/api/agent-server/runs
```

Start AgentServer first if you want real agent replies. If it is unavailable, BioAgent keeps the user message locally and shows a clear connection error instead of silently falling back to mock output.

BioAgent keeps the frontend protocol in `ui/src/agentProfiles.ts`:

- per-agent AgentServer id and mode
- native tools and fallback tools
- input contracts
- expected artifact schemas
- default UIManifest slots
- execution defaults

Agent replies should return natural language plus optional structured JSON with `claims`, `uiManifest`, `executionUnits`, and `artifacts`. The UI never executes generated UI code; it renders only registered components.

## Demo vs Real Mode

Demo seed data lives in `ui/src/demoData.ts` and is labeled in the UI as demo/fallback data. Runtime agent artifacts are labeled separately and take priority whenever an AgentServer response provides matching `artifactRef`, `dataRef`, or artifact `type`.

Current real-mode boundary:

- Literature and structure profiles are marked `agent-server`.
- Omics and knowledge profiles are `demo-ready` until their real tools are connected.
- AgentServer must be running at `http://127.0.0.1:18080` for real chat responses.

## Build

```bash
npm run test
npm run typecheck
npm run build
```

## Kept Source

```text
docs/
ui/
package.json
tsconfig.json
vite.config.ts
PROJECT.md
README.md
```
