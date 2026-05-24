import { normalizeFeedbackGithubRepo } from '../config';

const GH_ACCEPT = 'application/vnd.github+json';

export type GithubIssueApiRow = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  updated_at: string;
  state?: string;
  pull_request?: unknown;
  user?: { login?: string };
  labels?: Array<{ name?: string }>;
};

export type GithubIssueCreateInput = {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
};

export type GithubIssueUpdateInput = {
  state?: 'open' | 'closed';
};

export type GithubRepoAccess = {
  fullName: string;
  private: boolean;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
};

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: GH_ACCEPT,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export function parseGithubRepoParts(repoFull: string): { owner: string; repo: string } | null {
  const normalized = normalizeFeedbackGithubRepo(repoFull.trim());
  if (!normalized) return null;
  const [owner, repo] = normalized.split('/');
  return owner && repo ? { owner, repo } : null;
}

function requireGithubApiInputs(repoFull: string, token: string): { owner: string; repo: string; token: string } {
  const parts = parseGithubRepoParts(repoFull);
  if (!parts) throw new Error('GitHub feedback sync blocked: 无效的 GitHub 仓库格式（需要 owner/repo）。本地反馈保持 pending，可修正仓库后重试。');
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error('GitHub feedback sync blocked: 缺少 GitHub token。本地反馈保持 pending，请配置具备 Issues 读写权限的 token 后重试。');
  return { ...parts, token: cleanToken };
}

async function githubFetch(input: string | URL, init: RequestInit, operation: string): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub API network failure during ${operation}: ${message}. 本地反馈保持 pending，可稍后重试。`);
  }
}

async function readGithubError(response: Response, context: { operation?: 'create-issue' | 'comment-issue' | 'update-issue' } = {}): Promise<string> {
  const text = await response.text();
  let message = '';
  try {
    const json = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    const detail = json.errors?.map((e) => e.message).filter(Boolean).join('; ');
    message = [json.message, detail].filter(Boolean).join(detail ? ' · ' : '') || text || response.statusText;
  } catch {
    message = text || response.statusText || `HTTP ${response.status}`;
  }
  return `GitHub API ${response.status}: ${friendlyGithubError(message, {
    ...context,
    rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
    rateLimitReset: response.headers.get('x-ratelimit-reset'),
  })}`;
}

function friendlyGithubError(message: string, context: {
  operation?: 'create-issue' | 'comment-issue' | 'update-issue';
  rateLimitRemaining?: string | null;
  rateLimitReset?: string | null;
} = {}) {
  if (
    context.rateLimitRemaining === '0'
    || /rate limit|secondary rate limit|abuse detection/i.test(message)
  ) {
    const resetAt = context.rateLimitReset && /^\d+$/.test(context.rateLimitReset)
      ? new Date(Number(context.rateLimitReset) * 1000).toISOString()
      : undefined;
    return `GitHub rate limit reached${resetAt ? `；预计 ${resetAt} 后可重试` : ''}。本地反馈保持 pending，不会被丢弃。`;
  }
  if (/forbids access via a fine-grained personal access tokens/i.test(message) && /lifetime is greater than 366 days/i.test(message)) {
    return '当前组织禁止使用有效期超过 366 天的 fine-grained PAT。请到 GitHub 重新生成或调整该 token 的 expiration 为 366 天以内，并确保授予目标仓库 Issues 读写权限。';
  }
  if (/resource not accessible by personal access token/i.test(message)) {
    if (context.operation === 'create-issue' || context.operation === 'comment-issue' || context.operation === 'update-issue') {
      return '仓库访问正常，但当前 PAT 没有创建 Issue 的写权限。请在 GitHub fine-grained token 设置里确认：Repository access 选中 AGI4Sci/SciForge，Repository permissions 里的 Issues 为 Read and write，并确认组织已批准该 token。保存后重新在 SciForge 设置里填写新 token。';
    }
    return '当前 PAT 无法访问该仓库资源。请确认 fine-grained PAT 已选择目标仓库，并授予 Issues 读写权限。';
  }
  if (/bad credentials/i.test(message)) {
    return 'GitHub PAT 无效或已过期，请在设置中重新填写有效 token。';
  }
  if (/not found/i.test(message)) {
    return '找不到目标仓库，或当前 PAT 没有访问该仓库的权限。请确认仓库 owner/repo 和 token 授权范围。';
  }
  return message;
}

export async function checkGithubRepoAccess(repoFull: string, token: string): Promise<GithubRepoAccess> {
  const parts = requireGithubApiInputs(repoFull, token);
  const response = await githubFetch(`https://api.github.com/repos/${parts.owner}/${parts.repo}`, {
    headers: githubHeaders(parts.token),
  }, 'repo access check');
  if (!response.ok) throw new Error(await readGithubError(response));
  const data = await response.json() as {
    full_name?: string;
    private?: boolean;
    permissions?: GithubRepoAccess['permissions'];
  };
  if (typeof data.full_name !== 'string') throw new Error('GitHub 返回数据异常：缺少仓库名称。');
  return {
    fullName: data.full_name,
    private: data.private === true,
    permissions: data.permissions,
  };
}

export async function checkGithubIssueWriteAccess(repoFull: string, token: string): Promise<void> {
  const parts = requireGithubApiInputs(repoFull, token);
  const response = await githubFetch(`https://api.github.com/repos/${parts.owner}/${parts.repo}/issues`, {
    method: 'POST',
    headers: githubHeaders(parts.token),
    body: JSON.stringify({ title: '', body: 'SciForge permission probe' }),
  }, 'issue write permission probe');
  if (response.status === 422) return;
  if (!response.ok) throw new Error(await readGithubError(response, { operation: 'create-issue' }));
  throw new Error('GitHub Issue 写权限探测异常：空标题请求意外成功。');
}

export async function createGithubIssue(
  repoFull: string,
  token: string,
  input: GithubIssueCreateInput,
): Promise<{ htmlUrl: string; number: number }> {
  const parts = requireGithubApiInputs(repoFull, token);
  const url = `https://api.github.com/repos/${parts.owner}/${parts.repo}/issues`;
  const response = await githubFetch(url, {
    method: 'POST',
    headers: githubHeaders(parts.token),
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      ...(input.labels?.length ? { labels: input.labels } : {}),
      ...(input.assignees?.length ? { assignees: input.assignees } : {}),
      ...(typeof input.milestone === 'number' ? { milestone: input.milestone } : {}),
    }),
  }, 'issue create');
  if (!response.ok) throw new Error(await readGithubError(response, { operation: 'create-issue' }));
  const data = await response.json() as { html_url?: string; number?: number };
  if (typeof data.html_url !== 'string' || typeof data.number !== 'number') {
    throw new Error('GitHub 返回数据异常：缺少 issue 链接。');
  }
  return { htmlUrl: data.html_url, number: data.number };
}

export async function createGithubIssueComment(
  repoFull: string,
  token: string,
  issueNumber: number,
  body: string,
): Promise<{ htmlUrl: string }> {
  const parts = requireGithubApiInputs(repoFull, token);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error('GitHub Issue comment blocked: issue number is required.');
  const cleanBody = body.trim();
  if (!cleanBody) throw new Error('GitHub Issue comment blocked: comment body is empty.');
  const url = `https://api.github.com/repos/${parts.owner}/${parts.repo}/issues/${issueNumber}/comments`;
  const response = await githubFetch(url, {
    method: 'POST',
    headers: githubHeaders(parts.token),
    body: JSON.stringify({ body: cleanBody }),
  }, 'issue comment');
  if (!response.ok) throw new Error(await readGithubError(response, { operation: 'comment-issue' }));
  const data = await response.json() as { html_url?: string };
  if (typeof data.html_url !== 'string') throw new Error('GitHub 返回数据异常：缺少 comment 链接。');
  return { htmlUrl: data.html_url };
}

export async function updateGithubIssue(
  repoFull: string,
  token: string,
  issueNumber: number,
  input: GithubIssueUpdateInput,
): Promise<{ htmlUrl: string; number: number; state?: string; updatedAt?: string }> {
  const parts = requireGithubApiInputs(repoFull, token);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error('GitHub Issue update blocked: issue number is required.');
  const url = `https://api.github.com/repos/${parts.owner}/${parts.repo}/issues/${issueNumber}`;
  const response = await githubFetch(url, {
    method: 'PATCH',
    headers: githubHeaders(parts.token),
    body: JSON.stringify(input),
  }, 'issue update');
  if (!response.ok) throw new Error(await readGithubError(response, { operation: 'update-issue' }));
  const data = await response.json() as { html_url?: string; number?: number; state?: string; updated_at?: string };
  if (typeof data.html_url !== 'string' || typeof data.number !== 'number') {
    throw new Error('GitHub 返回数据异常：缺少 issue 更新结果。');
  }
  return {
    htmlUrl: data.html_url,
    number: data.number,
    state: data.state,
    updatedAt: data.updated_at,
  };
}

/** Lists open issues only; excludes pull requests (they appear in `/issues` but carry `pull_request`). */
export async function fetchOpenGithubIssues(repoFull: string, token: string): Promise<GithubIssueApiRow[]> {
  const parts = requireGithubApiInputs(repoFull, token);
  const collected: GithubIssueApiRow[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(`https://api.github.com/repos/${parts.owner}/${parts.repo}/issues`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    const response = await githubFetch(url, { headers: githubHeaders(parts.token) }, 'open issue list');
    if (!response.ok) throw new Error(await readGithubError(response));
    const batch = await response.json() as unknown;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const item of batch) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as GithubIssueApiRow;
      if (row.pull_request) continue;
      if (row.state && row.state !== 'open') continue;
      collected.push(row);
    }
    if (batch.length < 100) break;
  }
  return collected;
}
