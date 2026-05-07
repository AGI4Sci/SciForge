import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkGithubIssueWriteAccess, checkGithubRepoAccess, parseGithubRepoParts } from './githubIssuesApi';

describe('githubIssuesApi', () => {
  it('parseGithubRepoParts accepts owner/repo and github URLs', () => {
    assert.deepEqual(parseGithubRepoParts('acme/SciForge'), { owner: 'acme', repo: 'SciForge' });
    assert.deepEqual(parseGithubRepoParts('https://github.com/org/repo-name.git'), { owner: 'org', repo: 'repo-name' });
    assert.equal(parseGithubRepoParts(''), null);
    assert.equal(parseGithubRepoParts('nope'), null);
  });

  it('explains organization fine-grained PAT lifetime failures', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: "The 'AGI4Sci' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days.",
    }), { status: 403 })) as typeof fetch;
    try {
      await assert.rejects(
        () => checkGithubRepoAccess('AGI4Sci/SciForge', 'github_pat_test'),
        /有效期超过 366 天/,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('treats empty-title validation as successful issue write permission probe', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'Validation Failed',
      errors: [{ message: 'title is too short' }],
    }), { status: 422 })) as typeof fetch;
    try {
      await checkGithubIssueWriteAccess('AGI4Sci/SciForge', 'github_pat_test');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('explains missing fine-grained Issues write permission on create probe', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'Resource not accessible by personal access token',
    }), { status: 403 })) as typeof fetch;
    try {
      await assert.rejects(
        () => checkGithubIssueWriteAccess('AGI4Sci/SciForge', 'github_pat_test'),
        /没有创建 Issue 的写权限/,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
