import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { failedTaskPayload } from './payload-validation.js';
import { completeGeneratedTaskRunOutputLifecycle } from './generated-task-runner-output-lifecycle.js';

test('pre-output generated task failure preserves session-bundle partial artifact refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-partial-'));
  const sessionBundleRel = '.sciforge/sessions/2026-05-12_literature-evidence-review_session-partial';
  const partialPdfRel = `${sessionBundleRel}/task-results/pdfs/paper-a.pdf`;
  const partialMetadataRel = `${sessionBundleRel}/data/paper-a.metadata.json`;
  await mkdir(join(workspace, sessionBundleRel, 'task-results', 'pdfs'), { recursive: true });
  await mkdir(join(workspace, sessionBundleRel, 'data'), { recursive: true });
  await writeFile(join(workspace, partialPdfRel), '%PDF-1.7 partial\n');
  await writeFile(join(workspace, partialMetadataRel), '{"title":"partial paper"}\n');

  const request = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Download 10 papers and summarize them.',
    artifacts: [],
    uiState: {
      sessionId: 'session-partial',
      sessionCreatedAt: '2026-05-12T03:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  } as GatewayRequest;
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    checkedAt: '2026-05-12T03:00:00.000Z',
    reason: 'test',
  } as unknown as SkillAvailability;
  const outputRel = `${sessionBundleRel}/task-results/generated-literature-timeout.json`;
  const run = {
    spec: {
      id: 'generated-literature-timeout',
      language: 'python',
      entrypoint: 'main',
      taskRel: `${sessionBundleRel}/tasks/generated-literature-timeout/task.py`,
    },
    workspace,
    command: 'python3',
    args: [],
    exitCode: 1,
    stdout: 'downloaded paper-a.pdf\n',
    stderr: 'Timeout after external PDF retrieval budget\n',
    stdoutRef: `${sessionBundleRel}/logs/generated-literature-timeout.stdout.log`,
    stderrRef: `${sessionBundleRel}/logs/generated-literature-timeout.stderr.log`,
    outputRef: outputRel,
    runtimeFingerprint: {
      language: 'python',
      command: 'python3',
      externalFailure: {
        externalDependencyStatus: 'transient-unavailable',
        failureReason: 'network-timeout: external PDF retrieval budget exhausted',
      },
    },
  } as unknown as WorkspaceTaskRunResult;

  const payload = await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills: [skill],
    taskId: 'generated-literature-timeout',
    generation: {
      ok: true,
      runId: 'run-timeout',
      response: {
        taskFiles: [],
        entrypoint: { language: 'python', path: 'tasks/generated-literature-timeout/task.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    run,
    taskRel: run.spec.taskRel,
    inputRel: `${sessionBundleRel}/task-inputs/generated-literature-timeout.json`,
    outputRel,
    stdoutRel: run.stdoutRef,
    stderrRel: run.stderrRef,
    supplementArtifactTypes: [],
    runGeneratedTask: async () => undefined,
    deps: {
      attemptPlanRefs: () => ({}),
      failedTaskPayload,
      tryAgentServerRepairAndRerun: async () => undefined,
      validateAndNormalizePayload: async (value: ToolPayload) => value,
      coerceWorkspaceTaskPayload: () => undefined,
      schemaErrors: () => [],
      firstPayloadFailureReason: () => undefined,
      payloadHasFailureStatus: () => false,
      repairNeededPayload: failedTaskPayload as never,
    } as never,
  });

  const serialized = JSON.stringify(payload);
  assert.match(serialized, /generated-task-partial-evidence/);
  assert.match(serialized, /paper-a\.pdf/);
  assert.match(serialized, /paper-a\.metadata\.json/);
  assert.ok(payload.objectReferences?.some((ref) => ref.ref === partialPdfRel));
});

test('partial PDF retrieval failures keep downloaded full text and metadata instead of rerunning repair', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-pdf-boundary-'));
  const sessionBundleRel = '.sciforge/sessions/2026-05-13_literature-evidence-review_pdf-boundary';
  const pdfRel = `${sessionBundleRel}/task-results/pdfs/downloaded-paper.pdf`;
  const metadataRel = `${sessionBundleRel}/data/downloaded-paper.metadata.json`;
  const partialReportRel = `${sessionBundleRel}/artifacts/partial-literature-review.md`;
  await mkdir(join(workspace, sessionBundleRel, 'task-results', 'pdfs'), { recursive: true });
  await mkdir(join(workspace, sessionBundleRel, 'data'), { recursive: true });
  await mkdir(join(workspace, sessionBundleRel, 'artifacts'), { recursive: true });
  await writeFile(join(workspace, pdfRel), '%PDF-1.7 downloaded full text\n');
  await writeFile(join(workspace, metadataRel), '{"title":"Downloaded paper","doi":"10.0000/example"}\n');
  await writeFile(join(workspace, partialReportRel), '# Partial literature review\n\nUses metadata for failed PDFs.\n');

  let repairAttempted = false;
  const request = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Download 10 paper PDFs, mark failed downloads, and continue a partial report from metadata.',
    artifacts: [],
    uiState: {
      sessionId: 'session-pdf-boundary',
      sessionCreatedAt: '2026-05-13T03:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  } as GatewayRequest;
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    checkedAt: '2026-05-13T03:00:00.000Z',
    reason: 'test',
  } as unknown as SkillAvailability;
  const outputRel = `${sessionBundleRel}/task-results/generated-literature-downloads.json`;
  const run = {
    spec: {
      id: 'generated-literature-downloads',
      language: 'python',
      entrypoint: 'main',
      taskRel: `${sessionBundleRel}/tasks/generated-literature-downloads/task.py`,
    },
    workspace,
    command: 'python3',
    args: [],
    exitCode: 1,
    stdout: 'downloaded downloaded-paper.pdf\nmetadata saved for 10 papers\n',
    stderr: 'PDF download failures: paper-b HTTP 403 forbidden; paper-c content-length exceeds max download bytes; paper-d timeout\n',
    stdoutRef: `${sessionBundleRel}/logs/generated-literature-downloads.stdout.log`,
    stderrRef: `${sessionBundleRel}/logs/generated-literature-downloads.stderr.log`,
    outputRef: outputRel,
    runtimeFingerprint: {
      language: 'python',
      command: 'python3',
      externalFailure: {
        externalDependencyStatus: 'transient-unavailable',
        failureReason: 'rate-limited: PDF provider rejected several downloads; preserve partial evidence',
      },
    },
  } as unknown as WorkspaceTaskRunResult;

  const payload = await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills: [skill],
    taskId: 'generated-literature-downloads',
    generation: {
      ok: true,
      runId: 'run-pdf-boundary',
      response: {
        taskFiles: [],
        entrypoint: { language: 'python', path: 'tasks/generated-literature-downloads/task.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    run,
    taskRel: run.spec.taskRel,
    inputRel: `${sessionBundleRel}/task-inputs/generated-literature-downloads.json`,
    outputRel,
    stdoutRel: run.stdoutRef,
    stderrRel: run.stderrRef,
    supplementArtifactTypes: [],
    runGeneratedTask: async () => undefined,
    deps: {
      attemptPlanRefs: () => ({}),
      failedTaskPayload,
      tryAgentServerRepairAndRerun: async () => {
        repairAttempted = true;
        return undefined;
      },
      validateAndNormalizePayload: async (value: ToolPayload) => value,
      coerceWorkspaceTaskPayload: () => undefined,
      schemaErrors: () => [],
      firstPayloadFailureReason: () => undefined,
      payloadHasFailureStatus: () => false,
      repairNeededPayload: failedTaskPayload as never,
    } as never,
  });

  const serialized = JSON.stringify(payload);
  assert.equal(repairAttempted, false);
  assert.match(serialized, /rate-limited: PDF provider rejected several downloads/);
  assert.match(serialized, /generated-task-partial-evidence/);
  assert.ok(payload.objectReferences?.some((ref) => ref.ref === pdfRel));
  assert.ok(payload.objectReferences?.some((ref) => ref.ref === metadataRel));
  assert.ok(payload.objectReferences?.some((ref) => ref.ref === partialReportRel));
});

test('unstructured provider 429 payload is external blocked instead of repair-rerun', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-external-owner-'));
  const sessionBundleRel = '.sciforge/sessions/2026-05-13_literature-evidence-review_external-owner';
  await mkdir(join(workspace, sessionBundleRel, 'task-results'), { recursive: true });
  const outputRel = `${sessionBundleRel}/task-results/generated-provider-429.json`;
  await writeFile(join(workspace, outputRel), `${JSON.stringify({
    message: 'Provider fetch failed before enough evidence was available.',
    confidence: 0,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime-log',
    reasoningTrace: 'external provider fetch failed',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'provider-fetch',
      status: 'failed-with-reason',
      failureReason: 'HTTP Error 429: Too Many Requests; retry-after 3s',
      stderrRef: `${sessionBundleRel}/logs/generated-provider-429.stderr.log`,
      outputRef: outputRel,
    }],
    artifacts: [],
  }, null, 2)}\n`);

  let repairAttempted = false;
  const request = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Retrieve current papers from an external provider.',
    artifacts: [],
    uiState: {
      sessionId: 'session-external-owner',
      sessionCreatedAt: '2026-05-13T05:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  } as GatewayRequest;
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    checkedAt: '2026-05-13T05:00:00.000Z',
    reason: 'test',
  } as unknown as SkillAvailability;
  const run = {
    spec: {
      id: 'generated-provider-429',
      language: 'python',
      entrypoint: 'main',
      taskRel: `${sessionBundleRel}/tasks/generated-provider-429/task.py`,
    },
    workspace,
    command: 'python3',
    args: [],
    exitCode: 1,
    stdout: '',
    stderr: 'HTTP Error 429: Too Many Requests; retry-after 3s',
    stdoutRef: `${sessionBundleRel}/logs/generated-provider-429.stdout.log`,
    stderrRef: `${sessionBundleRel}/logs/generated-provider-429.stderr.log`,
    outputRef: outputRel,
    runtimeFingerprint: {
      language: 'python',
      command: 'python3',
    },
  } as unknown as WorkspaceTaskRunResult;

  const payload = await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills: [skill],
    taskId: 'generated-provider-429',
    generation: {
      ok: true,
      runId: 'run-provider-429',
      response: {
        taskFiles: [],
        entrypoint: { language: 'python', path: 'tasks/generated-provider-429/task.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    run,
    taskRel: run.spec.taskRel,
    inputRel: `${sessionBundleRel}/task-inputs/generated-provider-429.json`,
    outputRel,
    stdoutRel: run.stdoutRef,
    stderrRel: run.stderrRef,
    supplementArtifactTypes: [],
    runGeneratedTask: async () => undefined,
    deps: {
      attemptPlanRefs: () => ({}),
      failedTaskPayload,
      tryAgentServerRepairAndRerun: async () => {
        repairAttempted = true;
        return undefined;
      },
      validateAndNormalizePayload: async (value: ToolPayload) => value,
      coerceWorkspaceTaskPayload: () => undefined,
      schemaErrors: () => [],
      firstPayloadFailureReason: (value: ToolPayload) => {
        const unit = value.executionUnits.find((entry) => typeof entry === 'object' && entry !== null) as Record<string, unknown> | undefined;
        return typeof unit?.failureReason === 'string' ? unit.failureReason : undefined;
      },
      payloadHasFailureStatus: (value: ToolPayload) => value.executionUnits.some((entry) => {
        const status = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).status : undefined;
        return /failed|error/i.test(String(status || ''));
      }),
      repairNeededPayload: failedTaskPayload as never,
    } as never,
  });

  assert.equal(repairAttempted, false);
  assert.equal(payload.executionUnits[0]?.externalDependencyStatus, 'transient-unavailable');
  assert.equal(payload.executionUnits[0]?.conversationKernelStatus, 'external-blocked');
  assert.equal((payload.executionUnits[0]?.failureOwner as Record<string, unknown> | undefined)?.ownerLayer, 'external-provider');
  assert.equal((payload.executionUnits[0]?.failureOwner as Record<string, unknown> | undefined)?.action, 'retry-after-backoff');
  assert.match(JSON.stringify(payload), /External provider appears transiently unavailable/);
});
