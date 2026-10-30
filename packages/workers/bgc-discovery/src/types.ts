export type BgcToolStatus = 'available' | 'missing' | 'not_configured'

export type BgcResourceKind = 'antismash' | 'bigscape' | 'mibig_json' | 'pfam_a_hmm' | 'custom'

export type BgcRegisteredResource = {
  kind: BgcResourceKind
  path?: string
  url?: string
  version?: string
  notes?: string
  registeredAt: string
}

export type BgcResourceRegistry = {
  version: number
  workspaceRoot: string
  cacheRoot?: string
  resources: Partial<Record<BgcResourceKind, BgcRegisteredResource>>
}

export type BgcResourceState = 'available' | 'missing' | 'not_configured'

export type BgcResourceStatusRequest = {
  workspaceRoot?: string
  cacheRoot?: string
  antismashBin?: string
  bigscapeBin?: string
  mibigPath?: string
  bigscapePath?: string
  pfamPath?: string
}

export type BgcResourceStatusResult = {
  ok: boolean
  workspaceRoot: string
  registryPath: string
  cacheRoot: string
  resources: {
    antismash: {
      kind: 'antismash'
      status: { state: BgcResourceState; path?: string; note?: string }
      registered?: BgcRegisteredResource
    }
    bigscape: {
      kind: 'bigscape'
      status: { state: BgcResourceState; path?: string; note?: string }
      registered?: BgcRegisteredResource
    }
    mibig_json: {
      kind: 'mibig_json'
      status: { state: BgcResourceState; path?: string; note?: string }
      registered?: BgcRegisteredResource
    }
    pfam_a_hmm: {
      kind: 'pfam_a_hmm'
      status: { state: BgcResourceState; path?: string; note?: string }
      registered?: BgcRegisteredResource
    }
  }
  installPlans: {
    antismash: string[]
    bigscape: string[]
    mibig_json: string[]
  }
}

export type BgcRegisterResourceRequest = {
  workspaceRoot?: string
  kind: BgcResourceKind
  path?: string
  url?: string
  version?: string
  notes?: string
}

export type BgcDownloadResourceRequest = {
  workspaceRoot?: string
  cacheRoot?: string
  kind?: BgcResourceKind
  url?: string
  version?: string
  targetDir?: string
  fileName?: string
  extract?: boolean
  overwrite?: boolean
  register?: boolean
  notes?: string
}

export type BgcDownloadResourceResult = {
  ok: boolean
  kind: BgcResourceKind
  url: string
  downloadedPath: string
  extractedPath?: string
  resourcePath: string
  registered: boolean
  registryPath?: string
}

export type BgcStatusResult = {
  ok: boolean
  workspaceRoot: string
  tools: {
    antismash: { status: BgcToolStatus; path?: string; note?: string }
    bigscape: { status: BgcToolStatus; path?: string; note?: string }
  }
  databaseHints: {
    mibigPath?: string
    pfamPath?: string
  }
  outputRoot: string
}

export type AntismashRegionRecord = {
  bgcId: string
  regionId: string
  contigId?: string
  organism?: string
  start?: number
  end?: number
  bgcType: string
  product?: string
  predictedProductClass?: string
  coreGenes: string[]
  tailoringEnzymes: string[]
  regulators: string[]
  knownClusterHits: string[]
  nearestMibigHit?: string
  sourceFile: string
  toolSource: 'antismash'
}

export type MibigRecord = {
  id: string
  accession?: string
  product?: string
  productClass?: string
  bioactivity?: string
  organism?: string
  publications?: string[]
}

export type BigscapeAssignment = {
  bgcId: string
  geneClusterFamily?: string
  familySize?: number
  mibigMembersInFamily: string[]
  networkNeighbors: string[]
}

export type CandidateBgcCard = {
  cardType: 'candidate_bgc_card'
  cardVersion: 'sciforge-bgc-v1'
  bgcId: string
  regionId: string
  contigId?: string
  organism?: string
  genomeAccession?: string
  start?: number
  end?: number
  bgcType: string
  product?: string
  predictedProductClass?: string
  coreGenes: string[]
  tailoringEnzymes: string[]
  regulators: string[]
  knownClusterHits: string[]
  nearestMibigHit?: string
  knownProduct?: string
  knownProductClass?: string
  knownActivity?: string
  geneClusterFamily?: string
  familySize?: number
  mibigMembersInFamily: string[]
  networkNeighbors: string[]
  novelty: 'potential_high' | 'known_like' | 'uncertain'
  experimentalFeasibility: 'high' | 'medium' | 'low' | 'unknown'
  ruleScore: number
  priorityTier: 'high' | 'medium' | 'low' | 'retain_for_audit'
  activationStrategy: string[]
  evidence: Array<{ source: string; label: string; detail: string }>
  sourceFile: string
  toolSource: string
}

export type BgcPipelineRequest = {
  workspaceRoot: string
  genomePath?: string
  accession?: string
  antismashOutput?: string
  runAntismash?: boolean
  taxon?: 'fungi' | 'bacteria' | 'plants' | 'auto'
  antismashBin?: string
  mibigPath?: string
  bigscapePath?: string
  bigscapeBin?: string
  outputDir?: string
  cpus?: number
  maxRegions?: number
}

export type BgcPipelineResult = {
  ok: boolean
  runId: string
  outputDir: string
  counts: {
    antismashRegions: number
    mibigRecordsUsed: number
    bigscapeAssignments: number
    cards: number
  }
  files: {
    manifest: string
    cardsDir: string
    rankingJson: string
    rankingCsv: string
    summaryMarkdown: string
  }
  topCandidates: CandidateBgcCard[]
  warnings: string[]
}
