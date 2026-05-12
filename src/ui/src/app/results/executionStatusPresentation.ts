import type { RuntimeExecutionUnit } from '../../domain';

export function executionStatusLabel(status: RuntimeExecutionUnit['status'] | string | undefined) {
  if (status === 'done') return 'Done';
  if (status === 'self-healed') return 'Self healed';
  if (status === 'failed' || status === 'failed-with-reason') return 'Failed';
  if (status === 'repair-needed') return 'Repair needed';
  if (status === 'needs-human') return 'Needs human';
  if (status === 'record-only') return 'Record only';
  if (status === 'planned') return 'Planned';
  if (status === 'running') return 'Running';
  return status || 'Unknown';
}

export function executionStatusShortLabel(status: RuntimeExecutionUnit['status'] | string | undefined) {
  if (status === 'repair-needed') return 'Repair';
  if (status === 'needs-human') return 'Needs Human';
  return executionStatusLabel(status);
}

export function objectReferenceStatusLabel(kind: string, status: string | undefined) {
  if (!status || status === 'available') return undefined;
  if (kind === 'execution-unit' && status === 'blocked') return 'Repair needed';
  if (status === 'blocked') return 'Blocked';
  if (status === 'missing') return 'Missing';
  if (status === 'expired') return 'Expired';
  if (status === 'external') return 'External';
  return status;
}
