import { normalizeBrowserWorkbenchUrl as normalizePresentationBrowserWorkbenchUrl } from '../../../../packages/presentation/components';

export const DEFAULT_BROWSER_WORKBENCH_URL = 'about:blank';

export function cleanBrowserWorkbenchUrlInput(input: string): string {
  const trimmed = input.trim();
  if (/^about:blank$/i.test(trimmed)) return DEFAULT_BROWSER_WORKBENCH_URL;
  if (/about:blank$/i.test(trimmed)) return trimmed.slice(0, -'about:blank'.length).trim();
  return trimmed;
}

export function normalizeBrowserWorkbenchUrl(input: string): string {
  return normalizePresentationBrowserWorkbenchUrl(cleanBrowserWorkbenchUrlInput(input));
}

export function shouldProxyBrowserWorkbenchUrl(url: string): boolean {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  if (!/^https?:\/\//i.test(cleanUrl)) return false;
  if (shouldUseBrowserWorkbenchPdfViewerUrl(cleanUrl)) return true;
  return shouldProxyBrowserWorkbenchHtmlUrl(cleanUrl);
}

export function shouldUseBrowserWorkbenchPdfViewerUrl(url: string): boolean {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  return /^https?:\/\//i.test(cleanUrl) && /(?:\.pdf(?:[?#].*)?$|\/pdf\/|arxiv\.org\/pdf\/)/i.test(cleanUrl);
}

export function shouldProxyBrowserWorkbenchHtmlUrl(url: string): boolean {
  try {
    const target = new URL(cleanBrowserWorkbenchUrlInput(url));
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    return !browserWorkbenchUrlIsLocal(target);
  } catch {
    return false;
  }
}

export function buildBrowserWorkbenchProxyUrl(url: string, options: { download?: boolean } = {}): string {
  const params = new URLSearchParams({ url: cleanBrowserWorkbenchUrlInput(url) });
  if (options.download) params.set('download', '1');
  return `/api/sciforge/browser/proxy?${params.toString()}`;
}

export function buildBrowserWorkbenchPdfViewerUrl(url: string): string {
  const params = new URLSearchParams({ url: cleanBrowserWorkbenchUrlInput(url) });
  return `/api/sciforge/browser/pdf-viewer?${params.toString()}`;
}

export function buildBrowserPreviewUrl(url: string): string {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  if (shouldUseBrowserWorkbenchPdfViewerUrl(cleanUrl)) return buildBrowserWorkbenchPdfViewerUrl(cleanUrl);
  if (shouldProxyBrowserWorkbenchHtmlUrl(cleanUrl)) return buildBrowserWorkbenchProxyUrl(cleanUrl);
  return cleanUrl;
}

export function browserWorkbenchSourceUrlFromPreviewUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'http://127.0.0.1:5173');
    if (parsed.pathname !== '/api/sciforge/browser/proxy' && parsed.pathname !== '/api/sciforge/browser/pdf-viewer') return undefined;
    const source = parsed.searchParams.get('url');
    return source ? cleanBrowserWorkbenchUrlInput(source) : undefined;
  } catch {
    return undefined;
  }
}

export function browserPreviewSandboxForUrl(url: string): string | undefined {
  if (shouldUseBrowserWorkbenchPdfViewerUrl(url)) return undefined;
  if (shouldProxyBrowserWorkbenchHtmlUrl(url)) return 'allow-downloads allow-forms allow-same-origin';
  return 'allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation';
}

export function browserWorkbenchUrlIsLocal(parsed: URL) {
  return /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname);
}
