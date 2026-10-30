import { copyJsonMetadataFields } from '../lib/json-metadata'
import type { RuntimeDisclosureMetadata } from './types'

const normalizedDisclosureKeys = [
  'displayText', 'source', 'sourceLabel', 'attachmentIds', 'attachments', 'generatedFiles',
  'activeSkillIds', 'injectedMemoryIds', 'skillInjectionBytes', 'child', 'sources', 'reasoning',
  'approval', 'scientificObjects', 'scientificObjectComparisons', 'workspaceObservations',
  // These inputs are already normalized by the existing disclosure projector.
  'generatedImages', 'images', 'scientific_objects', 'scientific_object_comparisons', 'workspace_observations'
] as const

/** Existing typed disclosure normalization stays authoritative; other JSON facts remain available to packages. */
export function preserveMessageMetadata(
  original: Record<string, unknown>,
  normalized: RuntimeDisclosureMetadata
): RuntimeDisclosureMetadata | undefined {
  const fields = copyJsonMetadataFields(original) ?? {}
  for (const key of normalizedDisclosureKeys) delete fields[key]
  const result = { ...fields, ...normalized }
  return Object.keys(result).length ? result : undefined
}
