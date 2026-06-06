import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeGuiPanel } from './RuntimeGuiPanel';
import { isTerminalEquivalentRuntimeCommand, runtimeGuiChoicesFromEventPayload } from './runtimeGuiCommands';

test('runtime gui hard-confirm renders required public fields and controls without raw commands', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiAskUser: {
        kind: 'hard-confirm',
        title: 'External form submission requires confirmation',
        message: 'Please confirm the external submission.',
        publicProjection: {
          action: 'submit application form',
          target: 'Example Jobs application form',
          impact: 'Submits the prepared application to the external site.',
          evidenceRefs: [
            'browser-runtime:job-application/review-state',
            'artifact:application-preview',
            '.sciforge/raw/private-trace.json',
            'stdout:.sciforge/stdout.log',
          ],
          authorizationProfile: 'High Autonomy',
        },
        approvalRequest: {
          commandText: '/browser click --selector "#submit" --token sk-secret',
          rawPayload: { token: 'sk-secret' },
        },
        choices: [
          { label: 'Approve', commandText: '/computer-use approve --approval-ref approval-1', style: 'primary' },
          { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1' },
        ],
      },
    },
    onCommand: () => undefined,
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-gui-surface="confirmation"/);
  assert.match(html, /Action<\/dt><dd>submit application form<\/dd>/);
  assert.match(html, /Target<\/dt><dd>Example Jobs application form<\/dd>/);
  assert.match(html, /Impact<\/dt><dd>Submits the prepared application to the external site\.<\/dd>/);
  assert.match(html, /Authorization profile<\/dt><dd>High Autonomy<\/dd>/);
  assert.match(html, /Evidence refs<\/dt>/);
  assert.match(html, />review-state<\/button>/);
  assert.match(html, />application-preview<\/button>/);
  assert.match(html, />Confirm<\/span>/);
  assert.match(html, />Cancel<\/span>/);
  assert.doesNotMatch(html, /Approve|\/computer-use|\/browser|#submit|sk-secret|\.sciforge|stdout|rawPayload|private-trace/);
});

test('runtime gui blocked projection renders the same public fields without action execution chrome', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiAskUser: {
        kind: 'blocked',
        title: 'Policy blocked',
        message: 'The requested action is blocked by policy.',
        publicProjection: {
          action: 'bypass access control',
          target: 'Account security challenge',
          impact: 'Access-control bypasses are blocked.',
          evidenceRefs: ['browser-runtime:account/security-challenge'],
          authorizationProfile: 'High Autonomy',
        },
        choices: [
          { label: 'Cancel', commandText: '/computer-use reject --approval-ref blocked-1' },
        ],
      },
    },
    onCommand: () => undefined,
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-gui-surface="confirmation"/);
  assert.match(html, /Action<\/dt><dd>bypass access control<\/dd>/);
  assert.match(html, /Target<\/dt><dd>Account security challenge<\/dd>/);
  assert.match(html, /Impact<\/dt><dd>Access-control bypasses are blocked\.<\/dd>/);
  assert.match(html, /Authorization profile<\/dt><dd>High Autonomy<\/dd>/);
  assert.match(html, />security-challenge<\/button>/);
  assert.match(html, />Cancel<\/span>/);
  assert.doesNotMatch(html, />Confirm<\/span>|\/computer-use|blocked-1/);
});

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
  assert.match(html, />Confirm<\/span>/);
  assert.match(html, />Cancel<\/span>/);
  assert.doesNotMatch(html, /\.sciforge|stdout|deleteFile|Unsafe legacy|approval-1|\/computer-use approve|\/computer-use reject|Computer Use|Approve/);
});

test('runtime gui choices keep Computer Use controls but reject executable native actions', () => {
  const choices = runtimeGuiChoicesFromEventPayload({
    guiAskUser: {
      choices: [
        { label: 'Click', commandText: '/computer-use click --x 20 --y 40 --target-ref computer-use:target/private.json' },
        { label: 'Type', commandText: '/computer-use type --text "secret"' },
        { label: 'Browser click', commandText: '/browser click --selector "#submit"' },
        { label: 'Stop', commandText: '/computer-use stop --stop-ref computer-use:stop/current.json' },
        { label: 'Takeover', commandText: '/computer-use takeover --takeover-ref computer-use:leases/takeover.json' },
        { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1' },
      ],
    },
  });

  assert.equal(isTerminalEquivalentRuntimeCommand('/computer-use click --x 20 --y 40'), false);
  assert.equal(isTerminalEquivalentRuntimeCommand('/browser click --selector "#submit"'), false);
  assert.deepEqual(choices.map((choice) => choice.label), ['Stop', 'Takeover', 'Cancel']);
  assert.deepEqual(choices.map((choice) => choice.commandText), [
    '/computer-use stop --stop-ref computer-use:stop/current.json',
    '/computer-use takeover --takeover-ref computer-use:leases/takeover.json',
    '/computer-use reject --approval-ref approval-1',
  ]);
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
  assert.match(html, /data-preferred-view="image-evidence"/);
  assert.match(html, /data-object-kind="execution-unit"/);
  assert.match(html, /data-preferred-view="terminal-session-viewer"/);
  assert.match(html, /data-object-kind="run"/);
  assert.match(html, /data-preferred-view="subagent-result"/);
  assert.doesNotMatch(html, /provider:private|Applications\/workspace|stdout|private\.log/);
});

test('runtime gui refs can focus safe folded trace summaries without raw trace refs', () => {
  const html = renderToStaticMarkup(createElement(RuntimeGuiPanel, {
    surface: {
      guiPresentation: {
        title: 'Process refs ready',
        text: 'Open the folded process summary.',
        displayedRefs: [
          'trace:explorer-summary',
          'trace:raw-stream',
          'trace:provider-route',
          'trace:worker-secret-token',
        ],
      },
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /data-object-kind="run"/);
  assert.match(html, /data-preferred-view="subagent-transcript"/);
  assert.match(html, />explorer-summary<\/button>/);
  assert.doesNotMatch(html, /raw-stream|provider-route|worker-secret-token/);
});
