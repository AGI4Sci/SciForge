import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

import {
  boundedSearchResults,
  browserHostDiscoveryResultExtractionScript,
  decodeSearchRedirect,
} from './browser-host-session-search.js';

test('bounded search results drop search engine navigation links across localized hosts', () => {
  const results = boundedSearchResults([
    { title: 'Skip to content', url: 'https://cn.bing.com/search?q=%E4%BC%8A%E6%9C%97#', snippet: '' },
    { title: 'Web', url: 'https://cn.bing.com/?scope=web&FORM=HDRSC1', snippet: 'WEB' },
    { title: 'Images', url: 'https://cn.bing.com/images/search?q=%E4%BC%8A%E6%9C%97', snippet: 'IMAGES' },
    { title: 'Iran latest news', url: 'https://example.org/iran-news', snippet: 'Actual external result.' },
  ], 5);

  assert.deepEqual(results, [{
    title: 'Iran latest news',
    url: 'https://example.org/iran-news',
    snippet: 'Actual external result.',
  }]);
});

test('browser host search extraction script prioritizes result containers over page navigation', () => {
  const nav = fakeAnchor('Web', 'https://cn.bing.com/?scope=web&FORM=HDRSC1');
  const resultAnchor = fakeAnchor('Iran latest news', 'https://example.org/iran-news');
  const resultContainer = {
    innerText: 'Iran latest news\nActual external result.',
    querySelector: (selector: string) => selector.includes('h2 a') ? resultAnchor : null,
  };
  const document = {
    querySelectorAll(selector: string) {
      if (selector === '#b_results > li.b_algo') return [resultContainer];
      if (selector === 'a[href]') return [nav, resultAnchor];
      return [];
    },
  };

  const rows = vm.runInNewContext(browserHostDiscoveryResultExtractionScript(5), { document, URL }) as Array<{
    title: string;
    url: string;
    snippet: string;
  }>;

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{
    title: 'Iran latest news',
    url: 'https://example.org/iran-news',
    snippet: 'Actual external result.',
  }]);
});

test('decode search redirect unwraps Bing base64url targets', () => {
  const encoded = Buffer.from('https://example.org/iran-news', 'utf8').toString('base64url');
  assert.equal(
    decodeSearchRedirect(`https://www.bing.com/ck/a?u=a1${encoded}`),
    'https://example.org/iran-news',
  );
});

function fakeAnchor(textContent: string, href: string) {
  return {
    textContent,
    href,
    closest: () => ({ innerText: textContent }),
  };
}
