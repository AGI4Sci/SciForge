import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isRecord, readOptionalJson } from './server/http.js';

export const RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.runtime-codex.browser-acceptance.v1';
const RUNTIME_CODEX_BROWSER_ACCEPTANCE_SOURCE = 'codex-in-app-browser';
const RUNTIME_CODEX_BROWSER_ACCEPTANCE_STATUSES = new Set(['passed', 'blocked', 'failed', 'partial']);

interface RuntimeCodexBrowserAcceptanceReadOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  parallelProfileId: string;
  nowMs?: () => number;
  nowIso?: () => string;
  statFile?: typeof stat;
}

interface RuntimeCodexBrowserAcceptanceManifest {
  schemaVersion?: string;
  status: string;
  observedAt?: string;
  source?: string;
  actualUrl?: string;
  actualPort?: number;
  requestedRolePort?: number;
  actualWorkspaceWriterPort?: number;
  actualWorkspaceWriterUrl?: string;
  actualRuntimeCodexPort?: number;
  actualRuntimeCodexUrl?: string;
  profile?: string;
  workspacePath?: string;
  provider?: string;
  model?: string;
  commandId?: string;
  startedFromDefaultChatEntry?: boolean;
  submittedThroughRuntimeCodex?: boolean;
  providerModelProfileVisible?: boolean;
  mainAnswerVisible?: boolean;
  rawAuditFoldedByDefault?: boolean;
  acceptanceConclusionFromRealBrowser?: boolean;
  currentRunEvidenceScope?: string;
  reason?: string;
  blocker?: string;
  blockedOn?: string[];
  failureClass?: string;
  owner?: string;
  policyViolations?: string[];
  missingEnv?: string[];
  expectedRetestCommand?: string;
  releaseBlocking?: boolean;
  releaseEligible?: boolean;
  providerPreflightRef?: string;
  providerPreflightCategory?: string;
  providerPreflightCheckedAt?: string;
  providerPreflightReleaseAcceptance?: string;
  providerPreflightEvidenceMode?: string;
  runtimeApiKeyPresentInServiceEnv?: boolean;
  upstreamBaseUrlPresent?: boolean;
  upstreamKeySourceKind?: string;
  upstreamBaseUrlSourceKind?: string;
  configPathsChecked?: string[];
  configSecretFallbackPaths?: string[];
  staleEvidenceRefs?: string[];
  nextActions?: Array<{
    label: string;
    command?: string;
    expected?: string;
    writesRepo?: boolean;
  }>;
  evidence?: {
    screenshotPath?: string;
    domSnapshotPath?: string;
    notesPath?: string;
    runtimeAuditPath?: string;
  };
  freshness?: RuntimeCodexBrowserAcceptanceFreshness;
}

interface RuntimeCodexBrowserAcceptanceFreshness {
  checkedAt: string;
  observedAtFresh: boolean;
  evidenceFresh: boolean;
  staleEvidenceRefs: string[];
}

export async function readRuntimeCodexBrowserAcceptanceManifest(
  options: RuntimeCodexBrowserAcceptanceReadOptions,
): Promise<RuntimeCodexBrowserAcceptanceManifest | undefined> {
  const manifestPath = runtimeCodexBrowserAcceptanceManifestPath(options);
  const parsed = await readOptionalJson(manifestPath);
  if (!parsed) return undefined;
  if (!isRecord(parsed)) throw new Error('runtime codex browser acceptance manifest is invalid');
  assertRuntimeCodexBrowserAcceptanceManifest(parsed);
  const manifest = normalizeRuntimeCodexBrowserAcceptanceManifest(parsed);
  const currentEnvBlocked = currentServiceEnvBlockedManifest(manifest, options.env);
  if (currentEnvBlocked) return currentEnvBlocked;
  return {
    ...manifest,
    freshness: await runtimeCodexBrowserAcceptanceFreshness(manifest, options),
  };
}

export function runtimeCodexBrowserAcceptanceManifestPath(options: Pick<RuntimeCodexBrowserAcceptanceReadOptions, 'cwd' | 'env' | 'parallelProfileId'>) {
  if (options.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR?.trim()) {
    return join(resolve(options.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR), 'manifest.json');
  }
  return /^p[2-8]$/.test(options.parallelProfileId)
    ? join(options.cwd, 'docs', 'test-artifacts', 'parallel', options.parallelProfileId, 'manifest.json')
    : join(options.cwd, 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance', 'manifest.json');
}

function normalizeRuntimeCodexBrowserAcceptanceManifest(parsed: Record<string, unknown>) {
  return {
    schemaVersion: stringValue(parsed.schemaVersion),
    status: stringValue(parsed.status),
    source: stringValue(parsed.source),
    observedAt: stringValue(parsed.observedAt) || undefined,
    actualUrl: stringValue(parsed.actualUrl) || undefined,
    actualPort: typeof parsed.actualPort === 'number' ? parsed.actualPort : undefined,
    requestedRolePort: typeof parsed.requestedRolePort === 'number' ? parsed.requestedRolePort : undefined,
    actualWorkspaceWriterPort: typeof parsed.actualWorkspaceWriterPort === 'number' ? parsed.actualWorkspaceWriterPort : undefined,
    actualWorkspaceWriterUrl: stringValue(parsed.actualWorkspaceWriterUrl) || undefined,
    actualRuntimeCodexPort: typeof parsed.actualRuntimeCodexPort === 'number' ? parsed.actualRuntimeCodexPort : undefined,
    actualRuntimeCodexUrl: stringValue(parsed.actualRuntimeCodexUrl) || undefined,
    profile: stringValue(parsed.profile) || undefined,
    workspacePath: stringValue(parsed.workspacePath) || undefined,
    provider: stringValue(parsed.provider) || undefined,
    model: stringValue(parsed.model) || undefined,
    commandId: stringValue(parsed.commandId) || undefined,
    startedFromDefaultChatEntry: parsed.startedFromDefaultChatEntry === true,
    submittedThroughRuntimeCodex: parsed.submittedThroughRuntimeCodex === true,
    providerModelProfileVisible: parsed.providerModelProfileVisible === true,
    mainAnswerVisible: parsed.mainAnswerVisible === true,
    rawAuditFoldedByDefault: parsed.rawAuditFoldedByDefault === true,
    acceptanceConclusionFromRealBrowser: parsed.acceptanceConclusionFromRealBrowser === true,
    currentRunEvidenceScope: stringValue(parsed.currentRunEvidenceScope) || undefined,
    reason: stringValue(parsed.reason) || undefined,
    blocker: stringValue(parsed.blocker) || undefined,
    blockedOn: stringArray(parsed.blockedOn),
    failureClass: stringValue(parsed.failureClass) || undefined,
    owner: stringValue(parsed.owner) || undefined,
    policyViolations: stringArray(parsed.policyViolations),
    missingEnv: stringArray(parsed.missingEnv),
    expectedRetestCommand: stringValue(parsed.expectedRetestCommand) || undefined,
    releaseBlocking: parsed.releaseBlocking === true,
    releaseEligible: parsed.releaseEligible === true,
    providerPreflightRef: stringValue(parsed.providerPreflightRef) || undefined,
    providerPreflightCategory: stringValue(parsed.providerPreflightCategory) || undefined,
    providerPreflightCheckedAt: stringValue(parsed.providerPreflightCheckedAt) || undefined,
    providerPreflightReleaseAcceptance: stringValue(parsed.providerPreflightReleaseAcceptance) || undefined,
    providerPreflightEvidenceMode: stringValue(parsed.providerPreflightEvidenceMode) || undefined,
    runtimeApiKeyPresentInServiceEnv: parsed.runtimeApiKeyPresentInServiceEnv === true,
    upstreamBaseUrlPresent: parsed.upstreamBaseUrlPresent === true,
    upstreamKeySourceKind: stringValue(parsed.upstreamKeySourceKind) || undefined,
    upstreamBaseUrlSourceKind: stringValue(parsed.upstreamBaseUrlSourceKind) || undefined,
    configPathsChecked: stringArray(parsed.configPathsChecked),
    configSecretFallbackPaths: stringArray(parsed.configSecretFallbackPaths),
    nextActions: Array.isArray(parsed.nextActions)
      ? parsed.nextActions.filter(isRecord).map((action) => ({
        label: stringValue(action.label),
        command: stringValue(action.command) || undefined,
        expected: stringValue(action.expected) || undefined,
        writesRepo: action.writesRepo === true,
      })).filter((action) => action.label)
      : [],
    evidence: isRecord(parsed.evidence) ? {
      screenshotPath: stringValue(parsed.evidence.screenshotPath) || undefined,
      domSnapshotPath: stringValue(parsed.evidence.domSnapshotPath) || undefined,
      notesPath: stringValue(parsed.evidence.notesPath) || undefined,
      runtimeAuditPath: stringValue(parsed.evidence.runtimeAuditPath) || undefined,
    } : undefined,
  };
}

function assertRuntimeCodexBrowserAcceptanceManifest(parsed: Record<string, unknown>) {
  const schemaVersion = stringValue(parsed.schemaVersion);
  if (schemaVersion !== RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION) {
    throw new Error('runtime codex browser acceptance manifest has unsupported schemaVersion');
  }
  const source = stringValue(parsed.source);
  if (source !== RUNTIME_CODEX_BROWSER_ACCEPTANCE_SOURCE) {
    throw new Error('runtime codex browser acceptance manifest source must be codex-in-app-browser');
  }
  const status = stringValue(parsed.status);
  if (!RUNTIME_CODEX_BROWSER_ACCEPTANCE_STATUSES.has(status)) {
    throw new Error('runtime codex browser acceptance manifest status must be passed, blocked, failed, or partial');
  }
}

function currentServiceEnvBlockedManifest(
  manifest: RuntimeCodexBrowserAcceptanceManifest,
  env: NodeJS.ProcessEnv,
) {
  if (manifest.status !== 'passed') return undefined;
  if (env.SCIFORGE_RUNTIME_API_KEY?.trim()) return undefined;
  const reason = 'Runtime Codex service environment is missing SCIFORGE_RUNTIME_API_KEY; current workspace/UI route must remain blocked and cannot claim a Browser live pass from prior evidence.';
  const staleEvidenceRefs = [
    manifest.evidence?.screenshotPath,
    manifest.evidence?.domSnapshotPath,
    manifest.evidence?.runtimeAuditPath,
  ].filter((value): value is string => Boolean(value?.trim()));
  return {
    ...manifest,
    status: 'blocked',
    startedFromDefaultChatEntry: false,
    submittedThroughRuntimeCodex: false,
    providerModelProfileVisible: false,
    mainAnswerVisible: false,
    acceptanceConclusionFromRealBrowser: false,
    currentRunEvidenceScope: 'preflight-only',
    reason,
    blocker: reason,
    blockedOn: [
      'Runtime Codex service environment secret configuration',
      'current Codex in-app browser execution',
    ],
    failureClass: 'missing-runtime-env',
    owner: 'environment',
    missingEnv: uniqueStrings([...(manifest.missingEnv ?? []), 'SCIFORGE_RUNTIME_API_KEY']),
    releaseBlocking: true,
    releaseEligible: false,
    runtimeApiKeyPresentInServiceEnv: false,
    expectedRetestCommand: manifest.expectedRetestCommand || 'npm run smoke:runtime-codex-browser-acceptance',
    nextActions: [
      {
        label: 'Set SCIFORGE_RUNTIME_API_KEY in the service environment, then rerun Runtime Codex browser acceptance.',
        command: 'npm run smoke:runtime-codex-browser-acceptance',
        expected: 'Workspace/UI route reports a current live-browser passed manifest only after the service env is present.',
        writesRepo: false,
      },
      ...(manifest.nextActions ?? []),
    ],
    staleEvidenceRefs,
    evidence: manifest.evidence?.notesPath ? { notesPath: manifest.evidence.notesPath } : undefined,
  };
}

async function runtimeCodexBrowserAcceptanceFreshness(
  manifest: RuntimeCodexBrowserAcceptanceManifest,
  options: RuntimeCodexBrowserAcceptanceReadOptions,
) {
  if (manifest.status !== 'passed') return undefined;
  const observedAtMs = manifest.observedAt ? Date.parse(manifest.observedAt) : Number.NaN;
  const maxAgeMinutes = Number.parseFloat(options.env.SCIFORGE_BROWSER_ACCEPTANCE_MAX_AGE_MINUTES || '30');
  const mtimeToleranceMinutes = Number.parseFloat(options.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_MTIME_TOLERANCE_MINUTES || '10');
  const maxAgeMs = (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 ? maxAgeMinutes : 30) * 60 * 1000;
  const mtimeToleranceMs = (Number.isFinite(mtimeToleranceMinutes) && mtimeToleranceMinutes >= 0 ? mtimeToleranceMinutes : 10) * 60 * 1000;
  const nowMs = options.nowMs?.() ?? Date.now();
  const observedAtFresh = Number.isFinite(observedAtMs)
    && observedAtMs <= nowMs + 5 * 60 * 1000
    && observedAtMs >= nowMs - maxAgeMs;
  const evidencePaths = [
    manifest.evidence?.screenshotPath,
    manifest.evidence?.domSnapshotPath,
    manifest.evidence?.notesPath,
    manifest.evidence?.runtimeAuditPath,
  ].filter((value): value is string => Boolean(value?.trim()));
  const staleEvidenceRefs: string[] = [];
  const statFile = options.statFile ?? stat;
  for (const evidencePath of evidencePaths) {
    const resolved = resolve(options.cwd, evidencePath);
    try {
      const info = await statFile(resolved);
      if (!info.isFile() || !Number.isFinite(observedAtMs) || info.mtimeMs < observedAtMs - mtimeToleranceMs) {
        staleEvidenceRefs.push(evidencePath);
      }
    } catch {
      staleEvidenceRefs.push(evidencePath);
    }
  }
  const evidenceFresh = evidencePaths.length > 0 && staleEvidenceRefs.length === 0;
  return {
    checkedAt: options.nowIso?.() ?? new Date().toISOString(),
    observedAtFresh,
    evidenceFresh,
    staleEvidenceRefs,
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
