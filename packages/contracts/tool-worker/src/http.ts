import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ToolInvokeRequest, ToolInvokeResponse, ToolWorker, ToolWorkerHealth, ToolWorkerManifest } from './types';
import {
  ToolProtocolValidationError,
  assertToolInvokeRequest,
  assertToolInvokeResponse,
  assertToolWorkerHealth,
  assertToolWorkerManifest,
} from './validation';

export interface ToolHttpServerOptions {
  host?: string;
  port?: number;
}

export interface StartedToolHttpServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface ToolClient {
  manifest(): Promise<ToolWorkerManifest>;
  health(): Promise<ToolWorkerHealth>;
  invoke(request: ToolInvokeRequest): Promise<ToolInvokeResponse>;
}

export function createToolWorkerServer(worker: ToolWorker): Server {
  assertToolWorkerManifest(worker.manifest);

  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/manifest') {
        return sendJson(response, 200, worker.manifest);
      }
      if (request.method === 'GET' && request.url === '/health') {
        const health = await worker.health();
        assertToolWorkerHealth(health);
        return sendJson(response, statusForHealth(health), health);
      }
      if (request.method === 'POST' && request.url === '/invoke') {
        const body = await readJson(request);
        assertToolInvokeRequest(body);
        const result = await worker.invoke(body);
        assertToolInvokeResponse(result);
        return sendJson(response, result.ok ? 200 : 422, result);
      }
      sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found' } });
    } catch (error) {
      sendJson(response, statusForError(error), serializeError(error));
    }
  });
}

export async function startToolWorkerServer(
  worker: ToolWorker,
  options: ToolHttpServerOptions = {},
): Promise<StartedToolHttpServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createToolWorkerServer(worker);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  return {
    server,
    url,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export function createToolClient(baseUrl: string, init?: RequestInit): ToolClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async manifest() {
      const manifest = await requestJson(`${root}/manifest`, { ...init, method: 'GET' });
      assertToolWorkerManifest(manifest);
      return manifest;
    },
    async health() {
      const health = await requestJson(`${root}/health`, { ...init, method: 'GET' });
      assertToolWorkerHealth(health);
      return health;
    },
    async invoke(request) {
      assertToolInvokeRequest(request);
      const response = await requestJson(`${root}/invoke`, {
        ...init,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...init?.headers },
        body: JSON.stringify(request),
      });
      assertToolInvokeResponse(response);
      return response;
    },
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? {} : JSON.parse(raw);
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = getErrorMessage(payload) ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function statusForHealth(health: ToolWorkerHealth): number {
  if (health.status === 'ok') return 200;
  if (health.status === 'degraded') return 200;
  return 503;
}

function statusForError(error: unknown): number {
  if (error instanceof ToolProtocolValidationError || error instanceof SyntaxError) return 400;
  return 500;
}

function serializeError(error: unknown): ToolInvokeResponse {
  if (error instanceof ToolProtocolValidationError) {
    return { ok: false, error: { code: 'validation_error', message: error.message, details: { issues: error.issues } } };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: 'worker_error', message: error.message } };
  }
  return { ok: false, error: { code: 'worker_error', message: 'Unknown worker error' } };
}

function getErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    return typeof error?.message === 'string' ? error.message : undefined;
  }
  return undefined;
}
