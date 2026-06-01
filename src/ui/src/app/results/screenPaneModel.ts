import {
  type VirtualScreenFrame,
  type VirtualScreenPayload,
} from '../../../../../packages/presentation/components';
import { normalizeWorkspaceRootPath } from '../../config';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { artifactsForRun } from './executionUnitsForRun';
import { isRecord, toRecordList } from './resultArtifactHelpers';
import { resultText, type ResultLocale } from './resultLocale';

export function rightPaneVirtualScreenPayload(
  session: SciForgeSession,
  activeRun: SciForgeRun | undefined,
  config: SciForgeConfig,
  locale?: ResultLocale,
): VirtualScreenPayload {
  const candidates = virtualScreenPayloadCandidates(session, activeRun, config);
  const payload = candidates.find((candidate) =>
    candidate.currentFrameRef
    || candidate.frameStreamRef
    || candidate.replayRef
    || candidate.targetAppRef
    || candidate.targetWindowRef
    || candidate.sessionRef
    || candidate.blockedRef
    || candidate.errorRef
    || (candidate.actorCursorRefs?.length ?? 0)
    || (candidate.annotationOverlayRefs?.length ?? 0)
    || (candidate.annotationProposalRefs?.length ?? 0)
    || (candidate.artifactRefs?.length ?? 0)
    || (candidate.verificationRefs?.length ?? 0)
    || (candidate.frameRefs?.length ?? 0)
  );
  if (payload) return payload;
  return {
    title: resultText(locale, { 'zh-CN': 'Computer Use 虚拟屏幕', 'en-US': 'Computer Use Virtual Screen' }),
    status: 'empty',
    isolationFlags: { diagnosticOnly: true },
  };
}

export function virtualScreenPayloadCandidates(session: SciForgeSession, activeRun: SciForgeRun | undefined, config: SciForgeConfig): VirtualScreenPayload[] {
  const runArtifacts = activeRun
    ? dedupeRuntimeArtifacts([
      ...artifactsForRun(session, activeRun),
      ...runtimeArtifactsFromRunForRightPane(activeRun),
    ])
    : [];
  const artifacts = activeRun ? runArtifacts : session.artifacts;
  return artifacts
    .filter((artifact) => /computer-use|virtual-screen|replay|screen/i.test([artifact.type, artifact.producerScenario, artifact.id].join(' ')))
    .map((artifact) => virtualScreenPayloadFromArtifact(artifact, config))
    .filter((payload): payload is VirtualScreenPayload => Boolean(payload));
}

export function virtualScreenPayloadFromArtifact(artifact: RuntimeArtifact, config: SciForgeConfig): VirtualScreenPayload | undefined {
  const data = isRecord(artifact.data) ? artifact.data : {};
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const runSummary = isRecord(data.runSummary)
    ? data.runSummary
    : isRecord(metadata.runSummary)
      ? metadata.runSummary
      : {};
  const sidecarBinding = isRecord(data.sidecarBinding) ? data.sidecarBinding : {};
  const sidecarCapabilities = isRecord(data.sidecarCapabilities) ? data.sidecarCapabilities : {};
  const sidecarDiscovery = isRecord(data.sidecarDiscovery) ? data.sidecarDiscovery : {};
  const frameRecords = virtualScreenFrameRecords(data, metadata, config);
  const frameRefs = frameRecords.map((frame) => frame.ref);
  const currentFrameRef = firstNonEmptyString(
    stringField(data.currentFrameRef),
    stringField(metadata.currentFrameRef),
    stringField(data.frameRef),
    stringField(metadata.frameRef),
    frameRefs[0],
  );
  const frameStreamRef = firstNonEmptyString(
    stringField(data.frameStreamRef),
    stringField(metadata.frameStreamRef),
    refFromValue(data.frameStream, ['ref', 'frameStreamRef']),
    refFromValue(metadata.frameStream, ['ref', 'frameStreamRef']),
  );
  const explicitScreenRef = firstNonEmptyString(
    stringField(data.screenRef),
    stringField(metadata.screenRef),
    stringListField(data.visibleScreenRefs)[0],
    stringListField(metadata.visibleScreenRefs)[0],
    frameRecords[0]?.screenRef,
  );
  const visibleScreenRefs = rightPaneRefList(
    explicitScreenRef,
    stringListField(data.visibleScreenRefs),
    stringListField(metadata.visibleScreenRefs),
    frameRecords.map((frame) => frame.screenRef),
  );
  const liveSurfaceRef = firstNonEmptyString(
    stringField(data.liveSurfaceRef),
    stringField(metadata.liveSurfaceRef),
    refFromValue(data.liveSurface, ['ref', 'liveSurfaceRef']),
    refFromValue(metadata.liveSurface, ['ref', 'liveSurfaceRef']),
  );
  const surfaceTransport = normalizeVirtualScreenSurfaceTransport(
    firstNonEmptyString(
      stringField(data.surfaceTransport),
      stringField(metadata.surfaceTransport),
      stringField(data.transport),
      stringField(metadata.transport),
      stringField(refFromValue(data.liveSurface, ['transport', 'surfaceTransport'])),
      stringField(refFromValue(metadata.liveSurface, ['transport', 'surfaceTransport'])),
    ),
  );
  const screen = virtualScreenInfo(data, metadata);
  const targetAppRef = firstNonEmptyString(
    stringField(data.targetAppRef),
    stringField(metadata.targetAppRef),
    stringField(data.appRef),
    stringField(metadata.appRef),
  );
  const targetWindowRef = firstNonEmptyString(
    stringField(data.targetWindowRef),
    stringField(metadata.targetWindowRef),
    stringField(data.windowRef),
    stringField(metadata.windowRef),
    explicitScreenRef,
  );
  const visibleCursorRefs = rightPaneRefList(
    stringListField(data.visibleCursorRefs),
    stringListField(metadata.visibleCursorRefs),
  );
  const beforeEvidenceRefs = rightPaneRefList(
    stringField(data.beforeEvidenceRef),
    stringField(metadata.beforeEvidenceRef),
    stringListField(data.beforeEvidenceRefs),
    stringListField(metadata.beforeEvidenceRefs),
    frameRecords.map((frame) => frame.beforeEvidenceRef),
  );
  const afterEvidenceRefs = rightPaneRefList(
    stringField(data.afterEvidenceRef),
    stringField(metadata.afterEvidenceRef),
    stringListField(data.afterEvidenceRefs),
    stringListField(metadata.afterEvidenceRefs),
    frameRecords.map((frame) => frame.afterEvidenceRef),
  );
  const annotationOverlayRefs = rightPaneRefList(
    stringListField(data.annotationOverlayRefs),
    stringListField(metadata.annotationOverlayRefs),
    stringListField(data.cursorOverlayRefs),
    stringListField(metadata.cursorOverlayRefs),
    ...frameRecords.flatMap((frame) => frame.cursorOverlayRefs ?? []),
  );
  const proposalRefs = rightPaneRefList(
    stringListField(data.annotationProposalRefs),
    stringListField(metadata.annotationProposalRefs),
    stringListField(data.proposalRefs),
    stringListField(metadata.proposalRefs),
    refsFromList(data.proposals, ['ref', 'proposalRef', 'actionProposalRef']),
    refsFromList(metadata.proposals, ['ref', 'proposalRef', 'actionProposalRef']),
    frameRecords.map((frame) => frame.proposalRef),
  );
  const actorCursorRefs = rightPaneRefList(
    visibleCursorRefs,
    refsFromList(data.actorCursors, ['ref', 'cursorRef', 'actorCursorRef', 'cursorDataRef']),
    refsFromList(metadata.actorCursors, ['ref', 'cursorRef', 'actorCursorRef', 'cursorDataRef']),
  );
  const inputIntentRefs = rightPaneRefList(
    stringField(data.inputIntentRef),
    stringField(metadata.inputIntentRef),
    stringListField(data.inputIntentRefs),
    stringListField(metadata.inputIntentRefs),
    refsFromList(data.inputIntents, ['ref', 'inputIntentRef', 'intentRef']),
    refsFromList(metadata.inputIntents, ['ref', 'inputIntentRef', 'intentRef']),
  );
  const executorEventRefs = rightPaneRefList(
    stringField(data.executorEventRef),
    stringField(metadata.executorEventRef),
    stringListField(data.executorEventRefs),
    stringListField(metadata.executorEventRefs),
    refsFromList(data.executorEvents, ['ref', 'executorEventRef', 'eventRef']),
    refsFromList(metadata.executorEvents, ['ref', 'executorEventRef', 'eventRef']),
    refsFromList(data.events, ['ref', 'executorEventRef', 'eventRef']),
    refsFromList(metadata.events, ['ref', 'executorEventRef', 'eventRef']),
  );
  const leaseOwnerRefs = rightPaneRefList(
    stringField(data.inputLeaseRef),
    stringField(metadata.inputLeaseRef),
    stringField(data.schedulerLeaseRef),
    stringField(metadata.schedulerLeaseRef),
    stringListField(data.leaseOwnerRefs),
    stringListField(metadata.leaseOwnerRefs),
    refsFromList(data.leaseOwnerRefs, ['ref', 'leaseOwnerRef', 'inputLeaseRef']),
    refsFromList(metadata.leaseOwnerRefs, ['ref', 'leaseOwnerRef', 'inputLeaseRef']),
    frameRecords.flatMap((frame) => frame.leaseOwnerRefs ?? []),
  );
  const actionAdapterRef = firstNonEmptyString(
    stringField(data.actionAdapterRef),
    stringField(metadata.actionAdapterRef),
    stringField(data.sidecarBindingRef),
    stringField(metadata.sidecarBindingRef),
    stringField(runSummary.sidecarBindingRef),
    refFromValue(data.actionAdapter, ['ref', 'actionAdapterRef', 'adapterRef']),
    refFromValue(metadata.actionAdapter, ['ref', 'actionAdapterRef', 'adapterRef']),
    refFromValue(sidecarBinding, ['ref', 'sidecarBindingRef', 'bindingRef']),
  );
  const adapterReadinessRef = firstNonEmptyString(
    stringField(data.adapterReadinessRef),
    stringField(metadata.adapterReadinessRef),
    stringField(data.sidecarCapabilitiesRef),
    stringField(metadata.sidecarCapabilitiesRef),
    stringField(runSummary.sidecarCapabilitiesRef),
    refFromValue(data.adapterReadiness, ['ref', 'adapterReadinessRef', 'readinessRef']),
    refFromValue(metadata.adapterReadiness, ['ref', 'adapterReadinessRef', 'readinessRef']),
    refFromValue(sidecarCapabilities, ['ref', 'sidecarCapabilitiesRef', 'capabilitiesRef']),
  );
  const replayRef = firstNonEmptyString(
    stringField(data.replayRef),
    stringField(metadata.replayRef),
    stringField(runSummary.replayRef),
    stringField(artifact.delivery?.readableRef),
    stringField(artifact.dataRef),
  );
  const sessionRef = firstNonEmptyString(stringField(data.sessionRef), stringField(metadata.sessionRef));
  const blockedRef = firstNonEmptyString(stringField(data.blockedRef), stringField(metadata.blockedRef));
  const errorRef = firstNonEmptyString(stringField(data.errorRef), stringField(metadata.errorRef));
  const validationRef = firstNonEmptyString(stringField(data.validationRef), stringField(metadata.validationRef), stringField(runSummary.validationRef));
  const completionEvidenceRef = firstNonEmptyString(stringField(data.completionEvidenceRef), stringField(metadata.completionEvidenceRef));
  const evidenceLedgerRef = firstNonEmptyString(
    stringField(data.evidenceLedgerRef),
    stringField(metadata.evidenceLedgerRef),
    stringField(data.evidenceBundleIndexRef),
    stringField(metadata.evidenceBundleIndexRef),
    stringField(data.evidenceIndexRef),
    stringField(metadata.evidenceIndexRef),
    stringField(runSummary.evidenceLedgerRef),
    stringField(runSummary.evidenceBundleIndexRef),
    stringField(runSummary.evidenceIndexRef),
  );
  const sidecarDiscoveryRef = firstNonEmptyString(
    stringField(data.sidecarDiscoveryRef),
    stringField(metadata.sidecarDiscoveryRef),
    stringField(runSummary.sidecarDiscoveryRef),
    refFromValue(sidecarDiscovery, ['ref', 'sidecarDiscoveryRef', 'discoveryRef']),
  );
  const currentBundleRef = firstNonEmptyString(
    stringField(data.currentBundleRef),
    stringField(metadata.currentBundleRef),
    stringField(runSummary.currentBundleRef),
  );
  const artifactRefs = rightPaneRefList(
    stringListField(data.artifactRefs),
    stringListField(metadata.artifactRefs),
    currentBundleRef,
    stringField(data.displayGroupRef),
    stringField(metadata.displayGroupRef),
    visibleScreenRefs,
    frameRecords.map((frame) => frame.frameDataRef),
    frameRecords.map((frame) => frame.screenshotRef),
    frameRecords.map((frame) => frame.evidenceRef),
  );
  const verificationRefs = rightPaneRefList(
    stringListField(data.verificationRefs),
    stringListField(metadata.verificationRefs),
    validationRef,
    completionEvidenceRef,
    beforeEvidenceRefs,
    afterEvidenceRefs,
    stringField(data.permissionRef),
    stringField(metadata.permissionRef),
    sidecarDiscoveryRef,
  );
  const guiPresentRefs = rightPaneRefList(
    stringField(data.guiPresentRef),
    stringField(metadata.guiPresentRef),
    stringListField(data.guiPresentRefs),
    stringListField(metadata.guiPresentRefs),
  );
  if (
    !currentFrameRef
    && !frameStreamRef
    && !replayRef
    && !targetAppRef
    && !targetWindowRef
    && !sessionRef
    && !blockedRef
    && !errorRef
    && !actorCursorRefs.length
    && !annotationOverlayRefs.length
    && !proposalRefs.length
    && !artifactRefs.length
    && !verificationRefs.length
    && !frameRecords.length
  ) return undefined;
  const status = errorRef
    ? 'error'
    : blockedRef
      ? 'blocked'
      : firstNonEmptyString(stringField(data.status), stringField(metadata.status), stringField(runSummary.status), currentFrameRef ? 'ready' : 'empty');
  const attachState = normalizeVirtualScreenAttachState(firstNonEmptyString(stringField(data.attachState), stringField(metadata.attachState)));
  const isolationFlags = virtualScreenIsolationFlagsFromValue(data.isolationFlags ?? metadata.isolationFlags ?? data.isolation ?? metadata.isolation);
  return {
    title: stringField(data.title) ?? stringField(metadata.title) ?? 'Computer Use Virtual Screen',
    status,
    attachState,
    surfaceMode: deriveVirtualScreenSurfaceMode({
      attachState,
      explicitSurfaceMode: normalizeVirtualScreenSurfaceMode(stringField(data.surfaceMode) ?? stringField(metadata.surfaceMode)),
      sessionRef,
      liveSurfaceRef,
      frameStreamRef,
      currentFrameRef,
      replayRef,
      frameRecords,
      isolationFlags,
    }),
    displayGroupRef: firstNonEmptyString(stringField(data.displayGroupRef), stringField(metadata.displayGroupRef)),
    screenRef: explicitScreenRef,
    liveSurfaceRef,
    surfaceTransport,
    visibleScreenRefs,
    targetAppRef,
    targetWindowRef,
    sessionRef,
    frameStreamRef,
    screen,
    frameRefs: frameRecords,
    currentFrameRef,
    beforeFrameRef: firstNonEmptyString(stringField(data.beforeFrameRef), stringField(metadata.beforeFrameRef)),
    afterFrameRef: firstNonEmptyString(stringField(data.afterFrameRef), stringField(metadata.afterFrameRef)),
    beforeAfterFrameRefs: rightPaneRefList(
      stringListField(data.beforeAfterFrameRefs),
      stringListField(metadata.beforeAfterFrameRefs),
    ),
    actorCursorRefs,
    annotationOverlayRefs,
    annotationProposalRefs: proposalRefs,
    inputIntentRefs,
    executorEventRefs,
    inputLeaseRef: leaseOwnerRefs[0],
    actionAdapterRef,
    adapterReadinessRef,
    replayRef,
    evidenceLedgerRef,
    artifactRefs,
    verificationRefs,
    guiPresentRefs,
    blockedRef,
    errorRef,
    stopRef: firstNonEmptyString(stringField(data.stopRef), stringField(metadata.stopRef)),
    handoffRef: firstNonEmptyString(stringField(data.handoffRef), stringField(metadata.handoffRef)),
    isolationFlags,
  };
}

function runtimeArtifactsFromRunForRightPane(run: SciForgeRun): RuntimeArtifact[] {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const output = isRecord(raw?.output) ? raw.output : undefined;
  const dataOutput = isRecord(data?.output) ? data.output : undefined;
  const roots = [
    raw,
    raw?.payload,
    raw?.toolPayload,
    raw?.structured,
    data,
    data?.payload,
    data?.toolPayload,
    output,
    output?.payload,
    output?.result,
    dataOutput,
    dataOutput?.payload,
    dataOutput?.result,
  ];
  return dedupeRuntimeArtifacts(roots.flatMap((root) => {
    const record = isRecord(root) ? root : undefined;
    return toRecordList(record?.artifacts).map((artifact) => runtimeArtifactFromRecord(artifact, run.scenarioId));
  }).filter((artifact): artifact is RuntimeArtifact => Boolean(artifact)));
}

function runtimeArtifactFromRecord(record: Record<string, unknown>, fallbackScenario: RuntimeArtifact['producerScenario']): RuntimeArtifact | undefined {
  const id = firstNonEmptyString(stringField(record.id), stringField(record.artifactId))?.replace(/^artifact::?/i, '');
  const type = firstNonEmptyString(stringField(record.type), stringField(record.artifactType));
  if (!id || !type) return undefined;
  return {
    id,
    type,
    producerScenario: (stringField(record.producerScenario) ?? fallbackScenario) as RuntimeArtifact['producerScenario'],
    schemaVersion: stringField(record.schemaVersion) ?? 'unknown',
    dataRef: stringField(record.dataRef),
    data: record.data,
    metadata: isRecord(record.metadata) ? record.metadata : undefined,
    delivery: isRecord(record.delivery) ? record.delivery as unknown as RuntimeArtifact['delivery'] : undefined,
  };
}

function dedupeRuntimeArtifacts(artifacts: RuntimeArtifact[]) {
  const byId = new Map<string, RuntimeArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.id || byId.has(artifact.id)) continue;
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
}

function rightPaneRefList(...values: Array<string | undefined | Array<string | undefined>>): string[] {
  const refs: string[] = [];
  for (const value of values) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (typeof entry !== 'string') continue;
      const ref = entry.trim();
      if (ref) refs.push(ref);
    }
  }
  return Array.from(new Set(refs));
}

function refsFromList(value: unknown, keys: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!isRecord(entry)) return [];
    const ref = refFromValue(entry, keys);
    return ref ? [ref] : [];
  });
}

function refFromValue(value: unknown, keys: string[]) {
  if (typeof value === 'string') return stringField(value);
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const ref = stringField(value[key]);
    if (ref) return ref;
  }
  return undefined;
}

function normalizeVirtualScreenAttachState(value: string | undefined): VirtualScreenPayload['attachState'] {
  const normalized = value?.replace('requires-user-handoff', 'requires-handoff');
  if (
    normalized === 'attached'
    || normalized === 'replay'
    || normalized === 'no-session'
    || normalized === 'adapter-unavailable'
    || normalized === 'observe-only'
    || normalized === 'blocked'
    || normalized === 'requires-handoff'
    || normalized === 'error'
  ) return normalized;
  return undefined;
}

function normalizeVirtualScreenSurfaceMode(value: string | undefined): VirtualScreenPayload['surfaceMode'] {
  if (value === 'live' || value === 'replay' || value === 'empty') return value;
  return undefined;
}

function normalizeVirtualScreenSurfaceTransport(value: string | undefined): VirtualScreenPayload['surfaceTransport'] {
  if (
    value === 'webrtc'
    || value === 'native-frame-stream'
  ) return value;
  return undefined;
}

function deriveVirtualScreenSurfaceMode(options: {
  attachState: VirtualScreenPayload['attachState'];
  explicitSurfaceMode: VirtualScreenPayload['surfaceMode'];
  sessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  replayRef: string;
  frameRecords: VirtualScreenFrame[];
  isolationFlags: VirtualScreenPayload['isolationFlags'];
}): VirtualScreenPayload['surfaceMode'] {
  const canRepresentLive = Boolean(
    (options.attachState === 'attached' || options.attachState === 'observe-only')
    && options.sessionRef
    && (options.liveSurfaceRef || options.frameStreamRef)
    && options.isolationFlags?.singleInteractiveTruth !== false
    && options.isolationFlags?.secondInteractiveSurfacePresent !== true,
  );
  if (canRepresentLive) return 'live';
  if (options.explicitSurfaceMode === 'empty' && !options.currentFrameRef && !options.replayRef && !options.frameStreamRef && !options.liveSurfaceRef && !options.frameRecords.length) return 'empty';
  if (options.explicitSurfaceMode === 'replay') return 'replay';
  return options.currentFrameRef || options.replayRef || options.frameStreamRef || options.liveSurfaceRef || options.frameRecords.length ? 'replay' : 'empty';
}

function virtualScreenIsolationFlagsFromValue(value: unknown): VirtualScreenPayload['isolationFlags'] {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries({
    affectsPhysicalDisplay: booleanField(value.affectsPhysicalDisplay),
    requiresFocusSteal: booleanField(value.requiresFocusSteal),
    sharedSystemInputUsed: booleanField(value.sharedSystemInputUsed),
    systemPointerMoved: booleanField(value.systemPointerMoved),
    systemKeyboardEventsSent: booleanField(value.systemKeyboardEventsSent),
    backgroundRenderable: booleanField(value.backgroundRenderable),
    singleInteractiveTruth: booleanField(value.singleInteractiveTruth),
    secondInteractiveSurfacePresent: booleanField(value.secondInteractiveSurfacePresent),
    diagnosticOnly: booleanField(value.diagnosticOnly),
  }).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) as VirtualScreenPayload['isolationFlags'] : undefined;
}

function virtualScreenFrameRecords(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  config: SciForgeConfig,
): VirtualScreenFrame[] {
  const frames = [
    ...frameRecordsFromValue(data.frames, config),
    ...frameRecordsFromValue(data.frameRefs, config),
    ...frameRecordsFromValue(metadata.frames, config),
    ...frameRecordsFromValue(metadata.frameRefs, config),
  ];
  const topLevelFrame = frameRecordFromValue({
    ref: stringField(data.frameRef) ?? stringField(metadata.frameRef),
    frameRef: stringField(data.frameRef) ?? stringField(metadata.frameRef),
    frameUrl: stringField(data.frameUrl) ?? stringField(metadata.frameUrl),
    frameDataRef: stringField(data.frameDataRef) ?? stringField(metadata.frameDataRef),
    screenshotRef: stringField(data.screenshotRef) ?? stringField(metadata.screenshotRef),
    screenRef: stringField(data.screenRef) ?? stringField(metadata.screenRef),
    label: stringField(data.frameLabel) ?? stringField(metadata.frameLabel),
    status: stringField(data.frameStatus) ?? stringField(metadata.frameStatus),
    framePreviewUrl: stringField(data.framePreviewUrl) ?? stringField(metadata.framePreviewUrl),
    thumbnailPreviewUrl: stringField(data.thumbnailPreviewUrl) ?? stringField(metadata.thumbnailPreviewUrl),
    safePreviewUrl: stringField(data.safePreviewUrl) ?? stringField(metadata.safePreviewUrl),
    previewUrl: stringField(data.previewUrl) ?? stringField(metadata.previewUrl),
    thumbnailUrl: stringField(data.thumbnailUrl) ?? stringField(metadata.thumbnailUrl),
    beforeEvidenceRef: stringField(data.beforeEvidenceRef) ?? stringListField(data.beforeEvidenceRefs)[0],
    afterEvidenceRef: stringField(data.afterEvidenceRef) ?? stringListField(data.afterEvidenceRefs)[0],
    evidenceRef: stringField(data.evidenceRef),
    cursorOverlayRefs: stringListField(data.cursorOverlayRefs),
    leaseOwnerRefs: stringListField(data.leaseOwnerRefs),
    proposalRef: stringField(data.proposalRef) ?? stringField(data.actionProposalRef),
    blockedReason: stringField(data.blockedReason),
    errorReason: stringField(data.errorReason),
  }, config);
  if (topLevelFrame) frames.unshift(topLevelFrame);
  const byRef = new Map<string, VirtualScreenFrame>();
  for (const frame of frames) {
    const previous = byRef.get(frame.ref);
    byRef.set(frame.ref, previous ? mergeVirtualScreenFrame(previous, frame) : frame);
  }
  return Array.from(byRef.values());
}

function frameRecordsFromValue(value: unknown, config: SciForgeConfig): VirtualScreenFrame[] {
  if (!Array.isArray(value)) return [];
  return value.map((frame) => frameRecordFromValue(frame, config)).filter((frame): frame is VirtualScreenFrame => Boolean(frame));
}

function frameRecordFromValue(value: unknown, config: SciForgeConfig): VirtualScreenFrame | undefined {
  if (typeof value === 'string') {
    const ref = stringField(value);
    return ref ? { ref, framePreviewUrl: rightPaneVirtualScreenFramePreviewUrl(ref, config) } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const ref = firstNonEmptyString(
    stringField(value.ref),
    stringField(value.frameRef),
    stringField(value.screenshotRef),
    stringField(value.frameDataRef),
  );
  if (!ref) return undefined;
  const previewUrl = safeFramePreviewUrl(value.framePreviewUrl)
    ?? safeFramePreviewUrl(value.safePreviewUrl)
    ?? safeFramePreviewUrl(value.previewUrl)
    ?? safeFramePreviewUrl(value.rawUrl)
    ?? safeFramePreviewUrl(value.frameUrl)
    ?? rightPaneVirtualScreenFramePreviewUrl(ref, config);
  return {
    ref,
    screenRef: stringField(value.screenRef),
    label: stringField(value.label),
    status: stringField(value.status),
    frameUrl: safeFramePreviewUrl(value.frameUrl),
    frameDataRef: stringField(value.frameDataRef),
    screenshotRef: stringField(value.screenshotRef),
    framePreviewUrl: previewUrl,
    thumbnailPreviewUrl: safeFramePreviewUrl(value.thumbnailPreviewUrl),
    safePreviewUrl: safeFramePreviewUrl(value.safePreviewUrl),
    previewUrl: safeFramePreviewUrl(value.previewUrl),
    thumbnailUrl: safeFramePreviewUrl(value.thumbnailUrl),
    rawUrl: safeFramePreviewUrl(value.rawUrl),
    beforeEvidenceRef: stringField(value.beforeEvidenceRef) ?? stringListField(value.beforeEvidenceRefs)[0],
    afterEvidenceRef: stringField(value.afterEvidenceRef) ?? stringListField(value.afterEvidenceRefs)[0],
    evidenceRef: stringField(value.evidenceRef),
    cursorOverlayRefs: stringListField(value.cursorOverlayRefs),
    leaseOwnerRefs: stringListField(value.leaseOwnerRefs),
    proposalRef: stringField(value.proposalRef) ?? stringField(value.actionProposalRef),
    blockedReason: stringField(value.blockedReason),
    errorReason: stringField(value.errorReason),
  };
}

function mergeVirtualScreenFrame(left: VirtualScreenFrame, right: VirtualScreenFrame): VirtualScreenFrame {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[key] = value;
  }
  return merged as unknown as VirtualScreenFrame;
}

function virtualScreenInfo(data: Record<string, unknown>, metadata: Record<string, unknown>): VirtualScreenPayload['screen'] {
  const dataScreen = isRecord(data.screen) ? data.screen : {};
  const metadataScreen = isRecord(metadata.screen) ? metadata.screen : {};
  const width = positiveNumberField(dataScreen.width)
    ?? positiveNumberField(metadataScreen.width)
    ?? positiveNumberField(data.screenWidth)
    ?? positiveNumberField(metadata.screenWidth)
    ?? positiveNumberField(data.width)
    ?? positiveNumberField(metadata.width);
  const height = positiveNumberField(dataScreen.height)
    ?? positiveNumberField(metadataScreen.height)
    ?? positiveNumberField(data.screenHeight)
    ?? positiveNumberField(metadata.screenHeight)
    ?? positiveNumberField(data.height)
    ?? positiveNumberField(metadata.height);
  const label = firstNonEmptyString(
    stringField(dataScreen.label),
    stringField(metadataScreen.label),
    stringField(data.screenLabel),
    stringField(metadata.screenLabel),
  );
  return width || height || label ? { width, height, label } : undefined;
}

function rightPaneVirtualScreenFramePreviewUrl(ref: string, config: SciForgeConfig) {
  if (!isPreviewableFrameRef(ref)) return undefined;
  const params = new URLSearchParams({ ref });
  const workspacePath = normalizeWorkspaceRootPath(config.workspacePath);
  if (workspacePath) params.set('workspacePath', workspacePath);
  return `/api/sciforge/preview/raw?${params.toString()}`;
}

function isPreviewableFrameRef(ref: string) {
  const value = ref.trim();
  if (!/\.(?:png|jpe?g|webp|gif)$/i.test(value)) return false;
  if (/^(?:data:|blob:|file:|javascript:)/i.test(value) || /base64/i.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('~')) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function safeFramePreviewUrl(value: unknown) {
  const url = stringField(value);
  if (!url || /^(?:data:|blob:|file:|javascript:)/i.test(url) || /base64/i.test(url)) return undefined;
  return url.startsWith('/api/sciforge/preview/') && !url.startsWith('//') ? url : undefined;
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringListField(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function positiveNumberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
