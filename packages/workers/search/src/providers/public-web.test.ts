import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseBingRssResults,
  parseDuckDuckGoHtmlResults,
  PublicWebResearchProvider
} from './public-web.js';

describe('keyless public web search provider', () => {
  it('does not start a fallback request when the input is already aborted', async () => {
    let calls = 0;
    const provider = new PublicWebResearchProvider(async () => {
      calls += 1;
      return '<rss><channel></channel></rss>';
    });
    const controller = new AbortController();
    controller.abort(new Error('cancelled before public search'));

    await assert.rejects(provider.search({
      query: 'current release',
      intent: 'latest',
      domain: 'general',
      maxResults: 2,
      timeoutMs: 1000,
      signal: controller.signal
    }), /cancelled before public search/);
    assert.equal(calls, 0);
  });

  it('parses bounded Bing RSS results and keeps citation URLs', () => {
    const results = parseBingRssResults(`
      <rss><channel>
        <item><title>Official &amp; current release</title><link>https://example.test/release#details</link><description>Released today.</description></item>
        <item><title>Duplicate</title><link>https://example.test/release</link><description>Duplicate.</description></item>
        <item><title>Unsafe</title><link>javascript:alert(1)</link><description>Ignore.</description></item>
      </channel></rss>
    `, 5);

    assert.deepEqual(results, [{
      title: 'Official & current release',
      url: 'https://example.test/release',
      snippet: 'Released today.',
      source: 'public_web',
      rank: 1
    }]);
  });

  it('decodes DuckDuckGo redirect links without returning the search redirect', () => {
    const target = encodeURIComponent('https://docs.example.test/launch?a=1&b=2');
    const results = parseDuckDuckGoHtmlResults(`
      <html><body>
        <div class="result results_links">
          <h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${target}">Launch &amp; docs</a></h2>
          <a class="result__snippet">Current product documentation.</a>
        </div>
      </body></html>
    `, 3);

    assert.equal(results[0]?.url, 'https://docs.example.test/launch?a=1&b=2');
    assert.equal(results[0]?.title, 'Launch & docs');
    assert.equal(results[0]?.snippet, 'Current product documentation.');
  });

  it('falls back from an empty RSS response to public HTML search', async () => {
    const calls: string[] = [];
    const provider = new PublicWebResearchProvider(async (url) => {
      calls.push(url);
      if (url.includes('bing.com')) return '<rss><channel></channel></rss>';
      return `
        <div class="result">
          <a class="result__a" href="https://example.test/current">Current release</a>
          <div class="result__snippet">Official details.</div>
        </div>
      `;
    });
    const result = await provider.search({
      query: 'current release',
      intent: 'latest',
      domain: 'general',
      maxResults: 2,
      timeoutMs: 1000,
      signal: new AbortController().signal
    });

    assert.equal(calls.length, 2);
    assert.equal(result.webResults[0]?.url, 'https://example.test/current');
    assert.equal(result.diagnostics?.[0]?.role, 'fallback');
    assert.match(result.diagnostics?.[0]?.reason ?? '', /DuckDuckGo HTML/);
  });
});
