import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readRequiredLocalProviderSettings, type LocalProviderSettings } from '../../packages/backend/src/local-provider-config.js';
import {
  writeRuntimeCodexBrowserOrdinaryChatAcceptance,
  type RuntimeCodexBrowserOrdinaryChatAcceptanceManifest,
  type RuntimeCodexBrowserOrdinaryChatAcceptanceOptions,
} from './runtime-codex-browser-ordinary-chat-acceptance-writer.js';
import { sha1 } from './workspace-task-runner.js';

export const RUNTIME_CODEX_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_SCHEMA_VERSION =
  'sciforge.runtime-codex.browser-ordinary-chat-local-dogfood.v1' as const;

export interface RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest {
  schemaVersion: typeof RUNTIME_CODEX_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_SCHEMA_VERSION;
  status: 'passed' | 'blocked' | 'failed';
  source: 'runtime-codex-ordinary-chat-local-dogfood';
  observedAt: string;
  commandId: string;
  taskPromptDigest: {
    length: number;
    sha1: string;
  };
  localConfig: {
    present: boolean;
    providerPresent: boolean;
    modelPresent: boolean;
    upstreamBaseUrlPresent: boolean;
    apiKeyPresent: boolean;
    source: 'config.local.json';
    secretValuesRedacted: true;
  };
  ordinaryChatAcceptance: {
    status: 'passed' | 'blocked';
    manifestRef: string;
    startedFromDefaultChatEntry: boolean;
    submittedThroughRuntimeCodex: boolean;
    acceptanceConclusionFromRealBrowser: boolean;
    evidenceRefs: string[];
  };
  releaseEligible: false;
  releaseBlocking: true;
  blockedReason?: string;
  releaseGate: {
    status: 'local-dogfood-only';
    strictReleaseStillRequiresServiceEnv: true;
    retestCommand: string;
  };
}

export interface RunRuntimeCodexBrowserOrdinaryChatLocalDogfoodOptions {
  workspacePath?: string;
  configPath?: string;
  outputDir?: string;
  commandText?: string;
  commandId?: string;
  attemptId?: string;
  now?: () => Date;
  writer?: (options: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions) => Promise<RuntimeCodexBrowserOrdinaryChatAcceptanceManifest>;
}

const DEFAULT_COMMAND_TEXT = '请用 SciForge 内置浏览器打开并读取 https://platform.openai.com/docs/changelog ，用中文总结最近的 OpenAI 产品更新，并列出来源链接。';

export async function runRuntimeCodexBrowserOrdinaryChatLocalDogfood(
  options: RunRuntimeCodexBrowserOrdinaryChatLocalDogfoodOptions = {},
): Promise<RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'evolve', 'runs', 'runtime-codex-browser-ordinary-chat-local-dogfood'));
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const commandText = options.commandText ?? DEFAULT_COMMAND_TEXT;
  const commandId = options.commandId ?? `browser-ordinary-chat-local-${sha1(`${observedAt}:${commandText}`).slice(0, 12)}`;
  const attemptId = options.attemptId ?? `${commandId}-attempt`;
  const acceptanceOutputDir = join(outputDir, 'ordinary-chat-acceptance');

  let settings: LocalProviderSettings;
  try {
    settings = readRequiredLocalProviderSettings(options.configPath);
  } catch {
    return writeLocalManifest(outputDir, {
      ...baseManifest({ observedAt, commandId, commandText }),
      status: 'blocked',
      blockedReason: 'Blocked: config.local.json provider settings are unavailable for local dogfood.',
    });
  }

  try {
    const writer = options.writer ?? writeRuntimeCodexBrowserOrdinaryChatAcceptance;
    const acceptance = await writer({
      workspacePath,
      outputDir: acceptanceOutputDir,
      commandText,
      commandId,
      attemptId,
    });
    const evidenceRefs = boundedRefs([
      ...(acceptance.actualTaskResult?.evidenceRefs ?? []),
      ...(acceptance.liveRuntimeCodexProof?.eventEvidenceRefs ?? []),
    ]);
    const status = acceptance.status === 'passed' ? 'passed' : 'failed';
    return writeLocalManifest(outputDir, {
      ...baseManifest({ observedAt, commandId, commandText, settings }),
      status,
      blockedReason: status === 'passed'
        ? undefined
        : `Ordinary-chat acceptance did not pass: ${safeReason(acceptance.reason)}`,
      ordinaryChatAcceptance: {
        status: acceptance.status,
        manifestRef: 'artifact:runtime-codex-browser-ordinary-chat-local-dogfood/ordinary-chat-acceptance/manifest.json',
        startedFromDefaultChatEntry: acceptance.startedFromDefaultChatEntry,
        submittedThroughRuntimeCodex: acceptance.submittedThroughRuntimeCodex,
        acceptanceConclusionFromRealBrowser: acceptance.acceptanceConclusionFromRealBrowser,
        evidenceRefs,
      },
    });
  } catch {
    return writeLocalManifest(outputDir, {
      ...baseManifest({ observedAt, commandId, commandText, settings }),
      status: 'failed',
      blockedReason: 'Ordinary-chat local dogfood writer failed without producing acceptance evidence.',
    });
  }
}

function baseManifest(input: {
  observedAt: string;
  commandId: string;
  commandText: string;
  settings?: LocalProviderSettings;
}): RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest {
  return {
    schemaVersion: RUNTIME_CODEX_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_SCHEMA_VERSION,
    status: 'blocked',
    source: 'runtime-codex-ordinary-chat-local-dogfood',
    observedAt: input.observedAt,
    commandId: input.commandId,
    taskPromptDigest: {
      length: Buffer.byteLength(input.commandText, 'utf8'),
      sha1: sha1(input.commandText),
    },
    localConfig: input.settings ? localConfigEvidence(input.settings) : {
      present: false,
      providerPresent: false,
      modelPresent: false,
      upstreamBaseUrlPresent: false,
      apiKeyPresent: false,
      source: 'config.local.json',
      secretValuesRedacted: true,
    },
    ordinaryChatAcceptance: {
      status: 'blocked',
      manifestRef: 'artifact:runtime-codex-browser-ordinary-chat-local-dogfood/ordinary-chat-acceptance/manifest.json',
      startedFromDefaultChatEntry: false,
      submittedThroughRuntimeCodex: false,
      acceptanceConclusionFromRealBrowser: false,
      evidenceRefs: [],
    },
    releaseEligible: false,
    releaseBlocking: true,
    releaseGate: {
      status: 'local-dogfood-only',
      strictReleaseStillRequiresServiceEnv: true,
      retestCommand: 'npm run smoke:runtime-codex-browser-acceptance:strict',
    },
  };
}

async function writeLocalManifest(
  outputDir: string,
  manifest: RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest,
): Promise<RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function localConfigEvidence(settings: LocalProviderSettings): RuntimeCodexBrowserOrdinaryChatLocalDogfoodManifest['localConfig'] {
  return {
    present: true,
    providerPresent: Boolean(settings.provider),
    modelPresent: Boolean(settings.model),
    upstreamBaseUrlPresent: Boolean(settings.baseUrl),
    apiKeyPresent: Boolean(settings.apiKey),
    source: 'config.local.json',
    secretValuesRedacted: true,
  };
}

function boundedRefs(values: string[]): string[] {
  return [...new Set(values.filter((value) => (
    value.length <= 260
    && /^(browser-host-session:|runtime-truth:module\.invoke\/browser\.|action-ledger:browser\.executeBoundedOperation\/|artifact:runtime-codex-browser-acceptance\/)/.test(value)
    && !/https?:\/\/|file:\/\/|\/tmp|secret|token|password|api[-_]?key|bearer|base64|workspace-file-writer|shared-system-input/i.test(value)
  )))];
}

function safeReason(value: string | undefined): string {
  if (!value) return 'no blocked reason was recorded';
  if (/missing .*source|BrowserHostSession|final-answer|ordinary-chat/i.test(value)) return value;
  return 'acceptance writer returned a blocked result';
}
