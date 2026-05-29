import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    assert.equal(report.caseCoverage.requiredCaseCount, 7);
    assert.equal(report.caseCoverage.coveredCaseCount, 7);
    assert.equal(report.caseCoverage.passedCaseCount, 7);
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
    assert.deepEqual(report.caseCoverage.missingCaseIds, ['dense-visual-grounding']);
    assert.ok(report.issues.includes('dense-visual-grounding:missing-from-aggregate'));
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
        kind: item.expectedStatus === 'completed' ? 'isolated-L3' : 'package-local',
        canCompleteBackend: item.expectedStatus === 'completed',
        canCompleteL3Workflow: item.expectedStatus === 'completed',
        blockedReasons: [],
        rejectedShortcuts: [],
        claimLimit: item.expectedStatus === 'completed' ? 'can-complete' : 'diagnostic-only',
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
    evidenceKind: item.expectedStatus === 'completed' ? 'isolated-L3' : 'package-local',
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
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
