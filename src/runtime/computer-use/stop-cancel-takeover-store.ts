export type StopCancelTakeoverControlKind =
  | 'browser-host.stop'
  | 'browser-host.close'
  | 'runtime-codex.cancel'
  | 'window-action.stop'
  | 'window-action.pause'
  | 'window-action.remove'
  | 'native-host.stop'
  | 'native-host.pause'
  | 'native-host.resume'
  | 'native-host.close'
  | 'human-takeover.lease'
  | 'human-takeover.pause'
  | 'human-takeover.resume'
  | 'human-takeover.stop';

export type StopCancelTakeoverAction = 'stop' | 'close' | 'cancel' | 'pause' | 'resume' | 'remove' | 'takeover';

export type StopCancelTakeoverTarget =
  | {
    type: 'browser-host-session';
    sessionId: string;
    workspacePath: string;
  }
  | {
    type: 'runtime-codex-turn';
    commandId: string;
    attemptId?: string;
  }
  | {
    type: 'window-action-session';
    sessionId: string;
    windowRef?: string;
  }
  | {
    type: 'native-host-session';
    sessionId: string;
    sessionRef?: string;
  }
  | {
    type: 'human-takeover';
    leaseId: string;
    actorId?: string;
  };

export type StopCancelTakeoverBlockedReason =
  | 'ref-not-host-owned'
  | 'ref-unregistered'
  | 'callback-missing'
  | 'callback-failed';

export interface StopCancelTakeoverCallbackContext {
  ref: string;
  kind: StopCancelTakeoverControlKind;
  action: StopCancelTakeoverAction;
  target: StopCancelTakeoverTarget;
  requestedBy?: string;
  reason?: string;
  registeredAt: string;
  materializedAt: string;
  evidenceRefs: string[];
}

export interface StopCancelTakeoverCallbackResult {
  evidenceRefs?: unknown[];
}

export type StopCancelTakeoverCallback = (
  context: StopCancelTakeoverCallbackContext,
) => void | StopCancelTakeoverCallbackResult | Promise<void | StopCancelTakeoverCallbackResult>;

export interface StopCancelTakeoverRegisterControlInput {
  kind: StopCancelTakeoverControlKind;
  ref: unknown;
  target: StopCancelTakeoverTarget;
  callback?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface StopCancelTakeoverControlRegistration {
  status: 'ready' | 'blocked';
  ref: string;
  kind?: StopCancelTakeoverControlKind;
  reason?: StopCancelTakeoverBlockedReason;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface BrowserHostStopCloseRegistration {
  status: 'ready' | 'blocked';
  reason?: StopCancelTakeoverBlockedReason;
  sessionRef: string;
  stopRef: string;
  closeRef: string;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface RuntimeCodexCancelRegistration {
  status: 'ready' | 'blocked';
  reason?: StopCancelTakeoverBlockedReason;
  cancelRef: string;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface WindowActionStopPauseRemoveRegistration {
  status: 'ready' | 'blocked';
  reason?: StopCancelTakeoverBlockedReason;
  sessionRef: string;
  stopRef: string;
  pauseRef: string;
  removeRef: string;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface NativeHostStopPauseCloseRegistration {
  status: 'ready' | 'blocked';
  reason?: StopCancelTakeoverBlockedReason;
  sessionRef: string;
  stopRef: string;
  pauseRef: string;
  resumeRef?: string;
  closeRef: string;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface HumanTakeoverLeaseRegistration {
  status: 'ready' | 'blocked';
  reason?: StopCancelTakeoverBlockedReason;
  leaseRef: string;
  pauseRef?: string;
  resumeRef?: string;
  stopRef?: string;
  evidenceRefs: string[];
  registeredAt: string;
}

export interface StopCancelTakeoverMaterializeInput {
  requestedBy?: string;
  reason?: string;
}

export interface StopCancelTakeoverMaterializeResult {
  status: 'completed' | 'blocked';
  ref: string;
  kind?: StopCancelTakeoverControlKind;
  action?: StopCancelTakeoverAction;
  reason?: StopCancelTakeoverBlockedReason;
  evidenceRefs: string[];
  materializedAt: string;
}

export interface RegisterBrowserHostControlsInput {
  workspacePath: string;
  sessionId: string;
  stop?: StopCancelTakeoverCallback;
  close?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface RegisterRuntimeCodexCancelInput {
  commandId: string;
  attemptId?: string;
  cancel?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface RegisterWindowActionControlsInput {
  sessionId: string;
  windowRef?: string;
  stop?: StopCancelTakeoverCallback;
  pause?: StopCancelTakeoverCallback;
  remove?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface RegisterNativeHostControlsInput {
  sessionId: string;
  sessionRef?: string;
  stop?: StopCancelTakeoverCallback;
  pause?: StopCancelTakeoverCallback;
  resume?: StopCancelTakeoverCallback;
  close?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface RegisterHumanTakeoverLeaseInput {
  leaseId: string;
  actorId?: string;
  takeover?: StopCancelTakeoverCallback;
  pause?: StopCancelTakeoverCallback;
  resume?: StopCancelTakeoverCallback;
  stop?: StopCancelTakeoverCallback;
  evidenceRefs?: unknown[];
}

export interface StopCancelTakeoverStore {
  registerControl(input: StopCancelTakeoverRegisterControlInput): StopCancelTakeoverControlRegistration;
  registerBrowserHostControls(input: RegisterBrowserHostControlsInput): BrowserHostStopCloseRegistration;
  registerRuntimeCodexCancel(input: RegisterRuntimeCodexCancelInput): RuntimeCodexCancelRegistration;
  registerWindowActionControls(input: RegisterWindowActionControlsInput): WindowActionStopPauseRemoveRegistration;
  registerNativeHostControls(input: RegisterNativeHostControlsInput): NativeHostStopPauseCloseRegistration;
  registerHumanTakeoverLease(input: RegisterHumanTakeoverLeaseInput): HumanTakeoverLeaseRegistration;
  materialize(ref: unknown, input?: StopCancelTakeoverMaterializeInput): Promise<StopCancelTakeoverMaterializeResult>;
  get(ref: unknown): StopCancelTakeoverControlRegistration | undefined;
  clear(): void;
}

export interface InMemoryStopCancelTakeoverStoreOptions {
  now?: () => string;
  maxEvidenceRefs?: number;
}

interface RegisteredStopCancelTakeoverControl {
  ref: string;
  kind: StopCancelTakeoverControlKind;
  action: StopCancelTakeoverAction;
  target: StopCancelTakeoverTarget;
  callback?: StopCancelTakeoverCallback;
  evidenceRefs: string[];
  registeredAt: string;
}

const DEFAULT_MAX_EVIDENCE_REFS = 12;
const MAX_REF_LENGTH = 240;
const REF_PART_PATTERN_SOURCE = '[A-Za-z0-9._:-]{1,80}';

const MATERIALIZABLE_REF_PATTERN = new RegExp(
  `^(?:`
  + `stop:browser-host-session/${REF_PART_PATTERN_SOURCE}/(?:stop|close)`
  + `|cancel:runtime-codex/${REF_PART_PATTERN_SOURCE}(?:/${REF_PART_PATTERN_SOURCE})?`
  + `|stop:window-action-session/${REF_PART_PATTERN_SOURCE}/(?:stop|pause|remove)`
  + `|stop:computer-use/native-host/${REF_PART_PATTERN_SOURCE}/(?:stop|close)`
  + `|lease:computer-use/native-host/${REF_PART_PATTERN_SOURCE}/(?:pause|resume)`
  + `|lease:human-takeover/${REF_PART_PATTERN_SOURCE}(?:/(?:pause|resume|stop))?`
  + `)$`,
  'i',
);
const OWNER_EVIDENCE_REF_PATTERN =
  /^(?:browser-host-session:|window-action-session:|computer-use:|native-host:|action-ledger:|evidence:|workEvidence:|runtime-truth:|permission:|cancel:|stop:|lease:|adapter-registry:|desktop-native:|audit:)/i;
const FORBIDDEN_REF_PREFIX_PATTERN =
  /^(?:gui(?:\.|:)|ui:|gui-viewer:|screen-pane:|fixture:|replay:|replay-fixture:|snapshot-fixture:)/i;
const UNSAFE_INLINE_REF_PATTERN =
  /https?:\/\/|data:image|;base64,|\bbase64\b|<html|<script|authorization\s*:|bearer\s+|api[-_ ]?key|access[-_]?token|auth[-_]?token|refresh[-_]?token|\btoken\b|secret|password|credential/i;

export function createInMemoryStopCancelTakeoverStore(
  options: InMemoryStopCancelTakeoverStoreOptions = {},
): StopCancelTakeoverStore {
  return new InMemoryStopCancelTakeoverStore(options);
}

export function createDefaultStopCancelTakeoverStore(): StopCancelTakeoverStore {
  return createInMemoryStopCancelTakeoverStore();
}

class InMemoryStopCancelTakeoverStore implements StopCancelTakeoverStore {
  private readonly controls = new Map<string, RegisteredStopCancelTakeoverControl>();
  private readonly now: () => string;
  private readonly maxEvidenceRefs: number;

  constructor(options: InMemoryStopCancelTakeoverStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxEvidenceRefs = positiveInteger(options.maxEvidenceRefs, DEFAULT_MAX_EVIDENCE_REFS);
  }

  registerControl(input: StopCancelTakeoverRegisterControlInput): StopCancelTakeoverControlRegistration {
    const registeredAt = this.now();
    const ref = materializableRef(input.ref);
    if (!ref) {
      return {
        status: 'blocked',
        reason: 'ref-not-host-owned',
        ref: 'blocked:invalid-ref',
        evidenceRefs: [],
        registeredAt,
      };
    }
    const evidenceRefs = boundedOwnerEvidenceRefs(input.evidenceRefs, this.maxEvidenceRefs);
    this.controls.set(ref, {
      ref,
      kind: input.kind,
      action: actionForKind(input.kind),
      target: input.target,
      callback: input.callback,
      evidenceRefs,
      registeredAt,
    });
    return {
      status: 'ready',
      ref,
      kind: input.kind,
      evidenceRefs,
      registeredAt,
    };
  }

  registerBrowserHostControls(input: RegisterBrowserHostControlsInput): BrowserHostStopCloseRegistration {
    const sessionId = safeRefPart(input.sessionId, 'session');
    const target: StopCancelTakeoverTarget = {
      type: 'browser-host-session',
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
    };
    const stop = this.registerControl({
      kind: 'browser-host.stop',
      ref: `stop:browser-host-session/${sessionId}/stop`,
      target,
      callback: input.stop,
      evidenceRefs: input.evidenceRefs,
    });
    const close = this.registerControl({
      kind: 'browser-host.close',
      ref: `stop:browser-host-session/${sessionId}/close`,
      target,
      callback: input.close,
      evidenceRefs: input.evidenceRefs,
    });
    return {
      status: combinedStatus(stop, close),
      reason: stop.reason ?? close.reason,
      sessionRef: `browser-host-session:${sessionId}`,
      stopRef: stop.ref,
      closeRef: close.ref,
      evidenceRefs: boundedOwnerEvidenceRefs(input.evidenceRefs, this.maxEvidenceRefs),
      registeredAt: stop.registeredAt,
    };
  }

  registerRuntimeCodexCancel(input: RegisterRuntimeCodexCancelInput): RuntimeCodexCancelRegistration {
    const commandId = safeRefPart(input.commandId, 'command');
    const attemptId = input.attemptId ? safeRefPart(input.attemptId, 'attempt') : undefined;
    const cancel = this.registerControl({
      kind: 'runtime-codex.cancel',
      ref: `cancel:runtime-codex/${commandId}${attemptId ? `/${attemptId}` : ''}`,
      target: {
        type: 'runtime-codex-turn',
        commandId: input.commandId,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      },
      callback: input.cancel,
      evidenceRefs: input.evidenceRefs,
    });
    return {
      status: cancel.status,
      reason: cancel.reason,
      cancelRef: cancel.ref,
      evidenceRefs: cancel.evidenceRefs,
      registeredAt: cancel.registeredAt,
    };
  }

  registerWindowActionControls(input: RegisterWindowActionControlsInput): WindowActionStopPauseRemoveRegistration {
    const sessionId = safeRefPart(input.sessionId, 'session');
    const target: StopCancelTakeoverTarget = {
      type: 'window-action-session',
      sessionId: input.sessionId,
      ...(input.windowRef ? { windowRef: input.windowRef } : {}),
    };
    const stop = this.registerControl({
      kind: 'window-action.stop',
      ref: `stop:window-action-session/${sessionId}/stop`,
      target,
      callback: input.stop,
      evidenceRefs: input.evidenceRefs,
    });
    const pause = this.registerControl({
      kind: 'window-action.pause',
      ref: `stop:window-action-session/${sessionId}/pause`,
      target,
      callback: input.pause,
      evidenceRefs: input.evidenceRefs,
    });
    const remove = this.registerControl({
      kind: 'window-action.remove',
      ref: `stop:window-action-session/${sessionId}/remove`,
      target,
      callback: input.remove,
      evidenceRefs: input.evidenceRefs,
    });
    return {
      status: combinedStatus(stop, pause, remove),
      reason: stop.reason ?? pause.reason ?? remove.reason,
      sessionRef: `window-action-session:${sessionId}`,
      stopRef: stop.ref,
      pauseRef: pause.ref,
      removeRef: remove.ref,
      evidenceRefs: boundedOwnerEvidenceRefs(input.evidenceRefs, this.maxEvidenceRefs),
      registeredAt: stop.registeredAt,
    };
  }

  registerNativeHostControls(input: RegisterNativeHostControlsInput): NativeHostStopPauseCloseRegistration {
    const sessionId = safeRefPart(input.sessionId, 'session');
    const sessionRef = boundedRef(input.sessionRef) ?? `computer-use:native-host/sessions/${sessionId}/session.json`;
    const target: StopCancelTakeoverTarget = {
      type: 'native-host-session',
      sessionId: input.sessionId,
      sessionRef,
    };
    const stop = this.registerControl({
      kind: 'native-host.stop',
      ref: `stop:computer-use/native-host/${sessionId}/stop`,
      target,
      callback: input.stop,
      evidenceRefs: input.evidenceRefs,
    });
    const pause = this.registerControl({
      kind: 'native-host.pause',
      ref: `lease:computer-use/native-host/${sessionId}/pause`,
      target,
      callback: input.pause,
      evidenceRefs: input.evidenceRefs,
    });
    const resume = input.resume
      ? this.registerControl({
        kind: 'native-host.resume',
        ref: `lease:computer-use/native-host/${sessionId}/resume`,
        target,
        callback: input.resume,
        evidenceRefs: input.evidenceRefs,
      })
      : undefined;
    const close = this.registerControl({
      kind: 'native-host.close',
      ref: `stop:computer-use/native-host/${sessionId}/close`,
      target,
      callback: input.close,
      evidenceRefs: input.evidenceRefs,
    });
    return {
      status: combinedStatus(...[stop, pause, resume, close].filter((registration): registration is StopCancelTakeoverControlRegistration => Boolean(registration))),
      reason: stop.reason ?? pause.reason ?? resume?.reason ?? close.reason,
      sessionRef,
      stopRef: stop.ref,
      pauseRef: pause.ref,
      ...(resume ? { resumeRef: resume.ref } : {}),
      closeRef: close.ref,
      evidenceRefs: boundedOwnerEvidenceRefs(input.evidenceRefs, this.maxEvidenceRefs),
      registeredAt: stop.registeredAt,
    };
  }

  registerHumanTakeoverLease(input: RegisterHumanTakeoverLeaseInput): HumanTakeoverLeaseRegistration {
    const leaseId = safeRefPart(input.leaseId, 'lease');
    const target: StopCancelTakeoverTarget = {
      type: 'human-takeover',
      leaseId: input.leaseId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
    };
    const lease = this.registerControl({
      kind: 'human-takeover.lease',
      ref: `lease:human-takeover/${leaseId}`,
      target,
      callback: input.takeover,
      evidenceRefs: input.evidenceRefs,
    });
    const pause = input.pause
      ? this.registerControl({
        kind: 'human-takeover.pause',
        ref: `lease:human-takeover/${leaseId}/pause`,
        target,
        callback: input.pause,
        evidenceRefs: input.evidenceRefs,
      })
      : undefined;
    const resume = input.resume
      ? this.registerControl({
        kind: 'human-takeover.resume',
        ref: `lease:human-takeover/${leaseId}/resume`,
        target,
        callback: input.resume,
        evidenceRefs: input.evidenceRefs,
      })
      : undefined;
    const stop = input.stop
      ? this.registerControl({
        kind: 'human-takeover.stop',
        ref: `lease:human-takeover/${leaseId}/stop`,
        target,
        callback: input.stop,
        evidenceRefs: input.evidenceRefs,
      })
      : undefined;
    return {
      status: combinedStatus(...[lease, pause, resume, stop].filter((registration): registration is StopCancelTakeoverControlRegistration => Boolean(registration))),
      reason: lease.reason ?? pause?.reason ?? resume?.reason ?? stop?.reason,
      leaseRef: lease.ref,
      ...(pause ? { pauseRef: pause.ref } : {}),
      ...(resume ? { resumeRef: resume.ref } : {}),
      ...(stop ? { stopRef: stop.ref } : {}),
      evidenceRefs: lease.evidenceRefs,
      registeredAt: lease.registeredAt,
    };
  }

  async materialize(
    refValue: unknown,
    input: StopCancelTakeoverMaterializeInput = {},
  ): Promise<StopCancelTakeoverMaterializeResult> {
    const materializedAt = this.now();
    const ref = materializableRef(refValue);
    if (!ref) {
      return blockedResult('blocked:invalid-ref', 'ref-not-host-owned', [], materializedAt);
    }
    const entry = this.controls.get(ref);
    if (!entry) {
      return blockedResult(ref, 'ref-unregistered', [ref], materializedAt);
    }
    const baseEvidenceRefs = entry.evidenceRefs.length ? entry.evidenceRefs : [entry.ref];
    if (!entry.callback) {
      return blockedResult(ref, 'callback-missing', baseEvidenceRefs, materializedAt, entry);
    }
    try {
      const callbackResult = await entry.callback({
        ref,
        kind: entry.kind,
        action: entry.action,
        target: entry.target,
        requestedBy: safeOptionalText(input.requestedBy),
        reason: safeOptionalText(input.reason),
        registeredAt: entry.registeredAt,
        materializedAt,
        evidenceRefs: baseEvidenceRefs,
      });
      const callbackEvidenceRefs = boundedOwnerEvidenceRefs(
        isRecord(callbackResult) ? callbackResult.evidenceRefs : undefined,
        this.maxEvidenceRefs,
      );
      return {
        status: 'completed',
        ref,
        kind: entry.kind,
        action: entry.action,
        evidenceRefs: uniqueStrings([...baseEvidenceRefs, ...callbackEvidenceRefs]).slice(0, this.maxEvidenceRefs),
        materializedAt,
      };
    } catch {
      return blockedResult(ref, 'callback-failed', baseEvidenceRefs, materializedAt, entry);
    }
  }

  get(refValue: unknown): StopCancelTakeoverControlRegistration | undefined {
    const ref = materializableRef(refValue);
    if (!ref) return undefined;
    const entry = this.controls.get(ref);
    if (!entry) return undefined;
    return {
      status: 'ready',
      ref: entry.ref,
      kind: entry.kind,
      evidenceRefs: entry.evidenceRefs,
      registeredAt: entry.registeredAt,
    };
  }

  clear(): void {
    this.controls.clear();
  }
}

function blockedResult(
  ref: string,
  reason: StopCancelTakeoverBlockedReason,
  evidenceRefs: string[],
  materializedAt: string,
  entry?: RegisteredStopCancelTakeoverControl,
): StopCancelTakeoverMaterializeResult {
  return {
    status: 'blocked',
    ref,
    reason,
    ...(entry ? { kind: entry.kind, action: entry.action } : {}),
    evidenceRefs,
    materializedAt,
  };
}

function actionForKind(kind: StopCancelTakeoverControlKind): StopCancelTakeoverAction {
  switch (kind) {
    case 'browser-host.stop':
    case 'window-action.stop':
    case 'native-host.stop':
      return 'stop';
    case 'browser-host.close':
    case 'native-host.close':
      return 'close';
    case 'runtime-codex.cancel':
      return 'cancel';
    case 'window-action.pause':
    case 'native-host.pause':
    case 'human-takeover.pause':
      return 'pause';
    case 'native-host.resume':
    case 'human-takeover.resume':
      return 'resume';
    case 'window-action.remove':
      return 'remove';
    case 'human-takeover.lease':
      return 'takeover';
    case 'human-takeover.stop':
      return 'stop';
  }
}

function combinedStatus(...registrations: StopCancelTakeoverControlRegistration[]): 'ready' | 'blocked' {
  return registrations.every((registration) => registration.status === 'ready') ? 'ready' : 'blocked';
}

function materializableRef(value: unknown): string | undefined {
  const ref = boundedRef(value);
  if (!ref || !MATERIALIZABLE_REF_PATTERN.test(ref)) return undefined;
  return ref;
}

function boundedOwnerEvidenceRefs(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : [];
  return uniqueStrings(
    values
      .map((item) => boundedRef(item))
      .filter((ref): ref is string => Boolean(ref && OWNER_EVIDENCE_REF_PATTERN.test(ref))),
  ).slice(0, limit);
}

function boundedRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ref = value.trim();
  if (!ref || ref.length > MAX_REF_LENGTH) return undefined;
  if (FORBIDDEN_REF_PREFIX_PATTERN.test(ref)) return undefined;
  if (UNSAFE_INLINE_REF_PATTERN.test(ref)) return undefined;
  return ref;
}

function safeRefPart(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_INLINE_REF_PATTERN.test(trimmed) || FORBIDDEN_REF_PREFIX_PATTERN.test(trimmed)) {
    return fallback;
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return sanitized || fallback;
}

function safeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_INLINE_REF_PATTERN.test(trimmed)) return undefined;
  return trimmed.slice(0, 160);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
