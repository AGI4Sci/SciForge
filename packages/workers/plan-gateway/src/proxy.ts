const PROXY_DIRECTIVE = /^(DIRECT|PROXY|HTTPS|SOCKS5|SOCKS4|SOCKS)\s*(.*)$/i;

export const PLAN_GATEWAY_PROXY_RULES_ENV = 'SCIFORGE_PLAN_GATEWAY_PROXY_RULES';

export function proxyUrlFromRules(value: string | undefined): string {
  const rules = value?.trim();
  if (!rules) return '';

  for (const candidate of rules.split(';').map((entry) => entry.trim()).filter(Boolean)) {
    const asUrl = normalizedProxyUrl(candidate);
    if (asUrl !== undefined) return asUrl;

    const directive = PROXY_DIRECTIVE.exec(candidate);
    if (!directive) continue;
    const kind = directive[1].toUpperCase();
    if (kind === 'DIRECT') return '';
    const authority = directive[2].trim();
    if (!authority) continue;
    const protocol = kind === 'PROXY'
      ? 'http'
      : kind === 'HTTPS'
        ? 'https'
        : kind === 'SOCKS4'
          ? 'socks4a'
          : 'socks5h';
    const normalized = normalizedProxyUrl(`${protocol}://${authority}`);
    if (normalized !== undefined) return normalized;
  }

  return '';
}

function normalizedProxyUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol)) {
    return undefined;
  }
  return url.toString();
}
