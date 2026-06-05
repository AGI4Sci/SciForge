import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { auditModelRouterTraceBundle } from './trace-audit';
import { startModelRouterServer, type ModelRouterConfig } from './router';

const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-png').toString('base64')}`;
const echoedSecretBlob = `data:image/png;base64,${Buffer.from('provider echoed private pixels').toString('base64')}`;
const echoedTraceLeak = [
  'Authorization: Bearer sk-echo-secret',
  'api_key=echo-assignment-secret',
  'https://private.example.test/a.png?token=x',
  '/Users/alice/private.png',
  echoedSecretBlob,
  'text-secret',
  'vision-secret',
  'vision-provider',
  'vision-model',
  'text-provider',
  'text-model',
].join(' ');

test('provider-originated text is redacted from trace summaries and public answers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-redaction-'));
  const calls: CapturedFetch[] = [];
  const server = await startModelRouterServer({
    port: 0,
    config: testConfig({ maxSupplementRounds: 1 }),
    env: testEnv(),
    workspaceRoot,
    fetchImpl: captureFetch(calls, [
      chatCompletion('vision-initial', `Initial observation echoed ${echoedTraceLeak}`),
      chatCompletion('text-need-more', JSON.stringify({
        type: 'need_more_visual_info',
        target: 'image_1',
        question: `Inspect the supplement target; provider echoed ${echoedTraceLeak}`,
        reason: `The text reasoner echoed ${echoedTraceLeak}`,
      })),
      chatCompletion('vision-supplement', `Supplement observation echoed ${echoedTraceLeak}`),
      chatCompletion('text-final', JSON.stringify({
        type: 'final_answer',
        content: `Returned answer intentionally remains raw: ${echoedTraceLeak}`,
      })),
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
            { type: 'input_text', text: 'Describe this image, then inspect a detail if needed.' },
            { type: 'input_image', image_url: pngDataUrl, mime_type: 'image/png' },
          ],
        }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.output_text), /Returned answer intentionally remains raw:/);
    assert.doesNotMatch(String(body.output_text), /Authorization:\s*Bearer|sk-echo-secret|echo-assignment-secret|text-secret|vision-secret/i);
    assert.doesNotMatch(String(body.output_text), /private\.example\.test|token=x|\/a\.png/i);
    assert.doesNotMatch(String(body.output_text), /\/Users\/alice\/private\.png/i);
    assert.doesNotMatch(String(body.output_text), /data:image\/png;base64|provider echoed private pixels/i);
    assert.doesNotMatch(String(body.output_text), /vision-provider|vision-model|text-provider|text-model/i);
    assert.equal(calls.length, 4);

    const traceText = await readTraceBundle(workspaceRoot);
    assert.doesNotMatch(traceText, /Authorization:\s*Bearer/i);
    assert.doesNotMatch(traceText, /sk-echo-secret|echo-assignment-secret|text-secret|vision-secret/i);
    assert.doesNotMatch(traceText, /private\.example\.test|token=x|\/a\.png/i);
    assert.doesNotMatch(traceText, /\/Users\/alice\/private\.png/i);
    assert.doesNotMatch(traceText, /data:image\/png;base64|provider echoed private pixels/i);
    assert.doesNotMatch(traceText, /vision-provider|vision-model|text-provider|text-model/i);

    const report = await auditModelRouterTraceBundle({
      traceRoot: join(workspaceRoot, '.sciforge/model-router-traces'),
      knownSecrets: ['text-secret', 'vision-secret', 'sk-echo-secret', 'echo-assignment-secret'],
    });
    assert.equal(report.status, 'pass', JSON.stringify(report.findings, null, 2));
  } finally {
    await server.close();
  }
});

type CapturedFetch = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function testConfig(options: { maxSupplementRounds?: number } = {}): ModelRouterConfig {
  return {
    defaultProfile: 'default',
    publicModelAlias: 'sciforge-router',
    profiles: {
      default: {
        traceRoot: '.sciforge/model-router-traces',
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
