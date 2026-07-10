import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BigscapeAssignment } from './types.js'

export async function importBigscapeAssignments(inputPath: string): Promise<Map<string, BigscapeAssignment>> {
  const files = await discoverAssignmentFiles(inputPath)
  const assignments = new Map<string, BigscapeAssignment>()
  for (const file of files) {
    const rows = parseDelimited(await readFile(file, 'utf8'))
    for (const row of rows) {
      if (isBigscapeNetworkRow(row)) {
        mergeNetworkRow(assignments, row)
        continue
      }
      const bgcId = pick(row, ['bgc_id', 'BGC', 'bgc', 'record', 'record_id', 'Region', 'region'])
      if (!bgcId) continue
      const normalized = normalizeBgcId(bgcId)
      const existing = assignments.get(normalized)
      const next: BigscapeAssignment = {
        bgcId: normalized,
        geneClusterFamily: pick(row, ['gcf_id', 'GCF', 'family', 'family_id', 'clan', 'component']) ?? existing?.geneClusterFamily,
        familySize: numberValue(pick(row, ['family_size', 'size', 'gcf_size'])) ?? existing?.familySize,
        mibigMembersInFamily: unique([
          ...(existing?.mibigMembersInFamily ?? []),
          ...splitList(pick(row, ['mibig_members', 'MIBiG', 'mibig_ids', 'reference_bgc']))
        ]),
        networkNeighbors: unique([
          ...(existing?.networkNeighbors ?? []),
          ...splitList(pick(row, ['network_neighbors', 'neighbors', 'nearest_neighbors', 'neighbor']))
        ])
      }
      assignments.set(normalized, next)
    }
  }
  assignNetworkComponents(assignments)
  return assignments
}

async function discoverAssignmentFiles(inputPath: string): Promise<string[]> {
  const info = await stat(inputPath)
  if (info.isFile()) return [inputPath]
  const files = await listFiles(inputPath)
  const preferred = files.filter((file) => /clustering.*\.(tsv|csv)$/i.test(file) || /assignment.*\.(tsv|csv)$/i.test(file))
  const networks = files.filter((file) => /\.network$/i.test(file))
  if (preferred.length > 0 || networks.length > 0) return unique([...preferred, ...networks]).sort()
  return files.filter((file) => /\.(tsv|csv|network)$/i.test(file)).sort()
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function parseDelimited(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (lines.length === 0) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const header = lines[0].split(delimiter).map((value) => value.trim())
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter)
    const row: Record<string, string> = {}
    header.forEach((key, index) => {
      row[key] = values[index]?.trim() ?? ''
    })
    return row
  })
}

export function normalizeBgcId(value: string): string {
  let normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .replace(/\.gbk_region_0*([0-9]+)$/i, '.region$1')
    .replace(/\.(gbk|gb|gbff)$/i, '')
    .replace(/\.region0*([0-9]+)/i, '_region_$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  normalized = normalized.replace(/^(.+?)_[0-9]+_region_([0-9]+)$/i, '$1_region_$2')
  normalized = normalized.replace(/_region_0*([0-9]+)$/i, (_match, region: string) => `_region_${region.padStart(3, '0')}`)
  return normalized
}

function isBigscapeNetworkRow(row: Record<string, string>): boolean {
  return Boolean(pick(row, ['GBK_a', 'Record_a']) && pick(row, ['GBK_b', 'Record_b']))
}

function mergeNetworkRow(assignments: Map<string, BigscapeAssignment>, row: Record<string, string>): void {
  const left = normalizeBgcId(pick(row, ['GBK_a', 'Record_a'])!)
  const right = normalizeBgcId(pick(row, ['GBK_b', 'Record_b'])!)
  if (!left || !right || left === right) return
  mergeNetworkNeighbor(assignments, left, right)
  mergeNetworkNeighbor(assignments, right, left)
}

function mergeNetworkNeighbor(assignments: Map<string, BigscapeAssignment>, bgcId: string, neighbor: string): void {
  const existing = assignments.get(bgcId)
  assignments.set(bgcId, {
    bgcId,
    geneClusterFamily: existing?.geneClusterFamily,
    familySize: existing?.familySize,
    mibigMembersInFamily: unique([
      ...(existing?.mibigMembersInFamily ?? []),
      ...mibigIds([bgcId, neighbor])
    ]),
    networkNeighbors: unique([
      ...(existing?.networkNeighbors ?? []),
      neighbor
    ])
  })
}

function assignNetworkComponents(assignments: Map<string, BigscapeAssignment>): void {
  const visited = new Set<string>()
  let componentIndex = 0
  for (const bgcId of assignments.keys()) {
    if (visited.has(bgcId)) continue
    const component = collectComponent(assignments, bgcId, visited)
    if (component.length <= 1) continue
    componentIndex += 1
    const family = `BigSCAPE_component_${String(componentIndex).padStart(3, '0')}`
    const componentMibigIds = mibigIds(component)
    for (const member of component) {
      const existing = assignments.get(member)
      if (!existing) continue
      assignments.set(member, {
        ...existing,
        geneClusterFamily: existing.geneClusterFamily ?? family,
        familySize: existing.familySize ?? component.length,
        mibigMembersInFamily: unique([
          ...existing.mibigMembersInFamily,
          ...componentMibigIds
        ])
      })
    }
  }
}

function collectComponent(assignments: Map<string, BigscapeAssignment>, start: string, visited: Set<string>): string[] {
  const queue = [start]
  const component: string[] = []
  visited.add(start)
  while (queue.length > 0) {
    const current = queue.shift()!
    component.push(current)
    const record = assignments.get(current)
    for (const neighbor of record?.networkNeighbors ?? []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
  return component
}

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value.split(/[;,| ]+/).map((item) => item.trim()).filter(Boolean)
}

function unique(values: string[]): string[] {
  return [...new Set(values)].slice(0, 100)
}

function mibigIds(values: string[]): string[] {
  return unique(values.flatMap((value) => value.match(/BGC[0-9]{7}/gi) ?? []).map((value) => value.toUpperCase()))
}

function numberValue(value: string | undefined): number | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}
