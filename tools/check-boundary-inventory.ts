import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type InventoryEntry = {
  id: string;
  owns: string;
  paths: string[];
  checks: string[];
  notes: string[];
};

type LongFilePlan = {
  path: string;
  ownerBoundary: 'src-runtime' | 'src-ui';
  target: string;
  extractionPlan: string[];
};

const root = process.cwd();

const fixedPlatform: InventoryEntry[] = [
  {
    id: 'app-shell-ui-orchestration',
    owns: 'App shell, session state, chat/results orchestration, and runtime-facing UI clients.',
    paths: ['src/ui/src/App.tsx', 'src/ui/src/app', 'src/ui/src/api'],
    checks: ['smoke:module-boundaries', 'smoke:no-src-capability-semantics'],
    notes: ['UI may render package components through public package exports, but must not own package capability semantics.'],
  },
  {
    id: 'workspace-writer-server',
    owns: 'Local workspace HTTP API, path containment, file/open endpoints, scenario writer, and feedback/repair handoff endpoints.',
    paths: ['src/runtime/workspace-server.ts', 'src/runtime/server'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:module-boundaries'],
    notes: ['Packages can describe artifacts and actions; workspace write lifecycle stays here.'],
  },
  {
    id: 'runtime-gateway-transport',
    owns: 'AgentServer transport, request envelopes, stream normalization, timeout/resume handling, and backend diagnostics.',
    paths: ['src/runtime/generation-gateway.ts', 'src/runtime/gateway'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:runtime-gateway-modules'],
    notes: ['Transport can expose capability briefs, not domain-specific routing branches.'],
  },
  {
    id: 'conversation-policy-bridge',
    owns: 'Runtime bridge to the Python policy package and bounded projection of policy fields into gateway context.',
    paths: ['src/runtime/conversation-policy', 'packages/reasoning/conversation-policy'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:package-runtime-boundary'],
    notes: ['The Python package is a tracked migration surface for T122 runtime lifecycle ownership terms.'],
  },
  {
    id: 'capability-registry-loader-broker-shell',
    owns: 'Registry loading, availability validation, matching shell, and runtime skill/package discovery.',
    paths: ['src/runtime/skill-registry.ts', 'src/runtime/skill-registry', 'src/runtime/skill-markdown-catalog.ts'],
    checks: ['smoke:capability-manifest-registry', 'smoke:workspace-package-metadata'],
    notes: ['Package manifests provide ability metadata; src owns loading and selection plumbing.'],
  },
  {
    id: 'validation-repair-loop',
    owns: 'ToolPayload validation, verifier policy normalization, repair prompts, generated task reruns, and failure handoff.',
    paths: ['src/runtime/gateway/payload-validation.ts', 'src/runtime/gateway/repair-policy.ts', 'src/runtime/gateway/verification-policy.ts', 'src/runtime/repair-handoff-runner.ts'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:runtime-gateway-modules'],
    notes: ['Package validators can check local contracts; src owns the global validation and repair loop.'],
  },
  {
    id: 'refs-artifacts-persistence',
    owns: 'Workspace refs, artifact materialization, preview/raw APIs, object ref handoff, and task result persistence.',
    paths: ['src/runtime/gateway/artifact-materializer.ts', 'src/runtime/gateway/artifact-reference-context.ts', 'src/runtime/server/file-preview.ts', 'src/runtime/workspace-paths.ts'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:package-runtime-boundary'],
    notes: ['Packages may emit artifact refs and schemas, but cannot own persistence or workspace ref resolution.'],
  },
  {
    id: 'permission-safety-sandbox',
    owns: 'Runtime safety gates, action confirmation boundaries, sandbox policy, and external action containment.',
    paths: ['src/runtime/computer-use', 'src/runtime/vision-sense', 'src/runtime/sciforge-tools.ts'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:no-src-capability-semantics'],
    notes: ['Action packages can declare local safety requirements; runtime keeps the global safety boundary.'],
  },
  {
    id: 'ledger-task-projects-work-evidence',
    owns: 'Capability evolution ledger, task project lifecycle, WorkEvidence projection, and attempt history.',
    paths: ['src/runtime/capability-evolution-ledger.ts', 'src/runtime/task-projects.ts', 'src/runtime/task-attempt-history.ts', 'src/runtime/gateway/work-evidence-guard.ts'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:runtime-gateway-modules'],
    notes: ['Ledger and task lifecycle are platform facts; package capabilities can provide provider-local evidence.'],
  },
  {
    id: 'boundary-smoke-guards',
    owns: 'Import topology, src/package ownership, package metadata, catalog discovery, and long-file budget checks.',
    paths: ['tools/check-module-boundaries.ts', 'tools/check-fixed-platform-boundary.ts', 'tools/check-no-src-capability-semantics.ts', 'tools/check-package-runtime-boundary.ts', 'tools/check-package-catalog.ts', 'tools/check-workspace-package-metadata.ts', 'tools/check-long-file-budget.ts'],
    checks: ['smoke:module-boundaries', 'smoke:fixed-platform-boundary', 'smoke:no-src-capability-semantics', 'packages:check', 'smoke:long-file-budget'],
    notes: ['This inventory is advisory and path-checked; the listed smoke commands remain enforcement.'],
  },
];

const pluggableCapabilities: InventoryEntry[] = [
  {
    id: 'runtime-contracts',
    owns: 'Stable shared runtime contracts for capabilities, handoff, artifacts, refs, observe, execution, stream, and validation failure shapes.',
    paths: ['packages/contracts/runtime'],
    checks: ['smoke:stable-runtime-contracts', 'smoke:runtime-contracts', 'packages:check'],
    notes: ['Contracts are shared API surface, not runtime lifecycle implementation.'],
  },
  {
    id: 'skills',
    owns: 'Agent-facing SKILL.md packages, generated skill catalog, tool/pipeline/domain/meta skill organization, and skill descriptions.',
    paths: ['packages/skills'],
    checks: ['skills:generate', 'smoke:capability-manifest-registry', 'packages:check'],
    notes: ['Skills expose abilities to the agent; external side effects must route through action boundaries.'],
  },
  {
    id: 'observe-providers',
    owns: 'Read-only observe providers, modality adapters, trace contracts, and observe-specific tests.',
    paths: ['packages/observe', 'packages/observe/vision'],
    checks: ['smoke:vision-sense-runtime', 'packages:check'],
    notes: ['Observe providers return bounded text/artifact refs and must not mutate the environment.'],
  },
  {
    id: 'action-providers',
    owns: 'Environment-changing providers, action manifests, provider-local safety declarations, trace, rollback, and approval requirements.',
    paths: ['packages/actions', 'packages/actions/computer-use'],
    checks: ['smoke:package-runtime-boundary', 'packages:check'],
    notes: ['Provider-local safety does not replace runtime global permission/safety policy.'],
  },
  {
    id: 'verifiers',
    owns: 'Verifier manifests, fixtures, agent/rule/schema verifier providers, verdict contracts, and repair hints.',
    paths: ['packages/verifiers'],
    checks: ['smoke:package-runtime-boundary', 'packages:check'],
    notes: ['Verifiers judge results and evidence; src orchestrates when verifier results gate a run.'],
  },
  {
    id: 'interactive-views',
    owns: 'Artifact renderer manifests, schemas, fixtures, workbench demos, and component registry exports.',
    paths: ['packages/presentation/components', 'packages/presentation/interactive-views'],
    checks: ['ui-components:check', 'smoke:view', 'smoke:runtime-ui-manifest', 'packages:check'],
    notes: ['Views render data and emit UI events; they do not write workspace files or call AgentServer directly.'],
  },
  {
    id: 'design-system',
    owns: 'Presentation primitives, tokens, and package-local UI helpers reused by renderers.',
    paths: ['packages/presentation/design-system'],
    checks: ['smoke:design-system', 'packages:check'],
    notes: ['Design-system primitives are UI support, not artifact renderer registry ownership.'],
  },
  {
    id: 'scenario-core',
    owns: 'Scenario package contracts, compiler helpers, validation gates, quality gates, and scenario fixtures.',
    paths: ['packages/scenarios/core'],
    checks: ['smoke:docs-scenario-package', 'smoke:workspace-scenarios', 'packages:check'],
    notes: ['Scenario packages describe domain customization and must not become semantic routing in src.'],
  },
  {
    id: 'reasoning-conversation-policy',
    owns: 'Conversation strategy algorithms, classifier policy, context/recovery planning, and Python fixtures.',
    paths: ['packages/reasoning/conversation-policy'],
    checks: ['smoke:fixed-platform-boundary', 'smoke:package-runtime-boundary'],
    notes: ['T122 tracks existing lifecycle/ref/artifact/stream terms here until runtime ownership is migrated or wording is reduced.'],
  },
  {
    id: 'support-helpers',
    owns: 'Package-level artifact preview and object reference helpers that sit below runtime orchestration.',
    paths: ['packages/support/artifact-preview', 'packages/support/object-references', 'packages/support/templates/package-scaffold'],
    checks: ['smoke:object-references', 'smoke:capability-manifest-registry', 'packages:check'],
    notes: ['Pure contract types should move to packages/contracts/runtime before helpers consume them.'],
  },
];

const boundaryHeavyLongFiles: LongFilePlan[] = [
  {
    path: 'src/runtime/generation-gateway.ts',
    ownerBoundary: 'src-runtime',
    target: 'Keep under the 1500-line task threshold by moving gateway-only subflows into src/runtime/gateway/*.',
    extractionPlan: ['stream/resume watchdog helpers', 'repair rerun adapter calls', 'task project handoff assembly'],
  },
  {
    path: 'src/runtime/workspace-server.ts',
    ownerBoundary: 'src-runtime',
    target: 'Keep HTTP route registration thin and move endpoint families into src/runtime/server/* modules.',
    extractionPlan: ['scenario routes', 'feedback/repair endpoints', 'file/open/preview route handlers'],
  },
  {
    path: 'src/ui/src/app/ResultsRenderer.tsx',
    ownerBoundary: 'src-ui',
    target: 'Keep the top-level result renderer as composition only and move card/control helpers into src/ui/src/app/results/*.',
    extractionPlan: ['artifact preview selection', 'execution notebook panels', 'handoff/export controls'],
  },
  {
    path: 'src/ui/src/app/ChatPanel.tsx',
    ownerBoundary: 'src-ui',
    target: 'Keep ChatPanel as orchestration only and move composer, target, run, and message presentation into src/ui/src/app/chat/*.',
    extractionPlan: ['run status projection', 'message list transforms', 'composer reference wiring'],
  },
  {
    path: 'src/runtime/workspace-task-input.ts',
    ownerBoundary: 'src-runtime',
    target: 'Keep bounded handoff assembly separate from artifact/ref digest and retention policy helpers.',
    extractionPlan: ['artifact digest helpers', 'retention/budget reducers', 'task input fixture builders'],
  },
  {
    path: 'src/runtime/gateway/agentserver-prompts.ts',
    ownerBoundary: 'src-runtime',
    target: 'Keep prompt contract text modular without moving platform policy into packages.',
    extractionPlan: ['mode contract copy', 'capability brief copy', 'repair/validation instruction copy'],
  },
];

const inventory = {
  schemaVersion: 1,
  purpose: 'T122 fixed-platform and pluggable-capability boundary inventory.',
  fixedPlatform,
  pluggableCapabilities,
  boundaryHeavyLongFiles,
  enforcement: [
    'npm run smoke:fixed-platform-boundary',
    'npm run packages:check',
    'npm run smoke:module-boundaries',
    'npm run smoke:no-src-capability-semantics',
    'npm run smoke:long-file-budget',
  ],
};

const missingPaths: string[] = [];
for (const entry of [...fixedPlatform, ...pluggableCapabilities]) {
  for (const path of entry.paths) await recordMissingPath(path);
}
for (const entry of boundaryHeavyLongFiles) await recordMissingPath(entry.path);

if (missingPaths.length) {
  console.error('[boundary-inventory] inventory paths are missing:');
  for (const path of missingPaths) console.error(`- ${path}`);
  process.exitCode = 1;
} else {
  const lineCounts = Object.fromEntries(await Promise.all(
    boundaryHeavyLongFiles.map(async (entry) => [entry.path, await lineCount(entry.path)]),
  ));
  console.log(JSON.stringify({ ok: true, ...inventory, currentLongFileLineCounts: lineCounts }, null, 2));
}

async function recordMissingPath(path: string) {
  try {
    await access(join(root, path));
  } catch {
    missingPaths.push(path);
  }
}

async function lineCount(path: string) {
  const text = await readFile(join(root, path), 'utf8');
  return text.split('\n').length;
}
