import { existsSync, readFileSync, statSync } from 'node:fs';
import { normalize as normalizeFilePath } from 'node:path';

import {
  DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA,
  type DesktopProductionArtifactInspectionSummary,
} from './production-artifact-inspector.js';

export const DESKTOP_LIVE_ACCEPTANCE_SCHEMA = 'sciforge.desktop.live-acceptance-evidence.v1';
export const DESKTOP_LIVE_ACCEPTANCE_PLAN_SCHEMA = 'sciforge.desktop.live-acceptance-plan.v1';

export type DesktopLiveLaunchMode = 'production-electron' | 'packaged-app';
export type DesktopRejectedLaunchMode =
  | 'vite-dev-server'
  | 'production-shell-contract-only'
  | 'packaging-preflight-contract-only'
  | 'unknown';

export type DesktopSidecarRole = 'workspace-server' | 'provider-proxy' | 'runtime-codex';
export type DesktopLifecycleOwner = 'electron-main' | 'electron-platform-service';

export type DesktopLivePortEvidence = {
  name: string;
  host: '127.0.0.1' | 'localhost' | '::1';
  actualPort: number;
  allocation: 'dynamic';
  url?: string;
};

export type DesktopLiveSidecarEvidence = {
  role: DesktopSidecarRole;
  owner: DesktopLifecycleOwner;
  startedBy: 'electron-main-before-renderer-ready' | 'platform-service-before-renderer-ready';
  stoppedBy: 'electron-main-shutdown' | 'platform-service-shutdown';
  pid?: number;
  healthCheck: 'pass';
  logPath: string;
};

export type DesktopLiveRuntimeTaskEvidence = {
  runtime: 'Runtime Codex';
  taskKind: 'real-user-task';
  profile: 'sciforge-runtime-deepseek';
  provider: 'sciforge-deepseek-proxy';
  model: string;
  workspacePath: string;
  commandId: string;
  providerProxyUsed: true;
  providerAuditVisible: true;
  answerVisibleInRenderer: true;
  rawPreflightOnly: false;
  taskId: string;
  auditRefs: string[];
};

export type DesktopLiveArtifactFollowupEvidence = {
  selectedArtifactRef: string;
  commandId: string;
  artifactOpenedInRenderer: true;
  followupSubmittedAgainstSelectedArtifact: true;
  followupAnswerVisibleInRenderer: true;
  didNotStartNewSearch: true;
  evidenceRefs: string[];
};

export type DesktopLiveShutdownEvidence = {
  requestedFrom: 'app-quit' | 'window-close' | 'renderer-shutdown-command';
  clean: true;
  rendererClosed: true;
  sidecarsStopped: true;
  portsReleased: true;
  auditLogClosed: true;
  evidenceRefs: string[];
};

export type DesktopLivePathEvidence = {
  appDataPath: string;
  logsPath: string;
  sidecarLogsPath: string;
  auditLogPath: string;
};

export type DesktopLiveAcceptanceEvidence = {
  schemaVersion: typeof DESKTOP_LIVE_ACCEPTANCE_SCHEMA;
  launch: {
    mode: DesktopLiveLaunchMode | DesktopRejectedLaunchMode;
    electronEntrypointPresent: boolean;
    electronDependencyPresent: boolean;
    coldStart: true;
    packagedArtifactPath?: string;
    productionMode: boolean;
    productionArtifactInspection?: DesktopProductionArtifactInspectionSummary;
  };
  renderer: {
    loadedFrom: 'dist-ui/index.html' | 'vite-dev-url' | 'unknown';
    filePath?: string;
    url?: string;
    buildArtifactExists: boolean;
  };
  runtimeTask: DesktopLiveRuntimeTaskEvidence;
  artifactFollowup: DesktopLiveArtifactFollowupEvidence;
  sidecars: DesktopLiveSidecarEvidence[];
  ports: DesktopLivePortEvidence[];
  paths: DesktopLivePathEvidence;
  shutdown: DesktopLiveShutdownEvidence;
  negativeEvidence?: {
    productionShellContractOnly?: boolean;
    packagingPreflightContractOnly?: boolean;
  };
};

export type DesktopLiveAcceptanceRequirementId =
  | 'production-electron-or-packaged-app'
  | 'electron-entrypoint-and-dependency'
  | 'production-artifact-inspection'
  | 'renderer-build-artifact-not-vite'
  | 'runtime-codex-real-task'
  | 'audit-ref-lineage-and-scope'
  | 'materialized-evidence-files'
  | 'selected-artifact-followup'
  | 'sidecar-lifecycle-owned-by-main'
  | 'provider-proxy-and-runtime-sidecars'
  | 'logs-and-app-data-paths'
  | 'dynamic-ports-no-fixed-dev-port'
  | 'clean-shutdown'
  | 'not-contract-only';

export type DesktopLiveAcceptanceCheck = {
  id: DesktopLiveAcceptanceRequirementId;
  status: 'pass' | 'fail';
  message: string;
};

export type DesktopLiveAcceptanceValidation = {
  schemaVersion: typeof DESKTOP_LIVE_ACCEPTANCE_SCHEMA;
  verdict: 'pass' | 'blocked';
  canClaimPass: boolean;
  checks: DesktopLiveAcceptanceCheck[];
  blockReasons: string[];
};

export type DesktopLiveAcceptancePlan = {
  schemaVersion: typeof DESKTOP_LIVE_ACCEPTANCE_PLAN_SCHEMA;
  projectTasks: ['R-DESK-01', 'R-PKG-01'];
  phases: Array<{
    phase: 'cold-start' | 'runtime-task' | 'artifact-followup' | 'shutdown-audit';
    requiredEvidence: DesktopLiveAcceptanceRequirementId[];
  }>;
  rejectedPassClaims: Array<'production-shell-contract-only' | 'packaging-preflight-contract-only'>;
};

const FORBIDDEN_DEV_PORTS = new Set([5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180]);

export function createDesktopLiveAcceptancePlan(): DesktopLiveAcceptancePlan {
  return {
    schemaVersion: DESKTOP_LIVE_ACCEPTANCE_PLAN_SCHEMA,
    projectTasks: ['R-DESK-01', 'R-PKG-01'],
    phases: [
      {
        phase: 'cold-start',
        requiredEvidence: [
          'production-electron-or-packaged-app',
          'electron-entrypoint-and-dependency',
          'production-artifact-inspection',
          'renderer-build-artifact-not-vite',
          'dynamic-ports-no-fixed-dev-port',
        ],
      },
      {
        phase: 'runtime-task',
        requiredEvidence: [
          'runtime-codex-real-task',
          'audit-ref-lineage-and-scope',
          'materialized-evidence-files',
          'provider-proxy-and-runtime-sidecars',
          'sidecar-lifecycle-owned-by-main',
          'logs-and-app-data-paths',
        ],
      },
      {
        phase: 'artifact-followup',
        requiredEvidence: ['selected-artifact-followup'],
      },
      {
        phase: 'shutdown-audit',
        requiredEvidence: ['clean-shutdown', 'not-contract-only'],
      },
    ],
    rejectedPassClaims: ['production-shell-contract-only', 'packaging-preflight-contract-only'],
  };
}

export function validateDesktopLiveAcceptanceEvidence(
  evidence: DesktopLiveAcceptanceEvidence,
): DesktopLiveAcceptanceValidation {
  const checks: DesktopLiveAcceptanceCheck[] = [
    check(
      'production-electron-or-packaged-app',
      (evidence.launch.mode === 'production-electron' || evidence.launch.mode === 'packaged-app') &&
        evidence.launch.productionMode === true &&
        evidence.launch.coldStart === true &&
        (evidence.launch.mode !== 'packaged-app' || isNonEmptyAbsolutePath(evidence.launch.packagedArtifactPath ?? '')),
      'Live acceptance requires a cold-started production-mode Electron app or packaged app with a concrete packaged artifact path.',
    ),
    check(
      'electron-entrypoint-and-dependency',
      evidence.launch.electronEntrypointPresent && evidence.launch.electronDependencyPresent,
      'Electron dependency and a real Electron entrypoint must both exist before desktop/package pass can be claimed.',
    ),
    check(
      'production-artifact-inspection',
      hasProductionArtifactInspection(evidence),
      'Cold-start/package evidence must include credentials-free inspection of the packaged artifact, Electron main, preload, and renderer build.',
    ),
    check(
      'renderer-build-artifact-not-vite',
      evidence.renderer.loadedFrom === 'dist-ui/index.html' &&
        evidence.renderer.buildArtifactExists &&
        !containsViteDevUrl(evidence.renderer.url) &&
        !containsViteDevUrl(evidence.renderer.filePath),
      'Renderer must load the dist-ui build artifact and must not load a Vite dev URL.',
    ),
    check(
      'runtime-codex-real-task',
      evidence.runtimeTask.runtime === 'Runtime Codex' &&
        evidence.runtimeTask.taskKind === 'real-user-task' &&
        evidence.runtimeTask.profile === 'sciforge-runtime-deepseek' &&
        evidence.runtimeTask.provider === 'sciforge-deepseek-proxy' &&
        evidence.runtimeTask.model.trim().length > 0 &&
        isNonEmptyAbsolutePath(evidence.runtimeTask.workspacePath) &&
        /^codex-command-[a-z0-9-]+$/i.test(evidence.runtimeTask.commandId) &&
        evidence.runtimeTask.providerProxyUsed === true &&
        evidence.runtimeTask.providerAuditVisible === true &&
        evidence.runtimeTask.answerVisibleInRenderer === true &&
        evidence.runtimeTask.rawPreflightOnly === false &&
        evidence.runtimeTask.taskId.trim().length > 0 &&
        nonEmptyRefs(evidence.runtimeTask.auditRefs),
      'Live acceptance requires a visible Runtime Codex real task with provider/profile/model/workspace/command id and audit refs, not a raw preflight or contract-only proof.',
    ),
    check(
      'audit-ref-lineage-and-scope',
      runtimeCommandRefsHaveLineageAndScope(evidence) &&
        artifactFollowupRefsHaveLineageAndScope(evidence) &&
        shutdownRefsHaveLineageAndScope(evidence),
      'Runtime, selected-artifact follow-up, and shutdown evidence refs must be absolute, scoped to app-data/log paths, and tied to concrete Runtime Codex command lineage.',
    ),
    check(
      'materialized-evidence-files',
      desktopEvidenceFilesAreMaterialized(evidence),
      'Live desktop acceptance evidence refs must point to existing app-data/workspace/log files, sidecar logs, shutdown audit logs, a parseable Runtime Codex command manifest, and a parseable selected-artifact follow-up record.',
    ),
    check(
      'selected-artifact-followup',
      evidence.artifactFollowup.selectedArtifactRef.trim().length > 0 &&
        /^codex-command-[a-z0-9-]+$/i.test(evidence.artifactFollowup.commandId) &&
        evidence.artifactFollowup.artifactOpenedInRenderer === true &&
        evidence.artifactFollowup.followupSubmittedAgainstSelectedArtifact === true &&
        evidence.artifactFollowup.followupAnswerVisibleInRenderer === true &&
        evidence.artifactFollowup.didNotStartNewSearch === true &&
        nonEmptyRefs(evidence.artifactFollowup.evidenceRefs),
      'Selected artifact must be opened and followed up in place with a visible answer and evidence refs.',
    ),
    check(
      'sidecar-lifecycle-owned-by-main',
      evidence.sidecars.length > 0 &&
        evidence.sidecars.every((sidecar) =>
          (sidecar.owner === 'electron-main' || sidecar.owner === 'electron-platform-service') &&
          (sidecar.startedBy === 'electron-main-before-renderer-ready' ||
            sidecar.startedBy === 'platform-service-before-renderer-ready') &&
          (sidecar.stoppedBy === 'electron-main-shutdown' || sidecar.stoppedBy === 'platform-service-shutdown') &&
          sidecar.healthCheck === 'pass' &&
          isExistingFile(sidecar.logPath),
        ),
      'Sidecar lifecycle must be owned by Electron main or the platform service, including startup, health, logs, and shutdown.',
    ),
    check(
      'provider-proxy-and-runtime-sidecars',
      hasSidecar(evidence, 'workspace-server') &&
        hasSidecar(evidence, 'provider-proxy') &&
        hasSidecar(evidence, 'runtime-codex'),
      'Workspace server, provider proxy, and Runtime Codex sidecars must all be present.',
    ),
    check(
      'logs-and-app-data-paths',
      isNonEmptyAbsolutePath(evidence.paths.appDataPath) &&
        isNonEmptyAbsolutePath(evidence.paths.logsPath) &&
        isNonEmptyAbsolutePath(evidence.paths.sidecarLogsPath) &&
        isNonEmptyAbsolutePath(evidence.paths.auditLogPath) &&
        isExistingDirectory(evidence.paths.appDataPath) &&
        isExistingDirectory(evidence.paths.logsPath) &&
        isExistingDirectory(evidence.paths.sidecarLogsPath) &&
        isExistingFile(evidence.paths.auditLogPath) &&
        isPathUnder(evidence.paths.appDataPath, evidence.paths.logsPath) &&
        isPathUnder(evidence.paths.logsPath, evidence.paths.sidecarLogsPath) &&
        isPathUnder(evidence.paths.logsPath, evidence.paths.auditLogPath),
      'Logs, sidecar logs, and audit log paths must resolve under Electron app data.',
    ),
    check(
      'dynamic-ports-no-fixed-dev-port',
      evidence.ports.length > 0 &&
        evidence.ports.every((port) =>
          port.allocation === 'dynamic' &&
          port.actualPort > 0 &&
          port.actualPort < 65536 &&
          !FORBIDDEN_DEV_PORTS.has(port.actualPort) &&
          !containsViteDevUrl(port.url),
        ),
      'Production desktop evidence must use dynamic ports and no fixed Vite/dev port contract.',
    ),
    check(
      'clean-shutdown',
      evidence.shutdown.clean === true &&
        evidence.shutdown.rendererClosed === true &&
        evidence.shutdown.sidecarsStopped === true &&
        evidence.shutdown.portsReleased === true &&
        evidence.shutdown.auditLogClosed === true &&
        nonEmptyRefs(evidence.shutdown.evidenceRefs),
      'Clean shutdown must close renderer, sidecars, ports, and audit logs with shutdown evidence refs.',
    ),
    check(
      'not-contract-only',
      evidence.negativeEvidence?.productionShellContractOnly !== true &&
        evidence.negativeEvidence?.packagingPreflightContractOnly !== true &&
        evidence.launch.mode !== 'production-shell-contract-only' &&
        evidence.launch.mode !== 'packaging-preflight-contract-only',
      'Production-shell planner or packaging preflight contracts alone cannot claim live desktop acceptance.',
    ),
  ];
  const blockReasons = checks.filter((item) => item.status === 'fail').map((item) => item.message);

  return {
    schemaVersion: DESKTOP_LIVE_ACCEPTANCE_SCHEMA,
    verdict: blockReasons.length === 0 ? 'pass' : 'blocked',
    canClaimPass: blockReasons.length === 0,
    checks,
    blockReasons,
  };
}

export function assertDesktopLiveAcceptanceCanClaimPass(
  validation: DesktopLiveAcceptanceValidation,
): void {
  if (validation.canClaimPass) return;
  throw new Error(`Desktop live acceptance cannot claim pass: ${validation.blockReasons.join('; ')}`);
}

function check(
  id: DesktopLiveAcceptanceRequirementId,
  passed: boolean,
  message: string,
): DesktopLiveAcceptanceCheck {
  return { id, status: passed ? 'pass' : 'fail', message };
}

function hasSidecar(evidence: DesktopLiveAcceptanceEvidence, role: DesktopSidecarRole): boolean {
  return evidence.sidecars.some((sidecar) => sidecar.role === role);
}

function containsViteDevUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1):517[3-9]\b/i.test(value);
}

function hasProductionArtifactInspection(evidence: DesktopLiveAcceptanceEvidence): boolean {
  const inspection = evidence.launch.productionArtifactInspection;
  if (!inspection) return false;
  const packagedPathMatches = evidence.launch.mode !== 'packaged-app' ||
    trimTrailingSlash(inspection.artifactPath) === trimTrailingSlash(evidence.launch.packagedArtifactPath ?? '');
  return inspection.schemaVersion === DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA &&
    inspection.inspectable === true &&
    inspection.credentialsRequired === false &&
    inspection.mainProcessInspected === true &&
    inspection.preloadInspected === true &&
    inspection.rendererArtifactInspected === true &&
    inspection.viteDevServerUrlFound === false &&
    inspection.canClaimRDeskOrRPkgPass === false &&
    isNonEmptyAbsolutePath(inspection.artifactPath) &&
    packagedPathMatches;
}

function isNonEmptyAbsolutePath(value: string): boolean {
  return value.startsWith('/') && value.trim().length > 1;
}

function nonEmptyRefs(refs: string[] | undefined): boolean {
  return Array.isArray(refs) && refs.length > 0 && refs.every((ref) => ref.trim().length > 0);
}

function runtimeCommandRefsHaveLineageAndScope(evidence: DesktopLiveAcceptanceEvidence): boolean {
  const refs = evidence.runtimeTask.auditRefs;
  if (!nonEmptyRefs(refs)) return false;
  const commandDir = runtimeCodexCommandLogDir(evidence.paths.logsPath, evidence.runtimeTask.commandId);
  return refs.some((ref) => normalizePath(ref) === `${commandDir}/manifest.json`) &&
    refs.every((ref) => isScopedDesktopEvidenceRef(ref, evidence, [commandDir]));
}

function artifactFollowupRefsHaveLineageAndScope(evidence: DesktopLiveAcceptanceEvidence): boolean {
  const refs = evidence.artifactFollowup.evidenceRefs;
  if (!nonEmptyRefs(refs)) return false;
  const commandDir = runtimeCodexCommandLogDir(evidence.paths.logsPath, evidence.artifactFollowup.commandId);
  return /^codex-command-[a-z0-9-]+$/i.test(evidence.artifactFollowup.commandId) &&
    refs.every((ref) => isScopedDesktopEvidenceRef(ref, evidence, [commandDir])) &&
    refs.some((ref) => isPathUnder(commandDir, ref));
}

function shutdownRefsHaveLineageAndScope(evidence: DesktopLiveAcceptanceEvidence): boolean {
  const refs = evidence.shutdown.evidenceRefs;
  return nonEmptyRefs(refs) && refs.every((ref) => isScopedDesktopEvidenceRef(ref, evidence));
}

function desktopEvidenceFilesAreMaterialized(evidence: DesktopLiveAcceptanceEvidence): boolean {
  const runtimeManifestRef = runtimeCommandManifestRef(evidence);
  const selectedFollowupRef = selectedArtifactFollowupRef(evidence);
  if (!runtimeManifestRef || !selectedFollowupRef) return false;
  return isExistingDirectory(evidence.runtimeTask.workspacePath) &&
    isExistingDirectory(evidence.paths.appDataPath) &&
    isExistingDirectory(evidence.paths.logsPath) &&
    isExistingDirectory(evidence.paths.sidecarLogsPath) &&
    isExistingFile(evidence.paths.auditLogPath) &&
    evidence.sidecars.every((sidecar) => isExistingFile(sidecar.logPath)) &&
    evidence.runtimeTask.auditRefs.every(isExistingFile) &&
    evidence.artifactFollowup.evidenceRefs.every(isExistingFile) &&
    evidence.shutdown.evidenceRefs.every(isExistingFile) &&
    jsonFileHasField(runtimeManifestRef, 'commandId', evidence.runtimeTask.commandId) &&
    jsonFileHasField(selectedFollowupRef, 'commandId', evidence.artifactFollowup.commandId) &&
    jsonFileHasField(selectedFollowupRef, 'selectedArtifactRef', evidence.artifactFollowup.selectedArtifactRef);
}

function runtimeCommandManifestRef(evidence: DesktopLiveAcceptanceEvidence): string | undefined {
  const commandDir = runtimeCodexCommandLogDir(evidence.paths.logsPath, evidence.runtimeTask.commandId);
  return evidence.runtimeTask.auditRefs.find((ref) => normalizePath(ref) === `${commandDir}/manifest.json`);
}

function selectedArtifactFollowupRef(evidence: DesktopLiveAcceptanceEvidence): string | undefined {
  const commandDir = runtimeCodexCommandLogDir(evidence.paths.logsPath, evidence.artifactFollowup.commandId);
  return evidence.artifactFollowup.evidenceRefs.find((ref) => isPathUnder(commandDir, ref));
}

function isScopedDesktopEvidenceRef(
  ref: string,
  evidence: DesktopLiveAcceptanceEvidence,
  extraAllowedParents: string[] = [],
): boolean {
  if (!isNonEmptyAbsolutePath(ref)) return false;
  if (hasParentPathSegment(ref)) return false;
  return [
    evidence.paths.appDataPath,
    evidence.paths.logsPath,
    ...extraAllowedParents,
  ].some((parent) => isPathUnder(parent, ref));
}

function runtimeCodexCommandLogDir(logsPath: string, commandId: string): string {
  return `${normalizePath(logsPath)}/runtime-codex/${commandId}`;
}

function isPathUnder(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return trimTrailingSlash(trimmed);
  return trimTrailingSlash(normalizeFilePath(trimmed));
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function isExistingFile(value: string): boolean {
  if (!isNonEmptyAbsolutePath(value)) return false;
  if (hasParentPathSegment(value)) return false;
  try {
    return existsSync(value) && statSync(value).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(value: string): boolean {
  if (!isNonEmptyAbsolutePath(value)) return false;
  if (hasParentPathSegment(value)) return false;
  try {
    return existsSync(value) && statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function hasParentPathSegment(value: string): boolean {
  return value.split('/').includes('..');
}

function jsonFileHasField(path: string, field: string, expectedValue: string): boolean {
  if (!isExistingFile(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>)[field] === expectedValue;
  } catch {
    return false;
  }
}
