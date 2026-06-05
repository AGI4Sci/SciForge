import { relative, resolve, sep } from 'node:path';
import { appendRepairTerminalMirrorEntry } from './repair-handoff-runner.js';
import { isRecord, safeName } from './server/http.js';
import { createCodexAppServerRuntimeAdapter } from './codex/codex-runtime-adapter.js';
import { RUNTIME_PROFILE } from '../../packages/backend/src/runtime-home.js';
import {
  appendStateRecord,
  findFeedbackComment,
  firstNonEmptyString,
  persistFeedbackRecord,
  recordField,
  stringField,
} from './workspace-server-feedback-records.js';

export interface RunFeedbackRepairGuidanceInput {
  root: string;
  issueId: string;
  body: Record<string, unknown>;
  readWorkspaceStateFile(root: string): Promise<Record<string, unknown>>;
  writeWorkspaceStateFile(root: string, state: Record<string, unknown>): Promise<void>;
  prepareRuntimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv>;
  resolveRepairTerminalMirrorRef(root: string, ref: string): string;
}

export async function runFeedbackRepairGuidance(input: RunFeedbackRepairGuidanceInput) {
  const { root, issueId, body } = input;
  let state = await input.readWorkspaceStateFile(root);
  const comment = findFeedbackComment(state, issueId);
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const repairRunId = stringField(body.repairRunId);
  if (!repairRunId) throw new Error('repairRunId is required');
  const message = scrubGuidanceText(stringField(body.message));
  if (!message) throw new Error('guidance message is required');
  const now = new Date().toISOString();
  const run = findRepairRunForGuidance(state, canonicalIssueId, repairRunId);
  const result = findRepairResultForGuidance(state, canonicalIssueId, body.repairResultId)
    ?? findRepairResultByRunId(state, canonicalIssueId, repairRunId);
  const runMetadata = recordField(run?.metadata);
  const resultMetadata = recordField(result?.metadata);
  const agentServerRun = recordField(resultMetadata?.agentServerRun) ?? recordField(runMetadata?.agentServerRun);
  const resultRefs = recordField(result?.refs);
  const terminalMirrorRef = firstNonEmptyString(
    stringField(body.terminalMirrorRef),
    stringField(result?.terminalMirrorRef),
    stringField(run?.terminalMirrorRef),
    stringField(resultMetadata?.terminalMirrorRef),
    stringField(runMetadata?.terminalMirrorRef),
    stringField(resultRefs?.terminalMirrorRef),
  );
  const terminalMirrorPath = terminalMirrorRef ? input.resolveRepairTerminalMirrorRef(root, terminalMirrorRef) : undefined;
  const codexSessionId = firstNonEmptyString(
    stringField(body.codexSessionId),
    stringField(agentServerRun?.codexSessionId),
    stringField(agentServerRun?.nativeSessionId),
    stringField(resultMetadata?.codexSessionId),
    stringField(runMetadata?.codexSessionId),
  );
  const worktreeRef = firstNonEmptyString(
    stringField(resultMetadata?.isolatedWorktreePath),
    stringField(runMetadata?.isolatedWorktreePath),
    stringField(resultRefs?.worktreePath),
  );
  const guidanceId = `repair-guidance-${safeName(repairRunId)}-${Date.now()}`;
  let guidance: Record<string, unknown> = {
    schemaVersion: 1,
    id: guidanceId,
    issueId: canonicalIssueId,
    repairRunId,
    repairResultId: result && typeof result.id === 'string' ? result.id : stringField(body.repairResultId),
    status: 'recorded',
    requestedAt: now,
    requestedBy: stringField(body.requestedBy) || 'feedback-inbox',
    message,
    terminalMirrorRef: terminalMirrorPath ?? terminalMirrorRef,
    codexSessionId,
    metadata: {
      source: 'feedback-inbox-guidance',
      runtimeProfile: firstNonEmptyString(stringField(resultMetadata?.runtimeProfile), stringField(runMetadata?.runtimeProfile)),
      resumeAvailable: Boolean(codexSessionId && worktreeRef),
    },
  };
  state = await persistFeedbackRepairGuidance(root, input, state, guidance);
  if (terminalMirrorPath) {
    await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'event', `Feedback Inbox guidance recorded for ${repairRunId}: ${message}`);
  }
  if (!codexSessionId || !worktreeRef) {
    guidance = {
      ...guidance,
      status: 'recorded',
      responseSummary: codexSessionId
        ? 'Guidance was recorded; isolated repair worktree metadata is unavailable, so native resume was not dispatched.'
        : 'Guidance was recorded; no native Runtime Codex session id is available yet.',
      metadata: {
        ...(recordField(guidance.metadata) ?? {}),
        resumeAvailable: false,
        resumeBlockedReason: codexSessionId ? 'missing-isolated-worktree' : 'missing-codex-session-id',
      },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
    await persistFeedbackRepairGuidance(root, input, state, guidance);
    return guidance;
  }
  let worktreePath = '';
  try {
    worktreePath = resolveRepairWorktreeRef(root, worktreeRef);
  } catch (err) {
    guidance = {
      ...guidance,
      status: 'blocked',
      responseSummary: `Guidance resume blocked: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { ...(recordField(guidance.metadata) ?? {}), resumeAvailable: false, resumeBlockedReason: 'invalid-isolated-worktree' },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
    await persistFeedbackRepairGuidance(root, input, state, guidance);
    return guidance;
  }
  try {
    const runtimeCodexEnv = await input.prepareRuntimeCodexEnvFromLocalConfig();
    const adapter = createCodexAppServerRuntimeAdapter({ env: runtimeCodexEnv });
    const turn = await adapter.startTurn({
      commandText: repairGuidancePrompt({ issueId: canonicalIssueId, repairRunId, message }),
      workspacePath: worktreePath,
      commandId: `repair-guidance-${repairRunId}-${Date.now()}`,
      attemptId: `repair-guidance-${repairRunId}-attempt-${Date.now()}`,
      profile: firstNonEmptyString(stringField(resultMetadata?.runtimeProfile), stringField(runMetadata?.runtimeProfile)) || RUNTIME_PROFILE,
      codexSessionId,
      allowOpenAiRuntime: false,
      guiExtension: { enabled: false },
    });
    let eventCount = 0;
    let status = 'resumed';
    for await (const event of turn.events) {
      eventCount += 1;
      if (terminalMirrorPath) {
        const eventRecord = recordField(event) ?? {};
        const stream = eventRecord.type === 'failed' || eventRecord.type === 'cancelled' ? 'stderr' : 'event';
        await appendRepairTerminalMirrorEntry(terminalMirrorPath, stream, terminalTextForGuidanceEvent(eventRecord));
      }
      const eventType = recordField(event)?.type;
      if (eventType === 'failed' || eventType === 'cancelled') status = 'blocked';
    }
    guidance = {
      ...guidance,
      status: status === 'blocked' ? 'blocked' : 'resumed',
      eventCount,
      responseSummary: status === 'blocked'
        ? 'Runtime Codex guidance resume ended with a blocked/failed event.'
        : 'Runtime Codex guidance resume completed.',
      metadata: {
        ...(recordField(guidance.metadata) ?? {}),
        resumeAvailable: true,
        isolatedWorktreePath: worktreePath,
        turnId: turn.turnId,
        attemptId: turn.attemptId,
      },
    };
  } catch (err) {
    guidance = {
      ...guidance,
      status: 'blocked',
      responseSummary: `Runtime Codex guidance resume failed closed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { ...(recordField(guidance.metadata) ?? {}), resumeAvailable: true, isolatedWorktreePath: worktreePath },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
  }
  await persistFeedbackRepairGuidance(root, input, state, guidance);
  return guidance;
}

async function persistFeedbackRepairGuidance(
  root: string,
  deps: Pick<RunFeedbackRepairGuidanceInput, 'writeWorkspaceStateFile'>,
  state: Record<string, unknown>,
  guidance: Record<string, unknown>,
) {
  const next = appendStateRecord(state, 'feedbackRepairGuidance', guidance);
  await persistFeedbackRecord(root, 'repair-guidance', String(guidance.id), guidance);
  await deps.writeWorkspaceStateFile(root, next);
  return next;
}

function findRepairRunForGuidance(state: Record<string, unknown>, issueId: string, repairRunId: string) {
  const runs = Array.isArray(state.feedbackRepairRuns) ? state.feedbackRepairRuns.filter(isRecord) : [];
  return runs.find((run) => run.issueId === issueId && run.id === repairRunId)
    ?? runs.filter((run) => run.issueId === issueId)
      .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))[0];
}

function findRepairResultForGuidance(state: Record<string, unknown>, issueId: string, resultId: unknown) {
  const results = Array.isArray(state.feedbackRepairResults) ? state.feedbackRepairResults.filter(isRecord) : [];
  const matching = results.filter((result) => result.issueId === issueId);
  if (typeof resultId === 'string' && resultId.trim()) return matching.find((result) => result.id === resultId.trim());
  return matching.sort((left, right) => Date.parse(String(right.completedAt || '')) - Date.parse(String(left.completedAt || '')))[0];
}

function findRepairResultByRunId(state: Record<string, unknown>, issueId: string, repairRunId: string) {
  const results = Array.isArray(state.feedbackRepairResults) ? state.feedbackRepairResults.filter(isRecord) : [];
  return results.find((result) => result.issueId === issueId && result.repairRunId === repairRunId);
}

function resolveRepairWorktreeRef(root: string, ref: string) {
  const raw = ref.trim();
  if (!raw) throw new Error('isolated repair worktree ref is required');
  const candidate = resolve(raw.startsWith('/') ? raw : resolve(root, raw));
  const allowedRoots = [
    resolve(root, '.sciforge', 'repair-worktrees'),
    resolve(process.cwd(), '.sciforge', 'repair-worktrees'),
  ];
  if (!allowedRoots.some((allowedRoot) => isInsideOrSamePath(candidate, allowedRoot))) {
    throw new Error('isolated repair worktree ref must stay inside .sciforge/repair-worktrees');
  }
  return candidate;
}

function repairGuidancePrompt(input: { issueId: string; repairRunId: string; message: string }) {
  return [
    `Continue SciForge repair run ${input.repairRunId} for feedback issue ${input.issueId}.`,
    'Use the existing native Codex session context and the current isolated repair worktree.',
    'Treat the following text as human guidance from Feedback Inbox, not as a new issue bundle:',
    '',
    input.message,
    '',
    'Preserve feedback records, screenshots, repair log evidence, repair audit, and GitHub sync state.',
    'Do not commit, push, open a PR, merge, rewrite ignored secret config, or delete audit/evidence files.',
    'If the guidance changes the repair, update the repair plan or tests inside the isolated repair worktree and keep the patch scoped.',
  ].join('\n');
}

function terminalTextForGuidanceEvent(event: Record<string, unknown>) {
  const type = stringField(event.type) || 'event';
  const status = stringField(event.status);
  const message = stringField(event.message) || stringField(event.text) || stringField(event.summary);
  const exitCode = typeof event.exitCode === 'number' || event.exitCode === null ? ` exit=${event.exitCode}` : '';
  return [type, status ? `status=${status}` : '', message, exitCode].filter(Boolean).join(' ');
}

function scrubGuidanceText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/\/Users\/[^/\s]+/g, '[redacted-user-home]')
    .replace(/\/Applications\/workspace\/[^\s]+/g, '[redacted-workspace-path]')
    .replace(/\s+$/g, '')
    .slice(0, 2000);
}

function isInsideOrSamePath(candidate: string, parent: string) {
  const rel = candidate === parent ? '' : candidate.startsWith(`${parent}/`) ? candidate.slice(parent.length + 1) : relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}
