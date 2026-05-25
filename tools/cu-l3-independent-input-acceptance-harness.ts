import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CuEvidenceClaim,
  type CuUserAcceptanceInput,
  type CuUserAcceptanceManifest,
  writeCuUserAcceptanceManifest,
} from './cu-user-acceptance-manifest.js';

export const CU_L3_INDEPENDENT_INPUT_VERIFIER_SCHEMA_VERSION =
  'sciforge.computer-use.l3-independent-input-verifier.v1' as const;
export const CU_L3_INDEPENDENT_INPUT_ADAPTER_SCHEMA_VERSION =
  'sciforge.computer-use.independent-input-adapter.v1' as const;

export interface CuL3IndependentInputAcceptanceHarnessOptions {
  tracePath: string;
  adapterPath?: string;
  outDir?: string;
  verifierOutPath?: string;
  manifestOutPath?: string;
  inputOutPath?: string;
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  guiPresentRecordRef?: string;
  guiPresentPayloadRef?: string;
  guiPresentSourceRef?: string;
  verifierReason?: string;
}

export interface CuL3IndependentInputVerifier {
  schemaVersion: typeof CU_L3_INDEPENDENT_INPUT_VERIFIER_SCHEMA_VERSION;
  status: 'passed' | 'blocked';
  verdict: 'multi-app-workflow-passed' | 'blocked';
  traceRef: string;
  adapterRef: string;
  createdAt: string;
  checks: Array<{
    id: string;
    status: 'passed' | 'blocked';
    reason: string;
  }>;
  issueRefs: string[];
  evidenceRefs: {
    traceRefs: string[];
    adapterRefs: string[];
    virtualInputRefs: string[];
    sessionRefs: string[];
    screenshotRefs: {
      before: string[];
      after: string[];
    };
    focusCropRefs: string[];
    groundingDiagnosticsRefs: string[];
  };
}

interface HarnessResult {
  verifier: CuL3IndependentInputVerifier;
  input: CuUserAcceptanceInput;
  manifest: CuUserAcceptanceManifest;
  paths: {
    verifier: string;
    input: string;
    manifest: string;
  };
}

interface CliArgs extends CuL3IndependentInputAcceptanceHarnessOptions {
  tracePath: string;
}

type JsonRecord = Record<string, unknown>;

const sharedInputMarkers = [
  'shared-system-input-acknowledged',
  'shared-system-pointer-keyboard',
  'system-cursor-events',
  'system-key-events',
  'macos-cgevent-system-events',
  'darwin-system-events-generic-gui-executor',
  'global-shared-system-input',
];

export async function runCuL3IndependentInputAcceptanceHarness(
  options: CuL3IndependentInputAcceptanceHarnessOptions,
): Promise<HarnessResult> {
  const tracePath = options.tracePath;
  const outDir = options.outDir ?? dirname(tracePath);
  const adapterPath = options.adapterPath ?? join(dirname(tracePath), 'independent-input-adapter.json');
  const verifierOutPath = options.verifierOutPath ?? join(outDir, 'cu-l3-independent-input-verifier.json');
  const inputOutPath = options.inputOutPath ?? join(outDir, 'cu-user-acceptance-input.json');
  const manifestOutPath = options.manifestOutPath ?? join(outDir, 'cu-user-acceptance-manifest.json');

  const trace = await readJsonRecord(tracePath);
  const adapter = await readJsonRecord(adapterPath);
  const traceRef = toRef(tracePath);
  const adapterRef = toRef(adapterPath);
  const runDir = dirname(traceRef);
  const siblingRefs = await discoverSiblingRefs(dirname(tracePath), runDir);
  const traceEvidence = deriveTraceEvidence(trace, traceRef);
  const adapterEvidence = deriveAdapterEvidence(adapter, adapterRef);
  const checks = [
    ...validateTrace(trace),
    ...validateAdapter(adapter),
  ];
  const issueRefs = checks.filter((check) => check.status === 'blocked').map((check) => check.id);
  const createdAt = stringAt(trace, 'completedAt') ?? stringAt(trace, 'createdAt') ?? new Date().toISOString();
  const finalArtifactRef = options.finalArtifactRef ?? firstStringAt(trace, [
    ['finalArtifactRef'],
    ['acceptance', 'finalArtifactRef'],
    ['cuUserAcceptance', 'finalArtifactRef'],
  ]) ?? firstVisibleArtifactRef(trace);
  const finalVisibleScreenshotRef = options.finalVisibleScreenshotRef
    ?? firstStringAt(trace, [
      ['finalVisibleScreenshotRef'],
      ['acceptance', 'finalVisibleScreenshotRef'],
      ['cuUserAcceptance', 'finalVisibleScreenshotRef'],
    ])
    ?? traceEvidence.screenshotRefs.after.at(-1);
  const guiPresentRecordRef = options.guiPresentRecordRef
    ?? firstStringAt(trace, [
      ['guiPresent', 'recordRef'],
      ['acceptance', 'guiPresent', 'recordRef'],
      ['cuUserAcceptance', 'guiPresent', 'recordRef'],
    ]);
  const guiPresentPayloadRef = options.guiPresentPayloadRef
    ?? firstStringAt(trace, [
      ['guiPresent', 'payloadRef'],
      ['acceptance', 'guiPresent', 'payloadRef'],
      ['cuUserAcceptance', 'guiPresent', 'payloadRef'],
    ])
    ?? siblingRefs.toolPayloadRef;
  const taskText = deriveTaskText(trace);
  if (!taskText) {
    checks.push({
      id: 'task-text-present',
      status: 'blocked',
      reason: 'vision-trace.json must contain task text from the Computer Use request.',
    });
    issueRefs.push('task-text-present');
  }
  const verifierStatus = issueRefs.length === 0 ? 'passed' : 'blocked';
  const apps = deriveWorkflowApps(trace);
  const verifier: CuL3IndependentInputVerifier = {
    schemaVersion: CU_L3_INDEPENDENT_INPUT_VERIFIER_SCHEMA_VERSION,
    status: issueRefs.length === 0 ? 'passed' : 'blocked',
    verdict: issueRefs.length === 0 ? 'multi-app-workflow-passed' : 'blocked',
    traceRef,
    adapterRef,
    createdAt,
    checks,
    issueRefs,
    evidenceRefs: {
      traceRefs: [traceRef],
      adapterRefs: [adapterRef],
      virtualInputRefs: adapterEvidence.virtualInputRefs,
      sessionRefs: adapterEvidence.sessionRefs,
      screenshotRefs: traceEvidence.screenshotRefs,
      focusCropRefs: traceEvidence.focusCropRefs,
      groundingDiagnosticsRefs: traceEvidence.groundingDiagnosticsRefs,
    },
  };

  await mkdir(dirname(verifierOutPath), { recursive: true });
  await writeFile(verifierOutPath, `${JSON.stringify(verifier, null, 2)}\n`, 'utf8');

  const evidenceClaims: CuEvidenceClaim[] = [
    {
      id: 'package-bridge-vision-trace',
      kind: 'real-computer-use',
      ref: traceRef,
      refs: [traceRef],
      note: 'Non-dry-run package-bridge Computer Use vision trace.',
    },
    {
      id: 'tui-host-runTask',
      kind: 'tui-host-runTask',
      ref: siblingRefs.requestRef ?? traceRef,
      refs: [siblingRefs.hostPortsRef ?? traceRef],
      note: 'Computer Use package bridge was invoked through TUI Host runTask evidence.',
    },
    {
      id: 'independent-input-adapter',
      kind: 'independent-input-adapter',
      ref: adapterRef,
      refs: [adapterRef, ...adapterEvidence.virtualInputRefs],
      recordRefs: [adapterRef, toRef(verifierOutPath)],
      evidenceRefs: adapterEvidence.virtualInputRefs,
      sessionRefs: adapterEvidence.sessionRefs,
      note: 'Independent simulated input adapter owned virtual pointer and keyboard state without system mouse or keyboard events.',
    },
    {
      id: 'grounding-diagnostics',
      kind: 'grounding-diagnostics-ref',
      refs: traceEvidence.groundingDiagnosticsRefs,
    },
  ];

  if (guiPresentRecordRef) {
    evidenceClaims.push({
      id: 'gui-present-record',
      kind: 'gui-present-record',
      ref: guiPresentRecordRef,
      refs: [guiPresentRecordRef],
      artifactRefs: [finalArtifactRef].filter(isNonEmptyString),
    });
  }

  const input: CuUserAcceptanceInput = {
    runId: stringAt(trace, 'runId') ?? basenameWithoutJson(tracePath),
    createdAt,
    taskText: taskText ?? 'Missing task text in package-bridge vision trace.',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps,
      windowSwitchTraceRefs: apps.length >= 2 ? [traceRef] : [],
    },
    tuiHostChain: [
      {
        id: 'terminal-equivalent-text',
        kind: 'gui-terminal-equivalent-text',
        status: siblingRefs.requestRef || trace.request ? 'present' : 'missing',
        requestRef: siblingRefs.requestRef ?? traceRef,
      },
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: trace.tool === 'action.sciforge.computer-use' || trace.actionProvider === 'action.sciforge.computer-use' ? 'present' : 'blocked',
        requestRef: siblingRefs.requestRef ?? traceRef,
        hostPortsRef: siblingRefs.hostPortsRef ?? traceRef,
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: trace.runtime === 'sciforge.workspace-runtime.computer-use-package-bridge' ? 'present' : 'blocked',
        toolPayloadRef: siblingRefs.toolPayloadRef ?? traceRef,
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: guiPresentRecordRef ? 'present' : 'missing',
        recordRef: guiPresentRecordRef,
      },
    ],
    evidenceClaims,
    screenshotRefs: traceEvidence.screenshotRefs,
    focusCropRefs: traceEvidence.focusCropRefs,
    groundingDiagnosticsRefs: traceEvidence.groundingDiagnosticsRefs,
    executorLease: {
      status: verifierStatus === 'passed' ? 'present' : 'blocked',
      ref: siblingRefs.hostPortsRef ?? adapterRef,
      owner: 'sciforge-independent-input-adapter remote-desktop',
      acquiredAt: adapterEvidence.acquiredAt ?? createdAt,
    },
    finalArtifactRef,
    finalVisibleScreenshotRef,
    verifierVerdict: {
      status: verifier.status,
      verdict: verifier.verdict,
      ref: toRef(verifierOutPath),
      reason: options.verifierReason ?? (
        verifier.status === 'passed'
          ? 'Independent simulated remote-desktop input evidence is non-dry-run, session-owned, and has no system mouse or keyboard events.'
          : `Independent input acceptance is blocked: ${issueRefs.join(', ')}.`
      ),
    },
    guiPresent: {
      status: guiPresentRecordRef && guiPresentPayloadRef ? 'present' : 'missing',
      sourceRef: options.guiPresentSourceRef,
      recordRef: guiPresentRecordRef,
      payloadRef: guiPresentPayloadRef,
      displayedRefs: [
        traceRef,
        finalVisibleScreenshotRef,
        finalArtifactRef,
        toRef(verifierOutPath),
      ].filter(isNonEmptyString),
      recordRefs: guiPresentRecordRef ? [guiPresentRecordRef] : [],
      artifactRefs: finalArtifactRef ? [finalArtifactRef] : [],
      sessionRefs: adapterEvidence.sessionRefs,
    },
  };

  await mkdir(dirname(inputOutPath), { recursive: true });
  await writeFile(inputOutPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
  const manifest = await writeCuUserAcceptanceManifest(manifestOutPath, input);

  return {
    verifier,
    input,
    manifest,
    paths: {
      verifier: verifierOutPath,
      input: inputOutPath,
      manifest: manifestOutPath,
    },
  };
}

export function parseCuL3IndependentInputAcceptanceCliArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--trace') {
      args.tracePath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--adapter') {
      args.adapterPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out-dir') {
      args.outDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--verifier-out') {
      args.verifierOutPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--manifest-out') {
      args.manifestOutPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--input-out') {
      args.inputOutPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--final-artifact-ref') {
      args.finalArtifactRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--final-visible-screenshot-ref') {
      args.finalVisibleScreenshotRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--gui-present-record-ref') {
      args.guiPresentRecordRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--gui-present-payload-ref') {
      args.guiPresentPayloadRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--gui-present-source-ref') {
      args.guiPresentSourceRef = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--verifier-reason') {
      args.verifierReason = requiredValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown CU L3 independent-input harness argument: ${arg}`);
    }
  }
  if (!args.tracePath) {
    throw new Error('--trace is required');
  }
  return args as CliArgs;
}

function validateTrace(trace: JsonRecord): CuL3IndependentInputVerifier['checks'] {
  const flattenedStrings = allStrings(trace);
  const hasSharedInputMarker = flattenedStrings.some((value) => sharedInputMarkers.includes(value));
  const inputContract = recordAt(recordAt(trace, 'genericComputerUse'), 'inputChannelContract')
    ?? recordAt(recordAt(trace, 'generic'), 'inputChannelContract');
  const hostExecute = recordAt(recordAt(recordAt(trace, 'hostPorts'), 'ports'), 'execute');
  return [
    check(
      'package-bridge-runtime',
      trace.runtime === 'sciforge.workspace-runtime.computer-use-package-bridge',
      'Trace was produced by the Computer Use package bridge runtime.',
      'vision-trace.json is not a Computer Use package-bridge runtime trace.',
    ),
    check(
      'action-provider',
      trace.tool === 'action.sciforge.computer-use' || trace.actionProvider === 'action.sciforge.computer-use',
      'Trace records action.sciforge.computer-use as the action provider.',
      'Trace does not record action.sciforge.computer-use as the action provider.',
    ),
    check(
      'non-dry-run',
      booleanAt(recordAt(trace, 'config'), 'dryRun') === false,
      'Trace config is non-dry-run.',
      'Trace config is dry-run or missing dryRun=false.',
    ),
    check(
      'independent-input-contract',
      stringAt(inputContract, 'userDeviceImpact') === 'none'
        && stringAt(inputContract, 'pointerKeyboardOwnership') === 'sciforge-independent-input-adapter'
        && stringAt(inputContract, 'pointerMode') === 'adapter-window-bound-pointer'
        && stringAt(inputContract, 'keyboardMode') === 'adapter-window-bound-keyboard',
      'Trace input channel contract is owned by the independent adapter and has no user device impact.',
      'Trace input channel contract does not prove independent virtual pointer and keyboard ownership.',
    ),
    check(
      'host-execute-independent-adapter',
      stringAt(hostExecute, 'provider')?.includes('sciforge-simulated-remote-desktop') === true
        || stringAt(inputContract, 'currentIndependentAdapter') === 'remote-desktop',
      'Host execute port uses the remote-desktop independent adapter.',
      'Host execute port does not prove the remote-desktop independent adapter.',
    ),
    check(
      'no-shared-system-input-markers',
      !hasSharedInputMarker,
      'Trace contains no shared system input markers.',
      'Trace contains shared system input markers and cannot satisfy final L3 input isolation.',
    ),
  ];
}

function validateAdapter(adapter: JsonRecord): CuL3IndependentInputVerifier['checks'] {
  const actions = arrayAt(adapter, 'actions').filter(isRecord);
  const actionSystemEventsClean = actions.every((action) => (
    stringAt(action, 'systemMouseEvents') === 'not-sent'
    && stringAt(action, 'systemKeyboardEvents') === 'not-sent'
  ));
  return [
    check(
      'adapter-schema',
      adapter.schemaVersion === CU_L3_INDEPENDENT_INPUT_ADAPTER_SCHEMA_VERSION,
      'independent-input-adapter.json uses the expected schema.',
      'independent-input-adapter.json is missing the expected schema version.',
    ),
    check(
      'adapter-provider',
      adapter.adapter === 'remote-desktop' && adapter.provider === 'sciforge-simulated-remote-desktop',
      'Adapter is the simulated remote-desktop provider.',
      'Adapter is not the simulated remote-desktop provider.',
    ),
    check(
      'adapter-user-device-impact-none',
      adapter.userDeviceImpact === 'none',
      'Adapter records userDeviceImpact=none.',
      'Adapter does not record userDeviceImpact=none.',
    ),
    check(
      'adapter-no-system-mouse-events',
      adapter.systemMouseEvents === 'not-sent',
      'Adapter records systemMouseEvents=not-sent.',
      'Adapter does not record systemMouseEvents=not-sent.',
    ),
    check(
      'adapter-no-system-keyboard-events',
      adapter.systemKeyboardEvents === 'not-sent',
      'Adapter records systemKeyboardEvents=not-sent.',
      'Adapter does not record systemKeyboardEvents=not-sent.',
    ),
    check(
      'adapter-action-ledger-no-system-events',
      actions.length > 0 && actionSystemEventsClean,
      'Every adapter action ledger entry records no system mouse or keyboard events.',
      'Adapter action ledger is empty or includes a system mouse/keyboard event.',
    ),
    check(
      'adapter-session-state',
      isRecord(adapter.targetSession) && isRecord(adapter.virtualPointer) && isRecord(adapter.virtualKeyboard),
      'Adapter records target session plus virtual pointer and keyboard state.',
      'Adapter does not record target session plus virtual pointer and keyboard state.',
    ),
  ];
}

function deriveTraceEvidence(trace: JsonRecord, traceRef: string) {
  const before = collectScreenshotPathsFromKeys(trace, ['beforeScreenshotRefs']);
  const after = collectScreenshotPathsFromKeys(trace, ['afterScreenshotRefs']);
  const screenshotRecords = collectRecords(trace).filter((record) => stringAt(record, 'type') === 'screenshot');
  const focusCropRefs = unique([
    ...screenshotRecords
      .filter((record) => stringAt(record, 'captureScope') === 'focus-region' || stringAt(record, 'path')?.includes('-focus-'))
      .map((record) => stringAt(record, 'path'))
      .filter(isNonEmptyString),
    ...collectPathsFromKeys(trace, ['focusCropRefs', 'focusRegionRefs', 'beforeFocusScreenshotRefs', 'afterFocusScreenshotRefs']),
  ]);
  return {
    screenshotRefs: {
      before: unique(before),
      after: unique(after),
    },
    focusCropRefs,
    groundingDiagnosticsRefs: hasAnyKey(trace, ['grounding', 'fineGrounding', 'localCoordinate', 'mappedCoordinate'])
      ? [traceRef]
      : [],
  };
}

function collectScreenshotPathsFromKeys(value: unknown, keys: string[]): string[] {
  return collectValuesFromKeys(value, keys)
    .flatMap((item) => {
      if (isRecord(item) && stringAt(item, 'captureScope') === 'focus-region') return [];
      return pathRefsFromValue(item);
    })
    .filter(isNonEmptyString);
}

function deriveAdapterEvidence(adapter: JsonRecord, adapterRef: string) {
  const virtualRemoteSession = recordAt(adapter, 'virtualRemoteSession');
  const sessionRef = stringAt(virtualRemoteSession, 'stateRef');
  return {
    acquiredAt: stringAt(adapter, 'createdAt'),
    virtualInputRefs: unique([
      adapterRef,
      stringAt(recordAt(adapter, 'virtualPointer'), 'iconRef'),
      firstStringAt(adapter, [['pointerIconRef'], ['independentInputAdapter', 'pointerIconRef']]),
    ].filter(isNonEmptyString)),
    sessionRefs: unique([adapterRef, sessionRef].filter(isNonEmptyString)),
  };
}

function deriveTaskText(trace: JsonRecord): string | undefined {
  return firstStringAt(trace, [
    ['request', 'text'],
    ['request', 'task'],
    ['request', 'taskText'],
    ['request', 'input', 'task'],
    ['request', 'computerUseRequest', 'task'],
    ['computerUseRequest', 'task'],
    ['taskText'],
    ['task'],
  ]);
}

function deriveWorkflowApps(trace: JsonRecord): string[] {
  const apps = collectRecords(trace)
    .flatMap((record) => [
      stringAt(recordAt(record, 'windowTarget'), 'appName'),
      stringAt(record, 'appName'),
      stringAt(record, 'app_name'),
      stringAt(recordAt(record, 'plannedAction'), 'appName'),
      stringAt(recordAt(record, 'plannedAction'), 'app_name'),
      stringAt(recordAt(record, 'action'), 'appName'),
      stringAt(recordAt(record, 'action'), 'app_name'),
    ])
    .filter(isNonEmptyString)
    .filter((name) => name !== 'unknown-app');
  return unique(apps);
}

function firstVisibleArtifactRef(trace: JsonRecord): string | undefined {
  return collectRecords(trace)
    .flatMap((record) => [
      stringAt(record, 'artifactRef'),
      stringAt(record, 'dataRef'),
      stringAt(record, 'path'),
    ])
    .find((ref) => isNonEmptyString(ref) && /virtual-slide|slide|ppt|presentation|artifact/i.test(ref));
}

async function discoverSiblingRefs(runDirPath: string, runDirRef: string) {
  return {
    requestRef: await existingRef(runDirPath, runDirRef, ['request.json', 'gateway-request.json', 'computer-use-request.json']),
    hostPortsRef: await existingRef(runDirPath, runDirRef, ['host-ports.json']),
    toolPayloadRef: await existingRef(runDirPath, runDirRef, ['tool-payload.json']),
  };
}

async function existingRef(runDirPath: string, runDirRef: string, names: string[]) {
  for (const name of names) {
    try {
      await access(join(runDirPath, name));
      return `${runDirRef}/${name}`;
    } catch {
      // Try the next conventional sibling name.
    }
  }
  return undefined;
}

async function readJsonRecord(path: string): Promise<JsonRecord> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

function check(id: string, ok: boolean, passedReason: string, blockedReason: string) {
  return {
    id,
    status: ok ? 'passed' as const : 'blocked' as const,
    reason: ok ? passedReason : blockedReason,
  };
}

function collectPathsFromKeys(value: unknown, keys: string[]): string[] {
  return collectValuesFromKeys(value, keys).flatMap(pathRefsFromValue).filter(isNonEmptyString);
}

function collectValuesFromKeys(value: unknown, keys: string[]): unknown[] {
  const values: unknown[] = [];
  function visit(current: unknown, key?: string): void {
    if (Array.isArray(current)) {
      if (key && keys.includes(key)) {
        values.push(...current);
      }
      for (const item of current) visit(item);
      return;
    }
    if (!isRecord(current)) return;
    for (const [childKey, childValue] of Object.entries(current)) {
      if (keys.includes(childKey)) {
        values.push(childValue);
      }
      visit(childValue, childKey);
    }
  }
  visit(value);
  return values;
}

function pathRefsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(pathRefsFromValue);
  if (isRecord(value)) {
    return [
      stringAt(value, 'path'),
      stringAt(value, 'ref'),
      stringAt(value, 'dataRef'),
    ].filter(isNonEmptyString);
  }
  return [];
}

function collectRecords(value: unknown): JsonRecord[] {
  const records: JsonRecord[] = [];
  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isRecord(current)) return;
    records.push(current);
    for (const child of Object.values(current)) visit(child);
  }
  visit(value);
  return records;
}

function allStrings(value: unknown): string[] {
  const strings: string[] = [];
  function visit(current: unknown): void {
    if (typeof current === 'string') {
      strings.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isRecord(current)) return;
    for (const child of Object.values(current)) visit(child);
  }
  visit(value);
  return strings;
}

function hasAnyKey(value: unknown, keys: string[]): boolean {
  if (Array.isArray(value)) return value.some((item) => hasAnyKey(item, keys));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => keys.includes(key) || hasAnyKey(child, keys));
}

function firstStringAt(record: JsonRecord, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = valueAt(record, path);
    if (isNonEmptyString(value)) return value;
  }
  return undefined;
}

function valueAt(record: JsonRecord, path: string[]): unknown {
  let current: unknown = record;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function recordAt(value: unknown, key: string): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function arrayAt(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const child = value[key];
  return Array.isArray(child) ? child : [];
}

function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isNonEmptyString(child) ? child : undefined;
}

function booleanAt(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === 'boolean' ? child : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toRef(path: string): string {
  return path.startsWith('/Applications/workspace/ailab/research/app/SciForge/')
    ? path.slice('/Applications/workspace/ailab/research/app/SciForge/'.length)
    : path;
}

function basenameWithoutJson(path: string): string {
  return path.split('/').pop()?.replace(/\.json$/, '') ?? 'cu-l3-independent-input';
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseCuL3IndependentInputAcceptanceCliArgs(process.argv.slice(2));
  const result = await runCuL3IndependentInputAcceptanceHarness(args);
  console.log(
    `[${result.verifier.status}/${result.manifest.status}] wrote ${result.paths.verifier}, ${result.paths.input}, ${result.paths.manifest}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
