import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexRuntimeMetadata, NormalizedAgentEvent } from './codex-event-normalizer.js';

const AUDIT_BUNDLE_SCHEMA = 'sciforge.runtime-codex.audit-bundle.v1';
const MAX_AUDIT_FILE_BYTES = 256 * 1024;

export interface RuntimeCodexAuditBundle {
  readonly bundleDir: string;
  readonly bundleRel: string;
  initialize(): Promise<void>;
  appendRawJsonlLine(line: string): void;
  appendStderr(chunk: string): void;
  appendNormalizedEvent(event: NormalizedAgentEvent): void;
  finalize(result: RuntimeCodexAuditBundleResult): Promise<void>;
}

export interface RuntimeCodexAuditBundleResult {
  status: 'running' | 'done' | 'failed' | 'cancelled';
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
}

export function createRuntimeCodexAuditBundle(metadata: CodexRuntimeMetadata): RuntimeCodexAuditBundle {
  const commandSegment = safePathSegment(metadata.commandId);
  const attemptSegment = safePathSegment(metadata.attemptId);
  const bundleRel = `.sciforge/runtime-codex/${commandSegment}/${attemptSegment}`;
  const bundleDir = join(metadata.workspace, bundleRel);
  return new RuntimeCodexAuditBundleWriter(metadata, bundleDir, bundleRel);
}

export function scrubRuntimeCodexAuditText(text: string): string {
  return text
    .replace(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?(?:<\/html>|$)/gi, (html) => htmlDigest(html))
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, (_match, secret: string) => `Bearer ${secretDigest(secret)}`)
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{8,})/gi,
      (_match, label: string, secret: string) => `${label}=${secretDigest(secret)}`,
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, (secret) => secretDigest(secret))
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, (url) => urlDigest(url));
}

export function scrubRuntimeCodexAuditValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubRuntimeCodexAuditText(value);
  if (Array.isArray(value)) return value.map((entry) => scrubRuntimeCodexAuditValue(entry));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (isSensitiveKey(key) && typeof entry === 'string') return [key, secretDigest(entry)];
    if (isUrlKey(key) && typeof entry === 'string') return [key, scrubRuntimeCodexAuditText(entry)];
    return [key, scrubRuntimeCodexAuditValue(entry)];
  }));
}

export function scrubRuntimeCodexEventForAudit(event: NormalizedAgentEvent): NormalizedAgentEvent {
  if (event.type === 'message' || event.type === 'message_delta' || event.type === 'gui_present' || event.type === 'gui_ask_user') {
    return {
      ...event,
      raw: event.raw === undefined ? undefined : scrubRuntimeCodexAuditValue(event.raw),
    };
  }
  return scrubRuntimeCodexAuditValue(event) as NormalizedAgentEvent;
}

class RuntimeCodexAuditBundleWriter implements RuntimeCodexAuditBundle {
  private readonly rawJsonl = new BoundedAuditText(MAX_AUDIT_FILE_BYTES);
  private readonly stderr = new BoundedAuditText(MAX_AUDIT_FILE_BYTES);
  private readonly normalizedEvents = new BoundedAuditText(MAX_AUDIT_FILE_BYTES);
  private startedAt = new Date().toISOString();

  constructor(
    private readonly metadata: CodexRuntimeMetadata,
    readonly bundleDir: string,
    readonly bundleRel: string,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.bundleDir, { recursive: true });
    await Promise.all([
      writeFile(join(this.bundleDir, 'raw-jsonl.scrubbed.jsonl'), '', 'utf8'),
      writeFile(join(this.bundleDir, 'stderr.scrubbed.log'), '', 'utf8'),
      writeFile(join(this.bundleDir, 'normalized-events.jsonl'), '', 'utf8'),
      this.writeManifest({
        status: 'running',
        exitCode: null,
        signal: null,
      }),
    ]);
  }

  appendRawJsonlLine(line: string): void {
    const trimmed = line.trimEnd();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      this.rawJsonl.append(trimmed, `${safeJsonStringify(scrubRuntimeCodexAuditValue(parsed))}\n`);
    } catch (error) {
      this.rawJsonl.append(trimmed, `${safeJsonStringify({
        invalidJsonlLine: scrubRuntimeCodexAuditText(trimmed),
        rawLineSha256: sha256(trimmed),
        parseError: error instanceof Error ? scrubRuntimeCodexAuditText(error.message) : scrubRuntimeCodexAuditText(String(error)),
      })}\n`);
    }
  }

  appendStderr(chunk: string): void {
    this.stderr.append(chunk, scrubRuntimeCodexAuditText(chunk));
  }

  appendNormalizedEvent(event: NormalizedAgentEvent): void {
    const raw = safeJsonStringify(event);
    const scrubbed = safeJsonStringify(scrubRuntimeCodexEventForAudit(event));
    this.normalizedEvents.append(raw, `${scrubbed}\n`);
  }

  async finalize(result: RuntimeCodexAuditBundleResult): Promise<void> {
    await mkdir(this.bundleDir, { recursive: true });
    await Promise.all([
      writeFile(join(this.bundleDir, 'raw-jsonl.scrubbed.jsonl'), this.rawJsonl.toFileText(), 'utf8'),
      writeFile(join(this.bundleDir, 'stderr.scrubbed.log'), this.stderr.toFileText(), 'utf8'),
      writeFile(join(this.bundleDir, 'normalized-events.jsonl'), this.normalizedEvents.toFileText(), 'utf8'),
    ]);
    await this.writeManifest(result);
  }

  private async writeManifest(result: RuntimeCodexAuditBundleResult): Promise<void> {
    const manifest = {
      schemaVersion: AUDIT_BUNDLE_SCHEMA,
      createdAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      provider: this.metadata.provider,
      model: this.metadata.model,
      profile: this.metadata.profile,
      workspace: this.metadata.workspace,
      runId: this.metadata.commandId,
      commandId: this.metadata.commandId,
      attemptId: this.metadata.attemptId,
      codexSessionId: this.metadata.codexSessionId,
      resumeRequested: this.metadata.resumeRequested,
      commandTextDigest: this.metadata.commandText ? sha256(this.metadata.commandText) : undefined,
      evidenceRefs: this.metadata.evidenceRefs,
      bundleRef: this.bundleRel,
      files: {
        manifest: `${this.bundleRel}/manifest.json`,
        rawJsonl: this.rawJsonl.metadata(`${this.bundleRel}/raw-jsonl.scrubbed.jsonl`),
        stderr: this.stderr.metadata(`${this.bundleRel}/stderr.scrubbed.log`),
        normalizedEvents: this.normalizedEvents.metadata(`${this.bundleRel}/normalized-events.jsonl`),
      },
      redaction: {
        mode: 'bounded-scrubbed-digests',
        maxBytesPerFile: MAX_AUDIT_FILE_BYTES,
        urlPolicy: 'replace with sha256 digest',
        secretPolicy: 'replace with sha256 digest',
      },
    };
    await writeFile(join(this.bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

class BoundedAuditText {
  private readonly rawHash = createHash('sha256');
  private readonly chunks: string[] = [];
  private totalRawBytes = 0;
  private writtenBytes = 0;
  private omittedScrubbedBytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(raw: string, scrubbed = scrubRuntimeCodexAuditText(raw)): void {
    this.rawHash.update(raw);
    this.totalRawBytes += Buffer.byteLength(raw);
    const scrubbedBytes = Buffer.byteLength(scrubbed);
    const remaining = this.maxBytes - this.writtenBytes;
    if (remaining <= 0) {
      this.truncated = true;
      this.omittedScrubbedBytes += scrubbedBytes;
      return;
    }
    const bounded = takeUtf8Bytes(scrubbed, remaining);
    this.chunks.push(bounded);
    this.writtenBytes += Buffer.byteLength(bounded);
    const boundedBytes = Buffer.byteLength(bounded);
    if (boundedBytes < scrubbedBytes) {
      this.truncated = true;
      this.omittedScrubbedBytes += scrubbedBytes - boundedBytes;
    }
  }

  toFileText(): string {
    return this.fileSnapshot().text;
  }

  metadata(path: string): Record<string, unknown> {
    const snapshot = this.fileSnapshot();
    return {
      path,
      bytes: Buffer.byteLength(snapshot.text),
      maxBytes: this.maxBytes,
      rawBytes: this.totalRawBytes,
      truncated: this.truncated,
      omittedScrubbedBytes: snapshot.omittedScrubbedBytes,
      rawSha256: this.rawDigest(),
    };
  }

  private fileSnapshot(): { text: string; omittedScrubbedBytes: number } {
    const body = this.chunks.join('');
    if (!this.truncated) return { text: body, omittedScrubbedBytes: this.omittedScrubbedBytes };

    let omittedScrubbedBytes = this.omittedScrubbedBytes;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const marker = this.truncationMarker(omittedScrubbedBytes);
      const markerBytes = Buffer.byteLength(marker);
      if (markerBytes >= this.maxBytes) {
        return { text: takeUtf8Bytes(marker, this.maxBytes), omittedScrubbedBytes };
      }
      const boundedBody = takeUtf8Bytes(body, this.maxBytes - markerBytes);
      const nextOmittedScrubbedBytes = this.omittedScrubbedBytes + Buffer.byteLength(body) - Buffer.byteLength(boundedBody);
      if (nextOmittedScrubbedBytes === omittedScrubbedBytes) {
        return { text: `${boundedBody}${marker}`, omittedScrubbedBytes };
      }
      omittedScrubbedBytes = nextOmittedScrubbedBytes;
    }

    const marker = this.truncationMarker(omittedScrubbedBytes);
    const markerBytes = Buffer.byteLength(marker);
    const boundedBody = markerBytes >= this.maxBytes ? '' : takeUtf8Bytes(body, this.maxBytes - markerBytes);
    return {
      text: `${boundedBody}${takeUtf8Bytes(marker, this.maxBytes - Buffer.byteLength(boundedBody))}`,
      omittedScrubbedBytes,
    };
  }

  private truncationMarker(omittedScrubbedBytes: number): string {
    return `\n${JSON.stringify({
      truncated: true,
      omittedScrubbedBytes,
      rawSha256: this.rawDigest(),
    })}\n`;
  }

  private rawDigest(): string {
    return `sha256:${this.rawHash.copy().digest('hex')}`;
  }
}

function safePathSegment(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return clean || 'unknown';
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? scrubRuntimeCodexAuditText(error.message) : scrubRuntimeCodexAuditText(String(error)),
      valueSha256: sha256(String(value)),
    });
  }
}

function takeUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const bytes = Buffer.from(value);
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0b11000000) === 0b10000000) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential)/i.test(key);
}

function isUrlKey(key: string): boolean {
  return /(?:url|uri|endpoint|base[_-]?url|invoke[_-]?url)/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function urlDigest(value: string): string {
  return `[redacted-url:sha256:${sha256(value).slice('sha256:'.length, 'sha256:'.length + 16)}]`;
}

function htmlDigest(value: string): string {
  return `[redacted-html:sha256:${sha256(value).slice('sha256:'.length, 'sha256:'.length + 16)}]`;
}

function secretDigest(value: string): string {
  return `[redacted-secret:sha256:${sha256(value).slice('sha256:'.length, 'sha256:'.length + 16)}]`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
