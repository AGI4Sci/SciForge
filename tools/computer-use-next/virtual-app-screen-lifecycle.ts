export const VIRTUAL_APP_SCREEN_LIFECYCLE_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-lifecycle.v1' as const;

export const VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-lifecycle-event.v1' as const;

export const VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES = [
  'create',
  'attach',
  'observe',
  'annotate',
  'control',
  'pause',
  'resume',
  'close',
  'handoff',
] as const;

export type VirtualAppScreenLifecycleEventType =
  typeof VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES[number];

export type VirtualAppScreenLifecycleEventStatus =
  | 'created'
  | 'attached'
  | 'observed'
  | 'annotated'
  | 'control-proposed'
  | 'paused'
  | 'resumed'
  | 'closed'
  | 'handoff-required'
  | 'blocked';

export interface VirtualAppScreenBindingRefs {
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  sessionRef: string;
}

export interface VirtualAppScreenLifecycleEventRefs extends VirtualAppScreenBindingRefs {
  eventRef: string;
  previousEventRef?: string;
  frameRef?: string;
  frameRefs?: string[];
  observationRef?: string;
  annotationOverlayRef?: string;
  annotationProposalRef?: string;
  inputIntentRef?: string;
  controlEventRef?: string;
  pauseRef?: string;
  resumeRef?: string;
  closeRef?: string;
  handoffRef?: string;
  blockedReasonRef?: string;
  guiPresentRef?: string;
  presentationRefs?: string[];
  evidenceRefs?: string[];
}

export interface VirtualAppScreenLifecycleEvent {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION;
  type: VirtualAppScreenLifecycleEventType;
  status: VirtualAppScreenLifecycleEventStatus;
  refsFirst: true;
  refs: VirtualAppScreenLifecycleEventRefs;
  at: string;
  reason?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface VirtualAppScreenLifecycleEventLog {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_LIFECYCLE_SCHEMA_VERSION;
  logRef: string;
  createdAt: string;
  refsFirst: true;
  guiBoundary: {
    role: 'presentation-and-event-refs';
    executesBackend: false;
    allowedRefs: ['presentationRefs', 'eventRefs'];
  };
  events: VirtualAppScreenLifecycleEvent[];
  validation: VirtualAppScreenLifecycleValidation;
}

export interface VirtualAppScreenLifecycleBuildOptions {
  runId: string;
  createdAt?: string;
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  sessionRef: string;
  logRef?: string;
  blockedReason?: string;
  blockedReasonRef?: string;
  handoffReason?: string;
  handoffRef?: string;
  presentationRefs?: string[];
  evidenceRefs?: string[];
  eventRefPrefix?: string;
}

export interface VirtualAppScreenLifecycleValidation {
  ok: boolean;
  issues: VirtualAppScreenLifecycleIssue[];
  missingEventTypes: VirtualAppScreenLifecycleEventType[];
  activeBindingConflicts: VirtualAppScreenBindingConflict[];
  rawPayloadViolations: VirtualAppScreenRawPayloadViolation[];
}

export interface VirtualAppScreenLifecycleIssue {
  code: string;
  message: string;
  eventRef?: string;
  eventType?: VirtualAppScreenLifecycleEventType;
}

export interface VirtualAppScreenBindingConflict {
  code:
    | 'screen-target-conflict'
    | 'target-app-active-conflict'
    | 'target-window-active-conflict'
    | 'target-session-active-conflict';
  screenRef: string;
  eventRef: string;
  activeEventRef?: string;
  previousBinding?: VirtualAppScreenBindingRefs;
  nextBinding: VirtualAppScreenBindingRefs;
  conflictingScreenRef?: string;
  targetRef?: string;
}

export interface VirtualAppScreenRawPayloadViolation {
  path: string;
  reason: 'raw-payload-key' | 'inline-base64' | 'backend-execution';
}

const statusByType: Record<VirtualAppScreenLifecycleEventType, VirtualAppScreenLifecycleEventStatus> = {
  create: 'created',
  attach: 'attached',
  observe: 'observed',
  annotate: 'annotated',
  control: 'control-proposed',
  pause: 'paused',
  resume: 'resumed',
  close: 'closed',
  handoff: 'handoff-required',
};

const lifecycleOrder = new Map<VirtualAppScreenLifecycleEventType, number>(
  VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES.map((type, index) => [type, index]),
);

const activeEventTypes = new Set<VirtualAppScreenLifecycleEventType>([
  'create',
  'attach',
  'observe',
  'annotate',
  'control',
  'pause',
  'resume',
]);

const releaseEventTypes = new Set<VirtualAppScreenLifecycleEventType>(['close', 'handoff']);

const rawPayloadKeyFragments = [
  'rawscreenshot',
  'screenshotbase64',
  'base64screenshot',
  'imagebase64',
  'base64image',
  'dataurl',
  'rawpayload',
  'providerpayload',
  'rawproviderpayload',
  'providerresponse',
  'providerresult',
  'providerbody',
  'backendresult',
  'executepayload',
  'executionpayload',
];

const exactRawPayloadKeys = new Set(['payload', 'base64', 'providerpayload', 'rawpayload']);

export function buildVirtualAppScreenLifecycleEventLog(
  options: VirtualAppScreenLifecycleBuildOptions,
): VirtualAppScreenLifecycleEventLog {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const logRef = options.logRef ?? `.sciforge/vision-runs/${options.runId}/virtual-app-screen-lifecycle.json`;
  const eventRefPrefix = options.eventRefPrefix ?? `.sciforge/vision-runs/${options.runId}/lifecycle`;
  const binding: VirtualAppScreenBindingRefs = {
    screenRef: options.screenRef,
    targetAppRef: options.targetAppRef,
    targetWindowRef: options.targetWindowRef,
    sessionRef: options.sessionRef,
  };
  const commonPresentationRefs = options.presentationRefs ?? [`${eventRefPrefix}/gui-present.json`];
  const commonEvidenceRefs = options.evidenceRefs ?? [`${eventRefPrefix}/evidence-ledger.json`];

  const eventRefs = Object.fromEntries(
    VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES.map((type) => [type, `${eventRefPrefix}/${type}.json`]),
  ) as Record<VirtualAppScreenLifecycleEventType, string>;
  const previousEventRef = (type: VirtualAppScreenLifecycleEventType): string | undefined => {
    const index = VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES.indexOf(type);
    return index > 0 ? eventRefs[VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES[index - 1]] : undefined;
  };
  const baseRefs = (type: VirtualAppScreenLifecycleEventType): VirtualAppScreenLifecycleEventRefs => ({
    ...binding,
    eventRef: eventRefs[type],
    previousEventRef: previousEventRef(type),
    presentationRefs: commonPresentationRefs,
    evidenceRefs: commonEvidenceRefs,
  });

  const events: VirtualAppScreenLifecycleEvent[] = [
    event('create', createdAt, {
      ...baseRefs('create'),
      guiPresentRef: commonPresentationRefs[0],
    }),
    event('attach', createdAt, {
      ...baseRefs('attach'),
      controlEventRef: `${eventRefPrefix}/attach-binding.json`,
    }),
    event('observe', createdAt, {
      ...baseRefs('observe'),
      frameRef: `${eventRefPrefix}/frames/current.png`,
      frameRefs: [`${eventRefPrefix}/frames/before.png`, `${eventRefPrefix}/frames/after.png`],
      observationRef: `${eventRefPrefix}/observations/frame-observation.json`,
    }),
    event('annotate', createdAt, {
      ...baseRefs('annotate'),
      annotationOverlayRef: `${eventRefPrefix}/annotations/overlay.json`,
      annotationProposalRef: `${eventRefPrefix}/annotations/proposal.json`,
    }),
    event('control', createdAt, {
      ...baseRefs('control'),
      inputIntentRef: `${eventRefPrefix}/input-intents/control-intent.json`,
      controlEventRef: `${eventRefPrefix}/control/control-event.json`,
    }),
    event('pause', createdAt, {
      ...baseRefs('pause'),
      pauseRef: `${eventRefPrefix}/pause.json`,
    }),
    event('resume', createdAt, {
      ...baseRefs('resume'),
      resumeRef: `${eventRefPrefix}/resume.json`,
    }),
    event('close', createdAt, {
      ...baseRefs('close'),
      closeRef: `${eventRefPrefix}/close.json`,
    }),
    event(
      'handoff',
      createdAt,
      {
        ...baseRefs('handoff'),
        handoffRef: options.handoffRef ?? `${eventRefPrefix}/handoff.json`,
        blockedReasonRef: options.blockedReasonRef ?? `${eventRefPrefix}/handoff-reason.json`,
      },
      options.handoffReason ?? options.blockedReason ?? 'VirtualAppScreen lifecycle closed with compact handoff refs.',
    ),
  ];

  const log = lifecycleLog({
    logRef,
    createdAt,
    events,
  });
  log.validation = validateVirtualAppScreenLifecycleEventLog(log);
  return log;
}

export function buildVirtualAppScreenLifecycleBlockedEvent(
  options: VirtualAppScreenLifecycleBuildOptions & {
    type?: VirtualAppScreenLifecycleEventType;
  },
): VirtualAppScreenLifecycleEvent {
  const type = options.type ?? 'handoff';
  const eventRefPrefix = options.eventRefPrefix ?? `.sciforge/vision-runs/${options.runId}/lifecycle`;
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION,
    type,
    status: 'blocked',
    refsFirst: true,
    refs: {
      screenRef: options.screenRef,
      targetAppRef: options.targetAppRef,
      targetWindowRef: options.targetWindowRef,
      sessionRef: options.sessionRef,
      eventRef: `${eventRefPrefix}/${type}-blocked.json`,
      blockedReasonRef: options.blockedReasonRef ?? `${eventRefPrefix}/${type}-blocked-reason.json`,
      handoffRef: type === 'handoff'
        ? options.handoffRef ?? `${eventRefPrefix}/handoff.json`
        : undefined,
      presentationRefs: options.presentationRefs ?? [`${eventRefPrefix}/gui-present.json`],
      evidenceRefs: options.evidenceRefs ?? [`${eventRefPrefix}/blocked-evidence-ledger.json`],
    },
    at: options.createdAt ?? new Date().toISOString(),
    reason: options.blockedReason ?? options.handoffReason ?? 'VirtualAppScreen lifecycle blocked with refs-first reason evidence.',
  };
}

export function validateVirtualAppScreenLifecycleEventLog(
  log: Pick<VirtualAppScreenLifecycleEventLog, 'refsFirst' | 'events'> & {
    guiBoundary?: VirtualAppScreenLifecycleEventLog['guiBoundary'];
  },
): VirtualAppScreenLifecycleValidation {
  const issues: VirtualAppScreenLifecycleIssue[] = [];
  const rawPayloadViolations = findRawPayloadViolations({
    refsFirst: log.refsFirst,
    guiBoundary: log.guiBoundary,
    events: log.events,
  });

  if (log.refsFirst !== true) {
    issues.push({
      code: 'log-not-refs-first',
      message: 'VirtualAppScreen lifecycle log must set refsFirst=true.',
    });
  }
  if (log.guiBoundary && log.guiBoundary.executesBackend !== false) {
    issues.push({
      code: 'gui-boundary-executes-backend',
      message: 'VirtualAppScreen GUI lifecycle may only expose presentation/event refs and must not execute backend actions.',
    });
  }

  const missingEventTypes = requiredMissingEventTypes(log.events);
  for (const type of missingEventTypes) {
    issues.push({
      code: 'missing-lifecycle-event',
      eventType: type,
      message: `Missing VirtualAppScreen lifecycle event: ${type}.`,
    });
  }

  issues.push(...eventShapeIssues(log.events));
  issues.push(...eventOrderIssues(log.events));

  const activeBindingConflicts = findActiveBindingConflicts(log.events);
  for (const conflict of activeBindingConflicts) {
    issues.push({
      code: conflict.code,
      eventRef: conflict.eventRef,
      message: bindingConflictMessage(conflict),
    });
  }

  for (const violation of rawPayloadViolations) {
    issues.push({
      code: violation.reason,
      message: `VirtualAppScreen lifecycle must be refs-first; rejected ${violation.reason} at ${violation.path}.`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    missingEventTypes,
    activeBindingConflicts,
    rawPayloadViolations,
  };
}

export function lifecycleLog(options: {
  logRef: string;
  createdAt: string;
  events: VirtualAppScreenLifecycleEvent[];
}): VirtualAppScreenLifecycleEventLog {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_LIFECYCLE_SCHEMA_VERSION,
    logRef: options.logRef,
    createdAt: options.createdAt,
    refsFirst: true,
    guiBoundary: {
      role: 'presentation-and-event-refs',
      executesBackend: false,
      allowedRefs: ['presentationRefs', 'eventRefs'],
    },
    events: options.events,
    validation: {
      ok: true,
      issues: [],
      missingEventTypes: [],
      activeBindingConflicts: [],
      rawPayloadViolations: [],
    },
  };
}

export function event(
  type: VirtualAppScreenLifecycleEventType,
  at: string,
  refs: VirtualAppScreenLifecycleEventRefs,
  reason?: string,
): VirtualAppScreenLifecycleEvent {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION,
    type,
    status: statusByType[type],
    refsFirst: true,
    refs,
    at,
    reason,
  };
}

function requiredMissingEventTypes(
  events: VirtualAppScreenLifecycleEvent[],
): VirtualAppScreenLifecycleEventType[] {
  const present = new Set(events.map((item) => item.type));
  return VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES.filter((type) => !present.has(type));
}

function eventShapeIssues(events: VirtualAppScreenLifecycleEvent[]): VirtualAppScreenLifecycleIssue[] {
  const issues: VirtualAppScreenLifecycleIssue[] = [];
  events.forEach((item, index) => {
    const refs = item.refs;
    const eventRef = refs?.eventRef;
    if (item.schemaVersion !== VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION) {
      issues.push({
        code: 'invalid-event-schema',
        eventRef,
        eventType: item.type,
        message: `Lifecycle event ${index} must use ${VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_SCHEMA_VERSION}.`,
      });
    }
    if (item.refsFirst !== true) {
      issues.push({
        code: 'event-not-refs-first',
        eventRef,
        eventType: item.type,
        message: `Lifecycle event ${item.type} must set refsFirst=true.`,
      });
    }
    const missing = missingBindingRefFields(item.refs);
    for (const field of missing) {
      issues.push({
        code: 'missing-binding-ref',
        eventRef,
        eventType: item.type,
        message: `Lifecycle event ${item.type} is missing refs.${field}.`,
      });
    }
    if (!refs) return;
    if (item.type === 'observe' && !hasAnyRef(refs.frameRef, refs.observationRef, ...(refs.frameRefs ?? []))) {
      issues.push({
        code: 'missing-observation-ref',
        eventRef,
        eventType: item.type,
        message: 'Observe event must carry frameRef, frameRefs, or observationRef.',
      });
    }
    if (item.type === 'annotate' && !hasAnyRef(refs.annotationOverlayRef, refs.annotationProposalRef)) {
      issues.push({
        code: 'missing-annotation-ref',
        eventRef,
        eventType: item.type,
        message: 'Annotate event must carry annotationOverlayRef or annotationProposalRef.',
      });
    }
    if (item.type === 'control' && !hasAnyRef(refs.inputIntentRef, refs.controlEventRef)) {
      issues.push({
        code: 'missing-control-ref',
        eventRef,
        eventType: item.type,
        message: 'Control event must carry inputIntentRef or controlEventRef, not backend execution payload.',
      });
    }
    if (item.type === 'handoff' && !hasAnyRef(refs.handoffRef)) {
      issues.push({
        code: 'missing-handoff-ref',
        eventRef,
        eventType: item.type,
        message: 'Handoff event must carry refs.handoffRef.',
      });
    }
    if ((item.type === 'handoff' || item.status === 'blocked') && !hasAnyRef(refs.blockedReasonRef)) {
      issues.push({
        code: 'missing-blocked-reason-ref',
        eventRef,
        eventType: item.type,
        message: 'Blocked or handoff lifecycle events must carry refs.blockedReasonRef.',
      });
    }
    if (item.status === 'blocked' && !item.reason?.trim()) {
      issues.push({
        code: 'missing-blocked-reason',
        eventRef,
        eventType: item.type,
        message: 'Blocked lifecycle events must include a compact reason summary plus reason ref.',
      });
    }
  });
  return issues;
}

function eventOrderIssues(events: VirtualAppScreenLifecycleEvent[]): VirtualAppScreenLifecycleIssue[] {
  const issues: VirtualAppScreenLifecycleIssue[] = [];
  let highestSeen = -1;
  for (const item of events) {
    const order = lifecycleOrder.get(item.type);
    if (order === undefined) {
      issues.push({
        code: 'unknown-lifecycle-event',
        eventRef: item.refs?.eventRef,
        eventType: item.type,
        message: `Unknown VirtualAppScreen lifecycle event type: ${String(item.type)}.`,
      });
      continue;
    }
    if (order < highestSeen) {
      issues.push({
        code: 'lifecycle-event-out-of-order',
        eventRef: item.refs?.eventRef,
        eventType: item.type,
        message: `Lifecycle event ${item.type} appears after a later lifecycle phase.`,
      });
    }
    highestSeen = Math.max(highestSeen, order);
  }
  return issues;
}

function findActiveBindingConflicts(
  events: VirtualAppScreenLifecycleEvent[],
): VirtualAppScreenBindingConflict[] {
  const conflicts: VirtualAppScreenBindingConflict[] = [];
  const screenBindings = new Map<string, { binding: VirtualAppScreenBindingRefs; activeEventRef: string; closed: boolean }>();
  const activeTargetApps = new Map<string, { screenRef: string; eventRef: string }>();
  const activeTargetWindows = new Map<string, { screenRef: string; eventRef: string }>();
  const activeTargetSessions = new Map<string, { screenRef: string; eventRef: string }>();
  const lastKnownBinding = new Map<string, VirtualAppScreenBindingRefs>();

  for (const item of events) {
    if (!hasCompleteBindingRefs(item.refs)) continue;
    const binding = bindingRefs(item.refs);
    const eventRef = item.refs.eventRef;
    const active = screenBindings.get(binding.screenRef);

    if (activeEventTypes.has(item.type)) {
      if (active && !sameBinding(active.binding, binding)) {
        conflicts.push({
          code: 'screen-target-conflict',
          screenRef: binding.screenRef,
          eventRef,
          activeEventRef: active.activeEventRef,
          previousBinding: active.binding,
          nextBinding: binding,
        });
      }
      const targetConflicts = [
        targetConflict('target-app-active-conflict', activeTargetApps, binding.targetAppRef, binding, eventRef),
        targetConflict('target-window-active-conflict', activeTargetWindows, binding.targetWindowRef, binding, eventRef),
        targetConflict('target-session-active-conflict', activeTargetSessions, binding.sessionRef, binding, eventRef),
      ].filter((conflict): conflict is VirtualAppScreenBindingConflict => Boolean(conflict));
      conflicts.push(...targetConflicts);

      if (!active) {
        screenBindings.set(binding.screenRef, { binding, activeEventRef: eventRef, closed: false });
        activeTargetApps.set(binding.targetAppRef, { screenRef: binding.screenRef, eventRef });
        activeTargetWindows.set(binding.targetWindowRef, { screenRef: binding.screenRef, eventRef });
        activeTargetSessions.set(binding.sessionRef, { screenRef: binding.screenRef, eventRef });
      }
      lastKnownBinding.set(binding.screenRef, binding);
    }

    if (releaseEventTypes.has(item.type)) {
      const known = active?.binding ?? lastKnownBinding.get(binding.screenRef);
      if (known && !sameBinding(known, binding)) {
        conflicts.push({
          code: 'screen-target-conflict',
          screenRef: binding.screenRef,
          eventRef,
          activeEventRef: active?.activeEventRef,
          previousBinding: known,
          nextBinding: binding,
        });
      }
      if (active) {
        screenBindings.delete(binding.screenRef);
        activeTargetApps.delete(active.binding.targetAppRef);
        activeTargetWindows.delete(active.binding.targetWindowRef);
        activeTargetSessions.delete(active.binding.sessionRef);
      }
      lastKnownBinding.set(binding.screenRef, binding);
    }
  }

  return conflicts;
}

function targetConflict(
  code: VirtualAppScreenBindingConflict['code'],
  activeRefs: Map<string, { screenRef: string; eventRef: string }>,
  targetRef: string,
  binding: VirtualAppScreenBindingRefs,
  eventRef: string,
): VirtualAppScreenBindingConflict | undefined {
  const active = activeRefs.get(targetRef);
  if (!active || active.screenRef === binding.screenRef) return undefined;
  return {
    code,
    screenRef: binding.screenRef,
    eventRef,
    activeEventRef: active.eventRef,
    nextBinding: binding,
    conflictingScreenRef: active.screenRef,
    targetRef,
  };
}

function bindingConflictMessage(conflict: VirtualAppScreenBindingConflict): string {
  if (conflict.code === 'screen-target-conflict') {
    return `Active screen ${conflict.screenRef} cannot bind multiple target app/window/session refs.`;
  }
  return `Target ref ${conflict.targetRef ?? 'unknown'} is already bound to active screen ${conflict.conflictingScreenRef ?? 'unknown'}.`;
}

function findRawPayloadViolations(value: unknown): VirtualAppScreenRawPayloadViolation[] {
  const violations: VirtualAppScreenRawPayloadViolation[] = [];
  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string') {
      if (isInlineBase64Like(current)) {
        violations.push({ path, reason: 'inline-base64' });
      }
      return;
    }
    if (!current || typeof current !== 'object') return;

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isRawPayloadKey(key)) {
        violations.push({ path: childPath, reason: 'raw-payload-key' });
      }
      if (isBackendExecutionKeyValue(key, child)) {
        violations.push({ path: childPath, reason: 'backend-execution' });
      }
      visit(child, childPath);
    }
  };
  visit(value, '$');
  return dedupeViolations(violations);
}

function isRawPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return exactRawPayloadKeys.has(normalized)
    || rawPayloadKeyFragments.some((fragment) => normalized.includes(fragment));
}

function isBackendExecutionKeyValue(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    (normalized === 'backendexecuted' && value === true)
    || (normalized === 'executesbackend' && value === true)
    || normalized === 'backendaction'
    || normalized === 'executorpayload'
    || normalized === 'providerexecution'
  );
}

function isInlineBase64Like(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('data:')
    || trimmed.startsWith('base64:')
    || trimmed.includes(';base64,')
    || trimmed.startsWith('iVBORw0KGgo')
    || /^[A-Za-z0-9+/]{80,}={0,2}$/.test(trimmed);
}

function dedupeViolations(
  violations: VirtualAppScreenRawPayloadViolation[],
): VirtualAppScreenRawPayloadViolation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.path}:${violation.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function missingBindingRefFields(refs: VirtualAppScreenLifecycleEventRefs | undefined): string[] {
  if (!refs) return ['eventRef', 'screenRef', 'targetAppRef', 'targetWindowRef', 'sessionRef'];
  const missing: string[] = [];
  if (!hasAnyRef(refs.eventRef)) missing.push('eventRef');
  if (!hasAnyRef(refs.screenRef)) missing.push('screenRef');
  if (!hasAnyRef(refs.targetAppRef)) missing.push('targetAppRef');
  if (!hasAnyRef(refs.targetWindowRef)) missing.push('targetWindowRef');
  if (!hasAnyRef(refs.sessionRef)) missing.push('sessionRef');
  return missing;
}

function hasCompleteBindingRefs(refs: VirtualAppScreenLifecycleEventRefs | undefined): refs is VirtualAppScreenLifecycleEventRefs {
  return Boolean(
    refs
    && hasAnyRef(refs.screenRef)
    && hasAnyRef(refs.targetAppRef)
    && hasAnyRef(refs.targetWindowRef)
    && hasAnyRef(refs.sessionRef)
    && hasAnyRef(refs.eventRef),
  );
}

function bindingRefs(refs: VirtualAppScreenLifecycleEventRefs): VirtualAppScreenBindingRefs {
  return {
    screenRef: refs.screenRef,
    targetAppRef: refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    sessionRef: refs.sessionRef,
  };
}

function sameBinding(left: VirtualAppScreenBindingRefs, right: VirtualAppScreenBindingRefs): boolean {
  return left.screenRef === right.screenRef
    && left.targetAppRef === right.targetAppRef
    && left.targetWindowRef === right.targetWindowRef
    && left.sessionRef === right.sessionRef;
}

function hasAnyRef(...values: Array<string | undefined>): boolean {
  return values.some((value) => typeof value === 'string' && value.trim().length > 0);
}
