import { z } from 'zod'
import { objectReferenceSchema } from '@sciforge/collaboration-contracts'
import { domainCapabilityResourceHandleSchema } from '@sciforge/domain-sdk/renderer-contributions'
import { projectCoordinatorDeliveryReadInputSchema } from './contract.js'

export const DELIVERY_OBJECT_RESOURCE_KIND = 'collaboration.delivery-object'
export const DELIVERY_CONTENT_ACTIONS = Object.freeze({
  open: 'collaboration.delivery-object.open',
  describe: 'collaboration.delivery-object.describe',
  readRange: 'collaboration.delivery-object.read-range'
})
export const deliveryObjectOpenInputSchema = projectCoordinatorDeliveryReadInputSchema.unwrap().extend({
  objectId: objectReferenceSchema.shape.objectId
}).strict().readonly()
export const deliveryObjectOpenOutputSchema = z.object({
  resource: domainCapabilityResourceHandleSchema,
  object: objectReferenceSchema
}).strict().readonly()
export type DeliveryObjectInput = z.infer<typeof deliveryObjectOpenInputSchema>

export const deliveryObjectDescribeInputSchema = z.object({}).strict().readonly()
export const deliveryObjectDescribeOutputSchema = z.object({
  ok: z.literal(true),
  descriptor: z.object({
    file: z.object({ name: z.string(), mimeType: z.string() }).strict(),
    range: z.object({
      available: z.literal(true),
      size: z.number().int().nonnegative(),
      maxChunkBytes: z.number().int().positive(),
      recommendedChunkBytes: z.number().int().positive()
    }).strict()
  }).strict()
}).strict().readonly()
export const deliveryObjectReadRangeInputSchema = z.object({
  range: z.object({
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(1_048_576)
  }).strict()
}).strict().readonly()
export const deliveryObjectReadRangeOutputSchema = z.object({
  ok: z.literal(true),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  dataBase64: z.string()
}).strict().readonly()
export type DeliveryObjectDescribeOutput = z.infer<typeof deliveryObjectDescribeOutputSchema>
export type DeliveryObjectReadRangeInput = z.infer<typeof deliveryObjectReadRangeInputSchema>
export type DeliveryObjectReadRangeOutput = z.infer<typeof deliveryObjectReadRangeOutputSchema>
