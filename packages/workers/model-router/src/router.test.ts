import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TraceEvent, TraceEventInput } from '@sciforge/full-trace';

import { startModelRouterServer, type ModelRouterConfig } from './router';
import { ModelRouterFullTraceRecorder } from './full-trace-recorder';
import {
  chatCompletionToResponse,
  chatToolNameAliasesFromResponsesTools,
  responseToAnthropicMessage,
} from './response-compat';

const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-png').toString('base64')}`;
const forbiddenPublicSurfacePattern =
  /text-secret|vision-secret|image-secret|Authorization|Bearer|baseUrl|apiKeyEnv|SCIFORGE_TEXT_API_KEY|SCIFORGE_VISION_API_KEY|SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY|text-model|vision-model|image-model|text-provider|vision-provider|image-provider|https:\/\/text\.example|https:\/\/vision\.example|https:\/\/image\.example/i;

test('public manifest exposes only the Model Router worker contract', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-public-manifest-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/manifest`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.workerId, 'sciforge.model-router');
    assert.equal(body.workerVersion, '0.1.0');
    assert.match(serialized, /full_trace/);
    assert.match(serialized, /refs-first/);
    assert.match(serialized, /model_router_capabilities/);
    assert.match(serialized, /\/v1\/capabilities/);
    assert.match(serialized, /\/v1\/responses/);
    assert.match(serialized, /sciforge\.model-router\.responses/);
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('public model list exposes only the configured public alias', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-public-models-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/v1/models`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    const publicModel = {
      slug: 'public-router-alias',
      display_name: 'public-router-alias',
      id: 'public-router-alias',
      object: 'model',
      owned_by: 'sciforge',
      input_modalities: ['text', 'image'],
      supports_image_detail_original: false,
    };
    assert.deepEqual(body, {
      object: 'list',
      data: [publicModel],
      models: [publicModel],
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('authenticated capability discovery exposes only sanitized active-profile readiness and features', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-capabilities-'));
  const config = testConfig({
    publicModelAlias: 'public-router-alias',
    imageGenerator: testImageGeneratorConfig(),
    scientificTranslator: testScientificTranslatorConfig(),
  });
  config.profiles.default.capabilities = {
    vision: {
      mimeTypes: ['image/png', 'IMAGE/JPEG', 'https://private-provider.example/model'],
      maxInputBytes: 4 * 1024 * 1024,
    },
    images: {
      generation: true,
      editing: true,
      referenceImages: true,
      masks: false,
      sizeSelection: true,
      sizes: ['512x512', '1024x1024', 'private-model-size'],
    },
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const unauthorized = await fetch(`${server.url}/v1/capabilities`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${server.url}/v1/capabilities`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body, {
      schemaVersion: 'sciforge.model-router.capabilities.v1',
      publicModelAlias: 'public-router-alias',
      profile: 'default',
      roles: {
        textReasoner: { configured: true, ready: true, state: 'ready' },
        imageGenerator: { configured: true, ready: true, state: 'ready' },
        visionTranslator: { configured: true, ready: true, state: 'ready' },
        scientificTranslator: { configured: true, ready: false, state: 'missing_credentials' },
      },
      vision: {
        available: true,
        input: {
          mimeTypes: ['image/png', 'image/jpeg'],
          maxInputBytes: 4 * 1024 * 1024,
          maxRequestBytes: 40 * 1024 * 1024,
          sources: ['inline', 'url', 'workspace_ref'],
        },
      },
      images: {
        available: true,
        maxRequestBytes: 40 * 1024 * 1024,
        features: {
          generation: true,
          editing: true,
          referenceImages: true,
          masks: false,
          sizeSelection: true,
        },
        sizes: {
          mode: 'enumerated',
          values: ['512x512', '1024x1024'],
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
    assert.doesNotMatch(JSON.stringify(body), /private-provider|private-model/i);
  } finally {
    await server.close();
  }
});

test('capability discovery selects registered profiles and fails closed for unknown profiles', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-profile-capabilities-'));
  const config = testConfig();
  config.profiles.textOnly = {
    textReasoner: config.profiles.default.textReasoner,
    translators: {},
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const selected = await fetch(`${server.url}/v1/capabilities`, {
      headers: runtimeHeaders({ 'x-sciforge-model-router-profile': 'textOnly' }),
    });
    assert.equal(selected.status, 200);
    const body = await selected.json() as Record<string, unknown>;
    assert.equal(body.profile, 'textOnly');
    assert.deepEqual(body.vision, {
      available: false,
      input: {
        mimeTypes: [],
        maxInputBytes: 0,
        maxRequestBytes: 40 * 1024 * 1024,
        sources: ['inline', 'url', 'workspace_ref'],
      },
    });
    assert.deepEqual((body.images as Record<string, unknown>).features, {
      generation: false,
      editing: false,
      referenceImages: false,
      masks: false,
      sizeSelection: false,
    });

    const unknown = await fetch(`${server.url}/v1/capabilities`, {
      headers: runtimeHeaders({ 'x-sciforge-model-router-profile': 'missing' }),
    });
    assert.equal(unknown.status, 400);
    assert.match(await unknown.text(), /unknown_profile/i);
  } finally {
    await server.close();
  }
});

test('runtime model routes require the configured bearer token', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-runtime-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const missing = await fetch(`${server.url}/v1/models`);
    assert.equal(missing.status, 401);
    const missingCapabilities = await fetch(`${server.url}/v1/capabilities`);
    assert.equal(missingCapabilities.status, 401);
    const invalid = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(invalid.status, 401);
    assert.match(await invalid.text(), /unauthorized/i);
  } finally {
    await server.close();
  }
});

test('runtime model routes accept Anthropic x-api-key auth', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-runtime-x-api-key-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/v1/models`, {
      headers: { 'x-api-key': 'runtime-secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal((body.data as Array<Record<string, unknown>>)[0]?.id, 'sciforge-router');
  } finally {
    await server.close();
  }
});

test('image generations route through the configured image generator without exposing provider settings', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-generations-'));
  const calls: CapturedFetch[] = [];
  const imageBase64 = Buffer.from('generated-pixels').toString('base64');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ created: 1, data: [{ b64_json: imageBase64 }] }),
    ]),
  });

  try {
    const missingAuth = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell diagram.' }),
    });
    assert.equal(missingAuth.status, 401);

    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        prompt: 'Draw a cell diagram.',
        size: '512x512',
        n: 1,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body, { created: 1, data: [{ b64_json: imageBase64 }] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://image.example/v1/images/generations');
    assert.equal(calls[0]?.headers.authorization, 'Bearer image-secret');
    assert.deepEqual(calls[0]?.body, {
      model: 'image-model',
      prompt: 'Draw a cell diagram.',
      size: '512x512',
      n: 1,
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);

  } finally {
    await server.close();
  }
});

test('image edits proxy authenticated multipart input through the configured image generator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-edits-'));
  const calls: CapturedFetch[] = [];
  const outputBase64 = Buffer.from('edited-output-pixels').toString('base64');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ created: 2, data: [{ b64_json: outputBase64 }] }),
    ]),
  });

  try {
    const inputPixels = 'private-source-image-pixels';
    const maskPixels = 'private-mask-image-pixels';
    const form = new FormData();
    form.set('model', 'sciforge-router');
    form.set('prompt', 'Repair the disconnected arrow without changing the rest.');
    form.set('size', '1024x1024');
    form.set('n', '1');
    form.set('quality', 'high');
    form.set('input_fidelity', 'high');
    form.set('image', new Blob([inputPixels], { type: 'image/png' }), 'private-source.png');
    form.set('mask', new Blob([maskPixels], { type: 'image/png' }), 'private-mask.png');

    const response = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      headers: runtimeHeaders(),
      body: form,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      created: 2,
      data: [{ b64_json: outputBase64 }],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://image.example/v1/images/edits');
    assert.equal(calls[0]?.headers.authorization, 'Bearer image-secret');
    assert.equal(calls[0]?.headers['content-type'], undefined, 'fetch must generate the multipart boundary');
    assert.deepEqual(calls[0]?.body, {
      model: 'image-model',
      prompt: 'Repair the disconnected arrow without changing the rest.',
      size: '1024x1024',
      n: '1',
      quality: 'high',
      input_fidelity: 'high',
      image: {
        name: 'private-source.png',
        type: 'image/png',
        size: Buffer.byteLength(inputPixels),
        text: inputPixels,
      },
      mask: {
        name: 'private-mask.png',
        type: 'image/png',
        size: Buffer.byteLength(maskPixels),
        text: maskPixels,
      },
    });

  } finally {
    await server.close();
  }
});

test('image edits require runtime auth, multipart input, and the public router model alias', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-edits-validation-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const unauthorized = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      body: imageEditForm('sciforge-router'),
    });
    assert.equal(unauthorized.status, 401);

    const wrongContentType = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router' }),
    });
    assert.equal(wrongContentType.status, 400);

    const wrongModel = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      headers: runtimeHeaders(),
      body: imageEditForm('upstream-private-model'),
    });
    assert.equal(wrongModel.status, 400);
    const body = await wrongModel.json() as Record<string, { code?: string }>;
    assert.equal(body.error?.code, 'unregistered_model');
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('image routes enforce the active profile capability registration before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-capability-enforcement-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig({ imageGenerator: testImageGeneratorConfig() });
  config.profiles.default.capabilities = {
    images: {
      generation: false,
      editing: true,
      referenceImages: false,
      masks: false,
      sizeSelection: true,
      sizes: ['512x512'],
    },
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const generation = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell.' }),
    });
    assert.equal(generation.status, 422);
    assert.equal((await generation.json() as { error: { code: string } }).error.code, 'image_capability_not_supported');

    const maskedEdit = imageEditForm('sciforge-router');
    maskedEdit.set('mask', new Blob(['mask'], { type: 'image/png' }), 'mask.png');
    const maskResponse = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      headers: runtimeHeaders(),
      body: maskedEdit,
    });
    assert.equal(maskResponse.status, 422);
    assert.equal((await maskResponse.json() as { error: { code: string } }).error.code, 'image_masks_not_supported');

    const sizedEdit = imageEditForm('sciforge-router');
    sizedEdit.set('size', '1024x1024');
    const sizeResponse = await fetch(`${server.url}/v1/images/edits`, {
      method: 'POST',
      headers: runtimeHeaders(),
      body: sizedEdit,
    });
    assert.equal(sizeResponse.status, 422);
    assert.equal((await sizeResponse.json() as { error: { code: string } }).error.code, 'image_size_not_supported');
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('image generation provider failures preserve the upstream status', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-failure-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch([], [
      Response.json({ error: { message: 'private upstream failure with image-secret' } }, { status: 503 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'private failure prompt' }),
    });
    assert.equal(response.status, 503);

  } finally {
    await server.close();
  }
});

test('image generation provider timeouts return the timeout classification', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-timeout-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: async () => {
      throw new DOMException('private provider request timed out', 'AbortError');
    },
  });

  try {
    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'private timeout prompt' }),
    });
    assert.equal(response.status, 500);
    const body = await response.json() as Record<string, { code?: string }>;
    assert.equal(body.error?.code, 'provider_exception_timeout');

  } finally {
    await server.close();
  }
});

test('image generations normalize provider image URLs to b64_json before returning to workers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-url-normalize-'));
  const calls: CapturedFetch[] = [];
  const imageBytes = new TextEncoder().encode('downloaded-image');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ created: 1, data: [{ url: 'https://cdn.example/generated.png' }] }),
      new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell diagram.' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(body, {
      created: 1,
      data: [{ b64_json: Buffer.from(imageBytes).toString('base64'), mime_type: 'image/png' }],
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://image.example/v1/images/generations');
    assert.equal(calls[1]?.url, 'https://cdn.example/generated.png');
    assert.equal(calls[1]?.headers.authorization, undefined);
    assert.doesNotMatch(JSON.stringify(body), /cdn\.example|image-secret|Authorization|Bearer/i);
  } finally {
    await server.close();
  }
});

test('image generations normalize data URLs without fetching provider media again', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-data-url-normalize-'));
  const calls: CapturedFetch[] = [];
  const imageBase64 = Buffer.from('inline-image').toString('base64');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ created: 1, data: [{ url: `data:image/png;base64,${imageBase64}` }] }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell diagram.' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { created: 1, data: [{ b64_json: imageBase64, mime_type: 'image/png' }] });
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('image generations fail closed when provider image URL download fails without leaking URL details', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-image-url-fail-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ created: 1, data: [{ url: 'https://cdn.example/secret-image.png?token=secret' }] }),
      new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell diagram.' }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error?.code, 'provider_image_url_http_404');
    assert.doesNotMatch(JSON.stringify(body), /cdn\.example|secret-image|image-secret|Authorization|Bearer/i);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing image generator credentials without leaking provider bindings', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-image-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'imageGenerator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent image generator auth failures after a routed request fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-recent-image-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch([], [
      Response.json({ error: { message: 'bad image key with image-secret' } }, { status: 401 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/images/generations`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Draw a cell diagram.' }),
    });
    assert.equal(failed.status, 401);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'provider_http_401');
    assert.doesNotMatch(JSON.stringify(failedBody), forbiddenPublicSurfacePattern);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'imageGenerator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('generic upstream bases are normalized to the incoming protocol endpoint', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-provider-base-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.baseUrl = 'https://text.example';
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The normalized base URL works.'),
    ]),
  });

  try {
    const initialHealth = await fetch(`${server.url}/healthz?check=upstream`);
    const initialHealthBody = await initialHealth.json() as Record<string, unknown>;
    assert.equal(initialHealthBody.protocol, null);
    assert.equal(initialHealthBody.traceCapture, 'disabled');
    assert.equal(calls.length, 0);

    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'hello',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');

    const negotiatedHealth = await fetch(`${server.url}/healthz?check=upstream`);
    const negotiatedHealthBody = await negotiatedHealth.json() as Record<string, unknown>;
    assert.equal(negotiatedHealthBody.protocol, 'responses');
    assert.equal(negotiatedHealthBody.traceCapture, 'disabled');
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('generic upstream bases preserve query and hash suffixes when normalized', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-provider-base-query-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.baseUrl = 'https://text.example/openai/deployments/deepseek?api-version=2026-01-01#stable';
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The normalized base URL keeps its suffix.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'hello',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      'https://text.example/openai/deployments/deepseek/v1/responses?api-version=2026-01-01#stable'
    );
  } finally {
    await server.close();
  }
});

test('Codex-shaped Responses requests negotiate to a Messages-only upstream without losing reasoning or tools', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-responses-to-messages-'));
  const calls: CapturedFetch[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    const pathname = new URL(String(url)).pathname;
    if (!pathname.endsWith('/messages')) {
      return Response.json({ error: { message: 'endpoint not found' } }, { status: 404 });
    }
    return Response.json({
      id: 'msg_codex_fallback',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need to inspect the repository.', signature: 'signed-reasoning' },
        { type: 'tool_use', id: 'toolu_codex', name: 'inspect_repo', input: { path: '.' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 9, output_tokens: 5, cache_read_input_tokens: 3 },
    });
  };
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl,
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Inspect the repository.',
        max_output_tokens: 4096,
        reasoning: { effort: 'high', summary: 'detailed' },
        tools: [{
          type: 'function',
          name: 'inspect_repo',
          description: 'Inspect a repository path.',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      '/v1/responses',
      '/v1/chat/completions',
      '/v1/messages',
    ]);
    assert.equal(calls[1]?.body.max_tokens, 4096);
    assert.equal(calls[2]?.body.max_tokens, 4096);
    assert.deepEqual(calls[2]?.body.thinking, { type: 'enabled', budget_tokens: 3072 });
    assert.equal(Array.isArray(calls[2]?.body.tools), true);
    assert.deepEqual(body.output.map((item: Record<string, unknown>) => item.type), ['reasoning', 'function_call']);
    assert.equal(body.output[0]?.signature, 'signed-reasoning');
    assert.deepEqual(body.usage, {
      input_tokens: 9,
      output_tokens: 5,
      total_tokens: 14,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens: 9,
      completion_tokens: 5,
      cached_input_tokens: 3,
      reasoning_output_tokens: 0,
    });
  } finally {
    await server.close();
  }
});

test('anthropic messages route through the configured text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The Claude-compatible answer.'),
    ]),
  });

  try {
    const missing = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(missing.status, 401);

    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.type, 'message');
    assert.equal(body.role, 'assistant');
    assert.deepEqual(body.content, [{ type: 'text', text: 'The Claude-compatible answer.' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/messages');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  } finally {
    await server.close();
  }
});

test('Claude-shaped Messages preserve adaptive thinking and native terminal metadata', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-claude-adaptive-'));
  const calls: CapturedFetch[] = [];
  const nativeMessages = (
    id: string,
    stopReason: string,
    stopSequence: string | null,
    content: Array<Record<string, unknown>> = [{ type: 'text', text: 'done' }],
  ) => Response.json({
    id,
    type: 'message',
    role: 'assistant',
    model: 'configured-model',
    content,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: { input_tokens: 4, output_tokens: 2 },
  });
  const streamBody = [
    ['message_start', { type: 'message_start', message: { id: 'msg_stream', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 4, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'streamed' } }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'stop_sequence', stop_sequence: 'END' }, usage: { output_tokens: 2 } }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      nativeMessages('msg_stop_sequence', 'stop_sequence', 'END'),
      nativeMessages('msg_max_tokens', 'max_tokens', null),
      nativeMessages('msg_tool_use', 'tool_use', null, [{
        type: 'tool_use', id: 'toolu_terminal', name: 'lookup', input: { query: 'x' },
      }]),
      nativeMessages('msg_end_turn', 'end_turn', null),
      new Response(streamBody, { headers: { 'content-type': 'text/event-stream' } }),
    ]),
  });

  const requestBody = {
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  };
  try {
    const cases = [
      { stopReason: 'stop_sequence', stopSequence: 'END', thinking: { type: 'adaptive', display: 'summarized' } },
      { stopReason: 'max_tokens', stopSequence: null },
      { stopReason: 'tool_use', stopSequence: null },
      { stopReason: 'end_turn', stopSequence: null },
    ] as const;
    for (const expected of cases) {
      const response = await fetch(`${server.url}/v1/messages`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ ...requestBody, ...(expected.thinking ? { thinking: expected.thinking } : {}) }),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.stop_reason, expected.stopReason);
      assert.equal(body.stop_sequence, expected.stopSequence);
    }

    assert.deepEqual(calls[0]?.body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(calls.every((call) => new URL(call.url).pathname.endsWith('/messages')), true);

    const streamed = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...requestBody, stream: true }),
    });
    const events = parseSseEvents(await streamed.text());
    const terminal = events.find((event) => event.type === 'message_delta');
    assert.deepEqual(terminal?.delta, { stop_reason: 'stop_sequence', stop_sequence: 'END' });
  } finally {
    await server.close();
  }
});

test('public text preserves local paths while hiding internal router identities', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-workspace-paths-'));
  const workspaceDataPath = join(workspaceRoot, 'data', 'input.h5ad');
  const privatePath = '/Users/alice/private/input.h5ad';
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion(
        'text-reasoner-answer',
        `Read ${workspaceDataPath} but never read ${privatePath}. Internal model=text-model.`,
      ),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'generate code for the local dataset' }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    const text = String(body.content?.[0]?.text ?? '');
    assert.ok(text.includes(workspaceDataPath));
    assert.match(text, /\/Users\/alice\/private\/input\.h5ad/);
    assert.doesNotMatch(text, /text-model/);
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('anthropic messages can stream text response events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The streamed Claude-compatible answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = parseSseEvents(await response.text());
    assert.equal(events[0]?.type, 'message_start');
    assert.deepEqual(events.find((event) => event.type === 'content_block_delta')?.delta, {
      type: 'text_delta',
      text: 'The streamed Claude-compatible answer.',
    });
    assert.equal(events.at(-1)?.type, 'message_stop');
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('anthropic messages accepts Claude Code model aliases as router public alias', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-claude-model-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'Routed through the local Model Router.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sonnet',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.model, 'sonnet');
    assert.deepEqual(body.content, [{ type: 'text', text: 'Routed through the local Model Router.' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/messages');
  } finally {
    await server.close();
  }
});

test('chat completions compatibility route returns OpenAI-shaped text choices', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-compat-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The chat-compatible answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'hello' },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices?.[0]?.message?.role, 'assistant');
    assert.equal(body.choices?.[0]?.message?.content, 'The chat-compatible answer.');
    assert.equal(body.choices?.[0]?.finish_reason, 'stop');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[0]?.body.messages?.[0]?.role, 'system');
    assert.match(JSON.stringify(calls[0]?.body.messages), /Be concise/);
    assert.match(JSON.stringify(calls[0]?.body.messages), /hello/);
  } finally {
    await server.close();
  }
});

test('Chat terminal reasons survive non-streaming and streaming router roundtrips', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-terminals-'));
  const calls: CapturedFetch[] = [];
  const nativeChat = (id: string, finishReason: string) => Response.json({
    id,
    object: 'chat.completion',
    model: 'configured-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: finishReason }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  });
  const streamBody = [
    { id: 'chat_stream', object: 'chat.completion.chunk', choices: [{ delta: { content: 'streamed' } }] },
    { id: 'chat_stream', object: 'chat.completion.chunk', choices: [{ delta: {}, finish_reason: 'length' }] },
    { id: 'chat_stream', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ].map((data) => `data: ${JSON.stringify(data)}\n\n`).join('');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      nativeChat('chat_stop', 'stop'),
      nativeChat('chat_length', 'length'),
      nativeChat('chat_content_filter', 'content_filter'),
      new Response(streamBody, { headers: { 'content-type': 'text/event-stream' } }),
    ]),
  });

  const requestBody = {
    model: 'sciforge-router',
    messages: [{ role: 'user', content: 'hello' }],
  };
  try {
    for (const finishReason of ['stop', 'length', 'content_filter'] as const) {
      const response = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(requestBody),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.choices?.[0]?.finish_reason, finishReason);
    }

    const streamed = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...requestBody, stream: true }),
    });
    const events = parseSseEvents(await streamed.text());
    const terminal = events.find((event) => event.choices?.[0]?.finish_reason !== undefined);
    assert.equal(terminal?.choices?.[0]?.finish_reason, 'length');
    assert.equal(calls.every((call) => new URL(call.url).pathname.endsWith('/chat/completions')), true);

    const filteredCanonical = chatCompletionToResponse({
      id: 'chat_filtered',
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
    });
    assert.throws(
      () => responseToAnthropicMessage(filteredCanonical),
      /cannot represent Chat finish_reason="content_filter"/,
    );
  } finally {
    await server.close();
  }
});

test('chat completions compatibility route normalizes reasoning for chat providers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-reasoning-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The chat-compatible reasoning answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [{ role: 'user', content: 'Think carefully.' }],
        reasoning: { effort: 'high', summary: 'detailed' },
        reasoning_effort: 'medium',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.body.reasoning, undefined);
    assert.equal(calls[0]?.body.reasoning_effort, 'medium');
    assert.equal(calls[0]?.body.include_reasoning, undefined);
  } finally {
    await server.close();
  }
});

test('chat completions compatibility route sends image_url inputs through vision routing', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-chat-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the figure has readable labels.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The figure is readable.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Can this figure be read?' },
            { type: 'image_url', image_url: { url: pngDataUrl } },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices?.[0]?.message?.content, 'The figure is readable.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /data:image\/png;base64/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[1]?.body.max_tokens, 1024);
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('vision routing strips attachment base64 text fallbacks from provider prompts', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-fallback-strip-'));
  const calls: CapturedFetch[] = [];
  const secondImageUrl = `data:image/png;base64,${Buffer.from('second-image').toString('base64')}`;
  const fallbackBase64 = 'A'.repeat(8192);
  const fallbackText = [
    '[Attached image as base64 text]',
    'Name: duplicate-fallback.png',
    'MIME: image/png',
    'Dimensions: 100x80',
    'Bytes: 6144',
    'Base64:',
    '```base64',
    fallbackBase64,
    '```',
    '[/Attached image]',
  ].join('\n');
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial-a', 'Observation: first image.'),
      chatCompletion('vision-initial-b', 'Observation: second image.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Both images were inspected.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect these images.' },
            { type: 'image_url', image_url: { url: pngDataUrl } },
            { type: 'image_url', image_url: { url: secondImageUrl } },
            { type: 'text', text: fallbackText },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.choices?.[0]?.message?.content, 'Both images were inspected.');
    assert.equal(calls.length, 3);
    assert.equal(imagePartCount(calls[0]?.body.messages), 1);
    assert.equal(imagePartCount(calls[1]?.body.messages), 1);
    assert.equal(imagePartCount(calls[2]?.body.messages), 0);
    assert.doesNotMatch(textOnlyJson(calls[0]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[1]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[2]?.body.messages), new RegExp(fallbackBase64));
  } finally {
    await server.close();
  }
});

test('anthropic messages map tool use through the router provider path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-tools', '', [{
        id: 'tool-call-1',
        type: 'function',
        function: {
          name: 'Edit',
          arguments: JSON.stringify({ path: 'README.md', old_string: 'old', new_string: 'new' }),
        },
      }]),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        tools: [{
          name: 'Edit',
          description: 'Edit a file',
          input_schema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              old_string: { type: 'string' },
              new_string: { type: 'string' },
            },
          },
        }],
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-tool',
              name: 'Edit',
              input: { path: 'README.md', old_string: 'before', new_string: 'after' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-tool',
              content: 'Previous edit completed.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.stop_reason, 'tool_use');
    assert.deepEqual(body.content, [{
      type: 'tool_use',
      id: 'tool-call-1',
      name: 'Edit',
      input: { path: 'README.md', old_string: 'old', new_string: 'new' },
    }]);
    assert.deepEqual(calls[0]?.body.tools, [{
      name: 'Edit',
      description: 'Edit a file',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
      },
    }]);
    assert.deepEqual(calls[0]?.body.messages, [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'previous-tool',
          name: 'Edit',
          input: {
            path: 'README.md',
            old_string: 'before',
            new_string: 'after',
          },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'previous-tool',
          content: 'Previous edit completed.',
        }],
      },
    ]);
  } finally {
    await server.close();
  }
});

function anthropicToolUseInput(messages: Array<Record<string, any>>): Record<string, any> {
  for (const message of messages) {
    const content = Array.isArray(message.content) ? message.content : [];
    const toolUse = content.find((part: Record<string, unknown>) => part.type === 'tool_use');
    if (toolUse && typeof toolUse === 'object') return (toolUse as Record<string, any>).input ?? {};
  }
  return {};
}

test('anthropic messages request hygiene folds long tool argument arrays before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-hygiene-args-'));
  const longIds = Array.from({ length: 80 }, (_, index) => `sample-${index}-${'z'.repeat(12)}`);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-args-final', 'Batch lookup already completed.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-batch',
              name: 'batch_lookup',
              input: { ids: longIds, mode: 'full' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-batch',
              content: 'Lookup complete.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const messages = calls[0]?.body.messages as Array<Record<string, any>>;
    const args = anthropicToolUseInput(messages);
    assert.equal(args.mode, 'full');
    assert.equal(Array.isArray(args.ids), false);
    assert.equal(args.ids.__sciforge_request_hygiene__.source, 'tool_call.arguments.ids');
    assert.equal(args.ids.__sciforge_request_hygiene__.reason, 'long_array');
    assert.equal(args.ids.__sciforge_request_hygiene__.originalItems, 80);
    assert.match(args.ids.__sciforge_request_hygiene__.digest, /^sha256:/);
    assert.ok(!JSON.stringify(calls[0]?.body).includes('sample-79-'));
  } finally {
    await server.close();
  }
});

test('anthropic messages request hygiene folds long string tool arguments as strings', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-hygiene-string-args-'));
  const longContent = 'stage report line\n'.repeat(700);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-string-args-final', 'Report write already completed.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-write',
              name: 'write',
              input: { path: 'report.md', content: longContent },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-write',
              content: 'Write complete.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const messages = calls[0]?.body.messages as Array<Record<string, any>>;
    const args = anthropicToolUseInput(messages);
    assert.equal(args.path, 'report.md');
    assert.equal(typeof args.content, 'string');
    assert.match(args.content, /sciforge request_hygiene/);
    assert.match(args.content, /reason=large_argument_string/);
    assert.ok(!JSON.stringify(calls[0]?.body).includes(longContent.slice(0, 80)));
  } finally {
    await server.close();
  }
});

test('anthropic messages request hygiene replaces long shell commands with an explicit failing history sentinel', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-hygiene-shell-args-'));
  const longCommand = `python3 <<'PY'\n${'print("work")\n'.repeat(700)}PY`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-shell-args-final', 'Prior shell execution is already represented by its result.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'previous-shell',
              name: 'exec_command',
              input: { cmd: longCommand, workdir: workspaceRoot },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'previous-shell',
              content: 'Command complete.',
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const messages = calls[0]?.body.messages as Array<Record<string, any>>;
    const args = anthropicToolUseInput(messages);
    assert.equal(
      args.cmd,
      'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command',
    );
    assert.equal(args.workdir, workspaceRoot);
    assert.doesNotMatch(args.cmd, /\[sciforge request_hygiene/u);
    assert.ok(!JSON.stringify(calls[0]?.body).includes(longCommand.slice(0, 80)));
  } finally {
    await server.close();
  }
});

test('healthz reports provider readiness without leaking private bindings', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, true);
    assert.equal(body.version, '0.1.0');
    assert.equal(body.transport, 'http');
    assert.deepEqual(body.health, {
      status: 'healthy',
      available: true,
    });
    assert.equal(body.recentError, null);
    assert.deepEqual(body.capabilities, [
      'model_router_capabilities',
      'model_router_responses',
      'model_router_messages',
      'model_router_image_generations',
      'model_router_image_edits',
      'text_reasoning',
      'image_generation',
      'vision_translation',
      'scientific_translation',
      'full_trace',
    ]);
    assert.deepEqual(body.upstream, {
      category: 'ready',
      ok: true,
      retryable: false,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing provider credentials without leaking binding names', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {},
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.version, '0.1.0');
    assert.equal(body.transport, 'http');
    assert.deepEqual(body.health, {
      status: 'unhealthy',
      available: false,
      reason: 'provider-auth',
    });
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.capabilities, [
      'model_router_capabilities',
      'model_router_responses',
      'model_router_messages',
      'model_router_image_generations',
      'model_router_image_edits',
      'text_reasoning',
      'image_generation',
      'vision_translation',
      'scientific_translation',
      'full_trace',
    ]);
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider auth failures after a routed request fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-recent-auth-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'upstream key rejected' } }, { status: 401 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 401);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'upstream_http_401');
    assert.match(failedBody.error?.message ?? '', /Upstream API credentials were rejected/i);
    assert.match(failedBody.error?.message ?? '', /Update the API key in SciForge Model Router settings/i);
    assert.doesNotMatch(JSON.stringify(failedBody), forbiddenPublicSurfacePattern);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.deepEqual(body.health, {
      status: 'unhealthy',
      available: false,
      reason: 'provider-auth',
    });
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'textReasoner',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider network failures after a routed request fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-network-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      throw new Error('network socket reset');
    },
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 502);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'upstream_network_error');

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-network');
    assert.deepEqual(body.upstream, {
      category: 'provider-network',
      ok: false,
      retryable: true,
      httpStatus: 502,
      role: 'textReasoner',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider bad responses after invalid upstream JSON', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-bad-response-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      new Response('not json', { status: 200 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 502);
    const failedBody = await failed.json() as Record<string, { code?: string }>;
    assert.equal(failedBody.error?.code, 'upstream_invalid_response');

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-bad-response');
    assert.deepEqual(body.upstream, {
      category: 'provider-bad-response',
      ok: false,
      retryable: false,
      httpStatus: 502,
      role: 'textReasoner',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz reports recent provider errors after non-auth upstream HTTP failures', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-provider-error-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      Response.json({ error: { message: 'temporary upstream failure with sk-should-not-leak' } }, { status: 500 }),
    ]),
  });

  try {
    const failed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(failed.status, 500);
    const failedBody = await failed.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(failedBody.error?.code, 'upstream_http_500');
    assert.doesNotMatch(JSON.stringify(failedBody), /sk-should-not-leak/i);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;

    assert.equal(body.recentError, 'provider-error');
    assert.deepEqual(body.upstream, {
      category: 'provider-error',
      ok: false,
      retryable: true,
      httpStatus: 500,
      role: 'textReasoner',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing vision translator credentials', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-vision-auth-'));
  const env = testEnv();
  delete (env as Partial<typeof env>).SCIFORGE_VISION_API_KEY;
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env,
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'visionTranslator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('healthz blocks missing scientific translator credentials', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-healthz-missing-scientific-auth-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'scientificTranslator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
    assert.doesNotMatch(serialized, /sci-modality\.example|SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN/);
  } finally {
    await server.close();
  }
});

test('pure text responses are routed only to the configured text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The text answer.', undefined, {}, {
        prompt_tokens: 120,
        completion_tokens: 20,
        total_tokens: 145,
        prompt_tokens_details: { cached_tokens: 90 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The text answer.');
    assert.deepEqual(body.usage, {
      input_tokens: 120,
      output_tokens: 20,
      total_tokens: 145,
      input_tokens_details: { cached_tokens: 90 },
      output_tokens_details: { reasoning_tokens: 5 },
      prompt_tokens: 120,
      completion_tokens: 20,
      cached_input_tokens: 90,
      reasoning_output_tokens: 5,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.equal(calls[0]?.headers.authorization, 'Bearer text-secret');
    assert.equal(calls[0]?.body.model, 'text-model');
    assert.equal(calls[0]?.body.input, 'Explain SciForge in one sentence.');

  } finally {
    await server.close();
  }
});

test('interactive responses preempt in-flight Evidence DAG provider work', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-dag-preemption-'));
  let markBackgroundStarted!: () => void;
  const backgroundStarted = new Promise<void>((resolve) => { markBackgroundStarted = resolve; });
  let backgroundAborted = false;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    if (serialized.includes('background evidence extraction')) {
      markBackgroundStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          backgroundAborted = true;
          reject(new DOMException('preempted by interactive request', 'AbortError'));
        }, { once: true });
      });
    }
    return Response.json({
      id: 'resp_interactive',
      object: 'response',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'interactive answer' }] }],
      output_text: 'interactive answer',
    });
  };
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl,
  });

  try {
    const background = fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'background evidence extraction',
        metadata: { source: 'evidence-dag', operation: 'extract-or-verify' },
      }),
    });
    await backgroundStarted;
    const interactive = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'interactive user request' }),
    });
    assert.equal(interactive.status, 200);
    assert.equal(backgroundAborted, true);
    assert.equal((await background).status, 504);
  } finally {
    await server.close();
  }
});

test('client disconnect aborts the text upstream and records error plus partial terminal trace events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-client-abort-trace-'));
  const capturedEvents: TraceEventInput[] = [];
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany(inputs) {
        capturedEvents.push(...inputs);
        return inputs as TraceEvent[];
      },
    },
  });
  const pending = abortingFetch();
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: pending.fetchImpl,
    fullTraceRecorder: recorder,
  });

  const client = new AbortController();
  const health = await fetch(`${server.url}/healthz?check=upstream`);
  assert.equal((await health.json() as Record<string, unknown>).traceCapture, 'ready');
  const request = fetch(`${server.url}/v1/responses`, {
    method: 'POST',
    headers: runtimeHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model: 'sciforge-router', input: 'Keep generating until cancelled.' }),
    signal: client.signal,
  });
  try {
    await promiseWithTimeout(pending.started, 'text upstream did not start');
    client.abort();
    await assert.rejects(request, /abort/i);
    await promiseWithTimeout(pending.aborted, 'text upstream did not receive abort');
  } finally {
    await server.close();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  await recorder.flush();

  const upstreamEvents = capturedEvents.filter((event) => (
    (event.payload as Record<string, unknown>).upstream === true
  ));
  assert.equal(upstreamEvents.some((event) => event.kind === 'error'), true);
  assert.equal(upstreamEvents.some((event) => event.kind === 'model_response_end'), true);
  assert.equal(capturedEvents.some((event) => event.kind === 'error'), true);
  assert.equal(capturedEvents.some((event) => event.kind === 'model_response_end'), true);
});

test('client disconnect propagates to every public upstream path', async (context) => {
  await context.test('chat completions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-chat-'));
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig(),
      env: testEnv(),
      path: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [{ role: 'user', content: 'Keep generating until cancelled.' }],
      }),
    });
  });

  await context.test('anthropic messages', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-messages-'));
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig(),
      env: testEnv(),
      path: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'Keep generating until cancelled.' }],
      }),
    });
  });

  await context.test('image generation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-image-generation-'));
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
      env: { ...testEnv(), SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret' },
      path: '/v1/images/generations',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Generate until cancelled.' }),
    });
  });

  await context.test('image edit', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-image-edit-'));
    const form = imageEditForm('sciforge-router');
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
      env: { ...testEnv(), SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret' },
      path: '/v1/images/edits',
      body: form,
    });
  });

  await context.test('vision translation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-vision-'));
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig(),
      env: testEnv(),
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Inspect until cancelled.' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });
  });

  await context.test('scientific translation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-scientific-'));
    await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'abort'), { recursive: true });
    await writeFile(
      join(workspaceRoot, '.sciforge', 'uploads', 'abort', 'protein.fasta'),
      '>protein\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ\n',
    );
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
      env: {
        ...testEnv(),
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'scientific-secret',
      },
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze until cancelled.' },
            {
              type: 'input_object',
              ref: '.sciforge/uploads/abort/protein.fasta',
              mimeType: 'text/plain',
              title: 'protein.fasta',
            },
          ],
        }],
      }),
    });
  });

  await context.test('provider image URL download', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-abort-image-download-'));
    await assertClientAbortPropagates({
      workspaceRoot,
      config: testConfig({ imageGenerator: testImageGeneratorConfig() }),
      env: { ...testEnv(), SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'image-secret' },
      path: '/v1/images/generations',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', prompt: 'Generate and download.' }),
      responsesBeforePending: [Response.json({
        created: 1,
        data: [{ url: 'https://cdn.example/generated.png' }],
      })],
    });
  });
});

test('pure text responses expose upstream reasoning content as a Responses reasoning item', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-reasoning-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion(
        'text-reasoner-answer',
        'The text answer.',
        undefined,
        { reasoning_content: 'Need a concise one sentence answer.' },
      ),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
        reasoning: { effort: 'high', summary: 'detailed' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, 'The text answer.');
    assert.deepEqual(body.output?.map((item) => item.type), ['reasoning', 'message']);
    assert.deepEqual(body.output?.[0]?.summary, [{
      type: 'summary_text',
      text: 'Need a concise one sentence answer.',
    }]);
    assert.deepEqual(calls[0]?.body.reasoning, { effort: 'high', summary: 'detailed' });
    assert.equal(calls[0]?.body.reasoning_effort, undefined);
    assert.equal(calls[0]?.body.include_reasoning, undefined);
  } finally {
    await server.close();
  }
});

test('anthropic messages route through the text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-message-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'sciforge-router' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'pong', undefined, {}, {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/api/cc/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'runtime-secret' },
      body: JSON.stringify({
        model: 'sciforge-router',
        system: 'Answer tersely.',
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        max_tokens: 64,
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.type, 'message');
    assert.equal(body.model, 'sciforge-router');
    assert.deepEqual(body.content, [{ type: 'text', text: 'pong' }]);
    assert.deepEqual(body.usage, {
      input_tokens: 12,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/messages');
    assert.equal(calls[0]?.headers['x-api-key'], 'text-secret');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: [{ type: 'text', text: 'Reply with exactly: pong' }] },
    ]);
    assert.deepEqual(calls[0]?.body.system, [{ type: 'text', text: 'Answer tersely.' }]);
  } finally {
    await server.close();
  }
});

test('anthropic messages stream emits Claude-compatible SSE events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'sciforge-router' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'pong', undefined, {}, {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: pong' }] }],
        max_tokens: 64,
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = parseSseEvents(await response.text());
    assert.deepEqual(events.map((event) => event.type), [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    assert.deepEqual(events[2]?.delta, { type: 'text_delta', text: 'pong' });
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('vision responses translate refs first, then ask the text reasoner for the final answer', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the chart label is ATP concentration.'),
      chatCompletion('vision-initial-ref', 'Observation: the microscopy panel is attached as context.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The chart label is ATP concentration.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What does the axis label say?' },
            { type: 'inputImage', imageUrl: pngDataUrl, mimeType: 'image/png' },
            { type: 'input_image', ref: 'artifact:microscopy-panel', mime_type: 'image/jpeg' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The chart label is ATP concentration.');
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[0]?.headers.authorization, 'Bearer vision-secret');
    assert.equal(calls[0]?.body.model, 'vision-model');
    assert.match(JSON.stringify(calls[0]?.body), /data:image\/png;base64/);
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /artifact:microscopy-panel/);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /artifact:microscopy-panel/);
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /data:image|base64|tiny-png/i);
    assert.equal(calls[2]?.url, 'https://text.example/v1/responses');
    assert.doesNotMatch(JSON.stringify(calls[2]?.body), /data:image|base64|tiny-png/i);
    assert.match(JSON.stringify(calls[2]?.body), /Observation: the chart label is ATP concentration/);

  } finally {
    await server.close();
  }
});

test('vision routing enforces the active profile MIME registration before upstream translation', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-capability-enforcement-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.capabilities = {
    vision: {
      mimeTypes: ['image/jpeg'],
      maxInputBytes: 1024,
    },
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({
        type: 'final_answer',
        content: 'The referenced image could not be inspected.',
      })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe this image.' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.match(String((await response.json() as { output_text: string }).output_text), /could not be inspected/i);
  } finally {
    await server.close();
  }
});

test('vision inputs fall back to text when the active profile has no vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-no-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfigWithoutVision(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I only have the text prompt.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is in this image?' },
            { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /image.*not sent/i);
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    const textReasonerBody = JSON.stringify(calls[0]?.body);
    assert.match(textReasonerBody, /status=not_sent/);
    assert.match(textReasonerBody, /image payload was not sent/i);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|tiny-png/i);

  } finally {
    await server.close();
  }
});

test('tool result screenshots fall back to safe text and are not sent without vision support', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-no-vision-tool-image-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfigWithoutVision(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I can use the screenshot metadata only.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Take a screenshot and tell me what you can.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_screenshot_1',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
            reasoning_content: 'Need the current screen.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_screenshot_1',
            output: JSON.stringify({
              kind: 'computer_screenshot',
              action: 'screenshot',
              screen: { width: 800, height: 600 },
              note: 'Screenshot captured at 800x600.',
              images: [{ mime_type: 'image/png', data_base64: Buffer.from('tiny-png').toString('base64'), width: 800, height: 600 }],
            }),
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /image.*not sent/i);
    assert.equal(calls.length, 1);
    const textReasonerBody = JSON.stringify(calls[0]?.body);
    assert.match(textReasonerBody, /Screenshot captured at 800x600/);
    assert.match(textReasonerBody, /images_omitted/);
    assert.match(textReasonerBody, /status=not_sent/);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('standard MCP visualSnapshot tool result routes through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-result-vision-'));
  const imageData = Buffer.from('mcp-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows a settings window.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows a settings window.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Inspect the screenshot from the tool.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_screenshot_2',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_screenshot_2',
            output: {
              content: [
                { type: 'text', text: 'Screenshot captured at 1024x768.' },
                { type: 'image', data: imageData, mimeType: 'image/png' },
              ],
              structuredContent: {
                ok: true,
                requestId: 'capture-request-1',
                resource: {
                  kind: 'visualSnapshot',
                  role: 'window',
                  mimeType: 'image/png',
                  width: 1024,
                  height: 768,
                },
              },
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows a settings window.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /settings window/);
    assert.doesNotMatch(textReasonerBody, /mcp-screen-pixels|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('Codex dynamic tool inputImage results route through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-codex-input-image-'));
  const imageData = Buffer.from('codex-dynamic-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows arXiv search results.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows arXiv search results.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Inspect the screenshot from the dynamic tool.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_dynamic_screenshot_1',
            name: 'computer_use',
            arguments: '{"action":"screenshot"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_dynamic_screenshot_1',
            output: {
              contentItems: [
                { type: 'inputText', text: 'Screenshot is 1280x831px.' },
                { type: 'inputImage', imageUrl: `data:image/png;base64,${imageData}` },
              ],
              success: true,
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows arXiv search results.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /arXiv search results/);
    assert.doesNotMatch(textReasonerBody, /codex-dynamic-screen-pixels|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('Anthropic tool_result images route through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-anthropic-tool-image-'));
  const imageData = Buffer.from('claude-mcp-screen-pixels').toString('base64');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows arXiv search results.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The screenshot shows arXiv search results.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Inspect the screenshot from computer_use.' }],
          },
          {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'toolu_screenshot_1',
              name: 'computer_use',
              input: { action: 'screenshot' },
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'toolu_screenshot_1',
              content: [
                { type: 'text', text: 'Screenshot is 1280x831px.' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: imageData,
                  },
                },
              ],
            }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body.content, [{ type: 'text', text: 'The screenshot shows arXiv search results.' }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/messages');
    assert.match(JSON.stringify(calls[0]?.body), new RegExp(`"type":"base64","media_type":"image/png","data":"${imageData}"`));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /arXiv search results/);
    assert.doesNotMatch(textReasonerBody, /claude-mcp-screen-pixels|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('responses tool calls pass through the Model Router API without becoming text answers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-call', '', [{
        id: 'call_gui_present_1',
        type: 'function',
        function: {
          name: 'gui_present',
          arguments: JSON.stringify({
            intent: 'show-result',
            content: { kind: 'markdown', value: 'Visible answer.' },
          }),
        },
      }], { reasoning_content: 'Need to present the answer through the GUI tool.' }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Answer through gui.present.',
        tools: [{
          type: 'function',
          name: 'gui_present',
          description: 'Present the final answer.',
          parameters: { type: 'object', properties: {} },
        }],
        tool_choice: 'auto',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, '');
    const reasoning = body.output?.find((item) => item.type === 'reasoning');
    const toolCall = body.output?.find((item) => item.type === 'function_call');
    assert.deepEqual(reasoning?.summary, [{
      type: 'summary_text',
      text: 'Need to present the answer through the GUI tool.',
    }]);
    assert.deepEqual(toolCall, {
      id: toolCall?.id,
      type: 'function_call',
      status: 'completed',
      call_id: 'call_gui_present_1',
      name: 'gui_present',
      arguments: JSON.stringify({
        intent: 'show-result',
        content: { kind: 'markdown', value: 'Visible answer.' },
      }),
      reasoning_content: 'Need to present the answer through the GUI tool.',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.body.tool_choice, 'auto');
    assert.equal((calls[0]?.body.tools as Array<{ name?: string }> | undefined)?.[0]?.name, 'gui_present');
  } finally {
    await server.close();
  }
});

test('responses tool outputs are preserved through canonical upstream routing', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-output-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testResponsesExtensionConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-output-final', '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run date and answer.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_1',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
            reasoning_content: 'Need to run date before answering.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_1',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output_text?: string };
    assert.equal(body.output_text, '工具输出时间是 Mon Jun 15 17:01:38 CST 2026。');
    const providerInput = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.type ?? item.role), ['user', 'function_call', 'function_call_output']);
    assert.equal(providerInput[1]?.reasoning_content, 'Need to run date before answering.');
    assert.equal(providerInput[2]?.output, 'Mon Jun 15 17:01:38 CST 2026\n');
  } finally {
    await server.close();
  }
});

test('responses request hygiene folds pasted image data and giant tool outputs before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-request-hygiene-tool-output-'));
  const imagePayload = Buffer.from('ordinary-text-image-payload'.repeat(80)).toString('base64');
  const pastedImage = `data:image/png;base64,${imagePayload}`;
  const giantToolOutput = [
    'BEGIN_GIANT_TOOL_OUTPUT',
    '<rows>',
    ...Array.from({ length: 180 }, (_, index) => `<row id="${index}">${'x'.repeat(90)}</row>`),
    '</rows>',
    pastedImage,
    'END_GIANT_TOOL_OUTPUT',
  ].join('\n');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-hygiene-tool-output-final', 'Large tool output was summarized safely.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: `Treat this pasted payload as plain text only: ${pastedImage}` }],
          },
          {
            type: 'function_call',
            call_id: 'call_giant_output',
            name: 'local_shell',
            arguments: '{"cmd":"emit-large-report"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_giant_output',
            output: giantToolOutput,
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const serializedProviderBody = JSON.stringify(calls[0]?.body);
    assert.doesNotMatch(serializedProviderBody, /data:image\/png;base64/i);
    assert.ok(!serializedProviderBody.includes(imagePayload.slice(0, 80)));
    assert.ok(!serializedProviderBody.includes(giantToolOutput));
    assert.match(serializedProviderBody, /sciforge request_hygiene/);
    assert.match(serializedProviderBody, /source=message\.text/);
    assert.match(serializedProviderBody, /source=tool_message\.content/);
    assert.match(serializedProviderBody, /reason=large_tool_output/);
    assert.match(serializedProviderBody, /digest=sha256:/);

    const input = calls[0]?.body.input as Array<Record<string, unknown>>;
    const toolOutput = input.find((item) => item.type === 'function_call_output');
    const toolContent = String(toolOutput?.output ?? '');
    assert.ok(toolContent.length < 1_000, `expected folded tool content, got ${toolContent.length} chars`);
  } finally {
    await server.close();
  }
});

test('responses preserve adjacent parallel function calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-adjacent-tool-calls-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-output-final', 'Both commands finished.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run pwd and git status.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_pwd_1',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
            reasoning_content: 'Need the current directory.',
          },
          {
            type: 'function_call',
            call_id: 'call_git_status_1',
            name: 'local_shell',
            arguments: '{"cmd":"git status --short"}',
            reasoning_content: 'Need the worktree status.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_pwd_1',
            output: '/tmp/workspace\n',
          },
          {
            type: 'function_call_output',
            call_id: 'call_git_status_1',
            output: ' M package.json\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const providerInput = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.type ?? item.role), [
      'user',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
    ]);
  } finally {
    await server.close();
  }
});

test('responses developer messages are preserved through canonical upstream routing', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-developer-replay-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-developer-final', 'Developer instructions were preserved.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'developer',
            content: [
              { type: 'input_text', text: 'Always answer briefly.' },
              { type: 'input_text', text: 'Never call extra tools.' },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Say hello.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_developer',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
            reasoning_content: 'Need one date call before answering.',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_developer',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const providerInput = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.type ?? item.role), [
      'developer',
      'user',
      'function_call',
      'function_call_output',
    ]);
    assert.match(JSON.stringify(providerInput[0]), /Always answer briefly/);
  } finally {
    await server.close();
  }
});

test('responses tool transcript drops orphan tool outputs before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-orphan-tool-output-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-orphan-output-final', 'Ignored orphan tool output and answered the user.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Continue safely.' }],
          },
          {
            type: 'function_call_output',
            call_id: 'call_missing',
            output: 'This output has no matching function_call.',
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Answer from valid context only.' }],
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const providerInput = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.role), ['user', 'user']);
    assert.doesNotMatch(JSON.stringify(providerInput), /call_missing/);
  } finally {
    await server.close();
  }
});

test('responses assistant output text history is preserved through canonical upstream routing', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-output-text-history-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-output-text-history', 'Continued after assistant history.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'First prompt.' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Earlier answer.' }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Continue.' }],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const providerPayload = JSON.stringify(calls[0]?.body.input);
    assert.match(providerPayload, /output_text/);
    assert.match(providerPayload, /First prompt/);
    assert.match(providerPayload, /Earlier answer/);
    assert.match(providerPayload, /Continue/);
  } finally {
    await server.close();
  }
});

test('responses tool transcript removes bridge items between tool calls and outputs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-bridge-repair-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-bridge-final', 'Tool transcript remained provider-compatible.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run pwd.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_pwd_bridge',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
          },
          {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'GUI-only bridge text should not split tool messages.' }],
          },
          {
            type: 'approval',
            id: 'approval_bridge',
            status: 'allowed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_pwd_bridge',
            output: '/tmp/workspace\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const providerInput = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.type ?? item.role), ['user', 'function_call', 'function_call_output']);
    assert.doesNotMatch(JSON.stringify(providerInput), /GUI-only bridge|approval_bridge/);
  } finally {
    await server.close();
  }
});

test('responses follow-ups replay encrypted continuation state and the complete parallel tool turn', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-response-continuation-'));
  const encryptedContent = 'AbCd0123_+'.repeat(80);
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({
        id: 'resp_upstream_tool_turn',
        object: 'response',
        status: 'completed',
        output: [
          {
            id: 'rs_parallel_tools',
            type: 'reasoning',
            encrypted_content: encryptedContent,
            summary: [{ type: 'summary_text', text: 'Need both tool results.' }],
          },
          {
            id: 'cmp_parallel_tools',
            type: 'compaction',
            encrypted_content: encryptedContent,
          },
          {
            id: 'fc_parallel_a',
            type: 'function_call',
            call_id: 'call_parallel_a',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
          },
          {
            id: 'fc_parallel_b',
            type: 'function_call',
            call_id: 'call_parallel_b',
            name: 'local_shell',
            arguments: '{"cmd":"git status --short"}',
          },
        ],
        output_text: '',
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      }),
      Response.json({
        id: 'resp_upstream_final',
        object: 'response',
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Both tools finished.' }],
        }],
        output_text: 'Both tools finished.',
        usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
      }),
    ]),
  });

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Run both tools and answer.',
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(first.status, 200);
    const firstBody = await first.json() as { id?: string; output?: Array<Record<string, unknown>> };
    assert.match(String(firstBody.id), /^resp_/u);
    assert.notEqual(firstBody.id, 'resp_upstream_tool_turn');
    assert.equal(firstBody.output?.find((item) => item.type === 'reasoning')?.encrypted_content, encryptedContent);

    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        previous_response_id: firstBody.id,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run both tools and answer.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_parallel_a',
            name: 'local_shell',
            arguments: '{"cmd":"pwd"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_parallel_a',
            output: '/tmp/workspace\n',
          },
          {
            type: 'function_call_output',
            call_id: 'call_parallel_b',
            output: ' M package.json\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(second.status, 200);
    assert.equal(calls[1]?.body.previous_response_id, undefined);
    const providerInput = calls[1]?.body.input as Array<Record<string, unknown>>;
    assert.deepEqual(providerInput.map((item) => item.type ?? item.role), [
      'user',
      'reasoning',
      'compaction',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
    ]);
    assert.equal(providerInput[1]?.encrypted_content, encryptedContent);
    assert.equal(providerInput[2]?.encrypted_content, encryptedContent);
    assert.deepEqual(
      providerInput.filter((item) => item.type === 'function_call').map((item) => item.call_id),
      ['call_parallel_a', 'call_parallel_b'],
    );
  } finally {
    await server.close();
  }
});

test('responses assistant text history preserves reasoning_content for thinking providers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-assistant-reasoning-history-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testResponsesExtensionConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final-after-clarification', JSON.stringify({
        type: 'final_answer',
        content: 'Use a small demo reproduction.'
      })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Plan the DeepSeek-R1 reproduction.' }],
          },
          {
            role: 'assistant',
            content: 'What scale should the reproduction target?',
            reasoning_content: 'Need to clarify reproduction scope before planning.',
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Make it a small demo.' }],
          },
        ],
        reasoning: { effort: 'high' },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      (calls[0]?.body.input as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      'Need to clarify reproduction scope before planning.'
    );
  } finally {
    await server.close();
  }
});

test('responses tool outputs expose provider 400 bodies without retry-side request mutation', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-tool-http-400-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({
        error: {
          message: 'The `reasoning_content` in the thinking mode must be passed back to the API.',
        },
      }, { status: 400 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Run date and answer.' }],
          },
          {
            type: 'function_call',
            call_id: 'call_date_retry',
            name: 'local_shell',
            arguments: '{"cmd":"date"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_date_retry',
            output: 'Mon Jun 15 17:01:38 CST 2026\n',
          },
        ],
        tools: [{
          type: 'function',
          name: 'local_shell',
          description: 'Run a local shell command.',
          parameters: { type: 'object', properties: {} },
        }],
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(body.error?.code, 'upstream_http_400');
    assert.match(body.error?.message ?? '', /reasoning_content/);
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0]?.body.input as Array<Record<string, unknown>> | undefined)?.[1]?.reasoning_content,
      undefined
    );
  } finally {
    await server.close();
  }
});

test('invalid tool schemas return a structured capability error instead of a router 500', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-invalid-tool-schema-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Use the tool if appropriate.',
        tools: [{
          type: 'function',
          name: 'invalid_tool',
          parameters: [{ type: 'string' }],
        }],
      }),
    });

    assert.equal(response.status, 422);
    const body = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(body.error?.code, 'upstream_protocol_capability_unsupported');
    assert.match(body.error?.message ?? '', /JSON Schema object or boolean/u);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('responses routing preserves supported Codex tool declarations for the upstream protocol', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-codex-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-codex-tools', 'Plain answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Use plain text.',
        tools: [
          { type: 'local_shell' },
          { type: 'apply_patch' },
          { type: 'function', name: 'gui_present', parameters: { type: 'object', properties: {} } },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]?.body.tools, [
      { type: 'local_shell' },
      { type: 'apply_patch' },
      { type: 'function', name: 'gui_present', parameters: { type: 'object', properties: {} } },
    ]);
  } finally {
    await server.close();
  }
});

test('responses routing preserves namespaced dynamic tools across upstream protocols', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-dynamic-tools-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-dynamic-tools', 'Plain answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Use the configured dynamic tool if needed.',
        tools: [
          { type: 'local_shell' },
          {
            namespace: 'mcp_gui_research',
            name: 'research_search',
            description: 'Search scientific literature.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          {
            type: 'namespace',
            name: 'mcp_lab',
            tools: [{
              type: 'function',
              name: 'inspect.dataset',
              description: 'Inspect a dataset.',
              input_schema: { type: 'object', properties: { id: { type: 'string' } } },
            }],
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: 'mcp_gui_research.research_search' },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]?.body.tools, [
      { type: 'local_shell' },
      {
        namespace: 'mcp_gui_research',
        name: 'research_search',
        description: 'Search scientific literature.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
      {
        type: 'namespace',
        name: 'mcp_lab',
        tools: [{
          type: 'function',
          name: 'inspect.dataset',
          description: 'Inspect a dataset.',
          input_schema: { type: 'object', properties: { id: { type: 'string' } } },
        }],
      },
    ]);
    assert.deepEqual(calls[0]?.body.tool_choice, {
      type: 'function',
      function: { name: 'mcp_gui_research.research_search' },
    });
  } finally {
    await server.close();
  }
});

test('responses routing maps provider dynamic tool calls back to namespaced Responses items', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-dynamic-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-dynamic-tool-call', '', [{
        id: 'call_research_search_1',
        type: 'function',
        function: {
          name: 'mcp_gui_research_research_search',
          arguments: JSON.stringify({ query: 'agentic RL', maxResults: 1 }),
        },
      }]),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Search with the configured dynamic tool.',
        tools: [{
          namespace: 'mcp_gui_research',
          name: 'research_search',
          description: 'Search scientific literature.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { output?: Array<Record<string, unknown>>; output_text?: string };
    assert.equal(body.output_text, '');
    assert.equal(body.output?.[0]?.type, 'function_call');
    assert.equal(body.output?.[0]?.call_id, 'call_research_search_1');
    assert.equal(body.output?.[0]?.name, 'mcp_gui_research.research_search');
    assert.equal(body.output?.[0]?.arguments, JSON.stringify({ query: 'agentic RL', maxResults: 1 }));
    assert.equal((calls[0]?.body.tools as Array<{ name?: string }> | undefined)?.[0]?.name, 'research_search');
  } finally {
    await server.close();
  }
});

test('streaming responses emit function_call items when the text reasoner chooses a tool', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-tool-call-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-tool-call-stream', '', [{
        id: 'call_gui_present_stream',
        type: 'function',
        function: {
          name: 'gui_present',
          arguments: '{"intent":"show-result","content":{"kind":"markdown","value":"Stream visible answer."}}',
        },
      }], {}, {
        prompt_tokens: 42,
        completion_tokens: 3,
        total_tokens: 45,
        prompt_tokens_details: { cached_tokens: 30 },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: 'Answer through gui.present.',
        tools: [{ type: 'function', name: 'gui_present', parameters: { type: 'object', properties: {} } }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    const events = parseSseEvents(body);
    assert.deepEqual(events.map((event) => event.type), [
      'response.created',
      'response.output_item.added',
      'response.output_item.done',
      'response.completed',
    ]);
    assert.equal(events[1]?.item?.type, 'function_call');
    assert.equal(events[1]?.item?.name, 'gui_present');
    assert.equal(events[1]?.item?.call_id, 'call_gui_present_stream');
    assert.deepEqual(events.find((event) => event.type === 'response.completed')?.response?.usage, {
      input_tokens: 42,
      output_tokens: 3,
      total_tokens: 45,
      input_tokens_details: { cached_tokens: 30 },
      output_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens: 42,
      completion_tokens: 3,
      cached_input_tokens: 30,
      reasoning_output_tokens: 0,
    });
    assert.doesNotMatch(body, /response\.output_text\.delta/);
  } finally {
    await server.close();
  }
});

test('streaming text responses emit reasoning items before final answer text', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-reasoning-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      chatCompletion(
        'text-reasoning-stream',
        'The streamed answer.',
        undefined,
        { reasoning_content: 'Need to answer briefly.' },
      ),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: 'Answer briefly.',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    const events = parseSseEvents(body);
    assert.deepEqual(events.map((event) => event.type), [
      'response.created',
      'response.output_item.added',
      'response.output_item.done',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    assert.equal(events[1]?.item?.type, 'reasoning');
    assert.deepEqual(events[1]?.item?.summary, [{
      type: 'summary_text',
      text: 'Need to answer briefly.',
    }]);
    assert.equal(events[5]?.output_index, 1);
    assert.equal(events[5]?.delta, 'The streamed answer.');
    assert.deepEqual(events.find((event) => event.type === 'response.completed')?.response?.output?.map((item: Record<string, unknown>) => item.type), [
      'reasoning',
      'message',
    ]);
  } finally {
    await server.close();
  }
});

test('workspace image refs are materialized only as transient provider image payloads', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-ref-materialization-'));
  const imageBytes = Buffer.from('local-ref-pixels');
  await mkdir(join(workspaceRoot, 'images'), { recursive: true });
  await writeFile(join(workspaceRoot, 'images', 'panel.png'), imageBytes);
  const expectedDataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the local file image is visible.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The local file image is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is shown?' },
            { type: 'input_image', ref: 'images/panel.png', mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, /data:image\/png;base64/);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(visionBody, /SciForge visual ref image_1: images\/panel\.png/);

  } finally {
    await server.close();
  }
});

test('local_image inputs are normalized as visual objects inside the Model Router', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-local-image-object-'));
  const imageBytes = Buffer.from('local-image-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-local'), { recursive: true });
  const imagePath = join(workspaceRoot, '.sciforge', 'uploads', 'session-local', 'hotel.jpg');
  await writeFile(imagePath, imageBytes);
  const expectedDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the local image object is a hotel voucher.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this local image?' },
            { type: 'local_image', path: imagePath, mime_type: 'image/jpeg', title: '酒店凭证.jpg' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It is a hotel voucher.');
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await server.close();
  }
});

test('input_object refs are detected and translated inside the Model Router', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-input-object-'));
  const imageBytes = Buffer.from('input-object-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-test'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-test', 'hotel.jpg'), imageBytes);
  const expectedDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the hotel voucher total is 421.15 yuan.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The hotel voucher total is 421.15 yuan.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: '解释这张图' },
            {
              type: 'input_object',
              ref: '.sciforge/uploads/session-test/hotel.jpg',
              mimeType: 'image/jpeg',
              title: '酒店凭证.jpg',
            },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The hotel voucher total is 421.15 yuan.');
    assert.equal(calls.length, 2);
    const visionBody = JSON.stringify(calls[0]?.body);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.doesNotMatch(textReasonerBody, /data:image|base64|input-object-pixels/i);
    assert.match(textReasonerBody, /Do not tell the user you cannot directly access or see the image/i);
    assert.match(textReasonerBody, /Do not mention modality observations, visual observations, translators, or router internals/i);

  } finally {
    await server.close();
  }
});

test('scientific file uploads are translated to evidence via the managed sci-modality worker', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-scimodality-'));
  const fasta = '>sp|P0CG48|UBC_HUMAN\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG\n';
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'ubiquitin.fasta'), fasta);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      // 1) managed sci-modality worker translate (stubbed in this unit test).
      Response.json({
        ok: true,
        summary: '[esm2text-protein] Generated by Esm2Text. A 76-residue ubiquitin protein.',
        data: {
          modality: 'protein',
          model: 'esm2text-protein',
          summary: '[esm2text-protein] Generated by habdine/Esm2Text-Base. This is a 76-residue ubiquitin protein that signals protein degradation.',
        },
        provenance: {},
      }),
      // 2) the text reasoner produces the final answer from the injected evidence observation.
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It is a 76-residue ubiquitin protein.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What protein is this?' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/ubiquitin.fasta', mimeType: 'text/plain', title: 'ubiquitin.fasta' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const outputText = String(body.output_text);
    // Transparency: the answer surfaces the expert's RAW output verbatim, names the expert model,
    // AND keeps the reasoner's final answer.
    assert.match(outputText, /SciForge Model Router — expert translation/);
    assert.match(outputText, /esm2text-protein/);
    assert.match(outputText, /76-residue ubiquitin protein that signals protein degradation/);
    assert.match(outputText, /It is a 76-residue ubiquitin protein\./);
    assert.equal(calls.length, 2);
    // The sci-modality service was called with the file content as payload (translate-only contract).
    assert.match(calls[0]?.url ?? '', /\/modality\/translate$/);
    assert.equal(calls[0]?.headers.authorization, 'Bearer sci-modality-runtime-token');
    assert.match(String(calls[0]?.body.payload ?? ''), /MQIFVKTLTGK/);
    // The text reasoner received the real expert evidence as an observation (no cheating, no raw fallback).
    const textBody = JSON.stringify(calls[1]?.body);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    assert.match(textBody, /source=sci-modality:protein\/esm2text-protein/);
    assert.doesNotMatch(textBody, /status=unsupported/);
    assert.doesNotMatch(textBody, /risk_marker=scientific_modality_risk:low|fallback_marker=workspace_text_fallback|MQIFVKTLTGK/);
  } finally {
    await server.close();
  }
});

test('only allowlisted protein FASTA, PDB/mmCIF, and SMILES files reach the scientific translator with an explicit modality', async () => {
  const cases = [
    { filename: 'sample.fasta', payload: '>protein\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ\n', modality: 'protein' },
    { filename: 'sample.pdb', payload: 'ATOM      1  N   MET A   1      11.104  13.207   9.556  1.00 20.00           N\n', modality: 'protein_structure' },
    { filename: 'sample.mmcif', payload: 'data_protein\nloop_\n_atom_site.group_PDB\n_atom_site.id\nATOM 1\n', modality: 'protein_structure' },
    { filename: 'sample.smiles', payload: 'CC(=O)OC1=CC=CC=C1C(=O)O\n', modality: 'molecule' },
  ] as const;

  for (const entry of cases) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `sciforge-model-router-supported-${entry.modality}-`));
    const uploadDir = join(workspaceRoot, '.sciforge', 'uploads', 'session-sci');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, entry.filename), entry.payload);
    const calls: CapturedFetch[] = [];
    const server = await startModelRouterServer({
      port: 0,
      config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
      env: {
        ...testEnv(),
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
      },
      workspaceRoot,
      fetchImpl: captureFetch(calls, [
        Response.json({
          ok: true,
          data: { modality: entry.modality, model: `test-${entry.modality}`, summary: 'Safe expert evidence.' },
        }),
        chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Done.' })),
      ]),
    });

    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model: 'sciforge-router',
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'Inspect this scientific object.' },
              { type: 'input_object', ref: `.sciforge/uploads/session-sci/${entry.filename}`, mimeType: 'text/plain', title: entry.filename },
            ],
          }],
        }),
      });

      assert.equal(response.status, 200, entry.filename);
      assert.equal(calls.length, 2, entry.filename);
      assert.match(calls[0]?.url ?? '', /\/modality\/translate$/);
      assert.equal(calls[0]?.body.modality, entry.modality);
      assert.equal(calls[0]?.body.payload, entry.payload);
      assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
      assert.doesNotMatch(JSON.stringify(calls[1]?.body), new RegExp(entry.payload.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      await server.close();
    }
  }
});

test('DNA, RNA, and nucleotide-ambiguous FASTA fail closed without calling translator or reasoner', async () => {
  const cases = [
    { filename: 'dna.fasta', payload: '>PRIVATE_DNA_RECORD\nACGTACGTACGTACGTACGT\n' },
    { filename: 'rna.fa', payload: '>PRIVATE_RNA_RECORD\nAUGCAUGCAUGCAUGCAUGC\n' },
    { filename: 'ambiguous.fasta', payload: '>PRIVATE_AMBIGUOUS_RECORD\nACGTNRYWSKMBDHVACGTN\n' },
    {
      filename: 'mixed.fasta',
      payload: '>protein_record\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ\n>PRIVATE_DNA_RECORD\nACGTACGTACGTACGTACGT\n',
    },
  ] as const;

  for (const entry of cases) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-nucleotide-fasta-'));
    const uploadDir = join(workspaceRoot, '.sciforge', 'uploads', 'session-sci');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, entry.filename), entry.payload);
    const calls: CapturedFetch[] = [];
    const server = await startModelRouterServer({
      port: 0,
      config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
      env: {
        ...testEnv(),
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
      },
      workspaceRoot,
      fetchImpl: captureFetch(calls, []),
    });

    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model: 'sciforge-router',
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'Inspect this FASTA.' },
              { type: 'input_object', ref: `.sciforge/uploads/session-sci/${entry.filename}`, mimeType: 'text/plain', title: entry.filename },
            ],
          }],
        }),
      });

      assert.equal(response.status, 415, entry.filename);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.error?.code, 'scientific_modality_unsupported');
      assert.match(body.error?.message ?? '', /raw object text was not sent/i);
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE_(?:DNA|RNA|AMBIGUOUS)_RECORD/);
      assert.equal(calls.length, 0, entry.filename);
    } finally {
      await server.close();
    }
  }
});

test('protected VCF, BED, GFF, and MGF files fail closed without calling translator or reasoner', async () => {
  const cases = [
    { filename: 'variants.vcf', payload: '##fileformat=VCFv4.2\n#CHROM POS ID REF ALT\nPRIVATE_VCF_PAYLOAD\n' },
    { filename: 'regions.bed', payload: 'chr1\t10\t20\tPRIVATE_BED_PAYLOAD\n' },
    { filename: 'genes.gff', payload: 'chr1\tprivate\tgene\t1\t10\t.\t+\t.\tID=PRIVATE_GFF_PAYLOAD\n' },
    { filename: 'spectrum.mgf', payload: 'BEGIN IONS\nTITLE=PRIVATE_MGF_PAYLOAD\n100.0 42\nEND IONS\n' },
  ] as const;

  for (const entry of cases) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unsupported-scientific-'));
    const uploadDir = join(workspaceRoot, '.sciforge', 'uploads', 'session-sci');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, entry.filename), entry.payload);
    const calls: CapturedFetch[] = [];
    const server = await startModelRouterServer({
      port: 0,
      config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
      env: {
        ...testEnv(),
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
      },
      workspaceRoot,
      fetchImpl: captureFetch(calls, []),
    });

    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model: 'sciforge-router',
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'Inspect this scientific object.' },
              { type: 'input_object', ref: `.sciforge/uploads/session-sci/${entry.filename}`, mimeType: 'text/plain', title: entry.filename },
            ],
          }],
        }),
      });

      assert.equal(response.status, 415, entry.filename);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.error?.code, 'scientific_modality_unsupported');
      assert.match(body.error?.message ?? '', /raw object text was not sent/i);
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE_(?:VCF|BED|GFF|MGF)_PAYLOAD/);
      assert.equal(calls.length, 0, entry.filename);
    } finally {
      await server.close();
    }
  }
});

test('high-risk scientific uploads fail closed when the scientific translator is not configured', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-scimodality-missing-'));
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'ubiquitin.fasta'), '>p\nMQIFVKTLTGK\n');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {
      ...testEnv(),
      SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://sci-modality.example:3898',
      SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'legacy-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What protein is this?' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/ubiquitin.fasta', mimeType: 'text/plain', title: 'ubiquitin.fasta' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.error?.code, 'scientific_translator_required');
    assert.match(body.error?.message ?? '', /configure translators\.scientific/i);
    assert.match(body.error?.message ?? '', /raw object text was not sent/i);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('high-risk scientific uploads fail closed when expert translation fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-scimodality-failure-'));
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'ligand.smi'), 'CC(=O)OC1=CC=CC=C1C(=O)O\n');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ ok: false, error: { message: 'translator unavailable with secret' } }, { status: 503 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What molecule is this?' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/ligand.smi', mimeType: 'text/plain', title: 'ligand.smi' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 502);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.error?.code, 'scientific_translation_failed');
    assert.match(body.error?.message ?? '', /expert translator/i);
    assert.match(body.error?.message ?? '', /raw object text was not sent/i);
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? '', /\/modality\/translate$/);
    assert.equal(calls.some((call) => call.url.startsWith('https://text.example/')), false);
  } finally {
    await server.close();
  }
});

test('low-risk textual uploads fall back with explicit risk and fallback markers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-low-risk-fallback-'));
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-sci', 'notes.txt'), 'Plain project notes.\n');
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The notes say plain project notes.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize the notes.' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/notes.txt', mimeType: 'text/plain', title: 'notes.txt' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    const textBody = JSON.stringify(calls[0]?.body);
    assert.match(textBody, /risk_marker=scientific_modality_risk:low/);
    assert.match(textBody, /fallback_marker=workspace_text_fallback/);
    assert.match(textBody, /Plain project notes/);
  } finally {
    await server.close();
  }
});

test('high-risk workspace symlink escapes fail closed before provider calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-symlink-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-outside-'));
  const outsideSecretPath = join(outsideRoot, 'secret.fasta');
  await writeFile(outsideSecretPath, '>secret\nSHOULD_NOT_LEAK_TO_PROVIDER\n');
  const uploadDir = join(workspaceRoot, '.sciforge', 'uploads', 'session-sci');
  await mkdir(uploadDir, { recursive: true });
  await symlink(outsideSecretPath, join(uploadDir, 'secret.fasta'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ scientificTranslator: testScientificTranslatorConfig() }),
    env: {
      ...testEnv(),
      SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'sci-modality-runtime-token',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What protein is this?' },
            { type: 'input_object', ref: '.sciforge/uploads/session-sci/secret.fasta', mimeType: 'text/plain', title: 'secret.fasta' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 502);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.error?.code, 'scientific_translation_failed');
    assert.doesNotMatch(JSON.stringify(body), /SHOULD_NOT_LEAK_TO_PROVIDER/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('input_object vision observations are cached across repeated Model Router requests for the same object', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-input-object-cache-'));
  const imageBytes = Buffer.from('repeated-input-object-pixels');
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-test'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge', 'uploads', 'session-test', 'desktop.png'), imageBytes);
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the screenshot shows a browser window and map UI.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It shows a browser window and map UI.' })),
      chatCompletion('text-final-second', JSON.stringify({ type: 'final_answer', content: 'The cached observation says it shows a browser window and map UI.' })),
    ]),
  });

  const requestBody = {
    model: 'sciforge-router',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '介绍这张截图' },
        {
          type: 'input_object',
          ref: '.sciforge/uploads/session-test/desktop.png',
          mimeType: 'image/png',
          title: 'desktop.png',
        },
      ],
    }],
  };

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });
    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/responses').length, 2);
    const secondTextReasonerBody = JSON.stringify(calls[2]?.body);
    assert.match(secondTextReasonerBody, /cached/i);
    assert.match(secondTextReasonerBody, /browser window and map UI/);

  } finally {
    await server.close();
  }
});

test('inline image vision observations are cached across repeated Model Router requests for the same image sha', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-inline-image-cache-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the hotel voucher total is 421.15 yuan.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
      chatCompletion('text-final-second', JSON.stringify({ type: 'final_answer', content: 'The cached observation says the total is 421.15 yuan.' })),
    ]),
  });

  const requestBody = {
    model: 'sciforge-router',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '介绍图中内容' },
        { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
      ],
    }],
  };

  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });
    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/responses').length, 2);
    const secondTextReasonerBody = JSON.stringify(calls[2]?.body);
    assert.match(secondTextReasonerBody, /cache_status=hit/);
    assert.match(secondTextReasonerBody, /421\.15 yuan/);

  } finally {
    await server.close();
  }
});

test('textual ask refs route through vision translator before text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-textual-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the uploaded image shows a cell culture plate.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'It shows a cell culture plate.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --ref .sciforge/uploads/img.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It shows a cell culture plate.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[0]?.body), /\.sciforge\/uploads\/img\.png/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /What is shown\?/);

  } finally {
    await server.close();
  }
});

test('textual ask refs do not route non-visual artifacts through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-nonvisual-artifact-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The report ref needs a document-capable translator.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --ref artifact:research-report "Summarize the report."',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /vision-model|SciForge visual ref/i);
  } finally {
    await server.close();
  }
});

test('structured textual ref metadata beats chart and figure title keywords', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-textual-metadata-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I could not inspect the referenced modality.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize the attached notes.' },
            {
              ref: 'artifact:chart-figure-notes',
              title: 'Chart and figure notes',
              mime_type: 'text/plain',
            },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /vision-model|SciForge visual ref/i);

  } finally {
    await server.close();
  }
});

test('structured image metadata routes opaque refs through the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-opaque-image-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the opaque ref is an image.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The opaque ref is an image.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is shown?' },
            { ref: 'artifact:opaque-asset', media_type: 'image' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[0]?.body), /artifact:opaque-asset/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');

  } finally {
    await server.close();
  }
});

test('unsupported explicit modality refs degrade without using the vision translator', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unsupported-modality-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I could not inspect the referenced audio modality.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'SciForge audio ref: artifacts/interview.wav\nTranscribe it.',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'I could not inspect the referenced audio modality.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[0]?.body), /status=unsupported/);
    assert.match(JSON.stringify(calls[0]?.body), /kind=audio/);

  } finally {
    await server.close();
  }
});

test('textual ask refs route through vision translator when prefixed by continuation guidance', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-prefixed-textual-ref-'));
  await mkdir(join(workspaceRoot, '.sciforge/uploads/session-a'), { recursive: true });
  await writeFile(join(workspaceRoot, '.sciforge/uploads/session-a/panel.png'), Buffer.from('image-bytes'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the prefixed image shows a macOS desktop.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The prefixed image is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [
          'Continue the active Runtime Codex session. Interpret relative references against the previous turn.\n\nask --ref ".sciforge/uploads/session-a/panel.png" "Describe it."',
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The prefixed image is visible.');
    assert.equal(calls[0]?.body.model, 'vision-model');
    assert.equal(calls[1]?.body.model, 'text-model');
  } finally {
    await server.close();
  }
});

test('unsafe textual refs are not routed or leaked upstream', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unsafe-textual-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'I need a safe uploaded ref to inspect an image.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --config .sciforge/uploads/not-a-ref.png --ref /Users/alice/private.png --ref https://private.example.test/secret.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /\/Users|private\.example|secret\.png|private\.png/i);
    assert.match(JSON.stringify(calls[0]?.body), /What is shown\?/);

  } finally {
    await server.close();
  }
});

test('profile and provider configuration failures fail closed before upstream calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-fail-closed-'));
  const calls: CapturedFetch[] = [];
  const rawPrivateProfile = 'https://private-profile.example/v1?token=secret-token';
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: {
      SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
      SCIFORGE_VISION_API_KEY: 'vision-secret',
    },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const unknownProfile = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json', 'x-sciforge-model-router-profile': 'unknown' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(unknownProfile.status, 400);
    assert.match(await unknownProfile.text(), /unknown_profile/);

    const unsafeProfile = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json', 'x-sciforge-model-router-profile': rawPrivateProfile }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(unsafeProfile.status, 400);
    const unsafeProfileText = await unsafeProfile.text();
    assert.match(unsafeProfileText, /unknown_profile/);
    assert.doesNotMatch(unsafeProfileText, /private-profile|secret-token|https:\/\//i);

    const missingSecret = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', metadata: { profile: 'default' } }),
    });
    assert.equal(missingSecret.status, 400);
    assert.match(await missingSecret.text(), /missing_secret/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('invalid provider compatibility settings fail closed before upstream calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-invalid-compatibility-'));
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['chat-completions'],
  };
  let calls = 0;
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async () => {
      calls += 1;
      return chatCompletion('must-not-send', 'must not send');
    },
  });

  try {
    const response = await fetch(server.url + '/v1/responses', {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /invalid_provider_config/u);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('explicit provider compatibility selects the configured upstream wire', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-explicit-wire-'));
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('explicit-chat', 'configured wire'),
    ]),
  });

  try {
    const response = await fetch(server.url + '/v1/responses', {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(response.status, 200);
    assert.equal(new URL(calls[0]?.url ?? '').pathname, '/v1/chat/completions');
  } finally {
    await server.close();
  }
});

test('default public model alias rejects unregistered request models', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-default-alias-'));
  const calls: CapturedFetch[] = [];
  const rawPrivateModel = 'https://private-provider.example/v1/models/raw-model?token=secret-token';
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: null }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: rawPrivateModel, input: 'hello', metadata: { profile: 'default' } }),
    });

    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /unregistered_model/);
    assert.doesNotMatch(text, /private-provider|raw-model|secret-token|https:\/\//i);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('streaming vision responses expose only the final answer events', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: private internal observation.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Only the final answer.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe it.' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const body = await response.text();
    assert.match(body, /Only the final answer/);
    assert.doesNotMatch(body, /private internal observation|data:image|base64/i);
    const events = parseSseEvents(body);
    const eventTypes = events.map((event) => event.type);
    assert.deepEqual(eventTypes, [
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    const messageItemId = events.find((event) => event.type === 'response.output_item.added')?.item?.id;
    assert.equal(events.find((event) => event.type === 'response.output_text.delta')?.item_id, messageItemId);
    assert.equal(events.find((event) => event.type === 'response.content_part.added')?.item_id, messageItemId);
  } finally {
    await server.close();
  }
});

test('streaming responses send response.created before upstream completion', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-stream-first-byte-'));
  const calls: CapturedFetch[] = [];
  let resolveProvider: (response: Response) => void = () => {};
  const providerResponse = new Promise<Response>((resolve) => {
    resolveProvider = resolve;
  });
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return providerResponse;
    },
  });

  const responsePromise = fetch(`${server.url}/v1/responses`, {
    method: 'POST',
    headers: runtimeHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: 'sciforge-router',
      stream: true,
      input: 'Return quickly.',
    }),
  });
  const firstChunkPromise = responsePromise.then(async (response) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const { value } = await reader.read();
    reader.releaseLock();
    return new TextDecoder().decode(value);
  });

  try {
    const firstChunk = await Promise.race([
      firstChunkPromise,
      new Promise<string>((resolve) => setTimeout(() => resolve('__timeout__'), 500)),
    ]);
    assert.notEqual(firstChunk, '__timeout__');
    assert.match(firstChunk, /response\.created/);
    assert.equal(calls.length, 1);
  } finally {
    resolveProvider(chatCompletion('text-first-byte', 'Late answer.'));
    await firstChunkPromise.catch(() => undefined);
    await server.close();
  }
});

test('image URL inputs are usable by the vision upstream', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-url-'));
  const privateImageUrl = 'https://private.example.test/figure.png?token=secret-token';
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the image URL resolved to a figure.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The figure is visible.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe it.' }, { type: 'input_image', image_url: privateImageUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(JSON.stringify(calls[0]?.body), /private\.example\.test\/figure\.png/);
  } finally {
    await server.close();
  }
});

test('text reasoner HTTP failures preserve safe provider diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-http-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the referenced image is a plot.'),
      chatCompletion('vision-initial-absolute-ref', 'Observation: the absolute private ref was unavailable.'),
      chatCompletion('vision-initial-private-url-ref', 'Observation: the private URL ref was unavailable.'),
      Response.json({
        error: {
          message: 'provider failed with text-secret and raw prompt payload',
          request: { model: 'text-model', secret: 'text-secret' },
        },
      }, { status: 503 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Explain the private figure.' },
            { type: 'input_image', ref: 'artifact:workspace/plots/figure-1.png', mime_type: 'image/png' },
            { type: 'input_image', ref: 'artifact:/Users/alice/private/absolute-secret.png', mime_type: 'image/png' },
            { type: 'input_image', ref: 'ref:https://private.example.test/private-panel.png', mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 503);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'upstream_http_503');
    assert.match(responseBody.error?.message ?? '', /Upstream returned HTTP 503/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|text-model/i);
    assert.equal(calls.length, 4);
    const visionPrompt = calls.slice(0, 3).map((call) => JSON.stringify(call.body)).join('\n');
    assert.match(visionPrompt, /artifact:workspace\/plots\/figure-1\.png/);
    assert.match(visionPrompt, /sha256:[a-f0-9]{64}/);
    assert.doesNotMatch(visionPrompt, /\/Users|private\.example|absolute-secret|private-panel/i);

  } finally {
    await server.close();
  }
});

test('text reasoner exceptions return a network failure', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-exception-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      throw new Error('socket exposed text-secret raw-payload-private prompt Explain SciForge');
    },
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 502);
    assert.equal(calls.length, 1);

  } finally {
    await server.close();
  }
});

test('text reasoner invalid JSON failures preserve safe provider diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-invalid-json-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      new Response('not json with text-secret raw prompt payload', { status: 200 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
      }),
    });

    assert.equal(response.status, 502);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'upstream_invalid_response');
    assert.match(responseBody.error?.message ?? '', /non-JSON response/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|raw prompt payload|Explain SciForge|text-model/i);

  } finally {
    await server.close();
  }
});

test('single-protocol provider rejections are classified without leaking body text', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-error-payload-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({
        error: {
          message: 'provider returned text-secret raw prompt payload for Explain SciForge',
          request: { model: 'text-model' },
        },
      }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
      }),
    });

    assert.equal(response.status, 502);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'upstream_protocol_unsupported');
    assert.match(responseBody.error?.message ?? '', /definitively rejected/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|raw prompt payload|Explain SciForge|text-model/i);

  } finally {
    await server.close();
  }
});

test('vision translator failures force an explicit image unavailable final answer', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'translator timeout with sk-should-not-leak' } }, { status: 504 }),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Based on the text prompt, there is not enough information.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is in the image?' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(body.output_text), /sk-should-not-leak|data:image|base64/i);
  } finally {
    await server.close();
  }
});

test('vision translator auth failures are visible in healthz after text fallback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-auth-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'vision key rejected with sk-should-not-leak' } }, { status: 401 }),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'Based on the text prompt, there is not enough information.' })),
    ]),
  });

  try {
    const routed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is in the image?' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(routed.status, 200);
    const routedBody = await routed.json() as Record<string, unknown>;
    assert.match(String(routedBody.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(routedBody.output_text), /sk-should-not-leak|data:image|base64/i);

    const response = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assert.equal(body.ok, false);
    assert.equal(body.recentError, 'provider-auth');
    assert.deepEqual(body.upstream, {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      role: 'visionTranslator',
      releaseAcceptance: 'not-evaluated',
    });
    assert.doesNotMatch(serialized, forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

type CapturedFetch = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function testConfig(options: {
  publicModelAlias?: string | null;
  imageGenerator?: ModelRouterConfig['profiles'][string]['imageGenerator'];
  scientificTranslator?: ModelRouterConfig['profiles'][string]['translators']['scientific'];
} = {}): ModelRouterConfig {
  const config: ModelRouterConfig = {
    defaultProfile: 'default',
    publicModelAlias: options.publicModelAlias === undefined ? 'sciforge-router' : undefined,
    profiles: {
      default: {
        textReasoner: {
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'SCIFORGE_TEXT_API_KEY',
          model: 'text-model',
        },
        ...(options.imageGenerator ? { imageGenerator: options.imageGenerator } : {}),
        translators: {
          vision: {
            baseUrl: 'https://vision.example/v1',
            apiKeyEnv: 'SCIFORGE_VISION_API_KEY',
            model: 'vision-model',
          },
          ...(options.scientificTranslator ? { scientific: options.scientificTranslator } : {}),
        },
      },
    },
  };
  if (typeof options.publicModelAlias === 'string') config.publicModelAlias = options.publicModelAlias;
  return config;
}

function testResponsesExtensionConfig(): ModelRouterConfig {
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preserveResponsesReasoningContent: true,
  };
  return config;
}

function testScientificTranslatorConfig(): NonNullable<ModelRouterConfig['profiles'][string]['translators']['scientific']> {
  return {
    baseUrl: 'http://sci-modality.example:3898',
    tokenEnv: 'SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN',
    model: 'sci-modality',
  };
}

function testImageGeneratorConfig(): NonNullable<ModelRouterConfig['profiles'][string]['imageGenerator']> {
  return {
    baseUrl: 'https://image.example',
    apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY',
    model: 'image-model',
  };
}

function testConfigWithoutVision(options: { publicModelAlias?: string | null } = {}): ModelRouterConfig {
  const config = testConfig(options);
  config.profiles.default.translators = {};
  return config;
}

function testEnv() {
  return {
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'runtime-secret',
    SCIFORGE_TEXT_API_KEY: 'text-secret',
    SCIFORGE_VISION_API_KEY: 'vision-secret',
  };
}

function runtimeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: 'Bearer runtime-secret',
    ...extra,
  };
}

function imageEditForm(model: string): FormData {
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', 'Edit this image.');
  form.set('image', new Blob(['input-pixels'], { type: 'image/png' }), 'input.png');
  return form;
}

async function assertClientAbortPropagates(options: {
  workspaceRoot: string;
  config: ModelRouterConfig;
  env: Record<string, string>;
  path: string;
  headers?: Record<string, string>;
  body: BodyInit;
  responsesBeforePending?: Response[];
}): Promise<void> {
  const pending = abortingFetch(options.responsesBeforePending);
  const server = await startModelRouterServer({
    port: 0,
    config: options.config,
    env: options.env,
    workspaceRoot: options.workspaceRoot,
    fetchImpl: pending.fetchImpl,
  });
  const client = new AbortController();
  const request = fetch(`${server.url}${options.path}`, {
    method: 'POST',
    headers: runtimeHeaders(options.headers),
    body: options.body,
    signal: client.signal,
  });
  try {
    await promiseWithTimeout(pending.started, `${options.path} upstream did not start`);
    client.abort();
    await assert.rejects(request, /abort/i);
    await promiseWithTimeout(pending.aborted, `${options.path} upstream did not receive abort`);
  } finally {
    await server.close();
  }
}

function abortingFetch(responsesBeforePending: Response[] = []): {
  fetchImpl: typeof fetch;
  started: Promise<void>;
  aborted: Promise<void>;
} {
  const responses = [...responsesBeforePending];
  let markStarted!: () => void;
  let markAborted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  const fetchImpl: typeof fetch = async (_url, init) => {
    const response = responses.shift();
    if (response) return response;
    markStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => {
        markAborted();
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  return { fetchImpl, started, aborted };
}

async function promiseWithTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function captureFetch(calls: CapturedFetch[], responses: Response[]): typeof fetch {
  return async (url, init) => {
    const body = await capturedRequestBody(init?.body);
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    const response = responses.shift();
    assert.ok(response, `Unexpected fetch call to ${url}`);
    return adaptChatFixtureToRequestedWire(response, String(url), body);
  };
}

async function adaptChatFixtureToRequestedWire(
  response: Response,
  url: string,
  requestBody: Record<string, unknown>,
): Promise<Response> {
  if (!response.ok) return response;
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { choices?: unknown }).choices)) {
    return response;
  }
  const canonical = chatCompletionToResponse(
    payload,
    { model: String(requestBody.model ?? '') },
    chatToolNameAliasesFromResponsesTools(requestBody.tools),
  );
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  if (new URL(url).pathname.endsWith('/responses')) {
    return Response.json(canonical, { status: response.status, headers });
  }
  if (new URL(url).pathname.endsWith('/messages')) {
    return Response.json(responseToAnthropicMessage(canonical, { model: String(requestBody.model ?? '') }), {
      status: response.status,
      headers,
    });
  }
  return response;
}

async function capturedRequestBody(body: BodyInit | null | undefined): Promise<Record<string, unknown>> {
  if (body instanceof FormData) {
    const captured: Record<string, unknown> = {};
    for (const [name, value] of body.entries()) {
      const normalized = typeof value === 'string'
        ? value
        : {
            name: value.name,
            type: value.type,
            size: value.size,
            text: await value.text(),
          };
      const existing = captured[name];
      captured[name] = existing === undefined
        ? normalized
        : Array.isArray(existing) ? [...existing, normalized] : [existing, normalized];
    }
    return captured;
  }
  return JSON.parse(String(body ?? '{}')) as Record<string, unknown>;
}

function parseSseEvents(body: string): Array<Record<string, any>> {
  return body
    .split(/\n\n+/)
    .map((chunk) => chunk.split(/\n/).find((line) => line.startsWith('data: '))?.slice('data: '.length))
    .filter((payload): payload is string => Boolean(payload) && payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Record<string, any>);
}

function imagePartCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + imagePartCount(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const ownImagePart = record.type === 'image_url' || record.image_url !== undefined ? 1 : 0;
  return ownImagePart + Object.values(record).reduce((sum, item) => sum + imagePartCount(item), 0);
}

function textOnlyJson(value: unknown): string {
  return JSON.stringify(stripImagePayloads(value));
}

function stripImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImagePayloads);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'image_url' || record.image_url !== undefined) return { type: 'image_url', image_url: '[omitted]' };
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, stripImagePayloads(entry)]));
}

function chatCompletion(
  id: string,
  content: string,
  toolCalls?: Array<Record<string, unknown>>,
  messageExtras: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
) {
  return Response.json({
    id,
    object: 'chat.completion',
    created: 1_717_171_717,
    model: id.includes('vision') ? 'vision-model' : 'text-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...messageExtras,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    ...(Object.keys(usage).length ? { usage } : {}),
  });
}
