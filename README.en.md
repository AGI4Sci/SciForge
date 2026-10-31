# SciForge · The Human Control Plane and Evidence Layer for Research Agents

<p align="center">
  <strong>As machines grow stronger, the interface grows thinner; human goals, judgment, and accountability remain.</strong>
</p>

<p align="center">
  Let mature agent runtimes execute in the background while researchers judge, correct, and approve at critical points —<br>
  papers, data, tool calls, evidence, decisions, and artifacts are preserved as traceable research records.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="https://agi4sci.github.io/sciforge-docs-v2/">Documentation</a> ·
  <a href="./docs/wiki/README.md">Usage Wiki</a> ·
  <a href="https://agi4sci.github.io/SciForge/submit/">Submit a research need</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/AGI4Sci/SciForge" alt="License"></a>
</p>

## What is SciForge

SciForge is a **user-friendly desktop client for research agents**: open a local project, pick a runtime, and let an agent read literature, run analyses, and produce figures inside clear permission boundaries — every step stays reviewable. It does **not reinvent or replace** mature runtimes such as Codex and Claude Code, and it is **compatible with the DeepSeek Harness (DSH) plugin ecosystem**: runtimes provide general-purpose agent execution, while SciForge provides scientific objects, research context, human review interfaces, and evidence governance.

On top of that, SciForge strengthens four research-specific capabilities:

| Focus | What you gain |
| --- | --- |
| **Cloud notes** | Connect your self-hosted SiYuan note service as a full-page editor; completed tasks are archived automatically as traceable Markdown summaries. |
| **Team collaboration** | Assign tasks around Projects, review version by version, request revisions and accept deliverables; continue personal sessions from your phone. |
| **Research evidence auditing** | Evidence DAG, Project DAG, artifact versions, research checkpoints, and the research dossier tie every conclusion back to data, methods, and figures. |
| **Scientific multimodal understanding** | Dedicated previews and translators for protein sequences and structures, small molecules, omics matrices, spectra, and imaging — handing auditable textual evidence to the agent. |

Also built in: **22 domain extensions** (controlled plotting, visual review, anchored comments, change inspector, terminal, browser preview, content space, and more), **scheduled tasks and Create Loop** multi-step orchestration, and **local-first permission governance** (read-only sandbox, per-action approvals, external-write confirmation).

## SciForge at a Glance

| What SciForge provides | What you gain |
| --- | --- |
| **Intervention panel** | Review and correct plans, permissions, tool calls, file changes, evidence conflicts, and final releases at critical points. |
| **Research-state and evidence capture** | Automatically collect papers, scientific objects, command and tool results, figures, annotations, claims, provenance, and decision records. |
| **Scientific enhancement layer** | Extend general-purpose agents with scientific multimodal routing, literature search, Evidence / Project DAGs, controlled plotting, writing, presentation, and rerunnable workflows. |
| **Long-lived research workspace** | Keep research across sessions, roles, and tools resumable, reviewable, and transferable. |

```text
Research goals and materials
      ↓
Codex / Claude Code / DSH execution
      ↓
Scientific search · Multimodal translation · Analysis · Plotting · Writing · Workflows
      ↓
SciForge collects evidence and artifacts ──→ Human review, intervention, approval
      ↓
Traceable, reproducible, and resumable research state
```

**Runtimes**: Codex is the default; Claude Code and DeepSeek Harness (DSH) can be selected explicitly in **Settings → AI Assistants**. DSH is integrated over ACP — model and reasoning effort take effect through the ACP session, and its native shell tool is off by default with per-command approval. A failing runtime reports an explicit error and never silently falls back to another one.

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

> **How to read the showcases:** These are prototype demonstrations and public audit materials documented in the paper, not completed clinical/experimental validations or comprehensive benchmarks. The paper also records explicit limitations: the protein-design case contains a provenance mismatch; the run counts and selection rules in the MCFST reproduction still require revision; and the molecular-optimization case missed its preregistered primary metric and remained within docking noise. Treat them as reviewable research trajectories, not automatically generated scientific conclusions.

## Quick Start

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm ci
npm run dev
```

Requires Node.js 22.12+ and platform-native build tools; model execution needs a supported, user-configured runtime/provider. See [INSTALL.md](./INSTALL.md) for full prerequisites and verification.

No installer has been published for the current source snapshot — running from source is recommended; earlier installers under Releases predate this codebase. The local client starts without any private cloud configuration; optional cloud connections require an address and account from the service operator, and this repository ships no default production endpoint.

## Documentation

| Entry | Contents |
| --- | --- |
| [Documentation site](https://agi4sci.github.io/sciforge-docs-v2/) | Five-minute quickstart, end-to-end cases, the 22-extension feature manual, and video tours (Chinese) |
| [Installation](./INSTALL.md) | Local client setup, prerequisites, and verification |
| [Usage Wiki](./docs/wiki/README.md) | The Chinese usage manual versioned with this repository |
| [Development Guide](./docs/DEVELOPMENT.md) | Local development, testing, and builds |
| [Contribution Guide](./CONTRIBUTING.md) · [Security Policy](./SECURITY.md) | Collaboration conventions and vulnerability reporting |

## Repository Boundary

The client source and shared contracts live in this repository. The collaboration server, PostgreSQL migrations, Zulip server adapter, and deployment materials are delivered separately in the closed-source SciForge-cloud repository and are not included here. Remote SSH is not part of the open-source client.

## Contributing and License

We welcome issues, showcases, scientific workers, Skills, runtime adapters, documentation, and UI improvements. Before submitting a PR, run the typecheck, tests, and build steps appropriate to your changes; see the [Contribution Guide](./docs/CONTRIBUTING.md) for collaboration conventions.

The root license is [Apache-2.0](./LICENSE); individual domains and plugins retain their own MIT or Apache-2.0 declarations and license files. See [NOTICE](./NOTICE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) — a few component authorizations are still being confirmed, and that file is authoritative. The unused tldraw dependency has been removed, so no tldraw code ships with the source or the installers.

<a href="https://github.com/AGI4Sci/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=AGI4Sci/SciForge" alt="SciForge contributors">
</a>
