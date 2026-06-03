import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS,
  RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
  RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
  buildBlockedRightPaneNativeOsUiRunSkeleton,
  missingBrowserHostActionChannel,
  validateRightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiActionLedger,
  type RightPaneNativeOsUiActionLedgerEntry,
  type RightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiPartialProofLedger,
  type RightPaneNativeOsUiPartialProofLedgerEntry,
  type RightPaneNativeOsUiProofGroup,
} from '../src/desktop/right-pane-native-os-ui-run-contract.js';

export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE' as const;
export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON' as const;
export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND' as const;
export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON' as const;
export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE' as const;
export const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON' as const;

const execFileAsync = promisify(execFile);

type EnvRecord = Record<string, string | undefined>;

type MacosObserverOptions = {
  env?: EnvRecord;
  now?: string;
  browserHostSessionRef?: string;
  liveSurfaceRef?: string;
  platform?: NodeJS.Platform;
  observerTimeoutMs?: number;
};

const DEFAULT_BROWSER_HOST_SESSION_REF = 'browser-host-session:right-pane-native-os-ui-macos-observer';
const DEFAULT_LIVE_SURFACE_REF = `${DEFAULT_BROWSER_HOST_SESSION_REF}/live-surface`;
const MAX_JSON_BYTES = 96_000;
const DEFAULT_OBSERVER_TIMEOUT_MS = 10_000;
const DEFAULT_BUILT_IN_DIAGNOSTIC_TIMEOUT_MS = 2_000;
const TRUSTED_MACOS_ACCESSIBILITY_HELPER_REF = 'tools/right-pane-native-os-ui-macos-accessibility-helper.ts';
const TRUSTED_MACOS_ACCESSIBILITY_HELPER_BASENAME = 'right-pane-native-os-ui-macos-accessibility-helper.ts';
const TRUSTED_TSX_BIN_REF = 'node_modules/.bin/tsx';
const PROOF_GROUP_AREAS = {
  cursorCaret: 'cursor-caret',
  mouseContextMenu: 'mouse-context-menu',
  keyboardImeClipboardSelection: 'keyboard-ime-clipboard-selection',
  rerenderFocus: 'rerender-focus',
} as const;

export async function runRightPaneNativeOsUiMacosObserver(
  options: MacosObserverOptions = {},
): Promise<RightPaneNativeOsUiRunManifest> {
  const env = options.env ?? process.env;
  const observedAt = options.now ?? new Date().toISOString();
  const refs = {
    browserHostSessionRef: options.browserHostSessionRef ?? DEFAULT_BROWSER_HOST_SESSION_REF,
    liveSurfaceRef: options.liveSurfaceRef ?? DEFAULT_LIVE_SURFACE_REF,
  };

  if (env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE] !== '1') {
    return buildMissingEnvBlockedManifest(refs, observedAt, [
      SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE,
      SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON,
      SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND,
    ]);
  }
  if ((options.platform ?? process.platform) !== 'darwin') {
    return buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  }

  const evidenceJson = env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON];
  const observerCommand = env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND];
  if (!evidenceJson && !observerCommand) {
    const diagnostic = await runBuiltInMacosAccessibilityDiagnosticProbe(
      options.observerTimeoutMs ?? DEFAULT_BUILT_IN_DIAGNOSTIC_TIMEOUT_MS,
    );
    return buildBuiltInObserverDiagnosticManifest(refs, observedAt, diagnostic);
  }

  if (evidenceJson) {
    parseBoundedJson(evidenceJson);
    return buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  }

  const evidence = await runObserverCommand(env, options.observerTimeoutMs ?? DEFAULT_OBSERVER_TIMEOUT_MS);
  const observerArgs = parseArgs(env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]);
  const trustedHelper = isTrustedMacosAccessibilityHelperCommand(observerCommand, observerArgs, env);
  if (trustedHelper) {
    assertNoForbiddenInlineEvidence(evidence);
    const manifest = buildMacosAccessibilityManifest(evidence, refs, observedAt);
    if (manifest && safeValidate(manifest).canClaimPass && hasNoForbiddenInlineEvidence(manifest)) {
      return manifest;
    }
    return buildTrustedHelperProofIncompleteManifest(refs, observedAt, evidence);
  }
  if (isMacosAccessibilityObserver(evidence)) {
    return buildTrustedHelperProvenanceBlockedManifest(refs, observedAt);
  }
  if (isMacosAccessibilityMetadataProbe(evidence)) {
    return buildIncompleteProofBlockedManifest(refs, observedAt);
  }
  assertNoForbiddenInlineEvidence(evidence);
  return buildIncompleteProofBlockedManifest(refs, observedAt);
}

async function runObserverCommand(env: EnvRecord, timeoutMs: number): Promise<unknown> {
  const command = env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND];
  assert.ok(command, 'macOS OS UI observer command is missing');
  const args = parseArgs(env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]);
  const { stdout } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: MAX_JSON_BYTES,
    env: boundedObserverCommandEnv(env),
  });
  return parseBoundedJson(stdout);
}

type BuiltInMacosAccessibilityDiagnosticProbe = {
  result:
    | 'system-events-accessibility-enabled'
    | 'system-events-accessibility-disabled'
    | 'system-events-unavailable'
    | 'system-events-unexpected-output';
  detailToken?: string;
};

async function runBuiltInMacosAccessibilityDiagnosticProbe(
  timeoutMs: number,
): Promise<BuiltInMacosAccessibilityDiagnosticProbe> {
  const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, DEFAULT_BUILT_IN_DIAGNOSTIC_TIMEOUT_MS));
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to return UI elements enabled',
    ], {
      timeout: boundedTimeoutMs,
      maxBuffer: 512,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
      },
    });
    const value = stdout.trim().toLowerCase();
    if (value === 'true') {
      return { result: 'system-events-accessibility-enabled' };
    }
    if (value === 'false') {
      return { result: 'system-events-accessibility-disabled' };
    }
    return {
      result: 'system-events-unexpected-output',
      detailToken: boundedHashToken(value),
    };
  } catch (error) {
    return {
      result: 'system-events-unavailable',
      detailToken: boundedErrorToken(error),
    };
  }
}

function buildMacosAccessibilityManifest(
  value: unknown,
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
): RightPaneNativeOsUiRunManifest | undefined {
  const raw = record(value);
  if (raw.source !== 'macos-accessibility-observer') return undefined;
  const runId = boundedToken(raw.runId);
  if (!runId) return undefined;
  const groups = record(raw.proofGroups);
  const cursorCaret = proofGroup(runId, 'cursorCaret', groups.cursorCaret);
  const mouseContextMenu = proofGroup(runId, 'mouseContextMenu', groups.mouseContextMenu);
  const keyboardImeClipboardSelection = proofGroup(runId, 'keyboardImeClipboardSelection', groups.keyboardImeClipboardSelection);
  const rerenderFocus = proofGroup(runId, 'rerenderFocus', groups.rerenderFocus);
  if (!cursorCaret || !mouseContextMenu || !keyboardImeClipboardSelection || !rerenderFocus) return undefined;
  const proofGroups = {
    cursorCaret,
    mouseContextMenu,
    keyboardImeClipboardSelection,
    rerenderFocus,
  };
  const actions = actionLedger(raw.actionLedger, runId, refs);
  return {
    schemaVersion: RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
    status: 'passed',
    passClaim: true,
    runner: 'right-pane-native-os-ui-run',
    source: 'real-product-os-ui-run',
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: refs.browserHostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    observedAt,
    refsFirst: true,
    boundedEvidenceOnly: true,
    osObserver: {
      status: 'available',
      observerRef: `real-product-os-ui-run:${runId}/macos-accessibility-observer`,
      observerKind: 'macos-accessibility',
    },
    browserHostActionChannel: missingBrowserHostActionChannel(),
    osUiRun: {
      runRef: `real-product-os-ui-run:${runId}/run`,
      auditRefs: Object.values(proofGroups).flatMap((group) => group.auditRefs),
      browserHostSessionRef: refs.browserHostSessionRef,
      liveSurfaceRef: refs.liveSurfaceRef,
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
    proofGroups,
    ...(actions ? { actionLedger: actions } : {}),
    capturePolicy: {
      screenshotUsedAsProof: false,
      frameStreamUsedAsProof: false,
      rawDomUsedAsProof: false,
      rawClipboardPayloadUsedAsProof: false,
      rawSelectionTextRecorded: false,
      rawImePayloadRecorded: false,
      rawContextMenuPayloadRecorded: false,
    },
    forbiddenSubstitutes: {
      screenshot: false,
      frameStream: false,
      rawDom: false,
      rawClipboardPayload: false,
      systemPopup: false,
      secondBrowserOwner: false,
    },
  };
}

function isMacosAccessibilityMetadataProbe(value: unknown): boolean {
  return record(value).source === 'macos-accessibility-metadata-probe';
}

function isMacosAccessibilityObserver(value: unknown): boolean {
  return record(value).source === 'macos-accessibility-observer';
}

function buildIncompleteProofBlockedManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
): RightPaneNativeOsUiRunManifest {
  const blocked = buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  return {
    ...blocked,
    blocker: 'native-os-ui-proof-incomplete',
    source: 'contract-fixture',
  };
}

function buildBuiltInObserverDiagnosticManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
  diagnostic: BuiltInMacosAccessibilityDiagnosticProbe,
): RightPaneNativeOsUiRunManifest {
  const blocked = buildIncompleteProofBlockedManifest(refs, observedAt);
  return {
    ...blocked,
    proofGroups: {
      cursorCaret: builtInObserverDiagnosticGroup(refs, 'cursorCaret', diagnostic),
      mouseContextMenu: builtInObserverDiagnosticGroup(refs, 'mouseContextMenu', diagnostic),
      keyboardImeClipboardSelection: builtInObserverDiagnosticGroup(refs, 'keyboardImeClipboardSelection', diagnostic),
      rerenderFocus: builtInObserverDiagnosticGroup(refs, 'rerenderFocus', diagnostic),
    },
  };
}

function buildTrustedHelperProofIncompleteManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
  evidence?: unknown,
): RightPaneNativeOsUiRunManifest {
  const manifest = buildObserverProvenanceDiagnosticManifest(refs, observedAt, 'trusted-helper-proof-incomplete');
  const raw = record(evidence);
  if (raw.source !== 'macos-accessibility-observer') return manifest;
  const runId = boundedToken(raw.runId);
  if (!runId) return manifest;
  const groups = record(raw.proofGroups);
  const ledger = partialProofLedger(raw.partialProofLedger, runId);
  const actions = actionLedger(raw.actionLedger, runId, refs);
  return {
    ...manifest,
    ...(ledger ? { partialProofLedger: ledger } : {}),
    ...(actions ? { actionLedger: actions } : {}),
    proofGroups: {
      cursorCaret: mergeBlockedPartialProofGroup(manifest.proofGroups.cursorCaret, proofGroup(runId, 'cursorCaret', groups.cursorCaret)),
      mouseContextMenu: mergeBlockedPartialProofGroup(manifest.proofGroups.mouseContextMenu, proofGroup(runId, 'mouseContextMenu', groups.mouseContextMenu)),
      keyboardImeClipboardSelection: mergeBlockedPartialProofGroup(
        manifest.proofGroups.keyboardImeClipboardSelection,
        proofGroup(runId, 'keyboardImeClipboardSelection', groups.keyboardImeClipboardSelection),
      ),
      rerenderFocus: mergeBlockedPartialProofGroup(manifest.proofGroups.rerenderFocus, proofGroup(runId, 'rerenderFocus', groups.rerenderFocus)),
    },
  };
}

function actionLedger(
  value: unknown,
  runId: string,
  refs: { liveSurfaceRef: string },
): RightPaneNativeOsUiActionLedger | undefined {
  const raw = record(value);
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = rawEntries
    .map((entry) => actionLedgerEntry(entry, runId, refs))
    .filter((entry): entry is RightPaneNativeOsUiActionLedgerEntry => Boolean(entry));
  return entries.length > 0 ? { entries } : undefined;
}

function actionLedgerEntry(
  value: unknown,
  runId: string,
  refs: { liveSurfaceRef: string },
): RightPaneNativeOsUiActionLedgerEntry | undefined {
  const entry = record(value);
  const proofGroup = proofGroupName(entry.proofGroup);
  const actionId = boundedToken(entry.actionId);
  if (!proofGroup || actionId !== RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS[proofGroup]) return undefined;
  const area = PROOF_GROUP_AREAS[proofGroup];
  const evidenceTokenRef = stringField(entry.evidenceTokenRef);
  const expectedPrefix = `macos-accessibility-observer/${runId}/${area}/${actionId}/`;
  if (evidenceTokenRef && !evidenceTokenRef.startsWith(expectedPrefix)) return undefined;
  const observedProofNames = boundedProofNames(entry.observedProofNames);
  const expectedProofNames = boundedProofNames(entry.expectedProofNames);
  const latencyMs = boundedLatencyMs(entry.latencyMs);
  const requiredProofNames = RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES[proofGroup];
  const status = requiredProofNames.every((name) => observedProofNames.includes(name))
    ? 'passed'
    : observedProofNames.length > 0
      ? 'partial'
      : 'blocked';
  return {
    status,
    proofGroup,
    actionId,
    actionRef: `real-product-os-ui-action:${runId}/${area}/${actionId}`,
    targetSurfaceRef: refs.liveSurfaceRef,
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    expectedProofNames,
    observedProofNames,
    evidenceTokenRef: evidenceTokenRef ?? `macos-accessibility-observer/${runId}/${area}/${actionId}/bounded-action-ledger`,
    rawPayloadRecorded: false,
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
}

function proofGroupName(value: unknown): keyof typeof PROOF_GROUP_AREAS | undefined {
  return value === 'cursorCaret'
    || value === 'mouseContextMenu'
    || value === 'keyboardImeClipboardSelection'
    || value === 'rerenderFocus'
    ? value
    : undefined;
}

function partialProofLedger(value: unknown, runId: string): RightPaneNativeOsUiPartialProofLedger | undefined {
  const ledger = record(value);
  if (Object.keys(ledger).length === 0) return undefined;
  const cursorCaret = partialProofLedgerEntry(ledger.cursorCaret, runId, 'cursorCaret');
  const mouseContextMenu = partialProofLedgerEntry(ledger.mouseContextMenu, runId, 'mouseContextMenu');
  const keyboardImeClipboardSelection = partialProofLedgerEntry(
    ledger.keyboardImeClipboardSelection,
    runId,
    'keyboardImeClipboardSelection',
  );
  const rerenderFocus = partialProofLedgerEntry(ledger.rerenderFocus, runId, 'rerenderFocus');
  if (!cursorCaret && !mouseContextMenu && !keyboardImeClipboardSelection && !rerenderFocus) return undefined;
  return {
    cursorCaret: cursorCaret ?? emptyPartialProofLedgerEntry(runId, 'cursorCaret'),
    mouseContextMenu: mouseContextMenu ?? emptyPartialProofLedgerEntry(runId, 'mouseContextMenu'),
    keyboardImeClipboardSelection: keyboardImeClipboardSelection ?? emptyPartialProofLedgerEntry(runId, 'keyboardImeClipboardSelection'),
    rerenderFocus: rerenderFocus ?? emptyPartialProofLedgerEntry(runId, 'rerenderFocus'),
  };
}

function partialProofLedgerEntry(
  value: unknown,
  runId: string,
  groupName: keyof typeof PROOF_GROUP_AREAS,
): RightPaneNativeOsUiPartialProofLedgerEntry | undefined {
  const entry = record(value);
  const observedProofNames = boundedProofNames(entry.observedProofNames);
  const proofCandidateCount = boundedCount(entry.proofCandidateCount);
  const area = PROOF_GROUP_AREAS[groupName];
  const evidenceTokenRef = stringField(entry.evidenceTokenRef);
  const expectedPrefix = `macos-accessibility-observer/${runId}/${area}/`;
  if (evidenceTokenRef && !evidenceTokenRef.startsWith(expectedPrefix)) return undefined;
  const latencyMs = boundedLatencyMs(entry.latencyMs);
  return {
    status: observedProofNames.length > 0 ? 'partial' : 'not-observed',
    observerKind: 'macos-accessibility',
    proofCandidateCount: observedProofNames.length > 0 ? observedProofNames.length : proofCandidateCount,
    observedProofNames,
    evidenceTokenRef: evidenceTokenRef ?? `macos-accessibility-observer/${runId}/${area}/bounded-partial-ledger`,
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
}

function emptyPartialProofLedgerEntry(
  runId: string,
  groupName: keyof typeof PROOF_GROUP_AREAS,
): RightPaneNativeOsUiPartialProofLedgerEntry {
  const area = PROOF_GROUP_AREAS[groupName];
  return {
    status: 'not-observed',
    observerKind: 'macos-accessibility',
    proofCandidateCount: 0,
    observedProofNames: [],
    evidenceTokenRef: `macos-accessibility-observer/${runId}/${area}/bounded-partial-ledger`,
  };
}

function buildTrustedHelperProvenanceBlockedManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
): RightPaneNativeOsUiRunManifest {
  return buildObserverProvenanceDiagnosticManifest(refs, observedAt, 'trusted-helper-provenance-missing');
}

function buildObserverProvenanceDiagnosticManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
  diagnostic: 'trusted-helper-proof-incomplete' | 'trusted-helper-provenance-missing',
): RightPaneNativeOsUiRunManifest {
  const blocked = buildIncompleteProofBlockedManifest(refs, observedAt);
  return {
    ...blocked,
    proofGroups: {
      cursorCaret: observerProvenanceDiagnosticGroup(refs, 'cursorCaret', diagnostic),
      mouseContextMenu: observerProvenanceDiagnosticGroup(refs, 'mouseContextMenu', diagnostic),
      keyboardImeClipboardSelection: observerProvenanceDiagnosticGroup(refs, 'keyboardImeClipboardSelection', diagnostic),
      rerenderFocus: observerProvenanceDiagnosticGroup(refs, 'rerenderFocus', diagnostic),
    },
  };
}

function observerProvenanceDiagnosticGroup(
  refs: { browserHostSessionRef: string },
  groupName: keyof typeof PROOF_GROUP_AREAS,
  diagnostic: 'trusted-helper-proof-incomplete' | 'trusted-helper-provenance-missing',
): RightPaneNativeOsUiProofGroup {
  const area = PROOF_GROUP_AREAS[groupName];
  return {
    status: 'blocked',
    proofRefs: [`${refs.browserHostSessionRef}/right-pane-native-os-ui-run/${area}/macos-accessibility-observer/${diagnostic}`],
    auditRefs: [`${refs.browserHostSessionRef}/right-pane-native-os-ui-run/${area}/macos-accessibility-observer/${diagnostic}/audit`],
  };
}

function mergeBlockedPartialProofGroup(
  diagnosticGroup: RightPaneNativeOsUiProofGroup,
  partialGroup: RightPaneNativeOsUiProofGroup | undefined,
): RightPaneNativeOsUiProofGroup {
  if (!partialGroup) return diagnosticGroup;
  return {
    status: 'blocked',
    proofRefs: uniqueRefs([...partialGroup.proofRefs, ...diagnosticGroup.proofRefs]),
    auditRefs: uniqueRefs([...partialGroup.auditRefs, ...diagnosticGroup.auditRefs]),
  };
}

function uniqueRefs(refs: string[]): string[] {
  return refs.filter((ref, index) => refs.indexOf(ref) === index);
}

function builtInObserverDiagnosticGroup(
  refs: { browserHostSessionRef: string },
  groupName: keyof typeof PROOF_GROUP_AREAS,
  diagnostic: BuiltInMacosAccessibilityDiagnosticProbe,
): RightPaneNativeOsUiProofGroup {
  const area = PROOF_GROUP_AREAS[groupName];
  const resultRef = diagnostic.detailToken
    ? `${diagnostic.result}/${diagnostic.detailToken}`
    : diagnostic.result;
  return {
    status: 'blocked',
    proofRefs: [`${refs.browserHostSessionRef}/right-pane-native-os-ui-run/${area}/macos-accessibility-observer/diagnostic-probe/${resultRef}`],
    auditRefs: [`${refs.browserHostSessionRef}/right-pane-native-os-ui-run/${area}/macos-accessibility-observer/diagnostic-probe/${resultRef}/audit`],
  };
}

function proofGroup(
  runId: string,
  groupName: keyof typeof PROOF_GROUP_AREAS,
  value: unknown,
): RightPaneNativeOsUiProofGroup | undefined {
  if (!Array.isArray(value)) return undefined;
  const proofNames = value.map((entry) => boundedToken(entry)).filter((entry): entry is string => Boolean(entry));
  if (proofNames.length !== value.length || proofNames.length === 0) return undefined;
  const area = PROOF_GROUP_AREAS[groupName];
  return {
    status: 'passed',
    proofRefs: proofNames.map((name) => `real-product-os-ui-run:${runId}/${area}/${name}`),
    auditRefs: proofNames.map((name) => `real-product-os-ui-audit:${runId}/${area}/${name}`),
  };
}

function boundedToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value)) return undefined;
  if (forbiddenInlineString(value)) return undefined;
  return value;
}

function boundedProofNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => boundedToken(entry)).filter((entry): entry is string => Boolean(entry)))];
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(1_000, Math.floor(value))
    : 0;
}

function boundedLatencyMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(30_000, Math.floor(value))
    : undefined;
}

function buildMissingEnvBlockedManifest(
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
  envNames: string[],
): RightPaneNativeOsUiRunManifest {
  const blocked = buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  const missingEnvRefs = envNames.map((name) => `${refs.browserHostSessionRef}/right-pane-native-os-ui-run/missing-env/${name}`);
  return {
    ...blocked,
    proofGroups: {
      ...blocked.proofGroups,
      cursorCaret: {
        ...blocked.proofGroups.cursorCaret,
        proofRefs: missingEnvRefs,
      },
    },
  };
}

function safeValidate(manifest: RightPaneNativeOsUiRunManifest): ReturnType<typeof validateRightPaneNativeOsUiRunManifest> {
  try {
    return validateRightPaneNativeOsUiRunManifest(manifest);
  } catch {
    return {
      schemaVersion: RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
      canClaimPass: false,
      verdict: 'blocked',
      blockReasons: ['native-os-ui-proof-incomplete'],
    };
  }
}

function normalizeCandidate(
  value: unknown,
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
  observedAt: string,
): RightPaneNativeOsUiRunManifest {
  const raw = record(value);
  return {
    schemaVersion: raw.schemaVersion,
    status: raw.status,
    passClaim: raw.passClaim,
    runner: raw.runner,
    source: raw.source,
    productSurface: raw.productSurface,
    owner: raw.owner,
    inputChannel: raw.inputChannel,
    liveSurfaceTransport: raw.liveSurfaceTransport,
    browserHostSessionRef: refs.browserHostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    observedAt,
    refsFirst: raw.refsFirst,
    boundedEvidenceOnly: raw.boundedEvidenceOnly,
    osObserver: raw.osObserver,
    proofGroups: raw.proofGroups,
    capturePolicy: raw.capturePolicy,
    forbiddenSubstitutes: raw.forbiddenSubstitutes,
    blocker: raw.blocker,
    osUiRun: normalizeRunRefs(raw.osUiRun, refs),
    partialProofLedger: partialProofLedger(raw.partialProofLedger, boundedToken(raw.runId) ?? 'observer-run'),
    actionLedger: actionLedger(raw.actionLedger, boundedToken(raw.runId) ?? 'observer-run', refs),
  } as RightPaneNativeOsUiRunManifest;
}

function normalizeRunRefs(
  value: unknown,
  refs: { browserHostSessionRef: string; liveSurfaceRef: string },
): RightPaneNativeOsUiRunManifest['osUiRun'] {
  const run = record(value);
  const runRef = stringField(run.runRef);
  const auditRefs = Array.isArray(run.auditRefs) && run.auditRefs.every((ref) => typeof ref === 'string')
    ? run.auditRefs
    : undefined;
  if (!runRef || !auditRefs) return undefined;
  return {
    runRef,
    auditRefs,
    browserHostSessionRef: refs.browserHostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
  };
}

function parseBoundedJson(text: string): unknown {
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_JSON_BYTES, 'macOS OS UI observer evidence JSON must be bounded');
  return JSON.parse(text);
}

function assertNoForbiddenInlineEvidence(value: unknown, path: string[] = []): void {
  if (typeof value === 'string') {
    assert.ok(!forbiddenInlineString(value), `macOS OS UI observer evidence must not include raw inline evidence at ${path.join('.') || '<root>'}`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenInlineEvidence(entry, [...path, String(index)]));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.ok(!forbiddenInlineKey(key, entry), `macOS OS UI observer evidence must not include forbidden key ${[...path, key].join('.')}`);
    assertNoForbiddenInlineEvidence(entry, [...path, key]);
  }
}

function hasNoForbiddenInlineEvidence(value: unknown): boolean {
  try {
    assertNoForbiddenInlineEvidence(value);
    return true;
  } catch {
    return false;
  }
}

function forbiddenInlineString(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:https?:|file:|data:|blob:|javascript:)/i.test(trimmed)
    || /<!doctype|<html|<body|outerhtml|innerhtml|;base64,|data:image/i.test(trimmed)
    || /^(?:screenshot|frame-stream|raw-dom|raw-clipboard|clipboard-payload|dom):/i.test(trimmed);
}

function forbiddenInlineKey(key: string, value: unknown): boolean {
  if (value === false || value === undefined || value === null) return false;
  const normalized = key.toLowerCase();
  return /raw.*dom|dom.*raw|raw.*clipboard|clipboard.*payload|raw.*log|raw.*screenshot|screenshot.*base64|providerpayload|secretvalue|password|api[-_]?key/.test(normalized)
    || /raw.*(?:title|text|url|dom|screenshot|clipboard|menu|selection|provider|payload)|(?:title|text|url|dom|screenshot|clipboard|menu|selection|provider|payload).*raw/.test(normalized)
    || /^(?:title|text|url|dom|screenshot|clipboard|menu|selection|provider)$/.test(normalized)
    || /(?:^|[-_])(?:title|text|url|dom|screenshot|clipboard|menu|selection|provider)(?:$|[-_])/.test(normalized)
    || normalized === 'secret'
    || normalized === 'token';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundedErrorToken(error: unknown): string {
  const code = record(error).code;
  const name = error instanceof Error ? error.name : typeof error;
  return boundedHashToken(`${typeof code === 'string' ? code : 'unknown'}:${name}`);
}

function boundedObserverCommandEnv(env: EnvRecord): EnvRecord {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE],
    [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON],
  };
}

function boundedHashToken(value: string): string {
  return `hash-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function isTrustedMacosAccessibilityHelperCommand(command: string | undefined, args: string[], env: EnvRecord): boolean {
  if (!command || env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE] !== '1') return false;
  if (args.some(isNodeEvalArg)) return false;
  return actualTrustedMacosAccessibilityHelperEntrypoint(command, args) === resolve(process.cwd(), TRUSTED_MACOS_ACCESSIBILITY_HELPER_REF);
}

function actualTrustedMacosAccessibilityHelperEntrypoint(command: string, args: string[]): string | undefined {
  const commandName = executableName(command);
  if (commandName === 'tsx') {
    if (resolvedCommandPath(command) !== resolve(process.cwd(), TRUSTED_TSX_BIN_REF)) return undefined;
    return trustedHelperPath(args[0]);
  }
  if (commandName !== 'node' || resolvedCommandPath(command) !== resolve(process.execPath)) return undefined;
  if (args[0] === '--import' && args[1] === 'tsx') return trustedHelperPath(args[2]);
  if (args[0] === '--import=tsx') return trustedHelperPath(args[1]);
  return undefined;
}

function trustedHelperPath(entrypoint: string | undefined): string | undefined {
  if (!entrypoint || !entrypoint.endsWith(TRUSTED_MACOS_ACCESSIBILITY_HELPER_BASENAME)) return undefined;
  return resolve(process.cwd(), entrypoint);
}

function executableName(command: string): string {
  const normalized = command.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return name.endsWith('.exe') || name.endsWith('.cmd') ? name.slice(0, name.lastIndexOf('.')) : name;
}

function resolvedCommandPath(command: string): string {
  return resolve(process.cwd(), command);
}

function isNodeEvalArg(arg: string): boolean {
  return arg === '-e' || arg === '--eval' || arg.startsWith('--eval=');
}

function parseArgs(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  assert.ok(Array.isArray(parsed) && parsed.every((item) => typeof item === 'string'), `${SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON} must be a JSON string array`);
  return parsed;
}

function cliArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runRightPaneNativeOsUiMacosObserver({
    browserHostSessionRef: cliArg('--browser-host-session-ref'),
    liveSurfaceRef: cliArg('--live-surface-ref'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
