import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeGuiPanel } from './RuntimeGuiPanel';

test('runtime gui confirmation renders safe refs as focus buttons without command chrome', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiAskUser: {
        title: 'Computer Use confirmation required',
        message: 'Review the repair evidence before continuing.',
        relatedRefs: [
          'artifact::repair-evidence',
          'file::reports/repair.md',
          '.sciforge/raw/trace.json',
          'stdout:.sciforge/stdout.log',
        ],
        choices: [
          { label: 'Approve', commandText: '/computer-use approve --approval-ref approval-1', style: 'primary' },
          { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1' },
          { label: 'Unsafe legacy', commandText: 'deleteFile("report.md")', style: 'danger' },
        ],
      },
    },
    onCommand: () => undefined,
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-gui-surface="confirmation"/);
  assert.match(html, /runtime-gui-ref-button/);
  assert.match(html, /data-object-kind="artifact"/);
  assert.match(html, /data-object-kind="file"/);
  assert.match(html, />repair-evidence<\/button>/);
  assert.match(html, />repair\.md<\/button>/);
  assert.match(html, />Approve<\/span>/);
  assert.match(html, />Cancel<\/span>/);
  assert.doesNotMatch(html, /\.sciforge|stdout|deleteFile|Unsafe legacy|approval-1|\/computer-use approve|\/computer-use reject|Computer Use/);
});

test('runtime gui presentation sanitizes provider diagnostics and raw payload text', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiPresentation: {
        title: 'provider=https://provider.example.test/v1 token=sk-secret',
        text: 'provider=https://provider.example.test/v1 stdout=.sciforge/runs/abc/stdout.log path=/Applications/workspace/private raw JSON {"token":"sk-secret"}',
        displayedRefs: ['artifact::report-ready'],
      },
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /runtime-gui-present/);
  assert.match(html, /service=\[redacted\]|service configuration|Operation result/);
  assert.match(html, /runtime-gui-ref-button/);
  assert.doesNotMatch(html, /provider\.example|sk-secret|\.sciforge|\/Applications\/workspace|stdout\.log|raw JSON/i);
});

test('runtime gui refs focus browser screen terminal and subagent objects fail closed for unsafe refs', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiAskUser: {
        title: 'Review related objects',
        message: 'Open the related objects before continuing.',
        relatedRefs: [
          'browser-runtime:snapshot-1',
          'screen:frame-1',
          'terminal-transcript:run-1',
          'subagent:worker-1',
          'provider:private',
          'file:/Applications/workspace/private.txt',
          'stdout:.sciforge/runs/private.log',
        ],
      },
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-object-kind="url"/);
  assert.match(html, /data-preferred-view="browser-object"/);
  assert.match(html, /data-object-kind="artifact"/);
  assert.match(html, /data-preferred-view="screen-observation"/);
  assert.match(html, /data-object-kind="execution-unit"/);
  assert.match(html, /data-preferred-view="terminal-session-viewer"/);
  assert.match(html, /data-object-kind="run"/);
  assert.match(html, /data-preferred-view="subagent-result"/);
  assert.doesNotMatch(html, /provider:private|Applications\/workspace|stdout|private\.log/);
});
