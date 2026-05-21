import { formatProgressHeadline, latestProgressModel } from '../../processProgress';
import { latestRunningEvent } from '../../streamEventPresentation';
import { isRuntimeAuditOnlyEvent } from '../../runtimeAuditEvents';
import type { AgentStreamEvent, SciForgeConfig } from '../../domain';
import type { RuntimeHealthItem } from '../runtimeHealthPanel';

export function runningMessageContentFromStream(assistantDraft: string, streamEvents: AgentStreamEvent[]) {
  const latestWorklogLine = formatProgressHeadline(latestProgressModel(streamEvents), latestRunningEvent(streamEvents));
  if (assistantDraft) return assistantDraft;
  if (latestWorklogLine) return latestWorklogLine;
  if (streamEvents.some(isRuntimeAuditOnlyEvent)) {
    return '正在等待工作区进度；详细日志已收起。';
  }
  return '正在规划或执行任务，过程细节默认收起。';
}

export function runReadiness({
  input,
  isSending,
  config,
  runtimeHealth,
}: {
  input: string;
  isSending: boolean;
  config: SciForgeConfig;
  runtimeHealth?: RuntimeHealthItem[];
}) {
  if (!input.trim() && !isSending) {
    return {
      ok: false,
      severity: 'muted' as const,
      message: '输入研究问题后即可运行；Shift+Enter 换行，Enter 发送。',
    };
  }
  if (isSending) {
    return {
      ok: true,
      severity: 'info' as const,
      message: '当前任务正在执行；继续输入会排队为下一条引导。',
    };
  }
  if (!config.workspacePath.trim()) {
    return {
      ok: false,
      severity: 'warning' as const,
      message: '缺少 workspace path，请先在设置中选择工作目录。',
    };
  }
  const blockingRuntime = runtimeReadinessIssue(runtimeHealth);
  if (blockingRuntime) {
    return {
      ok: false,
      severity: blockingRuntime.severity,
      message: blockingRuntime.message,
    };
  }
  return {
    ok: true,
    severity: 'success' as const,
    message: '将使用当前工作区和已选工具运行。',
  };
}

export function runtimeReadinessIssue(runtimeHealth?: RuntimeHealthItem[]) {
  if (!runtimeHealth?.length) return undefined;
  const required = runtimeHealth.filter((item) => item.id === 'workspace' || item.id === 'codex-runtime');
  const checking = required.find((item) => item.status === 'checking');
  if (checking) {
    return {
      severity: 'info' as const,
      message: `正在检查 ${checking.label}：${checking.detail}。请稍候再发送，避免创建不可恢复的空 run。`,
    };
  }
  const blocked = required.find((item) => item.status === 'offline' || item.status === 'not-configured');
  if (!blocked) return undefined;
  const action = blocked.recoverAction ? ` ${blocked.recoverAction}` : '';
  return {
    severity: 'warning' as const,
    message: `${blocked.label} 未就绪：${blocked.detail}。${action}`,
  };
}
