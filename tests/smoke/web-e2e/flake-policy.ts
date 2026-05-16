import { relative } from 'node:path';

import type {
  BrowserInstrumentationSnapshot,
  BrowserScreenshotEvidence,
  JsonValue,
  WebE2eCaseId,
} from './types.js';

export type WebE2eContractFailure = {
  contractId: string;
  message: string;
  path?: string;
  severity?: 'error' | 'warning';
  expected?: JsonValue;
  actual?: JsonValue;
  observedAt?: string;
};

export type WebE2eCaseManifestReference = {
  path: string;
  digest?: string;
  data?: JsonValue;
};

export type WebE2eCaseAttemptStatus = 'passed' | 'failed';

export type WebE2eCaseAttempt = {
  caseId: WebE2eCaseId;
  attempt: number;
  status: WebE2eCaseAttemptStatus;
  seed?: string;
  caseManifest?: WebE2eCaseManifestReference;
  instrumentation?: BrowserInstrumentationSnapshot;
  screenshots?: BrowserScreenshotEvidence[];
  contractFailures?: WebE2eContractFailure[];
  contextDigest?: string;
  projectionDigest?: string;
};

export type WebE2eFlakePolicyOptions = {
  cwd?: string;
  runnerCommand?: string;
  caseFlag?: string;
  seedFlag?: string;
  noRetryFlag?: string;
};

export type WebE2eMinimalReproCommandInput = {
  caseId: WebE2eCaseId;
  seed?: string;
} & WebE2eFlakePolicyOptions;

export type WebE2eFlakeFailureReport = {
  schemaVersion: 'sciforge.web-e2e.flake-policy-report.v1';
  caseId: WebE2eCaseId;
  attempt: number;
  minimalReproCommand: string;
  caseManifest: {
    path: string;
    digest?: string;
  };
  lastScreenshot: {
    id: string;
    path: string;
    timestamp: string;
  };
  firstFailedContract: WebE2eContractFailure;
  contextDigest?: string;
  projectionDigest?: string;
};

export type WebE2eFlakePolicyEvaluation = {
  reports: WebE2eFlakeFailureReport[];
  driftViolations: WebE2eContextDriftViolation[];
};

export type WebE2eContextDriftViolation = {
  caseId: WebE2eCaseId;
  previousAttempt: number;
  currentAttempt: number;
  previousContextDigest?: string;
  currentContextDigest?: string;
  previousProjectionDigest?: string;
  currentProjectionDigest?: string;
};

export class WebE2eFlakePolicyError extends Error {
  readonly evaluation: WebE2eFlakePolicyEvaluation;

  constructor(message: string, evaluation: WebE2eFlakePolicyEvaluation) {
    super(message);
    this.name = 'WebE2eFlakePolicyError';
    this.evaluation = evaluation;
  }
}

const defaultRunnerCommand = 'npm run smoke:web-multiturn-final --';
const defaultCaseFlag = '--case';
const defaultSeedFlag = '--seed';
const defaultNoRetryFlag = '--no-retry';

export function buildWebE2eMinimalReproCommand(input: WebE2eMinimalReproCommandInput): string {
  const runnerCommand = input.runnerCommand ?? defaultRunnerCommand;
  const parts = [
    ...splitCommand(runnerCommand),
    input.caseFlag ?? defaultCaseFlag,
    input.caseId,
    input.noRetryFlag ?? defaultNoRetryFlag,
  ];
  if (input.seed) {
    parts.push(input.seedFlag ?? defaultSeedFlag, input.seed);
  }
  return parts.map(shellQuote).join(' ');
}

export function evaluateWebE2eFlakePolicy(
  attempts: readonly WebE2eCaseAttempt[],
  options: WebE2eFlakePolicyOptions = {},
): WebE2eFlakePolicyEvaluation {
  const sortedAttempts = [...attempts].sort((a, b) => {
    const caseOrder = a.caseId.localeCompare(b.caseId);
    return caseOrder || a.attempt - b.attempt;
  });

  const reports = sortedAttempts
    .filter((attempt) => attempt.status === 'failed')
    .map((attempt) => createWebE2eFlakeFailureReport(attempt, options));

  return {
    reports,
    driftViolations: findContextDriftViolations(sortedAttempts),
  };
}

export function enforceWebE2eFlakePolicy(
  attempts: readonly WebE2eCaseAttempt[],
  options: WebE2eFlakePolicyOptions = {},
): WebE2eFlakePolicyEvaluation {
  const evaluation = evaluateWebE2eFlakePolicy(attempts, options);
  if (evaluation.driftViolations.length) {
    throw new WebE2eFlakePolicyError(formatContextDriftMessage(evaluation), evaluation);
  }
  return evaluation;
}

export function createWebE2eFlakeFailureReport(
  attempt: WebE2eCaseAttempt,
  options: WebE2eFlakePolicyOptions = {},
): WebE2eFlakeFailureReport {
  if (attempt.status !== 'failed') {
    throw new Error(`SA-WEB-26 flake policy only reports failed attempts; ${attempt.caseId} attempt ${attempt.attempt} was ${attempt.status}`);
  }

  const caseManifest = attempt.caseManifest;
  if (!caseManifest?.path) {
    throw new Error(`SA-WEB-26 requires failed case ${attempt.caseId} attempt ${attempt.attempt} to include a case manifest path`);
  }

  const lastScreenshot = findLastScreenshot(attempt);
  if (!lastScreenshot) {
    throw new Error(`SA-WEB-26 requires failed case ${attempt.caseId} attempt ${attempt.attempt} to include the last screenshot`);
  }

  const firstFailedContract = attempt.contractFailures?.find((failure) => failure.severity !== 'warning');
  if (!firstFailedContract) {
    throw new Error(`SA-WEB-26 requires failed case ${attempt.caseId} attempt ${attempt.attempt} to include the first failed contract`);
  }

  return {
    schemaVersion: 'sciforge.web-e2e.flake-policy-report.v1',
    caseId: attempt.caseId,
    attempt: attempt.attempt,
    minimalReproCommand: buildWebE2eMinimalReproCommand({
      ...options,
      caseId: attempt.caseId,
      seed: attempt.seed,
    }),
    caseManifest: {
      path: displayPath(caseManifest.path, options.cwd),
      digest: caseManifest.digest,
    },
    lastScreenshot: {
      id: lastScreenshot.id,
      path: displayPath(lastScreenshot.path, options.cwd),
      timestamp: lastScreenshot.timestamp,
    },
    firstFailedContract,
    contextDigest: attempt.contextDigest,
    projectionDigest: attempt.projectionDigest,
  };
}

export function formatWebE2eFlakePolicyReport(report: WebE2eFlakeFailureReport): string {
  return [
    `Web E2E case failed: ${report.caseId} attempt ${report.attempt}`,
    `minimal repro: ${report.minimalReproCommand}`,
    `case manifest: ${withDigest(report.caseManifest.path, report.caseManifest.digest)}`,
    `last screenshot: ${report.lastScreenshot.path}`,
    `first failed contract: ${report.firstFailedContract.contractId} - ${report.firstFailedContract.message}`,
  ].join('\n');
}

function findContextDriftViolations(attempts: readonly WebE2eCaseAttempt[]): WebE2eContextDriftViolation[] {
  const violations: WebE2eContextDriftViolation[] = [];
  const previousByCase = new Map<WebE2eCaseId, WebE2eCaseAttempt>();
  for (const attempt of attempts) {
    const previous = previousByCase.get(attempt.caseId);
    if (previous && hasDigestDrift(previous, attempt)) {
      violations.push({
        caseId: attempt.caseId,
        previousAttempt: previous.attempt,
        currentAttempt: attempt.attempt,
        previousContextDigest: previous.contextDigest,
        currentContextDigest: attempt.contextDigest,
        previousProjectionDigest: previous.projectionDigest,
        currentProjectionDigest: attempt.projectionDigest,
      });
    }
    previousByCase.set(attempt.caseId, attempt);
  }
  return violations;
}

function hasDigestDrift(previous: WebE2eCaseAttempt, current: WebE2eCaseAttempt): boolean {
  return !previous.contextDigest || !current.contextDigest || previous.contextDigest !== current.contextDigest || Boolean(
    previous.projectionDigest
      && current.projectionDigest
      && previous.projectionDigest !== current.projectionDigest,
  );
}

function findLastScreenshot(attempt: WebE2eCaseAttempt): BrowserScreenshotEvidence | undefined {
  const screenshots = [
    ...(attempt.screenshots ?? []),
    ...(attempt.instrumentation?.evidence.filter((item): item is BrowserScreenshotEvidence => item.kind === 'screenshot') ?? []),
  ];
  return screenshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1);
}

function formatContextDriftMessage(evaluation: WebE2eFlakePolicyEvaluation): string {
  const details = evaluation.driftViolations.map((violation) => {
    const context = violation.previousContextDigest && violation.currentContextDigest && violation.previousContextDigest === violation.currentContextDigest
      ? undefined
      : `context ${violation.previousContextDigest ?? '<missing>'} -> ${violation.currentContextDigest ?? '<missing>'}`;
    const projection = violation.previousProjectionDigest === violation.currentProjectionDigest
      ? undefined
      : `projection ${violation.previousProjectionDigest ?? '<missing>'} -> ${violation.currentProjectionDigest ?? '<missing>'}`;
    return `${violation.caseId} attempts ${violation.previousAttempt}->${violation.currentAttempt}: ${[context, projection].filter(Boolean).join(', ')}`;
  });
  return [
    'SA-WEB-26 forbids retry from masking nondeterministic context drift.',
    ...details,
    ...evaluation.reports.map(formatWebE2eFlakePolicyReport),
  ].join('\n');
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function displayPath(path: string, cwd: string | undefined): string {
  if (!cwd) return path;
  const relPath = relative(cwd, path);
  return relPath && !relPath.startsWith('..') ? relPath : path;
}

function withDigest(path: string, digest: string | undefined): string {
  return digest ? `${path} (${digest})` : path;
}
