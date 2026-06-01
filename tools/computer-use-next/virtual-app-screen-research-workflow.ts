import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  type VirtualAppScreenEvidenceClaim,
  type VirtualAppScreenEvidenceClaimKind,
  type VirtualAppScreenIsolationFlags,
  type VirtualAppScreenReadinessRecord,
  type VirtualAppScreenUserAcceptanceInput,
  type VirtualAppScreenUserAcceptanceManifest,
} from '../virtual-app-screen-user-acceptance-manifest.js';

export const VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-research-workflow.v1' as const;

export const VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID =
  'P1-CU-UA-RESEARCH-WORKFLOW' as const;

export const REQUIRED_RESEARCH_SCREEN_PROFILE_IDS = [
  'browser-research',
  'terminal-experiment',
  'jupyter-notebook',
  'editor-cursor',
  'pdf-zotero-preview',
  'csv-table-viewer',
] as const;

export const REQUIRED_RESEARCH_ARTIFACT_KINDS = [
  'report',
  'notebook',
  'figure',
  'csv',
  'ppt',
  'docx',
  'log',
] as const;

export type VirtualAppScreenResearchEvidenceMode =
  | 'fixture-diagnostic'
  | 'real-virtual-app-screen';

export type VirtualAppScreenResearchProfileId =
  typeof REQUIRED_RESEARCH_SCREEN_PROFILE_IDS[number];

export type VirtualAppScreenResearchArtifactKind =
  typeof REQUIRED_RESEARCH_ARTIFACT_KINDS[number];

export type VirtualAppScreenResearchSchedulingKind =
  | 'isolated-parallel'
  | 'non-isolated-serial';

export interface VirtualAppScreenResearchWorkflowOptions {
  runId?: string;
  runDirRef?: string;
  createdAt?: string;
  evidenceMode?: VirtualAppScreenResearchEvidenceMode;
  nonIsolatedProfiles?: VirtualAppScreenResearchProfileId[];
  missingArtifactVerifierKinds?: VirtualAppScreenResearchArtifactKind[];
  missingArtifactGuiPresentKinds?: VirtualAppScreenResearchArtifactKind[];
  shellOnlyArtifactKinds?: VirtualAppScreenResearchArtifactKind[];
  includeDomPlaywrightShellSubstitutes?: boolean;
  crossScreenArtifactWrite?: boolean;
}

export interface VirtualAppScreenResearchProfile {
  id: VirtualAppScreenResearchProfileId;
  title: string;
  appFamily: string;
  targetAppRef: string;
  targetWindowRef: string;
  sessionRef: string;
  adapterReadinessRef: string;
  frameStreamRef: string;
  screenFrameRefs: string[];
  inputIntentRefs: string[];
  executorEventRefs: string[];
  beforeAfterFrameRefs: string[];
  annotationProposalRefs: string[];
  artifactRefs: string[];
  verificationRefs: string[];
  guiPresentRefs: string[];
  adapterReadiness: VirtualAppScreenReadinessRecord & { ref: string };
  isolationFlags: Required<VirtualAppScreenIsolationFlags>;
  blockedPolicy: {
    userLevelEligible: boolean;
    status: 'eligible' | 'diagnostic-only' | 'requires-handoff' | 'blocked';
    blockedReason: string | null;
    requiredRefs: string[];
    nonSubstitutes: string[];
  };
  contributionBoundary: {
    writableScreenRefs: string[];
    writableArtifactRefs: string[];
    readableArtifactRefs: string[];
    mayProduceArtifactKinds: VirtualAppScreenResearchArtifactKind[];
    mayConsumeFromProfileIds: VirtualAppScreenResearchProfileId[];
    disallowCrossScreenWrites: true;
  };
}

export interface VirtualAppScreenResearchArtifactChain {
  kind: VirtualAppScreenResearchArtifactKind;
  artifactRef: string;
  producerProfileId: VirtualAppScreenResearchProfileId;
  sourceProfileIds: VirtualAppScreenResearchProfileId[];
  sourceRefs: string[];
  verifierRef: string | null;
  guiPresentRef: string | null;
  verifier: {
    ref: string | null;
    status: 'passed' | 'failed' | 'missing';
    checkedRefs: string[];
    issues: string[];
    currentRunOnly: true;
    rejectsShellOnly: true;
  };
  guiPresent: {
    ref: string | null;
    status: 'present' | 'missing';
    displayedRefs: string[];
  };
  shellDirectArtifactWrite: boolean;
  userLevelEligible: boolean;
}

export interface VirtualAppScreenResearchSchedulingPlan {
  strategy: VirtualAppScreenResearchSchedulingKind;
  isolatedParallelProfileIds: VirtualAppScreenResearchProfileId[];
  nonIsolatedSerialProfileIds: VirtualAppScreenResearchProfileId[];
  executorLeaseRefs: string[];
  rationale: string;
}

export interface VirtualAppScreenResearchWorkflowValidation {
  ok: boolean;
  status: 'passed' | 'blocked' | 'requires-handoff';
  issues: string[];
  missingProfileIds: VirtualAppScreenResearchProfileId[];
  missingArtifactKinds: VirtualAppScreenResearchArtifactKind[];
  missingArtifactChainRefs: string[];
  rejectedClaimKinds: VirtualAppScreenEvidenceClaimKind[];
  crossScreenBoundaryViolations: string[];
  schedulingIssues: string[];
}

export interface VirtualAppScreenResearchWorkflowBundle {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION;
  taskId: typeof VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID;
  workflowId: 'research-workflow-profile-contract';
  userIntent: string;
  runId: string;
  runDirRef: string;
  createdAt: string;
  evidenceMode: VirtualAppScreenResearchEvidenceMode;
  fixtureBoundary: {
    diagnosticFixture: boolean;
    fixtureCanClaimUserAcceptance: false;
    userAcceptanceRequires: string[];
  };
  profiles: VirtualAppScreenResearchProfile[];
  schedulingPlan: VirtualAppScreenResearchSchedulingPlan;
  artifactChains: VirtualAppScreenResearchArtifactChain[];
  evidenceClaims: VirtualAppScreenEvidenceClaim[];
  manifestInput: VirtualAppScreenUserAcceptanceInput;
  manifest: VirtualAppScreenUserAcceptanceManifest;
  validation: VirtualAppScreenResearchWorkflowValidation;
}

interface ProfileTemplate {
  id: VirtualAppScreenResearchProfileId;
  title: string;
  appFamily: string;
  adapterKind: string;
  targetScope: VirtualAppScreenReadinessRecord['targetScope'];
  supportedActions: string[];
  mayProduceArtifactKinds: VirtualAppScreenResearchArtifactKind[];
  mayConsumeFromProfileIds: VirtualAppScreenResearchProfileId[];
}

const DEFAULT_RUN_ID = 'research-workflow-profile-contract-fixture';
const DEFAULT_CREATED_AT = '2026-06-01T00:00:00.000Z';

const profileTemplates: ProfileTemplate[] = [
  {
    id: 'browser-research',
    title: 'Browser Research',
    appFamily: 'browser',
    adapterKind: 'browser-runtime-window',
    targetScope: 'browser',
    supportedActions: ['navigate', 'click', 'type', 'scroll', 'extract-selection', 'annotate'],
    mayProduceArtifactKinds: ['report'],
    mayConsumeFromProfileIds: [],
  },
  {
    id: 'terminal-experiment',
    title: 'Terminal Experiment',
    appFamily: 'terminal',
    adapterKind: 'terminal-pty-session',
    targetScope: 'terminal',
    supportedActions: ['type', 'hotkey', 'run-command', 'capture-output', 'interrupt'],
    mayProduceArtifactKinds: ['csv', 'log'],
    mayConsumeFromProfileIds: ['browser-research', 'editor-cursor'],
  },
  {
    id: 'jupyter-notebook',
    title: 'Jupyter Notebook',
    appFamily: 'notebook',
    adapterKind: 'jupyter-notebook-session',
    targetScope: 'window',
    supportedActions: ['click', 'type', 'run-cell', 'insert-cell', 'scroll', 'capture-output'],
    mayProduceArtifactKinds: ['notebook', 'figure'],
    mayConsumeFromProfileIds: ['terminal-experiment', 'csv-table-viewer'],
  },
  {
    id: 'editor-cursor',
    title: 'Editor / Cursor',
    appFamily: 'editor',
    adapterKind: 'editor-extension-window',
    targetScope: 'window',
    supportedActions: ['open-file', 'type', 'save', 'diff', 'search', 'terminal-command'],
    mayProduceArtifactKinds: ['report', 'ppt', 'docx'],
    mayConsumeFromProfileIds: [
      'browser-research',
      'terminal-experiment',
      'jupyter-notebook',
      'pdf-zotero-preview',
      'csv-table-viewer',
    ],
  },
  {
    id: 'pdf-zotero-preview',
    title: 'PDF / Zotero / Preview',
    appFamily: 'pdf-reference',
    adapterKind: 'document-reader-window',
    targetScope: 'window',
    supportedActions: ['open-document', 'search', 'scroll', 'select-text', 'annotate'],
    mayProduceArtifactKinds: ['report'],
    mayConsumeFromProfileIds: ['browser-research'],
  },
  {
    id: 'csv-table-viewer',
    title: 'CSV / Table Viewer',
    appFamily: 'table-viewer',
    adapterKind: 'table-viewer-window',
    targetScope: 'window',
    supportedActions: ['open-table', 'sort', 'filter', 'select-cell', 'export-selection'],
    mayProduceArtifactKinds: ['csv'],
    mayConsumeFromProfileIds: ['terminal-experiment', 'jupyter-notebook'],
  },
];

const artifactPlan: Array<{
  kind: VirtualAppScreenResearchArtifactKind;
  producerProfileId: VirtualAppScreenResearchProfileId;
  sourceProfileIds: VirtualAppScreenResearchProfileId[];
}> = [
  {
    kind: 'report',
    producerProfileId: 'editor-cursor',
    sourceProfileIds: ['browser-research', 'pdf-zotero-preview', 'jupyter-notebook', 'csv-table-viewer'],
  },
  {
    kind: 'notebook',
    producerProfileId: 'jupyter-notebook',
    sourceProfileIds: ['browser-research', 'terminal-experiment', 'csv-table-viewer'],
  },
  {
    kind: 'figure',
    producerProfileId: 'jupyter-notebook',
    sourceProfileIds: ['jupyter-notebook'],
  },
  {
    kind: 'csv',
    producerProfileId: 'terminal-experiment',
    sourceProfileIds: ['csv-table-viewer'],
  },
  {
    kind: 'ppt',
    producerProfileId: 'editor-cursor',
    sourceProfileIds: ['editor-cursor', 'jupyter-notebook'],
  },
  {
    kind: 'docx',
    producerProfileId: 'editor-cursor',
    sourceProfileIds: ['editor-cursor', 'pdf-zotero-preview'],
  },
  {
    kind: 'log',
    producerProfileId: 'terminal-experiment',
    sourceProfileIds: ['terminal-experiment'],
  },
];

const nonSubstituteLabels = [
  'DOM snapshots',
  'Playwright-only browser automation',
  'shell direct artifact writes',
  'package/local smoke',
  'historical noVNC or M6 native multi-screen diagnostics',
];

export function buildVirtualAppScreenResearchWorkflowBundle(
  options: VirtualAppScreenResearchWorkflowOptions = {},
): VirtualAppScreenResearchWorkflowBundle {
  const runId = normalizeRunId(options.runId ?? DEFAULT_RUN_ID);
  const runDirRef = options.runDirRef ?? `.sciforge/vision-runs/${runId}`;
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const evidenceMode = options.evidenceMode ?? 'fixture-diagnostic';
  const nonIsolatedProfiles = new Set(options.nonIsolatedProfiles ?? []);
  const missingVerifierKinds = new Set(options.missingArtifactVerifierKinds ?? []);
  const missingGuiPresentKinds = new Set(options.missingArtifactGuiPresentKinds ?? []);
  const shellOnlyKinds = new Set(options.shellOnlyArtifactKinds ?? []);

  const profiles = profileTemplates.map((template) => buildProfile({
    template,
    runId,
    runDirRef,
    evidenceMode,
    nonIsolated: nonIsolatedProfiles.has(template.id),
  }));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const artifactChains = artifactPlan.map((plan) => buildArtifactChain({
    plan,
    runDirRef,
    profileById,
    evidenceMode,
    missingVerifier: missingVerifierKinds.has(plan.kind),
    missingGuiPresent: missingGuiPresentKinds.has(plan.kind),
    shellDirectArtifactWrite: shellOnlyKinds.has(plan.kind),
    crossScreenArtifactWrite: options.crossScreenArtifactWrite === true && plan.kind === 'csv',
  }));
  attachArtifactRefsToProfiles(profiles, artifactChains);

  const schedulingPlan = buildSchedulingPlan(runDirRef, profiles);
  const evidenceClaims = buildEvidenceClaims({
    profiles,
    artifactChains,
    evidenceMode,
    includeDomPlaywrightShellSubstitutes: options.includeDomPlaywrightShellSubstitutes === true,
  });
  const aggregateRefsEligible = evidenceMode === 'real-virtual-app-screen'
    && artifactChains.every((chain) => chain.userLevelEligible)
    && profiles.every((profile) => profile.blockedPolicy.userLevelEligible)
    && schedulingPlan.nonIsolatedSerialProfileIds.length === 0;
  const manifestInput = buildManifestInput({
    runId,
    createdAt,
    profiles,
    schedulingPlan,
    artifactChains,
    evidenceClaims,
    evidenceMode,
    aggregateRefsEligible,
  });
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(manifestInput);
  const explicitManifestValidation = validateVirtualAppScreenUserAcceptanceManifest(manifest);
  manifest.validation = explicitManifestValidation;
  const validation = validateVirtualAppScreenResearchWorkflowBundle({
    schemaVersion: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION,
    taskId: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID,
    workflowId: 'research-workflow-profile-contract',
    userIntent: researchWorkflowUserIntent(),
    runId,
    runDirRef,
    createdAt,
    evidenceMode,
    fixtureBoundary: fixtureBoundary(evidenceMode),
    profiles,
    schedulingPlan,
    artifactChains,
    evidenceClaims,
    manifestInput,
    manifest,
  });

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION,
    taskId: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID,
    workflowId: 'research-workflow-profile-contract',
    userIntent: researchWorkflowUserIntent(),
    runId,
    runDirRef,
    createdAt,
    evidenceMode,
    fixtureBoundary: fixtureBoundary(evidenceMode),
    profiles,
    schedulingPlan,
    artifactChains,
    evidenceClaims,
    manifestInput,
    manifest,
    validation,
  };
}

export function validateVirtualAppScreenResearchWorkflowBundle(
  bundle: Omit<VirtualAppScreenResearchWorkflowBundle, 'validation'>,
): VirtualAppScreenResearchWorkflowValidation {
  const issues: string[] = [];
  const profileIds = new Set(bundle.profiles.map((profile) => profile.id));
  const missingProfileIds = REQUIRED_RESEARCH_SCREEN_PROFILE_IDS.filter((id) => !profileIds.has(id));
  if (missingProfileIds.length) {
    issues.push(`missing required research screen profiles: ${missingProfileIds.join(', ')}.`);
  }

  const profileRefIssues = validateProfileRefs(bundle.profiles);
  issues.push(...profileRefIssues);

  const missingArtifactKinds = REQUIRED_RESEARCH_ARTIFACT_KINDS.filter((kind) => (
    !bundle.artifactChains.some((chain) => chain.kind === kind)
  ));
  if (missingArtifactKinds.length) {
    issues.push(`missing required research artifact chains: ${missingArtifactKinds.join(', ')}.`);
  }

  const missingArtifactChainRefs: string[] = [];
  for (const chain of bundle.artifactChains) {
    if (!chain.artifactRef) missingArtifactChainRefs.push(`${chain.kind}:artifactRef`);
    if (!chain.verifierRef) missingArtifactChainRefs.push(`${chain.kind}:verifierRef`);
    if (!chain.guiPresentRef) missingArtifactChainRefs.push(`${chain.kind}:guiPresentRef`);
    if (chain.verifier.status !== 'passed') {
      issues.push(`${chain.kind} artifact verifier must pass before user-level acceptance.`);
    }
    if (chain.guiPresent.status !== 'present') {
      issues.push(`${chain.kind} artifact must be displayed through gui.present.`);
    }
    if (chain.shellDirectArtifactWrite) {
      issues.push(`${chain.kind} artifact was produced by a shell direct write and cannot satisfy VirtualAppScreen workflow acceptance.`);
    }
    if (!chain.sourceRefs.length) {
      issues.push(`${chain.kind} artifact chain has no source refs.`);
    }
  }

  const crossScreenBoundaryViolations = validateContributionBoundaries(bundle.profiles, bundle.artifactChains);
  issues.push(...crossScreenBoundaryViolations);

  const schedulingIssues = validateScheduling(bundle.schedulingPlan, bundle.profiles);
  issues.push(...schedulingIssues);

  const rejectedClaimKinds = rejectedSubstituteClaimKinds(bundle.evidenceClaims);
  if (rejectedClaimKinds.length) {
    issues.push(`substitute evidence cannot claim workflow completion: ${rejectedClaimKinds.join(', ')}.`);
  }

  if (bundle.evidenceMode === 'fixture-diagnostic') {
    issues.push('fixture-diagnostic workflow bundles are diagnostic only and cannot claim real user-level acceptance.');
  }

  if (bundle.manifest.status !== 'passed') {
    issues.push(`aggregate VirtualAppScreen user acceptance manifest is ${bundle.manifest.status}.`);
  }

  const requiresHandoff = bundle.schedulingPlan.nonIsolatedSerialProfileIds.length > 0
    || bundle.manifest.status === 'requires-handoff';
  const ok = issues.length === 0
    && missingProfileIds.length === 0
    && missingArtifactKinds.length === 0
    && missingArtifactChainRefs.length === 0
    && crossScreenBoundaryViolations.length === 0
    && schedulingIssues.length === 0
    && rejectedClaimKinds.length === 0
    && bundle.manifest.userAcceptanceEligible;

  return {
    ok,
    status: ok ? 'passed' : requiresHandoff ? 'requires-handoff' : 'blocked',
    issues,
    missingProfileIds,
    missingArtifactKinds,
    missingArtifactChainRefs,
    rejectedClaimKinds,
    crossScreenBoundaryViolations,
    schedulingIssues,
  };
}

export async function writeVirtualAppScreenResearchWorkflowBundle(
  outPath: string,
  options: VirtualAppScreenResearchWorkflowOptions = {},
): Promise<VirtualAppScreenResearchWorkflowBundle> {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle(options);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return bundle;
}

function buildProfile(options: {
  template: ProfileTemplate;
  runId: string;
  runDirRef: string;
  evidenceMode: VirtualAppScreenResearchEvidenceMode;
  nonIsolated: boolean;
}): VirtualAppScreenResearchProfile {
  const refBase = `${options.runDirRef}/screens/${options.template.id}`;
  const targetAppRef = `app:${options.template.id}`;
  const targetWindowRef = `window:${options.template.id}/main`;
  const sessionRef = `computer-use-session:${options.runId}/${options.template.id}`;
  const adapterReadinessRef = `${refBase}/adapter-readiness.json`;
  const beforeFrameRef = `${refBase}/frames/before.png`;
  const afterFrameRef = `${refBase}/frames/after.png`;
  const inputIntentRef = `${refBase}/input-intents/primary-action.json`;
  const executorEventRef = `${refBase}/executor-events/primary-action.json`;
  const beforeAfterRef = `${refBase}/before-after/primary-action.json`;
  const annotationProposalRef = `${refBase}/annotation-proposals/primary-action.json`;
  const isolationFlags = isolationFlagsFor(options.nonIsolated, options.evidenceMode);
  const adapterReadiness: VirtualAppScreenReadinessRecord & { ref: string } = {
    ref: adapterReadinessRef,
    adapterKind: options.nonIsolated
      ? `${options.template.adapterKind}-shared-input-diagnostic`
      : options.template.adapterKind,
    targetScope: options.template.targetScope,
    supportedActions: options.template.supportedActions,
    captureSupported: true,
    backgroundRenderable: !options.nonIsolated,
    affectsPhysicalDisplay: options.nonIsolated,
    requiresFocusSteal: options.nonIsolated,
    sharedSystemInputUsed: options.nonIsolated,
    blockedReason: options.nonIsolated
      ? 'No isolated app/window-scoped adapter is available; this profile must run serially with user handoff.'
      : null,
    schemaRefs: [
      'schema:computer-use/action-adapter-readiness.v1',
      'schema:computer-use/virtual-app-screen-research-profile.v1',
    ],
  };
  const userLevelEligible = options.evidenceMode === 'real-virtual-app-screen' && !options.nonIsolated;
  const blockedReason = options.nonIsolated
    ? 'non-isolated shared input requires serial scheduling and user handoff'
    : options.evidenceMode === 'fixture-diagnostic'
      ? 'diagnostic fixture cannot claim user-level acceptance'
      : null;
  const status = options.nonIsolated
    ? 'requires-handoff'
    : options.evidenceMode === 'fixture-diagnostic'
      ? 'diagnostic-only'
      : 'eligible';

  return {
    id: options.template.id,
    title: options.template.title,
    appFamily: options.template.appFamily,
    targetAppRef,
    targetWindowRef,
    sessionRef,
    adapterReadinessRef,
    frameStreamRef: `${refBase}/frame-stream.json`,
    screenFrameRefs: [beforeFrameRef, afterFrameRef],
    inputIntentRefs: [inputIntentRef],
    executorEventRefs: [executorEventRef],
    beforeAfterFrameRefs: [beforeAfterRef],
    annotationProposalRefs: [annotationProposalRef],
    artifactRefs: [],
    verificationRefs: [],
    guiPresentRefs: [],
    adapterReadiness,
    isolationFlags,
    blockedPolicy: {
      userLevelEligible,
      status,
      blockedReason,
      requiredRefs: [
        targetAppRef,
        targetWindowRef,
        sessionRef,
        adapterReadinessRef,
        beforeFrameRef,
        afterFrameRef,
        inputIntentRef,
        executorEventRef,
        beforeAfterRef,
        annotationProposalRef,
      ],
      nonSubstitutes: nonSubstituteLabels,
    },
    contributionBoundary: {
      writableScreenRefs: [targetWindowRef, sessionRef],
      writableArtifactRefs: [],
      readableArtifactRefs: [],
      mayProduceArtifactKinds: options.template.mayProduceArtifactKinds,
      mayConsumeFromProfileIds: options.template.mayConsumeFromProfileIds,
      disallowCrossScreenWrites: true,
    },
  };
}

function buildArtifactChain(options: {
  plan: typeof artifactPlan[number];
  runDirRef: string;
  profileById: Map<VirtualAppScreenResearchProfileId, VirtualAppScreenResearchProfile>;
  evidenceMode: VirtualAppScreenResearchEvidenceMode;
  missingVerifier: boolean;
  missingGuiPresent: boolean;
  shellDirectArtifactWrite: boolean;
  crossScreenArtifactWrite: boolean;
}): VirtualAppScreenResearchArtifactChain {
  const producerProfileId = options.crossScreenArtifactWrite
    ? 'browser-research'
    : options.plan.producerProfileId;
  const refBase = `${options.runDirRef}/artifacts/${options.plan.kind}`;
  const artifactRef = `file:${refBase}/${artifactFileName(options.plan.kind)}`;
  const verifierRef = options.missingVerifier ? null : `${refBase}/verifier.json`;
  const guiPresentRef = options.missingGuiPresent ? null : `gui.present:${refBase}`;
  const sourceRefs = sourceRefsForArtifact(options.plan.sourceProfileIds, options.profileById, options.runDirRef);
  const verifierIssues = [
    options.missingVerifier ? 'artifact verifier ref is missing' : undefined,
    options.shellDirectArtifactWrite ? 'shell direct artifact write is not accepted' : undefined,
  ].filter((issue): issue is string => Boolean(issue));
  const verifierStatus = options.missingVerifier
    ? 'missing'
    : verifierIssues.length
      ? 'failed'
      : 'passed';
  const guiPresentStatus = options.missingGuiPresent ? 'missing' : 'present';

  return {
    kind: options.plan.kind,
    artifactRef,
    producerProfileId,
    sourceProfileIds: options.plan.sourceProfileIds.filter(isProfileId),
    sourceRefs,
    verifierRef,
    guiPresentRef,
    verifier: {
      ref: verifierRef,
      status: verifierStatus,
      checkedRefs: [
        artifactRef,
        ...sourceRefs,
        ...(verifierRef ? [verifierRef] : []),
      ],
      issues: verifierIssues,
      currentRunOnly: true,
      rejectsShellOnly: true,
    },
    guiPresent: {
      ref: guiPresentRef,
      status: guiPresentStatus,
      displayedRefs: guiPresentRef ? [artifactRef, ...(verifierRef ? [verifierRef] : [])] : [],
    },
    shellDirectArtifactWrite: options.shellDirectArtifactWrite,
    userLevelEligible: options.evidenceMode === 'real-virtual-app-screen'
      && verifierStatus === 'passed'
      && guiPresentStatus === 'present'
      && !options.shellDirectArtifactWrite
      && !options.crossScreenArtifactWrite,
  };
}

function attachArtifactRefsToProfiles(
  profiles: VirtualAppScreenResearchProfile[],
  chains: VirtualAppScreenResearchArtifactChain[],
): void {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const chain of chains) {
    const producer = profileById.get(chain.producerProfileId);
    if (!producer) continue;
    producer.artifactRefs.push(chain.artifactRef);
    if (chain.verifierRef) producer.verificationRefs.push(chain.verifierRef);
    if (chain.guiPresentRef) producer.guiPresentRefs.push(chain.guiPresentRef);
    producer.contributionBoundary.writableArtifactRefs.push(chain.artifactRef);
  }
  for (const profile of profiles) {
    profile.contributionBoundary.readableArtifactRefs = chains
      .filter((chain) => chain.sourceProfileIds.includes(profile.id))
      .map((chain) => chain.artifactRef);
  }
}

function buildSchedulingPlan(
  runDirRef: string,
  profiles: VirtualAppScreenResearchProfile[],
): VirtualAppScreenResearchSchedulingPlan {
  const isolatedParallelProfileIds = profiles
    .filter((profile) => profile.blockedPolicy.status !== 'requires-handoff')
    .map((profile) => profile.id);
  const nonIsolatedSerialProfileIds = profiles
    .filter((profile) => profile.blockedPolicy.status === 'requires-handoff')
    .map((profile) => profile.id);

  return {
    strategy: nonIsolatedSerialProfileIds.length ? 'non-isolated-serial' : 'isolated-parallel',
    isolatedParallelProfileIds,
    nonIsolatedSerialProfileIds,
    executorLeaseRefs: profiles.map((profile) => `${runDirRef}/leases/${profile.id}.json`),
    rationale: nonIsolatedSerialProfileIds.length
      ? 'At least one profile lacks isolated app/window-scoped input, so non-isolated profiles must run serially and cannot claim user-level acceptance.'
      : 'All profiles expose background-renderable app/window/session adapters, so independent screens may run in isolated parallel groups.',
  };
}

function buildEvidenceClaims(options: {
  profiles: VirtualAppScreenResearchProfile[];
  artifactChains: VirtualAppScreenResearchArtifactChain[];
  evidenceMode: VirtualAppScreenResearchEvidenceMode;
  includeDomPlaywrightShellSubstitutes: boolean;
}): VirtualAppScreenEvidenceClaim[] {
  const realScreenClaims: VirtualAppScreenEvidenceClaim[] = options.profiles.map((profile) => ({
    id: `real-virtual-app-screen:${profile.id}`,
    kind: options.evidenceMode === 'real-virtual-app-screen'
      ? 'real-virtual-app-screen'
      : 'target-bound-fixture',
    status: options.evidenceMode === 'real-virtual-app-screen' ? 'present' : 'diagnostic-only',
    refs: [
      profile.targetAppRef,
      profile.targetWindowRef,
      profile.sessionRef,
      ...profile.screenFrameRefs,
      ...profile.inputIntentRefs,
      ...profile.executorEventRefs,
      ...profile.beforeAfterFrameRefs,
    ],
    sessionRefs: [profile.sessionRef],
    userAcceptanceEligible: options.evidenceMode === 'real-virtual-app-screen'
      && profile.blockedPolicy.userLevelEligible,
    completionEvidence: false,
    note: options.evidenceMode === 'real-virtual-app-screen'
      ? 'Current-run VirtualAppScreen screen refs are present.'
      : 'Diagnostic fixture profile coverage only; not live user acceptance evidence.',
  }));
  const artifactClaims: VirtualAppScreenEvidenceClaim[] = options.artifactChains.flatMap((chain) => ([
    {
      id: `verifier:${chain.kind}`,
      kind: 'validator-verifier' as const,
      status: chain.verifier.status === 'passed' ? 'present' : 'blocked',
      ref: chain.verifierRef ?? undefined,
      refs: chain.verifier.checkedRefs,
      completionEvidence: chain.userLevelEligible,
      userAcceptanceEligible: chain.userLevelEligible,
    },
    {
      id: `gui-present:${chain.kind}`,
      kind: 'gui-present' as const,
      status: chain.guiPresent.status === 'present' ? 'present' : 'missing',
      ref: chain.guiPresentRef ?? undefined,
      refs: chain.guiPresent.displayedRefs,
      completionEvidence: chain.userLevelEligible,
      userAcceptanceEligible: chain.userLevelEligible,
    },
  ]));
  const substituteClaims: VirtualAppScreenEvidenceClaim[] = options.includeDomPlaywrightShellSubstitutes
    ? [
        {
          id: 'dom-substitute',
          kind: 'dom',
          status: 'present',
          ref: 'diagnostic:dom-snapshot-only',
          completionEvidence: true,
          userAcceptanceEligible: true,
          note: 'Negative fixture: DOM alone must be rejected as user-level workflow evidence.',
        },
        {
          id: 'playwright-substitute',
          kind: 'playwright',
          status: 'present',
          ref: 'diagnostic:playwright-script-only',
          completionEvidence: true,
          userAcceptanceEligible: true,
          note: 'Negative fixture: Playwright alone must be rejected as user-level workflow evidence.',
        },
        {
          id: 'shell-substitute',
          kind: 'shell-direct-artifact',
          status: 'present',
          ref: 'diagnostic:shell-direct-artifact-write',
          completionEvidence: true,
          userAcceptanceEligible: true,
          note: 'Negative fixture: shell-only artifact creation must be rejected.',
        },
      ]
    : [];

  return [...realScreenClaims, ...artifactClaims, ...substituteClaims];
}

function buildManifestInput(options: {
  runId: string;
  createdAt: string;
  profiles: VirtualAppScreenResearchProfile[];
  schedulingPlan: VirtualAppScreenResearchSchedulingPlan;
  artifactChains: VirtualAppScreenResearchArtifactChain[];
  evidenceClaims: VirtualAppScreenEvidenceClaim[];
  evidenceMode: VirtualAppScreenResearchEvidenceMode;
  aggregateRefsEligible: boolean;
}): VirtualAppScreenUserAcceptanceInput {
  const aggregateIsolationFlags = aggregateIsolationFlagsFor(options.profiles, options.evidenceMode);
  const artifactRefs = options.aggregateRefsEligible
    ? options.artifactChains.map((chain) => chain.artifactRef)
    : [];
  const verificationRefs = options.aggregateRefsEligible
    ? options.artifactChains.flatMap((chain) => chain.verifierRef ? [chain.verifierRef] : [])
    : [];
  const guiPresentRefs = options.aggregateRefsEligible
    ? options.artifactChains.flatMap((chain) => chain.guiPresentRef ? [chain.guiPresentRef] : [])
    : [];

  return {
    taskId: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID,
    scenarioId: 'virtual-app-screen-research-workflow-profile-contract',
    userIntent: researchWorkflowUserIntent(),
    targetAppRefs: options.profiles.map((profile) => profile.targetAppRef),
    targetWindowRefs: options.profiles.map((profile) => profile.targetWindowRef),
    sessionRefs: options.profiles.map((profile) => profile.sessionRef),
    adapterReadinessRefs: options.profiles.map((profile) => profile.adapterReadinessRef),
    adapterReadinessRecords: options.profiles.map((profile) => profile.adapterReadiness),
    screenFrameRefs: options.profiles.flatMap((profile) => profile.screenFrameRefs),
    inputIntentRefs: options.profiles.flatMap((profile) => profile.inputIntentRefs),
    executorEventRefs: options.profiles.flatMap((profile) => profile.executorEventRefs),
    beforeAfterFrameRefs: options.profiles.flatMap((profile) => profile.beforeAfterFrameRefs),
    annotationProposalRefs: options.profiles.flatMap((profile) => profile.annotationProposalRefs),
    artifactRefs,
    verificationRefs,
    guiPresentRefs,
    replayRef: `.sciforge/vision-runs/${options.runId}/research-workflow-replay.json`,
    evidenceLedgerRef: `.sciforge/vision-runs/${options.runId}/research-workflow-evidence-ledger.json`,
    isolationFlags: aggregateIsolationFlags,
    evidenceClaims: options.evidenceClaims,
    requiresHandoffReason: options.schedulingPlan.nonIsolatedSerialProfileIds.length
      ? `non-isolated profiles require serial user handoff: ${options.schedulingPlan.nonIsolatedSerialProfileIds.join(', ')}`
      : undefined,
    createdAt: options.createdAt,
    metadata: {
      workflowSchemaVersion: VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION,
      schedulingStrategy: options.schedulingPlan.strategy,
      diagnosticFixture: options.evidenceMode === 'fixture-diagnostic',
      requiredProfiles: REQUIRED_RESEARCH_SCREEN_PROFILE_IDS,
      requiredArtifactKinds: REQUIRED_RESEARCH_ARTIFACT_KINDS,
    },
  };
}

function validateProfileRefs(profiles: VirtualAppScreenResearchProfile[]): string[] {
  const issues: string[] = [];
  for (const profile of profiles) {
    const requiredSingles = [
      ['targetAppRef', profile.targetAppRef],
      ['targetWindowRef', profile.targetWindowRef],
      ['sessionRef', profile.sessionRef],
      ['adapterReadinessRef', profile.adapterReadinessRef],
      ['frameStreamRef', profile.frameStreamRef],
    ] as const;
    for (const [field, value] of requiredSingles) {
      if (!value) issues.push(`${profile.id} missing ${field}.`);
    }
    const requiredArrays = [
      ['screenFrameRefs', profile.screenFrameRefs],
      ['inputIntentRefs', profile.inputIntentRefs],
      ['executorEventRefs', profile.executorEventRefs],
      ['beforeAfterFrameRefs', profile.beforeAfterFrameRefs],
      ['annotationProposalRefs', profile.annotationProposalRefs],
    ] as const;
    for (const [field, refs] of requiredArrays) {
      if (!refs.length) issues.push(`${profile.id} missing ${field}.`);
    }
    if (!profile.adapterReadiness.schemaRefs.length) {
      issues.push(`${profile.id} adapter readiness missing schema refs.`);
    }
    if (profile.adapterReadiness.blockedReason && profile.blockedPolicy.status !== 'requires-handoff') {
      issues.push(`${profile.id} adapter readiness has blockedReason without requires-handoff policy.`);
    }
  }
  return issues;
}

function validateContributionBoundaries(
  profiles: VirtualAppScreenResearchProfile[],
  chains: VirtualAppScreenResearchArtifactChain[],
): string[] {
  const issues: string[] = [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const chain of chains) {
    const producer = profileById.get(chain.producerProfileId);
    if (!producer) {
      issues.push(`${chain.kind} producer profile ${chain.producerProfileId} is missing.`);
      continue;
    }
    if (!producer.contributionBoundary.mayProduceArtifactKinds.includes(chain.kind)) {
      issues.push(`${chain.producerProfileId} is not allowed to produce ${chain.kind}.`);
    }
    if (!producer.contributionBoundary.writableArtifactRefs.includes(chain.artifactRef)) {
      issues.push(`${chain.producerProfileId} does not own writable artifact ref ${chain.artifactRef}.`);
    }
    for (const sourceProfileId of chain.sourceProfileIds) {
      if (!profileById.has(sourceProfileId)) {
        issues.push(`${chain.kind} source profile ${sourceProfileId} is missing.`);
      }
    }
  }
  return issues;
}

function validateScheduling(
  schedulingPlan: VirtualAppScreenResearchSchedulingPlan,
  profiles: VirtualAppScreenResearchProfile[],
): string[] {
  const issues: string[] = [];
  const nonIsolated = profiles.filter((profile) => profile.blockedPolicy.status === 'requires-handoff');
  const nonIsolatedIds = new Set(nonIsolated.map((profile) => profile.id));
  if (nonIsolated.length && schedulingPlan.strategy !== 'non-isolated-serial') {
    issues.push('non-isolated profiles require non-isolated-serial scheduling.');
  }
  if (!nonIsolated.length && schedulingPlan.strategy !== 'isolated-parallel') {
    issues.push('fully isolated profiles should use isolated-parallel scheduling.');
  }
  for (const id of nonIsolatedIds) {
    if (!schedulingPlan.nonIsolatedSerialProfileIds.includes(id)) {
      issues.push(`${id} must be listed in nonIsolatedSerialProfileIds.`);
    }
    if (schedulingPlan.isolatedParallelProfileIds.includes(id)) {
      issues.push(`${id} cannot be listed in isolatedParallelProfileIds.`);
    }
  }
  return issues;
}

function sourceRefsForArtifact(
  sourceProfileIds: VirtualAppScreenResearchProfileId[],
  profileById: Map<VirtualAppScreenResearchProfileId, VirtualAppScreenResearchProfile>,
  runDirRef: string,
): string[] {
  return sourceProfileIds.flatMap((profileId) => {
    const profile = profileById.get(profileId);
    if (!profile) return [`${runDirRef}/artifact-source/${profileId}.json`];
    return [
      profile.sessionRef,
      ...profile.screenFrameRefs,
      ...profile.beforeAfterFrameRefs,
    ];
  });
}

function artifactFileName(kind: VirtualAppScreenResearchArtifactKind): string {
  switch (kind) {
    case 'report':
      return 'research-report.md';
    case 'notebook':
      return 'analysis.ipynb';
    case 'figure':
      return 'figure-1.png';
    case 'csv':
      return 'results.csv';
    case 'ppt':
      return 'summary.pptx';
    case 'docx':
      return 'research-report.docx';
    case 'log':
      return 'experiment.log';
  }
}

function isolationFlagsFor(
  nonIsolated: boolean,
  evidenceMode: VirtualAppScreenResearchEvidenceMode,
): Required<VirtualAppScreenIsolationFlags> {
  return {
    backgroundRenderable: !nonIsolated,
    affectsPhysicalDisplay: nonIsolated,
    requiresFocusSteal: nonIsolated,
    sharedSystemInputUsed: nonIsolated,
    physicalDisplayPopup: nonIsolated,
    systemPointerMoved: nonIsolated,
    systemKeyboardEventsSent: nonIsolated,
    diagnosticOnly: evidenceMode === 'fixture-diagnostic',
  };
}

function aggregateIsolationFlagsFor(
  profiles: VirtualAppScreenResearchProfile[],
  evidenceMode: VirtualAppScreenResearchEvidenceMode,
): Required<VirtualAppScreenIsolationFlags> {
  const nonIsolated = profiles.some((profile) => profile.blockedPolicy.status === 'requires-handoff');
  return isolationFlagsFor(nonIsolated, evidenceMode);
}

function rejectedSubstituteClaimKinds(
  claims: VirtualAppScreenEvidenceClaim[],
): VirtualAppScreenEvidenceClaimKind[] {
  const nonSubstitutes = new Set<VirtualAppScreenEvidenceClaimKind>([
    'dom',
    'playwright',
    'shell-direct-artifact',
    'accessibility',
    'package-smoke',
    'target-bound-fixture',
    'historical-docker-novnc',
    'single-click-smoke',
    'm6-native-multi-screen',
  ]);
  return [...new Set(claims
    .filter((claim) => nonSubstitutes.has(claim.kind) && (
      claim.completionEvidence === true || claim.userAcceptanceEligible === true
    ))
    .map((claim) => claim.kind))];
}

function fixtureBoundary(evidenceMode: VirtualAppScreenResearchEvidenceMode): VirtualAppScreenResearchWorkflowBundle['fixtureBoundary'] {
  return {
    diagnosticFixture: evidenceMode === 'fixture-diagnostic',
    fixtureCanClaimUserAcceptance: false,
    userAcceptanceRequires: [
      'real current-run VirtualAppScreen evidence for every required research screen profile',
      'adapter readiness proving app/window/session scoped background control',
      'frame refs, input intent refs, executor event refs, and before/after refs per screen',
      'isolated parallel scheduling or explicit blocked handoff for non-isolated screens',
      'artifact ref + verifier ref + gui.present ref for report, notebook, figure, CSV, PPT, DOCX, and log outputs',
      'no DOM, Playwright, shell-only, package-smoke, or historical fixture substitute claims marked as completion evidence',
    ],
  };
}

function researchWorkflowUserIntent(): string {
  return 'Coordinate Browser research, Terminal experiment, Notebook, Editor, PDF/reference, and CSV/table VirtualAppScreens to produce validated research artifacts.';
}

function normalizeRunId(runId: string): string {
  return runId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || DEFAULT_RUN_ID;
}

function isProfileId(value: string): value is VirtualAppScreenResearchProfileId {
  return (REQUIRED_RESEARCH_SCREEN_PROFILE_IDS as readonly string[]).includes(value);
}

interface CliArgs {
  outPath: string;
  inputPath?: string;
  evidenceMode?: VirtualAppScreenResearchEvidenceMode;
}

function parseArgs(argv: string[]): CliArgs {
  let outPath = '';
  let inputPath: string | undefined;
  let evidenceMode: VirtualAppScreenResearchEvidenceMode | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      outPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--input-json') {
      inputPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--evidence-mode') {
      const value = argv[index + 1] ?? '';
      if (value !== 'fixture-diagnostic' && value !== 'real-virtual-app-screen') {
        throw new Error(`Unsupported evidence mode: ${value}`);
      }
      evidenceMode = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen research workflow argument: ${arg}`);
  }
  return {
    outPath: outPath || join('.sciforge', 'vision-runs', `research-workflow-${Date.now()}`, 'workflow.json'),
    inputPath,
    evidenceMode,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = args.inputPath
    ? JSON.parse(await readFile(args.inputPath, 'utf8')) as VirtualAppScreenResearchWorkflowOptions
    : {};
  const bundle = await writeVirtualAppScreenResearchWorkflowBundle(args.outPath, {
    ...input,
    evidenceMode: args.evidenceMode ?? input.evidenceMode,
  });
  process.stdout.write(`[${bundle.validation.status}] wrote ${bundle.schemaVersion} to ${args.outPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
