import type { RuntimeExecutionUnit } from '../../domain';

export type ExecutionPresentationVariant = 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';

export function executionStatusLabel(status: RuntimeExecutionUnit['status'] | string | undefined) {
  if (status === 'done') return '完成';
  if (status === 'self-healed') return '已自动修复';
  if (status === 'failed' || status === 'failed-with-reason') return '失败';
  if (status === 'repair-needed') return '待修复';
  if (status === 'needs-human') return '需要确认';
  if (status === 'record-only') return '仅记录';
  if (status === 'planned') return '计划中';
  if (status === 'running') return '进行中';
  return status || '未知';
}

export function executionStatusShortLabel(status: RuntimeExecutionUnit['status'] | string | undefined) {
  if (status === 'repair-needed') return '修复';
  if (status === 'needs-human') return '确认';
  return executionStatusLabel(status);
}

export function objectReferenceStatusLabel(kind: string, status: string | undefined) {
  if (!status || status === 'available') return undefined;
  if (kind === 'execution-unit' && status === 'blocked') return '待修复';
  if (status === 'blocked') return '受阻';
  if (status === 'missing') return '缺失';
  if (status === 'expired') return '已过期';
  if (status === 'external') return '外部材料';
  return status;
}

export type ExecutionVerificationPresentation = {
  state: 'ordinary' | 'unverified' | 'verifying' | 'failed' | 'passed' | 'needs-human' | 'uncertain';
  label: string;
  detail: string;
  variant: ExecutionPresentationVariant;
};

export function executionVerificationPresentation(unit: RuntimeExecutionUnit): ExecutionVerificationPresentation {
  if (unit.verificationVerdict === 'pass') {
    return {
      state: 'passed',
      label: '验证通过',
      detail: '结果已通过验证',
      variant: 'success',
    };
  }
  if (unit.verificationVerdict === 'fail') {
    return {
      state: 'failed',
      label: '验证失败',
      detail: '结果验证失败',
      variant: 'danger',
    };
  }
  if (unit.verificationVerdict === 'needs-human') {
    return {
      state: 'needs-human',
      label: '需要确认',
      detail: '验证需要人工确认',
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'uncertain') {
    return {
      state: 'uncertain',
      label: '验证不确定',
      detail: '验证结论不确定',
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'unverified') {
    return {
      state: 'unverified',
      label: '未验证',
      detail: '结果尚未验证',
      variant: 'muted',
    };
  }
  if (unit.status === 'running' && (unit.verificationRef || unit.outputArtifacts?.length || unit.artifacts?.length || unit.outputRef)) {
    return {
      state: 'verifying',
      label: '验证中',
      detail: '验证仍在进行',
      variant: 'info',
    };
  }
  return {
    state: 'ordinary',
    label: '未要求验证',
    detail: '本步骤未要求验证',
    variant: 'muted',
  };
}
