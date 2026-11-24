import { z } from 'zod'
export * from './resource-contract.js'

/** Upper bound for one note layer, in characters. */
export const NOTE_LAYER_MAX_CHARS = 4096

const layer = z.string().min(1).max(NOTE_LAYER_MAX_CHARS)

/**
 * Four-layer structured literature note: the atom the knowledge net stores.
 * Strict: a fifth layer, an unknown relation, an empty or oversized layer is rejected.
 */
export const knowledgeNoteSchema = z.strictObject({
  definition: layer,
  roleInPaper: layer,
  argumentativeRelation: z.strictObject({
    relation: z.enum(['support', 'refute', 'qualify']),
    detail: layer.optional()
  }),
  criticalExtension: layer
})

export type KnowledgeNote = z.infer<typeof knowledgeNoteSchema>

export const KNOWLEDGE_RECORD_KIND = 'knowledge-net.record'

export const KNOWLEDGE_NET_CAPABILITY_IDS = Object.freeze({
  noteCommit: 'knowledge-net.note.commit',
  lookup: 'knowledge-net.lookup',
  annotate: 'knowledge-net.annotate',
  graphExport: 'knowledge-net.graph.export',
  documentExport: 'knowledge-net.document.export',
  zoteroRead: 'knowledge-net.zotero.read',
  zoteroImport: 'knowledge-net.zotero.import',
  zoteroWrite: 'knowledge-net.zotero.write'
})

const shortText = z.string().trim().min(1).max(512)
const longText = z.string().trim().min(1).max(NOTE_LAYER_MAX_CHARS)

/** One excavated concept inside a record. Depth is capped at one inline sub-concept. */
export const knowledgeConceptSchema = z.strictObject({
  term: shortText,
  definition: longText,
  provenance: z.strictObject({ quote: longText.optional() }).optional(),
  contrastWith: longText.optional(),
  analogy: longText.optional(),
  subConcept: z.strictObject({ term: shortText, definition: longText }).optional()
})

/**
 * The sealed record the knowledge net stores per paper: excavated concepts, reading
 * targets not yet excavated, and an optional 4-layer note. Committed as an artifact
 * version; the concept index is derived from these and never written back.
 */
export const knowledgeRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  paperId: shortText,
  title: shortText.optional(),
  concepts: z.array(knowledgeConceptSchema).max(200).default([]),
  conceptTargets: z.array(z.strictObject({ term: shortText })).max(200).default([]),
  note: knowledgeNoteSchema.optional()
}).refine(
  (record) => record.concepts.length > 0 || record.conceptTargets.length > 0 || record.note !== undefined,
  { message: 'A record needs at least one concept, reading target or note.' }
)
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>

export const knowledgeNoteCommitInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200),
  record: knowledgeRecordSchema
})
export type KnowledgeNoteCommitInput = z.infer<typeof knowledgeNoteCommitInputSchema>

export const knowledgeNoteCommitResultSchema = z.strictObject({
  artifactId: z.string(),
  versionId: z.string(),
  contentDigest: z.string()
})
export type KnowledgeNoteCommitResult = z.infer<typeof knowledgeNoteCommitResultSchema>

const conceptExplanationSchema = z.object({
  term: z.string(), aliases: z.array(z.string()), definition: z.string(),
  paperId: z.string(), versionId: z.string(), contentDigest: z.string(),
  provenanceQuote: z.string().optional(), contrastWith: z.string().optional(), analogy: z.string().optional()
})
const matchedSubConceptSchema = z.object({ term: z.string(), definition: z.string() })
const derivationCoverageSchema = z.object({
  coverage: z.enum(['complete', 'partial']), coverageReasons: z.array(z.string()), eventsScanned: z.number(),
  skipped: z.array(z.object({ versionId: z.string(), reason: z.string() }))
})
const conceptDerivationSchema = derivationCoverageSchema.extend({ versionsScanned: z.number(), records: z.number() })
export const knowledgeLookupInputSchema = z.strictObject({ query: z.string().trim().min(1).max(200) })
export const knowledgeLookupResultSchema = z.strictObject({
  status: z.enum(['hit', 'multiple_sources', 'gap_unexcavated', 'gap_unknown', 'coverage_unknown']),
  concept: conceptExplanationSchema.optional(),
  matchedSubConcept: matchedSubConceptSchema.optional(),
  matches: z.array(z.object({ concept: conceptExplanationSchema, matchedSubConcept: matchedSubConceptSchema.optional() })),
  target: z.object({
    term: z.string(), paperId: z.string(), versionId: z.string(), contentDigest: z.string()
  }).optional(),
  targets: z.array(z.object({ term: z.string(), paperId: z.string(), versionId: z.string(), contentDigest: z.string() })),
  candidates: z.array(z.strictObject({ term: z.string(), paperId: z.string() })),
  derivedFrom: conceptDerivationSchema
})

export const knowledgeAnnotateInputSchema = z.strictObject({ text: z.string().min(1).max(100_000) })
export const knowledgeAnnotateResultSchema = z.strictObject({
  spans: z.array(z.strictObject({
    start: z.number(), end: z.number(), term: z.string(), status: z.enum(['known', 'unexcavated'])
  })),
  derivedFrom: conceptDerivationSchema
})

export const graphExportInputSchema = z.strictObject({
  format: z.enum(['graphml', 'json-ld']).optional()
})
export type GraphExportInput = z.infer<typeof graphExportInputSchema>

export const graphExportResultSchema = z.strictObject({
  format: z.enum(['graphml', 'json-ld']),
  document: z.string(),
  counts: z.strictObject({ papers: z.number(), concepts: z.number(), resources: z.number(), explains: z.number(), targets: z.number(), uses: z.number(), produces: z.number(), mentions: z.number(), part_of: z.number() }),
  derivedFrom: conceptDerivationSchema
})
export type GraphExportResult = z.infer<typeof graphExportResultSchema>

export const documentExportInputSchema = z.strictObject({
  paperId: shortText.optional(),
  resourceId: shortText.optional(),
  format: z.enum(['markdown', 'json']).optional()
}).refine((input) => Boolean(input.paperId) !== Boolean(input.resourceId), 'Supply exactly one paperId or resourceId.')
export type DocumentExportInput = z.infer<typeof documentExportInputSchema>

export const documentExportResultSchema = z.strictObject({
  paperId: z.string().optional(),
  resourceId: z.string().optional(),
  format: z.enum(['markdown', 'json']),
  document: z.string(),
  sourceRecords: z.number(),
  derivedFrom: conceptDerivationSchema
})
export type DocumentExportResult = z.infer<typeof documentExportResultSchema>
export const zoteroReadInputSchema = z.strictObject({
  start: z.number().int().nonnegative().max(1_000_000).optional(),
  limit: z.number().int().positive().max(100).optional()
})
export type ZoteroReadInput = z.infer<typeof zoteroReadInputSchema>

export const KNOWLEDGE_LIBRARY_KIND = 'knowledge-net.library'

export const KNOWLEDGE_LIBRARY_CAPABILITY_IDS = Object.freeze({
  libraryImport: 'knowledge-net.library.import',
  libraryStatus: 'knowledge-net.library.status',
  libraryPdfs: 'knowledge-net.library.pdfs'
})

export const libraryEntrySchema = z.strictObject({
  paperId: shortText,
  title: longText,
  authors: z.array(shortText).max(500),
  year: z.number().int().min(1000).max(2999).optional(),
  doi: z.string().trim().max(256).optional()
})
export type LibraryEntryRecord = z.infer<typeof libraryEntrySchema>

/**
 * One page of the caller's Zotero library, mapped to library entries.
 * `configured` is false when no credential is stored; the capability then
 * fails closed (off by default) rather than reading anything.
 */
export const zoteroReadResultSchema = z.strictObject({
  configured: z.boolean(),
  items: z.array(libraryEntrySchema),
  totalResults: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  nextStart: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  source: z.literal('zotero')
})
export type ZoteroReadResult = z.infer<typeof zoteroReadResultSchema>

export const zoteroWriteInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200),
  items: z.array(libraryEntrySchema).min(1).max(50)
})
export type ZoteroWriteInput = z.infer<typeof zoteroWriteInputSchema>

/**
 * The write report maps Zotero's per-index response back to paper ids.
 * `created` lists the items Zotero stored; `failed` lists the index-level
 * rejections with their reason.
 */
export const zoteroWriteResultSchema = z.strictObject({
  created: z.array(z.strictObject({
    paperId: z.string(),
    key: z.string(),
    version: z.number().int().nonnegative()
  })),
  unchanged: z.number().int().nonnegative(),
  failed: z.array(z.strictObject({
    index: z.number().int().nonnegative(),
    paperId: z.string().optional(),
    message: z.string().max(2_000).optional()
  })),
  source: z.literal('zotero')
})
export type ZoteroWriteResult = z.infer<typeof zoteroWriteResultSchema>

export const zoteroImportInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200),
  start: z.number().int().nonnegative().max(1_000_000).optional(),
  limit: z.number().int().positive().max(100).optional()
})
export type ZoteroImportInput = z.infer<typeof zoteroImportInputSchema>

/** One page of the caller's Zotero library, sealed as a library version. */
export const zoteroImportResultSchema = z.strictObject({
  artifactId: z.string().nullable(),
  versionId: z.string().nullable(),
  contentDigest: z.string().nullable(),
  imported: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  nextStart: z.number().int().nonnegative().nullable(),
  totalResults: z.number().int().nonnegative(),
  truncated: z.boolean(),
  source: z.literal('zotero')
})
export type ZoteroImportResult = z.infer<typeof zoteroImportResultSchema>

/** One sealed import of a bibliography file. */
export const knowledgeLibrarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.strictObject({ path: z.string().min(1).max(1024), format: z.enum(['bibtex', 'csl-json', 'zotero']) }),
  entries: z.array(libraryEntrySchema).min(1).max(5000)
})
export type KnowledgeLibrary = z.infer<typeof knowledgeLibrarySchema>

export const libraryImportInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200),
  /** Workspace-relative path of a .bib or CSL-JSON file. */
  path: z.string().trim().min(1).max(1024),
  format: z.enum(['bibtex', 'csl-json']).optional()
})
export type LibraryImportInput = z.infer<typeof libraryImportInputSchema>

export const libraryImportResultSchema = z.strictObject({
  artifactId: z.string(),
  versionId: z.string(),
  contentDigest: z.string(),
  format: z.enum(['bibtex', 'csl-json']),
  imported: z.number().int(),
  skipped: z.array(z.strictObject({ id: z.string(), reason: z.string() })).max(50),
  skippedTotal: z.number().int()
})

export const libraryStatusInputSchema = z.strictObject({
  /** Defaults to `all`. */
  state: z.enum(['all', 'read', 'unread', 'unknown']).optional(),
  /** Defaults to 100. */
  limit: z.number().int().min(1).max(500).optional()
})
export type LibraryStatusInput = z.infer<typeof libraryStatusInputSchema>

export const libraryStatusResultSchema = z.strictObject({
  counts: z.strictObject({ total: z.number(), read: z.number(), unread: z.number(), unknown: z.number() }),
  papers: z.array(z.strictObject({
    paperId: z.string(), title: z.string(),
    year: z.number().optional(), doi: z.string().optional(),
    state: z.enum(['read', 'unread', 'unknown'])
  })),
  truncated: z.boolean(),
  derivedFrom: conceptDerivationSchema.extend({
    libraries: z.number(),
    /**
     * Sealed notes whose paperId has no entry in any imported bibliography. They
     * are deliberately absent from `counts` and `papers` — those describe the
     * bibliography, not the notes — but without this number a note that is read
     * and present in the library looks like it does not exist.
     */
    recordsWithoutLibraryMetadata: z.number().int().nonnegative(),
    /** Bounded sample of the above, so the gap is actionable in one call. */
    paperIdsWithoutLibraryMetadata: z.array(z.string()).max(20)
  })
})

const pdfMatchSchema = z.strictObject({
  paperId: z.string(),
  title: z.string(),
  /** Share of the entry title found in the file name, plus a small year bonus. */
  score: z.number(),
  matchedBy: z.array(z.enum(['doi', 'title', 'year']))
})

export const libraryPdfsInputSchema = z.strictObject({})
export type LibraryPdfsInput = z.infer<typeof libraryPdfsInputSchema>

/**
 * Workspace PDFs paired with the sealed library entry their file name fits.
 * Only file names and sizes are read; a PDF is never opened or copied.
 */
export const libraryPdfsResultSchema = z.strictObject({
  counts: z.strictObject({
    pdfs: z.number(), matched: z.number(), unmatched: z.number(), ambiguous: z.number(), libraryPapers: z.number()
  }),
  pdfs: z.array(z.strictObject({
    path: z.string(),
    sizeBytes: z.number(),
    matched: pdfMatchSchema.nullable(),
    candidates: z.array(pdfMatchSchema)
  })),
  truncated: z.boolean(),
  truncatedReasons: z.array(z.string()),
  derivedFrom: conceptDerivationSchema.extend({ libraries: z.number() })
})
export type LibraryPdfsResult = z.infer<typeof libraryPdfsResultSchema>
