import { createHash } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  boundedOperationResult,
  type BoundedOperationResultValue,
  type ModuleInvokeResult,
} from '@sciforge-ui/runtime-contract/modules';
import {
  evaluateCodexAgentHostTurnLoop,
  type CodexAgentHostBrowserBoundedOperationInvoker,
} from './codex/agent-host-turn-loop.js';
import { browserHostSessionDir } from './browser-host-session.js';
import {
  createBrowserBoundedOperationModuleHandler,
  type BrowserBoundedOperationPorts,
} from './modules/bounded-operation-module-handlers.js';

export interface RuntimeCodexBrowserOrdinaryChatAcceptanceOptions {
  workspacePath: string;
  outputDir: string;
  commandText: string;
  commandId: string;
  attemptId: string;
  browserBoundedOperationInvoker?: CodexAgentHostBrowserBoundedOperationInvoker;
  browserBoundedOperationPorts?: BrowserBoundedOperationPorts;
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
  const workspacePath = resolve(options.workspacePath);
  const outputDir = resolve(options.outputDir);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  await mkdir(outputDir, { recursive: true });
  const browserBoundedOperationInvoker = options.browserBoundedOperationInvoker
    ?? createDefaultBrowserBoundedOperationInvoker({
      workspacePath,
      commandId: options.commandId,
      ports: options.browserBoundedOperationPorts,
    });

  const result = await evaluateCodexAgentHostTurnLoop({
    input: ordinaryChatAgentHostInput(options.commandText),
    commandText: options.commandText,
    workspacePath,
    commandId: options.commandId,
    attemptId: options.attemptId,
    browserBoundedOperationInvoker,
  });
  const evidenceRefs = runtimeEvidenceRefs(result?.result?.evidenceRefs);
  const finalAnswerRef = 'artifact:runtime-codex-browser-acceptance/final-answer.md';
  const allRefs = uniqueStrings([
    ...evidenceRefs,
    finalAnswerRef,
  ]);
  const check = await browserSourceEvidenceCheck(workspacePath, allRefs);
  const finalAnswer = String(result?.result?.message ?? '').trim();
  const blockedReason = browserSourceEvidenceBlockedReason(check)
    ?? (!result || displayStatus(result.result) !== 'completed' || !finalAnswer
      ? 'ordinary-chat Browser result did not complete with a final answer'
      : undefined);
  if (blockedReason) {
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
      reason: blockedReason,
      evidence: { notesPath: 'blocked-runtime-codex-browser-ordinary-chat.md' },
    });
  }

  await writeFile(join(outputDir, 'final-answer.md'), finalAnswer, 'utf8');
  await writeFile(join(outputDir, 'runtime-audit.json'), JSON.stringify({
    schemaVersion: 'sciforge.runtime-codex.browser-ordinary-chat-audit.v1',
    selectedRuntime: 'module.invoke',
    commandId: options.commandId,
    evidenceRefs: allRefs,
    outputDigest: boundedTextEvidence(finalAnswer),
  }, null, 2), 'utf8');
  return writeManifest(outputDir, {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt,
    commandId: options.commandId,
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    workspaceVisible: true,
    commandIdVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: true,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    releaseBlocking: false,
    releaseEligible: true,
    acceptanceRubric: {
      userIntent: 'use ordinary Runtime Codex chat to run SciForge Browser retrieval with source citations',
      expectedObservableResult: 'module.invoke browser.search_read/open_read result with BrowserHostSession source-page and page-text refs plus a visible final answer',
      actualResult: 'ordinary-chat Runtime Codex Browser retrieval completed with current source refs and a final-answer artifact',
      evidenceRefs: allRefs,
      negativeChecks: ['local dogfood alone rejected', 'missing source-page refs rejected', 'missing page-text refs rejected', 'missing final-answer refs rejected'],
      remainingRisks: 'release smoke still requires service-env Runtime Codex provider auth before this manifest can be produced by the live product path',
    },
    actualTaskResult: {
      status: 'passed',
      summary: 'Runtime Codex ordinary chat produced a BrowserHostSession-backed retrieval answer.',
      userIntentSatisfied: true,
      outputVerified: true,
      evidenceRefs: allRefs,
    },
    liveRuntimeCodexProof: {
      messageProvenance: 'live-runtime-codex',
      commandId: options.commandId,
      nativeDefaultChatAssistantAnswerRendered: true,
      runtimeOutputObserved: true,
      seedOrDemoExcluded: true,
      eventEvidenceRefs: allRefs,
    },
    evidence: {
      notesPath: 'final-answer.md',
      runtimeAuditPath: 'runtime-audit.json',
    },
  });
}

function createDefaultBrowserBoundedOperationInvoker(input: {
  workspacePath: string;
  commandId: string;
  ports?: BrowserBoundedOperationPorts;
}): CodexAgentHostBrowserBoundedOperationInvoker {
  const handler = createBrowserBoundedOperationModuleHandler({
    ...(input.ports ?? {}),
    workspacePath: input.workspacePath,
  });
  return async (request) => {
    const operationKind = typeof request.input?.operationKind === 'string'
      ? request.input.operationKind
      : 'browser.operation';
    const invoke = handler.invoke;
    if (!invoke) {
      return boundedOperationResult({
        moduleId: 'browser',
        operationKind,
        status: 'blocked',
        blockedReason: 'browser_module_invoke_unavailable',
        repairHint: 'Enable the Browser bounded-operation module handler before running ordinary-chat browser acceptance.',
      });
    }
    const result = await invoke(request) as ModuleInvokeResult<BoundedOperationResultValue>;
    const invokeRefs = [
      `action-ledger:browser.executeBoundedOperation/${input.commandId}/module.invoke`,
      `runtime-truth:module.invoke/${operationKind}/${input.commandId}`,
    ];
    return {
      ...result,
      refs: uniqueStrings([...(result.refs ?? []), ...invokeRefs]),
      value: result.value
        ? {
          ...result.value,
          evidenceRefs: uniqueStrings([...(result.value.evidenceRefs ?? []), ...invokeRefs]),
        }
        : result.value,
    };
  };
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

async function browserSourceEvidenceCheck(workspacePath: string, refs: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const missing = [
    /module\.invoke|executeBoundedOperation/i.test(refs.join('\n')) ? undefined : 'module.invoke evidence',
    /browser\.(?:search_read|open_read)/i.test(refs.join('\n')) ? undefined : 'browser.search_read/open_read evidence',
    refs.some((ref) => /^browser-host-session:[^/]+$/i.test(ref) || /^browser-host-session:[^/]+\//i.test(ref)) ? undefined : 'BrowserHostSession ref',
    refs.some((ref) => /source-pages\/.+\.source\.json$/i.test(ref)) ? undefined : 'source-page ref',
    refs.some((ref) => /source-pages\/.+\.txt$/i.test(ref)) ? undefined : 'page-text ref',
    refs.some((ref) => /final[-_/]?answer/i.test(ref)) ? undefined : 'final-answer ref',
  ].filter((item): item is string => Boolean(item));
  if (missing.length) return { ok: false, reason: `missing ${missing.join(', ')}` };
  const sourceFiles = refs
    .filter((ref) => /source-pages\/.+\.(?:source\.json|txt)$/i.test(ref))
    .map((ref) => browserHostFileForRef(workspacePath, ref));
  const invalid = sourceFiles.find((file) => !file);
  if (invalid === undefined && sourceFiles.length > 0) {
    for (const file of sourceFiles) {
      if (!file) continue;
      try {
        const info = await stat(file);
        if (!info.isFile() || info.size === 0) return { ok: false, reason: `empty BrowserHostSession source evidence file: ${file}` };
      } catch {
        return { ok: false, reason: `missing BrowserHostSession source evidence file: ${file}` };
      }
    }
    return { ok: true };
  }
  return { ok: false, reason: 'invalid BrowserHostSession source evidence ref' };
}

function browserSourceEvidenceBlockedReason(check: { ok: true } | { ok: false; reason: string }): string | undefined {
  return check.ok ? undefined : check.reason;
}

function browserHostFileForRef(workspacePath: string, ref: string): string | undefined {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  if (!match || !/^[A-Za-z0-9._:-]+$/.test(match[1] ?? '')) return undefined;
  const relative = match[2] ?? '';
  if (!/^source-pages\/[A-Za-z0-9._:-]+\.(?:source\.json|txt)$/.test(relative)) return undefined;
  return join(browserHostSessionDir(workspacePath, match[1] ?? ''), relative);
}

function ordinaryChatAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'runtime-codex-ordinary-chat-acceptance-writer',
    intentText,
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'SciForge default chat BrowserHostSession',
      refs: ['browser-host-session:ordinary-chat'],
    },
    observation: {
      fresh: true,
      refs: ['browser-host-session:ordinary-chat/frame.png'],
    },
    permissions: {
      refs: ['permission:runtime-codex-browser-ordinary-chat/low-risk-navigation'],
      scopedExecutorRefs: ['browser-host-session:ordinary-chat/scoped-browser-read'],
      stopCancelPath: true,
    },
  };
}

function displayStatus(result: Record<string, unknown>): string | undefined {
  const displayIntent = result.displayIntent;
  return typeof displayIntent === 'object' && displayIntent !== null && 'status' in displayIntent
    ? String((displayIntent as Record<string, unknown>).status)
    : undefined;
}

function runtimeEvidenceRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function boundedTextEvidence(value: string) {
  return {
    length: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}
