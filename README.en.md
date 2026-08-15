<p align="center">
  <img src="src/asset/img/logo.png" width="96" alt="SciForge icon">
</p>

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
  <a href="./paper/sciforge-report.pdf">Paper</a> ·
  <a href="./docs/wiki/README.md">Usage Wiki</a>
</p>

<p align="center">
  <a href="https://github.com/AGI4Sci/SciForge/releases"><img src="https://img.shields.io/github/v/release/AGI4Sci/SciForge?label=release" alt="GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/AGI4Sci/SciForge" alt="License"></a>
</p>

<p align="center">
  <a href="src/asset/img/code.gif">
    <img src="src/asset/img/code.gif" width="760" alt="SciForge workbench demo">
  </a>
</p>

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

These screenshots come from real local research sessions, not standalone concept art. Click an image to view it at full size; see the [paper](./paper/sciforge-report.pdf) for more design details and examples.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="paper/figures/sciforge-evidence-dag.png"><img src="paper/figures/sciforge-evidence-dag.png" alt="Session-level Evidence DAG"></a><br>
      <strong>Session-level Evidence DAG</strong><br>
      Trace a conversation back to claims, sources, support/contradiction relationships, and node provenance.
    </td>
    <td width="50%" align="center">
      <a href="paper/figures/sciforge-project-dag.png"><img src="paper/figures/sciforge-project-dag.png" alt="Project-level Project DAG"></a><br>
      <strong>Project-level Project DAG</strong><br>
      Aggregate evidence, conclusions, review states, and project decisions across sessions.
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="paper/figures/sciforge-pdf-review.png"><img src="paper/figures/sciforge-pdf-review.png" alt="From PDF review to revision"></a><br>
      <strong>From PDF Review to Revision</strong><br>
      Keep in-page comments, agent edits, compilation checks, and unresolved issues in one interface.
    </td>
    <td width="50%" align="center">
      <a href="paper/figures/sciforge-biology-selection-chat.png"><img src="paper/figures/sciforge-biology-selection-chat.png" alt="Scientific dialogue driven by structural selections"></a><br>
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

Requirements: Node.js 22.12+ and a locally installed, authenticated Codex (default) or Claude Code CLI.

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm install
npm run dev
```

Common validation commands:

```bash
npm run typecheck
npm run test
npm run build
```

For complete instructions on installation, first-time setup, runtime selection, worker startup, scientific workflows, data locations, and troubleshooting, see the **[SciForge Usage Wiki](./docs/wiki/README.md)**.

### Mobile and cloud collaboration

The collaboration backend is part of this open-source repository rather than a hidden desktop service. The cloud server and PostgreSQL migrations live in [`packages/collaboration-server`](./packages/collaboration-server/), the Zulip provider in [`packages/collaboration-provider-zulip`](./packages/collaboration-provider-zulip/), the shared protocol in [`packages/collaboration-contracts`](./packages/collaboration-contracts/), and the desktop domain in [`packages/domains/collaboration`](./packages/domains/collaboration/).

The repository has one long-lived branch, `gui`. Desktop, cloud, and the current Zulip phone entrypoint are built and tested from the same exact commit instead of drifting per-client source branches. They still release independently: Electron installers contain the desktop application; ECS installs only the contracts, Zulip provider, and collaboration-server tarballs; phones currently use the official Zulip app rather than a second native application in this repository. Shared-contract changes run both desktop and cloud validation.

See the [server README](./packages/collaboration-server/README.md) for source builds, migrations, configuration, probes, and tests. Production systemd, Nginx, backup, upgrade, and rollback procedures are documented in the [Chinese operations guide](./docs/operations/zulip-aliyun-deployment.zh-CN.md). Passwords, API keys, private keys, and tokens must always be injected from deployment-managed secret files or a secret manager outside Git.

## Documentation

| Entry | Contents |
| --- | --- |
| [Usage Wiki](./docs/wiki/README.md) | From installation to your first task, plus common scenarios, configuration, and troubleshooting |
| [SciForge Paper](./paper/sciforge-report.pdf) | System positioning, architecture, real interfaces, and eight end-to-end showcases |
| [Development Guide](./docs/DEVELOPMENT.md) | Local development, testing, and builds |
| [Collaboration Server README](./packages/collaboration-server/README.md) | Cloud architecture, source startup, migrations, configuration, probes, and tests |
| [Collaboration User Guide (Chinese)](./docs/collaboration-user-guide.zh-CN.md) | Phone pairing, Agent registration, personal Sessions, Projects, and recovery |
| [Collaboration Operations Guide (Chinese)](./docs/operations/zulip-aliyun-deployment.zh-CN.md) | Production deployment, systemd, Nginx, backups, upgrades, and rollback |
| [Runtime Contract](./docs/agent-runtime-contract.md) | The unified adaptation boundary for Codex, Claude Code, and the GUI |
| [Architecture](./DESIGN.md) | Agent runtime, GUI, and service boundaries |
| [Contribution Guide](./docs/CONTRIBUTING.md) | How to contribute to the project |
| [Security Policy](./SECURITY.md) | Vulnerability reporting and security information |

## Contributing and License

We welcome issues, showcases, scientific workers, Skills, runtime adapters, documentation, and UI improvements. Before submitting a PR, run the typecheck, tests, and build steps appropriate to your changes; see the [Contribution Guide](./docs/CONTRIBUTING.md) for collaboration conventions.

SciForge is licensed under the [MIT License](./LICENSE). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party dependencies, reference projects, and asset sources.

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" alt="SciForge contributors">
</a>
