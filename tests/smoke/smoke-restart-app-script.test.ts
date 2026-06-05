import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

test('restart-app script clears stale chat runtime ports before launching desktop dev', async () => {
  const script = await readFile(join(process.cwd(), 'restart-app.sh'), 'utf8');
  const appPorts = script.match(/APP_PORTS=\(([^)]*)\)/)?.[1] ?? '';

  for (const port of ['3891', '3892', '5173', '5174', '5175', '5176', '6173', '18080']) {
    assert.match(appPorts, new RegExp(`(^|\\s)${port}(\\s|$)`), `APP_PORTS should include ${port}`);
  }
});

test('restart-app script matches stale npm dev and AgentServer processes in this workspace family', async () => {
  const script = await readFile(join(process.cwd(), 'restart-app.sh'), 'utf8');

  for (const pattern of [
    'tools/dev.ts',
    'tools/dev-dual.ts',
    'tools/desktop-dev-shell.ts',
    'server/index.ts',
    'sciforge-goose-proxy.mjs',
  ]) {
    assert.match(script, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `APP_PATTERNS should include ${pattern}`);
  }
});
