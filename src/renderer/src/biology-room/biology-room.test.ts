import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  BiologyRoomAsset,
  BiologyRoomManifest
} from '@shared/biology-room'
import type { CapabilityResourceBinding } from '@shared/capability-broker'
import type { BioGymRunSnapshot } from '@shared/biogym'
import {
  biologyRoomAssetBlockingIssue,
  biologyRoomAssetWarning,
  biologyRoomWatchPaths,
  biologySelectionFromWorkspaceSelection,
  biologyRoomNeedsReference,
  buildBiologyRoomSelectionChatContext,
  clampBiologyRoomWidth,
  describeBiologyRoomSelection,
  resolveActiveBiologyRoomAsset,
  resolveBiologyRoomViewerKind
} from './model'
import {
  biologyRoomVisibleContextComponentId,
  buildBiologyRoomVisibleContextComponent
} from './visible-context'
import {
  biologySequenceSelectionFromSeqViz,
  buildSeqVizProps,
  initialBiologySequenceRecordIndex,
  parseBiologySequenceText,
  seqVizSelectionFromBiologyRanges
} from './sequence-adapter-model'
import { buildJBrowseLocalViewConfig } from './jbrowse-config'
import {
  biologyGenomeViewportFromJBrowseState,
  biologySelectionFromJBrowseSessionSelection
} from './JBrowseBiologyRoomAdapter'
import { isLocalBiologyAssetUrl } from './asset-sources'
import {
  BiologyRoomShell,
  RevisionConflictBanner
} from './BiologyRoomShell'
import { createBiologyRoomAnnotation } from './BiologyRoomInspector'
import { readBoundedSequenceText } from './SeqVizBiologyRoomAdapter'

const NOW = '2026-07-11T10:00:00.000Z'

describe('Biology Room renderer models', () => {
  it('resolves active assets, viewer kinds, reference requirements, and bounded widths', () => {
    const track = asset({
      id: 'genes',
      path: 'data/genes.gff3',
      format: 'gff3',
      modality: 'genome-feature'
    })
    const room = manifest({ assets: [track], activeAssetId: track.id })

    expect(resolveActiveBiologyRoomAsset(room)?.id).toBe('genes')
    expect(resolveBiologyRoomViewerKind(track)).toBe('genome')
    expect(biologyRoomNeedsReference(room, track)).toBe(true)
    expect(clampBiologyRoomWidth(120, 640, 1_600)).toBe(640)
    expect(clampBiologyRoomWidth(2_000, 640, 1_600)).toBe(1_600)
  })

  it('creates a user-facing selection context while preserving zero-based internal ranges', () => {
    const fasta = asset({ id: 'seq', path: 'data/plasmid.fa', format: 'fasta', modality: 'sequence' })
    const other = asset({ id: 'other', path: 'data/other.fa', format: 'fasta', modality: 'sequence' })
    const selection = {
      kind: 'sequence' as const,
      assetId: fasta.id,
      sequenceId: 'plasmid',
      ranges: [{ start: 9, end: 25 }]
    }
    const room = manifest({
      assets: [fasta, other],
      activeAssetId: other.id,
      selection,
      annotations: [{
        id: 'annotation-1',
        anchor: selection,
        body: 'Check this motif.',
        actor: { kind: 'user' },
        createdAt: NOW,
        updatedAt: NOW
      }]
    })

    expect(describeBiologyRoomSelection(room.selection, room)).toContain('plasmid:10–25')
    expect(buildBiologyRoomSelectionChatContext(room)).toContain('File: data/plasmid.fa')
    expect(buildBiologyRoomSelectionChatContext(room)).toContain('Annotation 1 (user): Check this motif.')
    expect(buildBiologyRoomSelectionChatContext(room)).toContain('Selection data (zero-based, half-open JSON)')
    expect(buildBiologyRoomSelectionChatContext(room)).toContain('"start":9')
    expect(buildBiologyRoomSelectionChatContext(room)).toContain('Room revision: 4')
    expect(room.selection?.kind === 'sequence' && room.selection.ranges[0]).toEqual({ start: 9, end: 25 })
  })

  it('converts existing preview selections into Biology Room operations without source edits', () => {
    expect(biologySelectionFromWorkspaceSelection('seq', {
      kind: 'sequence',
      sequenceId: 'alpha',
      ranges: [{ start: 2, end: 8, strand: '+' }]
    })).toEqual({
      kind: 'sequence',
      assetId: 'seq',
      sequenceId: 'alpha',
      ranges: [{ start: 2, end: 8, strand: '+' }]
    })

    expect(biologySelectionFromWorkspaceSelection('structure', {
      kind: 'molecular',
      chains: ['A'],
      residues: [{ chain: 'A', index: 42, name: 'GLY' }],
      ligands: ['ATP'],
      atoms: [{ element: 'Zn' }]
    })).toEqual({
      kind: 'molecular',
      assetId: 'structure',
      locators: [
        { chainId: 'A' },
        { chainId: 'A', residueNumber: 42, residueName: 'GLY' },
        { residueName: 'ATP' },
        { elementSymbol: 'Zn' }
      ]
    })
  })

  it('publishes a stable, bounded visible-context component for agent tool eligibility', () => {
    const fasta = asset({
      id: 'seq',
      path: 'data/reference.fa',
      format: 'fasta',
      modality: 'genome-reference',
      readiness: 'ready',
      indexFingerprints: [{
        path: 'data/reference.fa.fai',
        sha256: 'b'.repeat(64),
        sizeBytes: 42,
        mtimeMs: 2
      }]
    })
    const room = {
      ...manifest({ assets: [fasta], activeAssetId: fasta.id }),
      capability: {
        resource: {
          token: 'cap_abcdefghijklmnopqrstuvwxyz',
          semanticRevision: '4',
          expiresAt: '2026-07-16T14:00:00.000Z'
        },
        operations: [{
          contractVersion: 1,
          id: 'biology-room.apply',
          version: '1.0.0',
          title: 'Apply Biology Room operations',
          description: 'Apply registered Biology Room operations.',
          audiences: ['ui', 'agent', 'system'],
          scope: 'resource',
          resourceKinds: ['biology-room'],
          effect: 'workspace-write',
          approval: 'none',
          concurrency: { revision: 'optimistic', idempotency: 'required' },
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          tags: ['biology']
        }]
      } satisfies CapabilityResourceBinding
    }
    const component = buildBiologyRoomVisibleContextComponent({
      room,
      workspaceRoot: '/workspace/lab',
      conflicted: true
    })

    expect(component.id).toBe(biologyRoomVisibleContextComponentId(room.roomId))
    expect(component.component).toBe('biology-room')
    expect(component.region).toBe('main-workspace')
    expect(component.state).toMatchObject({
      roomId: room.roomId,
      workspaceRoot: '/workspace/lab',
      revision: room.revision,
      conflicted: true
    })
    expect(component.resources?.[0]).toMatchObject({
      kind: 'biologyRoom',
      capability: {
        resource: { token: 'cap_abcdefghijklmnopqrstuvwxyz', semanticRevision: '4' },
        operations: [{ id: 'biology-room.apply' }]
      },
      metadata: { operationIds: ['biology-room.apply'] }
    })
    expect(component.resources?.[1]).toMatchObject({
      kind: 'workspaceFile',
      path: '/workspace/lab/data/reference.fa',
      relativePath: 'data/reference.fa',
      metadata: {
        readiness: 'ready',
        indexFingerprints: [{ sha256: 'b'.repeat(64) }]
      }
    })
  })

  it('blocks stale assets and describes partial reference compatibility without hiding it', () => {
    const missing = asset({
      id: 'missing',
      path: 'data/missing.pdb',
      format: 'pdb',
      modality: 'structure',
      readiness: 'missing',
      readinessError: 'Source file no longer exists.'
    })
    const partial = asset({
      id: 'genes',
      path: 'data/genes.gff3',
      format: 'gff3',
      modality: 'genome-feature',
      referenceCompatibility: {
        status: 'partial',
        trackSha256: 'a'.repeat(64),
        referenceSha256: 'b'.repeat(64),
        matchedContigCount: 2,
        unmatchedContigCount: 1,
        unmatchedExamples: ['chrUn'],
        checkedAt: NOW
      }
    })

    expect(biologyRoomAssetBlockingIssue(missing)).toBe('Source file no longer exists.')
    expect(biologyRoomAssetBlockingIssue(partial)).toBeNull()
    expect(biologyRoomAssetWarning(partial)).toContain('1 contig did not match')
    expect(biologyRoomAssetWarning(partial)).toContain('chrUn')
  })

  it('watches the persisted room manifest as well as source and index files', () => {
    const fasta = asset({
      id: 'reference',
      path: 'data/reference.fa',
      format: 'fasta',
      modality: 'genome-reference',
      indexPaths: ['data/reference.fa.fai']
    })
    expect(biologyRoomWatchPaths(manifest({ assets: [fasta] }))).toEqual([
      '.sciforge/biology/rooms/room-1/room.json',
      'data/reference.fa',
      'data/reference.fa.fai'
    ])
  })
})

describe('SeqViz adapter model', () => {
  it('streams ordinary sequence text and rejects oversized sources before buffering them', async () => {
    await expect(readBoundedSequenceText(new Response('>alpha\nACGT\n'), 'alpha.fa'))
      .resolves.toBe('>alpha\nACGT\n')
    await expect(readBoundedSequenceText(new Response('small body', {
      headers: { 'content-length': String(25 * 1024 * 1024 + 1) }
    }), 'large.fa')).rejects.toThrow(/limited to 25 MiB/)
  })

  it('parses multi-record FASTA and builds a controlled, no-external-font viewer model', () => {
    const fasta = asset({ id: 'seq', path: 'data/multi.fa', format: 'fasta', modality: 'sequence' })
    const records = parseBiologySequenceText('>alpha\nACGTACGT\n>beta\nATGGCC\n', fasta)
    const room = manifest({
      assets: [fasta],
      activeAssetId: fasta.id,
      selection: {
        kind: 'sequence',
        assetId: fasta.id,
        sequenceId: 'alpha',
        ranges: [{ start: 1, end: 5 }]
      }
    })
    const props = buildSeqVizProps({ room, asset: fasta, record: records[0] })

    expect(records).toHaveLength(2)
    expect(props.disableExternalFonts).toBe(true)
    expect(props.selection).toEqual({ start: 1, end: 5 })
    expect(props.viewer).toBe('linear')
    expect(initialBiologySequenceRecordIndex(records, null, fasta.id, 'beta')).toBe(1)
  })

  it('splits a circular wraparound selection into two valid half-open ranges', () => {
    expect(biologySequenceSelectionFromSeqViz({
      assetId: 'seq',
      sequenceId: 'plasmid',
      sequenceLength: 100,
      start: 90,
      end: 10,
      clockwise: true
    })).toEqual({
      kind: 'sequence',
      assetId: 'seq',
      sequenceId: 'plasmid',
      ranges: [{ start: 90, end: 100 }, { start: 0, end: 10 }]
    })
    expect(seqVizSelectionFromBiologyRanges([
      { start: 90, end: 100 },
      { start: 0, end: 10 }
    ], 100)).toEqual({ start: 90, end: 10, clockwise: true })
  })
})

describe('JBrowse local config', () => {
  it('builds indexed FASTA and tabix track adapters from host-issued loopback URLs', () => {
    const reference = asset({
      id: 'reference',
      path: 'data/genome.fa',
      format: 'fasta',
      modality: 'genome-reference',
      indexPaths: ['data/genome.fa.fai'],
      contigs: [{ name: 'chr1', length: 10_000 }]
    })
    const track = asset({
      id: 'genes',
      path: 'data/genes.gff3.gz',
      format: 'gff3',
      modality: 'genome-feature',
      referenceAssetId: reference.id,
      indexPaths: ['data/genes.gff3.gz.tbi']
    })
    const room = manifest({
      assets: [reference, track],
      activeAssetId: track.id,
      viewerStates: {
        genome: {
          referenceAssetId: reference.id,
          refName: 'chr1',
          start: 100,
          end: 500,
          trackVisibility: { [track.id]: true }
        }
      }
    })
    const result = buildJBrowseLocalViewConfig({
      room,
      activeTrack: track,
      assetSources: {
        [reference.id]: {
          sourceUrl: 'http://127.0.0.1:5173/assets/genome.fa',
          indexUrls: ['http://127.0.0.1:5173/assets/genome.fa.fai']
        },
        [track.id]: {
          sourceUrl: 'http://127.0.0.1:5173/assets/genes.gff3.gz',
          indexUrls: ['http://127.0.0.1:5173/assets/genes.gff3.gz.tbi']
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sequence = result.config.assembly.sequence as Record<string, unknown>
    const referenceAdapter = sequence.adapter as Record<string, unknown>
    const trackAdapter = result.config.tracks[0].adapter as Record<string, unknown>
    expect(referenceAdapter.type).toBe('IndexedFastaAdapter')
    expect(trackAdapter.type).toBe('Gff3TabixAdapter')
    expect(trackAdapter.adapterId).toBe('genes-gff3-adapter')
    expect(result.config.trackAssetIds).toMatchObject({
      'genes-gff3': 'genes',
      'genes-gff3-adapter': 'genes'
    })
    expect(result.config.location).toMatchObject({ refName: 'chr1', start: 100, end: 500 })
    expect(result.config.defaultSession).not.toHaveProperty('plugins')
  })

  it('rejects remote URLs and compressed tracks without an index', () => {
    expect(isLocalBiologyAssetUrl('https://example.com/genome.fa')).toBe(false)
    expect(isLocalBiologyAssetUrl('sciforge-evil://asset/session')).toBe(false)
    expect(isLocalBiologyAssetUrl('sciforge-resource://asset/session')).toBe(true)
    expect(isLocalBiologyAssetUrl('http://localhost:5173/genome.fa')).toBe(true)

    const reference = asset({ id: 'reference', path: 'genome.fa', format: 'fasta', modality: 'genome-reference' })
    const track = asset({
      id: 'variants',
      path: 'variants.vcf.gz',
      format: 'vcf',
      modality: 'genome-variant',
      referenceAssetId: reference.id
    })
    const room = manifest({ assets: [reference, track], activeAssetId: track.id })
    const remote = buildJBrowseLocalViewConfig({
      room,
      activeTrack: track,
      assetSources: {
        reference: { sourceUrl: 'https://example.com/genome.fa' },
        variants: { sourceUrl: 'http://localhost:5173/variants.vcf.gz' }
      }
    })
    const missingIndex = buildJBrowseLocalViewConfig({
      room,
      activeTrack: track,
      assetSources: {
        reference: { sourceUrl: 'http://localhost:5173/genome.fa' },
        variants: { sourceUrl: 'http://localhost:5173/variants.vcf.gz' }
      }
    })
    expect(remote).toMatchObject({ ok: false, reason: expect.stringContaining('local') })
    expect(missingIndex).toMatchObject({ ok: false, reason: expect.stringContaining('requires') })
  })

  it('captures debounced viewport state and maps volatile JBrowse feature selection to its source track', () => {
    expect(biologyGenomeViewportFromJBrowseState({
      referenceAssetId: 'reference',
      trackVisibility: { genes: true, variants: false },
      view: {
        bpPerPx: 2.5,
        visibleRegions: [
          { refName: 'chr1', start: 120, end: 300 },
          { refName: 'chr1', start: 300, end: 520 }
        ]
      }
    })).toEqual({
      referenceAssetId: 'reference',
      refName: 'chr1',
      start: 120,
      end: 520,
      bpPerPx: 2.5,
      trackVisibility: { genes: true, variants: false }
    })

    const selected = biologySelectionFromJBrowseSessionSelection({
      selectedFeature: {
        get: (key: string) => ({ refName: 'chr1', start: 199, end: 200, strand: 1 })[key as 'refName'],
        id: () => 'VcfAdapter-variants-vcf-adapter-chr1-9',
        toJSON: () => ({
          uniqueId: 'VcfAdapter-variants-vcf-adapter-chr1-9',
          refName: 'chr1',
          start: 199,
          end: 200
        })
      },
      fallbackAssetId: 'genes',
      referenceAssetId: 'reference',
      trackAssetIds: { 'variants-vcf-adapter': 'variants' },
      variantAssetIds: ['variants']
    })
    expect(selected).toEqual({
      kind: 'genomic',
      assetId: 'variants',
      referenceAssetId: 'reference',
      refName: 'chr1',
      start: 199,
      end: 200,
      strand: '+',
      variantId: 'VcfAdapter-variants-vcf-adapter-chr1-9'
    })
  })

  it('keeps the selected tabix URL and declared index type consistent when TBI and CSI both exist', () => {
    const reference = asset({
      id: 'reference',
      path: 'genome.fa',
      format: 'fasta',
      modality: 'genome-reference',
      contigs: [{ name: 'chr1', length: 100 }]
    })
    const track = asset({
      id: 'variants',
      path: 'variants.vcf.gz',
      format: 'vcf',
      modality: 'genome-variant',
      referenceAssetId: reference.id,
      indexPaths: ['variants.vcf.gz.tbi', 'variants.vcf.gz.csi']
    })
    const result = buildJBrowseLocalViewConfig({
      room: manifest({ assets: [reference, track], activeAssetId: track.id }),
      activeTrack: track,
      assetSources: {
        reference: { sourceUrl: 'sciforge-resource://asset/reference' },
        variants: {
          sourceUrl: 'sciforge-resource://asset/variants',
          indexUrls: {
            'variants.vcf.gz.tbi': 'sciforge-resource://asset/variants-tbi',
            'variants.vcf.gz.csi': 'sciforge-resource://asset/variants-csi'
          }
        }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const adapter = result.config.tracks[0]!.adapter as Record<string, unknown>
    const index = adapter.index as Record<string, unknown>
    const location = index.location as Record<string, unknown>
    expect(index.indexType).toBe('TBI')
    expect(location.uri).toBe('sciforge-resource://asset/variants-tbi')
  })

  it('surfaces partial contig evidence and skips incompatible secondary tracks', () => {
    const reference = asset({
      id: 'reference',
      path: 'genome.fa',
      format: 'fasta',
      modality: 'genome-reference',
      contigs: [{ name: 'chr1', length: 100 }]
    })
    const active = asset({
      id: 'genes',
      path: 'genes.gff3',
      format: 'gff3',
      modality: 'genome-feature',
      referenceAssetId: reference.id,
      referenceCompatibility: {
        status: 'partial',
        referenceAssetId: reference.id,
        trackSha256: 'a'.repeat(64),
        referenceSha256: 'a'.repeat(64),
        unmatchedContigCount: 1,
        unmatchedExamples: ['chrUn'],
        checkedAt: NOW
      }
    })
    const incompatible = asset({
      id: 'variants',
      path: 'variants.vcf',
      format: 'vcf',
      modality: 'genome-variant',
      referenceAssetId: reference.id,
      referenceCompatibility: {
        status: 'incompatible',
        referenceAssetId: reference.id,
        trackSha256: 'a'.repeat(64),
        referenceSha256: 'a'.repeat(64),
        matchedContigCount: 0,
        unmatchedContigCount: 1,
        unmatchedExamples: ['scaffold_9'],
        reason: 'No track contigs match the reference FASTA.',
        checkedAt: NOW
      }
    })
    const built = buildJBrowseLocalViewConfig({
      room: manifest({ assets: [reference, active, incompatible], activeAssetId: active.id }),
      activeTrack: active,
      assetSources: {
        reference: { sourceUrl: 'sciforge-resource://asset/reference' },
        genes: { sourceUrl: 'sciforge-resource://asset/genes' },
        variants: { sourceUrl: 'sciforge-resource://asset/variants' }
      }
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.config.tracks).toHaveLength(1)
    expect(built.config.warnings.join(' ')).toContain('chrUn')
    expect(built.config.warnings.join(' ')).toContain('Skipped variants.vcf')
    expect(built.config.warnings.join(' ')).toContain('No track contigs match')
  })

  it('does not report deliberately hidden tracks as unavailable', () => {
    const reference = asset({
      id: 'reference',
      path: 'genome.fa',
      format: 'fasta',
      modality: 'genome-reference',
      contigs: [{ name: 'chr1', length: 100 }]
    })
    const active = asset({
      id: 'genes',
      path: 'genes.gff3',
      format: 'gff3',
      modality: 'genome-feature',
      referenceAssetId: reference.id
    })
    const hidden = asset({
      id: 'hidden-variants',
      path: 'hidden.vcf',
      format: 'vcf',
      modality: 'genome-variant',
      referenceAssetId: reference.id
    })
    const built = buildJBrowseLocalViewConfig({
      room: manifest({
        assets: [reference, active, hidden],
        activeAssetId: active.id,
        viewerStates: {
          genome: {
            referenceAssetId: reference.id,
            trackVisibility: { [active.id]: true, [hidden.id]: false }
          }
        }
      }),
      activeTrack: active,
      assetSources: {
        reference: { sourceUrl: 'sciforge-resource://asset/reference' },
        genes: { sourceUrl: 'sciforge-resource://asset/genes' }
      }
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.config.tracks).toHaveLength(1)
    expect(built.config.warnings).toEqual([])
  })
})

describe('Biology Room shell', () => {
  it('renders the three-pane room, missing-reference state, inspector tabs, and conflict banner', () => {
    const track = asset({ id: 'genes', path: 'genes.gff3', format: 'gff3', modality: 'genome-feature' })
    const room = manifest({ assets: [track], activeAssetId: track.id })
    const html = renderToStaticMarkup(createElement(BiologyRoomShell, {
      room,
      resizable: false,
      inspectorTab: 'provenance',
      conflict: { expectedRevision: 3, actualRevision: 4 },
      warning: 'One track only partially matches the reference.',
      onApply: () => undefined,
      onReloadConflict: () => undefined,
      onRequestAddAsset: () => undefined,
      onClose: () => undefined
    }))

    expect(html).toContain('data-biology-room="true"')
    expect(html).toContain('data-biology-room-assets="true"')
    expect(html).toContain('data-biology-room-inspector="true"')
    expect(html).toContain('Reference FASTA required')
    expect(html).toContain('Selection')
    expect(html).toContain('Annotations')
    expect(html).toContain('Versions')
    expect(html).toContain('Provenance')
    expect(html).toContain('data-biology-room-conflict="true"')
    expect(html).toContain('data-biology-room-warning="true"')
    expect(html).toContain('data-biology-room-source-fingerprints="true"')
    expect(html).toContain('sha256')
  })

  it('keeps the viewer as a named pane and stacks it in narrow sidebar containers', async () => {
    const structure = asset({
      id: 'structure',
      path: 'models/protein.pdb',
      format: 'pdb',
      modality: 'structure'
    })
    const html = renderToStaticMarkup(createElement(BiologyRoomShell, {
      room: manifest({ assets: [structure], activeAssetId: structure.id }),
      resizable: false
    }))
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const css = await readFile(new URL('../styles/base-shell.css', import.meta.url), 'utf8')

    expect(html).toContain('biology-room-layout')
    expect(html).toContain('biology-room-viewer')
    expect(css).toContain('@container biology-room (max-width: 560px)')
    expect(css).toContain('grid-template-rows: 78px minmax(260px, 1fr) 180px')
    expect(css).toContain('.biology-room-viewer')
  })

  it('renders a standalone conflict banner and creates schema-ready annotations', () => {
    const banner = renderToStaticMarkup(createElement(RevisionConflictBanner, {
      conflict: { expectedRevision: 4, actualRevision: 6 }
    }))
    const selection = {
      kind: 'sequence' as const,
      assetId: 'seq',
      ranges: [{ start: 0, end: 4 }]
    }
    const annotation = createBiologyRoomAnnotation({
      selection,
      body: '  catalytic motif  ',
      color: '#10b981',
      actor: { kind: 'agent', taskId: 'task-1' },
      id: 'annotation-1',
      now: NOW
    })

    expect(banner).toContain('Room changed from revision 4 to 6')
    expect(annotation).toMatchObject({
      id: 'annotation-1',
      body: 'catalytic motif',
      anchor: selection,
      createdAt: NOW,
      updatedAt: NOW
    })
  })

  it('renders persisted missing and incompatible states instead of starting a viewer', () => {
    const missing = asset({
      id: 'structure',
      path: 'models/deleted.pdb',
      format: 'pdb',
      modality: 'structure',
      readiness: 'missing',
      readinessError: 'The source was deleted outside SciForge.'
    })
    const html = renderToStaticMarkup(createElement(BiologyRoomShell, {
      room: manifest({ assets: [missing], activeAssetId: missing.id }),
      resizable: false
    }))

    expect(html).toContain('data-biology-room-viewer-state="asset-unavailable"')
    expect(html).toContain('Biology asset unavailable')
    expect(html).toContain('The source was deleted outside SciForge.')
    expect(html).toContain('data-readiness="missing"')
  })

  it('renders BioGym status, follow control, and stage-grouped assets', () => {
    const backbone = asset({ id: 'backbone', path: 'design/backbone.pdb', format: 'pdb', modality: 'structure' })
    const sequence = asset({ id: 'sequence', path: 'design/sequences.fa', format: 'fasta', modality: 'sequence' })
    const runSnapshot: BioGymRunSnapshot = {
      designRunId: 'run-1',
      roomId: 'room-1',
      workflow: 'de_novo_scaffold',
      objective: 'Design a scaffold',
      status: 'running',
      revision: 4,
      currentStageAttemptId: 'sequence-1',
      stages: [{
        id: 'backbone-1',
        kind: 'backbone',
        attempt: 1,
        status: 'succeeded',
        candidateCount: 1,
        assetIds: [backbone.id],
        candidates: [{ id: 'candidate-1', label: 'Backbone 1', assetId: backbone.id }]
      }, {
        id: 'sequence-1',
        kind: 'sequence',
        attempt: 1,
        status: 'running',
        candidateCount: 1,
        assetIds: [sequence.id],
        candidates: [{ id: 'candidate-2', label: 'Sequence 1', assetId: sequence.id }]
      }],
      budget: {
        maxGpuJobs: 6,
        usedGpuJobs: 2,
        remainingGpuJobs: 4,
        maxWallclockHours: 2,
        elapsedSeconds: 120
      },
      updatedAt: NOW
    }
    const html = renderToStaticMarkup(createElement(BiologyRoomShell, {
      room: manifest({ assets: [backbone, sequence], activeAssetId: sequence.id }),
      runSnapshot,
      followRun: false,
      onFollowRunChange: () => undefined,
      resizable: false
    }))

    expect(html).toContain('data-biogym-run-strip="true"')
    expect(html).toContain('De novo scaffold')
    expect(html).toContain('GPU 2/6')
    expect(html).toContain('Follow run')
    expect(html).toContain('data-biogym-stage-group="backbone-1"')
    expect(html).toContain('data-biogym-stage-group="sequence-1"')
  })
})

function asset(overrides: Partial<BiologyRoomAsset> & Pick<BiologyRoomAsset, 'id' | 'path' | 'format' | 'modality'>): BiologyRoomAsset {
  return {
    sha256: 'a'.repeat(64),
    sizeBytes: 1_024,
    mtimeMs: 1,
    indexPaths: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function manifest(overrides: Partial<BiologyRoomManifest> = {}): BiologyRoomManifest {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Genome review',
    revision: 4,
    assets: [],
    viewerStates: {},
    annotations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}
