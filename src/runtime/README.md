# Runtime Owner Notes

`src/runtime` owns workspace server endpoints, generation gateway orchestration, task execution, runtime policy gates, and local adapter glue. Treat this tree as application runtime internals unless a type is explicitly promoted to a package or shared contract.

## New Code Placement

- Put reusable schema, artifact, object reference, verifier, or UI manifest contracts in `packages/runtime-contract`, `packages/scenario-core`, or the owning package public export.
- Put workspace-only execution, gateway normalization, repair, policy, and server concerns in `src/runtime`.
- Put app presentation state and React composition in `src/ui/src/app`, not in runtime modules.

## Import Boundaries

- `packages/*` must not import `src/runtime/**` or `src/ui/src/**`.
- Runtime may consume package public exports, but should not depend on UI app internals.
- If runtime needs a UI-facing shape, define a stable contract first and import that contract on both sides.

Verify the boundary after changing runtime-facing contracts:

```bash
npm run smoke:module-boundaries
```
