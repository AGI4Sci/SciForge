import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_EVENT_REDACTED,
  publicEventHasForbiddenRaw,
  sanitizePublicEvent,
} from './public-event-sanitizer';

test('public event sanitizer recursively removes raw payload keys and unsafe values while preserving refs', () => {
  const sanitized = sanitizePublicEvent({
    status: 'blocked',
    message: 'Blocked because evidence is available by refs.',
    evidenceRefs: [
      'observation:vscode:current',
      'artifact:computer-use-proof',
      'data:image/png;base64,SECRET_IMAGE',
      '/tmp/private/raw-screenshot.png',
    ],
    action: {
      type: 'click',
      targetRef: 'element:vscode:editor',
      rawScreenshot: 'data:image/png;base64,SECRET_IMAGE',
      nested: {
        providerPayload: { requestBody: 'SECRET_PROVIDER_PAYLOAD' },
        accessibilityTree: { role: 'AXTextArea', value: 'RAW_AX_TREE' },
        afterRef: 'executor-event:vscode:after',
      },
    },
    diagnostics: {
      rawPath: '/Users/example/private.txt',
      safeRef: 'freshness:vscode:after',
      detail: 'open https://example.invalid/private for raw detail',
    },
    logs: [{ stdout: 'SECRET_STDOUT' }],
    artifacts: [{
      id: 'screen-proof',
      type: 'image-evidence',
      data: {
        screenRef: 'image:vscode:current',
        body: '<html>SECRET_RAW_ARTIFACT_BODY</html>',
      },
    }],
  }) as Record<string, unknown>;
  const text = JSON.stringify(sanitized);

  assert.deepEqual(sanitized.evidenceRefs, ['observation:vscode:current', 'artifact:computer-use-proof']);
  assert.equal((sanitized.action as Record<string, unknown>).type, 'click');
  assert.equal(((sanitized.action as Record<string, unknown>).nested as Record<string, unknown> | undefined)?.afterRef, 'executor-event:vscode:after');
  assert.equal(sanitized.logs, undefined);
  assert.match(text, /image:vscode:current/);
  assert.match(text, new RegExp(PUBLIC_EVENT_REDACTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /SECRET|data:image|base64|example\.invalid|\/tmp|\/Users|raw-screenshot|RAW_AX_TREE|SECRET_RAW_ARTIFACT_BODY/i);
  assert.equal(publicEventHasForbiddenRaw(sanitized), false);
});

test('public event sanitizer detects forbidden raw payloads before sanitizing', () => {
  assert.equal(publicEventHasForbiddenRaw({
    output: {
      rawCommand: 'rm -rf /tmp/private',
      providerPayload: { token: 'SECRET_TOKEN' },
    },
  }), true);
  assert.equal(publicEventHasForbiddenRaw({
    output: {
      commandId: 'codex-command-safe',
      evidenceRefs: ['computer-use:vscode/action.completed'],
    },
  }), false);
});
