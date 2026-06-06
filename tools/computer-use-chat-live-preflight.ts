import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const COMPUTER_USE_CHAT_LIVE_PREFLIGHT_SCHEMA =
  'sciforge.computer-use.chat-live-preflight.v1' as const;

export interface ComputerUseChatLivePreflightOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  out?: string;
  root?: string;
  workspacePath?: string;
  configPath?: string;
  localConfigs?: LocalConfigInput[];
  requestVisionAllowSharedSystemInput?: boolean;
}

export interface ComputerUseChatLivePreflightManifest {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_PREFLIGHT_SCHEMA;
  checkedAt: string;
  status: 'ready' | 'blocked';
  releaseAcceptance: 'not-evaluated';
  evidenceMode: 'current-env-diagnostic-only';
  requiredEnv: Array<{
    name: string;
    present: boolean;
    source: 'env' | 'local-config' | 'runtime-default' | 'missing';
    valuePrinted: false;
  }>;
  localConfigSources: Array<{
    path: string;
    present: boolean;
    valuePrinted: false;
  }>;
  missingEnv: string[];
  policyViolations: string[];
  requestConfigAssumptions: {
    visionAllowSharedSystemInput?: boolean;
  };
  serviceChecks: Array<{
    id: string;
    label: string;
    url: string;
    status: 'pass' | 'fail';
    httpStatus?: number;
    error?: string;
  }>;
  runtimeProviderPreflight?: {
    status: 'ready' | 'blocked';
    category?: string;
    runtimeApiKeyPresentInServiceEnv?: boolean;
    upstreamBaseUrlPresent?: boolean;
    upstreamKeySourceKind?: string;
    upstreamBaseUrlSourceKind?: string;
    missingEnv: string[];
    policyViolations: string[];
    evidenceMode?: string;
    releaseAcceptance?: string;
    checkedHealthz?: {
      category?: string;
      ok?: boolean;
      httpStatus?: number;
    };
    readIssue?: string;
    valuePrinted: false;
  };
  suggestedSmokePrompt: string;
  expectedEvidenceRefs: string[];
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: false;
  }>;
}

interface CliArgs {
  out?: string;
  config?: string;
  workspace?: string;
  requestVisionAllowSharedSystemInput?: boolean;
  strict: boolean;
  json: boolean;
}

interface LocalConfigInput {
  path: string;
  config?: unknown;
}

export const suggestedComputerUseChatSmokePrompt = [
  '/computer-use Use the visible desktop to inspect the current active window,',
  'then open or focus a local text editor and create a short local visible report artifact in the editor body.',
  'The report must name the visible app/window, one visible UI fact, and human-readable evidence labels from the current run bundle.',
  'Do not type raw JSON, filesystem paths, filenames, or evidence ref strings into the editor body; summarize refs with short labels such as before screenshot, after screenshot, and trace bundle.',
  'Use only low-risk local GUI actions needed to materialize the report, such as open_app for a local editor and type_text into the document body.',
  'Do not type the report into search, filter, chat, address, send, submit, upload, share, or publish fields.',
  'Do not send, delete, upload, submit, publish, external-post, or use shared/system input.',
].join(' ');

const expectedEvidenceRefs = [
  'computer-use-request.json',
  'host-ports.json',
  'tui-host-run-task-chain.json',
  'vision-trace.json',
  'tool-payload.json',
  'gui-present.json',
  'verifier-verdict.json',
];

const requiredEnvGroups = [
  ['SCIFORGE_RUNTIME_API_KEY'],
  ['SCIFORGE_PROXY_UPSTREAM_BASE_URL', 'SCIFORGE_RUNTIME_BASE_URL'],
  ['SCIFORGE_VISION_DESKTOP_BRIDGE'],
  ['SCIFORGE_VISION_INPUT_ADAPTER'],
  ['SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER'],
] as const;

export async function buildComputerUseChatLivePreflightManifest(
  options: ComputerUseChatLivePreflightOptions = {},
): Promise<ComputerUseChatLivePreflightManifest> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 900;
  const localConfig = await loadLocalConfigInputs(options, env);
  const localConfigRecords = localConfig
    .map((item) => item.config)
    .filter(isRecord);
  const effectiveEnv = envWithLocalConfigDefaults(env, localConfigRecords);
  const requiredEnv = requiredEnvGroups.flatMap((group) => (
    group.map((name) => {
      const envPresent = hasEnv(env, name);
      const localPresent = hasLocalConfigForEnv(localConfigRecords, name);
      const runtimeDefaultPresent = runtimeDefaultSatisfiesEnv(name, env, localConfigRecords);
      return {
        name,
        present: envPresent || localPresent || runtimeDefaultPresent,
        source: envPresent
          ? 'env' as const
          : localPresent
            ? 'local-config' as const
            : runtimeDefaultPresent
              ? 'runtime-default' as const
              : 'missing' as const,
        valuePrinted: false as const,
      };
    })
  ));
  const missingEnv = requiredEnvGroups
    .filter((group) => !group.some((name) => {
      const entry = requiredEnv.find((item) => item.name === name);
      return entry?.present === true;
    }))
    .map((group) => group.join(' or '));
  const policyViolations = [
    requestExplicitlyDisallowsSharedInput(options)
      ? undefined
      : truthyEnv(env, 'SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT') || truthyLocalConfig(localConfigRecords, [
      ['visionSense', 'allowSharedSystemInput'],
      ['computerUse', 'allowSharedSystemInput'],
      ['allowSharedSystemInput'],
    ])
        ? 'shared-system-input-cannot-satisfy-chat-e2e-preflight'
        : undefined,
    truthyEnv(env, 'SCIFORGE_VISION_TEST_ACTION_FIXTURES') || truthyLocalConfig(localConfigRecords, [
      ['visionSense', 'testActionFixtureMode'],
      ['visionSense', 'testActionFixtures'],
      ['computerUse', 'testActionFixtureMode'],
      ['computerUse', 'testActionFixtures'],
      ['testActionFixtureMode'],
    ])
      ? 'test-action-fixtures-cannot-satisfy-real-chat-e2e'
      : undefined,
    truthyEnv(env, 'SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN') || truthyLocalConfig(localConfigRecords, [
      ['visionSense', 'desktopBridgeDryRun'],
      ['visionSense', 'dryRun'],
      ['computerUse', 'desktopBridgeDryRun'],
      ['computerUse', 'dryRun'],
      ['dryRun'],
    ])
      ? 'desktop-bridge-dry-run-cannot-satisfy-real-chat-e2e'
      : undefined,
  ].filter((item): item is string => Boolean(item));

  const rawServiceChecks = await Promise.all([
    checkService({
      id: 'sciforge-ui',
      label: 'SciForge UI',
      url: effectiveEnv.SCIFORGE_UI_URL || loopbackUrl(effectiveEnv.SCIFORGE_UI_PORT, 5173, '/'),
      fetchImpl,
      timeoutMs,
      acceptsHtml: true,
    }),
    checkService({
      id: 'workspace-writer',
      label: 'Workspace writer',
      url: serviceHealthUrl(effectiveEnv.SCIFORGE_WORKSPACE_WRITER_URL, '/health')
        || loopbackUrl(effectiveEnv.SCIFORGE_WORKSPACE_PORT, 5174, '/health'),
      fallbackUrls: effectiveEnv.SCIFORGE_WORKSPACE_WRITER_URL || effectiveEnv.SCIFORGE_WORKSPACE_PORT
        ? []
        : [loopbackUrl('6173', 5174, '/health')],
      fetchImpl,
      timeoutMs,
    }),
    checkService({
      id: 'runtime-codex',
      label: 'Runtime Codex sidecar',
      url: serviceHealthUrl(effectiveEnv.SCIFORGE_RUNTIME_CODEX_URL, '/health')
        || loopbackUrl(effectiveEnv.SCIFORGE_RUNTIME_CODEX_PORT, 18080, '/health'),
      fetchImpl,
      timeoutMs,
    }),
    checkService({
      id: 'provider-proxy',
      label: 'Provider proxy',
      url: providerProxyHealthUrl(effectiveEnv),
      fallbackUrls: providerProxyFallbackHealthUrls(effectiveEnv),
      fetchImpl,
      timeoutMs,
    }),
  ]);
  const runtimeProviderPreflight = await readWorkspaceRuntimeProviderPreflight({
    serviceChecks: rawServiceChecks,
    fetchImpl,
    timeoutMs,
  });
  const serviceChecks = reconcileProviderProxyServiceCheck(rawServiceChecks, runtimeProviderPreflight);
  const runtimeProviderReady = runtimeProviderPreflight
    ? runtimeProviderPreflight.status === 'ready'
    : serviceChecks.find((check) => check.id === 'workspace-writer')?.status !== 'pass';

  const status = missingEnv.length === 0
    && policyViolations.length === 0
    && serviceChecks.every((check) => check.status === 'pass')
    && runtimeProviderReady
    ? 'ready'
    : 'blocked';
  return {
    schemaVersion: COMPUTER_USE_CHAT_LIVE_PREFLIGHT_SCHEMA,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    status,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-env-diagnostic-only',
    requiredEnv,
    localConfigSources: localConfig.map((item) => ({
      path: item.path,
      present: isRecord(item.config),
      valuePrinted: false,
    })),
    missingEnv,
    policyViolations,
    requestConfigAssumptions: {
      visionAllowSharedSystemInput: typeof options.requestVisionAllowSharedSystemInput === 'boolean'
        ? options.requestVisionAllowSharedSystemInput
        : undefined,
    },
    serviceChecks,
    runtimeProviderPreflight,
    suggestedSmokePrompt: suggestedComputerUseChatSmokePrompt,
    expectedEvidenceRefs,
    nextActions: nextActions({ missingEnv, policyViolations, serviceChecks, runtimeProviderPreflight }),
  };
}

export async function runComputerUseChatLivePreflightCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await buildComputerUseChatLivePreflightManifest({
    out: args.out,
    configPath: args.config,
    workspacePath: args.workspace,
    requestVisionAllowSharedSystemInput: args.requestVisionAllowSharedSystemInput,
  });
  if (args.out) {
    const outputPath = resolve(args.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(`[${manifest.status}] Computer Use chat live preflight; missingEnv=${manifest.missingEnv.length}; failedServices=${manifest.serviceChecks.filter((check) => check.status === 'fail').length}; policyViolations=${manifest.policyViolations.length}\n`);
    if (args.out) process.stdout.write(`  manifest: ${resolve(args.out)}\n`);
    const presentLocalConfigs = manifest.localConfigSources.filter((source) => source.present);
    if (presentLocalConfigs.length) process.stdout.write(`  local config sources: ${presentLocalConfigs.map((source) => source.path).join(', ')}\n`);
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'ready') process.exitCode = 1;
}

function reconcileProviderProxyServiceCheck(
  serviceChecks: ComputerUseChatLivePreflightManifest['serviceChecks'],
  runtimeProviderPreflight: ComputerUseChatLivePreflightManifest['runtimeProviderPreflight'] | undefined,
): ComputerUseChatLivePreflightManifest['serviceChecks'] {
  if (runtimeProviderPreflight?.status !== 'ready') return serviceChecks;
  return serviceChecks.map((check) => {
    if (check.id !== 'provider-proxy' || check.status !== 'fail') return check;
    if (!providerProxyProbeFailureIsTransportOnly(check.error)) return check;
    return {
      id: check.id,
      label: check.label,
      url: check.url,
      status: 'pass' as const,
      httpStatus: runtimeProviderPreflight.checkedHealthz?.httpStatus,
    };
  });
}

function providerProxyProbeFailureIsTransportOnly(error: string | undefined): boolean {
  if (!error) return false;
  return /aborted|aborterror|timed out|timeout|failed to fetch|couldn'?t connect|connection refused|econnrefused|network/i.test(error)
    && !/not ready|upstream-outage|provider-auth|rate-limited|blocked|unauthorized|forbidden/i.test(error);
}

async function checkService(input: {
  id: string;
  label: string;
  url: string;
  fallbackUrls?: string[];
  fetchImpl: typeof fetch;
  timeoutMs: number;
  acceptsHtml?: boolean;
}): Promise<ComputerUseChatLivePreflightManifest['serviceChecks'][number]> {
  const candidates = [input.url, ...(input.fallbackUrls ?? [])];
  const failures: string[] = [];
  for (const url of candidates) {
    const checked = await requestServiceHealth({
      ...input,
      url,
    });
    if (checked.status === 'pass') return checked;
    failures.push(`${checked.url}: ${checked.error ?? `HTTP ${checked.httpStatus ?? 'unknown'}`}`);
  }
  return {
    id: input.id,
    label: input.label,
    url: sanitizeDiagnosticUrl(candidates[0] ?? input.url),
    status: 'fail',
    error: sanitizeDiagnosticText(failures.join('; ') || 'service did not pass health check'),
  };
}

async function requestServiceHealth(input: {
  id: string;
  label: string;
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  acceptsHtml?: boolean;
}): Promise<ComputerUseChatLivePreflightManifest['serviceChecks'][number]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const diagnosticUrl = sanitizeDiagnosticUrl(input.url);
  try {
    const response = await input.fetchImpl(input.url, { signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const payload = parseJson(text);
    const jsonPayload = isRecord(payload);
    const okPayload = jsonPayload ? payload.ok === true || payload.status === 'ok' || payload.ready === true : false;
    const notReadyPayload = jsonPayload && healthPayloadReportsNotReady(payload);
    const htmlOk = input.acceptsHtml === true && /html/i.test(contentType);
    if (response.ok && !notReadyPayload && (okPayload || htmlOk || (!jsonPayload && text.trim().length > 0))) {
      return {
        id: input.id,
        label: input.label,
        url: diagnosticUrl,
        status: 'pass',
        httpStatus: response.status,
      };
    }
    return {
      id: input.id,
      label: input.label,
      url: diagnosticUrl,
      status: 'fail',
      httpStatus: response.status,
      error: response.ok
        ? healthNotReadyDiagnostic(payload) ?? 'health response did not contain a ready marker'
        : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id: input.id,
      label: input.label,
      url: diagnosticUrl,
      status: 'fail',
      error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function nextActions(input: {
  missingEnv: string[];
  policyViolations: string[];
  serviceChecks: ComputerUseChatLivePreflightManifest['serviceChecks'];
  runtimeProviderPreflight?: ComputerUseChatLivePreflightManifest['runtimeProviderPreflight'];
}): ComputerUseChatLivePreflightManifest['nextActions'] {
  const actions: ComputerUseChatLivePreflightManifest['nextActions'] = [];
  if (input.missingEnv.length > 0) {
    actions.push({
      label: `Set required service environment variables: ${input.missingEnv.join(', ')}.`,
      command: 'Use ignored local config or service environment; do not print secret values.',
      writesRepo: false,
    });
  }
  if (input.policyViolations.length > 0) {
    actions.push({
      label: `Clear real-run policy blockers: ${input.policyViolations.join(', ')}.`,
      writesRepo: false,
    });
  }
  const failed = input.serviceChecks.filter((check) => check.status === 'fail');
  if (failed.length > 0) {
    actions.push({
      label: `Start or repair local services: ${failed.map((check) => check.id).join(', ')}.`,
      command: 'Start UI, workspace writer, Runtime Codex sidecar, and provider proxy; then rerun this preflight.',
      writesRepo: false,
    });
  }
  if (input.runtimeProviderPreflight?.status === 'blocked') {
    actions.push({
      label: `Repair Runtime Codex provider preflight: ${[
        ...input.runtimeProviderPreflight.missingEnv,
        ...input.runtimeProviderPreflight.policyViolations,
        input.runtimeProviderPreflight.category,
        input.runtimeProviderPreflight.readIssue,
      ].filter(Boolean).join(', ')}.`,
      command: 'Set Runtime Codex provider variables in the workspace writer service environment and rerun this preflight.',
      writesRepo: false,
    });
  }
  actions.push({
    label: 'When status=ready, submit the suggested /computer-use low-risk local artifact smoke prompt from the SciForge chat box and validate the current run bundle.',
    writesRepo: false,
  });
  return actions;
}

async function readWorkspaceRuntimeProviderPreflight(input: {
  serviceChecks: ComputerUseChatLivePreflightManifest['serviceChecks'];
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<ComputerUseChatLivePreflightManifest['runtimeProviderPreflight'] | undefined> {
  const workspaceWriter = input.serviceChecks.find((check) => check.id === 'workspace-writer' && check.status === 'pass');
  if (!workspaceWriter?.url) return undefined;
  const url = appendPath(workspaceWriter.url.replace(/\/health\/?$/i, ''), '/api/sciforge/runtime-provider-preflight/manifest');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, { signal: controller.signal });
    const body = await response.text();
    const parsed = parseJson(body);
    const manifest = isRecord(parsed) && isRecord(parsed.manifest) ? parsed.manifest : undefined;
    if (!response.ok || !manifest) {
      return {
        status: 'blocked',
        missingEnv: [],
        policyViolations: [],
        readIssue: sanitizeDiagnosticText(response.ok ? 'workspace runtime-provider-preflight manifest missing' : `HTTP ${response.status}`),
        valuePrinted: false,
      };
    }
    const missingEnv = stringList(manifest.missingEnv);
    const policyViolations = stringList(manifest.policyViolations);
    const runtimeApiKeyPresentInServiceEnv = manifest.runtimeApiKeyPresentInServiceEnv === true;
    const upstreamBaseUrlPresent = manifest.upstreamBaseUrlPresent === true;
    const category = stringField(manifest.category);
    const ready = runtimeApiKeyPresentInServiceEnv
      && upstreamBaseUrlPresent
      && missingEnv.length === 0
      && policyViolations.length === 0
      && category === 'ready';
    const checkedHealthz = isRecord(manifest.checkedHealthz)
      ? {
          category: stringField(manifest.checkedHealthz.category),
          ok: typeof manifest.checkedHealthz.ok === 'boolean' ? manifest.checkedHealthz.ok : undefined,
          httpStatus: typeof manifest.checkedHealthz.httpStatus === 'number' ? manifest.checkedHealthz.httpStatus : undefined,
        }
      : undefined;
    return {
      status: ready ? 'ready' : 'blocked',
      category,
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      upstreamKeySourceKind: stringField(manifest.upstreamKeySourceKind),
      upstreamBaseUrlSourceKind: stringField(manifest.upstreamBaseUrlSourceKind),
      missingEnv,
      policyViolations,
      evidenceMode: stringField(manifest.evidenceMode),
      releaseAcceptance: stringField(manifest.releaseAcceptance),
      checkedHealthz,
      valuePrinted: false,
    };
  } catch (error) {
    return {
      status: 'blocked',
      missingEnv: [],
      policyViolations: [],
      readIssue: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
      valuePrinted: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--strict') parsed.strict = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--request-disallow-shared-system-input') parsed.requestVisionAllowSharedSystemInput = false;
    else if (arg === '--out') parsed.out = readArgValue(args, index += 1, arg);
    else if (arg === '--config') parsed.config = readArgValue(args, index += 1, arg);
    else if (arg === '--workspace') parsed.workspace = readArgValue(args, index += 1, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function loadLocalConfigInputs(
  options: ComputerUseChatLivePreflightOptions,
  env: NodeJS.ProcessEnv,
): Promise<LocalConfigInput[]> {
  if (options.localConfigs) return options.localConfigs.map((item) => ({
    path: sanitizeDiagnosticPath(item.path),
    config: item.config,
  }));
  const root = resolve(options.root ?? process.cwd());
  const workspacePath = options.workspacePath ?? env.SCIFORGE_WORKSPACE_PATH;
  const explicitConfig = options.configPath ?? env.SCIFORGE_CONFIG_PATH;
  const candidates = uniqueStrings([
    explicitConfig ? resolve(explicitConfig) : resolve(root, 'config.local.json'),
    resolve(root, 'config.computer-use.local.json'),
    resolve(root, '.sciforge', 'config.json'),
    resolve(root, '.sciforge', 'config.local.json'),
    workspacePath ? resolve(workspacePath, '.sciforge', 'config.json') : undefined,
    workspacePath ? resolve(workspacePath, '.sciforge', 'config.local.json') : undefined,
  ]);
  return Promise.all(candidates.map(async (path) => ({
    path: sanitizeDiagnosticPath(path),
    config: await readOptionalJson(path),
  })));
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function hasLocalConfigForEnv(configs: Record<string, unknown>[], name: string): boolean {
  const paths = configPathsForEnv(name);
  if (!paths.length) return false;
  return Boolean(firstConfigString(configs, paths));
}

function runtimeDefaultSatisfiesEnv(
  name: string,
  env: NodeJS.ProcessEnv,
  configs: Record<string, unknown>[],
): boolean {
  if (name !== 'SCIFORGE_VISION_DESKTOP_BRIDGE') return false;
  const platform = firstConfigString(configs, [
    ['visionSense', 'desktopPlatform'],
    ['visionSense', 'executorPlatform'],
    ['computerUse', 'desktopPlatform'],
    ['computerUse', 'executorPlatform'],
  ]) ?? env.SCIFORGE_VISION_DESKTOP_PLATFORM ?? process.platform;
  return supportsBuiltinDesktopBridge(platform);
}

function supportsBuiltinDesktopBridge(platform: string) {
  return /^(?:darwin|mac|macos|osx)$/i.test(platform.trim());
}

function requestExplicitlyDisallowsSharedInput(options: ComputerUseChatLivePreflightOptions) {
  return options.requestVisionAllowSharedSystemInput === false;
}

function envWithLocalConfigDefaults(
  env: NodeJS.ProcessEnv,
  configs: Record<string, unknown>[],
): NodeJS.ProcessEnv {
  const effective: NodeJS.ProcessEnv = { ...env };
  for (const name of [
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
    'SCIFORGE_RUNTIME_BASE_URL',
    'SCIFORGE_VISION_DESKTOP_BRIDGE',
    'SCIFORGE_VISION_INPUT_ADAPTER',
    'SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER',
  ]) {
    if (hasEnv(effective, name)) continue;
    const value = firstConfigString(configs, configPathsForEnv(name));
    if (value) effective[name] = value;
  }
  return effective;
}

function configPathsForEnv(name: string): string[][] {
  if (name === 'SCIFORGE_RUNTIME_API_KEY') {
    return [
      ['apiKey'],
      ['llm', 'apiKey'],
      ['llm', 'upstreamApiKey'],
      ['textLLM', 'apiKey'],
      ['textLLM', 'env', 'SCIFORGE_RUNTIME_API_KEY'],
      ['codexProxy', 'apiKey'],
      ['runtimeCodexProxy', 'apiKey'],
    ];
  }
  if (name === 'SCIFORGE_PROXY_UPSTREAM_BASE_URL' || name === 'SCIFORGE_RUNTIME_BASE_URL') {
    return [
      ['modelBaseUrl'],
      ['llm', 'baseUrl'],
      ['llm', 'upstreamBaseUrl'],
      ['textLLM', 'baseUrl'],
      ['textLLM', 'upstreamBaseUrl'],
      ['textLLM', 'env', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
      ['textLLM', 'env', 'SCIFORGE_RUNTIME_BASE_URL'],
      ['codexProxy', 'upstreamBaseUrl'],
      ['codexProxy', 'baseUrl'],
      ['runtimeCodexProxy', 'upstreamBaseUrl'],
      ['runtimeCodexProxy', 'baseUrl'],
    ];
  }
  if (name === 'SCIFORGE_VISION_DESKTOP_BRIDGE') {
    return [
      ['visionSense', 'desktopBridgeEnabled'],
      ['computerUse', 'desktopBridgeEnabled'],
    ];
  }
  if (name === 'SCIFORGE_VISION_INPUT_ADAPTER') {
    return [
      ['visionSense', 'inputAdapter'],
      ['visionSense', 'independentInputAdapter'],
      ['computerUse', 'inputAdapter'],
    ];
  }
  if (name === 'SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER') {
    return [
      ['visionSense', 'independentInputAdapterProvider'],
      ['visionSense', 'inputAdapterProvider'],
      ['computerUse', 'independentInputAdapterProvider'],
      ['computerUse', 'inputAdapterProvider'],
    ];
  }
  return [];
}

function firstConfigString(configs: Record<string, unknown>[], paths: string[][]): string | undefined {
  for (const path of paths) {
    for (const config of configs) {
      const value = getConfigValue(config, path);
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'boolean') return String(value);
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  return undefined;
}

function truthyLocalConfig(configs: Record<string, unknown>[], paths: string[][]): boolean {
  for (const path of paths) {
    for (const config of configs) {
      if (truthyConfigValue(getConfigValue(config, path))) return true;
    }
  }
  return false;
}

function truthyConfigValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return false;
  return /^(?:1|true|yes|on|enabled|fixture|fixtures|dry-run|dryrun)$/i.test(value.trim());
}

function getConfigValue(config: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function sanitizeDiagnosticPath(value: string): string {
  const root = process.cwd();
  const resolved = resolve(value);
  if (resolved.startsWith(`${root}/`)) return resolved.slice(root.length + 1);
  return sanitizeDiagnosticText(resolved);
}

function readArgValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function hasEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  return typeof env[name] === 'string' && env[name]?.trim().length > 0;
}

function truthyEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  return /^(?:1|true|yes)$/i.test(env[name]?.trim() ?? '');
}

function loopbackUrl(portValue: string | undefined, defaultPort: number, path: string): string {
  const port = Number(portValue);
  const safePort = Number.isInteger(port) && port > 0 ? port : defaultPort;
  return `http://127.0.0.1:${safePort}${path}`;
}

function providerProxyHealthUrl(env: NodeJS.ProcessEnv): string {
  return providerProxyUpstreamHealthUrl(
    serviceHealthUrl(env.SCIFORGE_PROXY_URL, '/healthz')
      || loopbackUrl(env.SCIFORGE_PROXY_PORT, 3891, '/healthz'),
  );
}

function providerProxyFallbackHealthUrls(env: NodeJS.ProcessEnv): string[] {
  if (env.SCIFORGE_PROXY_URL || env.SCIFORGE_PROXY_PORT) return [];
  return [providerProxyUpstreamHealthUrl(loopbackUrl(env.SCIFORGE_MODEL_ROUTER_PORT, 3892, '/healthz'))];
}

function serviceHealthUrl(base: string | undefined, path: string): string | undefined {
  const value = base?.trim();
  if (!value) return undefined;
  const pathPattern = new RegExp(`${escapeRegExp(path)}/?$`, 'i');
  try {
    const url = new URL(value);
    if (!pathPattern.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
    }
    return url.toString();
  } catch {
    return pathPattern.test(value) ? value : `${value.replace(/\/+$/, '')}${path}`;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function providerProxyUpstreamHealthUrl(value: string): string {
  return withQueryParam(value, 'check', 'upstream');
}

function withQueryParam(value: string, key: string, paramValue: string): string {
  try {
    const url = new URL(value);
    url.searchParams.set(key, paramValue);
    return url.toString();
  } catch {
    const [beforeHash, hash = ''] = value.split('#', 2);
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}${encodeURIComponent(key)}=${encodeURIComponent(paramValue)}${hash ? `#${hash}` : ''}`;
  }
}

function healthPayloadReportsNotReady(payload: Record<string, unknown>): boolean {
  const status = stringField(payload.status)?.toLowerCase();
  const upstream = isRecord(payload.upstream) ? payload.upstream : undefined;
  const upstreamStatus = upstream ? stringField(upstream.status)?.toLowerCase() : undefined;
  return payload.ok === false
    || payload.ready === false
    || status === 'blocked'
    || status === 'failed'
    || status === 'fail'
    || status === 'error'
    || upstream?.ok === false
    || upstream?.ready === false
    || upstreamStatus === 'blocked'
    || upstreamStatus === 'failed'
    || upstreamStatus === 'fail'
    || upstreamStatus === 'error';
}

function healthNotReadyDiagnostic(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const upstream = isRecord(payload.upstream) ? payload.upstream : undefined;
  const details = uniqueStrings([
    stringField(payload.category),
    stringField(payload.status),
    stringField(payload.message),
    upstream ? stringField(upstream.category) : undefined,
    upstream ? stringField(upstream.status) : undefined,
    upstream ? stringField(upstream.message) : undefined,
  ]);
  return sanitizeDiagnosticText(
    details.length
      ? `health response reported not ready: ${details.join(', ')}`
      : 'health response reported not ready',
  );
}

function appendPath(base: string, path: string): string {
  try {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
    return url.toString();
  } catch {
    return `${base.replace(/\/+$/, '')}${path}`;
  }
}

function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return sanitizeDiagnosticText(value).replace(/[?#].*$/, '');
  }
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:token|apiKey|api_key|api-key|secret|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted]')
    .replace(/\/\/[^/@\s]+@/g, '//');
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? sanitizeDiagnosticText(value.trim())
    : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringField(item))
    .filter((item): item is string => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

if (process.argv[1]?.endsWith('computer-use-chat-live-preflight.ts')) {
  await runComputerUseChatLivePreflightCli();
}
