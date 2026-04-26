import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
        .filter((entry) => !entry.name.startsWith('.DS_Store'))
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
      const filePath = resolve(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path is required');
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`${filePath} is not a file`);
      if (info.size > 1024 * 1024) throw new Error('File is larger than the 1MB preview/edit limit.');
      const content = await readFile(filePath, 'utf8');
      writeJson(res, 200, {
        ok: true,
        file: {
          path: filePath,
          name: basename(filePath),
          content,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          language: languageForPath(filePath),
        },
      });
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
      if (!filePath) throw new Error('path is required');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
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
          stableSkillRoots: ['skills/seed', 'skills/installed', '.bioagent/skills'],
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

function languageForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.r') return 'r';
  if (ext === '.csv' || ext === '.tsv') return 'table';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.sh') return 'shell';
  return 'text';
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
