import type { RuntimeExecutionUnit } from '../../domain';

export type ExecutionPresentationVariant = 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';

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

export type ExecutionVerificationPresentation = {
  state: 'ordinary' | 'unverified' | 'verifying' | 'failed' | 'passed' | 'needs-human' | 'uncertain';
  label: string;
  detail: string;
  variant: ExecutionPresentationVariant;
};

export function executionVerificationPresentation(unit: RuntimeExecutionUnit): ExecutionVerificationPresentation {
  const refText = unit.verificationRef ? ` ref=${unit.verificationRef}` : '';
  if (unit.verificationVerdict === 'pass') {
    return {
      state: 'passed',
      label: 'Verification passed',
      detail: `release verification passed${refText}`,
      variant: 'success',
    };
  }
  if (unit.verificationVerdict === 'fail') {
    return {
      state: 'failed',
      label: 'Verification failed',
      detail: `verification failed${refText}`,
      variant: 'danger',
    };
  }
  if (unit.verificationVerdict === 'needs-human') {
    return {
      state: 'needs-human',
      label: 'Needs human verification',
      detail: `verification needs human review${refText}`,
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'uncertain') {
    return {
      state: 'uncertain',
      label: 'Verification uncertain',
      detail: `verification is uncertain${refText}`,
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'unverified') {
    return {
      state: 'unverified',
      label: 'Unverified',
      detail: `result is explicitly unverified${refText}`,
      variant: 'muted',
    };
  }
  if (unit.status === 'running' && (unit.verificationRef || unit.outputArtifacts?.length || unit.artifacts?.length || unit.outputRef)) {
    return {
      state: 'verifying',
      label: 'Verifying',
      detail: `background verification is still running${refText}`,
      variant: 'info',
    };
  }
  return {
    state: 'ordinary',
    label: 'No verification requested',
    detail: 'ordinary result; no runtime verification verdict was recorded',
    variant: 'muted',
  };
}
