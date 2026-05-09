import type { LucideIcon } from 'lucide-react';
import { scenarios, type ScenarioId } from '../../data';
import type { SciForgeRun, SciForgeWorkspaceState, ScenarioInstanceId } from '../../domain';
import { nowIso } from '../../domain';
import { compileScenarioIRFromSelection, recommendScenarioElements } from '../../scenarioCompiler/scenarioElementCompiler';
import type { ScenarioBuilderDraft } from '../../scenarioCompiler/scenarioDraftCompiler';
import { buildBuiltInScenarioPackage, type ScenarioPackage } from '../../scenarioCompiler/scenarioPackage';
import type { ScenarioLibraryItem } from '../../scenarioCompiler/scenarioLibrary';

export const officialScenarioPackages = scenarios.map((scenario) => ({
  scenario,
  package: buildBuiltInScenarioPackage(scenario.id, '2026-04-25T00:00:00.000Z'),
}));

export type DashboardLibraryItem = ScenarioLibraryItem & {
  builtInScenarioId?: ScenarioId;
  icon?: LucideIcon;
  color?: string;
  imported?: boolean;
  package?: ScenarioPackage;
};

export type PackageRunStats = {
  lastRun?: SciForgeRun;
  totalRuns: number;
  failedRuns: number;
};

export function parseScenarioPackageJson(value: unknown): ScenarioPackage {
  if (!isRecord(value)) throw new Error('Package JSON 必须是对象。');
  if (value.schemaVersion !== '1') throw new Error('只支持 schemaVersion=1 的 Scenario Package。');
  if (!asString(value.id)) throw new Error('Package 缺少 id。');
  if (!asString(value.version)) throw new Error('Package 缺少 version。');
  if (!['draft', 'validated', 'published', 'archived'].includes(String(value.status))) throw new Error('Package status 无效。');
  if (!isRecord(value.scenario)) throw new Error('Package 缺少 scenario。');
  if (!asString(value.scenario.id)) throw new Error('scenario.id 缺失。');
  if (!asString(value.scenario.title)) throw new Error('scenario.title 缺失。');
  if (!asString(value.scenario.skillDomain)) throw new Error('scenario.skillDomain 缺失。');
  if (!isRecord(value.skillPlan)) throw new Error('Package 缺少 skillPlan。');
  if (!isRecord(value.uiPlan)) throw new Error('Package 缺少 uiPlan。');
  if (!Array.isArray(value.tests)) throw new Error('Package tests 必须是数组。');
  if (!Array.isArray(value.versions)) throw new Error('Package versions 必须是数组。');
  return value as unknown as ScenarioPackage;
}

export function renameScenarioPackageForImport(pkg: ScenarioPackage, nextId: string): ScenarioPackage {
  return {
    ...pkg,
    id: nextId,
    status: pkg.status === 'archived' ? 'draft' : pkg.status,
    scenario: {
      ...pkg.scenario,
      id: nextId,
      title: pkg.scenario.title.endsWith(' copy') ? pkg.scenario.title : `${pkg.scenario.title} copy`,
      source: 'workspace',
    },
    versions: [{
      version: pkg.version,
      status: 'draft',
      createdAt: nowIso(),
      summary: `Imported as ${nextId} to avoid package id conflict.`,
      scenarioHash: `import-${nextId}`,
    }, ...pkg.versions],
  };
}

export function scenarioPackageToLibraryDisplayItem(
  pkg: ScenarioPackage,
  options: {
    source?: ScenarioLibraryItem['source'];
    builtInScenarioId?: ScenarioId;
    icon?: LucideIcon;
    color?: string;
    imported?: boolean;
    package?: ScenarioPackage;
  } = {},
): DashboardLibraryItem {
  return {
    id: pkg.id,
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    version: pkg.version,
    status: pkg.status,
    skillDomain: pkg.scenario.skillDomain,
    source: options.source ?? (pkg.status === 'archived' ? 'archived' : pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace'),
    packageRef: {
      id: pkg.id,
      version: pkg.version,
      source: pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
    },
    validationReport: pkg.validationReport,
    qualityReport: pkg.qualityReport,
    versions: pkg.versions,
    builtInScenarioId: options.builtInScenarioId,
    icon: options.icon,
    color: options.color,
    imported: options.imported,
    package: options.package,
  };
}

export function buildDashboardLibraryItems(libraryItems: ScenarioLibraryItem[]): DashboardLibraryItem[] {
  const importedPackageIds = new Set(libraryItems.map((item) => item.id));
  const officialLibraryItems = officialScenarioPackages.map(({ scenario, package: pkg }) => scenarioPackageToLibraryDisplayItem(pkg, {
    source: 'built-in',
    builtInScenarioId: scenario.id,
    icon: scenario.icon,
    color: scenario.color,
    imported: importedPackageIds.has(pkg.id),
    package: pkg,
  }));
  const workspaceLibraryItems = libraryItems.map((item) => ({
    ...item,
    imported: true,
  }));
  const workspaceIds = new Set(workspaceLibraryItems.map((item) => item.id));
  return [
    ...workspaceLibraryItems,
    ...officialLibraryItems.filter((item) => !workspaceIds.has(item.id)),
  ];
}

export function filterScenarioLibraryItems<T extends ScenarioLibraryItem>(
  items: T[],
  options: { query: string; status: string; source: string; domain: string; sort: string; runStatsById?: Record<string, PackageRunStats> },
) {
  const query = options.query.trim().toLowerCase();
  return [...items]
    .filter((item) => {
      if (options.status !== 'all' && item.status !== options.status) return false;
      if (options.source !== 'all' && item.source !== options.source) return false;
      if (options.domain !== 'all' && item.skillDomain !== options.domain) return false;
      if (!query) return true;
      return [item.id, item.title, item.description, item.version, item.status, item.source, item.skillDomain]
        .some((value) => value.toLowerCase().includes(query));
    })
    .sort((left, right) => {
      if (options.sort === 'title') return left.title.localeCompare(right.title);
      if (options.sort === 'status') return `${left.status}-${left.title}`.localeCompare(`${right.status}-${right.title}`);
      if (options.sort === 'usage') return scenarioRankScore(right, options.runStatsById?.[right.id]) - scenarioRankScore(left, options.runStatsById?.[left.id]);
      return Date.parse(right.versions[0]?.createdAt ?? '') - Date.parse(left.versions[0]?.createdAt ?? '');
    });
}

export function buildPackageRunStats(workspaceState: SciForgeWorkspaceState): Record<string, PackageRunStats> {
  const stats: Record<string, PackageRunStats> = {};
  const sessions = [
    ...Object.values(workspaceState.sessionsByScenario),
    ...workspaceState.archivedSessions,
  ];
  for (const run of sessions.flatMap((session) => session.runs)) {
    const packageId = run.scenarioPackageRef?.id;
    if (!packageId) continue;
    const current = stats[packageId] ?? { totalRuns: 0, failedRuns: 0 };
    const currentLast = current.lastRun ? Date.parse(current.lastRun.completedAt ?? current.lastRun.createdAt) : -1;
    const runTime = Date.parse(run.completedAt ?? run.createdAt);
    stats[packageId] = {
      lastRun: runTime >= currentLast ? run : current.lastRun,
      totalRuns: current.totalRuns + 1,
      failedRuns: current.failedRuns + (run.status === 'failed' ? 1 : 0),
    };
  }
  return stats;
}

export function packageManifestPreview(pkg: ScenarioPackage, workspacePath: string) {
  const json = JSON.stringify(pkg, null, 2);
  const sensitiveRefs = extractSensitiveWorkspaceRefs(json, workspacePath);
  const qualityOk = pkg.qualityReport?.ok ?? pkg.validationReport?.ok ?? true;
  return {
    hasSensitiveRefs: sensitiveRefs.length > 0,
    sensitiveRefs,
    slotCount: pkg.uiPlan.slots.length,
    skillCount: pkg.skillPlan.skillIRs.length,
    testCount: pkg.tests.length,
    versionCount: pkg.versions.length || 1,
    qualityLabel: qualityOk ? 'quality pass' : 'quality warnings',
    manifest: {
      schemaVersion: pkg.schemaVersion,
      id: pkg.id,
      version: pkg.version,
      status: pkg.status,
      scenario: {
        id: pkg.scenario.id,
        title: pkg.scenario.title,
        skillDomain: pkg.scenario.skillDomain,
        source: pkg.scenario.source,
      },
      skillPlan: {
        id: pkg.skillPlan.id,
        skills: pkg.skillPlan.skillIRs.map((skill) => skill.skillId),
      },
      uiPlan: {
        id: pkg.uiPlan.id,
        components: pkg.uiPlan.compiledFrom.componentIds,
        artifacts: pkg.uiPlan.compiledFrom.artifactTypes,
      },
      tests: pkg.tests.map((test) => ({ id: test.id, expectedArtifactTypes: test.expectedArtifactTypes })),
      quality: {
        ok: qualityOk,
        issues: pkg.qualityReport?.items.length ?? pkg.validationReport?.issues.length ?? 0,
      },
      versions: pkg.versions.map((version) => ({
        version: version.version,
        status: version.status,
        createdAt: version.createdAt,
        summary: version.summary,
      })),
    },
  };
}

export function scenarioInstanceIdForDraft(draft: ScenarioBuilderDraft): ScenarioInstanceId {
  return `workspace-${draft.baseScenarioId}-${safeInstanceId(draft.title || draft.description)}-${Date.now().toString(36)}`;
}

export function compileScenarioPackageForDraft(instanceId: ScenarioInstanceId, draft: ScenarioBuilderDraft): ScenarioPackage {
  const recommendation = recommendScenarioElements(draft.description || draft.scenarioMarkdown);
  const selectedSkillIds = draft.recommendedSkillIds?.length ? draft.recommendedSkillIds : recommendation.selectedSkillIds;
  const selectedArtifactTypes = draft.recommendedArtifactTypes?.length ? draft.recommendedArtifactTypes : recommendation.selectedArtifactTypes;
  const selectedComponentIds = draft.recommendedComponentIds?.length ? draft.recommendedComponentIds : draft.defaultComponents.length ? draft.defaultComponents : recommendation.selectedComponentIds;
  const result = compileScenarioIRFromSelection({
    id: String(instanceId),
    title: draft.title,
    description: draft.description,
    skillDomain: draft.skillDomain,
    scenarioMarkdown: draft.scenarioMarkdown,
    selectedSkillIds,
    selectedToolIds: recommendation.selectedToolIds,
    selectedArtifactTypes,
    selectedComponentIds,
    selectedFailurePolicyIds: recommendation.selectedFailurePolicyIds,
    fallbackComponentId: draft.fallbackComponent,
  });
  return result.package;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function scenarioRankScore(item: ScenarioLibraryItem, runStats?: PackageRunStats) {
  const qualityOk = item.qualityReport?.ok ?? item.validationReport?.ok ?? true;
  const latestRunAt = runStats?.lastRun ? Date.parse(runStats.lastRun.completedAt ?? runStats.lastRun.createdAt) : 0;
  const recencyDays = latestRunAt ? Math.max(0, 30 - ((Date.now() - latestRunAt) / 86_400_000)) : 0;
  const successRuns = (runStats?.totalRuns ?? 0) - (runStats?.failedRuns ?? 0);
  const statusScore = item.status === 'published' ? 30 : item.status === 'validated' ? 20 : item.status === 'draft' ? 8 : -40;
  return statusScore + (qualityOk ? 20 : -10) + Math.min(40, successRuns * 8) + recencyDays;
}

function safeInstanceId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || Date.now().toString(36);
}

function extractSensitiveWorkspaceRefs(json: string, workspacePath: string) {
  const refs = new Set<string>();
  const normalizedWorkspace = workspacePath.trim();
  if (normalizedWorkspace && json.includes(normalizedWorkspace)) refs.add(normalizedWorkspace);
  const pathPattern = /(?:\/Users\/|\/Applications\/workspace\/|[A-Za-z]:\\)[^"',\s)]+/g;
  for (const match of json.matchAll(pathPattern)) {
    refs.add(match[0]);
  }
  return Array.from(refs).slice(0, 12);
}
