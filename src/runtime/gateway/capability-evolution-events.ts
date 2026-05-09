import type {
  CapabilityEvolutionCompactSummary,
  CapabilityEvolutionRecord,
  CapabilityEvolutionRecordStatus,
  CapabilityFallbackTrigger,
  CapabilityValidationResultRef,
  SelectedCapabilityRef,
} from '../../../packages/contracts/runtime/capability-evolution.js';
import {
  appendCapabilityEvolutionRecord,
  buildCapabilityEvolutionCompactSummary,
  compactCapabilityEvolutionRecord,
} from '../capability-evolution-ledger.js';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { isRecord, uniqueStrings } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';

export interface CapabilityEvolutionRuntimeEventInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  run?: Pick<WorkspaceTaskRunResult, 'exitCode' | 'runtimeFingerprint'>;
  payload?: Partial<ToolPayload>;
  runId?: string;
  taskRel?: string;
  inputRel?: string;
  outputRel?: string;
  stdoutRel?: string;
  stderrRel?: string;
  failureReason?: string;
  schemaErrors?: string[];
  finalStatus?: CapabilityEvolutionRecordStatus;
  recoverActions?: string[];
  repairAttempt?: {
    id?: string;
    status: 'attempted' | 'succeeded' | 'failed' | 'skipped';
    reason?: string;
    patchRef?: string;
    executionUnitRefs?: string[];
    artifactRefs?: string[];
    validationResult?: CapabilityValidationResultRef;
  };
  promotionEligible?: boolean;
  promotionReason?: string;
  now?: () => Date;
}

export interface CapabilityEvolutionRuntimeEventResult {
  ledgerRef: string;
  recordRef: string;
  record: CapabilityEvolutionRecord;
  compactSummary: CapabilityEvolutionCompactSummary;
}

export async function recordCapabilityEvolutionRuntimeEvent(
  input: CapabilityEvolutionRuntimeEventInput,
): Promise<CapabilityEvolutionRuntimeEventResult> {
  const now = input.now ?? (() => new Date());
  const recordedAt = now().toISOString();
  const failureCode = failureCodeForCapabilityEvent(input);
  const validationResult = validationResultForCapabilityEvent(input, failureCode);
  const executionUnitRefs = executionUnitRefsForCapabilityEvent(input);
  const artifactRefs = artifactRefsForCapabilityEvent(input);
  const finalStatus = input.finalStatus ?? finalStatusForCapabilityEvent(input);
  const recoverActions = input.recoverActions ?? recoverActionsForCapabilityEvent(input, finalStatus);
  const recordId = `cel-${sha1([
    input.taskId,
    input.runId ?? '',
    recordedAt,
    input.failureReason ?? '',
    finalStatus,
  ].join(':')).slice(0, 16)}`;

  const record: CapabilityEvolutionRecord = {
    schemaVersion: 'sciforge.capability-evolution-record.v1',
    id: recordId,
    recordedAt,
    runId: input.runId ?? input.taskId,
    sessionId: sessionIdForRequest(input.request),
    goalSummary: compactGoalSummary(input.request.prompt),
    selectedCapabilities: selectedCapabilitiesForCapabilityEvent(input, validationResult),
    providers: [
      { id: 'sciforge.workspace-runtime', kind: 'local-runtime' },
      {
        id: input.skill.id,
        kind: providerKindForSkill(input.skill),
        ...(input.skill.manifestPath ? { detailRef: input.skill.manifestPath } : {}),
      },
    ],
    inputSchemaRefs: uniqueNonEmptyStrings([
      `skill-domain:${input.request.skillDomain}`,
      input.inputRel,
      input.request.skillPlanRef,
      input.request.scenarioPackageRef ? `scenario-package:${input.request.scenarioPackageRef.id}@${input.request.scenarioPackageRef.version}` : '',
    ]),
    outputSchemaRefs: uniqueNonEmptyStrings([
      ...expectedArtifactRefs(input.request),
      input.outputRel,
    ]),
    glueCodeRef: input.taskRel,
    executionUnitRefs,
    artifactRefs,
    validationResult,
    failureCode,
    recoverActions,
    repairAttempts: input.repairAttempt ? [{
      id: input.repairAttempt.id ?? `${input.taskId}-repair`,
      status: input.repairAttempt.status,
      reason: input.repairAttempt.reason ?? input.failureReason,
      patchRef: input.repairAttempt.patchRef,
      executionUnitRefs: input.repairAttempt.executionUnitRefs ?? executionUnitRefs,
      artifactRefs: input.repairAttempt.artifactRefs ?? artifactRefs,
      validationResult: input.repairAttempt.validationResult,
      completedAt: input.repairAttempt.status === 'succeeded' || input.repairAttempt.status === 'failed' ? recordedAt : undefined,
    }] : [],
    fallbackPolicy: {
      atomicCapabilities: fallbackCapabilitiesForEvent(input),
      fallbackToAtomicWhen: fallbackTriggersForEvent(failureCode),
      doNotFallbackWhen: ['unsafe-side-effect', 'requires-human-approval', 'budget-exhausted'],
      retryBudget: { maxRetries: 1, maxRepairAttempts: 1, maxFallbackAttempts: 1 },
      fallbackContext: {
        preserveArtifactRefs: artifactRefs,
        preserveExecutionUnitRefs: executionUnitRefs,
        validationResultRefs: validationResult?.resultRef ? [validationResult.resultRef] : [],
        reason: input.failureReason,
      },
    },
    composedResult: {
      status: composedStatusForRecord(finalStatus),
      failureCode,
      fallbackable: finalStatus !== 'needs-human',
      confidence: input.payload?.confidence,
      recoverActions,
      atomicTrace: fallbackCapabilitiesForEvent(input).map((capability) => ({
        capabilityId: capability.id,
        providerId: capability.providerId,
        status: finalStatus === 'repair-failed' || finalStatus === 'failed' ? 'failed' : 'succeeded',
        failureCode,
        executionUnitRefs,
        artifactRefs,
        validationResult,
      })),
      relatedRefs: {
        runId: input.runId ?? input.taskId,
        glueCodeRef: input.taskRel,
        inputSchemaRefs: uniqueNonEmptyStrings([input.inputRel]),
        outputSchemaRefs: uniqueNonEmptyStrings([input.outputRel]),
        executionUnitRefs,
        artifactRefs,
        validationResultRefs: validationResult?.resultRef ? [validationResult.resultRef] : [],
      },
    },
    finalStatus,
    latencyCostSummary: {
      executionCount: executionUnitRefs.length || 1,
    },
    promotionCandidate: {
      eligible: input.promotionEligible ?? false,
      reason: input.promotionReason ?? 'Runtime event record is compact audit evidence; promotion requires repeated successful records.',
    },
    metadata: compactCapabilityEventMetadata(input),
  };

  const appendResult = await appendCapabilityEvolutionRecord({ workspacePath: input.workspacePath }, record);
  const compactSummary = await buildCapabilityEvolutionCompactSummary({
    workspacePath: input.workspacePath,
    limit: 8,
    now,
  });
  const recordIndex = compactSummary.totalRecords;
  const recordRef = `${appendResult.ref}#L${recordIndex}`;
  const compactRecord = compactCapabilityEvolutionRecord(record, recordRef);
  const recentRecords = compactSummary.recentRecords.map((entry) => entry.id === compactRecord.id ? compactRecord : entry);
  if (!recentRecords.some((entry) => entry.id === compactRecord.id)) recentRecords.push(compactRecord);
  return {
    ledgerRef: appendResult.ref,
    recordRef,
    record,
    compactSummary: {
      ...compactSummary,
      recentRecords,
      promotionCandidates: compactSummary.promotionCandidates.map((entry) => entry.id === compactRecord.id ? compactRecord : entry),
    },
  };
}

function selectedCapabilitiesForCapabilityEvent(
  input: CapabilityEvolutionRuntimeEventInput,
  validationResult?: CapabilityValidationResultRef,
): SelectedCapabilityRef[] {
  const selected: SelectedCapabilityRef[] = [{
    id: input.skill.id,
    kind: capabilityKindForSkill(input.skill),
    providerId: input.skill.id,
    role: 'primary',
    ...(input.skill.manifestPath ? { contractRef: input.skill.manifestPath } : {}),
  }];
  if (validationResult) {
    selected.push({
      id: validationResult.validatorId ?? 'sciforge.payload-validation',
      kind: 'verifier',
      providerId: 'sciforge.workspace-runtime',
      role: 'validator',
    });
  }
  if (input.repairAttempt) {
    selected.push({
      id: 'sciforge.agentserver.repair-rerun',
      kind: 'tool',
      providerId: 'sciforge.workspace-runtime',
      role: 'repair',
    });
  }
  return selected;
}

function fallbackCapabilitiesForEvent(input: CapabilityEvolutionRuntimeEventInput): SelectedCapabilityRef[] {
  const fallback: SelectedCapabilityRef[] = [{
    id: 'sciforge.generated-task-runner',
    kind: 'tool',
    providerId: 'sciforge.workspace-runtime',
    role: 'fallback',
  }];
  if (input.repairAttempt) {
    fallback.push({
      id: 'sciforge.agentserver.repair-rerun',
      kind: 'tool',
      providerId: 'sciforge.workspace-runtime',
      role: 'repair',
    });
  }
  return fallback;
}

function finalStatusForCapabilityEvent(input: CapabilityEvolutionRuntimeEventInput): CapabilityEvolutionRecordStatus {
  if (input.repairAttempt?.status === 'succeeded') return 'repair-succeeded';
  if (input.repairAttempt?.status === 'failed') return 'repair-failed';
  if (input.schemaErrors?.length || input.failureReason) return 'repair-failed';
  if (typeof input.run?.exitCode === 'number' && input.run.exitCode !== 0) return 'failed';
  return 'succeeded';
}

function composedStatusForRecord(status: CapabilityEvolutionRecordStatus) {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'fallback-succeeded') return 'fallback-succeeded';
  if (status === 'fallback-failed') return 'fallback-failed';
  if (status === 'repair-succeeded') return 'repair-succeeded';
  if (status === 'needs-human') return 'needs-human';
  return 'failed';
}

function validationResultForCapabilityEvent(
  input: CapabilityEvolutionRuntimeEventInput,
  failureCode?: string,
): CapabilityValidationResultRef | undefined {
  if (!input.schemaErrors?.length && !input.failureReason) return input.repairAttempt?.validationResult;
  return {
    verdict: input.repairAttempt?.status === 'succeeded' ? 'pass' : 'fail',
    validatorId: input.schemaErrors?.length ? 'sciforge.payload-schema' : 'sciforge.runtime-guard',
    summary: compactText(input.schemaErrors?.length ? input.schemaErrors.join('; ') : input.failureReason ?? '', 360),
    ...(failureCode ? { failureCode } : {}),
    ...(input.outputRel ? { resultRef: input.outputRel } : {}),
  };
}

function failureCodeForCapabilityEvent(input: CapabilityEvolutionRuntimeEventInput) {
  const text = `${input.failureReason ?? ''} ${(input.schemaErrors ?? []).join(' ')}`;
  if (input.schemaErrors?.length || /schema|contract|payload|validation/i.test(text)) return 'schema-invalid';
  if (/timeout|timed out|cancelled/i.test(text)) return 'timeout';
  if (/missing artifact|artifact/i.test(text)) return 'missing-artifact';
  if (/provider|base url|AgentServer|ECONNREFUSED|429|rate/i.test(text)) return 'provider-unavailable';
  if (typeof input.run?.exitCode === 'number' && input.run.exitCode !== 0) return 'execution-failed';
  if (/confidence/i.test(text)) return 'low-confidence';
  return input.failureReason ? 'validation-failed' : undefined;
}

function fallbackTriggersForEvent(failureCode?: string): CapabilityFallbackTrigger[] {
  const allowed: CapabilityFallbackTrigger[] = [
    'schema-invalid',
    'validation-failed',
    'provider-unavailable',
    'timeout',
    'missing-artifact',
    'execution-failed',
    'low-confidence',
    'policy',
  ];
  return allowed.includes(failureCode as CapabilityFallbackTrigger) ? [failureCode as CapabilityFallbackTrigger] : ['validation-failed'];
}

function recoverActionsForCapabilityEvent(
  input: CapabilityEvolutionRuntimeEventInput,
  finalStatus: CapabilityEvolutionRecordStatus,
) {
  if (finalStatus === 'repair-succeeded') return ['record-repair-completion', 'preserve-compact-ledger-summary-ref'];
  if (input.schemaErrors?.length) return ['repair-output-schema', 'preserve-output-ref', 'rerun-generated-task'];
  if (typeof input.run?.exitCode === 'number' && input.run.exitCode !== 0) return ['inspect-stderr-ref', 'repair-generated-task', 'rerun-generated-task'];
  return ['preserve-runtime-evidence-refs', 'retry-with-compact-context'];
}

function executionUnitRefsForCapabilityEvent(input: CapabilityEvolutionRuntimeEventInput) {
  const payloadRefs = Array.isArray(input.payload?.executionUnits)
    ? input.payload.executionUnits.flatMap((unit) => {
      const id = isRecord(unit) && typeof unit.id === 'string' ? unit.id : '';
      return id ? [`execution-unit:${id}`] : [];
    })
    : [];
  return uniqueNonEmptyStrings([
    `execution-unit:${input.taskId}`,
    ...payloadRefs,
    input.stdoutRel,
    input.stderrRel,
  ]);
}

function artifactRefsForCapabilityEvent(input: CapabilityEvolutionRuntimeEventInput) {
  const payloadRefs = Array.isArray(input.payload?.artifacts)
    ? input.payload.artifacts.flatMap((artifact) => {
      const id = isRecord(artifact) && typeof artifact.id === 'string' ? artifact.id : '';
      return id ? [`artifact:${id}`] : [];
    })
    : [];
  return uniqueNonEmptyStrings([
    ...payloadRefs,
    input.outputRel,
  ]);
}

function compactCapabilityEventMetadata(input: CapabilityEvolutionRuntimeEventInput): Record<string, unknown> {
  return {
    eventKind: input.repairAttempt ? 'repair-completion' : input.schemaErrors?.length ? 'validation-failure' : 'runtime-event',
    skillDomain: input.request.skillDomain,
    taskRef: input.taskRel,
    outputRef: input.outputRel,
    stdoutRef: input.stdoutRel,
    stderrRef: input.stderrRel,
    exitCode: input.run?.exitCode,
    failureReasonPreview: compactText(input.failureReason ?? '', 500),
    schemaErrorCount: input.schemaErrors?.length ?? 0,
    runtimeFingerprint: compactRuntimeFingerprint(input.run?.runtimeFingerprint),
  };
}

function compactRuntimeFingerprint(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 8)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
    } else if (typeof entry === 'string') {
      out[key] = compactText(entry, 120);
    } else if (typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function expectedArtifactRefs(request: GatewayRequest) {
  const fromRequest = Array.isArray(request.expectedArtifactTypes) ? request.expectedArtifactTypes : [];
  const fromUi = Array.isArray(request.uiState?.expectedArtifactTypes) ? request.uiState.expectedArtifactTypes : [];
  return uniqueStrings([...fromRequest, ...fromUi].filter((entry): entry is string => typeof entry === 'string').map((type) => `artifact-schema:${type}`));
}

function providerKindForSkill(skill: SkillAvailability) {
  if (/agentserver/i.test(skill.id) || /agentserver/i.test(skill.manifestPath ?? '')) return 'agent' as const;
  if (skill.kind === 'workspace') return 'local-runtime' as const;
  return 'package' as const;
}

function capabilityKindForSkill(skill: SkillAvailability) {
  if (/verifier/i.test(skill.id)) return 'verifier' as const;
  if (/tool|runner|agentserver/i.test(skill.id)) return 'tool' as const;
  return 'skill' as const;
}

function sessionIdForRequest(request: GatewayRequest) {
  const sessionId = request.uiState?.sessionId;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined;
}

function compactGoalSummary(text: string) {
  return compactText(text.replace(/\s+/g, ' ').trim(), 240) || 'Runtime capability event';
}

function compactText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueNonEmptyStrings(values: unknown[]) {
  return uniqueStrings(values.filter(isNonEmptyString));
}
