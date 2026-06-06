import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
} from './browser-host-session.js';
import type { BrowserHostSearchOutput } from './browser-host-session-types.js';
import { browserHostSearchAnswerFromOutput } from './browser-host-search-answer.js';

test('reports Chinese search snippets as candidate sources instead of a fully understood answer', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: '通过内置浏览器搜索伊朗局势',
    output: searchOutput({
      query: '伊朗局势',
      results: [
        { title: '伊朗局势最新消息', url: 'https://news.example.cn/iran', snippet: '多方消息称地区紧张仍在持续，外交斡旋同步推进。' },
        { title: '国际社会关注中东局势', url: 'https://world.example.org/middle-east', snippet: '能源市场和周边安全形势受到影响。' },
      ],
    }),
  });

  assert.match(answer.message, /候选来源/);
  assert.match(answer.message, /还没有打开并阅读来源页面/);
  assert.match(answer.message, /地区紧张仍在持续/);
  assert.match(answer.message, /外交斡旋/);
  assert.match(answer.message, /https:\/\/news\.example\.cn\/iran/);
  assert.doesNotMatch(answer.message, /^BrowserHostSession search:/);
  assert.deepEqual(answer.sourceUrls, ['https://news.example.cn/iran', 'https://world.example.org/middle-east']);
  assert.equal(answer.language, 'zh');
  assert.equal(answer.evidenceState, 'candidate-only');
});

test('reports English search snippets as candidate sources without topic-specific branching', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: 'Find the latest Python release and cite source URLs.',
    output: searchOutput({
      query: 'latest Python release',
      results: [
        { title: 'Python 3.14.0 release notes', url: 'https://www.python.org/downloads/release/python-3140/', snippet: 'Python 3.14.0 is the newest feature release.' },
        { title: 'Python downloads', url: 'https://www.python.org/downloads/', snippet: 'Download the latest version of Python.' },
      ],
    }),
  });

  assert.match(answer.message, /candidate sources/i);
  assert.match(answer.message, /have not opened and read/i);
  assert.match(answer.message, /Python 3\.14\.0/);
  assert.match(answer.message, /https:\/\/www\.python\.org\/downloads\/release\/python-3140\//);
  assert.doesNotMatch(answer.message, /^BrowserHostSession search:/);
  assert.equal(answer.evidenceState, 'candidate-only');
});

test('answers from opened source page text and ignores search snippets', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: 'Search Hugging Face Daily Papers today hot papers and summarize.',
    output: searchOutput({
      query: 'Hugging Face Daily Papers today hot papers',
      results: [
        {
          title: 'Daily Papers - misleading snippet',
          url: 'https://huggingface.co/papers',
          snippet: 'Wrong snippet: the top paper is Old Benchmark 2019.',
        },
      ],
      sourcePages: [{
        resultIndex: 0,
        title: 'Hugging Face Daily Papers',
        url: 'https://huggingface.co/papers',
        finalUrl: 'https://huggingface.co/papers',
        openedAt: '2026-06-06T00:00:02.000Z',
        status: 'read',
        textRef: 'browser-host-session:search-session/source-pages/source-1.txt',
        textPreview: 'Daily Papers lists trending machine learning papers. The currently visible entries include Reasoning Models for Agents and Efficient Vision-Language Adaptation.',
        textCharCount: 146,
        textSha1: 'source-page-sha',
      }],
    }),
  });

  assert.equal(answer.evidenceState, 'source-pages-read');
  assert.match(answer.message, /opened and read|source page/i);
  assert.match(answer.message, /Reasoning Models for Agents/);
  assert.match(answer.message, /Efficient Vision-Language Adaptation/);
  assert.doesNotMatch(answer.message, /Old Benchmark 2019|Wrong snippet/);
  assert.deepEqual(answer.sourceUrls, ['https://huggingface.co/papers']);
});

test('answers Hugging Face Daily Papers API pages from bounded structured summaries instead of raw JSON', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: '搜索 Hugging Face Daily Papers 今天热门论文',
    output: searchOutput({
      query: 'Hugging Face Daily Papers 今天热门论文',
      results: [
        {
          title: 'Hugging Face Daily Papers API',
          url: 'https://huggingface.co/api/daily_papers?sort=trending',
          snippet: 'Official API response.',
        },
      ],
      sourcePages: [{
        resultIndex: 0,
        title: 'Hugging Face Daily Papers API',
        url: 'https://huggingface.co/api/daily_papers?sort=trending',
        finalUrl: 'https://huggingface.co/api/daily_papers?sort=trending',
        openedAt: '2026-06-06T00:00:02.000Z',
        status: 'read',
        textRef: 'browser-host-session:search-session/source-pages/source-1.txt',
        textPreview: '[{"paper":{"id":"2606.03264","authors":[{"_id":"secret-author-id","name":"Zelun Zhang"}],"title":"PaddleOCR-VL-1.6","summary":"Raw preview should not be used when a structured summary exists."}}',
        textSummary: '1. PaddleOCR-VL-1.6: Expanding the Frontier of Document Parsing (作者：Zelun Zhang、Hongen Liu；热度：13 upvotes，1 comments；日期：2026-06-02)：介绍面向文档解析的区域感知数据优化和渐进式后训练。 2. TradingAgents: Multi-Agents LLM Financial Trading Framework (作者：Yijia Xiao、Edward Sun；热度：86 upvotes，4 comments；日期：2024-12-28)：用多智能体模拟交易公司协作流程。',
        textCharCount: 60000,
        textSha1: 'source-page-sha',
      } as NonNullable<BrowserHostSearchOutput['sourcePages']>[number]],
    }),
  });

  assert.equal(answer.evidenceState, 'source-pages-read');
  assert.match(answer.message, /PaddleOCR-VL-1\.6/);
  assert.match(answer.message, /TradingAgents/);
  assert.match(answer.message, /Zelun Zhang/);
  assert.match(answer.message, /13 upvotes/);
  assert.match(answer.message, /文档解析/);
  assert.doesNotMatch(answer.message, /\{"paper"|"_id"|secret-author-id|Raw preview should not be used/);
  assert.deepEqual(answer.sourceUrls, ['https://huggingface.co/api/daily_papers?sort=trending']);
});

test('returns a readable limited-evidence answer when results are empty', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: 'Search for a very obscure query and cite sources.',
    output: searchOutput({ query: 'very obscure query', results: [] }),
  });

  assert.match(answer.message, /did not find usable search results/i);
  assert.deepEqual(answer.sourceUrls, []);
  assert.equal(answer.evidenceState, 'empty');
});

test('reports an unavailable embedded browser instead of pretending the query has no results', () => {
  const answer = browserHostSearchAnswerFromOutput({
    prompt: '通过内置浏览器搜索伊朗局势',
    output: searchOutput({
      query: '伊朗局势',
      finalUrl: 'about:blank',
      results: [],
      session: {
        status: 'failed',
        url: 'about:blank',
        diagnostics: [
          'Native embedded BrowserHostSession adapter is required; set SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL to a loopback native adapter. Legacy host-stream fallback is disabled.',
        ],
        loadingProgress: {
          schemaVersion: BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
          state: 'handoff',
          reason: 'host-error',
          source: 'host-error',
          status: 'failed',
          updatedAt: '2026-06-06T00:00:01.000Z',
          refs: {},
          blocked: true,
          requiresHandoff: true,
        },
      },
    }),
  });

  assert.match(answer.message, /内置浏览器.*没有成功打开搜索页/);
  assert.match(answer.message, /原生适配器|适配器/);
  assert.doesNotMatch(answer.message, /没有为“伊朗局势”找到可用搜索结果/);
  assert.equal(answer.evidenceState, 'browser-unavailable');
  assert.deepEqual(answer.sourceUrls, []);
  assert.ok(answer.diagnostics?.some((diagnostic) => /Native embedded BrowserHostSession adapter/.test(diagnostic)));
});

type BrowserHostSearchOutputInput = Omit<Partial<BrowserHostSearchOutput>, 'session'> & {
  session?: Partial<BrowserHostSearchOutput['session']>;
};

function searchOutput(input: BrowserHostSearchOutputInput): BrowserHostSearchOutput {
  const { session: sessionOverride, ...outputOverrides } = input;
  const session: BrowserHostSearchOutput['session'] = {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: 'search-session',
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: '/tmp/workspace',
    requestedUrl: 'https://www.bing.com/search?q=query',
    url: 'https://www.bing.com/search?q=query',
    startedAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:01.000Z',
    viewport: { width: 1365, height: 900 },
    canGoBack: false,
    canGoForward: false,
    diagnostics: [],
    ...sessionOverride,
  };
  return {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: outputOverrides.query ?? 'query',
    engine: outputOverrides.engine ?? 'bing',
    searchedAt: '2026-06-06T00:00:00.000Z',
    searchUrl: 'https://www.bing.com/search?q=query',
    finalUrl: 'https://www.bing.com/search?q=query',
    results: outputOverrides.results ?? [],
    searchResultRef: 'browser-host-session:search-session/search-results.json',
    ...outputOverrides,
    session,
  };
}
