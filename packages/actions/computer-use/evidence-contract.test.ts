import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildComputerUseMutatingActionLedgerRecord,
  buildComputerUseLocalControllerBrief,
  buildComputerUseObservationSnapshot,
  computeComputerUseMutatingActionInvalidation,
  computerUseEvidenceCostTiers,
  decideComputerUseActionBatchPolicy,
  rankComputerUseEvidenceEntries,
  validateComputerUseEvidenceLedgerEntry,
  type ComputerUseEvidenceCostTier,
  type ComputerUseEvidenceLedgerEntry,
} from './evidence-contract.js';

const context = {
  owner: 'owner:agent-host',
  sessionRef: 'session:current',
  targetRef: 'target:primary',
  nowMs: 1_000,
} as const;

function evidence(overrides: Partial<ComputerUseEvidenceLedgerEntry>): ComputerUseEvidenceLedgerEntry {
  return {
    schemaVersion: 'sciforge.computer-use.evidence-entry.v1',
    ref: 'evidence:default',
    owner: context.owner,
    sessionRef: context.sessionRef,
    targetRef: context.targetRef,
    costTier: 'T1',
    scope: {
      kind: 'target',
      targetRef: context.targetRef,
    },
    freshness: {
      observedAtMs: 900,
    },
    confidence: 0.8,
    source: {
      kind: 'structured',
      exact: true,
    },
    supports: ['text'],
    facts: {},
    ...overrides,
  };
}

test('Computer Use evidence entries reject forbidden UI, fixture, replay, raw, base64, and secret refs', () => {
  const forbiddenRefs = [
    'ui:panel/current',
    'fixture:scenario/current',
    'replay:previous-run/frame',
    'raw:screenshot-inline-bytes',
    'base64:iVBORw0KGgo=',
    'evidence:data:image/png;base64,iVBORw0KGgo=',
    'secret:provider-token',
  ];

  for (const ref of forbiddenRefs) {
    const entry = evidence({ ref });
    assert.match(validateComputerUseEvidenceLedgerEntry(entry).join('; '), /forbidden evidence ref/);
    assert.throws(
      () =>
        buildComputerUseObservationSnapshot({
          entries: [entry],
          context,
          purposes: ['text'],
        }),
      /forbidden evidence ref/,
    );
  }
});

test('Computer Use evidence cost tiers define T0 through T5 and rank by cost when scope and freshness tie', () => {
  assert.deepEqual(Object.keys(computerUseEvidenceCostTiers), ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
  assert.deepEqual(
    Object.values(computerUseEvidenceCostTiers).map((tier) => tier.rank),
    [0, 1, 2, 3, 4, 5],
  );

  const entries = (['T5', 'T4', 'T3', 'T2', 'T1', 'T0'] as ComputerUseEvidenceCostTier[]).map((costTier) =>
    evidence({
      ref: `evidence:${costTier}`,
      costTier,
      supports: ['metadata'],
      freshness: { observedAtMs: 900 },
      confidence: 0.8,
      source: { kind: 'metadata' },
      facts: { metadata: costTier },
    }),
  );

  const ranked = rankComputerUseEvidenceEntries(entries, {
    purpose: 'metadata',
    context,
  });

  assert.deepEqual(
    ranked.map((rankedEntry) => rankedEntry.entry.costTier),
    ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'],
  );
  assert.ok(ranked[0].reasonCodes.includes('cost-tier.T0'));
});

test('Computer Use observation registration records cost tier upgrade metadata without embedding payloads', () => {
  const entry = evidence({
    ref: 'evidence:visible-vision-upgrade',
    costTier: 'T4',
    supports: ['visible'],
    source: { kind: 'vision', modelRole: 'translators.vision' },
    facts: { visible: true },
    observation: {
      costTierRegistration: {
        tier: 'T4',
        fromTier: 'T2',
        upgradeReason: 'target-local crop was uncertain',
        latencyMs: 138,
        modelCallCount: 1,
        reasonCodes: ['uncertainty.requires-vision'],
      },
    },
  });

  assert.deepEqual(validateComputerUseEvidenceLedgerEntry(entry), []);

  const snapshot = buildComputerUseObservationSnapshot({
    entries: [entry],
    context,
    purposes: ['visible'],
  });

  assert.equal(snapshot.selectedEvidence.visible?.entry.ref, 'evidence:visible-vision-upgrade');
  assert.deepEqual(snapshot.selectedEvidence.visible?.entry.observation?.costTierRegistration, {
    tier: 'T4',
    fromTier: 'T2',
    upgradeReason: 'target-local crop was uncertain',
    latencyMs: 138,
    modelCallCount: 1,
    reasonCodes: ['uncertainty.requires-vision'],
  });

  assert.match(
    validateComputerUseEvidenceLedgerEntry(
      evidence({
        ref: 'evidence:mismatched-tier-metadata',
        costTier: 'T2',
        observation: {
          costTierRegistration: {
            tier: 'T4',
            latencyMs: 1,
            modelCallCount: 0,
          },
        },
      }),
    ).join('; '),
    /cost tier registration must match entry cost tier/,
  );
});

test('Computer Use target and window refs default observations to local scope and full-screen requires a reason', () => {
  const localContext = {
    ...context,
    windowRef: 'window:active',
  };

  const snapshot = buildComputerUseObservationSnapshot({
    context: localContext,
    purposes: ['text', 'visible'],
    entries: [
      evidence({
        ref: 'evidence:target-local-text',
        scope: { kind: 'target' },
        supports: ['text'],
        facts: { text: 'local target label' },
      }),
      evidence({
        ref: 'evidence:window-local-visibility',
        costTier: 'T3',
        scope: { kind: 'window' },
        supports: ['visible'],
        source: { kind: 'pixel', visiblePixels: true },
        facts: { visible: true },
      }),
    ],
  });

  assert.equal(snapshot.selectedEvidence.text?.entry.scope.targetRef, localContext.targetRef);
  assert.equal(snapshot.selectedEvidence.text?.entry.scope.windowRef, localContext.windowRef);
  assert.equal(snapshot.selectedEvidence.visible?.entry.scope.windowRef, localContext.windowRef);

  assert.match(
    validateComputerUseEvidenceLedgerEntry(
      evidence({
        ref: 'evidence:unjustified-full-screen',
        costTier: 'T3',
        scope: { kind: 'screen', screenRef: 'screen:main' },
        supports: ['visible'],
        source: { kind: 'pixel', visiblePixels: true },
      }),
    ).join('; '),
    /full-screen observation requires explicit reason/,
  );

  assert.deepEqual(
    validateComputerUseEvidenceLedgerEntry(
      evidence({
        ref: 'evidence:justified-full-screen',
        costTier: 'T3',
        scope: { kind: 'screen', screenRef: 'screen:main' },
        supports: ['visible'],
        source: { kind: 'pixel', visiblePixels: true },
        observation: {
          costTierRegistration: {
            tier: 'T3',
            upgradeReason: 'active target moved outside the known window bounds',
            latencyMs: 24,
            modelCallCount: 0,
          },
        },
      }),
    ),
    [],
  );
});

test('Computer Use snapshot selection prefers freshness over confidence within the same owner session and target', () => {
  const snapshot = buildComputerUseObservationSnapshot({
    context,
    purposes: ['text'],
    entries: [
      evidence({
        ref: 'evidence:text-old-high-confidence',
        confidence: 0.99,
        freshness: { observedAtMs: 500 },
        facts: { text: 'old label' },
      }),
      evidence({
        ref: 'evidence:text-fresh-lower-confidence',
        confidence: 0.62,
        freshness: { observedAtMs: 950 },
        facts: { text: 'fresh label' },
      }),
    ],
  });

  assert.equal(snapshot.selectedEvidence.text?.entry.ref, 'evidence:text-fresh-lower-confidence');
  assert.equal(snapshot.selectedEvidence.text?.facts.text, 'fresh label');
  assert.ok(snapshot.selectedEvidence.text?.reasonCodes.includes('freshness-over-confidence'));
});

test('Computer Use snapshot treats structured host capabilities as sufficient before vision or GUI-click upgrades', () => {
  const entries = [
    evidence({
      ref: 'evidence:text-dom-exact',
      costTier: 'T1',
      supports: ['text'],
      freshness: { observedAtMs: 920 },
      confidence: 0.78,
      source: {
        kind: 'structured',
        exact: true,
        capabilityKind: 'dom',
        providerRef: 'capability:browser-host-session',
      },
      facts: { text: 'exact DOM label' },
    }),
    evidence({
      ref: 'evidence:text-vision-fresh',
      costTier: 'T4',
      supports: ['text'],
      freshness: { observedAtMs: 990 },
      confidence: 0.99,
      source: { kind: 'vision', modelRole: 'translators.vision' },
      facts: { text: 'visual guess' },
    }),
    evidence({
      ref: 'evidence:action-app-native',
      costTier: 'T1',
      supports: ['action'],
      freshness: { observedAtMs: 930 },
      confidence: 0.86,
      source: {
        kind: 'action',
        exact: true,
        capabilityKind: 'app-native-command',
        providerRef: 'capability:app-native',
      },
      facts: { value: 'invoke-command-ref' },
    }),
    evidence({
      ref: 'evidence:action-gui-click',
      costTier: 'T3',
      supports: ['action'],
      freshness: { observedAtMs: 995 },
      confidence: 0.97,
      source: {
        kind: 'action',
        capabilityKind: 'gui-click',
      },
      facts: { value: 'screen-coordinate-click' },
    }),
  ];

  const snapshot = buildComputerUseObservationSnapshot({
    context,
    purposes: ['text', 'action'],
    entries,
  });

  assert.equal(snapshot.selectedEvidence.text?.entry.ref, 'evidence:text-dom-exact');
  assert.equal(snapshot.selectedEvidence.action?.entry.ref, 'evidence:action-app-native');
  assert.ok(snapshot.selectedEvidence.text?.reasonCodes.includes('capability.structured-host-priority'));
  assert.ok(snapshot.selectedEvidence.action?.reasonCodes.includes('capability.structured-host-priority'));

  const brief = buildComputerUseLocalControllerBrief({
    entries,
    context,
    objective: {
      description: 'read a label and invoke an app-local action',
      purposes: ['text', 'action'],
    },
  });

  assert.equal(brief.nextObservation.required, false);
  assert.equal(brief.nextObservation.recommendedCostTier, undefined);
  assert.ok(brief.nextObservation.reasonCodes.includes('structured-capability.sufficient'));
});

test('Computer Use snapshot uses exact structured evidence for text role and file, but pixel evidence for visible state and clickability', () => {
  const snapshot = buildComputerUseObservationSnapshot({
    context,
    purposes: ['text', 'role', 'file', 'visible', 'clickability'],
    entries: [
      evidence({
        ref: 'evidence:text-vision-summary',
        costTier: 'T4',
        supports: ['text'],
        freshness: { observedAtMs: 990 },
        confidence: 0.99,
        source: { kind: 'vision' },
        facts: { text: 'visual text guess' },
      }),
      evidence({
        ref: 'evidence:text-structured-exact',
        costTier: 'T1',
        supports: ['text'],
        freshness: { observedAtMs: 940 },
        confidence: 0.85,
        source: { kind: 'structured', exact: true },
        facts: { text: 'exact label' },
      }),
      evidence({
        ref: 'evidence:role-structured-exact',
        costTier: 'T1',
        supports: ['role'],
        freshness: { observedAtMs: 930 },
        confidence: 0.84,
        source: { kind: 'structured', exact: true },
        facts: { role: 'button' },
      }),
      evidence({
        ref: 'evidence:file-structured-exact',
        costTier: 'T1',
        supports: ['file'],
        freshness: { observedAtMs: 920 },
        confidence: 0.9,
        source: { kind: 'structured', exact: true },
        facts: { fileRef: 'artifact:current-output' },
      }),
      evidence({
        ref: 'evidence:visible-structured-hint',
        costTier: 'T1',
        supports: ['visible', 'clickability'],
        freshness: { observedAtMs: 990 },
        confidence: 0.99,
        source: { kind: 'structured', exact: true },
        facts: { visible: true, clickability: 'likely-clickable' },
      }),
      evidence({
        ref: 'evidence:visible-target-crop',
        costTier: 'T2',
        supports: ['visible', 'clickability'],
        scope: {
          kind: 'target-crop',
          targetRef: context.targetRef,
          windowRef: 'window:active',
        },
        freshness: { observedAtMs: 960 },
        confidence: 0.78,
        source: { kind: 'pixel', visiblePixels: true },
        facts: { visible: true, clickability: 'unobstructed' },
      }),
    ],
  });

  assert.equal(snapshot.selectedEvidence.text?.entry.ref, 'evidence:text-structured-exact');
  assert.equal(snapshot.selectedEvidence.role?.entry.ref, 'evidence:role-structured-exact');
  assert.equal(snapshot.selectedEvidence.file?.entry.ref, 'evidence:file-structured-exact');
  assert.equal(snapshot.selectedEvidence.visible?.entry.ref, 'evidence:visible-target-crop');
  assert.equal(snapshot.selectedEvidence.clickability?.entry.ref, 'evidence:visible-target-crop');
  assert.ok(snapshot.selectedEvidence.text?.reasonCodes.includes('purpose.text.prefers-structured-exact'));
  assert.ok(snapshot.selectedEvidence.visible?.reasonCodes.includes('purpose.visible.prefers-visible-pixel'));
});

test('Computer Use snapshot prefers target-bound crop or window evidence over full-screen pixel evidence', () => {
  const snapshot = buildComputerUseObservationSnapshot({
    context,
    purposes: ['visible'],
    entries: [
      evidence({
        ref: 'evidence:visible-full-screen',
        costTier: 'T3',
        supports: ['visible'],
        scope: {
          kind: 'screen',
          screenRef: 'screen:main',
        },
        freshness: { observedAtMs: 995 },
        confidence: 0.99,
        source: { kind: 'pixel', visiblePixels: true },
        facts: { visible: true },
        observation: {
          costTierRegistration: {
            tier: 'T3',
            upgradeReason: 'compare target-local crop against the active screen',
            latencyMs: 20,
            modelCallCount: 0,
          },
        },
      }),
      evidence({
        ref: 'evidence:visible-target-crop',
        costTier: 'T2',
        supports: ['visible'],
        scope: {
          kind: 'target-crop',
          targetRef: context.targetRef,
          windowRef: 'window:active',
        },
        freshness: { observedAtMs: 900 },
        confidence: 0.72,
        source: { kind: 'pixel', visiblePixels: true },
        facts: { visible: true },
      }),
    ],
  });

  assert.equal(snapshot.selectedEvidence.visible?.entry.ref, 'evidence:visible-target-crop');
  assert.ok(snapshot.selectedEvidence.visible?.reasonCodes.includes('scope.target-bound-over-fullscreen'));
});

test('Computer Use local controller brief escalates to vision only when lower-tier visible evidence is uncertain', () => {
  const entries = [
    evidence({
      ref: 'evidence:visible-target-crop-uncertain',
      costTier: 'T2',
      supports: ['visible'],
      scope: {
        kind: 'target-crop',
        targetRef: context.targetRef,
      },
      freshness: { observedAtMs: 960 },
      confidence: 0.42,
      source: { kind: 'pixel', visiblePixels: true },
      facts: {
        visible: true,
        uncertainty: 'button edge may be covered',
      },
    }),
  ];

  const briefWithoutVision = buildComputerUseLocalControllerBrief({
    entries,
    context,
    objective: {
      description: 'decide whether the target can be clicked',
      purposes: ['visible'],
    },
  });

  assert.equal(briefWithoutVision.nextObservation.required, true);
  assert.equal(briefWithoutVision.nextObservation.recommendedCostTier, 'T4');
  assert.ok(briefWithoutVision.nextObservation.reasonCodes.includes('uncertainty.requires-vision'));

  const briefWithVision = buildComputerUseLocalControllerBrief({
    entries: [
      ...entries,
      evidence({
        ref: 'evidence:visible-vision-resolved',
        costTier: 'T4',
        supports: ['visible'],
        scope: {
          kind: 'target',
          targetRef: context.targetRef,
        },
        freshness: { observedAtMs: 970 },
        confidence: 0.86,
        source: { kind: 'vision', modelRole: 'translators.vision' },
        facts: { visible: true },
      }),
    ],
    context,
    objective: {
      description: 'decide whether the target can be clicked',
      purposes: ['visible'],
    },
  });

  assert.equal(briefWithVision.snapshot.selectedEvidence.visible?.entry.ref, 'evidence:visible-vision-resolved');
  assert.ok(briefWithVision.snapshot.selectedEvidence.visible?.reasonCodes.includes('uncertainty.escalated-to-vision'));
});

test('Computer Use mutating action returns scoped stale invalidation refs and keys', () => {
  const invalidation = computeComputerUseMutatingActionInvalidation({
    entries: [
      evidence({
        ref: 'evidence:before-target-crop',
        costTier: 'T2',
        supports: ['visible', 'clickability'],
        scope: {
          kind: 'target-crop',
          targetRef: context.targetRef,
        },
        source: { kind: 'pixel', visiblePixels: true },
      }),
      evidence({
        ref: 'evidence:before-role-state',
        costTier: 'T1',
        supports: ['role'],
        source: { kind: 'structured', exact: true },
      }),
      evidence({
        ref: 'evidence:before-grounding',
        costTier: 'T2',
        supports: ['grounding'],
        source: { kind: 'pixel', visiblePixels: true },
        invalidates: {
          refs: ['evidence:derived-location'],
          keys: ['target:primary:object-location'],
        },
      }),
      evidence({
        ref: 'evidence:other-target-crop',
        targetRef: 'target:other',
        scope: {
          kind: 'target-crop',
          targetRef: 'target:other',
        },
        supports: ['visible'],
        source: { kind: 'pixel', visiblePixels: true },
      }),
    ],
    action: {
      actionRef: 'window-action:step-001',
      kind: 'type',
      mutating: true,
      owner: context.owner,
      sessionRef: context.sessionRef,
      targetRef: context.targetRef,
    },
  });

  assert.deepEqual(invalidation.staleBy, {
    actionRef: 'window-action:step-001',
    actionKind: 'type',
    reason: 'mutating-action',
  });
  assert.deepEqual(invalidation.staleRefs, [
    'evidence:before-target-crop',
    'evidence:before-role-state',
    'evidence:before-grounding',
    'evidence:derived-location',
  ]);
  assert.equal(invalidation.staleRefs.includes('evidence:other-target-crop'), false);
  assert.deepEqual(invalidation.staleKeys, [
    'target:primary:screenshot',
    'target:primary:ocr',
    'target:primary:object-location',
    'target:primary:grounding',
    'target:primary:role-state',
    'target:primary:completion',
    'target:primary:visible',
    'target:primary:clickability',
  ]);
});

test('Computer Use listed mutating action kinds stale visual grounding and completion candidates', () => {
  const mutatingKinds = [
    'click',
    'open',
    'menu',
    'navigation',
    'scroll',
    'type',
    'save',
    'window-switch',
    'focus-takeover',
  ];
  const expectedStaleKeys = [
    'target:primary:screenshot',
    'target:primary:ocr',
    'target:primary:object-location',
    'target:primary:grounding',
    'target:primary:role-state',
    'target:primary:completion',
  ];

  for (const kind of mutatingKinds) {
    const invalidation = computeComputerUseMutatingActionInvalidation({
      entries: [],
      action: {
        actionRef: `window-action:${kind}`,
        kind,
        targetRef: context.targetRef,
      },
    });

    assert.deepEqual(invalidation.staleKeys, expectedStaleKeys);
  }

  const nonMutating = computeComputerUseMutatingActionInvalidation({
    entries: [],
    action: {
      actionRef: 'window-action:wait',
      kind: 'wait',
      targetRef: context.targetRef,
    },
  });

  assert.deepEqual(nonMutating.staleKeys, []);
  assert.deepEqual(nonMutating.staleRefs, []);
});

test('Computer Use mutating action ledger records causality evidence and freshness invalidation', () => {
  const record = buildComputerUseMutatingActionLedgerRecord({
    entries: [
      evidence({
        ref: 'evidence:before-window-screenshot',
        costTier: 'T3',
        supports: ['visible'],
        scope: { kind: 'window-crop', targetRef: context.targetRef, windowRef: 'window:active' },
        source: { kind: 'pixel', visiblePixels: true },
      }),
      evidence({
        ref: 'evidence:grounding-point',
        costTier: 'T2',
        supports: ['grounding'],
        source: { kind: 'pixel', visiblePixels: true },
      }),
      evidence({
        ref: 'evidence:before-ocr',
        costTier: 'T2',
        supports: ['text'],
        source: { kind: 'ocr' },
      }),
      evidence({
        ref: 'evidence:after-target-crop',
        costTier: 'T2',
        supports: ['visible'],
        source: { kind: 'pixel', visiblePixels: true },
      }),
      evidence({
        ref: 'evidence:verification',
        costTier: 'T5',
        supports: ['verification'],
        source: { kind: 'verifier' },
      }),
      evidence({
        ref: 'evidence:completion-candidate',
        costTier: 'T1',
        supports: ['completion'],
        source: { kind: 'structured', exact: true },
      }),
    ],
    action: {
      actionRef: 'window-action:step-002',
      kind: 'click',
      mutating: true,
      owner: context.owner,
      sessionRef: context.sessionRef,
      targetRef: context.targetRef,
      leaseRef: 'lease:target-window',
    },
    beforeEvidenceRefs: ['evidence:before-window-screenshot', 'evidence:before-ocr'],
    groundingEvidenceRefs: ['evidence:grounding-point'],
    executorEventRef: 'executor-event:click-002',
    afterEvidenceRefs: ['evidence:after-target-crop'],
    verificationEvidenceRefs: ['evidence:verification'],
  });

  assert.equal(record.schemaVersion, 'sciforge.computer-use.mutating-action-ledger-record.v1');
  assert.deepEqual(record.beforeEvidenceRefs, ['evidence:before-window-screenshot', 'evidence:before-ocr']);
  assert.deepEqual(record.groundingEvidenceRefs, ['evidence:grounding-point']);
  assert.equal(record.executorEventRef, 'executor-event:click-002');
  assert.deepEqual(record.afterEvidenceRefs, ['evidence:after-target-crop']);
  assert.deepEqual(record.verificationEvidenceRefs, ['evidence:verification']);
  assert.equal(record.freshnessInvalidation.actionKind, 'click');
  assert.deepEqual(record.freshnessInvalidation.staleKeys, [
    'target:primary:screenshot',
    'target:primary:ocr',
    'target:primary:object-location',
    'target:primary:grounding',
    'target:primary:role-state',
    'target:primary:completion',
    'target:primary:visible',
    'target:primary:text',
  ]);

  assert.throws(
    () =>
      buildComputerUseMutatingActionLedgerRecord({
        entries: [],
        action: {
          actionRef: 'window-action:missing-evidence',
          kind: 'type',
          mutating: true,
          targetRef: context.targetRef,
        },
        beforeEvidenceRefs: [],
        groundingEvidenceRefs: ['evidence:grounding-point'],
        executorEventRef: 'executor-event:type',
        afterEvidenceRefs: ['evidence:after'],
        verificationEvidenceRefs: ['evidence:verification'],
      }),
    /before evidence is required/,
  );
});

test('Computer Use low-risk batch policy only allows same target lease and checkpoints risky transitions', () => {
  const lowRisk = decideComputerUseActionBatchPolicy({
    actions: [
      { kind: 'click', targetRef: context.targetRef, leaseRef: 'lease:target-window', risk: 'low' },
      { kind: 'type', targetRef: context.targetRef, leaseRef: 'lease:target-window', risk: 'low' },
    ],
    verifierPassed: true,
  });

  assert.equal(lowRisk.allowBatch, true);
  assert.equal(lowRisk.forceCheckpoint, false);
  assert.ok(lowRisk.reasonCodes.includes('batch.same-target-lease.low-risk'));

  const targetMismatch = decideComputerUseActionBatchPolicy({
    actions: [
      { kind: 'click', targetRef: context.targetRef, leaseRef: 'lease:target-window', risk: 'low' },
      { kind: 'type', targetRef: 'target:secondary', leaseRef: 'lease:target-window', risk: 'low' },
    ],
    verifierPassed: true,
  });

  assert.equal(targetMismatch.allowBatch, false);
  assert.equal(targetMismatch.forceCheckpoint, true);
  assert.ok(targetMismatch.reasonCodes.includes('batch.target-or-lease-changed'));

  const saveRequiresCheckpoint = decideComputerUseActionBatchPolicy({
    actions: [{ kind: 'save', targetRef: context.targetRef, leaseRef: 'lease:target-window', risk: 'low' }],
    verifierPassed: true,
  });

  assert.equal(saveRequiresCheckpoint.allowBatch, false);
  assert.equal(saveRequiresCheckpoint.forceCheckpoint, true);
  assert.ok(saveRequiresCheckpoint.reasonCodes.includes('action.save.requires-checkpoint'));

  const verifierFailure = decideComputerUseActionBatchPolicy({
    actions: [{ kind: 'scroll', targetRef: context.targetRef, leaseRef: 'lease:target-window', risk: 'low' }],
    verifierPassed: false,
  });

  assert.equal(verifierFailure.allowBatch, false);
  assert.equal(verifierFailure.forceCheckpoint, true);
  assert.ok(verifierFailure.reasonCodes.includes('verifier.failure.requires-checkpoint'));
});
