import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA =
  'sciforge.virtual-display.provider-description.v1' as const;
export const VIRTUAL_DISPLAY_READINESS_SCHEMA =
  'sciforge.virtual-display.readiness.v1' as const;

export type VirtualDisplayPlatform = 'darwin' | 'linux' | 'win32';
export type VirtualDisplayTransport =
  | 'webrtc'
  | 'native-frame-stream';
export type VirtualDisplayInputAdapter =
  | 'app-command'
  | 'ax'
  | 'uia'
  | 'at-spi'
  | 'virtual-display-input';
export type VirtualDisplayProviderInstallState = 'installed' | 'installable' | 'unsupported';
export type VirtualDisplayProviderStatus = 'ready' | 'blocked';
export type VirtualDisplayAttachState =
  | 'attached'
  | 'adapter-unavailable'
  | 'observe-only'
  | 'blocked'
  | 'requires-handoff';

export interface VirtualDisplayProviderCapabilities {
  createDisplay: boolean;
  launchApp: boolean;
  attachWindow: boolean;
  captureFrame: boolean;
  streamFrames: boolean;
  executeInputIntent: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
}

export interface VirtualDisplayProviderDescription {
  schemaVersion: typeof VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA;
  providerId: string;
  platform: VirtualDisplayPlatform;
  backendKind: string;
  supportedApps?: string[];
  supportedTransports: VirtualDisplayTransport[];
  supportedInputAdapters: VirtualDisplayInputAdapter[];
  capabilities: VirtualDisplayProviderCapabilities;
  permissionRefs?: string[];
  blockedReason?: string;
}

export interface VirtualDisplayReadiness {
  schemaVersion: typeof VIRTUAL_DISPLAY_READINESS_SCHEMA;
  providerId: string;
  platform: string;
  backendKind: string;
  installationStatus: VirtualDisplayProviderInstallState;
  appIdentity?: Record<string, unknown>;
  windowIdentity?: Record<string, unknown>;
  displayIdentity?: Record<string, unknown>;
  captureSupported: boolean;
  liveSurfaceSupported: boolean;
  inputSupported: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
  systemPointerMoved: boolean;
  systemKeyboardEventsSent: boolean;
  singleInteractiveTruth: boolean;
  permissionRefs: string[];
  diagnosticRefs: string[];
  installHintRefs: string[];
  selectedTransport?: VirtualDisplayTransport;
  blockedReason?: string;
}

export interface VirtualDisplayProviderProbe {
  description: VirtualDisplayProviderDescription;
  readiness: VirtualDisplayReadiness;
  installState: VirtualDisplayProviderInstallState;
  missingRequirements: string[];
  installHints: string[];
  priority: number;
}

export interface VirtualDisplayProviderProbeBundle {
  schemaVersion: 'sciforge.virtual-display.provider-probe-bundle.v1';
  targetAppKind: string;
  hostPlatform: string;
  selectedProviderId?: string;
  probes: VirtualDisplayProviderProbe[];
  selectedReadiness?: VirtualDisplayReadiness;
  status: VirtualDisplayProviderStatus;
  blockedReason?: string;
}

export type VirtualDisplayProviderInvokeIntent =
  | 'probe'
  | 'createSession'
  | 'launchApp'
  | 'attachSurface'
  | 'executeInputIntent'
  | 'pause'
  | 'resume'
  | 'closeSession'
  | 'handoff';

export interface VirtualDisplayProviderInvokeResult {
  schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1';
  intent: VirtualDisplayProviderInvokeIntent;
  providerId?: string;
  status: 'ready' | 'blocked' | 'requires-handoff';
  refs: Record<string, string | string[] | undefined>;
  readiness?: VirtualDisplayReadiness;
  blockedReason?: string;
  mutatingActionExecuted: boolean;
  rawPayloadWritten: false;
}

export interface VirtualDisplayScreenPayload {
  title: string;
  status: 'ready' | 'blocked' | 'observe-only';
  attachState: VirtualDisplayAttachState;
  displayGroupRef?: string;
  screenRef: string;
  liveSurfaceRef?: string;
  surfaceTransport?: VirtualDisplayTransport;
  targetAppRef: string;
  targetWindowRef?: string;
  sessionRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  beforeAfterFrameRefs?: string[];
  inputIntentRefs?: string[];
  executorEventRefs?: string[];
  inputLeaseRef?: string;
  actionAdapterRef?: string;
  adapterReadinessRef: string;
  replayRef?: string;
  evidenceLedgerRef?: string;
  artifactRefs?: string[];
  verificationRefs?: string[];
  guiPresentRefs?: string[];
  blockedRef?: string;
  blockedReason?: string;
  screen?: { width?: number; height?: number; label?: string };
  isolationFlags: {
    affectsPhysicalDisplay: boolean;
    requiresFocusSteal: boolean;
    sharedSystemInputUsed: boolean;
    systemPointerMoved: boolean;
    systemKeyboardEventsSent: boolean;
    backgroundRenderable: boolean;
    diagnosticOnly: boolean;
  };
}

interface ProviderDefinition extends VirtualDisplayProviderDescription {
  hostPlatforms: Array<NodeJS.Platform | 'any'>;
  priority: number;
  requiredCommands?: string[];
  anyCommandGroups?: string[][];
  requiredNodePackages?: string[];
  manualRequirementKeys?: string[];
  installHints: string[];
  installHintRefs: string[];
  permissionRefs: string[];
  transportPreference: VirtualDisplayTransport[];
}

export interface VirtualDisplayProviderProbeOptions {
  platform?: NodeJS.Platform | string;
  targetAppKind?: string;
  commandAvailability?: Record<string, boolean>;
  nodePackageAvailability?: Record<string, boolean>;
  manualRequirementAvailability?: Record<string, boolean>;
  permissionGrants?: Record<string, boolean>;
}

const requireFromHere = createRequire(import.meta.url);

export function describeVirtualDisplayProviders(
  platform: NodeJS.Platform | string = process.platform,
): VirtualDisplayProviderDescription[] {
  return providerDefinitions(platform).map(({ hostPlatforms: _hostPlatforms, priority: _priority, requiredCommands: _requiredCommands, anyCommandGroups: _anyCommandGroups, requiredNodePackages: _requiredNodePackages, manualRequirementKeys: _manualRequirementKeys, installHints: _installHints, installHintRefs: _installHintRefs, transportPreference: _transportPreference, ...description }) => description);
}

export function probeVirtualDisplayProviders(
  options: VirtualDisplayProviderProbeOptions = {},
): VirtualDisplayProviderProbeBundle {
  const platform = options.platform ?? process.platform;
  const targetAppKind = normalizeTargetAppKind(options.targetAppKind ?? 'vscode');
  const probes = providerDefinitions(platform)
    .filter((definition) => supportsTargetApp(definition, targetAppKind))
    .map((definition) => probeProvider(definition, { ...options, platform, targetAppKind }))
    .sort((left, right) => left.priority - right.priority || left.description.providerId.localeCompare(right.description.providerId));
  const selected = selectVirtualDisplayProviderProbe(probes);
  const selectedReadiness = selected?.readiness;
  const blockedReason = selectedReadiness && !isVirtualDisplayReadinessControllable(selectedReadiness)
    ? selectedReadiness.blockedReason
    : probes.length
      ? undefined
      : `No VirtualDisplayProvider profile supports target app kind "${targetAppKind}" on ${String(platform)}.`;
  return {
    schemaVersion: 'sciforge.virtual-display.provider-probe-bundle.v1',
    targetAppKind,
    hostPlatform: String(platform),
    selectedProviderId: selected?.description.providerId,
    probes,
    selectedReadiness,
    status: selectedReadiness && isVirtualDisplayReadinessControllable(selectedReadiness) ? 'ready' : 'blocked',
    blockedReason,
  };
}

export function readVirtualDisplayProvider(
  providerId: string,
  options: VirtualDisplayProviderProbeOptions = {},
): VirtualDisplayProviderDescription | undefined {
  return describeVirtualDisplayProviders(options.platform ?? process.platform)
    .find((provider) => provider.providerId === providerId);
}

export function queryVirtualDisplayProviders(
  filters: VirtualDisplayProviderProbeOptions & {
    backendKind?: string;
    supportedTransport?: VirtualDisplayTransport;
    supportedInputAdapter?: VirtualDisplayInputAdapter;
  } = {},
): VirtualDisplayProviderDescription[] {
  return describeVirtualDisplayProviders(filters.platform ?? process.platform)
    .filter((provider) => !filters.targetAppKind || supportsTargetApp(provider, normalizeTargetAppKind(filters.targetAppKind)))
    .filter((provider) => !filters.backendKind || provider.backendKind === filters.backendKind)
    .filter((provider) => !filters.supportedTransport || provider.supportedTransports.includes(filters.supportedTransport))
    .filter((provider) => !filters.supportedInputAdapter || provider.supportedInputAdapters.includes(filters.supportedInputAdapter));
}

export function invokeVirtualDisplayProvider(options: {
  intent: VirtualDisplayProviderInvokeIntent;
  runId: string;
  targetAppKind?: string;
  targetAppName?: string;
  probeOptions?: VirtualDisplayProviderProbeOptions;
  probeBundle?: VirtualDisplayProviderProbeBundle;
  blockedReason?: string;
}): VirtualDisplayProviderInvokeResult {
  const probeBundle = options.probeBundle ?? probeVirtualDisplayProviders({
    ...(options.probeOptions ?? {}),
    targetAppKind: options.targetAppKind ?? options.probeOptions?.targetAppKind ?? 'vscode',
  });
  const readiness = probeBundle.selectedReadiness;
  const providerReady = isVirtualDisplayReadinessControllable(readiness);
  const payload = buildVirtualDisplayScreenPayload({
    runId: options.runId,
    targetAppKind: options.targetAppKind ?? probeBundle.targetAppKind,
    targetAppName: options.targetAppName,
    probeBundle,
  });
  if (options.intent === 'probe') {
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: options.intent,
      providerId: probeBundle.selectedProviderId,
      status: providerReady ? 'ready' : statusForBlockedReason(readiness?.blockedReason ?? probeBundle.blockedReason),
      refs: {
        adapterReadinessRef: payload.adapterReadinessRef,
        providerProbeRef: `.sciforge/vision-runs/${sanitizeRefSegment(options.runId)}/virtual-display-provider/probe-bundle.json`,
        blockedRef: providerReady ? undefined : payload.blockedRef,
      },
      readiness,
      blockedReason: providerReady ? undefined : readiness?.blockedReason ?? probeBundle.blockedReason,
      mutatingActionExecuted: false,
      rawPayloadWritten: false,
    };
  }
  if (!providerReady) {
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: options.intent,
      providerId: probeBundle.selectedProviderId,
      status: statusForBlockedReason(options.blockedReason ?? readiness?.blockedReason ?? probeBundle.blockedReason),
      refs: {
        adapterReadinessRef: payload.adapterReadinessRef,
        blockedRef: payload.blockedRef,
      },
      readiness,
      blockedReason: options.blockedReason ?? readiness?.blockedReason ?? probeBundle.blockedReason ?? 'VirtualDisplayProvider is not ready.',
      mutatingActionExecuted: false,
      rawPayloadWritten: false,
    };
  }
  return readyInvokeResult(options.intent, payload, readiness);
}

export function selectVirtualDisplayProviderProbe(
  probes: VirtualDisplayProviderProbe[],
): VirtualDisplayProviderProbe | undefined {
  return probes.find((probe) => isVirtualDisplayReadinessControllable(probe.readiness))
    ?? probes.find((probe) => probe.installState === 'installed')
    ?? probes.find((probe) => probe.installState === 'installable')
    ?? probes[0];
}

export function isVirtualDisplayReadinessControllable(readiness: VirtualDisplayReadiness | undefined): boolean {
  return Boolean(
    readiness
    && readiness.captureSupported
    && readiness.liveSurfaceSupported
    && readiness.inputSupported
    && readiness.backgroundRenderable
    && readiness.affectsPhysicalDisplay === false
    && readiness.requiresFocusSteal === false
    && readiness.sharedSystemInputUsed === false
    && readiness.systemPointerMoved === false
    && readiness.systemKeyboardEventsSent === false
    && readiness.singleInteractiveTruth
    && !readiness.blockedReason,
  );
}

export function virtualDisplayReadinessToAdapterReadiness(readiness: VirtualDisplayReadiness) {
  return {
    adapterKind: readiness.backendKind,
    targetScope: 'virtual-app-screen',
    supportedActions: readiness.inputSupported
      ? ['click', 'type_text', 'drag', 'scroll', 'hotkey', 'menu_command']
      : [],
    captureSupported: readiness.captureSupported,
    backgroundRenderable: readiness.backgroundRenderable,
    affectsPhysicalDisplay: readiness.affectsPhysicalDisplay,
    requiresFocusSteal: readiness.requiresFocusSteal,
    sharedSystemInputUsed: readiness.sharedSystemInputUsed,
    blockedReason: readiness.blockedReason ?? null,
    schemaRefs: [
      'sciforge.computer-use.action-adapter-readiness.v1',
      VIRTUAL_DISPLAY_READINESS_SCHEMA,
    ],
  };
}

export function buildVirtualDisplayScreenPayload(options: {
  runId: string;
  targetAppKind?: string;
  targetAppName?: string;
  probeBundle: VirtualDisplayProviderProbeBundle;
}): VirtualDisplayScreenPayload {
  const runId = sanitizeRefSegment(options.runId);
  const targetAppKind = normalizeTargetAppKind(options.targetAppKind ?? options.probeBundle.targetAppKind);
  const targetAppName = options.targetAppName ?? (targetAppKind === 'vscode' ? 'VSCode' : targetAppKind);
  const readiness = options.probeBundle.selectedReadiness;
  const ready = isVirtualDisplayReadinessControllable(readiness);
  const baseRef = `.sciforge/vision-runs/${runId}/virtual-display-provider`;
  const targetAppRef = `app:${runId}/${sanitizeRefSegment(targetAppKind)}`;
  const targetWindowRef = ready ? `window:${runId}/${sanitizeRefSegment(targetAppKind)}/main` : undefined;
  const sessionRef = ready ? `computer-use:session/${runId}/virtual-display-session.json` : undefined;
  const screenRef = `virtual-app-screen:${runId}/screen`;
  const blockedReason = readiness?.blockedReason
    ?? options.probeBundle.blockedReason
    ?? 'VirtualDisplayProvider is not ready for isolated background control.';
  return {
    title: `${targetAppName} VirtualAppScreen`,
    status: ready ? 'ready' : 'blocked',
    attachState: ready ? 'attached' : attachStateForReadiness(readiness),
    displayGroupRef: ready ? `virtual-display-group:${runId}` : undefined,
    screenRef,
    liveSurfaceRef: ready ? `${baseRef}/live-surface.json` : undefined,
    surfaceTransport: ready ? readiness?.selectedTransport ?? 'webrtc' : undefined,
    targetAppRef,
    targetWindowRef,
    sessionRef,
    frameStreamRef: ready ? `${baseRef}/frame-stream.json` : undefined,
    currentFrameRef: ready ? `${baseRef}/frames/after.json` : undefined,
    beforeFrameRef: ready ? `${baseRef}/frames/before.json` : undefined,
    afterFrameRef: ready ? `${baseRef}/frames/after.json` : undefined,
    beforeAfterFrameRefs: ready ? [`${baseRef}/before-after/input.json`] : [],
    inputIntentRefs: ready ? [`${baseRef}/input-intents/click-and-type.json`] : [],
    executorEventRefs: ready ? [`${baseRef}/executor-events/click-and-type.json`] : [],
    inputLeaseRef: ready ? `${baseRef}/input-lease.json` : undefined,
    actionAdapterRef: ready ? `${baseRef}/action-adapter.json` : undefined,
    adapterReadinessRef: `${baseRef}/adapter-readiness.json`,
    replayRef: ready ? `${baseRef}/replay.json` : undefined,
    evidenceLedgerRef: ready ? `${baseRef}/evidence-ledger.json` : undefined,
    artifactRefs: ready ? [`artifact:${runId}/vscode-virtual-screen-note.md`] : [],
    verificationRefs: ready ? [`${baseRef}/verification/vscode-input.json`] : [],
    guiPresentRefs: ready ? [`gui:present/${runId}/screen-pane`] : [],
    blockedRef: ready ? undefined : `${baseRef}/blocked.json`,
    blockedReason: ready ? undefined : blockedReason,
    screen: { width: 1440, height: 900, label: `${targetAppName} virtual app surface` },
    isolationFlags: {
      affectsPhysicalDisplay: readiness?.affectsPhysicalDisplay ?? false,
      requiresFocusSteal: readiness?.requiresFocusSteal ?? false,
      sharedSystemInputUsed: readiness?.sharedSystemInputUsed ?? false,
      systemPointerMoved: readiness?.systemPointerMoved ?? false,
      systemKeyboardEventsSent: readiness?.systemKeyboardEventsSent ?? false,
      backgroundRenderable: ready,
      diagnosticOnly: !ready,
    },
  };
}

function probeProvider(
  definition: ProviderDefinition,
  options: VirtualDisplayProviderProbeOptions & { platform: NodeJS.Platform | string; targetAppKind: string },
): VirtualDisplayProviderProbe {
  const missingRequirements = missingInstallRequirements(definition, options);
  const hostSupported = definition.hostPlatforms.includes('any') || definition.hostPlatforms.includes(options.platform as NodeJS.Platform);
  const installState: VirtualDisplayProviderInstallState = !hostSupported
    ? 'unsupported'
    : missingRequirements.length
      ? 'installable'
      : 'installed';
  const missingPermissions = installState === 'installed'
    ? definition.permissionRefs.filter((ref) => options.permissionGrants?.[ref] !== true)
    : [];
  const blockedReason = blockedReasonForProbe(definition, installState, missingRequirements, missingPermissions);
  const usable = installState === 'installed' && missingPermissions.length === 0;
  const readiness: VirtualDisplayReadiness = {
    schemaVersion: VIRTUAL_DISPLAY_READINESS_SCHEMA,
    providerId: definition.providerId,
    platform: definition.platform,
    backendKind: definition.backendKind,
    installationStatus: installState,
    appIdentity: {
      targetAppKind: options.targetAppKind,
      supportedByProvider: true,
    },
    captureSupported: usable && definition.capabilities.captureFrame,
    liveSurfaceSupported: usable && definition.capabilities.streamFrames,
    inputSupported: usable && definition.capabilities.executeInputIntent,
    backgroundRenderable: usable && definition.capabilities.backgroundRenderable,
    affectsPhysicalDisplay: definition.capabilities.affectsPhysicalDisplay,
    requiresFocusSteal: definition.capabilities.requiresFocusSteal,
    sharedSystemInputUsed: definition.capabilities.sharedSystemInputUsed,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    singleInteractiveTruth: usable,
    permissionRefs: definition.permissionRefs,
    diagnosticRefs: [`virtual-display-provider:${definition.providerId}/probe`],
    installHintRefs: definition.installHintRefs,
    selectedTransport: usable ? definition.transportPreference[0] : undefined,
    blockedReason,
  };
  return {
    description: {
      schemaVersion: definition.schemaVersion,
      providerId: definition.providerId,
      platform: definition.platform,
      backendKind: definition.backendKind,
      supportedApps: definition.supportedApps,
      supportedTransports: definition.supportedTransports,
      supportedInputAdapters: definition.supportedInputAdapters,
      capabilities: definition.capabilities,
      permissionRefs: definition.permissionRefs,
      blockedReason: definition.blockedReason,
    },
    readiness,
    installState,
    missingRequirements,
    installHints: definition.installHints,
    priority: definition.priority,
  };
}

function missingInstallRequirements(
  definition: ProviderDefinition,
  options: VirtualDisplayProviderProbeOptions,
): string[] {
  const missing: string[] = [];
  for (const command of definition.requiredCommands ?? []) {
    if (!hasCommand(command, options)) missing.push(`command:${command}`);
  }
  for (const group of definition.anyCommandGroups ?? []) {
    if (!group.some((command) => hasCommand(command, options))) {
      missing.push(`one-of-command:${group.join('|')}`);
    }
  }
  for (const packageName of definition.requiredNodePackages ?? []) {
    if (!hasNodePackage(packageName, options)) missing.push(`node-package:${packageName}`);
  }
  for (const key of definition.manualRequirementKeys ?? []) {
    if (options.manualRequirementAvailability?.[key] !== true) missing.push(`manual:${key}`);
  }
  return missing;
}

function hasCommand(command: string, options: VirtualDisplayProviderProbeOptions) {
  const injected = options.commandAvailability?.[command];
  if (injected !== undefined) return injected;
  return defaultCommandExists(command);
}

function hasNodePackage(packageName: string, options: VirtualDisplayProviderProbeOptions) {
  const injected = options.nodePackageAvailability?.[packageName];
  if (injected !== undefined) return injected;
  try {
    requireFromHere.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function defaultCommandExists(command: string) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function blockedReasonForProbe(
  definition: ProviderDefinition,
  installState: VirtualDisplayProviderInstallState,
  missingRequirements: string[],
  missingPermissions: string[],
) {
  if (installState === 'unsupported') {
    return `${definition.providerId} is not supported on this host platform.`;
  }
  if (installState === 'installable') {
    return [
      `${definition.providerId} is installable but not installed.`,
      `Missing requirements: ${missingRequirements.join(', ')}.`,
      'SciForge will not install drivers, system extensions, or privileged services without explicit user handoff.',
    ].join(' ');
  }
  if (missingPermissions.length) {
    return [
      `${definition.providerId} is installed but permission or driver readiness is not proven.`,
      `Missing permission refs: ${missingPermissions.join(', ')}.`,
      'The run is blocked instead of using shared system input or the physical desktop.',
    ].join(' ');
  }
  return undefined;
}

function attachStateForReadiness(readiness: VirtualDisplayReadiness | undefined): VirtualDisplayAttachState {
  if (!readiness) return 'adapter-unavailable';
  if (readiness.installationStatus !== 'installed') return 'adapter-unavailable';
  if (readiness.blockedReason?.toLowerCase().includes('permission')) return 'requires-handoff';
  if (readiness.captureSupported && readiness.liveSurfaceSupported && !readiness.inputSupported) return 'observe-only';
  return 'blocked';
}

function supportsTargetApp(definition: Pick<VirtualDisplayProviderDescription, 'supportedApps'>, targetAppKind: string) {
  if (!definition.supportedApps?.length) return true;
  return definition.supportedApps.includes('generic') || definition.supportedApps.includes(targetAppKind);
}

function readyInvokeResult(
  intent: VirtualDisplayProviderInvokeIntent,
  payload: VirtualDisplayScreenPayload,
  readiness: VirtualDisplayReadiness | undefined,
): VirtualDisplayProviderInvokeResult {
  const commonRefs = {
    adapterReadinessRef: payload.adapterReadinessRef,
    sessionRef: payload.sessionRef,
    displayGroupRef: payload.displayGroupRef,
    screenRef: payload.screenRef,
    targetAppRef: payload.targetAppRef,
    targetWindowRef: payload.targetWindowRef,
  };
  const refsByIntent: Record<VirtualDisplayProviderInvokeIntent, Record<string, string | string[] | undefined>> = {
    probe: commonRefs,
    createSession: {
      ...commonRefs,
      lifecycleEventRef: `${payload.sessionRef}#create-session`,
    },
    launchApp: {
      ...commonRefs,
      lifecycleEventRef: `${payload.sessionRef}#launch-app`,
    },
    attachSurface: {
      ...commonRefs,
      liveSurfaceRef: payload.liveSurfaceRef,
      frameStreamRef: payload.frameStreamRef,
      currentFrameRef: payload.currentFrameRef,
    },
    executeInputIntent: {
      ...commonRefs,
      inputIntentRefs: payload.inputIntentRefs ?? [],
      inputLeaseRef: payload.inputLeaseRef,
      actionAdapterRef: payload.actionAdapterRef,
      executorEventRefs: payload.executorEventRefs ?? [],
      beforeFrameRef: payload.beforeFrameRef,
      afterFrameRef: payload.afterFrameRef,
      beforeAfterFrameRefs: payload.beforeAfterFrameRefs ?? [],
      verificationRefs: payload.verificationRefs ?? [],
    },
    pause: {
      ...commonRefs,
      lifecycleEventRef: `${payload.sessionRef}#pause`,
    },
    resume: {
      ...commonRefs,
      lifecycleEventRef: `${payload.sessionRef}#resume`,
    },
    closeSession: {
      ...commonRefs,
      lifecycleEventRef: `${payload.sessionRef}#close-session`,
    },
    handoff: {
      ...commonRefs,
      handoffRef: `${payload.sessionRef}#handoff`,
    },
  };
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent,
    providerId: readiness?.providerId,
    status: 'ready',
    refs: refsByIntent[intent],
    readiness,
    mutatingActionExecuted: intent === 'executeInputIntent',
    rawPayloadWritten: false,
  };
}

function statusForBlockedReason(reason: string | undefined): VirtualDisplayProviderInvokeResult['status'] {
  return /permission|driver|install|handoff/i.test(reason ?? '') ? 'requires-handoff' : 'blocked';
}

function normalizeTargetAppKind(value: string) {
  const normalized = sanitizeRefSegment(value).replace(/^vs-code$/, 'vscode');
  if (normalized === 'code' || normalized === 'visual-studio-code') return 'vscode';
  return normalized || 'generic';
}

function sanitizeRefSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function providerDefinitions(platform: NodeJS.Platform | string): ProviderDefinition[] {
  if (platform === 'darwin') return [macosCgVirtualDisplayProvider()];
  if (platform === 'linux') return [linuxXpraProvider()];
  if (platform === 'win32') return [windowsIddProvider()];
  return [];
}

function macosCgVirtualDisplayProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.macos.cgvirtualdisplay-screencapturekit',
    platform: 'darwin',
    backendKind: 'cgvirtualdisplay-screencapturekit',
    hostPlatforms: ['darwin'],
    priority: 10,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['app-command', 'ax', 'virtual-display-input'],
    requiredNodePackages: ['node-mac-virtual-display'],
    installHints: ['npm install node-mac-virtual-display; grant macOS Screen Recording and Accessibility explicitly.'],
    installHintRefs: ['install-hint:macos/node-mac-virtual-display'],
    permissionRefs: ['permission:macos/screen-recording', 'permission:macos/accessibility'],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function linuxXpraProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.linux.xpra',
    platform: 'linux',
    backendKind: 'xpra-app-session',
    hostPlatforms: ['linux'],
    priority: 20,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'jupyter', 'pdf-viewer', 'csv-viewer', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['at-spi', 'virtual-display-input', 'app-command'],
    requiredCommands: ['xpra'],
    installHints: ['Install Xpra with the system package manager, then rerun provider probe.'],
    installHintRefs: ['install-hint:linux/xpra'],
    permissionRefs: [],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function windowsIddProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.windows.idd',
    platform: 'win32',
    backendKind: 'windows-indirect-display-driver',
    hostPlatforms: ['win32'],
    priority: 30,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['uia', 'app-command', 'virtual-display-input'],
    manualRequirementKeys: ['windows-idd-virtual-display-driver'],
    installHints: ['Install and authorize a Windows IDD virtual display driver through explicit user handoff.'],
    installHintRefs: ['install-hint:windows/idd-virtual-display-driver'],
    permissionRefs: ['permission:windows/idd-driver-authorized'],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function safeVirtualDisplayCapabilities(
  overrides: Partial<VirtualDisplayProviderCapabilities> = {},
): VirtualDisplayProviderCapabilities {
  return {
    createDisplay: true,
    launchApp: true,
    attachWindow: true,
    captureFrame: true,
    streamFrames: true,
    executeInputIntent: true,
    backgroundRenderable: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    ...overrides,
  };
}
