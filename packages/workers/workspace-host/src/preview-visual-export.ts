import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { resolveOpenTargetPath, resolveSafeWorkspaceWriteTarget } from '@sciforge/domain-sdk/node/workspace-paths'
import { visualFrameSchema, type VisualFrame } from '@sciforge/domain-sdk/visual-source'
import type { WorkspacePreviewProviderExportInput, WorkspacePreviewProviderExportResult } from '@sciforge/domain-sdk/workspace-preview'

const frames = new Map<string, VisualFrame>()
const pending = new Map<string, Promise<VisualFrame>>()
let retainedBytes = 0
const MAX_CACHE_BYTES = 64 * 1024 * 1024

/** Cache only immutable rendered bytes, never authorization or destination writes. */
export async function cachedVisualFrame(key: string, render: () => Promise<VisualFrame>): Promise<VisualFrame> {
  const cached = frames.get(key)
  if (cached) {
    frames.delete(key)
    frames.set(key, cached)
    return structuredClone(cached)
  }
  let work = pending.get(key)
  if (!work) {
    work = render().then(value => {
      const frame = visualFrameSchema.parse(value)
      if (frame.bytes.byteLength <= MAX_CACHE_BYTES) {
        while (frames.size && (retainedBytes + frame.bytes.byteLength > MAX_CACHE_BYTES || frames.size >= 32)) {
          const oldest = frames.keys().next().value!
          retainedBytes -= frames.get(oldest)!.bytes.byteLength
          frames.delete(oldest)
        }
        frames.set(key, structuredClone(frame))
        retainedBytes += frame.bytes.byteLength
      }
      return frame
    }).finally(() => { pending.delete(key) })
    pending.set(key, work)
  }
  return structuredClone(await work)
}

/** Canonical visual export used by local and placed preview execution. */
export async function exportWorkspacePreviewVisual(
  input: WorkspacePreviewProviderExportInput,
  render: () => Promise<VisualFrame>
): Promise<WorkspacePreviewProviderExportResult> {
  const { target, file, session, manifest, now } = input
  if (target.kind !== 'workspace-file' || target.format !== 'png' || !target.path || !target.render) {
    throw new Error('Rendered export requires a workspace-file destination path, render parameters and png format.')
  }
  const output = await resolveSafeWorkspaceWriteTarget(target.path, file.workspaceRoot, {
    createParentDirectories: true, targetKind: 'file'
  })
  const sourcePath = await resolveOpenTargetPath(file.path, file.workspaceRoot, { allowBasenameFallback: false })
  const before = await stat(sourcePath)
  const sourceHash = createHash('sha256')
  for await (const chunk of createReadStream(sourcePath)) sourceHash.update(chunk)
  const frame = visualFrameSchema.parse(await render())
  const afterPath = await resolveOpenTargetPath(file.path, file.workspaceRoot, { allowBasenameFallback: false })
  const after = await stat(sourcePath)
  if (sourcePath !== afterPath || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error('Source changed while exporting; reopen it and retry.')
  }
  if (frame.mimeType !== 'image/png') throw new Error('Visual provider did not honor the requested output format.')
  await writeFile(output.path, frame.bytes, { flag: 'wx' })
  return {
    ok: true, sessionId: session.id, path: output.path, target, exportedAt: now,
    visual: {
      sourceSha256: sourceHash.digest('hex'),
      contentCompleteness: 'not-assessed',
      width: frame.width, height: frame.height, sourceRevision: frame.sourceRevision,
      sha256: createHash('sha256').update(frame.bytes).digest('hex'), anchor: frame.anchor
    },
    audit: { pluginId: manifest.id, sourcePath: file.path,
      targetKind: target.kind, format: target.format, effect: 'visual-export' }
  }
}
