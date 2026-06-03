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
  inputAdapterCapability?: {
    ok: boolean;
    mechanism?: string;
    detail?: string;
    refs?: Record<string, string | string[] | undefined>;
  };
  refs?: Record<string, string | string[] | undefined>;
  mutatingActionExecuted?: boolean;
  providerEvidenceWritten?: boolean;
  affectsPhysicalDisplay?: boolean;
  sharedSystemInputUsed?: boolean;
  systemPointerMoved?: boolean;
  systemKeyboardEventsSent?: boolean;
}

export interface NativeVirtualDisplayDriverInputControlContext {
  providerId: string;
  operation: NativeVirtualDisplayDriverInputControlOperation;
  operationOptions: VirtualDisplayProviderOperationOptions;
  capabilityProbe?: boolean;
  inputIntent: Record<string, unknown>;
  refs: Record<string, string | string[] | undefined>;
  evidenceRoot?: {
    outDir: string;
    runDirRef: string;
    providerRootRef: string;
  };
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
    isolationEvidenceRefs: [`${controlBase}/isolation-evidence.json`],
    physicalDesktopProbeRefs: [`${controlBase}/physical-desktop-probe.json`],
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
    return ['inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs', 'isolationEvidenceRefs', 'physicalDesktopProbeRefs'];
  }
  const missing = [
    stringList(refs.inputIntentRefs).length ? undefined : 'inputIntentRefs',
    stringList(refs.executorEventRefs).length ? undefined : 'executorEventRefs',
    stringValue(refs.beforeFrameRef) ? undefined : 'beforeFrameRef',
    stringValue(refs.afterFrameRef) ? undefined : 'afterFrameRef',
    stringList(refs.beforeAfterFrameRefs).length ? undefined : 'beforeAfterFrameRefs',
    stringList(refs.verificationRefs).length ? undefined : 'verificationRefs',
    stringList(refs.isolationEvidenceRefs).length ? undefined : 'isolationEvidenceRefs',
    stringList(refs.physicalDesktopProbeRefs).length ? undefined : 'physicalDesktopProbeRefs',
    (operation === 'pause' || operation === 'resume' || operation === 'closeSession') && !stringValue(refs.agentQueueRef)
      ? 'agentQueueRef'
      : undefined,
    operation === 'resume' && !stringValue(refs.currentFrameRefreshRef) ? 'currentFrameRefreshRef' : undefined,
    operation === 'closeSession' && !stringValue(refs.safeStopRef) ? 'safeStopRef' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return missing;
}

export function nativeDriverInputControlRefScopeIssues(
  contextRefs: Record<string, string | string[] | undefined>,
  refs: Record<string, string | string[] | undefined> | undefined,
) {
  const providerRootRef = stringValue(contextRefs.providerRootRef);
  if (!providerRootRef) return ['missing providerRootRef'];
  const providerRootUnsafeReason = unsafeLogicalRefReason(providerRootRef);
  if (providerRootUnsafeReason) return [`providerRootRef unsafe logical ref (${providerRootUnsafeReason})`];
  const scopedRefs: Array<{ key: string; ref: string }> = [
    ...scopedRefList('inputIntentRefs', refs?.inputIntentRefs),
    ...scopedRefList('executorEventRefs', refs?.executorEventRefs),
    ...scopedRefList('beforeAfterFrameRefs', refs?.beforeAfterFrameRefs),
    ...scopedRefList('verificationRefs', refs?.verificationRefs),
    ...scopedRefList('isolationEvidenceRefs', refs?.isolationEvidenceRefs),
    ...scopedRefList('physicalDesktopProbeRefs', refs?.physicalDesktopProbeRefs),
    ...scopedRefValue('beforeFrameRef', refs?.beforeFrameRef),
    ...scopedRefValue('afterFrameRef', refs?.afterFrameRef),
    ...scopedRefValue('agentQueueRef', refs?.agentQueueRef),
    ...scopedRefValue('currentFrameRefreshRef', refs?.currentFrameRefreshRef),
    ...scopedRefValue('safeStopRef', refs?.safeStopRef),
  ];
  return scopedRefs
    .flatMap(({ key, ref }) => {
      const unsafeReason = unsafeLogicalRefReason(ref);
      if (unsafeReason) return [`${key} unsafe logical ref (${unsafeReason})`];
      return ref.startsWith(`${providerRootRef}/`) ? [] : [`${key} outside current provider root`];
    });
}

export function nativeDriverInputControlSafeFailureDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const detail = value.trim();
  if (!detail || detail.length > 240) return undefined;
  if (/[^\x20-\x7e]/u.test(detail)) return undefined;
  if (/[\r\n\t{}[\]"'`\\]/u.test(detail)) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:;,+/=() -]*$/u.test(detail)) return undefined;
  if (/(?:secret|token|credential|password|passwd|authorization|bearer|api[-_ ]?key|private[-_ ]?key|cookie)/iu.test(detail)) {
    return undefined;
  }
  if (/(?:computer-use:|provider:|\.sciforge|\/(?:Applications|Users|Volumes|private|tmp|var|opt|usr|etc|home)\b|[A-Za-z]:\\)/u.test(detail)) {
    return undefined;
  }
  return detail;
}

export function nativeDriverInputControlIsolationIssues(
  result: NativeVirtualDisplayDriverInputControlResult,
) {
  return [
    result.affectsPhysicalDisplay === false ? undefined : 'affectsPhysicalDisplay=false',
    result.sharedSystemInputUsed === false ? undefined : 'sharedSystemInputUsed=false',
    result.systemPointerMoved === false ? undefined : 'systemPointerMoved=false',
    result.systemKeyboardEventsSent === false ? undefined : 'systemKeyboardEventsSent=false',
  ].filter((entry): entry is string => Boolean(entry));
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

function scopedRefList(key: string, value: string | string[] | undefined) {
  return stringList(value).map((ref) => ({ key, ref }));
}

function scopedRefValue(key: string, value: string | string[] | undefined) {
  const ref = stringValue(value);
  return ref ? [{ key, ref }] : [];
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

function unsafeLogicalRefReason(ref: string): string | undefined {
  const pathPart = ref.split(/[?#]/u)[0] ?? ref;
  for (const candidate of decodedPathCandidates(pathPart)) {
    if (candidate.includes('\\')) return 'unsafe logical ref contains a path separator escape';
    const segments = candidate.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return 'unsafe logical ref contains traversal segments';
    }
  }
  return undefined;
}

function decodedPathCandidates(value: string) {
  const candidates = [value];
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    if (!current.includes('%')) break;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      candidates.push(decoded);
      current = decoded;
    } catch {
      candidates.push('\\');
      break;
    }
  }
  return candidates;
}
