import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

export type CommentLauncherPoint = {
  x: number
  y: number
}

export type CommentLauncherSize = {
  width: number
  height: number
}

export const COMMENT_LAUNCHER_POSITION_STORAGE_KEY = 'sciforge:comment-launcher-position:v1'

const DEFAULT_VIEWPORT_MARGIN = 12

function isFinitePoint(value: unknown): value is CommentLauncherPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<CommentLauncherPoint>
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function clampCommentLauncherPosition(
  point: CommentLauncherPoint,
  launcher: CommentLauncherSize,
  viewport: CommentLauncherSize,
  margin = DEFAULT_VIEWPORT_MARGIN
): CommentLauncherPoint {
  const maximumX = Math.max(0, viewport.width - launcher.width)
  const maximumY = Math.max(0, viewport.height - launcher.height)
  const insetX = Math.min(Math.max(0, margin), maximumX / 2)
  const insetY = Math.min(Math.max(0, margin), maximumY / 2)

  return {
    x: clamp(point.x, insetX, maximumX - insetX),
    y: clamp(point.y, insetY, maximumY - insetY)
  }
}

export function readCommentLauncherPosition(): CommentLauncherPoint | null {
  const stored = readBrowserStorageItem(COMMENT_LAUNCHER_POSITION_STORAGE_KEY)
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    return isFinitePoint(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeCommentLauncherPosition(point: CommentLauncherPoint): boolean {
  return writeBrowserStorageItem(COMMENT_LAUNCHER_POSITION_STORAGE_KEY, JSON.stringify(point))
}
