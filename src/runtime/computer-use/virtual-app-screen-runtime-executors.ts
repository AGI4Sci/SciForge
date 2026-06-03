import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  createMacosVirtualDisplayProvider,
  type MacosVirtualDisplayProviderHooks,
  type MacosVirtualDisplayProviderOptions,
} from './native-providers/macos-virtual-display-provider.js';
import type {
  PlatformVirtualDisplayProviderHooks,
} from './native-providers/platform-virtual-display-provider-shell.js';
import {
  createMacosVirtualDisplayDriverHooks,
  type MacosVirtualDisplayDriverInputAdapterCapability,
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
  nativeDriverInputControlSafeFailureDetail,
  type NativeVirtualDisplayDriverInputControlHook,
  type NativeVirtualDisplayDriverInputControlResult,
} from './native-providers/native-driver-input-control.js';
import {
  registerVirtualAppScreenNativeExecutor,
  type VirtualAppScreenNativeExecutorOptions,
} from './virtual-app-screen-native-executor.js';
import { resetVirtualAppScreenNativeHostSessionStoreForTests } from './virtual-app-screen-native-host-session-store.js';
import { resetVirtualAppScreenProviderSessionStoreForTests } from './virtual-app-screen-provider-session-store.js';
import {
  createVirtualAppScreenInputRuntimeProviderExecutor,
  listVirtualAppScreenInputRuntimeExecutors,
  registerVirtualAppScreenInputRuntimeExecutor,
  type VirtualAppScreenInputRuntimeExecutor,
  type VirtualAppScreenInputRuntimeProjection,
  type VirtualAppScreenInputRuntimeProviderExecutorOptions,
  tryRunVirtualAppScreenInputRuntimeNativeHost,
  virtualAppScreenInputRuntimeBlockedReason,
} from './virtual-app-screen-input-runtime.js';
import type { VirtualDisplayProviderOperationOptions } from './virtual-display-provider.js';

export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS' as const;
export const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS' as const;

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
  editableWindowReadiness?: RuntimeNativeDriverEditableWindowReadiness;
};

type RuntimeNativeDriverEditableWindowReadiness = {
  required?: boolean;
  mode?: 'document' | 'presentation';
  rejectTitlePattern?: string;
  requireAxWindow?: boolean;
  requireNonEmptyTitle?: boolean;
  requireEditableSurfaceEvidence?: boolean;
};

type RuntimeNativeDriverEnvOptions = {
  windowTimeoutMs?: number;
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
  const inputControlHookFromEnv = enableNativeDriverHooks
    ? parseNativeDriverInputControlHookEnv(options.nativeDriverHooks?.env)
    : { ok: true as const, hook: undefined };
  const driverOptionsFromEnv = enableNativeDriverHooks
    ? parseNativeDriverOptionsEnv(options.nativeDriverHooks?.env)
    : { ok: true as const, options: undefined };
  if (!targetAppFromEnv.ok) {
    runtimeExecutorsRegistered = true;
    return {
      platform,
      registeredExecutorIds,
      alreadyRegistered: false,
    };
  }
  const inputControlHookConfigBlockedReason = inputControlHookFromEnv.ok ? undefined : inputControlHookFromEnv.reason;
  const driverOptionsConfigBlockedReason = driverOptionsFromEnv.ok ? undefined : driverOptionsFromEnv.reason;
  const nativeDriverConfigBlockedReason = inputControlHookConfigBlockedReason ?? driverOptionsConfigBlockedReason;
  const inputControlHook = inputControlHookFromEnv.ok ? inputControlHookFromEnv.hook : undefined;
  const envDriverOptions = driverOptionsFromEnv.ok ? driverOptionsFromEnv.options : undefined;
  if (platform === 'darwin') {
    const targetAppDefaults = nativeDriverTargetAppDefaultsForBootstrap(
      'darwin',
      targetAppFromEnv.targetApp,
      options.nativeDriverHooks?.macos,
      options.macosProviderOptions,
    );
    const macosProviderOptions = providerOptionsWithInputControlHookConfigBlock(
      providerOptionsWithTargetAppDefaults(options.macosProviderOptions, targetAppDefaults),
      nativeDriverConfigBlockedReason,
    );
    const providerOptions = macosProviderOptionsForBootstrap(
      macosProviderOptions,
      macosDriverOptionsWithTargetAppDefaults(
        driverOptionsWithEnvDefaults(
          driverOptionsWithInputControlHook(options.nativeDriverHooks?.macos, inputControlHook),
          envDriverOptions,
        ),
        targetAppDefaults,
      ),
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
    const linuxProviderOptions = providerOptionsWithInputControlHookConfigBlock(
      providerOptionsWithTargetAppDefaults(options.linuxProviderOptions, targetAppDefaults),
      nativeDriverConfigBlockedReason,
    );
    const providerOptions = linuxProviderOptionsForBootstrap(
      linuxProviderOptions,
      linuxDriverOptionsWithTargetAppDefaults(
        driverOptionsWithEnvDefaults(
          driverOptionsWithInputControlHook(options.nativeDriverHooks?.linux, inputControlHook),
          envDriverOptions,
        ),
        targetAppDefaults,
      ),
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
    const windowsProviderOptions = providerOptionsWithInputControlHookConfigBlock(
      providerOptionsWithTargetAppDefaults(options.windowsProviderOptions, targetAppDefaults),
      nativeDriverConfigBlockedReason,
    );
    const providerOptions = windowsProviderOptionsForBootstrap(
      windowsProviderOptions,
      windowsDriverOptionsWithTargetAppDefaults(
        driverOptionsWithEnvDefaults(
          driverOptionsWithInputControlHook(options.nativeDriverHooks?.windows, inputControlHook),
          envDriverOptions,
        ),
        targetAppDefaults,
      ),
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

function parseNativeDriverInputControlHookEnv(
  env: Record<string, string | undefined> | undefined,
): { ok: true; hook?: NativeVirtualDisplayDriverInputControlHook } | { ok: false; reason: string } {
  const command = trimmedEnvValue(env?.[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]);
  if (!command) return { ok: true };
  const argsJson = trimmedEnvValue(env?.[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]);
  const args = argsJson ? parseNativeDriverInputControlHookArgs(argsJson) : { ok: true as const, args: [] };
  if (!args.ok) return args;
  const timeoutMs = parseNativeDriverInputControlHookTimeout(env?.[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV]);
  if (!timeoutMs.ok) return timeoutMs;
  return {
    ok: true,
    hook: createNativeDriverInputControlCommandHook({
      command,
      args: args.args,
      timeoutMs: timeoutMs.timeoutMs,
    }),
  };
}

function parseNativeDriverInputControlHookArgs(
  value: string,
): { ok: true; args: string[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false,
      reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV} is not valid JSON.`,
    };
  }
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === 'string')) {
    return {
      ok: false,
      reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV} must be a JSON string array.`,
    };
  }
  return { ok: true, args: parsed };
}

function parseNativeDriverInputControlHookTimeout(
  value: string | undefined,
): { ok: true; timeoutMs: number } | { ok: false; reason: string } {
  const trimmed = trimmedEnvValue(value);
  if (!trimmed) return { ok: true, timeoutMs: 30000 };
  const timeoutMs = Number(trimmed);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    return {
      ok: false,
      reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV} must be a number between 1000 and 300000.`,
    };
  }
  return { ok: true, timeoutMs: Math.round(timeoutMs) };
}

function parseNativeDriverOptionsEnv(
  env: Record<string, string | undefined> | undefined,
): { ok: true; options?: RuntimeNativeDriverEnvOptions } | { ok: false; reason: string } {
  const windowTimeout = parseNativeDriverWindowTimeout(env?.[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV]);
  if (!windowTimeout.ok) return windowTimeout;
  return windowTimeout.windowTimeoutMs !== undefined
    ? { ok: true, options: { windowTimeoutMs: windowTimeout.windowTimeoutMs } }
    : { ok: true };
}

function parseNativeDriverWindowTimeout(
  value: string | undefined,
): { ok: true; windowTimeoutMs?: number } | { ok: false; reason: string } {
  const trimmed = trimmedEnvValue(value);
  if (!trimmed) return { ok: true };
  const windowTimeoutMs = Number(trimmed);
  if (!Number.isFinite(windowTimeoutMs) || windowTimeoutMs < 1000 || windowTimeoutMs > 300000) {
    return {
      ok: false,
      reason: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV} must be a number between 1000 and 300000.`,
    };
  }
  return { ok: true, windowTimeoutMs: Math.round(windowTimeoutMs) };
}

function createNativeDriverInputControlCommandHook(options: {
  command: string;
  args: string[];
  timeoutMs: number;
}): NativeVirtualDisplayDriverInputControlHook {
  return (context) => new Promise<NativeVirtualDisplayDriverInputControlResult>((resolve) => {
    const child = spawn(options.command, options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: nativeDriverInputControlCommandHookEnv(process.env),
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let completed = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const complete = (result: NativeVirtualDisplayDriverInputControlResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminateNativeDriverInputControlHookChild(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        if (!completed) terminateNativeDriverInputControlHookChild(child, 'SIGKILL');
      }, 250);
    }, options.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout = boundedAppend(stdout, String(chunk));
    });
    child.stderr?.on('data', () => undefined);
    child.stdin?.on('error', () => {
      complete({
        ok: false,
        detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} failed while sending hook input on stdin.`,
      });
    });
    child.on('error', () => {
      complete({
        ok: false,
        detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} failed to start.`,
      });
    });
    child.on('close', (code) => {
      if (completed) return;
      if (timedOut) {
        complete({
          ok: false,
          detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} timed out after ${options.timeoutMs}ms and was terminated.`,
        });
        return;
      }
      terminateNativeDriverInputControlHookChildGroup(child);
      if (code !== 0) {
        complete({
          ok: false,
          detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} exited with code ${code ?? 'unknown'}.`,
        });
        return;
      }
      complete(nativeDriverInputControlCommandHookResult(stdout));
    });
    const hookInput = `${JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-app-screen.input-control-hook.v1',
      providerId: context.providerId,
      operation: context.operation,
      operationOptions: context.operationOptions,
      capabilityProbe: context.capabilityProbe === true,
      inputIntent: context.inputIntent,
      refs: context.refs,
      evidenceRoot: context.evidenceRoot,
      platformState: context.platformState,
    })}\n`;
    try {
      child.stdin?.end(hookInput);
    } catch {
      complete({
        ok: false,
        detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} failed while sending hook input on stdin.`,
      });
    }
  });
}

function nativeDriverInputControlCommandHookEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const pathValue = source.PATH ?? source.Path ?? defaultHookPathEnv();
  if (pathValue) env.PATH = pathValue;
  for (const key of ['Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) env[key] = value;
  }
  return env;
}

function defaultHookPathEnv() {
  return process.platform === 'win32'
    ? undefined
    : '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
}

function terminateNativeDriverInputControlHookChild(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
) {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when process-group termination is unavailable.
    }
  }
  child.kill(signal);
}

function terminateNativeDriverInputControlHookChildGroup(
  child: ReturnType<typeof spawn>,
) {
  terminateNativeDriverInputControlHookChild(child, 'SIGTERM');
  const killTimer = setTimeout(() => {
    terminateNativeDriverInputControlHookChild(child, 'SIGKILL');
  }, 250);
  killTimer.unref?.();
}

function nativeDriverInputControlCommandHookResult(stdout: string): NativeVirtualDisplayDriverInputControlResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} must write a JSON object to stdout.`,
    };
  }
  if (!recordLike(parsed)) {
    return {
      ok: false,
      detail: `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} must return a JSON object.`,
    };
  }
  const failureDetail = parsed.ok === true
    ? undefined
    : nativeDriverInputControlSafeFailureDetail(parsed.detail);
  return {
    ok: parsed.ok === true,
    detail: parsed.ok === true
      ? undefined
      : `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} reported failure${failureDetail ? `: ${failureDetail}` : ''}.`,
    inputAdapterCapability: nativeDriverInputAdapterCapability(parsed.inputAdapterCapability),
    refs: nativeDriverInputControlHookRefs(parsed.refs),
    mutatingActionExecuted: parsed.mutatingActionExecuted === true,
    providerEvidenceWritten: parsed.providerEvidenceWritten === true,
    affectsPhysicalDisplay: parsed.affectsPhysicalDisplay === false ? false : undefined,
    sharedSystemInputUsed: parsed.sharedSystemInputUsed === false ? false : undefined,
    systemPointerMoved: parsed.systemPointerMoved === false ? false : undefined,
    systemKeyboardEventsSent: parsed.systemKeyboardEventsSent === false ? false : undefined,
  };
}

function nativeDriverInputAdapterCapability(value: unknown): NativeVirtualDisplayDriverInputControlResult['inputAdapterCapability'] | undefined {
  if (!recordLike(value)) return undefined;
  return {
    ok: value.ok === true,
    mechanism: nativeDriverInputControlSafeFailureDetail(value.mechanism),
    detail: nativeDriverInputControlSafeFailureDetail(value.detail),
    refs: nativeDriverInputControlHookRefs(value.refs),
  };
}

function nativeDriverInputControlHookRefs(value: unknown): Record<string, string | string[] | undefined> | undefined {
  if (!recordLike(value)) return undefined;
  const refs: Record<string, string | string[] | undefined> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      refs[key] = entry.trim();
      continue;
    }
    if (Array.isArray(entry)) {
      const values = entry.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
      if (values.length) refs[key] = values;
    }
  }
  return refs;
}

function driverOptionsWithInputControlHook<T extends {
  outDir?: string;
  dependencies?: {
    probeInputAdapterCapability?: (
      context: Parameters<NativeVirtualDisplayDriverInputControlHook>[0],
    ) => MacosVirtualDisplayDriverInputAdapterCapability | Promise<MacosVirtualDisplayDriverInputAdapterCapability>;
    sendInputIntent?: NativeVirtualDisplayDriverInputControlHook;
    pauseAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
    resumeAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
    safeStopSession?: NativeVirtualDisplayDriverInputControlHook;
  };
}>(
  driverOptions: T | undefined,
  hook: NativeVirtualDisplayDriverInputControlHook | undefined,
): T | undefined {
  if (!hook) return driverOptions;
  const hookWithEvidenceRoot = nativeDriverInputControlHookWithEvidenceRoot(hook, driverOptions?.outDir);
  return {
    ...(driverOptions ?? {} as T),
    dependencies: {
      ...(driverOptions?.dependencies ?? {}),
      probeInputAdapterCapability: driverOptions?.dependencies?.probeInputAdapterCapability
        ?? createNativeDriverInputAdapterCapabilityProbe(hookWithEvidenceRoot),
      sendInputIntent: driverOptions?.dependencies?.sendInputIntent ?? hookWithEvidenceRoot,
      pauseAgentQueue: driverOptions?.dependencies?.pauseAgentQueue ?? hookWithEvidenceRoot,
      resumeAgentQueue: driverOptions?.dependencies?.resumeAgentQueue ?? hookWithEvidenceRoot,
      safeStopSession: driverOptions?.dependencies?.safeStopSession ?? hookWithEvidenceRoot,
    },
  };
}

function driverOptionsWithEnvDefaults<T extends {
  windowTimeoutMs?: number;
}>(
  driverOptions: T | undefined,
  envOptions: RuntimeNativeDriverEnvOptions | undefined,
): T | undefined {
  if (envOptions?.windowTimeoutMs === undefined) return driverOptions;
  return {
    ...(driverOptions ?? {} as T),
    windowTimeoutMs: driverOptions?.windowTimeoutMs ?? envOptions.windowTimeoutMs,
  };
}

function nativeDriverInputControlHookWithEvidenceRoot(
  hook: NativeVirtualDisplayDriverInputControlHook,
  outDir: string | undefined,
): NativeVirtualDisplayDriverInputControlHook {
  return (context) => hook({
    ...context,
    evidenceRoot: context.evidenceRoot ?? nativeDriverInputControlEvidenceRoot(context, outDir),
  });
}

function nativeDriverInputControlEvidenceRoot(
  context: Parameters<NativeVirtualDisplayDriverInputControlHook>[0],
  outDir: string | undefined,
): Parameters<NativeVirtualDisplayDriverInputControlHook>[0]['evidenceRoot'] | undefined {
  const providerRootRef = stringRef(context.refs.providerRootRef);
  if (!providerRootRef) return undefined;
  const runDirRef = runDirRefForProviderRootRef(providerRootRef) ?? runDirRefForCurrentRunRef(stringRef(context.refs.currentRunRef));
  if (!runDirRef) return undefined;
  return {
    outDir: outDir ?? join(process.cwd(), runDirRef),
    runDirRef,
    providerRootRef,
  };
}

function runDirRefForProviderRootRef(providerRootRef: string): string | undefined {
  const suffix = '/virtual-display-provider';
  if (!providerRootRef.endsWith(suffix)) return undefined;
  return providerRootRef.slice(0, -suffix.length);
}

function runDirRefForCurrentRunRef(currentRunRef: string | undefined): string | undefined {
  const suffix = '/current-run.json';
  if (!currentRunRef?.endsWith(suffix)) return undefined;
  return currentRunRef.slice(0, -suffix.length);
}

function stringRef(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createNativeDriverInputAdapterCapabilityProbe(
  hook: NativeVirtualDisplayDriverInputControlHook,
) {
  return async (context: Parameters<NativeVirtualDisplayDriverInputControlHook>[0]): Promise<MacosVirtualDisplayDriverInputAdapterCapability> => {
    const result = await hook({ ...context, capabilityProbe: true });
    if (!result.ok) {
      return {
        ok: false,
        detail: result.detail ?? 'input/control hook capability probe reported failure',
      };
    }
    if (result.mutatingActionExecuted === true) {
      return {
        ok: false,
        detail: 'input/control hook capability probe must be non-mutating',
      };
    }
    if (!result.inputAdapterCapability) {
      return {
        ok: false,
        detail: 'input/control hook did not return inputAdapterCapability',
      };
    }
    return result.inputAdapterCapability;
  };
}

function boundedAppend(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > 1024 * 1024 ? next.slice(0, 1024 * 1024) : next;
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
  'editableWindowReadiness',
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
    if (key === 'editableWindowReadiness') {
      const parsedReadiness = parseTargetAppEditableWindowReadiness(
        rawValue,
        `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.editableWindowReadiness`,
      );
      if (!parsedReadiness.ok) return parsedReadiness;
      targetApp.editableWindowReadiness = parsedReadiness.editableWindowReadiness;
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

const editableWindowReadinessBooleanKeys = [
  'required',
  'requireAxWindow',
  'requireNonEmptyTitle',
  'requireEditableSurfaceEvidence',
] as const satisfies ReadonlyArray<keyof RuntimeNativeDriverEditableWindowReadiness>;
const editableWindowReadinessJsonKeys = new Set<keyof RuntimeNativeDriverEditableWindowReadiness>([
  ...editableWindowReadinessBooleanKeys,
  'mode',
  'rejectTitlePattern',
]);

function parseTargetAppEditableWindowReadiness(
  value: unknown,
  source: string,
): { ok: true; editableWindowReadiness: RuntimeNativeDriverEditableWindowReadiness } | { ok: false; reason: string } {
  if (!recordLike(value)) {
    return { ok: false, reason: `${source} must be a JSON object.` };
  }
  const editableWindowReadiness: RuntimeNativeDriverEditableWindowReadiness = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!editableWindowReadinessJsonKeys.has(key as keyof RuntimeNativeDriverEditableWindowReadiness)) {
      return { ok: false, reason: `${source} contains unsupported key "${key}".` };
    }
    if (editableWindowReadinessBooleanKeys.includes(key as typeof editableWindowReadinessBooleanKeys[number])) {
      if (typeof rawValue !== 'boolean') {
        return { ok: false, reason: `${source}.${key} must be a boolean.` };
      }
      editableWindowReadiness[key as typeof editableWindowReadinessBooleanKeys[number]] = rawValue;
      continue;
    }
    if (key === 'mode') {
      if (rawValue !== 'document' && rawValue !== 'presentation') {
        return { ok: false, reason: `${source}.mode must be "document" or "presentation".` };
      }
      editableWindowReadiness.mode = rawValue;
      continue;
    }
    if (key === 'rejectTitlePattern') {
      if (typeof rawValue !== 'string') {
        return { ok: false, reason: `${source}.rejectTitlePattern must be a string.` };
      }
      const pattern = rawValue.trim();
      if (!pattern) continue;
      try {
        new RegExp(pattern);
      } catch {
        return { ok: false, reason: `${source}.rejectTitlePattern is not a valid regular expression.` };
      }
      editableWindowReadiness.rejectTitlePattern = pattern;
    }
  }
  return { ok: true, editableWindowReadiness };
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
      editableWindowReadiness: targetApp.editableWindowReadiness,
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

type NativeDriverHookConfigBlockedProviderHooks = MacosVirtualDisplayProviderHooks | PlatformVirtualDisplayProviderHooks;

function providerOptionsWithInputControlHookConfigBlock<T extends {
  hooks?: NativeDriverHookConfigBlockedProviderHooks;
}>(
  providerOptions: T | undefined,
  reason: string | undefined,
): T | undefined {
  if (!reason) return providerOptions;
  return {
    ...(providerOptions ?? {} as T),
    hooks: {
      ...(providerOptions?.hooks ?? {}),
      ...nativeDriverInputControlHookConfigBlockedHooks(reason),
    },
  };
}

function nativeDriverInputControlHookConfigBlockedHooks(reason: string): NativeDriverHookConfigBlockedProviderHooks {
  const blockedReason = `Native driver input/control hook configuration is invalid: ${reason}`;
  const hook = (_operationOptions: VirtualDisplayProviderOperationOptions) => ({
    providerExecuted: true as const,
    blockedReason,
    mutatingActionExecuted: false as const,
    providerEvidenceWritten: false as const,
  });
  return {
    probe: hook,
    createSession: hook,
    launchApp: hook,
    attachSurface: hook,
    readFrame: hook,
    sendInputIntent: hook,
    pause: hook,
    resume: hook,
    handoff: hook,
    closeSession: hook,
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
  resetVirtualAppScreenProviderSessionStoreForTests();
  resetVirtualAppScreenNativeHostSessionStoreForTests();
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
      const nativeHost = await tryRunVirtualAppScreenInputRuntimeNativeHost(command, {
        executorId: fallback.executorId,
        providerId: 'native-virtual-app-screen-host',
      });
      if (nativeHost) return nativeHost;
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
