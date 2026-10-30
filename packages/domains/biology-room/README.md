# `@sciforge/domain-biology-room`

Trusted compile-time Biology Room package for SciForge. The package owns its manifest, public
contract, persistent main-process service, Broker capability factory, and service lifecycle.

- `./definition` exports the pure `domainPackageDefinition` used during package discovery.
- `./contract` exports schemas, types, capability IDs, and the resource kind.
- `./main` exports `createDomainMainEntry` and `BiologyRoomService` for the main process.

There is no renderer entrypoint. Biology files use the generic Workspace Preview renderer chain,
and every Biology Room operation uses the Capability Broker contribution declared in
`sciforge.domain.json`.

Run `npm test` and `npm run typecheck` from this directory for package-local verification.
