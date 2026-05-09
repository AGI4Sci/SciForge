import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { runSciForgeTool } from './sciforge-tools.js';
import { syncRepairResultToGithubIssue } from './github-repair-sync.js';
import { runRepairHandoff } from './repair-handoff-runner.js';
import { buildStableVersionSyncPlan, promoteStableVersion, readStableVersion, stableVersionRegistryPath } from './stable-version-registry.js';
import { normalizeWorkspaceRootPath, resolveWorkspaceFilePreviewPath, resolveWorkspacePreviewRef } from './workspace-paths.js';
import { isRecord, readJson, readOptionalJson, safeName, writeJson, writeStreamEnvelope } from './server/http.js';
import {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE,
  WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
} from '@sciforge-ui/runtime-contract';
import {
  isBinaryPreviewFile,
  languageForPath,
  mimeTypeForPath,
  previewDerivativeForRef,
  previewDescriptorForRef,
  previewRequestBaseUrl,
  streamWorkspacePreviewFile,
} from './server/file-preview.js';
import { handleScenarioLibraryRoutes } from './server/scenario-library-routes.js';
import { runWorkspaceOpenAction } from './server/workspace-open.js';

const PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const INSTANCE_ID = process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || 'default';
const INSTANCE_ROLE = process.env.SCIFORGE_INSTANCE_ROLE || INSTANCE_ID;
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || 5173);
const STATE_DIR = resolve(process.env.SCIFORGE_STATE_DIR || join(process.cwd(), '.sciforge'));
const LOG_DIR = resolve(process.env.SCIFORGE_LOG_DIR || join(STATE_DIR, 'logs'));
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || join(process.cwd(), 'config.local.json'));
const DEFAULT_WORKSPACE_PATH = normalizeWorkspaceRootPath(resolve(process.env.SCIFORGE_WORKSPACE_PATH || join(process.cwd(), 'workspace')));

createServer(async (req, res) => {
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
      capabilities: [
        'workspace-snapshot',
        'workspace-files',
        'sciforge-tools',
        'repair-handoff-runner',
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
      const result = await runRepairHandoff(normalizeRepairHandoffContract(body), {
        executorRepoPath: process.cwd(),
        executorStateDir: STATE_DIR,
        executorLogDir: LOG_DIR,
        executorConfigLocalPath: CONFIG_LOCAL_PATH,
      });
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
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
  if (url.pathname === '/api/sciforge/workspace/list' && req.method === 'GET') {
    try {
      const root = resolve(url.searchParams.get('path') || process.cwd());
      const entries = await readdir(root, { withFileTypes: true });
      const mapped = await Promise.all(entries
        .map(async (entry) => {
          const path = join(root, entry.name);
          const info = await stat(path).catch(() => undefined);
          return {
            name: entry.name,
            path,
            kind: entry.isDirectory() ? 'folder' : 'file',
            size: info?.size,
            modifiedAt: info?.mtime?.toISOString(),
          };
        }));
      writeJson(res, 200, {
        ok: true,
        path: root,
        entries: mapped
          .sort((left, right) => Number(right.kind === 'folder') - Number(left.kind === 'folder') || left.name.localeCompare(right.name))
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/workspace/file' && req.method === 'GET') {
    try {
      const filePath = resolveWorkspaceFilePreviewPath(
        url.searchParams.get('path') || '',
        url.searchParams.get('workspacePath') || '',
      );
      if (!filePath) throw new Error('path is required');
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`${filePath} is not a file`);
      const binaryPreview = isBinaryPreviewFile(filePath);
      const previewLimit = binaryPreview ? 25 * 1024 * 1024 : 1024 * 1024;
      if (info.size > previewLimit) {
        throw new Error(`File is larger than the ${binaryPreview ? '25MB binary preview' : '1MB text preview/edit'} limit.`);
      }
      const content = binaryPreview
        ? (await readFile(filePath)).toString('base64')
        : await readFile(filePath, 'utf8');
      writeJson(res, 200, {
        ok: true,
        file: {
          path: filePath,
          name: basename(filePath),
          content,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          language: languageForPath(filePath),
          encoding: binaryPreview ? 'base64' : 'utf8',
          mimeType: mimeTypeForPath(filePath),
        },
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/preview/raw' && req.method === 'GET') {
    try {
      const filePath = resolveWorkspacePreviewRef(
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
  if (url.pathname === '/api/sciforge/workspace/file' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const filePath = typeof body.path === 'string' ? resolve(body.path) : '';
      const content = typeof body.content === 'string' ? body.content : '';
      const encoding = body.encoding === 'base64' ? 'base64' : 'utf8';
      if (!filePath) throw new Error('path is required');
      await mkdir(dirname(filePath), { recursive: true });
      if (encoding === 'base64') {
        await writeFile(filePath, Buffer.from(content, 'base64'));
      } else {
        await writeFile(filePath, content, 'utf8');
      }
      const info = await stat(filePath);
      writeJson(res, 200, {
        ok: true,
        file: {
          path: filePath,
          name: basename(filePath),
          content,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          language: languageForPath(filePath),
          encoding,
          mimeType: typeof body.mimeType === 'string' ? body.mimeType : mimeTypeForPath(filePath),
        },
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/workspace/snapshot' && req.method === 'GET') {
    try {
      const requestedPath = url.searchParams.get('path')?.trim() || '';
      const root = requestedPath ? resolve(requestedPath) : await readLastWorkspacePath();
      const state = JSON.parse(await readFile(join(root, '.sciforge', 'workspace-state.json'), 'utf8'));
      writeJson(res, 200, { ok: true, workspacePath: root, state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('ENOENT') ? 404 : 400;
      writeJson(res, status, { ok: false, error: message });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/workspace/file-action' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const action = typeof body.action === 'string' ? body.action : '';
      const targetPath = typeof body.path === 'string' ? resolve(body.path) : '';
      if (!targetPath) throw new Error('path is required');
      if (action === 'create-file') {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, '', { flag: 'wx' });
      } else if (action === 'create-folder') {
        await mkdir(targetPath, { recursive: true });
      } else if (action === 'rename') {
        const nextPath = typeof body.targetPath === 'string' ? resolve(body.targetPath) : '';
        if (!nextPath) throw new Error('targetPath is required');
        await rename(targetPath, nextPath);
      } else if (action === 'delete') {
        await rm(targetPath, { recursive: true, force: true });
      } else {
        throw new Error(`Unsupported file action: ${action}`);
      }
      writeJson(res, 200, { ok: true });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/workspace/open' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const result = await runWorkspaceOpenAction({
        workspacePath: typeof body.workspacePath === 'string' ? resolve(body.workspacePath) : await readLastWorkspacePath(),
        action: typeof body.action === 'string' ? body.action : '',
        path: typeof body.path === 'string' ? body.path : '',
        dryRun: process.env.SCIFORGE_WORKSPACE_OPEN_DRY_RUN === '1',
      });
      writeJson(res, 200, { ok: true, ...result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (await handleScenarioLibraryRoutes(req, res, url)) return;
  if (url.pathname === '/api/sciforge/workspace/snapshot' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      if (!workspacePath) throw new Error('workspacePath is required');
      const state = isRecord(body.state) ? body.state : {};
      const config = isRecord(body.config) ? body.config : {};
      const root = normalizeWorkspaceRootPath(resolve(workspacePath));
      const sciforgeDir = join(root, '.sciforge');
      await mkdir(join(sciforgeDir, 'sessions'), { recursive: true });
      await mkdir(join(sciforgeDir, 'artifacts'), { recursive: true });
      await mkdir(join(sciforgeDir, 'versions'), { recursive: true });
      await writeFile(join(sciforgeDir, 'workspace-state.json'), JSON.stringify(state, null, 2));
      await writeFile(join(sciforgeDir, 'config.json'), JSON.stringify(redactConfigForFile(config), null, 2));
      await rememberWorkspace(root, state);

      const sessions = isRecord(state.sessionsByScenario)
        ? Object.values(state.sessionsByScenario)
        : [];
      for (const session of sessions as Array<Record<string, unknown>>) {
        const sessionId = safeName(String(session.sessionId || 'session'));
        await writeFile(join(sciforgeDir, 'sessions', `${sessionId}.json`), JSON.stringify(session, null, 2));
        const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
        for (const artifact of artifacts as Array<Record<string, unknown>>) {
          const artifactId = safeName(String(artifact.id || artifact.type || 'artifact'));
          await writeFile(join(sciforgeDir, 'artifacts', `${sessionId}-${artifactId}.json`), JSON.stringify(artifact, null, 2));
        }
        const versions = Array.isArray(session.versions) ? session.versions : [];
        for (const version of versions as Array<Record<string, unknown>>) {
          const versionId = safeName(String(version.id || 'version'));
          await writeFile(join(sciforgeDir, 'versions', `${sessionId}-${versionId}.json`), JSON.stringify(version, null, 2));
        }
      }
      const alignmentContracts = Array.isArray(state.alignmentContracts) ? state.alignmentContracts : [];
      for (const contract of alignmentContracts as Array<Record<string, unknown>>) {
        const contractId = safeName(String(contract.id || ALIGNMENT_CONTRACT_ARTIFACT_TYPE));
        await writeFile(join(sciforgeDir, 'artifacts', `${contractId}.json`), JSON.stringify(contract, null, 2));
        await writeFile(join(sciforgeDir, 'versions', `${contractId}.json`), JSON.stringify({
          id: contractId,
          type: ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE,
          createdAt: contract.updatedAt,
          reason: contract.reason,
          checksum: contract.checksum,
          artifactId: contract.id,
        }, null, 2));
      }
      writeJson(res, 200, { ok: true, workspacePath: root });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
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
    const controller = new AbortController();
    let completed = false;
    res.on('close', () => {
      if (!completed && !res.writableEnded) controller.abort();
    });
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    try {
      const body = await readJson(req);
      const result = await runSciForgeTool(body, {
        signal: controller.signal,
        onEvent(event) {
          writeStreamEnvelope(res, { event });
        },
      });
      writeStreamEnvelope(res, { result });
    } catch (err) {
      writeStreamEnvelope(res, { error: err instanceof Error ? err.message : String(err) });
    } finally {
      completed = true;
      res.end();
    }
    return;
  }
  writeJson(res, 404, { ok: false, error: 'not found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`SciForge workspace writer: http://127.0.0.1:${PORT}`);
});

function normalizeRepairHandoffContract(body: Record<string, unknown>) {
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
  return readLastWorkspacePath();
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
      'feedback-repair-run-record',
      'feedback-repair-result-record',
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
  const state = await readWorkspaceStateFile(root);
  const comment = findFeedbackComment(state, issueId);
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
    note: typeof body.note === 'string' ? body.note : undefined,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
  };
  const next = appendStateRecord(state, 'feedbackRepairRuns', run);
  await persistFeedbackRecord(root, 'repair-runs', run.id, run);
  await writeWorkspaceStateFile(root, next);
  return run;
}

async function recordFeedbackRepairResult(root: string, issueId: string, body: Record<string, unknown>) {
  const state = await readWorkspaceStateFile(root);
  const comment = findFeedbackComment(state, issueId);
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
  const saved = appendStateRecord(state, 'feedbackRepairResults', result);
  await persistFeedbackRecord(root, 'repair-results', result.id, result);
  await writeWorkspaceStateFile(root, saved);
  const githubSync = await syncRepairResultGithubComment(comment, result);
  const syncedResult = {
    ...result,
    githubSyncStatus: githubSync.status,
    githubSyncError: githubSync.error,
    githubSyncedAt: githubSync.syncedAt,
    githubCommentUrl: githubSync.commentUrl,
  };
  const next = appendStateRecord(saved, 'feedbackRepairResults', syncedResult);
  await persistFeedbackRecord(root, 'repair-results', syncedResult.id, syncedResult);
  await writeWorkspaceStateFile(root, next);
  return syncedResult;
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
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : undefined,
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

async function readLastWorkspacePath() {
  const best = await readBestRememberedWorkspace();
  if (best) return best;
  const marker = JSON.parse(await readFile(lastWorkspaceFile(), 'utf8'));
  if (!isRecord(marker) || typeof marker.workspacePath !== 'string' || !marker.workspacePath.trim()) {
    throw new Error('last workspace marker is invalid');
  }
  return normalizeWorkspaceRootPath(resolve(marker.workspacePath));
}

async function rememberWorkspace(workspacePath: string, state: Record<string, unknown>) {
  workspacePath = normalizeWorkspaceRootPath(workspacePath);
  await mkdir(STATE_DIR, { recursive: true });
  const score = workspaceActivityScore(state);
  const updatedAt = new Date().toISOString();
  const history = await readWorkspaceHistory();
  const nextHistory: Array<{ workspacePath: string; score: number; updatedAt: string }> = [
    { workspacePath, score, updatedAt },
    ...history.filter((item) => item.workspacePath !== workspacePath),
  ]
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20);
  const best = nextHistory[0];
  await writeFile(workspaceHistoryFile(), JSON.stringify({ workspaces: nextHistory }, null, 2));
  await writeFile(lastWorkspaceFile(), JSON.stringify({
    workspacePath: best.workspacePath,
    score: best.score,
    updatedAt: best.updatedAt,
  }, null, 2));
}

async function readBestRememberedWorkspace() {
  const history = await readWorkspaceHistory();
  return history[0]?.workspacePath ? normalizeWorkspaceRootPath(resolve(history[0].workspacePath)) : undefined;
}

async function readWorkspaceHistory(): Promise<Array<{ workspacePath: string; score: number; updatedAt: string }>> {
  const records: Array<{ workspacePath: string; score: number; updatedAt: string }> = [];
  try {
    const parsed = JSON.parse(await readFile(workspaceHistoryFile(), 'utf8'));
    if (isRecord(parsed) && Array.isArray(parsed.workspaces)) {
      for (const item of parsed.workspaces) {
        if (isRecord(item) && typeof item.workspacePath === 'string' && item.workspacePath.trim()) {
          records.push({
            workspacePath: normalizeWorkspaceRootPath(resolve(item.workspacePath)),
            score: typeof item.score === 'number' ? item.score : 0,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
          });
        }
      }
    }
  } catch {
    // No history file yet; fall back to the single marker below.
  }
  try {
    const marker = JSON.parse(await readFile(lastWorkspaceFile(), 'utf8'));
    if (isRecord(marker) && typeof marker.workspacePath === 'string' && marker.workspacePath.trim()) {
      records.push({
        workspacePath: normalizeWorkspaceRootPath(resolve(marker.workspacePath)),
        score: typeof marker.score === 'number' ? marker.score : 0,
        updatedAt: typeof marker.updatedAt === 'string' ? marker.updatedAt : '',
      });
    }
  } catch {
    // No marker.
  }
  return records
    .filter((item, index, all) => all.findIndex((candidate) => candidate.workspacePath === item.workspacePath) === index)
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
}

function workspaceActivityScore(state: Record<string, unknown>): number {
  const sessions = isRecord(state.sessionsByScenario) ? Object.values(state.sessionsByScenario) : [];
  const archived = Array.isArray(state.archivedSessions) ? state.archivedSessions.length : 0;
  const contracts = Array.isArray(state.alignmentContracts) ? state.alignmentContracts.length : 0;
  return sessions.reduce<number>((total, session) => {
    if (!isRecord(session)) return total;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const realMessages = messages.filter((message) => !isRecord(message) || !String(message.id || '').startsWith('seed')).length;
    const artifacts = Array.isArray(session.artifacts) ? session.artifacts.length : 0;
    const units = Array.isArray(session.executionUnits) ? session.executionUnits.length : 0;
    const notebook = Array.isArray(session.notebook) ? session.notebook.length : 0;
    return total + realMessages + artifacts + units + notebook;
  }, archived + contracts);
}

function lastWorkspaceFile() {
  return join(STATE_DIR, 'last-workspace.json');
}

function workspaceHistoryFile() {
  return join(STATE_DIR, 'workspace-history.json');
}

function redactConfigForFile(config: Record<string, unknown>) {
  return {
    ...config,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
  };
}

async function readLocalSciForgeConfig() {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
  const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
  const agentServerBaseUrl = process.env.SCIFORGE_AGENT_SERVER_URL
    || (typeof sciforge.agentServerBaseUrl === 'string' ? sciforge.agentServerBaseUrl : 'http://127.0.0.1:18080');
  const workspaceWriterBaseUrl = process.env.SCIFORGE_WORKSPACE_WRITER_URL
    || (typeof sciforge.workspaceWriterBaseUrl === 'string' ? sciforge.workspaceWriterBaseUrl : `http://127.0.0.1:${PORT}`);
  const workspacePath = process.env.SCIFORGE_WORKSPACE_PATH
    || (typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : DEFAULT_WORKSPACE_PATH);
  return {
    schemaVersion: 1,
    agentServerBaseUrl,
    workspaceWriterBaseUrl,
    workspacePath: normalizeWorkspaceRootPath(workspacePath),
    peerInstances: normalizePeerInstances(sciforge.peerInstances),
    modelProvider: typeof llm.provider === 'string' ? llm.provider : 'native',
    modelBaseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl.replace(/\/+$/, '') : '',
    modelName: typeof llm.model === 'string' ? llm.model : typeof llm.modelName === 'string' ? llm.modelName : '',
    apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
    requestTimeoutMs: typeof sciforge.requestTimeoutMs === 'number' ? sciforge.requestTimeoutMs : 900000,
    feedbackGithubRepo: typeof sciforge.feedbackGithubRepo === 'string' ? sciforge.feedbackGithubRepo : undefined,
    feedbackGithubToken: typeof sciforge.feedbackGithubToken === 'string' ? sciforge.feedbackGithubToken : undefined,
    visionAllowSharedSystemInput: typeof visionSense.allowSharedSystemInput === 'boolean' ? visionSense.allowSharedSystemInput : true,
    updatedAt: typeof sciforge.updatedAt === 'string' ? sciforge.updatedAt : new Date().toISOString(),
    source: 'config.local.json',
  };
}

async function writeLocalSciForgeConfig(config: Record<string, unknown>) {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const sciforge = isRecord(parsed.sciforge) ? parsed.sciforge : {};
  const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
  const next = {
    ...parsed,
    llm: {
      ...llm,
      provider: typeof config.modelProvider === 'string' ? config.modelProvider : llm.provider,
      baseUrl: preserveConfiguredSecretString(config.modelBaseUrl, llm.baseUrl).replace(/\/+$/, ''),
      apiKey: preserveConfiguredSecretString(config.apiKey, llm.apiKey),
      model: preserveConfiguredSecretString(config.modelName, llm.model),
    },
    sciforge: {
      ...sciforge,
      agentServerBaseUrl: typeof config.agentServerBaseUrl === 'string' ? config.agentServerBaseUrl : sciforge.agentServerBaseUrl,
      workspaceWriterBaseUrl: typeof config.workspaceWriterBaseUrl === 'string' ? config.workspaceWriterBaseUrl : sciforge.workspaceWriterBaseUrl,
      workspacePath: normalizeWorkspaceRootPath(typeof config.workspacePath === 'string' ? config.workspacePath : typeof sciforge.workspacePath === 'string' ? sciforge.workspacePath : ''),
      peerInstances: Array.isArray(config.peerInstances) ? normalizePeerInstances(config.peerInstances) : normalizePeerInstances(sciforge.peerInstances),
      requestTimeoutMs: typeof config.requestTimeoutMs === 'number' ? config.requestTimeoutMs : sciforge.requestTimeoutMs,
      feedbackGithubRepo: typeof config.feedbackGithubRepo === 'string' ? config.feedbackGithubRepo : sciforge.feedbackGithubRepo,
      feedbackGithubToken: preserveConfiguredSecretString(config.feedbackGithubToken, sciforge.feedbackGithubToken),
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
}

function preserveConfiguredSecretString(nextValue: unknown, currentValue: unknown) {
  const current = typeof currentValue === 'string' ? currentValue : '';
  if (typeof nextValue !== 'string') return current;
  const next = nextValue.trim();
  if (!next && current.trim()) return current;
  return nextValue;
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

function cleanUrlString(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}
