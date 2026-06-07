import { authorizationProfileOrDefault, classifyComputerUseRisk } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { NormalizedCodexAgentHostInput } from './agent-host-grounding.js';
import type {
  CodexAgentHostActTimeTruthSource,
  CodexAgentHostBrowserActTimeStoreResult,
  CodexAgentHostBrowserActTimeStores,
} from './agent-host-runtime-truth-resolver.js';
import type { VirtualAppScreenNativeHostSessionRecord } from '../computer-use/virtual-app-screen-native-host-session-store.js';
import type { VirtualAppScreenProviderSessionRecord } from '../computer-use/virtual-app-screen-provider-session-store.js';

const OBSERVATION_MAX_AGE_MS = 60_000;

type MaybePromise<T> = T | Promise<T>;

export interface CodexAgentHostVirtualAppScreenActTimeStoreInput {
  agentHostInput: NormalizedCodexAgentHostInput;
  nativeHostSession: VirtualAppScreenNativeHostSessionRecord;
  providerSession?: VirtualAppScreenProviderSessionRecord;
  sessionId: string;
  sessionRef: string;
  screenRef: string;
  targetRefs: string[];
  observationRefs: string[];
  commandText: string;
  commandId: string;
  attemptId: string;
  workspacePath: string;
  riskCategory: string;
  abortSignal?: AbortSignal;
}

export interface CodexAgentHostVirtualAppScreenActTimeStores extends CodexAgentHostBrowserActTimeStores {
  computerUseAdapterRegistry?: CodexAgentHostBrowserActTimeStores['computerUseAdapterRegistry'] & {
    materializeVirtualAppScreenNativeHostAdapter?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
  permissionLedger?: CodexAgentHostBrowserActTimeStores['permissionLedger'] & {
    materializeVirtualAppScreenNativeHostTurnPermission?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
  stopCancelTakeoverStore?: CodexAgentHostBrowserActTimeStores['stopCancelTakeoverStore'] & {
    materializeForVirtualAppScreenNativeHostSession?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
}

export function createDefaultVirtualAppScreenNativeHostActTimeTruthSource(options: {
  now?: () => Date;
  stores?: CodexAgentHostVirtualAppScreenActTimeStores;
} = {}): CodexAgentHostActTimeTruthSource {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const candidate = await virtualAppScreenNativeHostCandidate(input.agentHostInput);
    if (!candidate || !virtualAppScreenNativeHostReady(candidate.nativeHostSession, now())) return undefined;
    const record = candidate.nativeHostSession;
    const providerSession = candidate.providerSession;
    const sessionId = safeRefPart(record.sessionId);
    if (sessionId === 'unknown') return undefined;
    const commandId = safeRefPart(input.commandId ?? 'codex-command-agent-host');
    const attemptId = safeRefPart(input.attemptId ?? `${commandId}-attempt-1`);
    const authorizationProfile = authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile;
    const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile });
    const riskCategory = safeRefPart(risk.category);
    const targetRefs = uniqueStrings([
      record.sessionRef,
      record.screenRef,
      record.targetWindowRef,
      record.liveSurfaceRef,
      providerSession?.targetAppRef,
      providerSession?.surfaceOwnerRef,
      providerSession?.displayOwnerRef,
      providerSession?.surfaceIdentityRef,
      providerSession?.providerSessionOwnerRef,
      providerSession?.reconnectRef,
    ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0));
    const observationRefs = uniqueStrings([
      record.currentFrameRef,
      record.frameStreamRef,
      record.evidenceLedgerRef,
      record.currentRunPointerRef,
      providerSession?.currentFrameRef,
      providerSession?.frameTelemetryRef,
    ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0));
    const storeInput: CodexAgentHostVirtualAppScreenActTimeStoreInput = {
      agentHostInput: input.agentHostInput,
      nativeHostSession: record,
      providerSession,
      sessionId,
      sessionRef: record.sessionRef,
      screenRef: record.screenRef!,
      targetRefs,
      observationRefs,
      commandText: input.commandText,
      commandId,
      attemptId,
      workspacePath: input.workspacePath,
      riskCategory,
      abortSignal: input.abortSignal,
    };
    const storedAdapter = await options.stores?.computerUseAdapterRegistry?.materializeVirtualAppScreenNativeHostAdapter?.(storeInput);
    const storedPermission = await options.stores?.permissionLedger?.materializeVirtualAppScreenNativeHostTurnPermission?.(storeInput);
    const storedStopCancel = await options.stores?.stopCancelTakeoverStore?.materializeForVirtualAppScreenNativeHostSession?.(storeInput);
    const windowActionRefs = uniqueStrings([
      record.sessionRef,
      record.inputLeaseRef,
      record.liveBindingAttachGrantRef,
      record.grantValidationRef,
      record.evidenceLedgerRef,
      record.currentRunPointerRef,
      providerSession?.providerSessionOwnerRef,
      providerSession?.surfaceIdentityRef,
    ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0));
    const adapterRefs = storedAdapter
      ? recordLikeStringList(storedAdapter.refs)
      : [record.actionAdapterRef, record.adapterReadinessRef].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
    const nativePermissionRefs = nativeHostPermissionRefs(record);
    const permissionRefs = storedPermission
      ? uniqueStrings([...recordLikeStringList(storedPermission.refs), ...recordLikeStringList(storedPermission.permissionRefs)])
      : nativePermissionRefs;
    const stopCancelRefs = storedStopCancel
      ? uniqueStrings([...recordLikeStringList(storedStopCancel.refs), ...recordLikeStringList(storedStopCancel.stopCancelRefs)])
      : [];
    return {
      schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
      source: 'virtual-app-screen-native-host-act-time-source',
      target: {
        bound: true,
        summary: virtualAppScreenTargetSummary(record),
        refs: targetRefs,
      },
      observation: {
        fresh: virtualAppScreenObservationFresh(record, now()),
        refs: observationRefs,
      },
      sessions: {
        sessionReadyRefs: uniqueStrings(windowActionRefs),
        targetRefs,
        inputLeaseRefs: [record.inputLeaseRef].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        observationRefs: virtualAppScreenObservationFresh(record, now()) ? observationRefs : [],
      },
      windowActionSession: {
        status: 'ready',
        summary: virtualAppScreenTargetSummary(record),
        refs: windowActionRefs,
      },
      computerUseAdapter: {
        status: storedAdapter ? storeResultStatus(storedAdapter) : 'ready',
        providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.virtual-app-screen.native-host-window-action',
        refs: adapterRefs,
      },
      adapter: {
        providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.virtual-app-screen.native-host-window-action',
        refs: adapterRefs,
        capabilityRefs: [
          record.adapterReadinessRef,
          `runtime-truth:computer-use-capability/virtual-app-screen/${sessionId}`,
        ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        inputIsolation: {
          mode: 'virtual-app-screen-lease',
          refsOnly: true,
          sharedSystemInput: false,
          requiresFocusLease: false,
          singleInteractiveTruth: true,
          secondTruthSource: false,
          refs: [record.inputLeaseRef, record.liveSurfaceRef].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        },
      },
      permissions: {
        refs: permissionRefs,
        permissionRefs,
        appAllowlistRefs: [`runtime-truth:app-allowlist/virtual-app-screen/${sessionId}`],
        windowAllowlistRefs: [`runtime-truth:window-allowlist/virtual-app-screen/${sessionId}`],
        riskPreviewRefs: [`action-ledger:computer-use/native-host/${sessionId}/risk/${riskCategory}`],
        stopCancelPath: stopCancelRefs.length > 0,
        stopCancelRefs,
      },
      refs: uniqueStrings([
        ...targetRefs,
        ...observationRefs,
        ...windowActionRefs,
        ...adapterRefs,
        ...permissionRefs,
        ...stopCancelRefs,
        record.currentRunRef,
        record.currentRunPointerRef,
        record.adapterReadinessRef,
        record.evidenceLedgerRef,
        `action-ledger:computer-use/native-host/${sessionId}/risk/${riskCategory}`,
        `runtime-truth:act-source/virtual-app-screen/${sessionId}`,
      ]),
    };
  };
}

async function virtualAppScreenNativeHostCandidate(input: NormalizedCodexAgentHostInput): Promise<{
  nativeHostSession: VirtualAppScreenNativeHostSessionRecord;
  providerSession?: VirtualAppScreenProviderSessionRecord;
} | undefined> {
  const [
    { readVirtualAppScreenNativeHostSessionRecord },
    { readVirtualAppScreenProviderSessionRecord },
  ] = await Promise.all([
    import('../computer-use/virtual-app-screen-native-host-session-store.js'),
    import('../computer-use/virtual-app-screen-provider-session-store.js'),
  ]);
  for (const ref of virtualAppScreenCandidateRefs(input)) {
    const nativeBySession = readVirtualAppScreenNativeHostSessionRecord({ sessionRef: ref });
    const nativeByScreen = readVirtualAppScreenNativeHostSessionRecord({ screenRef: ref });
    const providerBySession = readVirtualAppScreenProviderSessionRecord({ sessionRef: ref });
    const providerByScreen = readVirtualAppScreenProviderSessionRecord({ screenRef: ref });
    const providerSession = providerBySession ?? providerByScreen;
    const nativeFromProvider = providerSession
      ? readVirtualAppScreenNativeHostSessionRecord({
        sessionRef: providerSession.sessionRef,
        screenRef: providerSession.screenRef,
      })
      : undefined;
    const nativeHostSession = nativeBySession ?? nativeByScreen ?? nativeFromProvider;
    if (nativeHostSession) {
      return {
        nativeHostSession,
        providerSession: providerSession
          ?? readVirtualAppScreenProviderSessionRecord({ sessionRef: nativeHostSession.sessionRef })
          ?? (nativeHostSession.screenRef ? readVirtualAppScreenProviderSessionRecord({ screenRef: nativeHostSession.screenRef }) : undefined),
      };
    }
  }
  return undefined;
}

function virtualAppScreenCandidateRefs(input: NormalizedCodexAgentHostInput): string[] {
  const refs = uniqueStrings([
    ...input.refs,
    ...recordStringList(input.target, 'refs'),
    ...recordStringList(input.target, 'evidenceRefs'),
    ...recordStringList(input.target, 'targetRefs'),
    ...recordStringList(input.observation, 'refs'),
    ...recordStringList(input.observation, 'evidenceRefs'),
    ...recordStringList(input.observation, 'screenshotRefs'),
    ...recordStringList(input.permissions, 'refs'),
    ...recordStringList(input.permissions, 'evidenceRefs'),
  ]);
  return refs.filter((ref) =>
    safeRuntimeOwnerRef(ref)
    && /^(?:computer-use:native-host\/sessions\/|virtual-app-screen:|computer-use:provider-session\/)/i.test(ref),
  );
}

function virtualAppScreenNativeHostReady(record: VirtualAppScreenNativeHostSessionRecord, now: Date): boolean {
  if (record.owner !== 'NativeVirtualAppScreenHost') return false;
  if (record.diagnosticOnly !== false) return false;
  if (record.singleInteractiveTruth !== true || record.secondInteractiveSurfacePresent !== false || record.currentSessionOnly !== true) return false;
  if (!virtualAppScreenObservationFresh(record, now)) return false;
  const requiredRefs = [
    record.sessionRef,
    record.screenRef,
    record.targetWindowRef,
    record.liveSurfaceRef,
    record.frameStreamRef,
    record.currentFrameRef,
    record.liveBindingAttachGrantRef,
    record.grantValidationRef,
    record.currentRunRef,
    record.currentRunPointerRef,
    record.adapterReadinessRef,
    record.evidenceLedgerRef,
    record.inputLeaseRef,
    record.actionAdapterRef,
  ];
  if (requiredRefs.some((ref) => !safeRuntimeOwnerRef(ref ?? ''))) return false;
  if (!nativeHostPermissionRefs(record).length) return false;
  return true;
}

function virtualAppScreenObservationFresh(record: VirtualAppScreenNativeHostSessionRecord, now: Date): boolean {
  if (!record.currentFrameRef || !record.currentFrameReadAt) return false;
  const readAt = Date.parse(record.currentFrameReadAt);
  return Number.isFinite(readAt) && now.getTime() - readAt <= OBSERVATION_MAX_AGE_MS;
}

function virtualAppScreenTargetSummary(record: VirtualAppScreenNativeHostSessionRecord): string {
  const windowRef = safeSummary(record.targetWindowRef);
  return windowRef
    ? `VirtualAppScreen NativeHost ${safeRefPart(record.sessionId)}: ${windowRef}`
    : `VirtualAppScreen NativeHost ${safeRefPart(record.sessionId)}`;
}

function nativeHostPermissionRefs(record: VirtualAppScreenNativeHostSessionRecord): string[] {
  return uniqueStrings((record.permissionRefs ?? []).filter((ref) => /^permission:/i.test(ref) && safeRuntimeOwnerRef(ref)));
}

function recordLikeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 16)
    : [];
}

function storeResultStatus(value: CodexAgentHostBrowserActTimeStoreResult): 'ready' | 'blocked' {
  return value.ready === true || value.status === 'ready' ? 'ready' : 'blocked';
}

function recordStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 24);
}

function safeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return undefined;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return undefined;
  return trimmed;
}

function safeRefPart(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unknown'
    : 'unknown';
}

function safeRuntimeOwnerRef(ref: string): boolean {
  if (!ref || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(ref)) return false;
  return /^(?:browser-host-session|window-action-session|adapter-registry|permission|approval|lease|runtime-truth|action-ledger|stop|cancel|computer-use|virtual-app-screen|window|desktop-native|native-adapter|native-host|audit):/i.test(ref);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}
