import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  allWebE2eCaseTags,
  assertWebE2eCaseRegistry,
  selectWebE2eCases,
  type WebE2eAgentServerMode,
  type WebE2eCaseRunContext,
  type WebE2eCaseRunSummary,
  type WebE2eFinalDevService,
} from './web-e2e/case-registry.js';
import {
  writeWebE2eEvidenceBundle,
  type WebE2eEvidenceBundleManifest,
} from './web-e2e/evidence-bundle.js';
import type { JsonValue } from './web-e2e/types.js';

type PackageJson = {
  scripts?: Record<string, string>;
};

type FinalWebE2eCaseManifestRef = {
  caseId: string;
  title: string;
  manifestPath: string;
  tags: string[];
  migratedLegacyScripts: string[];
  migratedLegacySteps: string[];
};

type SingleAgentFinalManifest = {
  schemaVersion: 'sciforge.single-agent-final.manifest.v1';
  generatedAt: string;
  completionGate: 'smoke:web-multiturn-final';
  command: string;
  selectedCases: string[];
  selectedTags: string[];
  isolatedRunRoot: string;
  webEvidenceRoot: string;
  devServices: WebE2eFinalDevService[];
  agentServer: {
    mode: WebE2eAgentServerMode;
    mock: 'scriptable-agentserver-mock';
    realProviderPolicy: 'optional-happy-path-only';
  };
  caseManifests: FinalWebE2eCaseManifestRef[];
  legacyMigration: Array<{
    legacyScript: string;
    delegatedTo: 'smoke:web-multiturn-final';
    representedByCases: string[];
    migratedSteps: string[];
  }>;
};

type BrowserSmokeMigrationScenario = {
  id: string;
  title: string;
  legacyScript: string;
  legacyFile: string;
  completionGate: 'smoke:web-multiturn-final';
  legacyIndependentCompletionGate: false;
  manifestTags: string[];
  forbiddenIndependentGateReasons: string[];
};

const root = process.cwd();
const webMultiturnFinalScript = 'smoke:web-multiturn-final';
const webMultiturnFinalCommand = 'tsx tests/smoke/smoke-web-multiturn-final.ts';
const migrationTag = 'sa-conf-11:migrated-browser-smoke';
const defaultWebEvidenceRoot = resolve(root, 'docs', 'test-artifacts', 'web-e2e');
const defaultSingleAgentFinalRoot = resolve(root, 'docs', 'test-artifacts', 'single-agent-final');

const scenarios: BrowserSmokeMigrationScenario[] = [
  {
    id: 'browser-workflows',
    title: 'Browser workflow UI recovery and artifact follow-up',
    legacyScript: 'smoke:browser',
    legacyFile: 'tests/smoke/smoke-browser-workflows.ts',
    completionGate: webMultiturnFinalScript,
    legacyIndependentCompletionGate: false,
    manifestTags: [webMultiturnFinalScript, 'smoke:browser', migrationTag, 'browser-workflows'],
    forbiddenIndependentGateReasons: ['legacy-direct-context-completion', 'legacy-preflight-completion'],
  },
  {
    id: 'browser-multiturn-context',
    title: 'Browser multi-turn bounded context and repair continuation',
    legacyScript: 'smoke:browser-multiturn',
    legacyFile: 'tests/smoke/smoke-browser-multiturn-context.ts',
    completionGate: webMultiturnFinalScript,
    legacyIndependentCompletionGate: false,
    manifestTags: [webMultiturnFinalScript, 'smoke:browser-multiturn', migrationTag, 'browser-multiturn'],
    forbiddenIndependentGateReasons: ['legacy-direct-context-completion', 'legacy-preflight-completion'],
  },
  {
    id: 'browser-provider-preflight',
    title: 'Browser provider availability transition as final web scenario',
    legacyScript: 'smoke:browser-provider-preflight',
    legacyFile: 'tests/smoke/smoke-browser-provider-preflight.ts',
    completionGate: webMultiturnFinalScript,
    legacyIndependentCompletionGate: false,
    manifestTags: [webMultiturnFinalScript, 'smoke:browser-provider-preflight', migrationTag, 'browser-provider-preflight'],
    forbiddenIndependentGateReasons: ['legacy-direct-context-completion', 'legacy-preflight-completion'],
  },
];

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson;
const scripts = pkg.scripts ?? {};
const requestedTags = requestedArgs('--tag');
const requestedCases = requestedArgs('--case');
const agentServerMode = requestedAgentServerMode();
const runRoot = await mkdtemp(join(tmpdir(), 'sciforge-web-multiturn-final-'));
const webEvidenceRoot = requestedValue('--evidence-root') ?? defaultWebEvidenceRoot;
const singleAgentFinalRoot = requestedValue('--final-manifest-root') ?? defaultSingleAgentFinalRoot;
const knownFinalTags = new Set([
  'SA-WEB-01',
  'SA-WEB-18',
  ...scenarios.flatMap((scenario) => scenario.manifestTags),
  ...allWebE2eCaseTags(),
]);
const devServices = finalDevServices(agentServerMode);

assert.equal(
  scripts[webMultiturnFinalScript],
  webMultiturnFinalCommand,
  `${webMultiturnFinalScript} must be the single browser final manifest entrypoint`,
);

for (const scenario of scenarios) {
  assert.equal(scenario.completionGate, webMultiturnFinalScript, `${scenario.id}: completion gate`);
  assert.equal(scenario.legacyIndependentCompletionGate, false, `${scenario.id}: legacy independent gate must stay disabled`);
  assert.ok(scenario.manifestTags.includes(webMultiturnFinalScript), `${scenario.id}: missing final manifest tag`);
  assert.ok(scenario.manifestTags.includes(scenario.legacyScript), `${scenario.id}: missing legacy script manifest tag`);
  assert.ok(scenario.manifestTags.includes(migrationTag), `${scenario.id}: missing SA-CONF-11 migration tag`);
  assert.ok(scenario.forbiddenIndependentGateReasons.includes('legacy-direct-context-completion'), `${scenario.id}: direct-context standalone gate must be forbidden`);
  assert.ok(scenario.forbiddenIndependentGateReasons.includes('legacy-preflight-completion'), `${scenario.id}: preflight standalone gate must be forbidden`);

  const command = scripts[scenario.legacyScript];
  assert.ok(command, `${scenario.legacyScript} must remain declared as a compatibility alias`);
  assert.ok(
    delegatesToFinalTag(command, scenario.legacyScript),
    `${scenario.legacyScript} must delegate to "${webMultiturnFinalScript} -- --tag ${scenario.legacyScript}"`,
  );
  assert.ok(
    !command.includes(scenario.legacyFile),
    `${scenario.legacyScript} must not run legacy file ${scenario.legacyFile} directly`,
  );
}

for (const [scriptName, command] of Object.entries(scripts)) {
  for (const scenario of scenarios) {
    assert.ok(
      !command.includes(scenario.legacyFile),
      `${scriptName} must not promote ${scenario.legacyFile} as an independent package completion gate`,
    );
  }
}

for (const tag of requestedTags) {
  assert.ok(knownFinalTags.has(tag), `unknown ${webMultiturnFinalScript} manifest tag "${tag}"`);
}

const selected = requestedTags.length
  ? scenarios.filter((scenario) => requestedTags.some((tag) => scenario.manifestTags.includes(tag)))
  : scenarios;

if (selected.length > 0) {
  console.log(`[ok] ${webMultiturnFinalScript} migration guard selected ${selected.map((scenario) => scenario.id).join(', ')}`);
} else {
  console.log(`[ok] ${webMultiturnFinalScript} migration guard accepted registry-only selection`);
}

assertWebE2eCaseRegistry();
const selectedCases = selectWebE2eCases({ tags: requestedTags, cases: requestedCases });
assert.ok(selectedCases.length > 0, `${webMultiturnFinalScript} must select at least one final web e2e case`);

const context: WebE2eCaseRunContext = {
  runRoot,
  evidenceRoot: webEvidenceRoot,
  agentServerMode,
  devServices,
};
const summaries: WebE2eCaseRunSummary[] = [];
const caseManifests: FinalWebE2eCaseManifestRef[] = [];

console.log(`[plan] ${webMultiturnFinalScript} isolated run root ${runRoot}`);
console.log(`[plan] ${webMultiturnFinalScript} evidence root ${webEvidenceRoot}`);
console.log(`[plan] ${webMultiturnFinalScript} AgentServer mode ${agentServerMode}`);

for (const webCase of selectedCases) {
  console.log(`[case] ${webCase.id} ${webCase.title}`);
  const summary = await webCase.run(context);
  summaries.push(summary);
  const { manifest, manifestPath } = await writeFinalCaseEvidenceBundle(summary, context);
  caseManifests.push({
    caseId: summary.caseId,
    title: summary.title,
    manifestPath,
    tags: summary.tags,
    migratedLegacyScripts: summary.migratedLegacyScripts,
    migratedLegacySteps: summary.migratedLegacySteps,
  });
  assert.equal(manifest.note.status, 'passed', `${summary.caseId}: final evidence note`);
}

const finalManifestPath = await writeSingleAgentFinalManifest({
  generatedAt: new Date().toISOString(),
  runRoot,
  webEvidenceRoot,
  finalRoot: singleAgentFinalRoot,
  selectedTags: requestedTags,
  selectedCases: summaries.map((summary) => summary.caseId),
  caseManifests,
  devServices,
  agentServerMode,
  requiredLegacyScripts: requiredLegacyScriptsForSelection(requestedTags, requestedCases),
});

console.log(`[ok] ${webMultiturnFinalScript} ran ${summaries.length} final web e2e case(s): ${summaries.map((summary) => summary.caseId).join(', ')}`);
console.log(`[ok] ${webMultiturnFinalScript} wrote final evidence manifest ${finalManifestPath}`);

function requestedArgs(name: '--tag' | '--case'): string[] {
  const values: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      const value = process.argv[index + 1];
      assert.ok(value, `${name} requires a value`);
      values.push(value);
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(`${name}=`.length));
    }
  }
  return values;
}

function requestedValue(name: '--evidence-root' | '--final-manifest-root'): string | undefined {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      const value = process.argv[index + 1];
      assert.ok(value, `${name} requires a value`);
      return resolve(root, value);
    }
    if (arg.startsWith(`${name}=`)) return resolve(root, arg.slice(`${name}=`.length));
  }
  return undefined;
}

function requestedAgentServerMode(): WebE2eAgentServerMode {
  const raw = requestedValueLiteral('--agent-server') ?? 'scriptable-mock';
  assert.ok(raw === 'scriptable-mock' || raw === 'real-provider-optional', `unknown --agent-server mode "${raw}"`);
  return raw;
}

function requestedValueLiteral(name: '--agent-server'): string | undefined {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      const value = process.argv[index + 1];
      assert.ok(value, `${name} requires a value`);
      return value;
    }
    if (arg.startsWith(`${name}=`)) return arg.slice(`${name}=`.length);
  }
  return undefined;
}

function delegatesToFinalTag(command: string | undefined, tag: string): boolean {
  if (!command) return false;
  const normalized = command.replace(/\s+/g, ' ').trim();
  return normalized === `npm run ${webMultiturnFinalScript} -- --tag ${tag}`;
}

function finalDevServices(agentServerMode: WebE2eAgentServerMode): WebE2eFinalDevService[] {
  return [
    {
      name: 'workspace-writer',
      mode: 'fixture-managed',
      status: 'ready',
    },
    {
      name: 'web-ui',
      mode: 'fixture-managed',
      status: 'ready',
    },
    {
      name: 'agentserver',
      mode: agentServerMode === 'scriptable-mock' ? 'scriptable-mock' : 'real-provider-optional',
      status: 'ready',
    },
  ];
}

async function writeFinalCaseEvidenceBundle(
  summary: WebE2eCaseRunSummary,
  context: WebE2eCaseRunContext,
): Promise<{ manifest: WebE2eEvidenceBundleManifest; manifestPath: string }> {
  return await writeWebE2eEvidenceBundle({
    caseId: summary.caseId,
    outputRoot: context.evidenceRoot,
    artifactRoot: context.evidenceRoot,
    runs: [{
      runId: `final:${summary.caseId}`,
      eventIds: [
        `final-entry:${summary.caseId}:selected`,
        `final-entry:${summary.caseId}:case-passed`,
      ],
      requestDigest: `final:${summary.caseId}:request`,
      resultDigest: `final:${summary.caseId}:result`,
      status: 'passed',
    }],
    projection: {
      projectionVersion: 'sciforge.conversation-projection.v1',
      terminalState: 'passed',
    },
    note: {
      status: 'passed',
      summary: `${summary.title} passed under ${webMultiturnFinalScript}.`,
    },
    extra: {
      completionGate: webMultiturnFinalScript,
      tags: summary.tags,
      migratedLegacyScripts: summary.migratedLegacyScripts,
      migratedLegacySteps: summary.migratedLegacySteps,
      isolatedRunRoot: context.runRoot,
      agentServerMode: context.agentServerMode,
      devServices: devServicesJson(context.devServices),
    },
  });
}

function devServicesJson(services: WebE2eFinalDevService[]): JsonValue {
  return services.map((service) => ({
    name: service.name,
    mode: service.mode,
    status: service.status,
    ...(service.baseUrl ? { baseUrl: service.baseUrl } : {}),
  }));
}

async function writeSingleAgentFinalManifest(input: {
  generatedAt: string;
  runRoot: string;
  webEvidenceRoot: string;
  finalRoot: string;
  selectedTags: string[];
  selectedCases: string[];
  caseManifests: FinalWebE2eCaseManifestRef[];
  devServices: WebE2eFinalDevService[];
  agentServerMode: WebE2eAgentServerMode;
  requiredLegacyScripts: string[];
}): Promise<string> {
  await mkdir(input.finalRoot, { recursive: true });
  const manifestPath = join(input.finalRoot, 'manifest.json');
  const manifest: SingleAgentFinalManifest = {
    schemaVersion: 'sciforge.single-agent-final.manifest.v1',
    generatedAt: input.generatedAt,
    completionGate: webMultiturnFinalScript,
    command: `${webMultiturnFinalCommand}${process.argv.slice(2).length ? ` ${process.argv.slice(2).join(' ')}` : ''}`,
    selectedCases: input.selectedCases,
    selectedTags: input.selectedTags,
    isolatedRunRoot: input.runRoot,
    webEvidenceRoot: input.webEvidenceRoot,
    devServices: input.devServices,
    agentServer: {
      mode: input.agentServerMode,
      mock: 'scriptable-agentserver-mock',
      realProviderPolicy: 'optional-happy-path-only',
    },
    caseManifests: input.caseManifests,
    legacyMigration: scenarios.map((scenario) => ({
      legacyScript: scenario.legacyScript,
      delegatedTo: webMultiturnFinalScript,
      representedByCases: input.caseManifests
        .filter((manifest) => manifest.migratedLegacyScripts.includes(scenario.legacyScript))
        .map((manifest) => manifest.caseId),
      migratedSteps: uniqueStrings(input.caseManifests
        .filter((manifest) => manifest.migratedLegacyScripts.includes(scenario.legacyScript))
        .flatMap((manifest) => manifest.migratedLegacySteps)),
    })),
  };
  if (input.requiredLegacyScripts.length > 0) {
    for (const migration of manifest.legacyMigration.filter((entry) => input.requiredLegacyScripts.includes(entry.legacyScript))) {
      assert.ok(migration.representedByCases.length > 0, `${migration.legacyScript} must be represented in final manifest`);
      assert.ok(migration.migratedSteps.length > 0, `${migration.legacyScript} must list migrated final steps`);
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function requiredLegacyScriptsForSelection(tags: string[], cases: string[]): string[] {
  if (cases.length > 0) return [];
  const legacyScripts = scenarios.map((scenario) => scenario.legacyScript);
  const selectedLegacyScripts = tags.filter((tag) => legacyScripts.includes(tag));
  if (selectedLegacyScripts.length > 0) return selectedLegacyScripts;
  if (tags.length === 0 || tags.includes('SA-WEB-18')) return legacyScripts;
  return [];
}
