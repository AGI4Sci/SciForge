import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { failedTaskPayload } from './payload-validation.js';
import { completeGeneratedTaskRunOutputLifecycle } from './generated-task-runner-output-lifecycle.js';
import { normalizeToolPayloadShape } from './direct-answer-payload.js';

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
      normalizeToolPayloadShape,
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
      normalizeToolPayloadShape,
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
      normalizeToolPayloadShape,
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

test('failed-with-reason payload is a valid terminal result even when process exits nonzero', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-terminal-failure-'));
  const sessionBundleRel = '.sciforge/sessions/2026-05-14_terminal-failure';
  await mkdir(join(workspace, sessionBundleRel, 'task-results'), { recursive: true });
  const outputRel = `${sessionBundleRel}/task-results/generated-terminal-failure.json`;
  await writeFile(join(workspace, outputRel), `${JSON.stringify({
    message: 'The task failed after recording enough diagnostic context.',
    confidence: 0.2,
    claimType: 'failed-with-reason',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runner fallback payload',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'terminal-failure',
      status: 'failed-with-reason',
      failureReason: 'provider returned no usable response after bounded retries',
      outputRef: outputRel,
      stdoutRef: `${sessionBundleRel}/logs/generated-terminal-failure.stdout.log`,
      stderrRef: `${sessionBundleRel}/logs/generated-terminal-failure.stderr.log`,
    }],
    artifacts: [],
  }, null, 2)}\n`);

  let repairAttempted = false;
  const request = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Retrieve papers and honestly fail if blocked.',
    artifacts: [],
    uiState: {
      sessionId: 'session-terminal-failure',
      sessionCreatedAt: '2026-05-14T03:00:00.000Z',
    },
  } as GatewayRequest;
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    checkedAt: '2026-05-14T03:00:00.000Z',
    reason: 'test',
  } as unknown as SkillAvailability;
  const run = {
    spec: {
      id: 'generated-terminal-failure',
      language: 'python',
      entrypoint: 'main',
      taskRel: `${sessionBundleRel}/tasks/generated-terminal-failure/task.py`,
    },
    workspace,
    command: 'python3',
    args: [],
    exitCode: 1,
    stdout: '',
    stderr: 'provider returned no usable response after bounded retries',
    stdoutRef: `${sessionBundleRel}/logs/generated-terminal-failure.stdout.log`,
    stderrRef: `${sessionBundleRel}/logs/generated-terminal-failure.stderr.log`,
    outputRef: outputRel,
    runtimeFingerprint: { language: 'python', command: 'python3' },
  } as unknown as WorkspaceTaskRunResult;

  const payload = await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills: [skill],
    taskId: 'generated-terminal-failure',
    generation: {
      ok: true,
      runId: 'run-terminal-failure',
      response: {
        taskFiles: [],
        entrypoint: { language: 'python', path: 'tasks/generated-terminal-failure/task.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: [],
      },
    },
    run,
    taskRel: run.spec.taskRel,
    inputRel: `${sessionBundleRel}/task-inputs/generated-terminal-failure.json`,
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
      normalizeToolPayloadShape,
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
  assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
  assert.match(JSON.stringify(payload), /provider returned no usable response/);
});

test('normalizes generated task payload shape before validation even when schema errors are empty', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-shape-normalize-'));
  const sessionBundleRel = '.sciforge/sessions/2026-05-16_shape-normalize';
  await mkdir(join(workspace, sessionBundleRel, 'task-results'), { recursive: true });
  const outputRel = `${sessionBundleRel}/task-results/generated-shape-normalize.json`;
  await writeFile(join(workspace, outputRel), `${JSON.stringify({
    message: 'Shape-normalized output.',
    confidence: 0.81,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [],
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'shape-normalize', status: 'done' }],
    artifacts: [],
  }, null, 2)}\n`);

  const request = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Return a schema-valid generated payload that still needs shape normalization.',
    artifacts: [],
    uiState: {
      sessionId: 'session-shape-normalize',
      sessionCreatedAt: '2026-05-16T03:00:00.000Z',
    },
  } as GatewayRequest;
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    checkedAt: '2026-05-16T03:00:00.000Z',
    reason: 'test',
  } as unknown as SkillAvailability;
  const run = {
    spec: {
      id: 'generated-shape-normalize',
      language: 'python',
      entrypoint: 'main',
      taskRel: `${sessionBundleRel}/tasks/generated-shape-normalize/task.py`,
    },
    workspace,
    command: 'python3',
    args: [],
    exitCode: 0,
    stdout: '',
    stderr: '',
    stdoutRef: `${sessionBundleRel}/logs/generated-shape-normalize.stdout.log`,
    stderrRef: `${sessionBundleRel}/logs/generated-shape-normalize.stderr.log`,
    outputRef: outputRel,
    runtimeFingerprint: { language: 'python', command: 'python3' },
  } as unknown as WorkspaceTaskRunResult;

  let validateSawReasoningTrace: unknown;
  let normalizeCalls = 0;
  const payload = await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills: [skill],
    taskId: 'generated-shape-normalize',
    generation: {
      ok: true,
      runId: 'run-shape-normalize',
      response: {
        taskFiles: [],
        entrypoint: { language: 'python', path: 'tasks/generated-shape-normalize/task.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: [],
      },
    },
    run,
    taskRel: run.spec.taskRel,
    inputRel: `${sessionBundleRel}/task-inputs/generated-shape-normalize.json`,
    outputRel,
    stdoutRel: run.stdoutRef,
    stderrRel: run.stderrRef,
    supplementArtifactTypes: [],
    runGeneratedTask: async () => undefined,
    deps: {
      attemptPlanRefs: () => ({}),
      failedTaskPayload,
      tryAgentServerRepairAndRerun: async () => undefined,
      validateAndNormalizePayload: async (value: ToolPayload) => {
        validateSawReasoningTrace = value.reasoningTrace;
        return value;
      },
      normalizeToolPayloadShape: (value: ToolPayload) => {
        normalizeCalls += 1;
        return normalizeToolPayloadShape(value);
      },
      coerceWorkspaceTaskPayload: (value: unknown) => value as ToolPayload,
      schemaErrors: () => [],
      firstPayloadFailureReason: () => undefined,
      payloadHasFailureStatus: () => false,
      repairNeededPayload: failedTaskPayload as never,
    } as never,
  });

  assert.equal(normalizeCalls, 1);
  assert.equal(validateSawReasoningTrace, '');
  assert.equal(typeof payload.reasoningTrace, 'string');
});
