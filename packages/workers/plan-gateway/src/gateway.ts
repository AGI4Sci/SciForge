import { request as httpsRequest } from 'node:https';
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  createRequestId,
  sanitizeTraceText,
  sensitiveTraceValuesFromHeaders,
  traceCorrelationFromHeaders,
} from '@sciforge/full-trace';

import {
  type PlanGatewayEvent,
  type PlanGatewayEventSink,
  PlanGatewayRequestError,
  type PlanGatewayTransport,
  type PlanGatewayUpstreamRequest,
  type PlanGatewayUpstreamResponse,
} from './contract';
import {
  PLAN_GATEWAY_DEFAULT_HOST,
  PLAN_GATEWAY_DEFAULT_MOUNT_PATH,
  PLAN_GATEWAY_DEFAULT_PORT,
  PLAN_GATEWAY_WORKER_ID,
  PLAN_GATEWAY_WORKER_VERSION,
  planGatewayManifest,
} from './manifest';
import { isLoopbackHost, normalizeMountPath } from './network-policy';
import { proxyUrlFromRules } from './proxy';
import type { CodingPlanAdapterRegistry } from './registry';
import {
  assertBearerToken,
  createDelegatedCredentialProvider,
  type PlanGatewayCredentialProvider,
} from './credential';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const INBOUND_CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'api-key',
  'x-api-key',
  'anthropic-api-key',
  'x-anthropic-api-key',
  'token',
  'x-auth-token',
  'x-access-token',
  'access-token',
  'refresh-token',
  'id-token',
  'client-secret',
  'password',
  'credential',
]);
const CREDENTIAL_QUERY_PARAMETERS = new Set([
  'accesstoken',
  'apikey',
  'key',
  'token',
  'authtoken',
  'authorization',
  'refreshtoken',
  'clientsecret',
]);
const inFlightHandlers = new WeakMap<Server, Set<Promise<void>>>();
const { getProxyForUrl } = createRequire(import.meta.url)('proxy-from-env') as {
  getProxyForUrl(url: string): string;
};

export type PlanGatewayServerOptions = {
  adapterId: string;
  adapterRegistry: CodingPlanAdapterRegistry;
  host?: string;
  port?: number;
  mountPath?: string;
  instanceId?: string;
  transport?: PlanGatewayTransport;
  eventSink?: PlanGatewayEventSink;
  log?: (message: string) => void;
};

export type StartedPlanGatewayServer = {
  server: Server;
  origin: string;
  url: string;
  port: number;
  adapterId: string;
  close(): Promise<void>;
};

export function createPlanGatewayServer(options: PlanGatewayServerOptions): Server {
  const host = options.host ?? PLAN_GATEWAY_DEFAULT_HOST;
  const port = options.port ?? PLAN_GATEWAY_DEFAULT_PORT;
  const mountPath = normalizeMountPath(options.mountPath ?? PLAN_GATEWAY_DEFAULT_MOUNT_PATH);
  validateBinding(host, port);
  const adapter = options.adapterRegistry.get(options.adapterId);
  const transport = options.transport ?? new HttpsPlanGatewayTransport();
  const credentialProvider = createDelegatedCredentialProvider();
  const handlers = new Set<Promise<void>>();

  const server = createServer((request, response) => {
    const handler = handleRequest({
      request,
      response,
      adapter,
      mountPath,
      transport,
      credentialProvider,
      instanceId: options.instanceId,
      eventSink: options.eventSink,
      log: options.log,
    });
    handlers.add(handler);
    void handler.then(
      () => handlers.delete(handler),
      () => handlers.delete(handler),
    );
  });
  inFlightHandlers.set(server, handlers);
  return server;
}

export async function startPlanGatewayServer(
  options: PlanGatewayServerOptions,
): Promise<StartedPlanGatewayServer> {
  const host = options.host ?? PLAN_GATEWAY_DEFAULT_HOST;
  const mountPath = normalizeMountPath(options.mountPath ?? PLAN_GATEWAY_DEFAULT_MOUNT_PATH);
  const server = createPlanGatewayServer(options);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.port ?? PLAN_GATEWAY_DEFAULT_PORT, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const displayHost = host.includes(':') ? `[${host}]` : host;
  const origin = `http://${displayHost}:${address.port}`;
  let closing: Promise<void> | undefined;
  return {
    server,
    origin,
    url: `${origin}${mountPath}`,
    port: address.port,
    adapterId: options.adapterId,
    close: () => {
      closing ??= closeServer(server);
      return closing;
    },
  };
}

type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  adapter: ReturnType<CodingPlanAdapterRegistry['get']>;
  mountPath: string;
  transport: PlanGatewayTransport;
  credentialProvider: PlanGatewayCredentialProvider;
  instanceId?: string;
  eventSink?: PlanGatewayEventSink;
  log?: (message: string) => void;
};

async function handleRequest(context: RequestContext): Promise<void> {
  const { request, response } = context;
  try {
    const target = parseRequestTarget(request.url);
    if (target.pathname === '/healthz') {
      if (request.method !== 'GET') return sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET for Plan Gateway health.');
      return sendJson(response, 200, {
        status: 'ok',
        workerId: PLAN_GATEWAY_WORKER_ID,
        version: PLAN_GATEWAY_WORKER_VERSION,
        adapterId: context.adapter.id,
        protocol: context.adapter.wireProtocol,
        upstreamOrigin: new URL(context.adapter.upstreamBaseUrl).origin,
        traceCapture: context.eventSink ? 'ready' : 'disabled',
        ...(context.instanceId ? { instanceId: context.instanceId } : {}),
      });
    }
    if (target.pathname === '/manifest') {
      if (request.method !== 'GET') return sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET for the Plan Gateway manifest.');
      return sendJson(response, 200, planGatewayManifest);
    }
    await forwardPlanRequest(context, target);
  } catch (error) {
    if (error instanceof PlanGatewayRequestError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    context.log?.(`request failed: ${safeErrorMessage(error)}`);
    sendError(
      response,
      502,
      'PLAN_UPSTREAM_UNAVAILABLE',
      'The selected coding-plan service is unavailable. Verify plan authentication and try again.',
    );
  }
}

async function forwardPlanRequest(context: RequestContext, target: URL): Promise<void> {
  const { request, response, adapter } = context;
  const method = (request.method ?? 'GET').toUpperCase();
  const relativePath = stripMountPath(target.pathname, context.mountPath);
  assertAllowedRoute(adapter.allowedRoutes, method, relativePath);
  assertNoCredentialQuery(target);

  const incomingHeaders = headersFromIncomingRequest(request);
  const sensitiveValues = sensitiveTraceValuesFromHeaders(incomingHeaders);
  let forwardHeaders = stripHopByHopHeaders(incomingHeaders);
  forwardHeaders.delete('host');
  forwardHeaders = stripHopByHopHeaders(adapter.transformForwardHeaders(forwardHeaders));
  forwardHeaders.delete('host');
  stripInboundCredentialHeaders(forwardHeaders);
  // Traces record model payloads as text. Request a semantically equivalent
  // uncompressed representation so the same forwarded bytes remain readable
  // and can pass through the shared secret redactor without a decode side path.
  forwardHeaders.set('accept-encoding', 'identity');
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  const upstreamUrl = createUpstreamUrl(adapter.upstreamBaseUrl, relativePath, target.search);
  const propagatedCorrelation = traceCorrelationFromHeaders(forwardHeaders);
  const requestId = propagatedCorrelation.requestId ?? createRequestId();
  const correlation = { ...propagatedCorrelation, requestId };
  const startedAt = Date.now();

  const emitRequestStart = async (headers: Headers): Promise<void> => emitEvent(context, {
    type: 'request.start',
    requestId,
    adapterId: adapter.id,
    method,
    path: `${target.pathname}${target.search}`,
    headers: [...headers.entries()],
    sensitiveValues,
    correlation,
    at: now(),
  });
  let traceStarted = false;

  try {
    const bearerToken = await context.credentialProvider.getBearerToken({
      adapterId: adapter.id,
      upstreamOrigin: upstreamUrl.origin,
      incomingHeaders: new Headers([...incomingHeaders.entries()]),
      signal: controller.signal,
    });
    forwardHeaders.delete('authorization');
    forwardHeaders.set('authorization', `Bearer ${assertBearerToken(bearerToken)}`);
    await emitRequestStart(forwardHeaders);
    traceStarted = true;
    const upstreamResponse = await context.transport.forward({
      url: upstreamUrl,
      method,
      headers: forwardHeaders,
      body: captureRequestBody(request, requestId, context),
      signal: controller.signal,
    });

    const responseHeaders = stripHopByHopHeaderPairs(upstreamResponse.headers);
    if (hasNonIdentityContentEncoding(responseHeaders)) {
      controller.abort();
      throw new PlanGatewayRequestError(
        502,
        'PLAN_RESPONSE_ENCODING_UNSUPPORTED',
        'The coding-plan service returned a compressed response after identity encoding was requested.',
      );
    }
    await emitEvent(context, {
      type: 'response.start',
      requestId,
      status: upstreamResponse.status,
      headers: responseHeaders,
      at: now(),
    });
    const rawResponseHeaders = responseHeaders.flatMap(([name, value]) => [name, value]);
    if (upstreamResponse.statusText) {
      response.writeHead(upstreamResponse.status, upstreamResponse.statusText, rawResponseHeaders);
    } else {
      response.writeHead(upstreamResponse.status, rawResponseHeaders);
    }

    for await (const value of upstreamResponse.body) {
      const chunk = copyBytes(value);
      await emitEvent(context, { type: 'response.chunk', requestId, chunk, at: now() });
      if (!response.write(chunk)) await once(response, 'drain');
    }
    response.end();
    await emitEvent(context, {
      type: 'response.end',
      requestId,
      durationMs: Date.now() - startedAt,
      at: now(),
    });
  } catch (error) {
    if (!traceStarted) await emitRequestStart(forwardHeaders);
    await emitEvent(context, {
      type: 'request.error',
      requestId,
      code: error instanceof PlanGatewayRequestError
        ? error.code
        : controller.signal.aborted
          ? 'PLAN_REQUEST_ABORTED'
          : 'PLAN_UPSTREAM_UNAVAILABLE',
      durationMs: Date.now() - startedAt,
      at: now(),
    });
    throw error;
  }
}

async function* captureRequestBody(
  request: IncomingMessage,
  requestId: string,
  context: RequestContext,
): AsyncGenerator<Uint8Array> {
  for await (const value of request) {
    const chunk = copyBytes(value);
    await emitEvent(context, { type: 'request.chunk', requestId, chunk, at: now() });
    yield chunk;
  }
  await emitEvent(context, { type: 'request.end', requestId, at: now() });
}

export class HttpsPlanGatewayTransport implements PlanGatewayTransport {
  private readonly proxyAgents = new Map<string, HttpsProxyAgent<string> | SocksProxyAgent>();

  constructor(private readonly proxyRules?: string) {}

  async forward(request: PlanGatewayUpstreamRequest): Promise<PlanGatewayUpstreamResponse> {
    if (request.url.protocol !== 'https:') {
      throw new Error('Plan Gateway transport accepts only HTTPS upstream URLs.');
    }
    return new Promise<PlanGatewayUpstreamResponse>((resolve, reject) => {
      const upstreamRequest = httpsRequest(
        request.url,
        {
          method: request.method,
          headers: headersToOutgoing(request.headers),
          agent: this.agentFor(request.url),
          signal: request.signal,
        },
        (upstreamResponse) => {
          resolve({
            status: upstreamResponse.statusCode ?? 502,
            statusText: upstreamResponse.statusMessage,
            headers: rawHeaderPairs(upstreamResponse.rawHeaders),
            body: incomingBody(upstreamResponse),
          });
        },
      );
      upstreamRequest.once('error', reject);
      void pumpRequestBody(request.body, upstreamRequest).catch((error) => {
        upstreamRequest.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private agentFor(url: URL): HttpsProxyAgent<string> | SocksProxyAgent | undefined {
    const proxyUrl = this.proxyRules === undefined
      ? getProxyForUrl(url.toString())
      : proxyUrlFromRules(this.proxyRules);
    if (!proxyUrl) return undefined;
    const cached = this.proxyAgents.get(proxyUrl);
    if (cached) return cached;
    const protocol = new URL(proxyUrl).protocol;
    const agent = protocol.startsWith('socks')
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);
    this.proxyAgents.set(proxyUrl, agent);
    return agent;
  }
}

async function pumpRequestBody(
  body: AsyncIterable<Uint8Array>,
  target: ReturnType<typeof httpsRequest>,
): Promise<void> {
  for await (const chunk of body) {
    if (!target.write(chunk)) await once(target, 'drain');
  }
  target.end();
}

async function* incomingBody(response: IncomingMessage): AsyncGenerator<Uint8Array> {
  for await (const value of response) yield copyBytes(value);
}

function parseRequestTarget(value: string | undefined): URL {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    throw new PlanGatewayRequestError(400, 'INVALID_REQUEST_TARGET', 'Plan Gateway requires an origin-form request target.');
  }
  return new URL(value, 'http://plan-gateway.invalid');
}

function stripMountPath(pathname: string, mountPath: string): `/${string}` {
  if (!mountPath) return pathname as `/${string}`;
  if (!pathname.startsWith(`${mountPath}/`)) {
    throw new PlanGatewayRequestError(404, 'PLAN_ROUTE_NOT_ALLOWED', 'This route is not allowed by the selected coding-plan adapter.');
  }
  return pathname.slice(mountPath.length) as `/${string}`;
}

function assertAllowedRoute(
  routes: readonly { method: string; path: `/${string}` }[],
  method: string,
  path: `/${string}`,
): void {
  if (routes.some((route) => route.method.toUpperCase() === method && route.path === path)) return;
  const status = routes.some((route) => route.path === path) ? 405 : 404;
  throw new PlanGatewayRequestError(
    status,
    'PLAN_ROUTE_NOT_ALLOWED',
    'This route is not allowed by the selected coding-plan adapter.',
  );
}

function assertNoCredentialQuery(target: URL): void {
  for (const name of target.searchParams.keys()) {
    const normalized = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
    const compact = normalized.replaceAll('_', '');
    if (!CREDENTIAL_QUERY_PARAMETERS.has(compact) && !isCredentialName(normalized)) continue;
    throw new PlanGatewayRequestError(
      400,
      'PLAN_QUERY_CREDENTIAL_NOT_ALLOWED',
      'Coding-plan credentials must be supplied only through the configured credential provider.',
    );
  }
}

function createUpstreamUrl(baseUrl: string, path: string, search: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
  url.search = search;
  return url;
}

function headersFromIncomingRequest(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
  }
  return headers;
}

function stripHopByHopHeaders(input: Headers): Headers {
  const output = new Headers(input);
  const connectionHeaders = connectionHeaderNames(output.get('connection'));
  for (const name of [...HOP_BY_HOP_HEADERS, ...connectionHeaders]) output.delete(name);
  return output;
}

function stripInboundCredentialHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (INBOUND_CREDENTIAL_HEADERS.has(name) || isCredentialName(name)) headers.delete(name);
  }
}

/** Keep provider-specific token headers from becoming a second auth channel. */
function isCredentialName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  return /(?:^|_)(?:auth|token|key|secret|credential|password|cookie|session)(?:_|$)/.test(normalized);
}

function stripHopByHopHeaderPairs(headers: ReadonlyArray<readonly [string, string]>): Array<[string, string]> {
  const connectionValue = headers
    .filter(([name]) => name.toLowerCase() === 'connection')
    .map(([, value]) => value)
    .join(',');
  const excluded = new Set([...HOP_BY_HOP_HEADERS, ...connectionHeaderNames(connectionValue)]);
  return headers
    .filter(([name]) => !excluded.has(name.toLowerCase()))
    .map(([name, value]) => [name, value]);
}

function hasNonIdentityContentEncoding(headers: ReadonlyArray<readonly [string, string]>): boolean {
  return headers
    .filter(([name]) => name.toLowerCase() === 'content-encoding')
    .flatMap(([, value]) => value.split(','))
    .some((encoding) => {
      const normalized = encoding.trim().toLowerCase();
      return normalized !== '' && normalized !== 'identity';
    });
}

function connectionHeaderNames(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function headersToOutgoing(headers: Headers): OutgoingHttpHeaders {
  return Object.fromEntries(headers.entries());
}

function rawHeaderPairs(rawHeaders: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push([rawHeaders[index], rawHeaders[index + 1]]);
  }
  return pairs;
}

function copyBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value));
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return new Uint8Array(Buffer.from(value as ArrayBuffer));
}

async function emitEvent(context: RequestContext, event: PlanGatewayEvent): Promise<void> {
  try {
    await context.eventSink?.(event);
  } catch (error) {
    context.log?.(`event sink failed: ${safeErrorMessage(error)}`);
  }
}

function validateBinding(host: string, port: number): void {
  if (!isLoopbackHost(host)) {
    throw new Error(`Plan Gateway can bind only to a loopback IP address: ${host}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid Plan Gateway port: ${port}`);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  sendJson(response, status, { error: { code, message } });
}

function safeErrorMessage(error: unknown): string {
  return sanitizeTraceText(error instanceof Error ? error.message : String(error));
}

function now(): string {
  return new Date().toISOString();
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const handlers = inFlightHandlers.get(server);
  while (handlers?.size) {
    await Promise.allSettled([...handlers]);
  }
}
