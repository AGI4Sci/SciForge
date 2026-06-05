export type TraceTextRedactionOptions = {
  sensitiveValues?: string[];
};

const dataImagePattern = /\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]*/gi;
const inlineBase64PayloadPattern = /;base64,[A-Za-z0-9+/=_-]{24,}/gi;
const rawAuthHeaderPattern = /\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[A-Za-z0-9._~+/=-]+/gi;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const providerTokenPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/gi;
const httpUrlPattern = /\bhttps?:\/\/[^\s"'<>),\]]+/gi;
const localAbsolutePathPattern = /(^|[\s"'([])(?:(?:file:\/\/)?\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/[^\s"'<>),\]]+|[A-Za-z]:\\[^\s"'<>),\]]+|\\\\[^\s"'<>),\]]+)/gi;
const genericSecretAssignmentPattern = /\b(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;&]+)/gi;
const likelyBase64BlobPattern = /\b[A-Za-z0-9+/]{120,}={0,2}\b/g;

export function redactTraceText(value: string, options: TraceTextRedactionOptions = {}) {
  let redacted = value;
  redacted = redacted.replace(dataImagePattern, '[redacted-image-data]');
  redacted = redacted.replace(inlineBase64PayloadPattern, ';base64,[redacted]');
  redacted = redacted.replace(rawAuthHeaderPattern, '[redacted-auth-header]');
  redacted = redacted.replace(httpUrlPattern, '[redacted-url]');
  redacted = redacted.replace(localAbsolutePathPattern, (_match, prefix: string) => `${prefix}[redacted-path]`);
  redacted = redacted.replace(bearerTokenPattern, '[redacted-bearer-token]');
  redacted = redacted.replace(providerTokenPattern, '[redacted-provider-token]');
  redacted = redacted.replace(genericSecretAssignmentPattern, '[redacted-secret-assignment]');
  redacted = redacted.replace(likelyBase64BlobPattern, '[redacted-base64]');

  for (const sensitiveValue of normalizedSensitiveValues(options.sensitiveValues ?? [])) {
    redacted = redacted.replace(new RegExp(escapeRegExp(sensitiveValue), 'g'), '[redacted-sensitive]');
  }

  return redacted;
}

function normalizedSensitiveValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
