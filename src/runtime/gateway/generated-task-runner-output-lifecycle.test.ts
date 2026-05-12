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
    runtimeFingerprint: { language: 'python', command: 'python3' },
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
