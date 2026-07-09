---
name: research-memory
description: Record and reuse project-scoped research cognition from experiments, debugging, analysis, and research planning.
---

# Research Memory Protocol

Use this skill when a SciForge project involves iterative experiments, debugging, metric interpretation, method choice, negative results, or user-confirmed research principles.

Research Memory is a project-scoped headless extension. It is not MCP, does not expose localhost, and does not require tokens. Storage lives under `.sciforge/research-memory/research-memory.sqlite` inside the active project.

## When To Record

- After each training or evaluation run, call `research_memory_record_experiment` with metrics, logs, parameters, seed, command, and artifact refs.
- After a group of runs, call `research_memory_reflect_experiments` and report active, candidate, and hypothesis counts separately.
- After deep debugging, failure analysis, metric interpretation, method comparison, or a user says "remember this", call `research_memory_propose_insight` or `research_memory_reflect_thread`.
- Before a new thread, next experiment plan, or cross-thread continuation, call `research_memory_resolve_context`.

## Evidence Language

Never describe candidate or hypothesis memory as validated, proved, or established.

Use these boundaries:

- Active: evidence-supported and safe to use as a planning constraint.
- Candidate: traceable but not strong enough to treat as settled.
- Hypothesis: useful idea requiring future experiment or review.
- Rejected, invalidated, superseded: do not reuse unless explaining what changed.

Always cite memory ids and evidence refs when memory changes the plan.

## Experiment Runs

Record:

- command or script path
- dataset version
- parameters and seed
- parseable metrics
- log excerpt
- artifact refs such as `artifact:artifacts/runs/v3/confusion_matrix.png`
- thread or turn refs when available

Strong experiment insights need at least:

- a completed run
- parseable metrics
- artifact or log refs
- a claim clearly tied to parameters, metrics, or observed result

## Next-Plan Recall

When designing the next run, answer with:

- which memories were recalled
- which routes to avoid
- which baseline or method choice should be reused
- evidence refs behind each decision
- which items remain candidate or hypothesis
