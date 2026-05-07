import { checkGithubIssueWriteAccess, checkGithubRepoAccess, createGithubIssue, fetchOpenGithubIssues, type GithubIssueApiRow } from '../api/githubIssuesApi';
import { nowIso, type FeedbackCommentRecord, type GithubSyncedOpenIssueRecord, type SciForgeWorkspaceState } from '../domain';

const GITHUB_FEEDBACK_SOURCE = 'github-feedback';
const GITHUB_ISSUE_HINT = 'Use comments as source-of-truth; GitHub Issue should summarize and link this bundle instead of replacing it.';

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
  const lines: string[] = [];
  lines.push('## 概要');
  lines.push('');
  lines.push(`- **反馈条数**: ${comments.length}`);
  lines.push(`- **导出时间**: ${bundle.exportedAt}`);
  lines.push(`- **应用构建**: \`${bundle.appVersion}\``);
  lines.push(`- **说明**: ${bundle.githubIssueHint}`);
  lines.push('');
  lines.push('---');
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
  return lines.join('\n');
}

export async function submitFeedbackGithubIssue(params: {
  repo: string;
  token: string;
  title: string;
  body: string;
}) {
  await checkGithubRepoAccess(params.repo, params.token);
  await checkGithubIssueWriteAccess(params.repo, params.token);
  return createGithubIssue(params.repo, params.token, { title: params.title, body: params.body });
}

export async function syncFeedbackGithubIssues(repo: string, token: string, syncedAt = nowIso()) {
  await checkGithubRepoAccess(repo, token);
  const rows = await fetchOpenGithubIssues(repo, token);
  return mapGithubIssueRows(rows, syncedAt);
}

export function mapGithubIssueRows(rows: GithubIssueApiRow[], syncedAt: string): GithubSyncedOpenIssueRecord[] {
  return rows.map((row) => ({
    schemaVersion: 1,
    number: row.number,
    title: row.title,
    body: row.body ?? '',
    htmlUrl: row.html_url,
    updatedAt: row.updated_at,
    authorLogin: row.user?.login,
    labels: (row.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
    syncedAt,
  }));
}

export function markFeedbackGithubIssueCreated(
  state: SciForgeWorkspaceState,
  commentIds: string[],
  issue: { number: number; htmlUrl: string; title: string },
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  const selected = new Set(commentIds);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? {
        ...comment,
        status: comment.status === 'open' ? 'planned' : comment.status,
        githubIssueUrl: issue.htmlUrl,
        githubIssueNumber: issue.number,
        updatedAt,
      }
      : comment),
    feedbackRequests: (state.feedbackRequests ?? []).map((request) => request.feedbackIds.some((id) => selected.has(id))
      ? {
        ...request,
        status: request.status === 'draft' || request.status === 'ready' ? 'in-progress' : request.status,
        githubIssueUrl: issue.htmlUrl,
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
        updatedAt,
        labels: [],
        syncedAt: updatedAt,
      },
      ...(state.githubSyncedOpenIssues ?? []).filter((item) => item.number !== issue.number),
    ].slice(0, 500),
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
  const nextComments = [...(state.feedbackComments ?? [])];
  let changed = 0;
  for (const issue of issues) {
    const existing = existingByNumber.get(issue.number);
    const commentText = githubIssueFeedbackComment(issue);
    if (existing) {
      const index = nextComments.findIndex((comment) => comment.id === existing.id);
      if (index >= 0) {
        const next = {
          ...nextComments[index],
          comment: commentText,
          tags: Array.from(new Set([...nextComments[index].tags, 'github', ...issue.labels])),
          githubIssueUrl: issue.htmlUrl,
          githubIssueNumber: issue.number,
          updatedAt,
        };
        if (JSON.stringify(next) !== JSON.stringify(nextComments[index])) changed += 1;
        nextComments[index] = next;
      }
      continue;
    }
    nextComments.unshift(githubIssueToFeedbackComment(issue, updatedAt, appVersion));
    changed += 1;
  }
  return {
    changed,
    state: {
      ...state,
      feedbackComments: nextComments.slice(0, 500),
      updatedAt,
    },
  };
}

export function githubIssueFeedbackComment(issue: GithubSyncedOpenIssueRecord) {
  const body = issue.body.trim();
  return body
    ? `${issue.title}\n\n${body.slice(0, 2400)}`
    : issue.title;
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
    status: 'open',
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
  };
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
    if (comment.screenshot.dataUrl.length <= 48_000) {
      lines.push(`<img src="${comment.screenshot.dataUrl}" alt="feedback screenshot ${index + 1}" width="760" />`);
    } else {
      lines.push('- 截图过大，GitHub issue 正文省略图片；本地 Bundle 保留原始 dataUrl。');
    }
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
          dataUrl: `[omitted from GitHub JSON; rendered above when <= 48000 chars, original retained in exported local Bundle]`,
        },
      }
      : comment),
  };
}

function compactFeedbackText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function requestTitleFromFeedback(comments: FeedbackCommentRecord[]) {
  const first = comments[0]?.comment.trim();
  return first ? first.slice(0, 48) : 'SciForge feedback request';
}
