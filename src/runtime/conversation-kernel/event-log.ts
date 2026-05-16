import type {
  ConversationEvent,
  ConversationEventLog,
  ConversationKernelDiagnostic,
  EventAppendResult,
} from './types';
import { validateBackgroundContinuationEvent } from './background-continuation';
import { validateVerificationRecordedEvent } from './verification-gate';
import { validateHistoryEditedEvent } from './history-edit';
import { validateHarnessDecisionRecordedEvent } from './harness-decision';

export const CONVERSATION_INLINE_EVENT_MAX_BYTES = 8 * 1024;

const REF_EVENT_INLINE_FACT_TYPES = new Set([
  'DegradedResult',
  'ExternalBlocked',
  'RepairNeeded',
  'NeedsHuman',
]);

const REF_LIFECYCLE_EVENT_TYPES = new Set([
  'RefArchived',
  'RefPinned',
  'RefDeleted',
  'RefTombstoned',
]);

export function createConversationEventLog(conversationId: string): ConversationEventLog {
  return {
    schemaVersion: 'sciforge.conversation-event-log.v1',
    conversationId,
    events: [],
  };
}

export function appendConversationEvent(
  log: ConversationEventLog,
  event: ConversationEvent,
  options: { inlineMaxBytes?: number } = {},
): EventAppendResult {
  const rejected = validateConversationEvent(event, options.inlineMaxBytes ?? CONVERSATION_INLINE_EVENT_MAX_BYTES);
  if (rejected) return { log, rejected };
  return {
    log: {
      ...log,
      events: [...log.events, event],
    },
  };
}

export function validateConversationEvent(
  event: ConversationEvent,
  inlineMaxBytes = CONVERSATION_INLINE_EVENT_MAX_BYTES,
): ConversationKernelDiagnostic | undefined {
  const eventContractDiagnostic = validateBackgroundContinuationEvent(event)
    ?? validateVerificationRecordedEvent(event)
    ?? validateHistoryEditedEvent(event)
    ?? validateHarnessDecisionRecordedEvent(event);
  if (eventContractDiagnostic) return eventContractDiagnostic;

  if (event.storage === 'inline') {
    const payloadBytes = utf8ByteLength(JSON.stringify(event.payload));
    if (payloadBytes > inlineMaxBytes) {
      return {
        severity: 'error',
        code: 'inline-payload-too-large',
        eventId: event.id,
        message: `Inline event payload is ${payloadBytes} bytes; store large content as refs instead.`,
      };
    }
    return undefined;
  }
  const inlineFactDiagnostic = validateRefEventInlineFacts(event);
  if (inlineFactDiagnostic) return inlineFactDiagnostic;
  const refLifecycleDiagnostic = validateRefLifecycleEvent(event);
  if (refLifecycleDiagnostic) return refLifecycleDiagnostic;
  const explicitImportDiagnostic = validateExplicitImportRecordedEvent(event);
  if (explicitImportDiagnostic) return explicitImportDiagnostic;
  if (!Array.isArray(event.payload.refs) || event.payload.refs.length === 0) {
    return {
      severity: 'error',
      code: 'ref-event-missing-refs',
      eventId: event.id,
      message: 'Ref event must include at least one materialized ref.',
    };
  }
  const invalidRef = event.payload.refs.find((ref) => !ref.ref || typeof ref.ref !== 'string');
  if (invalidRef) {
    return {
      severity: 'error',
      code: 'ref-event-invalid-ref',
      eventId: event.id,
      message: 'Ref event contains an empty or invalid ref pointer.',
    };
  }
  return undefined;
}

export function validateConversationEventLog(
  value: unknown,
  options: { inlineMaxBytes?: number } = {},
): ConversationKernelDiagnostic[] {
  if (!isRecord(value) || value.schemaVersion !== 'sciforge.conversation-event-log.v1') {
    return [{
      severity: 'error',
      code: 'invalid-event-log-schema',
      message: 'ConversationEventLog must use sciforge.conversation-event-log.v1.',
    }];
  }
  if (typeof value.conversationId !== 'string' || !value.conversationId.trim()) {
    return [{
      severity: 'error',
      code: 'invalid-event-log-conversation-id',
      message: 'ConversationEventLog must include a non-empty conversationId.',
    }];
  }
  if (!Array.isArray(value.events)) {
    return [{
      severity: 'error',
      code: 'invalid-event-log-events',
      message: 'ConversationEventLog events must be an array.',
    }];
  }
  const diagnostics: ConversationKernelDiagnostic[] = [];
  const seenIds = new Set<string>();
  for (const event of value.events) {
    if (!isConversationEvent(event)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-event-log-event',
        message: 'ConversationEventLog contains an invalid event shape.',
      });
      continue;
    }
    if (seenIds.has(event.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-event-id',
        eventId: event.id,
        message: `ConversationEventLog contains duplicate event id ${event.id}.`,
      });
    }
    seenIds.add(event.id);
    const rejected = validateConversationEvent(event, options.inlineMaxBytes ?? CONVERSATION_INLINE_EVENT_MAX_BYTES);
    if (rejected) diagnostics.push(rejected);
  }
  return diagnostics;
}

export function isConversationEventLog(value: unknown): value is ConversationEventLog {
  return validateConversationEventLog(value).length === 0;
}

export function eventRefs(event: ConversationEvent): string[] {
  if (event.storage !== 'ref') return [];
  return event.payload.refs.map((ref) => ref.ref);
}

export function eventSummary(event: ConversationEvent): string {
  if (event.storage === 'ref') return event.payload.summary ?? `${event.type} referenced ${event.payload.refs.length} refs`;
  const summary = event.payload.summary;
  if (typeof summary === 'string') return summary;
  const prompt = event.payload.prompt;
  if (typeof prompt === 'string') return prompt;
  const text = event.payload.text;
  if (typeof text === 'string') return text;
  return event.type;
}

function validateRefEventInlineFacts(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (!REF_EVENT_INLINE_FACT_TYPES.has(event.type)) return undefined;
  const summary = stringValue(event.payload.summary);
  const reason = stringValue(event.payload.reason) ?? stringValue(event.payload.failureReason);
  if (summary && (event.type === 'DegradedResult' || event.type === 'NeedsHuman' || reason)) return undefined;
  return {
    severity: 'error',
    code: 'ref-event-inline-facts-required',
    eventId: event.id,
    message: 'Degraded and failure ref events must keep the small summary/reason facts inline; refs are only for large evidence bodies.',
  };
}

function validateRefLifecycleEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (!REF_LIFECYCLE_EVENT_TYPES.has(event.type)) return undefined;
  if (!stringValue(event.payload.summary) && !stringValue(event.payload.reason)) {
    return {
      severity: 'error',
      code: 'ref-lifecycle-reason-required',
      eventId: event.id,
      message: 'Ref archive/pin/delete/tombstone changes must be appended as events with an inline summary or reason.',
    };
  }
  return undefined;
}

function validateExplicitImportRecordedEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (event.type !== 'ExplicitImportRecorded') return undefined;
  if (event.payload.schemaVersion !== 'sciforge.explicit-import-event.v1') {
    return {
      severity: 'error',
      code: 'explicit-import-schema-required',
      eventId: event.id,
      message: 'ExplicitImportRecorded payload must use sciforge.explicit-import-event.v1.',
    };
  }
  if (!stringValue(event.payload.reason)) {
    return {
      severity: 'error',
      code: 'explicit-import-reason-required',
      eventId: event.id,
      message: 'Explicit import events must record why the cross-session ref was imported.',
    };
  }
  if (!Array.isArray(event.payload.imports) || event.payload.imports.length === 0) {
    return {
      severity: 'error',
      code: 'explicit-imports-required',
      eventId: event.id,
      message: 'Explicit import events must include at least one CrossSessionRef import record.',
    };
  }
  const refIds = new Set(Array.isArray(event.payload.refs)
    ? event.payload.refs.map((ref) => ref.ref).filter((ref): ref is string => typeof ref === 'string')
    : []);
  for (const imported of event.payload.imports) {
    if (!isRecord(imported) || imported.schemaVersion !== 'sciforge.cross-session-ref.v1') {
      return {
        severity: 'error',
        code: 'cross-session-ref-schema-required',
        eventId: event.id,
        message: 'CrossSessionRef records must use sciforge.cross-session-ref.v1.',
      };
    }
    const sourceSessionId = stringValue(imported.sourceSessionId);
    const targetSessionId = stringValue(imported.targetSessionId);
    const sourceRef = stringValue(imported.sourceRef);
    const importedRef = stringValue(imported.importedRef);
    const digest = stringValue(imported.digest);
    if (!sourceSessionId || !targetSessionId || !sourceRef || !importedRef || !digest) {
      return {
        severity: 'error',
        code: 'cross-session-ref-fields-required',
        eventId: event.id,
        message: 'CrossSessionRef requires sourceSessionId, targetSessionId, sourceRef, importedRef, and digest.',
      };
    }
    if (sourceSessionId === targetSessionId) {
      return {
        severity: 'error',
        code: 'cross-session-ref-source-target-required',
        eventId: event.id,
        message: 'CrossSessionRef sourceSessionId and targetSessionId must be different.',
      };
    }
    if (sourceRef === importedRef) {
      return {
        severity: 'error',
        code: 'cross-session-ref-explicit-import-required',
        eventId: event.id,
        message: 'Cross-session memory must be imported under an explicit importedRef, not copied as the bare source path.',
      };
    }
    if (!refIds.has(importedRef)) {
      return {
        severity: 'error',
        code: 'cross-session-ref-missing-imported-ref',
        eventId: event.id,
        message: 'Explicit import event refs must include every importedRef recorded in imports.',
      };
    }
  }
  return undefined;
}

function isConversationEvent(value: unknown): value is ConversationEvent {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.type !== 'string' || !value.type.trim()) return false;
  if (typeof value.timestamp !== 'string' || !value.timestamp.trim()) return false;
  if (!['user', 'kernel', 'backend', 'runtime', 'verifier', 'ui'].includes(String(value.actor))) return false;
  if (value.storage === 'inline') return isRecord(value.payload);
  if (value.storage === 'ref') return isRecord(value.payload);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
