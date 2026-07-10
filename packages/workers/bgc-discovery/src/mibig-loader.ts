import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MibigRecord } from './types.js'

export async function loadMibigRecords(inputPath: string, ids: string[] = []): Promise<Map<string, MibigRecord>> {
  const wanted = new Set(ids.map((id) => id.toUpperCase()).filter(Boolean))
  const files = await discoverJsonFiles(inputPath)
  const records = new Map<string, MibigRecord>()
  for (const file of files) {
    const guessed = file.match(/BGC\d{7}/i)?.[0]?.toUpperCase()
    if (wanted.size > 0 && guessed && !wanted.has(guessed)) continue
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
      const record = mibigRecordFromJson(raw, guessed)
      if (!record) continue
      if (wanted.size === 0 || wanted.has(record.id.toUpperCase())) {
        records.set(record.id.toUpperCase(), record)
      }
    } catch {
      // Skip malformed records but keep the pipeline moving.
    }
  }
  return records
}

async function discoverJsonFiles(inputPath: string): Promise<string[]> {
  const info = await stat(inputPath)
  if (info.isFile()) return [inputPath]
  const entries = await readdir(inputPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(inputPath, entry.name)
    if (entry.isDirectory()) files.push(...await discoverJsonFiles(full))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(full)
  }
  return files.sort()
}

function mibigRecordFromJson(value: unknown, fallbackId?: string): MibigRecord | null {
  if (!value || typeof value !== 'object') return fallbackId ? { id: fallbackId } : null
  const obj = value as Record<string, unknown>
  const cluster = objectValue(obj.cluster) ?? objectValue(obj.general_params) ?? obj
  const id = firstString([
    obj.mibig_id,
    obj.accession,
    obj.id,
    (cluster as Record<string, unknown>).mibig_accession,
    (cluster as Record<string, unknown>).mibig_id,
    (cluster as Record<string, unknown>).accession,
    fallbackId
  ])?.toUpperCase()
  if (!id) return null
  const compounds = compoundRecords((cluster as Record<string, unknown>).compounds)
  return {
    id,
    accession: firstString([obj.accession, (cluster as Record<string, unknown>).accession]),
    product: firstString([
      obj.product,
      obj.products,
      (cluster as Record<string, unknown>).product,
      (cluster as Record<string, unknown>).products,
      uniqueStrings(compounds.map((compound) => compound.compound))
    ]),
    productClass: firstString([
      obj.product_class,
      obj.productClass,
      obj.class,
      (cluster as Record<string, unknown>).biosyn_class,
      (cluster as Record<string, unknown>).product_class
    ]),
    bioactivity: firstString([
      obj.bioactivity,
      obj.activities,
      (cluster as Record<string, unknown>).bioactivity,
      (cluster as Record<string, unknown>).activities,
      uniqueStrings(compounds.flatMap((compound) => chemicalActivities(compound.chem_acts)))
    ]),
    organism: firstString([
      obj.organism,
      (cluster as Record<string, unknown>).organism_name,
      (cluster as Record<string, unknown>).organism
    ]),
    publications: arrayStrings(obj.publications ?? (cluster as Record<string, unknown>).publications)
  }
}

function compoundRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  ))
}

function chemicalActivities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : []
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const activity = (item as Record<string, unknown>).activity
    return typeof activity === 'string' && activity.trim() ? [activity.trim()] : []
  })
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && Boolean(value.trim())
  )).map((value) => value.trim()))]
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value) && value.length > 0) {
      const joined = value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('; ')
      if (joined.trim()) return joined
    }
  }
  return undefined
}

function arrayStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => String(item)).filter(Boolean).slice(0, 20)
}
