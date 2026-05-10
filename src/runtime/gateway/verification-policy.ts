import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createRuntimeVerificationArtifact,
  evaluateRuntimeVerificationGate,
  normalizeRuntimeVerificationPolicy as normalizeRuntimeVerificationPolicyFromContract,
  verificationIsNonBlocking,
} from '@sciforge-ui/runtime-contract/verification-policy';
import type { GatewayRequest, ToolPayload, VerificationPolicy, VerificationResult, VerificationVerdict } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { resolveWorkspaceFileRefPath } from '../workspace-paths.js';
import { createValidationRepairAuditChain, type ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';
import { contractValidationFailureFromVerificationResults, normalizeRuntimeVerificationResults } from './verification-results.js';

const RUNTIME_VERIFICATION_GATE_CAPABILITY_ID = 'sciforge.runtime-verification-gate';

export async function applyRuntimeVerificationPolicy(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const nonBlocking = verificationIsNonBlocking(request, policy);
  const provided = normalizeRuntimeVerificationResults([
    ...(payload.verificationResults ?? []),
    (payload as unknown as Record<string, unknown>).verificationResult,
    ...toRecordList(request.uiState?.verificationResults),
  ]);
  const gate = evaluateVerificationGate(payload, request, policy, provided);
  const result = gate.result;
  const workspace = resolve(request.workspacePath || process.cwd());
  const resultId = result.id ?? `verification-${sha1(`${request.prompt}:${Date.now()}:${result.verdict}`).slice(0, 12)}`;
  const resultWithId = { ...result, id: resultId };
  const verificationRel = `.sciforge/verifications/${resultId}.json`;
  const artifact = createRuntimeVerificationArtifact(resultWithId, policy, verificationRel, nonBlocking);
  await mkdir(dirname(join(workspace, verificationRel)), { recursive: true });
  await writeFile(join(workspace, verificationRel), JSON.stringify({
    schemaVersion: artifact.schemaVersion,
    policy,
    result: resultWithId,
  }, null, 2), 'utf8');

  const gateAudit = gate.blocked
    ? validationRepairAuditForVerificationGate(payload, request, policy, resultWithId, verificationRel)
    : undefined;
  const gatedPayload = gate.blocked ? failClosedPayload(payload, gate.reason, resultWithId, verificationRel, gateAudit) : payload;
  const verifiedPayload = attachVerificationRefs(gatedPayload, policy, resultWithId, verificationRel, artifact, nonBlocking);
  if (gate.blocked) {
    await persistVerificationGatedPayloadIfPossible(workspace, verifiedPayload);
  }
  return verifiedPayload;
}

export function normalizeRuntimeVerificationPolicy(
  request: GatewayRequest,
  payload?: ToolPayload,
): VerificationPolicy {
  return normalizeRuntimeVerificationPolicyFromContract(request, payload) as VerificationPolicy;
}

export function evaluateVerificationGate(
  payload: ToolPayload,
  request: GatewayRequest,
  policy: VerificationPolicy,
  providedResults: VerificationResult[] = [],
): { blocked: boolean; reason?: string; result: VerificationResult } {
  return evaluateRuntimeVerificationGate(payload, request, policy, providedResults) as { blocked: boolean; reason?: string; result: VerificationResult };
}

function attachVerificationRefs(
  payload: ToolPayload,
  policy: VerificationPolicy,
  result: VerificationResult,
  verificationRel: string,
  verificationArtifactRecord: Record<string, unknown>,
  nonBlocking = false,
): ToolPayload {
  return {
    ...payload,
    reasoningTrace: [
      payload.reasoningTrace,
      `Verification result: ${result.verdict}; ref=${verificationRel}; policy=${policy.mode}/${policy.riskLevel}.`,
    ].filter(Boolean).join('\n'),
    verificationPolicy: policy,
    verificationResults: [result],
    artifacts: [
      ...payload.artifacts.map((artifact) => isRecord(artifact) ? attachRefToRecord(artifact, verificationRel) : artifact),
      verificationArtifactRecord,
    ],
    executionUnits: payload.executionUnits.map((unit) => isRecord(unit) ? attachRefToRecord(unit, verificationRel, result.verdict) : unit),
    objectReferences: [
      ...(payload.objectReferences ?? []),
      { id: result.id ?? 'verification-result', kind: 'verification-result', ref: `file:${verificationRel}`, label: `Verification ${result.verdict}` },
    ],
    displayIntent: {
      ...(isRecord(payload.displayIntent) ? payload.displayIntent : {}),
      verification: {
        verdict: result.verdict,
        ref: verificationRel,
        visible: true,
        nonBlocking,
      },
    },
  };
}

function failClosedPayload(
  payload: ToolPayload,
  reason: string | undefined,
  result: VerificationResult,
  verificationRel: string,
  gateAudit?: VerificationGateAuditProjection,
): ToolPayload {
  const blockedReason = reason ?? result.critique ?? 'Verification gate blocked completion.';
  const failedPayload = {
    ...payload,
    refs: {
      ...topLevelRefs(payload),
      ...verificationGateAuditRefs(gateAudit),
    },
    confidence: Math.min(payload.confidence, 0.35),
    claimType: String(payload.claimType || '').includes('error') ? payload.claimType : 'verification-gated',
    evidenceLevel: 'verification-required',
    claims: [
      ...payload.claims,
      {
        text: blockedReason,
        type: 'failure',
        confidence: 0.98,
        evidenceLevel: 'runtime-verification',
        supportingRefs: [verificationRel],
        opposingRefs: [],
      },
    ],
    executionUnits: payload.executionUnits.map((unit) => {
      if (!isRecord(unit) || !isSuccessfulStatus(unit.status)) return unit;
      return {
        ...unit,
        status: result.verdict === 'needs-human' ? 'needs-human' : 'failed-with-reason',
        failureReason: blockedReason,
        verificationRef: verificationRel,
        refs: {
          ...(isRecord(unit.refs) ? unit.refs : {}),
          ...verificationGateAuditRefs(gateAudit),
        },
        requiredInputs: uniqueStrings([...toStringList(unit.requiredInputs), 'verifier result or human approval']),
        recoverActions: uniqueStrings([
          ...toStringList(unit.recoverActions),
          'Run a verifier or request human approval before treating this action as complete.',
        ]),
        nextStep: 'Provide a passing verifier result or explicit human approval, then rerun or continue.',
      };
    }),
  } as ToolPayload & { refs?: Record<string, unknown> };
  return failedPayload;
}

function isSuccessfulStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  return status === 'done' || status === 'self-healed';
}

function attachRefToRecord(record: Record<string, unknown>, verificationRel: string, verdict?: VerificationVerdict) {
  return {
    ...record,
    verificationRef: verificationRel,
    verificationVerdict: verdict,
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      verificationResult: verificationRel,
    },
  };
}

interface VerificationGateAuditProjection {
  validationFailure?: ReturnType<typeof contractValidationFailureFromVerificationResults>;
  chain: ValidationRepairAuditChain;
}

function validationRepairAuditForVerificationGate(
  payload: ToolPayload,
  request: GatewayRequest,
  policy: VerificationPolicy,
  result: VerificationResult,
  verificationRel: string,
): VerificationGateAuditProjection {
  const relatedRefs = verificationGateRelatedRefs(payload, request, verificationRel, result);
  const outputRef = firstExecutionUnitString(payload, 'outputRef');
  const chainId = `verification-gate:${sha1([
    request.skillDomain,
    request.prompt,
    policy.mode,
    policy.riskLevel,
    result.id,
    result.verdict,
    outputRef,
    verificationRel,
  ].filter(Boolean).join(':')).slice(0, 12)}`;
  const chain = createValidationRepairAuditChain({
    chainId,
    subject: {
      kind: 'verification-gate',
      id: result.id ?? chainId,
      capabilityId: RUNTIME_VERIFICATION_GATE_CAPABILITY_ID,
      contractId: 'sciforge.verification-result.v1',
      schemaPath: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
      completedPayloadRef: outputRef,
      generatedTaskRef: firstExecutionUnitString(payload, 'codeRef'),
      artifactRefs: uniqueStrings([
        verificationRel,
        ...payload.artifacts.flatMap((artifact) => artifactRefsFromRecord(artifact)),
      ]),
      currentRefs: currentReferenceRefs(request),
    },
    runtimeVerificationResults: [result],
    runtimeVerificationPolicyId: `runtime-verification:${policy.mode}:${policy.riskLevel}`,
    relatedRefs,
    sinkRefs: [
      `appendTaskAttempt:${chainId}`,
      `verification-artifact:${verificationRel}`,
    ],
    telemetrySpanRefs: [
      `span:verification-gate:${chainId}`,
      `span:repair-decision:${chainId}`,
    ],
  });
  return {
    validationFailure: contractValidationFailureFromVerificationResults(result, {
      capabilityId: RUNTIME_VERIFICATION_GATE_CAPABILITY_ID,
      relatedRefs,
    }),
    chain,
  };
}

function verificationGateAuditRefs(projection: VerificationGateAuditProjection | undefined) {
  if (!projection) return {};
  return {
    ...(projection.validationFailure ? { validationFailure: projection.validationFailure } : {}),
    validationRepairAudit: {
      validationDecision: projection.chain.validation,
      repairDecision: projection.chain.repair,
      auditRecord: projection.chain.audit,
    },
  };
}

function topLevelRefs(payload: ToolPayload) {
  const refs = (payload as ToolPayload & { refs?: unknown }).refs;
  return isRecord(refs) ? refs : {};
}

function verificationGateRelatedRefs(
  payload: ToolPayload,
  request: GatewayRequest,
  verificationRel: string,
  result: VerificationResult,
) {
  return uniqueStrings([
    verificationRel,
    `file:${verificationRel}`,
    ...result.evidenceRefs,
    ...currentReferenceRefs(request),
    ...payload.executionUnits.flatMap((unit) => isRecord(unit) ? [
      stringField(unit.codeRef) ?? '',
      stringField(unit.outputRef) ?? '',
      stringField(unit.stdoutRef) ?? '',
      stringField(unit.stderrRef) ?? '',
      stringField(unit.verificationRef) ?? '',
    ] : []),
    ...payload.artifacts.flatMap((artifact) => artifactRefsFromRecord(artifact)),
  ]);
}

function currentReferenceRefs(request: GatewayRequest) {
  const refs = Array.isArray(request.uiState?.currentReferences)
    ? request.uiState.currentReferences
    : [];
  return refs
    .filter(isRecord)
    .map((reference) => stringField(reference.ref))
    .filter((ref): ref is string => Boolean(ref));
}

function artifactRefsFromRecord(record: Record<string, unknown>) {
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return [
    stringField(record.dataRef),
    stringField(record.ref),
    stringField(record.path),
    stringField(record.rawRef),
    stringField(metadata.artifactRef),
    stringField(metadata.outputRef),
  ].filter((ref): ref is string => Boolean(ref));
}

function firstExecutionUnitString(payload: ToolPayload, key: string) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const value = stringField(unit[key]);
    if (value) return value;
  }
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

async function persistVerificationGatedPayloadIfPossible(workspace: string, payload: ToolPayload) {
  const outputRef = firstExecutionUnitString(payload, 'outputRef');
  if (!outputRef) return;
  let outputPath: string | undefined;
  try {
    outputPath = resolveWorkspaceFileRefPath(outputRef, workspace);
  } catch {
    return;
  }
  if (!outputPath) return;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
}
