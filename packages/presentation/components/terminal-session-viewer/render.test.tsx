import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderTerminalSessionViewer, type HostOwnedTerminalSession, type TerminalSessionAdapter } from './render';
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
  assert.match(html, /data-mode="transcript"/);
  assert.match(html, /data-session-ref="terminal:run-rt-03"/);
  assert.match(html, /data-session-id="run-rt-03"/);
  assert.match(html, /data-cwd="\/workspace\/SciForge"/);
  assert.match(html, /data-status="running"/);
  assert.match(html, /ok 1 renderTerminalSessionViewer/);
  assert.match(html, /Started/);
  assert.match(html, /2026-05-31T09:30:00.000Z/);
  assert.doesNotMatch(html, /Presentation only: no process, socket, provider, workspace write, or command is started/);
});

test('terminal session viewer exposes input, paste, resize, copy, and stop events as DOM data', () => {
  const html = htmlFor();

  for (const [event, action] of [
    ['data-input', 'input'],
    ['paste-input', 'paste'],
    ['resize', 'resize'],
    ['copy-request', 'copy'],
    ['download-request', 'download'],
    ['stop-request', 'stop'],
    ['focus-change', 'focus'],
  ]) {
    assert.match(html, new RegExp(`data-event="${event}"`));
    assert.match(html, new RegExp(`data-terminal-event="${event}"`));
    assert.match(html, new RegExp(`data-terminal-action="${action}"`));
  }
  assert.match(html, /data-cols="100"/);
  assert.match(html, /data-rows="20"/);
});

test('terminal session viewer preserves empty, running, completed, stopped, and error lifecycle states', () => {
  for (const status of ['empty', 'running', 'completed', 'stopped', 'error'] as const) {
    const html = renderToStaticMarkup(renderTerminalSessionViewer({
      slot: {
        componentId: 'terminal-session-viewer',
        props: {
          sessionRef: `terminal:${status}`,
          status,
          buffer: status === 'empty' ? '' : `${status} terminal output`,
          capabilities: { input: true, paste: true, resize: true, stop: true },
        },
      },
      artifact: {
        id: `terminal-session-${status}`,
        type: 'terminal-session',
        producerScenario: 'terminal-session-preview',
        schemaVersion: '0.1.0',
      },
    }));

    assert.match(html, new RegExp(`data-status="${status}"`));
    if (status === 'empty') {
      assert.match(html, /Terminal buffer is empty/);
    } else {
      assert.match(html, new RegExp(`${status} terminal output`));
    }
    if (status === 'running') {
      assert.doesNotMatch(html, /data-terminal-action="input"[^>]*disabled=""/);
      assert.doesNotMatch(html, /data-terminal-action="paste"[^>]*disabled=""/);
    } else {
      assert.match(html, /data-terminal-action="input"[^>]*disabled=""/);
      assert.match(html, /data-terminal-action="paste"[^>]*disabled=""/);
    }
  }
});

test('terminal session viewer supports copy selection and stopped status', () => {
  const html = htmlFor(selectionTerminalSessionViewerFixture);

  assert.match(html, /data-status="stopped"/);
  assert.match(html, /data-selection="ok 1 renderTerminalSessionViewer"/);
  assert.match(html, /Exit code/);
  assert.match(html, />0<\/dd>/);
  assert.match(html, /Completed/);
  assert.match(html, /data-event="stop-request"[^>]*disabled=""/);
  assert.match(html, /data-terminal-action="input"[^>]*disabled=""/);
  assert.match(html, /data-terminal-action="paste"[^>]*disabled=""/);
});

test('terminal session viewer renders empty status without pretending to own runtime work', () => {
  const html = htmlFor(emptyTerminalSessionViewerFixture);

  assert.match(html, /data-status="empty"/);
  assert.match(html, /Terminal buffer is empty/);
  assert.match(html, /Type input for attached session/);
  assert.doesNotMatch(html, /\$ ask --help/);
});

test('terminal session viewer falls back to transcript when live mode has no host surface', () => {
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: {
        mode: 'live',
        sessionRef: 'terminal:fallback-live',
        sessionId: 'fallback-live',
        status: 'running',
        transcript: 'fallback transcript line',
      },
    },
    artifact: {
      id: 'terminal-session-fallback',
      type: 'runtime-terminal-session',
      producerScenario: 'feedback-repair-terminal',
      schemaVersion: '0.1.0',
    },
  }));

  assert.match(html, /data-mode="transcript"/);
  assert.match(html, /data-requested-mode="live"/);
  assert.match(html, /fallback transcript line/);
  assert.doesNotMatch(html, /terminal-session-viewer-live-surface/);
});

test('terminal session viewer can expose a host-owned live PTY surface', () => {
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: {
        mode: 'live',
        sessionRef: 'terminal:rt-04',
        sessionId: 'rt-04',
        cwd: '/workspace/SciForge',
        status: 'running',
        rows: 48,
        cols: 120,
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

  assert.match(html, /data-mode="live"/);
  assert.match(html, /data-requested-mode="live"/);
  assert.match(html, /data-session-ref="terminal:rt-04"/);
  assert.match(html, /data-session-id="rt-04"/);
  assert.match(html, /data-cols="120"/);
  assert.match(html, /data-rows="48"/);
  assert.match(html, /terminal-session-viewer-live-surface/);
  assert.match(html, /data-terminal-live-surface="host-owned"/);
  assert.match(html, /aria-label="Direct Codex PTY terminal"/);
  assert.doesNotMatch(html, /Terminal buffer is empty/);
});

test('terminal session viewer accepts an explicit host-owned terminal session adapter payload', () => {
  const hostSession: HostOwnedTerminalSession = {
    sessionRef: 'terminal:adapter-pty',
    sessionId: 'adapter-pty',
    cwd: '/workspace/SciForge',
    status: 'running',
    rows: 42,
    cols: 132,
    startedAt: '2026-05-31T10:00:00.000Z',
    transcriptRef: 'artifact:terminal-adapter-transcript',
    ptyTranscriptRef: 'pty-transcript:terminal-adapter',
  };
  const adapter: TerminalSessionAdapter = {
    kind: 'host-owned-terminal-session',
    mode: 'live',
    session: hostSession,
    liveSurfaceRef: { current: null },
    liveSurfaceLabel: 'Adapter-owned PTY',
  };
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: { adapter },
    },
    artifact: {
      id: 'terminal-session-adapter-live',
      type: 'runtime-terminal-session',
      producerScenario: 'feedback-repair-terminal',
      schemaVersion: '0.1.0',
    },
  }));

  assert.match(html, /data-terminal-session-adapter="host-owned-terminal-session"/);
  assert.match(html, /data-mode="live"/);
  assert.match(html, /data-session-ref="terminal:adapter-pty"/);
  assert.match(html, /data-session-id="adapter-pty"/);
  assert.match(html, /data-cwd="\/workspace\/SciForge"/);
  assert.match(html, /data-cols="132"/);
  assert.match(html, /data-rows="42"/);
  assert.match(html, /data-transcript-ref="artifact:terminal-adapter-transcript"/);
  assert.match(html, /data-pty-transcript-ref="pty-transcript:terminal-adapter"/);
  assert.match(html, /aria-label="Adapter-owned PTY"/);
  assert.match(html, /PTY transcript ref/);
});

test('terminal session viewer disables input and paste for error sessions', () => {
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: {
        sessionRef: 'terminal:errored',
        status: 'error',
        buffer: 'command failed',
        capabilities: { input: true, paste: true, stop: true },
      },
    },
    artifact: {
      id: 'terminal-session-error',
      type: 'terminal-session',
      producerScenario: 'terminal-session-preview',
      schemaVersion: '0.1.0',
    },
  }));

  assert.match(html, /data-status="error"/);
  assert.match(html, /command failed/);
  assert.match(html, /data-terminal-action="input"[^>]*disabled=""/);
  assert.match(html, /data-terminal-action="paste"[^>]*disabled=""/);
});

test('terminal session viewer omits agent trace, summaries, environment dumps, and raw JSON', () => {
  const html = renderToStaticMarkup(renderTerminalSessionViewer({
    slot: {
      componentId: 'terminal-session-viewer',
      props: {
        sessionRef: 'terminal:safe-transcript',
        status: 'running',
        buffer: [
          { stream: 'stdout', text: 'terminal stdout line' },
          { type: 'agent-summary', text: 'AGENT SUMMARY LEAK' },
          { type: 'trace', text: 'TRACE LEAK' },
          { type: 'activity', text: 'ACTIVITY LEAK' },
        ],
        metadata: {
          cwd: '/workspace/SciForge',
          environment: { SECRET_TOKEN: 'hidden' },
          agentSummary: 'agent answer summary',
          rawJson: '{"trace":"hidden"}',
        },
      },
    },
    artifact: {
      id: 'terminal-session-safe-transcript',
      type: 'terminal-session',
      producerScenario: 'terminal-session-preview',
      schemaVersion: '0.1.0',
      data: {
        rawJson: '{"trace":"hidden"}',
        trace: { step: 'hidden' },
      },
    },
    helpers: {
      ArtifactSourceBar: () => 'Active result',
      ArtifactDownloads: () => 'Activity',
      ComponentEmptyState: () => 'step summaries',
    },
  }));

  assert.match(html, /terminal stdout line/);
  assert.match(html, /data-cwd="\/workspace\/SciForge"/);
  assert.doesNotMatch(html, /AGENT SUMMARY LEAK|TRACE LEAK|ACTIVITY LEAK/);
  assert.doesNotMatch(html, /SECRET_TOKEN|agent answer summary|rawJson|\{"trace":"hidden"\}/);
  assert.doesNotMatch(html, /Active result|Activity|step summaries/);
  assert.doesNotMatch(html, /type="application\/json"|data-terminal-callback-props/);
});

test('terminal session viewer imports no runtime side-effect modules', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /child_process|node-pty|@xterm|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(/);
});
