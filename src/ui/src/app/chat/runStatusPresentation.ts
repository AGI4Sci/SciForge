import { formatProgressHeadline, progressModelFromEvent } from '../../processProgress';
import type { ProcessProgressModel } from '../../processProgress';
import { normalizeAssistantProseForDisplay } from '../../assistantText';
import { latestRunningEvent } from '../../streamEventPresentation';
import { isRuntimeAuditOnlyEvent } from '../../runtimeAuditEvents';
import { providerReadinessNoticeFromConfig } from '../../providerReadiness';
import type { AgentStreamEvent, SciForgeConfig } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import type { RuntimeHealthItem } from '../runtimeHealthPanel';
import { chatText } from './chatI18n';

export function runningMessageContentFromStream(assistantDraft: string, streamEvents: AgentStreamEvent[], locale?: SupportedLocale) {
  const latestEventLine = latestRunningEvent(streamEvents);
  const latestWorklogLine = formatProgressHeadline(
    latestUserFacingProgressModel(streamEvents),
    isTransportProgressText(latestEventLine) ? undefined : latestEventLine,
    locale,
  );
  if (assistantDraft) return normalizeAssistantProseForDisplay(assistantDraft);
  if (latestWorklogLine) return latestWorklogLine;
  if (streamEvents.some(isRuntimeAuditOnlyEvent)) {
    return chatText(locale, { 'zh-CN': '正在等待工作区活动。', 'en-US': 'Waiting for workspace activity.' });
  }
  if (streamEvents.length) return chatText(locale, { 'zh-CN': '正在处理你的请求。', 'en-US': 'Working on your request.' });
  return chatText(locale, { 'zh-CN': '正在连接工作区活动。', 'en-US': 'Connecting to workspace activity.' });
}

function latestUserFacingProgressModel(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const model = progressModelFromEvent(event);
    if (model && !isTransportProgressModel(model)) return model;
  }
  return undefined;
}

function isTransportProgressModel(model: ProcessProgressModel) {
  if (model.reading.length || model.writing.length) return false;
  const userFacingText = [
    model.title,
    model.detail,
    model.nextStep,
    model.reason,
    model.lastEvent?.label,
    model.lastEvent?.detail,
  ].filter(Boolean).join(' ').toLowerCase();
  if (userFacingText && !isTransportProgressText(userFacingText)) return false;
  const text = [
    userFacingText,
    model.waitingFor,
  ].filter(Boolean).join(' ').toLowerCase();
  return isTransportProgressText(text);
}

function isTransportProgressText(value: string | undefined) {
  const text = (value ?? '').toLowerCase();
  return /\b(?:codex app-server|rich-client|backend event|backend progress|http stream)\b/.test(text)
    || /(?:app-server|rich-client).*(?:事件|首个|下一条|正在等|等待|运行|启动)/i.test(text)
    || /(?:下一条|首个).*(?:rich-client|backend|后端).*(?:事件|event)/i.test(text);
}

export function runReadiness({
  input,
  isSending,
  config,
  runtimeHealth,
  locale = config.locale,
}: {
  input: string;
  isSending: boolean;
  config: SciForgeConfig;
  runtimeHealth?: RuntimeHealthItem[];
  locale?: SupportedLocale;
}) {
  if (!input.trim() && !isSending) {
    return {
      ok: false,
      severity: 'muted' as const,
      message: chatText(locale, {
        'zh-CN': '输入问题即可开始。Shift+Enter 换行，Enter 发送。',
        'en-US': 'Ask a question to start. Shift+Enter adds a line; Enter sends.',
      }),
    };
  }
  if (isSending) {
    return {
      ok: true,
      severity: 'info' as const,
      message: chatText(locale, {
        'zh-CN': '任务正在运行。新的引导会排队。',
        'en-US': 'A task is running. New guidance will be queued.',
      }),
    };
  }
  if (!config.workspacePath.trim()) {
    return {
      ok: false,
      severity: 'warning' as const,
      message: chatText(locale, {
        'zh-CN': '发送前请选择工作区文件夹。',
        'en-US': 'Choose a workspace folder before sending.',
      }),
    };
  }
  const blockingRuntime = runtimeReadinessIssue(runtimeHealth, locale);
  if (blockingRuntime) {
    return {
      ok: false,
      severity: blockingRuntime.severity,
      message: blockingRuntime.message,
    };
  }
  const providerNotice = providerReadinessNoticeFromConfig(config);
  if (!providerNotice.ready) {
    return {
      ok: true,
      severity: 'warning' as const,
      message: chatText(locale, {
        'zh-CN': `连接提示：${providerNotice.detail}.${providerNotice.recoverAction ? ` ${providerNotice.recoverAction}` : ''}`,
        'en-US': `Connection notice: ${providerNotice.detail}.${providerNotice.recoverAction ? ` ${providerNotice.recoverAction}` : ''}`,
      }),
    };
  }
  return {
    ok: true,
    severity: 'success' as const,
    message: chatText(locale, {
      'zh-CN': '已准备好在当前工作区运行。',
      'en-US': 'Ready to run in the current workspace.',
    }),
  };
}

export function runtimeReadinessIssue(runtimeHealth?: RuntimeHealthItem[], locale?: SupportedLocale) {
  if (!runtimeHealth?.length) return undefined;
  const required = runtimeHealth.filter((item) => item.id === 'workspace' || item.id === 'codex-runtime');
  const checking = required.find((item) => item.status === 'checking');
  if (checking) {
    return {
      severity: 'info' as const,
      message: chatText(locale, {
        'zh-CN': `正在检查 ${checking.label}：${checking.detail}。请稍后再发送。`,
        'en-US': `Checking ${checking.label}: ${checking.detail}. Please wait before sending.`,
      }),
    };
  }
  const blocked = required.find((item) => item.status === 'offline' || item.status === 'not-configured');
  if (!blocked) return undefined;
  const action = blocked.recoverAction ? ` ${blocked.recoverAction}` : '';
  return {
    severity: 'warning' as const,
    message: chatText(locale, {
      'zh-CN': `${blocked.label} 尚未就绪：${blocked.detail}.${action}`,
      'en-US': `${blocked.label} is not ready: ${blocked.detail}.${action}`,
    }),
  };
}
