import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createDefaultDesktopManagedServices } from './main.js';

test('desktop main starts the managed Model Router sidecar with the workspace root', () => {
  const appRoot = '/Applications/SciForge';
  const workspacePath = '/Users/example/SciForge/workspace';
  const services = createDefaultDesktopManagedServices(appRoot, {
    workspacePath,
    command: 'node',
  });

  const modelRouter = services.find((service) => service.id === 'model-router');
  assert.ok(modelRouter);
  assert.equal(modelRouter.role, 'model-router');
  assert.equal(modelRouter.command, 'node');
  assert.equal(modelRouter.args?.[0], join(appRoot, 'dist-desktop', 'packages', 'workers', 'model-router', 'src', 'cli.js'));
  assert.deepEqual(modelRouter.args?.slice(1), ['--quiet', '--workspace-root', workspacePath]);
});
