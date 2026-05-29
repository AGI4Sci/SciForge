import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceCors, workspaceRequestUrl } from './workspace-server-http.js';

test('workspaceRequestUrl preserves host, path, and query string', () => {
  const url = workspaceRequestUrl({
    headers: { host: 'localhost:4876' },
    url: '/api/sciforge/config?workspacePath=%2Ftmp%2Fwork',
  });

  assert.equal(url.origin, 'http://localhost:4876');
  assert.equal(url.pathname, '/api/sciforge/config');
  assert.equal(url.searchParams.get('workspacePath'), '/tmp/work');
});

test('workspaceRequestUrl falls back to loopback host for missing Host header', () => {
  const url = workspaceRequestUrl({ headers: {}, url: undefined });

  assert.equal(url.origin, 'http://127.0.0.1');
  assert.equal(url.pathname, '/');
});

test('handleWorkspaceCors records headers without ending non-OPTIONS requests', () => {
  const response = createCorsResponse();

  assert.equal(handleWorkspaceCors({ method: 'POST' }, response), false);
  assert.equal(response.status, undefined);
  assert.equal(response.ended, false);
  assert.deepEqual(response.headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
});

test('handleWorkspaceCors answers OPTIONS preflight with 204', () => {
  const response = createCorsResponse();

  assert.equal(handleWorkspaceCors({ method: 'OPTIONS' }, response), true);
  assert.equal(response.status, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(response.headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
});

function createCorsResponse() {
  return {
    ended: false,
    headers: {} as Record<string, string | number | readonly string[]>,
    status: undefined as number | undefined,
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    writeHead(status: number) {
      this.status = status;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}
