import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { runBioAgentTool } from './bioagent-tools.js';

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
  if (url.pathname === '/api/bioagent/workspace/list' && req.method === 'GET') {
    try {
      const root = resolve(url.searchParams.get('path') || process.cwd());
      const entries = await readdir(root, { withFileTypes: true });
      writeJson(res, 200, {
        ok: true,
        path: root,
        entries: entries
          .filter((entry) => !entry.name.startsWith('.DS_Store'))
          .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
          .map((entry) => ({
            name: entry.name,
            path: join(root, entry.name),
            kind: entry.isDirectory() ? 'folder' : 'file',
          })),
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
  if (url.pathname === '/api/bioagent/workspace/snapshot' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      if (!workspacePath) throw new Error('workspacePath is required');
      const state = isRecord(body.state) ? body.state : {};
      const config = isRecord(body.config) ? body.config : {};
      const root = resolve(workspacePath);
      const bioagentDir = join(root, '.bioagent');
      await mkdir(join(bioagentDir, 'sessions'), { recursive: true });
      await mkdir(join(bioagentDir, 'artifacts'), { recursive: true });
      await mkdir(join(bioagentDir, 'versions'), { recursive: true });
      await writeFile(join(bioagentDir, 'workspace-state.json'), JSON.stringify(state, null, 2));
      await writeFile(join(bioagentDir, 'config.json'), JSON.stringify(redactConfigForFile(config), null, 2));
      await rememberWorkspace(root, state);

      const sessions = isRecord(state.sessionsByAgent)
        ? Object.values(state.sessionsByAgent)
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

function safeName(value: string) {
  return basename(value.replace(/[^a-zA-Z0-9._-]+/g, '_')).slice(0, 120);
}

async function readLastWorkspacePath() {
  const best = await readBestRememberedWorkspace();
  if (best) return best;
  const marker = JSON.parse(await readFile(lastWorkspaceFile(), 'utf8'));
  if (!isRecord(marker) || typeof marker.workspacePath !== 'string' || !marker.workspacePath.trim()) {
    throw new Error('last workspace marker is invalid');
  }
  return resolve(marker.workspacePath);
}

async function rememberWorkspace(workspacePath: string, state: Record<string, unknown>) {
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
  return history[0]?.workspacePath ? resolve(history[0].workspacePath) : undefined;
}

async function readWorkspaceHistory(): Promise<Array<{ workspacePath: string; score: number; updatedAt: string }>> {
  const records: Array<{ workspacePath: string; score: number; updatedAt: string }> = [];
  try {
    const parsed = JSON.parse(await readFile(workspaceHistoryFile(), 'utf8'));
    if (isRecord(parsed) && Array.isArray(parsed.workspaces)) {
      for (const item of parsed.workspaces) {
        if (isRecord(item) && typeof item.workspacePath === 'string' && item.workspacePath.trim()) {
          records.push({
            workspacePath: resolve(item.workspacePath),
            score: typeof item.score === 'number' ? item.score : 0,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
          });
        }
      }
    }
  } catch {
    // No history file yet; fall back to the legacy single marker below.
  }
  try {
    const marker = JSON.parse(await readFile(lastWorkspaceFile(), 'utf8'));
    if (isRecord(marker) && typeof marker.workspacePath === 'string' && marker.workspacePath.trim()) {
      records.push({
        workspacePath: resolve(marker.workspacePath),
        score: typeof marker.score === 'number' ? marker.score : 0,
        updatedAt: typeof marker.updatedAt === 'string' ? marker.updatedAt : '',
      });
    }
  } catch {
    // No legacy marker.
  }
  return records
    .filter((item, index, all) => all.findIndex((candidate) => candidate.workspacePath === item.workspacePath) === index)
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
}

function workspaceActivityScore(state: Record<string, unknown>): number {
  const sessions = isRecord(state.sessionsByAgent) ? Object.values(state.sessionsByAgent) : [];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactConfigForFile(config: Record<string, unknown>) {
  return {
    ...config,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
  };
}
