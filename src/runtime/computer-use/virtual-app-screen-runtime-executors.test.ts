import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
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
  const registered = ensureVirtualAppScreenRuntimeExecutorsRegistered({
    platform: 'darwin',
    macosProviderOptions: readyMacosProviderOptions(),
    nativeDriverHooks: {
      env: {
        [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '1',
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
        }),
      },
    },
  });
  try {
    assert.ok(registered.registeredExecutorIds.includes('native-session-manager:macos-virtual-display-provider'));

    const result = await attachVirtualAppScreenSession(parsedAttachCommand('vscode-editor'));

    assert.equal(result.status, 'attached');
    assert.equal(launchSpecs.length, 1);
    assert.deepEqual(launchSpecs[0], {
      kind: 'scalar-editor',
      name: 'JSON Editor',
      command: 'research-editor --do-not-split',
      args: ['--scalar', 'two words'],
      bundleId: 'com.example.JsonEditor',
      appPath: '/Applications/JsonEditor.app',
      processMatch: 'JsonEditor.*',
      windowTitlePattern: '^Document',
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
        sessionRef: 'computer-use:session/product-test/session.json',
        liveSurfaceRef: 'computer-use:session/product-test/live-surface.json',
        surfaceTransportRef: 'computer-use:session/product-test/surface-transport.json',
        frameStreamRef: 'computer-use:session/product-test/frame-stream.json',
        currentFrameRef: 'computer-use:session/product-test/frames/current.png',
        frameTransportContractRef: 'computer-use:session/product-test/frame-transport-contract.json',
        frameTelemetryRef: 'computer-use:session/product-test/frame-telemetry.json',
        mediaChannelRef: 'computer-use:session/product-test/native-frame-stream/live',
        dataChannelRef: 'computer-use:session/product-test/native-frame-control-channel/control',
        screenRef: command.refs.screenRef,
        targetAppRef: command.refs.targetAppRef,
        targetWindowRef: 'window:product-test/main',
        inputLeaseRef: 'computer-use:session/product-test/input-lease.json',
        actionAdapterRef: 'computer-use:session/product-test/action-adapter.json',
        adapterReadinessRef: command.refs.readinessRef,
        platformDriverRef: 'computer-use:session/product-test/platform-driver.json',
        evidenceLedgerRef: 'computer-use:session/product-test/evidence-ledger.json',
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
          surfaceTransportRef: 'computer-use:session/product-test/surface-transport.json',
          liveSurfaceRef: 'computer-use:session/product-test/live-surface.json',
          frameStreamRef: 'computer-use:session/product-test/frame-stream.json',
          currentFrameRef: 'computer-use:session/product-test/frames/current.png',
          frameTransportContractRef: 'computer-use:session/product-test/frame-transport-contract.json',
          frameTelemetryRef: 'computer-use:session/product-test/frame-telemetry.json',
          mediaChannelRef: 'computer-use:session/product-test/native-frame-stream/live',
          dataChannelRef: 'computer-use:session/product-test/native-frame-control-channel/control',
          currentFrameSequence: 1,
          diagnosticOnly: false,
          productFallback: false,
          singleInteractiveTruth: true,
        },
        evidenceRefs: [
          'computer-use:session/product-test/surface-transport.json',
          'computer-use:session/product-test/platform-driver.json',
          'computer-use:session/product-test/evidence-ledger.json',
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
              },
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
  };
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
