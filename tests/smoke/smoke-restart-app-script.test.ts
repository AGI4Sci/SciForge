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

test('restart-app script matches stale npm dev and Runtime processes in this workspace family', async () => {
  const script = await readFile(join(process.cwd(), 'restart-app.sh'), 'utf8');

  for (const pattern of [
    'tools/dev.ts',
    'tools/dev-dual.ts',
    'tools/desktop-dev-shell.ts',
    'server/index.ts',
  ]) {
    assert.match(script, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `APP_PATTERNS should include ${pattern}`);
  }
  assert.doesNotMatch(script, /sciforge-goose-proxy\.mjs|dist-desktop\/packages\/backend\/src\/cli\.js/);
});

test('restart-app script launches desktop dev with Model Router env from config.local defaults', async () => {
  const script = await readFile(join(process.cwd(), 'restart-app.sh'), 'utf8');
  const healthPorts = script.match(/HEALTH_PORTS=\(([^)]*)\)/)?.[1] ?? '';
  const launchCommand = script.match(/tmux new-session[\s\S]*?npm run desktop:dev 2>&1 \| tee/)?.[0] ?? '';

  assert.match(script, /SCIFORGE_CONFIG_PATH="\$\{SCIFORGE_CONFIG_PATH:-\$ROOT_DIR\/config\.local\.json\}"/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_PORT="\$\{SCIFORGE_MODEL_ROUTER_PORT:-5175\}"/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_BASE_URL="\$\(normalize_openai_base_url "\$\{SCIFORGE_MODEL_ROUTER_BASE_URL:-\$\{SCIFORGE_MODEL_ROUTER_URL:-http:\/\/127\.0\.0\.1:\$\{SCIFORGE_MODEL_ROUTER_PORT\}\}\}"\)"/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_API_KEY="\$\{SCIFORGE_MODEL_ROUTER_API_KEY:-sciforge-local-model-router\}"/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS="\$\{SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS:-sciforge-router\}"/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE="\$\{SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE:-sciforge-runtime-default\}"/);
  assert.match(script, /env \\\s+SCIFORGE_CONFIG_PATH=/);
  assert.match(script, /SCIFORGE_MODEL_ROUTER_BASE_URL=/);
  assert.match(launchCommand, /SCIFORGE_MODEL_ROUTER_API_KEY=/);
  assert.match(launchCommand, /SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS=/);
  assert.doesNotMatch(launchCommand, /SCIFORGE_PROXY_/);
  assert.doesNotMatch(launchCommand, /SCIFORGE_RUNTIME_API_KEY=|SCIFORGE_RUNTIME_MODEL=/);
  assert.doesNotMatch(script, /SCIFORGE_MODEL_ROUTER_PORT="\$\{SCIFORGE_MODEL_ROUTER_PORT:-\$\{SCIFORGE_PROXY_PORT/);
  assert.doesNotMatch(script, /SCIFORGE_PROXY_PORT="\$\{SCIFORGE_PROXY_PORT:-|SCIFORGE_PROXY_BASE_URL="\$\{SCIFORGE_PROXY_BASE_URL:-/);
  assert.match(script, /npm run desktop:dev/);
  assert.match(healthPorts, /\$SCIFORGE_MODEL_ROUTER_PORT|\$\{SCIFORGE_MODEL_ROUTER_PORT\}/, 'HEALTH_PORTS should wait for the active Model Router port');
});
