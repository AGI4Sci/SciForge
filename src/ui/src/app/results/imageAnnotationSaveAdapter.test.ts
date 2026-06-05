import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SciForgeConfig } from '../../domain';
import { saveImageAnnotationArtifact } from './imageAnnotationSaveAdapter';

const workspaceConfig: SciForgeConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: 'http://127.0.0.1:8090',
  workspaceWriterBaseUrl: 'http://127.0.0.1:8091',
  workspacePath: '/workspace/sciforge-test',
  agentBackend: 'codex',
  modelProvider: 'openai',
  modelBaseUrl: 'https://api.openai.com/v1',
  modelName: 'test-model',
  apiKey: '',
  requestTimeoutMs: 30_000,
  maxContextWindowTokens: 128_000,
  visionAllowSharedSystemInput: false,
  updatedAt: '2026-06-05T00:00:00.000Z',
};

test('saveImageAnnotationArtifact writes exactly a png and annotation json under the artifact folder', async () => {
  const writes: Array<{
    path: string;
    content: string;
    config: SciForgeConfig;
    options?: { encoding?: 'utf8' | 'base64'; mimeType?: string };
  }> = [];
  const annotation = {
    id: 'ann-1',
    type: 'rect',
    rect: { x: 140, y: 110, width: 80, height: 60 },
    stroke: '#ffcc00',
    strokeWidth: 6,
  };

  const result = await saveImageAnnotationArtifact({
    sessionId: 'session / 42:alpha',
    sourceRef: 'artifact:source-image',
    sourceNaturalSize: { width: 3024, height: 1964 },
    crop: { x: 120, y: 80, width: 1600, height: 1000 },
    annotations: [annotation],
    exportSize: { width: 1600, height: 1000 },
    pngBase64: 'iVBORw0KGgo=',
    workspaceConfig,
  }, {
    id: () => 'edit:42/alpha',
    now: () => new Date('2026-06-05T01:02:03.004Z'),
    writeWorkspaceFile: async (path, content, config, options) => {
      writes.push({ path, content, config, options });
      return {
        path,
        name: path.split('/').at(-1) ?? path,
        content,
        size: content.length,
        language: 'text',
        encoding: options?.encoding,
        mimeType: options?.mimeType,
      };
    },
  });

  const artifactId = 'image-edit-20260605T010203004Z-edit-42-alpha';
  const expectedBase = `.sciforge/artifacts/session-42-alpha/${artifactId}`;
  const pngPath = `${expectedBase}/image.png`;
  const jsonPath = `${expectedBase}/annotation.json`;
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((write) => write.path), [pngPath, jsonPath]);
  assert.equal(writes[0]?.content, 'iVBORw0KGgo=');
  assert.equal(writes[0]?.config, workspaceConfig);
  assert.deepEqual(writes[0]?.options, { encoding: 'base64', mimeType: 'image/png' });

  assert.equal(writes[1]?.config, workspaceConfig);
  assert.deepEqual(writes[1]?.options, { encoding: 'utf8', mimeType: 'application/json' });
  const document = JSON.parse(writes[1]?.content ?? '{}');
  assert.deepEqual(document, {
    schema: 'sciforge.image-annotation.v1',
    sourceRef: 'artifact:source-image',
    sourceNaturalSize: { width: 3024, height: 1964 },
    crop: { x: 120, y: 80, width: 1600, height: 1000 },
    annotations: [annotation],
    export: { format: 'png', width: 1600, height: 1000 },
    createdAt: '2026-06-05T01:02:03.004Z',
    exportedImageRef: pngPath,
  });

  assert.deepEqual(result, {
    sourceKind: 'artifact',
    imageRef: pngPath,
    ref: pngPath,
    mime: 'image/png',
    width: 1600,
    height: 1000,
    createdAt: '2026-06-05T01:02:03.004Z',
    provenanceRef: jsonPath,
    annotationRefs: [jsonPath],
    artifactRef: `artifact:${artifactId}`,
  });
});

test('saveImageAnnotationArtifact keeps crop explicit and does not mutate chat or composer state', async () => {
  const writes: Array<{ path: string; content: string }> = [];
  const messages = Object.freeze([{ id: 'message-1', content: 'keep me' }]);
  const references = Object.freeze([{ ref: 'artifact:source-image' }]);
  const composer = Object.freeze({ text: 'draft' });
  let mutationCallbackCount = 0;

  const input = {
    sessionId: '../raw session',
    sourceRef: 'artifact:source-image',
    sourceNaturalSize: { width: 400, height: 300 },
    annotations: [],
    exportSize: { width: 400, height: 300 },
    pngBase64: 'PNG',
    workspaceConfig,
    messages,
    references,
    composer,
    onSaved: () => { mutationCallbackCount += 1; },
    onComposerReference: () => { mutationCallbackCount += 1; },
  };

  const result = await saveImageAnnotationArtifact(input, {
    id: () => 'empty edit',
    now: () => new Date('2026-06-05T06:07:08.009Z'),
    writeWorkspaceFile: async (path, content) => {
      writes.push({ path, content });
      return {
        path,
        name: path.split('/').at(-1) ?? path,
        content,
        size: content.length,
        language: 'text',
      };
    },
  });

  assert.deepEqual(messages, [{ id: 'message-1', content: 'keep me' }]);
  assert.deepEqual(references, [{ ref: 'artifact:source-image' }]);
  assert.deepEqual(composer, { text: 'draft' });
  assert.equal(mutationCallbackCount, 0);
  assert.equal((result as { composerInsertion?: unknown }).composerInsertion, undefined);

  const document = JSON.parse(writes.find((write) => write.path.endsWith('/annotation.json'))?.content ?? '{}');
  assert.equal(Object.hasOwn(document, 'crop'), false);
  assert.deepEqual(document.annotations, []);
});

test('save adapter defaults to the workspace client writer without composer or chat mutation hooks', () => {
  const source = readFileSync(new URL('./imageAnnotationSaveAdapter.ts', import.meta.url), 'utf8');

  assert.match(source, /writeWorkspaceFile/);
  assert.doesNotMatch(source, /composer|messages|references|onSaved|onComposer|set[A-Z]/);
});
