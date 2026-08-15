import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitReceiptV1,
  ArtifactVersionRefV1
} from '../contract.js'
import {
  ArtifactVersionService,
  type ArtifactVersionAccessContext
} from './service.js'

const FIXTURE_PATH = fileURLToPath(new URL(
  '../../../../../test-fixtures/biology/palmer-penguins/penguins.csv',
  import.meta.url
))
const SOURCE_DIGEST = 'f204db2c753b0937caac3cb35258562c14f073e4bbc76be24b4c51ce22767a93'
const SOURCE_COMMIT = 'c19a904462482430170bfe2c718775ddb7dbb885'
const SOURCE_URL = `https://github.com/allisonhorst/palmerpenguins/blob/${SOURCE_COMMIT}/inst/extdata/penguins.csv`
const ACCESS: ArtifactVersionAccessContext = Object.freeze({
  audience: 'system',
  callerId: 'artifact-versions:palmer-penguins-long-chain'
})

const HEADERS = [
  'species',
  'island',
  'bill_length_mm',
  'bill_depth_mm',
  'flipper_length_mm',
  'body_mass_g',
  'sex',
  'year'
] as const

type Header = typeof HEADERS[number]
type Penguin = Record<Header, string | number | null>
type AnalysisStep = Readonly<{
  title: string
  changeReason: string
  result: unknown
}>
type CommitReceiptItem = ArtifactVersionCommitReceiptV1['versions'][number]

function valueOf<T>(result: { ok: true; value: T } | { ok: false; issue: unknown }): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  return (result as { ok: true; value: T }).value
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parsePenguins(csv: string): Penguin[] {
  const lines = csv.trimEnd().split('\n')
  assert.deepEqual(lines[0]?.split(','), [...HEADERS])
  return lines.slice(1).map((line) => {
    const values = line.split(',')
    assert.equal(values.length, HEADERS.length)
    return Object.fromEntries(HEADERS.map((header, index) => {
      const raw = values[index]!
      if (raw === 'NA') return [header, null]
      if (header === 'species' || header === 'island' || header === 'sex') {
        return [header, raw]
      }
      return [header, Number(raw)]
    })) as Penguin
  })
}

function countBy(rows: Penguin[], key: Header): Record<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[key]
    const label = value === null ? 'missing' : String(value)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function numericValues(rows: Penguin[], key: Header): number[] {
  return rows.flatMap((row) => typeof row[key] === 'number' ? [row[key] as number] : [])
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function mean(values: number[]): number {
  assert.ok(values.length > 0)
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: number[]): number {
  assert.ok(values.length > 0)
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function summarizeBy(rows: Penguin[], groupKey: Header, valueKey: Header): Record<string, unknown> {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const group = row[groupKey]
    const value = row[valueKey]
    if (group === null || typeof value !== 'number') continue
    const bucket = groups.get(String(group)) ?? []
    bucket.push(value)
    groups.set(String(group), bucket)
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, values]) => [group, {
      n: values.length,
      mean: round(mean(values)),
      median: round(median(values)),
      min: Math.min(...values),
      max: Math.max(...values)
    }]))
}

function paired(rows: Penguin[], leftKey: Header, rightKey: Header): Array<[number, number]> {
  return rows.flatMap((row) => {
    const left = row[leftKey]
    const right = row[rightKey]
    return typeof left === 'number' && typeof right === 'number' ? [[left, right]] : []
  })
}

function correlation(pairs: Array<[number, number]>): number {
  const leftMean = mean(pairs.map(([left]) => left))
  const rightMean = mean(pairs.map(([, right]) => right))
  const numerator = pairs.reduce(
    (total, [left, right]) => total + (left - leftMean) * (right - rightMean),
    0
  )
  const leftScale = Math.sqrt(pairs.reduce(
    (total, [left]) => total + (left - leftMean) ** 2,
    0
  ))
  const rightScale = Math.sqrt(pairs.reduce(
    (total, [, right]) => total + (right - rightMean) ** 2,
    0
  ))
  return numerator / (leftScale * rightScale)
}

function slope(pairs: Array<[number, number]>): number {
  const xMean = mean(pairs.map(([x]) => x))
  const yMean = mean(pairs.map(([, y]) => y))
  const numerator = pairs.reduce((total, [x, y]) => total + (x - xMean) * (y - yMean), 0)
  const denominator = pairs.reduce((total, [x]) => total + (x - xMean) ** 2, 0)
  return numerator / denominator
}

function trimmedMean(values: number[], proportion: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  const trim = Math.floor(sorted.length * proportion)
  return mean(sorted.slice(trim, sorted.length - trim))
}

function groupRows(rows: Penguin[], key: Header): Map<string, Penguin[]> {
  const groups = new Map<string, Penguin[]>()
  for (const row of rows) {
    const value = row[key]
    if (value === null) continue
    const bucket = groups.get(String(value)) ?? []
    bucket.push(row)
    groups.set(String(value), bucket)
  }
  return groups
}

function buildAnalysisSteps(rows: Penguin[]): AnalysisStep[] {
  const completeCases = rows.filter((row) => HEADERS.every((header) => row[header] !== null))
  const speciesGroups = groupRows(rows, 'species')
  const speciesSlopes = Object.fromEntries([...speciesGroups.entries()].map(([species, group]) => [
    species,
    round(slope(paired(group, 'flipper_length_mm', 'body_mass_g')))
  ]))
  const availableMass = numericValues(rows, 'body_mass_g')
  const completeMass = numericValues(completeCases, 'body_mass_g')

  return [
    {
      title: 'Freeze source provenance',
      changeReason: 'Pin the biological dataset, license, citation, and immutable byte digest.',
      result: {
        sourceUrl: SOURCE_URL,
        sourceCommit: SOURCE_COMMIT,
        sourceSha256: SOURCE_DIGEST,
        license: 'CC0-1.0',
        packageDoi: '10.5281/zenodo.3960218',
        studyDoi: '10.1371/journal.pone.0090081'
      }
    },
    {
      title: 'Inventory records and schema',
      changeReason: 'Establish the observation count and expected morphometric fields before analysis.',
      result: { observations: rows.length, columns: [...HEADERS], columnCount: HEADERS.length }
    },
    {
      title: 'Quantify missingness',
      changeReason: 'Make missing biological measurements explicit before selecting an analysis cohort.',
      result: Object.fromEntries(HEADERS.map((header) => [
        header,
        rows.filter((row) => row[header] === null).length
      ]))
    },
    {
      title: 'Define complete-case cohort',
      changeReason: 'Freeze a reproducible complete-case rule for multivariable descriptive analyses.',
      result: {
        completeCases: completeCases.length,
        excluded: rows.length - completeCases.length,
        retainedFraction: round(completeCases.length / rows.length)
      }
    },
    {
      title: 'Summarize species representation',
      changeReason: 'Check whether morphometric summaries are supported across all three penguin species.',
      result: countBy(rows, 'species')
    },
    {
      title: 'Summarize island sampling',
      changeReason: 'Expose the geographic sampling structure that may confound species comparisons.',
      result: countBy(rows, 'island')
    },
    {
      title: 'Summarize recorded sex',
      changeReason: 'Quantify sex balance and missing labels before sex-stratified summaries.',
      result: countBy(rows, 'sex')
    },
    {
      title: 'Summarize collection years',
      changeReason: 'Check temporal coverage before treating all measurements as one cross-sectional sample.',
      result: countBy(rows, 'year')
    },
    {
      title: 'Estimate body mass by species',
      changeReason: 'Add species-specific distribution summaries for the primary size measurement.',
      result: summarizeBy(rows, 'species', 'body_mass_g')
    },
    {
      title: 'Estimate flipper length by species',
      changeReason: 'Add a second size-related trait and retain sample counts for every estimate.',
      result: summarizeBy(rows, 'species', 'flipper_length_mm')
    },
    {
      title: 'Estimate bill morphology by species',
      changeReason: 'Separate bill length and depth patterns rather than collapsing morphology to body size.',
      result: {
        billLengthMm: summarizeBy(rows, 'species', 'bill_length_mm'),
        billDepthMm: summarizeBy(rows, 'species', 'bill_depth_mm')
      }
    },
    {
      title: 'Stratify body mass by species and sex',
      changeReason: 'Reduce the risk of attributing sex-associated size variation only to species.',
      result: Object.fromEntries([...speciesGroups.entries()].map(([species, group]) => [
        species,
        summarizeBy(group, 'sex', 'body_mass_g')
      ]))
    },
    {
      title: 'Measure flipper-length and mass association',
      changeReason: 'Quantify the descriptive linear association while avoiding causal language.',
      result: {
        pairedObservations: paired(rows, 'flipper_length_mm', 'body_mass_g').length,
        pearsonCorrelation: round(correlation(paired(rows, 'flipper_length_mm', 'body_mass_g'))),
        interpretation: 'Descriptive association only; the sampled observations do not establish causality.'
      }
    },
    {
      title: 'Estimate within-species linear slopes',
      changeReason: 'Check whether the pooled flipper-mass association persists within each species.',
      result: {
        response: 'body_mass_g',
        predictor: 'flipper_length_mm',
        gramsPerMillimetre: speciesSlopes
      }
    },
    {
      title: 'Run missingness and outlier sensitivity checks',
      changeReason: 'Compare available-case, complete-case, and 5% trimmed estimates before synthesis.',
      result: {
        bodyMassG: {
          availableCaseN: availableMass.length,
          availableCaseMean: round(mean(availableMass)),
          completeCaseN: completeMass.length,
          completeCaseMean: round(mean(completeMass)),
          trimmedMean5Percent: round(trimmedMean(availableMass, 0.05))
        },
        conclusion: 'Results are descriptive and remain tied to the frozen Palmer LTER sample.'
      }
    }
  ]
}

function renderCheckpoint(steps: AnalysisStep[], ordinal: number, extra?: Record<string, unknown>): string {
  const active = steps[ordinal - 1]!
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: 'research-checkpoint-long-chain-fixture',
    title: 'Palmer Penguins morphometrics: iterative descriptive analysis',
    dataset: {
      sourceCommit: SOURCE_COMMIT,
      sourceSha256: SOURCE_DIGEST,
      observations: 344,
      columns: 8,
      license: 'CC0-1.0'
    },
    iteration: {
      ordinal,
      title: active.title,
      changeReason: active.changeReason
    },
    analysisHistory: steps.slice(0, ordinal),
    ...extra
  }, null, 2)}\n`
}

test('persists a real Palmer Penguins research artifact through 15 iterations, restarts, restore, and continuation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-versions-palmer-long-chain-'))
  const userDataDir = join(root, 'user-data')
  const workspace = join(root, 'workspace')
  await mkdir(userDataDir)
  await mkdir(workspace)

  try {
    const sourceBytes = await readFile(FIXTURE_PATH)
    assert.equal(sourceBytes.byteLength, 15_241)
    assert.equal(sha256(sourceBytes), SOURCE_DIGEST)
    const rows = parsePenguins(sourceBytes.toString('utf8'))
    assert.equal(rows.length, 344)
    const steps = buildAnalysisSteps(rows)
    assert.equal(steps.length, 15)
    assert.deepEqual(countBy(rows, 'species'), { Adelie: 152, Chinstrap: 68, Gentoo: 124 })
    assert.deepEqual(steps[2]?.result, {
      species: 0,
      island: 0,
      bill_length_mm: 2,
      bill_depth_mm: 2,
      flipper_length_mm: 2,
      body_mass_g: 2,
      sex: 11,
      year: 0
    })
    assert.equal((steps[3]?.result as { completeCases: number }).completeCases, 333)
    assert.equal(
      (steps[12]?.result as { pearsonCorrelation: number }).pearsonCorrelation,
      0.8712
    )

    let service = new ArtifactVersionService({ userDataDir })
    const source = valueOf(await service.commit(workspace, {
      idempotencyKey: 'palmer-penguins:source:c19a9044',
      candidates: [{
        candidateId: 'palmer-penguins-csv',
        expectedCurrentVersionId: null,
        kind: 'dataset',
        label: 'Palmer Penguins CSV at c19a9044',
        intent: 'save',
        content: {
          mode: 'snapshot',
          dataBase64: sourceBytes.toString('base64'),
          mediaType: 'text/csv'
        },
        metadata: {
          sourceUrl: SOURCE_URL,
          sourceCommit: SOURCE_COMMIT,
          sourceDigest: SOURCE_DIGEST,
          license: 'CC0-1.0',
          citationDoi: '10.5281/zenodo.3960218'
        }
      }]
    }, ACCESS)).versions[0]!

    const researchVersions: CommitReceiptItem[] = []
    const exactBytes = new Map<string, string>()
    let artifactId: string | undefined
    let currentVersionId: string | undefined

    for (let ordinal = 1; ordinal <= steps.length; ordinal += 1) {
      const document = renderCheckpoint(steps, ordinal)
      const input: ArtifactVersionCommitInputV1 = {
        idempotencyKey: `palmer-penguins:research:v${ordinal}`,
        candidates: [{
          candidateId: `research-v${ordinal}`,
          ...(artifactId ? { artifactId } : {}),
          expectedCurrentVersionId: currentVersionId ?? null,
          kind: 'research-checkpoint',
          label: 'Palmer Penguins iterative analysis',
          intent: ordinal === 15 ? 'publish' : 'save',
          content: {
            mode: 'snapshot',
            dataBase64: Buffer.from(document).toString('base64'),
            mediaType: 'application/vnd.sciforge.research-checkpoint+json'
          },
          dependencies: [{
            role: 'source-data',
            target: { kind: 'version', ref: source.ref }
          }],
          metadata: {
            fixture: 'palmer-penguins',
            sourceDigest: SOURCE_DIGEST,
            iterationOrdinal: ordinal,
            changeReason: steps[ordinal - 1]!.changeReason
          }
        }]
      }
      const committed = valueOf(await service.commit(workspace, input, ACCESS)).versions[0]!
      artifactId ??= committed.artifact.artifactId
      assert.equal(committed.artifact.artifactId, artifactId)
      assert.equal(committed.artifact.versionCount, ordinal)
      assert.equal(committed.version.parentVersionId, currentVersionId)
      assert.equal(committed.version.dependencies[0]?.target.versionId, source.ref.versionId)
      assert.equal(committed.version.dependencies[0]?.target.contentDigest, SOURCE_DIGEST)
      assert.equal(committed.ref.contentDigest, sha256(document))
      researchVersions.push(committed)
      exactBytes.set(committed.ref.versionId, document)
      currentVersionId = committed.ref.versionId

      if (ordinal === 5 || ordinal === 10 || ordinal === 15) {
        service = new ArtifactVersionService({ userDataDir })
        const recovered = valueOf(await service.describe(workspace, {
          versionId: currentVersionId
        }, ACCESS))
        assert.equal(recovered.artifact.artifactId, artifactId)
        assert.equal(recovered.artifactOrdinal, ordinal)
        assert.equal(recovered.isCurrent, true)
      }
    }

    const first = researchVersions[0]!
    const seventh = researchVersions[6]!
    const fifteenth = researchVersions[14]!
    const comparison = valueOf(await service.compare(workspace, {
      fromVersionId: first.ref.versionId,
      toVersionId: fifteenth.ref.versionId,
      textPreviewMaxBytes: 256 * 1024
    }, ACCESS))
    assert.equal(comparison.sameContent, false)
    assert.match(comparison.textPreview?.from ?? '', /Freeze source provenance/u)
    assert.match(comparison.textPreview?.to ?? '', /missingness and outlier sensitivity/u)

    const materialized = valueOf(await service.materialize(workspace, {
      idempotencyKey: 'palmer-penguins:materialize:v3',
      versionId: researchVersions[2]!.ref.versionId,
      destinationPath: 'verification/palmer-research-v3.json'
    }, ACCESS))
    assert.equal(
      sha256(await readFile(join(workspace, materialized.destinationPath))),
      researchVersions[2]!.ref.contentDigest
    )

    const restored = valueOf(await service.restoreAsNew(workspace, {
      idempotencyKey: 'palmer-penguins:restore:v7-as-v16',
      artifactId: artifactId!,
      sourceVersionId: seventh.ref.versionId,
      expectedCurrentVersionId: fifteenth.ref.versionId,
      metadata: {
        fixture: 'palmer-penguins',
        changeReason: 'Restore the year-stratified v7 checkpoint to audit a branch from that exact state.'
      }
    }, ACCESS)).versions[0]!
    assert.equal(restored.artifact.artifactId, artifactId)
    assert.equal(restored.artifact.versionCount, 16)
    assert.equal(restored.version.parentVersionId, fifteenth.ref.versionId)
    assert.equal(restored.ref.contentDigest, seventh.ref.contentDigest)
    assert.equal(
      restored.version.dependencies.some((dependency) =>
        dependency.role === 'restored-from' && dependency.target.versionId === seventh.ref.versionId
      ),
      true
    )
    exactBytes.set(restored.ref.versionId, exactBytes.get(seventh.ref.versionId)!)
    researchVersions.push(restored)

    service = new ArtifactVersionService({ userDataDir })
    const postRestoreDocument = renderCheckpoint(steps, 15, {
      branch: {
        restoredFromArtifactOrdinal: 7,
        restoredVersionId: restored.ref.versionId,
        conclusion: 'Re-applied the full sensitivity analysis after exact restoration without changing source bytes.'
      }
    })
    const continued = valueOf(await service.commit(workspace, {
      idempotencyKey: 'palmer-penguins:research:v17-after-restore',
      candidates: [{
        candidateId: 'research-v17',
        artifactId: artifactId!,
        expectedCurrentVersionId: restored.ref.versionId,
        kind: 'research-checkpoint',
        label: 'Palmer Penguins iterative analysis',
        intent: 'publish',
        content: {
          mode: 'snapshot',
          dataBase64: Buffer.from(postRestoreDocument).toString('base64'),
          mediaType: 'application/vnd.sciforge.research-checkpoint+json'
        },
        dependencies: [{
          role: 'source-data',
          target: { kind: 'version', ref: source.ref }
        }],
        metadata: {
          fixture: 'palmer-penguins',
          sourceDigest: SOURCE_DIGEST,
          iterationOrdinal: 17,
          changeReason: 'Continue from restored v7 and re-apply the final sensitivity analysis.'
        }
      }]
    }, ACCESS)).versions[0]!
    assert.equal(continued.artifact.artifactId, artifactId)
    assert.equal(continued.artifact.versionCount, 17)
    assert.equal(continued.version.parentVersionId, restored.ref.versionId)
    exactBytes.set(continued.ref.versionId, postRestoreDocument)
    researchVersions.push(continued)

    const restoredComparison = valueOf(await service.compare(workspace, {
      fromVersionId: seventh.ref.versionId,
      toVersionId: restored.ref.versionId
    }, ACCESS))
    assert.equal(restoredComparison.sameContent, true)

    const pagedHistory: Array<{ ref: ArtifactVersionRefV1; ordinal: number; isCurrent: boolean }> = []
    let beforeSequence: number | undefined
    do {
      const page = valueOf(await service.list(workspace, {
        artifactId: artifactId!,
        limit: 4,
        ...(beforeSequence ? { beforeSequence } : {})
      }, ACCESS))
      pagedHistory.push(...page.items.map((item) => ({
        ref: item.ref,
        ordinal: item.artifactOrdinal,
        isCurrent: item.isCurrent
      })))
      beforeSequence = page.nextBeforeSequence
    } while (beforeSequence)

    assert.equal(pagedHistory.length, 17)
    assert.deepEqual(pagedHistory.map((item) => item.ordinal), [
      17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
    ])
    assert.deepEqual(pagedHistory.map((item) => item.isCurrent), [
      true, false, false, false, false, false, false, false, false,
      false, false, false, false, false, false, false, false
    ])

    for (const version of researchVersions) {
      const read = valueOf(await service.read(workspace, {
        versionId: version.ref.versionId,
        maxBytes: 256 * 1024
      }, ACCESS))
      const text = Buffer.from(read.dataBase64, 'base64').toString('utf8')
      assert.equal(text, exactBytes.get(version.ref.versionId))
      assert.equal(sha256(text), version.ref.contentDigest)
      assert.equal(read.artifact.artifactId, artifactId)
    }

    service = new ArtifactVersionService({ userDataDir })
    const finalCurrent = valueOf(await service.describe(workspace, {
      versionId: continued.ref.versionId
    }, ACCESS))
    assert.equal(finalCurrent.artifact.versionCount, 17)
    assert.equal(finalCurrent.artifactOrdinal, 17)
    assert.equal(finalCurrent.isCurrent, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
