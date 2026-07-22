import { z } from 'zod'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  PAPER_RADAR_CAPABILITY_IDS,
  paperRadarApiResultSchema,
  paperRadarArxivSyncInputSchema,
  paperRadarBiorxivSyncInputSchema,
  paperRadarDigestInputSchema,
  paperRadarDigestResultSchema,
  paperRadarProfileListResultSchema,
  paperRadarProfileSaveResultSchema,
  paperRadarProfileSchema,
  paperRadarProfileSyncInputSchema,
  paperRadarProfileSyncResultSchema,
  paperRadarRankInputSchema,
  paperRadarRankResultSchema,
  paperRadarReviewInputSchema,
  paperRadarReviewResultSchema,
  paperRadarSearchInputSchema,
  paperRadarSearchResultSchema,
  paperRadarStatusSchema,
  paperRadarSyncResultSchema,
  type PaperRadarApiResult,
  type PaperRadarArxivSyncInput,
  type PaperRadarBiorxivSyncInput,
  type PaperRadarDigestInput,
  type PaperRadarDigestResult,
  type PaperRadarProfile,
  type PaperRadarProfileListResult,
  type PaperRadarProfileSaveResult,
  type PaperRadarProfileSyncInput,
  type PaperRadarProfileSyncResult,
  type PaperRadarRankInput,
  type PaperRadarRankResult,
  type PaperRadarReviewInput,
  type PaperRadarReviewResult,
  type PaperRadarSearchInput,
  type PaperRadarSearchResult,
  type PaperRadarStatus,
  type PaperRadarSyncResult
} from '../contract'

const emptyInputSchema = z.object({}).strict()

export const paperRadarCapabilityContracts = Object.freeze({
  status: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.status,
    effect: 'read' as const,
    inputSchema: emptyInputSchema,
    outputSchema: paperRadarStatusSchema
  },
  syncArxiv: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.syncArxiv,
    effect: 'external-write' as const,
    inputSchema: paperRadarArxivSyncInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarSyncResultSchema)
  },
  syncBiorxiv: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.syncBiorxiv,
    effect: 'external-write' as const,
    inputSchema: paperRadarBiorxivSyncInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarSyncResultSchema)
  },
  syncProfile: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.syncProfile,
    effect: 'external-write' as const,
    inputSchema: paperRadarProfileSyncInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarProfileSyncResultSchema)
  },
  listProfiles: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.listProfiles,
    effect: 'read' as const,
    inputSchema: emptyInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarProfileListResultSchema)
  },
  saveProfile: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
    effect: 'external-write' as const,
    inputSchema: paperRadarProfileSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarProfileSaveResultSchema)
  },
  review: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.review,
    effect: 'external-write' as const,
    inputSchema: paperRadarReviewInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarReviewResultSchema)
  },
  search: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.search,
    effect: 'read' as const,
    inputSchema: paperRadarSearchInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarSearchResultSchema)
  },
  rank: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.rank,
    effect: 'read' as const,
    inputSchema: paperRadarRankInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarRankResultSchema)
  },
  digest: {
    actionId: PAPER_RADAR_CAPABILITY_IDS.digest,
    effect: 'read' as const,
    inputSchema: paperRadarDigestInputSchema,
    outputSchema: paperRadarApiResultSchema(paperRadarDigestResultSchema)
  }
})

export type PaperRadarMutationConfirmation = Readonly<{
  approval: Readonly<{ mode: 'confirmation' }>
}>

export type PaperRadarCapabilityClient = Readonly<{
  status: () => Promise<PaperRadarStatus>
  syncArxiv: (input: PaperRadarArxivSyncInput, confirmation: PaperRadarMutationConfirmation) => Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncBiorxiv: (input: PaperRadarBiorxivSyncInput, confirmation: PaperRadarMutationConfirmation) => Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncProfile: (input: PaperRadarProfileSyncInput, confirmation: PaperRadarMutationConfirmation) => Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>>
  listProfiles: () => Promise<PaperRadarApiResult<PaperRadarProfileListResult>>
  saveProfile: (profile: PaperRadarProfile, confirmation: PaperRadarMutationConfirmation) => Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>>
  review: (input: PaperRadarReviewInput, confirmation: PaperRadarMutationConfirmation) => Promise<PaperRadarApiResult<PaperRadarReviewResult>>
  search: (input: PaperRadarSearchInput) => Promise<PaperRadarApiResult<PaperRadarSearchResult>>
  rank: (input: PaperRadarRankInput) => Promise<PaperRadarApiResult<PaperRadarRankResult>>
  digest: (input: PaperRadarDigestInput) => Promise<PaperRadarApiResult<PaperRadarDigestResult>>
}>

export function createPaperRadarCapabilityClient(
  client: DomainRendererCapabilityInvoker
): PaperRadarCapabilityClient {
  return Object.freeze({
    status: () => client.invoke(paperRadarCapabilityContracts.status, {}),
    syncArxiv: (input, confirmation) => client.invoke(paperRadarCapabilityContracts.syncArxiv, input, confirmation),
    syncBiorxiv: (input, confirmation) => client.invoke(paperRadarCapabilityContracts.syncBiorxiv, input, confirmation),
    syncProfile: (input, confirmation) => client.invoke(paperRadarCapabilityContracts.syncProfile, input, confirmation),
    listProfiles: () => client.invoke(paperRadarCapabilityContracts.listProfiles, {}),
    saveProfile: (profile, confirmation) => client.invoke(paperRadarCapabilityContracts.saveProfile, profile, confirmation),
    review: (input, confirmation) => client.invoke(paperRadarCapabilityContracts.review, input, confirmation),
    search: (input) => client.invoke(paperRadarCapabilityContracts.search, input),
    rank: (input) => client.invoke(paperRadarCapabilityContracts.rank, input),
    digest: (input) => client.invoke(paperRadarCapabilityContracts.digest, input)
  })
}
