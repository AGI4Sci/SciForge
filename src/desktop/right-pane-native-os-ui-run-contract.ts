export const RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA = 'sciforge.browser.right-pane-native-os-ui-run.v1' as const;
export const RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL' as const;

export type RightPaneNativeOsUiRunStatus = 'blocked' | 'passed';
export type RightPaneNativeOsUiRunSource = 'blocked-skeleton-no-os-observer' | 'contract-fixture' | 'real-product-os-ui-run';
export type RightPaneNativeOsUiRunBlocker =
  | 'missing-os-observer'
  | 'missing-native-attach'
  | 'missing-browser-host-action-channel'
  | 'native-os-ui-proof-incomplete';

export type RightPaneNativeOsUiObserver =
  | {
      status: 'missing';
      blocker: 'missing-os-observer';
      requiredObserver: 'platform-os-ui-observer';
    }
  | {
      status: 'available';
      observerRef: string;
      observerKind: 'macos-accessibility' | 'windows-ui-automation' | 'linux-at-spi' | 'platform-os-ui-observer';
    };

export type RightPaneNativeOsUiProofGroup = {
  status: RightPaneNativeOsUiRunStatus;
  proofRefs: string[];
  auditRefs: string[];
};

export type RightPaneNativeOsUiProofGroups = {
  cursorCaret: RightPaneNativeOsUiProofGroup;
  mouseContextMenu: RightPaneNativeOsUiProofGroup;
  keyboardImeClipboardSelection: RightPaneNativeOsUiProofGroup;
  rerenderFocus: RightPaneNativeOsUiProofGroup;
};

export type RightPaneNativeOsUiPartialProofLedgerEntry = {
  status: 'partial' | 'not-observed';
  observerKind: 'macos-accessibility' | 'windows-ui-automation' | 'linux-at-spi' | 'platform-os-ui-observer';
  proofCandidateCount: number;
  observedProofNames: string[];
  evidenceTokenRef: string;
  latencyMs?: number;
};

export type RightPaneNativeOsUiPartialProofLedger = Record<keyof RightPaneNativeOsUiProofGroups, RightPaneNativeOsUiPartialProofLedgerEntry>;

export type RightPaneNativeOsUiActionLedgerEntry = {
  status: 'planned' | 'partial' | 'blocked' | 'passed';
  proofGroup: keyof RightPaneNativeOsUiProofGroups;
  actionId: string;
  actionRef: string;
  targetSurfaceRef: string;
  productSurface: 'right-pane-browser';
  owner: 'BrowserHostSession';
  inputChannel: 'browser-host-session';
  expectedProofNames: string[];
  observedProofNames: string[];
  evidenceTokenRef: string;
  rawPayloadRecorded: false;
  latencyMs?: number;
};

export type RightPaneNativeOsUiActionLedger = {
  entries: RightPaneNativeOsUiActionLedgerEntry[];
};

export const RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES = {
  cursorCaret: [
    'input-caret-visible',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
    'focus-blur-restore',
  ],
  mouseContextMenu: [
    'left-click-owner',
    'right-click-context-menu-owner',
    'middle-click-owner',
    'double-click-owner',
    'mouse-down-up-owner',
    'continuous-move-owner',
    'drag-drop-owner',
    'text-selection-range-owner',
    'wheel-vertical-owner',
    'wheel-horizontal-owner',
    'scrollbar-thumb-owner',
  ],
  keyboardImeClipboardSelection: [
    'keyboard-backspace-delete-owner',
    'keyboard-enter-owner',
    'keyboard-tab-owner',
    'keyboard-arrow-home-end-page-owner',
    'keyboard-shortcuts-select-copy-paste-cut-owner',
    'keyboard-escape-owner',
    'ime-candidate-window-owner',
    'system-clipboard-round-trip-owner',
    'selection-range-owner',
  ],
  rerenderFocus: [
    'native-surface-not-detached',
    'address-bar-rerender-stable',
    'tab-state-rerender-stable',
    'diagnostic-expand-stable',
    'focus-retained-after-rerender',
    'tab-switch-resize-minimize-restore',
  ],
} as const satisfies Record<keyof RightPaneNativeOsUiProofGroups, readonly string[]>;

export const RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS = {
  cursorCaret: 'focus-input-caret',
  mouseContextMenu: 'verify-mouse-context-menu',
  keyboardImeClipboardSelection: 'verify-ime-clipboard-selection',
  rerenderFocus: 'verify-rerender-focus',
} as const satisfies Record<keyof RightPaneNativeOsUiProofGroups, string>;

export type RightPaneNativeOsUiCapturePolicy = {
  screenshotUsedAsProof: false;
  frameStreamUsedAsProof: false;
  rawDomUsedAsProof: false;
  rawClipboardPayloadUsedAsProof: false;
  rawSelectionTextRecorded: false;
  rawImePayloadRecorded: false;
  rawContextMenuPayloadRecorded: false;
};

export type RightPaneNativeOsUiForbiddenSubstitutes = {
  screenshot: false;
  frameStream: false;
  rawDom: false;
  rawClipboardPayload: false;
  systemPopup: false;
  secondBrowserOwner: false;
};

export type RightPaneNativeOsUiRunRefBundle = {
  runRef: string;
  auditRefs: string[];
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  productSurface: 'right-pane-browser';
  owner: 'BrowserHostSession';
};

export type RightPaneNativeOsUiBrowserHostActionChannel =
  | {
      status: 'missing';
      blocker: 'missing-browser-host-action-channel';
      requiredEnv: typeof RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV;
    }
  | {
      status: 'available';
      channelRef: string;
      browserHostSessionRef: string;
      liveSurfaceRef: string;
      productSurface: 'right-pane-browser';
      owner: 'BrowserHostSession';
      inputChannel: 'browser-host-session';
      rawEndpointRecorded: false;
      loopbackOnly: true;
    };

export type RightPaneNativeOsUiRunManifest = {
  schemaVersion: typeof RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA;
  status: RightPaneNativeOsUiRunStatus;
  passClaim: boolean;
  runner: 'right-pane-native-os-ui-run';
  source: RightPaneNativeOsUiRunSource;
  productSurface: 'right-pane-browser';
  owner: 'BrowserHostSession';
  inputChannel: 'browser-host-session';
  liveSurfaceTransport: 'native-embedded' | 'missing-native-attach';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  observedAt: string;
  refsFirst: true;
  boundedEvidenceOnly: true;
  osObserver: RightPaneNativeOsUiObserver;
  browserHostActionChannel: RightPaneNativeOsUiBrowserHostActionChannel;
  proofGroups: RightPaneNativeOsUiProofGroups;
  capturePolicy: RightPaneNativeOsUiCapturePolicy;
  forbiddenSubstitutes: RightPaneNativeOsUiForbiddenSubstitutes;
  blocker?: RightPaneNativeOsUiRunBlocker;
  osUiRun?: RightPaneNativeOsUiRunRefBundle;
  partialProofLedger?: RightPaneNativeOsUiPartialProofLedger;
  actionLedger?: RightPaneNativeOsUiActionLedger;
};

export type RightPaneNativeOsUiRunValidation = {
  schemaVersion: typeof RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA;
  canClaimPass: boolean;
  verdict: RightPaneNativeOsUiRunStatus;
  blockReasons: string[];
};

export type BuildBlockedRightPaneNativeOsUiRunSkeletonInput = {
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  observedAt: string;
};

export function buildBlockedRightPaneNativeOsUiRunSkeleton(
  input: BuildBlockedRightPaneNativeOsUiRunSkeletonInput,
): RightPaneNativeOsUiRunManifest {
  return {
    schemaVersion: RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
    status: 'blocked',
    passClaim: false,
    runner: 'right-pane-native-os-ui-run',
    source: 'blocked-skeleton-no-os-observer',
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: input.browserHostSessionRef,
    liveSurfaceRef: input.liveSurfaceRef,
    observedAt: input.observedAt,
    refsFirst: true,
    boundedEvidenceOnly: true,
    blocker: 'missing-os-observer',
    osObserver: {
      status: 'missing',
      blocker: 'missing-os-observer',
      requiredObserver: 'platform-os-ui-observer',
    },
    browserHostActionChannel: missingBrowserHostActionChannel(),
    proofGroups: {
      cursorCaret: blockedProofGroup(input.browserHostSessionRef, 'cursor-caret'),
      mouseContextMenu: blockedProofGroup(input.browserHostSessionRef, 'mouse-context-menu'),
      keyboardImeClipboardSelection: blockedProofGroup(input.browserHostSessionRef, 'keyboard-ime-clipboard-selection'),
      rerenderFocus: blockedProofGroup(input.browserHostSessionRef, 'rerender-focus'),
    },
    capturePolicy: noSubstituteCapturePolicy(),
    forbiddenSubstitutes: noForbiddenSubstitutes(),
  };
}

export function validateRightPaneNativeOsUiRunManifest(
  manifest: RightPaneNativeOsUiRunManifest,
): RightPaneNativeOsUiRunValidation {
  const blockReasons: string[] = [];

  if (manifest.schemaVersion !== RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA) {
    blockReasons.push('schema-version-mismatch');
  }
  if (manifest.status !== 'passed' || manifest.passClaim !== true) {
    blockReasons.push('manifest-status-pass-claim-required');
  }
  if (manifest.status === 'blocked' && manifest.passClaim === true) {
    blockReasons.push('blocked-manifest-must-not-claim-pass');
  }
  if (manifest.runner !== 'right-pane-native-os-ui-run') {
    blockReasons.push('right-pane-native-os-ui-runner-required');
  }
  if (manifest.source !== 'real-product-os-ui-run') {
    blockReasons.push('real-product-os-ui-run-source-required');
  }
  if (manifest.productSurface !== 'right-pane-browser') {
    blockReasons.push('right-pane-browser-surface-required');
  }
  if (manifest.owner !== 'BrowserHostSession' || manifest.inputChannel !== 'browser-host-session') {
    blockReasons.push('browser-host-session-owner-input-channel-required');
  }
  if (manifest.liveSurfaceTransport !== 'native-embedded') {
    blockReasons.push('native-embedded-live-surface-required');
  }
  if (!manifest.refsFirst || !manifest.boundedEvidenceOnly) {
    blockReasons.push('refs-first-bounded-evidence-required');
  }
  if (manifest.osObserver.status !== 'available') {
    blockReasons.push('available-os-observer-required');
  } else if (!hasRealProductRunRef(manifest.osObserver.observerRef)) {
    blockReasons.push('real-product-os-ui-observer-ref-required');
  }
  if (!hasRealProductRunRef(manifest.osUiRun?.runRef)) {
    blockReasons.push('real-product-os-ui-run-ref-required');
  }
  if (!hasRealProductAuditRefs(manifest.osUiRun?.auditRefs)) {
    blockReasons.push('real-product-os-ui-audit-ref-required');
  }
  if (!hasRunRefCohesion(manifest)) {
    blockReasons.push('real-product-os-ui-run-ref-cohesion-required');
  }
  if (!hasBrowserHostActionChannel(manifest)) {
    blockReasons.push('browser-host-action-channel-required');
  }
  if (!hasRealProductOsUiRunScopeCohesion(manifest)) {
    blockReasons.push('real-product-os-ui-run-scope-cohesion-required');
  }
  if (!allProofGroupsPassed(manifest.proofGroups)) {
    blockReasons.push('all-proof-groups-must-pass');
  }
  if (!allProofGroupsHaveRequiredM1ProofRefs(manifest.proofGroups)) {
    blockReasons.push('complete-m1-native-os-ui-proof-refs-required');
  }
  if (!allProofGroupsHaveAuditRefs(manifest.proofGroups)) {
    blockReasons.push('proof-group-audit-refs-required');
  }
  if (usesForbiddenCapturePolicy(manifest.capturePolicy) || usesForbiddenSubstitutes(manifest.forbiddenSubstitutes)) {
    blockReasons.push('screenshot-frame-stream-raw-dom-clipboard-cannot-substitute-os-ui-proof');
  }
  if (hasForbiddenProofRefs(manifest.proofGroups)) {
    blockReasons.push('proof-refs-must-not-use-forbidden-substitutes');
  }
  if (hasMetadataProbeRefs(manifest)) {
    blockReasons.push('real-product-os-ui-run-proof-not-metadata-probe');
  }
  if (requiresPassGradeActionLedger(manifest) && !hasPassGradeActionLedger(manifest)) {
    blockReasons.push('pass-grade-action-ledger-required');
  }

  const uniqueBlockReasons = [...new Set(blockReasons)];
  return {
    schemaVersion: RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
    canClaimPass: uniqueBlockReasons.length === 0,
    verdict: uniqueBlockReasons.length === 0 ? 'passed' : 'blocked',
    blockReasons: uniqueBlockReasons,
  };
}

function blockedProofGroup(browserHostSessionRef: string, area: string): RightPaneNativeOsUiProofGroup {
  return {
    status: 'blocked',
    proofRefs: [`${browserHostSessionRef}/right-pane-native-os-ui-run/${area}/required-proof-ref`],
    auditRefs: [],
  };
}

function noSubstituteCapturePolicy(): RightPaneNativeOsUiCapturePolicy {
  return {
    screenshotUsedAsProof: false,
    frameStreamUsedAsProof: false,
    rawDomUsedAsProof: false,
    rawClipboardPayloadUsedAsProof: false,
    rawSelectionTextRecorded: false,
    rawImePayloadRecorded: false,
    rawContextMenuPayloadRecorded: false,
  };
}

function noForbiddenSubstitutes(): RightPaneNativeOsUiForbiddenSubstitutes {
  return {
    screenshot: false,
    frameStream: false,
    rawDom: false,
    rawClipboardPayload: false,
    systemPopup: false,
    secondBrowserOwner: false,
  };
}

export function missingBrowserHostActionChannel(): RightPaneNativeOsUiBrowserHostActionChannel {
  return {
    status: 'missing',
    blocker: 'missing-browser-host-action-channel',
    requiredEnv: RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  };
}

function hasRealProductRunRef(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith('real-product-os-ui-run:');
}

function hasRealProductAuditRefs(refs: string[] | undefined): boolean {
  return Array.isArray(refs) && refs.length > 0 && refs.every((ref) => ref.startsWith('real-product-os-ui-audit:'));
}

function hasBrowserHostActionChannel(manifest: RightPaneNativeOsUiRunManifest): boolean {
  const channel = manifest.browserHostActionChannel;
  return Boolean(
    channel &&
      channel.status === 'available' &&
      channel.browserHostSessionRef === manifest.browserHostSessionRef &&
      channel.liveSurfaceRef === manifest.liveSurfaceRef &&
      channel.productSurface === manifest.productSurface &&
      channel.owner === manifest.owner &&
      channel.inputChannel === manifest.inputChannel &&
      channel.rawEndpointRecorded === false &&
      channel.loopbackOnly === true &&
      channel.channelRef.startsWith(`${manifest.browserHostSessionRef}/right-pane-native-os-ui-run/action-channel/hash-`),
  );
}

function hasRunRefCohesion(manifest: RightPaneNativeOsUiRunManifest): boolean {
  const run = manifest.osUiRun;
  return Boolean(
    run &&
      run.browserHostSessionRef === manifest.browserHostSessionRef &&
      run.liveSurfaceRef === manifest.liveSurfaceRef &&
      run.productSurface === manifest.productSurface &&
      run.owner === manifest.owner,
  );
}

function hasRealProductOsUiRunScopeCohionRef(ref: string, runId: string): boolean {
  const scopedRunId = realProductScopeId(ref);
  return !scopedRunId || scopedRunId === runId;
}

function hasRealProductOsUiRunScopeCohesion(manifest: RightPaneNativeOsUiRunManifest): boolean {
  const runId = realProductScopeId(manifest.osUiRun?.runRef);
  if (!runId) return true;
  const scopedRefs = [
    manifest.osObserver.status === 'available' ? manifest.osObserver.observerRef : undefined,
    manifest.osUiRun?.runRef,
    ...(manifest.osUiRun?.auditRefs ?? []),
    ...Object.values(manifest.proofGroups).flatMap((group) => [...group.proofRefs, ...group.auditRefs]),
    ...(manifest.actionLedger?.entries ?? []).map((entry) => entry.actionRef),
  ].filter((ref): ref is string => typeof ref === 'string');
  return scopedRefs.every((ref) => hasRealProductOsUiRunScopeCohionRef(ref, runId));
}

function realProductScopeId(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const prefixes = [
    'real-product-os-ui-run:',
    'real-product-os-ui-audit:',
    'real-product-os-ui-action:',
  ];
  const prefix = prefixes.find((candidate) => ref.startsWith(candidate));
  if (!prefix) return undefined;
  const rest = ref.slice(prefix.length);
  const slashIndex = rest.indexOf('/');
  const runId = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  return runId.length > 0 ? runId : undefined;
}

function requiresPassGradeActionLedger(manifest: RightPaneNativeOsUiRunManifest): boolean {
  return manifest.status === 'passed'
    || manifest.passClaim === true
    || manifest.source === 'real-product-os-ui-run';
}

function hasPassGradeActionLedger(manifest: RightPaneNativeOsUiRunManifest): boolean {
  const entries = manifest.actionLedger?.entries;
  const runId = realProductScopeId(manifest.osUiRun?.runRef);
  if (!runId || !Array.isArray(entries) || entries.length === 0) return false;
  if (!entries.every((entry) => isPassGradeActionLedgerEntry(entry, manifest, runId))) return false;

  return (Object.entries(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES) as Array<[
    keyof RightPaneNativeOsUiProofGroups,
    readonly string[],
  ]>).every(([groupName, requiredNames]) => {
    const groupEntries = entries.filter((entry) => entry.proofGroup === groupName);
    if (!groupEntries.some((entry) => entry.status === 'passed')) return false;
    const expected = new Set(groupEntries.flatMap((entry) => entry.expectedProofNames));
    const observed = new Set(groupEntries.flatMap((entry) => entry.observedProofNames));
    return requiredNames.every((name) => expected.has(name) && observed.has(name));
  });
}

function isPassGradeActionLedgerEntry(
  entry: RightPaneNativeOsUiActionLedgerEntry,
  manifest: RightPaneNativeOsUiRunManifest,
  runId: string,
): boolean {
  const area = proofGroupArea(entry.proofGroup);
  const actionId = RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS[entry.proofGroup];
  const requiredNames = new Set(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES[entry.proofGroup]);
  return entry.status === 'passed'
    && entry.actionId === actionId
    && entry.actionRef === `real-product-os-ui-action:${runId}/${area}/${actionId}`
    && entry.targetSurfaceRef === manifest.liveSurfaceRef
    && entry.productSurface === 'right-pane-browser'
    && entry.owner === 'BrowserHostSession'
    && entry.inputChannel === 'browser-host-session'
    && entry.rawPayloadRecorded === false
    && hasBoundedProofNameSet(entry.expectedProofNames, requiredNames)
    && hasBoundedProofNameSet(entry.observedProofNames, requiredNames)
    && hasBoundedEvidenceTokenRef(entry.evidenceTokenRef);
}

function hasBoundedProofNameSet(values: string[], requiredNames: Set<string>): boolean {
  return Array.isArray(values)
    && values.length > 0
    && values.every((value) => requiredNames.has(value));
}

function hasBoundedEvidenceTokenRef(value: string): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !/(?:data:image|base64|<\s*(?:html|body|iframe|webview)\b|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:)/i.test(value);
}

function allProofGroupsPassed(proofGroups: RightPaneNativeOsUiProofGroups): boolean {
  return Object.values(proofGroups).every((group) => group.status === 'passed' && group.proofRefs.length > 0);
}

function allProofGroupsHaveAuditRefs(proofGroups: RightPaneNativeOsUiProofGroups): boolean {
  return Object.values(proofGroups).every(
    (group) => group.auditRefs.length > 0 && group.auditRefs.every((ref) => ref.startsWith('real-product-os-ui-audit:')),
  );
}

function allProofGroupsHaveRequiredM1ProofRefs(proofGroups: RightPaneNativeOsUiProofGroups): boolean {
  return (Object.entries(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES) as Array<[
    keyof RightPaneNativeOsUiProofGroups,
    readonly string[],
  ]>).every(([groupName, requiredNames]) => {
    const area = proofGroupArea(groupName);
    const proofNames = new Set(proofGroups[groupName].proofRefs.map((ref) => proofNameFromRealProductRef(ref, area, 'run')).filter(Boolean));
    const auditNames = new Set(proofGroups[groupName].auditRefs.map((ref) => proofNameFromRealProductRef(ref, area, 'audit')).filter(Boolean));
    return requiredNames.every((name) => proofNames.has(name) && auditNames.has(name));
  });
}

function proofGroupArea(groupName: keyof RightPaneNativeOsUiProofGroups): string {
  if (groupName === 'cursorCaret') return 'cursor-caret';
  if (groupName === 'mouseContextMenu') return 'mouse-context-menu';
  if (groupName === 'keyboardImeClipboardSelection') return 'keyboard-ime-clipboard-selection';
  return 'rerender-focus';
}

function proofNameFromRealProductRef(ref: string, area: string, kind: 'run' | 'audit'): string | undefined {
  const prefix = kind === 'run' ? 'real-product-os-ui-run:' : 'real-product-os-ui-audit:';
  if (!ref.startsWith(prefix)) return undefined;
  const parts = ref.slice(prefix.length).split('/');
  if (parts.length < 3) return undefined;
  const refArea = parts[parts.length - 2];
  const proofName = parts[parts.length - 1];
  if (refArea !== area || !proofName) return undefined;
  return proofName;
}

function usesForbiddenCapturePolicy(policy: RightPaneNativeOsUiCapturePolicy): boolean {
  return Object.values(policy).some((value) => value !== false);
}

function usesForbiddenSubstitutes(substitutes: RightPaneNativeOsUiForbiddenSubstitutes): boolean {
  return Object.values(substitutes).some((value) => value !== false);
}

function hasForbiddenProofRefs(proofGroups: RightPaneNativeOsUiProofGroups): boolean {
  const forbiddenPrefixes = [
    'screenshot:',
    'frame-stream:',
    'raw-dom:',
    'raw-clipboard:',
    'clipboard-payload:',
    'dom:',
  ];
  return Object.values(proofGroups).some((group) =>
    group.proofRefs.some((ref) => forbiddenPrefixes.some((prefix) => ref.startsWith(prefix))),
  );
}

function hasMetadataProbeRefs(manifest: RightPaneNativeOsUiRunManifest): boolean {
  const refs = [
    manifest.osObserver.status === 'available' ? manifest.osObserver.observerRef : undefined,
    manifest.osUiRun?.runRef,
    ...(manifest.osUiRun?.auditRefs ?? []),
    ...Object.values(manifest.proofGroups).flatMap((group) => [...group.proofRefs, ...group.auditRefs]),
  ];
  return refs.some((ref) => typeof ref === 'string' && ref.includes('/metadata-probe'));
}
