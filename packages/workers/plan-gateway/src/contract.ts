import type { TraceCorrelation } from '@sciforge/full-trace';

export type CodingPlanRoute = Readonly<{
  method: string;
  path: `/${string}`;
}>;

export type CodingPlanWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';

export interface CodingPlanAdapter {
  readonly id: string;
  readonly upstreamBaseUrl: string;
  readonly wireProtocol: CodingPlanWireProtocol;
  readonly allowedRoutes: readonly CodingPlanRoute[];

  createRuntimeConfig(localBaseUrl: string): string;
  transformForwardHeaders(headers: Headers): Headers;
  inspectTraceRequest?(input: Readonly<{
    headers: Headers;
    body: Uint8Array;
  }>): Readonly<{
    correlation?: Partial<TraceCorrelation>;
    /** Provider-specific body prepared for durable tracing; shared redaction still runs afterward. */
    traceBody?: unknown;
  }>;
}

export type PlanGatewayHeaders = ReadonlyArray<readonly [string, string]>;

export type PlanGatewayEvent =
  | Readonly<{
      type: 'request.start';
      requestId: string;
      adapterId: string;
      method: string;
      path: string;
      headers: PlanGatewayHeaders;
      /** In-process redaction inputs; never persisted as an event field. */
      sensitiveValues?: readonly string[];
      correlation: Partial<TraceCorrelation> & Pick<TraceCorrelation, 'requestId'>;
      at: string;
    }>
  | Readonly<{
      type: 'request.chunk';
      requestId: string;
      chunk: Uint8Array;
      at: string;
    }>
  | Readonly<{
      type: 'request.end';
      requestId: string;
      at: string;
    }>
  | Readonly<{
      type: 'response.start';
      requestId: string;
      status: number;
      headers: PlanGatewayHeaders;
      at: string;
    }>
  | Readonly<{
      type: 'response.chunk';
      requestId: string;
      chunk: Uint8Array;
      at: string;
    }>
  | Readonly<{
      type: 'response.end';
      requestId: string;
      durationMs: number;
      at: string;
    }>
  | Readonly<{
      type: 'request.error';
      requestId: string;
      code: string;
      durationMs: number;
      at: string;
    }>;

export type PlanGatewayEventSink = (
  event: PlanGatewayEvent,
) => void | Promise<void>;

export type PlanGatewayUpstreamRequest = Readonly<{
  url: URL;
  method: string;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  signal: AbortSignal;
}>;

export type PlanGatewayUpstreamResponse = Readonly<{
  status: number;
  statusText?: string;
  headers: PlanGatewayHeaders;
  body: AsyncIterable<Uint8Array>;
}>;

export interface PlanGatewayTransport {
  forward(request: PlanGatewayUpstreamRequest): Promise<PlanGatewayUpstreamResponse>;
}

export class PlanGatewayRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PlanGatewayRequestError';
    this.status = status;
    this.code = code;
  }
}
