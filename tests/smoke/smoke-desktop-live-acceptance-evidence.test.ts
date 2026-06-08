import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DESKTOP_LIVE_MODEL_ROUTER_PROFILE,
  DESKTOP_LIVE_MODEL_ROUTER_PROVIDER,
  type DesktopLiveAcceptanceEvidence,
  assertDesktopLiveAcceptanceCanClaimPass,
  createDesktopLiveAcceptancePlan,
  validateDesktopLiveAcceptanceEvidence,
} from '../../src/desktop/desktop-live-acceptance-evidence.js';

type DesktopLiveAcceptanceEvidenceOverrides =
  Partial<Omit<DesktopLiveAcceptanceEvidence, 'launch' | 'renderer' | 'runtimeTask' | 'artifactFollowup' | 'paths' | 'shutdown'>> & {
    launch?: Partial<DesktopLiveAcceptanceEvidence['launch']>;
    renderer?: Partial<DesktopLiveAcceptanceEvidence['renderer']>;
    runtimeTask?: Partial<DesktopLiveAcceptanceEvidence['runtimeTask']>;
    artifactFollowup?: Partial<DesktopLiveAcceptanceEvidence['artifactFollowup']>;
    paths?: Partial<DesktopLiveAcceptanceEvidence['paths']>;
    shutdown?: Partial<DesktopLiveAcceptanceEvidence['shutdown']>;
  };

test('R-DESK-01/R-PKG-01 plan requires live desktop package evidence beyond preflight contracts', () => {
  const plan = createDesktopLiveAcceptancePlan();

  assert.equal(plan.schemaVersion, 'sciforge.desktop.live-acceptance-plan.v1');
  assert.deepEqual(plan.projectTasks, ['R-DESK-01', 'R-PKG-01']);
  assert.deepEqual(plan.rejectedPassClaims, [
    'production-shell-contract-only',
    'packaging-preflight-contract-only',
  ]);
  assert.ok(plan.phases.some((phase) => phase.requiredEvidence.includes('runtime-codex-real-task')));
  assert.ok(plan.phases.some((phase) => phase.requiredEvidence.includes('audit-ref-lineage-and-scope')));
  assert.ok(plan.phases.some((phase) => phase.requiredEvidence.includes('selected-artifact-followup')));
  assert.ok(plan.phases.some((phase) => phase.requiredEvidence.includes('production-artifact-inspection')));
  assert.ok(plan.phases.some((phase) => phase.requiredEvidence.includes('dynamic-ports-no-fixed-dev-port')));
});

test('live desktop evidence can claim pass only with packaged/production Electron and real Runtime Codex flow', () => {
  const validation = validateDesktopLiveAcceptanceEvidence(validEvidence());

  assert.equal(validation.verdict, 'pass');
  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockReasons, []);
  assert.doesNotThrow(() => assertDesktopLiveAcceptanceCanClaimPass(validation));
});

test('production-shell and packaging preflight contracts alone are explicitly blocked', () => {
  const evidence = validEvidence({
    launch: {
      ...validEvidence().launch,
      mode: 'production-shell-contract-only',
      electronEntrypointPresent: false,
      electronDependencyPresent: false,
      productionArtifactInspection: undefined,
    },
    negativeEvidence: {
      productionShellContractOnly: true,
      packagingPreflightContractOnly: true,
    },
  });
  const validation = validateDesktopLiveAcceptanceEvidence(evidence);

  assert.equal(validation.verdict, 'blocked');
  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /cold-started production-mode Electron app or packaged app/);
  assert.match(validation.blockReasons.join('\n'), /Electron dependency and a real Electron entrypoint/);
  assert.match(validation.blockReasons.join('\n'), /credentials-free inspection/);
  assert.match(validation.blockReasons.join('\n'), /contracts alone cannot claim live desktop acceptance/);
  assert.throws(
    () => assertDesktopLiveAcceptanceCanClaimPass(validation),
    /Desktop live acceptance cannot claim pass/,
  );
});

test('Vite renderer URL or fixed dev port prevents R-PKG-01 production package pass', () => {
  const validation = validateDesktopLiveAcceptanceEvidence(validEvidence({
    renderer: {
      loadedFrom: 'vite-dev-url',
      url: 'http://localhost:5173/',
      buildArtifactExists: true,
    },
    ports: [
      { name: 'workspace-server', host: '127.0.0.1', actualPort: 5173, allocation: 'dynamic' },
      { name: 'model-router', host: '127.0.0.1', actualPort: 62011, allocation: 'dynamic' },
      { name: 'runtime-codex', host: '127.0.0.1', actualPort: 62012, allocation: 'dynamic' },
    ],
  }));

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /dist-ui build artifact/);
  assert.match(validation.blockReasons.join('\n'), /dynamic ports and no fixed Vite\/dev port/);
});

test('selected artifact follow-up and clean shutdown are required live evidence', () => {
  const validation = validateDesktopLiveAcceptanceEvidence(validEvidence({
    artifactFollowup: {
      selectedArtifactRef: 'artifact:research-report',
      artifactOpenedInRenderer: true,
      followupSubmittedAgainstSelectedArtifact: true,
      followupAnswerVisibleInRenderer: false,
      didNotStartNewSearch: true,
    } as unknown as DesktopLiveAcceptanceEvidence['artifactFollowup'],
    shutdown: {
      requestedFrom: 'app-quit',
      clean: true,
      rendererClosed: true,
      sidecarsStopped: false,
      portsReleased: true,
      auditLogClosed: true,
    } as unknown as DesktopLiveAcceptanceEvidence['shutdown'],
  }));

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /Selected artifact must be opened/);
  assert.match(validation.blockReasons.join('\n'), /Clean shutdown must close renderer/);
});

test('package artifact inspection alone cannot claim R-DESK/R-PKG live pass', () => {
  const validation = validateDesktopLiveAcceptanceEvidence(validEvidence({
    runtimeTask: {
      runtime: 'Runtime Codex',
      taskKind: 'real-user-task',
      modelRouterUsed: true,
      providerAuditVisible: false,
      answerVisibleInRenderer: false,
      rawPreflightOnly: true,
      taskId: '',
    } as unknown as DesktopLiveAcceptanceEvidence['runtimeTask'],
    artifactFollowup: {
      selectedArtifactRef: 'artifact:research-report',
      artifactOpenedInRenderer: true,
      followupSubmittedAgainstSelectedArtifact: false,
      followupAnswerVisibleInRenderer: false,
      didNotStartNewSearch: true,
    } as unknown as DesktopLiveAcceptanceEvidence['artifactFollowup'],
    sidecars: [],
    shutdown: {
      requestedFrom: 'app-quit',
      clean: false,
      rendererClosed: true,
      sidecarsStopped: false,
      portsReleased: false,
      auditLogClosed: false,
    } as unknown as DesktopLiveAcceptanceEvidence['shutdown'],
  }));

  const artifactInspectionCheck = validation.checks.find((check) => check.id === 'production-artifact-inspection');
  assert.equal(artifactInspectionCheck?.status, 'pass');
  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /visible Runtime Codex real task/);
  assert.match(validation.blockReasons.join('\n'), /Selected artifact must be opened/);
  assert.match(validation.blockReasons.join('\n'), /Sidecar lifecycle must be owned/);
  assert.match(validation.blockReasons.join('\n'), /Clean shutdown must close renderer/);
});

test('desktop live pass requires Runtime Codex provider metadata, command id, and audit refs', () => {
  const validation = validateDesktopLiveAcceptanceEvidence(validEvidence({
    runtimeTask: {
      runtime: 'Runtime Codex',
      taskKind: 'real-user-task',
      profile: DESKTOP_LIVE_MODEL_ROUTER_PROFILE,
      provider: DESKTOP_LIVE_MODEL_ROUTER_PROVIDER,
      model: 'sciforge-router',
      workspacePath: '/Users/test/Library/Application Support/SciForge/workspace',
      commandId: 'not-a-runtime-command-id',
      modelRouterUsed: true,
      providerAuditVisible: true,
      answerVisibleInRenderer: true,
      rawPreflightOnly: false,
      taskId: 'runtime-codex-live-task-001',
      auditRefs: [],
    },
  }));

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /Model Router provider\/profile\/model\/workspace\/command id and audit refs/);
});

test('desktop live pass requires scoped Runtime Codex audit lineage refs', () => {
  for (const patch of [
    {
      runtimeTask: {
        auditRefs: ['runtime-codex/codex-command-desktop-live-001/manifest.json'],
      },
    },
    {
      runtimeTask: {
        auditRefs: [
          '/Users/test/Library/Application Support/SciForge/logs/runtime-codex/codex-command-other/manifest.json',
        ],
      },
    },
    {
      artifactFollowup: {
        evidenceRefs: ['/tmp/selected-followup.json'],
      },
    },
    {
      artifactFollowup: {
        commandId: 'manual-followup',
        evidenceRefs: [
          '/Users/test/Library/Application Support/SciForge/logs/runtime-codex/codex-command-desktop-followup-001/selected-followup.json',
        ],
      },
    },
    {
      artifactFollowup: {
        evidenceRefs: ['/Users/test/Library/Application Support/SciForge/logs/selected-followup.json'],
      },
    },
    {
      shutdown: {
        evidenceRefs: ['desktop-runtime-audit.ndjson'],
      },
    },
  ] satisfies DesktopLiveAcceptanceEvidenceOverrides[]) {
    const validation = validateDesktopLiveAcceptanceEvidence(validEvidence(patch));

    assert.equal(validation.canClaimPass, false);
    assert.match(validation.blockReasons.join('\n'), /evidence refs must be absolute, scoped to app-data\/log paths, and tied to concrete Runtime Codex command lineage/);
  }
});

test('desktop live pass requires materialized evidence files and parseable command manifest', () => {
  for (const evidence of [
    removeRef(validEvidence(), (item) => item.runtimeTask.auditRefs[0]),
    removeRef(validEvidence(), (item) => item.sidecars[0].logPath),
    removeRef(validEvidence(), (item) => item.paths.auditLogPath),
    rewriteRef(validEvidence(), (item) => item.runtimeTask.auditRefs[0], '{"commandId":"codex-command-other"}\n'),
    rewriteRef(validEvidence(), (item) => item.artifactFollowup.evidenceRefs[0], '{"commandId":"codex-command-other"}\n'),
  ]) {
    const validation = validateDesktopLiveAcceptanceEvidence(evidence);

    assert.equal(validation.canClaimPass, false);
    assert.match(validation.blockReasons.join('\n'), /evidence refs must point to existing app-data\/workspace\/log files/);
  }

  const traversal = validEvidence();
  const traversalRef = join(traversal.paths.logsPath, '..', 'outside', 'selected-followup.json');
  mkdirSync(join(traversal.paths.logsPath, '..', 'outside'), { recursive: true });
  writeFileSync(traversalRef, '{}\n');
  traversal.artifactFollowup.evidenceRefs = [traversalRef];
  const traversalValidation = validateDesktopLiveAcceptanceEvidence(traversal);

  assert.equal(traversalValidation.canClaimPass, false);
  assert.match(traversalValidation.blockReasons.join('\n'), /absolute, scoped to app-data\/log paths/);
});

function validEvidence(
  overrides: DesktopLiveAcceptanceEvidenceOverrides = {},
): DesktopLiveAcceptanceEvidence {
  const appDataPath = mkdtempSync(join(tmpdir(), 'sciforge-desktop-live-'));
  const logsPath = join(appDataPath, 'logs');
  const sidecarLogsPath = join(logsPath, 'sidecars');
  const workspacePath = join(appDataPath, 'workspace');
  const runtimeCommandId = 'codex-command-desktop-live-001';
  const followupCommandId = 'codex-command-desktop-followup-001';
  const base: DesktopLiveAcceptanceEvidence = {
    schemaVersion: 'sciforge.desktop.live-acceptance-evidence.v1',
    launch: {
      mode: 'packaged-app',
      electronEntrypointPresent: true,
      electronDependencyPresent: true,
      coldStart: true,
      packagedArtifactPath: '/Applications/SciForge.app',
      productionMode: true,
      productionArtifactInspection: {
        schemaVersion: 'sciforge.desktop.production-artifact-inspection.v1',
        artifactPath: '/Applications/SciForge.app',
        inspectable: true,
        credentialsRequired: false,
        mainProcessInspected: true,
        preloadInspected: true,
        rendererArtifactInspected: true,
        viteDevServerUrlFound: false,
        canClaimRDeskOrRPkgPass: false,
      },
    },
    renderer: {
      loadedFrom: 'dist-ui/index.html',
      filePath: '/Applications/SciForge.app/Contents/Resources/app/dist-ui/index.html',
      buildArtifactExists: true,
    },
    runtimeTask: {
      runtime: 'Runtime Codex',
      taskKind: 'real-user-task',
      profile: DESKTOP_LIVE_MODEL_ROUTER_PROFILE,
      provider: DESKTOP_LIVE_MODEL_ROUTER_PROVIDER,
      model: 'sciforge-router',
      workspacePath,
      commandId: runtimeCommandId,
      modelRouterUsed: true,
      providerAuditVisible: true,
      answerVisibleInRenderer: true,
      rawPreflightOnly: false,
      taskId: 'runtime-codex-live-task-001',
      auditRefs: [
        join(logsPath, 'runtime-codex', runtimeCommandId, 'manifest.json'),
      ],
    },
    artifactFollowup: {
      selectedArtifactRef: 'artifact:research-report',
      commandId: followupCommandId,
      artifactOpenedInRenderer: true,
      followupSubmittedAgainstSelectedArtifact: true,
      followupAnswerVisibleInRenderer: true,
      didNotStartNewSearch: true,
      evidenceRefs: [
        join(logsPath, 'runtime-codex', followupCommandId, 'selected-followup.json'),
      ],
    },
    sidecars: [
      {
        role: 'workspace-server',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(sidecarLogsPath, 'workspace-server.log'),
      },
      {
        role: 'model-router',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(sidecarLogsPath, 'model-router.log'),
      },
      {
        role: 'runtime-codex',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(sidecarLogsPath, 'runtime-codex.log'),
      },
    ],
    ports: [
      { name: 'workspace-server', host: '127.0.0.1', actualPort: 62010, allocation: 'dynamic' },
      { name: 'model-router', host: '127.0.0.1', actualPort: 62011, allocation: 'dynamic' },
      { name: 'runtime-codex', host: '127.0.0.1', actualPort: 62012, allocation: 'dynamic' },
    ],
    paths: {
      appDataPath,
      logsPath,
      sidecarLogsPath,
      auditLogPath: join(logsPath, 'desktop-runtime-audit.ndjson'),
    },
    shutdown: {
      requestedFrom: 'app-quit',
      clean: true,
      rendererClosed: true,
      sidecarsStopped: true,
      portsReleased: true,
      auditLogClosed: true,
      evidenceRefs: [
        join(logsPath, 'desktop-runtime-audit.ndjson'),
      ],
    },
  };
  materializeDesktopEvidence(base);

  return {
    ...base,
    ...overrides,
    launch: { ...base.launch, ...overrides.launch },
    renderer: { ...base.renderer, ...overrides.renderer },
    runtimeTask: { ...base.runtimeTask, ...overrides.runtimeTask },
    artifactFollowup: { ...base.artifactFollowup, ...overrides.artifactFollowup },
    paths: { ...base.paths, ...overrides.paths },
    shutdown: { ...base.shutdown, ...overrides.shutdown },
  };
}

function removeRef(
  evidence: DesktopLiveAcceptanceEvidence,
  select: (evidence: DesktopLiveAcceptanceEvidence) => string,
): DesktopLiveAcceptanceEvidence {
  rmSync(select(evidence), { force: true });
  return evidence;
}

function rewriteRef(
  evidence: DesktopLiveAcceptanceEvidence,
  select: (evidence: DesktopLiveAcceptanceEvidence) => string,
  content: string,
): DesktopLiveAcceptanceEvidence {
  writeFileSync(select(evidence), content);
  return evidence;
}

function materializeDesktopEvidence(evidence: DesktopLiveAcceptanceEvidence): void {
  mkdirSync(evidence.runtimeTask.workspacePath, { recursive: true });
  mkdirSync(evidence.paths.sidecarLogsPath, { recursive: true });
  for (const ref of evidence.runtimeTask.auditRefs) mkdirSync(ref.split('/').slice(0, -1).join('/'), { recursive: true });
  for (const ref of evidence.artifactFollowup.evidenceRefs) mkdirSync(ref.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(evidence.runtimeTask.auditRefs[0], JSON.stringify({
    commandId: evidence.runtimeTask.commandId,
    taskId: evidence.runtimeTask.taskId,
    runtime: evidence.runtimeTask.runtime,
  }, null, 2));
  writeFileSync(evidence.artifactFollowup.evidenceRefs[0], JSON.stringify({
    commandId: evidence.artifactFollowup.commandId,
    selectedArtifactRef: evidence.artifactFollowup.selectedArtifactRef,
  }, null, 2));
  for (const sidecar of evidence.sidecars) writeFileSync(sidecar.logPath, `${sidecar.role} started and stopped cleanly\n`);
  writeFileSync(evidence.paths.auditLogPath, '{"event":"desktop-shutdown","clean":true}\n');
}
