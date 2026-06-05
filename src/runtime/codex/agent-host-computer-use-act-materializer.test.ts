import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';
import type { CodexAgentHostRuntimeTruth, NormalizedCodexAgentHostInput } from './agent-host-turn-loop.js';
import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { GenericVisionAction } from '../computer-use/types.js';
import {
  buildVirtualDisplaySurfaceTransportDescriptor,
} from '../computer-use/virtual-display-provider.js';
import { parseVirtualAppScreenRuntimeCommand } from '../computer-use/virtual-app-screen-command.js';
import { recordVirtualAppScreenProviderSession, resetVirtualAppScreenProviderSessionStoreForTests } from '../computer-use/virtual-app-screen-provider-session-store.js';
import { recordVirtualAppScreenNativeHostSession, resetVirtualAppScreenNativeHostSessionStoreForTests } from '../computer-use/virtual-app-screen-native-host-session-store.js';
import {
  ContractSmokeNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
  type NativeHostAppProfile,
  type NativeHostFrame,
  type NativeHostHumanInputAccepted,
  type NativeHostHumanInputEvent,
  type NativeHostLiveSurface,
  type NativeHostMaybePromise,
  type NativeHostReadinessRecord,
  type NativeHostResult,
  type NativeHostSession,
  type NativeHostSurfaceTarget,
  type NativeVirtualAppScreenHostDescription,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

test('default Computer Use Act materializer executes a NativeHost VirtualAppScreen action through input runtime', async () => {
  const fixture = nativeHostFixture();
  const materializer = createDefaultComputerUseActMaterializer({
    virtualAppScreen: {
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Click the grounded virtual screen point.',
        actions: [{
          type: 'click',
          x: 180,
          y: 450,
          targetDescription: 'grounded button',
          screenId: fixture.screenRef,
          windowId: fixture.targetWindowRef,
          riskLevel: 'low',
          grounding: {
            frame: {
              width: 1440,
              height: 900,
            },
          },
        }],
        evidenceRefs: ['action-ledger:planner/native-host-click'],
      }),
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(fixture),
    preflight: readyPreflight(fixture),
    commandText: 'Click the grounded button in the virtual app screen.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-native-host-act',
    attemptId: 'codex-command-native-host-act-attempt-1',
    runtimeTruth: runtimeTruth(fixture),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.match(result?.message ?? '', /VirtualAppScreen input "click" executed/);
  assert.ok(result?.evidenceRefs.includes(fixture.inputLeaseRef));
  assert.ok(result?.evidenceRefs.includes(fixture.actionAdapterRef));
  assert.ok(result?.evidenceRefs.includes(fixture.currentRunPointerRef));
  assert.ok(result?.evidenceRefs.some((ref) => ref.startsWith(`${fixture.evidenceLedgerRef}/events/`)));
  assert.doesNotMatch(JSON.stringify(result), /executeGenericDesktopAction|sharedSystemInputUsed":true|gui\.present|ui:|fixture:|replay:/);

  const ledger = fixture.host.getLedger(fixture.sessionId);
  assert.ok(ledger);
  assert.equal(ledger.entries.some((entry) => entry.type === 'human-input.accepted'), true);

  resetVirtualAppScreenProviderSessionStoreForTests();
  resetVirtualAppScreenNativeHostSessionStoreForTests();
});

test('default Computer Use Act materializer fails closed for unsafe or incomplete VirtualAppScreen bindings', async (t) => {
  const cases: Array<{
    name: string;
    fixture?: () => NativeHostFixture;
    action?: (fixture: NativeHostFixture) => GenericVisionAction;
    expected: RegExp;
  }> = [
    {
      name: 'diagnostic-only native host',
      fixture: () => nativeHostFixture({ diagnosticOnly: true }),
      expected: /diagnostic-only/,
    },
    {
      name: 'missing current frame',
      fixture: () => nativeHostFixture({ omitCurrentFrame: true }),
      expected: /current frame evidence is missing/,
    },
    {
      name: 'missing permission refs',
      fixture: () => nativeHostFixture({ permissionRefs: [] }),
      expected: /permission refs are missing/,
    },
    {
      name: 'missing grant validation',
      fixture: () => nativeHostFixture({ omitGrantValidation: true }),
      expected: /grant/,
    },
    {
      name: 'missing input lease',
      fixture: () => nativeHostFixture({ omitInputLease: true }),
      expected: /lease|adapter/,
    },
    {
      name: 'missing action adapter',
      fixture: () => nativeHostFixture({ omitActionAdapter: true }),
      expected: /lease|adapter/,
    },
    {
      name: 'ungrounded pointer action',
      fixture: () => nativeHostFixture(),
      action: (fixture) => ({
        type: 'click',
        targetDescription: 'ambiguous button',
        screenId: fixture.screenRef,
        windowId: fixture.targetWindowRef,
        riskLevel: 'low',
      }),
      expected: /ungrounded|x\/y/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = testCase.fixture?.() ?? nativeHostFixture();
      const materializer = createDefaultComputerUseActMaterializer({
        virtualAppScreen: {
          actionPlanner: async () => ({
            status: 'planned',
            message: 'Plan one action.',
            actions: [testCase.action?.(fixture) ?? groundedClickAction(fixture)],
            evidenceRefs: ['action-ledger:planner/native-host-click'],
          }),
        },
      });

      const result = await materializer({
        agentHostInput: readyAgentHostInput(fixture),
        preflight: readyPreflight(fixture),
        commandText: 'Click the grounded button in the virtual app screen.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-native-host-act-blocked',
        attemptId: 'codex-command-native-host-act-blocked-attempt-1',
        runtimeTruth: runtimeTruth(fixture),
      });

      assert.equal(result?.status, 'blocked');
      assert.match(result?.message ?? '', testCase.expected);
      assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|history:/);

      resetVirtualAppScreenProviderSessionStoreForTests();
      resetVirtualAppScreenNativeHostSessionStoreForTests();
    });
  }
});

test('default Computer Use Act materializer does not bind GUI, fixture, replay, or history refs as executable targets', async () => {
  const materializer = createDefaultComputerUseActMaterializer({
    virtualAppScreen: {
      actionPlanner: async () => {
        throw new Error('planner should not run without a runtime-owned target binding');
      },
    },
  });

  const result = await materializer({
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'test',
      intentText: 'Click the projected thing.',
      authorizationProfileId: 'high-autonomy',
      singleTurnOverride: false,
      refs: ['gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'history:run'],
      readiness: {},
      target: {},
      observation: {},
      permissions: {},
    },
    preflight: {
      ...readyPreflight(nativeHostFixture()),
      target: { summary: 'Unsafe projection target', refs: ['gui.present:screen-pane', 'fixture:screen'] },
      evidenceRefs: ['replay:frame', 'history:run'],
    },
    commandText: 'Click the projected thing.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-native-host-unsafe-refs',
    attemptId: 'codex-command-native-host-unsafe-refs-attempt-1',
    runtimeTruth: {
      ...runtimeTruth(nativeHostFixture()),
      target: { bound: true, summary: 'Unsafe projection target', refs: ['gui.present:screen-pane', 'fixture:screen'] },
      observation: { fresh: true, refs: ['replay:frame'] },
      refs: ['gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'history:run'],
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /target binding is missing/);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|history:/);

  resetVirtualAppScreenProviderSessionStoreForTests();
  resetVirtualAppScreenNativeHostSessionStoreForTests();
});

test('default Computer Use Act materializer uses Act loop only for workflow completion requests', async () => {
  const fixture = nativeHostFixture();
  let plannerCalls = 0;
  const refreshSteps: number[] = [];
  const materializer = createDefaultComputerUseActMaterializer({
    maxActLoopSteps: 2,
    virtualAppScreen: {
      actionPlanner: async () => {
        plannerCalls += 1;
        return {
          status: 'planned',
          message: 'Click one grounded workflow step.',
          actions: [groundedClickAction(fixture)],
          evidenceRefs: [`action-ledger:planner/workflow-step-${plannerCalls}`],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(fixture),
    preflight: readyPreflight(fixture),
    commandText: 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-native-host-workflow-loop',
    attemptId: 'codex-command-native-host-workflow-loop-attempt-1',
    runtimeTruth: runtimeTruth(fixture),
    refreshRuntimeTruth: async ({ step }) => {
      refreshSteps.push(step);
      return {
        ...runtimeTruth(fixture),
        observation: {
          fresh: true,
          refs: [`computer-use:observation/workflow-step-${step}`],
        },
        permissions: {
          refs: [`permission:turn/workflow-step-${step}`],
          stopCancelPath: true,
        },
      };
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /maxSteps|completion evidence/i);
  assert.equal(plannerCalls, 2);
  assert.deepEqual(refreshSteps, [1, 2]);
  assert.ok(result?.evidenceRefs.includes('permission:turn/workflow-step-2'));
  assert.ok(result?.evidenceRefs.some((ref) => ref.startsWith('runtime-truth:computer-use-act-loop/')));
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|history:/);

  let chinesePlannerCalls = 0;
  const chineseRefreshSteps: number[] = [];
  const chineseMaterializer = createDefaultComputerUseActMaterializer({
    maxActLoopSteps: 2,
    virtualAppScreen: {
      actionPlanner: async () => {
        chinesePlannerCalls += 1;
        return {
          status: 'planned',
          message: 'Click one grounded artifact workflow step.',
          actions: [groundedClickAction(fixture)],
          evidenceRefs: [`action-ledger:planner/chinese-artifact-workflow-step-${chinesePlannerCalls}`],
        };
      },
    },
  });

  const chineseResult = await chineseMaterializer({
    agentHostInput: readyAgentHostInput(fixture),
    preflight: readyPreflight(fixture),
    commandText: '点击编辑窗口，输入摘要，保存报告，打开预览窗口，并标记工作流完成。',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-native-host-chinese-artifact-workflow-loop',
    attemptId: 'codex-command-native-host-chinese-artifact-workflow-loop-attempt-1',
    runtimeTruth: runtimeTruth(fixture),
    refreshRuntimeTruth: async ({ step }) => {
      chineseRefreshSteps.push(step);
      return {
        ...runtimeTruth(fixture),
        observation: {
          fresh: true,
          refs: [`computer-use:observation/chinese-artifact-workflow-step-${step}`],
        },
        permissions: {
          refs: [`permission:turn/chinese-artifact-workflow-step-${step}`],
          stopCancelPath: true,
        },
      };
    },
  });

  assert.equal(chineseResult?.status, 'blocked');
  assert.match(chineseResult?.message ?? '', /maxSteps|completion evidence/i);
  assert.equal(chinesePlannerCalls, 2);
  assert.deepEqual(chineseRefreshSteps, [1, 2]);

  resetVirtualAppScreenProviderSessionStoreForTests();
  resetVirtualAppScreenNativeHostSessionStoreForTests();
});

function readyAgentHostInput(fixture: NativeHostFixture): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Click the grounded button in the virtual app screen.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: [
      fixture.sessionRef,
      fixture.screenRef,
      fixture.currentFrameRef,
      fixture.inputLeaseRef,
      fixture.actionAdapterRef,
    ],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function groundedClickAction(fixture: NativeHostFixture): GenericVisionAction {
  return {
    type: 'click',
    x: 180,
    y: 450,
    targetDescription: 'grounded button',
    screenId: fixture.screenRef,
    windowId: fixture.targetWindowRef,
    riskLevel: 'low',
    grounding: {
      frame: {
        width: 1440,
        height: 900,
      },
    },
  };
}

function readyPreflight(fixture: NativeHostFixture): ComputerUsePreflightResult {
  return {
    schemaVersion: 'sciforge.computer-use.preflight.v1',
    status: 'ready',
    authorizationProfile: {
      schemaVersion: 'sciforge.authorization-profile.v1',
      id: 'high-autonomy',
      publicLabel: 'High Autonomy',
      scope: { user: 'current-user', workspace: 'current-workspace' },
      defaultAutoScope: ['observe'],
      hardConfirmCategories: [],
      blockedCategories: [],
    },
    target: {
      summary: 'Verified native VirtualAppScreen',
      refs: [
        fixture.sessionRef,
        fixture.screenRef,
        fixture.targetWindowRef,
        `window-action-session:native-host/${fixture.sessionId}`,
      ],
    },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    evidenceRefs: [
      fixture.currentFrameRef,
      fixture.liveBindingAttachGrantRef,
      fixture.grantValidationRef,
      fixture.permissionRef,
    ],
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}

function runtimeTruth(fixture: NativeHostFixture): CodexAgentHostRuntimeTruth {
  return {
    schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
    source: 'test',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Verified native VirtualAppScreen',
      refs: [
        fixture.sessionRef,
        fixture.screenRef,
        fixture.targetWindowRef,
        `window-action-session:native-host/${fixture.sessionId}`,
      ],
    },
    observation: {
      fresh: true,
      refs: [fixture.currentFrameRef],
    },
    permissions: {
      refs: [fixture.permissionRef],
      stopCancelPath: true,
    },
    refs: [
      fixture.sessionRef,
      fixture.screenRef,
      fixture.currentFrameRef,
      fixture.currentRunPointerRef,
      fixture.inputLeaseRef,
      fixture.actionAdapterRef,
      fixture.adapterReadinessRef,
      fixture.evidenceLedgerRef,
      fixture.liveBindingAttachGrantRef,
      fixture.grantValidationRef,
      `adapter-registry:native-host/${fixture.sessionId}/virtual-app-screen-input`,
      `cancel:runtime-turn/native-host/${fixture.sessionId}`,
    ],
  };
}

interface NativeHostFixture {
  host: InMemoryNativeVirtualAppScreenHost;
  sessionId: string;
  sessionRef: string;
  screenRef: string;
  targetWindowRef: string;
  currentFrameRef: string;
  currentRunPointerRef: string;
  inputLeaseRef: string;
  actionAdapterRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
  liveBindingAttachGrantRef: string;
  grantValidationRef: string;
  permissionRef: string;
}

function nativeHostFixture(options: {
  diagnosticOnly?: boolean;
  omitCurrentFrame?: boolean;
  omitGrantValidation?: boolean;
  omitInputLease?: boolean;
  omitActionAdapter?: boolean;
  permissionRefs?: string[];
} = {}): NativeHostFixture {
  resetVirtualAppScreenProviderSessionStoreForTests();
  resetVirtualAppScreenNativeHostSessionStoreForTests();

  const host = new InMemoryNativeVirtualAppScreenHost(new ProductModeContractSmokeNativeHostPlatformAdapter({
    diagnosticOnly: options.diagnosticOnly === true,
    permissionRefs: options.permissionRefs,
  }));
  const created = host.createSession(
    { profileId: 'native-host-agent-act', defaultSurfaceTransport: 'native-frame-stream' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:run/native-host-agent-act/current-run.json',
      evidenceRootRef: 'computer-use:run/native-host-agent-act/evidence',
      guiPresentRef: 'gui.present:native-host-agent-act/screen-pane',
    },
  );
  assert.equal(created.status, 'ok');
  assert.equal(host.launchOrAttachApp(created.value.sessionId, {
    appId: 'contract-smoke',
    appRef: 'app:contract-smoke',
  }).status, 'ok');
  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:native-host-agent-act/screen',
    targetWindowRef: 'window:native-host-agent-act/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  const presented = host.presentSurface(created.value.sessionId, attached.value.liveBindingAttachGrantRef);
  assert.equal(presented.status, 'ok');
  const firstFrame = host.readFrame(created.value.sessionId);
  assert.equal(firstFrame.status, 'ok');

  const inputLeaseRef = 'computer-use:native-host/agent-act/leases/active.json';
  const actionAdapterRef = 'computer-use:native-host/agent-act/adapters/contract-smoke.json';
  const evidenceLedgerRef = created.value.ledgerRef;
  const adapterReadinessRef = created.value.readiness.adapterReadinessRef;
  const permissionRef = created.value.readiness.permissionRefs[0] ?? 'permission:native-host/agent-act';
  const grantValidationRef = presented.value.validationLedgerEntryRef!;

  recordVirtualAppScreenNativeHostSession({
    host,
    session: created.value,
    surface: attached.value,
    ...(options.omitCurrentFrame ? {} : { frame: firstFrame.value }),
    refs: {
      ...(options.omitInputLease ? {} : { inputLeaseRef }),
      ...(options.omitActionAdapter ? {} : { actionAdapterRef }),
      adapterReadinessRef,
      evidenceLedgerRef,
      ...(options.omitGrantValidation ? {} : { grantValidationRef }),
    },
  });
  recordVirtualAppScreenProviderSession(parsedNativeHostAttachCommand({
    screenRef: attached.value.screenRef,
    targetAppRef: 'app:contract-smoke',
    adapterReadinessRef,
    evidenceLedgerRef,
  }), {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-session-manager.v1',
    status: 'attached',
    executorId: 'native-session-manager:native-host-agent-act-test',
    providerId: 'native-virtual-app-screen-host',
    refs: {
      currentRunRef: created.value.evidenceContext.currentRunRef,
      sessionRef: created.value.sessionRef,
      liveSurfaceRef: attached.value.liveSurfaceRef,
      surfaceTransportRef: attached.value.surfaceTransportRef,
      frameStreamRef: attached.value.frameStreamRef,
      currentFrameRef: firstFrame.value.frameRef,
      frameTransportContractRef: attached.value.frameTransportContractRef,
      frameTelemetryRef: attached.value.frameTelemetryRef,
      mediaChannelRef: attached.value.mediaChannelRef,
      dataChannelRef: attached.value.dataChannelRef,
      liveBindingAttachGrantRef: attached.value.liveBindingAttachGrantRef,
      grantValidationRef,
      surfaceOwnerRef: attached.value.surfaceOwnerRef,
      displayOwnerRef: attached.value.displayOwnerRef,
      screenRef: attached.value.screenRef,
      targetAppRef: 'app:contract-smoke',
      targetWindowRef: attached.value.targetWindowRef,
      inputLeaseRef,
      actionAdapterRef,
      adapterReadinessRef,
      evidenceLedgerRef,
      guiPresentRef: created.value.evidenceContext.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: buildVirtualDisplaySurfaceTransportDescriptor({
        providerId: 'native-virtual-app-screen-host',
        transport: 'native-frame-stream',
        surfaceTransportRef: attached.value.surfaceTransportRef,
        liveSurfaceRef: attached.value.liveSurfaceRef,
        frameStreamRef: attached.value.frameStreamRef,
        currentFrameRef: firstFrame.value.frameRef,
        frameTransportContractRef: attached.value.frameTransportContractRef!,
        frameTelemetryRef: attached.value.frameTelemetryRef,
        mediaChannelRef: attached.value.mediaChannelRef,
        dataChannelRef: attached.value.dataChannelRef,
        currentFrameSequence: firstFrame.value.frameSequence,
      }),
      evidenceRefs: [
        attached.value.liveBindingAttachGrantRef,
        grantValidationRef,
        evidenceLedgerRef,
        firstFrame.value.frameRef,
      ],
    },
  });

  return {
    host,
    sessionId: created.value.sessionId,
    sessionRef: created.value.sessionRef,
    screenRef: attached.value.screenRef,
    targetWindowRef: attached.value.targetWindowRef,
    currentFrameRef: firstFrame.value.frameRef,
    currentRunPointerRef: created.value.currentRunPointerRef,
    inputLeaseRef,
    actionAdapterRef,
    adapterReadinessRef,
    evidenceLedgerRef,
    liveBindingAttachGrantRef: attached.value.liveBindingAttachGrantRef,
    grantValidationRef,
    permissionRef,
  };
}

class ProductModeContractSmokeNativeHostPlatformAdapter extends ContractSmokeNativeHostPlatformAdapter {
  constructor(private readonly options: {
    diagnosticOnly?: boolean;
    permissionRefs?: string[];
  } = {}) {
    super();
  }

  override describe(): NativeVirtualAppScreenHostDescription {
    const description = super.describe();
    return {
      ...description,
      permissionRefs: this.options.permissionRefs ?? description.permissionRefs,
      diagnosticOnly: this.options.diagnosticOnly === true,
    };
  }

  override probe(): NativeHostReadinessRecord {
    const probe = super.probe();
    return {
      ...probe,
      permissionRefs: this.options.permissionRefs ?? probe.permissionRefs,
      diagnosticOnly: this.options.diagnosticOnly === true,
    };
  }

  launchOrAttachApp(_session: NativeHostSession, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostAppProfile> {
    return { status: 'ok', value: appProfile };
  }

  attachSurface(session: NativeHostSession, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface> {
    const surfaceId = surfaceTarget.surfaceId ?? `surface-${session.sessionId}`;
    return {
      status: 'ok',
      value: {
        surfaceId,
        screenRef: surfaceTarget.screenRef,
        targetAppRef: session.app?.appRef ?? 'app:contract-smoke',
        targetWindowRef: surfaceTarget.targetWindowRef,
        sessionRef: session.sessionRef,
        liveSurfaceRef: `computer-use:native-host/surfaces/${surfaceId}/live-surface.json`,
        liveBindingAttachGrantRef: `computer-use:native-host/grants/${surfaceId}/live-binding-attach-grant.json`,
        surfaceOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/surface-owner.json`,
        displayOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/display-owner.json`,
        surfaceTransport: surfaceTarget.transport,
        surfaceTransportRef: `computer-use:native-host/surfaces/${surfaceId}/surface-transport.json`,
        frameStreamRef: `computer-use:native-host/surfaces/${surfaceId}/frame-stream.json`,
        frameTransportContractRef: `computer-use:native-host/surfaces/${surfaceId}/frame-transport-contract.json`,
        frameTelemetryRef: `computer-use:native-host/surfaces/${surfaceId}/frame-telemetry.json`,
        currentFrameSequence: 0,
      },
    };
  }

  readFrame(session: NativeHostSession, _cursor?: string): NativeHostResult<NativeHostFrame> {
    assert.ok(session.surface);
    const frameSequence = session.surface.currentFrameSequence + 1;
    const frameRef = `computer-use:native-host/frames/${session.surface.surfaceId}/${String(frameSequence).padStart(4, '0')}.png`;
    return {
      status: 'ok',
      value: {
        frameRef,
        frameHash: 'a'.repeat(64),
        frameSequence,
        liveSurfaceRef: session.surface.liveSurfaceRef,
        frameStreamRef: session.surface.frameStreamRef,
        readAt: new Date().toISOString(),
      },
    };
  }

  sendHumanInput(
    _session: NativeHostSession,
    _inputEvent: NativeHostHumanInputEvent,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostHumanInputAccepted>> {
    return {
      status: 'ok',
      value: {
        inputAcceptedRef: 'computer-use:native-host/product-adapter/input-accepted.json',
        inputSequence: 1,
        acceptedAt: new Date().toISOString(),
        fireAndRelease: true,
        evidenceWillCatchUp: true,
        providerEvidenceRefs: ['computer-use:native-host/product-adapter/provider-input.json'],
      },
    };
  }
}

function parsedNativeHostAttachCommand(refs: {
  screenRef: string;
  targetAppRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
}) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "contract-smoke"',
    `--target-app-ref "${refs.targetAppRef}"`,
    `--screen-ref "${refs.screenRef}"`,
    '--activation-ref "computer-use:native-host/agent-act/activation.json"',
    `--adapter-readiness-ref "${refs.adapterReadinessRef}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef}"`,
    '--gui-present-ref "gui.present:native-host-agent-act/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed attach command');
  return parsed.command;
}
