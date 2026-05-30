import type { RuntimeExecutionUnit } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';

export type ExecutionPresentationVariant = 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';

export function executionStatusLabel(status: RuntimeExecutionUnit['status'] | string | undefined, locale?: ResultLocale) {
  if (status === 'done') return resultText(locale, { 'zh-CN': '完成', 'en-US': 'Done' });
  if (status === 'self-healed') return resultText(locale, { 'zh-CN': '已恢复', 'en-US': 'Recovered' });
  if (status === 'failed' || status === 'failed-with-reason') return resultText(locale, { 'zh-CN': '失败', 'en-US': 'Failed' });
  if (status === 'repair-needed') return resultText(locale, { 'zh-CN': '需要恢复', 'en-US': 'Needs recovery' });
  if (status === 'needs-human') return resultText(locale, { 'zh-CN': '需要输入', 'en-US': 'Needs input' });
  if (status === 'record-only') return resultText(locale, { 'zh-CN': '已记录', 'en-US': 'Recorded' });
  if (status === 'planned') return resultText(locale, { 'zh-CN': '已计划', 'en-US': 'Planned' });
  if (status === 'running') return resultText(locale, { 'zh-CN': '运行中', 'en-US': 'Running' });
  return status || resultText(locale, { 'zh-CN': '未知', 'en-US': 'Unknown' });
}

export function executionStatusShortLabel(status: RuntimeExecutionUnit['status'] | string | undefined, locale?: ResultLocale) {
  if (status === 'repair-needed') return resultText(locale, { 'zh-CN': '恢复', 'en-US': 'Recover' });
  if (status === 'needs-human') return resultText(locale, { 'zh-CN': '输入', 'en-US': 'Input' });
  return executionStatusLabel(status, locale);
}

export function objectReferenceStatusLabel(kind: string, status: string | undefined, locale?: ResultLocale) {
  if (!status || status === 'available') return undefined;
  if (kind === 'execution-unit' && status === 'blocked') return resultText(locale, { 'zh-CN': '需要恢复', 'en-US': 'Needs recovery' });
  if (status === 'blocked') return resultText(locale, { 'zh-CN': '已阻塞', 'en-US': 'Blocked' });
  if (status === 'missing') return resultText(locale, { 'zh-CN': '缺失', 'en-US': 'Missing' });
  if (status === 'expired') return resultText(locale, { 'zh-CN': '已过期', 'en-US': 'Expired' });
  if (status === 'external') return resultText(locale, { 'zh-CN': '外部', 'en-US': 'External' });
  return status;
}

export type ExecutionVerificationPresentation = {
  state: 'ordinary' | 'unverified' | 'verifying' | 'failed' | 'passed' | 'needs-human' | 'uncertain';
  label: string;
  detail: string;
  variant: ExecutionPresentationVariant;
};

export function executionVerificationPresentation(unit: RuntimeExecutionUnit, locale?: ResultLocale): ExecutionVerificationPresentation {
  if (unit.verificationVerdict === 'pass') {
    return {
      state: 'passed',
      label: resultText(locale, { 'zh-CN': '检查通过', 'en-US': 'Check passed' }),
      detail: resultText(locale, { 'zh-CN': '结果已通过验证。', 'en-US': 'The result passed verification.' }),
      variant: 'success',
    };
  }
  if (unit.verificationVerdict === 'fail') {
    return {
      state: 'failed',
      label: resultText(locale, { 'zh-CN': '检查失败', 'en-US': 'Check failed' }),
      detail: resultText(locale, { 'zh-CN': '结果未通过验证。', 'en-US': 'The result did not pass verification.' }),
      variant: 'danger',
    };
  }
  if (unit.verificationVerdict === 'needs-human') {
    return {
      state: 'needs-human',
      label: resultText(locale, { 'zh-CN': '需要输入', 'en-US': 'Needs input' }),
      detail: resultText(locale, { 'zh-CN': '验证需要人工确认。', 'en-US': 'Verification needs human confirmation.' }),
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'uncertain') {
    return {
      state: 'uncertain',
      label: resultText(locale, { 'zh-CN': '不确定', 'en-US': 'Uncertain' }),
      detail: resultText(locale, { 'zh-CN': '验证结果不确定。', 'en-US': 'Verification is inconclusive.' }),
      variant: 'warning',
    };
  }
  if (unit.verificationVerdict === 'unverified') {
    return {
      state: 'unverified',
      label: resultText(locale, { 'zh-CN': '未检查', 'en-US': 'Not checked' }),
      detail: resultText(locale, { 'zh-CN': '结果尚未验证。', 'en-US': 'The result has not been verified.' }),
      variant: 'muted',
    };
  }
  if (unit.status === 'running' && (unit.verificationRef || unit.outputArtifacts?.length || unit.artifacts?.length || unit.outputRef)) {
    return {
      state: 'verifying',
      label: resultText(locale, { 'zh-CN': '检查中', 'en-US': 'Checking' }),
      detail: resultText(locale, { 'zh-CN': '验证仍在运行。', 'en-US': 'Verification is still running.' }),
      variant: 'info',
    };
  }
  return {
    state: 'ordinary',
    label: resultText(locale, { 'zh-CN': '未请求检查', 'en-US': 'No check requested' }),
    detail: resultText(locale, { 'zh-CN': '此步骤未请求验证。', 'en-US': 'This step did not request verification.' }),
    variant: 'muted',
  };
}
