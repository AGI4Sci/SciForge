# @sciforge-ui/runtime-contract

## Agent quick contract
- package: `@sciforge-ui/runtime-contract`
- purpose: stable type contracts for SciForge UI component manifests, runtime artifacts, renderer props, render slots, helper callbacks, safety metadata, and presentation metadata
- use when: authoring a component package that should compile without importing `../types` from `@sciforge-ui/components`
- exports: `UIComponentManifest`, `UIComponentRendererProps`, `UIComponentRuntimeArtifact`, `UIComponentRenderSlot`, `UIComponentRenderHelpers`, `UIComponentRenderer`, `UIComponentWorkbenchDemo`, lifecycle/section/dedupe string unions
- dependency policy: type-only React dependency for `ReactNode`; no app-private imports, no renderer implementation, no workspace or browser logic
- compatibility: `packages/ui-components/types.ts` re-exports this package during the migration window

## Human notes

### Contract boundary
This package is the stable runtime-contract surface for independently published SciForge UI components. It should contain only serializable manifest/runtime metadata and renderer prop types that package authors need at compile time.

### What belongs here
Keep manifest metadata, artifact envelopes, render slot shape, renderer helper signatures, presentation metadata, safety metadata, and workbench demo payload types here. Changes should be backward-compatible whenever possible because published component packages may depend on these names directly.

### What does not belong here
Do not add SciForge app state, private UI implementation details, registry logic, planner logic, Workbench seed data, browser APIs, data fetching code, renderer implementations, or component-specific schemas. Those remain in the app, package manifests, primitive schema files, or individual component packages.

### Migration notes
New component manifests should import types from `@sciforge-ui/runtime-contract`. Existing package code that imports from `packages/ui-components/types.ts` can keep working because that file re-exports this package, but it should be migrated before independent publication.

### Testing and publishing
Run `npm run typecheck` after contract changes. Component package checks should reject app-private imports and encourage direct dependency on `@sciforge-ui/runtime-contract` instead of sibling relative type paths.
