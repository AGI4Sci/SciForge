import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const SCHEMA = 'sciforge.browser.input-fidelity-product-acceptance.v1' as const;
const MANIFEST_PATH = resolve(process.cwd(), 'docs/test-artifacts/browser-input-fidelity-product-acceptance/manifest.json');

type BrowserInputFidelityCapability = {
  status: 'blocked' | 'passed';
  required: string[];
  evidenceRefs: string[];
  handoffRef?: string;
  auditRefs?: string[];
  requiredProofs?: BrowserInputFidelityRequiredProof[];
  productActionRefs?: string[];
  boundedLatencyMs?: number[];
  rawDomRecorded?: false;
  rawTypedTextRecorded?: false;
  rawCompositionPayloadRecorded?: false;
  rawClipboardPayloadRecorded?: false;
  rawSelectionTextRecorded?: false;
  selectedLengthOnly?: true;
  selectedHashOnly?: true;
  shellComposerCapturedCharacters?: number;
  systemClipboardRoundTripVerified?: boolean;
  details?: BrowserInputFidelityCapabilityDetails;
};

type BrowserInputFidelityRequiredProof = {
  kind: string;
  status: 'blocked' | 'passed';
  owner: 'BrowserHostSession';
  productSurface: 'right-pane-browser';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  proofRef: string;
  auditRef?: string;
  actionRef?: string;
  rangeRef?: string;
  confirmationAuditRef?: string;
  roundTripRef?: string;
  payloadPolicy?: 'length-and-hash-only';
  rawPayloadRecorded: false;
  shellComposerTarget: 'not-targeted';
  blocker?: string;
};

type BrowserInputFidelityOsUiHandoff = {
  status: 'blocked' | 'passed';
  passClaim: boolean;
  blocker?: string;
  requiredRunner: 'right-pane-native-os-ui-run';
  productSurface: 'right-pane-browser';
  owner: 'BrowserHostSession';
  inputChannel: 'browser-host-session';
  liveSurfaceTransport: 'native-embedded';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  handoffRef: string;
  auditRefs: string[];
  requiredProofs: BrowserInputFidelityRequiredProof[];
  rawPayloadsCaptured: false;
  refsFirst: true;
};

type BrowserInputFidelityCapabilityDetails =
  | {
    kind: 'ime-composition';
    realImeCandidateWindowVerified: boolean;
    candidateWindowEvidenceRef?: string;
    compositionEvents: Array<{
      phase: 'compositionstart' | 'compositionupdate' | 'compositionend';
      owner: 'BrowserHostSession';
      eventRef: string;
      committedTextLength?: number;
      committedTextHashSha256?: string;
      rawCompositionPayloadRecorded: false;
      shellComposerTarget: 'not-targeted';
    }>;
  }
  | {
    kind: 'clipboard-round-trip';
    systemClipboardRoundTripVerified: boolean;
    highRiskWriteConfirmation: 'required-and-observed' | 'required-not-observed';
    operations: Array<{
      operation: 'copy' | 'paste' | 'cut';
      owner: 'BrowserHostSession';
      actionRef: string;
      roundTripRef?: string;
      payloadLength: number;
      payloadHashSha256: string;
      rawClipboardPayloadRecorded: false;
      shellComposerTarget: 'not-targeted';
    }>;
  }
  | {
    kind: 'selection-range';
    targets: Array<'input' | 'contenteditable' | 'page-text'>;
    ranges: Array<{
      target: 'input' | 'contenteditable' | 'page-text';
      owner: 'BrowserHostSession';
      rangeRef: string;
      selectedLength: number;
      selectedHashSha256: string;
      rawSelectionTextRecorded: false;
      rawDomRecorded: false;
    }>;
  };

type BrowserInputFidelityProductAcceptanceEvidence = {
  schemaVersion: typeof SCHEMA;
  status: 'blocked' | 'passed';
  source: 'contract-only-fixture-no-real-os-ui-run' | 'real-product-os-ui-run';
  canClaimProductInputFidelityPass: boolean;
  owner: 'BrowserHostSession';
  liveSurfaceTransport: 'native-embedded' | 'host-stream';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  inputChannel: 'browser-host-session';
  rawPayloadsCaptured: false;
  refsFirst: true;
  realOsUiRunHandoff: BrowserInputFidelityOsUiHandoff;
  capabilities: Record<'cursorCaret' | 'mouse' | 'keyboard' | 'ime' | 'clipboard' | 'selectionRange', BrowserInputFidelityCapability>;
  osUiRun?: {
    runId: string;
    platform: 'macos' | 'windows' | 'linux';
    productSurface: 'right-pane-browser';
    startedAt: string;
    completedAt: string;
    browserHostSessionRef: string;
    liveSurfaceRef: string;
    frameStreamRef?: string;
	    auditRefs: string[];
	    auditProofs: BrowserInputFidelityOsUiAuditProof[];
	    composerAudit: {
	      shellComposerCapturedCharacters: number;
	      shellComposerTargetedActions: number;
      browserHostSessionInputRefs: string[];
      composerAuditRef: string;
    };
  };
	  blocker?: string;
	};

type BrowserInputFidelityOsUiAuditProof = {
  kind: 'window-focus-owner' | 'ime-candidate-window-owner' | 'system-clipboard-owner' | 'selection-range-owner';
  owner: 'BrowserHostSession';
  auditRef: string;
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  rawPayloadRecorded: false;
  shellComposerTarget: 'not-targeted';
};

test('Browser input fidelity product acceptance contract is bounded and cannot claim pass without real OS UI evidence', () => {
  const evidence = blockedInputFidelityEvidence();

  const validation = validateBrowserInputFidelityProductAcceptance(evidence);
  assert.equal(validation.canClaimPass, false);
	  assert.ok(validation.blockers.includes('real-product-os-ui-run-required'));
	  assert.ok(validation.blockers.includes('real-os-ui-run-refs-required'));
	  assert.ok(validation.blockers.includes('real-os-ui-audit-proof-required'));
	  assert.ok(validation.blockers.includes('shell-composer-must-not-capture-browser-input'));
  assert.ok(validation.blockers.includes('all-capabilities-must-pass'));
  assert.ok(validation.blockers.includes('ime-real-composition-proof-required'));
  assert.ok(validation.blockers.includes('clipboard-round-trip-proof-required'));
  assert.ok(validation.blockers.includes('selection-range-proof-required'));
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.canClaimProductInputFidelityPass, false);
  assert.equal(evidence.owner, 'BrowserHostSession');
  assert.equal(evidence.liveSurfaceTransport, 'native-embedded');
  assert.equal(evidence.singleInteractiveTruth, true);
  assert.equal(evidence.secondTruthSource, false);
  assert.equal(evidence.inputChannel, 'browser-host-session');
  assert.equal(evidence.refsFirst, true);
  assert.equal(evidence.rawPayloadsCaptured, false);
  assert.equal(evidence.realOsUiRunHandoff.status, 'blocked');
  assert.equal(evidence.realOsUiRunHandoff.passClaim, false);
  assert.equal(evidence.realOsUiRunHandoff.requiredProofs.length, 6);
  assert.ok(evidence.capabilities.mouse.required.includes('modifier-click tab owner/handoff'));
  assert.ok(evidence.capabilities.clipboard.requiredProofs?.every((proof) => proof.confirmationAuditRef?.startsWith('browser-host-session:input-fidelity-product-contract/')));
  assert.ok(evidence.capabilities.selectionRange.requiredProofs?.every((proof) => proof.rangeRef?.startsWith('browser-host-session:input-fidelity-product-contract/')));
  assert.deepEqual(validateBlockedInputFidelityHandoffSchema(evidence), []);

  const text = JSON.stringify(evidence);
  assertNoRawInputFidelityPayload(text, 'blocked evidence');
  assert.deepEqual(forbiddenPayloadKeys(evidence), []);
  assert.ok(allEvidenceRefs(evidence).every((ref) => ref.startsWith('browser-host-session:input-fidelity-product-contract/')));
});

test('Browser input fidelity product acceptance writes blocked bounded manifest until real product evidence exists', async () => {
  const evidence = blockedInputFidelityEvidence();
  const validation = validateBrowserInputFidelityProductAcceptance(evidence);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockers.includes('real-product-os-ui-run-required'));
  assert.ok(validation.blockers.includes('ime-real-composition-proof-required'));
  assert.ok(validation.blockers.includes('clipboard-round-trip-proof-required'));
  assert.ok(validation.blockers.includes('selection-range-proof-required'));
  assert.deepEqual(validateBlockedInputFidelityHandoffSchema(evidence), []);

  const manifestText = `${JSON.stringify(boundedInputFidelityManifest({
    ...evidence,
    validation,
    generatedAt: '2026-06-02T00:00:00.000Z',
  }), null, 2)}\n`;
  assertNoRawInputFidelityManifestPayload(manifestText, 'blocked bounded manifest');

  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, manifestText);
});

test('Browser input fidelity contract rejects forged pass without real IME, clipboard, and selection proofs', () => {
  const forged: BrowserInputFidelityProductAcceptanceEvidence = {
    ...blockedInputFidelityEvidence(),
    status: 'passed',
    source: 'real-product-os-ui-run',
    canClaimProductInputFidelityPass: true,
    osUiRun: {
      runId: 'input-fidelity-forged',
      platform: 'macos',
      productSurface: 'right-pane-browser',
      startedAt: '2026-06-02T00:00:00.000Z',
      completedAt: '2026-06-02T00:01:00.000Z',
      browserHostSessionRef: 'browser-host-session:input-fidelity-product-contract/session',
      liveSurfaceRef: 'browser-host-session:input-fidelity-product-contract/live-surface',
	      frameStreamRef: 'browser-host-session:input-fidelity-product-contract/frame-stream',
	      auditRefs: ['browser-host-session:input-fidelity-product-contract/audit'],
	      auditProofs: [],
	      composerAudit: {
        shellComposerCapturedCharacters: 3,
        shellComposerTargetedActions: 1,
        browserHostSessionInputRefs: [],
        composerAuditRef: 'browser-host-session:input-fidelity-product-contract/composer-audit',
      },
    },
    capabilities: Object.fromEntries(Object.entries(blockedInputFidelityEvidence().capabilities).map(([key, capability]) => [
      key,
      { ...capability, status: 'passed' },
    ])) as BrowserInputFidelityProductAcceptanceEvidence['capabilities'],
  };

	  const validation = validateBrowserInputFidelityProductAcceptance(forged);
	  assert.equal(validation.canClaimPass, false);
	  assert.ok(validation.blockers.includes('real-os-ui-audit-proof-required'));
	  assert.ok(validation.blockers.includes('ime-real-composition-proof-required'));
  assert.ok(validation.blockers.includes('clipboard-round-trip-proof-required'));
  assert.ok(validation.blockers.includes('selection-range-proof-required'));
});

test('Browser input fidelity contract rejects pass outside native embedded BrowserHostSession truth', () => {
  const cases: Array<{ label: string; evidence: BrowserInputFidelityProductAcceptanceEvidence }> = [
    {
      label: 'host-stream-transport',
      evidence: forgedP1Envelope({ liveSurfaceTransport: 'host-stream' }),
    },
    {
      label: 'non-browser-host-owner',
      evidence: forgedP1Envelope({ owner: 'LegacyInputWorker' }),
    },
    {
      label: 'not-single-interactive-truth',
      evidence: forgedP1Envelope({ singleInteractiveTruth: false }),
    },
    {
      label: 'second-truth-source',
      evidence: forgedP1Envelope({ secondTruthSource: true }),
    },
    {
      label: 'shell-composer-input-channel',
      evidence: forgedP1Envelope({ inputChannel: 'shell-composer' }),
    },
    {
      label: 'native-pass-with-frame-stream',
      evidence: forgedP1Envelope({
        osUiRun: {
          ...boundedPassedInputFidelityEvidence().osUiRun!,
          frameStreamRef: 'browser-host-session:input-fidelity-os-ui/frame-stream',
        },
      }),
    },
  ];

  for (const { label, evidence } of cases) {
    const validation = validateBrowserInputFidelityProductAcceptance(evidence);
    assert.equal(validation.canClaimPass, false, `${label} must not pass`);
    assert.ok(
      validation.blockers.includes('browser-host-session-native-embedded-single-truth-required'),
      `${label} should require BrowserHostSession native embedded single truth`,
    );
  }
});

test('Browser input fidelity contract rejects real pass proofs split across BrowserHostSession refs', () => {
  const forged = boundedPassedInputFidelityEvidence();
  forged.osUiRun!.composerAudit.composerAuditRef = 'browser-host-session:other-input-fidelity-run/composer-audit';
  forged.osUiRun!.composerAudit.browserHostSessionInputRefs = [
    'browser-host-session:other-input-fidelity-run/keyboard-actions',
    'browser-host-session:input-fidelity-os-ui/ime-actions',
    'browser-host-session:input-fidelity-os-ui/clipboard-actions',
    'browser-host-session:input-fidelity-os-ui/selection-actions',
  ];
  forged.capabilities.cursorCaret.productActionRefs = ['browser-host-session:other-input-fidelity-run/cursor-caret-actions'];

  const validation = validateBrowserInputFidelityProductAcceptance(forged);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockers.includes('real-os-ui-run-ref-cohesion-required'));
});

test('Browser input fidelity contract allows only bounded real OS UI pass evidence', () => {
  const evidence = boundedPassedInputFidelityEvidence();
  const validation = validateBrowserInputFidelityProductAcceptance(evidence);
  const text = JSON.stringify(evidence);

  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockers, []);
  assert.equal(evidence.canClaimProductInputFidelityPass, true);
  assert.equal(evidence.owner, 'BrowserHostSession');
  assert.equal(evidence.liveSurfaceTransport, 'native-embedded');
  assert.equal(evidence.singleInteractiveTruth, true);
  assert.equal(evidence.secondTruthSource, false);
  assert.equal(evidence.inputChannel, 'browser-host-session');
  assert.equal(evidence.osUiRun?.frameStreamRef, undefined);
  assert.equal(evidence.capabilities.ime.details?.kind, 'ime-composition');
  assert.equal(evidence.capabilities.clipboard.details?.kind, 'clipboard-round-trip');
  assert.equal(evidence.capabilities.selectionRange.details?.kind, 'selection-range');
  assertNoRawInputFidelityPayload(text, 'passed evidence');
  assert.doesNotMatch(text, /"(?:clipboardText|selectionText|compositionText|candidatePayload|domPayload)"\s*:/i);
  assert.deepEqual(forbiddenPayloadKeys(evidence), []);
});

function validateBrowserInputFidelityProductAcceptance(evidence: BrowserInputFidelityProductAcceptanceEvidence) {
  const capabilities = Object.values(evidence.capabilities);
  const blockers: string[] = [];
  if (evidence.schemaVersion !== SCHEMA) blockers.push('schema-version-mismatch');
  if (evidence.status !== 'passed' || evidence.source !== 'real-product-os-ui-run' || evidence.canClaimProductInputFidelityPass !== true) {
    blockers.push('real-product-os-ui-run-required');
  }
  if (!hasNativeEmbeddedBrowserHostSingleTruth(evidence)) blockers.push('browser-host-session-native-embedded-single-truth-required');
	  if (evidence.rawPayloadsCaptured !== false || forbiddenPayloadKeys(evidence).length > 0) blockers.push('raw-payloads-forbidden');
	  if (!hasValidOsUiRun(evidence)) blockers.push('real-os-ui-run-refs-required');
	  if (!hasOsUiAuditProofs(evidence)) blockers.push('real-os-ui-audit-proof-required');
	  if (!hasComposerIsolationProof(evidence)) blockers.push('shell-composer-must-not-capture-browser-input');
  if (evidence.canClaimProductInputFidelityPass === true && !hasOsUiRunRefCohesion(evidence)) blockers.push('real-os-ui-run-ref-cohesion-required');
  if (capabilities.length !== 6 || !capabilities.every((capability) => capability.status === 'passed' && capability.evidenceRefs.length > 0)) {
    blockers.push('all-capabilities-must-pass');
  }
  if (!hasImeCompositionProof(evidence.capabilities.ime)) blockers.push('ime-real-composition-proof-required');
  if (!hasClipboardRoundTripProof(evidence.capabilities.clipboard)) blockers.push('clipboard-round-trip-proof-required');
  if (!hasSelectionRangeProof(evidence.capabilities.selectionRange)) blockers.push('selection-range-proof-required');
  const canClaimPass = evidence.schemaVersion === SCHEMA
    && evidence.status === 'passed'
    && evidence.source === 'real-product-os-ui-run'
    && evidence.canClaimProductInputFidelityPass === true
    && hasNativeEmbeddedBrowserHostSingleTruth(evidence)
    && evidence.rawPayloadsCaptured === false
    && capabilities.length === 6
    && capabilities.every((capability) => capability.status === 'passed' && capability.evidenceRefs.length > 0)
    && blockers.length === 0;
  return { canClaimPass, blockers };
}

function validateBlockedInputFidelityHandoffSchema(evidence: BrowserInputFidelityProductAcceptanceEvidence): string[] {
  const blockers: string[] = [];
  const handoff = evidence.realOsUiRunHandoff;
  const runScope = browserHostRefScope(handoff.browserHostSessionRef);
  if (handoff.status !== 'blocked' || handoff.passClaim !== false) blockers.push('blocked-handoff-must-not-claim-pass');
  if (handoff.requiredRunner !== 'right-pane-native-os-ui-run') blockers.push('blocked-handoff-runner-required');
  if (handoff.productSurface !== 'right-pane-browser') blockers.push('blocked-handoff-product-surface-required');
  if (handoff.owner !== 'BrowserHostSession' || handoff.inputChannel !== 'browser-host-session') blockers.push('blocked-handoff-browser-host-owner-required');
  if (handoff.liveSurfaceTransport !== 'native-embedded') blockers.push('blocked-handoff-native-embedded-required');
  if (!runScope || !browserHostRefBelongsToScope(handoff.liveSurfaceRef, runScope)) blockers.push('blocked-handoff-ref-scope-required');
  if (!runScope || !browserHostRefBelongsToScope(handoff.handoffRef, runScope)) blockers.push('blocked-handoff-ref-required');
  if (handoff.auditRefs.length < 4 || !handoff.auditRefs.every((ref) => browserHostRefBelongsToScope(ref, runScope ?? ''))) {
    blockers.push('blocked-handoff-audit-refs-required');
  }
  if (handoff.rawPayloadsCaptured !== false || handoff.refsFirst !== true) blockers.push('blocked-handoff-refs-first-required');

  const requiredProofs = [
    ...handoff.requiredProofs,
    ...Object.values(evidence.capabilities).flatMap((capability) => capability.requiredProofs ?? []),
  ];
  const proofKinds = new Set(requiredProofs.map((proof) => proof.kind));
  for (const kind of [
    'cursor-caret-parity',
    'mouse-owner-contract',
    'keyboard-editing-owner',
    'ime-candidate-window-owner',
    'clipboard-confirmation-audit',
    'selection-range-length-hash',
    'modifier-click-tab-owner-or-handoff',
  ]) {
    if (!proofKinds.has(kind)) blockers.push(`blocked-required-proof-missing:${kind}`);
  }
  for (const proof of requiredProofs) {
    if (proof.status !== 'blocked') blockers.push(`blocked-required-proof-must-be-blocked:${proof.kind}`);
    if (proof.owner !== 'BrowserHostSession' || proof.productSurface !== 'right-pane-browser') blockers.push(`blocked-required-proof-owner-required:${proof.kind}`);
    if (!browserHostRefBelongsToScope(proof.browserHostSessionRef, runScope ?? '')) blockers.push(`blocked-required-proof-session-scope-required:${proof.kind}`);
    if (!browserHostRefBelongsToScope(proof.liveSurfaceRef, runScope ?? '')) blockers.push(`blocked-required-proof-live-surface-scope-required:${proof.kind}`);
    for (const ref of [proof.proofRef, proof.auditRef, proof.actionRef, proof.rangeRef, proof.confirmationAuditRef, proof.roundTripRef].filter((ref): ref is string => typeof ref === 'string')) {
      if (!browserHostRefBelongsToScope(ref, runScope ?? '')) blockers.push(`blocked-required-proof-ref-scope-required:${proof.kind}`);
    }
    if (proof.rawPayloadRecorded !== false || proof.shellComposerTarget !== 'not-targeted') blockers.push(`blocked-required-proof-refs-first-required:${proof.kind}`);
  }
  return [...new Set(blockers)].sort();
}

function hasNativeEmbeddedBrowserHostSingleTruth(evidence: BrowserInputFidelityProductAcceptanceEvidence): boolean {
  return evidence.owner === 'BrowserHostSession'
    && evidence.liveSurfaceTransport === 'native-embedded'
    && evidence.singleInteractiveTruth === true
    && evidence.secondTruthSource === false
    && evidence.inputChannel === 'browser-host-session'
    && evidence.refsFirst === true
    && evidence.osUiRun?.frameStreamRef === undefined;
}

function allEvidenceRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(allEvidenceRefs);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (key === 'evidenceRefs' && Array.isArray(item)) return item.filter((ref): ref is string => typeof ref === 'string');
    return allEvidenceRefs(item);
  });
}

function forbiddenPayloadKeys(value: unknown): string[] {
  const forbidden = new Set([
    'base64',
    'clipboardText',
    'clipboardPayload',
    'clipboardHtml',
    'selectionText',
    'selectionPayload',
    'compositionText',
    'compositionPayload',
    'typedText',
    'typedPayload',
    'domPayload',
    'domSnapshotPayload',
    'rawDom',
    'rawHtml',
    'rawClipboard',
    'rawSelection',
    'rawComposition',
  ]);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(forbiddenPayloadKeys);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(forbidden.has(key) ? [key] : []),
    ...forbiddenPayloadKeys(item),
  ]);
}

function assertNoRawInputFidelityPayload(text: string, label: string): void {
  assert.doesNotMatch(text, /data:image|base64/i, `${label} must not include base64 payloads`);
  assert.doesNotMatch(text, /<\s*(?:!doctype|html|body|input|textarea|iframe|webview)\b/i, `${label} must not include captured DOM`);
  assert.doesNotMatch(
    text,
    /"(?:clipboardText|clipboardPayload|clipboardHtml|selectionText|selectionPayload|compositionText|compositionPayload|typedText|typedPayload|candidatePayload|domPayload|domSnapshotPayload|rawDom|rawHtml|rawClipboard|rawSelection|rawComposition|base64)"\s*:/i,
    `${label} must not include raw input fidelity payload keys`,
  );
}

function assertNoRawInputFidelityManifestPayload(text: string, label: string): void {
  assertNoRawInputFidelityPayload(text, label);
  assert.doesNotMatch(
    text,
    /"raw(?:Dom|Clipboard|Selection|Composition|TypedText)[^"]*"\s*:/i,
    `${label} must not record raw clipboard/selection/DOM manifest fields`,
  );
}

function boundedInputFidelityManifest(value: unknown): unknown {
  return omitManifestRawPayloadFields(value);
}

function omitManifestRawPayloadFields(value: unknown): unknown {
  const rawPayloadPolicyKeys = new Set([
    'rawDomRecorded',
    'rawTypedTextRecorded',
    'rawCompositionPayloadRecorded',
    'rawClipboardPayloadRecorded',
    'rawSelectionTextRecorded',
    'rawPayloadRecorded',
  ]);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(omitManifestRawPayloadFields);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !rawPayloadPolicyKeys.has(key))
      .map(([key, item]) => [key, omitManifestRawPayloadFields(item)]),
  );
}

function forgedP1Envelope(overrides: Record<string, unknown>): BrowserInputFidelityProductAcceptanceEvidence {
  return {
    ...boundedPassedInputFidelityEvidence(),
    ...overrides,
  } as unknown as BrowserInputFidelityProductAcceptanceEvidence;
}

function blockedInputFidelityEvidence(): BrowserInputFidelityProductAcceptanceEvidence {
  const scope = 'browser-host-session:input-fidelity-product-contract';
  const sessionRef = `${scope}/session`;
  const liveSurfaceRef = `${scope}/live-surface`;
  return {
    schemaVersion: SCHEMA,
    status: 'blocked',
    source: 'contract-only-fixture-no-real-os-ui-run',
    canClaimProductInputFidelityPass: false,
    owner: 'BrowserHostSession',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    inputChannel: 'browser-host-session',
    rawPayloadsCaptured: false,
    refsFirst: true,
    realOsUiRunHandoff: {
      status: 'blocked',
      passClaim: false,
      blocker: 'real-product-os-ui-run-not-executed',
      requiredRunner: 'right-pane-native-os-ui-run',
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
      inputChannel: 'browser-host-session',
      liveSurfaceTransport: 'native-embedded',
      browserHostSessionRef: sessionRef,
      liveSurfaceRef,
      handoffRef: `${scope}/os-ui-handoff/input-fidelity`,
      auditRefs: [
        `${scope}/audit/window-focus-owner`,
        `${scope}/audit/ime-candidate-window-owner`,
        `${scope}/audit/system-clipboard-owner`,
        `${scope}/audit/selection-range-owner`,
        `${scope}/audit/shell-composer-not-targeted`,
      ],
      requiredProofs: [
        inputFidelityRequiredProof('cursor-caret-parity', scope),
        inputFidelityRequiredProof('mouse-owner-contract', scope),
        inputFidelityRequiredProof('keyboard-editing-owner', scope),
        inputFidelityRequiredProof('ime-candidate-window-owner', scope),
        inputFidelityRequiredProof('clipboard-confirmation-audit', scope, {
          auditRef: `${scope}/audit/system-clipboard-owner`,
          payloadPolicy: 'length-and-hash-only',
        }),
        inputFidelityRequiredProof('selection-range-length-hash', scope, {
          auditRef: `${scope}/audit/selection-range-owner`,
          payloadPolicy: 'length-and-hash-only',
        }),
      ],
      rawPayloadsCaptured: false,
      refsFirst: true,
    },
    capabilities: {
      cursorCaret: {
        status: 'blocked',
        required: ['pointer', 'text-cursor', 'default-cursor', 'input-caret', 'contenteditable-caret'],
        evidenceRefs: [`${scope}/cursor-caret`],
        handoffRef: `${scope}/os-ui-handoff/cursor-caret`,
        requiredProofs: [
          inputFidelityRequiredProof('cursor-caret-parity', scope, { auditRef: `${scope}/audit/cursor-caret-owner` }),
        ],
        rawDomRecorded: false,
      },
      mouse: {
        status: 'blocked',
        required: ['left-click', 'right-click', 'middle-click', 'modifier-click tab owner/handoff', 'double-click', 'drag-drop', 'text-selection', 'wheel', 'scrollbar-thumb-drag'],
        evidenceRefs: [`${scope}/mouse`],
        handoffRef: `${scope}/os-ui-handoff/mouse-owner-contract`,
        requiredProofs: [
          inputFidelityRequiredProof('middle-click-tab-owner-or-handoff', scope, {
            auditRef: `${scope}/audit/middle-click-tab-owner-or-handoff`,
          }),
          inputFidelityRequiredProof('modifier-click-tab-owner-or-handoff', scope, {
            auditRef: `${scope}/audit/modifier-click-tab-owner-or-handoff`,
          }),
        ],
        rawDomRecorded: false,
      },
      keyboard: {
        status: 'blocked',
        required: ['type', 'Backspace', 'Delete', 'Enter', 'Tab', 'arrows', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'CmdOrCtrl+A/C/V/X'],
        shellComposerCapturedCharacters: 0,
        evidenceRefs: [`${scope}/keyboard`],
        handoffRef: `${scope}/os-ui-handoff/keyboard-owner`,
        requiredProofs: [
          inputFidelityRequiredProof('keyboard-editing-owner', scope, { auditRef: `${scope}/audit/keyboard-focus-owner` }),
        ],
        rawTypedTextRecorded: false,
      },
      ime: {
        status: 'blocked',
        required: ['candidate-window', 'compositionstart', 'compositionupdate', 'compositionend', 'candidate-selection'],
        evidenceRefs: [`${scope}/ime`],
        handoffRef: `${scope}/os-ui-handoff/ime`,
        requiredProofs: [
          inputFidelityRequiredProof('ime-candidate-window-owner', scope, { auditRef: `${scope}/audit/ime-candidate-window-owner` }),
        ],
        rawCompositionPayloadRecorded: false,
        details: {
          kind: 'ime-composition',
          realImeCandidateWindowVerified: false,
          compositionEvents: [],
        },
      },
      clipboard: {
        status: 'blocked',
        required: ['copy-round-trip', 'paste-round-trip', 'cut-policy', 'high-risk-write-confirmation'],
        systemClipboardRoundTripVerified: false,
        evidenceRefs: [`${scope}/clipboard`],
        handoffRef: `${scope}/os-ui-handoff/clipboard`,
        auditRefs: [
          `${scope}/audit/clipboard-copy-confirmation`,
          `${scope}/audit/clipboard-paste-confirmation`,
          `${scope}/audit/clipboard-cut-confirmation`,
        ],
        requiredProofs: ['copy', 'paste', 'cut'].map((operation) => inputFidelityRequiredProof('clipboard-confirmation-audit', scope, {
          actionRef: `${scope}/clipboard/${operation}/action`,
          confirmationAuditRef: `${scope}/clipboard/${operation}/confirmation-audit`,
          roundTripRef: `${scope}/clipboard/${operation}/round-trip-required`,
          payloadPolicy: 'length-and-hash-only',
        })),
        rawClipboardPayloadRecorded: false,
        details: {
          kind: 'clipboard-round-trip',
          systemClipboardRoundTripVerified: false,
          highRiskWriteConfirmation: 'required-not-observed',
          operations: [],
        },
      },
      selectionRange: {
        status: 'blocked',
        required: ['input-selection', 'contenteditable-selection', 'page-text-selection'],
        evidenceRefs: [`${scope}/selection-range`],
        handoffRef: `${scope}/os-ui-handoff/selection-range`,
        auditRefs: [
          `${scope}/audit/input-selection-range`,
          `${scope}/audit/contenteditable-selection-range`,
          `${scope}/audit/page-text-selection-range`,
        ],
        requiredProofs: (['input', 'contenteditable', 'page-text'] as const).map((target) => inputFidelityRequiredProof('selection-range-length-hash', scope, {
          rangeRef: `${scope}/selection/${target}/range`,
          auditRef: `${scope}/audit/${target}-selection-range`,
          payloadPolicy: 'length-and-hash-only',
        })),
        selectedLengthOnly: true,
        selectedHashOnly: true,
        rawSelectionTextRecorded: false,
        rawDomRecorded: false,
        details: {
          kind: 'selection-range',
          targets: [],
          ranges: [],
        },
      },
    },
    blocker: 'real-product-os-ui-run-not-executed',
  };
}

function boundedPassedInputFidelityEvidence(): BrowserInputFidelityProductAcceptanceEvidence {
  const base = blockedInputFidelityEvidence();
  return {
    ...base,
    status: 'passed',
    source: 'real-product-os-ui-run',
    canClaimProductInputFidelityPass: true,
    liveSurfaceTransport: 'native-embedded',
    blocker: undefined,
    osUiRun: {
      runId: 'input-fidelity-os-ui-20260602T000000Z',
      platform: 'macos',
      productSurface: 'right-pane-browser',
      startedAt: '2026-06-02T00:00:00.000Z',
      completedAt: '2026-06-02T00:03:00.000Z',
      browserHostSessionRef: 'browser-host-session:input-fidelity-os-ui/session',
      liveSurfaceRef: 'browser-host-session:input-fidelity-os-ui/live-surface',
	      auditRefs: [
	        'browser-host-session:input-fidelity-os-ui/ime-audit',
	        'browser-host-session:input-fidelity-os-ui/clipboard-audit',
	        'browser-host-session:input-fidelity-os-ui/selection-audit',
	        'browser-host-session:input-fidelity-os-ui/window-focus-audit',
	      ],
	      auditProofs: [
	        boundedOsUiAuditProof('window-focus-owner'),
	        boundedOsUiAuditProof('ime-candidate-window-owner'),
	        boundedOsUiAuditProof('system-clipboard-owner'),
	        boundedOsUiAuditProof('selection-range-owner'),
	      ],
	      composerAudit: {
        shellComposerCapturedCharacters: 0,
        shellComposerTargetedActions: 0,
        browserHostSessionInputRefs: [
          'browser-host-session:input-fidelity-os-ui/keyboard-actions',
          'browser-host-session:input-fidelity-os-ui/ime-actions',
          'browser-host-session:input-fidelity-os-ui/clipboard-actions',
          'browser-host-session:input-fidelity-os-ui/selection-actions',
        ],
        composerAuditRef: 'browser-host-session:input-fidelity-os-ui/composer-audit',
      },
    },
    capabilities: {
      ...base.capabilities,
      cursorCaret: {
        ...base.capabilities.cursorCaret,
        status: 'passed',
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/cursor-caret-actions'],
        boundedLatencyMs: [12, 18, 14],
      },
      mouse: {
        ...base.capabilities.mouse,
        status: 'passed',
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/mouse-actions'],
        boundedLatencyMs: [16, 24, 22],
      },
      keyboard: {
        ...base.capabilities.keyboard,
        status: 'passed',
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/keyboard-actions'],
        boundedLatencyMs: [8, 11, 10],
      },
      ime: {
        ...base.capabilities.ime,
        status: 'passed',
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/ime-actions'],
        boundedLatencyMs: [21, 28, 19],
        details: {
          kind: 'ime-composition',
          realImeCandidateWindowVerified: true,
          candidateWindowEvidenceRef: 'browser-host-session:input-fidelity-os-ui/ime-candidate-window',
          compositionEvents: [
            boundedCompositionEvent('compositionstart', 'browser-host-session:input-fidelity-os-ui/ime/compositionstart'),
            boundedCompositionEvent('compositionupdate', 'browser-host-session:input-fidelity-os-ui/ime/compositionupdate'),
            {
              ...boundedCompositionEvent('compositionend', 'browser-host-session:input-fidelity-os-ui/ime/compositionend'),
              committedTextLength: 2,
              committedTextHashSha256: 'b4c7f0e62ac7fda8f7f2f129a6e13fbcf1f9e7e93d6a0a56b2845d3fd468c1aa',
            },
          ],
        },
      },
      clipboard: {
        ...base.capabilities.clipboard,
        status: 'passed',
        systemClipboardRoundTripVerified: true,
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/clipboard-actions'],
        boundedLatencyMs: [18, 29, 24],
        details: {
          kind: 'clipboard-round-trip',
          systemClipboardRoundTripVerified: true,
          highRiskWriteConfirmation: 'required-and-observed',
          operations: [
            boundedClipboardOperation('copy', 'browser-host-session:input-fidelity-os-ui/clipboard/copy'),
            boundedClipboardOperation('paste', 'browser-host-session:input-fidelity-os-ui/clipboard/paste'),
            boundedClipboardOperation('cut', 'browser-host-session:input-fidelity-os-ui/clipboard/cut'),
          ],
        },
      },
      selectionRange: {
        ...base.capabilities.selectionRange,
        status: 'passed',
        productActionRefs: ['browser-host-session:input-fidelity-os-ui/selection-actions'],
        boundedLatencyMs: [14, 18, 17],
        details: {
          kind: 'selection-range',
          targets: ['input', 'contenteditable', 'page-text'],
          ranges: [
            boundedSelectionRange('input', 'browser-host-session:input-fidelity-os-ui/selection/input'),
            boundedSelectionRange('contenteditable', 'browser-host-session:input-fidelity-os-ui/selection/contenteditable'),
            boundedSelectionRange('page-text', 'browser-host-session:input-fidelity-os-ui/selection/page-text'),
          ],
        },
      },
    },
  };
}

function boundedCompositionEvent(
  phase: 'compositionstart' | 'compositionupdate' | 'compositionend',
  eventRef: string,
): Extract<BrowserInputFidelityCapabilityDetails, { kind: 'ime-composition' }>['compositionEvents'][number] {
  return {
    phase,
    owner: 'BrowserHostSession',
    eventRef,
    rawCompositionPayloadRecorded: false,
    shellComposerTarget: 'not-targeted',
  };
}

function boundedClipboardOperation(
  operation: 'copy' | 'paste' | 'cut',
  actionRef: string,
): Extract<BrowserInputFidelityCapabilityDetails, { kind: 'clipboard-round-trip' }>['operations'][number] {
  return {
    operation,
    owner: 'BrowserHostSession',
    actionRef,
    roundTripRef: `${actionRef}/round-trip`,
    payloadLength: 18,
    payloadHashSha256: 'f3abf8c1d3a7b5e6f9c0a2d4e8b1c3f5a7d9e0b2c4f6a8d1e3b5c7a9d0e2f4b6',
    rawClipboardPayloadRecorded: false,
    shellComposerTarget: 'not-targeted',
  };
}

function boundedSelectionRange(
  target: 'input' | 'contenteditable' | 'page-text',
  rangeRef: string,
): Extract<BrowserInputFidelityCapabilityDetails, { kind: 'selection-range' }>['ranges'][number] {
  return {
    target,
    owner: 'BrowserHostSession',
    rangeRef,
    selectedLength: 12,
    selectedHashSha256: 'd1e2f3a4b5c60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    rawSelectionTextRecorded: false,
    rawDomRecorded: false,
	  };
	}

function inputFidelityRequiredProof(
  kind: string,
  scope: string,
  extra: Partial<BrowserInputFidelityRequiredProof> = {},
): BrowserInputFidelityRequiredProof {
  return {
    kind,
    status: 'blocked',
    owner: 'BrowserHostSession',
    productSurface: 'right-pane-browser',
    browserHostSessionRef: `${scope}/session`,
    liveSurfaceRef: `${scope}/live-surface`,
    proofRef: `${scope}/required-proof/${kind}`,
    rawPayloadRecorded: false,
    shellComposerTarget: 'not-targeted',
    blocker: 'real-product-os-ui-run-not-executed',
    ...extra,
  };
}

function boundedOsUiAuditProof(kind: BrowserInputFidelityOsUiAuditProof['kind']): BrowserInputFidelityOsUiAuditProof {
  return {
    kind,
    owner: 'BrowserHostSession',
    auditRef: `browser-host-session:input-fidelity-os-ui/audit/${kind}`,
    browserHostSessionRef: 'browser-host-session:input-fidelity-os-ui/session',
    liveSurfaceRef: 'browser-host-session:input-fidelity-os-ui/live-surface',
    rawPayloadRecorded: false,
    shellComposerTarget: 'not-targeted',
  };
}

function hasValidOsUiRun(evidence: BrowserInputFidelityProductAcceptanceEvidence): boolean {
  const run = evidence.osUiRun;
  return Boolean(
    run
      && run.runId.length > 0
      && run.productSurface === 'right-pane-browser'
      && run.browserHostSessionRef.startsWith('browser-host-session:')
	      && run.liveSurfaceRef.startsWith('browser-host-session:')
	      && run.auditRefs.length >= 3
	      && run.auditRefs.every((ref) => ref.startsWith('browser-host-session:')),
	  );
	}

function hasOsUiAuditProofs(evidence: BrowserInputFidelityProductAcceptanceEvidence): boolean {
  const run = evidence.osUiRun;
  if (!run || !hasValidOsUiRun(evidence)) return false;
  const requiredKinds: BrowserInputFidelityOsUiAuditProof['kind'][] = [
    'window-focus-owner',
    'ime-candidate-window-owner',
    'system-clipboard-owner',
    'selection-range-owner',
  ];
  const proofs = Array.isArray(run.auditProofs) ? run.auditProofs : [];
  const kinds = new Set(proofs.map((proof) => proof.kind));
  return requiredKinds.every((kind) => kinds.has(kind))
    && proofs.every((proof) => (
      proof.owner === 'BrowserHostSession'
        && proof.auditRef.startsWith('browser-host-session:')
        && proof.browserHostSessionRef === run.browserHostSessionRef
        && proof.liveSurfaceRef === run.liveSurfaceRef
        && proof.rawPayloadRecorded === false
        && proof.shellComposerTarget === 'not-targeted'
    ));
}

function hasComposerIsolationProof(evidence: BrowserInputFidelityProductAcceptanceEvidence): boolean {
  const audit = evidence.osUiRun?.composerAudit;
  return Boolean(
    audit
      && audit.shellComposerCapturedCharacters === 0
      && audit.shellComposerTargetedActions === 0
      && audit.composerAuditRef.startsWith('browser-host-session:')
      && audit.browserHostSessionInputRefs.length >= 4
      && audit.browserHostSessionInputRefs.every((ref) => ref.startsWith('browser-host-session:')),
  );
}

function hasOsUiRunRefCohesion(evidence: BrowserInputFidelityProductAcceptanceEvidence): boolean {
  const run = evidence.osUiRun;
  const runScope = browserHostRefScope(run?.browserHostSessionRef);
  if (!run || !runScope || !browserHostRefBelongsToScope(run.liveSurfaceRef, runScope)) return false;
  const runScopedRefs = [
    run.frameStreamRef,
    ...run.auditRefs,
    ...run.auditProofs.flatMap((proof) => [proof.auditRef, proof.browserHostSessionRef, proof.liveSurfaceRef]),
    run.composerAudit.composerAuditRef,
    ...run.composerAudit.browserHostSessionInputRefs,
    ...Object.values(evidence.capabilities).flatMap((capability) => capability.productActionRefs ?? []),
    ...capabilityDetailRefs(evidence.capabilities.ime),
    ...capabilityDetailRefs(evidence.capabilities.clipboard),
    ...capabilityDetailRefs(evidence.capabilities.selectionRange),
  ].filter((ref): ref is string => typeof ref === 'string');
  return runScopedRefs.length > 0 && runScopedRefs.every((ref) => browserHostRefBelongsToScope(ref, runScope));
}

function capabilityDetailRefs(capability: BrowserInputFidelityCapability): string[] {
  const details = capability.details;
  if (details?.kind === 'ime-composition') {
    return [
      details.candidateWindowEvidenceRef,
      ...details.compositionEvents.map((event) => event.eventRef),
    ].filter((ref): ref is string => typeof ref === 'string');
  }
  if (details?.kind === 'clipboard-round-trip') {
    return details.operations.flatMap((operation) => [
      operation.actionRef,
      operation.roundTripRef,
    ]).filter((ref): ref is string => typeof ref === 'string');
  }
  if (details?.kind === 'selection-range') {
    return details.ranges.map((range) => range.rangeRef);
  }
  return [];
}

function browserHostRefScope(ref: string | undefined): string | undefined {
  if (!ref?.startsWith('browser-host-session:')) return undefined;
  const slash = ref.lastIndexOf('/');
  return slash > 'browser-host-session:'.length ? ref.slice(0, slash) : undefined;
}

function browserHostRefBelongsToScope(ref: string | undefined, scope: string): boolean {
  return typeof ref === 'string' && (ref === scope || ref.startsWith(`${scope}/`));
}

function hasImeCompositionProof(capability: BrowserInputFidelityCapability): boolean {
  const details = capability.details;
  if (details?.kind !== 'ime-composition') return false;
  const phases = new Set(details.compositionEvents.map((event) => event.phase));
  return capability.status === 'passed'
    && details.realImeCandidateWindowVerified === true
    && Boolean(details.candidateWindowEvidenceRef?.startsWith('browser-host-session:'))
    && phases.has('compositionstart')
    && phases.has('compositionupdate')
    && phases.has('compositionend')
    && details.compositionEvents.every((event) => (
      event.owner === 'BrowserHostSession'
        && event.eventRef.startsWith('browser-host-session:')
        && event.rawCompositionPayloadRecorded === false
        && event.shellComposerTarget === 'not-targeted'
    ));
}

function hasClipboardRoundTripProof(capability: BrowserInputFidelityCapability): boolean {
  const details = capability.details;
  if (details?.kind !== 'clipboard-round-trip') return false;
  const operations = new Set(details.operations.map((event) => event.operation));
  return capability.status === 'passed'
    && capability.systemClipboardRoundTripVerified === true
    && details.systemClipboardRoundTripVerified === true
    && details.highRiskWriteConfirmation === 'required-and-observed'
    && operations.has('copy')
    && operations.has('paste')
    && operations.has('cut')
    && details.operations.every((event) => (
      event.owner === 'BrowserHostSession'
        && event.actionRef.startsWith('browser-host-session:')
        && Boolean(event.roundTripRef?.startsWith('browser-host-session:'))
        && event.payloadLength > 0
        && isSha256(event.payloadHashSha256)
        && event.rawClipboardPayloadRecorded === false
        && event.shellComposerTarget === 'not-targeted'
    ));
}

function hasSelectionRangeProof(capability: BrowserInputFidelityCapability): boolean {
  const details = capability.details;
  if (details?.kind !== 'selection-range') return false;
  const targets = new Set(details.targets);
  return capability.status === 'passed'
    && capability.selectedLengthOnly === true
    && capability.selectedHashOnly === true
    && targets.has('input')
    && targets.has('contenteditable')
    && targets.has('page-text')
    && details.ranges.length >= 3
    && details.ranges.every((range) => (
      range.owner === 'BrowserHostSession'
        && range.rangeRef.startsWith('browser-host-session:')
        && range.selectedLength > 0
        && isSha256(range.selectedHashSha256)
        && range.rawSelectionTextRecorded === false
        && range.rawDomRecorded === false
    ));
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
