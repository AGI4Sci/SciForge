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
(sources, output schema, quality thresholds, models, and release target), then
dynamically compiles and saves an editable coordinator workflow plus its
generation-round workflow. The generated graph uses existing AI/LLM, loop,
condition, code, approval, and output nodes to ground through Dataset API,
generate and evaluate candidates, retry rejected records, and materialize,
validate, and publish the accepted batch. It is not a built-in preset and does
not introduce a separate synthetic-data domain.
