import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redactTraceText, redactUserVisibleText } from './trace-redaction';

test('user-visible redaction preserves operational metadata and model names', () => {
  const text = [
    'provider=text-provider',
    'model=text-model',
    'baseUrl=https://private.example.test/v1',
    'path=/Users/alice/workspace/file.txt',
    'Authorization: Bearer sk-secret-token',
    'api_key=explicit-secret',
    'resolved-secret',
  ].join(' ');

  const redacted = redactUserVisibleText(text, { sensitiveValues: ['resolved-secret'] });

  assert.match(redacted, /provider=text-provider/);
  assert.match(redacted, /model=text-model/);
  assert.match(redacted, /baseUrl=https:\/\/private\.example\.test\/v1/);
  assert.match(redacted, /path=\/Users\/alice\/workspace\/file\.txt/);
  assert.doesNotMatch(redacted, /sk-secret-token|explicit-secret|resolved-secret/);
});

test('trace redaction keeps operational metadata private', () => {
  const redacted = redactTraceText(
    'provider=text-provider model=text-model https://private.example.test/v1 /Users/alice/workspace/file.txt',
    { sensitiveValues: ['text-provider', 'text-model'] },
  );

  assert.doesNotMatch(redacted, /text-provider|text-model|private\.example\.test|\/Users\/alice/);
});
