import { normalizeFeedbackGithubRepo } from '../config';

const GH_ACCEPT = 'application/vnd.github+json';

type GithubIssueApiRow = {
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

async function readGithubError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    const detail = json.errors?.map((e) => e.message).filter(Boolean).join('; ');
    return [json.message, detail].filter(Boolean).join(detail ? ' · ' : '') || text || response.statusText;
  } catch {
    return text || response.statusText || `HTTP ${response.status}`;
  }
}

export async function createGithubIssue(
  repoFull: string,
  token: string,
  input: { title: string; body: string },
): Promise<{ htmlUrl: string; number: number }> {
  const parts = parseGithubRepoParts(repoFull);
  if (!parts) throw new Error('无效的 GitHub 仓库格式（需要 owner/repo）。');
  const url = `https://api.github.com/repos/${parts.owner}/${parts.repo}/issues`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(token.trim()),
    body: JSON.stringify({ title: input.title, body: input.body }),
  });
  if (!response.ok) throw new Error(await readGithubError(response));
  const data = await response.json() as { html_url?: string; number?: number };
  if (typeof data.html_url !== 'string' || typeof data.number !== 'number') {
    throw new Error('GitHub 返回数据异常：缺少 issue 链接。');
  }
  return { htmlUrl: data.html_url, number: data.number };
}

/** Lists open issues only; excludes pull requests (they appear in `/issues` but carry `pull_request`). */
export async function fetchOpenGithubIssues(repoFull: string, token: string): Promise<GithubIssueApiRow[]> {
  const parts = parseGithubRepoParts(repoFull);
  if (!parts) throw new Error('无效的 GitHub 仓库格式（需要 owner/repo）。');
  const collected: GithubIssueApiRow[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(`https://api.github.com/repos/${parts.owner}/${parts.repo}/issues`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    const response = await fetch(url.toString(), { headers: githubHeaders(token.trim()) });
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
