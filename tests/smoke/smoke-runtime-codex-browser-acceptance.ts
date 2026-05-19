import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type BrowserAcceptanceManifest = {
  schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1';
  status: 'blocked' | 'failed' | 'passed';
  source: 'codex-in-app-browser';
  observedAt?: string;
  requestedRolePort?: number;
  actualWorkspaceWriterPort?: number;
  actualUrl?: string;
  actualPort?: number;
  profile?: string;
  provider?: string;
  model?: string;
  startedFromDefaultChatEntry: boolean;
  submittedThroughRuntimeCodex: boolean;
  providerModelProfileVisible: boolean;
  workspaceVisible?: boolean;
  commandIdVisible?: boolean;
  mainAnswerVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  automationSubstituteUsed?: boolean;
  acceptanceConclusionFromRealBrowser?: boolean;
  singleTurn?: BrowserAcceptanceScenario;
  multiTurn?: BrowserAcceptanceScenario;
  evidence?: BrowserAcceptanceEvidence;
  reason?: string;
  blocker?: string;
  blockedOn?: string[];
};

type BrowserAcceptanceScenario = {
  status: 'blocked' | 'failed' | 'passed';
  prompt?: string;
  followUpPrompt?: string;
  expectedPassphrase?: string;
  visibleAnswerConfirmed: boolean;
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
};

const root = process.cwd();
const outputDir = resolve(root, 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance');
const manifestPath = join(outputDir, 'manifest.json');
const blockedNotesPath = join(outputDir, 'blocked-runtime-config.md');
const requestedRolePort = Number(process.env.SCIFORGE_WORKER5_UI_PORT || process.env.SCIFORGE_UI_PORT || 5178);
const requestedWorkspaceWriterPort = Number(process.env.SCIFORGE_WORKER5_WORKSPACE_PORT || process.env.SCIFORGE_WORKSPACE_PORT || 5174);

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
    actualUrl: `http://127.0.0.1:${requestedRolePort}/`,
    actualPort: requestedRolePort,
    profile: 'sciforge-runtime-deepseek',
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    startedFromDefaultChatEntry: browserEvidence.defaultChatEntryObserved,
    submittedThroughRuntimeCodex: browserEvidence.singleTurnSubmitted,
    providerModelProfileVisible: browserEvidence.providerModelProfileVisible,
    workspaceVisible: browserEvidence.workspaceVisible,
    commandIdVisible: false,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: browserEvidence.rawAuditFoldedByDefault,
    automationSubstituteUsed: false,
    acceptanceConclusionFromRealBrowser: false,
    reason: blockedReason,
    blocker: blockedReason,
    blockedOn: blockedReason.includes('API key')
      ? ['Runtime Codex environment configuration', 'Codex in-app browser execution']
      : ['Worker A runtime bridge integration', 'Worker C UI Runtime Codex integration'],
    singleTurn: blockedScenario(
      browserEvidence.singleTurnSubmitted
        ? 'Worker 5 single-turn acceptance check: reply in one short sentence with the phrase SCIFORGE-W5-SINGLE-TURN.'
        : 'single-turn Runtime Codex browser acceptance is blocked before submission',
      blockedReason,
      browserEvidence.singleTurnSubmitted ? browserEvidence.evidence : undefined,
      {
        providerModelProfileVisible: browserEvidence.providerModelProfileVisible,
        workspaceCommandIdVisible: false,
        rawAuditFoldedByDefault: browserEvidence.rawAuditFoldedByDefault,
      },
    ),
    multiTurn: blockedScenario('multi-turn passphrase browser acceptance is blocked before submission', blockedReason),
    evidence: browserEvidence.evidence,
  };
  await writeManifest(manifest);
  console.log(`[blocked] Runtime Codex browser E2E is blocked: ${blockedReason}; wrote ${manifestPath}`);
} else {
  const manifest = await readManifest();
  assert.equal(manifest.schemaVersion, 'sciforge.runtime-codex.browser-acceptance.v1');
  assert.equal(manifest.source, 'codex-in-app-browser');
  assert.notEqual(manifest.automationSubstituteUsed, true, 'system browser, macOS open, external Chrome, or non-user-level automation cannot be acceptance evidence');
  assert.match(manifest.actualUrl ?? '', /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, 'actual browser URL must be recorded');
  assert.ok(manifest.actualPort, 'actual UI port must be recorded after port preflight');
  assert.ok(manifest.actualWorkspaceWriterPort, 'actual workspace writer port must be recorded after port preflight');
  assert.equal(manifest.profile, 'sciforge-runtime-deepseek', 'Runtime Codex profile must be recorded');
  assert.ok(manifest.reason || manifest.status === 'passed', 'blocked/failed manifests must record a reason');

  if (manifest.status === 'passed') {
    assertPassedManifest(manifest);
    console.log(`[ok] Runtime Codex in-app browser acceptance passed with real evidence from ${manifestPath}`);
  } else {
    assertBlockedOrFailedManifest(manifest);
    console.log(`[${manifest.status}] Runtime Codex in-app browser acceptance is not passed; evidence contract verified from ${manifestPath}`);
  }
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
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, true, 'passed requires a real in-app browser conclusion');
  assert.equal(manifest.startedFromDefaultChatEntry, true, 'must start from existing default chat entry');
  assert.equal(manifest.submittedThroughRuntimeCodex, true, 'must submit through Runtime Codex');
  assert.equal(manifest.providerModelProfileVisible, true, 'provider/model/profile must be visible');
  assert.equal(manifest.workspaceVisible, true, 'workspace must be visible');
  assert.equal(manifest.commandIdVisible, true, 'command id must be visible');
  assert.equal(manifest.mainAnswerVisible, true, 'main answer must be visible');
  assert.equal(manifest.rawAuditFoldedByDefault, true, 'raw audit must be folded by default');
  assertScenarioPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioPassed(manifest.multiTurn, 'multiTurn');
  assertEvidenceExists(manifest.evidence, 'manifest evidence');
}

function assertBlockedOrFailedManifest(manifest: BrowserAcceptanceManifest): void {
  assert.match(manifest.reason ?? manifest.blocker ?? '', /blocked|failed|limitation|missing|unsupported|Phase 1|Codex|Runtime|API key|profile|browser|implementation/i);
  assertScenarioNotPassedUnlessManifestPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioNotPassedUnlessManifestPassed(manifest.multiTurn, 'multiTurn');
  assertEvidenceExists(manifest.evidence, 'manifest evidence');
}

function assertScenarioPassed(scenario: BrowserAcceptanceScenario | undefined, label: string): void {
  assert.ok(scenario, `${label} scenario must be present`);
  assert.equal(scenario.status, 'passed', `${label} must pass before manifest can pass`);
  assert.equal(scenario.visibleAnswerConfirmed, true, `${label} answer must be visibly confirmed`);
  assert.equal(scenario.providerModelProfileVisible, true, `${label} provider/model/profile must be visible`);
  assert.equal(scenario.workspaceCommandIdVisible, true, `${label} workspace/command id must be visible`);
  assert.equal(scenario.rawAuditFoldedByDefault, true, `${label} raw audit must be folded by default`);
  assertEvidenceExists(scenario.evidence, `${label} evidence`);
}

function assertScenarioNotPassedUnlessManifestPassed(scenario: BrowserAcceptanceScenario | undefined, label: string): void {
  assert.ok(scenario, `${label} scenario must be present`);
  if (scenario.status !== 'passed') {
    assert.ok(scenario.reason, `${label} blocked/failed scenario must record a reason`);
    assertEvidenceExists(scenario.evidence, `${label} evidence`);
  }
}

function assertEvidenceExists(evidence: BrowserAcceptanceEvidence | undefined, label: string): void {
  assert.ok(evidence, `${label} must be present`);
  const paths = [
    evidence.screenshotPath,
    evidence.domSnapshotPath,
    evidence.notesPath,
  ].filter((path): path is string => Boolean(path));
  assert.ok(paths.length > 0, `${label} must include screenshot, DOM, or notes evidence path`);
  for (const evidencePath of paths) {
    assert.ok(existsSync(resolve(root, evidencePath)), `${label} path does not exist: ${evidencePath}`);
  }
}

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
  providerModelProfileVisible: boolean;
  workspaceVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  evidence: BrowserAcceptanceEvidence;
} {
  const chatDomPath = join(outputDir, 'worker5-chat-entry-dom.txt');
  const singleTurnDomPath = join(outputDir, 'worker5-single-turn-after-submit-dom.txt');
  const singleTurnScreenshotPath = join(outputDir, 'worker5-single-turn-after-submit.png');
  const defaultScreenshotPath = join(outputDir, 'worker5-default-chat.png');
  const domPath = existsSync(singleTurnDomPath) ? singleTurnDomPath : chatDomPath;
  const domText = existsSync(domPath) ? readIfExists(domPath) : '';
  const screenshotPath = existsSync(singleTurnScreenshotPath) ? singleTurnScreenshotPath : defaultScreenshotPath;
  return {
    defaultChatEntryObserved: domText.includes('Ask SciForge') && domText.includes('聊天工作台'),
    singleTurnSubmitted: domText.includes('SCIFORGE-W5-SINGLE-TURN'),
    providerModelProfileVisible: domText.includes('sciforge-runtime-deepseek') && domText.includes('bailian/deepseek-v4-flash'),
    workspaceVisible: domText.includes('workspace') || domText.includes('工作区文件树'),
    rawAuditFoldedByDefault: !/RAW_JSONL|RAW_STDERR|stderr|stdout|jsonl/i.test(domText),
    evidence: {
      ...(existsSync(screenshotPath) ? { screenshotPath: relativeFromRoot(screenshotPath) } : {}),
      ...(existsSync(domPath) ? { domSnapshotPath: relativeFromRoot(domPath) } : {}),
      notesPath: relativeFromRoot(blockedNotesPath),
    },
  };
}

function blockedNotes(reason: string): string {
  return [
    '# Runtime Codex browser acceptance blocked',
    '',
    `Observed at: ${new Date().toISOString()}`,
    `Requested Worker 5 UI port: ${requestedRolePort}`,
    `Requested Worker 5 workspace writer port: ${requestedWorkspaceWriterPort}`,
    'Intended URL: http://127.0.0.1:' + requestedRolePort + '/',
    'Profile: sciforge-runtime-deepseek',
    'Provider: sciforge-deepseek-proxy',
    'Model: bailian/deepseek-v4-flash',
    `Reason: ${reason}`,
    '',
    'No passed user-level conclusion is claimed. A passed manifest requires a Codex in-app browser observation from the default chat entry with visible provider/model/profile/workspace/command id, visible main answer, and folded raw audit.',
  ].join('\n') + '\n';
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
