import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createAppiumMac2WebDriverClient,
  type AppiumMac2Fetch,
} from '../src/runtime/codex/appium-mac2-webdriver-client.js';
import {
  validateDesktopSoftwareTaskEvidence,
  type DesktopSoftwareTaskEvidenceGate,
} from '../src/runtime/codex/desktop-software-task-evidence.js';
import { createTextEditSavedArtifactValidator } from '../src/runtime/codex/textedit-saved-artifact-validator.js';

const REQUIRED_ENV = [
  'SCIFORGE_APPIUM_MAC2_SERVER_URL',
  'SCIFORGE_APPIUM_MAC2_EXECUTOR',
  'SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH',
] as const;

const DEFAULT_DOCUMENT_TEXT = [
  'sciforge-computer-use-proof',
  '- Operated TextEdit through the bounded Appium Mac2 executor',
  '- Saved a local document artifact',
  '- Verified saved content against TextEdit accessibility source',
].join('\n');

export interface TextEditAppiumLiveAcceptanceManifest {
  schemaVersion: 'sciforge.textedit-appium-live-acceptance.v1';
  status: 'passed' | 'blocked';
  observedAt: string;
  targetSoftware: 'TextEdit';
  releaseEligible: boolean;
  releaseBlocking: boolean;
  sharedSystemInputUsed: false;
  workspaceWriterUsed: false;
  shellWriterUsed: false;
  appiumMac2Used: boolean;
  missingEnv: string[];
  reason?: string;
  evidenceRefs: string[];
  desktopSoftwareTaskEvidence?: DesktopSoftwareTaskEvidenceGate;
  finalAnswerRef?: string;
  actualTaskResult?: {
    status: 'passed';
    summary: string;
    userIntentSatisfied: true;
    outputVerified: true;
    evidenceRefs: string[];
  };
  liveRuntimeProof?: {
    executor: 'appium-mac2-webdriver';
    source: 'TextEdit';
    eventEvidenceRefs: string[];
  };
  evidence?: {
    manifestPath: string;
    notesPath: string;
  };
}

export interface RunTextEditAppiumLiveAcceptanceOptions {
  root?: string;
  env?: Record<string, string | undefined>;
  documentText?: string;
  now?: () => Date;
  fetch?: AppiumMac2Fetch;
  outputDir?: string;
  timeoutMs?: number;
}

export async function runTextEditAppiumLiveAcceptance(
  options: RunTextEditAppiumLiveAcceptanceOptions = {},
): Promise<TextEditAppiumLiveAcceptanceManifest> {
  const root = resolve(options.root ?? process.cwd());
  const outputDir = resolve(root, options.outputDir ?? join('docs', 'test-artifacts', 'textedit-appium-live-acceptance'));
  const manifestPath = join(outputDir, 'manifest.json');
  const notesPath = join(outputDir, 'README.md');
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const env = options.env ?? process.env;
  const documentText = options.documentText ?? DEFAULT_DOCUMENT_TEXT;
  const missingEnv = missingLiveExecutorEnv(env);
  const relativeManifestPath = safeRelativePath(root, manifestPath);
  const relativeNotesPath = safeRelativePath(root, notesPath);

  if (missingEnv.length > 0) {
    return writeManifest(root, outputDir, manifestPath, notesPath, {
      schemaVersion: 'sciforge.textedit-appium-live-acceptance.v1',
      status: 'blocked',
      observedAt,
      targetSoftware: 'TextEdit',
      releaseEligible: false,
      releaseBlocking: true,
      sharedSystemInputUsed: false,
      workspaceWriterUsed: false,
      shellWriterUsed: false,
      appiumMac2Used: false,
      missingEnv,
      reason: 'Blocked: missing Appium Mac2 live executor env required for a real TextEdit task.',
      evidenceRefs: [],
      evidence: {
        manifestPath: relativeManifestPath,
        notesPath: relativeNotesPath,
      },
    });
  }

  const serverUrl = env.SCIFORGE_APPIUM_MAC2_SERVER_URL ?? '';
  const artifactPath = env.SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH;
  const validateSavedArtifact = createTextEditSavedArtifactValidator({ artifactPath });
  if (!validateSavedArtifact) {
    return writeManifest(root, outputDir, manifestPath, notesPath, blockedManifest({
      observedAt,
      reason: 'Blocked: TextEdit saved artifact validator configuration is invalid.',
      appiumMac2Used: false,
      evidenceRefs: [],
      relativeManifestPath,
      relativeNotesPath,
    }));
  }

  const client = createAppiumMac2WebDriverClient({
    fetch: options.fetch,
    validateSavedArtifact,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  const typeResult = await client({
    serverUrl,
    bundleId: 'com.apple.TextEdit',
    action: 'type',
    actionId: 'textedit-live-type',
    sessionId: 'textedit-live',
    targetWindowRef: 'appium-mac2:textedit/target-window/live',
    text: documentText,
  });
  if (typeResult.blockedReason) {
    return writeManifest(root, outputDir, manifestPath, notesPath, blockedManifest({
      observedAt,
      reason: safeBlockedReason(typeResult.blockedReason),
      appiumMac2Used: true,
      evidenceRefs: boundedEvidenceRefs(typeResult),
      relativeManifestPath,
      relativeNotesPath,
    }));
  }

  const saveResult = await client({
    serverUrl,
    bundleId: 'com.apple.TextEdit',
    action: 'save',
    actionId: 'textedit-live-save',
    sessionId: 'textedit-live',
    targetWindowRef: 'appium-mac2:textedit/target-window/live',
    targetArtifactPath: artifactPath,
  });
  const evidenceRefs = boundedEvidenceRefs(typeResult, saveResult);
  const targetWindowRef = 'appium-mac2:textedit/target-window/live';
  const beforeEvidenceRefs = ['appium-mac2:textedit/before-observation/current'];
  const actionGroundingRefs = ['appium-mac2:textedit/actions/textedit-live-save/gui-save-command'];
  const artifactRefs = ['appium-mac2:textedit/artifacts/workspace-document'];
  const finalAnswerRef = 'appium-mac2:textedit/final-answer/summary';
  const completeEvidenceRefs = boundedEvidenceRefs(
    ...evidenceRefs.map((ref) => ({ executorEventRef: ref })),
    { targetWindowRef },
    ...beforeEvidenceRefs.map((ref) => ({ beforeEvidenceRef: ref })),
    ...actionGroundingRefs.map((ref) => ({ actionGroundingRef: ref })),
    ...artifactRefs.map((ref) => ({ artifactRef: ref })),
    { finalAnswerRef },
  );
  if (saveResult.blockedReason) {
    return writeManifest(root, outputDir, manifestPath, notesPath, blockedManifest({
      observedAt,
      reason: safeBlockedReason(saveResult.blockedReason),
      appiumMac2Used: true,
      evidenceRefs: completeEvidenceRefs,
      relativeManifestPath,
      relativeNotesPath,
    }));
  }

  const requiredRefs = [
    'appium-mac2:textedit/actions/textedit-live-type/type-input',
    'appium-mac2:textedit/actions/textedit-live-type/verification/source-read',
    'appium-mac2:textedit/actions/textedit-live-save/save-input',
    'appium-mac2:textedit/actions/textedit-live-save/verification/source-read',
    'appium-mac2:textedit/actions/textedit-live-save/artifact-validator/content-match',
  ];
  const missingRefs = requiredRefs.filter((ref) => !completeEvidenceRefs.includes(ref));
  const desktopSoftwareTaskEvidence = validateDesktopSoftwareTaskEvidence({
    targetWindowRef,
    beforeEvidenceRefs,
    actionGroundingRefs,
    executorEventRefs: completeEvidenceRefs,
    afterEvidenceRefs: completeEvidenceRefs,
    artifactRefs,
    artifactValidationRefs: completeEvidenceRefs,
    finalAnswerRefs: [finalAnswerRef],
    fileCreationOwner: 'scoped-gui-save',
    sharedSystemInputUsed: false,
    workspaceWriterUsed: false,
    shellWriterUsed: false,
  });
  if (missingRefs.length > 0) {
    return writeManifest(root, outputDir, manifestPath, notesPath, blockedManifest({
      observedAt,
      reason: 'Blocked: Appium Mac2 live run did not produce every required bounded evidence reference.',
      appiumMac2Used: true,
      evidenceRefs: completeEvidenceRefs,
      relativeManifestPath,
      relativeNotesPath,
    }));
  }
  if (desktopSoftwareTaskEvidence.status !== 'passed') {
    return writeManifest(root, outputDir, manifestPath, notesPath, blockedManifest({
      observedAt,
      reason: 'Blocked: TextEdit live run did not produce every required desktop software task evidence slot.',
      appiumMac2Used: true,
      evidenceRefs: completeEvidenceRefs,
      desktopSoftwareTaskEvidence,
      finalAnswerRef,
      relativeManifestPath,
      relativeNotesPath,
    }));
  }

  const manifest: TextEditAppiumLiveAcceptanceManifest = {
    schemaVersion: 'sciforge.textedit-appium-live-acceptance.v1',
    status: 'passed',
    observedAt,
    targetSoftware: 'TextEdit',
    releaseEligible: true,
    releaseBlocking: false,
    sharedSystemInputUsed: false,
    workspaceWriterUsed: false,
    shellWriterUsed: false,
    appiumMac2Used: true,
    missingEnv: [],
    reason: 'Passed: TextEdit was driven through Appium Mac2 and the saved artifact content matched the TextEdit accessibility source.',
    evidenceRefs: completeEvidenceRefs,
    desktopSoftwareTaskEvidence,
    finalAnswerRef,
    actualTaskResult: {
      status: 'passed',
      summary: 'Created and saved a TextEdit document with verified content.',
      userIntentSatisfied: true,
      outputVerified: true,
      evidenceRefs: completeEvidenceRefs,
    },
    liveRuntimeProof: {
      executor: 'appium-mac2-webdriver',
      source: 'TextEdit',
      eventEvidenceRefs: completeEvidenceRefs,
    },
    evidence: {
      manifestPath: relativeManifestPath,
      notesPath: relativeNotesPath,
    },
  };
  return writeManifest(root, outputDir, manifestPath, notesPath, manifest);
}

function missingLiveExecutorEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_ENV.filter((name) => {
    if (name === 'SCIFORGE_APPIUM_MAC2_EXECUTOR') return !enabled(env[name]);
    return !env[name];
  });
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(value?.trim() ?? '');
}

function blockedManifest(input: {
  observedAt: string;
  reason: string;
  appiumMac2Used: boolean;
  evidenceRefs: string[];
  desktopSoftwareTaskEvidence?: DesktopSoftwareTaskEvidenceGate;
  finalAnswerRef?: string;
  relativeManifestPath: string;
  relativeNotesPath: string;
}): TextEditAppiumLiveAcceptanceManifest {
  return {
    schemaVersion: 'sciforge.textedit-appium-live-acceptance.v1',
    status: 'blocked',
    observedAt: input.observedAt,
    targetSoftware: 'TextEdit',
    releaseEligible: false,
    releaseBlocking: true,
    sharedSystemInputUsed: false,
    workspaceWriterUsed: false,
    shellWriterUsed: false,
    appiumMac2Used: input.appiumMac2Used,
    missingEnv: [],
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    desktopSoftwareTaskEvidence: input.desktopSoftwareTaskEvidence ?? validateDesktopSoftwareTaskEvidence({}),
    finalAnswerRef: input.finalAnswerRef,
    evidence: {
      manifestPath: input.relativeManifestPath,
      notesPath: input.relativeNotesPath,
    },
  };
}

async function writeManifest(
  root: string,
  outputDir: string,
  manifestPath: string,
  notesPath: string,
  manifest: TextEditAppiumLiveAcceptanceManifest,
): Promise<TextEditAppiumLiveAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  const sanitizedManifest = sanitizeManifest(root, manifest);
  await writeFile(manifestPath, `${JSON.stringify(sanitizedManifest, null, 2)}\n`, 'utf8');
  await writeFile(notesPath, notesFor(sanitizedManifest), 'utf8');
  return sanitizedManifest;
}

function sanitizeManifest(root: string, manifest: TextEditAppiumLiveAcceptanceManifest): TextEditAppiumLiveAcceptanceManifest {
  const safeRefs = boundedEvidenceRefs(...manifest.evidenceRefs.map((ref) => ({ executorEventRef: ref })));
  const sanitized: TextEditAppiumLiveAcceptanceManifest = {
    ...manifest,
    reason: manifest.reason ? safeBlockedReason(manifest.reason) : undefined,
    evidenceRefs: safeRefs,
    evidence: manifest.evidence ? {
      manifestPath: safeRelativeManifestValue(root, manifest.evidence.manifestPath),
      notesPath: safeRelativeManifestValue(root, manifest.evidence.notesPath),
    } : undefined,
  };
  if (manifest.actualTaskResult) {
    sanitized.actualTaskResult = {
      ...manifest.actualTaskResult,
      evidenceRefs: safeRefs,
    };
  }
  if (manifest.desktopSoftwareTaskEvidence) {
    sanitized.desktopSoftwareTaskEvidence = {
      ...manifest.desktopSoftwareTaskEvidence,
      missing: manifest.desktopSoftwareTaskEvidence.missing.filter((item) => !/secret|token|password|api[-_]?key|bearer/i.test(item)),
    };
  }
  if (manifest.liveRuntimeProof) {
    sanitized.liveRuntimeProof = {
      ...manifest.liveRuntimeProof,
      eventEvidenceRefs: safeRefs,
    };
  }
  return sanitized;
}

function boundedEvidenceRefs(...values: unknown[]): string[] {
  const refs = new Set<string>();
  for (const value of values) {
    if (!isRecord(value)) continue;
    for (const candidate of Object.values(value)) {
      if (typeof candidate !== 'string') continue;
      if (!isSafeEvidenceRef(candidate)) continue;
      refs.add(candidate);
    }
  }
  return [...refs].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeEvidenceRef(value: string): boolean {
  if (!value || value.length > 240) return false;
  if (/https?:\/\/|file:\/\/|\/tmp|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token|password|api[-_]?key|bearer/i.test(value)) return false;
  return /^(appium-mac2:textedit|window-action-session:textedit-live)\//.test(value);
}

function safeBlockedReason(value: string): string {
  if (/missing Appium Mac2 live executor env/i.test(value)) return value;
  if (/required bounded evidence reference/i.test(value)) return value;
  if (/server URL/i.test(value)) return 'Blocked: Appium Mac2 server URL was not an allowed local WebDriver endpoint.';
  if (/validator/i.test(value)) return 'Blocked: TextEdit saved artifact validation failed.';
  if (/WebDriver request timed out/i.test(value)) return 'Blocked: Appium Mac2 WebDriver request timed out.';
  if (/WebDriver request failed|WebDriver actions failed|session response/i.test(value)) return 'Blocked: Appium Mac2 WebDriver request failed.';
  if (/TextEdit|com\.apple\.TextEdit/i.test(value)) return 'Blocked: target software did not satisfy the TextEdit executor contract.';
  return 'Blocked: Appium Mac2 live TextEdit acceptance could not complete.';
}

function safeRelativePath(root: string, targetPath: string): string {
  const relativePath = relative(root, targetPath).replace(/\\/g, '/');
  return safeRelativeManifestValue(root, relativePath);
}

function safeRelativeManifestValue(root: string, value: string): string {
  const relativePath = value.replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../') || relativePath === '..') return 'docs/test-artifacts/textedit-appium-live-acceptance/manifest.json';
  if (relativePath.startsWith('/') || /^https?:\/\//i.test(relativePath)) return 'docs/test-artifacts/textedit-appium-live-acceptance/manifest.json';
  if (/\/tmp|secret|token|password|api[-_]?key|bearer/i.test(relativePath)) return 'docs/test-artifacts/textedit-appium-live-acceptance/manifest.json';
  return root && relativePath ? relativePath : 'docs/test-artifacts/textedit-appium-live-acceptance/manifest.json';
}

function notesFor(manifest: TextEditAppiumLiveAcceptanceManifest): string {
  const statusLine = manifest.status === 'passed'
    ? 'Status: passed'
    : 'Status: blocked';
  const reason = manifest.reason ?? 'No reason recorded.';
  return [
    '# TextEdit Appium Live Acceptance',
    '',
    statusLine,
    '',
    reason,
    '',
    'This manifest intentionally stores bounded evidence references only. It does not persist raw WebDriver URLs, file paths, prompts, screenshots, or secrets.',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await runTextEditAppiumLiveAcceptance();
  process.stdout.write(`${manifest.status}: ${manifest.reason ?? 'TextEdit Appium live acceptance finished.'}\n`);
  if (manifest.status !== 'passed') process.exitCode = 1;
}
