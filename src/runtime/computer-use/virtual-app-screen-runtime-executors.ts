import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  createMacosVirtualDisplayProvider,
  type MacosVirtualDisplayProviderOptions,
} from './native-providers/macos-virtual-display-provider.js';
import {
  createMacosVirtualDisplayDriverHooks,
  type MacosVirtualDisplayDriverOptions,
} from './native-providers/macos-virtual-display-driver.js';
import {
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
  createLinuxXpraVirtualDisplayProvider,
  type LinuxXpraVirtualDisplayProviderOptions,
} from './native-providers/linux-xpra-virtual-display-provider.js';
import {
  createLinuxXpraVirtualDisplayDriverHooks,
  type LinuxXpraVirtualDisplayDriverOptions,
} from './native-providers/linux-xpra-virtual-display-driver.js';
import {
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
  createWindowsIddVirtualDisplayProvider,
  type WindowsIddVirtualDisplayProviderOptions,
} from './native-providers/windows-idd-virtual-display-provider.js';
import {
  createWindowsIddVirtualDisplayDriverHooks,
  type WindowsIddVirtualDisplayDriverOptions,
} from './native-providers/windows-idd-virtual-display-driver.js';
import {
  registerVirtualAppScreenNativeExecutor,
  type VirtualAppScreenNativeExecutorOptions,
} from './virtual-app-screen-native-executor.js';
import {
  createVirtualAppScreenInputRuntimeProviderExecutor,
  listVirtualAppScreenInputRuntimeExecutors,
  registerVirtualAppScreenInputRuntimeExecutor,
  type VirtualAppScreenInputRuntimeExecutor,
  type VirtualAppScreenInputRuntimeProjection,
  type VirtualAppScreenInputRuntimeProviderExecutorOptions,
  virtualAppScreenInputRuntimeBlockedReason,
} from './virtual-app-screen-input-runtime.js';

export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON' as const;

const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_SCALAR_ENV = {
  kind: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND',
  name: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME',
  command: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND',
  args: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON',
  bundleId: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_BUNDLE_ID',
  appPath: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH',
  appUserModelId: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_USER_MODEL_ID',
  processMatch: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH',
  windowTitlePattern: 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN',
} as const;

export interface VirtualAppScreenRuntimeNativeDriverHookBootstrapOptions {
  enabled?: boolean;
  env?: Record<string, string | undefined>;
  macos?: MacosVirtualDisplayDriverOptions;
  linux?: LinuxXpraVirtualDisplayDriverOptions;
  windows?: WindowsIddVirtualDisplayDriverOptions;
}

export interface VirtualAppScreenRuntimeExecutorBootstrapOptions {
  platform?: NodeJS.Platform | string;
  nativeDriverHooks?: VirtualAppScreenRuntimeNativeDriverHookBootstrapOptions;
  macosProviderOptions?: MacosVirtualDisplayProviderOptions;
  macosExecutorOptions?: Partial<Pick<VirtualAppScreenNativeExecutorOptions, 'executorId' | 'supportedProfiles' | 'targetAppKind' | 'targetAppName'>>;
  macosInputExecutorOptions?: Partial<Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'supportedSources'>>;
  linuxProviderOptions?: LinuxXpraVirtualDisplayProviderOptions;
  linuxExecutorOptions?: Partial<Pick<VirtualAppScreenNativeExecutorOptions, 'executorId' | 'supportedProfiles' | 'targetAppKind' | 'targetAppName'>>;
  linuxInputExecutorOptions?: Partial<Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'supportedSources'>>;
  windowsProviderOptions?: WindowsIddVirtualDisplayProviderOptions;
  windowsExecutorOptions?: Partial<Pick<VirtualAppScreenNativeExecutorOptions, 'executorId' | 'supportedProfiles' | 'targetAppKind' | 'targetAppName'>>;
  windowsInputExecutorOptions?: Partial<Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'supportedSources'>>;
}

export interface VirtualAppScreenRuntimeExecutorBootstrapResult {
  platform: string;
  registeredExecutorIds: string[];
  alreadyRegistered: boolean;
}

type RuntimeNativeDriverTargetAppSpec = {
  kind?: string;
  name?: string;
  command?: string;
  args?: string[];
  bundleId?: string;
  appPath?: string;
  appUserModelId?: string;
  processMatch?: string;
  windowTitlePattern?: string;
};

const unregisterRuntimeExecutors: Array<() => void> = [];
let runtimeExecutorsRegistered = false;

export function ensureVirtualAppScreenRuntimeExecutorsRegistered(
  options: VirtualAppScreenRuntimeExecutorBootstrapOptions = {},
): VirtualAppScreenRuntimeExecutorBootstrapResult {
  const platform = String(options.platform ?? process.platform);
  if (runtimeExecutorsRegistered) {
    return {
      platform,
      registeredExecutorIds: [],
      alreadyRegistered: true,
    };
  }

  const registeredExecutorIds: string[] = [];
  const enableNativeDriverHooks = nativeDriverHookFactoriesEnabled(options.nativeDriverHooks);
  const targetAppFromEnv = enableNativeDriverHooks
    ? parseNativeDriverTargetAppEnv(options.nativeDriverHooks?.env)
    : { ok: true as const, targetApp: undefined };
  if (!targetAppFromEnv.ok) {
    runtimeExecutorsRegistered = true;
    return {
      platform,
      registeredExecutorIds,
      alreadyRegistered: false,
    };
  }
  if (platform === 'darwin') {
    const targetAppDefaults = nativeDriverTargetAppDefaultsForBootstrap(
      'darwin',
      targetAppFromEnv.targetApp,
      options.nativeDriverHooks?.macos,
      options.macosProviderOptions,
    );
    const providerOptions = macosProviderOptionsForBootstrap(
      providerOptionsWithTargetAppDefaults(options.macosProviderOptions, targetAppDefaults),
      macosDriverOptionsWithTargetAppDefaults(options.nativeDriverHooks?.macos, targetAppDefaults),
      enableNativeDriverHooks,
    );
    registeredExecutorIds.push(...registerProviderShellExecutors({
      providerId: providerOptions.providerId ?? MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
      provider: createMacosVirtualDisplayProvider(providerOptions),
      executorId: options.macosExecutorOptions?.executorId ?? 'native-session-manager:macos-virtual-display-provider',
      inputExecutorId: options.macosInputExecutorOptions?.executorId ?? 'input-runtime:macos-virtual-display-provider',
      executorOptions: executorOptionsWithTargetAppDefaults(options.macosExecutorOptions, targetAppDefaults),
      inputExecutorOptions: options.macosInputExecutorOptions,
    }));
  } else if (platform === 'linux') {
    const targetAppDefaults = nativeDriverTargetAppDefaultsForBootstrap(
      'linux',
      targetAppFromEnv.targetApp,
      options.nativeDriverHooks?.linux,
      options.linuxProviderOptions,
    );
    const providerOptions = linuxProviderOptionsForBootstrap(
      providerOptionsWithTargetAppDefaults(options.linuxProviderOptions, targetAppDefaults),
      linuxDriverOptionsWithTargetAppDefaults(options.nativeDriverHooks?.linux, targetAppDefaults),
      enableNativeDriverHooks,
    );
    registeredExecutorIds.push(...registerProviderShellExecutors({
      providerId: providerOptions.providerId ?? LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
      provider: createLinuxXpraVirtualDisplayProvider(providerOptions),
      executorId: options.linuxExecutorOptions?.executorId ?? 'native-session-manager:linux-xpra-provider',
      inputExecutorId: options.linuxInputExecutorOptions?.executorId ?? 'input-runtime:linux-xpra-provider',
      executorOptions: executorOptionsWithTargetAppDefaults(options.linuxExecutorOptions, targetAppDefaults),
      inputExecutorOptions: options.linuxInputExecutorOptions,
    }));
  } else if (platform === 'win32') {
    const targetAppDefaults = nativeDriverTargetAppDefaultsForBootstrap(
      'win32',
      targetAppFromEnv.targetApp,
      options.nativeDriverHooks?.windows,
      options.windowsProviderOptions,
    );
    const providerOptions = windowsProviderOptionsForBootstrap(
      providerOptionsWithTargetAppDefaults(options.windowsProviderOptions, targetAppDefaults),
      windowsDriverOptionsWithTargetAppDefaults(options.nativeDriverHooks?.windows, targetAppDefaults),
      enableNativeDriverHooks,
    );
    registeredExecutorIds.push(...registerProviderShellExecutors({
      providerId: providerOptions.providerId ?? WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      provider: createWindowsIddVirtualDisplayProvider(providerOptions),
      executorId: options.windowsExecutorOptions?.executorId ?? 'native-session-manager:windows-idd-provider',
      inputExecutorId: options.windowsInputExecutorOptions?.executorId ?? 'input-runtime:windows-idd-provider',
      executorOptions: executorOptionsWithTargetAppDefaults(options.windowsExecutorOptions, targetAppDefaults),
      inputExecutorOptions: options.windowsInputExecutorOptions,
    }));
  }

  runtimeExecutorsRegistered = true;
  return {
    platform,
    registeredExecutorIds,
    alreadyRegistered: false,
  };
}

function registerProviderShellExecutors(options: {
  providerId: string;
  provider: VirtualAppScreenNativeExecutorOptions['provider'];
  executorId: string;
  inputExecutorId: string;
  executorOptions?: Partial<Pick<VirtualAppScreenNativeExecutorOptions, 'supportedProfiles' | 'targetAppKind' | 'targetAppName'>>;
  inputExecutorOptions?: Partial<Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'supportedSources'>>;
}) {
  const unregister = registerVirtualAppScreenNativeExecutor({
    executorId: options.executorId,
    providerId: options.providerId,
    supportedProfiles: options.executorOptions?.supportedProfiles ?? ['*'],
    provider: options.provider,
    targetAppKind: options.executorOptions?.targetAppKind,
    targetAppName: options.executorOptions?.targetAppName,
  });
  unregisterRuntimeExecutors.push(unregister);

  const unregisterInput = registerLowPriorityInputRuntimeProviderExecutor({
    executorId: options.inputExecutorId,
    providerId: options.providerId,
    supportedSources: options.inputExecutorOptions?.supportedSources,
    provider: options.provider,
  });
  unregisterRuntimeExecutors.push(unregisterInput);
  return [options.executorId, options.inputExecutorId];
}

function macosProviderOptionsForBootstrap(
  providerOptions: MacosVirtualDisplayProviderOptions = {},
  driverOptions: MacosVirtualDisplayDriverOptions | undefined,
  enabled: boolean,
): MacosVirtualDisplayProviderOptions {
  if (!enabled) return providerOptions;
  const hooks = createMacosVirtualDisplayDriverHooks({
    providerId: providerOptions.providerId,
    ...(driverOptions ?? {}),
    probeOptions: {
      ...(providerOptions.probeOptions ?? {}),
      ...(driverOptions?.probeOptions ?? {}),
    },
  });
  return {
    ...providerOptions,
    hooks: {
      ...hooks,
      ...(providerOptions.hooks ?? {}),
    },
  };
}

function linuxProviderOptionsForBootstrap(
  providerOptions: LinuxXpraVirtualDisplayProviderOptions = {},
  driverOptions: LinuxXpraVirtualDisplayDriverOptions | undefined,
  enabled: boolean,
): LinuxXpraVirtualDisplayProviderOptions {
  if (!enabled) return providerOptions;
  const hooks = createLinuxXpraVirtualDisplayDriverHooks({
    providerId: providerOptions.providerId,
    ...(driverOptions ?? {}),
    probeOptions: {
      ...(providerOptions.probeOptions ?? {}),
      ...(driverOptions?.probeOptions ?? {}),
    },
  });
  return {
    ...providerOptions,
    hooks: {
      ...hooks,
      ...(providerOptions.hooks ?? {}),
    },
  };
}

function windowsProviderOptionsForBootstrap(
  providerOptions: WindowsIddVirtualDisplayProviderOptions = {},
  driverOptions: WindowsIddVirtualDisplayDriverOptions | undefined,
  enabled: boolean,
): WindowsIddVirtualDisplayProviderOptions {
  if (!enabled) return providerOptions;
  const hooks = createWindowsIddVirtualDisplayDriverHooks({
    providerId: providerOptions.providerId,
    ...(driverOptions ?? {}),
    probeOptions: {
      ...(providerOptions.probeOptions ?? {}),
      ...(driverOptions?.probeOptions ?? {}),
    },
  });
  return {
    ...providerOptions,
    hooks: {
      ...hooks,
      ...(providerOptions.hooks ?? {}),
    },
  };
}

function nativeDriverHookFactoriesEnabled(
  options: VirtualAppScreenRuntimeNativeDriverHookBootstrapOptions | undefined,
): boolean {
  if (!options) return false;
  if (options.enabled !== undefined) return options.enabled === true;
  return nativeDriverHookEnvEnabled(options.env?.[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]);
}

function nativeDriverHookEnvEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? '');
}

function parseNativeDriverTargetAppEnv(
  env: Record<string, string | undefined> | undefined,
): { ok: true; targetApp?: RuntimeNativeDriverTargetAppSpec } | { ok: false; reason: string } {
  if (!env) return { ok: true };
  const jsonValue = trimmedEnvValue(env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]);
  let targetApp: RuntimeNativeDriverTargetAppSpec = {};
  if (jsonValue !== undefined) {
    const parsed = parseTargetAppJson(jsonValue);
    if (!parsed.ok) return parsed;
    targetApp = parsed.targetApp;
  }

  for (const key of targetAppStringKeys) {
    const envName = VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_SCALAR_ENV[key];
    const value = trimmedEnvValue(env[envName]);
    if (value === undefined) continue;
    if (!validateRegexTargetAppField(key, value)) {
      return { ok: false, reason: `${envName} is not a valid regular expression.` };
    }
    targetApp[key] = value;
  }

  const argsJson = trimmedEnvValue(env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_SCALAR_ENV.args]);
  if (argsJson !== undefined) {
    const parsedArgs = parseTargetAppArgsJson(argsJson);
    if (!parsedArgs.ok) return parsedArgs;
    targetApp.args = parsedArgs.args;
  }

  return Object.keys(targetApp).length > 0 ? { ok: true, targetApp } : { ok: true };
}

const targetAppStringKeys = [
  'kind',
  'name',
  'command',
  'bundleId',
  'appPath',
  'appUserModelId',
  'processMatch',
  'windowTitlePattern',
] as const satisfies ReadonlyArray<keyof RuntimeNativeDriverTargetAppSpec>;
const targetAppJsonKeys = new Set<keyof RuntimeNativeDriverTargetAppSpec>([
  ...targetAppStringKeys,
  'args',
]);

function parseTargetAppJson(
  value: string,
): { ok: true; targetApp: RuntimeNativeDriverTargetAppSpec } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV} is not valid JSON.` };
  }
  if (!recordLike(parsed)) {
    return { ok: false, reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV} must be a JSON object.` };
  }
  const targetApp: RuntimeNativeDriverTargetAppSpec = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (!targetAppJsonKeys.has(key as keyof RuntimeNativeDriverTargetAppSpec)) {
      return { ok: false, reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV} contains unsupported key "${key}".` };
    }
    if (key === 'args') {
      const parsedArgs = parseTargetAppArgsValue(rawValue, `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.args`);
      if (!parsedArgs.ok) return parsedArgs;
      targetApp.args = parsedArgs.args;
      continue;
    }
    if (typeof rawValue !== 'string') {
      return { ok: false, reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.${key} must be a string.` };
    }
    const stringValue = rawValue.trim();
    if (!stringValue) continue;
    const targetKey = key as typeof targetAppStringKeys[number];
    if (!validateRegexTargetAppField(targetKey, stringValue)) {
      return { ok: false, reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.${key} is not a valid regular expression.` };
    }
    targetApp[targetKey] = stringValue;
  }
  return { ok: true, targetApp };
}

function parseTargetAppArgsJson(
  value: string,
): { ok: true; args: string[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false,
      reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_SCALAR_ENV.args} is not valid JSON.`,
    };
  }
  return parseTargetAppArgsValue(parsed, VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_SCALAR_ENV.args);
}

function parseTargetAppArgsValue(
  value: unknown,
  source: string,
): { ok: true; args: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return { ok: false, reason: `${source} must be a JSON string array.` };
  }
  return { ok: true, args: value.map((item) => item.trim()) };
}

function validateRegexTargetAppField(
  key: keyof RuntimeNativeDriverTargetAppSpec,
  value: string,
): boolean {
  if (key !== 'processMatch' && key !== 'windowTitlePattern') return true;
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function trimmedEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function recordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nativeDriverTargetAppDefaultsForBootstrap(
  platform: 'darwin' | 'linux' | 'win32',
  envTargetApp: RuntimeNativeDriverTargetAppSpec | undefined,
  driverOptions: { targetApp?: RuntimeNativeDriverTargetAppSpec; probeOptions?: { targetAppKind?: string } } | undefined,
  providerOptions: { probeOptions?: { targetAppKind?: string } } | undefined,
): RuntimeNativeDriverTargetAppSpec | undefined {
  const envTarget = platformTargetAppSpec(platform, envTargetApp);
  const driverTarget = platformTargetAppSpec(platform, driverOptions?.targetApp);
  const kind = driverTarget?.kind
    ?? driverOptions?.probeOptions?.targetAppKind
    ?? providerOptions?.probeOptions?.targetAppKind
    ?? envTarget?.kind;
  const name = driverTarget?.name ?? envTarget?.name;
  const merged = {
    ...(envTarget ?? {}),
    ...(driverTarget ?? {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function platformTargetAppSpec(
  platform: 'darwin' | 'linux' | 'win32',
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): RuntimeNativeDriverTargetAppSpec | undefined {
  if (!targetApp) return undefined;
  const shared = {
    kind: targetApp.kind,
    name: targetApp.name,
    command: targetApp.command,
    args: targetApp.args,
    processMatch: targetApp.processMatch,
    windowTitlePattern: targetApp.windowTitlePattern,
  };
  if (platform === 'darwin') {
    return compactTargetAppSpec({
      ...shared,
      bundleId: targetApp.bundleId,
      appPath: targetApp.appPath,
    });
  }
  if (platform === 'win32') {
    return compactTargetAppSpec({
      ...shared,
      appPath: targetApp.appPath,
      appUserModelId: targetApp.appUserModelId,
    });
  }
  return compactTargetAppSpec(shared);
}

function compactTargetAppSpec(
  targetApp: RuntimeNativeDriverTargetAppSpec,
): RuntimeNativeDriverTargetAppSpec | undefined {
  const compact = Object.fromEntries(
    Object.entries(targetApp).filter(([, value]) => value !== undefined),
  ) as RuntimeNativeDriverTargetAppSpec;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function providerOptionsWithTargetAppDefaults<T extends { probeOptions?: { targetAppKind?: string } }>(
  providerOptions: T | undefined,
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): T | undefined {
  if (!targetApp?.kind) return providerOptions;
  return {
    ...(providerOptions ?? {} as T),
    probeOptions: {
      ...(providerOptions?.probeOptions ?? {}),
      targetAppKind: providerOptions?.probeOptions?.targetAppKind ?? targetApp.kind,
    },
  };
}

function macosDriverOptionsWithTargetAppDefaults(
  driverOptions: MacosVirtualDisplayDriverOptions | undefined,
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): MacosVirtualDisplayDriverOptions | undefined {
  if (!targetApp) return driverOptions;
  return {
    ...(driverOptions ?? {}),
    targetApp: platformTargetAppSpec('darwin', {
      ...targetApp,
      ...(driverOptions?.targetApp ?? {}),
    }),
    probeOptions: {
      ...(driverOptions?.probeOptions ?? {}),
      targetAppKind: driverOptions?.probeOptions?.targetAppKind ?? targetApp.kind,
    },
  };
}

function linuxDriverOptionsWithTargetAppDefaults(
  driverOptions: LinuxXpraVirtualDisplayDriverOptions | undefined,
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): LinuxXpraVirtualDisplayDriverOptions | undefined {
  if (!targetApp) return driverOptions;
  return {
    ...(driverOptions ?? {}),
    targetApp: platformTargetAppSpec('linux', {
      ...targetApp,
      ...(driverOptions?.targetApp ?? {}),
    }),
    probeOptions: {
      ...(driverOptions?.probeOptions ?? {}),
      targetAppKind: driverOptions?.probeOptions?.targetAppKind ?? targetApp.kind,
    },
  };
}

function windowsDriverOptionsWithTargetAppDefaults(
  driverOptions: WindowsIddVirtualDisplayDriverOptions | undefined,
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): WindowsIddVirtualDisplayDriverOptions | undefined {
  if (!targetApp) return driverOptions;
  return {
    ...(driverOptions ?? {}),
    targetApp: platformTargetAppSpec('win32', {
      ...targetApp,
      ...(driverOptions?.targetApp ?? {}),
    }),
    probeOptions: {
      ...(driverOptions?.probeOptions ?? {}),
      targetAppKind: driverOptions?.probeOptions?.targetAppKind ?? targetApp.kind,
    },
  };
}

function executorOptionsWithTargetAppDefaults<T extends { targetAppKind?: string; targetAppName?: string }>(
  executorOptions: T | undefined,
  targetApp: RuntimeNativeDriverTargetAppSpec | undefined,
): T | undefined {
  if (!targetApp?.kind && !targetApp?.name) return executorOptions;
  return {
    ...(executorOptions ?? {} as T),
    targetAppKind: executorOptions?.targetAppKind ?? targetApp?.kind,
    targetAppName: executorOptions?.targetAppName ?? targetApp?.name,
  };
}

export function resetVirtualAppScreenRuntimeExecutorsForTests(): void {
  while (unregisterRuntimeExecutors.length) {
    unregisterRuntimeExecutors.pop()?.();
  }
  runtimeExecutorsRegistered = false;
}

function registerLowPriorityInputRuntimeProviderExecutor(
  options: VirtualAppScreenInputRuntimeProviderExecutorOptions,
): () => void {
  const fallback = createVirtualAppScreenInputRuntimeProviderExecutor(options);
  return registerVirtualAppScreenInputRuntimeExecutor({
    executorId: fallback.executorId,
    providerId: fallback.providerId,
    supportedSources: fallback.supportedSources,
    execute: async (command) => {
      const preferred = preferredRegisteredInputExecutor(fallback, command.source);
      if (preferred) return preferred.execute(command);
      const result = await fallback.execute(command);
      return result.status === 'executed' ? result : withBootstrapInputBlockedMessage(command, result);
    },
  });
}

function preferredRegisteredInputExecutor(
  fallback: Pick<VirtualAppScreenInputRuntimeExecutor, 'executorId'>,
  source: Parameters<VirtualAppScreenInputRuntimeExecutor['execute']>[0]['source'],
): VirtualAppScreenInputRuntimeExecutor | undefined {
  const candidates = listVirtualAppScreenInputRuntimeExecutors()
    .filter((executor) => executor.executorId !== fallback.executorId)
    .filter((executor) => !executor.supportedSources?.length || executor.supportedSources.includes(source));
  return candidates.find((executor) => executor.supportedSources?.includes(source)) ?? candidates[0];
}

function withBootstrapInputBlockedMessage(
  command: Parameters<VirtualAppScreenInputRuntimeExecutor['execute']>[0],
  result: VirtualAppScreenInputRuntimeProjection,
): VirtualAppScreenInputRuntimeProjection {
  const message = `${virtualAppScreenInputRuntimeBlockedReason(command)} Provider readiness evidence: ${result.message}`;
  return {
    ...result,
    message,
    routeDecision: {
      ...result.routeDecision,
      blockedReason: message,
    },
    virtualScreenData: {
      ...result.virtualScreenData,
      blockedReason: message,
      runSummary: {
        ...recordValue(result.virtualScreenData.runSummary),
        blockedReason: message,
      },
    },
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
