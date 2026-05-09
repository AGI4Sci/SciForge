import type { RuntimeArtifact } from './artifacts';

export type ObjectReferenceKind = 'artifact' | 'file' | 'folder' | 'run' | 'execution-unit' | 'url' | 'scenario-package';
export type ObjectReferenceStatus = 'available' | 'missing' | 'expired' | 'blocked' | 'external';
export type ObjectAction = 'focus-right-pane' | 'inspect' | 'open-external' | 'reveal-in-folder' | 'copy-path' | 'pin' | 'compare';
export type SciForgeReferenceKind =
  | 'file'
  | 'file-region'
  | 'message'
  | 'task-result'
  | 'chart'
  | 'table'
  | 'table-range'
  | 'structure-selection'
  | 'ui';

export interface SciForgeReference {
  id: string;
  kind: SciForgeReferenceKind;
  title: string;
  ref: string;
  summary?: string;
  sourceId?: string;
  runId?: string;
  locator?: {
    page?: number;
    sheet?: string;
    rowRange?: string;
    columnRange?: string;
    textRange?: string;
    region?: string;
  };
  payload?: unknown;
}

export interface ObjectReference {
  id: string;
  title: string;
  kind: ObjectReferenceKind;
  ref: string;
  artifactType?: string;
  runId?: string;
  executionUnitId?: string;
  preferredView?: string;
  actions?: ObjectAction[];
  status?: ObjectReferenceStatus;
  summary?: string;
  provenance?: {
    dataRef?: string;
    path?: string;
    producer?: string;
    version?: string;
    hash?: string;
    size?: number;
    screenshotRef?: string;
  };
}

export interface ObjectResolution {
  reference: ObjectReference;
  status: 'resolved' | 'missing' | 'blocked';
  artifact?: RuntimeArtifact;
  path?: string;
  reason?: string;
  actions: ObjectAction[];
}
