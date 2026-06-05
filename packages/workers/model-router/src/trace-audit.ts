import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export const MODEL_ROUTER_TRACE_AUDIT_SCHEMA_VERSION = 'sciforge.model-router.trace-audit.v1' as const;

export type ModelRouterTraceAuditFindingKind =
  | 'trace-root-unavailable'
  | 'trace-root-empty'
  | 'unscannable-trace-entry'
  | 'raw-binary-artifact'
  | 'known-secret-env-missing'
  | 'known-secret'
  | 'raw-auth-header'
  | 'inline-image-data'
  | 'raw-private-url'
  | 'local-absolute-path'
  | 'raw-provider-payload'
  | 'raw-provider-binding';

export type ModelRouterTraceAuditFinding = {
  kind: ModelRouterTraceAuditFindingKind;
  fileRef: string;
  path: string;
  digest: string;
  summary: string;
};

export type ModelRouterTraceAuditReport = {
  schemaVersion: typeof MODEL_ROUTER_TRACE_AUDIT_SCHEMA_VERSION;
  status: 'pass' | 'fail';
  traceRootSha256: string;
  scannedFileRefs: string[];
  scannedFiles: number;
  scannedBytes: number;
  findings: ModelRouterTraceAuditFinding[];
  policy: {
    knownSecretsChecked: number;
    forbidsRawProviderPayload: true;
    forbidsRawPrivateUrls: true;
    forbidsLocalAbsolutePaths: true;
    forbidsInlineImageData: true;
  };
};

export type AuditModelRouterTraceBundleOptions = {
  traceRoot: string;
  knownSecrets?: string[];
  missingKnownSecretEnvNames?: string[];
  outPath?: string;
  maxFileBytes?: number;
  requireNonEmpty?: boolean;
};

type ScannedFile = {
  path: string;
  fileRef: string;
  text: string;
  byteLength: number;
  binary: boolean;
  unscannable?: boolean;
};

type JsonRecord = Record<string, unknown>;

const defaultMaxFileBytes = 2_000_000;
const rawAuthHeaderPattern = /\bAuthorization(?:\s*[:=]\s*|\s+)(?:(?:Bearer|Basic)\s+)?[A-Za-z0-9._~+/=-]+/i;
const inlineImageDataPattern = /\bdata:image\/[a-z0-9.+-]+;base64,|;base64,[A-Za-z0-9+/=_-]{24,}/i;
const httpUrlPattern = /\bhttps?:\/\/[^\s"'<>),\]]+/i;
const localAbsolutePathPattern = /(^|[\s"'([])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/[^\s"'<>),\]]+|[A-Za-z]:\\[^\s"'<>),\]]+|\\\\[^\s"'<>),\]]+)/i;
const genericSecretPattern = /\b(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;&]+)/i;
const providerTokenPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/i;
const likelyBase64BlobPattern = /\b[A-Za-z0-9+/]{120,}={0,2}\b/;

const rawProviderPayloadKeys = new Set([
  'body',
  'headers',
  'image_url',
  'messages',
  'payload',
  'prompt',
  'providerPayload',
  'rawProviderRequest',
  'rawProviderResponse',
  'rawBody',
  'rawPayload',
  'rawProviderPayload',
  'request',
  'requestBody',
  'response',
  'responseBody',
].map((key) => normalizeJsonKey(key)));

const rawProviderBindingKeys = new Set([
  'apiKey',
  'api_key',
  'apiKeyEnv',
  'authorization',
  'baseUrl',
  'endpoint',
  'envKey',
  'headers',
  'model',
  'provider',
  'secret',
  'token',
].map((key) => normalizeJsonKey(key)));

const sensitiveHeaderKeys = new Set([
  'authorization',
  'proxyauthorization',
  'xapikey',
  'apikey',
  'cookie',
  'setcookie',
]);

export async function auditModelRouterTraceBundle(
  options: AuditModelRouterTraceBundleOptions,
): Promise<ModelRouterTraceAuditReport> {
  const traceRoot = resolve(options.traceRoot);
  const rootFindings: ModelRouterTraceAuditFinding[] = [];
  let files: ScannedFile[] = [];
  try {
    files = await collectTraceFiles(traceRoot, options.maxFileBytes ?? defaultMaxFileBytes);
  } catch {
    rootFindings.push(traceRootFinding(traceRoot));
  }
  const normalizedSecrets = normalizeKnownSecrets(options.knownSecrets ?? []);
  const findings = [
    ...rootFindings,
    ...traceRootEmptyFindings(traceRoot, files, Boolean(options.requireNonEmpty)),
    ...missingKnownSecretEnvFindings(options.missingKnownSecretEnvNames ?? []),
    ...files.flatMap((file) => auditTraceFile(file, normalizedSecrets)),
  ];
  const report: ModelRouterTraceAuditReport = {
    schemaVersion: MODEL_ROUTER_TRACE_AUDIT_SCHEMA_VERSION,
    status: findings.length === 0 ? 'pass' : 'fail',
    traceRootSha256: sha256Hex(traceRoot),
    scannedFileRefs: files.map((file) => file.fileRef).sort(),
    scannedFiles: files.length,
    scannedBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
    findings,
    policy: {
      knownSecretsChecked: normalizedSecrets.length,
      forbidsRawProviderPayload: true,
      forbidsRawPrivateUrls: true,
      forbidsLocalAbsolutePaths: true,
      forbidsInlineImageData: true,
    },
  };
  if (options.outPath) {
    await mkdir(dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

function traceRootEmptyFindings(
  traceRoot: string,
  files: ScannedFile[],
  requireNonEmpty: boolean,
): ModelRouterTraceAuditFinding[] {
  if (!requireNonEmpty || files.length > 0) return [];
  const ref = `trace-root:${sha256Hex(traceRoot).slice(0, 16)}`;
  return [{
    kind: 'trace-root-empty',
    fileRef: ref,
    path: '$',
    digest: sha256Hex(`trace-root-empty\n${ref}`),
    summary: 'trace root contains no auditable trace files',
  }];
}

function missingKnownSecretEnvFindings(names: string[]): ModelRouterTraceAuditFinding[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .map((name) => {
      const ref = `known-secret-env:${sha256Hex(name).slice(0, 16)}`;
      return {
        kind: 'known-secret-env-missing' as const,
        fileRef: ref,
        path: '$',
        digest: sha256Hex(`known-secret-env-missing\n${ref}`),
        summary: 'explicit known secret env var is unavailable',
      };
    });
}

function traceRootFinding(traceRoot: string): ModelRouterTraceAuditFinding {
  return {
    kind: 'trace-root-unavailable',
    fileRef: `trace-root:${sha256Hex(traceRoot).slice(0, 16)}`,
    path: '$',
    digest: sha256Hex(`trace-root-unavailable\n${traceRoot}`),
    summary: 'trace root is unavailable or not a directory',
  };
}

async function collectTraceFiles(traceRoot: string, maxFileBytes: number): Promise<ScannedFile[]> {
  const rootStats = await stat(traceRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`Model Router trace audit root is not a directory: ${traceRoot}`);
  }
  const files: ScannedFile[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        files.push({
          path,
          fileRef: fileRefForTraceRoot(traceRoot, path),
          text: '',
          byteLength: 0,
          binary: false,
          unscannable: true,
        });
        continue;
      }
      const info = await stat(path);
      if (!isTraceTextFile(entry.name)) {
        files.push({
          path,
          fileRef: fileRefForTraceRoot(traceRoot, path),
          text: '',
          byteLength: info.size,
          binary: true,
        });
        continue;
      }
      if (info.size > maxFileBytes) {
        files.push({
          path,
          fileRef: fileRefForTraceRoot(traceRoot, path),
          text: '',
          byteLength: info.size,
          binary: false,
        });
        continue;
      }
      const text = await readFile(path, 'utf8');
      files.push({
        path,
        fileRef: fileRefForTraceRoot(traceRoot, path),
        text,
        byteLength: Buffer.byteLength(text, 'utf8'),
        binary: false,
      });
    }
  }
  await visit(traceRoot);
  return files;
}

function isTraceTextFile(name: string) {
  return /\.(?:json|jsonl|txt|md)$/i.test(name);
}

function auditTraceFile(file: ScannedFile, knownSecrets: string[]): ModelRouterTraceAuditFinding[] {
  const findings: ModelRouterTraceAuditFinding[] = [];
  if (file.unscannable) {
    findings.push(finding('unscannable-trace-entry', file, '$', 'unscannable trace entry under trace root'));
    return findings;
  }
  if (file.binary) {
    findings.push(finding('raw-binary-artifact', file, '$', 'raw binary or image file under trace root'));
    return findings;
  }
  if (!file.text) {
    findings.push(finding('raw-provider-payload', file, '$', `trace file exceeds scan byte budget`));
    return findings;
  }
  const textChecks: Array<[ModelRouterTraceAuditFindingKind, RegExp, string]> = [
    ['raw-auth-header', rawAuthHeaderPattern, 'raw Authorization header'],
    ['inline-image-data', inlineImageDataPattern, 'inline image data or base64 image payload'],
    ['raw-private-url', httpUrlPattern, 'raw URL'],
    ['local-absolute-path', localAbsolutePathPattern, 'local absolute path'],
    ['raw-provider-binding', genericSecretPattern, 'secret-like assignment'],
    ['raw-provider-binding', providerTokenPattern, 'provider-token-like value'],
    ['inline-image-data', likelyBase64BlobPattern, 'large base64-like blob'],
  ];
  for (const [kind, pattern, summary] of textChecks) {
    if (pattern.test(file.text)) findings.push(finding(kind, file, '$', summary));
  }
  for (const secret of knownSecrets) {
    if (file.text.includes(secret)) findings.push(finding('known-secret', file, '$', 'known secret value'));
  }
  findings.push(...auditJsonText(file));
  return dedupeFindings(findings);
}

function auditJsonText(file: ScannedFile): ModelRouterTraceAuditFinding[] {
  const documents = parseJsonTraceDocuments(file);
  if (documents.length === 0) return [];
  const findings: ModelRouterTraceAuditFinding[] = [];
  for (const document of documents) {
    visitJson(document.value, document.path, (value, path, key) => {
      const normalizedKey = normalizeJsonKey(key);
      if (normalizedKey && sensitiveHeaderKeys.has(normalizedKey)) {
        findings.push(finding(
          normalizedKey.includes('authorization') ? 'raw-auth-header' : 'raw-provider-binding',
          file,
          path,
          `sensitive header field "${key}"`,
        ));
      }
      if (normalizedKey && rawProviderPayloadKeys.has(normalizedKey)) {
        findings.push(finding('raw-provider-payload', file, path, `raw provider payload field "${key}"`));
      }
      if (normalizedKey && rawProviderBindingKeys.has(normalizedKey)) {
        findings.push(finding('raw-provider-binding', file, path, `raw provider binding field "${key}"`));
      }
      if (typeof value !== 'string') return;
      if (httpUrlPattern.test(value)) findings.push(finding('raw-private-url', file, path, 'raw URL string'));
      if (inlineImageDataPattern.test(value) || likelyBase64BlobPattern.test(value)) {
        findings.push(finding('inline-image-data', file, path, 'inline image or base64-like string'));
      }
      if (isLocalAbsolutePath(value)) findings.push(finding('local-absolute-path', file, path, 'local absolute path string'));
    });
  }
  return findings;
}

function normalizeJsonKey(key: string | undefined) {
  return key?.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function parseJsonTraceDocuments(file: ScannedFile): Array<{ value: unknown; path: string }> {
  if (/\.json$/i.test(file.fileRef)) {
    try {
      return [{ value: JSON.parse(file.text) as unknown, path: '$' }];
    } catch {
      return [];
    }
  }
  const documents: Array<{ value: unknown; path: string }> = [];
  if (/\.jsonl$/i.test(file.fileRef)) {
    file.text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        documents.push({ value: JSON.parse(trimmed) as unknown, path: `$[${index}]` });
      } catch {
        // Keep scanning later JSONL records even if one line is malformed.
      }
    });
  }
  documents.push(...parseSseDataJsonDocuments(file.text));
  return documents;
}

function parseSseDataJsonDocuments(text: string): Array<{ value: unknown; path: string }> {
  const documents: Array<{ value: unknown; path: string }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^data:\s*(.*)$/i.exec(line);
    if (!match) return;
    const payload = match[1].trim();
    if (!payload || payload === '[DONE]' || !/^[{\[]/.test(payload)) return;
    try {
      documents.push({ value: JSON.parse(payload) as unknown, path: `$.sse[${index}].data` });
    } catch {
      // Malformed event frames still get text-regex scanning; keep later events auditable.
    }
  });
  return documents;
}

function visitJson(value: unknown, path: string, onValue: (value: unknown, path: string, key?: string) => void, key?: string) {
  onValue(value, path, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitJson(item, `${path}[${index}]`, onValue));
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    visitJson(childValue, `${path}.${jsonPathKeySegment(childKey)}`, onValue, childKey);
  }
}

function jsonPathKeySegment(key: string) {
  if (unsafeJsonPathKey(key)) return `key:${sha256Hex(key).slice(0, 12)}`;
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key)
    ? key
    : `key:${sha256Hex(key).slice(0, 12)}`;
}

function unsafeJsonPathKey(key: string) {
  return rawAuthHeaderPattern.test(key)
    || inlineImageDataPattern.test(key)
    || httpUrlPattern.test(key)
    || localAbsolutePathPattern.test(key)
    || genericSecretPattern.test(key)
    || providerTokenPattern.test(key)
    || likelyBase64BlobPattern.test(key)
    || isLocalAbsolutePath(key);
}

function normalizeKnownSecrets(secrets: string[]) {
  return [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 6))];
}

function isLocalAbsolutePath(value: string) {
  return value.startsWith('/')
    || value.startsWith('file:/')
    || value.startsWith('~')
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\/.test(value);
}

function finding(
  kind: ModelRouterTraceAuditFindingKind,
  file: ScannedFile,
  path: string,
  summary: string,
): ModelRouterTraceAuditFinding {
  return {
    kind,
    fileRef: file.fileRef,
    path,
    digest: sha256Hex(`${kind}\n${file.fileRef}\n${path}\n${summary}`),
    summary,
  };
}

function dedupeFindings(findings: ModelRouterTraceAuditFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.kind}\n${finding.fileRef}\n${finding.path}\n${finding.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fileRefForTraceRoot(traceRoot: string, path: string) {
  const ref = relative(traceRoot, path).replace(/\\/g, '/');
  return unsafeTraceFileRef(ref) ? `trace-file:${sha256Hex(ref).slice(0, 16)}` : ref;
}

function unsafeTraceFileRef(ref: string) {
  return rawAuthHeaderPattern.test(ref)
    || inlineImageDataPattern.test(ref)
    || httpUrlPattern.test(ref)
    || localAbsolutePathPattern.test(ref)
    || genericSecretPattern.test(ref)
    || providerTokenPattern.test(ref)
    || likelyBase64BlobPattern.test(ref)
    || isLocalAbsolutePath(ref);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
