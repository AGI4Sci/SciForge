import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const stylesDir = new URL('./styles/', import.meta.url);
const stylesPath = fileURLToPath(stylesDir);

function readStyle(name: string) {
  return readFileSync(new URL(`./styles/${name}`, import.meta.url), 'utf8');
}

function readDesignSystemStyle(name: string) {
  return readFileSync(new URL(`../../../packages/design-system/${name}`, import.meta.url), 'utf8');
}

test('theme stylesheet exposes semantic dark and light tokens', () => {
  const base = readStyle('base.css');
  const theme = readDesignSystemStyle('theme.css');
  const requiredTokens = [
    '--surface',
    '--surface-muted',
    '--surface-raised',
    '--border',
    '--border-strong',
    '--text-primary',
    '--text-secondary',
    '--accent',
    '--warning',
    '--danger',
    '--shadow',
    '--focus-ring',
  ];

  for (const token of requiredTokens) {
    assert.match(theme, new RegExp(`${token}:`), `${token} should be defined`);
  }

  assert.match(base, /@import '..\/..\/..\/..\/packages\/design-system\/theme\.css';/);
  assert.match(theme, /:root,\s*\.theme-dark\s*{/);
  assert.match(theme, /:root:has\(\.theme-light\),\s*\.theme-light\s*{/);
  assert.match(theme, /--surface:\s*rgba\(255,\s*255,\s*255,\s*0\.88\)/);
  assert.match(theme, /--text-primary:\s*#152033/);
});

test('light theme override layer is loaded and covers core app surfaces', () => {
  const app = readStyle('app.css');
  const theme = readStyle('theme-overrides.css');

  assert.match(app, /@import '..\/..\/..\/..\/packages\/design-system\/components\.css';/);
  assert.match(app, /@import '\.\/theme-overrides\.css';/);
  for (const selector of [
    '.theme-light .sidebar',
    '.theme-light .topbar',
    '.theme-light .chat-panel',
    '.theme-light .results-panel',
    '.theme-light .settings-dialog',
    '.theme-light .feedback-layer',
    '.theme-light .component-contract-panel',
    '.theme-light .workbench-canvas-shell',
  ]) {
    assert.match(theme, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('page styles keep hard-coded dark surface colors scarce', () => {
  const darkSurfacePattern = /rgba\((?:5, 8, 16|10, 15, 26|15, 22, 35|26, 35, 50|46, 61, 85|8, 13, 24|7, 10, 18|58, 76, 107)[^)]+\)|#050810|#0A0F1A|#0F1623|#1A2332|#243044/gi;
  const cssFiles = readdirSync(stylesPath)
    .filter((file) => file.endsWith('.css') && file !== 'base.css')
    .map((file) => join(stylesPath, file));

  const matches = cssFiles.flatMap((file) => readFileSync(file, 'utf8').match(darkSurfacePattern) ?? []);
  assert.ok(matches.length <= 24, `expected at most 24 hard-coded dark surfaces, found ${matches.length}`);
});
