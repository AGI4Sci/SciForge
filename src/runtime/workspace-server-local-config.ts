import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeWorkspaceRootPath } from './workspace-paths.js';
import {
  DEFAULT_PROXY_BASE_URL,
  ensureRuntimeHome,
} from '../../packages/backend/src/runtime-home.js';
import { resolveProxyCliOptions } from '../../packages/backend/src/cli-config.js';
import {
  computerUseWorkspaceEnvFromLocalSettings,
  localProviderSettings,
} from '../../packages/backend/src/local-provider-config.js';
import { startCodexResponsesProxyServer, type StartedCodexResponsesProxy } from '../../packages/backend/src/proxy.js';
import { runtimeProviderProxyBaseUrl as normalizeRuntimeProviderProxyBaseUrl } from './workspace-server-runtime-provider-preflight.js';

export type WorkspacePeerInstanceRole = 'main' | 'repair' | 'peer';
export type WorkspacePeerInstanceTrustLevel = 'readonly' | 'repair' | 'sync';

export interface WorkspacePeerInstanceConfig {
  name: string;
  appUrl: string;
  workspaceWriterUrl: string;
  workspacePath: string;
  role: WorkspacePeerInstanceRole;
  trustLevel: WorkspacePeerInstanceTrustLevel;
  enabled: boolean;
}

export type ToolProviderRouteConfig = Record<string, unknown>;
export type ToolProviderRoutesConfig = Record<string, ToolProviderRouteConfig>;

const TOOL_PROVIDER_SOURCES = new Set([
  'local',
  'agentserver',
  'mcp',
  'http',
  'ssh',
  'client-worker',
  'backend-native',
  'package',
  'workspace',
  'external',
]);

const TOOL_PROVIDER_HEALTH_STATES = new Set([
  'ready',
  'unknown',
  'unavailable',
  'unauthorized',
  'rate-limited',
]);

export function preserveConfiguredSecretString(nextValue: unknown, currentValue: unknown) {
  const current = typeof currentValue === 'string' ? currentValue : '';
  if (typeof nextValue !== 'string') return current;
  const next = nextValue.trim();
  if (/^\u2022\u2022\u2022\u2022/.test(next)) return current;
  if (!next && current.trim()) return current;
  return nextValue;
}

export function configuredString(nextValue: unknown, currentValue: unknown) {
  if (typeof nextValue === 'string') return nextValue.trim();
  return typeof currentValue === 'string' ? currentValue.trim() : '';
}

export function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseJsonEnv(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function normalizePeerInstances(value: unknown): WorkspacePeerInstanceConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      appUrl: cleanUrlString(item.appUrl),
      workspaceWriterUrl: cleanUrlString(item.workspaceWriterUrl),
      workspacePath: normalizeWorkspaceRootPath(typeof item.workspacePath === 'string' ? item.workspacePath : ''),
      role: item.role === 'main' || item.role === 'repair' || item.role === 'peer' ? item.role : 'peer',
      trustLevel: item.trustLevel === 'readonly' || item.trustLevel === 'repair' || item.trustLevel === 'sync' ? item.trustLevel : 'readonly',
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    }));
}

export function repairPeerInstancesFromCounterpartJson(counterpartJson: string | undefined): WorkspacePeerInstanceConfig[] {
  const counterpart = parseJsonEnv(counterpartJson);
  if (!isRecord(counterpart)) return [];
  const workspaceWriterUrl = cleanUrlString(counterpart.workspaceWriterUrl);
  if (!workspaceWriterUrl) return [];
  return [{
    name: stringValue(counterpart.agentId) || stringValue(counterpart.name) || 'counterpart',
    appUrl: cleanUrlString(counterpart.appUrl),
    workspaceWriterUrl,
    workspacePath: normalizeWorkspaceRootPath(stringValue(counterpart.workspacePath)),
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }];
}

export function normalizeConfiguredPeerInstances(value: unknown, counterpartJson?: string): WorkspacePeerInstanceConfig[] {
  return Array.isArray(value)
    ? normalizePeerInstances(value)
    : repairPeerInstancesFromCounterpartJson(counterpartJson);
}

export function normalizeToolProviderRoutes(value: unknown): ToolProviderRoutesConfig | undefined {
  if (!isRecord(value)) return undefined;
  const out: ToolProviderRoutesConfig = {};
  for (const [rawKey, rawRoute] of Object.entries(value)) {
    const routeKey = rawKey.trim();
    if (!routeKey || !isRecord(rawRoute)) continue;
    const route: ToolProviderRouteConfig = {};
    if (typeof rawRoute.enabled === 'boolean') route.enabled = rawRoute.enabled;
    if (typeof rawRoute.capabilityId === 'string' && rawRoute.capabilityId.trim()) route.capabilityId = rawRoute.capabilityId.trim();
    const source = typeof rawRoute.source === 'string' ? rawRoute.source.trim() : '';
    if (TOOL_PROVIDER_SOURCES.has(source)) route.source = source;
    if (typeof rawRoute.primaryProviderId === 'string' && rawRoute.primaryProviderId.trim()) route.primaryProviderId = rawRoute.primaryProviderId.trim();
    const fallbackProviderIds = stringArray(rawRoute.fallbackProviderIds);
    if (fallbackProviderIds.length) route.fallbackProviderIds = fallbackProviderIds;
    const permissions = stringArray(rawRoute.permissions);
    if (permissions.length) route.permissions = permissions;
    const requiredConfig = stringArray(rawRoute.requiredConfig);
    if (requiredConfig.length) route.requiredConfig = requiredConfig;
    const health = typeof rawRoute.health === 'string' ? rawRoute.health.trim() : '';
    if (TOOL_PROVIDER_HEALTH_STATES.has(health)) route.health = health;
    for (const keyName of ['endpoint', 'baseUrl', 'url', 'invokeUrl', 'invokePath'] as const) {
      const routeValue = rawRoute[keyName];
      if (typeof routeValue === 'string' && routeValue.trim()) route[keyName] = routeValue.trim().replace(/\/+$/, '');
    }
    if (typeof rawRoute.timeoutMs === 'number' && Number.isFinite(rawRoute.timeoutMs)) route.timeoutMs = Math.max(1_000, Math.trunc(rawRoute.timeoutMs));
    if (Object.keys(route).length) out[routeKey] = route;
  }
  return Object.keys(out).length ? out : undefined;
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())));
}

export function cleanUrlString(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

export interface WorkspaceLocalConfigServiceOptions {
  configLocalPath: string;
  runtimeCodexPort: number;
  workspaceWriterPort: number;
  defaultWorkspacePath: string;
  defaultProxyBaseUrl?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function createWorkspaceLocalConfigService(options: WorkspaceLocalConfigServiceOptions) {
  let managedRuntimeProviderProxy: Promise<StartedCodexResponsesProxy | undefined> | undefined;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const defaultProxyBaseUrl = options.defaultProxyBaseUrl ?? DEFAULT_PROXY_BASE_URL;

  async function readLocalSciForgeConfig() {
    const parsed = await readConfigLocalJson();
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
    const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
    const agentServerBaseUrl = env.SCIFORGE_AGENT_SERVER_URL
      || (typeof sciforge.agentServerBaseUrl === 'string' ? sciforge.agentServerBaseUrl : `http://127.0.0.1:${options.runtimeCodexPort}`);
    const runtimeCodexBaseUrl = env.SCIFORGE_RUNTIME_CODEX_URL
      || (typeof sciforge.runtimeCodexBaseUrl === 'string' ? sciforge.runtimeCodexBaseUrl : `http://127.0.0.1:${options.runtimeCodexPort}`);
    const workspaceWriterBaseUrl = env.SCIFORGE_WORKSPACE_WRITER_URL
      || (typeof sciforge.workspaceWriterBaseUrl === 'string' ? sciforge.workspaceWriterBaseUrl : `http://127.0.0.1:${options.workspaceWriterPort}`);
    const workspacePath = env.SCIFORGE_WORKSPACE_PATH
      || (typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : options.defaultWorkspacePath);
    return {
      schemaVersion: 1,
      agentServerBaseUrl,
      runtimeCodexBaseUrl,
      workspaceWriterBaseUrl,
      workspacePath: normalizeWorkspaceRootPath(resolve(workspacePath)),
      peerInstances: normalizeConfiguredPeerInstances(sciforge.peerInstances, env.SCIFORGE_COUNTERPART_JSON),
      modelProvider: typeof llm.provider === 'string' ? llm.provider : 'native',
      modelBaseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl.replace(/\/+$/, '') : '',
      modelName: typeof llm.model === 'string' ? llm.model : typeof llm.modelName === 'string' ? llm.modelName : '',
      apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
      requestTimeoutMs: typeof sciforge.requestTimeoutMs === 'number' ? sciforge.requestTimeoutMs : 900000,
      feedbackGithubRepo: typeof sciforge.feedbackGithubRepo === 'string' ? sciforge.feedbackGithubRepo : undefined,
      feedbackGithubToken: typeof sciforge.feedbackGithubToken === 'string' ? sciforge.feedbackGithubToken : undefined,
      feedbackGithubLabels: Array.isArray(sciforge.feedbackGithubLabels) ? sciforge.feedbackGithubLabels.filter((item): item is string => typeof item === 'string') : undefined,
      feedbackGithubAssignees: Array.isArray(sciforge.feedbackGithubAssignees) ? sciforge.feedbackGithubAssignees.filter((item): item is string => typeof item === 'string') : undefined,
      feedbackGithubMilestone: typeof sciforge.feedbackGithubMilestone === 'number' || typeof sciforge.feedbackGithubMilestone === 'string' ? sciforge.feedbackGithubMilestone : undefined,
      feedbackGithubDryRun: sciforge.feedbackGithubDryRun === true,
      visionAllowSharedSystemInput: typeof visionSense.allowSharedSystemInput === 'boolean' ? visionSense.allowSharedSystemInput : true,
      toolProviderRoutes: normalizeToolProviderRoutes(sciforge.toolProviderRoutes),
      updatedAt: typeof sciforge.updatedAt === 'string' ? sciforge.updatedAt : new Date().toISOString(),
      source: 'config.local.json',
    };
  }

  async function writeLocalSciForgeConfig(config: Record<string, unknown>) {
    const parsed = await readConfigLocalJson();
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
    const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
    const codexProxy = isRecord(parsed.codexProxy) ? parsed.codexProxy : {};
    const { runtimeCodexBaseUrl: _discardRuntimeCodexBaseUrl, ...storedSciforge } = sciforge;
    void _discardRuntimeCodexBaseUrl;
    const next = {
      ...parsed,
      llm: {
        ...llm,
        provider: typeof config.modelProvider === 'string' ? config.modelProvider : llm.provider,
        baseUrl: configuredString(config.modelBaseUrl, llm.baseUrl).replace(/\/+$/, ''),
        apiKey: preserveConfiguredSecretString(config.apiKey, llm.apiKey),
        model: preserveConfiguredSecretString(config.modelName, llm.model),
      },
      codexProxy: {
        ...codexProxy,
        upstreamBaseUrl: configuredString(config.modelBaseUrl, codexProxy.upstreamBaseUrl ?? llm.baseUrl).replace(/\/+$/, ''),
        apiKey: preserveConfiguredSecretString(config.apiKey, codexProxy.apiKey ?? llm.apiKey),
        defaultModel: preserveConfiguredSecretString(config.modelName, codexProxy.defaultModel ?? llm.model),
      },
      sciforge: {
        ...storedSciforge,
        agentServerBaseUrl: typeof config.agentServerBaseUrl === 'string' ? config.agentServerBaseUrl : sciforge.agentServerBaseUrl,
        workspaceWriterBaseUrl: typeof config.workspaceWriterBaseUrl === 'string' ? config.workspaceWriterBaseUrl : sciforge.workspaceWriterBaseUrl,
        workspacePath: normalizeWorkspaceRootPath(resolve(typeof config.workspacePath === 'string' ? config.workspacePath : typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : '')),
        peerInstances: Array.isArray(config.peerInstances) ? normalizePeerInstances(config.peerInstances) : normalizePeerInstances(sciforge.peerInstances),
        requestTimeoutMs: typeof config.requestTimeoutMs === 'number' ? config.requestTimeoutMs : sciforge.requestTimeoutMs,
        feedbackGithubRepo: typeof config.feedbackGithubRepo === 'string' ? config.feedbackGithubRepo : sciforge.feedbackGithubRepo,
        feedbackGithubToken: preserveConfiguredSecretString(config.feedbackGithubToken, sciforge.feedbackGithubToken),
        feedbackGithubLabels: Array.isArray(config.feedbackGithubLabels) ? uniqueStrings(config.feedbackGithubLabels.filter((item): item is string => typeof item === 'string')) : sciforge.feedbackGithubLabels,
        feedbackGithubAssignees: Array.isArray(config.feedbackGithubAssignees) ? uniqueStrings(config.feedbackGithubAssignees.filter((item): item is string => typeof item === 'string')) : sciforge.feedbackGithubAssignees,
        feedbackGithubMilestone: typeof config.feedbackGithubMilestone === 'number' || typeof config.feedbackGithubMilestone === 'string' ? config.feedbackGithubMilestone : sciforge.feedbackGithubMilestone,
        feedbackGithubDryRun: typeof config.feedbackGithubDryRun === 'boolean' ? config.feedbackGithubDryRun : sciforge.feedbackGithubDryRun === true,
        toolProviderRoutes: isRecord(config.toolProviderRoutes)
          ? normalizeToolProviderRoutes(config.toolProviderRoutes)
          : normalizeToolProviderRoutes(sciforge.toolProviderRoutes),
        updatedAt: new Date().toISOString(),
      },
      visionSense: {
        ...visionSense,
        allowSharedSystemInput: typeof config.visionAllowSharedSystemInput === 'boolean'
          ? config.visionAllowSharedSystemInput
          : typeof visionSense.allowSharedSystemInput === 'boolean'
            ? visionSense.allowSharedSystemInput
            : true,
      },
    };
    await mkdir(dirname(options.configLocalPath), { recursive: true });
    await writeFile(options.configLocalPath, JSON.stringify(next, null, 2));
    await prepareRuntimeCodexEnvFromLocalConfig(next);
  }

  async function prepareRuntimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
    const runtimeEnv = await runtimeCodexEnvFromLocalConfig(configuredLocalConfig);
    const proxyBaseUrl = await ensureRuntimeProviderProxy(runtimeEnv);
    await syncRuntimeCodexHomeFromLocalConfig(runtimeEnv, proxyBaseUrl);
    return runtimeEnv;
  }

  async function syncRuntimeCodexHomeFromLocalConfig(runtimeEnv: NodeJS.ProcessEnv = env, proxyBaseUrl = runtimeCodexProxyBaseUrl(runtimeEnv)) {
    await ensureRuntimeHome({
      proxyBaseUrl,
      provider: runtimeEnv.SCIFORGE_RUNTIME_PROVIDER,
      model: runtimeEnv.SCIFORGE_RUNTIME_MODEL,
      overwrite: true,
    });
  }

  async function runtimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
    const localConfig = configuredLocalConfig ?? await readConfigLocalJson();
    const settings = localProviderSettings(localConfig);
    return {
      ...env,
      SCIFORGE_CONFIG_PATH: options.configLocalPath,
      ...computerUseWorkspaceEnvFromLocalSettings(settings),
    };
  }

  async function ensureRuntimeProviderProxy(runtimeEnv: NodeJS.ProcessEnv): Promise<string> {
    const configuredProxyBaseUrl = runtimeProviderProxyBaseUrl(runtimeEnv);
    if (await runtimeProviderProxyLocalReady(configuredProxyBaseUrl)) return runtimeCodexProxyBaseUrl(runtimeEnv);

    if (!managedRuntimeProviderProxy) {
      managedRuntimeProviderProxy = startManagedRuntimeProviderProxy(runtimeEnv).catch((error) => {
        managedRuntimeProviderProxy = undefined;
        throw error;
      });
    }
    const proxy = await managedRuntimeProviderProxy;
    if (!proxy) return runtimeCodexProxyBaseUrl(runtimeEnv);
    runtimeEnv.SCIFORGE_PROXY_BASE_URL = proxy.url;
    runtimeEnv.SCIFORGE_PROXY_PORT = String(proxy.port);
    return `${proxy.url.replace(/\/+$/, '')}/v1`;
  }

  async function startManagedRuntimeProviderProxy(runtimeEnv: NodeJS.ProcessEnv): Promise<StartedCodexResponsesProxy | undefined> {
    const options = resolveProxyCliOptions([], runtimeEnv);
    try {
      const proxy = await startCodexResponsesProxyServer({
        host: options.host,
        port: options.port,
        upstreamBaseUrl: options.upstreamBaseUrl,
        upstreamApiKey: options.upstreamApiKey,
        defaultModel: options.defaultModel,
        forceNonStreamingUpstream: options.forceNonStreamingUpstream,
        resolveDynamicOptions: () => {
          const latest = resolveProxyCliOptions([], {
            ...env,
            SCIFORGE_CONFIG_PATH: configLocalPath(),
          });
          return {
            upstreamBaseUrl: latest.upstreamBaseUrl,
            upstreamApiKey: latest.upstreamApiKey,
            defaultModel: latest.defaultModel,
            forceNonStreamingUpstream: latest.forceNonStreamingUpstream,
          };
        },
        log: (message) => console.error(`[sciforge-managed-codex-proxy] ${message}`),
      });
      console.log(`SciForge managed Codex Responses proxy: ${proxy.url}/v1`);
      return proxy;
    } catch (error) {
      if (isAddrInUse(error) && await runtimeProviderProxyLocalReady(runtimeProviderProxyBaseUrl(runtimeEnv))) return undefined;
      throw error;
    }
  }

  async function runtimeProviderProxyLocalReady(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(900) });
      const parsed = await response.json().catch(() => ({}));
      return response.ok && isRecord(parsed) && typeof parsed.upstreamBaseUrl === 'string';
    } catch {
      return false;
    }
  }

  function runtimeCodexProxyBaseUrl(runtimeEnv: NodeJS.ProcessEnv): string {
    const proxyBase = runtimeProviderProxyBaseUrl(runtimeEnv);
    return proxyBase.endsWith('/v1') ? proxyBase : `${proxyBase}/v1`;
  }

  function runtimeProviderProxyBaseUrl(runtimeEnv: NodeJS.ProcessEnv) {
    return normalizeRuntimeProviderProxyBaseUrl(runtimeEnv, defaultProxyBaseUrl);
  }

  async function readConfigLocalJson(): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(configLocalPath(), 'utf8'));
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function configLocalPath() {
    return options.configLocalPath;
  }

  void cwd;
  return {
    readLocalSciForgeConfig,
    writeLocalSciForgeConfig,
    prepareRuntimeCodexEnvFromLocalConfig,
    runtimeCodexEnvFromLocalConfig,
    syncRuntimeCodexHomeFromLocalConfig,
    runtimeProviderProxyBaseUrl,
    configLocalPath,
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isAddrInUse(error: unknown): boolean {
  return isRecord(error) && error.code === 'EADDRINUSE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
