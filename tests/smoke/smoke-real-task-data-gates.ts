import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRealTaskProjectBoardTask } from './real-task-project-board.js';
import {
  CURRENT_PROJECT_TASK_LEGACY_BOUNDARIES,
  mappingsForSaWebTag,
  type WebE2eContractAssertion,
} from './web-e2e/case-tags.js';

const root = process.cwd();

const [
  projectText,
  registryText,
  matrixText,
  longitudinalCase,
  schemaDriftCase,
  lineageCase,
  largeFileCase,
  data01Runbook,
] = await Promise.all([
  readText('PROJECT.md'),
  readText('tests/smoke/web-e2e/case-registry.ts'),
  readText('tests/smoke/smoke-real-task-matrix.ts'),
  readText('tests/smoke/web-e2e/cases/longitudinal-messy-csv.ts'),
  readText('tests/smoke/web-e2e/cases/schema-drift-confounder.ts'),
  readText('tests/smoke/web-e2e/cases/two-table-lineage.ts'),
  readText('tests/smoke/web-e2e/cases/large-file-diagnostics.ts'),
  readText('docs/test-artifacts/real-tasks/R-DATA-01/live-runbook.md'),
]);

const requiredDataMappings: Array<{
  taskId: string;
  saWebTag: string;
  assertion: WebE2eContractAssertion;
  title: string;
}> = [
  { taskId: 'R-DATA-01', saWebTag: 'SA-WEB-20', assertion: 'longitudinal-messy-csv', title: 'Long-format messy CSV coefficient comparison' },
  { taskId: 'R-DATA-02', saWebTag: 'SA-WEB-21', assertion: 'schema-drift-confounder', title: 'Schema drift confounder reinterpretation' },
  { taskId: 'R-DATA-03', saWebTag: 'SA-WEB-22', assertion: 'two-table-lineage', title: 'Two-table merge lineage and reproducibility' },
  { taskId: 'R-DATA-04', saWebTag: 'SA-WEB-19', assertion: 'large-file-bounded-diagnostics', title: 'Large-file bounded diagnostics' },
];

for (const mapping of requiredDataMappings) {
  assertRealTaskProjectBoardTask(projectText, mapping.taskId, { root });
  assertMatrixGate(mapping.taskId);
  assertLegacyOfflineMapping(mapping);
  assert.match(registryText, new RegExp(`id:\\s*'${mapping.saWebTag}'[\\s\\S]*${escapeRegExp(mapping.title)}`), `${mapping.saWebTag}: must stay registered as ${mapping.title}`);
}

assert.match(
  projectText,
  /SA-WEB-20\/21\/22[\s\S]*fixture-level[\s\S]*不是 live default-chat pass/i,
  'PROJECT.md must state that SA-WEB-20/21/22 are offline contracts, not live default-chat passes',
);
assert.match(
  projectText,
  /共享 browser gate[\s\S]*不能替代 31 个 R-\* 任务各自的三轮 live evidence/i,
  'PROJECT.md must keep the shared browser pass vs task-specific live evidence boundary explicit',
);

assertSourceConcepts('R-DATA-01', longitudinalCase, [
  /coefficientComparisonRef/,
  /covariate-model/,
  /batch and timepoint covariates/i,
  /unadjusted treatment coefficient/i,
  /adjusted treatment coefficient/i,
  /coefficient changed by -3\.30/i,
  /analysis plan must compare unadjusted and adjusted treatment coefficients/i,
]);

assertSourceConcepts('R-DATA-01 live runbook', data01Runbook, [
  /Status before live attempt:\s*`not-run`/i,
  /SA-WEB-20 offline fixture alone/i,
  /web port `5175` and runtime\/backend port `6175`/i,
  /Codex in-app browser default chat/i,
  /subject\/group\/timepoint\/batch\/outcome/i,
  /task-specific-live-attempt/i,
  /provider`, `model`, `profile`/i,
  /report, cleaned data, chart, coefficient comparison, and script/i,
  /three visible Runtime Codex default-chat turns/i,
]);

assertSourceConcepts('R-DATA-02', schemaDriftCase, [
  /schema-drift-confounder/,
  /reveal-confounder/,
  /site\/batch confounder/i,
  /staleRefPolicy/,
  /qc-only-not-inference/,
  /validRefsManifestRef/,
  /stale interpretation refs/i,
]);

assertSourceConcepts('R-DATA-03', lineageCase, [
  /two-table-lineage/,
  /lineageManifestRef/,
  /mapping-filter-update/,
  /filterChanges/,
  /finalColumns/,
  /reproducibilityCommand/,
  /sa-web-22-reproduce-merge\.ts/,
]);

assertSourceConcepts('R-DATA-04', largeFileCase, [
  /large-file-bounded-diagnostics/,
  /workspace\.reader\.read_ref/,
  /index-and-bounded-snippets-only/,
  /bounded-snippet/,
  /includeFullText,\s*false/,
  /byteRange/,
  /maxBytes/,
  /diagnostic report and read-fragment manifest/i,
]);

console.log('[ok] real-task data gates cover R-DATA-01/02/03/04 through offline SA-WEB-20/21/22/19 mappings and source-level data concepts without claiming a live pass');

function assertMatrixGate(taskId: string): void {
  assert.match(matrixText, new RegExp(`task\\('${taskId}'[\\s\\S]*smoke:web-multiturn-final`), `${taskId}: must remain in the real-task matrix with a deterministic smoke gate`);
}

function assertLegacyOfflineMapping(mapping: typeof requiredDataMappings[number]): void {
  const matches = mappingsForSaWebTag(mapping.saWebTag).filter((candidate) => candidate.rTaskId === mapping.taskId);
  assert.equal(matches.length, 1, `${mapping.taskId}: must map to ${mapping.saWebTag} exactly once`);
  assert.ok(matches[0]?.contractAssertions.includes(mapping.assertion), `${mapping.taskId}: ${mapping.saWebTag} must require ${mapping.assertion}`);

  const boundary = CURRENT_PROJECT_TASK_LEGACY_BOUNDARIES.find((candidate) => candidate.taskId === mapping.taskId);
  assert.equal(boundary?.legacyWebE2eMappingsCanSatisfy, false, `${mapping.taskId}: legacy/offline web-e2e mappings must not claim live task completion`);
}

function assertSourceConcepts(taskId: string, source: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${taskId}: source must include ${pattern}`);
  }
}

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
