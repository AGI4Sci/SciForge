import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { AppiumMac2WindowActionRequest } from './appium-mac2-window-action-adapter.js';
import {
  createAppiumMac2WebDriverClient,
  type AppiumMac2SavedArtifactValidator,
} from './appium-mac2-webdriver-client.js';

test('Appium Mac2 WebDriver client opens a TextEdit session and sends bounded type actions', async () => {
  const server = await startWebDriverFixture();
  try {
    const client = createAppiumMac2WebDriverClient({ timeoutMs: 2_000 });

    const result = await client(request({
      serverUrl: server.url,
      action: 'type',
      text: 'Draft report',
    }));

    assert.equal(result.blockedReason, undefined);
    assert.equal(result.executorEventRef, 'appium-mac2:textedit/actions/action-1/webdriver-session');
    assert.equal(result.inputEventRef, 'appium-mac2:textedit/actions/action-1/type-input');
    assert.equal(result.verifierRef, 'appium-mac2:textedit/actions/action-1/verification/source-read');
    assert.equal(result.afterEvidenceRef, 'appium-mac2:textedit/actions/action-1/after-source');
    assert.equal(result.freshnessInvalidationRef, 'window-action-session:textedit-main/actions/action-1/freshness-invalidation.json');
    assert.equal(result.artifactValidatorRef, undefined);

    assert.equal(server.requests[0]?.method, 'POST');
    assert.equal(server.requests[0]?.path, '/session');
    assert.deepEqual(server.requests[0]?.body, {
      capabilities: {
        alwaysMatch: {
          platformName: 'mac',
          'appium:automationName': 'mac2',
          'appium:bundleId': 'com.apple.TextEdit',
          'appium:noReset': true,
        },
        firstMatch: [{}],
      },
    });
    assert.equal(server.requests[1]?.method, 'POST');
    assert.equal(server.requests[1]?.path, '/session/session-1/actions');
    assert.deepEqual(server.requests[1]?.body, {
      actions: [{
        type: 'key',
        id: 'sciforge-textedit-keyboard',
        actions: [
          { type: 'keyDown', value: 'D' },
          { type: 'keyUp', value: 'D' },
          { type: 'keyDown', value: 'r' },
          { type: 'keyUp', value: 'r' },
          { type: 'keyDown', value: 'a' },
          { type: 'keyUp', value: 'a' },
          { type: 'keyDown', value: 'f' },
          { type: 'keyUp', value: 'f' },
          { type: 'keyDown', value: 't' },
          { type: 'keyUp', value: 't' },
          { type: 'keyDown', value: ' ' },
          { type: 'keyUp', value: ' ' },
          { type: 'keyDown', value: 'r' },
          { type: 'keyUp', value: 'r' },
          { type: 'keyDown', value: 'e' },
          { type: 'keyUp', value: 'e' },
          { type: 'keyDown', value: 'p' },
          { type: 'keyUp', value: 'p' },
          { type: 'keyDown', value: 'o' },
          { type: 'keyUp', value: 'o' },
          { type: 'keyDown', value: 'r' },
          { type: 'keyUp', value: 'r' },
          { type: 'keyDown', value: 't' },
          { type: 'keyUp', value: 't' },
        ],
      }],
    });
    assert.equal(server.requests[2]?.method, 'GET');
    assert.equal(server.requests[2]?.path, '/session/session-1/source');
    assert.equal(server.requests.at(-1)?.method, 'DELETE');
    assert.equal(server.requests.at(-1)?.path, '/session/session-1');
    assert.doesNotMatch(JSON.stringify(result), /http:\/\/|Draft report|token|secret|password|bearer/i);
  } finally {
    await server.close();
  }
});

test('Appium Mac2 WebDriver client sends save shortcut only with an artifact validator', async () => {
  const server = await startWebDriverFixture();
  const validatorCalls: Array<{ sourceXml: string; request: AppiumMac2WindowActionRequest }> = [];
  const validateSavedArtifact: AppiumMac2SavedArtifactValidator = async (input) => {
    validatorCalls.push(input);
    return 'appium-mac2:textedit/actions/action-1/artifact-validator';
  };
  try {
    const client = createAppiumMac2WebDriverClient({ validateSavedArtifact, timeoutMs: 2_000 });

    const result = await client(request({ serverUrl: server.url, action: 'save' }));

    assert.equal(result.blockedReason, undefined);
    assert.equal(result.inputEventRef, 'appium-mac2:textedit/actions/action-1/save-input');
    assert.equal(result.artifactValidatorRef, 'appium-mac2:textedit/actions/action-1/artifact-validator');
    assert.equal(validatorCalls.length, 1);
    assert.equal(validatorCalls[0]?.sourceXml, '<AXApplication><AXTextArea value="Draft report"/></AXApplication>');
    assert.equal(validatorCalls[0]?.request.action, 'save');
    assert.equal(server.requests[1]?.path, '/session/session-1/actions');
    assert.deepEqual(server.requests[1]?.body, {
      actions: [{
        type: 'key',
        id: 'sciforge-textedit-keyboard',
        actions: [
          { type: 'keyDown', value: '\uE03D' },
          { type: 'keyDown', value: 's' },
          { type: 'keyUp', value: 's' },
          { type: 'keyUp', value: '\uE03D' },
        ],
      }],
    });
  } finally {
    await server.close();
  }
});

test('Appium Mac2 WebDriver client fails closed before fetch for unsafe scope and unverified save', async () => {
  let fetchCalls = 0;
  const client = createAppiumMac2WebDriverClient({
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('fetch should not be called');
    },
  });

  const external = await client(request({ serverUrl: 'https://example.invalid:4723', action: 'type', text: 'Nope' }));
  assert.equal(external.blockedReason, 'Appium Mac2 WebDriver client blocked: server URL must be an http loopback URL without credentials.');

  const nonTextEdit = await client({ ...request({ action: 'type', text: 'Nope' }), bundleId: 'com.apple.Preview' as 'com.apple.TextEdit' });
  assert.equal(nonTextEdit.blockedReason, 'Appium Mac2 WebDriver client blocked: only com.apple.TextEdit is supported.');

  const unverifiedSave = await client(request({ action: 'save' }));
  assert.equal(unverifiedSave.blockedReason, 'Appium Mac2 WebDriver client blocked: save requires a saved artifact validator.');

  assert.equal(fetchCalls, 0);
});

test('Appium Mac2 WebDriver client blocks on WebDriver errors and cleans up created sessions', async () => {
  const server = await startWebDriverFixture({ failActions: true });
  try {
    const client = createAppiumMac2WebDriverClient({ timeoutMs: 2_000 });

    const result = await client(request({ serverUrl: server.url, action: 'type', text: 'Draft report' }));

    assert.match(result.blockedReason ?? '', /WebDriver actions failed/i);
    assert.equal(server.requests.at(-1)?.method, 'DELETE');
    assert.equal(server.requests.at(-1)?.path, '/session/session-1');
    assert.doesNotMatch(JSON.stringify(result), /http:\/\/|Draft report|token|secret|password|bearer/i);
  } finally {
    await server.close();
  }
});

function request(input: {
  serverUrl?: string;
  action: 'type' | 'save';
  text?: string;
}): AppiumMac2WindowActionRequest {
  return {
    serverUrl: input.serverUrl ?? 'http://127.0.0.1:4723',
    bundleId: 'com.apple.TextEdit',
    actionId: 'action-1',
    action: input.action,
    ...(input.text ? { text: input.text } : {}),
    sessionId: 'textedit-main',
    targetWindowRef: 'window:textedit:main',
  };
}

async function startWebDriverFixture(options: { failActions?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', path, body });
    if (req.method === 'POST' && path === '/session') {
      return writeJson(res, 200, { value: { sessionId: 'session-1', capabilities: {} } });
    }
    if (req.method === 'POST' && path === '/session/session-1/actions') {
      return writeJson(res, options.failActions ? 500 : 200, options.failActions
        ? { value: { error: 'unknown error', message: 'actions failed with private details' } }
        : { value: null });
    }
    if (req.method === 'GET' && path === '/session/session-1/source') {
      return writeJson(res, 200, { value: '<AXApplication><AXTextArea value="Draft report"/></AXApplication>' });
    }
    if (req.method === 'DELETE' && path === '/session/session-1') {
      return writeJson(res, 200, { value: null });
    }
    return writeJson(res, 404, { value: { error: 'unknown command' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address');
  const tcpAddress: AddressInfo = address;
  const port = tcpAddress.port;
  return {
    url: `http://127.0.0.1:${port}`,
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
