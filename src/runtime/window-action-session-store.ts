import type { BrowserHostSessionState } from './browser-host-session.js';
import {
  createWindowActionSession,
  pauseWindowActionSession,
  removeWindowActionSession,
  stopWindowActionSession,
  type WindowActionEvidenceRef,
  type WindowActionSession,
} from './window-action-session.js';

type MaybeBrowserHostSession = Partial<BrowserHostSessionState> & {
  id?: string;
  status?: string;
};

export interface WindowActionSessionStoreBrowserHostInput {
  browserHostSession: MaybeBrowserHostSession;
  sessionId?: string;
  sessionRef?: string;
  commandId?: string;
  attemptId?: string;
  riskCategory?: string;
  nativeBridgeReady?: boolean;
  nativeSurfaceReady?: boolean;
  abortSignal?: AbortSignal;
}

export interface WindowActionSessionStoreUpsertOptions {
  refs?: unknown[];
  targetRefs?: unknown[];
  observationRefs?: unknown[];
  timestamp?: string;
}

export interface WindowActionSessionStoreControlOptions {
  refs?: unknown[];
  reason?: string;
  timestamp?: string;
}

export interface WindowActionSessionStoreEntry {
  ref: string;
  session: WindowActionSession;
  refs: string[];
  targetRefs: string[];
  observationRefs: string[];
  updatedAt: string;
}

export interface WindowActionSessionStoreMaterializeResult {
  status: 'ready' | 'blocked';
  ready: boolean;
  summary?: string;
  refs: string[];
  targetRefs: string[];
  observationRefs: string[];
  session?: WindowActionSession;
  reason?: string;
}

export interface WindowActionSessionStoreControlResult {
  status: 'completed' | 'blocked';
  refs: string[];
  session?: WindowActionSession;
  reason?: string;
}

export interface WindowActionSessionStore {
  upsert(
    session: WindowActionSession,
    options?: WindowActionSessionStoreUpsertOptions,
  ): WindowActionSessionStoreMaterializeResult;
  getActiveByRef(ref: string): WindowActionSessionStoreEntry | undefined;
  materializeForBrowserHostSession(
    input: WindowActionSessionStoreBrowserHostInput,
  ): WindowActionSessionStoreMaterializeResult;
  pause(ref: string, options?: WindowActionSessionStoreControlOptions): WindowActionSessionStoreControlResult;
  stop(ref: string, options?: WindowActionSessionStoreControlOptions): WindowActionSessionStoreControlResult;
  remove(ref: string, options?: WindowActionSessionStoreControlOptions): WindowActionSessionStoreControlResult;
}

const MAX_STORE_REFS = 24;

export function createInMemoryWindowActionSessionStore(options: {
  now?: () => Date;
} = {}): WindowActionSessionStore {
  return new InMemoryWindowActionSessionStore(options.now ?? (() => new Date()));
}

export function createDefaultWindowActionSessionStore(options: {
  now?: () => Date;
} = {}): WindowActionSessionStore {
  return createInMemoryWindowActionSessionStore(options);
}

class InMemoryWindowActionSessionStore implements WindowActionSessionStore {
  private readonly entries = new Map<string, WindowActionSessionStoreEntry>();
  private readonly index = new Map<string, string>();

  constructor(private readonly now: () => Date) {}

  upsert(
    session: WindowActionSession,
    options: WindowActionSessionStoreUpsertOptions = {},
  ): WindowActionSessionStoreMaterializeResult {
    const sessionId = safeRefPart(session.id);
    const ref = `window-action-session:${sessionId}`;
    const sessionEvidenceRefs = sanitizedEvidenceRefs(session.evidenceRefs);
    const targetRefs = sanitizedRefs([
      ref,
      session.windowRef,
      ...unknownList(options.targetRefs),
    ]);
    const observationRefs = sanitizedRefs(options.observationRefs);
    const refs = sanitizedRefs([
      ref,
      `action-ledger:window-action-session/${sessionId}/upsert`,
      `lease:window-action-session/${sessionId}/agent-host`,
      ...sessionEvidenceRefs.map((item) => item.ref),
      ...unknownList(options.refs),
    ]);
    const stored = this.storeEntry({
      ref,
      session: {
        ...session,
        evidenceRefs: sessionEvidenceRefs,
      },
      refs,
      targetRefs,
      observationRefs,
      updatedAt: options.timestamp ?? this.now().toISOString(),
    });
    return readyResult(stored, `WindowActionSession ${sessionId}`);
  }

  getActiveByRef(ref: string): WindowActionSessionStoreEntry | undefined {
    const entry = this.entryByRef(ref);
    if (!entry || entry.session.status !== 'active') return undefined;
    return copyEntry(entry);
  }

  materializeForBrowserHostSession(
    input: WindowActionSessionStoreBrowserHostInput,
  ): WindowActionSessionStoreMaterializeResult {
    if (input.abortSignal?.aborted) {
      return blockedMaterializeResult('window-action-session-aborted');
    }
    if (input.nativeBridgeReady === false || input.nativeSurfaceReady === false) {
      return blockedMaterializeResult('browser-host-native-surface-unavailable');
    }
    const sessionId = safeRefPart(input.sessionId ?? input.browserHostSession.id);
    if (sessionId === 'unknown') {
      return blockedMaterializeResult('browser-host-session-id-missing');
    }
    const browserSessionRef = safeRuntimeOwnerRef(input.sessionRef)
      ? input.sessionRef as string
      : `browser-host-session:${sessionId}`;
    const ref = `window-action-session:browser-host-session/${sessionId}`;
    const ledgerRef = `action-ledger:browser-host-session/${sessionId}/window-action-session`;
    const leaseRef = `lease:browser-host-session/${sessionId}/agent-host`;
    const observationRefs = browserHostObservationRefs(input.browserHostSession);
    const refs = sanitizedRefs([
      ref,
      ledgerRef,
      leaseRef,
      browserSessionRef,
      input.browserHostSession.liveSurfaceRef,
      ...observationRefs,
    ]);
    const session = createWindowActionSession({
      id: `browser-host-session-${sessionId}`,
      windowRef: `${browserSessionRef}/window`,
      app: {
        id: 'sciforge.browser-host-session',
        name: safeSummary(input.browserHostSession.title) ?? 'BrowserHostSession',
        kind: 'browser',
      },
      evidenceRefs: evidenceRefsFromStrings(refs),
      timestamp: this.now().toISOString(),
    });
    const stored = this.storeEntry({
      ref,
      session,
      refs,
      targetRefs: [browserSessionRef, ref],
      observationRefs,
      updatedAt: this.now().toISOString(),
    });
    return readyResult(
      stored,
      safeSummary(input.browserHostSession.title)
        ? `WindowActionSession for BrowserHostSession ${sessionId}: ${safeSummary(input.browserHostSession.title)}`
        : `WindowActionSession for BrowserHostSession ${sessionId}`,
    );
  }

  pause(ref: string, options: WindowActionSessionStoreControlOptions = {}): WindowActionSessionStoreControlResult {
    return this.control(ref, 'pause', options);
  }

  stop(ref: string, options: WindowActionSessionStoreControlOptions = {}): WindowActionSessionStoreControlResult {
    return this.control(ref, 'stop', options);
  }

  remove(ref: string, options: WindowActionSessionStoreControlOptions = {}): WindowActionSessionStoreControlResult {
    return this.control(ref, 'remove', options);
  }

  private control(
    ref: string,
    action: 'pause' | 'stop' | 'remove',
    options: WindowActionSessionStoreControlOptions,
  ): WindowActionSessionStoreControlResult {
    const entry = this.entryByRef(ref);
    if (!entry || entry.session.status === 'removed') {
      return {
        status: 'blocked',
        reason: 'window-action-session-unavailable',
        refs: [],
      };
    }
    const timestamp = options.timestamp ?? this.now().toISOString();
    const sessionId = safeRefPart(entry.session.id);
    const controlRefs = sanitizedRefs([
      `action-ledger:window-action-session/${sessionId}/control/${action}/${safeRefPart(timestamp)}`,
      `lease:window-action-session/${sessionId}/control/${action}`,
      ...unknownList(options.refs),
    ]);
    const evidenceRefs = evidenceRefsFromStrings(controlRefs);
    const session = action === 'pause'
      ? pauseWindowActionSession(entry.session, { timestamp, evidenceRefs })
      : action === 'stop'
        ? stopWindowActionSession(entry.session, { timestamp, evidenceRefs })
        : removeWindowActionSession(entry.session, { timestamp, evidenceRefs });
    const stored = this.storeEntry({
      ...entry,
      session,
      refs: sanitizedRefs([...entry.refs, ...controlRefs]),
      updatedAt: timestamp,
    });
    return {
      status: 'completed',
      refs: controlRefs,
      session: stored.session,
    };
  }

  private storeEntry(entry: WindowActionSessionStoreEntry): WindowActionSessionStoreEntry {
    const refs = sanitizedRefs(entry.refs);
    const targetRefs = sanitizedRefs(entry.targetRefs);
    const observationRefs = sanitizedRefs(entry.observationRefs);
    const stored: WindowActionSessionStoreEntry = {
      ref: entry.ref,
      session: entry.session,
      refs,
      targetRefs,
      observationRefs,
      updatedAt: entry.updatedAt,
    };
    this.entries.set(entry.ref, stored);
    for (const ref of sanitizedRefs([
      entry.ref,
      entry.session.windowRef,
      ...refs,
      ...targetRefs,
      ...observationRefs,
    ])) {
      this.index.set(ref, entry.ref);
    }
    return copyEntry(stored);
  }

  private entryByRef(ref: string): WindowActionSessionStoreEntry | undefined {
    if (!safeRuntimeOwnerRef(ref)) return undefined;
    const key = this.index.get(ref) ?? (this.entries.has(ref) ? ref : undefined);
    if (!key) return undefined;
    const entry = this.entries.get(key);
    return entry ? copyEntry(entry) : undefined;
  }
}

function readyResult(
  entry: WindowActionSessionStoreEntry,
  summary: string,
): WindowActionSessionStoreMaterializeResult {
  return {
    status: 'ready',
    ready: true,
    summary,
    refs: entry.refs,
    targetRefs: entry.targetRefs,
    observationRefs: entry.observationRefs,
    session: entry.session,
  };
}

function blockedMaterializeResult(reason: string): WindowActionSessionStoreMaterializeResult {
  return {
    status: 'blocked',
    ready: false,
    reason,
    refs: [],
    targetRefs: [],
    observationRefs: [],
  };
}

function browserHostObservationRefs(session: MaybeBrowserHostSession): string[] {
  return sanitizedRefs([
    session.frameRef,
    session.screenshotRef,
    session.domSnapshotRef,
    session.axSnapshotRef,
    session.loadingProgress?.refs?.frame,
    session.loadingProgress?.refs?.screenshot,
    session.loadingProgress?.refs?.domSnapshot,
    session.loadingProgress?.refs?.axSnapshot,
  ]);
}

function sanitizedEvidenceRefs(value: WindowActionEvidenceRef[]): WindowActionEvidenceRef[] {
  const output: WindowActionEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!safeEvidenceKind(item.kind) || !safeRuntimeOwnerRef(item.ref)) continue;
    const key = `${item.kind}\n${item.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ kind: item.kind, ref: item.ref });
  }
  return output.slice(0, 8);
}

function evidenceRefsFromStrings(refs: string[]): WindowActionEvidenceRef[] {
  return refs.map((ref) => ({
    kind: evidenceKindForRef(ref),
    ref,
  })).slice(0, 8);
}

function evidenceKindForRef(ref: string): string {
  const prefix = ref.split(':', 1)[0] ?? 'runtime';
  return prefix.replace(/[^a-z0-9.-]+/gi, '-').slice(0, 64) || 'runtime';
}

function sanitizedRefs(value: unknown): string[] {
  const output: string[] = [];
  for (const ref of unknownList(value)) {
    if (!safeRuntimeOwnerRef(ref)) continue;
    if (output.includes(ref)) continue;
    output.push(ref);
    if (output.length >= MAX_STORE_REFS) break;
  }
  return output;
}

function unknownList(value: unknown): string[] {
  if (!Array.isArray(value)) return value === undefined ? [] : [value].flatMap(unknownRef);
  return value.flatMap(unknownRef);
}

function unknownRef(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return typeof record.ref === 'string' ? [record.ref.trim()] : [];
}

function safeRuntimeOwnerRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ref = value.trim();
  if (!ref || ref.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|gui-viewer:|screen-pane:|fixture:|replay:|replay-fixture:|snapshot-fixture:)/i.test(ref)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(ref)) return false;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|native-adapter:|desktop-native:|permission:|approval:|cancel:|stop:|lease:|adapter-registry:|window:|action-ledger:|evidence:|workEvidence:|native-host:|audit:)/i.test(ref);
}

function safeEvidenceKind(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const kind = value.trim();
  return Boolean(kind)
    && kind.length <= 64
    && !/secret|token|password|api[-_]?key|bearer|payload|base64/i.test(kind);
}

function safeRefPart(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const safe = value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96).toLowerCase();
  return safe || 'unknown';
}

function safeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || /https?:\/\/|data:image|base64|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return undefined;
  return trimmed.slice(0, 80);
}

function copyEntry(entry: WindowActionSessionStoreEntry): WindowActionSessionStoreEntry {
  return {
    ref: entry.ref,
    session: {
      ...entry.session,
      scopedInputAdapters: [...entry.session.scopedInputAdapters],
      events: entry.session.events.map((event) => ({
        ...event,
        evidenceRefs: [...event.evidenceRefs],
      })),
      evidenceRefs: [...entry.session.evidenceRefs],
    },
    refs: [...entry.refs],
    targetRefs: [...entry.targetRefs],
    observationRefs: [...entry.observationRefs],
    updatedAt: entry.updatedAt,
  };
}
