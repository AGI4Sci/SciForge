import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { startModelRouterServer, type ModelRouterConfig } from './router';

const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-png').toString('base64')}`;
const forbiddenPublicSurfacePattern =
  /text-secret|vision-secret|Authorization|Bearer|baseUrl|apiKeyEnv|SCIFORGE_TEXT_API_KEY|SCIFORGE_VISION_API_KEY|text-model|vision-model|text-provider|vision-provider|https:\/\/text\.example|https:\/\/vision\.example/i;

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
    assert.match(serialized, /refs_first_trace/);
    assert.match(serialized, /refs-first/);
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
    const response = await fetch(`${server.url}/v1/models`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      object: 'list',
      data: [{
        id: 'public-router-alias',
        object: 'model',
        owned_by: 'sciforge',
      }],
    });
    assert.doesNotMatch(JSON.stringify(body), forbiddenPublicSurfacePattern);
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
      chatCompletion('text-reasoner-answer', 'The text answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge in one sentence.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The text answer.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.equal(calls[0]?.headers.authorization, 'Bearer text-secret');
    assert.equal(calls[0]?.body.model, 'text-model');
    assert.deepEqual(calls[0]?.body.messages, [
      { role: 'user', content: 'Explain SciForge in one sentence.' },
    ]);

    const traceText = await readSingleTraceFile(workspaceRoot, 'trace.json');
    assert.match(traceText, /"profileId":\s*"default"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|Authorization|data:image|base64/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
    assert.match(traceText, /"providerBindingSha256":\s*"sha256:[a-f0-9]{64}"/);
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
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The chart label is ATP concentration.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'What does the axis label say?' },
            { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
            { type: 'input_image', ref: 'artifact:microscopy-panel', mime_type: 'image/jpeg' },
          ],
        }],
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The chart label is ATP concentration.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.equal(calls[0]?.headers.authorization, 'Bearer vision-secret');
    assert.equal(calls[0]?.body.model, 'vision-model');
    assert.match(JSON.stringify(calls[0]?.body), /data:image\/png;base64/);
    assert.match(JSON.stringify(calls[0]?.body), /artifact:microscopy-panel/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[1]?.body), /data:image|base64|tiny-png/i);
    assert.match(JSON.stringify(calls[1]?.body), /Observation: the chart label is ATP concentration/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"inline"/);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"sha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|data:image|base64|tiny-png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
    assert.match(traceText, /"roleAlias":\s*"translators\.vision"/);
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
      headers: { 'content-type': 'application/json' },
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

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"ref":\s*"images\/panel\.png"/);
    assert.doesNotMatch(traceText, /data:image|base64|local-ref-pixels/i);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|text-provider|vision-provider|text-model|vision-model/i);
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --ref .sciforge/uploads/img.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'It shows a cell culture plate.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://vision.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[0]?.body), /\.sciforge\/uploads\/img\.png/);
    assert.equal(calls[1]?.url, 'https://text.example/v1/chat/completions');
    assert.match(JSON.stringify(calls[1]?.body), /What is shown\?/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"ref"/);
    assert.match(traceText, /"ref":\s*"\.sciforge\/uploads\/img\.png"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|text-provider|vision-provider|text-model|vision-model/i);
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'ask --config .sciforge/uploads/not-a-ref.png --ref /Users/alice/private.png --ref https://private.example.test/secret.png "What is shown?"',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://text.example/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(calls[0]?.body), /\/Users|private\.example|secret\.png|private\.png/i);
    assert.match(JSON.stringify(calls[0]?.body), /What is shown\?/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.doesNotMatch(traceText, /"source":\s*"ref"/);
    assert.doesNotMatch(traceText, /\/Users|private\.example|secret\.png|private\.png/i);
  } finally {
    await server.close();
  }
});

test('absolute trace roots do not leak local paths in public metadata trace refs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-absolute-trace-workspace-'));
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-absolute-trace-root-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ traceRoot }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('text-reasoner-answer', 'The text answer.'),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain trace refs.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      metadata?: { traceRef?: string };
    };
    assert.ok(body.metadata?.traceRef);
    assert.doesNotMatch(body.metadata.traceRef, /\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\//i);
    assert.doesNotMatch(body.metadata.traceRef, /^[A-Za-z]:\\/);
    assert.match(body.metadata.traceRef, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await server.close();
  }
});

test('profile and provider configuration failures fail closed before upstream calls', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-fail-closed-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: { SCIFORGE_TEXT_API_KEY: 'text-secret' },
    workspaceRoot,
    fetchImpl: captureFetch(calls, []),
  });

  try {
    const unknownProfile = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sciforge-model-router-profile': 'unknown' },
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello' }),
    });
    assert.equal(unknownProfile.status, 400);
    assert.match(await unknownProfile.text(), /unknown_profile/);

    const missingSecret = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sciforge-router', input: 'hello', metadata: { profile: 'default' } }),
    });
    assert.equal(missingSecret.status, 400);
    assert.match(await missingSecret.text(), /missing_secret/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('default public model alias rejects unregistered request models', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-default-alias-'));
  const calls: CapturedFetch[] = [];
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', input: 'hello', metadata: { profile: 'default' } }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /unregistered_model/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
});

test('strict supplement requests are bounded by the profile round budget', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-supplement-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ maxSupplementRounds: 1 }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: plotted points are visible but the legend is too small.'),
      chatCompletion('text-need-more', JSON.stringify({
        type: 'need_more_visual_info',
        target: 'image_1',
        question: 'Read the legend text only.',
        reason: 'The first observation did not include the legend.',
      })),
      chatCompletion('vision-supplement', 'Supplement: the legend says treated cells.'),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'The legend says treated cells.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Read the legend.' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.output_text, 'The legend says treated cells.');
    assert.equal(calls.length, 4);
    assert.match(JSON.stringify(calls[2]?.body), /Read the legend text only/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"round":\s*1/);
    assert.doesNotMatch(traceText, /data:image|base64|tiny-png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('failed supplement observations are marked failed in trace bundles', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-supplement-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ maxSupplementRounds: 1 }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: plotted points are visible but the legend is too small.'),
      chatCompletion('text-need-more', JSON.stringify({
        type: 'need_more_visual_info',
        target: 'image_1',
        question: 'Read the legend text only.',
      })),
      Response.json({ error: { message: 'vision unavailable' } }, { status: 503 }),
      chatCompletion('text-final', JSON.stringify({ type: 'final_answer', content: 'I could not inspect the legend.' })),
    ]),
  });

  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Read the legend.' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 4);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"supplement"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.doesNotMatch(traceText, /"phase":\s*"supplement"[\s\S]{0,120}"status":\s*"ok"/);
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
      headers: { 'content-type': 'application/json' },
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

test('image URL inputs are usable upstream but only hashed in traces', async () => {
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe it.' }, { type: 'input_image', image_url: privateImageUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(JSON.stringify(calls[0]?.body), /private\.example\.test\/figure\.png/);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"source":\s*"url"/);
    assert.match(traceText, /"urlSha256":\s*"sha256:[a-f0-9]{64}"/);
    assert.doesNotMatch(traceText, /private\.example|secret-token|figure\.png/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

test('text reasoner HTTP failures still write sanitized refs-first trace summaries', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-text-http-failure-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig(),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', 'Observation: the referenced image is a plot.'),
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
      headers: { 'content-type': 'application/json' },
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

    assert.equal(response.status, 500);
    assert.equal(calls.length, 2);
    const visionPrompt = JSON.stringify(calls[0]?.body);
    assert.match(visionPrompt, /artifact:workspace\/plots\/figure-1\.png/);
    assert.match(visionPrompt, /sha256:[a-f0-9]{64}/);
    assert.doesNotMatch(visionPrompt, /\/Users|private\.example|absolute-secret|private-panel/i);

    const inputTrace = JSON.parse(await readSingleTraceFile(workspaceRoot, 'input-modalities.json')) as {
      modalities: Array<Record<string, unknown>>;
    };
    assert.equal(inputTrace.modalities[0]?.ref, 'artifact:workspace/plots/figure-1.png');
    assert.match(String(inputTrace.modalities[1]?.ref), /^sha256:[a-f0-9]{64}$/);
    assert.match(String(inputTrace.modalities[2]?.ref), /^sha256:[a-f0-9]{64}$/);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-control-or-final"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_http_503"/);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.final-routing-summary\.v1"/);
    assert.doesNotMatch(traceText, /text-secret|vision-secret|raw prompt payload|text-provider|vision-provider|text-model|vision-model/i);
    assert.doesNotMatch(traceText, /\/Users|private\.example|absolute-secret|private-panel/i);
  } finally {
    await server.close();
  }
});

test('text reasoner exceptions still write sanitized failure traces', async () => {
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: 'Explain SciForge.',
        metadata: { profile: 'default' },
      }),
    });

    assert.equal(response.status, 500);
    assert.equal(calls.length, 1);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"phase":\s*"text-direct"/);
    assert.match(traceText, /"status":\s*"failed"/);
    assert.match(traceText, /"errorSummary":\s*"provider_exception"/);
    assert.match(traceText, /"schemaVersion":\s*"sciforge\.model-router\.final-routing-summary\.v1"/);
    assert.doesNotMatch(traceText, /text-secret|raw-payload-private|Explain SciForge|text-provider|text-model/i);
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sciforge-router',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is in the image?' }, { type: 'input_image', image_url: pngDataUrl }] }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /could not inspect the image/i);
    assert.doesNotMatch(String(body.output_text), /sk-should-not-leak|data:image|base64/i);
    const traceText = await readTraceBundle(workspaceRoot);
    assert.match(traceText, /"degraded":\s*true/);
    assert.doesNotMatch(traceText, /sk-should-not-leak|data:image|base64/i);
    assert.doesNotMatch(traceText, /text-provider|vision-provider|text-model|vision-model/i);
  } finally {
    await server.close();
  }
});

type CapturedFetch = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function testConfig(options: { maxSupplementRounds?: number; traceRoot?: string; publicModelAlias?: string | null } = {}): ModelRouterConfig {
  const config: ModelRouterConfig = {
    defaultProfile: 'default',
    publicModelAlias: options.publicModelAlias === undefined ? 'sciforge-router' : undefined,
    profiles: {
      default: {
        traceRoot: options.traceRoot ?? '.sciforge/model-router-traces',
        textReasoner: {
          provider: 'text-provider',
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'SCIFORGE_TEXT_API_KEY',
          model: 'text-model',
        },
        translators: {
          vision: {
            provider: 'vision-provider',
            baseUrl: 'https://vision.example/v1',
            apiKeyEnv: 'SCIFORGE_VISION_API_KEY',
            model: 'vision-model',
            maxSupplementRounds: options.maxSupplementRounds,
          },
        },
      },
    },
  };
  if (typeof options.publicModelAlias === 'string') config.publicModelAlias = options.publicModelAlias;
  return config;
}

function testEnv() {
  return {
    SCIFORGE_TEXT_API_KEY: 'text-secret',
    SCIFORGE_VISION_API_KEY: 'vision-secret',
  };
}

function captureFetch(calls: CapturedFetch[], responses: Response[]): typeof fetch {
  return async (url, init) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const response = responses.shift();
    assert.ok(response, `Unexpected fetch call to ${url}`);
    return response;
  };
}

function parseSseEvents(body: string): Array<Record<string, any>> {
  return body
    .split(/\n\n+/)
    .map((chunk) => chunk.split(/\n/).find((line) => line.startsWith('data: '))?.slice('data: '.length))
    .filter((payload): payload is string => Boolean(payload) && payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Record<string, any>);
}

function chatCompletion(id: string, content: string) {
  return Response.json({
    id,
    object: 'chat.completion',
    created: 1_717_171_717,
    model: id.includes('vision') ? 'vision-model' : 'text-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

async function readTraceBundle(workspaceRoot: string) {
  const root = join(workspaceRoot, '.sciforge/model-router-traces');
  const days = await readdir(root);
  const runs = await readdir(join(root, days[0] ?? 'missing'));
  const files = await readdir(join(root, days[0] ?? 'missing', runs[0] ?? 'missing'));
  const contents = await Promise.all(files.map((file) => readFile(join(root, days[0] ?? 'missing', runs[0] ?? 'missing', file), 'utf8')));
  return contents.join('\n');
}

async function readSingleTraceFile(workspaceRoot: string, fileName: string) {
  const root = join(workspaceRoot, '.sciforge/model-router-traces');
  const days = await readdir(root);
  const runs = await readdir(join(root, days[0] ?? 'missing'));
  return await readFile(join(root, days[0] ?? 'missing', runs[0] ?? 'missing', fileName), 'utf8');
}
