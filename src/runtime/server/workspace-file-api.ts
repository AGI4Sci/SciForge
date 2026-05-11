import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE,
} from '@sciforge-ui/runtime-contract';
import { normalizeWorkspaceRootPath, resolveWorkspaceFilePreviewPath } from '../workspace-paths.js';
import { ensureSessionBundle, sessionBundleRel } from '../session-bundle.js';
import { isBinaryPreviewFile, languageForPath, mimeTypeForPath } from './file-preview.js';
import { isRecord, readJson, safeName, writeJson } from './http.js';
import { runWorkspaceOpenAction } from './workspace-open.js';

export type WorkspaceFileApiOptions = {
  stateDir: string;
  workspaceOpenDryRun: boolean;
};

export async function handleWorkspaceFileApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: WorkspaceFileApiOptions,
) {
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
    return true;
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
    return true;
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
    return true;
  }
  if (url.pathname === '/api/sciforge/workspace/snapshot' && req.method === 'GET') {
    try {
      const requestedPath = url.searchParams.get('path')?.trim() || '';
      const root = requestedPath ? resolve(requestedPath) : await readLastWorkspacePath(options.stateDir);
      const state = JSON.parse(await readFile(join(root, '.sciforge', 'workspace-state.json'), 'utf8'));
      writeJson(res, 200, { ok: true, workspacePath: root, state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('ENOENT') ? 404 : 400;
      writeJson(res, status, { ok: false, error: message });
    }
    return true;
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
    return true;
  }
  if (url.pathname === '/api/sciforge/workspace/open' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const result = await runWorkspaceOpenAction({
        workspacePath: typeof body.workspacePath === 'string' ? resolve(body.workspacePath) : await readLastWorkspacePath(options.stateDir),
        action: typeof body.action === 'string' ? body.action : '',
        path: typeof body.path === 'string' ? body.path : '',
        dryRun: options.workspaceOpenDryRun,
      });
      writeJson(res, 200, { ok: true, ...result });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
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
      await rememberWorkspace(options.stateDir, root, state);

      const sessions = isRecord(state.sessionsByScenario)
        ? Object.values(state.sessionsByScenario)
        : [];
      const archivedSessions = Array.isArray(state.archivedSessions)
        ? state.archivedSessions.filter(isRecord)
        : [];
      for (const session of [...sessions, ...archivedSessions] as Array<Record<string, unknown>>) {
        const sessionId = safeName(String(session.sessionId || 'session'));
        const bundleRel = await writeSessionBundleSnapshot(root, session);
        await writeFile(join(sciforgeDir, 'sessions', `${sessionId}.json`), JSON.stringify(session, null, 2));
        const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
        for (const artifact of artifacts as Array<Record<string, unknown>>) {
          const artifactId = safeName(String(artifact.id || artifact.type || 'artifact'));
          await writeFile(join(root, bundleRel, 'artifacts', `${artifactId}.json`), JSON.stringify(artifact, null, 2));
          await writeFile(join(sciforgeDir, 'artifacts', `${sessionId}-${artifactId}.json`), JSON.stringify(artifact, null, 2));
        }
        const versions = Array.isArray(session.versions) ? session.versions : [];
        for (const version of versions as Array<Record<string, unknown>>) {
          const versionId = safeName(String(version.id || 'version'));
          await writeFile(join(root, bundleRel, 'versions', `${versionId}.json`), JSON.stringify(version, null, 2));
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
    return true;
  }
  return false;
}

export async function readLastWorkspacePath(stateDir: string) {
  const best = await readBestRememberedWorkspace(stateDir);
  if (best) return best;
  const marker = JSON.parse(await readFile(lastWorkspaceFile(stateDir), 'utf8'));
  if (!isRecord(marker) || typeof marker.workspacePath !== 'string' || !marker.workspacePath.trim()) {
    throw new Error('last workspace marker is invalid');
  }
  return normalizeWorkspaceRootPath(resolve(marker.workspacePath));
}

async function rememberWorkspace(stateDir: string, workspacePath: string, state: Record<string, unknown>) {
  workspacePath = normalizeWorkspaceRootPath(workspacePath);
  await mkdir(stateDir, { recursive: true });
  const score = workspaceActivityScore(state);
  const updatedAt = new Date().toISOString();
  const history = await readWorkspaceHistory(stateDir);
  const nextHistory: Array<{ workspacePath: string; score: number; updatedAt: string }> = [
    { workspacePath, score, updatedAt },
    ...history.filter((item) => item.workspacePath !== workspacePath),
  ]
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20);
  const best = nextHistory[0];
  await writeFile(workspaceHistoryFile(stateDir), JSON.stringify({ workspaces: nextHistory }, null, 2));
  await writeFile(lastWorkspaceFile(stateDir), JSON.stringify({
    workspacePath: best.workspacePath,
    score: best.score,
    updatedAt: best.updatedAt,
  }, null, 2));
}

async function readBestRememberedWorkspace(stateDir: string) {
  const history = await readWorkspaceHistory(stateDir);
  return history[0]?.workspacePath ? normalizeWorkspaceRootPath(resolve(history[0].workspacePath)) : undefined;
}

async function readWorkspaceHistory(stateDir: string): Promise<Array<{ workspacePath: string; score: number; updatedAt: string }>> {
  const records: Array<{ workspacePath: string; score: number; updatedAt: string }> = [];
  try {
    const parsed = JSON.parse(await readFile(workspaceHistoryFile(stateDir), 'utf8'));
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
    const marker = JSON.parse(await readFile(lastWorkspaceFile(stateDir), 'utf8'));
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

async function writeSessionBundleSnapshot(root: string, session: Record<string, unknown>) {
  const sessionId = String(session.sessionId || 'session');
  const scenarioId = typeof session.scenarioId === 'string' ? session.scenarioId : undefined;
  const bundleRel = sessionBundleRel({
    sessionId,
    scenarioId,
    title: typeof session.title === 'string' ? session.title : undefined,
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
  });
  await ensureSessionBundle(root, bundleRel, {
    sessionId,
    scenarioId,
    title: typeof session.title === 'string' ? session.title : undefined,
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
  });
  await writeFile(join(root, bundleRel, 'records', 'session.json'), JSON.stringify(session, null, 2));
  await writeFile(join(root, bundleRel, 'records', 'messages.json'), JSON.stringify(Array.isArray(session.messages) ? session.messages : [], null, 2));
  await writeFile(join(root, bundleRel, 'records', 'runs.json'), JSON.stringify(Array.isArray(session.runs) ? session.runs : [], null, 2));
  await writeFile(join(root, bundleRel, 'records', 'execution-units.json'), JSON.stringify(Array.isArray(session.executionUnits) ? session.executionUnits : [], null, 2));
  await writeFile(join(root, bundleRel, 'records', 'ui-manifest.json'), JSON.stringify(Array.isArray(session.uiManifest) ? session.uiManifest : [], null, 2));
  await writeFile(join(root, bundleRel, 'README.md'), sessionBundleReadme(session, bundleRel));
  return bundleRel;
}

function sessionBundleReadme(session: Record<string, unknown>, bundleRel: string) {
  const title = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'SciForge session';
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : 'session';
  const scenario = typeof session.scenarioId === 'string' ? session.scenarioId : 'unknown-scenario';
  return [
    `# ${title}`,
    '',
    `- Session: ${sessionId}`,
    `- Scenario: ${scenario}`,
    `- Bundle: ${bundleRel}`,
    `- Created: ${typeof session.createdAt === 'string' ? session.createdAt : 'unknown'}`,
    `- Updated: ${typeof session.updatedAt === 'string' ? session.updatedAt : 'unknown'}`,
    '',
    'This directory is a portable SciForge conversation bundle. It keeps chat records, generated task code, inputs, results, logs, artifacts, versions, data, and exports together under one date-prefixed folder.',
    '',
    'Restore entry points:',
    '',
    '- `manifest.json` describes the bundle layout.',
    '- `records/session.json` contains the full session object.',
    '- `records/messages.json`, `records/runs.json`, and `records/execution-units.json` provide split records for quick inspection.',
  ].join('\n');
}

function lastWorkspaceFile(stateDir: string) {
  return join(stateDir, 'last-workspace.json');
}

function workspaceHistoryFile(stateDir: string) {
  return join(stateDir, 'workspace-history.json');
}

function redactConfigForFile(config: Record<string, unknown>) {
  return {
    ...config,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
  };
}
