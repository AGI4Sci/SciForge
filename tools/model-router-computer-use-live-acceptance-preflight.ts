#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from './model-router-computer-use-live-acceptance-cases.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_SCHEMA_VERSION =
  'sciforge.model-router.computer-use-live-acceptance-preflight.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_DEFAULT_OUT =
  'docs/test-artifacts/model-router-computer-use-live-matrix/preflight.json' as const;

const requiredRouterCapabilities = [
  'model_router_responses',
  'vision_translation',
  'refs_first_trace',
] as const;

const defaultKnownSecretEnv = ['SCIFORGE_TEXT_API_KEY', 'SCIFORGE_VISION_API_KEY'] as const;
const allowedExecutorKinds = new Set(['desktop-native-host', 'native-host', 'app-window']);

export type ModelRouterComputerUseLiveAcceptancePreflightStatus = 'ready' | 'blocked';

export interface ModelRouterComputerUseLiveAcceptancePreflightOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  routerUrl?: string;
  workspacePath?: string;
  configPath?: string;
  localConfigs?: LocalConfigInput[];
  requestDisallowSharedSystemInput?: boolean;
  expectedKnownSecretEnv?: string[];
  preflightRef?: string;
  manifestRef?: string;
  traceAuditReportRef?: string;
  traceRootRef?: string;
}

export interface ModelRouterComputerUseLiveAcceptancePreflightManifest {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_SCHEMA_VERSION;
  checkedAt: string;
  status: ModelRouterComputerUseLiveAcceptancePreflightStatus;
  releaseAcceptance: 'not-evaluated';
  evidenceMode: 'current-env-diagnostic-only';
  router: {
    present: boolean;
    source: 'cli' | 'env' | 'local-config' | 'missing';
    valuePrinted: false;
  };
  routerChecks: Array<{
    id: 'health' | 'manifest' | 'models';
    path: '/health' | '/manifest' | '/v1/models';
    status: 'pass' | 'fail' | 'blocked';
    httpStatus?: number;
    issueRef?: string;
    valuePrinted: false;
  }>;
  routerCapabilityCheck: {
    expectedCapabilities: string[];
    missingCapabilities: string[];
    valuePrinted: false;
  };
  routerModelList?: {
    present: boolean;
    modelCount: number;
    digestRef?: string;
    valuePrinted: false;
  };
  computerUsePreflight: {
    optIn: {
      present: boolean;
      valuePrinted: false;
    };
    runner: {
      present: boolean;
      source: 'env' | 'missing';
      commandRef?: string;
      valuePrinted: false;
    };
    executor: {
      present: boolean;
      kind?: 'desktop-native-host' | 'native-host' | 'app-window';
      valuePrinted: false;
    };
    sharedSystemInputDisallowed: boolean;
  };
  authReadiness: {
    textReasonerAuthPresent: boolean;
    visionTranslatorAuthPresent: boolean;
    expectedAuthCheckCount: number;
    valuePrinted: false;
  };
  localConfigSources: Array<{
    pathRef: string;
    present: boolean;
    valuePrinted: false;
  }>;
  casePlan: Array<{
    id: string;
    category: string;
    requiredCapabilityIds: string[];
    requiredEvidenceKinds: string[];
    allowedExecutorKinds: readonly ['desktop-native-host', 'native-host', 'app-window'];
  }>;
  missingRequirements: string[];
  policyViolations: string[];
  expectedArtifacts: {
    preflightRef: string;
    matrixManifestRef: string;
    traceAuditReportRef: string;
    traceRootRef: string;
    valuePrinted: false;
  };
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: false;
  }>;
}

interface LocalConfigInput {
  path: string;
  config?: unknown;
}

interface CliArgs {
  routerUrl?: string;
  outPath?: string;
  workspacePath?: string;
  configPath?: string;
  traceRootRef?: string;
  expectedKnownSecretEnv: string[];
  requestDisallowSharedSystemInput: boolean;
  timeoutMs?: number;
  strict: boolean;
  json: boolean;
}

export async function buildModelRouterComputerUseLiveAcceptancePreflightManifest(
  options: ModelRouterComputerUseLiveAcceptancePreflightOptions = {},
): Promise<ModelRouterComputerUseLiveAcceptancePreflightManifest> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 900;
  const localConfigs = await loadLocalConfigs(options, env);
  const configRecords = localConfigs.map((item) => item.config).filter(isRecord);
  const routerTarget = resolveRouterTarget(options, env, configRecords);
  const routerChecks = await checkRouter(routerTarget.value, fetchImpl, timeoutMs);
  const routerCapabilityCheck = routerCapabilitiesFrom(routerChecks);
  const routerModelList = routerModelsFrom(routerChecks);
  const authReadiness = authReadinessFor(env, configRecords, options.expectedKnownSecretEnv);
  const computerUsePreflight = computerUsePreflightFor(env, options.requestDisallowSharedSystemInput === true);
  const missingRequirements = missingRequirementsFor({
    routerPresent: routerTarget.present,
    routerChecks,
    routerCapabilityCheck,
    routerModelList,
    computerUsePreflight,
    authReadiness,
  });
  const policyViolations = policyViolationsFor(env, configRecords, options.requestDisallowSharedSystemInput === true);
  const status: ModelRouterComputerUseLiveAcceptancePreflightStatus =
    missingRequirements.length === 0 && policyViolations.length === 0 ? 'ready' : 'blocked';
  const expectedArtifacts = {
    preflightRef: safeRepoRef(options.preflightRef ?? MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_DEFAULT_OUT),
    matrixManifestRef: safeRepoRef(options.manifestRef ?? 'docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json'),
    traceAuditReportRef: safeRepoRef(options.traceAuditReportRef ?? 'docs/test-artifacts/model-router-live-trace-audit/report.json'),
    traceRootRef: safeRepoRef(options.traceRootRef ?? '.sciforge/model-router-traces'),
    valuePrinted: false as const,
  };
  return {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_SCHEMA_VERSION,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    status,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-env-diagnostic-only',
    router: {
      present: routerTarget.present,
      source: routerTarget.source,
      valuePrinted: false,
    },
    routerChecks: publicRouterChecks(routerChecks),
    routerCapabilityCheck: {
      ...routerCapabilityCheck,
      valuePrinted: false,
    },
    routerModelList,
    computerUsePreflight,
    authReadiness,
    localConfigSources: localConfigs.map((item) => ({
      pathRef: publicPathRef(item.path),
      present: isRecord(item.config),
      valuePrinted: false as const,
    })),
    casePlan: modelRouterComputerUseLiveAcceptanceCases.map((item) => ({
      id: item.id,
      category: item.category,
      requiredCapabilityIds: [...item.requiredCapabilityIds],
      requiredEvidenceKinds: [...item.requiredEvidenceKinds],
      allowedExecutorKinds: item.allowedExecutorKinds,
    })),
    missingRequirements,
    policyViolations,
    expectedArtifacts,
    nextActions: nextActions({ missingRequirements, policyViolations, expectedArtifacts }),
  };
}

export async function runModelRouterComputerUseLiveAcceptancePreflightCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await buildModelRouterComputerUseLiveAcceptancePreflightManifest({
    routerUrl: args.routerUrl,
    workspacePath: args.workspacePath,
    configPath: args.configPath,
    traceRootRef: args.traceRootRef,
    expectedKnownSecretEnv: args.expectedKnownSecretEnv,
    requestDisallowSharedSystemInput: args.requestDisallowSharedSystemInput,
    timeoutMs: args.timeoutMs,
  });
  if (args.outPath) {
    const outPath = resolve(args.outPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    const router = manifest.routerChecks.every((check) => check.status === 'pass') ? 'pass' : 'blocked';
    const computerUse = manifest.computerUsePreflight.optIn.present
      && manifest.computerUsePreflight.runner.present
      && manifest.computerUsePreflight.executor.present
      && manifest.computerUsePreflight.sharedSystemInputDisallowed
      ? 'ready'
      : 'blocked';
    process.stdout.write(
      `[${manifest.status}] Model Router Computer Use live acceptance preflight; router=${router}; computerUse=${computerUse}; cases=${manifest.casePlan.length}; issues=${manifest.missingRequirements.length + manifest.policyViolations.length}\n`,
    );
    if (args.outPath) process.stdout.write(`  manifest: ${publicPathRef(args.outPath)}\n`);
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'ready') process.exitCode = 1;
}

type InternalRouterCheck = ModelRouterComputerUseLiveAcceptancePreflightManifest['routerChecks'][number] & {
  payload?: unknown;
};

async function checkRouter(
  routerUrl: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<InternalRouterCheck[]> {
  if (!routerUrl) {
    return [
      blockedRouterCheck('health', '/health', 'missing-router-url'),
      blockedRouterCheck('manifest', '/manifest', 'missing-router-url'),
      blockedRouterCheck('models', '/v1/models', 'missing-router-url'),
    ];
  }
  return Promise.all([
    requestRouterJson(routerUrl, '/health', 'health', fetchImpl, timeoutMs),
    requestRouterJson(routerUrl, '/manifest', 'manifest', fetchImpl, timeoutMs),
    requestRouterJson(routerUrl, '/v1/models', 'models', fetchImpl, timeoutMs),
  ]);
}

async function requestRouterJson(
  baseUrl: string,
  path: '/health' | '/manifest' | '/v1/models',
  id: 'health' | 'manifest' | 'models',
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<InternalRouterCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, normalizedBaseUrl(baseUrl)), { signal: controller.signal });
    const text = await response.text();
    const payload = parseJson(text);
    return {
      id,
      path,
      status: response.ok ? 'pass' : 'fail',
      httpStatus: response.status,
      issueRef: response.ok ? undefined : issueRef(`HTTP ${response.status}`),
      valuePrinted: false,
      payload,
    };
  } catch (error) {
    return {
      id,
      path,
      status: 'fail',
      issueRef: issueRef(error instanceof Error ? error.message : String(error)),
      valuePrinted: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function blockedRouterCheck(
  id: 'health' | 'manifest' | 'models',
  path: '/health' | '/manifest' | '/v1/models',
  issue: string,
): InternalRouterCheck {
  return { id, path, status: 'blocked', issueRef: issueRef(issue), valuePrinted: false };
}

function publicRouterChecks(checks: InternalRouterCheck[]): ModelRouterComputerUseLiveAcceptancePreflightManifest['routerChecks'] {
  return checks.map(({ payload: _payload, ...check }) => check);
}

function routerCapabilitiesFrom(checks: InternalRouterCheck[]) {
  const manifest = checks.find((check) => check.id === 'manifest' && check.status === 'pass')?.payload;
  const capabilities = isRecord(manifest) && Array.isArray(manifest.capabilities)
    ? manifest.capabilities.filter((item): item is string => typeof item === 'string')
    : [];
  const missingCapabilities = requiredRouterCapabilities.filter((capability) => !capabilities.includes(capability));
  return {
    expectedCapabilities: [...requiredRouterCapabilities],
    missingCapabilities,
  };
}

function routerModelsFrom(checks: InternalRouterCheck[]): ModelRouterComputerUseLiveAcceptancePreflightManifest['routerModelList'] {
  const payload = checks.find((check) => check.id === 'models' && check.status === 'pass')?.payload;
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return {
      present: false,
      modelCount: 0,
      valuePrinted: false,
    };
  }
  const ids = payload.data
    .filter(isRecord)
    .map((item) => typeof item.id === 'string' ? item.id : '')
    .filter(Boolean)
    .sort();
  return {
    present: ids.length > 0,
    modelCount: ids.length,
    digestRef: ids.length > 0 ? `models:${sha256Hex(ids.join('\n')).slice(0, 16)}` : undefined,
    valuePrinted: false,
  };
}

function computerUsePreflightFor(
  env: Record<string, string | undefined>,
  requestDisallowSharedSystemInput: boolean,
): ModelRouterComputerUseLiveAcceptancePreflightManifest['computerUsePreflight'] {
  const runner = env.SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER?.trim();
  const executorKind = env.SCIFORGE_CU_LIVE_EXECUTOR_KIND?.trim();
  const executorAllowed = allowedExecutorKinds.has(executorKind ?? '');
  return {
    optIn: {
      present: env.SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE === '1',
      valuePrinted: false,
    },
    runner: runner
      ? {
          present: true,
          source: 'env',
          commandRef: `command:${sha256Hex(runner).slice(0, 16)}`,
          valuePrinted: false,
        }
      : {
          present: false,
          source: 'missing',
          valuePrinted: false,
        },
    executor: executorAllowed
      ? {
          present: true,
          kind: executorKind as 'desktop-native-host' | 'native-host' | 'app-window',
          valuePrinted: false,
        }
      : {
          present: false,
          valuePrinted: false,
        },
    sharedSystemInputDisallowed: requestDisallowSharedSystemInput,
  };
}

function authReadinessFor(
  env: Record<string, string | undefined>,
  configs: Record<string, unknown>[],
  expectedKnownSecretEnv?: string[],
): ModelRouterComputerUseLiveAcceptancePreflightManifest['authReadiness'] {
  const expected = expectedKnownSecretEnv?.length ? expectedKnownSecretEnv : [...defaultKnownSecretEnv];
  const textEnv = uniqueStrings([expected[0], defaultKnownSecretEnv[0]]);
  const visionEnv = uniqueStrings([expected[1], defaultKnownSecretEnv[1]]);
  return {
    textReasonerAuthPresent: textEnv.some((name) => hasEnv(env, name)) || configs.some(hasAnySensitiveConfigValue),
    visionTranslatorAuthPresent: visionEnv.some((name) => hasEnv(env, name)) || configs.some(hasAnySensitiveConfigValue),
    expectedAuthCheckCount: Math.max(expected.length, 2),
    valuePrinted: false,
  };
}

function missingRequirementsFor(input: {
  routerPresent: boolean;
  routerChecks: InternalRouterCheck[];
  routerCapabilityCheck: { expectedCapabilities: string[]; missingCapabilities: string[] };
  routerModelList?: ModelRouterComputerUseLiveAcceptancePreflightManifest['routerModelList'];
  computerUsePreflight: ModelRouterComputerUseLiveAcceptancePreflightManifest['computerUsePreflight'];
  authReadiness: ModelRouterComputerUseLiveAcceptancePreflightManifest['authReadiness'];
}) {
  const missing = [
    input.routerPresent ? undefined : 'missing-router-url',
    ...input.routerChecks
      .filter((check) => check.status !== 'pass')
      .map((check) => `router-check-failed:${check.id}`),
    ...input.routerCapabilityCheck.missingCapabilities.map((capability) => `router-capability-missing:${capability}`),
    input.routerModelList?.present === true ? undefined : 'router-model-list-missing',
    input.computerUsePreflight.optIn.present ? undefined : 'missing-live-opt-in',
    input.computerUsePreflight.runner.present ? undefined : 'missing-live-runner',
    input.computerUsePreflight.executor.present ? undefined : 'missing-executor-kind',
    input.computerUsePreflight.sharedSystemInputDisallowed ? undefined : 'missing-request-disallow-shared-system-input',
    input.authReadiness.textReasonerAuthPresent ? undefined : 'missing-text-reasoner-auth',
    input.authReadiness.visionTranslatorAuthPresent ? undefined : 'missing-vision-translator-auth',
  ].filter((item): item is string => Boolean(item));
  return uniqueStrings(missing);
}

function policyViolationsFor(
  env: Record<string, string | undefined>,
  configs: Record<string, unknown>[],
  requestDisallowSharedSystemInput: boolean,
) {
  const violations = [
    truthy(env.SCIFORGE_CU_LIVE_USE_FIXTURES) || configs.some((config) => truthyConfig(config, [
      ['computerUse', 'liveUseFixtures'],
      ['computerUse', 'fixtureMode'],
      ['cuLiveUseFixtures'],
    ]))
      ? 'fixture-mode-cannot-satisfy-live-acceptance'
      : undefined,
    truthy(env.SCIFORGE_VISION_TEST_ACTION_FIXTURES) || configs.some((config) => truthyConfig(config, [
      ['visionSense', 'testActionFixtures'],
      ['visionSense', 'testActionFixtureMode'],
      ['computerUse', 'testActionFixtures'],
      ['computerUse', 'testActionFixtureMode'],
      ['testActionFixtures'],
    ]))
      ? 'test-action-fixtures-cannot-satisfy-live-acceptance'
      : undefined,
    truthy(env.SCIFORGE_CU_LIVE_DRY_RUN) || configs.some((config) => truthyConfig(config, [
      ['computerUse', 'dryRun'],
      ['cuLiveDryRun'],
      ['dryRun'],
    ]))
      ? 'dry-run-cannot-satisfy-live-acceptance'
      : undefined,
    truthy(env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN) || configs.some((config) => truthyConfig(config, [
      ['visionSense', 'desktopBridgeDryRun'],
      ['computerUse', 'desktopBridgeDryRun'],
      ['desktopBridgeDryRun'],
    ]))
      ? 'desktop-bridge-dry-run-cannot-satisfy-live-acceptance'
      : undefined,
    !requestDisallowSharedSystemInput && (
      truthy(env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT) || configs.some((config) => truthyConfig(config, [
        ['visionSense', 'allowSharedSystemInput'],
        ['computerUse', 'allowSharedSystemInput'],
        ['allowSharedSystemInput'],
      ]))
    )
      ? 'shared-system-input-cannot-satisfy-live-acceptance'
      : undefined,
  ].filter((item): item is string => Boolean(item));
  return uniqueStrings(violations);
}

function nextActions(input: {
  missingRequirements: string[];
  policyViolations: string[];
  expectedArtifacts: ModelRouterComputerUseLiveAcceptancePreflightManifest['expectedArtifacts'];
}): ModelRouterComputerUseLiveAcceptancePreflightManifest['nextActions'] {
  const actions: ModelRouterComputerUseLiveAcceptancePreflightManifest['nextActions'] = [];
  if (input.missingRequirements.length > 0) {
    actions.push({
      label: `Prepare live prerequisites: ${input.missingRequirements.join(', ')}.`,
      command: 'Configure ignored local service environment; keep auth values out of stdout and repo files.',
      writesRepo: false,
    });
  }
  if (input.policyViolations.length > 0) {
    actions.push({
      label: `Disable non-live modes: ${input.policyViolations.join(', ')}.`,
      writesRepo: false,
    });
  }
  actions.push({
    label: 'After the real five-case run, scan the Model Router trace root with the no-leak audit.',
    command: `node --import tsx tools/model-router-trace-audit.ts --trace-root ${input.expectedArtifacts.traceRootRef} --require-non-empty --known-secret-env <text-auth-env> --known-secret-env <vision-auth-env> --out ${input.expectedArtifacts.traceAuditReportRef}`,
    writesRepo: false,
  });
  actions.push({
    label: 'Then validate the refs-first live acceptance matrix manifest; this preflight cannot claim release acceptance.',
    command: `node --import tsx tools/model-router-computer-use-live-acceptance-matrix.ts --manifest ${input.expectedArtifacts.matrixManifestRef} --trace-audit-report ${input.expectedArtifacts.traceAuditReportRef} --expected-known-secrets-checked 2 --strict`,
    writesRepo: false,
  });
  return actions;
}

function resolveRouterTarget(
  options: ModelRouterComputerUseLiveAcceptancePreflightOptions,
  env: Record<string, string | undefined>,
  configs: Record<string, unknown>[],
) {
  const cli = options.routerUrl?.trim();
  if (cli) return { present: true, source: 'cli' as const, value: cli };
  const envUrl = env.SCIFORGE_MODEL_ROUTER_URL?.trim() || env.SCIFORGE_MODEL_ROUTER_BASE_URL?.trim();
  if (envUrl) return { present: true, source: 'env' as const, value: envUrl };
  const configUrl = firstConfigString(configs, [
    ['modelRouter', 'url'],
    ['modelRouter', 'baseUrl'],
    ['modelRouterUrl'],
    ['routerUrl'],
  ]);
  if (configUrl) return { present: true, source: 'local-config' as const, value: configUrl };
  return { present: false, source: 'missing' as const, value: undefined };
}

async function loadLocalConfigs(
  options: ModelRouterComputerUseLiveAcceptancePreflightOptions,
  env: Record<string, string | undefined>,
): Promise<LocalConfigInput[]> {
  if (options.localConfigs) {
    return options.localConfigs.map((item) => ({ path: item.path, config: item.config }));
  }
  const root = process.cwd();
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
    path,
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

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    expectedKnownSecretEnv: [],
    requestDisallowSharedSystemInput: false,
    strict: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--router-url') {
      parsed.routerUrl = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--workspace') {
      parsed.workspacePath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--config') {
      parsed.configPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-root') {
      parsed.traceRootRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--known-secret-env') {
      parsed.expectedKnownSecretEnv.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === '--request-disallow-shared-system-input') {
      parsed.requestDisallowSharedSystemInput = true;
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = positiveInteger(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error('Unknown Model Router Computer Use live acceptance preflight argument');
    }
  }
  return parsed;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInteger(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer`);
  return parsed;
}

function helpText() {
  return [
    'Usage: tsx tools/model-router-computer-use-live-acceptance-preflight.ts [--router-url URL] [--workspace PATH] [--config PATH] [--trace-root REF] [--known-secret-env ENV] [--request-disallow-shared-system-input] [--out preflight.json] [--timeout-ms N] [--strict] [--json]',
    '',
    'Checks whether the current environment is prepared to run the real Model Router Computer Use live acceptance matrix.',
    'The preflight only publishes refs, counts, and digest refs; it never runs live cases and never grants release acceptance.',
    `Default preflight convention: ${MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_DEFAULT_OUT}`,
  ].join('\n');
}

function normalizedBaseUrl(value: string) {
  try {
    return new URL(value.endsWith('/') ? value : `${value}/`);
  } catch {
    return new URL('http://127.0.0.1.invalid/');
  }
}

function safeRepoRef(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (/^(?:docs|artifacts|\.sciforge)\//u.test(normalized)) return normalized;
  if (/^[a-z0-9._/-]+$/iu.test(normalized) && !normalized.includes('..') && !isAbsolute(normalized)) return normalized;
  return `ref:${sha256Hex(value).slice(0, 16)}`;
}

function publicPathRef(path: string) {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute).split(sep).join('/');
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && /^(?:docs|artifacts|\.sciforge)\//u.test(rel)) return rel;
  return `path:${sha256Hex(absolute).slice(0, 16)}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function firstConfigString(configs: Record<string, unknown>[], paths: string[][]) {
  for (const config of configs) {
    for (const path of paths) {
      const value = valueAtPath(config, path);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function truthyConfig(config: Record<string, unknown>, paths: string[][]) {
  return paths.some((path) => {
    const value = valueAtPath(config, path);
    return typeof value === 'boolean' ? value : typeof value === 'string' && truthy(value);
  });
}

function valueAtPath(input: unknown, path: string[]): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasAnySensitiveConfigValue(config: Record<string, unknown>) {
  const stack: unknown[] = [config];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      stack.push(...item);
    } else if (isRecord(item)) {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string' && value.trim() && /(?:api[-_]?key|secret|token|authorization|credential|password)/i.test(key)) {
          return true;
        }
        if (isRecord(value) || Array.isArray(value)) stack.push(value);
      }
    }
  }
  return false;
}

function hasEnv(env: Record<string, string | undefined>, name: string | undefined) {
  return Boolean(name && env[name]?.trim());
}

function truthy(value: string | undefined) {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '');
}

function issueRef(value: string) {
  return `issue:${sha256Hex(value).slice(0, 16)}`;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-preflight.ts')) {
  await runModelRouterComputerUseLiveAcceptancePreflightCli(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
