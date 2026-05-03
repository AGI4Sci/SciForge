# SciForge UI Component Package Boundary

Run the boundary check before treating a UI component as independently publishable:

```sh
npm --workspace @sciforge-ui/components run packages:check
```

From the repository root, the broader package gate also runs the UI component boundary check after the existing skill/package catalog check:

```sh
npm run packages:check
```

The check verifies that each component package has the minimum package surface:

- `package.json`, `README.md`, and `manifest.ts`
- `README.md` with an `Agent quick contract` section
- `package.json` `files` coverage for README, manifest, fixtures, renderer, assets, and workbench demo assets when present
- `package.json` `exports` coverage for manifest, README, `fixtures/basic`, `fixtures/empty`, renderer, assets, and workbench demo assets when present
- `fixtures/basic` and `fixtures/empty` presence
- interactive components include a selection/open-ref fixture
- errors for app-private imports or sibling component relative imports
- whether `packages/ui-components/index.ts` exports the component manifest

Published components are strict: missing package resources fail the command. Draft skeleton packages are included in the same scan, but incomplete publish resources are reported as warnings so the acceptance gate can stay usable while draft package bodies are being filled in.

The script is intentionally read-only for component implementation files. It reports missing resources so follow-up package work can add fixtures, renderers, assets, or root index exports without changing unrelated component logic.
