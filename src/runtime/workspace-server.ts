import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runSciForgeTool } from './sciforge-tools.js';
import { readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import { acceptSkillPromotionProposal, archiveSkillPromotionProposal, listSkillPromotionProposals, rejectSkillPromotionProposal, runAcceptedSkillValidationSmoke } from './skill-promotion.js';
import { syncRepairResultToGithubIssue } from './github-repair-sync.js';
import { runRepairHandoff } from './repair-handoff-runner.js';
import { buildStableVersionSyncPlan, promoteStableVersion, readStableVersion, stableVersionRegistryPath } from './stable-version-registry.js';
import { normalizeWorkspaceRootPath, resolveWorkspaceFilePreviewPath, resolveWorkspacePreviewRef } from './workspace-paths.js';

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
      const descriptor = await previewDescriptorForRef(ref, workspacePath, previewRequestBaseUrl(req));
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
      const workspacePath = normalizeWorkspaceRootPath(typeof body.workspacePath === 'string' ? resolve(body.workspacePath) : await readLastWorkspacePath());
      const action = typeof body.action === 'string' ? body.action : '';
      const targetPath = resolveWorkspaceOpenPath(workspacePath, typeof body.path === 'string' ? body.path : '');
      const info = await stat(targetPath);
      if (action !== 'open-external' && action !== 'reveal-in-folder' && action !== 'copy-path') {
        throw new Error(`Unsupported workspace open action: ${action}`);
      }
      if (action === 'open-external') assertCanOpenExternal(targetPath, info.isDirectory());
      const dryRun = process.env.SCIFORGE_WORKSPACE_OPEN_DRY_RUN === '1';
      if (!dryRun && action !== 'copy-path') {
        const args = action === 'reveal-in-folder'
          ? info.isDirectory() ? [targetPath] : ['-R', targetPath]
          : [targetPath];
        const child = spawn('open', args, { detached: true, stdio: 'ignore' });
        child.unref();
      }
      writeJson(res, 200, {
        ok: true,
        action,
        path: targetPath,
        workspacePath,
        dryRun,
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const scenariosDir = join(root, '.sciforge', 'scenarios');
      const entries = await readdir(scenariosDir, { withFileTypes: true }).catch(() => []);
      const scenarios = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        try {
          const pkg = await readScenarioPackageFromDir(join(scenariosDir, entry.name));
          scenarios.push(scenarioListItem(pkg));
        } catch {
          // Skip malformed scenario packages in list view; direct get reports the error.
        }
      }
      writeJson(res, 200, { ok: true, workspacePath: root, scenarios });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/library' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const scenariosDir = join(root, '.sciforge', 'scenarios');
      const entries = await readdir(scenariosDir, { withFileTypes: true }).catch(() => []);
      const packages = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        try {
          packages.push(await readScenarioPackageFromDir(join(scenariosDir, entry.name)));
        } catch {
          // Skip malformed packages in the library rollup.
        }
      }
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        library: buildWorkspaceScenarioLibrary(packages),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/get' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const id = url.searchParams.get('id')?.trim() || '';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.sciforge', 'scenarios', safeName(id)));
      writeJson(res, 200, { ok: true, workspacePath: root, package: pkg });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, message.includes('ENOENT') ? 404 : 400, { ok: false, error: message });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/save' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const pkg = isRecord(body.package) ? body.package : undefined;
      if (!pkg) throw new Error('package is required');
      await writeScenarioPackage(root, pkg, statusFromPackage(pkg) || 'draft');
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem(pkg) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/publish' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const pkg = isRecord(body.package)
        ? body.package
        : await readScenarioPackageFromDir(join(root, '.sciforge', 'scenarios', safeName(String(body.id || ''))));
      const blockingReason = scenarioPublishBlockingReason(pkg);
      if (blockingReason) throw new Error(blockingReason);
      await writeScenarioPackage(root, pkg, 'published');
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status: 'published' }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/archive' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.sciforge', 'scenarios', safeName(id)));
      await writeScenarioPackage(root, pkg, 'archived');
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status: 'archived' }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/restore' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const status = typeof body.status === 'string' && ['draft', 'validated', 'published'].includes(body.status) ? body.status : 'draft';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.sciforge', 'scenarios', safeName(id)));
      await writeScenarioPackage(root, pkg, status);
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/scenarios/delete' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) throw new Error('id is required');
      await rm(join(root, '.sciforge', 'scenarios', safeName(id)), { recursive: true, force: true });
      writeJson(res, 200, { ok: true, workspacePath: root, id });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/task-attempts/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const skillDomain = url.searchParams.get('skillDomain')?.trim() || undefined;
      const scenarioPackageId = url.searchParams.get('scenarioPackageId')?.trim() || undefined;
      const limit = Number(url.searchParams.get('limit') || 20);
      const attempts = await readRecentTaskAttempts(root, skillDomain, Number.isFinite(limit) ? limit : 20);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        attempts: scenarioPackageId
          ? attempts.filter((attempt) => isRecord(attempt.scenarioPackageRef) && attempt.scenarioPackageRef.id === scenarioPackageId)
          : attempts,
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/task-attempts/get' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const id = url.searchParams.get('id')?.trim() || '';
      if (!id) throw new Error('id is required');
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        id,
        attempts: await readTaskAttempts(root, id),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/skill-proposals/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        proposals: await listSkillPromotionProposals(root),
        isolation: {
          proposals: '.sciforge/skill-proposals',
          acceptedEvolvedSkills: '.sciforge/evolved-skills',
          stableSkillRoots: ['packages/skills', '.sciforge/evolved-skills'],
        },
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/skill-proposals/accept' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) throw new Error('id is required');
      const manifest = await acceptSkillPromotionProposal(root, id);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        manifest,
        installedRoot: '.sciforge/evolved-skills',
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/skill-proposals/validate' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : '';
      if (!skillId) throw new Error('skillId is required');
      const validation = await runAcceptedSkillValidationSmoke(root, skillId);
      writeJson(res, validation.passed ? 200 : 400, {
        ok: validation.passed,
        workspacePath: root,
        validation,
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/skill-proposals/reject' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      if (!id) throw new Error('id is required');
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        proposal: await rejectSkillPromotionProposal(root, id, reason),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/sciforge/skill-proposals/archive' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      if (!id) throw new Error('id is required');
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        proposal: await archiveSkillPromotionProposal(root, id, reason),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
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
        const contractId = safeName(String(contract.id || 'alignment-contract'));
        await writeFile(join(sciforgeDir, 'artifacts', `${contractId}.json`), JSON.stringify(contract, null, 2));
        await writeFile(join(sciforgeDir, 'versions', `${contractId}.json`), JSON.stringify({
          id: contractId,
          type: 'alignment-contract-version',
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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function writeStreamEnvelope(res: ServerResponse, body: unknown) {
  res.write(`${JSON.stringify(body)}\n`);
}

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
      'artifact-preview',
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

function safeName(value: string) {
  return basename(value.replace(/[^a-zA-Z0-9._-]+/g, '_')).slice(0, 120);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function languageForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp' || ext === '.svg') return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.r') return 'r';
  if (ext === '.csv' || ext === '.tsv') return 'table';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.sh') return 'shell';
  if (ext === '.doc' || ext === '.docx') return 'document';
  if (ext === '.xls' || ext === '.xlsx') return 'spreadsheet';
  if (ext === '.ppt' || ext === '.pptx') return 'presentation';
  return 'text';
}

function isBinaryPreviewFile(path: string) {
  return [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
  ].includes(extname(path).toLowerCase());
}

function previewRequestBaseUrl(req: IncomingMessage) {
  return `http://${req.headers.host || `127.0.0.1:${PORT}`}`;
}

async function previewDescriptorForRef(rawRef: string, workspacePath: string, baseUrl: string) {
  const filePath = resolveWorkspacePreviewRef(rawRef, workspacePath);
  const info = await stat(filePath);
  const kind = previewKindForPath(filePath, info.isDirectory());
  const mimeType = info.isDirectory() ? 'inode/directory' : mimeTypeForPath(filePath);
  const hash = info.isFile() ? await fileHash(filePath, info.size) : undefined;
  const rawUrl = new URL(`${baseUrl}/api/sciforge/preview/raw`);
  rawUrl.searchParams.set('ref', filePath);
  if (workspacePath.trim()) rawUrl.searchParams.set('workspacePath', workspacePath.trim());
  return {
    kind,
    source: rawRef.startsWith('artifact:') ? 'artifact' : rawRef.startsWith('dataRef:') ? 'dataRef' : 'path',
    ref: filePath,
    mimeType,
    sizeBytes: info.size,
    hash,
    title: basename(filePath),
    rawUrl: info.isFile() ? rawUrl.toString() : undefined,
    inlinePolicy: inlinePolicyForPreview(kind, info.size),
    derivatives: derivativeDescriptorsForPreview(filePath, kind, info.size),
    actions: previewActionsForKind(kind),
    locatorHints: locatorHintsForKind(kind),
    diagnostics: info.isFile() && info.size > 25 * 1024 * 1024 && (kind === 'pdf' || kind === 'image')
      ? ['Large file uses streaming preview; derived text/thumb/page indexes are generated only on demand.']
      : [],
  };
}

async function previewDerivativeForRef(rawRef: string, workspacePath: string, kind: string) {
  const filePath = resolveWorkspacePreviewRef(rawRef, workspacePath);
  const info = await stat(filePath);
  const previewKind = previewKindForPath(filePath, info.isDirectory());
  const cacheDir = join(workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : dirname(filePath), '.sciforge', 'preview-cache');
  await mkdir(cacheDir, { recursive: true });
  const cacheKey = createHash('sha256').update(JSON.stringify({ filePath, mtime: info.mtimeMs, size: info.size, kind })).digest('hex').slice(0, 24);
  const outPath = join(cacheDir, `${cacheKey}.${derivativeExtension(kind, previewKind, filePath)}`);
  const existing = await stat(outPath).catch(() => undefined);
  if (existing?.isFile()) return derivativeRecord(kind, outPath, existing.size, 'available', derivativeMimeType(kind, previewKind, filePath));
  if (kind === 'metadata') {
    await writeFile(outPath, JSON.stringify({ path: filePath, name: basename(filePath), previewKind, mimeType: mimeTypeForPath(filePath), sizeBytes: info.size, modifiedAt: info.mtime.toISOString() }, null, 2), 'utf8');
  } else if (kind === 'schema') {
    await writeFile(outPath, JSON.stringify(await schemaPreviewForFile(filePath, previewKind), null, 2), 'utf8');
  } else if (kind === 'pages') {
    await writeFile(outPath, JSON.stringify({ pageCount: undefined, pages: [], status: 'lazy', note: 'Page index generation requires a PDF parser; raw streaming remains available.' }, null, 2), 'utf8');
  } else if (kind === 'text') {
    await writeFile(outPath, await textPreviewForFile(filePath, previewKind), 'utf8');
  } else if (kind === 'thumb') {
    if (previewKind === 'image') {
      await writeFile(outPath, await readFile(filePath));
    } else {
      await writeFile(outPath, svgThumbnailPlaceholder(filePath, previewKind), 'utf8');
    }
  } else if (kind === 'html') {
    await writeFile(outPath, await htmlPreviewForFile(filePath, previewKind), 'utf8');
  } else if (kind === 'structure-bundle') {
    await writeFile(outPath, JSON.stringify(await structureBundleForFile(filePath, previewKind), null, 2), 'utf8');
  } else {
    throw new Error(`Unsupported derivative kind: ${kind}`);
  }
  const generated = await stat(outPath);
  return derivativeRecord(kind, outPath, generated.size, 'available', derivativeMimeType(kind, previewKind, filePath));
}

function derivativeRecord(kind: string, path: string, sizeBytes: number, status: string, mimeType?: string) {
  return {
    kind,
    ref: path,
    mimeType: mimeType || (kind === 'schema' || kind === 'pages' || kind === 'metadata' ? 'application/json' : 'text/plain'),
    sizeBytes,
    generatedAt: new Date().toISOString(),
    status,
  };
}

function derivativeExtension(kind: string, previewKind: string, path: string) {
  if (kind === 'thumb' && previewKind === 'image') {
    const ext = extname(path).toLowerCase().replace(/^\./, '');
    return ext || 'bin';
  }
  if (kind === 'thumb') return 'svg';
  if (kind === 'html') return 'html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === 'structure-bundle') return 'json';
  return 'txt';
}

function derivativeMimeType(kind: string, previewKind: string, path: string) {
  if (kind === 'thumb' && previewKind === 'image') return mimeTypeForPath(path);
  if (kind === 'thumb') return 'image/svg+xml';
  if (kind === 'html') return 'text/html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === 'structure-bundle') return 'application/json';
  return 'text/plain';
}

async function textPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'text' || previewKind === 'markdown' || previewKind === 'html' || previewKind === 'json' || previewKind === 'table') {
    return (await readFile(path, 'utf8')).slice(0, 200_000);
  }
  return `Text extraction is not available for ${previewKind} without an optional parser. Use rawUrl/system-open or request a task-specific extractor.`;
}

async function schemaPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'json') {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return summarizeJsonSchema(parsed);
  }
  if (previewKind === 'table') {
    const text = await readFile(path, 'utf8');
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 25).map((line) => line.split(extname(path).toLowerCase() === '.tsv' ? '\t' : ','));
    return { rowsPreviewed: rows.length, columns: rows[0]?.map((name, index) => ({ index, name: name || `column_${index + 1}` })) ?? [] };
  }
  return { previewKind, status: 'metadata-only' };
}

async function htmlPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'html') return (await readFile(path, 'utf8')).slice(0, 200_000);
  const text = escapeHtml(await textPreviewForFile(path, previewKind));
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(basename(path))}</title><pre>${text}</pre>`;
}

async function structureBundleForFile(path: string, previewKind: string) {
  const text = previewKind === 'structure' ? (await readFile(path, 'utf8')).slice(0, 200_000) : '';
  const chains = Array.from(new Set(Array.from(text.matchAll(/^(?:ATOM|HETATM).{17}(.).*/gm)).map((match) => match[1].trim()).filter(Boolean)));
  return {
    path,
    name: basename(path),
    previewKind,
    format: extname(path).replace(/^\./, ''),
    chains,
    rawRef: path,
    status: previewKind === 'structure' ? 'metadata-only-bundle' : 'unsupported',
  };
}

function svgThumbnailPlaceholder(path: string, previewKind: string) {
  const label = escapeHtml(`${previewKind.toUpperCase()} preview`);
  const name = escapeHtml(basename(path));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f5f7fb"/><rect x="18" y="18" width="284" height="144" rx="8" fill="#fff" stroke="#c9d3e1"/><text x="32" y="82" font-family="system-ui, sans-serif" font-size="18" fill="#25324a">${label}</text><text x="32" y="112" font-family="system-ui, sans-serif" font-size="12" fill="#667085">${name}</text></svg>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function summarizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', count: value.length, item: summarizeJsonSchema(value[0]) };
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => ({
        key,
        schema: Array.isArray(item) ? { type: 'array', count: item.length } : item === null ? { type: 'null' } : { type: typeof item },
      })),
    };
  }
  return { type: value === null ? 'null' : typeof value };
}

function previewKindForPath(path: string, isDirectory = false) {
  if (isDirectory) return 'folder';
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.md', '.markdown'].includes(ext)) return 'markdown';
  if (['.json', '.jsonl'].includes(ext)) return 'json';
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(ext)) return 'table';
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.pdb', '.cif', '.mmcif'].includes(ext)) return 'structure';
  if (['.doc', '.docx', '.ppt', '.pptx'].includes(ext)) return 'office';
  if (['.txt', '.log', '.ts', '.tsx', '.js', '.jsx', '.py', '.r', '.sh', '.css'].includes(ext)) return 'text';
  return 'binary';
}

function inlinePolicyForPreview(kind: string, size: number) {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return size <= 1024 * 1024 ? 'inline' : 'extract';
  if (kind === 'folder') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return 'unsupported';
}

function derivativeDescriptorsForPreview(path: string, kind: string, size: number) {
  const lazy = (derivativeKind: string, mimeType: string) => ({ kind: derivativeKind, ref: `${path}#${derivativeKind}`, mimeType, status: 'lazy' });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', mimeTypeForPath(path))];
  if (kind === 'json') return [lazy('schema', 'application/json'), ...(size > 1024 * 1024 ? [lazy('text', 'text/plain')] : [])];
  if (kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'markdown' || kind === 'text' || kind === 'html') return size > 1024 * 1024 ? [lazy('text', 'text/plain')] : [];
  if (kind === 'structure') return [lazy('metadata', 'application/json'), lazy('structure-bundle', 'application/json')];
  if (kind === 'office' || kind === 'folder' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

function previewActionsForKind(kind: string) {
  const common = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

function locatorHintsForKind(kind: string) {
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
}

async function fileHash(path: string, size: number) {
  const hash = createHash('sha256');
  if (size <= 8 * 1024 * 1024) {
    hash.update(await readFile(path));
  } else {
    hash.update(`${path}:${size}`);
  }
  return `sha256:${hash.digest('hex')}`;
}

function streamWorkspacePreviewFile(req: IncomingMessage, res: ServerResponse, path: string, size: number) {
  const range = req.headers.range;
  const mimeType = mimeTypeForPath(path);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('ETag', `"${createHash('sha256').update(`${path}:${size}`).digest('hex')}"`);
  if (!range) {
    res.writeHead(200, { 'Content-Length': size });
    createReadStream(path).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
  });
  createReadStream(path, { start, end }).pipe(res);
}

function mimeTypeForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.tsv') return 'text/tab-separated-values';
  if (ext === '.html') return 'text/html';
  return 'text/plain';
}

function scenarioWorkspaceRoot(url: URL) {
  const workspacePath = url.searchParams.get('workspacePath')?.trim() || url.searchParams.get('path')?.trim() || '';
  if (!workspacePath) throw new Error('workspacePath is required');
  return resolve(workspacePath);
}

function scenarioWorkspaceRootFromBody(body: Record<string, unknown>) {
  const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
  if (!workspacePath) throw new Error('workspacePath is required');
  return resolve(workspacePath);
}

async function writeScenarioPackage(root: string, pkg: Record<string, unknown>, status: string) {
  const id = typeof pkg.id === 'string' && pkg.id.trim() ? pkg.id : isRecord(pkg.scenario) && typeof pkg.scenario.id === 'string' ? pkg.scenario.id : '';
  if (!id) throw new Error('package.id is required');
  const version = typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version : '1.0.0';
  const scenarioDir = join(root, '.sciforge', 'scenarios', safeName(id));
  await mkdir(scenarioDir, { recursive: true });
  const nextPackage: Record<string, unknown> = { ...pkg, id, version, status };
  const scenario = isRecord(nextPackage.scenario) ? { ...nextPackage.scenario } : {};
  const skillPlan = isRecord(nextPackage.skillPlan) ? nextPackage.skillPlan : {};
  const uiPlan = isRecord(nextPackage.uiPlan) ? nextPackage.uiPlan : {};
  const validationReport = isRecord(nextPackage.validationReport) ? nextPackage.validationReport : undefined;
  const qualityReport = isRecord(nextPackage.qualityReport) ? nextPackage.qualityReport : undefined;
  const tests = Array.isArray(nextPackage.tests) ? nextPackage.tests : [];
  const versions = Array.isArray(nextPackage.versions) ? nextPackage.versions : [];
  await writeFile(join(scenarioDir, 'scenario.json'), JSON.stringify({ ...scenario, id, version, status }, null, 2));
  await writeFile(join(scenarioDir, 'skill-plan.json'), JSON.stringify(skillPlan, null, 2));
  await writeFile(join(scenarioDir, 'ui-plan.json'), JSON.stringify(uiPlan, null, 2));
  if (validationReport) {
    await writeFile(join(scenarioDir, 'validation-report.json'), JSON.stringify(validationReport, null, 2));
  }
  if (qualityReport) {
    await writeFile(join(scenarioDir, 'quality-report.json'), JSON.stringify(qualityReport, null, 2));
  }
  await writeFile(join(scenarioDir, 'tests.json'), JSON.stringify({ tests }, null, 2));
  await writeFile(join(scenarioDir, 'versions.json'), JSON.stringify({
    versions: mergeScenarioVersions(versions, version, status),
  }, null, 2));
  await writeFile(join(scenarioDir, 'package.json'), JSON.stringify(nextPackage, null, 2));
}

async function readScenarioPackageFromDir(dir: string): Promise<Record<string, unknown>> {
  try {
    const direct = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    if (isRecord(direct)) return direct;
  } catch {
    // Fall through to split package reconstruction.
  }
  const scenario = JSON.parse(await readFile(join(dir, 'scenario.json'), 'utf8'));
  const skillPlan = JSON.parse(await readFile(join(dir, 'skill-plan.json'), 'utf8'));
  const uiPlan = JSON.parse(await readFile(join(dir, 'ui-plan.json'), 'utf8'));
  const validationReport = await readOptionalJson(join(dir, 'validation-report.json'));
  const qualityReport = await readOptionalJson(join(dir, 'quality-report.json'));
  const testsFile = JSON.parse(await readFile(join(dir, 'tests.json'), 'utf8'));
  const versionsFile = JSON.parse(await readFile(join(dir, 'versions.json'), 'utf8'));
  if (!isRecord(scenario)) throw new Error('scenario.json is invalid');
  return {
    schemaVersion: '1',
    id: String(scenario.id || basename(dir)),
    version: typeof scenario.version === 'string' ? scenario.version : '1.0.0',
    status: typeof scenario.status === 'string' ? scenario.status : 'draft',
    scenario,
    skillPlan,
    uiPlan,
    validationReport,
    qualityReport,
    tests: isRecord(testsFile) && Array.isArray(testsFile.tests) ? testsFile.tests : [],
    versions: isRecord(versionsFile) && Array.isArray(versionsFile.versions) ? versionsFile.versions : [],
  };
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function scenarioPublishBlockingReason(pkg: Record<string, unknown>) {
  const qualityReport = isRecord(pkg.qualityReport) ? pkg.qualityReport : undefined;
  const qualityItems = qualityReport && Array.isArray(qualityReport.items) ? qualityReport.items : [];
  const blocking = qualityItems.find((item) => isRecord(item) && item.severity === 'blocking');
  if (blocking) return `Scenario quality gate blocks publish: ${String(blocking.code || blocking.message || 'blocking issue')}`;
  if (qualityReport && qualityReport.ok === false) return 'Scenario quality gate blocks publish.';
  const validationReport = isRecord(pkg.validationReport) ? pkg.validationReport : undefined;
  if (validationReport && validationReport.ok === false) return 'Scenario validation blocks publish.';
  return '';
}

function scenarioListItem(pkg: Record<string, unknown>) {
  const scenario = isRecord(pkg.scenario) ? pkg.scenario : {};
  return {
    id: typeof pkg.id === 'string' ? pkg.id : String(scenario.id || ''),
    version: typeof pkg.version === 'string' ? pkg.version : '1.0.0',
    status: typeof pkg.status === 'string' ? pkg.status : statusFromPackage(pkg) || 'draft',
    title: typeof scenario.title === 'string' ? scenario.title : typeof pkg.id === 'string' ? pkg.id : 'Untitled scenario',
    description: typeof scenario.description === 'string' ? scenario.description : '',
    skillDomain: typeof scenario.skillDomain === 'string' ? scenario.skillDomain : '',
  };
}

function buildWorkspaceScenarioLibrary(packages: Array<Record<string, unknown>>) {
  const items = packages.map((pkg) => {
    const item = scenarioListItem(pkg);
    const scenario = isRecord(pkg.scenario) ? pkg.scenario : {};
    const source = item.status === 'archived'
      ? 'archived'
      : scenario.source === 'built-in'
        ? 'built-in'
        : 'workspace';
    return {
      ...item,
      source,
      packageRef: {
        id: item.id,
        version: item.version,
        source: source === 'built-in' ? 'built-in' : 'workspace',
      },
      validationReport: isRecord(pkg.validationReport) ? pkg.validationReport : undefined,
      qualityReport: isRecord(pkg.qualityReport) ? pkg.qualityReport : undefined,
      versions: Array.isArray(pkg.versions) ? pkg.versions : [],
    };
  });
  const viewPresetCandidates = packages.flatMap((pkg) => {
    const item = scenarioListItem(pkg);
    const uiPlan = isRecord(pkg.uiPlan) ? pkg.uiPlan : {};
    const compiledFrom = isRecord(uiPlan.compiledFrom) ? uiPlan.compiledFrom : {};
    const slots = Array.isArray(uiPlan.slots) ? uiPlan.slots : [];
    if (!slots.length) return [];
    return [{
      id: `view-candidate.${item.id}.${item.version}`,
      scenarioPackageRef: {
        id: item.id,
        version: item.version,
        source: isRecord(pkg.scenario) && pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
      },
      uiPlanRef: typeof uiPlan.id === 'string' ? uiPlan.id : undefined,
      artifactTypes: Array.isArray(compiledFrom.artifactTypes) ? compiledFrom.artifactTypes : [],
      componentIds: Array.isArray(compiledFrom.componentIds) ? compiledFrom.componentIds : [],
      usageCount: 1,
      promotionState: 'candidate',
    }];
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    items,
    reusableTaskCandidates: [],
    viewPresetCandidates,
  };
}

function statusFromPackage(pkg: Record<string, unknown>) {
  return typeof pkg.status === 'string' && pkg.status.trim() ? pkg.status : undefined;
}

function mergeScenarioVersions(versions: unknown[], version: string, status: string) {
  const current = new Date().toISOString();
  const next = {
    version,
    status,
    createdAt: current,
    summary: `Scenario package ${status}`,
    scenarioHash: '',
  };
  return [
    next,
    ...versions.filter((item) => !isRecord(item) || item.version !== version || item.status !== status),
  ];
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

function resolveWorkspaceOpenPath(workspacePath: string, rawPath: string) {
  const root = normalizeWorkspaceRootPath(resolve(workspacePath));
  if (!root) throw new Error('workspacePath is required');
  if (!rawPath.trim()) throw new Error('path is required');
  const stripped = rawPath.trim().replace(/^(file|folder):/i, '');
  const targetPath = isAbsolute(stripped) ? resolve(stripped) : resolve(root, stripped);
  const rel = relative(root, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (!isAllowedGeneratedPreviewPath(targetPath)) {
      throw new Error('Workspace Open Gateway refused a path outside the active workspace.');
    }
  }
  return targetPath;
}

function isAllowedGeneratedPreviewPath(targetPath: string) {
  if (!isBinaryPreviewFile(targetPath)) return false;
  const tempRoots = Array.from(new Set([
    resolve('/tmp'),
    resolve('/private/tmp'),
    resolve(tmpdir()),
    resolve('/var/folders'),
    resolve('/private/var/folders'),
  ]));
  return tempRoots.some((root) => {
    const rel = relative(root, targetPath);
    return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  });
}

function assertCanOpenExternal(targetPath: string, isDirectory: boolean) {
  if (isDirectory) return;
  const extension = extname(targetPath).toLowerCase();
  const blocked = new Set([
    '.app',
    '.bat',
    '.cmd',
    '.com',
    '.dmg',
    '.exe',
    '.pkg',
    '.ps1',
    '.scr',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.command',
    '.scpt',
    '.workflow',
    '.docm',
    '.xlsm',
    '.pptm',
    '.jar',
  ]);
  if (blocked.has(extension)) {
    throw new Error(`Workspace Open Gateway blocked high-risk file type: ${extension}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
