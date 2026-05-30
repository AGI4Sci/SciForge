import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact, SciForgeSession } from '../domain';
import { conversationProjectionForSession } from './conversation-projection-view-model';
import { browserVisibleRuntimeState, runPresentationState } from './results-renderer-execution-model';
import { createLocalProjectionApi, createLocalProjectionSubscriptionApi, createLocalUserActionApi } from './projectionApi';

test('ProjectionApi restores default view from materialized projection and keeps raw run failures audit-only', async () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-projection-api',
    visibleAnswer: {
      status: 'satisfied',
      text: 'Projection answer is authoritative.',
      artifactRefs: ['artifact:report'],
    },
    activeRun: { id: 'run-1', status: 'satisfied' },
    artifacts: [{ ref: 'artifact:report', label: 'Report' }],
    executionProcess: [],
    recoverActions: [],
    verificationState: { status: 'verified' },
    auditRefs: ['raw:debug-only'],
    diagnostics: [],
  };
  const session = testSession({
    runs: [{
      id: 'run-1',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'make report',
      response: 'RAW_RESPONSE_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: {
        failureReason: 'RAW_FAILURE_SHOULD_NOT_RENDER',
        displayIntent: { conversationProjection: projection },
      },
    }],
    artifacts: [deliveryArtifact('report')],
  });

  const api = createLocalProjectionApi();
  const view = await api.getConversationProjection({ session, focusedRunId: 'run-1' });
  const runtimeState = browserVisibleRuntimeState(session, session.runs[0]);

  assert.equal(view.visibleAnswer.status, 'satisfied');
  assert.equal(view.visibleAnswer.text, 'Projection answer is authoritative.');
  assert.deepEqual(view.visibleAnswer.primaryArtifactRefs, ['artifact:report']);
  assert.equal(runtimeState.rawFallbackUsed, false);
  assert.equal(runtimeState.rawLeak, false);
  assert.doesNotMatch(JSON.stringify(view), /RAW_FAILURE|RAW_RESPONSE/);
});

test('ProjectionApi exposes manual artifact preview and selected artifact actions as semantic functions', async () => {
  const session = testSession({
    artifacts: [deliveryArtifact('large-report', {
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:large-report',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/artifacts/large-report.md',
        previewPolicy: 'inline',
        sizeBytes: 2 * 1024 * 1024,
      } as never,
    })],
  });
  const projectionApi = createLocalProjectionApi();
  const actionApi = createLocalUserActionApi(projectionApi);

  const preview = await projectionApi.getArtifactPreview({ session, artifactRef: 'artifact:large-report', mode: 'summary' });
  const loaded = await actionApi.loadArtifactPreview({ session, artifactRef: 'artifact:large-report', byteLimit: 4096 });
  const selected = await actionApi.selectObject({ session, objectRef: 'artifact:large-report', intent: 'ask-followup' });

  assert.equal(preview.status, 'requires-manual-load');
  assert.deepEqual(preview.actions.map((action) => action.kind), ['load-preview']);
  assert.deepEqual(preview.actions.map((action) => action.commandText), ['open "artifact:large-report"']);
  assert.equal(loaded.artifactRef, 'artifact:large-report');
  assert.equal(loaded.sourceAction?.type, 'load-artifact-preview');
  assert.equal(loaded.sourceAction?.type === 'load-artifact-preview' ? loaded.sourceAction.artifactRef : '', 'artifact:large-report');
  assert.equal(selected.accepted, true);
  assert.equal(selected.action?.type, 'select-object');
  assert.equal(selected.auditRef?.startsWith('ui-action:select-object-'), true);
});

test('ProjectionApi returns refs-first bounded previews without leaking sensitive artifact bodies', async () => {
  const session = testSession({
    artifacts: [deliveryArtifact('sensitive-report', {
      metadata: { title: 'Sensitive report token=sk-title-secret-1234567890' },
      data: {
        markdown: [
          '# Sensitive report',
          'Authorization: Bearer sk-body-secret-1234567890',
          'provider https://provider.example.test/v1?api_key=abc123',
          '/Users/alice/private/config.local.json',
          '.sciforge/sessions/session/logs/stdout.log',
          'artifact:evidence-table',
          'x'.repeat(13_000),
        ].join('\n'),
        rows: [{ ref: 'artifact:evidence-table', note: 'safe row' }],
        rawProviderPayload: { body: 'RAW_PROVIDER_BODY_SHOULD_NOT_LEAK' },
      },
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:sensitive-report',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/artifacts/sensitive-report.md',
        rawRef: '.sciforge/sessions/session/logs/raw-output.json',
        previewPolicy: 'inline',
        sizeBytes: 128,
      } as never,
    })],
  });

  const preview = await createLocalProjectionApi().getArtifactPreview({
    session,
    artifactRef: 'artifact:sensitive-report',
    mode: 'inline',
  });
  const serialized = JSON.stringify(preview);

  assert.equal(preview.status, 'ready');
  assert.equal(preview.refs?.[0], 'artifact:sensitive-report');
  assert.ok(preview.refs?.includes('.sciforge/artifacts/sensitive-report.md'));
  assert.match(preview.title, /redacted-secret/);
  assert.match(preview.preview ?? '', /preview truncated/);
  assert.equal(Object.keys(preview.structuredData as Record<string, unknown>)[0], 'refs');
  assert.doesNotMatch(serialized, /sk-body-secret|sk-title-secret|provider\.example|api_key=abc123|\/Users\/alice|stdout\.log|RAW_PROVIDER_BODY/);
  assert.match(serialized, /redacted-secret|right-pane-sensitive-object/);
});

test('ProjectionSubscriptionApi publishes canonical projection without exposing raw run text', async () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-subscription',
    visibleAnswer: {
      status: 'repair-needed',
      diagnostic: '验证证据不足。',
      artifactRefs: ['artifact:partial-report'],
    },
    activeRun: { id: 'run-subscription', status: 'repair-needed' },
    artifacts: [{ ref: 'artifact:partial-report', label: 'Partial report' }],
    executionProcess: [],
    recoverActions: ['Retry with repair evidence.'],
    verificationState: { status: 'failed' },
    auditRefs: ['raw:debug-only'],
    diagnostics: [],
  };
  const session = testSession({
    runs: [{
      id: 'run-subscription',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'repair',
      response: 'RAW_AGENTSERVER_TEXT_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: {
        failureReason: 'RAW_FAILURE_SHOULD_NOT_RENDER',
        displayIntent: { conversationProjection: projection },
      },
    }],
    artifacts: [deliveryArtifact('partial-report')],
  });
  const subscriptionApi = createLocalProjectionSubscriptionApi();

  const event = await new Promise<Parameters<Parameters<typeof subscriptionApi.subscribeConversationProjection>[1]>[0]>((resolve) => {
    subscriptionApi.subscribeConversationProjection({ session, focusedRunId: 'run-subscription' }, resolve);
  });

  assert.equal(event.type, 'projection-restored');
  assert.equal(event.projection.visibleAnswer.status, 'repair-needed');
  assert.deepEqual(event.projection.visibleAnswer.primaryArtifactRefs, ['artifact:partial-report']);
  assert.equal(event.run?.runId, 'run-subscription');
  assert.doesNotMatch(JSON.stringify(event), /RAW_AGENTSERVER_TEXT|RAW_FAILURE/);
});

test('ProjectionApi normalizes status token separators from runtime projections', async () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-status-token-normalization',
    visibleAnswer: {
      status: 'repair_needed',
      diagnostic: 'Provider emitted underscore status token.',
      artifactRefs: ['artifact:partial-report'],
    },
    activeRun: { id: 'run-status-token-normalization', status: 'repair_needed' },
    artifacts: [{ ref: 'artifact:partial-report', label: 'Partial report' }],
    executionProcess: [],
    recoverActions: ['Retry after status normalization.'],
    verificationState: { status: 'failed' },
    auditRefs: ['audit:status-token'],
    diagnostics: [],
  };
  const session = testSession({
    runs: [{
      id: 'run-status-token-normalization',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'repair',
      response: 'RAW_RESPONSE_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: {
        displayIntent: { conversationProjection: projection },
      },
    }],
    artifacts: [deliveryArtifact('partial-report')],
  });

  const view = await createLocalProjectionApi().getConversationProjection({ session, focusedRunId: 'run-status-token-normalization' });
  const restored = conversationProjectionForSession(session, session.runs[0]);

  assert.equal(view.visibleAnswer.status, 'repair-needed');
  assert.equal(restored?.activeRun?.status, 'repair-needed');
  assert.deepEqual(view.visibleAnswer.primaryArtifactRefs, ['artifact:partial-report']);
  assert.doesNotMatch(JSON.stringify(view), /RAW_RESPONSE_SHOULD_NOT_RENDER/);
});

test('conversation projection map prefers the explicitly focused run over current/latest projections', () => {
  const session = testSession({
    runs: [{
      id: 'run-a',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'first lane run',
      response: 'run a response',
      createdAt: '2026-05-17T00:00:00.000Z',
    }, {
      id: 'run-b',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'second lane run',
      response: 'run b response',
      createdAt: '2026-05-17T00:00:01.000Z',
    }],
    materializedConversationProjections: {
      currentRunId: 'run-b',
      activeRunId: 'run-b',
      latest: projectionFixture('run-b', 'Latest projection'),
      projections: {
        'run-a': projectionFixture('run-a', 'Focused run projection'),
        'run-b': projectionFixture('run-b', 'Current run projection'),
      },
    } as never,
  } as Partial<SciForgeSession> & { materializedConversationProjections: unknown });

  const projection = conversationProjectionForSession(session, session.runs[0]);

  assert.equal(projection?.activeRun?.id, 'run-a');
  assert.equal(projection?.visibleAnswer?.text, 'Focused run projection');
});

test('completion-candidate salvage creates recoverable projection without promoting raw ToolPayload to success', () => {
  const session = testSession({
    runs: [{
      id: 'run-candidate',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'handoff drifted after writing report',
      response: '{"message":"RAW_TOOLPAYLOAD_SHOULD_STAY_AUDIT_ONLY"}',
      createdAt: '2026-05-17T00:00:00.000Z',
      completedAt: '2026-05-17T00:00:10.000Z',
      raw: {
        stdoutRef: '.sciforge/logs/stdout.log',
        stderrRef: '.sciforge/logs/stderr.log',
        completionCandidate: {
          summary: '{"rawPayload":"SHOULD_NOT_RENDER"}',
          artifactRefs: ['artifact:salvaged-report'],
          auditRefs: ['raw:tool-payload-json'],
        },
      },
    }],
    artifacts: [deliveryArtifact('salvaged-report')],
  });

  const projection = conversationProjectionForSession(session, session.runs[0]);
  const state = runPresentationState(session, session.runs[0]);
  const browserState = browserVisibleRuntimeState(session, session.runs[0]);

  assert.equal(projection?.visibleAnswer?.status, 'repair-needed');
  assert.equal(projection?.visibleAnswer?.text, '发现可用结果，待导入、验证或人工确认后才能作为最终答案。');
  assert.deepEqual(projection?.visibleAnswer?.artifactRefs, ['artifact:salvaged-report']);
  assert.equal(state.kind, 'recoverable');
  assert.match(state.nextSteps.join('\n'), /导入并验证候选结果/);
  assert.equal(browserState.rawLeak, false);
  assert.doesNotMatch(JSON.stringify({ projection, state }), /SHOULD_NOT_RENDER|stdout|stderr|tool_payload/);
});

test('UserActionApi records retry with repair evidence as an action result', async () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-retry',
    visibleAnswer: {
      status: 'repair-needed',
      diagnostic: 'verification missing',
      artifactRefs: ['artifact:partial-report'],
    },
    activeRun: { id: 'run-retry', status: 'repair-needed' },
    artifacts: [{ ref: 'artifact:partial-report', label: 'Partial report' }],
    executionProcess: [],
    recoverActions: ['Retry with repair evidence.'],
    verificationState: { status: 'failed' },
    auditRefs: ['artifact:partial-report', 'audit:verification'],
    diagnostics: [],
  };
  const session = testSession({
    runs: [{
      id: 'run-retry',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'retry',
      response: 'failed',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: { displayIntent: { conversationProjection: projection } },
    }],
    artifacts: [deliveryArtifact('partial-report')],
  });

  const actionApi = createLocalUserActionApi();
  const result = await actionApi.requestRetry({
    session,
    runId: 'run-retry',
    reason: 'repair missing verifier refs',
    scope: 'with-repair-evidence',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.action?.type, 'request-retry');
  assert.equal(result.action?.type === 'request-retry' ? result.action.scope : '', 'with-repair-evidence');
  assert.match(result.commandText ?? '', /^\/rerun "run-retry" --with-repair-evidence --reason "repair missing verifier refs"/);
  assert.deepEqual(result.action?.type === 'request-retry' ? result.action.auditRefs : [], ['artifact:partial-report', 'audit:verification']);
  assert.equal(result.projection?.visibleAnswer.status, 'repair-needed');
});

test('ProjectionApi derives CapabilityPlanSummary from discovery tool results without raw debug leakage', async () => {
  const session = testSession({
    runs: [{
      id: 'run-discovery-plan',
      scenarioId: 'literature-evidence-review',
      status: 'running',
      prompt: 'discover capabilities',
      response: 'RAW_DISCOVERY_TEXT_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: {
        capabilityDiscoveryToolResults: [{
          type: 'tool-result',
          toolName: 'capability_discovery.plan',
          status: 'done',
          auditRefs: [
            'records/capability-discovery/plan-audit.json',
            'http://127.0.0.1:18380/internal',
          ],
          completionEvidence: 'not-evidence',
          result: {
            contract: 'sciforge.capability-discovery.v1',
            summary: 'Use literature search, PDF reading, and citation verification.',
            steps: [
              { capabilityId: 'web_search' },
              { capabilityId: 'pdf_read' },
              { capabilityId: 'citation_verify' },
            ],
            completionEvidence: 'not-evidence',
          },
        }],
      },
    }],
  });

  const summary = await createLocalProjectionApi().getCapabilityPlanSummary({ session, runId: 'run-discovery-plan' });

  assert.equal(summary?.status, 'available');
  assert.match(summary?.summary ?? '', /literature search/);
  assert.match(summary?.summary ?? '', /web_search、pdf_read、citation_verify/);
  assert.match(summary?.summary ?? '', /不是任务完成证据|not completion evidence/);
  assert.deepEqual(summary?.debugRefs, ['records/capability-discovery/plan-audit.json']);
  assert.doesNotMatch(JSON.stringify(summary), /127\.0\.0\.1|RAW_DISCOVERY_TEXT/);
});

test('UserActionApi openDebugAudit folds discovery refs through the semantic action boundary', async () => {
  const session = testSession({
    runs: [{
      id: 'run-discovery-debug-fold',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'discover capabilities',
      response: 'RAW_DISCOVERY_TEXT_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: {
        auditRefs: [
          'audit:regular-run-ref',
          'http://127.0.0.1:18080/internal',
          '/Applications/workspace/ailab/research/app/SciForge/.secret',
        ],
        capabilityDiscoveryToolResults: [{
          type: 'tool-result',
          toolName: 'capability_discovery.search',
          status: 'done',
          auditRefs: [
            'records/capability-discovery/search-audit.json',
            'token=abc123',
          ],
          completionEvidence: 'not-evidence',
          result: {
            contract: 'sciforge.capability-discovery.v1',
            candidates: [{ capabilityId: 'web_search', title: 'Web search' }],
            completionEvidence: 'not-evidence',
          },
        }],
      },
    }],
  });

  const result = await createLocalUserActionApi().openDebugAudit({
    session,
    runId: 'run-discovery-debug-fold',
  });

  assert.equal(result.action?.type, 'open-debug-audit');
  assert.deepEqual(result.action?.type === 'open-debug-audit' ? result.action.auditRefs : [], [
    'audit:regular-run-ref',
    'records/capability-discovery/search-audit.json',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|Applications\/workspace|token=abc123|RAW_DISCOVERY_TEXT/);
});

test('UserActionApi records recover, debug audit, approval, and cancel as semantic action results', async () => {
  const projection = {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-actions',
    visibleAnswer: {
      status: 'needs-human',
      diagnostic: '需要用户决定是否恢复。',
      artifactRefs: ['artifact:partial-report'],
    },
    activeRun: { id: 'run-actions', status: 'needs-human' },
    artifacts: [{ ref: 'artifact:partial-report', label: 'Partial report' }],
    executionProcess: [],
    recoverActions: ['Import and verify candidate artifacts.'],
    verificationState: { status: 'unverified' },
    auditRefs: ['artifact:partial-report', 'audit:recover'],
    diagnostics: [],
  };
  const session = testSession({
    runs: [{
      id: 'run-actions',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'recover',
      response: 'RAW_RECOVER_TEXT_SHOULD_NOT_RENDER',
      createdAt: '2026-05-17T00:00:00.000Z',
      raw: { displayIntent: { conversationProjection: projection } },
    }],
    artifacts: [deliveryArtifact('partial-report')],
  });
  const actionApi = createLocalUserActionApi();

  const recover = await actionApi.triggerRecover({
    session,
    runId: 'run-actions',
    recoverAction: 'Import and verify candidate artifacts.',
  });
  const approve = await actionApi.approveResult({
    session,
    runId: 'run-actions',
    approval: 'reject-result',
    note: 'Still lacks verifier refs.',
  });
  const openAudit = await actionApi.openDebugAudit({
    session,
    runId: 'run-actions',
  });
  const cancel = await actionApi.cancelRun({
    session,
    runId: 'run-actions',
    rejectedGuidanceIds: ['guidance-a', 'guidance-a', 'guidance-b'],
  });

  assert.equal(recover.accepted, true);
  assert.equal(recover.action?.type, 'trigger-recover');
  assert.equal(recover.action?.type === 'trigger-recover' ? recover.action.recoverAction : '', 'Import and verify candidate artifacts.');
  assert.match(recover.commandText ?? '', /^\/recover "run-actions" --with-evidence --action "Import and verify candidate artifacts\."/);
  assert.deepEqual(recover.action?.type === 'trigger-recover' ? recover.action.auditRefs : [], ['artifact:partial-report', 'audit:recover']);
  assert.equal(openAudit.action?.type, 'open-debug-audit');
  assert.deepEqual(openAudit.action?.type === 'open-debug-audit' ? openAudit.action.auditRefs : [], ['artifact:partial-report', 'audit:recover']);
  assert.equal(approve.action?.type, 'approve-result');
  assert.equal(approve.action?.type === 'approve-result' ? approve.action.approval : '', 'reject-result');
  assert.equal(cancel.action?.type, 'cancel-run');
  assert.deepEqual(cancel.action?.type === 'cancel-run' ? cancel.action.rejectedGuidanceIds : [], ['guidance-a', 'guidance-b']);
  assert.doesNotMatch(JSON.stringify({ recover, openAudit, approve, cancel }), /RAW_RECOVER_TEXT/);
});

function testSession(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-projection-api',
    scenarioId: 'literature-evidence-review',
    title: 'Projection API test',
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    ...overrides,
  };
}

function projectionFixture(runId: string, text: string) {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: 'conversation-projection-map',
    visibleAnswer: {
      status: 'satisfied',
      text,
      artifactRefs: [],
    },
    activeRun: { id: runId, status: 'satisfied' },
    artifacts: [],
    executionProcess: [],
    recoverActions: [],
    verificationState: { status: 'verified' },
    auditRefs: [],
    diagnostics: [],
  };
}

function deliveryArtifact(id: string, overrides: Partial<RuntimeArtifact> = {}): RuntimeArtifact {
  return {
    id,
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: id },
    data: { markdown: `# ${id}` },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: `.sciforge/artifacts/${id}.md`,
      previewPolicy: 'inline',
    },
    ...overrides,
  };
}
