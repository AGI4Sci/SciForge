import type { GatewayRequest, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { COMPUTER_USE_ACTION_PROVIDER_ID } from '../computer-use/host-adapter.js';
import { VISION_TOOL_ID } from '../vision-sense/trace-policy.js';
import type {
  CodexAppServerStartTurnRequest,
  CodexAppServerTurnStream,
} from './codex-app-server-adapter.js';

export interface ComputerUseNativeRouteInput {
  request: CodexAppServerStartTurnRequest;
  workspace: string;
  provider: string;
  model: string;
  profile: string;
  abortSignal?: AbortSignal;
}

const NORMALIZED_SCHEMA_VERSION = 'sciforge.codex.normalized-event.v1' as const;

export function isComputerUseNativeRouteCommand(commandText: string): boolean {
  const text = computerUseNativeRouteCommandText(commandText);
  if (!text) return false;
  if (!/^\/(?:computer-use|computer\s+use)\b/i.test(text)) return false;
  return !/^\/(?:computer-use|computer\s+use)\s+diagnostic\b/i.test(text);
}

export function computerUseNativeRouteCommandText(commandText: string): string | undefined {
  const text = commandText.trimStart();
  if (!/^\/(?:computer-use|computer\s+use)\b/i.test(text)) return undefined;
  return text.split(/\r?\n\s*\r?\n/, 1)[0]?.trim();
}

export function createComputerUseNativeRouteStream(input: ComputerUseNativeRouteInput): CodexAppServerTurnStream | undefined {
  if (!isComputerUseNativeRouteCommand(input.request.commandText)) return undefined;
  return {
    turnId: input.request.commandId,
    provider: input.provider,
    model: input.model,
    profile: input.profile,
    workspacePath: input.workspace,
    events: computerUseNativeRouteEvents(input),
  };
}

async function* computerUseNativeRouteEvents(input: ComputerUseNativeRouteInput): AsyncIterable<Record<string, unknown>> {
  const queue = new AsyncEventQueue<Record<string, unknown>>();
  const metadata = routeMetadata(input);
  const request = computerUseGatewayRequest(input);
  const run = runComputerUseNativeRoute(input, request, queue, metadata);
  try {
    for await (const event of queue) yield event;
    await run;
  } finally {
    input.abortSignal?.removeEventListener('abort', queue.abort);
  }
}

async function runComputerUseNativeRoute(
  input: ComputerUseNativeRouteInput,
  request: GatewayRequest,
  queue: AsyncEventQueue<Record<string, unknown>>,
  metadata: RouteMetadata,
) {
  const abort = () => queue.push(failedEvent(metadata, 'Runtime Codex Computer Use native route was cancelled.'));
  input.abortSignal?.addEventListener('abort', abort, { once: true });
  queue.abort = abort;
  try {
    queue.push(operationEvent(metadata, 'Runtime Codex selected the Computer Use native package bridge.', 'running'));
    const { tryRunVisionSenseRuntime } = await import('../vision-sense-runtime.js');
    const payload = await tryRunVisionSenseRuntime(request, {
      signal: input.abortSignal,
      onEvent(event) {
        queue.push(workspaceRuntimeEvent(metadata, event));
      },
    });
    if (!payload) {
      queue.push(failedEvent(metadata, 'Computer Use native route did not select a package bridge runtime.'));
      return;
    }
    queue.push(doneEvent(metadata, payload));
  } catch (error) {
    queue.push(failedEvent(metadata, error instanceof Error ? error.message : String(error)));
  } finally {
    input.abortSignal?.removeEventListener('abort', abort);
    queue.end();
  }
}

function computerUseGatewayRequest(input: ComputerUseNativeRouteInput): GatewayRequest {
  const commandText = computerUseNativeRouteCommandText(input.request.commandText) ?? input.request.commandText;
  const approvalRef = approvalRefFromCommandText(commandText)
    ?? stringField(input.request.humanApproval, 'approvalRef')
    ?? stringField(input.request.uiState, 'approvalRef')
    ?? stringField(input.request.uiState, 'computerUseApprovalRef');
  const requestUiState = isRecord(input.request.uiState) ? input.request.uiState : {};
  const requestHumanApproval = isRecord(input.request.humanApproval) ? input.request.humanApproval : {};
  return {
    skillDomain: 'knowledge',
    prompt: commandText,
    handoffSource: 'ui-chat',
    workspacePath: input.workspace,
    artifacts: [],
    references: [],
    selectedToolIds: [VISION_TOOL_ID],
    selectedSenseIds: [VISION_TOOL_ID],
    selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
    expectedEvidenceKinds: [
      'computer-use-tui-host-actions',
      'vision-trace',
      'tui-host-run-task-chain',
    ],
    uiState: {
      schemaVersion: 'sciforge.runtime-codex.computer-use-native-route.v1',
      ...requestUiState,
      selectedToolIds: [VISION_TOOL_ID],
      selectedSenseIds: [VISION_TOOL_ID],
      selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
      allowOpenAiRuntime: input.request.allowOpenAiRuntime === true,
      entrypoint: 'runtime-codex-commandText',
      terminalEquivalentText: true,
      computerUseApprovalRef: approvalRef,
    },
    humanApproval: approvalRef ? {
      ...requestHumanApproval,
      approvalRef,
      decision: 'approved',
      source: 'runtime-codex-commandText',
    } : undefined,
  };
}

function workspaceRuntimeEvent(metadata: RouteMetadata, event: WorkspaceRuntimeEvent): Record<string, unknown> {
  if (event.type === 'computer-use.tui-host-actions') {
    return compactRecord({
      ...baseEvent(metadata, event.type),
      status: event.status,
      source: event.source,
      toolName: event.toolName,
      message: event.message,
      text: event.text,
      detail: event.detail,
      output: event.output,
    });
  }
  return operationEvent(
    metadata,
    event.message ?? event.text ?? event.detail ?? event.type,
    event.status ?? 'running',
  );
}

function operationEvent(
  metadata: RouteMetadata,
  message: string,
  status: string,
): Record<string, unknown> {
  return compactRecord({
    ...baseEvent(metadata, 'operation_progress'),
    status,
    message,
    text: message,
  });
}

function doneEvent(metadata: RouteMetadata, payload: ToolPayload): Record<string, unknown> {
  return compactRecord({
    ...baseEvent(metadata, 'done'),
    ...payload,
    status: statusFromPayload(payload),
    message: payload.message,
    text: payload.message,
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    evidenceRefs: metadata.evidenceRefs,
  });
}

function failedEvent(metadata: RouteMetadata, message: string): Record<string, unknown> {
  return compactRecord({
    ...baseEvent(metadata, 'failed'),
    status: 'failed',
    message,
    text: message,
  });
}

function statusFromPayload(payload: ToolPayload) {
  const status = stringField(payload, 'status') ?? firstExecutionUnitStatus(payload);
  return status ?? 'done';
}

function firstExecutionUnitStatus(payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  for (const unit of units) {
    const status = stringField(unit, 'status');
    if (status) return status;
  }
  return undefined;
}

interface RouteMetadata {
  commandId: string;
  attemptId: string;
  evidenceRefs: string[];
}

function routeMetadata(input: ComputerUseNativeRouteInput): RouteMetadata {
  return {
    commandId: input.request.commandId,
    attemptId: input.request.attemptId,
    evidenceRefs: [
      `audit:codex-app-server:${input.request.commandId}:${input.request.attemptId}:normalized-events`,
      `audit:computer-use-native-route:${input.request.commandId}:${input.request.attemptId}`,
    ],
  };
}

function baseEvent(metadata: RouteMetadata, type: string) {
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    type,
    timestamp: new Date().toISOString(),
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    evidenceRefs: metadata.evidenceRefs,
  };
}

function approvalRefFromCommandText(commandText: string): string | undefined {
  const match = /(?:^|\s)--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(commandText);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value?.trim() || undefined;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function stringField(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;
  abort: () => void = () => {};

  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
