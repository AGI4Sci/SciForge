import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { VERIFICATION_RESULT_ARTIFACT_TYPE } from '@sciforge-ui/runtime-contract/verification-result';
import type { GatewayRequest, SkillAvailability, WorkspaceTaskRunResult } from '../runtime-types';
import { requestWithoutInlineAgentHarness } from './agent-harness-shadow';
import { buildAgentServerGenerationPrompt, buildCompactRepairContext } from './agentserver-prompts';
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

test('context envelope keeps ref-backed artifact bodies and log refs bounded for continuation', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: '继续导出审计摘要，列出 stdout/stderr refs，不要重跑。',
    artifacts: [{
      id: 'report-1',
      type: 'research-report',
      dataRef: '.sciforge/artifacts/report.json',
      data: { markdown: `# Report\n\n${'large evidence body '.repeat(2000)}` },
    }],
    uiState: {
      failureRecoveryPolicy: {
        evidenceExpansionPolicy: {
          logRefs: 'cite stdoutRef/stderrRef for audit; expand only for explicit log inspection',
        },
      },
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  const artifactSummary = envelope.longTermRefs.artifacts?.[0] as { dataSummary?: Record<string, unknown> } | undefined;
  assert.equal(artifactSummary?.dataSummary?.omitted, 'ref-backed-artifact-data');
  assert.deepEqual(artifactSummary?.dataSummary?.refs, ['.sciforge/artifacts/report.json']);
  assert.doesNotMatch(JSON.stringify(artifactSummary), /large evidence body large evidence body/);
  assert.equal(envelope.scenarioFacts.evidenceExpansionPolicy?.stdoutStderrRefs, 'cite-only-by-default');
  assert.equal(envelope.scenarioFacts.evidenceExpansionPolicy?.logBodyExpansion, 'requires-explicit-policy');
  assert.equal(envelope.scenarioFacts.evidenceExpansionPolicy?.structuredRefTransport, 'refs-and-digests-first');
});

test('context envelope carries compact state digest refs after history compaction', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: '继续刚才压缩后的任务，打开上一轮报告和失败 run。',
    artifacts: [],
    uiState: {
      stateDigest: {
        schemaVersion: 'sciforge.conversation.state-digest.v1',
        taskId: 'task-compacted',
        relation: 'follow-up',
        summary: 'Only compact state digest and durable refs remain after backend compaction.',
        handoffPolicy: 'digest-and-refs-only',
        stateRefs: ['run:failed-42', '.sciforge/task-results/failed-42.json'],
        completedRefs: ['artifact:report-42'],
        carryForwardRefs: ['.sciforge/artifacts/report-42.md', 'artifact:report-42'],
        invalidatedRefs: ['artifact:old-report'],
      },
      recentConversation: [
        { role: 'assistant', content: 'The old raw history was compacted.' },
      ],
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.equal(record(envelope.sessionFacts.stateDigest).handoffPolicy, 'digest-and-refs-only');
  assert.deepEqual(envelope.longTermRefs.stateDigestRefs, [
    'run:failed-42',
    '.sciforge/task-results/failed-42.json',
    'artifact:report-42',
    '.sciforge/artifacts/report-42.md',
  ]);
  assert.ok(record(record(envelope.startupContextEnvelope.alwaysOnFacts).keyRefs).currentRefs);
  const startupRefs = record(record(envelope.startupContextEnvelope.alwaysOnFacts).keyRefs).currentRefs as unknown[];
  assert.ok(startupRefs.includes('run:failed-42'));
  assert.ok(startupRefs.includes('.sciforge/artifacts/report-42.md'));
  assert.ok(Number(record(envelope.scenarioFacts.capabilityBrokerBrief).inputSummary
    ? record(record(envelope.scenarioFacts.capabilityBrokerBrief).inputSummary).objectRefs
    : 0) >= 2);
});

test('context envelope summarizes recent runs instead of carrying raw large log fields', () => {
  const largeLog = [
    'RAW_RUN_LOG_SENTINEL_HEAD',
    'log line '.repeat(4000),
    'RAW_RUN_LOG_SENTINEL_TAIL',
  ].join('\n');
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: '继续分析失败 run。',
    artifacts: [],
    uiState: {
      recentConversation: ['user: previous'],
      recentRuns: [{
        id: 'run-large',
        status: 'failed-with-reason',
        stdoutRef: '.sciforge/logs/run-large.stdout.log',
        stderrRef: '.sciforge/logs/run-large.stderr.log',
        stdout: largeLog,
        stderr: largeLog,
        failureReason: 'failed while parsing large log',
      }],
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  const serialized = JSON.stringify(envelope.sessionFacts.recentRuns);
  assert.doesNotMatch(serialized, /RAW_RUN_LOG_SENTINEL_HEAD|RAW_RUN_LOG_SENTINEL_TAIL/);
  assert.match(serialized, /run-large\.stdout\.log/);
});

test('context envelope and AgentServer prompt keep verification bodies as bounded summaries', () => {
  const rawVerification = `RAW_VERIFICATION_SENTINEL ${'provider payload '.repeat(2000)}`;
  const request = {
    skillDomain: 'knowledge',
    prompt: '第二轮：只压缩上一轮接受标准，不要读取 verification raw body。',
    artifacts: [{
      id: 'verify-artifact',
      type: VERIFICATION_RESULT_ARTIFACT_TYPE,
      dataRef: '.sciforge/verifications/verify-artifact.json',
      data: {
        verdict: 'failed',
        rawProviderPayload: rawVerification,
      },
    }],
    verificationResult: {
      id: 'verify-current',
      verdict: 'failed',
      confidence: 0.2,
      evidenceRefs: ['file:.sciforge/verifications/verify-current.json'],
      critique: `rawProviderPayload should stay out ${rawVerification}`,
      repairHints: [`providerResponse should stay out ${rawVerification}`],
      data: { rawProviderPayload: rawVerification },
    },
    recentVerificationResults: [{
      id: 'verify-recent',
      verdict: 'failed',
      confidence: 0.2,
      evidenceRefs: ['file:.sciforge/verifications/verify-recent.json'],
      raw: rawVerification,
    }],
    uiState: {
      verificationResult: {
        id: 'verify-ui',
        verdict: 'failed',
        confidence: 0.2,
        evidenceRefs: ['file:.sciforge/verifications/verify-ui.json'],
        data: { rawProviderPayload: rawVerification },
      },
      recentVerificationResults: [{
        id: 'verify-ui-recent',
        verdict: 'failed',
        confidence: 0.2,
        evidenceRefs: ['file:.sciforge/verifications/verify-ui-recent.json'],
        data: { rawProviderPayload: rawVerification },
      }],
      recentRuns: [{
        id: 'run-raw',
        status: 'failed',
        outputRef: '.sciforge/task-results/run-raw.json',
        raw: {
          backgroundCompletion: {
            lastEvent: {
              verificationResults: [{ rawProviderPayload: rawVerification }],
            },
          },
        },
      }],
    },
  } as GatewayRequest;

  const envelope = buildContextEnvelope(request, { workspace: '/tmp/sciforge-test' });
  const envelopeJson = JSON.stringify(envelope);
  assert.doesNotMatch(envelopeJson, /RAW_VERIFICATION_SENTINEL/);
  assert.match(envelopeJson, /verification-payload-body/);
  assert.match(envelopeJson, /bounded-session-refs/);
  assert.match(envelopeJson, /verify-current\.json/);

  const prompt = buildAgentServerGenerationPrompt({
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    contextEnvelope: envelope,
    workspaceTreeSummary: [],
    availableSkills: [],
    artifactSchema: {},
    uiManifestContract: {},
    uiStateSummary: request.uiState,
    artifacts: request.artifacts,
    priorAttempts: [],
  });
  assert.doesNotMatch(prompt, /RAW_VERIFICATION_SENTINEL/);
  assert.match(prompt, /prompt-handoff/);
  assert.match(prompt, /verify-current\.json/);
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

test('inline harness stripping preserves compact context governance handoff by default', () => {
  const request = {
    skillDomain: 'knowledge',
    prompt: 'Use the contract-selected digest only.',
    artifacts: [],
    uiState: {
      harnessProfileId: 'balanced-default',
      currentReferenceDigests: [
        { ref: 'ref:keep', digestText: 'Keep digest' },
        { ref: 'ref:drop', digestText: 'Drop digest' },
      ],
      agentHarness: {
        profileId: 'balanced-default',
        contractRef: 'harness-contract:inline-strip',
        traceRef: 'harness-trace:inline-strip',
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          profileId: 'balanced-default',
          contractRef: 'harness-contract:inline-strip',
          traceRef: 'harness-trace:inline-strip',
          allowedContextRefs: ['ref:keep'],
          blockedContextRefs: ['ref:drop'],
          contextBudget: {
            maxReferenceDigests: 1,
          },
        },
      },
    },
  } as GatewayRequest;

  const stripped = requestWithoutInlineAgentHarness(request);
  assert.equal(record(record(stripped.uiState).agentHarness).schemaVersion, undefined);
  assert.equal(record(stripped.uiState).harnessProfileId, undefined);
  assert.equal(record(record(stripped.uiState).agentHarnessHandoff).harnessContractRef, 'harness-contract:inline-strip');

  const envelope = buildContextEnvelope(stripped, { workspace: '/tmp/sciforge-test' });
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'request.uiState.agentHarnessHandoff');
  assert.equal(audit.contractRef, 'harness-contract:inline-strip');
  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:keep'],
  );

  const disabled = requestWithoutInlineAgentHarness({
    ...request,
    uiState: {
      ...record(request.uiState),
      agentHarnessContextEnvelopeDisabled: true,
    },
  } as GatewayRequest);
  assert.equal(record(record(disabled.uiState).agentHarnessHandoff).harnessContractRef, undefined);
  const disabledEnvelope = buildContextEnvelope(disabled, { workspace: '/tmp/sciforge-test' });
  assert.equal(record(disabledEnvelope.contextGovernanceAudit).schemaVersion, undefined);
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
  assert.equal(audit.source, 'contract-only:no-contract-context');
  assert.deepEqual(record(audit.contextRefs), { allowed: [], blocked: [], required: [] });
  assert.deepEqual(records(audit.decisions), []);
  assert.deepEqual(records(audit.ignoredLegacySources).map((entry) => entry.source), ['request.uiState']);
});

test('context envelope governance ignores legacy repair context policy fields for context decisions', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: 'Legacy repair policy refs should not govern current refs.',
    artifacts: [],
    uiState: {
      agentHarnessContextEnvelopeEnabled: true,
      currentReferenceDigests: [
        { ref: 'ref:keep', digestText: 'Keep digest' },
        { ref: 'ref:legacy-repair-blocked', digestText: 'Legacy repair blocked digest' },
      ],
      repairContextPolicy: {
        allowedFailureEvidenceRefs: ['ref:keep'],
        blockedFailureEvidenceRefs: ['ref:legacy-repair-blocked'],
        includeStdoutSummary: false,
        includeStderrSummary: false,
      },
      capabilityPolicy: {
        repairContextPolicy: {
          allowedFailureEvidenceRefs: ['ref:keep'],
          blockedFailureEvidenceRefs: ['ref:legacy-repair-blocked'],
          includeValidationFindings: false,
          includePriorAttemptRefs: false,
        },
      },
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:keep', 'ref:legacy-repair-blocked'],
  );
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'contract-only:no-contract-context');
  assert.deepEqual(records(audit.decisions), []);
  const ignoredLegacySources = records(audit.ignoredLegacySources);
  assert.deepEqual(ignoredLegacySources.map((entry) => entry.source), [
    'request.uiState',
    'request.uiState.capabilityPolicy',
  ]);
  assert.deepEqual(ignoredLegacySources.map((entry) => entry.keys), [
    ['repairContextPolicy'],
    ['repairContextPolicy'],
  ]);
  assert.deepEqual(ignoredLegacySources.map((entry) => entry.repairEvidenceRefCount), [2, 2]);
  assert.deepEqual(ignoredLegacySources.map((entry) => entry.refCount), [undefined, undefined]);
  assert.deepEqual(
    ignoredLegacySources.map((entry) => entry.repairContextPolicyFields),
    [
      ['allowedFailureEvidenceRefs', 'blockedFailureEvidenceRefs', 'includeStdoutSummary', 'includeStderrSummary'],
      ['allowedFailureEvidenceRefs', 'blockedFailureEvidenceRefs', 'includeValidationFindings', 'includePriorAttemptRefs'],
    ],
  );
});

test('context envelope governance audits contract repair context policy without using it for context refs', () => {
  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: 'Contract repair policy should be audit-only for context envelope.',
    artifacts: [],
    uiState: {
      agentHarnessContextEnvelopeEnabled: true,
      currentReferenceDigests: [
        { ref: 'ref:keep', digestText: 'Keep digest' },
        { ref: 'ref:repair-blocked', digestText: 'Repair-blocked digest' },
      ],
      repairContextPolicy: {
        blockedFailureEvidenceRefs: ['ref:keep'],
        includeStdoutSummary: false,
      },
      agentHarness: {
        contract: {
          schemaVersion: 'sciforge.agent-harness-contract.v1',
          contractRef: 'harness-contract:repair-policy',
          traceRef: 'harness-trace:repair-policy',
          repairContextPolicy: {
            kind: 'failed-task-evidence',
            maxAttempts: 2,
            allowedFailureEvidenceRefs: ['stdout:summary'],
            blockedFailureEvidenceRefs: ['ref:repair-blocked'],
            includeStdoutSummary: true,
            includeStderrSummary: false,
            includeValidationFindings: true,
            includePriorAttemptRefs: false,
          },
        },
      },
    },
  } as GatewayRequest, { workspace: '/tmp/sciforge-test' });

  assert.deepEqual(
    records(envelope.sessionFacts.currentReferenceDigests).map((entry) => entry.ref),
    ['ref:keep', 'ref:repair-blocked'],
  );
  const audit = record(envelope.contextGovernanceAudit);
  assert.equal(audit.source, 'request.uiState.agentHarness.contract');
  assert.deepEqual(records(audit.decisions), []);
  const repairContextPolicy = record(audit.repairContextPolicy);
  assert.equal(repairContextPolicy.schemaVersion, 'sciforge.context-envelope.repair-context-policy-summary.v1');
  assert.equal(repairContextPolicy.source, 'request.uiState.agentHarness.contract.repairContextPolicy');
  assert.equal(repairContextPolicy.sourceKind, 'contract');
  assert.equal(repairContextPolicy.contractRef, 'harness-contract:repair-policy');
  assert.equal(repairContextPolicy.traceRef, 'harness-trace:repair-policy');
  assert.equal(repairContextPolicy.deterministic, true);
  assert.equal(typeof repairContextPolicy.deterministicDecisionRef, 'string');
  assert.deepEqual(repairContextPolicy.fields, [
    'kind',
    'allowedFailureEvidenceRefs',
    'blockedFailureEvidenceRefs',
    'maxAttempts',
    'includeStdoutSummary',
    'includeStderrSummary',
    'includeValidationFindings',
    'includePriorAttemptRefs',
  ]);
  assert.deepEqual(repairContextPolicy.allowedFailureEvidenceRefs, ['stdout:summary']);
  assert.deepEqual(repairContextPolicy.blockedFailureEvidenceRefs, ['ref:repair-blocked']);
  assert.equal(repairContextPolicy.includeStdoutSummary, true);
  assert.equal(repairContextPolicy.includeStderrSummary, false);
  assert.equal(repairContextPolicy.includeValidationFindings, true);
  assert.equal(repairContextPolicy.includePriorAttemptRefs, false);
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

    const diagnostics = context.diagnostics as { workEvidenceSummary?: { items?: Array<{ resultCount?: number; nextStep?: string }> } };
    assert.equal(diagnostics.workEvidenceSummary?.items?.[0]?.resultCount, 0);
    assert.equal(diagnostics.workEvidenceSummary?.items?.[0]?.nextStep, 'Ask whether to broaden scope.');
    assert.match(JSON.stringify(context), /diagnostic-first\/ref-first/);
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
