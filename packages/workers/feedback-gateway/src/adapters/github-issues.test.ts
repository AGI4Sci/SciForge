import { describe, expect, it, vi } from 'vitest'

import { GitHubAdapterError, GitHubRestIssueAdapter } from './github-issues.js'

const input = {
  repository: { owner: 'XingYu-Zhong', name: 'SciForge' },
  title: 'Bug report',
  body: 'Details\n<!-- sciforge-feedback:marker -->',
  idempotencyKey: 'feedback:thread-1234567890'
}

describe('GitHubRestIssueAdapter', () => {
  it('checks for a recoverable Issue and creates through the official REST API', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        number: 17,
        html_url: 'https://github.com/XingYu-Zhong/SciForge/issues/17',
        user: { login: 'octocat' }
      }), { status: 201, headers: { 'content-type': 'application/json' } }))
    const adapter = new GitHubRestIssueAdapter({
      token: async () => 'github-token',
      allowedRepositories: ['xingyu-zhong/sciforge'],
      fetchImpl
    })

    await expect(adapter.createIssue(input)).resolves.toEqual({
      issueNumber: 17,
      issueUrl: 'https://github.com/XingYu-Zhong/SciForge/issues/17',
      author: 'octocat'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const createCall = fetchImpl.mock.calls[1]
    expect(createCall?.[0]).toBe('https://api.github.com/repos/XingYu-Zhong/SciForge/issues')
    expect(createCall?.[1]).toMatchObject({ method: 'POST' })
    expect(new Headers(createCall?.[1]?.headers).get('authorization')).toBe('Bearer github-token')
  })

  it('recovers an existing Issue containing the hashed idempotency marker', async () => {
    const { idempotencyMarker } = await import('../service.js')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{
      number: 19,
      html_url: 'https://github.com/XingYu-Zhong/SciForge/issues/19',
      body: `old report <!-- ${idempotencyMarker(input.idempotencyKey)} -->`,
      user: { login: 'octocat' }
    }]), { status: 200, headers: { 'content-type': 'application/json' } }))
    const adapter = new GitHubRestIssueAdapter({
      token: async () => 'github-token',
      allowedRepositories: ['XingYu-Zhong/SciForge'],
      fetchImpl
    })

    await expect(adapter.createIssue(input)).resolves.toMatchObject({ issueNumber: 19 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses repositories outside the deployment allowlist before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const adapter = new GitHubRestIssueAdapter({
      token: async () => 'github-token',
      allowedRepositories: ['XingYu-Zhong/SciForge'],
      fetchImpl
    })

    await expect(adapter.createIssue({ ...input, repository: { owner: 'other', name: 'repo' } }))
      .rejects.toBeInstanceOf(GitHubAdapterError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
