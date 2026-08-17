# `@sciforge/domain-sdk`

This package defines the pure-data boundary for SciForge domain packages. A single strict
`sciforge.domain.json` contract represents both trusted packages selected at build time and
sandboxed packages installed at runtime. It does not locate packages, verify signatures, grant
permissions, dynamically import code, or execute untrusted JavaScript.

`defineDomainPackage` parses either manifest kind and returns deeply frozen data.
`defineTrustedDomainPackage` remains the narrower entrypoint for the existing generated
compile-time composition path.

A domain package publishes one shared definition plus process-separated implementation entrypoints:

```text
@sciforge/domain-example
├── definition   # pure DomainPackageDefinition
├── main         # privileged main/worker implementation
├── renderer     # optional trusted renderer implementation
└── workspace-server # optional trusted backend beside workspace data
```

The definition declares conventional `./main`, `./renderer`, and `./workspace-server` exports for
the processes it owns. The workspace-server entrypoint is available only to trusted compile-time
packages. Generated composition projects each process independently, so the headless server never
imports Electron main or renderer implementations.

Every package exports the conventional names `domainPackageDefinition`, `createDomainMainEntry`,
`createDomainRendererEntry`, and `createDomainWorkspaceServerEntry` for its declared processes.
The repository generator scans
`packages/domains/*/sciforge.domain.json`, sorts by package name, and emits static imports. It never
imports a process entry that the manifest does not declare.

## Sandboxed runtime packages

Runtime packages use `kind: "sandboxed-runtime"` and must explicitly declare their claimed
publisher identity, compatible host API range, requested permissions, and isolated process
entrypoints:

```json
{
  "contractVersion": 1,
  "kind": "sandboxed-runtime",
  "packageName": "@sciforge/domain-example",
  "publisher": {
    "id": "sciforge",
    "displayName": "SciForge"
  },
  "module": {
    "id": "sciforge.domain-example",
    "displayName": "Example",
    "version": "1.0.0",
    "hostApi": {
      "minimum": "1.0.0",
      "maximumExclusive": "2.0.0"
    }
  },
  "requestedPermissions": [
    {
      "id": "host.workspace.read",
      "process": "main",
      "reason": "Read user-selected workspace resources.",
      "required": true,
      "parameters": {
        "roots": ["workspace"]
      }
    }
  ],
  "entrypoints": [
    {
      "process": "main",
      "isolation": "extension-host",
      "entry": "dist/main.js",
      "format": "module",
      "contributions": []
    },
    {
      "process": "renderer",
      "isolation": "sandboxed-webview",
      "entry": "dist/renderer/index.html",
      "format": "html",
      "contributions": []
    }
  ]
}
```

The manifest identifies the publisher it claims to come from; that claim is not trust evidence.
Signature bytes, verification results, grants, and installation trust belong to host-owned
installation records outside the package. Strict parsing rejects manifest fields that attempt to
self-assert those decisions. Permission declarations are requests scoped to a declared process,
not grants. A separate host policy must reject unknown permission IDs and refuse activation until
all required requests have an acceptable grant.

The main entry can only target a process-separated extension host, and renderer code can only
target a sandboxed webview document. Runtime manifests cannot select Electron's main process or
the privileged host renderer. Both entry paths are package-relative POSIX paths.

Packages that must ship runtime assets declare them in the same manifest:

```json
{
  "packaging": {
    "bundled": true,
    "runtime": {
      "requiredPaths": ["python/example/server.py", "ui/index.html"],
      "dependencies": ["@sciforge/domain-foundation"]
    }
  }
}
```

Every required path is a package-relative POSIX path and every dependency is the package name of
another installed bundled domain. The generated release target is always
`node_modules/<packageName>`; packages cannot override it. `package.json` and
`sciforge.domain.json` are implicit runtime requirements and must not be repeated. Missing paths,
uninstalled or non-bundled dependencies, self-dependencies, and dependency cycles fail discovery.

`defineInstalledDomainPackageSet` is the single process-neutral source of installed definitions.
After a process imports only its own package entrypoints, the corresponding main, renderer, or
workspace-server installed-entry helper binds declarations to runtime values. Pairing is exact by
`kind:id`; missing, extra, duplicate, or mismatched entries fail before contributions are exposed.
There is deliberately no cross-process runtime bundle and no dynamic package loader.

## Renderer contributions

`@sciforge/domain-sdk/renderer-contributions` is the public boundary for package-owned Workbench
UI. It defines these generic contribution kinds:

- `renderer.command`
- `renderer.workbench-toolbar-action`
- `renderer.workbench-right-panel`
- `renderer.workbench-bottom-panel`
- `renderer.workbench-global-overlay`
- `renderer.composer-context-provider`
- `renderer.resource-navigation`

A command declaration ID is its stable command ID. Its runtime value has the exact shape
`{ execute, isAvailable?, isActive? }`. Every invocation carries only bounded process-neutral data:
optional session, runtime and workspace identity, registered session resources, the active surface,
and an optional JSON payload. Toolbar actions reference a command in their pure manifest contract;
their runtime value supplies only presentation. This is the sole command execution path.

Right panels, bottom panels, and global overlays likewise keep serializable metadata in the
manifest contribution contract and bind one `{ render }` value in a trusted renderer entrypoint.
The three slots use contribution IDs rather than host-private modes. Composer context providers
return bounded text items and metadata through a strict result schema. These pure contracts also
describe future sandboxed renderer contributions; a sandbox host supplies the view transport
without changing the manifest data model.

Exact-resource navigation is contribution-neutral at the caller. A package asks the Workbench to
open a bounded `{ resourceKind, resourceId, integrity? }` identity; exactly one installed
`renderer.resource-navigation` owner may claim each resource kind and translate it to its own
surface activation. Its manifest-declared target panel must exist and share the navigator's package
owner. Duplicate resource owners, missing panels, and cross-owner targets fail registration.
`canOpenResource` and the boolean `openResource` result let callers omit unavailable navigation;
callers never name another package's contribution ID or activation schema.

`DomainRendererHost` exposes only generic workbench navigation, bounded message sending,
workspace file picking, registered visual-target inspection, and capability invocation. Visual
inspection never accepts DOM selectors. Redacted targets return a denied inspection without target
metadata. Successful target and text-selection inspection resolves asynchronously to an opaque,
host-signed `targetRef`; packages pass it back to visual capture and must never derive a reference
from component or target IDs.

## Generic host capabilities

Domain packages own their domain schemas and call the generic capability broker. Renderer sessions
may publish `{ kind, resourceRef, resource }` handles. `observe` reads the current validated state,
while `subscribe` receives only the canonical resource-change envelope
`{ resourceRef, resourceKind, actionId, beforeRevision, afterRevision, changedAt }`; consumers
re-observe after a change. It is not a second domain-event transport.

Two host primitives are standardized because several independent packages need the same controlled
operation:

- `@sciforge/domain-sdk/controlled-process` starts only the host-owned `system-shell` profile and
  uses bounded cursor reads plus write, resize, and dispose actions. It never accepts an arbitrary
  executable.
- `@sciforge/domain-sdk/version-control` models provider-neutral workspace status, snapshots,
  references, diffs, file reads, restore previews, and destructive restore. It contains no Git
  command or repository implementation.
- `@sciforge/domain-sdk/visual-capture` captures only an explicitly registered visual target.
  The host owns target lookup, sensitive-target policy, redaction, callout rendering, and PNG byte
  limits; packages cannot submit DOM selectors or redaction bounds.
- `@sciforge/domain-sdk/agent-execution` runs an agent thread through a host-owned runtime while
  exposing only stable request and terminal result data, an optional Host-enforced tool allowlist,
  plus optional cancellation. A request either starts a thread (with or without a workspace) or
  names an exact runtime/thread pair. Retryable callers reuse one `clientDirectiveId`, which enters
  the same Host directive ledger as desktop messages instead of creating a second execution path.
- `@sciforge/domain-sdk/package-storage` exposes package-owner-scoped non-secret settings with
  optimistic revisions and a main-process-only secret store. Generated composition binds both
  stores to the manifest owner; packages cannot choose another namespace. Renderer code changes
  settings only through the canonical capability invoker and never receives secret-store access.
- `@sciforge/domain-sdk/workflow-template` defines the versioned workflow-template bundle and the
  package-owned execution-receipt adapter used by workflow engines. Engines consume these generic
  contracts instead of another domain's private artifact directories or receipt layout.
- `@sciforge/domain-sdk/power` acquires an application keep-awake lease whose release belongs to
  the package lifecycle. Packages cannot choose native power-blocker implementations.
- `@sciforge/domain-sdk/workspace-host` defines the bounded, versioned locator, session,
  request/result/event, reconnect, egress, provider, and built-in operation contracts used by local
  and remote workspaces. A provider attaches only by a broker-authorized opaque session identity;
  it never decodes a capability token or SSH target in the generic registry.

Main runtime lifecycle contributions can subscribe to generic before-turn and terminal after-turn
events. System capability invocation cannot manufacture user approval. A nested destructive
operation may request `inherit-current-action`, which the host must reject unless execution is
already inside a matching approved outer action.

The same lifecycle context exposes a bounded Agent transcript projection. A package first reads a
thread snapshot, records its watermark and canonical message item IDs, then subscribes after that
sequence. Only accepted user messages and final assistant messages cross this boundary; streaming
deltas, reasoning, tools, approvals, and provider payloads do not. This lets projections mirror
desktop-origin messages without parsing Host-private runtime artifacts or creating another message
transport.

Trusted capability providers may register bounded `main.system-capability-grant` contributions.
A lifecycle contribution can request those public grant IDs only through its canonical manifest
contract. Before activating any runtime, the Host resolves requests against the installed provider
registrations; it then issues a package-scoped invoker whose caller identity and grants cannot be
chosen by the package runtime. An unknown or undeclared grant fails closed.
`eligibility: 'trusted-domain-runtime'` means every bundled trusted compile-time package is eligible
to request the provider-owned grant through its installed manifest; it is not a provider-maintained
consumer allowlist. Sandboxed or transport callers cannot request or carry these Host-issued grants.
Packages that require lifecycle grants or resource navigation declare Host API `1.1.0` as their
minimum; older Hosts reject those packages during catalog registration.

## Execution provenance and reproducibility

`@sciforge/domain-sdk/reproducibility` is the process-neutral contract shared by executable
domains, Full Trace, Evidence DAG, and Project DAG. It defines the versioned
`sciforge.execution-event.v1` envelope and the single `sciforge.rerun.v1` specification. Domains
publish owner-bound events through `DomainMainRuntimeLifecycleHost.executionEvents`; the Host
persists non-terminal events directly. A terminal event first crosses an owner-only, bounded,
atomic outbox acceptance boundary, is then written idempotently to Full Trace with the same stable
event ID, and only then reaches the generic `main.artifact-consumer` contribution. The outbox is
acknowledged only after every consumer accepts it; failed stages are retried with backoff and
replayed after Host restart. A package publisher returns once durable acceptance succeeds; bounded
delivery receipts absorb a repeated intent after a crash, including when the package version has
changed. Consumers therefore use the event watermark idempotently. The Host does not interpret a
package's workflow or executor payload.

Rerun specifications explicitly serialize activities, dependencies, inputs, code, environments,
parameter sets, tools, fresh approval requirements, outputs and comparators, secret slots, and
breakpoints. Missing executable metadata produces an exportable but blocked specification instead
of a guessed command. Historical approval is never an authorization for a rerun.

`canonicalizeReproValue` implements the canonical JSON bytes used for digests, and
`canonicalizeReproSpecForDigest` excludes only `specDigest`. Consumers must validate both the
strict schema and digest before use. See
[`docs/reproducible-dag-v3.zh-CN.md`](../../docs/reproducible-dag-v3.zh-CN.md) for ownership,
lineage, and comparison semantics.

Node-only domain services use stable SDK subpaths for shared host-independent runtime behavior:

- `@sciforge/domain-sdk/node/workspace-paths` provides workspace-confined path resolution and
  symlink-safe writes.
- `@sciforge/domain-sdk/node/electron-node-executable` resolves the executable used with
  `ELECTRON_RUN_AS_NODE`, including the packaged macOS Helper path and direct Windows/Linux
  executable paths.
- `@sciforge/domain-sdk/node/runtime-mcp-launcher` resolves the single generated domain MCP
  executable in source and packaged applications and carries the manifest contribution selector.

A trusted package that declares `main.runtime-mcp-server` exports the conventional
`./runtime-mcp` subpath with `runDomainRuntimeMcpServerFromArgv`. The domain package generator
validates that pairing and emits the contribution-ID-to-runner composition. Electron therefore
builds one stable `domain-runtime-mcp-node-entry` rather than one Host-configured entry per domain.
Removing the contribution or package removes its runner on the next composition generation.

Keeping these implementations in the SDK gives host services and domain packages one shared
boundary instead of copied platform or security logic.

Workspace Preview domains use `@sciforge/domain-sdk/workspace-preview` for the complete pure-data
wire contract, canonical manifest schema and helpers, provider contract, contribution kind IDs, and
process-neutral slot shapes. A preview package declares the same namespaced contribution ID in its
renderer and every declared backend entrypoint (`main` and/or `workspace-server`), stores that
manifest once in `contributionContracts`, and binds all runtime values to it. Generation,
process-entry binding, and host activation all fail closed on drift.

The SDK deliberately exposes only generic built-in observation/selection shapes plus namespaced
domain extension slots. A domain owns its concrete wire schema and encoder/decoder in its own
package; adding a modality must not add a new union branch or compatibility decoder to this SDK.

Agent visual understanding is a host-native runtime capability, not an installable domain. Domain
packages that own non-core resource renderers may contribute them through the pure
`@sciforge/domain-sdk/visual-source` contract. Visual sources are selected exactly by resource kind;
the host rejects duplicate ownership instead of using domain IDs, MIME switches, or priority
fallbacks. The SDK contract covers source rendering only. Inspection, region references,
persistence, completion receipts, and the agent-facing tools remain owned by the Agent Runtime.
