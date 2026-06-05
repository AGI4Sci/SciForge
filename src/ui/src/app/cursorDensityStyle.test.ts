import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appDensityCss = readFileSync(new URL('../styles/app-06.css', import.meta.url), 'utf8');

test('Cursor-density style layer covers the workbench shell, chat, composer, and right dock', () => {
  assert.match(appDensityCss, /Cursor Agent density pass/);

  for (const selector of [
    '.codex-quiet-shell .workbench-grid',
    '.codex-quiet-shell.workbench-canvas-shell',
    '.codex-quiet-shell .workbench-canvas .chat-panel',
    '.codex-quiet-shell .workbench-canvas .results-panel',
    '.codex-quiet-shell .panel-title',
    '.codex-quiet-shell .messages',
    '.codex-quiet-shell .message.assistant-message .message-body',
    '.codex-quiet-shell .message.user .message-body',
    '.codex-quiet-shell .composer',
    '.codex-quiet-shell .composer-icon-button',
    '.codex-quiet-shell .result-tabs',
    '.codex-quiet-shell .result-page-tab',
    '.codex-quiet-shell .result-content',
  ]) {
    assert.ok(appDensityCss.includes(selector), `missing density selector: ${selector}`);
  }
});

test('Cursor-density controls stay compact instead of using large card controls', () => {
  assert.match(appDensityCss, /\.app-shell \.topbar\s*{[^}]*height:\s*52px/s);
  assert.match(appDensityCss, /\.app-shell \.searchbox\s*{[^}]*height:\s*34px/s);
  assert.match(appDensityCss, /\.codex-quiet-shell\.workbench-canvas-shell\s*{[^}]*padding:\s*0/s);
  assert.match(appDensityCss, /\.codex-quiet-shell \.panel-title\s*{[^}]*min-height:\s*44px/s);
  assert.match(appDensityCss, /\.codex-quiet-shell \.composer-icon-button\s*{[^}]*width:\s*28px;[^}]*height:\s*28px/s);
  assert.match(appDensityCss, /\.codex-quiet-shell \.result-page-tab\s*{[^}]*min-height:\s*24px/s);
  assert.match(appDensityCss, /\.codex-quiet-shell \.message\.user \.message-body\s*{[^}]*max-width:\s*min\(62%, 46ch\)/s);
});

test('Cursor-density right pane dock keeps the narrow viewport single-column fallback', () => {
  assert.match(
    appDensityCss,
    /@media \(max-width:\s*960px\)\s*{[\s\S]*?\.codex-quiet-shell \.right-pane-tool-dock\s*{[^}]*grid-template-columns:\s*1fr/s,
  );
});

test('Cursor-density right pane chrome uses a flat IDE header instead of pill toolbars', () => {
  assert.match(appDensityCss, /\.codex-quiet-shell \.result-tabs\s*{[^}]*min-height:\s*30px/s);
  assert.match(appDensityCss, /\.codex-quiet-shell \.result-tabstrip\s*{[^}]*border:\s*0;[^}]*background:\s*transparent/s);
  assert.match(
    appDensityCss,
    /\.codex-quiet-shell \.result-page-tab-item\.active,[\s\S]*?\.codex-quiet-shell \.result-page-tab-item\.active \.result-page-tab\s*{[^}]*color:\s*var\(--bio-100\);[^}]*background:\s*color-mix\(in srgb, var\(--surface-hover\) 64%, transparent\)/s,
  );
  assert.match(appDensityCss, /\.codex-quiet-shell \.result-focus-mode\s*{[^}]*border:\s*0;[^}]*background:\s*transparent/s);
});
