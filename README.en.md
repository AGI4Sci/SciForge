

> 素材说明 / Asset note: 未确认权属的文档素材不随本源码候选分发；操作文字保留。Unconfirmed documentation media are omitted. See [asset status](docs/ASSET-PUBLICATION-STATUS.md).



# SciForge · The Human Control Plane and Evidence Layer for Research Agents

<p align="center">
  <strong>As machines grow stronger, the interface grows thinner; human goals, judgment, and accountability remain.</strong>
</p>

<p align="center">
  Let mature agent runtimes execute in the background while researchers judge, correct, and approve at critical points—and preserve papers, data, tool calls, evidence, decisions, and artifacts as traceable research records.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="https://sciforge.ai">Website</a> ·
  <a href="https://github.com/AGI4Sci/SciForge/releases">Download</a> ·
  <span>Paper (PDF not included in this source candidate)</span> ·
  <a href="./docs/wiki/README.md">Usage Wiki</a>
</p>

<p align="center">
  <a href="https://github.com/AGI4Sci/SciForge/releases"><img src="https://img.shields.io/github/v/release/AGI4Sci/SciForge?label=release" alt="GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/AGI4Sci/SciForge" alt="License"></a>
</p>

> Demo imagery is omitted from this source-only candidate; product features are retained.

## SciForge at a Glance

Future agents will automate an increasing share of research, but their work must still align with human goals, constraints, and judgment. SciForge preserves a GUI layer that will grow thinner as models improve, yet remain essential: humans set goals, inspect evidence, intervene at critical steps, and approve results; machines search, parse, execute, analyze, and generate.

| What SciForge provides | What you gain |
| --- | --- |
| **Intervention panel** | Review and correct plans, permissions, tool calls, file changes, evidence conflicts, and final releases at critical points. |
| **Research-state and evidence capture** | Automatically collect papers, scientific objects, command and tool results, figures, annotations, claims, provenance, and decision records. |
| **Scientific enhancement layer** | Extend general-purpose agents with scientific multimodal routing, literature search, Evidence / Project DAGs, controlled plotting, writing, presentation, and rerunnable workflows. |
| **Long-lived research workspace** | Keep research across sessions, roles, and tools resumable, reviewable, and transferable. |

SciForge does **not reinvent or replace** mature runtimes such as Codex and Claude Code. It works with them: runtimes provide general-purpose agent execution, while SciForge provides scientific objects, research context, human review interfaces, and evidence governance. **Codex is the default runtime; Claude Code can be selected explicitly in Settings.**

```text
Research goals and materials
      ↓
Codex / Claude Code execution
      ↓
Scientific search · Multimodal translation · Analysis · Plotting · Writing · Workflows
      ↓
SciForge collects evidence and artifacts ──→ Human review, intervention, approval
      ↓
Traceable, reproducible, and resumable research state
```

## Workbench in Action (Prototype Showcase)

The table retains descriptions of workbench capabilities. The corresponding session screenshots and paper PDF are not included in this source candidate; no broken links or restored private material are supplied.

<table>
  <tr>
    <td width="50%" align="center">
      <em>Illustration not included in this source candidate.</em><br>
      <strong>Session-level Evidence DAG</strong><br>
      Trace a conversation back to claims, sources, support/contradiction relationships, and node provenance.
    </td>
    <td width="50%" align="center">
      <em>Illustration not included in this source candidate.</em><br>
      <strong>Project-level Project DAG</strong><br>
      Aggregate evidence, conclusions, review states, and project decisions across sessions.
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <em>Illustration not included in this source candidate.</em><br>
      <strong>From PDF Review to Revision</strong><br>
      Keep in-page comments, agent edits, compilation checks, and unresolved issues in one interface.
    </td>
    <td width="50%" align="center">
      <em>Illustration not included in this source candidate.</em><br>
      <strong>Scientific Dialogue Driven by Structural Selections</strong><br>
      Send residue selections from the structure viewer into the conversation together with file hashes and location metadata.
    </td>
  </tr>
</table>

## Public Showcases

Four flagship examples show how SciForge closes the loop between agent execution, human PI intervention, and auditable research records:

| Showcase | Value in one sentence | Reviewable materials |
| --- | --- | --- |
| **Multi-day Agentic Research Sprint** | A PI-controlled, long-horizon research loop for meiosis gene discovery, spanning 132 stages and 199+ Git commits. | [Public repository](https://github.com/AGI4Sci/scenario-01-research-sprint) |
| **AI-Guided Protein Design** | ProteinMPNN sequence design combined with Boltz-2 / ESMFold structural validation and explicit criteria for follow-up experiments. | [Public repository](https://github.com/kaiwinYao1/sciforge-de-novo-protein-demo) |
| **AI-Guided Molecular Optimization** | Traceable SAR iteration around an EGFR scaffold: 135 filtered candidates and 36 docking evaluations. | [Public repository](https://github.com/AGI4Sci/molclaw) |
| **Genome-to-BGC Discovery** | antiSMASH, MIBiG, BiG-SCAPE, and multi-agent analysis combined to prioritize 430 BGC regions with evidence. | [Public repository](https://github.com/wenne-kwj/scenario-bgc-genome-discovery) |

<details>
<summary><strong>View all eight end-to-end cases from the paper</strong></summary>

| # | Showcase | Repository |
| --- | --- | --- |
| 1 | Agentic Research Sprint: a multi-day, PI-controlled research loop for gene discovery | [AGI4Sci/scenario-01-research-sprint](https://github.com/AGI4Sci/scenario-01-research-sprint) |
| 2 | AI4AI: ESMC-6B ContactProbe contact prediction and hyperparameter search | [BruthYU/autoresearch_base](https://github.com/BruthYU/autoresearch_base) |
| 3 | Reviewer / Rebuttal: evidence-governed peer review and response workflow | [maoxinjie/scenario-05-reviewer-rebuttal-vcbench](https://github.com/maoxinjie/scenario-05-reviewer-rebuttal-vcbench) |
| 4 | Guided Paper Reproduction: reproduction of the MCFST spatial transcriptomics paper | [Winshion/sciforge-ai4ai-spacial-trans](https://github.com/Winshion/sciforge-ai4ai-spacial-trans) |
| 5 | Cross-Scale Cell Atlas: cross-database integration and guided analysis | [ShaysXIA/cross-scale-data-demo](https://github.com/ShaysXIA/cross-scale-data-demo) |
| 6 | AI-Guided Protein Design: from sequence generation to structural validation | [kaiwinYao1/sciforge-de-novo-protein-demo](https://github.com/kaiwinYao1/sciforge-de-novo-protein-demo) |
| 7 | AI-Guided Molecular Design: traceable scaffold SAR optimization | [AGI4Sci/molclaw](https://github.com/AGI4Sci/molclaw) |
| 8 | Genome-to-BGC Discovery: from genomes to candidate BGC cards and prioritization | [wenne-kwj/scenario-bgc-genome-discovery](https://github.com/wenne-kwj/scenario-bgc-genome-discovery) |

</details>

## What You Can Do

- **Read and review literature**: Search arXiv, bioRxiv, Europe PMC, and Semantic Scholar; parse PDFs; annotate pages; ask questions about selections; and write research content.
- **Understand scientific objects**: Send protein sequences, protein structures, small molecules, and single-cell expression data to specialized translators, then return auditable textual evidence to the main agent for reasoning.
- **Reproduce and experiment**: Let agents read and write files in real workspaces, run commands, connect to SSH / HPC or scientific tools, and preserve execution and change records.
- **Govern evidence and decisions**: Review individual sessions with Evidence DAG and manage goals, evidence, reviews, and release states across sessions with Project DAG.
- **Communicate research**: Generate controlled plots from data and reference figures, revise them in Canvas, then use them in papers, reports, and PPTX deliverables.
- **Automate and collaborate**: Turn repeated steps into Workflows or Schedules, and supervise long-running tasks through desktop, mobile, and team entry points.

SciForge is local-first by default; models, remote execution, and scientific expert services are configured explicitly by users or institutions. Nodes in Evidence / Project DAGs are reviewable **evidence candidates**, not automatically generated truth. Scientific conclusions still require domain-expert judgment, and computational results in the showcases do not constitute experimental validation.

> **How to read the showcases:** These are prototype demonstrations and public audit materials documented in the paper, not completed clinical/experimental validations or comprehensive benchmarks. The paper also records explicit limitations: the protein-design case contains a provenance mismatch; the run counts and selection rules in the MCFST reproduction still require revision; and the molecular-optimization case missed its preregistered primary metric and remained within docking noise. Treat them as reviewable research trajectories, not automatically generated scientific conclusions.

## Quick Start

### Install Directly

Download a macOS, Windows, or Linux installer from [GitHub Releases](https://github.com/AGI4Sci/SciForge/releases). On first launch, choose a runtime in **Settings**, configure Model Router / provider, and select a local workspace for your new task.

### Run from Source

Requirements: Node.js 22.12+, platform-native build tools, and a supported, user-configured runtime/provider for model execution.

The existing `AGI4Sci/SciForge-client` repository is private; the future public source destination has not been created. Set `SCIFORGE_CLIENT_REPOSITORY_URL` to a maintainer-approved URL you can access, and replace it when that destination exists. Do not publish the old repository history instead. Installation/build hooks can download artifacts and build native modules; the commands below are setup instructions, not acceptance results.

```bash
: "${SCIFORGE_CLIENT_REPOSITORY_URL:?Set an authorized client repository URL}"
git clone "$SCIFORGE_CLIENT_REPOSITORY_URL" SciForge-client
cd SciForge-client
npm ci
npm run dev
```

Common validation commands:

```bash
npm run typecheck
npm run test
npm run build
```

For local installation, see **[INSTALL.md](./INSTALL.md)**. Additional user documentation is maintained at the [documentation site](https://hanhuiyang5-web.github.io/sciforge-docs-v2/); documentation does not override this repository’s client/cloud boundary.

### Mobile and cloud collaboration

This is the SciForge-client repository, currently private and being prepared for future open-source delivery. It contains the desktop client, the [shared contracts](./packages/collaboration-contracts/), and the [collaboration domain](./packages/domains/collaboration/). The collaboration server, PostgreSQL migrations, Zulip server adapter, and deployment materials are delivered separately in the closed-source SciForge-cloud repository; they are not included here. Remote SSH is not part of this client candidate.

Local client development does not require the original private monorepo, cloud repository access, or production credentials. See [INSTALL.md](./INSTALL.md). Cloud collaboration additionally requires an authorized test service and accounts supplied by its operator. Leaving cloud settings empty does not establish cloud acceptance, but avoids a dependency on a private deployment for local setup.

Client and cloud are versioned separately. Shared-contract changes need explicit cross-boundary validation against pinned client inputs in the cloud repository. Do not infer compatibility from matching branch names, and never commit credentials or production configuration.

## Documentation

| Entry | Contents |
| --- | --- |
| [Installation](./INSTALL.md) | Local client setup, prerequisites, and verification |
| SciForge Paper | PDF not included in this source candidate; no replacement public URL is asserted |
| [Development Guide](./docs/DEVELOPMENT.md) | Local development, testing, and builds |
| [Collaboration testing](./COLLABORATION_TEST_SETUP_GUIDE.md) | Local checks and separately authorized cloud acceptance |
| [Collaboration issue template](./COLLABORATION_TEST_ISSUE_TEMPLATE.md) | Reproduction, permissions, recovery, and evidence requirements |
| Closed-source cloud operations | Available separately to authorized service operators; not included here |
| [Runtime Contract](./docs/agent-runtime-contract.md) | The unified adaptation boundary for Codex, Claude Code, and the GUI |
| [Architecture](./DESIGN.md) | Agent runtime, GUI, and service boundaries |
| [Context Map](./CONTEXT-MAP.md) | Authority boundaries across identity, collaboration, content, documents, and provider integration |
| [Architecture Decision Index](./docs/adr/README.md) | ADR lifecycle, superseded/deferred states, and current authority order |
| [Contribution Guide](./docs/CONTRIBUTING.md) | How to contribute to the project |
| [Security Policy](./SECURITY.md) | Vulnerability reporting and security information |

## Contributing and License

We welcome issues, showcases, scientific workers, Skills, runtime adapters, documentation, and UI improvements. Before submitting a PR, run the typecheck, tests, and build steps appropriate to your changes; see the [Contribution Guide](./docs/CONTRIBUTING.md) for collaboration conventions.

The root license is [Apache-2.0](./LICENSE); individual domains and plugins retain their own MIT or Apache-2.0 declarations and license files. See [NOTICE](./NOTICE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Third-party restrictions still apply: tldraw production authorization is unconfirmed, and public release remains blocked pending rights and acceptance review.

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" alt="SciForge contributors">
</a>
