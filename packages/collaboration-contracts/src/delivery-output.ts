import { isPortableWorkspacePathSegment, portableWorkspacePathComparisonKey } from '@sciforge/domain-sdk/file-transfer-portability'
import { z } from 'zod'

import { objectIdSchema, sha256Schema } from './core.js'

export const DELIVERY_MAX_FILE_COUNT = 20
export const DELIVERY_MAX_TOTAL_BYTES = 200 * 1024 * 1024

const deliveryFileNameSchema = z.string().min(1).max(255)
  .refine((value) => value === value.trim() && isPortableWorkspacePathSegment(value),
    'Delivery filenames must be canonical portable path components.')

/** Workspace-relative POSIX paths preserve the selected file identity across platforms. */
export const deliveryRelativePathSchema = z.string().min(1).max(1_024)
  .refine((value) => value.split('/').every((segment) => deliveryFileNameSchema.safeParse(segment).success),
    'Delivery paths must contain only canonical portable relative path components.')

export const deliveryOutputDescriptorSchema = z.object({
  fileName: deliveryFileNameSchema,
  relativePath: deliveryRelativePathSchema,
  role: z.enum(['declared', 'member']),
  source: z.enum(['ai', 'member', 'attachment']),
  mediaType: z.string().trim().min(1).max(255),
  byteCount: z.number().int().nonnegative().max(DELIVERY_MAX_TOTAL_BYTES),
  sha256: sha256Schema
}).strict().superRefine((output, context) => {
  if (output.role === 'declared' && output.source !== 'ai') {
    context.addIssue({ code: 'custom', path: ['source'], message: 'A declared Task output must retain its AI provenance.' })
  }
})
export type DeliveryOutputDescriptor = z.infer<typeof deliveryOutputDescriptorSchema>

function validateDeliveryOutputs(outputs: readonly DeliveryOutputDescriptor[], context: z.RefinementCtx): void {
  const paths = outputs.map(({ relativePath }) => portableWorkspacePathComparisonKey(relativePath))
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: 'custom', message: 'Delivery output paths must be unique on portable filesystems.' })
  }
  if (outputs.reduce((total, { byteCount }) => total + byteCount, 0) > DELIVERY_MAX_TOTAL_BYTES) {
    context.addIssue({ code: 'custom', message: 'Delivery output bytes exceed the 200 MiB bundle limit.' })
  }
}

export const deliveryOutputsSchema = z.array(deliveryOutputDescriptorSchema).max(DELIVERY_MAX_FILE_COUNT)
  .superRefine(validateDeliveryOutputs)

/** Descriptors become Cloud facts only after the authority verifies the frozen bundle bytes. */
export const deliveryManifestOutputSchema = deliveryOutputDescriptorSchema.safeExtend({ objectId: objectIdSchema })
export type DeliveryManifestOutput = z.infer<typeof deliveryManifestOutputSchema>
export const deliveryManifestOutputsSchema = z.array(deliveryManifestOutputSchema).max(DELIVERY_MAX_FILE_COUNT)
  .superRefine((outputs, context) => {
    validateDeliveryOutputs(outputs, context)
    if (new Set(outputs.map(({ objectId }) => objectId)).size !== outputs.length) {
      context.addIssue({ code: 'custom', message: 'Every Delivery file must identify a distinct Cloud object.' })
    }
  })
