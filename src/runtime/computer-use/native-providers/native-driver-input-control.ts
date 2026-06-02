import { sanitizeId } from '../utils.js';
import type { VirtualDisplayProviderOperationOptions } from '../virtual-display-provider.js';

export type NativeVirtualDisplayDriverInputControlOperation =
  | 'sendInputIntent'
  | 'pause'
  | 'resume'
  | 'closeSession';

export interface NativeVirtualDisplayDriverInputControlResult {
  ok: boolean;
  detail?: string;
  refs?: Record<string, string | string[] | undefined>;
  mutatingActionExecuted?: boolean;
  providerEvidenceWritten?: boolean;
}

export interface NativeVirtualDisplayDriverInputControlContext {
  providerId: string;
  operation: NativeVirtualDisplayDriverInputControlOperation;
  operationOptions: VirtualDisplayProviderOperationOptions;
  inputIntent: Record<string, unknown>;
  refs: Record<string, string | string[] | undefined>;
  platformState: Record<string, unknown>;
}

export type NativeVirtualDisplayDriverInputControlHook = (
  context: NativeVirtualDisplayDriverInputControlContext,
) =>
  | NativeVirtualDisplayDriverInputControlResult
  | Promise<NativeVirtualDisplayDriverInputControlResult>;

export function nativeDriverInputIntentProjection(
  operationOptions: VirtualDisplayProviderOperationOptions,
): Record<string, unknown> {
  const inputIntent = isRecord(operationOptions.inputIntent)
    ? operationOptions.inputIntent as Record<string, unknown>
    : {};
  const action = isRecord(inputIntent.action) ? inputIntent.action : {};
  return {
    source: stringValue(inputIntent.source),
    kind: stringValue(inputIntent.kind),
    controlKind: stringValue(inputIntent.controlKind),
    actionType: stringValue(action.type),
    frameRef: isRecord(inputIntent.refs) ? stringValue(inputIntent.refs.frameRef) : undefined,
    sessionRef: isRecord(inputIntent.refs) ? stringValue(inputIntent.refs.sessionRef) : undefined,
  };
}

export function nativeDriverInputControlDefaultRefs(input: {
  providerRootRef: string;
  operation: NativeVirtualDisplayDriverInputControlOperation;
  operationOptions: VirtualDisplayProviderOperationOptions;
}): Record<string, string | string[] | undefined> {
  const slug = nativeDriverInputControlSlug(input.operation, input.operationOptions);
  const controlBase = `${input.providerRootRef}/control-plane/${slug}`;
  return {
    inputIntentRefs: [`${input.providerRootRef}/input-intents/${slug}.json`],
    executorEventRefs: [`${input.providerRootRef}/executor-events/${slug}.json`],
    beforeFrameRef: `${input.providerRootRef}/frames/${slug}-before.json`,
    afterFrameRef: `${input.providerRootRef}/frames/${slug}-after.json`,
    beforeAfterFrameRefs: [`${input.providerRootRef}/before-after/${slug}.json`],
    verificationRefs: [`${input.providerRootRef}/verification/${slug}.json`],
    agentQueueRef: input.operation === 'pause' || input.operation === 'resume' || input.operation === 'closeSession'
      ? `${controlBase}/agent-queue.json`
      : undefined,
    currentFrameRefreshRef: input.operation === 'resume'
      ? `${controlBase}/current-frame-refresh.json`
      : undefined,
    safeStopRef: input.operation === 'closeSession'
      ? `${controlBase}/safe-stop.json`
      : undefined,
  };
}

export function missingNativeDriverInputControlRefs(
  operation: NativeVirtualDisplayDriverInputControlOperation,
  refs: Record<string, string | string[] | undefined> | undefined,
) {
  if (!refs) {
    return ['inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs'];
  }
  const missing = [
    stringList(refs.inputIntentRefs).length ? undefined : 'inputIntentRefs',
    stringList(refs.executorEventRefs).length ? undefined : 'executorEventRefs',
    stringValue(refs.beforeFrameRef) ? undefined : 'beforeFrameRef',
    stringValue(refs.afterFrameRef) ? undefined : 'afterFrameRef',
    stringList(refs.beforeAfterFrameRefs).length ? undefined : 'beforeAfterFrameRefs',
    stringList(refs.verificationRefs).length ? undefined : 'verificationRefs',
    (operation === 'pause' || operation === 'resume' || operation === 'closeSession') && !stringValue(refs.agentQueueRef)
      ? 'agentQueueRef'
      : undefined,
    operation === 'resume' && !stringValue(refs.currentFrameRefreshRef) ? 'currentFrameRefreshRef' : undefined,
    operation === 'closeSession' && !stringValue(refs.safeStopRef) ? 'safeStopRef' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return missing;
}

function nativeDriverInputControlSlug(
  operation: NativeVirtualDisplayDriverInputControlOperation,
  operationOptions: VirtualDisplayProviderOperationOptions,
) {
  const inputIntent = nativeDriverInputIntentProjection(operationOptions);
  const kind = typeof inputIntent.controlKind === 'string' && inputIntent.controlKind
    ? inputIntent.controlKind
    : typeof inputIntent.kind === 'string' && inputIntent.kind
      ? inputIntent.kind
      : operation;
  return sanitizeId(`${operation}-${kind}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringList(value: unknown) {
  if (typeof value === 'string' && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
}
