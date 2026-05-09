import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { collectWorkEvidenceFromBackendEvent, type WorkEvidence } from './work-evidence-types.js';

export async function readAgentServerRunStream(
  response: Response,
  onEvent: (event: unknown) => void,
  options: {
    maxTotalUsage?: number;
    onGuardTrip?: (message: string) => void;
    maxSilentMs?: number;
    onSilentTimeout?: (message: string) => void;
  } = {},
): Promise<{ json: unknown; run: Record<string, unknown>; error?: string; streamText?: string; workEvidence: WorkEvidence[] }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    return {
      json,
      run: isRecord(data.run) ? data.run : {},
      error: isRecord(json) ? String(json.error || '') : String(text).slice(0, 500),
      workEvidence: collectWorkEvidenceFromBackendEvent(json),
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const envelopes: unknown[] = [];
  let buffer = '';
  let finalResult: unknown;
  let streamError = '';
  let lastEnvelopeAt = Date.now();
  const streamTextParts: string[] = [];
  const workEvidence: WorkEvidence[] = [];
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    lastEnvelopeAt = Date.now();
    const envelope = JSON.parse(line) as unknown;
    envelopes.push(envelope);
    if (!isRecord(envelope)) return;
    for (const event of streamEventsFromEnvelope(envelope)) {
      workEvidence.push(...collectWorkEvidenceFromBackendEvent(event));
      if (isRecord(event)) {
        const text = typeof event.text === 'string'
          ? event.text
          : typeof event.delta === 'string'
            ? event.delta
            : undefined;
        if (text) streamTextParts.push(text);
      }
      onEvent(event);
      const totalUsage = agentServerEventTotalUsage(event);
      if (options.maxTotalUsage && totalUsage && totalUsage > options.maxTotalUsage) {
        const message = `AgentServer generation stopped by convergence guard after ${totalUsage} total tokens; bounded current-reference digests should be used instead of repeated full-file reads.`;
        options.onGuardTrip?.(message);
        throw new Error(message);
      }
    }
    if ('result' in envelope) finalResult = envelope.result;
    if ('error' in envelope) streamError = String(envelope.error || '');
  }
  for (;;) {
    const readResult = options.maxSilentMs
      ? await Promise.race([
        reader.read(),
        new Promise<{ silentTimeout: true }>((resolve) => {
          setTimeout(() => resolve({ silentTimeout: true }), options.maxSilentMs);
        }),
      ])
      : await reader.read();
    if ('silentTimeout' in readResult) {
      const silentMs = Date.now() - lastEnvelopeAt;
      const message = `AgentServer generation stopped by silent stream guard after ${silentMs}ms without stream events; bounded current-reference digests should be used instead of waiting indefinitely.`;
      options.onSilentTimeout?.(message);
      throw new Error(message);
    }
    const { value, done } = readResult;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  const data = isRecord(finalResult) && isRecord(finalResult.data) ? finalResult.data : isRecord(finalResult) ? finalResult : {};
  return {
    json: finalResult ?? { envelopes, error: streamError },
    run: isRecord(data.run) ? data.run : {},
    error: streamError || undefined,
    streamText: streamTextParts.join(''),
    workEvidence: dedupeWorkEvidence(workEvidence),
  };
}

function streamEventsFromEnvelope(envelope: Record<string, unknown>) {
  if ('event' in envelope) return [envelope.event];
  const events = Array.isArray(envelope.events) ? envelope.events : undefined;
  if (events) return events;
  if (looksLikeAgentServerStreamEvent(envelope)) return [normalizeTopLevelStreamEvent(envelope)];
  return [];
}

function looksLikeAgentServerStreamEvent(value: Record<string, unknown>) {
  if ('result' in value || 'error' in value && !('type' in value) && !('kind' in value)) return false;
  return typeof value.type === 'string'
    || typeof value.kind === 'string'
    || typeof value.delta === 'string'
    || typeof value.text === 'string'
    || isRecord(value.progress)
    || isRecord(value.usage);
}

function normalizeTopLevelStreamEvent(value: Record<string, unknown>) {
  const rawType = typeof value.type === 'string'
    ? value.type
    : typeof value.kind === 'string'
      ? value.kind
      : typeof value.delta === 'string'
        ? 'text-delta'
        : 'status';
  const type = rawType === 'text_delta' || rawType === 'token_delta' || rawType === 'content_delta'
    ? 'text-delta'
    : rawType;
  if (type === rawType && typeof value.delta !== 'string') return value;
  return {
    ...value,
    type,
    text: typeof value.text === 'string' ? value.text : typeof value.delta === 'string' ? value.delta : undefined,
  };
}

export function mergeBackendStreamWorkEvidence(payload: ToolPayload, workEvidence: WorkEvidence[]) {
  if (!workEvidence.length) return payload;
  const existing = Array.isArray(payload.workEvidence) ? payload.workEvidence : [];
  return {
    ...payload,
    workEvidence: dedupeWorkEvidence([...existing, ...workEvidence]),
  };
}

export function dedupeWorkEvidence(items: WorkEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify({
      kind: item.kind,
      status: item.status,
      provider: item.provider,
      input: item.input,
      resultCount: item.resultCount,
      failureReason: item.failureReason,
      rawRef: item.rawRef,
      evidenceRefs: item.evidenceRefs,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function currentReferenceDigestGuardLimit(request: GatewayRequest) {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  if (!digests.length) return undefined;
  const configured = typeof request.maxContextWindowTokens === 'number' && Number.isFinite(request.maxContextWindowTokens)
    ? request.maxContextWindowTokens
    : 200_000;
  return Math.max(40_000, Math.min(80_000, Math.floor(configured * 0.4)));
}

export function currentReferenceDigestSilentGuardMs(request: GatewayRequest) {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  if (!digests.length) return undefined;
  return 45_000;
}

function agentServerEventTotalUsage(event: unknown) {
  if (!isRecord(event)) return undefined;
  const usage = isRecord(event.usage) ? event.usage : isRecord(event.output) && isRecord(event.output.usage) ? event.output.usage : undefined;
  const candidates = [
    event.total,
    event.totalTokens,
    event.tokens,
    usage?.total,
    usage?.totalTokens,
    usage?.input && usage?.output ? Number(usage.input) + Number(usage.output) : undefined,
    usage?.inputTokens && usage?.outputTokens ? Number(usage.inputTokens) + Number(usage.outputTokens) : undefined,
    usage?.promptTokens && usage?.completionTokens ? Number(usage.promptTokens) + Number(usage.completionTokens) : undefined,
  ];
  return candidates
    .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN)
    .find((value) => Number.isFinite(value) && value > 0);
}
