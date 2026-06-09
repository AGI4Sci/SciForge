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

test('public event sanitizer preserves safe editor scope refs and drops payload-shaped scope refs', () => {
  const sanitized = sanitizePublicEvent({
    evidenceRefs: [
      'selection-ref:vscode:paper:1',
      'cursor-ref:vscode:paper:1',
      'range-ref:vscode:paper:1',
      'selection-ref:vscode:rawSelectedText',
      'cursor-ref:vscode:providerPayload',
      'range-ref:vscode:diff-token',
      'range-ref:vscode:/Users/example/private.md',
      'selection-ref:vscode:https://example.invalid/private',
    ],
    reasonRefs: [
      'needs-confirmation:vscode-app-module:editor-scope-selection-required',
      'selection-ref:vscode:selected-text-payload',
    ],
    preview: {
      rawSelectedText: 'SECRET_SELECTED_TEXT',
      rawVisibleText: 'SECRET_VISIBLE_TEXT',
      providerPayload: { requestBody: 'SECRET_PROVIDER_PAYLOAD' },
      rawDiff: '@@ SECRET_DIFF',
      url: 'https://example.invalid/secret',
      href: 'https://example.invalid/secret-link',
      requestedUrl: 'https://example.invalid/requested',
      currentUrl: 'https://example.invalid/current',
      finalUrl: 'https://example.invalid/final',
      safeRef: 'freshness:vscode:current',
    },
  }) as Record<string, unknown>;
  const text = JSON.stringify(sanitized);

  assert.deepEqual(sanitized.evidenceRefs, [
    'selection-ref:vscode:paper:1',
    'cursor-ref:vscode:paper:1',
    'range-ref:vscode:paper:1',
  ]);
  assert.deepEqual(sanitized.reasonRefs, [
    'needs-confirmation:vscode-app-module:editor-scope-selection-required',
  ]);
  assert.match(text, /freshness:vscode:current/);
  assert.equal(publicEventHasForbiddenRaw(sanitized), false);
  assert.doesNotMatch(text, /rawSelectedText|SECRET_SELECTED_TEXT|rawVisibleText|SECRET_VISIBLE_TEXT|providerPayload|SECRET_PROVIDER_PAYLOAD|rawDiff|SECRET_DIFF|requestedUrl|currentUrl|finalUrl|url|href|selected-text-payload|\/Users\/|example\.invalid|diff-token/i);
  assert.equal(publicEventHasForbiddenRaw({
    evidenceRefs: ['selection-ref:vscode:rawSelectedText'],
  }), true);
});
