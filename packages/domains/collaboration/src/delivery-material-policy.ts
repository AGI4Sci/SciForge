import {
  WORKSPACE_ATTACHMENT_ACCEPT,
  workspaceAttachmentKind, workspaceAttachmentMaxBytes, workspaceAttachmentMediaType,
  validateWorkspaceAttachmentBytes, type WorkspaceAttachmentKind
} from '@sciforge/domain-sdk/attachment-policy'

import { DELIVERY_MAX_FILE_BYTES, DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES } from '@sciforge/collaboration-contracts'

// Delivery archives are copied and sealed as opaque bytes; never extracted or executed.
export const DELIVERY_MATERIAL_ACCEPT = `${WORKSPACE_ATTACHMENT_ACCEPT},.zip,application/zip`
export const DELIVERY_ADDITIONAL_MATERIAL_ACCEPT = WORKSPACE_ATTACHMENT_ACCEPT

/** Cloud member outputs use the shared attachment policy; only declared outputs may be ZIP. */
export function additionalDeliveryMaterialKind(file: Readonly<{ name: string; type?: string }>): WorkspaceAttachmentKind {
  return workspaceAttachmentKind(file)
}
type DeliveryMaterialKind = WorkspaceAttachmentKind | 'zip'

export function deliveryMaterialKind(file: Readonly<{ name: string }>): DeliveryMaterialKind {
  return file.name.toLowerCase().endsWith('.zip') ? 'zip' : workspaceAttachmentKind(file)
}

export function deliveryMaterialMaxBytes(kind: DeliveryMaterialKind): number {
  return kind === 'zip' ? DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES : workspaceAttachmentMaxBytes(kind)
}

/** Task declarations cannot expand the delivery bundle's local admission budget. */
export function deliveryOutputMaxBytes(declaredMaxBytes: number): number {
  return Math.min(declaredMaxBytes, DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES)
}

export function deliveryMaterialMediaType(file: Readonly<{ name: string }>): string {
  return deliveryMaterialKind(file) === 'zip' ? 'application/zip' : workspaceAttachmentMediaType(file)
}

/** One admission rule for listing, selection and final reads. Declared outputs
 * retain their explicit task contract instead of inheriting Session import caps. */
export function deliveryMaterialAdmissionError(file: Readonly<{ name: string; byteCount: number }>, declared: Readonly<{ mediaType?: string; maxBytes: number }> | null): string | null {
  const kind = declared ? deliveryMaterialKind(file) : additionalDeliveryMaterialKind(file)
  if (!declared && kind === 'unsupported') return '附加文件类型不符合附件要求；ZIP 仅可作为任务声明的必交文件。'
  if (declared?.mediaType && deliveryMaterialMediaType(file) !== declared.mediaType) return `必交文件需要 ${declared.mediaType} 格式。`
  if (declared && file.byteCount === 0) return '必交文件不能为空。'
  const max = declared ? deliveryOutputMaxBytes(declared.maxBytes) : deliveryMaterialMaxBytes(kind)
  return file.byteCount > max ? `文件大小不符合要求（有效上限 ${max} 字节）。` : null
}

/** Check ZIP directory/local-record bounds without inflating any entry. */
export function validateDeliveryMaterialBytes(file: Readonly<{ name: string }>, bytes: Uint8Array): void {
  if (deliveryMaterialKind(file) !== 'zip') return validateWorkspaceAttachmentBytes(file, bytes)
  if (bytes.length > DELIVERY_MAX_FILE_BYTES) throw new Error('ZIP 文件超过资料大小限制。')
  const invalid = (): never => { throw new Error('ZIP 文件结构不完整或不符合格式要求。') }
  if (bytes.length < 22) invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) invalid()
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  const start = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || start + size !== end) invalid()
  let offset = start
  const localRecords: Array<{ start: number; end: number }> = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) invalid()
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if (next > end || compressed === 0xffffffff || uncompressed === 0xffffffff || view.getUint16(offset + 34, true) || local + 30 > start || view.getUint32(local, true) !== 0x04034b50) invalid()
    const localNameLength = view.getUint16(local + 26, true)
    const data = local + 30 + localNameLength + view.getUint16(local + 28, true)
    if (localNameLength !== nameLength || data + compressed > start || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) invalid()
    if (method === 0 && compressed !== uncompressed) invalid()
    const localCrc = view.getUint32(local + 14, true)
    const localCompressed = view.getUint32(local + 18, true)
    const localUncompressed = view.getUint32(local + 22, true)
    let recordEnd = data + compressed
    if (flags & 8) {
      if ((localCrc !== 0 && localCrc !== crc) || (localCompressed !== 0 && localCompressed !== compressed) || (localUncompressed !== 0 && localUncompressed !== uncompressed)) invalid()
      // A descriptor immediately follows the compressed data. Compare recorded
      // CRC fields only: opaque payloads are never inflated or content-CRC checked.
      const descriptorMatches = (at: number): boolean => at + 12 <= start &&
        view.getUint32(at, true) === crc && view.getUint32(at + 4, true) === compressed && view.getUint32(at + 8, true) === uncompressed
      if (recordEnd + 16 <= start && view.getUint32(recordEnd, true) === 0x08074b50 && descriptorMatches(recordEnd + 4)) recordEnd += 16
      else if (descriptorMatches(recordEnd)) recordEnd += 12
      else invalid()
    } else if (localCrc !== crc || localCompressed !== compressed || localUncompressed !== uncompressed) invalid()
    for (let index = 0; index < nameLength; index++) if (bytes[local + 30 + index] !== bytes[offset + 46 + index]) invalid()
    localRecords.push({ start: local, end: recordEnd })
    offset = next
  }
  localRecords.sort((left, right) => left.start - right.start)
  for (let index = 1; index < localRecords.length; index++) if (localRecords[index - 1]!.end > localRecords[index]!.start) invalid()
  if (offset !== end || !count && start !== 0) invalid()
}
