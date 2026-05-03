# @bioagent/scenario-core

## Agent quick contract

`@bioagent/scenario-core` is the UI-independent compiler for BioAgent scenario packages. It accepts package manifests and scenario selections, then emits stable runtime contracts:

- inputs: skill manifests from `packages/skills`, tool manifests from `packages/tools`, UI component manifests from `packages/ui-components`, built-in scenario specs, and user draft or selection objects
- outputs: `ScenarioPackage`, `ScenarioIR`, `SkillPlan`, `UIPlan`, `ValidationReport`, `ScenarioQualityReport`, and `ElementRegistry`
- main API: `buildElementRegistry`, `compileScenarioIRFromSelection`, `compileScenarioDraft`, `buildBuiltInScenarioPackage`, `validateScenarioPackage`, `runScenarioRuntimeSmoke`, and `buildScenarioQualityReport`

Node callers can import the package directly:

```ts
import { buildBuiltInScenarioPackage, runScenarioRuntimeSmoke } from '@bioagent/scenario-core';

const pkg = buildBuiltInScenarioPackage('literature-evidence-review');
const smoke = await runScenarioRuntimeSmoke({ package: pkg, mode: 'dry-run' });
```

## Human notes

The compiler core should stay free of React components, browser APIs, and page-local state. Scenario Builder and other UI files may keep local interaction state, but they should call this package for contract compilation and validation.

Extend the registry through package manifests:

- add skills under `packages/skills` and regenerate the skill catalog
- add tools under `packages/tools` and regenerate the tool catalog
- add UI component manifests under `packages/ui-components`

Do not hard-code page-only capabilities into compiler logic. If a new artifact, component, failure policy, or role rule is needed by AgentServer or CLI, model it as package/compiler data first, then let the UI render it.
