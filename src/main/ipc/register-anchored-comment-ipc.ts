import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AnchoredCommentFeedbackService } from '../services/anchored-comment-feedback-service'
import type { AnchoredCommentScreenshotService } from '../services/anchored-comment-screenshot-service'
import type { AnchoredCommentService } from '../services/anchored-comment-service'
import { commentScreenshotAssetRefSchema } from '../../shared/anchored-comments'

export const ANCHORED_COMMENT_LIST_CHANNEL = 'anchoredComments:list'
export const ANCHORED_COMMENT_GET_CHANNEL = 'anchoredComments:get'
export const ANCHORED_COMMENT_UPSERT_CHANNEL = 'anchoredComments:upsert'
export const ANCHORED_COMMENT_DELETE_CHANNEL = 'anchoredComments:delete'
export const ANCHORED_COMMENT_READ_ASSET_CHANNEL = 'anchoredComments:asset:read'
export const ANCHORED_COMMENT_CAPTURE_CHANNEL = 'anchoredComments:capture'
export const ANCHORED_COMMENT_FEEDBACK_SUBMIT_CHANNEL = 'anchoredComments:feedback:submit'
export const ANCHORED_COMMENT_FEEDBACK_STATUS_CHANNEL = 'anchoredComments:feedback:status'

export type RegisterAnchoredCommentIpcOptions = {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  comments: Pick<AnchoredCommentService, 'listThreads' | 'getThread' | 'upsertThread' | 'deleteThread' | 'readScreenshotAsset'>
  screenshots: Pick<AnchoredCommentScreenshotService, 'capture'>
  feedback: Pick<AnchoredCommentFeedbackService, 'submit' | 'status'>
}

function assertMainRenderer(event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): void {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('Anchored comment request came from an unauthorized renderer.')
  }
}

export function registerAnchoredCommentIpc(options: RegisterAnchoredCommentIpcOptions): void {
  options.ipcMain.handle(ANCHORED_COMMENT_LIST_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    const filter = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Parameters<AnchoredCommentService['listThreads']>[0]
      : undefined
    return options.comments.listThreads(filter)
  })
  options.ipcMain.handle(ANCHORED_COMMENT_GET_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.comments.getThread(typeof payload === 'string' ? payload : '')
  })
  options.ipcMain.handle(ANCHORED_COMMENT_UPSERT_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.comments.upsertThread(payload as never)
  })
  options.ipcMain.handle(ANCHORED_COMMENT_DELETE_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.comments.deleteThread(typeof payload === 'string' ? payload : '')
  })
  options.ipcMain.handle(ANCHORED_COMMENT_READ_ASSET_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    const asset = commentScreenshotAssetRefSchema.parse(payload)
    const bytes = await options.comments.readScreenshotAsset(asset)
    return {
      digest: asset.digest,
      mimeType: 'image/png' as const,
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
    }
  })
  options.ipcMain.handle(ANCHORED_COMMENT_CAPTURE_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.screenshots.capture(payload)
  })
  options.ipcMain.handle(ANCHORED_COMMENT_FEEDBACK_SUBMIT_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.feedback.submit(payload)
  })
  options.ipcMain.handle(ANCHORED_COMMENT_FEEDBACK_STATUS_CHANNEL, async (event, payload: unknown) => {
    assertMainRenderer(event, options.getMainWindow)
    return options.feedback.status(payload)
  })
}
