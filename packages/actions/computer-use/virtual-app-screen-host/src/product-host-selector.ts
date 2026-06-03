import {
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  type NativeHostCapabilityFlags,
  type NativeHostReadinessRecord,
  type NativeHostSurfaceTransport,
  type NativeVirtualAppScreenHost,
  type NativeVirtualAppScreenHostDescription,
  type NativeVirtualAppScreenPlatformAdapter,
} from './contracts';
import { InMemoryNativeVirtualAppScreenHost } from './in-memory-host';

const productBlockedCapabilities: NativeHostCapabilityFlags = {
  createDisplay: false,
  launchApp: false,
  attachWindow: false,
  captureFrame: false,
  streamFrames: false,
  sendHumanInput: false,
  executeAutomationIntent: false,
  validateGrant: true,
  writeEvidenceLedger: true,
  backgroundRenderable: false,
  affectsPhysicalDisplay: false,
  requiresFocusSteal: false,
  sharedSystemInputUsed: false,
};

export function createDefaultProductNativeVirtualAppScreenHost(
  adapters: NativeVirtualAppScreenPlatformAdapter[] = [],
): NativeVirtualAppScreenHost {
  const selection = selectProductNativeVirtualAppScreenAdapter(adapters);
  return new InMemoryNativeVirtualAppScreenHost(selection.adapter);
}

export function selectProductNativeVirtualAppScreenAdapter(
  adapters: NativeVirtualAppScreenPlatformAdapter[],
): { adapter: NativeVirtualAppScreenPlatformAdapter; rejectedReasons: string[] } {
  const rejectedReasons: string[] = [];
  for (const adapter of adapters) {
    const reason = productAdapterBlockedReason(adapter);
    if (!reason) return { adapter, rejectedReasons };
    rejectedReasons.push(reason);
  }
  return {
    adapter: new ProductSelectionFailClosedAdapter(rejectedReasons),
    rejectedReasons,
  };
}

function productAdapterBlockedReason(adapter: NativeVirtualAppScreenPlatformAdapter): string | undefined {
  const description = adapter.describe();
  const readiness = adapter.probe();
  const adapterName = description.backendKind || readiness.adapterKind || description.hostId;
  const missingHooks = [
    adapter.launchOrAttachApp ? undefined : 'launchOrAttachApp',
    adapter.attachSurface ? undefined : 'attachSurface',
    adapter.readFrame ? undefined : 'readFrame',
  ].filter((entry): entry is string => Boolean(entry));

  if (description.diagnosticOnly || readiness.diagnosticOnly) {
    return `${adapterName} is diagnostic-only.`;
  }
  if (readiness.status !== 'ready') {
    return `${adapterName} readiness is ${readiness.status}.`;
  }
  if (!readiness.capabilities.backgroundRenderable) {
    return `${adapterName} did not prove background isolated rendering.`;
  }
  if (readiness.capabilities.affectsPhysicalDisplay) {
    return `${adapterName} may affect the physical display.`;
  }
  if (readiness.capabilities.requiresFocusSteal) {
    return `${adapterName} requires focus stealing.`;
  }
  if (readiness.capabilities.sharedSystemInputUsed) {
    return `${adapterName} uses shared system input.`;
  }
  if (missingHooks.length) {
    return `${adapterName} is missing product materialization hooks: ${missingHooks.join(', ')}.`;
  }
  return undefined;
}

class ProductSelectionFailClosedAdapter implements NativeVirtualAppScreenPlatformAdapter {
  private readonly rejectedReasons: string[];

  constructor(rejectedReasons: string[]) {
    this.rejectedReasons = rejectedReasons;
  }

  describe(): NativeVirtualAppScreenHostDescription {
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      hostId: 'native-virtual-app-screen-host.product-selector.fail-closed',
      platform: 'unknown',
      backendKind: 'no-product-platform-adapter',
      protocol: [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL],
      supportedApps: [],
      supportedTransports: [] satisfies NativeHostSurfaceTransport[],
      supportedInputAdapters: [],
      capabilities: productBlockedCapabilities,
      permissionRefs: [],
      blockedReason: productSelectionBlockedReason(this.rejectedReasons),
      diagnosticOnly: true,
      thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only',
    };
  }

  probe(): NativeHostReadinessRecord {
    const description = this.describe();
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      status: 'blocked',
      adapterKind: description.backendKind,
      platform: description.platform,
      checkedAt: new Date().toISOString(),
      adapterReadinessRef: 'computer-use:native-host/readiness/no-product-platform-adapter.json',
      permissionRefs: [],
      driverRefs: [],
      providerRefs: [],
      capabilities: productBlockedCapabilities,
      diagnosticOnly: true,
      blockedReason: description.blockedReason,
      handoffRef: 'computer-use:native-host/handoff/no-product-platform-adapter.json',
      recheckRef: 'computer-use:native-host/recheck/no-product-platform-adapter.json',
    };
  }
}

function productSelectionBlockedReason(rejectedReasons: string[]): string {
  const suffix = rejectedReasons.length ? ` Rejected adapters: ${rejectedReasons.join(' ')}` : '';
  return `No product-ready Native VirtualAppScreen platform adapter is registered.${suffix}`;
}
