import {
  LocalTraceStore,
  createTraceId,
  deriveTraceId,
  sanitizeTraceHeaders,
  sanitizeTraceText,
  sanitizeTraceTextChunks,
  sanitizeTraceValue,
  sensitiveTraceValuesFromHeaders,
  type LocalTraceStoreOptions,
  type TraceCorrelation,
  type TraceEventInput,
} from '@sciforge/full-trace';
import { TextDecoder } from 'node:util';

import type { PlanGatewayEvent, PlanGatewayEventSink, PlanGatewayHeaders } from './contract';
import type { CodingPlanAdapterRegistry } from './registry';

const TRACE_SOURCE = 'plan-gateway';

type RequestTraceState = {
  adapterId: string;
  method: string;
  path: string;
  headers: PlanGatewayHeaders;
  headerCorrelation: Partial<TraceCorrelation> & Pick<TraceCorrelation, 'requestId'>;
  startedAt: string;
  requestDecoder: TextDecoder;
  requestBytes: Uint8Array[];
  requestChunks: string[];
  requestChunkByteLengths: number[];
  requestChunkTimestamps: string[];
  requestEnded: boolean;
  requestPersisted: boolean;
  responseDecoder: TextDecoder;
  responseChunks: string[];
  responseChunkByteLengths: number[];
  responseChunkTimestamps: string[];
  responseStatus?: number;
  correlation?: TraceCorrelation;
  sensitiveValues: Set<string>;
};

export type PlanGatewayTraceRecorderOptions = {
  store: Pick<LocalTraceStore, 'append' | 'appendMany'>;
  adapterRegistry: CodingPlanAdapterRegistry;
  staticSensitiveValues?: readonly string[];
};

export class PlanGatewayTraceRecorder {
  readonly eventSink: PlanGatewayEventSink;

  readonly #store: Pick<LocalTraceStore, 'append' | 'appendMany'>;
  readonly #adapterRegistry: CodingPlanAdapterRegistry;
  readonly #staticSensitiveValues: readonly string[];
  readonly #requests = new Map<string, RequestTraceState>();

  constructor(options: PlanGatewayTraceRecorderOptions) {
    this.#store = options.store;
    this.#adapterRegistry = options.adapterRegistry;
    this.#staticSensitiveValues = options.staticSensitiveValues ?? [];
    this.eventSink = (event) => this.record(event);
  }

  async record(event: PlanGatewayEvent): Promise<void> {
    if (event.type === 'request.start') {
      const state: RequestTraceState = {
        adapterId: event.adapterId,
        method: event.method,
        path: event.path,
        headers: event.headers,
        headerCorrelation: event.correlation,
        startedAt: event.at,
        requestDecoder: new TextDecoder('utf-8', { fatal: false }),
        requestBytes: [],
        requestChunks: [],
        requestChunkByteLengths: [],
        requestChunkTimestamps: [],
        requestEnded: false,
        requestPersisted: false,
        responseDecoder: new TextDecoder('utf-8', { fatal: false }),
        responseChunks: [],
        responseChunkByteLengths: [],
        responseChunkTimestamps: [],
        sensitiveValues: new Set([
          ...this.#staticSensitiveValues,
          ...(event.sensitiveValues ?? []),
        ]),
      };
      this.#captureSensitiveHeaders(state, event.headers);
      this.#requests.set(event.requestId, state);
      return;
    }

    const state = this.#requests.get(event.requestId);
    if (!state) return;
    if (event.type === 'request.chunk') {
      if (state.requestPersisted) return;
      state.requestBytes.push(copyBytes(event.chunk));
      state.requestChunks.push(state.requestDecoder.decode(event.chunk, { stream: true }));
      state.requestChunkByteLengths.push(event.chunk.byteLength);
      state.requestChunkTimestamps.push(event.at);
      return;
    }
    if (event.type === 'request.end') {
      state.requestEnded = true;
      await this.#persistRequest(state, false);
      return;
    }
    if (event.type === 'response.start') {
      await this.#persistRequest(state, !state.requestEnded);
      state.responseStatus = event.status;
      this.#captureSensitiveHeaders(state, event.headers);
      await this.#store.append({
        ...requiredCorrelation(state),
        source: TRACE_SOURCE,
        kind: 'model_response_headers',
        timestamp: event.at,
        payload: {
          status: event.status,
          headers: sanitizeTraceHeaders(event.headers, this.#sanitizationOptions(state)),
        },
      });
      return;
    }
    if (event.type === 'response.chunk') {
      state.responseChunks.push(state.responseDecoder.decode(event.chunk, { stream: true }));
      state.responseChunkByteLengths.push(event.chunk.byteLength);
      state.responseChunkTimestamps.push(event.at);
      return;
    }
    if (event.type === 'response.end') {
      try {
        await this.#persistRequest(state, !state.requestEnded);
        await this.#persistResponseChunks(state);
        await this.#store.append({
          ...requiredCorrelation(state),
          source: TRACE_SOURCE,
          kind: 'model_response_end',
          timestamp: event.at,
          payload: {
            status: state.responseStatus,
            durationMs: event.durationMs,
          },
        });
      } finally {
        this.#requests.delete(event.requestId);
      }
      return;
    }

    try {
      await this.#persistRequest(state, true);
      await this.#persistResponseChunks(state);
      await this.#store.append({
        ...requiredCorrelation(state),
        source: TRACE_SOURCE,
        kind: 'error',
        timestamp: event.at,
        payload: {
          name: 'PlanGatewayForwardError',
          message: 'Coding plan forwarding failed.',
          code: event.code,
          stage: 'forward',
          retryable: event.code !== 'PLAN_REQUEST_ABORTED',
          durationMs: event.durationMs,
        },
      });
    } finally {
      this.#requests.delete(event.requestId);
    }
  }

  async #persistRequest(state: RequestTraceState, partial: boolean): Promise<void> {
    if (state.requestPersisted) return;
    appendDecoderTail(state.requestChunks, state.requestDecoder);
    const bodyBytes = Buffer.concat(state.requestBytes.map((chunk) => Buffer.from(chunk)));
    const inspection = this.#adapterRegistry.get(state.adapterId).inspectTraceRequest?.({
      headers: new Headers(state.headers.map(([name, value]): [string, string] => [name, value])),
      body: bodyBytes,
    }) ?? {};
    state.correlation = resolveCorrelation(inspection.correlation ?? {}, state.headerCorrelation);
    const sanitizedBody = sanitizeTraceValue(
      inspection.traceBody ?? state.requestChunks.join(''),
      this.#sanitizationOptions(state),
    );
    await this.#store.append({
      ...requiredCorrelation(state),
      source: TRACE_SOURCE,
      kind: 'model_request',
      timestamp: state.startedAt,
      payload: {
        method: state.method,
        path: sanitizeTraceText(state.path, this.#sanitizationOptions(state)),
        headers: sanitizeTraceHeaders(state.headers, this.#sanitizationOptions(state)),
        body: sanitizedBody,
        byteLength: bodyBytes.byteLength,
        chunkByteLengths: state.requestChunkByteLengths,
        chunkTimestamps: state.requestChunkTimestamps,
        ...(partial ? { partial: true } : {}),
      },
    });
    state.requestPersisted = true;
  }

  async #persistResponseChunks(state: RequestTraceState): Promise<void> {
    if (state.responseChunks.length === 0) return;
    appendDecoderTail(state.responseChunks, state.responseDecoder);
    const sanitizedChunks = sanitizeTraceTextChunks(
      state.responseChunks,
      this.#sanitizationOptions(state),
    );
    const correlation = requiredCorrelation(state);
    const inputs: Array<TraceEventInput<'model_response_chunk'>> = sanitizedChunks.map((body, index) => ({
      ...correlation,
      source: TRACE_SOURCE,
      kind: 'model_response_chunk',
      timestamp: state.responseChunkTimestamps[index],
      payload: {
        index,
        body,
        byteLength: state.responseChunkByteLengths[index],
      },
    }));
    await this.#store.appendMany(inputs);
    state.responseChunks.length = 0;
    state.responseChunkByteLengths.length = 0;
    state.responseChunkTimestamps.length = 0;
  }

  #captureSensitiveHeaders(state: RequestTraceState, headers: PlanGatewayHeaders): void {
    for (const value of sensitiveTraceValuesFromHeaders(headers)) {
      state.sensitiveValues.add(value);
    }
  }

  #sanitizationOptions(state: RequestTraceState): { sensitiveValues: readonly string[] } {
    return { sensitiveValues: [...state.sensitiveValues] };
  }

  activeSensitiveValues(): readonly string[] {
    const values = new Set(this.#staticSensitiveValues);
    for (const state of this.#requests.values()) {
      for (const value of state.sensitiveValues) values.add(value);
    }
    return [...values];
  }
}

export type PlanGatewayTraceCaptureOptions = Omit<LocalTraceStoreOptions, 'sensitiveValues'> & {
  adapterRegistry: CodingPlanAdapterRegistry;
};

export async function createPlanGatewayTraceCapture(
  options: PlanGatewayTraceCaptureOptions,
): Promise<{
  store: LocalTraceStore;
  recorder: PlanGatewayTraceRecorder;
  eventSink: PlanGatewayEventSink;
}> {
  const { adapterRegistry, ...storeOptions } = options;
  let recorder: PlanGatewayTraceRecorder | undefined;
  const store = new LocalTraceStore({
    ...storeOptions,
    sensitiveValues: () => recorder?.activeSensitiveValues() ?? [],
  });
  await store.initialize();
  recorder = new PlanGatewayTraceRecorder({ store, adapterRegistry });
  return { store, recorder, eventSink: recorder.eventSink };
}

function resolveCorrelation(
  adapter: Partial<TraceCorrelation>,
  headers: Partial<TraceCorrelation> & Pick<TraceCorrelation, 'requestId'>,
): TraceCorrelation {
  // Adapter-inspected request metadata is tied to the forwarded body and is
  // authoritative over caller-supplied correlation headers.
  const adapterScope = adapter.runtimeId !== undefined && adapter.threadId !== undefined;
  const combined = adapterScope
    ? { ...headers, ...adapter, traceId: adapter.traceId }
    : { ...headers, ...adapter };
  const traceId = (adapterScope ? adapter.traceId : combined.traceId) ?? (
    combined.runtimeId && combined.threadId
      ? deriveTraceId({
          runtimeId: combined.runtimeId,
          threadId: combined.threadId,
          turnId: combined.turnId,
        })
      : createTraceId()
  );
  return {
    ...combined,
    traceId,
    requestId: headers.requestId,
  };
}

function requiredCorrelation(state: RequestTraceState): TraceCorrelation {
  if (!state.correlation) throw new Error('Plan Gateway trace correlation is not initialized.');
  return state.correlation;
}

function appendDecoderTail(chunks: string[], decoder: TextDecoder): void {
  const tail = decoder.decode();
  if (!tail) return;
  if (chunks.length === 0) chunks.push(tail);
  else chunks[chunks.length - 1] += tail;
}

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
