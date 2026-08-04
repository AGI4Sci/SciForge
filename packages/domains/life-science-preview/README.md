# `@sciforge/domain-life-science-preview`

Trusted compile-time Workspace Preview package for SciForge's life-science formats. One package
owns the canonical preview manifests and their format routing, main and Workspace Host providers,
renderer contributions, and Mol* lifecycle hook for molecular, sequence/genomics, omics,
bioimaging, spectra, and passive Biology index transport previews.

The package intentionally has no process-ambiguous root export:

- `./definition` validates and exports the JSON-backed installed package definition.
- `./contract` exports the ordered canonical manifests and contribution-to-manifest contracts.
- `./main` owns privileged providers and worker orchestration.
- `./renderer` owns preview UI and trusted renderer lifecycle contributions.
- `./workspace-server` runs the same package-owned providers beside remote workspace data. The
  matching renderer remains local and there is no local-provider fallback for a remote asset.
- `./workspace-preview-wire` owns the breaking, bounded v2 encoding for all life-science selections
  and observation metadata. There is intentionally no legacy decoder.

`sciforge.domain.json` is the single source for canonical manifest JSON. Main, renderer, and
Workspace Server publish the same namespaced preview contribution IDs and must use the exact
frozen manifest objects exposed by `./contract`. Package code depends on the stable
`@sciforge/domain-sdk/workspace-preview` and `@sciforge/domain-sdk/workspace-server` boundaries and
must not import application-private `src` or `@shared` modules.

The host sees only namespaced modalities, generic `kind: "domain"` selections, and bounded
`pluginMetadata`. Renderer/provider code restores the package-local typed facade at the package
boundary. Observation arrays are truncated with explicit flags; oversized selections are rejected.
Text observations read at most 2 MB and binary observations at most 4 MB on the owning Workspace
Host, so large cluster sources are not copied to the desktop as an implicit preview fallback.

Run `npm test` and `npm run typecheck` from this directory for package-local verification. Domain
package composition is generated only after every declared process entrypoint is present.
