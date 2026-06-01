import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVirtualAppScreenFirstScenarioBundle,
  type VirtualAppScreenFirstScenarioBundle,
  type VirtualAppScreenFirstScenarioRefs,
} from './virtual-app-screen-first-scenario.js';
import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  type VirtualAppScreenEvidenceClaim,
  type VirtualAppScreenReadinessRecord,
  type VirtualAppScreenUserAcceptanceInput,
  type VirtualAppScreenUserAcceptanceManifest,
} from '../virtual-app-screen-user-acceptance-manifest.js';

export const VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-local-smoke.v1' as const;

export const VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID = 'P2-CU-UA-OPERABILITY' as const;
export const VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID =
  'virtual-app-screen-local-operability-smoke' as const;

export type VirtualAppScreenLocalSmokeMode = 'diagnostic' | 'real-evidence';

export interface VirtualAppScreenLocalSmokeOptions {
  runId?: string;
  runDirRef?: string;
  createdAt?: string;
  runStartedAt?: string;
  mode?: VirtualAppScreenLocalSmokeMode;
  adapterAvailable?: boolean;
  permissionGranted?: boolean;
  includeGuiPresent?: boolean;
  includeBeforeAfter?: boolean;
  includeScreenFrames?: boolean;
  shellDirectArtifactWrite?: boolean;
  oldArtifact?: boolean;
}

export interface VirtualAppScreenLocalSmokeRefs extends VirtualAppScreenFirstScenarioRefs {
  attachAttemptRef: string;
  sessionPermissionRef: string;
  blockedDiagnosticRef: string;
}

export interface VirtualAppScreenLocalSmokeBlockedDiagnostic {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-blocked-diagnostic.v1';
  ref: string;
  ok: false;
  taskId: typeof VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID;
  scenarioId: typeof VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID;
  category:
    | 'adapter-unavailable'
    | 'permission-missing'
    | 'diagnostic-only'
    | 'real-evidence-incomplete'
    | 'shell-only-rejected';
  blockedReason: string;
  userAcceptanceEligible: false;
  diagnosticOnly: boolean;
  requiredRefs: string[];
  presentRefs: string[];
  nextActions: Array<{
    label: string;
    writesRepo: false;
  }>;
}

export interface VirtualAppScreenLocalSmokeBundle {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCHEMA_VERSION;
  taskId: typeof VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID;
  scenarioId: typeof VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID;
  userIntent: string;
  runId: string;
  runDirRef: string;
  createdAt: string;
  mode: VirtualAppScreenLocalSmokeMode;
  localSafety: {
    lowRisk: true;
    requiresExternalAccount: false;
    sendsExternalMessages: false;
    modifiesUserPhysicalDesktop: false;
    networkRequired: false;
  };
  refs: VirtualAppScreenLocalSmokeRefs;
  appSessionAttach: {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-attach.v1';
    ref: string;
    status: 'attached' | 'blocked';
    attemptMode: 'simulated' | 'real-evidence';
    targetAppRef: string;
    targetWindowRef: string;
    sessionRef: string;
    frameStreamRef: string;
    adapterReadinessRef: string;
    sessionPermissionRef: string;
    blockedDiagnosticRef?: string;
    blockedReasons: string[];
  };
  sessionPermission: {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-session-permission.v1';
    ref: string;
    status: 'granted' | 'missing';
    targetAppRef: string;
    targetWindowRef: string;
    sessionRef: string;
    allowLowRiskLocalActions: boolean;
    allowBackgroundAppControl: boolean;
    blockedReason?: string;
  };
  refsFirstFlow: {
    attachRef: string;
    frameRefs: string[];
    inputIntentRefs: string[];
    executorEventRefs: string[];
    beforeAfterFrameRefs: string[];
    annotationProposalRefs: string[];
    artifactRefs: string[];
    verificationRefs: string[];
    guiPresentRefs: string[];
    replayRef?: string;
    evidenceLedgerRef?: string;
  };
  firstScenario: VirtualAppScreenFirstScenarioBundle;
  blockedDiagnostic?: VirtualAppScreenLocalSmokeBlockedDiagnostic;
  manifestInput: VirtualAppScreenUserAcceptanceInput;
  manifest: VirtualAppScreenUserAcceptanceManifest;
}

const DEFAULT_RUN_ID = 'virtual-app-screen-local-smoke';
const DEFAULT_CREATED_AT = '2026-06-01T00:00:00.000Z';
const USER_INTENT =
  'Open a low-risk local app screen/session, perform a refs-first visible annotation flow, and produce a local research-note artifact.';

export function buildVirtualAppScreenLocalSmokeBundle(
  options: VirtualAppScreenLocalSmokeOptions = {},
): VirtualAppScreenLocalSmokeBundle {
  const runId = normalizeRunId(options.runId ?? DEFAULT_RUN_ID);
  const runDirRef = options.runDirRef ?? `.sciforge/vision-runs/${runId}`;
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const runStartedAt = options.runStartedAt ?? createdAt;
  const mode = options.mode ?? 'diagnostic';
  const firstScenario = buildVirtualAppScreenFirstScenarioBundle({
    runId,
    runDirRef,
    createdAt,
    runStartedAt,
    evidenceMode: mode === 'real-evidence' ? 'real-virtual-app-screen' : 'fixture-diagnostic',
    includeGuiPresent: options.includeGuiPresent,
    includeBeforeAfter: options.includeBeforeAfter,
    includeScreenFrames: options.includeScreenFrames,
    shellDirectArtifactWrite: options.shellDirectArtifactWrite,
    oldArtifact: options.oldArtifact,
  });
  const refs = localSmokeRefs(firstScenario.refs, runDirRef);
  const diagnostic = localSmokeBlockedDiagnostic({
    mode,
    refs,
    firstScenario,
    adapterAvailable: options.adapterAvailable === true,
    permissionGranted: options.permissionGranted === true,
  });
  const sessionPermission = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-session-permission.v1' as const,
    ref: refs.sessionPermissionRef,
    status: diagnostic?.category === 'permission-missing' ? 'missing' as const : 'granted' as const,
    targetAppRef: refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    sessionRef: refs.sessionRef,
    allowLowRiskLocalActions: diagnostic?.category !== 'permission-missing',
    allowBackgroundAppControl: diagnostic?.category !== 'permission-missing',
    blockedReason: diagnostic?.category === 'permission-missing' ? diagnostic.blockedReason : undefined,
  };
  const appSessionAttach = {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-attach.v1' as const,
    ref: refs.attachAttemptRef,
    status: diagnostic ? 'blocked' as const : 'attached' as const,
    attemptMode: mode === 'real-evidence' ? 'real-evidence' as const : 'simulated' as const,
    targetAppRef: refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    sessionRef: refs.sessionRef,
    frameStreamRef: refs.frameStreamRef,
    adapterReadinessRef: refs.adapterReadinessRef,
    sessionPermissionRef: refs.sessionPermissionRef,
    blockedDiagnosticRef: diagnostic?.ref,
    blockedReasons: diagnostic ? [diagnostic.blockedReason] : [],
  };
  const manifestInput = diagnostic && mode === 'diagnostic'
    ? diagnosticManifestInput({
        firstScenario,
        diagnostic,
        adapterAvailable: options.adapterAvailable === true,
      })
    : realEvidenceManifestInput(firstScenario, diagnostic);
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(manifestInput);
  manifest.validation = validateVirtualAppScreenUserAcceptanceManifest(manifest);

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCHEMA_VERSION,
    taskId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID,
    userIntent: USER_INTENT,
    runId,
    runDirRef,
    createdAt,
    mode,
    localSafety: {
      lowRisk: true,
      requiresExternalAccount: false,
      sendsExternalMessages: false,
      modifiesUserPhysicalDesktop: false,
      networkRequired: false,
    },
    refs,
    appSessionAttach,
    sessionPermission,
    refsFirstFlow: {
      attachRef: refs.attachAttemptRef,
      frameRefs: manifest.screenFrameRefs,
      inputIntentRefs: manifest.inputIntentRefs,
      executorEventRefs: manifest.executorEventRefs,
      beforeAfterFrameRefs: manifest.beforeAfterFrameRefs,
      annotationProposalRefs: manifest.annotationProposalRefs,
      artifactRefs: manifest.artifactRefs,
      verificationRefs: manifest.verificationRefs,
      guiPresentRefs: manifest.guiPresentRefs,
      replayRef: manifest.replayRef,
      evidenceLedgerRef: manifest.evidenceLedgerRef,
    },
    firstScenario,
    blockedDiagnostic: diagnostic,
    manifestInput,
    manifest,
  };
}

export async function writeVirtualAppScreenLocalSmokeBundle(
  outDir: string,
  options: VirtualAppScreenLocalSmokeOptions = {},
): Promise<VirtualAppScreenLocalSmokeBundle> {
  const bundle = buildVirtualAppScreenLocalSmokeBundle(options);
  const records: Array<[string, unknown]> = [
    ['local-smoke-bundle.json', bundle],
    ['virtual-app-screen-user-acceptance-input.json', bundle.manifestInput],
    ['virtual-app-screen-user-acceptance-manifest.json', bundle.manifest],
    [bundle.refs.attachAttemptRef, bundle.appSessionAttach],
    [bundle.refs.sessionPermissionRef, bundle.sessionPermission],
    [bundle.refs.sourceRef, bundle.firstScenario.records.source],
    [bundle.refs.frameStreamRef, bundle.firstScenario.records.frameStream],
    [bundle.refs.userCursorRef, bundle.firstScenario.records.userCursor],
    [bundle.refs.agentCursorRef, bundle.firstScenario.records.agentCursor],
    [bundle.refs.adapterReadinessRef, bundle.manifest.adapterReadinessRecords[0] ?? bundle.firstScenario.adapterReadiness],
    [bundle.refs.annotationOverlayRef, bundle.firstScenario.records.annotationOverlay],
    [bundle.refs.annotationProposalRef, bundle.firstScenario.records.annotationProposal],
    [bundle.refs.inputIntentRef, bundle.firstScenario.records.inputIntent],
    [bundle.refs.executorEventRef, bundle.firstScenario.records.executorEvent],
    [bundle.refs.artifactValidationRef, bundle.firstScenario.artifactValidation],
    [bundle.refs.replayRef, bundle.firstScenario.records.replay],
    [bundle.refs.evidenceLedgerRef, bundle.firstScenario.records.evidenceLedger],
  ];
  if (bundle.firstScenario.records.beforeFrame) {
    records.push([bundle.refs.beforeFrameRef, bundle.firstScenario.records.beforeFrame]);
  }
  if (bundle.firstScenario.records.afterFrame) {
    records.push([bundle.refs.afterFrameRef, bundle.firstScenario.records.afterFrame]);
  }
  if (bundle.firstScenario.records.beforeAfter) {
    records.push([bundle.refs.beforeAfterRef, bundle.firstScenario.records.beforeAfter]);
  }
  if (bundle.firstScenario.records.guiPresent) {
    records.push([bundle.refs.guiPresentRef, bundle.firstScenario.records.guiPresent]);
  }
  if (bundle.blockedDiagnostic) {
    records.push([bundle.refs.blockedDiagnosticRef, bundle.blockedDiagnostic]);
  }

  await mkdir(outDir, { recursive: true });
  for (const [ref, data] of records) {
    await writeJsonRef(outDir, bundle.runDirRef, ref, data);
  }
  await writeTextRef(
    outDir,
    bundle.runDirRef,
    bundle.refs.artifactRef,
    `${bundle.firstScenario.artifact.content}\n`,
  );
  return bundle;
}

function localSmokeRefs(
  firstScenarioRefs: VirtualAppScreenFirstScenarioRefs,
  runDirRef: string,
): VirtualAppScreenLocalSmokeRefs {
  return {
    ...firstScenarioRefs,
    attachAttemptRef: `${runDirRef}/app-session-attach.json`,
    sessionPermissionRef: `${runDirRef}/session-permission.json`,
    blockedDiagnosticRef: `${runDirRef}/blocked-diagnostic.json`,
  };
}

function localSmokeBlockedDiagnostic(options: {
  mode: VirtualAppScreenLocalSmokeMode;
  refs: VirtualAppScreenLocalSmokeRefs;
  firstScenario: VirtualAppScreenFirstScenarioBundle;
  adapterAvailable: boolean;
  permissionGranted: boolean;
}): VirtualAppScreenLocalSmokeBlockedDiagnostic | undefined {
  const presentRefs = presentRefsFromScenario(options.firstScenario);
  if (options.mode === 'diagnostic') {
    if (!options.adapterAvailable) {
      return blockedDiagnostic({
        refs: options.refs,
        category: 'adapter-unavailable',
        diagnosticOnly: true,
        blockedReason: [
          'No real background VirtualAppScreen adapter was declared for this local app/session attach attempt.',
          'The smoke wrote refs-first diagnostic records only and cannot claim user-level acceptance.',
        ].join(' '),
        presentRefs,
      });
    }
    if (!options.permissionGranted) {
      return blockedDiagnostic({
        refs: options.refs,
        category: 'permission-missing',
        diagnosticOnly: true,
        blockedReason: [
          'VirtualAppScreen local app/session permission is missing for background app control.',
          'The smoke did not execute a real adapter action and cannot claim user-level acceptance.',
        ].join(' '),
        presentRefs,
      });
    }
    return blockedDiagnostic({
      refs: options.refs,
      category: 'diagnostic-only',
      diagnosticOnly: true,
      blockedReason: [
        'Diagnostic mode only simulates the low-risk local app/session refs-first flow.',
        'Run --mode real-evidence with complete current VirtualAppScreen evidence before userAcceptanceEligible can be true.',
      ].join(' '),
      presentRefs,
    });
  }

  if (options.firstScenario.manifest.userAcceptanceEligible) return undefined;
  const rejectedShellOnly = options.firstScenario.manifest.validation.rejectedClaimKinds.includes('shell-direct-artifact');
  return blockedDiagnostic({
    refs: options.refs,
    category: rejectedShellOnly ? 'shell-only-rejected' : 'real-evidence-incomplete',
    diagnosticOnly: false,
    blockedReason: options.firstScenario.manifest.blockedReason
      ?? 'Real VirtualAppScreen evidence mode did not include all required refs.',
    presentRefs,
  });
}

function diagnosticManifestInput(options: {
  firstScenario: VirtualAppScreenFirstScenarioBundle;
  diagnostic: VirtualAppScreenLocalSmokeBlockedDiagnostic;
  adapterAvailable: boolean;
}): VirtualAppScreenUserAcceptanceInput {
  const adapterReadiness = diagnosticAdapterReadiness(options);
  const evidenceClaims: VirtualAppScreenEvidenceClaim[] = [
    {
      id: 'local-smoke-diagnostic-boundary',
      kind: 'target-bound-fixture',
      status: 'diagnostic-only',
      ref: options.diagnostic.ref,
      evidenceRefs: options.diagnostic.presentRefs,
      userAcceptanceEligible: false,
      note: options.diagnostic.blockedReason,
    },
    {
      id: 'local-smoke-adapter-readiness',
      kind: 'adapter-readiness',
      status: 'blocked',
      ref: options.firstScenario.refs.adapterReadinessRef,
      note: adapterReadiness.blockedReason ?? options.diagnostic.blockedReason,
    },
  ];

  return {
    ...options.firstScenario.manifestInput,
    taskId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID,
    userIntent: USER_INTENT,
    adapterReadinessRecords: [adapterReadiness],
    isolationFlags: {
      ...options.firstScenario.manifestInput.isolationFlags,
      diagnosticOnly: true,
    },
    evidenceClaims,
    blockedReason: options.diagnostic.blockedReason,
    metadata: {
      ...options.firstScenario.manifestInput.metadata,
      localSmokeSchemaVersion: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCHEMA_VERSION,
      blockedDiagnosticRef: options.diagnostic.ref,
      blockedDiagnosticCategory: options.diagnostic.category,
    },
  };
}

function realEvidenceManifestInput(
  firstScenario: VirtualAppScreenFirstScenarioBundle,
  diagnostic: VirtualAppScreenLocalSmokeBlockedDiagnostic | undefined,
): VirtualAppScreenUserAcceptanceInput {
  return {
    ...firstScenario.manifestInput,
    taskId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID,
    userIntent: USER_INTENT,
    blockedReason: diagnostic?.blockedReason ?? firstScenario.manifestInput.blockedReason,
    metadata: {
      ...firstScenario.manifestInput.metadata,
      localSmokeSchemaVersion: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCHEMA_VERSION,
      explicitRealEvidenceMode: true,
      blockedDiagnosticRef: diagnostic?.ref,
      blockedDiagnosticCategory: diagnostic?.category,
    },
  };
}

function diagnosticAdapterReadiness(options: {
  firstScenario: VirtualAppScreenFirstScenarioBundle;
  diagnostic: VirtualAppScreenLocalSmokeBlockedDiagnostic;
  adapterAvailable: boolean;
}): VirtualAppScreenReadinessRecord {
  if (options.diagnostic.category === 'adapter-unavailable') {
    return {
      adapterKind: 'unavailable-local-app-screen-adapter',
      targetScope: 'window',
      supportedActions: [],
      captureSupported: false,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      blockedReason: options.diagnostic.blockedReason,
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    };
  }
  if (options.diagnostic.category === 'permission-missing') {
    return {
      ...options.firstScenario.adapterReadiness,
      blockedReason: options.diagnostic.blockedReason,
    };
  }
  return {
    ...options.firstScenario.adapterReadiness,
    blockedReason: options.adapterAvailable ? null : options.diagnostic.blockedReason,
  };
}

function blockedDiagnostic(options: {
  refs: VirtualAppScreenLocalSmokeRefs;
  category: VirtualAppScreenLocalSmokeBlockedDiagnostic['category'];
  diagnosticOnly: boolean;
  blockedReason: string;
  presentRefs: string[];
}): VirtualAppScreenLocalSmokeBlockedDiagnostic {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-local-smoke-blocked-diagnostic.v1',
    ref: options.refs.blockedDiagnosticRef,
    ok: false,
    taskId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_LOCAL_SMOKE_SCENARIO_ID,
    category: options.category,
    blockedReason: options.blockedReason,
    userAcceptanceEligible: false,
    diagnosticOnly: options.diagnosticOnly,
    requiredRefs: [
      'targetAppRefs',
      'targetWindowRefs',
      'sessionRefs',
      'adapterReadinessRefs',
      'screenFrameRefs',
      'inputIntentRefs',
      'executorEventRefs',
      'beforeAfterFrameRefs',
      'annotationProposalRefs',
      'artifactRefs',
      'verificationRefs',
      'guiPresentRefs',
      'replayRef',
      'evidenceLedgerRef',
    ],
    presentRefs: options.presentRefs,
    nextActions: [
      {
        label: 'Provide a real app/window/session scoped VirtualAppScreen adapter with background rendering readiness.',
        writesRepo: false,
      },
      {
        label: 'Grant explicit low-risk local app/session permission, then rerun with --mode real-evidence and complete refs.',
        writesRepo: false,
      },
    ],
  };
}

function presentRefsFromScenario(bundle: VirtualAppScreenFirstScenarioBundle): string[] {
  return uniqueRefs([
    bundle.refs.targetAppRef,
    bundle.refs.targetWindowRef,
    bundle.refs.sessionRef,
    bundle.refs.adapterReadinessRef,
    ...bundle.manifest.screenFrameRefs,
    ...bundle.manifest.inputIntentRefs,
    ...bundle.manifest.executorEventRefs,
    ...bundle.manifest.beforeAfterFrameRefs,
    ...bundle.manifest.annotationProposalRefs,
    ...bundle.manifest.artifactRefs,
    ...bundle.manifest.verificationRefs,
    ...bundle.manifest.guiPresentRefs,
    bundle.manifest.replayRef,
    bundle.manifest.evidenceLedgerRef,
  ]);
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

interface CliArgs extends VirtualAppScreenLocalSmokeOptions {
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
    if (arg === '--mode') {
      const mode = argv[index + 1] ?? '';
      if (mode !== 'diagnostic' && mode !== 'real-evidence') {
        throw new Error('--mode must be diagnostic or real-evidence');
      }
      args.mode = mode;
      index += 1;
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen local smoke argument: ${arg}`);
  }
  if (!args.outDir) throw new Error('--out-dir must not be empty');
  return args;
}

async function main(): Promise<void> {
  const { outDir, ...options } = parseArgs(process.argv.slice(2));
  const bundle = await writeVirtualAppScreenLocalSmokeBundle(outDir, options);
  const diagnostic = bundle.blockedDiagnostic
    ? ` blockedReason="${bundle.blockedDiagnostic.blockedReason}"`
    : '';
  process.stdout.write(
    `[${bundle.manifest.status}] wrote ${bundle.schemaVersion} to ${outDir}; `
      + `mode=${bundle.mode} diagnosticOnly=${bundle.manifest.diagnosticOnly} `
      + `userAcceptanceEligible=${bundle.manifest.userAcceptanceEligible}${diagnostic}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
