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
  assert.equal(evidence.singleInteractiveTruth, true);
  assert.equal(evidence.secondTruthSource, false);
  assert.equal(evidence.rawPayloadsCaptured, false);

  const text = JSON.stringify(evidence);
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:html|body|input|textarea|iframe|webview)\b/i);
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

  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify({
    ...evidence,
    validation,
    generatedAt: '2026-06-02T00:00:00.000Z',
  }, null, 2)}\n`);
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
  assert.equal(evidence.capabilities.ime.details?.kind, 'ime-composition');
  assert.equal(evidence.capabilities.clipboard.details?.kind, 'clipboard-round-trip');
  assert.equal(evidence.capabilities.selectionRange.details?.kind, 'selection-range');
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:!doctype|html|body|input|textarea|iframe|webview)\b/i);
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
  if (evidence.owner !== 'BrowserHostSession' || evidence.singleInteractiveTruth !== true || evidence.secondTruthSource !== false) {
    blockers.push('browser-host-session-single-owner-required');
  }
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
    && evidence.owner === 'BrowserHostSession'
    && evidence.singleInteractiveTruth === true
    && evidence.secondTruthSource === false
    && evidence.rawPayloadsCaptured === false
    && capabilities.length === 6
    && capabilities.every((capability) => capability.status === 'passed' && capability.evidenceRefs.length > 0)
    && blockers.length === 0;
  return { canClaimPass, blockers };
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
    'clipboardText',
    'clipboardPayload',
    'selectionText',
    'selectionPayload',
    'compositionText',
    'compositionPayload',
    'typedText',
    'typedPayload',
    'domPayload',
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

function blockedInputFidelityEvidence(): BrowserInputFidelityProductAcceptanceEvidence {
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
    capabilities: {
      cursorCaret: {
        status: 'blocked',
        required: ['pointer', 'text-cursor', 'default-cursor', 'input-caret', 'contenteditable-caret'],
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/cursor-caret'],
        rawDomRecorded: false,
      },
      mouse: {
        status: 'blocked',
        required: ['left-click', 'right-click', 'middle-click', 'double-click', 'drag-drop', 'text-selection', 'wheel', 'scrollbar-thumb-drag'],
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/mouse'],
        rawDomRecorded: false,
      },
      keyboard: {
        status: 'blocked',
        required: ['type', 'Backspace', 'Delete', 'Enter', 'Tab', 'arrows', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'CmdOrCtrl+A/C/V/X'],
        shellComposerCapturedCharacters: 0,
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/keyboard'],
        rawTypedTextRecorded: false,
      },
      ime: {
        status: 'blocked',
        required: ['candidate-window', 'compositionstart', 'compositionupdate', 'compositionend', 'candidate-selection'],
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/ime'],
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
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/clipboard'],
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
        evidenceRefs: ['browser-host-session:input-fidelity-product-contract/selection-range'],
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
    liveSurfaceTransport: 'host-stream',
    blocker: undefined,
    osUiRun: {
      runId: 'input-fidelity-os-ui-20260602T000000Z',
      platform: 'macos',
      productSurface: 'right-pane-browser',
      startedAt: '2026-06-02T00:00:00.000Z',
      completedAt: '2026-06-02T00:03:00.000Z',
      browserHostSessionRef: 'browser-host-session:input-fidelity-os-ui/session',
      liveSurfaceRef: 'browser-host-session:input-fidelity-os-ui/live-surface',
      frameStreamRef: 'browser-host-session:input-fidelity-os-ui/frame-stream',
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
