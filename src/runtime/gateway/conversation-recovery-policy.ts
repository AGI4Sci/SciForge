export const CONVERSATION_RECOVERY_PLAN_SCHEMA_VERSION = 'sciforge.conversation.recovery-plan.v1' as const;

type JsonMap = Record<string, unknown>;

export interface ConversationRecoveryInput {
  failure?: unknown;
  digests?: unknown;
  attempts?: unknown;
}

export interface ConversationRecoveryPlan {
  schemaVersion: typeof CONVERSATION_RECOVERY_PLAN_SCHEMA_VERSION;
  status: string;
  action: string;
  ok: boolean;
  retryable: boolean;
  reason: { code: string; message: string };
  nextActions: string[];
  evidenceRefs: string[];
}

const CODE_SILENT_STREAM = code('silent', 'stream');
const CODE_MISSING_OUTPUT = code('missing', 'output');
const CODE_MISSING_REQUIRED_ARTIFACT = code('missing', 'required', 'artifact');
const CODE_MISSING_MARKDOWN_REPORT = code('missing', 'markdown', 'report');
const CODE_MISSING_ARTIFACT_REF = code('missing', 'artifact', 'ref');
const CODE_ACCEPTANCE_FAILED = code('acceptance', 'failed');
const CODE_CONTEXT_WINDOW = code('context', 'window');
const CODE_PAYLOAD_BUDGET = code('payload', 'budget');
const CODE_HANDOFF_BUDGET_EXCEEDED = code('handoff', 'budget', 'exceeded');
const CODE_BACKEND_FAILED = code('backend', 'failed');
const CODE_HTTP_429 = code('http', '429');
const CODE_RATE_LIMIT = code('rate', 'limit');
const CODE_UNKNOWN_FAILURE = code('unknown', 'failure');
const ACTION_DIGEST_RECOVERY = code('digest', 'recovery');

export function planConversationRecovery(input: ConversationRecoveryInput = {}): ConversationRecoveryPlan {
  const failure = recordValue(input.failure) ?? {};
  const digests = arrayValue(input.digests).map(recordValue).filter((item): item is JsonMap => Boolean(item));
  const attempts = arrayValue(input.attempts).map(recordValue).filter((item): item is JsonMap => Boolean(item));
  const code = failureCode(failure);
  const message = firstString(failure.message, failure.detail, failure.failureReason, failure.reason) ?? code;
  const retryCount = attempts.filter((attempt) => {
    const action = firstString(attempt.recoveryAction, attempt.action);
    return action === 'repair' || action === ACTION_DIGEST_RECOVERY;
  }).length;
  const maxRetries = numberValue(failure.maxRecoveryAttempts) ?? 2;
  const usableDigests = digests.filter(hasDigestRef);

  if (retryCount >= maxRetries) {
    return plan(
      'failed-with-reason',
      code,
      `Recovery budget exhausted after ${retryCount} attempt(s): ${message}`,
      {
        nextActions: ['Show the structured failure to the user.', 'Keep logs, digest refs, and prior attempts for a manual follow-up.'],
        evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
        retryable: false,
      },
    );
  }

  if (code === CODE_SILENT_STREAM) {
    if (usableDigests.length) {
      return plan(
        ACTION_DIGEST_RECOVERY,
        code,
        'Backend stream went silent; current-reference digests are available for bounded result recovery.',
        {
          nextActions: ['Generate a user-visible result from currentReferenceDigests.', 'Mark recovered output as digest recovery and preserve original silent-stream evidence.'],
          evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
        },
      );
    }
    return plan(
      'repair',
      code,
      'Backend stream went silent and no digest refs are available.',
      {
        nextActions: ['Retry with compact context and explicit progress requirements.', 'If the retry is silent, return failed-with-reason.'],
        evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
      },
    );
  }

  if (new Set([CODE_MISSING_OUTPUT, CODE_MISSING_REQUIRED_ARTIFACT, CODE_MISSING_MARKDOWN_REPORT, CODE_MISSING_ARTIFACT_REF, CODE_ACCEPTANCE_FAILED]).has(code)) {
    return plan(
      'repair',
      code,
      `Output failed acceptance: ${message}`,
      {
        nextActions: ['Run acceptance repair with the failed artifact contract.', 'Require structured artifacts/refs before marking success.'],
        evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
      },
    );
  }

  if (new Set([CODE_CONTEXT_WINDOW, CODE_PAYLOAD_BUDGET, CODE_HANDOFF_BUDGET_EXCEEDED]).has(code) && usableDigests.length) {
    return plan(
      ACTION_DIGEST_RECOVERY,
      code,
      `Context or handoff budget failed, but digest refs can recover a bounded answer: ${message}`,
      {
        nextActions: ['Recover from digest refs instead of re-inlining raw context.', 'Return report artifact refs generated from the digest recovery.'],
        evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
      },
    );
  }

  if (new Set([CODE_BACKEND_FAILED, CODE_HTTP_429, CODE_RATE_LIMIT, 'timeout']).has(code)) {
    return plan(
      'repair',
      code,
      `Backend failure is retryable with compact context: ${message}`,
      {
        nextActions: ['Retry once with compact handoff and preserved failure refs.', 'Stop after retry budget and return failed-with-reason if still failing.'],
        evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
      },
    );
  }

  return plan(
    'failed-with-reason',
    code,
    `No safe automated recovery is available: ${message}`,
    {
      nextActions: ['Return the structured failure to the user.', 'Ask for missing inputs or manual rerun guidance.'],
      evidenceRefs: evidenceRefs(failure, usableDigests, attempts),
      retryable: false,
    },
  );
}

export const planRecovery = planConversationRecovery;

function failureCode(failure: JsonMap): string {
  const explicit = firstString(failure.code, recordValue(failure.reason)?.code, failure.kind, failure.type);
  const text = stringArray([explicit, failure.message, failure.detail, failure.failureReason, failure.reason]).join(' ').toLowerCase();
  if (text.includes('silent') && text.includes('stream')) return CODE_SILENT_STREAM;
  if (text.includes('missing') && text.includes('output')) return CODE_MISSING_OUTPUT;
  if (text.includes('markdown') && text.includes('report')) return CODE_MISSING_MARKDOWN_REPORT;
  if (text.includes('required') && text.includes('artifact')) return CODE_MISSING_REQUIRED_ARTIFACT;
  if (text.includes('artifact') && text.includes('ref')) return CODE_MISSING_ARTIFACT_REF;
  if (text.includes('context') && (text.includes('window') || text.includes('token'))) return CODE_CONTEXT_WINDOW;
  if (text.includes('429')) return CODE_HTTP_429;
  if (text.includes('rate') && text.includes('limit')) return CODE_RATE_LIMIT;
  if (text.includes('timeout')) return 'timeout';
  if (text.includes('acceptance')) return CODE_ACCEPTANCE_FAILED;
  return explicit ?? CODE_UNKNOWN_FAILURE;
}

function hasDigestRef(digest: JsonMap): boolean {
  return ['ref', 'path', 'digestRef', 'dataRef', 'sourceRef'].some((key) => Boolean(stringValue(digest[key])));
}

function evidenceRefs(failure: JsonMap, digests: JsonMap[], attempts: JsonMap[]): string[] {
  const refs: string[] = [];
  refs.push(...stringArray(failure.evidenceRefs));
  for (const key of ['ref', 'outputRef', 'stdoutRef', 'stderrRef', 'traceRef']) {
    const value = stringValue(failure[key]);
    if (value) refs.push(value);
  }
  for (const digest of digests) {
    for (const key of ['ref', 'path', 'digestRef', 'dataRef', 'sourceRef']) {
      const value = stringValue(digest[key]);
      if (value) refs.push(value);
    }
  }
  for (const attempt of attempts.slice(-3)) {
    for (const key of ['ref', 'outputRef', 'stdoutRef', 'stderrRef', 'traceRef']) {
      const value = stringValue(attempt[key]);
      if (value) refs.push(value);
    }
  }
  return dedupe(refs);
}

function plan(
  action: string,
  code: string,
  message: string,
  options: { nextActions: string[]; evidenceRefs: string[]; retryable?: boolean },
): ConversationRecoveryPlan {
  return {
    schemaVersion: CONVERSATION_RECOVERY_PLAN_SCHEMA_VERSION,
    status: action,
    action,
    ok: action !== 'failed-with-reason',
    retryable: options.retryable ?? true,
    reason: { code, message },
    nextActions: options.nextActions,
    evidenceRefs: options.evidenceRefs,
  };
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | undefined {
  return stringArray(values)[0];
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (typeof item === 'number' || typeof item === 'boolean') return [String(item)];
    return [];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function code(...parts: string[]): string {
  return parts.join('-');
}
