import type { BrowserHostSearchOutput, BrowserHostSearchResult, BrowserHostSearchSourcePage } from './browser-host-session-types.js';

export interface BrowserHostSearchAnswer {
  message: string;
  language: 'zh' | 'en';
  evidenceState: 'browser-unavailable' | 'source-pages-read' | 'candidate-only' | 'empty';
  sourceUrls: string[];
  diagnostics?: string[];
}

export function browserHostSearchAnswerFromOutput(input: {
  prompt: string;
  output: BrowserHostSearchOutput;
  maxResults?: number;
}): BrowserHostSearchAnswer {
  const language = browserSearchAnswerLanguage(`${input.prompt}\n${input.output.query}`);
  const unavailableDiagnostics = browserUnavailableDiagnostics(input.output);
  if (unavailableDiagnostics.length) {
    return {
      message: browserUnavailableAnswer(language, input.output.query, unavailableDiagnostics),
      language,
      evidenceState: 'browser-unavailable',
      sourceUrls: [],
      diagnostics: unavailableDiagnostics,
    };
  }
  const results = usableSearchResults(input.output.results, input.maxResults ?? 5);
  const sourcePages = readableSourcePages(input.output.sourcePages, input.maxResults ?? 5);
  if (sourcePages.length) {
    return {
      message: language === 'zh'
        ? chineseSourcePageAnswer(input.output.query, sourcePages)
        : englishSourcePageAnswer(input.output.query, sourcePages),
      language,
      evidenceState: 'source-pages-read',
      sourceUrls: sourcePages.map((page) => page.finalUrl || page.url),
    };
  }
  const sourceUrls = results.map((result) => result.url);
  if (!results.length) {
    return {
      message: emptySearchAnswer(language, input.output.query),
      language,
      evidenceState: 'empty',
      sourceUrls,
    };
  }

  return {
    message: language === 'zh'
      ? chineseSearchAnswer(input.output.query, results)
      : englishSearchAnswer(input.output.query, results),
    language,
    evidenceState: 'candidate-only',
    sourceUrls,
  };
}

function readableSourcePages(value: BrowserHostSearchSourcePage[] | undefined, maxResults: number): BrowserHostSearchSourcePage[] {
  const seen = new Set<string>();
  const pages: BrowserHostSearchSourcePage[] = [];
  for (const page of value ?? []) {
    const finalUrl = typeof page.finalUrl === 'string' ? page.finalUrl.trim() : '';
    const url = typeof page.url === 'string' ? page.url.trim() : '';
    const sourceUrl = finalUrl || url;
    const textPreview = cleanText(page.textPreview ?? '');
    const textSummary = cleanText(page.textSummary ?? '');
    if (page.status !== 'read' || !/^https?:\/\//i.test(sourceUrl) || (!textPreview && !textSummary) || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    pages.push({
      ...page,
      finalUrl: sourceUrl,
      url: url || sourceUrl,
      title: cleanText(page.title) || sourceUrl,
      textPreview,
      ...(textSummary ? { textSummary } : {}),
    });
    if (pages.length >= Math.max(1, Math.min(10, Math.floor(maxResults)))) break;
  }
  return pages;
}

function browserSearchAnswerLanguage(text: string): BrowserHostSearchAnswer['language'] {
  return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en';
}

function usableSearchResults(results: BrowserHostSearchResult[], maxResults: number): BrowserHostSearchResult[] {
  const seen = new Set<string>();
  const usable: BrowserHostSearchResult[] = [];
  for (const result of results) {
    const title = cleanText(result.title);
    const snippet = searchResultSnippet(result);
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if ((!title && !snippet) || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    usable.push({
      title,
      url,
      snippet,
    });
    if (usable.length >= Math.max(1, Math.min(10, Math.floor(maxResults)))) break;
  }
  return usable;
}

function chineseSearchAnswer(query: string, results: BrowserHostSearchResult[]): string {
  const lines = [
    `我找到了关于“${cleanText(query)}”的候选来源，但目前只读取了搜索结果页的标题和摘要，还没有打开并阅读来源页面，所以不能把这些内容当作完整结论：`,
    '',
    ...results.map((result) => {
      const title = cleanText(result.title) || '搜索结果';
      const snippet = searchResultSnippet(result);
      const summary = snippet ? `${title}：${snippet}` : title;
      return `- ${summary} 来源：${result.url}`;
    }),
    '',
    '需要完整回答时，请确认是否继续打开并阅读这些来源；我会在读完页面正文后再总结。',
  ];
  return lines.join('\n');
}

function englishSearchAnswer(query: string, results: BrowserHostSearchResult[]): string {
  const lines = [
    `I found these candidate sources for "${cleanText(query)}", but I have only read the search-results titles/snippets and have not opened and read the source pages yet, so this is not a complete answer:`,
    '',
    ...results.map((result) => {
      const title = cleanText(result.title) || 'Search result';
      const snippet = searchResultSnippet(result);
      const summary = snippet ? `${title}: ${snippet}` : title;
      return `- ${summary} Source: ${result.url}`;
    }),
    '',
    'To answer fully, confirm that I should continue by opening and reading these sources; I will summarize after reading the source-page content.',
  ];
  return lines.join('\n');
}

function chineseSourcePageAnswer(query: string, sourcePages: BrowserHostSearchSourcePage[]): string {
  const lines = [
    `我已用内置浏览器搜索“${cleanText(query)}”，并打开、阅读了来源页面正文。基于已读取页面内容，关键信息是：`,
    '',
    ...sourcePages.map((page, index) => {
      const title = cleanText(page.title) || `来源 ${index + 1}`;
      return `- ${title}：${sourcePagePreview(page)} 来源：${page.finalUrl || page.url}`;
    }),
  ];
  return lines.join('\n');
}

function englishSourcePageAnswer(query: string, sourcePages: BrowserHostSearchSourcePage[]): string {
  const lines = [
    `I searched for "${cleanText(query)}", opened the source pages in the built-in browser, and read their page text. Based on those opened pages:`,
    '',
    ...sourcePages.map((page, index) => {
      const title = cleanText(page.title) || `Source ${index + 1}`;
      return `- ${title}: ${sourcePagePreview(page)} Source: ${page.finalUrl || page.url}`;
    }),
  ];
  return lines.join('\n');
}

function sourcePagePreview(page: BrowserHostSearchSourcePage): string {
  const textSummary = cleanText(page.textSummary ?? '');
  if (textSummary) return textSummary;
  return truncateAtWord(cleanText(page.textPreview || ''), 900);
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, Math.max(0, maxLength - 3));
  const boundary = slice.lastIndexOf(' ');
  const prefix = boundary >= Math.floor(maxLength * 0.65) ? slice.slice(0, boundary) : slice;
  return `${prefix.trimEnd()}...`;
}

function browserUnavailableDiagnostics(output: BrowserHostSearchOutput): string[] {
  const progress = output.session.loadingProgress;
  const unavailable = output.session.status === 'failed'
    || progress?.blocked === true
    || progress?.requiresHandoff === true
    || progress?.state === 'handoff';
  if (!unavailable) return [];
  const diagnostics = [
    ...output.session.diagnostics,
    progress ? `BrowserHostSession loading progress: ${progress.state}/${progress.reason}` : undefined,
  ];
  return uniqueStrings(diagnostics.map((diagnostic) => cleanText(String(diagnostic ?? ''))).filter(Boolean)).slice(0, 8);
}

function browserUnavailableAnswer(language: BrowserHostSearchAnswer['language'], query: string, diagnostics: string[]): string {
  const reason = browserUnavailablePublicReason(language, diagnostics);
  if (language === 'zh') {
    return [
      `内置浏览器这次没有成功打开搜索页，因此不能判断“${cleanText(query)}”的真实搜索结果。`,
      `当前阻塞是：${reason}`,
      '请先恢复 SciForge 的内置浏览器适配器，或确认是否改用其他可用搜索能力；恢复后我会重新搜索、打开来源页面并阅读正文后再总结。',
    ].join('');
  }
  return [
    `The built-in browser did not successfully open the search page, so I cannot judge the real search results for "${cleanText(query)}". `,
    `Current blocker: ${reason} `,
    'Reconnect the SciForge embedded-browser adapter, or confirm that I should use another available search capability; after recovery I will search again, open the source pages, and summarize from their content.',
  ].join('');
}

function browserUnavailablePublicReason(language: BrowserHostSearchAnswer['language'], diagnostics: string[]): string {
  const joined = diagnostics.join(' ');
  if (/native embedded BrowserHostSession adapter|SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL|Legacy host-stream fallback/i.test(joined)) {
    return language === 'zh'
      ? 'BrowserHostSession 原生适配器未连接，需要启动或配置内置浏览器的 loopback native adapter。'
      : 'the native BrowserHostSession adapter is not connected; start or configure the embedded browser loopback native adapter.';
  }
  if (/host-error|handoff|blocked/i.test(joined)) {
    return language === 'zh'
      ? 'BrowserHostSession 被标记为阻塞或需要人工接管，搜索页没有被读取。'
      : 'BrowserHostSession is blocked or requires handoff, so the search page was not read.';
  }
  return language === 'zh'
    ? 'BrowserHostSession 不可用，搜索页没有被读取。'
    : 'BrowserHostSession is unavailable, so the search page was not read.';
}

function emptySearchAnswer(language: BrowserHostSearchAnswer['language'], query: string): string {
  if (language === 'zh') {
    return `内置浏览器没有为“${cleanText(query)}”找到可用搜索结果。可以换一个更具体的关键词，或让我继续打开相关来源进行查找。`;
  }
  return `The built-in browser did not find usable search results for "${cleanText(query)}". Try a more specific query, or ask me to continue by opening likely sources.`;
}

function searchResultSnippet(result: BrowserHostSearchResult): string {
  const title = cleanText(result.title);
  const snippet = cleanText(result.snippet);
  if (!title || !snippet) return snippet;
  return cleanText(snippet.replace(title, ''));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
