import { idempotencyMarker, type GitHubIssueAdapter, type GitHubIssueCreateInput } from '../service.js'

export type GitHubRestIssueAdapterOptions = {
  token: () => Promise<string>
  allowedRepositories: Iterable<string>
  fetchImpl?: typeof fetch
  apiBaseUrl?: string
  recoveryPages?: number
}

type GitHubIssueResponse = {
  number?: unknown
  html_url?: unknown
  body?: unknown
  user?: { login?: unknown }
  pull_request?: unknown
  message?: unknown
}

export class GitHubAdapterError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'GitHubAdapterError'
  }
}

function repositoryKey(repository: GitHubIssueCreateInput['repository']): string {
  return `${repository.owner}/${repository.name}`.toLowerCase()
}

function parsedIssue(body: GitHubIssueResponse): {
  issueNumber: number
  issueUrl: string
  author?: string
} | null {
  if (!Number.isInteger(body.number) || typeof body.html_url !== 'string') return null
  let issueUrl: string
  try {
    issueUrl = new URL(body.html_url).toString()
  } catch {
    return null
  }
  const author = typeof body.user?.login === 'string' ? body.user.login : undefined
  return {
    issueNumber: body.number as number,
    issueUrl,
    ...(author ? { author } : {})
  }
}

export class GitHubRestIssueAdapter implements GitHubIssueAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly apiBaseUrl: string
  private readonly allowedRepositories: Set<string>
  private readonly recoveryPages: number

  constructor(private readonly options: GitHubRestIssueAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    if (typeof this.fetchImpl !== 'function') throw new Error('Fetch is unavailable.')
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    this.allowedRepositories = new Set(
      [...options.allowedRepositories].map((repository) => repository.trim().toLowerCase()).filter(Boolean)
    )
    if (this.allowedRepositories.size === 0) throw new Error('At least one GitHub repository must be allowed.')
    this.recoveryPages = Math.max(0, Math.min(options.recoveryPages ?? 3, 10))
  }

  async createIssue(input: GitHubIssueCreateInput): Promise<{
    issueNumber: number
    issueUrl: string
    author?: string
  }> {
    if (!this.allowedRepositories.has(repositoryKey(input.repository))) {
      throw new GitHubAdapterError('The requested GitHub repository is not allowed.', 403, false)
    }
    const token = (await this.options.token()).trim()
    if (!token) throw new GitHubAdapterError('GitHub authentication is not configured.', 401, false)
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
    const repositoryUrl = `${this.apiBaseUrl}/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}`
    const marker = idempotencyMarker(input.idempotencyKey)

    const recovered = await this.findRecentIssue(repositoryUrl, headers, marker)
    if (recovered) return recovered

    const response = await this.fetchImpl(`${repositoryUrl}/issues`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body })
    })
    const responseBody = await response.json().catch(() => undefined) as GitHubIssueResponse | undefined
    if (!response.ok) throw githubError(response.status, responseBody)
    const issue = responseBody ? parsedIssue(responseBody) : null
    if (!issue) throw new GitHubAdapterError('GitHub returned an invalid Issue response.', 502, true)
    return issue
  }

  private async findRecentIssue(
    repositoryUrl: string,
    headers: Record<string, string>,
    marker: string
  ): Promise<{ issueNumber: number; issueUrl: string; author?: string } | null> {
    for (let page = 1; page <= this.recoveryPages; page += 1) {
      const response = await this.fetchImpl(
        `${repositoryUrl}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
        { headers }
      )
      const responseBody = await response.json().catch(() => undefined) as GitHubIssueResponse[] | GitHubIssueResponse | undefined
      if (!response.ok) throw githubError(response.status, responseBody)
      if (!Array.isArray(responseBody)) {
        throw new GitHubAdapterError('GitHub returned an invalid Issue listing.', 502, true)
      }
      for (const candidate of responseBody) {
        if (candidate.pull_request || typeof candidate.body !== 'string' || !candidate.body.includes(marker)) continue
        const issue = parsedIssue(candidate)
        if (issue) return issue
      }
      if (responseBody.length < 100) break
    }
    return null
  }
}

function githubError(status: number, body: GitHubIssueResponse | GitHubIssueResponse[] | undefined): GitHubAdapterError {
  const message = !Array.isArray(body) && typeof body?.message === 'string'
    ? body.message.slice(0, 2_000)
    : `GitHub returned HTTP ${status}.`
  return new GitHubAdapterError(message, status, status === 408 || status === 429 || status >= 500)
}
