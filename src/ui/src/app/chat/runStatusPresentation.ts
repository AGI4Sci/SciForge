import { formatProgressHeadline, progressModelFromEvent } from '../../processProgress';
import type { ProcessProgressModel } from '../../processProgress';
import { normalizeAssistantProseForDisplay } from '../../assistantText';
import { latestRunningEvent } from '../../streamEventPresentation';
import { isRuntimeAuditOnlyEvent } from '../../runtimeAuditEvents';
import { providerReadinessNoticeFromConfig } from '../../providerReadiness';
import type { AgentStreamEvent, SciForgeConfig } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import type { RuntimeHealthItem } from '../runtimeHealthPanel';
import { buildCursorAgentProcessModel } from './cursorAgentProcess';
import { chatText } from './chatI18n';
import { splitFinalMessagePresentation } from './finalMessagePresentation';

export function liveProgressSentenceFromStream(assistantDraft: string, streamEvents: AgentStreamEvent[], locale?: SupportedLocale) {
  const progressSentence = safeLiveProgressSentence(latestUserFacingProgressModel(streamEvents)?.title, locale);
  if (progressSentence) return progressSentence;
  const processSentence = safeLiveProgressSentence(
    buildCursorAgentProcessModel(streamEvents, { mode: 'live', limit: 48, locale }).latestProgressSentence,
    locale,
  );
  if (processSentence) return processSentence;
  if (assistantDraft.trim()) return runningDraftProgressSentence(assistantDraft, locale);
  return safeLiveProgressSentence(runningMessageContentFromStream('', streamEvents, locale), locale)
    || chatText(locale, { 'zh-CN': '正在处理你的请求。', 'en-US': 'Working on your request.' });
}

export function runningMessageContentFromStream(assistantDraft: string, streamEvents: AgentStreamEvent[], locale?: SupportedLocale) {
  const latestEventLine = latestRunningEvent(streamEvents);
  const latestWorklogLine = formatProgressHeadline(
    latestUserFacingProgressModel(streamEvents),
    isTransportProgressText(latestEventLine) || isRuntimeDiagnosticProgressText(latestEventLine) ? undefined : latestEventLine,
    locale,
  );
  if (assistantDraft) return runningDraftContentForDisplay(assistantDraft, locale);
  if (latestWorklogLine) return latestWorklogLine;
  if (streamEvents.some(isRuntimeAuditOnlyEvent)) {
    return chatText(locale, { 'zh-CN': '正在等待工作区活动。', 'en-US': 'Waiting for workspace activity.' });
  }
  if (streamEvents.length) return chatText(locale, { 'zh-CN': '正在处理你的请求。', 'en-US': 'Working on your request.' });
  return chatText(locale, { 'zh-CN': '正在连接工作区活动。', 'en-US': 'Connecting to workspace activity.' });
}

function runningDraftProgressSentence(assistantDraft: string, locale?: SupportedLocale) {
  if (looksLikeDenseLocalPathDraft(assistantDraft) || looksLikeFoldedAuditFallback(runningDraftContentForDisplay(assistantDraft, locale))) {
    return chatText(locale, {
      'zh-CN': '正在整理工作区上下文。详细活动已折叠在过程记录中。',
      'en-US': 'Organizing workspace context. Detailed activity is folded into the process log.',
    });
  }
  return chatText(locale, { 'zh-CN': '正在整理回答。', 'en-US': 'Drafting the response.' });
}

function safeLiveProgressSentence(value: string | undefined, locale?: SupportedLocale) {
  const text = compactLiveProgressSentence(value);
  if (!text) return '';
  if (isTransportProgressText(text) || isRuntimeDiagnosticProgressText(text) || looksLikePromptOrAuditLeak(text)) {
    return chatText(locale, { 'zh-CN': '正在处理你的请求。', 'en-US': 'Working on your request.' });
  }
  return text;
}

function compactLiveProgressSentence(value: string | undefined) {
  const text = normalizeLiveProgressText(value);
  if (!text) return '';
  const [firstLine] = text.split(/\n+/);
  return (firstLine ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLiveProgressText(value: string | undefined) {
  return (value ?? '')
    .replace(/\[(?:local-path|redacted-path)\]\/[^\s"'`<>]+/gi, '[path]')
    .replace(/(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/[^\s"'`<>]+/g, '[path]')
    .replace(/\b(Authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, '$1=[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]+/gi, '[redacted-secret]')
    .trim();
}

function looksLikePromptOrAuditLeak(value: string) {
  return /\b(?:raw\s*jsonl|stdout|stderr|provider|backend|trace|prompt assembly|authorization|api[-_ ]?key|credential)\b/i.test(value)
    || /\b(?:ConversationProjection|ArtifactDelivery|ExecutionUnit|native-message|live-runtime-codex)\b/.test(value)
    || /\[path\]/.test(value);
}

function runningDraftContentForDisplay(assistantDraft: string, locale?: SupportedLocale) {
  if (looksLikeDenseLocalPathDraft(assistantDraft)) {
    return chatText(locale, {
      'zh-CN': '正在整理工作区上下文。详细活动已折叠在过程记录中。',
      'en-US': 'Organizing workspace context. Detailed activity is folded into the process log.',
    });
  }
  const presentation = splitFinalMessagePresentation(assistantDraft);
  const content = presentation.primaryContent.trim();
  if (presentation.auditSections.length && looksLikeFoldedAuditFallback(content)) {
    return chatText(locale, {
      'zh-CN': '正在整理工作区上下文。详细活动已折叠在过程记录中。',
      'en-US': 'Organizing workspace context. Detailed activity is folded into the process log.',
    });
  }
  return content || normalizeAssistantProseForDisplay(assistantDraft);
}

function looksLikeFoldedAuditFallback(content: string) {
  return /^(?:The answer references project context|The task returned additional details|The task returned (?:Process|Details)|The task did not finish)\b/i.test(content);
}

function looksLikeDenseLocalPathDraft(content: string) {
  const text = content.replace(/\r\n?/g, '\n').trim();
  if (!text) return false;
  const localPathMatches = text.match(/(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/[^\s"'`<>]+/g) ?? [];
  const redactedPathMatches = text.match(/\[(?:local-path|redacted-path)\]\/[^\s"'`<>]+/gi) ?? [];
  const pathCount = localPathMatches.length + redactedPathMatches.length;
  if (pathCount < 4) return false;
  const withoutPaths = text
    .replace(/(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/[^\s"'`<>]+/g, ' ')
    .replace(/\[(?:local-path|redacted-path)\]\/[^\s"'`<>]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutPaths.length < 80 || pathCount >= 8;
}

function latestUserFacingProgressModel(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const model = progressModelFromEvent(event);
    if (model && !isTransportProgressModel(model)) return sanitizeUserFacingProgressModel(model);
  }
  return undefined;
}

function sanitizeUserFacingProgressModel(model: ProcessProgressModel): ProcessProgressModel {
  const next = { ...model };
  if (next.lastEvent && isRuntimeDiagnosticProgressText(`${next.lastEvent.label} ${next.lastEvent.detail}`)) {
    next.lastEvent = undefined;
  }
  if (/backend[-_\s]?waiting|silent[-_\s]?stream/i.test(next.reason ?? '')
    && /workspace activity|工作区活动/i.test(`${next.title} ${next.waitingFor ?? ''}`)) {
    next.nextStep = undefined;
  }
  return next;
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

function isRuntimeDiagnosticProgressText(value: string | undefined) {
  const text = value ?? '';
  return /\bcodex runtime\b/i.test(text) && /\b(?:provider|model|profile|workspace|runtime)\b/i.test(text)
    || /\b(?:provider|model|profile)\s+[\w./:-]+/i.test(text) && /\/(?:Applications|Users|Volumes|private|var|tmp)\//.test(text)
    || /\/(?:Applications|Users|Volumes|private|var|tmp)\/[^\s"'`<>]+/.test(text) && /\b(?:workspace|runtime|codex)\b/i.test(text);
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
  const runtimeNotice = runtimeReadinessNotice(runtimeHealth, locale);
  if (runtimeNotice) {
    return {
      ok: true,
      severity: runtimeNotice.severity,
      message: runtimeNotice.message,
    };
  }
  const providerPreflightNotice = runtimeProviderPreflightReadinessNotice(runtimeHealth, locale);
  if (providerPreflightNotice) {
    return {
      ok: true,
      severity: providerPreflightNotice.severity,
      message: providerPreflightNotice.message,
    };
  }
  const providerNotice = providerReadinessNoticeFromConfig(config);
  if (!providerNotice.ready) {
    const assistantNotice = assistantConnectionSetupNotice(providerNotice.recoverAction, locale);
    return {
      ok: true,
      severity: 'warning' as const,
      message: assistantNotice,
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

function assistantConnectionSetupNotice(recoverAction: string | undefined, locale?: SupportedLocale) {
  const action = recoverAction ?? '';
  if (/Model, Base URL, or API Key/i.test(action)) {
    return chatText(locale, {
      'zh-CN': 'Assistant 连接需要设置。请在设置中填写模型、连接 URL 或凭据。',
      'en-US': 'Assistant connection needs setup. Set a model, connection URL, or credential in Settings.',
    });
  }
  if (/Base URL/i.test(action)) {
    return chatText(locale, {
      'zh-CN': 'Assistant 连接需要设置。请在设置中填写连接 URL。',
      'en-US': 'Assistant connection needs setup. Set the connection URL in Settings.',
    });
  }
  if (/API Key/i.test(action)) {
    return chatText(locale, {
      'zh-CN': 'Assistant 连接需要设置。请在设置中填写凭据。',
      'en-US': 'Assistant connection needs setup. Set the credential in Settings.',
    });
  }
  return chatText(locale, {
    'zh-CN': 'Assistant 连接需要设置。请在设置中完成连接配置。',
    'en-US': 'Assistant connection needs setup. Complete the connection settings.',
  });
}

function runtimeProviderPreflightReadinessNotice(runtimeHealth?: RuntimeHealthItem[], locale?: SupportedLocale) {
  const model = runtimeHealth?.find((item) => item.id === 'model' && item.source === 'runtime-provider-preflight');
  if (!model || model.status === 'online') return undefined;
  return {
    severity: 'warning' as const,
    message: chatText(locale, {
      'zh-CN': 'Assistant 连接预检需要处理。长任务前请在设置中检查连接状态。',
      'en-US': 'Assistant connection preflight needs attention. Check Settings before long runs.',
    }),
  };
}

export function runtimeReadinessIssue(runtimeHealth?: RuntimeHealthItem[], locale?: SupportedLocale) {
  if (!runtimeHealth?.length) return undefined;
  const required = runtimeHealth.filter((item) => item.id === 'workspace' || item.id === 'codex-runtime');
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

export function runtimeReadinessNotice(runtimeHealth?: RuntimeHealthItem[], locale?: SupportedLocale) {
  if (!runtimeHealth?.length) return undefined;
  const required = runtimeHealth.filter((item) => item.id === 'workspace' || item.id === 'codex-runtime');
  const checking = required.find((item) => item.status === 'checking');
  if (!checking) return undefined;
  return {
    severity: 'info' as const,
    message: chatText(locale, {
      'zh-CN': `正在检查 ${checking.label}：${checking.detail}。可以先发送；若服务不可用会在运行中提示修复。`,
      'en-US': `Checking ${checking.label}: ${checking.detail}. You can send now; SciForge will surface a repair hint if the service is unavailable.`,
    }),
  };
}
