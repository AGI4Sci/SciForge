import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { GatewayRequest, ToolPayload, VerificationPolicy, VerificationResult, VerificationRiskLevel, VerificationVerdict } from '../runtime-types.js';
import { clipForAgentServerJson, isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { normalizeRuntimeVerificationResults } from './verification-results.js';

export async function applyRuntimeVerificationPolicy(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
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
  await mkdir(dirname(join(workspace, verificationRel)), { recursive: true });
  await writeFile(join(workspace, verificationRel), JSON.stringify({
    schemaVersion: 'sciforge.verification-result.v1',
    policy,
    result: resultWithId,
  }, null, 2), 'utf8');

  const artifact = verificationArtifact(resultWithId, policy, verificationRel);
  const gatedPayload = gate.blocked ? failClosedPayload(payload, gate.reason, resultWithId, verificationRel) : payload;
  return attachVerificationRefs(gatedPayload, policy, resultWithId, verificationRel, artifact);
}

export function normalizeRuntimeVerificationPolicy(
  request: GatewayRequest,
  payload?: ToolPayload,
): VerificationPolicy {
  const explicit = request.verificationPolicy ?? (isRecord(payload?.verificationPolicy) ? payload?.verificationPolicy : undefined);
  const riskLevel = explicit?.riskLevel ?? inferVerificationRiskLevel(request, payload);
  const selectedVerifierIds = uniqueStrings([
    ...(request.selectedVerifierIds ?? []),
    ...(explicit?.selectedVerifierIds ?? []),
    ...toStringList(request.uiState?.selectedVerifierIds),
  ]);
  if (explicit) {
    return {
      ...explicit,
      riskLevel,
      selectedVerifierIds,
      required: riskLevel === 'high' ? true : explicit.required,
      mode: riskLevel === 'high' && explicit.mode === 'none' ? 'hybrid' : explicit.mode,
      humanApprovalPolicy: riskLevel === 'high'
        ? (explicit.humanApprovalPolicy === 'none' ? 'required' : explicit.humanApprovalPolicy ?? 'required')
        : explicit.humanApprovalPolicy,
    };
  }
  return {
    required: riskLevel === 'high',
    mode: riskLevel === 'high' ? 'hybrid' : 'lightweight',
    riskLevel,
    reason: riskLevel === 'high'
      ? 'Runtime inferred a high-risk action; verifier or explicit human approval is required.'
      : 'No strong verifier was selected; runtime records an explicit unverified result instead of treating it as pass.',
    selectedVerifierIds,
    humanApprovalPolicy: riskLevel === 'high' ? 'required' : 'optional',
  };
}

export function evaluateVerificationGate(
  payload: ToolPayload,
  request: GatewayRequest,
  policy: VerificationPolicy,
  providedResults: VerificationResult[] = [],
): { blocked: boolean; reason?: string; result: VerificationResult } {
  const decisive = mostDecisiveVerificationResult(providedResults);
  const approval = normalizeHumanApproval(request.humanApproval ?? request.uiState?.humanApproval);
  const highRiskAction = policy.riskLevel === 'high' || hasHighRiskActionSignal(request, payload);
  if (decisive?.verdict === 'pass') return { blocked: false, result: decisive };
  if (approval?.approved) {
    return {
      blocked: false,
      result: {
        id: decisive?.id,
        verdict: 'pass',
        reward: 1,
        confidence: 0.9,
        critique: 'Human approval satisfied the verification gate.',
        evidenceRefs: uniqueStrings([approval.ref, ...(decisive?.evidenceRefs ?? [])].filter((value): value is string => typeof value === 'string' && value.length > 0)),
        repairHints: decisive?.repairHints ?? [],
        diagnostics: { source: 'human-approval', approval },
      },
    };
  }
  if (highRiskAction && actionProviderSelfReportsSuccess(payload)) {
    const reason = policy.selectedVerifierIds?.length
      ? 'High-risk action did not receive a passing verifier result or explicit human approval.'
      : 'High-risk action has no verifier or explicit human approval; action provider self-reported success cannot close the run.';
    return {
      blocked: true,
      reason,
      result: decisive ?? {
        verdict: policy.selectedVerifierIds?.length ? 'fail' : 'needs-human',
        reward: -1,
        confidence: 0.98,
        critique: reason,
        evidenceRefs: executionUnitRefs(payload),
        repairHints: [
          'Attach a verifier result with verdict=pass, or collect explicit human approval before marking the high-risk action complete.',
          'If no verifier exists, return needs-human instead of a successful action payload.',
        ],
        diagnostics: {
          riskLevel: 'high',
          selectedVerifierIds: policy.selectedVerifierIds ?? [],
          actionProviderSelfReportedSuccess: true,
        },
      },
    };
  }
  if (decisive) return { blocked: policy.required, result: decisive };
  return {
    blocked: false,
    result: {
      verdict: 'unverified',
      reward: 0,
      confidence: 0,
      critique: policy.reason,
      evidenceRefs: executionUnitRefs(payload),
      repairHints: policy.required ? ['Run an appropriate verifier or request human approval.'] : [],
      diagnostics: {
        riskLevel: policy.riskLevel,
        mode: policy.mode,
        required: policy.required,
        visibleUnverified: true,
      },
    },
  };
}

function attachVerificationRefs(
  payload: ToolPayload,
  policy: VerificationPolicy,
  result: VerificationResult,
  verificationRel: string,
  verificationArtifactRecord: Record<string, unknown>,
): ToolPayload {
  return {
    ...payload,
    message: result.verdict === 'unverified' || result.verdict === 'needs-human' || result.verdict === 'fail'
      ? `${payload.message}\n\nVerification: ${result.verdict}. ${result.critique ?? policy.reason}`
      : payload.message,
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

function verificationArtifact(result: VerificationResult, policy: VerificationPolicy, verificationRel: string): Record<string, unknown> {
  return {
    id: result.id ?? 'verification-result',
    type: 'verification-result',
    dataRef: verificationRel,
    schemaVersion: 'sciforge.verification-result.v1',
    metadata: {
      verdict: result.verdict,
      policy: `${policy.mode}/${policy.riskLevel}`,
      visible: true,
      unverifiedIsNotPass: result.verdict === 'unverified' ? true : undefined,
    },
    data: { result, policy },
  };
}

function mostDecisiveVerificationResult(results: VerificationResult[]) {
  return results.find((result) => result.verdict === 'fail')
    ?? results.find((result) => result.verdict === 'needs-human')
    ?? results.find((result) => result.verdict === 'pass')
    ?? results.find((result) => result.verdict === 'uncertain')
    ?? results.find((result) => result.verdict === 'unverified');
}

function normalizeHumanApproval(value: unknown): { approved: boolean; ref?: string; by?: string; at?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const approved = value.approved === true || value.status === 'approved' || value.verdict === 'approved' || value.decision === 'accept';
  return {
    approved,
    ref: typeof value.ref === 'string' ? value.ref : typeof value.approvalRef === 'string' ? value.approvalRef : undefined,
    by: typeof value.by === 'string' ? value.by : undefined,
    at: typeof value.at === 'string' ? value.at : typeof value.approvedAt === 'string' ? value.approvedAt : undefined,
  };
}

function inferVerificationRiskLevel(request: GatewayRequest, payload?: ToolPayload): VerificationRiskLevel {
  const candidates = [
    request.uiState?.riskLevel,
    request.uiState?.actionRiskLevel,
    request.uiState?.safetyPolicy,
    request.uiState?.capabilityBrief,
    ...toRecordList(request.uiState?.selectedActions),
    ...toRecordList(payload?.executionUnits),
  ];
  if (candidates.some((candidate) => recordOrTextIncludesRisk(candidate, 'high'))) return 'high';
  if (candidates.some((candidate) => recordOrTextIncludesRisk(candidate, 'medium'))) return 'medium';
  return highRiskPromptSignal(request.prompt) ? 'high' : 'low';
}

function hasHighRiskActionSignal(request: GatewayRequest, payload: ToolPayload) {
  return inferVerificationRiskLevel(request, payload) === 'high';
}

function recordOrTextIncludesRisk(value: unknown, risk: VerificationRiskLevel) {
  if (value === risk) return true;
  if (typeof value === 'string') return value.toLowerCase() === risk;
  if (!isRecord(value)) return false;
  const clipped = JSON.stringify(clipForAgentServerJson(value, 3)).toLowerCase();
  return clipped.includes(`"risklevel":"${risk}"`)
    || clipped.includes(`"risk_level":"${risk}"`)
    || clipped.includes(`"risk":"${risk}"`);
}

function highRiskPromptSignal(prompt: string) {
  return /\b(delete|remove|destroy|drop|publish|send|pay|purchase|authorize|credential|secret|external system|production)\b|删除|发布|发送|支付|授权|凭据|生产环境/.test(prompt.toLowerCase());
}

function actionProviderSelfReportsSuccess(payload: ToolPayload) {
  return payload.executionUnits.some((unit) => isRecord(unit) && isSuccessfulStatus(unit.status) && looksLikeActionProvider(unit));
}

function looksLikeActionProvider(unit: Record<string, unknown>) {
  const text = [
    unit.tool,
    unit.provider,
    unit.routeDecision,
    unit.params,
    unit.environment,
  ].map((value) => typeof value === 'string' ? value : JSON.stringify(clipForAgentServerJson(value, 2))).join('\n').toLowerCase();
  return /action|computer-use|vision-sense|gui|browser|desktop|mouse|keyboard|executor|external|send|delete|publish|authorize|pay/.test(text);
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

function executionUnitRefs(payload: ToolPayload) {
  return payload.executionUnits
    .filter(isRecord)
    .map((unit) => typeof unit.id === 'string' ? `execution-unit:${unit.id}` : undefined)
    .filter((value): value is string => Boolean(value));
}
