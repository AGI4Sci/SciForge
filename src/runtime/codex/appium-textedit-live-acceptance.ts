import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  createWindowActionSession,
  dispatchWindowAction,
  type WindowActionAdapterResult,
} from '../window-action-session.js';
import { createAppiumMac2WebDriverClient } from './appium-mac2-webdriver-client.js';
import {
  createAppiumMac2WindowActionAdapter,
  type AppiumMac2WindowActionClient,
} from './appium-mac2-window-action-adapter.js';
import {
  validateDesktopSoftwareTaskEvidence,
  type DesktopSoftwareTaskEvidenceGate,
} from './desktop-software-task-evidence.js';
import { createTextEditSavedArtifactValidator } from './textedit-saved-artifact-validator.js';

export const APPIUM_TEXTEDIT_LIVE_ACCEPTANCE_SCHEMA_VERSION =
  'sciforge.runtime-codex.appium-textedit-live-acceptance.v1' as const;

export interface AppiumTextEditLiveAcceptanceManifest {
  schemaVersion: typeof APPIUM_TEXTEDIT_LIVE_ACCEPTANCE_SCHEMA_VERSION;
  status: 'passed' | 'blocked' | 'failed';
  passClaim: boolean;
  runner: 'runtime-codex-appium-textedit-live-acceptance';
  source: 'ordinary-chat-to-scoped-appium-textedit-live-target';
  checkedAt: string;
  evidenceMode: 'opt-in-live-appium-textedit-current-host';
  forbiddenSubstitutes: {
    fixtures: false;
    workspaceWriter: false;
    sharedSystemInput: false;
    generatedFileOnly: false;
  };
  readiness: {
    optInEnv: string;
    requiredEnv: Array<{ name: string; present: boolean; valuePrinted: false }>;
    platform: NodeJS.Platform;
    missing: string[];
  };
  target: {
    appName: 'TextEdit';
    bundleId: 'com.apple.TextEdit';
    windowRef: string;
    artifactPathConfigured: boolean;
    artifactRef: string;
  };
  scopedExecutor: {
    adapter: 'appium-mac2';
    executorEnabled: boolean;
    routeAdapters: string[];
    scopedInputAdapterRefs: string[];
    focusLeaseRefs: string[];
  };
  actions: Array<{
    action: 'type' | 'save';
    status: 'completed' | 'blocked' | 'failed';
    blockedReason?: string;
    evidenceRefs: string[];
    inputEventRefs: string[];
    artifactValidatorRefs: string[];
    afterEvidenceRefs: string[];
  }>;
  artifactVerification: {
    status: 'passed' | 'blocked' | 'failed';
    fileExists: boolean;
    contentContainsExpectedText: boolean;
    contentSha1: string;
  };
  desktopSoftwareTaskEvidence: DesktopSoftwareTaskEvidenceGate;
  finalAnswerRef?: string;
  blockedReasons: string[];
  nextActions: string[];
}

export interface RunAppiumTextEditLiveAcceptanceOptions {
  env?: NodeJS.ProcessEnv;
  workspacePath?: string;
  outputDir?: string;
  artifactPath?: string;
  serverUrl?: string;
  text?: string;
  now?: () => Date;
  client?: AppiumMac2WindowActionClient;
}

const OPT_IN_ENV = 'SCIFORGE_T1_APPIUM_TEXTEDIT_LIVE';
const SERVER_ENV = 'SCIFORGE_APPIUM_MAC2_SERVER_URL';
const ARTIFACT_ENV = 'SCIFORGE_T1_TEXTEDIT_ARTIFACT_PATH';
const DEFAULT_TEXT = [
  'SciForge T1 Appium TextEdit live acceptance',
  'Scoped executor: appium-mac2',
  'Artifact verifier: TextEdit source matched saved file',
].join('\n');

export async function runAppiumTextEditLiveAcceptance(
  options: RunAppiumTextEditLiveAcceptanceOptions = {},
): Promise<AppiumTextEditLiveAcceptanceManifest> {
  const env = options.env ?? process.env;
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'test-artifacts', 'appium-textedit-live-acceptance'));
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const serverUrl = options.serverUrl ?? env[SERVER_ENV];
  const artifactPath = options.artifactPath ?? env[ARTIFACT_ENV];
  const text = options.text ?? DEFAULT_TEXT;
  const readiness = readinessSummary(env, artifactPath);
  const target = targetSummary(workspacePath, artifactPath);
  if (readiness.missing.length) {
    const manifest = baseManifest({ checkedAt, readiness, target, blockedReasons: readiness.missing });
    await writeManifest(outputDir, manifest);
    return manifest;
  }

  const validator = createTextEditSavedArtifactValidator({ artifactPath });
  if (!validator) {
    const manifest = baseManifest({
      checkedAt,
      readiness,
      target,
      blockedReasons: ['invalid-artifact-path: must be an absolute non-secret local path'],
    });
    await writeManifest(outputDir, manifest);
    return manifest;
  }

  const client = options.client ?? createAppiumMac2WebDriverClient({
    validateSavedArtifact: validator,
    timeoutMs: 15_000,
  });
  const adapter = createAppiumMac2WindowActionAdapter({
    serverUrl,
    executorEnabled: true,
    client,
  });
  const session = createWindowActionSession({
    id: 't1-textedit-live',
    windowRef: 'appium-mac2:textedit/live-target-window',
    app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
    screenId: 'macos-main-screen',
    timestamp: checkedAt,
    evidenceRefs: [{ kind: 'appium-mac2-readiness', ref: 'appium-mac2:textedit/readiness/opt-in-live' }],
  });
  const beforeEvidenceRefs = [{ kind: 'observe-before-mutate', ref: 'appium-mac2:textedit/live-target-window/current-observation' }];
  const observeBeforeMutate = {
    status: 'current',
    observedAt: checkedAt,
    freshnessCheckedAt: checkedAt,
    screenId: 'macos-main-screen',
    windowRef: session.windowRef,
    freshnessCheck: {
      status: 'current',
      observedAt: checkedAt,
      checkedAt,
      expiresAt: new Date(Date.parse(checkedAt) + 30_000).toISOString(),
      maxAgeMs: 30_000,
    },
  };

  const typeResult = await dispatchWindowAction(session, {
    actionId: 't1-type-report',
    action: 'type',
    status: 'running',
    timestamp: checkedAt,
    text,
    textLength: text.length,
    targetDescription: artifactPath,
    target: textEditTarget(),
    beforeEvidenceRefs,
    observeBeforeMutate,
  }, { 'appium-mac2': adapter }, { agentId: 'ordinary-chat' });
  const saveResult = typeResult.adapterResult.status === 'completed'
    ? await dispatchWindowAction(typeResult.session, {
        actionId: 't1-save-report',
        action: 'save',
        status: 'running',
        timestamp: checkedAt,
        targetDescription: artifactPath,
        target: textEditTarget(),
        beforeEvidenceRefs,
        observeBeforeMutate,
      }, { 'appium-mac2': adapter }, { agentId: 'ordinary-chat' })
    : undefined;

  const artifactVerification = await verifyArtifact(artifactPath, text);
  const actions = [
    actionSummary('type', typeResult.adapterResult),
    ...(saveResult ? [actionSummary('save', saveResult.adapterResult)] : []),
  ];
  const actionGroundingRefs = [
    `window-action-session:${session.id}/actions/t1-type-report/action-grounding.json`,
    `window-action-session:${session.id}/actions/t1-save-report/gui-save-command.json`,
  ];
  const finalAnswerRef = `window-action-session:${session.id}/final-answer/summary.md`;
  const desktopSoftwareTaskEvidence = validateDesktopSoftwareTaskEvidence({
    targetWindowRef: session.windowRef,
    beforeEvidenceRefs: refs(beforeEvidenceRefs),
    actionGroundingRefs,
    executorEventRefs: actions.flatMap((action) => action.evidenceRefs),
    afterEvidenceRefs: actions.flatMap((action) => action.afterEvidenceRefs),
    artifactRefs: [target.artifactRef],
    artifactValidationRefs: actions.flatMap((action) => action.artifactValidatorRefs),
    finalAnswerRefs: [finalAnswerRef],
    fileCreationOwner: 'scoped-gui-save',
    sharedSystemInputUsed: false,
    workspaceWriterUsed: false,
    shellWriterUsed: false,
  });
  const blockedReasons = [
    typeResult.adapterResult.status !== 'completed' ? typeResult.adapterResult.blockedReason ?? 'type-action-not-completed' : undefined,
    !saveResult ? 'save-action-not-attempted' : undefined,
    saveResult && saveResult.adapterResult.status !== 'completed' ? saveResult.adapterResult.blockedReason ?? 'save-action-not-completed' : undefined,
    artifactVerification.status !== 'passed' ? 'artifact-content-verification-not-passed' : undefined,
    ...(desktopSoftwareTaskEvidence.status === 'passed'
      ? []
      : desktopSoftwareTaskEvidence.missing.map((item) => `desktop-software-task-evidence:${item}`)),
  ].filter((item): item is string => Boolean(item));
  const routeAdapters = [typeResult.route.adapter, saveResult?.route.adapter].filter((item): item is 'appium-mac2' => item === 'appium-mac2');
  const scopedInputAdapterRefs = [
    typeResult.scopedInputAdapter.ref,
    saveResult?.scopedInputAdapter.ref,
  ].filter((item): item is string => Boolean(item));
  const focusLeaseRefs = [
    focusLeaseRef(typeResult.focusLease),
    focusLeaseRef(saveResult?.focusLease),
  ].filter((item): item is string => Boolean(item));
  const manifest: AppiumTextEditLiveAcceptanceManifest = {
    ...baseManifest({ checkedAt, readiness, target, blockedReasons }),
    status: blockedReasons.length ? 'failed' : 'passed',
    passClaim: blockedReasons.length === 0,
    scopedExecutor: {
      adapter: 'appium-mac2',
      executorEnabled: true,
      routeAdapters,
      scopedInputAdapterRefs,
      focusLeaseRefs,
    },
    actions,
    artifactVerification,
    desktopSoftwareTaskEvidence,
    finalAnswerRef,
    nextActions: blockedReasons.length ? liveNextActions() : [],
  };
  await writeManifest(outputDir, manifest);
  return manifest;
}

function baseManifest(input: {
  checkedAt: string;
  readiness: AppiumTextEditLiveAcceptanceManifest['readiness'];
  target: AppiumTextEditLiveAcceptanceManifest['target'];
  blockedReasons: string[];
}): AppiumTextEditLiveAcceptanceManifest {
  return {
    schemaVersion: APPIUM_TEXTEDIT_LIVE_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    passClaim: false,
    runner: 'runtime-codex-appium-textedit-live-acceptance',
    source: 'ordinary-chat-to-scoped-appium-textedit-live-target',
    checkedAt: input.checkedAt,
    evidenceMode: 'opt-in-live-appium-textedit-current-host',
    forbiddenSubstitutes: {
      fixtures: false,
      workspaceWriter: false,
      sharedSystemInput: false,
      generatedFileOnly: false,
    },
    readiness: input.readiness,
    target: input.target,
    scopedExecutor: {
      adapter: 'appium-mac2',
      executorEnabled: false,
      routeAdapters: [],
      scopedInputAdapterRefs: [],
      focusLeaseRefs: [],
    },
    actions: [],
    artifactVerification: {
      status: 'blocked',
      fileExists: false,
      contentContainsExpectedText: false,
      contentSha1: sha1(''),
    },
    desktopSoftwareTaskEvidence: validateDesktopSoftwareTaskEvidence({}),
    blockedReasons: input.blockedReasons,
    nextActions: liveNextActions(),
  };
}

function readinessSummary(env: NodeJS.ProcessEnv, artifactPath: string | undefined): AppiumTextEditLiveAcceptanceManifest['readiness'] {
  const requiredEnv = [
    { name: OPT_IN_ENV, present: env[OPT_IN_ENV] === '1', valuePrinted: false as const },
    { name: SERVER_ENV, present: Boolean(env[SERVER_ENV]), valuePrinted: false as const },
    { name: ARTIFACT_ENV, present: Boolean(artifactPath), valuePrinted: false as const },
  ];
  const missing = [
    process.platform !== 'darwin' ? 'platform-not-darwin' : undefined,
    ...requiredEnv.filter((item) => !item.present).map((item) => `missing-env:${item.name}`),
  ].filter((item): item is string => Boolean(item));
  return {
    optInEnv: OPT_IN_ENV,
    requiredEnv,
    platform: process.platform,
    missing,
  };
}

function targetSummary(workspacePath: string, artifactPath: string | undefined): AppiumTextEditLiveAcceptanceManifest['target'] {
  return {
    appName: 'TextEdit',
    bundleId: 'com.apple.TextEdit',
    windowRef: 'appium-mac2:textedit/live-target-window',
    artifactPathConfigured: Boolean(artifactPath && isAbsolute(artifactPath)),
    artifactRef: artifactPath && isAbsolute(artifactPath) ? artifactPathRef(workspacePath, artifactPath) : '',
  };
}

function textEditTarget() {
  return {
    app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' as const },
    capabilities: { appiumMac2: true, accessibility: true },
  };
}

function actionSummary(action: 'type' | 'save', result: WindowActionAdapterResult): AppiumTextEditLiveAcceptanceManifest['actions'][number] {
  return {
    action,
    status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'blocked',
    ...(result.blockedReason ? { blockedReason: result.blockedReason } : {}),
    evidenceRefs: refs(result.evidenceRefs),
    inputEventRefs: refs(result.inputEventRefs),
    artifactValidatorRefs: refs(result.artifactValidatorRefs),
    afterEvidenceRefs: refs(result.afterEvidenceRefs),
  };
}

async function verifyArtifact(artifactPath: string | undefined, expectedText: string): Promise<AppiumTextEditLiveAcceptanceManifest['artifactVerification']> {
  if (!artifactPath || !isAbsolute(artifactPath)) {
    return { status: 'blocked', fileExists: false, contentContainsExpectedText: false, contentSha1: sha1('') };
  }
  try {
    const text = await readFile(artifactPath, 'utf8');
    const contentContainsExpectedText = text.includes(expectedText);
    return {
      status: contentContainsExpectedText ? 'passed' : 'failed',
      fileExists: true,
      contentContainsExpectedText,
      contentSha1: sha1(text),
    };
  } catch {
    return { status: 'failed', fileExists: false, contentContainsExpectedText: false, contentSha1: sha1('') };
  }
}

async function writeManifest(outputDir: string, manifest: AppiumTextEditLiveAcceptanceManifest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function refs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item && typeof item === 'object' && typeof (item as { ref?: unknown }).ref === 'string') return [(item as { ref: string }).ref];
    return [];
  }).filter(safeEvidenceRef);
}

function focusLeaseRef(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const ref = (value as { ref?: unknown }).ref;
  return typeof ref === 'string' && safeEvidenceRef(ref) ? ref : undefined;
}

function liveNextActions(): string[] {
  return [
    `Set ${OPT_IN_ENV}=1.`,
    `Set ${SERVER_ENV}=http://127.0.0.1:4723 for a running Appium Mac2 server.`,
    `Set ${ARTIFACT_ENV} to the absolute path of the TextEdit document currently open and bound to the target window.`,
    'Run the entrypoint only on macOS with TextEdit focused on that document; no workspace writer, fixtures, or shared system input can satisfy this runner.',
  ];
}

function artifactPathRef(workspacePath: string, filePath: string) {
  const workspace = resolve(workspacePath);
  const file = resolve(filePath);
  const scope = file === workspace || file.startsWith(`${workspace}/`) ? 'workspace' : 'external';
  return `appium-mac2:textedit/artifacts/${scope}-${sha1(file).slice(0, 12)}`;
}

function safeEvidenceRef(value: string): boolean {
  if (!value || value.length > 240) return false;
  if (/https?:\/\/|file:\/\/|\/tmp|secret|token|password|api[-_]?key|bearer|workspace-file-writer|shared-system-input|osascript|CGEvent|base64/i.test(value)) return false;
  return /^(appium-mac2:textedit|window-action-session:t1-textedit-live)\//.test(value);
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}
