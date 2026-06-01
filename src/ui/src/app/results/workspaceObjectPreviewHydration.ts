import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import type { ObjectReference, PreviewDescriptor, RuntimeArtifact, SciForgeConfig } from '../../domain';
import type { ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import { canHydrateWorkspaceObjectPath } from './workspaceObjectPreviewModel';

export interface WorkspaceObjectPreviewHydrationState {
  descriptor?: PreviewDescriptor;
  file?: WorkspaceFileContent;
  loadingPath: string;
  error: string;
}

export type WorkspaceObjectPreviewHydrationPlan =
  | { action: 'hydrate'; path: string }
  | { action: 'skip'; reason: 'inline-preview' | 'presentation-input' | 'unsupported-reference-kind' | 'missing-path' | 'unsafe-path' };

export interface WorkspaceObjectPreviewHydrationPlanInput {
  inlinePreviewAvailable: boolean;
  presentationInputKind?: string;
  referenceKind: ObjectReference['kind'];
  path?: string;
}

export interface WorkspaceObjectPreviewHydrationInput extends WorkspaceObjectPreviewHydrationPlanInput {
  artifact?: RuntimeArtifact;
  config: SciForgeConfig;
  hydrationApi: ArtifactPreviewHydrationApi;
}

const EMPTY_WORKSPACE_OBJECT_PREVIEW_HYDRATION_STATE: WorkspaceObjectPreviewHydrationState = {
  descriptor: undefined,
  file: undefined,
  loadingPath: '',
  error: '',
};

export function workspaceObjectPreviewHydrationPlan(input: WorkspaceObjectPreviewHydrationPlanInput): WorkspaceObjectPreviewHydrationPlan {
  if (input.inlinePreviewAvailable) return { action: 'skip', reason: 'inline-preview' };
  if (input.presentationInputKind === 'binary' || input.presentationInputKind === 'unsupported') {
    return { action: 'skip', reason: 'presentation-input' };
  }
  if (input.referenceKind !== 'file' && input.referenceKind !== 'artifact') {
    return { action: 'skip', reason: 'unsupported-reference-kind' };
  }
  if (!input.path) return { action: 'skip', reason: 'missing-path' };
  if (!canHydrateWorkspaceObjectPath(input.path)) return { action: 'skip', reason: 'unsafe-path' };
  return { action: 'hydrate', path: input.path };
}

export function useWorkspaceObjectPreviewHydration(input: WorkspaceObjectPreviewHydrationInput): WorkspaceObjectPreviewHydrationState {
  const previewConfig = useMemo(() => input.config, [input.config.workspacePath, input.config.workspaceWriterBaseUrl]);
  const [state, setState] = useState<WorkspaceObjectPreviewHydrationState>(EMPTY_WORKSPACE_OBJECT_PREVIEW_HYDRATION_STATE);
  const plan = workspaceObjectPreviewHydrationPlan(input);
  const planKey = plan.action === 'hydrate' ? `hydrate:${plan.path}` : `skip:${plan.reason}`;

  useEffect(() => {
    const nextPlan = workspaceObjectPreviewHydrationPlan(input);
    if (nextPlan.action === 'skip') {
      setState(EMPTY_WORKSPACE_OBJECT_PREVIEW_HYDRATION_STATE);
      return undefined;
    }
    let cancelled = false;
    setState({
      descriptor: undefined,
      file: undefined,
      loadingPath: nextPlan.path,
      error: '',
    });
    void input.hydrationApi.hydrateWorkspaceObjectPreview({
      artifact: input.artifact,
      path: nextPlan.path,
      config: previewConfig,
    })
      .then((hydration) => {
        if (cancelled) return;
        setState({
          descriptor: hydration.descriptor ?? hydration.staticDescriptor,
          file: hydration.file,
          loadingPath: '',
          error: hydration.error ?? '',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          descriptor: undefined,
          file: undefined,
          loadingPath: '',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    input.artifact,
    input.hydrationApi,
    input.inlinePreviewAvailable,
    input.path,
    input.presentationInputKind,
    input.referenceKind,
    planKey,
    previewConfig,
  ]);

  return state;
}
