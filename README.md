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

For workspace-backed chat records, also start the local writer:

```bash
npm run workspace:server
```

The workspace path is edited from the left Resource Explorer panel or the Settings dialog. BioAgent writes structured state under:

```text
<workspace>/.bioagent/
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

The chat panel prefers AgentServer streaming via:

```text
POST http://127.0.0.1:18080/api/agent-server/runs/stream
```

Streaming envelopes are rendered in the event panel while the run is active. The composer stays editable during a run; extra user guidance is queued visibly and automatically sent as follow-up turns after the active run completes. This keeps the UI responsive today and leaves room for true backend mid-run message injection later.

## Chat Records

Chat state is stored as `bioagent.workspace.v2` in localStorage and can also be mirrored into the selected workspace directory. The active workspace state includes:

- active sessions per Agent
- archived sessions created by new-chat and delete-chat actions
- per-session version snapshots with reason, timestamp, counts, checksum, and snapshot payload
- artifacts and execution records generated from Agent responses

The workspace writer splits those records into:

```text
.bioagent/workspace-state.json
.bioagent/sessions/*.json
.bioagent/artifacts/*.json
.bioagent/versions/*.json
.bioagent/config.json
```

This keeps BioAgent aligned with AgentServer-style session and artifact bookkeeping while MCP and skills resources remain user-configured later.

The left Resource Explorer can list the selected workspace and supports file/folder creation, rename, delete, refresh, copy path, and double-click folder navigation through the local workspace writer.

## Runtime Settings

Use the top-right Settings button to configure:

- AgentServer base URL
- workspace writer URL
- workspace path
- model provider
- model base URL
- model name
- API key
- request timeout

Those values are kept in localStorage and mirrored to `<workspace>/.bioagent/config.json`. BioAgent passes model provider/name/base URL/API key to AgentServer per request through `runtime`, so AgentServer can switch model connection without hard-coded frontend constants.

## Demo vs Real Mode

Demo seed data lives in `ui/src/demoData.ts` and is labeled in the UI as demo/fallback data. Runtime agent artifacts are labeled separately and take priority whenever an AgentServer response provides matching `artifactRef`, `dataRef`, or artifact `type`.

Current real-mode boundary:

- Literature and structure profiles are marked `agent-server`.
- Omics and knowledge profiles are `demo-ready` until their real tools are connected.
- AgentServer must be running at `http://127.0.0.1:18080` for real chat responses.
- `ui/src/api/localAdapters.ts` provides explicit `record-only` adapters for all 4 agents. Demo-ready agents use them directly; agent-server agents expose them as a visible fallback when AgentServer fails.

## Build

```bash
npm run test
npm run smoke:fixtures
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
