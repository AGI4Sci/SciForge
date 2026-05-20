export const PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID = 'playwright_browser_automation' as const;
export const PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID = 'sciforge.observe.playwright-browser-mcp' as const;
export const PLAYWRIGHT_BROWSER_MCP_SERVER_NAME = 'playwright-browser' as const;
export const PLAYWRIGHT_BROWSER_MCP_PACKAGE = '@playwright/mcp@latest' as const;
export const PLAYWRIGHT_BROWSER_MCP_DEFAULT_BROWSER = 'msedge' as const;
export const PLAYWRIGHT_BROWSER_MCP_DEFAULT_VIEWPORT = '1440x900' as const;

export type PlaywrightBrowserMcpBrowser = 'chrome' | 'firefox' | 'webkit' | 'msedge';

export interface PlaywrightBrowserMcpPathOptions {
  homeDir?: string;
  instanceId?: string;
  userDataDir?: string;
  outputDir?: string;
}

export interface PlaywrightBrowserMcpServerOptions extends PlaywrightBrowserMcpPathOptions {
  serverName?: string;
  command?: string;
  browser?: PlaywrightBrowserMcpBrowser;
  viewportSize?: string;
  port?: number;
  host?: string;
  headless?: boolean;
  isolated?: boolean;
  sharedBrowserContext?: boolean;
  storageState?: string;
  allowedHosts?: string[];
  blockedOrigins?: string[];
  extraArgs?: string[];
}

export interface PlaywrightBrowserMcpServerConfig {
  command: string;
  args: string[];
}

export interface PlaywrightBrowserMcpServersConfig {
  mcpServers: Record<string, PlaywrightBrowserMcpServerConfig>;
}

export interface PlaywrightBrowserMcpProviderAvailabilityOptions extends PlaywrightBrowserMcpServerOptions {
  providerId?: string;
  capabilityId?: string;
  available?: boolean;
  status?: 'available' | 'ready' | 'offline' | 'provider-unavailable' | 'unauthorized' | 'rate-limited';
  reason?: string;
  url?: string;
}

export function playwrightBrowserMcpServerName(options: Pick<PlaywrightBrowserMcpServerOptions, 'serverName' | 'instanceId'> = {}) {
  if (options.serverName?.trim()) return options.serverName.trim();
  const instance = safeProfileSegment(options.instanceId);
  return instance ? `${PLAYWRIGHT_BROWSER_MCP_SERVER_NAME}-${instance}` : PLAYWRIGHT_BROWSER_MCP_SERVER_NAME;
}

export function playwrightBrowserMcpUserDataDir(options: PlaywrightBrowserMcpPathOptions = {}) {
  if (options.userDataDir?.trim()) return options.userDataDir.trim();
  const suffix = safeProfileSegment(options.instanceId);
  return joinPath(options.homeDir ?? defaultHomeDir(), suffix ? `.pw-mcp-browser-profile-${suffix}` : '.pw-mcp-browser-profile');
}

export function playwrightBrowserMcpOutputDir(options: PlaywrightBrowserMcpPathOptions = {}) {
  if (options.outputDir?.trim()) return options.outputDir.trim();
  const suffix = safeProfileSegment(options.instanceId);
  return suffix
    ? joinPath(options.homeDir ?? defaultHomeDir(), '.pw-mcp-browser-output', suffix)
    : joinPath(options.homeDir ?? defaultHomeDir(), '.pw-mcp-browser-output');
}

export function buildPlaywrightBrowserMcpServerConfig(options: PlaywrightBrowserMcpServerOptions = {}): PlaywrightBrowserMcpServerConfig {
  const isolated = options.isolated ?? true;
  const args = [
    PLAYWRIGHT_BROWSER_MCP_PACKAGE,
    `--browser=${options.browser ?? PLAYWRIGHT_BROWSER_MCP_DEFAULT_BROWSER}`,
    `--viewport-size=${options.viewportSize ?? PLAYWRIGHT_BROWSER_MCP_DEFAULT_VIEWPORT}`,
    `--output-dir=${playwrightBrowserMcpOutputDir(options)}`,
  ];
  if (options.headless !== false) args.push('--headless');
  if (isolated) {
    args.push('--isolated');
  } else {
    args.push(`--user-data-dir=${playwrightBrowserMcpUserDataDir(options)}`);
  }
  if (options.port !== undefined) args.push(`--port=${options.port}`);
  if (options.host?.trim()) args.push(`--host=${options.host.trim()}`);
  if (options.sharedBrowserContext === true) args.push('--shared-browser-context');
  if (options.storageState?.trim()) args.push(`--storage-state=${options.storageState.trim()}`);
  if (options.allowedHosts?.length) args.push(`--allowed-hosts=${options.allowedHosts.join(',')}`);
  if (options.blockedOrigins?.length) args.push(`--blocked-origins=${options.blockedOrigins.join(';')}`);
  args.push(...(options.extraArgs ?? []));
  return {
    command: options.command ?? 'npx',
    args,
  };
}

export function buildPlaywrightBrowserMcpServersConfig(options: PlaywrightBrowserMcpServerOptions = {}): PlaywrightBrowserMcpServersConfig {
  return {
    mcpServers: {
      [playwrightBrowserMcpServerName(options)]: buildPlaywrightBrowserMcpServerConfig(options),
    },
  };
}

export function buildParallelPlaywrightBrowserMcpServersConfig(
  instances: string[],
  options: Omit<PlaywrightBrowserMcpServerOptions, 'instanceId' | 'serverName' | 'port'> & { portBase?: number } = {},
): PlaywrightBrowserMcpServersConfig {
  const mcpServers: PlaywrightBrowserMcpServersConfig['mcpServers'] = {};
  instances.forEach((instanceId, index) => {
    const port = options.portBase === undefined ? undefined : options.portBase + index;
    const serverName = playwrightBrowserMcpServerName({ instanceId });
    mcpServers[serverName] = buildPlaywrightBrowserMcpServerConfig({ ...options, instanceId, serverName, port });
  });
  return { mcpServers };
}

export function playwrightBrowserMcpHttpUrl(port = 8933, host = 'localhost') {
  return `http://${host}:${port}/mcp`;
}

export function buildPlaywrightBrowserMcpProviderAvailability(options: PlaywrightBrowserMcpProviderAvailabilityOptions = {}) {
  const status = options.status ?? (options.available === false ? 'provider-unavailable' : 'available');
  const available = options.available ?? (status === 'available' || status === 'ready');
  return {
    id: options.providerId ?? PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
    providerId: options.providerId ?? PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
    capabilityId: options.capabilityId ?? PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
    source: 'mcp',
    transport: 'mcp',
    mcpServer: playwrightBrowserMcpServerName(options),
    url: options.url ?? (options.port === undefined ? undefined : playwrightBrowserMcpHttpUrl(options.port)),
    available,
    status,
    reason: options.reason ?? (available ? 'Headless Playwright MCP browser is configured.' : 'Headless Playwright MCP browser is not available.'),
  };
}

export function buildPlaywrightBrowserMcpToolProviderRoutes(options: PlaywrightBrowserMcpProviderAvailabilityOptions = {}) {
  const providerId = options.providerId ?? PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID;
  const status = options.status ?? (options.available === false ? 'provider-unavailable' : 'available');
  return {
    [PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID]: {
      enabled: true,
      capabilityId: PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
      source: 'mcp',
      primaryProviderId: providerId,
      health: status,
      url: options.url ?? (options.port === undefined ? undefined : playwrightBrowserMcpHttpUrl(options.port)),
    },
  };
}

export function buildPlaywrightBrowserMcpCodexTomlSnippet(options: PlaywrightBrowserMcpServerOptions = {}) {
  const serverName = playwrightBrowserMcpServerName(options);
  const config = buildPlaywrightBrowserMcpServerConfig(options);
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(config.command)}`,
    `args = ${JSON.stringify(config.args)}`,
  ].join('\n');
}

function safeProfileSegment(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ?? '';
}

function defaultHomeDir() {
  return typeof process !== 'undefined' && process.env?.HOME ? process.env.HOME : '~';
}

function joinPath(...parts: string[]) {
  const [first = '', ...rest] = parts;
  return rest.reduce((acc, part) => `${acc.replace(/\/+$/, '')}/${part.replace(/^\/+/, '')}`, first);
}
