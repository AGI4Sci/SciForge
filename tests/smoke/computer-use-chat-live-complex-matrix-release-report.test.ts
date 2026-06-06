import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES,
} from '../../tools/computer-use-chat-live-complex-matrix.js';
import {
  buildComputerUseChatLiveComplexMatrixReleaseReport,
  releaseReportHasStrictFailures,
} from '../../tools/computer-use-chat-live-complex-matrix-release-report.js';

test('Computer Use complex matrix release report shows monolithic diagnostic and split aggregate coverage', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-'));
  try {
    const monolithicPath = join(workspace, 'monolithic.json');
    const splitPath = join(workspace, 'split.json');
    await writeJson(monolithicPath, {
      schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.v1',
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: 'failed',
      cases: [{ id: 'literature-briefing-report', status: 'passed' }],
      issues: ['provider https://provider.example/v1 returned token=sk-secret'],
    });
    await writeJson(splitPath, buildSplitMatrixManifest());

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      monolithicManifestPath: monolithicPath,
      aggregateFrom: [splitPath],
      env: {
        SCIFORGE_STATE_DIR: join(workspace, 'empty-state'),
        SCIFORGE_LIVE_RESOURCE_LIFECYCLE_DIR: join(workspace, 'empty-lifecycle'),
      },
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    assert.equal(report.status, 'passed', JSON.stringify(report.issues));
    assert.equal(report.releaseAcceptance, 'opt-in-only');
    assert.equal(report.monolithicStatus.status, 'failed');
    assert.equal(report.monolithicStatus.diagnosticOnly, true);
    assert.equal(report.aggregateStatus.status, 'passed');
    assert.equal(report.aggregateStatus.source, 'aggregate-from');
    assert.equal(report.resourceDiagnostics.status, 'passed', JSON.stringify(report.resourceDiagnostics.issues));
    assert.ok(report.resourceDiagnostics.refs.runDirRefs.includes('.sciforge/vision-runs/literature-briefing-report'));
    assert.ok(report.resourceDiagnostics.refs.acceptanceManifestRefs.includes('.sciforge/vision-runs/literature-briefing-report/cu-user-acceptance-manifest.json'));
    const requiredCaseCount = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.length;
    assert.equal(report.caseCoverage.requiredCaseCount, requiredCaseCount);
    assert.equal(report.caseCoverage.coveredCaseCount, requiredCaseCount);
    assert.equal(report.caseCoverage.passedCaseCount, requiredCaseCount);
    assert.deepEqual(report.caseCoverage.missingCaseIds, []);
    assert.deepEqual(report.caseCoverage.failedCaseIds, []);
    assert.match(report.residualStabilityNotes.join('\n'), /Monolithic diagnostic status is failed/);
    assert.equal(releaseReportHasStrictFailures(report), false);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('sk-secret'), false);
    assert.equal(serialized.includes('provider.example'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release report separates lifecycle auto-read sources from case cleanup sources', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-lifecycle-'));
  try {
    const lifecycleDir = join(workspace, 'dev-lifecycle');
    const splitPath = join(workspace, 'split.json');
    await mkdir(lifecycleDir, { recursive: true });
    await writeJson(splitPath, buildSplitMatrixManifest());
    await writeJson(join(lifecycleDir, 'ui-p1-55173.pid.json'), {
      service: 'ui',
      port: 55173,
      launcherPid: 8811,
      childPid: 8812,
      token: 'lifecycle-token-secret-value',
    });
    await writeJson(join(lifecycleDir, 'port-ownership.json'), {
      port: 55173,
      pid: 8812,
      service: 'ui',
      command: 'vite --api_key=sk-port-secret-value --model=gpt-secret https://provider.example/v1',
      cleanup: { resourceKind: 'process', result: 'unknown' },
    });
    await writeJson(join(lifecycleDir, 'process-cleanup-note.json'), {
      pid: 8812,
      service: 'ui',
      cleanup: {
        resourceKind: 'process',
        attempted: true,
        released: true,
        method: 'SIGTERM token=raw-token',
      },
    });

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      aggregateFrom: [splitPath],
      env: {
        SCIFORGE_UI_PORT: '55173',
        SCIFORGE_LIVE_RESOURCE_LIFECYCLE_DIR: lifecycleDir,
      },
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    assert.equal(report.status, 'passed', JSON.stringify(report.issues));
    assert.ok(report.resourceSourceComparison.caseIsolationAndCleanup.cleanupManifestRefs.some((ref) => ref.endsWith('/case-cleanup-manifest.json')));
    assert.ok(report.resourceSourceComparison.caseIsolationAndCleanup.isolationSourceRefs.some((ref) => ref.includes('caseRunId=case-literature-briefing-report')));
    assert.ok(report.resourceSourceComparison.caseIsolationAndCleanup.runDirRefs.includes('.sciforge/vision-runs/literature-briefing-report'));
    assert.ok(report.resourceSourceComparison.lifecycleAutoRead.pidfileSources.some((source) => source.includes('ui-p1-55173.pid.json')));
    assert.ok(report.resourceSourceComparison.lifecycleAutoRead.portOwnershipNoteSources.some((source) => source.includes('port-ownership.json')));
    assert.ok(report.resourceSourceComparison.lifecycleAutoRead.cleanupNoteSources.some((source) => source.includes('process-cleanup-note.json')));
    assert.ok(report.resourceSourceComparison.lifecycleAutoRead.envPortSources.includes('ui:55173'));
    assert.match(report.resourceSourceComparison.differences.join('\n'), /case cleanup manifests do not prove shared service port ownership/i);

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('lifecycle-token-secret-value'), false);
    assert.equal(serialized.includes('sk-port-secret-value'), false);
    assert.equal(serialized.includes('provider.example'), false);
    assert.equal(serialized.includes('raw-token'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release report fails strict acceptance when aggregate is missing a case', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-missing-'));
  try {
    const aggregatePath = join(workspace, 'aggregate.json');
    await writeJson(aggregatePath, {
      schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: 'passed',
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'split-live-manifest-aggregate',
      sourceManifestRefs: [],
      cases: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.slice(0, -1).map((item) => aggregateCase(item)),
      issues: [],
      completionPolicy: {
        fixturePackageLocalHarnessCompletesProjectTasks: false,
        completionRequiresCurrentChatRunIsolatedL3Bundle: true,
        aggregateRequiresEveryCasePassed: true,
      },
    });

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      aggregateManifestPath: aggregatePath,
      resourceNoteJson: [JSON.stringify({
        pid: 4242,
        service: 'workspace-server',
        cleanup: { attempted: true, released: true, method: 'SIGTERM' },
      })],
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    assert.equal(report.status, 'failed');
    assert.equal(report.aggregateStatus.status, 'passed');
    assert.ok(report.resourceDiagnostics.resources.processes.some((item) => item.pid === 4242));
    const missingCaseId = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.at(-1)?.id;
    assert.ok(missingCaseId);
    assert.deepEqual(report.caseCoverage.missingCaseIds, [missingCaseId]);
    assert.ok(report.issues.includes(`${missingCaseId}:missing-from-aggregate`));
    assert.equal(releaseReportHasStrictFailures(report), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release report fails when aggregate status is not passed', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-failed-'));
  try {
    const aggregatePath = join(workspace, 'aggregate.json');
    await writeJson(aggregatePath, {
      schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: 'failed',
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'split-live-manifest-aggregate',
      sourceManifestRefs: [],
      cases: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item, index) => (
        index === 0 ? aggregateCase(item, { status: 'failed', issues: ['current-run-l3-missing'] }) : aggregateCase(item)
      )),
      issues: ['literature-briefing-report:current-run-l3-missing'],
      completionPolicy: {
        fixturePackageLocalHarnessCompletesProjectTasks: false,
        completionRequiresCurrentChatRunIsolatedL3Bundle: true,
        aggregateRequiresEveryCasePassed: true,
      },
    });

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      aggregateManifestPath: aggregatePath,
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    assert.equal(report.status, 'failed');
    assert.equal(report.aggregateStatus.status, 'failed');
    assert.deepEqual(report.caseCoverage.failedCaseIds, ['literature-briefing-report']);
    assert.equal(releaseReportHasStrictFailures(report), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release report summarizes diagnostic-only product blockers without satisfying strict acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-blockers-'));
  try {
    const aggregatePath = join(workspace, 'aggregate.json');
    await writeJson(aggregatePath, {
      schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: 'failed',
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'split-live-manifest-aggregate',
      sourceManifestRefs: [],
      cases: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item, index) => (
        index === 0
          ? aggregateCase(item, {
            status: 'failed',
            evidenceKind: 'package-local',
            liveAcceptanceCandidate: false,
            issues: ['expected-completed-got-repair-needed'],
            diagnosticBlockers: [{
              category: 'planner-route',
              diagnosticOnly: true,
              summary: 'Plan-stage Runtime Codex planner returned repair-needed from https://provider.example/v1 token=blocker-secret.',
              refs: ['.sciforge/vision-runs/literature-briefing-report/blocked-manifest.json'],
              issues: ['expected-completed-got-repair-needed api_key=sk-blocker-secret'],
            }, {
              category: 'native-host-evidence',
              diagnosticOnly: true,
              summary: 'Current run is missing native host GUI evidence refs.',
              refs: [],
              issues: ['missing-computer-use-tui-host-actions-event'],
            }],
          })
          : aggregateCase(item)
      )),
      issues: ['literature-briefing-report:expected-completed-got-repair-needed'],
      completionPolicy: {
        fixturePackageLocalHarnessCompletesProjectTasks: false,
        completionRequiresCurrentChatRunIsolatedL3Bundle: true,
        aggregateRequiresEveryCasePassed: true,
      },
    });

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      aggregateManifestPath: aggregatePath,
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    const item = report.caseCoverage.cases.find((candidate) => candidate.id === 'literature-briefing-report');
    assert.equal(report.status, 'failed');
    assert.equal(releaseReportHasStrictFailures(report), true);
    assert.deepEqual(report.caseCoverage.failedCaseIds, ['literature-briefing-report']);
    assert.equal(item?.status, 'failed');
    assert.deepEqual(item?.diagnosticBlockers.map((blocker) => blocker.category), ['planner-route', 'native-host-evidence']);
    assert.equal(report.productBlockerSummary.diagnosticOnly, true);
    assert.ok(report.productBlockerSummary.categories.some((category) => (
      category.category === 'planner-route'
      && category.caseIds.includes('literature-briefing-report')
    )));
    assert.ok(report.productBlockerSummary.cases.some((summary) => (
      summary.id === 'literature-briefing-report'
      && summary.categories.includes('native-host-evidence')
    )));
    assert.ok(report.issues.includes('literature-briefing-report:aggregate-case-not-passed'));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('provider.example'), false);
    assert.equal(serialized.includes('blocker-secret'), false);
    assert.equal(serialized.includes('sk-blocker-secret'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release report fails when a passed aggregate case is diagnostic-only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-release-report-diagnostic-case-'));
  try {
    const splitPath = join(workspace, 'split.json');
    await writeJson(splitPath, {
      schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.v1',
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: 'passed',
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'current-chat-run-complex-matrix-only',
      preflight: {
        schemaVersion: 'sciforge.computer-use.chat-live-preflight.v1',
        status: 'ready',
        missingEnv: [],
        policyViolations: [],
        serviceChecks: [],
      },
      cases: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => matrixCase(
        item,
        item.id === 'high-risk-approval-chain'
          ? { evidenceKind: 'package-local', liveAcceptanceCandidate: false }
          : {},
      )),
      issues: [],
      requestSubmitted: true,
      completionPolicy: {
        fixturePackageLocalHarnessCompletesProjectTasks: false,
        completionRequiresCurrentChatRunIsolatedL3Bundle: true,
      },
    });

    const report = await buildComputerUseChatLiveComplexMatrixReleaseReport({
      aggregateFrom: [splitPath],
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });

    const highRisk = report.caseCoverage.cases.find((item) => item.id === 'high-risk-approval-chain');
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.caseCoverage.failedCaseIds, ['high-risk-approval-chain']);
    assert.ok(highRisk?.issues.includes('matrix-diagnostic-only-evidence-kind:package-local'));
    assert.ok(report.issues.includes('high-risk-approval-chain:aggregate-case-not-passed'));
    assert.equal(releaseReportHasStrictFailures(report), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use complex matrix release package command keeps aggregate prep non-strict', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const aggregateScript = scripts['smoke:computer-use-chat-live-complex-matrix:aggregate'] ?? '';
  const releaseScript = scripts['release:computer-use-chat-live-complex-matrix-report'] ?? '';
  const reportScript = scripts['smoke:computer-use-chat-live-complex-matrix:opt-in-report'] ?? '';

  assert.match(aggregateScript, /--aggregate-from docs\/test-artifacts\/computer-use-chat-live-complex-matrix\/manifest-isolated\.json/);
  assert.doesNotMatch(aggregateScript, /--strict/);
  assert.match(releaseScript, /smoke:computer-use-chat-live-complex-matrix:aggregate --silent/);
  assert.match(releaseScript, /smoke:computer-use-chat-live-complex-matrix:opt-in-report --silent/);
  assert.match(
    releaseScript,
    /smoke:computer-use-chat-live-complex-matrix:aggregate --silent\s*&&\s*npm run smoke:computer-use-chat-live-complex-matrix:opt-in-report --silent/,
  );
  assert.match(
    reportScript,
    /--aggregate-from docs\/test-artifacts\/computer-use-chat-live-complex-matrix\/manifest-isolated\.json/,
  );
  assert.match(reportScript, /--strict/);
  assert.doesNotMatch(
    reportScript,
    /--aggregate docs\/test-artifacts\/computer-use-chat-live-complex-matrix\/aggregate-manifest\.json/,
  );
});

function matrixCase(
  item: (typeof COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES)[number],
  patch?: Partial<{
    evidenceKind: string;
    liveAcceptanceCandidate: boolean;
  }>,
): Record<string, unknown> {
  const evidenceKind = patch?.evidenceKind ?? (item.expectedStatus === 'completed' ? 'isolated-L3' : 'isolated-L1');
  const liveAcceptanceCandidate = patch?.liveAcceptanceCandidate ?? evidenceKind === 'isolated-L3';
  const aggregate = aggregateCase(item, {
    evidenceKind,
    liveAcceptanceCandidate,
  });
  return {
    id: aggregate.id,
    label: aggregate.label,
    expectedStatus: aggregate.expectedStatus,
    taskId: aggregate.taskId,
    scenarioId: aggregate.scenarioId,
    prompt: item.prompt,
    status: aggregate.status,
    requestSubmitted: aggregate.requestSubmitted,
    liveAcceptanceCandidate: aggregate.liveAcceptanceCandidate,
    isolation: {
      schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-isolation.v1',
      matrixRunId: 'matrix-test',
      caseRunId: `case-${item.id}`,
      caseIndex: 0,
      sessionId: `session-${item.id}`,
      currentTurnId: `turn-${item.id}`,
      workspaceSeed: {
        kind: 'shared-workspace-case-seed',
        seed: `seed-${item.id}`,
        workspacePathConfigured: true,
      },
      cleanupStatus: 'inline-only',
      cleanupIssues: [],
    },
    evidenceClassification: {
      kind: evidenceKind,
      canCompleteBackend: evidenceKind === 'isolated-L1',
      canCompleteL3Workflow: evidenceKind === 'isolated-L3',
      blockedReasons: [],
      rejectedShortcuts: [],
      claimLimit: evidenceKind === 'package-local' ? 'diagnostic-only' : 'desktop-product-path',
    },
    runManifest: {
      schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: item.expectedStatus,
      expectedStatus: item.expectedStatus,
      releaseAcceptance: 'not-evaluated',
      evidenceMode: 'current-chat-run-only',
      preflight: {},
      prompt: item.prompt,
      eventTypes: [],
      eventSummaries: [],
      displayedRefs: aggregate.acceptanceRefs.guiPresentRefs,
      artifactRefs: aggregate.acceptanceRefs.finalArtifactRefs,
      auditRefs: [],
      approvalRequestRefs: [],
      guiAskUserRecordRefs: [],
      riskAuditRefs: [],
      confirmedRequestRefs: [],
      approvalDecisionRefs: [],
      sourceApprovalRequestRefs: [],
      sourceGuiAskUserRecordRefs: [],
      sourceRiskAuditRefs: [],
      evidenceReadIssues: [],
      recoverActions: [],
      failureDiagnostics: [],
      liveAcceptanceBundle: evidenceKind === 'isolated-L3'
        ? {
          status: 'valid',
          runDirRef: aggregate.acceptanceRefs.runDirRef,
          acceptanceManifestRef: aggregate.acceptanceRefs.acceptanceManifestRef,
          completionEvidenceRef: aggregate.acceptanceRefs.completionEvidenceRef,
          issues: [],
        }
        : undefined,
      issues: [],
      requestSubmitted: true,
      liveAcceptanceCandidate,
    },
    issues: [],
  };
}

function buildSplitMatrixManifest(): unknown {
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.v1',
    checkedAt: '2026-05-29T00:30:00.000Z',
    status: 'passed',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'current-chat-run-complex-matrix-only',
    preflight: {
      schemaVersion: 'sciforge.computer-use.chat-live-preflight.v1',
      status: 'ready',
      missingEnv: [],
      policyViolations: [],
      serviceChecks: [],
    },
    cases: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => ({
      id: item.id,
      label: item.label,
      expectedStatus: item.expectedStatus,
      taskId: item.taskId,
      scenarioId: item.scenarioId,
      prompt: item.prompt,
      status: 'passed',
      requestSubmitted: true,
      liveAcceptanceCandidate: item.expectedStatus === 'completed',
      isolation: {
        schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-isolation.v1',
        matrixRunId: 'matrix-test',
        caseRunId: `case-${item.id}`,
        caseIndex: 0,
        sessionId: `session-${item.id}`,
        currentTurnId: `turn-${item.id}`,
        workspaceSeed: {
          kind: 'shared-workspace-case-seed',
          seed: `seed-${item.id}`,
          workspacePathConfigured: true,
        },
        cleanupStatus: 'inline-only',
        cleanupManifestRef: `.sciforge/vision-runs/computer-use-chat-live-complex-matrix/matrix-test/${item.id}/case-cleanup-manifest.json`,
        cleanupIssues: [],
      },
      evidenceClassification: {
        kind: item.expectedStatus === 'completed' ? 'isolated-L3' : 'isolated-L1',
        canCompleteBackend: item.expectedStatus !== 'completed',
        canCompleteL3Workflow: item.expectedStatus === 'completed',
        blockedReasons: [],
        rejectedShortcuts: [],
        claimLimit: item.expectedStatus === 'completed' ? 'can-complete' : 'desktop-product-path',
      },
      runManifest: {
        schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
        checkedAt: '2026-05-29T00:30:00.000Z',
        status: item.expectedStatus,
        expectedStatus: item.expectedStatus,
        releaseAcceptance: 'not-evaluated',
        evidenceMode: 'current-chat-run-only',
        preflight: {},
        prompt: item.prompt,
        eventTypes: [],
        eventSummaries: [],
        displayedRefs: [`.sciforge/vision-runs/${item.id}/vision-trace.json`],
        artifactRefs: [`.sciforge/vision-runs/${item.id}/report.md`],
        auditRefs: [],
        approvalRequestRefs: [],
        guiAskUserRecordRefs: [],
        riskAuditRefs: [],
        confirmedRequestRefs: [],
        approvalDecisionRefs: [],
        sourceApprovalRequestRefs: [],
        sourceGuiAskUserRecordRefs: [],
        sourceRiskAuditRefs: [],
        evidenceReadIssues: [],
        recoverActions: [],
        failureDiagnostics: [],
        liveAcceptanceBundle: {
          runDirRef: `.sciforge/vision-runs/${item.id}`,
          acceptanceManifestRef: `.sciforge/vision-runs/${item.id}/cu-user-acceptance-manifest.json`,
          completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
        },
        issues: [],
        requestSubmitted: true,
        liveAcceptanceCandidate: item.expectedStatus === 'completed',
      },
      issues: [],
    })),
    issues: [],
    requestSubmitted: true,
    completionPolicy: {
      fixturePackageLocalHarnessCompletesProjectTasks: false,
      completionRequiresCurrentChatRunIsolatedL3Bundle: true,
    },
  };
}

function aggregateCase(
  item: (typeof COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES)[number],
  patch?: Partial<AggregateCaseFixture>,
): AggregateCaseFixture {
  const overrides = patch ?? {};
  return {
    id: item.id,
    label: item.label,
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    expectedStatus: item.expectedStatus,
    status: 'passed',
    sourceManifestRef: `docs/test-artifacts/${item.id}.json`,
    sourceCheckedAt: '2026-05-29T00:00:00.000Z',
    evidenceKind: item.expectedStatus === 'completed' ? 'isolated-L3' : 'isolated-L1',
    liveAcceptanceCandidate: item.expectedStatus === 'completed',
    requestSubmitted: true,
    issues: [],
    acceptanceRefs: {
      runDirRef: `.sciforge/vision-runs/${item.id}`,
      acceptanceManifestRef: `.sciforge/vision-runs/${item.id}/cu-user-acceptance-manifest.json`,
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
      finalArtifactRefs: [`.sciforge/vision-runs/${item.id}/report.md`],
      guiPresentRefs: [`.sciforge/vision-runs/${item.id}/vision-trace.json`],
    },
    residualStabilityNotes: [],
    diagnosticBlockers: [],
    ...overrides,
  };
}

interface AggregateCaseFixture {
  id: string;
  label: string;
  taskId: string;
  scenarioId: string;
  expectedStatus: string;
  status: 'passed' | 'failed' | 'blocked' | 'missing';
  sourceManifestRef: string;
  sourceCheckedAt: string;
  evidenceKind: string;
  liveAcceptanceCandidate: boolean;
  requestSubmitted: boolean;
  issues: string[];
  acceptanceRefs: {
    runDirRef: string;
    acceptanceManifestRef: string;
    completionEvidenceRef: string;
    finalArtifactRefs: string[];
    guiPresentRefs: string[];
  };
  residualStabilityNotes: string[];
  diagnosticBlockers: Array<{
    category: 'planner-route' | 'native-host-evidence' | 'current-run-l3' | 'approval-boundary' | 'expected-state';
    diagnosticOnly: true;
    summary: string;
    refs: string[];
    issues: string[];
  }>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
