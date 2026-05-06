import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextCompactionFailureResult, buildContextCompactionOutcome } from './contextCompaction';
import { buildContextWindowMeterModel, contextWindowLevel, estimateContextWindowState, latestContextWindowState, shouldAutoCompact, shouldStartContextCompaction } from './contextWindow';
import type { AgentContextWindowState, SciForgeConfig, SciForgeSession } from './domain';

const beforeState: AgentContextWindowState = {
  usedTokens: 86_000,
  windowTokens: 100_000,
  ratio: 0.86,
  source: 'estimate',
  backend: 'codex',
  compactCapability: 'native',
  autoCompactThreshold: 0.82,
  watchThreshold: 0.68,
  nearLimitThreshold: 0.86,
  pendingCompact: true,
};

test('buildContextCompactionOutcome records successful compact as a light system observation', () => {
  const outcome = buildContextCompactionOutcome({
    eventId: 'evt-compact',
    messageId: 'msg-compact',
    result: {
      status: 'completed',
      source: 'agentserver',
      backend: 'codex',
      compactCapability: 'native',
      reason: 'manual-meter-click',
      message: 'compacted by backend',
      auditRefs: ['agentserver://run/compact-1'],
    },
    beforeState,
    reason: 'manual-meter-click',
    startedAt: '2026-05-02T00:00:00.000Z',
    completedAt: '2026-05-02T00:00:01.000Z',
    fallbackBackend: 'codex',
  });

  assert.equal(outcome.event.contextCompaction?.status, 'completed');
  assert.equal(outcome.event.contextWindowState?.pendingCompact, false);
  assert.equal(outcome.event.contextWindowState?.lastCompactedAt, '2026-05-02T00:00:01.000Z');
  assert.equal(outcome.message.role, 'system');
  assert.equal(outcome.message.status, 'completed');
  assert.match(outcome.message.content, /上下文压缩完成/);
  assert.equal(outcome.message.references?.[0]?.ref, 'agentserver://run/compact-1');
  assert.match(outcome.message.expandable ?? '', /"before"/);
});

test('buildContextCompactionFailureResult keeps failure recoverable for the next turn', () => {
  const failure = buildContextCompactionFailureResult({
    error: new Error('compact API unavailable'),
    reason: 'manual-meter-click',
    backend: 'gemini',
    compactCapability: 'session-rotate',
    startedAt: '2026-05-02T00:00:00.000Z',
  });
  const outcome = buildContextCompactionOutcome({
    eventId: 'evt-failed',
    messageId: 'msg-failed',
    result: failure,
    beforeState,
    reason: 'manual-meter-click',
    startedAt: '2026-05-02T00:00:00.000Z',
    completedAt: '2026-05-02T00:00:02.000Z',
    fallbackBackend: 'gemini',
  });

  assert.equal(outcome.event.contextCompaction?.status, 'failed');
  assert.equal(outcome.event.contextWindowState?.pendingCompact, false);
  assert.match(outcome.message.content, /上下文压缩未完成/);
  assert.equal(outcome.message.status, 'completed');
  assert.equal(outcome.message.references?.[0]?.kind, 'message');
  assert.match(outcome.message.references?.[0]?.ref ?? '', /context-compaction-failure/);
  assert.match(JSON.stringify(outcome.message.references?.[0]?.payload), /compact API unavailable/);
});

test('buildContextCompactionOutcome avoids duplicate pending failure wording', () => {
  const outcome = buildContextCompactionOutcome({
    eventId: 'evt-pending',
    messageId: 'msg-pending',
    result: {
      status: 'pending',
      source: 'agentserver',
      backend: 'codex',
      compactCapability: 'agentserver',
      reason: 'manual-meter-click',
    },
    beforeState,
    reason: 'manual-meter-click',
    startedAt: '2026-05-02T00:00:00.000Z',
    completedAt: '2026-05-02T00:00:02.000Z',
    fallbackBackend: 'codex',
  });

  assert.equal(outcome.message.content, '上下文压缩已提交，等待后台返回完成状态。');
  assert.doesNotMatch(outcome.message.content, /上下文压缩未完成：上下文压缩未完成/);
});

test('context meter display reflects ratio, status, and source trust level', () => {
  const nativeHealthy = buildContextWindowMeterModel({
    ...beforeState,
    usedTokens: 42_000,
    ratio: 0.42,
    source: 'native',
    status: 'healthy',
  }, false);
  assert.equal(nativeHealthy.level, 'ok');
  assert.equal(nativeHealthy.sourceLabel, 'native');
  assert.equal(nativeHealthy.statusLabel, 'healthy');
  assert.equal(nativeHealthy.ratioLabel, '42%');
  assert.equal(nativeHealthy.ratioStyle, '42%');
  assert.equal(nativeHealthy.ratioDetail, '42%');
  assert.equal(nativeHealthy.remainingExact, '58,000');
  assert.match(nativeHealthy.title, /compact threshold: 82%/);
  assert.deepEqual(
    nativeHealthy.detailRows.slice(0, 3),
    [
      { label: 'used/window', value: '42,000 / 100,000 tokens' },
      { label: 'remaining', value: '58,000 tokens' },
      { label: 'ratio', value: '42%' },
    ],
  );

  const providerWatch = buildContextWindowMeterModel({
    ...beforeState,
    usedTokens: 74_000,
    ratio: 0.74,
    source: 'provider-usage',
    status: 'watch',
  }, true);
  assert.equal(providerWatch.level, 'watch');
  assert.equal(providerWatch.sourceLabel, 'provider');
  assert.match(providerWatch.title, /发送前达到阈值时会请求 AgentServer/);

  const estimatedNearLimit = buildContextWindowMeterModel({
    ...beforeState,
    usedTokens: 91_000,
    ratio: 0.91,
    source: 'agentserver-estimate',
    status: 'near-limit',
    budget: {
      rawTokens: 160_000,
      normalizedTokens: 38_000,
      savedTokens: 122_000,
      maxPayloadBytes: 900_000,
      normalizedBytes: 120_000,
      normalizedBudgetRatio: 0.133,
    },
  }, false);
  assert.equal(estimatedNearLimit.level, 'near-limit');
  assert.equal(estimatedNearLimit.statusLabel, 'near-limit');
  assert.equal(estimatedNearLimit.sourceLabel, '估算');
  assert.equal(estimatedNearLimit.isEstimated, true);
  assert.ok(estimatedNearLimit.detailRows.some((row) => row.label === 'payload tokens' && row.value === '38,000 normalized / 160,000 raw'));
  assert.ok(estimatedNearLimit.detailRows.some((row) => row.label === 'saved tokens' && row.value === '122,000'));

  const unknownBlocked = buildContextWindowMeterModel({
    source: 'unknown',
    status: 'blocked',
    compactCapability: 'none',
  }, false);
  assert.equal(unknownBlocked.level, 'near-limit');
  assert.equal(unknownBlocked.isUnknown, true);
  assert.equal(unknownBlocked.ratioLabel, 'unknown');
  assert.match(unknownBlocked.title, /source: 未知/);
});

test('context meter uses ratio as the final authority when backend status is stale', () => {
  const exceeded = buildContextWindowMeterModel({
    ...beforeState,
    usedTokens: 105_000,
    windowTokens: 100_000,
    ratio: 1.05,
    source: 'agentserver',
    status: 'healthy',
  }, false);

  assert.equal(exceeded.level, 'near-limit');
  assert.equal(exceeded.statusLabel, 'exceeded');
  assert.equal(exceeded.ratioLabel, '105%');
});

test('empty estimated context window reports zero usage when the model window is known', () => {
  const state = estimateContextWindowState(emptySession('session-empty'), defaultConfig(), []);

  assert.equal(state.usedTokens, 0);
  assert.equal(state.windowTokens, 200_000);
  assert.equal(state.ratio, 0);
  const meter = buildContextWindowMeterModel(state, false);
  assert.deepEqual(meter.detailRows.slice(0, 3), [
    { label: 'used/window', value: '0 / 200,000 tokens' },
    { label: 'remaining', value: '200,000 tokens' },
    { label: 'ratio', value: '0%' },
  ]);
});

test('estimated context window is monotonic across long multi-turn sessions', () => {
  const base = emptySession('session-long-context');
  const thirtyTurns: SciForgeSession = {
    ...base,
    messages: Array.from({ length: 30 }, (_, index) => ({
      id: `msg-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'scenario',
      content: `Round ${index + 1}: retain this generic multi-turn context for later reuse.`,
      createdAt: `2026-05-03T00:${String(index).padStart(2, '0')}:00.000Z`,
      status: 'completed',
    })),
  };
  const thirtyOneTurns: SciForgeSession = {
    ...thirtyTurns,
    messages: [
      ...thirtyTurns.messages,
      {
        id: 'msg-31',
        role: 'user',
        content: 'Round 31: continue from all previous constraints and refs.',
        createdAt: '2026-05-03T00:31:00.000Z',
        status: 'completed',
      },
    ],
  };

  const first = estimateContextWindowState(thirtyTurns, defaultConfig(), []);
  const next = estimateContextWindowState(thirtyOneTurns, defaultConfig(), []);
  assert.ok((next.usedTokens ?? 0) > (first.usedTokens ?? 0));
});

test('latest context window meter ignores provider usage as current-window authority', () => {
  const state = latestContextWindowState([
    {
      id: 'evt-native',
      type: 'contextWindowState',
      label: '上下文窗口',
      createdAt: '2026-05-03T00:00:00.000Z',
      contextWindowState: {
        source: 'native',
        backend: 'codex',
        usedTokens: 42_000,
        windowTokens: 100_000,
        ratio: 0.42,
        status: 'healthy',
      },
    },
    {
      id: 'evt-provider',
      type: 'usage-update',
      label: '用量',
      createdAt: '2026-05-03T00:00:01.000Z',
      usage: { input: 180_000, output: 200, total: 180_200, cacheRead: 160_000, source: 'provider' },
      contextWindowState: {
        source: 'provider-usage',
        backend: 'codex',
        input: 180_000,
        output: 200,
        cache: 160_000,
        usedTokens: 180_200,
        windowTokens: 100_000,
        ratio: 1.802,
        status: 'exceeded',
      },
    },
  ]);

  assert.equal(state?.source, 'native');
  assert.equal(state?.usedTokens, 42_000);
  assert.equal(state?.status, 'healthy');
});

test('latest context window meter keeps AgentServer native telemetry above later estimates', () => {
  const state = latestContextWindowState([
    {
      id: 'evt-native',
      type: 'contextWindowState',
      label: '上下文窗口',
      createdAt: '2026-05-03T00:00:00.000Z',
      contextWindowState: {
        source: 'native',
        backend: 'codex',
        usedTokens: 6_690,
        windowTokens: 200_000,
        ratio: 0.03345,
        status: 'healthy',
      },
    },
    {
      id: 'evt-estimate',
      type: 'contextWindowState',
      label: '上下文窗口',
      createdAt: '2026-05-03T00:00:01.000Z',
      contextWindowState: {
        source: 'agentserver-estimate',
        backend: 'codex',
        usedTokens: 11_043,
        windowTokens: 200_000,
        ratio: 0.055215,
        status: 'healthy',
      },
    },
  ]);

  assert.equal(state?.source, 'native');
  assert.equal(state?.usedTokens, 6_690);
});

test('latest context window meter can use compaction after-state', () => {
  const state = latestContextWindowState([
    {
      id: 'evt-compact',
      type: 'contextCompaction',
      label: '上下文压缩',
      createdAt: '2026-05-03T00:00:00.000Z',
      contextCompaction: {
        status: 'completed',
        backend: 'codex',
        compactCapability: 'native',
        lastCompactedAt: '2026-05-03T00:00:00.000Z',
        after: {
          source: 'native',
          backend: 'codex',
          usedTokens: 18_000,
          windowTokens: 100_000,
          ratio: 0.18,
          status: 'healthy',
          compactCapability: 'native',
        },
      },
    },
  ]);

  assert.equal(state?.source, 'native');
  assert.equal(state?.usedTokens, 18_000);
  assert.equal(state?.lastCompactedAt, '2026-05-03T00:00:00.000Z');
});

test('latest context window meter preserves previous compaction timestamp across running updates', () => {
  const state = latestContextWindowState([
    {
      id: 'evt-compact-state',
      type: 'contextWindowState',
      label: '上下文窗口',
      createdAt: '2026-05-03T00:00:00.000Z',
      contextWindowState: {
        source: 'agentserver-estimate',
        backend: 'codex',
        usedTokens: 5_297,
        windowTokens: 4_000,
        ratio: 1.324,
        status: 'exceeded',
        lastCompactedAt: '2026-05-02T22:07:13.067Z',
      },
    },
    {
      id: 'evt-running-state',
      type: 'contextWindowState',
      label: '上下文窗口',
      createdAt: '2026-05-03T00:01:00.000Z',
      contextWindowState: {
        source: 'agentserver-estimate',
        backend: 'codex',
        usedTokens: 14_377,
        windowTokens: 20_000,
        ratio: 0.711,
        status: 'watch',
      },
    },
  ]);

  assert.equal(state?.usedTokens, 14_377);
  assert.equal(state?.lastCompactedAt, '2026-05-02T22:07:13.067Z');
});

function emptySession(sessionId: string): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-05-02T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-02T00:00:00.000Z',
  };
}

function defaultConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://localhost:18080',
    workspaceWriterBaseUrl: 'http://localhost:5174',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: 'codex-test',
    apiKey: '',
    requestTimeoutMs: 900_000,
    maxContextWindowTokens: 200_000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-02T00:00:00.000Z',
  };
}

test('auto compact threshold respects backend fallback and unsupported capability', () => {
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.81,
    autoCompactThreshold: 0.82,
    compactCapability: 'native',
  }), false);
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.82,
    autoCompactThreshold: 0.82,
    compactCapability: 'native',
    pendingCompact: false,
  }), true);
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.9,
    source: 'agentserver-estimate',
    compactCapability: 'handoff-slimming',
    pendingCompact: false,
  }), true);
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.95,
    compactCapability: 'none',
  }), false);
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.95,
    compactCapability: 'agentserver',
    pendingCompact: true,
  }), false);
  assert.equal(shouldAutoCompact({
    ...beforeState,
    ratio: 0.95,
    compactCapability: 'agentserver',
    status: 'compacting',
  }), false);
});

test('context compaction start guard prevents duplicate auto/manual triggers', () => {
  const overThreshold = {
    ...beforeState,
    ratio: 0.88,
    compactCapability: 'agentserver' as const,
    pendingCompact: false,
  };

  assert.equal(shouldStartContextCompaction({
    state: overThreshold,
    running: false,
    inFlight: false,
    reason: 'auto-threshold-before-send',
  }), true);
  assert.equal(shouldStartContextCompaction({
    state: overThreshold,
    running: false,
    inFlight: true,
    reason: 'auto-threshold-before-send',
  }), false);
  assert.equal(shouldStartContextCompaction({
    state: overThreshold,
    running: true,
    inFlight: false,
    reason: 'auto-threshold-before-send',
  }), false);
  assert.equal(shouldStartContextCompaction({
    state: overThreshold,
    running: false,
    inFlight: true,
    reason: 'manual-meter-click',
  }), false);
  assert.equal(shouldStartContextCompaction({
    state: { ...overThreshold, ratio: 0.4 },
    running: false,
    inFlight: false,
    reason: 'manual-meter-click',
  }), true);
});

test('contextWindowLevel honors explicit backend status even when ratio is missing or stale', () => {
  assert.equal(contextWindowLevel({ source: 'unknown', status: 'unknown' }), 'unknown');
  assert.equal(contextWindowLevel({ source: 'native', ratio: 0.2, status: 'exceeded' }), 'near-limit');
  assert.equal(contextWindowLevel({ source: 'provider-usage', ratio: 0.2, status: 'watch' }), 'watch');
  assert.equal(contextWindowLevel({ source: 'agentserver', ratio: 0.9, status: 'healthy' }), 'near-limit');
});
