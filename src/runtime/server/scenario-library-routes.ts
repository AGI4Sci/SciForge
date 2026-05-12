import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readRecentTaskAttempts, readTaskAttempts } from '../task-attempt-history.js';
import { normalizeScenarioPackageVersion } from '@sciforge/scenario-core/scenario-package';
import {
  acceptSkillPromotionProposal,
  archiveSkillPromotionProposal,
  listSkillPromotionProposals,
  rejectSkillPromotionProposal,
  runAcceptedSkillValidationSmoke,
} from '../skill-promotion.js';
import { isRecord, readJson, safeName, writeJson } from './http.js';

export async function handleScenarioLibraryRoutes(req: IncomingMessage, res: ServerResponse, url: URL) {
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  if (url.pathname === '/api/sciforge/task-attempts/list' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const skillDomain = url.searchParams.get('skillDomain')?.trim() || undefined;
      const scenarioPackageId = url.searchParams.get('scenarioPackageId')?.trim() || undefined;
      const limit = Number(url.searchParams.get('limit') || 20);
      const attempts = await readRecentTaskAttempts(root, skillDomain, Number.isFinite(limit) ? limit : 20);
      const scopedAttempts = scenarioPackageId
        ? attempts.filter((attempt) => isRecord(attempt.scenarioPackageRef) && attempt.scenarioPackageRef.id === scenarioPackageId)
        : attempts;
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        attempts: scopedAttempts,
        taskRunCards: scopedAttempts.map((attempt) => attempt.taskRunCard).filter(Boolean),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (url.pathname === '/api/sciforge/task-attempts/get' && req.method === 'GET') {
    try {
      const root = scenarioWorkspaceRoot(url);
      const id = url.searchParams.get('id')?.trim() || '';
      if (!id) throw new Error('id is required');
      const attempts = await readTaskAttempts(root, id);
      writeJson(res, 200, {
        ok: true,
        workspacePath: root,
        id,
        attempts,
        taskRunCards: attempts.map((attempt) => attempt.taskRunCard).filter(Boolean),
      });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  return false;
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
  const version = normalizeScenarioPackageVersion(pkg.version);
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
    version: normalizeScenarioPackageVersion(scenario.version),
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
    version: normalizeScenarioPackageVersion(pkg.version),
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
