import type { SciForgeMessage, SciForgeRun } from '../../domain';
import { Badge, type BadgeVariant } from '../uiPrimitives';

type VerificationTagModel = {
  label: string;
  title: string;
  variant: BadgeVariant;
};

export function RunVerificationTag({ runs, runId }: { runs: SciForgeRun[]; runId?: string }) {
  const model = runId ? verificationTagForRun(runs, runId) : undefined;
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

function verificationTagForRun(runs: SciForgeRun[], runId: string): VerificationTagModel | undefined {
  const run = runs.find((item) => item.id === runId);
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const result = firstVerificationResult(raw);
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const displayVerification = isRecord(displayIntent?.verification) ? displayIntent.verification : undefined;
  const verdict = stringField(result?.verdict) ?? stringField(displayVerification?.verdict);
  if (!verdict) return undefined;
  const critique = stringField(result?.critique) ?? stringField(result?.reason);
  return {
    label: `Verification: ${verificationVerdictLabel(verdict)}`,
    title: critique || `Verification ${verdict}`,
    variant: verificationVerdictVariant(verdict),
  };
}

function firstVerificationResult(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const direct = raw?.verificationResult;
  if (isRecord(direct)) return direct;
  const list = Array.isArray(raw?.verificationResults) ? raw.verificationResults : [];
  return list.find(isRecord);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
