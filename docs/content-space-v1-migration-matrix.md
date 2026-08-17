# Content Space V1 migration matrix

Baseline: `upstream/gui@063155e8d378693bfeba5a926e12b74eeafb3cf8`.
Reference implementation: `origin/contentspace@c64cf828ef8307514c089df6b4430cbd2659c5ac`.

This matrix records the semantic migration decision before implementation. The
latest `gui` architecture is authoritative; paths below describe the intended
latest-architecture ownership rather than a commit-level replay.

| Old `contentspace` capability | Equivalent in latest `gui` | Decision | Latest-architecture files and tests |
| --- | --- | --- | --- |
| `PrincipalSnapshot` and Host principal provider | No generic equivalent. Collaboration principals and model-account state are domain-specific and do not enter the Capability Broker. | Reimplement as a generic, credential-free SDK contract and Host-owned current-principal context. Raw renderer/agent payloads must never choose the principal. | `packages/domain-sdk/src/principal.ts`; `src/main/principal-context.ts`; SDK/context tests |
| Local account persistence and selection | No equivalent account selector. The existing installation ID can supply device attribution. | Adapt the store/service semantics into an independent `identity-access` domain package; rewrite its renderer contribution against the current generic command/toolbar/overlay host. | `packages/domains/identity-access/**`; manifest, main and renderer tests |
| UI/Agent/system principal propagation | Current callers carry audience, workspace and approvals, but no Principal. Latest system grants and durable agent/runtime governance are newer than the old branch. | Surgically add Host-injected principal context to the canonical Broker path while preserving current owner-scoped grants, durability and runtime governance. Separate historical turn attribution from live write reauthorization where durable turn state is involved. | shared Broker contract; main Broker/IPC/system/agent runtime tests |
| Portable reference envelope and codecs | No portable equivalent. The Broker already owns process-local `res_*`/`cap_*` handles, retention and observation. | Adapt the bounded four-field envelope and domain codecs. Rewrite canonical cloning, exact kind-to-resolver binding, owner-bound export, Principal isolation, fresh reauthorization and Artifact proof validation. | `packages/domain-sdk/src/portable-resource-references.ts`; generic Host materialization service; Content Space codecs/resolver; tests |
| Old Host portable-reference registry | No equivalent, but latest `main.extension`, lifecycle contribution host and Broker are the canonical generic mechanisms. | Reimplement as a generic owner-scoped Host service composed from validated extensions. Do not restore the old registry, cached observations or caller-supplied consumer identity. | public SDK host port; main composition/service tests |
| Document and Content Space provider factories | No provider catalog, but generic `main.extension` values are validated and projected before lifecycle activation. | Represent the two independent contracts as exact `main.extension` locations. Add a trusted Provider Instance Directory and domain-owned catalogs; validate declaration/runtime/version/owner independently and fail closed. | `packages/domain-sdk/src/provider-composition.ts`; runtime contribution projection; provider catalog tests |
| Old `DomainMainHost.mainContributions`, `providerInstances` and Host provider-composition module | Replaced by `DomainMainRuntimeLifecycleContext.contributions`, owner-scoped hosts and generated application composition. | Delete from the migration. Content Space constructs its catalog/service lazily during lifecycle activation. | current `runtime-contributions.ts`; Content Space main lifecycle tests |
| Content Space contracts and Provider SPI | No equivalent domain. | Retain domain semantics, but strengthen bounded results, exact Provider Instance binding, cancellation, invocation identity, collision/outcome-unknown behavior and immutable Artifact proof. | `packages/domains/content-space/src/{contract,main}/**`; package tests/typecheck |
| Mock Content Space provider | No equivalent. | Adapt as a local, deterministic trusted package contributing a factory and directory entry through its manifest. Construction must not perform I/O or read credentials. | `packages/domains/content-space-mock-provider/**`; package tests/typecheck |
| Content Space renderer panel | Latest generic command, toolbar action, right panel, global overlay and resource-navigation hosts are equivalent and more general. | Rewrite against the current renderer contribution contract. Add create-folder, upload-new, download, safe portal and race-safe cancellation without a parallel registry or Host feature map. | Content Space renderer entry/components/tests; generic capability cancellation transport tests |
| Download destination and portal target | Latest picker/external URL paths do not provide a Host-owned download destination or hide provider token URLs. | Add generic opaque Host grants: destination handles and short-lived, single-use, Principal-bound portal targets. Renderer never receives local paths, credentials or token URLs. | generic Host ports/modules and security tests |
| Generated package composition | Latest generator is owner-scoped and covers definition/main/renderer independently. | Regenerate only with the latest generator. Never copy or hand-edit old generated files/templates. | `scripts/domain-packages.mjs`; generated files; generator/freshness/source/packaged tests |
| Old renderer application-overlay/toolbar-widget registries | Superseded by the current generic renderer contribution host. | Delete from the migration. | existing generic renderer registries and their tests |
| Portable/provider/content-space OpenSpec and ADR 0025 | Absent from the latest baseline; archived versions describe the old integration shape. | Preserve requirements and history, but rewrite paths, composition model and evidence for the final latest architecture. Keep Shared Documents deferred. | updated main specs, archived changes, ADR 0025 and OpenContent follow-up ordering |

## Canonical target paths

```text
UI / Agent / system caller
  -> Capability Broker (Host-injected current Principal)
  -> Content Space capability handler
  -> ContentSpaceService
  -> trusted ProviderInstanceRef directory
  -> ContentSpaceProviderCatalog
  -> exact pinned ContentSpaceProvider
  -> operation

serialized portable reference
  -> bounded canonical envelope
  -> exact kind codec
  -> codec-bound resolver
  -> trusted ProviderInstanceRef resolution
  -> current-Principal reauthorization
  -> Principal-scoped process-local Broker resource
```

## Explicit non-migrations

The migration will not restore a central Provider map or switch, a default or
fallback Provider, provider/vendor/domain-specific Host routing, parallel IPC or
renderer registries, MIME/extension routing, Host-private imports from domain
packages, Shared Documents, OpenContent networking, credentials, or any of the
deferred mutation/collaboration operations.
