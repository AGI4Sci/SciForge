import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ComputerUseTaskStatus = 'done' | 'partial';

type ComputerUseTaskBoardEntry = {
  id: string;
  title: string;
  status: ComputerUseTaskStatus;
  line: number;
  checklist: Array<{
    checked: boolean;
    text: string;
    line: number;
  }>;
};

type ComputerUseMatrixEntry = {
  id: string;
  family: string;
  requiredGates: string[];
  requiredEvidence: Array<
    | 'project-board-evidence'
    | 'package-boundary'
    | 'runtime-codex-planner'
    | 'kv-ground-diagnostics'
    | 'real-input-trace'
    | 'gui-present'
    | 'no-hardcoded-success'
    | 'no-legacy-paths'
  >;
};

const root = process.cwd();
const projectText = await readFile(join(root, 'PROJECT.md'), 'utf8');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };

const matrix: ComputerUseMatrixEntry[] = [
  task('CU-00', 'preflight-and-real-environment', ['smoke:runtime-provider-preflight', 'smoke:vision-sense-runtime'], ['project-board-evidence', 'kv-ground-diagnostics']),
  task('CU-01', 'computer-use-package-boundary', ['smoke:package-runtime-boundary', 'smoke:native-extension-ownership'], ['project-board-evidence', 'package-boundary', 'no-legacy-paths']),
  task('CU-02', 'runtime-codex-text-planner', ['smoke:runtime-codex-final-acceptance', 'smoke:vision-sense-runtime'], ['project-board-evidence', 'runtime-codex-planner']),
  task('CU-03', 'kv-ground-grounder', ['smoke:vision-sense-runtime'], ['project-board-evidence', 'kv-ground-diagnostics']),
  task('CU-04', 'l1-real-input-smoke', ['smoke:vision-sense-runtime', 'smoke:capability-budget-debits'], ['project-board-evidence', 'real-input-trace']),
  task('CU-05', 'user-level-computer-use-acceptance', ['smoke:no-hardcoded-success', 'smoke:runtime-codex-browser-acceptance'], ['project-board-evidence', 'real-input-trace', 'gui-present', 'no-hardcoded-success']),
  task('CU-06', 'tui-gui-communication-acceptance', ['smoke:runtime-codex-browser-acceptance', 'smoke:runtime-codex-final-acceptance'], ['project-board-evidence', 'gui-present']),
  task('CU-07', 'verification-and-regression', ['smoke:no-legacy-paths', 'smoke:no-hardcoded-success', 'smoke:runtime-provider-preflight'], ['project-board-evidence', 'no-legacy-paths', 'no-hardcoded-success']),
  task('CU-08', 'docs-and-migration-closure', ['smoke:package-runtime-boundary', 'smoke:native-extension-ownership'], ['project-board-evidence', 'package-boundary']),
];

const projectTasks = extractComputerUseTaskBoard(projectText);
const projectIds = [...projectTasks.keys()].sort();
const matrixIds = matrix.map((entry) => entry.id).sort();

assert.deepEqual(matrixIds, projectIds, 'Computer Use matrix must cover exactly the active CU-* task board in PROJECT.md');
assert.equal(new Set(matrixIds).size, matrix.length, 'Computer Use matrix ids must be unique');

for (const entry of matrix) {
  const projectTask = projectTasks.get(entry.id);
  assert.ok(projectTask, `${entry.id}: missing PROJECT.md task section`);
  assert.ok(entry.requiredGates.length > 0, `${entry.id}: must name at least one deterministic gate`);
  assert.ok(entry.requiredGates.every((gate) => gate.startsWith('smoke:')), `${entry.id}: gates must be npm smoke scripts`);
  assert.ok(entry.requiredGates.every((gate) => packageJson.scripts?.[gate]), `${entry.id}: all gates must exist in package.json scripts`);
  assert.ok(entry.requiredEvidence.includes('project-board-evidence'), `${entry.id}: PROJECT.md evidence is required`);
  assert.ok(projectTask.checklist.length > 0, `${entry.id}: PROJECT.md section must keep executable checklist items`);

  for (const item of projectTask.checklist) {
    if (item.checked) assertEvidenceInline(entry.id, item);
  }

  if (projectTask.status === 'done') {
    assert.ok(
      projectTask.checklist.every((item) => item.checked),
      `${entry.id}: done section cannot contain unchecked checklist items`,
    );
  } else {
    assert.ok(
      projectTask.checklist.some((item) => !item.checked),
      `${entry.id}: partial section must expose at least one unchecked remaining task`,
    );
  }
}

assert.ok(
  matrix.some((entry) => entry.requiredGates.includes('smoke:runtime-codex-browser-acceptance')),
  'Computer Use matrix must keep the in-app browser acceptance gate in scope',
);
assert.ok(
  matrix.some((entry) => entry.requiredEvidence.includes('no-legacy-paths')),
  'Computer Use matrix must keep old-logic deletion hygiene in scope',
);

console.log(`[ok] Computer Use task matrix covers ${matrix.length} active PROJECT.md CU-* sections with deterministic gates and inline evidence checks.`);

function task(
  id: string,
  family: string,
  requiredGates: string[],
  requiredEvidence: ComputerUseMatrixEntry['requiredEvidence'],
): ComputerUseMatrixEntry {
  return {
    id,
    family,
    requiredGates,
    requiredEvidence,
  };
}

function extractComputerUseTaskBoard(text: string): Map<string, ComputerUseTaskBoardEntry> {
  const tasks = new Map<string, ComputerUseTaskBoardEntry>();
  const lines = text.split(/\r?\n/);
  let current: ComputerUseTaskBoardEntry | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = /^### (CU-\d{2})\s+(.+)$/.exec(line);
    if (section) {
      current = {
        id: section[1],
        title: section[2].trim(),
        status: 'done',
        line: index + 1,
        checklist: [],
      };
      assert.ok(!tasks.has(current.id), `${current.id}: duplicate PROJECT.md section`);
      tasks.set(current.id, current);
      continue;
    }

    if (!current) continue;
    if (/^###\s+/.test(line)) {
      current = undefined;
      continue;
    }

    const item = /^- \[([ xX])\]\s+(.+)$/.exec(line);
    if (!item) continue;
    const checked = item[1].toLowerCase() === 'x';
    current.checklist.push({
      checked,
      text: item[2].trim(),
      line: index + 1,
    });
    if (!checked) current.status = 'partial';
  }

  assert.ok(tasks.size > 0, 'PROJECT.md must contain active CU-* task sections');
  return tasks;
}

function assertEvidenceInline(id: string, item: { text: string; line: number }): void {
  assert.match(
    item.text,
    /20\d{2}-\d{2}-\d{2}/,
    `${id} line ${item.line}: checked checklist item must include an evidence date`,
  );
  assert.match(
    item.text,
    /evidence|passed|status|blocked|partial|证据|状态/i,
    `${id} line ${item.line}: checked checklist item must include evidence or status text`,
  );
}
