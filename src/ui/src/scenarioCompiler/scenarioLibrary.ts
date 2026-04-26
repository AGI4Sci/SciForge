import type { ScenarioPackageRef } from '../domain';
import type { ScenarioPackage } from './scenarioPackage';
import type { ValidationReport } from './validationGate';
import type { ScenarioQualityReport } from './scenarioQualityGate';

export type ScenarioLibrarySource = 'built-in' | 'workspace' | 'team' | 'marketplace' | 'archived';

export interface ScenarioLibraryItem {
  id: string;
  title: string;
  description: string;
  version: string;
  status: ScenarioPackage['status'];
  skillDomain: ScenarioPackage['scenario']['skillDomain'];
  source: ScenarioLibrarySource;
  packageRef: ScenarioPackageRef;
  validationReport?: ValidationReport;
  qualityReport?: ScenarioQualityReport;
  versions: ScenarioPackage['versions'];
}

export interface ReusableTaskCandidate {
  id: string;
  skillId?: string;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  runtimeProfileId?: string;
  codeRef?: string;
  successCount: number;
  lastRunAt?: string;
  promotionState: 'candidate' | 'promoted' | 'rejected';
}

export interface ViewPresetCandidate {
  id: string;
  scenarioPackageRef?: ScenarioPackageRef;
  uiPlanRef?: string;
  artifactTypes: string[];
  componentIds: string[];
  usageCount: number;
  promotionState: 'candidate' | 'promoted' | 'rejected';
}

export interface ScenarioLibraryState {
  schemaVersion: 1;
  generatedAt: string;
  items: ScenarioLibraryItem[];
  reusableTaskCandidates: ReusableTaskCandidate[];
  viewPresetCandidates: ViewPresetCandidate[];
}

export function buildScenarioLibraryState(
  packages: ScenarioPackage[],
  generatedAt = new Date().toISOString(),
): ScenarioLibraryState {
  return {
    schemaVersion: 1,
    generatedAt,
    items: packages.map(packageToLibraryItem),
    reusableTaskCandidates: [],
    viewPresetCandidates: packages.flatMap(packageToViewPresetCandidate),
  };
}

export function promoteReusableTaskCandidate(
  state: ScenarioLibraryState,
  candidateId: string,
): ScenarioLibraryState {
  return updateCandidateState(state, 'reusableTaskCandidates', candidateId, 'promoted');
}

export function rejectReusableTaskCandidate(
  state: ScenarioLibraryState,
  candidateId: string,
): ScenarioLibraryState {
  return updateCandidateState(state, 'reusableTaskCandidates', candidateId, 'rejected');
}

export function promoteViewPresetCandidate(
  state: ScenarioLibraryState,
  candidateId: string,
): ScenarioLibraryState {
  return updateCandidateState(state, 'viewPresetCandidates', candidateId, 'promoted');
}

export function rejectViewPresetCandidate(
  state: ScenarioLibraryState,
  candidateId: string,
): ScenarioLibraryState {
  return updateCandidateState(state, 'viewPresetCandidates', candidateId, 'rejected');
}

function packageToLibraryItem(pkg: ScenarioPackage): ScenarioLibraryItem {
  return {
    id: pkg.id,
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    version: pkg.version,
    status: pkg.status,
    skillDomain: pkg.scenario.skillDomain,
    source: pkg.status === 'archived' ? 'archived' : pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
    packageRef: {
      id: pkg.id,
      version: pkg.version,
      source: pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
    },
    validationReport: pkg.validationReport,
    qualityReport: pkg.qualityReport,
    versions: pkg.versions,
  };
}

function packageToViewPresetCandidate(pkg: ScenarioPackage): ViewPresetCandidate[] {
  if (!pkg.uiPlan.slots.length) return [];
  return [{
    id: `view-candidate.${pkg.id}.${pkg.version}`,
    scenarioPackageRef: {
      id: pkg.id,
      version: pkg.version,
      source: pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
    },
    uiPlanRef: pkg.uiPlan.id,
    artifactTypes: pkg.uiPlan.compiledFrom.artifactTypes,
    componentIds: pkg.uiPlan.compiledFrom.componentIds,
    usageCount: 1,
    promotionState: 'candidate',
  }];
}

function updateCandidateState<T extends ReusableTaskCandidate | ViewPresetCandidate>(
  state: ScenarioLibraryState,
  key: 'reusableTaskCandidates' | 'viewPresetCandidates',
  candidateId: string,
  promotionState: T['promotionState'],
): ScenarioLibraryState {
  return {
    ...state,
    generatedAt: new Date().toISOString(),
    [key]: state[key].map((candidate) => (
      candidate.id === candidateId ? { ...candidate, promotionState } : candidate
    )),
  };
}
