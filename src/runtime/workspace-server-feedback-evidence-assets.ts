import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { isRecord, readOptionalJson, safeName } from './server/http.js';
import { gitOutput } from './workspace-server-git.js';
import { numberField, toPosixPath } from './workspace-server-feedback-records.js';

export const REPAIR_EVIDENCE_PUBLIC_DIR = toPosixPath(process.env.SCIFORGE_REPAIR_EVIDENCE_PUBLIC_DIR || 'repair-evidence/public');
export const REPAIR_EVIDENCE_PRIVATE_DIR = toPosixPath(process.env.SCIFORGE_REPAIR_EVIDENCE_PRIVATE_DIR || 'repair-evidence/private');
export const REPAIR_EVIDENCE_PUBLIC_BASE_URL = (process.env.SCIFORGE_REPAIR_EVIDENCE_PUBLIC_BASE_URL || '').trim();

export function firstImageDataUrl(values: unknown[], label: string) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') throw new Error(`${label} data URL must be a string`);
    if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error(`${label} data URL must be a base64 png or jpeg data URL`);
    }
    return value;
  }
  return undefined;
}

export async function persistFeedbackScreenshotEvidenceAssets(
  root: string,
  id: string,
  screenshot: Record<string, unknown> | undefined,
  rawDataUrl: string | undefined,
  annotatedDataUrl: string | undefined,
  createdAt: string,
) {
  const assets: Record<string, unknown>[] = [];
  if (rawDataUrl) {
    const raw = await writeFeedbackEvidenceImageAsset(root, id, rawDataUrl, {
      kind: 'raw-screenshot',
      filenameBase: 'raw',
      label: 'Raw screenshot',
      sourceRef: `${toPosixPath('.sciforge/feedback')}/${id}/raw-screenshot.data-url`,
      width: numberField(screenshot?.width),
      height: numberField(screenshot?.height),
      createdAt,
      visibility: 'private',
      includeForAgent: false,
    });
    assets.push(raw);
  }
  if (annotatedDataUrl) {
    const annotated = await writeFeedbackEvidenceImageAsset(root, id, annotatedDataUrl, {
      kind: 'scrubbed-annotated-screenshot',
      filenameBase: 'scrubbed-annotated',
      label: 'Scrubbed annotated screenshot',
      sourceRef: `${toPosixPath('.sciforge/feedback')}/${id}/annotated-screenshot.data-url`,
      width: numberField(screenshot?.width),
      height: numberField(screenshot?.height),
      createdAt,
      visibility: 'public',
      includeForAgent: false,
      metadata: {
        scrubPolicy: 'Inline data URL omitted from GitHub and public issue bodies; annotated screenshot pixels are retained as captured evidence.',
      },
    });
    assets.push(annotated);
  }
  return assets;
}

async function writeFeedbackEvidenceImageAsset(
  root: string,
  id: string,
  dataUrl: string,
  input: {
    kind: 'raw-screenshot' | 'annotated-screenshot' | 'scrubbed-annotated-screenshot';
    filenameBase: string;
    label: string;
    sourceRef: string;
    width?: number;
    height?: number;
    createdAt: string;
    visibility: 'public' | 'private';
    includeForAgent?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const parsed = parseImageDataUrl(dataUrl, input.label);
  const repoRoot = await gitOutput(root, ['rev-parse', '--show-toplevel']) || root;
  const relativeRef = repairEvidenceRelativeRef(input.visibility, id, `${input.filenameBase}.${parsed.extension}`);
  const assetPath = resolve(repoRoot, relativeRef);
  const rel = relative(repoRoot, assetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('feedback evidence asset path escaped repo root');
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, parsed.bytes);
  const sha256 = createHash('sha256').update(parsed.bytes).digest('hex');
  const manifestPath = resolve(repoRoot, repairEvidenceRelativeRef(input.visibility, id, `${input.filenameBase}.manifest.json`));
  const publicUrl = input.visibility === 'public' ? repairEvidencePublicUrl(relativeRef) : undefined;
  const uploadStatus = input.visibility === 'public'
    ? publicUrl
      ? 'ready'
      : 'local'
    : 'private';
  const manifest = {
    schemaVersion: 1,
    id: `feedback-evidence-${id}-${input.filenameBase}`,
    feedbackId: id,
    kind: input.kind,
    ref: toPosixPath(relativeRef),
    sourceRef: toPosixPath(input.sourceRef),
    mediaType: parsed.mediaType,
    width: input.width,
    height: input.height,
    bytes: parsed.bytes.length,
    sha256,
    createdAt: input.createdAt,
    localOnly: input.visibility !== 'public',
    visibility: input.visibility,
    uploadStatus,
    publicUrl,
    includeForAgent: input.includeForAgent === true,
    metadata: input.metadata,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeRepairEvidenceIndex(repoRoot, id, input.visibility, manifest);
  return {
    schemaVersion: 1,
    id: manifest.id,
    kind: input.kind,
    label: input.label,
    ref: toPosixPath(relativeRef),
    sourceRef: toPosixPath(input.sourceRef),
    localRef: toPosixPath(relativeRef),
    markdownImageUrl: publicUrl || toPosixPath(relativeRef),
    githubMarkdownUrl: publicUrl || toPosixPath(relativeRef),
    mediaType: parsed.mediaType,
    width: input.width,
    height: input.height,
    bytes: parsed.bytes.length,
    sha256,
    createdAt: input.createdAt,
    localOnly: input.visibility !== 'public',
    visibility: input.visibility,
    uploadStatus,
    publicUrl,
    includeForAgent: input.includeForAgent === true,
    metadata: {
      ...(input.metadata ?? {}),
      manifestRef: toPosixPath(relative(repoRoot, manifestPath)),
    },
  };
}

export function repairEvidenceRelativeRef(visibility: 'public' | 'private', feedbackId: string, filename: string) {
  const base = visibility === 'public' ? REPAIR_EVIDENCE_PUBLIC_DIR : REPAIR_EVIDENCE_PRIVATE_DIR;
  return `${base}/feedback-screenshots/${safeName(feedbackId)}/${safeName(filename)}`;
}

export function isRepairEvidenceRef(value: string) {
  const normalized = toPosixPath(value.trim().replace(/^(file|path|artifact):/i, ''));
  return normalized.startsWith(`${REPAIR_EVIDENCE_PUBLIC_DIR}/`)
    || normalized.startsWith(`${REPAIR_EVIDENCE_PRIVATE_DIR}/`)
    || normalized.startsWith('repair-evidence/');
}

export function repairEvidencePublicUrl(relativeRef: string) {
  if (!REPAIR_EVIDENCE_PUBLIC_BASE_URL) return undefined;
  return `${REPAIR_EVIDENCE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${toPosixPath(relativeRef).replace(/^\/+/, '')}`;
}

async function writeRepairEvidenceIndex(repoRoot: string, feedbackId: string, visibility: 'public' | 'private', manifest: Record<string, unknown>) {
  const indexRef = repairEvidenceRelativeRef(visibility, feedbackId, 'index.json');
  const indexPath = resolve(repoRoot, indexRef);
  const existing = await readOptionalJson(indexPath).catch(() => undefined);
  const existingAssets = isRecord(existing) && Array.isArray(existing.assets) ? existing.assets.filter(isRecord) : [];
  const assets = mergeEvidenceAssets(existingAssets, [manifest]);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    feedbackId,
    visibility,
    folderRef: toPosixPath(dirname(indexRef)),
    assets,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

export function mergeEvidenceAssets(existing: Record<string, unknown>[], next: Record<string, unknown>[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const asset of [...existing, ...next]) {
    const id = typeof asset.id === 'string' && asset.id.trim()
      ? asset.id.trim()
      : typeof asset.ref === 'string' && asset.ref.trim()
        ? asset.ref.trim()
        : '';
    if (id) byId.set(id, asset);
  }
  return [...byId.values()];
}

function parseImageDataUrl(dataUrl: string, label: string) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error(`${label} data URL must be a base64 png or jpeg data URL`);
  const mediaType = match[1] as 'image/png' | 'image/jpeg';
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error(`${label} data URL decoded to an empty image`);
  return {
    mediaType,
    extension: mediaType === 'image/png' ? 'png' : 'jpg',
    bytes,
  };
}
