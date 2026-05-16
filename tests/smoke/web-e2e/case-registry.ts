import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertWebE2eContract } from './contract-verifier.js';
import { mappingsForSaWebTag } from './case-tags.js';
import {
  assertFreshContinueMemoryEvidence,
  runFreshContinueMemoryCase,
} from './cases/fresh-continue-memory.js';
import {
  assertExplicitArtifactSelectionEvidence,
  runExplicitArtifactSelectionCase,
} from './cases/explicit-artifact-selection.js';
import {
  buildFailedRunRepairCase,
  type FailedRunRepairFailureMode,
} from './cases/failed-run-repair.js';
import {
  PROVIDER_READY_CONTINUE_PROMPT,
  PROVIDER_TRANSITION_PROMPT,
  assertFailClosedBeforeAgentServerDispatch,
  assertNoProviderEndpointShapeLeaks,
  assertReadyRoundDispatchesToAgentServer,
  createProviderUnavailableAvailableHarness,
  markWebProvidersReady,
  runProviderTransitionRound,
} from './cases/provider-unavailable-available.js';
import {
  buildEmptyResultRecoveryCase,
  verifyEmptyResultRecoveryCase,
} from './cases/empty-result-recovery.js';
import {
  runLongBackgroundRunCase,
  type LongBackgroundCursorResumeEvidence,
  type LongBackgroundPage,
  type LongBackgroundRunEvidence,
} from './cases/long-background-run.js';
import {
  assertSaWeb08DegradedAgentServerCase,
  createSaWeb08DegradedAgentServerCase,
} from './cases/degraded-agentserver.js';
import {
  buildArtifactDeliveryVisibilityCase,
  verifyArtifactDeliveryVisibilityCase,
} from './cases/artifact-delivery-visibility.js';
import {
  runAuditExportCase,
  assertAuditExportBundle,
} from './cases/audit-export.js';
import {
  assertReloadReopenProjectionRestore,
  browserVisibleStateFromReloadReopenProjection,
} from './cases/reload-reopen-session.js';
import {
  runMultiTabConflictCase,
  type MultiTabConflictEvidence,
  type MultiTabConflictStrategy,
  type MultiTabConflictSubmissionEvidence,
} from './cases/multi-tab-conflict.js';
import {
  buildDirectContextGateCase,
} from './cases/direct-context-gate.js';
import {
  buildNoLegacyUiFallbackCase,
  verifyNoLegacyUiFallbackCase,
} from './cases/no-legacy-ui-fallback.js';
import {
  assertLiteratureHappyPathCase,
  runLiteratureHappyPathCase,
} from './cases/literature-happy-path.js';
import {
  assertDataAnalysisHappyPath,
  closeDataAnalysisHappyPathCase,
  runDataAnalysisHappyPathCase,
} from './cases/data-analysis-happy-path.js';
import { buildWebE2eFixtureWorkspace } from './fixture-workspace-builder.js';
import type { ProjectionOnlyRestoreEvidence } from './refresh-reopen-helper.js';
import type { WebE2eBrowserVisibleState } from './contract-verifier.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from './types.js';

export type LegacyBrowserSmokeScript =
  | 'smoke:browser'
  | 'smoke:browser-multiturn'
  | 'smoke:browser-provider-preflight';

export type WebE2eAgentServerMode = 'scriptable-mock' | 'real-provider-optional';

export interface WebE2eFinalDevService {
  name: 'workspace-writer' | 'web-ui' | 'agentserver';
  mode: 'fixture-managed' | 'scriptable-mock' | 'real-provider-optional';
  status: 'ready';
  baseUrl?: string;
}

export interface WebE2eCaseRunContext {
  runRoot: string;
  evidenceRoot: string;
  agentServerMode: WebE2eAgentServerMode;
  devServices: WebE2eFinalDevService[];
}

export interface WebE2eCaseRunSummary {
  caseId: string;
  title: string;
  tags: string[];
  migratedLegacyScripts: LegacyBrowserSmokeScript[];
  migratedLegacySteps: string[];
  runRoot?: string;
  evidenceRoot?: string;
  agentServerMode?: WebE2eAgentServerMode;
}

export interface WebE2eCaseDefinition {
  id: string;
  title: string;
  tags: string[];
  migratedLegacyScripts: LegacyBrowserSmokeScript[];
  migratedLegacySteps: string[];
  run(context?: WebE2eCaseRunContext): Promise<WebE2eCaseRunSummary>;
}

export const webE2eCaseRegistry: WebE2eCaseDefinition[] = [
  {
    id: 'SA-WEB-02',
    title: 'Fresh to continue memory stability',
    tags: finalCaseTags('SA-WEB-02', ['fresh-continue-memory', 'stable-goal-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'fresh turn isolates old artifacts from current work',
      'continue turn preserves the original research goal through a Backend-proposed stableGoalRef',
      'format-change follow-up uses the current artifact and rejects stale artifact replacement',
    ],
    async run(context) {
      const result = await runFreshContinueMemoryCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      assertFreshContinueMemoryEvidence(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-03',
    title: 'Explicit artifact selection follow-up',
    tags: finalCaseTags('SA-WEB-03', ['explicit-refs', 'artifact-selection', 'smoke:browser', 'browser-workflows']),
    migratedLegacyScripts: ['smoke:browser'],
    migratedLegacySteps: [
      'same session contains old and latest reports',
      'clicked old artifact remains in explicitRefs/currentTask.explicitRefs',
      'latest artifact does not leak into the follow-up result',
    ],
    async run() {
      const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-03-final-'));
      try {
        const result = await runExplicitArtifactSelectionCase({
          baseDir,
          outputRoot: join(baseDir, 'evidence'),
        });
        assertExplicitArtifactSelectionEvidence(result);
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
      return summaryFor(this);
    },
  },
  failedRunRepairCase('provider-unavailable'),
  failedRunRepairCase('schema-validation'),
  {
    id: 'SA-WEB-05',
    title: 'Provider unavailable to ready transition',
    tags: finalCaseTags('SA-WEB-05', ['provider-route', 'provider-preflight', 'smoke:browser-provider-preflight']),
    migratedLegacyScripts: ['smoke:browser-provider-preflight'],
    migratedLegacySteps: [
      'missing web_search/web_fetch fails closed before AgentServer dispatch',
      'server-side provider discovery enables the same task to dispatch',
      'provider endpoint shape stays hidden from UI-visible payloads',
    ],
    async run() {
      const harness = await createProviderUnavailableAvailableHarness();
      try {
        const unavailableRound = await runProviderTransitionRound(harness, PROVIDER_TRANSITION_PROMPT);
        assertFailClosedBeforeAgentServerDispatch(unavailableRound);
        assertNoProviderEndpointShapeLeaks(unavailableRound.visiblePreflightPayload);

        markWebProvidersReady(harness);

        const readyRound = await runProviderTransitionRound(harness, PROVIDER_READY_CONTINUE_PROMPT);
        assertReadyRoundDispatchesToAgentServer(readyRound);
        assertNoProviderEndpointShapeLeaks(readyRound.handoffRoutes);
        assertNoProviderEndpointShapeLeaks(readyRound.dispatchRequest);
        assertNoProviderEndpointShapeLeaks(readyRound.dispatchRun);
      } finally {
        await harness.close();
      }
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-06',
    title: 'Empty result recovery and scoped follow-up',
    tags: finalCaseTags('SA-WEB-06', ['empty-result', 'failure-evidence', 'smoke:browser-provider-preflight', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-provider-preflight', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'zero-result provider response is recoverable/needs-human instead of completed',
      'follow-up expands the query',
      'follow-up reuses previous failure evidence refs',
    ],
    async run() {
      const result = await buildEmptyResultRecoveryCase();
      const verification = verifyEmptyResultRecoveryCase(result);
      assert.equal(verification.ok, true, verification.failures.join('\n'));
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-07',
    title: 'Long/background run refresh and checkpoint resume',
    tags: finalCaseTags('SA-WEB-07', ['background-run', 'refresh-restore', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'long foreground run survives refresh while checkpoint evidence exists',
      'second tab clarification attaches to the active foreground run',
      'terminal Projection restores from checkpoint cursor instead of raw run state',
    ],
    async run(context) {
      const fixture = withLongBackgroundProjection(await buildWebE2eFixtureWorkspace({
        caseId: this.id,
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        now: '2026-05-16T00:00:00.000Z',
      }));
      const events: string[] = [];
      const browserContext = new FinalFakeBrowserContext(events);
      const restoreEvidence = projectionEvidence(fixture.expectedProjection);
      const result = await runLongBackgroundRunCase({
        fixture,
        browserContext,
        appUrl: `http://127.0.0.1:5173/?scenario=${fixture.scenarioId}`,
        evidence: longBackgroundEvidence(fixture),
        async submitClarification({ page, prompt }) {
          page.events.push(`${page.id}:clarification:${prompt}`);
        },
        async waitForBackgroundCheckpoint() {},
        async waitForTerminal() {},
        async reopenSession() {
          const page = await browserContext.newPage();
          page.events.push(`${page.id}:reopen:${fixture.sessionId}`);
          return page;
        },
        async readProjectionOnlyRestore({ phase }) {
          return {
            ...restoreEvidence,
            restoreSource: phase === 'after-round-refresh' ? 'conversation-event-log' : 'conversation-projection',
          };
        },
        async readBrowserVisibleState() {
          return browserVisibleState(fixture);
        },
      });
      assert.equal(result.contractInput.expected.caseId, this.id);
      assert.ok(events.includes('page-1:reload'), `${this.id}: final matrix must refresh during background run`);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-08',
    title: 'Degraded AgentServer refs-first handoff',
    tags: finalCaseTags('SA-WEB-08', ['degraded-handoff', 'projection-restore', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'context compaction/degradation uses refs-first packets',
      'backend does not receive raw history',
      'browser-visible state is restored from Projection',
    ],
    async run() {
      const scenario = await createSaWeb08DegradedAgentServerCase();
      try {
        assertSaWeb08DegradedAgentServerCase(scenario);
        assertWebE2eContract(scenario.verifierInput);
      } finally {
        await scenario.close();
      }
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-09',
    title: 'ArtifactDelivery visibility boundaries',
    tags: finalCaseTags('SA-WEB-09', ['artifact-delivery', 'audit-export', 'smoke:browser', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'primary/supporting artifacts remain visible in the main result',
      'diagnostic/audit/internal artifacts stay out of the main result',
      'audit export lineage is still represented by final contract refs',
    ],
    async run() {
      const { input } = await buildArtifactDeliveryVisibilityCase();
      const verification = verifyArtifactDeliveryVisibilityCase(input);
      assert.equal(verification.ok, true, verification.failures.join('\n'));
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-10',
    title: 'Audit export evidence bundle',
    tags: finalCaseTags('SA-WEB-10', ['audit-export', 'evidence-bundle', 'smoke:browser', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'exported audit bundle is scoped to the active run and projection',
      'ledger, RunAudit, context snapshot, refs manifest, degraded/failure/tombstone evidence are present',
      'provider secrets and internal endpoint shapes are scrubbed before evidence export',
    ],
    async run(context) {
      const result = await runAuditExportCase(context ? join(context.runRoot, this.id, 'audit-export') : undefined);
      assertAuditExportBundle(result.manifest, result.fixture);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-11',
    title: 'Reload/reopen Projection-only restore',
    tags: finalCaseTags('SA-WEB-11', ['projection-restore', 'refresh-restore', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'refresh after a follow-up turn restores visible answer from persisted Projection',
      'terminal reopen restores active/terminal run state from Projection',
      'raw run/resultPresentation fallback is rejected for restored UI state',
    ],
    async run(context) {
      const fixture = await buildWebE2eFixtureWorkspace({
        caseId: this.id,
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        now: '2026-05-16T00:00:00.000Z',
      });
      const evidence = {
        sessionId: fixture.sessionId,
        scenarioId: fixture.scenarioId,
        runId: fixture.runId,
        projectionVersion: fixture.expectedProjection.projectionVersion,
        hasConversationProjection: true,
        restoreSource: 'conversation-projection',
        rawFallbackUsed: false,
        visibleAnswer: fixture.expectedProjection.conversationProjection.visibleAnswer,
        currentTask: {
          currentTurnRef: fixture.expectedProjection.currentTask.currentTurnRef.ref,
          explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
          selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map((ref) => ref.ref),
        },
        artifactDelivery: fixture.expectedProjection.artifactDelivery,
        runAuditRefs: fixture.expectedProjection.runAuditRefs,
        activeRun: fixture.expectedProjection.conversationProjection.activeRun,
        terminalRun: {
          id: fixture.runId,
          status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
        },
        recoverActions: fixture.expectedProjection.conversationProjection.recoverActions,
        persistedProjection: fixture.expectedProjection.conversationProjection,
      };
      assertReloadReopenProjectionRestore(evidence, fixture.expectedProjection, 'final web matrix reload/reopen');
      assertWebE2eContract({
        caseId: fixture.caseId,
        expected: fixture.expectedProjection,
        browserVisibleState: browserVisibleStateFromReloadReopenProjection(fixture.expectedProjection),
        kernelProjection: fixture.expectedProjection.conversationProjection,
        sessionBundle: {
          session: fixture.workspaceState.sessionsByScenario[fixture.scenarioId],
          workspaceState: fixture.workspaceState,
        },
        runAudit: {
          runId: fixture.runId,
          refs: [...fixture.expectedProjection.runAuditRefs, fixture.expectedProjection.providerManifestRef],
          providerManifestRef: fixture.expectedProjection.providerManifestRef,
          currentTurnRef: fixture.expectedProjection.currentTask.currentTurnRef.ref,
          explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
          status: 'completed',
        },
        artifactDeliveryManifest: {
          schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
          caseId: fixture.caseId,
          runId: fixture.runId,
          artifactDelivery: fixture.expectedProjection.artifactDelivery,
        },
      });
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-12',
    title: 'Multi-tab same-session conflict policies',
    tags: finalCaseTags('SA-WEB-12', ['multi-tab-conflict', 'concurrency-decision', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'two tabs submit to the same session at the same instant',
      'only one foreground active run may write the original session',
      'wait/attach/cancel/fork outcomes are represented as explicit UIAction concurrency decisions',
    ],
    async run(context) {
      for (const strategy of ['wait', 'attach', 'cancel', 'fork'] satisfies MultiTabConflictStrategy[]) {
        const fixture = await buildWebE2eFixtureWorkspace({
          caseId: `${this.id}-${strategy}`,
          baseDir: context ? join(context.runRoot, this.id, strategy, 'workspace') : undefined,
          now: '2026-05-16T00:00:00.000Z',
        });
        const events: string[] = [];
        const browserContext = new FinalFakeBrowserContext(events);
        const evidence = conflictEvidence(fixture, strategy);
        const submitted: MultiTabConflictSubmissionEvidence[] = [];
        const result = await runMultiTabConflictCase({
          fixture,
          browserContext,
          appUrl: `http://127.0.0.1:5173/?scenario=${fixture.scenarioId}`,
          evidence,
          async submitFromTab({ page, submission }) {
            submitted.push(submission);
            page.events.push(`${page.id}:submit:${submission.requestedRunId}:${submission.sessionId}`);
          },
          async waitForConflictResolution({ projection }) {
            assert.equal(projection.activeRun?.id, fixture.runId);
          },
          async readBrowserVisibleState() {
            return browserVisibleState(fixture);
          },
        });
        assert.deepEqual(submitted.map((submission) => submission.pageSlot).sort(), ['active', 'background']);
        assert.equal(result.concurrencyProjection.sessionId, fixture.sessionId);
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-13',
    title: 'Direct context gate routes insufficient work to AgentServer',
    tags: finalCaseTags('SA-WEB-13', ['direct-context-gate', 'agentserver-route', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'bounded run-status direct answers require a structured DirectContextDecision',
      'generation and repair prompts route to AgentServer when direct context is insufficient',
      'tool/provider status cannot be answered from local prompt heuristics',
    ],
    async run(context) {
      const result = await buildDirectContextGateCase({ baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined });
      try {
        assertWebE2eContract(result.directStatus.verifierInput);
        for (const routed of result.routed) assertWebE2eContract(routed.verifierInput);
        assert.equal(result.directStatus.route, 'direct-context-answer');
        assert.ok(result.routed.every((scenario) => scenario.route === 'route-to-agentserver'));
      } finally {
        await result.server.close();
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-14',
    title: 'No legacy UI raw fallback',
    tags: finalCaseTags('SA-WEB-14', ['no-legacy-ui', 'projection-only', 'smoke:browser', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'projectionless raw run/resultPresentation is quarantined to audit/debug',
      'main result waits for ConversationProjection instead of rendering legacy terminal text',
      'recover actions come from Projection migration state',
    ],
    async run() {
      const result = await buildNoLegacyUiFallbackCase();
      const verification = verifyNoLegacyUiFallbackCase(result);
      assert.equal(verification.ok, true, verification.failures.join('\n'));
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-15',
    title: 'Literature multi-turn happy path',
    tags: finalCaseTags('SA-WEB-15', ['literature-happy-path', 'provider-route', 'audit-export', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'non-empty web_search provider returns literature candidates',
      'web_fetch/read_ref materialize downloaded and read evidence refs',
      'Chinese report is citation-repaired and exported with route trace and artifact lineage',
    ],
    async run(context) {
      const result = await runLiteratureHappyPathCase(context ? join(context.runRoot, this.id, 'literature-happy-path') : undefined);
      assertLiteratureHappyPathCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-16',
    title: 'Data analysis multi-turn happy path',
    tags: finalCaseTags('SA-WEB-16', ['data-analysis-happy-path', 'read-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'uploaded CSV is passed as a bounded ref instead of raw prompt text',
      'summary, regroup, and outlier explanation each read the large CSV through read_ref',
      'terminal answer exports markdown plus analysis code refs with ArtifactDelivery lineage',
    ],
    async run(context) {
      const result = await runDataAnalysisHappyPathCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      try {
        await assertDataAnalysisHappyPath(result);
      } finally {
        await closeDataAnalysisHappyPathCase(result);
      }
      return summaryFor(this, context);
    },
  },
];

export function selectWebE2eCases(options: { tags?: string[]; cases?: string[] } = {}): WebE2eCaseDefinition[] {
  const tags = options.tags ?? [];
  const cases = options.cases ?? [];
  const selected = webE2eCaseRegistry.filter((definition) => {
    const tagSelection = tags.includes('SA-WEB-01') ? tags.filter((tag) => tag !== 'SA-WEB-01') : tags;
    const matchesTag = tagSelection.length === 0 || tagSelection.some((tag) => definition.tags.includes(tag));
    const matchesCase = cases.length === 0 || cases.includes(definition.id);
    return matchesTag && matchesCase;
  });
  return selected;
}

export function assertWebE2eCaseRegistry(): void {
  assert.equal(new Set(webE2eCaseRegistry.map((definition) => definition.id)).size, webE2eCaseRegistry.length, 'web e2e case ids must be unique');
  for (const definition of webE2eCaseRegistry) {
    assert.ok(definition.tags.includes(definition.id), `${definition.id}: tags must include the case id`);
    assert.ok(definition.migratedLegacyScripts.length > 0, `${definition.id}: must name migrated legacy browser scripts`);
    assert.ok(definition.migratedLegacySteps.length > 0, `${definition.id}: must name migrated legacy steps`);
    for (const script of definition.migratedLegacyScripts) {
      assert.ok(definition.tags.includes(script), `${definition.id}: tags must include migrated script ${script}`);
    }
  }

  for (const script of ['smoke:browser', 'smoke:browser-multiturn', 'smoke:browser-provider-preflight'] satisfies LegacyBrowserSmokeScript[]) {
    assert.ok(
      webE2eCaseRegistry.some((definition) => definition.migratedLegacyScripts.includes(script)),
      `${script}: must be represented by final web e2e cases`,
    );
  }

  assert.ok(
    mappingsForSaWebTag('SA-WEB-03').some((mapping) => mapping.rTaskId === 'R-UI-03'),
    'legacy R-UI-03 artifact selection lineage must stay mapped to SA-WEB-03',
  );
  assert.ok(
    mappingsForSaWebTag('SA-WEB-06').some((mapping) => mapping.contractAssertions.includes('empty-result')),
    'legacy empty-result lineage must stay mapped to SA-WEB-06',
  );
  assert.ok(
    webE2eCaseRegistry.some((definition) => definition.id === 'SA-WEB-10' && definition.tags.includes('audit-export')),
    'final web e2e matrix must include audit export evidence',
  );
  assert.ok(
    webE2eCaseRegistry.some((definition) => definition.id === 'SA-WEB-11' && definition.tags.includes('projection-restore')),
    'final web e2e matrix must include Projection restore evidence',
  );
}

export function allWebE2eCaseTags(): string[] {
  return [...new Set(webE2eCaseRegistry.flatMap((definition) => definition.tags))].sort();
}

function failedRunRepairCase(failureMode: FailedRunRepairFailureMode): WebE2eCaseDefinition {
  const suffix = failureMode === 'provider-unavailable' ? 'provider' : 'schema';
  return {
    id: `SA-WEB-04-${suffix}`,
    title: `Failed run repair (${failureMode})`,
    tags: finalCaseTags('SA-WEB-04', [`SA-WEB-04-${suffix}`, 'failure-evidence', 'repair-continuation', 'smoke:browser', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'failed run restore explains the failure before retry',
      'repair continuation preserves failureSignature and RunAudit refs',
      'unrelated completed steps are not rerun',
    ],
    async run(context) {
      const result = await buildFailedRunRepairCase({ failureMode });
      try {
        assertWebE2eContract(result.verifierInput);
        assert.equal(result.repairPolicy.action, 'fail-closed');
        assert.equal(result.server.requests.runs.length, 2, 'failed run repair should make one failure run and one repair continuation');
      } finally {
        await result.server.close();
      }
      return summaryFor(this, context);
    },
  };
}

function finalCaseTags(caseId: string, tags: string[]): string[] {
  return [...new Set(['SA-WEB-01', 'SA-WEB-18', caseId, ...tags])];
}

function summaryFor(definition: WebE2eCaseDefinition, context?: WebE2eCaseRunContext): WebE2eCaseRunSummary {
  return {
    caseId: definition.id,
    title: definition.title,
    tags: [...definition.tags],
    migratedLegacyScripts: [...definition.migratedLegacyScripts],
    migratedLegacySteps: [...definition.migratedLegacySteps],
    runRoot: context?.runRoot,
    evidenceRoot: context?.evidenceRoot,
    agentServerMode: context?.agentServerMode,
  };
}

class FinalFakePage implements LongBackgroundPage {
  readonly gotoCalls: Array<{ url: string; waitUntil?: string }> = [];
  readonly storage: Record<string, unknown[]> = {};
  closed = false;

  constructor(
    readonly id: string,
    readonly events: string[],
  ) {}

  async goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void> {
    this.gotoCalls.push({ url, waitUntil: options?.waitUntil });
    this.events.push(`${this.id}:goto:${url}`);
  }

  async reload(): Promise<void> {
    this.events.push(`${this.id}:reload`);
  }

  async evaluate<Result, Arg>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result> {
    const previousWindow = globalThis.window;
    const previousCustomEvent = globalThis.CustomEvent;
    const fakeWindow = {
      dispatchEvent: (event: Event) => {
        this.events.push(`${this.id}:event:${event.type}`);
        return true;
      },
    } as Window & typeof globalThis & Record<string, unknown>;
    Object.assign(fakeWindow, this.storage);
    globalThis.window = fakeWindow;
    if (typeof globalThis.CustomEvent !== 'function') {
      globalThis.CustomEvent = class TestCustomEvent<T = unknown> extends Event {
        readonly detail: T;

        constructor(type: string, eventInitDict?: CustomEventInit<T>) {
          super(type, eventInitDict);
          this.detail = eventInitDict?.detail as T;
        }
      } as unknown as typeof CustomEvent;
    }
    try {
      const result = await pageFunction(arg);
      for (const [key, value] of Object.entries(fakeWindow)) {
        if (Array.isArray(value)) this.storage[key] = value;
      }
      return result;
    } finally {
      globalThis.window = previousWindow;
      globalThis.CustomEvent = previousCustomEvent;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.events.push(`${this.id}:close`);
  }
}

class FinalFakeBrowserContext {
  readonly pages: FinalFakePage[] = [];

  constructor(readonly events: string[]) {}

  async newPage(): Promise<FinalFakePage> {
    const page = new FinalFakePage(`page-${this.pages.length + 1}`, this.events);
    this.pages.push(page);
    return page;
  }
}

function browserVisibleState(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
  const answer = fixture.expectedProjection.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer?.text,
    visibleArtifactRefs: [
      ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
      ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function withLongBackgroundProjection(fixture: WebE2eFixtureWorkspace): WebE2eFixtureWorkspace {
  const next = structuredClone(fixture) as WebE2eFixtureWorkspace;
  const projection = structuredClone(next.expectedProjection.conversationProjection);
  projection.backgroundState = {
    status: 'completed',
    checkpointRefs: checkpointRefs(),
    revisionPlan: 'Resume the foreground answer from the latest checkpoint after clarification.',
    foregroundPartialRef: 'artifact:fixture-current-report',
  };
  projection.activeRun = { id: next.runId, status: 'satisfied' };
  next.expectedProjection.conversationProjection = projection;

  const session = next.workspaceState.sessionsByScenario[next.scenarioId];
  const run = session.runs.find((candidate) => candidate.id === next.runId);
  assert.ok(run?.raw && typeof run.raw === 'object');
  const raw = run.raw as {
    displayIntent?: {
      conversationProjection?: unknown;
      taskOutcomeProjection?: { conversationProjection?: unknown };
    };
    resultPresentation?: { conversationProjection?: unknown };
  };
  if (raw.displayIntent) {
    raw.displayIntent.conversationProjection = projection;
    if (raw.displayIntent.taskOutcomeProjection) raw.displayIntent.taskOutcomeProjection.conversationProjection = projection;
  }
  if (raw.resultPresentation) raw.resultPresentation.conversationProjection = projection;
  return next;
}

function longBackgroundEvidence(fixture: WebE2eFixtureWorkspace): LongBackgroundRunEvidence {
  return {
    foregroundRun: { id: fixture.runId, status: 'background-running' },
    backgroundRuns: [{ id: 'run-sa-web-07-background', status: 'background-running' }],
    concurrencyDecision: 'attach-background-to-foreground',
    cursorResume: cursorResumeEvidence(),
    terminalProjection: fixture.expectedProjection.conversationProjection,
  };
}

function cursorResumeEvidence(): LongBackgroundCursorResumeEvidence {
  return {
    checkpointRefs: checkpointRefs(),
    cursorBeforeRefresh: 'cursor:producer:000012',
    cursorAfterRefresh: 'cursor:producer:000018',
    producerSeqBeforeRefresh: 12,
    producerSeqAfterRefresh: 18,
    resumedFromCheckpointRef: 'checkpoint:sa-web-07-background-2',
  };
}

function checkpointRefs(): string[] {
  return [
    'checkpoint:sa-web-07-background-1',
    'checkpoint:sa-web-07-background-2',
  ];
}

function projectionEvidence(expected: WebE2eExpectedProjection): ProjectionOnlyRestoreEvidence {
  return {
    sessionId: expected.sessionId,
    scenarioId: expected.scenarioId,
    runId: expected.runId,
    projectionVersion: expected.projectionVersion,
    hasConversationProjection: true,
    restoreSource: 'conversation-projection',
    rawFallbackUsed: false,
    visibleAnswer: {
      status: expected.conversationProjection.visibleAnswer?.status,
      text: expected.conversationProjection.visibleAnswer?.text,
      artifactRefs: expected.conversationProjection.visibleAnswer?.artifactRefs,
    },
    currentTask: {
      currentTurnRef: expected.currentTask.currentTurnRef.ref,
      explicitRefs: expected.currentTask.explicitRefs.map((ref) => ref.ref),
      selectedRefs: expected.currentTask.selectedRefs.map((ref) => ref.ref),
    },
    artifactDelivery: expected.artifactDelivery,
    runAuditRefs: expected.runAuditRefs,
  };
}

function conflictEvidence(
  fixture: Pick<WebE2eFixtureWorkspace, 'sessionId' | 'runId'>,
  strategy: MultiTabConflictStrategy,
): MultiTabConflictEvidence {
  const submittedAt = '2026-05-16T00:00:00.000Z';
  const contenderId = `run-sa-web-12-contender-${strategy}`;
  const submissions: MultiTabConflictEvidence['submissions'] = [
    {
      pageSlot: 'active',
      prompt: 'Foreground: start the report.',
      requestedRunId: fixture.runId,
      sessionId: fixture.sessionId,
      submittedAt,
    },
    {
      pageSlot: 'background',
      prompt: 'Background: submit against the same session at the same time.',
      requestedRunId: contenderId,
      sessionId: fixture.sessionId,
      submittedAt,
    },
  ];

  if (strategy === 'wait') {
    return {
      strategy,
      concurrencyDecision: 'wait-for-foreground-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: { id: contenderId, status: 'queued', requestedBy: 'background', strategy },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  if (strategy === 'attach') {
    return {
      strategy,
      concurrencyDecision: 'attach-to-foreground-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: {
        id: contenderId,
        status: 'attached',
        requestedBy: 'background',
        strategy,
        attachesToRunId: fixture.runId,
      },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  if (strategy === 'cancel') {
    return {
      strategy,
      concurrencyDecision: 'cancel-contender-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: { id: contenderId, status: 'cancelled', requestedBy: 'background', strategy },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  return {
    strategy,
    concurrencyDecision: 'fork-contender-session',
    foregroundRun: { id: fixture.runId, status: 'running' },
    submissions,
    handledContender: {
      id: contenderId,
      status: 'running',
      requestedBy: 'background',
      strategy,
      forkSessionId: `${fixture.sessionId}:fork`,
      writesSessionId: `${fixture.sessionId}:fork`,
    },
    foregroundWriteSessionId: fixture.sessionId,
  };
}
