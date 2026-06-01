import type { SciForgeReference } from '../../domain';
import { sanitizeRightPanePreviewValue } from './previewSafety';
import {
  sciForgeReferenceAttribute,
  withRegionLocator,
} from '../../../../../packages/support/object-references';

export interface WorkspaceObjectMediaPoint {
  x: number;
  y: number;
}

export interface WorkspaceObjectMediaRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  region: string;
}

export function normalizedWorkspaceObjectMediaRegion(input: {
  start: WorkspaceObjectMediaPoint;
  end: WorkspaceObjectMediaPoint;
  minSize?: number;
}): WorkspaceObjectMediaRegion | undefined {
  const startX = clamp01(input.start.x);
  const startY = clamp01(input.start.y);
  const endX = clamp01(input.end.x);
  const endY = clamp01(input.end.y);
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  const minSize = input.minSize ?? 0.01;
  if (width < minSize || height < minSize) return undefined;
  const region = workspaceObjectMediaRegionLocator({ x, y, width, height });
  return { x, y, width, height, region };
}

export function workspaceObjectMediaRegionLocator(region: Pick<WorkspaceObjectMediaRegion, 'x' | 'y' | 'width' | 'height'>) {
  return `${Math.round(clamp01(region.x) * 1000)},${Math.round(clamp01(region.y) * 1000)},${Math.round(clamp01(region.width) * 1000)},${Math.round(clamp01(region.height) * 1000)}`;
}

export function workspaceObjectMediaRegionStyle(region: Pick<WorkspaceObjectMediaRegion, 'x' | 'y' | 'width' | 'height'>) {
  return {
    left: `${clamp01(region.x) * 100}%`,
    top: `${clamp01(region.y) * 100}%`,
    width: `${clamp01(region.width) * 100}%`,
    height: `${clamp01(region.height) * 100}%`,
  };
}

export function regionReferenceForClipboard(
  reference: SciForgeReference | undefined,
  region: WorkspaceObjectMediaRegion | string | undefined,
): SciForgeReference | undefined {
  if (!reference || !region) return undefined;
  return withRegionLocator(reference, typeof region === 'string' ? region : region.region);
}

export function copyableSciForgeReferenceJson(reference: SciForgeReference | undefined): string | undefined {
  const safeReferenceJson = sciForgeReferenceAttribute(reference);
  if (!safeReferenceJson) return undefined;
  try {
    return JSON.stringify(sanitizeRightPanePreviewValue(JSON.parse(safeReferenceJson)), null, 2);
  } catch {
    return safeReferenceJson;
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
