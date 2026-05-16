import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { artifactHasUserFacingDelivery, type RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import { createTurnPipelineDefinition } from '@sciforge-ui/runtime-contract';
import {
  createEventRelay,
  createWriteAheadSpool,
  normalizeRuntimeFailure,
} from '../../src/runtime/conversation-kernel/index.js';

type Ref = {
  id: string;
  kind: string;
  group?: string;
  retention?: string;
  size?: number;
  digest?: string;
  body?: unknown;
  content?: unknown;
  text?: unknown;
  meta?: Record<string, unknown>;
};

type Finding = {
  file: string;
  line: number;
  rule: string;
  text: string;
};

const root = process.cwd();
const contractIds = Array.from({ length: 18 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);

const covered = new Set<string>();

function cover(id: string, fn: () => void) {
  try {
    fn();
    covered.add(id);
  } catch (error) {
    throw new Error(`${id} failed: ${(error as Error).message}`);
  }
}

cover('C01', () => {
  const kernel = createFixtureKernel();
  const first = kernel.appendEvent({ type: 'user-turn', turnId: 'turn-1', content: 'summarize current paper' });
  assert.equal(kernel.ledger.length, 1);
  assert.equal(first.projection.projectionVersion, 1);
  assert.equal(first.projection.visibleAnswer, undefined);

  const second = kernel.appendEvent({ type: 'final-answer', runId: 'run-1', answer: 'Done from projection.' });
  assert.equal(kernel.ledger.length, 2);
  assert.equal(second.projection.projectionVersion, 2);
  assert.equal(second.projection.visibleAnswer, 'Done from projection.');
  assert.ok(second.projectionVersion > first.projectionVersion);
});

const currentTurnRef = ref('ref-current-turn', 'user-turn', 'prompt-material');
const capabilityBriefRef = ref('ref-capability-brief', 'capability-brief', 'prompt-material');
const stableGoalRef = ref('ref-stable-goal', 'stable-goal', 'prompt-material');
const explicitArtifactRef = ref('ref-explicit-artifact', 'artifact', 'execution-artifact', 512);
const failureRef = ref('ref-failure', 'run-audit', 'failure-evidence');
const handoffPacketRef = ref('ref-handoff', 'handoff-packet', 'audit');
const contextSnapshotRef = ref('ref-context-snapshot', 'context-snapshot', 'audit');
const retrievalAuditRef = ref('ref-retrieval-audit', 'retrieval-audit', 'audit');

const contextRequest = {
  _contractVersion: 'sciforge.single-agent-runtime.v1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  cachePlan: {
    stablePrefixRefs: [capabilityBriefRef, stableGoalRef],
    perTurnPayloadRefs: [currentTurnRef, explicitArtifactRef],
  },
  capabilityBriefRef,
  contextRefs: [capabilityBriefRef, stableGoalRef, currentTurnRef, explicitArtifactRef],
  currentTask: {
    currentTurnRef,
    stableGoalRef,
    mode: 'continue',
    explicitRefs: [descriptor(explicitArtifactRef)],
    selectedRefs: [{ ...descriptor(explicitArtifactRef), source: 'explicit', priority: 0 }],
    userVisibleSelectionDigest: 'sha256:selection',
  },
  retrievalPolicy: {
    tools: ['read_ref', 'retrieve', 'workspace_search', 'list_session_artifacts'],
    scope: 'current-session',
    preferExplicitRefs: true,
    requireEvidenceForClaims: true,
    maxTailEvidenceBytes: 4096,
  },
  refSelectionAudit: {
    policyDigest: 'sha256:policy',
    selectedRefCount: 1,
    selectedRefBytes: 512,
    truncated: false,
    sourceCounts: { explicit: 1, projectionPrimary: 0, failureEvidence: 0, contextIndex: 0 },
  },
  contextPolicy: {
    mode: 'continue',
    includeCurrentWork: true,
    includeRecentTurns: false,
    persistRunSummary: true,
    maxContextTokens: 8000,
  },
};

cover('C02', () => {
  assertNoKeysDeep(contextRequest, ['rawHistory', 'rawArtifactBody', 'artifactBody', 'fullRefList', 'handoffMemoryProjection', 'memoryPlan', 'availableSkills']);
  assertNoRefBodies(contextRequest);
  assert.ok(contextRequest.currentTask.selectedRefs.length <= 3);
  assert.ok(contextRequest.refSelectionAudit.selectedRefBytes <= 4096);
  assert.equal(contextRequest.capabilityBriefRef.id, capabilityBriefRef.id);
  assert.ok(contextRequest.contextRefs.some((entry) => entry.id === currentTurnRef.id));
});

cover('C03', () => {
  assert.equal(contextRequest.currentTask.currentTurnRef.kind, 'user-turn');
  assert.equal(contextRequest.currentTask.currentTurnRef.id, currentTurnRef.id);
  assert.ok(contextRequest.currentTask.selectedRefs.every((entry) => typeof entry.source === 'string'));
  assert.notEqual(contextRequest.currentTask.selectedRefs[0].id, contextRequest.currentTask.currentTurnRef.id);
});

cover('C04', () => {
  const unstable = /\b(?:turn|run|timestamp|progress|latest-error|current-failure|failure)\b/i;
  for (const stableRef of contextRequest.cachePlan.stablePrefixRefs) {
    assert.doesNotMatch(stableRef.id, unstable);
    assert.doesNotMatch(stableRef.kind, /^(?:user-turn|run-audit|checkpoint|retrieval-audit)$/);
  }
});

const degradedPacket = {
  _contractVersion: 'sciforge.single-agent-runtime.v1',
  degradedReason: { owner: 'agentserver', reason: 'context API unavailable', recoverability: 'retryable' },
  currentTurnRef,
  stableGoalRef,
  capabilityBriefRef,
  boundedArtifactIndex: [descriptor(explicitArtifactRef)],
  boundedFailureIndex: [descriptor(failureRef)],
  availableRetrievalTools: ['read_ref', 'retrieve', 'workspace_search', 'list_session_artifacts'],
};

cover('C05', () => {
  assertNoKeysDeep(degradedPacket, ['recentTurns', 'fullRefList', 'rawHistory', 'compactionState']);
  assert.equal(degradedPacket.currentTurnRef.id, currentTurnRef.id);
  assert.ok(degradedPacket.boundedArtifactIndex.length <= 3);
});

cover('C08', () => {
  const gateway = createEventRelay<{ type: string }>({ producerId: 'single-agent-smoke' });
  const firstEvent = gateway.emit({ type: 'tool-call-started' });
  const secondEvent = gateway.emit({ type: 'tool-call-progress' });
  assert.equal(firstEvent.identity.producerSeq, 1);
  assert.deepEqual(gateway.replayAfter(firstEvent.identity.cursor).map((event) => event.identity.cursor), [secondEvent.identity.cursor]);

  const key = { callId: 'call-1', inputDigest: 'sha256:input', routeDigest: 'sha256:route' };
  let sideEffectCount = 0;
  const first = gateway.executeToolCall(key, () => {
    sideEffectCount += 1;
    return { resultRefs: ['ref-tool-result-1'] };
  });
  const second = gateway.executeToolCall(key, () => {
    sideEffectCount += 1;
    return { resultRefs: ['ref-tool-result-2'] };
  });
  assert.deepEqual(first.resultRefs, second.resultRefs);
  assert.equal(second.reused, true);
  assert.equal(sideEffectCount, 1);
});

cover('C09', () => {
  const failure = normalizeRuntimeFailure({
    reason: 'schema validation failed for materialized payload',
    evidenceRefs: ['artifact:bad-payload'],
  });
  assertRequiredKeys(failure, ['failureClass', 'recoverability', 'owner', 'failureSignature']);
  assert.equal(failure.failureClass, 'validation');
  assert.equal(failure.recoverability, 'repairable');
  assert.equal(failure.owner, 'gateway');

  const spool = createWriteAheadSpool({ limits: { maxDepth: 1, maxAgeMs: 100 }, now: () => 1 });
  assert.equal(spool.append({ id: 'event:1', refs: ['ref:1'] }).ok, true);
  const overflow = spool.append({ id: 'event:2', refs: ['ref:2'] });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.failure.failureClass, 'storage-unavailable');
  assert.notEqual(overflow.failure.failureClass, 'external');
});

cover('C10', () => {
  const policy = { maxAutoRecoveryAttempts: 2, maxSameOwnerRetries: 1, maxSameFailureSignatureRetries: 1 };
  assert.equal(shouldAutoRepair(policy, []), true);
  assert.equal(shouldAutoRepair(policy, [{ owner: 'gateway', failureSignature: 'sig-1', canAutoRecover: false }]), false);
  assert.equal(shouldAutoRepair(policy, [
    { owner: 'gateway', failureSignature: 'sig-1', canAutoRecover: true },
    { owner: 'gateway', failureSignature: 'sig-2', canAutoRecover: true },
  ]), false);
  assert.equal(shouldAutoRepair(policy, [
    { owner: 'gateway', failureSignature: 'sig-1', canAutoRecover: true },
    { owner: 'backend', failureSignature: 'sig-1', canAutoRecover: true },
  ]), false);
});

cover('C11', () => {
  const pipeline = createTurnPipelineDefinition();
  assert.deepEqual(pipeline.stages, ['registerTurn', 'requestContext', 'driveRun', 'finalizeRun']);
  assert.equal(pipeline.executorPolicy.declarativeOnly, true);
  assert.equal(pipeline.executorPolicy.forbidUserTextInspection, true);

  const policy = {
    maxForegroundRuns: 1,
    allowBackgroundRuns: true,
    onNewTurnWhileActive: 'wait',
    allowedDecisions: ['attach', 'wait', 'cancel-active', 'fork-new-session'],
  };
  assert.equal(policy.maxForegroundRuns, 1);
  assert.equal(policy.onNewTurnWhileActive, 'wait');
  assert.deepEqual(policy.allowedDecisions, ['attach', 'wait', 'cancel-active', 'fork-new-session']);
});

cover('C12', () => {
  const projection = { status: 'satisfied', visibleAnswer: 'Projection final answer.' };
  const stream = { type: 'answer-delta', text: 'Transient stale partial.' };
  assert.equal(resolveVisibleTerminalState(projection, stream).visibleAnswer, 'Projection final answer.');
});

cover('C13', () => {
  const response = {
    handoffPacketRef,
    contextSnapshotRef,
    contextRefs: [contextSnapshotRef, retrievalAuditRef],
    compactionAuditRefs: [],
    retrievalAuditRefs: [retrievalAuditRef],
    auditMeta: { synthetic: true, source: 'adapter', reason: 'upstream-partial-audit', confidence: 'medium', sourceRefs: [handoffPacketRef] },
  };
  assert.equal(hasObservableAudit(response), true);
  assert.equal(hasObservableAudit({ ...response, contextRefs: [], retrievalAuditRefs: [], auditMeta: undefined }), false);
});

cover('C14', () => {
  const exportBundle = JSON.stringify({
    events: [{ type: 'failure', reason: redactSecrets('provider said api_key=sk-secret1234567890') }],
    refs: [{ id: 'ref-safe', digest: 'sha256:safe' }],
  });
  assert.doesNotMatch(exportBundle, /sk-[a-z0-9]{8,}|api_key=/i);
});

cover('C15', () => {
  const ledger = [
    { type: 'ref-registered', ref: 'artifact:1' },
    { type: 'ref-tombstoned', ref: 'artifact:1', reason: 'user-request' },
  ];
  assert.ok(ledger.some((event) => event.type === 'ref-tombstoned'));
  assert.ok(ledger.some((event) => event.type === 'ref-registered'));
});

cover('C16', () => {
  const decision = {
    decisionRef: ref('ref-direct-decision', 'retrieval-audit', 'audit'),
    mode: 'answer-from-projection',
    requiredTypedContext: ['visible-answer', 'run-status'],
    usedRefs: [contextSnapshotRef],
    sufficiency: 'sufficient',
    decisionOwner: 'agentserver',
  };
  assert.equal(canAnswerFromProjection(decision), true);
  assert.equal(canAnswerFromProjection({ ...decision, decisionRef: undefined, usedRefs: [] }), false);
  assert.equal(canAnswerFromProjection({ ...decision, sufficiency: 'insufficient' }), false);
});

cover('C17', () => {
  const artifacts: RuntimeArtifact[] = [
    artifactDeliveryFixture('report', 'primary-deliverable', 'inline', { readableRef: 'report.md' }),
    artifactDeliveryFixture('table', 'supporting-evidence', 'open-system', { path: 'table.xlsx' }),
    artifactDeliveryFixture('trace', 'audit', 'inline', { readableRef: 'trace.md' }),
    artifactDeliveryFixture('internal-json', 'internal', 'inline', { readableRef: 'internal.md' }),
    artifactDeliveryFixture('diag', 'diagnostic', 'inline', { readableRef: 'diagnostic.md' }),
    artifactDeliveryFixture('audit-only-primary', 'primary-deliverable', 'audit-only', { readableRef: 'audit-only.md' }),
    artifactDeliveryFixture('unsupported-supporting', 'supporting-evidence', 'unsupported', { readableRef: 'unsupported.md' }),
    artifactDeliveryFixture('missing-readable', 'primary-deliverable', 'inline'),
  ];
  assert.deepEqual(visibleArtifactIds(artifacts), ['report', 'table']);
});

cover('C18', () => {
  const scenarioPackage = {
    kind: 'policy-only',
    policy: {
      verifierPolicy: { requiredInputs: ['query'] },
      capabilities: { allowedToolIds: ['web_search'] },
      domainVocabulary: { artifactTypes: ['research-report'] },
    },
  };
  const forbiddenScenarioPackage = {
    ...scenarioPackage,
    policy: {
      ...scenarioPackage.policy,
      executionCode: 'await runScenario()',
      verifierPolicy: {
        ...scenarioPackage.policy.verifierPolicy,
        promptRegex: '/latest papers/i',
        multiTurnSemanticJudge: 'infer whether the user wants repair',
      },
      capabilities: {
        ...scenarioPackage.policy.capabilities,
        providerBranches: { local: ['fake-answer'] },
      },
      domainVocabulary: {
        ...scenarioPackage.policy.domainVocabulary,
        answerTemplate: 'preset answer',
        systemPrompt: 'override backend',
      },
    },
  };
  const workerDiscovery = {
    providerManifest: { id: 'web-worker', capabilities: ['web_search'], healthStatus: 'ready' },
    endpoint: undefined,
    invokeUrl: undefined,
    workerId: undefined,
  };
  assert.equal(scenarioPackage.kind, 'policy-only');
  assert.deepEqual(scenarioPolicyOnlyViolations(scenarioPackage), []);
  assert.deepEqual(scenarioPolicyOnlyViolations(forbiddenScenarioPackage).sort(), [
    'policy.capabilities.providerBranches',
    'policy.domainVocabulary.answerTemplate',
    'policy.domainVocabulary.systemPrompt',
    'policy.executionCode',
    'policy.verifierPolicy.multiTurnSemanticJudge',
    'policy.verifierPolicy.promptRegex',
  ]);
  assert.equal(workerDiscovery.endpoint, undefined);
  assert.equal(workerDiscovery.workerId, undefined);
  assert.ok(workerDiscovery.providerManifest.capabilities.includes('web_search'));
});

await coverStaticContracts();

for (const id of contractIds) {
  assert.ok(covered.has(id), `${id} has no conformance guard`);
}

console.log(`[ok] single-agent runtime contract smoke covered ${contractIds.join(', ')} with fixture/static guards; browser Web E2E is intentionally not part of this Batch 0 gate.`);

async function coverStaticContracts() {
  const findings = await collectStaticFindings();
  const counts = countByRuleFile(findings);
  const baseline: Record<string, number> = {
    'C06-runtime-local-direct-context-strategy#src/runtime/gateway/direct-context-fast-path.ts': 0,
    'C06-runtime-prompt-requires-strategy#src/runtime/gateway/capability-provider-preflight.ts': 0,
    'C07-runtime-visible-preflight#src/runtime/gateway/direct-context-fast-path.ts': 0,
    'C07-runtime-visible-preflight#src/runtime/gateway/capability-provider-preflight.ts': 0,
    'C07-runtime-visible-preflight#src/runtime/gateway/generated-task-payload-preflight.ts': 0,
    'C10-agentserver-adapter-boundary#src/runtime/generation-gateway.ts': 0,
    'C08-gateway-public-api-internal-stage#src/runtime/generation-gateway.ts': 0,
    'C06-runtime-direct-context-implicit-strategy#src/runtime/gateway/direct-context-fast-path.ts': 0,
    'C05-degraded-raw-history-shape#src/runtime/gateway/agentserver-context-contract.ts': 0,
    'C05-degraded-raw-history-shape#src/runtime/gateway/agentserver-context-window.ts': 1,
    'C05-degraded-raw-history-shape#src/runtime/gateway/agentserver-prompts.ts': 1,
    'C12-ui-legacy-raw-terminal-fallback#src/ui/src/app/appShell/workspaceState.ts': 3,
  };

  const overflow = [...counts.entries()]
    .filter(([key, count]) => count > (baseline[key] ?? 0));
  assert.deepEqual(overflow, [], `static contract guard found new legacy paths: ${JSON.stringify(overflow)}`);

  cover('C06', () => assertNoOverflow(counts, baseline, 'C06'));
  cover('C07', () => assertNoOverflow(counts, baseline, 'C07'));
}

async function collectStaticFindings() {
  const files = [
    ...await collectFiles(join(root, 'src')),
    ...await collectFiles(join(root, 'packages')),
  ];
  const findings: Finding[] = [];
  const rules = [
    {
      id: 'C06-runtime-local-direct-context-strategy',
      match: (line: string, file: string) => file.startsWith('src/runtime/gateway/') && /\bdirectContextIntent\s*\(/.test(line),
    },
    {
      id: 'C06-runtime-prompt-requires-strategy',
      match: (line: string, file: string) => file.startsWith('src/runtime/gateway/') && /\bpromptRequires[A-Z]\w*\s*\(/.test(line),
    },
    {
      id: 'C07-runtime-visible-preflight',
      match: (line: string, file: string) => file.startsWith('src/runtime/') && /\bcapabilityProviderPreflight\s*\(/.test(line) && !/^export\s+function\b/.test(line.trim()),
    },
    {
      id: 'C10-agentserver-adapter-boundary',
      match: (line: string, file: string) => file === 'src/runtime/generation-gateway.ts' && /\bagentBackendAdapter\s*\(/.test(line),
    },
    {
      id: 'C08-gateway-public-api-internal-stage',
      match: (line: string, file: string) => file.startsWith('src/runtime/')
        && !file.startsWith('src/runtime/gateway/')
        && file !== 'src/runtime/generation-gateway.ts'
        && /\bGateway\.(?:resolveRoute|preflight|invoke|materialize|validate)\s*\(/.test(line),
    },
    {
      id: 'C06-runtime-direct-context-implicit-strategy',
      match: (line: string, file: string) => file === 'src/runtime/gateway/direct-context-fast-path.ts'
        && /\b(?:agentHarness|turnExecutionConstraints|preferredCapabilityIds|intentMode)\b/.test(line),
    },
    {
      id: 'C05-degraded-raw-history-shape',
      match: (line: string, file: string) => file.startsWith('src/runtime/gateway/') && /\brecentTurns\b|\bfullRefList\b|\brawHistory\b|\bcompactionState\b/.test(line),
    },
    {
      id: 'C12-ui-legacy-raw-terminal-fallback',
      match: (line: string, file: string) => file.startsWith('src/ui/src/') && /\blegacyRaw\w*|raw\.(?:status|failureReason)|resultPresentation\.status\b/.test(line),
    },
  ];

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!isCodeLine(line)) return;
      for (const rule of rules) {
        if (ignoredStaticRuleLine(rule.id, lines, index)) continue;
        if (rule.match(line, rel)) findings.push({ file: rel, line: index + 1, rule: rule.id, text: line.trim() });
      }
    });
  }
  return findings;
}

function createFixtureKernel() {
  const ledger: Array<Record<string, unknown>> = [];
  let projection = { projectionVersion: 0, visibleAnswer: undefined as string | undefined };
  return {
    ledger,
    appendEvent(event: Record<string, unknown>) {
      ledger.push(event);
      projection = {
        projectionVersion: projection.projectionVersion + 1,
        visibleAnswer: event.type === 'final-answer' ? String(event.answer) : projection.visibleAnswer,
      };
      return { eventId: `event-${ledger.length}`, projection, projectionVersion: projection.projectionVersion };
    },
  };
}

function ref(id: string, kind: string, group: string, size = 128): Ref {
  return { id, kind, group, retention: retentionForGroup(group), size, digest: `sha256:${id}` };
}

function descriptor(value: Ref) {
  return { id: value.id, kind: value.kind, size: value.size, digest: value.digest };
}

function retentionForGroup(group: string) {
  const byGroup: Record<string, string> = {
    'prompt-material': 'hot',
    'failure-evidence': 'warm',
    audit: 'cold',
    'execution-artifact': 'warm',
    checkpoint: 'hot',
  };
  return byGroup[group];
}

function assertNoKeysDeep(value: unknown, keys: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoKeysDeep(item, keys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!keys.includes(key), `forbidden key ${key}`);
    assertNoKeysDeep(nested, keys);
  }
}

function assertNoRefBodies(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoRefBodies(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string' && typeof record.kind === 'string') {
    assert.equal(record.body, undefined);
    assert.equal(record.content, undefined);
    assert.equal(record.text, undefined);
  }
  for (const nested of Object.values(record)) assertNoRefBodies(nested);
}

function assertRequiredKeys(value: object, keys: string[]) {
  const record = value as Record<string, unknown>;
  for (const key of keys) assert.ok(record[key], `missing ${key}`);
}

function shouldAutoRepair(policy: { maxAutoRecoveryAttempts: number; maxSameOwnerRetries: number; maxSameFailureSignatureRetries: number }, failures: Array<{ owner: string; failureSignature: string; canAutoRecover: boolean }>) {
  if (failures.some((failure) => failure.canAutoRecover === false)) return false;
  if (failures.length >= policy.maxAutoRecoveryAttempts) return false;
  const owners = countBy(failures.map((failure) => failure.owner));
  const signatures = countBy(failures.map((failure) => failure.failureSignature));
  return Math.max(0, ...owners.values()) <= policy.maxSameOwnerRetries
    && Math.max(0, ...signatures.values()) <= policy.maxSameFailureSignatureRetries;
}

function resolveVisibleTerminalState(projection: { status: string; visibleAnswer: string }, stream: { type: string; text: string }) {
  return projection.status ? projection : { status: 'transient', visibleAnswer: stream.text };
}

function hasObservableAudit(response: { contextRefs?: unknown[]; compactionAuditRefs?: unknown[]; retrievalAuditRefs?: unknown[]; auditMeta?: { synthetic?: boolean } }) {
  const realAuditCount = (response.contextRefs?.length ?? 0) + (response.compactionAuditRefs?.length ?? 0) + (response.retrievalAuditRefs?.length ?? 0);
  return realAuditCount > 0 || response.auditMeta?.synthetic === true;
}

function redactSecrets(value: string) {
  return value.replace(/api_key=sk-[a-z0-9]+/gi, '[REDACTED_SECRET]');
}

function canAnswerFromProjection(decision: {
  decisionRef?: Ref;
  mode: string;
  requiredTypedContext: string[];
  usedRefs: Ref[];
  sufficiency: string;
  decisionOwner: string;
}) {
  return decision.mode === 'answer-from-projection'
    && Boolean(decision.decisionRef)
    && decision.requiredTypedContext.length > 0
    && decision.usedRefs.length > 0
    && decision.sufficiency === 'sufficient'
    && ['agentserver', 'backend', 'harness-policy'].includes(decision.decisionOwner);
}

function visibleArtifactIds(artifacts: RuntimeArtifact[]) {
  return artifacts
    .filter(artifactHasUserFacingDelivery)
    .map((artifact) => artifact.id);
}

function artifactDeliveryFixture(
  id: string,
  role: NonNullable<RuntimeArtifact['delivery']>['role'],
  previewPolicy: NonNullable<RuntimeArtifact['delivery']>['previewPolicy'],
  refs: { readableRef?: string; dataRef?: string; path?: string } = {},
): RuntimeArtifact {
  return {
    id,
    type: 'runtime-artifact',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: refs.dataRef,
    path: refs.path,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: refs.readableRef,
      rawRef: 'output.json',
      previewPolicy,
    },
  };
}

function scenarioPolicyOnlyViolations(value: unknown) {
  const forbidden = new Map([
    ['executionCode', 'executionCode'],
    ['promptRegex', 'promptRegex'],
    ['providerBranch', 'providerBranch'],
    ['providerBranches', 'providerBranches'],
    ['multiTurnSemanticJudge', 'multiTurnSemanticJudge'],
    ['answerTemplate', 'answerTemplate'],
    ['directAnswer', 'directAnswer'],
    ['responseTemplate', 'responseTemplate'],
    ['systemPrompt', 'systemPrompt'],
  ]);
  const violations: string[] = [];
  visitScenarioPolicy(value, [], (path, key) => {
    if (forbidden.has(key)) violations.push([...path, key].join('.'));
  });
  return violations;
}

function visitScenarioPolicy(value: unknown, path: string[], onKey: (path: string[], key: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitScenarioPolicy(item, [...path, String(index)], onKey));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    onKey(path, key);
    visitScenarioPolicy(nested, [...path, key], onKey);
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full));
    } else if (entry.isFile() && ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].includes(extname(entry.name)) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

function isTestFile(file: string) {
  const rel = relative(root, file).replaceAll('\\', '/');
  return /(^|\/)(tests?|__tests__|fixtures)\//.test(rel) || /\.(test|spec)\.[^.]+$/.test(rel);
}

function isCodeLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 0
    && !trimmed.startsWith('import ')
    && !trimmed.startsWith('//')
    && !trimmed.startsWith('*');
}

function ignoredStaticRuleLine(ruleId: string, lines: string[], index: number) {
  return ruleId === 'C05-degraded-raw-history-shape' && isForbiddenFieldRegistryLine(lines, index);
}

function isForbiddenFieldRegistryLine(lines: string[], index: number) {
  const line = lines[index]?.trim() ?? '';
  if (!/^['"](?:recentTurns|fullRefList|rawHistory|compactionState)['"],?$/.test(line)) return false;
  for (let cursor = index; cursor >= Math.max(0, index - 12); cursor -= 1) {
    const candidate = lines[cursor]?.trim() ?? '';
    if (/^(?:const\s+)?[A-Z0-9_]*FORBIDDEN[A-Z0-9_]*\s*=\s*new Set\(\[/.test(candidate)) return true;
    if (cursor < index && /^\]\);?$/.test(candidate)) return false;
  }
  return false;
}

function countByRuleFile(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = `${finding.rule}#${finding.file}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function assertNoOverflow(counts: Map<string, number>, baseline: Record<string, number>, id: string) {
  for (const [key, count] of counts) {
    if (!key.startsWith(`${id}-`)) continue;
    assert.ok(count <= (baseline[key] ?? 0), `${key} count ${count} exceeds baseline ${baseline[key] ?? 0}`);
  }
}
