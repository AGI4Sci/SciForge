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
import {
  assertLargeFileDiagnosticsCase,
  closeLargeFileDiagnosticsCase,
  runLargeFileDiagnosticsCase,
} from './cases/large-file-diagnostics.js';
import {
  assertLongitudinalMessyCsvCase,
  closeLongitudinalMessyCsvCase,
  runLongitudinalMessyCsvCase,
} from './cases/longitudinal-messy-csv.js';
import {
  assertSchemaDriftConfounderCase,
  closeSchemaDriftConfounderCase,
  runSchemaDriftConfounderCase,
} from './cases/schema-drift-confounder.js';
import {
  assertTwoTableLineageCase,
  closeTwoTableLineageCase,
  runTwoTableLineageCase,
} from './cases/two-table-lineage.js';
import {
  assertGuiResourceProbingCase,
  runGuiResourceProbingCase,
} from './cases/gui-resource-probing.js';
import {
  assertGuiAskUserClarificationCase,
  runGuiAskUserClarificationCase,
} from './cases/gui-ask-user-clarification.js';
import {
  assertGuiActionCommandTraceCase,
  runGuiActionCommandTraceCase,
} from './cases/gui-action-command-trace.js';
import {
  assertNativeSessionArtifactFollowupContract,
  runNativeSessionArtifactFollowupCase,
} from './cases/native-session-artifact-followup.js';
import {
  assertLongContextConstraintStabilityCase,
  runLongContextConstraintStabilityCase,
} from './cases/long-context-constraint-stability.js';
import {
  assertLiteratureCurrentAndSelectedReportCase,
  buildLiteratureCurrentAndSelectedReportCase,
} from './cases/literature-current-and-selected-report.js';
import {
  assertLiteratureEvidenceConflictCase,
  runLiteratureEvidenceConflictCase,
} from './cases/literature-evidence-conflict.js';
import {
  assertDirtyWorktreeCollaborationContract,
  assertTargetedCodeRepairContract,
  buildDirtyWorktreeCollaborationCase,
  buildTargetedCodeRepairCase,
} from './cases/code-repair-collaboration.js';
import {
  assertScientificReviewerVerifierLoopCase,
  buildScientificReviewerVerifierLoopCases,
} from './cases/scientific-reviewer-verifier-loop.js';
import {
  assertCapabilitySkillComputerUseBoundariesCase,
  runCapabilitySkillComputerUseBoundariesCase,
} from './cases/capability-skill-computer-use-boundaries.js';
import {
  assertRunResumeLifecycleRecoveryFixture,
  buildRunResumeLifecycleRecoveryFixture,
} from './cases/run-resume-lifecycle-recovery.js';
import {
  assertProviderSecurityBudgetAuditFixture,
  createProviderSecurityBudgetAuditFixture,
} from './cases/provider-security-budget-audit-fixture.js';
import { buildWebE2eFixtureWorkspace } from './fixture-workspace-builder.js';
import type { ProjectionOnlyRestoreEvidence } from './refresh-reopen-helper.js';
import type { WebE2eBrowserVisibleState } from './contract-verifier.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from './types.js';

export type LegacyBrowserSmokeScript =
  | 'smoke:browser'
  | 'smoke:browser-multiturn'
  | 'smoke:browser-provider-preflight';

export type WebE2eRuntimeDispatchMode = 'offline-fixture' | 'real-provider-optional';

export interface WebE2eFinalDevService {
  name: 'workspace-writer' | 'web-ui' | 'runtime-dispatch';
  mode: 'fixture-managed' | WebE2eRuntimeDispatchMode;
  status: 'ready';
  baseUrl?: string;
}

export interface WebE2eCaseRunContext {
  runRoot: string;
  evidenceRoot: string;
  runtimeDispatchMode: WebE2eRuntimeDispatchMode;
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
  runtimeDispatchMode?: WebE2eRuntimeDispatchMode;
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
        assertNoProviderEndpointShapeLeaks(unavailableRound.handoffRoutes);

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
    title: 'Direct context gate uses runtime dispatch or blocked evidence',
    tags: finalCaseTags('SA-WEB-13', ['direct-context-gate', 'runtime-dispatch', 'blocked-with-evidence', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'bounded run-status direct answers require a structured DirectContextDecision',
      'generation and repair prompts use Runtime Codex runtime dispatch when direct context is insufficient',
      'tool/provider status gaps are blocked with evidence instead of local prompt heuristics',
    ],
    async run(context) {
      const result = await buildDirectContextGateCase({ baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined });
      try {
        assertWebE2eContract(result.directStatus.verifierInput);
        for (const routed of result.routed) assertWebE2eContract(routed.verifierInput);
        assert.equal(result.directStatus.route, 'direct-context-answer');
        assert.equal(result.directStatus.serverRequests, 0);
        assert.deepEqual(
          result.routed
            .filter((scenario) => scenario.scenario === 'generation' || scenario.scenario === 'repair')
            .map((scenario) => scenario.scenario)
            .sort(),
          ['generation', 'repair'],
        );
        for (const routed of result.routed) {
          assert.equal(routed.decision.sufficiency, 'insufficient');
          assert.equal(routed.decision.allowDirectContext, false);
          assert.equal(routed.directPayload, undefined);
          assert.ok(routed.runtimeDispatchRun, `${routed.scenario}: offline runtime-dispatch fixture must keep compatibility run evidence`);
          assert.ok(routed.runAudit.refs.includes(routed.decision.decisionRef), `${routed.scenario}: blocked/runtime-dispatch evidence must retain decision ref`);
        }
        const blockedWithEvidence = result.routed.find((scenario) => scenario.scenario === 'tool-status-insufficient');
        assert.equal(blockedWithEvidence?.decision.blockReason, 'tool-status-insufficient');
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
  {
    id: 'SA-WEB-19',
    title: 'Large-file bounded diagnostics',
    tags: finalCaseTags('SA-WEB-19', ['large-file-diagnostics', 'large-file-bounded-diagnostics', 'read-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'large log/text source is referenced through an index instead of raw prompt text',
      'follow-up anomaly inspection reads only bounded snippets from the selected large-file ref',
      'terminal answer exports diagnostic report plus a read-fragment manifest proving no full-text transcript stuffing',
    ],
    async run(context) {
      const result = await runLargeFileDiagnosticsCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      try {
        await assertLargeFileDiagnosticsCase(result);
      } finally {
        await closeLargeFileDiagnosticsCase(result);
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-20',
    title: 'Long-format messy CSV coefficient comparison',
    tags: finalCaseTags('SA-WEB-20', ['longitudinal-messy-csv', 'data-statistics-lineage', 'read-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'long-format subject/group/timepoint/batch/outcome CSV is read through refs instead of raw prompt text',
      'batch/timepoint covariates are added in a follow-up and treatment coefficient changes are compared',
      'terminal answer exports report, cleaned data, chart, coefficient comparison, and rerun code refs',
    ],
    async run(context) {
      const result = await runLongitudinalMessyCsvCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      try {
        await assertLongitudinalMessyCsvCase(result);
      } finally {
        await closeLongitudinalMessyCsvCase(result);
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-21',
    title: 'Schema drift confounder reinterpretation',
    tags: finalCaseTags('SA-WEB-21', ['schema-drift-confounder', 'stale-valid-refs', 'read-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'generic schema table is analyzed without hard-coded treatment/placebo or biomarker assumptions',
      'follow-up reveals a site/batch confounder and reclassifies earlier refs as stale or still valid',
      'terminal answer exports a notebook-style method section and valid/stale refs manifest',
    ],
    async run(context) {
      const result = await runSchemaDriftConfounderCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      try {
        await assertSchemaDriftConfounderCase(result);
      } finally {
        await closeSchemaDriftConfounderCase(result);
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-22',
    title: 'Two-table merge lineage and reproducibility',
    tags: finalCaseTags('SA-WEB-22', ['two-table-lineage', 'data-lineage', 'read-ref', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'two mismatched source tables and mapping rules are read by refs for an initial merge',
      'mapping and filter updates recompute metrics while preserving lineage for final columns and rules',
      'terminal answer exports cleaned data, mapping artifact, lineage manifest, and reproducibility command',
    ],
    async run(context) {
      const result = await runTwoTableLineageCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      try {
        await assertTwoTableLineageCase(result);
      } finally {
        await closeTwoTableLineageCase(result);
      }
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-23',
    title: 'Progressive GUI resource probing',
    tags: finalCaseTags('SA-WEB-23', ['progressive-gui-resource-probing', 'gui-resource-probing', 'protocol-coverage', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'GUI context is probed through shell and hot-region resources before any detail resource',
      'region-detail is read only after a narrow commandText question',
      'full DOM and debug snapshot resources stay unread and out of transcript/Projection',
    ],
    async run(context) {
      const result = await runGuiResourceProbingCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertGuiResourceProbingCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-24',
    title: 'gui.ask_user clarification commandText',
    tags: finalCaseTags('SA-WEB-24', ['gui-ask-user-clarification', 'gui-ask-user', 'protocol-coverage', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'clarification intent renders a visible gui.ask_user prompt instead of applying local GUI logic',
      'user confirmation text returns as terminal-equivalent commandText',
      'confirmed commandText routes through runtime dispatch with no GUI local business function',
    ],
    async run(context) {
      const result = await runGuiAskUserClarificationCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertGuiAskUserClarificationCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-28',
    title: 'Text-only GUI action command trace',
    tags: finalCaseTags('SA-WEB-28', ['text-only-gui-action', 'gui-action-command-trace', 'protocol-coverage', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'visible open/retry/export/recover/delete GUI actions reduce to terminal-equivalent commandText',
      'commandText dispatches carry durable refs and audit trace across artifact, run, audit, recovery, and selected-object panels',
      'hidden GUI business payloads and local business execution stay absent',
    ],
    async run(context) {
      const result = await runGuiActionCommandTraceCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertGuiActionCommandTraceCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-29',
    title: 'Native Runtime Codex selected-artifact resume follow-up',
    tags: finalCaseTags('SA-WEB-29', ['native-session-artifact-followup', 'runtime-codex-native-resume', 'selected-artifact-followup', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'initial Runtime Codex task exposes codexSessionId and a durable artifact ref',
      'selected-artifact follow-up commandText contains only the new user request plus selected refs',
      'native resume metadata ties the derived artifact to the prior Codex session and exposes unsupported resume as blocked',
    ],
    async run(context) {
      const result = await runNativeSessionArtifactFollowupCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertNativeSessionArtifactFollowupContract(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-30',
    title: 'Long-context original constraint stability',
    tags: finalCaseTags('SA-WEB-30', ['long-context-constraint-stability', 'stable-original-constraint', 'bounded-audit-refs', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'first turn records a concrete original constraint',
      'unrelated artifact-heavy literature/data work creates long-context pressure without becoming final context',
      'final answer recovers the original constraint and keeps unrelated artifact refs out of visible output and final audit refs',
    ],
    async run(context) {
      const result = await runLongContextConstraintStabilityCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
        outputRoot: context?.evidenceRoot,
      });
      assertLongContextConstraintStabilityCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-31',
    title: 'Current literature retrieval and selected-report follow-up',
    tags: finalCaseTags('SA-WEB-31', ['literature-current-selected-report', 'current-arxiv-retrieval', 'selected-report-followup', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'latest/today arXiv-style retrieval records queries, candidates, PDF/read states, blocked reasons, and Chinese report path',
      'report reorder preserves method, environment/task, evidence strength, benchmark, and limitation axes',
      'selected report follow-up proves old/new selected refs stay scoped instead of leaking latest artifact context',
    ],
    async run() {
      const result = buildLiteratureCurrentAndSelectedReportCase();
      assertLiteratureCurrentAndSelectedReportCase(result);
      return summaryFor(this);
    },
  },
  {
    id: 'SA-WEB-32',
    title: 'Contradictory literature evidence and dynamic web status',
    tags: finalCaseTags('SA-WEB-32', ['literature-evidence-conflict', 'dynamic-web-evidence-status', 'blocked-web-status', 'smoke:browser-provider-preflight', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-provider-preflight', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'arXiv, PubMed, Semantic Scholar, and web evidence remain separated by direction, quality, confounders, datasets, and replication risk',
      'grant rewrite uses cautious claim language and exported citations instead of flattening contradiction evidence',
      'dynamic web fact check records fetched, rendered, Cloudflare, 403, timeout, empty, and cached fallback statuses without fabricated content',
    ],
    async run(context) {
      const result = await runLiteratureEvidenceConflictCase(context ? join(context.evidenceRoot, this.id) : undefined);
      assertLiteratureEvidenceConflictCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-33',
    title: 'Targeted code repair from failing test',
    tags: finalCaseTags('SA-WEB-33', ['targeted-code-repair', 'generic-source-fix', 'no-artifact-fake-fix', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'repair starts from a concrete failing command and root-cause diagnosis',
      'only the generic source file changes while diagnostic output artifacts remain evidence',
      'targeted rerun, changed files, risks, and broader-test recommendation are reported',
    ],
    async run(context) {
      const result = await buildTargetedCodeRepairCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertWebE2eContract(result.verifierInput);
      assertTargetedCodeRepairContract(result.contract);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-34',
    title: 'Dirty worktree repair preserves user changes',
    tags: finalCaseTags('SA-WEB-34', ['dirty-worktree-preservation', 'protected-file-constraint', 'no-reset-revert', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'dirty worktree state is inspected before repair and user-owned files are recorded',
      'later protected-file constraints are honored while only agent-owned repair file changes',
      'diff summary includes byte-stable proof and no reset/revert behavior',
    ],
    async run(context) {
      const result = await buildDirtyWorktreeCollaborationCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertWebE2eContract(result.verifierInput);
      assertDirtyWorktreeCollaborationContract(result.contract);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-35',
    title: 'Scientific reviewer and verifier repair loop',
    tags: finalCaseTags('SA-WEB-35', ['scientific-reviewer-verifier-loop', 'protocol-reviewer-loop', 'evidence-graph-contradictions', 'verifier-critique-repair', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'protocol package reviewer loop updates dependent artifacts and keeps old values only in history',
      'biomedical evidence graph carries evidence refs, contradiction evidence, confidence changes, and what-would-change-my-mind export',
      'single-cell and verifier critique flows require repaired artifacts, UI refs, and audit refs before completion',
    ],
    async run(context) {
      const cases = await buildScientificReviewerVerifierLoopCases({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      for (const entry of cases) assertScientificReviewerVerifierLoopCase(entry);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-36',
    title: 'Capability, skill, and Computer Use boundaries',
    tags: finalCaseTags('SA-WEB-36', ['capability-discovery-boundary', 'codex-native-skill-promotion', 'computer-use-evidence-folding', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'capability discovery remains a TUI-native progressive plan with alternatives and route changes, not GUI ranking or completion evidence',
      'skill promotion is staged as Codex-native skill, plugin, MCP, and slash-command proposals with explicit validation gates',
      'Computer Use raw screenshot/log refs fold into audit-only evidence and React/UI never executes Computer Use actions',
    ],
    async run(context) {
      const result = await runCapabilitySkillComputerUseBoundariesCase({
        baseDir: context ? join(context.runRoot, this.id, 'workspace') : undefined,
      });
      assertCapabilitySkillComputerUseBoundariesCase(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-37',
    title: 'Run/resume lifecycle recovery boundaries',
    tags: finalCaseTags('SA-WEB-37', ['service-lifecycle-recovery', 'cancel-partial-continuation', 'browser-refresh-recovery', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-multiturn'],
    migratedLegacySteps: [
      'stale process cleanup and actual fallback port evidence are required before service lifecycle recovery can pass',
      'cancelled runs preserve partial artifacts and continue only the safe remaining steps',
      'browser refresh restoration is distinguished from native Runtime Codex session continuity',
    ],
    async run(context) {
      const result = buildRunResumeLifecycleRecoveryFixture();
      assertRunResumeLifecycleRecoveryFixture(result);
      return summaryFor(this, context);
    },
  },
  {
    id: 'SA-WEB-38',
    title: 'Provider budget, security audit, and outage recovery',
    tags: finalCaseTags('SA-WEB-38', ['runtime-provider-budget', 'secret-raw-stream-scrub', 'failed-run-audit-export', 'provider-outage-recovery', 'provider-security-budget-audit', 'smoke:browser-provider-preflight', 'smoke:browser-multiturn']),
    migratedLegacyScripts: ['smoke:browser-provider-preflight', 'smoke:browser-multiturn'],
    migratedLegacySteps: [
      'DeepSeek Runtime Codex profile/model/provider/workspace/command transparency blocks silent OpenAI fallback',
      'raw provider streams, stderr, HTML challenge bodies, endpoint fields, and secrets are scrubbed from foreground and audit evidence',
      'provider outage runs stay repair-needed and later recovery must use fresh dispatch evidence instead of failed output',
    ],
    async run(context) {
      const result = createProviderSecurityBudgetAuditFixture();
      assertProviderSecurityBudgetAuditFixture(result);
      return summaryFor(this, context);
    },
  },
];

export function selectWebE2eCases(options: { tags?: string[]; cases?: string[] } = {}): WebE2eCaseDefinition[] {
  const tags = (options.tags ?? []).flatMap((tag) => tag === 'SA-WEB-27' ? ['SA-WEB-18'] : [tag]);
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
    runtimeDispatchMode: context?.runtimeDispatchMode,
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
