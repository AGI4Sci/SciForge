import { formatProgressHeadline, latestProgressModel } from '../../processProgress';
import { latestRunningEvent } from '../../streamEventPresentation';
import type { AgentStreamEvent, RuntimeExecutionUnit, SciForgeConfig } from '../../domain';

export function runningMessageContentFromStream(assistantDraft: string, streamEvents: AgentStreamEvent[]) {
  const latestWorklogLine = formatProgressHeadline(latestProgressModel(streamEvents), latestRunningEvent(streamEvents));
  return assistantDraft || latestWorklogLine || '正在规划、生成或执行 workspace task，过程日志默认折叠。';
}

export function runReadiness({
  input,
  isSending,
  config,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
}: {
  input: string;
  isSending: boolean;
  config: SciForgeConfig;
  scenarioPackageRef: RuntimeExecutionUnit['scenarioPackageRef'];
  skillPlanRef: string;
  uiPlanRef: string;
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
      message: '当前 run 正在执行；继续输入会排队为下一条引导。',
    };
  }
  if (!config.workspacePath.trim()) {
    return {
      ok: false,
      severity: 'warning' as const,
      message: '缺少 workspace path，请先在设置中选择工作目录。',
    };
  }
  return {
    ok: true,
    severity: 'success' as const,
    message: `将使用 ${scenarioPackageRef?.id ?? 'built-in'} · ${skillPlanRef} · ${uiPlanRef} 运行。`,
  };
}
