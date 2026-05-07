import { Badge } from '../uiPrimitives';
import type { SciForgeMessage } from '../../domain';

export function AcceptancePanel({
  acceptance,
}: {
  acceptance: NonNullable<SciForgeMessage['acceptance']>;
}) {
  const diagnostic = turnAcceptanceDiagnostic(acceptance);
  return (
    <div className="turn-acceptance-notice">
      <Badge variant={acceptance.severity === 'repairable' ? 'warning' : 'danger'}>{acceptance.severity}</Badge>
      <div className="turn-acceptance-copy">
        <strong>{diagnostic.title}</strong>
        <span>{diagnostic.summary}</span>
        {diagnostic.recoverActions.length ? (
          <ul>
            {diagnostic.recoverActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        ) : null}
        {diagnostic.secondary.length ? (
          <div className="turn-acceptance-secondary">
            {diagnostic.secondary.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
        <details className="turn-acceptance-raw">
          <summary>查看原始诊断</summary>
          <pre>{diagnostic.rawDetails}</pre>
        </details>
      </div>
    </div>
  );
}

export function turnAcceptanceDiagnostic(acceptance: NonNullable<SciForgeMessage['acceptance']>) {
  const rawDetails = acceptance.failures
    .map((failure) => `${failure.code}: ${failure.detail}`)
    .join('\n\n');
  const haystack = rawDetails.toLowerCase();
  const secondary = acceptance.failures
    .filter((failure) => !/execution-failed|backend-repair-failed/i.test(failure.code))
    .map((failure) => readableAcceptanceFailure(failure.code));
  if (/http-429|429|rate-limit|too-many-failed-attempts|exceeded retry|retry-budget/.test(haystack)) {
    return {
      title: '后端模型限流，自动修复未完成',
      summary: 'AgentServer 调用模型时触发 HTTP 429 / too-many-failed-attempts，SciForge 已做过一次 compact/slim retry；重试预算耗尽后停止，避免继续刷失败请求。',
      recoverActions: [
        '等待 provider 配额或 retry budget 恢复后重试同一问题。',
        '切换到可用 quota 的 backend/model，再重试后续修复。',
        '后续追问尽量引用已有 report/paper-list artifact，避免重新发送大段全文上下文。',
      ],
      secondary,
      rawDetails,
    };
  }
  if (/cancel|已取消|abort|timeout|超时/.test(haystack)) {
    return {
      title: '后端修复请求被中断',
      summary: '本次 acceptance repair 没有完成，通常是用户中断、请求超时，或外层运行已经结束导致后台 stream 被取消。',
      recoverActions: ['确认 Runtime Health 为 ready 后重新发送同一修复请求。'],
      secondary,
      rawDetails,
    };
  }
  if (/missing-object-references|clickable object references|引用/.test(haystack)) {
    return {
      title: '结果缺少可点击引用',
      summary: '回答里提到了路径或 artifact，但没有被规范化成 SciForge 可点击 object reference。',
      recoverActions: ['要求后端基于已有 artifact 重新返回 objectReferences，不需要重新检索全文。'],
      secondary,
      rawDetails,
    };
  }
  return {
    title: '任务未通过验收',
    summary: acceptance.failures.map((failure) => failure.detail).join('；'),
    recoverActions: [],
    secondary,
    rawDetails,
  };
}

function readableAcceptanceFailure(code: string) {
  if (code === 'missing-object-references') return '缺少可点击对象引用';
  if (code === 'missing-explicit-references') return '显式引用未保留';
  if (code === 'unused-explicit-references') return '引用未体现在结果中';
  if (code === 'empty-final-response') return '最终回答为空';
  if (code === 'raw-payload-leak') return '暴露了原始 payload';
  return code;
}
