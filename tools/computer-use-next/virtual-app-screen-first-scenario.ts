import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  type VirtualAppScreenEvidenceClaim,
  type VirtualAppScreenReadinessRecord,
  type VirtualAppScreenUserAcceptanceInput,
  type VirtualAppScreenUserAcceptanceManifest,
} from '../virtual-app-screen-user-acceptance-manifest.js';

export const VIRTUAL_APP_SCREEN_FIRST_SCENARIO_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-first-scenario.v1' as const;

export const VIRTUAL_APP_SCREEN_FIRST_SCENARIO_TASK_ID = 'P0-CU-UA-FIRST-SCENARIO' as const;
export const VIRTUAL_APP_SCREEN_FIRST_SCENARIO_ID = 'virtual-app-screen-local-research-note' as const;

export type VirtualAppScreenFirstScenarioEvidenceMode =
  | 'fixture-diagnostic'
  | 'real-virtual-app-screen';

export interface VirtualAppScreenFirstScenarioOptions {
  runId?: string;
  runDirRef?: string;
  createdAt?: string;
  runStartedAt?: string;
  evidenceMode?: VirtualAppScreenFirstScenarioEvidenceMode;
  includeGuiPresent?: boolean;
  includeBeforeAfter?: boolean;
  includeScreenFrames?: boolean;
  shellDirectArtifactWrite?: boolean;
  oldArtifact?: boolean;
}

export interface VirtualAppScreenResearchNoteArtifact {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-research-note-artifact.v1';
  ref: string;
  path: string;
  kind: 'research-note';
  title: string;
  content: string;
  createdAt: string;
  createdBy: 'virtual-app-screen-action' | 'shell-direct-artifact';
  originRunId: string;
  sessionRef: string;
  sourceEvidenceRefs: string[];
  causalityRefs: string[];
  shellDirectArtifactWrite: boolean;
}

export interface VirtualAppScreenResearchNoteArtifactValidation {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-research-note-artifact-validation.v1';
  ref: string;
  artifactRef: string;
  ok: boolean;
  status: 'passed' | 'failed';
  issues: string[];
  checkedRefs: string[];
}

export interface VirtualAppScreenFirstScenarioBundle {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_FIRST_SCENARIO_SCHEMA_VERSION;
  taskId: typeof VIRTUAL_APP_SCREEN_FIRST_SCENARIO_TASK_ID;
  scenarioId: typeof VIRTUAL_APP_SCREEN_FIRST_SCENARIO_ID;
  userIntent: string;
  runId: string;
  runDirRef: string;
  createdAt: string;
  evidenceMode: VirtualAppScreenFirstScenarioEvidenceMode;
  fixtureBoundary: {
    diagnosticFixture: boolean;
    fixtureCanClaimUserAcceptance: false;
    userAcceptanceRequires: string[];
  };
  localSafety: {
    lowRisk: true;
    requiresExternalAccount: false;
    sendsExternalMessages: false;
    modifiesUserPhysicalDesktop: false;
    networkRequired: false;
  };
  refs: VirtualAppScreenFirstScenarioRefs;
  adapterReadiness: VirtualAppScreenReadinessRecord & { ref: string };
  screen: {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-first-scenario-screen.v1';
    data: Record<string, unknown>;
    userVisibleMinimum: Record<string, unknown>;
  };
  records: {
    source: Record<string, unknown>;
    frameStream: Record<string, unknown>;
    userCursor: Record<string, unknown>;
    agentCursor: Record<string, unknown>;
    beforeFrame?: Record<string, unknown>;
    afterFrame?: Record<string, unknown>;
    annotationOverlay: Record<string, unknown>;
    annotationProposal: Record<string, unknown>;
    inputIntent: Record<string, unknown>;
    executorEvent: Record<string, unknown>;
    beforeAfter?: Record<string, unknown>;
    guiPresent?: Record<string, unknown>;
    replay: Record<string, unknown>;
    evidenceLedger: Record<string, unknown>;
  };
  artifact: VirtualAppScreenResearchNoteArtifact;
  artifactValidation: VirtualAppScreenResearchNoteArtifactValidation;
  manifestInput: VirtualAppScreenUserAcceptanceInput;
  manifest: VirtualAppScreenUserAcceptanceManifest;
}

export interface VirtualAppScreenFirstScenarioRefs {
  targetAppRef: string;
  targetWindowRef: string;
  sessionRef: string;
  frameStreamRef: string;
  userCursorRef: string;
  agentCursorRef: string;
  sourceRef: string;
  beforeFrameRef: string;
  afterFrameRef: string;
  annotationOverlayRef: string;
  annotationProposalRef: string;
  inputIntentRef: string;
  executorEventRef: string;
  beforeAfterRef: string;
  actionAdapterRef: string;
  inputLeaseRef: string;
  adapterReadinessRef: string;
  artifactRef: string;
  artifactValidationRef: string;
  guiPresentRef: string;
  replayRef: string;
  evidenceLedgerRef: string;
}

const DEFAULT_RUN_ID = 'virtual-app-screen-first-scenario-fixture';
const DEFAULT_CREATED_AT = '2026-06-01T00:00:00.000Z';
const DEFAULT_SOURCE_EXCERPT =
  'Local fixture note: annotated source passages should be traceable to a visible app frame before they become a research-note artifact.';

export function buildVirtualAppScreenFirstScenarioBundle(
  options: VirtualAppScreenFirstScenarioOptions = {},
): VirtualAppScreenFirstScenarioBundle {
  const runId = normalizeRunId(options.runId ?? DEFAULT_RUN_ID);
  const runDirRef = options.runDirRef ?? `.sciforge/vision-runs/${runId}`;
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const runStartedAt = options.runStartedAt ?? createdAt;
  const evidenceMode = options.evidenceMode ?? 'fixture-diagnostic';
  const includeGuiPresent = options.includeGuiPresent !== false;
  const includeBeforeAfter = options.includeBeforeAfter !== false;
  const includeScreenFrames = options.includeScreenFrames !== false;
  const shellDirectArtifactWrite = options.shellDirectArtifactWrite === true;
  const artifactCreatedAt = options.oldArtifact
    ? '2026-05-31T23:59:00.000Z'
    : createdAt;
  const refs = buildRefs(runId, runDirRef);
  const userIntent =
    'Read a local research source in a background VirtualAppScreen, add a visible annotation, and generate research-note.md.';
  const adapterReadiness: VirtualAppScreenReadinessRecord & { ref: string } = {
    ref: refs.adapterReadinessRef,
    adapterKind: 'browser-runtime-window',
    targetScope: 'window',
    supportedActions: ['click', 'type', 'scroll', 'hotkey', 'annotate'],
    captureSupported: true,
    backgroundRenderable: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    blockedReason: null,
    schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
  };

  const source = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-first-scenario-source.v1',
    ref: refs.sourceRef,
    kind: 'local-research-source',
    title: 'Local VirtualAppScreen Source Fixture',
    excerpt: DEFAULT_SOURCE_EXCERPT,
    targetAppRef: refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    sessionRef: refs.sessionRef,
    requiresExternalAccount: false,
    networkRequired: false,
  };
  const frameStream = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-frame-stream.v1',
    ref: refs.frameStreamRef,
    sessionRef: refs.sessionRef,
    targetWindowRef: refs.targetWindowRef,
    currentFrameRef: refs.afterFrameRef,
    frameRefs: includeScreenFrames ? [refs.beforeFrameRef, refs.afterFrameRef] : [],
  };
  const userCursor = {
    schemaVersion: 'sciforge.computer-use.actor-cursor.v1',
    ref: refs.userCursorRef,
    actor: 'user',
    sessionRef: refs.sessionRef,
    visibleInScreen: true,
  };
  const agentCursor = {
    schemaVersion: 'sciforge.computer-use.actor-cursor.v1',
    ref: refs.agentCursorRef,
    actor: 'agent',
    sessionRef: refs.sessionRef,
    visibleInScreen: true,
  };
  const beforeFrame = includeScreenFrames
    ? frameRecord('before', refs.beforeFrameRef, refs, [])
    : undefined;
  const annotationOverlay = {
    schemaVersion: 'sciforge.computer-use.annotation-overlay.v1',
    ref: refs.annotationOverlayRef,
    kind: 'highlight',
    actor: 'agent',
    targetFrameRef: refs.afterFrameRef,
    targetRegionRef: `${refs.afterFrameRef}#local-source-sentence`,
    comment: 'Mark the source sentence used in the research note.',
  };
  const annotationProposal = {
    schemaVersion: 'sciforge.computer-use.annotation-proposal.v1',
    ref: refs.annotationProposalRef,
    overlayRef: refs.annotationOverlayRef,
    targetRef: `${refs.beforeFrameRef}#local-source-sentence`,
    proposedAction: 'highlight-source-sentence',
    risk: 'low',
    approvalPolicy: 'auto-allowed-low-risk-local-fixture',
    beforeFrameRef: refs.beforeFrameRef,
    expectedAfterFrameRef: refs.afterFrameRef,
  };
  const inputIntent = {
    schemaVersion: 'sciforge.computer-use.input-intent.v1',
    ref: refs.inputIntentRef,
    kind: 'click',
    source: 'virtual-app-screen-canvas',
    targetRef: `${refs.beforeFrameRef}#local-source-sentence`,
    inputLeaseRef: refs.inputLeaseRef,
    actionAdapterRef: refs.actionAdapterRef,
    terminalEquivalentText: false,
  };
  const executorEvent = {
    schemaVersion: 'sciforge.computer-use.executor-event.v1',
    ref: refs.executorEventRef,
    status: 'completed',
    inputIntentRef: refs.inputIntentRef,
    actionAdapterRef: refs.actionAdapterRef,
    beforeFrameRef: refs.beforeFrameRef,
    afterFrameRef: refs.afterFrameRef,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
  };
  const beforeAfter = includeBeforeAfter
    ? {
        schemaVersion: 'sciforge.computer-use.before-after-frame.v1',
        ref: refs.beforeAfterRef,
        beforeFrameRef: refs.beforeFrameRef,
        afterFrameRef: refs.afterFrameRef,
        changedRegionRefs: [`${refs.afterFrameRef}#annotation-highlight`],
        annotationOverlayRefs: [refs.annotationOverlayRef],
        executorEventRef: refs.executorEventRef,
      }
    : undefined;
  const afterFrame = includeScreenFrames
    ? frameRecord('after', refs.afterFrameRef, refs, [refs.annotationOverlayRef])
    : undefined;
  const artifact = researchNoteArtifact({
    ref: refs.artifactRef,
    runId,
    createdAt: artifactCreatedAt,
    sessionRef: refs.sessionRef,
    sourceEvidenceRefs: [refs.sourceRef, refs.beforeFrameRef, refs.afterFrameRef],
    causalityRefs: [
      refs.annotationProposalRef,
      refs.inputIntentRef,
      refs.executorEventRef,
      ...(beforeAfter ? [refs.beforeAfterRef] : []),
    ],
    shellDirectArtifactWrite,
  });
  const artifactValidation = validateVirtualAppScreenResearchNoteArtifact({
    artifact,
    validatorRef: refs.artifactValidationRef,
    runId,
    runStartedAt,
    requiredRefs: {
      sourceEvidenceRefs: [refs.sourceRef, refs.beforeFrameRef, refs.afterFrameRef],
      causalityRefs: [
        refs.annotationProposalRef,
        refs.inputIntentRef,
        refs.executorEventRef,
        refs.beforeAfterRef,
      ],
    },
  });
  const guiPresent = includeGuiPresent
    ? {
        schemaVersion: 'sciforge.gui.present.virtual-app-screen.v1',
        ref: refs.guiPresentRef,
        componentId: 'virtual-screen-viewer',
        displayedRefs: [
          refs.afterFrameRef,
          refs.annotationOverlayRef,
          refs.beforeAfterRef,
          refs.artifactRef,
          refs.replayRef,
        ],
        artifactRefs: [refs.artifactRef],
        verificationRefs: artifactValidation.ok ? [refs.artifactValidationRef] : [],
      }
    : undefined;
  const scenarioIssues = scenarioIssuesForManifest({
    evidenceMode,
    artifactValidation,
    includeGuiPresent,
    includeBeforeAfter,
    includeScreenFrames,
  });
  const replay = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-replay.v1',
    ref: refs.replayRef,
    sessionRef: refs.sessionRef,
    timelineRefs: [
      refs.beforeFrameRef,
      refs.annotationProposalRef,
      refs.inputIntentRef,
      refs.executorEventRef,
      ...(beforeAfter ? [refs.beforeAfterRef] : []),
      refs.afterFrameRef,
      refs.artifactRef,
      ...(guiPresent ? [refs.guiPresentRef] : []),
    ],
  };
  const evidenceLedger = {
    schemaVersion: 'sciforge.computer-use.evidence-ledger.v1',
    ref: refs.evidenceLedgerRef,
    evidenceMode,
    diagnosticOnly: evidenceMode === 'fixture-diagnostic',
    currentRunOnly: true,
    refs: uniqueRefs([
      refs.sourceRef,
      refs.adapterReadinessRef,
      refs.beforeFrameRef,
      refs.annotationOverlayRef,
      refs.annotationProposalRef,
      refs.inputIntentRef,
      refs.executorEventRef,
      beforeAfter?.ref,
      refs.afterFrameRef,
      refs.artifactRef,
      refs.artifactValidationRef,
      guiPresent?.ref,
      refs.replayRef,
    ]),
  };

  const screen = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-first-scenario-screen.v1' as const,
    data: {
      title: 'VirtualAppScreen Local Research Note',
      status: scenarioIssues.length ? 'blocked' : 'passed',
      attachState: evidenceMode === 'fixture-diagnostic'
        ? 'diagnostic-fixture'
        : scenarioIssues.length
          ? 'blocked'
          : 'attached',
      targetAppRef: refs.targetAppRef,
      targetWindowRef: refs.targetWindowRef,
      sessionRef: refs.sessionRef,
      frameStreamRef: refs.frameStreamRef,
      currentFrameRef: refs.afterFrameRef,
      beforeFrameRef: refs.beforeFrameRef,
      afterFrameRef: refs.afterFrameRef,
      beforeAfterFrameRefs: beforeAfter ? [refs.beforeAfterRef] : [],
      actorCursorRefs: [refs.userCursorRef, refs.agentCursorRef],
      annotationOverlayRefs: [refs.annotationOverlayRef],
      annotationProposalRefs: [refs.annotationProposalRef],
      inputIntentRefs: [refs.inputIntentRef],
      executorEventRefs: [refs.executorEventRef],
      inputLeaseRef: refs.inputLeaseRef,
      actionAdapterRef: refs.actionAdapterRef,
      adapterReadinessRef: refs.adapterReadinessRef,
      replayRef: refs.replayRef,
      evidenceLedgerRef: refs.evidenceLedgerRef,
      artifactRefs: [refs.artifactRef],
      verificationRefs: artifactValidation.ok ? [refs.artifactValidationRef] : [],
      guiPresentRefs: guiPresent ? [refs.guiPresentRef] : [],
      isolationFlags: {
        backgroundRenderable: true,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        physicalDisplayPopup: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        diagnosticOnly: evidenceMode === 'fixture-diagnostic',
      },
    },
    userVisibleMinimum: {
      targetAppFrameRefs: includeScreenFrames ? [refs.beforeFrameRef, refs.afterFrameRef] : [],
      actorCursorRefs: [refs.userCursorRef, refs.agentCursorRef],
      annotationRefs: [refs.annotationOverlayRef, refs.annotationProposalRef],
      equivalentInputRefs: [refs.inputIntentRef, refs.executorEventRef],
      beforeAfterFrameRefs: beforeAfter ? [refs.beforeAfterRef] : [],
      artifactPreviewRefs: guiPresent ? [refs.artifactRef, refs.guiPresentRef] : [],
      replayTimelineRef: refs.replayRef,
    },
  };

  const evidenceClaims = evidenceClaimsForScenario({
    evidenceMode,
    refs,
    artifactValidation,
    guiPresent,
    beforeAfter,
    shellDirectArtifactWrite,
  });
  const manifestInput: VirtualAppScreenUserAcceptanceInput = {
    taskId: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_ID,
    userIntent,
    targetAppRefs: [refs.targetAppRef],
    targetWindowRefs: [refs.targetWindowRef],
    sessionRefs: [refs.sessionRef],
    adapterReadinessRefs: [refs.adapterReadinessRef],
    adapterReadinessRecords: [adapterReadiness],
    screenFrameRefs: includeScreenFrames ? [refs.beforeFrameRef, refs.afterFrameRef] : [],
    inputIntentRefs: [refs.inputIntentRef],
    executorEventRefs: [refs.executorEventRef],
    beforeAfterFrameRefs: beforeAfter ? [refs.beforeAfterRef] : [],
    annotationProposalRefs: [refs.annotationProposalRef],
    artifactRefs: [refs.artifactRef],
    verificationRefs: artifactValidation.ok ? [refs.artifactValidationRef] : [],
    guiPresentRefs: guiPresent ? [refs.guiPresentRef] : [],
    replayRef: refs.replayRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: evidenceMode === 'fixture-diagnostic',
    },
    evidenceClaims,
    blockedReason: scenarioIssues.length ? scenarioIssues.join(' ') : undefined,
    createdAt,
    metadata: {
      fixtureBoundary: {
        diagnosticFixture: evidenceMode === 'fixture-diagnostic',
        fixtureCanClaimUserAcceptance: false,
      },
      artifactValidationRef: refs.artifactValidationRef,
      firstScenarioSchemaVersion: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_SCHEMA_VERSION,
    },
  };
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(manifestInput);
  const explicitValidation = validateVirtualAppScreenUserAcceptanceManifest(manifest);
  manifest.validation = explicitValidation;

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_SCHEMA_VERSION,
    taskId: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_FIRST_SCENARIO_ID,
    userIntent,
    runId,
    runDirRef,
    createdAt,
    evidenceMode,
    fixtureBoundary: {
      diagnosticFixture: evidenceMode === 'fixture-diagnostic',
      fixtureCanClaimUserAcceptance: false,
      userAcceptanceRequires: [
        'real VirtualAppScreen app/window/session evidence from the current run',
        'current before/after frame refs',
        'input intent and executor event refs',
        'visible annotation or proposal refs',
        'artifact validator/verifier refs',
        'gui.present refs for the Screen pane and final artifact',
        'isolation flags proving no physical desktop impact',
      ],
    },
    localSafety: {
      lowRisk: true,
      requiresExternalAccount: false,
      sendsExternalMessages: false,
      modifiesUserPhysicalDesktop: false,
      networkRequired: false,
    },
    refs,
    adapterReadiness,
    screen,
    records: {
      source,
      frameStream,
      userCursor,
      agentCursor,
      beforeFrame,
      afterFrame,
      annotationOverlay,
      annotationProposal,
      inputIntent,
      executorEvent,
      beforeAfter,
      guiPresent,
      replay,
      evidenceLedger,
    },
    artifact,
    artifactValidation,
    manifestInput,
    manifest,
  };
}

export function validateVirtualAppScreenResearchNoteArtifact(options: {
  artifact: VirtualAppScreenResearchNoteArtifact;
  validatorRef: string;
  runId: string;
  runStartedAt: string;
  requiredRefs: {
    sourceEvidenceRefs: string[];
    causalityRefs: string[];
  };
}): VirtualAppScreenResearchNoteArtifactValidation {
  const issues: string[] = [];
  const artifact = options.artifact;
  if (!artifact.ref.trim()) issues.push('artifact ref is required.');
  if (!artifact.path.endsWith('.md')) issues.push('research-note artifact must be markdown.');
  if (artifact.content.trim().length < 80) issues.push('research-note artifact is empty or too small.');
  if (!artifact.content.includes('Source evidence refs:')) {
    issues.push('research-note artifact must cite source evidence refs.');
  }
  if (!artifact.content.includes('Annotation refs:')) {
    issues.push('research-note artifact must cite annotation refs.');
  }
  if (artifact.originRunId !== options.runId) {
    issues.push('research-note artifact originRunId must match the current scenario run.');
  }
  if (Date.parse(artifact.createdAt) < Date.parse(options.runStartedAt)) {
    issues.push('research-note artifact is older than the current scenario run.');
  }
  if (artifact.shellDirectArtifactWrite || artifact.createdBy === 'shell-direct-artifact') {
    issues.push('shell direct artifact writes cannot satisfy VirtualAppScreen artifact causality.');
  }
  for (const ref of options.requiredRefs.sourceEvidenceRefs) {
    if (!artifact.sourceEvidenceRefs.includes(ref)) {
      issues.push(`research-note artifact is missing source evidence ref ${ref}.`);
    }
  }
  for (const ref of options.requiredRefs.causalityRefs) {
    if (!artifact.causalityRefs.includes(ref)) {
      issues.push(`research-note artifact is missing causality ref ${ref}.`);
    }
  }
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-research-note-artifact-validation.v1',
    ref: options.validatorRef,
    artifactRef: artifact.ref,
    ok: issues.length === 0,
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
    checkedRefs: uniqueRefs([
      artifact.ref,
      ...artifact.sourceEvidenceRefs,
      ...artifact.causalityRefs,
    ]),
  };
}

export async function writeVirtualAppScreenFirstScenarioBundle(
  outDir: string,
  options: VirtualAppScreenFirstScenarioOptions = {},
): Promise<VirtualAppScreenFirstScenarioBundle> {
  const bundle = buildVirtualAppScreenFirstScenarioBundle(options);
  const records: Array<[string, unknown]> = [
    ['scenario-bundle.json', bundle],
    ['virtual-app-screen-user-acceptance-input.json', bundle.manifestInput],
    ['virtual-app-screen-user-acceptance-manifest.json', bundle.manifest],
    [bundle.refs.sourceRef, bundle.records.source],
    [bundle.refs.frameStreamRef, bundle.records.frameStream],
    [bundle.refs.userCursorRef, bundle.records.userCursor],
    [bundle.refs.agentCursorRef, bundle.records.agentCursor],
    [bundle.refs.adapterReadinessRef, bundle.adapterReadiness],
    [bundle.refs.annotationOverlayRef, bundle.records.annotationOverlay],
    [bundle.refs.annotationProposalRef, bundle.records.annotationProposal],
    [bundle.refs.inputIntentRef, bundle.records.inputIntent],
    [bundle.refs.executorEventRef, bundle.records.executorEvent],
    [bundle.refs.artifactValidationRef, bundle.artifactValidation],
    [bundle.refs.replayRef, bundle.records.replay],
    [bundle.refs.evidenceLedgerRef, bundle.records.evidenceLedger],
  ];
  if (bundle.records.beforeFrame) records.push([bundle.refs.beforeFrameRef, bundle.records.beforeFrame]);
  if (bundle.records.afterFrame) records.push([bundle.refs.afterFrameRef, bundle.records.afterFrame]);
  if (bundle.records.beforeAfter) records.push([bundle.refs.beforeAfterRef, bundle.records.beforeAfter]);
  if (bundle.records.guiPresent) records.push([bundle.refs.guiPresentRef, bundle.records.guiPresent]);

  await mkdir(outDir, { recursive: true });
  for (const [ref, data] of records) {
    await writeJsonRef(outDir, bundle.runDirRef, ref, data);
  }
  await writeTextRef(outDir, bundle.runDirRef, bundle.refs.artifactRef, `${bundle.artifact.content}\n`);
  return bundle;
}

function buildRefs(runId: string, runDirRef: string): VirtualAppScreenFirstScenarioRefs {
  return {
    targetAppRef: `app:${runId}/browser-research-profile`,
    targetWindowRef: `window:${runId}/browser-research-profile/main`,
    sessionRef: `computer-use-session:${runId}`,
    frameStreamRef: `${runDirRef}/frame-stream.json`,
    userCursorRef: `${runDirRef}/cursors/user.json`,
    agentCursorRef: `${runDirRef}/cursors/agent.json`,
    sourceRef: `${runDirRef}/source/local-research-source.json`,
    beforeFrameRef: `${runDirRef}/frames/before-frame.json`,
    afterFrameRef: `${runDirRef}/frames/after-frame.json`,
    annotationOverlayRef: `${runDirRef}/annotations/source-highlight.json`,
    annotationProposalRef: `${runDirRef}/annotation-proposals/source-highlight.json`,
    inputIntentRef: `${runDirRef}/input-intents/highlight-source.json`,
    executorEventRef: `${runDirRef}/executor-events/highlight-source.json`,
    beforeAfterRef: `${runDirRef}/before-after/highlight-source.json`,
    actionAdapterRef: `${runDirRef}/action-adapters/browser-runtime-window.json`,
    inputLeaseRef: `${runDirRef}/input-leases/browser-window.json`,
    adapterReadinessRef: `${runDirRef}/adapter-readiness/browser-runtime-window.json`,
    artifactRef: `${runDirRef}/artifacts/research-note.md`,
    artifactValidationRef: `${runDirRef}/verifier/research-note-artifact.json`,
    guiPresentRef: `${runDirRef}/gui-present/research-note-screen.json`,
    replayRef: `${runDirRef}/replay.json`,
    evidenceLedgerRef: `${runDirRef}/evidence-ledger.json`,
  };
}

function frameRecord(
  frameRole: 'before' | 'after',
  ref: string,
  refs: VirtualAppScreenFirstScenarioRefs,
  annotationOverlayRefs: string[],
): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-frame.v1',
    ref,
    frameRole,
    targetAppRef: refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    sessionRef: refs.sessionRef,
    visibleTextRefs: [refs.sourceRef],
    actorCursorRefs: [refs.userCursorRef, refs.agentCursorRef],
    annotationOverlayRefs,
    visibleTextDigest: 'sha256:local-research-source-fixture-v1',
  };
}

function researchNoteArtifact(options: {
  ref: string;
  runId: string;
  createdAt: string;
  sessionRef: string;
  sourceEvidenceRefs: string[];
  causalityRefs: string[];
  shellDirectArtifactWrite: boolean;
}): VirtualAppScreenResearchNoteArtifact {
  const annotationRefs = options.causalityRefs.filter((ref) => ref.includes('/annotation-proposals/'));
  const content = [
    '# Research Note',
    '',
    'Summary: The local source states that a research note must remain traceable to visible app evidence before it can be accepted.',
    '',
    `Source evidence refs: ${options.sourceEvidenceRefs.join(', ')}`,
    `Annotation refs: ${annotationRefs.join(', ')}`,
    `Action causality refs: ${options.causalityRefs.join(', ')}`,
    `Session ref: ${options.sessionRef}`,
  ].join('\n');
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-research-note-artifact.v1',
    ref: options.ref,
    path: 'artifacts/research-note.md',
    kind: 'research-note',
    title: 'Research Note',
    content,
    createdAt: options.createdAt,
    createdBy: options.shellDirectArtifactWrite ? 'shell-direct-artifact' : 'virtual-app-screen-action',
    originRunId: options.runId,
    sessionRef: options.sessionRef,
    sourceEvidenceRefs: options.sourceEvidenceRefs,
    causalityRefs: options.causalityRefs,
    shellDirectArtifactWrite: options.shellDirectArtifactWrite,
  };
}

function evidenceClaimsForScenario(options: {
  evidenceMode: VirtualAppScreenFirstScenarioEvidenceMode;
  refs: VirtualAppScreenFirstScenarioRefs;
  artifactValidation: VirtualAppScreenResearchNoteArtifactValidation;
  guiPresent?: Record<string, unknown>;
  beforeAfter?: Record<string, unknown>;
  shellDirectArtifactWrite: boolean;
}): VirtualAppScreenEvidenceClaim[] {
  const claims: VirtualAppScreenEvidenceClaim[] = [];
  if (options.evidenceMode === 'real-virtual-app-screen') {
    claims.push({
      id: 'real-virtual-app-screen',
      kind: 'real-virtual-app-screen',
      status: 'present',
      ref: options.refs.evidenceLedgerRef,
      refs: [options.refs.replayRef],
      evidenceRefs: uniqueRefs([
        options.refs.beforeFrameRef,
        options.refs.afterFrameRef,
        options.beforeAfter ? options.refs.beforeAfterRef : undefined,
        options.refs.inputIntentRef,
        options.refs.executorEventRef,
      ]),
      sessionRefs: [options.refs.sessionRef],
    });
  } else {
    claims.push({
      id: 'fixture-boundary',
      kind: 'target-bound-fixture',
      status: 'diagnostic-only',
      ref: options.refs.evidenceLedgerRef,
      evidenceRefs: [options.refs.replayRef],
      userAcceptanceEligible: false,
      note: 'Local fixture records exercise the contract but do not prove a real app/window/session run.',
    });
  }
  if (options.guiPresent) {
    claims.push({
      id: 'gui-present',
      kind: 'gui-present',
      status: 'present',
      ref: options.refs.guiPresentRef,
    });
  }
  if (options.artifactValidation.ok) {
    claims.push({
      id: 'research-note-artifact-validator',
      kind: 'validator-verifier',
      status: 'present',
      ref: options.refs.artifactValidationRef,
      evidenceRefs: [options.refs.artifactRef],
    });
  }
  if (options.shellDirectArtifactWrite) {
    claims.push({
      id: 'shell-direct-artifact-write',
      kind: 'shell-direct-artifact',
      status: 'present',
      ref: options.refs.artifactRef,
      completionEvidence: true,
      userAcceptanceEligible: true,
    });
  }
  return claims;
}

function scenarioIssuesForManifest(options: {
  evidenceMode: VirtualAppScreenFirstScenarioEvidenceMode;
  artifactValidation: VirtualAppScreenResearchNoteArtifactValidation;
  includeGuiPresent: boolean;
  includeBeforeAfter: boolean;
  includeScreenFrames: boolean;
}): string[] {
  const issues: string[] = [];
  if (options.evidenceMode === 'fixture-diagnostic') {
    issues.push('Local first-scenario fixture is diagnostic only and cannot claim user-level acceptance.');
  }
  if (!options.includeScreenFrames) issues.push('Screen frame refs are missing.');
  if (!options.includeBeforeAfter) issues.push('Before/after frame evidence is missing.');
  if (!options.includeGuiPresent) issues.push('gui.present evidence is missing.');
  if (!options.artifactValidation.ok) {
    issues.push(`Artifact validation failed: ${options.artifactValidation.issues.join(' ')}`);
  }
  return issues;
}

function normalizeRunId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_RUN_ID;
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function localPathForRef(outDir: string, runDirRef: string, ref: string): string {
  if (!ref.startsWith(`${runDirRef}/`)) return join(outDir, ref.replace(/[^a-zA-Z0-9._/-]+/g, '_'));
  return join(outDir, relative(runDirRef, ref));
}

async function writeJsonRef(outDir: string, runDirRef: string, ref: string, data: unknown): Promise<void> {
  const path = localPathForRef(outDir, runDirRef, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeTextRef(outDir: string, runDirRef: string, ref: string, text: string): Promise<void> {
  const path = localPathForRef(outDir, runDirRef, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

interface CliArgs extends VirtualAppScreenFirstScenarioOptions {
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outDir: join('.sciforge', 'vision-runs', DEFAULT_RUN_ID),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      args.outDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--run-id') {
      args.runId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--real-virtual-app-screen') {
      args.evidenceMode = 'real-virtual-app-screen';
      continue;
    }
    if (arg === '--omit-gui-present') {
      args.includeGuiPresent = false;
      continue;
    }
    if (arg === '--omit-before-after') {
      args.includeBeforeAfter = false;
      continue;
    }
    if (arg === '--omit-screen-frames') {
      args.includeScreenFrames = false;
      continue;
    }
    if (arg === '--shell-direct-artifact') {
      args.shellDirectArtifactWrite = true;
      continue;
    }
    if (arg === '--old-artifact') {
      args.oldArtifact = true;
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen first-scenario argument: ${arg}`);
  }
  if (!args.outDir) throw new Error('--out-dir must not be empty');
  return args;
}

async function main(): Promise<void> {
  const { outDir, ...options } = parseArgs(process.argv.slice(2));
  const bundle = await writeVirtualAppScreenFirstScenarioBundle(outDir, options);
  process.stdout.write(
    `[${bundle.manifest.status}] wrote ${bundle.schemaVersion} to ${outDir}; `
      + `diagnosticOnly=${bundle.manifest.diagnosticOnly} userAcceptanceEligible=${bundle.manifest.userAcceptanceEligible}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
