import { createHash } from 'node:crypto';
import type {
  BrowserHostSessionAction,
  BrowserHostSessionActionTiming,
  BrowserHostSessionActionTimingSummary,
  BrowserHostSessionCaptureMode,
  BrowserHostSessionDriver,
} from './browser-host-session-types.js';

export type BrowserHostActionTimingBuilder = {
  actionId: string;
  action: BrowserHostSessionAction | 'open';
  capture: BrowserHostSessionCaptureMode;
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
  hostReceivedAtMs: number;
  hostStartedAtMs: number;
  hostActionEndedAtMs?: number;
  evidenceCaptureStartedAtMs?: number;
  evidenceCaptureEndedAtMs?: number;
};

type BrowserHostActionTimingSession = {
  id: string;
  driver?: Pick<BrowserHostSessionDriver, 'liveSurfaceTransport'>;
  liveSurfaceTransport?: BrowserHostSessionActionTiming['liveSurfaceTransport'];
  lastActionTiming?: BrowserHostSessionActionTiming;
  actionTimingSamples: Map<BrowserHostSessionAction | 'open', number[]>;
  actionTimingSummary?: BrowserHostSessionActionTimingSummary[];
};

export function createBrowserHostActionTiming(
  session: Pick<BrowserHostActionTimingSession, 'id'>,
  action: BrowserHostSessionAction | 'open',
  input: {
    capture: BrowserHostSessionCaptureMode;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
    hostReceivedAtMs?: number;
  },
): BrowserHostActionTimingBuilder {
  const hostReceivedAtMs = input.hostReceivedAtMs ?? Date.now();
  return {
    actionId: safeTimingId(input.actionId) || `browser-action-${Date.now()}-${sha1(`${session.id}:${action}:${hostReceivedAtMs}`).slice(0, 8)}`,
    action,
    capture: input.capture,
    uiEventReceivedAt: safeIsoTimestamp(input.uiEventReceivedAt),
    adapterSentAt: safeIsoTimestamp(input.adapterSentAt),
    hostReceivedAtMs,
    hostStartedAtMs: Date.now(),
  };
}

export function markBrowserHostActionTimingActionEnd(timing: BrowserHostActionTimingBuilder): void {
  timing.hostActionEndedAtMs = timing.hostActionEndedAtMs ?? Date.now();
}

export function markBrowserHostActionTimingEvidenceStart(timing: BrowserHostActionTimingBuilder | undefined): void {
  if (!timing) return;
  timing.evidenceCaptureStartedAtMs = timing.evidenceCaptureStartedAtMs ?? Date.now();
}

export function markBrowserHostActionTimingEvidenceEnd(timing: BrowserHostActionTimingBuilder | undefined): void {
  if (!timing) return;
  timing.evidenceCaptureEndedAtMs = Date.now();
}

export function finishBrowserHostActionTiming(
  session: BrowserHostActionTimingSession,
  timing: BrowserHostActionTimingBuilder,
  status: BrowserHostSessionActionTiming['status'],
  blockedReason?: string,
  options: { paintAckSource?: BrowserHostSessionActionTiming['paintAckSource'] } = {},
): void {
  markBrowserHostActionTimingActionEnd(timing);
  const hostCompletedAtMs = Date.now();
  const adapterSentAtMs = timing.adapterSentAt ? Date.parse(timing.adapterSentAt) : undefined;
  const evidenceMs = timing.evidenceCaptureStartedAtMs && timing.evidenceCaptureEndedAtMs
    ? roundedMs(timing.evidenceCaptureEndedAtMs - timing.evidenceCaptureStartedAtMs)
    : undefined;
  const totalMs = roundedMs(hostCompletedAtMs - timing.hostReceivedAtMs);
  const liveSurfaceTransport = browserHostNativeLiveSurfaceTransport(session.driver?.liveSurfaceTransport ?? session.liveSurfaceTransport);
  const actionTiming: BrowserHostSessionActionTiming = {
    actionId: timing.actionId,
    action: timing.action,
    capture: timing.capture,
    status,
    uiEventReceivedAt: timing.uiEventReceivedAt,
    adapterSentAt: timing.adapterSentAt,
    hostReceivedAt: new Date(timing.hostReceivedAtMs).toISOString(),
    hostStartedAt: new Date(timing.hostStartedAtMs).toISOString(),
    hostActionEndedAt: new Date(timing.hostActionEndedAtMs ?? hostCompletedAtMs).toISOString(),
    evidenceCaptureStartedAt: timing.evidenceCaptureStartedAtMs ? new Date(timing.evidenceCaptureStartedAtMs).toISOString() : undefined,
    evidenceCaptureEndedAt: timing.evidenceCaptureEndedAtMs ? new Date(timing.evidenceCaptureEndedAtMs).toISOString() : undefined,
    hostCompletedAt: new Date(hostCompletedAtMs).toISOString(),
    adapterToHostMs: adapterSentAtMs !== undefined && Number.isFinite(adapterSentAtMs) ? roundedMs(timing.hostReceivedAtMs - adapterSentAtMs) : undefined,
    queueMs: roundedMs(timing.hostStartedAtMs - timing.hostReceivedAtMs),
    hostActionMs: roundedMs((timing.hostActionEndedAtMs ?? hostCompletedAtMs) - timing.hostStartedAtMs),
    evidenceMs,
    totalMs,
    liveSurfaceTransport,
    paintAckSource: options.paintAckSource ?? browserHostPaintAckSource(liveSurfaceTransport, timing.capture),
    blockedReason: blockedReason ? clip(browserHostTimingErrorMessage(blockedReason), 240) : undefined,
  };
  session.lastActionTiming = actionTiming;
  const samples = session.actionTimingSamples.get(timing.action) ?? [];
  samples.push(totalMs);
  if (samples.length > 60) samples.splice(0, samples.length - 60);
  session.actionTimingSamples.set(timing.action, samples);
  session.actionTimingSummary = summarizeBrowserHostActionTimings(session.actionTimingSamples);
}

export function summarizeBrowserHostActionTimings(samples: Map<BrowserHostSessionAction | 'open', number[]>): BrowserHostSessionActionTimingSummary[] {
  return BROWSER_HOST_ACTION_TIMING_ORDER.flatMap((action) => {
    const values = samples.get(action) ?? [];
    if (!values.length) return [];
    const sorted = [...values].sort((left, right) => left - right);
    return [{
      action,
      count: values.length,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      lastMs: values[values.length - 1],
    }];
  });
}

export function actionTimingSamplesFromSummaries(summaries: BrowserHostSessionActionTimingSummary[] | undefined): Map<BrowserHostSessionAction | 'open', number[]> {
  const samples = new Map<BrowserHostSessionAction | 'open', number[]>();
  for (const summary of summaries ?? []) {
    if (BROWSER_HOST_ACTION_TIMING_ORDER.includes(summary.action)) samples.set(summary.action, [summary.lastMs]);
  }
  return samples;
}

export function browserHostActionTiming(value: unknown): BrowserHostSessionActionTiming | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const action = browserHostTimingAction(record.action);
  const capture = browserHostCaptureMode(record.capture) ?? 'none';
  const status = record.status === 'failed' ? 'failed' : record.status === 'ok' ? 'ok' : undefined;
  const hostReceivedAt = safeIsoTimestamp(record.hostReceivedAt);
  const hostStartedAt = safeIsoTimestamp(record.hostStartedAt);
  const hostCompletedAt = safeIsoTimestamp(record.hostCompletedAt);
  if (!action || !status || !hostReceivedAt || !hostStartedAt || !hostCompletedAt) return undefined;
  const liveSurfaceTransport = record.liveSurfaceTransport === 'native-embedded'
    ? 'native-embedded'
    : undefined;
  const paintAckSource = record.paintAckSource === 'native-adapter-action-state' || record.paintAckSource === 'host-stream-frame' || record.paintAckSource === 'none'
    ? record.paintAckSource
    : undefined;
  return {
    actionId: safeTimingId(record.actionId) ?? `browser-action-stored-${sha1(`${action}:${hostCompletedAt}`).slice(0, 8)}`,
    action,
    capture,
    status,
    uiEventReceivedAt: safeIsoTimestamp(record.uiEventReceivedAt),
    adapterSentAt: safeIsoTimestamp(record.adapterSentAt),
    hostReceivedAt,
    hostStartedAt,
    hostActionEndedAt: safeIsoTimestamp(record.hostActionEndedAt),
    evidenceCaptureStartedAt: safeIsoTimestamp(record.evidenceCaptureStartedAt),
    evidenceCaptureEndedAt: safeIsoTimestamp(record.evidenceCaptureEndedAt),
    hostCompletedAt,
    adapterToHostMs: numberField(record.adapterToHostMs),
    queueMs: numberField(record.queueMs) ?? 0,
    hostActionMs: numberField(record.hostActionMs) ?? 0,
    evidenceMs: numberField(record.evidenceMs),
    totalMs: numberField(record.totalMs) ?? 0,
    liveSurfaceTransport,
    paintAckSource,
    blockedReason: stringField(record.blockedReason),
  };
}

export function browserHostActionTimingSummary(value: unknown): BrowserHostSessionActionTimingSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const action = browserHostTimingAction(record.action);
    if (!action) return [];
    const count = numberField(record.count);
    const p50Ms = numberField(record.p50Ms);
    const p95Ms = numberField(record.p95Ms);
    const lastMs = numberField(record.lastMs);
    if (count === undefined || p50Ms === undefined || p95Ms === undefined || lastMs === undefined) return [];
    return [{
      action,
      count: Math.max(0, Math.round(count)),
      p50Ms: roundedMs(p50Ms),
      p95Ms: roundedMs(p95Ms),
      lastMs: roundedMs(lastMs),
    }];
  });
}

const BROWSER_HOST_ACTION_TIMING_ORDER: Array<BrowserHostSessionAction | 'open'> = [
  'open',
  'navigate',
  'back',
  'forward',
  'reload',
  'stop',
  'click',
  'double-click',
  'mouse-down',
  'mouse-move',
  'mouse-up',
  'drag',
  'type',
  'press',
  'scroll',
  'cursor',
  'snapshot',
  'state',
  'close',
];

function browserHostPaintAckSource(
  transport: BrowserHostSessionActionTiming['liveSurfaceTransport'],
  _capture: BrowserHostSessionCaptureMode,
): BrowserHostSessionActionTiming['paintAckSource'] {
  if (transport === 'native-embedded') return 'native-adapter-action-state';
  return 'none';
}

function browserHostNativeLiveSurfaceTransport(value: unknown): BrowserHostSessionActionTiming['liveSurfaceTransport'] {
  return value === 'native-embedded' ? 'native-embedded' : undefined;
}

function browserHostTimingAction(value: unknown): BrowserHostSessionAction | 'open' | undefined {
  return typeof value === 'string' && BROWSER_HOST_ACTION_TIMING_ORDER.includes(value as BrowserHostSessionAction | 'open')
    ? value as BrowserHostSessionAction | 'open'
    : undefined;
}

function browserHostCaptureMode(value: unknown): BrowserHostSessionCaptureMode | undefined {
  return value === 'full' || value === 'frame' || value === 'none' ? value : undefined;
}

function percentile(sorted: number[], ratio: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function safeTimingId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
}

function safeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function browserHostTimingErrorMessage(error: unknown) {
  return scrubBrowserHostText(error instanceof Error ? error.message : String(error));
}

function scrubBrowserHostText(value: string) {
  return clip(value, 4000)
    .replace(/\b(authorization|api[-_]?key|token|secret|password|credential)(=|:)\s*[^&\s"']+/gi, '$1$2[redacted]');
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
