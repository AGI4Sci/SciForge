import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type {
  BrowserInstrumentationEvent,
  BrowserInstrumentationSnapshot,
  BrowserScreenshotEvidence,
  JsonRecord,
  WebE2eCaseId,
} from './types.js';

export type WebE2eEvidenceNoteStatus = 'passed' | 'failed' | 'improvement-needed';

export type WebE2eEvidenceNote = {
  status: WebE2eEvidenceNoteStatus;
  summary: string;
  failureReason?: string;
  improvement?: string;
};

export type WebE2eRunEvidence = {
  runId: string;
  eventIds: string[];
  requestDigest?: string;
  resultDigest?: string;
  status?: string;
};

export type WebE2eProjectionEvidence = {
  projectionVersion: string;
  projectionDigest?: string;
  terminalState?: string;
};

export type WebE2eEvidenceBundleInput = {
  caseId: WebE2eCaseId;
  generatedAt?: string;
  artifactRoot?: string;
  outputRoot?: string;
  runs: WebE2eRunEvidence[];
  projection: WebE2eProjectionEvidence;
  browser?: BrowserInstrumentationSnapshot;
  note: WebE2eEvidenceNote;
  extra?: JsonRecord;
};

export type WebE2eScreenshotSummary = {
  id: string;
  path: string;
  relativePath?: string;
  fullPage: boolean;
  timestamp: string;
  pageLabel?: string;
  viewport?: {
    width: number;
    height: number;
  } | null;
};

export type WebE2eConsoleLogSummary = {
  severity: 'warning' | 'error';
  type: string;
  text: string;
  timestamp: string;
  pageLabel?: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

export type WebE2eNetworkSummary = {
  kind: 'requestfailed' | 'response';
  severity: 'error';
  url: string;
  method: string;
  resourceType: string;
  timestamp: string;
  pageLabel?: string;
  errorText?: string;
  status?: number;
  statusText?: string;
};

export type WebE2eEvidenceBundleManifest = {
  schemaVersion: 'sciforge.web-e2e.evidence-bundle.v1';
  caseId: WebE2eCaseId;
  generatedAt: string;
  manifestPath: string;
  runIds: string[];
  eventIds: string[];
  projectionVersion: string;
  projection: WebE2eProjectionEvidence;
  runs: WebE2eRunEvidence[];
  screenshots: WebE2eScreenshotSummary[];
  consoleLogs: WebE2eConsoleLogSummary[];
  networkSummaries: WebE2eNetworkSummary[];
  instrumentation?: {
    capturedAt: string;
    counts: BrowserInstrumentationSnapshot['counts'];
    hasFailures: boolean;
  };
  note: WebE2eEvidenceNote;
  extra?: JsonRecord;
};

export type WriteWebE2eEvidenceBundleResult = {
  manifest: WebE2eEvidenceBundleManifest;
  manifestPath: string;
};

const defaultOutputRoot = join(process.cwd(), 'docs', 'test-artifacts', 'web-e2e');

export async function writeWebE2eEvidenceBundle(
  input: WebE2eEvidenceBundleInput,
): Promise<WriteWebE2eEvidenceBundleResult> {
  const caseDir = join(input.outputRoot ?? defaultOutputRoot, sanitizeCaseId(input.caseId));
  const manifestPath = join(caseDir, 'manifest.json');
  const manifest = createWebE2eEvidenceBundleManifest(input, manifestPath);
  await mkdir(caseDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestPath };
}

export function createWebE2eEvidenceBundleManifest(
  input: WebE2eEvidenceBundleInput,
  manifestPath = join(input.outputRoot ?? defaultOutputRoot, sanitizeCaseId(input.caseId), 'manifest.json'),
): WebE2eEvidenceBundleManifest {
  validateEvidenceInput(input);
  const browser = input.browser;
  const screenshots = browser ? summarizeScreenshots(browser, input.artifactRoot) : [];
  const consoleLogs = browser ? summarizeConsoleLogs(browser.events) : [];
  const networkSummaries = browser ? summarizeNetwork(browser.events) : [];
  const runIds = unique(input.runs.map((run) => run.runId));
  const eventIds = unique(input.runs.flatMap((run) => run.eventIds));

  return withoutUndefined({
    schemaVersion: 'sciforge.web-e2e.evidence-bundle.v1',
    caseId: input.caseId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    manifestPath,
    runIds,
    eventIds,
    projectionVersion: input.projection.projectionVersion,
    projection: input.projection,
    runs: input.runs.map((run) => ({
      ...run,
      eventIds: unique(run.eventIds),
    })),
    screenshots,
    consoleLogs,
    networkSummaries,
    instrumentation: browser
      ? {
        capturedAt: browser.capturedAt,
        counts: browser.counts,
        hasFailures: browser.hasFailures,
      }
      : undefined,
    note: input.note,
    extra: input.extra,
  });
}

export function summarizeScreenshots(
  snapshot: BrowserInstrumentationSnapshot,
  artifactRoot?: string,
): WebE2eScreenshotSummary[] {
  return snapshot.evidence
    .filter((item): item is BrowserScreenshotEvidence => item.kind === 'screenshot')
    .map((screenshot) => ({
      id: screenshot.id,
      path: screenshot.path,
      relativePath: artifactRoot ? relative(artifactRoot, screenshot.path) : undefined,
      fullPage: screenshot.fullPage,
      timestamp: screenshot.timestamp,
      pageLabel: screenshot.pageLabel,
      viewport: screenshot.viewport,
    }));
}

export function summarizeConsoleLogs(
  events: readonly BrowserInstrumentationEvent[],
): WebE2eConsoleLogSummary[] {
  return events.filter((event) => event.kind === 'console').map((event) => ({
    severity: event.severity,
    type: event.type,
    text: event.text,
    timestamp: event.timestamp,
    pageLabel: event.pageLabel,
    location: event.location,
  }));
}

export function summarizeNetwork(
  events: readonly BrowserInstrumentationEvent[],
): WebE2eNetworkSummary[] {
  return events.flatMap<WebE2eNetworkSummary>((event) => {
    if (event.kind === 'requestfailed') {
      return [{
        kind: event.kind,
        severity: event.severity,
        url: event.url,
        method: event.method,
        resourceType: event.resourceType,
        errorText: event.errorText,
        timestamp: event.timestamp,
        pageLabel: event.pageLabel,
      }];
    }
    if (event.kind === 'response') {
      return [{
        kind: event.kind,
        severity: event.severity,
        url: event.url,
        method: event.method,
        resourceType: event.resourceType,
        status: event.status,
        statusText: event.statusText,
        timestamp: event.timestamp,
        pageLabel: event.pageLabel,
      }];
    }
    return [];
  });
}

function validateEvidenceInput(input: WebE2eEvidenceBundleInput): void {
  if (!input.caseId.trim()) {
    throw new Error('web e2e evidence bundle requires a caseId');
  }
  if (input.runs.length === 0) {
    throw new Error(`web e2e evidence bundle ${input.caseId} requires at least one run id`);
  }
  if (input.runs.some((run) => !run.runId.trim())) {
    throw new Error(`web e2e evidence bundle ${input.caseId} contains an empty run id`);
  }
  if (input.runs.every((run) => run.eventIds.length === 0)) {
    throw new Error(`web e2e evidence bundle ${input.caseId} requires event ids`);
  }
  if (!input.projection.projectionVersion.trim()) {
    throw new Error(`web e2e evidence bundle ${input.caseId} requires projectionVersion`);
  }
  if (!input.note.summary.trim()) {
    throw new Error(`web e2e evidence bundle ${input.caseId} requires a failure/improvement note summary`);
  }
  if (input.note.status === 'failed' && !input.note.failureReason?.trim()) {
    throw new Error(`web e2e evidence bundle ${input.caseId} failed note requires failureReason`);
  }
  if (input.note.status === 'improvement-needed' && !input.note.improvement?.trim()) {
    throw new Error(`web e2e evidence bundle ${input.caseId} improvement note requires improvement`);
  }
}

function sanitizeCaseId(caseId: string): string {
  return caseId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-case';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
