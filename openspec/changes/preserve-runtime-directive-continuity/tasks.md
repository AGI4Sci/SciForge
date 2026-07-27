# Tasks

- [x] 1. Extend the existing runtime context ledger with bounded, idempotent directive persistence and delivery state.
- [x] 2. Route start, steer, queue, side conversation, and handoff through one directive-delivery helper while separating governance control.
- [x] 3. Inject the ledger directive envelope after compaction for new turns and direct steering.
- [x] 4. Make the existing execution-integrity guard inherit obligations from active directives and preserve terminal outcome semantics in the UI.
- [x] 5. Add compaction, steer, retry, ambiguous acknowledgement, handoff, mutation-receipt, and terminal-label regression tests; run typecheck and lint.
