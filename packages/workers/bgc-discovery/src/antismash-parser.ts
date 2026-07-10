import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AntismashRegionRecord } from './types.js'

const CORE_GENE_PATTERNS = [
  'polyketide synthase',
  'pks',
  'nonribosomal peptide synthetase',
  'nrps',
  'terpene synthase',
  'lanthipeptide',
  'bacteriocin',
  'biosynthetic'
]

const TAILORING_PATTERNS = [
  'methyltransferase',
  'oxidoreductase',
  'cytochrome p450',
  'p450',
  'halogenase',
  'glycosyltransferase',
  'aminotransferase',
  'acyltransferase',
  'dehydrogenase',
  'monooxygenase'
]

const REGULATOR_PATTERNS = [
  'transcriptional regulator',
  'transcription factor',
  'response regulator',
  'luxr',
  'tetr',
  'lacl',
  'regulator'
]

export async function parseAntismashOutput(inputPath: string, maxRegions = 10_000): Promise<AntismashRegionRecord[]> {
  const files = await discoverAntismashFiles(inputPath)
  const records: AntismashRegionRecord[] = []
  for (const file of files) {
    if (records.length >= maxRegions) break
    const ext = extname(file).toLowerCase()
    const text = await readFile(file, 'utf8')
    if (ext === '.json') {
      records.push(...parseJsonAntismash(text, file).slice(0, maxRegions - records.length))
    } else {
      records.push(parseGenbankRegion(text, file))
    }
  }
  return records
}

async function discoverAntismashFiles(inputPath: string): Promise<string[]> {
  const info = await stat(inputPath)
  if (info.isFile()) return [inputPath]
  const all = await listFiles(inputPath)
  const regionGbks = all.filter((file) => /region.*\.gbk$/i.test(file) || /region.*\.gbff$/i.test(file))
  if (regionGbks.length > 0) return regionGbks.sort()
  const gbks = all.filter((file) => /\.(gbk|gb|gbff)$/i.test(file))
  if (gbks.length > 0) return gbks.sort()
  return all.filter((file) => /\.json$/i.test(file)).sort()
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

function parseGenbankRegion(text: string, sourceFile: string): AntismashRegionRecord {
  const locus = matchFirst(text, /^LOCUS\s+(\S+)/m)
  const source = matchFirst(text, /^\s+\/organism="([^"]+)"/m)
  const regionNumber = matchFirst(sourceFile.replace(/\\/g, '/'), /region0*([0-9]+)/i) ?? '1'
  const contigId = matchFirst(text, /^VERSION\s+(\S+)/m) ?? matchFirst(text, /^ACCESSION\s+(\S+)/m) ?? locus
  const range = parseRegionRange(text)
  const products = unique([...text.matchAll(/\/product="([^"]+)"/g)].map((m) => m[1]))
  const notes = unique([...text.matchAll(/\/note="([^"]+)"/g)].map((m) => m[1]))
  const candidateDescriptions = [...products, ...notes].join('\n').toLowerCase()
  const knownClusterHits = unique([...candidateDescriptions.matchAll(/bgc\d{7}/gi)].map((m) => m[0].toUpperCase()))
  const product = products.find((value) => looksLikeClusterProduct(value)) ?? products[0]
  const bgcType = normalizeBgcType(product ?? candidateDescriptions)
  const normalizedContig = normalizeId(contigId ?? locus ?? 'unknown_contig')
  const normalizedRegion = `region_${String(regionNumber).padStart(3, '0')}`
  return {
    bgcId: `${normalizedContig}_${normalizedRegion}`,
    regionId: normalizedRegion,
    ...(contigId ? { contigId } : {}),
    ...(source ? { organism: source } : {}),
    ...(range.start ? { start: range.start } : {}),
    ...(range.end ? { end: range.end } : {}),
    bgcType,
    ...(product ? { product } : {}),
    ...(bgcType !== 'unknown' ? { predictedProductClass: bgcType } : {}),
    coreGenes: collectMatching(products, CORE_GENE_PATTERNS),
    tailoringEnzymes: collectMatching(products, TAILORING_PATTERNS),
    regulators: collectMatching(products, REGULATOR_PATTERNS),
    knownClusterHits,
    ...(knownClusterHits[0] ? { nearestMibigHit: knownClusterHits[0] } : {}),
    sourceFile,
    toolSource: 'antismash'
  }
}

function parseJsonAntismash(text: string, sourceFile: string): AntismashRegionRecord[] {
  const parsed = JSON.parse(text) as unknown
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return []
    const obj = value as Record<string, unknown>
    const id = stringValue(obj.bgc_id ?? obj.bgcId ?? obj.id ?? obj.region_id) ?? `json_region_${index + 1}`
    const product = stringValue(obj.product ?? obj.products ?? obj.predicted_product_class)
    const bgcType = normalizeBgcType(stringValue(obj.bgc_type ?? obj.type ?? product) ?? '')
    const hits = arrayStrings(obj.known_cluster_hits ?? obj.mibig_hits)
    const nearest = stringValue(obj.nearest_mibig_hit) ?? hits[0]
    return [{
      bgcId: normalizeId(id),
      regionId: stringValue(obj.region_id) ?? `region_${index + 1}`,
      contigId: stringValue(obj.contig_id),
      organism: stringValue(obj.organism),
      start: numberValue(obj.start),
      end: numberValue(obj.end),
      bgcType,
      product,
      predictedProductClass: stringValue(obj.predicted_product_class) ?? (bgcType === 'unknown' ? undefined : bgcType),
      coreGenes: arrayStrings(obj.core_genes),
      tailoringEnzymes: arrayStrings(obj.tailoring_enzymes),
      regulators: arrayStrings(obj.regulators),
      knownClusterHits: hits,
      nearestMibigHit: nearest,
      sourceFile,
      toolSource: 'antismash' as const
    }]
  })
}

function parseRegionRange(text: string): { start?: number; end?: number } {
  const candidate = matchFirst(text, /^FEATURES[\s\S]*?^\s{5}(?:region|protocluster|cand_cluster)\s+([^\n]+)/m)
  const numbers = candidate ? [...candidate.matchAll(/\d+/g)].map((m) => Number(m[0])) : []
  if (numbers.length < 2) return {}
  return { start: Math.min(...numbers), end: Math.max(...numbers) }
}

function collectMatching(values: string[], patterns: string[]): string[] {
  const found: string[] = []
  for (const value of values) {
    const lower = value.toLowerCase()
    if (patterns.some((pattern) => lower.includes(pattern))) found.push(value)
  }
  return unique(found).slice(0, 50)
}

function normalizeBgcType(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('nrps') || lower.includes('nonribosomal')) return 'NRPS'
  if (lower.includes('pks') || lower.includes('polyketide')) return 'PKS'
  if (lower.includes('terpene')) return 'terpene'
  if (lower.includes('ripp') || lower.includes('lanth')) return 'RiPP'
  if (lower.includes('siderophore')) return 'siderophore'
  return 'unknown'
}

function looksLikeClusterProduct(value: string): boolean {
  const lower = value.toLowerCase()
  return ['nrps', 'pks', 'terpene', 'ripp', 'siderophore', 'lanth'].some((needle) => lower.includes(needle))
}

function normalizeId(value: string): string {
  return value.replace(/\.[^.\\/]+$/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])]
}

function matchFirst(text: string, regex: RegExp): string | undefined {
  return regex.exec(text)?.[1]?.trim()
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) return value.map((item) => String(item)).join('; ')
  return undefined
}

function numberValue(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? numeric : undefined
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return unique(value.map((item) => String(item)))
}
