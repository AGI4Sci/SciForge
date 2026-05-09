import type { RuntimeArtifact } from './artifacts';
import type { ObjectReference, ObjectResolution } from './references';

export type BackendArtifactToolName =
  | 'list_session_artifacts'
  | 'resolve_object_reference'
  | 'read_artifact'
  | 'render_artifact'
  | 'resume_run';

export type BackendObjectRefKind =
  | 'workspace'
  | 'artifact'
  | 'execution-unit'
  | 'run'
  | 'file'
  | 'agentserver';

export interface BackendToolContext {
  workspacePath: string;
  sessionId?: string;
  skillDomain?: string;
  artifacts?: Array<Record<string, unknown>>;
}

export interface ListSessionArtifactsInput extends BackendToolContext {
  limit?: number;
}

export interface ListSessionArtifactsResult {
  tool: 'list_session_artifacts';
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
}

export interface ResolveObjectReferenceInput extends BackendToolContext {
  ref: string;
}

export interface ResolveObjectReferenceResult extends ObjectResolution {
  tool: 'resolve_object_reference';
  refKind: BackendObjectRefKind;
}

export interface ReadArtifactInput extends BackendToolContext {
  ref: string;
}

export interface ReadArtifactResult {
  tool: 'read_artifact';
  reference: ObjectReference;
  artifact?: RuntimeArtifact;
  content?: unknown;
  text?: string;
  mimeType?: string;
  status: 'read' | 'missing' | 'blocked';
  reason?: string;
}

export type RenderArtifactFormat = 'markdown' | 'json' | 'text';

export interface RenderArtifactInput extends BackendToolContext {
  ref: string;
  format?: RenderArtifactFormat;
}

export interface RenderArtifactResult {
  tool: 'render_artifact';
  reference: ObjectReference;
  format: RenderArtifactFormat;
  rendered?: string;
  status: 'rendered' | 'missing' | 'blocked';
  reason?: string;
}

export interface ResumeRunInput extends BackendToolContext {
  ref: string;
  reason?: string;
}

export interface ResumeRunResult {
  tool: 'resume_run';
  runRef: string;
  status: 'resume-requested' | 'missing' | 'blocked';
  objectReferences: ObjectReference[];
  reason?: string;
}
