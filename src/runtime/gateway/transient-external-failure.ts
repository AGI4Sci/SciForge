import { createHash } from 'node:crypto';

import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';

const TRANSIENT_EXTERNAL_FAILURE_PATTERN = /\b(?:http(?:\s+error)?\s*(?:408|425|429|500|502|503|504)|too many requests|rate.?limit|quota|throttl|temporar(?:y|ily)|timeout|timed out|econnreset|etimedout|eai_again|enotfound|network is unreachable|service unavailable)\b/i;

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
  return Boolean(reason && TRANSIENT_EXTERNAL_FAILURE_PATTERN.test(reason));
}

export function externalFailureRecoverActions(reason: string) {
  return [
    `External provider appears transiently unavailable: ${reason}`,
    'Retry after provider backoff or rate-limit reset.',
    'Use cached/mirrored evidence if available, and label freshness/coverage explicitly.',
  ];
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function transientFailureLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .find((line) => isTransientExternalFailure(line));
}

function stableId(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

export function transientExternalFailureReasonFromRun(run: Pick<WorkspaceTaskRunResult, 'stderr' | 'stdout'>) {
  const combined = [run.stderr, run.stdout].filter(Boolean).join('\n');
  if (!isTransientExternalFailure(combined)) return undefined;
  const line = transientFailureLine(combined);
  if (line) return line;
  return compactWhitespace(combined).slice(0, 320) || 'Transient external dependency failure.';
}

export function firstTransientExternalFailureReason(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const reason = failureReason(unit);
    if (isTransientExternalFailure(reason)) return reason;
  }
  return undefined;
}

export function payloadHasOnlyTransientExternalDependencyFailures(payload: ToolPayload) {
  const problematicUnits = payload.executionUnits.filter((unit) => isRecord(unit)
    && /failed|error|repair-needed|needs-human/i.test(String(unit.status || ''))) as Array<Record<string, unknown>>;
  if (!problematicUnits.length) return false;
  return problematicUnits.every((unit) => unit.externalDependencyStatus === 'transient-unavailable'
    && isTransientExternalFailure(failureReason(unit)));
}

export function transientExternalDependencyPayload(input: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  reason: string;
}): ToolPayload {
  const id = stableId(`${input.skill.id}:${input.request.skillDomain}:${input.run.outputRef}:${input.reason}`);
  const message = '外部数据源暂时不可用，运行证据已保留；请稍后重试或提供缓存证据后继续。';
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
        componentId: 'report-viewer',
        artifactRef: `external-dependency-diagnostic-${id}`,
        title: '运行诊断',
        priority: 1,
      },
      {
        componentId: 'execution-unit-table',
        title: '可复现执行单元',
        priority: 2,
      },
    ],
    executionUnits: [{
      id: `external-dependency-${id}`,
      status: 'needs-human',
      tool: 'sciforge.workspace-runtime-gateway',
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
      recoverActions: externalFailureRecoverActions(input.reason),
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
      },
    }],
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

export function downgradeTransientExternalFailures(payload: ToolPayload): ToolPayload {
  if (!payloadHasReadableArtifact(payload)) return payload;
  let changed = false;
  const executionUnits = payload.executionUnits.map((unit) => {
    if (!isRecord(unit) || !isFailureStatus(unit.status)) return unit;
    const reason = failureReason(unit);
    if (!isTransientExternalFailure(reason)) return unit;
    const transientReason = reason ?? 'transient external dependency failure';
    changed = true;
    const recoverActions = Array.from(new Set([
      ...stringList(unit.recoverActions),
      ...externalFailureRecoverActions(transientReason),
    ]));
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
  return {
    ...payload,
    executionUnits,
    reasoningTrace: [
      payload.reasoningTrace,
      'Transient external dependency failure was preserved as needs-human instead of marking the whole run failed; generated artifacts remain inspectable with explicit recovery actions.',
    ].filter(Boolean).join('\n'),
  };
}
