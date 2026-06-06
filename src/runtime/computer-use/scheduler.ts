import { open, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ComputerUseActionProvenance,
  ComputerUseActiveLease,
  ComputerUseApprovalState,
  ComputerUseFocusLeaseProjection,
  ComputerUseLeaseScope,
  ComputerUseObserveBeforeMutateEvidence,
  ComputerUseSchedulerDecisionRefs,
  ComputerUseSchedulerActionProposal,
  ComputerUseSchedulerQueue,
  ComputerUseSchedulerQueueEntry,
  ComputerUseSchedulerStopSignal,
  ComputerUseVisibleEvidenceInvalidation,
  GenericVisionAction,
  ResolvedWindowTarget,
  WindowTargetResolution,
} from './types.js';
import { sanitizeId, sleep } from './utils.js';

type ScreenGlobalComputerUseAction = Extract<GenericVisionAction, { type: 'open_app' | 'hotkey' | 'save' | 'open_menu' | 'wait' }>;
type SchedulerValidationFailureStatus = 'rejected' | 'needs-confirmation' | 'needs-observation' | 'blocked';
const GLOBAL_FOCUS_LEASE_LOCK_ID = 'cu-focus-lease-global';

export interface ComputerUseSchedulerLease {
  mode: 'real-gui-executor-lock';
  lockId: string;
  lockPath: string;
  ownerId: string;
  leaseScope?: ComputerUseLeaseScope;
  focusLeaseProjection?: ComputerUseFocusLeaseProjection;
  displayGroupId?: string;
  screenId?: string;
  windowId?: string;
  actorId?: string;
  cursorId?: string;
  acquiredAt: string;
  releasedAt?: string;
  waitMs: number;
  status?: 'active' | 'released';
  reason?: string;
  staleLockReclaimed?: boolean;
}

export async function acquireComputerUseSchedulerLease(params: {
  targetResolution: ResolvedWindowTarget;
  lockId?: string;
  runId?: string;
  stepId?: string;
  action?: GenericVisionAction;
  provenance?: ComputerUseActionProvenance;
  leaseScope?: ComputerUseLeaseScope;
  timeoutMs?: number;
  staleMs?: number;
}): Promise<{ ok: true; lease: ComputerUseSchedulerLease; release: () => Promise<ComputerUseSchedulerLease> } | { ok: false; reason: string; lockId: string; lockPath: string; waitMs: number }> {
  const actionScopeResult = params.action ? computerUseLeaseScopeForAction(params.action, params.targetResolution) : undefined;
  const actionScope = params.leaseScope
    ?? (actionScopeResult && actionScopeResult.ok ? actionScopeResult.leaseScope : undefined);
  const provenance = params.provenance
    ?? (params.action ? deriveComputerUseActionProvenance({ action: params.action, targetResolution: params.targetResolution }) : undefined);
  const focusLeaseProjection = params.action && actionScope
    ? computerUseFocusLeaseProjectionForAction({
      action: params.action,
      targetResolution: params.targetResolution,
      provenance,
      leaseScope: actionScope,
    })
    : undefined;
  const lockId = params.lockId || focusLeaseProjection?.lockId || computerUseSchedulerLockId(params.targetResolution, { leaseScope: actionScope }) || params.targetResolution.schedulerLockId || 'display-fallback';
  const lockPath = schedulerLockPath(lockId);
  const ownerId = sanitizeId(`${params.runId || 'unknown-run'}-${params.stepId || 'unknown-step'}-${Date.now()}`);
  const timeoutMs = Math.max(1, params.timeoutMs ?? 60_000);
  const staleMs = Math.max(timeoutMs, params.staleMs ?? 120_000);
  const startedAt = Date.now();
  let staleLockReclaimed = false;
  await mkdir(join(tmpdir(), 'sciforge-computer-use-locks'), { recursive: true });

  while (Date.now() - startedAt <= timeoutMs) {
    const acquiredAt = new Date().toISOString();
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({
          schemaVersion: 'sciforge.computer-use.scheduler-lock.v1',
          lockId,
          ownerId,
          runId: params.runId,
          stepId: params.stepId,
          acquiredAt,
          leaseScope: actionScope,
          focusLeaseProjection,
          provenance,
          targetWindow: {
            windowId: params.targetResolution.windowId,
            virtualWindowId: params.targetResolution.virtualWindowId,
            displayId: params.targetResolution.displayId,
            displayGroupId: actionScope?.displayGroupId ?? provenance?.displayGroupId,
            screenId: actionScope?.screenId ?? provenance?.screenId,
            appName: params.targetResolution.appName,
            title: params.targetResolution.title,
          },
        }, null, 2)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      const lease: ComputerUseSchedulerLease = {
        mode: 'real-gui-executor-lock',
        lockId,
        lockPath,
        ownerId,
        leaseScope: actionScope,
        focusLeaseProjection,
        displayGroupId: actionScope?.displayGroupId ?? provenance?.displayGroupId,
        screenId: actionScope?.screenId ?? provenance?.screenId,
        windowId: actionScope?.windowId ?? provenance?.windowId,
        actorId: provenance?.actorId,
        cursorId: provenance?.cursorId,
        acquiredAt,
        waitMs: Date.now() - startedAt,
        status: 'active',
        staleLockReclaimed: staleLockReclaimed || undefined,
      };
      return {
        ok: true,
        lease,
        release: async () => {
          await rm(lockPath, { force: true });
          lease.releasedAt = new Date().toISOString();
          lease.status = 'released';
          lease.reason = lease.reason ?? 'released';
          return lease;
        },
      };
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code !== 'EEXIST') {
        return {
          ok: false,
          reason: `Failed to acquire Computer Use scheduler lock ${lockId}: ${error instanceof Error ? error.message : String(error)}`,
          lockId,
          lockPath,
          waitMs: Date.now() - startedAt,
        };
      }
      if (await reclaimStaleLock(lockPath, staleMs)) staleLockReclaimed = true;
      await sleep(100);
    }
  }
  return {
    ok: false,
    reason: `Timed out waiting for Computer Use scheduler lock ${lockId}; another real GUI action stream is active.`,
    lockId,
    lockPath,
    waitMs: Date.now() - startedAt,
  };
}

export function computerUseSchedulerLockId(targetResolution: ResolvedWindowTarget, options: { sharedSystemInput?: boolean; leaseScope?: ComputerUseLeaseScope; focusLeaseProjection?: ComputerUseFocusLeaseProjection } = {}) {
  if (options.sharedSystemInput) return 'shared-system-input';
  if (options.focusLeaseProjection) return options.focusLeaseProjection.lockId;
  if (options.leaseScope?.reason === 'read-only-or-time-based-action' && targetResolution.schedulerLockId) return targetResolution.schedulerLockId;
  if (options.leaseScope && targetResolution.inputIsolation === 'require-focused-target') return GLOBAL_FOCUS_LEASE_LOCK_ID;
  return scopedSchedulerLockId(targetResolution, options.leaseScope);
}

export function schedulerLeaseTrace(lease: ComputerUseSchedulerLease | undefined) {
  if (!lease) return undefined;
  return {
    mode: lease.mode,
    lockId: lease.lockId,
    lockPath: lease.lockPath,
    ownerId: lease.ownerId,
    leaseScope: lease.leaseScope,
    focusLeaseProjection: lease.focusLeaseProjection,
    displayGroupId: lease.displayGroupId,
    screenId: lease.screenId,
    windowId: lease.windowId,
    actorId: lease.actorId,
    cursorId: lease.cursorId,
    acquiredAt: lease.acquiredAt,
    releasedAt: lease.releasedAt,
    waitMs: lease.waitMs,
    status: lease.status,
    reason: lease.reason,
    staleLockReclaimed: lease.staleLockReclaimed,
  };
}

export function scheduleComputerUseActionProposals(
  proposals: ComputerUseSchedulerActionProposal[],
  options: {
    now?: string;
    activeLeases?: ComputerUseActiveLease[];
    cancelledProposalIds?: Set<string> | string[];
    stopSignal?: ComputerUseSchedulerStopSignal;
    defaultTimeoutMs?: number;
    maxObservationAgeMs?: number;
    executorLeaseConflictPolicy?: 'native-screen-serial' | 'window-local-parallel';
  } = {},
): ComputerUseSchedulerQueue {
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const cancelled = new Set(Array.isArray(options.cancelledProposalIds)
    ? options.cancelledProposalIds
    : [...(options.cancelledProposalIds ?? [])]);
  const activeLeases = [...(options.activeLeases ?? [])];
  const diagnostics: string[] = [];
  const entries: ComputerUseSchedulerQueueEntry[] = [];
  const approvalStoppedScreens = new Set<string>();
  const stopCancelledScreens = new Set<string>();
  const ordered = [...proposals].sort(compareSchedulerProposals);

  for (const [index, proposal] of ordered.entries()) {
    const proposalCancelled = cancelled.has(proposal.id);
    const cancelReason = proposal.cancelReason || (proposalCancelled ? 'cancelled-by-request' : '');
    const prevalidationProvenance = {
      ...deriveComputerUseActionProvenance({
        action: proposal.action,
        targetResolution: proposal.targetResolution,
      }),
      ...proposal.provenance,
    };
    const prevalidationScopeResult = computerUseLeaseScopeForAction(
      proposal.action,
      proposal.targetResolution,
      prevalidationProvenance,
    );
    const prevalidationStopReason = prevalidationScopeResult.ok
      ? schedulerStopSignalReason(options.stopSignal, proposal, prevalidationScopeResult.leaseScope)
      : '';
    const validation = validateComputerUseScopedAction({
      action: proposal.action,
      targetResolution: proposal.targetResolution,
      provenance: proposal.provenance,
      approvalState: proposal.approvalState,
      observeBeforeMutate: proposal.observeBeforeMutate,
      now: options.now,
      maxObservationAgeMs: options.maxObservationAgeMs,
      enforceObserveBeforeMutate: !cancelReason && !prevalidationStopReason,
    });
    const submittedAt = proposal.submittedAt;
    const sequence = proposal.sequence ?? index;
    const base = {
      proposalId: proposal.id,
      actionType: proposal.action.type,
      submittedAt,
      sequence,
      approvalState: proposal.approvalState ?? proposal.action.approvalState,
    };
    const timeoutReason = timeoutRejectionReason(proposal, nowMs, options.defaultTimeoutMs);
    const stopReason = validation.leaseScope
      ? schedulerStopSignalReason(options.stopSignal, proposal, validation.leaseScope)
      : prevalidationStopReason;

    if (cancelReason || stopReason) {
      const reason = stopReason || cancelReason;
      const refs = schedulerDecisionRefs({
        proposalId: proposal.id,
        status: stopReason ? 'aborted' : 'cancelled',
        reason,
        executorEventRef: stableExecutorEventRef(proposal.id, stopReason ? 'aborted' : 'cancelled'),
      });
      entries.push({
        ...base,
        status: 'cancelled',
        reason,
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
        executorEventRef: refs.executorEventRef,
        schedulerDecisionRefs: refs,
        blocksFollowingActions: Boolean(stopReason),
      });
      if (stopReason && validation.leaseScope) stopCancelledScreens.add(screenScopeKey(validation.leaseScope));
      continue;
    }
    if (timeoutReason) {
      entries.push({
        ...base,
        status: 'timed-out',
        reason: timeoutReason,
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
      });
      continue;
    }
    if (!validation.ok) {
      diagnostics.push(`${proposal.id}: ${validation.reason}`);
      entries.push({
        ...base,
        status: validation.status,
        reason: validation.reason,
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
        observeBeforeMutate: validation.observeBeforeMutate,
        schedulerDecisionRefs: validation.schedulerDecisionRefs,
        approvalState: validation.approvalState,
        blocksFollowingActions: validation.status === 'needs-confirmation',
      });
      if (validation.status === 'needs-confirmation' && validation.leaseScope) {
        approvalStoppedScreens.add(screenScopeKey(validation.leaseScope));
      }
      continue;
    }
    const stopKey = screenScopeKey(validation.leaseScope);
    if (stopCancelledScreens.has(stopKey)) {
      const reason = 'stop-cancel: queue execution is blocked after a user stop/cancel signal on this screen';
      entries.push({
        ...base,
        status: 'cancelled',
        reason,
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
        schedulerDecisionRefs: schedulerDecisionRefs({
          proposalId: proposal.id,
          status: 'cancelled',
          reason,
          executorEventRef: stableExecutorEventRef(proposal.id, 'queue-stopped'),
        }),
        blocksFollowingActions: true,
      });
      continue;
    }
    if (approvalStoppedScreens.has(stopKey)) {
      entries.push({
        ...base,
        status: 'queued',
        reason: 'approval-stop: an earlier action on this screen is waiting for confirmation',
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
      });
      continue;
    }
    if (!computerUseActionRequiresExecutorLease(proposal.action)) {
      entries.push({
        ...base,
        status: 'ready',
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
      });
      continue;
    }
    const conflictingLease = activeLeases.find((lease) => focusLeaseProjectionsConflict(lease.focusLeaseProjection, validation.focusLeaseProjection)
      || leaseScopesConflict(lease.scope, validation.leaseScope, {
        sameScreenWindowLocal: options.executorLeaseConflictPolicy === 'window-local-parallel'
          ? 'window-parallel'
          : 'screen-serial',
      }));
    if (conflictingLease) {
      const focusConflict = focusLeaseProjectionsConflict(conflictingLease.focusLeaseProjection, validation.focusLeaseProjection);
      entries.push({
        ...base,
        status: 'queued',
        reason: `${focusConflict ? 'waiting-for-focus-lease' : 'waiting-for-lease'}:${conflictingLease.leaseId}`,
        provenance: validation.provenance,
        leaseScope: validation.leaseScope,
        focusLeaseProjection: validation.focusLeaseProjection,
      });
      continue;
    }
    const leaseId = stableLeaseId(proposal.id, validation.leaseScope);
    activeLeases.push({
      leaseId,
      scope: validation.leaseScope,
      focusLeaseProjection: validation.focusLeaseProjection,
      actorId: validation.provenance.actorId,
      cursorId: validation.provenance.cursorId,
      acquiredAt: options.now,
    });
    entries.push({
      ...base,
      status: 'ready',
      provenance: validation.provenance,
      leaseScope: validation.leaseScope,
      focusLeaseProjection: validation.focusLeaseProjection,
      leaseId,
      executorEventRef: stableExecutorEventRef(proposal.id),
      staleEvidenceInvalidation: validation.staleEvidenceInvalidation,
      observeBeforeMutate: validation.observeBeforeMutate,
    });
  }

  return {
    schemaVersion: 'sciforge.computer-use.scheduler-queue.v1',
    entries,
    deterministicOrder: entries.map((entry) => entry.proposalId),
    diagnostics,
  };
}

export function validateComputerUseScopedAction(params: {
  action: GenericVisionAction;
  targetResolution: WindowTargetResolution;
  provenance?: ComputerUseActionProvenance;
  approvalState?: ComputerUseApprovalState;
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  now?: string;
  maxObservationAgeMs?: number;
  enforceObserveBeforeMutate?: boolean;
}): {
  ok: true;
  status: 'ready';
  provenance: ComputerUseActionProvenance;
  leaseScope: ComputerUseLeaseScope;
  focusLeaseProjection: ComputerUseFocusLeaseProjection;
  staleEvidenceInvalidation?: ComputerUseVisibleEvidenceInvalidation;
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  approvalState: ComputerUseApprovalState;
} | {
  ok: false;
  status: SchedulerValidationFailureStatus;
  reason: string;
  provenance: ComputerUseActionProvenance;
  leaseScope?: ComputerUseLeaseScope;
  focusLeaseProjection?: ComputerUseFocusLeaseProjection;
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  schedulerDecisionRefs?: ComputerUseSchedulerDecisionRefs;
  approvalState: ComputerUseApprovalState;
} {
  const provenance = {
    ...deriveComputerUseActionProvenance({
      action: params.action,
      targetResolution: params.targetResolution,
    }),
    ...params.provenance,
  };
  const approvalState = params.approvalState
    ?? params.action.approvalState
    ?? (params.action.riskLevel === 'high' || params.action.requiresConfirmation ? 'needs-confirmation' : 'not-required');
  const scopeResult = computerUseLeaseScopeForAction(params.action, params.targetResolution, provenance);
  if (!scopeResult.ok) {
    return {
      ok: false,
      status: 'rejected',
      reason: scopeResult.reason,
      provenance: { ...provenance, approvalState },
      approvalState,
    };
  }
  const focusLeaseProjection = computerUseFocusLeaseProjectionForAction({
    action: params.action,
    targetResolution: params.targetResolution,
    provenance,
    leaseScope: scopeResult.leaseScope,
  });
  const bareGlobalReason = bareGlobalCoordinateRejectionReason(params.action, params.targetResolution, scopeResult.leaseScope);
  if (bareGlobalReason) {
    return {
      ok: false,
      status: 'rejected',
      reason: bareGlobalReason,
      provenance: { ...provenance, leaseScope: scopeResult.leaseScope, approvalState },
      leaseScope: scopeResult.leaseScope,
      focusLeaseProjection,
      approvalState,
    };
  }
  if (approvalState === 'denied') {
    return {
      ok: false,
      status: 'rejected',
      reason: 'approval-denied: Computer Use action was refused before executor event creation',
      provenance: { ...provenance, leaseScope: scopeResult.leaseScope, approvalState },
      leaseScope: scopeResult.leaseScope,
      focusLeaseProjection,
      approvalState,
    };
  }
  if ((params.action.riskLevel === 'high' || params.action.requiresConfirmation) && approvalState !== 'approved') {
    return {
      ok: false,
      status: 'needs-confirmation',
      reason: 'approval-required: high-risk Computer Use action stopped before executor event creation',
      provenance: { ...provenance, leaseScope: scopeResult.leaseScope, approvalState },
      leaseScope: scopeResult.leaseScope,
      focusLeaseProjection,
      approvalState,
    };
  }
  const observeBeforeMutate = params.observeBeforeMutate ?? params.action.observeBeforeMutate;
  const observationRequirement = validateObserveBeforeMutateRequirement({
    action: params.action,
    leaseScope: scopeResult.leaseScope,
    provenance,
    observeBeforeMutate,
    now: params.now,
    maxObservationAgeMs: params.maxObservationAgeMs,
    enforce: params.enforceObserveBeforeMutate !== false,
  });
  if (!observationRequirement.ok) {
    const refs = schedulerDecisionRefs({
      proposalId: `observe-${params.action.type}-${scopeResult.leaseScope.screenId}-${scopeResult.leaseScope.windowId ?? 'screen'}`,
      status: observationRequirement.status,
      reason: observationRequirement.reason,
    });
    return {
      ok: false,
      status: observationRequirement.status,
      reason: observationRequirement.reason,
      provenance: { ...provenance, leaseScope: scopeResult.leaseScope, approvalState },
      leaseScope: scopeResult.leaseScope,
      focusLeaseProjection,
      observeBeforeMutate,
      schedulerDecisionRefs: refs,
      approvalState,
    };
  }
  return {
    ok: true,
    status: 'ready',
    provenance: { ...provenance, leaseScope: scopeResult.leaseScope, approvalState },
    leaseScope: scopeResult.leaseScope,
    focusLeaseProjection,
    staleEvidenceInvalidation: computerUseStaleEvidenceInvalidationForAction(params.action, scopeResult.leaseScope),
    observeBeforeMutate: observationRequirement.observeBeforeMutate,
    approvalState,
  };
}

export function deriveComputerUseActionProvenance(params: {
  action: GenericVisionAction;
  targetResolution: WindowTargetResolution;
  actorId?: string;
  cursorId?: string;
}): ComputerUseActionProvenance {
  const displayId = params.targetResolution.ok ? params.targetResolution.displayId : params.targetResolution.target.displayId;
  const displayGroupId = params.action.displayGroupId
    ?? (params.targetResolution.ok ? params.targetResolution.displayGroupId : params.targetResolution.target.displayGroupId)
    ?? `display-group-${displayId ?? 'default'}`;
  const screenId = params.action.screenId
    ?? (params.targetResolution.ok ? params.targetResolution.screenId : params.targetResolution.target.screenId)
    ?? `screen-${displayId ?? 'default'}`;
  const actorId = params.actorId ?? params.action.actorId ?? 'actor-agent';
  const cursorId = params.cursorId ?? params.action.cursorId ?? `${actorId}-cursor`;
  const numericWindowId = params.targetResolution.ok && params.targetResolution.windowId !== undefined
    ? `window-${params.targetResolution.windowId}`
    : undefined;
  const windowId = params.action.windowId
    ?? (params.targetResolution.ok ? params.targetResolution.virtualWindowId : params.targetResolution.target.virtualWindowId)
    ?? numericWindowId;
  return {
    displayGroupId,
    screenId,
    windowId,
    actorId,
    cursorId,
    source: 'compat-projection',
    beforeEvidenceRefs: params.action.beforeEvidenceRefs,
    groundingRefs: params.action.groundingRefs,
    afterEvidenceRefs: params.action.afterEvidenceRefs,
    executorEventRef: params.action.executorEventRef,
    verificationRefs: params.action.verificationRefs,
    approvalState: params.action.approvalState,
  };
}

export function computerUseLeaseScopeForAction(
  action: GenericVisionAction,
  targetResolution: WindowTargetResolution,
  provenance: ComputerUseActionProvenance = deriveComputerUseActionProvenance({ action, targetResolution }),
): { ok: true; leaseScope: ComputerUseLeaseScope } | { ok: false; reason: string } {
  const actionType = action.type;
  if (!targetResolution.ok) {
    return { ok: false, reason: `target-unresolved: ${targetResolution.reason}` };
  }
  if (action.leaseScope) {
    const reason = validateLeaseScope(action.leaseScope, action);
    return reason ? { ok: false, reason } : { ok: true, leaseScope: action.leaseScope };
  }
  if (isScreenGlobalAction(action)) {
    return {
      ok: true,
      leaseScope: {
        kind: 'screen-global',
        displayGroupId: provenance.displayGroupId,
        screenId: provenance.screenId,
        reason: action.type === 'wait' ? 'read-only-or-time-based-action' : 'action-may-change-screen-focus-window-or-system-state',
      },
    };
  }
  if (isWindowLocalExecutorAction(action)) {
    if (actionHasPointerCoordinates(action) && targetResolution.coordinateSpace === 'screen') {
      return {
        ok: false,
        reason: 'bare-global-coordinate-blocked: pointer coordinates must be grounded to a screen/window-local target and window-local executor lease',
      };
    }
    if (!provenance.windowId) {
      return {
        ok: false,
        reason: 'window-local-lease-required: mutating pointer/keyboard action has no stable windowId',
      };
    }
    if (targetResolution.captureKind !== 'window') {
      return {
        ok: false,
        reason: 'window-local-lease-required: mutating pointer/keyboard action is not bound to a target window',
      };
    }
    return {
      ok: true,
      leaseScope: {
        kind: 'window-local',
        displayGroupId: provenance.displayGroupId,
        screenId: provenance.screenId,
        windowId: provenance.windowId,
        reason: 'action-targets-resolved-window',
      },
    };
  }
  return {
    ok: false,
    reason: `unsupported-action-scope: ${actionType}`,
  };
}

export function computerUseFocusLeaseProjectionForAction(params: {
  action: GenericVisionAction;
  targetResolution: WindowTargetResolution;
  provenance?: ComputerUseActionProvenance;
  leaseScope?: ComputerUseLeaseScope;
}): ComputerUseFocusLeaseProjection {
  const provenance = params.provenance
    ?? deriveComputerUseActionProvenance({ action: params.action, targetResolution: params.targetResolution });
  const scopeResult = params.leaseScope
    ? { ok: true as const, leaseScope: params.leaseScope }
    : computerUseLeaseScopeForAction(params.action, params.targetResolution, provenance);
  if (!scopeResult.ok) {
    const fallbackScope: ComputerUseLeaseScope = {
      kind: 'screen-global',
      displayGroupId: provenance.displayGroupId,
      screenId: provenance.screenId,
      reason: 'focus-lease-projection-fallback-for-unscoped-action',
    };
    return focusLeaseProjection(params.action, params.targetResolution, provenance, fallbackScope);
  }
  return focusLeaseProjection(params.action, params.targetResolution, provenance, scopeResult.leaseScope);
}

export function computerUseActionMutatesVisibleEvidence(action: GenericVisionAction) {
  return action.type !== 'wait';
}

export function computerUseActionRequiresExecutorLease(action: GenericVisionAction) {
  return action.type !== 'wait';
}

export function computerUseActionRequiresObserveBeforeMutate(action: GenericVisionAction) {
  return action.type === 'click'
    || action.type === 'double_click'
    || action.type === 'drag'
    || action.type === 'type_text'
    || action.type === 'press_key'
    || action.type === 'hotkey'
    || action.type === 'scroll'
    || action.type === 'save'
    || action.type === 'open_menu'
    || action.type === 'open_app';
}

export function computerUseStaleEvidenceInvalidationForAction(
  action: GenericVisionAction,
  scope: ComputerUseLeaseScope,
  staleBy = `action:${action.type}`,
): ComputerUseVisibleEvidenceInvalidation | undefined {
  if (!computerUseActionMutatesVisibleEvidence(action)) return undefined;
  return {
    invalidatesVisibleState: true,
    staleBy,
    scope,
    staleEvidenceKinds: ['observation', 'region', 'text', 'visual-object', 'vlm-claim', 'grounding'],
    preservedEvidenceKinds: ['artifact', 'verification', 'completion-claim'],
    reason: `${action.type} may change visible state within ${scope.kind}`,
  };
}

export function leaseScopesConflict(
  left: ComputerUseLeaseScope,
  right: ComputerUseLeaseScope,
  options: { sameScreenWindowLocal?: 'screen-serial' | 'window-parallel' } = {},
) {
  if (left.displayGroupId !== right.displayGroupId || left.screenId !== right.screenId) return false;
  if (left.kind === 'screen-global' || right.kind === 'screen-global') return true;
  if ((options.sameScreenWindowLocal ?? 'window-parallel') === 'screen-serial') return true;
  return Boolean(left.windowId && right.windowId && left.windowId === right.windowId);
}

function focusLeaseProjection(
  action: GenericVisionAction,
  targetResolution: WindowTargetResolution,
  provenance: ComputerUseActionProvenance,
  leaseScope: ComputerUseLeaseScope,
): ComputerUseFocusLeaseProjection {
  const inputIsolation = targetResolution.ok
    ? targetResolution.inputIsolation
    : targetResolution.target.inputIsolation;
  const requiresGlobalFocus = inputIsolation === 'require-focused-target'
    && computerUseActionRequiresExecutorLease(action);
  const lockId = requiresGlobalFocus
    ? GLOBAL_FOCUS_LEASE_LOCK_ID
    : targetResolution.ok
      ? scopedSchedulerLockId(targetResolution, leaseScope)
      : sanitizeId(['cu-lease', leaseScope.kind, leaseScope.displayGroupId, leaseScope.screenId, leaseScope.windowId].filter(Boolean).join('-'));
  return {
    schemaVersion: 'sciforge.computer-use.focus-lease-projection.v1',
    lane: requiresGlobalFocus ? 'global-focus' : 'adapter-local',
    inputClassification: requiresGlobalFocus ? 'focused-system-input' : 'non-focus-adapter',
    requiresGlobalFocus,
    lockId,
    laneId: requiresGlobalFocus ? 'focus:global' : `adapter:${lockId}`,
    leaseScope,
    displayGroupId: leaseScope.displayGroupId,
    screenId: leaseScope.screenId,
    windowId: leaseScope.windowId,
    actorId: provenance.actorId,
    cursorId: provenance.cursorId,
    reason: requiresGlobalFocus
      ? 'target inputIsolation requires focused system input; serializing on the global focus lane'
      : 'target can use a non-focus adapter lane compatible with scoped parallel scheduling',
  };
}

function focusLeaseProjectionsConflict(
  left: ComputerUseFocusLeaseProjection | undefined,
  right: ComputerUseFocusLeaseProjection | undefined,
) {
  return left?.requiresGlobalFocus === true && right?.requiresGlobalFocus === true;
}

function scopedSchedulerLockId(targetResolution: ResolvedWindowTarget, leaseScope: ComputerUseLeaseScope | undefined) {
  if (leaseScope) {
    return sanitizeId([
      'cu-lease',
      leaseScope.kind,
      leaseScope.displayGroupId,
      leaseScope.screenId,
      leaseScope.windowId,
    ].filter(Boolean).join('-'));
  }
  return targetResolution.schedulerLockId || 'display-fallback';
}

function schedulerLockPath(lockId: string) {
  return join(tmpdir(), 'sciforge-computer-use-locks', `${sanitizeId(lockId)}.lock`);
}

async function reclaimStaleLock(lockPath: string, staleMs: number) {
  const raw = await readFile(lockPath, 'utf8').catch(() => '');
  const parsed = safeJson(raw);
  const acquiredAt = isRecord(parsed) && typeof parsed.acquiredAt === 'string' ? Date.parse(parsed.acquiredAt) : NaN;
  if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt < staleMs) return false;
  await rm(lockPath, { force: true });
  return true;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareSchedulerProposals(left: ComputerUseSchedulerActionProposal, right: ComputerUseSchedulerActionProposal) {
  const leftTime = timestampSortKey(left.submittedAt);
  const rightTime = timestampSortKey(right.submittedAt);
  if (leftTime !== rightTime) return leftTime - rightTime;
  if ((left.sequence ?? Number.MAX_SAFE_INTEGER) !== (right.sequence ?? Number.MAX_SAFE_INTEGER)) {
    return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
  }
  const leftProvenance = deriveComputerUseActionProvenance({ action: left.action, targetResolution: left.targetResolution });
  const rightProvenance = deriveComputerUseActionProvenance({ action: right.action, targetResolution: right.targetResolution });
  return [
    leftProvenance.displayGroupId.localeCompare(rightProvenance.displayGroupId),
    leftProvenance.screenId.localeCompare(rightProvenance.screenId),
    (leftProvenance.windowId ?? '').localeCompare(rightProvenance.windowId ?? ''),
    leftProvenance.actorId.localeCompare(rightProvenance.actorId),
    leftProvenance.cursorId.localeCompare(rightProvenance.cursorId),
    left.id.localeCompare(right.id),
  ].find((value) => value !== 0) ?? 0;
}

function timestampSortKey(value: string | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function timeoutRejectionReason(
  proposal: ComputerUseSchedulerActionProposal,
  nowMs: number,
  defaultTimeoutMs: number | undefined,
) {
  const timeoutAtMs = proposal.timeoutAt ? Date.parse(proposal.timeoutAt) : NaN;
  if (Number.isFinite(timeoutAtMs) && nowMs > timeoutAtMs) return 'proposal-timeout';
  if (defaultTimeoutMs === undefined || !proposal.submittedAt) return '';
  const submittedAtMs = Date.parse(proposal.submittedAt);
  if (!Number.isFinite(submittedAtMs)) return '';
  return nowMs - submittedAtMs > defaultTimeoutMs ? 'proposal-timeout' : '';
}

function isScreenGlobalAction(action: GenericVisionAction): action is ScreenGlobalComputerUseAction {
  return action.type === 'open_app'
    || action.type === 'hotkey'
    || action.type === 'save'
    || action.type === 'open_menu'
    || action.type === 'wait';
}

function isWindowLocalExecutorAction(action: GenericVisionAction) {
  return action.type === 'click'
    || action.type === 'double_click'
    || action.type === 'drag'
    || action.type === 'type_text'
    || action.type === 'press_key'
    || action.type === 'scroll';
}

function validateObserveBeforeMutateRequirement(params: {
  action: GenericVisionAction;
  leaseScope: ComputerUseLeaseScope;
  provenance: ComputerUseActionProvenance;
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  now?: string;
  maxObservationAgeMs?: number;
  enforce: boolean;
}): { ok: true; observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence } | { ok: false; status: 'needs-observation' | 'blocked'; reason: string } {
  if (!params.enforce || !computerUseActionRequiresObserveBeforeMutate(params.action)) {
    return { ok: true, observeBeforeMutate: params.observeBeforeMutate };
  }
  const evidence = params.observeBeforeMutate;
  if (!evidence) {
    return {
      ok: false,
      status: 'needs-observation',
      reason: 'needs-observation: mutating Computer Use action requires current appStateRef, screenshot/capture ref, accessibility/state snapshot ref, groundingRef, and freshness check before executor lease',
    };
  }
  const missing: string[] = [];
  if (!evidence.appStateRef) missing.push('appStateRef');
  if (!evidence.screenshotRef && !evidence.captureRef) missing.push('screenshotRef|captureRef');
  if (!evidence.accessibilitySnapshotRef && !evidence.stateSnapshotRef) missing.push('accessibilitySnapshotRef|stateSnapshotRef');
  if (!evidence.groundingRef) missing.push('groundingRef');
  if (!evidence.freshnessCheck) missing.push('freshnessCheck');
  if (!evidence.displayGroupId) missing.push('displayGroupId');
  if (!evidence.screenId) missing.push('screenId');
  if (params.leaseScope.kind === 'window-local' && !evidence.windowId) missing.push('windowId');
  if (missing.length) {
    return {
      ok: false,
      status: 'needs-observation',
      reason: `needs-observation: observe-before-mutate evidence is missing ${missing.join(', ')}`,
    };
  }
  const mismatch = observeBeforeMutateScopeMismatch(evidence, params.leaseScope);
  if (mismatch) {
    return {
      ok: false,
      status: 'blocked',
      reason: `blocked: observe-before-mutate scope mismatch (${mismatch})`,
    };
  }
  const staleReason = observeBeforeMutateStaleReason(evidence, params.now, params.maxObservationAgeMs);
  if (staleReason) {
    return {
      ok: false,
      status: 'needs-observation',
      reason: `needs-observation: ${staleReason}`,
    };
  }
  return { ok: true, observeBeforeMutate: evidence };
}

function observeBeforeMutateScopeMismatch(
  evidence: ComputerUseObserveBeforeMutateEvidence,
  scope: ComputerUseLeaseScope,
) {
  if (evidence.displayGroupId !== scope.displayGroupId) {
    return `displayGroupId ${evidence.displayGroupId} != ${scope.displayGroupId}`;
  }
  if (evidence.screenId !== scope.screenId) {
    return `screenId ${evidence.screenId} != ${scope.screenId}`;
  }
  if (scope.kind === 'window-local' && evidence.windowId !== scope.windowId) {
    return `windowId ${evidence.windowId} != ${scope.windowId}`;
  }
  return '';
}

function observeBeforeMutateStaleReason(
  evidence: ComputerUseObserveBeforeMutateEvidence,
  now: string | undefined,
  defaultMaxAgeMs: number | undefined,
) {
  const freshness = evidence.freshnessCheck;
  if (!freshness) return 'freshness check is missing';
  if (freshness.status !== 'current') {
    return freshness.reason || freshness.staleBy || `freshness status is ${freshness.status}`;
  }
  const nowMs = timestampMs(now ?? new Date().toISOString());
  const observedAtMs = timestampMs(evidence.observedAt ?? evidence.capturedAt ?? freshness.observedAt);
  const checkedAtMs = timestampMs(freshness.checkedAt ?? evidence.freshnessCheckedAt);
  const expiresAtMs = timestampMs(freshness.expiresAt);
  if (nowMs === undefined) return 'current timestamp is missing or invalid';
  if (observedAtMs === undefined) return 'observation timestamp is missing or invalid';
  if (checkedAtMs === undefined) return 'freshness check timestamp is missing or invalid';
  if (expiresAtMs !== undefined && nowMs > expiresAtMs) return `observation expired at ${freshness.expiresAt}`;
  const defaultCapMs = Math.max(1, defaultMaxAgeMs ?? 30_000);
  const declaredMaxAgeMs = freshness.maxAgeMs !== undefined ? Math.max(1, freshness.maxAgeMs) : defaultCapMs;
  const maxAgeMs = Math.min(declaredMaxAgeMs, defaultCapMs);
  if (nowMs - observedAtMs > maxAgeMs) return `observation is older than ${maxAgeMs}ms`;
  if (nowMs - checkedAtMs > maxAgeMs) return `freshness check is older than ${maxAgeMs}ms`;
  return '';
}

function timestampMs(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function schedulerStopSignalReason(
  signal: ComputerUseSchedulerStopSignal | undefined,
  proposal: ComputerUseSchedulerActionProposal,
  scope: ComputerUseLeaseScope,
) {
  if (!signal || (!signal.aborted && !signal.cancelled)) return '';
  if (signal.proposalIds?.length && !signal.proposalIds.includes(proposal.id)) return '';
  if (signal.scope && !leaseScopesConflict(signal.scope, scope)) return '';
  if (signal.displayGroupId && signal.displayGroupId !== scope.displayGroupId) return '';
  if (signal.screenId && signal.screenId !== scope.screenId) return '';
  if (signal.windowId && signal.windowId !== scope.windowId) return '';
  return signal.reason || (signal.cancelled ? 'cancelled-by-user-stop-signal' : 'aborted-by-user-stop-signal');
}

function validateLeaseScope(scope: ComputerUseLeaseScope, action: GenericVisionAction) {
  if (!scope.displayGroupId || !scope.screenId) return 'lease-scope-invalid: displayGroupId and screenId are required';
  if (scope.kind === 'window-local' && !scope.windowId) return 'lease-scope-invalid: window-local lease requires windowId';
  if (scope.kind === 'screen-global' && scope.windowId) return 'lease-scope-invalid: screen-global lease must not bind a windowId';
  if (scope.kind === 'screen-global' && isWindowLocalExecutorAction(action)) return 'lease-scope-invalid: window-local action cannot use a screen-global lease';
  if (scope.kind === 'window-local' && isScreenGlobalAction(action) && action.type !== 'wait') return 'lease-scope-invalid: screen-global action cannot use a window-local lease';
  return '';
}

function bareGlobalCoordinateRejectionReason(
  action: GenericVisionAction,
  targetResolution: WindowTargetResolution,
  leaseScope: ComputerUseLeaseScope,
) {
  if (!actionHasPointerCoordinates(action)) return '';
  const explicitWindowLocal = leaseScope.kind === 'window-local' && Boolean(leaseScope.windowId);
  const targetCoordinateSpace = targetResolution.ok ? targetResolution.coordinateSpace : targetResolution.target.coordinateSpace;
  const groundingCoordinateSpace = coordinateSpaceFromGrounding(action.grounding);
  if (explicitWindowLocal && targetCoordinateSpace !== 'screen') return '';
  if (explicitWindowLocal && (groundingCoordinateSpace === 'window' || groundingCoordinateSpace === 'window-local')) return '';
  if (targetCoordinateSpace === 'screen') {
    return 'bare-global-coordinate-blocked: pointer coordinates must be grounded to a screen/window-local target and window-local executor lease';
  }
  return '';
}

function actionHasPointerCoordinates(action: GenericVisionAction) {
  if (action.type === 'click' || action.type === 'double_click') return typeof action.x === 'number' || typeof action.y === 'number';
  if (action.type === 'drag') {
    return [action.fromX, action.fromY, action.toX, action.toY].some((value) => typeof value === 'number');
  }
  return false;
}

function coordinateSpaceFromGrounding(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  const coordinateSpace = value.coordinateSpace ?? value.coordinate_space ?? value.frame ?? value.coordinateFrame;
  return typeof coordinateSpace === 'string' ? coordinateSpace : undefined;
}

function screenScopeKey(scope: ComputerUseLeaseScope) {
  return `${scope.displayGroupId}:${scope.screenId}`;
}

function stableLeaseId(proposalId: string, scope: ComputerUseLeaseScope) {
  return `lease-${sanitizeId([scope.kind, scope.displayGroupId, scope.screenId, scope.windowId, proposalId].filter(Boolean).join('-'))}`;
}

function stableExecutorEventRef(proposalId: string, suffix?: string) {
  return `executor-event:${sanitizeId([proposalId, suffix].filter(Boolean).join(':'))}`;
}

function schedulerDecisionRefs(params: {
  proposalId: string;
  status: ComputerUseSchedulerDecisionRefs['status'];
  reason: string;
  executorEventRef?: string;
}): ComputerUseSchedulerDecisionRefs {
  const id = sanitizeId(params.proposalId);
  return {
    schemaVersion: 'sciforge.computer-use.scheduler-decision-refs.v1',
    status: params.status,
    reason: params.reason,
    executorEventRef: params.executorEventRef,
    blockedManifestRef: `scheduler-blocked-manifest:${id}:${params.status}`,
    traceRefs: [`scheduler-trace:${id}`],
    replayRefs: [`scheduler-replay:${id}`],
    mutatingActionExecuted: false,
  };
}
