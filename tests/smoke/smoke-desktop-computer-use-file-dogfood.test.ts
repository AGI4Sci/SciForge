import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION,
  runDesktopComputerUseFileDogfood,
  type DesktopComputerUseFileDogfoodExecutor,
} from '../../src/runtime/desktop-computer-use-file-dogfood.js';

test('Desktop Computer Use file dogfood smoke script is wired', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.['smoke:desktop-computer-use-file-dogfood'],
    'tsx tools/desktop-computer-use-file-dogfood.ts',
  );
  assert.equal(
    packageJson.scripts?.['smoke:desktop-computer-use-file-dogfood:test'],
    'node --import tsx --test tests/smoke/smoke-desktop-computer-use-file-dogfood.test.ts',
  );
  assert.match(
    packageJson.scripts?.['verify:computer-use:desktop-product'] ?? '',
    /smoke:desktop-computer-use-file-dogfood:test/,
  );
});

test('Desktop Computer Use file dogfood writes refs-first proof without leaking local config secrets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-file-dogfood-'));
  const outputDir = join(workspace, 'out');
  const configPath = join(workspace, 'config.local.json');
  const secret = 'LOCAL_FILE_DOGFOOD_SECRET_SHOULD_NOT_LEAK';
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: secret,
      model: 'local-model',
    },
  }), 'utf8');
  const calls: Array<{ kind: string; filePath?: string; content?: string }> = [];
  const executor: DesktopComputerUseFileDogfoodExecutor = {
    platform: 'darwin',
    async observeTarget(input) {
      calls.push({ kind: `observe-${input.phase}` });
      return {
        targetWindowRef: 'window:macos/TextEdit/123',
        screenshotRef: `desktop-computer-use-file-dogfood/${input.phase}-screenshot.png`,
        axEvidenceRef: `desktop-computer-use-file-dogfood/${input.phase}-ax.json`,
        appName: 'TextEdit',
        windowTitle: input.phase === 'before' ? 'Untitled' : 'sciforge-computer-use-proof.txt',
      };
    },
    async createDocument(input) {
      calls.push({ kind: 'createDocument', filePath: input.filePath, content: input.content });
      await writeFile(input.filePath, input.content, 'utf8');
      return {
        executorEventRef: 'desktop-computer-use-file-dogfood/executor-event.json',
        groundingRef: 'desktop-computer-use-file-dogfood/action-grounding.json',
        fileCreationOwner: 'executor',
      };
    },
  };

  try {
    const manifest = await runDesktopComputerUseFileDogfood({
      workspacePath: workspace,
      outputDir,
      configPath,
      executor,
      now: () => new Date('2026-06-07T08:09:10.000Z'),
    });
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    const finalAnswer = await readFile(join(outputDir, 'final-answer.md'), 'utf8');
    const proofText = await readFile(join(workspace, 'sciforge-computer-use-proof.txt'), 'utf8');

    assert.equal(manifest.schemaVersion, DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.source, 'sciforge-desktop-file-task-dogfood');
    assert.equal(manifest.target.appName, 'TextEdit');
    assert.equal(manifest.fileCreationOwner, 'executor');
    assert.equal(manifest.localConfig.apiKeyPresent, true);
    assert.equal(manifest.localConfig.secretValuesRedacted, true);
    assert.match(proofText, /# sciforge-computer-use-proof/);
    assert.match(proofText, /- 当前日期：2026-06-07/);
    assert.equal(manifest.validation.contentMatches, true);
    assert.equal(manifest.validation.fileExists, true);
    assert.equal(manifest.validationRef.endsWith('/file-validation.json'), true);
    assert.equal(manifest.beforeEvidence.screenshotRef.endsWith('before-screenshot.png'), true);
    assert.equal(manifest.afterEvidence.axEvidenceRef.endsWith('after-ax.json'), true);
    assert.match(finalAnswer, /TextEdit/);
    assert.match(finalAnswer, /sciforge-computer-use-proof\.txt/);
    assert.doesNotMatch(manifestText, new RegExp(secret));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid/);
    assert.deepEqual(calls.map((call) => call.kind), ['observe-before', 'createDocument', 'observe-after']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Desktop Computer Use file dogfood records the task date in the requested timezone', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-file-dogfood-'));
  const outputDir = join(workspace, 'out');
  const configPath = join(workspace, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: 'redacted',
      model: 'local-model',
    },
  }), 'utf8');
  const originalTz = process.env.TZ;
  process.env.TZ = 'UTC';
  const executor: DesktopComputerUseFileDogfoodExecutor = {
    platform: 'darwin',
    async observeTarget(input) {
      return {
        targetWindowRef: 'window:macos/TextEdit/123',
        screenshotRef: `desktop-computer-use-file-dogfood/${input.phase}-screenshot.png`,
        axEvidenceRef: `desktop-computer-use-file-dogfood/${input.phase}-ax.json`,
        appName: 'TextEdit',
        windowTitle: 'sciforge-computer-use-proof.txt',
      };
    },
    async createDocument(input) {
      await writeFile(input.filePath, input.content, 'utf8');
      return {
        executorEventRef: 'desktop-computer-use-file-dogfood/executor-event.json',
        groundingRef: 'desktop-computer-use-file-dogfood/action-grounding.json',
        fileCreationOwner: 'executor',
      };
    },
  };

  try {
    await runDesktopComputerUseFileDogfood({
      workspacePath: workspace,
      outputDir,
      configPath,
      executor,
      now: () => new Date('2026-06-06T18:16:48.000Z'),
      timeZone: 'Asia/Shanghai',
    });
    const proofText = await readFile(join(workspace, 'sciforge-computer-use-proof.txt'), 'utf8');

    assert.match(proofText, /- 当前日期：2026-06-07/);
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Desktop Computer Use file dogfood does not overclaim workspace-writer assisted runs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-file-dogfood-'));
  const outputDir = join(workspace, 'out');
  const configPath = join(workspace, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: 'redacted',
      model: 'local-model',
    },
  }), 'utf8');
  const executor: DesktopComputerUseFileDogfoodExecutor = {
    platform: 'darwin',
    async observeTarget(input) {
      return {
        targetWindowRef: 'window:macos/TextEdit/real-window',
        screenshotRef: `desktop-computer-use-file-dogfood/${input.phase}-screenshot.png`,
        axEvidenceRef: `desktop-computer-use-file-dogfood/${input.phase}-ax.json`,
        appName: 'TextEdit',
        windowTitle: 'sciforge-computer-use-proof.txt',
      };
    },
    async createDocument(input) {
      await writeFile(input.filePath, input.content, 'utf8');
      return {
        executorEventRef: 'desktop-computer-use-file-dogfood/executor-event.json',
        groundingRef: 'desktop-computer-use-file-dogfood/action-grounding.json',
        fileCreationOwner: 'workspace-file-writer-assisted',
      };
    },
  };

  try {
    const manifest = await runDesktopComputerUseFileDogfood({
      workspacePath: workspace,
      outputDir,
      configPath,
      executor,
      now: () => new Date('2026-06-07T08:09:10.000Z'),
    });

    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.fileCreationOwner, 'workspace-file-writer-assisted');
    assert.match(manifest.finalAnswer ?? '', /已写入 workspace 文件/);
    assert.match(manifest.finalAnswer ?? '', /用 TextEdit 打开/);
    assert.doesNotMatch(manifest.finalAnswer ?? '', /通过 TextEdit 创建并保存/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Desktop Computer Use file dogfood failed manifests do not claim visible targets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-file-dogfood-'));
  const outputDir = join(workspace, 'out');
  const configPath = join(workspace, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: 'redacted',
      model: 'local-model',
    },
  }), 'utf8');
  const executor: DesktopComputerUseFileDogfoodExecutor = {
    platform: 'darwin',
    async observeTarget() {
      throw new Error('no target window');
    },
    async createDocument() {
      throw new Error('should not run');
    },
  };

  try {
    const manifest = await runDesktopComputerUseFileDogfood({
      workspacePath: workspace,
      outputDir,
      configPath,
      executor,
      now: () => new Date('2026-06-07T08:09:10.000Z'),
    });

    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.target.visibleToUser, false);
    assert.equal(manifest.target.canCancelOrRetarget, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
