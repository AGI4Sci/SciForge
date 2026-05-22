import { checkGithubIssueWriteAccess, checkGithubRepoAccess, createGithubIssue, fetchOpenGithubIssues, type GithubIssueApiRow } from '../api/githubIssuesApi';
import { nowIso, type FeedbackCommentRecord, type GithubSyncedOpenIssueRecord, type SciForgeWorkspaceState } from '../domain';
import { scrubFeedbackText } from './captureModel';

const GITHUB_FEEDBACK_SOURCE = 'github-feedback';
const GITHUB_ISSUE_HINT = 'Use comments as source-of-truth; GitHub Issue should summarize and link this bundle instead of replacing it.';
const GITHUB_FEEDBACK_IDS_MARKER = 'sciforge-feedback-ids';
const GITHUB_ISSUE_BODY_MAX_CHARS = 64_000;
const GITHUB_SCREENSHOT_OMISSION_NOTE = 'Inline screenshot dataUrl intentionally omitted from GitHub; use the local evidence bundle refs for raw and annotated images.';
const DEFAULT_REPAIR_POLICY = {
  defaultCommit: false,
  defaultPush: false,
  defaultMerge: false,
  requiresUserConfirmation: true,
  allowedOperations: ['inspect evidence', 'edit scoped SciForge files', 'run targeted tests'],
  forbiddenOperations: ['delete feedback evidence', 'rewrite GitHub sync metadata', 'commit/push/merge without user confirmation'],
} as const;

type FeedbackRequestRecord = NonNullable<SciForgeWorkspaceState['feedbackRequests']>[number];

export type SubmitFeedbackGithubIssueParams = {
  repo: string;
  token?: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number | string;
  dryRun?: boolean;
};

export type FeedbackBundle = {
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  comments: FeedbackCommentRecord[];
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>;
  githubIssueHint: string;
};

export function buildFeedbackBundle(
  comments: FeedbackCommentRecord[],
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>,
  appVersion: string,
  exportedAt = nowIso(),
): FeedbackBundle {
  return {
    schemaVersion: 1,
    exportedAt,
    appVersion,
    comments,
    requests: requests.filter((request) => request.feedbackIds.some((id) => comments.some((comment) => comment.id === id))),
    githubIssueHint: GITHUB_ISSUE_HINT,
  };
}

export function buildFeedbackGithubIssueTitle(comments: FeedbackCommentRecord[]) {
  if (!comments.length) return '[SciForge] 反馈汇总';
  if (comments.length === 1) {
    const one = comments[0].comment.trim().slice(0, 88);
    return `[SciForge] ${one || '反馈'}`;
  }
  const hint = requestTitleFromFeedback(comments).slice(0, 48);
  return `[SciForge] 汇总 ×${comments.length} · ${hint}`;
}

export function buildFeedbackGithubIssueBody(
  comments: FeedbackCommentRecord[],
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>,
  appVersion: string,
) {
  const bundle = buildFeedbackBundle(comments, requests, appVersion);
  const relatedRequests = bundle.requests;
  const localIds = comments.map((comment) => comment.id);
  const lines: string[] = [];
  lines.push(`<!-- ${GITHUB_FEEDBACK_IDS_MARKER}: ${localIds.join(',')} -->`);
  lines.push('<!-- sciforge-feedback-schema: feedback-github-issue.v1 -->');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Feedback count: ${comments.length}`);
  lines.push(`- Local feedback IDs: ${localIds.length ? localIds.map((id) => `\`${id}\``).join(', ') : '`none`'}`);
  lines.push(`- Related request IDs: ${relatedRequests.length ? relatedRequests.map((request) => `\`${request.id}\``).join(', ') : '`none`'}`);
  lines.push(`- Exported at: ${bundle.exportedAt}`);
  lines.push(`- App build: \`${bundle.appVersion}\``);
  lines.push(`- Source-of-truth policy: ${bundle.githubIssueHint}`);
  lines.push('');
  appendRequestSummary(lines, relatedRequests);
  lines.push('## Reproduction Steps');
  lines.push('');
  appendReproductionSteps(lines, comments);
  lines.push('## Expected Behavior');
  lines.push('');
  appendExpectedActual(lines, comments, 'expected');
  lines.push('## Actual Behavior');
  lines.push('');
  appendExpectedActual(lines, comments, 'actual');
  lines.push('## Target Element Evidence');
  lines.push('');
  comments.forEach((comment, index) => appendTargetEvidenceMarkdown(lines, comment, index));
  lines.push('## Screenshot Evidence');
  lines.push('');
  comments.forEach((comment, index) => appendScreenshotEvidenceMarkdown(lines, comment, index));
  lines.push('## Environment');
  lines.push('');
  appendEnvironmentMarkdown(lines, comments, bundle.appVersion);
  lines.push('## Local IDs And Refs');
  lines.push('');
  appendLocalRefsMarkdown(lines, comments, relatedRequests);
  lines.push('## Repair Policy');
  lines.push('');
  comments.forEach((comment, index) => appendRepairPolicyMarkdown(lines, comment, index));
  lines.push('## GitHub Sync Metadata');
  lines.push('');
  appendGithubSyncMetadata(lines, comments);
  lines.push('');
  comments.forEach((comment, index) => appendFeedbackCommentMarkdown(lines, comment, index));
  lines.push('<details>');
  lines.push('<summary>反馈 Bundle JSON（机器可读）</summary>');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(redactFeedbackBundleScreenshots(bundle), null, 2));
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  return limitGithubIssueBody(lines.join('\n'), comments);
}

export function buildFeedbackGithubIssueLabels(labels: string[] = []) {
  return uniqueStrings(labels.map((label) => label.trim()).filter((label) => label.length > 0 && label.length <= 50));
}

export async function submitFeedbackGithubIssue(params: SubmitFeedbackGithubIssueParams) {
  const repo = params.repo.trim();
  const title = params.title.trim();
  const body = params.body.trim();
  if (!repo) throw new Error('GitHub feedback sync blocked: 缺少目标仓库 owner/repo。本地反馈保持 pending，可配置仓库后重试。');
  if (!title) throw new Error('GitHub feedback sync blocked: Issue title 为空。本地反馈保持 pending。');
  if (!body) throw new Error('GitHub feedback sync blocked: Issue body 为空。本地反馈保持 pending。');
  if (params.dryRun) {
    return {
      htmlUrl: `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`,
      number: 0,
      dryRun: true,
      diagnostics: ['Dry run enabled: no GitHub issue was created and local feedback should remain pending.'],
    };
  }
  const token = params.token?.trim();
  if (!token) throw new Error('GitHub feedback sync blocked: 缺少 GitHub token。本地反馈保持 pending，请配置具备 Issues 读写权限的 token 后重试。');
  const labels = buildFeedbackGithubIssueLabels(params.labels);
  const assignees = uniqueStrings((params.assignees ?? []).map((assignee) => assignee.trim()).filter(Boolean));
  const milestone = normalizeGithubIssueMilestone(params.milestone);
  await checkGithubRepoAccess(repo, token);
  await checkGithubIssueWriteAccess(repo, token);
  return createGithubIssue(repo, token, {
    title,
    body,
    ...(labels.length ? { labels } : {}),
    ...(assignees.length ? { assignees } : {}),
    ...(typeof milestone === 'number' ? { milestone } : {}),
  });
}

export async function syncFeedbackGithubIssues(repo: string, token: string, syncedAt = nowIso()) {
  await checkGithubRepoAccess(repo, token);
  const rows = await fetchOpenGithubIssues(repo, token);
  return mapGithubIssueRows(rows, syncedAt);
}

export function mapGithubIssueRows(rows: GithubIssueApiRow[], syncedAt: string): GithubSyncedOpenIssueRecord[] {
  const dedupedRows = uniqueGithubIssueRows(rows);
  return dedupedRows.map((row) => ({
    schemaVersion: 1,
    number: row.number,
    title: row.title,
    body: row.body ?? '',
    htmlUrl: row.html_url,
    state: row.state ?? 'open',
    updatedAt: row.updated_at,
    authorLogin: row.user?.login,
    labels: uniqueStrings((row.labels ?? []).map((label) => label.name ?? '').filter(Boolean)),
    syncedAt,
  }));
}

export function markFeedbackGithubIssueCreated(
  state: SciForgeWorkspaceState,
  commentIds: string[],
  issue: { number: number; htmlUrl: string; title: string; labels?: string[] },
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  const selected = new Set(commentIds);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? {
        ...comment,
        status: comment.status === 'deleted' ? 'deleted' : 'github-open',
        githubIssueUrl: issue.htmlUrl,
        githubIssueNumber: issue.number,
        githubSyncStatus: 'github-open',
        githubSyncError: undefined,
        updatedAt,
      }
      : comment),
    feedbackRequests: (state.feedbackRequests ?? []).map((request) => request.feedbackIds.some((id) => selected.has(id))
      ? {
        ...request,
        status: request.status === 'draft' || request.status === 'ready' ? 'in-progress' : request.status,
        githubIssueUrl: issue.htmlUrl,
        metadata: {
          ...(request.metadata ?? {}),
          githubIssueNumber: issue.number,
          githubSyncedAt: updatedAt,
        },
        updatedAt,
      }
      : request),
    githubSyncedOpenIssues: [
      {
        schemaVersion: 1 as const,
        number: issue.number,
        title: issue.title,
        body: '',
        htmlUrl: issue.htmlUrl,
        state: 'open',
        updatedAt,
        labels: buildFeedbackGithubIssueLabels(issue.labels),
        syncedAt: updatedAt,
        conflict: { status: 'none' as const },
      },
      ...(state.githubSyncedOpenIssues ?? []).filter((item) => item.number !== issue.number),
    ].slice(0, 500),
    updatedAt,
  };
}

export function markFeedbackGithubIssueSyncPending(
  state: SciForgeWorkspaceState,
  commentIds: string[],
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  const selected = new Set(commentIds);
  if (!selected.size) return state;
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? {
        ...comment,
        githubSyncStatus: 'pending',
        githubSyncError: undefined,
        updatedAt,
      }
      : comment),
    updatedAt,
  };
}

export function markFeedbackGithubIssueSyncFailed(
  state: SciForgeWorkspaceState,
  commentIds: string[],
  error: unknown,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  const selected = new Set(commentIds);
  if (!selected.size) return state;
  const message = scrubFeedbackText(error instanceof Error ? error.message : String(error)).slice(0, 640);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? {
        ...comment,
        githubSyncStatus: 'failed',
        githubSyncError: message || 'GitHub sync failed; local feedback preserved for retry.',
        updatedAt,
      }
      : comment),
    updatedAt,
  };
}

export function importGithubOpenIssuesAsFeedback(
  state: SciForgeWorkspaceState,
  issues: GithubSyncedOpenIssueRecord[],
  updatedAt = nowIso(),
  appVersion = 'local-dev',
) {
  const existingByNumber = new Map((state.feedbackComments ?? [])
    .filter((comment) => typeof comment.githubIssueNumber === 'number')
    .map((comment) => [comment.githubIssueNumber, comment]));
  const existingById = new Map((state.feedbackComments ?? []).map((comment) => [comment.id, comment]));
  const nextComments = [...(state.feedbackComments ?? [])];
  const annotatedIssues: GithubSyncedOpenIssueRecord[] = [];
  let changed = 0;
  for (const issue of uniqueGithubSyncedOpenIssues(issues)) {
    const localIds = localFeedbackIdsFromGithubIssue(issue);
    const existing = existingByNumber.get(issue.number)
      ?? localIds.map((id) => existingById.get(id)).find((comment): comment is FeedbackCommentRecord => Boolean(comment));
    if (existing) {
      const index = nextComments.findIndex((comment) => comment.id === existing.id);
      if (index >= 0) {
        const conflict = detectGithubSyncConflict(nextComments[index], issue);
        const annotatedIssue = { ...issue, conflict };
        annotatedIssues.push(annotatedIssue);
        const next = {
          ...nextComments[index],
          tags: Array.from(new Set([...nextComments[index].tags, 'github', ...issue.labels])),
          githubIssueUrl: issue.htmlUrl,
          githubIssueNumber: issue.number,
          githubSyncStatus: conflict.status === 'none' ? 'github-open' as const : 'conflict' as const,
          githubSyncError: conflict.status === 'none' ? undefined : conflict.note,
          status: nextComments[index].status === 'open' || nextComments[index].status === 'request' || nextComments[index].status === 'comment'
            ? 'github-open' as const
            : nextComments[index].status,
          updatedAt,
        };
        if (JSON.stringify(next) !== JSON.stringify(nextComments[index])) changed += 1;
        nextComments[index] = next;
      }
      continue;
    }
    const annotatedIssue = { ...issue, conflict: { status: 'none' as const } };
    annotatedIssues.push(annotatedIssue);
    nextComments.unshift(githubIssueToFeedbackComment(annotatedIssue, updatedAt, appVersion));
    changed += 1;
  }
  return {
    changed,
    state: {
      ...state,
      feedbackComments: nextComments.slice(0, 500),
      githubSyncedOpenIssues: annotatedIssues.slice(0, 500),
      updatedAt,
    },
  };
}

export function githubIssueFeedbackComment(issue: GithubSyncedOpenIssueRecord) {
  const body = scrubFeedbackText(issue.body).slice(0, 2400);
  const title = scrubFeedbackText(issue.title);
  return body ? `${title}\n\n${body}` : title;
}

function githubIssueToFeedbackComment(
  issue: GithubSyncedOpenIssueRecord,
  updatedAt: string,
  appVersion: string,
): FeedbackCommentRecord {
  return {
    id: `feedback-github-${issue.number}`,
    schemaVersion: 1,
    authorId: issue.authorLogin ? `github:${issue.authorLogin}` : 'github',
    authorName: issue.authorLogin ? `GitHub @${issue.authorLogin}` : 'GitHub',
    comment: githubIssueFeedbackComment(issue),
    status: 'github-open',
    priority: issue.labels.some((label) => /urgent|high|p0|p1/i.test(label)) ? 'high' : 'normal',
    tags: Array.from(new Set(['github', ...issue.labels])),
    createdAt: issue.updatedAt || updatedAt,
    updatedAt,
    target: {
      selector: `github-issue-${issue.number}`,
      path: `github/issues/${issue.number}`,
      text: issue.title,
      tagName: 'github-issue',
      role: 'issue',
      ariaLabel: issue.title,
      rect: { x: 0, y: 0, width: 0, height: 0 },
    },
    viewport: { width: 0, height: 0, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    runtime: {
      page: 'github',
      url: issue.htmlUrl,
      scenarioId: GITHUB_FEEDBACK_SOURCE,
      sessionTitle: issue.title,
      appVersion,
    },
    githubIssueUrl: issue.htmlUrl,
    githubIssueNumber: issue.number,
    githubSyncStatus: issue.conflict?.status && issue.conflict.status !== 'none' ? 'conflict' : 'github-open',
    githubSyncError: issue.conflict?.status && issue.conflict.status !== 'none' ? issue.conflict.note : undefined,
  };
}

function appendRequestSummary(lines: string[], requests: FeedbackRequestRecord[]) {
  if (!requests.length) return;
  lines.push('### Related Requests');
  lines.push('');
  lines.push('| Request | Status | Summary | Expected Result |');
  lines.push('| --- | --- | --- | --- |');
  requests.forEach((request) => {
    lines.push(`| \`${request.id}\` | \`${request.status}\` | ${tableValue(request.summary)} | ${tableValue(request.expectedResult ?? 'not provided')} |`);
  });
  lines.push('');
}

function appendReproductionSteps(lines: string[], comments: FeedbackCommentRecord[]) {
  if (!comments.length) {
    lines.push('1. No local feedback comments were selected.');
    lines.push('');
    return;
  }
  comments.forEach((comment, index) => {
    lines.push(`### ${index + 1}. ${inlineCode(comment.id)}`);
    lines.push('');
    lines.push(`1. Open ${inlineCode(comment.runtime.url || comment.runtime.page)}.`);
    lines.push(`2. Navigate to page ${inlineCode(comment.runtime.page)} in scenario ${inlineCode(comment.runtime.scenarioId)}.`);
    lines.push(`3. Locate target selector ${inlineCode(comment.target.selector)} at path ${inlineCode(comment.target.path)}.`);
    lines.push(`4. Observe the captured target text/comment: ${markdownText(compactFeedbackText(comment.comment) || 'not provided')}.`);
    lines.push('');
  });
}

function appendExpectedActual(lines: string[], comments: FeedbackCommentRecord[], kind: 'expected' | 'actual') {
  comments.forEach((comment) => {
    const value = kind === 'expected'
      ? comment.expectedBehavior ?? 'Not provided by reporter.'
      : comment.actualBehavior ?? comment.comment;
    lines.push(`- ${inlineCode(comment.id)}: ${markdownText(value)}`);
  });
  lines.push('');
}

function appendTargetEvidenceMarkdown(lines: string[], comment: FeedbackCommentRecord, index: number) {
  lines.push(`### ${index + 1}. ${inlineCode(comment.id)}`);
  lines.push('');
  lines.push('| Evidence | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Local feedback id | \`${tableValue(comment.id)}\` |`);
  lines.push(`| Selector | \`${tableValue(comment.target.selector)}\` |`);
  lines.push(`| Path | \`${tableValue(comment.target.path)}\` |`);
  lines.push(`| Tag / role | \`${tableValue(comment.target.tagName)}\`${comment.target.role ? ` / \`${tableValue(comment.target.role)}\`` : ''} |`);
  lines.push(`| ARIA label | ${tableValue(comment.target.ariaLabel ?? 'not provided')} |`);
  lines.push(`| Text snapshot | ${tableValue(compactFeedbackText(comment.target.text) || 'not provided')} |`);
  lines.push(`| Rect | x=${Math.round(comment.target.rect.x)} y=${Math.round(comment.target.rect.y)} w=${Math.round(comment.target.rect.width)} h=${Math.round(comment.target.rect.height)} |`);
  lines.push(`| Evidence status | ${tableValue(comment.evidenceStatus?.status ?? 'not provided')} |`);
  if (comment.evidenceStatus?.diagnostics.length) {
    lines.push(`| Evidence diagnostics | ${tableValue(comment.evidenceStatus.diagnostics.join('; '))} |`);
  }
  lines.push('');
}

function appendScreenshotEvidenceMarkdown(lines: string[], comment: FeedbackCommentRecord, index: number) {
  lines.push(`### ${index + 1}. ${inlineCode(comment.id)}`);
  lines.push('');
  lines.push(`- Annotated screenshot ref: ${inlineCode(comment.annotatedScreenshotRef ?? 'not provided')}`);
  lines.push(`- Raw screenshot ref: ${inlineCode(comment.rawScreenshotRef ?? comment.screenshotRef ?? 'not provided')}`);
  lines.push(`- Evidence bundle ref: ${inlineCode(comment.evidenceBundleRef ?? 'not provided')}`);
  appendEvidenceAssetMarkdown(lines, comment);
  if (comment.screenshot?.dataUrl) {
    lines.push(`- ${GITHUB_SCREENSHOT_OMISSION_NOTE}`);
    lines.push(`- Screenshot captured at: ${comment.screenshot.capturedAt}`);
    lines.push(`- Screenshot media: ${comment.screenshot.mediaType} ${comment.screenshot.width}x${comment.screenshot.height}`);
    lines.push(`- Target rect in screenshot: x=${Math.round(comment.screenshot.targetRect.x)} y=${Math.round(comment.screenshot.targetRect.y)} w=${Math.round(comment.screenshot.targetRect.width)} h=${Math.round(comment.screenshot.targetRect.height)}`);
    lines.push(`- Include for agent: ${inlineCode(String(comment.screenshot.includeForAgent === true))}`);
    if (comment.screenshot.note) lines.push(`- Screenshot note: ${markdownText(comment.screenshot.note)}`);
  }
  lines.push('');
}

function appendEvidenceAssetMarkdown(lines: string[], comment: FeedbackCommentRecord) {
  const assets = (comment.evidenceAssets ?? []).filter((asset) => asset.ref?.trim());
  if (!assets.length) return;
  for (const asset of assets) {
    const url = asset.githubMarkdownUrl || asset.publicUrl || asset.markdownImageUrl || asset.ref;
    lines.push(`- Evidence object: ${inlineCode(asset.label || asset.kind)} · ${inlineCode(asset.kind)} · ${inlineCode(asset.ref)}`);
    if (asset.uploadStatus) lines.push(`  - Upload status: ${inlineCode(asset.uploadStatus)}`);
    if (asset.kind === 'scrubbed-annotated-screenshot' && url && !/^data:image\//i.test(url)) {
      lines.push(`![${markdownImageAlt(asset.label || 'Scrubbed annotated screenshot')}](${markdownImageUrl(url)})`);
    } else if (url && !/^data:image\//i.test(url)) {
      lines.push(`  - Open: [${markdownText(asset.label || asset.kind)}](${markdownImageUrl(url)})`);
    }
  }
}

function appendEnvironmentMarkdown(lines: string[], comments: FeedbackCommentRecord[], appVersion: string) {
  lines.push(`- App build: ${inlineCode(appVersion)}`);
  lines.push('');
  lines.push('| Feedback | Page | URL | Scenario | Session | Active run | Viewport |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  comments.forEach((comment) => {
    lines.push([
      inlineCode(comment.id),
      inlineCode(comment.runtime.page),
      tableValue(comment.runtime.url || 'not provided'),
      inlineCode(comment.runtime.scenarioId),
      inlineCode(comment.runtime.sessionId ?? 'not provided'),
      inlineCode(comment.runtime.activeRunId ?? 'not provided'),
      `${comment.viewport.width}x${comment.viewport.height} dpr=${comment.viewport.devicePixelRatio} scroll=(${comment.viewport.scrollX},${comment.viewport.scrollY})`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  });
  lines.push('');
}

function appendLocalRefsMarkdown(lines: string[], comments: FeedbackCommentRecord[], requests: FeedbackRequestRecord[]) {
  lines.push('| Feedback | Requests | Session/run refs | Screenshot refs | Evidence bundle |');
  lines.push('| --- | --- | --- | --- | --- |');
  comments.forEach((comment) => {
    const requestIds = requests.filter((request) => request.feedbackIds.includes(comment.id)).map((request) => request.id);
    const sessionRefs = [
      comment.runtime.sessionId ? `session:${comment.runtime.sessionId}` : undefined,
      comment.runtime.activeRunId ? `run:${comment.runtime.activeRunId}` : undefined,
    ].filter(Boolean).join(', ') || 'not provided';
    const screenshotRefs = [
      comment.annotatedScreenshotRef ? `annotated:${comment.annotatedScreenshotRef}` : undefined,
      comment.rawScreenshotRef ? `raw:${comment.rawScreenshotRef}` : undefined,
      comment.screenshotRef ? `legacy:${comment.screenshotRef}` : undefined,
    ].filter(Boolean).join(', ') || 'not provided';
    lines.push(`| \`${tableValue(comment.id)}\` | ${tableValue(requestIds.join(', ') || 'none')} | ${tableValue(sessionRefs)} | ${tableValue(screenshotRefs)} | ${tableValue(comment.evidenceBundleRef ?? 'not provided')} |`);
  });
  lines.push('');
}

function appendRepairPolicyMarkdown(lines: string[], comment: FeedbackCommentRecord, index: number) {
  const policy = comment.repairPolicy ?? DEFAULT_REPAIR_POLICY;
  lines.push(`### ${index + 1}. ${inlineCode(comment.id)}`);
  lines.push('');
  lines.push(`- Default commit: ${inlineCode(String(policy.defaultCommit))}`);
  lines.push(`- Default push: ${inlineCode(String(policy.defaultPush))}`);
  lines.push(`- Default merge: ${inlineCode(String(policy.defaultMerge))}`);
  lines.push(`- Requires user confirmation: ${inlineCode(String(policy.requiresUserConfirmation))}`);
  lines.push(`- Allowed operations: ${policy.allowedOperations.length ? policy.allowedOperations.map(inlineCode).join(', ') : inlineCode('none')}`);
  lines.push(`- Forbidden operations: ${policy.forbiddenOperations.length ? policy.forbiddenOperations.map(inlineCode).join(', ') : inlineCode('none')}`);
  lines.push('');
}

function appendGithubSyncMetadata(lines: string[], comments: FeedbackCommentRecord[]) {
  lines.push('| Feedback | Local sync status | Remote issue | Remote URL | Last sync diagnostic |');
  lines.push('| --- | --- | --- | --- | --- |');
  comments.forEach((comment) => {
    lines.push(`| \`${tableValue(comment.id)}\` | \`${tableValue(comment.githubSyncStatus ?? 'not-synced')}\` | ${comment.githubIssueNumber ? `#${comment.githubIssueNumber}` : 'not created'} | ${tableValue(comment.githubIssueUrl ?? 'not provided')} | ${tableValue(comment.githubSyncError ?? 'none')} |`);
  });
  lines.push('');
  lines.push('Sync rule: GitHub metadata may be updated, but local annotations, screenshot refs, evidence bundles, and repair audit records remain the product source of truth.');
  lines.push('');
}

function appendFeedbackCommentMarkdown(lines: string[], comment: FeedbackCommentRecord, index: number) {
  const heading = comment.comment.replace(/\s+/g, ' ').trim().slice(0, 120) || '(无摘要)';
  lines.push(`### ${index + 1}. ${heading}`);
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 状态 | \`${comment.status}\` |`);
  lines.push(`| 优先级 | \`${comment.priority}\` |`);
  lines.push(`| 作者 | ${comment.authorName} |`);
  lines.push(`| 创建时间 | ${comment.createdAt} |`);
  lines.push(`| 页面 | \`${comment.runtime.page}\` |`);
  lines.push(`| 场景 | \`${comment.runtime.scenarioId}\` |`);
  lines.push(`| Session | ${comment.runtime.sessionId ?? '—'} |`);
  lines.push(`| Active run | ${comment.runtime.activeRunId ?? '—'} |`);
  lines.push(`| URL | ${comment.runtime.url} |`);
  if (comment.tags.length) lines.push(`| 标签 | ${comment.tags.map((tag) => `\`${tag}\``).join(', ')} |`);
  lines.push('');
  lines.push('**评论原文**');
  lines.push('');
  lines.push('```');
  lines.push(comment.comment);
  lines.push('```');
  lines.push('');
  lines.push('**DOM selector**');
  lines.push('');
  lines.push('```css');
  lines.push(comment.target.selector);
  lines.push('```');
  lines.push('');
  lines.push('**元素**');
  lines.push(`- tag: \`${comment.target.tagName}\`${comment.target.role ? ` · role: \`${comment.target.role}\`` : ''}`);
  if (comment.target.ariaLabel) lines.push(`- aria-label: ${comment.target.ariaLabel}`);
  lines.push(`- path: \`${comment.target.path}\``);
  lines.push(`- rect: x=${Math.round(comment.target.rect.x)} y=${Math.round(comment.target.rect.y)} w=${Math.round(comment.target.rect.width)} h=${Math.round(comment.target.rect.height)}`);
  if (comment.target.text.trim()) lines.push(`- text: ${compactFeedbackText(comment.target.text)}`);
  lines.push('');
  if (comment.screenshot?.dataUrl) {
    lines.push('**截图证据（默认不自动进入 agent 上下文）**');
    lines.push('');
    lines.push(`- ${GITHUB_SCREENSHOT_OMISSION_NOTE}`);
    lines.push(`- annotated ref: ${inlineCode(comment.annotatedScreenshotRef ?? comment.screenshot.annotatedScreenshotRef ?? 'not provided')}`);
    lines.push(`- raw ref: ${inlineCode(comment.rawScreenshotRef ?? comment.screenshot.rawScreenshotRef ?? comment.screenshotRef ?? 'not provided')}`);
    lines.push(`- capturedAt: ${comment.screenshot.capturedAt}`);
    lines.push(`- targetRect: x=${Math.round(comment.screenshot.targetRect.x)} y=${Math.round(comment.screenshot.targetRect.y)} w=${Math.round(comment.screenshot.targetRect.width)} h=${Math.round(comment.screenshot.targetRect.height)}`);
    lines.push(`- includeForAgent: \`${comment.screenshot.includeForAgent === true}\``);
    if (comment.screenshot.note) lines.push(`- note: ${comment.screenshot.note}`);
    lines.push('');
  }
  lines.push('**视口**');
  lines.push(`- ${comment.viewport.width}×${comment.viewport.height} · dpr ${comment.viewport.devicePixelRatio} · scroll (${comment.viewport.scrollX}, ${comment.viewport.scrollY})`);
  lines.push('');
  lines.push('---');
  lines.push('');
}

function redactFeedbackBundleScreenshots(bundle: FeedbackBundle): FeedbackBundle {
  return {
    ...bundle,
    comments: bundle.comments.map((comment) => comment.screenshot
      ? {
        ...comment,
        screenshot: {
          ...comment.screenshot,
          dataUrl: '[omitted from GitHub JSON; original retained in local feedback bundle]',
          rawDataUrl: comment.screenshot.rawDataUrl ? '[omitted from GitHub JSON; original retained in local feedback bundle]' : undefined,
          annotatedDataUrl: comment.screenshot.annotatedDataUrl ? '[omitted from GitHub JSON; original retained in local feedback bundle]' : undefined,
        },
      }
      : comment),
  };
}

function limitGithubIssueBody(body: string, comments: FeedbackCommentRecord[]) {
  if (body.length <= GITHUB_ISSUE_BODY_MAX_CHARS) return body;
  const detailsStart = body.indexOf('<details>\n<summary>反馈 Bundle JSON');
  const ids = comments.map((comment) => comment.id).join(', ');
  const overflowNote = [
    '',
    '---',
    '',
    'GitHub body was shortened to stay below the issue body limit.',
    `Local feedback IDs: ${ids || 'none'}`,
    'Use the local evidence bundle refs above for the complete scrubbed payload and screenshots.',
    '',
  ].join('\n');
  const withoutJson = detailsStart > 0 ? `${body.slice(0, detailsStart).trim()}\n${overflowNote}` : body;
  if (withoutJson.length <= GITHUB_ISSUE_BODY_MAX_CHARS) return withoutJson;
  const keep = Math.max(0, GITHUB_ISSUE_BODY_MAX_CHARS - overflowNote.length - 32);
  return `${withoutJson.slice(0, keep).trimEnd()}\n${overflowNote}`;
}

function compactFeedbackText(text: string) {
  return scrubFeedbackText(text).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function requestTitleFromFeedback(comments: FeedbackCommentRecord[]) {
  const first = comments[0]?.comment.trim();
  return first ? first.slice(0, 48) : 'SciForge feedback request';
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeGithubIssueMilestone(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function uniqueGithubIssueRows(rows: GithubIssueApiRow[]) {
  const byNumber = new Map<number, GithubIssueApiRow>();
  for (const row of rows) {
    if (typeof row.number !== 'number' || !Number.isFinite(row.number)) continue;
    const previous = byNumber.get(row.number);
    if (!previous || String(row.updated_at || '').localeCompare(String(previous.updated_at || '')) > 0) {
      byNumber.set(row.number, row);
    }
  }
  return Array.from(byNumber.values()).sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}

function uniqueGithubSyncedOpenIssues(issues: GithubSyncedOpenIssueRecord[]) {
  const byNumber = new Map<number, GithubSyncedOpenIssueRecord>();
  for (const issue of issues) {
    const previous = byNumber.get(issue.number);
    if (!previous || String(issue.updatedAt || '').localeCompare(String(previous.updatedAt || '')) > 0) {
      byNumber.set(issue.number, issue);
    }
  }
  return Array.from(byNumber.values()).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

function localFeedbackIdsFromGithubIssue(issue: GithubSyncedOpenIssueRecord) {
  const ids = new Set<string>();
  const marker = new RegExp(`<!--\\s*${GITHUB_FEEDBACK_IDS_MARKER}:\\s*([^>]+?)\\s*-->`, 'i').exec(issue.body);
  if (marker?.[1]) {
    marker[1].split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => ids.add(id));
  }
  for (const match of issue.body.matchAll(/\bfeedback-[A-Za-z0-9._:-]+\b/g)) ids.add(match[0]);
  return Array.from(ids);
}

function detectGithubSyncConflict(comment: FeedbackCommentRecord, issue: GithubSyncedOpenIssueRecord): NonNullable<GithubSyncedOpenIssueRecord['conflict']> {
  const localUpdatedAt = Date.parse(comment.updatedAt || '');
  const remoteUpdatedAt = Date.parse(issue.updatedAt || '');
  const localBody = `${comment.comment}\n${comment.expectedBehavior ?? ''}\n${comment.actualBehavior ?? ''}`.trim();
  const remoteMentionsLocal = localFeedbackIdsFromGithubIssue(issue).includes(comment.id);
  const remoteDivergedFromLocal = remoteMentionsLocal && issue.body.trim() && localBody && !issue.body.includes(comment.comment.slice(0, 80));
  if (Number.isFinite(localUpdatedAt) && Number.isFinite(remoteUpdatedAt) && localUpdatedAt > remoteUpdatedAt && remoteDivergedFromLocal) {
    return {
      status: 'local-edited-after-remote',
      localFeedbackId: comment.id,
      localUpdatedAt: comment.updatedAt,
      remoteUpdatedAt: issue.updatedAt,
      note: 'Local feedback was edited after the remote issue update; preserving local annotation.',
    };
  }
  if (Number.isFinite(localUpdatedAt) && Number.isFinite(remoteUpdatedAt) && remoteUpdatedAt > localUpdatedAt && remoteDivergedFromLocal) {
    return {
      status: 'remote-edited-after-local',
      localFeedbackId: comment.id,
      localUpdatedAt: comment.updatedAt,
      remoteUpdatedAt: issue.updatedAt,
      note: 'Remote issue changed after the local feedback; preserving local annotation and surfacing the conflict.',
    };
  }
  if (remoteDivergedFromLocal) {
    return {
      status: 'body-diverged',
      localFeedbackId: comment.id,
      localUpdatedAt: comment.updatedAt,
      remoteUpdatedAt: issue.updatedAt,
      note: 'Remote issue body diverged from local feedback; local annotation was not overwritten.',
    };
  }
  return {
    status: 'none',
    localFeedbackId: comment.id,
    localUpdatedAt: comment.updatedAt,
    remoteUpdatedAt: issue.updatedAt,
  };
}

function markdownText(value: string) {
  return compactFeedbackText(value).replace(/[<>]/g, (char) => char === '<' ? '&lt;' : '&gt;');
}

function markdownImageAlt(value: string) {
  return markdownText(value).replace(/[\[\]\n\r]/g, ' ').trim() || 'Screenshot evidence';
}

function markdownImageUrl(value: string) {
  return encodeURI(value.trim()).replace(/\)/g, '%29').replace(/\(/g, '%28');
}

function tableValue(value: string) {
  return markdownText(String(value)).replace(/\|/g, '\\|') || 'not provided';
}

function inlineCode(value: string) {
  return `\`${tableValue(String(value)).replace(/`/g, '\\`')}\``;
}
