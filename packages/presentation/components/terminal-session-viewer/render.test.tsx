import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderTerminalSessionViewer } from './render';
import { basicTerminalSessionViewerFixture } from './fixtures/basic';
import { emptyTerminalSessionViewerFixture } from './fixtures/empty';
import { selectionTerminalSessionViewerFixture } from './fixtures/selection';

function htmlFor(fixture = basicTerminalSessionViewerFixture) {
  return renderToStaticMarkup(renderTerminalSessionViewer(fixture));
}

test('terminal session viewer renders buffer, status, and no side-effect boundary text', () => {
  const html = htmlFor();

  assert.match(html, /terminal-session-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-status="running"/);
  assert.match(html, /ok 1 renderTerminalSessionViewer/);
  assert.doesNotMatch(html, /Presentation only: no process, socket, provider, workspace write, or command is started/);
});

test('terminal session viewer exposes input, paste, resize, copy, and stop events as DOM data', () => {
  const html = htmlFor();

  for (const event of ['data-input', 'paste-input', 'resize', 'copy-request', 'download-request', 'stop-request', 'focus-change']) {
    assert.match(html, new RegExp(`data-event="${event}"`));
    assert.match(html, new RegExp(`data-terminal-event="${event}"`));
  }
  assert.match(html, /data-cols="100"/);
  assert.match(html, /data-rows="20"/);
});

test('terminal session viewer supports copy selection and stopped status', () => {
  const html = htmlFor(selectionTerminalSessionViewerFixture);

  assert.match(html, /data-status="stopped"/);
  assert.match(html, /data-selection="ok 1 renderTerminalSessionViewer"/);
  assert.match(html, /exitCode/);
  assert.match(html, /data-event="stop-request"[^>]*disabled=""/);
});

test('terminal session viewer renders empty status without pretending to own runtime work', () => {
  const html = htmlFor(emptyTerminalSessionViewerFixture);

  assert.match(html, /data-status="idle"/);
  assert.match(html, /Terminal buffer is empty/);
  assert.match(html, /Type input for attached session/);
});

test('terminal session viewer can expose a host-owned live PTY surface', () => {
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: {
        sessionRef: 'terminal:rt-04',
        status: 'running',
        liveSurfaceRef: { current: null },
        liveSurfaceLabel: 'Direct Codex PTY terminal',
      },
    },
    artifact: {
      id: 'terminal-session-live',
      type: 'runtime-terminal-session',
      producerScenario: 'feedback-repair-terminal',
      schemaVersion: '0.1.0',
    },
  }));

  assert.match(html, /terminal-session-viewer-live-surface/);
  assert.match(html, /data-terminal-live-surface="host-owned"/);
  assert.match(html, /aria-label="Direct Codex PTY terminal"/);
  assert.doesNotMatch(html, /Terminal buffer is empty/);
});

test('terminal session viewer imports no runtime side-effect modules', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /child_process|node-pty|@xterm|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(/);
});
