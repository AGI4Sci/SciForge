# @sciforge/paper-radar

SQLite-backed service and metadata core for the Paper Radar domain package.

## Ownership

This package owns storage, source synchronization, profile persistence, search, ranking, digest generation, and minimal write-audit records. It exposes only the public `./service` and `./contract` APIs consumed by `@sciforge/domain-paper-radar`.

Desktop releases compile this package into the Paper Radar domain main entry. Its TypeScript source is not shipped as a second runtime path.

The domain package owns the user-facing actions and routes them through the Capability Broker. This worker package does not publish a standalone agent protocol server, command-line entrypoint, or second set of business operation names.

## Storage

Path resolution is:

1. `PAPER_RADAR_DB` and `PAPER_RADAR_PROFILES`.
2. `PAPER_RADAR_USER_DATA`, resolved as:
   - `<userData>/paper-radar/paper-radar.sqlite`
   - `<userData>/paper-radar/profiles.json`
3. Standalone service fallback:
   - `~/.sciforge/paper-radar.sqlite`
   - `~/.sciforge/paper-radar-profiles.json`

## Verification

```bash
npm --workspace @sciforge/paper-radar run test
npm --workspace @sciforge/paper-radar run typecheck
```

The domain package declares writes as Broker mutations requiring confirmation. Once the Broker authorizes an invocation, this service executes it directly; it does not maintain a second confirmation protocol. Completed writes and failures add minimal audit records without storing keywords, abstracts, credentials, or large payloads.
