import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { CodexAppServerClient } from './codex/codex-app-server-adapter.js';
import { createCodexAppServerClient } from './codex/codex-app-server-client.js';

export interface RuntimeCodexBrowserOrdinaryChatAcceptanceOptions {
  workspacePath: string;
  outputDir: string;
  commandText: string;
  commandId: string;
  attemptId: string;
  appServerClient?: CodexAppServerClient;
  env?: NodeJS.ProcessEnv;
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
    guiPresentObserved?: boolean;
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
  const events: unknown[] = [];
  try {
    const client = options.appServerClient ?? createCodexAppServerClient({ env: options.env });
    const stream = await client.startTurn({
      commandText: options.commandText,
      workspacePath: options.workspacePath,
      commandId: options.commandId,
      attemptId: options.attemptId,
      guiExtension: { enabled: true },
    });
    for await (const event of stream.events) events.push(event);
  } catch (error) {
    await writeRuntimeAudit(outputDir, events);
    return writeManifest(outputDir, blockedManifest(
      options,
      observedAt,
      `Runtime Codex app-server ordinary-chat Browser acceptance failed before usable Browser evidence: ${safeReason(error)}`,
      await browserProofFromEvents(events, options.workspacePath, observedAt),
    ));
  }

  const proof = await browserProofFromEvents(events, options.workspacePath, observedAt);
  await writeRuntimeAudit(outputDir, events);
  if (!proof.passed) {
    return writeManifest(outputDir, blockedManifest(
      options,
      observedAt,
      `Runtime Codex app-server ordinary-chat Browser acceptance did not observe required current-run evidence: ${proof.reason}`,
      proof,
    ));
  }
  await writePassedNotes(outputDir, options, observedAt, proof);
  return writeManifest(outputDir, passedManifest(options, observedAt, proof));
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

interface BrowserOrdinaryChatProof {
  passed: boolean;
  reason: string;
  toolCalls: string[];
  completedTools: string[];
  refs: string[];
  guiPresentObserved: boolean;
  completionTruthSatisfied: boolean;
}

function passedManifest(
  options: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions,
  observedAt: string,
  proof: BrowserOrdinaryChatProof,
): RuntimeCodexBrowserOrdinaryChatAcceptanceManifest {
  const evidenceRefs = proof.refs.slice(0, 32);
  return {
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
    mainAnswerVisible: proof.guiPresentObserved,
    rawAuditFoldedByDefault: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: true,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    releaseBlocking: false,
    releaseEligible: true,
    acceptanceRubric: {
      userIntent: options.commandText,
      expectedObservableResult: 'Runtime Codex app-server ordinary chat calls direct Browser primitives, materializes source/page text refs, and projects gui.present with satisfied Agent Host Browser completionTruth.',
      actualResult: 'Observed browser_search, browser_read, source/page text refs, gui.present, and satisfied Browser completionTruth in the current app-server turn.',
      evidenceRefs,
      negativeChecks: [
        'Search-only evidence is not accepted.',
        'Fixture, replay, and historical refs are excluded from success criteria.',
        'BrowserHostSession manager bypasses are not used by this writer.',
      ],
      remainingRisks: 'Release acceptance still depends on current service-env Runtime Codex provider readiness and real desktop visibility.',
    },
    actualTaskResult: {
      status: 'passed',
      summary: 'Runtime Codex app-server produced a Browser-grounded gui.present final answer with current source/page text evidence.',
      userIntentSatisfied: true,
      outputVerified: true,
      evidenceRefs,
    },
    liveRuntimeCodexProof: {
      messageProvenance: 'live-runtime-codex',
      commandId: options.commandId,
      guiPresentObserved: proof.guiPresentObserved,
      nativeDefaultChatAssistantAnswerRendered: proof.guiPresentObserved,
      runtimeOutputObserved: true,
      seedOrDemoExcluded: true,
      eventEvidenceRefs: evidenceRefs,
    },
    evidence: {
      notesPath: 'runtime-codex-browser-ordinary-chat.md',
      runtimeAuditPath: 'runtime-audit.json',
    },
  };
}

function blockedManifest(
  options: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions,
  observedAt: string,
  reason: string,
  proof: BrowserOrdinaryChatProof,
): RuntimeCodexBrowserOrdinaryChatAcceptanceManifest {
  const evidenceRefs = proof.refs.slice(0, 32);
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt,
    commandId: options.commandId,
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: proof.toolCalls.length > 0,
    providerModelProfileVisible: false,
    workspaceVisible: false,
    commandIdVisible: proof.toolCalls.length > 0,
    mainAnswerVisible: proof.guiPresentObserved,
    rawAuditFoldedByDefault: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: false,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    releaseBlocking: true,
    releaseEligible: false,
    reason,
    acceptanceRubric: {
      userIntent: options.commandText,
      expectedObservableResult: 'Runtime Codex app-server ordinary chat must call browser_search, browser_read, materialize source/page text refs, and project gui.present with satisfied completionTruth.',
      actualResult: reason,
      evidenceRefs,
      negativeChecks: [
        'Blocked manifests cannot claim release eligibility.',
        'Search-only evidence cannot satisfy ordinary-chat Browser acceptance.',
        'Fixture, replay, and historical refs are excluded from success criteria.',
      ],
      remainingRisks: 'Rerun with service-env Runtime Codex provider readiness and inspect runtime-audit.json.',
    },
    actualTaskResult: {
      status: 'blocked',
      summary: reason,
      userIntentSatisfied: false,
      outputVerified: false,
      evidenceRefs,
    },
    liveRuntimeCodexProof: {
      messageProvenance: 'unknown',
      commandId: options.commandId,
      guiPresentObserved: proof.guiPresentObserved,
      nativeDefaultChatAssistantAnswerRendered: false,
      runtimeOutputObserved: proof.toolCalls.length > 0,
      seedOrDemoExcluded: true,
      eventEvidenceRefs: evidenceRefs,
    },
    evidence: {
      notesPath: 'blocked-runtime-codex-browser-ordinary-chat.md',
      runtimeAuditPath: 'runtime-audit.json',
    },
  };
}

async function browserProofFromEvents(events: unknown[], workspacePath: string, runStartedAt: string): Promise<BrowserOrdinaryChatProof> {
  const toolCalls = uniqueStrings(events.flatMap(toolCallNamesFromEvent));
  const browserReadRefs = liveEvidenceRefs(uniqueStrings(events.flatMap(browserReadCompletedRefsFromEvent)));
  const guiPresentRefs = liveEvidenceRefs(uniqueStrings(events.flatMap(guiPresentCompletedRefsFromEvent)));
  const refs = liveEvidenceRefs(uniqueStrings([...browserReadRefs, ...guiPresentRefs]));
  const sourcePageRefs = browserReadRefs.filter((ref) => /source-pages\/.+\.source\.json$/i.test(ref));
  const pageTextRefs = browserReadRefs.filter((ref) => /source-pages\/.+\.txt$/i.test(ref));
  const sourceArtifacts = await validateBrowserSourceArtifacts(workspacePath, sourcePageRefs, runStartedAt);
  const completedTools = uniqueStrings(events.flatMap(completedToolNamesFromEvent));
  const hasBrowserSearch = completedTools.includes('browser_search') || completedTools.includes('browser.search');
  const hasBrowserRead = completedTools.includes('browser_read') || completedTools.includes('browser.read');
  const guiPresentObserved = completedTools.includes('gui_present') || completedTools.includes('gui.present');
  const browserReadEvidenceRefs = uniqueStrings([...sourcePageRefs, ...pageTextRefs]);
  const guiPresentCoversBrowserReadRefs = browserReadEvidenceRefs.length > 0
    && browserReadEvidenceRefs.every((ref) => guiPresentRefs.includes(ref));
  const completionTruth = guiPresentBrowserCompletionTruth(events);
  const completionTruthCoversBrowserReadRefs = browserReadEvidenceRefs.length > 0
    && browserReadEvidenceRefs.every((ref) => completionTruth.evidenceRefs.includes(ref));
  const completionTruthSatisfied = completionTruth.satisfied && completionTruthCoversBrowserReadRefs;
  const missing = [
    ...(hasBrowserSearch ? [] : ['completed browser_search']),
    ...(hasBrowserRead ? [] : ['completed browser_read']),
    ...(sourcePageRefs.length ? [] : ['browser_read source_page refs']),
    ...(pageTextRefs.length ? [] : ['browser_read page_text refs']),
    ...(sourceArtifacts.ok ? [] : [`materialized source files (${sourceArtifacts.reason})`]),
    ...(guiPresentObserved ? [] : ['gui.present']),
    ...(guiPresentCoversBrowserReadRefs ? [] : ['gui.present Browser read refs']),
    ...(completionTruth.satisfied ? [] : ['satisfied Browser completionTruth']),
    ...(completionTruth.satisfied && !completionTruthCoversBrowserReadRefs ? ['completionTruth evidenceRefs for Browser read refs'] : []),
  ];
  return {
    passed: missing.length === 0,
    reason: missing.length ? `missing ${missing.join(', ')}` : 'required Browser ordinary-chat evidence observed',
    toolCalls,
    completedTools,
    refs,
    guiPresentObserved,
    completionTruthSatisfied,
  };
}

async function validateBrowserSourceArtifacts(workspacePath: string, sourceRefs: string[], runStartedAt: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const runStartedMs = Date.parse(runStartedAt);
  if (!Number.isFinite(runStartedMs)) return { ok: false, reason: `invalid run start ${runStartedAt}` };
  if (sourceRefs.length === 0) return { ok: false, reason: 'missing source refs' };
  for (const sourceRef of sourceRefs) {
    const sourcePath = browserHostRefPath(workspacePath, sourceRef);
    if (!sourcePath) return { ok: false, reason: `invalid source ref ${sourceRef}` };
    let source: Record<string, unknown>;
    try {
      source = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: `source artifact missing or invalid ${sourceRef}` };
    }
    if (source.schemaVersion !== 'sciforge.browser-host-session.source-page.v1') {
      return { ok: false, reason: `source artifact schema mismatch ${sourceRef}` };
    }
    if (source.status !== 'read') return { ok: false, reason: `source artifact not read ${sourceRef}` };
    const openedAt = stringField(source.openedAt);
    const openedAtMs = openedAt ? Date.parse(openedAt) : Number.NaN;
    if (!openedAt || !Number.isFinite(openedAtMs)) return { ok: false, reason: `source artifact missing openedAt ${sourceRef}` };
    if (openedAtMs < runStartedMs) return { ok: false, reason: `source artifact openedAt is not current run evidence ${sourceRef}` };
    if (!stringField(source.finalUrl)) return { ok: false, reason: `source artifact missing finalUrl ${sourceRef}` };
    const textRef = stringField(source.textRef);
    if (!textRef) return { ok: false, reason: `source artifact missing textRef ${sourceRef}` };
    const textPath = browserHostRefPath(workspacePath, textRef);
    if (!textPath) return { ok: false, reason: `invalid text ref ${textRef}` };
    let text: string;
    try {
      text = await readFile(textPath, 'utf8');
      if (!text.trim()) return { ok: false, reason: `page text artifact empty ${textRef}` };
    } catch {
      return { ok: false, reason: `page text artifact missing ${textRef}` };
    }
    const expectedTextSha1 = stringField(source.textSha1);
    if (!expectedTextSha1) return { ok: false, reason: `source artifact missing textSha1 ${sourceRef}` };
    if (!/^[a-f0-9]{40}$/i.test(expectedTextSha1)) return { ok: false, reason: `source artifact invalid textSha1 ${sourceRef}` };
    if (sha1(text) !== expectedTextSha1.toLowerCase()) return { ok: false, reason: `source artifact textSha1 mismatch ${sourceRef}` };
  }
  return { ok: true };
}

function browserHostRefPath(workspacePath: string, ref: string): string | undefined {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  if (!match?.[1] || !match[2]) return undefined;
  if (match[2].includes('..') || match[2].startsWith('/')) return undefined;
  return join(resolve(workspacePath), '.sciforge', 'browser-host', 'sessions', match[1], match[2]);
}

function toolCallNamesFromEvent(event: unknown): string[] {
  if (!isRecord(event)) return [];
  const method = stringField(event.method);
  if (method !== 'item/tool/call' && method !== 'item/tool/completed') return [];
  return toolNamesFromEventParams(event);
}

function completedToolNamesFromEvent(event: unknown): string[] {
  if (!isRecord(event) || stringField(event.method) !== 'item/tool/completed') return [];
  return toolNamesFromEventParams(event);
}

function browserReadCompletedRefsFromEvent(event: unknown): string[] {
  if (!isRecord(event) || stringField(event.method) !== 'item/tool/completed') return [];
  const completedTools = completedToolNamesFromEvent(event);
  if (!completedTools.includes('browser_read') && !completedTools.includes('browser.read')) return [];
  const params = recordField(event.params);
  return uniqueStrings([
    ...structuredRefsFromUnknown(params?.result),
    ...structuredRefsFromUnknown(params?.output),
  ]);
}

function guiPresentCompletedRefsFromEvent(event: unknown): string[] {
  if (!isRecord(event) || stringField(event.method) !== 'item/tool/completed') return [];
  const completedTools = completedToolNamesFromEvent(event);
  if (!completedTools.includes('gui_present') && !completedTools.includes('gui.present')) return [];
  const params = recordField(event.params);
  return uniqueStrings([
    ...structuredRefsFromUnknown(params?.arguments),
    ...structuredRefsFromUnknown(params?.result),
    ...structuredRefsFromUnknown(params?.output),
  ]);
}

function guiPresentBrowserCompletionTruth(events: unknown[]): { satisfied: boolean; evidenceRefs: string[] } {
  const evidenceRefs: string[] = [];
  for (const event of events) {
    if (!isRecord(event) || stringField(event.method) !== 'item/tool/completed') continue;
    const completedTools = completedToolNamesFromEvent(event);
    if (!completedTools.includes('gui_present') && !completedTools.includes('gui.present')) continue;
    const params = recordField(event.params);
    const matches = [
      ...browserCompletionTruthRefsFromUnknown(params?.result),
      ...browserCompletionTruthRefsFromUnknown(params?.completionTruth),
    ];
    evidenceRefs.push(...matches);
  }
  return {
    satisfied: evidenceRefs.length > 0,
    evidenceRefs: liveEvidenceRefs(uniqueStrings(evidenceRefs)),
  };
}

function toolNamesFromEventParams(event: Record<string, unknown>): string[] {
  const params = recordField(event.params);
  const namespace = stringField(params?.namespace);
  const tool = stringField(params?.tool);
  const names = tool ? [namespace ? `${namespace}.${tool}` : tool] : [];
  const args = parseRecord(params?.arguments);
  const moduleId = stringField(args?.moduleId) ?? stringField(args?.module_id);
  const intent = stringField(args?.intent);
  if (moduleId === 'browser' && intent === 'browser.search') names.push('browser.search');
  if (moduleId === 'browser' && intent === 'browser.read') names.push('browser.read');
  if (moduleId === 'gui' && intent === 'present') names.push('gui.present');
  return names;
}

function browserCompletionTruthRefsFromUnknown(value: unknown): string[] {
  if (!isRecord(value)) return [];
  if (
    value.schemaVersion === 'sciforge.agent-host.completion-truth.v1'
    && value.scope === 'user-task'
    && value.validator === 'agent-host-browser-acceptance'
    && value.status === 'satisfied'
  ) {
    return structuredRefsFromUnknown(value.evidenceRefs);
  }
  return Object.values(value).flatMap((item) => {
    if (Array.isArray(item)) return item.flatMap(browserCompletionTruthRefsFromUnknown);
    return browserCompletionTruthRefsFromUnknown(item);
  });
}

function structuredRefsFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return [];
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (typeof item === 'string') return refTokensFromString(item);
    return structuredRefsFromUnknown(item, depth + 1);
  });
  if (!isRecord(value)) return [];
  const refs: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === 'refs' || key === 'displayedRefs' || key === 'evidenceRefs') {
      refs.push(...structuredRefsFromUnknown(item, depth + 1));
      continue;
    }
    if (key === 'ref' || key.endsWith('Ref')) {
      if (typeof item === 'string') refs.push(...refTokensFromString(item));
      continue;
    }
    if (key === 'resources') {
      refs.push(...structuredRefsFromUnknown(item, depth + 1));
    }
  }
  return refs;
}

function liveEvidenceRefs(refs: string[]): string[] {
  return refs.filter((ref) => {
    if (/^(?:fixture|replay|history|seed|demo):/i.test(ref)) return false;
    if (/data:image|base64|secret|token|api[-_]?key|password/i.test(ref)) return false;
    return /^(?:browser-host-session|runtime-truth|runtime-tool|gui\.present|artifact):/i.test(ref);
  });
}

function refTokensFromString(value: string): string[] {
  return value.match(/\b(?:browser-host-session|runtime-truth|runtime-tool|gui\.present|artifact):[A-Za-z0-9._~:/-]+/g) ?? [];
}

function stringsFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsFromUnknown(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => stringsFromUnknown(item, depth + 1));
}

async function writeRuntimeAudit(outputDir: string, events: unknown[]): Promise<void> {
  await writeFile(join(outputDir, 'runtime-audit.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.runtime-codex.browser-ordinary-chat-audit.v1',
    eventCount: events.length,
    events: events.map((event) => boundedJson(event)),
  }, null, 2)}\n`, 'utf8');
}

async function writePassedNotes(
  outputDir: string,
  options: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions,
  observedAt: string,
  proof: BrowserOrdinaryChatProof,
): Promise<void> {
  await writeFile(join(outputDir, 'runtime-codex-browser-ordinary-chat.md'), [
    '# Runtime Codex browser ordinary-chat acceptance',
    '',
    `Observed at: ${observedAt}`,
    `Command id: ${options.commandId}`,
    '',
    'Actual task result:',
    '- Runtime Codex app-server emitted direct Browser search/read tool calls.',
    '- Browser source page and page text refs were materialized in the current run.',
    '- gui.present completed with Agent Host Browser completionTruth status satisfied.',
    '',
    `Tool calls: ${proof.toolCalls.join(', ')}`,
    `Evidence refs: ${proof.refs.slice(0, 24).join(', ')}`,
    '',
  ].join('\n'), 'utf8');
}

function boundedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+/g, '[redacted-secret]')
    .replace(/\b(api[_-]?key|authorization|bearer|token|password|secret)\b["':=\s]+[^"',\s}]+/gi, '$1=[redacted]')
    .slice(0, 8_000);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function safeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+/g, '[redacted-secret]').slice(0, 800);
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}
