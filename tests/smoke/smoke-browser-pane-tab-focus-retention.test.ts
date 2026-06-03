import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const DOGFOOD_SCHEMA = 'sciforge.browser-pane-tab-focus-retention.v1';
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-tab-focus-retention');
const manifestPath = join(artifactDir, 'manifest.json');
const desktopNativeLiveManifestPath = resolve(process.cwd(), 'docs', 'test-artifacts', 'desktop-browser-native-live-acceptance', 'manifest.json');
const verificationCommand = 'node --import tsx --test tests/smoke/smoke-browser-pane-tab-focus-retention.test.ts';
const requiredLifecyclePhases = [
  'before-tab-switch',
  'after-tab-return',
  'after-native-detach',
  'after-native-reattach',
  'after-resize',
  'after-minimize',
  'after-restore',
] as const;

type LifecyclePhase = typeof requiredLifecyclePhases[number];

type NativeAttachProof = {
  state: 'attached' | 'blocked' | 'handoff';
  observed: 'native-embedded' | 'missing-native-attach';
  proofMode: 'real-native-attach' | 'missing-native-attach';
  browserHostSessionRef?: string;
  liveSurfaceRef?: string;
  nativeSurfaceAttachRef?: string;
  nativeSurfaceStateRef?: string;
  canRetry: boolean;
  handoffRequired: boolean;
  blockedReasonCode?: 'missing-native-attach' | 'native-attach-proof-required';
  blockedReason?: string;
  rawPayloadRecorded: false;
};

type FocusKeyboardProof = {
  productSurface: 'right-pane-browser';
  owner: string;
  focusOwner: string;
  keyboardOwner: string;
  inputChannel: string;
  shellComposerTarget: 'not-targeted' | 'shell-composer' | 'unproven';
  shellComposerCapturedCharacters: number;
  browserHostSessionRef?: string;
  liveSurfaceRef?: string;
  focusOwnerRef?: string;
  keyboardOwnerRef?: string;
  composerAuditRef?: string;
  actionTraceRef?: string;
  rawFocusPayloadRecorded: false;
  rawKeyboardPayloadRecorded: false;
};

type LifecyclePhaseProof = {
  phase: LifecyclePhase;
  browserHostSessionRef?: string;
  liveSurfaceRef?: string;
  proofRef?: string;
  keyboardFocusOwnerRef?: string;
  rawPayloadRecorded: false;
};

type LifecycleProof = {
  requiredPhases: LifecyclePhase[];
  observedPhases: LifecyclePhase[];
  sameBrowserHostSessionRef: boolean;
  sameLiveSurfaceRef: boolean;
  lifecycleTraceRef?: string;
  phaseProofs: LifecyclePhaseProof[];
  boundedCounts: {
    tabSwitchCount: number;
    nativeDetachCount: number;
    nativeAttachCount: number;
    resizeCount: number;
    minimizeCount: number;
    restoreCount: number;
    keyboardFocusLossCount: number | null;
    shellComposerCapturedCharacters: number;
  };
  rawPayloadRecorded: false;
};

type ConsumedNativeDesktopEvidence = {
  sourceRef: 'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json';
  schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1';
  status: 'passed';
  claimScope: 'desktop-native-embedded-browser-pane-live';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  nativeAttachRef: string;
  nativeSurfaceStateRef: string;
  lifecycleResultRef?: string;
  inputCompletenessResultRef?: string;
  verificationCommand?: string;
  rawPayloadRecorded: false;
};

type TabFocusRetentionManifest = {
  schemaVersion: typeof DOGFOOD_SCHEMA;
  status: 'passed' | 'blocked';
  claimScope: 'right-pane-native-focus-retention' | 'diagnostic-only';
  passClaim: boolean;
  runId: string;
  observedAt: string;
  refsFirst: true;
  required: {
    owner: 'BrowserHostSession';
    liveSurfaceTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
    inputChannel: 'browser-host-session';
    sameSessionId: true;
    sameLiveSurfaceRef: true;
    nativeAttachProofMode: 'real-native-attach';
    focusKeyboardOwnerProofRefs: true;
    lifecycleCoverage: {
      multiTab: true;
      nativeDetach: true;
      nativeReattach: true;
      resize: true;
      minimize: true;
      restore: true;
    };
  };
  observed: {
    owner: string;
    liveSurfaceTransport: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    inputChannel: string;
    sameSessionId: boolean;
    sameLiveSurfaceRef: boolean;
    beforeSessionRef?: string;
    afterSessionRef?: string;
    beforeLiveSurfaceRef?: string;
    afterLiveSurfaceRef?: string;
    shellComposerCapturedCharacters: number;
    blockedReason?: string;
  };
  consumedNativeDesktopEvidence?: ConsumedNativeDesktopEvidence;
  coverageGaps: string[];
  nativeAttach: NativeAttachProof;
  focusKeyboardProof: FocusKeyboardProof;
  lifecycleProof: LifecycleProof;
  focusPath: {
    initialSurfaceSelectorRef: string;
    alternateTabSelectorRef: string;
    returnedSurfaceSelectorRef: string;
    restoredWithoutSecondViewer: boolean;
  };
  fixtureEvidence: {
    targetOriginRef?: string;
    inputLengthTrace: number[];
    inputHashTrace: string[];
    submittedLength?: number;
    submittedHash?: string;
    eventProofRef?: string;
  };
  inputActionEvidence: {
    actionCount: number;
    typeActionTextLengths: number[];
    typeActionTextHashes: string[];
    pressKeys: string[];
  };
  refs: {
    liveSurfaceRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
    consoleLogRef?: string;
    networkLogRef?: string;
  };
  forbiddenEvidence: {
    secondViewer: false;
    legacyStreamSurface: false;
    frameStreamRef: false;
    canvasSurface: false;
    httpFrameImage: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    rawDom: false;
    rawLogs: false;
    rawText: false;
    base64: false;
  };
  verificationCommand: typeof verificationCommand;
};

type NativeFocusFixture = {
  owner?: string;
  liveSurfaceTransport?: string;
  singleInteractiveTruth?: boolean;
  secondTruthSource?: boolean;
  inputChannel?: string;
  beforeSessionId?: string;
  afterSessionId?: string;
  beforeLiveSurfaceRef?: string;
  afterLiveSurfaceRef?: string;
  shellComposerCapturedCharacters?: number;
  blockedReason?: string;
  inputText?: string;
  restoredText?: string;
  submittedText?: string;
  frameStreamRef?: string;
  nativeAttach?: Partial<NativeAttachProof>;
  focusKeyboardProof?: Partial<FocusKeyboardProof>;
  lifecycleProof?: Partial<LifecycleProof>;
  consumedNativeDesktopEvidence?: ConsumedNativeDesktopEvidence;
  coverageGaps?: string[];
};

test('tab focus retention only claims pass for native-embedded BrowserHostSession single truth', () => {
  const sessionId = 'browser-host-native-tab-focus';
  const liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
  const manifest = buildManifest({
    beforeSessionId: sessionId,
    afterSessionId: sessionId,
    beforeLiveSurfaceRef: liveSurfaceRef,
    afterLiveSurfaceRef: liveSurfaceRef,
    inputText: 'tab focus route alpha',
    restoredText: ' restored route beta',
    submittedText: 'tab focus route alpha restored route beta',
    nativeAttach: realNativeAttachProof(sessionId),
    focusKeyboardProof: realFocusKeyboardProof(sessionId),
    lifecycleProof: realLifecycleProof(sessionId),
  });

  assertTabFocusRetentionManifest(manifest);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.passClaim, true);
  assert.equal(manifest.observed.liveSurfaceTransport, 'native-embedded');
  assert.equal(manifest.observed.sameSessionId, true);
  assert.equal(manifest.observed.sameLiveSurfaceRef, true);
  assert.equal(manifest.nativeAttach.proofMode, 'real-native-attach');
  assert.equal(manifest.focusKeyboardProof.focusOwner, 'BrowserHostSession');
  assert.equal(manifest.focusKeyboardProof.keyboardOwner, 'BrowserHostSession');
  assert.equal(manifest.lifecycleProof.observedPhases.length, requiredLifecyclePhases.length);
  assert.equal(manifest.forbiddenEvidence.frameStreamRef, false);
});

test('tab focus retention refuses stale, second-truth, and forged native-looking Browser surface evidence', () => {
  const staleSurface = buildManifest({
    beforeSessionId: 'browser-host-old-tab-focus',
    afterSessionId: 'browser-host-old-tab-focus',
    liveSurfaceTransport: 'legacy-stream',
    beforeLiveSurfaceRef: 'browser-host-session:browser-host-old-tab-focus/live-surface',
    afterLiveSurfaceRef: 'browser-host-session:browser-host-old-tab-focus/live-surface',
    frameStreamRef: 'browser-host-session:browser-host-old-tab-focus/frame-stream',
  });
  assertTabFocusRetentionManifest(staleSurface);
  assert.equal(staleSurface.status, 'blocked');
  assert.equal(staleSurface.passClaim, false);
  assert.match(staleSurface.observed.blockedReason ?? '', /native-embedded/);
  assert.equal(staleSurface.forbiddenEvidence.frameStreamRef, false);

  const secondTruth = buildManifest({
    beforeSessionId: 'browser-host-second-truth',
    afterSessionId: 'browser-host-second-truth',
    beforeLiveSurfaceRef: 'browser-host-session:browser-host-second-truth/live-surface',
    afterLiveSurfaceRef: 'browser-host-session:browser-host-second-truth/live-surface',
    secondTruthSource: true,
  });
  assertTabFocusRetentionManifest(secondTruth);
  assert.equal(secondTruth.status, 'blocked');
  assert.match(secondTruth.observed.blockedReason ?? '', /single native truth/);

  const nativeLookingWithoutAttachProof = buildManifest({
    beforeSessionId: 'browser-host-native-looking',
    afterSessionId: 'browser-host-native-looking',
    beforeLiveSurfaceRef: 'browser-host-session:browser-host-native-looking/live-surface',
    afterLiveSurfaceRef: 'browser-host-session:browser-host-native-looking/live-surface',
    focusKeyboardProof: realFocusKeyboardProof('browser-host-native-looking'),
    lifecycleProof: realLifecycleProof('browser-host-native-looking'),
  });
  assertTabFocusRetentionManifest(nativeLookingWithoutAttachProof);
  assert.equal(nativeLookingWithoutAttachProof.status, 'blocked');
  assert.match(nativeLookingWithoutAttachProof.observed.blockedReason ?? '', /real native attach proof/);

  const forgedPassWithoutAttach: TabFocusRetentionManifest = {
    ...nativeLookingWithoutAttachProof,
    status: 'passed',
    claimScope: 'right-pane-native-focus-retention',
    passClaim: true,
  };
  assert.throws(() => assertTabFocusRetentionManifest(forgedPassWithoutAttach), /real native attach proof/);

  const forgedPassWithoutFocusProof: TabFocusRetentionManifest = {
    ...buildManifest({
      beforeSessionId: 'browser-host-no-focus-proof',
      afterSessionId: 'browser-host-no-focus-proof',
      beforeLiveSurfaceRef: 'browser-host-session:browser-host-no-focus-proof/live-surface',
      afterLiveSurfaceRef: 'browser-host-session:browser-host-no-focus-proof/live-surface',
      nativeAttach: realNativeAttachProof('browser-host-no-focus-proof'),
      lifecycleProof: realLifecycleProof('browser-host-no-focus-proof'),
    }),
    status: 'passed',
    claimScope: 'right-pane-native-focus-retention',
    passClaim: true,
  };
  assert.throws(() => assertTabFocusRetentionManifest(forgedPassWithoutFocusProof), /focus\/keyboard owner proof/);

  const forgedPassWithoutLifecycleProof: TabFocusRetentionManifest = {
    ...buildManifest({
      beforeSessionId: 'browser-host-no-lifecycle-proof',
      afterSessionId: 'browser-host-no-lifecycle-proof',
      beforeLiveSurfaceRef: 'browser-host-session:browser-host-no-lifecycle-proof/live-surface',
      afterLiveSurfaceRef: 'browser-host-session:browser-host-no-lifecycle-proof/live-surface',
      nativeAttach: realNativeAttachProof('browser-host-no-lifecycle-proof'),
      focusKeyboardProof: realFocusKeyboardProof('browser-host-no-lifecycle-proof'),
    }),
    status: 'passed',
    claimScope: 'right-pane-native-focus-retention',
    passClaim: true,
  };
  assert.throws(() => assertTabFocusRetentionManifest(forgedPassWithoutLifecycleProof), /lifecycle proof/);
});

test('tab focus retention writes bounded blocked manifest when real native dogfood is absent', async () => {
  const consumed = await readConsumedNativeDesktopEvidence();
  const blockedInput: NativeFocusFixture = consumed
    ? {
        beforeSessionId: sessionIdFromSessionRef(consumed.browserHostSessionRef),
        afterSessionId: sessionIdFromSessionRef(consumed.browserHostSessionRef),
        beforeLiveSurfaceRef: consumed.liveSurfaceRef,
        afterLiveSurfaceRef: consumed.liveSurfaceRef,
        nativeAttach: nativeAttachProofFromConsumedDesktopEvidence(consumed),
        focusKeyboardProof: focusKeyboardProofFromConsumedDesktopEvidence(consumed),
        lifecycleProof: lifecycleProofFromConsumedDesktopEvidence(consumed),
        consumedNativeDesktopEvidence: consumed,
        coverageGaps: [
          'missing-real-right-pane-tab-switch-proof',
          'missing-real-native-detach-reattach-proof',
          'missing-real-keyboard-focus-retention-proof',
        ],
        blockedReason: 'Desktop native live acceptance supplied real attach/resize/minimize/restore refs, but tab focus retention still lacks real tab switch, native detach/reattach, and keyboard focus retention proof.',
      }
    : {
        beforeSessionId: 'browser-host-tab-focus-blocked',
        afterSessionId: 'browser-host-tab-focus-blocked',
        liveSurfaceTransport: 'missing-native-attach',
        beforeLiveSurfaceRef: undefined,
        afterLiveSurfaceRef: undefined,
        coverageGaps: [
          'missing-real-right-pane-native-evidence',
          'missing-real-right-pane-tab-switch-proof',
          'missing-real-native-detach-reattach-proof',
          'missing-real-keyboard-focus-retention-proof',
        ],
        blockedReason: 'Real right-pane native focus retention dogfood has not produced a native surface attach proof in this environment.',
      };
  const manifest = buildManifest(blockedInput);
  assertTabFocusRetentionManifest(manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.claimScope, 'diagnostic-only');
  assert.equal(manifest.passClaim, false);
  assert.ok(manifest.coverageGaps.length > 0);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
});

test('tab focus retention consumes desktop native live evidence without claiming missing tab/detach focus proof', async () => {
  const consumed = consumedNativeDesktopEvidenceFrom(desktopNativeLiveEvidenceFixture());
  assert.ok(consumed, 'fixture should expose pass-grade desktop native evidence');

  const manifest = buildManifest({
    beforeSessionId: 'browser-host-real-native-live',
    afterSessionId: 'browser-host-real-native-live',
    beforeLiveSurfaceRef: 'browser-host-session:browser-host-real-native-live/live-surface',
    afterLiveSurfaceRef: 'browser-host-session:browser-host-real-native-live/live-surface',
    nativeAttach: nativeAttachProofFromConsumedDesktopEvidence(consumed),
    focusKeyboardProof: focusKeyboardProofFromConsumedDesktopEvidence(consumed),
    lifecycleProof: lifecycleProofFromConsumedDesktopEvidence(consumed),
    consumedNativeDesktopEvidence: consumed,
    coverageGaps: [
      'missing-real-right-pane-tab-switch-proof',
      'missing-real-native-detach-reattach-proof',
      'missing-real-keyboard-focus-retention-proof',
    ],
  });

  assertTabFocusRetentionManifest(manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.nativeAttach.proofMode, 'real-native-attach');
  assert.equal(manifest.lifecycleProof.boundedCounts.resizeCount, 1);
  assert.equal(manifest.lifecycleProof.boundedCounts.minimizeCount, 1);
  assert.equal(manifest.lifecycleProof.boundedCounts.restoreCount, 1);
  assert.deepEqual(manifest.coverageGaps, [
    'missing-real-right-pane-tab-switch-proof',
    'missing-real-native-detach-reattach-proof',
    'missing-real-keyboard-focus-retention-proof',
  ]);
  assert.equal(manifest.consumedNativeDesktopEvidence?.rawPayloadRecorded, false);
});

function buildManifest(input: NativeFocusFixture): TabFocusRetentionManifest {
  const owner = input.owner ?? 'BrowserHostSession';
  const liveSurfaceTransport = input.liveSurfaceTransport ?? 'native-embedded';
  const singleInteractiveTruth = input.singleInteractiveTruth ?? true;
  const secondTruthSource = input.secondTruthSource ?? false;
  const inputChannel = input.inputChannel ?? 'browser-host-session';
  const beforeSessionId = input.beforeSessionId ?? '';
  const afterSessionId = input.afterSessionId ?? beforeSessionId;
  const beforeLiveSurfaceRef = input.beforeLiveSurfaceRef;
  const afterLiveSurfaceRef = input.afterLiveSurfaceRef;
  const beforeSessionRef = beforeSessionId ? browserHostSessionRef(beforeSessionId) : undefined;
  const afterSessionRef = afterSessionId ? browserHostSessionRef(afterSessionId) : undefined;
  const sameSessionId = Boolean(beforeSessionId) && beforeSessionId === afterSessionId;
  const sameLiveSurfaceRef = Boolean(beforeLiveSurfaceRef) && beforeLiveSurfaceRef === afterLiveSurfaceRef;
  const hasFrameStreamRef = Boolean(input.frameStreamRef);
  const shellComposerCapturedCharacters = input.shellComposerCapturedCharacters ?? 0;
  const nativeAttach = normalizedNativeAttach(input.nativeAttach, {
    liveSurfaceTransport,
    beforeSessionRef,
    beforeLiveSurfaceRef,
    blockedReason: input.blockedReason,
  });
  const focusKeyboardProof = normalizedFocusKeyboardProof(input.focusKeyboardProof, {
    owner,
    inputChannel,
    beforeSessionRef,
    beforeLiveSurfaceRef,
    shellComposerCapturedCharacters,
  });
  const lifecycleProof = normalizedLifecycleProof(input.lifecycleProof, {
    beforeSessionRef,
    beforeLiveSurfaceRef,
    shellComposerCapturedCharacters,
  });
  const hasRealNativeAttachProof = hasRealNativeAttachProofFor(nativeAttach, beforeSessionRef, beforeLiveSurfaceRef);
  const hasFocusKeyboardOwnerProof = hasFocusKeyboardOwnerProofFor(focusKeyboardProof, beforeSessionRef, beforeLiveSurfaceRef);
  const hasLifecycleProof = hasLifecycleProofFor(lifecycleProof, beforeSessionRef, beforeLiveSurfaceRef);
  const coverageGaps = input.coverageGaps ?? [];
  const passClaim = owner === 'BrowserHostSession'
    && liveSurfaceTransport === 'native-embedded'
    && singleInteractiveTruth
    && !secondTruthSource
    && inputChannel === 'browser-host-session'
    && sameSessionId
    && sameLiveSurfaceRef
    && hasRealNativeAttachProof
    && hasFocusKeyboardOwnerProof
    && hasLifecycleProof
    && coverageGaps.length === 0
    && !hasFrameStreamRef
    && shellComposerCapturedCharacters === 0;
  const blockedReason = passClaim
    ? undefined
    : input.blockedReason ?? blockedReasonFor({
      owner,
      liveSurfaceTransport,
      singleInteractiveTruth,
      secondTruthSource,
      inputChannel,
      sameSessionId,
      sameLiveSurfaceRef,
      hasRealNativeAttachProof,
      hasFocusKeyboardOwnerProof,
      hasLifecycleProof,
      hasFrameStreamRef,
      shellComposerCapturedCharacters,
    });
  const inputTexts = [input.inputText, input.restoredText].filter(isNonEmptyString);
  const submittedText = input.submittedText;
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: passClaim ? 'passed' : 'blocked',
    claimScope: passClaim ? 'right-pane-native-focus-retention' : 'diagnostic-only',
    passClaim,
    runId: `browser-pane-tab-focus-retention-${hashText(`${beforeSessionId}:${afterSessionId}:${liveSurfaceTransport}:${Date.now()}`)}`,
    observedAt: new Date().toISOString(),
    refsFirst: true,
    required: {
      owner: 'BrowserHostSession',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      inputChannel: 'browser-host-session',
      sameSessionId: true,
      sameLiveSurfaceRef: true,
      nativeAttachProofMode: 'real-native-attach',
      focusKeyboardOwnerProofRefs: true,
      lifecycleCoverage: {
        multiTab: true,
        nativeDetach: true,
        nativeReattach: true,
        resize: true,
        minimize: true,
        restore: true,
      },
    },
    observed: {
      owner,
      liveSurfaceTransport,
      singleInteractiveTruth,
      secondTruthSource,
      inputChannel,
      sameSessionId,
      sameLiveSurfaceRef,
      beforeSessionRef,
      afterSessionRef,
      beforeLiveSurfaceRef,
      afterLiveSurfaceRef,
      shellComposerCapturedCharacters,
      blockedReason,
    },
    consumedNativeDesktopEvidence: input.consumedNativeDesktopEvidence,
    coverageGaps,
    nativeAttach: {
      ...nativeAttach,
      blockedReason,
    },
    focusKeyboardProof,
    lifecycleProof,
    focusPath: {
      initialSurfaceSelectorRef: 'selector:right-pane-browser-native-surface',
      alternateTabSelectorRef: 'selector:right-pane-results-tab',
      returnedSurfaceSelectorRef: 'selector:right-pane-browser-native-surface',
      restoredWithoutSecondViewer: passClaim,
    },
    fixtureEvidence: {
      targetOriginRef: inputTexts.length ? `fixture-origin:${hashText('tab-focus-retention-fixture')}` : undefined,
      inputLengthTrace: inputTexts.map((text) => text.length),
      inputHashTrace: inputTexts.map(hashText),
      submittedLength: submittedText?.length,
      submittedHash: submittedText ? hashText(submittedText) : undefined,
      eventProofRef: passClaim ? `browser-host-session:${beforeSessionId}/tab-focus-retention-events.json` : undefined,
    },
    inputActionEvidence: {
      actionCount: inputTexts.length + (submittedText ? 1 : 0),
      typeActionTextLengths: inputTexts.map((text) => text.length),
      typeActionTextHashes: inputTexts.map(hashText),
      pressKeys: submittedText ? ['Enter'] : [],
    },
    refs: {
      liveSurfaceRef: passClaim ? beforeLiveSurfaceRef : undefined,
      screenshotRef: passClaim ? `browser-host-session:${beforeSessionId}/screenshot-ref` : undefined,
      domSnapshotRef: passClaim ? `browser-host-session:${beforeSessionId}/dom-snapshot-ref` : undefined,
      axSnapshotRef: passClaim ? `browser-host-session:${beforeSessionId}/ax-snapshot-ref` : undefined,
      consoleLogRef: passClaim ? `browser-host-session:${beforeSessionId}/console-log-ref` : undefined,
      networkLogRef: passClaim ? `browser-host-session:${beforeSessionId}/network-log-ref` : undefined,
    },
    forbiddenEvidence: {
      secondViewer: false,
      legacyStreamSurface: false,
      frameStreamRef: false,
      canvasSurface: false,
      httpFrameImage: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      rawDom: false,
      rawLogs: false,
      rawText: false,
      base64: false,
    },
    verificationCommand,
  };
}

function realNativeAttachProof(sessionId: string): NativeAttachProof {
  const sessionRef = browserHostSessionRef(sessionId);
  const liveSurfaceRef = liveSurfaceRefFor(sessionId);
  return {
    state: 'attached',
    observed: 'native-embedded',
    proofMode: 'real-native-attach',
    browserHostSessionRef: sessionRef,
    liveSurfaceRef,
    nativeSurfaceAttachRef: `${sessionRef}/native-surface-attach-proof`,
    nativeSurfaceStateRef: `${sessionRef}/native-surface-state-proof`,
    canRetry: false,
    handoffRequired: false,
    rawPayloadRecorded: false,
  };
}

function realFocusKeyboardProof(sessionId: string): FocusKeyboardProof {
  const sessionRef = browserHostSessionRef(sessionId);
  const liveSurfaceRef = liveSurfaceRefFor(sessionId);
  return {
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    focusOwner: 'BrowserHostSession',
    keyboardOwner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    shellComposerTarget: 'not-targeted',
    shellComposerCapturedCharacters: 0,
    browserHostSessionRef: sessionRef,
    liveSurfaceRef,
    focusOwnerRef: `${sessionRef}/focus-owner-proof`,
    keyboardOwnerRef: `${sessionRef}/keyboard-owner-proof`,
    composerAuditRef: `${sessionRef}/composer-isolation-audit`,
    actionTraceRef: `${sessionRef}/keyboard-action-trace`,
    rawFocusPayloadRecorded: false,
    rawKeyboardPayloadRecorded: false,
  };
}

function realLifecycleProof(sessionId: string): LifecycleProof {
  const sessionRef = browserHostSessionRef(sessionId);
  const liveSurfaceRef = liveSurfaceRefFor(sessionId);
  return {
    requiredPhases: [...requiredLifecyclePhases],
    observedPhases: [...requiredLifecyclePhases],
    sameBrowserHostSessionRef: true,
    sameLiveSurfaceRef: true,
    lifecycleTraceRef: `${sessionRef}/tab-focus-retention-lifecycle-trace`,
    phaseProofs: requiredLifecyclePhases.map((phase) => ({
      phase,
      browserHostSessionRef: sessionRef,
      liveSurfaceRef,
      proofRef: `${sessionRef}/tab-focus-retention-${phase}-proof`,
      keyboardFocusOwnerRef: `${sessionRef}/tab-focus-retention-${phase}-keyboard-focus-owner`,
      rawPayloadRecorded: false,
    })),
    boundedCounts: {
      tabSwitchCount: 1,
      nativeDetachCount: 1,
      nativeAttachCount: 1,
      resizeCount: 1,
      minimizeCount: 1,
      restoreCount: 1,
      keyboardFocusLossCount: 0,
      shellComposerCapturedCharacters: 0,
    },
    rawPayloadRecorded: false,
  };
}

async function readConsumedNativeDesktopEvidence(): Promise<ConsumedNativeDesktopEvidence | undefined> {
  try {
    const text = await readFile(desktopNativeLiveManifestPath, 'utf8');
    return consumedNativeDesktopEvidenceFrom(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function consumedNativeDesktopEvidenceFrom(value: unknown): ConsumedNativeDesktopEvidence | undefined {
  const evidence = recordValue(value);
  const nativeAdapter = recordValue(evidence?.nativeAdapter);
  const browserHostSession = recordValue(evidence?.browserHostSession);
  const surface = recordValue(evidence?.surface);
  const interaction = recordValue(evidence?.interaction);
  const actionAck = recordValue(interaction?.actionAck);
  const heartbeat = recordValue(interaction?.stateHeartbeat);
  const benchmarkMetrics = recordValue(evidence?.benchmarkMetrics);
  const metricSections = recordValue(benchmarkMetrics?.metricSections);
  const lifecycle = recordValue(metricSections?.lifecycle);
  const inputCompleteness = recordValue(metricSections?.inputCompleteness);
  const sessionId = stringValue(browserHostSession?.id);
  if (
    stringValue(evidence?.schemaVersion) !== 'sciforge.desktop.browser-native-live-acceptance.v1'
    || stringValue(evidence?.status) !== 'passed'
    || evidence?.canClaimDesktopNativeLivePass !== true
    || stringValue(evidence?.claimScope) !== 'desktop-native-embedded-browser-pane-live'
    || stringValue(nativeAdapter?.owner) !== 'BrowserHostSession'
    || stringValue(nativeAdapter?.adapterRole) !== 'display-input-adapter'
    || stringValue(nativeAdapter?.liveSurfaceTransport) !== 'native-embedded'
    || nativeAdapter?.secondTruthSource !== false
    || stringValue(browserHostSession?.liveSurfaceTransport) !== 'native-embedded'
    || browserHostSession?.singleInteractiveTruth !== true
    || browserHostSession?.frameStreamRefPresent !== false
    || browserHostSession?.frameRefPresent !== false
    || browserHostSession?.frameUrlPresent !== false
    || surface?.ok !== true
    || stringValue(surface?.owner) !== 'BrowserHostSession'
    || stringValue(surface?.surface) !== 'electron-web-contents-view'
    || stringValue(surface?.liveSurfaceTransport) !== 'native-embedded'
    || surface?.embedded !== true
    || surface?.visible !== true
    || surface?.secondTruthSource !== false
    || interaction?.typedTokenObserved !== true
    || stringValue(interaction?.paintAckSource) !== 'native-adapter-action-state'
    || stringValue(actionAck?.status) !== 'ok'
    || actionAck?.dependsOnScreenshot !== false
    || actionAck?.dependsOnFrameStream !== false
    || stringValue(heartbeat?.source) !== 'native-adapter-state-endpoint'
    || heartbeat?.lightweightStateUpdated !== true
    || stringValue(lifecycle?.status) !== 'passed'
    || !isNonEmptyString(sessionId)
  ) {
    return undefined;
  }
  const sessionRef = browserHostSessionRef(sessionId);
  return {
    sourceRef: 'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json',
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    claimScope: 'desktop-native-embedded-browser-pane-live',
    browserHostSessionRef: sessionRef,
    liveSurfaceRef: liveSurfaceRefFor(sessionId),
    nativeAttachRef: `${sessionRef}/desktop-native-live-attach-proof`,
    nativeSurfaceStateRef: `${sessionRef}/desktop-native-live-surface-state-proof`,
    lifecycleResultRef: stringValue(lifecycle?.resultRef),
    inputCompletenessResultRef: stringValue(inputCompleteness?.resultRef),
    verificationCommand: stringValue(evidence?.verificationCommand),
    rawPayloadRecorded: false,
  };
}

function nativeAttachProofFromConsumedDesktopEvidence(evidence: ConsumedNativeDesktopEvidence): NativeAttachProof {
  return {
    state: 'attached',
    observed: 'native-embedded',
    proofMode: 'real-native-attach',
    browserHostSessionRef: evidence.browserHostSessionRef,
    liveSurfaceRef: evidence.liveSurfaceRef,
    nativeSurfaceAttachRef: evidence.nativeAttachRef,
    nativeSurfaceStateRef: evidence.nativeSurfaceStateRef,
    canRetry: false,
    handoffRequired: false,
    rawPayloadRecorded: false,
  };
}

function focusKeyboardProofFromConsumedDesktopEvidence(evidence: ConsumedNativeDesktopEvidence): Partial<FocusKeyboardProof> {
  return {
    owner: 'BrowserHostSession',
    focusOwner: 'unproven',
    keyboardOwner: 'unproven',
    inputChannel: 'browser-host-session',
    shellComposerTarget: 'not-targeted',
    shellComposerCapturedCharacters: 0,
    browserHostSessionRef: evidence.browserHostSessionRef,
    liveSurfaceRef: evidence.liveSurfaceRef,
    actionTraceRef: evidence.inputCompletenessResultRef,
    rawFocusPayloadRecorded: false,
    rawKeyboardPayloadRecorded: false,
  };
}

function lifecycleProofFromConsumedDesktopEvidence(evidence: ConsumedNativeDesktopEvidence): Partial<LifecycleProof> {
  const sessionRef = evidence.browserHostSessionRef;
  return {
    requiredPhases: [...requiredLifecyclePhases],
    observedPhases: ['after-resize', 'after-minimize', 'after-restore'],
    sameBrowserHostSessionRef: true,
    sameLiveSurfaceRef: true,
    lifecycleTraceRef: evidence.lifecycleResultRef,
    phaseProofs: (['after-resize', 'after-minimize', 'after-restore'] as const).map((phase) => ({
      phase,
      browserHostSessionRef: sessionRef,
      liveSurfaceRef: evidence.liveSurfaceRef,
      proofRef: evidence.lifecycleResultRef,
      keyboardFocusOwnerRef: undefined,
      rawPayloadRecorded: false,
    })),
    boundedCounts: {
      tabSwitchCount: 0,
      nativeDetachCount: 0,
      nativeAttachCount: 1,
      resizeCount: 1,
      minimizeCount: 1,
      restoreCount: 1,
      keyboardFocusLossCount: null,
      shellComposerCapturedCharacters: 0,
    },
    rawPayloadRecorded: false,
  };
}

function desktopNativeLiveEvidenceFixture() {
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    nativeAdapter: {
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      secondTruthSource: false,
    },
    browserHostSession: {
      id: 'browser-host-real-native-live',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      frameStreamRefPresent: false,
      frameRefPresent: false,
      frameUrlPresent: false,
    },
    surface: {
      ok: true,
      owner: 'BrowserHostSession',
      surface: 'electron-web-contents-view',
      liveSurfaceTransport: 'native-embedded',
      embedded: true,
      visible: true,
      secondTruthSource: false,
    },
    interaction: {
      typedTokenObserved: true,
      paintAckSource: 'native-adapter-action-state',
      actionAck: {
        status: 'ok',
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
      },
      stateHeartbeat: {
        source: 'native-adapter-state-endpoint',
        lightweightStateUpdated: true,
      },
    },
    benchmarkMetrics: {
      metricSections: {
        lifecycle: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:lifecycle:fixture',
        },
        inputCompleteness: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:inputCompleteness:fixture',
        },
      },
    },
    verificationCommand: 'npm run smoke:desktop-browser-native-live-acceptance --silent',
  };
}

function normalizedNativeAttach(
  input: Partial<NativeAttachProof> | undefined,
  context: {
    liveSurfaceTransport: string;
    beforeSessionRef?: string;
    beforeLiveSurfaceRef?: string;
    blockedReason?: string;
  },
): NativeAttachProof {
  const defaultState = context.liveSurfaceTransport === 'missing-native-attach' ? 'handoff' : 'blocked';
  const state = input?.state ?? defaultState;
  return {
    state,
    observed: input?.observed ?? 'missing-native-attach',
    proofMode: input?.proofMode ?? 'missing-native-attach',
    browserHostSessionRef: input?.browserHostSessionRef,
    liveSurfaceRef: input?.liveSurfaceRef,
    nativeSurfaceAttachRef: input?.nativeSurfaceAttachRef,
    nativeSurfaceStateRef: input?.nativeSurfaceStateRef,
    canRetry: input?.canRetry ?? state !== 'attached',
    handoffRequired: input?.handoffRequired ?? state !== 'attached',
    blockedReasonCode: input?.blockedReasonCode ?? (state === 'attached' ? undefined : 'missing-native-attach'),
    blockedReason: input?.blockedReason ?? context.blockedReason,
    rawPayloadRecorded: false,
  };
}

function normalizedFocusKeyboardProof(
  input: Partial<FocusKeyboardProof> | undefined,
  context: {
    owner: string;
    inputChannel: string;
    beforeSessionRef?: string;
    beforeLiveSurfaceRef?: string;
    shellComposerCapturedCharacters: number;
  },
): FocusKeyboardProof {
  return {
    productSurface: 'right-pane-browser',
    owner: input?.owner ?? context.owner,
    focusOwner: input?.focusOwner ?? 'unproven',
    keyboardOwner: input?.keyboardOwner ?? 'unproven',
    inputChannel: input?.inputChannel ?? context.inputChannel,
    shellComposerTarget: input?.shellComposerTarget ?? (context.shellComposerCapturedCharacters === 0 ? 'not-targeted' : 'shell-composer'),
    shellComposerCapturedCharacters: input?.shellComposerCapturedCharacters ?? context.shellComposerCapturedCharacters,
    browserHostSessionRef: input?.browserHostSessionRef,
    liveSurfaceRef: input?.liveSurfaceRef,
    focusOwnerRef: input?.focusOwnerRef,
    keyboardOwnerRef: input?.keyboardOwnerRef,
    composerAuditRef: input?.composerAuditRef,
    actionTraceRef: input?.actionTraceRef,
    rawFocusPayloadRecorded: false,
    rawKeyboardPayloadRecorded: false,
  };
}

function normalizedLifecycleProof(
  input: Partial<LifecycleProof> | undefined,
  context: {
    beforeSessionRef?: string;
    beforeLiveSurfaceRef?: string;
    shellComposerCapturedCharacters: number;
  },
): LifecycleProof {
  const phaseProofs = input?.phaseProofs ?? [];
  return {
    requiredPhases: input?.requiredPhases ?? [...requiredLifecyclePhases],
    observedPhases: input?.observedPhases ?? phaseProofs.map((proof) => proof.phase),
    sameBrowserHostSessionRef: input?.sameBrowserHostSessionRef ?? false,
    sameLiveSurfaceRef: input?.sameLiveSurfaceRef ?? false,
    lifecycleTraceRef: input?.lifecycleTraceRef,
    phaseProofs,
    boundedCounts: input?.boundedCounts ?? {
      tabSwitchCount: 0,
      nativeDetachCount: 0,
      nativeAttachCount: 0,
      resizeCount: 0,
      minimizeCount: 0,
      restoreCount: 0,
      keyboardFocusLossCount: null,
      shellComposerCapturedCharacters: context.shellComposerCapturedCharacters,
    },
    rawPayloadRecorded: false,
  };
}

function hasRealNativeAttachProofFor(proof: NativeAttachProof, sessionRef: string | undefined, liveSurfaceRef: string | undefined): boolean {
  return proof.state === 'attached'
    && proof.observed === 'native-embedded'
    && proof.proofMode === 'real-native-attach'
    && proof.handoffRequired === false
    && proof.rawPayloadRecorded === false
    && proof.browserHostSessionRef === sessionRef
    && proof.liveSurfaceRef === liveSurfaceRef
    && isSessionScopedRef(proof.nativeSurfaceAttachRef, sessionRef)
    && isSessionScopedRef(proof.nativeSurfaceStateRef, sessionRef);
}

function hasFocusKeyboardOwnerProofFor(proof: FocusKeyboardProof, sessionRef: string | undefined, liveSurfaceRef: string | undefined): boolean {
  return proof.productSurface === 'right-pane-browser'
    && proof.owner === 'BrowserHostSession'
    && proof.focusOwner === 'BrowserHostSession'
    && proof.keyboardOwner === 'BrowserHostSession'
    && proof.inputChannel === 'browser-host-session'
    && proof.shellComposerTarget === 'not-targeted'
    && proof.shellComposerCapturedCharacters === 0
    && proof.rawFocusPayloadRecorded === false
    && proof.rawKeyboardPayloadRecorded === false
    && proof.browserHostSessionRef === sessionRef
    && proof.liveSurfaceRef === liveSurfaceRef
    && [
      proof.focusOwnerRef,
      proof.keyboardOwnerRef,
      proof.composerAuditRef,
      proof.actionTraceRef,
    ].every((ref) => isSessionScopedRef(ref, sessionRef));
}

function hasLifecycleProofFor(proof: LifecycleProof, sessionRef: string | undefined, liveSurfaceRef: string | undefined): boolean {
  const observed = new Set(proof.observedPhases);
  const phaseProofs = new Map(proof.phaseProofs.map((phaseProof) => [phaseProof.phase, phaseProof]));
  return proof.rawPayloadRecorded === false
    && proof.sameBrowserHostSessionRef === true
    && proof.sameLiveSurfaceRef === true
    && isSessionScopedRef(proof.lifecycleTraceRef, sessionRef)
    && requiredLifecyclePhases.every((phase) => observed.has(phase))
    && requiredLifecyclePhases.every((phase) => {
      const phaseProof = phaseProofs.get(phase);
      return Boolean(phaseProof)
        && phaseProof?.browserHostSessionRef === sessionRef
        && phaseProof?.liveSurfaceRef === liveSurfaceRef
        && phaseProof?.rawPayloadRecorded === false
        && isSessionScopedRef(phaseProof?.proofRef, sessionRef)
        && isSessionScopedRef(phaseProof?.keyboardFocusOwnerRef, sessionRef);
    })
    && proof.boundedCounts.tabSwitchCount >= 1
    && proof.boundedCounts.nativeDetachCount >= 1
    && proof.boundedCounts.nativeAttachCount >= 1
    && proof.boundedCounts.resizeCount >= 1
    && proof.boundedCounts.minimizeCount >= 1
    && proof.boundedCounts.restoreCount >= 1
    && proof.boundedCounts.keyboardFocusLossCount === 0
    && proof.boundedCounts.shellComposerCapturedCharacters === 0;
}

function blockedReasonFor(input: {
  owner: string;
  liveSurfaceTransport: string;
  singleInteractiveTruth: boolean;
  secondTruthSource: boolean;
  inputChannel: string;
  sameSessionId: boolean;
  sameLiveSurfaceRef: boolean;
  hasRealNativeAttachProof: boolean;
  hasFocusKeyboardOwnerProof: boolean;
  hasLifecycleProof: boolean;
  hasFrameStreamRef: boolean;
  shellComposerCapturedCharacters: number;
}): string {
  if (input.owner !== 'BrowserHostSession') return 'Focus retention pass requires BrowserHostSession ownership.';
  if (input.liveSurfaceTransport !== 'native-embedded') return `Focus retention pass requires native-embedded live surface; observed ${input.liveSurfaceTransport || 'missing-native-attach'}.`;
  if (!input.singleInteractiveTruth || input.secondTruthSource) return 'Focus retention pass requires a single native truth source with no second viewer.';
  if (input.inputChannel !== 'browser-host-session') return 'Focus retention pass requires BrowserHostSession input channel.';
  if (!input.sameSessionId) return 'Focus retention pass requires the same BrowserHostSession before and after tab return.';
  if (!input.sameLiveSurfaceRef) return 'Focus retention pass requires the same native liveSurfaceRef before and after tab return.';
  if (!input.hasRealNativeAttachProof) return 'Focus retention pass requires real native attach proof for the BrowserHostSession live surface.';
  if (!input.hasFocusKeyboardOwnerProof) return 'Focus retention pass requires focus/keyboard owner proof refs scoped to the same BrowserHostSession.';
  if (!input.hasLifecycleProof) return 'Focus retention pass requires lifecycle proof refs for tab return, native detach, resize, minimize, and restore.';
  if (input.hasFrameStreamRef) return 'Focus retention pass cannot include a frame stream ref.';
  if (input.shellComposerCapturedCharacters > 0) return 'Focus retention pass cannot leak Browser typing into the shell composer.';
  return 'Focus retention pass requires bounded native surface evidence.';
}

function assertTabFocusRetentionManifest(manifest: TabFocusRetentionManifest) {
  assert.equal(manifest.schemaVersion, DOGFOOD_SCHEMA);
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.required.owner, 'BrowserHostSession');
  assert.equal(manifest.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(manifest.required.singleInteractiveTruth, true);
  assert.equal(manifest.required.secondTruthSource, false);
  assert.equal(manifest.required.inputChannel, 'browser-host-session');
  assert.equal(manifest.required.nativeAttachProofMode, 'real-native-attach');
  assert.equal(manifest.required.focusKeyboardOwnerProofRefs, true);
  assert.deepEqual(manifest.required.lifecycleCoverage, {
    multiTab: true,
    nativeDetach: true,
    nativeReattach: true,
    resize: true,
    minimize: true,
    restore: true,
  });
  assert.equal(manifest.verificationCommand, verificationCommand);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), Array(Object.values(manifest.forbiddenEvidence).length).fill(false));
  const sessionRef = manifest.observed.beforeSessionRef;
  const liveSurfaceRef = manifest.observed.beforeLiveSurfaceRef;
  if (manifest.status === 'passed') {
    assert.equal(manifest.claimScope, 'right-pane-native-focus-retention');
    assert.equal(manifest.passClaim, true);
    assert.equal(manifest.observed.owner, 'BrowserHostSession');
    assert.equal(manifest.observed.liveSurfaceTransport, 'native-embedded');
    assert.equal(manifest.observed.singleInteractiveTruth, true);
    assert.equal(manifest.observed.secondTruthSource, false);
    assert.equal(manifest.observed.inputChannel, 'browser-host-session');
    assert.equal(manifest.observed.sameSessionId, true);
    assert.equal(manifest.observed.sameLiveSurfaceRef, true);
    assert.equal(manifest.observed.beforeLiveSurfaceRef, manifest.observed.afterLiveSurfaceRef);
    assert.equal(manifest.observed.shellComposerCapturedCharacters, 0);
    assert.ok(hasRealNativeAttachProofFor(manifest.nativeAttach, sessionRef, liveSurfaceRef), 'passed manifest requires real native attach proof');
    assert.ok(hasFocusKeyboardOwnerProofFor(manifest.focusKeyboardProof, sessionRef, liveSurfaceRef), 'passed manifest requires focus/keyboard owner proof refs');
    assert.ok(hasLifecycleProofFor(manifest.lifecycleProof, sessionRef, liveSurfaceRef), 'passed manifest requires lifecycle proof refs');
    assert.match(manifest.refs.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
    assert.equal(manifest.focusPath.restoredWithoutSecondViewer, true);
  } else {
    assert.equal(manifest.claimScope, 'diagnostic-only');
    assert.equal(manifest.passClaim, false);
    assert.ok(manifest.observed.blockedReason);
    assert.equal(manifest.refs.liveSurfaceRef, undefined);
  }
  assert.equal(manifest.nativeAttach.rawPayloadRecorded, false);
  assert.equal(manifest.focusKeyboardProof.rawFocusPayloadRecorded, false);
  assert.equal(manifest.focusKeyboardProof.rawKeyboardPayloadRecorded, false);
  assert.equal(manifest.lifecycleProof.rawPayloadRecorded, false);
  assertBoundedManifest(manifest);
}

function assertBoundedManifest(manifest: TabFocusRetentionManifest) {
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assert.doesNotMatch(serialized, /"(?:rawDomPayload|rawLogPayload|consoleLogPayload|networkLogPayload|rawConsoleLog|rawNetworkLog|rawKeyboardPayload|rawFocusPayload)"\s*:/i);
  assert.doesNotMatch(serialized, /tab focus route alpha|restored route beta|candidate-secret|api[_-]?key|sk-[a-z0-9-]+/i);
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function browserHostSessionRef(sessionId: string): string {
  return `browser-host-session:${sessionId}`;
}

function liveSurfaceRefFor(sessionId: string): string {
  return `${browserHostSessionRef(sessionId)}/live-surface`;
}

function isSessionScopedRef(value: string | undefined, sessionRef: string | undefined): boolean {
  return typeof value === 'string'
    && typeof sessionRef === 'string'
    && isBrowserHostSessionRef(sessionRef)
    && value.startsWith(`${sessionRef}/`)
    && /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}\/[a-zA-Z0-9_.:-]{1,120}$/.test(value);
}

function isBrowserHostSessionRef(value: string): boolean {
  return /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}$/.test(value);
}

function sessionIdFromSessionRef(value: string): string {
  const match = /^browser-host-session:([a-zA-Z0-9_.:-]{1,120})$/.exec(value);
  assert.ok(match, `expected BrowserHostSession ref, got ${value}`);
  return match[1];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
