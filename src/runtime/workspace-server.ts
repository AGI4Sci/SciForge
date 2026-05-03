import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runBioAgentTool } from './bioagent-tools.js';
import { readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import { acceptSkillPromotionProposal, archiveSkillPromotionProposal, listSkillPromotionProposals, rejectSkillPromotionProposal, runAcceptedSkillValidationSmoke } from './skill-promotion.js';

const PORT = Number(process.env.BIOAGENT_WORKSPACE_PORT || 5174);

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
    writeJson(res, 200, { ok: true, service: 'bioagent-workspace-writer' });
    return;
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/bioagent/config' && req.method === 'GET') {
    try {
      writeJson(res, 200, { ok: true, config: await readLocalBioAgentConfig() });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/config' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const config = isRecord(body.config) ? body.config : {};
      await writeLocalBioAgentConfig(config);
      writeJson(res, 200, { ok: true, config: await readLocalBioAgentConfig() });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/workspace/list' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/workspace/file' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/preview/raw' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/preview/descriptor' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/preview/derivative' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/workspace/file' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/workspace/snapshot' && req.method === 'GET') {
    try {
      const requestedPath = url.searchParams.get('path')?.trim() || '';
      const root = requestedPath ? resolve(requestedPath) : await readLastWorkspacePath();
      const state = JSON.parse(await readFile(join(root, '.bioagent', 'workspace-state.json'), 'utf8'));
      writeJson(res, 200, { ok: true, workspacePath: root, state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('ENOENT') ? 404 : 400;
      writeJson(res, status, { ok: false, error: message });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/workspace/file-action' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/workspace/open' && req.method === 'POST') {
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
      const dryRun = process.env.BIOAGENT_WORKSPACE_OPEN_DRY_RUN === '1';
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
  if (url.pathname === '/api/bioagent/scenarios/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const scenariosDir = join(root, '.bioagent', 'scenarios');
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
  if (url.pathname === '/api/bioagent/scenarios/library' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const scenariosDir = join(root, '.bioagent', 'scenarios');
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
  if (url.pathname === '/api/bioagent/scenarios/get' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const id = url.searchParams.get('id')?.trim() || '';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.bioagent', 'scenarios', safeName(id)));
      writeJson(res, 200, { ok: true, workspacePath: root, package: pkg });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, message.includes('ENOENT') ? 404 : 400, { ok: false, error: message });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/scenarios/save' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/scenarios/publish' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const pkg = isRecord(body.package)
        ? body.package
        : await readScenarioPackageFromDir(join(root, '.bioagent', 'scenarios', safeName(String(body.id || ''))));
      const blockingReason = scenarioPublishBlockingReason(pkg);
      if (blockingReason) throw new Error(blockingReason);
      await writeScenarioPackage(root, pkg, 'published');
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status: 'published' }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/scenarios/archive' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.bioagent', 'scenarios', safeName(id)));
      await writeScenarioPackage(root, pkg, 'archived');
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status: 'archived' }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/scenarios/restore' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const status = typeof body.status === 'string' && ['draft', 'validated', 'published'].includes(body.status) ? body.status : 'draft';
      if (!id) throw new Error('id is required');
      const pkg = await readScenarioPackageFromDir(join(root, '.bioagent', 'scenarios', safeName(id)));
      await writeScenarioPackage(root, pkg, status);
      writeJson(res, 200, { ok: true, workspacePath: root, scenario: scenarioListItem({ ...pkg, status }) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/scenarios/delete' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = scenarioWorkspaceRootFromBody(body);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) throw new Error('id is required');
      await rm(join(root, '.bioagent', 'scenarios', safeName(id)), { recursive: true, force: true });
      writeJson(res, 200, { ok: true, workspacePath: root, id });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/task-attempts/list' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/task-attempts/get' && req.method === 'GET') {
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
  if (url.pathname === '/api/bioagent/skill-proposals/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        proposals: await listSkillPromotionProposals(root),
        isolation: {
          proposals: '.bioagent/skill-proposals',
          acceptedEvolvedSkills: '.bioagent/evolved-skills',
          stableSkillRoots: ['packages/skills', '.bioagent/evolved-skills'],
        },
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/skill-proposals/accept' && req.method === 'POST') {
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
        installedRoot: '.bioagent/evolved-skills',
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/skill-proposals/validate' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/skill-proposals/reject' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/skill-proposals/archive' && req.method === 'POST') {
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
  if (url.pathname === '/api/bioagent/workspace/snapshot' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      if (!workspacePath) throw new Error('workspacePath is required');
      const state = isRecord(body.state) ? body.state : {};
      const config = isRecord(body.config) ? body.config : {};
      const root = normalizeWorkspaceRootPath(resolve(workspacePath));
      const bioagentDir = join(root, '.bioagent');
      await mkdir(join(bioagentDir, 'sessions'), { recursive: true });
      await mkdir(join(bioagentDir, 'artifacts'), { recursive: true });
      await mkdir(join(bioagentDir, 'versions'), { recursive: true });
      await writeFile(join(bioagentDir, 'workspace-state.json'), JSON.stringify(state, null, 2));
      await writeFile(join(bioagentDir, 'config.json'), JSON.stringify(redactConfigForFile(config), null, 2));
      await rememberWorkspace(root, state);

      const sessions = isRecord(state.sessionsByScenario)
        ? Object.values(state.sessionsByScenario)
        : [];
      for (const session of sessions as Array<Record<string, unknown>>) {
        const sessionId = safeName(String(session.sessionId || 'session'));
        await writeFile(join(bioagentDir, 'sessions', `${sessionId}.json`), JSON.stringify(session, null, 2));
        const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
        for (const artifact of artifacts as Array<Record<string, unknown>>) {
          const artifactId = safeName(String(artifact.id || artifact.type || 'artifact'));
          await writeFile(join(bioagentDir, 'artifacts', `${sessionId}-${artifactId}.json`), JSON.stringify(artifact, null, 2));
        }
        const versions = Array.isArray(session.versions) ? session.versions : [];
        for (const version of versions as Array<Record<string, unknown>>) {
          const versionId = safeName(String(version.id || 'version'));
          await writeFile(join(bioagentDir, 'versions', `${sessionId}-${versionId}.json`), JSON.stringify(version, null, 2));
        }
      }
      const alignmentContracts = Array.isArray(state.alignmentContracts) ? state.alignmentContracts : [];
      for (const contract of alignmentContracts as Array<Record<string, unknown>>) {
        const contractId = safeName(String(contract.id || 'alignment-contract'));
        await writeFile(join(bioagentDir, 'artifacts', `${contractId}.json`), JSON.stringify(contract, null, 2));
        await writeFile(join(bioagentDir, 'versions', `${contractId}.json`), JSON.stringify({
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
  if (url.pathname === '/api/bioagent/tools/run' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const result = await runBioAgentTool(body);
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (url.pathname === '/api/bioagent/tools/run/stream' && req.method === 'POST') {
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
      const result = await runBioAgentTool(body, {
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
  console.log(`BioAgent workspace writer: http://127.0.0.1:${PORT}`);
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

function safeName(value: string) {
  return basename(value.replace(/[^a-zA-Z0-9._-]+/g, '_')).slice(0, 120);
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

function resolveWorkspacePreviewRef(ref: string, workspacePath = '') {
  return resolveWorkspaceFilePreviewPath(ref.replace(/^(file|path|artifact):/i, ''), workspacePath);
}

async function previewDescriptorForRef(rawRef: string, workspacePath: string, baseUrl: string) {
  const filePath = resolveWorkspacePreviewRef(rawRef, workspacePath);
  const info = await stat(filePath);
  const kind = previewKindForPath(filePath, info.isDirectory());
  const mimeType = info.isDirectory() ? 'inode/directory' : mimeTypeForPath(filePath);
  const hash = info.isFile() ? await fileHash(filePath, info.size) : undefined;
  const rawUrl = new URL(`${baseUrl}/api/bioagent/preview/raw`);
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
  const cacheDir = join(workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : dirname(filePath), '.bioagent', 'preview-cache');
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

function resolveWorkspaceFilePreviewPath(rawPath: string, workspacePath = '') {
  const stripped = rawPath.trim().replace(/^(file|folder):/i, '');
  if (!stripped) throw new Error('path is required');
  const workspaceRoot = workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : '';
  if (!workspaceRoot || isAbsolute(stripped)) return resolve(stripped);
  const targetPath = resolve(workspaceRoot, stripped);
  const rel = relative(workspaceRoot, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Workspace File Gateway refused a path outside the active workspace.');
  }
  return targetPath;
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
  const scenarioDir = join(root, '.bioagent', 'scenarios', safeName(id));
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
  const appBioagentDir = join(process.cwd(), '.bioagent');
  await mkdir(appBioagentDir, { recursive: true });
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
  return join(process.cwd(), '.bioagent', 'last-workspace.json');
}

function workspaceHistoryFile() {
  return join(process.cwd(), '.bioagent', 'workspace-history.json');
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

async function readLocalBioAgentConfig() {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const bioagent = isRecord(parsed.bioagent) ? parsed.bioagent : {};
  return {
    schemaVersion: 1,
    agentServerBaseUrl: typeof bioagent.agentServerBaseUrl === 'string' ? bioagent.agentServerBaseUrl : 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: typeof bioagent.workspaceWriterBaseUrl === 'string' ? bioagent.workspaceWriterBaseUrl : `http://127.0.0.1:${PORT}`,
    workspacePath: normalizeWorkspaceRootPath(typeof bioagent.workspacePath === 'string' ? bioagent.workspacePath : join(process.cwd(), 'workspace')),
    modelProvider: typeof llm.provider === 'string' ? llm.provider : 'native',
    modelBaseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl.replace(/\/+$/, '') : '',
    modelName: typeof llm.model === 'string' ? llm.model : typeof llm.modelName === 'string' ? llm.modelName : '',
    apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
    requestTimeoutMs: typeof bioagent.requestTimeoutMs === 'number' ? bioagent.requestTimeoutMs : 900000,
    updatedAt: typeof bioagent.updatedAt === 'string' ? bioagent.updatedAt : new Date().toISOString(),
    source: 'config.local.json',
  };
}

async function writeLocalBioAgentConfig(config: Record<string, unknown>) {
  const parsed = await readConfigLocalJson();
  const llm = isRecord(parsed.llm) ? parsed.llm : {};
  const bioagent = isRecord(parsed.bioagent) ? parsed.bioagent : {};
  const next = {
    ...parsed,
    llm: {
      ...llm,
      provider: typeof config.modelProvider === 'string' ? config.modelProvider : llm.provider,
      baseUrl: preserveConfiguredSecretString(config.modelBaseUrl, llm.baseUrl).replace(/\/+$/, ''),
      apiKey: preserveConfiguredSecretString(config.apiKey, llm.apiKey),
      model: preserveConfiguredSecretString(config.modelName, llm.model),
    },
    bioagent: {
      ...bioagent,
      agentServerBaseUrl: typeof config.agentServerBaseUrl === 'string' ? config.agentServerBaseUrl : bioagent.agentServerBaseUrl,
      workspaceWriterBaseUrl: typeof config.workspaceWriterBaseUrl === 'string' ? config.workspaceWriterBaseUrl : bioagent.workspaceWriterBaseUrl,
      workspacePath: normalizeWorkspaceRootPath(typeof config.workspacePath === 'string' ? config.workspacePath : typeof bioagent.workspacePath === 'string' ? bioagent.workspacePath : ''),
      requestTimeoutMs: typeof config.requestTimeoutMs === 'number' ? config.requestTimeoutMs : bioagent.requestTimeoutMs,
      updatedAt: new Date().toISOString(),
    },
  };
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
  return join(process.cwd(), 'config.local.json');
}

function normalizeWorkspaceRootPath(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const marker = '/.bioagent/';
  const nestedIndex = trimmed.indexOf(marker);
  if (nestedIndex >= 0) return trimmed.slice(0, nestedIndex);
  if (trimmed.endsWith('/.bioagent')) return trimmed.slice(0, -'/.bioagent'.length);
  return trimmed;
}
