# `@sciforge/domain-paper-radar`

Trusted compile-time Paper Radar domain package. It owns the domain contract, main-process
capabilities and service adapter, renderer panel and capability client, and renderer translations.

The package intentionally has no root export. Consumers must select exactly one boundary:

- `./definition` is pure data and is the only entry used by shared installation selection.
- `./main` contains privileged service and capability implementations.
- `./renderer` contains UI and renderer adapters.
- `./contract` contains process-neutral Paper Radar schemas and types.

`sciforge.domain.json` is the single manifest source; `./definition` validates and exposes it through
the domain SDK. The repository generator discovers the package automatically and emits only the
process entrypoints declared by this manifest. No Paper-specific application registry is required.
