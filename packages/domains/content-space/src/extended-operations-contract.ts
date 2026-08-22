import { z } from 'zod'

import {
  domainFileTransferHandleSchema,
  domainWorkspaceRelativePathSchema
} from '@sciforge/domain-sdk/host'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import {
  artifactDigestSchema,
  artifactReferenceSchema,
  contentContainerReferenceSchema,
  contentSpaceDirectoryDepartmentReferenceSchema,
  contentSpaceDirectoryGroupReferenceSchema,
  contentSpaceDirectoryPrincipalReferenceSchema,
  contentSpaceDirectoryPositionReferenceSchema,
  contentSpaceDirectoryUserReferenceSchema,
  contentEntryReferenceSchema,
  contentFileReferenceSchema,
  contentSpaceEntryNameSchema,
  contentSpacePageRequestSchema
} from './contract.js'

export const CONTENT_SPACE_EXTENDED_CONTRACT_VERSION = '2.0.0' as const

const boundedLabelSchema = z.string().trim().min(1).max(256)
const boundedDescriptionSchema = z.string().trim().min(1).max(2_048)
const extendedOpaqueIdSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Identifiers must be canonical.')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'Use an opaque provider-neutral identifier.')
  .refine((value) => !/^(?:res|cap|conn(?:ection)?|xfer|portal)_/iu.test(value), {
    message: 'Local handles are not durable Content Space identities.'
  })

export const contentSpaceExtendedErrorCodeSchema = z.enum([
  'invalid_input',
  'invalid_reference',
  'invalid_target',
  'not_found',
  'already_exists',
  'conflict',
  'precondition_failed',
  'unauthorized',
  'blocked_by_contract',
  'unsupported',
  'provider_unavailable',
  'rate_limited',
  'provider_contract_violation',
  'bounds_exceeded',
  'outcome_unknown',
  'cancelled',
  'source_unavailable',
  'destination_unavailable'
])

export const contentSpaceExtendedErrorSchema = z.object({
  code: contentSpaceExtendedErrorCodeSchema,
  message: z.string().trim().min(1).max(256),
  retry: z.enum(['never', 'after-human-action', 'safe-with-same-invocation'])
}).strict().superRefine((error, context) => {
  if (error.code === 'outcome_unknown' && error.retry !== 'never') {
    context.addIssue({
      code: 'custom',
      path: ['retry'],
      message: 'Unknown write outcomes must not be retried automatically.'
    })
  }
}).readonly()

export type ContentSpaceExtendedErrorCode = z.infer<typeof contentSpaceExtendedErrorCodeSchema>
export type ContentSpaceExtendedError = z.infer<typeof contentSpaceExtendedErrorSchema>
export type ContentSpaceExtendedResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ContentSpaceExtendedError }>

export function contentSpaceExtendedResultSchema<ValueSchema extends z.ZodType>(
  valueSchema: ValueSchema
) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), error: contentSpaceExtendedErrorSchema }).strict()
  ]).readonly()
}

export const contentSpaceExtendedEntryKindSchema = z.enum(['container', 'file'])
export const contentSpaceMutableEntryReferenceSchema = z.union([
  contentContainerReferenceSchema,
  contentFileReferenceSchema
])

const contentSpaceDirectoryPrincipalSummaryShape = Object.freeze({
  displayName: boundedLabelSchema,
  accountName: z.string().trim().min(1).max(256).optional(),
  departmentName: boundedLabelSchema.optional(),
  positionName: boundedLabelSchema.optional()
})
function directoryPrincipalSummarySchema<ReferenceSchema extends z.ZodType>(
  reference: ReferenceSchema
) {
  return z.object({
    reference,
    ...contentSpaceDirectoryPrincipalSummaryShape
  }).strict().readonly()
}
export const contentSpaceDirectoryPrincipalSummarySchema =
  directoryPrincipalSummarySchema(contentSpaceDirectoryPrincipalReferenceSchema)
export const contentSpaceDirectoryUserSummarySchema =
  directoryPrincipalSummarySchema(contentSpaceDirectoryUserReferenceSchema)
export const contentSpaceDirectoryDepartmentSummarySchema =
  directoryPrincipalSummarySchema(contentSpaceDirectoryDepartmentReferenceSchema)
export const contentSpaceDirectoryPositionSummarySchema =
  directoryPrincipalSummarySchema(contentSpaceDirectoryPositionReferenceSchema)
export const contentSpaceDirectoryGroupSummarySchema =
  directoryPrincipalSummarySchema(contentSpaceDirectoryGroupReferenceSchema)

const contentSpaceTimestampRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((range, context) => {
  if (range.from === undefined && range.to === undefined) {
    context.addIssue({ code: 'custom', message: 'A time range requires at least one bound.' })
  }
  if (range.from && range.to && Date.parse(range.from) > Date.parse(range.to)) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'The end must not precede the start.' })
  }
}).readonly()

export const contentSpaceSearchScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('container'),
    container: contentContainerReferenceSchema
  }).strict().readonly(),
  z.object({
    kind: z.literal('provider-scope'),
    providerInstanceRef: providerInstanceRefSchema,
    scope: z.enum(['personal', 'shared'])
  }).strict().readonly()
])

const contentSpaceSearchMetadataFieldSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  metadataTypeId: extendedOpaqueIdSchema,
  fieldId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceSearchMetadataPredicateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    field: contentSpaceSearchMetadataFieldSchema,
    operator: z.enum(['equals', 'contains']),
    value: z.string().max(16_384)
  }).strict().readonly(),
  z.object({
    kind: z.literal('number'),
    field: contentSpaceSearchMetadataFieldSchema,
    operator: z.enum(['equals', 'range']),
    value: z.number().finite().optional(),
    from: z.number().finite().optional(),
    to: z.number().finite().optional()
  }).strict().superRefine((predicate, context) => {
    if (predicate.operator === 'equals' && predicate.value === undefined) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Equality requires a value.' })
    }
    if (predicate.operator === 'range' && predicate.from === undefined && predicate.to === undefined) {
      context.addIssue({ code: 'custom', message: 'A range requires at least one bound.' })
    }
  }).readonly(),
  z.object({
    kind: z.literal('date'),
    field: contentSpaceSearchMetadataFieldSchema,
    operator: z.enum(['equals', 'range']),
    value: z.string().datetime({ offset: true }).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
  }).strict().superRefine((predicate, context) => {
    if (predicate.operator === 'equals' && predicate.value === undefined) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Equality requires a value.' })
    }
    if (predicate.operator === 'range' && predicate.from === undefined && predicate.to === undefined) {
      context.addIssue({ code: 'custom', message: 'A range requires at least one bound.' })
    }
  }).readonly(),
  z.object({
    kind: z.literal('boolean'),
    field: contentSpaceSearchMetadataFieldSchema,
    value: z.boolean()
  }).strict().readonly(),
  z.object({
    kind: z.literal('choices'),
    field: contentSpaceSearchMetadataFieldSchema,
    choiceIds: z.array(extendedOpaqueIdSchema).min(1).max(100).readonly(),
    match: z.enum(['all', 'any'])
  }).strict().readonly(),
  z.object({
    kind: z.literal('directory-principals'),
    field: contentSpaceSearchMetadataFieldSchema,
    principals: z.array(contentSpaceDirectoryPrincipalReferenceSchema).min(1).max(100).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('files'),
    field: contentSpaceSearchMetadataFieldSchema,
    files: z.array(contentFileReferenceSchema).min(1).max(100).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('containers'),
    field: contentSpaceSearchMetadataFieldSchema,
    containers: z.array(contentContainerReferenceSchema).min(1).max(100).readonly()
  }).strict().readonly()
])

export const contentSpaceSearchEntriesRequestSchema = z.object({
  scope: contentSpaceSearchScopeSchema,
  query: z.string().trim().min(1).max(512),
  matching: z.enum(['exact', 'contains']).optional(),
  fields: z.array(z.enum(['name', 'tags', 'content'])).min(1).max(3).optional(),
  entryKinds: z.array(contentSpaceExtendedEntryKindSchema).min(1).max(2).optional(),
  extensions: z.array(
    z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u)
  ).max(32).optional(),
  createdBy: z.array(contentSpaceDirectoryPrincipalReferenceSchema).max(64).optional(),
  modifiedBy: z.array(contentSpaceDirectoryPrincipalReferenceSchema).max(64).optional(),
  created: contentSpaceTimestampRangeSchema.optional(),
  modified: contentSpaceTimestampRangeSchema.optional(),
  tags: z.object({
    names: z.array(boundedLabelSchema).min(1).max(32),
    match: z.enum(['all', 'any'])
  }).strict().readonly().optional(),
  metadata: z.array(contentSpaceSearchMetadataPredicateSchema).max(64).optional(),
  page: contentSpacePageRequestSchema,
  sort: z.object({
    field: z.enum(['name', 'created-at', 'modified-at', 'size']),
    direction: z.enum(['ascending', 'descending'])
  }).strict().readonly().optional()
}).strict().readonly()

export const contentSpaceEntryInfoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('container'),
    reference: contentContainerReferenceSchema,
    name: boundedLabelSchema,
    parent: contentContainerReferenceSchema.optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    modifiedAt: z.string().datetime({ offset: true }).optional(),
    createdBy: contentSpaceDirectoryPrincipalSummarySchema.optional(),
    modifiedBy: contentSpaceDirectoryPrincipalSummarySchema.optional(),
    code: z.string().trim().max(128).optional(),
    remark: z.string().trim().max(2_048).optional()
  }).strict().readonly(),
  z.object({
    kind: z.literal('file'),
    reference: contentFileReferenceSchema,
    name: boundedLabelSchema,
    parent: contentContainerReferenceSchema,
    size: z.number().int().nonnegative().max(1_073_741_824_000),
    createdAt: z.string().datetime({ offset: true }).optional(),
    modifiedAt: z.string().datetime({ offset: true }).optional(),
    createdBy: contentSpaceDirectoryPrincipalSummarySchema.optional(),
    modifiedBy: contentSpaceDirectoryPrincipalSummarySchema.optional(),
    currentVersionId: extendedOpaqueIdSchema.optional(),
    code: z.string().trim().max(128).optional(),
    remark: z.string().trim().max(2_048).optional()
  }).strict().readonly()
])

export const contentSpaceEntryInfoPageSchema = z.object({
  items: z.array(contentSpaceEntryInfoSchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional(),
  matchedCount: z.number().int().nonnegative().optional()
}).strict().readonly()

export const contentSpaceSearchEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryInfoPageSchema
)

export const contentSpaceListRecentEntriesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  scope: z.enum(['personal', 'shared']).optional(),
  entryKinds: z.array(contentSpaceExtendedEntryKindSchema).min(1).max(2).optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceListRecentEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryInfoPageSchema
)

export const contentSpaceGetEntryInfoRequestSchema = z.object({
  reference: contentSpaceMutableEntryReferenceSchema
}).strict().readonly()
export const contentSpaceGetEntryInfoResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryInfoSchema
)

export const contentSpaceResolveInternalLinkRequestSchema = z.object({
  reference: contentSpaceMutableEntryReferenceSchema
}).strict().readonly()
export const contentSpaceProviderPortalTargetSchema = z.object({
  url: z.string().url().max(4_096).refine((value) => new URL(value).protocol === 'https:', {
    message: 'Provider portal targets must use HTTPS.'
  }),
  expiresAt: z.string().datetime({ offset: true })
}).strict().readonly()
export const contentSpaceResolvedInternalLinkSchema = z.object({
  reference: contentSpaceMutableEntryReferenceSchema,
  target: contentSpaceProviderPortalTargetSchema
}).strict().readonly()
export const contentSpaceResolveInternalLinkResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceResolvedInternalLinkSchema
)

export const contentSpaceBuildFileScopeRequestSchema = z.object({
  scope: contentSpaceSearchScopeSchema,
  query: z.string().trim().min(1).max(512),
  matching: z.enum(['exact', 'contains']).optional(),
  fields: z.array(z.enum(['name', 'tags', 'content'])).min(1).max(3).optional(),
  extensions: z.array(
    z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u)
  ).max(32).optional(),
  createdBy: z.array(contentSpaceDirectoryPrincipalReferenceSchema).max(64).optional(),
  modifiedBy: z.array(contentSpaceDirectoryPrincipalReferenceSchema).max(64).optional(),
  created: contentSpaceTimestampRangeSchema.optional(),
  modified: contentSpaceTimestampRangeSchema.optional(),
  tags: z.object({
    names: z.array(boundedLabelSchema).min(1).max(32),
    match: z.enum(['all', 'any'])
  }).strict().readonly().optional(),
  metadata: z.array(contentSpaceSearchMetadataPredicateSchema).max(64).optional()
}).strict().readonly()
export const contentSpaceFileScopeSchema = z.object({
  files: z.array(contentFileReferenceSchema).max(100).readonly(),
  matchedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  selection: z.object({
    limit: z.literal(100),
    sort: z.literal('modified-at'),
    direction: z.literal('descending')
  }).strict().readonly()
}).strict().superRefine((scope, context) => {
  if (scope.files.length > scope.matchedCount) {
    context.addIssue({ code: 'custom', path: ['matchedCount'], message: 'Matched count is too small.' })
  }
  if (scope.truncated !== (scope.matchedCount > scope.files.length)) {
    context.addIssue({ code: 'custom', path: ['truncated'], message: 'Truncation must match counts.' })
  }
}).readonly()
export const contentSpaceBuildFileScopeResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceFileScopeSchema
)

export const contentSpaceExtendedOperationFamilySchema = z.enum([
  'discovery',
  'metadata',
  'entry-management',
  'versioning',
  'attachments',
  'relations',
  'tags',
  'sharing',
  'favorites',
  'organization-directory',
  'permissions',
  'collaboration',
  'knowledge',
  'team-governance'
])

export const contentSpaceExtendedOperationEffectSchema = z.enum([
  'read',
  'workspace-write',
  'external-write',
  'destructive'
])

export const contentSpaceExtendedOperationStageSchema = z.enum(['contracted', 'deferred'])

export type ContentSpaceExtendedOperationFamily = z.infer<
  typeof contentSpaceExtendedOperationFamilySchema
>
export type ContentSpaceExtendedOperationEffect = z.infer<
  typeof contentSpaceExtendedOperationEffectSchema
>
export type ContentSpaceExtendedOperationStage = z.infer<
  typeof contentSpaceExtendedOperationStageSchema
>

export type ContentSpaceExtendedOperationDescriptor = Readonly<{
  key: string
  id: `content-space.${string}`
  family: ContentSpaceExtendedOperationFamily
  effect: ContentSpaceExtendedOperationEffect
  stage: ContentSpaceExtendedOperationStage
}>

function operation(
  key: string,
  id: `content-space.${string}`,
  family: ContentSpaceExtendedOperationFamily,
  effect: ContentSpaceExtendedOperationEffect,
  stage: ContentSpaceExtendedOperationStage = 'contracted'
): ContentSpaceExtendedOperationDescriptor {
  return Object.freeze({ key, id, family, effect, stage })
}

export const CONTENT_SPACE_EXTENDED_OPERATIONS = Object.freeze({
  searchEntries: operation('searchEntries', 'content-space.search-entries', 'discovery', 'read'),
  listRecentEntries: operation('listRecentEntries', 'content-space.list-recent-entries', 'discovery', 'read'),
  getEntryInfo: operation('getEntryInfo', 'content-space.get-entry-info', 'discovery', 'read'),
  resolveInternalLink: operation('resolveInternalLink', 'content-space.resolve-internal-link', 'discovery', 'read'),
  buildFileScope: operation('buildFileScope', 'content-space.build-file-scope', 'discovery', 'read'),

  listMetadataTypes: operation('listMetadataTypes', 'content-space.list-metadata-types', 'metadata', 'read'),
  listMetadataFields: operation('listMetadataFields', 'content-space.list-metadata-fields', 'metadata', 'read'),
  listMetadataChoices: operation('listMetadataChoices', 'content-space.list-metadata-choices', 'metadata', 'read'),
  readEntryMetadata: operation('readEntryMetadata', 'content-space.read-entry-metadata', 'metadata', 'read'),
  editEntryMetadata: operation('editEntryMetadata', 'content-space.edit-entry-metadata', 'metadata', 'external-write'),

  renameEntry: operation('renameEntry', 'content-space.rename-entry', 'entry-management', 'external-write'),
  copyEntries: operation('copyEntries', 'content-space.copy-entries', 'entry-management', 'external-write'),
  moveEntries: operation('moveEntries', 'content-space.move-entries', 'entry-management', 'external-write'),
  deleteEntries: operation('deleteEntries', 'content-space.delete-entries', 'entry-management', 'destructive'),
  createShortcut: operation('createShortcut', 'content-space.create-shortcut', 'entry-management', 'external-write'),
  updateEntryProperties: operation('updateEntryProperties', 'content-space.update-entry-properties', 'entry-management', 'external-write'),
  listSecurityLevels: operation('listSecurityLevels', 'content-space.list-security-levels', 'entry-management', 'read'),

  updateFileVersion: operation('updateFileVersion', 'content-space.update-file-version', 'versioning', 'external-write'),
  exportFileAsPdf: operation('exportFileAsPdf', 'content-space.export-file-as-pdf', 'versioning', 'workspace-write'),

  listAttachments: operation('listAttachments', 'content-space.list-attachments', 'attachments', 'read'),
  addAttachment: operation('addAttachment', 'content-space.add-attachment', 'attachments', 'external-write'),
  removeAttachment: operation('removeAttachment', 'content-space.remove-attachment', 'attachments', 'destructive'),

  listRelations: operation('listRelations', 'content-space.list-relations', 'relations', 'read'),
  createRelation: operation('createRelation', 'content-space.create-relation', 'relations', 'external-write'),
  removeRelation: operation('removeRelation', 'content-space.remove-relation', 'relations', 'destructive'),

  listTags: operation('listTags', 'content-space.list-tags', 'tags', 'read'),
  setTags: operation('setTags', 'content-space.set-tags', 'tags', 'external-write'),
  removeTags: operation('removeTags', 'content-space.remove-tags', 'tags', 'destructive'),

  createPublication: operation('createPublication', 'content-space.create-publication', 'sharing', 'external-write'),
  listPublications: operation('listPublications', 'content-space.list-publications', 'sharing', 'read'),
  cancelPublication: operation('cancelPublication', 'content-space.cancel-publication', 'sharing', 'destructive'),
  createShare: operation('createShare', 'content-space.create-share', 'sharing', 'external-write'),
  listShares: operation('listShares', 'content-space.list-shares', 'sharing', 'read'),
  cancelShare: operation('cancelShare', 'content-space.cancel-share', 'sharing', 'destructive'),

  listAlbums: operation('listAlbums', 'content-space.list-albums', 'favorites', 'read'),
  listAlbumEntries: operation('listAlbumEntries', 'content-space.list-album-entries', 'favorites', 'read'),
  addFavorite: operation('addFavorite', 'content-space.add-favorite', 'favorites', 'external-write'),
  removeFavorite: operation('removeFavorite', 'content-space.remove-favorite', 'favorites', 'destructive'),

  getCurrentPrincipal: operation('getCurrentPrincipal', 'content-space.get-current-principal', 'organization-directory', 'read'),
  searchUsers: operation('searchUsers', 'content-space.search-users', 'organization-directory', 'read'),
  searchDepartments: operation('searchDepartments', 'content-space.search-departments', 'organization-directory', 'read'),
  searchPositions: operation('searchPositions', 'content-space.search-positions', 'organization-directory', 'read'),
  searchGroups: operation('searchGroups', 'content-space.search-groups', 'organization-directory', 'read'),

  listPermissionCategories: operation('listPermissionCategories', 'content-space.list-permission-categories', 'permissions', 'read'),
  listPermissions: operation('listPermissions', 'content-space.list-permissions', 'permissions', 'read'),
  changePermissions: operation('changePermissions', 'content-space.change-permissions', 'permissions', 'external-write'),

  listCollaborationEntries: operation('listCollaborationEntries', 'content-space.list-collaboration-entries', 'collaboration', 'read'),
  searchCollaborationEntries: operation('searchCollaborationEntries', 'content-space.search-collaboration-entries', 'collaboration', 'read'),
  resolveCollaborationInvitation: operation('resolveCollaborationInvitation', 'content-space.resolve-collaboration-invitation', 'collaboration', 'read'),

  listKnowledgeCollections: operation('listKnowledgeCollections', 'content-space.list-knowledge-collections', 'knowledge', 'read'),
  searchKnowledgeCollections: operation('searchKnowledgeCollections', 'content-space.search-knowledge-collections', 'knowledge', 'read'),
  browseKnowledgeCollection: operation('browseKnowledgeCollection', 'content-space.browse-knowledge-collection', 'knowledge', 'read'),

  updateTeamMemberRole: operation('updateTeamMemberRole', 'content-space.update-team-member-role', 'team-governance', 'external-write'),
  transferTeamOwnership: operation('transferTeamOwnership', 'content-space.transfer-team-ownership', 'team-governance', 'external-write')
})

// Metadata

export const contentSpaceMetadataTypeReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  metadataTypeId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceMetadataFieldReferenceSchema = z.object({
  type: contentSpaceMetadataTypeReferenceSchema,
  fieldId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceMetadataChoiceReferenceSchema = z.object({
  field: contentSpaceMetadataFieldReferenceSchema,
  choiceId: extendedOpaqueIdSchema
}).strict().readonly()

export const contentSpaceMetadataValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(16_384) }).strict().readonly(),
  z.object({ kind: z.literal('number'), value: z.number().finite() }).strict().readonly(),
  z.object({ kind: z.literal('date'), value: z.string().datetime({ offset: true }) }).strict().readonly(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict().readonly(),
  z.object({
    kind: z.literal('choices'),
    values: z.array(contentSpaceMetadataChoiceReferenceSchema).max(100).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('directory-principals'),
    values: z.array(contentSpaceDirectoryPrincipalReferenceSchema).max(100).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('files'),
    values: z.array(contentFileReferenceSchema).max(100).readonly()
  }).strict().readonly(),
  z.object({
    kind: z.literal('containers'),
    values: z.array(contentContainerReferenceSchema).max(100).readonly()
  }).strict().readonly()
])

export const contentSpaceMetadataTypeSummarySchema = z.object({
  reference: contentSpaceMetadataTypeReferenceSchema,
  name: boundedLabelSchema,
  description: boundedDescriptionSchema.optional()
}).strict().readonly()
export const contentSpaceMetadataFieldKindSchema = z.enum([
  'text',
  'number',
  'date',
  'boolean',
  'single-choice',
  'multiple-choice',
  'directory-principals',
  'files',
  'containers'
])
export const contentSpaceMetadataFieldDefinitionSchema = z.object({
  reference: contentSpaceMetadataFieldReferenceSchema,
  name: boundedLabelSchema,
  kind: contentSpaceMetadataFieldKindSchema,
  required: z.boolean(),
  multiple: z.boolean(),
  readOnly: z.boolean()
}).strict().readonly()
export const contentSpaceMetadataChoiceSummarySchema = z.object({
  reference: contentSpaceMetadataChoiceReferenceSchema,
  label: boundedLabelSchema
}).strict().readonly()
export const contentSpaceMetadataRecordSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  type: contentSpaceMetadataTypeSummarySchema,
  values: z.array(z.object({
    field: contentSpaceMetadataFieldDefinitionSchema,
    value: contentSpaceMetadataValueSchema.optional()
  }).strict().readonly()).max(256).readonly()
}).strict().readonly()

export const contentSpaceListMetadataTypesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceMetadataTypePageSchema = z.object({
  items: z.array(contentSpaceMetadataTypeSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListMetadataTypesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceMetadataTypePageSchema
)

export const contentSpaceListMetadataFieldsRequestSchema = z.object({
  type: contentSpaceMetadataTypeReferenceSchema
}).strict().readonly()
export const contentSpaceMetadataFieldListSchema = z.object({
  type: contentSpaceMetadataTypeSummarySchema,
  items: z.array(contentSpaceMetadataFieldDefinitionSchema).max(256).readonly()
}).strict().readonly()
export const contentSpaceListMetadataFieldsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceMetadataFieldListSchema
)

export const contentSpaceListMetadataChoicesRequestSchema = z.object({
  field: contentSpaceMetadataFieldReferenceSchema,
  query: z.string().trim().min(1).max(256).optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceMetadataChoicePageSchema = z.object({
  field: contentSpaceMetadataFieldReferenceSchema,
  items: z.array(contentSpaceMetadataChoiceSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListMetadataChoicesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceMetadataChoicePageSchema
)

export const contentSpaceReadEntryMetadataRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  type: contentSpaceMetadataTypeReferenceSchema.optional()
}).strict().readonly()
export const contentSpaceMetadataRecordListSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  items: z.array(contentSpaceMetadataRecordSchema).max(64).readonly()
}).strict().readonly()
export const contentSpaceReadEntryMetadataResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceMetadataRecordListSchema
)

export const contentSpaceEditEntryMetadataRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  type: contentSpaceMetadataTypeReferenceSchema,
  changes: z.array(z.object({
    field: contentSpaceMetadataFieldReferenceSchema,
    value: contentSpaceMetadataValueSchema.nullable()
  }).strict().readonly()).min(1).max(128).readonly()
}).strict().readonly()
export const contentSpaceEditEntryMetadataReceiptSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  type: contentSpaceMetadataTypeReferenceSchema,
  changedFields: z.array(contentSpaceMetadataFieldReferenceSchema).min(1).max(128).readonly()
}).strict().readonly()
export const contentSpaceEditEntryMetadataResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEditEntryMetadataReceiptSchema
)

// Entry management and explicit version operations

export const contentSpaceRenameEntryRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  name: contentSpaceEntryNameSchema
}).strict().readonly()
export const contentSpaceRenameEntryReceiptSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  name: contentSpaceEntryNameSchema
}).strict().readonly()
export const contentSpaceRenameEntryResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRenameEntryReceiptSchema
)

const contentSpaceEntryBatchRequestSchema = z.object({
  entries: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly(),
  destination: contentContainerReferenceSchema
}).strict().readonly()
const contentSpaceEntryMutationOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    source: contentSpaceMutableEntryReferenceSchema,
    result: contentSpaceMutableEntryReferenceSchema
  }).strict().readonly(),
  z.object({
    ok: z.literal(false),
    source: contentSpaceMutableEntryReferenceSchema,
    error: contentSpaceExtendedErrorSchema
  }).strict().readonly()
])
const contentSpaceEntryMutationBatchReceiptSchema = z.object({
  items: z.array(contentSpaceEntryMutationOutcomeSchema).min(1).max(100).readonly()
}).strict().readonly()

export const contentSpaceCopyEntriesRequestSchema = contentSpaceEntryBatchRequestSchema
export const contentSpaceCopyEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryMutationBatchReceiptSchema
)
export const contentSpaceMoveEntriesRequestSchema = contentSpaceEntryBatchRequestSchema
export const contentSpaceMoveEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryMutationBatchReceiptSchema
)

export const contentSpaceDeleteEntriesRequestSchema = z.object({
  entries: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceDeleteEntriesReceiptSchema = z.object({
  deleted: z.array(contentSpaceMutableEntryReferenceSchema).max(100).readonly(),
  failed: z.array(z.object({
    target: contentSpaceMutableEntryReferenceSchema,
    error: contentSpaceExtendedErrorSchema
  }).strict().readonly()).max(100).readonly()
}).strict().readonly()
export const contentSpaceDeleteEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDeleteEntriesReceiptSchema
)

export const contentSpaceCreateShortcutRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  destination: contentContainerReferenceSchema,
  name: contentSpaceEntryNameSchema.optional()
}).strict().readonly()
export const contentSpaceCreateShortcutReceiptSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  destination: contentContainerReferenceSchema,
  shortcut: contentSpaceMutableEntryReferenceSchema
}).strict().readonly()
export const contentSpaceCreateShortcutResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCreateShortcutReceiptSchema
)

export const contentSpaceSecurityLevelReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  securityLevelId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceSecurityLevelSummarySchema = z.object({
  reference: contentSpaceSecurityLevelReferenceSchema,
  name: boundedLabelSchema,
  rank: z.number().int().nonnegative().optional()
}).strict().readonly()
export const contentSpaceUpdateEntryPropertiesRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  changes: z.object({
    code: z.string().trim().max(128).nullable().optional(),
    remark: z.string().trim().max(2_048).nullable().optional(),
    securityLevel: contentSpaceSecurityLevelReferenceSchema.nullable().optional()
  }).strict().superRefine((changes, context) => {
    if (changes.code === undefined && changes.remark === undefined && changes.securityLevel === undefined) {
      context.addIssue({ code: 'custom', message: 'At least one property change is required.' })
    }
  }).readonly()
}).strict().readonly()
export const contentSpaceUpdateEntryPropertiesReceiptSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  changed: z.array(z.enum(['code', 'remark', 'security-level'])).min(1).max(3).readonly()
}).strict().readonly()
export const contentSpaceUpdateEntryPropertiesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceUpdateEntryPropertiesReceiptSchema
)

export const contentSpaceListSecurityLevelsRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceSecurityLevelPageSchema = z.object({
  items: z.array(contentSpaceSecurityLevelSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListSecurityLevelsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceSecurityLevelPageSchema
)

export const contentSpaceUpdateFileVersionRequestSchema = z.object({
  reference: contentFileReferenceSchema,
  sourceHandle: domainFileTransferHandleSchema,
  strategy: z.enum(['major', 'minor']),
  expectedVersionId: extendedOpaqueIdSchema,
  changeNote: z.string().trim().max(2_048).optional()
}).strict().readonly()
export const contentSpaceUpdateFileVersionReceiptSchema = z.object({
  reference: contentFileReferenceSchema,
  versionId: extendedOpaqueIdSchema,
  strategy: z.enum(['major', 'minor']),
  byteLength: z.number().int().nonnegative().max(1_073_741_824),
  digest: artifactDigestSchema
}).strict().readonly()
export const contentSpaceUpdateFileVersionResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceUpdateFileVersionReceiptSchema
)

export const contentSpaceExportFileAsPdfRequestSchema = z.object({
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  versionId: extendedOpaqueIdSchema.optional(),
  destinationHandle: domainFileTransferHandleSchema
}).strict().readonly()
export const contentSpaceExportFileAsPdfReceiptSchema = z.object({
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  format: z.literal('pdf'),
  bytesWritten: z.number().int().nonnegative().max(1_073_741_824_000),
  digest: artifactDigestSchema.optional()
}).strict().readonly()
export const contentSpaceExportFileAsPdfResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceExportFileAsPdfReceiptSchema
)

// Attachments, relations, and tags

export const contentSpaceAttachmentSummarySchema = z.object({
  master: contentFileReferenceSchema,
  attachment: contentFileReferenceSchema,
  name: contentSpaceEntryNameSchema,
  size: z.number().int().nonnegative().max(1_073_741_824_000),
  addedAt: z.string().datetime({ offset: true }).optional()
}).strict().readonly()
export const contentSpaceListAttachmentsRequestSchema = z.object({
  master: contentFileReferenceSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceAttachmentPageSchema = z.object({
  master: contentFileReferenceSchema,
  items: z.array(contentSpaceAttachmentSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListAttachmentsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceAttachmentPageSchema
)
export const contentSpaceAddAttachmentRequestSchema = z.object({
  master: contentFileReferenceSchema,
  name: contentSpaceEntryNameSchema,
  sourceHandle: domainFileTransferHandleSchema
}).strict().readonly()

export const contentSpaceAgentUpdateFileVersionRequestSchema = z.object({
  reference: contentFileReferenceSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema,
  strategy: z.enum(['major', 'minor']),
  expectedVersionId: extendedOpaqueIdSchema,
  changeNote: z.string().trim().max(2_048).optional()
}).strict().readonly()

export const contentSpaceAgentExportFileAsPdfRequestSchema = z.object({
  reference: z.union([contentFileReferenceSchema, artifactReferenceSchema]),
  versionId: extendedOpaqueIdSchema.optional(),
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().readonly()

export const contentSpaceAgentAddAttachmentRequestSchema = z.object({
  master: contentFileReferenceSchema,
  name: contentSpaceEntryNameSchema,
  workspaceRelativePath: domainWorkspaceRelativePathSchema
}).strict().readonly()
export const contentSpaceAddAttachmentResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceAttachmentSummarySchema
)
export const contentSpaceRemoveAttachmentRequestSchema = z.object({
  master: contentFileReferenceSchema,
  attachment: contentFileReferenceSchema
}).strict().readonly()
export const contentSpaceRemoveAttachmentReceiptSchema = z.object({
  master: contentFileReferenceSchema,
  attachment: contentFileReferenceSchema,
  removed: z.literal(true)
}).strict().readonly()
export const contentSpaceRemoveAttachmentResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRemoveAttachmentReceiptSchema
)

export const contentSpaceRelationKindSchema = z.enum([
  'related',
  'source',
  'derived',
  'supplement'
])
export const contentSpaceRelationReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  relationId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceRelationSummarySchema = z.object({
  reference: contentSpaceRelationReferenceSchema,
  source: contentFileReferenceSchema,
  target: contentFileReferenceSchema,
  kind: contentSpaceRelationKindSchema,
  label: boundedLabelSchema.optional()
}).strict().readonly()
export const contentSpaceListRelationsRequestSchema = z.object({
  target: contentFileReferenceSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceRelationPageSchema = z.object({
  target: contentFileReferenceSchema,
  items: z.array(contentSpaceRelationSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListRelationsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRelationPageSchema
)
export const contentSpaceCreateRelationRequestSchema = z.object({
  source: contentFileReferenceSchema,
  target: contentFileReferenceSchema,
  kind: contentSpaceRelationKindSchema,
  label: boundedLabelSchema.optional()
}).strict().refine((relation) =>
  relation.source.providerInstanceRef !== relation.target.providerInstanceRef ||
  relation.source.fileId !== relation.target.fileId,
{ message: 'A file cannot relate to itself.' }).readonly()
export const contentSpaceCreateRelationResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRelationSummarySchema
)
export const contentSpaceRemoveRelationRequestSchema = z.object({
  relation: contentSpaceRelationSummarySchema
}).strict().readonly()
export const contentSpaceRemoveRelationReceiptSchema = z.object({
  relation: contentSpaceRelationReferenceSchema,
  removed: z.literal(true)
}).strict().readonly()
export const contentSpaceRemoveRelationResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRemoveRelationReceiptSchema
)

export const contentSpaceTagReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  tagId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceTagSummarySchema = z.object({
  reference: contentSpaceTagReferenceSchema,
  name: boundedLabelSchema
}).strict().readonly()
export const contentSpaceListTagsRequestSchema = z.object({
  target: contentFileReferenceSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceTagPageSchema = z.object({
  target: contentFileReferenceSchema,
  items: z.array(contentSpaceTagSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListTagsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceTagPageSchema
)
export const contentSpaceSetTagsRequestSchema = z.object({
  targets: z.array(contentFileReferenceSchema).min(1).max(100).readonly(),
  names: z.array(boundedLabelSchema).min(1).max(64).readonly()
}).strict().readonly()
export const contentSpaceSetTagsReceiptSchema = z.object({
  targets: z.array(contentFileReferenceSchema).min(1).max(100).readonly(),
  names: z.array(boundedLabelSchema).min(1).max(64).readonly()
}).strict().readonly()
export const contentSpaceSetTagsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceSetTagsReceiptSchema
)
export const contentSpaceRemoveTagsRequestSchema = z.object({
  targets: z.array(contentFileReferenceSchema).min(1).max(100).readonly(),
  tags: z.array(contentSpaceTagReferenceSchema).min(1).max(64).readonly()
}).strict().readonly()
export const contentSpaceRemoveTagsReceiptSchema = z.object({
  targets: z.array(contentFileReferenceSchema).min(1).max(100).readonly(),
  tags: z.array(contentSpaceTagReferenceSchema).min(1).max(64).readonly()
}).strict().readonly()
export const contentSpaceRemoveTagsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceRemoveTagsReceiptSchema
)

// Sharing, publication, favorites, and albums

export const contentSpaceAccessExpirySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('permanent') }).strict().readonly(),
  z.object({
    kind: z.literal('expires-at'),
    expiresAt: z.string().datetime({ offset: true })
  }).strict().readonly()
])
export const contentSpacePublicationReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  publicationId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceCompletePublicationSummarySchema = z.object({
  observation: z.literal('complete'),
  reference: contentSpacePublicationReferenceSchema,
  name: boundedLabelSchema,
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly(),
  permissions: z.array(z.enum(['preview', 'print', 'download'])).min(1).max(3).readonly(),
  expiry: contentSpaceAccessExpirySchema,
  accessTarget: contentSpaceProviderPortalTargetSchema.optional()
}).strict().readonly()
export const contentSpacePartialPublicationSummarySchema = z.object({
  observation: z.literal('partial'),
  reference: contentSpacePublicationReferenceSchema,
  name: boundedLabelSchema.optional(),
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly().optional(),
  permissions: z.array(z.enum(['preview', 'print', 'download'])).min(1).max(3).readonly().optional(),
  expiry: contentSpaceAccessExpirySchema.optional(),
  accessTarget: contentSpaceProviderPortalTargetSchema.optional()
}).strict().readonly()
export const contentSpacePublicationSummarySchema = z.discriminatedUnion('observation', [
  contentSpaceCompletePublicationSummarySchema,
  contentSpacePartialPublicationSummarySchema
])
export const contentSpaceCreatePublicationRequestSchema = z.object({
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly(),
  name: boundedLabelSchema,
  permissions: z.array(z.enum(['preview', 'print', 'download'])).min(1).max(3).readonly(),
  expiry: contentSpaceAccessExpirySchema
}).strict().readonly()
export const contentSpaceCreatePublicationResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCompletePublicationSummarySchema
)
export const contentSpaceListPublicationsRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256).optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpacePublicationPageSchema = z.object({
  items: z.array(contentSpacePublicationSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListPublicationsResultSchema = contentSpaceExtendedResultSchema(
  contentSpacePublicationPageSchema
)
export const contentSpaceCancelPublicationRequestSchema = z.object({
  publications: z.array(contentSpacePublicationReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceCancelPublicationReceiptSchema = z.object({
  cancelled: z.array(contentSpacePublicationReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceCancelPublicationResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCancelPublicationReceiptSchema
)

export const contentSpaceShareReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  shareId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceSharePermissionsSchema = z.array(
  z.enum(['preview', 'print', 'download', 'edit'])
).min(1).max(4).readonly()
export const contentSpaceCompleteShareSummarySchema = z.object({
  observation: z.literal('complete'),
  reference: contentSpaceShareReferenceSchema,
  name: boundedLabelSchema,
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly(),
  recipients: z.array(contentSpaceDirectoryPrincipalReferenceSchema).min(1).max(100).readonly(),
  permissions: contentSpaceSharePermissionsSchema,
  expiry: contentSpaceAccessExpirySchema
}).strict().readonly()
export const contentSpacePartialShareSummarySchema = z.object({
  observation: z.literal('partial'),
  reference: contentSpaceShareReferenceSchema,
  name: boundedLabelSchema.optional(),
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly().optional(),
  recipients: z.array(contentSpaceDirectoryPrincipalReferenceSchema).min(1).max(100).readonly().optional(),
  permissions: contentSpaceSharePermissionsSchema.optional(),
  expiry: contentSpaceAccessExpirySchema.optional()
}).strict().readonly()
export const contentSpaceShareSummarySchema = z.discriminatedUnion('observation', [
  contentSpaceCompleteShareSummarySchema,
  contentSpacePartialShareSummarySchema
])
export const contentSpaceCreateShareRequestSchema = z.object({
  targets: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly(),
  recipients: z.array(contentSpaceDirectoryPrincipalReferenceSchema).min(1).max(100).readonly(),
  name: boundedLabelSchema,
  permissions: contentSpaceSharePermissionsSchema,
  expiry: contentSpaceAccessExpirySchema,
  notifyRecipients: z.boolean()
}).strict().readonly()
export const contentSpaceCreateShareResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCompleteShareSummarySchema
)
export const contentSpaceListSharesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256).optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceSharePageSchema = z.object({
  items: z.array(contentSpaceShareSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListSharesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceSharePageSchema
)
export const contentSpaceCancelShareRequestSchema = z.object({
  shares: z.array(contentSpaceShareReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceCancelShareReceiptSchema = z.object({
  cancelled: z.array(contentSpaceShareReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceCancelShareResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCancelShareReceiptSchema
)

export const contentSpaceAlbumReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  albumId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceAlbumSummarySchema = z.object({
  reference: contentSpaceAlbumReferenceSchema,
  name: boundedLabelSchema,
  entryCount: z.number().int().nonnegative(),
  isDefault: z.boolean()
}).strict().readonly()
export const contentSpaceListAlbumsRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256).optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceAlbumPageSchema = z.object({
  items: z.array(contentSpaceAlbumSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListAlbumsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceAlbumPageSchema
)
export const contentSpaceListAlbumEntriesRequestSchema = z.object({
  album: contentSpaceAlbumReferenceSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceAlbumEntrySchema = z.object({
  favoriteId: extendedOpaqueIdSchema,
  entry: contentSpaceEntryInfoSchema
}).strict().readonly()
export const contentSpaceAlbumEntryPageSchema = z.object({
  album: contentSpaceAlbumReferenceSchema,
  items: z.array(contentSpaceAlbumEntrySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListAlbumEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceAlbumEntryPageSchema
)
export const contentSpaceAddFavoriteRequestSchema = z.object({
  album: contentSpaceAlbumReferenceSchema,
  entries: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceFavoriteMutationReceiptSchema = z.object({
  album: contentSpaceAlbumReferenceSchema,
  entries: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceAddFavoriteResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceFavoriteMutationReceiptSchema
)
export const contentSpaceRemoveFavoriteRequestSchema = z.discriminatedUnion('by', [
  z.object({
    by: z.literal('favorite'),
    album: contentSpaceAlbumReferenceSchema,
    favoriteIds: z.array(extendedOpaqueIdSchema).min(1).max(100).readonly()
  }).strict().readonly(),
  z.object({
    by: z.literal('entry'),
    album: contentSpaceAlbumReferenceSchema,
    entries: z.array(contentSpaceMutableEntryReferenceSchema).min(1).max(100).readonly()
  }).strict().readonly()
])
export const contentSpaceRemoveFavoriteResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceFavoriteMutationReceiptSchema
)

// Organization directory and permissions

export const contentSpaceGetCurrentPrincipalRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema
}).strict().readonly()
export const contentSpaceGetCurrentPrincipalResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDirectoryPrincipalSummarySchema
)

const contentSpaceDirectorySearchBase = {
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256),
  page: contentSpacePageRequestSchema
}
export const contentSpaceSearchUsersRequestSchema = z.object({
  ...contentSpaceDirectorySearchBase,
  within: z.object({
    kind: z.enum(['department', 'position']),
    principal: contentSpaceDirectoryPrincipalReferenceSchema,
    recursive: z.boolean()
  }).strict().readonly().optional()
}).strict().readonly()
export const contentSpaceSearchDepartmentsRequestSchema = z.object(
  contentSpaceDirectorySearchBase
).strict().readonly()
export const contentSpaceSearchPositionsRequestSchema = z.object(
  contentSpaceDirectorySearchBase
).strict().readonly()
export const contentSpaceSearchGroupsRequestSchema = z.object(
  contentSpaceDirectorySearchBase
).strict().readonly()
function directoryPrincipalPageSchema<SummarySchema extends z.ZodType>(
  summary: SummarySchema
) {
  return z.object({
    items: z.array(summary).max(200).readonly(),
    nextCursor: z.string().trim().min(1).max(256).optional()
  }).strict().readonly()
}
export const contentSpaceDirectoryUserPageSchema =
  directoryPrincipalPageSchema(contentSpaceDirectoryUserSummarySchema)
export const contentSpaceDirectoryDepartmentPageSchema =
  directoryPrincipalPageSchema(contentSpaceDirectoryDepartmentSummarySchema)
export const contentSpaceDirectoryPositionPageSchema =
  directoryPrincipalPageSchema(contentSpaceDirectoryPositionSummarySchema)
export const contentSpaceDirectoryGroupPageSchema =
  directoryPrincipalPageSchema(contentSpaceDirectoryGroupSummarySchema)
export const contentSpaceSearchUsersResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDirectoryUserPageSchema
)
export const contentSpaceSearchDepartmentsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDirectoryDepartmentPageSchema
)
export const contentSpaceSearchPositionsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDirectoryPositionPageSchema
)
export const contentSpaceSearchGroupsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceDirectoryGroupPageSchema
)

export const contentSpacePermissionTargetKindSchema = z.enum([
  'file',
  'container',
  'shared-container'
])
export const contentSpacePermissionCategoryReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  targetKind: contentSpacePermissionTargetKindSchema,
  categoryId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpacePermissionCategorySummarySchema = z.object({
  reference: contentSpacePermissionCategoryReferenceSchema,
  name: boundedLabelSchema,
  summary: boundedDescriptionSchema.optional()
}).strict().readonly()
export const contentSpaceListPermissionCategoriesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  targetKind: contentSpacePermissionTargetKindSchema
}).strict().readonly()
export const contentSpacePermissionCategoryListSchema = z.object({
  items: z.array(contentSpacePermissionCategorySummarySchema).max(128).readonly()
}).strict().readonly()
export const contentSpaceListPermissionCategoriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpacePermissionCategoryListSchema
)

export const contentSpacePermissionAssignmentSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  principal: contentSpaceDirectoryPrincipalReferenceSchema,
  category: contentSpacePermissionCategoryReferenceSchema,
  source: z.enum(['direct', 'inherited', 'self', 'administrator']),
  startsAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional()
}).strict().readonly()
export const contentSpaceListPermissionsRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  targetKind: contentSpacePermissionTargetKindSchema
}).strict().readonly()
export const contentSpacePermissionListSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  items: z.array(contentSpacePermissionAssignmentSchema).max(1_000).readonly()
}).strict().readonly()
export const contentSpaceListPermissionsResultSchema = contentSpaceExtendedResultSchema(
  contentSpacePermissionListSchema
)

const contentSpacePermissionPeriodFields = {
  startsAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional()
}
export const contentSpacePermissionChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    principal: contentSpaceDirectoryPrincipalReferenceSchema,
    category: contentSpacePermissionCategoryReferenceSchema,
    ...contentSpacePermissionPeriodFields
  }).strict().readonly(),
  z.object({
    action: z.literal('change'),
    principal: contentSpaceDirectoryPrincipalReferenceSchema,
    category: contentSpacePermissionCategoryReferenceSchema,
    ...contentSpacePermissionPeriodFields
  }).strict().readonly(),
  z.object({
    action: z.literal('remove'),
    principal: contentSpaceDirectoryPrincipalReferenceSchema
  }).strict().readonly()
])
export const contentSpaceChangePermissionsRequestSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  targetKind: contentSpacePermissionTargetKindSchema,
  changes: z.array(contentSpacePermissionChangeSchema).min(1).max(100).readonly()
}).strict().readonly()
export const contentSpaceChangePermissionsReceiptSchema = z.object({
  target: contentSpaceMutableEntryReferenceSchema,
  applied: z.number().int().nonnegative().max(100)
}).strict().readonly()
export const contentSpaceChangePermissionsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceChangePermissionsReceiptSchema
)

// Collaboration and knowledge browsing

export const contentSpaceCollaborationFilterSchema = z.enum([
  'all',
  'owned',
  'assisting',
  'unread',
  'commented'
])
export const contentSpaceCollaborationEntrySchema = z.object({
  file: contentFileReferenceSchema,
  name: boundedLabelSchema,
  createdAt: z.string().datetime({ offset: true }),
  owner: contentSpaceDirectoryPrincipalSummarySchema,
  read: z.boolean(),
  deleted: z.boolean()
}).strict().readonly()
export const contentSpaceListCollaborationEntriesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  filter: contentSpaceCollaborationFilterSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceSearchCollaborationEntriesRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceCollaborationEntryPageSchema = z.object({
  items: z.array(contentSpaceCollaborationEntrySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListCollaborationEntriesResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceCollaborationEntryPageSchema
)
export const contentSpaceSearchCollaborationEntriesResultSchema =
  contentSpaceListCollaborationEntriesResultSchema
export const contentSpaceResolveCollaborationInvitationRequestSchema = z.object({
  file: contentFileReferenceSchema
}).strict().readonly()
export const contentSpaceCollaborationInvitationSchema = z.object({
  file: contentFileReferenceSchema,
  target: contentSpaceProviderPortalTargetSchema
}).strict().readonly()
export const contentSpaceResolveCollaborationInvitationResultSchema =
  contentSpaceExtendedResultSchema(contentSpaceCollaborationInvitationSchema)

export const contentSpaceKnowledgeCollectionReferenceSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  collectionId: extendedOpaqueIdSchema
}).strict().readonly()
export const contentSpaceKnowledgeCollectionSummarySchema = z.object({
  reference: contentSpaceKnowledgeCollectionReferenceSchema,
  name: boundedLabelSchema,
  description: z.string().trim().max(2_048).optional(),
  root: contentContainerReferenceSchema,
  status: z.enum(['active', 'inactive'])
}).strict().readonly()
export const contentSpaceListKnowledgeCollectionsRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceSearchKnowledgeCollectionsRequestSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  query: z.string().trim().min(1).max(256),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceKnowledgeCollectionPageSchema = z.object({
  items: z.array(contentSpaceKnowledgeCollectionSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()
export const contentSpaceListKnowledgeCollectionsResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceKnowledgeCollectionPageSchema
)
export const contentSpaceSearchKnowledgeCollectionsResultSchema =
  contentSpaceListKnowledgeCollectionsResultSchema
export const contentSpaceBrowseKnowledgeCollectionRequestSchema = z.object({
  collection: contentSpaceKnowledgeCollectionReferenceSchema,
  parent: contentContainerReferenceSchema.optional(),
  page: contentSpacePageRequestSchema
}).strict().readonly()
export const contentSpaceBrowseKnowledgeCollectionResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceEntryInfoPageSchema
)

// Bounded team governance. Team deletion is deliberately absent.

export const contentSpaceTeamMemberRoleSchema = z.enum(['manager', 'internal', 'external'])
export const contentSpaceUpdateTeamMemberRoleRequestSchema = z.object({
  teamRoot: contentContainerReferenceSchema,
  member: contentSpaceDirectoryUserReferenceSchema,
  role: contentSpaceTeamMemberRoleSchema
}).strict().readonly()
export const contentSpaceUpdateTeamMemberRoleReceiptSchema = z.object({
  teamRoot: contentContainerReferenceSchema,
  member: contentSpaceDirectoryUserReferenceSchema,
  role: contentSpaceTeamMemberRoleSchema
}).strict().readonly()
export const contentSpaceUpdateTeamMemberRoleResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceUpdateTeamMemberRoleReceiptSchema
)
export const contentSpaceTransferTeamOwnershipRequestSchema = z.object({
  teamRoot: contentContainerReferenceSchema,
  newOwner: contentSpaceDirectoryUserReferenceSchema
}).strict().readonly()
export const contentSpaceTransferTeamOwnershipReceiptSchema = z.object({
  teamRoot: contentContainerReferenceSchema,
  owner: contentSpaceDirectoryUserReferenceSchema
}).strict().readonly()
export const contentSpaceTransferTeamOwnershipResultSchema = contentSpaceExtendedResultSchema(
  contentSpaceTransferTeamOwnershipReceiptSchema
)

export type ContentSpaceExtendedOperationContract = ContentSpaceExtendedOperationDescriptor &
Readonly<{
  requestSchema: z.ZodType
  resultSchema: z.ZodType
}>

function operationContract(
  descriptor: ContentSpaceExtendedOperationDescriptor,
  requestSchema: z.ZodType,
  resultSchema: z.ZodType
): ContentSpaceExtendedOperationContract {
  return Object.freeze({ ...descriptor, requestSchema, resultSchema })
}

export const CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS = Object.freeze({
  searchEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchEntries,
    contentSpaceSearchEntriesRequestSchema, contentSpaceSearchEntriesResultSchema),
  listRecentEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listRecentEntries,
    contentSpaceListRecentEntriesRequestSchema, contentSpaceListRecentEntriesResultSchema),
  getEntryInfo: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.getEntryInfo,
    contentSpaceGetEntryInfoRequestSchema, contentSpaceGetEntryInfoResultSchema),
  resolveInternalLink: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.resolveInternalLink,
    contentSpaceResolveInternalLinkRequestSchema, contentSpaceResolveInternalLinkResultSchema),
  buildFileScope: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.buildFileScope,
    contentSpaceBuildFileScopeRequestSchema, contentSpaceBuildFileScopeResultSchema),

  listMetadataTypes: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listMetadataTypes,
    contentSpaceListMetadataTypesRequestSchema, contentSpaceListMetadataTypesResultSchema),
  listMetadataFields: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listMetadataFields,
    contentSpaceListMetadataFieldsRequestSchema, contentSpaceListMetadataFieldsResultSchema),
  listMetadataChoices: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listMetadataChoices,
    contentSpaceListMetadataChoicesRequestSchema, contentSpaceListMetadataChoicesResultSchema),
  readEntryMetadata: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.readEntryMetadata,
    contentSpaceReadEntryMetadataRequestSchema, contentSpaceReadEntryMetadataResultSchema),
  editEntryMetadata: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.editEntryMetadata,
    contentSpaceEditEntryMetadataRequestSchema, contentSpaceEditEntryMetadataResultSchema),

  renameEntry: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.renameEntry,
    contentSpaceRenameEntryRequestSchema, contentSpaceRenameEntryResultSchema),
  copyEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.copyEntries,
    contentSpaceCopyEntriesRequestSchema, contentSpaceCopyEntriesResultSchema),
  moveEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.moveEntries,
    contentSpaceMoveEntriesRequestSchema, contentSpaceMoveEntriesResultSchema),
  deleteEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.deleteEntries,
    contentSpaceDeleteEntriesRequestSchema, contentSpaceDeleteEntriesResultSchema),
  createShortcut: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.createShortcut,
    contentSpaceCreateShortcutRequestSchema, contentSpaceCreateShortcutResultSchema),
  updateEntryProperties: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.updateEntryProperties,
    contentSpaceUpdateEntryPropertiesRequestSchema, contentSpaceUpdateEntryPropertiesResultSchema),
  listSecurityLevels: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listSecurityLevels,
    contentSpaceListSecurityLevelsRequestSchema, contentSpaceListSecurityLevelsResultSchema),

  updateFileVersion: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.updateFileVersion,
    contentSpaceUpdateFileVersionRequestSchema, contentSpaceUpdateFileVersionResultSchema),
  exportFileAsPdf: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.exportFileAsPdf,
    contentSpaceExportFileAsPdfRequestSchema, contentSpaceExportFileAsPdfResultSchema),

  listAttachments: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listAttachments,
    contentSpaceListAttachmentsRequestSchema, contentSpaceListAttachmentsResultSchema),
  addAttachment: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.addAttachment,
    contentSpaceAddAttachmentRequestSchema, contentSpaceAddAttachmentResultSchema),
  removeAttachment: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.removeAttachment,
    contentSpaceRemoveAttachmentRequestSchema, contentSpaceRemoveAttachmentResultSchema),

  listRelations: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listRelations,
    contentSpaceListRelationsRequestSchema, contentSpaceListRelationsResultSchema),
  createRelation: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.createRelation,
    contentSpaceCreateRelationRequestSchema, contentSpaceCreateRelationResultSchema),
  removeRelation: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.removeRelation,
    contentSpaceRemoveRelationRequestSchema, contentSpaceRemoveRelationResultSchema),

  listTags: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listTags,
    contentSpaceListTagsRequestSchema, contentSpaceListTagsResultSchema),
  setTags: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.setTags,
    contentSpaceSetTagsRequestSchema, contentSpaceSetTagsResultSchema),
  removeTags: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.removeTags,
    contentSpaceRemoveTagsRequestSchema, contentSpaceRemoveTagsResultSchema),

  createPublication: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.createPublication,
    contentSpaceCreatePublicationRequestSchema, contentSpaceCreatePublicationResultSchema),
  listPublications: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listPublications,
    contentSpaceListPublicationsRequestSchema, contentSpaceListPublicationsResultSchema),
  cancelPublication: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.cancelPublication,
    contentSpaceCancelPublicationRequestSchema, contentSpaceCancelPublicationResultSchema),
  createShare: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.createShare,
    contentSpaceCreateShareRequestSchema, contentSpaceCreateShareResultSchema),
  listShares: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listShares,
    contentSpaceListSharesRequestSchema, contentSpaceListSharesResultSchema),
  cancelShare: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.cancelShare,
    contentSpaceCancelShareRequestSchema, contentSpaceCancelShareResultSchema),

  listAlbums: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listAlbums,
    contentSpaceListAlbumsRequestSchema, contentSpaceListAlbumsResultSchema),
  listAlbumEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listAlbumEntries,
    contentSpaceListAlbumEntriesRequestSchema, contentSpaceListAlbumEntriesResultSchema),
  addFavorite: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.addFavorite,
    contentSpaceAddFavoriteRequestSchema, contentSpaceAddFavoriteResultSchema),
  removeFavorite: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.removeFavorite,
    contentSpaceRemoveFavoriteRequestSchema, contentSpaceRemoveFavoriteResultSchema),

  getCurrentPrincipal: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.getCurrentPrincipal,
    contentSpaceGetCurrentPrincipalRequestSchema, contentSpaceGetCurrentPrincipalResultSchema),
  searchUsers: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchUsers,
    contentSpaceSearchUsersRequestSchema, contentSpaceSearchUsersResultSchema),
  searchDepartments: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchDepartments,
    contentSpaceSearchDepartmentsRequestSchema, contentSpaceSearchDepartmentsResultSchema),
  searchPositions: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchPositions,
    contentSpaceSearchPositionsRequestSchema, contentSpaceSearchPositionsResultSchema),
  searchGroups: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchGroups,
    contentSpaceSearchGroupsRequestSchema, contentSpaceSearchGroupsResultSchema),

  listPermissionCategories: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listPermissionCategories,
    contentSpaceListPermissionCategoriesRequestSchema, contentSpaceListPermissionCategoriesResultSchema),
  listPermissions: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listPermissions,
    contentSpaceListPermissionsRequestSchema, contentSpaceListPermissionsResultSchema),
  changePermissions: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.changePermissions,
    contentSpaceChangePermissionsRequestSchema, contentSpaceChangePermissionsResultSchema),

  listCollaborationEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listCollaborationEntries,
    contentSpaceListCollaborationEntriesRequestSchema, contentSpaceListCollaborationEntriesResultSchema),
  searchCollaborationEntries: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchCollaborationEntries,
    contentSpaceSearchCollaborationEntriesRequestSchema, contentSpaceSearchCollaborationEntriesResultSchema),
  resolveCollaborationInvitation: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.resolveCollaborationInvitation,
    contentSpaceResolveCollaborationInvitationRequestSchema, contentSpaceResolveCollaborationInvitationResultSchema),

  listKnowledgeCollections: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.listKnowledgeCollections,
    contentSpaceListKnowledgeCollectionsRequestSchema, contentSpaceListKnowledgeCollectionsResultSchema),
  searchKnowledgeCollections: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.searchKnowledgeCollections,
    contentSpaceSearchKnowledgeCollectionsRequestSchema, contentSpaceSearchKnowledgeCollectionsResultSchema),
  browseKnowledgeCollection: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.browseKnowledgeCollection,
    contentSpaceBrowseKnowledgeCollectionRequestSchema, contentSpaceBrowseKnowledgeCollectionResultSchema),

  updateTeamMemberRole: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.updateTeamMemberRole,
    contentSpaceUpdateTeamMemberRoleRequestSchema, contentSpaceUpdateTeamMemberRoleResultSchema),
  transferTeamOwnership: operationContract(CONTENT_SPACE_EXTENDED_OPERATIONS.transferTeamOwnership,
    contentSpaceTransferTeamOwnershipRequestSchema, contentSpaceTransferTeamOwnershipResultSchema)
})

export type ContentSpaceExtendedOperationKey = keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS

/**
 * Returns the canonical Agent input schema for one extended operation. Only the
 * three transfer operations differ: they accept an active Workspace-relative
 * path and never a Host transfer handle or Provider path.
 */
export function contentSpaceAgentExtendedRequestSchema(
  operation: ContentSpaceExtendedOperationKey
): z.ZodType {
  switch (operation) {
    case 'updateFileVersion':
      return contentSpaceAgentUpdateFileVersionRequestSchema
    case 'exportFileAsPdf':
      return contentSpaceAgentExportFileAsPdfRequestSchema
    case 'addAttachment':
      return contentSpaceAgentAddAttachmentRequestSchema
    default:
      return CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[operation].requestSchema
  }
}
