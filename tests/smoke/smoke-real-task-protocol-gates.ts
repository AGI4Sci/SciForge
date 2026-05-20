import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRealTaskProjectBoardTask } from './real-task-project-board.js';
import {
  CURRENT_PROJECT_WEB_E2E_COVERAGE,
  currentProjectMappingsForSaWebTag,
} from './web-e2e/case-tags.js';

const root = process.cwd();
const [projectText, packageJson, registryText, guiActionCase, guiResourceCase, askUserCase] = await Promise.all([
  readText('PROJECT.md'),
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('tests/smoke/web-e2e/case-registry.ts'),
  readText('tests/smoke/web-e2e/cases/gui-action-command-trace.ts'),
  readText('tests/smoke/web-e2e/cases/gui-resource-probing.ts'),
  readText('tests/smoke/web-e2e/cases/gui-ask-user-clarification.ts'),
]);

assert.equal(
  packageJson.scripts?.['smoke:real-task-protocol-gates'],
  'tsx tests/smoke/smoke-real-task-protocol-gates.ts',
  'package.json must expose the protocol real-task gate',
);

const proto01 = currentProjectMappingsForSaWebTag('SA-WEB-28').find((mapping) => mapping.taskId === 'R-PROTO-01');
assert.ok(proto01, 'R-PROTO-01 must map to SA-WEB-28');
assert.ok(proto01.contractAssertions.includes('text-only-gui-action'), 'R-PROTO-01 must require text-only GUI action command trace coverage');

const proto02 = currentProjectMappingsForSaWebTag('SA-WEB-23').find((mapping) => mapping.taskId === 'R-PROTO-02');
assert.ok(proto02, 'R-PROTO-02 must map to SA-WEB-23');
assert.ok(proto02.contractAssertions.includes('progressive-gui-resource-probing'), 'R-PROTO-02 must require progressive GUI resource probing');

const proto03 = currentProjectMappingsForSaWebTag('SA-WEB-24').find((mapping) => mapping.taskId === 'R-PROTO-03');
assert.ok(proto03, 'R-PROTO-03 must map to SA-WEB-24');
assert.ok(proto03.contractAssertions.includes('gui-ask-user-clarification'), 'R-PROTO-03 must require gui.ask_user clarification coverage');

for (const taskId of ['R-PROTO-01', 'R-PROTO-02', 'R-PROTO-03'] as const) {
  assertRealTaskProjectBoardTask(projectText, taskId, { root });
}

const currentCoverageIds = new Set(CURRENT_PROJECT_WEB_E2E_COVERAGE.map((mapping) => mapping.taskId));
for (const taskId of ['R-MEM-01', 'R-PROTO-01', 'R-PROTO-02', 'R-PROTO-03', 'R-RESUME-01'] as const) {
  assert.equal(
    currentCoverageIds.has(taskId),
    true,
    `${taskId}: protocol/resume/memory contract must remain covered as current-project web-e2e coverage expands`,
  );
}

assert.match(registryText, /id:\s*'SA-WEB-28'[\s\S]*Text-only GUI action command trace/, 'SA-WEB-28 must be registered');
assert.match(registryText, /id:\s*'SA-WEB-23'[\s\S]*Progressive GUI resource probing/, 'SA-WEB-23 must be registered');
assert.match(registryText, /id:\s*'SA-WEB-24'[\s\S]*gui\.ask_user clarification commandText/, 'SA-WEB-24 must be registered');

assert.match(guiActionCase, /open[\s\S]*retry[\s\S]*export[\s\S]*recover[\s\S]*delete/, 'R-PROTO-01 must cover open/retry/export/recover/delete visible GUI actions');
assert.match(guiActionCase, /terminal-equivalent commandText|terminalEquivalent/, 'R-PROTO-01 GUI actions must reduce to terminal-equivalent commandText');
assert.match(guiActionCase, /refs[\s\S]*auditTraceRef/, 'R-PROTO-01 command dispatches must carry refs and audit trace');
assert.match(guiActionCase, /hidden business payload|businessPayload|localBusinessExecution/i, 'R-PROTO-01 must forbid hidden GUI business payload/local execution');
assert.doesNotMatch(guiActionCase, /businessPayload:\s*\{[^}]/, 'R-PROTO-01 fixture must not include a hidden business payload');

assert.match(guiResourceCase, /shell[\s\S]*hot-region[\s\S]*region-detail/, 'R-PROTO-02 must cover progressive resource order');
assert.match(guiResourceCase, /full DOM|debug snapshot|debug/i, 'R-PROTO-02 must forbid full DOM/debug snapshots');
assert.match(guiResourceCase, /commandText/, 'R-PROTO-02 narrow question must be represented as commandText');
assert.doesNotMatch(guiResourceCase, /readFullDom|fullDomAllowed:\s*true/, 'R-PROTO-02 must not allow full DOM reads');

assert.match(askUserCase, /gui\.ask_user/, 'R-PROTO-03 must include gui.ask_user intent evidence');
assert.match(askUserCase, /terminal-equivalent commandText|commandText/, 'R-PROTO-03 user confirmation must return as commandText');
assert.match(askUserCase, /local business function|localBusinessFunction/i, 'R-PROTO-03 must forbid GUI local business functions');

console.log('[ok] real-task protocol gates cover R-PROTO-01/02/03 through SA-WEB-28/23/24 text-only action, progressive resource, and gui.ask_user commandText contracts');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}
