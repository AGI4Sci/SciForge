import type { AgentStreamEvent, SciForgeConfig } from './domain';

export interface RuntimeLatencyPolicy {
  firstVisibleResponseMs?: number;
  firstEventWarningMs?: number;
  silentRetryMs?: number;
  stallBoundMs?: number;
  requestTimeoutMs?: number;
  blockOnContextCompaction?: boolean;
  blockOnVerification?: boolean;
  allowBackgroundCompletion?: boolean;
}

export interface RuntimeResponsePlan {
  initialResponseMode?: string;
  userVisibleProgress?: string[];
  progressPhases?: string[];
}

export interface RuntimeLatencyThresholds {
  firstEventWarningMs: number;
  silentRetryMs: number;
  requestTimeoutMs: number;
  stallBoundMs: number;
}

export const SAFE_LATENCY_THRESHOLDS = {
  firstEventWarningMs: 20_000,
  silentRetryMs: 45_000,
  stallBoundMs: 120_000,
} as const;

export function latencyThresholdsFromPolicy(
  policy: unknown,
  config: Pick<SciForgeConfig, 'requestTimeoutMs'>,
): RuntimeLatencyThresholds {
  const record = isRecord(policy) ? policy : {};
  const requestedStallBoundMs = positiveMs(record.stallBoundMs) ?? SAFE_LATENCY_THRESHOLDS.stallBoundMs;
  return {
    firstEventWarningMs: positiveMs(record.firstEventWarningMs) ?? SAFE_LATENCY_THRESHOLDS.firstEventWarningMs,
    silentRetryMs: positiveMs(record.silentRetryMs) ?? SAFE_LATENCY_THRESHOLDS.silentRetryMs,
    stallBoundMs: Math.min(requestedStallBoundMs, SAFE_LATENCY_THRESHOLDS.stallBoundMs),
    requestTimeoutMs: positiveMs(record.requestTimeoutMs)
      ?? positiveMs(record.totalTimeoutMs)
      ?? positiveMs(record.timeoutMs)
      ?? config.requestTimeoutMs,
  };
}

export function extractLatencyPolicy(value: unknown): RuntimeLatencyPolicy | undefined {
  const policy = extractPolicyRecord(value, 'latencyPolicy');
  if (!policy) return undefined;
  return {
    firstVisibleResponseMs: positiveMs(policy.firstVisibleResponseMs),
    firstEventWarningMs: positiveMs(policy.firstEventWarningMs),
    silentRetryMs: positiveMs(policy.silentRetryMs),
    stallBoundMs: positiveMs(policy.stallBoundMs),
    requestTimeoutMs: positiveMs(policy.requestTimeoutMs) ?? positiveMs(policy.totalTimeoutMs) ?? positiveMs(policy.timeoutMs),
    blockOnContextCompaction: booleanField(policy.blockOnContextCompaction),
    blockOnVerification: booleanField(policy.blockOnVerification),
    allowBackgroundCompletion: booleanField(policy.allowBackgroundCompletion),
  };
}

export function extractResponsePlan(value: unknown): RuntimeResponsePlan | undefined {
  const plan = extractPolicyRecord(value, 'responsePlan');
  if (!plan) return undefined;
  return {
    initialResponseMode: stringField(plan.initialResponseMode),
    userVisibleProgress: stringList(plan.userVisibleProgress),
    progressPhases: stringList(plan.progressPhases),
  };
}

export function latestLatencyPolicy(events: AgentStreamEvent[]): RuntimeLatencyPolicy | undefined {
  for (const event of [...events].reverse()) {
    const policy = extractLatencyPolicy(event.raw);
    if (policy) return policy;
  }
  return undefined;
}

export function latestResponsePlan(events: AgentStreamEvent[]): RuntimeResponsePlan | undefined {
  for (const event of [...events].reverse()) {
    const plan = extractResponsePlan(event.raw);
    if (plan) return plan;
  }
  return undefined;
}

function extractPolicyRecord(value: unknown, key: 'latencyPolicy' | 'responsePlan'): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : {};
  const direct = record[key];
  if (isRecord(direct)) return direct;
  const data = isRecord(record.data) ? record.data : undefined;
  if (isRecord(data?.[key])) return data[key] as Record<string, unknown>;
  const policy = isRecord(record.conversationPolicy) ? record.conversationPolicy : undefined;
  if (isRecord(policy?.[key])) return policy[key] as Record<string, unknown>;
  return undefined;
}

function positiveMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return entries.length ? entries : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
