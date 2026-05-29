import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boundedPackageBridgeDiagnosticText,
  packageBridgeInvocationProcessSummary,
  sanitizePackageBridgeDiagnosticText,
} from './package-bridge-invocation-diagnostics.js';

test('package bridge invocation diagnostics bounds stdout and stderr summaries', () => {
  const summary = packageBridgeInvocationProcessSummary({
    command: 'python3',
    args: ['-m', 'sciforge_computer_use'],
    stdout: `stdout-${'x'.repeat(80)}`,
    stderr: `stderr-${'y'.repeat(80)}`,
  }, { outputLimit: 24 });

  assert.equal(summary.stdout, 'stdout-xxxxxxxxxxxxxxxxx...[truncated]');
  assert.equal(summary.stderr, 'stderr-yyyyyyyyyyyyyyyyy...[truncated]');
  assert.equal(boundedPackageBridgeDiagnosticText(`  ${'z'.repeat(30)}  `, 10), 'zzzzzzzzzz...[truncated]');
});

test('package bridge invocation diagnostics redacts secrets in stdout stderr args and env', () => {
  const summary = packageBridgeInvocationProcessSummary({
    command: 'python3',
    args: [
      '--provider-url=https://provider.example/v1',
      '--api-key',
      'sk-test-secret-value',
      '--model',
      'expensive-private-model',
      'Authorization=Bearer abc.def.ghi',
    ],
    env: {
      OPENAI_API_KEY: 'sk-env-secret-value',
      PROVIDER_URL: 'https://provider.example/v1',
      MODEL: 'private-model-name',
      PATH: '/usr/bin',
      PASSWORD: 'correct-horse-battery-staple',
    },
    stdout: 'provider_url=https://provider.example/v1 api_key=sk-stdout-secret model=gpt-private docs=https://docs.example/path',
    stderr: '{"Authorization":"Bearer stderr-token","password":"stderr-password","message":"failed"}',
  });
  const serialized = JSON.stringify(summary);

  assert.doesNotMatch(serialized, /provider\.example|docs\.example/);
  assert.doesNotMatch(serialized, /sk-(test|env|stdout)-secret/);
  assert.doesNotMatch(serialized, /private-model|gpt-private|correct-horse|stderr-password|stderr-token|abc\.def/);
  assert.match(serialized, /\[redacted-secret\]/);
  assert.match(serialized, /\[redacted-url\]/);
  assert.equal(summary.env?.PATH, '/usr/bin');
  assert.equal(summary.args[2], '[redacted-secret]');
  assert.equal(summary.args[4], '[redacted-secret]');
});

test('package bridge invocation diagnostics preserves process exit signal timeout fields', () => {
  const summary = packageBridgeInvocationProcessSummary({
    command: '/usr/bin/python3',
    args: ['-m', 'sciforge_computer_use'],
    code: 124,
    cwd: '/tmp/workspace',
    signal: 'SIGTERM',
    timedOut: true,
    timeoutMs: 1500,
    stdout: 'partial stdout',
    stderr: 'partial stderr',
  });

  assert.equal(summary.command, '/usr/bin/python3');
  assert.deepEqual(summary.args, ['-m', 'sciforge_computer_use']);
  assert.equal(summary.cwd, '/tmp/workspace');
  assert.equal(summary.code, 124);
  assert.equal(summary.signal, 'SIGTERM');
  assert.equal(summary.timedOut, true);
  assert.equal(summary.timeoutMs, 1500);
  assert.equal(summary.stdout, 'partial stdout');
  assert.equal(summary.stderr, 'partial stderr');
});

test('package bridge invocation diagnostic text redacts common inline secret shapes', () => {
  const sanitized = sanitizePackageBridgeDiagnosticText([
    'Authorization: Bearer live-token',
    'OPENAI_API_KEY=sk-live-secret-token',
    '"providerUrl": "https://provider.example/v1"',
    '"model": "private-model"',
    'password=letmein',
  ].join('\n'));

  assert.doesNotMatch(sanitized, /live-token|sk-live|provider\.example|private-model|letmein/);
  assert.match(sanitized, /Authorization: \[redacted-secret\]/);
  assert.match(sanitized, /\[redacted-url\]|\[redacted-secret\]/);
});
