import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopPlatformService } from './platform-service.js';
import { createElectronShellBoundary } from './electron-shell-boundary.js';

test('platform service quotes paths without delegating shell parsing to React/UI', () => {
  assert.equal(new DesktopPlatformService({ platform: 'darwin' }).quotePath("/tmp/O'Hara file"), "'/tmp/O'\\''Hara file'");
  assert.equal(new DesktopPlatformService({ platform: 'linux' }).quotePath('/tmp/with space'), "'/tmp/with space'");
  assert.equal(new DesktopPlatformService({ platform: 'win32' }).quotePath('C:\\Program Files\\SciForge'), '"C:\\Program Files\\SciForge"');
});

test('platform service centralizes platform command plans', () => {
  assert.deepEqual(
    new DesktopPlatformService({ platform: 'darwin' }).openExternalPlan('https://example.test/path'),
    { command: 'open', args: ['https://example.test/path'] },
  );
  assert.deepEqual(
    new DesktopPlatformService({ platform: 'win32' }).revealInFolderPlan('C:\\tmp\\report.md'),
    { command: 'explorer.exe', args: ['/select,', 'C:\\tmp\\report.md'] },
  );
  assert.match(
    new DesktopPlatformService({ platform: 'linux' }).terminalCommandPlan('/tmp/SciForge Workspace', 'npm run build').args.join(' '),
    /cd '\/tmp\/SciForge Workspace' && npm run build/,
  );
});

test('platform service rejects non-web external URLs', () => {
  assert.throws(
    () => new DesktopPlatformService({ platform: 'darwin' }).openExternalPlan('file:///etc/passwd'),
    /Refusing to open non-web URL/,
  );
});

test('Electron boundary loads build artifacts and rejects Vite dev server contracts', () => {
  const boundary = createElectronShellBoundary({
    rendererDistPath: '/Applications/workspace/ailab/research/app/SciForge-p7-launcher-desktop/dist',
    runtimeControlUrl: 'http://127.0.0.1:49152',
  });
  assert.equal(boundary.rendererSource, 'vite-build-artifact');
  assert.match(boundary.rendererEntry, /dist\/index\.html$/);
  assert.equal(boundary.runtimeTransport.kind, 'ipc-or-loopback');
  assert.throws(
    () => createElectronShellBoundary({
      rendererDistPath: 'http://127.0.0.1:5179',
      runtimeControlUrl: 'http://127.0.0.1:49152',
    }),
    /must not treat Vite dev server URLs/,
  );
});
