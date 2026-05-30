import type { SciForgeMessage, SciForgeRun, SciForgeSession } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import { Badge, type BadgeVariant } from '../uiPrimitives';
import { conversationProjectionForSession } from '../conversation-projection-view-model';
import { chatText } from './chatI18n';

type VerificationTagModel = {
  label: string;
  title: string;
  variant: BadgeVariant;
};

export function RunVerificationTag({ session, runId, locale }: { session: SciForgeSession; runId?: string; locale?: SupportedLocale }) {
  const model = runId ? verificationTagForRun(session, runId, locale) : undefined;
  if (!model) return null;
  return <span title={model.title}><Badge variant={model.variant}>{model.label}</Badge></span>;
}

export function runIdForMessage(
  message: SciForgeMessage,
  index: number,
  messages: SciForgeMessage[],
  runs: SciForgeRun[],
) {
  if (!runs.length || message.id.startsWith('seed')) return undefined;
  if (message.role === 'user') {
    const normalizedContent = normalizeRunPrompt(message.content);
    const matchingRuns = runs.filter((run) => normalizeRunPrompt(run.prompt) === normalizedContent);
    const messageTime = Date.parse(message.createdAt);
    const nextUserMessage = messages
      .slice(index + 1)
      .find((item) => !item.id.startsWith('seed') && item.role === 'user');
    const nextUserTime = nextUserMessage ? Date.parse(nextUserMessage.createdAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(messageTime)) {
      const runInTurnWindow = matchingRuns.find((run) => {
        const runTime = Date.parse(run.createdAt);
        return Number.isFinite(runTime) && runTime >= messageTime && runTime < nextUserTime;
      });
      if (runInTurnWindow) return runInTurnWindow.id;
    }
    const promptOccurrence = messages
      .slice(0, index + 1)
      .filter((item) => !item.id.startsWith('seed') && item.role === 'user' && normalizeRunPrompt(item.content) === normalizedContent)
      .length - 1;
    return matchingRuns[promptOccurrence]?.id ?? matchingRuns.at(-1)?.id;
  }
  if (message.role !== 'scenario') return undefined;
  const responseIndex = messages
    .slice(0, index + 1)
    .filter((item) => !item.id.startsWith('seed') && item.role === 'scenario')
    .length - 1;
  return runs[responseIndex]?.id;
}

function normalizeRunPrompt(value: string) {
  return value
    .replace(/^(?:Queued while running|Running note|运行中引导)[:：]\s*/i, '')
    .trim();
}

function verificationTagForRun(session: SciForgeSession, runId: string, locale?: SupportedLocale): VerificationTagModel | undefined {
  const displayLocale = locale ?? 'zh-CN';
  const run = session.runs.find((item) => item.id === runId);
  const projection = conversationProjectionForSession(session, run);
  const projectionVerdict = projection?.verificationState?.verdict ?? projection?.verificationState?.status;
  if (projection && projectionVerdict) {
    const label = verificationVerdictLabel(projectionVerdict, displayLocale);
    if (!label) return undefined;
    return {
      label: chatText(displayLocale, { 'zh-CN': `验证：${label}`, 'en-US': `Check: ${label}` }),
      title: verificationVerdictTitle(label, projection.verificationState?.verifierRef, displayLocale),
      variant: verificationVerdictVariant(projectionVerdict),
    };
  }
  return undefined;
}

function verificationVerdictLabel(verdict: string, locale?: SupportedLocale) {
  const labels: Record<string, Record<SupportedLocale, string>> = {
    pass: { 'zh-CN': '已验证', 'en-US': 'verified' },
    fail: { 'zh-CN': '未通过', 'en-US': 'failed' },
    uncertain: { 'zh-CN': '不确定', 'en-US': 'uncertain' },
    'needs-human': { 'zh-CN': '需人工核验', 'en-US': 'needs review' },
    unverified: { 'zh-CN': '未验证', 'en-US': 'unverified' },
  };
  return labels[verdict] ? chatText(locale, labels[verdict]) : undefined;
}

function verificationVerdictTitle(label: string, verifierRef?: string, locale?: SupportedLocale) {
  return verifierRef && !isInternalVerificationRef(verifierRef)
    ? chatText(locale, { 'zh-CN': `验证状态：${label} · ${verifierRef}`, 'en-US': `Verification status: ${label} · ${verifierRef}` })
    : chatText(locale, { 'zh-CN': `验证状态：${label}`, 'en-US': `Verification status: ${label}` });
}

function isInternalVerificationRef(value: string) {
  return /^(native-message|codex-command(?:-|$)|runtime|raw|trace|audit)|\b(?:Codex|Runtime|ConversationProjection|raw JSONL)\b/i.test(value);
}

function verificationVerdictVariant(verdict: string): BadgeVariant {
  if (verdict === 'pass') return 'success';
  if (verdict === 'fail') return 'danger';
  if (verdict === 'needs-human' || verdict === 'uncertain') return 'warning';
  return 'muted';
}
