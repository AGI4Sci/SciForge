import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('ready preflight producer branch records protocol proof without release eligibility', async () => {
  const artifactRoot = join(root, '.sciforge', 'test-artifacts');
  await mkdir(artifactRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-evidence-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-producer-workspace-'));
  const preflightDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-preflight-'));
  const providerPreflightPath = join(preflightDir, 'manifest.json');
  const serviceKey = 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_PRODUCER_20260607';
  const upstreamBaseUrl = 'https://provider.example.invalid/v1';

  try {
    await writeFile(providerPreflightPath, JSON.stringify({
      schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
      checkedAt: new Date().toISOString(),
      releaseAcceptance: 'not-evaluated',
      runtimeApiKeyPresentInServiceEnv: true,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'env',
      upstreamBaseUrlSourceKind: 'env',
      configPathsCheckedCount: 0,
      configSecretFallbackCount: 0,
      category: 'ready',
      owner: 'provider',
      policyViolations: [],
      missingEnv: [],
      evidenceMode: 'current-env-diagnostic-only',
    }, null, 2), 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_BROWSER_ACCEPTANCE_PROVIDER_PREFLIGHT_PATH: providerPreflightPath,
          SCIFORGE_BROWSER_ACCEPTANCE_TEST_PRODUCER_WRITER: '1',
          NODE_ENV: 'test',
          SCIFORGE_WORKSPACE_PATH: workspacePath,
          SCIFORGE_RUNTIME_API_KEY: serviceKey,
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: upstreamBaseUrl,
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '',
        },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[blocked\] Runtime Codex in-app browser acceptance is not passed/);

    const manifestText = await readFile(resolve(evidenceDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: unknown;
      requestedRolePort?: unknown;
      actualWorkspaceWriterPort?: unknown;
      actualWorkspaceWriterUrl?: unknown;
      actualWorkspaceWriterUrlEvidence?: unknown;
      actualRuntimeCodexPort?: unknown;
      actualRuntimeCodexUrl?: unknown;
      actualRuntimeCodexUrlEvidence?: unknown;
      actualUrl?: unknown;
      actualUrlEvidence?: unknown;
      actualPort?: unknown;
      workspacePath?: unknown;
      workspacePathEvidence?: unknown;
      provider?: unknown;
      model?: unknown;
      negativeChecks?: Record<string, unknown>;
      evidence?: { notesPath?: unknown; runtimeAuditPath?: unknown };
      releaseEligible?: unknown;
      releaseBlocking?: unknown;
      currentRunEvidenceScope?: unknown;
      providerPreflightRef?: unknown;
      liveRuntimeCodexProof?: { eventEvidenceRefs?: unknown };
      diagnosticProtocolProof?: { status?: unknown; evidenceRefs?: unknown };
    };

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.releaseEligible, false);
    assert.equal(manifest.releaseBlocking, true);
    assert.equal(typeof manifest.actualPort, 'number');
    assert.equal(typeof manifest.requestedRolePort, 'number');
    assert.equal(typeof manifest.actualWorkspaceWriterPort, 'number');
    assert.equal(typeof manifest.actualRuntimeCodexPort, 'number');
    assert.equal(manifest.actualUrl, undefined);
    assert.equal(manifest.actualWorkspaceWriterUrl, undefined);
    assert.equal(manifest.actualRuntimeCodexUrl, undefined);
    assert.equal(manifest.workspacePath, undefined);
    assert.ok(manifest.actualUrlEvidence);
    assert.ok(manifest.actualWorkspaceWriterUrlEvidence);
    assert.ok(manifest.actualRuntimeCodexUrlEvidence);
    assert.ok(manifest.workspacePathEvidence);
    assert.equal(manifest.currentRunEvidenceScope, 'preflight-only');
    assert.equal(typeof manifest.providerPreflightRef, 'string');
    assert.deepEqual(manifest.negativeChecks, {
      fakePassedStatusRejected: true,
      missingDomOrScreenshotRejected: true,
      missingCommandIdRejected: true,
      missingTaskResultRejected: true,
      seedDemoEvidenceRejected: true,
      blockedFailedPartialRejected: true,
      rawStdoutJsonlRejected: true,
      nativeAnswerOutsideDefaultChatRejected: true,
    });
    assert.equal(typeof manifest.evidence?.notesPath, 'string');
    assert.match(String(manifest.evidence?.notesPath), /blocked-runtime-config\.md$/);
    assert.doesNotMatch(String(manifest.evidence?.notesPath), /^\//);
    assert.equal(manifest.evidence?.runtimeAuditPath, undefined);
    assert.equal(manifest.liveRuntimeCodexProof, undefined);
    assert.equal(manifest.diagnosticProtocolProof?.status, 'protocol-only');
    const eventEvidenceRefs = Array.isArray(manifest.diagnosticProtocolProof?.evidenceRefs)
      ? manifest.diagnosticProtocolProof.evidenceRefs.map((ref) => String(ref))
      : [];
    const eventEvidenceText = eventEvidenceRefs.join('\n');
    assert.ok(eventEvidenceRefs.some((ref) => /\bbrowser_search\b/i.test(ref)), 'producer branch must preserve direct browser_search refs');
    assert.ok(eventEvidenceRefs.some((ref) => /\bbrowser_read\b/i.test(ref)), 'producer branch must preserve direct browser_read refs');
    assert.ok(eventEvidenceRefs.some((ref) => /source-pages\/.+\.source\.json$/i.test(ref)), 'producer branch must preserve current-run source-page refs');
    assert.ok(eventEvidenceRefs.some((ref) => /source-pages\/.+\.txt$/i.test(ref)), 'producer branch must preserve current-run page-text refs');
    assert.ok(eventEvidenceRefs.some((ref) => /gui\.present[:/]final-answer/i.test(ref)), 'producer branch must preserve gui.present final-answer refs');
    assert.doesNotMatch(eventEvidenceText, /executeBoundedOperation|module\.invoke[^\n]*(?:browser\.)?(?:search_read|open_read)/i);
    assert.doesNotMatch(eventEvidenceText, /browser\.(?:search_read|open_read)|\b(?:search_read|open_read)\b/i);
    assert.doesNotMatch(manifestText, /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i);
    assert.doesNotMatch(manifestText, /\/(?:Applications|Users|private|var|tmp)\/[^\s"']+/i);
    assert.doesNotMatch(manifestText, new RegExp(serviceKey));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid/);
  } finally {
    await Promise.all([
      rm(evidenceDir, { recursive: true, force: true }),
      rm(workspacePath, { recursive: true, force: true }),
      rm(preflightDir, { recursive: true, force: true }),
    ]);
  }
});

test('strict smoke rejects fixture producer proof as live product acceptance', async () => {
  const artifactRoot = join(root, '.sciforge', 'test-artifacts');
  await mkdir(artifactRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-strict-evidence-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-producer-strict-workspace-'));
  const preflightDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-strict-preflight-'));
  const providerPreflightPath = join(preflightDir, 'manifest.json');

  try {
    await writeFile(providerPreflightPath, JSON.stringify({
      schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
      checkedAt: new Date().toISOString(),
      releaseAcceptance: 'not-evaluated',
      runtimeApiKeyPresentInServiceEnv: true,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'env',
      upstreamBaseUrlSourceKind: 'env',
      configPathsCheckedCount: 0,
      configSecretFallbackCount: 0,
      category: 'ready',
      owner: 'provider',
      policyViolations: [],
      missingEnv: [],
      evidenceMode: 'current-env-diagnostic-only',
    }, null, 2), 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_BROWSER_ACCEPTANCE_PROVIDER_PREFLIGHT_PATH: providerPreflightPath,
          SCIFORGE_BROWSER_ACCEPTANCE_TEST_PRODUCER_WRITER: '1',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '1',
          NODE_ENV: 'test',
          SCIFORGE_WORKSPACE_PATH: workspacePath,
          SCIFORGE_RUNTIME_API_KEY: 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_PRODUCER_STRICT_20260608',
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.invalid/v1',
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '',
        },
        encoding: 'utf8',
      },
    );

    assert.notEqual(result.status, 0, 'strict smoke must reject isolated fixture producer proof');
    assert.match(result.stderr, /requires manifest\.status === passed; got blocked/);

    const manifest = JSON.parse(await readFile(resolve(evidenceDir, 'manifest.json'), 'utf8')) as {
      status?: unknown;
      releaseEligible?: unknown;
      releaseBlocking?: unknown;
      liveRuntimeCodexProof?: unknown;
      diagnosticProtocolProof?: { status?: unknown; evidenceRefs?: unknown };
    };

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.releaseEligible, false);
    assert.equal(manifest.releaseBlocking, true);
    assert.equal(manifest.liveRuntimeCodexProof, undefined);
    assert.equal(manifest.diagnosticProtocolProof?.status, 'protocol-only');
    assert.ok(
      Array.isArray(manifest.diagnosticProtocolProof?.evidenceRefs)
        && manifest.diagnosticProtocolProof.evidenceRefs.some((ref) => /\bbrowser_read\b/i.test(String(ref))),
      'producer protocol proof may retain browser_read evidence refs for diagnostics',
    );
  } finally {
    await Promise.all([
      rm(evidenceDir, { recursive: true, force: true }),
      rm(workspacePath, { recursive: true, force: true }),
      rm(preflightDir, { recursive: true, force: true }),
    ]);
  }
});

test('validate-only strict smoke rejects passed manifests without materialized Browser source artifacts', async () => {
  const artifactRoot = join(root, '.sciforge', 'test-artifacts');
  await mkdir(artifactRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-missing-source-evidence-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-missing-source-workspace-'));
  const preflightDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-missing-source-preflight-'));
  const providerPreflightPath = join(preflightDir, 'manifest.json');
  const commandId = 'codex-command-browser-missing-source-artifact';
  const sourceRef = 'browser-host-session:missing-source/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:missing-source/source-pages/source-1.txt';
  const notesPath = join(evidenceDir, 'runtime-ordinary-chat-release-notes.md');
  const runtimeAuditPath = join(evidenceDir, 'runtime-audit.json');
  const refs = [
    'runtime-tool:browser_search:missing-source',
    'runtime-tool:browser_read:missing-source',
    sourceRef,
    textRef,
    `gui.present:final-answer:${commandId}`,
  ];

  try {
    await writeReadyProviderPreflight(providerPreflightPath);
    await writeFile(runtimeAuditPath, JSON.stringify({
      schemaVersion: 'sciforge.runtime-codex.browser-ordinary-chat-audit.v1',
      eventCount: 3,
      events: ['browser_search completed', 'browser_read completed', 'gui.present completed'],
    }, null, 2), 'utf8');
    await writeFile(notesPath, [
      '# Runtime Codex browser ordinary-chat acceptance',
      '',
      `Command id: ${commandId}`,
      '',
      'Actual task result: direct Browser source evidence was claimed in manifest refs.',
      'This file intentionally does not create the browser-host-session source artifacts.',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
      status: 'passed',
      source: 'codex-in-app-browser',
      observedAt: new Date().toISOString(),
      actualPort: 5173,
      actualWorkspaceWriterPort: 5174,
      actualRuntimeCodexPort: 18080,
      actualUrlEvidence: boundedTextEvidence('http://127.0.0.1:5173/'),
      actualWorkspaceWriterUrlEvidence: boundedTextEvidence('http://127.0.0.1:5174/'),
      actualRuntimeCodexUrlEvidence: boundedTextEvidence('http://127.0.0.1:18080/'),
      workspacePathEvidence: boundedTextEvidence(workspacePath),
      profile: 'browser-acceptance-test-profile',
      provider: 'browser-acceptance-test-provider',
      model: 'browser-acceptance-test-model',
      commandId,
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
        userIntent: 'Validate Browser source artifact materialization.',
        expectedObservableResult: 'Strict validate-only must reject source refs whose files are missing.',
        actualResult: 'Manifest claims Browser source refs without materialized source artifacts.',
        evidenceRefs: refs,
        negativeChecks: ['Missing BrowserHostSession source files must fail.'],
        remainingRisks: 'None for this negative fixture.',
      },
      actualTaskResult: {
        status: 'passed',
        summary: 'Manifest claims Browser grounded answer.',
        userIntentSatisfied: true,
        outputVerified: true,
        evidenceRefs: refs,
      },
      liveRuntimeCodexProof: {
        messageProvenance: 'live-runtime-codex',
        commandId,
        guiPresentObserved: true,
        nativeDefaultChatAssistantAnswerRendered: true,
        runtimeOutputObserved: true,
        seedOrDemoExcluded: true,
        eventEvidenceRefs: refs,
      },
      evidence: {
        notesPath: relative(root, notesPath),
        runtimeAuditPath: relative(root, runtimeAuditPath),
      },
      negativeChecks: expectedNegativeChecks(),
    }, null, 2), 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_BROWSER_ACCEPTANCE_PROVIDER_PREFLIGHT_PATH: providerPreflightPath,
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '1',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '1',
          SCIFORGE_WORKSPACE_PATH: workspacePath,
          SCIFORGE_RUNTIME_API_KEY: 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_VALIDATE_ONLY_20260608',
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.invalid/v1',
          SCIFORGE_COMPUTER_USE_PLANNER_PROFILE: 'browser-acceptance-test-profile',
          SCIFORGE_RUNTIME_MODEL_PROVIDER: 'browser-acceptance-test-provider',
          SCIFORGE_RUNTIME_MODEL: 'browser-acceptance-test-model',
        },
        encoding: 'utf8',
      },
    );

    assert.notEqual(result.status, 0, 'strict validate-only must reject passed manifests whose BrowserHostSession source files are missing');
    assert.match(`${result.stderr}\n${result.stdout}`, /source artifact|BrowserHostSession source|missing/i);
  } finally {
    await Promise.all([
      rm(evidenceDir, { recursive: true, force: true }),
      rm(workspacePath, { recursive: true, force: true }),
      rm(preflightDir, { recursive: true, force: true }),
    ]);
  }
});

test('validate-only strict smoke rejects forged historical negative-fixture source refs', async () => {
  const artifactRoot = join(root, '.sciforge', 'test-artifacts');
  await mkdir(artifactRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-forged-negative-fixture-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-forged-negative-workspace-'));
  const preflightDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-forged-negative-preflight-'));
  const providerPreflightPath = join(preflightDir, 'manifest.json');
  const commandId = 'codex-command-negative-forged-source-artifact';
  const domPath = join(evidenceDir, 'forged-dom.txt');
  const notesPath = join(evidenceDir, 'forged-notes.md');
  const sourceRef = 'browser-host-session:forged-negative/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:forged-negative/source-pages/source-1.txt';
  const refs = [
    'runtime-tool:browser_search:forged-negative',
    'runtime-tool:browser_read:forged-negative',
    'browser-host-session:forged-negative',
    sourceRef,
    textRef,
    'artifact:negative-fixture',
    `gui.present:final-answer:${commandId}`,
  ];
  const evidence = {
    domSnapshotPath: relative(root, domPath),
    notesPath: relative(root, notesPath),
  };
  const proof = {
    messageProvenance: 'live-runtime-codex',
    commandId,
    guiPresentObserved: true,
    nativeDefaultChatAssistantAnswerRendered: true,
    runtimeOutputObserved: true,
    seedOrDemoExcluded: true,
    eventEvidenceRefs: refs,
  };
  const actualTaskResult = {
    status: 'passed',
    summary: 'Manifest claims Browser grounded answer from historical negative source refs.',
    userIntentSatisfied: true,
    outputVerified: true,
    evidenceRefs: refs,
  };

  try {
    await writeReadyProviderPreflight(providerPreflightPath);
    await writeFile(domPath, [
      '- main:',
      '  - strong: Ask SciForge',
      '  - generic: Runtime Codex',
      '  - generic: browser-acceptance-test-profile',
      '  - generic: browser-acceptance-test-provider',
      '  - generic: browser-acceptance-test-model',
      `  - generic: command ${commandId}`,
      '  - generic: gui.present show-result from live Runtime Codex',
      '  - paragraph: Runtime Codex answer rendered in bounded summary.',
      '  - generic: audit folded by default',
      '',
    ].join('\n'), 'utf8');
    await writeFile(notesPath, [
      '# Acceptance rubric',
      '',
      `Actual task result: Runtime Codex rendered a live answer for command ${commandId}.`,
      'Evidence refs: direct browser_search, direct browser_read, source-page refs, and gui.present final-answer.',
      'Negative checks: fake passed states and missing source files must be rejected.',
      'Remaining risks: none for this validator negative case.',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
      status: 'passed',
      source: 'codex-in-app-browser',
      observedAt: new Date().toISOString(),
      actualPort: 5173,
      actualWorkspaceWriterPort: 5174,
      actualRuntimeCodexPort: 18080,
      actualUrlEvidence: boundedTextEvidence('http://127.0.0.1:5173/'),
      actualWorkspaceWriterUrlEvidence: boundedTextEvidence('http://127.0.0.1:5174/'),
      actualRuntimeCodexUrlEvidence: boundedTextEvidence('http://127.0.0.1:18080/'),
      workspacePathEvidence: boundedTextEvidence(workspacePath),
      profile: 'browser-acceptance-test-profile',
      provider: 'browser-acceptance-test-provider',
      model: 'browser-acceptance-test-model',
      commandId,
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
        userIntent: 'Validate historical negative fixture cannot bypass source materialization.',
        expectedObservableResult: 'Strict validate-only rejects missing BrowserHostSession source files.',
        actualResult: 'Manifest claims historical negative fixture source refs without source files.',
        evidenceRefs: refs,
        negativeChecks: ['Historical fixture markers must not bypass source file validation.'],
        remainingRisks: 'None for this negative fixture.',
      },
      actualTaskResult,
      liveRuntimeCodexProof: proof,
      evidence,
      singleTurn: passedLegacyScenario('single turn', evidence, actualTaskResult, proof),
      artifactFollowUp: {
        ...passedLegacyScenario('artifact follow up', evidence, actualTaskResult, proof),
        selectedRefs: ['artifact:negative-fixture'],
      },
      multiTurn: {
        ...passedLegacyScenario('multi turn', evidence, actualTaskResult, proof),
        followUpPromptEvidence: boundedTextEvidence('reply with the remembered passphrase'),
        expectedPassphraseEvidence: boundedTextEvidence('bounded-passphrase'),
        secondTurnVisibleAnswerConfirmed: true,
      },
      negativeChecks: expectedNegativeChecks(),
    }, null, 2), 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_BROWSER_ACCEPTANCE_PROVIDER_PREFLIGHT_PATH: providerPreflightPath,
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '1',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '1',
          SCIFORGE_WORKSPACE_PATH: workspacePath,
          SCIFORGE_RUNTIME_API_KEY: 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_FORGED_NEGATIVE_20260608',
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.invalid/v1',
          SCIFORGE_COMPUTER_USE_PLANNER_PROFILE: 'browser-acceptance-test-profile',
          SCIFORGE_RUNTIME_MODEL_PROVIDER: 'browser-acceptance-test-provider',
          SCIFORGE_RUNTIME_MODEL: 'browser-acceptance-test-model',
        },
        encoding: 'utf8',
      },
    );

    assert.notEqual(result.status, 0, 'strict validate-only must reject forged historical negative-fixture source refs');
    assert.match(`${result.stderr}\n${result.stdout}`, /source artifact|BrowserHostSession source|missing/i);
  } finally {
    await Promise.all([
      rm(evidenceDir, { recursive: true, force: true }),
      rm(workspacePath, { recursive: true, force: true }),
      rm(preflightDir, { recursive: true, force: true }),
    ]);
  }
});

async function writeReadyProviderPreflight(providerPreflightPath: string): Promise<void> {
  await writeFile(providerPreflightPath, JSON.stringify({
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'env',
    upstreamBaseUrlSourceKind: 'env',
    configPathsCheckedCount: 0,
    configSecretFallbackCount: 0,
    category: 'ready',
    owner: 'provider',
    policyViolations: [],
    missingEnv: [],
    evidenceMode: 'current-env-diagnostic-only',
  }, null, 2), 'utf8');
}

function passedLegacyScenario(userIntent: string, evidence: object, actualTaskResult: object, proof: object) {
  return {
    status: 'passed',
    promptEvidence: boundedTextEvidence(userIntent),
    userIntent,
    actualTaskResult,
    liveRuntimeCodexProof: proof,
    negativeChecks: expectedNegativeChecks(),
    visibleAnswerConfirmed: true,
    providerModelProfileVisible: true,
    workspaceCommandIdVisible: true,
    rawAuditFoldedByDefault: true,
    evidence,
  };
}

function boundedTextEvidence(value: string) {
  return {
    length: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}

function expectedNegativeChecks() {
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
