import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS,
  RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
} from '../src/desktop/right-pane-native-os-ui-run-contract.js';

const execFileAsync = promisify(execFile);

const DEFAULT_RUN_ID = 'trusted-macos-accessibility-helper-partial';
const DEFAULT_PROBE_TIMEOUT_MS = 2_500;
const MAX_PROBE_STDOUT_BYTES = 4_096;
const MAX_ACTION_PLAN_JSON_BYTES = 8_192;
const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON' as const;
const RIGHT_PANE_NATIVE_OS_UI_ACTION_PLAN_SCHEMA =
  'sciforge.browser.right-pane-native-os-ui-action-plan.v1' as const;
const RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAME_SET = new Set<string>(
  Object.values(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES).flat(),
);

type MacosAccessibilityPartialProbe = {
  source: 'macos-accessibility-observer';
  runId: string;
  boundedEvidenceOnly: true;
  accessibilityTrusted: boolean;
  frontmostApplicationCount: number;
  windowCount: number;
  focusedElementPresent: boolean;
  roleTokenHash?: string;
  caretCandidateCount: number;
  inputCaretVisible: boolean;
  latencyMs: number;
  proofGroups: MacosAccessibilityPartialProofGroups;
  partialProofLedger: MacosAccessibilityPartialProofLedger;
  actionLedger: MacosAccessibilityActionLedger;
};

type MacosAccessibilityPartialProofGroupName =
  | 'cursorCaret'
  | 'mouseContextMenu'
  | 'keyboardImeClipboardSelection'
  | 'rerenderFocus';

type MacosAccessibilityPartialProofGroups = Record<MacosAccessibilityPartialProofGroupName, string[]>;

type MacosAccessibilityPartialProofLedger = Record<MacosAccessibilityPartialProofGroupName, {
  status: 'partial' | 'not-observed';
  observerKind: 'macos-accessibility';
  proofCandidateCount: number;
  observedProofNames: string[];
  evidenceTokenRef: string;
  latencyMs: number;
}>;

type MacosAccessibilityActionLedger = {
  entries: MacosAccessibilityActionLedgerEntry[];
};

type MacosAccessibilityActionLedgerEntry = {
  status: 'passed' | 'partial' | 'blocked';
  proofGroup: MacosAccessibilityPartialProofGroupName;
  actionId: string;
  expectedProofNames: string[];
  observedProofNames: string[];
  evidenceTokenRef: string;
  latencyMs: number;
  rawPayloadRecorded: false;
};

type RawAxProbe = {
  accessibilityTrusted: boolean;
  frontmostApplicationCount: number;
  windowCount: number;
  focusedElementPresent: boolean;
  focusedRole?: string;
  caretCandidateCount: number;
  selectedTextRangePresent: boolean;
};

type NativeOsUiActionPlan = {
  runId: string;
  proofGroup: MacosAccessibilityPartialProofGroupName;
  actions: string[];
};

async function runTrustedHelperPartialProbe(): Promise<MacosAccessibilityPartialProbe> {
  const startedAt = Date.now();
  const runId = cliArg('--run-id') ?? DEFAULT_RUN_ID;
  const plannedProofGroups = await runNativeOsUiActionPlan(
    process.env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV],
    process.env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON],
    runId,
  );
  if (allPartialProofGroupsEmpty(plannedProofGroups)) {
    await invokeBrowserHostActionChannel(process.env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]);
  }
  if (cliArg('--probe-mode') === 'bounded-partial-caret-fixture') {
    return buildPartialProbe({
      runId,
      latencyMs: 1,
      raw: {
        accessibilityTrusted: true,
        frontmostApplicationCount: 1,
        windowCount: 1,
        focusedElementPresent: true,
        focusedRole: 'AXTextField',
        caretCandidateCount: 1,
        selectedTextRangePresent: true,
      },
    });
  }
  if (cliArg('--probe-mode') === 'bounded-partial-proof-ledger-fixture') {
    return buildPartialProbe({
      runId,
      latencyMs: 1,
      raw: {
        accessibilityTrusted: true,
        frontmostApplicationCount: 1,
        windowCount: 1,
        focusedElementPresent: true,
        focusedRole: 'AXTextField',
        caretCandidateCount: 1,
        selectedTextRangePresent: true,
      },
      proofGroups: {
        cursorCaret: ['input-caret-visible', 'focus-blur-restore'],
        mouseContextMenu: [],
        keyboardImeClipboardSelection: [],
        rerenderFocus: ['native-surface-not-detached', 'focus-retained-after-rerender'],
      },
    });
  }
  if (cliArg('--probe-mode') === 'bounded-complete-cursor-caret-action-fixture') {
    return buildPartialProbe({
      runId,
      latencyMs: 1,
      raw: {
        accessibilityTrusted: true,
        frontmostApplicationCount: 1,
        windowCount: 1,
        focusedElementPresent: true,
        focusedRole: 'AXTextField',
        caretCandidateCount: 1,
        selectedTextRangePresent: true,
      },
      proofGroups: {
        cursorCaret: [...RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.cursorCaret],
        mouseContextMenu: [],
        keyboardImeClipboardSelection: [],
        rerenderFocus: [],
      },
    });
  }
  if (cliArg('--probe-mode') === 'bounded-partial-mouse-action-fixture') {
    return buildPartialProbe({
      runId,
      latencyMs: 1,
      raw: {
        accessibilityTrusted: true,
        frontmostApplicationCount: 1,
        windowCount: 1,
        focusedElementPresent: true,
        focusedRole: 'AXWebArea',
        caretCandidateCount: 0,
        selectedTextRangePresent: false,
      },
      proofGroups: {
        cursorCaret: [],
        mouseContextMenu: [
          'left-click-owner',
          'middle-click-owner',
          'double-click-owner',
          'mouse-down-up-owner',
          'continuous-move-owner',
          'wheel-vertical-owner',
          'wheel-horizontal-owner',
        ],
        keyboardImeClipboardSelection: [],
        rerenderFocus: [],
      },
    });
  }
  if (cliArg('--probe-mode') === 'bounded-action-channel-rerender-focus-fixture') {
    return buildPartialProbe({
      runId,
      latencyMs: 1,
      raw: {
        accessibilityTrusted: true,
        frontmostApplicationCount: 1,
        windowCount: 1,
        focusedElementPresent: true,
        focusedRole: 'AXWebArea',
        caretCandidateCount: 0,
        selectedTextRangePresent: false,
      },
      proofGroups: {
        cursorCaret: [],
        mouseContextMenu: [],
        keyboardImeClipboardSelection: [],
        rerenderFocus: [
          'native-surface-not-detached',
          'focus-retained-after-rerender',
        ],
      },
    });
  }

  const raw = await readSystemEventsAccessibilityPartialProbe();
  return buildPartialProbe({
    runId,
    latencyMs: Date.now() - startedAt,
    raw,
    proofGroups: allPartialProofGroupsEmpty(plannedProofGroups) ? undefined : plannedProofGroups,
  });
}

async function runNativeOsUiActionPlan(
  endpoint: string | undefined,
  rawPlanJson: string | undefined,
  runId: string,
): Promise<MacosAccessibilityPartialProofGroups> {
  const proofGroups = emptyPartialProofGroups();
  if (!endpoint || !isValidLoopbackActionChannelEndpoint(endpoint)) return proofGroups;
  const plan = parseNativeOsUiActionPlan(rawPlanJson, runId);
  if (!plan) return proofGroups;
  for (const proofName of plan.actions) {
    if (plan.proofGroup === 'cursorCaret' && cursorProbeForProof(proofName)) {
      const cursor = await invokeCursorProbe(endpoint, proofName);
      if (cursorProofMatches(proofName, cursor)) proofGroups.cursorCaret.push(proofName);
      continue;
    }
    const proofNames = await invokeNativeOsUiProofProbe(endpoint, plan.proofGroup, proofName);
    if (proofNames.includes(proofName)) proofGroups[plan.proofGroup].push(proofName);
  }
  proofGroups[plan.proofGroup] = uniqueBoundedProofNames(proofGroups[plan.proofGroup]);
  return proofGroups;
}

function parseNativeOsUiActionPlan(
  rawPlanJson: string | undefined,
  expectedRunId: string,
): NativeOsUiActionPlan | undefined {
  if (!rawPlanJson?.trim()) return undefined;
  if (Buffer.byteLength(rawPlanJson, 'utf8') > MAX_ACTION_PLAN_JSON_BYTES) return undefined;
  try {
    const raw = record(JSON.parse(rawPlanJson) as unknown);
    if (raw.schemaVersion !== RIGHT_PANE_NATIVE_OS_UI_ACTION_PLAN_SCHEMA) return undefined;
    if (raw.runId !== expectedRunId) return undefined;
    if (!isAllowedActionPlanShape(raw)) return undefined;
    const proofGroup = actionPlanProofGroup(raw.proofGroup);
    if (!proofGroup) return undefined;
    if (raw.mode !== actionPlanModeForGroup(proofGroup)) return undefined;
    if (!Array.isArray(raw.actions)) return undefined;
    const allowed = new Set<string>(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES[proofGroup]);
    if (!raw.actions.every((entry) => typeof entry === 'string' && allowed.has(entry))) return undefined;
    const actions = uniqueBoundedProofNames(raw.actions);
    if (actions.length === 0) return undefined;
    return {
      runId: expectedRunId,
      proofGroup,
      actions,
    };
  } catch {
    return undefined;
  }
}

function isAllowedActionPlanShape(raw: Record<string, unknown>): boolean {
  const allowedKeys = new Set(['schemaVersion', 'runId', 'proofGroup', 'mode', 'actions']);
  return Object.keys(raw).every((key) => allowedKeys.has(key));
}

function actionPlanProofGroup(value: unknown): MacosAccessibilityPartialProofGroupName | undefined {
  return value === 'cursorCaret' ||
    value === 'mouseContextMenu' ||
    value === 'keyboardImeClipboardSelection' ||
    value === 'rerenderFocus'
    ? value
    : undefined;
}

function actionPlanModeForGroup(proofGroup: MacosAccessibilityPartialProofGroupName): string {
  if (proofGroup === 'cursorCaret') return 'bounded-cursor-caret';
  if (proofGroup === 'mouseContextMenu') return 'bounded-mouse-context-menu';
  if (proofGroup === 'keyboardImeClipboardSelection') return 'bounded-keyboard-ime-clipboard-selection';
  return 'bounded-rerender-focus';
}

function actionIdForProofGroup(proofGroup: MacosAccessibilityPartialProofGroupName): string {
  return RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS[proofGroup];
}

function allPartialProofGroupsEmpty(proofGroups: MacosAccessibilityPartialProofGroups): boolean {
  return Object.values(proofGroups).every((proofNames) => proofNames.length === 0);
}

async function invokeCursorProbe(
  endpoint: string,
  proofName: string,
): Promise<'pointer' | 'default' | 'text' | undefined> {
  const probe = cursorProbeForProof(proofName);
  if (!probe) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ action: 'cursor', x: probe.x, y: probe.y }),
      signal: controller.signal,
    });
    const body = record(await response.json().catch(() => ({})));
    return cursorFromActionResponse(body);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeNativeOsUiProofProbe(
  endpoint: string,
  proofGroup: MacosAccessibilityPartialProofGroupName,
  proofName: string,
): Promise<string[]> {
  const probe = nativeOsUiProofProbeForProof(proofGroup, proofName);
  if (!probe) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        action: 'native-os-ui-proof',
        proofGroup,
        probe,
        expectedProofNames: [proofName],
        actionId: actionIdForProofGroup(proofGroup),
        capture: 'none',
      }),
      signal: controller.signal,
    });
    const body = record(await response.json().catch(() => ({})));
    return nativeOsUiProofNamesFromActionResponse(body, proofGroup, actionIdForProofGroup(proofGroup));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function cursorProbeForProof(proofName: string): { x: number; y: number } | undefined {
  if (proofName === 'pointer-button-link') return { x: 11, y: 12 };
  if (proofName === 'pointer-default-area') return { x: 21, y: 22 };
  if (proofName === 'text-cursor-area') return { x: 31, y: 32 };
  return undefined;
}

function nativeOsUiProofProbeForProof(
  proofGroup: MacosAccessibilityPartialProofGroupName,
  proofName: string,
): string | undefined {
  if (proofGroup === 'cursorCaret') {
    if (proofName === 'input-caret-visible') return 'focus-caret';
    if (proofName === 'focus-blur-restore') return 'blur-restore';
    return undefined;
  }
  if (proofGroup === 'keyboardImeClipboardSelection') return 'bounded-keyboard-ime-clipboard-selection';
  if (proofGroup === 'mouseContextMenu') return 'mouse-context-menu-owner';
  if (proofGroup === 'rerenderFocus') return 'bounded-rerender-focus';
  return undefined;
}

function nativeOsUiProofNamesFromActionResponse(
  body: Record<string, unknown>,
  proofGroup: MacosAccessibilityPartialProofGroupName,
  actionId: string,
): string[] {
  const session = record(body.session);
  return uniqueBoundedProofNames([
    ...nativeOsUiProofNamesFromObject(record(session.nativeOsUiProof), proofGroup, actionId),
    ...nativeOsUiProofNamesFromObject(record(body.nativeOsUiProof), proofGroup, actionId),
  ]);
}

function nativeOsUiProofNamesFromObject(
  proof: Record<string, unknown>,
  proofGroup: MacosAccessibilityPartialProofGroupName,
  actionId: string,
): string[] {
  if (!validNativeOsUiProofObject(proof, proofGroup, actionId)) return [];
  return uniqueBoundedProofNames([
    ...proofNamesFromUnknownArray(proof.observedProofNames),
    ...proofNamesFromUnknownArray(proof.proofNames),
    ...proofNamesFromEvidenceTokens(proof.evidenceTokens),
    ...proofNamesFromEvidenceTokens(proof.diagnostics),
  ]);
}

function validNativeOsUiProofObject(
  proof: Record<string, unknown>,
  proofGroup: MacosAccessibilityPartialProofGroupName,
  actionId: string,
): boolean {
  return proof.schemaVersion === 'sciforge.browser-host-session.native-os-ui-proof.v1'
    && proof.boundedEvidenceOnly === true
    && proof.rawDomRecorded === false
    && proof.rawTextRecorded === false
    && proof.rawUrlRecorded === false
    && proof.rawTitleRecorded === false
    && proof.rawSelectorRecorded === false
    && proof.rawCoordsRecorded === false
    && proof.rawPayloadRecorded === false
    && proof.source === 'native-embedded-action-state'
    && proof.proofGroup === proofGroup
    && proof.actionId === actionId;
}

function proofNamesFromUnknownArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function proofNamesFromEvidenceTokens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const proofNames: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const match = /^proof:([a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}):observed$/.exec(entry);
    if (match) proofNames.push(match[1]);
  }
  return proofNames;
}

function cursorFromActionResponse(body: Record<string, unknown>): 'pointer' | 'default' | 'text' | undefined {
  const session = record(body.session);
  const cursor = boundedCursorToken(session.cursor) ?? boundedCursorToken(body.cursor);
  if (cursor) return cursor;
  const diagnostics = Array.isArray(session.diagnostics)
    ? session.diagnostics
    : Array.isArray(body.diagnostics)
      ? body.diagnostics
      : [];
  for (const entry of diagnostics) {
    if (typeof entry !== 'string') continue;
    const match = /^cursor:(pointer|default|text)$/.exec(entry);
    if (match) return match[1] as 'pointer' | 'default' | 'text';
  }
  return undefined;
}

function boundedCursorToken(value: unknown): 'pointer' | 'default' | 'text' | undefined {
  return value === 'pointer' || value === 'default' || value === 'text' ? value : undefined;
}

function cursorProofMatches(proofName: string, cursor: string | undefined): boolean {
  return (proofName === 'pointer-button-link' && cursor === 'pointer')
    || (proofName === 'pointer-default-area' && cursor === 'default')
    || (proofName === 'text-cursor-area' && cursor === 'text');
}

async function invokeBrowserHostActionChannel(endpoint: string | undefined): Promise<void> {
  if (!endpoint || !isValidLoopbackActionChannelEndpoint(endpoint)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ action: 'cursor', x: 0, y: 0 }),
      signal: controller.signal,
    });
  } catch {
    // Action-channel probing is evidence-adjacent; failures remain blocked via OS proof.
  } finally {
    clearTimeout(timeout);
  }
}

function isValidLoopbackActionChannelEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (!isLoopbackHost(url.hostname)) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    return /^\/(?:api\/sciforge\/browser-host\/)?sessions\/[a-zA-Z0-9._~-]{1,128}\/actions$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function buildPartialProbe(input: {
  runId: string;
  latencyMs: number;
  raw: RawAxProbe;
  proofGroups?: MacosAccessibilityPartialProofGroups;
}): MacosAccessibilityPartialProbe {
  const inputCaretVisible =
    input.raw.accessibilityTrusted &&
    input.raw.focusedElementPresent &&
    input.raw.caretCandidateCount > 0 &&
    input.raw.selectedTextRangePresent;
  const proofGroups = input.proofGroups ?? emptyPartialProofGroups();
  if (inputCaretVisible) {
    proofGroups.cursorCaret = uniqueBoundedProofNames([...proofGroups.cursorCaret, 'input-caret-visible']);
  }
  const latencyMs = boundedLatencyMs(input.latencyMs);

  return {
    source: 'macos-accessibility-observer',
    runId: input.runId,
    boundedEvidenceOnly: true,
    accessibilityTrusted: input.raw.accessibilityTrusted,
    frontmostApplicationCount: boundedCount(input.raw.frontmostApplicationCount),
    windowCount: boundedCount(input.raw.windowCount),
    focusedElementPresent: input.raw.focusedElementPresent,
    roleTokenHash: roleTokenHash(input.raw.focusedRole),
    caretCandidateCount: boundedCount(input.raw.caretCandidateCount),
    inputCaretVisible,
    latencyMs,
    proofGroups,
    partialProofLedger: partialProofLedger(input.runId, proofGroups, latencyMs),
    actionLedger: actionLedger(input.runId, proofGroups, latencyMs),
  };
}

function emptyPartialProofGroups(): MacosAccessibilityPartialProofGroups {
  return {
    cursorCaret: [],
    mouseContextMenu: [],
    keyboardImeClipboardSelection: [],
    rerenderFocus: [],
  };
}

function partialProofLedger(
  runId: string,
  proofGroups: MacosAccessibilityPartialProofGroups,
  latencyMs: number,
): MacosAccessibilityPartialProofLedger {
  return {
    cursorCaret: partialProofLedgerEntry(runId, 'cursorCaret', proofGroups.cursorCaret, latencyMs),
    mouseContextMenu: partialProofLedgerEntry(runId, 'mouseContextMenu', proofGroups.mouseContextMenu, latencyMs),
    keyboardImeClipboardSelection: partialProofLedgerEntry(runId, 'keyboardImeClipboardSelection', proofGroups.keyboardImeClipboardSelection, latencyMs),
    rerenderFocus: partialProofLedgerEntry(runId, 'rerenderFocus', proofGroups.rerenderFocus, latencyMs),
  };
}

function actionLedger(
  runId: string,
  proofGroups: MacosAccessibilityPartialProofGroups,
  latencyMs: number,
): MacosAccessibilityActionLedger {
  return {
    entries: [
      actionLedgerEntry(runId, 'cursorCaret', RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.cursorCaret, proofGroups.cursorCaret, latencyMs),
      actionLedgerEntry(
        runId,
        'mouseContextMenu',
        RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.mouseContextMenu,
        proofGroups.mouseContextMenu,
        latencyMs,
      ),
      actionLedgerEntry(
        runId,
        'keyboardImeClipboardSelection',
        RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.keyboardImeClipboardSelection,
        proofGroups.keyboardImeClipboardSelection,
        latencyMs,
      ),
      actionLedgerEntry(runId, 'rerenderFocus', RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.rerenderFocus, proofGroups.rerenderFocus, latencyMs),
    ],
  };
}

function actionLedgerEntry(
  runId: string,
  groupName: MacosAccessibilityPartialProofGroupName,
  actionId: string,
  proofNames: string[],
  latencyMs: number,
): MacosAccessibilityActionLedgerEntry {
  const observedProofNames = uniqueBoundedProofNames(proofNames);
  const area = PROOF_GROUP_AREAS[groupName];
  const requiredProofNames = RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES[groupName];
  return {
    status: requiredProofNames.every((name) => observedProofNames.includes(name))
      ? 'passed'
      : observedProofNames.length > 0
        ? 'partial'
        : 'blocked',
    proofGroup: groupName,
    actionId,
    expectedProofNames: [...requiredProofNames],
    observedProofNames,
    evidenceTokenRef: `macos-accessibility-observer/${runId}/${area}/${actionId}/bounded-action-ledger`,
    latencyMs,
    rawPayloadRecorded: false,
  };
}

function partialProofLedgerEntry(
  runId: string,
  groupName: MacosAccessibilityPartialProofGroupName,
  proofNames: string[],
  latencyMs: number,
): MacosAccessibilityPartialProofLedger[MacosAccessibilityPartialProofGroupName] {
  const observedProofNames = uniqueBoundedProofNames(proofNames);
  const area = PROOF_GROUP_AREAS[groupName];
  return {
    status: observedProofNames.length > 0 ? 'partial' : 'not-observed',
    observerKind: 'macos-accessibility',
    proofCandidateCount: observedProofNames.length,
    observedProofNames,
    evidenceTokenRef: `macos-accessibility-observer/${runId}/${area}/bounded-partial-ledger`,
    latencyMs,
  };
}

function uniqueBoundedProofNames(values: string[]): string[] {
  return [...new Set(values.filter((value) => (
    RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAME_SET.has(value)
    && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value)
  )))];
}

async function readSystemEventsAccessibilityPartialProbe(): Promise<RawAxProbe> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-e',
      ACCESSIBILITY_PARTIAL_PROBE_SCRIPT,
    ], {
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
      maxBuffer: MAX_PROBE_STDOUT_BYTES,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
      },
    });
    return normalizeRawAxProbe(JSON.parse(stdout));
  } catch {
    return {
      accessibilityTrusted: false,
      frontmostApplicationCount: 0,
      windowCount: 0,
      focusedElementPresent: false,
      caretCandidateCount: 0,
      selectedTextRangePresent: false,
    };
  }
}

function normalizeRawAxProbe(value: unknown): RawAxProbe {
  const raw = record(value);
  return {
    accessibilityTrusted: raw.accessibilityTrusted === true,
    frontmostApplicationCount: boundedCount(raw.frontmostApplicationCount),
    windowCount: boundedCount(raw.windowCount),
    focusedElementPresent: raw.focusedElementPresent === true,
    focusedRole: boundedAxRole(raw.focusedRole),
    caretCandidateCount: boundedCount(raw.caretCandidateCount),
    selectedTextRangePresent: raw.selectedTextRangePresent === true,
  };
}

function boundedAxRole(value: unknown): string | undefined {
  return typeof value === 'string' && /^AX[A-Za-z0-9_ -]{1,61}$/.test(value) ? value : undefined;
}

function roleTokenHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `role-hash-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(1_000, Math.floor(value))
    : 0;
}

function boundedLatencyMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(30_000, Math.floor(value))
    : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cliArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value) ? value : undefined;
}

const ACCESSIBILITY_PARTIAL_PROBE_SCRIPT = `
on boolJson(value)
  if value then
    return "true"
  end if
  return "false"
end boolJson

tell application "System Events"
  set accessibilityTrusted to UI elements enabled
  set frontmostApplicationCount to 0
  set windowCount to 0
  set focusedElementPresent to false
  set focusedRole to ""
  set caretCandidateCount to 0
  set selectedTextRangePresent to false

  try
    set frontProcesses to application processes whose frontmost is true
    set frontmostApplicationCount to count of frontProcesses
    if frontmostApplicationCount > 0 then
      set frontProcess to item 1 of frontProcesses
      try
        set windowCount to count of windows of frontProcess
      end try

      try
        set focusedElement to value of attribute "AXFocusedUIElement" of frontProcess
        if focusedElement is not missing value then
          set focusedElementPresent to true
          try
            set focusedRole to (value of attribute "AXRole" of focusedElement) as text
          end try

          if focusedRole is "AXTextField" or focusedRole is "AXTextArea" or focusedRole is "AXComboBox" or focusedRole is "AXSearchField" then
            set caretCandidateCount to 1
            try
              set selectedRange to value of attribute "AXSelectedTextRange" of focusedElement
              set selectedTextRangePresent to true
            end try
          end if
        end if
      end try
    end if
  end try

  return "{\\"accessibilityTrusted\\":" & my boolJson(accessibilityTrusted) & ",\\"frontmostApplicationCount\\":" & frontmostApplicationCount & ",\\"windowCount\\":" & windowCount & ",\\"focusedElementPresent\\":" & my boolJson(focusedElementPresent) & ",\\"focusedRole\\":\\"" & focusedRole & "\\",\\"caretCandidateCount\\":" & caretCandidateCount & ",\\"selectedTextRangePresent\\":" & my boolJson(selectedTextRangePresent) & "}"
end tell
`;

const PROOF_GROUP_AREAS = {
  cursorCaret: 'cursor-caret',
  mouseContextMenu: 'mouse-context-menu',
  keyboardImeClipboardSelection: 'keyboard-ime-clipboard-selection',
  rerenderFocus: 'rerender-focus',
} as const satisfies Record<MacosAccessibilityPartialProofGroupName, string>;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runTrustedHelperPartialProbe();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
