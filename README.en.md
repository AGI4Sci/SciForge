<p align="center">
  <img src="src/asset/img/sciforge.png" width="96" alt="SciForge icon">
</p>

# SciForge

[简体中文](./README.md) | English

> **Let agents do more. Keep humans in command.** SciForge is the human-in-the-loop intervention panel and research-state/evidence capture layer for scientific work. As agents get stronger, the panel gets thinner—but human intent, judgment, and accountability remain.

[Website](https://sciforge.ai) | [Download](https://github.com/AGI4Sci/SciForge/releases) | [Paper](./paper/sciforge-report.pdf) | [Usage Wiki](./docs/wiki/README.md)

[![GitHub release](https://img.shields.io/github/v/release/AGI4Sci/SciForge?label=github)](https://github.com/AGI4Sci/SciForge/releases)
[![License](https://img.shields.io/github/license/AGI4Sci/SciForge)](./LICENSE)

SciForge is a local desktop control plane for long-lived scientific and engineering work. It uses SciForge Runtime, Codex app-server, or Claude Code CLI as selectable execution partners: the runtime reads workspaces, calls tools, runs experiments, and produces artifacts; SciForge brings researchers in for goal-setting, evidence review, comparison, risk handling, and release decisions.

SciForge does not replace Codex or Claude Code, and it is not a new foundation model. It adds scientific-object routing, research context, evidence/provenance capture, artifact review, and governed intervention around mature runtimes.

The goal is not to ship another chat wrapper. SciForge is meant to be an auditable research-agent operating surface: model calls go through Model Router, agents work on real workspaces, research objects stay attached to evidence and artifacts, and long-running tasks can move from exploration to implementation to review. SciForge Runtime's high-token-ROI loop keeps the same context budget focused on requirements, code, decisions, and results instead of repeated prefixes, giant tool catalogs, or runaway output.

---

<p align="center">
  <a href="src/asset/img/codemode.png">
    <img src="src/asset/img/codemode.png" width="680" alt="SciForge Code mode illustration">
  </a>
</p>

## Research showcases

The paper records eight prototype workflows with public audit repositories. Four flagship examples:

| Showcase | What it demonstrates | Public artifacts |
| --- | --- | --- |
| **Agentic research sprint** | 132 stages and 199+ commits for PI-controlled meiosis gene discovery. | [scenario-01-research-sprint](https://github.com/AGI4Sci/scenario-01-research-sprint) |
| **AI-guided protein design** | ProteinMPNN design with Boltz-2 / ESMFold structural checks. | [sciforge-de-novo-protein-demo](https://github.com/kaiwinYao1/sciforge-de-novo-protein-demo) |
| **AI-guided molecular design** | 135 filtered candidates and 36 docking evaluations with SAR traceability. | [molclaw](https://github.com/AGI4Sci/molclaw) |
| **Genome-to-BGC discovery** | antiSMASH, MIBiG, and BiG-SCAPE evidence cards over 430 BGC regions. | [scenario-bgc-genome-discovery](https://github.com/wenne-kwj/scenario-bgc-genome-discovery) |

See the [paper](./paper/sciforge-report.pdf) for all eight cases and interface examples. These are research prototypes and reproducible traces—not claims of completed experimental validation or a replacement for scientific judgment.

## Why SciForge Runtime Delivers High Token ROI

SciForge Runtime makes token economy the default behavior of the agent loop, not a cleanup step after the fact. It does more than compress text: before each model call, it decides which information is worth entering context.

| SciForge Runtime advantage | Where the ROI comes from |
| --- | --- |
| **Cache-first agent loop** | Stable system prompts, tool schemas, and immutable prefixes make DeepSeek-native cache hits more likely, so long sessions do not keep paying for the same background. |
| **Tool context on demand** | When MCP catalogs are large, SciForge Runtime can search for relevant tools first, then describe and call the target tool instead of sending every tool schema on every turn. |
| **Context hygiene** | Long tool results, long arguments, base64 payloads, repeated tool loops, and low-value history are bounded while code, paths, errors, decisions, and open tasks are preserved. |
| **Visible usage payback** | Runtime telemetry tracks cache hit/miss, token usage, and estimated savings; the GUI surfaces Token economy savings so cost return is observable over time. |

The result: SciForge Runtime is built for real project work with long tasks, long sessions, and many tools. It keeps the model's attention on high-value context, helping the same API budget produce more useful progress.

## What We Built

- A desktop app around SciForge Runtime, with default runtime auto-start and management.
- A full chat workbench with multiple sessions, streaming output, history, interruption, and resend flows.
- Local workspace integration so the agent can read, edit, and create files in real projects.
- Change review surfaces that make every file modification visible and inspectable.
- First-run onboarding, settings, language/theme/font controls, notifications, local logs, and update entry points.
- Graphical Skill and MCP management so users can extend the agent without hand-editing every config file.
- Connect phone automation with Feishu / Lark / WeChat integration, dedicated IM agents, local webhook / relay support, and scheduled tasks.
- A dedicated Write workbench with writing spaces, a Markdown file tree, live editing/preview, inline completion, and selection-based inline agent actions.
- Research-native workers for scientific multimodal translation, Paper Radar, Evidence DAG, controlled plotting, and research search.
- New requirement drafts, plans, thread todos, long-running goals, and code review so tasks can move from idea to execution to review.
- Pre-built macOS, Windows, and Linux installers; source builds remain available.

## Highlights

- **Desktop chat workbench**: multi-session chat with streamed replies, reasoning, tool calls, approval requests, and file changes in one place.
- **Project workspaces**: choose a local directory for each task, organize sessions by workspace, preview files, open files in your editor, and pick Git branches.
- **New requirements**: draft background, goals, and acceptance criteria; ask Requirement AI to clarify missing questions or research options; then generate an implementation plan.
- **Plans and todos**: `/plan` and New requirement both create editable plan files, while the right-side Plan panel syncs thread todos for trackable execution.
- **Goals**: `/goal` sets a long-running objective for the current thread, with pause, resume, clear, and complete states so the agent can keep working toward the same outcome.
- **Code review**: `/review` can inspect current uncommitted changes, a base branch diff, a commit, or custom review instructions, with findings shown as review cards.
- **Side conversations and thread control**: `/btw` opens a context-inheriting side conversation; threads also support compact, fork, archive, and restore flows.
- **Change review**: inline diffs and a side review panel help you understand exactly what the agent changed.
- **Controlled permissions**: choose read-only, workspace-write, full-access, or external sandbox modes, and decide when tool calls require approval.
- **Managed runtime**: use the bundled SciForge Runtime by default, point the app at your own
  local runtime executable, or explicitly select Codex app-server as an optional runtime.
- **Skill and MCP support**: create Skills, edit MCP config, add common tools, and open the related folders from the UI.
- **Research search**: the `research_search` MCP worker supports arXiv, bioRxiv, Europe PMC, Semantic Scholar, and optional CNS web search.
- **Feature-flagged agent extensions**: SciForge Runtime can enable MCP, web fetch/search, Skills, standalone CLI use, image attachments, cross-session memory, and delegated subagents by config; Settings shows the runtime-reported capability and diagnostics state.
- **Connect phone**: run a background agent alongside normal chat, with current support for Feishu / Lark / WeChat, IM webhook / relay flows, and scheduled tasks.
- **Scheduled tasks**: create one-time, daily, interval, or manual tasks with their own workspace, model, and reasoning effort so SciForge Runtime can run while the computer is awake.
- **Write mode**: manage `~/.sciforge/write_workspace` and custom writing spaces, browse Markdown files, use live Markdown editing, preview relative images, get Model Router-backed short completion / inspiration completion with optional cross-document BM25 + keyword retrieval, export the current document as `HTML / PDF / DOC / DOCX`, and invoke the writing assistant directly from selected text.
- **High token ROI**: SciForge Runtime keeps prompt prefixes stable, tracks DeepSeek-native cache hit/miss fields, compacts context and tool output, and uses MCP search to discover tools progressively so tokens stay focused on requirements, code, decisions, and results.
- **Friendly first launch**: choose language, then configure the local Model Router runtime key, public model alias, and member provider profile.
- **Local-first**: preferences, sessions, logs, and runtime config stay on your machine; runtime model calls enter the local Model Router, which uses the provider credentials you configure there.
- **English and Chinese UI**: switch languages from Settings at any time.
- **Cross-platform use**: macOS `.dmg/.zip`, Windows `.exe`, and Linux `.AppImage`; source builds remain available.

## Runtime: SciForge Runtime By Default, Codex Optional

The default local agent runtime in SciForge is
**SciForge Runtime** (the bundled local runtime package), a self-contained
TypeScript package that boots a local HTTP/SSE server as the
stable boundary between the GUI and the SciForge Runtime agent loop. Advanced
users can explicitly select **Codex app-server**, which is managed by
the main process through `codex app-server --listen stdio://`.

SciForge Runtime is not a temporary chat shell. It is the local runtime layer
that carries longer context, richer tools, and sustained project collaboration.

SciForge Runtime's operating principle is to raise the ROI of every token. The
user's context budget should go toward requirements, code, decisions,
and results, not repeated tool schemas, runaway tool output, invalid
history, or prefixes that could have been reused from cache. It is
optimized less for one-off questions and more for real workflows that
read and write projects, call tools repeatedly, and carry context over
long sessions.

SciForge Runtime fuses a design that has been battle-tested in the
wild:

- **The cache-first agent loop uses Reasonix as a design reference**: immutable prompt prefix (with sha256 fingerprint), append-only session log, bounded TTL/LRU cache, inflight tracking with guaranteed cleanup, mid-turn steering queue, context compaction that preserves pinned constraints, and cache/usage telemetry. Reasonix is reference/inspiration only in this project; SciForge Runtime is independently implemented, with no Reasonix source, tests, or assets copied.
- **Token economy and tool-context optimization**: SciForge Runtime stabilizes system prompts and tool schemas, reads DeepSeek-native cache hit/miss fields, bounds long tool results, long arguments, base64 payloads, and repeated tool loops, and can use `mcp_search` / `mcp_describe` / `mcp_call` to discover MCP tools progressively when a tool catalog is too large to advertise all at once.

> Thanks to the Reasonix team for sharing runnable references
> that helped validate this cache-first runtime direction. This repository
> treats Reasonix as a design reference only and does not include Reasonix
> source code, test fixtures, or assets. The full design rationale
> and reference map live in
> [`docs/local-runtime-architecture.md`](docs/local-runtime-architecture.md).

If you want the dedicated write-up for cache behavior, including
stable prefixes, tool schema canonicalization, DeepSeek native
hit/miss accounting, tool-pair healing, and validation strategy, see
[`docs/local-runtime-cache-optimization.md`](docs/local-runtime-cache-optimization.md).

SciForge Runtime's larger agent capabilities are controlled by feature flags:
`capabilities.mcp` connects third-party MCP servers,
`capabilities.web` exposes `web_fetch` / `web_search`,
`capabilities.skills` discovers package roots declared by `skill.json`
and reads their `SKILL.md` files as package content,
`capabilities.attachments` enables image attachments with text-model fallback, `capabilities.memory`
enables cross-session recall, and `capabilities.subagents` allows
budgeted delegated child runs. The standalone local runtime CLI can run
without the GUI. The GUI reads `/v1/runtime/info` and
`/v1/runtime/tools` in Settings to show what is actually available.
These capabilities are off by config or limited by model capability
until explicitly enabled; examples and troubleshooting live in
[the SciForge Runtime package README](kun/README.md).

Simplified architecture:

```text
Renderer (React)
  → AgentRuntimeProvider
  → preload: window.sciforge.agentRuntime.*
  → main: AgentRuntimeHost
  → SciForge Runtime adapter → local runtime service (HTTP + SSE)
  → CodexAgentRuntimeAdapter → codex app-server (JSON-RPC stdio)
```

Renderer consumes only neutral threads, turns, events, and capabilities. SciForge Runtime is
the default runtime, and Codex is used only after explicit user selection. The old
renderer bypasses have been removed, and renderer-specific `codex:*` IPC has also
been removed.
The full contract is documented in
[`docs/agent-runtime-contract.md`](docs/agent-runtime-contract.md).

Settings live under **Settings → Agent runtime**: binary path, port,
auto-start, Model Router base URL, runtime API key, public model alias,
data dir, model, approval policy, sandbox mode, and the insecure switch.
SciForge Runtime settings live under `agents.sciforge`, and `agents.codex`
settings may be added.

The full endpoint list, CLI flags, environment variables, data dir
layout, and SSE event schema are documented in
[the SciForge Runtime package README](kun/README.md).

## Who It Is For

- Developers who want a desktop agent to work on real codebases without living in a terminal.
- Teams that need to see what the agent did, which files changed, and which operations required approval.
- Users who maintain multiple projects or long-running conversations and want reusable Skill/MCP setup.
- Anyone who wants a local desktop workbench with DeepSeek or OpenAI-compatible providers managed through Model Router.

---

## Workbench And Entry Points

SciForge is centered on two main workbenches, **Code** and **Write**,
with additional entry points for **Connect phone**, **Scheduled tasks**,
and **Plugins / Skills / MCP**. They share the same AgentRuntime path and
settings choice; SciForge Runtime is the default, and Codex is used only after explicit
selection. Sessions, workspaces, and layouts stay separate so you can switch by
task.

### Code Mode

The development workbench for real codebases: bind a local project directory, read and edit files, run commands, and review changes.

<p align="center">
  <img src="src/asset/img/codemode.png" alt="SciForge Code mode" width="860">
</p>

- Organize multiple agent sessions by workspace, with streamed reasoning, tool calls, and file changes in one view.
- Inline diffs, a change-review panel, and permission modes from read-only to full access.
- New requirement drafts, `/plan`, the right-side Plan panel, thread todos, and `/goal` help complex work move from clarification to planning to execution.
- `/review`, `/btw`, thread compaction, thread forking, archive, and restore support longer-lived project conversations.
- Quick-start cards for common tasks such as project mapping, bug fixing, implementation planning, and UI polish.

### Write Mode

A dedicated Markdown writing workbench that keeps writing files, save state, and AI assistance separate from Code sessions.

<p align="center">
  <img src="src/asset/img/writemode.png" alt="SciForge Write mode" width="860">
</p>

- Manage `~/.sciforge/write_workspace` plus custom writing spaces from the left file tree; older installs may still have a compatible legacy writing workspace directory.
- Switch between **Live / Source / Split / Preview**; Live keeps Markdown source on the active line and renders the rest.
- Export the current Markdown document from the toolbar as `HTML / PDF / DOC / DOCX`, with best-effort preservation for headings, lists, code blocks, tables, and local images.
- Model Router-backed short and inspiration completion, plus selection-based inline agent actions and a right-side writing assistant for summaries, outlines, and polish.

### Connect Phone

Background automation and IM integration, so the active AgentRuntime can keep handling phone messages and scheduled jobs outside normal desktop chat.

<p align="center">
  <img src="src/asset/img/connect-phone-mode.png" alt="SciForge Connect phone" width="860">
</p>

- Configure dedicated agents for Feishu / Lark / WeChat and other channels, each with its own profile, default model, and workspace.
- Every IM agent gets its own thread, so you can debug replies and tool calls directly in the GUI.
- Local webhook / relay support for team workflows and personal automation.
- Scheduled tasks can run once, daily, on an interval, or manually. Each task
  records the runtime id chosen at creation; SciForge Runtime remains the default thread path,
  while other background runtime paths currently fail closed so Codex thread ids
  are not written into local runtime mappings. Native adapter support can enable Codex
  background execution later.

### Worker And Plug-in Boundaries

SciForge splits research capabilities into workers that can be started, tested,
and audited independently:

| Worker / plug-in | Role |
| --- | --- |
| `model-router` | Text model egress, vision input handling, scientific multimodal worker orchestration, and trace audit |
| `sci-modality-router` | Protein, structure, small-molecule, and single-cell native-to-text translators |
| `evidence-dag` | Claim-evidence DAG, NLI verification, PROV-JSON, and what-if reconcile |
| `paper-radar` | GUI / MCP paper profile, sync, search, ranking, and digest worker; the shared core is owned by the worker package |
| `search` | arXiv, bioRxiv, Europe PMC, Semantic Scholar, and optional CNS web search |
| `scientific-plotting` | Reference figure preparation, style recognition, controlled plotting, scoring, and repair suggestions |
| `image-generation` | Controlled image generation, Canvas review packet to edit intent, and artifact manifests |
| `canvas` | Workspace-local canvas, artifact insertion, annotations, and review packets |
| `ppt-master` | Research presentation output, figure intake, layout QA, and PPTX export |
| `write-assist` | Writing retrieval, PDF text extraction, and bounded writing context |
| `workflow` | Visual workflow execution and Agent-facing MCP facade |
| `schedule` | Scheduled jobs, manual runs, and background Agent dispatch |
| `workspace-intel` / `runtime-inspector` | Workspace understanding, runtime diagnostics, and project inspection |
| `computer-use` | GUI-Owl computer-use service; selects the vision model through Model Router, with GUI status and human approval at the edge |

`computer-use` currently refers to the GUI-Owl service path. The local runtime calls the
GUI-Owl sidecar through `SCIFORGE_CUA_SERVICE_URL`; model traffic goes only through Model
Router, and real mouse/keyboard actions remain gated by GUI-Owl execution settings and human
approval. The old GUI-managed `@sciforge/computer-use` primitive MCP path has been retired.

---

## Install

### Download a Pre-built Package

Download the latest build from [GitHub Releases](https://github.com/AGI4Sci/SciForge/releases):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` or `.zip`, Intel and Apple Silicon |
| Windows | `.exe`, NSIS installer, x64 |
| Linux | `.AppImage`, x64 |

On first launch, configure the local Model Router runtime key, public model alias, and member provider profile. Upstream provider credentials are written only into Model Router configuration.

### Run from Source

For contributors and local development:

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm install
npm run dev
```

Requirements:

- Node.js 20+
- Upstream model provider credentials configured through Model Router
- Internet access during the first dependency install

For slower network access in mainland China, use an npm mirror:

```bash
npm install --registry=https://registry.npmmirror.com
```

---

## First Run

1. Open SciForge.
2. Choose your interface language in the onboarding guide.
3. Configure the local Model Router runtime key, public model alias, and member provider profile.
4. Choose a default workspace, or use the default directory created by the app.
5. Start a new session and describe the task you want the agent to handle.

Typical flow (**Code mode**):

- Pick or switch a workspace from the sidebar.
- Describe the task in the composer.
- Watch reasoning, tool calls, command execution, and file changes as they happen.
- Allow or deny actions that require approval.
- Inspect changes in the review panel before deciding what to do next.

See [Workbench And Entry Points](#workbench-and-entry-points) above for Connect phone and Write details. Quick start:

- **Connect phone**: enable background automation in Settings → add a Feishu / Lark / WeChat connection → configure agent profile, model, and workspace → optionally enable webhook / relay or scheduled tasks.
- **Write**: switch to Write mode → use the default writing space or add a new one → write in the Live editor with completion, selection inline agent, and the right-side writing assistant.

## Usage and Settings

Settings manages:

- Model Router base URL, runtime API key, public model alias, runtime port, and runtime token.
- Auto-start for the local runtime, plus an optional custom runtime executable path.
- Tool approval policy and filesystem access mode.
- Default workspace, language, theme, font size, and completion notifications.
- GUI updates and local error logs.
- Skill creation, Skill folders, and MCP config editing.
- Connect phone automation, Feishu / Lark / WeChat connections, webhook / relay settings, and scheduled tasks.

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift+Enter` | Newline in composer |
| `Ctrl+Enter` | Send message |
| `Esc` | Close a panel or dismiss the current overlay |

## Write Mode Design Notes

Write mode extends SciForge from a code/chat workbench into a long-form writing workspace. Its implementation references interaction ideas from the local `openhanako` project. OpenHanako is reference/inspiration only in this project, with no OpenHanako source, tests, or assets copied.

- Markdown live editing: OpenHanako informed the CodeMirror decorations interaction where the active line stays editable as Markdown source while inactive lines render headings, tasks, images, dividers, and tables through widgets.
- Selection inline agent: OpenHanako informed the selection-capture and floating-input interaction, so selected text can be sent with file path, line numbers, and bounded original text as structured context.
- AI session isolation: Write assistant threads follow the active agent runtime, while the GUI keeps a local write thread registry per writing space and runtime so write conversations do not pollute Code / Connect phone sidebars.
- Text completion: writing completion calls the local Model Router through its Responses-compatible interface, using a Write inline completion public model alias for low-latency ghost text. Short completion uses a short debounce, small token budget, and strict local filtering; inspiration completion uses a longer pause, larger token budget, and only runs at line ends or paragraph boundaries. Before completion, the app builds a short-TTL lightweight index over Markdown / text files in the writing space, retrieves cross-document snippets with BM25 + keyword matching, and injects them as a hidden Markdown comment so terminology, facts, and style stay consistent.

---

## Uninstall

### Windows

- Open Settings -> Apps -> Installed apps, find `SciForge`, and uninstall it.
- Or uninstall from Control Panel -> Programs and Features.
- Or run the uninstaller from the installation directory.

The Windows installer creates Start Menu and desktop shortcuts by default. It does not force a taskbar pin; pin it manually from the Start Menu if you want one.

### macOS

- Move `SciForge.app` from Applications to Trash.
- If macOS blocks the app on first open, right-click it in Finder and choose Open.
- For local unsigned builds, you can remove the quarantine attribute first:

```bash
npm run mac:unquarantine -- '/Applications/SciForge.app'
```

### Linux

- If you built a Linux package from source, delete the related `.AppImage` or installed files.
- If you manually created a desktop entry or shortcut, delete that too.

### Remove Local Data

By default, uninstalling removes the app but keeps local settings, sessions, and runtime config so reinstalling is smoother. For a full cleanup, remove these paths if needed:

| Platform | App data path |
| --- | --- |
| macOS | `~/Library/Application Support/SciForge` |
| Windows | `%APPDATA%\SciForge` |
| Linux | `~/.config/SciForge` |

SciForge Runtime data lives under `~/.sciforge/runtime` or the configured SciForge Runtime data dir; older installs may still have a compatible `~/.sciforge/runtime` directory. Check it before deleting, because it may contain sessions, MCP, or Skill settings you still need.

---

## Updates

- For regular users: check GUI updates in Settings or download the latest installer from [GitHub Releases](https://github.com/AGI4Sci/SciForge/releases).

## Contributing

Contributions are welcome for bug fixes, UI/UX improvements, documentation, localization, build/release workflows, and runtime integration.

Project conventions:

- Day-to-day collaboration and integration happens on `develop`; stable releases land on `master`.
- Start features and fixes from the latest `develop`, preferably on a short-lived feature branch.
- Open pull requests into `develop` by default; maintainers merge reviewed changes into `master` for release.
- Align on scope first for larger or riskier changes.
- Run `npm run typecheck`, `npm run build`, and `npm run test` before opening a PR.
- Include a video or GIF when the UI changes.
- Include unit tests when project logic changes.
- Update both `README.md` and `README.en.md` when usage changes.

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) and [DEVELOPMENT.md](./docs/DEVELOPMENT.md) for details.

## Local Build

```bash
npm run build           # production build
npm run dist:mac        # macOS packages
npm run dist:win        # Windows installer (run on Windows)
npm run dist:linux      # Linux AppImage
npm run release:mac     # manual fallback for macOS release assets
npm run release:win     # manual fallback for Windows release assets
```

For the full development workflow, see [DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [Usage Wiki](docs/wiki/README.md) | Installation, runtime selection, scientific workflows, intervention, data boundaries, and troubleshooting |
| [SciForge paper](paper/sciforge-report.pdf) | System positioning, architecture, interface captures, and eight research showcases |
| [docs/agent-runtime-contract.md](docs/agent-runtime-contract.md) | Neutral AgentRuntime contract, events, and capabilities shared by SciForge Runtime and Codex |
| [docs/local-runtime-architecture.en.md](docs/local-runtime-architecture.en.md) | SciForge Runtime architecture, GUI boundaries, HTTP/SSE contract, and legacy agent retirement notes |
| [docs/local-runtime-cache-optimization.en.md](docs/local-runtime-cache-optimization.en.md) | SciForge Runtime cache optimization, token economy, MCP search, tool-output compaction, and usage savings |
| [docs/local-runtime-contributing.en.md](docs/local-runtime-contributing.en.md) | SciForge Runtime contribution guide: hexagonal architecture, design patterns (Ports & Adapters / Functional Core Imperative Shell / event sourcing / explicit DI / composition root), four typical PR scenarios |
| [SciForge Runtime package README](kun/README.md) | CLI, env, data dir, HTTP API |
| [CONTRIBUTING.en.md](docs/CONTRIBUTING.en.md) | Contribution guide |
| [DEVELOPMENT.en.md](docs/DEVELOPMENT.en.md) | Local development workflow |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community code of conduct |
| [SECURITY.md](SECURITY.md) | Security disclosure policy |

---

## Thanks

SciForge Runtime stands on the shoulders of prior projects:

- **Reasonix** — the cache-first agent loop. `ImmutablePrefix` (with sha256 fingerprint) and its explicit mutation API, `AppendOnlySessionLog` (in-memory window + JSONL on disk), `LruCache` / `TtlLruCache`, `InflightTracker` with `finally`-block cleanup, `SteeringQueue` for mid-turn user guidance, `ContextCompactor` that preserves pinned constraints, and `UsageCounter` + `CacheTelemetry` were important design references for SciForge Runtime. The current implementation is independent TypeScript code, with no Reasonix source, tests, event contracts, or assets copied.

We are also grateful to:

- **[LobsterAI](https://github.com/netease-youdao/LobsterAI)**: its IM management, QR binding, agent binding, and customizable agent-profile flows informed the Connect phone product direction. LobsterAI is reference/inspiration only in this project, with no LobsterAI source, tests, or assets copied.
- **OpenHanako**: its Markdown live editing, writing-space, and selection inline-agent patterns informed Write mode. OpenHanako is reference/inspiration only in this project, with no OpenHanako source, tests, or assets copied.
- **[DeepSeek](https://github.com/deepseek-ai)**: for the models and API.
- Everyone who contributes issues, ideas, code, and documentation to SciForge.

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" />
</a>

## License

[MIT](./LICENSE)
