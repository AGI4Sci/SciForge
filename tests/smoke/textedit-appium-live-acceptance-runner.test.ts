import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runTextEditAppiumLiveAcceptance } from '../../tools/textedit-appium-live-acceptance.js';

const documentText = [
  'sciforge-computer-use-proof',
  '- 操作真实 TextEdit',
  '- 保存本地文件',
  '- 验证内容正确',
  '当前日期: 2026-06-07',
].join('\n');

test('TextEdit Appium live acceptance writes blocked manifest when live executor env is incomplete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-textedit-live-blocked-'));
  const manifest = await runTextEditAppiumLiveAcceptance({
    root,
    env: {},
    now: () => new Date('2026-06-07T00:00:00.000Z'),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.equal(manifest.sharedSystemInputUsed, false);
  assert.deepEqual(manifest.missingEnv, [
    'SCIFORGE_APPIUM_MAC2_SERVER_URL',
    'SCIFORGE_APPIUM_MAC2_EXECUTOR',
    'SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH',
  ]);
  assert.match(manifest.reason ?? '', /missing Appium Mac2 live executor env/i);
  const persisted = JSON.parse(await readFile(join(root, 'docs', 'test-artifacts', 'textedit-appium-live-acceptance', 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'blocked');
  assert.doesNotMatch(JSON.stringify(persisted), /workspace-file-writer|shared-system-input|osascript|CGEvent|secret|token/i);
});

test('TextEdit Appium live acceptance can pass through bounded Appium fixture and artifact validator', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-textedit-live-passed-'));
  const artifactPath = join(root, 'sciforge-computer-use-proof.txt');
  await writeFile(artifactPath, `${documentText}\n`, 'utf8');
  const server = await startWebDriverFixture(documentText);
  try {
    const manifest = await runTextEditAppiumLiveAcceptance({
      root,
      env: {
        SCIFORGE_APPIUM_MAC2_SERVER_URL: server.url,
        SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
        SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH: artifactPath,
      },
      documentText,
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });

    assert.equal(manifest.status, 'passed', manifest.reason);
    assert.equal(manifest.releaseEligible, true);
    assert.equal(manifest.targetSoftware, 'TextEdit');
    assert.ok(manifest.evidenceRefs.includes('appium-mac2:textedit/actions/textedit-live-type/type-input'));
    assert.ok(manifest.evidenceRefs.includes('appium-mac2:textedit/actions/textedit-live-save/save-input'));
    assert.ok(manifest.evidenceRefs.includes('appium-mac2:textedit/actions/textedit-live-save/artifact-validator/content-match'));
    assert.equal(manifest.desktopSoftwareTaskEvidence?.status, 'passed');
    assert.deepEqual(manifest.desktopSoftwareTaskEvidence?.missing, []);
    assert.match(manifest.finalAnswerRef ?? '', /^appium-mac2:textedit\/final-answer/);
    assert.equal(server.requests.filter((request) => request.path.endsWith('/actions')).length, 2);
    assert.doesNotMatch(JSON.stringify(manifest), /http:\/\/|\/tmp|sciforge-computer-use-proof\.txt|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token/i);
  } finally {
    await server.close();
  }
});

async function startWebDriverFixture(sourceText: string) {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', path, body });
    if (req.method === 'POST' && path === '/session') {
      return writeJson(res, 200, { value: { sessionId: `session-${requests.length}`, capabilities: {} } });
    }
    if (req.method === 'POST' && /^\/session\/session-\d+\/actions$/.test(path)) {
      return writeJson(res, 200, { value: null });
    }
    if (req.method === 'GET' && /^\/session\/session-\d+\/source$/.test(path)) {
      return writeJson(res, 200, { value: `<AXApplication><AXTextArea value="${xmlEscape(sourceText)}"/></AXApplication>` });
    }
    if (req.method === 'DELETE' && /^\/session\/session-\d+$/.test(path)) {
      return writeJson(res, 200, { value: null });
    }
    return writeJson(res, 404, { value: { error: 'unknown command' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address');
  const tcpAddress: AddressInfo = address;
  return {
    url: `http://127.0.0.1:${tcpAddress.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
