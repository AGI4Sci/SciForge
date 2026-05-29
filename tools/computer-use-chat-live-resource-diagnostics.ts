import { execFile } from 'node:child_process';
import { readdir, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA =
  'sciforge.computer-use.chat-live-resource-diagnostics.v1' as const;

const RESOURCE_ENV_KEYS = [
  'SCIFORGE_UI_PORT',
  'SCIFORGE_WORKSPACE_PORT',
  'SCIFORGE_AGENT_SERVER_PORT',
  'SCIFORGE_RUNTIME_CODEX_PORT',
  'SCIFORGE_PROXY_PORT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_BACKEND',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_TIMEOUT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_DISPLAY',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_DOCKER_IMAGE',
] as const;

const RESOURCE_PORT_ENV_KEYS = [
  'SCIFORGE_UI_PORT',
  'SCIFORGE_WORKSPACE_PORT',
  'SCIFORGE_AGENT_SERVER_PORT',
  'SCIFORGE_RUNTIME_CODEX_PORT',
  'SCIFORGE_PROXY_PORT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT',
] as const;

const RESOURCE_REF_PATTERN =
  /(?:^|\/)(?:vision-runs|host-ports|tui-host-run-task-chain|completion-grade-diagnostics|embedded-l3-completion-producer-diagnostics|cu-user-acceptance|isolated-desktop-l3-workflow|directory-listing|manifest)\b/i;

export interface ComputerUseChatLiveResourceDiagnosticsInput {
  env?: Record<string, string | undefined>;
  manifestRefs?: string[];
  manifests?: unknown[];
  processNotes?: unknown[];
  now?: () => Date;
}

export interface ComputerUseChatLiveResourceDiagnostics {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA;
  checkedAt: string;
  status: 'passed' | 'needs-attention';
  evidenceMode: 'diagnostic-only';
  env: Record<string, string>;
  refs: {
    manifestRefs: string[];
    runDirRefs: string[];
    hostPortsRefs: string[];
    producerDiagnosticRefs: string[];
    completionDiagnosticRefs: string[];
    acceptanceManifestRefs: string[];
    stagingDirRefs: string[];
  };
  resources: {
    ports: ResourcePortDiagnostic[];
    processes: ResourceProcessDiagnostic[];
    containers: ResourceContainerDiagnostic[];
    cleanup: ResourceCleanupDiagnostic[];
    timeouts: ResourceTimeoutDiagnostic[];
  };
  issues: string[];
}

export interface ResourcePortDiagnostic {
  port: number;
  kind: 'ui' | 'workspace-writer' | 'runtime-codex' | 'provider-proxy' | 'vnc' | 'novnc' | 'unknown';
  source: string;
}

export interface ResourceProcessDiagnostic {
  pid: number;
  kind: 'server' | 'producer' | 'unknown';
  source: string;
  label?: string;
  cleanup?: ResourceCleanupDiagnostic;
}

export interface ResourceContainerDiagnostic {
  id?: string;
  name?: string;
  image?: string;
  source: string;
  cleanup?: ResourceCleanupDiagnostic;
}

export interface ResourceCleanupDiagnostic {
  source: string;
  resourceKind: 'process' | 'container' | 'port' | 'run-dir' | 'staging-dir' | 'unknown';
  attempted?: boolean;
  released?: boolean;
  method?: string;
  result?: 'released' | 'failed' | 'unknown';
  error?: string;
}

export interface ResourceTimeoutDiagnostic {
  source: string;
  timedOut: boolean;
  timeoutMs?: number;
  code?: number | null;
  signal?: string | null;
}

export async function runComputerUseChatLiveResourceDiagnostics(options: {
  env?: Record<string, string | undefined>;
  lifecycleDirs?: string[];
  pidfilePaths?: string[];
  cleanupNotePaths?: string[];
  portOwnershipPaths?: string[];
  manifestPaths?: string[];
  manifestRefs?: string[];
  manifests?: unknown[];
  notePaths?: string[];
  noteJson?: string[];
  processNotes?: unknown[];
  out?: string;
  now?: () => Date;
} = {}): Promise<ComputerUseChatLiveResourceDiagnostics> {
  const env = options.env ?? process.env;
  const lifecycleFiles = await discoverLifecycleFiles(env, options);
  const manifests = await readJsonFiles(options.manifestPaths ?? []);
  const processNotes = [
    ...await readLifecycleJsonNotes(lifecycleFiles.pidfilePaths, 'pidfile'),
    ...await readLifecycleJsonNotes(lifecycleFiles.portOwnershipPaths, 'port-ownership-note'),
    ...await readCleanupNotes(lifecycleFiles.cleanupNotePaths),
    ...await readJsonFiles(options.notePaths ?? []),
    ...parseNoteJson(options.noteJson ?? []),
    ...(options.processNotes ?? []),
  ];
  processNotes.push(...await readPortOwnershipNotes(env, processNotes));
  const diagnostics = buildComputerUseChatLiveResourceDiagnostics({
    env,
    manifestRefs: [
      ...(options.manifestRefs ?? []),
      ...(options.manifestPaths ?? []).map((path) => normalizeRef(path)),
    ],
    manifests: [
      ...manifests,
      ...(options.manifests ?? []),
    ],
    processNotes,
    now: options.now,
  });
  if (options.out) {
    const outPath = resolve(options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
  }
  return diagnostics;
}

export function buildComputerUseChatLiveResourceDiagnostics(
  input: ComputerUseChatLiveResourceDiagnosticsInput = {},
): ComputerUseChatLiveResourceDiagnostics {
  const env = sanitizedResourceEnv(input.env ?? {});
  const collector = new ResourceCollector(input.manifestRefs ?? []);
  collector.collectEnv(env);
  for (const manifest of input.manifests ?? []) collector.collectManifest(manifest);
  for (const note of input.processNotes ?? []) collector.collectProcessNote(note);

  const resources = collector.resources();
  const issues = resourceIssues(resources);
  return {
    schemaVersion: COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    status: issues.length > 0 ? 'needs-attention' : 'passed',
    evidenceMode: 'diagnostic-only',
    env,
    refs: collector.refs(),
    resources,
    issues,
  };
}

class ResourceCollector {
  private readonly manifestRefs = new Set<string>();
  private readonly runDirRefs = new Set<string>();
  private readonly hostPortsRefs = new Set<string>();
  private readonly producerDiagnosticRefs = new Set<string>();
  private readonly completionDiagnosticRefs = new Set<string>();
  private readonly acceptanceManifestRefs = new Set<string>();
  private readonly stagingDirRefs = new Set<string>();
  private readonly ports = new Map<string, ResourcePortDiagnostic>();
  private readonly processes = new Map<string, ResourceProcessDiagnostic>();
  private readonly containers = new Map<string, ResourceContainerDiagnostic>();
  private readonly cleanup = new Map<string, ResourceCleanupDiagnostic>();
  private readonly timeouts = new Map<string, ResourceTimeoutDiagnostic>();

  constructor(manifestRefs: string[]) {
    for (const ref of manifestRefs) this.addManifestRef(ref);
  }

  collectEnv(env: Record<string, string>) {
    this.collectPort(env, 'SCIFORGE_UI_PORT', 'ui', 'env');
    this.collectPort(env, 'SCIFORGE_WORKSPACE_PORT', 'workspace-writer', 'env');
    this.collectPort(env, 'SCIFORGE_AGENT_SERVER_PORT', 'runtime-codex', 'env');
    this.collectPort(env, 'SCIFORGE_RUNTIME_CODEX_PORT', 'runtime-codex', 'env');
    this.collectPort(env, 'SCIFORGE_PROXY_PORT', 'provider-proxy', 'env');
    this.collectPort(env, 'SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT', 'vnc', 'env');
    this.collectPort(env, 'SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT', 'novnc', 'env');
    const stagingDir = env.SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT;
    if (stagingDir) this.stagingDirRefs.add(sanitizeText(stagingDir));
    const image = env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DOCKER_IMAGE;
    if (image) this.containers.set(`image:${image}:env`, { image: sanitizeText(image), source: 'env' });
  }

  collectManifest(value: unknown, source = 'manifest') {
    if (!isRecord(value)) return;
    this.collectRefs(value, source);
    this.collectRunnerOptions(value, source);
    this.collectProcessLike(recordAt(value, 'process'), `${source}:process`);
    for (const entry of recordList(value.processes)) this.collectProcessLike(entry, `${source}:processes`);
    for (const entry of recordList(value.resourceNotes)) this.collectProcessNote(entry, `${source}:resourceNotes`);
    for (const entry of recordList(value.cleanup)) this.collectCleanup(entry, `${source}:cleanup`);
    this.collectNestedManifestRecords(value, source, 0);
  }

  collectProcessNote(value: unknown, source = 'process-note') {
    if (!isRecord(value)) return;
    const noteSource = stringAt(value, 'sourceRef') ?? source;
    this.collectRefs(value, noteSource);
    this.collectRunnerOptions(value, noteSource);
    this.collectProcessLike(value, noteSource);
    this.collectCleanup(recordAt(value, 'cleanup'), `${noteSource}:cleanup`);
  }

  refs(): ComputerUseChatLiveResourceDiagnostics['refs'] {
    return {
      manifestRefs: sorted(this.manifestRefs),
      runDirRefs: sorted(this.runDirRefs),
      hostPortsRefs: sorted(this.hostPortsRefs),
      producerDiagnosticRefs: sorted(this.producerDiagnosticRefs),
      completionDiagnosticRefs: sorted(this.completionDiagnosticRefs),
      acceptanceManifestRefs: sorted(this.acceptanceManifestRefs),
      stagingDirRefs: sorted(this.stagingDirRefs),
    };
  }

  resources(): ComputerUseChatLiveResourceDiagnostics['resources'] {
    return {
      ports: sortedValues(this.ports, (item) => `${item.port}:${item.kind}:${item.source}`),
      processes: sortedValues(this.processes, (item) => `${item.pid}:${item.source}`),
      containers: sortedValues(this.containers, (item) => `${item.name ?? ''}:${item.id ?? ''}:${item.source}`),
      cleanup: sortedValues(this.cleanup, (item) => `${item.resourceKind}:${item.source}`),
      timeouts: sortedValues(this.timeouts, (item) => `${item.source}:${item.timeoutMs ?? ''}`),
    };
  }

  private collectRefs(record: Record<string, unknown>, source: string) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') this.collectRefValue(key, value);
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === 'string') this.collectRefValue(key, item);
      }
    }
    const runDirRef = stringAt(record, 'runDirRef') ?? runDirRefFromRefs([...this.manifestRefs]);
    if (runDirRef) this.runDirRefs.add(normalizeRef(runDirRef));
    for (const key of ['sourceDirRef', 'stagingDirRef', 'runDirStagingRef', 'dockerSourceDirRef']) {
      const ref = stringAt(record, key);
      if (ref) this.stagingDirRefs.add(normalizeRef(ref));
    }
    const sourceDir = stringAt(record, 'sourceDir') ?? stringAt(record, 'stagingDir') ?? stringAt(record, 'runDirStaging');
    if (sourceDir) this.stagingDirRefs.add(sanitizeText(sourceDir));
    const manifestRef = stringAt(record, 'manifestRef') ?? stringAt(record, 'recordRef');
    if (manifestRef) this.addManifestRef(manifestRef);
    if (source.includes('manifest')) this.collectManifestRefFromSource(source);
  }

  private collectNestedManifestRecords(record: Record<string, unknown>, source: string, depth: number) {
    if (depth >= 4) return;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'process' || key === 'processes' || key === 'resourceNotes' || key === 'cleanup') continue;
      if (isRecord(value)) {
        const nestedSource = `${source}:${key}`;
        this.collectRefs(value, nestedSource);
        this.collectRunnerOptions(value, nestedSource);
        this.collectProcessLike(recordAt(value, 'process'), `${nestedSource}:process`);
        for (const entry of recordList(value.processes)) this.collectProcessLike(entry, `${nestedSource}:processes`);
        for (const entry of recordList(value.resourceNotes)) this.collectProcessNote(entry, `${nestedSource}:resourceNotes`);
        for (const entry of recordList(value.cleanup)) this.collectCleanup(entry, `${nestedSource}:cleanup`);
        this.collectNestedManifestRecords(value, nestedSource, depth + 1);
      } else if (Array.isArray(value)) {
        value.filter(isRecord).forEach((entry, index) => {
          const nestedSource = `${source}:${key}[${index}]`;
          this.collectRefs(entry, nestedSource);
          this.collectRunnerOptions(entry, nestedSource);
          this.collectProcessLike(recordAt(entry, 'process'), `${nestedSource}:process`);
          for (const cleanup of recordList(entry.cleanup)) this.collectCleanup(cleanup, `${nestedSource}:cleanup`);
          this.collectNestedManifestRecords(entry, nestedSource, depth + 1);
        });
      }
    }
  }

  private collectRefValue(key: string, value: string) {
    const ref = normalizeRef(value);
    if (!isResourceRef(ref)) return;
    this.addManifestRef(ref);
    if (/\/host-ports\.json$/i.test(ref)) this.hostPortsRefs.add(ref);
    if (/\/embedded-l3-completion-producer-diagnostics\.json$/i.test(ref)) this.producerDiagnosticRefs.add(ref);
    if (/\/completion-grade-diagnostics\.json$/i.test(ref)) this.completionDiagnosticRefs.add(ref);
    if (/\/cu-user-acceptance-manifest\.json$/i.test(ref)) this.acceptanceManifestRefs.add(ref);
    const runDir = runDirRefFromRefs([ref]);
    if (runDir) this.runDirRefs.add(runDir);
    if (/sourceDirRef|stagingDirRef|runDirStagingRef|dockerSourceDirRef/i.test(key)) this.stagingDirRefs.add(ref);
  }

  private collectManifestRefFromSource(source: string) {
    if (source === 'manifest') return;
    const ref = normalizeRef(source.replace(/^manifest:/, ''));
    if (isResourceRef(ref)) this.addManifestRef(ref);
  }

  private collectRunnerOptions(record: Record<string, unknown>, source: string) {
    const runnerOptions = isRecord(record.runnerOptions) ? record.runnerOptions : record;
    this.collectPort(runnerOptions, 'vncPort', 'vnc', source);
    this.collectPort(runnerOptions, 'novncPort', 'novnc', source);
    this.collectPort(runnerOptions, 'uiPort', 'ui', source);
    this.collectPort(runnerOptions, 'workspacePort', 'workspace-writer', source);
    this.collectPort(runnerOptions, 'runtimeCodexPort', 'runtime-codex', source);
    this.collectPort(runnerOptions, 'agentServerPort', 'runtime-codex', source);
    this.collectPort(runnerOptions, 'proxyPort', 'provider-proxy', source);
    const dockerImage = stringAt(runnerOptions, 'dockerImage');
    if (dockerImage) {
      this.containers.set(`image:${dockerImage}:${source}`, {
        image: sanitizeText(dockerImage),
        source,
      });
    }
  }

  private collectPort(record: Record<string, unknown>, key: string, kind: ResourcePortDiagnostic['kind'], source: string) {
    const port = positiveInt(record[key]);
    if (port) this.ports.set(`${port}:${kind}:${source}`, { port, kind, source });
  }

  private collectProcessLike(value: unknown, source: string) {
    if (!isRecord(value)) return;
    const kind = processKind(value);
    this.collectPort(value, 'port', portKind(value), source);
    this.collectPort(value, 'actualPort', portKind(value), source);
    const pids = processPids(value);
    for (const { pid, role } of pids) {
      this.processes.set(`${pid}:${source}:${role}`, {
        pid,
        kind,
        source,
        label: sanitizeOptional([
          stringAt(value, 'label') ?? stringAt(value, 'service') ?? stringAt(value, 'command'),
          role === 'pid' ? '' : role,
        ].filter(Boolean).join(':')),
        cleanup: normalizeCleanup(recordAt(value, 'cleanup'), source, 'process'),
      });
    }
    const containerId = stringAt(value, 'containerId') ?? stringAt(value, 'container');
    const containerName = stringAt(value, 'containerName') ?? stringAt(value, 'name');
    if (containerId || containerName) {
      this.containers.set(`${containerId ?? ''}:${containerName ?? ''}:${source}`, {
        id: sanitizeOptional(containerId),
        name: sanitizeOptional(containerName),
        image: sanitizeOptional(stringAt(value, 'image') ?? stringAt(value, 'dockerImage')),
        source,
        cleanup: normalizeCleanup(recordAt(value, 'cleanup'), source, 'container'),
      });
    }
    const timeout = normalizeTimeout(value, source);
    if (timeout) this.timeouts.set(`${source}:${timeout.timeoutMs ?? ''}`, timeout);
    const cleanup = normalizeCleanup(recordAt(value, 'cleanup'), source, pids.length ? 'process' : containerId || containerName ? 'container' : 'unknown');
    if (cleanup) this.cleanup.set(`${cleanup.source}:${cleanup.resourceKind}`, cleanup);
    for (const arg of stringList(value.args)) this.collectDockerArg(arg, source);
  }

  private collectDockerArg(arg: string, source: string) {
    const publish = arg.match(/^127\.0\.0\.1:(\d+):(\d+)$/);
    if (publish) this.ports.set(`${publish[1]}:novnc:${source}:docker-arg`, {
      port: Number(publish[1]),
      kind: 'novnc',
      source: `${source}:docker-arg`,
    });
    if (arg.startsWith('/tmp/') || arg.includes('sciforge-cu-l3-docker-')) this.stagingDirRefs.add(sanitizeText(arg));
  }

  private collectCleanup(value: unknown, source: string) {
    const cleanup = normalizeCleanup(value, source, 'unknown');
    if (cleanup) this.cleanup.set(`${cleanup.source}:${cleanup.resourceKind}`, cleanup);
  }

  private addManifestRef(ref: string) {
    const normalized = normalizeRef(ref);
    if (normalized && isResourceRef(normalized)) this.manifestRefs.add(normalized);
  }
}

function sanitizedResourceEnv(env: Record<string, string | undefined>) {
  const result: Record<string, string> = {};
  for (const key of RESOURCE_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) result[key] = sanitizeText(value);
  }
  return result;
}

function resourceIssues(resources: ComputerUseChatLiveResourceDiagnostics['resources']) {
  const issues: string[] = [];
  for (const timeout of resources.timeouts) {
    if (timeout.timedOut) {
      issues.push(`resource-timeout:${timeout.source}:${timeout.timeoutMs ?? 'unknown-ms'}`);
    }
  }
  for (const cleanup of resources.cleanup) {
    if (cleanup.released === false || cleanup.result === 'failed') {
      issues.push(`resource-cleanup-not-released:${cleanup.resourceKind}:${cleanup.source}`);
    }
  }
  for (const process of resources.processes) {
    if (!process.cleanup && !resources.cleanup.some((cleanup) => cleanup.resourceKind === 'process')) {
      issues.push(`resource-process-cleanup-missing:${process.pid}:${process.source}`);
    }
  }
  for (const container of resources.containers) {
    if ((container.id || container.name) && !container.cleanup && !resources.cleanup.some((cleanup) => cleanup.resourceKind === 'container')) {
      issues.push(`resource-container-cleanup-missing:${container.name ?? container.id}:${container.source}`);
    }
  }
  return [...new Set(issues.map(sanitizeText))];
}

function normalizeCleanup(value: unknown, source: string, fallbackKind: ResourceCleanupDiagnostic['resourceKind']): ResourceCleanupDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  const released = booleanAt(value, 'released') ?? booleanAt(value, 'stopped') ?? booleanAt(value, 'removed');
  const attempted = booleanAt(value, 'attempted');
  const result = stringAt(value, 'result');
  const normalizedResult = result === 'released' || result === 'failed' || result === 'unknown'
    ? result
    : released === true
      ? 'released'
      : released === false
        ? 'failed'
        : 'unknown';
  return {
    source,
    resourceKind: cleanupKind(stringAt(value, 'resourceKind') ?? stringAt(value, 'kind')) ?? fallbackKind,
    attempted,
    released,
    method: sanitizeOptional(stringAt(value, 'method')),
    result: normalizedResult,
    error: sanitizeOptional(stringAt(value, 'error') ?? stringAt(value, 'reason')),
  };
}

function normalizeTimeout(value: Record<string, unknown>, source: string): ResourceTimeoutDiagnostic | undefined {
  const timedOut = booleanAt(value, 'timedOut') ?? booleanAt(value, 'timeout');
  const timeoutMs = positiveInt(value.timeoutMs) ?? secondsToMs(value.timeoutSeconds);
  if (timedOut === undefined && timeoutMs === undefined) return undefined;
  return {
    source,
    timedOut: timedOut === true,
    timeoutMs,
    code: typeof value.code === 'number' ? value.code : null,
    signal: sanitizeOptional(stringAt(value, 'signal')) ?? null,
  };
}

function processKind(value: Record<string, unknown>): ResourceProcessDiagnostic['kind'] {
  const raw = `${stringAt(value, 'kind') ?? ''} ${stringAt(value, 'label') ?? ''} ${stringAt(value, 'service') ?? ''} ${stringAt(value, 'command') ?? ''}`.toLowerCase();
  if (raw.includes('producer') || raw.includes('docker') || raw.includes('python')) return 'producer';
  if (raw.includes('server') || raw.includes('workspace') || raw.includes('ui')) return 'server';
  return 'unknown';
}

function portKind(value: Record<string, unknown>): ResourcePortDiagnostic['kind'] {
  const raw = `${stringAt(value, 'kind') ?? ''} ${stringAt(value, 'label') ?? ''} ${stringAt(value, 'service') ?? ''} ${stringAt(value, 'command') ?? ''}`.toLowerCase();
  if (raw.includes('workspace')) return 'workspace-writer';
  if (raw.includes('codex') || raw.includes('agent')) return 'runtime-codex';
  if (raw.includes('proxy')) return 'provider-proxy';
  if (raw.includes('novnc')) return 'novnc';
  if (raw.includes('vnc')) return 'vnc';
  if (raw.includes('ui') || raw.includes('vite')) return 'ui';
  return 'unknown';
}

function processPids(value: Record<string, unknown>) {
  const pairs = [
    ['pid', positiveInt(value.pid)],
    ['serverPid', positiveInt(value.serverPid)],
    ['childPid', positiveInt(value.childPid)],
    ['launcherPid', positiveInt(value.launcherPid)],
  ] as const;
  const seen = new Set<number>();
  const pids: { pid: number; role: string }[] = [];
  for (const [role, pid] of pairs) {
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    pids.push({ pid, role });
  }
  return pids;
}

function cleanupKind(value: string | undefined): ResourceCleanupDiagnostic['resourceKind'] | undefined {
  if (value === 'process' || value === 'container' || value === 'port' || value === 'run-dir' || value === 'staging-dir') return value;
  return undefined;
}

function runDirRefFromRefs(refs: string[]) {
  for (const ref of refs) {
    const normalized = normalizeRef(ref);
    const match = normalized.match(/^(.*?\.sciforge\/vision-runs\/[^/]+)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function isResourceRef(ref: string) {
  return RESOURCE_REF_PATTERN.test(ref) && !/^https?:\/\//i.test(ref);
}

function normalizeRef(value: string) {
  return sanitizeText(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function sanitizeOptional(value: string | undefined) {
  return value ? sanitizeText(value) : undefined;
}

function sanitizeText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replace(/\b(token|api[_-]?key|authorization|password|secret|model)=([^\s"',}]+)/gi, '$1=[redacted-secret]')
    .replace(/\b(Authorization|X-Api-Key|Api-Key)\s*:\s*(?:Bearer\s+)?[^\s"',}]+/gi, '$1: [redacted-secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-secret]')
    .trim();
}

function stringAt(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanAt(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  return typeof record[key] === 'boolean' ? record[key] : undefined;
}

function recordAt(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  return isRecord(record[key]) ? record[key] : undefined;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function positiveInt(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function secondsToMs(value: unknown) {
  const seconds = positiveInt(value);
  return seconds ? seconds * 1000 : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sorted(set: Set<string>) {
  return [...set].sort();
}

function sortedValues<T>(map: Map<string, T>, keyOf: (item: T) => string) {
  return [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

async function readJsonFiles(paths: string[]) {
  const records: unknown[] = [];
  for (const path of paths) {
    records.push(JSON.parse(await readFile(resolve(path), 'utf8')) as unknown);
  }
  return records;
}

async function readLifecycleJsonNotes(paths: string[], sourceKind: string) {
  const records: unknown[] = [];
  for (const path of uniqueStrings(paths)) {
    const absolute = resolve(path);
    if (!await isFile(absolute)) continue;
    const parsed = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
    if (isRecord(parsed)) {
      records.push({
        ...parsed,
        sourceRef: normalizeRef(path),
        label: stringAt(parsed, 'service') ?? stringAt(parsed, 'label') ?? sourceKind,
      });
    } else {
      records.push(parsed);
    }
  }
  return records;
}

async function readCleanupNotes(paths: string[]) {
  const records: unknown[] = [];
  for (const path of uniqueStrings(paths)) {
    const absolute = resolve(path);
    if (!await isFile(absolute)) continue;
    const text = await readFile(absolute, 'utf8');
    const parsed = parseJsonMaybe(text);
    if (parsed !== undefined) {
      if (isRecord(parsed)) {
        records.push({
          ...parsed,
          sourceRef: normalizeRef(path),
          cleanup: recordAt(parsed, 'cleanup') ?? parsed,
        });
      } else {
        records.push(parsed);
      }
      continue;
    }
    records.push({
      label: `cleanup-note:${basename(path)}`,
      cleanup: {
        resourceKind: cleanupKindFromPath(path),
        attempted: /attempt|cleanup|kill|stop|terminate|remove|verified/i.test(text),
        released: /released|stopped|removed|terminated|verified not running|not running|closed/i.test(text)
          ? true
          : /failed|error|timeout|still running/i.test(text)
            ? false
            : undefined,
        method: firstLine(text),
      },
      sourceRef: normalizeRef(path),
    });
  }
  return records;
}

async function discoverLifecycleFiles(
  env: Record<string, string | undefined>,
  options: {
    lifecycleDirs?: string[];
    pidfilePaths?: string[];
    cleanupNotePaths?: string[];
    portOwnershipPaths?: string[];
  },
) {
  const lifecycleDirs = uniqueStrings([
    ...(options.lifecycleDirs ?? []),
    ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_LIFECYCLE_DIRS),
    ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_LIFECYCLE_DIR),
    defaultDevLifecycleDir(env),
  ].filter(Boolean) as string[]);
  const discovered = await discoverLifecycleDirFiles(lifecycleDirs);
  return {
    pidfilePaths: uniqueStrings([
      ...(options.pidfilePaths ?? []),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_PIDFILES),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_PIDFILE),
      ...defaultDevPidfilePaths(env),
      ...discovered.pidfilePaths,
    ]),
    cleanupNotePaths: uniqueStrings([
      ...(options.cleanupNotePaths ?? []),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_CLEANUP_NOTES),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_CLEANUP_NOTE),
      ...discovered.cleanupNotePaths,
    ]),
    portOwnershipPaths: uniqueStrings([
      ...(options.portOwnershipPaths ?? []),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_PORT_OWNERSHIP_FILES),
      ...splitPathList(env.SCIFORGE_LIVE_RESOURCE_PORT_OWNERSHIP_FILE),
      ...discovered.portOwnershipPaths,
    ]),
  };
}

async function discoverLifecycleDirFiles(dirs: string[]) {
  const pidfilePaths: string[] = [];
  const cleanupNotePaths: string[] = [];
  const portOwnershipPaths: string[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(resolve(dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(resolve(dir), entry);
      if (!await isFile(path)) continue;
      if (/(?:^|[-.])pid\.json$|pidfile/i.test(entry)) pidfilePaths.push(path);
      else if (/port[-_.]?ownership|host[-_.]?ports/i.test(entry)) portOwnershipPaths.push(path);
      else if (/cleanup|stale/i.test(entry)) cleanupNotePaths.push(path);
    }
  }
  return { pidfilePaths, cleanupNotePaths, portOwnershipPaths };
}

async function readPortOwnershipNotes(env: Record<string, string | undefined>, processNotes: unknown[]) {
  const ports = uniqueNumbers([
    ...RESOURCE_PORT_ENV_KEYS.map((key) => positiveInt(env[key])),
    ...processNotes.flatMap(portsFromRecord),
  ]);
  const notes: unknown[] = [];
  for (const port of ports) {
    for (const owner of await listeningPortOwners(port)) {
      notes.push({
        pid: owner.pid,
        port,
        kind: 'server',
        label: owner.command ? `port-${port}:${owner.command}` : `port-${port}`,
        cleanup: { resourceKind: 'process', result: 'unknown' },
        sourceRef: `port-ownership:${port}`,
      });
    }
  }
  return notes;
}

async function listeningPortOwners(port: number) {
  const stdout = await execFileText('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const owners: { pid: number; command?: string }[] = [];
  let currentPid: number | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) currentPid = positiveInt(line.slice(1));
    if (line.startsWith('c') && currentPid) {
      owners.push({ pid: currentPid, command: sanitizeText(line.slice(1)) });
      currentPid = undefined;
    }
  }
  return owners;
}

function portsFromRecord(value: unknown): number[] {
  if (!isRecord(value)) return [];
  return uniqueNumbers([
    positiveInt(value.port),
    positiveInt(value.actualPort),
    positiveInt(value.defaultPort),
    positiveInt(value.uiPort),
    positiveInt(value.workspacePort),
    positiveInt(value.runtimeCodexPort),
    positiveInt(value.agentServerPort),
    positiveInt(value.proxyPort),
  ]);
}

function defaultDevLifecycleDir(env: Record<string, string | undefined>) {
  const stateDir = env.SCIFORGE_STATE_DIR || 'workspace/parallel/p1/.sciforge';
  return resolve(stateDir, 'dev');
}

function defaultDevPidfilePaths(env: Record<string, string | undefined>) {
  const port = positiveInt(env.SCIFORGE_UI_PORT);
  if (!port) return [];
  const instance = env.SCIFORGE_INSTANCE_ID || env.SCIFORGE_INSTANCE || 'main';
  return [join(defaultDevLifecycleDir(env), `ui-${instance}-${port}.pid.json`)];
}

function splitPathList(value: string | undefined) {
  return value?.split(/[,:]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function parseJsonMaybe(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function cleanupKindFromPath(path: string): ResourceCleanupDiagnostic['resourceKind'] {
  const lower = path.toLowerCase();
  if (lower.includes('port')) return 'port';
  if (lower.includes('staging')) return 'staging-dir';
  if (lower.includes('run-dir')) return 'run-dir';
  if (lower.includes('container')) return 'container';
  if (lower.includes('process') || lower.includes('pid')) return 'process';
  return 'unknown';
}

function firstLine(text: string) {
  return sanitizeText(text.split(/\r?\n/).find((line) => line.trim()) ?? '');
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueNumbers(values: (number | undefined)[]) {
  return [...new Set(values.filter((value): value is number => typeof value === 'number'))];
}

function execFileText(command: string, args: string[]) {
  return new Promise<string>((resolveText) => {
    execFile(command, args, { timeout: 1500 }, (error, stdout) => {
      resolveText(error ? '' : stdout.toString());
    });
  });
}

function parseNoteJson(values: string[]) {
  return values.map((value) => JSON.parse(value) as unknown);
}

function parseCliArgs(argv: string[]) {
  const options: {
    lifecycleDirs: string[];
    pidfilePaths: string[];
    cleanupNotePaths: string[];
    portOwnershipPaths: string[];
    manifestPaths: string[];
    manifestRefs: string[];
    notePaths: string[];
    noteJson: string[];
    out?: string;
  } = {
    lifecycleDirs: [],
    pidfilePaths: [],
    cleanupNotePaths: [],
    portOwnershipPaths: [],
    manifestPaths: [],
    manifestRefs: [],
    notePaths: [],
    noteJson: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lifecycle-dir') options.lifecycleDirs.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--pidfile') options.pidfilePaths.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--cleanup-note') options.cleanupNotePaths.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--port-ownership') options.portOwnershipPaths.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--manifest') options.manifestPaths.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--manifest-ref') options.manifestRefs.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--note') options.notePaths.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--note-json') options.noteJson.push(readArgValue(argv, index += 1, arg));
    else if (arg === '--out') options.out = readArgValue(argv, index += 1, arg);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: tsx tools/computer-use-chat-live-resource-diagnostics.ts [options]

Normalizes live Computer Use resource cleanup diagnostics without touching the live matrix runner.

Options:
  --lifecycle-dir <path> Read lifecycle pidfile, cleanup note, and port ownership files. Repeatable.
  --pidfile <path>       Read a service lifecycle pidfile JSON file. Repeatable.
  --cleanup-note <path>  Read a cleanup note JSON/text file. Repeatable.
  --port-ownership <path> Read a port ownership JSON file. Repeatable.
  --manifest <path>      Read a manifest/diagnostic JSON file. Repeatable.
  --manifest-ref <ref>   Add an already-known manifest ref. Repeatable.
  --note <path>          Read a process/resource note JSON file. Repeatable.
  --note-json <json>     Add an inline process/resource note. Repeatable.
  --out <path>           Write diagnostics JSON. Prints JSON when omitted.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readArgValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const diagnostics = await runComputerUseChatLiveResourceDiagnostics(options);
    if (!options.out) console.log(JSON.stringify(diagnostics, null, 2));
    if (diagnostics.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
