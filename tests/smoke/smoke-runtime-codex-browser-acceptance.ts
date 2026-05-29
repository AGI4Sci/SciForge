import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { resolveProxyCliOptions } from '../../packages/backend/src/cli-config.js';
import { normalizeInstanceName, parallelProfile } from '../../src/runtime/parallel-instance-profile.js';
import { blockedOnForReason } from './helpers/runtime-codex-browser-acceptance-blockers.js';
import { assertRuntimeCodexBrowserAcceptanceNegativeFixtures } from './helpers/runtime-codex-browser-acceptance-negative-fixtures.js';

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
  currentRunEvidenceScope?: 'preflight-only' | 'live-browser-current-run';
  priorEvidenceRefs?: string[];
  staleEvidenceRefs?: string[];
  failureClass?: 'missing-runtime-env' | 'config-secret-source' | 'missing-upstream' | 'provider-unavailable' | 'runtime-bridge' | 'unknown';
  owner?: 'environment' | 'provider' | 'repo';
  policyViolations?: string[];
  missingEnv?: string[];
  nextActions?: BlockedNextAction[];
  expectedRetestCommand?: string;
  releaseBlocking?: boolean;
  releaseEligible?: boolean;
  providerPreflightRef?: string;
  providerPreflightCategory?: string;
  providerPreflightCheckedAt?: string;
  providerPreflightReleaseAcceptance?: 'not-evaluated';
  providerPreflightEvidenceMode?: 'current-env-diagnostic-only';
  runtimeApiKeyPresentInServiceEnv?: boolean;
  upstreamBaseUrlPresent?: boolean;
  upstreamKeySourceKind?: 'env' | 'config-debug-fallback' | 'missing';
  upstreamBaseUrlSourceKind?: 'env' | 'config' | 'missing';
  configPathsChecked?: string[];
  configSecretFallbackPaths?: string[];
  currentPortStatus?: Record<string, PortStatus>;
  serviceEnvRequired?: {
    required: string[];
    missing: string[];
    runtimeApiKeySource: 'service-env-required';
    note: string;
  };
  exactStartCommands?: string[];
  exactRetestCommands?: string[];
  strictRetestCommand?: string;
  configFallbackWarning?: string;
};

type PortStatus = {
  host: string;
  port: number;
  listening: boolean;
  healthOk?: boolean;
  healthUrl?: string;
  note?: string;
};

type CurrentEnvProviderPreflightManifest = {
  schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1';
  checkedAt: string;
  releaseAcceptance: 'not-evaluated';
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamKeySourceKind: 'env' | 'config-debug-fallback' | 'missing';
  upstreamBaseUrlSourceKind: 'env' | 'config' | 'missing';
  configPathsChecked: string[];
  configSecretFallbackPaths: string[];
  category: string;
  owner: 'environment' | 'provider' | 'repo';
  policyViolations: string[];
  missingEnv: string[];
  evidenceMode: 'current-env-diagnostic-only';
};

type BlockedNextAction = {
  label: string;
  command?: string;
  expected?: string;
  writesRepo?: boolean;
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
  nativeDefaultChatAssistantAnswerRendered?: boolean;
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
  nativeAnswerOutsideDefaultChatRejected?: boolean;
};

const DEFAULT_PROVIDER_PROXY_PORT = 3891;
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
const providerPreflightManifestPath = join(root, 'docs', 'test-artifacts', 'runtime-provider-preflight', 'manifest.json');
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
const requestedProviderProxyPort = portFromEnv(
  process.env.SCIFORGE_PROXY_PORT,
  process.env[`SCIFORGE_${instanceProfile.id.toUpperCase()}_PROXY_PORT`],
  DEFAULT_PROVIDER_PROXY_PORT,
);
const workspacePath = process.env.SCIFORGE_WORKSPACE_PATH ?? resolve(root, instanceProfile.workspacePath);
const actualUrl = `http://127.0.0.1:${requestedRolePort}/`;
const actualWorkspaceWriterUrl = `http://127.0.0.1:${requestedWorkspaceWriterPort}`;
const actualRuntimeCodexUrl = `http://127.0.0.1:${requestedRuntimeCodexPort}`;
const runtimeCodexIdentity = readRuntimeCodexIdentity();
const singleTurnPrompt = 'Runtime Codex browser smoke single turn: reply in one short sentence with SCIFORGE-CODEX-BROWSER-SINGLE-20260520A.';
const artifactFollowUpPrompt = 'Use only the selected artifact ref and answer what it says in one concise sentence.';
const multiTurnPrompt = 'Remember this passphrase for the next browser turn: SCIFORGE-CODEX-BROWSER-MT-20260520A. Reply only remembered.';
const multiTurnFollowUpPrompt = 'Now reply only with the passphrase from the previous turn.';
const expectedMultiTurnPassphrase = 'SCIFORGE-CODEX-BROWSER-MT-20260520A';
const requireLiveBrowserAcceptance = process.env.SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE === '1';
const validateOnly = process.env.SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY === '1';
const passedManifestMaxAgeMs = positiveNumberFromEnv(process.env.SCIFORGE_BROWSER_ACCEPTANCE_MAX_AGE_MINUTES, 30) * 60 * 1000;
const evidenceMtimeToleranceMs = positiveNumberFromEnv(process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_MTIME_TOLERANCE_MINUTES, 10) * 60 * 1000;

assertRuntimeCodexBrowserAcceptanceNegativeFixtures({
  root,
  instanceId: instanceProfile.id,
  actualUrl,
  requestedRolePort,
  requestedWorkspaceWriterPort,
  actualWorkspaceWriterUrl,
  requestedRuntimeCodexPort,
  actualRuntimeCodexUrl,
  workspacePath,
  runtimeCodexIdentity,
  expectedMultiTurnPassphrase,
  negativeChecks: builtInNegativeChecks(),
  assertBrowserAcceptanceManifest,
});

const blockedReason = runtimeBridgeBlockedReason();
if (blockedReason) {
  if (validateOnly) {
    const manifest = await readManifest();
    assertBrowserAcceptanceManifest(manifest);
    console.log(`[validate-only] Runtime Codex browser acceptance evidence contract verified from ${manifestPath}; current preflight is blocked: ${blockedReason}`);
    if (requireLiveBrowserAcceptance) {
      console.error('[strict] SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 cannot accept prior evidence while the current preflight is blocked.');
      process.exitCode = 1;
    }
    process.exit();
  }
  await writeBlockedAcceptanceManifest(blockedReason);
  console.log(`[blocked] Runtime Codex browser E2E is blocked: ${blockedReason}; wrote ${manifestPath}`);
  if (requireLiveBrowserAcceptance) {
    console.error('[strict] SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 requires manifest.status === passed; blocked manifest is not release acceptance.');
    process.exitCode = 1;
  }
} else {
  let manifest = await readManifest().catch(async (error: unknown) => writeBlockedAcceptanceManifest(
    `Current Runtime Codex provider preflight is ready, but Codex in-app browser acceptance evidence is missing: ${(error as Error).message}`,
  ));
  try {
    assertBrowserAcceptanceManifest(manifest);
  } catch (error) {
    if (manifest.status === 'passed') throw error;
    manifest = await writeBlockedAcceptanceManifest(
      `Current Runtime Codex provider preflight is ready, but Codex in-app browser acceptance evidence is incomplete or stale: ${(error as Error).message}`,
    );
    assertBrowserAcceptanceManifest(manifest);
  }
  if (manifest.status !== 'passed') {
    const currentReason = currentBrowserEvidenceBlockedReason();
    if (stalePreflightOnlyManifest(manifest) || currentBlockedManifestNeedsRefresh(manifest, currentReason)) {
      manifest = await writeBlockedAcceptanceManifest(currentReason);
    }
    assertBrowserAcceptanceManifest(manifest);
  }
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

async function writeBlockedAcceptanceManifest(blockedReason: string): Promise<BrowserAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  const providerPreflight = readOrWriteCurrentProviderPreflightManifest();
  await writeFile(blockedNotesPath, blockedNotes(blockedReason, providerPreflight), 'utf8');
  const observedAt = new Date().toISOString();
  const priorBrowserEvidence = existingBrowserEvidence();
  const preflightOnly = isPreflightOnlyBlockedReason(blockedReason) || !hasCurrentLiveBrowserEvidence(priorBrowserEvidence);
  const browserEvidence = preflightOnly
    ? preflightOnlyBrowserEvidence(priorBrowserEvidence)
    : priorBrowserEvidence;
  const diagnostics = blockedDiagnosticsForReason(blockedReason);
  const currentPortStatus = await probeCurrentPortStatus();
  const exactCommands = exactServiceEnvCommands();
  const manifest: BrowserAcceptanceManifest = {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt,
    requestedRolePort,
    actualWorkspaceWriterPort: requestedWorkspaceWriterPort,
    actualWorkspaceWriterUrl,
    actualRuntimeCodexPort: requestedRuntimeCodexPort,
    actualRuntimeCodexUrl,
    actualUrl,
    actualPort: requestedRolePort,
    workspacePath,
    profile: runtimeCodexIdentity.profile,
    provider: runtimeCodexIdentity.provider,
    model: runtimeCodexIdentity.model,
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
    blockedOn: blockedOnForReason(blockedReason),
    currentRunEvidenceScope: preflightOnly ? 'preflight-only' : 'live-browser-current-run',
    priorEvidenceRefs: preflightOnly ? priorBrowserEvidence.priorEvidenceRefs : undefined,
    staleEvidenceRefs: preflightOnly ? priorBrowserEvidence.staleEvidenceRefs : undefined,
    failureClass: diagnostics.failureClass,
    owner: diagnostics.owner,
    policyViolations: diagnostics.policyViolations,
    missingEnv: diagnostics.missingEnv,
    nextActions: diagnostics.nextActions,
    expectedRetestCommand: diagnostics.expectedRetestCommand,
    providerPreflightRef: relativeFromRoot(providerPreflightManifestPath),
    providerPreflightCategory: providerPreflight.category,
    providerPreflightCheckedAt: providerPreflight.checkedAt,
    providerPreflightReleaseAcceptance: providerPreflight.releaseAcceptance,
    providerPreflightEvidenceMode: providerPreflight.evidenceMode,
    runtimeApiKeyPresentInServiceEnv: providerPreflight.runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent: providerPreflight.upstreamBaseUrlPresent,
    upstreamKeySourceKind: providerPreflight.upstreamKeySourceKind,
    upstreamBaseUrlSourceKind: providerPreflight.upstreamBaseUrlSourceKind,
    configPathsChecked: providerPreflight.configPathsChecked,
    configSecretFallbackPaths: providerPreflight.configSecretFallbackPaths,
    currentPortStatus,
    serviceEnvRequired: {
      required: ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
      missing: providerPreflight.missingEnv,
      runtimeApiKeySource: 'service-env-required',
      note: 'Runtime Codex browser/release acceptance requires the Runtime API key in the service process environment; ignored config-file secret fallbacks are diagnostic-only.',
    },
    exactStartCommands: exactCommands.start,
    exactRetestCommands: exactCommands.retest,
    strictRetestCommand: exactCommands.strictRetest,
    configFallbackWarning: `Ignored config secret fallbacks (${providerPreflight.configSecretFallbackPaths.join(', ') || 'none detected'}) can help local proxy diagnostics but cannot satisfy Runtime Codex browser/release acceptance.`,
    releaseBlocking: true,
    releaseEligible: false,
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
  await writeManifest(manifest);
  assertBlockedOrFailedManifest(manifest);
  return manifest;
}

async function probeCurrentPortStatus(): Promise<Record<string, PortStatus>> {
  const host = '127.0.0.1';
  const statuses: Record<string, PortStatus> = {
    ui: await probeTcpPort(host, requestedRolePort),
    workspaceWriter: await probeTcpPort(host, requestedWorkspaceWriterPort),
    runtimeCodex: await probeTcpPort(host, requestedRuntimeCodexPort),
    providerProxy: await probeTcpPort(host, requestedProviderProxyPort),
    kvGround: await probeTcpPort(host, portFromEnv(process.env.SCIFORGE_VISION_KV_GROUND_PORT, undefined, 18081)),
  };
  statuses.kvGround.healthUrl = `http://${host}:${statuses.kvGround.port}/health`;
  statuses.kvGround.healthOk = await probeHttpHealth(statuses.kvGround.healthUrl);
  statuses.kvGround.note = statuses.kvGround.healthOk
    ? 'KV-Ground health is reachable; this proves the Grounder service is alive, not browser/release acceptance.'
    : 'KV-Ground health is not currently reachable from this process.';
  return statuses;
}

async function probeTcpPort(host: string, port: number): Promise<PortStatus> {
  const listening = await new Promise<boolean>((resolvePromise) => {
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolvePromise(false);
    }, 500);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolvePromise(true);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
  });
  return { host, port, listening };
}

async function probeHttpHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return false;
    const data = await response.json().catch(() => undefined) as { ok?: unknown } | undefined;
    return data?.ok === true;
  } catch {
    return false;
  }
}

function exactServiceEnvCommands(): {
  start: string[];
  retest: string[];
  strictRetest: string;
} {
  const proxyCommand = [
    'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}"',
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}"',
    'SCIFORGE_PROXY_HOST=127.0.0.1',
    `SCIFORGE_PROXY_PORT=${requestedProviderProxyPort}`,
    `npm run backend:codex-proxy -- --host 127.0.0.1 --port ${requestedProviderProxyPort} --upstream-base-url "$SCIFORGE_PROXY_UPSTREAM_BASE_URL" --api-key-env SCIFORGE_RUNTIME_API_KEY`,
  ].join(' ');
  const devCommand = [
    'SCIFORGE_AGENT_SERVER_AUTOSTART=0',
    'SCIFORGE_CONFIG_PATH=/tmp/sciforge-runtime-nosecret-config.local.json',
    'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}"',
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}"',
    `SCIFORGE_PROXY_PORT=${requestedProviderProxyPort}`,
    `SCIFORGE_INSTANCE_ID=${instanceProfile.id}`,
    `SCIFORGE_UI_PORT=${requestedRolePort}`,
    `SCIFORGE_WORKSPACE_PORT=${requestedWorkspaceWriterPort}`,
    `SCIFORGE_RUNTIME_CODEX_PORT=${requestedRuntimeCodexPort}`,
    `SCIFORGE_WORKSPACE_PATH=${workspacePath}`,
    `npm run dev -- --instance ${instanceProfile.id}`,
  ].join(' ');
  const strictRetest = 'npm run smoke:runtime-provider-preflight && SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance';
  return {
    start: [
      `npm run backend:codex-runtime:setup -- --overwrite --proxy-base-url http://127.0.0.1:${requestedProviderProxyPort}/v1`,
      proxyCommand,
      devCommand,
    ],
    retest: [
      'npm run smoke:runtime-provider-preflight',
      'npm run smoke:runtime-codex-browser-acceptance',
      strictRetest,
    ],
    strictRetest,
  };
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
  assert.equal(manifest.profile, runtimeCodexIdentity.profile, 'Runtime Codex profile must match the resolved local runtime config');
  assert.equal(manifest.provider, runtimeCodexIdentity.provider, 'Runtime Codex provider must match the resolved local runtime config');
  assert.equal(manifest.model, runtimeCodexIdentity.model, 'Runtime Codex model must match the resolved local runtime config');
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
    + readIfExists('src/ui/src/api/sciforgeToolsClient.ts')
    + readIfExists('src/ui/src/api/sciforgeToolsClient/client.ts')
    + readIfExists('src/ui/src/api/sciforgeToolsClient/codexRealtimeSession.ts');
  if (!/Runtime Codex|runtime codex|codex runtime/i.test(uiIntegration)) {
    return 'Runtime Codex UI streaming integration is not present.';
  }
  const serverText = readIfExists('src/runtime/codex/codex-runtime-server.ts');
  const workspaceServerText = readIfExists('src/runtime/workspace-server.ts');
  const uiPath = runtimeStreamPathFromText(uiIntegration);
  const runtimeServerPath = runtimeStreamPathFromText(serverText);
  const workspaceServerPath = runtimeStreamPathFromText(workspaceServerText);
  if (!uiPath || !runtimeServerPath || !workspaceServerPath || uiPath !== runtimeServerPath || uiPath !== workspaceServerPath) {
    return `Runtime Codex UI stream path is not aligned with the workspace server route: ui=${uiPath ?? 'missing'}, runtime=${runtimeServerPath ?? 'missing'}, workspace=${workspaceServerPath ?? 'missing'}`;
  }
  const localRuntimeReason = runtimeCodexLocalRuntimeBlockedReason();
  if (localRuntimeReason) return localRuntimeReason;
  const environmentReason = runtimeCodexEnvironmentBlockedReason();
  if (environmentReason) return environmentReason;
  return undefined;
}

function runtimeCodexEnvironmentBlockedReason(): string | undefined {
  const credentials = runtimeCredentialPresence();
  const blockers: string[] = [];
  if (!credentials.runtimeApiKey) blockers.push('SCIFORGE_RUNTIME_API_KEY');
  if (!credentials.proxyUpstreamBaseUrl) {
    blockers.push('provider proxy upstream base URL');
  }
  if (!credentials.runtimeApiKey && credentials.configSecretPaths.length > 0) {
    blockers.push('Runtime Codex secret must be supplied by service environment, not config file debug fallback');
  }
  if (blockers.length === 0) return undefined;
  const missing = blockers.join(' and ');
  const checked = credentials.checkedConfigPaths.length > 0
    ? ` Checked config paths: ${credentials.checkedConfigPaths.join(', ')}.`
    : '';
  const configSecretNote = credentials.configSecretPaths.length > 0
    ? ` Runtime secret-like keys were found in ignored config files (${credentials.configSecretPaths.join(', ')}); they are accepted only as local proxy debug fallback and cannot satisfy browser/release acceptance.`
    : '';
  return `Runtime Codex environment is not fully configured; missing ${missing}. Set SCIFORGE_RUNTIME_API_KEY in the service environment, and set SCIFORGE_PROXY_UPSTREAM_BASE_URL or config.local.json/.sciforge instance config codexProxy.upstreamBaseUrl/llm.baseUrl before live browser E2E can pass.${checked}${configSecretNote}`;
}

function runtimeCredentialPresence(): {
  runtimeApiKey: boolean;
  proxyUpstreamBaseUrl: boolean;
  checkedConfigPaths: string[];
  configSecretPaths: string[];
} {
  const checkedConfigPaths = runtimeConfigCandidatePaths().filter((path) => existsSync(resolve(root, path)));
  const runtimeApiKey = Boolean(process.env.SCIFORGE_RUNTIME_API_KEY);
  const configSecretPaths = checkedConfigPaths.filter((path) => runtimeApiKeyPresentInConfig(path));
  const proxyUpstreamBaseUrl = checkedConfigPaths.some((path) => {
    const options = resolveProxyCliOptions([], { ...process.env, SCIFORGE_CONFIG_PATH: path });
    return Boolean(options.upstreamBaseUrl);
  }) || Boolean(resolveProxyCliOptions([], process.env).upstreamBaseUrl);
  return { runtimeApiKey, proxyUpstreamBaseUrl, checkedConfigPaths, configSecretPaths };
}

function runtimeConfigCandidatePaths(): string[] {
  return uniqueStrings([
    process.env.SCIFORGE_CONFIG_PATH,
    instanceProfile.configPath,
    'config.local.json',
  ].flatMap((path) => typeof path === 'string' && path.trim() ? [path.trim()] : []));
}

function readRuntimeCodexIdentity(): { profile?: string; provider?: string; model?: string; wireApi?: string } {
  const configText = readIfExists('packages/backend/.codex-runtime/codex-home/config.toml');
  return {
    profile: stringValue(process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE) || extractTomlString(configText, 'profile'),
    provider: stringValue(process.env.SCIFORGE_RUNTIME_MODEL_PROVIDER) || extractTomlString(configText, 'model_provider'),
    model: stringValue(process.env.SCIFORGE_RUNTIME_MODEL) || extractTomlString(configText, 'model'),
    wireApi: extractTomlString(configText, 'wire_api'),
  };
}

function extractTomlString(text: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, 'm').exec(text);
  return match?.[1];
}

function runtimeApiKeyPresentInConfig(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as unknown;
    if (!isRecord(parsed)) return false;
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const codexProxy = isRecord(parsed.codexProxy) ? parsed.codexProxy : {};
    return Boolean(
      stringValue(parsed.apiKey)
      || stringValue(llm.apiKey)
      || stringValue(llm.upstreamApiKey)
      || stringValue(codexProxy.apiKey),
    );
  } catch {
    return false;
  }
}

function runtimeCodexLocalRuntimeBlockedReason(): string | undefined {
  const configPath = 'packages/backend/.codex-runtime/codex-home/config.toml';
  const configText = readIfExists(configPath);
  if (!configText) return `Runtime Codex home config is missing at ${configPath}.`;
  const requiredConfig: Array<[string, RegExp]> = [
    ['active Runtime Codex profile', /\bprofile\s*=\s*"[^"]+"/],
    ['Runtime Codex model', /\bmodel\s*=\s*"[^"]+"/],
    ['active profile model_provider', /\bmodel_provider\s*=\s*"[^"]+"/],
    ['env_key SCIFORGE_RUNTIME_API_KEY', /\benv_key\s*=\s*"SCIFORGE_RUNTIME_API_KEY"/],
    ['responses wire_api', /\bwire_api\s*=\s*"responses"/],
  ];
  const missingConfig = requiredConfig
    .filter(([, pattern]) => !pattern.test(configText))
    .map(([label]) => label);
  if (missingConfig.length > 0) {
    return `Runtime Codex config drift in ${configPath}: missing ${missingConfig.join(', ')}.`;
  }
  if (!existsSync(workspacePath)) {
    return `Runtime Codex workspace path is missing: ${workspacePath}.`;
  }
  return undefined;
}

function assertPassedManifest(manifest: BrowserAcceptanceManifest): void {
  assert.equal(manifest.status, 'passed', 'release acceptance requires status=passed');
  assertPassedManifestFreshness(manifest);
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, true, 'passed requires a real in-app browser conclusion');
  assert.equal(manifest.releaseEligible, true, 'passed manifest must be explicitly releaseEligible');
  assert.equal(manifest.releaseBlocking, false, 'passed manifest must not remain releaseBlocking');
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
  assertLiveRuntimeCodexRenderedEvidence(manifest.evidence, 'manifest evidence');
  assert.match(manifestEvidenceText, /user intent|用户意图|Actual task result|实际结果|acceptance rubric|验收/i, 'manifest evidence must include user intent and actual result rubric');
  assertDoesNotUseSeedDemoOrRawEvidence(manifestEvidenceText, 'manifest evidence');
  assertScenarioPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioPassed(manifest.artifactFollowUp, 'artifactFollowUp');
  assertScenarioPassed(manifest.multiTurn, 'multiTurn');
  assert.equal(manifest.multiTurn?.secondTurnVisibleAnswerConfirmed, true, 'passed requires visible second-turn answer in Codex in-app browser');
  assert.equal(manifest.multiTurn?.expectedPassphrase, expectedMultiTurnPassphrase, 'multi-turn expected passphrase must be recorded');
}

function assertPassedManifestFreshness(manifest: BrowserAcceptanceManifest): void {
  const observedAt = manifest.observedAt;
  if (typeof observedAt !== 'string') {
    assert.fail('passed manifest must record observedAt from the live browser run');
  }
  assert.ok(observedAt.trim(), 'passed manifest observedAt must be non-empty');
  const observedAtMs = Date.parse(observedAt);
  assert.ok(Number.isFinite(observedAtMs), 'passed manifest observedAt must be parseable');
  assert.ok(
    observedAtMs <= Date.now() + 5 * 60 * 1000,
    'passed manifest observedAt must not be in the future',
  );
  assert.ok(
    observedAtMs >= Date.now() - passedManifestMaxAgeMs,
    `passed manifest observedAt must be fresh within ${Math.round(passedManifestMaxAgeMs / 60_000)} minute(s)`,
  );
  assertEvidenceFreshEnough(manifest.evidence, observedAtMs, 'manifest evidence');
  assertEvidenceFreshEnough(manifest.singleTurn?.evidence, observedAtMs, 'singleTurn evidence');
  assertEvidenceFreshEnough(manifest.artifactFollowUp?.evidence, observedAtMs, 'artifactFollowUp evidence');
  assertEvidenceFreshEnough(manifest.multiTurn?.evidence, observedAtMs, 'multiTurn evidence');
}

function assertBlockedOrFailedManifest(manifest: BrowserAcceptanceManifest): void {
  assert.ok(['blocked', 'failed', 'partial'].includes(manifest.status), `unexpected non-passed status: ${manifest.status}`);
  assert.match(manifest.reason ?? manifest.blocker ?? '', /blocked|failed|limitation|missing|unsupported|Phase 1|Codex|Runtime|API key|profile|browser|implementation/i);
  assertAcceptanceRubric(manifest.acceptanceRubric, 'manifest acceptanceRubric');
  assertNegativeChecks(manifest.negativeChecks, 'manifest negativeChecks');
  assert.equal(manifest.releaseBlocking, true, 'blocked/failed/partial manifest must remain releaseBlocking');
  assert.equal(manifest.releaseEligible, false, 'blocked/failed/partial manifest must explicitly reject release eligibility');
  assert.ok(manifest.failureClass, 'blocked/failed/partial manifest must classify failureClass');
  assert.ok(manifest.owner, 'blocked/failed/partial manifest must classify owner');
  assert.ok((manifest.nextActions ?? []).length > 0, 'blocked/failed/partial manifest must record nextActions');
  assert.ok(manifest.expectedRetestCommand?.trim(), 'blocked/failed/partial manifest must record expectedRetestCommand');
  const providerPreflightRef = stringValue(manifest.providerPreflightRef);
  assert.ok(providerPreflightRef, 'blocked/failed/partial manifest must record providerPreflightRef');
  assertEvidenceRefsExist([providerPreflightRef], 'manifest providerPreflightRef');
  assert.ok(manifest.providerPreflightCategory?.trim(), 'blocked/failed/partial manifest must record providerPreflightCategory');
  assert.ok(manifest.providerPreflightCheckedAt?.trim(), 'blocked/failed/partial manifest must record providerPreflightCheckedAt');
  assert.equal(manifest.providerPreflightReleaseAcceptance, 'not-evaluated', 'provider preflight must remain diagnostic-only');
  assert.equal(manifest.providerPreflightEvidenceMode, 'current-env-diagnostic-only', 'provider preflight evidence mode must be current-env diagnostic only');
  assertBlockedRuntimeConfigArtifactFields(manifest);
  assert.ok((manifest.exactRetestCommands ?? []).some((command) => /SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1/.test(command)), 'blocked/failed/partial manifest must record strict retest command');
  assert.ok(
    manifest.currentRunEvidenceScope === 'preflight-only' || manifest.currentRunEvidenceScope === 'live-browser-current-run',
    'blocked/failed/partial manifest must declare currentRunEvidenceScope',
  );
  if (manifest.currentRunEvidenceScope === 'preflight-only') {
    assert.equal(manifest.submittedThroughRuntimeCodex, false, 'preflight-only blocked manifest cannot claim current Runtime Codex submission');
    assert.equal(manifest.commandIdVisible, false, 'preflight-only blocked manifest cannot claim current command id visibility');
    assert.equal(manifest.providerModelProfileVisible, false, 'preflight-only blocked manifest cannot claim current provider/model/profile visibility');
    assert.equal(manifest.workspaceVisible, false, 'preflight-only blocked manifest cannot claim current workspace visibility');
    assert.equal(manifest.commandId, undefined, 'preflight-only blocked manifest cannot reuse a stale command id');
    assert.equal(manifest.evidence?.screenshotPath, undefined, 'preflight-only blocked manifest cannot reuse stale screenshot evidence as current evidence');
    assert.equal(manifest.evidence?.domSnapshotPath, undefined, 'preflight-only blocked manifest cannot reuse stale DOM evidence as current evidence');
    assert.ok(manifest.evidence?.notesPath, 'preflight-only blocked manifest must point at current notes');
  } else {
    assert.equal(manifest.submittedThroughRuntimeCodex, true, 'live-browser-current-run blocked/failed manifest must record current Runtime Codex submission');
    assert.equal(manifest.commandIdVisible, true, 'live-browser-current-run blocked/failed manifest must record visible command id status');
    assert.match(manifest.commandId ?? '', /^codex-command-[a-z0-9-]+$/i, 'live-browser-current-run blocked/failed manifest must record the current command id');
    assertEvidenceExists(manifest.evidence, 'live-browser-current-run manifest evidence', { requireScreenshotAndDom: true });
  }
  if (manifest.submittedThroughRuntimeCodex || manifest.commandIdVisible) {
    assert.match(manifest.commandId ?? '', /^codex-command-[a-z0-9-]+$/i, 'submitted blocked/failed manifests must record the observed Runtime Codex command id');
  }
  assertScenarioNotPassedUnlessManifestPassed(manifest.singleTurn, 'singleTurn');
  assertScenarioNotPassedUnlessManifestPassed(manifest.artifactFollowUp, 'artifactFollowUp');
  assertScenarioNotPassedUnlessManifestPassed(manifest.multiTurn, 'multiTurn');
  assertEvidenceExists(manifest.evidence, 'manifest evidence');
}

function assertBlockedRuntimeConfigArtifactFields(manifest: BrowserAcceptanceManifest): void {
  const currentPortStatus = manifest.currentPortStatus ?? {};
  for (const [label, expectedPort] of [
    ['ui', manifest.actualPort],
    ['workspaceWriter', manifest.actualWorkspaceWriterPort],
    ['runtimeCodex', manifest.actualRuntimeCodexPort],
    ['providerProxy', requestedProviderProxyPort],
    ['kvGround', portFromEnv(process.env.SCIFORGE_VISION_KV_GROUND_PORT, undefined, 18081)],
  ] as const) {
    const status = currentPortStatus[label];
    assert.ok(status, `blocked/failed/partial manifest must record currentPortStatus.${label}`);
    assert.equal(status.host, '127.0.0.1', `currentPortStatus.${label}.host must be loopback`);
    assert.equal(status.port, expectedPort, `currentPortStatus.${label}.port must match configured port`);
    assert.equal(typeof status.listening, 'boolean', `currentPortStatus.${label}.listening must be boolean`);
  }
  assert.match(currentPortStatus.kvGround?.healthUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/health$/, 'currentPortStatus.kvGround must record healthUrl');
  assert.equal(typeof currentPortStatus.kvGround?.healthOk, 'boolean', 'currentPortStatus.kvGround must record healthOk');
  assert.match(currentPortStatus.kvGround?.note ?? '', /not browser\/release acceptance/i, 'currentPortStatus.kvGround note must stay diagnostic-only');

  const serviceEnv = manifest.serviceEnvRequired;
  assert.ok(serviceEnv, 'blocked/failed/partial manifest must record serviceEnvRequired');
  assert.ok(serviceEnv.required.includes('SCIFORGE_RUNTIME_API_KEY'), 'serviceEnvRequired must require SCIFORGE_RUNTIME_API_KEY');
  assert.ok(serviceEnv.required.includes('SCIFORGE_PROXY_UPSTREAM_BASE_URL'), 'serviceEnvRequired must require SCIFORGE_PROXY_UPSTREAM_BASE_URL');
  assert.equal(serviceEnv.runtimeApiKeySource, 'service-env-required', 'Runtime API key must be sourced from service env for release acceptance');
  assert.match(serviceEnv.note, /service process environment/i, 'serviceEnvRequired note must name the service environment requirement');
  assert.match(serviceEnv.note, /diagnostic-only/i, 'serviceEnvRequired note must keep config fallbacks diagnostic-only');

  const exactStartCommands = manifest.exactStartCommands ?? [];
  assert.ok(exactStartCommands.length >= 3, 'blocked/failed/partial manifest must record exact no-secret setup/proxy/dev start commands');
  assert.ok(exactStartCommands.some((command) => /backend:codex-runtime:setup/.test(command)), 'exactStartCommands must include Runtime Codex setup');
  assert.ok(exactStartCommands.some((command) => /backend:codex-proxy/.test(command)), 'exactStartCommands must include provider proxy start');
  assert.ok(exactStartCommands.some((command) => /npm run dev/.test(command)), 'exactStartCommands must include dev server start');
  assert.ok(exactStartCommands.every((command) => !/sk-[A-Za-z0-9_-]+/.test(command)), 'exactStartCommands must not contain literal secrets');
  assert.ok(exactStartCommands.every((command) => !/api[_-]?key=(?!env\b)[^ "$']+/i.test(command)), 'exactStartCommands must pass API keys by env name, not literal value');
  assert.match(manifest.configFallbackWarning ?? '', /diagnostic-only|cannot satisfy/i, 'blocked/failed/partial manifest must warn config fallback is diagnostic-only');
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
  assertIncludes(evidenceText, runtimeCodexIdentity.profile, `${label} evidence must include the Runtime Codex profile`);
  assertIncludes(evidenceText, runtimeCodexIdentity.model, `${label} evidence must include the Runtime Codex model`);
  assertLiveRuntimeCodexRenderedEvidence(scenario.evidence, `${label} evidence`);
  assertEvidenceExists(scenario.evidence, `${label} evidence`, { requireScreenshotAndDom: true });
}

function assertScenarioNotPassedUnlessManifestPassed(scenario: BrowserAcceptanceScenario | undefined, label: string): void {
  assert.ok(scenario, `${label} scenario must be present`);
  assert.notEqual(scenario.status, 'passed', `${label} cannot be passed while manifest is blocked/failed/partial`);
  assert.equal(scenario.visibleAnswerConfirmed, false, `${label} cannot claim visible answer while manifest is blocked/failed/partial`);
  assert.notEqual(scenario.actualTaskResult?.status, 'passed', `${label} cannot contain a passed actualTaskResult while manifest is blocked/failed/partial`);
  assert.notEqual(scenario.liveRuntimeCodexProof?.messageProvenance, 'live-runtime-codex', `${label} cannot contain live Runtime Codex proof while manifest is blocked/failed/partial`);
  assert.ok(scenario.reason, `${label} blocked/failed scenario must record a reason`);
  assertEvidenceExists(scenario.evidence, `${label} evidence`);
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
  priorEvidenceRefs: string[];
  staleEvidenceRefs: string[];
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
  const priorEvidenceRefs = evidenceRefsFromObservations([defaultObservation, singleTurn, artifactFollowUp, multiTurn]);
  return {
    defaultChatEntryObserved: domText.includes('Ask SciForge') && domText.includes('聊天工作台'),
    singleTurnSubmitted: /SCIFORGE-CODEX-BROWSER-SINGLE-[A-Z0-9-]+|SCIFORGE-W5-SINGLE-TURN/i.test(singleTurn.domText),
    artifactFollowUpSubmitted: /selected artifact|selected ref|用户引用的上下文|research-report|artifact:/i.test(artifactFollowUp.domText),
    multiTurnSecondAnswerVisible: multiTurn.domText.includes(expectedMultiTurnPassphrase)
      || /SCIFORGE-CODEX-BROWSER-MT-[A-Z0-9-]+/i.test(multiTurn.domText),
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
    priorEvidenceRefs,
    staleEvidenceRefs: priorEvidenceRefs,
  };
}

function stalePreflightOnlyManifest(manifest: BrowserAcceptanceManifest): boolean {
  const reason = manifest.reason ?? manifest.blocker ?? '';
  return manifest.currentRunEvidenceScope === 'preflight-only'
    || manifest.providerPreflightCategory !== 'ready'
    || manifest.runtimeApiKeyPresentInServiceEnv !== true
    || manifest.upstreamBaseUrlPresent !== true
    || /environment is not fully configured|SCIFORGE_RUNTIME_API_KEY|config file debug fallback|provider proxy upstream base URL/i.test(reason);
}

function currentBlockedManifestNeedsRefresh(manifest: BrowserAcceptanceManifest, currentReason: string): boolean {
  const evidence = existingBrowserEvidence();
  const nextActionLabels = (manifest.nextActions ?? []).map((action) => action.label).join('\n');
  const blockedOn = (manifest.blockedOn ?? []).join('\n');
  return manifest.reason !== currentReason
    || (Boolean(evidence.commandId) && manifest.commandId !== evidence.commandId)
    || /selected[- ]artifact|selected ref|artifact follow-up/i.test(currentReason)
      && !/selected[- ]artifact|selected ref|artifact follow-up/i.test(`${nextActionLabels}\n${blockedOn}`);
}

function currentBrowserEvidenceBlockedReason(): string {
  const evidence = existingBrowserEvidence();
  const missing = [
    ...(evidence.singleTurnSubmitted ? [] : ['single-turn visible Runtime Codex answer']),
    ...(evidence.artifactFollowUpSubmitted ? [] : ['selected-artifact follow-up with selected refs']),
    ...(evidence.multiTurnSecondAnswerVisible ? [] : ['multi-turn visible second-turn passphrase answer']),
  ];
  const missingText = missing.length > 0 ? missing.join(', ') : 'passed release manifest';
  return `Current Runtime Codex provider preflight is ready, but Codex in-app browser acceptance is incomplete: missing ${missingText}.`;
}

function hasCurrentLiveBrowserEvidence(evidence: ReturnType<typeof existingBrowserEvidence>): boolean {
  return Boolean(
    evidence.commandId
    || evidence.singleTurnSubmitted
    || evidence.artifactFollowUpSubmitted
    || evidence.multiTurnSecondAnswerVisible,
  );
}

function preflightOnlyBrowserEvidence(prior: ReturnType<typeof existingBrowserEvidence>): ReturnType<typeof existingBrowserEvidence> {
  const notesEvidence = { notesPath: relativeFromRoot(blockedNotesPath) };
  const observed: ScenarioObservation = {
    domText: '',
    providerModelProfileVisible: false,
    workspaceCommandIdVisible: false,
    rawAuditFoldedByDefault: true,
    evidence: notesEvidence,
  };
  return {
    defaultChatEntryObserved: false,
    singleTurnSubmitted: false,
    artifactFollowUpSubmitted: false,
    multiTurnSecondAnswerVisible: false,
    singleTurn: observed,
    artifactFollowUp: observed,
    multiTurn: observed,
    workspaceVisible: false,
    providerModelProfileVisible: false,
    workspaceCommandIdVisible: false,
    rawAuditFoldedByDefault: true,
    evidence: notesEvidence,
    priorEvidenceRefs: prior.priorEvidenceRefs,
    staleEvidenceRefs: prior.staleEvidenceRefs,
  };
}

function evidenceRefsFromObservations(observations: ScenarioObservation[]): string[] {
  return uniqueStrings(observations.flatMap((observation) => evidenceRefs(observation.evidence)));
}

function evidenceRefs(evidence: BrowserAcceptanceEvidence | undefined): string[] {
  if (!evidence) return [];
  return [
    evidence.screenshotPath,
    evidence.domSnapshotPath,
    evidence.runtimeAuditPath,
  ].filter((path): path is string => Boolean(path));
}

function scenarioObservation(input: { domCandidates: string[]; screenshotCandidates: string[] }): ScenarioObservation {
  const domPath = firstExisting(input.domCandidates.map((file) => join(outputDir, file)));
  const screenshotPath = firstExisting(input.screenshotCandidates.map((file) => join(outputDir, file)));
  const domText = domPath ? readIfExists(domPath) : '';
  return {
    domText,
    providerModelProfileVisible: runtimeIdentityVisibleInText(domText),
    workspaceCommandIdVisible: /codex-command|command id|commandId|command\s+codex-command/i.test(domText),
    rawAuditFoldedByDefault: !/RAW_JSONL|RAW_STDERR|RAW_STDOUT|raw provider sse|plugin warning|stderr[^折]|stdout[^折]|jsonl[^折]/i.test(domText),
    commandId: /codex-command-[a-z0-9-]+/i.exec(domText)?.[0],
    evidence: {
      ...(screenshotPath ? { screenshotPath: relativeFromRoot(screenshotPath) } : {}),
      ...(domPath ? { domSnapshotPath: relativeFromRoot(domPath) } : {}),
      notesPath: relativeFromRoot(blockedNotesPath),
    },
  };
}

function runtimeIdentityVisibleInText(text: string): boolean {
  const required = [
    runtimeCodexIdentity.profile,
    runtimeCodexIdentity.model,
  ].filter((value): value is string => Boolean(value));
  return required.every((value) => text.includes(value))
    && (!runtimeCodexIdentity.provider || text.includes(runtimeCodexIdentity.provider) || /provider/i.test(text));
}

function blockedNotes(reason: string, providerPreflight: CurrentEnvProviderPreflightManifest): string {
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
    `Profile: ${runtimeCodexIdentity.profile ?? 'unresolved'}`,
    `Provider: ${runtimeCodexIdentity.provider ?? 'unresolved'}`,
    `Model: ${runtimeCodexIdentity.model ?? 'unresolved'}`,
    `Reason: ${reason}`,
    `Provider preflight artifact: ${relativeFromRoot(providerPreflightManifestPath)}`,
    `Provider preflight category: ${providerPreflight.category}`,
    `Provider preflight checked at: ${providerPreflight.checkedAt}`,
    `Provider preflight release acceptance: ${providerPreflight.releaseAcceptance}`,
    `Runtime key in service env: ${providerPreflight.runtimeApiKeyPresentInServiceEnv ? 'present' : 'missing'}`,
    `Provider upstream base URL: ${providerPreflight.upstreamBaseUrlPresent ? 'present' : 'missing'}`,
    `Runtime key source: ${providerPreflight.upstreamKeySourceKind}`,
    `Upstream URL source: ${providerPreflight.upstreamBaseUrlSourceKind}`,
    'Acceptance scope: non-seed Runtime Codex messages only; seed/demo/fixture messages are excluded from success criteria.',
    '',
    'Acceptance rubric:',
    '- User intent: prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.',
    '- Expected observable result: gui.present projection or native Runtime Codex assistant answer rendered in default chat with provider/model/profile/workspace/command id and folded audit logs.',
    `- Actual result: blocked before release acceptance because ${reason}`,
    '- Current evidence refs: manifest.json plus blocked notes. Prior or stale browser screenshots/DOM refs are diagnostic only and cannot count as current release evidence.',
    '- Negative checks: fake passed status, missing DOM/screenshot, missing command id, missing task result, seed/demo evidence, and partial/blocked/failed status remain release-blocking.',
    '- Required key: set SCIFORGE_RUNTIME_API_KEY in the service environment; do not store it in repository files.',
    '- Config-file apiKey fallback: accepted only for local provider proxy debugging, and rejected as browser/release acceptance evidence.',
    '- Required provider proxy upstream: set SCIFORGE_PROXY_UPSTREAM_BASE_URL or config.local.json codexProxy.upstreamBaseUrl/llm.baseUrl so the local proxy has an upstream OpenAI-compatible endpoint.',
    '- Provider preflight artifact: docs/test-artifacts/runtime-provider-preflight/manifest.json records the current non-secret service-env/upstream diagnostic and remains diagnostic-only, not browser/release acceptance.',
    '- Required Runtime Codex config: active profile, provider, model, env_key SCIFORGE_RUNTIME_API_KEY, and responses wire_api must be resolved from the local runtime config.',
    '- Re-run strict release acceptance with SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance after the key/upstream are present and the browser shows the second-turn answer.',
    '- Remaining risk: live browser acceptance still requires configured Runtime Codex credentials/upstream and visible second-turn answer.',
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
  assertEvidenceRefsExist(rubric.evidenceRefs, `${label}.evidenceRefs`);
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
  assertEvidenceRefsExist(result.evidenceRefs, `${label}.evidenceRefs`);
}

function assertLiveRuntimeCodexProof(proof: LiveRuntimeCodexProof | undefined, expectedCommandId: string | undefined, label: string): void {
  assert.ok(proof, `${label} is required`);
  assert.equal(proof.messageProvenance, 'live-runtime-codex', `${label}.messageProvenance must be live-runtime-codex`);
  assert.ok(
    proof.guiPresentObserved === true || proof.nativeDefaultChatAssistantAnswerRendered === true,
    `${label} must observe gui.present or a native Runtime Codex assistant answer rendered in default chat`,
  );
  assert.equal(proof.runtimeOutputObserved, true, `${label}.runtimeOutputObserved must be true`);
  assert.equal(proof.seedOrDemoExcluded, true, `${label}.seedOrDemoExcluded must be true`);
  assert.ok((proof.eventEvidenceRefs ?? []).length > 0, `${label}.eventEvidenceRefs are required`);
  assertEvidenceRefsExist(proof.eventEvidenceRefs, `${label}.eventEvidenceRefs`);
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
  assert.equal(checks.nativeAnswerOutsideDefaultChatRejected, true, `${label}.nativeAnswerOutsideDefaultChatRejected must be true`);
}

function assertDoesNotUseSeedDemoOrRawEvidence(text: string, label: string): void {
  assert.doesNotMatch(text, /\b(?:seed-|seed demo|seed-demo|demo message|fixture success|scriptable-mock|KRAS G12C)\b/i, `${label} must not count seed/demo/fixture text as acceptance`);
  assert.doesNotMatch(text, /\b(?:RAW_JSONL|RAW_STDERR|RAW_STDOUT|raw provider sse|plugin warning|stdout|stderr|jsonl)\b/i, `${label} must not use raw stdout/jsonl/stderr/provider logs as main-answer proof`);
}

function assertLiveRuntimeCodexRenderedEvidence(evidence: BrowserAcceptanceEvidence | undefined, label: string): void {
  const domText = evidence?.domSnapshotPath ? readIfExists(evidence.domSnapshotPath) : '';
  assert.ok(domText.trim(), `${label} DOM evidence is required for live Runtime Codex output proof`);
  const hasGuiPresent = /gui\.present|GUI intent/i.test(domText);
  const hasDefaultChat = /Ask SciForge|聊天工作台|SciForge 工作台|default chat/i.test(domText);
  const hasRuntimeMetadata = /Runtime Codex/i.test(domText)
    && runtimeIdentityVisibleInText(domText);
  const hasRenderedAssistantAnswer = /回答已显示|assistant (?:answer|message)|rendered (?:answer|assistant)|Runtime Codex answer rendered/i.test(domText);
  assert.ok(
    hasGuiPresent || (hasDefaultChat && hasRuntimeMetadata && hasRenderedAssistantAnswer),
    `${label} must prove gui.present or a native Runtime Codex assistant answer rendered in default chat from DOM evidence`,
  );
}

function assertIncludes(text: string, value: string | undefined, message: string): void {
  assert.ok(value?.trim(), `${message}: missing expected value`);
  assert.ok(text.includes(value ?? ''), message);
}

function assertEvidenceRefsExist(refs: string[] | undefined, label: string): void {
  for (const ref of refs ?? []) {
    if (!looksLikeFileEvidenceRef(ref)) continue;
    const resolved = resolve(root, ref);
    assert.ok(existsSync(resolved), `${label} path does not exist: ${ref}`);
    assert.ok(statSync(resolved).isFile(), `${label} path is not a file: ${ref}`);
    assert.ok(statSync(resolved).size > 0, `${label} path is empty: ${ref}`);
  }
}

function looksLikeFileEvidenceRef(ref: string): boolean {
  if (!ref.trim()) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('file:')) return false;
  return ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../') || ref.includes('/');
}

function assertUrlPortMatches(url: string | undefined, port: number | undefined, label: string): void {
  assert.ok(url, `${label} is required`);
  assert.equal(new URL(url).port, String(port), `${label} port must match recorded actual port`);
}

function assertEvidenceFreshEnough(evidence: BrowserAcceptanceEvidence | undefined, observedAtMs: number, label: string): void {
  if (!evidence) return;
  const paths = [
    evidence.screenshotPath,
    evidence.domSnapshotPath,
    evidence.notesPath,
    evidence.runtimeAuditPath,
  ].filter((path): path is string => Boolean(path));
  for (const evidencePath of paths) {
    const resolved = resolve(root, evidencePath);
    if (!existsSync(resolved)) continue;
    const mtimeMs = statSync(resolved).mtimeMs;
    assert.ok(
      mtimeMs >= observedAtMs - evidenceMtimeToleranceMs,
      `${label} path is stale relative to observedAt: ${evidencePath}`,
    );
  }
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
    nativeAnswerOutsideDefaultChatRejected: true,
  };
}

function blockedAcceptanceRubric(reason: string): AcceptanceRubric {
  return {
    userIntent: 'Prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.',
    expectedObservableResult: 'Gui.present projection or native Runtime Codex assistant answer rendered in default chat with provider/model/profile/workspace/command id and folded audit logs.',
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
    remainingRisks: 'Live browser acceptance still requires SCIFORGE_RUNTIME_API_KEY, provider proxy upstream base URL, the Runtime Codex profile/config below, and a visible second-turn answer.',
  };
}

function readOrWriteCurrentProviderPreflightManifest(): CurrentEnvProviderPreflightManifest {
  const existing = readCurrentProviderPreflightManifest();
  if (existing) return existing;
  const credentials = runtimeCredentialPresence();
  const runtimeApiKeyPresentInServiceEnv = Boolean(process.env.SCIFORGE_RUNTIME_API_KEY?.trim());
  const upstreamBaseUrlPresent = credentials.proxyUpstreamBaseUrl;
  const upstreamKeySourceKind: CurrentEnvProviderPreflightManifest['upstreamKeySourceKind'] = runtimeApiKeyPresentInServiceEnv
    ? 'env'
    : credentials.configSecretPaths.length > 0
      ? 'config-debug-fallback'
      : 'missing';
  const upstreamBaseUrlSourceKind: CurrentEnvProviderPreflightManifest['upstreamBaseUrlSourceKind'] = process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL?.trim()
    ? 'env'
    : upstreamBaseUrlPresent
      ? 'config'
      : 'missing';
  const category = !runtimeApiKeyPresentInServiceEnv && credentials.configSecretPaths.length > 0
    ? 'config-secret-source'
    : !runtimeApiKeyPresentInServiceEnv
      ? 'missing-runtime-env'
      : !upstreamBaseUrlPresent
        ? 'missing-upstream'
        : 'unknown';
  const manifest: CurrentEnvProviderPreflightManifest = {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamKeySourceKind,
    upstreamBaseUrlSourceKind,
    configPathsChecked: credentials.checkedConfigPaths,
    configSecretFallbackPaths: credentials.configSecretPaths,
    category,
    owner: category === 'unknown' ? 'repo' : 'environment',
    policyViolations: !runtimeApiKeyPresentInServiceEnv && credentials.configSecretPaths.length > 0
      ? ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance']
      : [],
    missingEnv: [
      ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
      ...(upstreamBaseUrlPresent ? [] : ['SCIFORGE_PROXY_UPSTREAM_BASE_URL']),
    ],
    evidenceMode: 'current-env-diagnostic-only',
  };
  mkdirSync(join(root, 'docs', 'test-artifacts', 'runtime-provider-preflight'), { recursive: true });
  writeFileSync(providerPreflightManifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function readCurrentProviderPreflightManifest(): CurrentEnvProviderPreflightManifest | undefined {
  if (!existsSync(providerPreflightManifestPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(providerPreflightManifestPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (parsed.schemaVersion !== 'sciforge.runtime-provider-preflight.current-env.v1') return undefined;
    if (parsed.releaseAcceptance !== 'not-evaluated') return undefined;
    if (parsed.evidenceMode !== 'current-env-diagnostic-only') return undefined;
    return parsed as CurrentEnvProviderPreflightManifest;
  } catch {
    return undefined;
  }
}

function isPreflightOnlyBlockedReason(reason: string): boolean {
  return /environment is not fully configured|SCIFORGE_RUNTIME_API_KEY|config file debug fallback|provider proxy upstream base URL|Runtime Codex home config|env_key|wire_api|profile|browser acceptance evidence is missing|browser acceptance evidence is incomplete or stale/i.test(reason);
}

function blockedDiagnosticsForReason(reason: string): Pick<
  BrowserAcceptanceManifest,
  'failureClass' | 'owner' | 'policyViolations' | 'missingEnv' | 'nextActions' | 'expectedRetestCommand'
> {
  const missingEnv: string[] = [];
  const policyViolations: string[] = [];
  const nextActions: BlockedNextAction[] = [];
  const missingClause = /missing ([^.]+)\./i.exec(reason)?.[1] ?? '';
  const hasRuntimeKeyIssue = /SCIFORGE_RUNTIME_API_KEY|API key/i.test(missingClause);
  const hasConfigSecretFallback = /config file debug fallback|secret-like keys were found|not config file/i.test(reason);
  const hasUpstreamIssue = /provider proxy upstream base URL|SCIFORGE_PROXY_UPSTREAM_BASE_URL/i.test(missingClause);
  const hasProviderOutage = /502|Bad Gateway|429|timeout|DNS|provider outage|upstream returned|upstream availability/i.test(reason);
  const hasSelectedArtifactGap = /selected[- ]artifact|selected ref|artifact follow-up/i.test(reason);

  if (hasRuntimeKeyIssue) {
    missingEnv.push('SCIFORGE_RUNTIME_API_KEY');
    nextActions.push({
      label: 'Set Runtime Codex provider key in the service environment that launches Runtime Codex/provider proxy.',
      expected: 'Runtime preflight no longer reports missing SCIFORGE_RUNTIME_API_KEY.',
      writesRepo: false,
    });
  }
  if (hasConfigSecretFallback) {
    policyViolations.push('config-file-secret-fallback-cannot-satisfy-browser-release-acceptance');
    nextActions.push({
      label: 'Keep config-file apiKey fields as local proxy debug fallback only, and do not count them as browser/release acceptance credentials.',
      expected: 'Acceptance manifest reports service environment secret presence instead of config-file secret fallback.',
      writesRepo: false,
    });
  }
  if (hasUpstreamIssue) {
    missingEnv.push('SCIFORGE_PROXY_UPSTREAM_BASE_URL');
    nextActions.push({
      label: 'Set provider proxy upstream URL in service env or ignored non-secret config.',
      expected: 'Runtime preflight can resolve an upstream OpenAI-compatible endpoint.',
      writesRepo: false,
    });
  }
  if (hasSelectedArtifactGap) {
    nextActions.push({
      label: 'Run a real default-chat selected-artifact follow-up from a selected report/artifact ref.',
      expected: 'The browser acceptance manifest records selectedRefs and visible live Runtime Codex output for artifactFollowUp.',
      writesRepo: true,
    });
  }
  nextActions.push({
    label: 'Rerun default browser acceptance, then strict release acceptance only after a visible second-turn answer appears.',
    command: 'npm run smoke:runtime-codex-browser-acceptance && SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance',
    expected: 'Default smoke writes current evidence; strict gate passes only when manifest.status is passed.',
    writesRepo: true,
  });

  const failureClass = hasConfigSecretFallback
    ? 'config-secret-source'
    : hasRuntimeKeyIssue
      ? 'missing-runtime-env'
      : hasUpstreamIssue
        ? 'missing-upstream'
        : hasProviderOutage
          ? 'provider-unavailable'
          : /Runtime Codex|bridge|browser|implementation|profile|wire_api/i.test(reason)
            ? 'runtime-bridge'
            : 'unknown';
  const owner = failureClass === 'provider-unavailable'
    ? 'provider'
    : failureClass === 'runtime-bridge'
      ? 'repo'
      : 'environment';
  return {
    failureClass,
    owner,
    policyViolations: uniqueStrings(policyViolations),
    missingEnv: uniqueStrings(missingEnv),
    nextActions,
    expectedRetestCommand: 'npm run smoke:runtime-codex-browser-acceptance',
  };
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

function positiveNumberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function runtimeStreamPathFromText(text: string): string | undefined {
  return /CODEX_RUNTIME_STREAM_PATH\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1]
    ?? /['"]((?:\/api\/sciforge\/runtime\/codex\/stream))['"]/.exec(text)?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
