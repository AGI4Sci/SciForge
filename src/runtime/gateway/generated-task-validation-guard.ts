import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
} from '@sciforge-ui/runtime-contract/capability-budget';
import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import {
  evaluateGuidanceAdoption,
  GUIDANCE_ADOPTION_GUARD_CONTRACT_ID,
  GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH,
  type GuidanceAdoptionFinding,
  validationFindingProjectionFromGuidanceAdoptionFinding,
} from './guidance-adoption-guard.js';
import {
  evaluateToolPayloadEvidence,
  type WorkEvidenceGuardFinding,
  validationFindingProjectionFromWorkEvidenceGuardFinding,
} from './work-evidence-guard.js';

export type GeneratedTaskGuardFinding =
  | { source: 'work-evidence'; finding: WorkEvidenceGuardFinding }
  | { source: 'guidance-adoption'; finding: GuidanceAdoptionFinding };

export function evaluateGeneratedTaskGuardFinding(payload: ToolPayload, request: GatewayRequest): GeneratedTaskGuardFinding | undefined {
  const guidanceFinding = evaluateGuidanceAdoption(payload, request);
  if (guidanceFinding) return { source: 'guidance-adoption', finding: guidanceFinding };
  const evidenceFinding = evaluateToolPayloadEvidence(payload, request);
  return evidenceFinding ? { source: 'work-evidence', finding: evidenceFinding } : undefined;
}

export function generatedTaskGuardFindingProjection(
  guardFinding: GeneratedTaskGuardFinding,
  chainId: string,
  relatedRefs: string[],
): ValidationFindingProjectionInput {
  if (guardFinding.source === 'guidance-adoption') {
    return validationFindingProjectionFromGuidanceAdoptionFinding(guardFinding.finding, {
      id: `${chainId}:guidance-adoption`,
      capabilityId: 'sciforge.validation-guard',
      relatedRefs,
    });
  }
  return validationFindingProjectionFromWorkEvidenceGuardFinding(guardFinding.finding, {
    id: `${chainId}:work-evidence:${guardFinding.finding.kind}`,
    capabilityId: 'sciforge.validation-guard',
    relatedRefs,
  });
}

export function generatedTaskGuardChainId(
  skill: SkillAvailability,
  refs: RuntimeRefBundle & { inputRel?: string },
  guardFinding: GeneratedTaskGuardFinding,
) {
  const guardKind = guardFinding.source === 'work-evidence'
    ? guardFinding.finding.kind
    : `${guardFinding.finding.missingIds.join(',')}:${guardFinding.finding.invalidIds.join(',')}`;
  return `validation-guard:${sha1([
    skill.id,
    guardFinding.source,
    guardKind,
    refs.outputRel,
    refs.taskRel,
  ].filter(Boolean).join(':')).slice(0, 12)}`;
}

export function generatedTaskGuardRelatedRefs(input: {
  refs: RuntimeRefBundle & { inputRel?: string };
  request: GatewayRequest;
}, payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  return uniqueStrings([
    input.refs.taskRel,
    input.refs.inputRel,
    input.refs.outputRel,
    input.refs.stdoutRel,
    input.refs.stderrRel,
    ...generatedTaskCurrentRefs(input.request),
    ...generatedTaskPayloadArtifactRefs(payload),
    ...units.flatMap((unit) => isRecord(unit)
      ? [
          stringField(unit.id) ? `executionUnit:${stringField(unit.id)}` : undefined,
          stringField(unit.codeRef),
          stringField(unit.inputRef),
          stringField(unit.outputRef),
          stringField(unit.stdoutRef),
          stringField(unit.stderrRef),
        ]
      : []),
  ]);
}

export function generatedTaskPayloadArtifactRefs(payload: ToolPayload) {
  return uniqueStrings([
    ...payload.artifacts.map((artifact) => isRecord(artifact) ? stringField(artifact.id) ?? stringField(artifact.ref) : undefined),
    ...payload.uiManifest.map((slot) => isRecord(slot) ? stringField(slot.artifactRef) : undefined),
  ]);
}

export function generatedTaskCurrentRefs(request: GatewayRequest) {
  const references = Array.isArray(request.references) ? request.references : [];
  const currentReferences = isRecord(request.uiState) && Array.isArray(request.uiState.currentReferences)
    ? request.uiState.currentReferences
    : [];
  return uniqueStrings([...references, ...currentReferences].map((reference) => isRecord(reference) ? stringField(reference.ref) : undefined));
}

export function validationSubjectKindForGeneratedTaskGuardRefs(refs: RuntimeRefBundle) {
  return refs.taskRel.startsWith('agentserver://') ? 'direct-payload' : 'generated-task-result';
}

export function generatedTaskRefForGeneratedTaskGuardRefs(refs: RuntimeRefBundle) {
  return refs.taskRel.startsWith('agentserver://') ? undefined : refs.taskRel;
}

export function attachGeneratedTaskGuardBudgetDebit(
  payload: ToolPayload,
  input: {
    skill: SkillAvailability;
    refs: RuntimeRefBundle & { inputRel?: string };
  },
  guardFinding: GeneratedTaskGuardFinding,
  chainId: string,
  auditId: string,
): ToolPayload {
  const debitId = `budgetDebit:${chainId}`;
  if ((payload.budgetDebits ?? []).some((debit) => debit.debitId === debitId)) return payload;
  const executionUnitRef = firstPayloadExecutionUnitId(payload);
  const logRef = `audit:validation-guard-budget-debit:${sha1(chainId).slice(0, 12)}`;
  const payloadRefs = isRecord((payload as ToolPayload & { refs?: unknown }).refs)
    ? (payload as ToolPayload & { refs?: Record<string, unknown> }).refs
    : {};
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:${chainId}`,
    capabilityId: 'sciforge.validation-guard',
    candidateId: `validator.sciforge.${guardFinding.source}`,
    manifestRef: 'capability:verifier.validation-guard',
    subjectRefs: uniqueStrings([
      input.refs.taskRel,
      input.refs.inputRel,
      input.refs.outputRel,
      input.refs.stdoutRel,
      input.refs.stderrRel,
      auditId,
    ]),
    debitLines: generatedTaskGuardBudgetDebitLines(guardFinding),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs: [`validation-repair-audit:${chainId}`],
      auditRefs: [
        auditId,
        `appendTaskAttempt:${chainId}`,
        `ledger:${chainId}`,
        logRef,
      ],
    },
    metadata: {
      guardedCapabilityId: input.skill.id,
      guardSource: guardFinding.source,
      guardKind: guardFinding.source === 'work-evidence' ? guardFinding.finding.kind : 'guidance-adoption',
      contractId: guardFinding.source === 'work-evidence'
        ? 'sciforge.work-evidence.v1'
        : GUIDANCE_ADOPTION_GUARD_CONTRACT_ID,
      schemaPath: guardFinding.source === 'work-evidence'
        ? undefined
        : GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH,
    },
  });
  const budgetDebitRefs = [debit.debitId];
  return {
    ...payload,
    refs: {
      ...payloadRefs,
      budgetDebits: uniqueStrings([
        ...stringList(payloadRefs?.budgetDebits),
        ...budgetDebitRefs,
      ]),
    },
    budgetDebits: [
      ...(payload.budgetDebits ?? []),
      debit,
    ],
    executionUnits: payload.executionUnits.map((unit) => isRecord(unit)
      ? attachBudgetDebitRefs(unit, budgetDebitRefs)
      : unit),
    workEvidence: Array.isArray(payload.workEvidence)
      ? payload.workEvidence.map((entry) => isRecord(entry)
        ? attachBudgetDebitRefs(entry, budgetDebitRefs) as unknown as typeof entry
        : entry)
      : payload.workEvidence,
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'capability-budget-debit-audit',
        ref: logRef,
        capabilityId: 'sciforge.validation-guard',
        guardSource: guardFinding.source,
        validationFailureKind: guardFinding.source === 'work-evidence' ? 'work-evidence' : 'guidance-adoption',
        budgetDebitRefs,
      },
    ],
  } as ToolPayload;
}

export function payloadHasValidationRepairAudit(payload: ToolPayload, auditId: string) {
  const candidates: unknown[] = [payload];
  if (Array.isArray(payload.executionUnits)) candidates.push(...payload.executionUnits);
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const refs = isRecord(candidate.refs) ? candidate.refs : {};
    for (const chain of [candidate.validationRepairAudit, refs.validationRepairAudit]) {
      if (!isRecord(chain)) continue;
      const audit = isRecord(chain.auditRecord) ? chain.auditRecord : isRecord(chain.audit) ? chain.audit : undefined;
      if (audit && stringField(audit.auditId) === auditId) return true;
    }
  }
  return false;
}

function generatedTaskGuardBudgetDebitLines(guardFinding: GeneratedTaskGuardFinding): CapabilityBudgetDebitLine[] {
  const resultItems = guardFinding.source === 'guidance-adoption'
    ? Math.max(1, guardFinding.finding.missingIds.length + guardFinding.finding.invalidIds.length)
    : 1;
  return [
    {
      dimension: 'costUnits',
      amount: 1,
      reason: `${guardFinding.source} validation guard`,
      sourceRef: guardFinding.source === 'guidance-adoption'
        ? GUIDANCE_ADOPTION_GUARD_CONTRACT_ID
        : 'sciforge.work-evidence.v1',
    },
    {
      dimension: 'resultItems',
      amount: resultItems,
      reason: 'guard findings',
      sourceRef: guardFinding.source === 'guidance-adoption'
        ? GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH
        : 'packages/contracts/runtime/work-evidence-policy.ts#evaluateWorkEvidencePolicy',
    },
  ];
}

function firstPayloadExecutionUnitId(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const id = stringField(unit.id);
    if (id) return id;
  }
  return undefined;
}

function attachBudgetDebitRefs<T extends Record<string, unknown>>(record: T, refs: string[]): T & {
  budgetDebitRefs: string[];
  refs: Record<string, unknown>;
} {
  return {
    ...record,
    budgetDebitRefs: uniqueStrings([
      ...stringList(record.budgetDebitRefs),
      ...refs,
    ]),
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      budgetDebits: uniqueStrings([
        ...stringList(isRecord(record.refs) ? record.refs.budgetDebits : undefined),
        ...refs,
      ]),
    },
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
