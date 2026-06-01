import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import type { ObjectReference, PreviewDescriptor, SciForgeConfig, SciForgeSession } from '../../domain';
import type { UserActionApi } from '../projectionApi';
import type { ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import { descriptorCanUseWorkspacePreview } from './previewDescriptor';

export const WORKSPACE_DESCRIPTOR_PREVIEW_INLINE_LIMIT_BYTES = 1024 * 1024;

export interface WorkspaceDescriptorPreviewLoadState {
  derivedFile?: WorkspaceFileContent;
  derivedLabel: string;
  derivedError: string;
  derivedLoading: boolean;
  descriptorLoadKey: string;
  needsManualLoad: boolean;
  requestLoad: () => Promise<unknown>;
}

export type WorkspaceDescriptorPreviewLoadPlan =
  | { action: 'load'; descriptorLoadKey: string }
  | { action: 'wait-for-manual-load'; descriptorLoadKey: string }
  | { action: 'skip'; reason: 'unsupported-descriptor'; descriptorLoadKey: string };

export interface WorkspaceDescriptorPreviewLoadPlanInput {
  descriptor: PreviewDescriptor;
  requestedLoadKey?: string;
  byteLimit?: number;
}

export interface WorkspaceDescriptorPreviewLoadInput extends WorkspaceDescriptorPreviewLoadPlanInput {
  config: SciForgeConfig;
  session: SciForgeSession;
  reference: ObjectReference;
  userActionApi: Pick<UserActionApi, 'loadArtifactPreview'>;
  hydrationApi: Pick<ArtifactPreviewHydrationApi, 'loadDescriptorPreviewFile'>;
}

export function workspaceDescriptorPreviewLoadKey(descriptor: PreviewDescriptor) {
  return `${descriptor.kind}:${descriptor.inlinePolicy}:${descriptor.sizeBytes ?? 'unknown'}:${descriptor.ref}`;
}

export function workspaceDescriptorPreviewLoadPlan(
  input: WorkspaceDescriptorPreviewLoadPlanInput,
): WorkspaceDescriptorPreviewLoadPlan {
  const descriptorLoadKey = workspaceDescriptorPreviewLoadKey(input.descriptor);
  if (!descriptorCanUseWorkspacePreview(input.descriptor)) {
    return { action: 'skip', reason: 'unsupported-descriptor', descriptorLoadKey };
  }
  if (descriptorNeedsManualPreviewLoad(input.descriptor, input.byteLimit)
    && input.requestedLoadKey !== descriptorLoadKey) {
    return { action: 'wait-for-manual-load', descriptorLoadKey };
  }
  return { action: 'load', descriptorLoadKey };
}

export function useWorkspaceDescriptorPreviewLoad(
  input: WorkspaceDescriptorPreviewLoadInput,
): WorkspaceDescriptorPreviewLoadState {
  const {
    byteLimit = WORKSPACE_DESCRIPTOR_PREVIEW_INLINE_LIMIT_BYTES,
    config,
    descriptor,
    hydrationApi,
    reference,
    session,
    userActionApi,
  } = input;
  const previewConfig = useMemo(() => config, [config.workspacePath, config.workspaceWriterBaseUrl]);
  const [derivedFile, setDerivedFile] = useState<WorkspaceFileContent | undefined>();
  const [derivedLabel, setDerivedLabel] = useState('');
  const [derivedError, setDerivedError] = useState('');
  const [derivedLoading, setDerivedLoading] = useState(false);
  const [requestedLoadKey, setRequestedLoadKey] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const plan = workspaceDescriptorPreviewLoadPlan({ descriptor, requestedLoadKey, byteLimit });
  const requestLoad = useCallback(() => requestManualArtifactPreviewLoad({
    session,
    reference,
    userActionApi,
    byteLimit,
  }).finally(() => {
    setRequestedLoadKey(plan.descriptorLoadKey);
    setLoadAttempt((attempt) => attempt + 1);
  }), [byteLimit, plan.descriptorLoadKey, reference, session, userActionApi]);

  useEffect(() => {
    const nextPlan = workspaceDescriptorPreviewLoadPlan({ descriptor, requestedLoadKey, byteLimit });
    if (nextPlan.action !== 'load') {
      setDerivedFile(undefined);
      setDerivedLabel('');
      setDerivedError('');
      setDerivedLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDerivedFile(undefined);
    setDerivedError('');
    setDerivedLoading(true);
    void hydrationApi.loadDescriptorPreviewFile({ descriptor, config: previewConfig })
      .then(({ file, label }) => {
        if (cancelled) return;
        setDerivedFile(file);
        setDerivedLabel(label);
      })
      .catch((error) => {
        if (!cancelled) setDerivedError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDerivedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    byteLimit,
    descriptor,
    hydrationApi,
    loadAttempt,
    previewConfig,
    requestedLoadKey,
  ]);

  return {
    derivedFile,
    derivedLabel,
    derivedError,
    derivedLoading,
    descriptorLoadKey: plan.descriptorLoadKey,
    needsManualLoad: descriptorNeedsManualPreviewLoad(descriptor, byteLimit),
    requestLoad,
  };
}

export async function requestManualArtifactPreviewLoad(input: {
  session: SciForgeSession;
  reference: ObjectReference;
  userActionApi: Pick<UserActionApi, 'loadArtifactPreview'>;
  byteLimit?: number;
}) {
  if (input.reference.kind !== 'artifact') return undefined;
  return input.userActionApi.loadArtifactPreview({
    session: input.session,
    artifactRef: input.reference.ref,
    byteLimit: input.byteLimit,
  });
}

export function descriptorNeedsManualPreviewLoad(
  descriptor: PreviewDescriptor,
  byteLimit = WORKSPACE_DESCRIPTOR_PREVIEW_INLINE_LIMIT_BYTES,
) {
  if (!descriptorCanUseWorkspacePreview(descriptor)) return false;
  if (descriptor.inlinePolicy !== 'inline') return true;
  return (descriptor.sizeBytes ?? 0) > byteLimit;
}
