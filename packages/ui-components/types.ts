import type { ReactNode } from 'react';

export type UIComponentLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type UIComponentSection = 'primary' | 'supporting' | 'provenance' | 'raw';
export type PresentationDedupeScope = 'entity' | 'document' | 'collection' | 'none';

export interface UIComponentManifest {
  packageName: string;
  moduleId: string;
  version: string;
  title: string;
  description: string;
  componentId: string;
  lifecycle: UIComponentLifecycle;
  acceptsArtifactTypes: string[];
  outputArtifactTypes?: string[];
  requiredFields?: string[];
  requiredAnyFields?: string[][];
  viewParams?: string[];
  interactionEvents?: string[];
  roleDefaults?: string[];
  fallbackModuleIds?: string[];
  defaultSection?: UIComponentSection;
  priority?: number;
  safety?: {
    sandbox?: boolean;
    externalResources?: 'none' | 'declared-only' | 'allowed';
    executesCode?: boolean;
  };
  presentation?: {
    dedupeScope?: PresentationDedupeScope;
    identityFields?: string[];
  };
  docs: {
    readmePath: string;
    agentSummary: string;
  };
}

export interface UIComponentRenderSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  transform?: Array<{
    type: 'filter' | 'sort' | 'limit' | 'group' | 'derive';
    field?: string;
    op?: string;
    value?: unknown;
  }>;
  encoding?: {
    colorBy?: string;
    splitBy?: string;
    overlayBy?: string;
    facetBy?: string;
    syncViewport?: boolean;
  };
  layout?: { mode?: string };
  compare?: { mode?: string };
}

export interface UIComponentRuntimeArtifact {
  id: string;
  type: string;
  producerScenario: string;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
  path?: string;
}

export interface UIComponentRenderHelpers {
  ArtifactSourceBar?: (props: { artifact?: UIComponentRuntimeArtifact; session?: unknown }) => ReactNode;
  ArtifactDownloads?: (props: { artifact?: UIComponentRuntimeArtifact }) => ReactNode;
  ComponentEmptyState?: (props: { componentId: string; artifactType?: string; title?: string; detail?: string }) => ReactNode;
  MarkdownBlock?: (props: { markdown?: string }) => ReactNode;
  readWorkspaceFile?: (ref: string) => Promise<{ content: string }>;
}

export interface UIComponentRendererProps {
  slot: UIComponentRenderSlot;
  artifact?: UIComponentRuntimeArtifact;
  session?: unknown;
  config?: unknown;
  helpers?: UIComponentRenderHelpers;
}

export type UIComponentRenderer = (props: UIComponentRendererProps) => ReactNode;
