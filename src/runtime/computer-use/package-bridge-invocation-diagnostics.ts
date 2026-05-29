const DEFAULT_PROCESS_OUTPUT_LIMIT = 4000;
const DEFAULT_ARG_LIMIT = 1000;
const REDACTED_SECRET = '[redacted-secret]';
const REDACTED_URL = '[redacted-url]';

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|apiKey|authorization|auth[_-]?token|authToken|bearer|base[_-]?url|baseUrl|provider[_-]?url|providerUrl|model|password|passwd|secret|token)/i;

export type PackageBridgeInvocationProcessInput = {
  args?: string[];
  code?: number | null;
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  signal?: NodeJS.Signals | string | null;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
  timeoutMs?: number;
};

export type PackageBridgeInvocationProcessSummary = {
  args: string[];
  code: number | null;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  signal: NodeJS.Signals | string | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  timeoutMs?: number;
};

export function packageBridgeInvocationProcessSummary(
  input: PackageBridgeInvocationProcessInput,
  options: { outputLimit?: number; argLimit?: number } = {},
): PackageBridgeInvocationProcessSummary {
  const outputLimit = positiveLimit(options.outputLimit, DEFAULT_PROCESS_OUTPUT_LIMIT);
  const argLimit = positiveLimit(options.argLimit, DEFAULT_ARG_LIMIT);
  return {
    args: sanitizeArgs(input.args ?? [], argLimit),
    code: input.code ?? null,
    command: sanitizeDiagnosticText(input.command, argLimit),
    cwd: input.cwd ? sanitizeDiagnosticText(input.cwd, argLimit) : undefined,
    env: input.env ? sanitizeEnv(input.env, argLimit) : undefined,
    signal: input.signal ?? null,
    stderr: boundedPackageBridgeDiagnosticText(input.stderr ?? '', outputLimit),
    stdout: boundedPackageBridgeDiagnosticText(input.stdout ?? '', outputLimit),
    timedOut: input.timedOut === true,
    timeoutMs: input.timeoutMs,
  };
}

export function boundedPackageBridgeDiagnosticText(value: string, limit = DEFAULT_PROCESS_OUTPUT_LIMIT) {
  const sanitized = sanitizeDiagnosticText(value).trim();
  const boundedLimit = positiveLimit(limit, DEFAULT_PROCESS_OUTPUT_LIMIT);
  if (sanitized.length <= boundedLimit) return sanitized;
  return `${sanitized.slice(0, boundedLimit)}...[truncated]`;
}

export function sanitizePackageBridgeDiagnosticText(value: string) {
  return sanitizeDiagnosticText(value);
}

function sanitizeArgs(args: string[], limit: number) {
  return args.map((arg, index) => {
    const previous = args[index - 1] ?? '';
    if (isSensitiveKey(previous)) return REDACTED_SECRET;
    const equals = arg.match(/^([^=\s]+)=(.*)$/s);
    if (equals && isSensitiveKey(equals[1])) return `${equals[1]}=${REDACTED_SECRET}`;
    if (arg.startsWith('--') && isSensitiveKey(arg.replace(/^--/, ''))) return arg;
    return sanitizeDiagnosticText(arg, limit);
  });
}

function sanitizeEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, limit: number) {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    sanitized[key] = isSensitiveKey(key) ? REDACTED_SECRET : sanitizeDiagnosticText(value, limit);
  }
  return sanitized;
}

function sanitizeDiagnosticText(value: string, limit = Number.POSITIVE_INFINITY) {
  const sanitized = value
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[^\s"',;)]+/gi, `Authorization: ${REDACTED_SECRET}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED_SECRET}`)
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{8,})\b/g, REDACTED_SECRET)
    .replace(/\b([A-Za-z0-9_.-]*(?:api[_-]?key|apiKey|authorization|auth[_-]?token|authToken|base[_-]?url|baseUrl|provider[_-]?url|providerUrl|model|password|passwd|secret|token)[A-Za-z0-9_.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"',;)]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/(["'])([A-Za-z0-9_.-]*(?:api[_-]?key|apiKey|authorization|auth[_-]?token|authToken|base[_-]?url|baseUrl|provider[_-]?url|providerUrl|model|password|passwd|secret|token)[A-Za-z0-9_.-]*)\1\s*:\s*(["'])(?:\\.|(?!\3).)*\3/gi, `$1$2$1: $3${REDACTED_SECRET}$3`)
    .replace(/https?:\/\/[^\s"')]+/gi, REDACTED_URL);
  if (sanitized.length <= limit) return sanitized;
  return `${sanitized.slice(0, limit)}...[truncated]`;
}

function isSensitiveKey(key: string) {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function positiveLimit(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
