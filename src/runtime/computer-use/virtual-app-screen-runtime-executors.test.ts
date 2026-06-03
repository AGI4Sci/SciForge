import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseVirtualScreenInputIntentCommand,
  VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE,
} from './input-intent-command.js';
import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
} from './native-providers/macos-virtual-display-provider.js';
import {
  type MacosVirtualDisplayDriverDependencies,
} from './native-providers/macos-virtual-display-driver.js';
import {
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
} from './native-providers/linux-xpra-virtual-display-provider.js';
import {
  type LinuxXpraVirtualDisplayDriverDependencies,
} from './native-providers/linux-xpra-virtual-display-driver.js';
import {
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
} from './native-providers/windows-idd-virtual-display-provider.js';
import {
  type WindowsIddVirtualDisplayDriverDependencies,
} from './native-providers/windows-idd-virtual-display-driver.js';
import { parseVirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import {
  listVirtualAppScreenInputRuntimeExecutors,
  registerVirtualAppScreenInputRuntimeExecutor,
  runVirtualAppScreenInputRuntime,
  virtualAppScreenInputRuntimeProjection,
} from './virtual-app-screen-input-runtime.js';
import {
  attachVirtualAppScreenSession,
  listVirtualAppScreenSessionExecutors,
  registerVirtualAppScreenSessionExecutor,
  virtualAppScreenSessionManagerResultToVirtualScreenData,
  VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
} from './virtual-app-screen-session-manager.js';
import {
  ensureVirtualAppScreenRuntimeExecutorsRegistered,
  resetVirtualAppScreenRuntimeExecutorsForTests,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV,
} from './virtual-app-screen-runtime-executors.js';

test('runtime executor bootstrap registers a fail-closed macOS native provider shell', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
  });
  try {
    assert.deepEqual(registered.registeredExecutorIds, [
      'native-session-manager:macos-virtual-display-provider',
      'input-runtime:macos-virtual-display-provider',
    ]);
    assert.equal(registered.alreadyRegistered, false);
    assert.ok(listVirtualAppScreenSessionExecutors().some((executor) => executor.executorId === 'native-session-manager:macos-virtual-display-provider'));
    assert.ok(listVirtualAppScreenInputRuntimeExecutors().some((executor) => executor.executorId === 'input-runtime:macos-virtual-display-provider'));

    const result = await attachVirtualAppScreenSession(parsedAttachCommand());
    const data = virtualAppScreenSessionManagerResultToVirtualScreenData(parsedAttachCommand(), result);

    assert.ok(['blocked', 'permission-missing'].includes(result.status));
    assert.equal(result.executorId, 'native-session-manager:macos-virtual-display-provider');
    assert.equal(result.providerId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
    assert.equal(result.evidence.providerExecuted, false);
    assert.match(result.blockedReason ?? '', /side-effect hook is not registered|permission or driver readiness is not proven|installable but not installed/);
    assert.ok(['blocked', 'permission-missing'].includes(String(data.attachState)));
    assert.equal(data.sessionRef, undefined);
    assert.equal(data.liveSurfaceRef, undefined);
    assert.equal(data.currentFrameRef, undefined);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap registers a provider-backed fail-closed macOS input runtime shell', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
  });
  try {
    assert.ok(registered.registeredExecutorIds.includes('input-runtime:macos-virtual-display-provider'));

    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommand());

    assert.equal(result.status, 'blocked');
    assert.equal(result.executorId, 'input-runtime:macos-virtual-display-provider');
    assert.equal(result.providerId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
    assert.equal(result.evidence.providerExecuted, false);
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.match(result.message, /probe was not ready|side-effect hook is not registered/);
    assert.match(String(result.routeDecision.adapterReadinessRef), /^\.sciforge\/vision-runs\/.+\/virtual-display-provider\/adapter-readiness\.json$/);
    assert.notEqual(result.routeDecision.adapterReadinessRef, parsedCanvasInputCommand().refs.adapterReadinessRef);
    assert.notEqual(result.status, 'blocked-no-provider');
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap is idempotent and unsupported platforms stay fail-closed without registration', () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const first = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'freebsd',
    nativeDriverHooks: { enabled: true },
  });
  const second = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'freebsd',
    nativeDriverHooks: {
      env: { [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: 'true' },
    },
  });
  try {
    assert.deepEqual(first.registeredExecutorIds, []);
    assert.equal(first.alreadyRegistered, false);
    assert.deepEqual(second.registeredExecutorIds, []);
    assert.equal(second.alreadyRegistered, true);
    assert.equal(listVirtualAppScreenSessionExecutors().length, 0);
    assert.equal(listVirtualAppScreenInputRuntimeExecutors().length, 0);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap ignores native driver options unless hook factories are explicitly enabled', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'linux',
    linuxProviderOptions: readyLinuxProviderOptions(),
    nativeDriverHooks: {
      linux: {
        targetApp: { kind: 'generic-editor', command: 'research-editor' },
        probeOptions: readyLinuxDriverProbeOptions('generic-editor'),
        dependencies: fakeLinuxXpraDriverDependencies(),
      },
    },
  });
  try {
    assert.deepEqual(registered.registeredExecutorIds, [
      'native-session-manager:linux-xpra-provider',
      'input-runtime:linux-xpra-provider',
    ]);

    const result = await attachVirtualAppScreenSession(parsedAttachCommand('generic-editor'));

    assert.equal(result.status, 'blocked');
    assert.equal(result.executorId, 'native-session-manager:linux-xpra-provider');
    assert.equal(result.providerId, LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID);
    assert.equal(result.evidence.providerExecuted, false);
    assert.match(result.blockedReason ?? '', /Linux Xpra VirtualDisplayProvider probe side-effect hook is not registered/);
    assert.equal(result.refs.sessionRef, undefined);
    assert.equal(result.refs.liveSurfaceRef, undefined);
    assert.equal(result.refs.currentFrameRef, undefined);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap can opt into native driver hook factories with injected generic deps', async (t) => {
  const profile = 'generic-editor';
  const cases = [
    {
      name: 'macOS',
      options: {
        platform: 'darwin',
        macosProviderOptions: readyMacosProviderOptions(),
        nativeDriverHooks: {
          enabled: true,
          macos: {
            targetApp: { kind: profile, command: 'research-editor' },
            probeOptions: readyMacosDriverProbeOptions(profile),
            dependencies: fakeMacosDriverDependencies(),
          },
        },
      },
      sessionExecutorId: 'native-session-manager:macos-virtual-display-provider',
      providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    },
    {
      name: 'Linux',
      options: {
        platform: 'linux',
        linuxProviderOptions: readyLinuxProviderOptions(),
        nativeDriverHooks: {
          env: { [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: 'true' },
          linux: {
            targetApp: { kind: profile, command: 'research-editor' },
            probeOptions: readyLinuxDriverProbeOptions(profile),
            dependencies: fakeLinuxXpraDriverDependencies(),
          },
        },
      },
      sessionExecutorId: 'native-session-manager:linux-xpra-provider',
      providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    },
    {
      name: 'Windows',
      options: {
        platform: 'win32',
        windowsProviderOptions: readyWindowsProviderOptions(),
        nativeDriverHooks: {
          enabled: true,
          windows: {
            platform: 'win32',
            targetApp: { kind: profile, command: 'research-editor' },
            probeOptions: readyWindowsDriverProbeOptions(profile),
            dependencies: fakeWindowsIddDriverDependencies(),
          },
        },
      },
      sessionExecutorId: 'native-session-manager:windows-idd-provider',
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      resetVirtualAppScreenRuntimeExecutorsForTests();
      const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered(testCase.options);
      try {
        assert.ok(registered.registeredExecutorIds.includes(testCase.sessionExecutorId));

        const result = await attachVirtualAppScreenSession(parsedAttachCommand(profile));
        const data = virtualAppScreenSessionManagerResultToVirtualScreenData(parsedAttachCommand(profile), result);

        assert.equal(result.status, 'attached');
        assert.equal(result.executorId, testCase.sessionExecutorId);
        assert.equal(result.providerId, testCase.providerId);
        assert.equal(result.evidence.providerExecuted, true);
        assert.equal(result.evidence.nativeSessionCreated, true);
        assert.equal(result.evidence.currentFrameMaterialized, true);
        assert.equal(result.evidence.surfaceTransport?.owner, 'VirtualDisplayProvider');
        assert.equal(result.evidence.surfaceTransport?.productFallback, false);
        assert.equal(result.evidence.surfaceTransport?.singleInteractiveTruth, true);
        assert.match(result.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\/session-1\/session\.json$/);
        assert.match(result.refs.liveSurfaceRef ?? '', /^computer-use:native-host\/surfaces\//);
        assert.match(result.refs.currentFrameRef ?? '', /^computer-use:native-host\/frames\//);
        assert.match(result.refs.platformDriverRef ?? '', /^computer-use:native-host\/platform-drivers\//);
        assert.equal(data.attachState, 'attached');
      } finally {
        resetVirtualAppScreenRuntimeExecutorsForTests();
      }
    });
  }
});

test('runtime executor bootstrap maps opt-in env target app into driver, probe, and executor defaults', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const launchSpecs: Array<Record<string, unknown>> = [];
  const targetWindowTimeouts: number[] = [];
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV]: '45000',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: ' json-editor ',
          name: ' JSON Editor ',
          command: ' research-editor --do-not-split ',
          args: [' --json ', 'two words'],
          bundleId: ' com.example.JsonEditor ',
          appPath: ' /Applications/JsonEditor.app ',
          appUserModelId: 'should-not-reach-macos',
          processMatch: ' JsonEditor.* ',
          windowTitlePattern: ' ^Document ',
          editableWindowReadiness: {
            required: true,
            mode: 'document',
            rejectTitlePattern: '^(?:Open|Save)\\b',
            requireAxWindow: true,
            requireNonEmptyTitle: true,
            requireEditableSurfaceEvidence: true,
          },
        }),
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: ' scalar-editor ',
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON: '["--scalar","two words"]',
      },
      macos: {
        dependencies: fakeMacosDriverDependencies({
          launchApp: (spec) => {
            launchSpecs.push(spec as Record<string, unknown>);
            return {
              pids: [4242],
              details: { launchMode: 'captured-env-target' },
            };
          },
          waitForTargetWindow: (input) => {
            targetWindowTimeouts.push(input.timeoutMs);
            return {
              cgWindow: {
                pid: 4242,
                windowNumber: 19,
                ownerName: 'Research Editor',
                title: 'Untitled',
                layer: 0,
                x: 1600,
                y: 0,
                width: 1000,
                height: 700,
              },
              axWindow: {
                pid: 4242,
                windowIndex: 1,
                title: 'Untitled',
                x: 1600,
                y: 0,
                width: 1000,
                height: 700,
              },
            };
          },
        }),
      },
    },
  });
  try {
    assert.ok(registered.registeredExecutorIds.includes('native-session-manager:macos-virtual-display-provider'));

    const result = await attachVirtualAppScreenSession(parsedAttachCommand('vscode-editor'));

    assert.equal(result.status, 'attached');
    assert.equal(launchSpecs.length, 1);
    assert.deepEqual(targetWindowTimeouts, [45000]);
    assert.deepEqual(launchSpecs[0], {
      kind: 'scalar-editor',
      name: 'JSON Editor',
      command: 'research-editor --do-not-split',
      args: ['--scalar', 'two words'],
      bundleId: 'com.example.JsonEditor',
      appPath: '/Applications/JsonEditor.app',
      processMatch: 'JsonEditor.*',
      windowTitlePattern: '^Document',
      editableWindowReadiness: {
        required: true,
        mode: 'document',
        rejectTitlePattern: '^(?:Open|Save)\\b',
        requireAxWindow: true,
        requireNonEmptyTitle: true,
        requireEditableSurfaceEvidence: true,
      },
    });
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap keeps explicit programmatic target options above env defaults', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const launchSpecs: Array<Record<string, unknown>> = [];
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: 'true',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'env-editor',
          name: 'Env Editor',
          command: 'env-editor',
          bundleId: 'com.example.EnvEditor',
        }),
      },
      macos: {
        targetApp: {
          kind: 'programmatic-editor',
          name: 'Programmatic Editor',
          command: 'programmatic-editor',
          bundleId: 'com.example.ProgrammaticEditor',
        },
        dependencies: fakeMacosDriverDependencies({
          launchApp: (spec) => {
            launchSpecs.push(spec as Record<string, unknown>);
            return {
              pids: [4242],
              details: { launchMode: 'captured-programmatic-target' },
            };
          },
        }),
      },
    },
  });
  try {
    const result = await attachVirtualAppScreenSession(parsedAttachCommand('vscode-editor'));

    assert.equal(result.status, 'attached');
    assert.equal(launchSpecs[0]?.kind, 'programmatic-editor');
    assert.equal(launchSpecs[0]?.name, 'Programmatic Editor');
    assert.equal(launchSpecs[0]?.command, 'programmatic-editor');
    assert.equal(launchSpecs[0]?.bundleId, 'com.example.ProgrammaticEditor');
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap filters env target app fields by native platform', async (t) => {
  await t.test('linux drops non-linux app identity fields', async () => {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    const launchSpecs: Array<Record<string, unknown>> = [];
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'linux',
      linuxProviderOptions: readyLinuxProviderOptions(),
      nativeDriverHooks: {
        env: {
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
            kind: 'linux-editor',
            command: 'linux-editor',
            bundleId: 'com.example.LinuxEditor',
            appPath: '/opt/linux-editor',
            appUserModelId: 'Example.LinuxEditor',
          }),
        },
        linux: {
          dependencies: fakeLinuxXpraDriverDependencies({
            launchApp: (_session, spec) => {
              launchSpecs.push(spec as Record<string, unknown>);
              return {
                pids: [5151],
                details: { launchMode: 'captured-linux-target' },
              };
            },
          }),
        },
      },
    });
    try {
      const result = await attachVirtualAppScreenSession(parsedAttachCommand());

      assert.equal(result.status, 'attached');
      assert.equal(launchSpecs[0]?.kind, 'linux-editor');
      assert.equal(launchSpecs[0]?.command, 'linux-editor');
      assert.equal('bundleId' in (launchSpecs[0] ?? {}), false);
      assert.equal('appUserModelId' in (launchSpecs[0] ?? {}), false);
      assert.equal('appPath' in (launchSpecs[0] ?? {}), false);
    } finally {
      resetVirtualAppScreenRuntimeExecutorsForTests();
    }
  });

  await t.test('windows keeps Windows app identity fields and drops macOS bundleId', async () => {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    const launchSpecs: Array<Record<string, unknown>> = [];
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'win32',
      windowsProviderOptions: readyWindowsProviderOptions(),
      nativeDriverHooks: {
        env: {
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: 'yes',
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
            kind: 'windows-editor',
            command: 'windows-editor.exe',
            bundleId: 'com.example.WindowsEditor',
            appPath: 'C:\\Program Files\\WindowsEditor\\WindowsEditor.exe',
            appUserModelId: 'Example.WindowsEditor_123!App',
          }),
        },
        windows: {
          platform: 'win32',
          dependencies: fakeWindowsIddDriverDependencies({
            launchApp: (spec) => {
              launchSpecs.push(spec as Record<string, unknown>);
              return {
                pids: [4242],
                details: { launchMode: 'captured-windows-target' },
              };
            },
          }),
        },
      },
    });
    try {
      const result = await attachVirtualAppScreenSession(parsedAttachCommand());

      assert.equal(result.status, 'attached');
      assert.equal(launchSpecs[0]?.kind, 'windows-editor');
      assert.equal(launchSpecs[0]?.command, 'windows-editor.exe');
      assert.equal(launchSpecs[0]?.appPath, 'C:\\Program Files\\WindowsEditor\\WindowsEditor.exe');
      assert.equal(launchSpecs[0]?.appUserModelId, 'Example.WindowsEditor_123!App');
      assert.equal('bundleId' in (launchSpecs[0] ?? {}), false);
    } finally {
      resetVirtualAppScreenRuntimeExecutorsForTests();
    }
  });
});

test('runtime executor bootstrap ignores target app env unless native driver hooks are opted in', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'linux',
    linuxProviderOptions: readyLinuxProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: '{not-json',
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON: '"not-array"',
      },
      linux: {
        dependencies: fakeLinuxXpraDriverDependencies(),
      },
    },
  });
  try {
    assert.deepEqual(registered.registeredExecutorIds, [
      'native-session-manager:linux-xpra-provider',
      'input-runtime:linux-xpra-provider',
    ]);

    const result = await attachVirtualAppScreenSession(parsedAttachCommand('generic-editor'));

    assert.equal(result.status, 'blocked');
    assert.equal(result.evidence.providerExecuted, false);
    assert.match(result.blockedReason ?? '', /Linux Xpra VirtualDisplayProvider probe side-effect hook is not registered/);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap fail-closes without native provider registration on invalid opt-in target app env', async (t) => {
  const cases = [
    {
      name: 'invalid JSON',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: '{not-json',
      },
    },
    {
      name: 'unsupported JSON key',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'generic-editor',
          sessionRef: 'computer-use:session/not-accepted',
        }),
      },
    },
    {
      name: 'invalid args JSON',
      env: {
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON: '"--single-string"',
      },
    },
    {
      name: 'non-string args JSON item',
      env: {
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON: '["--ok", 1]',
      },
    },
    {
      name: 'unsupported editable readiness key',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'generic-editor',
          command: 'research-editor',
          editableWindowReadiness: {
            required: true,
            unknownEvidence: true,
          },
        }),
      },
    },
    {
      name: 'wrong editable readiness type',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'generic-editor',
          command: 'research-editor',
          editableWindowReadiness: {
            required: 'yes',
          },
        }),
      },
    },
    {
      name: 'invalid editable readiness mode',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'generic-editor',
          command: 'research-editor',
          editableWindowReadiness: {
            mode: 'spreadsheet',
          },
        }),
      },
    },
    {
      name: 'invalid editable readiness reject title regex',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify({
          kind: 'generic-editor',
          command: 'research-editor',
          editableWindowReadiness: {
            rejectTitlePattern: '[',
          },
        }),
      },
    },
    {
      name: 'invalid regex',
      env: {
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH: '[',
      },
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      resetVirtualAppScreenRuntimeExecutorsForTests();
      const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
        platform: 'darwin',
        macosProviderOptions: readyMacosProviderOptions(),
        nativeDriverHooks: {
          env: {
            [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
            ...testCase.env,
          },
          macos: {
            dependencies: fakeMacosDriverDependencies(),
          },
        },
      });
      try {
        assert.deepEqual(registered.registeredExecutorIds, []);
        assert.equal(listVirtualAppScreenSessionExecutors().length, 0);
        assert.equal(listVirtualAppScreenInputRuntimeExecutors().length, 0);

        const result = await attachVirtualAppScreenSession(parsedAttachCommand());

        assert.equal(result.status, 'blocked');
        assert.match(result.blockedReason ?? '', /No runtime-owned native VirtualAppScreen session executor is registered/);
        assert.equal(result.evidence.providerExecuted, false);
      } finally {
        resetVirtualAppScreenRuntimeExecutorsForTests();
      }
    });
  }
});

test('runtime executor bootstrap registers fail-closed provider shell on invalid env input/control hook config', async (t) => {
  const cases = [
    {
      name: 'invalid native driver window timeout',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV]: 'not-a-timeout',
      },
      reason: new RegExp(VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS_ENV, 'u'),
    },
    {
      name: 'invalid args JSON',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: '"not-array"',
      },
      reason: new RegExp(VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV, 'u'),
    },
    {
      name: 'invalid timeout',
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV]: '10',
      },
      reason: new RegExp(VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV, 'u'),
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      resetVirtualAppScreenRuntimeExecutorsForTests();
      const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
        platform: 'darwin',
        macosProviderOptions: readyMacosProviderOptions(),
        nativeDriverHooks: {
          env: {
            [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
            ...testCase.env,
          },
          macos: {
            targetApp: { kind: 'vscode-editor', command: 'research-editor' },
            probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
            dependencies: fakeMacosDriverDependencies(),
          },
        },
      });
      try {
        assert.deepEqual(registered.registeredExecutorIds, [
          'native-session-manager:macos-virtual-display-provider',
          'input-runtime:macos-virtual-display-provider',
        ]);

        const result = await attachVirtualAppScreenSession(parsedAttachCommand());

        assert.equal(result.status, 'blocked');
        assert.equal(result.executorId, 'native-session-manager:macos-virtual-display-provider');
        assert.equal(result.providerId, MACOS_VIRTUAL_DISPLAY_PROVIDER_ID);
        assert.equal(result.evidence.providerExecuted, false);
        assert.match(result.blockedReason ?? '', testCase.reason);
        const runDirRef = requiredString(result.refs.currentRunRef).replace(/\/current-run\.json$/u, '');
        assert.equal(requiredString(result.refs.adapterReadinessRef), `${runDirRef}/virtual-display-provider/adapter-readiness.json`);
        assert.equal(requiredString(result.refs.blockedRef), `${runDirRef}/virtual-display-provider/blocked/probe.json`);
      } finally {
        resetVirtualAppScreenRuntimeExecutorsForTests();
      }
    });
  }
});

test('runtime executor bootstrap registers fail-closed Linux and Windows provider shells', async (t) => {
  const cases = [
    {
      name: 'linux',
      platform: 'linux',
      providerId: 'virtual-display.linux.xpra',
      sessionExecutorId: 'native-session-manager:linux-xpra-provider',
      inputExecutorId: 'input-runtime:linux-xpra-provider',
      options: {
        platform: 'linux',
        linuxProviderOptions: readyLinuxProviderOptions(),
      },
      blockedReason: /Linux Xpra VirtualDisplayProvider .* side-effect hook is not registered/,
    },
    {
      name: 'windows',
      platform: 'win32',
      providerId: 'virtual-display.windows.idd',
      sessionExecutorId: 'native-session-manager:windows-idd-provider',
      inputExecutorId: 'input-runtime:windows-idd-provider',
      options: {
        platform: 'win32',
        windowsProviderOptions: readyWindowsProviderOptions(),
      },
      blockedReason: /Windows IDD VirtualDisplayProvider .* side-effect hook is not registered/,
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      resetVirtualAppScreenRuntimeExecutorsForTests();
      const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered(testCase.options);
      try {
        assert.deepEqual(registered.registeredExecutorIds, [
          testCase.sessionExecutorId,
          testCase.inputExecutorId,
        ]);
        assert.equal(registered.alreadyRegistered, false);
        assert.ok(listVirtualAppScreenSessionExecutors().some((executor) => executor.executorId === testCase.sessionExecutorId));
        assert.ok(listVirtualAppScreenInputRuntimeExecutors().some((executor) => executor.executorId === testCase.inputExecutorId));

        const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
        const data = virtualAppScreenSessionManagerResultToVirtualScreenData(parsedAttachCommand(), attachResult);

        assert.equal(attachResult.status, 'blocked');
        assert.equal(attachResult.executorId, testCase.sessionExecutorId);
        assert.equal(attachResult.providerId, testCase.providerId);
        assert.equal(attachResult.evidence.providerExecuted, false);
        assert.match(attachResult.blockedReason ?? '', testCase.blockedReason);
        assert.equal(data.sessionRef, undefined);
        assert.equal(data.liveSurfaceRef, undefined);
        assert.equal(data.currentFrameRef, undefined);

        const inputResult = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommand());

        assert.equal(inputResult.status, 'blocked');
        assert.equal(inputResult.executorId, testCase.inputExecutorId);
        assert.equal(inputResult.providerId, testCase.providerId);
        assert.equal(inputResult.evidence.providerExecuted, false);
        assert.match(inputResult.message, testCase.blockedReason);
      } finally {
        resetVirtualAppScreenRuntimeExecutorsForTests();
      }
    });
  }
});

test('runtime executor bootstrap does not take precedence over an already registered product executor even with native driver hooks enabled', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  let driverTouched = false;
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      enabled: true,
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies({
          loadVirtualDisplayPackage: () => {
            driverTouched = true;
            return { createVirtualDisplay: true };
          },
        }),
      },
    },
  });
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:product-test',
    providerId: 'provider:product-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => ({
      schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
      status: 'attached',
      executorId: 'native-session-manager:product-test',
      providerId: 'provider:product-test',
      refs: {
        currentRunRef: '.sciforge/vision-runs/product-test/current-run.json',
        currentRunPointerRef: 'computer-use:native-host/runs/product-test/current-run-pointer.json',
        sessionRef: 'computer-use:native-host/sessions/product-test/session.json',
        liveSurfaceRef: 'computer-use:native-host/surfaces/product-test/live-surface.json',
        surfaceTransportRef: 'computer-use:native-host/surfaces/product-test/surface-transport.json',
        frameStreamRef: 'computer-use:native-host/surfaces/product-test/frame-stream.json',
        currentFrameRef: 'computer-use:native-host/frames/product-test/current.png',
        frameTransportContractRef: 'computer-use:native-host/surfaces/product-test/frame-transport-contract.json',
        frameTelemetryRef: 'computer-use:native-host/surfaces/product-test/frame-telemetry.json',
        mediaChannelRef: 'computer-use:native-host/surfaces/product-test/native-frame-stream/live',
        dataChannelRef: 'computer-use:native-host/surfaces/product-test/native-frame-control-channel/control',
        liveBindingAttachGrantRef: 'computer-use:native-host/grants/product-test/live-binding-attach-grant.json',
        grantValidationRef: 'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0004-grant.validated.json',
        surfaceOwnerRef: 'computer-use:native-host/surfaces/product-test/surface-owner.json',
        displayOwnerRef: 'computer-use:native-host/surfaces/product-test/display-owner.json',
        screenRef: command.refs.screenRef,
        targetAppRef: command.refs.targetAppRef,
        targetWindowRef: 'window:product-test/main',
        inputLeaseRef: 'computer-use:native-host/input/product-test/input-lease.json',
        actionAdapterRef: 'computer-use:native-host/input/product-test/action-adapter.json',
        adapterReadinessRef: command.refs.readinessRef,
        platformDriverRef: 'computer-use:native-host/platform-drivers/product-test/platform-driver.json',
        evidenceLedgerRef: 'computer-use:native-host/ledgers/product-test/evidence-ledger.json',
        minimalEvidenceReplayRefs: [
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0001-session.created.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0003-surface.attached.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0004-grant.validated.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0005-frame.read.json',
        ],
        guiPresentRef: command.refs.guiPresentRef,
      },
      evidence: {
        providerExecuted: true,
        mutatingActionExecuted: false,
        nativeSessionCreated: true,
        liveFrameAttached: true,
        currentFrameMaterialized: true,
        guiPresented: true,
        isolationVerified: true,
        platformDriverReady: true,
        permissionRequired: false,
        permissionGranted: true,
        backgroundRenderable: true,
        diagnosticOnly: false,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        surfaceTransport: {
          schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
          owner: 'VirtualDisplayProvider',
          providerId: 'provider:product-test',
          transport: 'native-frame-stream',
          surfaceTransportRef: 'computer-use:native-host/surfaces/product-test/surface-transport.json',
          liveSurfaceRef: 'computer-use:native-host/surfaces/product-test/live-surface.json',
          frameStreamRef: 'computer-use:native-host/surfaces/product-test/frame-stream.json',
          currentFrameRef: 'computer-use:native-host/frames/product-test/current.png',
          frameTransportContractRef: 'computer-use:native-host/surfaces/product-test/frame-transport-contract.json',
          frameTelemetryRef: 'computer-use:native-host/surfaces/product-test/frame-telemetry.json',
          mediaChannelRef: 'computer-use:native-host/surfaces/product-test/native-frame-stream/live',
          dataChannelRef: 'computer-use:native-host/surfaces/product-test/native-frame-control-channel/control',
          currentFrameSequence: 1,
          diagnosticOnly: false,
          productFallback: false,
          singleInteractiveTruth: true,
        },
        evidenceRefs: [
          'computer-use:native-host/surfaces/product-test/surface-transport.json',
          'computer-use:native-host/platform-drivers/product-test/platform-driver.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json',
          'computer-use:native-host/runs/product-test/current-run-pointer.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0001-session.created.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0003-surface.attached.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0004-grant.validated.json',
          'computer-use:native-host/ledgers/product-test/evidence-ledger.json/events/0005-frame.read.json',
        ],
      },
    }),
  });
  try {
    const result = await attachVirtualAppScreenSession(parsedAttachCommand());

    assert.equal(result.status, 'attached');
    assert.equal(result.executorId, 'native-session-manager:product-test');
    assert.equal(driverTouched, false);
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap routes attached Host input through Host binding before provider fallback', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      enabled: true,
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached');
    assert.ok(attachResult.refs.sessionRef);
    assert.ok(attachResult.refs.screenRef);
    assert.ok(attachResult.refs.targetAppRef);
    assert.ok(attachResult.refs.targetWindowRef);
    assert.ok(attachResult.refs.currentFrameRef);
    assert.ok(attachResult.refs.inputLeaseRef);
    assert.ok(attachResult.refs.actionAdapterRef);
    assert.ok(attachResult.refs.evidenceLedgerRef);

    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: attachResult.refs.sessionRef,
      screenRef: attachResult.refs.screenRef,
      targetAppRef: attachResult.refs.targetAppRef,
      targetWindowRef: attachResult.refs.targetWindowRef,
      frameRef: attachResult.refs.currentFrameRef,
      inputLeaseRef: attachResult.refs.inputLeaseRef,
      actionAdapterRef: attachResult.refs.actionAdapterRef,
      adapterReadinessRef: attachResult.refs.adapterReadinessRef,
      evidenceLedgerRef: attachResult.refs.evidenceLedgerRef,
    }));

    assert.equal(result.status, 'blocked');
    assert.equal(result.executorId, 'input-runtime:macos-virtual-display-provider');
    assert.equal(result.providerId, 'native-virtual-app-screen-host');
    assert.equal(result.evidence.providerExecuted, false);
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.match(result.message, /isolated input\/control hook is not registered/);
    assert.doesNotMatch(result.message, /Provider readiness evidence/);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap executes attached Host input through provider-backed Host adapter', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  let hookCalls = 0;
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      enabled: true,
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies({
          sendInputIntent: (context) => {
            hookCalls += 1;
            assert.equal(context.operation, 'sendInputIntent');
            assert.equal(context.inputIntent.sessionRef, context.refs.sessionRef);
            const providerRootRef = stringRecordRef(context.refs, 'providerRootRef') ?? '.sciforge/vision-runs/runtime-executor-test/virtual-display-provider';
            return {
              ok: true,
              mutatingActionExecuted: true,
              providerEvidenceWritten: true,
              refs: {
                inputIntentRefs: [`${providerRootRef}/input-intents/host-click.json`],
                executorEventRefs: [`${providerRootRef}/executor-events/host-click.json`],
                beforeFrameRef: stringRecordRef(context.refs, 'currentFrameRef') ?? `${providerRootRef}/frames/host-click-before.json`,
                afterFrameRef: `${providerRootRef}/frames/host-click-after.json`,
                beforeAfterFrameRefs: [`${providerRootRef}/before-after/host-click.json`],
                verificationRefs: [`${providerRootRef}/verification/host-click.json`],
                isolationEvidenceRefs: [`${providerRootRef}/control-plane/sendInputIntent-host-click/isolation-evidence.json`],
                physicalDesktopProbeRefs: [`${providerRootRef}/control-plane/sendInputIntent-host-click/physical-desktop-probe.json`],
              },
              affectsPhysicalDisplay: false,
              sharedSystemInputUsed: false,
              systemPointerMoved: false,
              systemKeyboardEventsSent: false,
            };
          },
        }),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached');
    assert.ok(attachResult.refs.sessionRef);
    assert.ok(attachResult.refs.screenRef);
    assert.ok(attachResult.refs.targetAppRef);
    assert.ok(attachResult.refs.targetWindowRef);
    assert.ok(attachResult.refs.currentFrameRef);
    assert.ok(attachResult.refs.inputLeaseRef);
    assert.ok(attachResult.refs.actionAdapterRef);
    assert.ok(attachResult.refs.adapterReadinessRef);
    assert.ok(attachResult.refs.evidenceLedgerRef);

    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: attachResult.refs.sessionRef,
      screenRef: attachResult.refs.screenRef,
      targetAppRef: attachResult.refs.targetAppRef,
      targetWindowRef: attachResult.refs.targetWindowRef,
      frameRef: attachResult.refs.currentFrameRef,
      inputLeaseRef: attachResult.refs.inputLeaseRef,
      actionAdapterRef: attachResult.refs.actionAdapterRef,
      adapterReadinessRef: attachResult.refs.adapterReadinessRef,
      evidenceLedgerRef: attachResult.refs.evidenceLedgerRef,
    }));

    assert.equal(hookCalls, 1);
    assert.equal(result.status, 'executed');
    assert.equal(result.executorId, 'input-runtime:macos-virtual-display-provider');
    assert.equal(result.providerId, 'native-virtual-app-screen-host');
    assert.equal(result.evidence.providerExecuted, true);
    assert.equal(result.evidence.mutatingActionExecuted, true);
    assert.match(String(result.routeDecision.sessionRef), /^computer-use:native-host\/sessions\//);
    assert.match(String(result.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//);
    const runSummary = result.virtualScreenData.runSummary as { completionEligible?: unknown };
    assert.equal(runSummary.completionEligible, false);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap executes attached Host controls through provider-backed Host adapter', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const controlCalls: string[] = [];
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      enabled: true,
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies({
          pauseAgentQueue: (context) => {
            controlCalls.push(context.operation);
            assert.equal(context.operation, 'pause');
            assert.equal(context.inputIntent.sessionRef, context.refs.sessionRef);
            return providerControlHookResult(context.refs, 'takeover');
          },
          resumeAgentQueue: (context) => {
            controlCalls.push(context.operation);
            assert.equal(context.operation, 'resume');
            assert.equal(context.inputIntent.sessionRef, context.refs.sessionRef);
            return providerControlHookResult(context.refs, 'resume-agent');
          },
          safeStopSession: (context) => {
            controlCalls.push(context.operation);
            assert.equal(context.operation, 'closeSession');
            assert.equal(context.inputIntent.sessionRef, context.refs.sessionRef);
            return providerControlHookResult(context.refs, 'stop-session');
          },
        }),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached');
    assert.ok(attachResult.refs.sessionRef);
    assert.ok(attachResult.refs.screenRef);
    assert.ok(attachResult.refs.targetAppRef);
    assert.ok(attachResult.refs.targetWindowRef);
    assert.ok(attachResult.refs.inputLeaseRef);
    assert.ok(attachResult.refs.actionAdapterRef);
    assert.ok(attachResult.refs.adapterReadinessRef);
    assert.ok(attachResult.refs.evidenceLedgerRef);

    const baseRefs = {
      sessionRef: attachResult.refs.sessionRef,
      screenRef: attachResult.refs.screenRef,
      targetAppRef: attachResult.refs.targetAppRef,
      targetWindowRef: attachResult.refs.targetWindowRef,
      inputLeaseRef: attachResult.refs.inputLeaseRef,
      actionAdapterRef: attachResult.refs.actionAdapterRef,
      adapterReadinessRef: attachResult.refs.adapterReadinessRef,
      evidenceLedgerRef: attachResult.refs.evidenceLedgerRef,
    };

    const takeover = await runVirtualAppScreenInputRuntime(parsedControlInputCommandFromRefs('takeover', baseRefs));
    assert.equal(takeover.status, 'executed', takeover.message);
    assert.match(String(takeover.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//);
    assert.equal(takeover.routeDecision.currentFrameRefreshRef, undefined);
    assert.equal(takeover.routeDecision.safeStopRef, undefined);

    const resume = await runVirtualAppScreenInputRuntime(parsedControlInputCommandFromRefs('resume-agent', baseRefs));
    assert.equal(resume.status, 'executed', resume.message);
    assert.match(String(resume.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//);
    assert.match(String(resume.routeDecision.currentFrameRefreshRef), /^computer-use:native-host\/provider-adapter-control\//);
    assert.match(String(resume.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//);

    const stop = await runVirtualAppScreenInputRuntime(parsedControlInputCommandFromRefs('stop-session', baseRefs));
    assert.equal(stop.status, 'executed', stop.message);
    assert.match(String(stop.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//);
    assert.match(String(stop.routeDecision.safeStopRef), /^computer-use:native-host\/provider-adapter-control\//);
    assert.equal((stop.virtualScreenData.runSummary as Record<string, unknown>).closesUserRealApp, false);

    assert.deepEqual(controlCalls, ['pause', 'resume', 'closeSession']);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap binds env input/control shell hooks through the Host adapter', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-input-hook-'));
  const hookPath = join(outDir, 'input-control-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  await writeFile(hookPath, inputControlHookScript(callsPath), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    assert.equal(attachResult.evidence.diagnosticOnly, false);
    assert.match(requiredString(attachResult.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
    assert.match(requiredString(attachResult.refs.currentFrameRef), /^computer-use:native-host\/frames\//u);

    const baseRefs = {
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    };

    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs(baseRefs));
    assert.equal(input.status, 'executed', input.message);
    assert.equal(input.providerId, 'native-virtual-app-screen-host');
    assert.equal(input.evidence.providerExecuted, true);
    assert.equal(input.evidence.mutatingActionExecuted, true);
    assert.deepEqual(input.routeDecision.providerOperations, ['sendInputIntent', 'readFrame']);
    assert.match(String(input.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);

    const resume = await runVirtualAppScreenInputRuntime(parsedControlInputCommandFromRefs('resume-agent', baseRefs));
    assert.equal(resume.status, 'executed', resume.message);
    assert.equal(resume.providerId, 'native-virtual-app-screen-host');
    assert.deepEqual(resume.routeDecision.providerOperations, ['resume', 'readFrame']);
    assert.match(String(resume.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRefreshRef), /^computer-use:native-host\/provider-adapter-control\//u);

    const calls = (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { operation?: unknown; sessionRef?: unknown });
    assert.deepEqual(calls.map((call) => call.operation), ['sendInputIntent', 'resume']);
    assert.ok(calls.every((call) => call.sessionRef === attachResult.refs.providerLifecycleSessionRef));
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap does not leak parent secrets into env input/control hooks', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-input-hook-env-'));
  const hookPath = join(outDir, 'env-check-hook.mjs');
  const observedEnvPath = join(outDir, 'observed-env.json');
  const previousSecret = process.env.SCIFORGE_TEST_INPUT_HOOK_SECRET;
  process.env.SCIFORGE_TEST_INPUT_HOOK_SECRET = 'SECRET_TOKEN=parent-env-secret';
  await writeFile(hookPath, envSanitizingInputControlHookScript(observedEnvPath), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(input.status, 'executed', input.message);
    const observed = JSON.parse(await readFile(observedEnvPath, 'utf8')) as Record<string, unknown>;
    assert.equal(observed.secret, undefined);
    assert.equal(observed.pathType, 'string');
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SCIFORGE_TEST_INPUT_HOOK_SECRET;
    } else {
      process.env.SCIFORGE_TEST_INPUT_HOOK_SECRET = previousSecret;
    }
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap passes provider evidence root to env input/control hooks', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-input-hook-evidence-root-'));
  const hookPath = join(outDir, 'input-control-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  await writeFile(hookPath, inputControlEvidenceRootHookScript(callsPath), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        outDir,
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);

    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(input.status, 'executed', input.message);
    assert.equal(input.evidence.providerExecuted, true);

    const providerSessionRef = requiredString(attachResult.refs.providerLifecycleSessionRef);
    const providerRootRef = providerSessionRef.replace(/\/session\.json$/u, '');
    const runDirRef = providerRootRef.replace(/\/virtual-display-provider$/u, '');
    const calls = (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        evidenceRoot?: { outDir?: unknown; runDirRef?: unknown; providerRootRef?: unknown };
        inputIntentRef?: unknown;
      });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.evidenceRoot, {
      outDir,
      runDirRef,
      providerRootRef,
    });
    const inputIntentRef = requiredString(typeof calls[0]?.inputIntentRef === 'string' ? calls[0].inputIntentRef : undefined);
    assert.match(inputIntentRef, new RegExp(`^${escapeRegExp(providerRootRef)}/input-intents/`, 'u'));
    const evidence = JSON.parse(await readFile(join(
      outDir,
      inputIntentRef.slice(`${runDirRef}/`.length),
    ), 'utf8')) as Record<string, unknown>;
    assert.equal(evidence.schemaVersion, 'sciforge.computer-use.virtual-app-screen.input-control-provider-evidence.v1');
    assert.equal(evidence.operation, 'sendInputIntent');
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap uses env input/control hook capability as macOS safe input adapter proof', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-input-hook-capability-'));
  const hookPath = join(outDir, 'input-control-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  await writeFile(hookPath, inputControlHookScript(callsPath, { includeInputAdapterCapability: true }), 'utf8');
  await chmod(hookPath, 0o755);

  const macosDeps = fakeMacosDriverDependencies();
  delete macosDeps.probeInputAdapterCapability;
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: macosDeps,
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);

    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(input.status, 'executed', input.message);
    assert.equal(input.providerId, 'native-virtual-app-screen-host');
    assert.equal(input.evidence.providerExecuted, true);
    assert.equal(input.evidence.mutatingActionExecuted, true);
    assert.deepEqual(input.routeDecision.providerOperations, ['sendInputIntent', 'readFrame']);

    const calls = (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { operation?: unknown; capabilityProbe?: unknown });
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === true).length, 1);
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === false).length, 1);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap preserves env input/control capability refs for provider-root validation', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-input-hook-capability-refs-'));
  const hookPath = join(outDir, 'input-control-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  await writeFile(hookPath, inputControlHookScript(callsPath, {
    includeInputAdapterCapability: true,
    capabilityRefs: 'stale-run',
  }), 'utf8');
  await chmod(hookPath, 0o755);

  const macosDeps = fakeMacosDriverDependencies();
  delete macosDeps.probeInputAdapterCapability;
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: macosDeps,
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);

    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(input.status, 'blocked');
    assert.match(input.message, /capability evidence refs outside the current provider root/u);
    const calls = (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { operation?: unknown; capabilityProbe?: unknown });
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === true).length, 1);
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === false).length, 0);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap rejects env input/control capability probes that execute mutations', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-mutating-capability-hook-'));
  const hookPath = join(outDir, 'input-control-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  await writeFile(hookPath, inputControlHookScript(callsPath, {
    includeInputAdapterCapability: true,
    mutateCapabilityProbe: true,
  }), 'utf8');
  await chmod(hookPath, 0o755);

  const macosDeps = fakeMacosDriverDependencies();
  delete macosDeps.probeInputAdapterCapability;
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: macosDeps,
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);

    const input = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(input.status, 'blocked');
    assert.match(input.message, /capability probe must be non-mutating/u);
    const calls = (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { operation?: unknown; capabilityProbe?: unknown });
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === true).length, 1);
    assert.equal(calls.filter((call) => call.operation === 'sendInputIntent' && call.capabilityProbe === false).length, 0);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap redacts env hook diagnostics when input/control fails', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-redacting-hook-'));
  const hookPath = join(outDir, 'redacting-hook.mjs');
  await writeFile(hookPath, redactingInputControlHookScript(), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(result.status, 'blocked');
    assert.match(result.message, /hook did not complete|input\/control hook reported failure/u);
    assert.doesNotMatch(result.message, /SECRET|TOKEN|computer-use:native-host\/sessions/u);
    assert.doesNotMatch(String(result.routeDecision.providerBlockedReason), /SECRET|TOKEN|computer-use:native-host\/sessions/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap preserves bounded env hook failure detail for debugging', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-safe-hook-detail-'));
  const hookPath = join(outDir, 'safe-detail-hook.mjs');
  await writeFile(hookPath, safeFailureInputControlHookScript(), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(result.status, 'blocked');
    assert.match(result.message, /reported failure: target-window-not-readable/u);
    assert.match(String(result.routeDecision.providerBlockedReason), /target-window-not-readable/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap fails closed when env hook closes stdin before reading', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-closed-stdin-hook-'));
  const hookPath = join(outDir, 'closed-stdin-hook.mjs');
  await writeFile(hookPath, closedStdinInputControlHookScript(), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(result.status, 'blocked');
    assert.match(result.message, /stdin|must write a JSON object|exited with code/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap waits for timed-out env hooks to terminate before returning', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-timeout-hook-'));
  const hookPath = join(outDir, 'timeout-hook.mjs');
  const markerPath = join(outDir, 'late-write.txt');
  await writeFile(hookPath, timeoutInputControlHookScript(markerPath), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV]: '1000',
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(result.status, 'blocked');
    assert.match(result.message, /timed out/u);
    await assert.rejects(readFile(markerPath, 'utf8'), /ENOENT/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap terminates timed-out env hook descendant processes', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-timeout-descendant-hook-'));
  const hookPath = join(outDir, 'timeout-descendant-hook.mjs');
  const markerPath = join(outDir, 'descendant-late-write.txt');
  await writeFile(hookPath, timeoutDescendantInputControlHookScript(markerPath), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS_ENV]: '1000',
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(result.status, 'blocked');
    assert.match(result.message, /timed out/u);
    await sleep(1800);
    await assert.rejects(() => readFile(markerPath, 'utf8'), /ENOENT/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap terminates successful env hook descendant processes before returning', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-virtual-app-screen-success-descendant-hook-'));
  const hookPath = join(outDir, 'success-descendant-hook.mjs');
  const callsPath = join(outDir, 'calls.jsonl');
  const markerPath = join(outDir, 'descendant-late-write.txt');
  await writeFile(hookPath, inputControlHookScript(callsPath, {
    includeInputAdapterCapability: true,
    successDescendantMarkerPath: markerPath,
  }), 'utf8');
  await chmod(hookPath, 0o755);
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]: process.execPath,
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV]: JSON.stringify([hookPath]),
      },
      macos: {
        targetApp: { kind: 'vscode-editor', command: 'research-editor' },
        probeOptions: readyMacosDriverProbeOptions('vscode-editor'),
        dependencies: fakeMacosDriverDependencies(),
      },
    },
  });
  try {
    const attachResult = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommandFromRefs({
      sessionRef: requiredString(attachResult.refs.sessionRef),
      screenRef: requiredString(attachResult.refs.screenRef),
      targetAppRef: requiredString(attachResult.refs.targetAppRef),
      targetWindowRef: requiredString(attachResult.refs.targetWindowRef),
      frameRef: requiredString(attachResult.refs.currentFrameRef),
      inputLeaseRef: requiredString(attachResult.refs.inputLeaseRef),
      actionAdapterRef: requiredString(attachResult.refs.actionAdapterRef),
      adapterReadinessRef: requiredString(attachResult.refs.adapterReadinessRef),
      evidenceLedgerRef: requiredString(attachResult.refs.evidenceLedgerRef),
    }));

    assert.equal(result.status, 'executed', result.message);
    await sleep(1400);
    await assert.rejects(() => readFile(markerPath, 'utf8'), /ENOENT/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('runtime executor bootstrap does not take precedence over a source-specific input executor', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
  });
  const unregister = registerVirtualAppScreenInputRuntimeExecutor({
    executorId: 'input-runtime:product-canvas-test',
    providerId: 'provider:product-canvas-test',
    supportedSources: [VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE],
    execute: (command) => ({
      ...virtualAppScreenInputRuntimeProjection(command, 'product source-specific input executor selected'),
      status: 'blocked',
      executorId: 'input-runtime:product-canvas-test',
      providerId: 'provider:product-canvas-test',
    }),
  });
  try {
    const result = await runVirtualAppScreenInputRuntime(parsedCanvasInputCommand());

    assert.equal(result.status, 'blocked');
    assert.equal(result.executorId, 'input-runtime:product-canvas-test');
    assert.equal(result.providerId, 'provider:product-canvas-test');
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
});

test('runtime executor bootstrap source stays generic and avoids disallowed fallback paths', async () => {
  const source = await readFile(fileURLToPath(new URL('./virtual-app-screen-runtime-executors.ts', import.meta.url)), 'utf8');

  assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge/);
  assert.doesNotMatch(source, /Visual Studio Code\.app|extensionDevelopmentPath|serve-web|code-server|OpenVSCode/);
  assert.doesNotMatch(source, /Xvfb|noVNC|RDP|QEMU|Playwright|DOM shortcut|browser shortcut/);
});

function parsedAttachCommand(profile = 'vscode-editor') {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${profile}"`,
    `--target-app-ref "app:profile/${profile}"`,
    '--screen-ref "virtual-app-screen:runtime-executor-test/screen"',
    '--activation-ref "computer-use:runtime-executor-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:runtime-executor-test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/runtime-executor-test/screen-activation.json"',
    '--gui-present-ref "gui.present:runtime-executor-test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedCanvasInputCommand() {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    '--session-ref "computer-use:session/runtime-executor-test/session.json"',
    '--screen-ref "virtual-app-screen:runtime-executor-test/screen"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--target-window-ref "window:runtime-executor-test/main"',
    '--frame-ref "computer-use:session/runtime-executor-test/frames/current.png"',
    '--input-lease-ref "computer-use:session/runtime-executor-test/leases/active.json"',
    '--action-adapter-ref "computer-use:session/runtime-executor-test/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/runtime-executor-test/readiness/native-window.json"',
    '--evidence-ledger-ref "computer-use:session/runtime-executor-test/evidence-ledger.json"',
    '--frame-width 1440',
    '--frame-height 900',
    '--x-ratio 0.125',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input command');
  return parsed.command;
}

function parsedCanvasInputCommandFromRefs(refs: {
  sessionRef: string;
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  frameRef: string;
  inputLeaseRef: string;
  actionAdapterRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
}) {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    `--session-ref "${refs.sessionRef}"`,
    `--screen-ref "${refs.screenRef}"`,
    `--target-app-ref "${refs.targetAppRef}"`,
    `--target-window-ref "${refs.targetWindowRef}"`,
    `--frame-ref "${refs.frameRef}"`,
    `--input-lease-ref "${refs.inputLeaseRef}"`,
    `--action-adapter-ref "${refs.actionAdapterRef}"`,
    `--adapter-readiness-ref "${refs.adapterReadinessRef}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef}"`,
    '--frame-width 1440',
    '--frame-height 900',
    '--x-ratio 0.125',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input command');
  return parsed.command;
}

function parsedControlInputCommandFromRefs(
  controlKind: 'takeover' | 'resume-agent' | 'stop-session',
  refs: {
    sessionRef: string;
    screenRef: string;
    targetAppRef: string;
    targetWindowRef: string;
    inputLeaseRef: string;
    actionAdapterRef: string;
    adapterReadinessRef: string;
    evidenceLedgerRef: string;
  },
) {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    `--kind "${controlKind}"`,
    `--session-ref "${refs.sessionRef}"`,
    `--screen-ref "${refs.screenRef}"`,
    `--target-app-ref "${refs.targetAppRef}"`,
    `--target-window-ref "${refs.targetWindowRef}"`,
    `--input-lease-ref "${refs.inputLeaseRef}"`,
    '--user-lease-ref "computer-use:session/runtime-executor-test/leases/user.json"',
    '--agent-lease-ref "computer-use:session/runtime-executor-test/leases/agent.json"',
    '--active-lease-owner-ref "computer-use:session/runtime-executor-test/leases/owner-agent.json"',
    '--active-lease-owner-role agent',
    `--lease-control-ref "computer-use:session/runtime-executor-test/leases/${controlKind}.json"`,
    `--action-adapter-ref "${refs.actionAdapterRef}"`,
    `--adapter-readiness-ref "${refs.adapterReadinessRef}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed control command');
  return parsed.command;
}

function readyMacosProviderOptions() {
  return {
    probeOptions: {
      nodePackageAvailability: { 'node-mac-virtual-display': true },
      permissionGrants: {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      },
    },
  };
}

function readyLinuxProviderOptions() {
  return {
    probeOptions: {
      commandAvailability: { xpra: true },
    },
  };
}

function readyWindowsProviderOptions() {
  return {
    probeOptions: {
      manualRequirementAvailability: {
        'windows-idd-virtual-display-driver': true,
      },
      permissionGrants: {
        'permission:windows/idd-driver-authorized': true,
      },
    },
  };
}

function fakeMacosDriverDependencies(overrides: Partial<MacosVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): MacosVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    loadVirtualDisplayPackage: () => ({ createVirtualDisplay: true }),
    commandExists: () => true,
    probeAccessibility: () => ({ ok: true }),
    createVirtualDisplay: () => ({
      displayId: 777,
      displayIndex: 3,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      name: 'SciForge Test Display',
    }),
    listDisplays: () => [{
      id: 777,
      index: 3,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      main: false,
    }],
    launchApp: () => ({
      pids: [4242],
      details: { launchMode: 'fake-command' },
    }),
    waitForTargetWindow: () => ({
      cgWindow: {
        pid: 4242,
        windowNumber: 19,
        ownerName: 'Research Editor',
        title: 'Untitled',
        layer: 0,
        x: 1600,
        y: 0,
        width: 1000,
        height: 700,
      },
      axWindow: {
        pid: 4242,
        windowIndex: 1,
        title: 'Untitled',
        x: 1600,
        y: 0,
        width: 1000,
        height: 700,
      },
    }),
    moveWindow: () => ({
      ok: true,
      stdout: 'moved',
      targetBounds: {
        x: 1632,
        y: 32,
        width: 1376,
        height: 836,
      },
    }),
    probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
    captureDisplayFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
        screenshotBytes: 1024,
        currentRunOnly: true,
      },
    }),
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data });
    },
    ...overrides,
  };
}

function stringRecordRef(record: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function providerControlHookResult(
  refs: Record<string, string | string[] | undefined>,
  controlKind: 'takeover' | 'resume-agent' | 'stop-session',
) {
  const providerRootRef = stringRecordRef(refs, 'providerRootRef')
    ?? '.sciforge/vision-runs/runtime-executor-test/virtual-display-provider';
  const slug = controlKind.replace(/[^a-z0-9-]/giu, '-');
  return {
    ok: true,
    refs: {
      currentRunRef: stringRecordRef(refs, 'currentRunRef') ?? `${providerRootRef}/current-run.json`,
      sessionRef: stringRecordRef(refs, 'sessionRef') ?? `${providerRootRef}/session.json`,
      inputLeaseRef: stringRecordRef(refs, 'inputLeaseRef') ?? `${providerRootRef}/leases/input.json`,
      actionAdapterRef: stringRecordRef(refs, 'actionAdapterRef') ?? `${providerRootRef}/adapters/action.json`,
      adapterReadinessRef: stringRecordRef(refs, 'adapterReadinessRef') ?? `${providerRootRef}/readiness/action.json`,
      evidenceLedgerRef: stringRecordRef(refs, 'evidenceLedgerRef') ?? `${providerRootRef}/evidence-ledger.json`,
      beforeFrameRef: stringRecordRef(refs, 'currentFrameRef') ?? `${providerRootRef}/frames/${slug}-before.json`,
      afterFrameRef: `${providerRootRef}/frames/${slug}-after.json`,
      inputIntentRefs: [`${providerRootRef}/input-intents/${slug}.json`],
      executorEventRefs: [`${providerRootRef}/executor-events/${slug}.json`],
      beforeAfterFrameRefs: [`${providerRootRef}/before-after/${slug}.json`],
      verificationRefs: [`${providerRootRef}/verification/${slug}.json`],
      isolationEvidenceRefs: [`${providerRootRef}/control-plane/${slug}/isolation-evidence.json`],
      physicalDesktopProbeRefs: [`${providerRootRef}/control-plane/${slug}/physical-desktop-probe.json`],
      agentQueueRef: `${providerRootRef}/control-plane/${slug}/agent-queue.json`,
      currentFrameRefreshRef: controlKind === 'resume-agent'
        ? `${providerRootRef}/control-plane/${slug}/current-frame-refresh.json`
        : undefined,
      safeStopRef: controlKind === 'stop-session'
        ? `${providerRootRef}/control-plane/${slug}/safe-stop.json`
        : undefined,
    },
    mutatingActionExecuted: true,
    providerEvidenceWritten: true,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
}

function inputControlHookScript(
  callsPath: string,
  options: {
    includeInputAdapterCapability?: boolean;
    mutateCapabilityProbe?: boolean;
    capabilityRefs?: 'provider-root' | 'stale-run';
    successDescendantMarkerPath?: string;
  } = {},
) {
  return `
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const context = JSON.parse(readFileSync(0, 'utf8'));
const capabilityProbe = context.capabilityProbe === true;
const refs = context.refs ?? {};
const providerRootRef = typeof refs.providerRootRef === 'string'
  ? refs.providerRootRef
  : '.sciforge/vision-runs/env-input-control-hook/virtual-display-provider';
const operation = String(context.operation ?? 'unknown');
const inputIntent = context.inputIntent ?? {};
const kind = String(inputIntent.controlKind ?? inputIntent.kind ?? operation).replace(/[^a-z0-9-]/giu, '-');
const slug = String(operation + '-' + kind).replace(/[^a-z0-9-]/giu, '-');
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({
  operation,
  sessionRef: refs.sessionRef,
  capabilityProbe,
}) + '\\n');

const outputRefs = {
  currentRunRef: refs.currentRunRef,
  sessionRef: refs.sessionRef,
  inputLeaseRef: refs.inputLeaseRef,
  actionAdapterRef: refs.actionAdapterRef,
  adapterReadinessRef: refs.adapterReadinessRef,
  evidenceLedgerRef: refs.evidenceLedgerRef,
  beforeFrameRef: refs.currentFrameRef ?? providerRootRef + '/frames/' + slug + '-before.json',
  afterFrameRef: providerRootRef + '/frames/' + slug + '-after.json',
  inputIntentRefs: [providerRootRef + '/input-intents/' + slug + '.json'],
  executorEventRefs: [providerRootRef + '/executor-events/' + slug + '.json'],
  beforeAfterFrameRefs: [providerRootRef + '/before-after/' + slug + '.json'],
  verificationRefs: [providerRootRef + '/verification/' + slug + '.json'],
  isolationEvidenceRefs: [providerRootRef + '/control-plane/' + slug + '/isolation-evidence.json'],
  physicalDesktopProbeRefs: [providerRootRef + '/control-plane/' + slug + '/physical-desktop-probe.json'],
  agentQueueRef: operation === 'pause' || operation === 'resume' || operation === 'closeSession'
    ? providerRootRef + '/control-plane/' + slug + '/agent-queue.json'
    : undefined,
  currentFrameRefreshRef: operation === 'resume'
    ? providerRootRef + '/control-plane/' + slug + '/current-frame-refresh.json'
    : undefined,
  safeStopRef: operation === 'closeSession'
    ? providerRootRef + '/control-plane/' + slug + '/safe-stop.json'
    : undefined,
};
const capabilityRefs = capabilityProbe
  ? ${JSON.stringify(options.capabilityRefs ?? '')} === 'stale-run'
    ? { verificationRefs: ['.sciforge/vision-runs/stale-run/virtual-display-provider/verification/capability.json'] }
    : ${JSON.stringify(options.capabilityRefs ?? '')} === 'provider-root'
      ? { verificationRefs: [providerRootRef + '/verification/capability.json'] }
      : undefined
  : undefined;
if (${JSON.stringify(options.successDescendantMarkerPath ?? '')}) {
  const childScript = "import { appendFileSync } from 'node:fs';"
    + "setTimeout(() => appendFileSync("
    + JSON.stringify(${JSON.stringify(options.successDescendantMarkerPath ?? '')})
    + ", 'late descendant write after success\\\\n'), 900);"
    + "setInterval(() => {}, 1000);";
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], { stdio: 'ignore' });
  child.unref();
}

console.log(JSON.stringify({
  ok: true,
  inputAdapterCapability: ${options.includeInputAdapterCapability ? "{ ok: true, mechanism: 'pid-scoped-ax', refs: capabilityRefs }" : 'undefined'},
  refs: outputRefs,
  mutatingActionExecuted: capabilityProbe ? ${options.mutateCapabilityProbe ? 'true' : 'false'} : true,
  providerEvidenceWritten: capabilityProbe ? false : true,
  affectsPhysicalDisplay: false,
  sharedSystemInputUsed: false,
  systemPointerMoved: false,
  systemKeyboardEventsSent: false,
}));
`;
}

function envSanitizingInputControlHookScript(observedEnvPath: string) {
  return `
import { readFileSync, writeFileSync } from 'node:fs';

const context = JSON.parse(readFileSync(0, 'utf8'));
writeFileSync(${JSON.stringify(observedEnvPath)}, JSON.stringify({
  secret: process.env.SCIFORGE_TEST_INPUT_HOOK_SECRET,
  pathType: typeof process.env.PATH,
}));
const refs = context.refs ?? {};
const providerRootRef = typeof refs.providerRootRef === 'string'
  ? refs.providerRootRef
  : '.sciforge/vision-runs/env-sanitizing-hook/virtual-display-provider';
const operation = String(context.operation ?? 'unknown');
const inputIntent = context.inputIntent ?? {};
const kind = String(inputIntent.controlKind ?? inputIntent.kind ?? operation).replace(/[^a-z0-9-]/giu, '-');
const slug = String(operation + '-' + kind).replace(/[^a-z0-9-]/giu, '-');

console.log(JSON.stringify({
  ok: true,
  inputAdapterCapability: context.capabilityProbe === true
    ? { ok: true, mechanism: 'pid-scoped-ax', refs: { verificationRefs: [providerRootRef + '/verification/capability.json'] } }
    : undefined,
  refs: {
    currentRunRef: refs.currentRunRef,
    sessionRef: refs.sessionRef,
    inputLeaseRef: refs.inputLeaseRef,
    actionAdapterRef: refs.actionAdapterRef,
    adapterReadinessRef: refs.adapterReadinessRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    beforeFrameRef: refs.currentFrameRef ?? providerRootRef + '/frames/' + slug + '-before.json',
    afterFrameRef: providerRootRef + '/frames/' + slug + '-after.json',
    inputIntentRefs: [providerRootRef + '/input-intents/' + slug + '.json'],
    executorEventRefs: [providerRootRef + '/executor-events/' + slug + '.json'],
    beforeAfterFrameRefs: [providerRootRef + '/before-after/' + slug + '.json'],
    verificationRefs: [providerRootRef + '/verification/' + slug + '.json'],
    isolationEvidenceRefs: [providerRootRef + '/control-plane/' + slug + '/isolation-evidence.json'],
    physicalDesktopProbeRefs: [providerRootRef + '/control-plane/' + slug + '/physical-desktop-probe.json'],
  },
  mutatingActionExecuted: context.capabilityProbe === true ? false : true,
  providerEvidenceWritten: context.capabilityProbe === true ? false : true,
  affectsPhysicalDisplay: false,
  sharedSystemInputUsed: false,
  systemPointerMoved: false,
  systemKeyboardEventsSent: false,
}));
`;
}

function inputControlEvidenceRootHookScript(callsPath: string) {
  return `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const context = JSON.parse(readFileSync(0, 'utf8'));
const evidenceRoot = context.evidenceRoot ?? {};
if (typeof evidenceRoot.outDir !== 'string' || typeof evidenceRoot.runDirRef !== 'string' || typeof evidenceRoot.providerRootRef !== 'string') {
  process.exit(2);
}
const operation = String(context.operation ?? 'unknown');
const inputIntent = context.inputIntent ?? {};
const kind = String(inputIntent.controlKind ?? inputIntent.kind ?? operation).replace(/[^a-z0-9-]/giu, '-');
const slug = String(operation + '-' + kind).replace(/[^a-z0-9-]/giu, '-');
const providerRootRef = evidenceRoot.providerRootRef;
const inputIntentRef = providerRootRef + '/input-intents/' + slug + '.json';
const localPathForRef = (ref) => {
  const prefix = evidenceRoot.runDirRef + '/';
  if (!ref.startsWith(prefix)) throw new Error('ref outside runDirRef: ' + ref);
  return join(evidenceRoot.outDir, ref.slice(prefix.length));
};
const inputIntentPath = localPathForRef(inputIntentRef);
mkdirSync(dirname(inputIntentPath), { recursive: true });
writeFileSync(inputIntentPath, JSON.stringify({
  schemaVersion: 'sciforge.computer-use.virtual-app-screen.input-control-provider-evidence.v1',
  operation,
  inputIntent,
  evidenceRoot,
}, null, 2));
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({
  operation,
  evidenceRoot,
  inputIntentRef,
}) + '\\n');

console.log(JSON.stringify({
  ok: true,
  refs: {
    currentRunRef: context.refs?.currentRunRef,
    sessionRef: context.refs?.sessionRef,
    inputLeaseRef: context.refs?.inputLeaseRef,
    actionAdapterRef: context.refs?.actionAdapterRef,
    adapterReadinessRef: context.refs?.adapterReadinessRef,
    evidenceLedgerRef: context.refs?.evidenceLedgerRef,
    beforeFrameRef: context.refs?.currentFrameRef ?? providerRootRef + '/frames/' + slug + '-before.json',
    afterFrameRef: providerRootRef + '/frames/' + slug + '-after.json',
    inputIntentRefs: [inputIntentRef],
    executorEventRefs: [providerRootRef + '/executor-events/' + slug + '.json'],
    beforeAfterFrameRefs: [providerRootRef + '/before-after/' + slug + '.json'],
    verificationRefs: [providerRootRef + '/verification/' + slug + '.json'],
    isolationEvidenceRefs: [providerRootRef + '/control-plane/' + slug + '/isolation-evidence.json'],
    physicalDesktopProbeRefs: [providerRootRef + '/control-plane/' + slug + '/physical-desktop-probe.json'],
  },
  mutatingActionExecuted: true,
  providerEvidenceWritten: true,
  affectsPhysicalDisplay: false,
  sharedSystemInputUsed: false,
  systemPointerMoved: false,
  systemKeyboardEventsSent: false,
}));
`;
}

function redactingInputControlHookScript() {
  return `
import { readFileSync } from 'node:fs';

const contextText = readFileSync(0, 'utf8');
console.error('SECRET_TOKEN=stderr-secret ' + contextText);
console.log(JSON.stringify({
  ok: false,
  detail: 'SECRET_TOKEN=stdout-secret ' + contextText,
  refs: {},
  mutatingActionExecuted: false,
  providerEvidenceWritten: false,
}));
`;
}

function safeFailureInputControlHookScript() {
  return `
console.log(JSON.stringify({
  ok: false,
  detail: 'target-window-not-readable',
  refs: {},
  mutatingActionExecuted: false,
  providerEvidenceWritten: false,
}));
`;
}

function closedStdinInputControlHookScript() {
  return `
process.stdin.destroy();
setTimeout(() => process.exit(0), 50);
`;
}

function timeoutInputControlHookScript(markerPath: string) {
  return `
import { appendFileSync, readFileSync } from 'node:fs';

readFileSync(0, 'utf8');
process.on('SIGTERM', () => {});
setTimeout(() => {
  appendFileSync(${JSON.stringify(markerPath)}, 'late write after timeout\\n');
}, 1500);
setInterval(() => {}, 1000);
`;
}

function timeoutDescendantInputControlHookScript(markerPath: string) {
  const childScript = `
import { appendFileSync } from 'node:fs';
setTimeout(() => {
  appendFileSync(${JSON.stringify(markerPath)}, 'late descendant write after timeout\\\\n');
}, 1500);
setInterval(() => {}, 1000);
`;
  return `
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

readFileSync(0, 'utf8');
spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(childScript)}], {
  stdio: 'ignore',
});
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`;
}

function requiredString(value: string | undefined): string {
  if (typeof value !== 'string') {
    assert.fail('expected string');
  }
  assert.ok(value.trim());
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeLinuxXpraDriverDependencies(overrides: Partial<LinuxXpraVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): LinuxXpraVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    commandExists: () => true,
    probeInputIsolation: () => ({ ok: true }),
    probeFrameCapture: () => ({ ok: true }),
    startSession: () => ({
      sessionId: 'sciforge-test-xpra',
      display: ':2301',
      width: 1440,
      height: 900,
      stdout: 'started',
    }),
    launchApp: () => ({
      pids: [5151],
      details: { launchMode: 'fake-xpra-control' },
    }),
    waitForTargetWindow: () => ({
      id: '7',
      pid: 5151,
      title: 'Research Editor',
      x: 32,
      y: 32,
      width: 1200,
      height: 760,
      raw: { title: 'Research Editor' },
    }),
    captureSessionFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
        screenshotBytes: 2048,
        currentRunOnly: true,
      },
    }),
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data });
    },
    ...overrides,
  };
}

function fakeWindowsIddDriverDependencies(overrides: Partial<WindowsIddVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): WindowsIddVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    platform: () => 'win32',
    loadIddDriverApi: () => ({ driverName: 'fake-idd-driver-api' }),
    probeDriverInstalled: () => ({ ok: true }),
    probeDriverAuthorized: () => ({ ok: true }),
    probeCaptureAvailable: () => ({ ok: true }),
    createVirtualDisplay: () => ({
      displayId: 'idd-display-7',
      adapterId: 'adapter-1',
      targetId: 'target-1',
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      name: 'SciForge Test IDD Display',
    }),
    launchApp: () => ({
      pids: [4242],
      details: { launchMode: 'fake-windows-command' },
    }),
    findTargetWindow: () => ({
      pid: 4242,
      hwnd: '0x0000002a',
      title: 'Untitled',
      x: 32,
      y: 32,
      width: 1000,
      height: 700,
    }),
    attachWindowToDisplay: () => ({
      ok: true,
      surfaceId: 'surface-7',
      details: { mode: 'fake-idd-surface' },
    }),
    captureFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
        screenshotBytes: 1024,
        currentRunOnly: true,
      },
    }),
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data });
    },
    ...overrides,
  };
}

function readyMacosDriverProbeOptions(targetAppKind: string) {
  return {
    platform: 'darwin',
    targetAppKind,
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  };
}

function readyLinuxDriverProbeOptions(targetAppKind: string) {
  return {
    platform: 'linux',
    targetAppKind,
    commandAvailability: { xpra: true },
  };
}

function readyWindowsDriverProbeOptions(targetAppKind: string) {
  return {
    platform: 'win32',
    targetAppKind,
    manualRequirementAvailability: {
      'windows-idd-virtual-display-driver': true,
    },
    permissionGrants: {
      'permission:windows/idd-driver-authorized': true,
    },
  };
}
