import type { TaskAttemptRecord } from '../runtime-types.js';

export function hasRecoverableRecentAttempt(attempts: TaskAttemptRecord[], currentPrompt: string) {
  const normalizedPrompt = normalizeRecoverableAttemptPrompt(currentPrompt);
  return attempts.some((attempt) => {
    if (normalizeRecoverableAttemptPrompt(attempt.prompt) !== normalizedPrompt) return false;
    const candidates = [
      attempt.status,
      attempt.failureReason,
      attempt.routeDecision?.fallbackReason,
    ];
    return candidates.some((value) => /repair-needed|failed|needs-human|timed out|cancelled|timeout/i.test(String(value || '')));
  });
}

function normalizeRecoverableAttemptPrompt(value: string | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
