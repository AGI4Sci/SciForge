import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
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
const requestedTags = requestedTagArgs();

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
  assert.ok(
    scenarios.some((scenario) => scenario.manifestTags.includes(tag)),
    `unknown ${webMultiturnFinalScript} manifest tag "${tag}"`,
  );
}

const selected = requestedTags.length
  ? scenarios.filter((scenario) => requestedTags.some((tag) => scenario.manifestTags.includes(tag)))
  : scenarios;

assert.ok(selected.length > 0, `${webMultiturnFinalScript} must select at least one migration scenario`);
console.log(`[ok] ${webMultiturnFinalScript} migration guard selected ${selected.map((scenario) => scenario.id).join(', ')}`);

function requestedTagArgs(): string[] {
  const tags: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--tag') {
      const value = process.argv[index + 1];
      assert.ok(value, '--tag requires a value');
      tags.push(value);
      index += 1;
    } else if (arg.startsWith('--tag=')) {
      tags.push(arg.slice('--tag='.length));
    }
  }
  return tags;
}

function delegatesToFinalTag(command: string | undefined, tag: string): boolean {
  if (!command) return false;
  const normalized = command.replace(/\s+/g, ' ').trim();
  return normalized === `npm run ${webMultiturnFinalScript} -- --tag ${tag}`;
}
