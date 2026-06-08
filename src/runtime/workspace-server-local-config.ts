import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizeWorkspaceRootPath } from './workspace-paths.js';
import {
  DEFAULT_PROXY_BASE_URL,
  ensureRuntimeHome,
  RUNTIME_MODEL,
  RUNTIME_PROVIDER,
} from '../../packages/backend/src/runtime-home.js';
import {
  computerUseWorkspaceEnvFromLocalSettings,
  localProviderSettings,
  readLocalProviderSettings,
  readRequiredLocalProviderSettings,
  type LocalProviderSettings,
} from '../../packages/backend/src/local-provider-config.js';
import {
  startModelRouterServer,
  type ModelRouterConfig,
  type StartedModelRouterServer,
} from '../../packages/workers/model-router/src/router.js';
import { runtimeProviderProxyBaseUrl as normalizeModelRouterBaseUrl } from './workspace-server-runtime-provider-preflight.js';

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

export function isSciForgeModelRouterHealth(value: unknown) {
  if (!isRecord(value)) return false;
  return value.service === 'sciforge.model-router';
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
  let managedModelRouter: Promise<StartedModelRouterServer | undefined> | undefined;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const defaultProxyBaseUrl = options.defaultProxyBaseUrl ?? DEFAULT_PROXY_BASE_URL;
  const runtimeLlmConfigPath = resolve(env.SCIFORGE_CONFIG_PATH?.trim() || join(cwd, 'config.local.json'));

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
    const { codexProxy: _discardCodexProxy, runtimeCodexProxy: _discardRuntimeCodexProxy, ...storedParsed } = parsed;
    const { runtimeCodexBaseUrl: _discardRuntimeCodexBaseUrl, ...storedSciforge } = sciforge;
    void _discardCodexProxy;
    void _discardRuntimeCodexProxy;
    void _discardRuntimeCodexBaseUrl;
    const next = {
      ...storedParsed,
      llm: {
        ...llm,
        provider: typeof config.modelProvider === 'string' ? config.modelProvider : llm.provider,
        baseUrl: configuredString(config.modelBaseUrl, llm.baseUrl).replace(/\/+$/, ''),
        apiKey: preserveConfiguredSecretString(config.apiKey, llm.apiKey),
        model: preserveConfiguredSecretString(config.modelName, llm.model),
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
    const modelRouterOpenAiBaseUrl = await ensureRuntimeModelRouter(runtimeEnv);
    await syncRuntimeCodexHomeFromLocalConfig(runtimeEnv, modelRouterOpenAiBaseUrl);
    return runtimeEnv;
  }

  async function syncRuntimeCodexHomeFromLocalConfig(runtimeEnv: NodeJS.ProcessEnv = env, proxyBaseUrl = runtimeCodexModelRouterBaseUrl(runtimeEnv)) {
    await ensureRuntimeHome({
      proxyBaseUrl,
      provider: RUNTIME_PROVIDER,
      model: RUNTIME_MODEL,
      overwrite: true,
      paths: { env: runtimeEnv },
    });
  }

  async function runtimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
    const loadedSettings = configuredLocalConfig
      ? localProviderSettings(configuredLocalConfig, { configPath: runtimeLlmConfigLocalPath() })
      : isDesktopSidecarEnv(env)
        ? readLocalProviderSettings(runtimeLlmConfigLocalPath())
      : readRequiredLocalProviderSettings(runtimeLlmConfigLocalPath());
    const settings = completeDesktopSidecarLocalProviderSettings(loadedSettings, env);
    if (!isCompleteLocalProviderSettings(settings)) {
      const routerOnlyEnv = desktopSidecarRouterOnlyRuntimeEnv(settings);
      if (routerOnlyEnv) return routerOnlyEnv;
    }
    assertCompleteLocalProviderSettings(settings, runtimeLlmConfigLocalPath());
    const localEnv = workspaceComputerUseEnv(settings, env);
    const upstreamBaseUrl = settings.baseUrl!;
    const upstreamModel = settings.model!;
    const upstreamApiKey = settings.apiKey!;
    const visionModel = settings.visionModel;
    const visionBaseUrl = visionModel ? settings.visionBaseUrl ?? upstreamBaseUrl : undefined;
    const visionApiKey = visionModel ? settings.visionApiKey ?? upstreamApiKey : undefined;
    const visionProvider = visionModel ? settings.visionProvider ?? settings.provider : undefined;
    const modelRouterBaseUrl = modelRouterBaseUrlFromEnv(env);
    const modelRouterOpenAiBaseUrl = `${modelRouterBaseUrl.replace(/\/+$/, '')}/v1`;
    const runtimeApiKey = runtimeCodexRouterApiKey(env);
    return stripLegacyRuntimeDirectEnv({
      ...env,
      SCIFORGE_CONFIG_PATH: runtimeLlmConfigLocalPath(),
      ...localEnv,
      ...(settings.provider ? {
        SCIFORGE_TEXT_PROVIDER: settings.provider,
      } : {}),
      ...(visionProvider ? { SCIFORGE_VISION_PROVIDER: visionProvider } : {}),
      SCIFORGE_RUNTIME_API_KEY: runtimeApiKey,
      SCIFORGE_RUNTIME_BASE_URL: undefined,
      SCIFORGE_PROXY_BASE_URL: undefined,
      SCIFORGE_PROXY_PORT: undefined,
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: undefined,
      SCIFORGE_PROXY_DEFAULT_MODEL: undefined,
      SCIFORGE_MODEL_ROUTER_API_KEY: runtimeApiKey,
      SCIFORGE_MODEL_ROUTER_BASE_URL: modelRouterOpenAiBaseUrl,
      SCIFORGE_TEXT_BASE_URL: upstreamBaseUrl,
      SCIFORGE_TEXT_MODEL: upstreamModel,
      SCIFORGE_TEXT_API_KEY: upstreamApiKey,
      ...(visionBaseUrl ? { SCIFORGE_VISION_BASE_URL: visionBaseUrl } : {}),
      ...(visionModel ? { SCIFORGE_VISION_MODEL: visionModel } : {}),
      ...(visionApiKey ? { SCIFORGE_VISION_API_KEY: visionApiKey } : {}),
      SCIFORGE_RUNTIME_PROVIDER: RUNTIME_PROVIDER,
      SCIFORGE_RUNTIME_MODEL: RUNTIME_MODEL,
      SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: RUNTIME_MODEL,
    });
  }

  function desktopSidecarRouterOnlyRuntimeEnv(settings: LocalProviderSettings): NodeJS.ProcessEnv | undefined {
    if (!isDesktopSidecarEnv(env)) return undefined;
    if (!hasExplicitModelRouterEndpoint(env) || !hasExplicitModelRouterApiKey(env)) return undefined;
    const localEnv = workspaceComputerUseEnv(settings, env);
    const modelRouterBaseUrl = modelRouterBaseUrlFromEnv(env);
    const modelRouterOpenAiBaseUrl = `${modelRouterBaseUrl.replace(/\/+$/, '')}/v1`;
    const runtimeApiKey = runtimeCodexRouterApiKey(env);
    return stripLegacyRuntimeDirectEnv({
      ...env,
      SCIFORGE_CONFIG_PATH: runtimeLlmConfigLocalPath(),
      ...localEnv,
      SCIFORGE_RUNTIME_API_KEY: runtimeApiKey,
      SCIFORGE_RUNTIME_BASE_URL: undefined,
      SCIFORGE_PROXY_BASE_URL: undefined,
      SCIFORGE_PROXY_PORT: undefined,
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: undefined,
      SCIFORGE_PROXY_DEFAULT_MODEL: undefined,
      SCIFORGE_MODEL_ROUTER_API_KEY: runtimeApiKey,
      SCIFORGE_MODEL_ROUTER_BASE_URL: modelRouterOpenAiBaseUrl,
      SCIFORGE_TEXT_PROVIDER: undefined,
      SCIFORGE_TEXT_BASE_URL: undefined,
      SCIFORGE_TEXT_MODEL: undefined,
      SCIFORGE_TEXT_API_KEY: undefined,
      SCIFORGE_TEXT_API_KEY_ENV: undefined,
      SCIFORGE_VISION_PROVIDER: undefined,
      SCIFORGE_VISION_BASE_URL: undefined,
      SCIFORGE_VISION_MODEL: undefined,
      SCIFORGE_VISION_API_KEY: undefined,
      SCIFORGE_VISION_API_KEY_ENV: undefined,
      SCIFORGE_RUNTIME_PROVIDER: RUNTIME_PROVIDER,
      SCIFORGE_RUNTIME_MODEL: RUNTIME_MODEL,
      SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: RUNTIME_MODEL,
    });
  }

  async function ensureRuntimeModelRouter(runtimeEnv: NodeJS.ProcessEnv): Promise<string> {
    const configuredModelRouterBaseUrl = modelRouterBaseUrlFromEnv(runtimeEnv);
    if (await modelRouterLocalReady(configuredModelRouterBaseUrl)) return runtimeCodexModelRouterBaseUrl(runtimeEnv);
    if (isDesktopSidecarEnv(runtimeEnv) && hasExplicitModelRouterEndpoint(runtimeEnv)) {
      return runtimeCodexModelRouterBaseUrl(runtimeEnv);
    }

    if (!managedModelRouter) {
      managedModelRouter = startManagedModelRouter(runtimeEnv).catch((error) => {
        managedModelRouter = undefined;
        throw error;
      });
    }
    const proxy = await managedModelRouter;
    if (!proxy) return runtimeCodexModelRouterBaseUrl(runtimeEnv);
    const routerBaseUrl = publicModelRouterBaseUrl(proxy, runtimeEnv);
    runtimeEnv.SCIFORGE_MODEL_ROUTER_BASE_URL = `${routerBaseUrl.replace(/\/+$/, '')}/v1`;
    runtimeEnv.SCIFORGE_MODEL_ROUTER_PORT = String(proxy.port);
    return runtimeEnv.SCIFORGE_MODEL_ROUTER_BASE_URL;
  }

  async function startManagedModelRouter(runtimeEnv: NodeJS.ProcessEnv): Promise<StartedModelRouterServer | undefined> {
    const listen = modelRouterListenOptions(runtimeEnv, modelRouterBaseUrlFromEnv(runtimeEnv));
    try {
      const proxy = await startModelRouterServer({
        host: listen.host,
        port: listen.port,
        config: modelRouterConfigFromRuntimeEnv(runtimeEnv),
        env: runtimeEnv,
        workspaceRoot: normalizeWorkspaceRootPath(resolve(options.defaultWorkspacePath)),
        log: (message) => console.error(`[sciforge-managed-model-router] ${message}`),
      });
      console.log(`SciForge managed Model Router: ${publicModelRouterBaseUrl(proxy, runtimeEnv)}/v1`);
      return proxy;
    } catch (error) {
      if (isAddrInUse(error) && await modelRouterLocalReady(modelRouterBaseUrlFromEnv(runtimeEnv))) return undefined;
      throw error;
    }
  }

  async function closeManagedModelRouter() {
    const proxy = await managedModelRouter;
    managedModelRouter = undefined;
    await proxy?.close();
  }

  async function modelRouterLocalReady(baseUrl: string): Promise<boolean> {
    try {
      const legacy = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(900) });
      const parsed = await legacy.json().catch(() => ({}));
      if (legacy.ok && isSciForgeModelRouterHealth(parsed)) return true;
    } catch {
      // Try the Model Router health endpoint below.
    }
    try {
      const router = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(900) });
      const parsed = await router.json().catch(() => ({}));
      return router.ok && isSciForgeModelRouterHealth(parsed);
    } catch {
      return false;
    }
  }

  function runtimeCodexModelRouterBaseUrl(runtimeEnv: NodeJS.ProcessEnv): string {
    const proxyBase = modelRouterBaseUrlFromEnv(runtimeEnv);
    return proxyBase.endsWith('/v1') ? proxyBase : `${proxyBase}/v1`;
  }

  function modelRouterBaseUrlFromEnv(runtimeEnv: NodeJS.ProcessEnv) {
    const modelRouterBaseUrl = stringValue(runtimeEnv.SCIFORGE_MODEL_ROUTER_BASE_URL)
      || stringValue(runtimeEnv.SCIFORGE_MODEL_ROUTER_URL);
    if (modelRouterBaseUrl) {
      return normalizeModelRouterBaseUrl({ SCIFORGE_MODEL_ROUTER_BASE_URL: modelRouterBaseUrl }, defaultProxyBaseUrl);
    }
    const modelRouterPort = stringValue(runtimeEnv.SCIFORGE_MODEL_ROUTER_PORT);
    if (modelRouterPort) {
      return normalizeModelRouterBaseUrl({
        SCIFORGE_MODEL_ROUTER_HOST: runtimeEnv.SCIFORGE_MODEL_ROUTER_HOST,
        SCIFORGE_MODEL_ROUTER_PORT: modelRouterPort,
      }, defaultProxyBaseUrl);
    }
    return normalizeModelRouterBaseUrl({}, defaultProxyBaseUrl);
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

  function runtimeLlmConfigLocalPath() {
    return runtimeLlmConfigPath;
  }

  return {
    readLocalSciForgeConfig,
    writeLocalSciForgeConfig,
    prepareRuntimeCodexEnvFromLocalConfig,
    runtimeCodexEnvFromLocalConfig,
    syncRuntimeCodexHomeFromLocalConfig,
    closeManagedModelRouter,
    modelRouterBaseUrlFromEnv,
    configLocalPath,
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

const LOCAL_MEMBER_MODEL_RUNTIME_ALIAS_ENV_KEYS = new Set([
  'SCIFORGE_RUNTIME_API_KEY',
  'SCIFORGE_RUNTIME_BASE_URL',
  'SCIFORGE_RUNTIME_MODEL',
  'SCIFORGE_RUNTIME_PROVIDER',
]);

function stripLegacyRuntimeDirectEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    if (key === 'SCIFORGE_RUNTIME_BASE_URL' || key.startsWith('SCIFORGE_PROXY_')) delete env[key];
  }
  return env;
}

function runtimeCodexRouterApiKey(env: NodeJS.ProcessEnv) {
  return stringValue(env.SCIFORGE_MODEL_ROUTER_API_KEY)
    || stringValue(env.SCIFORGE_RUNTIME_API_KEY)
    || 'sciforge-local-model-router';
}

function modelRouterConfigFromRuntimeEnv(env: NodeJS.ProcessEnv): ModelRouterConfig {
  const defaultProfile = stringValue(env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE) || 'sciforge-runtime-default';
  const visionBaseUrl = stringValue(env.SCIFORGE_VISION_BASE_URL);
  const visionModel = stringValue(env.SCIFORGE_VISION_MODEL);
  return {
    defaultProfile,
    publicModelAlias: stringValue(env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS) || RUNTIME_MODEL,
    profiles: {
      [defaultProfile]: {
        traceRoot: stringValue(env.SCIFORGE_MODEL_ROUTER_TRACE_ROOT) || '.sciforge/model-router-traces',
        textReasoner: {
          provider: stringValue(env.SCIFORGE_TEXT_PROVIDER) || 'text-reasoner',
          baseUrl: requiredRuntimeEnvString(env, 'SCIFORGE_TEXT_BASE_URL'),
          apiKeyEnv: stringValue(env.SCIFORGE_TEXT_API_KEY_ENV) || 'SCIFORGE_TEXT_API_KEY',
          model: requiredRuntimeEnvString(env, 'SCIFORGE_TEXT_MODEL'),
        },
        translators: visionBaseUrl && visionModel
          ? {
              vision: {
                provider: stringValue(env.SCIFORGE_VISION_PROVIDER) || 'vision-translator',
                baseUrl: visionBaseUrl,
                apiKeyEnv: stringValue(env.SCIFORGE_VISION_API_KEY_ENV) || 'SCIFORGE_VISION_API_KEY',
                model: visionModel,
                ...(numberStringValue(env.SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS) ? {
                  maxSupplementRounds: numberStringValue(env.SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS),
                } : {}),
              },
            }
          : {},
      },
    },
  };
}

function requiredRuntimeEnvString(env: NodeJS.ProcessEnv, key: string): string {
  const value = stringValue(env[key]);
  if (!value) throw new Error(`Missing required Model Router runtime env ${key}.`);
  return value;
}

function modelRouterListenOptions(env: NodeJS.ProcessEnv, baseUrl = '') {
  const parsed = parseUrl(baseUrl);
  return {
    host: modelRouterListenHostFromEnv(env),
    port: numberStringValue(env.SCIFORGE_MODEL_ROUTER_PORT)
      ?? numberStringValue(parsed?.port)
      ?? 3892,
  };
}

function modelRouterListenHostFromEnv(env: NodeJS.ProcessEnv): string {
  const host = stringValue(env.SCIFORGE_MODEL_ROUTER_HOST);
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host;
}

function publicModelRouterBaseUrl(proxy: StartedModelRouterServer, env: NodeJS.ProcessEnv) {
  const listenHost = stringValue(env.SCIFORGE_MODEL_ROUTER_HOST)
    || parseUrl(proxy.url)?.hostname;
  const host = !listenHost || listenHost === '0.0.0.0' || listenHost === '::'
    ? '127.0.0.1'
    : listenHost;
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${urlHost}:${proxy.port}`;
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function numberStringValue(value: unknown): number | undefined {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : undefined;
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : undefined;
}

function assertCompleteLocalProviderSettings(settings: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}, configPath: string): void {
  const missing: string[] = [];
  if (!settings.apiKey) missing.push('apiKey/llm.apiKey/textLLM.apiKey');
  if (!settings.baseUrl) missing.push('baseUrl/llm.baseUrl/textLLM.baseUrl');
  if (!settings.model) missing.push('model/llm.model/textLLM.model');
  if (!missing.length) return;
  throw new Error(`Incomplete config.local.json at ${configPath}; missing ${missing.join(', ')}.`);
}

function completeDesktopSidecarLocalProviderSettings(
  settings: LocalProviderSettings,
  env: NodeJS.ProcessEnv,
): LocalProviderSettings {
  if (isCompleteLocalProviderSettings(settings)) return settings;
  if (!isDesktopSidecarEnv(env)) return settings;
  const injected = localProviderSettingsFromDesktopSidecarEnv(env);
  if (!injected || !isCompleteLocalProviderSettings(injected)) return settings;
  return {
    ...settings,
    ...injected,
    ...(settings.provider && settings.provider !== RUNTIME_PROVIDER ? {
      provider: settings.provider,
      providerSource: settings.providerSource,
    } : {}),
    ...(settings.forceNonStreamingUpstream === true ? {
      forceNonStreamingUpstream: settings.forceNonStreamingUpstream,
      forceNonStreamingUpstreamSource: settings.forceNonStreamingUpstreamSource,
    } : {}),
  };
}

function workspaceComputerUseEnv(settings: LocalProviderSettings, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const localEnv = computerUseWorkspaceEnvFromLocalSettings(settings);
  return Object.fromEntries(
    Object.entries(localEnv).filter(([key]) => {
      if (key.startsWith('SCIFORGE_VIRTUAL_APP_SCREEN_')) return false;
      return !LOCAL_MEMBER_MODEL_RUNTIME_ALIAS_ENV_KEYS.has(key);
    }),
  );
}

function isCompleteLocalProviderSettings(settings: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): boolean {
  return !!(settings.apiKey && settings.baseUrl && settings.model);
}

function isDesktopSidecarEnv(env: NodeJS.ProcessEnv): boolean {
  return !!(
    stringValue(env.SCIFORGE_DESKTOP_SIDECAR)
    || stringValue(env.SCIFORGE_DESKTOP_USER_DATA_DIR)
    || stringValue(env.SCIFORGE_DESKTOP_APP_ROOT)
    || stringValue(env.SCIFORGE_DESKTOP_DEV)
  );
}

function hasExplicitModelRouterEndpoint(env: NodeJS.ProcessEnv): boolean {
  return !!(
    stringValue(env.SCIFORGE_MODEL_ROUTER_BASE_URL)
    || stringValue(env.SCIFORGE_MODEL_ROUTER_URL)
    || stringValue(env.SCIFORGE_MODEL_ROUTER_PORT)
  );
}

function hasExplicitModelRouterApiKey(env: NodeJS.ProcessEnv): boolean {
  return !!(
    stringValue(env.SCIFORGE_MODEL_ROUTER_API_KEY)
    || stringValue(env.SCIFORGE_RUNTIME_API_KEY)
  );
}

function localProviderSettingsFromDesktopSidecarEnv(env: NodeJS.ProcessEnv): LocalProviderSettings | undefined {
  const apiKey = firstEnvString(env, [
    'SCIFORGE_TEXT_API_KEY',
    'SCIFORGE_VISION_API_KEY',
  ]);
  const baseUrl = firstEnvString(env, [
    'SCIFORGE_TEXT_BASE_URL',
  ], (value) => value.replace(/\/+$/, ''));
  const model = firstEnvString(env, [
    'SCIFORGE_TEXT_MODEL',
  ]);
  const visionApiKey = firstEnvString(env, ['SCIFORGE_VISION_API_KEY']);
  const visionBaseUrl = firstEnvString(env, ['SCIFORGE_VISION_BASE_URL'], (value) => value.replace(/\/+$/, ''));
  const visionModel = firstEnvString(env, ['SCIFORGE_VISION_MODEL']);
  const provider = firstEnvString(env, [
    'SCIFORGE_TEXT_PROVIDER',
    'SCIFORGE_VISION_PROVIDER',
    'SCIFORGE_RUNTIME_PROVIDER',
  ], (value, key) => key === 'SCIFORGE_RUNTIME_PROVIDER' && value === RUNTIME_PROVIDER ? '' : value);

  if (!apiKey && !baseUrl && !model && !provider) return undefined;
  return {
    ...(apiKey ? { apiKey: apiKey.value, apiKeySource: apiKey.source } : {}),
    ...(baseUrl ? { baseUrl: baseUrl.value, baseUrlSource: baseUrl.source } : {}),
    ...(model ? { model: model.value, modelSource: model.source } : {}),
    ...(provider ? { provider: provider.value, providerSource: provider.source } : {}),
    ...(visionApiKey ? { visionApiKey: visionApiKey.value, visionApiKeySource: visionApiKey.source } : {}),
    ...(visionBaseUrl ? { visionBaseUrl: visionBaseUrl.value, visionBaseUrlSource: visionBaseUrl.source } : {}),
    ...(visionModel ? { visionModel: visionModel.value, visionModelSource: visionModel.source } : {}),
  };
}

function firstEnvString(
  env: NodeJS.ProcessEnv,
  keys: string[],
  normalize: (value: string, key: string) => string = (value) => value,
): { value: string; source: string } | undefined {
  for (const key of keys) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const value = normalize(stringValue(env[normalizedKey]), normalizedKey);
    if (value) return { value, source: `env:${normalizedKey}` };
  }
  return undefined;
}

function isAddrInUse(error: unknown): boolean {
  return isRecord(error) && error.code === 'EADDRINUSE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
