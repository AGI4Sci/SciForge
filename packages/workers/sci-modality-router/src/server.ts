import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  ClientAbortError,
  detectModality,
  EXPERT_MODEL,
  normalizeExpertConfig,
  ProviderError,
  translateModality,
  UndetectableModalityError,
  type ExpertConfig,
} from './experts.js';
import type { Modality, ModalityTranslateRequest, ModalityTranslation, ServiceError, ServiceResult } from './types.js';
import { MODALITIES } from './types.js';

export const SERVICE_ID = 'sciforge.sci-modality-router';
export const SERVICE_VERSION = '0.1.0';
export const SCIMODALITY_ROUTER_RUNTIME_TOKEN_ENV = 'SCIMODALITY_ROUTER_RUNTIME_TOKEN';
export const DEFAULT_MAX_JSON_BODY_BYTES = 40 * 1024 * 1024;

export interface SciModalityRouterOptions {
  experts: ExpertConfig;
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
  runtimeToken: string;
  /** Deterministic clock for tests. */
  now?: () => Date;
}

export function createSciModalityRouterServer(options: SciModalityRouterOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const experts = normalizeExpertConfig(options.experts);
  const resolvedOptions = { ...options, experts };
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes);
  const runtimeToken = normalizeRuntimeToken(options.runtimeToken);
  const now = options.now ?? (() => new Date());

  return createServer((req, res) => {
    handle(req, res, resolvedOptions, fetchImpl, now, { runtimeToken, maxBodyBytes }).catch((error) => {
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
  security: { runtimeToken: string; maxBodyBytes: number },
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (!hasValidRuntimeToken(req, security.runtimeToken)) {
    return sendJson(res, 401, errorResult('UNAUTHENTICATED', 'Unauthorized.', false));
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, {
      service: SERVICE_ID,
      version: SERVICE_VERSION,
      provider: {
        kind: 'local-model-router',
        configured: Boolean(options.experts.baseUrl && options.experts.runtimeApiKey),
        expertCount: MODALITIES.length,
      },
      modalities: MODALITIES,
    });
  }
  if (req.method === 'GET' && url.pathname === '/experts/status') {
    return expertsStatusRoute(res, options, fetchImpl, now);
  }
  if (req.method === 'POST' && url.pathname === '/modality/translate') {
    return translateRoute(req, res, options, fetchImpl, now, security.maxBodyBytes);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

// Live availability of the local Model Router boundary. The individual expert runtime remains
// behind Model Router; this service never probes or configures an arbitrary external provider.
async function expertsStatusRoute(
  res: ServerResponse,
  options: SciModalityRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const base = options.experts.baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
  let reachable = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetchImpl(`${base}/health`, {
        headers: { authorization: `Bearer ${options.experts.runtimeApiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.ok) {
      reachable = true;
    }
  } catch {
    reachable = false;
  }
  const experts = MODALITIES.map((modality) => {
    const model = EXPERT_MODEL[modality];
    return { modality, model, online: reachable };
  });
  return sendJson(res, 200, {
    ok: true,
    service: SERVICE_ID,
    modelRouterReachable: reachable,
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
  maxBodyBytes: number,
): Promise<void> {
  const startedAt = now().toISOString();
  let body: ModalityTranslateRequest;
  try {
    body = (await readJson(req, maxBodyBytes)) as ModalityTranslateRequest;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return sendJson(res, 413, errorResult('PAYLOAD_TOO_LARGE', `Request body exceeds ${error.limitBytes} bytes.`, false));
    }
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
      // Expert model not registered behind local Model Router — a config error, not transient.
      return { status: 502, err: { code: 'NOT_FOUND', message: error.message, retryable: false } };
    }
    if (error.httpStatus === 429) {
      return { status: 502, err: { code: 'RATE_LIMITED', message: error.message, retryable: true } };
    }
    return { status: 502, err: { code: 'UNAVAILABLE', message: error.message, retryable: true } };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, err: { code: 'TIMEOUT', message: 'local Model Router expert call timed out', retryable: true } };
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

async function readJson(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentLength = parseContentLength(req.headers['content-length']);
  if (contentLength !== null && contentLength > maxBodyBytes) {
    throw new RequestBodyTooLargeError(maxBodyBytes);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMaxBodyBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_JSON_BODY_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Sci-Modality Router max body bytes must be a positive integer.');
  }
  return value;
}

function normalizeRuntimeToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error(`${SCIMODALITY_ROUTER_RUNTIME_TOKEN_ENV} is required to start the Sci-Modality Router service.`);
  }
  return normalized;
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hasValidRuntimeToken(req: IncomingMessage, expectedToken: string): boolean {
  const providedToken = bearerTokenFromHeader(req.headers.authorization);
  return Boolean(providedToken) && timingSafeStringEqual(providedToken, expectedToken);
}

function bearerTokenFromHeader(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() ?? '';
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super('Request body is too large.');
  }
}
