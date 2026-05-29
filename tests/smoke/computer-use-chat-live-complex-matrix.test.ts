import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES,
  aggregateComputerUseChatLiveComplexMatrixManifests,
  runComputerUseChatLiveComplexMatrix,
} from '../../tools/computer-use-chat-live-complex-matrix.js';
import { writeBundleLocalCuNext07Acceptance } from './helpers/cu-next-runner-fixtures.js';

test('Computer Use chat live complex matrix defines real task prompts and expected statuses', () => {
  assert.deepEqual(
    COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => item.id),
    [
      'literature-briefing-report',
      'table-chart-analysis-report',
      'web-research-email-draft-stop',
      'file-organize-index',
      'failure-recovery-repair',
      'high-risk-approval-chain',
      'dense-visual-grounding',
    ],
  );
  const expectedStatuses = Object.fromEntries(
    COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => [item.id, item.expectedStatus]),
  );
  assert.equal(expectedStatuses['literature-briefing-report'], 'completed');
  assert.equal(expectedStatuses['table-chart-analysis-report'], 'completed');
  assert.equal(expectedStatuses['web-research-email-draft-stop'], 'needs-confirmation');
  assert.equal(expectedStatuses['file-organize-index'], 'completed');
  assert.equal(expectedStatuses['failure-recovery-repair'], 'repair-needed');
  assert.equal(expectedStatuses['high-risk-approval-chain'], 'needs-confirmation');
  assert.equal(expectedStatuses['dense-visual-grounding'], 'completed');
  assert.deepEqual(
    Object.fromEntries(COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => [item.id, `${item.taskId}/${item.scenarioId}`])),
    {
      'literature-briefing-report': 'CU-NEXT-01/CU-LONG-001',
      'table-chart-analysis-report': 'CU-NEXT-02/CU-LONG-002',
      'web-research-email-draft-stop': 'CU-NEXT-03/CU-LONG-009',
      'file-organize-index': 'CU-NEXT-04/CU-LONG-005',
      'failure-recovery-repair': 'CU-NEXT-05/CU-LONG-006',
      'high-risk-approval-chain': 'CU-NEXT-06/CU-LONG-009',
      'dense-visual-grounding': 'CU-NEXT-07/CU-LONG-004',
    },
  );
  for (const item of COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES) {
    assert.match(item.prompt, /^\/computer-use /);
    assert.doesNotMatch(item.prompt, /completion-grade/i);
    assert.ok(item.evidenceRequirements.includes('current-chat-run'));
    if (item.expectedStatus === 'completed') {
      assert.match(item.prompt, /local|safe central content/i);
      assert.match(item.prompt, /avoid toolbar\/action controls and external side effects|safe central content/i);
    }
  }
  const emailStop = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.find((item) => item.id === 'web-research-email-draft-stop');
  assert.match(emailStop?.prompt ?? '', /explicit topic/);
  assert.match(emailStop?.prompt ?? '', /qa-review@example\.invalid/);
  assert.match(emailStop?.prompt ?? '', /final Send or Submit email action/);
  assert.match(emailStop?.prompt ?? '', /not completion/);
  assert.doesNotMatch(emailStop?.prompt ?? '', /current topic/);
});

test('Computer Use chat live complex matrix blocks before submit when preflight is not ready', async () => {
  let submitted = false;
  const manifest = await runComputerUseChatLiveComplexMatrix({
    env: {},
    localConfigs: [],
    caseIds: ['literature-briefing-report'],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input) => {
      if (String(input).endsWith('/api/sciforge/tools/run/stream')) submitted = true;
      return jsonResponse({ ok: true, ready: true });
    },
  });

  assert.equal(submitted, false);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.requestSubmitted, false);
  assert.equal(manifest.cases[0]?.requestSubmitted, false);
  assert.ok(manifest.issues.includes('live-preflight-not-ready'));
});

test('Computer Use chat live complex matrix retries transient per-case preflight blocks before submission', async () => {
  let providerPreflightCalls = 0;
  let submitted = 0;
  const manifest = await runComputerUseChatLiveComplexMatrix({
    env: {
      ...readyEnv(),
      SCIFORGE_COMPUTER_USE_CHAT_LIVE_PREFLIGHT_RETRY_DELAY_MS: '0',
    },
    localConfigs: [],
    caseIds: ['failure-recovery-repair'],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
        providerPreflightCalls += 1;
        if (providerPreflightCalls === 2) {
          return jsonResponse({
            ok: true,
            manifest: {
              schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
              releaseAcceptance: 'not-evaluated',
              evidenceMode: 'current-env-diagnostic-only',
              category: 'provider-auth',
              runtimeApiKeyPresentInServiceEnv: false,
              upstreamBaseUrlPresent: true,
              upstreamKeySourceKind: 'missing',
              upstreamBaseUrlSourceKind: 'env',
              missingEnv: [],
              policyViolations: [],
              checkedHealthz: { category: 'provider-auth', ok: false, httpStatus: 503 },
            },
          });
        }
        return readyServiceResponse(url);
      }
      if (url.endsWith('/api/sciforge/tools/run/stream')) {
        submitted += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const commandId = String((body.uiState as Record<string, unknown>).commandId);
        return ndjsonResponse([
          {
            event: {
              type: 'computer-use.tui-host-actions',
              source: 'computer-use-package-bridge',
              commandId,
              attemptId: `${commandId}-attempt-1`,
              detail: {
                actions: [{
                  schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                  port: 'gui.present',
                  target: 'computer-use.trace-summary',
                  payload: {
                    title: 'Computer Use repair result',
                    status: 'repair-needed',
                    traceRefs: ['.sciforge/vision-runs/matrix-transient-preflight-repair/vision-trace.json'],
                    blockedManifestRefs: ['.sciforge/vision-runs/matrix-transient-preflight-repair/blocked-manifest.json'],
                    repairHintRefs: ['.sciforge/vision-runs/matrix-transient-preflight-repair/repair-hint.json'],
                    continuationRequestRefs: ['.sciforge/vision-runs/matrix-transient-preflight-repair/continuation-request.json'],
                    runTaskChainRefs: ['.sciforge/vision-runs/matrix-transient-preflight-repair/tui-host-run-task-chain.json'],
                  },
                }],
              },
            },
          },
          { result: { status: 'repair-needed', message: 'Computer Use repair needed.', executionUnits: [], artifacts: [] } },
        ]);
      }
      return readyServiceResponse(url);
    },
  });

  assert.equal(providerPreflightCalls, 3);
  assert.equal(submitted, 1);
  assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
  assert.equal(manifest.cases[0]?.status, 'passed', JSON.stringify(manifest.cases[0]?.issues));
  assert.equal(manifest.cases[0]?.runManifest.preflight.status, 'ready');
  assert.equal(manifest.cases[0]?.requestSubmitted, true);
});

test('Computer Use chat live complex matrix submits selected prompt and redacts secrets in manifest', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const runDir = '.sciforge/vision-runs/matrix-repair';
  const manifest = await runComputerUseChatLiveComplexMatrix({
    env: readyEnv(),
    localConfigs: [],
    caseIds: ['failure-recovery-repair'],
    completionEvidenceProducerIds: ['computer-use.embedded-isolated-desktop-l3'],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/sciforge/tools/run/stream')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        bodies.push(body);
        const commandId = String((body.uiState as Record<string, unknown>).commandId);
        return ndjsonResponse([
          {
            event: {
              type: 'computer-use.tui-host-actions',
              source: 'computer-use-package-bridge',
              commandId,
              attemptId: `${commandId}-attempt-1`,
              detail: {
                note: 'Authorization: Bearer sk-matrix-secret token=raw-secret modelName=qwen-secret providerName=kimi-secret https://provider.example/v1',
                actions: [{
                  schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                  port: 'gui.present',
                  target: 'computer-use.trace-summary',
                  payload: {
                    title: 'Computer Use repair result',
                    status: 'repair-needed',
                    message: 'Bearer sk-message-secret password=raw-password',
                    traceRefs: [`${runDir}/vision-trace.json`],
                    blockedManifestRefs: [`${runDir}/blocked-manifest.json`],
                    repairHintRefs: [`${runDir}/repair-hint.json`],
                    continuationRequestRefs: [`${runDir}/continuation-request.json`],
                    runTaskChainRefs: [`${runDir}/tui-host-run-task-chain.json`],
                  },
                }],
              },
            },
          },
          {
            result: {
              status: 'repair-needed',
              message: 'Repair needed after provider https://provider.example/v1 returned token=raw-secret model=raw-model-name.',
              modelName: 'raw-model-name',
              executionUnits: [],
              artifacts: [],
            },
          },
        ]);
      }
      return readyServiceResponse(url);
    },
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.prompt, COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.find((item) => item.id === 'failure-recovery-repair')?.prompt);
  const uiState = bodies[0]?.uiState as Record<string, unknown>;
  assert.deepEqual((uiState.computerUseNext as Record<string, unknown>)?.taskId, 'CU-NEXT-05');
  assert.deepEqual((uiState.computerUseLong as Record<string, unknown>)?.scenarioId, 'CU-LONG-006');
  assert.deepEqual(uiState.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
  assert.equal(manifest.cases[0]?.expectedStatus, 'repair-needed');
  assert.equal(manifest.cases[0]?.taskId, 'CU-NEXT-05');
  assert.equal(manifest.cases[0]?.scenarioId, 'CU-LONG-006');
  assert.equal(manifest.cases[0]?.status, 'passed');
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-matrix-secret'), false);
  assert.equal(text.includes('raw-secret'), false);
  assert.equal(text.includes('provider.example'), false);
  assert.equal(text.includes('raw-password'), false);
  assert.equal(text.includes('qwen-secret'), false);
  assert.equal(text.includes('kimi-secret'), false);
  assert.equal(text.includes('raw-model-name'), false);
});

test('Computer Use chat live complex matrix classifies package-local completion as diagnostic only', async () => {
  const runDir = '.sciforge/vision-runs/package-local-harness';
  const manifest = await runComputerUseChatLiveComplexMatrix({
    env: readyEnv(),
    localConfigs: [],
    caseIds: ['literature-briefing-report'],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/sciforge/tools/run/stream')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const commandId = String((body.uiState as Record<string, unknown>).commandId);
        return ndjsonResponse([
          {
            event: {
              type: 'computer-use.tui-host-actions',
              source: 'computer-use-package-bridge',
              commandId,
              attemptId: `${commandId}-attempt-1`,
              detail: {
                actions: [{
                  schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                  port: 'gui.present',
                  target: 'computer-use.trace-summary',
                  payload: {
                    title: 'Package-local harness result',
                    status: 'completed',
                    message: 'This package-local harness output must remain diagnostic.',
                    traceRefs: [`${runDir}/vision-trace.json`],
                    artifactRefs: [`${runDir}/report.md`],
                    runTaskChainRefs: [`${runDir}/tui-host-run-task-chain.json`],
                  },
                }],
              },
            },
          },
          { result: { status: 'completed', message: 'Computer Use completed from package-local harness.', executionUnits: [], artifacts: [] } },
        ]);
      }
      return readyServiceResponse(url);
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.cases[0]?.evidenceClassification.kind, 'package-local');
  assert.equal(manifest.cases[0]?.evidenceClassification.canCompleteL3Workflow, false);
  assert.ok(manifest.cases[0]?.issues.includes('matrix-completion-evidence-not-current-isolated-l3:package-local'));
  assert.ok(manifest.cases[0]?.issues.includes('matrix-completed-from-diagnostic-harness:package-local'));
  assert.equal(manifest.completionPolicy.fixturePackageLocalHarnessCompletesProjectTasks, false);
});

test('Computer Use chat live complex matrix keeps direct completed first turn without requiring continuation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-direct-completed-'));
  const bodies: Array<Record<string, unknown>> = [];
  const traceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const denseRejectionRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-rejections.json';
  const runTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeJson(join(workspace, denseRejectionRef), {
      schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
      rejectedTargets: ['toolbar', 'results-table'],
    });

    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIds: ['dense-visual-grounding'],
      completionEvidenceProducerIds: ['computer-use.embedded-isolated-desktop-l3'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use matrix completed',
                      status: 'completed',
                      traceRefs: [traceRef],
                      artifactRefs: [finalArtifactRef, denseRejectionRef],
                      displayedRefs: [finalArtifactRef, denseRejectionRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: 'completed',
                message: 'Computer Use completed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 1);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    assert.equal(manifest.resourceDiagnostics.status, 'passed', JSON.stringify(manifest.resourceDiagnostics.issues));
    assert.ok(manifest.resourceDiagnostics.refs.runDirRefs.includes('.sciforge/vision-runs/cu-next-07-wrapper'));
    assert.ok(manifest.resourceDiagnostics.refs.acceptanceManifestRefs.includes('.sciforge/vision-runs/cu-next-07-wrapper/cu-user-acceptance-manifest.json'));
    assert.equal(manifest.cases[0]?.status, 'passed', JSON.stringify(manifest.cases[0]?.issues));
    assert.equal(manifest.cases[0]?.autoContinuation, undefined);
    assert.equal(manifest.cases[0]?.runManifest.status, 'completed');
    const isolation = manifest.cases[0]?.isolation;
    assert.equal(isolation?.cleanupStatus, 'recorded', JSON.stringify(isolation?.cleanupIssues));
    assert.match(isolation?.sessionId ?? '', /dense-visual-grounding/);
    assert.match(isolation?.currentTurnId ?? '', /dense-visual-grounding/);
    assert.ok(isolation?.cleanupManifestRef);
    const cleanup = JSON.parse(await readFile(join(workspace, isolation.cleanupManifestRef), 'utf8')) as {
      schemaVersion?: string;
      caseId?: string;
      sessionId?: string;
      currentTurnId?: string;
      runDirRefs?: string[];
      finalArtifactRefs?: string[];
      guiReceiptRefs?: string[];
      resourceReleaseChecks?: Array<{ kind?: string; status?: string }>;
    };
    assert.equal(cleanup.schemaVersion, 'sciforge.computer-use.chat-live-complex-matrix.case-cleanup.v1');
    assert.equal(cleanup.caseId, 'dense-visual-grounding');
    assert.equal(cleanup.sessionId, isolation.sessionId);
    assert.equal(cleanup.currentTurnId, isolation.currentTurnId);
    assert.ok(cleanup.runDirRefs?.includes('.sciforge/vision-runs/cu-next-07-wrapper'));
    assert.ok(cleanup.finalArtifactRefs?.includes(finalArtifactRef));
    assert.ok(cleanup.guiReceiptRefs?.includes(finalArtifactRef));
    assert.ok(cleanup.resourceReleaseChecks?.some((check) => check.kind === 'workspace-seed' && check.status === 'recorded'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix auto-continues completed case from repair-needed sidecars to current-run L3 final artifact', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-auto-continuation-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/matrix-auto-repair-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/matrix-auto-repair-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/matrix-auto-repair-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/matrix-auto-repair-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/matrix-auto-repair-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const denseRejectionRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-rejections.json';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  const secondComputerUseRequestRef = '.sciforge/vision-runs/cu-next-07-wrapper/computer-use-request.json';
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeJson(join(workspace, denseRejectionRef), {
      schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
      rejectedTargets: ['toolbar', 'results-table'],
    });
    await writeContinuationRepairSidecars(workspace, {
      firstTraceRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      firstRunTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIds: ['dense-visual-grounding'],
      completionEvidenceProducerIds: ['computer-use.embedded-isolated-desktop-l3'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          if (isSecond) {
            await writeContinuationComputerUseRequest(workspace, {
              computerUseRequestRef: secondComputerUseRequestRef,
              runTaskChainRef: secondRunTaskChainRef,
              blockedManifestRef,
              repairHintRef,
              continuationRequestRef,
              firstTraceRef,
              firstRunTaskChainRef,
            });
          }
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use matrix continuation completed' : 'Computer Use matrix repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      message: isSecond
                        ? 'Completed with current-run final artifact and L3 completion-grade evidence.'
                        : 'Repair needed with complete continuation sidecars.',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      artifactRefs: isSecond ? [finalArtifactRef, denseRejectionRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond
                        ? [secondRunTaskChainRef, firstRunTaskChainRef]
                        : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    const result = manifest.cases[0];
    assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
    assert.equal(result?.autoContinuation?.status, 'passed');
    assert.equal(result?.runManifest.status, 'completed');
    assert.equal(result?.runManifest.liveAcceptanceBundle?.status, 'valid');
    assert.equal(result?.runManifest.packageBridgeCompletionGrade?.status, 'attached');
    assert.equal(result?.runManifest.liveAcceptanceBundle?.runDirRef, '.sciforge/vision-runs/cu-next-07-wrapper');
    assert.equal(result?.runManifest.liveAcceptanceBundle?.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
    assert.ok(result?.runManifest.artifactRefs.includes(finalArtifactRef));
    assert.ok(result?.runManifest.displayedRefs.includes(finalArtifactRef));
    assert.equal(result?.evidenceClassification.kind, 'isolated-L3');
    assert.equal(result?.evidenceClassification.canCompleteL3Workflow, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix retries per-case stream failures inside the same case boundary', async () => {
  let submitted = 0;
  const manifest = await runComputerUseChatLiveComplexMatrix({
    env: readyEnv(),
    localConfigs: [],
    caseIds: ['failure-recovery-repair'],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/sciforge/tools/run/stream')) {
        submitted += 1;
        if (submitted === 1) throw new TypeError('terminated Authorization: Bearer sk-live-secret https://provider.example/v1');
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const commandId = String((body.uiState as Record<string, unknown>).commandId);
        return ndjsonResponse([
          {
            event: {
              type: 'computer-use.tui-host-actions',
              source: 'computer-use-package-bridge',
              commandId,
              attemptId: `${commandId}-attempt-1`,
              detail: {
                actions: [{
                  schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                  port: 'gui.present',
                  target: 'computer-use.trace-summary',
                  payload: {
                    title: 'Computer Use repair result',
                    status: 'repair-needed',
                    traceRefs: ['.sciforge/vision-runs/matrix-repair/vision-trace.json'],
                    blockedManifestRefs: ['.sciforge/vision-runs/matrix-repair/blocked-manifest.json'],
                    repairHintRefs: ['.sciforge/vision-runs/matrix-repair/repair-hint.json'],
                    continuationRequestRefs: ['.sciforge/vision-runs/matrix-repair/continuation-request.json'],
                    runTaskChainRefs: ['.sciforge/vision-runs/matrix-repair/tui-host-run-task-chain.json'],
                  },
                }],
              },
            },
          },
          { result: { status: 'repair-needed', message: 'Computer Use repair needed.', executionUnits: [], artifacts: [] } },
        ]);
      }
      return readyServiceResponse(url);
    },
  });

  assert.equal(submitted, 2);
  assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
  const result = manifest.cases[0];
  assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
  assert.equal(result?.runManifest.status, 'repair-needed');
  assert.equal(result?.retryAttempts?.length, 1);
  assert.equal(result?.retryAttempts?.[0]?.reason, 'case-run-transient-error');
  assert.equal(result?.retryAttempts?.[0]?.observedStatus, 'failed');
  assert.ok(result?.retryAttempts?.[0]?.sourceRunManifest.issues.some((issue) => issue.startsWith('matrix-case-run-error:TypeError: terminated')));
  assert.equal(result?.retryAttempts?.[0]?.retryBoundary.sessionId, result?.isolation.sessionId);
  assert.equal(result?.retryAttempts?.[0]?.retryBoundary.currentTurnId, result?.isolation.currentTurnId);
  assert.match(result?.isolation.currentTurnId ?? '', /failure-recovery-repair-retry-1/);
  assert.equal(
    manifest.stabilityDiagnostics.schemaVersion,
    'sciforge.computer-use.chat-live-complex-matrix.stability-diagnostics.v1',
  );
  assert.deepEqual(manifest.stabilityDiagnostics.caseOrdering.selectedCaseIds, [
    'failure-recovery-repair',
  ]);
  assert.deepEqual(manifest.stabilityDiagnostics.caseOrdering.resultCaseIds, [
    'failure-recovery-repair',
  ]);
  assert.equal(manifest.stabilityDiagnostics.caseOrdering.preservedSelectedOrder, true);
  assert.deepEqual(manifest.stabilityDiagnostics.caseOrdering.duplicateResultCaseIds, []);
  assert.deepEqual(manifest.stabilityDiagnostics.caseOrdering.missingResultCaseIds, []);
  assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.failedCaseIds, []);
  assert.equal(manifest.stabilityDiagnostics.retryBoundary.matrixContinuesAfterCaseFailure, false);
  assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.boundedRetryCaseIds, ['failure-recovery-repair']);
  assert.deepEqual(
    manifest.stabilityDiagnostics.retryBoundary.cases.map((item) => [item.id, item.boundary]),
    [
      ['failure-recovery-repair', 'single-case-bounded-retry'],
    ],
  );
  assert.equal(manifest.stabilityDiagnostics.cleanupManifestSummary.expectedCaseCount, 1);
  assert.deepEqual(manifest.stabilityDiagnostics.cleanupManifestSummary.inlineOnlyCaseIds, [
    'failure-recovery-repair',
  ]);
  assert.equal(manifest.stabilityDiagnostics.cleanupManifestSummary.writeFailedCaseIds.length, 0);
  assert.ok(manifest.stabilityDiagnostics.cleanupManifestSummary.plannedManifestRefs.every((ref) => (
    ref.endsWith('/case-cleanup-manifest.json') || ref.endsWith('/retry-1-cleanup-manifest.json')
  )));
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-live-secret'), false);
  assert.equal(text.includes('provider.example'), false);
});

test('Computer Use chat live complex matrix hard-times out hanging cases, writes progress, and continues', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-timeout-'));
  const out = join(workspace, 'matrix-manifest.json');
  let submitted = 0;
  let aborted = false;
  let progressBeforeSecondCase: { cases?: Array<{ id?: string; status?: string }>; issues?: string[] } | undefined;
  try {
    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      out,
      caseIds: ['literature-briefing-report', 'failure-recovery-repair'],
      requestTimeoutMs: 60_000,
      caseTimeoutMs: 20,
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          submitted += 1;
          if (submitted === 1) {
            return await new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              if (signal?.aborted) {
                aborted = true;
                reject(new DOMException('stream aborted by matrix hard timeout', 'AbortError'));
                return;
              }
              signal?.addEventListener('abort', () => {
                aborted = true;
                reject(new DOMException('stream aborted by matrix hard timeout', 'AbortError'));
              }, { once: true });
            });
          }
          progressBeforeSecondCase = JSON.parse(await readFile(out, 'utf8')) as typeof progressBeforeSecondCase;
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use repair result',
                      status: 'repair-needed',
                      traceRefs: ['.sciforge/vision-runs/matrix-timeout-repair/vision-trace.json'],
                      blockedManifestRefs: ['.sciforge/vision-runs/matrix-timeout-repair/blocked-manifest.json'],
                      repairHintRefs: ['.sciforge/vision-runs/matrix-timeout-repair/repair-hint.json'],
                      continuationRequestRefs: ['.sciforge/vision-runs/matrix-timeout-repair/continuation-request.json'],
                      runTaskChainRefs: ['.sciforge/vision-runs/matrix-timeout-repair/tui-host-run-task-chain.json'],
                    },
                  }],
                },
              },
            },
            { result: { status: 'repair-needed', message: 'Computer Use repair needed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(aborted, true);
    assert.equal(submitted, 2);
    assert.equal(progressBeforeSecondCase?.cases?.length, 1);
    assert.equal(progressBeforeSecondCase?.cases?.[0]?.id, 'literature-briefing-report');
    assert.equal(progressBeforeSecondCase?.cases?.[0]?.status, 'failed');
    assert.ok(progressBeforeSecondCase?.issues?.includes('matrix-run-incomplete:1/2'));
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.cases[0]?.status, 'failed');
    assert.ok(manifest.cases[0]?.issues.some((issue) => issue.includes('timed out after 20ms')));
    assert.equal(manifest.cases[1]?.status, 'passed', JSON.stringify(manifest.cases[1]?.issues));
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.matrixContinuesAfterCaseFailure, true);
    assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.submittedAfterFailureCaseIds, ['failure-recovery-repair']);
    const written = JSON.parse(await readFile(out, 'utf8')) as typeof manifest;
    assert.deepEqual(written.cases.map((item) => item.id), ['literature-briefing-report', 'failure-recovery-repair']);
    assert.equal(written.issues.includes('matrix-run-incomplete:1/2'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix retries non-completed expected-state drift inside the same case boundary', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-needs-confirmation-retry-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstRunDir = '.sciforge/vision-runs/matrix-risk-drift-first';
  const firstTraceRef = `${firstRunDir}/vision-trace.json`;
  const firstRunTaskChainRef = `${firstRunDir}/tui-host-run-task-chain.json`;
  const secondRunDir = '.sciforge/vision-runs/matrix-risk-drift-retry';
  const secondTraceRef = `${secondRunDir}/vision-trace.json`;
  const screenshotRef = `${secondRunDir}/step-003-before-send.png`;
  const runTaskChainRef = `${secondRunDir}/tui-host-run-task-chain.json`;
  const directoryListingRef = `${secondRunDir}/directory-listing.json`;
  const approvalRequestRef = `${secondRunDir}/approval-request.json`;
  const guiAskUserRecordRef = `${secondRunDir}/gui-ask-user.json`;
  const riskAuditRef = `${secondRunDir}/risk-audit.json`;
  const approvalRef = 'approval:computer-use:matrix-risk-retry';
  const approvalRequestId = 'approval-request:matrix-risk-retry';
  const approvalRequest = {
    id: approvalRequestId,
    approvalRef,
    riskActionHash: 'risk-action:matrix-risk-retry',
    confirmation_text: 'Allow Computer Use to send the drafted external action?',
    risk_level: 'high',
    action_kind: 'external-send',
  };
  try {
    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIds: ['high-risk-approval-chain'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isRetry = bodies.length === 2;
          if (isRetry) {
            await writeNeedsConfirmationSidecars(workspace, {
              traceRef: secondTraceRef,
              screenshotRef,
              runTaskChainRef,
              directoryListingRef,
              approvalRequestRef,
              guiAskUserRecordRef,
              riskAuditRef,
              approvalRef,
              approvalRequestId,
              approvalRequest,
            });
          }
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: isRetry
                    ? [{
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.present',
                      target: 'computer-use.trace-summary',
                      payload: {
                        title: 'Computer Use guarded retry',
                        status: 'needs-confirmation',
                        message: 'Computer Use stopped before the high-risk external action.',
                        traceRefs: [secondTraceRef],
                        screenshotRefs: [screenshotRef],
                        directoryListingRefs: [directoryListingRef],
                        runTaskChainRefs: [runTaskChainRef],
                      },
                    }, {
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.ask_user',
                      target: 'computer-use.approval-request',
                      payload: {
                        approvalRequest,
                        relatedRefs: [secondTraceRef, screenshotRef],
                      },
                    }]
                    : [{
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.present',
                      target: 'computer-use.trace-summary',
                      payload: {
                        title: 'Computer Use incorrectly materialized output',
                        status: 'completed',
                        traceRefs: [firstTraceRef],
                        artifactRefs: [`${firstRunDir}/report.md`],
                        runTaskChainRefs: [firstRunTaskChainRef],
                      },
                    }],
                },
              },
            },
            {
              result: {
                status: isRetry ? 'needs-confirmation' : 'completed',
                message: isRetry
                  ? 'Computer Use stopped before external action.'
                  : 'Computer Use completed a local summary instead of requesting approval.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.match(String(bodies[1]?.prompt), /Matrix bounded retry 1\/1/);
    assert.match(String(bodies[1]?.prompt), /Do not return completed or output-materialized/);
    const firstTurnId = (bodies[0]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    const retryTurnId = (bodies[1]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    assert.ok(firstTurnId);
    assert.equal(retryTurnId, `${firstTurnId}-retry-1`);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    const result = manifest.cases[0];
    assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
    assert.equal(result?.runManifest.status, 'needs-confirmation');
    assert.deepEqual(result?.runManifest.approvalRequestRefs, [approvalRequestRef]);
    assert.deepEqual(result?.runManifest.guiAskUserRecordRefs, [guiAskUserRecordRef]);
    assert.deepEqual(result?.runManifest.riskAuditRefs, [riskAuditRef]);
    assert.deepEqual(result?.runManifest.confirmedRequestRefs, []);
    assert.equal(result?.runManifest.deniedExecutionProof?.kind, 'explicit-sidecar-deniedExecuted-false');
    assert.equal(result?.retryAttempts?.length, 1);
    assert.equal(result?.retryAttempts?.[0]?.reason, 'non-completed-expected-state-drift');
    assert.equal(result?.retryAttempts?.[0]?.observedStatus, 'failed');
    assert.equal(result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupStatus, 'recorded');
    assert.equal(result?.retryAttempts?.[0]?.sourceRunManifest.status, 'failed');
    assert.ok(result?.retryAttempts?.[0]?.sourceRunManifest.issues.includes('expected-needs-confirmation-got-completed'));
    assert.equal(result?.isolation.cleanupStatus, 'recorded', JSON.stringify(result?.isolation.cleanupIssues));
    assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.boundedRetryCaseIds, ['high-risk-approval-chain']);
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.cases[0]?.boundary, 'single-case-bounded-retry');
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.cases[0]?.boundedRetryAttempts, 1);
    assert.ok(result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupManifestRef?.endsWith('/retry-1-cleanup-manifest.json'));
    assert.ok(result?.isolation.cleanupManifestRef?.endsWith('/case-cleanup-manifest.json'));
    const retryCleanupRef = result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupManifestRef;
    assert.ok(retryCleanupRef);
    const retryCleanup = JSON.parse(await readFile(join(workspace, retryCleanupRef), 'utf8')) as { status?: string; residualIssues?: string[] };
    assert.equal(retryCleanup.status, 'failed');
    assert.ok(retryCleanup.residualIssues?.includes('expected-needs-confirmation-got-completed'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix retries completed expected-state drift inside the same case boundary', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-completed-retry-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstRunDir = '.sciforge/vision-runs/matrix-completed-drift-first';
  const firstTraceRef = `${firstRunDir}/vision-trace.json`;
  const firstScreenshotRef = `${firstRunDir}/step-002-before-action.png`;
  const firstRunTaskChainRef = `${firstRunDir}/tui-host-run-task-chain.json`;
  const firstDirectoryListingRef = `${firstRunDir}/directory-listing.json`;
  const approvalRequestRef = `${firstRunDir}/approval-request.json`;
  const guiAskUserRecordRef = `${firstRunDir}/gui-ask-user.json`;
  const riskAuditRef = `${firstRunDir}/risk-audit.json`;
  const approvalRef = 'approval:computer-use:completed-drift';
  const approvalRequestId = 'approval-request:completed-drift';
  const approvalRequest = {
    id: approvalRequestId,
    approvalRef,
    riskActionHash: 'risk-action:completed-drift',
    confirmation_text: 'Allow Computer Use to click a high-risk table body target?',
    risk_level: 'high',
    action_kind: 'external-send',
  };
  try {
    const completedRefs = await writeDenseGroundingCompletedSidecars(workspace);
    await writeNeedsConfirmationSidecars(workspace, {
      traceRef: firstTraceRef,
      screenshotRef: firstScreenshotRef,
      runTaskChainRef: firstRunTaskChainRef,
      directoryListingRef: firstDirectoryListingRef,
      approvalRequestRef,
      guiAskUserRecordRef,
      riskAuditRef,
      approvalRef,
      approvalRequestId,
      approvalRequest,
    });

    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIds: ['dense-visual-grounding'],
      completionEvidenceProducerIds: ['computer-use.embedded-isolated-desktop-l3'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isRetry = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: isRetry
                    ? [{
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.present',
                      target: 'computer-use.trace-summary',
                      payload: {
                        title: 'Computer Use completed after guarded retry',
                        status: 'completed',
                        message: 'Completed with current-run final artifact and L3 completion-grade evidence.',
                        traceRefs: [completedRefs.traceRef],
                        artifactRefs: [completedRefs.finalArtifactRef, completedRefs.denseRejectionRef],
                        displayedRefs: [completedRefs.finalArtifactRef, completedRefs.denseRejectionRef],
                        runTaskChainRefs: [completedRefs.runTaskChainRef],
                      },
                    }]
                    : [{
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.present',
                      target: 'computer-use.trace-summary',
                      payload: {
                        title: 'Computer Use stopped at the wrong boundary',
                        status: 'needs-confirmation',
                        message: 'A completed local artifact case drifted to a high-risk confirmation boundary.',
                        traceRefs: [firstTraceRef],
                        screenshotRefs: [firstScreenshotRef],
                        directoryListingRefs: [firstDirectoryListingRef],
                        runTaskChainRefs: [firstRunTaskChainRef],
                      },
                    }, {
                      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                      port: 'gui.ask_user',
                      target: 'computer-use.approval-request',
                      payload: {
                        approvalRequest,
                        relatedRefs: [firstTraceRef, firstScreenshotRef],
                      },
                    }],
                },
              },
            },
            {
              result: {
                status: isRetry ? 'completed' : 'needs-confirmation',
                message: isRetry
                  ? 'Computer Use completed with current-run L3 evidence.'
                  : 'Computer Use stopped before a high-risk action.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.match(String(bodies[1]?.prompt), /Matrix bounded retry 1\/1/);
    assert.match(String(bodies[1]?.prompt), /observed needs-confirmation instead of expected completed/);
    assert.match(String(bodies[1]?.prompt), /Return completed only/);
    const firstTurnId = (bodies[0]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    const retryTurnId = (bodies[1]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    assert.ok(firstTurnId);
    assert.match(firstTurnId, /-turn-1$/);
    assert.equal(retryTurnId, `${firstTurnId}-retry-1`);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    const result = manifest.cases[0];
    assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
    assert.equal(result?.autoContinuation, undefined);
    assert.equal(result?.runManifest.status, 'completed');
    assert.equal(result?.evidenceClassification.kind, 'isolated-L3');
    assert.equal(result?.evidenceClassification.canCompleteL3Workflow, true);
    assert.equal(result?.runManifest.liveAcceptanceBundle?.status, 'valid');
    assert.ok(result?.runManifest.artifactRefs.includes(completedRefs.finalArtifactRef));
    assert.ok(result?.runManifest.displayedRefs.includes(completedRefs.finalArtifactRef));
    assert.ok(result?.runManifest.artifactRefs.includes(completedRefs.denseRejectionRef));
    assert.equal(result?.retryAttempts?.length, 1);
    assert.equal(result?.retryAttempts?.[0]?.reason, 'completed-expected-state-drift');
    assert.equal(result?.retryAttempts?.[0]?.observedStatus, 'failed');
    assert.equal(result?.retryAttempts?.[0]?.observedVisibleStatus, 'needs-human');
    assert.equal(result?.retryAttempts?.[0]?.retryBoundary.sessionId, result?.isolation.sessionId);
    assert.equal(result?.retryAttempts?.[0]?.retryBoundary.currentTurnId, retryTurnId);
    assert.ok(result?.retryAttempts?.[0]?.sourceRunManifest.issues.includes('expected-completed-got-needs-confirmation'));
    assert.equal(result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupStatus, 'recorded');
    assert.equal(result?.isolation.cleanupStatus, 'recorded', JSON.stringify(result?.isolation.cleanupIssues));
    assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.boundedRetryCaseIds, ['dense-visual-grounding']);
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.cases[0]?.boundary, 'single-case-bounded-retry');
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.cases[0]?.boundedRetryAttempts, 1);
    const retryCleanupRef = result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupManifestRef;
    assert.ok(retryCleanupRef);
    const retryCleanup = JSON.parse(await readFile(join(workspace, retryCleanupRef), 'utf8')) as { status?: string; residualIssues?: string[] };
    assert.equal(retryCleanup.status, 'failed');
    assert.ok(retryCleanup.residualIssues?.includes('expected-completed-got-needs-confirmation'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix retries completed completion-grade evidence drift inside the same case boundary', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-completion-evidence-retry-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstRunDir = '.sciforge/vision-runs/matrix-completion-evidence-missing';
  const firstTraceRef = `${firstRunDir}/vision-trace.json`;
  const firstArtifactRef = `${firstRunDir}/dense-grounding-export.csv`;
  const firstRunTaskChainRef = `${firstRunDir}/tui-host-run-task-chain.json`;
  try {
    const completedRefs = await writeDenseGroundingCompletedSidecars(workspace);
    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIds: ['dense-visual-grounding'],
      completionEvidenceProducerIds: ['computer-use.embedded-isolated-desktop-l3'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isRetry = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isRetry
                        ? 'Computer Use completed after completion evidence retry'
                        : 'Computer Use visible artifact without completion-grade evidence',
                      status: 'completed',
                      message: isRetry
                        ? 'Completed with current-run final artifact and L3 completion-grade evidence.'
                        : 'Visible artifact exists, but current-run L3 completion evidence is missing.',
                      traceRefs: [isRetry ? completedRefs.traceRef : firstTraceRef],
                      artifactRefs: isRetry
                        ? [completedRefs.finalArtifactRef, completedRefs.denseRejectionRef]
                        : [firstArtifactRef],
                      displayedRefs: isRetry
                        ? [completedRefs.finalArtifactRef, completedRefs.denseRejectionRef]
                        : [firstArtifactRef],
                      runTaskChainRefs: [isRetry ? completedRefs.runTaskChainRef : firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: 'completed',
                message: isRetry
                  ? 'Computer Use completed with current-run L3 evidence.'
                  : 'Computer Use completed without current-run L3 evidence.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.match(String(bodies[1]?.prompt), /Matrix bounded retry 1\/1/);
    assert.match(String(bodies[1]?.prompt), /completion-grade evidence was missing or invalid/);
    assert.match(String(bodies[1]?.prompt), /Return completed only/);
    const firstTurnId = (bodies[0]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    const retryTurnId = (bodies[1]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId;
    assert.ok(firstTurnId);
    assert.equal(retryTurnId, `${firstTurnId}-retry-1`);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    const result = manifest.cases[0];
    assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
    assert.equal(result?.runManifest.status, 'completed');
    assert.equal(result?.evidenceClassification.kind, 'isolated-L3');
    assert.equal(result?.runManifest.liveAcceptanceBundle?.status, 'valid');
    assert.equal(result?.retryAttempts?.length, 1);
    assert.equal(result?.retryAttempts?.[0]?.reason, 'completed-completion-evidence-drift');
    assert.ok(result?.retryAttempts?.[0]?.sourceRunManifest.issues.some((issue) => issue.startsWith('completion-grade:')));
    assert.equal(result?.retryAttempts?.[0]?.sourceRunManifest.packageBridgeCompletionGrade?.status, 'missing');
    assert.equal(result?.retryAttempts?.[0]?.sourceRunManifest.liveAcceptanceBundle?.status, 'missing');
    assert.equal(result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupStatus, 'recorded');
    assert.deepEqual(manifest.stabilityDiagnostics.retryBoundary.boundedRetryCaseIds, ['dense-visual-grounding']);
    assert.equal(manifest.stabilityDiagnostics.retryBoundary.cases[0]?.boundary, 'single-case-bounded-retry');
    const retryCleanupRef = result?.retryAttempts?.[0]?.cleanupBeforeRetry.cleanupManifestRef;
    assert.ok(retryCleanupRef);
    const retryCleanup = JSON.parse(await readFile(join(workspace, retryCleanupRef), 'utf8')) as { status?: string; residualIssues?: string[] };
    assert.equal(retryCleanup.status, 'failed');
    assert.ok(retryCleanup.residualIssues?.some((issue) => issue.startsWith('completion-grade:')));
    assert.ok(retryCleanup.residualIssues?.includes('package-bridge-completion-grade-missing'));
    assert.ok(retryCleanup.residualIssues?.includes('live-acceptance-bundle-missing'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix can run cases in materialized per-case workspace forks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-case-fork-'));
  const bodies: Array<Record<string, unknown>> = [];
  try {
    const manifest = await runComputerUseChatLiveComplexMatrix({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      caseIsolationStrategy: 'per-case-workspace-fork',
      caseIds: ['failure-recovery-repair'],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use repair result',
                      status: 'repair-needed',
                      traceRefs: ['.sciforge/vision-runs/matrix-repair/vision-trace.json'],
                      blockedManifestRefs: ['.sciforge/vision-runs/matrix-repair/blocked-manifest.json'],
                      repairHintRefs: ['.sciforge/vision-runs/matrix-repair/repair-hint.json'],
                      continuationRequestRefs: ['.sciforge/vision-runs/matrix-repair/continuation-request.json'],
                      runTaskChainRefs: ['.sciforge/vision-runs/matrix-repair/tui-host-run-task-chain.json'],
                    },
                  }],
                },
              },
            },
            { result: { status: 'repair-needed', message: 'Computer Use repair needed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 1);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    assert.equal(manifest.caseIsolationPlan?.strategy, 'per-case-workspace-fork');
    assert.equal(manifest.caseIsolationPlan?.cases.length, 1);
    const result = manifest.cases[0];
    assert.equal(result?.status, 'passed', JSON.stringify(result?.issues));
    assert.equal(result?.isolation.resetStatus, 'passed', JSON.stringify(result?.isolation.resetIssues));
    assert.equal(result?.isolation.workspaceSeed.kind, 'per-case-workspace-fork');
    assert.ok(result?.isolation.workspaceSeed.caseWorkspacePath?.startsWith(workspace));
    assert.equal((bodies[0]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId, result?.isolation.currentTurnId);
    assert.ok(result?.isolation.resetManifestRef);
    const reset = JSON.parse(
      await readFile(join(result.isolation.workspaceSeed.caseWorkspacePath!, result.isolation.resetManifestRef), 'utf8'),
    ) as { status?: string; checks?: Array<{ kind?: string; status?: string }> };
    assert.equal(reset.status, 'passed');
    assert.ok(reset.checks?.some((check) => check.kind === 'workspace-fork' && check.status === 'passed'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live complex matrix aggregate selects passed split manifests per case', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-complex-matrix-aggregate-'));
  const passedA = matrixManifestFixture('2026-05-29T00:00:00.000Z', [
    caseFixture('literature-briefing-report', 'passed', 'isolated-L3'),
    caseFixture('table-chart-analysis-report', 'failed', 'package-local', ['expected-completed-got-repair-needed']),
  ]);
  const passedB = matrixManifestFixture('2026-05-29T00:01:00.000Z', [
    caseFixture('table-chart-analysis-report', 'passed', 'isolated-L3'),
    caseFixture('web-research-email-draft-stop', 'passed', 'package-local'),
    caseFixture('file-organize-index', 'passed', 'isolated-L3'),
    caseFixture('failure-recovery-repair', 'passed', 'package-local'),
    caseFixture('high-risk-approval-chain', 'passed', 'package-local'),
    caseFixture('dense-visual-grounding', 'passed', 'isolated-L3'),
  ]);
  const first = join(dir, 'first.json');
  const second = join(dir, 'second.json');
  await writeFile(first, `${JSON.stringify(passedA, null, 2)}\n`);
  await writeFile(second, `${JSON.stringify(passedB, null, 2)}\n`);

  const aggregate = await aggregateComputerUseChatLiveComplexMatrixManifests([first, second], {
    now: () => new Date('2026-05-29T00:02:00.000Z'),
  });

  assert.equal(aggregate.status, 'passed', aggregate.issues.join('\n'));
  assert.equal(aggregate.cases.length, 7);
  assert.deepEqual(aggregate.issues, []);
  assert.equal(
    aggregate.cases.find((item) => item.id === 'table-chart-analysis-report')?.sourceManifestRef,
    second,
  );
  assert.equal(
    aggregate.cases.find((item) => item.id === 'literature-briefing-report')?.acceptanceRefs.completionEvidenceRef,
    '.sciforge/vision-runs/literature-briefing-report/isolated-desktop-l3-workflow-evidence.json',
  );
  assert.equal(aggregate.completionPolicy.aggregateRequiresEveryCasePassed, true);
});

async function writeNeedsConfirmationSidecars(workspace: string, input: {
  traceRef: string;
  screenshotRef: string;
  runTaskChainRef: string;
  directoryListingRef: string;
  approvalRequestRef: string;
  guiAskUserRecordRef: string;
  riskAuditRef: string;
  approvalRef: string;
  approvalRequestId: string;
  approvalRequest: Record<string, unknown>;
}): Promise<void> {
  await writeJson(join(workspace, input.runTaskChainRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    refs: {
      traceRef: input.traceRef,
      guiAskUserRecordRef: input.guiAskUserRecordRef,
      approvalRequestRef: input.approvalRequestRef,
      riskAuditRef: input.riskAuditRef,
      directoryListingRef: input.directoryListingRef,
    },
  });
  await writeJson(join(workspace, input.directoryListingRef), {
    schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
    fileRefs: [
      input.traceRef,
      input.screenshotRef,
      input.runTaskChainRef,
      input.guiAskUserRecordRef,
      input.approvalRequestRef,
      input.riskAuditRef,
    ],
  });
  await writeJson(join(workspace, input.approvalRequestRef), {
    schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.approvalRequest.riskActionHash,
    approvalRequest: input.approvalRequest,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.guiAskUserRecordRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
    port: 'gui.ask_user',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.approvalRequest.riskActionHash,
    payload: { approvalRequest: input.approvalRequest },
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.riskAuditRef), {
    schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.approvalRequest.riskActionHash,
    highRiskAction: { actionKind: 'external-send', targetDescription: 'drafted external action send control' },
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
}

async function writeDenseGroundingCompletedSidecars(workspace: string): Promise<{
  runDirRef: string;
  traceRef: string;
  finalArtifactRef: string;
  denseRejectionRef: string;
  runTaskChainRef: string;
  acceptanceManifestRef: string;
  completionEvidenceRef: string;
}> {
  await writeBundleLocalCuNext07Acceptance(workspace);
  const runDirRef = '.sciforge/vision-runs/cu-next-07-wrapper';
  const denseRejectionRef = `${runDirRef}/dense-grounding-rejections.json`;
  await writeJson(join(workspace, denseRejectionRef), {
    schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
    rejectedTargets: ['toolbar', 'results-table'],
  });
  return {
    runDirRef,
    traceRef: `${runDirRef}/vision-trace.json`,
    finalArtifactRef: `${runDirRef}/dense-grounding-export.csv`,
    denseRejectionRef,
    runTaskChainRef: `${runDirRef}/tui-host-run-task-chain.json`,
    acceptanceManifestRef: `${runDirRef}/cu-user-acceptance-manifest.json`,
    completionEvidenceRef: `${runDirRef}/isolated-desktop-l3-workflow-evidence.json`,
  };
}

async function writeContinuationRepairSidecars(workspace: string, input: {
  firstTraceRef: string;
  blockedManifestRef: string;
  repairHintRef: string;
  continuationRequestRef: string;
  firstRunTaskChainRef: string;
}): Promise<void> {
  await writeJson(join(workspace, input.blockedManifestRef), {
    schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
    status: 'blocked',
    reason: 'First turn needs a bounded continuation to materialize the visible final artifact.',
    failedStage: 'visible-artifact-final-guard',
    continuationRequestRef: input.continuationRequestRef,
  });
  await writeJson(join(workspace, input.repairHintRef), {
    schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
    status: 'repair-needed',
    reason: 'Retry with one safe visible local artifact action.',
    nextAttempt: {
      reuseTraceRef: input.firstTraceRef,
      reuseRunTaskChainRef: input.firstRunTaskChainRef,
      requireFreshObservation: true,
      preserveInputIsolation: true,
    },
  });
  await writeJson(join(workspace, input.continuationRequestRef), {
    schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
    status: 'ready-for-continuation',
    blockedManifestRef: input.blockedManifestRef,
    repairHintRef: input.repairHintRef,
    sameTraceSessionRef: input.firstRunTaskChainRef,
  });
}

async function writeContinuationComputerUseRequest(workspace: string, input: {
  computerUseRequestRef: string;
  runTaskChainRef: string;
  blockedManifestRef: string;
  repairHintRef: string;
  continuationRequestRef: string;
  firstTraceRef: string;
  firstRunTaskChainRef: string;
}): Promise<void> {
  const runDirRef = input.runTaskChainRef.replace(/\/tui-host-run-task-chain\.json$/, '');
  const acceptanceManifestRef = `${runDirRef}/cu-user-acceptance-manifest.json`;
  const completionEvidenceRef = `${runDirRef}/isolated-desktop-l3-workflow-evidence.json`;
  const directoryListingRef = `${runDirRef}/directory-listing.json`;
  await writeJson(join(workspace, input.computerUseRequestRef), {
    schemaVersion: 'sciforge.computer-use.request.v1',
    task: '/computer-use continue --continuation-request-ref',
    metadata: {
      plannerAcceptanceContract: {
        schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
        computerUseContinuation: {
          schemaVersion: 'sciforge.computer-use.continuation-context.v1',
          source: 'gateway-request-references',
          blockedManifestRefs: [input.blockedManifestRef],
          repairHintRefs: [input.repairHintRef],
          continuationRequestRefs: [input.continuationRequestRef],
          runTaskChainRefs: [input.firstRunTaskChainRef],
          sidecars: {
            blockedManifest: {
              schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
              status: 'blocked',
              reason: 'First turn needs a bounded continuation to materialize the visible final artifact.',
              failedStage: 'visible-artifact-final-guard',
              continuationRequestRef: input.continuationRequestRef,
            },
            repairHint: {
              schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
              status: 'repair-needed',
              reason: 'Retry with one safe visible local artifact action.',
              nextAttempt: {
                reuseTraceRef: input.firstTraceRef,
                reuseRunTaskChainRef: input.firstRunTaskChainRef,
                requireFreshObservation: true,
                preserveInputIsolation: true,
              },
            },
            continuationRequest: {
              schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
              status: 'ready-for-continuation',
              blockedManifestRef: input.blockedManifestRef,
              repairHintRef: input.repairHintRef,
              sameTraceSessionRef: input.firstRunTaskChainRef,
            },
          },
        },
      },
    },
  });
  await writeJson(join(workspace, input.runTaskChainRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    refs: {
      requestRef: input.computerUseRequestRef,
      blockedManifestRef: input.blockedManifestRef,
      repairHintRef: input.repairHintRef,
      continuationRequestRef: input.continuationRequestRef,
      runTaskChainRef: input.firstRunTaskChainRef,
      directoryListingRef,
      acceptanceManifestRef,
      completionEvidenceRef,
    },
    links: [
      { kind: 'directory-listing', status: 'present', recordRef: directoryListingRef },
      { kind: 'user-acceptance-manifest', status: 'present', recordRef: acceptanceManifestRef },
      { kind: 'completion-grade-evidence', status: 'attached', recordRef: completionEvidenceRef },
    ],
    completionGrade: {
      status: 'attached',
      acceptanceManifestRef,
      completionEvidenceRef,
    },
  });
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readyEnv(): NodeJS.ProcessEnv {
  return {
    SCIFORGE_RUNTIME_API_KEY: 'sk-live-secret',
    SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example/v1',
    SCIFORGE_VISION_DESKTOP_BRIDGE: '1',
    SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
    SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
    SCIFORGE_VISION_KV_GROUND_URL: 'http://127.0.0.1:18081',
    SCIFORGE_UI_URL: 'http://127.0.0.1:5173/',
    SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:6173/health',
    SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:18080/health',
    SCIFORGE_PROXY_URL: 'http://127.0.0.1:3891/healthz',
  };
}

function matrixManifestFixture(checkedAt: string, cases: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.v1',
    checkedAt,
    status: cases.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'current-chat-run-complex-matrix-only',
    preflight: {
      schemaVersion: 'sciforge.computer-use.chat-live-preflight.v1',
      status: 'ready',
      missingEnv: [],
      policyViolations: [],
      serviceChecks: [],
    },
    cases,
    issues: cases.flatMap((item) => (item.issues as string[]).map((issue) => `${item.id}:${issue}`)),
    requestSubmitted: true,
    completionPolicy: {
      fixturePackageLocalHarnessCompletesProjectTasks: false,
      completionRequiresCurrentChatRunIsolatedL3Bundle: true,
    },
  };
}

function caseFixture(
  id: string,
  status: 'passed' | 'failed',
  evidenceKind: 'isolated-L3' | 'package-local',
  issues: string[] = [],
) {
  const item = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.find((candidate) => candidate.id === id);
  assert.ok(item);
  const runDir = `.sciforge/vision-runs/${id}`;
  return {
    id,
    label: item.label,
    expectedStatus: item.expectedStatus,
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    prompt: item.prompt,
    status,
    requestSubmitted: true,
    liveAcceptanceCandidate: evidenceKind === 'isolated-L3',
    evidenceClassification: {
      kind: evidenceKind,
      canCompleteBackend: evidenceKind === 'isolated-L3',
      canCompleteL3Workflow: evidenceKind === 'isolated-L3',
      blockedReasons: [],
      rejectedShortcuts: [],
      claimLimit: evidenceKind === 'isolated-L3' ? 'can complete' : 'diagnostic only',
    },
    runManifest: {
      schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
      checkedAt: '2026-05-29T00:00:00.000Z',
      status: item.expectedStatus,
      expectedStatus: item.expectedStatus,
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'current-chat-run-only',
      preflight: { schemaVersion: 'x', status: 'ready', missingEnv: [], policyViolations: [], serviceChecks: [] },
      prompt: item.prompt,
      eventTypes: [],
      eventSummaries: [],
      displayedRefs: [`${runDir}/gui-present.json`, `${runDir}/report.md`],
      artifactRefs: [`${runDir}/report.md`],
      auditRefs: [`${runDir}/vision-trace.json`],
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
      issues: [],
      requestSubmitted: true,
      liveAcceptanceCandidate: evidenceKind === 'isolated-L3',
      liveAcceptanceBundle: evidenceKind === 'isolated-L3'
        ? {
          status: 'valid',
          runDirRef: runDir,
          acceptanceManifestRef: `${runDir}/cu-user-acceptance-manifest.json`,
          completionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
          issues: [],
        }
        : undefined,
    },
    issues,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function readyServiceResponse(url: string): Response {
  if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
    return jsonResponse({
      ok: true,
      manifest: {
        schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
        releaseAcceptance: 'not-evaluated',
        evidenceMode: 'current-env-diagnostic-only',
        category: 'ready',
        runtimeApiKeyPresentInServiceEnv: true,
        upstreamBaseUrlPresent: true,
        upstreamKeySourceKind: 'env',
        upstreamBaseUrlSourceKind: 'env',
        missingEnv: [],
        policyViolations: [],
        checkedHealthz: { category: 'ready', ok: true, httpStatus: 200 },
      },
    });
  }
  if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
  if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
  return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

function ndjsonResponse(items: unknown[]): Response {
  return new Response(`${items.map((item) => JSON.stringify(item)).join('\n')}\n`, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}
