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
} from '../../../tools/current-vscode-cowork-insert-draft-live-acceptance.js';

const execFileAsync = promisify(execFile);

test('current VSCode co-work insert-draft live acceptance CLI keeps draft ref and activation opt-in', () => {
  assert.equal(parseArgs([]).draftTextRef, undefined);
  assert.equal(parseArgs([]).activateCurrentVSCodeIfNeeded, false);
  assert.equal(parseArgs(['--draft-text-ref', 'text-ref:current-vscode-cowork:draft:p9c']).draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
  assert.equal(parseArgs(['--activate-vscode']).activateCurrentVSCodeIfNeeded, true);
});

test('current VSCode co-work insert-draft live acceptance CLI writes blocked manifest by default', async () => {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-cli-'));
  try {
    const outputDir = join(workspace, 'out');
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/current-vscode-cowork-insert-draft-live-acceptance.ts',
      '--workspace',
      workspace,
      '--out',
      outputDir,
      '--draft-text-ref',
      'text-ref:current-vscode-cowork:draft:p9c',
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
      draftTextRef?: string;
    };
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: string;
      blockedReasons?: string[];
      productReady?: boolean;
      operation?: string;
      draftTextRef?: string;
      vscodeLaunched?: boolean;
      userVSCodeKilled?: boolean;
      userProfileCleared?: boolean;
    };

    assert.equal(cliOutput.status, 'blocked');
    assert.equal(cliOutput.manifestPath, join(outputDir, 'manifest.json'));
    assert.equal(cliOutput.maturity, 'live-diagnostic');
    assert.equal(cliOutput.productReady, false);
    assert.equal(cliOutput.operation, 'insert-draft');
    assert.equal(cliOutput.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.operation, 'insert-draft');
    assert.equal(manifest.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.ok(manifest.blockedReasons?.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.doesNotMatch(`${stdout}\n${manifestText}`, /draft body|product-ready|kill-vscode|clear-profile|base64|secret|token/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
