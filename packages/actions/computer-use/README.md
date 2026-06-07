# Computer Use Action Provider

This package is the Computer Use action provider contract source. The active
implementation is TypeScript-only and runs through the Agent Host
WindowActionSession / host adapter path.

## Active Boundary

- Product acceptance uses Agent Host -> WindowActionSession -> Computer Use
  action loop -> current-run evidence bundle.
- `src/runtime` owns host adapter plumbing, workspace refs, runtime events,
  platform capture/input implementations, and ToolPayload wrapping.
- `packages/actions/computer-use` owns the action provider manifest, generic
  action schema, safety gates, trace contract, host-port names, fixtures, and
  package-local skills.
- Model calls go through the registered Model Router capabilities; the package
  does not consume raw provider URLs, API keys, or unregistered model slugs.
- High-risk actions fail closed unless the upstream request carries explicit
  approval evidence.

## Removed Legacy Surface

The Python `sciforge_computer_use` package, pytest suite, Docker/noVNC isolated
desktop probes, M6/native multi-screen Python demo, and legacy
VirtualAppScreen adapter/runtime package have been retired. They are not copied
into desktop static assets, are not referenced by package scripts, and cannot be
used as product/default acceptance.

Historical evidence files may still mention those names, but new runtime,
manifest, script, and package docs should describe the TS-only
WindowActionSession path.

## Public Shape

The stable product-facing shape is:

```text
getManifest()
runTask(request, hostPorts)
validateTrace(traceOrLocalPath, resolver?)
compactResult(result)
```

`hostPorts` is the only platform contact surface. It provides capture, target
window binding, scoped execution, trace writing, runtime events, approval
handoff, and verifier inputs. The action provider returns refs-first evidence
and structured failure diagnostics; it does not own GUI presentation or
user-level completion.
