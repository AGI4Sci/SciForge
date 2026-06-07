# Computer Use Action Provider

`packages/actions/computer-use` owns the portable Computer Use primitive contract for Agent Host and MCP-style callers. Computer Use is TS-only.

## Public Surface

- `computer_use.bind`
- `computer_use.observe`
- `computer_use.act`
- `computer_use.run_procedure`
- `computer_use.control`

`run_procedure` executes Host-specified local primitive steps to reduce round trips. It does not accept natural language tasks, does not plan, locate, verify, repair, or produce completion truth.

## Boundary

The package owns primitive schemas, strict validators, refs-first result envelopes, MCP-compatible dispatch, local procedure step composition, safety diagnostics, and package-local evidence contracts.

The Host owns target choice, task understanding, semantic locate, model calls, approval collection, artifact validation, user-level completion, final answers, and real platform ports.

Legacy `runTask`, `perform_local_action`, and `fill_fields` are retired. Do not add compatibility wrappers that translate them into primitives; callers must use the primitive surface directly. Historical or diagnostic references may only be used for rejection, migration audit, or evidence invalidation, never as execution paths or completion evidence.

## Development Rules

- Add new GUI actions through the action table first, then keep validators, MCP schema, service delegation, and evidence tests aligned.
- Product paths must use session-local input adapters and cursor refs. Shared system mouse/keyboard input is diagnostic only.
- Evidence is refs-first: screenshots, AX payloads, provider payloads, traces, and logs stay out of chat/context bodies.
- `run_procedure` is a local primitive for-loop. It must not accept natural language tasks, plan, locate, verify, repair, or report user-level completion.
- Capability claims use the design-doc maturity ladder: `contracted`, `unit-proven`, `live-diagnostic`, `product-ready`, or `blocked`.

## Implementation Shape

Keep the package boring on purpose:

- Put action-specific required fields, risk rules, handler names, and evidence requirements in a table.
- Keep session lifecycle explicit: `bind -> active -> paused -> released/stopped/cancelled`.
- Treat missing Host platform ports as fail-closed, not as permission to fall back to legacy `runTask` behavior.
- Keep live desktop tests in the acceptance harness; product code should only depend on primitive contracts and adapter ports.
