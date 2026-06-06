import {
  defaultBrowserHostSessionManager,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../browser-host-session.js';
import {
  createDefaultWindowActionSessionStore,
  type WindowActionSessionStoreEntry,
} from '../window-action-session-store.js';
import { defaultComputerUseAdapterRegistry } from '../computer-use/adapter-registry-store.js';
import { createComputerUsePermissionLedgerStore } from '../computer-use/permission-ledger-store.js';
import { createDefaultStopCancelTakeoverStore } from '../computer-use/stop-cancel-takeover-store.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
  type VirtualAppScreenNativeHostSessionRecord,
} from '../computer-use/virtual-app-screen-native-host-session-store.js';
import {
  readVirtualAppScreenProviderSessionRecord,
  type VirtualAppScreenProviderSessionRecord,
} from '../computer-use/virtual-app-screen-provider-session-store.js';
import { buildWorkspaceWriterHealth, normalizeBrowserHostNativeAdapterUrl } from '../workspace-server-health.js';
import { authorizationProfileOrDefault, classifyComputerUseRisk } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type {
  CodexAgentHostRuntimeTruth,
  CodexAgentHostRuntimeTruthResolver,
  NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';

const SOURCE = 'codex-agent-host-runtime-truth-resolver';
const OBSERVATION_MAX_AGE_MS = 60_000;

type CodexAgentHostRuntimeTruthWithControlPath = CodexAgentHostRuntimeTruth & {
  permissions?: NonNullable<CodexAgentHostRuntimeTruth['permissions']> & {
    controlPath?: RuntimeControlPath;
  };
};

export function createDefaultCodexAgentHostRuntimeTruthResolver(options: {
  env?: Record<string, string | undefined>;
  browserHostSessionManager?: BrowserHostSessionManager;
  actTimeTruthSource?: CodexAgentHostActTimeTruthSource;
  actTimeStores?: CodexAgentHostBrowserActTimeStores;
  now?: () => Date;
} = {}): CodexAgentHostRuntimeTruthResolver {
  const env = options.env ?? process.env;
  const manager = options.browserHostSessionManager ?? defaultBrowserHostSessionManager();
  const now = options.now ?? (() => new Date());
  const actTimeStores = options.actTimeStores ?? createDefaultCodexAgentHostBrowserActTimeStores({ now, browserHostSessionManager: manager });
  const actTimeTruthSource = options.actTimeTruthSource ?? createDefaultCodexAgentHostActTimeTruthSource({
    now,
    stores: actTimeStores,
  });

  return async ({ agentHostInput, workspacePath, commandText, commandId, attemptId, abortSignal }) => {
    const nativeAdapterUrl = normalizeBrowserHostNativeAdapterUrl(env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL);
    const nativeAdapter = await nativeAdapterHealth(nativeAdapterUrl);
    const workspaceHealth = buildWorkspaceWriterHealth({
      pid: process.pid,
      startedAt: now().toISOString(),
      instanceId: 'agent-host-runtime-truth',
      browserHostNativeAdapterUrl: nativeAdapterUrl ?? '',
    });
    const capabilities = new Set(workspaceHealth.capabilities);
    const session = await verifiedBrowserHostSession({
      agentHostInput,
      workspacePath,
      manager,
      now,
    });
    const nativeSurface = nativeAdapter.surfaceReady && (!session || browserSessionHasNativeSurface(session));
    const actTimeTruth = sanitizeActTimeTruth(await actTimeTruthSource({
      agentHostInput,
      workspacePath,
      commandText,
      commandId,
      attemptId,
      browserHostSession: session,
      nativeBridgeReady: nativeAdapter.bridgeReady,
      nativeSurfaceReady: nativeSurface,
      abortSignal,
    }));
    const sessionRefs = session ? [`browser-host-session:${safeRefPart(session.id)}`] : [];
    const observationRefs = session ? browserSessionObservationRefs(session) : [];
    const target = actTimeTruth.target ?? {
      bound: Boolean(session),
      summary: session ? browserSessionTargetSummary(session) : 'Unbound target',
      refs: sessionRefs,
    };
    const observation = actTimeTruth.observation ?? {
      fresh: Boolean(session && browserSessionObservationFresh(session, now())),
      refs: observationRefs,
    };
    const runtimeTruth: CodexAgentHostRuntimeTruthWithControlPath = {
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      source: SOURCE,
      readiness: {
        browserHostSession: capabilities.has('browser-host-session') ? 'ready' : 'blocked',
        nativeBridge: nativeAdapter.bridgeReady ? 'ready' : 'blocked',
        nativeSurface: nativeSurface ? 'ready' : 'blocked',
        windowActionSession: actTimeTruth.windowActionSessionReady ? 'ready' : 'blocked',
        computerUseAdapter: actTimeTruth.computerUseAdapterReady ? 'ready' : 'blocked',
      },
      target,
      observation,
      permissions: {
        refs: actTimeTruth.permissionRefs,
        permissionRefs: actTimeTruth.permissionRefs,
        ...(actTimeTruth.appAllowlistRefs.length ? { appAllowlistRefs: actTimeTruth.appAllowlistRefs } : {}),
        ...(actTimeTruth.windowAllowlistRefs.length ? { windowAllowlistRefs: actTimeTruth.windowAllowlistRefs } : {}),
        ...(actTimeTruth.riskPreviewRefs.length ? { riskPreviewRefs: actTimeTruth.riskPreviewRefs } : {}),
        stopCancelPath: actTimeTruth.stopCancelPath,
        ...(actTimeTruth.controlPath ? { controlPath: actTimeTruth.controlPath } : {}),
      },
      ...(actTimeTruth.sessions ? { sessions: actTimeTruth.sessions } : {}),
      ...(actTimeTruth.adapter ? { adapter: actTimeTruth.adapter } : {}),
      ...(actTimeTruth.controlPath ? { controlPath: actTimeTruth.controlPath } : {}),
      refs: uniqueStrings([
        'runtime-truth:workspace-writer-health',
        ...nativeAdapter.refs,
        ...sessionRefs.map((ref) => `runtime-truth:${ref}`),
        ...observationRefs,
        ...actTimeTruth.refs,
      ]),
    };
    return runtimeTruth;
  };
}

export interface CodexAgentHostActTimeTruthSourceInput {
  agentHostInput: NormalizedCodexAgentHostInput;
  workspacePath: string;
  commandText: string;
  commandId?: string;
  attemptId?: string;
  browserHostSession?: BrowserHostSessionState;
  nativeBridgeReady: boolean;
  nativeSurfaceReady: boolean;
  abortSignal?: AbortSignal;
}

export interface CodexAgentHostActTimeTruth {
  schemaVersion: 'sciforge.agent-host.act-time-truth.v1';
  source?: string;
  target?: {
    bound?: boolean;
    summary?: string;
    refs?: string[];
  };
  observation?: {
    fresh?: boolean;
    refs?: string[];
  };
  windowActionSession?: {
    status?: 'ready' | 'blocked';
    ready?: boolean;
    summary?: string;
    refs?: string[];
  };
  sessions?: RuntimeSessionTruth;
  computerUseAdapter?: {
    status?: 'ready' | 'blocked';
    ready?: boolean;
    providerId?: string;
    refs?: string[];
  };
  adapter?: RuntimeAdapterTruth;
  permissions?: {
    refs?: string[];
    permissionRefs?: string[];
    appAllowlistRefs?: string[];
    windowAllowlistRefs?: string[];
    riskPreviewRefs?: string[];
    stopCancelPath?: boolean;
    stopCancelRefs?: string[];
    cancelRefs?: string[];
    takeoverRefs?: string[];
    pauseRefs?: string[];
    resumeRefs?: string[];
    stopRefs?: string[];
  };
  controlPath?: RuntimeControlPath;
  refs?: string[];
}

export type CodexAgentHostActTimeTruthSource =
  (input: CodexAgentHostActTimeTruthSourceInput) => Promise<CodexAgentHostActTimeTruth | undefined> | CodexAgentHostActTimeTruth | undefined;

type MaybePromise<T> = T | Promise<T>;

export interface CodexAgentHostBrowserActTimeStoreResult {
  status?: 'ready' | 'blocked';
  ready?: boolean;
  summary?: string;
  providerId?: string;
  refs?: string[];
  targetRefs?: string[];
  observationRefs?: string[];
  permissionRefs?: string[];
  stopCancelRefs?: string[];
  controlRefs?: Partial<Record<'cancel' | 'takeover' | 'pause' | 'resume' | 'stop' | 'close' | 'remove', string[]>>;
}

export interface CodexAgentHostBrowserActTimeStoreInput {
  agentHostInput: NormalizedCodexAgentHostInput;
  browserHostSession: BrowserHostSessionState;
  sessionId: string;
  sessionRef: string;
  commandText: string;
  commandId: string;
  attemptId: string;
  workspacePath: string;
  riskCategory: string;
  nativeBridgeReady: boolean;
  nativeSurfaceReady: boolean;
  abortSignal?: AbortSignal;
}

export interface CodexAgentHostWindowActionActTimeStoreInput {
  agentHostInput: NormalizedCodexAgentHostInput;
  session: WindowActionSessionStoreEntry['session'];
  sessionId: string;
  sessionRef: string;
  windowRef: string;
  targetRefs: string[];
  observationRefs: string[];
  commandText: string;
  commandId: string;
  attemptId: string;
  workspacePath: string;
  riskCategory: string;
  abortSignal?: AbortSignal;
}

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

export interface CodexAgentHostBrowserActTimeStores {
  windowActionSessionStore?: {
    materializeForBrowserHostSession(input: CodexAgentHostBrowserActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    getActiveByRef?(ref: string): MaybePromise<WindowActionSessionStoreEntry | undefined>;
  };
  computerUseAdapterRegistry?: {
    materializeBrowserHostAdapter(input: CodexAgentHostBrowserActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeWindowActionSessionAdapter?(input: CodexAgentHostWindowActionActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeVirtualAppScreenNativeHostAdapter?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
  permissionLedger?: {
    materializeTurnPermission(input: CodexAgentHostBrowserActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeWindowActionTurnPermission?(input: CodexAgentHostWindowActionActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeVirtualAppScreenNativeHostTurnPermission?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
  stopCancelTakeoverStore?: {
    materializeForBrowserHostSession(input: CodexAgentHostBrowserActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeForWindowActionSession?(input: CodexAgentHostWindowActionActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
    materializeForVirtualAppScreenNativeHostSession?(input: CodexAgentHostVirtualAppScreenActTimeStoreInput): MaybePromise<CodexAgentHostBrowserActTimeStoreResult | undefined>;
  };
}

export function createDefaultCodexAgentHostBrowserActTimeStores(options: {
  now?: () => Date;
  browserHostSessionManager?: BrowserHostSessionManager;
} = {}): CodexAgentHostBrowserActTimeStores {
  const now = options.now ?? (() => new Date());
  const manager = options.browserHostSessionManager ?? defaultBrowserHostSessionManager();
  const windowActionSessionStore = createDefaultWindowActionSessionStore({ now });
  const computerUseAdapterRegistry = defaultComputerUseAdapterRegistry();
  const permissionLedger = createComputerUsePermissionLedgerStore({ now });
  const stopCancelTakeoverStore = createDefaultStopCancelTakeoverStore();
  return {
    windowActionSessionStore,
    computerUseAdapterRegistry: {
      materializeBrowserHostAdapter(input) {
        return computerUseAdapterRegistry.materializeBrowserHostAdapter(input);
      },
      materializeWindowActionSessionAdapter(input) {
        return computerUseAdapterRegistry.materializeWindowActionSessionAdapter(input);
      },
      materializeVirtualAppScreenNativeHostAdapter(input) {
        const providerId = 'sciforge.virtual-app-screen.native-host-window-action';
        computerUseAdapterRegistry.register({
          providerId,
          kind: 'native-host-window-action',
          source: 'runtime',
          evidenceRefs: [
            input.sessionRef,
            input.nativeHostSession.actionAdapterRef,
            input.nativeHostSession.adapterReadinessRef,
            `runtime-truth:computer-use-adapter/virtual-app-screen/${input.sessionId}`,
          ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        });
        return computerUseAdapterRegistry.probe({
          providerId,
          probeSource: 'runtime-probe',
          nativeBridgeReady: true,
          nativeSurfaceReady: true,
          evidenceRefs: [
            input.sessionRef,
            input.nativeHostSession.actionAdapterRef,
            input.nativeHostSession.adapterReadinessRef,
            input.nativeHostSession.evidenceLedgerRef,
            `runtime-truth:computer-use-adapter/virtual-app-screen/${input.sessionId}`,
          ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        });
      },
    },
    permissionLedger: {
      materializeTurnPermission(input) {
        const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile });
        const entry = permissionLedger.requestTurnPermission({
          turnId: input.commandId,
          actionId: input.riskCategory,
          authorizationProfileId: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile.id,
          risk: {
            decision: risk.decision,
            level: risk.decision === 'auto' ? 'low' : risk.decision === 'needs-confirmation' ? 'high' : 'high',
            category: risk.category,
            hardConfirm: risk.hardConfirm,
            reason: risk.reason,
          },
          evidenceRefs: [
            input.sessionRef,
            ...browserSessionObservationRefs(input.browserHostSession),
            `action-ledger:browser-host-session/${input.sessionId}/risk/${input.riskCategory}`,
          ],
        });
        return {
          status: entry.status === 'confirmed' ? 'ready' : 'blocked',
          summary: entry.reason,
          refs: [
            entry.ledgerRef,
            ...(entry.approvalRequestRef ? [entry.approvalRequestRef] : []),
            ...(entry.permissionRef ? [entry.permissionRef] : []),
            ...entry.evidenceRefs,
          ],
          permissionRefs: entry.permissionRef ? [entry.permissionRef] : [],
        };
      },
      materializeWindowActionTurnPermission(input) {
        const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile });
        const entry = permissionLedger.requestTurnPermission({
          turnId: input.commandId,
          actionId: input.riskCategory,
          authorizationProfileId: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile.id,
          risk: {
            decision: risk.decision,
            level: risk.decision === 'auto' ? 'low' : risk.decision === 'needs-confirmation' ? 'high' : 'high',
            category: risk.category,
            hardConfirm: risk.hardConfirm,
            reason: risk.reason,
          },
          evidenceRefs: [
            input.sessionRef,
            input.windowRef,
            ...input.observationRefs,
            `action-ledger:window-action-session/${input.sessionId}/risk/${input.riskCategory}`,
          ],
        });
        return {
          status: entry.status === 'confirmed' ? 'ready' : 'blocked',
          summary: entry.reason,
          refs: [
            entry.ledgerRef,
            ...(entry.approvalRequestRef ? [entry.approvalRequestRef] : []),
            ...(entry.permissionRef ? [entry.permissionRef] : []),
            ...entry.evidenceRefs,
          ],
          permissionRefs: entry.permissionRef ? [entry.permissionRef] : [],
        };
      },
      materializeVirtualAppScreenNativeHostTurnPermission(input) {
        const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile });
        const nativePermissionRefs = nativeHostPermissionRefs(input.nativeHostSession);
        const entry = permissionLedger.requestTurnPermission({
          turnId: input.commandId,
          actionId: input.riskCategory,
          authorizationProfileId: authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile.id,
          risk: {
            decision: risk.decision,
            level: risk.decision === 'auto' ? 'low' : risk.decision === 'needs-confirmation' ? 'high' : 'high',
            category: risk.category,
            hardConfirm: risk.hardConfirm,
            reason: risk.reason,
          },
          evidenceRefs: [
            input.sessionRef,
            input.screenRef,
            ...input.targetRefs,
            ...input.observationRefs,
            input.nativeHostSession.adapterReadinessRef,
            input.nativeHostSession.evidenceLedgerRef,
            ...nativePermissionRefs,
            `action-ledger:computer-use/native-host/${input.sessionId}/risk/${input.riskCategory}`,
          ],
        });
        return {
          status: entry.status === 'confirmed' ? 'ready' : 'blocked',
          summary: entry.reason,
          refs: [
            entry.ledgerRef,
            ...(entry.approvalRequestRef ? [entry.approvalRequestRef] : []),
            ...(entry.permissionRef ? [entry.permissionRef] : []),
            ...nativePermissionRefs,
            ...entry.evidenceRefs,
          ],
          permissionRefs: uniqueStrings([
            ...(entry.permissionRef ? [entry.permissionRef] : []),
            ...nativePermissionRefs,
          ]),
        };
      },
    },
    stopCancelTakeoverStore: {
      materializeForBrowserHostSession(input) {
        const browserRegistration = stopCancelTakeoverStore.registerBrowserHostControls({
          workspacePath: input.workspacePath,
          sessionId: input.sessionId,
          evidenceRefs: [
            input.sessionRef,
            `runtime-truth:cancel-path/browser-host-session/${input.sessionId}`,
          ],
          stop: async () => {
            await manager.act(input.workspacePath, input.sessionId, {
              action: 'stop',
              actionId: `${input.attemptId}-stop`,
            });
            return {
              evidenceRefs: [
                `stop:browser-host-session/${input.sessionId}/stop`,
                `action-ledger:browser-host-session/${input.sessionId}/stop/${input.attemptId}`,
              ],
            };
          },
          close: async () => {
            await manager.act(input.workspacePath, input.sessionId, {
              action: 'close',
              actionId: `${input.attemptId}-close`,
            });
            return {
              evidenceRefs: [
                `stop:browser-host-session/${input.sessionId}/close`,
                `action-ledger:browser-host-session/${input.sessionId}/close/${input.attemptId}`,
              ],
            };
          },
        });
        const runtimeCancel = stopCancelTakeoverStore.registerRuntimeCodexCancel({
          commandId: input.commandId,
          attemptId: input.attemptId,
          evidenceRefs: [
            input.sessionRef,
            `runtime-truth:cancel-path/runtime-codex/${input.commandId}`,
          ],
          cancel: () => ({
            evidenceRefs: [
              `cancel:runtime-codex/${input.commandId}/${input.attemptId}`,
              `action-ledger:runtime-codex/${input.commandId}/cancel/${input.attemptId}`,
            ],
          }),
        });
        const refs = uniqueStrings([
          browserRegistration.stopRef,
          browserRegistration.closeRef,
          runtimeCancel.cancelRef,
          ...browserRegistration.evidenceRefs,
          ...runtimeCancel.evidenceRefs,
        ]);
        return {
          status: browserRegistration.status === 'ready' && runtimeCancel.status === 'ready' ? 'ready' : 'blocked',
          refs,
          stopCancelRefs: refs,
          controlRefs: {
            stop: [browserRegistration.stopRef],
            close: [browserRegistration.closeRef],
            cancel: [runtimeCancel.cancelRef],
          },
        };
      },
      materializeForWindowActionSession(input) {
        const registration = stopCancelTakeoverStore.registerWindowActionControls({
          sessionId: input.sessionId,
          windowRef: input.windowRef,
          evidenceRefs: [
            input.sessionRef,
            input.windowRef,
            `runtime-truth:cancel-path/window-action-session/${input.sessionId}`,
          ],
          stop: () => {
            const stopped = windowActionSessionStore.stop(input.sessionRef);
            return { evidenceRefs: stopped.refs };
          },
          pause: () => {
            const paused = windowActionSessionStore.pause(input.sessionRef);
            return { evidenceRefs: paused.refs };
          },
          remove: () => {
            const removed = windowActionSessionStore.remove(input.sessionRef);
            return { evidenceRefs: removed.refs };
          },
        });
        const refs = uniqueStrings([
          registration.stopRef,
          registration.pauseRef,
          registration.removeRef,
          ...registration.evidenceRefs,
        ]);
        return {
          status: registration.status,
          refs,
          stopCancelRefs: refs,
          controlRefs: {
            stop: [registration.stopRef],
            pause: [registration.pauseRef],
            remove: [registration.removeRef],
          },
        };
      },
      materializeForVirtualAppScreenNativeHostSession(input) {
        const registration = stopCancelTakeoverStore.registerNativeHostControls({
          sessionId: input.nativeHostSession.sessionId,
          sessionRef: input.sessionRef,
          evidenceRefs: [
            input.sessionRef,
            input.nativeHostSession.currentRunPointerRef,
            input.nativeHostSession.evidenceLedgerRef,
            `runtime-truth:cancel-path/computer-use/native-host/${input.sessionId}`,
          ],
          stop: async (context) => {
            const result = await input.nativeHostSession.host.stop(input.nativeHostSession.sessionId, context.reason ?? 'Agent Host stop requested.');
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'session.stopped') };
          },
          pause: async (context) => {
            const result = await input.nativeHostSession.host.pauseAgent(input.nativeHostSession.sessionId, context.reason ?? 'Agent Host pause requested.');
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'agent.paused') };
          },
          resume: async () => {
            const result = await input.nativeHostSession.host.resumeAgent(input.nativeHostSession.sessionId, {
              barrierRef: `computer-use:native-host/ledgers/${input.sessionId}/evidence-ledger.json/events/resume-barrier.json`,
              currentRunRef: input.nativeHostSession.currentRunRef,
              requiredReadinessRef: input.nativeHostSession.adapterReadinessRef,
              beforeFrameRef: input.nativeHostSession.currentFrameRef,
              leaseRef: input.nativeHostSession.inputLeaseRef,
            });
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'agent.resumed') };
          },
          close: async () => {
            const result = await input.nativeHostSession.host.closeSession(input.nativeHostSession.sessionId);
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'session.closed') };
          },
        });
        const takeoverRegistration = stopCancelTakeoverStore.registerHumanTakeoverLease({
          leaseId: `${input.sessionId}/human-takeover`,
          actorId: 'runtime-human-operator',
          evidenceRefs: [
            input.sessionRef,
            input.nativeHostSession.inputLeaseRef,
            `runtime-truth:human-takeover/computer-use/native-host/${input.sessionId}`,
          ],
          takeover: () => ({
            evidenceRefs: [
              `lease:human-takeover/${input.sessionId}-human-takeover`,
              `action-ledger:computer-use/native-host/${input.sessionId}/human-takeover/${input.attemptId}`,
            ],
          }),
          pause: async (context) => {
            const result = await input.nativeHostSession.host.pauseAgent(input.nativeHostSession.sessionId, context.reason ?? 'Human takeover pause requested.');
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'agent.paused') };
          },
          resume: async () => {
            const result = await input.nativeHostSession.host.resumeAgent(input.nativeHostSession.sessionId, {
              barrierRef: `computer-use:native-host/ledgers/${input.sessionId}/evidence-ledger.json/events/human-takeover-resume-barrier.json`,
              currentRunRef: input.nativeHostSession.currentRunRef,
              requiredReadinessRef: input.nativeHostSession.adapterReadinessRef,
              beforeFrameRef: input.nativeHostSession.currentFrameRef,
              leaseRef: input.nativeHostSession.inputLeaseRef,
            });
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'agent.resumed') };
          },
          stop: async (context) => {
            const result = await input.nativeHostSession.host.stop(input.nativeHostSession.sessionId, context.reason ?? 'Human takeover stop requested.');
            return { evidenceRefs: nativeHostControlEvidenceRefs(result, input.nativeHostSession, 'session.stopped') };
          },
        });
        const refs = uniqueStrings([
          registration.stopRef,
          registration.pauseRef,
          registration.resumeRef,
          registration.closeRef,
          takeoverRegistration.leaseRef,
          takeoverRegistration.pauseRef,
          takeoverRegistration.resumeRef,
          takeoverRegistration.stopRef,
          ...registration.evidenceRefs,
          ...takeoverRegistration.evidenceRefs,
        ].filter((ref): ref is string => Boolean(ref)));
        return {
          status: registration.status === 'ready' && takeoverRegistration.status === 'ready' ? 'ready' : 'blocked',
          refs,
          stopCancelRefs: refs,
          controlRefs: {
            stop: [registration.stopRef, takeoverRegistration.stopRef].filter((ref): ref is string => Boolean(ref)),
            pause: [registration.pauseRef, takeoverRegistration.pauseRef].filter((ref): ref is string => Boolean(ref)),
            resume: [registration.resumeRef, takeoverRegistration.resumeRef].filter((ref): ref is string => Boolean(ref)),
            takeover: [takeoverRegistration.leaseRef],
            close: [registration.closeRef],
          },
        };
      },
    },
  };
}

export function createDefaultCodexAgentHostActTimeTruthSource(options: {
  now?: () => Date;
  stores?: CodexAgentHostBrowserActTimeStores;
} = {}): CodexAgentHostActTimeTruthSource {
  const browserSource = createDefaultBrowserHostSessionActTimeTruthSource(options);
  const windowActionSource = createDefaultWindowActionSessionActTimeTruthSource(options);
  const virtualAppScreenSource = createDefaultVirtualAppScreenNativeHostActTimeTruthSource(options);
  return async (input) => (await browserSource(input)) ?? (await windowActionSource(input)) ?? (await virtualAppScreenSource(input));
}

export function createDefaultBrowserHostSessionActTimeTruthSource(options: {
  now?: () => Date;
  stores?: CodexAgentHostBrowserActTimeStores;
} = {}): CodexAgentHostActTimeTruthSource {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const session = input.browserHostSession;
    if (!session || !input.nativeBridgeReady || !input.nativeSurfaceReady || !browserSessionHasNativeSurface(session)) return undefined;
    const sessionId = safeRefPart(session.id);
    if (sessionId === 'unknown') return undefined;
    const commandId = safeRefPart(input.commandId ?? 'codex-command-agent-host');
    const attemptId = safeRefPart(input.attemptId ?? `${commandId}-attempt-1`);
    const authorizationProfile = authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile;
    const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile });
    const riskCategory = safeRefPart(risk.category);
    const windowActionSessionRef = `window-action-session:browser-host-session/${sessionId}`;
    const sessionRef = `browser-host-session:${sessionId}`;
    const permissionRef = `permission:turn/${commandId}/${riskCategory}`;
    const stopRef = `browser-host-session:${sessionId}/stop`;
    const closeRef = `browser-host-session:${sessionId}/close`;
    const cancelRef = `cancel:runtime-turn/${commandId}`;
    const adapterRef = 'adapter-registry:browser-host-session/computer-use';
    const storeInput: CodexAgentHostBrowserActTimeStoreInput = {
      agentHostInput: input.agentHostInput,
      browserHostSession: session,
      sessionId,
      sessionRef,
      commandText: input.commandText,
      commandId,
      attemptId,
      workspacePath: input.workspacePath,
      riskCategory,
      nativeBridgeReady: input.nativeBridgeReady,
      nativeSurfaceReady: input.nativeSurfaceReady,
      abortSignal: input.abortSignal,
    };
    const storedWindowAction = await options.stores?.windowActionSessionStore?.materializeForBrowserHostSession(storeInput);
    const storedAdapter = await options.stores?.computerUseAdapterRegistry?.materializeBrowserHostAdapter(storeInput);
    const storedPermission = await options.stores?.permissionLedger?.materializeTurnPermission(storeInput);
    const storedStopCancel = await options.stores?.stopCancelTakeoverStore?.materializeForBrowserHostSession(storeInput);
    const windowActionRefs = storedWindowAction
      ? recordLikeStringList(storedWindowAction.refs)
      : [windowActionSessionRef, sessionRef];
    const adapterRefs = storedAdapter
      ? recordLikeStringList(storedAdapter.refs)
      : [adapterRef, `browser-host-session:${sessionId}/computer-use-adapter`];
    const permissionRefs = storedPermission
      ? uniqueStrings([...recordLikeStringList(storedPermission.refs), ...recordLikeStringList(storedPermission.permissionRefs)])
      : [permissionRef];
    const stopCancelRefs = storedStopCancel
      ? uniqueStrings([...recordLikeStringList(storedStopCancel.refs), ...recordLikeStringList(storedStopCancel.stopCancelRefs)])
      : [stopRef, closeRef, cancelRef];
    const targetRefs = storedWindowAction?.targetRefs?.length
      ? uniqueStrings([sessionRef, ...recordLikeStringList(storedWindowAction.targetRefs)])
      : [sessionRef, windowActionSessionRef];
    const evidenceRefs = uniqueStrings([
      ...windowActionRefs,
      ...adapterRefs,
      ...permissionRefs,
      ...stopCancelRefs,
      `action-ledger:browser-host-session/${sessionId}/risk/${riskCategory}`,
      `runtime-truth:act-source/browser-host-session/${sessionId}`,
    ]);
    const observationRefs = browserSessionObservationRefs(session);
    return {
      schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
      source: 'browser-host-session-act-time-source',
      target: {
        bound: true,
        summary: browserSessionTargetSummary(session),
        refs: targetRefs,
      },
      observation: {
        fresh: browserSessionObservationFresh(session, now()),
        refs: storedWindowAction?.observationRefs?.length
          ? uniqueStrings([...observationRefs, ...recordLikeStringList(storedWindowAction.observationRefs)])
          : observationRefs,
      },
      sessions: {
        sessionReadyRefs: uniqueStrings([
          sessionRef,
          ...windowActionRefs.filter((ref) => /^window-action-session:/i.test(ref)),
        ]),
        targetRefs,
        inputLeaseRefs: leaseRefs(windowActionRefs),
        observationRefs: browserSessionObservationFresh(session, now())
          ? (storedWindowAction?.observationRefs?.length
            ? uniqueStrings([...observationRefs, ...recordLikeStringList(storedWindowAction.observationRefs)])
            : observationRefs)
          : [],
      },
      windowActionSession: {
        status: storedWindowAction ? storeResultStatus(storedWindowAction) : 'ready',
        summary: safeSummary(storedWindowAction?.summary) ?? `WindowActionSession derived from BrowserHostSession ${sessionId}`,
        refs: windowActionRefs,
      },
      computerUseAdapter: {
        status: storedAdapter ? storeResultStatus(storedAdapter) : 'ready',
        providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.browser-host-session.computer-use-adapter',
        refs: adapterRefs,
      },
      adapter: {
        providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.browser-host-session.computer-use-adapter',
        refs: adapterRefs,
        capabilityRefs: [`runtime-truth:computer-use-capability/browser-host-session/${sessionId}`],
        inputIsolation: {
          mode: 'browser-host-native-surface',
          refsOnly: true,
          sharedSystemInput: false,
          requiresFocusLease: false,
          singleInteractiveTruth: true,
          secondTruthSource: false,
          refs: [session.liveSurfaceRef].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0),
        },
      },
      permissions: {
        refs: permissionRefs,
        permissionRefs,
        appAllowlistRefs: [`runtime-truth:app-allowlist/browser-host-session/${sessionId}`],
        windowAllowlistRefs: [`runtime-truth:window-allowlist/browser-host-session/${sessionId}`],
        riskPreviewRefs: [`action-ledger:browser-host-session/${sessionId}/risk/${riskCategory}`],
        stopCancelPath: storedStopCancel ? storeResultStatus(storedStopCancel) === 'ready' : true,
        stopCancelRefs,
      },
      refs: evidenceRefs,
    };
  };
}

export function createDefaultWindowActionSessionActTimeTruthSource(options: {
  now?: () => Date;
  stores?: CodexAgentHostBrowserActTimeStores;
} = {}): CodexAgentHostActTimeTruthSource {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const store = options.stores?.windowActionSessionStore;
    if (!store?.getActiveByRef) return undefined;
    for (const ref of windowActionSessionCandidateRefs(input.agentHostInput)) {
      const entry = await store.getActiveByRef(ref);
      if (!entry) continue;
      const sessionId = safeRefPart(entry.session.id);
      if (sessionId === 'unknown') continue;
      const commandId = safeRefPart(input.commandId ?? 'codex-command-agent-host');
      const attemptId = safeRefPart(input.attemptId ?? `${commandId}-attempt-1`);
      const authorizationProfile = authorizationProfileOrDefault(input.agentHostInput.authorizationProfileId).profile;
      const risk = classifyComputerUseRisk({ action: input.commandText, authorizationProfile });
      const riskCategory = safeRefPart(risk.category);
      const sessionRef = entry.ref;
      const targetRefs = uniqueStrings([
        entry.session.windowRef,
        sessionRef,
        ...entry.targetRefs,
      ]);
      const observationRefs = uniqueStrings(entry.observationRefs);
      const storeInput: CodexAgentHostWindowActionActTimeStoreInput = {
        agentHostInput: input.agentHostInput,
        session: entry.session,
        sessionId,
        sessionRef,
        windowRef: entry.session.windowRef,
        targetRefs,
        observationRefs,
        commandText: input.commandText,
        commandId,
        attemptId,
        workspacePath: input.workspacePath,
        riskCategory,
        abortSignal: input.abortSignal,
      };
      const storedPermission = await options.stores?.permissionLedger?.materializeWindowActionTurnPermission?.(storeInput);
      const storedStopCancel = await options.stores?.stopCancelTakeoverStore?.materializeForWindowActionSession?.(storeInput);
      const storedAdapter = await options.stores?.computerUseAdapterRegistry?.materializeWindowActionSessionAdapter?.(storeInput);
      const windowActionRefs = uniqueStrings([
        sessionRef,
        ...entry.refs,
      ]);
      const adapterRefs = storedAdapter
        ? recordLikeStringList(storedAdapter.refs)
        : [];
      const permissionRefs = storedPermission
        ? uniqueStrings([...recordLikeStringList(storedPermission.refs), ...recordLikeStringList(storedPermission.permissionRefs)])
        : [];
      const stopCancelRefs = storedStopCancel
        ? uniqueStrings([...recordLikeStringList(storedStopCancel.refs), ...recordLikeStringList(storedStopCancel.stopCancelRefs)])
        : [];
      const actorCursorRefs = windowActionActorCursorRefs(entry);
      const scopedInputRefs = windowActionScopedInputRefs(entry);
      const focusLeaseRefs = windowActionFocusLeaseRefs(entry);
      const inputLeaseRefs = leaseRefs(windowActionRefs).filter((ref) => !focusLeaseRefs.includes(ref));
      const inputIsolationRefs = uniqueStrings([...scopedInputRefs, ...focusLeaseRefs]);
      const focusModes = uniqueStrings(entry.session.scopedInputAdapters.map((adapter) => adapter.focusMode));
      return {
        schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
        source: 'window-action-session-act-time-source',
        target: {
          bound: true,
          summary: windowActionSessionTargetSummary(entry),
          refs: targetRefs,
        },
        observation: {
          fresh: windowActionSessionObservationFresh(entry, now()),
          refs: observationRefs,
        },
        sessions: {
          sessionReadyRefs: uniqueStrings([
            ...windowActionRefs,
            ...actorCursorRefs,
            ...scopedInputRefs,
            ...focusLeaseRefs,
          ]),
          targetRefs,
          actorCursorRefs,
          inputLeaseRefs,
          focusLeaseRefs,
          observationRefs: windowActionSessionObservationFresh(entry, now()) ? observationRefs : [],
        },
        windowActionSession: {
          status: 'ready',
          summary: windowActionSessionTargetSummary(entry),
          refs: windowActionRefs,
        },
        computerUseAdapter: {
          status: storedAdapter ? storeResultStatus(storedAdapter) : 'blocked',
          providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.window-action-session.computer-use-adapter',
          refs: adapterRefs,
        },
        adapter: {
          providerId: safeSummary(storedAdapter?.providerId) ?? 'sciforge.window-action-session.computer-use-adapter',
          refs: adapterRefs,
          capabilityRefs: [`runtime-truth:computer-use-capability/window-action-session/${sessionId}`],
          inputIsolation: {
            mode: focusModes[0] ?? (focusLeaseRefs.length ? 'requires-focus' : 'focus-free'),
            refsOnly: true,
            sharedSystemInput: false,
            requiresFocusLease: focusLeaseRefs.length > 0 || focusModes.includes('requires-focus'),
            refs: inputIsolationRefs,
          },
        },
        permissions: {
          refs: permissionRefs,
          permissionRefs,
          appAllowlistRefs: [`runtime-truth:app-allowlist/window-action-session/${sessionId}/${safeRefPart(entry.session.app.id ?? entry.session.app.name ?? 'app')}`],
          windowAllowlistRefs: [`runtime-truth:window-allowlist/window-action-session/${sessionId}`],
          riskPreviewRefs: [`action-ledger:window-action-session/${sessionId}/risk/${riskCategory}`],
          stopCancelPath: stopCancelRefs.length > 0,
          stopCancelRefs,
        },
        refs: uniqueStrings([
          ...windowActionRefs,
          ...adapterRefs,
          ...permissionRefs,
          ...stopCancelRefs,
          ...targetRefs,
          ...observationRefs,
          `action-ledger:window-action-session/${sessionId}/risk/${riskCategory}`,
          `runtime-truth:act-source/window-action-session/${sessionId}`,
        ]),
      };
    }
    return undefined;
  };
}

export function createDefaultVirtualAppScreenNativeHostActTimeTruthSource(options: {
  now?: () => Date;
  stores?: CodexAgentHostBrowserActTimeStores;
} = {}): CodexAgentHostActTimeTruthSource {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const candidate = virtualAppScreenNativeHostCandidate(input.agentHostInput);
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

function virtualAppScreenNativeHostCandidate(input: NormalizedCodexAgentHostInput): {
  nativeHostSession: VirtualAppScreenNativeHostSessionRecord;
  providerSession?: VirtualAppScreenProviderSessionRecord;
} | undefined {
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

function nativeHostControlEvidenceRefs(
  result: unknown,
  record: VirtualAppScreenNativeHostSessionRecord,
  eventType: 'session.stopped' | 'agent.paused' | 'agent.resumed' | 'session.closed',
): string[] {
  const refs = [
    record.sessionRef,
    record.evidenceLedgerRef,
    record.currentRunPointerRef,
    `computer-use:native-host/ledgers/${safeRefPart(record.sessionId)}/evidence-ledger.json/events/${eventType}.json`,
  ];
  if (isRecord(result) && result.status === 'blocked' && isRecord(result.error) && typeof result.error.ref === 'string') {
    refs.push(result.error.ref);
  }
  return uniqueStrings(refs.filter((ref) => safeRuntimeOwnerRef(ref)));
}

function recordLikeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 16)
    : [];
}

function storeResultStatus(value: CodexAgentHostBrowserActTimeStoreResult): 'ready' | 'blocked' {
  return value.ready === true || value.status === 'ready' ? 'ready' : 'blocked';
}

function leaseRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) => /^lease:/i.test(ref) && safeRuntimeOwnerRef(ref)));
}

function windowActionActorCursorRefs(entry: WindowActionSessionStoreEntry): string[] {
  return ownerRefsForPurpose(uniqueStrings([
    ...(entry.session.actorCursor?.evidenceRefs ?? []),
    ...entry.session.scopedInputAdapters.flatMap((adapter) => [
      adapter.actorCursorRef,
    ]),
    ...entry.session.events.flatMap((event) => [
      event.actorCursorRef,
      ...(event.actorCursor?.evidenceRefs ?? []),
    ]),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)), 'general')
    .filter((ref) => /(?:actor-cursor|actor-cursors|cursor)/i.test(ref));
}

function windowActionScopedInputRefs(entry: WindowActionSessionStoreEntry): string[] {
  return ownerRefsForPurpose(uniqueStrings(entry.session.scopedInputAdapters.flatMap((adapter) => [
    adapter.ref,
    ...adapter.evidenceRefs.map((item) => item.ref),
  ])), 'general')
    .filter((ref) => /(?:scoped-input|input-adapter)/i.test(ref));
}

function windowActionFocusLeaseRefs(entry: WindowActionSessionStoreEntry): string[] {
  return leaseRefs(entry.session.scopedInputAdapters.flatMap((adapter) => [
    adapter.focusLeaseRef,
    ...adapter.evidenceRefs.map((item) => item.ref),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)))
    .filter((ref) => /focus/i.test(ref));
}

interface SanitizedActTimeTruth {
  target?: NonNullable<CodexAgentHostRuntimeTruth['target']>;
  observation?: NonNullable<CodexAgentHostRuntimeTruth['observation']>;
  sessions?: RuntimeSessionTruth;
  adapter?: RuntimeAdapterTruth;
  windowActionSessionReady: boolean;
  computerUseAdapterReady: boolean;
  permissionRefs: string[];
  appAllowlistRefs: string[];
  windowAllowlistRefs: string[];
  riskPreviewRefs: string[];
  stopCancelPath: boolean;
  controlPath?: RuntimeControlPath;
  refs: string[];
}

type RuntimeSessionTruth = NonNullable<CodexAgentHostRuntimeTruth['sessions']>;
type RuntimeAdapterTruth = NonNullable<CodexAgentHostRuntimeTruth['adapter']>;
type RuntimeAdapterInputIsolation = NonNullable<RuntimeAdapterTruth['inputIsolation']>;

interface RuntimeControlPath {
  ready: boolean;
  takeoverRefs: string[];
  pauseRefs: string[];
  resumeRefs: string[];
  stopRefs: string[];
  cancelRefs: string[];
}

function sanitizeActTimeTruth(value: unknown): SanitizedActTimeTruth {
  const empty: SanitizedActTimeTruth = {
    windowActionSessionReady: false,
    computerUseAdapterReady: false,
    permissionRefs: [],
    appAllowlistRefs: [],
    windowAllowlistRefs: [],
    riskPreviewRefs: [],
    stopCancelPath: false,
    refs: [],
  };
  if (!isRecord(value) || value.schemaVersion !== 'sciforge.agent-host.act-time-truth.v1') return empty;
  const windowActionSession = isRecord(value.windowActionSession) ? value.windowActionSession : {};
  const computerUseAdapter = isRecord(value.computerUseAdapter) ? value.computerUseAdapter : {};
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  const windowActionRefs = ownerRefsForPurpose(recordStringList(windowActionSession, 'refs'), 'window-action');
  const adapterRefs = ownerRefsForPurpose(recordStringList(computerUseAdapter, 'refs'), 'adapter');
  const permissionRefs = ownerRefsForPurpose([
    ...recordStringList(permissions, 'refs'),
    ...recordStringList(permissions, 'permissionRefs'),
  ], 'permission');
  const appAllowlistRefs = ownerRefsForPurpose(recordStringList(permissions, 'appAllowlistRefs'), 'general');
  const windowAllowlistRefs = ownerRefsForPurpose(recordStringList(permissions, 'windowAllowlistRefs'), 'general');
  const riskPreviewRefs = ownerRefsForPurpose(recordStringList(permissions, 'riskPreviewRefs'), 'general');
  const stopCancelRefs = ownerRefsForPurpose([
    ...recordStringList(permissions, 'stopCancelRefs'),
    ...recordStringList(permissions, 'cancelRefs'),
    ...recordStringList(permissions, 'takeoverRefs'),
    ...recordStringList(permissions, 'pauseRefs'),
    ...recordStringList(permissions, 'resumeRefs'),
    ...recordStringList(permissions, 'stopRefs'),
  ], 'stop-cancel');
  const directControlRefs = directRuntimeControlRefs(stopCancelRefs);
  const controlPath = runtimeControlPath(permissions, directControlRefs);
  const target = sanitizedActTarget(value.target);
  const observation = sanitizedActObservation(value.observation);
  const sessions = sanitizedActSessions(value.sessions);
  const adapter = sanitizedActAdapter(value.adapter, computerUseAdapter);
  const generalRefs = ownerRefsForPurpose(recordStringList(value, 'refs'), 'general');
  return {
    target,
    observation,
    sessions,
    adapter,
    windowActionSessionReady: actReady(windowActionSession) && windowActionRefs.length > 0,
    computerUseAdapterReady: actReady(computerUseAdapter) && adapterRefs.length > 0,
    permissionRefs,
    appAllowlistRefs,
    windowAllowlistRefs,
    riskPreviewRefs,
    stopCancelPath: permissions.stopCancelPath === true && (directControlRefs.length > 0 || controlPath?.ready === true),
    controlPath,
    refs: uniqueStrings([
      ...windowActionRefs,
      ...adapterRefs,
      ...permissionRefs,
      ...stopCancelRefs,
      ...(target?.refs ?? []),
      ...(observation?.refs ?? []),
      ...generalRefs,
    ]),
  };
}

function sanitizedActSessions(value: unknown): RuntimeSessionTruth | undefined {
  if (!isRecord(value)) return undefined;
  const sessionReadyRefs = ownerRefsForPurpose(recordStringList(value, 'sessionReadyRefs'), 'general');
  const targetRefs = ownerRefsForPurpose(recordStringList(value, 'targetRefs'), 'target');
  const actorCursorRefs = ownerRefsForPurpose(recordStringList(value, 'actorCursorRefs'), 'general')
    .filter((ref) => /(?:actor-cursor|actor-cursors|cursor)/i.test(ref));
  const inputLeaseRefs = ownerRefsForPurpose(recordStringList(value, 'inputLeaseRefs'), 'stop-cancel')
    .filter((ref) => /(?:^lease:|\/leases?\/|input-lease|agent-host)/i.test(ref));
  const focusLeaseRefs = ownerRefsForPurpose(recordStringList(value, 'focusLeaseRefs'), 'stop-cancel')
    .filter((ref) => /(?:^lease:|focus)/i.test(ref));
  const observationRefs = ownerRefsForPurpose(recordStringList(value, 'observationRefs'), 'observation');
  if (!sessionReadyRefs.length && !targetRefs.length && !actorCursorRefs.length && !inputLeaseRefs.length && !focusLeaseRefs.length && !observationRefs.length) return undefined;
  return {
    ...(sessionReadyRefs.length ? { sessionReadyRefs } : {}),
    ...(targetRefs.length ? { targetRefs } : {}),
    ...(actorCursorRefs.length ? { actorCursorRefs } : {}),
    ...(inputLeaseRefs.length ? { inputLeaseRefs } : {}),
    ...(focusLeaseRefs.length ? { focusLeaseRefs } : {}),
    ...(observationRefs.length ? { observationRefs } : {}),
  };
}

function sanitizedActAdapter(value: unknown, fallback: Record<string, unknown>): RuntimeAdapterTruth | undefined {
  const adapter = isRecord(value) ? value : {};
  const refs = ownerRefsForPurpose([
    ...recordStringList(fallback, 'refs'),
    ...recordStringList(adapter, 'refs'),
  ], 'adapter');
  const capabilityRefs = ownerRefsForPurpose(recordStringList(adapter, 'capabilityRefs'), 'general');
  const inputIsolation = sanitizedInputIsolation(adapter.inputIsolation);
  const providerId = safeSummary(adapter.providerId) ?? safeSummary(fallback.providerId);
  if (!providerId && !refs.length && !capabilityRefs.length && !inputIsolation) return undefined;
  return {
    ...(providerId ? { providerId } : {}),
    ...(refs.length ? { refs } : {}),
    ...(capabilityRefs.length ? { capabilityRefs } : {}),
    ...(inputIsolation ? { inputIsolation } : {}),
  };
}

function sanitizedInputIsolation(value: unknown): RuntimeAdapterInputIsolation | undefined {
  if (!isRecord(value)) return undefined;
  const refs = ownerRefsForPurpose(recordStringList(value, 'refs'), 'general');
  return {
    ...(safeSummary(value.mode) ? { mode: safeSummary(value.mode) } : {}),
    refsOnly: value.refsOnly !== false,
    ...(typeof value.sharedSystemInput === 'boolean' ? { sharedSystemInput: value.sharedSystemInput } : {}),
    ...(typeof value.requiresFocusLease === 'boolean' ? { requiresFocusLease: value.requiresFocusLease } : {}),
    ...(typeof value.singleInteractiveTruth === 'boolean' ? { singleInteractiveTruth: value.singleInteractiveTruth } : {}),
    ...(typeof value.secondTruthSource === 'boolean' ? { secondTruthSource: value.secondTruthSource } : {}),
    ...(refs.length ? { refs } : {}),
  };
}

function runtimeControlPath(permissions: Record<string, unknown>, stopCancelRefs: string[]): RuntimeControlPath | undefined {
  const explicitControlRefs = isRecord(permissions.controlRefs) ? permissions.controlRefs : {};
  const directStopCancelRefs = directRuntimeControlRefs(stopCancelRefs);
  const takeoverRefs = uniqueStrings([
    ...directRuntimeControlRefs(recordStringList(permissions, 'takeoverRefs')).filter((ref) => /^lease:human-takeover\/[^/]+$/i.test(ref)),
    ...directRuntimeControlRefs(recordStringList(explicitControlRefs, 'takeover')).filter((ref) => /^lease:human-takeover\/[^/]+$/i.test(ref)),
    ...directStopCancelRefs.filter((ref) => /^lease:human-takeover\/[^/]+$/i.test(ref)),
  ]);
  const pauseRefs = uniqueStrings([
    ...directRuntimeControlRefs(recordStringList(permissions, 'pauseRefs')).filter((ref) => /\/pause$/i.test(ref)),
    ...directRuntimeControlRefs(recordStringList(explicitControlRefs, 'pause')).filter((ref) => /\/pause$/i.test(ref)),
    ...directStopCancelRefs.filter((ref) => /\/pause$/i.test(ref)),
  ]);
  const resumeRefs = uniqueStrings([
    ...directRuntimeControlRefs(recordStringList(permissions, 'resumeRefs')).filter((ref) => /\/resume$/i.test(ref)),
    ...directRuntimeControlRefs(recordStringList(explicitControlRefs, 'resume')).filter((ref) => /\/resume$/i.test(ref)),
    ...directStopCancelRefs.filter((ref) => /\/resume$/i.test(ref)),
  ]);
  const stopRefs = uniqueStrings([
    ...directRuntimeControlRefs(recordStringList(permissions, 'stopRefs')).filter((ref) => /^(?:stop:|.*\/stop$)/i.test(ref)),
    ...directRuntimeControlRefs(recordStringList(explicitControlRefs, 'stop')).filter((ref) => /^(?:stop:|.*\/stop$)/i.test(ref)),
    ...directStopCancelRefs.filter((ref) => /^(?:stop:|.*\/stop$)/i.test(ref)),
  ]);
  const cancelRefs = uniqueStrings([
    ...directRuntimeControlRefs(recordStringList(permissions, 'cancelRefs')).filter((ref) => /^cancel:/i.test(ref)),
    ...directRuntimeControlRefs(recordStringList(explicitControlRefs, 'cancel')).filter((ref) => /^cancel:/i.test(ref)),
    ...directStopCancelRefs.filter((ref) => /^cancel:/i.test(ref)),
  ]);
  if (!takeoverRefs.length && !pauseRefs.length && !resumeRefs.length && !stopRefs.length && !cancelRefs.length) return undefined;
  return {
    ready: true,
    takeoverRefs,
    pauseRefs,
    resumeRefs,
    stopRefs,
    cancelRefs,
  };
}

function directRuntimeControlRefs(refs: string[]): string[] {
  return ownerRefsForPurpose(refs, 'stop-cancel').filter((ref) =>
    /^(?:cancel:|stop:|lease:|browser-host-session:.*\/(?:stop|close|cancel)|computer-use:.*\/(?:stop|cancel|lease)(?:\/|$)|native-host:.*\/(?:stop|cancel|lease)(?:\/|$))/i.test(ref),
  );
}

function sanitizedActTarget(value: unknown): NonNullable<CodexAgentHostRuntimeTruth['target']> | undefined {
  if (!isRecord(value)) return undefined;
  const refs = ownerRefsForPurpose(recordStringList(value, 'refs'), 'target');
  if (!refs.length) return undefined;
  return {
    bound: value.bound === true,
    summary: safeSummary(value.summary) ?? 'Runtime-bound target',
    refs,
  };
}

function sanitizedActObservation(value: unknown): NonNullable<CodexAgentHostRuntimeTruth['observation']> | undefined {
  if (!isRecord(value)) return undefined;
  const refs = ownerRefsForPurpose(recordStringList(value, 'refs'), 'observation');
  if (!refs.length) return undefined;
  return {
    fresh: value.fresh === true,
    refs,
  };
}

function actReady(value: Record<string, unknown>): boolean {
  return value.ready === true || value.status === 'ready';
}

type ActOwnerRefPurpose =
  | 'general'
  | 'target'
  | 'observation'
  | 'window-action'
  | 'adapter'
  | 'permission'
  | 'stop-cancel';

function ownerRefsForPurpose(refs: string[], purpose: ActOwnerRefPurpose): string[] {
  return uniqueStrings(refs.filter((ref) => runtimeOwnerRefAllowed(ref, purpose)));
}

function runtimeOwnerRefAllowed(ref: string, purpose: ActOwnerRefPurpose): boolean {
  if (!safeRuntimeOwnerRef(ref)) return false;
  if (purpose === 'window-action') return /^(?:window-action-session:|browser-host-session:|window:|desktop-native:window-action|virtual-app-screen:|computer-use:(?:session|provider-session|native-host\/(?:sessions|surfaces|leases|ledgers|grants|runs)))/i.test(ref);
  if (purpose === 'adapter') return /^(?:adapter-registry:|computer-use:(?:adapter|native-host\/(?:adapters|readiness|sessions|ledgers))|browser-host-session:.*computer-use|runtime-truth:computer-use-adapter)/i.test(ref);
  if (purpose === 'permission') return /^(?:permission:|computer-use:permission|native-host:permission|audit:approval|approval:)/i.test(ref);
  if (purpose === 'stop-cancel') return /^(?:cancel:|stop:|lease:|browser-host-session:.*\/(?:stop|close|cancel)|computer-use:.*(?:stop|cancel|lease)|native-host:.*(?:stop|cancel|lease)|runtime-truth:cancel-path)/i.test(ref);
  if (purpose === 'target') return /^(?:browser-host-session:|window-action-session:|window:|desktop-native:|virtual-app-screen:|computer-use:(?:target|session|provider-session|native-host\/(?:sessions|surfaces|apps)))/i.test(ref);
  if (purpose === 'observation') return /^(?:browser-host-session:|window-action-session:|computer-use:(?:observation|evidence|native-host\/(?:frames|surfaces|ledgers|runs))|desktop-native:|evidence:|workEvidence:)/i.test(ref);
  return true;
}

function safeRuntimeOwnerRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|virtual-app-screen:|computer-use:|native-adapter:|desktop-native:|permission:|approval:|cancel:|stop:|lease:|adapter-registry:|window:|action-ledger:|evidence:|workEvidence:|native-host:|audit:)/i.test(trimmed);
}

async function nativeAdapterHealth(nativeAdapterUrl: string | undefined): Promise<{
  bridgeReady: boolean;
  surfaceReady: boolean;
  refs: string[];
}> {
  if (!nativeAdapterUrl) return { bridgeReady: false, surfaceReady: false, refs: [] };
  try {
    const response = await fetch(`${nativeAdapterUrl}/health`, { signal: AbortSignal.timeout(750) });
    const payload = await response.json().catch(() => undefined) as unknown;
    if (!isRecord(payload) || nativeAdapterPayloadForbidden(payload)) {
      return { bridgeReady: false, surfaceReady: false, refs: ['runtime-truth:native-adapter-invalid'] };
    }
    const bridgeReady = response.ok
      && payload.owner === 'BrowserHostSession'
      && payload.adapterRole === 'display-input-adapter'
      && payload.liveSurfaceTransport === 'native-embedded'
      && payload.singleInteractiveTruth === true
      && payload.secondTruthSource === false;
    const surfaceReady = bridgeReady
      && payload.ok !== false
      && payload.status !== 'blocked'
      && payload.ready !== false
      && payload.passClaim === true;
    return {
      bridgeReady,
      surfaceReady,
      refs: bridgeReady
        ? ['runtime-truth:native-adapter-loopback', 'runtime-truth:native-surface-health']
        : ['runtime-truth:native-adapter-invalid'],
    };
  } catch {
    return { bridgeReady: false, surfaceReady: false, refs: ['runtime-truth:native-adapter-unavailable'] };
  }
}

async function verifiedBrowserHostSession(input: {
  agentHostInput: NormalizedCodexAgentHostInput;
  workspacePath: string;
  manager: BrowserHostSessionManager;
  now: () => Date;
}): Promise<BrowserHostSessionState | undefined> {
  for (const sessionId of browserHostSessionIds(input.agentHostInput)) {
    const state = await input.manager.sessionState(input.workspacePath, sessionId).catch(() => undefined);
    if (!state || state.status === 'closed' || state.status === 'failed') continue;
    return state;
  }
  return undefined;
}

function browserHostSessionIds(input: NormalizedCodexAgentHostInput): string[] {
  const refs = uniqueStrings([
    ...input.refs,
    ...recordStringList(input.target, 'refs'),
    ...recordStringList(input.target, 'evidenceRefs'),
    ...recordStringList(input.target, 'targetRefs'),
    ...recordStringList(input.observation, 'refs'),
    ...recordStringList(input.observation, 'evidenceRefs'),
    ...recordStringList(input.observation, 'screenshotRefs'),
  ]);
  return uniqueStrings(refs.flatMap((ref) => {
    const match = /^browser-host-session:([a-zA-Z0-9._:-]{1,160})(?:\/|$)/.exec(ref);
    return match ? [match[1]] : [];
  }));
}

function browserSessionHasNativeSurface(session: BrowserHostSessionState): boolean {
  return session.status === 'ready'
    && session.liveSurfaceTransport === 'native-embedded'
    && typeof session.liveSurfaceRef === 'string'
    && session.singleInteractiveTruth === true
    && session.secondTruthSource === false;
}

function browserSessionObservationRefs(session: BrowserHostSessionState): string[] {
  return uniqueStrings([
    session.frameRef,
    session.screenshotRef,
    session.domSnapshotRef,
    session.axSnapshotRef,
    session.loadingProgress?.refs?.frame,
    session.loadingProgress?.refs?.screenshot,
    session.loadingProgress?.refs?.domSnapshot,
    session.loadingProgress?.refs?.axSnapshot,
  ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0));
}

function browserSessionObservationFresh(session: BrowserHostSessionState, now: Date): boolean {
  if (!browserSessionObservationRefs(session).length) return false;
  const updatedAt = Date.parse(session.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt <= OBSERVATION_MAX_AGE_MS;
}

function browserSessionTargetSummary(session: BrowserHostSessionState): string {
  const title = safeSummary(session.title);
  return title ? `BrowserHostSession ${safeRefPart(session.id)}: ${title}` : `BrowserHostSession ${safeRefPart(session.id)}`;
}

function windowActionSessionCandidateRefs(input: NormalizedCodexAgentHostInput): string[] {
  const refs = uniqueStrings([
    ...input.refs,
    ...recordStringList(input.target, 'refs'),
    ...recordStringList(input.target, 'evidenceRefs'),
    ...recordStringList(input.target, 'targetRefs'),
    ...recordStringList(input.observation, 'refs'),
    ...recordStringList(input.observation, 'evidenceRefs'),
    ...recordStringList(input.observation, 'screenshotRefs'),
  ]);
  return refs.filter((ref) =>
    safeRuntimeOwnerRef(ref)
    && /^(?:window-action-session:|window:|desktop-native:|computer-use:session|native-host:)/i.test(ref),
  );
}

function windowActionSessionObservationFresh(entry: WindowActionSessionStoreEntry, now: Date): boolean {
  if (!entry.observationRefs.length) return false;
  const updatedAt = Date.parse(entry.updatedAt || entry.session.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt <= OBSERVATION_MAX_AGE_MS;
}

function windowActionSessionTargetSummary(entry: WindowActionSessionStoreEntry): string {
  const appName = safeSummary(entry.session.app.name);
  return appName
    ? `WindowActionSession ${safeRefPart(entry.session.id)}: ${appName}`
    : `WindowActionSession ${safeRefPart(entry.session.id)}`;
}

function recordStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 16);
}

function safeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /https?:\/\/|data:image|base64|secret|token|password|api[-_]?key/i.test(trimmed)) return undefined;
  return trimmed.slice(0, 80);
}

function nativeAdapterPayloadForbidden(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') {
    return /https?:\/\/|data:image|base64|<html|secret|provider|host-stream|frame-stream|canvas|iframe|webview|webrtc/i.test(value);
  }
  if (Array.isArray(value)) return value.some((entry) => nativeAdapterPayloadForbidden(entry, depth + 1));
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:url|dom|screenshot|base64|provider|secret|html|payload)/i.test(key)) return true;
    if (nativeAdapterPayloadForbidden(entry, depth + 1)) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeRefPart(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  return /^[a-zA-Z0-9._:-]{1,160}$/.test(value) ? value : 'unknown';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].slice(0, 24);
}
