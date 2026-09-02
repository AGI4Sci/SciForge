# Create Loop domain

`@sciforge/domain-create-loop` owns SciForge's node-based workflow automation as
one official domain package:

- the existing `WorkflowV1`, node, module, preset, hook, run, and approval
  contracts;
- package-owned read/save/run/stop/status/node-test/code-check/import/export
  capabilities;
- durable state, scheduling, local webhook, execution, cancellation, approval,
  and lifecycle disposal;
- the full React Flow editor, right-panel command, toolbar placement, and
  English/Chinese translations.

Main and renderer use separate public entrypoints. Renderer operations and agent
operations share the same Capability Broker definitions; the package has no
domain-specific IPC or preload bridge and imports no Host-private source.

Canonical state is stored in:

`<userData>/domains/create-loop/state.json`

The Host performs a one-time seed from legacy `app-settings.workflow` before the
package's first activation. The package never reads the Host settings format.
Disabling or removing the package leaves this state intact.

Node implementations use public lifecycle ports. Operations whose public ports
are unavailable fail closed instead of importing a Host service or creating a
parallel transport.

## Reproducible runs

Every new run stores a `sciforge.create-loop.run.v2` manifest containing the
immutable workflow snapshot, embedded input, execution context, parameter and
approval fingerprints, per-node receipts, discovered Artifact references,
determinism classification, canonical output, and comparator. Secret-valued
workflow environment entries are represented only as required secret slots and
fingerprints; raw values are not persisted into run manifests, execution events,
or rerun specifications. Until a secure rerun secret resolver is available,
every required slot is a blocking breakpoint: import/export still works, but
execution fails closed instead of substituting an empty value.

`create-loop.export-rerun` exports the SDK-owned `sciforge.rerun.v1` document.
Legacy runs remain exportable with a blocking breakpoint. A runnable document
contains a versioned Create Loop executor payload and is checked at two levels:
the digest of the complete executor payload and the nested workflow fingerprint.
Conclusion-targeted documents with more than one executable Activity require an
explicit Activity selection.

Reruns always request fresh workflow and Runtime approvals. Exact digest is the
default result comparator; numeric, table, and structural JSON tolerances are
used only when explicitly declared. The run history shows and downloads the
canonical specification, comparison status, reason codes, and component-level
differences. Unseeded or unseedable stochastic mismatch is inconclusive and is
never classified as a replication failure.

All execution phases are emitted through the generic Host execution-event port.
Runs of the same workflow use one stable Evidence scope, while every event keeps
the resolved workspace root. Terminal events include both the observed run
manifest and the canonical rerun resource so Evidence can preserve executable
metadata without reconstructing a private workflow format.

The completed run and its deterministic terminal intent are committed in the
same owner-only state update. File and parent-directory sync make the atomic
rename durable. Pending intents are replayed independently with the same event
ID and bytes; capacity exhaustion rejects a new run before `run_started` and
never evicts an unacknowledged terminal event.

The current graph derivation and formal-baseline boundary is documented in
[`ADR-0043`](../../../docs/adr/0043-derive-research-graphs-and-seal-formal-baselines.md).

## Dynamic dataset construction

Generated workflows use the versioned template bundle and execution-receipt adapter from
`@sciforge/domain-sdk/workflow-template`. AI Agent nodes pass a structured `allowedTools` policy
to the Host; Codex and Claude filter both tool publication and dispatch from that policy. Prompts
are instructions only and are never parsed as an authorization mechanism.

`create-loop.build-dataset` accepts confirmed conversational data requirements
(objective, sources, optional output schema, quality thresholds, models, and
release target), then dynamically compiles and saves an editable coordinator
workflow plus its generation-round workflow. When the caller omits the output
schema, the first workflow stage designs a bounded schema, a task rubric, a
Dataset API processing recipe, and an initial generation recipe from the user
objective.

The generated graph uses existing AI/LLM, loop, condition, code, approval, and
output nodes to:

- acquire, clean, and integrate real Dataset API artifacts;
- generate candidates with a Challenger and evaluate them with Weak/Strong
  Solvers plus a Judge;
- run a separate task Verifier for leakage, rubric coverage, question quality,
  verifiability, grounding, evidence coverage, and duplication;
- analyze the complete rejection trajectory and revise the generation recipe
  and Challenger prompt before retrying;
- materialize, validate, and publish the accepted batch as a versioned dataset;
- write one Markdown audit report containing the designed schema and recipes,
  node status and retries, Judge and Verifier results, strategy revisions,
  quality metrics, lineage, artifact hashes, and publication receipt.

This is dynamically constructed from normal Create Loop nodes. It is not a
built-in preset and does not introduce a separate synthetic-data domain.
