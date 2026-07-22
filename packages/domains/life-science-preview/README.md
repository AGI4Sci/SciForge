# `@sciforge/domain-life-science-preview`

Trusted compile-time Workspace Preview package for SciForge's life-science formats. One package
owns the canonical preview manifests and their format routing, main providers, renderer contributions, and
Mol* lifecycle hook for molecular, sequence/genomics, omics, bioimaging, spectra, and passive
Biology index transport previews.

The package intentionally has no process-ambiguous root export:

- `./definition` validates and exports the JSON-backed installed package definition.
- `./contract` exports the ordered canonical manifests and contribution-to-manifest contracts.
- `./main` owns privileged providers and worker orchestration.
- `./renderer` owns preview UI and trusted renderer lifecycle contributions.
- `./workspace-preview-wire` owns the breaking, bounded v2 encoding for all life-science selections
  and observation metadata. There is intentionally no legacy decoder.

`sciforge.domain.json` is the single source for canonical manifest JSON. Main and renderer publish
the same namespaced preview contribution IDs and must use the exact frozen manifest objects exposed
by `./contract`. Package code depends on the stable `@sciforge/domain-sdk/workspace-preview`
boundary and must not import application-private `src` or `@shared` modules.

The host sees only namespaced modalities, generic `kind: "domain"` selections, and bounded
`pluginMetadata`. Renderer/provider code restores the package-local typed facade at the package
boundary. Observation arrays are truncated with explicit flags; oversized selections are rejected.

Run `npm test` and `npm run typecheck` from this directory for package-local verification. Domain
package composition is generated only after both process entrypoints are present.
