import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileToUploadedArtifact } from './uploadedArtifact';
import type { SciForgeConfig } from '../../domain';

test('image uploads carry a pending vision descriptor ref for async pre-extraction', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      file: { path: '/workspace/.sciforge/uploads/session-test/upload-hotel.jpg' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    const artifact = await fileToUploadedArtifact(
      new File([new Uint8Array([1, 2, 3])], '酒店凭证.jpg', { type: 'image/jpeg' }),
      'literature-evidence-review',
      {
        workspacePath: '/workspace',
        workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
      } as SciForgeConfig,
      'session-test',
    );

    const descriptor = artifact.metadata?.visionDescriptor as Record<string, unknown> | undefined;
    assert.equal(descriptor?.schemaVersion, 'sciforge.runtime.input-object.vision-descriptor.v1');
    assert.equal(descriptor?.status, 'pending');
    assert.equal(descriptor?.source, 'upload-preextract');
    assert.match(String(descriptor?.descriptorRef ?? ''), /^\.sciforge\/vision-descriptors\/session-test\/upload-/);
    assert.equal((artifact.data as Record<string, unknown>).visionDescriptor, descriptor);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
