import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopSecretStorage, MockSecretVault } from './secret-storage.js';

const scope = { service: 'sciforge-runtime-provider', account: 'deepseek' };

test('secret storage is mockable through the credential vault contract', async () => {
  const vault = new MockSecretVault();
  const storage = new DesktopSecretStorage({ vault });
  await storage.write(scope, 'secret-value');
  assert.equal(await storage.read(scope), 'secret-value');
  await storage.delete(scope);
  assert.equal(await storage.read(scope), undefined);
});

test('secret storage fails closed when no system vault is available', async () => {
  const storage = new DesktopSecretStorage();
  await assert.rejects(() => storage.write(scope, 'secret-value'), /refusing plaintext provider secret/i);
  await assert.rejects(() => storage.read(scope), /system credential vault is required/i);
});

test('secret storage only permits plaintext fallback when explicitly enabled for debug', async () => {
  const storage = new DesktopSecretStorage({ allowPlaintextDebugFallback: true });
  await storage.write(scope, 'debug-secret');
  assert.equal(await storage.read(scope), 'debug-secret');
});

test('secret storage propagates vault failures instead of silently falling back', async () => {
  const vault = new MockSecretVault();
  vault.failWith = new Error('keychain unavailable');
  const storage = new DesktopSecretStorage({ vault, allowPlaintextDebugFallback: true });
  await assert.rejects(() => storage.write(scope, 'secret-value'), /keychain unavailable/);
});
