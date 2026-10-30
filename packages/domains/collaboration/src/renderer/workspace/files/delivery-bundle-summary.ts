import { frozenDeliveryBundleHistorySchema, type DeliveryManifest } from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorRendererClient } from '../../../coordinator/renderer/project-coordinator-capability-client.js'

const MAX_BUNDLE_METADATA_BYTES = 256 * 1024

/** Read only the sealed domain metadata. File previews belong to the generic Host. */
export async function readSealedDeliverySummary(
  reader: Pick<ProjectCoordinatorRendererClient, 'openDeliveryObject' | 'describeDeliveryObject' | 'readDeliveryObjectRange'>,
  manifest: DeliveryManifest
): Promise<string> {
  const expected = manifest.objects.find((object) => object.objectId === manifest.bundleObjectId)
  if (!expected || expected.byteCount > MAX_BUNDLE_METADATA_BYTES) throw new Error('交付说明大小或对象不符合要求。')
  const opened = await reader.openDeliveryObject({ deliveryManifestId: manifest.deliveryManifestId, objectId: expected.objectId })
  if (opened.object.objectId !== expected.objectId || opened.object.projectId !== expected.projectId || opened.object.sha256 !== expected.sha256 ||
      opened.object.byteCount !== expected.byteCount || opened.object.mediaType !== expected.mediaType || opened.object.revision !== expected.revision) throw new Error('交付说明与封存对象不一致。')
  const described = await reader.describeDeliveryObject(opened.resource)
  if (described.descriptor.range.size !== expected.byteCount) throw new Error('交付说明大小已变化。')
  const bytes = new Uint8Array(expected.byteCount)
  let offset = 0
  while (offset < bytes.length) {
    const length = Math.min(bytes.length - offset, described.descriptor.range.maxChunkBytes)
    const piece = await reader.readDeliveryObjectRange(opened.resource, { range: { offset, length } })
    const binary = globalThis.atob(piece.dataBase64)
    if (binary.length !== length) throw new Error('交付说明读取不完整。')
    for (let index = 0; index < binary.length; index += 1) bytes[offset + index] = binary.charCodeAt(index)
    offset += length
  }
  const parsed = frozenDeliveryBundleHistorySchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (parsed.projectId !== manifest.projectId || parsed.taskId !== manifest.taskId || parsed.executionId !== manifest.executionId || parsed.resultRevision !== manifest.resultRevision) throw new Error('交付说明与已提交快照不一致。')
  return parsed.summary
}
