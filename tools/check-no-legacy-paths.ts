import { access, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
  text: string;
  migration?: string;
};

type Rule = {
  id: string;
  message: string;
  appliesTo: (file: string) => boolean;
  match: (line: string, file: string) => boolean;
};

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage', '__pycache__']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

const rules: Rule[] = [
  {
    id: 'ui-semantic-fallback',
    message: 'UI code owns semantic fallback routing that should come from manifests, view policy, or package-owned compatibility aliases.',
    appliesTo: (file) => file.startsWith('src/ui/src/'),
    match: (line) => isCodeLine(line)
      && /\bfallback\b/i.test(line)
      && /\b(artifact|component|module|view|renderer|scenario|domain|provider|producer|consumer|schema|slot|unknown-artifact|generic-(?:data-table|artifact-inspector))\b/i.test(line)
      && !/<Suspense\s+fallback=/.test(line),
  },
  {
    id: 'provider-scenario-prompt-special-case',
    message: 'Runtime/UI code carries provider, scenario, or prompt special-case branching that should be manifest/catalog driven.',
    appliesTo: isLegacyPolicySurface,
    match: isProviderScenarioPromptSpecialCaseLine,
  },
  {
    id: 'legacy-adapter-compat-reexport',
    message: 'Legacy adapter/compat modules are re-exported instead of being cut over to stable package/runtime entrypoints.',
    appliesTo: (file) => file.startsWith('src/') || file.startsWith('packages/'),
    match: (line, file) => isCodeLine(line)
      && /^export\s+(?:\*|\{|\w)/.test(line.trim())
      && /\bfrom\b/.test(line)
      && /\b(adapter|compat|compatibility|legacy)\b/i.test(`${file} ${line}`),
  },
  {
    id: 'legacy-package-facade-reexport',
    message: 'UI legacy facade re-exports package-owned scenario APIs instead of importing stable package entrypoints directly.',
    appliesTo: (file) => file.startsWith('src/ui/src/'),
    match: (line, file) => isCodeLine(line)
      && /^export\s+(?:\*|\{|\w)/.test(line.trim())
      && /\bfrom\s+['"]@sciforge\/scenario-core\//.test(line)
      && (/^src\/ui\/src\/scenarioCompiler\//.test(file) || file === 'src/ui/src/scenarioSpecs.ts'),
  },
  {
    id: 'gateway-validation-failure-assembly',
    message: 'Gateway owns ContractValidationFailure assembly that should stay in packages/contracts/runtime/validation-failure.',
    appliesTo: (file) => file === 'src/runtime/gateway/payload-validation.ts',
    match: (line) => isCodeLine(line)
      && /^(?:export\s+)?(?:function|interface)\s+(?:contractValidationFailureFromErrors|contractValidationFailureFromRepairReason|ContractValidationFailureOptions|contractValidationIssueFromError|runtimeGuardIssueForError|recoverActionsForValidationFailure|nextStepForValidationFailure|validationScopeForSchemaErrors|validationScopeForRepairReason)\b/.test(line.trim()),
  },
  {
    id: 'sa-direct-context-local-strategy',
    message: 'Runtime Bridge must not own direct-context prompt classification or promptRequires strategy; consume structured decisions instead.',
    appliesTo: (file) => file.startsWith('src/runtime/gateway/'),
    match: (line) => isCodeLine(line)
      && (/\bdirectContextIntent\s*\(/.test(line) || /\bpromptRequires[A-Z]\w*\s*\(/.test(line)),
  },
  {
    id: 'sa-runtime-visible-preflight',
    message: 'Runtime Bridge must not call capability provider preflight as a visible strategy path; Gateway internals must stay behind execute.',
    appliesTo: (file) => file.startsWith('src/runtime/'),
    match: (line) => isCodeLine(line)
      && /\bcapabilityProviderPreflight\s*\(/.test(line)
      && !/^export\s+function\b/.test(line.trim()),
  },
  {
    id: 'sa-gateway-public-api-internal-stage',
    message: 'Runtime Bridge must not call Gateway internal route/preflight/invoke/materialize/validate stages; public API stays execute-only.',
    appliesTo: (file) => file.startsWith('src/runtime/')
      && !file.startsWith('src/runtime/gateway/')
      && file !== 'src/runtime/generation-gateway.ts',
    match: (line) => isCodeLine(line)
      && /\bGateway\.(?:resolveRoute|preflight|invoke|materialize|validate)\s*\(/.test(line),
  },
  {
    id: 'sa-direct-context-implicit-strategy',
    message: 'Direct-context fast path must consume explicit DirectContextDecision, not derive strategy from harness hints or turn constraints.',
    appliesTo: (file) => file === 'src/runtime/gateway/direct-context-fast-path.ts',
    match: (line) => isCodeLine(line)
      && /\b(?:agentHarness|turnExecutionConstraints|preferredCapabilityIds|intentMode)\b/.test(line),
  },
  {
    id: 'sa-provider-discovery-endpoint-leak',
    message: 'AgentServer worker discovery must normalize to ProviderManifest projection and must not spread endpoint-shaped worker records.',
    appliesTo: (file) => file === 'src/runtime/gateway/capability-provider-preflight.ts',
    match: (line) => isCodeLine(line)
      && /\.\.\.record\b/.test(line),
  },
  {
    id: 'sa-runtime-user-text-inspection',
    message: 'Runtime TurnPipeline/RunStateMachine executors must not inspect user text; routing facts must arrive as structured refs/decisions.',
    appliesTo: (file) => file.startsWith('src/runtime/conversation-kernel/'),
    match: (line) => isCodeLine(line)
      && /\b(?:prompt|userText|content)\b.*\.(?:includes|match|test|startsWith|endsWith)\s*\(/.test(line),
  },
  {
    id: 'sa-runtime-harness-policy-body',
    message: 'Runtime Bridge must consume Harness policy as decision/contract/trace refs, not inline semantic policy bodies.',
    appliesTo: (file) => file.startsWith('src/runtime/conversation-kernel/'),
    match: (line) => isCodeLine(line)
      && /\b(?:domainSemantics|semanticPolicy|harnessPolicyBody|policyBody)\b/.test(line),
  },
  {
    id: 'sa-degraded-raw-context-shape',
    message: 'Single-Agent degraded handoff packets must stay refs-first and must not grow raw history/full ref list/compaction state fields.',
    appliesTo: (file) => file.startsWith('src/runtime/gateway/'),
    match: (line) => isCodeLine(line)
      && /\b(?:recentTurns|fullRefList|rawHistory|compactionState)\b/.test(line),
  },
  {
    id: 'sa-ui-legacy-raw-terminal-fallback',
    message: 'UI terminal/recover state must come from Projection, not legacy raw run fields.',
    appliesTo: (file) => file.startsWith('src/ui/src/'),
    match: (line) => isCodeLine(line)
      && /\b(?:legacyRaw\w*|raw\.(?:status|failureReason)|resultPresentation\.status)\b/.test(line),
  },
];

// Current T120 final-cutover baseline. This guard is deliberately conservative:
// it freezes known legacy/fallback paths and fails only when a file/rule count
// increases or a new untracked file/rule appears. When a migration removes one
// of these paths, lower the matching count in this table in the same change.
const trackedBaselineCounts: Record<string, number> = {
  'src/runtime/gateway/agent-backend-config.ts#provider-scenario-prompt-special-case': 0,
  // T120 migration note, 2026-05-18 Integration Worker:
  // P1/P6 user-level closures added bounded provider/full-text recovery and
  // selected artifact direct-context answers. Markdown artifact read/write
  // fast-path prompt policy moved to markdown-artifact-policy.ts; provider
  // prompt/status/discovery and route projection policy moved to
  // capability-provider-policy.ts; generated-work prompt/recovery policy moved
  // to generated-work-policy.ts; reference discovery labels moved to
  // reference-discovery-policy.ts; direct-context follow-up routing/copy moved
  // to direct-context-followup-policy.ts; artifact preview notices moved to
  // artifacts.ts; AgentServer compatibility/context and external provider
  // recovery policy moved to agent-backend-policy.ts.
  'src/runtime/gateway/artifact-mutation-fast-path.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/capability-provider-preflight.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/conversation-reference-digest.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/conversation-service-plan.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/direct-context-fast-path.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/generated-task-runner-execution-lifecycle.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/generated-task-payload-preflight.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/generated-task-runner-generation-lifecycle.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/generated-task-runner-supplement-lifecycle.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/generated-task-runner-validation-lifecycle.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/markdown-readonly-fast-path.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/runtime-routing.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/transient-external-failure.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/backend-context-window.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/backend-prompt-policy.ts#provider-scenario-prompt-special-case': 4,
  'src/runtime/gateway/generated-task-prompt-policy.ts#provider-scenario-prompt-special-case': 6,
  'src/runtime/gateway/backend-failure-diagnostics.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/context-envelope.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/gateway-request.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/capability-evolution-events.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/repair-policy.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/work-evidence-guard.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/workspace-event-normalizer.ts#provider-scenario-prompt-special-case': 0,
  'src/runtime/gateway/direct-context-fast-path.ts#sa-direct-context-local-strategy': 0,
  'src/runtime/gateway/capability-provider-preflight.ts#sa-direct-context-local-strategy': 0,
  'src/runtime/gateway/direct-context-fast-path.ts#sa-runtime-visible-preflight': 0,
  'src/runtime/gateway/capability-provider-preflight.ts#sa-runtime-visible-preflight': 0,
  'src/runtime/gateway/generated-task-payload-preflight.ts#sa-runtime-visible-preflight': 0,
  'src/runtime/gateway/direct-context-fast-path.ts#sa-direct-context-implicit-strategy': 0,
  'src/runtime/gateway/capability-provider-preflight.ts#sa-provider-discovery-endpoint-leak': 0,
  'src/runtime/gateway/backend-context-contract.ts#sa-degraded-raw-context-shape': 0,
  'src/runtime/gateway/backend-context-window.ts#sa-degraded-raw-context-shape': 0,
  'src/runtime/gateway/backend-prompt-policy.ts#sa-degraded-raw-context-shape': 0,
  'src/ui/src/app/appShell/workspaceState.ts#sa-ui-legacy-raw-terminal-fallback': 0,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#ui-semantic-fallback': 0,
  'src/ui/src/app/results-renderer-registry-slot.tsx#ui-semantic-fallback': 0,
  'src/ui/src/app/results/WorkspaceObjectPreview.tsx#ui-semantic-fallback': 0,
  'src/ui/src/app/uiPrimitives.tsx#ui-semantic-fallback': 0,
  'src/ui/src/runtimeContracts.ts#ui-semantic-fallback': 0,
};

const migrationByFile: Array<{ file: RegExp; migration: string }> = [
  { file: /^src\/ui\/src\/app\/results\/viewPlanResolver\.ts$/, migration: 'T120/T119: move result fallback ranking into manifest/view policy and reduce this legacy baseline.' },
  { file: /^src\/ui\/src\/uiModuleRegistry\.ts$/, migration: 'T120/T119: retire UI compatibility alias fallback once package manifests own all legacy ids.' },
  { file: /^src\/ui\/src\/app\/ScenarioBuilderPanel\.tsx$/, migration: 'T120/T119: move scenario fallback component policy into scenario packages and registry contracts.' },
  { file: /^src\/ui\/src\/app\/chat\/runOrchestrator\.ts$/, migration: 'T120/T119: remove prompt/scenario special cases from chat orchestration and use package/runtime policy.' },
  { file: /^src\/runtime\/gateway\/backend-prompt-policy\.ts$/, migration: 'T120/T122: move provider/prompt special cases from prompt text into capability manifests or runtime policy.' },
  { file: /^src\/runtime\/gateway\/generated-task-prompt-policy\.ts$/, migration: 'T120/T122: move generated-task prompt special cases into capability manifests or runtime policy.' },
  { file: /^src\/runtime\/gateway\//, migration: 'T120/T122: gateway may keep transport/runtime fallback, but provider/scenario/prompt branches must migrate to policy/catalogs.' },
  { file: /^src\/runtime\/skill-registry\//, migration: 'T120/T122: move prompt/provider skill matching special cases into package skill manifests and catalog metadata.' },
  { file: /^src\/runtime\/skill-markdown-catalog\.ts$/, migration: 'T120/T122: move skill provider normalization into skill package metadata/catalog generation.' },
  { file: /^src\/runtime\/runtime-ui-manifest\.ts$/, migration: 'T120/T122: move prompt-driven UI composition defaults into package-owned view policy.' },
  { file: /^src\/ui\/src\//, migration: 'T120/T119: remove UI semantic fallback and facade re-export paths after package-owned view/scenario policy cutover.' },
  { file: /^packages\/presentation\/components\//, migration: 'T120/T080: keep legacy component aliases frozen until stable primitive renderer cutover is complete.' },
  { file: /^packages\/scenarios\//, migration: 'T120/T122: scenario package compatibility defaults are frozen while package runtime profiles cut over.' },
  { file: /^packages\//, migration: 'T120: package legacy adapter/compat paths are frozen; add stable package entrypoints instead.' },
  { file: /^src\/ui\/src\/scenarioCompiler\//, migration: 'T120/T119: remove UI package facade re-exports once callers import @sciforge/scenario-core directly.' },
  { file: /^src\/ui\/src\/scenarioSpecs\.ts$/, migration: 'T120/T119: remove UI scenario spec facade once callers import @sciforge/scenario-core directly.' },
];

async function main() {
  const files = [
    ...await collectSourceFilesIfExists(join(root, 'src')),
    ...await collectSourceFilesIfExists(join(root, 'packages')),
    ...await collectSourceFilesIfExists(join(root, 'tools')),
  ];
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        if (!rule.appliesTo(rel) || !rule.match(line, rel)) continue;
        if (ignoredRuleLine(rule.id, lines, index)) continue;
        findings.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          text: line.trim(),
          migration: trackedMigration(rel, rule.id),
        });
      }
    });
  }

  const counts = countByFileRule(findings);
  const overflowKeys = new Set([...counts.entries()]
    .filter(([key, count]) => count > (trackedBaselineCounts[key] ?? 0))
    .map(([key]) => key));
	  const errors = findings.filter((finding) => overflowKeys.has(findingKey(finding)));
	  const warnings = findings.filter((finding) => !overflowKeys.has(findingKey(finding)) && finding.migration);
	  const shrinkableKeys = Object.entries(trackedBaselineCounts)
	    .filter(([key, baseline]) => (counts.get(key) ?? 0) < baseline);
	  const structuralErrors = await legacyStructuralErrors(files);

  if (warnings.length) {
    console.warn('[no-legacy-paths] warnings: tracked T120 legacy paths remain');
    printGrouped(warnings, false, 'warn');
  }

  if (shrinkableKeys.length) {
    console.warn('[no-legacy-paths] baseline can be reduced after migrations:');
    for (const [key, baseline] of shrinkableKeys) {
      console.warn(`- ${key}: baseline ${baseline}, current ${counts.get(key) ?? 0}`);
    }
  }

	  if (errors.length || structuralErrors.length) {
	    console.error('[no-legacy-paths] untracked or increased legacy paths found');
	    for (const [key, grouped] of groupBy(errors, findingKey)) {
	      console.error(`- ${key}: ${grouped[0].message} (${grouped.length}; baseline ${trackedBaselineCounts[key] ?? 0}, current ${counts.get(key) ?? 0})`);
	      for (const finding of grouped) console.error(`  ${finding.file}:${finding.line} ${finding.text}`);
	    }
	    for (const error of structuralErrors) console.error(`- structural: ${error}`);
	    console.error('Do not add new UI semantic fallback, provider/scenario/prompt special cases, or legacy adapter/compat re-exports. Move the behavior into manifests, catalogs, package-owned policy, or stable runtime entrypoints; only update this baseline with an explicit T120 migration note.');
	    process.exitCode = 1;
	    return;
	  }

	  console.log(`[ok] no increased legacy paths found: ${files.length} source files, ${warnings.length} tracked findings.`);
	}

async function legacyStructuralErrors(files: string[]): Promise<string[]> {
  const errors: string[] = [];
  const gatewayText = await readTextIfExists(join(root, 'src', 'runtime', 'generation-gateway.ts'));
  if (/STAGE_AGENTSERVER_GENERATION|STAGE_AGENTSERVER_DISPATCH_CONSTRAINTS|requestBackendGeneration|backend-generation-dispatch/i.test(gatewayText)) {
    errors.push('generation-gateway.ts must not expose default AgentServer dispatch/generation stages or import the AgentServer generation dispatch runtime module.');
  }
  if (!gatewayText.includes('STAGE_RUNTIME_UNHANDLED')) {
    errors.push('generation-gateway.ts must terminate unhandled default requests with runtime-unhandled instead of legacy AgentServer generation fallback.');
  }
  const backendConfigText = await readTextIfExists(join(root, 'src', 'runtime', 'gateway', 'agent-backend-config.ts'));
  if (!/requestBackendSupported:\s*runtimeAgentBackendSupported\(requestBackend\)\s*&&\s*requestBackend\s*!==\s*'codex'/.test(backendConfigText)) {
    errors.push('agent-backend-config.ts must not treat request.agentBackend=codex as AgentServer generation opt-in.');
  }
  if (/requestLlmEndpoint:\s*Boolean\(/.test(backendConfigText)) {
    errors.push('agent-backend-config.ts must not treat a plain llmEndpoint/baseUrl as AgentServer generation opt-in.');
  }
  errors.push(...await computerUseLegacyStructuralErrors(files));
  errors.push(...await browserLegacyStructuralErrors());
  errors.push(...await generatedLegacyArtifactErrors());
  errors.push(...await modelRouterOnlyStructuralErrors(files));
  return errors;
}

async function modelRouterOnlyStructuralErrors(files: string[]): Promise<string[]> {
  const errors: string[] = [];
  const retiredOpenAiRuntimeEnv = /\bSCIFORGE_(?:COMPUTER_USE_PLANNER_)?ALLOW_OPENAI_RUNTIME\b/;
  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (rel === 'tools/check-no-legacy-paths.ts') continue;
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => retiredOpenAiRuntimeEnv.test(line));
    if (lineIndex >= 0) {
      errors.push(`${rel}:${lineIndex + 1} Runtime/API services must use Model Router only; retired OpenAI runtime opt-in env must not appear in active source.`);
    }
  }

  for (const [name, command] of Object.entries(await packageScripts())) {
    if (retiredOpenAiRuntimeEnv.test(command)) {
      errors.push(`package.json script "${name}" must not set retired OpenAI runtime opt-in env; Runtime/API services must use Model Router.`);
    }
  }
  return errors;
}

async function generatedLegacyArtifactErrors(): Promise<string[]> {
  const errors: string[] = [];
  const retiredGeneratedPatterns: Array<{ id: string; pattern: RegExp; message: string }> = [
    {
      id: 'retired-gui-mcp-server-name',
      pattern: /\bsciforge_gui\b/,
      message: 'generated desktop artifacts must not retain the retired GUI MCP server name.',
    },
    {
      id: 'retired-gui-extension-state-env',
      pattern: /\bSCIFORGE_GUI_EXTENSION_STATE\b/,
      message: 'generated desktop artifacts must not retain the retired GUI extension state env.',
    },
    {
      id: 'retired-gui-extension-module',
      pattern: /\bgui-extension-manifest\b/,
      message: 'generated desktop artifacts must not retain the retired GUI extension manifest import/path.',
    },
    {
      id: 'retired-codex-responses-proxy-server',
      pattern: /\b(?:createCodexResponsesProxyServer|codex-responses-proxy|sciforge\.codex-responses-proxy)\b/,
      message: 'generated desktop artifacts must not retain the retired Codex Responses proxy server.',
    },
  ];
  for (const file of await collectGeneratedFilesIfExists(join(root, 'dist-desktop'))) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    for (const rule of retiredGeneratedPatterns) {
      const lineIndex = lines.findIndex((line) => rule.pattern.test(line));
      if (lineIndex >= 0) errors.push(`${rel}:${lineIndex + 1} ${rule.message} (${rule.id}).`);
    }
  }

  const retiredGeneratedFiles = [
    'dist-desktop/src/runtime/codex/gui-extension-manifest.js',
    'dist-desktop/src/runtime/codex/gui-extension-state.js',
    'dist-desktop/src/runtime/codex/gui-mcp-server.js',
    'dist-desktop/src/runtime/codex/gui-mcp-tools.js',
    'dist-desktop/src/runtime/codex/gui-present-cli.js',
    'dist-desktop/packages/backend/src/proxy.js',
  ];
  for (const rel of retiredGeneratedFiles) {
    if (await pathExists(join(root, rel))) {
      errors.push(`${rel} must stay deleted; run npm run desktop:clean before rebuilding desktop artifacts so retired GUI/proxy sources cannot survive as stale generated JavaScript.`);
    }
  }

  const runtimeGuiExtensionDir = 'packages/backend/.codex-runtime/gui-extension';
  if (await pathExists(join(root, runtimeGuiExtensionDir))) {
    errors.push(`${runtimeGuiExtensionDir} must stay deleted; Runtime Codex must not expose the retired gui.present shim bin or GUI extension state directory.`);
  }

  const generatedPatternChecks: Array<{ rel: string; pattern: RegExp; message: string }> = [
    {
      rel: 'dist-desktop/src/runtime/codex/codex-exec-json-adapter.js',
      pattern: /\b(?:SCIFORGE_GUI_EXTENSION_STATE|sciforge_gui|gui-mcp-server|gui-extension-manifest|gui-present-cli)\b/,
      message: 'compiled Codex exec adapter must not inject the retired GUI MCP/shim extension.',
    },
    {
      rel: 'dist-desktop/packages/backend/src/proxy.js',
      pattern: /\b(?:createCodexResponsesProxyServer|codex-responses-proxy|sciforge\.codex-responses-proxy)\b/,
      message: 'compiled backend artifacts must not retain the retired Codex Responses proxy server.',
    },
  ];
  for (const check of generatedPatternChecks) {
    const text = await readTextIfExists(join(root, check.rel));
    if (!text) continue;
    const lineIndex = text.split(/\r?\n/).findIndex((line) => check.pattern.test(line));
    if (lineIndex >= 0) errors.push(`${check.rel}:${lineIndex + 1} ${check.message}`);
  }

  return errors;
}

async function browserLegacyStructuralErrors(): Promise<string[]> {
  const errors: string[] = [];
  const guardedFiles = [
    'src/runtime/codex/codex-app-server-client.ts',
    'packages/actions/browser-runtime/mcp.ts',
    'packages/actions/browser-runtime/README.md',
    'docs/BrowserRuntimeArchitecture.md',
  ];
  const bannedPatterns: Array<{ id: string; pattern: RegExp; message: string }> = [
    {
      id: 'browser-read-input-repair-path',
      pattern: /\b(?:readInput|candidateReadInputs|search-results-require-read)\b/,
      message: 'Browser product surfaces must use resources/evidenceState/resourceRef instead of readInput/candidateReadInputs repair paths',
    },
    {
      id: 'browser-search-only-budget-guard',
      pattern: /\bbrowser_search_only_budget_exhausted\b|\bBROWSER_SEARCH_ONLY_CALL_BUDGET\b|\bBrowserToolProgress\b/,
      message: 'Host adapter must not own a Browser search-only progress guard; Agent Host/verifier decides replanning from evidence',
    },
  ];
  for (const rel of guardedFiles) {
    const text = await readTextIfExists(join(root, rel));
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    for (const rule of bannedPatterns) {
      const lineIndex = lines.findIndex((line) => rule.pattern.test(line));
      if (lineIndex >= 0) errors.push(`${rel}:${lineIndex + 1} ${rule.message} (${rule.id}).`);
    }
  }

  const hostAdapterText = await readTextIfExists(join(root, 'src', 'runtime', 'codex', 'codex-app-server-client.ts'));
  for (const legacy of ['browser.search_read', 'browser.open_read', 'browser.open']) {
    if (hostAdapterText.includes(legacy)) {
      errors.push(`src/runtime/codex/codex-app-server-client.ts must not mention legacy Browser intent ${legacy}; direct tools route only to six primitives.`);
    }
  }
  return errors;
}

async function computerUseLegacyStructuralErrors(files: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const rel of [
    'src/runtime/vision-sense/computer-use-action-loop.ts',
    'src/runtime/vision-sense/computer-use-bridge.ts',
    'packages/observe/vision/sciforge_vision_sense/computer_use.py',
    'packages/observe/vision/sciforge_vision_sense/executor.py',
    'packages/observe/vision/sciforge_vision_sense/planner.py',
    'packages/observe/vision/sciforge_vision_sense/runner.py',
    'packages/observe/vision/sciforge_vision_sense/text_agent_runtime.py',
  ]) {
    try {
      await access(join(root, rel));
      errors.push(`${rel} must stay deleted; Computer Use execution is owned by packages/actions/computer-use with src/runtime as host adapter only.`);
    } catch {
      // deleted is the expected state
    }
  }

  const executorText = await readTextIfExists(join(root, 'src', 'runtime', 'computer-use', 'executor.ts'));
  if (!/targetResolution\.captureKind\s*!==\s*'window'[\s\S]{0,320}no target window is resolved/.test(executorText)) {
    errors.push('src/runtime/computer-use/executor.ts must fail closed for real pointer/keyboard actions unless WindowTarget resolves to captureKind="window".');
  }

  const guardedFiles = files
    .map((file) => relative(root, file).replaceAll('\\', '/'))
    .filter((rel) => rel !== 'tools/check-no-legacy-paths.ts')
    .filter((rel) => /^src\/runtime\//.test(rel)
      || /^packages\/actions\/computer-use\//.test(rel)
      || /^packages\/observe\/vision\//.test(rel)
      || /^tools\/cu-next-(?:readiness-manifest|run)\.ts$/.test(rel)
      || /^tools\/computer-use-long-task-pool\//.test(rel));
  const retiredGroundingProviderPattern = new RegExp(`\\b(?:${[
    ['KV', '-', 'Ground'].join(''),
    ['kv', '-', 'ground'].join(''),
    ['kv', 'Ground'].join(''),
    ['KV', 'Ground'].join(''),
    `${['SCIFORGE', 'VISION', 'KV', 'GROUND'].join('_')}(?:_[A-Z0-9_]+)?`,
    ['legacy', 'Kv', 'Ground', 'Compatible', 'Adapter'].join(''),
  ].join('|')})\\b`);
  const bannedPatterns: Array<{ id: string; pattern: RegExp; message: string }> = [
    {
      id: 'legacy-action-loop',
      pattern: /\b(?:computer-use-action-loop|runComputerUseActionLoop)\b/,
      message: 'legacy vision-sense Computer Use action loop import/reference must not return',
    },
    {
      id: 'legacy-completion-fallback-actions',
      pattern: /\bfallbackActions\b/,
      message: 'completionPolicy.fallbackActions must not be reintroduced; planner failure must return structured failure',
    },
    {
      id: 'legacy-vision-grounder-env',
      pattern: /\bSCIFORGE_VISION_GROUNDER_LLM(?:_[A-Z0-9_]+)?\b/,
      message: 'SCIFORGE_VISION_GROUNDER_LLM visual fallback config must not be reintroduced',
    },
    {
      id: 'legacy-openai-compatible-grounder',
      pattern: /\bopenai-compatible-vision-grounder\b/,
      message: 'openai-compatible visual grounder fallback must not be reintroduced; use Model Router grounding translator',
    },
    {
      id: 'legacy-visual-grounder-config',
      pattern: /\bvisualGrounder(?:BaseUrl|ApiKey|Model|TimeoutMs|Config)?\b/,
      message: 'visualGrounder config fields must not be reintroduced beside the Model Router grounding translator',
    },
    {
      id: 'legacy-direct-grounding-active-path',
      pattern: retiredGroundingProviderPattern,
      message: 'retired direct grounding code paths must not remain active; use Model Router grounding translator',
    },
    {
      id: 'legacy-static-computer-use-actions',
      pattern: /\b(?:SCIFORGE_VISION_ACTIONS_JSON|plannedActions)\b/,
      message: 'static Computer Use action injection must stay test-only; production runtime must use the planner host port',
    },
    {
      id: 'legacy-vision-planner-env',
      pattern: /\bSCIFORGE_VISION_PLANNER(?:_[A-Z0-9_]+)?\b/,
      message: 'legacy vision planner env vars must not return; Computer Use planner config uses SCIFORGE_COMPUTER_USE_PLANNER_*.',
    },
    {
      id: 'legacy-cu-next-package-schema-dependency',
      pattern: /\btools\/computer-use-next\b/,
      message: 'package action loop schema must stay TypeScript-owned and must not import tools/computer-use-next',
    },
  ];

  for (const rel of guardedFiles) {
    const text = await readTextIfExists(join(root, rel));
    for (const rule of bannedPatterns) {
      const lineIndex = text.split(/\r?\n/).findIndex((line) => rule.pattern.test(line));
      if (lineIndex >= 0) {
        errors.push(`${rel}:${lineIndex + 1} ${rule.message} (${rule.id}).`);
      }
    }
  }
  const oldObserveSurfaceFiles = [
    'packages/observe/vision/sciforge_vision_sense/__init__.py',
    'packages/observe/vision/sciforge_vision_sense/manifest.py',
    'packages/observe/vision/sciforge_vision_sense/prompts.py',
    'packages/observe/vision/sciforge_vision_sense/types.py',
    'packages/observe/vision/sciforge_vision_sense/vlm.py',
    'packages/observe/vision/README.md',
    'packages/skills/installed/local/vision-gui-task/SKILL.md',
    'packages/skills/tool_skills/local/vision-sense/SKILL.md',
    'packages/skills/catalog.ts',
  ];
  const oldObservePatterns: Array<{ id: string; pattern: RegExp; message: string }> = [
    {
      id: 'legacy-vision-task-request-api',
      pattern: /\bVisionTaskRequest\b/,
      message: 'VisionTaskRequest must not remain on the observe/skills surface; use SensePluginRequest and the Computer Use action provider boundary.',
    },
    {
      id: 'legacy-computer-use-text-command-api',
      pattern: /\bComputerUseTextCommand\b/,
      message: 'ComputerUseTextCommand must not remain on the observe/skills surface; action commands belong to packages/actions/computer-use.',
    },
    {
      id: 'legacy-positive-vision-runner-api',
      pattern: /\b(?:run_vision_task|GuiExecutor|ExecutionResult|build_planner_prompt|parse_planner_action|RunnerVision(?:Action|TaskRequest|TaskResult)|text\/x-computer-use-command|computer_use_command_from_action|sense_text_result_for_computer_use)\b/,
      message: 'legacy positive Computer Use runner/planner/executor APIs must not remain on the observe/skills surface.',
    },
  ];
  for (const rel of oldObserveSurfaceFiles) {
    const text = await readTextIfExists(join(root, rel));
    if (!text) continue;
    for (const rule of oldObservePatterns) {
      const lineIndex = text.split(/\r?\n/).findIndex((line) => rule.pattern.test(line));
      if (lineIndex >= 0) {
        errors.push(`${rel}:${lineIndex + 1} ${rule.message} (${rule.id}).`);
      }
    }
  }
  errors.push(...await computerUseProductDefaultPathErrors());
  return errors;
}

async function computerUseProductDefaultPathErrors(): Promise<string[]> {
  const errors: string[] = [];
  const scripts = await packageScripts();
  const productScriptRoots = computerUseProductScriptRoots(scripts);
  const productGraph = reachableScripts(scripts, productScriptRoots);
  const legacyCommandPattern = /\bpython3?\b|\bpytest\b|sciforge_computer_use|packages\/actions\/computer-use\/sciforge_computer_use|embedded-isolated-desktop|isolated[_-]desktop|novnc|noVNC|docker\s+build[\s\S]*computer-use/i;

  for (const [name, command] of Object.entries(scripts)) {
    if (!isComputerUseScript(name, command) || !legacyCommandPattern.test(stripCurrentCompletionEvidenceProducer(command))) continue;
    errors.push(`package.json script "${name}" references retired Python/isolated Computer Use routes; Computer Use is TS-only.`);
  }

  for (const name of productGraph) {
    const command = scripts[name] ?? '';
    if (legacyCommandPattern.test(stripCurrentCompletionEvidenceProducer(command))) {
      errors.push(`product/default script "${name}" must stay TS-only and must not reference Python, pytest, sciforge_computer_use, Docker/noVNC, or isolated Computer Use routes.`);
    }
  }

  const actionManifestText = await readTextIfExists(join(root, 'packages', 'actions', 'computer-use', 'action-provider.manifest.json'));
  const actionManifest = parseJsonRecord(actionManifestText);
  const entrypoint = asRecord(actionManifest?.entrypoint);
  const entrypointText = JSON.stringify(entrypoint ?? {});
  const actionManifestFullText = JSON.stringify(actionManifest ?? {});
  if (entrypoint?.type !== 'typescript-package') {
    errors.push('packages/actions/computer-use/action-provider.manifest.json entrypoint.type must be "typescript-package"; Python is legacy-obsolete and cannot be the product/default route.');
  }
  if (/\bpython3?\b|\bpytest\b|sciforge_computer_use|packages\/actions\/computer-use\/sciforge_computer_use/i.test(entrypointText)) {
    errors.push('packages/actions/computer-use/action-provider.manifest.json entrypoint must not reference Python, pytest, or sciforge_computer_use.');
  }
  if ('legacyPythonImplementation' in (actionManifest ?? {})) {
    errors.push('packages/actions/computer-use/action-provider.manifest.json must not declare legacyPythonImplementation; Computer Use is TS-only.');
  }
  if (/\bpython3?\b|\bpytest\b|sciforge_computer_use|packages\/actions\/computer-use\/sciforge_computer_use/i.test(actionManifestFullText)) {
    errors.push('packages/actions/computer-use/action-provider.manifest.json must not reference Python, pytest, or sciforge_computer_use anywhere.');
  }
  const mcpConfigText = await readTextIfExists(join(root, '.mcp.json'));
  const mcpConfig = parseJsonRecord(mcpConfigText);
  const mcpServers = asRecord(mcpConfig?.mcpServers);
  for (const [serverName, serverValue] of Object.entries(mcpServers ?? {})) {
    const server = asRecord(serverValue);
    const serverText = JSON.stringify(server ?? {});
    const exposesComputerUse = /computer[-_]use|sciforge_computer_use/i.test(`${serverName} ${serverText}`);
    if (exposesComputerUse && legacyCommandPattern.test(serverText)) {
      errors.push('.mcp.json must not expose the retired Python sciforge-computer-use MCP server by default; keep that path manual legacy diagnostic only.');
    }
  }
  if ('virtualAppScreenRuntimeProductFallbackAllowed' in (actionManifest ?? {})) {
    errors.push('packages/actions/computer-use/action-provider.manifest.json must not carry virtualAppScreenRuntimeProductFallbackAllowed; VirtualAppScreen runtime fallback has been retired.');
  }

  const readme = await readTextIfExists(join(root, 'packages', 'actions', 'computer-use', 'README.md'));
  if (!/Computer Use is TS-only|TypeScript-only/.test(readme)) {
    errors.push('packages/actions/computer-use/README.md must state that Computer Use is TS-only.');
  }
  for (const rel of [
    'packages/actions/computer-use/pyproject.toml',
    'packages/actions/computer-use/sciforge_computer_use',
    'packages/actions/computer-use/tests',
    'packages/actions/computer-use/adapter-registry.manifest.json',
  ]) {
    try {
      await access(join(root, rel));
      errors.push(`${rel} must stay deleted; Computer Use is TS-only and the legacy VirtualAppScreen/Python surface is retired.`);
    } catch {
      // deleted is the expected state
    }
  }

  const defaultMaterializerText = await readTextIfExists(join(root, 'src', 'runtime', 'codex', 'agent-host-computer-use-act-materializer.ts'));
  if (/\bpython3?\b|\bpytest\b|sciforge_computer_use|packages\/actions\/computer-use\/sciforge_computer_use/i.test(defaultMaterializerText)) {
    errors.push('src/runtime/codex/agent-host-computer-use-act-materializer.ts must not depend on Python, pytest, or sciforge_computer_use.');
  }
  if (/virtualAppScreen/i.test(defaultMaterializerText)) {
    for (const name of productGraph) {
      const command = scripts[name] ?? '';
      if (/\bbackend:codex-runtime:server\b|codex-runtime-standalone-server|createDefaultComputerUseActMaterializer|agent-host-computer-use-act-materializer/i.test(command)) {
        errors.push(`product/default script "${name}" must not route product acceptance through the runtime default VirtualAppScreen materializer fallback.`);
      }
    }
  }

  return errors;
}

function stripCurrentCompletionEvidenceProducer(command: string): string {
  return command.replace(/\s+--completion-evidence-producer\s+computer-use\.embedded-isolated-desktop-l3\b/g, '');
}

async function readTextIfExists(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function trackedMigration(file: string, rule: string) {
  const key = `${file}#${rule}`;
  if (trackedBaselineCounts[key] === undefined) return undefined;
  return migrationByFile.find((entry) => entry.file.test(file))?.migration
    ?? 'T120 tracked baseline: existing legacy path must be migrated before this baseline is reduced.';
}

function countByFileRule(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(findingKey(finding), (counts.get(findingKey(finding)) ?? 0) + 1);
  return counts;
}

function findingKey(finding: Pick<Finding, 'file' | 'rule'>) {
  return `${finding.file}#${finding.rule}`;
}

function printGrouped(findings: Finding[], includeEveryFinding: boolean, level: 'warn' | 'error') {
  const printer = level === 'warn' ? console.warn : console.error;
  for (const grouped of groupBy(findings, (finding) => `${finding.rule}:${finding.migration ?? 'untracked'}`).values()) {
    const first = grouped[0];
    printer(`- ${first.rule}: ${first.message} (${grouped.length})`);
    if (first.migration) printer(`  ${first.migration}`);
    for (const finding of grouped.slice(0, includeEveryFinding ? grouped.length : 8)) {
      printer(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    if (!includeEveryFinding && grouped.length > 8) printer(`  ... ${grouped.length - 8} more`);
  }
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyFor(item), [...(groups.get(keyFor(item)) ?? []), item]);
  return groups;
}

function isCodeLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 0
    && !trimmed.startsWith('import ')
    && !trimmed.startsWith('//')
    && !trimmed.startsWith('*');
}

function isPackageManifestFallbackLine(line: string) {
  return /\bfallbackModuleIds\s*:/.test(line) || /\bfallbackAcceptable\s*:/.test(line);
}

function isProviderScenarioPromptSpecialCaseLine(line: string, file: string) {
  const branchSurface = stripQuotedStringLiterals(line);
  return isCodeLine(line)
    && !/^export\s+/.test(line.trim())
    && !isPackageManifestFallbackLine(line)
    && /\b(provider|scenario|prompt)\b/i.test(`${basename(file)} ${line}`)
    && /(?:^\s*(?:if|else if|switch|case)\b|\?\s|\.includes\(|\.startsWith\(|\.endsWith\(|\.match\(|\.test\(|new RegExp|\/[^/\n]+\/[a-z]*|===|!==)/.test(branchSurface)
    && /(?:[`'"][a-z0-9][a-z0-9._:/-]*(?:[._:/-][a-z0-9][a-z0-9._:/-]*)+[`'"]|\/[^/\n]+\/[a-z]*|\b(?:provider|scenario|prompt)\s*(?:[.[]|===|!==))/.test(line);
}

function stripQuotedStringLiterals(line: string) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '');
}

function isLegacyPolicySurface(file: string) {
  return /^src\/runtime\/gateway\//.test(file)
    || /^src\/runtime\/skill-registry\//.test(file)
    || file === 'src/runtime/runtime-ui-manifest.ts'
    || file === 'src/runtime/skill-markdown-catalog.ts'
    || file === 'src/ui/src/app/chat/runOrchestrator.ts'
    || file === 'src/ui/src/app/results/viewPlanResolver.ts';
}

function ignoredRuleLine(ruleId: string, lines: string[], index: number) {
  return ruleId === 'sa-degraded-raw-context-shape' && isForbiddenFieldRegistryLine(lines, index);
}

function isForbiddenFieldRegistryLine(lines: string[], index: number) {
  const line = lines[index]?.trim() ?? '';
  if (!/^['"](?:recentTurns|fullRefList|rawHistory|compactionState)['"],?$/.test(line)) return false;
  for (let cursor = index; cursor >= Math.max(0, index - 12); cursor -= 1) {
    const candidate = lines[cursor]?.trim() ?? '';
    if (/^(?:const\s+)?[A-Z0-9_]*FORBIDDEN[A-Z0-9_]*\s*=\s*new Set\(\[/.test(candidate)) return true;
    if (cursor < index && /^\]\);?$/.test(candidate)) return false;
  }
  return false;
}

async function packageScripts(): Promise<Record<string, string>> {
  const packageJson = parseJsonRecord(await readTextIfExists(join(root, 'package.json')));
  const scripts = asRecord(packageJson?.scripts);
  if (!scripts) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function computerUseProductScriptRoots(scripts: Record<string, string>) {
  return Object.keys(scripts).filter((name) => {
    if (isLegacyDiagnosticScriptLabel(name, scripts[name] ?? '')) return false;
    return name === 'verify'
      || name === 'verify:fast'
      || name.startsWith('verify:single-agent')
      || name === 'smoke:real-task-matrix'
      || name === 'smoke:real-task-offline-gates'
      || name === 'smoke:computer-use-chat-e2e'
      || name === 'smoke:desktop-computer-use-hard-confirm-product'
      || name === 'smoke:computer-use-chat-live-preflight'
      || name.startsWith('smoke:cu-next-')
      || name.startsWith('smoke:model-router-computer-use-live-acceptance');
  });
}

function reachableScripts(scripts: Record<string, string>, roots: string[]) {
  const visited = new Set<string>();
  const queue = roots.filter((name) => scripts[name] !== undefined);
  while (queue.length) {
    const name = queue.shift();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    for (const child of referencedNpmScripts(scripts[name] ?? '')) {
      if (!visited.has(child) && scripts[child] !== undefined) queue.push(child);
    }
  }
  return visited;
}

function referencedNpmScripts(command: string) {
  return [...command.matchAll(/\bnpm\s+run\s+([a-z0-9:_-]+)/gi)].map((match) => match[1]).filter(Boolean);
}

function isComputerUseScript(name: string, command: string) {
  return /computer-use|cu-|virtual-app-screen|model-router-computer-use/i.test(`${name} ${command}`);
}

function isLegacyDiagnosticScriptLabel(name: string, command: string) {
  return /(?:^|[:-])(?:opt-in|diagnostic|legacy|historical)(?:$|[:-])/i.test(name)
    || /\b(?:opt-in|diagnostic|legacy|historical)\b/i.test(command);
}

function parseJsonRecord(text: string) {
  if (!text.trim()) return undefined;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectFiles(dir);
}

async function collectGeneratedFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectGeneratedFiles(dir);
}

async function collectGeneratedFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectGeneratedFiles(full));
      continue;
    }
    if (entry.isFile() && isGeneratedArtifactScanFile(full)) out.push(full);
  }
  return out.sort();
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name)) && !isTestFile(full)) out.push(full);
  }
  return out.sort();
}

function isTestFile(file: string) {
  const rel = relative(root, file).replaceAll('\\', '/');
  return /(^|\/)(tests?|__tests__|fixtures)\//.test(rel) || /\.(test|spec)\.[^.]+$/.test(rel);
}

function isGeneratedArtifactScanFile(file: string) {
  return ['.js', '.cjs', '.mjs', '.json'].includes(extname(file));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
