export type ScenarioId =
  | 'literature-evidence-review'
  | 'structure-exploration'
  | 'omics-differential-exploration'
  | 'biomedical-knowledge-graph';

export interface UIManifestSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  artifactRef?: string;
  priority?: number;
  encoding?: ViewEncoding;
  layout?: ViewLayout;
  selection?: ViewSelection;
  sync?: ViewSync;
  transform?: ViewTransform[];
  compare?: ViewCompare;
}

export interface ViewEncoding {
  colorBy?: string;
  splitBy?: string;
  overlayBy?: string;
  facetBy?: string;
  compareWith?: string | string[];
  highlightSelection?: string | string[];
  syncViewport?: boolean;
  x?: string;
  y?: string;
  label?: string;
}

export interface ViewLayout {
  mode?: 'single' | 'side-by-side' | 'stacked' | 'grid' | 'faceted';
  columns?: number;
  height?: number;
}

export interface ViewSelection {
  id?: string;
  field?: string;
  values?: string[];
}

export interface ViewSync {
  selectionIds?: string[];
  viewportIds?: string[];
}

export interface ViewTransform {
  type: 'filter' | 'sort' | 'limit' | 'group' | 'derive';
  field?: string;
  op?: string;
  value?: unknown;
}

export interface ViewCompare {
  artifactRefs?: string[];
  mode?: 'overlay' | 'side-by-side' | 'diff';
}

export interface ScenarioPackageRef {
  id: string;
  version: string;
  source: 'built-in' | 'workspace' | 'generated';
}

export interface ScenarioRuntimeOverride {
  title: string;
  description: string;
  skillDomain: 'literature' | 'structure' | 'omics' | 'knowledge';
  scenarioMarkdown: string;
  defaultComponents: string[];
  allowedComponents: string[];
  fallbackComponent: string;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
}

export interface ExportPolicyDecision {
  allowed: boolean;
  blockedArtifactIds: string[];
  restrictedArtifactIds: string[];
  sensitiveFlags: string[];
  warnings: string[];
}
