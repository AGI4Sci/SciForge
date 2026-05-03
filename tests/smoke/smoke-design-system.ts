import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../packages/design-system/package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
};
const themeCss = readFileSync(new URL('../../packages/design-system/theme.css', import.meta.url), 'utf8');
const componentsCss = readFileSync(new URL('../../packages/design-system/components.css', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../../src/ui/src/styles/base.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../src/ui/src/styles/app.css', import.meta.url), 'utf8');

assert.equal(packageJson.exports['.'], './src/index.tsx');
assert.equal(packageJson.exports['./theme.css'], './theme.css');
assert.equal(packageJson.exports['./components.css'], './components.css');

for (const token of [
  '--surface',
  '--surface-muted',
  '--surface-raised',
  '--border',
  '--text-primary',
  '--accent',
  '--danger',
  '--warning',
  '--shadow',
  '--focus-ring',
  '--radius',
  '--space-4',
]) {
  assert.match(themeCss, new RegExp(`${token}:`), `${token} should be defined in design-system theme.css`);
}

assert.match(themeCss, /:root,\s*\.theme-dark\s*{/);
assert.match(themeCss, /:root:has\(\.theme-light\),\s*\.theme-light\s*{/);
assert.match(themeCss, /--surface:\s*rgba\(255,\s*255,\s*255,\s*0\.88\)/);
assert.match(themeCss, /--text-primary:\s*#152033/);

for (const selector of ['.card', '.panel', '.badge', '.icon-button', '.action-button', '.tabbar', '.empty-runtime-state', '.ds-input']) {
  assert.match(componentsCss, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

assert.match(baseCss, /@import '..\/..\/..\/..\/packages\/design-system\/theme\.css';/);
assert.match(appCss, /@import '..\/..\/..\/..\/packages\/design-system\/components\.css';/);

console.log('design-system package smoke passed');
