export const WEB_WORKER_SEARCH_PROVIDER_IDS = {
  arxivApi: 'arxiv-api',
  arxivBrowser: 'arxiv-browser',
  duckDuckGoHtml: 'duckduckgo-html',
  duckDuckGoHtmlRendered: 'duckduckgo-html-rendered',
  bingRendered: 'bing-rendered',
  europePmc: 'europepmc',
  crossref: 'crossref',
  playwrightChromium: 'playwright-chromium',
} as const;

export const WEB_WORKER_SEARCH_PROVIDER_ENDPOINTS = {
  duckDuckGoHtml: 'https://duckduckgo.com/html/',
  bing: 'https://www.bing.com/search',
  arxivApi: 'https://export.arxiv.org/api/query',
  europePmc: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
  crossref: 'https://api.crossref.org/works',
} as const;
