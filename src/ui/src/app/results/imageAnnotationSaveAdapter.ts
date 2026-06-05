import type { SciForgeConfig } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import { writeWorkspaceFile } from '../../api/workspaceClient';
import type { ImageEvidencePayload } from './imagePaneModel';

export const IMAGE_ANNOTATION_ARTIFACT_SCHEMA = 'sciforge.image-annotation.v1';

export interface ImageAnnotationSize {
  width: number;
  height: number;
}

export interface ImageAnnotationCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SaveImageAnnotationArtifactInput {
  sessionId: string;
  sourceRef: string;
  sourceNaturalSize: ImageAnnotationSize;
  crop?: ImageAnnotationCrop | null;
  annotations: readonly unknown[];
  exportSize: ImageAnnotationSize;
  pngBase64: string;
  workspaceConfig: SciForgeConfig;
}

export interface SaveImageAnnotationArtifactDeps {
  id?: () => string;
  now?: () => Date;
  writeWorkspaceFile?: (
    path: string,
    content: string,
    config: SciForgeConfig,
    options?: { encoding?: 'utf8' | 'base64'; mimeType?: string },
  ) => Promise<WorkspaceFileContent>;
}

export async function saveImageAnnotationArtifact(
  input: SaveImageAnnotationArtifactInput,
  deps: SaveImageAnnotationArtifactDeps = {},
): Promise<ImageEvidencePayload> {
  const writer = deps.writeWorkspaceFile ?? writeWorkspaceFile;
  const createdAtDate = deps.now?.() ?? new Date();
  const createdAt = createdAtDate.toISOString();
  const stamp = timestampPathToken(createdAtDate);
  const editToken = safePathToken(deps.id?.() ?? defaultEditId(), 'edit');
  const sessionToken = safePathToken(input.sessionId, 'session');
  const artifactId = `image-edit-${stamp}-${editToken}`;
  const artifactFolder = `.sciforge/artifacts/${sessionToken}/${artifactId}`;
  const imagePath = `${artifactFolder}/image.png`;
  const annotationPath = `${artifactFolder}/annotation.json`;
  const exportSize = { width: input.exportSize.width, height: input.exportSize.height };

  await writer(imagePath, input.pngBase64, input.workspaceConfig, {
    encoding: 'base64',
    mimeType: 'image/png',
  });

  const annotationDocument = {
    schema: IMAGE_ANNOTATION_ARTIFACT_SCHEMA,
    sourceRef: input.sourceRef,
    sourceNaturalSize: {
      width: input.sourceNaturalSize.width,
      height: input.sourceNaturalSize.height,
    },
    annotations: [...input.annotations],
    export: { format: 'png', ...exportSize },
    createdAt,
    exportedImageRef: imagePath,
  };
  if (input.crop) {
    Object.assign(annotationDocument, {
      crop: { x: input.crop.x, y: input.crop.y, width: input.crop.width, height: input.crop.height },
    });
  }

  await writer(annotationPath, `${JSON.stringify(annotationDocument, null, 2)}\n`, input.workspaceConfig, {
    encoding: 'utf8',
    mimeType: 'application/json',
  });

  return {
    sourceKind: 'artifact',
    imageRef: imagePath,
    ref: imagePath,
    mime: 'image/png',
    width: exportSize.width,
    height: exportSize.height,
    createdAt,
    provenanceRef: annotationPath,
    annotationRefs: [annotationPath],
    artifactRef: `artifact:${artifactId}`,
  };
}

function timestampPathToken(value: Date): string {
  return value.toISOString().replace(/[-:.]/g, '');
}

function safePathToken(value: string, fallback: string): string {
  const safe = value
    .trim()
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return safe || fallback;
}

function defaultEditId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
