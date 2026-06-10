import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readWebPageStatic } from './web-read-runtime.js';
import { extractStaticHtmlPage } from './web-read-extract.js';
import { sha1 } from './workspace-task-runner.js';

test('static extraction uses Readability as the default article extraction path', async () => {
  const result = await extractStaticHtmlPage({
    url: 'https://example.com/readability-default',
    contentType: 'text/html; charset=utf-8',
    html: `<!doctype html>
      <html>
        <head>
          <title>Chrome Title</title>
          <meta property="og:title" content="Readability Default Article">
        </head>
        <body>
          <nav>Home Pricing Login Search</nav>
          <main>
            <article>
              <h1>Readability Default Article</h1>
              <p>The default static extraction path should use the upstream Readability parser.</p>
              <p>The deterministic extractor remains a fallback only when Readability cannot extract content.</p>
            </article>
          </main>
          <footer>Footer legal links</footer>
        </body>
      </html>`,
  });

  assert.equal(result.method, 'readability-static-html');
  assert.equal(result.title, 'Readability Default Article');
  assert.match(result.text, /upstream Readability parser/);
  assert.doesNotMatch(result.text, /Home Pricing|Footer legal/);
});

test('static web_read fetches HTML, extracts article text, and materializes source/text refs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-'));
  const fixture = await startFixtureServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/article' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Ignored Site Chrome</title>
          <script>console.log('script noise')</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <nav>Navigation Home Pricing Docs</nav>
          <div class="cookie-banner">Accept every tracking cookie</div>
          <article>
            <h1>Static Article Title</h1>
            <p>The static read path extracts the durable article body.</p>
            <p>It records source metadata and page text as refs-first evidence.</p>
          </article>
          <footer>Footer links and legal noise</footer>
        </body>
      </html>`);
  });

  try {
    const result = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/redirect`,
      networkPolicy: { allowPrivateNetwork: true },
      openedAt: '2026-06-10T01:02:03.000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'read');
    assert.equal(result.tool, 'web_read');
    assert.equal(result.provider, 'static-fetch');
    assert.equal(result.data?.requestedUrl, `${fixture.baseUrl}/redirect`);
    assert.equal(result.data?.finalUrl, `${fixture.baseUrl}/article`);
    assert.equal(result.data?.title, 'Static Article Title');
    assert.match(result.data?.contentType ?? '', /^text\/html/);
    assert.match(result.data?.textPreview ?? '', /durable article body/);
    assert.doesNotMatch(result.data?.textPreview ?? '', /Navigation Home|script noise|tracking cookie|Footer links/);
    const sourcePageRef = result.refs.sourcePage;
    const pageTextRef = result.refs.pageText;
    assert.ok(sourcePageRef);
    assert.ok(pageTextRef);
    assert.match(result.refs.sourcePageRef ?? '', /^web-source:/);
    assert.match(result.refs.pageTextRef ?? '', /^web-text:/);
    assert.match(sourcePageRef.path, /^\.sciforge\/web-read\/sources\//);
    assert.match(pageTextRef.path, /^\.sciforge\/web-read\/texts\//);
    assert.equal(typeof result.timings.fetchMs, 'number');
    assert.equal(typeof result.timings.extractMs, 'number');
    assert.equal(typeof result.timings.persistMs, 'number');
    assert.equal(result.diagnostics.httpStatus, 200);
    assert.equal(result.diagnostics.extractMethod, 'readability-static-html');

    const persistedText = await readFile(join(workspacePath, pageTextRef.path), 'utf8');
    const persistedSource = JSON.parse(await readFile(join(workspacePath, sourcePageRef.path), 'utf8'));
    assert.equal(persistedText, result.data?.text);
    assert.equal(persistedSource.schemaVersion, 'sciforge.web-read.source.v1');
    assert.equal(persistedSource.requestedUrl, `${fixture.baseUrl}/redirect`);
    assert.equal(persistedSource.finalUrl, `${fixture.baseUrl}/article`);
    assert.equal(persistedSource.title, 'Static Article Title');
    assert.equal(persistedSource.openedAt, '2026-06-10T01:02:03.000Z');
    assert.equal(persistedSource.textSha1, sha1(persistedText));
    assert.equal(persistedSource.textRef, result.refs.pageTextRef);
    assert.equal(typeof persistedSource.timings.fetchMs, 'number');
    assert.equal(typeof persistedSource.timings.extractMs, 'number');
    assert.equal(typeof persistedSource.timings.persistMs, 'number');
    assert.equal(typeof persistedSource.timings.totalMs, 'number');
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('static web_read uses Readability extraction for unannotated article layouts', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-readability-'));
  const fixture = await startFixtureServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Ocean Instrument Update - Research Portal</title>
        </head>
        <body>
          <div class="site-shell">
            <div class="global-links">
              <a href="/home">Homepage</a>
              <a href="/funding">Funding calls</a>
              <a href="/jobs">Careers</a>
              <a href="/events">Events calendar</a>
              <a href="/contact">Contact desk</a>
            </div>
            <div class="feature-frame">
              <h1>Ocean Instrument Update</h1>
              <p>The calibration group published a field note about the new salinity instrument.</p>
              <p>The report compares repeated casts, sensor drift, and the control samples used during recovery.</p>
              <p>Those details are the durable page evidence that should survive static HTML extraction.</p>
            </div>
            <div class="link-cluster">
              <a href="/share">Share this page</a>
              <a href="/print">Print page</a>
              <a href="/mail">Email desk</a>
            </div>
          </div>
        </body>
      </html>`);
  });

  try {
    const result = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      networkPolicy: { allowPrivateNetwork: true },
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.extractMethod, 'readability-static-html');
    assert.equal(result.data?.title, 'Ocean Instrument Update');
    assert.match(result.data?.text ?? '', /new salinity instrument/);
    assert.match(result.data?.text ?? '', /durable page evidence/);
    assert.doesNotMatch(result.data?.text ?? '', /Homepage|Funding calls|Careers|Share this page/);
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('static web_read extracts ordinary, news, and docs fixtures without chrome noise', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-fixtures-'));
  const fixture = await startFixtureServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/news') {
      res.end(`<!doctype html>
        <html>
          <head>
            <title>Daily Example - noisy suffix</title>
            <meta property="og:title" content="Mars Lab Publishes New Results">
            <meta name="author" content="Example Science Desk">
          </head>
          <body>
            <header>Subscribe Login Markets Weather</header>
            <main>
              <div class="share-tools">Share Save Print Gift</div>
              <div itemprop="articleBody">
                <h1>Mars Lab Publishes New Results</h1>
                <p>The science team released calibrated spectra from the ridge instrument.</p>
                <p>The article body explains why the new measurements improve reproducibility.</p>
              </div>
              <section class="related-stories">
                <h2>Related stories</h2>
                <p>Celebrity roundups and market alerts should not become source evidence.</p>
              </section>
            </main>
          </body>
        </html>`);
      return;
    }
    if (req.url === '/docs') {
      res.end(`<!doctype html>
        <html>
          <head><title>Docs Platform</title></head>
          <body>
            <header>SDK Search Login Theme Toggle</header>
            <div class="layout">
              <div class="toc">On this page Install Configure Deploy</div>
              <div role="main" class="markdown-body">
                <h1>SDK Quickstart</h1>
                <p>Install the package, configure the client, and run the local verifier.</p>
                <pre><code>npm run verify:runtime</code></pre>
              </div>
            </div>
          </body>
        </html>`);
      return;
    }
    res.end(`<!doctype html>
      <html>
        <head><title>Plain HTML Fixture</title></head>
        <body>
          <nav>Home About Pricing</nav>
          <main>
            <h1>Plain HTML Fixture</h1>
            <p>A simple page still needs deterministic static extraction.</p>
            <p>The readable body should survive without relying on browser rendering.</p>
          </main>
        </body>
      </html>`);
  });

  try {
    const ordinary = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/ordinary`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(ordinary.ok, true);
    assert.match(ordinary.data?.text ?? '', /deterministic static extraction/);
    assert.doesNotMatch(ordinary.data?.text ?? '', /Home About Pricing/);

    const news = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/news`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(news.ok, true);
    assert.equal(news.data?.title, 'Mars Lab Publishes New Results');
    assert.match(news.data?.text ?? '', /calibrated spectra/);
    assert.doesNotMatch(news.data?.text ?? '', /Subscribe Login|Share Save|Celebrity roundups/);

    const docs = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/docs`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(docs.ok, true);
    assert.equal(docs.data?.title, 'SDK Quickstart');
    assert.match(docs.data?.text ?? '', /Install the package, configure the client/);
    assert.match(docs.data?.text ?? '', /npm run verify:runtime/);
    assert.doesNotMatch(docs.data?.text ?? '', /SDK Search Login|On this page/);
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('static web_read reports explicit cache miss, hit, and revalidated states', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-cache-'));
  let hits = 0;
  const fixture = await startFixtureServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body>
          <article>
            <h1>Cache Policy Fixture</h1>
            <p>Version ${hits} contains stable page text for cache policy verification.</p>
            <p>The body is intentionally long enough to avoid low information handling.</p>
          </article>
        </body>
      </html>`);
  });

  try {
    const first = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      cachePolicy: 'default',
      networkPolicy: { allowPrivateNetwork: true },
      openedAt: '2026-06-10T00:00:00.000Z',
    });
    assert.equal(first.ok, true);
    assert.equal(first.timings.cache, 'miss');
    assert.equal(first.timings.cachePolicy, 'default');
    assert.equal(first.diagnostics.cacheStatus, 'miss');
    assert.match(first.data?.text ?? '', /Version 1/);
    assert.equal(hits, 1);

    const second = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      cachePolicy: 'default',
      networkPolicy: { allowPrivateNetwork: true },
      openedAt: '2026-06-10T00:01:00.000Z',
    });
    assert.equal(second.ok, true);
    assert.equal(second.timings.cache, 'hit');
    assert.equal(second.timings.cachePolicy, 'default');
    assert.equal(second.diagnostics.cacheStatus, 'hit');
    assert.match(second.data?.text ?? '', /Version 1/);
    assert.equal(hits, 1);

    const refreshed = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      cachePolicy: 'refresh',
      networkPolicy: { allowPrivateNetwork: true },
      openedAt: '2026-06-10T00:02:00.000Z',
    });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.timings.cache, 'revalidated');
    assert.equal(refreshed.timings.cachePolicy, 'refresh');
    assert.equal(refreshed.diagnostics.cacheStatus, 'revalidated');
    assert.match(refreshed.data?.text ?? '', /Version 2/);
    assert.equal(hits, 2);

    const sourcePageRef = refreshed.refs.sourcePage;
    assert.ok(sourcePageRef);
    const persistedSource = JSON.parse(await readFile(join(workspacePath, sourcePageRef.path), 'utf8'));
    assert.equal(persistedSource.timings.cache, 'revalidated');
    assert.equal(persistedSource.timings.cachePolicy, 'refresh');
    assert.equal(persistedSource.diagnostics.cacheStatus, 'revalidated');
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('resourceRef reads only discovered web_search web-page refs with URL locators', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-ref-'));
  const fixture = await startFixtureServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<main><h1>Discovered Page</h1><p>Read through a discovered web page ref.</p></main>');
  });

  try {
    const result = await readWebPageStatic({
      workspacePath,
      resourceRef: 'web-page:fixture-1',
      resourceRefs: [{
        ref: 'web-page:fixture-1',
        kind: 'web_page',
        sourceTool: 'web_search',
        locator: { url: fixture.baseUrl },
      }],
      networkPolicy: { allowPrivateNetwork: true },
    });

    assert.equal(result.ok, true);
    assert.equal(result.data?.requestedResourceRef, 'web-page:fixture-1');
    assert.equal(result.data?.requestedUrl, fixture.baseUrl);

    const unknown = await readWebPageStatic({
      workspacePath,
      resourceRef: 'web-page:missing',
      resourceRefs: [{
        ref: 'web-page:fixture-1',
        kind: 'web_page',
        sourceTool: 'web_search',
        locator: { url: fixture.baseUrl },
      }],
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error?.code, 'invalid_input');
    assert.deepEqual(unknown.refs, {});

    const wrongKind = await readWebPageStatic({
      workspacePath,
      resourceRef: 'web-source:fixture-1',
      resourceRefs: [{
        ref: 'web-source:fixture-1',
        kind: 'web_source',
        sourceTool: 'web_search',
        locator: { url: fixture.baseUrl },
      }],
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(wrongKind.ok, false);
    assert.equal(wrongKind.error?.code, 'invalid_input');
    assert.deepEqual(wrongKind.refs, {});
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('unsafe URL guard blocks special protocols and localhost before fetch', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-guard-'));
  let hits = 0;
  const fixture = await startFixtureServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<article><p>should not be fetched</p></article>');
  });

  try {
    const fileResult = await readWebPageStatic({ workspacePath, url: 'file:///etc/passwd' });
    assert.equal(fileResult.ok, false);
    assert.equal(fileResult.error?.code, 'unsafe_url');
    assert.deepEqual(fileResult.refs, {});

    const localhostResult = await readWebPageStatic({ workspacePath, url: fixture.baseUrl });
    assert.equal(localhostResult.ok, false);
    assert.equal(localhostResult.error?.code, 'unsafe_url');
    assert.match(localhostResult.diagnostics.blockedReason ?? '', /private|localhost|loopback/);
    assert.deepEqual(localhostResult.refs, {});
    assert.equal(hits, 0);

    const privateIpResult = await readWebPageStatic({ workspacePath, url: 'http://192.168.1.10/article' });
    assert.equal(privateIpResult.ok, false);
    assert.equal(privateIpResult.error?.code, 'unsafe_url');
    assert.deepEqual(privateIpResult.refs, {});
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('static web_read covers encoding, empty body, HTTP auth/status, and network failure fixtures', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-edge-'));
  const fixture = await startFixtureServer((req, res) => {
    if (req.url === '/latin1') {
      const latin1Html = `<!doctype html>
        <html><body><article>
          <h1>Caf\xe9 Research Notes</h1>
          <p>Caf\xe9 observations include d\xe9j\xe0 vu markers and reproducible summaries.</p>
          <p>The declared encoding must be used before static extraction runs.</p>
        </article></body></html>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
      res.end(Buffer.from(latin1Html, 'latin1'));
      return;
    }
    if (req.url === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>   \n\t </body></html>');
      return;
    }
    if (req.url === '/unauthorized') {
      res.writeHead(401, { 'content-type': 'text/html' });
      res.end('<html><body>Unauthorized</body></html>');
      return;
    }
    if (req.url === '/forbidden') {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html><body>Forbidden</body></html>');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><body>Not found</body></html>');
  });
  const closedFixture = await startFixtureServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<main><p>This server closes before it can be read.</p></main>');
  });
  const closedUrl = closedFixture.baseUrl;
  await closedFixture.close();

  try {
    const encoded = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/latin1`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(encoded.ok, true);
    assert.match(encoded.data?.text ?? '', /Caf\u00e9 Research Notes/);
    assert.match(encoded.data?.text ?? '', /d\u00e9j\u00e0 vu/);

    const empty = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/empty`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.status, 'blocked');
    assert.equal(empty.error?.code, 'extract_failed');
    assert.equal(empty.diagnostics.blockedReason, 'empty_extracted_text');
    assert.deepEqual(empty.refs, {});

    for (const [path, status, expectedStatus] of [
      ['/unauthorized', 401, 'blocked'],
      ['/forbidden', 403, 'blocked'],
      ['/missing', 404, 'failed'],
    ] as const) {
      const result = await readWebPageStatic({
        workspacePath,
        url: `${fixture.baseUrl}${path}`,
        networkPolicy: { allowPrivateNetwork: true },
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, expectedStatus);
      assert.equal(result.error?.code, 'read_failed');
      assert.equal(result.diagnostics.httpStatus, status);
      assert.equal(result.diagnostics.blockedReason, `http_${status}`);
      assert.deepEqual(result.refs, {});
    }

    const networkFailure = await readWebPageStatic({
      workspacePath,
      url: closedUrl,
      timeoutMs: 250,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(networkFailure.ok, false);
    assert.equal(networkFailure.status, 'failed');
    assert.equal(networkFailure.error?.code, 'read_failed');
    assert.match(networkFailure.diagnostics.networkError ?? '', /fetch|ECONN|connect|other side closed/i);
    assert.deepEqual(networkFailure.refs, {});
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('read failures do not produce source evidence refs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-failure-'));
  const fixture = await startFixtureServer((req, res) => {
    if (req.url === '/forbidden') {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html><body>Forbidden</body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end('%PDF-not-html');
  });

  try {
    const forbidden = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/forbidden`,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.status, 'blocked');
    assert.equal(forbidden.error?.code, 'read_failed');
    assert.deepEqual(forbidden.refs, {});

    const nonHtml = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(nonHtml.ok, false);
    assert.equal(nonHtml.status, 'blocked');
    assert.equal(nonHtml.error?.code, 'read_failed');
    assert.match(nonHtml.diagnostics.blockedReason ?? '', /non_html_content_type/);
    assert.deepEqual(nonHtml.refs, {});
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('static fetch enforces timeout and max bytes without materializing refs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-read-limits-'));
  const fixture = await startFixtureServer((req, res) => {
    if (req.url === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<article><p>too late</p></article>');
      }, 150);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<article><p>${'large body '.repeat(200)}</p></article>`);
  });

  try {
    const timeout = await readWebPageStatic({
      workspacePath,
      url: `${fixture.baseUrl}/slow`,
      timeoutMs: 30,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.error?.code, 'timeout');
    assert.deepEqual(timeout.refs, {});

    const tooLarge = await readWebPageStatic({
      workspacePath,
      url: fixture.baseUrl,
      maxBytes: 64,
      networkPolicy: { allowPrivateNetwork: true },
    });
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.error?.code, 'read_failed');
    assert.equal(tooLarge.diagnostics.blockedReason, 'max_bytes_exceeded');
    assert.deepEqual(tooLarge.refs, {});
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

async function startFixtureServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind to a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
