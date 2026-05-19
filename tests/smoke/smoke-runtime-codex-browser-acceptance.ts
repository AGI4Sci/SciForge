import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizeInstanceName, parallelProfile } from '../../src/runtime/parallel-instance-profile.js';

type BrowserAcceptanceStatus = 'blocked' | 'failed' | 'partial' | 'passed';

type BrowserAcceptanceManifest = {
  schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1';
  status: BrowserAcceptanceStatus;
  source: 'codex-in-app-browser';
  observedAt?: string;
  requestedRolePort?: number;
  actualWorkspaceWriterPort?: number;
  actualWorkspaceWriterUrl?: string;
  actualRuntimeCodexPort?: number;
  actualRuntimeCodexUrl?: string;
  actualUrl?: string;
  actualPort?: number;
  workspacePath?: string;
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
  blocker?: string;
  blockedOn?: string[];
};

type BrowserAcceptanceScenario = {
  status: BrowserAcceptanceStatus;
  prompt?: string;
  followUpPrompt?: string;
  expectedPassphrase?: string;
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
  reason?: string;
  evidence?: BrowserAcceptanceEvidence;
};

type BrowserAcceptanceEvidence = {
  screenshotPath?: string;
  domSnapshotPath?: string;
  notesPath?: string;
  runtimeAuditPath?: string;
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
  runtimeOutputObserved?: boolean;
  seedOrDemoExcluded?: boolean;
  eventEvidenceRefs?: string[];
};

type NegativeChecks = {
  fakePassedStatusRejected?: boolean;
  missingDomOrScreenshotRejected?: boolean;
  missingCommandIdRejected?: boolean;
  missingTaskResultRejected?: boolean;
  seedDemoEvidenceRejected?: boolean;
  blockedFailedPartialRejected?: boolean;
  rawStdoutJsonlRejected?: boolean;
};

const root = process.cwd();
const requestedInstance = normalizeInstanceName(process.env.SCIFORGE_INSTANCE_ID ?? process.env.SCIFORGE_PARALLEL_INSTANCE);
const instanceProfile = parallelProfile(requestedInstance);
const isParallelInstance = /^p[2-8]$/.test(instanceProfile.id);
const outputDir = process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR
  ? resolve(root, process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR)
  : isParallelInstance
    ? resolve(root, 'docs', 'test-artifacts', 'parallel', instanceProfile.id)
    : resolve(root, 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance');
const manifestPath = join(outputDir, 'manifest.json');
const blockedNotesPath = join(outputDir, 'blocked-runtime-config.md');
const requestedRolePort = portFromEnv(
  process.env.SCIFORGE_UI_PORT,
  process.env[`SCIFORGE_${instanceProfile.id.toUpperCase()}_UI_PORT`],
  Number(instanceProfile.uiPort),
);
const requestedWorkspaceWriterPort = portFromEnv(
  process.env.SCIFORGE_WORKSPACE_PORT,
  process.env[`SCIFORGE_${instanceProfile.id.toUpperCase()}_WORKSPACE_PORT`],
  Number(instanceProfile.workspacePort),
);
const requestedRuntimeCodexPort = portFromEnv(
  process.env.SCIFORGE_RUNTIME_CODEX_PORT,
  process.env[`SCIFORGE_${instanceProfile.id.toUpperCase()}_RUNTIME_CODEX_PORT`],
  Number(instanceProfile.runtimeCodexPort),
);
const workspacePath = process.env.SCIFORGE_WORKSPACE_PATH ?? resolve(root, instanceProfile.workspacePath);
const actualUrl = `http://127.0.0.1:${requestedRolePort}/`;
const actualWorkspaceWriterUrl = `http://127.0.0.1:${requestedWorkspaceWriterPort}`;
const actualRuntimeCodexUrl = `http://127.0.0.1:${requestedRuntimeCodexPort}`;
const singleTurnPrompt = 'Runtime Codex browser smoke single turn: reply in one short sentence with SCIFORGE-CODEX-BROWSER-SINGLE-20260519.';
const artifactFollowUpPrompt = 'Use only the selected artifact ref and answer what it says in one concise sentence.';
const multiTurnPrompt = 'Remember this passphrase for the next browser turn: SCIFORGE-CODEX-BROWSER-MT-20260519. Reply only remembered.';
const multiTurnFollowUpPrompt = 'Now reply only with the passphrase from the previous turn.';
const expectedMultiTurnPassphrase = 'SCIFORGE-CODEX-BROWSER-MT-20260519';
const requireLiveBrowserAcceptance = process.env.SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE === '1';

assertNegativeFixtures();

const blockedReason = runtimeBridgeBlockedReason();
if (blockedReason) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(blockedNotesPath, blockedNotes(blockedReason), 'utf8');
  const browserEvidence = existingBrowserEvidence();
  const manifest: BrowserAcceptanceManifest = {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt: new Date().toISOString(),
    requestedRolePort,
    actualWorkspaceWriterPort: requestedWorkspaceWriterPort,
    actualWorkspaceWriterUrl,
    actualRuntimeCodexPort: requestedRuntimeCodexPort,
    actualRuntimeCodexUrl,
    actualUrl,
    actualPort: requestedRolePort,
    workspacePath,
    profile: 'sciforge-runtime-deepseek',
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    commandId: browserEvidence.commandId,
    startedFromDefaultChatEntry: browserEvidence.defaultChatEntryObserved,
    submittedThroughRuntimeCodex: browserEvidence.singleTurnSubmitted,
    providerModelProfileVisible: browserEvidence.providerModelProfileVisible,
    workspaceVisible: browserEvidence.workspaceVisible,
    commandIdVisible: browserEvidence.workspaceCommandIdVisible,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: browserEvidence.rawAuditFoldedByDefault,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    acceptanceConclusionFromRealBrowser: false,
    seedOrDemoMessagesExcluded: true,
    liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
    acceptanceRubric: blockedAcceptanceRubric(blockedReason),
    negativeChecks: builtInNegativeChecks(),
    reason: blockedReason,
    blocker: blockedReason,
    blockedOn: blockedReason.includes('API key')
      ? ['Runtime Codex environment configuration', 'Codex in-app browser execution']
      : ['Runtime Codex bridge integration', 'UI Runtime Codex integration'],
    singleTurn: blockedScenario(
      browserEvidence.singleTurnSubmitted ? singleTurnPrompt : 'single-turn Runtime Codex browser acceptance is blocked before submission',
      blockedReason,
      browserEvidence.singleTurn.evidence,
      browserEvidence.singleTurn,
    ),
    artifactFollowUp: blockedScenario(
      browserEvidence.artifactFollowUpSubmitted ? artifactFollowUpPrompt : 'artifact follow-up Runtime Codex browser acceptance is blocked before selected-ref follow-up submission',
      blockedReason,
      browserEvidence.artifactFollowUp.evidence,
      browserEvidence.artifactFollowUp,
    ),
    multiTurn: {
      ...blockedScenario(
        browserEvidence.multiTurnSecondAnswerVisible
          ? multiTurnFollowUpPrompt
          : 'multi-turn passphrase browser acceptance is blocked before visible second-turn answer',
        blockedReason,
        browserEvidence.multiTurn.evidence,
        browserEvidence.multiTurn,
      ),
      prompt: multiTurnPrompt,
      followUpPrompt: multiTurnFollowUpPrompt,
      expectedPassphrase: expectedMultiTurnPassphrase,
      secondTurnVisibleAnswerConfirmed: false,
    },
    evidence: browserEvidence.evidence,
  };
  assertBlockedOrFailedManifest(manifest);
  await writeManifest(manifest);
  console.log(`[blocked] Runtime Codex browser E2E is blocked: ${blockedReason}; wrote ${manifestPath}`);
  if (requireLiveBrowserAcceptance) {
    console.error('[strict] SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 requires manifest.status === passed; blocked manifest is not release acceptance.');
    process.exitCode = 1;
  }
} else {
  const manifest = await readManifest();
  assertBrowserAcceptanceManifest(manifest);
  if (manifest.status === 'passed') {
    console.log(`[ok] Runtime Codex in-app browser acceptance passed with real evidence from ${manifestPath}`);
  } else {
    console.log(`[${manifest.status}] Runtime Codex in-app browser acceptance is not passed; evidence contract verified from ${manifestPath}`);
    if (requireLiveBrowserAcceptance) {
      console.error(`[strict] SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 requires manifest.status === passed; got ${manifest.status}.`);
      process.exitCode = 1;
    }
  }
}

function assertBrowserAcceptanceManifest(manifest: BrowserAcceptanceManifest): void {
  assert.equal(manifest.schemaVersion, 'sciforge.runtime-codex.browser-acceptance.v1');
  assert.equal(manifest.source, 'codex-in-app-browser');
  assert.notEqual(manifest.automationSubstituteUsed, true, 'system browser, macOS open, external Chrome, or non-user-level automation cannot be acceptance evidence');
  assert.notEqual(manifest.seedDemoFixtureEvidenceUsed, true, 'seed/demo/fixture messages cannot be live browser acceptance evidence');
  assert.match(manifest.actualUrl ?? '', /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, 'actual browser URL must be recorded');
  assert.ok(manifest.actualPort, 'actual UI port must be recorded after port preflight');
  assertUrlPortMatches(manifest.actualUrl, manifest.actualPort, 'actualUrl');
  assert.ok(manifest.actualWorkspaceWriterPort, 'actual workspace writer port must be recorded after port preflight');
  assert.match(manifest.actualWorkspaceWriterUrl ?? '', /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/, 'actual workspace writer URL must be recorded');
  assertUrlPortMatches(manifest.actualWorkspaceWriterUrl, manifest.actualWorkspaceWriterPort, 'actualWorkspaceWriterUrl');
  assert.ok(manifest.actualRuntimeCodexPort, 'actual RuntimeCodex port must be recorded after port preflight');
  assert.match(manifest.actualRuntimeCodexUrl ?? '', /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/, 'actual RuntimeCodex URL must be recorded');
  assertUrlPortMatches(manifest.actualRuntimeCodexUrl, manifest.actualRuntimeCodexPort, 'actualRuntimeCodexUrl');
  assert.ok(manifest.workspacePath?.startsWith('/'), 'absolute workspace path must be recorded');
  assert.equal(manifest.profile, 'sciforge-runtime-deepseek', 'Runtime Codex profile must be recorded');
  assert.equal(manifest.provider, 'sciforge-deepseek-proxy', 'Runtime Codex provider must be recorded');
  assert.equal(manifest.model, 'bailian/deepseek-v4-flash', 'Runtime Codex model must be recorded');
  assert.equal(manifest.seedOrDemoMessagesExcluded, true, 'browser acceptance must exclude seed/demo/fixture messages');
  assert.equal(manifest.liveAcceptanceScope, 'non-seed-runtime-codex-messages-only', 'browser acceptance must only count non-seed Runtime Codex messages');
  assert.ok(manifest.reason || manifest.status === 'passed', 'blocked/failed/partial manifests must record a reason');
  if (manifest.status === 'passed') assertPassedManifest(manifest);
  else assertBlockedOrFailedManifest(manifest);
}

function runtimeBridgeBlockedReason(): string | undefined {
  const requiredFiles = [
    'src/runtime/codex/agent-cli-adapter.ts',
    'src/runtime/codex/codex-exec-json-adapter.ts',
    'src/runtime/codex/codex-event-normalizer.ts',
    'src/runtime/codex/codex-runtime-config.ts',
    'src/runtime/codex/codex-runtime-server.ts',
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
  if (missing.length > 0) return `Runtime Codex bridge is missing files: ${missing.join(', ')}`;
  const uiIntegration = readIfExists('src/ui/src/app/chat/runOrchestrator.ts')
    + readIfExists('src/ui/src/api/sciforgeToolsClient.ts');
  if (!/Runtime Codex|runtime codex|codex runtime/i.test(uiIntegration)) {
    return 'Runtime Codex UI streaming integration is not present.';
  }
  const uiPath = /CODEX_RUNTIME_STREAM_PATH\s*=\s*'([^']+)'/.exec(uiIntegration)?.[1];
  const serverText = readIfExists('src/runtime/codex/codex-runtime-server.ts');
  if (!uiPath || !serverText.includes(`url.pathname !== '${uiPath}'`)) {
    return `Runtime Codex UI stream path is not aligned with the workspace server route: ${uiPath ?? 'missing'}`;
  }
  if (!process.env.SCIFORGE_RUNTIME_API_KEY) {
    return 'Runtime Codex API key is not configured; live browser E2E must fail closed until SCIFORGE_RUNTIME_API_KEY is present.';
  }
  return undefined;
}

function assertPassedManifest(manifest: BrowserAcceptanceManifest): void {
  assert.equal(manifest.status, 'passed', 'release acceptance requires status=passed');
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, true, 'passed requires a real in-app browser conclusion');
  assert.equal(manifest.seedDemoFixtureEvidenceUsed, false, 'passed requires live Runtime Codex output, not seed/demo/fixture messages');
  assert.equal(manifest.startedFromDefaultChatEntry, true, 'must start from existing default chat entry');
  assert.equal(manifest.submittedThroughRuntimeCodex, true, 'must submit through Runtime Codex');
  assert.equal(manifest.providerModelProfileVisible, true, 'provider/model/profile must be visible');
  assert.equal(manifest.workspaceVisible, true, 'workspace must be visible');
  assert.equal(manifest.commandIdVisible, true, 'command id must be visible');
  assert.match(manifest.commandId ?? '', /^codex-command-[a-z0-9-]+$/i, 'passed manifest must record the observed Runtime Codex command id');
  assert.equal(manifest.mainAnswerVisible, true, 'main answer must be visible');
  assert.equal(manifest.rawAuditFoldedByDefault, true, 'raw audit must be folded by default');
  assertAcceptanceRubric(manifest.acceptanceRubric, 'manifest acceptanceRubric');
  assertActualTaskResult(manifest.actualTaskResult, 'manifest actualTaskResult');
  assertLiveRuntimeCodexProof(manifest.liveRuntimeCodexProof, manifest.commandId, 'manifest liveRuntimeCodexProof');
  assertNegativeChecks(manifest.negativeChecks, 'manifest negativeChecks');
  assertEvidenceExists(manifest.evidence, 'manifest evidence', { requireScreenshotAndDom: true });
  const manifestEvidenceText = readEvidenceText(manifest.evidence, { includeNotes: true });
  assertIncludes(manifestEvidenceText, manifest.commandId, 'manifest evidence must mention command id');
  assertIncludes(manifestEvidenceText, manifest.actualUrl, 'manifest evidence must mention actual browser URL');
  assertIncludes(manifestEvidenceText, manifest.workspacePath, 'manifest evidence must mention workspace path');
  assert.match(manifestEvidenceText, /gui\.present|live Runtime Codex|live-runtime-codex|Runtime Codex answer rendered|GUI intent/i, 'manifest evidence must prove live Runtime Codex/gui.present output');
  assert.match(manifestEvidenceText, /user intent|用户意图|Actual task result|实际结果|acceptance rubric|验收/i, 'manifest evidence must include user intent and actual result rubric');
  assertDoesNotUseSeedDemoOrRawEvidence(manifestEvidenceText, 'manifest evidence');
  assertScenarioPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioPassed(manifest.artifactFollowUp, 'artifactFollowUp');
  assertScenarioPassed(manifest.multiTurn, 'multiTurn');
  assert.equal(manifest.multiTurn?.secondTurnVisibleAnswerConfirmed, true, 'passed requires visible second-turn answer in Codex in-app browser');
  assert.equal(manifest.multiTurn?.expectedPassphrase, expectedMultiTurnPassphrase, 'multi-turn expected passphrase must be recorded');
}

function assertBlockedOrFailedManifest(manifest: BrowserAcceptanceManifest): void {
  assert.ok(['blocked', 'failed', 'partial'].includes(manifest.status), `unexpected non-passed status: ${manifest.status}`);
  assert.match(manifest.reason ?? manifest.blocker ?? '', /blocked|failed|limitation|missing|unsupported|Phase 1|Codex|Runtime|API key|profile|browser|implementation/i);
  if (manifest.submittedThroughRuntimeCodex || manifest.commandIdVisible) {
    assert.match(manifest.commandId ?? '', /^codex-command-[a-z0-9-]+$/i, 'submitted blocked/failed manifests must record the observed Runtime Codex command id');
  }
  assertScenarioNotPassedUnlessManifestPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioNotPassedUnlessManifestPassed(manifest.artifactFollowUp, 'artifactFollowUp');
  assertScenarioNotPassedUnlessManifestPassed(manifest.multiTurn, 'multiTurn');
  assertEvidenceExists(manifest.evidence, 'manifest evidence');
}

function assertScenarioPassed(scenario: BrowserAcceptanceScenario | undefined, label: string): void {
  assert.ok(scenario, `${label} scenario must be present`);
  assert.equal(scenario.status, 'passed', `${label} must pass before manifest can pass`);
  assert.ok(scenario.userIntent?.trim(), `${label} user intent must be recorded`);
  assertActualTaskResult(scenario.actualTaskResult, `${label} actualTaskResult`);
  assertLiveRuntimeCodexProof(scenario.liveRuntimeCodexProof, undefined, `${label} liveRuntimeCodexProof`);
  assertNegativeChecks(scenario.negativeChecks, `${label} negativeChecks`);
  assert.equal(scenario.visibleAnswerConfirmed, true, `${label} answer must be visibly confirmed`);
  assert.equal(scenario.providerModelProfileVisible, true, `${label} provider/model/profile must be visible`);
  assert.equal(scenario.workspaceCommandIdVisible, true, `${label} workspace/command id must be visible`);
  assert.equal(scenario.rawAuditFoldedByDefault, true, `${label} raw audit must be folded by default`);
  if (label === 'artifactFollowUp') {
    assert.ok((scenario.selectedRefs ?? []).length > 0, `${label} must record selected artifact refs`);
  }
  if (label === 'multiTurn') {
    assert.equal(scenario.secondTurnVisibleAnswerConfirmed, true, `${label} must confirm the visible second-turn answer`);
    assert.ok(scenario.followUpPrompt?.trim(), `${label} must record the second-turn prompt`);
    assert.equal(scenario.expectedPassphrase, expectedMultiTurnPassphrase, `${label} must record the expected passphrase`);
    assert.match(readEvidenceText(scenario.evidence, { includeNotes: true }), new RegExp(escapeRegExp(expectedMultiTurnPassphrase)), `${label} evidence must contain the visible second-turn passphrase`);
  }
  const evidenceText = readEvidenceText(scenario.evidence, { includeNotes: true });
  assertDoesNotUseSeedDemoOrRawEvidence(evidenceText, `${label} evidence`);
  assert.match(evidenceText, /codex-command-[a-z0-9-]+/i, `${label} evidence must include the observed command id`);
  assert.match(evidenceText, /workspace|工作区文件树|Workspace Runtime/i, `${label} evidence must include workspace context`);
  assert.match(evidenceText, /sciforge-runtime-deepseek/i, `${label} evidence must include the Runtime Codex profile`);
  assert.match(evidenceText, /bailian\/deepseek-v4-flash/i, `${label} evidence must include the Runtime Codex model`);
  assert.match(evidenceText, /gui\.present|live Runtime Codex|live-runtime-codex|Runtime Codex answer rendered|GUI intent/i, `${label} evidence must prove live Runtime Codex/gui.present output`);
  assertEvidenceExists(scenario.evidence, `${label} evidence`, { requireScreenshotAndDom: true });
}

function assertScenarioNotPassedUnlessManifestPassed(scenario: BrowserAcceptanceScenario | undefined, label: string): void {
  assert.ok(scenario, `${label} scenario must be present`);
  if (scenario.status !== 'passed') {
    assert.ok(scenario.reason, `${label} blocked/failed scenario must record a reason`);
    assertEvidenceExists(scenario.evidence, `${label} evidence`);
  }
}

function assertEvidenceExists(
  evidence: BrowserAcceptanceEvidence | undefined,
  label: string,
  options: { requireScreenshotAndDom?: boolean } = {},
): void {
  assert.ok(evidence, `${label} must be present`);
  if (options.requireScreenshotAndDom) {
    assert.ok(evidence.screenshotPath, `${label} must include screenshot evidence`);
    assert.ok(evidence.domSnapshotPath, `${label} must include DOM snapshot evidence`);
    assert.ok(evidence.notesPath, `${label} must include notes/rubric evidence`);
  }
  const paths = [
    evidence.screenshotPath,
    evidence.domSnapshotPath,
    evidence.notesPath,
    evidence.runtimeAuditPath,
  ].filter((path): path is string => Boolean(path));
  assert.ok(paths.length > 0, `${label} must include screenshot, DOM, or notes evidence path`);
  for (const evidencePath of paths) {
    const resolved = resolve(root, evidencePath);
    assert.ok(existsSync(resolved), `${label} path does not exist: ${evidencePath}`);
    assert.ok(statSync(resolved).isFile(), `${label} path is not a file: ${evidencePath}`);
    assert.ok(statSync(resolved).size > 0, `${label} path is empty: ${evidencePath}`);
    if (/\.(?:json|jsonl)$/i.test(evidencePath)) {
      assertStructuredEvidenceParses(evidencePath, label);
    }
  }
  if (evidence.domSnapshotPath) {
    const domText = readIfExists(evidence.domSnapshotPath);
    assert.ok(domText.trim(), `${label} DOM snapshot must be readable and non-empty`);
    assert.match(domText, /(?:^- main:|^- complementary:|<main|role=|Ask SciForge|聊天工作台)/m, `${label} DOM snapshot is not parseable browser evidence`);
  }
  if (evidence.notesPath) {
    const notesText = readIfExists(evidence.notesPath);
    assert.ok(notesText.trim(), `${label} notes must be readable and non-empty`);
    assert.match(notesText, /^#|\bAcceptance\b|验收|Observed at:/m, `${label} notes are not parseable acceptance evidence`);
  }
}

function readEvidenceText(evidence: BrowserAcceptanceEvidence | undefined, options: { includeNotes?: boolean } = {}): string {
  if (!evidence) return '';
  return [
    evidence.domSnapshotPath ? readIfExists(evidence.domSnapshotPath) : '',
    options.includeNotes && evidence.notesPath ? readIfExists(evidence.notesPath) : '',
    options.includeNotes && evidence.runtimeAuditPath ? readIfExists(evidence.runtimeAuditPath) : '',
  ].filter(Boolean).join('\n');
}

function assertStructuredEvidenceParses(evidencePath: string, label: string): void {
  const text = readIfExists(evidencePath);
  if (/\.jsonl$/i.test(evidencePath)) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      assert.doesNotThrow(() => JSON.parse(line), `${label} JSONL evidence line ${index + 1} is unparseable: ${evidencePath}`);
    }
    return;
  }
  assert.doesNotThrow(() => JSON.parse(text), `${label} JSON evidence is unparseable: ${evidencePath}`);
}

type ScenarioObservation = Pick<BrowserAcceptanceScenario, 'providerModelProfileVisible' | 'workspaceCommandIdVisible' | 'rawAuditFoldedByDefault'> & {
  domText: string;
  commandId?: string;
  evidence: BrowserAcceptanceEvidence;
};

function blockedScenario(
  summary: string,
  reason: string,
  evidence: BrowserAcceptanceEvidence | undefined = undefined,
  observed: Pick<BrowserAcceptanceScenario, 'providerModelProfileVisible' | 'workspaceCommandIdVisible' | 'rawAuditFoldedByDefault'> = {
    providerModelProfileVisible: false,
    workspaceCommandIdVisible: false,
    rawAuditFoldedByDefault: false,
  },
): BrowserAcceptanceScenario {
  return {
    status: 'blocked',
    prompt: summary,
    visibleAnswerConfirmed: false,
    providerModelProfileVisible: observed.providerModelProfileVisible,
    workspaceCommandIdVisible: observed.workspaceCommandIdVisible,
    rawAuditFoldedByDefault: observed.rawAuditFoldedByDefault,
    reason,
    evidence: evidence ?? { notesPath: relativeFromRoot(blockedNotesPath) },
  };
}

function existingBrowserEvidence(): {
  defaultChatEntryObserved: boolean;
  singleTurnSubmitted: boolean;
  artifactFollowUpSubmitted: boolean;
  multiTurnSecondAnswerVisible: boolean;
  singleTurn: ScenarioObservation;
  artifactFollowUp: ScenarioObservation;
  multiTurn: ScenarioObservation;
  workspaceVisible: boolean;
  providerModelProfileVisible: boolean;
  workspaceCommandIdVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  commandId?: string;
  evidence: BrowserAcceptanceEvidence;
} {
  const defaultObservation = scenarioObservation({
    domCandidates: ['default-chat-dom.txt', 'worker5-chat-entry-dom.txt', 'p4-compat-default-chat-blocked-dom.txt'],
    screenshotCandidates: ['default-chat.png', 'worker5-default-chat.png', 'p4-compat-default-chat-blocked.png'],
  });
  const singleTurn = scenarioObservation({
    domCandidates: ['single-turn-after-submit-dom.txt', 'worker5-single-turn-after-submit-dom.txt'],
    screenshotCandidates: ['single-turn-after-submit.png', 'worker5-single-turn-after-submit.png'],
  });
  const artifactFollowUp = scenarioObservation({
    domCandidates: ['artifact-follow-up-dom.txt', 'artifact-follow-up-after-submit-dom.txt'],
    screenshotCandidates: ['artifact-follow-up.png', 'artifact-follow-up-after-submit.png'],
  });
  const multiTurn = scenarioObservation({
    domCandidates: ['multiturn-second-turn-dom.txt', 'multi-turn-second-turn-dom.txt', 'multiturn-second-answer-dom.txt'],
    screenshotCandidates: ['multiturn-second-turn.png', 'multi-turn-second-turn.png', 'multiturn-second-answer.png'],
  });
  const domText = [defaultObservation.domText, singleTurn.domText, artifactFollowUp.domText, multiTurn.domText].join('\n');
  const providerModelProfileVisible = [singleTurn, artifactFollowUp, multiTurn].some((observation) => observation.providerModelProfileVisible);
  const workspaceCommandIdVisible = [singleTurn, artifactFollowUp, multiTurn].some((observation) => observation.workspaceCommandIdVisible);
  const rawAuditFoldedByDefault = [defaultObservation, singleTurn, artifactFollowUp, multiTurn].every((observation) => observation.rawAuditFoldedByDefault);
  const commandId = [singleTurn, artifactFollowUp, multiTurn, defaultObservation].map((observation) => observation.commandId).find(Boolean);
  return {
    defaultChatEntryObserved: domText.includes('Ask SciForge') && domText.includes('聊天工作台'),
    singleTurnSubmitted: singleTurn.domText.includes('SCIFORGE-CODEX-BROWSER-SINGLE-20260519') || singleTurn.domText.includes('SCIFORGE-W5-SINGLE-TURN'),
    artifactFollowUpSubmitted: /selected artifact|selected ref|用户引用的上下文|research-report|artifact:/i.test(artifactFollowUp.domText),
    multiTurnSecondAnswerVisible: multiTurn.domText.includes(expectedMultiTurnPassphrase),
    singleTurn,
    artifactFollowUp,
    multiTurn,
    workspaceVisible: domText.includes('workspace') || domText.includes('工作区文件树'),
    providerModelProfileVisible,
    workspaceCommandIdVisible,
    rawAuditFoldedByDefault,
    commandId,
    evidence: {
      ...(defaultObservation.evidence.screenshotPath ? { screenshotPath: defaultObservation.evidence.screenshotPath } : {}),
      ...(defaultObservation.evidence.domSnapshotPath ? { domSnapshotPath: defaultObservation.evidence.domSnapshotPath } : {}),
      notesPath: relativeFromRoot(blockedNotesPath),
    },
  };
}

function scenarioObservation(input: { domCandidates: string[]; screenshotCandidates: string[] }): ScenarioObservation {
  const domPath = firstExisting(input.domCandidates.map((file) => join(outputDir, file)));
  const screenshotPath = firstExisting(input.screenshotCandidates.map((file) => join(outputDir, file)));
  const domText = domPath ? readIfExists(domPath) : '';
  return {
    domText,
    providerModelProfileVisible: domText.includes('sciforge-runtime-deepseek')
      && domText.includes('bailian/deepseek-v4-flash')
      && /sciforge-deepseek-proxy|provider/i.test(domText),
    workspaceCommandIdVisible: /workspace|工作区文件树/i.test(domText) && /codex-command|command id|commandId|command\s+codex-command/i.test(domText),
    rawAuditFoldedByDefault: !/RAW_JSONL|RAW_STDERR|RAW_STDOUT|raw provider sse|plugin warning|stderr[^折]|stdout[^折]|jsonl[^折]/i.test(domText),
    commandId: /codex-command-[a-z0-9-]+/i.exec(domText)?.[0],
    evidence: {
      ...(screenshotPath ? { screenshotPath: relativeFromRoot(screenshotPath) } : {}),
      ...(domPath ? { domSnapshotPath: relativeFromRoot(domPath) } : {}),
      notesPath: relativeFromRoot(blockedNotesPath),
    },
  };
}

function blockedNotes(reason: string): string {
  return [
    '# Runtime Codex browser acceptance blocked',
    '',
    `Observed at: ${new Date().toISOString()}`,
    `Requested UI port: ${requestedRolePort}`,
    `Requested workspace writer port: ${requestedWorkspaceWriterPort}`,
    `Actual/intended URL: ${actualUrl}`,
    `Actual/intended workspace writer URL: ${actualWorkspaceWriterUrl}`,
    `Actual/intended RuntimeCodex URL: ${actualRuntimeCodexUrl}`,
    `Workspace path: ${workspacePath}`,
    'Profile: sciforge-runtime-deepseek',
    'Provider: sciforge-deepseek-proxy',
    'Model: bailian/deepseek-v4-flash',
    `Reason: ${reason}`,
    'Acceptance scope: non-seed Runtime Codex messages only; seed/demo/fixture messages are excluded from success criteria.',
    '',
    'Acceptance rubric:',
    '- User intent: prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.',
    '- Expected observable result: visible live Runtime Codex/gui.present answers with provider/model/profile/workspace/command id and folded audit logs.',
    `- Actual result: blocked before release acceptance because ${reason}`,
    '- Evidence refs: manifest.json plus screenshot/DOM/notes paths recorded in this bundle.',
    '- Negative checks: fake passed status, missing DOM/screenshot, missing command id, missing task result, seed/demo evidence, and partial/blocked/failed status remain release-blocking.',
    '- Remaining risk: live browser acceptance still requires a configured Runtime Codex API key and visible second-turn answer.',
    '',
    'No passed user-level conclusion is claimed.',
  ].join('\n') + '\n';
}

function assertAcceptanceRubric(rubric: AcceptanceRubric | undefined, label: string): void {
  assert.ok(rubric, `${label} is required`);
  assert.ok(rubric.userIntent?.trim(), `${label}.userIntent is required`);
  assert.ok(rubric.expectedObservableResult?.trim(), `${label}.expectedObservableResult is required`);
  assert.ok(rubric.actualResult?.trim(), `${label}.actualResult is required`);
  assert.ok((rubric.evidenceRefs ?? []).length > 0, `${label}.evidenceRefs are required`);
  assert.ok((rubric.negativeChecks ?? []).length > 0, `${label}.negativeChecks are required`);
  assert.ok(typeof rubric.remainingRisks === 'string', `${label}.remainingRisks is required`);
}

function assertActualTaskResult(result: ActualTaskResult | undefined, label: string): void {
  assert.ok(result, `${label} is required`);
  assert.equal(result.status, 'passed', `${label}.status must be passed`);
  assert.ok(result.summary?.trim(), `${label}.summary is required`);
  assert.equal(result.userIntentSatisfied, true, `${label}.userIntentSatisfied must be true`);
  assert.equal(result.outputVerified, true, `${label}.outputVerified must be true`);
  assert.ok((result.evidenceRefs ?? []).length > 0, `${label}.evidenceRefs are required`);
}

function assertLiveRuntimeCodexProof(proof: LiveRuntimeCodexProof | undefined, expectedCommandId: string | undefined, label: string): void {
  assert.ok(proof, `${label} is required`);
  assert.equal(proof.messageProvenance, 'live-runtime-codex', `${label}.messageProvenance must be live-runtime-codex`);
  assert.equal(proof.guiPresentObserved, true, `${label}.guiPresentObserved must be true`);
  assert.equal(proof.runtimeOutputObserved, true, `${label}.runtimeOutputObserved must be true`);
  assert.equal(proof.seedOrDemoExcluded, true, `${label}.seedOrDemoExcluded must be true`);
  assert.ok((proof.eventEvidenceRefs ?? []).length > 0, `${label}.eventEvidenceRefs are required`);
  if (expectedCommandId) {
    assert.equal(proof.commandId, expectedCommandId, `${label}.commandId must match manifest command id`);
  } else {
    assert.match(proof.commandId ?? '', /^codex-command-[a-z0-9-]+$/i, `${label}.commandId is required`);
  }
}

function assertNegativeChecks(checks: NegativeChecks | undefined, label: string): void {
  assert.ok(checks, `${label} is required`);
  assert.equal(checks.fakePassedStatusRejected, true, `${label}.fakePassedStatusRejected must be true`);
  assert.equal(checks.missingDomOrScreenshotRejected, true, `${label}.missingDomOrScreenshotRejected must be true`);
  assert.equal(checks.missingCommandIdRejected, true, `${label}.missingCommandIdRejected must be true`);
  assert.equal(checks.missingTaskResultRejected, true, `${label}.missingTaskResultRejected must be true`);
  assert.equal(checks.seedDemoEvidenceRejected, true, `${label}.seedDemoEvidenceRejected must be true`);
  assert.equal(checks.blockedFailedPartialRejected, true, `${label}.blockedFailedPartialRejected must be true`);
  assert.equal(checks.rawStdoutJsonlRejected, true, `${label}.rawStdoutJsonlRejected must be true`);
}

function assertDoesNotUseSeedDemoOrRawEvidence(text: string, label: string): void {
  assert.doesNotMatch(text, /\b(?:seed-|seed demo|seed-demo|demo message|fixture success|scriptable-mock|literature-evidence-review@1\.0\.0|KRAS G12C)\b/i, `${label} must not count seed/demo/fixture text as acceptance`);
  assert.doesNotMatch(text, /\b(?:RAW_JSONL|RAW_STDERR|RAW_STDOUT|raw provider sse|plugin warning|stdout|stderr|jsonl)\b/i, `${label} must not use raw stdout/jsonl/stderr/provider logs as main-answer proof`);
}

function assertIncludes(text: string, value: string | undefined, message: string): void {
  assert.ok(value?.trim(), `${message}: missing expected value`);
  assert.ok(text.includes(value ?? ''), message);
}

function assertUrlPortMatches(url: string | undefined, port: number | undefined, label: string): void {
  assert.ok(url, `${label} is required`);
  assert.equal(new URL(url).port, String(port), `${label} port must match recorded actual port`);
}

function builtInNegativeChecks(): NegativeChecks {
  return {
    fakePassedStatusRejected: true,
    missingDomOrScreenshotRejected: true,
    missingCommandIdRejected: true,
    missingTaskResultRejected: true,
    seedDemoEvidenceRejected: true,
    blockedFailedPartialRejected: true,
    rawStdoutJsonlRejected: true,
  };
}

function blockedAcceptanceRubric(reason: string): AcceptanceRubric {
  return {
    userIntent: 'Prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.',
    expectedObservableResult: 'Visible live Runtime Codex/gui.present answers with provider/model/profile/workspace/command id and folded audit logs.',
    actualResult: `Blocked before release acceptance: ${reason}`,
    evidenceRefs: [relativeFromRoot(manifestPath), relativeFromRoot(blockedNotesPath)],
    negativeChecks: [
      'fake passed status rejected',
      'missing DOM or screenshot rejected',
      'missing command id rejected',
      'missing task result rejected',
      'seed/demo evidence rejected',
      'blocked/failed/partial status rejected in strict mode',
    ],
    remainingRisks: 'Live browser acceptance still requires configured Runtime Codex credentials and a visible second-turn answer.',
  };
}

function assertNegativeFixtures(): void {
  const fixtureDir = mkdtempSync(join(tmpdir(), `sciforge-${instanceProfile.id}-negative-manifest-validator-`));
  writeNegativeFixtures(fixtureDir);
  const fixtures = [
    'fake-passed-missing-dom.json',
    'fake-passed-seed-demo.json',
    'fake-passed-missing-command-id.json',
    'fake-passed-missing-task-result.json',
    'fake-passed-unparseable-evidence.json',
    'blocked-status.json',
    'failed-status.json',
    'partial-status.json',
  ];
  for (const fixture of fixtures) {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, fixture), 'utf8')) as BrowserAcceptanceManifest;
    let rejected = false;
    try {
      assertPassedManifest(manifest);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `negative fixture must be rejected: ${fixture}`);
  }
}

function writeNegativeFixtures(fixtureDir: string): void {
  mkdirSync(fixtureDir, { recursive: true });
  const artifactRoot = relativeFromRoot(fixtureDir);
  const fixturePath = (file: string): string => `${artifactRoot}/${file}`;
  writeFixture(fixtureDir, 'valid-dom.txt', [
    '- main:',
    '  - strong: Ask SciForge',
    `  - generic: Actual browser URL ${actualUrl}`,
    `  - generic: workspace ${workspacePath}`,
    '  - generic: sciforge-runtime-deepseek',
    '  - generic: sciforge-deepseek-proxy',
    '  - generic: bailian/deepseek-v4-flash',
    '  - generic: command codex-command-negative-001',
    '  - generic: gui.present show-result from live Runtime Codex',
    '  - paragraph: Runtime Codex completed the requested browser task and rendered the answer in the main chat.',
    '  - paragraph: SCIFORGE-CODEX-BROWSER-MT-20260519',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'seed-demo-dom.txt', [
    '- main:',
    '  - strong: Ask SciForge',
    `  - generic: Actual browser URL ${actualUrl}`,
    `  - generic: workspace ${workspacePath}`,
    '  - generic: sciforge-runtime-deepseek',
    '  - generic: sciforge-deepseek-proxy',
    '  - generic: bailian/deepseek-v4-flash',
    '  - generic: command codex-command-negative-001',
    '  - generic: gui.present show-result from live Runtime Codex',
    '  - code: literature-evidence-review@1.0.0',
    '  - paragraph: seed-demo fixture success for KRAS G12C should never count as live Runtime Codex acceptance.',
    '  - paragraph: SCIFORGE-CODEX-BROWSER-MT-20260519',
    '  - generic: audit folded by default',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'valid-notes.md', [
    '# Acceptance rubric',
    '',
    'User intent: prove the real default-chat Runtime Codex browser path completed the requested task.',
    'Expected observable result: visible live Runtime Codex/gui.present output with URL, workspace, provider, model, profile, and command id.',
    `Actual task result: Runtime Codex rendered a live answer for command codex-command-negative-001 at ${actualUrl} in workspace ${workspacePath}.`,
    'Evidence refs: valid-dom.txt and screen.png.',
    'Negative checks: seed/demo excluded; audit/debug output not used as the main answer; forged passed and partial states rejected.',
    'Remaining risks: none for this validator fixture.',
    '',
  ].join('\n'));
  writeFixture(fixtureDir, 'bad-evidence.json', '{ "this": "is not parseable"\n');
  writeFixture(fixtureDir, 'screen.png', 'placeholder screenshot bytes for manifest validator negative fixtures\n');

  const validDom = fixturePath('valid-dom.txt');
  const seedDom = fixturePath('seed-demo-dom.txt');
  const notes = fixturePath('valid-notes.md');
  const screenshot = fixturePath('screen.png');
  const badEvidence = fixturePath('bad-evidence.json');
  writeJsonFixture(fixtureDir, 'fake-passed-missing-dom.json', {
    ...passedFixtureManifest(validDom, notes, screenshot),
    evidence: { screenshotPath: screenshot, notesPath: notes },
  });
  writeJsonFixture(fixtureDir, 'fake-passed-seed-demo.json', passedFixtureManifest(seedDom, notes, screenshot));
  const missingCommandId = passedFixtureManifest(validDom, notes, screenshot);
  delete missingCommandId.commandId;
  writeJsonFixture(fixtureDir, 'fake-passed-missing-command-id.json', missingCommandId);
  const missingTaskResult = passedFixtureManifest(validDom, notes, screenshot);
  delete missingTaskResult.actualTaskResult;
  writeJsonFixture(fixtureDir, 'fake-passed-missing-task-result.json', missingTaskResult);
  writeJsonFixture(fixtureDir, 'fake-passed-unparseable-evidence.json', passedFixtureManifest(validDom, badEvidence, screenshot));
  writeJsonFixture(fixtureDir, 'blocked-status.json', {
    ...passedFixtureManifest(validDom, notes, screenshot),
    status: 'blocked',
    reason: 'blocked status must remain release-blocking',
  });
  writeJsonFixture(fixtureDir, 'failed-status.json', {
    ...passedFixtureManifest(validDom, notes, screenshot),
    status: 'failed',
    reason: 'failed status must remain release-blocking',
  });
  writeJsonFixture(fixtureDir, 'partial-status.json', {
    ...passedFixtureManifest(validDom, notes, screenshot),
    status: 'partial',
    reason: 'partial status must remain release-blocking',
  });
}

function passedFixtureManifest(domPath: string, notesPath: string, screenshotPath: string): BrowserAcceptanceManifest {
  const evidence = { screenshotPath, domSnapshotPath: domPath, notesPath };
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    actualUrl,
    actualPort: requestedRolePort,
    actualWorkspaceWriterPort: requestedWorkspaceWriterPort,
    actualWorkspaceWriterUrl,
    actualRuntimeCodexPort: requestedRuntimeCodexPort,
    actualRuntimeCodexUrl,
    workspacePath,
    profile: 'sciforge-runtime-deepseek',
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    commandId: 'codex-command-negative-001',
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
    acceptanceRubric: {
      userIntent: 'prove browser acceptance',
      expectedObservableResult: 'visible live Runtime Codex result',
      actualResult: 'visible live Runtime Codex result',
      evidenceRefs: [domPath, notesPath],
      negativeChecks: ['seed/demo excluded'],
      remainingRisks: 'none',
    },
    actualTaskResult: passedTaskResult(domPath),
    liveRuntimeCodexProof: passedLiveProof(domPath),
    negativeChecks: builtInNegativeChecks(),
    evidence,
    singleTurn: passedScenario('single turn', evidence),
    artifactFollowUp: { ...passedScenario('artifact follow up', evidence), selectedRefs: ['artifact:negative-fixture'] },
    multiTurn: {
      ...passedScenario('multi turn', evidence),
      followUpPrompt: 'reply with the remembered passphrase',
      expectedPassphrase: expectedMultiTurnPassphrase,
      secondTurnVisibleAnswerConfirmed: true,
    },
  };
}

function passedScenario(userIntent: string, evidence: BrowserAcceptanceEvidence): BrowserAcceptanceScenario {
  return {
    status: 'passed',
    prompt: userIntent,
    userIntent,
    actualTaskResult: passedTaskResult(evidence.domSnapshotPath ?? ''),
    liveRuntimeCodexProof: passedLiveProof(evidence.domSnapshotPath ?? ''),
    negativeChecks: builtInNegativeChecks(),
    visibleAnswerConfirmed: true,
    providerModelProfileVisible: true,
    workspaceCommandIdVisible: true,
    rawAuditFoldedByDefault: true,
    evidence,
  };
}

function passedTaskResult(evidenceRef: string): ActualTaskResult {
  return {
    status: 'passed',
    summary: 'Runtime Codex completed the requested browser task.',
    userIntentSatisfied: true,
    outputVerified: true,
    evidenceRefs: [evidenceRef],
  };
}

function passedLiveProof(evidenceRef: string): LiveRuntimeCodexProof {
  return {
    messageProvenance: 'live-runtime-codex',
    commandId: 'codex-command-negative-001',
    guiPresentObserved: true,
    runtimeOutputObserved: true,
    seedOrDemoExcluded: true,
    eventEvidenceRefs: [evidenceRef],
  };
}

function writeFixture(fixtureDir: string, file: string, content: string): void {
  writeFileSync(join(fixtureDir, file), content, 'utf8');
}

function writeJsonFixture(fixtureDir: string, file: string, content: unknown): void {
  writeFixture(fixtureDir, file, `${JSON.stringify(content, null, 2)}\n`);
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

function portFromEnv(primary: string | undefined, secondary: string | undefined, fallback: number): number {
  for (const value of [primary, secondary]) {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return fallback;
}

function relativeFromRoot(path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function readIfExists(path: string): string {
  try {
    return existsSync(resolve(root, path)) ? String(readFileSync(resolve(root, path))) : '';
  } catch {
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeManifest(manifest: BrowserAcceptanceManifest): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function readManifest(): Promise<BrowserAcceptanceManifest> {
  const raw = await readFile(manifestPath, 'utf8').catch((error: unknown) => {
    throw new Error(`Runtime bridge is present, but Codex in-app browser evidence is missing at ${manifestPath}: ${(error as Error).message}`);
  });
  return JSON.parse(raw) as BrowserAcceptanceManifest;
}
