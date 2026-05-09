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
import { normalizeRuntimeVerificationResults } from './verification-results.js';

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

  const gatedPayload = gate.blocked ? failClosedPayload(payload, gate.reason, resultWithId, verificationRel) : payload;
  return attachVerificationRefs(gatedPayload, policy, resultWithId, verificationRel, artifact, nonBlocking);
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

function failClosedPayload(payload: ToolPayload, reason: string | undefined, result: VerificationResult, verificationRel: string): ToolPayload {
  const blockedReason = reason ?? result.critique ?? 'Verification gate blocked completion.';
  return {
    ...payload,
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
        requiredInputs: uniqueStrings([...toStringList(unit.requiredInputs), 'verifier result or human approval']),
        recoverActions: uniqueStrings([
          ...toStringList(unit.recoverActions),
          'Run a verifier or request human approval before treating this action as complete.',
        ]),
        nextStep: 'Provide a passing verifier result or explicit human approval, then rerun or continue.',
      };
    }),
  };
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
