import {
  makeId,
  nowIso,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairResultRecord,
  type FeedbackRepairRunRecord,
  type FeedbackRepairStatus,
  type GithubSyncedOpenIssueRecord,
  type SciForgeWorkspaceState,
} from '../domain';
import {
  createUserFeedbackConvergence,
  type UserFeedbackConvergence,
} from '@sciforge-ui/runtime-contract/user-feedback-convergence';
import type {
  FailureSignatureRegistry,
  TaskRunCard,
} from '@sciforge-ui/runtime-contract/task-run-card';

const FEEDBACK_COMMENT_LIMIT = 500;
const FEEDBACK_REQUEST_LIMIT = 80;

type FeedbackRequestRecord = NonNullable<SciForgeWorkspaceState['feedbackRequests']>[number];

export interface FeedbackRepairAuditViewModel {
  issueId: string;
  status: FeedbackRepairStatus | 'not-started';
  badge: 'info' | 'success' | 'warning' | 'danger' | 'muted';
  label: string;
  headline: string;
  detail: string;
  executorInstance?: string;
  latestRunStatus: FeedbackRepairRunRecord['status'] | 'not-started';
  latestResultVerdict?: FeedbackRepairResultRecord['verdict'];
  changedFiles: string[];
  diffRef?: string;
  commit?: string;
  refs?: FeedbackRepairResultRecord['refs'];
  tests: Array<{ command: string; status: 'passed' | 'failed' | 'unknown'; outputRef?: string; summary?: string }>;
  summary?: string;
  humanVerification?: string;
  githubSyncStatus: NonNullable<FeedbackRepairResultRecord['githubSyncStatus']> | 'not-synced';
  githubCommentUrl?: string;
  missingTestEvidence: boolean;
  testsPassed: boolean;
  needsHumanVerification: boolean;
  githubSynced: boolean;
  latestRun?: FeedbackRepairRunRecord;
  latestResult?: FeedbackRepairResultRecord;
}

export function addFeedbackCommentToWorkspace(
  state: SciForgeWorkspaceState,
  comment: FeedbackCommentRecord,
  limit = FEEDBACK_COMMENT_LIMIT,
): SciForgeWorkspaceState {
  return {
    ...state,
    feedbackComments: [comment, ...(state.feedbackComments ?? [])].slice(0, limit),
  };
}

export function updateFeedbackCommentStatus(
  state: SciForgeWorkspaceState,
  ids: string[],
  status: FeedbackCommentStatus,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? { ...comment, status, updatedAt }
      : comment),
  };
}

export function deleteFeedbackCommentsFromWorkspace(
  state: SciForgeWorkspaceState,
  ids: string[],
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).filter((comment) => !selected.has(comment.id)),
    feedbackRequests: (state.feedbackRequests ?? []).map((request) => ({
      ...request,
      feedbackIds: request.feedbackIds.filter((id) => !selected.has(id)),
    })),
  };
}

export function createFeedbackRequestFromComments(
  state: SciForgeWorkspaceState,
  ids: string[],
  title: string,
  options: {
    requestId?: string;
    createdAt?: string;
    requestLimit?: number;
  } = {},
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const createdAt = options.createdAt ?? nowIso();
  const requestId = options.requestId ?? makeId('request');
  const request = buildFeedbackRequest(state.feedbackComments ?? [], ids, title, requestId, createdAt);
  return {
    ...state,
    feedbackRequests: [request, ...(state.feedbackRequests ?? [])].slice(0, options.requestLimit ?? FEEDBACK_REQUEST_LIMIT),
    feedbackComments: (state.feedbackComments ?? []).map((comment) => ids.includes(comment.id)
      ? { ...comment, status: comment.status === 'open' ? 'triaged' : comment.status, requestId, updatedAt: createdAt }
      : comment),
  };
}

export function createFeedbackConvergenceFromComments(
  comments: FeedbackCommentRecord[],
  options: {
    createdAt?: string;
    source?: string;
    taskRunCards?: TaskRunCard[];
    failureSignatureRegistry?: FailureSignatureRegistry;
  } = {},
): UserFeedbackConvergence {
  return createUserFeedbackConvergence({
    createdAt: options.createdAt,
    source: options.source ?? 'feedback-workspace',
    taskRunCards: options.taskRunCards,
    failureSignatureRegistry: options.failureSignatureRegistry,
    signals: comments.map((comment) => ({
      id: comment.id,
      text: comment.comment,
      priority: comment.priority,
      status: comment.status,
      tags: comment.tags,
      page: comment.runtime.page,
      scenarioId: comment.runtime.scenarioId,
      sessionId: comment.runtime.sessionId,
      activeRunId: comment.runtime.activeRunId,
      sourceRefs: feedbackSourceRefs(comment),
    })),
  });
}

export function replaceGithubSyncedOpenIssuesInWorkspace(
  state: SciForgeWorkspaceState,
  issues: GithubSyncedOpenIssueRecord[],
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  return {
    ...state,
    githubSyncedOpenIssues: issues,
    updatedAt,
  };
}

export function upsertFeedbackRepairRunInWorkspace(
  state: SciForgeWorkspaceState,
  run: FeedbackRepairRunRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairRuns ?? [];
  return {
    ...state,
    feedbackRepairRuns: [run, ...existing.filter((item) => item.id !== run.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function upsertFeedbackRepairResultInWorkspace(
  state: SciForgeWorkspaceState,
  result: FeedbackRepairResultRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairResults ?? [];
  return {
    ...state,
    feedbackRepairResults: [result, ...existing.filter((item) => item.id !== result.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function feedbackRepairAuditForIssue(
  issueId: string,
  runs: FeedbackRepairRunRecord[] = [],
  results: FeedbackRepairResultRecord[] = [],
): FeedbackRepairAuditViewModel {
  const issueRuns = runs.filter((run) => run.issueId === issueId).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const issueResults = results.filter((result) => result.issueId === issueId).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const latestRun = issueRuns[0];
  const latestResult = issueResults[0];
  const tests = normalizeRepairTests(latestResult?.tests ?? latestResult?.testResults ?? []);
  const testsPassed = tests.length > 0 && tests.every((test) => test.status === 'passed');
  const hasFailedTests = tests.some((test) => test.status === 'failed');
  const status = repairAuditStatus(latestRun, latestResult, tests);
  const missingTestEvidence = Boolean(latestResult) && latestResult?.verdict === 'fixed' && tests.length === 0;
  const humanVerification = latestResult?.humanVerification;
  const needsHumanVerification = status === 'needs-human-verification'
    || humanVerification?.status === 'required'
    || humanVerification?.status === 'pending'
    || humanVerification?.status === 'failed';
  const githubSynced = status === 'github-synced' || Boolean(latestResult?.githubCommentUrl);
  return {
    issueId,
    status,
    badge: repairAuditBadge(status, missingTestEvidence, hasFailedTests),
    label: repairAuditLabel(status),
    headline: repairAuditHeadline(status, { testsPassed, hasFailedTests, missingTestEvidence, needsHumanVerification, githubSynced }),
    detail: repairAuditDetail(latestRun, latestResult),
    executorInstance: executorInstanceLabel(latestRun, latestResult),
    latestRunStatus: latestRun?.status ?? 'not-started',
    latestResultVerdict: latestResult?.verdict,
    changedFiles: latestResult?.changedFiles ?? [],
    diffRef: latestResult?.diffRef,
    commit: latestResult?.commit,
    refs: latestResult?.refs,
    tests,
    summary: latestResult?.summary,
    humanVerification: humanVerificationLabel(humanVerification),
    githubSyncStatus: latestResult?.githubSyncStatus ?? 'not-synced',
    githubCommentUrl: latestResult?.githubCommentUrl,
    missingTestEvidence,
    testsPassed,
    needsHumanVerification,
    githubSynced,
    latestRun,
    latestResult,
  };
}

function repairAuditStatus(
  run?: FeedbackRepairRunRecord,
  result?: FeedbackRepairResultRecord,
  tests = normalizeRepairTests(result?.tests ?? result?.testResults ?? []),
): FeedbackRepairAuditViewModel['status'] {
  if (tests.some((test) => test.status === 'failed')) return 'blocked';
  if (result?.verdict === 'fixed' && tests.length === 0) return 'needs-human-verification';
  if (result?.githubCommentUrl || result?.status === 'github-synced') return 'github-synced';
  if (result?.status && result.status !== 'fixed') return result.status;
  if (result?.verdict === 'fixed') return 'fixed';
  if (result?.verdict === 'partially-fixed' || result?.verdict === 'needs-follow-up') return 'needs-human-verification';
  if (result?.verdict === 'failed' || result?.verdict === 'wont-fix') return 'blocked';
  if (!run) return 'not-started';
  if (run.status === 'running') return 'analyzing';
  return run.status;
}

function repairAuditBadge(
  status: FeedbackRepairAuditViewModel['status'],
  missingTestEvidence: boolean,
  hasFailedTests: boolean,
): FeedbackRepairAuditViewModel['badge'] {
  if (status === 'fixed' || status === 'github-synced') return missingTestEvidence || hasFailedTests ? 'warning' : 'success';
  if (status === 'blocked') return 'danger';
  if (status === 'needs-human-verification') return 'warning';
  if (status === 'not-started') return 'muted';
  return 'info';
}

function repairAuditLabel(status: FeedbackRepairAuditViewModel['status']) {
  return ({
    'not-started': '未交接',
    assigned: '已交给实例',
    analyzing: '分析中',
    patching: '改代码中',
    testing: '测试中',
    'needs-human-verification': '需人工核验',
    fixed: '已修好',
    blocked: '修复受阻',
    'github-synced': '已同步 GitHub',
  } satisfies Record<FeedbackRepairAuditViewModel['status'], string>)[status];
}

function repairAuditHeadline(
  status: FeedbackRepairAuditViewModel['status'],
  facts: {
    testsPassed: boolean;
    hasFailedTests: boolean;
    missingTestEvidence: boolean;
    needsHumanVerification: boolean;
    githubSynced: boolean;
  },
) {
  if (status === 'not-started') return '还没有 repair handoff。';
  if (status === 'assigned') return '已交给目标实例，等待它开始处理。';
  if (status === 'analyzing') return '目标实例正在处理。';
  if (status === 'patching') return '目标实例正在处理代码修改。';
  if (status === 'testing') return '目标实例正在处理测试验证。';
  if (facts.hasFailedTests) return '修复结果包含失败测试，不能视为已修好。';
  if (status === 'blocked') return '没有修好，目标实例报告阻塞。';
  if (facts.missingTestEvidence) return '缺测试证据，不能认定已修复。';
  if (facts.needsHumanVerification) return '需要人工核验。';
  if (facts.githubSynced) return facts.testsPassed ? '测试通过，已同步 GitHub。' : '已同步 GitHub，但请检查测试证据。';
  if (status === 'fixed') return facts.testsPassed ? '已修好，测试通过。' : '已修好，但测试状态需要复核。';
  return 'repair result 已写回。';
}

function repairAuditDetail(run?: FeedbackRepairRunRecord, result?: FeedbackRepairResultRecord) {
  if (result) return `${formatAuditTime(result.completedAt)} 写回：${result.summary}`;
  if (run) return `${formatAuditTime(run.startedAt)} 发起：${run.note || 'repair handoff 已记录。'}`;
  return '选择目标实例后只会记录 handoff 和审计信息，不会运行内嵌修复执行器。';
}

function executorInstanceLabel(run?: FeedbackRepairRunRecord, result?: FeedbackRepairResultRecord) {
  const executor = result?.executorInstance;
  if (executor) return executor.name ? `${executor.name} (${executor.id})` : executor.id;
  if (run?.externalInstanceName || run?.externalInstanceId) return run.externalInstanceName
    ? `${run.externalInstanceName}${run.externalInstanceId ? ` (${run.externalInstanceId})` : ''}`
    : run.externalInstanceId;
  return undefined;
}

function humanVerificationLabel(value?: FeedbackRepairResultRecord['humanVerification']) {
  if (!value) return undefined;
  const base = ({
    'not-required': '不需要人工核验',
    required: '需要人工核验',
    pending: '等待人工核验',
    passed: '人工核验通过',
    failed: '人工核验未通过',
    verified: '人工核验通过',
    rejected: '人工核验未通过',
    'not-run': '尚未人工核验',
  } satisfies Record<NonNullable<FeedbackRepairResultRecord['humanVerification']>['status'], string>)[value.status];
  return [
    base,
    value.verifier ? `verifier ${value.verifier}` : '',
    value.conclusion ?? value.note ?? '',
    value.evidenceRefs?.length ? `evidence ${value.evidenceRefs.join(', ')}` : '',
    value.verifiedAt ? `at ${value.verifiedAt}` : '',
  ].filter(Boolean).join(' · ');
}

function normalizeRepairTests(tests: NonNullable<FeedbackRepairResultRecord['tests']>) {
  return tests.map((test, index) => ({
    command: test.command || test.name || `test-${index + 1}`,
    status: test.status === 'skipped' ? 'unknown' : test.status,
    outputRef: test.outputRef,
    summary: test.summary,
  }));
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildFeedbackRequest(
  comments: FeedbackCommentRecord[],
  ids: string[],
  title: string,
  requestId: string,
  createdAt: string,
): FeedbackRequestRecord {
  return {
    id: requestId,
    schemaVersion: 1,
    title,
    status: 'draft',
    feedbackIds: ids,
    summary: `Codex change request from ${ids.length} feedback comments.`,
    acceptanceCriteria: ids.map((id) => {
      const comment = comments.find((item) => item.id === id);
      return comment ? comment.comment : id;
    }).slice(0, 12),
    createdAt,
    updatedAt: createdAt,
  };
}

function feedbackSourceRefs(comment: FeedbackCommentRecord) {
  return stableStringList([
    comment.screenshotRef,
    comment.githubIssueUrl,
    comment.runtime.sessionId ? `session:${comment.runtime.sessionId}` : undefined,
    comment.runtime.activeRunId ? `run:${comment.runtime.activeRunId}` : undefined,
    comment.target.selector ? `target:${comment.target.selector}` : undefined,
    ...(comment.runtime.artifactSummary ?? []).map((artifact) => `artifact:${artifact.id}`),
    ...(comment.runtime.executionSummary ?? []).map((unit) => `execution-unit:${unit.id}`),
  ].filter((ref): ref is string => Boolean(ref)));
}

function stableStringList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
