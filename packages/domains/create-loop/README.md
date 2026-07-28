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
