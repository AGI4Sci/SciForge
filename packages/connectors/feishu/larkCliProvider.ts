import { spawn } from 'node:child_process';

export type LarkCliOutputFormat = 'json' | 'ndjson';
export type LarkCliSideEffect = 'none' | 'read' | 'send' | 'upload' | 'delete' | 'admin';

export interface LarkCliRunOptions {
  operation: string;
  format: LarkCliOutputFormat;
  sideEffect?: LarkCliSideEffect;
  stdin?: string;
}

export interface LarkCliRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type LarkCliRunner = (command: string, args: string[], options: LarkCliRunOptions) => Promise<LarkCliRunnerResult>;

export interface LarkCliCommandAudit {
  auditRef: string;
  operation: string;
  command: string;
  args: string[];
  format: LarkCliOutputFormat;
  sideEffect: LarkCliSideEffect;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  stderrPreview?: string;
}

export interface LarkCliJsonResult {
  audit: LarkCliCommandAudit;
  auditRef: string;
  json: unknown;
}

export interface LarkCliNdjsonResult {
  audit: LarkCliCommandAudit;
  auditRef: string;
  records: unknown[];
}

export interface LarkCliProviderOptions {
  command?: string;
  runner?: LarkCliRunner;
  now?: () => Date | string;
  auditRefPrefix?: string;
}

export class LarkCliProvider {
  readonly command: string;
  private readonly runner: LarkCliRunner;
  private readonly now: () => Date | string;
  private readonly auditRefPrefix: string;

  constructor(options: LarkCliProviderOptions = {}) {
    this.command = options.command ?? 'lark-cli';
    this.runner = options.runner ?? defaultLarkCliRunner;
    this.now = options.now ?? (() => new Date());
    this.auditRefPrefix = options.auditRefPrefix ?? 'audit:feishu:lark-cli';
  }

  async runJson(args: string[], options: Omit<LarkCliRunOptions, 'format'>): Promise<LarkCliJsonResult> {
    const result = await this.runWithFormat(args, { ...options, format: 'json' });
    const text = result.stdout.trim();
    return {
      audit: result.audit,
      auditRef: result.auditRef,
      json: text ? JSON.parse(text) : {},
    };
  }

  async runNdjson(args: string[], options: Omit<LarkCliRunOptions, 'format'>): Promise<LarkCliNdjsonResult> {
    const result = await this.runWithFormat(args, { ...options, format: 'ndjson' });
    const records = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    return {
      audit: result.audit,
      auditRef: result.auditRef,
      records,
    };
  }

  async readCliEventStream(args: string[] = ['events', 'listen']): Promise<LarkCliNdjsonResult> {
    return this.runNdjson(args, { operation: 'intake.cli-event-stream', sideEffect: 'read' });
  }

  private async runWithFormat(args: string[], options: LarkCliRunOptions): Promise<{ stdout: string; audit: LarkCliCommandAudit; auditRef: string }> {
    const formattedArgs = withForcedFormat(args, options.format);
    const startedAt = isoFromClock(this.now);
    const result = await this.runner(this.command, formattedArgs, options);
    const completedAt = isoFromClock(this.now);
    const auditRef = `${this.auditRefPrefix}:${stableAuditSlug(`${options.operation}:${startedAt}:${formattedArgs.join(' ')}`)}`;
    const audit: LarkCliCommandAudit = {
      auditRef,
      operation: options.operation,
      command: redactCommandPart(this.command),
      args: redactArgs(formattedArgs),
      format: options.format,
      sideEffect: options.sideEffect ?? 'none',
      startedAt,
      completedAt,
      exitCode: result.exitCode,
      stderrPreview: result.stderr ? redactText(result.stderr).slice(0, 400) : undefined,
    };
    if (result.exitCode !== 0) {
      throw new LarkCliProviderError(`lark-cli failed for ${options.operation}`, audit);
    }
    return { stdout: result.stdout, audit, auditRef };
  }
}

export class LarkCliProviderError extends Error {
  readonly audit: LarkCliCommandAudit;

  constructor(message: string, audit: LarkCliCommandAudit) {
    super(message);
    this.name = 'LarkCliProviderError';
    this.audit = audit;
  }
}

export function withForcedFormat(args: string[], format: LarkCliOutputFormat): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--format') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) continue;
    out.push(arg);
  }
  return [...out, '--format', format];
}

export function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1] ?? '';
    if (/token|secret|password|app[-_]?key|authorization/i.test(previous)) return '[redacted]';
    return redactCommandPart(arg);
  });
}

export function redactCommandPart(value: string): string {
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return '[local-path]';
  return redactText(value)
    .replace(/(--?(?:token|secret|password|app[-_]?key|authorization)[=\s:])[^,\s]+/gi, '$1[redacted]');
}

export function redactText(value: string): string {
  return value
    .replace(/(tenant_access_token|app_secret|app_token|authorization|password|secret|token)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]')
    .replace(/\/(?:Users|Applications|Volumes|private|tmp)\/[^\s"',}]+/g, '[local-path]');
}

function defaultLarkCliRunner(command: string, args: string[], options: LarkCliRunOptions): Promise<LarkCliRunnerResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ stdout, stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`, exitCode: 1 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

function isoFromClock(now: () => Date | string): string {
  const value = now();
  return value instanceof Date ? value.toISOString() : value;
}

function stableAuditSlug(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
