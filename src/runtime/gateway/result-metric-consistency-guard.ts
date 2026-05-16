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
  contradictoryComparisons?: Array<{ label: string; left: number; right: number; tolerance: number; claim: string }>;
}

export function evaluateResultMetricConsistency(payload: ToolPayload, _request: GatewayRequest): ResultMetricConsistencyFinding | undefined {
  const text = payloadText(payload);
  if (!text.trim()) return undefined;
  const failedMetrics = highErrorMetrics(text);
  const contradictoryComparisons = contradictedRobustnessComparisons(text);
  const successClaims = successClaimSnippets(text);
  if (!failedMetrics.length && !contradictoryComparisons.length) return undefined;
  if (failedMetrics.length && !successClaims.length) return undefined;
  return {
    severity: 'repair-needed',
    reason: [
      failedMetrics.length
        ? 'Result metric consistency guard failed: payload claims success or close reproduction while quantitative error metrics exceed acceptable bounds.'
        : 'Result metric consistency guard failed: payload claims a robustness/confounder effect that is contradicted by the reported coefficients.',
      failedMetrics.length
        ? `Failed metrics: ${failedMetrics.map((metric) => `${metric.label}=${metric.value}% > ${metric.threshold}%`).join(', ')}.`
        : `Contradictory comparisons: ${contradictoryComparisons.map((comparison) => `${comparison.label} ${comparison.left} vs ${comparison.right} (tolerance ${comparison.tolerance})`).join(', ')}.`,
    ].join(' '),
    failedMetrics,
    successClaims,
    ...(contradictoryComparisons.length ? { contradictoryComparisons } : {}),
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
      'Revise the result verdict to reflect the failed metrics or contradictory coefficient comparison, or repair/rerun the experiment until the reported evidence supports the claim.',
      'Compare reported robustness/control metrics against the written interpretation before declaring a successful or confounder-corrected result.',
    ],
    diagnostics: {
      guard: 'result-metric-consistency',
      failedMetrics: finding.failedMetrics,
      contradictoryComparisons: finding.contradictoryComparisons ?? [],
      successClaims: finding.successClaims,
    },
    isFailure: true,
  };
}

function highErrorMetrics(text: string) {
  const metrics: ResultMetricConsistencyFinding['failedMetrics'] = [];
  const addMetric = (name: string | undefined, rawValue: string | undefined) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const metricName = (name ?? '').trim();
    const label = `parameter error${metricName ? ` (${metricName})` : ''}`;
    const threshold = 50;
    if (value > threshold) metrics.push({ label, value, threshold });
  };
  for (const match of text.matchAll(/(?:parameter\s+)?error\s*\(([^)]+)\)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)/gi)) {
    addMetric(match[1], match[2]);
  }
  for (const match of text.matchAll(/(?:relative\s+)?error\s+(?!is\b)([A-Za-z][\w-]*)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)/gi)) {
    addMetric(match[1], match[2]);
  }
  for (const match of text.matchAll(/\b([A-Za-z][\w-]*)\s+error(?:\s+is)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)/gi)) {
    addMetric(match[1], match[2]);
  }
  for (const match of text.matchAll(/(?:parameter\s+)?error\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)/gi)) {
    addMetric(undefined, match[1]);
  }
  return metrics.slice(0, 8);
}

function contradictedRobustnessComparisons(text: string) {
  const comparisons: NonNullable<ResultMetricConsistencyFinding['contradictoryComparisons']> = [];
  const compact = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const batchControlPattern = /without\s+batch(?:\s+control)?[\s\S]{0,220}?(?:coeff(?:icient)?|coef)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)[\s\S]{0,220}?with\s+batch(?:\s+control)?[\s\S]{0,220}?(?:coeff(?:icient)?|coef)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)/gi;
  for (const match of compact.matchAll(batchControlPattern)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const tolerance = Math.max(0.001, Math.max(Math.abs(left), Math.abs(right)) * 0.01);
    if (Math.abs(left - right) > tolerance) continue;
    const claim = contradictedConfounderClaim(compact);
    if (!claim) continue;
    comparisons.push({
      label: 'without-vs-with batch coefficient',
      left,
      right,
      tolerance,
      claim,
    });
  }
  return comparisons.slice(0, 4);
}

function contradictedConfounderClaim(text: string) {
  const sentences = text
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 12 && line.length <= 420);
  return sentences.find((line) => {
    const mentionsControl = /\b(control(?:ling|led)?|adjust(?:ing|ed)?|with)\b/i.test(line) && /\bbatch(?:es)?\b/i.test(line);
    const claimsChangedEffect = /\b(reduces?|reduced|lower(?:s|ed)?|decreas(?:es|ed)|attenuat(?:es|ed)|inflates?|inflated|bias(?:es|ed)?|confounds?|confounded|essential|unbiased|isolates?)\b/i.test(line);
    const deniesNoChange = !/\b(no|not|does\s+not|did\s+not|unchanged|same|identical|0\.000)\b/i.test(line);
    return mentionsControl && claimsChangedEffect && deniesNoChange;
  });
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
