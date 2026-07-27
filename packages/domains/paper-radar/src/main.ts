import {
  createPaperRadarService,
  paperRadarPathsFromEnv,
  type PaperRadarService
} from '@sciforge/paper-radar/service'
import { paperRadarErrorPayloadFromUnknown } from '@sciforge/paper-radar/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { z } from 'zod'
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
} from './contract.js'
import {
  PAPER_RADAR_CAPABILITY_FACTORY_CONTRIBUTION,
  PAPER_RADAR_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from './definition.js'

export const PAPER_RADAR_SERVICE_ID = 'sciforge.paper-radar'

export type PaperRadarWorkerServiceOptions = {
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  service?: PaperRadarService
}

export type PaperRadarWorkerService = {
  status(): Promise<PaperRadarStatus>
  syncArxiv(input: PaperRadarArxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncBiorxiv(input: PaperRadarBiorxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncProfile(input: PaperRadarProfileSyncInput): Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>>
  listProfiles(): Promise<PaperRadarApiResult<PaperRadarProfileListResult>>
  saveProfile(input: PaperRadarProfile): Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>>
  review(input: PaperRadarReviewInput): Promise<PaperRadarApiResult<PaperRadarReviewResult>>
  search(input: PaperRadarSearchInput): Promise<PaperRadarApiResult<PaperRadarSearchResult>>
  rank(input: PaperRadarRankInput): Promise<PaperRadarApiResult<PaperRadarRankResult>>
  digest(input: PaperRadarDigestInput): Promise<PaperRadarApiResult<PaperRadarDigestResult>>
  close(): void
}

export type PaperRadarCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global'
  effect: 'read' | 'compute' | 'external-write'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: any) => { output: unknown } | Promise<{ output: unknown }>
}>

/** Injected by the main host so this package has no dependency on application internals. */
export type PaperRadarCapabilityBuilder<CapabilityDefinition = unknown> = (
  options: PaperRadarCapabilityOptions
) => CapabilityDefinition

export type PaperRadarCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof PAPER_RADAR_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'paper-radar'
    title: 'Paper Radar'
    directTransportPrefixes: readonly ['paperRadar:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type PaperRadarMainContribution<CapabilityDefinition = unknown> =
  PaperRadarCapabilityFactory<CapabilityDefinition>

type PaperRadarMainHost = DomainMainHost & Readonly<{
  env?: NodeJS.ProcessEnv
  createWorkerService?: (options: PaperRadarWorkerServiceOptions) => PaperRadarWorkerService
}>

export function createPaperRadarWorkerService(
  options: PaperRadarWorkerServiceOptions = {}
): PaperRadarWorkerService {
  const service = options.service ?? createPaperRadarService({
    ...paperRadarPathsFromEnv({
      env: options.env,
      userDataDir: options.userDataDir
    }),
    env: options.env
  })
  return new LocalPaperRadarWorkerService(service)
}

/**
 * Provides the Paper Radar main-process contributions as raw entry input. The host
 * binds this input to its installed package set before registering the values.
 */
export function createDomainMainEntry(
  host: PaperRadarMainHost
): TrustedDomainProcessEntryInput<PaperRadarMainContribution> {
  let service: PaperRadarWorkerService | undefined
  const getService = () => {
    service ??= (host.createWorkerService ?? createPaperRadarWorkerService)({
      userDataDir: host.getUserDataDir(),
      env: host.env
    })
    return service
  }
  const capabilityFactory = createPaperRadarCapabilityFactory({
    defineCapability: host.defineCapability,
    getPaperRadarService: getService
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PAPER_RADAR_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory,
        onDispose: () => {
          service?.close()
          service = undefined
        }
      }
    ]
  }
}

export function createPaperRadarCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: PaperRadarCapabilityBuilder<CapabilityDefinition>
  getPaperRadarService: () => PaperRadarWorkerService
}>): PaperRadarCapabilityFactory<CapabilityDefinition> {
  const emptyInputSchema = z.object({}).strict()
  const syncApiResultSchema = paperRadarApiResultSchema(paperRadarSyncResultSchema)
  const profileSyncApiResultSchema = paperRadarApiResultSchema(paperRadarProfileSyncResultSchema)
  const profileListApiResultSchema = paperRadarApiResultSchema(paperRadarProfileListResultSchema)
  const profileSaveApiResultSchema = paperRadarApiResultSchema(paperRadarProfileSaveResultSchema)
  const reviewApiResultSchema = paperRadarApiResultSchema(paperRadarReviewResultSchema)
  const searchApiResultSchema = paperRadarApiResultSchema(paperRadarSearchResultSchema)
  const rankApiResultSchema = paperRadarApiResultSchema(paperRadarRankResultSchema)
  const digestApiResultSchema = paperRadarApiResultSchema(paperRadarDigestResultSchema)
  const { defineCapability, getPaperRadarService } = options

  return Object.freeze({
    moduleId: PAPER_RADAR_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'paper-radar' as const,
      title: 'Paper Radar' as const,
      directTransportPrefixes: Object.freeze(['paperRadar:']) as readonly ['paperRadar:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.status,
        version: '1.0.0',
        title: 'Read Paper Radar status',
        description: 'Returns the current status and local index statistics for Paper Radar.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['paper-radar', 'status'], inputSchema: emptyInputSchema, outputSchema: paperRadarStatusSchema,
        handler: async () => ({ output: paperRadarStatusSchema.parse(await getPaperRadarService().status()) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.syncArxiv,
        version: '1.0.0', title: 'Sync arXiv papers',
        description: 'Synchronizes a bounded arXiv paper set into the local Paper Radar index.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['paper-radar', 'sync', 'arxiv'], inputSchema: paperRadarArxivSyncInputSchema, outputSchema: syncApiResultSchema,
        handler: async (input) => ({ output: syncApiResultSchema.parse(await getPaperRadarService().syncArxiv(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.syncBiorxiv,
        version: '1.0.0', title: 'Sync bioRxiv papers',
        description: 'Synchronizes a bounded bioRxiv paper set into the local Paper Radar index.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['paper-radar', 'sync', 'biorxiv'], inputSchema: paperRadarBiorxivSyncInputSchema, outputSchema: syncApiResultSchema,
        handler: async (input) => ({ output: syncApiResultSchema.parse(await getPaperRadarService().syncBiorxiv(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.syncProfile,
        version: '1.0.0', title: 'Sync a Paper Radar profile',
        description: 'Synchronizes papers matching one configured Paper Radar profile.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['paper-radar', 'sync', 'profile'], inputSchema: paperRadarProfileSyncInputSchema, outputSchema: profileSyncApiResultSchema,
        handler: async (input) => ({ output: profileSyncApiResultSchema.parse(await getPaperRadarService().syncProfile(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.listProfiles,
        version: '1.0.0', title: 'List Paper Radar profiles',
        description: 'Lists the locally configured Paper Radar profiles.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['paper-radar', 'profile', 'discovery'], inputSchema: emptyInputSchema, outputSchema: profileListApiResultSchema,
        handler: async () => ({ output: profileListApiResultSchema.parse(await getPaperRadarService().listProfiles()) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
        version: '1.0.0', title: 'Save a Paper Radar profile',
        description: 'Creates or updates one local Paper Radar profile.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['paper-radar', 'profile'], inputSchema: paperRadarProfileSchema, outputSchema: profileSaveApiResultSchema,
        handler: async (input) => ({ output: profileSaveApiResultSchema.parse(await getPaperRadarService().saveProfile(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.review,
        version: '1.0.0', title: 'Review papers for a profile',
        description: 'Synchronizes and generates a Paper Radar review for one profile.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['paper-radar', 'review'], inputSchema: paperRadarReviewInputSchema, outputSchema: reviewApiResultSchema,
        handler: async (input) => ({ output: reviewApiResultSchema.parse(await getPaperRadarService().review(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.search,
        version: '1.0.0', title: 'Search Paper Radar papers',
        description: 'Searches the local Paper Radar index with bounded filters.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['paper-radar', 'search'], inputSchema: paperRadarSearchInputSchema, outputSchema: searchApiResultSchema,
        handler: async (input) => ({ output: searchApiResultSchema.parse(await getPaperRadarService().search(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.rank,
        version: '1.0.0', title: 'Rank Paper Radar papers',
        description: 'Ranks papers from the local Paper Radar index for a profile or keyword set.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['paper-radar', 'rank'], inputSchema: paperRadarRankInputSchema, outputSchema: rankApiResultSchema,
        handler: async (input) => ({ output: rankApiResultSchema.parse(await getPaperRadarService().rank(input)) })
      }),
      defineCapability({
        id: PAPER_RADAR_CAPABILITY_IDS.digest,
        version: '1.0.0', title: 'Generate a Paper Radar digest',
        description: 'Generates a digest from the local Paper Radar index for a profile or keyword set.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['paper-radar', 'digest'], inputSchema: paperRadarDigestInputSchema, outputSchema: digestApiResultSchema,
        handler: async (input) => ({ output: digestApiResultSchema.parse(await getPaperRadarService().digest(input)) })
      })
    ]
  })
}

class LocalPaperRadarWorkerService implements PaperRadarWorkerService {
  constructor(private readonly service: PaperRadarService) {}

  async status(): Promise<PaperRadarStatus> {
    try {
      const diagnostics = this.service.diagnostics()
      return { ok: true, service: PAPER_RADAR_SERVICE_ID, stats: diagnostics.stats, checkedAt: diagnostics.checkedAt }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async syncArxiv(input: PaperRadarArxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
    return apiResult(async () => this.service.syncArxiv({
      categories: input.categories, since: input.since, until: input.until, maxRecords: input.maxRecords
    }))
  }

  async syncBiorxiv(input: PaperRadarBiorxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
    return apiResult(async () => this.service.syncBiorxiv({ from: input.from, to: input.to, maxRecords: input.maxRecords }))
  }

  async syncProfile(input: PaperRadarProfileSyncInput): Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>> {
    return apiResult(async () => {
      const result = await this.service.syncProfile({
        profile: input.profile, from: input.from, to: input.to, max_records: input.maxRecords
      })
      return { profile: result.profile, results: result.results }
    })
  }

  async listProfiles(): Promise<PaperRadarApiResult<PaperRadarProfileListResult>> {
    return apiResult(async () => ({ profiles: this.service.listProfiles().profiles }))
  }

  async saveProfile(input: PaperRadarProfile): Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>> {
    return apiResult(async () => ({ profile: this.service.saveProfile({
      name: input.name, description: input.description, keywords: input.keywords,
      exclude_keywords: input.excludeKeywords, arxiv_categories: input.arxivCategories,
      biorxiv_subjects: input.biorxivSubjects
    }).profile }))
  }

  async review(input: PaperRadarReviewInput): Promise<PaperRadarApiResult<PaperRadarReviewResult>> {
    return apiResult(async () => {
      const days = input.days ?? 7
      const saved = this.service.saveProfile({
        name: input.profile.name, description: input.profile.description, keywords: input.profile.keywords,
        exclude_keywords: input.profile.excludeKeywords, arxiv_categories: input.profile.arxivCategories,
        biorxiv_subjects: input.profile.biorxivSubjects
      })
      const { from, to } = reviewDateRange(days)
      const sync = await this.service.syncProfile({
        profile: saved.profile.name, from, to, max_records: input.maxRecords
      })
      const digest = await this.service.digest({
        profile: saved.profile.name,
        keywords: input.profile.keywords,
        exclude_keywords: input.profile.excludeKeywords,
        days,
        top_k: input.topK
      })
      return { ...digest, syncResults: sync.results }
    })
  }

  async search(input: PaperRadarSearchInput): Promise<PaperRadarApiResult<PaperRadarSearchResult>> {
    return apiResult(async () => this.service.search({
      query: input.query, sources: input.sources, categories: input.categories,
      from: input.from, to: input.to, top_k: input.topK
    }))
  }

  async rank(input: PaperRadarRankInput): Promise<PaperRadarApiResult<PaperRadarRankResult>> {
    return apiResult(async () => this.service.rank({ ...rankInput(input), profile: input.profile }))
  }

  async digest(input: PaperRadarDigestInput): Promise<PaperRadarApiResult<PaperRadarDigestResult>> {
    return apiResult(async () => this.service.digest({ ...rankInput(input), profile: input.profile }))
  }

  close(): void { this.service.close() }
}

function rankInput(input: PaperRadarRankInput | PaperRadarDigestInput) {
  return {
    query: input.query, sources: input.sources, categories: input.categories,
    from: input.from, to: input.to, top_k: input.topK, keywords: input.keywords,
    exclude_keywords: input.excludeKeywords, days: input.days
  }
}

function reviewDateRange(days = 1): { from: string; to: string } {
  const today = new Date()
  const fromDate = new Date(today)
  fromDate.setDate(today.getDate() - Math.max(1, days))
  return { from: fromDate.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
}

async function apiResult<T>(fn: () => T | Promise<T>): Promise<PaperRadarApiResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  return paperRadarErrorPayloadFromUnknown(error).reason
}
