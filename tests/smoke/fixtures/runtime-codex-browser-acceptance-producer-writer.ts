import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeCodexBrowserOrdinaryChatAcceptanceManifest } from '../../../src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.js';

export async function writeRuntimeCodexBrowserOrdinaryChatAcceptance(options: {
  workspacePath: string;
  outputDir: string;
  commandText: string;
  commandId: string;
  attemptId: string;
}): Promise<RuntimeCodexBrowserOrdinaryChatAcceptanceManifest> {
  if (!/https:\/\/developers\.openai\.com\/api\/docs\/changelog/.test(options.commandText)) {
    throw new Error('producer writer fixture requires the official OpenAI changelog open_read prompt');
  }
  await mkdir(options.outputDir, { recursive: true });
  await mkdir(join(options.workspacePath, '.sciforge', 'browser-host', 'sessions', 'ordinary-chat-producer', 'source-pages'), { recursive: true });
  await Promise.all([
    writeFile(
      join(options.workspacePath, '.sciforge', 'browser-host', 'sessions', 'ordinary-chat-producer', 'source-pages', 'producer.source.json'),
      JSON.stringify({
        schemaVersion: 'sciforge.browser-host-session.source-page.v1',
        status: 'read',
        finalUrl: 'https://developers.openai.com/api/docs/changelog',
        textRef: 'browser-host-session:ordinary-chat-producer/source-pages/producer.txt',
      }, null, 2),
      'utf8',
    ),
    writeFile(
      join(options.workspacePath, '.sciforge', 'browser-host', 'sessions', 'ordinary-chat-producer', 'source-pages', 'producer.txt'),
      'Source evidence text for Runtime Codex Browser bounded operation acceptance.\n',
      'utf8',
    ),
  ]);

  const evidenceRefs = [
    `action-ledger:browser.executeBoundedOperation/${options.commandId}/module.invoke`,
    `runtime-truth:module.invoke/browser.open_read/${options.commandId}`,
    'browser-host-session:ordinary-chat-producer',
    'browser-host-session:ordinary-chat-producer/source-pages/producer.source.json',
    'browser-host-session:ordinary-chat-producer/source-pages/producer.txt',
    'artifact:runtime-codex-browser-acceptance/final-answer.md',
  ];
  const finalAnswer = 'Browser bounded operation source evidence produced a visible Runtime Codex answer.';
  await writeFile(join(options.outputDir, 'final-answer.md'), finalAnswer, 'utf8');
  await writeFile(join(options.outputDir, 'runtime-audit.json'), JSON.stringify({
    schemaVersion: 'sciforge.runtime-codex.browser-ordinary-chat-audit.v1',
    selectedRuntime: 'module.invoke',
    commandId: options.commandId,
    evidenceRefs,
    outputDigest: boundedTextEvidence(finalAnswer),
  }, null, 2), 'utf8');

  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: new Date().toISOString(),
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
      evidenceRefs,
      negativeChecks: ['local dogfood alone rejected', 'missing source-page refs rejected', 'missing page-text refs rejected', 'missing final-answer refs rejected'],
      remainingRisks: 'release smoke still requires service-env Runtime Codex provider auth before this manifest can be produced by the live product path',
    },
    actualTaskResult: {
      status: 'passed',
      summary: 'Runtime Codex ordinary chat produced a BrowserHostSession-backed retrieval answer.',
      userIntentSatisfied: true,
      outputVerified: true,
      evidenceRefs,
    },
    liveRuntimeCodexProof: {
      messageProvenance: 'live-runtime-codex',
      commandId: options.commandId,
      nativeDefaultChatAssistantAnswerRendered: true,
      runtimeOutputObserved: true,
      seedOrDemoExcluded: true,
      eventEvidenceRefs: evidenceRefs,
    },
    evidence: {
      notesPath: 'final-answer.md',
      runtimeAuditPath: 'runtime-audit.json',
    },
  };
}

function boundedTextEvidence(value: string) {
  return {
    length: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}
