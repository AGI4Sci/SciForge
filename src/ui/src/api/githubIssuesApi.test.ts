import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseGithubRepoParts } from './githubIssuesApi';

describe('githubIssuesApi', () => {
  it('parseGithubRepoParts accepts owner/repo and github URLs', () => {
    assert.deepEqual(parseGithubRepoParts('acme/SciForge'), { owner: 'acme', repo: 'SciForge' });
    assert.deepEqual(parseGithubRepoParts('https://github.com/org/repo-name.git'), { owner: 'org', repo: 'repo-name' });
    assert.equal(parseGithubRepoParts(''), null);
    assert.equal(parseGithubRepoParts('nope'), null);
  });
});
