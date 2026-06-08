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

const execFileAsync = promisify(execFile);

test('current VSCode co-work readonly live acceptance CLI writes blocked manifest by default', async () => {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-cli-'));
  try {
    const outputDir = join(workspace, 'out');
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/current-vscode-cowork-readonly-live-acceptance.ts',
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
    };
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: string;
      blockedReasons?: string[];
      productReady?: boolean;
      vscodeLaunched?: boolean;
      userVSCodeKilled?: boolean;
      userProfileCleared?: boolean;
    };

    assert.equal(cliOutput.status, 'blocked');
    assert.equal(cliOutput.manifestPath, join(outputDir, 'manifest.json'));
    assert.equal(cliOutput.maturity, 'live-diagnostic');
    assert.equal(cliOutput.productReady, false);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.ok(manifest.blockedReasons?.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.doesNotMatch(`${stdout}\n${manifestText}`, /product-ready|kill-vscode|clear-profile|base64|secret|token/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
