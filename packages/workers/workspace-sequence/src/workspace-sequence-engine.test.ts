import assert from 'node:assert/strict'
import test from 'node:test'

import { workspaceObservationSchema } from '../../../../src/shared/workspace-preview/index.js'
import {
  WORKSPACE_SEQUENCE_MAX_RECORDS,
  WorkspaceSequenceService,
  createWorkspaceSequencePreview,
  workspaceSequenceObservationSchema,
  workspaceSequencePreviewInputSchema
} from './index.js'

test('summarizes FASTA sequence counts, lengths, alphabet, and observation shape', () => {
  const service = new WorkspaceSequenceService()
  const result = service.preview({
    text: '>chr1 first chromosome\nACGTACGTNN\n>protein_like\nMTEYKLVVVG\n',
    path: 'refs/example.fasta',
    maxRecords: 10
  })

  assert.equal(result.format, 'fasta')
  assert.equal(result.sequenceCount, 2)
  assert.equal(result.totalLength, 20)
  assert.equal(result.minLength, 10)
  assert.equal(result.maxLength, 10)
  assert.equal(result.alphabet, 'protein')
  assert.deepEqual(result.records.map((record) => record.id), ['chr1', 'protein_like'])
  assert.deepEqual(result.references.map((reference) => reference.id), ['chr1', 'protein_like'])
  assert.deepEqual(result.references[0]?.indexedRange, {
    kind: 'sequence',
    reference: 'chr1',
    start: 0,
    end: 10,
    id: 'chr1',
    type: 'sequence'
  })
  assert.equal(result.regionSummary[0]?.rangeCount, 1)
  assert.ok(result.observation)
  assert.equal(workspaceSequenceObservationSchema.parse(result.observation).view.pluginId, 'sequence-genomics')
  assert.equal(workspaceObservationSchema.parse(result.observation).view.modality, 'sequence')
  assert.match(result.observation.visibleText ?? '', /Sequences or references: 2/)
  assert.match(result.observation.visibleText ?? '', /Indexed ranges: 2/)
})

test('summarizes FASTQ reads and validates bounded input contracts', () => {
  const input = workspaceSequencePreviewInputSchema.parse({
    text: '@read1\nACGT\n+\n!!!!\n@read2 second\nAUGC\n+\n####\n',
    format: 'fastq',
    path: 'reads.fastq'
  })
  const result = createWorkspaceSequencePreview(input)

  assert.equal(result.format, 'fastq')
  assert.equal(result.readCount, 2)
  assert.equal(result.sequenceCount, 2)
  assert.equal(result.totalLength, 8)
  assert.equal(result.records[1]?.description, 'second')
  assert.equal(result.references[1]?.indexedRange?.kind, 'read')
  assert.equal(result.regionSummary[1]?.end, 4)
  assert.equal(result.warnings.length, 0)

  assert.throws(() => {
    workspaceSequencePreviewInputSchema.parse({
      text: '@read\nACGT\n+\n!!!!\n',
      maxRecords: WORKSPACE_SEQUENCE_MAX_RECORDS + 1
    })
  }, { name: 'ZodError' })
})

test('summarizes GenBank records and feature counts', () => {
  const service = new WorkspaceSequenceService()
  const result = service.preview({
    text: [
      'LOCUS       SCU49845      12 bp    DNA     linear   PLN 21-JUN-1999',
      'FEATURES             Location/Qualifiers',
      '     source          1..12',
      '     gene            1..9',
      'ORIGIN',
      '        1 acgtacgtac gt',
      '//'
    ].join('\n'),
    format: 'genbank',
    path: 'record.gbk'
  })

  assert.equal(result.format, 'genbank')
  assert.equal(result.sequenceCount, 1)
  assert.equal(result.totalLength, 12)
  assert.equal(result.featureCount, 2)
  assert.equal(result.intervalCount, 2)
  assert.equal(result.references[0]?.id, 'SCU49845')
  assert.equal(result.references[0]?.featureCount, 2)
  assert.equal(result.features[1]?.type, 'gene')
  assert.deepEqual(result.features[1]?.indexedRange, {
    kind: 'feature',
    reference: 'SCU49845',
    start: 0,
    end: 9,
    id: 'gene-2',
    type: 'gene'
  })
  assert.equal(result.regionSummary[0]?.end, 12)
  assert.equal(result.observation?.sequence?.alphabet, 'dna')
})

test('resolves compact FASTA and GenBank extensions', () => {
  const service = new WorkspaceSequenceService()

  assert.equal(service.preview({
    text: '>seq1\nACGT\n',
    path: 'seqs.fa'
  }).format, 'fasta')

  assert.equal(service.preview({
    text: '>dna\nACGT\n',
    path: 'reference.fna'
  }).format, 'fasta')

  assert.equal(service.preview({
    text: '>protein\nMPEPTIDE\n',
    path: 'proteome.faa'
  }).format, 'fasta')

  assert.equal(service.preview({
    text: [
      'LOCUS       MINI           4 bp    DNA     linear   PLN 01-JAN-2000',
      'ORIGIN',
      '        1 acgt',
      '//'
    ].join('\n'),
    path: 'mini.gb'
  }).format, 'genbank')
})

test('summarizes GFF, GTF, BED, and VCF feature-like genomics rows', () => {
  const service = new WorkspaceSequenceService()

  const gff = service.preview({
    text: 'chr1\tsrc\tgene\t5\t20\t.\t+\t.\tID=gene1;Name=Gene One\nchr1\tsrc\texon\t8\t12\t.\t+\t.\tParent=gene1\n',
    path: 'genes.gff'
  })
  assert.equal(gff.format, 'gff')
  assert.equal(gff.sequenceCount, 1)
  assert.equal(gff.featureCount, 2)
  assert.equal(gff.intervalCount, 2)
  assert.equal(gff.features[0]?.id, 'gene1')
  assert.equal(gff.features[0]?.indexedRange?.kind, 'feature')
  assert.equal(gff.features[0]?.indexedRange?.start, 4)
  assert.equal(gff.regionSummary[0]?.start, 4)
  assert.equal(gff.regionSummary[0]?.end, 20)

  const gtf = service.preview({
    text: 'chr2\tsrc\ttranscript\t10\t30\t.\t-\t.\tgene_id "g2"; transcript_id "tx2";\n',
    path: 'transcripts.gtf'
  })
  assert.equal(gtf.format, 'gtf')
  assert.equal(gtf.featureCount, 1)
  assert.equal(gtf.features[0]?.id, 'g2')
  assert.equal(gtf.features[0]?.strand, '-')

  const bed = service.preview({
    text: 'chr1\t0\t10\tpeak1\nchr2\t5\t9\tpeak2\n',
    path: 'peaks.bed'
  })
  assert.equal(bed.format, 'bed')
  assert.equal(bed.sequenceCount, 2)
  assert.equal(bed.intervalCount, 2)
  assert.equal(bed.features[1]?.reference, 'chr2')
  assert.equal(bed.features[0]?.indexedRange?.kind, 'interval')

  const vcf = service.preview({
    text: [
      '##fileformat=VCFv4.3',
      '##contig=<ID=chr1,length=1000>',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ts1\ts2',
      'chr1\t10\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1\t1/1',
      'chr1\t20\t.\tAT\tA\t.\tPASS\t.\tGT\t0/1\t0/0'
    ].join('\n'),
    path: 'variants.vcf'
  })
  assert.equal(vcf.format, 'vcf')
  assert.equal(vcf.sequenceCount, 1)
  assert.equal(vcf.totalLength, 1000)
  assert.equal(vcf.variantCount, 2)
  assert.equal(vcf.sampleCount, 2)
  assert.deepEqual(vcf.variants.map((variant) => variant.type), ['snv', 'indel'])
  assert.deepEqual(vcf.variants[1]?.indexedRange, {
    kind: 'variant',
    reference: 'chr1',
    start: 19,
    end: 21,
    type: 'variant:indel'
  })
  assert.equal(vcf.regionSummary[0]?.sequenceLength, 1000)
  assert.ok(vcf.indexedRanges.length >= 3)
  assert.equal(workspaceObservationSchema.parse(vcf.observation).sequence?.sequenceCount, 1)
})

test('selects bounded sequence regions from preview indexes without file IO', () => {
  const service = new WorkspaceSequenceService()
  const preview = service.preview({
    text: [
      '##fileformat=VCFv4.3',
      '##contig=<ID=chr1,length=1000>',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
      'chr1\t10\trs1\tA\tG\t.\tPASS\t.',
      'chr1\t20\trs2\tAT\tA\t.\tPASS\t.',
      'chr2\t7\trs3\tC\tT\t.\tPASS\t.'
    ].join('\n'),
    path: 'variants.vcf'
  })

  const selection = service.selectRegion({
    preview,
    reference: 'chr1',
    start: 9,
    end: 20,
    maxVariants: 1
  })

  assert.equal(selection.reference, 'chr1')
  assert.equal(selection.variantCount, 2)
  assert.equal(selection.variants.length, 1)
  assert.equal(selection.truncatedVariants, true)
  assert.equal(selection.selection.kind, 'sequence')
  assert.equal(selection.selection.sequenceId, 'chr1')
  assert.deepEqual(selection.selection.ranges, [{ start: 9, end: 20 }])
  assert.deepEqual(selection.selection.features?.map((feature) => feature.type), ['variant:snv'])
  assert.match(selection.visibleText ?? '', /Overlapping bounded variants: 2/)

  assert.throws(() => {
    service.selectRegion({
      preview,
      reference: 'chr1',
      start: 20,
      end: 9
    })
  }, { name: 'RangeError' })
})

test('searches FASTA record ids and bounded motif previews in memory', () => {
  const service = new WorkspaceSequenceService()
  const preview = service.preview({
    text: '>chr1 first chromosome\nACGTACGTNN\n>chr2 second chromosome\nTTTACGTTT\n',
    path: 'refs/example.fasta'
  })

  const recordSearch = service.search({
    preview,
    query: 'chr1',
    scope: 'records'
  })
  assert.equal(recordSearch.matchCount, 1)
  assert.equal(recordSearch.matches[0]?.kind, 'record')
  assert.equal(recordSearch.matches[0]?.reference, 'chr1')
  assert.equal(recordSearch.matches[0]?.start, 0)
  assert.equal(recordSearch.matches[0]?.end, 10)
  assert.equal(recordSearch.selection?.sequenceId, 'chr1')

  const motifSearch = service.search({
    preview,
    query: 'CGTAC',
    scope: 'records'
  })
  assert.equal(motifSearch.matchCount, 1)
  assert.equal(motifSearch.matches[0]?.kind, 'motif')
  assert.equal(motifSearch.matches[0]?.reference, 'chr1')
  assert.equal(motifSearch.matches[0]?.start, 1)
  assert.equal(motifSearch.matches[0]?.end, 6)
  assert.equal(motifSearch.selection?.features?.[0]?.type, 'motif')
  assert.match(motifSearch.visibleText ?? '', /motif chr1:1-6/)
})

test('searches GFF feature ids and types from bounded preview summaries', () => {
  const service = new WorkspaceSequenceService()
  const preview = service.preview({
    text: 'chr1\tsrc\tgene\t5\t20\t.\t+\t.\tID=gene1;Name=Gene One\nchr1\tsrc\texon\t8\t12\t.\t+\t.\tParent=gene1\n',
    path: 'genes.gff'
  })

  const idSearch = service.search({
    preview,
    query: 'gene1',
    scope: 'features'
  })
  assert.equal(idSearch.matchCount, 1)
  assert.equal(idSearch.matches[0]?.kind, 'feature')
  assert.equal(idSearch.matches[0]?.id, 'gene1')
  assert.equal(idSearch.matches[0]?.type, 'gene')
  assert.deepEqual(idSearch.selection?.features?.[0], {
    id: 'gene1',
    type: 'gene',
    start: 4,
    end: 20
  })

  const typeSearch = service.search({
    preview,
    query: 'exon',
    scope: 'features',
    caseSensitive: true
  })
  assert.equal(typeSearch.matchCount, 1)
  assert.equal(typeSearch.matches[0]?.type, 'exon')
})

test('searches VCF variant ids, references, and bounded result limits', () => {
  const service = new WorkspaceSequenceService()
  const preview = service.preview({
    text: [
      '##fileformat=VCFv4.3',
      '##contig=<ID=chr1,length=1000>',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
      'chr1\t10\trs1\tA\tG\t.\tPASS\t.',
      'chr1\t20\trs2\tAT\tA\t.\tPASS\t.'
    ].join('\n'),
    path: 'variants.vcf'
  })

  const idSearch = service.search({
    preview,
    query: 'rs2',
    scope: 'variants'
  })
  assert.equal(idSearch.matchCount, 1)
  assert.equal(idSearch.matches[0]?.kind, 'variant')
  assert.equal(idSearch.matches[0]?.id, 'rs2')
  assert.equal(idSearch.matches[0]?.type, 'variant:indel')
  assert.equal(idSearch.matches[0]?.start, 19)
  assert.equal(idSearch.matches[0]?.end, 21)

  const referenceSearch = service.search({
    preview,
    query: 'chr1',
    scope: 'variants',
    maxResults: 1
  })
  assert.equal(referenceSearch.matchCount, 2)
  assert.equal(referenceSearch.matches.length, 1)
  assert.equal(referenceSearch.truncated, true)
  assert.match(referenceSearch.warnings.join(' '), /increase maxResults/)
})
