# `@sciforge/domain-sdk`

This package defines the pure-data boundary for trusted domain packages selected at build time.
It does not locate packages, dynamically import code, or execute untrusted JavaScript.

A domain package publishes one shared definition plus process-separated implementation entrypoints:

```text
@sciforge/domain-example
├── definition   # pure DomainPackageDefinition
├── main         # privileged main/worker implementation
└── renderer     # optional trusted renderer implementation
```

The definition declares fixed `./main` and optional `./renderer` exports. The application keeps one
generated installed definition set and projects it through `@sciforge/domain-sdk/main` or
`@sciforge/domain-sdk/renderer`. This lets each Electron build import only its own implementation
entrypoints while both builds use the same package selection and ownership metadata.

Every package exports the conventional names `domainPackageDefinition`, `createDomainMainEntry`,
and, when declared, `createDomainRendererEntry`. The repository generator scans
`packages/domains/*/sciforge.domain.json`, sorts by package name, and emits static imports. It never
imports a process entry that the manifest does not declare.

`defineInstalledDomainPackageSet` is the single process-neutral source of installed definitions.
After a process imports only its own package entrypoints, `defineInstalledMainDomainEntrySet` or
`defineInstalledRendererDomainEntrySet` binds the declarations to runtime values. Pairing is exact
by `kind:id`; missing, extra, duplicate, or mismatched entries fail before contributions are
exposed. There is deliberately no cross-process runtime bundle and no dynamic package loader.

Node-only domain services use stable SDK subpaths for shared host-independent runtime behavior:

- `@sciforge/domain-sdk/node/workspace-paths` provides workspace-confined path resolution and
  symlink-safe writes.
- `@sciforge/domain-sdk/node/electron-node-executable` resolves the executable used with
  `ELECTRON_RUN_AS_NODE`, including the packaged macOS Helper path and direct Windows/Linux
  executable paths.

Keeping these implementations in the SDK gives host services and domain packages one shared
boundary instead of copied platform or security logic.

Workspace Preview domains use `@sciforge/domain-sdk/workspace-preview` for the complete pure-data
wire contract, canonical manifest schema and helpers, provider contract, contribution kind IDs, and
process-neutral slot shapes. A preview package declares the same namespaced contribution ID in its
main and renderer entrypoints, stores that manifest once in `contributionContracts`, and binds both
runtime values to it. Generation, process-entry binding, and host activation all fail closed on drift.

The SDK deliberately exposes only generic built-in observation/selection shapes plus namespaced
domain extension slots. A domain owns its concrete wire schema and encoder/decoder in its own
package; adding a modality must not add a new union branch or compatibility decoder to this SDK.

Agent visual understanding is a host-native runtime capability, not an installable domain. Domain
packages that own non-core resource renderers may contribute them through the pure
`@sciforge/domain-sdk/visual-source` contract. Visual sources are selected exactly by resource kind;
the host rejects duplicate ownership instead of using domain IDs, MIME switches, or priority
fallbacks. The SDK contract covers source rendering only. Inspection, region references,
persistence, completion receipts, and the agent-facing tools remain owned by the Agent Runtime.
