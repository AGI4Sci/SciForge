import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS,
  RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
  RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV as CONTRACT_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
  buildBlockedRightPaneNativeOsUiRunSkeleton,
  missingBrowserHostActionChannel,
  validateRightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiActionLedger,
  type RightPaneNativeOsUiActionLedgerEntry,
  type RightPaneNativeOsUiBrowserHostActionChannel,
  type RightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiProofGroup,
} from '../src/desktop/right-pane-native-os-ui-run-contract.js';
import {
  runRightPaneNativeOsUiMacosObserver,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON,
} from './right-pane-native-os-ui-macos-observer.js';

const execFileAsync = promisify(execFile);

export const RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON' as const;
export const RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND' as const;
export const RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON_ENV =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON' as const;
export const RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV =
  CONTRACT_BROWSER_HOST_ACTION_CHANNEL_URL_ENV;
export const SCIFORGE_WORKSPACE_WRITER_BASE_URL_ENV =
  'SCIFORGE_WORKSPACE_WRITER_BASE_URL' as const;
export const SCIFORGE_WORKSPACE_WRITER_URL_ENV =
  'SCIFORGE_WORKSPACE_WRITER_URL' as const;
export const DEFAULT_RIGHT_PANE_NATIVE_OS_UI_INPUT_MANIFEST_REF =
  'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json' as const;
export const DEFAULT_RIGHT_PANE_NATIVE_OS_UI_OUTPUT_MANIFEST_REF =
  'docs/test-artifacts/right-pane-native-os-ui-run/manifest.json' as const;

type EnvRecord = Record<string, string | undefined>;

type RunOptions = {
  cwd?: string;
  env?: EnvRecord;
  now?: string;
  inputManifestPath?: string;
  outputPath?: string;
  observerTimeoutMs?: number;
};

type LiveAcceptanceRefs = {
  browserHostSessionRef: string;
  liveSurfaceRef: string;
};

type BrowserHostActionChannelHandoff = {
  channel: RightPaneNativeOsUiBrowserHostActionChannel;
  endpoint?: string;
};

const MAX_JSON_BYTES = 96_000;
const DEFAULT_OBSERVER_TIMEOUT_MS = 60_000;
const PROOF_GROUP_AREAS = {
  cursorCaret: 'cursor-caret',
  mouseContextMenu: 'mouse-context-menu',
  keyboardImeClipboardSelection: 'keyboard-ime-clipboard-selection',
  rerenderFocus: 'rerender-focus',
} as const;

export async function runRightPaneNativeOsUiRunner(
  options: RunOptions = {},
): Promise<RightPaneNativeOsUiRunManifest> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const inputManifestPath = resolve(cwd, options.inputManifestPath ?? DEFAULT_RIGHT_PANE_NATIVE_OS_UI_INPUT_MANIFEST_REF);
  const outputPath = resolve(cwd, options.outputPath ?? DEFAULT_RIGHT_PANE_NATIVE_OS_UI_OUTPUT_MANIFEST_REF);
  const refs = extractLiveAcceptanceRefs(JSON.parse(await readBoundedText(inputManifestPath)));
  const observedAt = options.now ?? new Date().toISOString();
  const browserHostActionChannel = browserHostActionChannelFromEnv(env, refs);
  const observerEnv = envWithBrowserHostActionChannel(env, browserHostActionChannel);

  const observerJson = env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV];
  const observerCommand = env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV];
  const macosObserverConfigured = isMacosObserverConfigured(env);
  if (!observerJson && !observerCommand && !macosObserverConfigured) {
    const blocked = withBrowserHostActionChannel(buildMissingEnvBlockedManifest(refs, observedAt, [
      RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV,
      RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV,
    ]), browserHostActionChannel.channel);
    await writeManifest(outputPath, blocked);
    return blocked;
  }

  if (observerJson) {
    parseBoundedJson(observerJson);
    const manifest = withBrowserHostActionChannel(buildIncompleteProofBlockedManifest(refs, observedAt), browserHostActionChannel.channel);
    await writeManifest(outputPath, manifest);
    return manifest;
  }

  if (observerCommand) {
    await runObserverCommand(observerEnv, options.observerTimeoutMs ?? DEFAULT_OBSERVER_TIMEOUT_MS);
    const manifest = withBrowserHostActionChannel(buildIncompleteProofBlockedManifest(refs, observedAt), browserHostActionChannel.channel);
    await writeManifest(outputPath, manifest);
    return manifest;
  }

  const observerEvidence = await runRightPaneNativeOsUiMacosObserver({
    env: observerEnv,
    now: observedAt,
    browserHostSessionRef: refs.browserHostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    platform: 'darwin',
    observerTimeoutMs: options.observerTimeoutMs,
  });
  const manifest = normalizeObserverEvidence(observerEvidence, refs, observedAt, browserHostActionChannel.channel);
  await writeManifest(outputPath, manifest);
  return manifest;
}

function isMacosObserverConfigured(env: EnvRecord): boolean {
  return env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE] === '1';
}

function extractLiveAcceptanceRefs(value: unknown): LiveAcceptanceRefs {
  const manifest = record(value);
  const m0 = record(manifest.m0SurfingLoop);
  const realExternal = record(manifest.realExternalNavigation);
  const browserHostSession = record(manifest.browserHostSession);
  const sessionRef =
    stringField(m0.sessionRef) ??
    stringField(realExternal.sessionRef) ??
    sessionRefFromId(stringField(browserHostSession.id));
  const liveSurfaceRef = stringField(m0.liveSurfaceRef) ?? stringField(realExternal.liveSurfaceRef);
  assert.ok(sessionRef, 'desktop native live acceptance manifest must include a BrowserHostSession ref');
  assert.ok(liveSurfaceRef, 'desktop native live acceptance manifest must include a liveSurface ref');
  return {
    browserHostSessionRef: sessionRef,
    liveSurfaceRef,
  };
}

async function runObserverCommand(env: EnvRecord, timeoutMs: number): Promise<unknown> {
  const command = env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV];
  assert.ok(command, 'right-pane native OS UI observer command is missing');
  const args = parseArgs(env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON_ENV]);
  const { stdout } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: MAX_JSON_BYTES,
    env: boundedObserverCommandEnv(env),
  });
  return parseBoundedJson(stdout);
}

function boundedObserverCommandEnv(env: EnvRecord): EnvRecord {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV]: env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV],
    [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV]: env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_COMMAND_ENV],
    [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON_ENV]: env[RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON_ENV],
    [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND],
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON]: env[SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON],
  };
}

function normalizeObserverEvidence(
  value: unknown,
  refs: LiveAcceptanceRefs,
  observedAt: string,
  browserHostActionChannel: RightPaneNativeOsUiBrowserHostActionChannel,
): RightPaneNativeOsUiRunManifest {
  const candidate = withBrowserHostActionChannel(buildMacosAccessibilityManifest(value, refs, observedAt) ?? {
    ...value as RightPaneNativeOsUiRunManifest,
    browserHostSessionRef: refs.browserHostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    observedAt,
  }, browserHostActionChannel);
  const validation = safeValidate(candidate);
  if (validation.canClaimPass && hasNoForbiddenInlineEvidence(candidate)) return candidate;
  if (isBoundedObserverBlockedManifest(candidate) && hasNoForbiddenInlineEvidence(candidate)) return candidate;

  const blocked = buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  return {
    ...blocked,
    browserHostActionChannel,
    blocker: 'native-os-ui-proof-incomplete',
    source: 'contract-fixture',
    osObserver: safeAvailableObserver(candidate.osObserver) ?? blocked.osObserver,
  };
}

function withBrowserHostActionChannel(
  manifest: RightPaneNativeOsUiRunManifest,
  browserHostActionChannel: RightPaneNativeOsUiBrowserHostActionChannel,
): RightPaneNativeOsUiRunManifest {
  return {
    ...manifest,
    browserHostActionChannel,
  };
}

function browserHostActionChannelFromEnv(
  env: EnvRecord,
  refs: LiveAcceptanceRefs,
): BrowserHostActionChannelHandoff {
  const endpoint =
    validBrowserHostActionChannelEndpoint(env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV], refs.browserHostSessionRef)
    ?? browserHostActionChannelEndpointFromWorkspaceWriterEnv(env, refs.browserHostSessionRef);
  if (!endpoint) {
    return {
      channel: missingBrowserHostActionChannel(),
    };
  }
  return {
    endpoint,
    channel: {
      status: 'available',
      channelRef: `${refs.browserHostSessionRef}/right-pane-native-os-ui-run/action-channel/${boundedHashToken(endpoint)}`,
      browserHostSessionRef: refs.browserHostSessionRef,
      liveSurfaceRef: refs.liveSurfaceRef,
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
      inputChannel: 'browser-host-session',
      rawEndpointRecorded: false,
      loopbackOnly: true,
    },
  };
}

function envWithBrowserHostActionChannel(
  env: EnvRecord,
  handoff: BrowserHostActionChannelHandoff,
): EnvRecord {
  if (!handoff.endpoint) return env;
  if (env[RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV] === handoff.endpoint) return env;
  return {
    ...env,
    [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: handoff.endpoint,
  };
}

function validBrowserHostActionChannelEndpoint(
  endpoint: string | undefined,
  browserHostSessionRef: string,
): string | undefined {
  if (!endpoint) return undefined;
  return isValidLoopbackActionChannelEndpoint(endpoint, browserHostSessionRef) ? endpoint : undefined;
}

function browserHostActionChannelEndpointFromWorkspaceWriterEnv(
  env: EnvRecord,
  browserHostSessionRef: string,
): string | undefined {
  const configured = env[SCIFORGE_WORKSPACE_WRITER_BASE_URL_ENV] ?? env[SCIFORGE_WORKSPACE_WRITER_URL_ENV];
  if (!configured?.trim()) return undefined;
  const sessionId = sessionIdFromBrowserHostSessionRef(browserHostSessionRef);
  if (!sessionId) return undefined;
  const baseUrl = workspaceWriterLoopbackBaseUrl(configured);
  if (!baseUrl) return undefined;
  const endpoint = new URL(
    `/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/actions`,
    baseUrl,
  ).toString();
  return validBrowserHostActionChannelEndpoint(endpoint, browserHostSessionRef);
}

function workspaceWriterLoopbackBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (!isLoopbackHost(url.hostname)) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function isValidLoopbackActionChannelEndpoint(endpoint: string, browserHostSessionRef: string): boolean {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (!isLoopbackHost(url.hostname)) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    const sessionId = sessionIdFromBrowserHostSessionRef(browserHostSessionRef);
    if (!sessionId) return false;
    const encodedSessionId = encodeURIComponent(sessionId);
    return url.pathname === `/sessions/${encodedSessionId}/actions`
      || url.pathname === `/api/sciforge/browser-host/sessions/${encodedSessionId}/actions`;
  } catch {
    return false;
  }
}

function sessionIdFromBrowserHostSessionRef(ref: string): string | undefined {
  if (!ref.startsWith('browser-host-session:')) return undefined;
  const rest = ref.slice('browser-host-session:'.length);
  const slash = rest.indexOf('/');
  const sessionId = slash >= 0 ? rest.slice(0, slash) : rest;
  return sessionId.length > 0 ? sessionId : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function boundedHashToken(value: string): string {
  return `hash-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function isBoundedObserverBlockedManifest(value: RightPaneNativeOsUiRunManifest): boolean {
  return value.status === 'blocked'
    && value.passClaim === false
    && value.blocker === 'native-os-ui-proof-incomplete'
    && value.source === 'contract-fixture'
    && value.refsFirst === true
    && value.boundedEvidenceOnly === true;
}

function buildMacosAccessibilityManifest(
  value: unknown,
  refs: LiveAcceptanceRefs,
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

function actionLedger(
  value: unknown,
  runId: string,
  refs: LiveAcceptanceRefs,
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
  refs: LiveAcceptanceRefs,
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
  const requiredProofNames = RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES[proofGroup];
  const status = requiredProofNames.every((name) => observedProofNames.includes(name))
    ? 'passed'
    : observedProofNames.length > 0
      ? 'partial'
      : 'blocked';
  const latencyMs = boundedLatencyMs(entry.latencyMs);
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

function boundedProofNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => boundedToken(entry)).filter((entry): entry is string => Boolean(entry));
}

function boundedLatencyMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60_000
    ? Math.round(value)
    : undefined;
}

function boundedToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value)) return undefined;
  if (forbiddenInlineString(value)) return undefined;
  return value;
}

function buildMissingEnvBlockedManifest(
  refs: LiveAcceptanceRefs,
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

function buildIncompleteProofBlockedManifest(
  refs: LiveAcceptanceRefs,
  observedAt: string,
): RightPaneNativeOsUiRunManifest {
  const blocked = buildBlockedRightPaneNativeOsUiRunSkeleton({ ...refs, observedAt });
  return {
    ...blocked,
    blocker: 'native-os-ui-proof-incomplete',
    source: 'contract-fixture',
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

async function writeManifest(outputPath: string, manifest: RightPaneNativeOsUiRunManifest): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  assertBoundedJson(text);
  assertNoForbiddenInlineEvidence(manifest);
  await writeFile(outputPath, text);
}

async function readBoundedText(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  assertBoundedJson(text);
  return text;
}

function parseBoundedJson(text: string): unknown {
  assertBoundedJson(text);
  return JSON.parse(text);
}

function assertBoundedJson(text: string): void {
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_JSON_BYTES, 'right-pane native OS UI JSON evidence must be bounded');
}

function assertNoForbiddenInlineEvidence(value: unknown, path: string[] = []): void {
  if (typeof value === 'string') {
    assert.ok(!forbiddenInlineString(value), `right-pane native OS UI evidence must not include raw inline evidence at ${path.join('.') || '<root>'}`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenInlineEvidence(entry, [...path, String(index)]));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.ok(!forbiddenInlineKey(key, entry), `right-pane native OS UI evidence must not include forbidden key ${[...path, key].join('.')}`);
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
    || normalized === 'secret'
    || normalized === 'token';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeAvailableObserver(value: unknown): RightPaneNativeOsUiRunManifest['osObserver'] | undefined {
  const observer = record(value);
  const observerRef = stringField(observer.observerRef);
  const observerKind = stringField(observer.observerKind);
  if (observer.status !== 'available' || !observerRef?.startsWith('real-product-os-ui-run:')) return undefined;
  if (!['macos-accessibility', 'windows-ui-automation', 'linux-at-spi', 'platform-os-ui-observer'].includes(observerKind ?? '')) return undefined;
  return {
    status: 'available',
    observerRef,
    observerKind: observerKind as RightPaneNativeOsUiRunManifest['osObserver'] extends { status: 'available'; observerKind: infer K } ? K : never,
  };
}

function sessionRefFromId(id: string | undefined): string | undefined {
  return id ? `browser-host-session:${id}` : undefined;
}

function parseArgs(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  assert.ok(Array.isArray(parsed) && parsed.every((item) => typeof item === 'string'), `${RIGHT_PANE_NATIVE_OS_UI_OBSERVER_ARGS_JSON_ENV} must be a JSON string array`);
  return parsed;
}

function cliArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runRightPaneNativeOsUiRunner({
    inputManifestPath: cliArg('--input-manifest'),
    outputPath: cliArg('--output'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
