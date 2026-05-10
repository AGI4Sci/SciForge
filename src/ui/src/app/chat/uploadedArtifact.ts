import { writeWorkspaceFile } from '../../api/workspaceClient';
import { makeId, nowIso, type RuntimeArtifact, type SciForgeConfig, type ScenarioInstanceId } from '../../domain';
import {
  artifactTypeForUploadedFileLike as artifactTypeForUploadedFile,
  objectReferenceForUploadedArtifact,
  previewKindForUploadedFileLike as previewKindForUploadedFile,
  referenceForUploadedArtifact,
  uploadedDerivativeHintsForFileLike as uploadedDerivativeHints,
  uploadedInlinePolicyForFileLike as uploadedInlinePolicy,
  uploadedLocatorHintsForFileLike as uploadedLocatorHints,
  uploadedPreviewActionsForFileLike as uploadedPreviewActions,
} from '../../../../../packages/support/object-references';

export {
  objectReferenceForUploadedArtifact,
  referenceForUploadedArtifact,
};

export async function fileToUploadedArtifact(file: File, scenarioId: ScenarioInstanceId, config: SciForgeConfig, sessionId: string): Promise<RuntimeArtifact> {
  const id = makeId('upload');
  const safeSessionId = safeWorkspaceSegment(sessionId || 'sessionless');
  const safeFileName = safeWorkspaceSegment(file.name) || `${id}.bin`;
  const relativePath = `.sciforge/uploads/${safeSessionId}/${id}-${safeFileName}`;
  const workspaceRoot = config.workspacePath.replace(/\/+$/, '');
  if (!workspaceRoot) throw new Error('上传文件需要先配置 workspacePath。');
  const absolutePath = `${workspaceRoot}/${relativePath}`;
  const bytes = await file.arrayBuffer();
  await writeWorkspaceFile(absolutePath, arrayBufferToBase64(bytes), config, {
    encoding: 'base64',
    mimeType: file.type || 'application/octet-stream',
  });
  return {
    id,
    type: artifactTypeForUploadedFile(file),
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: nowIso(),
      source: 'user-upload',
      storage: 'workspace-file',
      workspacePath: relativePath,
    },
    dataRef: relativePath,
    path: relativePath,
    previewDescriptor: {
      kind: previewKindForUploadedFile(file),
      source: 'path',
      ref: relativePath,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      title: file.name,
      inlinePolicy: uploadedInlinePolicy(file),
      derivatives: uploadedDerivativeHints(file, relativePath),
      actions: uploadedPreviewActions(file),
      locatorHints: uploadedLocatorHints(file),
    },
    data: {
      title: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      path: relativePath,
      previewKind: previewKindForUploadedFile(file),
      storage: 'workspace-file',
    },
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeWorkspaceSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}
