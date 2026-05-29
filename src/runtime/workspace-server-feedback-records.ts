import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, safeName } from './server/http.js';

export function scrubFeedbackError(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}\b/g, '[redacted-github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/\/Users\/[^/\s]+/g, '[redacted-user-home]')
    .replace(/\/Applications\/workspace\/[^\s]+/g, '[redacted-workspace-path]')
    .slice(0, 1200);
}

export function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

export function normalizeRepairTestResults(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    name: typeof item.name === 'string' ? item.name : undefined,
    command: typeof item.command === 'string' ? item.command : undefined,
    status: item.status === 'passed' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'skipped',
    summary: typeof item.summary === 'string' ? item.summary : undefined,
    outputRef: typeof item.outputRef === 'string' ? item.outputRef : undefined,
  }));
}

export function normalizeRepairTerminalMirror(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(isRecord).map((entry) => ({
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
    stream: entry.stream === 'stdout' || entry.stream === 'stderr' || entry.stream === 'event' ? entry.stream : undefined,
    text: typeof entry.text === 'string' ? entry.text : '',
  })).filter((entry) => entry.timestamp && entry.stream && entry.text);
  return entries.length ? entries.slice(-500) : undefined;
}

export function digestString(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const digest = value[key];
  return typeof digest === 'string' && digest.trim() ? digest.trim() : undefined;
}

export function normalizeRepairHumanVerification(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    status: value.status === 'verified' || value.status === 'rejected' || value.status === 'pending' || value.status === 'not-run'
      || value.status === 'required' || value.status === 'not-required' || value.status === 'passed' || value.status === 'failed'
      ? value.status
      : undefined,
    verifier: typeof value.verifier === 'string' ? value.verifier : undefined,
    conclusion: typeof value.conclusion === 'string' ? value.conclusion : undefined,
    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.filter((item): item is string => typeof item === 'string') : undefined,
    verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : undefined,
    reviewer: typeof value.reviewer === 'string' ? value.reviewer : undefined,
    note: typeof value.note === 'string' ? value.note : undefined,
  };
}

export function normalizeRepairRefs(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    commitSha: typeof value.commitSha === 'string' ? value.commitSha : undefined,
    commitUrl: typeof value.commitUrl === 'string' ? value.commitUrl : undefined,
    prUrl: typeof value.prUrl === 'string' ? value.prUrl : undefined,
    patchRef: typeof value.patchRef === 'string' ? value.patchRef : undefined,
  };
}

export function normalizeRepairInstanceRef(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    appUrl: typeof value.appUrl === 'string' ? value.appUrl : undefined,
    workspaceWriterUrl: typeof value.workspaceWriterUrl === 'string' ? value.workspaceWriterUrl : undefined,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : undefined,
  };
}

export function feedbackCommentSeedFromBody(issueId: string, body: Record<string, unknown>) {
  const issueBundle = isRecord(body.issueBundle) ? body.issueBundle : undefined;
  const rawComment = isRecord(body.comment)
    ? body.comment
    : isRecord(body.feedbackComment)
      ? body.feedbackComment
      : isRecord(issueBundle?.comment)
        ? issueBundle.comment
        : undefined;
  if (!rawComment) return undefined;
  const now = new Date().toISOString();
  return {
    ...rawComment,
    id: typeof rawComment.id === 'string' && rawComment.id.trim() ? rawComment.id.trim() : issueId,
    status: typeof rawComment.status === 'string' ? rawComment.status : 'open',
    createdAt: typeof rawComment.createdAt === 'string' ? rawComment.createdAt : now,
    updatedAt: now,
  };
}

export function appendStateRecord(state: Record<string, unknown>, key: string, record: Record<string, unknown>) {
  const records = Array.isArray(state[key]) ? state[key].filter(isRecord) : [];
  return {
    ...state,
    [key]: [record, ...records.filter((item) => item.id !== record.id)].slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
}

export async function persistFeedbackRecord(root: string, folder: string, id: string, record: Record<string, unknown>) {
  const dir = join(root, '.sciforge', 'feedback', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${safeName(id)}.json`), JSON.stringify(record, null, 2));
}

export function normalizeFeedbackBundleId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('feedback comment id is required');
  const normalized = safeName(trimmed).replace(/^\.+/, '');
  if (normalized && normalized !== '.' && normalized !== '..') return normalized;
  return `feedback-${createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`;
}

export function toPosixPath(value: string) {
  return value.replace(/\\/g, '/');
}

export function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function handoffFeedbackComments(state: Record<string, unknown>) {
  const comments = Array.isArray(state.feedbackComments) ? state.feedbackComments.filter(isRecord) : [];
  return comments
    .filter((comment) => {
      const status = typeof comment.status === 'string' ? comment.status : 'open';
      return !['fixed', 'wont-fix'].includes(status);
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

export function findFeedbackComment(state: Record<string, unknown>, issueId: string) {
  return handoffFeedbackComments(state).find((comment) => comment.id === issueId || String(comment.githubIssueNumber || '') === issueId);
}

export function feedbackIssueSummary(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const request = feedbackRequestForComment(state, comment);
  const github = githubMetadataForComment(state, comment);
  const runtime = isRecord(comment.runtime) ? comment.runtime : {};
  return {
    schemaVersion: 1,
    id: String(comment.id || ''),
    kind: 'feedback-comment',
    title: request && typeof request.title === 'string' && request.title.trim()
      ? request.title
      : compactString(typeof comment.comment === 'string' ? comment.comment : '', 80) || 'SciForge feedback issue',
    status: typeof comment.status === 'string' ? comment.status : 'open',
    priority: typeof comment.priority === 'string' ? comment.priority : 'normal',
    tags: Array.isArray(comment.tags) ? comment.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : '',
    updatedAt: typeof comment.updatedAt === 'string' ? comment.updatedAt : '',
    comment: compactString(typeof comment.comment === 'string' ? comment.comment : '', 240),
    requestId: typeof comment.requestId === 'string' ? comment.requestId : request && typeof request.id === 'string' ? request.id : undefined,
    runtime: {
      page: typeof runtime.page === 'string' ? runtime.page : '',
      scenarioId: typeof runtime.scenarioId === 'string' ? runtime.scenarioId : '',
      sessionId: typeof runtime.sessionId === 'string' ? runtime.sessionId : undefined,
      activeRunId: typeof runtime.activeRunId === 'string' ? runtime.activeRunId : undefined,
    },
    screenshot: screenshotMetadataForComment(comment),
    github,
  };
}

export function feedbackRequestForComment(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const requests = Array.isArray(state.feedbackRequests) ? state.feedbackRequests.filter(isRecord) : [];
  const requestId = typeof comment.requestId === 'string' ? comment.requestId : '';
  return requests.find((request) => request.id === requestId || (Array.isArray(request.feedbackIds) && request.feedbackIds.includes(comment.id)));
}

export function githubMetadataForComment(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const issueNumber = typeof comment.githubIssueNumber === 'number' ? comment.githubIssueNumber : undefined;
  const synced = Array.isArray(state.githubSyncedOpenIssues)
    ? state.githubSyncedOpenIssues.filter(isRecord).find((issue) => issue.number === issueNumber || issue.htmlUrl === comment.githubIssueUrl)
    : undefined;
  if (!issueNumber && typeof comment.githubIssueUrl !== 'string' && !synced) return undefined;
  return {
    issueNumber,
    issueUrl: typeof comment.githubIssueUrl === 'string' ? comment.githubIssueUrl : synced && typeof synced.htmlUrl === 'string' ? synced.htmlUrl : undefined,
    openIssue: synced,
  };
}

export function screenshotMetadataForComment(comment: Record<string, unknown>) {
  const screenshot = isRecord(comment.screenshot) ? comment.screenshot : undefined;
  if (!screenshot && typeof comment.screenshotRef !== 'string') return undefined;
  return {
    screenshotRef: typeof comment.screenshotRef === 'string' ? comment.screenshotRef : undefined,
    schemaVersion: screenshot?.schemaVersion,
    mediaType: typeof screenshot?.mediaType === 'string' ? screenshot.mediaType : undefined,
    width: typeof screenshot?.width === 'number' ? screenshot.width : undefined,
    height: typeof screenshot?.height === 'number' ? screenshot.height : undefined,
    capturedAt: typeof screenshot?.capturedAt === 'string' ? screenshot.capturedAt : undefined,
    targetRect: isRecord(screenshot?.targetRect) ? screenshot?.targetRect : undefined,
    includeForAgent: typeof screenshot?.includeForAgent === 'boolean' ? screenshot.includeForAgent : undefined,
    note: typeof screenshot?.note === 'string' ? screenshot.note : undefined,
    hasDataUrl: typeof screenshot?.dataUrl === 'string' && screenshot.dataUrl.length > 0,
    dataUrlBytes: typeof screenshot?.dataUrl === 'string' ? Buffer.byteLength(screenshot.dataUrl, 'utf8') : undefined,
  };
}

export function repairRecordsForIssue(state: Record<string, unknown>, key: string, issueId: string) {
  return (Array.isArray(state[key]) ? state[key].filter(isRecord) : [])
    .filter((record) => record.issueId === issueId)
    .sort((left, right) => String(right.startedAt || right.completedAt || '').localeCompare(String(left.startedAt || left.completedAt || '')));
}

export function compactString(value: string, limit: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, Math.max(0, limit - 3))}...` : compact;
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())));
}
