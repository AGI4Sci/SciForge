import type { ConversationEvent, ConversationKernelDiagnostic, HarnessDecisionState } from './types';

export function validateHarnessDecisionRecordedEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (event.type !== 'HarnessDecisionRecorded') return undefined;
  const payload = event.payload;
  if (event.storage !== 'ref') {
    return {
      severity: 'error',
      code: 'harness-decision-ref-required',
      eventId: event.id,
      message: 'HarnessDecisionRecorded must be ref-backed so contract and trace refs remain replayable audit facts.',
    };
  }
  if (!stringField(payload.decisionId)) {
    return {
      severity: 'error',
      code: 'harness-decision-id-required',
      eventId: event.id,
      message: 'HarnessDecisionRecorded must include a stable decisionId.',
    };
  }
  if (!stringField(payload.profileId)) {
    return {
      severity: 'error',
      code: 'harness-decision-profile-required',
      eventId: event.id,
      message: 'HarnessDecisionRecorded must include the harness profile that produced the decision.',
    };
  }
  if (!stringField(payload.digest)) {
    return {
      severity: 'error',
      code: 'harness-decision-digest-required',
      eventId: event.id,
      message: 'HarnessDecisionRecorded must include a stable decision digest for replay comparison.',
    };
  }
  if (!Array.isArray(payload.refs) || payload.refs.every((ref) => !stringField(ref.ref))) {
    return {
      severity: 'error',
      code: 'harness-decision-ref-required',
      eventId: event.id,
      message: 'HarnessDecisionRecorded must carry at least one decision, contract, or trace ref.',
    };
  }
  return undefined;
}

export function harnessDecisionStateFromEvent(event: ConversationEvent): HarnessDecisionState | undefined {
  if (event.type !== 'HarnessDecisionRecorded' || event.storage !== 'ref') return undefined;
  const decisionId = stringField(event.payload.decisionId);
  const profileId = stringField(event.payload.profileId);
  const digest = stringField(event.payload.digest);
  if (!decisionId || !profileId || !digest) return undefined;
  return {
    schemaVersion: 'sciforge.harness-decision-record.v1',
    decisionId,
    profileId,
    digest,
    summary: stringField(event.payload.summary),
    refs: event.payload.refs.map((ref) => ref.ref).filter((ref): ref is string => Boolean(ref)),
    contractRef: stringField(event.payload.contractRef),
    traceRef: stringField(event.payload.traceRef),
    source: stringField(event.payload.source),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
