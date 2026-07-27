import assert from 'node:assert/strict';
import test from 'node:test';

import { proxyUrlFromRules } from './proxy';

test('normalizes Chromium system proxy results without assuming a host or port', () => {
  assert.equal(proxyUrlFromRules('PROXY 127.0.0.1:7890; DIRECT'), 'http://127.0.0.1:7890/');
  assert.equal(proxyUrlFromRules('HTTPS proxy.company.test:8443'), 'https://proxy.company.test:8443/');
  assert.equal(proxyUrlFromRules('SOCKS5 localhost:1086'), 'socks5h://localhost:1086');
  assert.equal(proxyUrlFromRules('DIRECT'), '');
});

test('accepts standard proxy environment URLs and ignores unsupported rules', () => {
  assert.equal(proxyUrlFromRules('http://proxy.example:3128'), 'http://proxy.example:3128/');
  assert.equal(proxyUrlFromRules('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  assert.equal(proxyUrlFromRules('UNKNOWN proxy.example:9000'), '');
});
