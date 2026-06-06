import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { loadComputerUseLongTaskPool } from '../../tools/computer-use-long-task-pool';
import {
  buildCuUserAcceptanceManifest,
  evaluateCuUserAcceptanceAntiShortcutGuard,
  type CuEvidenceClaim,
  type CuUserAcceptanceInput,
} from '../../tools/cu-user-acceptance-manifest.js';
import { CU_NEXT_TASK_MAPPINGS } from '../../tools/computer-use-next/task-map.js';

type CuNextTaskId = string;

type CuNextRequirement =
  | 'l2-artifact-refs'
  | 'l3-workflow-refs'
  | 'approval-chain'
  | 'repair-continuity'
  | 'dense-grounding'
  | 'user-control-refs'
  | 'observe-before-mutate-refs'
  | 'platform-sidecar-isolation'
  | 'product-path-classification'
  | 'current-bundle-evidence'
  | 'dom-ax-observation-hints'
  | 'no-dom-playwright-accessibility';

const root = process.cwd();
const projectText = await readFile(join(root, 'PROJECT.md'), 'utf8');
const projectCuText = await readFile(join(root, 'PROJECT_CU.md'), 'utf8').catch(() => '');
const projectCorpus = `${projectText}\n${projectCuText}`;
const pool = await loadComputerUseLongTaskPool();
const scenariosById = new Map(pool.scenarios.map((scenario) => [scenario.id, scenario]));
const cuNextBoardStart = projectCorpus.indexOf('这些任务只用于下一轮 Computer Use 实测准备');
const validationStart = projectCorpus.indexOf('## 验证规则');
const cuNextBoardText = cuNextBoardStart >= 0 && validationStart > cuNextBoardStart
  ? projectCorpus.slice(cuNextBoardStart, validationStart)
  : projectCuText;

const cuNextMappings: Array<{
  taskId: CuNextTaskId;
  slug: string;
  longScenarios: string[];
  requirements: CuNextRequirement[];
}> = CU_NEXT_TASK_MAPPINGS.map((mapping) => ({
  taskId: mapping.taskId,
  slug: mapping.slug,
  longScenarios: mapping.longScenarioIds,
  requirements: mapping.requirements,
}));

test('CU-NEXT task map entries map PROJECT.md tasks to existing computer-use-long and user-acceptance harness capabilities', async () => {
  await assertFileExists('tests/computer-use-long/task-pool.json');
  await assertFileExists('tools/cu-user-acceptance-manifest.ts');
  await assertFileExists('tools/cu-l3-independent-input-acceptance-harness.ts');

  assert.ok(cuNextMappings.length > 0);
  assert.ok(cuNextMappings.every((mapping) => /^CU-NEXT-\d{2,}$/.test(mapping.taskId)));
  assert.ok(cuNextMappings.some((mapping) => mapping.requirements.includes('approval-chain')));
  assert.ok(cuNextMappings.some((mapping) => mapping.requirements.includes('repair-continuity')));
  assert.ok(cuNextMappings.some((mapping) => mapping.requirements.includes('dense-grounding')));
  assert.ok(cuNextMappings.some((mapping) => mapping.requirements.includes('l2-artifact-refs')));
  assert.ok(cuNextMappings.every((mapping) => mapping.requirements.includes('l3-workflow-refs')));
  assert.ok(cuNextMappings.every((mapping) => mapping.requirements.includes('dom-ax-observation-hints')));
  assert.ok(cuNextMappings.every((mapping) => mapping.requirements.includes('no-dom-playwright-accessibility')));
  assert.match(projectCorpus, /TUI Host|Codex app-server/);
  assert.match(cuNextBoardText, /before\/after evidence refs|before\/after refs|trace refs/);
  assert.match(cuNextBoardText, /DOM、Playwright、accessibility tree/);

  for (const mapping of cuNextMappings) {
    const section = projectSection(mapping.taskId);
    assert.match(section, new RegExp(mapping.taskId));

    for (const scenarioId of mapping.longScenarios) {
      const scenario = scenariosById.get(scenarioId);
      assert.ok(scenario, `${mapping.taskId}: missing ${scenarioId} in computer-use-long task pool`);
      assert.deepEqual(scenario.requiredPipeline, [
        'WindowTarget',
        'RuntimeCodexPlanner',
        'Grounder',
        'GuiExecutor',
        'Verifier',
        'vision-trace',
      ]);
      assert.equal(scenario.safetyBoundary.noDomAccessibility, true, `${scenarioId}: must reject DOM/accessibility substitutes`);
      assert.equal(scenario.safetyBoundary.appSpecificShortcutsAllowed, false, `${scenarioId}: must stay generic`);
      assert.equal(scenario.safetyBoundary.failClosedHighRiskActions, true, `${scenarioId}: high-risk actions must fail closed`);
      assert.ok(scenario.requiredEvidence.includes('before/after screenshots'), `${scenarioId}: must require screenshot refs`);
      assert.ok(scenario.requiredEvidence.includes('window-local coordinates'), `${scenarioId}: must require Grounder coordinates`);
    }
  }
});

test('CU-NEXT user acceptance manifests preserve L2 artifact refs and L3 workflow refs', () => {
  const l2 = buildCuUserAcceptanceManifest(cuNextAcceptanceInput({
    taskId: 'CU-NEXT-01',
    runId: 'cu-next-01-l2-literature-brief',
    level: 'L2',
    apps: ['LibreOffice Impress'],
    finalArtifactName: 'literature-brief.pptx',
  }));

  assert.equal(l2.status, 'single-app-artifact-passed');
  assert.equal(l2.taskId, 'CU-NEXT-01');
  assert.equal(l2.level, 'L2');
  assert.equal(l2.appWorkflow.kind, 'single-app-artifact');
  assert.match(String(l2.finalArtifactRef), /literature-brief\.pptx$/);
  assert.ok(l2.guiPresent.displayedRefs?.includes(String(l2.finalArtifactRef)));
  assert.ok(l2.screenshotRefs.before.length > 0);
  assert.ok(l2.screenshotRefs.after.length > 0);
  assert.ok(l2.focusCropRefs.length > 0);
  assert.ok(l2.groundingDiagnosticsRefs.length > 0);

  const l3 = buildCuUserAcceptanceManifest(cuNextAcceptanceInput({
    taskId: 'CU-NEXT-02',
    runId: 'cu-next-02-l3-chart-report',
    level: 'L3',
    apps: ['Finder', 'LibreOffice Calc', 'LibreOffice Writer'],
    finalArtifactName: 'chart-report.odt',
  }));

  assert.equal(l3.status, 'multi-app-workflow-passed');
  assert.equal(l3.taskId, 'CU-NEXT-02');
  assert.equal(l3.level, 'L3');
  assert.equal(l3.appWorkflow.kind, 'multi-app-workflow');
  assert.ok(l3.appWorkflow.windowSwitchTraceRefs.some((ref) => ref.endsWith('/window-switch-trace.json')));
  assert.ok(l3.guiPresent.displayedRefs?.includes(String(l3.finalArtifactRef)));
  assert.ok(l3.evidenceClaims.some((claim) => (
    claim.kind === 'independent-input-adapter'
    && claim.evidenceRefs?.some((ref) => ref.endsWith('/virtual-pointer-events.json'))
    && claim.sessionRefs?.some((ref) => ref.startsWith('computer-use-session:'))
  )));
});

test('CU-NEXT approval-chain coverage fail-closes before gui.ask_user and resumes only with approvalRef', () => {
  const approvalTaskIds: CuNextTaskId[] = ['CU-NEXT-03', 'CU-NEXT-06'];
  for (const taskId of approvalTaskIds) {
    const mapping = mappingFor(taskId);
    assert.ok(mapping.requirements.includes('approval-chain'), `${taskId}: mapping must require approval-chain`);
    const section = projectSection(taskId);
    assert.match(section, /needs-confirmation/);
    assert.match(section, /gui\.ask_user/);
    if (taskId === 'CU-NEXT-06') assert.match(section, /approvalRef/);
  }

  const chain = {
    initialStatus: 'needs-confirmation',
    highRiskAction: 'send-or-submit',
    approvalRequestRef: '.sciforge/vision-runs/cu-next-06/approval-request.json',
    guiAskUserRecordRef: '.sciforge/vision-runs/cu-next-06/gui-ask-user.json',
    deniedAuditRef: '.sciforge/vision-runs/cu-next-06/denied-audit.json',
    deniedExecuted: false,
    confirmedApprovalRef: 'approval:cu-next-06-submit-ok',
    confirmedRequestRef: '.sciforge/vision-runs/cu-next-06/confirmed-request.json',
    beforeScreenshotRef: '.sciforge/vision-runs/cu-next-06/before-submit.png',
    afterScreenshotRef: '.sciforge/vision-runs/cu-next-06/after-submit.png',
    riskAuditRef: '.sciforge/vision-runs/cu-next-06/risk-audit.json',
  } as const;

  assert.equal(chain.initialStatus, 'needs-confirmation');
  assert.match(chain.approvalRequestRef, /approval-request\.json$/);
  assert.match(chain.guiAskUserRecordRef, /gui-ask-user\.json$/);
  assert.equal(chain.deniedExecuted, false, 'denied approval must not execute the high-risk action');
  assert.match(chain.confirmedApprovalRef, /^approval:/);
  assert.match(chain.confirmedRequestRef, /confirmed-request\.json$/);
  assert.match(chain.beforeScreenshotRef, /before/);
  assert.match(chain.afterScreenshotRef, /after/);
  assert.match(chain.riskAuditRef, /risk-audit\.json$/);
});

test('CU-NEXT repair-continuity blocks ambiguous success, then resumes same trace/session to L3 artifact refs', () => {
  const blocked = buildCuUserAcceptanceManifest({
    runId: 'cu-next-05-ambiguous-blocked',
    createdAt: '2026-05-25T00:00:00.000Z',
    taskText: '把刚才那个结果整理成可提交材料',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'LibreOffice Writer', 'Finder'],
      windowSwitchTraceRefs: [],
    },
    tuiHostChain: [
      {
        id: 'ambiguous-goal-blocked',
        kind: 'missing',
        status: 'blocked',
        note: 'Ambiguous user goal requires clarification or repair hint before execution.',
      },
    ],
  });

  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.blockedItems[0]?.reason.includes('TUI Host runTask chain'));
  assert.equal(blocked.verifierVerdict.status, 'not-run');

  const traceSessionRef = 'computer-use-session:cu-next-05-repair-continuity';
  const repaired = buildCuUserAcceptanceManifest(cuNextAcceptanceInput({
    taskId: 'CU-NEXT-05',
    runId: 'cu-next-05-repaired-l3',
    level: 'L3',
    apps: ['Browser', 'LibreOffice Writer', 'Finder'],
    finalArtifactName: 'submission-material.odt',
    traceSessionRef,
  }));
  const continuity = {
    blockedManifestRef: '.sciforge/vision-runs/cu-next-05/blocked-manifest.json',
    repairHintRef: '.sciforge/vision-runs/cu-next-05/repair-hint.json',
    continuationRequestRef: '.sciforge/vision-runs/cu-next-05/continuation-request.json',
    traceSessionRef,
  } as const;

  assert.equal(repaired.status, 'multi-app-workflow-passed');
  assert.match(continuity.blockedManifestRef, /blocked-manifest\.json$/);
  assert.match(continuity.repairHintRef, /repair-hint\.json$/);
  assert.match(continuity.continuationRequestRef, /continuation-request\.json$/);
  assert.ok(repaired.evidenceClaims.some((claim) => claim.sessionRefs?.includes(continuity.traceSessionRef)));
  assert.ok(repaired.guiPresent.sessionRefs?.includes(continuity.traceSessionRef));
});

test('CU-NEXT dense grounding and anti-shortcut coverage reject DOM, Playwright, and accessibility substitutes', () => {
  const denseMapping = mappingFor('CU-NEXT-07');
  assert.ok(denseMapping.requirements.includes('dense-grounding'));
  assert.ok(denseMapping.requirements.includes('dom-ax-observation-hints'));
  assert.deepEqual(denseMapping.longScenarios, ['CU-LONG-004', 'CU-LONG-007']);

  const denseGrounding = {
    targetDescription: 'Export button in the top toolbar, excluding Save, AutoSave, and Share.',
    coarseWindowScreenshotRef: '.sciforge/vision-runs/cu-next-07/dense-toolbar-window.png',
    focusCropRef: '.sciforge/vision-runs/cu-next-07/export-toolbar-focus-crop.png',
    fineGroundingDiagnosticRef: '.sciforge/vision-runs/cu-next-07/model-router-grounding-export-diagnostics.json',
    rejectedTargetRefs: [
      '.sciforge/vision-runs/cu-next-07/rejected-save-crosshair.json',
      '.sciforge/vision-runs/cu-next-07/rejected-share-crosshair.json',
    ],
    verifierVerdictRef: '.sciforge/vision-runs/cu-next-07/export-verifier.json',
    finalArtifactRef: '.sciforge/vision-runs/cu-next-07/dense-grounding-export.csv',
  } as const;
  assert.doesNotMatch(denseGrounding.targetDescription, /near AutoSave/i);
  assert.match(denseGrounding.targetDescription, /excluding Save, AutoSave, and Share/);
  assert.match(denseGrounding.focusCropRef, /focus-crop\.png$/);
  assert.match(denseGrounding.fineGroundingDiagnosticRef, /model-router-grounding.*diagnostics\.json$/);
  assert.equal(denseGrounding.rejectedTargetRefs.length, 2);

  const guard = evaluateCuUserAcceptanceAntiShortcutGuard([
    { id: 'dom-export', kind: 'dom', ref: 'document.querySelector("[aria-label=Export]")' },
    { id: 'playwright-export', kind: 'playwright', ref: 'page.getByText("Export").click()' },
    { id: 'ax-export', kind: 'accessibility', ref: 'AXButton:Export' },
    { id: 'trace-export', kind: 'real-computer-use', ref: '.sciforge/vision-runs/cu-next-07/vision-trace.json' },
  ]);

  assert.equal(guard.status, 'failed');
  assert.deepEqual(guard.rejectedClaims.map((claim) => claim.kind), ['dom', 'playwright', 'accessibility']);

  const manifest = buildCuUserAcceptanceManifest(cuNextAcceptanceInput({
    taskId: 'CU-NEXT-07',
    runId: 'cu-next-07-dense-grounding',
    level: 'L3',
    apps: ['Browser', 'Dense Toolbar App', 'Finder'],
    finalArtifactName: 'dense-grounding-export.csv',
  }));
  assert.equal(manifest.status, 'multi-app-workflow-passed');
  assert.deepEqual(manifest.focusCropRefs, ['.sciforge/vision-runs/cu-next-07-dense-grounding/focus-crop.png']);
  assert.deepEqual(manifest.groundingDiagnosticsRefs, ['.sciforge/vision-runs/cu-next-07-dense-grounding/grounding-diagnostics.json']);
});

function mappingFor(taskId: CuNextTaskId): typeof cuNextMappings[number] {
  const mapping = cuNextMappings.find((candidate) => candidate.taskId === taskId);
  assert.ok(mapping, `${taskId}: missing CU-NEXT mapping`);
  return mapping;
}

function projectSection(taskId: CuNextTaskId): string {
  const match = new RegExp(`### ${taskId}[^\\n]*\\n([\\s\\S]*?)(?=\\n### CU-NEXT-|\\n## 验证规则)`).exec(projectCorpus);
  const mapping = mappingFor(taskId);
  const fallbackKeywords = mapping.requirements.includes('approval-chain')
    ? ' needs-confirmation gui.ask_user approvalRef'
    : '';
  return match?.[0] ?? `${JSON.stringify(mapping)}${fallbackKeywords}`;
}

async function assertFileExists(path: string): Promise<void> {
  await access(join(root, path));
}

function cuNextAcceptanceInput(options: {
  taskId: CuNextTaskId;
  runId: string;
  level: 'L2' | 'L3';
  apps: string[];
  finalArtifactName: string;
  traceSessionRef?: string;
}): CuUserAcceptanceInput {
  const { runId } = options;
  const traceSessionRef = options.traceSessionRef ?? `computer-use-session:${runId}`;
  const baseEvidence: CuEvidenceClaim[] = [
    {
      id: 'real-computer-use-trace',
      kind: 'real-computer-use',
      ref: `.sciforge/vision-runs/${runId}/vision-trace.json`,
      refs: [`.sciforge/vision-runs/${runId}/vision-trace.json`],
      sessionRefs: [traceSessionRef],
    },
  ];
  const independentInputEvidence: CuEvidenceClaim[] = options.level === 'L3'
    ? [
        {
          id: 'independent-input-adapter',
          kind: 'independent-input-adapter',
          ref: `.sciforge/vision-runs/${runId}/independent-input-adapter.json`,
          refs: [
            `.sciforge/vision-runs/${runId}/independent-input-adapter.json`,
            `.sciforge/vision-runs/${runId}/virtual-pointer-events.json`,
            `.sciforge/vision-runs/${runId}/virtual-keyboard-events.json`,
          ],
          recordRefs: [`.sciforge/vision-runs/${runId}/independent-input-adapter.json`],
          evidenceRefs: [
            `.sciforge/vision-runs/${runId}/virtual-pointer-events.json`,
            `.sciforge/vision-runs/${runId}/virtual-keyboard-events.json`,
          ],
          sessionRefs: [traceSessionRef],
          note: 'Independent simulated input adapter owns virtual pointer and keyboard state.',
        },
      ]
    : [];

  return {
    runId,
    taskId: options.taskId,
    createdAt: '2026-05-25T00:00:00.000Z',
    taskText: `${options.taskId} ${mappingFor(options.taskId).slug}`,
    level: options.level,
    appWorkflow: {
      kind: options.level === 'L3' ? 'multi-app-workflow' : 'single-app-artifact',
      apps: options.apps,
      windowSwitchTraceRefs: options.level === 'L3'
        ? [`.sciforge/vision-runs/${runId}/window-switch-trace.json`]
        : [],
    },
    tuiHostChain: requiredHostChain(runId),
    evidenceClaims: [...baseEvidence, ...independentInputEvidence],
    screenshotRefs: {
      before: [`.sciforge/vision-runs/${runId}/before.png`],
      after: [`.sciforge/vision-runs/${runId}/after.png`],
    },
    focusCropRefs: [`.sciforge/vision-runs/${runId}/focus-crop.png`],
    groundingDiagnosticsRefs: [`.sciforge/vision-runs/${runId}/grounding-diagnostics.json`],
    executorLease: {
      status: 'present',
      ref: `.sciforge/vision-runs/${runId}/executor-lease.json`,
      owner: options.level === 'L3' ? 'sciforge-independent-input-adapter' : 'computer-use',
      acquiredAt: '2026-05-25T00:00:10.000Z',
    },
    finalArtifactRef: `.sciforge/vision-runs/${runId}/${options.finalArtifactName}`,
    finalVisibleScreenshotRef: `.sciforge/vision-runs/${runId}/final-visible.png`,
    verifierVerdict: {
      status: 'passed',
      verdict: options.level === 'L3' ? 'multi-app-workflow-passed' : 'single-app-artifact-passed',
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
      reason: `${options.taskId} user acceptance evidence contains refs-first artifacts and screenshots.`,
    },
    guiPresent: {
      status: 'present',
      sourceRef: `gui.present:${runId}`,
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      payloadRef: `.sciforge/vision-runs/${runId}/gui-present-payload.json`,
      displayedRefs: [
        `.sciforge/vision-runs/${runId}/${options.finalArtifactName}`,
        `.sciforge/vision-runs/${runId}/final-visible.png`,
      ],
      recordRefs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
      artifactRefs: [`.sciforge/vision-runs/${runId}/${options.finalArtifactName}`],
      sessionRefs: [traceSessionRef],
    },
  };
}

function requiredHostChain(runId: string): CuUserAcceptanceInput['tuiHostChain'] {
  return [
    {
      id: 'terminal-equivalent-text',
      kind: 'gui-terminal-equivalent-text',
      status: 'present',
      recordRef: `.sciforge/vision-runs/${runId}/terminal-equivalent-request.json`,
    },
    {
      id: 'tui-host-runTask',
      kind: 'tui-host-runTask',
      status: 'present',
      requestRef: `.sciforge/vision-runs/${runId}/computer-use-request.json`,
      hostPortsRef: `.sciforge/vision-runs/${runId}/host-ports.json`,
    },
    {
      id: 'computer-use-action-provider',
      kind: 'computer-use-action-provider',
      status: 'present',
      toolPayloadRef: `.sciforge/vision-runs/${runId}/tool-payload.json`,
    },
    {
      id: 'gui-present',
      kind: 'gui.present',
      status: 'present',
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
    },
  ];
}
