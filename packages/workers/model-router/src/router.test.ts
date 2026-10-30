import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TraceEvent, TraceEventInput } from '@sciforge/full-trace';

import { downsampleDataUrl, extractToolResultImages, startModelRouterServer, type ModelRouterConfig } from './router';
import { ModelRouterFullTraceRecorder } from './full-trace-recorder';
import { PNG } from 'pngjs';
import {
  chatCompletionToResponse,
  chatToolNameAliasesFromResponsesTools,
  normalizeResponsesDsmlToolCalls,
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
    const body = await response.json() as {
      object: string
      data: Array<Record<string, unknown>>
      models: Array<Record<string, unknown>>
    };
    assert.equal(body.object, 'list');
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.models, body.data);
    const publicModel = body.data[0]!;
    // The exact shape Codex 0.153's models manager decodes; verified against
    // the real app-server online refresh (codex_model_catalog ModelInfo).
    assert.deepEqual(
      { ...publicModel, base_instructions: '<vendored>' },
      {
        slug: 'public-router-alias',
        display_name: 'public-router-alias',
        description: 'SciForge Model Router public alias',
        default_reasoning_level: null,
        supported_reasoning_levels: [],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 1,
        additional_speed_tiers: [],
        service_tiers: [],
        default_service_tier: null,
        base_instructions: '<vendored>',
        supports_reasoning_summary_parameter: false,
        support_verbosity: false,
        apply_patch_tool_type: 'freeform',
        supports_parallel_tool_calls: false,
        truncation_policy: { mode: 'tokens', limit: 128_000 },
        supports_image_detail_original: false,
        context_window: 128_000,
        max_context_window: 128_000,
        auto_compact_token_limit: 100_000,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: ['text', 'image'],
        supports_search_tool: false,
        use_responses_lite: false,
        id: 'public-router-alias',
        object: 'model',
        owned_by: 'sciforge',
      }
    );
    assert.ok(
      typeof publicModel.base_instructions === 'string' &&
      publicModel.base_instructions.length > 1_000
    );
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
  } finally {
    await server.close();
  }
});

test('declared reasoning levels are published in the model list; undeclared stays null/[] with no invented default', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-declared-levels-'));
  const config = testConfig({ publicModelAlias: 'public-router-alias' });
  config.profiles.default.textReasoner.compatibility = { reasoningEfforts: ['high', 'low'] };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });

  try {
    const response = await fetch(`${server.url}/v1/models`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    const row = body.data[0]!;
    assert.equal(row.default_reasoning_level, null);
    assert.deepEqual(row.supported_reasoning_levels, [
      { effort: 'high', description: 'Declared reasoning effort for this connection' },
      { effort: 'low', description: 'Declared reasoning effort for this connection' },
    ]);
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

test('Codex-shaped structured output survives Responses fallback through every upstream wire', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-fallback-'));
  const calls: CapturedFetch[] = [];
  const outputSchema = {
    type: 'object',
    properties: {
      result: {
        type: 'object',
        properties: {
          outcome: { type: 'string', const: 'completed' },
          summary: { type: 'string' },
        },
        required: ['outcome', 'summary'],
        additionalProperties: false,
      },
    },
    required: ['result'],
    additionalProperties: false,
  };
  const providerText = JSON.stringify({
    result: { outcome: 'completed', summary: 'Structured result preserved.' },
  });
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
      id: 'msg_structured_fallback',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: providerText }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 2 },
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
        input: 'Return the exact Worker result.',
        text: {
          format: {
            type: 'json_schema',
            name: 'collaboration_worker_result',
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      '/v1/responses',
      '/v1/chat/completions',
      '/v1/messages',
    ]);
    assert.deepEqual(calls[0]?.body.text, {
      format: {
        type: 'json_schema',
        name: 'collaboration_worker_result',
        strict: true,
        schema: outputSchema,
      },
    });
    assert.deepEqual(calls[1]?.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'collaboration_worker_result',
        strict: true,
        schema: outputSchema,
      },
    });
    assert.deepEqual(calls[2]?.body.output_config, {
      format: { type: 'json_schema', schema: outputSchema },
    });
    assert.equal(body.output_text, providerText);
  } finally {
    await server.close();
  }
});

test('structured output remains opaque when its schema overlaps Router control discriminators', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-control-'));
  const calls: CapturedFetch[] = [];
  const providerText = JSON.stringify({
    type: 'final_answer',
    content: 'schema-owned content',
  });
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses', 'chat-completions'],
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: await capturedRequestBody(init?.body),
      });
      if (new URL(String(url)).pathname.endsWith('/responses')) {
        return Response.json({ error: { message: 'endpoint not found' } }, { status: 404 });
      }
      return chatCompletion('text-structured-control', providerText);
    },
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Return the schema-owned object.',
        text: {
          format: {
            type: 'json_schema',
            name: 'schema_owned_control',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'final_answer' },
                content: { type: 'string' },
              },
              required: ['type', 'content'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json() as Record<string, unknown>).output_text, providerText);
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      '/v1/responses',
      '/v1/chat/completions',
    ]);
  } finally {
    await server.close();
  }
});

test('structured output containing provider-private values fails closed instead of being rewritten', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-sensitive-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], [
      chatCompletion('text-structured-sensitive', JSON.stringify({ modelEcho: 'text-model' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Return the schema-owned object.',
        text: {
          format: {
            type: 'json_schema',
            name: 'private_value_guard',
            strict: true,
            schema: {
              type: 'object',
              properties: { modelEcho: { type: 'string', const: 'text-model' } },
              required: ['modelEcho'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    assert.equal(response.status, 502);
    const responseText = await response.text();
    assert.match(responseText, /structured_output_private_data/u);
    assert.doesNotMatch(responseText, /text-model/u);
  } finally {
    await server.close();
  }
});

test('json_object text reasoners return schema-valid output and reject invalid output as structured_output_invalid', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-json-object-'));
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
    chatStructuredOutputMode: 'json_object',
  };
  const outputSchema = {
    type: 'object',
    properties: { answer: { type: 'string', minLength: 1 } },
    required: ['answer'],
    additionalProperties: false,
  };
  const validText = JSON.stringify({ answer: 'ok' });
  const invalidText = JSON.stringify({ answer: 'ok', leaked: 'not-in-schema' });
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-json-object-valid', validText),
      chatCompletion('text-json-object-invalid', invalidText),
    ]),
  });
  const send = () => fetch(`${server.url}/v1/responses`, {
    method: 'POST',
    headers: runtimeHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model: 'sciforge-router', input: 'Return the answer.', outputSchema }),
  });

  try {
    const valid = await send();
    assert.equal(valid.status, 200);
    assert.equal((await valid.json() as Record<string, unknown>).output_text, validText);

    const invalid = await send();
    assert.equal(invalid.status, 502);
    const invalidBody = await invalid.text();
    assert.match(invalidBody, /structured_output_invalid/u);
    assert.doesNotMatch(invalidBody, /not-in-schema/u);

    for (const call of calls) {
      assert.deepEqual(call.body.response_format, { type: 'json_object' });
      assert.doesNotMatch(JSON.stringify(call.body), /json_schema/u);
    }
  } finally {
    await server.close();
  }
});

test('structured output rebuilds public items from the checked output text', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-items-'));
  const providerText = JSON.stringify({ answer: 'ok' });
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  const requestBody = {
    model: 'sciforge-router',
    input: 'Return the schema-owned object.',
    text: {
      format: {
        type: 'json_schema',
        name: 'public_item_guard',
        strict: true,
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async () => Response.json({
      id: 'resp_structured_items',
      object: 'response',
      status: 'completed',
      output_text: providerText,
      output: [{
        id: 'msg_private',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        provider_model: 'text-model',
        provider_url: 'https://text.example/v1',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ answer: 'text-secret' }),
          annotations: [{ private: 'text-secret' }],
        }],
      }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, providerText);
    assert.doesNotMatch(JSON.stringify(body), /text-secret|text-model|text\.example/u);
    const output = body.output as Array<Record<string, unknown>>;
    assert.equal(output.length, 1);
    assert.equal(output[0]?.type, 'message');
    assert.deepEqual(output[0]?.content, [{
      type: 'output_text',
      text: providerText,
      annotations: [],
    }]);

    const streamedResponse = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...requestBody, stream: true }),
    });
    assert.equal(streamedResponse.status, 200);
    const streamBody = await streamedResponse.text();
    assert.doesNotMatch(streamBody, /text-secret|text-model|text\.example/u);
    const events = parseSseEvents(streamBody);
    assert.equal(events.find((event) => event.type === 'response.output_text.done')?.text, providerText);
    const completed = events.find((event) => event.type === 'response.completed')?.response;
    assert.equal(completed?.output_text, providerText);
    assert.equal(completed?.output?.length, 1);
  } finally {
    await server.close();
  }
});

test('streaming responses preserve an incomplete terminal result', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-incomplete-stream-'));
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
    fetchImpl: captureFetch([], [new Response([
      'event: response.incomplete',
      `data: ${JSON.stringify({
        type: 'response.incomplete',
        response: {
          id: 'resp_incomplete',
          object: 'response',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          model: 'text-model',
          output: [{
            id: 'msg_partial',
            type: 'message',
            status: 'incomplete',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Partial answer', annotations: [] }],
          }],
          output_text: 'Partial answer',
        },
      })}`,
      '',
      '',
    ].join('\n'), { headers: { 'content-type': 'text/event-stream' } })]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', stream: true, input: 'Continue.' }),
    });
    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    const terminal = events.at(-1);
    assert.equal(terminal?.type, 'response.incomplete');
    assert.equal(terminal?.response?.status, 'incomplete');
    assert.equal(terminal?.response?.output_text, 'Partial answer');
    assert.deepEqual(terminal?.response?.incomplete_details, { reason: 'max_output_tokens' });
    assert.equal(events.some((event) => event.type === 'response.completed'), false);
  } finally {
    await server.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('streaming responses preserve commentary phase on every message item', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-commentary-stream-'));
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
    fetchImpl: captureFetch([], [Response.json({
      id: 'resp_commentary',
      object: 'response',
      status: 'completed',
      model: 'text-model',
      output: [{
        id: 'msg_commentary',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: 'Writing the report now.', annotations: [] }],
      }],
      output_text: 'Writing the report now.',
    })]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', stream: true, input: 'Continue.' }),
    });
    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    const messageItems = events.filter((event) => event.item?.type === 'message');
    assert.equal(messageItems.length, 2);
    assert.ok(messageItems.every((event) => event.item.phase === 'commentary'));
    const terminal = events.find((event) => event.type === 'response.completed');
    assert.equal(terminal?.response?.output?.[0]?.phase, 'commentary');
  } finally {
    await server.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('anthropic messages route through the configured text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-messages-'));
  const calls: CapturedFetch[] = [];
  const outputSchema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };
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
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: outputSchema },
        },
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
    assert.deepEqual(calls[0]?.body.output_config, {
      effort: 'high',
      format: { type: 'json_schema', schema: outputSchema },
    });
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
  const outputSchema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };
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
        verbosity: 'low',
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'hello' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chat_answer',
            strict: true,
            schema: outputSchema,
          },
        },
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
    assert.equal(calls[0]?.body.verbosity, 'low');
    assert.deepEqual(calls[0]?.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'chat_answer',
        strict: true,
        schema: outputSchema,
      },
    });
  } finally {
    await server.close();
  }
});

test('chat compatibility preserves function declarations, choice and complete tool transcripts for Responses upstreams', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-chat-tools-responses-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(), workspaceRoot,
    fetchImpl: captureFetch(calls, [Response.json({
      id: 'resp_chat_tools', object: 'response', status: 'completed', model: 'text-model',
      output: [{ type: 'function_call', id: 'fc_next', call_id: 'call_next', name: 'lookup', arguments: '{"path":"next"}', status: 'completed' }],
    })]),
  });
  const parameters = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false };
  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up a path.', parameters, strict: true } }],
        tool_choice: { type: 'function', function: { name: 'lookup' } }, parallel_tool_calls: false,
        messages: [
          { role: 'user', content: 'Look up both paths.' },
          { role: 'assistant', content: null, tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'lookup', arguments: '{"path":"a"}' } },
            { id: 'call_b', type: 'function', function: { name: 'lookup', arguments: '{"path":"b"}' } },
          ] },
          { role: 'tool', tool_call_id: 'call_a', content: 'result a' },
          { role: 'tool', tool_call_id: 'call_b', content: 'result b' },
          { role: 'user', content: 'Look up the next path.' },
        ],
      }),
    });
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]!.url).pathname, '/v1/responses');
    assert.deepEqual(calls[0]!.body.tools, [{ type: 'function', name: 'lookup', description: 'Look up a path.', parameters, strict: true }]);
    assert.deepEqual(calls[0]!.body.tool_choice, { type: 'function', name: 'lookup' });
    assert.equal(calls[0]!.body.parallel_tool_calls, false);
    const input = calls[0]!.body.input as Array<Record<string, any>>;
    assert.deepEqual(input.filter(item => item.type === 'function_call').map(({ type, call_id, name, arguments: args }) => ({ type, call_id, name, arguments: args })), [
      { type: 'function_call', call_id: 'call_a', name: 'lookup', arguments: '{"path":"a"}' },
      { type: 'function_call', call_id: 'call_b', name: 'lookup', arguments: '{"path":"b"}' },
    ]);
    assert.deepEqual(input.filter(item => item.type === 'function_call_output').map(({ type, call_id, output }) => ({ type, call_id, output })), [
      { type: 'function_call_output', call_id: 'call_a', output: 'result a' },
      { type: 'function_call_output', call_id: 'call_b', output: 'result b' },
    ]);
    assert.equal(input.some(item => item.role === 'tool'), false);
    assert.equal(body.choices[0].finish_reason, 'tool_calls');
    assert.deepEqual(body.choices[0].message.tool_calls, [{ id: 'call_next', type: 'function', function: { name: 'lookup', arguments: '{"path":"next"}' } }]);
  } finally { await server.close(); await rm(workspaceRoot, { recursive: true, force: true }); }
});

test('chat compatibility preserves whitespace in tool outputs and function arguments', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-chat-tool-whitespace-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(), workspaceRoot,
    fetchImpl: captureFetch(calls, [Response.json({ id: 'resp_whitespace', object: 'response', status: 'completed', output: [] })]),
  });
  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        messages: [
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_ws', type: 'function', function: { name: 'lookup', arguments: '  {"path":"a"}  ' } }] },
          { role: 'tool', tool_call_id: 'call_ws', content: [{ type: 'text', text: '  important whitespace \\n' }] },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const input = calls[0]!.body.input as Array<Record<string, any>>;
    assert.deepEqual(input.filter(item => item.type === 'function_call'), [{ type: 'function_call', call_id: 'call_ws', name: 'lookup', arguments: '  {"path":"a"}  ' }]);
    assert.deepEqual(input.filter(item => item.type === 'function_call_output'), [{ type: 'function_call_output', call_id: 'call_ws', output: [{ type: 'input_text', text: '  important whitespace \\n' }] }]);
  } finally { await server.close(); await rm(workspaceRoot, { recursive: true, force: true }); }
});

test('chat compatibility maps allowed-tools choices to the Responses tool shape', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-chat-allowed-tools-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(), workspaceRoot,
    fetchImpl: captureFetch(calls, [Response.json({ id: 'resp_allowed_tools', object: 'response', status: 'completed', output: [] })]),
  });
  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up.', parameters: { type: 'object' } } }],
        tool_choice: { type: 'allowed_tools', allowed_tools: { mode: 'auto', tools: [{ type: 'function', function: { name: 'lookup' } }] } },
        messages: [{ role: 'user', content: 'Use a tool.' }],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]!.body.tool_choice, { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'lookup' }] });
  } finally { await server.close(); await rm(workspaceRoot, { recursive: true, force: true }); }
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

test('converts complete DSML tool markup emitted as assistant text into a function call', () => {
  const canonical = chatCompletionToResponse({
    id: 'chat_dsml',
    object: 'chat.completion',
    choices: [{
      message: {
        role: 'assistant',
        content: '<｜DSML｜tool_calls><｜DSML｜invoke name="exec_command"><｜DSML｜parameter name="arguments" string="false">{"cmd":"rg -n test"}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>',
      },
      finish_reason: 'stop',
    }],
  });
  assert.deepEqual(canonical.output?.map((item) => ({
    type: item.type,
    name: item.name,
    arguments: item.arguments,
  })), [{ type: 'function_call', name: 'exec_command', arguments: '{"cmd":"rg -n test"}' }]);
  assert.equal(canonical.output_text, '');
});

test('converts DSML tool markup in a Responses message item before runtime delivery', () => {
  const normalized = normalizeResponsesDsmlToolCalls({
    object: 'response',
    id: 'resp_dsml',
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: '<｜DSML｜tool_calls><｜DSML｜invoke name="exec_command"><｜DSML｜parameter name="arguments">{"cmd":"pwd"}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>',
      }],
    }],
    output_text: '',
  });
  assert.deepEqual(normalized.output?.map((item) => ({ type: item.type, name: item.name })), [
    { type: 'function_call', name: 'exec_command' },
  ]);
  assert.equal(normalized.output_text, '');
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices?.[0]?.message?.content, 'The figure is readable.');
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/chat/completions');
    const visionMessages = calls[1]?.body.messages as Array<Record<string, any>>;
    assert.deepEqual(visionMessages[1]?.content?.map((part: Record<string, unknown>) => part.type), [
      'text',
      'image_url',
    ]);
    assert.equal(visionMessages[1]?.content?.[1]?.image_url?.url, pngDataUrl);
    assert.equal(calls[2]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[2]?.body.max_tokens, 1024);
    assert.doesNotMatch(JSON.stringify(calls[2]?.body), /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('vision routing emits strict Responses content parts while retaining the canonical chat fallback', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-responses-vision-schema-'));
  const config = testConfig();
  config.profiles.default.translators.vision!.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const calls: CapturedFetch[] = [];
  const responses = [
    modalityInspectionRequest('image_1'),
    chatCompletion('vision-strict-responses', 'Observation: the diagram contains three labeled stages.'),
    chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The diagram has three labeled stages.' })),
  ];
  let strictSchemaError: unknown;
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      const body = await capturedRequestBody(init?.body);
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      });
      if (new URL(String(url)).pathname.endsWith('/responses')) {
        try {
          const input = body.input as Array<Record<string, any>>;
          const content = input[0]?.content as Array<Record<string, any>>;
          assert.equal(input[0]?.role, 'user');
          assert.deepEqual(content.map((part) => part.type), ['input_text', 'input_image']);
          assert.match(content[0]?.text ?? '', /User request:/u);
          assert.deepEqual(content[1], {
            type: 'input_image',
            image_url: pngDataUrl,
            detail: 'auto',
          });
          assert.doesNotMatch(JSON.stringify(content), /"type":"(?:text|image_url)"/u);
        } catch (error) {
          strictSchemaError = error;
          return Response.json({ error: { message: 'strict Responses schema rejected the request' } }, { status: 400 });
        }
      }
      const fixture = responses.shift();
      assert.ok(fixture, `Unexpected fetch call to ${url}`);
      return adaptChatFixtureToRequestedWire(fixture, String(url), body);
    },
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
            { type: 'input_text', text: 'How many labeled stages are shown?' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    if (strictSchemaError) throw strictSchemaError;
    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.output_text, 'The diagram has three labeled stages.');
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[2]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[2]?.body), /data:image|base64|tiny-png/i);
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
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-initial-a', 'Observation: first image.'),
      modalityInspectionRequest('image_2'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.choices?.[0]?.message?.content, 'Both images were inspected.');
    assert.equal(calls.length, 5);
    assert.equal(imagePartCount(calls[1]?.body.messages), 1);
    assert.equal(imagePartCount(calls[3]?.body.messages), 1);
    assert.equal(imagePartCount(calls[4]?.body.messages), 0);
    assert.doesNotMatch(textOnlyJson(calls[1]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[3]?.body.messages), new RegExp(fallbackBase64));
    assert.doesNotMatch(textOnlyJson(calls[4]?.body.messages), new RegExp(fallbackBase64));
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

test('keeps health responsive and rejects new model work while Full Trace is backlogged', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-backlog-'));
  let releaseWrite: (() => void) | undefined;
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany() {
        await writeReleased;
      },
    },
    maxOutstandingWork: 1,
  });
  recorder.commit([{
    traceId: 'trace-backlog',
    source: 'model-router',
    kind: 'lifecycle',
    payload: { phase: 'queued' },
  }]);
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async () => {
      throw new Error('Backlogged requests must not reach an upstream provider.');
    },
    fullTraceRecorder: recorder,
  });

  try {
    const health = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(health.status, 503);
    const healthBody = await health.json() as Record<string, unknown>;
    assert.equal(healthBody.traceCapture, 'backlogged');
    assert.equal((healthBody.traceCaptureDiagnostics as Record<string, unknown>).pendingBatches, 1);

    const rejected = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'do not route this' }),
    });
    assert.equal(rejected.status, 503);
    const rejectedBody = await rejected.json() as { error?: { code?: string } };
    assert.equal(rejectedBody.error?.code, 'full_trace_backlogged');

    releaseWrite?.();
    await recorder.flush();
    const recovered = await fetch(`${server.url}/healthz?check=upstream`);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json() as Record<string, unknown>).traceCapture, 'ready');
  } finally {
    releaseWrite?.();
    await server.close();
  }
});

test('authenticates model routes before exposing Full Trace admission state', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-auth-order-'));
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      status: () => ({ state: 'failed', failure: '/Users/private/full-traces: EACCES' }),
      async appendMany() {},
    },
  });
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async () => {
      throw new Error('Rejected trace requests must not reach an upstream provider.');
    },
    fullTraceRecorder: recorder,
  });

  try {
    const unauthorized = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', input: 'unauthorized' }),
    });
    assert.equal(unauthorized.status, 401);
    assert.doesNotMatch(await unauthorized.text(), /trace|EACCES|Users\/private/i);

    const authorized = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'authorized' }),
    });
    assert.equal(authorized.status, 503);
    const publicFailure = await authorized.text();
    assert.match(publicFailure, /full_trace_failed/);
    assert.doesNotMatch(publicFailure, /EACCES|Users\/private/);
  } finally {
    await server.close();
  }
});

test('fails readiness and authorized model admission when required Full Trace is disabled', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-required-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async () => {
      throw new Error('Untraced model work must not reach an upstream provider.');
    },
    fullTraceRequired: true,
  });

  try {
    const health = await fetch(`${server.url}/healthz`);
    assert.equal(health.status, 503);
    assert.equal((await health.json() as Record<string, unknown>).traceCapture, 'disabled');

    const rejected = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'must be traced' }),
    });
    assert.equal(rejected.status, 503);
    const body = await rejected.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'full_trace_disabled');
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
      responsesBeforePending: [modalityInspectionRequest('image_1')],
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

test('on-demand routing answers from text without inspecting an unused attached image', async () => {
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0, config: testConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'model-router-unused-image-')),
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-only', JSON.stringify({ type: 'final_answer', content: 'Four.' })),
    ]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
        { type: 'input_text', text: 'What is 2 + 2? The attached image is unrelated.' },
        { type: 'input_image', image_url: pngDataUrl },
      ] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { output_text: string }).output_text, 'Four.');
    assert.equal(calls.length, 1);
    assertMetadataOnly(calls[0]);
  } finally { await server.close(); }
});

test('on-demand vision cache separates targeted questions about the same image', async () => {
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0, config: testConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'model-router-question-cache-')),
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1', 'Read the x-axis label.'),
      chatCompletion('label', 'The x-axis label is Time (s).'),
      modalityInspectionRequest('image_1', 'Read the bar colors.'),
      chatCompletion('colors', 'The bars are blue.'),
      chatCompletion('final', JSON.stringify({ type: 'final_answer', content: 'Time (s); blue bars.' })),
    ]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Read the chart label and colors.' },
        { type: 'input_image', image_url: pngDataUrl },
      ] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { output_text: string }).output_text, 'Time (s); blue bars.');
    assert.deepEqual(calls.map((call) => new URL(call.url).hostname), [
      'text.example', 'vision.example', 'text.example', 'vision.example', 'text.example',
    ]);
    assertMetadataOnly(calls[0]);
    assert.match(JSON.stringify(calls[1]?.body), /Read the x-axis label/);
    assert.match(JSON.stringify(calls[3]?.body), /Read the bar colors/);
    assert.match(JSON.stringify(calls[4]?.body), /Time \(s\)/);
    assert.match(JSON.stringify(calls[4]?.body), /bars are blue/);
  } finally { await server.close(); }
});

test('on-demand inspection cannot resend an image dropped by the context budget', async () => {
  const config = testConfig();
  config.profiles.default.contextWindow = 2048;
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'model-router-dropped-target-')),
    fetchImpl: captureFetch(calls, [modalityInspectionRequest('image_1')]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Read the chart.' },
        { type: 'input_image', image_url: pngDataUrl },
      ] }] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'modality_inspection_unavailable');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[0]?.body), /status=dropped/);
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /status=available|data:image/);
  } finally { await server.close(); }
});

test('strict inspection deduplicates image payloads while retaining each input identity', async () => {
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0, config: testConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'model-router-strict-duplicate-')),
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision', 'Both references contain the same blue bars.'),
      chatCompletion('final', '{"summary":"Blue bars."}'),
    ]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({
        'content-type': 'application/json', 'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Compare both images.' },
        { type: 'input_image', image_url: pngDataUrl },
        { type: 'input_image', image_url: pngDataUrl },
      ] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    const synthesis = JSON.stringify(calls[1]?.body);
    assert.match(synthesis, /Target modality_input: image_1/);
    assert.match(synthesis, /Target modality_input: image_2/);
    assert.equal((synthesis.match(/Both references contain the same blue bars/g) ?? []).length, 2);
  } finally { await server.close(); }
});

test('strict visual supplements fail closed on empty or rejected provider evidence', async (context) => {
  for (const failure of [
    { name: 'empty evidence', response: chatCompletion('empty', ''), status: 502, code: 'vision_translation_empty' },
    { name: 'provider authentication', response: Response.json({ error: { message: 'vision-secret rejected' } }, { status: 401 }), status: 401, code: 'upstream_http_401' },
  ]) {
    await context.test(failure.name, async () => {
      const config = testConfig();
      config.profiles.default.translators.vision!.maxSupplementRounds = 1;
      const calls: CapturedFetch[] = [];
      const server = await startModelRouterServer({
        port: 0, config, env: testEnv(),
        workspaceRoot: await mkdtemp(join(tmpdir(), 'model-router-strict-supplement-')),
        fetchImpl: captureFetch(calls, [
          chatCompletion('initial', 'A plot is visible.'),
          modalityInspectionRequest('image_1', 'Read the exact axis label.'),
          failure.response,
        ]),
      });
      try {
        const response = await fetch(`${server.url}/v1/responses`, {
          method: 'POST', headers: runtimeHeaders({
            'content-type': 'application/json', 'x-sciforge-model-router-evidence-policy': 'required',
          }),
          body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
            { type: 'input_text', text: 'Read the exact axis label.' },
            { type: 'input_image', image_url: pngDataUrl },
          ] }] }),
        });
        assert.equal(response.status, failure.status);
        const body = await response.json() as { error: { code: string; stage: string; cause: { code: string } } };
        assert.equal(body.error.code, 'vision_evidence_unavailable');
        assert.equal(body.error.stage, 'vision_translation');
        assert.equal(body.error.cause.code, failure.code);
        assert.doesNotMatch(JSON.stringify(body), /vision-secret|data:image/);
        assert.deepEqual(calls.map((call) => new URL(call.url).hostname), ['vision.example', 'text.example', 'vision.example']);
        if (failure.status === 401) {
          const health = await fetch(`${server.url}/healthz`);
          assert.equal(health.status, 503);
          const diagnostic = await health.json() as { upstream: { category: string; role: string; httpStatus: number } };
          assert.equal(diagnostic.upstream.category, 'provider-auth');
          assert.equal(diagnostic.upstream.role, 'visionTranslator');
          assert.equal(diagnostic.upstream.httpStatus, 401);
        }
      } finally { await server.close(); }
    });
  }
});

test('vision responses inspect each reference on demand before final synthesis', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-initial', 'Observation: the chart label is ATP concentration.'),
      modalityInspectionRequest('image_2'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The chart label is ATP concentration.');
    assert.equal(calls.length, 5);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[1]?.headers.authorization, 'Bearer vision-secret');
    assert.equal(calls[1]?.body.model, 'vision-model');
    assert.match(JSON.stringify(calls[1]?.body), /data:image\/png;base64/);
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /artifact:microscopy-panel/);
    assert.equal(calls[3]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[3]?.body), /artifact:microscopy-panel/);
    assert.doesNotMatch(JSON.stringify(calls[3]?.body), /data:image|base64|tiny-png/i);
    assert.equal(calls[4]?.url, 'https://text.example/v1/responses');
    assert.doesNotMatch(JSON.stringify(calls[4]?.body), /data:image|base64|tiny-png/i);
    assert.match(JSON.stringify(calls[4]?.body), /Observation: the chart label is ATP concentration/);

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
      modalityInspectionRequest('image_1'),
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
    assert.equal(calls.length, 2);
    assertMetadataOnly(calls[0]);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /status=unavailable/);
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
        instructions: 'Finish the requested task.',
        tools: [{ type: 'function', name: 'computer_use', parameters: { type: 'object' } }],
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
    const input = calls[0]?.body.input as Array<Record<string, unknown>>;
    assert.equal(input[1]?.call_id, 'call_screenshot_1');
    assert.equal(input[2]?.call_id, 'call_screenshot_1');
    assert.match(String(calls[0]?.body.instructions), /Finish the requested task/);
    assert.doesNotMatch(String(calls[0]?.body.instructions), /"type":"final_answer"/);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows a settings window.');
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    const visionBody = JSON.stringify(calls[1]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[2]?.body);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The screenshot shows arXiv search results.');
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    const visionBody = JSON.stringify(calls[1]?.body);
    assert.match(visionBody, new RegExp(`data:image/png;base64,${imageData}`));
    const textReasonerBody = JSON.stringify(calls[2]?.body);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body.content, [{ type: 'text', text: 'The screenshot shows arXiv search results.' }]);
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/messages');
    assert.match(JSON.stringify(calls[1]?.body), new RegExp(`"type":"base64","media_type":"image/png","data":"${imageData}"`));
    const textReasonerBody = JSON.stringify(calls[2]?.body);
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

for (const stream of [false, true]) {
test(`multimodal agent requests preserve instructions, roles and tool continuation through inspection (stream=${stream})`, async () => {
  const calls: CapturedFetch[] = [];
  const commentary = { id: 'msg_progress', type: 'message', role: 'assistant', phase: 'commentary',
    status: 'completed', content: [{ type: 'output_text', text: 'I will update the caption.' }] };
  const editCall = { id: 'fc_edit', type: 'function_call', call_id: 'call_edit', name: 'edit_document',
    arguments: '{"caption":"Figure 5"}', status: 'completed' };
  const server = await startModelRouterServer({
    port: 0, config: testResponsesExtensionConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'multimodal-agent-continuation-')),
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision', 'The figure has panels A through D.'),
      new Response(JSON.stringify({ id: 'resp_edit', object: 'response', status: 'completed',
        output: [commentary, editCall] }), { headers: { 'content-type': 'application/json' } }),
      chatCompletion('final', 'The caption was updated and verified.'),
    ]),
  });
  const reasoning = { id: 'rs_prior', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Inspect before editing.' }] };
  const input = [
    { role: 'developer', content: 'Complete the authorized edit and verify the result.' },
    { role: 'user', content: [{ type: 'input_text', text: 'Correct the figure caption.' },
      { type: 'input_image', image_url: pngDataUrl }] },
    { role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Reading the report.' }] },
    reasoning,
    { type: 'function_call', call_id: 'call_read', name: 'read_document', arguments: '{"path":"report.md"}' },
    { type: 'function_call_output', call_id: 'call_read', output: 'Existing caption: Figure 4 and 5.' },
    { role: 'user', content: 'Only Figure 5 needs a caption.' },
  ];
  const request = { model: 'sciforge-router', stream, instructions: 'You are an agent. Carry out the requested work.', input,
    tools: [{ type: 'function', name: 'edit_document', parameters: { type: 'object' } }],
    tool_choice: 'auto', parallel_tool_calls: false };
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    const body = stream
      ? parseSseEvents(await response.text()).find(event => event.type === 'response.completed')!.response
      : await response.json() as { id: string; output: Array<Record<string, unknown>> };
    assert.deepEqual(body.output, [commentary, editCall]);
    for (const call of [calls[0]!, calls[2]!]) {
      assert.match(String(call.body.instructions), /Carry out the requested work/);
      assert.doesNotMatch(String(call.body.instructions), /"type":"final_answer"/);
      const forwarded = call.body.input as Array<Record<string, unknown>>;
      assert.deepEqual(forwarded.slice(0, input.length).map(item => item.type ?? item.role),
        input.map(item => 'type' in item ? item.type : item.role));
      assert.deepEqual(forwarded[0], input[0]);
      assert.deepEqual(forwarded.slice(2, input.length), input.slice(2));
      assert.equal(forwarded.at(-1)?.role, 'user');
      assert.doesNotMatch(JSON.stringify(call.body), /data:image|tiny-png/);
      assert.equal(call.body.tool_choice, 'auto');
      assert.equal(call.body.parallel_tool_calls, false);
    }
    assert.match(JSON.stringify(calls[2]?.body.input), /panels A through D/);
    const completed = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...request, previous_response_id: body.id, input: [...input, commentary,
        { type: 'function_call_output', call_id: 'call_edit', output: 'Updated and verified caption.' }] }),
    });
    assert.equal(completed.status, 200);
    await completed.text();
    const continued = calls[3]?.body.input as Array<Record<string, unknown>>;
    assert.equal(continued.find(item => item.call_id === 'call_edit')?.type, 'function_call');
    assert.equal(continued.filter(item => item.call_id === 'call_edit').length, 2);
  } finally { await server.close(); }
});
}

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

for (const stream of [false, true]) {
  for (const toolCall of [false, true]) {
    test(`Chat preserves reasoning for ${toolCall ? 'tool calls' : 'answers'} (stream=${stream})`, async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-chat-reasoning-'));
      const calls: CapturedFetch[] = [];
      const config = testConfig();
      config.profiles.default.textReasoner.compatibility = {
        preferredProtocol: 'chat-completions', allowedProtocols: ['chat-completions'],
      };
      const server = await startModelRouterServer({
        port: 0, config, env: testEnv(), workspaceRoot,
        fetchImpl: captureFetch(calls, [chatCompletion(
          'chat-reasoning',
          toolCall ? '' : 'The caption is ready.',
          toolCall ? [{ id: 'call_caption', type: 'function', function: { name: 'read_report', arguments: '{}' } }] : undefined,
          { reasoning_content: 'Read the annotation first.\nThen update its caption.' },
        )]),
      });
      try {
        const response = await fetch(`${server.url}/v1/chat/completions`, {
          method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            model: 'sciforge-router', stream,
            messages: [
              { role: 'user', content: 'Which report?' },
              { role: 'assistant', content: 'The preview report?', reasoning_content: 'Confirm the target before editing.' },
              { role: 'user', content: 'Yes, use its annotation.' },
            ],
          }),
        });
        assert.equal(response.status, 200);
        const body = stream
          ? parseSseEvents(await response.text()).find(event => event.choices?.[0]?.delta)?.choices?.[0]?.delta
          : (await response.json() as Record<string, any>).choices?.[0]?.message;
        assert.equal(body?.reasoning_content, 'Read the annotation first.\nThen update its caption.');
        assert.equal(body?.content, toolCall ? null : 'The caption is ready.');
        if (toolCall) assert.equal(body?.tool_calls?.[0]?.id, 'call_caption');
        const history = calls[0]?.body.messages as Array<Record<string, unknown>>;
        assert.equal(history.find(message => message.role === 'assistant')?.reasoning_content,
          'Confirm the target before editing.');
      } finally { await server.close(); await rm(workspaceRoot, { recursive: true, force: true }); }
    });
  }
}

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
  test(`Chat delivers live reasoning before upstream completion (${protocol})`, { timeout: 10_000 }, async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-live-reasoning-'));
    const config = testConfig();
    config.profiles.default.textReasoner.compatibility = { preferredProtocol: protocol, allowedProtocols: [protocol] };
    let finish!: () => void;
    const completionGate = new Promise<void>(resolve => { finish = resolve; });
    const reasoning = '先阅读右侧注释，再修改对应图注。';
    const encoder = new TextEncoder();
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
    const first = protocol === 'responses'
      ? event({ type: 'response.reasoning_summary_text.delta', delta: reasoning })
      : protocol === 'chat-completions'
        ? event({ id: 'upstream-id', choices: [{ index: 0, delta: { reasoning_content: reasoning } }] })
        : event({ type: 'message_start', message: { id: 'upstream-id', type: 'message', role: 'assistant', model: 'text-model', content: [] } }) +
          event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
          event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: reasoning } });
    const last = protocol === 'responses'
      ? event({ type: 'response.completed', response: {
          id: 'upstream-id', object: 'response', model: 'text-model', status: 'completed',
          output: [{ id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }] },
            { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成。' }] }],
          output_text: '完成。'
        } })
      : protocol === 'chat-completions'
        ? event({ id: 'upstream-id', choices: [{ index: 0, delta: { content: '完成。' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'
        : event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) +
          event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '完成。' } }) +
          event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + event({ type: 'message_stop' });
    const server = await startModelRouterServer({
      port: 0, config, env: testEnv(), workspaceRoot,
      fetchImpl: (async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).stream, true);
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            // Break inside multibyte UTF-8 and CRLF frames as a network can.
            for (const byte of encoder.encode(first)) controller.enqueue(Uint8Array.of(byte));
            await completionGate;
            controller.enqueue(encoder.encode(last));
            controller.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch,
    });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5_000);
    try {
      const response = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST', signal: abort.signal,
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: 'sciforge-router', stream: true,
          messages: [{ role: 'user', content: '阅读右侧注释，修改报告' }] }),
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const early = decoder.decode((await reader.read()).value, { stream: true });
      assert.ok(early.includes(reasoning), 'Reasoning must arrive while upstream completion is blocked.');
      assert.ok(!early.includes('[DONE]'));
      finish();
      let all = early;
      for (;;) {
        const { done, value } = await reader.read();
        all += decoder.decode(value, { stream: !done });
        if (done) break;
      }
      const deltas = parseSseEvents(all).flatMap(e => e.choices ?? []).map((c: Record<string, any>) => c.delta ?? {});
      assert.equal(deltas.map(d => d.reasoning_content ?? '').join(''), reasoning);
      assert.equal(deltas.map(d => d.content ?? '').join(''), '完成。');
      assert.ok(all.includes('[DONE]'));
    } finally {
      clearTimeout(timeout); finish(); abort.abort();
      await server.close(); await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
}

test('streaming Chat tool calls include stable indexes for every returned call', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-chat-stream-tool-indexes-'));
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(), workspaceRoot,
    fetchImpl: captureFetch([], [Response.json({
      id: 'resp_stream_tool_indexes', object: 'response', status: 'completed', model: 'text-model',
      output: [
        { type: 'reasoning', id: 'rs_tools', summary: [{ type: 'summary_text', text: 'Inspect both files.' }] },
        { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'lookup', arguments: '{"path":"a"}', status: 'completed' },
        { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'lookup', arguments: '{"path":"b"}', status: 'completed' },
      ],
    })]),
  });
  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', stream: true, messages: [{ role: 'user', content: 'Use both tools.' }] }),
    });
    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    assert.equal(events[0]?.choices?.[0]?.delta?.reasoning_content, 'Inspect both files.');
    const toolCalls = events.flatMap(event => event.choices ?? []).flatMap((choice: Record<string, any>) => choice.delta?.tool_calls ?? []);
    assert.deepEqual(toolCalls, [
      { index: 0, id: 'call_a', type: 'function', function: { name: 'lookup', arguments: '{"path":"a"}' } },
      { index: 1, id: 'call_b', type: 'function', function: { name: 'lookup', arguments: '{"path":"b"}' } },
    ]);
  } finally { await server.close(); await rm(workspaceRoot, { recursive: true, force: true }); }
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    const visionBody = JSON.stringify(calls[1]?.body);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It is a hotel voucher.');
    assert.equal(calls.length, 3);
    const visionBody = JSON.stringify(calls[1]?.body);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The hotel voucher total is 421.15 yuan.');
    assert.equal(calls.length, 3);
    const visionBody = JSON.stringify(calls[1]?.body);
    assert.match(visionBody, new RegExp(expectedDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const textReasonerBody = JSON.stringify(calls[2]?.body);
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

test('protein evidence informs but never prefixes a structured Worker result', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-structured-protein-'));
  await mkdir(join(workspaceRoot, '.sciforge', 'uploads', 'session-structured-protein'), { recursive: true });
  await writeFile(
    join(workspaceRoot, '.sciforge', 'uploads', 'session-structured-protein', 'protein.fasta'),
    '>protein\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQR\n',
  );
  const calls: CapturedFetch[] = [];
  const providerText = JSON.stringify({
    result: { outcome: 'completed', summary: 'valid worker result' },
  });
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
        summary: 'Protein evidence.',
        data: {
          modality: 'protein',
          model: 'esm2text-protein',
          summary: 'A translated protein observation.',
        },
        provenance: {},
      }),
      chatCompletion('text-structured-protein', providerText),
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
            { type: 'input_text', text: 'Analyze this protein.' },
            {
              type: 'input_object',
              ref: '.sciforge/uploads/session-structured-protein/protein.fasta',
              mimeType: 'text/plain',
              title: 'protein.fasta',
            },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'worker_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                result: {
                  type: 'object',
                  properties: {
                    outcome: { type: 'string', const: 'completed' },
                    summary: { type: 'string' },
                  },
                  required: ['outcome', 'summary'],
                  additionalProperties: false,
                },
              },
              required: ['result'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const outputText = String((await response.json() as Record<string, unknown>).output_text);
    assert.deepEqual(JSON.parse(outputText), JSON.parse(providerText));
    assert.doesNotMatch(outputText, /expert translation|esm2text/u);
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? '', /\/modality\/translate$/u);
    const textReasonerBody = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerBody, /A translated protein observation/u);
    assert.match(textReasonerBody, /worker_result/u);
    assert.doesNotMatch(textReasonerBody, /final_answer|need_more_modality_info/u);
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
      modalityInspectionRequest('document_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    const textBody = JSON.stringify(calls[1]?.body);
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
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-initial', 'Observation: the screenshot shows a browser window and map UI.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It shows a browser window and map UI.' })),
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assertMetadataOnly(calls[3]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/responses').length, 4);
    const secondTextReasonerBody = JSON.stringify(calls[4]?.body);
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
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-initial', 'Observation: the hotel voucher total is 421.15 yuan.'),
      chatCompletion('text-final-first', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assertMetadataOnly(calls[3]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 1);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/responses').length, 4);
    const secondTextReasonerBody = JSON.stringify(calls[4]?.body);
    assert.match(secondTextReasonerBody, /cache_status=hit/);
    assert.match(secondTextReasonerBody, /421\.15 yuan/);

  } finally {
    await server.close();
  }
});

test('vision cache policies bypass, refresh and configured defaults control actual requests', async () => {
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  const server = await startModelRouterServer({
    port: 0, config, env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'vision-cache-policy-')),
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-old', 'Old observation'), chatCompletion('text-1', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-bypass', 'Uncached observation'), chatCompletion('text-2', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('text-3', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-refresh', 'Fresh observation'), chatCompletion('text-4', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('text-5', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-disabled', 'Disabled observation'), chatCompletion('text-6', 'Answer'),
      modalityInspectionRequest('image_1'),
      chatCompletion('text-7', 'Answer'),
    ]),
  });
  const requestBody = { model: 'sciforge-router', input: [{ role: 'user', content: [
    { type: 'input_text', text: 'Inspect image' },
    { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
  ] }] };
  const send = async (policy?: string) => {
    const result = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json',
        ...(policy ? { 'x-sciforge-model-router-vision-cache-policy': policy } : {}),
      }), body: JSON.stringify(requestBody),
    });
    return result;
  };
  try {
    for (const policy of [undefined, 'bypass', 'use', 'refresh', 'use']) {
      assert.equal((await send(policy)).status, 200);
    }
    assert.match(JSON.stringify(calls[7]?.body), /Old observation/);
    assert.doesNotMatch(JSON.stringify(calls[7]?.body), /Uncached observation/);
    assert.match(JSON.stringify(calls[12]?.body), /Fresh observation/);
    config.profiles.default.visionCachePolicy = 'bypass';
    assert.equal((await send()).status, 200);
    assert.equal((await send('use')).status, 200);
    assert.match(JSON.stringify(calls[17]?.body), /Fresh observation/);
    assert.equal(calls.filter((call) => call.url.includes('vision.example')).length, 4);
    assert.equal((await send('invalid')).status, 400);
    assert.equal(calls.length, 18);
  } finally { await server.close(); }
});

test('bounds vision concurrency to four and retains image observation order', async () => {
  const calls: CapturedFetch[] = [];
  const delegate = captureFetch(calls, [
    chatCompletion('v1', 'First image evidence'), chatCompletion('v2', 'Second image evidence'),
    chatCompletion('v3', 'Third image evidence'),
    chatCompletion('v4', 'Fourth image evidence'), chatCompletion('v5', 'Fifth image evidence'),
    chatCompletion('text', JSON.stringify({ type: 'final_answer', content: 'Done' })),
  ]);
  let active = 0;
  let peak = 0;
  const server = await startModelRouterServer({
    port: 0, config: testConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'vision-parallel-')),
    fetchImpl: async (input, init) => {
      const response = delegate(input, init);
      if (String(input).includes('vision.example')) {
        active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
      }
      return response;
    },
  });
  try {
    const images = [0, 1, 2, 3, 4].map((index) => ({
      type: 'input_image', image_url: `data:image/png;base64,${Buffer.concat([Buffer.from(pngDataUrl.split(',')[1]!, 'base64'), Buffer.from([index])]).toString('base64')}`,
    }));
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json', 'x-sciforge-model-router-evidence-policy': 'required' }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Compare these figures.' }, ...images] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(peak, 4);
    const text = JSON.stringify(calls.at(-1)?.body);
    assert.ok(text.indexOf('First image evidence') < text.indexOf('Second image evidence'));
    assert.ok(text.indexOf('Second image evidence') < text.indexOf('Third image evidence'));
  } finally { await server.close(); }
});

test('reuses image evidence after tool progress and deduplicates repeated history images', async () => {
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0, config: testConfig(), env: testEnv(),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'vision-progress-cache-')),
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision', 'Figure crop bounds: x=10 y=20 width=300 height=200.'),
      modalityInspectionRequest('image_2'),
      chatCompletion('text-1', JSON.stringify({ type: 'final_answer', content: 'Read.' })),
      modalityInspectionRequest('image_1'),
      chatCompletion('text-2', JSON.stringify({ type: 'final_answer', content: 'Continue.' })),
    ]),
  });
  const image = { type: 'input_image', image_url: pngDataUrl };
  const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Read the paper and crop its figures.' }, image, image] }];
  try {
    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST', headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', instructions: 'Updated execution context.', input: [
        ...input,
        { role: 'assistant', content: [{ type: 'output_text', text: 'The figures are ready for cropping.' }] },
        { type: 'function_call', call_id: 'crop', name: 'crop_image', arguments: '{}' },
        { type: 'function_call_output', call_id: 'crop', output: 'Saved /tmp/figure.png; crop coordinates confirmed.' },
      ] }),
    });
    assert.equal(second.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 1);
    assert.match(JSON.stringify(calls.at(-1)?.body), /crop coordinates confirmed/);
    assert.match(JSON.stringify(calls.at(-1)?.body), /x=10 y=20/);
    assert.match(JSON.stringify(calls.at(-1)?.body), /cache_status=hit/);
  } finally { await server.close(); }
});

test('vision observation cache is scoped by normalized instruction intent for the same image', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-intent-cache-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-overview', 'Observation: the image is a hotel voucher.'),
      chatCompletion('text-overview', JSON.stringify({ type: 'final_answer', content: 'It is a hotel voucher.' })),
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-total', 'Observation: the exact total is 421.15 yuan.'),
      chatCompletion('text-total', JSON.stringify({ type: 'final_answer', content: 'The total is 421.15 yuan.' })),
      modalityInspectionRequest('image_1'),
      chatCompletion('text-total-cached', JSON.stringify({ type: 'final_answer', content: 'The cached total is 421.15 yuan.' })),
    ]),
  });

  const requestBody = (task: string) => ({
    model: 'sciforge-router',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: task },
        { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
      ],
    }],
  });

  try {
    const overview = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody('Describe the overall document type.')),
    });
    const total = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody('Read the exact monetary total.')),
    });
    const repeatedTotal = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(requestBody('Read the exact monetary total.')),
    });

    assert.equal(overview.status, 200);
    assert.equal(total.status, 200);
    assert.equal(repeatedTotal.status, 200);
    assert.equal(calls.filter((call) => call.url === 'https://vision.example/v1/responses').length, 2);
    assert.equal(calls.filter((call) => call.url === 'https://text.example/v1/responses').length, 6);
    assert.match(JSON.stringify(calls[1]?.body), /Describe the overall document type/);
    assert.match(JSON.stringify(calls[4]?.body), /Read the exact monetary total/);
    assert.match(JSON.stringify(calls[7]?.body), /cache_status=hit/);
    assert.match(JSON.stringify(calls[7]?.body), /exact total is 421\.15 yuan/);
    assert.doesNotMatch(JSON.stringify(calls[7]?.body), /image is a hotel voucher/);
  } finally {
    await server.close();
  }
});

test('textual ask refs route through vision inspection on demand', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-textual-ref-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It shows a cell culture plate.');
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /\.sciforge\/uploads\/img\.png/);
    assert.equal(calls[2]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[2]?.body), /What is shown\?/);

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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /artifact:opaque-asset/);
    assert.equal(calls[2]?.url, 'https://text.example/v1/responses');

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
      modalityInspectionRequest('audio_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'I could not inspect the referenced audio modality.');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    assert.match(JSON.stringify(calls[1]?.body), /status=unsupported/);
    assert.match(JSON.stringify(calls[1]?.body), /kind=audio/);

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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The prefixed image is visible.');
    assert.equal(calls[1]?.body.model, 'vision-model');
    assert.equal(calls[2]?.body.model, 'text-model');
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

test('routes accept a model name declared by a registered profile member and still reject undeclared names', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-declared-model-name-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('declared-name', 'configured wire'),
    ]),
  });

  try {
    // The #99 request chain sends the declared upstream model name ("catalog per
    // declaration"); a name a registered profile member declares is unambiguous
    // and must route by profile configuration instead of failing the turn.
    const accepted = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'text-model', input: 'hello' }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(new URL(calls[0]?.url ?? '').pathname, '/v1/responses');

    const rejected = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'not-a-declared-model', input: 'hello' }),
    });
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /unregistered_model/);
    assert.equal(calls.length, 1);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    assert.match(JSON.stringify(calls[1]?.body), /private\.example\.test\/figure\.png/);
  } finally {
    await server.close();
  }
});

test('text reasoner HTTP failures preserve safe provider diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-http-failure-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.translators.vision!.maxSupplementRounds = 3;
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      modalityInspectionRequest('image_1'),
      chatCompletion('vision-initial', 'Observation: the referenced image is a plot.'),
      modalityInspectionRequest('image_2'),
      chatCompletion('vision-initial-absolute-ref', 'Observation: the absolute private ref was unavailable.'),
      modalityInspectionRequest('image_3'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 503);
    const responseBody = await response.json() as Record<string, { code?: string; message?: string }>;
    assert.equal(responseBody.error?.code, 'upstream_http_503');
    assert.match(responseBody.error?.message ?? '', /Upstream returned HTTP 503/);
    assert.doesNotMatch(responseBody.error?.message ?? '', /text-secret|text-model/i);
    assert.equal(calls.length, 7);
    const visionPrompt = calls.filter((call) => call.url.includes('vision.example')).map((call) => JSON.stringify(call.body)).join('\n');
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
      modalityInspectionRequest('image_1'),
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

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(body.output_text), /sk-should-not-leak|data:image|base64/i);
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[2]?.url, 'https://text.example/v1/responses');
  } finally {
    await server.close();
  }
});

test('strict evidence policy rejects when the context budget drops every image before calling any provider', async () => {
  const config = testConfig();
  config.profiles.default.contextWindow = 2048;
  const calls: CapturedFetch[] = [];
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-strict-context-budget-'));
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('unsupported-evidence', JSON.stringify({ summary: 'Uninspected image claim.', claims: [], uncertainties: [] })),
    ]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({
        'content-type': 'application/json',
        'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({ model: 'sciforge-router', input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Read the exact chart labels.' },
        { type: 'input_image', image_url: pngDataUrl },
      ] }] }),
    });
    assert.equal(response.status, 413);
    const body = await response.json() as { error: { code: string; cause: { code: string } } };
    assert.equal(body.error.code, 'vision_evidence_unavailable');
    assert.equal(body.error.cause.code, 'vision_input_too_large');
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('strict evidence policy fails closed when vision translation fails without calling the text reasoner', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-strict-vision-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      Response.json({ error: { message: 'translator timeout with sk-should-not-leak' } }, { status: 504 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({
        'content-type': 'application/json',
        'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is in the image?' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    assert.equal(response.status, 504);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(body.error, {
      stage: 'vision_translation',
      failureClass: 'upstream_unavailable',
      retryable: true,
      recovery: {
        action: 'retry_visual_inspection',
        instruction: 'Retry the same native visual inspection once after the vision provider becomes available.',
      },
      cause: {
        code: 'upstream_http_504',
        status: 504,
      },
      code: 'vision_evidence_unavailable',
      message: 'Strict visual evidence is unavailable because vision translation failed.',
    });
    assert.doesNotMatch(JSON.stringify(body), /sk-should-not-leak|data:image|base64/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
  } finally {
    await server.close();
  }
});

test('strict evidence policy keeps the text reasoner primary after successful vision translation', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-strict-vision-success-'));
  const calls: CapturedFetch[] = [];
  const evidence = JSON.stringify({
    summary: 'The plot contains three blue bars.',
    claims: [{
      kind: 'observation',
      text: 'Three blue bars are visible in the plot.',
      artifactId: 'vision-1',
      confidence: 0.98,
    }],
    uncertainties: [],
  });
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the plot contains three blue bars.'),
      chatCompletion('text-final', evidence),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({
        'content-type': 'application/json',
        'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe the plot.' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, evidence);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
    const textReasonerRequest = JSON.stringify(calls[1]?.body);
    assert.match(textReasonerRequest, /Observation: the plot contains three blue bars/);
    assert.match(textReasonerRequest, /Return only the caller-requested strict visual evidence JSON object/);
    assert.doesNotMatch(textReasonerRequest, /\\"type\\":\\"final_answer\\"/);
    assert.doesNotMatch(textReasonerRequest, /data:image|base64|tiny-png/i);
  } finally {
    await server.close();
  }
});

test('strict evidence policy preserves targeted visual supplements before returning direct evidence', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-strict-vision-supplement-'));
  const config = testConfig();
  config.profiles.default.translators.vision!.maxSupplementRounds = 1;
  const calls: CapturedFetch[] = [];
  const evidence = JSON.stringify({
    summary: 'The x-axis label is Time (s).',
    claims: [{
      kind: 'observation',
      text: 'The x-axis is labeled Time (s).',
      artifactId: 'image_1',
      confidence: 0.99,
    }],
    uncertainties: [],
  });
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: a plot is visible, but the x-axis label is unclear.'),
      chatCompletion('text-supplement-request', JSON.stringify({
        type: 'need_more_modality_info',
        target: 'image_1',
        question: 'What is the exact x-axis label?',
        reason: 'The initial observation did not resolve the label.',
      })),
      chatCompletion('vision-supplement', 'The exact x-axis label is Time (s).'),
      chatCompletion('text-final', evidence),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({
        'content-type': 'application/json',
        'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Read the exact x-axis label.' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, evidence);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://vision.example/v1/responses',
      'https://text.example/v1/responses',
      'https://vision.example/v1/responses',
      'https://text.example/v1/responses',
    ]);
    assert.match(JSON.stringify(calls[1]?.body), /need_more_modality_info/);
    assert.match(JSON.stringify(calls[2]?.body), /What is the exact x-axis label/);
    assert.match(JSON.stringify(calls[3]?.body), /The exact x-axis label is Time \(s\)/);
  } finally {
    await server.close();
  }
});

test('strict evidence policy returns a typed synthesis failure when the primary text reasoner fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-strict-text-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the plot contains three blue bars.'),
      Response.json({ error: { message: 'text provider unavailable with sk-should-not-leak' } }, { status: 503 }),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({
        'content-type': 'application/json',
        'x-sciforge-model-router-evidence-policy': 'required',
      }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe the plot.' },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(body.error, {
      stage: 'text_reasoning',
      failureClass: 'upstream_unavailable',
      retryable: true,
      recovery: {
        action: 'retry_visual_inspection',
        instruction: 'Retry the same native visual inspection once after the text reasoner becomes available.',
      },
      cause: {
        code: 'upstream_http_503',
        status: 503,
      },
      code: 'visual_evidence_synthesis_unavailable',
      message: 'Strict visual evidence synthesis is unavailable because text reasoning failed.',
    });
    assert.doesNotMatch(JSON.stringify(body), /sk-should-not-leak|data:image|base64/i);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/responses');
    assert.equal(calls[1]?.url, 'https://text.example/v1/responses');
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
      modalityInspectionRequest('image_1'),
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
    assertMetadataOnly(calls[0]);
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

test('no reasoning level selected: the final upstream body carries no reasoning fields on any protocol wire', async () => {
  const protocols: Array<'responses' | 'chat-completions' | 'anthropic-messages'> = [
    'responses',
    'chat-completions',
    'anthropic-messages',
  ];
  for (const protocol of protocols) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `sciforge-model-router-unset-reasoning-${protocol}-`));
    const calls: CapturedFetch[] = [];
    const config = testConfig();
    config.profiles.default.textReasoner.model = 'deepseek-v4-flash-0731';
    config.profiles.default.textReasoner.compatibility = {
      preferredProtocol: protocol,
      allowedProtocols: [protocol],
      reasoningEfforts: ['high', 'max'],
    };
    const server = await startModelRouterServer({
      port: 0,
      config,
      env: testEnv(),
      workspaceRoot,
      fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'plain answer')]),
    });
    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
      });
      assert.equal(response.status, 200, `${protocol}: ${await response.text()}`);
      assert.equal(calls.length, 1, protocol);
      const body = calls[0]?.body ?? {};
      assert.equal(body.model, 'deepseek-v4-flash-0731');
      assert.equal(body.reasoning, undefined, `${protocol}: reasoning must stay unset`);
      assert.equal(body.reasoning_effort, undefined, `${protocol}: reasoning_effort must stay unset`);
      assert.equal(body.thinking, undefined, `${protocol}: thinking must stay unset`);
    } finally {
      await server.close();
    }
  }
});

test('a reasoning summary without an explicit effort never fabricates a level on the wire', async () => {
  for (const protocol of ['chat-completions', 'anthropic-messages'] as const) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `sciforge-model-router-summary-only-${protocol}-`));
    const calls: CapturedFetch[] = [];
    const config = testConfig();
    config.profiles.default.textReasoner.compatibility = {
      preferredProtocol: protocol,
      allowedProtocols: [protocol],
    };
    const server = await startModelRouterServer({
      port: 0,
      config,
      env: testEnv(),
      workspaceRoot,
      fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'plain answer')]),
    });
    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model: 'sciforge-router',
          input: 'hello',
          reasoning: { summary: 'detailed' },
        }),
      });
      assert.equal(response.status, 200, `${protocol}: ${await response.text()}`);
      assert.equal(calls.length, 1, protocol);
      const body = calls[0]?.body ?? {};
      assert.equal(body.thinking, undefined, `${protocol}: no fabricated thinking`);
      assert.equal(body.reasoning_effort, undefined, `${protocol}: no fabricated effort`);
    } finally {
      await server.close();
    }
  }
});

test('explicit reasoning levels translate exactly: Anthropic budgets and off-as-disabled, passthrough elsewhere', async () => {
  const anthropicCases: Array<[string, Record<string, unknown>]> = [
    ['high', { type: 'enabled', budget_tokens: 3072 }],
    ['off', { type: 'disabled' }],
  ];
  for (const [effort, expectedThinking] of anthropicCases) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), `sciforge-model-router-explicit-${effort}-`));
    const calls: CapturedFetch[] = [];
    const config = testConfig();
    config.profiles.default.textReasoner.compatibility = {
      preferredProtocol: 'anthropic-messages',
      allowedProtocols: ['anthropic-messages'],
    };
    const server = await startModelRouterServer({
      port: 0,
      config,
      env: testEnv(),
      workspaceRoot,
      fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'thinking answer')]),
    });
    try {
      const response = await fetch(`${server.url}/v1/responses`, {
        method: 'POST',
        headers: runtimeHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning_effort: effort }),
      });
      assert.equal(response.status, 200, `${effort}: ${await response.text()}`);
      assert.deepEqual(calls[0]?.body.thinking, expectedThinking, effort);
    } finally {
      await server.close();
    }
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-explicit-chat-'));
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
    fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'plain answer')]),
  });
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning: { effort: 'high' } }),
    });
    assert.equal(response.status, 200, await response.text());
    assert.equal(calls[0]?.body.reasoning_effort, 'high');
    assert.equal(calls[0]?.body.reasoning, undefined);
  } finally {
    await server.close();
  }
});

test('a declared reasoning vocabulary rejects unrepresentable explicit efforts before any upstream call', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-declared-reasoning-'));
  const calls: CapturedFetch[] = [];
  const config = testConfig();
  config.profiles.default.textReasoner.compatibility = { reasoningEfforts: ['high'] };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'plain answer')]),
  });

  try {
    const rejected = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning: { effort: 'low' } }),
    });
    assert.equal(rejected.status, 422);
    const rejectedBody = await rejected.json() as { error?: { code?: string; message?: string } };
    assert.equal(rejectedBody.error?.code, 'unsupported_reasoning_effort');
    assert.match(String(rejectedBody.error?.message), /Unsupported reasoning effort "low"/u);
    assert.equal(calls.length, 0, 'a rejected effort must not reach the upstream');

    const legacyRejected = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning_effort: 'low' }),
    });
    assert.equal(legacyRejected.status, 422);
    assert.equal(calls.length, 0);

    const accepted = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning: { effort: 'high' } }),
    });
    assert.equal(accepted.status, 200, await accepted.text());
    assert.equal(calls.length, 1);
    const declared = (calls[0]?.body.reasoning ?? {}) as Record<string, unknown>;
    assert.equal(declared.effort, 'high');
  } finally {
    await server.close();
  }
});

test('without a declaration an explicit effort stays a passthrough: unknown is not unsupported', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-unknown-reasoning-'));
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
    fetchImpl: captureFetch(calls, [chatCompletion('text-reasoner-answer', 'plain answer')]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', reasoning_effort: 'turbo-mode' }),
    });
    assert.equal(response.status, 200, await response.text());
    assert.equal(calls.length, 1);
    const body = calls[0]?.body ?? {};
    const effort = body.reasoning_effort ?? (body.reasoning as { effort?: unknown } | undefined)?.effort;
    assert.equal(effort, 'turbo-mode');
  } finally {
    await server.close();
  }
});

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
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = responses.shift();
    if (response) return adaptChatFixtureToRequestedWire(response, String(url), await capturedRequestBody(init?.body));
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

function modalityInspectionRequest(target: string, question = 'Inspect the referenced object.'): Response {
  return chatCompletion('text-inspection-request', JSON.stringify({
    type: 'need_more_modality_info', target, question,
  }));
}

function assertMetadataOnly(call: CapturedFetch | undefined): void {
  assert.ok(call?.url.startsWith('https://text.example/'));
  const body = JSON.stringify(call.body);
  assert.match(body, /payload_sent=false/);
  assert.doesNotMatch(body, /data:image|"type":"(?:input_image|image_url)"|tiny-png/i);
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


test('extracts Responses image parts from tool output arrays', () => {
  const images = extractToolResultImages([{ type: 'input_image', image_url: pngDataUrl }]);
  assert.equal(images.length, 1);
  assert.equal(images[0]?.mimeType, 'image/png');
  assert.equal(images[0]?.dataBase64, Buffer.from('tiny-png').toString('base64'));
});

test('downsamples oversized PNG tool-result images before forwarding', () => {
  const big = new PNG({ width: 2048, height: 2048 });
  const encoded = PNG.sync.write(big);
  const dataUrl = `data:image/png;base64,${encoded.toString('base64')}`;
  const images = extractToolResultImages([{ type: 'input_image', image_url: dataUrl }]);
  assert.equal(images.length, 1);
  assert.equal(images[0]?.mimeType, 'image/png');
  assert.ok((images[0]?.width ?? 0) <= 1024);
  assert.ok((images[0]?.height ?? 0) <= 1024);
});

test('downsamples oversized PNG images in user chat content', () => {
  const big = new PNG({ width: 2048, height: 2048 });
  const encoded = PNG.sync.write(big);
  const dataUrl = `data:image/png;base64,${encoded.toString('base64')}`;
  const downsampled = downsampleDataUrl(dataUrl);
  assert.notEqual(downsampled, dataUrl);
  assert.match(downsampled, /^data:image\/png;base64,/u);
  const small = PNG.sync.read(Buffer.from(downsampled.split(',')[1] ?? '', 'base64'));
  assert.ok(small.width <= 1024 && small.height <= 1024);
});

test('drops the largest vision images when the estimated context budget overflows and reports _notice', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-budget-prune-'));
  const config = testConfig();
  config.profiles.default.translators.vision!.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const bigBytes = Buffer.alloc(8 * 1024 * 1024, 0xab);
  const bigDataUrl = `data:image/png;base64,${bigBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const translatorImageParts: Array<Array<Record<string, unknown>>> = [];
  const responses = [
    modalityInspectionRequest('image_2'),
    chatCompletion('vision-budget-prune', 'Observation: the small diagram is visible.'),
    chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The small diagram is visible.' })),
  ];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      const body = await capturedRequestBody(init?.body);
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      });
      if (new URL(String(url)).pathname.endsWith('/responses')) {
        const input = body.input as Array<Record<string, any>>;
        const content = input[0]?.content as Array<Record<string, any>>;
        translatorImageParts.push(content.filter((part) => part.type === 'input_image'));
      }
      const fixture = responses.shift();
      assert.ok(fixture, `Unexpected fetch call to ${url}`);
      return adaptChatFixtureToRequestedWire(fixture, String(url), body);
    },
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
            { type: 'input_text', text: 'Explain figure 6' },
            { type: 'input_image', image_url: bigDataUrl },
            { type: 'input_image', image_url: pngDataUrl },
          ],
        }],
      }),
    });

    assertMetadataOnly(calls[0]);
    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, any>;
    assert.equal(payload._notice, undefined, 'no raw notice field leaks onto the response');
    const outputMessages = (payload.output as Array<Record<string, unknown>>)
      .filter((item) => item.type === 'message')
      .map((item) => item.content?.[0]?.text ?? '');
    assert.ok(outputMessages.every((text) => !String(text).includes('已清理')), 'image pruning stays out of the conversation transcript');
    assert.equal(translatorImageParts.length, 1, 'vision translator called once with the kept image');
    assert.equal(translatorImageParts[0]?.length, 1, 'only the small image reaches the vision translator');
    const translatorBody = JSON.stringify(translatorImageParts[0]);
    assert.doesNotMatch(translatorBody, /q6ur/, 'the oversized image base64 never reaches the vision translator');
    assert.match(translatorBody, /data:image\/png;base64/i);
  } finally {
    await server.close();
  }
});

test('does not emit a zero-drop clean-up notice for text-only requests', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-budget-text-only-'));
  const config = testConfig();
  config.profiles.default.translators.vision!.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const calls: CapturedFetch[] = [];
  const responses = [
    chatCompletion('text-only', JSON.stringify({ type: 'final_answer', content: 'Text-only answer.' })),
  ];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      const body = await capturedRequestBody(init?.body);
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      });
      const fixture = responses.shift();
      assert.ok(fixture, `Unexpected fetch call to ${url}`);
      return adaptChatFixtureToRequestedWire(fixture, String(url), body);
    },
  });

  try {
    const longText = 'long source excerpt '.repeat(4000);
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: longText },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, any>;
    const outputMessages = (payload.output as Array<Record<string, unknown>>)
      .map((item) => String(item.content?.[0]?.text ?? ''));
    assert.ok(outputMessages.every((text) => !text.includes('已清理')), 'no clean-up message for a text-only request');
  } finally {
    await server.close();
  }
});

test('drops an oversized image left in earlier history so a small follow-up still succeeds', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-vision-budget-prune-'));
  const config = testConfig();
  config.profiles.default.translators.vision!.compatibility = {
    preferredProtocol: 'responses',
    allowedProtocols: ['responses'],
  };
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    allowedProtocols: ['chat-completions'],
  };
  const bigBytes = Buffer.alloc(8 * 1024 * 1024, 0xab);
  const bigDataUrl = `data:image/png;base64,${bigBytes.toString('base64')}`;
  const calls: CapturedFetch[] = [];
  const translatorImageParts: Array<Array<Record<string, unknown>>> = [];
  const responses = [
    chatCompletion('vision-budget-prune', 'Observation: the small diagram is visible.'),
    chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The small diagram is visible.' })),
  ];
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: async (url, init) => {
      const body = await capturedRequestBody(init?.body);
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      });
      if (new URL(String(url)).pathname.endsWith('/responses')) {
        const input = body.input as Array<Record<string, any>>;
        const content = input[0]?.content as Array<Record<string, any>>;
        translatorImageParts.push(content.filter((part) => part.type === 'input_image'));
      }
      const fixture = responses.shift();
      assert.ok(fixture, `Unexpected fetch call to ${url}`);
      return adaptChatFixtureToRequestedWire(fixture, String(url), body);
    },
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: runtimeHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: 'sciforge-router',
        instructions: 'Continue authorized work even when a historical image is unavailable.',
        tools: [{ type: 'function', name: 'edit_document', parameters: { type: 'object' } }],
        input: [
          { role: 'user', content: [
            { type: 'input_text', text: 'Explain figure 6' },
            { type: 'input_image', image_url: bigDataUrl },
          ] },
          { role: 'assistant', content: [{ type: 'output_text', text: 'context exceeded' }] },
          { role: 'user', content: [{ type: 'input_text', text: 'hello, small follow-up' }] },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, any>;
    assert.equal(payload._notice, undefined, 'no raw notice field leaks onto the response');
    const outputMessages = (payload.output as Array<Record<string, unknown>>)
      .filter((item) => item.type === 'message')
      .map((item) => item.content?.[0]?.text ?? '');
    assert.ok(outputMessages.every((text) => !String(text).includes('已清理')), 'image pruning stays out of the conversation transcript');
    assert.equal(translatorImageParts.length, 0, 'no image reaches the vision translator');
    assert.doesNotMatch(JSON.stringify(calls.map((c) => c.body)), /q6ur/, 'oversized base64 never sent upstream in any call');
    assert.equal(calls.length, 1, 'only the text reasoner is called');
    const messages = calls[0]?.body.messages as Array<Record<string, unknown>>;
    assert.deepEqual(messages.map(item => item.role), ['system', 'user', 'assistant', 'user', 'user']);
    assert.match(JSON.stringify(messages[0]), /Continue authorized work/);
    assert.doesNotMatch(JSON.stringify(messages[0]), /final_answer/);
    assert.equal(messages[2]?.content, 'context exceeded');
    assert.equal(messages[3]?.content, 'hello, small follow-up');
  } finally {
    await server.close();
  }
});

test('the Codex model entry publishes the profile context window, falling back to the documented host budget', async () => {
  // A declared profile window wins.
  const declaredRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-context-declared-'));
  const declaredConfig = testConfig({ publicModelAlias: 'public-router-alias' });
  declaredConfig.profiles.default.contextWindow = 65_536;
  const declaredServer = await startModelRouterServer({
    port: 0,
    config: declaredConfig,
    env: testEnv(),
    workspaceRoot: declaredRoot,
    fetchImpl: captureFetch([], []),
  });
  try {
    const response = await fetch(`${declaredServer.url}/v1/models`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    const row = body.data[0]!;
    assert.equal(row.context_window, 65_536);
    assert.equal(row.max_context_window, 65_536);
    assert.equal(row.auto_compact_token_limit, Math.floor(65_536 * 0.78125));
    assert.deepEqual(row.truncation_policy, { mode: 'tokens', limit: 65_536 });
  } finally {
    await declaredServer.close();
  }

  // No declaration → the documented host budget (NOT a model-capability claim).
  const fallbackRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-context-budget-'));
  const fallbackServer = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot: fallbackRoot,
    fetchImpl: captureFetch([], []),
  });
  try {
    const response = await fetch(`${fallbackServer.url}/v1/models`, { headers: runtimeHeaders() });
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    const row = body.data[0]!;
    assert.equal(row.context_window, 128_000);
    assert.equal(row.auto_compact_token_limit, 100_000);
  } finally {
    await fallbackServer.close();
  }
});

test('capabilities v2 adds identity, context sources and the reasoning declaration; v1 stays byte-compatible', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-capabilities-v2-'));
  const config = testConfig({ publicModelAlias: 'public-router-alias' });
  config.profiles.default.contextWindow = 65_536;
  config.profiles.default.textReasoner.compatibility = {
    preferredProtocol: 'chat-completions',
    reasoningEfforts: ['high', 'low'],
  };
  const server = await startModelRouterServer({
    port: 0,
    config,
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });
  try {
    // Default (no version) → exact v1 shape for existing consumers.
    const v1 = await (await fetch(`${server.url}/v1/capabilities`, { headers: runtimeHeaders() })).json() as Record<string, unknown>;
    assert.equal(v1.schemaVersion, 'sciforge.model-router.capabilities.v1');
    assert.equal('identity' in v1, false);
    assert.equal('context' in v1, false);
    assert.equal('reasoning' in v1, false);

    // Opt-in v2.
    const v2Response = await fetch(`${server.url}/v1/capabilities?version=2`, { headers: runtimeHeaders() });
    assert.equal(v2Response.status, 200);
    const v2 = await v2Response.json() as Record<string, unknown> & {
      identity: Record<string, unknown>;
      context: Record<string, unknown>;
      reasoning: Record<string, unknown>;
    };
    assert.equal(v2.schemaVersion, 'sciforge.model-router.capabilities.v2');
    assert.deepEqual(v2.identity, {
      publicModelAlias: 'public-router-alias',
      upstreamModel: 'text-model',
      protocol: 'chat-completions',
    });
    assert.deepEqual(v2.context, {
      modelDeclared: 65_536,
      hostBudget: 128_000,
      source: 'profile-declaration',
    });
    assert.equal(v2.reasoning.state, 'known');
    assert.deepEqual(v2.reasoning.levels, [{ id: 'high' }, { id: 'low' }]);
    assert.equal(v2.reasoning.source, 'model-access-declaration');
    // v1 fields survive unchanged on the v2 payload.
    assert.ok(v2.roles && v2.vision && v2.images);
    assert.equal(typeof v2.publicModelAlias, 'string');
  } finally {
    await server.close();
  }
});

test('capabilities v2 reports unknown reasoning and the host context budget when nothing is declared', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-capabilities-v2-empty-'));
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ publicModelAlias: 'public-router-alias' }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch([], []),
  });
  try {
    const response = await fetch(`${server.url}/v1/capabilities?version=2`, { headers: runtimeHeaders() });
    assert.equal(response.status, 200);
    const v2 = await response.json() as {
      identity: Record<string, unknown>;
      context: Record<string, unknown>;
      reasoning: Record<string, unknown>;
    };
    assert.equal(v2.identity.upstreamModel, 'text-model');
    assert.equal(v2.identity.protocol, 'auto');
    assert.deepEqual(v2.context, { modelDeclared: null, hostBudget: 128_000, source: 'host-budget' });
    assert.equal(v2.reasoning.state, 'unknown');
    assert.deepEqual(v2.reasoning.levels, []);
    assert.equal(v2.reasoning.source, 'none');
  } finally {
    await server.close();
  }
});

