import { BROWSER_HOST_COMPUTER_USE_PROVIDER_ID } from '../browser-host-computer-use.js';
import { BROWSER_HOST_SESSION_PROVIDER_ID, type BrowserHostSessionState } from '../browser-host-session.js';

export const COMPUTER_USE_ADAPTER_REGISTRY_SCHEMA = 'sciforge.computer-use.adapter-registry.v1' as const;

export type ComputerUseAdapterProviderKind = 'browser-host-session' | 'window-action-session' | 'native-host-window-action';
export type ComputerUseAdapterRegistrationSource = 'runtime' | 'manifest' | 'provider-url';
export type ComputerUseAdapterProbeSource = 'runtime-probe' | 'manifest' | 'provider-url';
export type ComputerUseAdapterReadinessStatus = 'ready' | 'blocked';

export interface ComputerUseAdapterRegistration {
  providerId: string;
  kind: ComputerUseAdapterProviderKind;
  source?: ComputerUseAdapterRegistrationSource;
  providerUrl?: string;
  evidenceRefs?: string[];
}

export interface ComputerUseAdapterProbeInput {
  providerId: string;
  probeSource?: ComputerUseAdapterProbeSource;
  nativeBridgeReady?: boolean;
  nativeSurfaceReady?: boolean;
  browserHostSession?: BrowserHostSessionState;
  evidenceRefs?: string[];
}

export interface ComputerUseAdapterReadiness {
  schemaVersion: typeof COMPUTER_USE_ADAPTER_REGISTRY_SCHEMA;
  status: ComputerUseAdapterReadinessStatus;
  ready: boolean;
  providerId: string;
  kind?: ComputerUseAdapterProviderKind;
  summary?: string;
  refs: string[];
  blockedReason?: string;
  updatedAt: string;
}

export interface ComputerUseAdapterRegistryBrowserHostMaterializeInput {
  browserHostSession: BrowserHostSessionState;
  sessionId: string;
  sessionRef: string;
  nativeBridgeReady: boolean;
  nativeSurfaceReady: boolean;
  agentHostInput?: unknown;
  commandText?: string;
  commandId?: string;
  attemptId?: string;
  riskCategory?: string;
  abortSignal?: AbortSignal;
}

export interface ComputerUseAdapterRegistry {
  register(registration: ComputerUseAdapterRegistration): ComputerUseAdapterReadiness;
  probe(input: ComputerUseAdapterProbeInput): ComputerUseAdapterReadiness;
  getReady(providerId: string): ComputerUseAdapterReadiness;
  materializeBrowserHostAdapter(input: ComputerUseAdapterRegistryBrowserHostMaterializeInput): ComputerUseAdapterReadiness;
}

interface AdapterRecord {
  providerId: string;
  kind: ComputerUseAdapterProviderKind;
  source: ComputerUseAdapterRegistrationSource;
  readiness: ComputerUseAdapterReadiness;
}

export function createDefaultComputerUseAdapterRegistry(options: {
  now?: () => Date;
} = {}): ComputerUseAdapterRegistry {
  const registry = createInMemoryComputerUseAdapterRegistry(options);
  registry.register({
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    kind: 'browser-host-session',
    source: 'runtime',
    evidenceRefs: [browserHostAdapterRegistryRef()],
  });
  return registry;
}

export function createInMemoryComputerUseAdapterRegistry(options: {
  now?: () => Date;
} = {}): ComputerUseAdapterRegistry {
  const now = options.now ?? (() => new Date());
  const records = new Map<string, AdapterRecord>();

  function register(registration: ComputerUseAdapterRegistration): ComputerUseAdapterReadiness {
    const providerId = safeProviderId(registration.providerId);
    const refResult = sanitizeEvidenceRefs(baseRefsForProvider(providerId, registration.evidenceRefs));
    const source = registration.source ?? 'runtime';
    const readiness = blockedReadiness({
      providerId,
      kind: registration.kind,
      reason: registrationBlockedReason(providerId, source, refResult.unsafe),
      refs: refResult.refs,
      now,
    });
    records.set(providerId, {
      providerId,
      kind: registration.kind,
      source,
      readiness,
    });
    return cloneReadiness(readiness);
  }

  function probe(input: ComputerUseAdapterProbeInput): ComputerUseAdapterReadiness {
    const providerId = safeProviderId(input.providerId);
    const record = records.get(providerId);
    if (!record) {
      return blockedReadiness({
        providerId,
        reason: 'Computer Use adapter registry blocked an unknown provider.',
        refs: baseRefsForProvider(providerId),
        now,
      });
    }
    if (record.kind !== 'browser-host-session' || providerId !== BROWSER_HOST_COMPUTER_USE_PROVIDER_ID) {
      const readiness = nonBrowserProbeReadiness(record, input, now);
      record.readiness = readiness;
      return cloneReadiness(readiness);
    }
    const readiness = browserHostProbeReadiness(input, now);
    record.readiness = readiness;
    return cloneReadiness(readiness);
  }

  function getReady(providerIdInput: string): ComputerUseAdapterReadiness {
    const providerId = safeProviderId(providerIdInput);
    const record = records.get(providerId);
    if (!record) {
      return blockedReadiness({
        providerId,
        reason: 'Computer Use adapter registry blocked an unknown provider.',
        refs: baseRefsForProvider(providerId),
        now,
      });
    }
    return cloneReadiness(record.readiness);
  }

  function materializeBrowserHostAdapter(input: ComputerUseAdapterRegistryBrowserHostMaterializeInput): ComputerUseAdapterReadiness {
    return probe({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      probeSource: 'runtime-probe',
      nativeBridgeReady: input.nativeBridgeReady,
      nativeSurfaceReady: input.nativeSurfaceReady,
      browserHostSession: input.browserHostSession,
      evidenceRefs: [
        input.sessionRef,
        `browser-host-session:${safeRefPart(input.sessionId)}/computer-use-adapter`,
        `runtime-truth:computer-use-adapter/browser-host-session/${safeRefPart(input.sessionId)}`,
      ],
    });
  }

  return {
    register,
    probe,
    getReady,
    materializeBrowserHostAdapter,
  };
}

let defaultRegistry: ComputerUseAdapterRegistry | undefined;

export function defaultComputerUseAdapterRegistry(): ComputerUseAdapterRegistry {
  defaultRegistry ??= createDefaultComputerUseAdapterRegistry();
  return defaultRegistry;
}

function browserHostProbeReadiness(
  input: ComputerUseAdapterProbeInput,
  now: () => Date,
): ComputerUseAdapterReadiness {
  const safeRefs = sanitizeEvidenceRefs([
    browserHostAdapterRegistryRef(),
    ...browserHostSessionRefs(input.browserHostSession),
    ...(input.evidenceRefs ?? []),
  ]);
  if (safeRefs.unsafe) {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'Computer Use adapter registry rejected unsafe evidence refs.',
      refs: [browserHostAdapterRegistryRef()],
      now,
    });
  }
  if (input.probeSource !== 'runtime-probe') {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter requires a runtime probe.',
      refs: safeRefs.refs,
      now,
    });
  }
  const session = input.browserHostSession;
  if (!session) {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter is blocked because no BrowserHostSession was supplied.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (session.providerId !== BROWSER_HOST_SESSION_PROVIDER_ID) {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter is blocked because the session provider is not BrowserHostSession.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (session.status !== 'ready') {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter is blocked because the BrowserHostSession is not ready.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (input.nativeBridgeReady !== true) {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter is blocked because the native bridge is not runtime ready.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (input.nativeSurfaceReady !== true || !browserHostSessionHasNativeSurface(session)) {
    return blockedReadiness({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      kind: 'browser-host-session',
      reason: 'BrowserHost Computer Use adapter is blocked because the native surface is not runtime ready.',
      refs: safeRefs.refs,
      now,
    });
  }
  return {
    schemaVersion: COMPUTER_USE_ADAPTER_REGISTRY_SCHEMA,
    status: 'ready',
    ready: true,
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    kind: 'browser-host-session',
    summary: `BrowserHostSession Computer Use adapter ready for ${safeRefPart(session.id)}.`,
    refs: safeRefs.refs,
    updatedAt: now().toISOString(),
  };
}

function nonBrowserProbeReadiness(
  record: AdapterRecord,
  input: ComputerUseAdapterProbeInput,
  now: () => Date,
): ComputerUseAdapterReadiness {
  const safeRefs = sanitizeEvidenceRefs(baseRefsForProvider(record.providerId, input.evidenceRefs));
  if (safeRefs.unsafe) {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: 'Computer Use adapter registry rejected unsafe evidence refs.',
      refs: baseRefsForProvider(record.providerId),
      now,
    });
  }
  if (record.source !== 'runtime') {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: registrationBlockedReason(record.providerId, record.source, false),
      refs: safeRefs.refs,
      now,
    });
  }
  if (input.probeSource !== 'runtime-probe') {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: 'Non-browser Computer Use adapter readiness requires a runtime probe.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (input.nativeBridgeReady !== true) {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: 'Non-browser Computer Use adapter is blocked because the native bridge is not runtime ready.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (input.nativeSurfaceReady !== true) {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: 'Non-browser Computer Use adapter is blocked because the native surface is not runtime ready.',
      refs: safeRefs.refs,
      now,
    });
  }
  if (safeRefs.refs.length <= 1) {
    return blockedReadiness({
      providerId: record.providerId,
      kind: record.kind,
      reason: 'Non-browser Computer Use adapter readiness requires runtime-owned probe evidence refs.',
      refs: safeRefs.refs,
      now,
    });
  }
  return {
    schemaVersion: COMPUTER_USE_ADAPTER_REGISTRY_SCHEMA,
    status: 'ready',
    ready: true,
    providerId: record.providerId,
    kind: record.kind,
    summary: `Non-browser Computer Use adapter ready from runtime probe for ${record.kind}.`,
    refs: safeRefs.refs,
    updatedAt: now().toISOString(),
  };
}

function registrationBlockedReason(
  providerId: string,
  source: ComputerUseAdapterRegistrationSource,
  unsafe: boolean,
): string {
  if (unsafe) return 'Computer Use adapter registry rejected unsafe registration evidence refs.';
  if (source === 'manifest') return 'Computer Use adapter registry blocked manifest-only readiness.';
  if (source === 'provider-url') return 'Computer Use adapter registry blocked provider-url-only readiness.';
  if (providerId === BROWSER_HOST_COMPUTER_USE_PROVIDER_ID) {
    return 'BrowserHost Computer Use adapter requires a runtime probe before ready.';
  }
  return 'Computer Use adapter registry requires a runtime probe before ready.';
}

function blockedReadiness(input: {
  providerId: string;
  kind?: ComputerUseAdapterProviderKind;
  reason: string;
  refs: string[];
  now: () => Date;
}): ComputerUseAdapterReadiness {
  return {
    schemaVersion: COMPUTER_USE_ADAPTER_REGISTRY_SCHEMA,
    status: 'blocked',
    ready: false,
    providerId: input.providerId,
    kind: input.kind,
    summary: `Computer Use adapter blocked: ${input.reason}`,
    refs: sanitizeEvidenceRefs(input.refs).refs,
    blockedReason: input.reason,
    updatedAt: input.now().toISOString(),
  };
}

function browserHostSessionHasNativeSurface(session: BrowserHostSessionState): boolean {
  return session.liveSurfaceTransport === 'native-embedded'
    && safeRuntimeOwnerRef(session.liveSurfaceRef)
    && session.singleInteractiveTruth === true
    && session.secondTruthSource === false;
}

function browserHostSessionRefs(session: BrowserHostSessionState | undefined): string[] {
  if (!session) return [];
  const sessionId = safeRefPart(session.id);
  return [
    `browser-host-session:${sessionId}`,
    session.liveSurfaceRef,
    `browser-host-session:${sessionId}/computer-use-adapter`,
    `runtime-truth:computer-use-adapter/browser-host-session/${sessionId}`,
    session.frameStreamRef,
  ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
}

function baseRefsForProvider(providerId: string, evidenceRefs: string[] = []): string[] {
  return [providerId === BROWSER_HOST_COMPUTER_USE_PROVIDER_ID ? browserHostAdapterRegistryRef() : `adapter-registry:${safeRefPart(providerId)}`, ...evidenceRefs];
}

function browserHostAdapterRegistryRef(): string {
  return 'adapter-registry:browser-host-session/computer-use';
}

function sanitizeEvidenceRefs(refs: string[]): { refs: string[]; unsafe: boolean } {
  const output: string[] = [];
  let unsafe = false;
  for (const ref of refs) {
    const trimmed = typeof ref === 'string' ? ref.trim() : '';
    if (!trimmed) continue;
    if (!safeRuntimeOwnerRef(trimmed)) {
      unsafe = true;
      continue;
    }
    if (!output.includes(trimmed)) output.push(trimmed);
    if (output.length >= 16) break;
  }
  return { refs: output, unsafe };
}

function safeRuntimeOwnerRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|gui-viewer:|screen-pane:|fixture:|replay:|replay-fixture:|snapshot-fixture:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|native-adapter:|desktop-native:|permission:|approval:|cancel:|stop:|lease:|adapter-registry:|window:|action-ledger:|evidence:|workEvidence:|native-host:|audit:)/i.test(trimmed);
}

function safeProviderId(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : 'unknown-provider';
}

function safeRefPart(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return 'unknown';
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'unknown';
}

function cloneReadiness(value: ComputerUseAdapterReadiness): ComputerUseAdapterReadiness {
  return {
    ...value,
    refs: [...value.refs],
  };
}
