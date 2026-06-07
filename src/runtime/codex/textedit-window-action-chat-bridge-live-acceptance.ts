import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { AppiumMac2WindowActionClient } from './appium-mac2-window-action-adapter.js';
import { evaluateCodexAgentHostTurnLoop } from './agent-host-turn-loop.js';
import { createTextEditWindowActionChatBridge } from './textedit-window-action-chat-bridge.js';

export const TEXTEDIT_WINDOW_ACTION_CHAT_BRIDGE_LIVE_ACCEPTANCE_SCHEMA_VERSION =
  'sciforge.textedit-window-action-chat-bridge-live-acceptance.v1' as const;

export interface TextEditWindowActionChatBridgeLiveAcceptanceManifest {
  schemaVersion: typeof TEXTEDIT_WINDOW_ACTION_CHAT_BRIDGE_LIVE_ACCEPTANCE_SCHEMA_VERSION;
  status: 'passed' | 'blocked';
  passClaim: boolean;
  productReady: false;
  runner: 'runtime-codex-textedit-window-action-chat-bridge-live-acceptance';
  source: 'ordinary-chat-agent-host-to-scoped-appium-textedit';
  checkedAt: string;
  sharedSystemInputUsed: false;
  workspaceWriterUsed: false;
  shellWriterUsed: false;
  readiness: {
    requiredEnv: Array<{ name: string; present: boolean; valuePrinted: false }>;
    missing: string[];
  };
  target: {
    appName: 'TextEdit';
    bundleId: 'com.apple.TextEdit';
    artifactPathConfigured: boolean;
    artifactRef: string;
  };
  finalAnswer: {
    status: 'completed' | 'blocked' | 'needs-confirmation';
    userTaskCompletionClaimed: boolean;
    reason?: string;
  };
  evidenceRefs: string[];
  releaseEvidenceRefs: string[];
  artifactValidatorRefs: string[];
  blockedReasons: string[];
  nextActions: string[];
}

export interface RunTextEditWindowActionChatBridgeLiveAcceptanceOptions {
  workspacePath?: string;
  outputDir?: string;
  env?: Record<string, string | undefined>;
  artifactPath?: string;
  commandText?: string;
  now?: () => Date;
  appiumMac2Client?: AppiumMac2WindowActionClient;
}

const OPT_IN_ENV = 'SCIFORGE_T1_TEXTEDIT_CHAT_BRIDGE_LIVE';
const REQUIRED_ENV = [
  OPT_IN_ENV,
  'SCIFORGE_WINDOW_ACTION_APPIUM_MAC2',
  'SCIFORGE_APPIUM_MAC2_EXECUTOR',
  'SCIFORGE_APPIUM_MAC2_SERVER_URL',
  'SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH',
] as const;

export async function runTextEditWindowActionChatBridgeLiveAcceptance(
  options: RunTextEditWindowActionChatBridgeLiveAcceptanceOptions = {},
): Promise<TextEditWindowActionChatBridgeLiveAcceptanceManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'test-artifacts', 'textedit-window-action-chat-bridge-live'));
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const env = options.env ?? process.env;
  const artifactPath = options.artifactPath ?? env.SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH;
  const readiness = readinessSummary(env, artifactPath);
  const target = targetSummary(workspacePath, artifactPath);
  if (readiness.missing.length) {
    return writeManifest(outputDir, baseManifest({
      checkedAt,
      readiness,
      target,
      blockedReasons: readiness.missing,
    }));
  }

  const commandText = options.commandText
    ?? `Operate the TextEdit window and press Save for the visible document to ${artifactPath}.`;
  const bridge = createTextEditWindowActionChatBridge({
    commandText,
    workspacePath,
    env: env as NodeJS.ProcessEnv,
    appiumMac2Client: options.appiumMac2Client,
    now: options.now,
  });
  if (!bridge) {
    return writeManifest(outputDir, baseManifest({
      checkedAt,
      readiness,
      target,
      blockedReasons: ['textedit-window-action-chat-bridge-unavailable'],
    }));
  }

  const turn = await evaluateCodexAgentHostTurnLoop({
    input: ordinaryChatInput(commandText),
    commandText,
    workspacePath,
    commandId: 'textedit-chat-live',
    attemptId: 'textedit-chat-live-attempt-1',
    runtimeTruth: bridge.runtimeTruth,
    computerUseActMaterializer: bridge.computerUseActMaterializer,
  });
  const evidenceRefs = safeEvidenceRefs(turn?.result.evidenceRefs);
  const finalStatus = finalAnswerStatus(turn?.result);
  const releaseEvidenceRefs = releaseRefs(evidenceRefs);
  const artifactValidatorRefs = evidenceRefs.filter((ref) => /artifact-validator/i.test(ref));
  const blockedReasons = [
    !turn ? 'agent-host-turn-loop-did-not-return-result' : undefined,
    finalStatus === 'needs-confirmation' ? 'final-answer-needs-confirmation' : undefined,
    evidenceRefs.some((ref) => /save-input/.test(ref)) ? undefined : 'missing-save-input-event-ref',
    artifactValidatorRefs.length ? undefined : 'missing-artifact-validator-ref',
    releaseEvidenceRefs.some((ref) => /control\/remove/i.test(ref)) ? undefined : 'missing-release-control-ref',
    releaseEvidenceRefs.some((ref) => /^input-lease:/i.test(ref)) ? undefined : 'missing-input-lease-release-ref',
    releaseEvidenceRefs.some((ref) => /^scoped-input-adapter:/i.test(ref)) ? undefined : 'missing-input-adapter-release-ref',
    releaseEvidenceRefs.some((ref) => /^actor-cursor:/i.test(ref)) ? undefined : 'missing-cursor-release-ref',
  ].filter((item): item is string => Boolean(item));

  const manifest: TextEditWindowActionChatBridgeLiveAcceptanceManifest = {
    ...baseManifest({ checkedAt, readiness, target, blockedReasons }),
    status: blockedReasons.length ? 'blocked' : 'passed',
    passClaim: blockedReasons.length === 0,
    finalAnswer: {
      status: finalStatus,
      userTaskCompletionClaimed: finalStatus === 'completed',
      ...(safeReason(turn?.result.message) ? { reason: safeReason(turn?.result.message) } : {}),
    },
    evidenceRefs,
    releaseEvidenceRefs,
    artifactValidatorRefs,
    nextActions: blockedReasons.length ? nextActions() : [],
  };
  return writeManifest(outputDir, manifest);
}

function baseManifest(input: {
  checkedAt: string;
  readiness: TextEditWindowActionChatBridgeLiveAcceptanceManifest['readiness'];
  target: TextEditWindowActionChatBridgeLiveAcceptanceManifest['target'];
  blockedReasons: string[];
}): TextEditWindowActionChatBridgeLiveAcceptanceManifest {
  return {
    schemaVersion: TEXTEDIT_WINDOW_ACTION_CHAT_BRIDGE_LIVE_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    passClaim: false,
    productReady: false,
    runner: 'runtime-codex-textedit-window-action-chat-bridge-live-acceptance',
    source: 'ordinary-chat-agent-host-to-scoped-appium-textedit',
    checkedAt: input.checkedAt,
    sharedSystemInputUsed: false,
    workspaceWriterUsed: false,
    shellWriterUsed: false,
    readiness: input.readiness,
    target: input.target,
    finalAnswer: {
      status: 'blocked',
      userTaskCompletionClaimed: false,
    },
    evidenceRefs: [],
    releaseEvidenceRefs: [],
    artifactValidatorRefs: [],
    blockedReasons: input.blockedReasons,
    nextActions: nextActions(),
  };
}

async function writeManifest(
  outputDir: string,
  manifest: TextEditWindowActionChatBridgeLiveAcceptanceManifest,
): Promise<TextEditWindowActionChatBridgeLiveAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function readinessSummary(
  env: Record<string, string | undefined>,
  artifactPath: string | undefined,
): TextEditWindowActionChatBridgeLiveAcceptanceManifest['readiness'] {
  const requiredEnv = REQUIRED_ENV.map((name) => ({
    name,
    present: name === OPT_IN_ENV || name === 'SCIFORGE_WINDOW_ACTION_APPIUM_MAC2' || name === 'SCIFORGE_APPIUM_MAC2_EXECUTOR'
      ? enabled(env[name])
      : Boolean(name === 'SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH' ? artifactPath : env[name]),
    valuePrinted: false as const,
  }));
  return {
    requiredEnv,
    missing: requiredEnv.filter((item) => !item.present).map((item) => `missing-env:${item.name}`),
  };
}

function targetSummary(workspacePath: string, artifactPath: string | undefined): TextEditWindowActionChatBridgeLiveAcceptanceManifest['target'] {
  return {
    appName: 'TextEdit',
    bundleId: 'com.apple.TextEdit',
    artifactPathConfigured: Boolean(artifactPath && isAbsolute(artifactPath)),
    artifactRef: artifactPath && isAbsolute(artifactPath)
      ? `appium-mac2:textedit/artifacts/${artifactScope(workspacePath, artifactPath)}-${sha1(resolve(artifactPath)).slice(0, 12)}`
      : '',
  };
}

function ordinaryChatInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ordinary-chat-live-acceptance',
    intentText,
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: [],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function finalAnswerStatus(result: Record<string, unknown> | undefined): 'completed' | 'blocked' | 'needs-confirmation' {
  const displayIntent = isRecord(result?.displayIntent) ? result.displayIntent : {};
  const status = typeof displayIntent.status === 'string' ? displayIntent.status : typeof result?.status === 'string' ? result.status : 'blocked';
  return status === 'completed' || status === 'needs-confirmation' ? status : 'blocked';
}

function releaseRefs(refs: string[]): string[] {
  return refs.filter((ref) => /(?:control\/remove|^input-lease:|^scoped-input-adapter:|^actor-cursor:)/i.test(ref));
}

function safeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && safeEvidenceRef(item)))].slice(0, 64);
}

function safeEvidenceRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/https?:\/\/|file:\/\/|\/tmp|secret|token|password|api[-_]?key|bearer|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|raw/i.test(trimmed)) return false;
  return /^(?:window-action-session:|appium-mac2:textedit|computer-use:|action-ledger:|input-lease:|scoped-input-adapter:|actor-cursor:|adapter-registry:|permission:|runtime-truth:|accessibility-ui-automation:|desktop-window:)/i.test(trimmed);
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /https?:\/\/|file:\/\/|\/tmp|secret|token|password|api[-_]?key|bearer/i.test(text)) return undefined;
  return text.slice(0, 360);
}

function nextActions(): string[] {
  return [
    `Set ${OPT_IN_ENV}=1 for live acceptance.`,
    'Run on macOS with a visible TextEdit document and a loopback Appium Mac2 server.',
    'Keep product-ready blocked until a current-run completion bundle is attached to the Agent Host answer.',
  ];
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on|enabled)$/i.test(value?.trim() ?? '');
}

function artifactScope(workspacePath: string, artifactPath: string): 'workspace' | 'external' {
  const workspace = resolve(workspacePath);
  const artifact = resolve(artifactPath);
  return artifact === workspace || artifact.startsWith(`${workspace}/`) ? 'workspace' : 'external';
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
