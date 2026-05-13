import { createHash } from 'node:crypto';
import type {
  ConversationEvent,
  ConversationEventLog,
  ConversationKernelDiagnostic,
  EventAppendResult,
} from './types';
import { validateBackgroundContinuationEvent } from './background-continuation';
import { validateVerificationRecordedEvent } from './verification-gate';

export const CONVERSATION_INLINE_EVENT_MAX_BYTES = 8 * 1024;

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
  const eventContractDiagnostic = validateBackgroundContinuationEvent(event) ?? validateVerificationRecordedEvent(event);
  if (eventContractDiagnostic) return eventContractDiagnostic;

  if (event.storage === 'inline') {
    const payloadBytes = Buffer.byteLength(JSON.stringify(event.payload), 'utf8');
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

export function conversationEventLogDigest(log: ConversationEventLog): string {
  return `sha256:${createHash('sha256').update(stableStringify(log)).digest('hex')}`;
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

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
