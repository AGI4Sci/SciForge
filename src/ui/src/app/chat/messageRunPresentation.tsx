import type { SciForgeMessage, SciForgeRun, SciForgeSession } from '../../domain';
import { Badge, type BadgeVariant } from '../uiPrimitives';
import { conversationProjectionForSession } from '../conversation-projection-view-model';

type VerificationTagModel = {
  label: string;
  title: string;
  variant: BadgeVariant;
};

export function RunVerificationTag({ session, runId }: { session: SciForgeSession; runId?: string }) {
  const model = runId ? verificationTagForRun(session, runId) : undefined;
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
  return value.replace(/^运行中引导：/, '').trim();
}

function verificationTagForRun(session: SciForgeSession, runId: string): VerificationTagModel | undefined {
  const run = session.runs.find((item) => item.id === runId);
  const projection = conversationProjectionForSession(session, run);
  const projectionVerdict = projection?.verificationState?.verdict ?? projection?.verificationState?.status;
  if (projection && projectionVerdict) {
    return {
      label: `Verification: ${verificationVerdictLabel(projectionVerdict)}`,
      title: projection.verificationState?.verifierRef ?? `Projection verification ${projectionVerdict}`,
      variant: verificationVerdictVariant(projectionVerdict),
    };
  }
  return undefined;
}

function verificationVerdictLabel(verdict: string) {
  const labels: Record<string, string> = {
    pass: '已验证',
    fail: '未通过',
    uncertain: '不确定',
    'needs-human': '需人工核验',
    unverified: '未验证',
  };
  return labels[verdict] ?? verdict;
}

function verificationVerdictVariant(verdict: string): BadgeVariant {
  if (verdict === 'pass') return 'success';
  if (verdict === 'fail') return 'danger';
  if (verdict === 'needs-human' || verdict === 'uncertain') return 'warning';
  return 'muted';
}
