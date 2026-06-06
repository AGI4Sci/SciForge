import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
import {
  previewDerivativeForRef,
  previewDescriptorForRef,
  previewRequestBaseUrl,
  streamWorkspacePreviewFile,
} from './server/file-preview.js';
import { handleBrowserHostSessionRoutes, handleBrowserHostSessionUpgrade } from './workspace-server-browser-host.js';
import { handleWorkspaceModuleRoutes } from './workspace-server-modules.js';
import { handleScenarioLibraryRoutes } from './server/scenario-library-routes.js';
import { handleWorkspaceFileApiRoutes, readLastWorkspacePath } from './server/workspace-file-api.js';
import { buildWorkspaceWriterHealth } from './workspace-server-health.js';
import { gitOutput, gitStrict } from './workspace-server-git.js';
import { handleLegacyToolsRunStreamRoute, handleWorkspaceCors, legacyToolsRunSyncDecision, workspaceRequestUrl } from './workspace-server-http.js';
import {
  buildWorkspaceInstanceManifest,
  buildWorkspaceStableVersionEnvironment,
  readWorkspaceConfig,
  readWorkspaceRepoInfo,
} from './workspace-server-metadata.js';
import {
  repairActionName,
  repairBrowserVerificationFromBody,
  repairControlSurfaceSafeMode,
  repairResultCommitBlocker,
  safeRepoRelativePath,
} from './workspace-server-repair-actions.js';
import {
  buildRuntimeProviderPreflightManifest,
  normalizeRuntimeProviderProxyHealthzResponse,
  runtimeProviderProxyBaseUrl as normalizeRuntimeProviderProxyBaseUrl,
} from './workspace-server-runtime-provider-preflight.js';
import { readRuntimeCodexBrowserAcceptanceManifest } from './workspace-server-runtime-codex-browser-acceptance.js';
import { parseFeedbackCodexPtyClientMessage, ptyDimension } from './workspace-server-feedback-terminal-protocol.js';
import { runFeedbackRepairGuidance } from './workspace-server-feedback-guidance.js';
import {
  firstImageDataUrl,
  isRepairEvidenceRef,
  mergeEvidenceAssets,
  persistFeedbackScreenshotEvidenceAssets,
  REPAIR_EVIDENCE_PUBLIC_DIR,
  repairEvidencePublicUrl,
  repairEvidenceRelativeRef,
} from './workspace-server-feedback-evidence-assets.js';
import {
  buildFeedbackCodexTerminalPrompt,
  buildFeedbackCodexTerminalRepairRun,
  feedbackCodexPtyArgs,
  feedbackCodexSystemTerminalLaunchRef,
  feedbackCodexTerminalManifestRef,
  feedbackCodexTerminalMirrorRef,
  feedbackCodexTerminalPromptRef,
  feedbackCodexTerminalPublicSession,
  feedbackCodexTerminalStatus,
  feedbackCodexTerminalTransport,
  repairRunStatusForCodexTerminal,
  repairRunStatusForResult,
  resolveCodexPtyCommand,
  systemTerminalCodexCommandPreview,
  systemTerminalLaunchScript,
  withCodexPtyPath,
  type FeedbackCodexTerminalSession,
  type FeedbackCodexTerminalStatus,
} from './workspace-server-feedback-codex-terminal.js';
import {
  appendStateRecord,
  compactString,
  digestString,
  feedbackCommentSeedFromBody,
  feedbackIssueSummary,
  feedbackRequestForComment,
  findFeedbackComment,
  githubMetadataForComment,
  handoffFeedbackComments,
  normalizeFeedbackBundleId,
  normalizeRepairHumanVerification,
  normalizeRepairInstanceRef,
  normalizeRepairRefs,
  normalizeRepairTerminalMirror,
  normalizeRepairTestResults,
  persistFeedbackRecord,
  recordField,
  repairRecordsForIssue,
  screenshotMetadataForComment,
  scrubFeedbackError,
  stringArray,
  stringField,
  toPosixPath,
  uniqueStrings,
} from './workspace-server-feedback-records.js';
import {
  createWorkspaceLocalConfigService,
  parseJsonEnv,
  stringValue,
} from './workspace-server-local-config.js';
import { CODEX_RUNTIME_STREAM_PATH as CODEX_RUNTIME_SERVER_STREAM_PATH, CODEX_RUNTIME_WEBSOCKET_PATH, handleCodexRuntimeRoutes, handleCodexRuntimeUpgrade } from './codex/codex-runtime-server.js';
import { createCodexAppServerRuntimeAdapter } from './codex/codex-runtime-adapter.js';
import { createDefaultCodexAgentHostRuntimeTruthResolver } from './codex/agent-host-runtime-truth-resolver.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex/codex-runtime-config.js';
import { normalizeInstanceName, parallelProfile } from './parallel-instance-profile.js';
import { assertCodexNoForkGate } from '../../packages/backend/src/codex-compatibility-gate.js';
import {
  DEFAULT_PROXY_BASE_URL,
  resolveRuntimeCodexSandbox,
  RUNTIME_PROFILE,
} from '../../packages/backend/src/runtime-home.js';
import { resolveProxyCliOptions } from '../../packages/backend/src/cli-config.js';

const INSTANCE_ID = process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || 'default';
const INSTANCE_ROLE = process.env.SCIFORGE_INSTANCE_ROLE || INSTANCE_ID;
const DEFAULT_PARALLEL_INSTANCE_ID = normalizeParallelInstanceId(INSTANCE_ID);
const CODEX_RUNTIME_STREAM_PATH = '/api/sciforge/runtime/codex/stream' as const;
if (CODEX_RUNTIME_STREAM_PATH !== CODEX_RUNTIME_SERVER_STREAM_PATH) {
  throw new Error('Workspace server Runtime Codex stream route drifted from codex runtime server route.');
}
const DEFAULT_PARALLEL_PROFILE = parallelProfile(DEFAULT_PARALLEL_INSTANCE_ID);
const PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || DEFAULT_PARALLEL_PROFILE.workspacePort);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || DEFAULT_PARALLEL_PROFILE.uiPort);
const DEFAULT_PARALLEL_STATE_DIR = join(process.cwd(), DEFAULT_PARALLEL_PROFILE.stateDir);
const DEFAULT_PARALLEL_WORKSPACE_PATH = join(process.cwd(), DEFAULT_PARALLEL_PROFILE.workspacePath);
const STATE_DIR = resolve(process.env.SCIFORGE_STATE_DIR || DEFAULT_PARALLEL_STATE_DIR);
const LOG_DIR = resolve(process.env.SCIFORGE_LOG_DIR || join(STATE_DIR, 'logs'));
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || join(process.cwd(), DEFAULT_PARALLEL_PROFILE.configPath));
const DEFAULT_WORKSPACE_PATH = normalizeWorkspaceRootPath(resolve(process.env.SCIFORGE_WORKSPACE_PATH || DEFAULT_PARALLEL_WORKSPACE_PATH));
const REPAIR_EVIDENCE_UPLOAD_DIR = process.env.SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR ? resolve(process.env.SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR) : '';
const STARTED_AT = new Date().toISOString();
const LIFECYCLE_TOKEN = process.env.SCIFORGE_SERVICE_LIFECYCLE_TOKEN || '';
const {
  readLocalSciForgeConfig,
  writeLocalSciForgeConfig,
  prepareRuntimeCodexEnvFromLocalConfig,
} = createWorkspaceLocalConfigService({
  configLocalPath: CONFIG_LOCAL_PATH,
  runtimeCodexPort: Number(DEFAULT_PARALLEL_PROFILE.runtimeCodexPort),
  workspaceWriterPort: PORT,
  defaultWorkspacePath: DEFAULT_WORKSPACE_PATH,
  defaultProxyBaseUrl: DEFAULT_PROXY_BASE_URL,
});

function normalizeParallelInstanceId(value: string) {
  const normalized = normalizeInstanceName(value);
  return /^p[1-8]$/.test(normalized) ? normalized : 'p1';
}

interface ActiveFeedbackCodexTerminalSession extends FeedbackCodexTerminalSession {
  ptyProcess?: IPty;
  ptyBacklog?: string[];
  ptySockets?: Set<WebSocket>;
}

type WorkspaceTerminalStatus = 'starting' | 'running' | 'idle' | 'failed' | 'cancelled';

interface WorkspaceTerminalSession {
  schemaVersion: 1;
  id: string;
  status: WorkspaceTerminalStatus;
  workspacePath: string;
  cwd: string;
  shell: string;
  transcriptRef: string;
  startedAt: string;
  updatedAt: string;
  message?: string;
  webSocketPath: string;
}

interface ActiveWorkspaceTerminalSession extends WorkspaceTerminalSession {
  ptyProcess?: IPty;
  ptyBacklog?: string[];
  ptySockets?: Set<WebSocket>;
  transcriptPath?: string;
}

const activeFeedbackCodexTerminalSessions = new Map<string, ActiveFeedbackCodexTerminalSession>();
const feedbackCodexPtyWss = new WebSocketServer({ noServer: true });
const activeWorkspaceTerminalSessions = new Map<string, ActiveWorkspaceTerminalSession>();
const workspaceTerminalWss = new WebSocketServer({ noServer: true });
const agentHostRuntimeTruthResolver = createDefaultCodexAgentHostRuntimeTruthResolver({ env: process.env });

const workspaceServer = createServer(async (req, res) => {
  if (handleWorkspaceCors(req, res)) return;
  if (req.url === '/health') {
    writeJson(res, 200, buildWorkspaceWriterHealth({
      pid: process.pid,
      startedAt: STARTED_AT,
      instanceId: INSTANCE_ID,
      lifecycleToken: LIFECYCLE_TOKEN,
    }));
    return;
  }
  const url = workspaceRequestUrl(req);
  if (await handleBrowserHostSessionRoutes(req, res, url, {
    workspaceRootFromRequest,
    workspaceRootFromBodyOrRequest,
  })) return;
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
      const manifest = await readRuntimeCodexBrowserAcceptanceManifest({
        cwd: process.cwd(),
        env: process.env,
        parallelProfileId: DEFAULT_PARALLEL_PROFILE.id,
      });
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
  if (url.pathname === CODEX_RUNTIME_STREAM_PATH) {
    try {
      const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
      if (await handleCodexRuntimeRoutes(req, res, url, createCodexAppServerRuntimeAdapter({ env: runtimeEnv }), {
        agentHostRuntimeTruthResolver,
      })) return;
      writeJson(res, 404, { ok: false, error: 'Runtime Codex route not found.' });
    } catch (err) {
      writeJson(res, 503, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
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
  if (url.pathname === '/api/sciforge/terminal/sessions/start' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await workspaceRootFromBodyOrRequest(body, url);
      const session = await startWorkspaceTerminalSession(root, body);
      writeJson(res, 200, { ok: true, workspacePath: root, session: workspaceTerminalPublicSession(session) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const workspaceTerminalSessionMatch = /^\/api\/sciforge\/terminal\/sessions\/([^/]+)\/(stop|tail)$/.exec(url.pathname);
  if (workspaceTerminalSessionMatch) {
    try {
      const sessionId = decodeURIComponent(workspaceTerminalSessionMatch[1]);
      const action = workspaceTerminalSessionMatch[2];
      if (action === 'tail' && req.method === 'GET') {
        const root = await workspaceRootFromRequest(url);
        const cursor = Number(url.searchParams.get('cursor') || url.searchParams.get('after') || 0);
        const limit = Number(url.searchParams.get('limit') || 200);
        const result = await loadWorkspaceTerminalTail(root, sessionId, { cursor, limit });
        writeJson(res, 200, { ok: true, workspacePath: root, ...result });
        return;
      }
      if (action === 'stop' && req.method === 'POST') {
        const body = await readJson(req);
        const root = await workspaceRootFromBodyOrRequest(body, url);
        const session = await stopWorkspaceTerminalSession(root, sessionId, body);
        writeJson(res, 200, { ok: true, workspacePath: root, session });
        return;
      }
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
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
      const guidance = await runFeedbackRepairGuidance({
        root,
        issueId,
        body,
        readWorkspaceStateFile,
        writeWorkspaceStateFile,
        prepareRuntimeCodexEnvFromLocalConfig,
        resolveRepairTerminalMirrorRef,
      });
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
  if (await handleWorkspaceModuleRoutes(req, res, url, {
    workspaceRootFromBodyOrRequest,
  })) return;
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
      const legacyDecision = legacyToolsRunSyncDecision(body);
      if (!legacyDecision.allowed) {
        writeJson(res, legacyDecision.statusCode, {
          ok: false,
          error: legacyDecision.reason,
          replacementPath: '/api/sciforge/runtime/codex/stream',
        });
        return;
      }
      const result = await runSciForgeTool(body);
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/tools/run/stream' && req.method === 'POST') {
    await handleLegacyToolsRunStreamRoute(req, res, runSciForgeTool);
    return;
  }
  writeJson(res, 404, { ok: false, error: 'not found' });
});

workspaceServer.on('upgrade', handleWorkspaceUpgrade);

workspaceServer.listen(PORT, '127.0.0.1', () => {
  console.log(`SciForge workspace writer: http://127.0.0.1:${PORT}`);
});

function handleWorkspaceUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = workspaceRequestUrl(req);
  if (url.pathname === CODEX_RUNTIME_WEBSOCKET_PATH) {
    void (async () => {
      const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
      if (!handleCodexRuntimeUpgrade(req, socket, head, createCodexAppServerRuntimeAdapter({ env: runtimeEnv }), {
        agentHostRuntimeTruthResolver,
      })) socket.destroy();
    })().catch(() => socket.destroy());
    return;
  }
  if (handleBrowserHostSessionUpgrade(req, socket, head, {
    workspaceRootFromRequest,
  })) return;
  if (handleWorkspaceTerminalUpgrade(req, socket, head)) return;
  handleFeedbackCodexPtyUpgrade(req, socket, head);
}

function handleWorkspaceTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = workspaceRequestUrl(req);
  const match = /^\/api\/sciforge\/terminal\/sessions\/([^/]+)\/ws$/.exec(url.pathname);
  if (!match) return false;
  workspaceTerminalWss.handleUpgrade(req, socket, head, (ws) => {
    void connectWorkspaceTerminalSocket(ws, decodeURIComponent(match[1]), url).catch((err: unknown) => {
      ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      ws.close(1011, 'workspace terminal unavailable');
    });
  });
  return true;
}

function handleFeedbackCodexPtyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = workspaceRequestUrl(req);
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

async function connectWorkspaceTerminalSocket(ws: WebSocket, sessionId: string, url: URL) {
  const requestedRoot = url.searchParams.get('workspacePath')?.trim();
  const session = activeWorkspaceTerminalSessions.get(sessionId)
    ?? (requestedRoot ? await activeOrStoredWorkspaceTerminalSession(normalizeWorkspaceRootPath(resolve(requestedRoot)), sessionId) : undefined);
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', message: `Workspace terminal session not found: ${sessionId}` }));
    ws.close(1011, 'workspace terminal session not found');
    return;
  }
  session.ptySockets = session.ptySockets ?? new Set();
  session.ptySockets.add(ws);
  ws.send(JSON.stringify({ type: 'status', session: workspaceTerminalPublicSession(session) }));
  for (const chunk of session.ptyBacklog ?? []) {
    ws.send(JSON.stringify({ type: 'output', data: chunk }));
  }
  ws.on('message', (raw) => {
    const message = parseFeedbackCodexPtyClientMessage(raw.toString());
    if (!message) return;
    if (message.type === 'input') {
      if (session.ptyProcess) session.ptyProcess.write(message.data);
      else ws.send(JSON.stringify({ type: 'error', message: 'Workspace terminal process is not running.' }));
    }
    if (message.type === 'resize' && session.ptyProcess) {
      session.ptyProcess.resize(message.cols, message.rows);
    }
    if (message.type === 'stop') {
      void stopWorkspaceTerminalSession(session.workspacePath, session.id, { reason: 'websocket stop request' }).catch(() => undefined);
    }
  });
  ws.on('close', () => {
    session.ptySockets?.delete(ws);
  });
}

function broadcastWorkspaceTerminal(session: ActiveWorkspaceTerminalSession, payload: Record<string, unknown>) {
  const text = JSON.stringify(payload);
  for (const socket of session.ptySockets ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }
}

function broadcastWorkspaceTerminalStatus(session: ActiveWorkspaceTerminalSession) {
  broadcastWorkspaceTerminal(session, { type: 'status', session: workspaceTerminalPublicSession(session) });
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
  const repo = await readWorkspaceRepoInfo(root);
  const stableVersion = await readStableVersion(STATE_DIR);
  return buildWorkspaceInstanceManifest({
    root,
    state,
    config,
    localConfig,
    repo,
    stableVersion,
    agentId: INSTANCE_ID,
    role: INSTANCE_ROLE,
    appPort: UI_PORT,
    workspaceWriterPort: PORT,
    repoPath: process.cwd(),
    stateDir: STATE_DIR,
    logDir: LOG_DIR,
    configLocalPath: CONFIG_LOCAL_PATH,
    counterpart: parseJsonEnv(process.env.SCIFORGE_COUNTERPART_JSON),
  });
}

async function stableVersionEnvironment(root: string) {
  const [state, repo] = await Promise.all([
    readWorkspaceStateFile(root).catch(() => undefined),
    readWorkspaceRepoInfo(root),
  ]);
  return buildWorkspaceStableVersionEnvironment({
    root,
    state,
    repo,
    instanceId: INSTANCE_ID,
    role: INSTANCE_ROLE,
    stateDir: STATE_DIR,
  });
}

async function readRuntimeProviderPreflightManifest() {
  const serviceEnv = process.env;
  const runtimeEnv = await prepareRuntimeCodexEnvFromLocalConfig();
  const proxyOptions = resolveProxyCliOptions([], runtimeEnv);
  const runtimeApiKeyPresentInServiceEnv = Boolean(stringValue(serviceEnv.SCIFORGE_RUNTIME_API_KEY));
  const upstreamBaseUrlPresent = Boolean(proxyOptions.upstreamBaseUrl);
  const checkedHealthz = runtimeApiKeyPresentInServiceEnv && upstreamBaseUrlPresent
    ? await requestRuntimeProviderProxyHealthz(runtimeEnv)
    : undefined;
  return buildRuntimeProviderPreflightManifest({
    serviceEnv,
    runtimeEnv,
    proxyOptions,
    checkedHealthz,
  });
}

async function requestRuntimeProviderProxyHealthz(env: NodeJS.ProcessEnv) {
  const baseUrl = runtimeProviderProxyBaseUrl(env);
  try {
    const response = await fetch(`${baseUrl}/healthz?check=upstream`, { signal: AbortSignal.timeout(3_500) });
    const parsed = await response.json().catch(() => ({}));
    return normalizeRuntimeProviderProxyHealthzResponse(response.ok, parsed);
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
  return normalizeRuntimeProviderProxyBaseUrl(env, DEFAULT_PROXY_BASE_URL);
}

function stableVersionRegistryPathForResponse() {
  return stableVersionRegistryPath(STATE_DIR);
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

async function startWorkspaceTerminalSession(root: string, body: Record<string, unknown>) {
  const now = new Date().toISOString();
  const sessionId = `terminal-session-${Date.now().toString(36)}-${safeName(basename(root) || 'workspace')}`;
  const cwd = workspaceTerminalCwd(root, stringField(body.cwd));
  const shell = workspaceTerminalShell(stringField(body.shell));
  const transcriptRef = workspaceTerminalTranscriptRef(sessionId);
  const transcriptPath = workspaceTerminalTranscriptPath(root, sessionId);
  const webSocketPath = `/api/sciforge/terminal/sessions/${encodeURIComponent(sessionId)}/ws`;
  const session: ActiveWorkspaceTerminalSession = {
    schemaVersion: 1,
    id: sessionId,
    status: 'starting',
    workspacePath: root,
    cwd,
    shell,
    transcriptRef,
    startedAt: now,
    updatedAt: now,
    message: 'Workspace terminal is starting.',
    webSocketPath,
    transcriptPath,
    ptyBacklog: [],
    ptySockets: new Set(),
  };
  activeWorkspaceTerminalSessions.set(session.id, session);
  await persistWorkspaceTerminalSession(session);
  await appendRepairTerminalMirrorEntry(transcriptPath, 'event', `Workspace terminal session started. cwd=${cwd}; shell=${shell}`);
  try {
    const cols = ptyDimension(body.cols, 110, 40, 240);
    const rows = ptyDimension(body.rows, 28, 12, 80);
    const ptyProcess = spawnPty(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        SCIFORGE_WORKSPACE_PATH: root,
      },
    });
    session.ptyProcess = ptyProcess;
    session.status = 'running';
    session.message = 'Workspace terminal is running.';
    session.updatedAt = new Date().toISOString();
    await persistWorkspaceTerminalSession(session);
    broadcastWorkspaceTerminalStatus(session);
    ptyProcess.onData((data) => {
      const chunk = data.slice(0, 12_000);
      session.ptyBacklog = [...(session.ptyBacklog ?? []), chunk].slice(-250);
      broadcastWorkspaceTerminal(session, { type: 'output', data: chunk });
      void appendRepairTerminalMirrorEntry(workspaceTerminalTranscriptPath(session.workspacePath, session.id), 'stdout', chunk).catch(() => undefined);
    });
    ptyProcess.onExit((event) => {
      void finishWorkspaceTerminalSession(session.id, event.exitCode, event.signal).catch(() => undefined);
    });
    return session;
  } catch (err) {
    const message = `Workspace terminal dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
    session.status = 'failed';
    session.message = message;
    session.updatedAt = new Date().toISOString();
    await appendRepairTerminalMirrorEntry(transcriptPath, 'stderr', message);
    await persistWorkspaceTerminalSession(session);
    broadcastWorkspaceTerminalStatus(session);
    throw err;
  }
}

async function finishWorkspaceTerminalSession(sessionId: string, exitCode: number, signal?: number) {
  const session = activeWorkspaceTerminalSessions.get(sessionId);
  if (!session) return;
  session.ptyProcess = undefined;
  const wasCancelled = session.status === 'cancelled';
  const finalStatus: WorkspaceTerminalStatus = wasCancelled ? 'cancelled' : exitCode === 0 ? 'idle' : 'failed';
  const message = wasCancelled
    ? session.message || 'Workspace terminal cancelled.'
    : exitCode === 0
    ? 'Workspace terminal exited.'
    : `Workspace terminal exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}.`;
  session.status = finalStatus;
  session.message = message;
  session.updatedAt = new Date().toISOString();
  await appendRepairTerminalMirrorEntry(workspaceTerminalTranscriptPath(session.workspacePath, session.id), finalStatus === 'idle' ? 'event' : 'stderr', message);
  await persistWorkspaceTerminalSession(session);
  broadcastWorkspaceTerminal(session, { type: 'exit', exitCode, signal, session: workspaceTerminalPublicSession(session) });
  broadcastWorkspaceTerminalStatus(session);
}

async function stopWorkspaceTerminalSession(root: string, sessionId: string, body: Record<string, unknown>) {
  const session = await activeOrStoredWorkspaceTerminalSession(root, sessionId);
  const reason = stringField(body.reason) || 'right pane terminal stop';
  const message = session.ptyProcess
    ? `Stop requested for workspace terminal ${session.id}: ${reason}`
    : `Stop requested for workspace terminal ${session.id}, but no active PTY process is attached.`;
  await appendRepairTerminalMirrorEntry(workspaceTerminalTranscriptPath(root, session.id), 'stderr', message);
  if (session.ptyProcess) {
    session.ptyProcess.kill();
    session.ptyProcess = undefined;
    session.status = 'cancelled';
  } else {
    session.status = session.status === 'running' || session.status === 'starting' ? 'idle' : session.status;
  }
  session.message = message;
  session.updatedAt = new Date().toISOString();
  await persistWorkspaceTerminalSession(session);
  broadcastWorkspaceTerminalStatus(session);
  return workspaceTerminalPublicSession(session);
}

async function loadWorkspaceTerminalTail(root: string, sessionId: string, options: { cursor?: number; limit?: number }) {
  const session = activeWorkspaceTerminalSessions.get(sessionId) ?? await readWorkspaceTerminalSession(root, sessionId);
  const terminalPath = workspaceTerminalTranscriptPath(root, sessionId);
  const text = await readFile(terminalPath, 'utf8').catch((err: unknown) => {
    if (isNodeErrorCode(err, 'ENOENT')) return '';
    throw err;
  });
  return {
    session: session ? workspaceTerminalPublicSession(session) : undefined,
    tail: parseRepairTerminalMirrorNdjson(text, {
      cursor: Number.isFinite(options.cursor) ? options.cursor : 0,
      limit: Number.isFinite(options.limit) ? options.limit : 200,
      terminalMirrorRef: session?.transcriptRef ?? workspaceTerminalTranscriptRef(sessionId),
    }),
  };
}

function workspaceTerminalPublicSession(session: ActiveWorkspaceTerminalSession | WorkspaceTerminalSession): WorkspaceTerminalSession {
  return {
    schemaVersion: 1,
    id: session.id,
    status: workspaceTerminalStatus(session.status),
    workspacePath: session.workspacePath,
    cwd: session.cwd,
    shell: session.shell,
    transcriptRef: session.transcriptRef,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    message: session.message,
    webSocketPath: session.webSocketPath,
  };
}

function workspaceTerminalStatus(value: unknown): WorkspaceTerminalStatus {
  return value === 'starting' || value === 'running' || value === 'idle' || value === 'failed' || value === 'cancelled'
    ? value
    : 'idle';
}

function workspaceTerminalDir(root: string, sessionId: string) {
  return join(root, '.sciforge', 'terminal-sessions', normalizeFeedbackBundleId(sessionId));
}

function workspaceTerminalTranscriptRef(sessionId: string) {
  return `terminal-transcript:${normalizeFeedbackBundleId(sessionId)}`;
}

function workspaceTerminalTranscriptPath(root: string, sessionId: string) {
  return join(workspaceTerminalDir(root, sessionId), 'terminal-mirror.ndjson');
}

function workspaceTerminalManifestRef(root: string, sessionId: string) {
  return join(workspaceTerminalDir(root, sessionId), 'workspace-terminal.json');
}

async function activeOrStoredWorkspaceTerminalSession(root: string, sessionId: string): Promise<ActiveWorkspaceTerminalSession> {
  const active = activeWorkspaceTerminalSessions.get(sessionId);
  if (active) return active;
  const stored = await readWorkspaceTerminalSession(root, sessionId);
  if (!stored) throw new Error(`Workspace terminal session not found: ${sessionId}`);
  return { ...stored, ptyBacklog: [], ptySockets: new Set() };
}

async function readWorkspaceTerminalSession(root: string, sessionId: string): Promise<WorkspaceTerminalSession | undefined> {
  const manifest = await readOptionalJson(workspaceTerminalManifestRef(root, sessionId)).catch(() => undefined);
  if (!isRecord(manifest) || typeof manifest.id !== 'string') return undefined;
  return {
    schemaVersion: 1,
    id: manifest.id,
    status: workspaceTerminalStatus(manifest.status),
    workspacePath: stringField(manifest.workspacePath) || root,
    cwd: stringField(manifest.cwd) || root,
    shell: workspaceTerminalShell(stringField(manifest.shell)),
    transcriptRef: workspaceTerminalTranscriptRef(manifest.id),
    startedAt: stringField(manifest.startedAt) || new Date().toISOString(),
    updatedAt: stringField(manifest.updatedAt) || stringField(manifest.startedAt) || new Date().toISOString(),
    message: stringField(manifest.message),
    webSocketPath: stringField(manifest.webSocketPath) || `/api/sciforge/terminal/sessions/${encodeURIComponent(manifest.id)}/ws`,
  };
}

async function persistWorkspaceTerminalSession(session: WorkspaceTerminalSession) {
  await mkdir(dirname(workspaceTerminalManifestRef(session.workspacePath, session.id)), { recursive: true });
  await writeFile(workspaceTerminalManifestRef(session.workspacePath, session.id), JSON.stringify(workspaceTerminalPublicSession(session), null, 2));
}

function workspaceTerminalCwd(root: string, value: string | undefined) {
  const requested = value?.trim();
  if (!requested) return root;
  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Workspace terminal refused a cwd outside the active workspace.');
  }
  return target;
}

function workspaceTerminalShell(value: string | undefined) {
  const candidate = value?.trim() || process.env.SHELL || '/bin/zsh';
  if (!isAbsolute(candidate) || candidate.includes('\0')) return '/bin/zsh';
  return candidate;
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
  const launchSurface = stringField(body.launchSurface) === 'web-viewer' ? 'web-viewer' : 'system-terminal';
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
    transport: launchSurface === 'web-viewer' ? 'websocket-pty' : 'system-terminal',
    webSocketPath: launchSurface === 'web-viewer' ? webSocketPath : undefined,
    ptyBacklog: [],
    ptySockets: new Set(),
    message: launchSurface === 'web-viewer'
      ? 'Codex repair session is starting with the Web Viewer attached.'
      : 'Codex repair session is starting in macOS Terminal; the Web Viewer remains optional.',
  };
  activeFeedbackCodexTerminalSessions.set(session.id, session);
  await persistFeedbackCodexTerminalSession(session);
  await appendRepairTerminalMirrorEntry(terminalMirrorRef, 'event', `Codex repair session started for feedback ${canonicalIssueId}. Launch surface=${launchSurface}; workspace=${root}`);
  await appendRepairTerminalMirrorEntry(terminalMirrorRef, 'event', `Generated feedback prompt saved at ${promptRef}.`);
  const repairRun = buildFeedbackCodexTerminalRepairRun({
    session,
    comment,
    body,
    instanceId: INSTANCE_ID,
    instanceRole: INSTANCE_ROLE,
  });
  const next = appendStateRecord(state, 'feedbackRepairRuns', repairRun);
  await persistFeedbackRecord(root, 'repair-runs', repairRun.id, repairRun);
  await writeWorkspaceStateFile(root, next);
  if (launchSurface === 'web-viewer') {
    await launchFeedbackCodexPtySession(session, prompt, body);
  } else {
    await launchFeedbackCodexSystemTerminalSession(session, prompt);
  }
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
    const message = `Codex Web Viewer PTY dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
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

async function launchFeedbackCodexSystemTerminalSession(
  session: ActiveFeedbackCodexTerminalSession,
  prompt: string,
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
    const commandPreview = systemTerminalCodexCommandPreview({
      codexCommand,
      args,
      prompt,
      promptRef: session.promptRef,
      codexHome: config.codexHome,
      configPath: CONFIG_LOCAL_PATH,
    });
    const launchRef = feedbackCodexSystemTerminalLaunchRef(session.workspacePath, session.id);
    await mkdir(dirname(launchRef), { recursive: true });
    await writeFile(launchRef, systemTerminalLaunchScript({
      workspace: config.workspace,
      codexCommand,
      args,
      prompt,
      promptRef: session.promptRef,
      codexHome: config.codexHome,
      configPath: CONFIG_LOCAL_PATH,
      env,
      path: env.PATH || process.env.PATH || '',
    }));
    await chmod(launchRef, 0o700);
    session.systemTerminalLaunchRef = launchRef;
    session.systemTerminalCommandPreview = commandPreview;
    session.status = 'running';
    session.message = 'Codex repair session launched in macOS Terminal. The Web Viewer is optional and the durable log remains attached to this repair thread.';
    session.updatedAt = new Date().toISOString();
    session.ptyBacklog = [
      `System Terminal launch script: ${launchRef}\r\n`,
      'The Codex process is owned by macOS Terminal, not the Vite/React page.\r\n',
    ];
    await appendRepairTerminalMirrorEntry(session.terminalMirrorRef, 'event', `System Terminal launch script saved at ${launchRef}.`);
    await appendRepairTerminalMirrorEntry(session.terminalMirrorRef, 'event', 'Opening macOS Terminal for this Codex repair session; Web Viewer is attach-only.');
    const opener = spawn('open', ['-a', 'Terminal', launchRef], { detached: true, stdio: 'ignore' });
    opener.unref();
    await persistFeedbackCodexTerminalSession(session);
    await persistDirectTerminalRepairRunStatus(session, 'running', session.message);
    broadcastFeedbackCodexPtyStatus(session);
  } catch (err) {
    const message = `System Terminal Codex launch failed: ${err instanceof Error ? err.message : String(err)}`;
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
    ? `Stop requested for Codex repair Web Viewer PTY ${session.id}: ${reason}`
    : `Stop requested for Codex repair session ${session.id}, but no active backend PTY process is attached.`;
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
  if (!stored) throw new Error(`Codex repair session not found: ${sessionId}`);
  const wasRunning = stored.transport === 'websocket-pty' && (stored.status === 'running' || stored.status === 'starting');
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
    systemTerminalLaunchRef: stringField(manifest.systemTerminalLaunchRef),
    systemTerminalCommandPreview: stringField(manifest.systemTerminalCommandPreview),
  };
}

async function persistFeedbackCodexTerminalSession(session: FeedbackCodexTerminalSession) {
  await mkdir(dirname(feedbackCodexTerminalManifestRef(session.workspacePath, session.id)), { recursive: true });
  await writeFile(feedbackCodexTerminalManifestRef(session.workspacePath, session.id), JSON.stringify(feedbackCodexTerminalPublicSession(session), null, 2));
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
      terminalMode: session.transport === 'system-terminal' ? 'system-terminal-codex' : 'interactive-codex-pty',
      directCodexTerminalSessionId: session.id,
      codexSessionId: session.codexSessionId,
      directCodexTerminalStatus: status,
      webSocketPath: session.webSocketPath,
      systemTerminalLaunchRef: session.systemTerminalLaunchRef,
      systemTerminalCommandPreview: session.systemTerminalCommandPreview,
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
