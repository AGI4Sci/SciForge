import { describe, expect, it, vi } from 'vitest'
import { sha256 } from './derive.js'
import { createDomainMainEntry } from './main.js'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { KNOWLEDGE_LIBRARY_CAPABILITY_IDS, KNOWLEDGE_NET_CAPABILITY_IDS } from './contract.js'

const tempDirs: string[] = []
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))) })

type Def = { id: string; audiences: string[]; effect: string; handler(input: unknown, context: unknown): Promise<{ output: unknown }> }

function definitions(capabilities?: unknown): Def[] {
  const entry = createDomainMainEntry({
    getUserDataDir: () => '', defineCapability: (definition: unknown) => definition, capabilities
  } as never)
  const factory = entry.contributions[0]!.value as { createDefinitions(): Def[] }
  return factory.createDefinitions()
}

describe('knowledge-net capabilities', () => {
  it('declares commit, lookup and annotate with the right effects', () => {
    const defs = definitions()
    expect(defs.map((d) => d.id)).toEqual([
      KNOWLEDGE_NET_CAPABILITY_IDS.noteCommit,
      KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryImport,
      KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus,
      KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryPdfs,
      KNOWLEDGE_NET_CAPABILITY_IDS.lookup,
      KNOWLEDGE_NET_CAPABILITY_IDS.annotate,
      KNOWLEDGE_NET_CAPABILITY_IDS.graphExport,
      KNOWLEDGE_NET_CAPABILITY_IDS.zoteroRead,
      KNOWLEDGE_NET_CAPABILITY_IDS.documentExport,
      KNOWLEDGE_NET_CAPABILITY_IDS.zoteroImport,
      KNOWLEDGE_NET_CAPABILITY_IDS.zoteroWrite,
      'knowledge-net.resource.commit',
      'knowledge-net.resource.search'
    ])
    expect(defs.map((d) => d.effect)).toEqual(['workspace-write', 'workspace-write', 'read', 'read', 'read', 'read', 'read', 'read', 'read', 'workspace-write', 'external-write', 'workspace-write', 'read'])
  })

  it('refuses a call without a workspace-scoped caller', async () => {
    const globalScoped = new Set<string>([
      KNOWLEDGE_NET_CAPABILITY_IDS.zoteroRead,
      KNOWLEDGE_NET_CAPABILITY_IDS.zoteroWrite
    ])
    const workspaceScoped = definitions().filter((def) => !globalScoped.has(def.id))
    for (const def of workspaceScoped) {
      await expect(def.handler({}, { caller: {} })).rejects.toThrow(/workspace-scoped caller/)
    }
  })

  it('refuses a call when the Artifact Versions host is missing', async () => {
    const [, , , lookup] = definitions()
    await expect(lookup!.handler({ query: 'x' }, { caller: { workspaceId: '/w' } }))
      .rejects.toThrow(/Artifact Versions capability host/)
  })

  it('seals a record as one knowledge-net.record version with an idempotency key', async () => {
    const calls: Array<{ input: any; options: any }> = []
    const invoker = { invoke: async (_contract: unknown, input: any, options: any) => {
      calls.push({ input, options })
      return { ok: true, value: { versions: [{
        artifact: { artifactId: 'art-1' },
        version: { versionId: 'ver-1', storage: { mode: 'snapshot', contentDigest: sha256(Buffer.from(input.candidates[0].content.dataBase64, 'base64')) } }
      }] } }
    } }
    const [commit] = definitions(invoker)
    const result = await commit!.handler({
      operationId: 'op-12345678',
      record: { schemaVersion: 1, paperId: 'p1', concepts: [{ term: 'T', definition: 'D' }], conceptTargets: [] }
    }, { caller: { workspaceId: '/w' } })
    expect(result.output).toEqual({ artifactId: 'art-1', versionId: 'ver-1', contentDigest: sha256(Buffer.from(calls[0]!.input.candidates[0].content.dataBase64, 'base64')) })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toMatchObject({ workspaceId: '/w', idempotencyKey: 'knowledge-net/record:op-12345678' })
    expect(calls[0]!.input.candidates).toHaveLength(1)
    expect(calls[0]!.input.candidates[0]).toMatchObject({ kind: 'knowledge-net.record', expectedCurrentVersionId: null })
  })

  it('imports a workspace bibliography as one knowledge-net.library version and reports skipped entries', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'kn-main-')))
    tempDirs.push(base)
    const root = join(base, 'ws')
    await mkdir(join(root, 'refs'), { recursive: true })
    await writeFile(join(root, 'refs', 'lib.bib'),
      '@article{a2001, title={Alpha}, author={X, Y}, year={2001}}\n@article{b, author={no title}}')
    const calls: Array<{ input: any; options: any }> = []
    const invoker = { invoke: async (_c: unknown, input: any, options: any) => {
      calls.push({ input, options })
      return { ok: true, value: { versions: [{
        artifact: { artifactId: 'art-lib' },
        version: { versionId: 'ver-lib', storage: { mode: 'snapshot', contentDigest: sha256(Buffer.from(input.candidates[0].content.dataBase64, 'base64')) } }
      }] } }
    } }
    const defs = definitions(invoker)
    const imp = defs.find((d) => d.id === KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryImport)!
    const result = await imp.handler({ operationId: 'lib-op-0001', path: 'refs/lib.bib' }, { caller: { workspaceId: root } })
    expect(result.output).toMatchObject({
      artifactId: 'art-lib', versionId: 'ver-lib', format: 'bibtex', imported: 1, skippedTotal: 1,
      skipped: [{ id: 'b', reason: 'entry has no title' }]
    })
    const candidate = calls[0]!.input.candidates[0]
    expect(candidate).toMatchObject({ kind: 'knowledge-net.library', expectedCurrentVersionId: null })
    expect(calls[0]!.options).toMatchObject({ idempotencyKey: 'knowledge-net/library:lib-op-0001' })
    const sealed = JSON.parse(Buffer.from(candidate.content.dataBase64, 'base64').toString('utf8'))
    expect(sealed.entries).toEqual([{ paperId: 'a2001', title: 'Alpha', authors: ['X, Y'], year: 2001 }])
    expect(JSON.stringify(sealed)).not.toContain(root)
  })

  it('refuses to import a file outside the workspace and commits nothing', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'kn-main-')))
    tempDirs.push(base)
    const root = join(base, 'ws')
    await mkdir(root, { recursive: true })
    await writeFile(join(base, 'secret.bib'), '@a{k, title={T}}')
    let committed = 0
    const defs = definitions({ invoke: async () => { committed += 1; return { ok: true, value: { versions: [] } } } })
    const imp = defs.find((d) => d.id === KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryImport)!
    await expect(imp.handler({ operationId: 'lib-op-0002', path: '../secret.bib' }, { caller: { workspaceId: root } }))
      .rejects.toThrow('outside the workspace')
    expect(committed).toBe(0)
  })

  it('accepts an empty status request and defaults to all papers, limit 100', async () => {
    const { libraryStatusInputSchema } = await import('./contract.js')
    expect(libraryStatusInputSchema.safeParse({}).success).toBe(true)
    expect(libraryStatusInputSchema.safeParse({ state: 'unread' }).success).toBe(true)
    expect(libraryStatusInputSchema.safeParse({ limit: 501 }).success).toBe(false)
  })

  it('pairs workspace PDF file names with sealed library entries and reports evidence', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kn-main-')))
    tempDirs.push(root)
    await mkdir(join(root, 'papers'), { recursive: true })
    await writeFile(join(root, 'papers', 'Alpha Beta 2001.pdf'), '%PDF-1.7')
    await writeFile(join(root, 'papers', 'lecture-notes.pdf'), '%PDF-1.7')
    const library = { schemaVersion: 1, source: { path: 'refs/lib.bib', format: 'bibtex' },
      entries: [{ paperId: 'p1', title: 'Alpha Beta', authors: [], year: 2001 }] }
    const bytes = Buffer.from(JSON.stringify(library))
    const defs = definitions({ invoke: async (_c: unknown, input: any) => {
      if ('afterSequence' in input) return { ok: true, value: { events: [
        { type: 'version-committed', artifactId: 'lib', versionId: 'lib', sequence: 1 }
      ], lastSequence: 1 } }
      return { ok: true, value: { artifact: { artifactId: 'lib', kind: 'knowledge-net.library' },
        version: { versionId: 'lib', storage: { mode: 'snapshot', contentDigest: sha256(bytes) } },
        dataBase64: bytes.toString('base64') } }
    } })
    const pdfs = await defs.find((d) => d.id === KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryPdfs)!
      .handler({}, { caller: { workspaceId: root } })
    const output = pdfs.output as any
    expect(output.counts).toEqual({ pdfs: 2, matched: 1, unmatched: 1, ambiguous: 0, libraryPapers: 1 })
    const matched = output.pdfs.find((pdf: any) => pdf.path === 'papers/Alpha Beta 2001.pdf')
    expect(matched).toMatchObject({
      matched: { paperId: 'p1', title: 'Alpha Beta', matchedBy: ['title', 'year'] },
      candidates: []
    })
    const unmatched = output.pdfs.find((pdf: any) => pdf.path === 'papers/lecture-notes.pdf')
    expect(unmatched).toMatchObject({ matched: null, candidates: [] })
    expect(output.truncated).toBe(false)
    expect(output.derivedFrom).toMatchObject({ coverage: 'complete', libraries: 1 })
    // Only names and sizes leave the scan: no PDF content, no absolute path.
    expect(JSON.stringify(output)).not.toContain(root)
    expect(JSON.stringify(output)).not.toContain('%PDF')
  })
})


it('does not publish successful receipts after principal revocation during commit', async () => {
  let revoked = false
  let calls = 0
  const [commit] = definitions({ invoke: async (_c: unknown, input: any) => {
    calls++
    revoked = true
    return { ok: true, value: { versions: [{ artifact: { artifactId: 'art' }, version: {
      versionId: 'ver', storage: { mode: 'snapshot', contentDigest: sha256(Buffer.from(input.candidates[0].content.dataBase64, 'base64')) }
    } }] } }
  } })
  await expect(commit!.handler({ operationId: 'late-op-0001', record: {
    schemaVersion: 1, paperId: 'p', concepts: [{ term: 'T', definition: 'D' }]
  } }, { caller: { workspaceId: '/w' }, assertPrincipalCurrent: () => { if (revoked) throw new Error('revoked') } }))
    .rejects.toThrow('revoked')
  expect(calls).toBe(1) // The durable write may exist; the same operation id reconciles it. Never blind-retry a new id.
})


it('exposes incomplete coverage for misses, annotations and papers without visible records', async () => {
  const library = { schemaVersion: 1, source: { path: 'refs.bib', format: 'bibtex' }, entries: [{ paperId: 'p', title: 'Paper', authors: [] }] }
  const bytes = Buffer.from(JSON.stringify(library))
  const defs = definitions({ invoke: async (_c: unknown, input: any) => {
    if ('afterSequence' in input) return { ok: true, value: { events: [
      { type: 'version-committed', artifactId: 'bad', versionId: 'bad', sequence: 1 },
      { type: 'version-committed', artifactId: 'lib', versionId: 'lib', sequence: 2 }
    ], lastSequence: 2 } }
    if (input.versionId === 'bad') return { ok: false, issue: { message: 'unavailable' } }
    return { ok: true, value: { artifact: { artifactId: 'lib', kind: 'knowledge-net.library' },
      version: { versionId: 'lib', storage: { mode: 'snapshot', contentDigest: sha256(bytes) } }, dataBase64: bytes.toString('base64') } }
  } })
  const context = { caller: { workspaceId: '/w' } }
  const lookup = await defs.find((d) => d.id === KNOWLEDGE_NET_CAPABILITY_IDS.lookup)!.handler({ query: 'Missing' }, context)
  expect(lookup.output).toMatchObject({ status: 'coverage_unknown', derivedFrom: { coverage: 'partial' } })
  const annotated = await defs.find((d) => d.id === KNOWLEDGE_NET_CAPABILITY_IDS.annotate)!.handler({ text: 'Missing' }, context)
  expect(annotated.output).toMatchObject({ spans: [], derivedFrom: { coverage: 'partial' } })
  const status = await defs.find((d) => d.id === KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus)!.handler({}, context)
  expect(status.output).toMatchObject({ counts: { total: 1, read: 0, unread: 0, unknown: 1 }, papers: [{ paperId: 'p', state: 'unknown' }] })
})

it('exports the concept graph and a paper document from sealed records', async () => {
  const record = { schemaVersion: 1, paperId: 'p1', title: 'Alpha',
    concepts: [{ term: 'A', definition: 'D' }], conceptTargets: [{ term: 'T' }] }
  const bytes = Buffer.from(JSON.stringify(record))
  const defs = definitions({ invoke: async (_c: unknown, input: any) => {
    if ('afterSequence' in input) return { ok: true, value: { events: [
      { type: 'version-committed', artifactId: 'rec', versionId: 'rec', sequence: 1 }
    ], lastSequence: 1 } }
    return { ok: true, value: { artifact: { artifactId: 'rec', kind: 'knowledge-net.record' },
      version: { versionId: 'rec', storage: { mode: 'snapshot', contentDigest: sha256(bytes) } },
      dataBase64: bytes.toString('base64') } }
  } })
  const context = { caller: { workspaceId: '/w' } }

  const graph = await defs.find((d) => d.id === KNOWLEDGE_NET_CAPABILITY_IDS.graphExport)!.handler({}, context)
  const graphOutput = graph.output as any
  expect(graphOutput).toMatchObject({
    format: 'graphml', counts: { papers: 1, concepts: 2, explains: 1, targets: 1 },
    derivedFrom: { coverage: 'complete', records: 1 }
  })
  expect(graphOutput.document).toContain('<graphml')

  const jsonLd = await defs.find((d) => d.id === KNOWLEDGE_NET_CAPABILITY_IDS.graphExport)!.handler({ format: 'json-ld' }, context)
  expect(jsonLd.output as any).toMatchObject({ format: 'json-ld' })
  expect((jsonLd.output as any).document).toContain('ScholarlyArticle')

  const doc = await defs.find((d) => d.id === KNOWLEDGE_NET_CAPABILITY_IDS.documentExport)!.handler({ paperId: 'p1' }, context)
  expect(doc.output as any).toMatchObject({ paperId: 'p1', format: 'markdown', sourceRecords: 1 })
  expect((doc.output as any).document).toContain('# Alpha')
  expect(doc.output).toStrictEqual(JSON.parse(JSON.stringify(doc.output)))
})

it('reads the caller Zotero library through the stored credential and fails closed without one', async () => {
  const store = new Map<string, string>()
  const packageSecrets = {
    has: async (key: string) => store.has(key),
    read: async (key: string) => store.get(key) ?? null,
    write: async (key: string, value: string) => { store.set(key, value) },
    remove: async (key: string) => { store.delete(key) }
  }
  const entry = createDomainMainEntry({
    getUserDataDir: () => '',
    defineCapability: (definition: unknown) => definition,
    packageSecrets
  } as never)
  const factory = entry.contributions[0]!.value as { createDefinitions(): Def[] }
  const defs = factory.createDefinitions()
  const zotero = defs.find((def) => def.id === KNOWLEDGE_NET_CAPABILITY_IDS.zoteroRead)!
  const context = { caller: {} }

  // Off by default: no credential fails closed before any network call.
  await expect(zotero.handler({}, context)).rejects.toThrow(/Zotero is not configured/)

  store.set('zotero.user-id', '475425')
  store.set('zotero.api-key', 'secret-key-123')

  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return new Response(JSON.stringify([
      { key: 'AAAA1111', version: 1, data: { key: 'AAAA1111', version: 1, itemType: 'journalArticle', title: 'Alpha', creators: [{ creatorType: 'author', lastName: 'Lovelace', firstName: 'Ada' }], date: '2021', DOI: '10.1/example' } }
    ]), { status: 200, headers: { 'Total-Results': '1' } })
  })
  vi.stubGlobal('fetch', fetchStub)
  try {
    const result = await zotero.handler({}, context)
    expect(result.output).toMatchObject({
      configured: true,
      source: 'zotero',
      totalResults: 1,
      returned: 1,
      truncated: false,
      items: [{ paperId: 'zotero:AAAA1111', title: 'Alpha', authors: ['Lovelace, Ada'], year: 2021, doi: '10.1/example' }]
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).not.toContain('secret-key-123')
    expect((requests[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key-123')
  } finally {
    vi.unstubAllGlobals()
  }
})


it('writes prepared entries back to Zotero and maps the per-index report', async () => {
  const store = new Map<string, string>([
    ['zotero.user-id', '475425'],
    ['zotero.api-key', 'secret-key-123']
  ])
  const packageSecrets = {
    has: async (key: string) => store.has(key),
    read: async (key: string) => store.get(key) ?? null,
    write: async (key: string, value: string) => { store.set(key, value) },
    remove: async (key: string) => { store.delete(key) }
  }
  const entry = createDomainMainEntry({
    getUserDataDir: () => '',
    defineCapability: (definition: unknown) => definition,
    packageSecrets
  } as never)
  const factory = entry.contributions[0]!.value as { createDefinitions(): Def[] }
  const defs = factory.createDefinitions()
  const write = defs.find((def) => def.id === KNOWLEDGE_NET_CAPABILITY_IDS.zoteroWrite)!

  // Off by default without a credential.
  const unconfigured = createDomainMainEntry({
    getUserDataDir: () => '',
    defineCapability: (definition: unknown) => definition
  } as never)
  const unconfiguredWrite = ((unconfigured.contributions[0]!.value as { createDefinitions(): Def[] }).createDefinitions())
    .find((def) => def.id === KNOWLEDGE_NET_CAPABILITY_IDS.zoteroWrite)!
  await expect(unconfiguredWrite.handler({ items: [{ paperId: 'p', title: 'T', authors: [] }] }, { caller: {} }))
    .rejects.toThrow(/Zotero is not configured/)

  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return new Response(JSON.stringify({
      successful: { '0': { key: 'NEWKEY1', version: 1 } },
      unchanged: {},
      failed: { '1': { code: 409, message: 'Duplicate' } }
    }), { status: 201 })
  })
  vi.stubGlobal('fetch', fetchStub)
  try {
    const result = await write.handler({
      operationId: 'zotero-write-1',
      items: [
        { paperId: 'zotero:AAAA1111', title: 'Alpha', authors: ['Lovelace, Ada'], year: 2021 },
        { paperId: 'zotero:BBBB2222', title: 'Beta', authors: [] }
      ]
    }, { caller: {} })
    expect(result.output).toMatchObject({
      source: 'zotero',
      unchanged: 0,
      created: [{ paperId: 'zotero:AAAA1111', key: 'NEWKEY1', version: 1 }],
      failed: [{ index: 1, paperId: 'zotero:BBBB2222', message: 'Zotero rejected this item.' }]
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.init?.method).toBe('POST')
    expect(requests[0]!.url).not.toContain('secret-key-123')
    expect((requests[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key-123')
  } finally {
    vi.unstubAllGlobals()
  }
})


it('seals one page of the caller Zotero library as a library version', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kn-zotero-')))
  tempDirs.push(root)
  const store = new Map<string, string>([
    ['zotero.user-id', '475425'],
    ['zotero.api-key', 'secret-key-123']
  ])
  const packageSecrets = {
    has: async (key: string) => store.has(key),
    read: async (key: string) => store.get(key) ?? null,
    write: async (key: string, value: string) => { store.set(key, value) },
    remove: async (key: string) => { store.delete(key) }
  }
  const calls: Array<{ input: any; options: any }> = []
  const invoker = { invoke: async (_c: unknown, input: any, options: any) => {
    calls.push({ input, options })
    return { ok: true, value: { versions: [{
      artifact: { artifactId: 'art-z' },
      version: { versionId: 'ver-z', storage: { mode: 'snapshot', contentDigest: sha256(Buffer.from(input.candidates[0].content.dataBase64, 'base64')) } }
    }] } }
  } }
  const entry = createDomainMainEntry({
    getUserDataDir: () => '',
    defineCapability: (definition: unknown) => definition,
    packageSecrets,
    capabilities: invoker
  } as never)
  const factory = entry.contributions[0]!.value as { createDefinitions(): Def[] }
  const zimport = factory.createDefinitions().find((def) => def.id === KNOWLEDGE_NET_CAPABILITY_IDS.zoteroImport)!

  const fetchStub = vi.fn(async () => new Response(JSON.stringify([
    { key: 'AAAA1111', version: 1, data: { key: 'AAAA1111', version: 1, itemType: 'journalArticle', title: 'Alpha', creators: [], date: '2021' } }
  ]), { status: 200, headers: { 'Total-Results': '1' } }))
  vi.stubGlobal('fetch', fetchStub)
  try {
    const result = await zimport.handler({ operationId: 'zotero-op-0001' }, { caller: { workspaceId: root } })
    expect(result.output).toMatchObject({ imported: 1, source: 'zotero', totalResults: 1, truncated: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toMatchObject({ idempotencyKey: 'knowledge-net/zotero:zotero-op-0001', workspaceId: root })
    const sealed = JSON.parse(Buffer.from(calls[0]!.input.candidates[0].content.dataBase64, 'base64').toString('utf8'))
    expect(sealed.source).toEqual({ path: 'zotero:475425', format: 'zotero' })
    expect(sealed.entries).toEqual([{ paperId: 'zotero:AAAA1111', title: 'Alpha', authors: [], year: 2021 }])
    expect(JSON.stringify(sealed)).not.toContain('secret-key-123')
    expect(JSON.stringify(sealed)).not.toContain(root)
    fetchStub.mockImplementationOnce(async () => new Response(JSON.stringify([
      { data: { key: 'BBBB2222', version: 1, itemType: 'attachment', title: 'PDF', creators: [] } }
    ]), { headers: { 'Total-Results': '3' } }))
    expect((await zimport.handler({ operationId: 'zotero-import-2', start: 1, limit: 1 }, { caller: { workspaceId: root } })).output).toMatchObject({
      imported: 0, scanned: 1, nextStart: 2, truncated: true, artifactId: null, versionId: null
    })
    expect(calls).toHaveLength(1)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('counts sealed notes that no imported bibliography describes instead of dropping them', async () => {
  const library = { schemaVersion: 1, source: { path: 'refs.bib', format: 'bibtex' }, entries: [{ paperId: 'p', title: 'Paper', authors: [] }] }
  const note = { schemaVersion: 1, paperId: 'q', concepts: [{ term: 'T', definition: 'D' }] }
  const libBytes = Buffer.from(JSON.stringify(library))
  const noteBytes = Buffer.from(JSON.stringify(note))
  const defs = definitions({ invoke: async (_c: unknown, input: any) => {
    if ('afterSequence' in input) return { ok: true, value: { events: [
      { type: 'version-committed', artifactId: 'lib', versionId: 'lib', sequence: 1 },
      { type: 'version-committed', artifactId: 'note', versionId: 'note', sequence: 2 }
    ], lastSequence: 2 } }
    const isNote = input.versionId === 'note'
    const bytes = isNote ? noteBytes : libBytes
    return { ok: true, value: { artifact: { artifactId: input.versionId, kind: isNote ? 'knowledge-net.record' : 'knowledge-net.library' },
      version: { versionId: input.versionId, storage: { mode: 'snapshot', contentDigest: sha256(bytes) } }, dataBase64: bytes.toString('base64') } }
  } })
  const status = await defs.find((d) => d.id === KNOWLEDGE_LIBRARY_CAPABILITY_IDS.libraryStatus)!.handler({}, { caller: { workspaceId: '/w' } })
  // `q` is sealed and read; `counts` counts bibliography entries, so it stays out of
  // them — but it is no longer invisible.
  expect(status.output).toMatchObject({
    counts: { total: 1, read: 0 }, papers: [{ paperId: 'p' }],
    derivedFrom: { records: 1, recordsWithoutLibraryMetadata: 1, paperIdsWithoutLibraryMetadata: ['q'] }
  })
})
