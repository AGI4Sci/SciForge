import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  ClientAbortError,
  detectModality,
  EXPERT_MODEL,
  ProviderError,
  translateModality,
  UndetectableModalityError,
  type ExpertConfig,
} from './experts.js';
import type { Modality, ModalityTranslateRequest, ModalityTranslation, ServiceError, ServiceResult } from './types.js';
import { MODALITIES } from './types.js';

export const SERVICE_ID = 'sciforge.sci-modality-router';
export const SERVICE_VERSION = '0.1.0';

export interface SciModalityRouterOptions {
  experts: ExpertConfig;
  fetchImpl?: typeof fetch;
  /** Deterministic clock for tests. */
  now?: () => Date;
}

export function createSciModalityRouterServer(options: SciModalityRouterOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return createServer((req, res) => {
    handle(req, res, options, fetchImpl, now).catch((error) => {
      sendJson(res, 500, errorResult('INTERNAL_ERROR', messageOf(error), false));
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: SciModalityRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, {
      service: SERVICE_ID,
      version: SERVICE_VERSION,
      provider: options.experts.baseUrl,
      modalities: MODALITIES,
    });
  }
  if (req.method === 'GET' && url.pathname === '/experts/status') {
    return expertsStatusRoute(res, options, fetchImpl, now);
  }
  if (req.method === 'POST' && url.pathname === '/modality/translate') {
    return translateRoute(req, res, options, fetchImpl, now);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

// Live availability of each expert model. Pings the expert provider's /health (which lists the
// loaded models) and maps the six modalities -> their expert -> online/offline. Cheap; safe to poll.
async function expertsStatusRoute(
  res: ServerResponse,
  options: SciModalityRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const base = options.experts.baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
  let reachable = false;
  let device: string | undefined;
  const loaded = new Set<string>();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetchImpl(`${base}/health`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (resp.ok) {
      reachable = true;
      const body = (await resp.json().catch(() => ({}))) as { experts?: unknown; device?: unknown };
      if (Array.isArray(body.experts)) for (const e of body.experts) loaded.add(String(e));
      if (typeof body.device === 'string') device = body.device;
    }
  } catch {
    reachable = false;
  }
  const experts = MODALITIES.map((modality) => {
    const model = EXPERT_MODEL[modality];
    return { modality, model, online: reachable && loaded.has(model) };
  });
  return sendJson(res, 200, {
    ok: true,
    service: SERVICE_ID,
    providerReachable: reachable,
    device,
    experts,
    checkedAt: now().toISOString(),
  });
}

async function translateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: SciModalityRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const startedAt = now().toISOString();
  let body: ModalityTranslateRequest;
  try {
    body = (await readJson(req)) as ModalityTranslateRequest;
  } catch {
    return sendJson(res, 400, errorResult('INVALID_ARGUMENT', 'Request body must be valid JSON.', false));
  }

  const requestId = body.requestId ?? `mt_${createHash('sha256').update(startedAt).digest('hex').slice(0, 12)}`;
  const provenance = { serviceId: SERVICE_ID, operation: 'modality_translate', requestId, startedAt };
  const badRequest = (message: string): ServiceResult<never> => ({
    ok: false,
    error: { code: 'INVALID_ARGUMENT', message, retryable: false },
    provenance: { ...provenance, completedAt: now().toISOString() },
  });

  if (typeof body.payload !== 'string' || !body.payload.trim()) {
    return sendJson(res, 400, badRequest('`payload` (non-empty string) is required.'));
  }
  if (body.modality && !MODALITIES.includes(body.modality)) {
    return sendJson(res, 400, badRequest(`unknown modality ${String(body.modality)}; expected one of ${MODALITIES.join(', ')}`));
  }

  // Resolve modality: explicit wins, else rule-based auto-detection.
  let modality: Modality;
  let modalitySource: 'explicit' | 'detected';
  if (body.modality) {
    modality = body.modality;
    modalitySource = 'explicit';
  } else {
    try {
      modality = detectModality(body.payload);
      modalitySource = 'detected';
    } catch (error) {
      const message = error instanceof UndetectableModalityError ? error.message : messageOf(error);
      return sendJson(res, 400, badRequest(message));
    }
  }

  console.log(
    `[sci-modality] POST /modality/translate requestId=${requestId} modality=${modality} (${modalitySource}) ` +
      `payload=${body.payload.length}b objectId=${body.objectId ?? '-'}`,
  );

  // Abort the (possibly long, retrying) upstream expert call if the caller disconnects.
  const upstream = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) upstream.abort();
  });

  try {
    const translation = await translateModality(
      options.experts,
      modality,
      body.payload,
      body.instruction,
      modalitySource,
      fetchImpl,
      upstream.signal,
    );
    console.log(
      `[sci-modality] requestId=${requestId} OK model=${translation.model} summary="${boundedSummary(translation.summary, 80)}"`,
    );
    const result: ServiceResult<ModalityTranslation> = {
      ok: true,
      summary: boundedSummary(translation.summary),
      data: translation,
      provenance: { ...provenance, completedAt: now().toISOString() },
    };
    return sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof ClientAbortError || upstream.signal.aborted) return; // caller gone; nothing to send
    const { status, err } = classify(error);
    return sendJson(res, status, {
      ok: false,
      error: err,
      provenance: { ...provenance, completedAt: now().toISOString() },
    } satisfies ServiceResult<never>);
  }
}

function classify(error: unknown): { status: number; err: ServiceError } {
  if (error instanceof ProviderError) {
    if (error.httpStatus === 401 || error.httpStatus === 403) {
      return { status: 502, err: { code: 'UNAUTHENTICATED', message: error.message, retryable: false } };
    }
    if (error.httpStatus === 404) {
      // Expert model not registered by the provider — a config error, not transient.
      return { status: 502, err: { code: 'NOT_FOUND', message: error.message, retryable: false } };
    }
    if (error.httpStatus === 429) {
      return { status: 502, err: { code: 'RATE_LIMITED', message: error.message, retryable: true } };
    }
    return { status: 502, err: { code: 'UNAVAILABLE', message: error.message, retryable: true } };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, err: { code: 'TIMEOUT', message: 'expert provider timed out', retryable: true } };
  }
  return { status: 500, err: { code: 'INTERNAL_ERROR', message: messageOf(error), retryable: false } };
}

function errorResult(code: ServiceError['code'], message: string, retryable: boolean): ServiceResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function boundedSummary(value: string, max = 600): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
