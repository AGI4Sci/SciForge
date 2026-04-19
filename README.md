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

## Build

```bash
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
