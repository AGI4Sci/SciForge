import type {
  ConversationEvent,
  ConversationEventLog,
  ConversationKernelDiagnostic,
  EventAppendResult,
} from './types';

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
