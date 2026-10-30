import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import {
  DELIVERY_MAX_FILE_COUNT, DELIVERY_MAX_TOTAL_BYTES, deliveryRelativePathSchema,
  type DeliveryOutputDescriptor
} from '@sciforge/collaboration-contracts'
import { workspaceAttachmentKind, workspaceAttachmentMaxBytes, workspaceAttachmentMediaType, workspaceAttachmentDisplayName, workspaceAttachmentSessionDirectory } from '@sciforge/domain-sdk/attachment-policy'
import { portableWorkspacePathComparisonKey } from '@sciforge/domain-sdk/file-transfer-portability'
import type {
  WorkerDeliverySelectedMaterial, WorkerDeliveryMaterialsResult
} from '../worker-delivery.js'

const LIST_MAX_ENTRIES = 10_000
const LIST_MAX_DEPTH = 16

type MaterialContext = Readonly<{
  workspaceRoot: string
  threadId: string | null
  selectedMaterials: readonly WorkerDeliverySelectedMaterial[]
  declared: Readonly<{ fileName: string; mediaType: string; maxBytes: number }> | null
}>
export type ReadDeliveryMaterial = Readonly<{ metadata: DeliveryOutputDescriptor; bytes: Buffer }>

function materialLabel(relativePath: string): string {
  return relativePath.startsWith('.sciforge/uploads/') ? workspaceAttachmentDisplayName(relativePath) : relativePath
}

function materialPath(context: MaterialContext, raw: string): string {
  const uploads = context.threadId ? workspaceAttachmentSessionDirectory(context.threadId) : null
  if (!deliveryRelativePathSchema.safeParse(raw).success) throw new Error('文件路径不符合任务目录要求。')
  if (raw.split('/').includes('.git')) throw new Error('不能提交内部目录。')
  if (raw.startsWith('.sciforge/') && (!uploads || raw !== uploads && !raw.startsWith(`${uploads}/`))) {
    throw new Error('文件路径必须属于本次任务会话，不能选择内部交付目录。')
  }
  return raw
}

export type DeliveryWorkspaceIdentity = Readonly<{ path: string; dev: number; ino: number }>

export async function readDeliveryWorkspaceIdentity(workspaceRoot: string, expected?: DeliveryWorkspaceIdentity): Promise<DeliveryWorkspaceIdentity> {
  const info = await lstat(workspaceRoot).catch((cause: unknown) => {
    throw new Error('任务工作目录不可用，请重新打开任务会话。', { cause })
  })
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('任务工作目录不能是符号链接。')
  const path = await realpath(workspaceRoot).catch((cause: unknown) => { throw new Error('任务工作目录有新改动，请重新打开任务会话。', { cause }) })
  if (expected && (path !== expected.path || info.dev !== expected.dev || info.ino !== expected.ino)) {
    throw new Error('任务工作目录有新改动，请预览后再次提交。')
  }
  return { path, dev: info.dev, ino: info.ino }
}

async function safePath(context: MaterialContext, raw: string, expected: DeliveryWorkspaceIdentity): Promise<string> {
  const path = materialPath(context, raw)
  const root = (await readDeliveryWorkspaceIdentity(context.workspaceRoot, expected)).path
  let current = root
  for (const part of path.split('/')) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error(`文件 ${materialLabel(raw)} 含符号链接，不能提交。`)
  }
  const within = relative(root, current)
  if (await realpath(current) !== current || within === '..' || within.startsWith(`..${sep}`)) {
    throw new Error('文件路径超出任务目录。')
  }
  return current
}

function materialSource(context: MaterialContext, selection: WorkerDeliverySelectedMaterial): 'member' | 'attachment' {
  const uploads = context.threadId ? workspaceAttachmentSessionDirectory(context.threadId) : null
  const attachment = uploads && selection.relativePath.startsWith(`${uploads}/`)
  if (selection.source === 'attachment' && !attachment) throw new Error('会话附件必须位于本次会话附件目录。')
  return selection.source ?? (attachment ? 'attachment' : 'member')
}

/** Validate every bound before allocating content; only explicitly selected bytes are read. */
export async function readDeliveryMaterials(context: MaterialContext, expectedRoot?: DeliveryWorkspaceIdentity): Promise<ReadDeliveryMaterial[]> {
  const root = await readDeliveryWorkspaceIdentity(context.workspaceRoot, expectedRoot)
  const entries = [
    ...(context.declared ? [{ relativePath: context.declared.fileName, declared: context.declared }] : []),
    ...context.selectedMaterials.map((selection) => ({ relativePath: selection.relativePath, selection }))
  ]
  if (entries.length > DELIVERY_MAX_FILE_COUNT) throw new Error(`最多提交 ${DELIVERY_MAX_FILE_COUNT} 项文件。`)
  const seen = new Set<string>()
  let total = 0
  const checked = []
  for (const entry of entries) {
    const comparison = portableWorkspacePathComparisonKey(entry.relativePath)
    if (seen.has(comparison)) throw new Error(`文件 ${materialLabel(entry.relativePath)} 重复或属于必交产出。`)
    seen.add(comparison)
    const path = await safePath(context, entry.relativePath, root).catch((cause: unknown) => {
      throw new Error(`文件 ${materialLabel(entry.relativePath)} 不可用，请确认位于任务目录且不是符号链接。`, { cause })
    })
    const info = await lstat(path).catch((cause: unknown) => { throw new Error(`文件 ${materialLabel(entry.relativePath)} 不可用，请重新选择。`, { cause }) })
    const declared = 'declared' in entry ? entry.declared : undefined
    const kind = workspaceAttachmentKind({ name: basename(entry.relativePath) })
    if (!declared && kind === 'unsupported') throw new Error(`文件 ${materialLabel(entry.relativePath)} 的类型暂不支持，请选择支持的资料格式。`)
    const max = declared?.maxBytes ?? workspaceAttachmentMaxBytes(kind)
    if (!info.isFile()) throw new Error(`文件 ${materialLabel(entry.relativePath)} 不是可提交文件。`)
    if (info.size > max || declared && info.size === 0) {
      throw new Error(`文件 ${materialLabel(entry.relativePath)} 大小不符合要求（上限 ${max / 1024 / 1024} MB）。`)
    }
    total += info.size
    if (total > DELIVERY_MAX_TOTAL_BYTES) throw new Error(`文件 ${materialLabel(entry.relativePath)} 使提交内容超过 200 MB。`)
    checked.push({ entry, path, info, declared })
  }
  const result: ReadDeliveryMaterial[] = []
  for (const { entry, path, info, declared } of checked) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((cause: unknown) => {
      throw new Error(`文件 ${materialLabel(entry.relativePath)} 不可用或有新改动，请预览后再次提交。`, { cause })
    })
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size !== info.size || before.ino !== info.ino || before.dev !== info.dev || before.mtimeMs !== info.mtimeMs) {
        throw new Error(`文件 ${materialLabel(entry.relativePath)} 有新改动，请预览后再次提交。`)
      }
      const bytes = Buffer.alloc(before.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) throw new Error(`文件 ${materialLabel(entry.relativePath)} 有新改动，请预览后再次提交。`)
        offset += read.bytesRead
      }
      const after = await handle.stat()
      const currentPath = await safePath(context, entry.relativePath, root)
      const current = await lstat(currentPath)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
          before.ino !== current.ino || before.dev !== current.dev || before.size !== current.size) {
        throw new Error(`文件 ${materialLabel(entry.relativePath)} 有新改动，请预览后再次提交。`)
      }
      result.push({ bytes, metadata: {
        fileName: workspaceAttachmentDisplayName(entry.relativePath), relativePath: entry.relativePath,
        role: declared ? 'declared' : 'member',
        source: declared ? 'ai' : materialSource(context, 'selection' in entry ? entry.selection : { relativePath: entry.relativePath }),
        mediaType: declared?.mediaType ?? workspaceAttachmentMediaType({ name: basename(entry.relativePath) }), byteCount: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      } })
    } catch (cause) {
      throw new Error(`文件 ${materialLabel(entry.relativePath)} 不可用或有新改动，请预览后再次提交。`, { cause })
    } finally { await handle.close() }
  }
  return result
}

/** Bounded metadata-only enumeration; upload files from this Session precede ordinary files. */
export async function listDeliveryMaterials(context: MaterialContext, input: Readonly<{
  cursor?: string; query?: string; limit?: number
}>): Promise<WorkerDeliveryMaterialsResult> {
  const root = await readDeliveryWorkspaceIdentity(context.workspaceRoot)
  const files: WorkerDeliveryMaterialsResult['files'] = []
  const uploads = context.threadId ? workspaceAttachmentSessionDirectory(context.threadId) : null
  const queue = [...(uploads && await safePath(context, uploads, root).then(() => true, () => false) ? [uploads] : []), '']
  let scanned = 0
  let truncated = false
  while (queue.length && !truncated) {
    const directory = queue.shift()!
    const path = directory ? await safePath(context, directory, root) : (await readDeliveryWorkspaceIdentity(context.workspaceRoot, root)).path
    const stream = await opendir(path)
    try {
      for await (const entry of stream) {
        if (++scanned > LIST_MAX_ENTRIES) { truncated = true; break }
        if (entry.isSymbolicLink()) continue
        const relativePath = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (entry.name === '.git') continue
          if (relativePath === '.sciforge') continue
          if (relativePath.split('/').length < LIST_MAX_DEPTH) queue.push(relativePath)
          else truncated = true
          continue
        }
        if (!entry.isFile() || !deliveryRelativePathSchema.safeParse(relativePath).success) continue
        if (input.query && !relativePath.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) continue
        try {
          const path = await safePath(context, relativePath, root)
          const info = await lstat(path)
          files.push({ relativePath, fileName: workspaceAttachmentDisplayName(relativePath), byteCount: info.size,
            mediaType: context.declared?.fileName === relativePath ? context.declared.mediaType : workspaceAttachmentMediaType({ name: basename(relativePath) }),
            source: context.declared?.fileName === relativePath ? 'ai' : materialSource(context,
              context.selectedMaterials.find((selection) => selection.relativePath === relativePath) ?? { relativePath }) })
        } catch { /* A concurrent removal cannot make a file selectable. */ }
      }
    } finally { await stream.close().catch(() => undefined) }
  }
  await readDeliveryWorkspaceIdentity(context.workspaceRoot, root)
  files.sort((a, b) => Number(b.source === 'attachment') - Number(a.source === 'attachment') || a.relativePath.localeCompare(b.relativePath))
  const cursor = Number(input.cursor ?? 0)
  const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
  const end = Math.min(start + Math.min(input.limit ?? 100, 100), files.length)
  return { files: files.slice(start, end), nextCursor: end < files.length ? String(end) : null, truncated }
}
