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
