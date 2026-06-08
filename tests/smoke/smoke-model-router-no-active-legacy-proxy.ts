import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const backendPackageJson = JSON.parse(await readFile(join(root, 'packages/backend/package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
};
const sidecarBundler = await readFile(join(root, 'tools/build-desktop-sidecars.ts'), 'utf8');
const backendCli = await readFile(join(root, 'packages/backend/src/cli.ts'), 'utf8');
const activeDesktopLaunchHarnesses = await Promise.all([
  'tests/smoke/smoke-desktop-browser-native-live-acceptance.ts',
  'tools/desktop-computer-use-hard-confirm-product-smoke-runner.ts',
  'tests/smoke/smoke-desktop-electron-lifecycle.ts',
  'tests/smoke/packaged-electron-lifecycle-smoke.ts',
].map(async (file) => ({
  file,
  text: await readFile(join(root, file), 'utf8'),
})));

assert.doesNotMatch(packageJson.scripts?.['backend:codex-proxy'] ?? '', /packages\/backend\/src\/cli\.ts|codex-responses-proxy/i, 'root backend:codex-proxy must not launch the legacy proxy');
assert.match(packageJson.scripts?.['backend:codex-proxy'] ?? '', /backend:model-router|legacy.*disabled|Model Router/i, 'root backend:codex-proxy must redirect operators to Model Router');
assert.doesNotMatch(backendPackageJson.scripts?.['codex:proxy'] ?? '', /src\/cli\.ts|codex-responses-proxy/i, 'backend codex:proxy must not launch the legacy proxy');
assert.match(backendPackageJson.scripts?.['codex:proxy'] ?? '', /backend:model-router|legacy.*disabled|Model Router/i, 'backend codex:proxy must redirect operators to Model Router');
assert.equal(backendPackageJson.exports?.['./codex-responses-proxy'], undefined, 'backend package must not publicly export the legacy responses proxy');
assert.doesNotMatch(backendCli, /startCodexResponsesProxyServer|resolveProxyCliOptions/, 'direct backend CLI must not remain an alternate launcher for the legacy responses proxy');
assert.match(backendCli, /backend:model-router|legacy.*disabled|Model Router/i, 'direct backend CLI must hard-fail and point operators at Model Router');
assert.doesNotMatch(sidecarBundler, /sidecars[\s\S]*packages\/backend\/src\/cli\.ts/, 'desktop sidecar bundle list must not include the legacy backend proxy CLI');
assert.match(sidecarBundler, /packages\/workers\/model-router\/src\/cli\.ts/, 'desktop sidecar bundle list must include Model Router');
for (const harness of activeDesktopLaunchHarnesses) {
  assert.doesNotMatch(
    harness.text,
    /\bSCIFORGE_PROXY_(?:UPSTREAM_BASE_URL|DEFAULT_MODEL|API_KEY_ENV|QUIET)\s*:/,
    `${harness.file} must inject member-model env through Model Router, not legacy proxy env`,
  );
}

console.log('[ok] active scripts and desktop sidecar bundle do not launch legacy codex-responses-proxy');
