import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackInboxDiagnostics } from './FeedbackInboxDiagnostics';

test('feedback inbox diagnostics renders repair readiness and page state controls', () => {
  const html = renderToStaticMarkup(
    <FeedbackInboxDiagnostics
      pageStateNotices={[
        { id: 'workspace', label: 'workspace data', value: 'loaded', detail: 'workspace state restored', state: 'ready' },
        { id: 'github-token', label: 'GitHub token', value: 'missing', detail: 'submit/sync opens settings and keeps local state', state: 'blocked' },
      ]}
      repairReadiness={{
        status: 'partial',
        summary: 'Live repair needs strict in-app browser acceptance evidence.',
        rows: [
          { label: 'repair peers', value: '1/1', detail: 'repair peer is checking', state: 'partial' },
          { label: 'provider preflight', value: 'blocked', detail: 'provider configuration needs attention', state: 'blocked' },
        ],
        nextAction: 'npm run smoke:runtime-codex-browser-acceptance',
        needsPeerSettings: true,
        providerReady: false,
      }}
      writerReadinessRows={[
        { label: 'workspace writer', value: 'current', detail: 'capabilities ready', state: 'ready' },
      ]}
      onOpenGithubSettings={() => undefined}
      onRefreshPageDiagnostics={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Repair readiness"/);
  assert.match(html, /Runtime repair readiness/);
  assert.match(html, /workspace writer/);
  assert.match(html, /repair peers/);
  assert.match(html, /Provider 设置/);
  assert.match(html, /打开设置/);
  assert.match(html, /aria-label="页面状态诊断"/);
  assert.match(html, /aria-label="重新检查页面状态诊断"/);
  assert.match(html, /1 needs attention/);
  assert.match(html, /GitHub token/);
});

test('feedback inbox diagnostics hides readiness actions when no next action is available', () => {
  const html = renderToStaticMarkup(
    <FeedbackInboxDiagnostics
      pageStateNotices={[
        { id: 'workspace', label: 'workspace data', value: 'loaded', detail: 'workspace state restored', state: 'ready' },
      ]}
      repairReadiness={{
        status: 'ready',
        summary: 'Repair peer, provider preflight, and browser acceptance are ready.',
        rows: [
          { label: 'repair peers', value: '1/1', detail: 'ready', state: 'ready' },
        ],
        needsPeerSettings: false,
        providerReady: true,
      }}
      writerReadinessRows={[
        { label: 'workspace writer', value: 'current', detail: 'capabilities ready', state: 'ready' },
      ]}
      onOpenGithubSettings={() => undefined}
      onRefreshPageDiagnostics={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /feedback-repair-readiness-action/);
  assert.doesNotMatch(html, /Provider 设置/);
  assert.match(html, /0 needs attention/);
});
