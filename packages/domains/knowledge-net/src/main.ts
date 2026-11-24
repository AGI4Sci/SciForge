import {
  createArtifactVersionCommitPortV1,
  createArtifactVersionEventListPortV1,
  createArtifactVersionReadPortV1
} from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  KNOWLEDGE_LIBRARY_CAPABILITY_IDS,
  KNOWLEDGE_LIBRARY_KIND,
  KNOWLEDGE_NET_CAPABILITY_IDS,
  KNOWLEDGE_RECORD_KIND,
  knowledgeLibrarySchema,
  libraryImportInputSchema,
  libraryImportResultSchema,
  libraryPdfsInputSchema,
  libraryPdfsResultSchema,
  libraryStatusInputSchema,
  libraryStatusResultSchema,
  graphExportInputSchema,
  graphExportResultSchema,
  documentExportInputSchema,
  documentExportResultSchema,
  type LibraryImportInput,
  type LibraryPdfsInput,
  type LibraryStatusInput,
  type GraphExportInput,
  type DocumentExportInput,
  knowledgeAnnotateInputSchema,
  knowledgeAnnotateResultSchema,
  knowledgeLookupInputSchema,
  knowledgeLookupResultSchema,
  knowledgeNoteCommitInputSchema,
  knowledgeNoteCommitResultSchema,
  type KnowledgeLibrary,
  type KnowledgeNoteCommitInput,
  zoteroReadInputSchema,
  zoteroReadResultSchema,
  type ZoteroReadInput,
  zoteroImportInputSchema,
  zoteroImportResultSchema,
  type ZoteroImportInput,
  zoteroWriteInputSchema,
  zoteroWriteResultSchema,
  type ZoteroWriteInput
} from './contract.js'
import { ZoteroClient, toLibraryEntry, toWritableItem } from '@sciforge/zotero-connector'
import { annotateText, lookupConcept } from './core/concept-index.js'
import { parseLibrary } from './core/library-parse.js'
import { buildKnowledgeGraph, countGraph, graphToGraphML, graphToJsonLd } from './core/graph.js'
import { renderKnowledgeDocument } from './core/document.js'
import { matchPdfStem, type LibraryEntryForMatch } from './core/pdf-match.js'
import { definitionBytes, deriveKnowledgeIndex, deriveKnowledgeState, sha256, MAX_SEALED_BYTES } from './derive.js'
import { listWorkspacePdfs } from './workspace-pdfs.js'
import { readWorkspaceFile } from './workspace-file.js'
import { domainPackageDefinition } from './definition.js'
import { createResourceCapabilities } from './resource-capabilities.js'
import { renderResourceDocument } from './core/resource-document.js'

/** A bibliography file larger than this is refused before it is read. */
const MAX_LIBRARY_FILE_BYTES = 8 * 1024 * 1024

type CapabilityContext = Readonly<{
  caller: Readonly<{ workspaceId?: string }>
  signal?: AbortSignal
  assertPrincipalCurrent?: () => void | Promise<void>
}>

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  const requireWorkspace = (context: CapabilityContext, action: string): string => {
    const workspaceRoot = context.caller.workspaceId?.trim()
    if (!workspaceRoot) throw new Error(`Knowledge net ${action} requires a workspace-scoped caller.`)
    if (!host.capabilities) throw new Error(`Knowledge net ${action} requires the Artifact Versions capability host.`)
    return workspaceRoot
  }
  const derive = (workspaceRoot: string, signal?: AbortSignal) => deriveKnowledgeIndex({
    eventPort: createArtifactVersionEventListPortV1(host.capabilities!, workspaceRoot),
    readPort: createArtifactVersionReadPortV1(host.capabilities!, workspaceRoot),
    ...(signal ? { signal } : {})
  })

  const deriveState = (workspaceRoot: string, signal?: AbortSignal) => deriveKnowledgeState({
    eventPort: createArtifactVersionEventListPortV1(host.capabilities!, workspaceRoot),
    readPort: createArtifactVersionReadPortV1(host.capabilities!, workspaceRoot),
    ...(signal ? { signal } : {})
  })

  return {
    definition: domainPackageDefinition,
    contributions: [{
      kind: 'main.capability-factory',
      id: 'knowledge-net.capabilities',
      value: {
        moduleId: domainPackageDefinition.module.id,
        policy: { id: 'knowledge-net', title: 'Knowledge Net', directTransportPrefixes: [], allowedDirectTransports: [] },
        createDefinitions: () => [
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.noteCommit,
            version: '1.0.0',
            title: 'Keep a literature record',
            description: 'Seals one paper record (excavated concepts, reading targets, optional 4-layer note) as an immutable Artifact Version. The concept index is derived from sealed records and is never written directly.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'workspace-write', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'required' },
            tags: ['knowledge-net', 'literature', 'note', 'artifact'],
            inputSchema: knowledgeNoteCommitInputSchema, outputSchema: knowledgeNoteCommitResultSchema,
            handler: async (input: KnowledgeNoteCommitInput, context: CapabilityContext) => {
              const workspaceRoot = requireWorkspace(context, 'note commit')
              await assertCurrent(context)
              const bytes = definitionBytes(input.record)
              if (bytes.length > MAX_SEALED_BYTES) throw new Error('The sealed record exceeds the derivation size limit.')
              const committed = await createArtifactVersionCommitPortV1(host.capabilities!, workspaceRoot).commit({
                idempotencyKey: `knowledge-net/record:${input.operationId}`,
                candidates: [{
                  candidateId: 'record',
                  expectedCurrentVersionId: null,
                  kind: KNOWLEDGE_RECORD_KIND,
                  label: `Literature record of ${input.record.paperId}`.slice(0, 512),
                  intent: 'save',
                  content: { mode: 'snapshot', dataBase64: bytes.toString('base64'), mediaType: 'application/json' },
                  metadata: { paperId: input.record.paperId }
                }]
              })
              if (!committed.ok) throw new Error(`Artifact versions were not committed: ${committed.issue.message}`)
              const item = committed.value.versions[0]
              if (!item) throw new Error('Artifact versions commit returned no version.')
              const storage = item.version.storage
              if (storage.mode !== 'snapshot') throw new Error('Artifact commit returned no sealed snapshot.')
              if (storage.contentDigest !== sha256(bytes)) throw new Error('Artifact commit digest does not match the record.')
              await assertCurrent(context)
              return {
                output: knowledgeNoteCommitResultSchema.parse({
                  artifactId: item.artifact.artifactId,
                  versionId: item.version.versionId,
                  contentDigest: storage.contentDigest
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryImport,
            version: '1.0.0',
            title: 'Import a bibliography file into the library',
            description: 'Reads one BibTeX or CSL-JSON file from the workspace (the formats Zotero exports) and seals its entries as an immutable library version. Only bibliographic metadata is kept: id, title, authors, year, DOI. Nothing outside the workspace is read, no PDF is read, and nothing leaves the machine. Entries that cannot be used are reported, not dropped silently.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'workspace-write', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'required' },
            tags: ['knowledge-net', 'literature', 'library', 'import', 'bibtex', 'zotero'],
            inputSchema: libraryImportInputSchema, outputSchema: libraryImportResultSchema,
            handler: async (input: LibraryImportInput, context: CapabilityContext) => {
              // Keep this label hyphenated: electron-vite's ESM shim scans the bundle text with a
              // regex, and the bare word followed by a quote mark makes it cut the bundle mid-string.
              const workspaceRoot = requireWorkspace(context, 'library-import')
              await assertCurrent(context)
              const bytes = await readWorkspaceFile(workspaceRoot, input.path, MAX_LIBRARY_FILE_BYTES)
              const parsed = parseLibrary(bytes.toString('utf8'), input.format)
              if (parsed.entries.length === 0) {
                throw new Error(`No usable entries in the file (${parsed.skipped.length} skipped).`)
              }
              const sealed = definitionBytes(knowledgeLibrarySchema.parse({
                schemaVersion: 1,
                source: { path: input.path, format: parsed.format },
                entries: parsed.entries
              }))
              if (sealed.length > MAX_SEALED_BYTES) throw new Error('The sealed library exceeds the derivation size limit.')
              await assertCurrent(context)
              const committed = await createArtifactVersionCommitPortV1(host.capabilities!, workspaceRoot).commit({
                idempotencyKey: `knowledge-net/library:${input.operationId}`,
                candidates: [{
                  candidateId: 'library',
                  expectedCurrentVersionId: null,
                  kind: KNOWLEDGE_LIBRARY_KIND,
                  label: `Library import of ${input.path}`.slice(0, 512),
                  intent: 'save',
                  content: { mode: 'snapshot', dataBase64: sealed.toString('base64'), mediaType: 'application/json' },
                  metadata: { sourcePath: input.path }
                }]
              })
              if (!committed.ok) throw new Error(`Artifact versions were not committed: ${committed.issue.message}`)
              const item = committed.value.versions[0]
              if (!item) throw new Error('Artifact versions commit returned no version.')
              const storage = item.version.storage
              if (storage.mode !== 'snapshot') throw new Error('Artifact commit returned no sealed snapshot.')
              if (storage.contentDigest !== sha256(sealed)) throw new Error('Artifact commit digest does not match the library.')
              await assertCurrent(context)
              return {
                output: libraryImportResultSchema.parse({
                  artifactId: item.artifact.artifactId,
                  versionId: item.version.versionId,
                  contentDigest: storage.contentDigest,
                  format: parsed.format,
                  imported: parsed.entries.length,
                  skipped: parsed.skipped.slice(0, 50),
                  skippedTotal: parsed.skipped.length
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus,
            version: '1.0.0',
            title: 'Show which library papers have a literature record',
            description: 'Lists papers as read when a sealed note exists for the exact paper id, unread when complete caller-visible coverage establishes no note, and unknown when coverage is partial. This is note presence, not proof of human reading or scientific acceptance. Reports coverage; newest observed library metadata wins per paper id.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'library', 'unread'],
            inputSchema: libraryStatusInputSchema, outputSchema: libraryStatusResultSchema,
            handler: async (input: LibraryStatusInput, context: CapabilityContext) => {
              const state = await deriveState(requireWorkspace(context, 'library status'), context.signal)
              await assertCurrent(context)
              const readIds = new Set(state.records.map((record) => record.paperId))
              const all = libraryPapers(state.libraries).map((paper) => ({
                ...paper, state: readIds.has(paper.paperId) ? ('read' as const)
                  : state.provenance.coverage === 'complete' ? ('unread' as const) : ('unknown' as const)
              }))
              const stateFilter = input.state ?? 'all'
              const limit = input.limit ?? 100
              const wanted = stateFilter === 'all' ? all : all.filter((paper) => paper.state === stateFilter)
              const read = all.filter((paper) => paper.state === 'read').length
              const unread = all.filter((paper) => paper.state === 'unread').length
              // Sealed notes are keyed by paperId, the library by bibliography
              // entries. A note for a paper no import mentions is read and real
              // but invisible in `counts`/`papers`, which describe the library.
              const libraryPaperIds = new Set(all.map((paper) => paper.paperId))
              const withoutMetadata = [...new Set(state.records.map((record) => record.paperId))]
                .filter((paperId) => !libraryPaperIds.has(paperId))
              return {
                output: libraryStatusResultSchema.parse({
                  counts: { total: all.length, read, unread, unknown: all.length - read - unread },
                  papers: wanted.slice(0, limit),
                  truncated: wanted.length > limit,
                  derivedFrom: {
                    skipped: state.provenance.skipped,
                    coverage: state.provenance.coverage,
                    coverageReasons: state.provenance.coverageReasons,
                    eventsScanned: state.provenance.eventsScanned,
                    versionsScanned: state.provenance.versionsScanned,
                    records: state.provenance.records,
                    libraries: state.provenance.libraries,
                    recordsWithoutLibraryMetadata: withoutMetadata.length,
                    paperIdsWithoutLibraryMetadata: withoutMetadata.slice(0, 20)
                  }
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryPdfs,
            version: '1.0.0',
            title: 'Pair workspace PDFs with library entries',
            description: 'Lists PDF file names inside the workspace and pairs each with the sealed library entry its file name fits, reporting the evidence behind the match (DOI suffix, title words, year) and a score. Only directory entries and file sizes are read: no PDF is opened, copied, parsed or uploaded, symbolic links are not followed, and the walk is bounded. An ambiguous file name yields candidates instead of a winner; a file that fits nothing stays unmatched. Read-only.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'library', 'pdf', 'files'],
            inputSchema: libraryPdfsInputSchema, outputSchema: libraryPdfsResultSchema,
            handler: async (input: LibraryPdfsInput, context: CapabilityContext) => {
              const workspaceRoot = requireWorkspace(context, 'library PDFs')
              const state = await deriveState(workspaceRoot, context.signal)
              await assertCurrent(context)
              const entries = libraryPapers(state.libraries)
              const scan = await listWorkspacePdfs(workspaceRoot, context.signal ? { signal: context.signal } : {})
              await assertCurrent(context)
              const pdfs = scan.files.map((file) => {
                const name = file.path.slice(file.path.lastIndexOf('/') + 1)
                const { matched, candidates } = matchPdfStem(entries, name.replace(/\.pdf$/iu, ''))
                return { path: file.path, sizeBytes: file.sizeBytes, matched, candidates }
              })
              const matched = pdfs.filter((pdf) => pdf.matched !== null).length
              const ambiguous = pdfs.filter((pdf) => pdf.matched === null && pdf.candidates.length > 0).length
              return {
                output: libraryPdfsResultSchema.parse({
                  counts: {
                    pdfs: pdfs.length, matched, ambiguous,
                    unmatched: pdfs.length - matched - ambiguous, libraryPapers: entries.length
                  },
                  pdfs,
                  truncated: scan.truncated,
                  truncatedReasons: scan.truncatedReasons,
                  derivedFrom: {
                    skipped: state.provenance.skipped,
                    coverage: state.provenance.coverage,
                    coverageReasons: state.provenance.coverageReasons,
                    eventsScanned: state.provenance.eventsScanned,
                    versionsScanned: state.provenance.versionsScanned,
                    records: state.provenance.records,
                    libraries: state.provenance.libraries
                  }
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.lookup,
            version: '1.0.0',
            title: 'Look up a literature concept',
            description: 'Queries sealed literature notes. Returns all matching source explanations with exact versions and conditions; multiple_sources never selects a winner or establishes scientific consensus. Reports caller-visible derivation coverage; a miss under partial coverage is coverage_unknown. Reading targets remain source-specific. Read-only.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'lookup'],
            inputSchema: knowledgeLookupInputSchema, outputSchema: knowledgeLookupResultSchema,
            handler: async (input: { query: string }, context: CapabilityContext) => {
              const { index, provenance } = await derive(requireWorkspace(context, 'lookup'), context.signal)
              await assertCurrent(context)
              const result = lookupConcept(index, input.query)
              return {
                output: knowledgeLookupResultSchema.parse({
                  ...result,
                  status: provenance.coverage === 'partial' && result.matches.length === 0
                    ? 'coverage_unknown' : result.status,
                  derivedFrom: provenance
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.annotate,
            version: '1.0.0',
            title: 'Annotate text with known concepts',
            description: 'Marks spans of the given text that match a known concept (known) or a reading target not yet excavated (unexcavated). Read-only.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'annotate'],
            inputSchema: knowledgeAnnotateInputSchema, outputSchema: knowledgeAnnotateResultSchema,
            handler: async (input: { text: string }, context: CapabilityContext) => {
              const { index, provenance } = await derive(requireWorkspace(context, 'annotate'), context.signal)
              await assertCurrent(context)
              return {
                output: knowledgeAnnotateResultSchema.parse({
                  spans: annotateText(index, input.text).map((span) => ({ ...span })),
                  derivedFrom: provenance
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.graphExport,
            version: '2.0.0',
            title: 'Export the concept graph',
            description: 'Projects the sealed records into a deterministic concept graph — paper nodes joined to the concept nodes they explain or still target — and serializes it as GraphML or JSON-LD. Everything derives from sealed records; no link is invented. Read-only.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'graph', 'export', 'graphml', 'json-ld'],
            inputSchema: graphExportInputSchema, outputSchema: graphExportResultSchema,
            handler: async (input: GraphExportInput, context: CapabilityContext) => {
              const state = await deriveState(requireWorkspace(context, 'graph export'), context.signal)
              await assertCurrent(context)
              const format = input.format ?? 'graphml'
              const graph = buildKnowledgeGraph(state.records, state.resources)
              const document = format === 'json-ld' ? graphToJsonLd(graph) : graphToGraphML(graph)
              return {
                output: graphExportResultSchema.parse({
                  format,
                  document,
                  counts: countGraph(graph),
                  derivedFrom: {
                    skipped: state.provenance.skipped,
                    coverage: state.provenance.coverage,
                    coverageReasons: state.provenance.coverageReasons,
                    eventsScanned: state.provenance.eventsScanned,
                    versionsScanned: state.provenance.versionsScanned,
                    records: state.provenance.records
                  }
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.zoteroRead,
            version: '1.0.0',
            title: 'Read the caller Zotero library',
            description: 'Reads the caller own Zotero library over the Zotero Web API v3 using the credential stored in the Host secure facility. Off by default: with no credential it fails closed and reads nothing. Read-only — nothing is written to Zotero and nothing is committed locally; only bibliographic metadata is kept, and notes, tags, collections and attachments are dropped. Results are paged; truncated says whether more pages exist.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'global', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'library', 'zotero', 'import', 'read'],
            inputSchema: zoteroReadInputSchema, outputSchema: zoteroReadResultSchema,
            handler: async (input: ZoteroReadInput, context: CapabilityContext) => {
              await assertCurrent(context)
              const credential = await readZoteroCredential(host)
              if (!credential) {
                throw new Error('Zotero is not configured: store a Zotero userId and api key in the secure facility first.')
              }
              const client = new ZoteroClient({
                fetch: globalThis.fetch,
                userId: credential.userId,
                apiKey: credential.apiKey
              })
              const page = await client.listItems({ start: input.start, limit: input.limit })
              await assertCurrent(context)
              return {
                output: zoteroReadResultSchema.parse({
                  configured: true,
                  items: page.items.map(toLibraryEntry),
                  totalResults: page.totalResults,
                  start: page.start,
                  returned: page.returned,
                  scanned: page.scanned,
                  nextStart: page.nextStart,
                  truncated: page.hasMore,
                  source: 'zotero'
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.documentExport,
            version: '2.0.0',
            title: 'Export one paper as a knowledge document',
            description: 'Folds every sealed record for one paper into a single deterministic document — concepts (deduplicated by term), reading targets and all 4-layer notes — as Markdown or JSON. Derived only from sealed records. Read-only.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' },
            tags: ['knowledge-net', 'literature', 'document', 'export', 'markdown'],
            inputSchema: documentExportInputSchema, outputSchema: documentExportResultSchema,
            handler: async (input: DocumentExportInput, context: CapabilityContext) => {
              const state = await deriveState(requireWorkspace(context, 'document export'), context.signal)
              await assertCurrent(context)
              const format = input.format ?? 'markdown'
              const sourceRecords = state.records.filter((record) => record.paperId === input.paperId).length
              const resource = input.resourceId ? state.resources.find((item) => item.resourceId === input.resourceId) : undefined
              if (input.resourceId && !resource) throw new Error(state.provenance.coverage === 'partial'
                ? 'coverage_unknown: resource cannot be resolved from partial coverage.' : 'resource_not_found: no recorded resource matches this ID.')
              const document = resource ? renderResourceDocument(resource, format)
                : renderKnowledgeDocument(state.records, input.paperId!, format, state.resources)
              return {
                output: documentExportResultSchema.parse({
                  ...(input.paperId ? { paperId: input.paperId } : { resourceId: input.resourceId }),
                  format,
                  document,
                  sourceRecords,
                  derivedFrom: {
                    skipped: state.provenance.skipped,
                    coverage: state.provenance.coverage,
                    coverageReasons: state.provenance.coverageReasons,
                    eventsScanned: state.provenance.eventsScanned,
                    versionsScanned: state.provenance.versionsScanned,
                    records: state.provenance.records
                  }
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.zoteroImport,
            version: '1.0.0',
            title: 'Import the caller Zotero library',
            description: 'Reads one page of the caller own Zotero library over the Web API v3 and seals its bibliographic entries as an immutable knowledge-net.library version. Off by default: fails closed without a credential. Only bibliographic metadata is kept; notes, tags, collections and attachments are dropped.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'workspace', effect: 'workspace-write', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'required' },
            tags: ['knowledge-net', 'literature', 'library', 'zotero', 'import'],
            inputSchema: zoteroImportInputSchema, outputSchema: zoteroImportResultSchema,
            handler: async (input: ZoteroImportInput, context: CapabilityContext) => {
              const workspaceRoot = requireWorkspace(context, 'zotero-import')
              await assertCurrent(context)
              const credential = await readZoteroCredential(host)
              if (!credential) {
                throw new Error('Zotero is not configured: store a Zotero userId and api key in the secure facility first.')
              }
              const client = new ZoteroClient({
                fetch: globalThis.fetch,
                userId: credential.userId,
                apiKey: credential.apiKey
              })
              const page = await client.listItems({ start: input.start, limit: input.limit })
              const entries = page.items.map(toLibraryEntry)
              if (entries.length === 0) {
                await assertCurrent(context)
                return { output: zoteroImportResultSchema.parse({
                  artifactId: null, versionId: null, contentDigest: null, imported: 0,
                  scanned: page.scanned, nextStart: page.nextStart,
                  totalResults: page.totalResults, truncated: page.hasMore, source: 'zotero'
                }) }
              }
              const sealed = definitionBytes(knowledgeLibrarySchema.parse({
                schemaVersion: 1,
                source: { path: `zotero:${credential.userId}`, format: 'zotero' },
                entries
              }))
              if (sealed.length > MAX_SEALED_BYTES) throw new Error('The sealed Zotero library exceeds the derivation size limit.')
              await assertCurrent(context)
              const committed = await createArtifactVersionCommitPortV1(host.capabilities!, workspaceRoot).commit({
                idempotencyKey: `knowledge-net/zotero:${input.operationId}`,
                candidates: [{
                  candidateId: 'library',
                  expectedCurrentVersionId: null,
                  kind: KNOWLEDGE_LIBRARY_KIND,
                  label: `Zotero import of ${entries.length} entries`.slice(0, 512),
                  intent: 'save',
                  content: { mode: 'snapshot', dataBase64: sealed.toString('base64'), mediaType: 'application/json' },
                  metadata: { sourceFormat: 'zotero', sourcePath: `zotero:${credential.userId}` }
                }]
              })
              if (!committed.ok) throw new Error(`Artifact versions were not committed: ${committed.issue.message}`)
              const item = committed.value.versions[0]
              if (!item) throw new Error('Artifact versions commit returned no version.')
              const storage = item.version.storage
              if (storage.mode !== 'snapshot') throw new Error('Artifact commit returned no sealed snapshot.')
              if (storage.contentDigest !== sha256(sealed)) throw new Error('Artifact commit digest does not match the library.')
              await assertCurrent(context)
              return {
                output: zoteroImportResultSchema.parse({
                  artifactId: item.artifact.artifactId,
                  versionId: item.version.versionId,
                  contentDigest: storage.contentDigest,
                  imported: entries.length,
                  scanned: page.scanned,
                  nextStart: page.nextStart,
                  totalResults: page.totalResults,
                  truncated: page.hasMore,
                  source: 'zotero'
                })
              }
            }
          }),
          host.defineCapability({
            id: KNOWLEDGE_NET_CAPABILITY_IDS.zoteroWrite,
            version: '1.0.0',
            title: 'Write library entries back to Zotero',
            description: 'Creates new Zotero items from prepared library entries using the stored credential. Confirmation-gated: the Host shows the entries before anything is written. Only bibliographic fields are written — notes, tags, collections and attachments cannot be written through this contract. Off by default: fails closed without a credential.',
            audiences: ['ui', 'agent', 'system'],
            scope: 'global', effect: 'external-write', approval: 'confirmation',
            tags: ['knowledge-net', 'literature', 'library', 'zotero', 'export', 'write'],
            inputSchema: zoteroWriteInputSchema, outputSchema: zoteroWriteResultSchema,
            concurrency: { revision: 'none', idempotency: 'required' },
            handler: async (input: ZoteroWriteInput, context: CapabilityContext) => {
              await assertCurrent(context)
              const credential = await readZoteroCredential(host)
              if (!credential) {
                throw new Error('Zotero is not configured: store a Zotero userId and api key in the secure facility first.')
              }
              const client = new ZoteroClient({
                fetch: globalThis.fetch,
                userId: credential.userId,
                apiKey: credential.apiKey
              })
              const report = await client.createItems(input.items.map(toWritableItem), input.operationId)
              await assertCurrent(context)
              const created = input.items.flatMap((entry, index) => {
                const result = report.successful[String(index)]
                return result ? [{ paperId: entry.paperId, key: result.key, version: result.version }] : []
              })
              const failed = input.items.flatMap((entry, index) => {
                const failure = report.failed[String(index)]
                return failure ? [{ index, paperId: entry.paperId, message: failure.message }] : []
              })
              return {
                output: zoteroWriteResultSchema.parse({
                  created,
                  unchanged: Object.keys(report.unchanged).length,
                  failed,
                  source: 'zotero'
                })
              }
            }
          }),
          ...createResourceCapabilities({ host, requireWorkspace, deriveState })
        ]
      }
    }]
  }
}

async function assertCurrent(context: CapabilityContext): Promise<void> {
  context.signal?.throwIfAborted()
  await context.assertPrincipalCurrent?.()
  context.signal?.throwIfAborted()
}

/**
 * Flattens sealed library imports into one paper per id. Newest observed library
 * metadata wins, so a corrected import supersedes an older title, year or DOI.
 */
function libraryPapers(libraries: readonly KnowledgeLibrary[]): LibraryEntryForMatch[] {
  const byId = new Map<string, LibraryEntryForMatch>()
  for (const library of libraries) {
    for (const entry of library.entries) {
      if (byId.has(entry.paperId)) continue
      byId.set(entry.paperId, {
        paperId: entry.paperId, title: entry.title,
        ...(entry.year !== undefined ? { year: entry.year } : {}),
        ...(entry.doi ? { doi: entry.doi } : {})
      })
    }
  }
  return [...byId.values()]
}

/**
 * Reads the caller's Zotero credential from the owner-scoped secret store.
 * Returns null when the store or either field is absent, so the connector
 * fails closed instead of guessing.
 */
async function readZoteroCredential(host: DomainMainHost): Promise<{ userId: string; apiKey: string } | null> {
  const secrets = host.packageSecrets
  if (!secrets) return null
  const userId = await secrets.read('zotero.user-id')
  const apiKey = await secrets.read('zotero.api-key')
  if (!userId || !apiKey) return null
  return { userId, apiKey }
}
