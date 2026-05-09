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

export type UIModuleLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type ViewPlanSection = 'primary' | 'supporting' | 'provenance' | 'raw';

export interface UIModuleManifest {
  moduleId: string;
  version: string;
  title: string;
  componentId: string;
  lifecycle: UIModuleLifecycle;
  acceptsArtifactTypes: string[];
  requiredFields?: string[];
  requiredAnyFields?: string[][];
  viewParams?: string[];
  interactionEvents?: string[];
  roleDefaults?: string[];
  fallbackModuleIds?: string[];
  defaultSection?: ViewPlanSection;
  priority?: number;
  safety?: {
    sandbox?: boolean;
    externalResources?: 'none' | 'declared-only' | 'allowed';
    executesCode?: boolean;
  };
}

export interface ViewPreset {
  presetId: string;
  moduleId: string;
  version: string;
  title: string;
  slot: UIManifestSlot;
  lifecycle: UIModuleLifecycle;
}

export interface DisplayIntent {
  primaryGoal: string;
  requiredArtifactTypes?: string[];
  preferredModules?: string[];
  fallbackAcceptable?: string[];
  layoutPreference?: ViewLayout;
  acceptanceCriteria?: string[];
  source?: 'agentserver' | 'runtime-artifact' | 'ui-design-studio' | 'fallback-inference';
}

export interface ResolvedViewPlan {
  displayIntent: DisplayIntent;
  sections: Record<ViewPlanSection, UIManifestSlot[]>;
  diagnostics: string[];
  blockedDesign?: {
    reason: string;
    requiredModuleCapability: string;
    resumeRunId?: string;
  };
}
