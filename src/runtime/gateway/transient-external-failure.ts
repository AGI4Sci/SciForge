import { createHash } from 'node:crypto';

import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';

const TRANSIENT_EXTERNAL_FAILURE_CODES = new Set([
  'transient-unavailable',
  'external-transient',
  'external-dependency-transient',
  'rate-limited',
  'quota-exceeded',
  'network-timeout',
  'service-unavailable',
  'temporary-unavailable',
]);
const transientUnavailableStatus = 'transient-unavailable';
const reportViewerComponentId = ['report', 'viewer'].join('-');
const executionUnitTableComponentId = ['execution', 'unit', 'table'].join('-');
const workspaceRuntimeGatewayToolId = ['sciforge', 'workspace-runtime-gateway'].join('.');

type PayloadWorkEvidence = NonNullable<ToolPayload['workEvidence']>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function failureReason(unit: Record<string, unknown>) {
  return stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message);
}

function isFailureStatus(value: unknown) {
  return /failed|error/i.test(String(value || ''));
}

function payloadHasReadableArtifact(payload: ToolPayload) {
  return payload.artifacts.some((artifact) => {
    if (!isRecord(artifact)) return false;
    return Boolean(
      stringField(artifact.dataRef)
      || stringField(artifact.content)
      || stringField(artifact.title)
      || isRecord(artifact.data),
    );
  });
}

export function isTransientExternalFailure(reason: string | undefined) {
  const normalized = normalizeFailureCode(reason);
  return Boolean(normalized && TRANSIENT_EXTERNAL_FAILURE_CODES.has(normalized));
}

export function externalFailureRecoverActions(reason: string) {
  return [
    `External provider appears transiently unavailable: ${reason}`,
    'Retry after provider backoff or rate-limit reset.',
    'Use cached/mirrored evidence if available, and label freshness/coverage explicitly.',
    'For partial multi-fetch runs, keep already downloaded full text and metadata refs; continue the partial report from those refs before repeating failed downloads.',
  ];
}

function stableId(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function retryAfterMsFromText(text: string) {
  const match = text.match(/\bretry[-\s]?after\b[^\d]{0,12}(\d+)\s*(ms|millisecond|milliseconds|s|sec|second|seconds|m|min|minute|minutes)?/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = (match[2] || 's').toLowerCase();
  if (unit.startsWith('m') && unit !== 'ms' && !unit.startsWith('milli')) return amount * 60_000;
  if (unit === 'ms' || unit.startsWith('milli')) return amount;
  return amount * 1000;
}

function transientWorkEvidence(input: {
  id: string;
  kind?: string;
  provider?: string;
  skillDomain?: string;
  reason: string;
  stdoutRef?: string;
  stderrRef?: string;
  outputRef?: string;
  codeRef?: string;
  recoverActions: string[];
}): PayloadWorkEvidence {
  const evidenceRefs = uniqueStrings([input.stdoutRef, input.stderrRef]);
  return {
    id: `transient-external-${input.id}`,
    kind: input.kind ?? defaultExternalWorkKind(input.skillDomain),
    status: 'failed-with-reason',
    provider: input.provider,
    input: uniqueObject({
      skillDomain: input.skillDomain,
      codeRef: input.codeRef,
      outputRef: input.outputRef,
    }),
    outputSummary: 'External dependency was transiently unavailable; runtime logs and partial artifacts were preserved for retry.',
    evidenceRefs,
    failureReason: input.reason,
    recoverActions: input.recoverActions,
    diagnostics: uniqueStrings([
      input.stdoutRef ? `stdoutRef=${input.stdoutRef}` : undefined,
      input.stderrRef ? `stderrRef=${input.stderrRef}` : undefined,
      input.outputRef ? `outputRef=${input.outputRef}` : undefined,
    ]),
    rawRef: input.outputRef,
  };
}

function uniqueObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}

export function transientExternalFailureReasonFromRun(run: Pick<WorkspaceTaskRunResult, 'stderr' | 'stdout' | 'runtimeFingerprint'>) {
  const structured = structuredTransientExternalFailure(run.runtimeFingerprint)
    ?? structuredTransientExternalFailureFromJsonLines(run.stderr)
    ?? structuredTransientExternalFailureFromJsonLines(run.stdout);
  return structured?.reason;
}

export function firstTransientExternalFailureReason(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    if (unitHasStructuredTransientExternalFailure(unit)) return failureReason(unit) ?? transientUnavailableStatus;
    const reason = failureReason(unit);
    if (isTransientExternalFailure(reason)) return reason;
  }
  return undefined;
}

export function payloadHasOnlyTransientExternalDependencyFailures(payload: ToolPayload) {
  const problematicUnits = payload.executionUnits.filter((unit) => isRecord(unit)
    && /failed|error|repair-needed|needs-human/i.test(String(unit.status || ''))) as Array<Record<string, unknown>>;
  if (!problematicUnits.length) return false;
  return problematicUnits.every((unit) => unit.externalDependencyStatus === transientUnavailableStatus);
}

export function transientExternalDependencyPayload(input: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  reason: string;
}): ToolPayload {
  const id = stableId(`${input.skill.id}:${input.request.skillDomain}:${input.run.outputRef}:${input.reason}`);
  const message = '外部数据源暂时不可用，运行证据已保留；请稍后重试或提供缓存证据后继续。';
  const recoverActions = externalFailureRecoverActions(input.reason);
  const retryAfterMs = retryAfterMsFromText(input.reason);
  const providerAttemptRefs = uniqueStrings([input.run.stdoutRef, input.run.stderrRef]);
  const preservedRefs = uniqueStrings([input.run.stdoutRef, input.run.stderrRef, input.run.outputRef]);
  const diagnostic = [
    '# 外部依赖暂时不可用',
    '',
    `- 原因：${input.reason}`,
    `- 任务代码：${input.run.spec.taskRel}`,
    `- 标准输出：${input.run.stdoutRef}`,
    `- 标准错误：${input.run.stderrRef}`,
    `- 预期输出：${input.run.outputRef}`,
    '',
    '本次运行在写出结构化结果之前被外部服务的瞬时失败阻断。系统不会把这种情况当作生成代码错误去反复修复；请在外部服务恢复后重试，或提供缓存/镜像证据并标注其新鲜度。',
  ].join('\n');

  return {
    message,
    confidence: 0,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime-log',
    reasoningTrace: [
      'Generated workspace task stopped before output because a transient external dependency failure was detected in runtime logs.',
      `reason=${input.reason}`,
      `stdoutRef=${input.run.stdoutRef}`,
      `stderrRef=${input.run.stderrRef}`,
    ].join('\n'),
    claims: [{
      id: `claim-external-dependency-${id}`,
      text: 'Generated task was blocked by a transient external dependency before writing a structured result.',
      type: 'runtime-diagnostic',
      confidence: 0,
      evidenceLevel: 'runtime-log',
      supportingRefs: [input.run.stdoutRef, input.run.stderrRef],
      opposingRefs: [],
    }],
    uiManifest: [
      {
        componentId: reportViewerComponentId,
        artifactRef: `external-dependency-diagnostic-${id}`,
        title: '运行诊断',
        priority: 1,
      },
      {
        componentId: executionUnitTableComponentId,
        title: '可复现执行单元',
        priority: 2,
      },
    ],
    executionUnits: [{
      id: `external-dependency-${id}`,
      status: 'needs-human',
      tool: workspaceRuntimeGatewayToolId,
      params: JSON.stringify({
        skillId: input.skill.id,
        skillDomain: input.request.skillDomain,
        externalDependencyStatus: 'transient-unavailable',
      }),
      hash: id,
      language: input.run.spec.language,
      codeRef: input.run.spec.taskRel,
      stdoutRef: input.run.stdoutRef,
      stderrRef: input.run.stderrRef,
      outputRef: input.run.outputRef,
      exitCode: input.run.exitCode,
      externalDependencyStatus: 'transient-unavailable',
      failureReason: input.reason,
      recoverActions,
      nextStep: 'Retry after provider backoff/rate-limit reset, or attach cached evidence and rerun.',
    }],
    artifacts: [{
      id: `external-dependency-diagnostic-${id}`,
      type: 'runtime-diagnostic',
      format: 'markdown',
      title: '外部依赖暂时不可用',
      content: diagnostic,
      data: {
        reason: input.reason,
        codeRef: input.run.spec.taskRel,
        stdoutRef: input.run.stdoutRef,
        stderrRef: input.run.stderrRef,
        outputRef: input.run.outputRef,
        externalDependencyStatus: 'transient-unavailable',
        transientPolicy: {
          status: 'transient-unavailable',
          retryAfterMs,
          recoverActions,
          reasonCodes: ['transient:external-dependency', 'transient:pre-output'],
        },
        retryAfterMs,
        providerAttemptRefs,
        preservedRefs,
      },
    }],
    workEvidence: [transientWorkEvidence({
      id,
      skillDomain: input.request.skillDomain,
      provider: input.skill.id,
      reason: input.reason,
      stdoutRef: input.run.stdoutRef,
      stderrRef: input.run.stderrRef,
      outputRef: input.run.outputRef,
      codeRef: input.run.spec.taskRel,
      recoverActions,
    })],
    logs: [
      { kind: 'stdout', ref: input.run.stdoutRef },
      { kind: 'stderr', ref: input.run.stderrRef },
    ],
    displayIntent: {
      status: 'needs-human',
      reason: 'transient-external-dependency',
    },
  };
}

function defaultExternalWorkKind(skillDomain: string | undefined) {
  return skillDomain ? 'external-io' : 'fetch';
}

export function downgradeTransientExternalFailures(payload: ToolPayload): ToolPayload {
  if (!payloadHasReadableArtifact(payload)) return payload;
  let changed = false;
  const addedWorkEvidence: PayloadWorkEvidence[] = [];
  const allRecoverActions: string[] = [];
  const providerAttemptRefs: string[] = [];
  const executionUnits = payload.executionUnits.map((unit) => {
    if (!isRecord(unit) || !isFailureStatus(unit.status)) return unit;
    if (!unitHasStructuredTransientExternalFailure(unit)) return unit;
    const reason = failureReason(unit) ?? transientUnavailableStatus;
    const transientReason = reason ?? 'transient external dependency failure';
    changed = true;
    const recoverActions = Array.from(new Set([
      ...stringList(unit.recoverActions),
      ...externalFailureRecoverActions(transientReason),
    ]));
    allRecoverActions.push(...recoverActions);
    const refs = uniqueStrings([
      stringField(unit.stdoutRef),
      stringField(unit.stderrRef),
      stringField(unit.outputRef),
      stringField(unit.rawRef),
    ]);
    providerAttemptRefs.push(...refs);
    addedWorkEvidence.push(transientWorkEvidence({
      id: stableId(`${stringField(unit.id) ?? 'unit'}:${transientReason}`),
      kind: stringField(unit.kind) ?? stringField(unit.workKind),
      provider: stringField(unit.provider) ?? stringField(unit.tool),
      reason: transientReason,
      stdoutRef: stringField(unit.stdoutRef),
      stderrRef: stringField(unit.stderrRef),
      outputRef: stringField(unit.outputRef) ?? stringField(unit.rawRef),
      codeRef: stringField(unit.codeRef),
      recoverActions,
    }));
    return {
      ...unit,
      status: 'needs-human',
      externalDependencyStatus: 'transient-unavailable',
      failureReason: transientReason,
      recoverActions,
      nextStep: stringField(unit.nextStep) ?? 'Retry the external provider later or attach a cached evidence bundle, then rerun this task.',
    };
  });
  if (!changed) return payload;
  const preservedRefs = uniqueStrings([
    ...providerAttemptRefs,
    ...(payload.logs?.map((log) => isRecord(log) ? stringField(log.ref) : undefined) ?? []),
  ]);
  const recoverActions = uniqueStrings(allRecoverActions);
  return {
    ...payload,
    executionUnits,
    artifacts: payload.artifacts.map((artifact) => annotateTransientArtifact(artifact, recoverActions, providerAttemptRefs, preservedRefs)),
    workEvidence: [...(payload.workEvidence ?? []), ...addedWorkEvidence],
    reasoningTrace: [
      payload.reasoningTrace,
      'Transient external dependency failure was preserved as needs-human instead of marking the whole run failed; generated artifacts remain inspectable with explicit recovery actions.',
    ].filter(Boolean).join('\n'),
  };
}

function unitHasStructuredTransientExternalFailure(unit: Record<string, unknown>) {
  return unit.externalDependencyStatus === transientUnavailableStatus
    || isTransientExternalFailure(stringField(unit.failureKind))
    || isTransientExternalFailure(stringField(unit.failureCode))
    || isTransientExternalFailure(stringField(unit.failureCategory));
}

function structuredTransientExternalFailureFromJsonLines(text: string | undefined) {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseJsonRecord(line);
    const structured = structuredTransientExternalFailure(parsed);
    if (structured) return structured;
  }
  return undefined;
}

function structuredTransientExternalFailure(value: unknown): { reason: string } | undefined {
  if (!isRecord(value)) return undefined;
  const direct = structuredTransientExternalFailureRecord(value);
  if (direct) return direct;
  for (const key of ['externalFailure', 'externalDependency', 'failure', 'diagnostic']) {
    const nested = structuredTransientExternalFailure(value[key]);
    if (nested) return nested;
  }
  return undefined;
}

function structuredTransientExternalFailureRecord(record: Record<string, unknown>): { reason: string } | undefined {
  const status = stringField(record.externalDependencyStatus) ?? stringField(record.status);
  const code = stringField(record.failureKind) ?? stringField(record.failureCode) ?? stringField(record.code) ?? stringField(record.kind);
  if (status !== transientUnavailableStatus && !isTransientExternalFailure(code)) return undefined;
  return {
    reason: stringField(record.failureReason)
      ?? stringField(record.reason)
      ?? stringField(record.message)
      ?? code
      ?? transientUnavailableStatus,
  };
}

function parseJsonRecord(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeFailureCode(value: string | undefined) {
  if (!value) return undefined;
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function annotateTransientArtifact(
  artifact: Record<string, unknown>,
  recoverActions: string[],
  providerAttemptRefs: string[],
  preservedRefs: string[],
) {
  if (!isRecord(artifact)) return artifact;
  const transientPolicy = {
    status: 'transient-unavailable',
    recoverActions,
    reasonCodes: ['transient:external-dependency', 'transient:partial-artifact-preserved'],
  };
  const annotations = {
    transientPolicy,
    providerAttemptRefs: uniqueStrings(providerAttemptRefs),
    preservedRefs: uniqueStrings(preservedRefs),
  };
  if (artifact.data === undefined || isRecord(artifact.data)) {
    return {
      ...artifact,
      data: {
        ...(isRecord(artifact.data) ? artifact.data : {}),
        ...annotations,
      },
    };
  }
  return {
    ...artifact,
    ...annotations,
  };
}
