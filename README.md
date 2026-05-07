# SciForge

SciForge is a scenario-first AI4Science workbench for turning messy research questions into auditable scientific artifacts, executable workspace tasks, and reusable skills.

Instead of treating every agent response as plain chat, SciForge organizes work around research scenarios: literature evidence review, molecular structure exploration, omics analysis, biomedical knowledge graphs, and custom scenario packages authored by users. Each run can produce structured artifacts, execution units, evidence claims, UI manifests, logs, and recovery diagnostics.

> Status: active research prototype. The project is designed for local workspace-backed experimentation, transparent failure states, and self-evolving skills rather than polished black-box automation.

## Why SciForge

- **Scenario-first research workflows**: start from a domain scenario instead of a blank prompt.
- **Structured scientific artifacts**: reports, evidence matrices, paper lists, graphs, omics tables, figures, execution logs, and notebook timelines.
- **Auditable execution**: every real task can include `ExecutionUnit` records with code refs, stdout/stderr refs, output refs, runtime profile, and repair history.
- **AgentServer-backed generation**: normal user-facing reasoning is delegated to the configured agent backend; SciForge handles contracts, routing, persistence, recovery, and display.
- **Self-evolving skills**: workspace-local task code can be generated, repaired, verified, and later promoted into reusable skill packages.
- **Component registry UI**: artifacts render through registered scientific components rather than arbitrary generated UI code.
- **Failure is first-class**: missing inputs, backend errors, context-window pressure, schema failures, and repair hints are preserved for the next turn.

## Visual Tour

The repository does not currently include final marketing screenshots. These prompts are intentionally placed here so generated images can be added later.

```text
IMAGE PROMPT: A crisp product screenshot mockup of SciForge, a dark scientific workbench UI with a left workspace file explorer, center scenario chat, and right structured results panel showing an evidence matrix, execution units, and artifact cards. Style: realistic SaaS app screenshot, subtle teal/coral accents, dense but readable research UI, no fake brand logos, 16:9.
```

```text
IMAGE PROMPT: Editorial diagram showing the SciForge workflow: Research Scenario -> AgentServer reasoning -> workspace task code -> artifacts and ExecutionUnits -> registered scientific UI components -> reusable skill promotion. Style: clean technical architecture diagram, white background, precise labels, no cartoon characters.
```

```text
IMAGE PROMPT: Scientific artifact gallery for SciForge: paper cards, claim-evidence matrix, molecular 3D structure panel, volcano plot, UMAP plot, knowledge graph, notebook timeline. Style: premium product collage, dark UI panels, high legibility, realistic data visualization shapes, 16:9.
```

## What You Can Build With It

- Literature evidence reviews with paper lists, claim/evidence maps, conflict tables, and research reports.
- Structure exploration workflows with molecule viewers, ligand/site summaries, and provenance.
- Omics differential exploration with volcano plots, heatmaps, UMAPs, tables, and run logs.
- Biomedical knowledge graph workflows with claims, edges, evidence refs, and update history.
- Custom scenario packages that combine skills, tools, artifact schemas, UI components, and failure policies.

## Quick Start

Requirements:

- Node.js 20+
- npm
- A local workspace directory where SciForge can write `.sciforge/` state
- Optional but recommended: an AgentServer endpoint for real agent-backed task generation

Install and run the full local app:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

`npm run dev` starts the Vite UI and the workspace runtime used by scenario chat. To run only the UI:

```bash
npm run dev:ui
```

If you start the UI separately and still need workspace-backed runs or persisted chat state:

```bash
npm run workspace:server
```

## Configure Your Workspace

Open Settings in the app and configure:

- `Workspace Path`: where `.sciforge/` state, task files, logs, artifacts, and scenario packages are stored.
- `AgentServer Base URL`: the backend used for agent reasoning and task generation.
- `Agent Backend`: Codex, OpenTeam Agent, Claude Code, Gemini, Hermes, OpenClaw, or another configured backend path.
- Model provider, base URL, model name, API key, request timeout, and context-window budget.

SciForge writes workspace state under:

```text
<workspace>/.sciforge/
```

Common generated paths include:

```text
<workspace>/.sciforge/workspace-state.json
<workspace>/.sciforge/sessions/*.json
<workspace>/.sciforge/artifacts/*.json
<workspace>/.sciforge/tasks/*
<workspace>/.sciforge/task-results/*
<workspace>/.sciforge/logs/*
<workspace>/.sciforge/scenarios/*
```

## Core Concepts

### Scenario

A scenario describes the research job, input contract, expected artifact types, available skill domain, UI component policy, and failure behavior. Built-in presets currently include:

- `literature-evidence-review`
- `structure-exploration`
- `omics-differential-exploration`
- `biomedical-knowledge-graph`

Built-in specs live in:

```text
src/ui/src/scenarioSpecs.ts
```

### Artifact

Artifacts are structured outputs such as `research-report`, `paper-list`, `evidence-matrix`, `knowledge-graph`, `omics-differential-expression`, or `structure-summary`. They can be rendered by registered UI components and reused in later turns by reference.

### ExecutionUnit

An `ExecutionUnit` records what actually ran: tool, code ref, input/output refs, stdout/stderr refs, status, runtime profile, route decision, failure reason, recovery hints, and provenance. This is the backbone of reproducibility.

### UIManifest

The UI manifest selects registered components for artifacts. The agent can request views, but rendering stays inside the known component registry. Unknown components fall back to an inspector instead of executing arbitrary UI code.

### Skill

Skills are capability contracts and task knowledge. SciForge can generate workspace-local task code for a run, repair it, validate it, and later promote stable behavior into reusable skills after user confirmation.

## Typical Workflow

1. Pick a scenario or create a scenario package.
2. Ask a research question in the chat.
3. SciForge builds a compact handoff with scenario, artifacts, refs, selected tools, and runtime policy.
4. AgentServer reasons about the request and either returns a direct structured answer or generates workspace task files.
5. SciForge runs the task, validates the payload, persists artifacts/logs/refs, and renders results.
6. If something fails, the failure reason and recovery context are saved for the next turn.
7. Successful reusable behavior can be promoted into a skill/package candidate.

## Repository Layout

```text
src/ui/                  React + Vite workbench
src/runtime/             Workspace server, gateway, task runner, skill registry
src/runtime/gateway/     Runtime gateway modules for payloads, context, diagnostics, repair
src/shared/              Shared contracts for handoff, verification, capabilities
packages/                Design system, tools, object refs, UI components, skills
tests/smoke/             Smoke tests and contract checks
tests/deep/              Longer regression workflows
docs/                    Product, architecture, authoring, and test artifacts
workspace/               Default local runtime workspace, ignored by git
PROJECT.md               Living task board and engineering principles
```

## Scenario Builder And Library

SciForge can compile scenario packages from selected skills, tools, artifact schemas, UI components, validation gates, and failure policies.

Published packages are written to:

```text
<workspace>/.sciforge/scenarios/<scenario-id>/
```

Package files include:

```text
scenario.json
skill-plan.json
ui-plan.json
validation-report.json
quality-report.json
tests.json
versions.json
package.json
```

Authoring guide:

```text
docs/ScenarioPackageAuthoring.md
```

Example package:

```text
docs/examples/workspace-scenario/
```

## Runtime Architecture

```text
Scenario / prompt / workspace refs
  -> SciForge gateway contract normalization
  -> AgentServer reasoning or workspace task generation
  -> task execution / repair / validation
  -> ToolPayload
  -> artifacts + ExecutionUnits + claims + UIManifest
  -> registered scientific UI components
```

Key endpoints during local development:

```text
POST http://127.0.0.1:5174/api/sciforge/tools/run
POST http://127.0.0.1:18080/api/agent-server/runs
POST http://127.0.0.1:18080/api/agent-server/runs/stream
```

If the workspace runtime or AgentServer is unavailable, SciForge records the user message and shows a real connection error. It does not fabricate demo artifacts to make a failed run look successful.

## Structured Response Shape

SciForge task responses are normalized into a `ToolPayload`:

```json
{
  "message": "Short user-facing summary",
  "confidence": 0.86,
  "claimType": "inference",
  "evidenceLevel": "database",
  "claims": [],
  "artifacts": [],
  "executionUnits": [],
  "uiManifest": []
}
```

Common registered components include:

- `report-viewer`
- `paper-card-list`
- `evidence-matrix`
- `execution-unit-table`
- `notebook-timeline`
- `network-graph`
- `molecule-viewer`
- `volcano-plot`
- `heatmap-viewer`
- `umap-viewer`
- `data-table`
- `unknown-artifact-inspector`

## Development

Run the main checks:

```bash
npm run typecheck
npm run test
npm run smoke:all
npm run build
```

Full fast verification:

```bash
npm run verify
```

Long-file governance:

```bash
npm run smoke:long-file-budget
```

Runtime gateway focused smoke:

```bash
npm run smoke:runtime-gateway-modules
```

## Engineering Principles

The short version:

- Normal user requests should be handled by the configured agent backend, not preset local templates.
- Real work should produce artifacts, logs, refs, and execution units.
- Failures must preserve enough context for repair.
- Long files must be split by responsibility, not by mechanical `part1` / `part2` chunks.
- Generated files need explicit exemptions.
- Scenario contracts, artifact schemas, and UI components should remain reusable across domains.

The living task board and stricter project rules are in:

```text
PROJECT.md
```

## Contributing

Good first contributions:

- Add or improve scenario package examples.
- Add fixtures for scientific artifact rendering.
- Improve smoke coverage for runtime contracts.
- Add documentation for a specific skill or package.
- Split remaining watch-list files before they cross long-file thresholds.

Before opening a PR, run:

```bash
npm run typecheck
npm run test
npm run smoke:long-file-budget
```

For UI-heavy changes, also run the app locally and inspect the affected scenario/results view.

## License

License information has not yet been finalized in this repository. Add a `LICENSE` file before distributing SciForge as a packaged product or dependency.
