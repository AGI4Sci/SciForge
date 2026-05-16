import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type {
  ConsoleMessage,
  Download,
  Page,
  Request,
  Response,
} from 'playwright-core';

import type {
  BrowserConsoleEvent,
  BrowserDomSnapshotEvidence,
  BrowserDownloadEvidence,
  BrowserInstrumentationCounts,
  BrowserInstrumentationEvent,
  BrowserInstrumentationEvidence,
  BrowserInstrumentationSnapshot,
  BrowserPageErrorEvent,
  BrowserRequestFailedEvent,
  BrowserResponseFailureEvent,
  BrowserScreenshotEvidence,
} from './types';

export type BrowserInstrumentationOptions = {
  label?: string;
  artifactDir?: string;
  screenshotDir?: string;
  domSnapshotDir?: string;
  downloadDir?: string;
  maxConsoleTextLength?: number;
  maxDomSnapshotBytes?: number;
  echoToConsole?: boolean;
};

export type CaptureScreenshotOptions = {
  id?: string;
  path?: string;
  fullPage?: boolean;
};

export type CaptureDomSnapshotOptions = {
  id?: string;
  path?: string;
  maxBytes?: number;
};

export type BrowserInstrumentationController = {
  page: Page;
  events: readonly BrowserInstrumentationEvent[];
  evidence: readonly BrowserInstrumentationEvidence[];
  captureScreenshot(options?: CaptureScreenshotOptions): Promise<BrowserScreenshotEvidence>;
  captureDomSnapshot(options?: CaptureDomSnapshotOptions): Promise<BrowserDomSnapshotEvidence>;
  flushDownloads(): Promise<void>;
  snapshot(label?: string): Promise<BrowserInstrumentationSnapshot>;
  dispose(): void;
};

const defaultMaxConsoleTextLength = 8_000;
const defaultMaxDomSnapshotBytes = 500_000;

export function instrumentPage(
  page: Page,
  options: BrowserInstrumentationOptions = {},
): BrowserInstrumentationController {
  const events: BrowserInstrumentationEvent[] = [];
  const evidence: BrowserInstrumentationEvidence[] = [];
  const pendingDownloads = new Set<Promise<void>>();
  const maxConsoleTextLength = options.maxConsoleTextLength ?? defaultMaxConsoleTextLength;

  const pushEvent = (event: BrowserInstrumentationEvent) => {
    events.push(event);
    if (options.echoToConsole) {
      if (event.kind === 'console') {
        console.error(`[browser:${event.type}] ${event.text}`);
      } else if (event.kind === 'response') {
        console.error(`[browser:response] ${event.status} ${event.url}`);
      } else if (event.kind === 'requestfailed') {
        console.error(`[browser:requestfailed] ${event.url} ${event.errorText ?? ''}`);
      } else {
        console.error(`[browser:pageerror] ${event.message}`);
      }
    }
  };

  const onConsole = (message: ConsoleMessage) => {
    const type = message.type();
    if (type !== 'warning' && type !== 'error') return;
    const location = message.location();
    const event: BrowserConsoleEvent = {
      kind: 'console',
      severity: type === 'warning' ? 'warning' : 'error',
      type,
      text: truncate(message.text(), maxConsoleTextLength),
      location: {
        url: location.url || undefined,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber,
      },
      timestamp: now(),
      pageLabel: options.label,
    };
    pushEvent(event);
  };

  const onPageError = (error: Error) => {
    const event: BrowserPageErrorEvent = {
      kind: 'pageerror',
      severity: 'error',
      message: error.message,
      name: error.name,
      stack: error.stack,
      timestamp: now(),
      pageLabel: options.label,
    };
    pushEvent(event);
  };

  const onRequestFailed = (request: Request) => {
    const event: BrowserRequestFailedEvent = {
      kind: 'requestfailed',
      severity: 'error',
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText,
      timestamp: now(),
      pageLabel: options.label,
    };
    pushEvent(event);
  };

  const onResponse = (response: Response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    const event: BrowserResponseFailureEvent = {
      kind: 'response',
      severity: 'error',
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status,
      statusText: response.statusText(),
      timestamp: now(),
      pageLabel: options.label,
    };
    pushEvent(event);
  };

  const onDownload = (download: Download) => {
    const tracked = captureDownload(download, options).then((downloadEvidence) => {
      evidence.push(downloadEvidence);
    }).finally(() => {
      pendingDownloads.delete(tracked);
    });
    pendingDownloads.add(tracked);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('download', onDownload);

  const controller: BrowserInstrumentationController = {
    page,
    get events() {
      return events;
    },
    get evidence() {
      return evidence;
    },
    async captureScreenshot(captureOptions = {}) {
      const id = captureOptions.id ?? nextEvidenceId('screenshot', evidence);
      const outputPath = captureOptions.path ?? evidencePath(options.screenshotDir ?? options.artifactDir, `${id}.png`);
      if (!outputPath) {
        throw new Error('captureScreenshot requires a path, screenshotDir, or artifactDir');
      }
      await mkdir(dirname(outputPath), { recursive: true });
      const fullPage = captureOptions.fullPage ?? true;
      await page.screenshot({ path: outputPath, fullPage });
      const screenshot: BrowserScreenshotEvidence = {
        kind: 'screenshot',
        id,
        path: outputPath,
        fullPage,
        timestamp: now(),
        pageLabel: options.label,
        viewport: page.viewportSize(),
      };
      evidence.push(screenshot);
      return screenshot;
    },
    async captureDomSnapshot(captureOptions = {}) {
      const id = captureOptions.id ?? nextEvidenceId('dom-snapshot', evidence);
      const html = await page.content();
      const maxBytes = captureOptions.maxBytes ?? options.maxDomSnapshotBytes ?? defaultMaxDomSnapshotBytes;
      const htmlBuffer = Buffer.from(html, 'utf8');
      const truncated = htmlBuffer.byteLength > maxBytes;
      const bytes = truncated ? htmlBuffer.subarray(0, maxBytes) : htmlBuffer;
      const outputPath = captureOptions.path ?? evidencePath(options.domSnapshotDir ?? options.artifactDir, `${id}.html`);
      if (outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes);
      }
      const domSnapshot: BrowserDomSnapshotEvidence = {
        kind: 'dom-snapshot',
        id,
        path: outputPath,
        url: page.url(),
        title: await page.title().catch(() => ''),
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        truncated,
        timestamp: now(),
        pageLabel: options.label,
      };
      evidence.push(domSnapshot);
      return domSnapshot;
    },
    async flushDownloads() {
      await Promise.allSettled([...pendingDownloads]);
    },
    async snapshot(label = options.label) {
      await controller.flushDownloads();
      return {
        schemaVersion: 1,
        label,
        capturedAt: now(),
        counts: countInstrumentation(events, evidence),
        hasFailures: events.some((event) => event.severity === 'error'),
        events: [...events],
        evidence: [...evidence],
      };
    },
    dispose() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      page.off('download', onDownload);
    },
  };

  return controller;
}

export function countInstrumentation(
  events: readonly BrowserInstrumentationEvent[],
  evidence: readonly BrowserInstrumentationEvidence[],
): BrowserInstrumentationCounts {
  return {
    consoleWarnings: events.filter((event) => event.kind === 'console' && event.severity === 'warning').length,
    consoleErrors: events.filter((event) => event.kind === 'console' && event.severity === 'error').length,
    pageErrors: events.filter((event) => event.kind === 'pageerror').length,
    requestFailures: events.filter((event) => event.kind === 'requestfailed').length,
    responseFailures: events.filter((event) => event.kind === 'response').length,
    screenshots: evidence.filter((item) => item.kind === 'screenshot').length,
    domSnapshots: evidence.filter((item) => item.kind === 'dom-snapshot').length,
    downloads: evidence.filter((item) => item.kind === 'download').length,
  };
}

async function captureDownload(
  download: Download,
  options: BrowserInstrumentationOptions,
): Promise<BrowserDownloadEvidence> {
  const id = nextDownloadId();
  const suggestedFilename = download.suggestedFilename();
  const outputPath = options.downloadDir
    ? join(options.downloadDir, `${id}-${sanitizeFilename(suggestedFilename)}`)
    : undefined;
  const result: BrowserDownloadEvidence = {
    kind: 'download',
    id,
    suggestedFilename,
    url: download.url(),
    path: outputPath,
    timestamp: now(),
    pageLabel: options.label,
  };

  try {
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await download.saveAs(outputPath);
      const bytes = await readFile(outputPath);
      result.byteLength = bytes.byteLength;
      result.sha256 = sha256(bytes);
    } else {
      const path = await download.path();
      result.path = path ?? undefined;
      if (path) {
        const fileStat = await stat(path);
        result.byteLength = fileStat.size;
      }
    }
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function nextEvidenceId(kind: BrowserInstrumentationEvidence['kind'], evidence: readonly BrowserInstrumentationEvidence[]): string {
  const count = evidence.filter((item) => item.kind === kind).length + 1;
  return `${kind}-${String(count).padStart(2, '0')}`;
}

let downloadSequence = 0;

function nextDownloadId(): string {
  downloadSequence += 1;
  return `download-${String(downloadSequence).padStart(2, '0')}`;
}

function evidencePath(dir: string | undefined, filename: string): string | undefined {
  return dir ? join(dir, filename) : undefined;
}

function dirname(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'), 0)) || '.';
}

function now(): string {
  return new Date().toISOString();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitizeFilename(filename: string): string {
  const base = basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'download.bin';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}
