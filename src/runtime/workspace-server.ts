import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { spawn as spawnPty, type IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { WebSocket, WebSocketServer } from 'ws';
import { runSciForgeTool } from './sciforge-tools.js';
import { syncRepairResultToGithubIssue } from './github-repair-sync.js';
import {
  appendRepairTerminalMirrorEntry,
  parseRepairTerminalMirrorNdjson,
  runRepairHandoff,
  stopRepairHandoffRun,
} from './repair-handoff-runner.js';
import type { RepairConfirmationPolicy, RepairHandoffRunnerContract } from './repair-handoff-runner.js';
import { buildStableVersionSyncPlan, promoteStableVersion, readStableVersion, stableVersionRegistryPath } from './stable-version-registry.js';
import { normalizeWorkspaceRootPath, resolveWorkspacePreviewRef } from './workspace-paths.js';
import { isRecord, readJson, readOptionalJson, safeName, writeJson } from './server/http.js';
import { createDetachedStreamResponse } from './server/detached-stream.js';
import {
  WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
} from '@sciforge-ui/runtime-contract';
import {
  previewDerivativeForRef,
  previewDescriptorForRef,
  previewRequestBaseUrl,
  streamWorkspacePreviewFile,
} from './server/file-preview.js';
import { handleScenarioLibraryRoutes } from './server/scenario-library-routes.js';
import { handleWorkspaceFileApiRoutes, readLastWorkspacePath } from './server/workspace-file-api.js';
import { CODEX_RUNTIME_WEBSOCKET_PATH, handleCodexRuntimeRoutes, handleCodexRuntimeUpgrade } from './codex/codex-runtime-server.js';
import { CodexExecJsonAdapter } from './codex/codex-exec-json-adapter.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex/codex-runtime-config.js';
import { normalizeInstanceName, parallelProfile } from './parallel-instance-profile.js';
import { assertCodexNoForkGate } from '../../packages/backend/src/codex-compatibility-gate.js';
import {
  DEFAULT_PROXY_BASE_URL,
  ensureRuntimeHome,
  resolveRuntimeCodexSandbox,
  RUNTIME_PROFILE,
  RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
} from '../../packages/backend/src/runtime-home.js';
import { resolveProxyCliOptions } from '../../packages/backend/src/cli-config.js';
import { startCodexResponsesProxyServer, type StartedCodexResponsesProxy } from '../../packages/backend/src/proxy.js';

const INSTANCE_ID = process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || 'default';
const INSTANCE_ROLE = process.env.SCIFORGE_INSTANCE_ROLE || INSTANCE_ID;
const DEFAULT_PARALLEL_INSTANCE_ID = normalizeParallelInstanceId(INSTANCE_ID);
const DEFAULT_PARALLEL_PROFILE = parallelProfile(DEFAULT_PARALLEL_INSTANCE_ID);
const PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || DEFAULT_PARALLEL_PROFILE.workspacePort);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || DEFAULT_PARALLEL_PROFILE.uiPort);
const DEFAULT_PARALLEL_STATE_DIR = join(process.cwd(), DEFAULT_PARALLEL_PROFILE.stateDir);
const DEFAULT_PARALLEL_WORKSPACE_PATH = join(process.cwd(), DEFAULT_PARALLEL_PROFILE.workspacePath);
const STATE_DIR = resolve(process.env.SCIFORGE_STATE_DIR || DEFAULT_PARALLEL_STATE_DIR);
const LOG_DIR = resolve(process.env.SCIFORGE_LOG_DIR || join(STATE_DIR, 'logs'));
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || join(process.cwd(), DEFAULT_PARALLEL_PROFILE.configPath));
const DEFAULT_WORKSPACE_PATH = normalizeWorkspaceRootPath(resolve(process.env.SCIFORGE_WORKSPACE_PATH || DEFAULT_PARALLEL_WORKSPACE_PATH));
const REPAIR_EVIDENCE_PUBLIC_DIR = toPosixPath(process.env.SCIFORGE_REPAIR_EVIDENCE_PUBLIC_DIR || 'repair-evidence/public');
const REPAIR_EVIDENCE_PRIVATE_DIR = toPosixPath(process.env.SCIFORGE_REPAIR_EVIDENCE_PRIVATE_DIR || 'repair-evidence/private');
const REPAIR_EVIDENCE_PUBLIC_BASE_URL = (process.env.SCIFORGE_REPAIR_EVIDENCE_PUBLIC_BASE_URL || '').trim();
const REPAIR_EVIDENCE_UPLOAD_DIR = process.env.SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR ? resolve(process.env.SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR) : '';
const STARTED_AT = new Date().toISOString();
const LIFECYCLE_TOKEN = process.env.SCIFORGE_SERVICE_LIFECYCLE_TOKEN || '';

function normalizeParallelInstanceId(value: string) {
  const normalized = normalizeInstanceName(value);
  return /^p[1-8]$/.test(normalized) ? normalized : 'p1';
}

type FeedbackCodexTerminalStatus = 'starting' | 'running' | 'idle' | 'failed' | 'cancelled';
type FeedbackCodexTerminalTransport = 'websocket-pty';

interface FeedbackCodexTerminalSession {
  schemaVersion: 1;
  id: string;
  issueId: string;
  repairRunId: string;
  status: FeedbackCodexTerminalStatus;
  workspacePath: string;
  terminalMirrorRef: string;
  promptRef: string;
  promptPreview?: string;
  codexSessionId?: string;
  startedAt: string;
  updatedAt: string;
  message?: string;
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  transport: FeedbackCodexTerminalTransport;
  webSocketPath?: string;
}

interface ActiveFeedbackCodexTerminalSession extends FeedbackCodexTerminalSession {
  ptyProcess?: IPty;
  ptyBacklog?: string[];
  ptySockets?: Set<WebSocket>;
}

const activeFeedbackCodexTerminalSessions = new Map<string, ActiveFeedbackCodexTerminalSession>();
const feedbackCodexPtyWss = new WebSocketServer({ noServer: true });
let managedRuntimeProviderProxy: Promise<StartedCodexResponsesProxy | undefined> | undefined;

const workspaceServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/health') {
    writeJson(res, 200, {
      ok: true,
      service: 'sciforge-workspace-writer',
      schemaVersion: 1,
      pid: process.pid,
      startedAt: STARTED_AT,
      instanceId: INSTANCE_ID,
      lifecycleToken: LIFECYCLE_TOKEN || undefined,
      capabilities: [
        'workspace-snapshot',
        'workspace-files',
        'sciforge-tools',
        'repair-handoff-runner',
        'feedback-direct-codex-terminal-websocket-pty',
        'feedback-repair-terminal-mirror-tail',
        'feedback-repair-stop-request',
        'feedback-repair-guidance-input',
        'feedback-scrubbed-screenshot-evidence-assets',
        'feedback-repair-evidence-store',
        'feedback-repair-evidence-upload',
        'runtime-provider-preflight-manifest',
        'runtime-codex-browser-acceptance-manifest',
        'stable-version-registry',
      ],
      endpoints: {},
    });
    return;
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/sciforge/config' && req.method === 'GET') {
    try {
      writeJson(res, 200, { ok: true, config: await readLocalSciForgeConfig() });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/config' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const config = isRecord(body.config) ? body.config : {};
      await writeLocalSciForgeConfig(config);
      writeJson(res, 200, { ok: true, config: await readLocalSciForgeConfig() });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/instance/manifest' && req.method === 'GET') {
    try {
      const root = await workspaceRootFromRequest(url);
      writeJson(res, 200, {
        ok: true,
        manifest: await buildInstanceManifest(root),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/runtime-provider-preflight/manifest' && req.method === 'GET') {
    try {
      const manifest = await readRuntimeProviderPreflightManifest();
      if (!manifest) {
        writeJson(res, 404, { ok: false, error: 'runtime provider preflight manifest not found; run npm run smoke:runtime-provider-preflight' });
      } else {
        writeJson(res, 200, { ok: true, manifest });
      }
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/runtime-codex-browser-acceptance/manifest' && req.method === 'GET') {
    try {
      const manifest = await readRuntimeCodexBrowserAcceptanceManifest();
      if (!manifest) {
        writeJson(res, 404, { ok: false, error: 'runtime codex browser acceptance manifest not found; run npm run smoke:runtime-codex-browser-acceptance' });
      } else {
        writeJson(res, 200, { ok: true, manifest });
      }
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/runtime/codex/stream') {
    const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
    if (await handleCodexRuntimeRoutes(req, res, url, new CodexExecJsonAdapter({ env: runtimeEnv }))) return;
  }
  if (await handleCodexRuntimeRoutes(req, res, url)) return;
  if (url.pathname === '/api/sciforge/instance/stable-version' && req.method === 'GET') {
    try {
      writeJson(res, 200, {
        ok: true,
        path: stableVersionRegistryPathForResponse(),
        stableVersion: await readStableVersion(STATE_DIR),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/instance/stable-version/promote' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const env = await stableVersionEnvironment(root);
      const promoted = await promoteStableVersion(env, body);
      writeJson(res, 200, { ok: true, path: promoted.path, stableVersion: promoted.record });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/instance/stable-version/sync-plan' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const env = await stableVersionEnvironment(root);
      writeJson(res, 200, {
        ok: true,
        plan: await buildStableVersionSyncPlan(env, body),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/repair-handoff/run' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const contract = normalizeRepairHandoffContract(body);
      const runtimeCodexEnv = contract.executorBackend === 'runtime-codex'
        ? await prepareRuntimeCodexEnvFromLocalConfig()
        : undefined;
      const result = await runRepairHandoff(contract, {
        executorRepoPath: contract.executorInstance.workspacePath || process.cwd(),
        executorStateDir: STATE_DIR,
        executorLogDir: LOG_DIR,
        executorConfigLocalPath: CONFIG_LOCAL_PATH,
        allowExecutorRepoTarget: contract.allowExecutorRepoTarget === true,
        runtimeCodexEnv,
        runtimeCodexServiceEnv: runtimeCodexEnv,
      });
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/repair-handoff/terminal-mirror' && req.method === 'GET') {
    try {
      const root = await workspaceRootFromRequest(url);
      const ref = url.searchParams.get('ref') || '';
      const cursor = Number(url.searchParams.get('cursor') || url.searchParams.get('after') || 0);
      const limit = Number(url.searchParams.get('limit') || 200);
      const terminalPath = resolveRepairTerminalMirrorRef(root, ref);
      const text = await readFile(terminalPath, 'utf8').catch((err: unknown) => {
        if (isNodeErrorCode(err, 'ENOENT')) return '';
        throw err;
      });
      const tail = parseRepairTerminalMirrorNdjson(text, {
        cursor: Number.isFinite(cursor) ? cursor : 0,
        limit: Number.isFinite(limit) ? limit : 200,
        terminalMirrorRef: terminalPath,
      });
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        tail,
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/repair-handoff/stop' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const repairRunId = typeof body.repairRunId === 'string' ? body.repairRunId.trim() : '';
      if (!repairRunId) throw new Error('repairRunId is required');
      const stop = await stopRepairHandoffRun(repairRunId, {
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy : 'feedback-inbox',
      });
      if (!stop.stopped && stop.status === 'not-running' && typeof body.terminalMirrorRef === 'string') {
        const root = await workspaceRootFromBodyOrRequest(body, url);
        const terminalPath = resolveRepairTerminalMirrorRef(root, body.terminalMirrorRef);
        await appendRepairTerminalMirrorEntry(terminalPath, 'stderr', `${stop.message} Stop request was recorded fail-closed by workspace writer.`);
        stop.terminalMirrorRef = terminalPath;
      }
      writeJson(res, 200, { ok: true, stop });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const feedbackCodexPtyTerminalMatch = /^\/api\/sciforge\/feedback\/codex-pty\/([^/]+)\/(stop|tail)$/.exec(url.pathname);
  if (feedbackCodexPtyTerminalMatch) {
    try {
      const sessionId = decodeURIComponent(feedbackCodexPtyTerminalMatch[1]);
      const action = feedbackCodexPtyTerminalMatch[2];
      if (action === 'tail' && req.method === 'GET') {
        const root = await workspaceRootFromRequest(url);
        const cursor = Number(url.searchParams.get('cursor') || url.searchParams.get('after') || 0);
        const limit = Number(url.searchParams.get('limit') || 200);
        const result = await loadFeedbackCodexPtyTerminalTail(root, sessionId, { cursor, limit });
        writeJson(res, 200, { ok: true, workspacePath: root, ...result });
        return;
      }
      if (action === 'stop' && req.method === 'POST') {
        const body = await readJson(req);
        const root = await workspaceRootFromBodyOrRequest(body, url);
        const session = await stopFeedbackCodexPtyTerminal(root, sessionId, body);
        writeJson(res, 200, { ok: true, workspacePath: root, session });
        return;
      }
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }
  if (url.pathname === '/api/sciforge/feedback/issues' && req.method === 'GET') {
    try {
      const root = await workspaceRootFromRequest(url);
      const state = await readWorkspaceStateFile(root);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        issues: buildFeedbackIssueSummaries(state),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/feedback/comments' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const bundle = await recordFeedbackCommentBundle(root, body);
      writeJson(res, 200, { ok: true, workspacePath: root, bundle });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, 400, { ok: false, error: message });
    }
    return;
  }
  const feedbackIssueMatch = /^\/api\/sciforge\/feedback\/issues\/([^/]+)(?:\/(repair-runs|repair-result))?$/.exec(url.pathname);
  if (feedbackIssueMatch) {
    const issueId = decodeURIComponent(feedbackIssueMatch[1]);
    const action = feedbackIssueMatch[2];
    if (!action && req.method === 'GET') {
      try {
        const root = await workspaceRootFromRequest(url);
        const state = await readWorkspaceStateFile(root);
        const bundle = await buildFeedbackIssueBundle(root, state, issueId);
        writeJson(res, 200, { ok: true, workspacePath: root, issue: bundle });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeJson(res, message.includes('not found') ? 404 : 400, { ok: false, error: message });
      }
      return;
    }
    if (action === 'repair-runs' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const root = await workspaceRootFromBodyOrRequest(body, url);
        const run = await recordFeedbackRepairRun(root, issueId, body);
        writeJson(res, 200, { ok: true, workspacePath: root, run });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeJson(res, message.includes('not found') ? 404 : 400, { ok: false, error: message });
      }
      return;
    }
    if (action === 'repair-result' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const root = await workspaceRootFromBodyOrRequest(body, url);
        const result = await recordFeedbackRepairResult(root, issueId, body);
        writeJson(res, 200, { ok: true, workspacePath: root, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeJson(res, message.includes('not found') ? 404 : 400, { ok: false, error: message });
      }
      return;
    }
  }
  const feedbackRepairActionMatch = /^\/api\/sciforge\/feedback\/issues\/([^/]+)\/repair-actions$/.exec(url.pathname);
  if (feedbackRepairActionMatch && req.method === 'POST') {
    try {
      const issueId = decodeURIComponent(feedbackRepairActionMatch[1]);
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const actionResult = await runFeedbackRepairAction(root, issueId, body);
      writeJson(res, 200, { ok: true, workspacePath: root, ...actionResult });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, /not found/i.test(message) ? 404 : 400, { ok: false, error: message });
    }
    return;
  }
  const feedbackRepairGuidanceMatch = /^\/api\/sciforge\/feedback\/issues\/([^/]+)\/repair-guidance$/.exec(url.pathname);
  if (feedbackRepairGuidanceMatch && req.method === 'POST') {
    try {
      const issueId = decodeURIComponent(feedbackRepairGuidanceMatch[1]);
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const guidance = await runFeedbackRepairGuidance(root, issueId, body);
      writeJson(res, 200, { ok: true, workspacePath: root, guidance });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, /not found/i.test(message) ? 404 : 400, { ok: false, error: message });
    }
    return;
  }
  const feedbackCodexPtyTerminalStartMatch = /^\/api\/sciforge\/feedback\/issues\/([^/]+)\/codex-pty\/start$/.exec(url.pathname);
  if (feedbackCodexPtyTerminalStartMatch && req.method === 'POST') {
    try {
      const issueId = decodeURIComponent(feedbackCodexPtyTerminalStartMatch[1]);
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const result = await startFeedbackCodexPtyTerminal(root, issueId, body);
      writeJson(res, 200, { ok: true, workspacePath: root, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, /not found/i.test(message) ? 404 : 400, { ok: false, error: message });
    }
    return;
  }
  const feedbackEvidenceUploadMatch = /^\/api\/sciforge\/feedback\/issues\/([^/]+)\/evidence\/upload$/.exec(url.pathname);
  if (feedbackEvidenceUploadMatch && req.method === 'POST') {
    try {
      const issueId = decodeURIComponent(feedbackEvidenceUploadMatch[1]);
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const upload = await uploadFeedbackEvidenceAssets(root, issueId, body);
      writeJson(res, 200, { ok: true, workspacePath: root, ...upload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, /not found/i.test(message) ? 404 : 400, { ok: false, error: scrubFeedbackError(message) });
    }
    return;
  }
  if (await handleWorkspaceFileApiRoutes(req, res, url, {
    stateDir: STATE_DIR,
    workspaceOpenDryRun: process.env.SCIFORGE_WORKSPACE_OPEN_DRY_RUN === '1',
  })) return;
  if (url.pathname === '/api/sciforge/preview/raw' && req.method === 'GET') {
    try {
      const filePath = await resolveWorkspacePreviewRefForServer(
        url.searchParams.get('ref') || url.searchParams.get('path') || '',
        url.searchParams.get('workspacePath') || '',
      );
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`${filePath} is not a file`);
      streamWorkspacePreviewFile(req, res, filePath, info.size);
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/preview/descriptor' && req.method === 'GET') {
    try {
      const ref = url.searchParams.get('ref') || url.searchParams.get('path') || '';
      const workspacePath = url.searchParams.get('workspacePath') || '';
      const descriptor = await previewDescriptorForRef(ref, workspacePath, previewRequestBaseUrl(req, PORT));
      writeJson(res, 200, { ok: true, descriptor });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/preview/derivative' && req.method === 'GET') {
    try {
      const ref = url.searchParams.get('ref') || '';
      const workspacePath = url.searchParams.get('workspacePath') || '';
      const kind = url.searchParams.get('kind') || '';
      const derivative = await previewDerivativeForRef(ref, workspacePath, kind);
      writeJson(res, 200, { ok: true, derivative });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (await handleScenarioLibraryRoutes(req, res, url)) return;
  if (url.pathname === '/api/sciforge/tools/run' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const result = await runSciForgeTool(body);
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/tools/run/stream' && req.method === 'POST') {
    const stream = createDetachedStreamResponse(res);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    try {
      const body = await readJson(req);
      const result = await runSciForgeTool(body, {
        signal: stream.signal,
        onEvent(event) {
          stream.write({ event });
        },
      });
      stream.write({ result });
    } catch (err) {
      stream.write({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      stream.end();
    }
    return;
  }
  writeJson(res, 404, { ok: false, error: 'not found' });
});

workspaceServer.on('upgrade', handleWorkspaceUpgrade);

workspaceServer.listen(PORT, '127.0.0.1', () => {
  console.log(`SciForge workspace writer: http://127.0.0.1:${PORT}`);
});

function handleWorkspaceUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === CODEX_RUNTIME_WEBSOCKET_PATH) {
    void (async () => {
      const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
      if (!handleCodexRuntimeUpgrade(req, socket, head, new CodexExecJsonAdapter({ env: runtimeEnv }))) socket.destroy();
    })().catch(() => socket.destroy());
    return;
  }
  handleFeedbackCodexPtyUpgrade(req, socket, head);
}

function handleFeedbackCodexPtyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const match = /^\/api\/sciforge\/feedback\/codex-pty\/([^/]+)\/ws$/.exec(url.pathname);
  if (!match) {
    socket.destroy();
    return;
  }
  feedbackCodexPtyWss.handleUpgrade(req, socket, head, (ws) => {
    void connectFeedbackCodexPtySocket(ws, decodeURIComponent(match[1]), url).catch((err: unknown) => {
      ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      ws.close(1011, 'codex pty unavailable');
    });
  });
}

async function connectFeedbackCodexPtySocket(ws: WebSocket, sessionId: string, url: URL) {
  const requestedRoot = url.searchParams.get('workspacePath')?.trim();
  const session = activeFeedbackCodexTerminalSessions.get(sessionId)
    ?? (requestedRoot ? await activeOrStoredFeedbackCodexTerminalSession(normalizeWorkspaceRootPath(resolve(requestedRoot)), sessionId) : undefined);
  if (!session || session.transport !== 'websocket-pty') {
    ws.send(JSON.stringify({ type: 'error', message: `Codex PTY session not found: ${sessionId}` }));
    ws.close(1011, 'codex pty session not found');
    return;
  }
  session.ptySockets = session.ptySockets ?? new Set();
  session.ptySockets.add(ws);
  ws.send(JSON.stringify({ type: 'status', session: feedbackCodexTerminalPublicSession(session) }));
  for (const chunk of session.ptyBacklog ?? []) {
    ws.send(JSON.stringify({ type: 'output', data: chunk }));
  }
  ws.on('message', (raw) => {
    const message = parseFeedbackCodexPtyClientMessage(raw.toString());
    if (!message) return;
    if (message.type === 'input') {
      if (session.ptyProcess) session.ptyProcess.write(message.data);
      else ws.send(JSON.stringify({ type: 'error', message: 'Codex PTY process is not running.' }));
    }
    if (message.type === 'resize' && session.ptyProcess) {
      session.ptyProcess.resize(message.cols, message.rows);
    }
    if (message.type === 'stop') {
      void stopFeedbackCodexPtyTerminal(session.workspacePath, session.id, { reason: 'websocket stop request' }).catch(() => undefined);
    }
  });
  ws.on('close', () => {
    session.ptySockets?.delete(ws);
  });
}

function parseFeedbackCodexPtyClientMessage(raw: string):
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'stop' }
  | undefined {
  const parsed = safeParseJson(raw);
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
  if (parsed.type === 'input') {
    return { type: 'input', data: typeof parsed.data === 'string' ? parsed.data : '' };
  }
  if (parsed.type === 'resize') {
    return {
      type: 'resize',
      cols: ptyDimension(parsed.cols, 110, 40, 240),
      rows: ptyDimension(parsed.rows, 28, 12, 80),
    };
  }
  if (parsed.type === 'stop') return { type: 'stop' };
  return undefined;
}

function broadcastFeedbackCodexPty(session: ActiveFeedbackCodexTerminalSession, payload: Record<string, unknown>) {
  const text = JSON.stringify(payload);
  for (const socket of session.ptySockets ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }
}

function broadcastFeedbackCodexPtyStatus(session: ActiveFeedbackCodexTerminalSession) {
  broadcastFeedbackCodexPty(session, { type: 'status', session: feedbackCodexTerminalPublicSession(session) });
}

function normalizeRepairHandoffContract(body: Record<string, unknown>): RepairHandoffRunnerContract {
  const contract = isRecord(body.contract) ? body.contract : body;
  if (!isRecord(contract.executorInstance)) throw new Error('executorInstance is required');
  if (!isRecord(contract.targetInstance)) throw new Error('targetInstance is required');
  if (!isRecord(contract.issueBundle)) throw new Error('issueBundle is required');
  return {
    executorInstance: normalizeRepairHandoffInstance(contract.executorInstance),
    targetInstance: normalizeRepairHandoffInstance(contract.targetInstance),
    targetWorkspacePath: typeof contract.targetWorkspacePath === 'string' ? contract.targetWorkspacePath : '',
    targetWorkspaceWriterUrl: typeof contract.targetWorkspaceWriterUrl === 'string' ? contract.targetWorkspaceWriterUrl : '',
    issueBundle: contract.issueBundle,
    expectedTests: Array.isArray(contract.expectedTests) ? contract.expectedTests.filter((item) => typeof item === 'string' || isRecord(item)) as Array<string | { name?: string; command: string }> : [],
    githubSyncRequired: contract.githubSyncRequired === true,
    agentServerBaseUrl: typeof contract.agentServerBaseUrl === 'string' ? contract.agentServerBaseUrl : undefined,
    repairRunId: typeof contract.repairRunId === 'string' ? contract.repairRunId : undefined,
    executorBackend: contract.executorBackend === 'runtime-codex' ? 'runtime-codex' : contract.executorBackend === 'agent-server' ? 'agent-server' : undefined,
    runtimeProfile: typeof contract.runtimeProfile === 'string' ? contract.runtimeProfile : undefined,
    allowOpenAiRuntime: contract.allowOpenAiRuntime === true,
    allowExecutorRepoTarget: contract.allowExecutorRepoTarget === true,
    initialGuidance: typeof contract.initialGuidance === 'string' ? contract.initialGuidance : undefined,
    allowedWritePaths: stringArray(contract.allowedWritePaths),
    forbiddenWritePaths: stringArray(contract.forbiddenWritePaths),
    requestMetadata: isRecord(contract.requestMetadata) ? contract.requestMetadata : undefined,
    confirmationPolicy: normalizeRepairConfirmationPolicy(contract.confirmationPolicy),
  };
}

function normalizeRepairConfirmationPolicy(value: unknown): RepairConfirmationPolicy | undefined {
  if (!isRecord(value)) return undefined;
  return {
    commit: value.commit === 'requires-user-confirmation' ? 'requires-user-confirmation' : 'disabled',
    push: value.push === 'requires-second-confirmation' ? 'requires-second-confirmation' : 'disabled',
    pr: value.pr === 'requires-second-confirmation' ? 'requires-second-confirmation' : 'disabled',
    merge: 'never',
  };
}

function normalizeRepairHandoffInstance(value: Record<string, unknown>) {
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    appUrl: typeof value.appUrl === 'string' ? value.appUrl : undefined,
    workspaceWriterUrl: typeof value.workspaceWriterUrl === 'string' ? value.workspaceWriterUrl : undefined,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : undefined,
  };
}

async function workspaceRootFromRequest(url: URL) {
  const requested = url.searchParams.get('workspacePath')?.trim() || url.searchParams.get('path')?.trim() || '';
  if (requested) return normalizeWorkspaceRootPath(resolve(requested));
  const configured = await readLocalSciForgeConfig().catch(() => undefined);
  if (configured?.workspacePath) return normalizeWorkspaceRootPath(resolve(configured.workspacePath));
  return readLastWorkspacePath(STATE_DIR);
}

async function workspaceRootFromBodyOrRequest(body: Record<string, unknown>, url: URL) {
  const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
  if (workspacePath) return normalizeWorkspaceRootPath(resolve(workspacePath));
  return workspaceRootFromRequest(url);
}

async function readWorkspaceStateFile(root: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(root, '.sciforge', 'workspace-state.json'), 'utf8'));
  if (!isRecord(parsed)) throw new Error('workspace-state.json is invalid');
  return parsed;
}

async function readWorkspaceStateFileOrDefault(root: string): Promise<Record<string, unknown>> {
  try {
    return await readWorkspaceStateFile(root);
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
    return {
      schemaVersion: 1,
      workspacePath: root,
      feedbackComments: [],
      feedbackRequests: [],
      feedbackRepairRuns: [],
      feedbackRepairResults: [],
      feedbackRepairActions: [],
      feedbackRepairGuidance: [],
      githubSyncedOpenIssues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeWorkspaceStateFile(root: string, state: Record<string, unknown>) {
  await mkdir(join(root, '.sciforge'), { recursive: true });
  await writeFile(join(root, '.sciforge', 'workspace-state.json'), JSON.stringify(state, null, 2));
}

async function buildInstanceManifest(root: string) {
  const state = await readWorkspaceStateFile(root).catch(() => undefined);
  const config = await readWorkspaceConfig(root);
  const localConfig = await readLocalSciForgeConfig();
  const repo = await readRepoInfo(root);
  const stableVersion = await readStableVersion(STATE_DIR);
  return {
    schemaVersion: 1,
    agentId: INSTANCE_ID,
    role: INSTANCE_ROLE,
    appPort: UI_PORT,
    workspaceWriterPort: PORT,
    appUrl: `http://127.0.0.1:${UI_PORT}`,
    workspaceWriterUrl: localConfig.workspaceWriterBaseUrl,
    agentServerBaseUrl: localConfig.agentServerBaseUrl,
    repoPath: process.cwd(),
    stateDir: STATE_DIR,
    logDir: LOG_DIR,
    configLocalPath: CONFIG_LOCAL_PATH,
    counterpart: parseJsonEnv(process.env.SCIFORGE_COUNTERPART_JSON),
    generatedAt: new Date().toISOString(),
    instance: {
      id: INSTANCE_ID !== 'default' ? INSTANCE_ID : instanceIdForWorkspace(root, state),
      name: typeof config.name === 'string' && config.name.trim() ? config.name.trim() : basename(root) || 'SciForge workspace',
      role: INSTANCE_ROLE,
    },
    workspacePath: root,
    repo,
    stableVersion,
    capabilities: [
      'instance-manifest',
      'stable-version-registry',
      'stable-version-promote',
      'stable-version-sync-plan',
      'feedback-issues-list',
      'feedback-issue-handoff-bundle',
      'feedback-comment-evidence-persistence',
      'feedback-direct-codex-terminal-websocket-pty',
      'feedback-repair-run-record',
      'feedback-repair-result-record',
      'feedback-repair-terminal-mirror-tail',
      'feedback-repair-stop-request',
      'feedback-repair-guidance-input',
      'feedback-scrubbed-screenshot-evidence-assets',
      'feedback-repair-evidence-store',
      'feedback-repair-evidence-upload',
      'runtime-provider-preflight-manifest',
      'runtime-codex-browser-acceptance-manifest',
      'repair-handoff-runner',
      'workspace-snapshot',
      'workspace-files',
      WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
      'sciforge-tools',
    ],
  };
}

async function stableVersionEnvironment(root: string) {
  const repo = await readRepoInfo(root);
  return {
    instanceId: INSTANCE_ID !== 'default' ? INSTANCE_ID : instanceIdForWorkspace(root, await readWorkspaceStateFile(root).catch(() => undefined)),
    role: INSTANCE_ROLE,
    stateDir: STATE_DIR,
    repoRoot: repo.detected && typeof repo.root === 'string' ? repo.root : root,
    branch: repo.detected && typeof repo.branch === 'string' ? repo.branch : undefined,
    commit: repo.detected && typeof repo.commit === 'string' ? repo.commit : undefined,
  };
}

async function readRuntimeProviderPreflightManifest() {
  const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
  const proxyOptions = resolveProxyCliOptions([], runtimeEnv);
  const runtimeApiKeyPresentInServiceEnv = Boolean(stringValue(runtimeEnv.SCIFORGE_RUNTIME_API_KEY));
  const upstreamBaseUrlPresent = Boolean(proxyOptions.upstreamBaseUrl);
  const upstreamKeySourceKind = runtimeApiKeyPresentInServiceEnv ? 'env' : 'missing';
  const upstreamBaseUrlSourceKind = stringValue(runtimeEnv.SCIFORGE_PROXY_UPSTREAM_BASE_URL) ? 'env' : upstreamBaseUrlPresent ? 'config' : 'missing';
  const checkedHealthz = runtimeApiKeyPresentInServiceEnv && upstreamBaseUrlPresent
    ? await requestRuntimeProviderProxyHealthz(runtimeEnv)
    : undefined;
  const category = runtimeProviderPreflightCategory({
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    healthzCategory: checkedHealthz?.category,
  });
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamKeySourceKind,
    upstreamBaseUrlSourceKind,
    category,
    owner: runtimeProviderPreflightOwner(category),
    policyViolations: [],
    missingEnv: [
      ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
      ...(upstreamBaseUrlPresent ? [] : ['SCIFORGE_PROXY_UPSTREAM_BASE_URL']),
    ],
    evidenceMode: 'current-env-diagnostic-only',
    checkedHealthz,
    nextActions: runtimeProviderPreflightNextActions({
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      category,
    }),
  };
}

async function requestRuntimeProviderProxyHealthz(env: NodeJS.ProcessEnv) {
  const baseUrl = runtimeProviderProxyBaseUrl(env);
  try {
    const response = await fetch(`${baseUrl}/healthz?check=upstream`, { signal: AbortSignal.timeout(3_500) });
    const parsed = await response.json().catch(() => ({}));
    const upstream = isRecord(parsed) && isRecord(parsed.upstream) ? parsed.upstream : {};
    const category = stringValue(upstream.category) || (response.ok ? 'ready' : 'unknown');
    return {
      category,
      ok: upstream.ok === true || category === 'ready',
      retryable: upstream.retryable === true,
      ...(typeof upstream.httpStatus === 'number' ? { httpStatus: upstream.httpStatus } : {}),
      releaseAcceptance: 'not-evaluated' as const,
    };
  } catch {
    return {
      category: 'upstream-outage',
      ok: false,
      retryable: true,
      releaseAcceptance: 'not-evaluated' as const,
    };
  }
}

function runtimeProviderProxyBaseUrl(env: NodeJS.ProcessEnv) {
  const configured = stringValue(env.SCIFORGE_PROXY_BASE_URL) || DEFAULT_PROXY_BASE_URL;
  const trimmed = configured.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

function runtimeProviderPreflightCategory(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  healthzCategory?: string;
}) {
  if (!input.runtimeApiKeyPresentInServiceEnv) return 'missing-runtime-env';
  if (!input.upstreamBaseUrlPresent) return 'missing-upstream';
  if (isRuntimeProviderPreflightCategory(input.healthzCategory)) return input.healthzCategory;
  return 'unknown';
}

function isRuntimeProviderPreflightCategory(value: string | undefined) {
  return value === 'ready'
    || value === 'provider-auth'
    || value === 'rate-limited'
    || value === 'upstream-outage'
    || value === 'repo-bug';
}

function runtimeProviderPreflightOwner(category: string) {
  if (category === 'provider-auth' || category === 'rate-limited' || category === 'upstream-outage') return 'provider';
  if (category === 'repo-bug' || category === 'unknown') return 'repo';
  return 'environment';
}

function runtimeProviderPreflightNextActions(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  category: string;
}) {
  const actions: Array<{ label: string; command?: string; writesRepo: boolean }> = [];
  if (!input.runtimeApiKeyPresentInServiceEnv) {
    actions.push({
      label: 'Set SCIFORGE_RUNTIME_API_KEY in the Runtime Codex launch environment.',
      writesRepo: false,
    });
  }
  if (!input.upstreamBaseUrlPresent) {
    actions.push({
      label: 'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or ignored local provider base URL for the Runtime Codex proxy.',
      writesRepo: false,
    });
  }
  if (input.category === 'provider-auth' || input.category === 'rate-limited' || input.category === 'upstream-outage') {
    actions.push({
      label: `Resolve provider-side ${input.category} before live repair can pass.`,
      writesRepo: false,
    });
  }
  actions.push({
    label: 'Rerun provider preflight and strict Runtime Codex browser acceptance.',
    command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
    writesRepo: true,
  });
  return actions;
}

async function readRuntimeCodexBrowserAcceptanceManifest() {
  const manifestPath = runtimeCodexBrowserAcceptanceManifestPath();
  const parsed = await readOptionalJson(manifestPath);
  if (!parsed) return undefined;
  if (!isRecord(parsed)) throw new Error('runtime codex browser acceptance manifest is invalid');
  const manifest = {
    schemaVersion: parsed.schemaVersion,
    status: stringValue(parsed.status),
    source: stringValue(parsed.source),
    observedAt: stringValue(parsed.observedAt) || undefined,
    actualUrl: stringValue(parsed.actualUrl) || undefined,
    actualPort: typeof parsed.actualPort === 'number' ? parsed.actualPort : undefined,
    workspacePath: stringValue(parsed.workspacePath) || undefined,
    provider: stringValue(parsed.provider) || undefined,
    model: stringValue(parsed.model) || undefined,
    commandId: stringValue(parsed.commandId) || undefined,
    startedFromDefaultChatEntry: parsed.startedFromDefaultChatEntry === true,
    submittedThroughRuntimeCodex: parsed.submittedThroughRuntimeCodex === true,
    providerModelProfileVisible: parsed.providerModelProfileVisible === true,
    mainAnswerVisible: parsed.mainAnswerVisible === true,
    rawAuditFoldedByDefault: parsed.rawAuditFoldedByDefault === true,
    acceptanceConclusionFromRealBrowser: parsed.acceptanceConclusionFromRealBrowser === true,
    currentRunEvidenceScope: stringValue(parsed.currentRunEvidenceScope) || undefined,
    reason: stringValue(parsed.reason) || undefined,
    blocker: stringValue(parsed.blocker) || undefined,
    blockedOn: stringArray(parsed.blockedOn),
    failureClass: stringValue(parsed.failureClass) || undefined,
    owner: stringValue(parsed.owner) || undefined,
    policyViolations: stringArray(parsed.policyViolations),
    missingEnv: stringArray(parsed.missingEnv),
    expectedRetestCommand: stringValue(parsed.expectedRetestCommand) || undefined,
    releaseBlocking: parsed.releaseBlocking === true,
    releaseEligible: parsed.releaseEligible === true,
    providerPreflightRef: stringValue(parsed.providerPreflightRef) || undefined,
    providerPreflightCategory: stringValue(parsed.providerPreflightCategory) || undefined,
    providerPreflightCheckedAt: stringValue(parsed.providerPreflightCheckedAt) || undefined,
    providerPreflightReleaseAcceptance: stringValue(parsed.providerPreflightReleaseAcceptance) || undefined,
    providerPreflightEvidenceMode: stringValue(parsed.providerPreflightEvidenceMode) || undefined,
    runtimeApiKeyPresentInServiceEnv: parsed.runtimeApiKeyPresentInServiceEnv === true,
    upstreamBaseUrlPresent: parsed.upstreamBaseUrlPresent === true,
    upstreamKeySourceKind: stringValue(parsed.upstreamKeySourceKind) || undefined,
    upstreamBaseUrlSourceKind: stringValue(parsed.upstreamBaseUrlSourceKind) || undefined,
    configPathsChecked: stringArray(parsed.configPathsChecked),
    configSecretFallbackPaths: stringArray(parsed.configSecretFallbackPaths),
    nextActions: Array.isArray(parsed.nextActions)
      ? parsed.nextActions.filter(isRecord).map((action) => ({
        label: stringValue(action.label),
        command: stringValue(action.command) || undefined,
        expected: stringValue(action.expected) || undefined,
        writesRepo: action.writesRepo === true,
      })).filter((action) => action.label)
      : [],
    evidence: isRecord(parsed.evidence) ? {
      screenshotPath: stringValue(parsed.evidence.screenshotPath) || undefined,
      domSnapshotPath: stringValue(parsed.evidence.domSnapshotPath) || undefined,
      notesPath: stringValue(parsed.evidence.notesPath) || undefined,
      runtimeAuditPath: stringValue(parsed.evidence.runtimeAuditPath) || undefined,
    } : undefined,
  };
  return {
    ...manifest,
    freshness: await runtimeCodexBrowserAcceptanceFreshness(manifest),
  };
}

function runtimeCodexBrowserAcceptanceManifestPath() {
  if (process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR?.trim()) {
    return join(resolve(process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR), 'manifest.json');
  }
  return /^p[2-8]$/.test(DEFAULT_PARALLEL_PROFILE.id)
    ? join(process.cwd(), 'docs', 'test-artifacts', 'parallel', DEFAULT_PARALLEL_PROFILE.id, 'manifest.json')
    : join(process.cwd(), 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance', 'manifest.json');
}

async function runtimeCodexBrowserAcceptanceFreshness(manifest: { status: string; observedAt?: string; evidence?: { screenshotPath?: string; domSnapshotPath?: string; notesPath?: string; runtimeAuditPath?: string } }) {
  if (manifest.status !== 'passed') return undefined;
  const observedAtMs = manifest.observedAt ? Date.parse(manifest.observedAt) : Number.NaN;
  const maxAgeMinutes = Number.parseFloat(process.env.SCIFORGE_BROWSER_ACCEPTANCE_MAX_AGE_MINUTES || '30');
  const mtimeToleranceMinutes = Number.parseFloat(process.env.SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_MTIME_TOLERANCE_MINUTES || '10');
  const maxAgeMs = (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 ? maxAgeMinutes : 30) * 60 * 1000;
  const mtimeToleranceMs = (Number.isFinite(mtimeToleranceMinutes) && mtimeToleranceMinutes >= 0 ? mtimeToleranceMinutes : 10) * 60 * 1000;
  const nowMs = Date.now();
  const observedAtFresh = Number.isFinite(observedAtMs)
    && observedAtMs <= nowMs + 5 * 60 * 1000
    && observedAtMs >= nowMs - maxAgeMs;
  const evidencePaths = [
    manifest.evidence?.screenshotPath,
    manifest.evidence?.domSnapshotPath,
    manifest.evidence?.notesPath,
    manifest.evidence?.runtimeAuditPath,
  ].filter((value): value is string => Boolean(value?.trim()));
  const staleEvidenceRefs: string[] = [];
  for (const evidencePath of evidencePaths) {
    const resolved = resolve(process.cwd(), evidencePath);
    try {
      const info = await stat(resolved);
      if (!info.isFile() || !Number.isFinite(observedAtMs) || info.mtimeMs < observedAtMs - mtimeToleranceMs) {
        staleEvidenceRefs.push(evidencePath);
      }
    } catch {
      staleEvidenceRefs.push(evidencePath);
    }
  }
  const evidenceFresh = evidencePaths.length > 0 && staleEvidenceRefs.length === 0;
  return {
    checkedAt: new Date().toISOString(),
    observedAtFresh,
    evidenceFresh,
    staleEvidenceRefs,
  };
}

function stableVersionRegistryPathForResponse() {
  return stableVersionRegistryPath(STATE_DIR);
}

function instanceIdForWorkspace(root: string, state: Record<string, unknown> | undefined) {
  if (state && typeof state.instanceId === 'string' && state.instanceId.trim()) return state.instanceId.trim();
  return `sciforge-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
}

async function readWorkspaceConfig(root: string): Promise<Record<string, unknown>> {
  const parsed = await readOptionalJson(join(root, '.sciforge', 'config.json'));
  return isRecord(parsed) ? parsed : {};
}

async function readRepoInfo(root: string) {
  const [topLevel, branch, commit] = await Promise.all([
    gitOutput(root, ['rev-parse', '--show-toplevel']),
    gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOutput(root, ['rev-parse', 'HEAD']),
  ]);
  if (!topLevel) return { detected: false };
  const remote = await gitOutput(root, ['config', '--get', 'remote.origin.url']);
  const status = await gitOutput(root, ['status', '--porcelain']);
  return {
    detected: true,
    root: topLevel,
    branch: branch || undefined,
    commit: commit || undefined,
    remote: remote || undefined,
    dirty: Boolean(status),
  };
}

async function gitOutput(cwd: string, args: string[]) {
  return new Promise<string>((resolveOutput) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', () => resolveOutput(''));
    child.on('close', (code) => resolveOutput(code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : ''));
  });
}

async function resolveWorkspacePreviewRefForServer(rawRef: string, workspacePath: string) {
  const direct = resolveWorkspacePreviewRef(rawRef, workspacePath);
  if (await stat(direct).catch(() => undefined)) return direct;
  const stripped = rawRef.trim().replace(/^(file|path|artifact):/i, '').replace(/\\/g, '/');
  if (!isRepairEvidenceRef(stripped) && !stripped.startsWith('docs/evidence/')) return direct;
  const workspaceRoot = workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : process.cwd();
  const repoRoot = await gitOutput(workspaceRoot, ['rev-parse', '--show-toplevel']);
  if (!repoRoot) return direct;
  const candidate = resolve(repoRoot, stripped);
  if (!isInsideOrSamePath(candidate, repoRoot)) return direct;
  if (await stat(candidate).catch(() => undefined)) return candidate;
  return direct;
}

function buildFeedbackIssueSummaries(state: Record<string, unknown>) {
  return handoffFeedbackComments(state).map((comment) => feedbackIssueSummary(state, comment));
}

async function buildFeedbackIssueBundle(root: string, state: Record<string, unknown>, issueId: string) {
  const comment = findFeedbackComment(state, issueId);
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const request = feedbackRequestForComment(state, comment);
  const github = githubMetadataForComment(state, comment);
  const canonicalIssueId = String(comment.id || issueId);
  return {
    ...feedbackIssueSummary(state, comment),
    schemaVersion: 1,
    workspacePath: root,
    request,
    comment,
    target: isRecord(comment.target) ? comment.target : undefined,
    runtime: isRecord(comment.runtime) ? comment.runtime : undefined,
    screenshot: screenshotMetadataForComment(comment),
    github,
    repairRuns: repairRecordsForIssue(state, 'feedbackRepairRuns', canonicalIssueId),
    repairResults: repairRecordsForIssue(state, 'feedbackRepairResults', canonicalIssueId),
  };
}

async function recordFeedbackRepairRun(root: string, issueId: string, body: Record<string, unknown>) {
  let state = await readWorkspaceStateFileOrDefault(root);
  let comment = findFeedbackComment(state, issueId);
  if (!comment) {
    const seedComment = feedbackCommentSeedFromBody(issueId, body);
    if (seedComment) {
      await recordFeedbackCommentBundle(root, { comment: seedComment });
      state = await readWorkspaceStateFileOrDefault(root);
      comment = findFeedbackComment(state, issueId) || findFeedbackComment(state, String(seedComment.id || issueId));
    }
  }
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const now = new Date().toISOString();
  const run = {
    schemaVersion: 1,
    id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `repair-run-${Date.now()}`,
    issueId: canonicalIssueId,
    status: 'running',
    externalInstanceId: typeof body.externalInstanceId === 'string' ? body.externalInstanceId : undefined,
    externalInstanceName: typeof body.externalInstanceName === 'string' ? body.externalInstanceName : undefined,
    actor: typeof body.actor === 'string' ? body.actor : undefined,
    startedAt: typeof body.startedAt === 'string' ? body.startedAt : now,
    handoffRef: typeof body.handoffRef === 'string' ? body.handoffRef : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    terminalMirrorRef: typeof body.terminalMirrorRef === 'string' ? body.terminalMirrorRef : undefined,
    terminalMirror: normalizeRepairTerminalMirror(body.terminalMirror),
    planRef: typeof body.planRef === 'string' ? body.planRef : undefined,
    baseCommit: typeof body.baseCommit === 'string' ? body.baseCommit : undefined,
    dirtyWorktreeDigest: typeof body.dirtyWorktreeDigest === 'string' ? body.dirtyWorktreeDigest : digestString(body.digests, 'dirtyWorktreeDigest'),
    protectedFilesDigest: typeof body.protectedFilesDigest === 'string' ? body.protectedFilesDigest : digestString(body.digests, 'protectedFilesDigest'),
    feedbackDataDigest: typeof body.feedbackDataDigest === 'string' ? body.feedbackDataDigest : digestString(body.digests, 'feedbackDataDigest'),
    confirmationPolicy: normalizeRepairConfirmationPolicy(body.confirmationPolicy),
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
  };
  const next = appendStateRecord(state, 'feedbackRepairRuns', run);
  await persistFeedbackRecord(root, 'repair-runs', run.id, run);
  await writeWorkspaceStateFile(root, next);
  return run;
}

async function recordFeedbackCommentBundle(root: string, body: Record<string, unknown>) {
  const rawComment = isRecord(body.comment) ? body.comment : isRecord(body.feedbackComment) ? body.feedbackComment : undefined;
  if (!rawComment) throw new Error('feedback comment is required');
  const sourceId = typeof rawComment.id === 'string' ? rawComment.id : typeof body.id === 'string' ? body.id : '';
  const id = normalizeFeedbackBundleId(sourceId);
  const now = new Date().toISOString();
  const screenshot = isRecord(rawComment.screenshot) ? rawComment.screenshot : undefined;
  const rawDataUrl = firstImageDataUrl([
    screenshot?.rawDataUrl,
    rawComment.rawScreenshotDataUrl,
    screenshot?.dataUrl,
  ], 'raw screenshot');
  const annotatedDataUrl = firstImageDataUrl([
    screenshot?.annotatedDataUrl,
    rawComment.annotatedScreenshotDataUrl,
  ], 'annotated screenshot');
  const bundleDir = join(root, '.sciforge', 'feedback', id);
  const rawScreenshotRef = rawDataUrl ? join('.sciforge', 'feedback', id, 'raw-screenshot.data-url') : undefined;
  const annotatedScreenshotRef = annotatedDataUrl ? join('.sciforge', 'feedback', id, 'annotated-screenshot.data-url') : undefined;
  const evidenceAssets = mergeEvidenceAssets(
    Array.isArray(rawComment.evidenceAssets) ? rawComment.evidenceAssets.filter(isRecord) : [],
    await persistFeedbackScreenshotEvidenceAssets(root, id, screenshot, rawDataUrl, annotatedDataUrl, now),
  );
  const comment = {
    ...rawComment,
    id,
    schemaVersion: rawComment.schemaVersion === 1 ? 1 : rawComment.schemaVersion,
    updatedAt: typeof rawComment.updatedAt === 'string' ? rawComment.updatedAt : now,
    evidenceBundleRef: join('.sciforge', 'feedback', id),
    rawScreenshotRef: typeof rawComment.rawScreenshotRef === 'string' ? rawComment.rawScreenshotRef : rawScreenshotRef,
    annotatedScreenshotRef: typeof rawComment.annotatedScreenshotRef === 'string' ? rawComment.annotatedScreenshotRef : annotatedScreenshotRef,
    evidenceAssets: evidenceAssets.length ? evidenceAssets : undefined,
    screenshot: screenshot ? {
      ...screenshot,
      rawScreenshotRef: typeof screenshot.rawScreenshotRef === 'string' ? screenshot.rawScreenshotRef : rawScreenshotRef,
      annotatedScreenshotRef: typeof screenshot.annotatedScreenshotRef === 'string' ? screenshot.annotatedScreenshotRef : annotatedScreenshotRef,
    } : undefined,
  };
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'comment.json'), JSON.stringify(comment, null, 2));
  if (rawDataUrl) await writeFile(join(bundleDir, 'raw-screenshot.data-url'), rawDataUrl);
  if (annotatedDataUrl) await writeFile(join(bundleDir, 'annotated-screenshot.data-url'), annotatedDataUrl);
  const state = await readWorkspaceStateFileOrDefault(root);
  await writeWorkspaceStateFile(root, appendStateRecord(state, 'feedbackComments', comment));
  return {
    schemaVersion: 1,
    id,
    commentRef: join('.sciforge', 'feedback', id, 'comment.json'),
    evidenceBundleRef: join('.sciforge', 'feedback', id),
    rawScreenshotRef,
    annotatedScreenshotRef,
    evidenceAssets,
    comment,
  };
}

async function recordFeedbackRepairResult(root: string, issueId: string, body: Record<string, unknown>) {
  let state = await readWorkspaceStateFileOrDefault(root);
  let comment = findFeedbackComment(state, issueId);
  if (!comment) {
    const seedComment = feedbackCommentSeedFromBody(issueId, body);
    if (seedComment) {
      await recordFeedbackCommentBundle(root, { comment: seedComment });
      state = await readWorkspaceStateFileOrDefault(root);
      comment = findFeedbackComment(state, issueId) || findFeedbackComment(state, String(seedComment.id || issueId));
    }
  }
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const now = new Date().toISOString();
  const rawResult = isRecord(body.result) ? body.result : body;
  const verdict = typeof rawResult.verdict === 'string' && ['fixed', 'partially-fixed', 'wont-fix', 'needs-follow-up', 'failed'].includes(rawResult.verdict)
    ? rawResult.verdict
    : 'needs-follow-up';
  const result = {
    schemaVersion: 1,
    id: typeof rawResult.id === 'string' && rawResult.id.trim() ? rawResult.id.trim() : `repair-result-${Date.now()}`,
    issueId: canonicalIssueId,
    repairRunId: typeof rawResult.repairRunId === 'string' ? rawResult.repairRunId : typeof body.repairRunId === 'string' ? body.repairRunId : undefined,
    verdict,
    summary: typeof rawResult.summary === 'string' ? rawResult.summary : '',
    changedFiles: Array.isArray(rawResult.changedFiles) ? rawResult.changedFiles.filter((item): item is string => typeof item === 'string') : [],
    diffRef: typeof rawResult.diffRef === 'string' ? rawResult.diffRef : undefined,
    commit: typeof rawResult.commit === 'string' ? rawResult.commit : undefined,
    evidenceRefs: Array.isArray(rawResult.evidenceRefs) ? rawResult.evidenceRefs.filter((item): item is string => typeof item === 'string') : [],
    testResults: normalizeRepairTestResults(rawResult.testResults),
    humanVerification: normalizeRepairHumanVerification(rawResult.humanVerification),
    refs: normalizeRepairRefs(rawResult.refs),
    executorInstance: normalizeRepairInstanceRef(rawResult.executorInstance),
    targetInstance: normalizeRepairInstanceRef(rawResult.targetInstance),
    followUp: typeof rawResult.followUp === 'string' ? rawResult.followUp : undefined,
    completedAt: typeof rawResult.completedAt === 'string' ? rawResult.completedAt : now,
    metadata: isRecord(rawResult.metadata) ? rawResult.metadata : undefined,
  };
  const safeMode = repairControlSurfaceSafeMode(result);
  result.metadata = {
    ...(isRecord(result.metadata) ? result.metadata : {}),
    safeMode,
  };
  const saved = updateRepairRunForResult(appendStateRecord(state, 'feedbackRepairResults', result), result);
  await persistFeedbackRecord(root, 'repair-results', result.id, result);
  await persistUpdatedRepairRunForResult(root, saved, result);
  await writeWorkspaceStateFile(root, saved);
  const githubSync = await syncRepairResultGithubComment(comment, result);
  const syncedResult = {
    ...result,
    githubSyncStatus: githubSync.status,
    githubSyncError: githubSync.error,
    githubSyncedAt: githubSync.syncedAt,
    githubCommentUrl: githubSync.commentUrl,
  };
  const next = updateRepairRunForResult(appendStateRecord(saved, 'feedbackRepairResults', syncedResult), syncedResult);
  await persistFeedbackRecord(root, 'repair-results', syncedResult.id, syncedResult);
  await persistUpdatedRepairRunForResult(root, next, syncedResult);
  await writeWorkspaceStateFile(root, next);
  return syncedResult;
}

function updateRepairRunForResult(state: Record<string, unknown>, result: Record<string, unknown>) {
  const repairRunId = typeof result.repairRunId === 'string' ? result.repairRunId.trim() : '';
  if (!repairRunId) return state;
  const runs = Array.isArray(state.feedbackRepairRuns) ? state.feedbackRepairRuns.filter(isRecord) : [];
  if (!runs.some((run) => run.id === repairRunId)) return state;
  const completedAt = typeof result.completedAt === 'string' ? result.completedAt : new Date().toISOString();
  return {
    ...state,
    feedbackRepairRuns: runs.map((run) => run.id === repairRunId
      ? {
        ...run,
        status: repairRunStatusForResult(result),
        completedAt,
        resultId: result.id,
        resultVerdict: result.verdict,
      }
      : run),
  };
}

async function persistUpdatedRepairRunForResult(root: string, state: Record<string, unknown>, result: Record<string, unknown>) {
  const repairRunId = typeof result.repairRunId === 'string' ? result.repairRunId.trim() : '';
  if (!repairRunId) return;
  const run = (Array.isArray(state.feedbackRepairRuns) ? state.feedbackRepairRuns.filter(isRecord) : [])
    .find((item) => item.id === repairRunId);
  if (run) await persistFeedbackRecord(root, 'repair-runs', repairRunId, run);
}

function repairRunStatusForResult(result: Record<string, unknown>) {
  if (result.verdict === 'fixed') return 'fixed';
  if (result.verdict === 'partially-fixed' || result.verdict === 'needs-follow-up') return 'needs-human-verification';
  return 'blocked';
}

async function uploadFeedbackEvidenceAssets(root: string, issueId: string, body: Record<string, unknown>) {
  const state = await readWorkspaceStateFileOrDefault(root);
  const comment = findFeedbackComment(state, issueId);
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const now = new Date().toISOString();
  const repoRoot = await gitOutput(root, ['rev-parse', '--show-toplevel']) || root;
  const assets = Array.isArray(comment.evidenceAssets) ? comment.evidenceAssets.filter(isRecord) : [];
  const diagnostics: string[] = [];
  if (!assets.some(isUploadableFeedbackEvidenceAsset)) {
    diagnostics.push('No uploadable scrubbed repair evidence assets are recorded for this feedback issue.');
  }
  const uploadConfig = {
    repo: normalizeGithubRepo(stringField(body.repo)),
    token: stringField(body.token),
    branch: stringField(body.branch) || await currentGitBranch(root),
    commitMessage: stringField(body.commitMessage) || `Upload SciForge feedback evidence ${canonicalIssueId}`,
    requestedBy: stringField(body.requestedBy) || 'feedback-inbox',
  };
  const uploadedAssets: Record<string, unknown>[] = [];
  const nextAssets: Record<string, unknown>[] = [];
  for (const asset of assets) {
    if (!isUploadableFeedbackEvidenceAsset(asset)) {
      nextAssets.push(asset);
      continue;
    }
    const uploaded = await uploadSingleFeedbackEvidenceAsset(repoRoot, canonicalIssueId, asset, uploadConfig, now).catch((err) => ({
      ...asset,
      uploadStatus: 'failed',
      uploadError: scrubFeedbackError(err instanceof Error ? err.message : String(err)),
      uploadedAt: now,
    }));
    nextAssets.push(uploaded);
    uploadedAssets.push(uploaded);
    const uploadError = stringField(uploaded.uploadError);
    if (uploadError) diagnostics.push(uploadError);
  }
  const nextComment = {
    ...comment,
    evidenceAssets: nextAssets.length ? nextAssets : undefined,
    updatedAt: now,
  };
  const comments = Array.isArray(state.feedbackComments) ? state.feedbackComments.filter(isRecord) : [];
  const nextState = {
    ...state,
    feedbackComments: comments.map((item) => item.id === comment.id ? nextComment : item),
    updatedAt: now,
  };
  await persistFeedbackCommentJson(root, canonicalIssueId, nextComment);
  await writeWorkspaceStateFile(root, nextState);
  await writeRepairEvidenceUploadIndex(repoRoot, canonicalIssueId, uploadedAssets, uploadConfig, diagnostics, now);
  return {
    schemaVersion: 1,
    issueId: canonicalIssueId,
    evidenceFolderRef: `${REPAIR_EVIDENCE_PUBLIC_DIR}/feedback-screenshots/${safeName(canonicalIssueId)}`,
    evidenceAssets: nextAssets,
    uploadedAssets,
    comment: nextComment,
    diagnostics,
  };
}

function isUploadableFeedbackEvidenceAsset(asset: Record<string, unknown>) {
  return stringField(asset.kind) === 'scrubbed-annotated-screenshot'
    && stringField(asset.ref).startsWith(`${REPAIR_EVIDENCE_PUBLIC_DIR}/`);
}

async function uploadSingleFeedbackEvidenceAsset(
  repoRoot: string,
  feedbackId: string,
  asset: Record<string, unknown>,
  config: { repo?: string; token: string; branch: string; commitMessage: string; requestedBy: string },
  uploadedAt: string,
) {
  const ref = stringField(asset.ref);
  const assetPath = resolve(repoRoot, ref);
  if (!isInsideOrSamePath(assetPath, repoRoot)) throw new Error('feedback evidence upload path escaped repo root');
  const bytes = await readFile(assetPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (stringField(asset.sha256) && stringField(asset.sha256) !== sha256) {
    throw new Error('feedback evidence upload blocked: stored sha256 no longer matches the file on disk');
  }
  if (config.repo && config.token) {
    const github = await uploadFeedbackEvidenceAssetToGithubContents(config.repo, config.token, config.branch, ref, bytes, config.commitMessage);
    const uploaded = {
      ...asset,
      sha256,
      publicUrl: github.downloadUrl,
      markdownImageUrl: github.downloadUrl,
      githubMarkdownUrl: github.downloadUrl,
      uploadRef: github.path,
      uploadProvider: 'github-contents',
      uploadStatus: 'uploaded',
      uploadedAt,
      uploadedBy: config.requestedBy,
      uploadCommitUrl: github.commitUrl,
      uploadBranch: github.branch,
      uploadError: undefined,
    };
    await rewriteFeedbackEvidenceManifest(repoRoot, feedbackId, uploaded);
    return uploaded;
  }
  const localUpload = await uploadFeedbackEvidenceAssetToConfiguredStore(ref, bytes, uploadedAt);
  if (localUpload) {
    const uploaded = {
      ...asset,
      sha256,
      publicUrl: localUpload.publicUrl,
      markdownImageUrl: localUpload.publicUrl || stringField(asset.markdownImageUrl) || ref,
      githubMarkdownUrl: localUpload.publicUrl || stringField(asset.githubMarkdownUrl) || ref,
      uploadRef: localUpload.uploadRef,
      uploadProvider: localUpload.provider,
      uploadStatus: localUpload.status,
      uploadedAt,
      uploadedBy: config.requestedBy,
      uploadError: undefined,
    };
    await rewriteFeedbackEvidenceManifest(repoRoot, feedbackId, uploaded);
    return uploaded;
  }
  const ready = {
    ...asset,
    sha256,
    uploadStatus: 'ready',
    uploadProvider: 'repair-evidence-folder',
    uploadError: 'No evidence uploader configured; asset is staged in repair-evidence/public and can be uploaded by setting SCIFORGE_REPAIR_EVIDENCE_PUBLIC_BASE_URL/SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR or using GitHub contents upload.',
    uploadedAt,
  };
  await rewriteFeedbackEvidenceManifest(repoRoot, feedbackId, ready);
  return ready;
}

async function uploadFeedbackEvidenceAssetToConfiguredStore(ref: string, bytes: Buffer, uploadedAt: string) {
  const publicUrl = repairEvidencePublicUrl(ref);
  if (REPAIR_EVIDENCE_UPLOAD_DIR) {
    const uploadPath = resolve(REPAIR_EVIDENCE_UPLOAD_DIR, ref);
    if (!isInsideOrSamePath(uploadPath, REPAIR_EVIDENCE_UPLOAD_DIR)) throw new Error('configured evidence upload path escaped upload dir');
    await mkdir(dirname(uploadPath), { recursive: true });
    await writeFile(uploadPath, bytes);
    return {
      provider: 'local-upload-dir',
      status: 'uploaded',
      uploadRef: toPosixPath(relative(REPAIR_EVIDENCE_UPLOAD_DIR, uploadPath)),
      publicUrl: publicUrl || toPosixPath(uploadPath),
      uploadedAt,
    };
  }
  if (publicUrl) {
    return {
      provider: 'public-base-url',
      status: 'ready',
      uploadRef: ref,
      publicUrl,
      uploadedAt,
    };
  }
  return undefined;
}

async function uploadFeedbackEvidenceAssetToGithubContents(repo: string, token: string, branch: string, path: string, bytes: Buffer, message: string) {
  const cleanBranch = branch && branch !== 'HEAD' ? branch : undefined;
  const sha = await readGithubContentsSha(repo, token, path, cleanBranch);
  const response = await githubJsonFetch(repo, token, `contents/${encodeGithubPath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: bytes.toString('base64'),
      ...(cleanBranch ? { branch: cleanBranch } : {}),
      ...(sha ? { sha } : {}),
    }),
  });
  const content = isRecord(response.content) ? response.content : {};
  const commit = isRecord(response.commit) ? response.commit : {};
  const downloadUrl = stringField(content.download_url)
    || `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(cleanBranch || 'HEAD')}/${encodeGithubPath(path)}`;
  return {
    path,
    branch: cleanBranch,
    downloadUrl,
    commitUrl: stringField(commit.html_url),
  };
}

async function readGithubContentsSha(repo: string, token: string, path: string, branch?: string) {
  try {
    const suffix = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const response = await githubJsonFetch(repo, token, `contents/${encodeGithubPath(path)}${suffix}`, { method: 'GET' });
    return isRecord(response) ? stringField(response.sha) : '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/GitHub API 404/.test(message)) return '';
    throw err;
  }
}

async function githubJsonFetch(repo: string, token: string, path: string, init: RequestInit) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  const parsed = text ? tryParseJson(text) : {};
  if (!response.ok) {
    const message = isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : text || response.statusText;
    throw new Error(`GitHub API ${response.status}: ${scrubFeedbackError(message)}`);
  }
  return isRecord(parsed) ? parsed : {};
}

async function persistFeedbackCommentJson(root: string, id: string, comment: Record<string, unknown>) {
  const bundleDir = join(root, '.sciforge', 'feedback', id);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'comment.json'), JSON.stringify(comment, null, 2));
}

async function rewriteFeedbackEvidenceManifest(repoRoot: string, feedbackId: string, asset: Record<string, unknown>) {
  const manifestRef = stringField(recordField(asset.metadata)?.manifestRef) || stringField(asset.manifestRef);
  if (!manifestRef) return;
  const manifestPath = resolve(repoRoot, manifestRef);
  if (!isInsideOrSamePath(manifestPath, repoRoot)) throw new Error('feedback evidence manifest path escaped repo root');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    ...asset,
    feedbackId,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

async function writeRepairEvidenceUploadIndex(
  repoRoot: string,
  feedbackId: string,
  uploadedAssets: Record<string, unknown>[],
  config: { repo?: string; branch: string; requestedBy: string },
  diagnostics: string[],
  uploadedAt: string,
) {
  const indexRef = repairEvidenceRelativeRef('public', feedbackId, 'upload-index.json');
  const indexPath = resolve(repoRoot, indexRef);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    feedbackId,
    uploadedAt,
    requestedBy: config.requestedBy,
    target: config.repo ? { provider: 'github-contents', repo: config.repo, branch: config.branch || undefined } : { provider: 'configured-store' },
    assets: uploadedAssets,
    diagnostics,
  }, null, 2));
}

async function currentGitBranch(root: string) {
  const branch = await gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch && branch !== 'HEAD' ? branch : '';
}

function normalizeGithubRepo(value: string) {
  const trimmed = value.trim().replace(/\.git$/i, '');
  if (!trimmed) return undefined;
  const fromUrl = /github\.com[/:]([^/]+)\/([^/?#]+)/i.exec(trimmed);
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2].replace(/\.git$/i, '')}`;
  return /^([\w.-]+)\/([\w.-]+)$/.test(trimmed) ? trimmed : undefined;
}

function encodeGithubPath(path: string) {
  return toPosixPath(path).split('/').map((part) => encodeURIComponent(part)).join('/');
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function runFeedbackRepairGuidance(root: string, issueId: string, body: Record<string, unknown>) {
  let state = await readWorkspaceStateFile(root);
  const comment = findFeedbackComment(state, issueId);
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const repairRunId = stringField(body.repairRunId);
  if (!repairRunId) throw new Error('repairRunId is required');
  const message = scrubGuidanceText(stringField(body.message));
  if (!message) throw new Error('guidance message is required');
  const now = new Date().toISOString();
  const run = findRepairRunForGuidance(state, canonicalIssueId, repairRunId);
  const result = findRepairResultForAction(state, canonicalIssueId, body.repairResultId) ?? findRepairResultByRunId(state, canonicalIssueId, repairRunId);
  const runMetadata = recordField(run?.metadata);
  const resultMetadata = recordField(result?.metadata);
  const agentServerRun = recordField(resultMetadata?.agentServerRun) ?? recordField(runMetadata?.agentServerRun);
  const resultRefs = recordField(result?.refs);
  const terminalMirrorRef = firstNonEmptyString(
    stringField(body.terminalMirrorRef),
    stringField(result?.terminalMirrorRef),
    stringField(run?.terminalMirrorRef),
    stringField(resultMetadata?.terminalMirrorRef),
    stringField(runMetadata?.terminalMirrorRef),
    stringField(resultRefs?.terminalMirrorRef),
  );
  const terminalMirrorPath = terminalMirrorRef ? resolveRepairTerminalMirrorRef(root, terminalMirrorRef) : undefined;
  const codexSessionId = firstNonEmptyString(
    stringField(body.codexSessionId),
    stringField(agentServerRun?.codexSessionId),
    stringField(agentServerRun?.nativeSessionId),
    stringField(resultMetadata?.codexSessionId),
    stringField(runMetadata?.codexSessionId),
  );
  const worktreeRef = firstNonEmptyString(
    stringField(resultMetadata?.isolatedWorktreePath),
    stringField(runMetadata?.isolatedWorktreePath),
    stringField(resultRefs?.worktreePath),
  );
  const guidanceId = `repair-guidance-${safeName(repairRunId)}-${Date.now()}`;
  let guidance: Record<string, unknown> = {
    schemaVersion: 1,
    id: guidanceId,
    issueId: canonicalIssueId,
    repairRunId,
    repairResultId: result && typeof result.id === 'string' ? result.id : stringField(body.repairResultId),
    status: 'recorded',
    requestedAt: now,
    requestedBy: stringField(body.requestedBy) || 'feedback-inbox',
    message,
    terminalMirrorRef: terminalMirrorPath ?? terminalMirrorRef,
    codexSessionId,
    metadata: {
      source: 'feedback-inbox-guidance',
      runtimeProfile: firstNonEmptyString(stringField(resultMetadata?.runtimeProfile), stringField(runMetadata?.runtimeProfile)),
      resumeAvailable: Boolean(codexSessionId && worktreeRef),
    },
  };
  state = await persistFeedbackRepairGuidance(root, state, guidance);
  if (terminalMirrorPath) {
    await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'event', `Feedback Inbox guidance recorded for ${repairRunId}: ${message}`);
  }
  if (!codexSessionId || !worktreeRef) {
    guidance = {
      ...guidance,
      status: 'recorded',
      responseSummary: codexSessionId
        ? 'Guidance was recorded; isolated repair worktree metadata is unavailable, so native resume was not dispatched.'
        : 'Guidance was recorded; no native Runtime Codex session id is available yet.',
      metadata: {
        ...(recordField(guidance.metadata) ?? {}),
        resumeAvailable: false,
        resumeBlockedReason: codexSessionId ? 'missing-isolated-worktree' : 'missing-codex-session-id',
      },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
    await persistFeedbackRepairGuidance(root, state, guidance);
    return guidance;
  }
  let worktreePath = '';
  try {
    worktreePath = resolveRepairWorktreeRef(root, worktreeRef);
  } catch (err) {
    guidance = {
      ...guidance,
      status: 'blocked',
      responseSummary: `Guidance resume blocked: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { ...(recordField(guidance.metadata) ?? {}), resumeAvailable: false, resumeBlockedReason: 'invalid-isolated-worktree' },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
    await persistFeedbackRepairGuidance(root, state, guidance);
    return guidance;
  }
  try {
    const runtimeCodexEnv = await prepareRuntimeCodexEnvFromLocalConfig();
    const adapter = new CodexExecJsonAdapter({ env: runtimeCodexEnv });
    const turn = await adapter.startTurn({
      commandText: repairGuidancePrompt({ issueId: canonicalIssueId, repairRunId, message }),
      workspacePath: worktreePath,
      commandId: `repair-guidance-${repairRunId}-${Date.now()}`,
      attemptId: `repair-guidance-${repairRunId}-attempt-${Date.now()}`,
      profile: firstNonEmptyString(stringField(resultMetadata?.runtimeProfile), stringField(runMetadata?.runtimeProfile)) || 'sciforge-runtime-deepseek',
      codexSessionId,
      allowOpenAiRuntime: false,
      guiExtension: { enabled: false },
    });
    let eventCount = 0;
    let status = 'resumed';
    for await (const event of turn.events) {
      eventCount += 1;
      if (terminalMirrorPath) {
        const eventRecord = recordField(event) ?? {};
        const stream = eventRecord.type === 'failed' || eventRecord.type === 'cancelled' ? 'stderr' : 'event';
        await appendRepairTerminalMirrorEntry(terminalMirrorPath, stream, terminalTextForGuidanceEvent(eventRecord));
      }
      const eventType = recordField(event)?.type;
      if (eventType === 'failed' || eventType === 'cancelled') status = 'blocked';
    }
    guidance = {
      ...guidance,
      status: status === 'blocked' ? 'blocked' : 'resumed',
      eventCount,
      responseSummary: status === 'blocked'
        ? 'Runtime Codex guidance resume ended with a blocked/failed event.'
        : 'Runtime Codex guidance resume completed.',
      metadata: {
        ...(recordField(guidance.metadata) ?? {}),
        resumeAvailable: true,
        isolatedWorktreePath: worktreePath,
        turnId: turn.turnId,
        attemptId: turn.attemptId,
      },
    };
  } catch (err) {
    guidance = {
      ...guidance,
      status: 'blocked',
      responseSummary: `Runtime Codex guidance resume failed closed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { ...(recordField(guidance.metadata) ?? {}), resumeAvailable: true, isolatedWorktreePath: worktreePath },
    };
    if (terminalMirrorPath) await appendRepairTerminalMirrorEntry(terminalMirrorPath, 'stderr', stringField(guidance.responseSummary));
  }
  await persistFeedbackRepairGuidance(root, state, guidance);
  return guidance;
}

async function persistFeedbackRepairGuidance(root: string, state: Record<string, unknown>, guidance: Record<string, unknown>) {
  const next = appendStateRecord(state, 'feedbackRepairGuidance', guidance);
  await persistFeedbackRecord(root, 'repair-guidance', String(guidance.id), guidance);
  await writeWorkspaceStateFile(root, next);
  return next;
}

function findRepairRunForGuidance(state: Record<string, unknown>, issueId: string, repairRunId: string) {
  const runs = Array.isArray(state.feedbackRepairRuns) ? state.feedbackRepairRuns.filter(isRecord) : [];
  return runs.find((run) => run.issueId === issueId && run.id === repairRunId)
    ?? runs.filter((run) => run.issueId === issueId)
      .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))[0];
}

function findRepairResultByRunId(state: Record<string, unknown>, issueId: string, repairRunId: string) {
  const results = Array.isArray(state.feedbackRepairResults) ? state.feedbackRepairResults.filter(isRecord) : [];
  return results.find((result) => result.issueId === issueId && result.repairRunId === repairRunId);
}

function resolveRepairWorktreeRef(root: string, ref: string) {
  const raw = ref.trim();
  if (!raw) throw new Error('isolated repair worktree ref is required');
  const candidate = resolve(raw.startsWith('/') ? raw : resolve(root, raw));
  const allowedRoots = [
    resolve(root, '.sciforge', 'repair-worktrees'),
    resolve(process.cwd(), '.sciforge', 'repair-worktrees'),
  ];
  if (!allowedRoots.some((allowedRoot) => isInsideOrSamePath(candidate, allowedRoot))) {
    throw new Error('isolated repair worktree ref must stay inside .sciforge/repair-worktrees');
  }
  return candidate;
}

function repairGuidancePrompt(input: { issueId: string; repairRunId: string; message: string }) {
  return [
    `Continue SciForge repair run ${input.repairRunId} for feedback issue ${input.issueId}.`,
    'Use the existing native Codex session context and the current isolated repair worktree.',
    'Treat the following text as human guidance from Feedback Inbox, not as a new issue bundle:',
    '',
    input.message,
    '',
    'Preserve feedback records, screenshots, terminal mirror, repair audit, and GitHub sync state.',
    'Do not commit, push, open a PR, merge, rewrite ignored secret config, or delete audit/evidence files.',
    'If the guidance changes the repair, update the repair plan or tests inside the isolated repair worktree and keep the patch scoped.',
  ].join('\n');
}

function terminalTextForGuidanceEvent(event: Record<string, unknown>) {
  const type = stringField(event.type) || 'event';
  const status = stringField(event.status);
  const message = stringField(event.message) || stringField(event.text) || stringField(event.summary);
  const exitCode = typeof event.exitCode === 'number' || event.exitCode === null ? ` exit=${event.exitCode}` : '';
  return [type, status ? `status=${status}` : '', message, exitCode].filter(Boolean).join(' ');
}

function scrubGuidanceText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/\/Users\/[^/\s]+/g, '[redacted-user-home]')
    .replace(/\/Applications\/workspace\/[^\s]+/g, '[redacted-workspace-path]')
    .replace(/\s+$/g, '')
    .slice(0, 2000);
}

async function startFeedbackCodexPtyTerminal(root: string, issueId: string, body: Record<string, unknown>) {
  const state = await readWorkspaceStateFile(root);
  const bundle = await buildFeedbackIssueBundle(root, state, issueId);
  const comment = isRecord(bundle.comment) ? bundle.comment : undefined;
  const canonicalIssueId = String(comment?.id || bundle.id || issueId);
  const sessionId = `codex-pty-terminal-${safeName(canonicalIssueId)}-${Date.now().toString(36)}`;
  const terminalMirrorRef = feedbackCodexTerminalMirrorRef(root, sessionId);
  const promptRef = feedbackCodexTerminalPromptRef(root, sessionId);
  const runtimeProfile = stringField(body.runtimeProfile) || RUNTIME_PROFILE;
  const allowOpenAiRuntime = body.allowOpenAiRuntime === true;
  const prompt = buildFeedbackCodexTerminalPrompt({
    root,
    bundle,
    issueId: canonicalIssueId,
    userGuidance: stringField(body.initialMessage),
  });
  await mkdir(dirname(promptRef), { recursive: true });
  await writeFile(promptRef, prompt);
  const now = new Date().toISOString();
  const webSocketPath = `/api/sciforge/feedback/codex-pty/${encodeURIComponent(sessionId)}/ws`;
  const session: ActiveFeedbackCodexTerminalSession = {
    schemaVersion: 1,
    id: sessionId,
    issueId: canonicalIssueId,
    repairRunId: sessionId,
    status: 'starting',
    workspacePath: root,
    terminalMirrorRef,
    promptRef,
    promptPreview: compactString(prompt, 900),
    startedAt: now,
    updatedAt: now,
    runtimeProfile,
    allowOpenAiRuntime,
    transport: 'websocket-pty',
    webSocketPath,
    ptyBacklog: [],
    ptySockets: new Set(),
    message: 'Direct Codex PTY terminal session is starting.',
  };
  activeFeedbackCodexTerminalSessions.set(session.id, session);
  await persistFeedbackCodexTerminalSession(session);
  await appendRepairTerminalMirrorEntry(terminalMirrorRef, 'event', `Direct Codex Terminal started for feedback ${canonicalIssueId}. Transport=websocket-pty; workspace=${root}`);
  await appendRepairTerminalMirrorEntry(terminalMirrorRef, 'event', `Generated feedback prompt saved at ${promptRef}.`);
  const repairRun = feedbackCodexTerminalRepairRun(session, comment, body);
  const next = appendStateRecord(state, 'feedbackRepairRuns', repairRun);
  await persistFeedbackRecord(root, 'repair-runs', repairRun.id, repairRun);
  await writeWorkspaceStateFile(root, next);
  await launchFeedbackCodexPtySession(session, prompt, body);
  return {
    session: feedbackCodexTerminalPublicSession(session),
    repairRun,
  };
}

async function launchFeedbackCodexPtySession(
  session: ActiveFeedbackCodexTerminalSession,
  prompt: string,
  body: Record<string, unknown>,
) {
  try {
    const runtimeCodexEnv = await prepareRuntimeCodexEnvFromLocalConfig();
    const config = await assertCodexRuntimeConfig({
      workspacePath: session.workspacePath,
      profile: session.runtimeProfile || RUNTIME_PROFILE,
      allowOpenAiRuntime: session.allowOpenAiRuntime === true,
      env: runtimeCodexEnv,
    });
    const runtimeSandbox = resolveRuntimeCodexSandbox(runtimeCodexEnv);
    const codexGate = assertCodexNoForkGate({ codexCommand: runtimeCodexEnv.SCIFORGE_RUNTIME_CODEX_COMMAND });
    const env = withCodexPtyPath(codexRuntimeEnv(runtimeCodexEnv, config.codexHome));
    const codexCommand = await resolveCodexPtyCommand(codexGate.codexCommand, env);
    const args = feedbackCodexPtyArgs({
      profile: config.profile,
      workspace: config.workspace,
      sandbox: runtimeSandbox,
      prompt,
    });
    const cols = ptyDimension(body.cols, 110, 40, 240);
    const rows = ptyDimension(body.rows, 28, 12, 80);
    await appendRepairTerminalMirrorEntry(
      session.terminalMirrorRef,
      'event',
      `Starting Codex PTY command: ${codexCommand} ${args.filter((arg) => arg !== prompt).join(' ')} [generated feedback prompt]`,
    );
    const ptyProcess = spawnPty(codexCommand, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.workspace,
      env,
    });
    session.ptyProcess = ptyProcess;
    session.ptyBacklog = [];
    session.ptySockets = session.ptySockets ?? new Set();
    session.status = 'running';
    session.message = 'Codex CLI is running in a WebSocket/xterm PTY.';
    session.updatedAt = new Date().toISOString();
    await persistFeedbackCodexTerminalSession(session);
    await persistDirectTerminalRepairRunStatus(session, 'running', session.message);
    broadcastFeedbackCodexPtyStatus(session);
    ptyProcess.onData((data) => {
      const chunk = data.slice(0, 12_000);
      session.ptyBacklog = [...(session.ptyBacklog ?? []), chunk].slice(-250);
      broadcastFeedbackCodexPty(session, { type: 'output', data: chunk });
      void appendRepairTerminalMirrorEntry(session.terminalMirrorRef, 'stdout', chunk).catch(() => undefined);
    });
    ptyProcess.onExit((event) => {
      void finishFeedbackCodexPtySession(session.id, event.exitCode, event.signal).catch(() => undefined);
    });
  } catch (err) {
    const message = `Direct Codex PTY dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
    session.status = 'failed';
    session.message = message;
    session.updatedAt = new Date().toISOString();
    await appendRepairTerminalMirrorEntry(session.terminalMirrorRef, 'stderr', message);
    await persistFeedbackCodexTerminalSession(session);
    await persistDirectTerminalRepairRunStatus(session, 'failed', message);
    broadcastFeedbackCodexPtyStatus(session);
    throw err;
  }
}

async function finishFeedbackCodexPtySession(sessionId: string, exitCode: number, signal?: number) {
  const session = activeFeedbackCodexTerminalSessions.get(sessionId);
  if (!session) return;
  session.ptyProcess = undefined;
  const finalStatus: FeedbackCodexTerminalStatus = exitCode === 0 ? 'idle' : 'failed';
  const message = exitCode === 0
    ? 'Codex PTY session completed; inspect output and verify the repair.'
    : `Codex PTY session exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}.`;
  session.status = finalStatus;
  session.message = message;
  session.updatedAt = new Date().toISOString();
  await appendRepairTerminalMirrorEntry(session.terminalMirrorRef, finalStatus === 'idle' ? 'event' : 'stderr', message);
  await persistFeedbackCodexTerminalSession(session);
  await persistDirectTerminalRepairRunStatus(session, finalStatus, message);
  broadcastFeedbackCodexPty(session, { type: 'exit', exitCode, signal, session: feedbackCodexTerminalPublicSession(session) });
  broadcastFeedbackCodexPtyStatus(session);
}

async function stopFeedbackCodexPtyTerminal(root: string, sessionId: string, body: Record<string, unknown>) {
  const session = await activeOrStoredFeedbackCodexTerminalSession(root, sessionId);
  const reason = stringField(body.reason) || 'feedback inbox PTY stop button';
  const message = session.ptyProcess
    ? `Stop requested for Direct Codex PTY ${session.id}: ${reason}`
    : `Stop requested for Direct Codex PTY ${session.id}, but no active PTY process is attached.`;
  await appendRepairTerminalMirrorEntry(session.terminalMirrorRef, 'stderr', message);
  if (session.ptyProcess) {
    session.ptyProcess.kill();
    session.ptyProcess = undefined;
    session.status = 'cancelled';
  } else {
    session.status = session.status === 'running' || session.status === 'starting' ? 'idle' : session.status;
  }
  session.message = message;
  session.updatedAt = new Date().toISOString();
  await persistFeedbackCodexTerminalSession(session);
  await persistDirectTerminalRepairRunStatus(session, session.status, message);
  broadcastFeedbackCodexPtyStatus(session);
  return feedbackCodexTerminalPublicSession(session);
}

async function loadFeedbackCodexPtyTerminalTail(root: string, sessionId: string, options: { cursor?: number; limit?: number }) {
  const session = activeFeedbackCodexTerminalSessions.get(sessionId) ?? await readFeedbackCodexTerminalSession(root, sessionId);
  const terminalPath = session?.terminalMirrorRef ?? feedbackCodexTerminalMirrorRef(root, sessionId);
  const text = await readFile(terminalPath, 'utf8').catch((err: unknown) => {
    if (isNodeErrorCode(err, 'ENOENT')) return '';
    throw err;
  });
  return {
    session: session ? feedbackCodexTerminalPublicSession(session) : undefined,
    tail: parseRepairTerminalMirrorNdjson(text, {
      cursor: Number.isFinite(options.cursor) ? options.cursor : 0,
      limit: Number.isFinite(options.limit) ? options.limit : 200,
      terminalMirrorRef: terminalPath,
    }),
  };
}

async function activeOrStoredFeedbackCodexTerminalSession(root: string, sessionId: string): Promise<ActiveFeedbackCodexTerminalSession> {
  const active = activeFeedbackCodexTerminalSessions.get(sessionId);
  if (active) return active;
  const stored = await readFeedbackCodexTerminalSession(root, sessionId);
  if (!stored) throw new Error(`Direct Codex Terminal session not found: ${sessionId}`);
  const wasRunning = stored.status === 'running' || stored.status === 'starting';
  const revived: ActiveFeedbackCodexTerminalSession = {
    ...stored,
    status: wasRunning ? 'idle' : stored.status,
    message: wasRunning
      ? 'PTY session was revived from disk; no active terminal process is attached in this writer process.'
      : stored.message,
  };
  activeFeedbackCodexTerminalSessions.set(revived.id, revived);
  await persistFeedbackCodexTerminalSession(revived);
  return revived;
}

async function readFeedbackCodexTerminalSession(root: string, sessionId: string): Promise<FeedbackCodexTerminalSession | undefined> {
  const manifest = await readOptionalJson(feedbackCodexTerminalManifestRef(root, sessionId)).catch(() => undefined);
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || typeof manifest.id !== 'string') return undefined;
  return {
    schemaVersion: 1,
    id: manifest.id,
    issueId: stringField(manifest.issueId),
    repairRunId: stringField(manifest.repairRunId) || manifest.id,
    status: feedbackCodexTerminalStatus(manifest.status),
    workspacePath: stringField(manifest.workspacePath) || root,
    terminalMirrorRef: stringField(manifest.terminalMirrorRef) || feedbackCodexTerminalMirrorRef(root, manifest.id),
    promptRef: stringField(manifest.promptRef) || feedbackCodexTerminalPromptRef(root, manifest.id),
    promptPreview: stringField(manifest.promptPreview),
    codexSessionId: stringField(manifest.codexSessionId),
    startedAt: stringField(manifest.startedAt) || new Date().toISOString(),
    updatedAt: stringField(manifest.updatedAt) || new Date().toISOString(),
    message: stringField(manifest.message),
    runtimeProfile: stringField(manifest.runtimeProfile),
    allowOpenAiRuntime: manifest.allowOpenAiRuntime === true,
    transport: feedbackCodexTerminalTransport(manifest.transport),
    webSocketPath: stringField(manifest.webSocketPath),
  };
}

async function persistFeedbackCodexTerminalSession(session: FeedbackCodexTerminalSession) {
  await mkdir(dirname(feedbackCodexTerminalManifestRef(session.workspacePath, session.id)), { recursive: true });
  await writeFile(feedbackCodexTerminalManifestRef(session.workspacePath, session.id), JSON.stringify(feedbackCodexTerminalPublicSession(session), null, 2));
}

function feedbackCodexTerminalPublicSession(session: FeedbackCodexTerminalSession): FeedbackCodexTerminalSession {
  return {
    schemaVersion: 1,
    id: session.id,
    issueId: session.issueId,
    repairRunId: session.repairRunId,
    status: feedbackCodexTerminalStatus(session.status),
    workspacePath: session.workspacePath,
    terminalMirrorRef: session.terminalMirrorRef,
    promptRef: session.promptRef,
    promptPreview: session.promptPreview,
    codexSessionId: session.codexSessionId,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    message: session.message,
    runtimeProfile: session.runtimeProfile,
    allowOpenAiRuntime: session.allowOpenAiRuntime,
    transport: session.transport,
    webSocketPath: session.webSocketPath,
  };
}

function feedbackCodexTerminalRepairRun(
  session: FeedbackCodexTerminalSession,
  comment: Record<string, unknown> | undefined,
  body: Record<string, unknown>,
) {
  return {
    schemaVersion: 1,
    id: session.repairRunId,
    issueId: session.issueId,
    status: 'running',
    externalInstanceId: INSTANCE_ID,
    externalInstanceName: INSTANCE_ROLE,
    actor: 'direct-codex-terminal',
    startedAt: session.startedAt,
    note: 'Direct Codex Terminal started from Feedback Inbox. UI is attached to a WebSocket/xterm PTY running the Codex CLI.',
    terminalMirrorRef: session.terminalMirrorRef,
    planRef: session.promptRef,
    terminalMirror: [
      { timestamp: session.startedAt, stream: 'event' as const, text: `Direct Codex Terminal started for ${session.issueId}.` },
      { timestamp: session.startedAt, stream: 'event' as const, text: 'Transport=websocket-pty; xterm is attached to a real Codex CLI PTY.' },
    ],
    confirmationPolicy: normalizeRepairConfirmationPolicy({
      commit: 'requires-user-confirmation',
      push: 'requires-second-confirmation',
      pr: 'requires-second-confirmation',
      merge: 'never',
    }),
    metadata: {
      handoffKind: 'direct-codex-terminal',
      executorBackend: 'runtime-codex',
      terminalTransport: session.transport,
      terminalMode: 'interactive-codex-pty',
      directCodexTerminalSessionId: session.id,
      codexSessionId: session.codexSessionId,
      runtimeProfile: session.runtimeProfile,
      allowOpenAiRuntime: session.allowOpenAiRuntime === true,
      targetWorkspacePath: session.workspacePath,
      promptRef: session.promptRef,
      webSocketPath: session.webSocketPath,
      evidenceRefs: feedbackPromptEvidenceRefs(comment ?? {}),
      initialTerminalGuidance: stringField(body.initialMessage),
      userGitMode: stringField(body.gitMode) || 'manual-git-default',
    },
  };
}

async function persistDirectTerminalRepairRunStatus(
  session: FeedbackCodexTerminalSession,
  status: FeedbackCodexTerminalStatus,
  message?: string,
) {
  const state = await readWorkspaceStateFileOrDefault(session.workspacePath);
  const runs = Array.isArray(state.feedbackRepairRuns) ? state.feedbackRepairRuns.filter(isRecord) : [];
  const existing = runs.find((run) => run.id === session.repairRunId);
  if (!existing) return;
  const updated = {
    ...existing,
    status: repairRunStatusForCodexTerminal(status),
    note: message || stringField(existing.note),
    terminalMirrorRef: session.terminalMirrorRef,
    planRef: session.promptRef,
    metadata: {
      ...(isRecord(existing.metadata) ? existing.metadata : {}),
      terminalTransport: session.transport,
      terminalMode: 'interactive-codex-pty',
      directCodexTerminalSessionId: session.id,
      codexSessionId: session.codexSessionId,
      directCodexTerminalStatus: status,
      webSocketPath: session.webSocketPath,
      updatedAt: session.updatedAt,
      message,
    },
  };
  const next = {
    ...state,
    feedbackRepairRuns: [updated, ...runs.filter((run) => run.id !== session.repairRunId)].slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  await persistFeedbackRecord(session.workspacePath, 'repair-runs', session.repairRunId, updated);
  await writeWorkspaceStateFile(session.workspacePath, next);
}

function repairRunStatusForCodexTerminal(status: FeedbackCodexTerminalStatus) {
  if (status === 'failed' || status === 'cancelled') return 'blocked';
  if (status === 'idle') return 'needs-human-verification';
  return 'running';
}

function buildFeedbackCodexTerminalPrompt(input: {
  root: string;
  bundle: Record<string, unknown>;
  issueId: string;
  userGuidance?: string;
}) {
  const comment = isRecord(input.bundle.comment) ? input.bundle.comment : {};
  const target = isRecord(input.bundle.target) ? input.bundle.target : isRecord(comment.target) ? comment.target : {};
  const runtime = isRecord(input.bundle.runtime) ? input.bundle.runtime : isRecord(comment.runtime) ? comment.runtime : {};
  const request = isRecord(input.bundle.request) ? input.bundle.request : undefined;
  const evidenceRefs = feedbackPromptEvidenceRefs(comment);
  return [
    `You are Codex CLI running directly inside the SciForge workspace.`,
    `Workspace: ${input.root}`,
    `Feedback issue: ${input.issueId}`,
    '',
    'Task',
    '- Repair the feedback below in the current workspace.',
    '- Use the feedback target, runtime, screenshot refs, and existing code to make the smallest correct change.',
    '- Run focused checks when the change is testable.',
    '- End by summarizing changed files, verification, and any remaining user-facing questions.',
    '',
    'Human feedback',
    `- Comment: ${stringField(comment.comment) || stringField(input.bundle.title) || '(missing comment)'}`,
    stringField(comment.expectedBehavior) ? `- Expected: ${stringField(comment.expectedBehavior)}` : '',
    stringField(comment.actualBehavior) ? `- Actual: ${stringField(comment.actualBehavior)}` : '',
    request && stringField(request.title) ? `- Request: ${stringField(request.title)}` : '',
    input.userGuidance ? `- Initial guidance: ${input.userGuidance}` : '',
    '',
    'Target element',
    `- Selector: ${stringField(target.selector) || '(missing selector)'}`,
    `- Path: ${stringField(target.path) || stringField(target.domPath) || '(missing path)'}`,
    `- Tag: ${stringField(target.tagName) || '(missing tag)'}`,
    stringField(target.text) ? `- Visible text: ${compactString(stringField(target.text), 500)}` : '',
    isRecord(target.rect) ? `- Rect: x=${target.rect.x ?? '?'} y=${target.rect.y ?? '?'} w=${target.rect.width ?? '?'} h=${target.rect.height ?? '?'}` : '',
    '',
    'Runtime context',
    `- Page: ${stringField(runtime.page) || '(missing page)'}`,
    `- URL: ${stringField(runtime.url) || '(missing url)'}`,
    `- Scenario: ${stringField(runtime.scenarioId) || '(missing scenario)'}`,
    stringField(runtime.sessionId) ? `- Session: ${stringField(runtime.sessionId)}` : '',
    stringField(runtime.activeRunId) ? `- Active run: ${stringField(runtime.activeRunId)}` : '',
    '',
    'Evidence refs',
    ...(evidenceRefs.length ? evidenceRefs.map((ref) => `- ${ref}`) : ['- No durable screenshot/evidence refs were recorded. Inspect the UI and code directly.']),
    '',
    'Operation boundaries',
    '- This is a direct Codex terminal session, not the old cross-instance repair runner.',
    '- Do not commit, push, create a PR, merge, or rewrite ignored secret config unless the human explicitly asks in this terminal.',
    '- Keep feedback records, screenshots, terminal mirror files, and repair audit files intact.',
    '- If provider/config errors appear, report the exact blocker and stop rather than fabricating a repair.',
  ].filter((line) => line !== '').join('\n');
}

function feedbackPromptEvidenceRefs(comment: Record<string, unknown>) {
  const assets = Array.isArray(comment.evidenceAssets) ? comment.evidenceAssets.filter(isRecord) : [];
  return uniqueStrings([
    stringField(comment.evidenceBundleRef),
    stringField(comment.screenshotRef),
    stringField(comment.rawScreenshotRef),
    stringField(comment.annotatedScreenshotRef),
    ...assets.flatMap((asset) => [
      stringField(asset.ref),
      stringField(asset.localRef),
      stringField(asset.publicUrl),
      stringField(asset.markdownImageUrl),
      stringField(recordField(asset.metadata)?.manifestRef),
    ]),
  ]);
}

function feedbackCodexPtyArgs(input: {
  profile: string;
  workspace: string;
  sandbox: string;
  prompt: string;
}): string[] {
  return [
    ...RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
    '--profile',
    input.profile,
    '--cd',
    input.workspace,
    '--sandbox',
    input.sandbox,
    '--ask-for-approval',
    'never',
    '--no-alt-screen',
    input.prompt,
  ];
}

function withCodexPtyPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const fallbackDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin'];
  const existing = (env.PATH || '').split(':').filter(Boolean);
  return {
    ...env,
    PATH: uniqueStrings([...existing, ...fallbackDirs]).join(':'),
  };
}

async function resolveCodexPtyCommand(command: string, env: NodeJS.ProcessEnv) {
  if (isAbsolute(command) || command.includes(sep)) return command;
  for (const dir of (env.PATH || '').split(':').filter(Boolean)) {
    const candidate = join(dir, command);
    if (await fileExists(candidate)) return candidate;
  }
  return command;
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function ptyDimension(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function feedbackCodexTerminalStatus(value: unknown): FeedbackCodexTerminalStatus {
  return value === 'starting' || value === 'running' || value === 'idle' || value === 'failed' || value === 'cancelled'
    ? value
    : 'idle';
}

function feedbackCodexTerminalTransport(_value: unknown): FeedbackCodexTerminalTransport {
  return 'websocket-pty';
}

function feedbackCodexTerminalDir(root: string, sessionId: string) {
  const normalized = normalizeFeedbackBundleId(sessionId);
  return join(root, '.sciforge', 'repair-results', normalized);
}

function feedbackCodexTerminalMirrorRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'terminal-mirror.ndjson');
}

function feedbackCodexTerminalPromptRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'feedback-codex-prompt.md');
}

function feedbackCodexTerminalManifestRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'direct-codex-terminal.json');
}

function scrubFeedbackError(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}\b/g, '[redacted-github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/\/Users\/[^/\s]+/g, '[redacted-user-home]')
    .replace(/\/Applications\/workspace\/[^\s]+/g, '[redacted-workspace-path]')
    .slice(0, 1200);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

async function runFeedbackRepairAction(root: string, issueId: string, body: Record<string, unknown>) {
  const state = await readWorkspaceStateFile(root);
  const comment = findFeedbackComment(state, issueId);
  if (!comment) throw new Error(`feedback issue not found: ${issueId}`);
  const canonicalIssueId = String(comment.id || issueId);
  const action = repairActionName(body.action);
  const result = findRepairResultForAction(state, canonicalIssueId, body.resultId);
  if (!result) throw new Error(`repair result not found for issue ${canonicalIssueId}`);
  if (action === 'merge') throw new Error('Repair merge is never automatic and is blocked by policy.');

  const now = new Date().toISOString();
  const actionRecord = {
    schemaVersion: 1,
    id: `repair-action-${Date.now()}`,
    issueId: canonicalIssueId,
    repairResultId: String(result.id),
    action,
    status: 'blocked',
    sideEffect: 'none',
    requestedAt: now,
    confirmedAt: undefined as string | undefined,
    safeModeConfirmed: body.safeModeConfirmed === true,
    safeMode: repairControlSurfaceSafeMode(result),
    browserVerification: undefined as Record<string, unknown> | undefined,
    message: '',
  };
  const safeMode = actionRecord.safeMode;
  const resultMetadata = isRecord(result.metadata) ? result.metadata : {};
  const confirmationPolicy = normalizeRepairConfirmationPolicy(resultMetadata.confirmationPolicy);

  if (action === 'browser-recheck') {
    const browserVerification = repairBrowserVerificationFromBody(body, now);
    const browserPassed = browserVerification.status === 'passed' || browserVerification.status === 'verified' || browserVerification.status === 'not-required';
    const browserFailed = browserVerification.status === 'failed' || browserVerification.status === 'rejected';
    const evidenceRefs = uniqueStrings([
      ...stringArray(result.evidenceRefs),
      ...stringArray(browserVerification.evidenceRefs),
    ]);
    const recheckRecord = {
      ...browserVerification,
      recordedAt: now,
      action: 'browser-recheck',
    };
    const updatedResult = {
      ...result,
      humanVerification: browserVerification,
      evidenceRefs,
      metadata: {
        ...resultMetadata,
        browserRechecks: [
          recheckRecord,
          ...(Array.isArray(resultMetadata.browserRechecks) ? resultMetadata.browserRechecks.filter(isRecord) : []),
        ].slice(0, 20),
      },
    };
    actionRecord.status = browserFailed ? 'blocked' : browserPassed ? 'completed' : 'requires-user-confirmation';
    actionRecord.confirmedAt = browserPassed || browserFailed ? now : undefined;
    actionRecord.browserVerification = browserVerification;
    actionRecord.message = browserFailed
      ? `Browser recheck recorded as failed: ${browserVerification.conclusion || 'manual browser verification did not pass.'}`
      : browserPassed
        ? `Browser recheck recorded as passed: ${browserVerification.conclusion || 'manual browser verification passed.'}`
        : `Browser recheck recorded as ${browserVerification.status}; commit remains user-gated.`;
    return persistRepairAction(root, state, updatedResult, actionRecord);
  }

  if (action === 'push' || action === 'pr') {
    if (safeMode.active && body.safeModeConfirmed !== true) {
      actionRecord.status = 'requires-safe-mode-confirmation';
      actionRecord.message = `Safe mode is active for ${safeMode.matchedPaths.join(', ')}; ${action} requires extra confirmation or an external control surface and was not executed.`;
      return persistRepairAction(root, state, result, actionRecord);
    }
    if (body.secondConfirmed !== true) {
      actionRecord.status = 'requires-second-confirmation';
      actionRecord.message = `${action} requires a separate second confirmation and was not executed.`;
    } else {
      actionRecord.status = 'blocked';
      actionRecord.message = `${action} remains external-only in this workspace writer; no remote mutation was attempted.`;
    }
    return persistRepairAction(root, state, result, actionRecord);
  }

  if (confirmationPolicy?.commit === 'disabled') {
    actionRecord.status = 'blocked';
    actionRecord.message = 'Local commit is disabled by the repair result confirmation policy and was not executed.';
    return persistRepairAction(root, state, result, actionRecord);
  }
  const commitBlocker = repairResultCommitBlocker(result);
  if (commitBlocker) {
    actionRecord.status = 'blocked';
    actionRecord.message = commitBlocker;
    return persistRepairAction(root, state, result, actionRecord);
  }
  if (body.confirmed !== true) {
    actionRecord.status = 'requires-user-confirmation';
    actionRecord.message = 'Local commit requires explicit user confirmation and was not executed.';
    return persistRepairAction(root, state, result, actionRecord);
  }
  if (safeMode.active && body.safeModeConfirmed !== true) {
    actionRecord.status = 'requires-safe-mode-confirmation';
    actionRecord.message = `Safe mode is active for ${safeMode.matchedPaths.join(', ')}; local commit requires extra safeModeConfirmed confirmation or an external control surface.`;
    return persistRepairAction(root, state, result, actionRecord);
  }

  const worktreePath = typeof resultMetadata.isolatedWorktreePath === 'string' ? resolve(resultMetadata.isolatedWorktreePath) : '';
  const allowedWorktreeRoots = [
    resolve(root, '.sciforge', 'repair-worktrees'),
    resolve(process.cwd(), '.sciforge', 'repair-worktrees'),
  ];
  if (!worktreePath || !allowedWorktreeRoots.some((allowedRoot) => isInsideOrSamePath(worktreePath, allowedRoot))) {
    throw new Error('Repair commit blocked: isolated repair worktree ref is missing or outside .sciforge/repair-worktrees.');
  }
  const baseCommit = typeof resultMetadata.baseCommit === 'string' ? resultMetadata.baseCommit : '';
  const headCommit = await gitOutput(worktreePath, ['rev-parse', 'HEAD']);
  if (baseCommit && headCommit && headCommit !== baseCommit) {
    throw new Error('Repair commit blocked: isolated worktree HEAD has moved since repair handoff.');
  }
  const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  if (!changedFiles.length) throw new Error('Repair commit blocked: result has no changed files.');
  const unsafeChanged = changedFiles.find((file) => !safeRepoRelativePath(file));
  if (unsafeChanged) throw new Error(`Repair commit blocked: unsafe changed file path ${unsafeChanged}.`);
  const tests = normalizeRepairTestResults(result.testResults ?? result.tests) ?? [];
  if (!tests.length || tests.some((test) => test.status !== 'passed')) {
    throw new Error('Repair commit blocked: all recorded repair tests must pass before local commit.');
  }
  const diff = await gitOutput(worktreePath, ['diff', '--', ...changedFiles]);
  const untracked = await gitOutput(worktreePath, ['ls-files', '--others', '--exclude-standard', '--', ...changedFiles]);
  if (!diff && !untracked) throw new Error('Repair commit blocked: isolated worktree has no patch to commit.');

  await gitStrict(worktreePath, ['add', '--', ...changedFiles]);
  await gitStrict(worktreePath, [
    '-c',
    'user.name=SciForge Repair',
    '-c',
    'user.email=sciforge-repair@example.invalid',
    'commit',
    '-m',
    `Repair ${canonicalIssueId}`,
  ]);
  const commitSha = await gitStrict(worktreePath, ['rev-parse', 'HEAD']);
  const updatedResult = {
    ...result,
    commit: commitSha,
    refs: { ...(isRecord(result.refs) ? result.refs : {}), commitSha },
    metadata: {
      ...resultMetadata,
      confirmationPolicy,
      confirmedActions: [
        ...(Array.isArray(resultMetadata.confirmedActions) ? resultMetadata.confirmedActions.filter(isRecord) : []),
        { action: 'commit', confirmedAt: now, commitSha, scope: 'local-isolated-worktree', safeModeConfirmed: safeMode.active ? true : undefined },
      ],
      safeMode,
    },
  };
  actionRecord.status = 'completed';
  actionRecord.sideEffect = 'local-commit';
  actionRecord.confirmedAt = now;
  actionRecord.message = `Created local isolated-worktree commit ${commitSha}. Push, PR, and merge remain blocked without separate confirmation.`;
  return persistRepairAction(root, state, updatedResult, actionRecord);
}

const REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES = [
  'src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx',
  'src/ui/src/feedback',
  'src/ui/src/api/workspaceClient.ts',
  'src/runtime/workspace-server.ts',
  'src/runtime/repair-handoff-runner.ts',
];

function repairResultCommitBlocker(result: Record<string, unknown>) {
  if (result.verdict !== 'fixed') return `Repair commit blocked: result verdict is ${String(result.verdict || 'missing')}, not fixed.`;
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const dirty = isRecord(metadata.dirtyWorktreeCollaboration) ? metadata.dirtyWorktreeCollaboration : undefined;
  if (!dirty) return 'Repair commit blocked: dirty worktree guard metadata is missing.';
  if (dirty.status !== 'passed') return `Repair commit blocked: dirty worktree guard status is ${String(dirty.status || 'missing')}.`;
  const protectedPaths = stringArray(dirty.changedProtectedPaths);
  if (protectedPaths.length) return `Repair commit blocked: protected paths changed: ${protectedPaths.join(', ')}.`;
  const forbiddenPaths = stringArray(dirty.changedForbiddenPaths);
  if (forbiddenPaths.length) return `Repair commit blocked: forbidden paths changed: ${forbiddenPaths.join(', ')}.`;
  const outsideAllowedPaths = stringArray(dirty.changedOutsideAllowedPaths);
  if (outsideAllowedPaths.length) return `Repair commit blocked: paths outside allowed scope changed: ${outsideAllowedPaths.join(', ')}.`;
  const executorRepairPlan = isRecord(dirty.executorRepairPlan) ? dirty.executorRepairPlan : undefined;
  if (executorRepairPlan && executorRepairPlan.exists !== true) return 'Repair commit blocked: executor repair plan evidence is missing.';
  const commitAudit = isRecord(dirty.commitAudit) ? dirty.commitAudit : undefined;
  if (!commitAudit) return 'Repair commit blocked: executor commit audit metadata is missing.';
  if (commitAudit.created === true) return 'Repair commit blocked: executor already created a commit in the isolated worktree.';
  const humanVerification = isRecord(result.humanVerification) ? result.humanVerification : undefined;
  if (humanVerification?.status === 'failed' || humanVerification?.status === 'rejected') {
    return `Repair commit blocked: human verification status is ${humanVerification.status}.`;
  }
  return '';
}

function repairControlSurfaceSafeMode(result: Record<string, unknown>) {
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const existing = isRecord(metadata.safeMode) ? metadata.safeMode : undefined;
  const existingMatched = Array.isArray(existing?.matchedPaths) ? existing.matchedPaths.filter((item): item is string => typeof item === 'string') : [];
  const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  const matchedPaths = uniqueStrings([...existingMatched, ...changedFiles.filter((file) => pathMatchesAnySafeModeScope(file))]);
  const active = existing?.active === true || matchedPaths.length > 0;
  return {
    active,
    reason: active
      ? 'Repair touches the feedback inbox or repair backend/control surface.'
      : 'Repair does not touch the feedback inbox or repair backend/control surface.',
    matchedPaths,
    requiresExternalControlSurface: active,
  };
}

function pathMatchesAnySafeModeScope(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  return REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

function repairActionName(value: unknown): 'commit' | 'push' | 'pr' | 'merge' | 'browser-recheck' {
  if (value === 'commit' || value === 'push' || value === 'pr' || value === 'merge' || value === 'browser-recheck') return value;
  throw new Error('repair action must be one of commit, push, pr, merge, browser-recheck');
}

function repairBrowserVerificationFromBody(body: Record<string, unknown>, now: string) {
  const input = isRecord(body.browserVerification) ? body.browserVerification : {};
  const requestedStatus = typeof input.status === 'string' ? input.status : typeof body.status === 'string' ? body.status : 'pending';
  let status = requestedStatus === 'verified' || requestedStatus === 'rejected' || requestedStatus === 'pending' || requestedStatus === 'not-run'
    || requestedStatus === 'required' || requestedStatus === 'not-required' || requestedStatus === 'passed' || requestedStatus === 'failed'
    ? requestedStatus
    : 'pending';
  const evidenceRefs = uniqueStrings([
    ...stringArray(input.evidenceRefs),
    ...stringArray(body.evidenceRefs),
  ]);
  if ((status === 'passed' || status === 'verified' || status === 'not-required') && evidenceRefs.length === 0) {
    status = 'pending';
  }
  return {
    status,
    verifier: typeof input.verifier === 'string' && input.verifier.trim() ? input.verifier.trim() : 'codex-in-app-browser',
    reviewer: typeof input.reviewer === 'string' && input.reviewer.trim() ? input.reviewer.trim() : 'feedback-inbox',
    conclusion: typeof input.conclusion === 'string' ? input.conclusion : typeof body.conclusion === 'string' ? body.conclusion : undefined,
    evidenceRefs,
    verifiedAt: typeof input.verifiedAt === 'string' && input.verifiedAt.trim() ? input.verifiedAt.trim() : now,
    note: typeof input.note === 'string' ? input.note : undefined,
  };
}

function findRepairResultForAction(state: Record<string, unknown>, issueId: string, resultId: unknown) {
  const results = Array.isArray(state.feedbackRepairResults) ? state.feedbackRepairResults.filter(isRecord) : [];
  const matching = results.filter((result) => result.issueId === issueId);
  if (typeof resultId === 'string' && resultId.trim()) return matching.find((result) => result.id === resultId.trim());
  return matching.sort((left, right) => Date.parse(String(right.completedAt || '')) - Date.parse(String(left.completedAt || '')))[0];
}

async function persistRepairAction(
  root: string,
  state: Record<string, unknown>,
  result: Record<string, unknown>,
  action: Record<string, unknown>,
) {
  const results = Array.isArray(state.feedbackRepairResults) ? state.feedbackRepairResults.filter(isRecord) : [];
  const actions = Array.isArray(state.feedbackRepairActions) ? state.feedbackRepairActions.filter(isRecord) : [];
  const next = {
    ...state,
    feedbackRepairResults: [result, ...results.filter((item) => item.id !== result.id)].slice(0, 200),
    feedbackRepairActions: [action, ...actions].slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  await persistFeedbackRecord(root, 'repair-results', String(result.id), result);
  await persistFeedbackRecord(root, 'repair-actions', String(action.id), action);
  await writeWorkspaceStateFile(root, next);
  return { action, result };
}

async function gitStrict(cwd: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolveOutput(out);
      else reject(new Error(`git ${args.join(' ')} failed in ${cwd}: ${err || out}`));
    });
  });
}

function safeRepoRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '');
  return Boolean(normalized)
    && normalized !== '.'
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../')
    && normalized !== '.git'
    && !normalized.startsWith('.git/');
}

function isInsideOrSamePath(candidate: string, parent: string) {
  const rel = candidate === parent ? '' : candidate.startsWith(`${parent}/`) ? candidate.slice(parent.length + 1) : relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function resolveRepairTerminalMirrorRef(root: string, ref: string) {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw) throw new Error('terminal mirror ref is required');
  const candidate = resolve(raw.startsWith('/') ? raw : resolve(root, raw));
  const allowedRoots = [
    resolve(root, '.sciforge', 'repair-results'),
    resolve(process.cwd(), '.sciforge', 'repair-results'),
  ];
  if (basename(candidate) !== 'terminal-mirror.ndjson') {
    throw new Error('terminal mirror ref must end with terminal-mirror.ndjson');
  }
  if (!allowedRoots.some((allowedRoot) => isInsideOrSamePath(candidate, allowedRoot))) {
    throw new Error('terminal mirror ref must stay inside .sciforge/repair-results');
  }
  return candidate;
}

function isNodeErrorCode(error: unknown, code: string) {
  return isRecord(error) && error.code === code;
}

async function syncRepairResultGithubComment(comment: Record<string, unknown>, result: Record<string, unknown>) {
  const localConfig = await readLocalSciForgeConfig();
  return syncRepairResultToGithubIssue({
    issue: {
      issueNumber: typeof comment.githubIssueNumber === 'number' ? comment.githubIssueNumber : undefined,
      issueUrl: typeof comment.githubIssueUrl === 'string' ? comment.githubIssueUrl : undefined,
    },
    config: {
      repo: typeof localConfig.feedbackGithubRepo === 'string' ? localConfig.feedbackGithubRepo : undefined,
      token: typeof localConfig.feedbackGithubToken === 'string' ? localConfig.feedbackGithubToken : undefined,
    },
    result: result as Parameters<typeof syncRepairResultToGithubIssue>[0]['result'],
  });
}

function normalizeRepairTestResults(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    name: typeof item.name === 'string' ? item.name : undefined,
    command: typeof item.command === 'string' ? item.command : undefined,
    status: item.status === 'passed' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'skipped',
    summary: typeof item.summary === 'string' ? item.summary : undefined,
    outputRef: typeof item.outputRef === 'string' ? item.outputRef : undefined,
  }));
}

function normalizeRepairTerminalMirror(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(isRecord).map((entry) => ({
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
    stream: entry.stream === 'stdout' || entry.stream === 'stderr' || entry.stream === 'event' ? entry.stream : undefined,
    text: typeof entry.text === 'string' ? entry.text : '',
  })).filter((entry) => entry.timestamp && entry.stream && entry.text);
  return entries.length ? entries.slice(-500) : undefined;
}

function digestString(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const digest = value[key];
  return typeof digest === 'string' && digest.trim() ? digest.trim() : undefined;
}

function normalizeRepairHumanVerification(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    status: value.status === 'verified' || value.status === 'rejected' || value.status === 'pending' || value.status === 'not-run'
      || value.status === 'required' || value.status === 'not-required' || value.status === 'passed' || value.status === 'failed'
      ? value.status
      : undefined,
    verifier: typeof value.verifier === 'string' ? value.verifier : undefined,
    conclusion: typeof value.conclusion === 'string' ? value.conclusion : undefined,
    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.filter((item): item is string => typeof item === 'string') : undefined,
    verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : undefined,
    reviewer: typeof value.reviewer === 'string' ? value.reviewer : undefined,
    note: typeof value.note === 'string' ? value.note : undefined,
  };
}

function normalizeRepairRefs(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    commitSha: typeof value.commitSha === 'string' ? value.commitSha : undefined,
    commitUrl: typeof value.commitUrl === 'string' ? value.commitUrl : undefined,
    prUrl: typeof value.prUrl === 'string' ? value.prUrl : undefined,
    patchRef: typeof value.patchRef === 'string' ? value.patchRef : undefined,
  };
}

function normalizeRepairInstanceRef(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    appUrl: typeof value.appUrl === 'string' ? value.appUrl : undefined,
    workspaceWriterUrl: typeof value.workspaceWriterUrl === 'string' ? value.workspaceWriterUrl : undefined,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : undefined,
  };
}

function feedbackCommentSeedFromBody(issueId: string, body: Record<string, unknown>) {
  const issueBundle = isRecord(body.issueBundle) ? body.issueBundle : undefined;
  const rawComment = isRecord(body.comment)
    ? body.comment
    : isRecord(body.feedbackComment)
      ? body.feedbackComment
      : isRecord(issueBundle?.comment)
        ? issueBundle.comment
        : undefined;
  if (!rawComment) return undefined;
  const now = new Date().toISOString();
  return {
    ...rawComment,
    id: typeof rawComment.id === 'string' && rawComment.id.trim() ? rawComment.id.trim() : issueId,
    status: typeof rawComment.status === 'string' ? rawComment.status : 'open',
    createdAt: typeof rawComment.createdAt === 'string' ? rawComment.createdAt : now,
    updatedAt: now,
  };
}

function appendStateRecord(state: Record<string, unknown>, key: string, record: Record<string, unknown>) {
  const records = Array.isArray(state[key]) ? state[key].filter(isRecord) : [];
  return {
    ...state,
    [key]: [record, ...records.filter((item) => item.id !== record.id)].slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
}

async function persistFeedbackRecord(root: string, folder: string, id: string, record: Record<string, unknown>) {
  const dir = join(root, '.sciforge', 'feedback', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${safeName(id)}.json`), JSON.stringify(record, null, 2));
}

function normalizeFeedbackBundleId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('feedback comment id is required');
  const normalized = safeName(trimmed).replace(/^\.+/, '');
  if (normalized && normalized !== '.' && normalized !== '..') return normalized;
  return `feedback-${createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`;
}

function firstImageDataUrl(values: unknown[], label: string) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') throw new Error(`${label} data URL must be a string`);
    if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error(`${label} data URL must be a base64 png or jpeg data URL`);
    }
    return value;
  }
  return undefined;
}

async function persistFeedbackScreenshotEvidenceAssets(
  root: string,
  id: string,
  screenshot: Record<string, unknown> | undefined,
  rawDataUrl: string | undefined,
  annotatedDataUrl: string | undefined,
  createdAt: string,
) {
  const assets: Record<string, unknown>[] = [];
  if (rawDataUrl) {
    const raw = await writeFeedbackEvidenceImageAsset(root, id, rawDataUrl, {
      kind: 'raw-screenshot',
      filenameBase: 'raw',
      label: 'Raw screenshot',
      sourceRef: join('.sciforge', 'feedback', id, 'raw-screenshot.data-url'),
      width: numberField(screenshot?.width),
      height: numberField(screenshot?.height),
      createdAt,
      visibility: 'private',
      includeForAgent: false,
    });
    assets.push(raw);
  }
  if (annotatedDataUrl) {
    const annotated = await writeFeedbackEvidenceImageAsset(root, id, annotatedDataUrl, {
      kind: 'scrubbed-annotated-screenshot',
      filenameBase: 'scrubbed-annotated',
      label: 'Scrubbed annotated screenshot',
      sourceRef: join('.sciforge', 'feedback', id, 'annotated-screenshot.data-url'),
      width: numberField(screenshot?.width),
      height: numberField(screenshot?.height),
      createdAt,
      visibility: 'public',
      includeForAgent: false,
      metadata: {
        scrubPolicy: 'Inline data URL omitted from GitHub and public issue bodies; annotated screenshot pixels are retained as captured evidence.',
      },
    });
    assets.push(annotated);
  }
  return assets;
}

async function writeFeedbackEvidenceImageAsset(
  root: string,
  id: string,
  dataUrl: string,
  input: {
    kind: 'raw-screenshot' | 'annotated-screenshot' | 'scrubbed-annotated-screenshot';
    filenameBase: string;
    label: string;
    sourceRef: string;
    width?: number;
    height?: number;
    createdAt: string;
    visibility: 'public' | 'private';
    includeForAgent?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const parsed = parseImageDataUrl(dataUrl, input.label);
  const repoRoot = await gitOutput(root, ['rev-parse', '--show-toplevel']) || root;
  const relativeRef = repairEvidenceRelativeRef(input.visibility, id, `${input.filenameBase}.${parsed.extension}`);
  const assetPath = resolve(repoRoot, relativeRef);
  const rel = relative(repoRoot, assetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('feedback evidence asset path escaped repo root');
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, parsed.bytes);
  const sha256 = createHash('sha256').update(parsed.bytes).digest('hex');
  const manifestPath = resolve(repoRoot, repairEvidenceRelativeRef(input.visibility, id, `${input.filenameBase}.manifest.json`));
  const publicUrl = input.visibility === 'public' ? repairEvidencePublicUrl(relativeRef) : undefined;
  const uploadStatus = input.visibility === 'public'
    ? publicUrl
      ? 'ready'
      : 'local'
    : 'private';
  const manifest = {
    schemaVersion: 1,
    id: `feedback-evidence-${id}-${input.filenameBase}`,
    feedbackId: id,
    kind: input.kind,
    ref: toPosixPath(relativeRef),
    sourceRef: toPosixPath(input.sourceRef),
    mediaType: parsed.mediaType,
    width: input.width,
    height: input.height,
    bytes: parsed.bytes.length,
    sha256,
    createdAt: input.createdAt,
    localOnly: input.visibility !== 'public',
    visibility: input.visibility,
    uploadStatus,
    publicUrl,
    includeForAgent: input.includeForAgent === true,
    metadata: input.metadata,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeRepairEvidenceIndex(repoRoot, id, input.visibility, manifest);
  return {
    schemaVersion: 1,
    id: manifest.id,
    kind: input.kind,
    label: input.label,
    ref: toPosixPath(relativeRef),
    sourceRef: toPosixPath(input.sourceRef),
    localRef: toPosixPath(relativeRef),
    markdownImageUrl: publicUrl || toPosixPath(relativeRef),
    githubMarkdownUrl: publicUrl || toPosixPath(relativeRef),
    mediaType: parsed.mediaType,
    width: input.width,
    height: input.height,
    bytes: parsed.bytes.length,
    sha256,
    createdAt: input.createdAt,
    localOnly: input.visibility !== 'public',
    visibility: input.visibility,
    uploadStatus,
    publicUrl,
    includeForAgent: input.includeForAgent === true,
    metadata: {
      ...(input.metadata ?? {}),
      manifestRef: toPosixPath(relative(repoRoot, manifestPath)),
    },
  };
}

function repairEvidenceRelativeRef(visibility: 'public' | 'private', feedbackId: string, filename: string) {
  const base = visibility === 'public' ? REPAIR_EVIDENCE_PUBLIC_DIR : REPAIR_EVIDENCE_PRIVATE_DIR;
  return join(base, 'feedback-screenshots', safeName(feedbackId), safeName(filename));
}

function isRepairEvidenceRef(value: string) {
  const normalized = toPosixPath(value.trim().replace(/^(file|path|artifact):/i, ''));
  return normalized.startsWith(`${REPAIR_EVIDENCE_PUBLIC_DIR}/`)
    || normalized.startsWith(`${REPAIR_EVIDENCE_PRIVATE_DIR}/`)
    || normalized.startsWith('repair-evidence/');
}

function repairEvidencePublicUrl(relativeRef: string) {
  if (!REPAIR_EVIDENCE_PUBLIC_BASE_URL) return undefined;
  return `${REPAIR_EVIDENCE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${toPosixPath(relativeRef).replace(/^\/+/, '')}`;
}

async function writeRepairEvidenceIndex(repoRoot: string, feedbackId: string, visibility: 'public' | 'private', manifest: Record<string, unknown>) {
  const indexRef = repairEvidenceRelativeRef(visibility, feedbackId, 'index.json');
  const indexPath = resolve(repoRoot, indexRef);
  const existing = await readOptionalJson(indexPath).catch(() => undefined);
  const existingAssets = isRecord(existing) && Array.isArray(existing.assets) ? existing.assets.filter(isRecord) : [];
  const assets = mergeEvidenceAssets(existingAssets, [manifest]);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    feedbackId,
    visibility,
    folderRef: toPosixPath(dirname(indexRef)),
    assets,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

function mergeEvidenceAssets(existing: Record<string, unknown>[], next: Record<string, unknown>[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const asset of [...existing, ...next]) {
    const id = typeof asset.id === 'string' && asset.id.trim()
      ? asset.id.trim()
      : typeof asset.ref === 'string' && asset.ref.trim()
        ? asset.ref.trim()
        : '';
    if (id) byId.set(id, asset);
  }
  return [...byId.values()];
}

function parseImageDataUrl(dataUrl: string, label: string) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error(`${label} data URL must be a base64 png or jpeg data URL`);
  const mediaType = match[1] as 'image/png' | 'image/jpeg';
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error(`${label} data URL decoded to an empty image`);
  return {
    mediaType,
    extension: mediaType === 'image/png' ? 'png' : 'jpg',
    bytes,
  };
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, '/');
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function handoffFeedbackComments(state: Record<string, unknown>) {
  const comments = Array.isArray(state.feedbackComments) ? state.feedbackComments.filter(isRecord) : [];
  return comments
    .filter((comment) => {
      const status = typeof comment.status === 'string' ? comment.status : 'open';
      return !['fixed', 'wont-fix'].includes(status);
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

function findFeedbackComment(state: Record<string, unknown>, issueId: string) {
  return handoffFeedbackComments(state).find((comment) => comment.id === issueId || String(comment.githubIssueNumber || '') === issueId);
}

function feedbackIssueSummary(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const request = feedbackRequestForComment(state, comment);
  const github = githubMetadataForComment(state, comment);
  const runtime = isRecord(comment.runtime) ? comment.runtime : {};
  return {
    schemaVersion: 1,
    id: String(comment.id || ''),
    kind: 'feedback-comment',
    title: request && typeof request.title === 'string' && request.title.trim()
      ? request.title
      : compactString(typeof comment.comment === 'string' ? comment.comment : '', 80) || 'SciForge feedback issue',
    status: typeof comment.status === 'string' ? comment.status : 'open',
    priority: typeof comment.priority === 'string' ? comment.priority : 'normal',
    tags: Array.isArray(comment.tags) ? comment.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : '',
    updatedAt: typeof comment.updatedAt === 'string' ? comment.updatedAt : '',
    comment: compactString(typeof comment.comment === 'string' ? comment.comment : '', 240),
    requestId: typeof comment.requestId === 'string' ? comment.requestId : request && typeof request.id === 'string' ? request.id : undefined,
    runtime: {
      page: typeof runtime.page === 'string' ? runtime.page : '',
      scenarioId: typeof runtime.scenarioId === 'string' ? runtime.scenarioId : '',
      sessionId: typeof runtime.sessionId === 'string' ? runtime.sessionId : undefined,
      activeRunId: typeof runtime.activeRunId === 'string' ? runtime.activeRunId : undefined,
    },
    screenshot: screenshotMetadataForComment(comment),
    github,
  };
}

function feedbackRequestForComment(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const requests = Array.isArray(state.feedbackRequests) ? state.feedbackRequests.filter(isRecord) : [];
  const requestId = typeof comment.requestId === 'string' ? comment.requestId : '';
  return requests.find((request) => request.id === requestId || (Array.isArray(request.feedbackIds) && request.feedbackIds.includes(comment.id)));
}

function githubMetadataForComment(state: Record<string, unknown>, comment: Record<string, unknown>) {
  const issueNumber = typeof comment.githubIssueNumber === 'number' ? comment.githubIssueNumber : undefined;
  const synced = Array.isArray(state.githubSyncedOpenIssues)
    ? state.githubSyncedOpenIssues.filter(isRecord).find((issue) => issue.number === issueNumber || issue.htmlUrl === comment.githubIssueUrl)
    : undefined;
  if (!issueNumber && typeof comment.githubIssueUrl !== 'string' && !synced) return undefined;
  return {
    issueNumber,
    issueUrl: typeof comment.githubIssueUrl === 'string' ? comment.githubIssueUrl : synced && typeof synced.htmlUrl === 'string' ? synced.htmlUrl : undefined,
    openIssue: synced,
  };
}

function screenshotMetadataForComment(comment: Record<string, unknown>) {
  const screenshot = isRecord(comment.screenshot) ? comment.screenshot : undefined;
  if (!screenshot && typeof comment.screenshotRef !== 'string') return undefined;
  return {
    screenshotRef: typeof comment.screenshotRef === 'string' ? comment.screenshotRef : undefined,
    schemaVersion: screenshot?.schemaVersion,
    mediaType: typeof screenshot?.mediaType === 'string' ? screenshot.mediaType : undefined,
    width: typeof screenshot?.width === 'number' ? screenshot.width : undefined,
    height: typeof screenshot?.height === 'number' ? screenshot.height : undefined,
    capturedAt: typeof screenshot?.capturedAt === 'string' ? screenshot.capturedAt : undefined,
    targetRect: isRecord(screenshot?.targetRect) ? screenshot?.targetRect : undefined,
    includeForAgent: typeof screenshot?.includeForAgent === 'boolean' ? screenshot.includeForAgent : undefined,
    note: typeof screenshot?.note === 'string' ? screenshot.note : undefined,
    hasDataUrl: typeof screenshot?.dataUrl === 'string' && screenshot.dataUrl.length > 0,
    dataUrlBytes: typeof screenshot?.dataUrl === 'string' ? Buffer.byteLength(screenshot.dataUrl, 'utf8') : undefined,
  };
}

function repairRecordsForIssue(state: Record<string, unknown>, key: string, issueId: string) {
  return (Array.isArray(state[key]) ? state[key].filter(isRecord) : [])
    .filter((record) => record.issueId === issueId)
    .sort((left, right) => String(right.startedAt || right.completedAt || '').localeCompare(String(left.startedAt || left.completedAt || '')));
}

function compactString(value: string, limit: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, Math.max(0, limit - 3))}...` : compact;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function readLocalSciForgeConfig() {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
  const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
  const agentServerBaseUrl = process.env.SCIFORGE_AGENT_SERVER_URL
    || (typeof sciforge.agentServerBaseUrl === 'string' ? sciforge.agentServerBaseUrl : `http://127.0.0.1:${DEFAULT_PARALLEL_PROFILE.runtimeCodexPort}`);
  const runtimeCodexBaseUrl = process.env.SCIFORGE_RUNTIME_CODEX_URL
    || (typeof sciforge.runtimeCodexBaseUrl === 'string' ? sciforge.runtimeCodexBaseUrl : `http://127.0.0.1:${DEFAULT_PARALLEL_PROFILE.runtimeCodexPort}`);
  const workspaceWriterBaseUrl = process.env.SCIFORGE_WORKSPACE_WRITER_URL
    || (typeof sciforge.workspaceWriterBaseUrl === 'string' ? sciforge.workspaceWriterBaseUrl : `http://127.0.0.1:${PORT}`);
  const workspacePath = process.env.SCIFORGE_WORKSPACE_PATH
    || (typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : DEFAULT_WORKSPACE_PATH);
  const configuredPeerInstances = Array.isArray(sciforge.peerInstances)
    ? normalizePeerInstances(sciforge.peerInstances)
    : repairPeerInstancesFromCounterpart();
  return {
    schemaVersion: 1,
    agentServerBaseUrl,
    runtimeCodexBaseUrl,
    workspaceWriterBaseUrl,
    workspacePath: normalizeWorkspaceRootPath(resolve(workspacePath)),
    peerInstances: configuredPeerInstances,
    modelProvider: typeof llm.provider === 'string' ? llm.provider : 'native',
    modelBaseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl.replace(/\/+$/, '') : '',
    modelName: typeof llm.model === 'string' ? llm.model : typeof llm.modelName === 'string' ? llm.modelName : '',
    apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
    requestTimeoutMs: typeof sciforge.requestTimeoutMs === 'number' ? sciforge.requestTimeoutMs : 900000,
    feedbackGithubRepo: typeof sciforge.feedbackGithubRepo === 'string' ? sciforge.feedbackGithubRepo : undefined,
    feedbackGithubToken: typeof sciforge.feedbackGithubToken === 'string' ? sciforge.feedbackGithubToken : undefined,
    feedbackGithubLabels: Array.isArray(sciforge.feedbackGithubLabels) ? sciforge.feedbackGithubLabels.filter((item): item is string => typeof item === 'string') : undefined,
    feedbackGithubAssignees: Array.isArray(sciforge.feedbackGithubAssignees) ? sciforge.feedbackGithubAssignees.filter((item): item is string => typeof item === 'string') : undefined,
    feedbackGithubMilestone: typeof sciforge.feedbackGithubMilestone === 'number' || typeof sciforge.feedbackGithubMilestone === 'string' ? sciforge.feedbackGithubMilestone : undefined,
    feedbackGithubDryRun: sciforge.feedbackGithubDryRun === true,
    visionAllowSharedSystemInput: typeof visionSense.allowSharedSystemInput === 'boolean' ? visionSense.allowSharedSystemInput : true,
    toolProviderRoutes: normalizeToolProviderRoutes(sciforge.toolProviderRoutes),
    updatedAt: typeof sciforge.updatedAt === 'string' ? sciforge.updatedAt : new Date().toISOString(),
    source: 'config.local.json',
  };
}

async function writeLocalSciForgeConfig(config: Record<string, unknown>) {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
  const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
  const codexProxy = isRecord(parsed.codexProxy) ? parsed.codexProxy : {};
  const { runtimeCodexBaseUrl: _discardRuntimeCodexBaseUrl, ...storedSciforge } = sciforge;
  void _discardRuntimeCodexBaseUrl;
  const next = {
    ...parsed,
    llm: {
      ...llm,
      provider: typeof config.modelProvider === 'string' ? config.modelProvider : llm.provider,
      baseUrl: configuredString(config.modelBaseUrl, llm.baseUrl).replace(/\/+$/, ''),
      apiKey: preserveConfiguredSecretString(config.apiKey, llm.apiKey),
      model: preserveConfiguredSecretString(config.modelName, llm.model),
    },
    codexProxy: {
      ...codexProxy,
      upstreamBaseUrl: configuredString(config.modelBaseUrl, codexProxy.upstreamBaseUrl ?? llm.baseUrl).replace(/\/+$/, ''),
      apiKey: preserveConfiguredSecretString(config.apiKey, codexProxy.apiKey ?? llm.apiKey),
      defaultModel: preserveConfiguredSecretString(config.modelName, codexProxy.defaultModel ?? llm.model),
    },
    sciforge: {
      ...storedSciforge,
      agentServerBaseUrl: typeof config.agentServerBaseUrl === 'string' ? config.agentServerBaseUrl : sciforge.agentServerBaseUrl,
      workspaceWriterBaseUrl: typeof config.workspaceWriterBaseUrl === 'string' ? config.workspaceWriterBaseUrl : sciforge.workspaceWriterBaseUrl,
      workspacePath: normalizeWorkspaceRootPath(resolve(typeof config.workspacePath === 'string' ? config.workspacePath : typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : '')),
      peerInstances: Array.isArray(config.peerInstances) ? normalizePeerInstances(config.peerInstances) : normalizePeerInstances(sciforge.peerInstances),
      requestTimeoutMs: typeof config.requestTimeoutMs === 'number' ? config.requestTimeoutMs : sciforge.requestTimeoutMs,
      feedbackGithubRepo: typeof config.feedbackGithubRepo === 'string' ? config.feedbackGithubRepo : sciforge.feedbackGithubRepo,
      feedbackGithubToken: preserveConfiguredSecretString(config.feedbackGithubToken, sciforge.feedbackGithubToken),
      feedbackGithubLabels: Array.isArray(config.feedbackGithubLabels) ? uniqueStrings(config.feedbackGithubLabels.filter((item): item is string => typeof item === 'string')) : sciforge.feedbackGithubLabels,
      feedbackGithubAssignees: Array.isArray(config.feedbackGithubAssignees) ? uniqueStrings(config.feedbackGithubAssignees.filter((item): item is string => typeof item === 'string')) : sciforge.feedbackGithubAssignees,
      feedbackGithubMilestone: typeof config.feedbackGithubMilestone === 'number' || typeof config.feedbackGithubMilestone === 'string' ? config.feedbackGithubMilestone : sciforge.feedbackGithubMilestone,
      feedbackGithubDryRun: typeof config.feedbackGithubDryRun === 'boolean' ? config.feedbackGithubDryRun : sciforge.feedbackGithubDryRun === true,
      toolProviderRoutes: isRecord(config.toolProviderRoutes)
        ? normalizeToolProviderRoutes(config.toolProviderRoutes)
        : normalizeToolProviderRoutes(sciforge.toolProviderRoutes),
      updatedAt: new Date().toISOString(),
    },
    visionSense: {
      ...visionSense,
      allowSharedSystemInput: typeof config.visionAllowSharedSystemInput === 'boolean'
        ? config.visionAllowSharedSystemInput
        : typeof visionSense.allowSharedSystemInput === 'boolean'
          ? visionSense.allowSharedSystemInput
          : true,
    },
  };
  await mkdir(dirname(configLocalPath()), { recursive: true });
  await writeFile(configLocalPath(), JSON.stringify(next, null, 2));
  await prepareRuntimeCodexEnvFromLocalConfig(next);
}

async function prepareRuntimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
  const runtimeEnv = await runtimeCodexEnvFromLocalConfig(configuredLocalConfig);
  const proxyBaseUrl = await ensureRuntimeProviderProxy(runtimeEnv);
  await syncRuntimeCodexHomeFromLocalConfig(runtimeEnv, proxyBaseUrl);
  return runtimeEnv;
}

async function syncRuntimeCodexHomeFromLocalConfig(runtimeEnv: NodeJS.ProcessEnv = process.env, proxyBaseUrl = runtimeCodexProxyBaseUrl(runtimeEnv)) {
  await ensureRuntimeHome({ proxyBaseUrl, overwrite: true });
}

async function runtimeCodexEnvFromLocalConfig(configuredLocalConfig?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
  const localConfig = configuredLocalConfig ?? await readConfigLocalJson();
  const settings = localProviderSettings(localConfig);
  return {
    ...process.env,
    SCIFORGE_CONFIG_PATH: CONFIG_LOCAL_PATH,
    ...(settings.apiKey ? { SCIFORGE_RUNTIME_API_KEY: settings.apiKey } : {}),
    ...(settings.provider ? { SCIFORGE_RUNTIME_PROVIDER: settings.provider } : {}),
    ...(settings.baseUrl ? { SCIFORGE_RUNTIME_BASE_URL: settings.baseUrl, SCIFORGE_PROXY_UPSTREAM_BASE_URL: settings.baseUrl } : {}),
    ...(settings.model ? { SCIFORGE_RUNTIME_MODEL: settings.model } : {}),
  };
}

function localProviderSettings(localConfig: Record<string, unknown>) {
  const llm = isRecord(localConfig.llm) ? localConfig.llm : {};
  const codexProxy = isRecord(localConfig.codexProxy)
    ? localConfig.codexProxy
    : isRecord(localConfig.runtimeCodexProxy)
      ? localConfig.runtimeCodexProxy
      : {};
  const apiKey = stringValue(localConfig.apiKey) || stringValue(llm.apiKey) || stringValue(llm.upstreamApiKey) || stringValue(codexProxy.apiKey);
  const provider = stringValue(localConfig.modelProvider) || stringValue(llm.provider);
  const baseUrl = (
    stringValue(localConfig.modelBaseUrl)
    || stringValue(llm.baseUrl)
    || stringValue(llm.upstreamBaseUrl)
    || stringValue(codexProxy.upstreamBaseUrl)
    || stringValue(codexProxy.baseUrl)
    || ''
  ).replace(/\/+$/, '');
  const model = stringValue(localConfig.modelName)
    || stringValue(llm.model)
    || stringValue(llm.modelName)
    || stringValue(llm.defaultModel)
    || stringValue(codexProxy.defaultModel)
    || stringValue(codexProxy.model);
  return { apiKey, provider, baseUrl, model };
}

async function ensureRuntimeProviderProxy(runtimeEnv: NodeJS.ProcessEnv): Promise<string> {
  const configuredProxyBaseUrl = runtimeProviderProxyBaseUrl(runtimeEnv);
  if (await runtimeProviderProxyLocalReady(configuredProxyBaseUrl)) return runtimeCodexProxyBaseUrl(runtimeEnv);

  if (!managedRuntimeProviderProxy) {
    managedRuntimeProviderProxy = startManagedRuntimeProviderProxy(runtimeEnv).catch((error) => {
      managedRuntimeProviderProxy = undefined;
      throw error;
    });
  }
  const proxy = await managedRuntimeProviderProxy;
  if (!proxy) return runtimeCodexProxyBaseUrl(runtimeEnv);
  runtimeEnv.SCIFORGE_PROXY_BASE_URL = proxy.url;
  runtimeEnv.SCIFORGE_PROXY_PORT = String(proxy.port);
  return `${proxy.url.replace(/\/+$/, '')}/v1`;
}

async function startManagedRuntimeProviderProxy(runtimeEnv: NodeJS.ProcessEnv): Promise<StartedCodexResponsesProxy | undefined> {
  const options = resolveProxyCliOptions([], runtimeEnv);
  try {
    const proxy = await startCodexResponsesProxyServer({
      host: options.host,
      port: options.port,
      upstreamBaseUrl: options.upstreamBaseUrl,
      upstreamApiKey: options.upstreamApiKey,
      defaultModel: options.defaultModel,
      forceNonStreamingUpstream: options.forceNonStreamingUpstream,
      resolveDynamicOptions: () => {
        const latest = resolveProxyCliOptions([], {
          ...process.env,
          SCIFORGE_CONFIG_PATH: CONFIG_LOCAL_PATH,
        });
        return {
          upstreamBaseUrl: latest.upstreamBaseUrl,
          upstreamApiKey: latest.upstreamApiKey,
          defaultModel: latest.defaultModel,
          forceNonStreamingUpstream: latest.forceNonStreamingUpstream,
        };
      },
      log: (message) => console.error(`[sciforge-managed-codex-proxy] ${message}`),
    });
    console.log(`SciForge managed Codex Responses proxy: ${proxy.url}/v1`);
    return proxy;
  } catch (error) {
    if (isAddrInUse(error) && await runtimeProviderProxyLocalReady(runtimeProviderProxyBaseUrl(runtimeEnv))) return undefined;
    throw error;
  }
}

async function runtimeProviderProxyLocalReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(900) });
    const parsed = await response.json().catch(() => ({}));
    return response.ok && isRecord(parsed) && typeof parsed.upstreamBaseUrl === 'string';
  } catch {
    return false;
  }
}

function runtimeCodexProxyBaseUrl(env: NodeJS.ProcessEnv): string {
  const proxyBase = runtimeProviderProxyBaseUrl(env);
  return proxyBase.endsWith('/v1') ? proxyBase : `${proxyBase}/v1`;
}

function isAddrInUse(error: unknown): boolean {
  return isRecord(error) && error.code === 'EADDRINUSE';
}

function preserveConfiguredSecretString(nextValue: unknown, currentValue: unknown) {
  const current = typeof currentValue === 'string' ? currentValue : '';
  if (typeof nextValue !== 'string') return current;
  const next = nextValue.trim();
  if (/^••••/.test(next)) return current;
  if (!next && current.trim()) return current;
  return nextValue;
}

function configuredString(nextValue: unknown, currentValue: unknown) {
  if (typeof nextValue === 'string') return nextValue.trim();
  return typeof currentValue === 'string' ? currentValue.trim() : '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readConfigLocalJson(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(configLocalPath(), 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function configLocalPath() {
  return CONFIG_LOCAL_PATH;
}

function parseJsonEnv(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizePeerInstances(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      appUrl: cleanUrlString(item.appUrl),
      workspaceWriterUrl: cleanUrlString(item.workspaceWriterUrl),
      workspacePath: normalizeWorkspaceRootPath(typeof item.workspacePath === 'string' ? item.workspacePath : ''),
      role: item.role === 'main' || item.role === 'repair' || item.role === 'peer' ? item.role : 'peer',
      trustLevel: item.trustLevel === 'readonly' || item.trustLevel === 'repair' || item.trustLevel === 'sync' ? item.trustLevel : 'readonly',
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    }));
}

function repairPeerInstancesFromCounterpart() {
  const counterpart = parseJsonEnv(process.env.SCIFORGE_COUNTERPART_JSON);
  if (!isRecord(counterpart)) return [];
  const workspaceWriterUrl = cleanUrlString(counterpart.workspaceWriterUrl);
  if (!workspaceWriterUrl) return [];
  return [{
    name: stringValue(counterpart.agentId) || stringValue(counterpart.name) || 'counterpart',
    appUrl: cleanUrlString(counterpart.appUrl),
    workspaceWriterUrl,
    workspacePath: normalizeWorkspaceRootPath(stringValue(counterpart.workspacePath)),
    role: 'repair' as const,
    trustLevel: 'repair' as const,
    enabled: true,
  }];
}

function normalizeToolProviderRoutes(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, rawRoute] of Object.entries(value)) {
    const routeKey = rawKey.trim();
    if (!routeKey || !isRecord(rawRoute)) continue;
    const route: Record<string, unknown> = {};
    if (typeof rawRoute.enabled === 'boolean') route.enabled = rawRoute.enabled;
    if (typeof rawRoute.capabilityId === 'string' && rawRoute.capabilityId.trim()) route.capabilityId = rawRoute.capabilityId.trim();
    const source = typeof rawRoute.source === 'string' ? rawRoute.source.trim() : '';
    if (['local', 'agentserver', 'mcp', 'http', 'ssh', 'client-worker', 'backend-native', 'package', 'workspace', 'external'].includes(source)) route.source = source;
    if (typeof rawRoute.primaryProviderId === 'string' && rawRoute.primaryProviderId.trim()) route.primaryProviderId = rawRoute.primaryProviderId.trim();
    const fallbackProviderIds = stringArray(rawRoute.fallbackProviderIds);
    if (fallbackProviderIds.length) route.fallbackProviderIds = fallbackProviderIds;
    const permissions = stringArray(rawRoute.permissions);
    if (permissions.length) route.permissions = permissions;
    const requiredConfig = stringArray(rawRoute.requiredConfig);
    if (requiredConfig.length) route.requiredConfig = requiredConfig;
    const health = typeof rawRoute.health === 'string' ? rawRoute.health.trim() : '';
    if (['ready', 'unknown', 'unavailable', 'unauthorized', 'rate-limited'].includes(health)) route.health = health;
    for (const keyName of ['endpoint', 'baseUrl', 'url', 'invokeUrl', 'invokePath'] as const) {
      const routeValue = rawRoute[keyName];
      if (typeof routeValue === 'string' && routeValue.trim()) route[keyName] = routeValue.trim().replace(/\/+$/, '');
    }
    if (typeof rawRoute.timeoutMs === 'number' && Number.isFinite(rawRoute.timeoutMs)) route.timeoutMs = Math.max(1_000, Math.trunc(rawRoute.timeoutMs));
    if (Object.keys(route).length) out[routeKey] = route;
  }
  return Object.keys(out).length ? out : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())));
}

function cleanUrlString(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}
