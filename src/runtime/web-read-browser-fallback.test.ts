import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runWebReadBrowserFallback,
  type WebReadBrowserRenderAdapter,
} from './web-read-browser-fallback.js';

test('web_read browser fallback renders a JS-heavy page when static extraction has no body text', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-js-fallback-'));
  const textPath = join(workspacePath, '.sciforge', 'web-read', 'rendered-source.txt');
  const metadataPath = join(workspacePath, '.sciforge', 'web-read', 'rendered-source.json');
  const adapterCalls: string[] = [];
  const adapter: WebReadBrowserRenderAdapter = {
    provider: 'browser-host-session',
    async render(input) {
      adapterCalls.push(`${input.url}|${input.workspacePath}`);
      await mkdir(join(workspacePath, '.sciforge', 'web-read'), { recursive: true });
      await writeFile(textPath, 'Rendered JS article body\nThe browser-only paragraph is now visible.', 'utf8');
      await writeFile(metadataPath, JSON.stringify({
        schemaVersion: 'sciforge.web-read.source-page.v1',
        finalUrl: `${input.url}?hydrated=1`,
        textRef: 'web-text:rendered-js-page',
        textSha1: 'fixture-sha',
      }, null, 2), 'utf8');
      return {
        status: 'read',
        finalUrl: `${input.url}?hydrated=1`,
        title: 'Rendered JS article',
        contentType: 'text/html',
        textCharCount: 64,
        refs: {
          sourcePageRef: 'web-source:rendered-js-page',
          pageTextRef: 'web-text:rendered-js-page',
        },
        artifactPaths: {
          pageTextPath: textPath,
          sourcePagePath: metadataPath,
        },
        trace: {
          navigationUrl: input.url,
          waitReason: 'network-quiet',
          extractMethod: 'rendered-text',
          timings: {
            navigateMs: 12,
            waitMs: 8,
            extractMs: 3,
            persistMs: 2,
          },
        },
      };
    },
  };

  try {
    const result = await runWebReadBrowserFallback({
      workspacePath,
      url: 'https://example.org/js-heavy-article',
      render: 'auto',
      timeoutMs: 1_500,
      staticRead: {
        status: 'extract_failed',
        reason: 'static_extract_empty',
        textCharCount: 0,
        preview: '',
      },
      adapter,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'read');
    assert.equal(result.provider, 'browser-host-session');
    assert.equal(result.diagnostics.fallbackUsed, true);
    assert.equal(result.diagnostics.needsBrowser, false);
    assert.equal(result.diagnostics.needsUserBrowser, false);
    assert.equal(result.data?.finalUrl, 'https://example.org/js-heavy-article?hydrated=1');
    assert.equal(result.refs.sourcePageRef, 'web-source:rendered-js-page');
    assert.equal(result.refs.pageTextRef, 'web-text:rendered-js-page');
    assert.equal(adapterCalls.length, 1);
    assert.match(await readFile(textPath, 'utf8'), /browser-only paragraph/);
    assert.equal(result.fallbackTrace.reason, 'static_extract_empty');
    assert.equal(result.fallbackTrace.navigationUrl, 'https://example.org/js-heavy-article');
    assert.equal(result.fallbackTrace.finalUrl, 'https://example.org/js-heavy-article?hydrated=1');
    assert.equal(result.fallbackTrace.waitReason, 'network-quiet');
    assert.equal(result.fallbackTrace.extractMethod, 'rendered-text');
    assert.ok((result.timings.browserRenderMs ?? -1) >= 0);
    assert.ok(result.timings.totalMs >= (result.timings.browserRenderMs ?? 0));
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web_read browser fallback returns needs_user_browser for CAPTCHA and login surrogates without autonomous bypass', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-user-browser-'));
  const adapterCalls: string[] = [];
  const adapter: WebReadBrowserRenderAdapter = {
    provider: 'playwright',
    async render(input) {
      adapterCalls.push(input.url);
      return {
        status: 'blocked',
        finalUrl: input.url,
        textCharCount: 0,
        blockedReason: 'captcha',
        requiresUserBrowser: true,
        trace: {
          navigationUrl: input.url,
          waitReason: 'blocked',
          extractMethod: 'blocked-surrogate-detection',
          blockedReason: 'captcha',
          timings: {
            navigateMs: 7,
            waitMs: 5,
            extractMs: 1,
          },
        },
      };
    },
  };

  try {
    const result = await runWebReadBrowserFallback({
      workspacePath,
      url: 'https://example.org/protected-paper',
      render: 'browser',
      timeoutMs: 1_500,
      staticRead: {
        status: 'extract_failed',
        reason: 'static_saw_login_wall',
        textCharCount: 31,
        preview: 'Please sign in and complete CAPTCHA',
      },
      adapter,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'needs_user_browser');
    assert.equal(result.error?.code, 'needs_user_browser');
    assert.match(result.error?.message ?? '', /captcha/i);
    assert.equal(result.diagnostics.fallbackUsed, true);
    assert.equal(result.diagnostics.needsBrowser, false);
    assert.equal(result.diagnostics.needsUserBrowser, true);
    assert.equal(result.diagnostics.blockedReason, 'captcha');
    assert.equal(result.fallbackTrace.blockedReason, 'captcha');
    assert.equal(result.fallbackTrace.extractMethod, 'blocked-surrogate-detection');
    assert.equal(result.refs.sourcePageRef, undefined);
    assert.equal(result.refs.pageTextRef, undefined);
    assert.equal(adapterCalls.length, 1);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
