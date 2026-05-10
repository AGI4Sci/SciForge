import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { VERIFICATION_RESULT_ARTIFACT_TYPE } from '@sciforge-ui/runtime-contract/verification-result';
import type { GatewayRequest, SkillAvailability, WorkspaceTaskRunResult } from '../runtime-types';
import { buildCompactRepairContext } from './agentserver-prompts';
import { buildContextEnvelope, summarizeTaskAttemptsForAgentServer } from './context-envelope';
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

test('context envelope uses package policy for current request and verification artifact summaries', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: 'assistant: previous answer\nUSER: 继续验证刚才的结果',
    artifacts: [
      { id: 'report-1', type: 'research-report', dataRef: '.sciforge/artifacts/report.md' },
      { id: 'verify-1', type: VERIFICATION_RESULT_ARTIFACT_TYPE, dataRef: '.sciforge/verifications/verify-1.json' },
    ],
    uiState: {},
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.equal(envelope.sessionFacts.currentUserRequest, '继续验证刚才的结果');
  assert.deepEqual(envelope.longTermRefs.verificationResults?.map((entry) => (entry as { dataRef?: string }).dataRef), [
    '.sciforge/verifications/verify-1.json',
  ]);
});

test('context envelope can audit harness contract refs and context budget slimming behind feature flag', () => {
  const request = {
    skillDomain: 'knowledge',
    prompt: 'Use the selected refs only.',
    artifacts: [],
    uiState: {
      currentReferences: [
        { ref: 'ref:a', title: 'Allowed current ref' },
        { ref: 'ref:c', title: 'Blocked current ref' },
      ],
      currentReferenceDigests: [
        { ref: 'ref:a', digestText: 'A digest' },
        { ref: 'ref:b', digestText: 'B digest' },
        { ref: 'ref:c', digestText: 'C digest' },
      ],
      recentConversation: ['user: old turn', 'assistant: old answer', 'user: current turn'],
      agentHarnessContextEnvelopeEnabled: true,
      agentHarness: {
        contractRef: 'harness-contract:test-budget',
        traceRef: 'harness-trace:test-budget',
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          contractRef: 'harness-contract:test-budget',
          traceRef: 'harness-trace:test-budget',
          allowedContextRefs: ['ref:a', 'ref:b', 'ref:c'],
          blockedContextRefs: ['ref:c'],
          requiredContextRefs: ['ref:b'],
          contextBudget: {
            maxReferenceDigests: 1,
          },
        },
      },
    },
  } as GatewayRequest;

  const defaultEnvelope = buildContextEnvelope({
    ...request,
    uiState: {
      ...request.uiState,
      agentHarnessContextEnvelopeEnabled: false,
    },
  }, { workspace: '/tmp/sciforge-test' });
  assert.equal(record(defaultEnvelope.contextGovernanceAudit).schemaVersion, undefined);
  assert.equal((defaultEnvelope.sessionFacts.currentReferenceDigests as unknown[] | undefined)?.length, 3);

  const envelope = buildContextEnvelope(request, { workspace: '/tmp/sciforge-test' });
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'request.uiState.agentHarness.contract');
  assert.equal(audit.contractRef, 'harness-contract:test-budget');
  assert.deepEqual(record(audit.contextRefs).blocked, ['ref:c']);
  assert.equal(record(audit.contextBudget).maxReferenceDigests, 1);

  assert.deepEqual(
    records(envelope.sessionFacts.currentReferences).map((entry) => entry.ref),
    ['ref:a'],
  );
  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:b'],
  );
  const decisions = records(audit.decisions);
  assert.ok(decisions.some((entry) => entry.id === 'sessionFacts.currentReferences:contract-ref-filter'
    && entry.source === 'request.uiState.agentHarness.contract.contextRefs'
    && Array.isArray(entry.omittedRefs)
    && entry.omittedRefs.includes('ref:c')));
  assert.ok(decisions.some((entry) => entry.id === 'sessionFacts.currentReferenceDigests:contract-ref-filter'
    && Array.isArray(entry.omittedRefs)
    && entry.omittedRefs.includes('ref:c')));
  assert.ok(decisions.some((entry) => entry.id === 'sessionFacts.currentReferenceDigests:context-budget-maxReferenceDigests'
    && entry.source === 'request.uiState.agentHarness.contract.contextBudget.maxReferenceDigests'
    && Array.isArray(entry.preservedRequiredRefs)
    && entry.preservedRequiredRefs.includes('ref:b')));
  const slimmingTrace = records(audit.slimmingTrace);
  assert.equal(slimmingTrace.length, 1);
  const trace = slimmingTrace[0] ?? {};
  assert.equal(trace.schemaVersion, 'sciforge.context-envelope.slimming-trace.v1');
  assert.equal(trace.target, 'sessionFacts.currentReferenceDigests');
  assert.equal(trace.deterministic, true);
  assert.deepEqual(records([trace.sourceRefs])[0], {
    contractRef: 'harness-contract:test-budget',
    traceRef: 'harness-trace:test-budget',
    budgetField: 'maxReferenceDigests',
  });
  assert.deepEqual(trace.inputRefs, ['ref:a', 'ref:b']);
  assert.deepEqual(trace.keptRefs, ['ref:b']);
  assert.deepEqual(trace.omittedRefs, ['ref:a']);
  assert.deepEqual(trace.requiredRefs, ['ref:b']);
  assert.equal(typeof trace.decisionRef, 'string');
  assert.equal(typeof trace.decisionDigest, 'string');
});

test('context envelope governance ignores legacy context fields when contract handoff is present', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: 'Use the contract-only current refs.',
    artifacts: [],
    uiState: {
      agentHarnessContextEnvelopeEnabled: true,
      currentReferenceDigests: [
        { ref: 'ref:keep', digestText: 'Keep digest' },
        { ref: 'ref:drop', digestText: 'Drop digest' },
        { ref: 'ref:legacy-only', digestText: 'Legacy-only digest' },
      ],
      allowedContextRefs: ['ref:legacy-only'],
      blockedContextRefs: ['ref:keep'],
      contextBudget: { maxReferenceDigests: 0 },
      capabilityPolicy: {
        contextRefs: { allowed: ['ref:legacy-only'], blocked: ['ref:keep'] },
        contextBudget: { maxReferenceDigests: 0 },
      },
      agentHarnessHandoff: {
        schemaVersion: 'sciforge.agent-harness-handoff.v1',
        harnessContractRef: 'harness-contract:handoff-only',
        harnessTraceRef: 'harness-trace:handoff-only',
        contextRefs: {
          allowed: ['ref:keep', 'ref:drop'],
          blocked: ['ref:drop'],
          required: ['ref:keep'],
        },
        contextBudget: {
          maxReferenceDigests: 1,
        },
      },
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:keep'],
  );
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'request.uiState.agentHarnessHandoff');
  assert.equal(audit.contractRef, 'harness-contract:handoff-only');
  assert.deepEqual(
    records(audit.ignoredLegacySources).map((entry) => entry.source),
    ['request.uiState', 'request.uiState.capabilityPolicy'],
  );
  assert.deepEqual(records(audit.ignoredLegacySources).map((entry) => entry.refCount), [2, 2]);
  assert.equal(JSON.stringify(audit.decisions).includes('request.uiState.contextBudget'), false);
  assert.deepEqual(records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref).includes('ref:legacy-only'), false);
});

test('context envelope governance emits ignored legacy audit without legacy-driven filtering', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: 'Legacy context fields should not govern refs.',
    artifacts: [],
    uiState: {
      agentHarnessContextEnvelopeEnabled: true,
      currentReferenceDigests: [
        { ref: 'ref:a', digestText: 'A digest' },
        { ref: 'ref:b', digestText: 'B digest' },
      ],
      allowedContextRefs: ['ref:a'],
      blockedContextRefs: ['ref:b'],
      contextBudget: { maxReferenceDigests: 1 },
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:a', 'ref:b'],
  );
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'contract-only:no-harness-context');
  assert.deepEqual(record(audit.contextRefs), { allowed: [], blocked: [], required: [] });
  assert.deepEqual(records(audit.decisions), []);
  assert.deepEqual(records(audit.ignoredLegacySources).map((entry) => entry.source), ['request.uiState']);
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) : [];
}
