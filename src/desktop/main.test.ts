import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createDefaultDesktopManagedServices } from './main.js';

test('desktop main starts the managed provider sidecar through Model Router with the workspace root', () => {
  const appRoot = '/Applications/SciForge';
  const workspacePath = '/Users/example/SciForge/workspace';
  const services = createDefaultDesktopManagedServices(appRoot, {
    workspacePath,
    command: 'node',
  });

  const providerSidecar = services.find((service) => service.id === 'provider-proxy');
  assert.ok(providerSidecar);
  assert.equal(providerSidecar.role, 'provider-proxy');
  assert.equal(providerSidecar.command, 'node');
  assert.equal(providerSidecar.args?.[0], join(appRoot, 'dist-desktop', 'packages', 'workers', 'model-router', 'src', 'cli.js'));
  assert.deepEqual(providerSidecar.args?.slice(1), ['--quiet', '--workspace-root', workspacePath]);
});
