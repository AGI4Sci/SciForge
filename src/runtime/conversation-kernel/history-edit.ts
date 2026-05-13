import type { ConversationEvent, ConversationKernelDiagnostic, HistoryEditState } from './types';

export function validateHistoryEditedEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (event.type !== 'HistoryEdited') return undefined;
  const payload = event.payload;
  const mode = payload.mode;
  if (event.storage !== 'inline') {
    return {
      severity: 'error',
      code: 'history-edit-must-be-inline',
      eventId: event.id,
      message: 'HistoryEdited records edit boundaries and invalidation metadata inline; large downstream content must remain refs elsewhere.',
    };
  }
  if (mode !== 'revert' && mode !== 'continue') {
    return {
      severity: 'error',
      code: 'history-edit-mode-required',
      eventId: event.id,
      message: 'HistoryEdited must declare whether the user chose revert or continue.',
    };
  }
  if (!stringField(payload.branchId) || !stringField(payload.sourceMessageRef) || !stringField(payload.boundaryAt)) {
    return {
      severity: 'error',
      code: 'history-edit-boundary-required',
      eventId: event.id,
      message: 'HistoryEdited must include branchId, sourceMessageRef, and boundaryAt for replayable edit boundaries.',
    };
  }
  const invalidatedRefs = stringArray(payload.invalidatedRefs);
  const affectedRefs = stringArray(payload.affectedRefs);
  if (mode === 'revert' && invalidatedRefs.length === 0 && affectedRefs.length > 0) {
    return {
      severity: 'error',
      code: 'history-edit-invalidated-refs-required',
      eventId: event.id,
      message: 'HistoryEdited revert must list downstream refs invalidated by the edit.',
    };
  }
  if (!isRecord(payload.projectionInvalidation) || payload.projectionInvalidation.invalidatesProjection !== true) {
    return {
      severity: 'error',
      code: 'history-edit-projection-invalidation-required',
      eventId: event.id,
      message: 'HistoryEdited must carry projection invalidation metadata so restored UI cannot trust stale projections.',
    };
  }
  return undefined;
}

export function historyEditStateFromEvent(event: ConversationEvent): HistoryEditState | undefined {
  if (event.type !== 'HistoryEdited') return undefined;
  const payload = event.payload;
  const branchId = stringField(payload.branchId);
  const mode = payload.mode === 'revert' || payload.mode === 'continue' ? payload.mode : undefined;
  const sourceMessageRef = stringField(payload.sourceMessageRef);
  const boundaryAt = stringField(payload.boundaryAt);
  if (!branchId || !mode || !sourceMessageRef || !boundaryAt) return undefined;
  return {
    schemaVersion: 'sciforge.conversation-history-edit.v1',
    branchId,
    mode,
    sourceMessageRef,
    boundaryAt,
    invalidatedRefs: stringArray(payload.invalidatedRefs),
    affectedRefs: stringArray(payload.affectedRefs),
    projectionInvalidated: isRecord(payload.projectionInvalidation)
      ? payload.projectionInvalidation.invalidatesProjection === true
      : true,
    requiresUserConfirmation: payload.requiresUserConfirmation === true,
    nextStep: stringField(payload.nextStep) ?? defaultHistoryEditNextStep(mode),
  };
}

function defaultHistoryEditNextStep(mode: 'revert' | 'continue') {
  return mode === 'revert'
    ? 'Start the next run from the edited message boundary.'
    : 'Confirm whether affected downstream refs remain valid before continuing.';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
