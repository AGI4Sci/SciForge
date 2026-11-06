import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { currentUserProfileSchema, type CurrentUserProfile } from
  '@sciforge/domain-identity-access/current-user-profile'

export const COMMENT_IDENTITY_CHANNEL = 'siyuan.comment-identity.read'
export const COMMENT_IDENTITY_PRELOAD = `const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('sciforgeCommentIdentity', {
    version: 1,
    read: () => ipcRenderer.invoke('siyuan.comment-identity.read')
  });
}
`

export async function prepareCommentIdentityPreload(userDataDir: string): Promise<string> {
  const directory = join(userDataDir, 'siyuan-editor')
  await mkdir(directory, { recursive: true })
  const digest = createHash('sha256').update(COMMENT_IDENTITY_PRELOAD).digest('hex').slice(0, 16)
  const file = join(directory, 'comment-identity-' + digest + '.cjs')
  await writeFile(file, COMMENT_IDENTITY_PRELOAD, { mode: 0o600 })
  return file
}

export function isEditorOrigin(url: string, expected: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
      parsed.origin === new URL(expected).origin
  } catch { return false }
}

/** One read-only endpoint, attached to this child view only. No token or generic IPC is exposed. */
export function attachCommentIdentityBridge(page: WebContents, url: () => string,
  read: () => CurrentUserProfile): () => void {
  let active = true
  page.ipc.handle(COMMENT_IDENTITY_CHANNEL, (event) => {
    if (!active || page.isDestroyed() || event.senderFrame !== page.mainFrame ||
        !isEditorOrigin(event.senderFrame.url, url())) return { state: 'unavailable' }
    try { return currentUserProfileSchema.parse(read()) }
    catch { return { state: 'unavailable' } }
  })
  return () => { active = false; if (!page.isDestroyed()) page.ipc.removeHandler(COMMENT_IDENTITY_CHANNEL) }
}
