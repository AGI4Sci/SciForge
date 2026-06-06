import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { allowedActionTypes, requiredPipeline, requiredTraceMetadata } from './contracts.js';
import type { ComputerUseLongTaskPool, PreparedComputerUseLongRun } from './contracts.js';
import { escapeRegExp, renderPreparedRunChecklist, sanitizeRunId } from './support.js';

const releaseReadinessEvidenceByScenarioId: Record<string, string[]> = {
  'CU-LONG-001': ['browser research report artifact refs'],
  'CU-LONG-002': ['cross-app document source reader -> editor -> file preview evidence'],
  'CU-LONG-003': ['viewport recovery scroll and viewport state refs'],
  'CU-LONG-004': ['form hard-confirm refs for Cancel/Confirm scoped confirmation'],
  'CU-LONG-005': ['file manager evidence refs'],
  'CU-LONG-006': ['terminal/notebook workflow refs and artifact validation'],
  'CU-LONG-007': ['visual disambiguation crop/OCR/vision translator refs and blocked ambiguous target evidence'],
  'CU-LONG-008': ['repair fresh re-observation refs'],
  'CU-LONG-009': ['high-risk confirmation Cancel/Confirm current action/type/turn evidence'],
  'CU-LONG-010': ['CSV/table validator refs'],
};

const releaseReadinessCoverage = [
  { label: 'browser report refs', pattern: /browser research report|browser report|research report artifact/i },
  { label: 'form hard-confirm refs', pattern: /form hard-confirm|hard-confirm.*form|确认.*表单|表单.*确认/i },
  { label: 'CSV/table validator refs', pattern: /CSV\/table validator refs|CSV|table validator|表格.*validator/i },
  { label: 'file manager evidence', pattern: /file manager evidence|file manager screenshots|文件管理器.*evidence/i },
  { label: 'terminal/notebook workflow', pattern: /terminal\/notebook|terminal workflow|notebook workflow|终端|notebook/i },
  { label: 'cross-app document evidence', pattern: /cross-app document|source reader.*editor.*file preview|源.*编辑.*文件预览/i },
  { label: 'visual disambiguation evidence', pattern: /visual disambiguation|crop\/OCR\/vision translator|OCR|语义歧义/i },
  { label: 'viewport recovery evidence', pattern: /viewport recovery|viewport state refs|滚动恢复|viewport/i },
  { label: 'repair fresh re-observation', pattern: /fresh re-observation|repair fresh re-observation|重新观察|re-observation/i },
  { label: 'high-risk confirmation evidence', pattern: /high-risk confirmation|Cancel.*Confirm|Confirm.*Cancel|当前 action\/type\/turn|高风险.*确认/i },
];

export function validateComputerUseLongTaskPool(pool: ComputerUseLongTaskPool): string[] {
  const issues: string[] = [];
  if (pool.schemaVersion !== '1.0') issues.push('schemaVersion must be "1.0"');
  if (pool.taskId !== 'T084') issues.push('taskId must be T084');
  if (!Array.isArray(pool.scenarios) || pool.scenarios.length !== 10) {
    issues.push('T084 Computer Use task pool must define exactly 10 CU-LONG scenarios');
  }
  const releaseReadinessHaystack = taskPoolReleaseReadinessHaystack(pool);
  for (const coverage of releaseReadinessCoverage) {
    if (!coverage.pattern.test(releaseReadinessHaystack)) {
      issues.push(`T084 Computer Use task pool must cover ${coverage.label} for release readiness`);
    }
  }

  const scenarioIds = new Set<string>();
  for (const scenario of pool.scenarios ?? []) {
    if (!/^CU-LONG-\d{3}$/.test(scenario.id)) issues.push(`${scenario.id} must use CU-LONG-### id format`);
    if (scenarioIds.has(scenario.id)) issues.push(`${scenario.id} is duplicated`);
    scenarioIds.add(scenario.id);
    if (scenario.minRounds < 3) issues.push(`${scenario.id} minRounds must be at least 3`);
    if (scenario.rounds.length < scenario.minRounds) issues.push(`${scenario.id} must define minRounds worth of rounds`);
    if (JSON.stringify(scenario.requiredPipeline) !== JSON.stringify(requiredPipeline)) {
      issues.push(`${scenario.id} requiredPipeline must be ${requiredPipeline.join(' -> ')}`);
    }
    if (!scenario.safetyBoundary.noDomAccessibility) issues.push(`${scenario.id} must forbid DOM/accessibility reads`);
    if (!scenario.safetyBoundary.fileRefOnlyImageMemory) issues.push(`${scenario.id} must require file-ref-only image memory`);
    if (!scenario.safetyBoundary.failClosedHighRiskActions) issues.push(`${scenario.id} must fail closed for high-risk actions`);
    if (scenario.safetyBoundary.appSpecificShortcutsAllowed !== false) issues.push(`${scenario.id} must forbid app-specific shortcuts`);
    if (!scenario.acceptance.some((item) => /base64|dataUrl/i.test(item))) issues.push(`${scenario.id} acceptance must check base64/dataUrl absence`);
    if (!scenario.acceptance.some((item) => /DOM|accessibility/i.test(item))) issues.push(`${scenario.id} acceptance must check DOM/accessibility absence`);
    if (!scenario.requiredEvidence.includes('vision-trace.json')) issues.push(`${scenario.id} must require vision-trace.json evidence`);
    if (!scenario.requiredEvidence.includes('before/after screenshots')) issues.push(`${scenario.id} must require before/after screenshots`);
    if (!scenario.requiredEvidence.includes('action ledger')) issues.push(`${scenario.id} must require action ledger evidence`);
    if (!scenario.requiredEvidence.includes('failure diagnostics')) issues.push(`${scenario.id} must require failure diagnostics`);
    for (const required of requiredTraceMetadata) {
      const haystack = [
        scenario.goal,
        ...scenario.acceptance,
        ...scenario.requiredEvidence,
        ...scenario.failureRecord,
        ...scenario.rounds.flatMap((round) => [round.prompt, ...round.expectedTrace]),
      ].join(' ');
      if (!new RegExp(escapeRegExp(required), 'i').test(haystack)) {
        issues.push(`${scenario.id} must require ${required} trace/run metadata`);
      }
    }

    const roundNumbers = scenario.rounds.map((round) => round.round);
    const expectedRoundNumbers = Array.from({ length: scenario.rounds.length }, (_, index) => index + 1);
    if (roundNumbers.join(',') !== expectedRoundNumbers.join(',')) {
      issues.push(`${scenario.id} rounds must be sequential from 1`);
    }
    for (const round of scenario.rounds) {
      if (!round.prompt.trim()) issues.push(`${scenario.id} round ${round.round} prompt is empty`);
      if (hasUndefinedGuiSubtaskPlaceholder(round.prompt)) issues.push(`${scenario.id} round ${round.round} prompt uses an undefined GUI subtask placeholder`);
      if (!round.expectedTrace.length) issues.push(`${scenario.id} round ${round.round} must declare expected trace evidence`);
    }
  }

  return issues;
}

function hasUndefinedGuiSubtaskPlaceholder(prompt: string) {
  return /GUI\s*子任务\s*[A-ZＡ-Ｚ]|GUI\s*sub-?task\s*[A-Z]/i.test(prompt);
}

export async function loadComputerUseLongTaskPool(path = resolve('tests', 'computer-use-long', 'task-pool.json')) {
  return withReleaseReadinessEvidence(JSON.parse(await readFile(path, 'utf8')) as ComputerUseLongTaskPool);
}

function withReleaseReadinessEvidence(pool: ComputerUseLongTaskPool): ComputerUseLongTaskPool {
  return {
    ...pool,
    scenarios: (pool.scenarios ?? []).map((scenario) => ({
      ...scenario,
      requiredPipeline,
      requiredEvidence: dedupeStrings([
        ...scenario.requiredEvidence,
        ...(releaseReadinessEvidenceByScenarioId[scenario.id] ?? []),
      ]),
    })),
  };
}

function taskPoolReleaseReadinessHaystack(pool: ComputerUseLongTaskPool) {
  return (pool.scenarios ?? []).map((scenario) => [
    scenario.id,
    scenario.title,
    scenario.goal,
    ...scenario.acceptance,
    ...scenario.requiredEvidence,
    ...scenario.failureRecord,
    ...scenario.rounds.flatMap((round) => [round.prompt, ...round.expectedTrace]),
  ].join(' ')).join('\n');
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}

export async function prepareComputerUseLongRun(options: {
  scenarioId: string;
  outRoot?: string;
  runId?: string;
  workspacePath?: string;
  appUrl?: string;
  backend?: string;
  operator?: string;
  now?: Date;
}) {
  const pool = await loadComputerUseLongTaskPool();
  const issues = validateComputerUseLongTaskPool(pool);
  if (issues.length) throw new Error(`Invalid T084 Computer Use task pool:\n${issues.join('\n')}`);
  const scenario = pool.scenarios.find((item) => item.id === options.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${options.scenarioId}`);
  const now = options.now ?? new Date();
  const runId = sanitizeRunId(options.runId || `${scenario.id.toLowerCase()}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}`);
  const outRoot = resolve(options.outRoot || join('docs', 'test-artifacts', 'computer-use-long'));
  const runDir = join(outRoot, scenario.id, runId);
  const manifestPath = join(runDir, 'manifest.json');
  const checklistPath = join(runDir, 'run-checklist.md');
  const evidenceDir = join(runDir, 'evidence');
  const manifest: PreparedComputerUseLongRun = {
    schemaVersion: '1.0',
    taskId: 'T084',
    scenarioId: scenario.id,
    title: scenario.title,
    status: 'not-run',
    run: {
      id: runId,
      startedAt: now.toISOString(),
      workspacePath: options.workspacePath || resolve('workspace'),
      appUrl: options.appUrl,
      backend: options.backend,
      operator: options.operator || 'Codex',
      windowTarget: {
        mode: 'required',
        expectedScope: 'active-window-or-selected-window',
        coordinateSpace: 'window-local',
      },
      inputChannel: {
        mode: 'generic-mouse-keyboard',
        allowedActionTypes: Array.from(allowedActionTypes),
      },
      scheduler: {
        mode: 'serialized-window-actions',
        requiresBeforeAfterScreenshots: true,
      },
    },
    universalPipeline: scenario.requiredPipeline,
    validationContract: {
      requiredTraceMetadata,
      screenshotScope: 'window',
      coordinateSpace: 'window-local',
      inputChannel: 'generic-mouse-keyboard',
      scheduler: 'serialized-window-actions',
    },
    safetyBoundary: scenario.safetyBoundary,
    rounds: scenario.rounds.map((round) => ({
      round: round.round,
      prompt: round.prompt,
      expectedTrace: round.expectedTrace,
      status: 'not-run',
      screenshotRefs: [],
      actionLedgerRefs: [],
      failureDiagnosticsRefs: [],
    })),
    acceptance: scenario.acceptance,
    failureRecord: scenario.failureRecord,
    requiredEvidence: scenario.requiredEvidence,
    notes: [
      'This run must validate generic Computer Use behavior only.',
      'Do not add app-specific patches, DOM reads, accessibility reads, repository scans, or synthetic success artifacts.',
      'If any WindowTarget, RuntimeCodexPlanner, GroundingTranslator, GuiExecutor, or Verifier dependency is missing, record failed-with-reason with real window screenshot refs.',
    ].join(' '),
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(checklistPath, renderPreparedRunChecklist(scenario, manifest));
  return { scenario, runDir, manifestPath, checklistPath, evidenceDir, manifest };
}

export function renderComputerUseLongRunbook(pool: ComputerUseLongTaskPool): string {
  const lines: string[] = [
    `# ${pool.taskId} ${pool.title}`,
    '',
    '## Common Principles',
    ...pool.commonPrinciples.map((item) => `- ${item}`),
    '',
  ];

  for (const scenario of pool.scenarios) {
    lines.push(`## ${scenario.id} ${scenario.title}`);
    lines.push('');
    lines.push(`Goal: ${scenario.goal}`);
    lines.push('');
    lines.push(`Pipeline: ${scenario.requiredPipeline.join(' -> ')}`);
    lines.push('');
    lines.push('Rounds:');
    for (const round of scenario.rounds) {
      lines.push(`${round.round}. ${round.prompt}`);
      lines.push(`   Expected trace: ${round.expectedTrace.join('; ')}`);
    }
    lines.push('');
    lines.push(`Acceptance: ${scenario.acceptance.join('; ')}`);
    lines.push(`Failure record: ${scenario.failureRecord.join('; ')}`);
    lines.push(`Required evidence: ${scenario.requiredEvidence.join('; ')}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
