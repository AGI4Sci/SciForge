import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  BrowserHostSessionManager,
  createPlaywrightBrowserHostDriverFactory,
  defaultBrowserHostSessionManager,
} from './browser-host-session.js';
import type { BrowserRuntimeModulePorts } from './modules/bounded-operation-module-handlers.js';

export interface RuntimeCodexBrowserOrdinaryChatAcceptanceOptions {
  workspacePath: string;
  outputDir: string;
  commandText: string;
  commandId: string;
  attemptId: string;
  browserRuntimeModulePorts?: BrowserRuntimeModulePorts;
  now?: () => Date;
}

export type RuntimeCodexBrowserOrdinaryChatAcceptanceManifest = {
  schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1';
  status: 'passed' | 'blocked';
  source: 'codex-in-app-browser';
  observedAt: string;
  commandId: string;
  startedFromDefaultChatEntry: boolean;
  submittedThroughRuntimeCodex: boolean;
  providerModelProfileVisible: boolean;
  workspaceVisible: boolean;
  commandIdVisible: boolean;
  mainAnswerVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  automationSubstituteUsed: false;
  seedDemoFixtureEvidenceUsed: false;
  acceptanceConclusionFromRealBrowser: boolean;
  seedOrDemoMessagesExcluded: true;
  liveAcceptanceScope: 'non-seed-runtime-codex-messages-only';
  releaseBlocking: boolean;
  releaseEligible: boolean;
  reason?: string;
  acceptanceRubric?: {
    userIntent: string;
    expectedObservableResult: string;
    actualResult: string;
    evidenceRefs: string[];
    negativeChecks: string[];
    remainingRisks: string;
  };
  actualTaskResult?: {
    status: 'passed' | 'blocked';
    summary: string;
    userIntentSatisfied: boolean;
    outputVerified: boolean;
    evidenceRefs: string[];
  };
  liveRuntimeCodexProof?: {
    messageProvenance: 'live-runtime-codex' | 'unknown';
    commandId: string;
    nativeDefaultChatAssistantAnswerRendered: boolean;
    runtimeOutputObserved: boolean;
    seedOrDemoExcluded: boolean;
    eventEvidenceRefs: string[];
  };
  evidence?: {
    notesPath?: string;
    runtimeAuditPath?: string;
  };
};

export async function writeRuntimeCodexBrowserOrdinaryChatAcceptance(
  options: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions,
): Promise<RuntimeCodexBrowserOrdinaryChatAcceptanceManifest> {
  const outputDir = resolve(options.outputDir);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  await mkdir(outputDir, { recursive: true });
  return writeManifest(outputDir, {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt,
    commandId: options.commandId,
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    workspaceVisible: true,
    commandIdVisible: true,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: false,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    releaseBlocking: true,
    releaseEligible: false,
    reason: 'Retired: ordinary-chat Browser acceptance must flow through the unified Runtime Codex app-server / Model Router tool protocol, not an Agent Host Browser bypass.',
    evidence: { notesPath: 'blocked-runtime-codex-browser-ordinary-chat.md' },
  });
}

export function runtimeCodexBrowserOrdinaryChatBrowserHostAdapterMode(
  env: Record<string, string | undefined> = process.env,
): 'native-adapter' | 'playwright-fallback' {
  return env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL?.trim() ? 'native-adapter' : 'playwright-fallback';
}

export function createRuntimeCodexBrowserOrdinaryChatBrowserHostSessionManager(
  env: Record<string, string | undefined> = process.env,
): BrowserHostSessionManager {
  if (runtimeCodexBrowserOrdinaryChatBrowserHostAdapterMode(env) === 'native-adapter') {
    return defaultBrowserHostSessionManager();
  }
  return new BrowserHostSessionManager({ driverFactory: createPlaywrightBrowserHostDriverFactory() });
}

export async function closeRuntimeCodexBrowserOrdinaryChatBrowserSessions(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  refs: string[],
): Promise<void> {
  const sessionIds = browserHostSessionIdsFromRefs(refs);
  await Promise.all(sessionIds.map((sessionId) => (
    manager.act(workspacePath, sessionId, { action: 'close', capture: 'none', timeoutMs: 5_000 }).catch(() => undefined)
  )));
}

function browserHostSessionIdsFromRefs(refs: string[]): string[] {
  return [...new Set(refs.flatMap((ref) => {
    const match = /^browser-host-session:([^/]+)/.exec(ref);
    return match?.[1] ? [match[1]] : [];
  }))];
}

async function writeManifest(
  outputDir: string,
  manifest: RuntimeCodexBrowserOrdinaryChatAcceptanceManifest,
): Promise<RuntimeCodexBrowserOrdinaryChatAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (manifest.status === 'blocked') {
    await writeFile(join(outputDir, 'blocked-runtime-codex-browser-ordinary-chat.md'), `# Runtime Codex browser ordinary-chat acceptance blocked\n\nReason: ${manifest.reason ?? 'unknown'}\n`, 'utf8');
  } else {
    await rm(join(outputDir, 'blocked-runtime-codex-browser-ordinary-chat.md'), { force: true });
  }
  return manifest;
}
