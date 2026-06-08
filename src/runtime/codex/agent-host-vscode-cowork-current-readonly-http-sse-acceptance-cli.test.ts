import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  parseArgs,
} from '../../../tools/current-vscode-cowork-readonly-http-sse-acceptance.js';

const execFileAsync = promisify(execFile);

test('current VSCode co-work read-only HTTP/SSE acceptance CLI keeps command override', () => {
  assert.equal(parseArgs([]).commandText, undefined);
  assert.equal(parseArgs([]).json, false);
  assert.equal(parseArgs(['--command-text', '读取当前 VSCode 可见文本']).commandText, '读取当前 VSCode 可见文本');
  assert.equal(parseArgs(['--json']).json, true);
});

test('current VSCode co-work read-only HTTP/SSE acceptance CLI writes blocked manifest by default', async () => {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-http-sse-cli-'));
  try {
    const outputDir = join(workspace, 'out');
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/current-vscode-cowork-readonly-http-sse-acceptance.ts',
      '--workspace',
      workspace,
      '--out',
      outputDir,
      '--json',
    ], {
      cwd: repoRoot,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
      },
    });
    const cliOutput = JSON.parse(stdout) as {
      status?: string;
      manifestPath?: string;
      maturity?: string;
      productReady?: boolean;
      operation?: string;
      httpSseTransportUsed?: boolean;
      adapterBoundaryUsed?: boolean;
    };
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: string;
      blockedReasons?: string[];
      productReady?: boolean;
      operation?: string;
      httpSseTransportUsed?: boolean;
      adapterBoundaryUsed?: boolean;
      vscodeLaunched?: boolean;
      userVSCodeKilled?: boolean;
      userProfileCleared?: boolean;
    };

    assert.equal(cliOutput.status, 'blocked');
    assert.equal(cliOutput.manifestPath, join(outputDir, 'manifest.json'));
    assert.equal(cliOutput.maturity, 'live-diagnostic');
    assert.equal(cliOutput.productReady, false);
    assert.equal(cliOutput.operation, 'read-visible-text');
    assert.equal(cliOutput.httpSseTransportUsed, false);
    assert.equal(cliOutput.adapterBoundaryUsed, false);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.operation, 'read-visible-text');
    assert.equal(manifest.httpSseTransportUsed, false);
    assert.equal(manifest.adapterBoundaryUsed, false);
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.ok(manifest.blockedReasons?.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.doesNotMatch(`${stdout}\n${manifestText}`, /product-ready|kill-vscode|clear-profile|base64|secret|token|providerPayload|raw-/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
