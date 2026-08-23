import { z } from 'zod'

import type {
  ContentSpaceAdministrationFeature,
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor,
  ContentSpaceProviderFeatures
} from './provider-features.js'

const nativeDocumentExecuteSchema = z.custom<ContentSpaceNativeDocumentExecutor['execute']>(
  (value) => typeof value === 'function',
  'A native-document executor must be a function.'
)
const nativeDocumentDescribeSchema = z.custom<
  ContentSpaceNativeDocumentExecutor['describeOperations']
>(
  (value) => typeof value === 'function',
  'A native-document operation descriptor must be a function.'
)
const extendedOperationsExecuteSchema = z.custom<ContentSpaceExtendedOperationsExecutor['execute']>(
  (value) => typeof value === 'function',
  'An extended-operations executor must be a function.'
)
const extendedOperationsDescribeSchema = z.custom<
  ContentSpaceExtendedOperationsExecutor['describeOperations']
>(
  (value) => typeof value === 'function',
  'An extended-operations descriptor must be a function.'
)
const administrationBindSchema = z.custom<ContentSpaceAdministrationFeature['bind']>(
  (value) => typeof value === 'function',
  'An administration feature binder must be a function.'
)
const administrationDescribeSchema = z.custom<
  ContentSpaceAdministrationFeature['describeOperations']
>(
  (value) => typeof value === 'function',
  'An administration operation descriptor must be a function.'
)

const nativeDocumentExecutorSchema = z.object({
  describeOperations: nativeDocumentDescribeSchema,
  execute: nativeDocumentExecuteSchema
}).strict().readonly()
const extendedOperationsExecutorSchema = z.object({
  describeOperations: extendedOperationsDescribeSchema,
  execute: extendedOperationsExecuteSchema
}).strict().readonly()
const administrationFeatureSchema = z.object({
  describeOperations: administrationDescribeSchema,
  bind: administrationBindSchema
}).strict().readonly()

export const contentSpaceProviderFeaturesSchema: z.ZodType<ContentSpaceProviderFeatures> = z.object({
  nativeDocuments: nativeDocumentExecutorSchema.optional(),
  extendedOperations: extendedOperationsExecutorSchema.optional(),
  administration: administrationFeatureSchema.optional()
}).strict().readonly()
