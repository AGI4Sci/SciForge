import { createHash } from 'node:crypto';

import type { JsonValue } from './types.js';

export type SecretScrubberFindingKind =
  | 'provider-token'
  | 'raw-auth-header'
  | 'absolute-secret-path'
  | 'unsafe-provider-route-field';

export type SecretScrubberFinding = {
  kind: SecretScrubberFindingKind;
  path: string;
  digest: string;
  summary: string;
};

export type SecretScrubberOptions = {
  knownSecrets?: string[];
  secretPathMarkers?: string[];
  routeSecretKeys?: string[];
};

export type SecretScrubberResult = {
  bundle: JsonValue;
  findings: SecretScrubberFinding[];
};

type JsonObject = { [key: string]: JsonValue };

const sensitiveValueKeys = new Set([
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'auth',
  'authHeader',
  'authorization',
  'bearerToken',
  'clientSecret',
  'client_secret',
  'credential',
  'credentials',
  'password',
  'providerToken',
  'provider_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'secretPath',
  'token',
]);

const defaultRouteSecretKeys = [
  'absolutePath',
  'auth',
  'authHeader',
  'authorization',
  'baseUrl',
  'credential',
  'credentials',
  'endpoint',
  'headers',
  'invokePath',
  'invokeUrl',
  'runtimeLocation',
  'secretPath',
  'token',
  'url',
  'workerId',
  'workspacePath',
  'workspaceRoot',
  'workspaceRoots',
];

const defaultSecretPathMarkers = [
  '/.env',
  '/.secrets/',
  '/secret/',
  '/secrets/',
  '/credentials/',
  '/config.local.json',
  '\\.env',
  '\\.secrets\\',
  '\\secret\\',
  '\\secrets\\',
  '\\credentials\\',
  '\\config.local.json',
];

const authHeaderPattern = /\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic|token)\s+[^\s"',;)}\]]+/iu;
const bareAuthValuePattern = /^(?:bearer|basic|token)\s+[^\s"',;)}\]]+$/iu;

export function scrubEvidenceBundle(bundle: unknown, options: SecretScrubberOptions = {}): SecretScrubberResult {
  const findings: SecretScrubberFinding[] = [];
  const knownSecrets = options.knownSecrets?.filter((secret) => secret.length > 0) ?? [];
  const routeSecretKeys = new Set(defaultRouteSecretKeys.concat(options.routeSecretKeys ?? []).map(normalizeKey));
  const secretPathMarkers = options.secretPathMarkers ?? defaultSecretPathMarkers;

  const scrubbed = scrubValue(bundle, {
    path: '$',
    parentKey: undefined,
    findings,
    knownSecrets,
    routeSecretKeys,
    secretPathMarkers,
    insideProviderRoute: false,
  });

  return { bundle: scrubbed, findings };
}

export function assertEvidenceBundleScrubbed(bundle: unknown, options: SecretScrubberOptions = {}): void {
  const unsafe = collectUnsafeValues(bundle, options);
  if (unsafe.length > 0) {
    const sample = unsafe.slice(0, 5).map((finding) => `${finding.kind} at ${finding.path}`).join(', ');
    throw new Error(`Evidence bundle contains unsanitized secret material: ${sample}`);
  }
}

function scrubValue(value: unknown, context: {
  path: string;
  parentKey: string | undefined;
  findings: SecretScrubberFinding[];
  knownSecrets: string[];
  routeSecretKeys: Set<string>;
  secretPathMarkers: string[];
  insideProviderRoute: boolean;
}): JsonValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const findingKind = unsafeStringKind(value, context.parentKey, context.knownSecrets, context.secretPathMarkers);
    if (findingKind) return redacted(value, findingKind, context.path, context.findings);
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => scrubValue(item, { ...context, path: `${context.path}[${index}]`, parentKey: undefined }));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (isAuditSafeRedaction(record)) return record as JsonObject;
    const insideProviderRoute = context.insideProviderRoute || isProviderRouteRecord(record);
    const output: JsonObject = {};

    for (const [key, child] of Object.entries(record)) {
      const childPath = `${context.path}.${key}`;
      const normalizedKey = normalizeKey(key);
      if (insideProviderRoute && context.routeSecretKeys.has(normalizedKey) && !isAuditSafeRouteKey(normalizedKey)) {
        const redactedFields = Array.isArray(output.redactedInternalRouteFields)
          ? output.redactedInternalRouteFields
          : [];
        redactedFields.push(redacted(child, 'unsafe-provider-route-field', childPath, context.findings));
        output.redactedInternalRouteFields = redactedFields;
        continue;
      }
      if (isSensitiveKey(normalizedKey)) {
        if (isAuditSafeRedaction(child)) {
          output[key] = child;
          continue;
        }
        output[key] = redacted(child, sensitiveFindingKind(normalizedKey), childPath, context.findings);
        continue;
      }
      output[key] = scrubValue(child, {
        ...context,
        path: childPath,
        parentKey: key,
        insideProviderRoute,
      });
    }

    return output;
  }

  return redacted(String(value), 'provider-token', context.path, context.findings);
}

function isAuditSafeRedaction(value: unknown): value is JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2
    && keys[0] === 'digest'
    && keys[1] === 'summary'
    && typeof record.digest === 'string'
    && record.digest.startsWith('sha256:')
    && typeof record.summary === 'string'
    && isAuditSafeSummary(record.summary);
}

function collectUnsafeValues(bundle: unknown, options: SecretScrubberOptions): SecretScrubberFinding[] {
  return scrubEvidenceBundle(bundle, options).findings;
}

function redacted(value: unknown, kind: SecretScrubberFindingKind, path: string, findings: SecretScrubberFinding[]): JsonObject {
  const digest = digestValue(value);
  const summary = auditSafeSummary(kind);
  findings.push({ kind, path, digest, summary });
  return { digest, summary };
}

function unsafeStringKind(
  value: string,
  parentKey: string | undefined,
  knownSecrets: string[],
  secretPathMarkers: string[],
): SecretScrubberFindingKind | undefined {
  if (authHeaderPattern.test(value) || (parentKey && isAuthHeaderKey(normalizeKey(parentKey)) && bareAuthValuePattern.test(value))) {
    return 'raw-auth-header';
  }
  if (knownSecrets.some((secret) => value.includes(secret))) return 'provider-token';
  if (looksLikeAbsoluteSecretPath(value, secretPathMarkers)) return 'absolute-secret-path';
  if (parentKey && isSensitiveKey(normalizeKey(parentKey))) return sensitiveFindingKind(normalizeKey(parentKey));
  return undefined;
}

function isProviderRouteRecord(record: Record<string, unknown>): boolean {
  return typeof record.providerId === 'string' && (
    typeof record.routeDigest === 'string'
    || 'endpoint' in record
    || 'baseUrl' in record
    || 'invokeUrl' in record
    || 'workerId' in record
  );
}

function isAuditSafeRouteKey(normalizedKey: string): boolean {
  return normalizedKey === 'providerid'
    || normalizedKey === 'routedigest'
    || normalizedKey === 'digest'
    || normalizedKey === 'healthsummary'
    || normalizedKey === 'permissionsummary'
    || normalizedKey === 'summary';
}

function isSensitiveKey(normalizedKey: string): boolean {
  return sensitiveValueKeys.has(normalizedKey) || isAuthHeaderKey(normalizedKey);
}

function isAuthHeaderKey(normalizedKey: string): boolean {
  return normalizedKey === 'authorization' || normalizedKey === 'proxyauthorization' || normalizedKey === 'authheader';
}

function sensitiveFindingKind(normalizedKey: string): SecretScrubberFindingKind {
  if (isAuthHeaderKey(normalizedKey)) return 'raw-auth-header';
  if (normalizedKey.includes('path')) return 'absolute-secret-path';
  return 'provider-token';
}

function looksLikeAbsoluteSecretPath(value: string, secretPathMarkers: string[]): boolean {
  const comparable = value.toLowerCase();
  return secretPathMarkers.some((marker) => {
    const index = comparable.indexOf(marker.toLowerCase());
    if (index < 0) return false;
    return isAbsolutePathLike(value.slice(0, index + marker.length));
  });
}

function isAbsolutePathLike(value: string): boolean {
  return /(?:^|[\s"'(:=])\//u.test(value) || /(?:^|[\s"'(:=])[a-z]:\\/iu.test(value);
}

function auditSafeSummary(kind: SecretScrubberFindingKind): string {
  switch (kind) {
    case 'absolute-secret-path':
      return 'redacted absolute secret path';
    case 'raw-auth-header':
      return 'redacted raw auth header';
    case 'unsafe-provider-route-field':
      return 'redacted provider route internal field';
    case 'provider-token':
      return 'redacted provider credential';
  }
}

function isAuditSafeSummary(summary: string): boolean {
  return summary.startsWith('redacted ');
}

function digestValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}
