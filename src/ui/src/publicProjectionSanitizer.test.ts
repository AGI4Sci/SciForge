import assert from 'node:assert/strict';
import test from 'node:test';

import { redactInlinePrivateText } from './publicProjectionSanitizer';

test('public projection sanitizer redacts common GitHub token forms', () => {
  const text = redactInlinePrivateText([
    'classic ghp_1234567890abcdef',
    'fine-grained github_pat_1234567890abcdef',
    'legacy ghp-1234567890abcdef',
  ].join('\n'));

  assert.doesNotMatch(text, /ghp_1234567890abcdef|github_pat_1234567890abcdef|ghp-1234567890abcdef/);
  assert.match(text, /\[redacted-secret\]/);
});
