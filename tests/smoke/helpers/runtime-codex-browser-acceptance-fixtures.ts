import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type BrowserAcceptanceStatus = 'blocked' | 'failed' | 'partial' | 'passed';

type BrowserAcceptanceManifest = {
  schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1';
  status: BrowserAcceptanceStatus;
  source: 'codex-in-app-browser';
  observedAt?: string;
  actualWorkspaceWriterPort?: number;
  actualWorkspaceWriterUrl?: string;
  actualWorkspaceWriterUrlEvidence?: BoundedTextEvidence;
  actualRuntimeCodexPort?: number;
  actualRuntimeCodexUrl?: string;
  actualRuntimeCodexUrlEvidence?: BoundedTextEvidence;
  actualUrl?: string;
  actualUrlEvidence?: BoundedTextEvidence;
  actualPort?: number;
  workspacePath?: string;
  workspacePathEvidence?: BoundedTextEvidence;
  profile?: string;
  provider?: string;
  model?: string;
  commandId?: string;
  startedFromDefaultChatEntry: boolean;
  submittedThroughRuntimeCodex: boolean;
  providerModelProfileVisible: boolean;
  workspaceVisible?: boolean;
  commandIdVisible?: boolean;
  mainAnswerVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  automationSubstituteUsed?: boolean;
  seedDemoFixtureEvidenceUsed?: boolean;
  acceptanceConclusionFromRealBrowser?: boolean;
  seedOrDemoMessagesExcluded?: boolean;
  liveAcceptanceScope?: 'non-seed-runtime-codex-messages-only';
  singleTurn?: BrowserAcceptanceScenario;
  artifactFollowUp?: BrowserAcceptanceScenario;
  multiTurn?: BrowserAcceptanceScenario;
  evidence?: BrowserAcceptanceEvidence;
  acceptanceRubric?: AcceptanceRubric;
  actualTaskResult?: ActualTaskResult;
  liveRuntimeCodexProof?: LiveRuntimeCodexProof;
  negativeChecks?: NegativeChecks;
  reason?: string;
  releaseBlocking?: boolean;
  releaseEligible?: boolean;
};

type BrowserAcceptanceScenario = {
  status: BrowserAcceptanceStatus;
  prompt?: string;
  promptEvidence?: BoundedTextEvidence;
  followUpPrompt?: string;
  followUpPromptEvidence?: BoundedTextEvidence;
  expectedPassphrase?: string;
  expectedPassphraseEvidence?: BoundedTextEvidence;
  selectedRefs?: string[];
  userIntent?: string;
  actualTaskResult?: ActualTaskResult;
  liveRuntimeCodexProof?: LiveRuntimeCodexProof;
  negativeChecks?: NegativeChecks;
  visibleAnswerConfirmed: boolean;
  secondTurnVisibleAnswerConfirmed?: boolean;
  providerModelProfileVisible: boolean;
  workspaceCommandIdVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  evidence?: BrowserAcceptanceEvidence;
};

type BrowserAcceptanceEvidence = {
  screenshotPath?: string;
  domSnapshotPath?: string;
  notesPath?: string;
};

type BoundedTextEvidence = {
  length: number;
  sha256: string;
};

type AcceptanceRubric = {
  userIntent?: string;
  expectedObservableResult?: string;
  actualResult?: string;
  evidenceRefs?: string[];
  negativeChecks?: string[];
  remainingRisks?: string;
};

type ActualTaskResult = {
  status?: BrowserAcceptanceStatus;
  summary?: string;
  userIntentSatisfied?: boolean;
  outputVerified?: boolean;
  evidenceRefs?: string[];
};

type LiveRuntimeCodexProof = {
  messageProvenance?: 'live-runtime-codex' | 'seed-demo' | 'fixture' | 'unknown';
  commandId?: string;
  guiPresentObserved?: boolean;
  nativeDefaultChatAssistantAnswerRendered?: boolean;
  runtimeOutputObserved?: boolean;
  seedOrDemoExcluded?: boolean;
  eventEvidenceRefs?: string[];
};

type RuntimeOutputProofMode = 'gui-present' | 'native-default-chat';

type NegativeChecks = {
  fakePassedStatusRejected?: boolean;
  missingDomOrScreenshotRejected?: boolean;
  missingCommandIdRejected?: boolean;
  missingTaskResultRejected?: boolean;
  seedDemoEvidenceRejected?: boolean;
  blockedFailedPartialRejected?: boolean;
  rawStdoutJsonlRejected?: boolean;
  nativeAnswerOutsideDefaultChatRejected?: boolean;
};

export type RuntimeCodexBrowserAcceptanceFixtureContext = {
  root: string;
  actualUrl: string;
  requestedRolePort: number;
  requestedWorkspaceWriterPort: number;
  actualWorkspaceWriterUrl: string;
  requestedRuntimeCodexPort: number;
  actualRuntimeCodexUrl: string;
  workspacePath: string;
  runtimeCodexIdentity: {
    profile?: string;
    provider?: string;
    model?: string;
  };
  expectedMultiTurnPassphrase: string;
  negativeChecks: NegativeChecks;
};

export const nativeDefaultChatPositiveFixture = 'native-default-chat-passed.json';

export const rejectedBrowserAcceptanceFixtureFiles = [
  'fake-passed-missing-dom.json',
  'fake-passed-seed-demo.json',
  'fake-passed-missing-command-id.json',
  'fake-passed-missing-task-result.json',
  'fake-passed-unparseable-evidence.json',
  'fake-passed-native-outside-default-chat.json',
  'fake-passed-native-default-chat-without-browser-source-evidence.json',
  'fake-passed-raw-payload.json',
  'blocked-status.json',
  'failed-status.json',
  'partial-status.json',
] as const;

export function writeRuntimeCodexBrowserAcceptanceFixtures(
  fixtureDir: string,
  context: RuntimeCodexBrowserAcceptanceFixtureContext,
): void {
  mkdirSync(fixtureDir, { recursive: true });
  const artifactRoot = relativeFromRoot(context.root, fixtureDir);
  const fixturePath = (file: string): string => `${artifactRoot}/${file}`;
  const runtimeIdentityLines = runtimeIdentityFixtureLines(context.runtimeCodexIdentity);
  const actualUrlEvidence = boundedTextEvidence(context.actualUrl);
  const workspacePathEvidence = boundedTextEvidence(context.workspacePath);
  writeFixture(fixtureDir, 'valid-dom.txt', [
    '- main:',
    '  - strong: Ask SciForge',
    `  - generic: actual browser URL evidence length ${actualUrlEvidence.length} sha256 ${actualUrlEvidence.sha256}`,
    `  - generic: workspace evidence length ${workspacePathEvidence.length} sha256 ${workspacePathEvidence.sha256}`,
    ...runtimeIdentityLines,
    '  - generic: command codex-command-negative-001',
    '  - generic: gui.present show-result from live Runtime Codex',
    '  - paragraph: Runtime Codex completed the requested browser task and rendered the answer in the main chat.',
    '  - paragraph: Runtime Codex answer rendered in bounded fixture summary.',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'native-default-chat-dom.txt', [
    '- main:',
    '  - strong: Ask SciForge',
    '  - button: 聊天工作台',
    `  - generic: actual browser URL evidence length ${actualUrlEvidence.length} sha256 ${actualUrlEvidence.sha256}`,
    `  - generic: workspace evidence length ${workspacePathEvidence.length} sha256 ${workspacePathEvidence.sha256}`,
    '  - generic: Runtime Codex',
    ...runtimeIdentityLines,
    '  - generic: command codex-command-negative-001',
    '  - paragraph: 回答已显示',
    '  - paragraph: Runtime Codex answer rendered in the default chat.',
    '  - paragraph: Runtime Codex answer rendered in bounded fixture summary.',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'native-outside-default-chat-dom.txt', [
    '- main:',
    `  - generic: actual browser URL evidence length ${actualUrlEvidence.length} sha256 ${actualUrlEvidence.sha256}`,
    `  - generic: workspace evidence length ${workspacePathEvidence.length} sha256 ${workspacePathEvidence.sha256}`,
    '  - generic: Runtime Codex',
    ...runtimeIdentityLines,
    '  - generic: command codex-command-negative-001',
    '  - paragraph: Runtime Codex answer rendered in a detached audit panel.',
    '  - paragraph: Runtime Codex answer rendered in bounded fixture summary.',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'seed-demo-dom.txt', [
    '- main:',
    '  - strong: Ask SciForge',
    `  - generic: actual browser URL evidence length ${actualUrlEvidence.length} sha256 ${actualUrlEvidence.sha256}`,
    `  - generic: workspace evidence length ${workspacePathEvidence.length} sha256 ${workspacePathEvidence.sha256}`,
    ...runtimeIdentityLines,
    '  - generic: command codex-command-negative-001',
    '  - generic: gui.present show-result from live Runtime Codex',
    '  - code: literature-evidence-review@1.0.0',
    '  - paragraph: seed-demo fixture success for KRAS G12C should never count as live Runtime Codex acceptance.',
    '  - paragraph: Runtime Codex answer rendered in bounded fixture summary.',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'valid-notes.md', [
    '# Acceptance rubric',
    '',
    'User intent: prove the real default-chat Runtime Codex browser path completed the requested task.',
    'Expected observable result: gui.present projection or native Runtime Codex assistant answer rendered in default chat with URL/workspace digests, provider, model, profile, and command id.',
    `Actual task result: Runtime Codex rendered a live answer for command codex-command-negative-001 with urlDigest=${actualUrlEvidence.sha256} workspaceDigest=${workspacePathEvidence.sha256}.`,
    'Evidence refs: valid-dom.txt and valid-notes.md.',
    'Negative checks: seed/demo excluded; audit/debug output not used as the main answer; forged passed and partial states rejected.',
    'Remaining risks: none for this validator fixture.',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'bad-evidence.json', '{ "this": "is not parseable"\n');
  writeFixture(fixtureDir, 'screen.png', 'placeholder screenshot bytes for manifest validator negative fixtures\n');

  const validDom = fixturePath('valid-dom.txt');
  const nativeDefaultChatDom = fixturePath('native-default-chat-dom.txt');
  const nativeOutsideDefaultChatDom = fixturePath('native-outside-default-chat-dom.txt');
  const seedDom = fixturePath('seed-demo-dom.txt');
  const notes = fixturePath('valid-notes.md');
  const screenshot = fixturePath('screen.png');
  const badEvidence = fixturePath('bad-evidence.json');
  writeJsonFixture(fixtureDir, 'fake-passed-missing-dom.json', {
    ...passedFixtureManifest(context, validDom, notes, screenshot),
    evidence: { screenshotPath: screenshot, notesPath: notes },
  });
  writeJsonFixture(fixtureDir, 'fake-passed-seed-demo.json', passedFixtureManifest(context, seedDom, notes, screenshot));
  const missingCommandId = passedFixtureManifest(context, validDom, notes, screenshot);
  delete missingCommandId.commandId;
  writeJsonFixture(fixtureDir, 'fake-passed-missing-command-id.json', missingCommandId);
  const missingTaskResult = passedFixtureManifest(context, validDom, notes, screenshot);
  delete missingTaskResult.actualTaskResult;
  writeJsonFixture(fixtureDir, 'fake-passed-missing-task-result.json', missingTaskResult);
  writeJsonFixture(fixtureDir, 'fake-passed-unparseable-evidence.json', passedFixtureManifest(context, validDom, badEvidence, screenshot));
  writeJsonFixture(
    fixtureDir,
    nativeDefaultChatPositiveFixture,
    passedFixtureManifest(context, nativeDefaultChatDom, notes, screenshot, 'native-default-chat', true),
  );
  writeJsonFixture(
    fixtureDir,
    'fake-passed-native-default-chat-without-browser-source-evidence.json',
    passedFixtureManifest(context, nativeDefaultChatDom, notes, screenshot, 'native-default-chat'),
  );
  writeJsonFixture(
    fixtureDir,
    'fake-passed-native-outside-default-chat.json',
    passedFixtureManifest(context, nativeOutsideDefaultChatDom, notes, screenshot, 'native-default-chat'),
  );
  writeJsonFixture(fixtureDir, 'fake-passed-raw-payload.json', {
    ...passedFixtureManifest(context, nativeDefaultChatDom, notes, screenshot, 'native-default-chat'),
    rawProviderBody: 'data:image/png;base64,AAAA',
  });
  writeJsonFixture(fixtureDir, 'blocked-status.json', {
    ...passedFixtureManifest(context, validDom, notes, screenshot),
    status: 'blocked',
    reason: 'blocked status must remain release-blocking',
  });
  writeJsonFixture(fixtureDir, 'failed-status.json', {
    ...passedFixtureManifest(context, validDom, notes, screenshot),
    status: 'failed',
    reason: 'failed status must remain release-blocking',
  });
  writeJsonFixture(fixtureDir, 'partial-status.json', {
    ...passedFixtureManifest(context, validDom, notes, screenshot),
    status: 'partial',
    reason: 'partial status must remain release-blocking',
  });
}

function passedFixtureManifest(
  context: RuntimeCodexBrowserAcceptanceFixtureContext,
  domPath: string,
  notesPath: string,
  _screenshotPath: string,
  proofMode: RuntimeOutputProofMode = 'gui-present',
  includeBrowserSourceEvidence = false,
): BrowserAcceptanceManifest {
  const evidence = { domSnapshotPath: domPath, notesPath };
  const sourceRefs = includeBrowserSourceEvidence ? browserSourceEvidenceRefs() : [];
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: new Date().toISOString(),
    actualUrlEvidence: boundedTextEvidence(context.actualUrl),
    actualPort: context.requestedRolePort,
    actualWorkspaceWriterPort: context.requestedWorkspaceWriterPort,
    actualWorkspaceWriterUrlEvidence: boundedTextEvidence(context.actualWorkspaceWriterUrl),
    actualRuntimeCodexPort: context.requestedRuntimeCodexPort,
    actualRuntimeCodexUrlEvidence: boundedTextEvidence(context.actualRuntimeCodexUrl),
    workspacePathEvidence: boundedTextEvidence(context.workspacePath),
    profile: context.runtimeCodexIdentity.profile,
    provider: context.runtimeCodexIdentity.provider,
    model: context.runtimeCodexIdentity.model,
    commandId: 'codex-command-negative-001',
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    workspaceVisible: true,
    commandIdVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    releaseBlocking: false,
    releaseEligible: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: true,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    acceptanceRubric: {
      userIntent: 'prove browser acceptance',
      expectedObservableResult: 'visible live Runtime Codex result',
      actualResult: 'visible live Runtime Codex result',
      evidenceRefs: [domPath, notesPath, ...sourceRefs],
      negativeChecks: ['seed/demo excluded'],
      remainingRisks: 'none',
    },
    actualTaskResult: passedTaskResult(domPath, sourceRefs),
    liveRuntimeCodexProof: passedLiveProof(domPath, proofMode, sourceRefs),
    negativeChecks: context.negativeChecks,
    evidence,
    singleTurn: passedScenario(context, 'single turn', evidence, proofMode, sourceRefs),
    artifactFollowUp: { ...passedScenario(context, 'artifact follow up', evidence, proofMode, sourceRefs), selectedRefs: ['artifact:negative-fixture'] },
    multiTurn: {
      ...passedScenario(context, 'multi turn', evidence, proofMode, sourceRefs),
      followUpPromptEvidence: boundedTextEvidence('reply with the remembered passphrase'),
      expectedPassphraseEvidence: boundedTextEvidence(context.expectedMultiTurnPassphrase),
      secondTurnVisibleAnswerConfirmed: true,
    },
  };
}

function passedScenario(
  context: RuntimeCodexBrowserAcceptanceFixtureContext,
  userIntent: string,
  evidence: BrowserAcceptanceEvidence,
  proofMode: RuntimeOutputProofMode = 'gui-present',
  sourceRefs: string[] = [],
): BrowserAcceptanceScenario {
  return {
    status: 'passed',
    promptEvidence: boundedTextEvidence(userIntent),
    userIntent,
    actualTaskResult: passedTaskResult(evidence.domSnapshotPath ?? '', sourceRefs),
    liveRuntimeCodexProof: passedLiveProof(evidence.domSnapshotPath ?? '', proofMode, sourceRefs),
    negativeChecks: context.negativeChecks,
    visibleAnswerConfirmed: true,
    providerModelProfileVisible: true,
    workspaceCommandIdVisible: true,
    rawAuditFoldedByDefault: true,
    evidence,
  };
}

function passedTaskResult(evidenceRef: string, sourceRefs: string[] = []): ActualTaskResult {
  return {
    status: 'passed',
    summary: 'Runtime Codex completed the requested browser task.',
    userIntentSatisfied: true,
    outputVerified: true,
    evidenceRefs: [evidenceRef, ...sourceRefs],
  };
}

function passedLiveProof(evidenceRef: string, proofMode: RuntimeOutputProofMode = 'gui-present', sourceRefs: string[] = []): LiveRuntimeCodexProof {
  return {
    messageProvenance: 'live-runtime-codex',
    commandId: 'codex-command-negative-001',
    guiPresentObserved: proofMode === 'gui-present',
    nativeDefaultChatAssistantAnswerRendered: proofMode === 'native-default-chat',
    runtimeOutputObserved: true,
    seedOrDemoExcluded: true,
    eventEvidenceRefs: [evidenceRef, ...sourceRefs],
  };
}

function browserSourceEvidenceRefs(): string[] {
  return [
    'action-ledger:browser.executeBoundedOperation/codex-command-negative-001/module.invoke',
    'runtime-truth:module.invoke/browser.search_read/codex-command-negative-001',
    'browser-host-session:fixture-session',
    'browser-host-session:fixture-session/source-pages/source-1-fixture.source.json',
    'browser-host-session:fixture-session/source-pages/source-1-fixture.txt',
    'artifact:runtime-codex-browser-acceptance/final-answer.md',
  ];
}

function writeFixture(fixtureDir: string, file: string, content: string): void {
  writeFileSync(join(fixtureDir, file), content, 'utf8');
}

function runtimeIdentityFixtureLines(runtimeCodexIdentity: RuntimeCodexBrowserAcceptanceFixtureContext['runtimeCodexIdentity']): string[] {
  return [
    runtimeCodexIdentity.profile,
    runtimeCodexIdentity.provider,
    runtimeCodexIdentity.model,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => `  - generic: ${value}`);
}

function writeJsonFixture(fixtureDir: string, file: string, content: unknown): void {
  writeFixture(fixtureDir, file, `${JSON.stringify(content, null, 2)}\n`);
}

function boundedTextEvidence(value: string): BoundedTextEvidence {
  return {
    length: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}

function relativeFromRoot(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}
