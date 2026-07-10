import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { projectDagUiUrl } from './contract'

type PureUi = {
  independentSources: (paths: unknown[]) => { sources: unknown[]; unresolved: unknown[] }
  locatorTarget: (assertion: unknown) => string | null
  rankPaths: (paths: unknown[], supports: unknown[]) => Array<{ threadId: string }>
  relationModel: (detail: unknown, graph: unknown) => {
    supports: unknown[]; opposing: unknown[]; qualifications: unknown[]
  }
  statusHistoryModel: (detail: unknown, snapshot: unknown, findings: unknown[]) => {
    findings: unknown[]; decisions: unknown[]
  }
  whatIfImpact: (graph: unknown, sourceId: string) => {
    affected: Array<{ claim: { id: string }; kind: string; distance: number }>
  }
  graphModel: (graph: unknown) => {
    nodes: Array<{ id: string; kind: string; label: string }>
    edges: Array<{ src: string; dst: string; type: string }>
    counts: Record<string, number>
  }
  workspaceLocator: (assertion: unknown) => string | null
  workspacePreviewMessage: (
    assertion: unknown,
    claim: unknown,
    snapshotDigest: string,
    requestId: string
  ) => Record<string, unknown> | null
}

function loadPureUi(): { html: string; pure: PureUi } {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
  const source = html.match(/<script id="claim-detail-pure">([\s\S]*?)<\/script>/)?.[1]
  expect(source).toBeTruthy()
  const sandbox: Record<string, unknown> = { URL }
  runInNewContext(source!, sandbox)
  return { html, pure: sandbox as PureUi }
}

describe('Project DAG desktop contract', () => {
  it('builds embedded UI URLs with normalized service URLs and token hashes', () => {
    expect(projectDagUiUrl({
      serviceUrl: 'http://127.0.0.1:3898/',
      apiKey: ' project-token ',
      view: 'graph',
      embed: true,
      workspaceRoot: '/tmp/project alpha',
      projectRoot: '/tmp/project alpha',
      project: 'project-alpha',
      sessionIds: ['codex:thread-1', '']
    })).toBe('http://127.0.0.1:3898/?view=graph&embed=1&workspaceRoot=%2Ftmp%2Fproject+alpha&projectRoot=%2Ftmp%2Fproject+alpha&project=project-alpha&session=codex%3Athread-1#token=project-token')
  })

  it('ships a committed-only Claim detail contract without a mutation bypass', () => {
    const { html } = loadPureUi()
    expect(html).toContain('id="claim-detail"')
    expect(html).toContain('/claims/${encodeURIComponent(claimId)}?snapshot=')
    expect(html).toContain('/attention?snapshotDigest=')
    expect(html).toContain('只读模拟')
    expect(html).not.toContain("method:'POST'")
    expect(html).not.toContain('method: "POST"')
    expect(html).not.toContain('/compile')
  })

  it('ships distinct Evidence and Graph surfaces selected by the requested view', () => {
    const { html } = loadPureUi()
    expect(html).toContain('id="evidence-surface"')
    expect(html).toContain('id="evidence-vector"')
    expect(html).toContain('id="graph-surface"')
    expect(html).toContain('id="graph-scroll"')
    expect(html).toContain("query.get('view')==='graph'?'graph':'home'")
    expect(html).toContain('role="img" aria-label="Committed Project DAG')
  })

  it('builds visible nodes and directed edges from the committed Project snapshot', () => {
    const { pure } = loadPureUi()
    const model = pure.graphModel({
      snapshot: { evidenceVector: [{ threadId: 'session-a', digest: 'sha256:a' }] },
      goals: [{ root_id: 'goal-a', title: 'Discover target' }],
      evidence: [{ id: 'evidence-a', content: 'Observed activity', evidence_type: 'source' }],
      claims: [{ id: 'claim-a', statement: 'Target is active', status: 'supported', goal_id: 'goal-a' }],
      entities: [],
      origins: [{ session_id: 'session-a', claim_id: 'claim-a' }],
      edges: [{ id: 'supports-a', src: 'evidence-a', dst: 'claim-a', edge_type: 'supports' }]
    })

    expect(model.nodes.map(node => [node.id, node.kind])).toEqual([
      ['session:session-a', 'session'],
      ['evidence-a', 'evidence'],
      ['claim-a', 'claim'],
      ['goal-a', 'goal']
    ])
    expect(model.edges.map(edge => [edge.src, edge.dst, edge.type])).toEqual([
      ['evidence-a', 'claim-a', 'supports'],
      ['session:session-a', 'claim-a', 'origin'],
      ['claim-a', 'goal-a', 'addresses']
    ])
  })

  it('emits a bounded workspace-preview request with an Anchor only for local artifacts', () => {
    const { html, pure } = loadPureUi()
    const local = {
      artifactId: 'artifact-a', artifactVersionId: 'version-a', sourceAnchorId: 'anchor-a',
      artifact: {}, artifactVersion: { locator: 'papers/source.pdf' },
      sourceAnchor: { selector: { type: 'pdf', page: 3, quote: 'Supporting text' } }
    }
    expect(pure.workspaceLocator(local)).toBe('papers/source.pdf')
    expect(pure.workspacePreviewMessage(
      local,
      { id: 'claim-a', statement: 'A supported Claim' },
      'project:current',
      'preview-1'
    )).toEqual({
      type: 'sciforge.project-dag.preview-workspace-evidence',
      version: 1,
      requestId: 'preview-1',
      locator: 'papers/source.pdf',
      artifactId: 'artifact-a',
      artifactVersionId: 'version-a',
      sourceAnchorId: 'anchor-a',
      anchor: { kind: 'document', id: 'anchor-a', page: 3, quote: 'Supporting text' },
      claim: { id: 'claim-a', statement: 'A supported Claim', snapshotDigest: 'project:current' }
    })
    expect(pure.workspaceLocator({
      artifact: {}, artifactVersion: { locator: 'runtime:thread:item' }
    })).toBeNull()
    expect(pure.workspaceLocator({
      artifact: { availability: 'restricted' }, artifactVersion: { locator: 'private/data.csv' }
    })).toBeNull()
    expect(html).toContain('data-preview-artifact=')
    expect(html).toContain('查看原始证据')
    expect(html).toContain("window.parent.postMessage(message,'*')")
  })

  it('ranks strongest paths by explicit dimensions and deduplicates upstream identity', () => {
    const { pure } = loadPureUi()
    const paths = [
      {
        threadId: 'session-low', sessionClaimId: 'claim-low', level: 'L2',
        sourceAssertions: [{ sourceAssertionId: 'sa-low', artifactId: 'paper-a', level: 'L2',
          artifact: {}, artifactVersion: { locator: 'https://example.test/a' },
          sourceAnchor: { selector: { type: 'page', page: 1 } } }]
      },
      {
        threadId: 'session-high', sessionClaimId: 'claim-high', level: 'L3',
        sourceAssertions: [{ sourceAssertionId: 'sa-high', artifactId: 'paper-b', level: 'L3',
          artifact: {}, artifactVersion: { locator: 'https://example.test/a', contentDigest: 'sha256:a' },
          sourceAnchor: { selector: { type: 'page', page: 2 }, anchorDigest: 'sha256:b' } }]
      },
      { threadId: 'session-unresolved', sessionClaimId: 'claim-unknown', level: 'L0',
        sourceAssertions: [{ sourceAssertionId: 'sa-unknown', artifactId: 'runtime-artifact',
          level: 'L0', artifactVersion: { locator: 'runtime:thread:item' } }] }
    ]
    const ranked = pure.rankPaths(paths, [])
    expect(ranked.map(path => path.threadId)).toEqual([
      'session-high', 'session-low', 'session-unresolved'
    ])
    const independent = pure.independentSources(paths)
    expect(independent.sources).toHaveLength(1)
    expect(independent.unresolved).toHaveLength(1)
  })

  it('models support, opposition, qualification, related Decisions, and read-only what-if', () => {
    const { pure } = loadPureUi()
    const graph = {
      claims: [
        { id: 'claim-a', statement: 'A' },
        { id: 'claim-b', statement: 'B' },
        { id: 'claim-c', statement: 'C' }
      ],
      edges: [
        { id: 'support-a', src: 'source-a', dst: 'claim-a', edge_type: 'supports' },
        { id: 'support-b', src: 'source-b', dst: 'claim-a', edge_type: 'supports' },
        { id: 'conflict', src: 'claim-a', dst: 'claim-b', edge_type: 'contradicts' },
        { id: 'refinement', src: 'claim-c', dst: 'claim-a', edge_type: 'derived_from' }
      ]
    }
    const detail = {
      id: 'claim-a', supports: [{ id: 'source-a', edge_meta: {} }],
      contradicts: [graph.edges[2]],
      assessments: [{ dimension: 'applicability', result: 'uncertain', level: 'A2' }]
    }
    const relations = pure.relationModel(detail, graph)
    expect(relations.supports).toHaveLength(1)
    expect(relations.opposing).toHaveLength(1)
    expect(relations.qualifications).toHaveLength(2)

    const impact = pure.whatIfImpact(graph, 'source-a')
    expect(impact.affected.map(item => [item.claim.id, item.kind, item.distance])).toEqual([
      ['claim-a', 'weakened', 0],
      ['claim-c', 'downstream', 1]
    ])

    const snapshot = {
      digest: 'project:current', graph: { decisions: [
        { id: 'decision-related', finding_id: 'finding-a' },
        { id: 'decision-previous-snapshot', finding_id: 'finding-old' },
        { id: 'decision-unrelated', finding_id: 'finding-b' }
      ] }, compileDiff: {}
    }
    const history = pure.statusHistoryModel({ id: 'claim-a', assessments: [] }, snapshot, [
      { id: 'finding-a', subject_id: 'claim-a', target_digest: 'project:current' },
      { id: 'finding-b', subject_id: 'claim-b', target_digest: 'project:current' },
      { id: 'finding-old', subject_id: 'claim-a', target_digest: 'project:old' }
    ])
    expect(history.findings).toHaveLength(2)
    expect(history.decisions).toHaveLength(2)
  })

  it('only creates open targets for public URL/DOI locators', () => {
    const { pure } = loadPureUi()
    expect(pure.locatorTarget({ artifact: {}, artifactVersion: { locator: 'doi:10.1/test' } }))
      .toBe('https://doi.org/10.1%2Ftest')
    expect(pure.locatorTarget({ artifact: {}, artifactVersion: { locator: 'data/results.csv' } }))
      .toBeNull()
    expect(pure.locatorTarget({ artifact: { availability: 'restricted' },
      artifactVersion: { locator: 'https://secret.test/data' } })).toBeNull()
  })
})
