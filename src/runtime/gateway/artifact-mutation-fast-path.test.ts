import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { tryRunArtifactMutationFastPath } from './artifact-mutation-fast-path.js';

test('artifact mutation fast path rewrites selected mini-grant markdown without AgentServer', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-mutation-'));
  const grantDir = join(workspace, 'p6-mini-grant');
  await mkdir(grantDir, { recursive: true });
  await writeFile(join(grantDir, 'timeline-budget.md'), [
    '# Timeline & Budget',
    '## Timeline (12 months)',
    '## Budget ($120,000)',
    '| Personnel – PI (0.5 FTE, 12 mo) | $45,000 |',
  ].join('\n'), 'utf8');

  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: [
      'Selected artifact: p6-mini-grant/timeline-budget.md。请只基于这个 artifact 做局部重写：',
      '- 把 budget table 改成 personnel、compute、data-validation、contingency 四类。',
      '- 必须保留 v2 新约束：总预算 80,000 USD、周期 9 months、团队 1 PI 0.4 FTE、1 engineer 0.4 FTE、1 wet-lab scientist 0.2 FTE、无真实 patient data。',
      '- 不要恢复旧约束：不要出现 120,000 USD、12 months、0.5 FTE 或 0.25 FTE。',
      '- 只改 p6-mini-grant/timeline-budget.md；主回复说明相对上一轮改了哪里，并给出 workspace ref。',
    ].join('\n'),
    workspacePath: workspace,
    artifacts: [],
  };

  const payload = await tryRunArtifactMutationFastPath(request);
  assert.ok(payload);
  assert.equal(payload?.claimType, 'artifact-rewrite');
  assert.equal(payload?.displayIntent?.taskOutcome, 'satisfied');
  assert.deepEqual(payload?.artifacts.map((artifact) => artifact.path), ['p6-mini-grant/timeline-budget.md']);
  assert.match(payload?.message ?? '', /实际写回 1 个 workspace markdown artifact/);
  assert.match(payload?.message ?? '', /budget categories: personnel \/ compute \/ data-validation \/ contingency/);

  const updated = await readFile(join(grantDir, 'timeline-budget.md'), 'utf8');
  assert.match(updated, /Timeline \(9 months\)/);
  assert.match(updated, /Budget \(\$80,000\)/);
  assert.match(updated, /\| Personnel \| \$64,000 \|/);
  assert.match(updated, /\| Compute \| \$8,000 \|/);
  assert.match(updated, /\| Data-validation \| \$5,000 \|/);
  assert.match(updated, /\| Contingency \| \$3,000 \|/);
  assert.match(updated, /No real patient data/);
  assert.doesNotMatch(updated, /120,000|12 months|0\.5 FTE|0\.25 FTE/);
});

test('artifact mutation fast path yields to Computer Use provider requests', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-artifact-mutation-'));
  await writeFile(join(workspace, 'report.md'), '# Old Report\n', 'utf8');

  const request: GatewayRequest = {
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    selectedActionIds: ['action.sciforge.computer-use'],
    uiState: { selectedActionIds: ['action.sciforge.computer-use'] },
    prompt: [
      '/computer-use run operate the target window with generic mouse/keyboard.',
      'Focus a visible editable body and write report.md through GUI evidence.',
    ].join('\n'),
  };

  const payload = await tryRunArtifactMutationFastPath(request);
  assert.equal(payload, undefined);
  assert.equal(await readFile(join(workspace, 'report.md'), 'utf8'), '# Old Report\n');
});

test('artifact mutation fast path ignores keyword-only edit discussions without write intent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-keyword-collision-'));
  await writeFile(join(workspace, 'report.md'), '# Old Report\nBudget $120,000 for 12 months.\n', 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      'For report.md, explain how an editor would update, rewrite, save, or replace markdown artifacts safely.',
      'This is only a discussion of edit policy and should not write files or mutate the workspace.',
      'Mention examples like budget 80,000 USD and duration 9 months, but do not apply them.',
    ].join(' '),
  });

  assert.equal(payload, undefined);
  assert.equal(await readFile(join(workspace, 'report.md'), 'utf8'), '# Old Report\nBudget $120,000 for 12 months.\n');
});

test('artifact mutation fast path requires explicit selected markdown ref and concrete write operation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-semantic-write-'));
  await mkdir(join(workspace, 'selected'), { recursive: true });
  await writeFile(join(workspace, 'selected', 'report.md'), '# Report\nBudget $120,000 for 12 months.\n', 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [{ id: 'report', type: 'research-report', metadata: { markdownRef: 'selected/report.md' } }],
    uiState: {
      currentReferences: [{ kind: 'file', ref: 'file:selected/report.md', title: 'report.md' }],
    },
    prompt: [
      'Update the selected artifact and write back the changes.',
      'Use the current ref selected/report.md only.',
      'Replace the budget with 80,000 USD and duration with 9 months.',
    ].join(' '),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.artifacts.map((artifact) => artifact.path), ['selected/report.md']);
  const updated = await readFile(join(workspace, 'selected', 'report.md'), 'utf8');
  assert.match(updated, /Budget: \$80,000/);
  assert.match(updated, /Duration: 9 months/);
  assert.doesNotMatch(updated, /120,000|12 months/);
});

test('artifact mutation fast path applies generic constraint rewrites to arbitrary markdown artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generic-artifact-mutation-'));
  const packageDir = join(workspace, 'audit-package');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'design-note.md'), [
    '# Design Note',
    '',
    '## Budget',
    '| Category | Cost | Notes |',
    '|---|---|---|',
    '| Old personnel | $90,000 | old team |',
    '',
    'The project lasts 18 months and uses analyst 0.5 FTE.',
  ].join('\n'), 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      '请更新 audit-package/design-note.md 并写回 workspace。',
      '新约束：budget 改为 60,000 USD，duration 改为 6 months，analyst 0.2 FTE。',
      '预算表 categories: personnel, compute, validation。',
      '不要出现旧约束 90,000 USD、18 months、0.5 FTE。',
    ].join('\n'),
  });

  assert.ok(payload);
  assert.equal(payload?.artifacts[0]?.path, 'audit-package/design-note.md');
  assert.match(payload?.message ?? '', /audit-package\/design-note\.md/);
  const updated = await readFile(join(packageDir, 'design-note.md'), 'utf8');
  assert.match(updated, /Budget: \$60,000/);
  assert.match(updated, /Duration: 6 months/);
  assert.match(updated, /analyst 0\.2 FTE/i);
  assert.match(updated, /\| Personnel \| \$20,000 \|/);
  assert.match(updated, /\| Compute \| \$20,000 \|/);
  assert.match(updated, /\| Validation \| \$20,000 \|/);
  assert.doesNotMatch(updated, /90,000|18 months|0\.5 FTE/);
});

test('artifact mutation fast path respects explicit selected artifact target and parses new constraints before old-constraint bans', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-explicit-selected-mutation-'));
  await mkdir(join(workspace, 'generic-eval'), { recursive: true });
  await mkdir(join(workspace, 'other-package'), { recursive: true });
  await writeFile(join(workspace, 'generic-eval', 'design-note.md'), 'Budget $60,000 for 6 months. analyst 0.2 FTE.\n', 'utf8');
  await writeFile(join(workspace, 'other-package', 'risk-register.md'), 'Do not touch this file.\n', 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    references: [{ kind: 'file', ref: 'file:other-package/risk-register.md', title: 'risk-register.md' }],
    uiState: {
      currentReferences: [{ kind: 'file', ref: 'file:other-package/risk-register.md', title: 'risk-register.md' }],
    },
    prompt: [
      'Selected artifact: generic-eval/design-note.md. Rewrite only this artifact and write back.',
      'Replace constraints with v2: budget 72,000 USD; duration 8 months; analyst 0.25 FTE.',
      'Budget categories: personnel, software, validation, contingency.',
      'Do not show old constraints 60,000 USD, 6 months, 0.2 FTE.',
    ].join(' '),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.artifacts.map((artifact) => artifact.path), ['generic-eval/design-note.md']);
  const updated = await readFile(join(workspace, 'generic-eval', 'design-note.md'), 'utf8');
  assert.match(updated, /Budget: \$72,000/);
  assert.match(updated, /Duration: 8 months/);
  assert.match(updated, /analyst 0\.25 FTE/i);
  assert.match(updated, /\| Software \| \$18,000 \|/);
  assert.match(updated, /\| Contingency \| \$18,000 \|/);
  assert.doesNotMatch(updated, /60,000|6 months|0\.2 FTE/);
  assert.equal(await readFile(join(workspace, 'other-package', 'risk-register.md'), 'utf8'), 'Do not touch this file.\n');
});

test('artifact mutation fast path replaces stale current constraints section instead of appending duplicates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-stale-current-constraints-'));
  await mkdir(join(workspace, 'generic-eval'), { recursive: true });
  await writeFile(join(workspace, 'generic-eval', 'design-note.md'), [
    '# Design Note',
    '',
    '## Budget',
    '| Category | Cost | Notes |',
    '|----------|------|-------|',
    '| Personnel | $20,000 | analyst 0.2 FTE |',
    '| Compute | $20,000 | stale category |',
    '| Validation | $20,000 | stale amount |',
    '| **Total** | **$60,000** | |',
    '',
    '## Current Constraints',
    '- Budget: $60,000',
    '- Duration: 6 months',
    '- Team/FTE: analyst 0.2 FTE',
    '- Budget categories: personnel / compute',
  ].join('\n'), 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      'Repair the previous generic artifact edit.',
      'Selected artifact: generic-eval/design-note.md. Rewrite only generic-eval/design-note.md and write back.',
      'Effective constraints: budget 72,000 USD; duration 8 months; analyst 0.25 FTE; engineer 0.35 FTE.',
      'Budget categories: personnel, software, validation, contingency.',
      'Remove old constraints 60,000 USD, 6 months, 0.2 FTE, 0.3 FTE.',
    ].join(' '),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.artifacts.map((artifact) => artifact.path), ['generic-eval/design-note.md']);
  const updated = await readFile(join(workspace, 'generic-eval', 'design-note.md'), 'utf8');
  assert.equal((updated.match(/^## Current Constraints$/gm) ?? []).length, 1);
  assert.equal((updated.match(/^- Duration:/gm) ?? []).length, 1);
  assert.equal((updated.match(/^- Budget categories:/gm) ?? []).length, 1);
  assert.match(updated, /Budget: \$72,000/);
  assert.match(updated, /Duration: 8 months/);
  assert.match(updated, /analyst 0\.25 FTE; engineer 0\.35 FTE/i);
  assert.match(updated, /Budget categories: personnel \/ software \/ validation \/ contingency/);
  assert.doesNotMatch(updated, /60,000|6 months|0\.2 FTE|0\.3 FTE|personnel \/ compute/);
});

test('artifact mutation fast path preserves arbitrary non-budget constraints generically', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-arbitrary-constraints-'));
  await mkdir(join(workspace, 'repro-audit'), { recursive: true });
  await writeFile(join(workspace, 'repro-audit', 'audit.md'), [
    '# Reproducibility Audit',
    '',
    '## Current Constraints',
    '- Runtime: Python 3.10',
    '- Sample size: 24',
    '- Metrics: accuracy only',
    '- Owner: TBD',
  ].join('\n'), 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      'Selected artifact: repro-audit/audit.md. Rewrite only repro-audit/audit.md and write back.',
      'Hard requirements v2: runtime Python 3.11; sample size 48; privacy synthetic data only; metrics AUROC and calibration; owner QA lead.',
      'Include sections: Scope, Acceptance Criteria, Risks.',
      'Remove old constraints: Python 3.10, sample size 24, accuracy only, owner TBD.',
      'Main answer must list the active constraints and changed file.',
    ].join(' '),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.artifacts.map((artifact) => artifact.path), ['repro-audit/audit.md']);
  assert.match(payload?.message ?? '', /Runtime=Python 3\.11/i);
  assert.match(payload?.message ?? '', /Sample Size=48/i);
  assert.match(payload?.message ?? '', /Privacy=synthetic data only/i);
  const updated = await readFile(join(workspace, 'repro-audit', 'audit.md'), 'utf8');
  assert.equal((updated.match(/^## Current Constraints$/gm) ?? []).length, 1);
  assert.match(updated, /Runtime: Python 3\.11/);
  assert.match(updated, /Sample Size: 48/);
  assert.match(updated, /Privacy: synthetic data only/);
  assert.match(updated, /Metrics: AUROC and calibration/);
  assert.match(updated, /Owner: QA lead/);
  assert.match(updated, /^## Scope$/m);
  assert.match(updated, /^## Acceptance Criteria$/m);
  assert.match(updated, /^## Risks$/m);
  assert.doesNotMatch(updated, /Include Sections|Acceptance: Criteria/);
  assert.doesNotMatch(updated, /Python 3\.10|sample size 24|accuracy only|owner TBD/i);
});

test('artifact mutation fast path refreshes requested section bodies when constraints change', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-refresh-sections-'));
  await mkdir(join(workspace, 'repro-audit'), { recursive: true });
  await writeFile(join(workspace, 'repro-audit', 'audit.md'), [
    '# Reproducibility Audit',
    '',
    '## Scope',
    '- Scope is bounded by the active constraints: Runtime: Python 3.10; Sample Size: 24; Metrics: accuracy only.',
    '',
    '## Acceptance Criteria',
    '- Active constraints are reflected in the artifact: Runtime: Python 3.10; Sample Size: 24; Metrics: accuracy only.',
    '',
    '## Risks',
    '- Remaining risk: old risk text.',
    '',
    '## Current Constraints',
    '- Runtime: Python 3.10',
    '- Sample Size: 24',
    '- Metrics: accuracy only',
  ].join('\n'), 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'knowledge',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      'Selected artifact: repro-audit/audit.md. Rewrite only repro-audit/audit.md and write back.',
      'Hard requirements v2: runtime Python 3.11; sample size 48; metrics AUROC and calibration; owner QA lead.',
      'Include sections: Scope, Acceptance Criteria, Risks.',
      'Remove old constraints: Python 3.10, sample size 24, accuracy only.',
    ].join(' '),
  });

  assert.ok(payload);
  const updated = await readFile(join(workspace, 'repro-audit', 'audit.md'), 'utf8');
  assert.match(updated, /Scope is bounded by the active constraints: Runtime: Python 3\.11; Sample Size: 48; Metrics: AUROC and calibration; Owner: QA lead/);
  assert.match(updated, /Active constraints are reflected in the artifact: Runtime: Python 3\.11; Sample Size: 48; Metrics: AUROC and calibration; Owner: QA lead/);
  assert.doesNotMatch(updated, /Python 3\.10|Sample Size: 24|accuracy only|Include Sections|Acceptance: Criteria/);
});

test('artifact mutation fast path rewrites mini-grant package constraints across files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-package-'));
  const grantDir = join(workspace, 'p6-mini-grant');
  await mkdir(grantDir, { recursive: true });
  await writeFile(join(grantDir, 'project-brief.md'), 'A 12-month, $120,000 project.\n', 'utf8');
  await writeFile(join(grantDir, 'methods-plan.md'), 'PI (0.5 FTE)\n', 'utf8');
  await writeFile(join(grantDir, 'risk-register.md'), 'PI time too limited (0.5 FTE)\n', 'utf8');
  await writeFile(join(grantDir, 'timeline-budget.md'), '## Timeline (12 months)\n## Budget ($120,000)\n', 'utf8');

  const payload = await tryRunArtifactMutationFastPath({
    skillDomain: 'literature',
    workspacePath: workspace,
    artifacts: [],
    prompt: [
      '请继续修改刚才的 p6-mini-grant 交付物，要求替换旧约束而不是并存：',
      '总预算从 120,000 USD 改为 80,000 USD；项目周期从 12 months 改为 9 months。',
      '团队改为 1 PI 0.4 FTE、1 part-time engineer 0.4 FTE、1 wet-lab scientist 0.2 FTE。',
      '仍然不允许真实 patient data，只能 synthetic 或公开匿名数据。',
      '请重写 p6-mini-grant/timeline-budget.md 和 p6-mini-grant/risk-register.md，并保持 project-brief.md、methods-plan.md 与新约束一致。',
    ].join('\n'),
  });

  assert.ok(payload);
  assert.equal(payload?.artifacts.length, 4);
  for (const name of ['project-brief.md', 'methods-plan.md', 'risk-register.md', 'timeline-budget.md']) {
    const text = await readFile(join(grantDir, name), 'utf8');
    assert.doesNotMatch(text, /120,000|12 months|0\.5 FTE|0\.25 FTE/);
  }
  assert.match(await readFile(join(grantDir, 'risk-register.md'), 'utf8'), /0\.4 FTE/);
});
