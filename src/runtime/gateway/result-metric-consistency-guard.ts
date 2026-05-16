import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';

export const RESULT_METRIC_CONSISTENCY_GUARD_CONTRACT_ID = 'sciforge.result-metric-consistency.v1';
export const RESULT_METRIC_CONSISTENCY_GUARD_SCHEMA_PATH = 'src/runtime/gateway/result-metric-consistency-guard.ts#evaluateResultMetricConsistency';

export interface ResultMetricConsistencyFinding {
  severity: 'repair-needed';
  reason: string;
  failedMetrics: Array<{ label: string; value: number; threshold: number }>;
  successClaims: string[];
}

export function evaluateResultMetricConsistency(payload: ToolPayload, _request: GatewayRequest): ResultMetricConsistencyFinding | undefined {
  const text = payloadText(payload);
  if (!text.trim()) return undefined;
  const failedMetrics = highErrorMetrics(text);
  if (!failedMetrics.length) return undefined;
  const successClaims = successClaimSnippets(text);
  if (!successClaims.length) return undefined;
  return {
    severity: 'repair-needed',
    reason: [
      'Result metric consistency guard failed: payload claims success or close reproduction while quantitative error metrics exceed acceptable bounds.',
      `Failed metrics: ${failedMetrics.map((metric) => `${metric.label}=${metric.value}% > ${metric.threshold}%`).join(', ')}.`,
    ].join(' '),
    failedMetrics,
    successClaims,
  };
}

export function validationFindingProjectionFromResultMetricConsistencyFinding(
  finding: ResultMetricConsistencyFinding,
  options: {
    id?: string;
    capabilityId?: string;
    relatedRefs?: string[];
  } = {},
): ValidationFindingProjectionInput {
  return {
    id: options.id,
    source: 'harness',
    kind: 'result-metric-consistency',
    status: finding.severity,
    failureMode: 'result-metric-overclaim',
    severity: 'blocking',
    message: finding.reason,
    contractId: RESULT_METRIC_CONSISTENCY_GUARD_CONTRACT_ID,
    schemaPath: RESULT_METRIC_CONSISTENCY_GUARD_SCHEMA_PATH,
    capabilityId: options.capabilityId ?? 'sciforge.validation-guard',
    relatedRefs: options.relatedRefs,
    recoverActions: [
      'Revise the result verdict to reflect the failed metrics, or repair/rerun the experiment until the metrics support the success claim.',
      'Include explicit thresholds and compare each reported metric against those thresholds before declaring reproduction success.',
    ],
    diagnostics: {
      guard: 'result-metric-consistency',
      failedMetrics: finding.failedMetrics,
      successClaims: finding.successClaims,
    },
    isFailure: true,
  };
}

function highErrorMetrics(text: string) {
  const metrics: ResultMetricConsistencyFinding['failedMetrics'] = [];
  const pattern = /(?:parameter\s+)?error\s*(?:\(([^)]+)\))?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*%/gi;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    const label = `parameter error${match[1] ? ` (${match[1].trim()})` : ''}`;
    const threshold = 50;
    if (value > threshold) metrics.push({ label, value, threshold });
  }
  return metrics.slice(0, 8);
}

function successClaimSnippets(text: string) {
  return text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8 && line.length <= 360)
    .filter((line) => /\b(success(?:ful|fully)?|succeeded|recovered|recovers?|reproduced|supports?|close(?:ly)?|accurate|valid(?:ated)?)\b/i.test(line))
    .filter((line) => !/\b(failed|not\s+reproduced|did\s+not|does\s+not|unsuccessful|cannot\s+claim)\b/i.test(line))
    .slice(0, 6);
}

function payloadText(payload: ToolPayload) {
  return collectStrings(payload, 0).join('\n').slice(0, 80_000);
}

function collectStrings(value: unknown, depth: number): string[] {
  if (depth > 7 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStrings(entry, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((entry) => collectStrings(entry, depth + 1));
}
