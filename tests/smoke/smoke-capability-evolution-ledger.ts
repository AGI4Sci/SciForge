import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CapabilityEvolutionRecord } from '../../packages/contracts/runtime/capability-evolution.js';
import {
  appendCapabilityEvolutionRecord,
  buildCapabilityEvolutionBrokerDigest,
  buildCapabilityEvolutionCandidateSet,
  buildCapabilityEvolutionCompactSummary,
  CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH,
  readCapabilityEvolutionRecords,
  sanitizeCapabilityEvolutionCompactSummaryForBroker,
} from '../../src/runtime/capability-evolution-ledger.js';
import { recordCapabilityEvolutionRuntimeEvent } from '../../src/runtime/gateway/capability-evolution-events.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { repairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';
import { listSkillPromotionProposals, writeSkillPromotionProposalsFromCapabilityEvolutionSummary } from '../../src/runtime/skill-promotion.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-ledger-'));

try {
  const record: CapabilityEvolutionRecord = {
    schemaVersion: 'sciforge.capability-evolution-record.v1',
    id: 'cel-smoke-1',
    recordedAt: '2026-05-09T00:00:00.000Z',
    runId: 'run-smoke-1',
    goalSummary: 'Compose a general capability and recover through atomic fallback after validation fails.',
    selectedCapabilities: [
      { id: 'capability.compose.generic', kind: 'composed', providerId: 'provider-runtime', role: 'primary' },
      { id: 'capability.atomic.extract', kind: 'skill', providerId: 'provider-runtime', role: 'fallback' },
      { id: 'capability.atomic.render', kind: 'tool', providerId: 'provider-runtime', role: 'fallback' },
    ],
    providers: [{ id: 'provider-runtime', kind: 'local-runtime' }],
    inputSchemaRefs: ['schema:input.generic.v1'],
    outputSchemaRefs: ['schema:artifact.generic.v1'],
    glueCodeRef: '.sciforge/tasks/composed-smoke.py',
    executionUnitRefs: ['execution-unit:composed-1', 'execution-unit:atomic-1', 'execution-unit:repair-1'],
    artifactRefs: ['artifact:summary-1'],
    validationResult: {
      verdict: 'fail',
      validatorId: 'validator.schema',
      failureCode: 'schema-invalid',
      summary: 'Composed output missed a required artifact field.',
      resultRef: '.sciforge/verifications/composed-smoke.json',
    },
    failureCode: 'schema-invalid',
    recoverActions: ['fallback-to-atomic', 'repair-output-schema'],
    repairAttempts: [
      {
        id: 'repair-1',
        status: 'succeeded',
        reason: 'Normalized atomic outputs into the expected artifact contract.',
        executionUnitRefs: ['execution-unit:repair-1'],
        artifactRefs: ['artifact:summary-1'],
        validationResult: { verdict: 'pass', validatorId: 'validator.schema' },
      },
    ],
    fallbackPolicy: {
      atomicCapabilities: [
        { id: 'capability.atomic.extract', kind: 'skill', providerId: 'provider-runtime', role: 'fallback' },
        { id: 'capability.atomic.render', kind: 'tool', providerId: 'provider-runtime', role: 'fallback' },
      ],
      fallbackToAtomicWhen: ['schema-invalid', 'validation-failed'],
      doNotFallbackWhen: ['unsafe-side-effect', 'requires-human-approval'],
      retryBudget: { maxRetries: 2, maxRepairAttempts: 1, maxFallbackAttempts: 1 },
      fallbackContext: {
        validationResultRefs: ['.sciforge/verifications/composed-smoke.json'],
        reason: 'Schema validation failed before user-visible delivery.',
      },
    },
    composedResult: {
      status: 'repair-succeeded',
      failureCode: 'schema-invalid',
      fallbackable: true,
      confidence: 0.82,
      coverage: 0.9,
      recoverActions: ['fallback-to-atomic', 'repair-output-schema'],
      atomicTrace: [
        {
          capabilityId: 'capability.atomic.extract',
          providerId: 'provider-runtime',
          status: 'succeeded',
          executionUnitRefs: ['execution-unit:atomic-1'],
          artifactRefs: ['artifact:intermediate-1'],
        },
        {
          capabilityId: 'capability.atomic.render',
          providerId: 'provider-runtime',
          status: 'succeeded',
          executionUnitRefs: ['execution-unit:repair-1'],
          artifactRefs: ['artifact:summary-1'],
        },
      ],
      relatedRefs: {
        runId: 'run-smoke-1',
        glueCodeRef: '.sciforge/tasks/composed-smoke.py',
        executionUnitRefs: ['execution-unit:composed-1', 'execution-unit:atomic-1', 'execution-unit:repair-1'],
        artifactRefs: ['artifact:summary-1'],
        validationResultRefs: ['.sciforge/verifications/composed-smoke.json'],
      },
    },
    finalStatus: 'repair-succeeded',
    latencyCostSummary: { latencyMs: 42, executionCount: 3 },
    promotionCandidate: { eligible: false, reason: 'single smoke record is not enough for promotion' },
    metadata: { glueCodePreview: 'print("compact summary should not inline this")' },
  };

  const appendResult = await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record);
  assert.equal(appendResult.ref, CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH);

  const rawLedger = await readFile(appendResult.path, 'utf8');
  assert.match(rawLedger, /"id":"cel-smoke-1"/);
  assert.match(rawLedger, /glueCodePreview/);

  const records = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.composedResult?.atomicTrace.length, 2);

  const summary = await buildCapabilityEvolutionCompactSummary({
    workspacePath: workspace,
    now: () => new Date('2026-05-09T00:01:00.000Z'),
  });
  assert.equal(summary.schemaVersion, 'sciforge.capability-evolution-compact-summary.v1');
  assert.equal(summary.totalRecords, 1);
  assert.equal(summary.fallbackRecordCount, 1);
  assert.equal(summary.repairRecordCount, 1);
  assert.equal(summary.recentRecords[0]?.failureCode, 'schema-invalid');
  assert.deepEqual(summary.recentRecords[0]?.fallbackDecision, {
    trigger: 'schema-invalid',
    reason: 'Schema validation failed before user-visible delivery.',
    fallbackable: true,
    atomicCapabilityIds: ['capability.atomic.extract', 'capability.atomic.render'],
    blockedBy: ['unsafe-side-effect', 'requires-human-approval'],
    recoverActions: ['fallback-to-atomic', 'repair-output-schema'],
  });
  assert.deepEqual(summary.recentRecords[0]?.atomicTrace, [
    {
      capabilityId: 'capability.atomic.extract',
      providerId: 'provider-runtime',
      status: 'succeeded',
      executionUnitRefs: ['execution-unit:atomic-1'],
      artifactRefs: ['artifact:intermediate-1'],
    },
    {
      capabilityId: 'capability.atomic.render',
      providerId: 'provider-runtime',
      status: 'succeeded',
      executionUnitRefs: ['execution-unit:repair-1'],
      artifactRefs: ['artifact:summary-1'],
    },
  ]);
  assert.deepEqual(summary.recentRecords[0]?.artifactRefs, ['artifact:summary-1']);
  assert.deepEqual(summary.recentRecords[0]?.executionUnitRefs, [
    'execution-unit:composed-1',
    'execution-unit:atomic-1',
    'execution-unit:repair-1',
  ]);
  assert.equal(JSON.stringify(summary).includes('print('), false, 'compact summary must not expand glue code content');
  assert.equal(summary.recentRecords[0]?.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`);
  const brokerSafeSummary = sanitizeCapabilityEvolutionCompactSummaryForBroker({
    ...summary,
    recentRecords: [{
      ...summary.recentRecords[0],
      glueCodeRef: '.sciforge/tasks/LEDGER_GLUE_CODE_SENTINEL.py',
      fullLog: 'LEDGER_FULL_LOG_SENTINEL',
    }],
  });
  assert.ok(brokerSafeSummary);
  const brokerSafeText = JSON.stringify(brokerSafeSummary);
  assert.equal(brokerSafeText.includes('LEDGER_GLUE_CODE_SENTINEL'), false);
  assert.equal(brokerSafeText.includes('LEDGER_FULL_LOG_SENTINEL'), false);
  const brokerDigest = buildCapabilityEvolutionBrokerDigest(brokerSafeSummary);
  assert.equal(brokerDigest.schemaVersion, 'sciforge.capability-evolution-broker-digest.v1');
  assert.deepEqual(brokerDigest.consumedRecordRefs, [`${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`]);
  assert.deepEqual(brokerDigest.failureCodes, ['schema-invalid']);
  assert.equal(brokerDigest.repairHintImprovementCandidateCount, 0);

  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Generate a compact literature report from current workspace refs.',
    workspacePath: workspace,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    artifacts: [],
    uiState: { sessionId: 'session-ledger-smoke' },
  };
  const skill: SkillAvailability = {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: '2026-05-09T00:00:00.000Z',
    manifestPath: 'agentserver://literature',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'ledger smoke',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
  const validationFailure = await recordCapabilityEvolutionRuntimeEvent({
    workspacePath: workspace,
    request,
    skill,
    taskId: 'generated-literature-validation-failure',
    runId: 'agentserver-run-validation-failure',
    taskRel: '.sciforge/tasks/generated-literature-validation-failure/task.py',
    inputRel: '.sciforge/task-inputs/generated-literature-validation-failure.json',
    outputRel: '.sciforge/task-results/generated-literature-validation-failure.json',
    stdoutRel: '.sciforge/logs/generated-literature-validation-failure.stdout.log',
    stderrRel: '.sciforge/logs/generated-literature-validation-failure.stderr.log',
    run: { exitCode: 0, runtimeFingerprint: { runtime: 'python', secretToken: 'must-not-leak' } },
    payload: {
      confidence: 0.3,
      executionUnits: [{ id: 'generated-validation-failure', status: 'repair-needed' }],
      artifacts: [{ id: 'broken-report', type: 'research-report' }],
    },
    schemaErrors: ['uiManifest[0].componentId must be a non-empty string'],
    failureReason: 'AgentServer generated task output failed schema validation: uiManifest[0].componentId must be a non-empty string',
    now: () => new Date('2026-05-09T00:02:00.000Z'),
  });
  assert.equal(validationFailure.ledgerRef, CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH);
  assert.equal(validationFailure.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L2`);
  assert.equal(validationFailure.record.finalStatus, 'repair-failed');
  assert.equal(validationFailure.record.validationResult?.failureCode, 'schema-invalid');
  assert.equal(validationFailure.compactSummary.totalRecords, 2);
  assert.equal(validationFailure.compactSummary.recentRecords.at(-1)?.recordRef, validationFailure.recordRef);
  assert.equal(JSON.stringify(validationFailure.compactSummary).includes('secretToken'), false);
  assert.equal(JSON.stringify(validationFailure.compactSummary).includes('must-not-leak'), false);
  assert.equal(validationFailure.record.glueCodeRef, '.sciforge/tasks/generated-literature-validation-failure/task.py');
  assert.equal(JSON.stringify(validationFailure.compactSummary).includes('task.py'), false, 'broker summary should use record refs instead of task code refs');
  assert.equal(JSON.stringify(validationFailure.compactSummary).includes('print('), false, 'summary must not expand generated code');

  const repairCompletion = await recordCapabilityEvolutionRuntimeEvent({
    workspacePath: workspace,
    request,
    skill,
    taskId: 'generated-literature-validation-failure',
    runId: 'agentserver-run-repair-completion',
    taskRel: '.sciforge/tasks/generated-literature-validation-failure/repaired-task.py',
    inputRel: '.sciforge/task-inputs/generated-literature-validation-failure-repair.json',
    outputRel: '.sciforge/task-results/generated-literature-validation-failure-repair.json',
    stdoutRel: '.sciforge/logs/generated-literature-validation-failure-repair.stdout.log',
    stderrRel: '.sciforge/logs/generated-literature-validation-failure-repair.stderr.log',
    run: { exitCode: 0, runtimeFingerprint: { runtime: 'python' } },
    payload: {
      confidence: 0.86,
      executionUnits: [{ id: 'generated-validation-repair', status: 'done' }],
      artifacts: [{ id: 'repaired-report', type: 'research-report' }],
    },
    failureReason: 'Repair rerun returned a valid ToolPayload.',
    repairAttempt: {
      id: 'repair-generated-literature-validation-failure',
      status: 'succeeded',
      validationResult: { verdict: 'pass', validatorId: 'sciforge.payload-schema' },
    },
    now: () => new Date('2026-05-09T00:03:00.000Z'),
  });
  assert.equal(repairCompletion.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L3`);
  assert.equal(repairCompletion.record.finalStatus, 'repair-succeeded');
  assert.equal(repairCompletion.compactSummary.totalRecords, 3);
  assert.equal(repairCompletion.compactSummary.repairRecordCount, 3);
  assert.equal(repairCompletion.compactSummary.recentRecords.at(-1)?.finalStatus, 'repair-succeeded');

  const runtimeRecords = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  assert.equal(runtimeRecords.length, 3);
  assert.equal(runtimeRecords[1]?.metadata?.eventKind, 'validation-failure');
  assert.equal(runtimeRecords[2]?.metadata?.eventKind, 'repair-completion');

  const realPathPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.local',
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'agentserver-run-ledger-real-path',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/ledger-real-path.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {"message": "bad payload from ledger-real-path-code"}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/ledger-real-path.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'ledger real path validation failure smoke',
      },
    }),
    agentServerGenerationFailureReason: (error) => error,
    attemptPlanRefs: () => ({}),
    repairNeededPayload: (req, selectedSkill, reason) => repairNeededPayload(req, selectedSkill, reason),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload): Promise<ToolPayload> => payload,
    tryAgentServerRepairAndRerun: async () => undefined,
    failedTaskPayload: (req, selectedSkill, _run, reason) => repairNeededPayload(req, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: () => undefined,
    schemaErrors: (payload) => {
      const record = payload as Record<string, unknown>;
      return ['claims', 'uiManifest', 'executionUnits', 'artifacts'].filter((key) => !(key in record)).map((key) => `missing ${key}`);
    },
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  }, { allowSupplement: false });
  assert.equal(realPathPayload?.executionUnits[0]?.status, 'repair-needed');
  const recordsAfterRealPath = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  assert.equal(recordsAfterRealPath.length, 4);
  assert.equal(recordsAfterRealPath[3]?.metadata?.eventKind, 'validation-failure');
  assert.match(recordsAfterRealPath[3]?.glueCodeRef ?? '', /ledger-real-path/);
  const realPathSummary = await buildCapabilityEvolutionCompactSummary({ workspacePath: workspace });
  assert.equal(realPathSummary.recentRecords.at(-1)?.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L4`);
  assert.equal(JSON.stringify(realPathSummary).includes('ledger-real-path-code'), false);

  const failureProposal = realPathSummary.promotionCandidates.find((entry) => entry.promotionCandidate?.proposalKind === 'validator-update');
  assert.ok(failureProposal, 'repeated schema failures should propose validator/repair-hint improvements');
  assert.equal(failureProposal.promotionCandidate?.supportCount, 2);
  assert.deepEqual(failureProposal.promotionCandidate?.supportingRecordRefs, [
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L2`,
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L4`,
  ]);
  assert.deepEqual(failureProposal.promotionCandidate?.suggestedUpdates?.failureCodes, ['schema-invalid']);
  assert.equal((failureProposal.promotionCandidate?.suggestedUpdates?.repairHints?.length ?? 0) >= 1, true);
  const failureCandidateSet = buildCapabilityEvolutionCandidateSet(realPathSummary);
  assert.equal(failureCandidateSet.schemaVersion, 'sciforge.capability-evolution-candidate-set.v1');
  assert.equal(failureCandidateSet.repairHintImprovementCandidates.length, 1);
  assert.equal(failureCandidateSet.repairHintImprovementCandidates[0]?.proposalKind, 'validator-update');
  assert.equal(JSON.stringify(failureCandidateSet).includes('task.py'), false);
  assert.equal(JSON.stringify(failureCandidateSet).includes('stdout.log'), false);

  await appendCapabilityEvolutionRecord({ workspacePath: workspace }, {
    ...record,
    id: 'cel-smoke-1-repeat',
    recordedAt: '2026-05-09T00:04:00.000Z',
    runId: 'run-smoke-1-repeat',
    promotionCandidate: { eligible: false, reason: 'aggregate helper should decide after repeated success' },
  });
  const promotionProposalSummary = await buildCapabilityEvolutionCompactSummary({ workspacePath: workspace });
  const composedProposal = promotionProposalSummary.promotionCandidates.find((entry) => entry.promotionCandidate?.proposalKind === 'composed-capability');
  assert.ok(composedProposal, 'repeated successful capability combinations should propose a composed capability');
  assert.equal(composedProposal.promotionCandidate?.supportCount, 2);
  assert.equal(composedProposal.promotionCandidate?.suggestedCapabilityId, 'capability.composed.atomic-extract-atomic-render');
  assert.deepEqual(composedProposal.promotionCandidate?.supportingRecordRefs, [
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`,
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L5`,
  ]);
  assert.deepEqual(composedProposal.promotionCandidate?.suggestedUpdates?.capabilityIds, [
    'capability.atomic.extract',
    'capability.atomic.render',
  ]);
  const promotionCandidateSet = buildCapabilityEvolutionCandidateSet(promotionProposalSummary);
  assert.equal(promotionCandidateSet.promotionCandidates.length, 1);
  assert.equal(promotionCandidateSet.promotionCandidates[0]?.suggestedCapabilityId, 'capability.composed.atomic-extract-atomic-render');
  const ledgerSkillProposals = await writeSkillPromotionProposalsFromCapabilityEvolutionSummary({
    workspacePath: workspace,
    summary: promotionProposalSummary,
    request,
    now: () => new Date('2026-05-09T00:05:00.000Z'),
  });
  assert.equal(ledgerSkillProposals.length, 1);
  assert.equal(ledgerSkillProposals[0]?.source.kind, 'capability-evolution-ledger');
  assert.deepEqual(ledgerSkillProposals[0]?.source.ledgerRecordRefs, [
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`,
    `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L5`,
  ]);
  const ledgerProposalText = JSON.stringify(ledgerSkillProposals[0]);
  assert.equal(ledgerProposalText.includes('task.py'), false, 'ledger-sourced skill proposal should not expose glue code refs');
  assert.equal(ledgerProposalText.includes('stdout.log'), false, 'ledger-sourced skill proposal should not expose logs');
  const listedLedgerProposals = await listSkillPromotionProposals(workspace);
  assert.ok(listedLedgerProposals.some((proposal) => proposal.id === ledgerSkillProposals[0]?.id));

  let supplementGenerationCalls = 0;
  const supplementalFallbackPayload = await runAgentServerGeneratedTask({
    ...request,
    prompt: 'Generate a report and fill any missing evidence matrix through backend fallback.',
    expectedArtifactTypes: ['research-report', 'evidence-matrix'],
    selectedComponentIds: ['report-viewer', 'evidence-matrix'],
  }, skill, [skill], {}, {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.local',
    requestAgentServerGeneration: async (_params) => {
      supplementGenerationCalls += 1;
      const isSupplement = supplementGenerationCalls === 2;
      return {
        ok: true,
        runId: isSupplement ? 'agentserver-run-ledger-supplement-atomic' : 'agentserver-run-ledger-composed-primary',
        response: {
          taskFiles: [{
            path: isSupplement ? '.sciforge/tasks/ledger-supplement.py' : '.sciforge/tasks/ledger-primary.py',
            language: 'python',
            content: [
              'import json, sys',
              '_, input_path, output_path = sys.argv',
              isSupplement
                ? 'payload = {"message": "supplement filled matrix", "confidence": 0.91, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "atomic supplement", "claims": [{"text": "matrix filled", "confidence": 0.91}], "uiManifest": [{"componentId": "evidence-matrix", "artifactRef": "supplement-matrix"}], "executionUnits": [{"id": "atomic-supplement", "status": "done", "tool": "python"}], "artifacts": [{"id": "supplement-matrix", "type": "evidence-matrix", "schema": {"type": "object"}, "data": {"rows": []}}]}'
                : 'payload = {"message": "primary report only", "confidence": 0.88, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "primary composed path", "claims": [{"text": "report filled", "confidence": 0.88}], "uiManifest": [{"componentId": "report-viewer", "artifactRef": "primary-report"}], "executionUnits": [{"id": "composed-primary", "status": "done", "tool": "python"}], "artifacts": [{"id": "primary-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "primary"}}]}',
              'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
            ].join('\n'),
          }],
          entrypoint: {
            language: 'python',
            path: isSupplement ? '.sciforge/tasks/ledger-supplement.py' : '.sciforge/tasks/ledger-primary.py',
          },
          environmentRequirements: {},
          validationCommand: '',
          expectedArtifacts: isSupplement ? ['evidence-matrix'] : ['research-report', 'evidence-matrix'],
          patchSummary: isSupplement ? 'ledger atomic supplement fallback smoke' : 'ledger composed primary fallback smoke',
        },
      };
    },
    agentServerGenerationFailureReason: (error) => error,
    attemptPlanRefs: () => ({}),
    repairNeededPayload: (req, selectedSkill, reason) => repairNeededPayload(req, selectedSkill, reason),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload): Promise<ToolPayload> => payload,
    tryAgentServerRepairAndRerun: async () => undefined,
    failedTaskPayload: (req, selectedSkill, _run, reason) => repairNeededPayload(req, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: () => undefined,
    schemaErrors: (payload) => {
      const record = payload as Record<string, unknown>;
      return ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'].filter((key) => !(key in record)).map((key) => `missing ${key}`);
    },
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  });
  assert.equal(supplementGenerationCalls, 2);
  assert.ok(supplementalFallbackPayload?.artifacts.some((artifact) => artifact.id === 'primary-report'));
  assert.ok(supplementalFallbackPayload?.artifacts.some((artifact) => artifact.id === 'supplement-matrix'));
  const recordsAfterSupplementalFallback = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  const supplementalFallbackRecord = recordsAfterSupplementalFallback.find((entry) => entry.metadata?.eventKind === 'composed-capability-fallback');
  assert.ok(supplementalFallbackRecord, 'supplemental backend fallback should write a composed fallback ledger record');
  assert.equal(supplementalFallbackRecord.finalStatus, 'fallback-succeeded');
  assert.equal(supplementalFallbackRecord.failureCode, 'missing-artifact');
  assert.equal(supplementalFallbackRecord.fallbackPolicy?.fallbackContext?.reason, 'Missing expected artifact types: evidence-matrix');
  assert.deepEqual(supplementalFallbackRecord.composedResult?.atomicTrace.map((entry) => entry.capabilityId), ['runtime.python-task']);
  assert.ok(supplementalFallbackRecord.executionUnitRefs.some((ref) => ref.includes('composed-primary')));
  assert.ok(supplementalFallbackRecord.artifactRefs.some((ref) => ref.includes('supplement-matrix')));
  const dynamicGlueSuccess = recordsAfterSupplementalFallback.find((entry) => entry.metadata?.eventKind === 'dynamic-glue-execution');
  assert.ok(dynamicGlueSuccess, 'successful supplemental backend glue should be recorded');
  assert.equal(dynamicGlueSuccess.finalStatus, 'succeeded');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] capability evolution ledger writes compact summaries with fallback/repair evidence and promotion proposals');
