import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import type { GatewayRequest, SkillAvailability, WorkspaceTaskRunResult } from '../runtime-types';
import { buildCompactRepairContext } from './agentserver-prompts';
import { summarizeTaskAttemptsForAgentServer } from './context-envelope';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types';

test('attempt summaries carry bounded WorkEvidence facts without raw payloads', () => {
  const summary = summarizeTaskAttemptsForAgentServer([{
    id: 'attempt-1',
    attempt: 1,
    status: 'repair-needed',
    skillDomain: 'literature',
    outputRef: '.sciforge/task-results/attempt-1.json',
    failureReason: 'empty provider result',
    workEvidenceSummary: summarizeWorkEvidenceForHandoff({
      workEvidence: [{
        kind: 'retrieval',
        status: 'empty',
        provider: 'generic-provider',
        resultCount: 0,
        outputSummary: 'Provider status 200 totalResults=0.',
        evidenceRefs: ['trace:provider'],
        failureReason: 'No records after fallback.',
        recoverActions: ['Broaden query'],
        nextStep: 'Ask whether to broaden scope.',
        diagnostics: ['primary status 200', 'fallback status 200'],
        rawRef: 'file:.sciforge/logs/provider.raw.json',
      }],
      rawBody: 'RAW_PAYLOAD_SHOULD_NOT_APPEAR',
    }),
    createdAt: '2026-05-09T00:00:00.000Z',
  }]);

  assert.equal(summary[0]?.workEvidenceSummary?.items[0]?.status, 'empty');
  assert.equal(summary[0]?.workEvidenceSummary?.items[0]?.resultCount, 0);
  assert.deepEqual(summary[0]?.workEvidenceSummary?.items[0]?.diagnostics, ['primary status 200', 'fallback status 200']);
  assert.doesNotMatch(JSON.stringify(summary), /RAW_PAYLOAD_SHOULD_NOT_APPEAR/);
});

test('repair context extracts WorkEvidence summary from failed output ref', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-repair-context-'));
  try {
    await writeFileSafe(join(root, '.sciforge/tasks/run.py'), 'print("x")\n');
    await writeFileSafe(join(root, '.sciforge/task-inputs/run-1.json'), '{"prompt":"search"}\n');
    await writeFileSafe(join(root, '.sciforge/logs/run.stdout.log'), 'provider status 200\n');
    await writeFileSafe(join(root, '.sciforge/logs/run.stderr.log'), '');
    await writeFileSafe(join(root, '.sciforge/task-results/run.json'), JSON.stringify({
      workEvidence: [{
        kind: 'retrieval',
        status: 'empty',
        provider: 'generic-provider',
        resultCount: 0,
        outputSummary: 'Provider returned no records after fallback.',
        evidenceRefs: ['trace:provider'],
        failureReason: 'No records after fallback.',
        recoverActions: ['Broaden query'],
        nextStep: 'Ask whether to broaden scope.',
        diagnostics: ['primary status 200'],
      }],
      rawBody: 'RAW_PAYLOAD_SHOULD_NOT_APPEAR',
    }));

    const context = await buildCompactRepairContext({
      request: {
        skillDomain: 'literature',
        prompt: 'search recent papers',
        artifacts: [],
        uiState: {},
      } as GatewayRequest,
      workspace: root,
      skill: skill(),
      run: {
        spec: { id: 'run-1', language: 'python', entrypoint: 'main', taskRel: '.sciforge/tasks/run.py', input: {}, outputRel: '.sciforge/task-results/run.json', stdoutRel: '.sciforge/logs/run.stdout.log', stderrRel: '.sciforge/logs/run.stderr.log' },
        workspace: root,
        command: 'python',
        args: [],
        exitCode: 0,
        stdoutRef: '.sciforge/logs/run.stdout.log',
        stderrRef: '.sciforge/logs/run.stderr.log',
        outputRef: '.sciforge/task-results/run.json',
        stdout: '',
        stderr: '',
        runtimeFingerprint: {},
      } as WorkspaceTaskRunResult,
      schemaErrors: [],
      failureReason: 'Evidence guard failed.',
      priorAttempts: [],
    });

    const failure = context.failure as { workEvidenceSummary?: { items?: Array<{ resultCount?: number; nextStep?: string }> } };
    assert.equal(failure.workEvidenceSummary?.items?.[0]?.resultCount, 0);
    assert.equal(failure.workEvidenceSummary?.items?.[0]?.nextStep, 'Ask whether to broaden scope.');
    assert.doesNotMatch(JSON.stringify(context), /RAW_PAYLOAD_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeFileSafe(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function skill(): SkillAvailability {
  return {
    id: 'literature.test',
    kind: 'workspace',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-09T00:00:00.000Z',
    manifestPath: 'skill.json',
    manifest: {
      id: 'literature.test',
      kind: 'workspace',
      description: 'test',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'workspace-task' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}
