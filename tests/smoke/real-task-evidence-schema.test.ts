import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';

import {
  type DesktopLiveAcceptanceEvidence,
  validateDesktopLiveAcceptanceEvidence,
} from '../../src/desktop/desktop-live-acceptance-evidence.js';
import {
  CANCELLATION_EVIDENCE_SCHEMA_VERSION,
  validateCancellationEvidenceLedger,
} from '../../src/runtime/codex/cancellation-evidence.js';
import {
  SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION,
  validateServiceLifecycleEvidenceLedger,
} from '../../src/runtime/codex/service-lifecycle-evidence.js';

type RealTaskEvidenceStatus = 'not-run' | 'blocked' | 'partial' | 'failed' | 'passed';

type RealTaskEvidenceManifest = {
  taskId: string;
  status: RealTaskEvidenceStatus;
  releaseEligible?: boolean;
  releaseBlocking?: boolean;
  attemptScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  currentRunEvidenceScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  source?: {
    entrypoint?: string;
    evidenceMode?: string;
    devServices?: string;
    harnessMode?: string;
    runtimeSource?: string;
  };
  entrypointExpectations?: {
    entrypoint?: string;
    startedFromDefaultChatEntry?: boolean;
    requiresRuntimeCodex?: boolean;
    requiresLiveBrowserAcceptance?: boolean;
    requiresProductionDesktopAcceptance?: boolean;
    requiresVisibleGuiPresentAnswer?: boolean;
    allowsScriptableMockAsPass?: boolean;
    allowsSeedDemoFixtureAsPass?: boolean;
  };
  provider?: string | null;
  model?: string | null;
  profile?: string | null;
  workspacePath?: string;
  actualUrl?: string;
  actualPort?: number;
  commandId?: string;
  desktopLiveAcceptanceEvidenceRef?: string;
  evidenceRefs?: string[];
  selectedRefEvidence?: {
    artifactRef?: string;
    exemptionReason?: string;
    evidenceRefs?: string[];
    selectedRefs?: string[];
    forbiddenRefs?: string[];
    followupRunIds?: string[];
    latestArtifactUsed?: boolean;
    derivedArtifactRef?: string;
    resumeMetadataRef?: string;
    commandTextPolicy?: {
      newUserRequestOnly?: boolean;
      selectedRefsOnly?: boolean;
      replaysGuiTranscript?: boolean;
      includesFullArtifactBody?: boolean;
      evidenceRefs?: string[];
    };
  };
  restoredGuiStateSource?: string;
  nativeContinuity?: {
    codexSessionId?: string;
    resumeCommand?: string;
    attemptId?: string;
    evidenceRefs?: string[];
  };
  serviceLifecycleEvidence?: {
    ledgerRef?: string;
    actualPort?: number;
    cleanupEvidenceRefs?: string[];
    readinessCheckRefs?: string[];
    browserRefreshEvidenceRefs?: string[];
    passClaimRefs?: string[];
  };
  cancellationEvidence?: {
    ledgerRef?: string;
    safeContinuationPlanRef?: string;
    partialArtifactRefs?: string[];
    unsafeRemainderRefs?: string[];
    irreversibleSideEffectRefs?: string[];
  };
  securityScrubEvidence?: {
    rawAuditBundleManifestRef?: string;
    diagnosisRef?: string;
    correctedConfigRetryRef?: string;
    primaryReplyDomRefs?: string[];
    forbiddenLeakCheckRefs?: string[];
  };
  failedRunAuditExport?: {
    bundleManifestRef?: string;
    runId?: string;
    commandId?: string;
    provider?: string;
    model?: string;
    profile?: string;
    boundedScrubbedRefs?: string[];
  };
  providerOutageRecovery?: {
    failureClassification?: string;
    initialFailureStatus?: string;
    initialFailureRunId?: string;
    recoveryRunId?: string;
    initialFailureRef?: string;
    recoveryEvidenceRef?: string;
    freshDispatchEvidenceRef?: string;
    reusedFailedOutputAsSuccessEvidence?: boolean;
  };
  capabilityDiscoveryEvidence?: {
    rounds?: Array<{
      round?: number;
      tuiPlanningRef?: string;
      chosenRoute?: string;
      alternatives?: string[];
      discoveryPlanIsCompletionEvidence?: boolean;
      guiRankingAbsent?: boolean;
      completionEvidenceRefAbsent?: boolean;
    }>;
    routeChanged?: boolean;
    finalRouteChangeRef?: string;
    finalAnswerRef?: string;
    evidenceRefs?: string[];
  };
  skillPromotionEvidence?: {
    artifactRef?: string;
    workspaceProposalRef?: string;
    stagingOnly?: boolean;
    targets?: Array<{
      targetType?: string;
      scope?: string[];
      safetyGates?: string[];
      validationCommands?: string[];
      installCallLocation?: string;
    }>;
    evidenceRefs?: string[];
  };
  computerUseEvidenceFold?: {
    foldedEvidenceRef?: string;
    rawRefs?: Array<{
      kind?: string;
      ref?: string;
      auditOnly?: boolean;
      foldedIntoRef?: string;
    }>;
    uiExecutedComputerUseActions?: boolean;
    visibleArtifactRefs?: string[];
    primaryArtifactRefs?: string[];
    supportingArtifactRefs?: string[];
    evidenceRefs?: string[];
  };
  turns: Array<{
    turnId: string;
    prompt: string;
    visibleAnswer?: string | { text?: string };
    screenshotRefs?: string[];
    auditRefs?: string[];
    evidenceSource?: string;
  }>;
  visibleAnswer?: string | { text?: string };
  screenshotRefs?: string[];
  auditRefs?: string[];
  artifactPaths?: string[];
  noArtifactReason?: string;
};

test('passed real-task evidence accepts live browser evidence with three turns and existing artifacts', () => {
  withEvidenceWorkspace((workspace) => {
    const manifest = passedManifest(workspace);

    assertRealTaskEvidenceManifest(manifest, { workspaceRoot: workspace });
  });
});

test('passed desktop real-task evidence accepts the production desktop cold-start entrypoint', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(desktopPassedManifest(workspace, 'R-DESK-01'), { workspaceRoot: workspace });
    assertRealTaskEvidenceManifest(desktopPassedManifest(workspace, 'R-PKG-01'), { workspaceRoot: workspace });
  });
});

test('passed desktop real-task evidence requires a validated desktop live-acceptance evidence ref', () => {
  withEvidenceWorkspace((workspace) => {
    const missing = desktopPassedManifest(workspace, 'R-DESK-01');
    delete missing.desktopLiveAcceptanceEvidenceRef;
    assert.throws(
      () => assertRealTaskEvidenceManifest(missing, { workspaceRoot: workspace }),
      /desktopLiveAcceptanceEvidenceRef/,
    );

    const invalidEvidenceRef = writeDesktopLiveAcceptanceEvidence(workspace, 'invalid-desktop-live-acceptance.json', {
      runtimeTask: {
        auditRefs: ['runtime-codex/codex-command-desktop-live-001/manifest.json'],
      },
    });
    assert.throws(
      () => assertRealTaskEvidenceManifest(desktopPassedManifest(workspace, 'R-PKG-01', invalidEvidenceRef), { workspaceRoot: workspace }),
      /desktop live acceptance evidence must validate/,
    );
  });
});

test('R-RESUME-02 passed evidence accepts restored GUI source plus native Codex continuity', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(resume02PassedManifest(workspace), { workspaceRoot: workspace });
  });
});

test('passed real-task evidence accepts an explicit no-artifact reason', () => {
  withEvidenceWorkspace((workspace) => {
    const manifest = {
      ...passedManifest(workspace),
      artifactPaths: [],
      noArtifactReason: 'This task only verifies recovery state and does not create a workspace artifact.',
    };

    assertRealTaskEvidenceManifest(manifest, { workspaceRoot: workspace });
  });
});

test('passed real-task evidence rejects fixture-managed provenance', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        source: {
          ...passedManifest(workspace).source,
          devServices: 'fixture-managed',
        },
      }, { workspaceRoot: workspace }),
      /fixture-managed|scriptable-mock/,
    );
  });
});

test('passed real-task evidence rejects scriptable-mock provenance', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        turns: passedManifest(workspace).turns.map((turn, index) => index === 0
          ? { ...turn, evidenceSource: 'scriptable-mock' }
          : turn),
      }, { workspaceRoot: workspace }),
      /fixture-managed|scriptable-mock/,
    );
  });
});

test('passed real-task evidence rejects empty screenshots, visible answer, or audit refs', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({ ...passedManifest(workspace), screenshotRefs: [] }, { workspaceRoot: workspace }),
      /screenshot/,
    );
    assert.throws(
      () => assertRealTaskEvidenceManifest({ ...passedManifest(workspace), visibleAnswer: { text: '   ' } }, { workspaceRoot: workspace }),
      /visibleAnswer/,
    );
    assert.throws(
      () => assertRealTaskEvidenceManifest({ ...passedManifest(workspace), auditRefs: [] }, { workspaceRoot: workspace }),
      /auditRefs/,
    );
  });
});

test('passed real-task evidence requires live Runtime Codex provenance and provider metadata', () => {
  withEvidenceWorkspace((workspace) => {
    for (const patch of [
      { source: { ...passedManifest(workspace).source, entrypoint: 'fixture-entrypoint' } },
      { source: { ...passedManifest(workspace).source, evidenceMode: '' } },
      { source: { ...passedManifest(workspace).source, runtimeSource: 'agentserver' } },
      { provider: '' },
      { model: '' },
      { profile: '' },
    ]) {
      assert.throws(
        () => assertRealTaskEvidenceManifest({ ...passedManifest(workspace), ...patch }, { workspaceRoot: workspace }),
        /supported live entrypoint|live-runtime-codex|Runtime Codex|provider|model|profile/,
      );
    }
  });
});

test('passed real-task evidence requires URL, port, command id, and evidence refs', () => {
  withEvidenceWorkspace((workspace) => {
    for (const patch of [
      { actualUrl: 'http://example.com/' },
      { actualPort: 0 },
      { commandId: 'manual-command' },
      { workspacePath: 'relative/workspace' },
      { evidenceRefs: [] },
      { evidenceRefs: ['missing-dom.txt'] },
    ]) {
      assert.throws(
        () => assertRealTaskEvidenceManifest({ ...passedManifest(workspace), ...patch }, { workspaceRoot: workspace }),
        /actualUrl|actual browser URL|actualPort|commandId|workspacePath|evidenceRefs|evidence ref must exist/,
      );
    }
  });
});

test('passed real-task evidence requires selected-ref proof or explicit exemption', () => {
  withEvidenceWorkspace((workspace) => {
    const missing = passedManifest(workspace);
    delete missing.selectedRefEvidence;
    assert.throws(
      () => assertRealTaskEvidenceManifest(missing, { workspaceRoot: workspace }),
      /selectedRefEvidence/,
    );

    assertRealTaskEvidenceManifest({
      ...passedManifest(workspace),
      selectedRefEvidence: {
        exemptionReason: 'This recovery-only task has no selectable artifact, and the UI showed an explicit no-artifact reason.',
        evidenceRefs: ['evidence-dom.txt'],
      },
    }, { workspaceRoot: workspace });
  });
});

test('R-LIT-03 passed evidence requires selected-report scope and selection switch proof', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(lit03PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...lit03PassedManifest(workspace),
        selectedRefEvidence: {
          ...lit03PassedManifest(workspace).selectedRefEvidence,
          latestArtifactUsed: true,
        },
      }, { workspaceRoot: workspace }),
      /latest artifact/,
    );

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...lit03PassedManifest(workspace),
        selectedRefEvidence: {
          ...lit03PassedManifest(workspace).selectedRefEvidence,
          selectedRefs: ['artifact:r-lit-03-old-report'],
        },
      }, { workspaceRoot: workspace }),
      /selected report refs/,
    );
  });
});

test('R-RESUME-01 passed evidence requires native resume metadata and commandText policy', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(resume01PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...resume01PassedManifest(workspace),
        selectedRefEvidence: {
          ...resume01PassedManifest(workspace).selectedRefEvidence,
          commandTextPolicy: {
            ...resume01PassedManifest(workspace).selectedRefEvidence?.commandTextPolicy,
            includesFullArtifactBody: true,
          },
        },
      }, { workspaceRoot: workspace }),
      /commandText/,
    );

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...resume01PassedManifest(workspace),
        nativeContinuity: undefined,
      }, { workspaceRoot: workspace }),
      /nativeContinuity/,
    );
  });
});

test('R-RESUME-02 passed evidence rejects missing restored GUI state source', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...resume02PassedManifest(workspace),
        restoredGuiStateSource: '',
      }, { workspaceRoot: workspace }),
      /restoredGuiStateSource/,
    );
  });
});

test('R-RESUME-02 passed evidence rejects Projection-only native resume claims', () => {
  withEvidenceWorkspace((workspace) => {
    const projectionOnly = resume02PassedManifest(workspace);
    delete projectionOnly.nativeContinuity;
    assert.throws(
      () => assertRealTaskEvidenceManifest(projectionOnly, { workspaceRoot: workspace }),
      /Projection-only evidence cannot satisfy Runtime Codex native continuity/,
    );

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...resume02PassedManifest(workspace),
        nativeContinuity: {
          codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
          attemptId: 'codex-command-refresh-attempt-2',
          resumeCommand: 'restore from conversation-projection only',
        },
      }, { workspaceRoot: workspace }),
      /nativeContinuity\.resumeCommand/,
    );
  });
});

test('R-RUN-01 passed evidence requires a valid service lifecycle ledger tied to the actual port', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(run01PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...run01PassedManifest(workspace),
        serviceLifecycleEvidence: {
          ...run01PassedManifest(workspace).serviceLifecycleEvidence,
          actualPort: 5173,
        },
      }, { workspaceRoot: workspace }),
      /serviceLifecycleEvidence\.actualPort/,
    );
  });
});

test('R-RUN-02 passed evidence requires cancellation ledger and safe-remainder continuation plan', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(run02PassedManifest(workspace), { workspaceRoot: workspace });

    writeFileSync(join(workspace, 'boundaryless-plan.json'), JSON.stringify({
      reason: 'boundaryless-resume-blocked',
    }, null, 2));
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...run02PassedManifest(workspace),
        cancellationEvidence: {
          ...run02PassedManifest(workspace).cancellationEvidence,
          safeContinuationPlanRef: 'boundaryless-plan.json',
        },
      }, { workspaceRoot: workspace }),
      /safeContinuationPlanRef/,
    );
  });
});

test('R-SEC-01 passed evidence requires scrubbed raw stream proof and corrected config retry refs', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(sec01PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...sec01PassedManifest(workspace),
        securityScrubEvidence: {
          ...sec01PassedManifest(workspace).securityScrubEvidence,
          primaryReplyDomRefs: [],
        },
      }, { workspaceRoot: workspace }),
      /primaryReplyDomRefs/,
    );
  });
});

test('R-AUDIT-01 passed evidence requires bounded Runtime Codex audit bundle metadata', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(audit01PassedManifest(workspace), { workspaceRoot: workspace });

    writeRuntimeAuditBundle(workspace, {
      manifestRef: 'invalid-audit-bundle/manifest.json',
      bytes: 4097,
      maxBytes: 1024,
    });
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...audit01PassedManifest(workspace),
        failedRunAuditExport: {
          ...audit01PassedManifest(workspace).failedRunAuditExport,
          bundleManifestRef: 'invalid-audit-bundle/manifest.json',
        },
      }, { workspaceRoot: workspace }),
      /bounded audit file/,
    );
  });
});

test('R-FAIL-01 passed evidence requires fresh provider recovery instead of failed-output reuse', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(fail01PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...fail01PassedManifest(workspace),
        providerOutageRecovery: {
          ...fail01PassedManifest(workspace).providerOutageRecovery,
          reusedFailedOutputAsSuccessEvidence: true,
        },
      }, { workspaceRoot: workspace }),
      /reusedFailedOutputAsSuccessEvidence/,
    );
  });
});

test('R-CAP-01 passed evidence requires TUI-native progressive disclosure, alternatives, and route change proof', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(cap01PassedManifest(workspace), { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...cap01PassedManifest(workspace),
        capabilityDiscoveryEvidence: {
          ...cap01PassedManifest(workspace).capabilityDiscoveryEvidence,
          routeChanged: false,
        },
      }, { workspaceRoot: workspace }),
      /routeChanged/,
    );

    const guiRanked = cap01PassedManifest(workspace);
    guiRanked.capabilityDiscoveryEvidence!.rounds![1] = {
      ...guiRanked.capabilityDiscoveryEvidence!.rounds![1],
      guiRankingAbsent: false,
    };
    assert.throws(
      () => assertRealTaskEvidenceManifest(guiRanked, { workspaceRoot: workspace }),
      /guiRankingAbsent/,
    );
  });
});

test('R-SKILL-01 passed evidence requires Codex-native promotion targets with gates and staging-only workspace proposal', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(skill01PassedManifest(workspace), { workspaceRoot: workspace });

    const missingMcp = skill01PassedManifest(workspace);
    missingMcp.skillPromotionEvidence!.targets = missingMcp.skillPromotionEvidence!.targets!.filter(
      (target) => target.targetType !== 'mcp',
    );
    assert.throws(
      () => assertRealTaskEvidenceManifest(missingMcp, { workspaceRoot: workspace }),
      /skill\/plugin\/MCP\/slash-command/,
    );

    const uiOwned = skill01PassedManifest(workspace);
    uiOwned.skillPromotionEvidence!.targets![0] = {
      ...uiOwned.skillPromotionEvidence!.targets![0],
      installCallLocation: 'React renderer button',
    };
    assert.throws(
      () => assertRealTaskEvidenceManifest(uiOwned, { workspaceRoot: workspace }),
      /React\/UI-owned/,
    );
  });
});

test('R-CU-01 passed evidence requires folded audit-only Computer Use raw refs and no React/UI execution', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest(cu01PassedManifest(workspace), { workspaceRoot: workspace });

    const visibleRaw = cu01PassedManifest(workspace);
    visibleRaw.computerUseEvidenceFold!.visibleArtifactRefs = [
      ...visibleRaw.computerUseEvidenceFold!.visibleArtifactRefs!,
      visibleRaw.computerUseEvidenceFold!.rawRefs![0]!.ref!,
    ];
    assert.throws(
      () => assertRealTaskEvidenceManifest(visibleRaw, { workspaceRoot: workspace }),
      /raw Computer Use ref must not be visible/,
    );

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...cu01PassedManifest(workspace),
        computerUseEvidenceFold: {
          ...cu01PassedManifest(workspace).computerUseEvidenceFold,
          uiExecutedComputerUseActions: true,
        },
      }, { workspaceRoot: workspace }),
      /React\/UI must not execute Computer Use actions/,
    );
  });
});

test('passed real-task evidence requires at least three real turns', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        turns: passedManifest(workspace).turns.slice(0, 2),
      }, { workspaceRoot: workspace }),
      /at least three turns/,
    );
  });
});

test('passed real-task evidence requires artifact paths to exist', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        artifactPaths: ['missing/report.md'],
      }, { workspaceRoot: workspace }),
      /artifact path must exist/,
    );
  });
});

test('passed real-task evidence requires artifacts or an explicit no-artifact reason', () => {
  withEvidenceWorkspace((workspace) => {
    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        artifactPaths: [],
        noArtifactReason: '',
      }, { workspaceRoot: workspace }),
      /artifact path or noArtifactReason/,
    );
  });
});

test('blocked partial and failed real-task evidence cannot count as release eligible', () => {
  withEvidenceWorkspace((workspace) => {
    for (const status of ['blocked', 'partial', 'failed'] as const) {
      assert.throws(
        () => assertRealTaskEvidenceManifest({
          ...passedManifest(workspace),
          status,
          releaseEligible: true,
          releaseBlocking: true,
          attemptScope: 'shared-preflight',
          currentRunEvidenceScope: 'shared-preflight',
        }, { workspaceRoot: workspace }),
        /release eligible/,
      );
    }
  });
});

test('blocked partial and failed real-task evidence may be recorded when releaseEligible is false', () => {
  withEvidenceWorkspace((workspace) => {
    for (const status of ['blocked', 'partial', 'failed'] as const) {
      assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        status,
        releaseEligible: false,
        releaseBlocking: true,
        attemptScope: 'shared-preflight',
        currentRunEvidenceScope: 'shared-preflight',
        evidenceRefs: [],
      }, { workspaceRoot: workspace });
    }
  });
});

test('non-passed real-task evidence refs require live-attempt scope and existing refs', () => {
  withEvidenceWorkspace((workspace) => {
    assertRealTaskEvidenceManifest({
      ...passedManifest(workspace),
      status: 'blocked',
      releaseEligible: false,
      releaseBlocking: true,
      attemptScope: 'task-specific-live-attempt',
      currentRunEvidenceScope: 'task-specific-live-attempt',
      evidenceRefs: ['evidence-dom.txt'],
    }, { workspaceRoot: workspace });

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        status: 'partial',
        releaseEligible: false,
        releaseBlocking: true,
        attemptScope: 'shared-preflight',
        currentRunEvidenceScope: 'shared-preflight',
        evidenceRefs: ['evidence-dom.txt'],
      }, { workspaceRoot: workspace }),
      /task-specific live attempt scope/,
    );

    assert.throws(
      () => assertRealTaskEvidenceManifest({
        ...passedManifest(workspace),
        status: 'failed',
        releaseEligible: false,
        releaseBlocking: true,
        attemptScope: 'task-specific-live-attempt',
        currentRunEvidenceScope: 'task-specific-live-attempt',
        evidenceRefs: ['missing-evidence.txt'],
      }, { workspaceRoot: workspace }),
      /evidence ref must exist/,
    );
  });
});

function assertRealTaskEvidenceManifest(
  manifest: RealTaskEvidenceManifest,
  options: { workspaceRoot: string },
): void {
  assert.match(manifest.taskId, /^R-[A-Z]+-\d{2}$/, 'taskId must be a PROJECT.md R-* id');

  if (manifest.status !== 'passed') {
    assert.notEqual(manifest.releaseEligible, true, `${manifest.taskId}: ${manifest.status} evidence cannot be release eligible`);
    assert.equal(manifest.releaseEligible, false, `${manifest.taskId}: ${manifest.status} evidence must explicitly reject release eligibility`);
    assert.equal(manifest.releaseBlocking, true, `${manifest.taskId}: ${manifest.status} evidence must remain release blocking`);
    assertNonPassedEvidenceScope(manifest, options.workspaceRoot);
    return;
  }

  assert.equal(manifest.releaseEligible, true, `${manifest.taskId}: passed evidence must be release eligible`);
  assert.equal(manifest.releaseBlocking, false, `${manifest.taskId}: passed evidence must not remain release blocking`);
  assertNoFixtureEvidence(manifest);
  assert.ok(manifest.turns.length >= 3, `${manifest.taskId}: passed evidence must include at least three turns`);
  for (const turn of manifest.turns) {
    assert.ok(turn.turnId.trim(), `${manifest.taskId}: turnId is required`);
    assert.ok(turn.prompt.trim(), `${manifest.taskId}: turn prompt is required`);
  }

  assert.ok(stringList(manifest.screenshotRefs).length > 0, `${manifest.taskId}: passed evidence must include non-empty screenshotRefs`);
  assert.ok(visibleAnswerText(manifest.visibleAnswer).trim(), `${manifest.taskId}: passed evidence must include non-empty visibleAnswer text`);
  assert.ok(stringList(manifest.auditRefs).length > 0, `${manifest.taskId}: passed evidence must include non-empty auditRefs`);
  assertLiveRuntimeCodexProvenance(manifest, options.workspaceRoot);
  assertDesktopLiveAcceptanceEvidence(manifest, options.workspaceRoot);
  assertSelectedRefEvidence(manifest, options.workspaceRoot);
  assertLit03SelectedReportFollowupEvidence(manifest, options.workspaceRoot);
  assertResume01NativeArtifactFollowupEvidence(manifest, options.workspaceRoot);
  assertResume02ContinuityEvidence(manifest);
  assertTaskGroupCEvidence(manifest, options.workspaceRoot);

  const artifactPaths = stringList(manifest.artifactPaths);
  if (artifactPaths.length === 0) {
    assert.ok(manifest.noArtifactReason?.trim(), `${manifest.taskId}: passed evidence must include an artifact path or noArtifactReason`);
    return;
  }
  for (const artifactPath of artifactPaths) {
    assert.ok(
      existsSync(resolveWorkspacePath(options.workspaceRoot, artifactPath)),
      `${manifest.taskId}: artifact path must exist: ${artifactPath}`,
    );
  }
}

function assertNonPassedEvidenceScope(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidenceRefs = optionalStringList(manifest.evidenceRefs);
  if (evidenceRefs.length === 0) {
    assert.ok(
      manifest.attemptScope === 'shared-preflight' || manifest.attemptScope === 'desktop-preflight',
      `${manifest.taskId}: ${manifest.status} evidence without evidenceRefs must declare shared preflight scope`,
    );
    assert.equal(
      manifest.currentRunEvidenceScope,
      manifest.attemptScope,
      `${manifest.taskId}: currentRunEvidenceScope must mirror attemptScope`,
    );
    return;
  }
  assert.ok(
    manifest.attemptScope === 'task-specific-live-attempt' || manifest.attemptScope === 'desktop-live-attempt',
    `${manifest.taskId}: ${manifest.status} evidence with evidenceRefs must declare a task-specific live attempt scope`,
  );
  assert.equal(
    manifest.currentRunEvidenceScope,
    manifest.attemptScope,
    `${manifest.taskId}: currentRunEvidenceScope must mirror attemptScope`,
  );
  assertEvidenceRefsExist(evidenceRefs, workspaceRoot, `${manifest.taskId}: non-passed evidenceRefs`);
}

function assertNoFixtureEvidence(manifest: RealTaskEvidenceManifest): void {
  const provenanceValues = [
    manifest.source?.evidenceMode,
    manifest.source?.devServices,
    manifest.source?.harnessMode,
    manifest.source?.runtimeSource,
    ...manifest.turns.map((turn) => turn.evidenceSource),
  ].flatMap((value) => typeof value === 'string' ? [value] : []);
  const forbidden = provenanceValues.find((value) => /^(fixture-managed|scriptable-mock)$/i.test(value));
  assert.equal(
    forbidden,
    undefined,
    `${manifest.taskId}: passed evidence cannot use fixture-managed or scriptable-mock provenance`,
  );
}

function assertLiveRuntimeCodexProvenance(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  assert.ok(
    manifest.source?.entrypoint === 'codex-in-app-browser-default-chat' ||
      manifest.source?.entrypoint === 'production-desktop-cold-start',
    `${manifest.taskId}: passed evidence must record a supported live entrypoint`,
  );
  assert.equal(
    manifest.entrypointExpectations?.entrypoint,
    manifest.source?.entrypoint,
    `${manifest.taskId}: entrypointExpectations must mirror source.entrypoint`,
  );
  assert.equal(manifest.entrypointExpectations?.requiresRuntimeCodex, true, `${manifest.taskId}: passed evidence must require Runtime Codex`);
  assert.equal(manifest.entrypointExpectations?.requiresVisibleGuiPresentAnswer, true, `${manifest.taskId}: passed evidence must require visible GUI answer`);
  if (manifest.source?.entrypoint === 'codex-in-app-browser-default-chat') {
    assert.equal(manifest.entrypointExpectations?.startedFromDefaultChatEntry, true, `${manifest.taskId}: browser evidence must start from default chat`);
    assert.equal(manifest.entrypointExpectations?.requiresLiveBrowserAcceptance, true, `${manifest.taskId}: browser evidence must require live browser acceptance`);
    assert.equal(manifest.entrypointExpectations?.requiresProductionDesktopAcceptance, false, `${manifest.taskId}: browser evidence must not claim desktop acceptance`);
  } else {
    assert.equal(manifest.entrypointExpectations?.startedFromDefaultChatEntry, false, `${manifest.taskId}: desktop evidence must not claim default browser chat start`);
    assert.equal(manifest.entrypointExpectations?.requiresLiveBrowserAcceptance, false, `${manifest.taskId}: desktop evidence must not require browser-only acceptance`);
    assert.equal(manifest.entrypointExpectations?.requiresProductionDesktopAcceptance, true, `${manifest.taskId}: desktop evidence must require production desktop acceptance`);
  }
  assert.equal(manifest.source?.evidenceMode, 'live-runtime-codex', `${manifest.taskId}: passed evidence must be live-runtime-codex`);
  assert.equal(manifest.source?.runtimeSource, 'runtime-codex', `${manifest.taskId}: passed evidence must come from Runtime Codex`);
  assert.doesNotMatch(
    `${manifest.source?.devServices ?? ''} ${manifest.source?.harnessMode ?? ''}`,
    /fixture|mock|seed-demo/i,
    `${manifest.taskId}: passed evidence cannot use fixture, mock, or seed-demo services`,
  );
  assert.ok(stringValue(manifest.provider), `${manifest.taskId}: passed evidence must record provider`);
  assert.ok(stringValue(manifest.model), `${manifest.taskId}: passed evidence must record model`);
  assert.ok(stringValue(manifest.profile), `${manifest.taskId}: passed evidence must record profile`);
  assert.ok(isAbsolute(stringValue(manifest.workspacePath)), `${manifest.taskId}: passed evidence must record an absolute workspacePath`);
  assert.match(stringValue(manifest.actualUrl), /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, `${manifest.taskId}: passed evidence must record the actual browser URL`);
  assert.equal(new URL(stringValue(manifest.actualUrl)).port, String(manifest.actualPort), `${manifest.taskId}: actualUrl port must match actualPort`);
  assert.ok(typeof manifest.actualPort === 'number' && manifest.actualPort > 0, `${manifest.taskId}: passed evidence must record actualPort`);
  assert.match(stringValue(manifest.commandId), /^codex-command-[a-z0-9-]+$/i, `${manifest.taskId}: passed evidence must record Runtime Codex commandId`);
  assertEvidenceRefsExist(stringList(manifest.evidenceRefs), workspaceRoot, `${manifest.taskId}: evidenceRefs`);
}

function assertDesktopLiveAcceptanceEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  if (manifest.taskId !== 'R-DESK-01' && manifest.taskId !== 'R-PKG-01') return;
  const ref = stringValue(manifest.desktopLiveAcceptanceEvidenceRef);
  assert.ok(ref, `${manifest.taskId}: desktopLiveAcceptanceEvidenceRef is required for passed desktop/package evidence`);
  const resolved = resolveWorkspacePath(workspaceRoot, ref);
  assert.ok(existsSync(resolved), `${manifest.taskId}: desktopLiveAcceptanceEvidenceRef must exist: ${ref}`);
  const evidence = JSON.parse(readFileSync(resolved, 'utf8')) as DesktopLiveAcceptanceEvidence;
  const validation = validateDesktopLiveAcceptanceEvidence(evidence);
  assert.equal(
    validation.canClaimPass,
    true,
    `${manifest.taskId}: desktop live acceptance evidence must validate: ${validation.blockReasons.join('; ')}`,
  );
}

function assertSelectedRefEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const selected = manifest.selectedRefEvidence;
  assert.ok(isRecord(selected), `${manifest.taskId}: selectedRefEvidence is required for passed evidence`);
  const artifactRef = stringValue(selected.artifactRef);
  const exemptionReason = stringValue(selected.exemptionReason);
  assert.ok(
    artifactRef || exemptionReason,
    `${manifest.taskId}: selectedRefEvidence must include artifactRef or exemptionReason`,
  );
  if (artifactRef) {
    assert.doesNotMatch(
      artifactRef,
      /latest artifact|implicit|auto-selected/i,
      `${manifest.taskId}: selectedRefEvidence.artifactRef must be an explicit selected ref, not an implicit latest artifact`,
    );
  }
  assertEvidenceRefsExist(stringList(selected.evidenceRefs), workspaceRoot, `${manifest.taskId}: selectedRefEvidence.evidenceRefs`);
}

function assertLit03SelectedReportFollowupEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  if (manifest.taskId !== 'R-LIT-03') return;
  const selected = manifest.selectedRefEvidence;
  assert.ok(isRecord(selected), 'R-LIT-03: selectedRefEvidence is required');
  const selectedRefs = stringList(selected.selectedRefs);
  assert.ok(selectedRefs.length >= 2, 'R-LIT-03: passed evidence must include old and switched selected report refs');
  assert.equal(new Set(selectedRefs).size, selectedRefs.length, 'R-LIT-03: selected report refs must be distinct');
  assert.ok(selectedRefs.every((ref) => /^artifact:r-lit-03-.+-report$/.test(ref)), 'R-LIT-03: selected report refs must be durable R-LIT-03 report refs');
  assert.equal(selected.latestArtifactUsed, false, 'R-LIT-03: selected-report follow-up must prove it did not use the latest artifact');
  assert.ok(stringList(selected.followupRunIds).length >= 2, 'R-LIT-03: passed evidence must include old-report and switched-selection follow-up run ids');
  assert.ok(stringList(selected.forbiddenRefs).length > 0, 'R-LIT-03: passed evidence must record forbidden unselected/latest refs');
  assertEvidenceRefsExist(stringList(selected.evidenceRefs), workspaceRoot, 'R-LIT-03: selected-scope evidence refs');
}

function assertResume01NativeArtifactFollowupEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  if (manifest.taskId !== 'R-RESUME-01') return;
  const selected = manifest.selectedRefEvidence;
  assert.ok(isRecord(selected), 'R-RESUME-01: selectedRefEvidence is required');
  const selectedArtifactRef = stringValue(selected.artifactRef);
  const selectedRefs = stringList(selected.selectedRefs);
  assert.ok(selectedArtifactRef, 'R-RESUME-01: selected artifact ref is required');
  assert.ok(selectedRefs.includes(selectedArtifactRef), 'R-RESUME-01: selectedRefs must include the selected artifact ref');
  const derivedArtifactRef = stringValue(selected.derivedArtifactRef);
  assert.ok(derivedArtifactRef, 'R-RESUME-01: derivedArtifactRef is required');
  assert.notEqual(derivedArtifactRef, selectedArtifactRef, 'R-RESUME-01: derived artifact must differ from the selected source artifact');
  assert.ok(stringValue(selected.resumeMetadataRef), 'R-RESUME-01: resumeMetadataRef is required');

  const commandTextPolicy = selected.commandTextPolicy;
  assert.ok(isRecord(commandTextPolicy), 'R-RESUME-01: commandTextPolicy is required');
  assert.equal(commandTextPolicy.newUserRequestOnly, true, 'R-RESUME-01: commandText must include only the new user request plus refs');
  assert.equal(commandTextPolicy.selectedRefsOnly, true, 'R-RESUME-01: commandText must carry selected refs only');
  assert.equal(commandTextPolicy.replaysGuiTranscript, false, 'R-RESUME-01: commandText must not replay GUI transcript');
  assert.equal(commandTextPolicy.includesFullArtifactBody, false, 'R-RESUME-01: commandText must not include the full artifact body');
  assertEvidenceRefsExist(stringList(commandTextPolicy.evidenceRefs), workspaceRoot, 'R-RESUME-01: commandTextPolicy.evidenceRefs');

  const nativeContinuity = manifest.nativeContinuity;
  assert.ok(isRecord(nativeContinuity), 'R-RESUME-01: nativeContinuity is required');
  const codexSessionId = stringValue(nativeContinuity.codexSessionId);
  const resumeCommand = stringValue(nativeContinuity.resumeCommand);
  assert.ok(codexSessionId, 'R-RESUME-01: nativeContinuity.codexSessionId is required');
  assert.match(resumeCommand, /\bcodex\b.*\bresume\b/i, 'R-RESUME-01: nativeContinuity.resumeCommand must be a Runtime Codex native resume command');
  assert.ok(resumeCommand.includes(codexSessionId), 'R-RESUME-01: resume command must include the native codexSessionId');
  assert.ok(resumeCommand.includes(selectedArtifactRef), 'R-RESUME-01: resume command must include the selected artifact ref');
  assert.doesNotMatch(
    resumeCommand,
    /GUI transcript|full artifact body|projection-only|frontend-memory-only/i,
    'R-RESUME-01: resume command cannot replay GUI transcript or full artifact body',
  );
  assertEvidenceRefsExist(stringList(nativeContinuity.evidenceRefs), workspaceRoot, 'R-RESUME-01: nativeContinuity.evidenceRefs');
}

function assertResume02ContinuityEvidence(manifest: RealTaskEvidenceManifest): void {
  if (manifest.taskId !== 'R-RESUME-02') return;

  const restoredGuiStateSource = stringValue(manifest.restoredGuiStateSource);
  assert.ok(
    restoredGuiStateSource,
    'R-RESUME-02: restoredGuiStateSource is required to distinguish GUI restore from native Runtime Codex continuity',
  );
  assert.doesNotMatch(
    restoredGuiStateSource,
    /^runtime-codex-native-session$/i,
    'R-RESUME-02: restoredGuiStateSource must describe GUI state restoration, not native Runtime Codex continuity',
  );

  const nativeContinuity = manifest.nativeContinuity;
  assert.ok(
    isRecord(nativeContinuity),
    'R-RESUME-02: nativeContinuity is required; Projection-only evidence cannot satisfy Runtime Codex native continuity',
  );

  const codexSessionId = stringValue(nativeContinuity.codexSessionId);
  const resumeCommand = stringValue(nativeContinuity.resumeCommand);
  const attemptId = stringValue(nativeContinuity.attemptId);
  assert.ok(codexSessionId, 'R-RESUME-02: nativeContinuity.codexSessionId is required');
  assert.ok(attemptId, 'R-RESUME-02: nativeContinuity.attemptId is required');
  assert.ok(resumeCommand, 'R-RESUME-02: nativeContinuity.resumeCommand is required');
  assert.match(
    resumeCommand,
    /\bcodex\b.*\bresume\b/i,
    'R-RESUME-02: nativeContinuity.resumeCommand must be a Runtime Codex native resume command',
  );
  assert.ok(
    resumeCommand.includes(codexSessionId),
    'R-RESUME-02: nativeContinuity.resumeCommand must include nativeContinuity.codexSessionId',
  );
  assert.doesNotMatch(
    resumeCommand,
    /projection-only|conversation-projection only|frontend-memory-only/i,
    'R-RESUME-02: Projection-only evidence cannot masquerade as native resume pass',
  );
}

function assertTaskGroupCEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  if (manifest.taskId === 'R-RUN-01') assertServiceLifecycleEvidence(manifest, workspaceRoot);
  if (manifest.taskId === 'R-RUN-02') assertCancellationEvidence(manifest, workspaceRoot);
  if (manifest.taskId === 'R-SEC-01') assertSecurityScrubEvidence(manifest, workspaceRoot);
  if (manifest.taskId === 'R-AUDIT-01') assertFailedRunAuditExport(manifest, workspaceRoot);
  if (manifest.taskId === 'R-FAIL-01') assertProviderOutageRecovery(manifest, workspaceRoot);
  if (manifest.taskId === 'R-CAP-01') assertCapabilityDiscoveryEvidence(manifest, workspaceRoot);
  if (manifest.taskId === 'R-SKILL-01') assertSkillPromotionEvidence(manifest, workspaceRoot);
  if (manifest.taskId === 'R-CU-01') assertComputerUseEvidenceFold(manifest, workspaceRoot);
}

function assertServiceLifecycleEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.serviceLifecycleEvidence;
  assert.ok(isRecord(evidence), 'R-RUN-01: serviceLifecycleEvidence is required');
  const ledgerRef = stringValue(evidence.ledgerRef);
  assert.ok(ledgerRef, 'R-RUN-01: serviceLifecycleEvidence.ledgerRef is required');
  const ledger = readEvidenceJson(workspaceRoot, ledgerRef);
  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(
    validation.ok,
    true,
    `R-RUN-01: service lifecycle ledger must validate: ${validation.errors.join('; ')}`,
  );
  assert.equal(
    evidence.actualPort,
    manifest.actualPort,
    'R-RUN-01: serviceLifecycleEvidence.actualPort must match the passed manifest actualPort',
  );
  assertEvidenceRefsExist([
    ledgerRef,
    ...stringList(evidence.cleanupEvidenceRefs),
    ...stringList(evidence.readinessCheckRefs),
    ...stringList(evidence.browserRefreshEvidenceRefs),
    ...stringList(evidence.passClaimRefs),
  ], workspaceRoot, 'R-RUN-01: service lifecycle evidence refs');
}

function assertCancellationEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.cancellationEvidence;
  assert.ok(isRecord(evidence), 'R-RUN-02: cancellationEvidence is required');
  const ledgerRef = stringValue(evidence.ledgerRef);
  const safeContinuationPlanRef = stringValue(evidence.safeContinuationPlanRef);
  assert.ok(ledgerRef, 'R-RUN-02: cancellationEvidence.ledgerRef is required');
  assert.ok(safeContinuationPlanRef, 'R-RUN-02: cancellationEvidence.safeContinuationPlanRef is required');

  const ledger = readEvidenceJson(workspaceRoot, ledgerRef);
  const validation = validateCancellationEvidenceLedger(ledger);
  assert.equal(
    validation.ok,
    true,
    `R-RUN-02: cancellation ledger must validate: ${validation.errors.join('; ')}`,
  );

  const continuationPlan = readEvidenceJson(workspaceRoot, safeContinuationPlanRef);
  assert.equal(
    continuationPlan.continuationScope,
    'safe-remainder-only',
    'R-RUN-02: safeContinuationPlanRef must point to a safe-remainder-only plan',
  );
  assert.notEqual(
    continuationPlan.reason,
    'boundaryless-resume-blocked',
    'R-RUN-02: safeContinuationPlanRef cannot be a blocked boundaryless resume plan',
  );
  assertEvidenceRefsExist([
    ledgerRef,
    safeContinuationPlanRef,
    ...stringList(evidence.partialArtifactRefs),
    ...stringList(evidence.unsafeRemainderRefs),
    ...stringList(evidence.irreversibleSideEffectRefs),
  ], workspaceRoot, 'R-RUN-02: cancellation evidence refs');
}

function assertSecurityScrubEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.securityScrubEvidence;
  assert.ok(isRecord(evidence), 'R-SEC-01: securityScrubEvidence is required');
  const rawAuditBundleManifestRef = stringValue(evidence.rawAuditBundleManifestRef);
  const diagnosisRef = stringValue(evidence.diagnosisRef);
  const correctedConfigRetryRef = stringValue(evidence.correctedConfigRetryRef);
  assert.ok(rawAuditBundleManifestRef, 'R-SEC-01: rawAuditBundleManifestRef is required');
  assert.ok(diagnosisRef, 'R-SEC-01: diagnosisRef is required');
  assert.ok(correctedConfigRetryRef, 'R-SEC-01: correctedConfigRetryRef is required');
  assert.ok(
    stringList(evidence.primaryReplyDomRefs).length > 0,
    'R-SEC-01: primaryReplyDomRefs must prove raw streams stayed out of the primary DOM',
  );
  assert.ok(
    stringList(evidence.forbiddenLeakCheckRefs).length > 0,
    'R-SEC-01: forbiddenLeakCheckRefs must record no-secret/no-raw-body checks',
  );
  assertRuntimeAuditBundleManifest(workspaceRoot, rawAuditBundleManifestRef, {
    taskId: 'R-SEC-01',
    status: 'failed',
  });
  assertEvidenceRefsExist([
    rawAuditBundleManifestRef,
    diagnosisRef,
    correctedConfigRetryRef,
    ...stringList(evidence.primaryReplyDomRefs),
    ...stringList(evidence.forbiddenLeakCheckRefs),
  ], workspaceRoot, 'R-SEC-01: security scrub evidence refs');
}

function assertFailedRunAuditExport(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.failedRunAuditExport;
  assert.ok(isRecord(evidence), 'R-AUDIT-01: failedRunAuditExport is required');
  const bundleManifestRef = stringValue(evidence.bundleManifestRef);
  assert.ok(bundleManifestRef, 'R-AUDIT-01: failedRunAuditExport.bundleManifestRef is required');
  const bundleManifest = assertRuntimeAuditBundleManifest(workspaceRoot, bundleManifestRef, {
    taskId: 'R-AUDIT-01',
    status: 'failed',
  });
  assert.equal(evidence.runId, bundleManifest.runId, 'R-AUDIT-01: failedRunAuditExport.runId must match bundle manifest');
  assert.equal(evidence.commandId, bundleManifest.commandId, 'R-AUDIT-01: failedRunAuditExport.commandId must match bundle manifest');
  assert.equal(evidence.provider, bundleManifest.provider, 'R-AUDIT-01: failedRunAuditExport.provider must match bundle manifest');
  assert.equal(evidence.model, bundleManifest.model, 'R-AUDIT-01: failedRunAuditExport.model must match bundle manifest');
  assert.equal(evidence.profile, bundleManifest.profile, 'R-AUDIT-01: failedRunAuditExport.profile must match bundle manifest');
  assertEvidenceRefsExist([
    bundleManifestRef,
    ...stringList(evidence.boundedScrubbedRefs),
  ], workspaceRoot, 'R-AUDIT-01: failed run audit export evidence refs');
}

function assertProviderOutageRecovery(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.providerOutageRecovery;
  assert.ok(isRecord(evidence), 'R-FAIL-01: providerOutageRecovery is required');
  assert.match(
    stringValue(evidence.failureClassification),
    /^(provider-auth|provider-gateway|external-network|rate-limited|timeout|dns)$/,
    'R-FAIL-01: providerOutageRecovery.failureClassification must identify provider/config/network class',
  );
  assert.match(
    stringValue(evidence.initialFailureStatus),
    /^(blocked|repair-needed)$/,
    'R-FAIL-01: initial failure must be blocked or repair-needed',
  );
  assert.ok(stringValue(evidence.initialFailureRunId), 'R-FAIL-01: initialFailureRunId is required');
  assert.ok(stringValue(evidence.recoveryRunId), 'R-FAIL-01: recoveryRunId is required');
  assert.notEqual(evidence.initialFailureRunId, evidence.recoveryRunId, 'R-FAIL-01: recovery must use a distinct run id');
  assert.equal(
    evidence.reusedFailedOutputAsSuccessEvidence,
    false,
    'R-FAIL-01: reusedFailedOutputAsSuccessEvidence must be false',
  );
  assertEvidenceRefsExist([
    stringValue(evidence.initialFailureRef),
    stringValue(evidence.recoveryEvidenceRef),
    stringValue(evidence.freshDispatchEvidenceRef),
  ], workspaceRoot, 'R-FAIL-01: provider outage recovery evidence refs');
}

function assertCapabilityDiscoveryEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.capabilityDiscoveryEvidence;
  assert.ok(isRecord(evidence), 'R-CAP-01: capabilityDiscoveryEvidence is required');
  const rounds = Array.isArray(evidence.rounds) ? evidence.rounds : [];
  assert.deepEqual(rounds.map((round) => round.round), [1, 2, 3], 'R-CAP-01: capability discovery must cover three progressive turns');
  assert.equal(evidence.routeChanged, true, 'R-CAP-01: routeChanged must be true after the third turn');
  assert.ok(stringValue(evidence.finalRouteChangeRef), 'R-CAP-01: finalRouteChangeRef is required');
  assert.ok(stringValue(evidence.finalAnswerRef), 'R-CAP-01: finalAnswerRef is required');
  assertEvidenceRefsExist(stringList(evidence.evidenceRefs), workspaceRoot, 'R-CAP-01: capability discovery evidence refs');

  const routes = rounds.map((round) => stringValue(round.chosenRoute));
  assert.notEqual(routes[0], routes[2], 'R-CAP-01: third turn must use a different capability route');
  for (const round of rounds) {
    assert.match(stringValue(round.tuiPlanningRef), /^tui-plan:\/\/r-cap-01\//, 'R-CAP-01: discovery must be TUI-native planning');
    assert.ok(stringList(round.alternatives).length > 0, 'R-CAP-01: each round must include alternatives');
    assert.equal(round.discoveryPlanIsCompletionEvidence, false, 'R-CAP-01: discovery plan is not completion evidence');
    assert.equal(round.guiRankingAbsent, true, 'R-CAP-01: guiRankingAbsent must be true');
    assert.equal(round.completionEvidenceRefAbsent, true, 'R-CAP-01: completionEvidenceRefAbsent must be true');
  }
}

function assertSkillPromotionEvidence(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.skillPromotionEvidence;
  assert.ok(isRecord(evidence), 'R-SKILL-01: skillPromotionEvidence is required');
  assert.match(stringValue(evidence.artifactRef), /^artifact:/, 'R-SKILL-01: proposal must be a durable artifact ref');
  assert.match(stringValue(evidence.workspaceProposalRef), /^file:/, 'R-SKILL-01: workspace proposal must be staging evidence');
  assert.equal(evidence.stagingOnly, true, 'R-SKILL-01: workspace proposal must be staging-only evidence');
  assertEvidenceRefsExist(stringList(evidence.evidenceRefs), workspaceRoot, 'R-SKILL-01: promotion evidence refs');

  const targets = Array.isArray(evidence.targets) ? evidence.targets : [];
  assert.deepEqual(
    targets.map((target) => stringValue(target.targetType)).sort(),
    ['mcp', 'plugin', 'skill', 'slash-command'],
    'R-SKILL-01: promotion must cover Codex-native skill/plugin/MCP/slash-command targets',
  );
  for (const target of targets) {
    assert.ok(stringList(target.scope).length > 0, 'R-SKILL-01: each promotion target needs scope');
    assert.ok(stringList(target.safetyGates).length > 0, 'R-SKILL-01: each promotion target needs safety gates');
    assert.ok(stringList(target.validationCommands).length > 0, 'R-SKILL-01: each promotion target needs validation commands');
    assert.ok(stringValue(target.installCallLocation), 'R-SKILL-01: each promotion target needs install/call location');
    assert.doesNotMatch(
      stringValue(target.installCallLocation),
      /React|browser button|renderer/i,
      'R-SKILL-01: install/call location must not be React/UI-owned',
    );
  }
}

function assertComputerUseEvidenceFold(manifest: RealTaskEvidenceManifest, workspaceRoot: string): void {
  const evidence = manifest.computerUseEvidenceFold;
  assert.ok(isRecord(evidence), 'R-CU-01: computerUseEvidenceFold is required');
  const foldedEvidenceRef = stringValue(evidence.foldedEvidenceRef);
  assert.match(foldedEvidenceRef, /^audit:\/\/r-cu-01\/folded\//, 'R-CU-01: foldedEvidenceRef must be an audit ref');
  assert.equal(evidence.uiExecutedComputerUseActions, false, 'R-CU-01: React/UI must not execute Computer Use actions');
  assertEvidenceRefsExist(stringList(evidence.evidenceRefs), workspaceRoot, 'R-CU-01: Computer Use fold evidence refs');

  const rawRefs = Array.isArray(evidence.rawRefs) ? evidence.rawRefs : [];
  assert.ok(rawRefs.some((ref) => ref.kind === 'screenshot'), 'R-CU-01: raw screenshot ref is required');
  assert.ok(rawRefs.some((ref) => ref.kind === 'desktop-log'), 'R-CU-01: raw desktop-log ref is required');
  const visibleRefs = new Set([
    ...stringList(evidence.visibleArtifactRefs),
    ...stringList(evidence.primaryArtifactRefs),
    ...stringList(evidence.supportingArtifactRefs),
  ]);
  for (const rawRef of rawRefs) {
    const ref = stringValue(rawRef.ref);
    assert.match(ref, /^audit-raw:\/\/r-cu-01\//, 'R-CU-01: raw CU refs must remain audit-raw refs');
    assert.equal(rawRef.auditOnly, true, 'R-CU-01: raw CU refs must be audit-only');
    assert.equal(rawRef.foldedIntoRef, foldedEvidenceRef, 'R-CU-01: raw CU refs must fold into foldedEvidenceRef');
    assert.equal(visibleRefs.has(ref), false, 'R-CU-01: raw Computer Use ref must not be visible artifact delivery');
  }
}

function assertRuntimeAuditBundleManifest(
  workspaceRoot: string,
  manifestRef: string,
  options: { taskId: string; status?: string },
): Record<string, unknown> {
  const manifest = readEvidenceJson(workspaceRoot, manifestRef);
  assert.equal(
    manifest.schemaVersion,
    'sciforge.runtime-codex.audit-bundle.v1',
    `${options.taskId}: audit bundle schemaVersion`,
  );
  if (options.status) assert.equal(manifest.status, options.status, `${options.taskId}: audit bundle status`);
  assert.ok(stringValue(manifest.runId), `${options.taskId}: audit bundle runId is required`);
  assert.ok(stringValue(manifest.commandId), `${options.taskId}: audit bundle commandId is required`);
  assert.ok(stringValue(manifest.provider), `${options.taskId}: audit bundle provider is required`);
  assert.ok(stringValue(manifest.model), `${options.taskId}: audit bundle model is required`);
  assert.ok(stringValue(manifest.profile), `${options.taskId}: audit bundle profile is required`);

  const files = isRecord(manifest.files) ? manifest.files : {};
  for (const key of ['rawJsonl', 'stderr', 'normalizedEvents'] as const) {
    const file = files[key];
    assert.ok(isRecord(file), `${options.taskId}: audit bundle files.${key} is required`);
    const path = stringValue(file.path);
    assert.ok(path, `${options.taskId}: audit bundle files.${key}.path is required`);
    assert.ok(typeof file.bytes === 'number', `${options.taskId}: audit bundle files.${key}.bytes is required`);
    assert.ok(typeof file.maxBytes === 'number', `${options.taskId}: audit bundle files.${key}.maxBytes is required`);
    assert.ok(
      Number(file.bytes) <= Number(file.maxBytes),
      `${options.taskId}: bounded audit file ${path} must not exceed maxBytes`,
    );
    assert.match(stringValue(file.rawSha256), /^sha256:/, `${options.taskId}: audit bundle files.${key}.rawSha256 is required`);
    assert.ok(
      existsSync(resolveWorkspacePath(workspaceRoot, path)),
      `${options.taskId}: audit bundle file must exist: ${path}`,
    );
  }
  return manifest;
}

function passedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'screenshot-round-3.png'), 'png');
  writeFileSync(join(workspaceRoot, 'evidence-dom.txt'), 'visible DOM mentions codex-command-live-1 and selected artifact ref artifact:report\n');
  writeFileSync(join(workspaceRoot, 'report.md'), '# Evidence report\n');
  return {
    taskId: 'R-DATA-01',
    status: 'passed',
    releaseEligible: true,
    releaseBlocking: false,
    source: {
      entrypoint: 'codex-in-app-browser-default-chat',
      evidenceMode: 'live-runtime-codex',
      devServices: 'live-browser',
      harnessMode: 'manual-default-chat',
      runtimeSource: 'runtime-codex',
    },
    entrypointExpectations: {
      entrypoint: 'codex-in-app-browser-default-chat',
      startedFromDefaultChatEntry: true,
      requiresRuntimeCodex: true,
      requiresLiveBrowserAcceptance: true,
      requiresProductionDesktopAcceptance: false,
      requiresVisibleGuiPresentAnswer: true,
      allowsScriptableMockAsPass: false,
      allowsSeedDemoFixtureAsPass: false,
    },
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    profile: 'sciforge-runtime-deepseek',
    workspacePath: workspaceRoot,
    actualUrl: 'http://127.0.0.1:5173/',
    actualPort: 5173,
    commandId: 'codex-command-live-1',
    evidenceRefs: ['evidence-dom.txt', 'screenshot-round-3.png'],
    selectedRefEvidence: {
      artifactRef: 'artifact:report',
      evidenceRefs: ['evidence-dom.txt'],
    },
    turns: [
      { turnId: 'turn-1', prompt: 'Load the dataset and inspect columns.' },
      { turnId: 'turn-2', prompt: 'Run the analysis and preserve lineage refs.' },
      {
        turnId: 'turn-3',
        prompt: 'Explain the result from the visible UI.',
        visibleAnswer: 'The third visible answer is present in the default chat UI.',
        screenshotRefs: ['screenshot-round-3.png'],
        auditRefs: ['runtime-codex:command:cmd-1:attempt:1'],
      },
    ],
    visibleAnswer: {
      text: 'The third visible answer is present in the default chat UI.',
    },
    screenshotRefs: ['screenshot-round-3.png'],
    auditRefs: ['runtime-codex:command:cmd-1:attempt:1'],
    artifactPaths: ['report.md'],
  };
}

function desktopPassedManifest(
  workspaceRoot: string,
  taskId: 'R-DESK-01' | 'R-PKG-01',
  desktopLiveAcceptanceEvidenceRef = writeDesktopLiveAcceptanceEvidence(workspaceRoot),
): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  return {
    ...manifest,
    taskId,
    source: {
      ...manifest.source,
      entrypoint: 'production-desktop-cold-start',
      devServices: 'production-electron',
      harnessMode: 'packaged-app-cold-start',
    },
    actualUrl: 'http://127.0.0.1:62010/',
    actualPort: 62010,
    desktopLiveAcceptanceEvidenceRef,
    evidenceRefs: [...stringList(manifest.evidenceRefs), desktopLiveAcceptanceEvidenceRef],
    entrypointExpectations: {
      entrypoint: 'production-desktop-cold-start',
      startedFromDefaultChatEntry: false,
      requiresRuntimeCodex: true,
      requiresLiveBrowserAcceptance: false,
      requiresProductionDesktopAcceptance: true,
      requiresVisibleGuiPresentAnswer: true,
      allowsScriptableMockAsPass: false,
      allowsSeedDemoFixtureAsPass: false,
    },
  };
}

function writeDesktopLiveAcceptanceEvidence(
  workspaceRoot: string,
  fileName = 'desktop-live-acceptance.json',
  overrides: {
    runtimeTask?: Partial<DesktopLiveAcceptanceEvidence['runtimeTask']>;
    artifactFollowup?: Partial<DesktopLiveAcceptanceEvidence['artifactFollowup']>;
    shutdown?: Partial<DesktopLiveAcceptanceEvidence['shutdown']>;
  } = {},
): string {
  const appDataPath = join(workspaceRoot, 'app-data');
  const logsPath = join(appDataPath, 'logs');
  const runtimeCommandId = 'codex-command-desktop-live-001';
  const followupCommandId = 'codex-command-desktop-followup-001';
  const evidence: DesktopLiveAcceptanceEvidence = {
    schemaVersion: 'sciforge.desktop.live-acceptance-evidence.v1',
    launch: {
      mode: 'packaged-app',
      electronEntrypointPresent: true,
      electronDependencyPresent: true,
      coldStart: true,
      packagedArtifactPath: '/Applications/SciForge.app',
      productionMode: true,
      productionArtifactInspection: {
        schemaVersion: 'sciforge.desktop.production-artifact-inspection.v1',
        artifactPath: '/Applications/SciForge.app',
        inspectable: true,
        credentialsRequired: false,
        mainProcessInspected: true,
        preloadInspected: true,
        rendererArtifactInspected: true,
        viteDevServerUrlFound: false,
        canClaimRDeskOrRPkgPass: false,
      },
    },
    renderer: {
      loadedFrom: 'dist-ui/index.html',
      filePath: '/Applications/SciForge.app/Contents/Resources/app/dist-ui/index.html',
      buildArtifactExists: true,
    },
    runtimeTask: {
      runtime: 'Runtime Codex',
      taskKind: 'real-user-task',
      profile: 'sciforge-runtime-deepseek',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      workspacePath: join(workspaceRoot, 'workspace'),
      commandId: runtimeCommandId,
      providerProxyUsed: true,
      providerAuditVisible: true,
      answerVisibleInRenderer: true,
      rawPreflightOnly: false,
      taskId: 'desktop-live-task-001',
      auditRefs: [
        join(logsPath, 'runtime-codex', runtimeCommandId, 'manifest.json'),
      ],
      ...overrides.runtimeTask,
    },
    artifactFollowup: {
      selectedArtifactRef: 'artifact:research-report',
      commandId: followupCommandId,
      artifactOpenedInRenderer: true,
      followupSubmittedAgainstSelectedArtifact: true,
      followupAnswerVisibleInRenderer: true,
      didNotStartNewSearch: true,
      evidenceRefs: [
        join(logsPath, 'runtime-codex', followupCommandId, 'selected-followup.json'),
      ],
      ...overrides.artifactFollowup,
    },
    sidecars: [
      {
        role: 'workspace-server',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'workspace-server.log'),
      },
      {
        role: 'provider-proxy',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'provider-proxy.log'),
      },
      {
        role: 'runtime-codex',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'runtime-codex.log'),
      },
    ],
    ports: [
      { name: 'workspace-server', host: '127.0.0.1', actualPort: 62010, allocation: 'dynamic' },
      { name: 'provider-proxy', host: '127.0.0.1', actualPort: 62011, allocation: 'dynamic' },
      { name: 'runtime-codex', host: '127.0.0.1', actualPort: 62012, allocation: 'dynamic' },
    ],
    paths: {
      appDataPath,
      logsPath,
      sidecarLogsPath: join(logsPath, 'sidecars'),
      auditLogPath: join(logsPath, 'desktop-runtime-audit.ndjson'),
    },
    shutdown: {
      requestedFrom: 'app-quit',
      clean: true,
      rendererClosed: true,
      sidecarsStopped: true,
      portsReleased: true,
      auditLogClosed: true,
      evidenceRefs: [
        join(logsPath, 'desktop-runtime-audit.ndjson'),
      ],
      ...overrides.shutdown,
    },
  };
  materializeDesktopLiveAcceptanceEvidence(evidence);
  writeFileSync(join(workspaceRoot, fileName), JSON.stringify(evidence, null, 2));
  return fileName;
}

function materializeDesktopLiveAcceptanceEvidence(evidence: DesktopLiveAcceptanceEvidence): void {
  mkdirSync(evidence.runtimeTask.workspacePath, { recursive: true });
  mkdirSync(evidence.paths.appDataPath, { recursive: true });
  mkdirSync(evidence.paths.logsPath, { recursive: true });
  mkdirSync(evidence.paths.sidecarLogsPath, { recursive: true });

  writeMaterializedFile(evidence.paths.auditLogPath, '{"event":"desktop-live-acceptance"}\n');
  for (const sidecar of evidence.sidecars) {
    writeMaterializedFile(sidecar.logPath, `${sidecar.role} health=pass\n`);
  }
  for (const ref of evidence.runtimeTask.auditRefs) {
    if (ref === join(evidence.paths.logsPath, 'runtime-codex', evidence.runtimeTask.commandId, 'manifest.json')) {
      writeMaterializedJsonFile(ref, {
        commandId: evidence.runtimeTask.commandId,
        provider: evidence.runtimeTask.provider,
        model: evidence.runtimeTask.model,
      });
    } else {
      writeMaterializedFile(ref, '{"event":"runtime-audit"}\n');
    }
  }
  for (const ref of evidence.artifactFollowup.evidenceRefs) {
    writeMaterializedJsonFile(ref, {
      commandId: evidence.artifactFollowup.commandId,
      selectedArtifactRef: evidence.artifactFollowup.selectedArtifactRef,
    });
  }
  for (const ref of evidence.shutdown.evidenceRefs) {
    writeMaterializedFile(ref, '{"event":"shutdown"}\n');
  }
}

function writeMaterializedJsonFile(path: string, value: Record<string, unknown>): void {
  writeMaterializedFile(path, JSON.stringify(value, null, 2));
}

function writeMaterializedFile(path: string, value: string): void {
  if (!isAbsolute(path) || path.split('/').includes('..')) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function lit03PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'selected-scope-audit.json'), JSON.stringify({
    oldFollowup: {
      selectedRefs: ['artifact:r-lit-03-old-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-new-report'],
    },
    switchFollowup: {
      selectedRefs: ['artifact:r-lit-03-new-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-old-report'],
    },
    latestArtifactUsed: false,
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'evidence-matrix.json'), JSON.stringify([
    { reportRef: 'artifact:r-lit-03-old-report', latestArtifactUsed: false },
    { reportRef: 'artifact:r-lit-03-new-report', latestArtifactUsed: false },
  ], null, 2));
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-LIT-03',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-lit-03-old-report',
      selectedRefs: ['artifact:r-lit-03-old-report', 'artifact:r-lit-03-new-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-new-report', 'artifact:r-lit-03-old-report'],
      followupRunIds: ['run-r-lit-03-selected-old-followup', 'run-r-lit-03-switch-selection-followup'],
      latestArtifactUsed: false,
      evidenceRefs: ['evidence-dom.txt', 'selected-scope-audit.json', 'evidence-matrix.json'],
    },
    artifactPaths: ['report.md', 'evidence-matrix.json'],
  };
}

function resume01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'derived-report.md'), '# Derived resume risk matrix\n');
  writeFileSync(join(workspaceRoot, 'resume-metadata.json'), JSON.stringify({
    status: 'resumed',
    codexSessionId: 'codex-session-r-resume-01-native',
    selectedRefs: ['artifact:r-resume-01-source-report'],
    derivedArtifactRef: 'artifact:r-resume-01-derived-report',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'command-text.txt'), [
    'Using the selected artifact only, derive the risk matrix and include native resume metadata.',
    '',
    'Selected refs:',
    '- artifact:r-resume-01-source-report',
  ].join('\n'));
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-RESUME-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-resume-01-source-report',
      selectedRefs: ['artifact:r-resume-01-source-report'],
      derivedArtifactRef: 'artifact:r-resume-01-derived-report',
      resumeMetadataRef: 'resume-metadata.json',
      evidenceRefs: ['evidence-dom.txt', 'resume-metadata.json', 'command-text.txt'],
      commandTextPolicy: {
        newUserRequestOnly: true,
        selectedRefsOnly: true,
        replaysGuiTranscript: false,
        includesFullArtifactBody: false,
        evidenceRefs: ['command-text.txt'],
      },
    },
    nativeContinuity: {
      codexSessionId: 'codex-session-r-resume-01-native',
      attemptId: 'codex-command-r-resume-01-attempt-1',
      resumeCommand: 'codex exec resume --json codex-session-r-resume-01-native ask "Using the selected artifact only, derive the risk matrix for artifact:r-resume-01-source-report"',
      evidenceRefs: ['resume-metadata.json'],
    },
    artifactPaths: ['report.md', 'derived-report.md'],
  };
}

function resume02PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-RESUME-02',
    restoredGuiStateSource: 'conversation-projection-after-browser-refresh',
    nativeContinuity: {
      codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
      attemptId: 'codex-command-refresh-attempt-2',
      resumeCommand: 'codex exec resume --json 019e3e82-164d-79b2-a5d4-b16241620b10 ask "continue from restored GUI state summary"',
      evidenceRefs: [
        'audit:codex-runtime:codex-command-refresh:codex-command-refresh-attempt-2:normalized-events',
      ],
    },
    noArtifactReason: 'R-RESUME-02 verifies refresh recovery and native continuity evidence rather than producing a new artifact.',
  };
}

function run01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  const actualPort = 6176;
  writeServiceLifecycleEvidence(workspaceRoot, actualPort);
  return {
    ...manifest,
    taskId: 'R-RUN-01',
    actualUrl: `http://127.0.0.1:${actualPort}/`,
    actualPort,
    noArtifactReason: 'R-RUN-01 verifies service lifecycle recovery and does not need a user artifact.',
    artifactPaths: [],
    selectedRefEvidence: {
      exemptionReason: 'Service lifecycle recovery has no selectable artifact; browser refresh evidence is exported instead.',
      evidenceRefs: ['browser-refresh-evidence.txt'],
    },
    serviceLifecycleEvidence: {
      ledgerRef: 'service-lifecycle-evidence.json',
      actualPort,
      cleanupEvidenceRefs: ['stale-cleanup.txt'],
      readinessCheckRefs: ['readiness-check.txt'],
      browserRefreshEvidenceRefs: ['browser-refresh-evidence.txt'],
      passClaimRefs: ['service-pass-claim.txt'],
    },
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'service-lifecycle-evidence.json',
      'readiness-check.txt',
      'browser-refresh-evidence.txt',
    ],
  };
}

function run02PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeCancellationEvidence(workspaceRoot);
  return {
    ...manifest,
    taskId: 'R-RUN-02',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-run-02-partial-notebook',
      selectedRefs: ['artifact:r-run-02-partial-notebook'],
      evidenceRefs: ['partial-artifact-ref.txt', 'safe-continuation-plan.json'],
    },
    cancellationEvidence: {
      ledgerRef: 'cancellation-evidence.json',
      safeContinuationPlanRef: 'safe-continuation-plan.json',
      partialArtifactRefs: ['partial-artifact-ref.txt'],
      unsafeRemainderRefs: ['unsafe-remainder.json'],
      irreversibleSideEffectRefs: ['irreversible-side-effects.json'],
    },
    artifactPaths: ['report.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'cancellation-evidence.json',
      'safe-continuation-plan.json',
    ],
  };
}

function sec01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeRuntimeAuditBundle(workspaceRoot, { manifestRef: 'security-audit-bundle/manifest.json', status: 'failed' });
  writeFileSync(join(workspaceRoot, 'diagnosis.md'), 'Provider failure diagnosis uses scrubbed digests and no raw provider body.\n');
  writeFileSync(join(workspaceRoot, 'corrected-config-retry.json'), JSON.stringify({
    retryCommandId: 'codex-command-r-sec-01-retry',
    correctedConfigApplied: true,
    rawSecretIncluded: false,
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'primary-reply-dom.txt'), 'Visible diagnosis: provider configuration failed; audit refs are scrubbed.\n');
  writeFileSync(join(workspaceRoot, 'forbidden-leak-check.json'), JSON.stringify({
    apiKeysInDom: 0,
    rawProviderBodiesInDom: 0,
    pluginChallengeHtmlInDom: 0,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-SEC-01',
    securityScrubEvidence: {
      rawAuditBundleManifestRef: 'security-audit-bundle/manifest.json',
      diagnosisRef: 'diagnosis.md',
      correctedConfigRetryRef: 'corrected-config-retry.json',
      primaryReplyDomRefs: ['primary-reply-dom.txt'],
      forbiddenLeakCheckRefs: ['forbidden-leak-check.json'],
    },
    artifactPaths: ['diagnosis.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'security-audit-bundle/manifest.json',
      'primary-reply-dom.txt',
      'forbidden-leak-check.json',
    ],
  };
}

function audit01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  const auditBundle = writeRuntimeAuditBundle(workspaceRoot, { manifestRef: 'failed-run-audit-bundle/manifest.json', status: 'failed' });
  return {
    ...manifest,
    taskId: 'R-AUDIT-01',
    failedRunAuditExport: {
      bundleManifestRef: 'failed-run-audit-bundle/manifest.json',
      runId: auditBundle.runId,
      commandId: auditBundle.commandId,
      provider: auditBundle.provider,
      model: auditBundle.model,
      profile: auditBundle.profile,
      boundedScrubbedRefs: [
        'failed-run-audit-bundle/raw-jsonl.scrubbed.jsonl',
        'failed-run-audit-bundle/stderr.scrubbed.log',
        'failed-run-audit-bundle/normalized-events.jsonl',
      ],
    },
    artifactPaths: ['report.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'failed-run-audit-bundle/manifest.json',
    ],
  };
}

function fail01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'initial-provider-failure.json'), JSON.stringify({
    runId: 'run-r-fail-01-provider-502',
    status: 'repair-needed',
    classification: 'provider-gateway',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'provider-recovery.json'), JSON.stringify({
    runId: 'run-r-fail-01-recovered',
    status: 'completed',
    source: 'fresh-dispatch-after-provider-recovery',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'fresh-dispatch-evidence.json'), JSON.stringify({
    freshDispatch: true,
    reusedFailedOutputAsSuccessEvidence: false,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-FAIL-01',
    providerOutageRecovery: {
      failureClassification: 'provider-gateway',
      initialFailureStatus: 'repair-needed',
      initialFailureRunId: 'run-r-fail-01-provider-502',
      recoveryRunId: 'run-r-fail-01-recovered',
      initialFailureRef: 'initial-provider-failure.json',
      recoveryEvidenceRef: 'provider-recovery.json',
      freshDispatchEvidenceRef: 'fresh-dispatch-evidence.json',
      reusedFailedOutputAsSuccessEvidence: false,
    },
    artifactPaths: ['provider-recovery.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'initial-provider-failure.json',
      'provider-recovery.json',
      'fresh-dispatch-evidence.json',
    ],
  };
}

function cap01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'capability-discovery-plan.json'), JSON.stringify({
    rounds: ['workspace-ref-reader', 'workspace-ref-reader', 'web-research-provider'],
    completionEvidence: 'not-evidence',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'route-change-evidence.json'), JSON.stringify({
    from: 'workspace-ref-reader',
    to: 'web-research-provider',
    changedAtTurn: 3,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-CAP-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-cap-01-final-answer',
      selectedRefs: ['artifact:r-cap-01-final-answer'],
      evidenceRefs: ['capability-discovery-plan.json', 'route-change-evidence.json'],
    },
    capabilityDiscoveryEvidence: {
      rounds: [
        capabilityRound(1, 'workspace-ref-reader', ['web-research-provider', 'desktop-perception-bridge']),
        capabilityRound(2, 'workspace-ref-reader', ['web-research-provider', 'desktop-perception-bridge']),
        capabilityRound(3, 'web-research-provider', ['workspace-ref-reader', 'desktop-perception-bridge']),
      ],
      routeChanged: true,
      finalRouteChangeRef: 'route-change-evidence.json',
      finalAnswerRef: 'artifact:r-cap-01-final-answer',
      evidenceRefs: ['capability-discovery-plan.json', 'route-change-evidence.json'],
    },
    artifactPaths: ['report.md', 'capability-discovery-plan.json', 'route-change-evidence.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'capability-discovery-plan.json',
      'route-change-evidence.json',
    ],
  };
}

function skill01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'skill-promotion-proposal.md'), '# Skill promotion proposal\n');
  writeFileSync(join(workspaceRoot, 'promotion-targets.json'), JSON.stringify({
    targets: ['skill', 'plugin', 'mcp', 'slash-command'],
    stagingOnly: true,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-SKILL-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-skill-01-codex-native-promotion-proposal',
      selectedRefs: ['artifact:r-skill-01-codex-native-promotion-proposal'],
      evidenceRefs: ['skill-promotion-proposal.md', 'promotion-targets.json'],
    },
    skillPromotionEvidence: {
      artifactRef: 'artifact:r-skill-01-codex-native-promotion-proposal',
      workspaceProposalRef: 'file:.sciforge/task-results/r-skill-01-promotion-proposal.md',
      stagingOnly: true,
      targets: [
        promotionTarget('skill', 'CODEX_HOME/skills/capability-route-planner/SKILL.md'),
        promotionTarget('plugin', '.agents/plugins/capability-boundary/.codex-plugin/plugin.json'),
        promotionTarget('mcp', 'Codex MCP config mcpServers.capability-boundary'),
        promotionTarget('slash-command', 'Codex slash-command registry /capability-route'),
      ],
      evidenceRefs: ['skill-promotion-proposal.md', 'promotion-targets.json'],
    },
    artifactPaths: ['report.md', 'skill-promotion-proposal.md', 'promotion-targets.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'skill-promotion-proposal.md',
      'promotion-targets.json',
    ],
  };
}

function cu01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'computer-use-folding-proof.json'), JSON.stringify({
    foldedEvidenceRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
    rawRefsVisible: false,
    uiExecutedComputerUseActions: false,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-CU-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-cu-01-folded-audit-summary',
      selectedRefs: ['artifact:r-cu-01-folded-audit-summary'],
      evidenceRefs: ['computer-use-folding-proof.json'],
    },
    computerUseEvidenceFold: {
      foldedEvidenceRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
      rawRefs: [
        {
          kind: 'screenshot',
          ref: 'audit-raw://r-cu-01/screenshot/initial-visible-state.png',
          auditOnly: true,
          foldedIntoRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
        },
        {
          kind: 'desktop-log',
          ref: 'audit-raw://r-cu-01/desktop-log/bridge-actions.jsonl',
          auditOnly: true,
          foldedIntoRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
        },
      ],
      uiExecutedComputerUseActions: false,
      visibleArtifactRefs: ['artifact:r-cu-01-folded-audit-summary'],
      primaryArtifactRefs: ['artifact:r-cu-01-folded-audit-summary'],
      supportingArtifactRefs: [],
      evidenceRefs: ['computer-use-folding-proof.json'],
    },
    artifactPaths: ['report.md', 'computer-use-folding-proof.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'computer-use-folding-proof.json',
    ],
  };
}

function capabilityRound(
  round: 1 | 2 | 3,
  chosenRoute: string,
  alternatives: string[],
): NonNullable<NonNullable<RealTaskEvidenceManifest['capabilityDiscoveryEvidence']>['rounds']>[number] {
  return {
    round,
    tuiPlanningRef: `tui-plan://r-cap-01/round-${round}`,
    chosenRoute,
    alternatives,
    discoveryPlanIsCompletionEvidence: false,
    guiRankingAbsent: true,
    completionEvidenceRefAbsent: true,
  };
}

function promotionTarget(
  targetType: 'skill' | 'plugin' | 'mcp' | 'slash-command',
  installCallLocation: string,
): NonNullable<NonNullable<RealTaskEvidenceManifest['skillPromotionEvidence']>['targets']>[number] {
  return {
    targetType,
    scope: ['Capture reusable capability routing decisions without task output payloads.'],
    safetyGates: ['Fail closed when required capability evidence is missing.'],
    validationCommands: ['npm run smoke:real-task-capability-skill-cu-gates'],
    installCallLocation,
  };
}

function writeServiceLifecycleEvidence(workspaceRoot: string, actualPort: number): void {
  writeFileSync(join(workspaceRoot, 'stale-cleanup.txt'), 'port 5176 verified not running before fallback\n');
  writeFileSync(join(workspaceRoot, 'readiness-check.txt'), `GET http://127.0.0.1:${actualPort}/healthz -> 200\n`);
  writeFileSync(join(workspaceRoot, 'browser-refresh-evidence.txt'), `Codex in-app browser refreshed to http://127.0.0.1:${actualPort}/\n`);
  writeFileSync(join(workspaceRoot, 'service-pass-claim.txt'), `pass claimed on actual port ${actualPort}\n`);
  writeFileSync(join(workspaceRoot, 'service-lifecycle-evidence.json'), JSON.stringify({
    schemaVersion: SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION,
    runId: 'run-r-run-01-live',
    serviceName: 'sciforge-runtime-gateway',
    defaultPort: 5176,
    portBindings: [{
      role: 'runtime-gateway',
      defaultPort: 5176,
      actualPort,
      url: `http://127.0.0.1:${actualPort}/`,
      assignedBy: 'manual-recovery',
      conflictWithDefault: true,
      evidenceRefs: ['readiness-check.txt'],
    }],
    staleProcessCleanup: [{
      cleanupId: 'cleanup-r-run-01-verified-not-running',
      port: 5176,
      action: 'verified-not-running',
      verifiedAt: '2026-05-20T00:00:00.000Z',
      evidenceRefs: ['stale-cleanup.txt'],
    }],
    portConflictRecovery: [{
      recoveryId: 'recovery-r-run-01-fallback-port',
      requestedPort: 5176,
      actualPort,
      reason: 'default-port-occupied',
      detectedBy: 'port-preflight',
      staleCleanupIds: ['cleanup-r-run-01-verified-not-running'],
      evidenceRefs: ['readiness-check.txt'],
    }],
    codeChangeRestarts: [{
      restartId: 'restart-r-run-01-code-change',
      trigger: 'manual-after-change',
      changeRef: 'git-diff:runtime-gateway',
      previousUrl: 'http://127.0.0.1:5176/',
      restartedUrl: `http://127.0.0.1:${actualPort}/`,
      observedAt: '2026-05-20T00:00:00.000Z',
      evidenceRefs: ['readiness-check.txt'],
    }],
    browserRefreshes: [{
      refreshId: 'refresh-r-run-01-codex-browser',
      method: 'codex-in-app-browser',
      beforeUrl: 'http://127.0.0.1:5176/',
      afterUrl: `http://127.0.0.1:${actualPort}/`,
      refreshedAt: '2026-05-20T00:00:00.000Z',
      observedContent: 'ready',
      evidenceRefs: ['browser-refresh-evidence.txt'],
    }],
    readinessChecks: [{
      checkId: 'ready-r-run-01',
      url: `http://127.0.0.1:${actualPort}/`,
      port: actualPort,
      status: 'pass',
      checkedAt: '2026-05-20T00:00:00.000Z',
      responseStatus: 200,
      evidenceRefs: ['readiness-check.txt'],
    }],
    passClaims: [{
      claimId: 'pass-r-run-01',
      status: 'pass',
      claimedUrl: `http://127.0.0.1:${actualPort}/`,
      claimedPort: actualPort,
      assumesDefaultPort: false,
      evidenceRefs: ['service-pass-claim.txt'],
    }],
    auditRefs: ['audit:service-lifecycle-r-run-01'],
  }, null, 2));
}

function writeCancellationEvidence(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, 'partial-artifact-ref.txt'), 'artifact:r-run-02-partial-notebook\n');
  writeFileSync(join(workspaceRoot, 'unsafe-remainder.json'), JSON.stringify([
    { stepId: 'submit-external-job', reason: 'would create an irreversible side effect' },
  ], null, 2));
  writeFileSync(join(workspaceRoot, 'irreversible-side-effects.json'), JSON.stringify([
    { sideEffectId: 'external-submit-blocked', status: 'not-executed' },
  ], null, 2));
  writeFileSync(join(workspaceRoot, 'safe-continuation-plan.json'), JSON.stringify({
    ok: true,
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    continuationScope: 'safe-remainder-only',
    cancelledRunId: 'run-r-run-02-cancelled',
    attemptId: 'attempt-r-run-02-1',
    executableSteps: [
      { stepId: 'validate-partial-artifact', effect: 'read-only' },
      { stepId: 'write-final-summary', effect: 'reversible-write' },
    ],
    blockedSteps: [
      { stepId: 'submit-external-job', effect: 'irreversible-side-effect' },
    ],
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'cancellation-evidence.json'), JSON.stringify({
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    cancelledRunId: 'run-r-run-02-cancelled',
    attemptId: 'attempt-r-run-02-1',
    cancellation: {
      kind: 'user-cancelled',
      reason: 'User clicked cancel after partial artifact was written.',
      observedAt: '2026-05-20T00:00:00.000Z',
      requestedBy: 'user',
    },
    completedSteps: [{
      stepId: 'write-partial-notebook',
      summary: 'Partial notebook was written before cancellation.',
      artifactRefs: ['artifact:r-run-02-partial-notebook'],
      auditRefs: ['audit:cancellation-boundary'],
    }],
    partialArtifacts: [{
      ref: 'artifact:r-run-02-partial-notebook',
      status: 'partial',
      description: 'Notebook contains completed setup and incomplete final validation.',
      producerStepId: 'write-partial-notebook',
      auditRefs: ['audit:cancellation-boundary'],
    }],
    irreversibleSideEffects: [{
      sideEffectId: 'external-submit-blocked',
      stepId: 'submit-external-job',
      description: 'External submission would be irreversible and was not executed.',
      auditRefs: ['audit:cancellation-boundary'],
    }],
    unsafeRemainder: [{
      stepId: 'submit-external-job',
      action: 'Submit external job',
      reason: 'Irreversible side effect after cancellation boundary.',
      effect: 'irreversible-side-effect',
      blockedBySideEffectIds: ['external-submit-blocked'],
      auditRefs: ['audit:cancellation-boundary'],
    }],
    safeRemainder: [{
      stepId: 'validate-partial-artifact',
      action: 'Validate partial artifact without external writes',
      effect: 'read-only',
      requiredArtifactRefs: ['artifact:r-run-02-partial-notebook'],
      auditRefs: ['audit:safe-remainder'],
    }, {
      stepId: 'write-final-summary',
      action: 'Write final summary from validated partial artifact',
      effect: 'reversible-write',
      dependsOn: ['validate-partial-artifact'],
      auditRefs: ['audit:safe-remainder'],
    }],
    auditRefs: ['audit:cancellation-boundary'],
  }, null, 2));
}

function writeRuntimeAuditBundle(
  workspaceRoot: string,
  options: { manifestRef: string; status?: 'failed' | 'done'; bytes?: number; maxBytes?: number },
): Record<string, string> {
  const bundleDir = dirname(join(workspaceRoot, options.manifestRef));
  mkdirSync(bundleDir, { recursive: true });
  const bytes = options.bytes ?? 128;
  const maxBytes = options.maxBytes ?? 1024;
  const files = {
    rawJsonl: {
      path: join(dirname(options.manifestRef), 'raw-jsonl.scrubbed.jsonl'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:raw',
    },
    stderr: {
      path: join(dirname(options.manifestRef), 'stderr.scrubbed.log'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:stderr',
    },
    normalizedEvents: {
      path: join(dirname(options.manifestRef), 'normalized-events.jsonl'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:normalized',
    },
  };
  for (const file of Object.values(files)) {
    writeFileSync(join(workspaceRoot, file.path), '{"scrubbed":true}\n');
  }
  const manifest = {
    schemaVersion: 'sciforge.runtime-codex.audit-bundle.v1',
    status: options.status ?? 'failed',
    exitCode: options.status === 'done' ? 0 : 1,
    signal: null,
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    profile: 'sciforge-runtime-deepseek',
    workspace: workspaceRoot,
    runId: 'codex-command-audit-failed',
    commandId: 'codex-command-audit-failed',
    attemptId: 'attempt-audit-1',
    evidenceRefs: ['audit:runtime-codex:failed'],
    files,
  };
  writeFileSync(join(workspaceRoot, options.manifestRef), JSON.stringify(manifest, null, 2));
  return {
    runId: manifest.runId,
    commandId: manifest.commandId,
    provider: manifest.provider,
    model: manifest.model,
    profile: manifest.profile,
  };
}

function withEvidenceWorkspace(run: (workspaceRoot: string) => void): void {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-real-task-evidence-'));
  try {
    run(workspaceRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function stringList(value: unknown): string[] {
  assert.ok(Array.isArray(value), 'expected an array');
  assert.ok(value.every((item) => typeof item === 'string' && item.trim()), 'expected non-empty strings');
  return value as string[];
}

function optionalStringList(value: unknown): string[] {
  if (value === undefined) return [];
  return stringList(value);
}

function assertEvidenceRefsExist(refs: string[], workspaceRoot: string, label: string): void {
  assert.ok(refs.length > 0, `${label} must include at least one ref`);
  for (const ref of refs) {
    assert.ok(ref.trim(), `${label}: evidence ref cannot be blank`);
    if (/^[a-z]+:/i.test(ref) && !ref.startsWith('file:') && !ref.startsWith('workspace://')) continue;
    assert.ok(
      existsSync(resolveWorkspacePath(workspaceRoot, ref)),
      `${label}: evidence ref must exist: ${ref}`,
    );
  }
}

function readEvidenceJson(workspaceRoot: string, ref: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolveWorkspacePath(workspaceRoot, ref), 'utf8')) as Record<string, unknown>;
}

function visibleAnswerText(value: RealTaskEvidenceManifest['visibleAnswer']): string {
  if (typeof value === 'string') return value;
  return value?.text ?? '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  if (isAbsolute(value)) return value;
  if (value.startsWith('file:')) return value.slice('file:'.length);
  if (value.startsWith('workspace://')) return join(workspaceRoot, value.slice('workspace://'.length));
  if (value.startsWith('workspace/')) return join(workspaceRoot, value);
  return join(workspaceRoot, value);
}
