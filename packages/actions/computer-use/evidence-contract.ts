export const computerUseEvidenceContractIds = {
  entrySchema: 'sciforge.computer-use.evidence-entry.v1',
  observationSnapshotSchema: 'sciforge.computer-use.observation-snapshot.v1',
  localControllerBriefSchema: 'sciforge.computer-use.local-controller-brief.v1',
  staleInvalidationSchema: 'sciforge.computer-use.stale-invalidation.v1',
  mutatingActionLedgerRecordSchema: 'sciforge.computer-use.mutating-action-ledger-record.v1',
} as const;

export const computerUseEvidenceCostTiers = {
  T0: {
    rank: 0,
    label: 'session/window/action metadata',
  },
  T1: {
    rank: 1,
    label: 'DOM/AX/UIA/PTY/file structured state',
  },
  T2: {
    rank: 2,
    label: 'target crop or OCR',
  },
  T3: {
    rank: 3,
    label: 'fresh window screenshot',
  },
  T4: {
    rank: 4,
    label: 'Model Router vision translator',
  },
  T5: {
    rank: 5,
    label: 'before/after vision compare or verifier explanation',
  },
} as const;

export type ComputerUseEvidenceCostTier = keyof typeof computerUseEvidenceCostTiers;

export type ComputerUseEvidencePurpose =
  | 'metadata'
  | 'text'
  | 'role'
  | 'file'
  | 'visible'
  | 'clickability'
  | 'grounding'
  | 'verification'
  | 'artifact'
  | 'action'
  | 'completion';

export type ComputerUseEvidenceSourceKind =
  | 'metadata'
  | 'structured'
  | 'ocr'
  | 'pixel'
  | 'vision'
  | 'verifier'
  | 'action'
  | 'artifact';

export type ComputerUseEvidenceScopeKind =
  | 'global'
  | 'session'
  | 'screen'
  | 'window'
  | 'window-crop'
  | 'target'
  | 'target-crop'
  | 'file'
  | 'artifact';

export type ComputerUseEvidenceScope = {
  kind: ComputerUseEvidenceScopeKind;
  owner?: string;
  sessionRef?: string;
  targetRef?: string;
  windowRef?: string;
  screenRef?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ComputerUseEvidenceFreshness = {
  observedAtMs: number;
  expiresAtMs?: number;
  stale?: boolean;
  staleReason?: string;
};

export type ComputerUseEvidenceInvalidates = {
  refs?: readonly string[];
  keys?: readonly string[];
  scopes?: readonly ComputerUseEvidenceScope[];
};

export type ComputerUseEvidenceStaleBy = {
  actionRef: string;
  actionKind: string;
  reason: string;
  observedAtMs?: number;
};

export type ComputerUseEvidenceSource = {
  kind: ComputerUseEvidenceSourceKind;
  exact?: boolean;
  visiblePixels?: boolean;
  modelRole?: 'textReasoner' | 'translators.vision' | string;
  providerRef?: string;
  capabilityKind?: string;
};

export type ComputerUseObservationCostTierRegistration = {
  tier: ComputerUseEvidenceCostTier;
  fromTier?: ComputerUseEvidenceCostTier;
  upgradeReason?: string;
  latencyMs: number;
  modelCallCount: number;
  reasonCodes?: readonly string[];
};

export type ComputerUseEvidenceObservation = {
  costTierRegistration?: ComputerUseObservationCostTierRegistration;
};

export type ComputerUseEvidenceFacts = {
  text?: string;
  label?: string;
  value?: string;
  role?: string;
  fileRef?: string;
  artifactRef?: string;
  visible?: boolean;
  clickability?: boolean | string;
  uncertainty?: boolean | string;
  metadata?: unknown;
  [key: string]: unknown;
};

export type ComputerUseEvidenceLedgerEntry = {
  schemaVersion?: typeof computerUseEvidenceContractIds.entrySchema;
  ref: string;
  costTier: ComputerUseEvidenceCostTier;
  owner?: string;
  sessionRef?: string;
  targetRef?: string;
  scope: ComputerUseEvidenceScope;
  freshness: ComputerUseEvidenceFreshness;
  confidence: number;
  source: ComputerUseEvidenceSource;
  supports: readonly ComputerUseEvidencePurpose[];
  facts?: ComputerUseEvidenceFacts;
  observation?: ComputerUseEvidenceObservation;
  invalidates?: ComputerUseEvidenceInvalidates;
  staleBy?: ComputerUseEvidenceStaleBy;
};

export type ComputerUseEvidenceSelectionContext = {
  owner?: string;
  sessionRef?: string;
  targetRef?: string;
  windowRef?: string;
  screenRef?: string;
  nowMs?: number;
};

export type ComputerUseRankedEvidenceEntry = {
  entry: ComputerUseEvidenceLedgerEntry;
  purpose: ComputerUseEvidencePurpose;
  rank: number;
  score: {
    purpose: number;
    context: number;
    scope: number;
    freshness: number;
    confidence: number;
    cost: number;
  };
  reasonCodes: string[];
};

export type ComputerUseEvidenceSelection = ComputerUseRankedEvidenceEntry & {
  facts: ComputerUseEvidenceFacts;
};

export type ComputerUseObservationSnapshot = {
  schemaVersion: typeof computerUseEvidenceContractIds.observationSnapshotSchema;
  context: ComputerUseEvidenceSelectionContext;
  purposes: ComputerUseEvidencePurpose[];
  selectedEvidence: Partial<Record<ComputerUseEvidencePurpose, ComputerUseEvidenceSelection>>;
  rankedEvidence: Partial<Record<ComputerUseEvidencePurpose, ComputerUseRankedEvidenceEntry[]>>;
  staleEvidenceRefs: string[];
  rejectedEvidence: Array<{
    ref?: string;
    reasons: string[];
  }>;
  uncertainties: Array<{
    purpose: ComputerUseEvidencePurpose;
    reason: string;
    evidenceRef?: string;
  }>;
  freshness: {
    nowMs?: number;
    newestObservedAtMs?: number;
    oldestSelectedObservedAtMs?: number;
  };
};

export type ComputerUseLocalControllerBrief = {
  schemaVersion: typeof computerUseEvidenceContractIds.localControllerBriefSchema;
  objective: {
    description: string;
    purposes: ComputerUseEvidencePurpose[];
  };
  context: ComputerUseEvidenceSelectionContext;
  snapshot: ComputerUseObservationSnapshot;
  selectedEvidenceRefs: string[];
  facts: Partial<Record<ComputerUseEvidencePurpose, ComputerUseEvidenceFacts>>;
  nextObservation: {
    required: boolean;
    recommendedCostTier?: ComputerUseEvidenceCostTier;
    reasonCodes: string[];
  };
};

export type ComputerUseMutatingActionInvalidation = {
  schemaVersion: typeof computerUseEvidenceContractIds.staleInvalidationSchema;
  actionRef: string;
  actionKind: string;
  staleBy: ComputerUseEvidenceStaleBy;
  staleRefs: string[];
  staleKeys: string[];
};

export type ComputerUseMutatingActionInvalidationInput = {
  entries: readonly ComputerUseEvidenceLedgerEntry[];
  action: {
    actionRef: string;
    kind: string;
    mutating?: boolean;
    owner?: string;
    sessionRef?: string;
    targetRef?: string;
    leaseRef?: string;
    invalidates?: ComputerUseEvidenceInvalidates;
  };
};

export type ComputerUseMutatingActionLedgerRecord = {
  schemaVersion: typeof computerUseEvidenceContractIds.mutatingActionLedgerRecordSchema;
  actionRef: string;
  actionKind: string;
  targetRef?: string;
  leaseRef?: string;
  beforeEvidenceRefs: string[];
  groundingEvidenceRefs: string[];
  executorEventRef: string;
  afterEvidenceRefs: string[];
  verificationEvidenceRefs: string[];
  freshnessInvalidation: ComputerUseMutatingActionInvalidation;
};

export type ComputerUseMutatingActionLedgerRecordInput = ComputerUseMutatingActionInvalidationInput & {
  beforeEvidenceRefs: readonly string[];
  groundingEvidenceRefs: readonly string[];
  executorEventRef: string;
  afterEvidenceRefs: readonly string[];
  verificationEvidenceRefs: readonly string[];
};

export type ComputerUseActionBatchPolicyInput = {
  actions: ReadonlyArray<{
    kind: string;
    targetRef?: string;
    leaseRef?: string;
    risk?: 'low' | 'medium' | 'high' | string;
  }>;
  verifierPassed?: boolean;
};

export type ComputerUseActionBatchPolicyDecision = {
  allowBatch: boolean;
  forceCheckpoint: boolean;
  reasonCodes: string[];
};

const forbiddenRefPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: 'ui', pattern: /^(?:ui|gui):/i },
  { name: 'fixture', pattern: /^fixture:/i },
  { name: 'replay', pattern: /^replay:/i },
  { name: 'raw', pattern: /^raw:/i },
  { name: 'base64', pattern: /(?:^base64:|;base64,|base64)/i },
  { name: 'secret', pattern: /^(?:secret|token|password):/i },
];

const mutatingActionKinds = new Set([
  'click',
  'open',
  'menu',
  'navigation',
  'navigate',
  'scroll',
  'type',
  'save',
  'submit',
  'upload',
  'delete',
  'window-switch',
  'focus',
  'focus-takeover',
  'press',
]);

const purposeStaleKeyNames: Partial<Record<ComputerUseEvidencePurpose, string>> = {
  visible: 'visible',
  clickability: 'clickability',
  role: 'role-state',
  text: 'text',
  grounding: 'grounding',
  completion: 'completion',
  file: 'file-state',
  artifact: 'artifact-state',
};

const actionStaleKeyNames = [
  'screenshot',
  'ocr',
  'object-location',
  'grounding',
  'role-state',
  'completion',
] as const;

const checkpointActionKinds = new Set([
  'navigation',
  'navigate',
  'submit',
  'save',
  'export',
  'upload',
  'delete',
  'modal',
  'target-movement',
  'window-switch',
  'focus-takeover',
]);

export function validateComputerUseEvidenceLedgerEntry(entry: ComputerUseEvidenceLedgerEntry): string[] {
  const violations: string[] = [];

  if (!entry || typeof entry !== 'object') {
    return ['evidence entry must be an object'];
  }
  if (!entry.ref || typeof entry.ref !== 'string') {
    violations.push('evidence entry ref is required');
  } else {
    violations.push(...validateComputerUseEvidenceRef(entry.ref));
  }
  if (!isComputerUseEvidenceCostTier(entry.costTier)) {
    violations.push(`unknown cost tier: ${String(entry.costTier)}`);
  }
  if (!entry.scope || typeof entry.scope !== 'object') {
    violations.push('evidence entry scope is required');
  }
  if (!entry.freshness || !Number.isFinite(entry.freshness.observedAtMs)) {
    violations.push('evidence entry freshness.observedAtMs must be finite');
  }
  if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
    violations.push('evidence entry confidence must be between 0 and 1');
  }
  if (!entry.source || typeof entry.source.kind !== 'string') {
    violations.push('evidence entry source.kind is required');
  }
  if (!Array.isArray(entry.supports)) {
    violations.push('evidence entry supports must be an array');
  }
  const costTierRegistration = entry.observation?.costTierRegistration;
  if (costTierRegistration) {
    if (costTierRegistration.tier !== entry.costTier) {
      violations.push('cost tier registration must match entry cost tier');
    }
    if (!Number.isFinite(costTierRegistration.latencyMs) || costTierRegistration.latencyMs < 0) {
      violations.push('observation cost tier registration latencyMs must be finite');
    }
    if (!Number.isInteger(costTierRegistration.modelCallCount) || costTierRegistration.modelCallCount < 0) {
      violations.push('observation cost tier registration modelCallCount must be a non-negative integer');
    }
    if (costTierRegistration.fromTier && !isComputerUseEvidenceCostTier(costTierRegistration.fromTier)) {
      violations.push(`unknown source cost tier: ${String(costTierRegistration.fromTier)}`);
    }
  }
  if (entry.scope?.kind === 'screen' && !costTierRegistration?.upgradeReason) {
    violations.push('full-screen observation requires explicit reason');
  }

  for (const ref of [
    ...(entry.invalidates?.refs ?? []),
    entry.staleBy?.actionRef,
    entry.source?.providerRef,
  ]) {
    if (typeof ref === 'string') violations.push(...validateComputerUseEvidenceRef(ref));
  }

  return uniqueStrings(violations);
}

export function rankComputerUseEvidenceEntries(
  entries: readonly ComputerUseEvidenceLedgerEntry[],
  options: {
    purpose: ComputerUseEvidencePurpose;
    context?: ComputerUseEvidenceSelectionContext;
  },
): ComputerUseRankedEvidenceEntry[] {
  assertEntriesValid(entries);
  const context = options.context ?? {};
  const normalizedEntries = entries.map((entry) => normalizeEvidenceEntryForContext(entry, context));
  const candidates = normalizedEntries.filter((entry) => {
    return (
      entrySupportsPurpose(entry, options.purpose) &&
      !isEntryStale(entry, context.nowMs) &&
      matchesContextFloor(entry, context)
    );
  });

  const ranked = candidates.map((entry) => {
    const score = {
      purpose: purposeScore(entry, options.purpose),
      context: contextScore(entry, context),
      scope: scopeScore(entry, options.purpose, context),
      freshness: entry.freshness.observedAtMs,
      confidence: entry.confidence,
      cost: -computerUseEvidenceCostTiers[entry.costTier].rank,
    };
    return {
      entry,
      purpose: options.purpose,
      rank: 0,
      score,
      reasonCodes: rankReasonCodes(entry, options.purpose, context, candidates),
    };
  });

  ranked.sort(compareRankedEvidence);

  return ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    reasonCodes: selectionReasonCodes(entry, ranked),
  }));
}

export function buildComputerUseObservationSnapshot(input: {
  entries: readonly ComputerUseEvidenceLedgerEntry[];
  context?: ComputerUseEvidenceSelectionContext;
  purposes: readonly ComputerUseEvidencePurpose[];
}): ComputerUseObservationSnapshot {
  assertEntriesValid(input.entries);
  const context = input.context ?? {};
  const entries = input.entries.map((entry) => normalizeEvidenceEntryForContext(entry, context));
  const purposes = uniquePurposes(input.purposes);
  const selectedEvidence: Partial<Record<ComputerUseEvidencePurpose, ComputerUseEvidenceSelection>> = {};
  const rankedEvidence: Partial<Record<ComputerUseEvidencePurpose, ComputerUseRankedEvidenceEntry[]>> = {};
  const uncertainties: ComputerUseObservationSnapshot['uncertainties'] = [];

  for (const purpose of purposes) {
    const ranked = rankComputerUseEvidenceEntries(entries, { purpose, context });
    rankedEvidence[purpose] = ranked;
    const selected = selectEvidenceForPurpose(ranked, purpose);
    if (selected) {
      selectedEvidence[purpose] = {
        ...selected,
        facts: selected.entry.facts ?? {},
      };
      if (isSelectionUncertain(selectedEvidence[purpose])) {
        uncertainties.push({
          purpose,
          reason: 'selected evidence is uncertain',
          evidenceRef: selected.entry.ref,
        });
      }
    } else {
      uncertainties.push({
        purpose,
        reason: 'no current evidence supports purpose',
      });
    }
  }

  const selectedObservedAt = Object.values(selectedEvidence)
    .map((selection) => selection?.entry.freshness.observedAtMs)
    .filter((value): value is number => Number.isFinite(value));
  const currentObservedAt = entries
    .filter((entry) => !isEntryStale(entry, context.nowMs))
    .map((entry) => entry.freshness.observedAtMs);

  return {
    schemaVersion: computerUseEvidenceContractIds.observationSnapshotSchema,
    context,
    purposes,
    selectedEvidence,
    rankedEvidence,
    staleEvidenceRefs: uniqueStrings(
      entries.filter((entry) => isEntryStale(entry, context.nowMs)).map((entry) => entry.ref),
    ),
    rejectedEvidence: [],
    uncertainties,
    freshness: {
      nowMs: context.nowMs,
      newestObservedAtMs: maxFinite(currentObservedAt),
      oldestSelectedObservedAtMs: minFinite(selectedObservedAt),
    },
  };
}

export function buildComputerUseLocalControllerBrief(input: {
  entries: readonly ComputerUseEvidenceLedgerEntry[];
  context?: ComputerUseEvidenceSelectionContext;
  objective: {
    description: string;
    purposes: readonly ComputerUseEvidencePurpose[];
  };
}): ComputerUseLocalControllerBrief {
  const context = input.context ?? {};
  const purposes = uniquePurposes(input.objective.purposes);
  const snapshot = buildComputerUseObservationSnapshot({
    entries: input.entries,
    context,
    purposes,
  });
  const selectedEvidence = Object.values(snapshot.selectedEvidence).filter(
    (selection): selection is ComputerUseEvidenceSelection => Boolean(selection),
  );
  const facts = Object.fromEntries(
    selectedEvidence.map((selection) => [selection.purpose, selection.facts]),
  ) as Partial<Record<ComputerUseEvidencePurpose, ComputerUseEvidenceFacts>>;
  const nextObservation = computeNextObservation(snapshot, purposes);

  return {
    schemaVersion: computerUseEvidenceContractIds.localControllerBriefSchema,
    objective: {
      description: input.objective.description,
      purposes,
    },
    context,
    snapshot,
    selectedEvidenceRefs: uniqueStrings(selectedEvidence.map((selection) => selection.entry.ref)),
    facts,
    nextObservation,
  };
}

export function computeComputerUseMutatingActionInvalidation(
  input: ComputerUseMutatingActionInvalidationInput,
): ComputerUseMutatingActionInvalidation {
  assertEntriesValid(input.entries);
  const actionRefViolations = validateComputerUseEvidenceRef(input.action.actionRef);
  if (actionRefViolations.length > 0) {
    throw new Error(`Invalid Computer Use action ref: ${actionRefViolations.join('; ')}`);
  }
  const actionInvalidatesRefs = input.action.invalidates?.refs ?? [];
  const actionInvalidatesKeys = input.action.invalidates?.keys ?? [];
  for (const ref of actionInvalidatesRefs) {
    const violations = validateComputerUseEvidenceRef(ref);
    if (violations.length > 0) {
      throw new Error(`Invalid Computer Use action invalidation ref: ${violations.join('; ')}`);
    }
  }

  const staleBy: ComputerUseEvidenceStaleBy = {
    actionRef: input.action.actionRef,
    actionKind: input.action.kind,
    reason: 'mutating-action',
  };
  const mutating = input.action.mutating === true || mutatingActionKinds.has(input.action.kind);
  if (!mutating) {
    return {
      schemaVersion: computerUseEvidenceContractIds.staleInvalidationSchema,
      actionRef: input.action.actionRef,
      actionKind: input.action.kind,
      staleBy,
      staleRefs: [],
      staleKeys: [],
    };
  }

  const staleRefs: string[] = [];
  const targetKey = input.action.targetRef ?? 'target:unbound';
  const staleKeys: string[] = actionStaleKeyNames.map((key) => `${targetKey}:${key}`);

  for (const entry of input.entries) {
    if (!matchesActionContext(entry, input.action)) continue;
    staleRefs.push(entry.ref);
    for (const purpose of entry.supports) {
      const keyName = purposeStaleKeyNames[purpose];
      if (keyName) staleKeys.push(`${targetKey}:${keyName}`);
    }
    staleRefs.push(...(entry.invalidates?.refs ?? []));
    staleKeys.push(...(entry.invalidates?.keys ?? []));
  }

  staleRefs.push(...actionInvalidatesRefs);
  staleKeys.push(...actionInvalidatesKeys);

  return {
    schemaVersion: computerUseEvidenceContractIds.staleInvalidationSchema,
    actionRef: input.action.actionRef,
    actionKind: input.action.kind,
    staleBy,
    staleRefs: uniqueStrings(staleRefs),
    staleKeys: uniqueStrings(staleKeys),
  };
}

export function buildComputerUseMutatingActionLedgerRecord(
  input: ComputerUseMutatingActionLedgerRecordInput,
): ComputerUseMutatingActionLedgerRecord {
  if (input.beforeEvidenceRefs.length === 0) throw new Error('before evidence is required for mutating action ledger records');
  if (input.groundingEvidenceRefs.length === 0) throw new Error('grounding evidence is required for mutating action ledger records');
  if (!input.executorEventRef) throw new Error('executor event is required for mutating action ledger records');
  if (input.afterEvidenceRefs.length === 0) throw new Error('after evidence is required for mutating action ledger records');
  if (input.verificationEvidenceRefs.length === 0) throw new Error('verification evidence is required for mutating action ledger records');

  validateEvidenceRefs('before evidence', input.beforeEvidenceRefs);
  validateEvidenceRefs('grounding evidence', input.groundingEvidenceRefs);
  validateEvidenceRefs('after evidence', input.afterEvidenceRefs);
  validateEvidenceRefs('verification evidence', input.verificationEvidenceRefs);
  const executorViolations = validateComputerUseEvidenceRef(input.executorEventRef);
  if (executorViolations.length > 0) {
    throw new Error(`Invalid Computer Use executor event ref: ${executorViolations.join('; ')}`);
  }

  return {
    schemaVersion: computerUseEvidenceContractIds.mutatingActionLedgerRecordSchema,
    actionRef: input.action.actionRef,
    actionKind: input.action.kind,
    targetRef: input.action.targetRef,
    leaseRef: input.action.leaseRef,
    beforeEvidenceRefs: uniqueStrings(input.beforeEvidenceRefs),
    groundingEvidenceRefs: uniqueStrings(input.groundingEvidenceRefs),
    executorEventRef: input.executorEventRef,
    afterEvidenceRefs: uniqueStrings(input.afterEvidenceRefs),
    verificationEvidenceRefs: uniqueStrings(input.verificationEvidenceRefs),
    freshnessInvalidation: computeComputerUseMutatingActionInvalidation(input),
  };
}

export function decideComputerUseActionBatchPolicy(
  input: ComputerUseActionBatchPolicyInput,
): ComputerUseActionBatchPolicyDecision {
  const reasonCodes: string[] = [];
  if (input.actions.length === 0) {
    return { allowBatch: false, forceCheckpoint: true, reasonCodes: ['batch.empty.requires-checkpoint'] };
  }
  if (input.verifierPassed === false) {
    reasonCodes.push('verifier.failure.requires-checkpoint');
  }
  const firstTarget = input.actions[0]?.targetRef;
  const firstLease = input.actions[0]?.leaseRef;
  const sameTargetLease = input.actions.every((action) => action.targetRef === firstTarget && action.leaseRef === firstLease);
  if (!sameTargetLease) {
    reasonCodes.push('batch.target-or-lease-changed');
  }
  const checkpointAction = input.actions.find((action) => checkpointActionKinds.has(action.kind));
  if (checkpointAction) {
    reasonCodes.push(`action.${checkpointAction.kind}.requires-checkpoint`);
  }
  if (input.actions.some((action) => action.risk && action.risk !== 'low')) {
    reasonCodes.push('batch.non-low-risk.requires-checkpoint');
  }

  if (reasonCodes.length > 0) {
    return {
      allowBatch: false,
      forceCheckpoint: true,
      reasonCodes: uniqueStrings(reasonCodes),
    };
  }

  return {
    allowBatch: true,
    forceCheckpoint: false,
    reasonCodes: ['batch.same-target-lease.low-risk'],
  };
}

function validateComputerUseEvidenceRef(ref: string): string[] {
  const violations: string[] = [];
  for (const forbidden of forbiddenRefPatterns) {
    if (forbidden.pattern.test(ref)) {
      violations.push(`forbidden evidence ref (${forbidden.name}): ${ref}`);
    }
  }
  return violations;
}

function validateEvidenceRefs(label: string, refs: readonly string[]) {
  for (const ref of refs) {
    const violations = validateComputerUseEvidenceRef(ref);
    if (violations.length > 0) {
      throw new Error(`Invalid Computer Use ${label} ref: ${violations.join('; ')}`);
    }
  }
}

function assertEntriesValid(entries: readonly ComputerUseEvidenceLedgerEntry[]) {
  const failures = entries
    .map((entry) => ({
      ref: entry?.ref,
      reasons: validateComputerUseEvidenceLedgerEntry(entry),
    }))
    .filter((failure) => failure.reasons.length > 0);

  if (failures.length > 0) {
    const failure = failures[0];
    throw new Error(
      `Invalid Computer Use evidence ledger entry ${failure.ref ?? '<missing-ref>'}: ${failure.reasons.join('; ')}`,
    );
  }
}

function isComputerUseEvidenceCostTier(value: unknown): value is ComputerUseEvidenceCostTier {
  return typeof value === 'string' && Object.hasOwn(computerUseEvidenceCostTiers, value);
}

function entrySupportsPurpose(entry: ComputerUseEvidenceLedgerEntry, purpose: ComputerUseEvidencePurpose) {
  if (entry.supports.includes(purpose)) return true;
  const facts = entry.facts ?? {};
  if (purpose === 'text') return typeof facts.text === 'string' || typeof facts.label === 'string';
  if (purpose === 'role') return typeof facts.role === 'string';
  if (purpose === 'file') return typeof facts.fileRef === 'string';
  if (purpose === 'artifact') return typeof facts.artifactRef === 'string';
  if (purpose === 'visible') return typeof facts.visible === 'boolean';
  if (purpose === 'clickability') return typeof facts.clickability !== 'undefined';
  if (purpose === 'metadata') return entry.source.kind === 'metadata';
  if (purpose === 'completion') return typeof facts.artifactRef === 'string' || typeof facts.fileRef === 'string';
  if (purpose === 'verification') return entry.source.kind === 'verifier' || entry.source.kind === 'artifact';
  return false;
}

function isEntryStale(entry: ComputerUseEvidenceLedgerEntry, nowMs?: number) {
  if (entry.staleBy) return true;
  if (entry.freshness.stale) return true;
  if (Number.isFinite(nowMs) && Number.isFinite(entry.freshness.expiresAtMs)) {
    return Number(entry.freshness.expiresAtMs) <= Number(nowMs);
  }
  return false;
}

function matchesContextFloor(entry: ComputerUseEvidenceLedgerEntry, context: ComputerUseEvidenceSelectionContext) {
  if (context.owner && entry.owner && entry.owner !== context.owner) return false;
  if (context.sessionRef && entry.sessionRef && entry.sessionRef !== context.sessionRef) return false;
  return true;
}

function purposeScore(entry: ComputerUseEvidenceLedgerEntry, purpose: ComputerUseEvidencePurpose) {
  if (isStructuredHostCapability(entry)) return 120;
  if (purpose === 'text' || purpose === 'role' || purpose === 'file') {
    if (entry.source.kind === 'structured' && entry.source.exact) return 100;
    if (entry.source.kind === 'artifact' && entry.source.exact) return 96;
    if (entry.source.kind === 'metadata' && entry.source.exact) return 92;
    if (entry.source.kind === 'ocr') return 80;
    if (entry.source.kind === 'vision') return 58;
    return 50;
  }
  if (purpose === 'visible' || purpose === 'clickability') {
    if (entry.source.kind === 'pixel' && entry.source.visiblePixels) return 100;
    if (entry.source.kind === 'vision') return 88;
    if (entry.source.kind === 'ocr') return 60;
    if (entry.source.kind === 'structured') return 45;
    return 40;
  }
  if (purpose === 'metadata') {
    if (entry.source.kind === 'metadata') return 100;
    if (entry.source.kind === 'structured') return 80;
  }
  if (purpose === 'verification') {
    if (entry.source.kind === 'artifact' && entry.source.exact) return 105;
    if (entry.source.kind === 'verifier') return 100;
    if (entry.source.kind === 'vision') return 80;
  }
  if (purpose === 'artifact' || purpose === 'completion') {
    if (entry.source.kind === 'artifact' && entry.source.exact) return 110;
    if (entry.source.kind === 'verifier') return 100;
    if (entry.source.kind === 'structured' && entry.source.exact) return 95;
    if (entry.source.kind === 'vision') return 60;
  }
  if (purpose === 'action') {
    if (isStructuredHostCapability(entry)) return 120;
    if (entry.source.kind === 'action' && entry.source.exact) return 100;
    if (entry.source.kind === 'action') return 80;
  }
  if (purpose === 'grounding') {
    if (entry.source.kind === 'pixel') return 95;
    if (entry.source.kind === 'structured') return 90;
    if (entry.source.kind === 'vision') return 80;
  }
  return 70;
}

function contextScore(entry: ComputerUseEvidenceLedgerEntry, context: ComputerUseEvidenceSelectionContext) {
  let score = 0;
  if (context.owner && entry.owner === context.owner) score += 3;
  if (context.sessionRef && entry.sessionRef === context.sessionRef) score += 6;
  if (context.targetRef && entryTargetRef(entry) === context.targetRef) score += 12;
  if (context.windowRef && entry.scope.windowRef === context.windowRef) score += 4;
  if (context.screenRef && entry.scope.screenRef === context.screenRef) score += 2;
  return score;
}

function scopeScore(
  entry: ComputerUseEvidenceLedgerEntry,
  purpose: ComputerUseEvidencePurpose,
  context: ComputerUseEvidenceSelectionContext,
) {
  const targetBound = context.targetRef && entryTargetRef(entry) === context.targetRef;
  const windowBound = Boolean(entry.scope.windowRef || entry.scope.kind === 'window' || entry.scope.kind === 'window-crop');
  if (purpose === 'visible' || purpose === 'clickability' || purpose === 'grounding') {
    if (targetBound && entry.scope.kind === 'target-crop') return 100;
    if (targetBound && (entry.scope.kind === 'target' || entry.scope.kind === 'window-crop')) return 95;
    if (targetBound && windowBound) return 90;
    if (windowBound) return 70;
    if (entry.scope.kind === 'screen') return 40;
    return 20;
  }
  if (targetBound) return 90;
  if (context.sessionRef && entry.sessionRef === context.sessionRef) return 70;
  if (entry.scope.kind === 'global') return 10;
  return 50;
}

function rankReasonCodes(
  entry: ComputerUseEvidenceLedgerEntry,
  purpose: ComputerUseEvidencePurpose,
  context: ComputerUseEvidenceSelectionContext,
  candidates: readonly ComputerUseEvidenceLedgerEntry[],
) {
  const reasonCodes = [`cost-tier.${entry.costTier}`];
  if (context.owner && entry.owner === context.owner) reasonCodes.push('scope.same-owner');
  if (context.sessionRef && entry.sessionRef === context.sessionRef) reasonCodes.push('scope.same-session');
  if (context.targetRef && entryTargetRef(entry) === context.targetRef) reasonCodes.push('scope.same-target');
  if (isStructuredHostCapability(entry)) reasonCodes.push('capability.structured-host-priority');
  if ((purpose === 'text' || purpose === 'role' || purpose === 'file') && entry.source.kind === 'structured' && entry.source.exact) {
    reasonCodes.push(`purpose.${purpose}.prefers-structured-exact`);
  }
  if ((purpose === 'visible' || purpose === 'clickability') && entry.source.kind === 'pixel' && entry.source.visiblePixels) {
    reasonCodes.push(`purpose.${purpose}.prefers-visible-pixel`);
  }
  if (
    (purpose === 'visible' || purpose === 'clickability') &&
    isTargetBound(entry, context) &&
    candidates.some((candidate) => candidate.scope.kind === 'screen')
  ) {
    reasonCodes.push('scope.target-bound-over-fullscreen');
  }
  if (isEvidenceUncertain(entry)) reasonCodes.push('uncertainty.present');
  return uniqueStrings(reasonCodes);
}

function selectionReasonCodes(
  rankedEntry: ComputerUseRankedEvidenceEntry,
  rankedEntries: readonly ComputerUseRankedEvidenceEntry[],
) {
  const reasonCodes = [...rankedEntry.reasonCodes];
  const higherConfidenceOlder = rankedEntries.some((candidate) => {
    return (
      candidate.entry.ref !== rankedEntry.entry.ref &&
      candidate.entry.confidence > rankedEntry.entry.confidence &&
      candidate.entry.freshness.observedAtMs < rankedEntry.entry.freshness.observedAtMs
    );
  });
  if (higherConfidenceOlder) reasonCodes.push('freshness-over-confidence');
  return uniqueStrings(reasonCodes);
}

function selectEvidenceForPurpose(
  ranked: readonly ComputerUseRankedEvidenceEntry[],
  purpose: ComputerUseEvidencePurpose,
): ComputerUseRankedEvidenceEntry | undefined {
  const selected = ranked[0];
  if (!selected) return undefined;
  if ((purpose === 'visible' || purpose === 'clickability') && isEvidenceUncertain(selected.entry)) {
    const vision = ranked.find((candidate) => candidate.entry.source.kind === 'vision' && !isEvidenceUncertain(candidate.entry));
    if (vision) {
      return {
        ...vision,
        reasonCodes: uniqueStrings([...vision.reasonCodes, 'uncertainty.escalated-to-vision']),
      };
    }
  }
  return selected;
}

function computeNextObservation(
  snapshot: ComputerUseObservationSnapshot,
  purposes: readonly ComputerUseEvidencePurpose[],
): ComputerUseLocalControllerBrief['nextObservation'] {
  const reasonCodes: string[] = [];
  let recommendedCostTier: ComputerUseEvidenceCostTier | undefined;
  let structuredCapabilitySufficient = false;

  for (const purpose of purposes) {
    const selected = snapshot.selectedEvidence[purpose];
    if (!selected) {
      reasonCodes.push(`missing.${purpose}`);
      recommendedCostTier = lowestRecommendedTier(recommendedCostTier, defaultTierForPurpose(purpose));
      continue;
    }
    if (isStructuredHostCapability(selected.entry)) structuredCapabilitySufficient = true;
    if ((purpose === 'visible' || purpose === 'clickability') && selected.entry.source.kind !== 'pixel' && selected.entry.source.kind !== 'vision') {
      reasonCodes.push('uncertainty.requires-visible-pixel');
      recommendedCostTier = lowestRecommendedTier(recommendedCostTier, 'T2');
    }
    if ((purpose === 'visible' || purpose === 'clickability') && isSelectionUncertain(selected)) {
      reasonCodes.push('uncertainty.requires-vision');
      recommendedCostTier = lowestRecommendedTier(recommendedCostTier, 'T4');
    }
  }

  return {
    required: reasonCodes.length > 0,
    recommendedCostTier,
    reasonCodes: uniqueStrings([
      ...reasonCodes,
      reasonCodes.length === 0 && structuredCapabilitySufficient ? 'structured-capability.sufficient' : undefined,
    ]),
  };
}

function compareRankedEvidence(a: ComputerUseRankedEvidenceEntry, b: ComputerUseRankedEvidenceEntry) {
  return (
    b.score.purpose - a.score.purpose ||
    b.score.context - a.score.context ||
    b.score.scope - a.score.scope ||
    b.score.freshness - a.score.freshness ||
    b.score.confidence - a.score.confidence ||
    b.score.cost - a.score.cost ||
    a.entry.ref.localeCompare(b.entry.ref)
  );
}

function matchesActionContext(
  entry: ComputerUseEvidenceLedgerEntry,
  action: ComputerUseMutatingActionInvalidationInput['action'],
) {
  if (action.owner && entry.owner && entry.owner !== action.owner) return false;
  if (action.sessionRef && entry.sessionRef && entry.sessionRef !== action.sessionRef) return false;
  if (!action.targetRef) return true;
  return entryTargetRef(entry) === action.targetRef;
}

function entryTargetRef(entry: ComputerUseEvidenceLedgerEntry) {
  return entry.targetRef ?? entry.scope.targetRef;
}

function normalizeEvidenceEntryForContext(
  entry: ComputerUseEvidenceLedgerEntry,
  context: ComputerUseEvidenceSelectionContext,
): ComputerUseEvidenceLedgerEntry {
  if ((!context.targetRef && !context.windowRef) || entry.scope.kind === 'screen' || entry.scope.kind === 'global') {
    return entry;
  }
  const scope = { ...entry.scope };
  if (context.targetRef && !scope.targetRef && (scope.kind === 'target' || scope.kind === 'target-crop')) {
    scope.targetRef = context.targetRef;
  }
  if (context.windowRef && !scope.windowRef && scope.kind !== 'file' && scope.kind !== 'artifact') {
    scope.windowRef = context.windowRef;
  }
  if (scope === entry.scope) return entry;
  return {
    ...entry,
    targetRef: entry.targetRef ?? scope.targetRef,
    scope,
  };
}

function isTargetBound(entry: ComputerUseEvidenceLedgerEntry, context: ComputerUseEvidenceSelectionContext) {
  if (!context.targetRef) return false;
  return entryTargetRef(entry) === context.targetRef && entry.scope.kind !== 'screen' && entry.scope.kind !== 'global';
}

function isEvidenceUncertain(entry: ComputerUseEvidenceLedgerEntry) {
  return Boolean(entry.facts?.uncertainty) || entry.confidence < 0.5;
}

function isStructuredHostCapability(entry: ComputerUseEvidenceLedgerEntry) {
  const capability = entry.source.capabilityKind?.toLowerCase();
  if (!capability) return false;
  return entry.source.exact === true && /^(?:browser-host-session|cdp|dom|ax|accessibility|uia|app-native-command|pty|editor|file|validator)$/.test(capability);
}

function isSelectionUncertain(selection: ComputerUseEvidenceSelection | undefined) {
  return Boolean(selection && isEvidenceUncertain(selection.entry) && !selection.reasonCodes.includes('uncertainty.escalated-to-vision'));
}

function uniquePurposes(purposes: readonly ComputerUseEvidencePurpose[]) {
  return Array.from(new Set(purposes));
}

function uniqueStrings(values: readonly (string | undefined)[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function maxFinite(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : undefined;
}

function minFinite(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.min(...finite) : undefined;
}

function defaultTierForPurpose(purpose: ComputerUseEvidencePurpose): ComputerUseEvidenceCostTier {
  if (purpose === 'visible' || purpose === 'clickability' || purpose === 'grounding') return 'T2';
  if (purpose === 'verification') return 'T5';
  if (purpose === 'metadata') return 'T0';
  return 'T1';
}

function lowestRecommendedTier(
  current: ComputerUseEvidenceCostTier | undefined,
  next: ComputerUseEvidenceCostTier,
): ComputerUseEvidenceCostTier {
  if (!current) return next;
  return computerUseEvidenceCostTiers[next].rank > computerUseEvidenceCostTiers[current].rank ? next : current;
}
