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
    nodes: Array<{ id: string; kind: string; label: string; review: { level: string } }>
    edges: Array<{ id: string; src: string; dst: string; type: string }>
    counts: Record<string, number>
  }
  evidenceReviewModel: (
    evidence: unknown,
    graph: unknown,
    claimDetails: unknown[]
  ) => {
    pointer: { threadId: string; snapshotDigest: string; sourceAssertionId: string } | null
    relatedClaimIds: string[]
    resolved: null | {
      claimId: string
      assertion: { artifactVersionId: string; sourceAnchorId: string }
    }
  }
  graphFocus: (
    model: unknown,
    nodeId: string,
    mode?: 'direct' | 'strongest' | 'all'
  ) => { mode: string; nodeIds: string[]; edgeIds: string[] }
  graphEdgeRelationKind: (type: string) => string
  normalizeHumanReview: (value: unknown) => {
    level: string; score: number; status: string; blocking: boolean
    reasons: Array<{ code: string; message: string }>
  }
  projectReviewQueueModel: (graph: unknown) => Array<{
    node: { id: string }
    review: { level: string; blocking: boolean; reviewPacketId: string | null }
  }>
  opaqueGraphNodeId: (value: unknown) => string | null
  workspaceLocator: (assertion: unknown) => string | null
  workspacePreviewMessage: (
    assertion: unknown,
    claim: unknown,
    snapshotDigest: string,
    requestId: string,
    graphNodeId?: string
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
    expect(html).toContain("method:'POST'")
    expect(html).toContain('/reviews/${encodeURIComponent(packetId)}/decision')
    expect(html).not.toContain('/compile')
  })

  it('normalizes and prioritizes human review packets without duplicating packet targets', () => {
    const { pure } = loadPureUi()
    expect(pure.normalizeHumanReview({
      level: 'required', score: 92, status: 'open', blocking: true,
      reasons: [{ code: 'conflicting_evidence', message: 'Independent sources disagree' }]
    })).toMatchObject({
      level: 'required', score: 0.92, status: 'pending', blocking: true,
      reasons: [{ code: 'conflicting_evidence', message: 'Independent sources disagree' }]
    })

    const queue = pure.projectReviewQueueModel({
      snapshot: { evidenceVector: [] },
      goals: [], entities: [], origins: [], edges: [], evidence: [],
      claims: [
        { id: 'claim-a', statement: 'A', humanReview: { level: 'required', score: 0.9, status: 'pending', blocking: true, reviewPacketId: 'packet-1' } },
        { id: 'claim-b', statement: 'B', humanReview: { level: 'recommended', score: 0.7, status: 'pending', reviewPacketId: 'packet-1' } },
        { id: 'claim-c', statement: 'C', humanReview: { level: 'optional', score: 0.4, status: 'approved', reviewPacketId: 'packet-2' } }
      ]
    })
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ node: { id: 'claim-a' }, review: { level: 'required', blocking: true, reviewPacketId: 'packet-1' } })
  })

  it('maps upstream Evidence review packets onto the visible Session node', () => {
    const { pure } = loadPureUi()
    const model = pure.graphModel({
      snapshot: { evidenceVector: [{ threadId: 'runtime:session-a', digest: 'sha256:a' }] },
      goals: [], entities: [], origins: [], edges: [], evidence: [], claims: [],
      reviewPackets: [{
        id: 'packet-upstream', subjectIds: ['runtime:session-a'], level: 'required',
        score: 0.95, status: 'pending', blocking: true,
        reasons: [{ code: 'upstream_review_required', message: 'Evidence needs review' }]
      }]
    })
    expect(model.nodes[0]).toMatchObject({
      id: 'session:runtime:session-a', kind: 'session', review: { level: 'required' }
    })
  })

  it('ships a unified review surface with the graph canvas always available', () => {
    const { html } = loadPureUi()
    expect(html).toContain('id="evidence-surface"')
    expect(html).toContain('id="evidence-vector"')
    expect(html).toContain('id="graph-surface"')
    expect(html).toContain('id="graph-scroll"')
    expect(html).toContain("query.get('view')==='graph'?'graph':'home'")
    expect(html).toContain("document.getElementById('evidence-surface').hidden=false")
    expect(html).toContain("document.getElementById('graph-surface').hidden=false")
    expect(html).toContain('class="graph-workbench inspector-closed"')
    expect(html).toContain('id="toggle-inspector"')
    expect(html).toContain('id="inspector-close"')
    expect(html).toContain("state.inspectorOpen=true")
    expect(html).toContain("toggle.textContent=state.inspectorOpen?'专注图谱':'显示详情'")
    expect(html).toContain('class="overview-fold"')
    expect(html).toContain('aria-label="Project DAG 审查 Inspector"')
    expect(html).toContain('>概要</a>')
    expect(html).toContain('>证据</a>')
    expect(html).toContain('>原文</a>')
    expect(html).toContain('>历史</a>')
    expect(html.indexOf('id="graph-surface"')).toBeLessThan(html.indexOf('id="evidence-surface"'))
    expect(html).toContain('data-graph-focus-mode="direct"')
    expect(html).toContain('data-graph-focus-mode="strongest"')
    expect(html).toContain('data-graph-focus-mode="all"')
    expect(html).toContain('data-edge-type="${edgeType}"')
    expect(html).toContain('relation-${graphEdgeRelationKind(edge.type)}')
    expect(html).toContain('legend-line-contradicts')
    expect(html).toContain('legend-line-qualifies')
    expect(html).toContain('role="img" aria-label="Committed Project DAG')
  })

  it('restores a Claim selected before entering the workspace preview', () => {
    const { html } = loadPureUi()
    expect(html).toContain("requestedClaimId=String(query.get('claim')||'')")
    expect(html).toContain('requestedClaimConsumed:false')
    expect(html).toContain('!state.requestedClaimConsumed&&requestedClaimId')
    expect(html).toContain('state.requestedClaimConsumed=true;state.selectedClaimId=requestedClaimId')
  })

  it('restores an arbitrary validated graph node before the legacy Claim fallback', () => {
    const { html, pure } = loadPureUi()
    expect(pure.opaqueGraphNodeId('evidence:source-1')).toBe('evidence:source-1')
    expect(pure.opaqueGraphNodeId('evidence source')).toBeNull()
    expect(pure.opaqueGraphNodeId(`evidence:${'a'.repeat(512)}`)).toBeNull()
    expect(html).toContain("requestedGraphNodeId=opaqueGraphNodeId(query.get('node'))")
    expect(html).toContain('requestedGraphNodeConsumed:false')
    expect(html).toContain("state.selectedClaimId=requestedNode.kind==='claim'?requestedNode.id:null")
  })

  it('clears stale Claim state when inspecting a non-Claim graph node', () => {
    const { html } = loadPureUi()
    expect(html).toContain("else{state.selectedClaimId=null;state.detail=null}renderClaims()")
    expect(html).toContain('if(changed){state.previewFeedback=null;state.whatIfSourceId=null}')
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

  it('computes direct, strongest, and all-related graph focus paths', () => {
    const { pure } = loadPureUi()
    const model = pure.graphModel({
      snapshot: { evidenceVector: [] },
      evidence: [
        { id: 'source-weak', content: 'Weak source' },
        { id: 'source-strong', content: 'Strong source' }
      ],
      claims: [
        { id: 'claim-selected', statement: 'Selected Claim' },
        { id: 'claim-opposed', statement: 'Opposed Claim' }
      ],
      goals: [{ id: 'goal-main', title: 'Main goal' }],
      edges: [
        { id: 'weak', src: 'source-weak', dst: 'claim-selected', edge_type: 'supports', quality_score: 0.35 },
        { id: 'strong', src: 'source-strong', dst: 'claim-selected', edge_type: 'supports', quality_score: 0.95 },
        { id: 'goal', src: 'claim-selected', dst: 'goal-main', edge_type: 'addresses' },
        { id: 'opposes', src: 'claim-selected', dst: 'claim-opposed', edge_type: 'contradicts' }
      ]
    })

    expect(pure.graphFocus(model, 'claim-selected', 'direct')).toEqual({
      mode: 'direct',
      nodeIds: ['claim-selected', 'source-weak', 'source-strong', 'goal-main', 'claim-opposed'],
      edgeIds: ['weak', 'strong', 'goal', 'opposes']
    })
    expect(pure.graphFocus(model, 'claim-selected')).toEqual({
      mode: 'strongest',
      nodeIds: ['claim-selected', 'source-strong', 'goal-main'],
      edgeIds: ['strong', 'goal']
    })
    expect(pure.graphFocus(model, 'claim-selected', 'all')).toEqual({
      mode: 'all',
      nodeIds: ['claim-selected', 'source-weak', 'source-strong', 'goal-main', 'claim-opposed'],
      edgeIds: ['weak', 'strong', 'goal', 'opposes']
    })
    expect([
      pure.graphEdgeRelationKind('supports'),
      pure.graphEdgeRelationKind('contradicts'),
      pure.graphEdgeRelationKind('qualifies'),
      pure.graphEdgeRelationKind('derived_from')
    ]).toEqual(['support', 'contradicts', 'qualifies', 'provenance'])
  })

  it('joins Project Evidence to its committed SourceAssertion, version, and anchor', () => {
    const { pure } = loadPureUi()
    const assertion = {
      sourceAssertionId: 'source-a',
      artifactVersionId: 'version-a',
      sourceAnchorId: 'anchor-a'
    }
    const review = pure.evidenceReviewModel({
      id: 'evidence-a',
      thread_id: 'session-a',
      snapshot_digest: 'sha256:snapshot-a',
      node_id: 'source-a'
    }, {
      claims: [{ id: 'claim-a', statement: 'Supported Claim' }],
      edges: [{ src: 'evidence-a', dst: 'claim-a', edge_type: 'supports' }]
    }, [{
      id: 'claim-a',
      provenance: {
        paths: [{
          threadId: 'session-a',
          evidenceSnapshot: { digest: 'sha256:snapshot-a' },
          sourceAssertions: [assertion]
        }]
      }
    }])

    expect(review.pointer).toEqual({
      threadId: 'session-a',
      snapshotDigest: 'sha256:snapshot-a',
      sourceAssertionId: 'source-a'
    })
    expect(review.relatedClaimIds).toEqual(['claim-a'])
    expect(review.resolved).toMatchObject({
      claimId: 'claim-a',
      assertion: { artifactVersionId: 'version-a', sourceAnchorId: 'anchor-a' }
    })
  })

  it('emits only opaque provenance identifiers for trusted workspace resolution', () => {
    const { html, pure } = loadPureUi()
    const local = {
      artifactId: 'artifact-a', artifactVersionId: 'version-a', sourceAnchorId: 'anchor-a',
      artifact: {}, artifactVersion: {
        locator: 'papers/source.pdf',
        contentDigest: `sha256:${'a'.repeat(64)}`
      },
      sourceAnchor: { selector: { type: 'pdf', page: 3, quote: 'Supporting text' } }
    }
    expect(pure.workspaceLocator(local)).toBe('papers/source.pdf')
    const message = pure.workspacePreviewMessage(
      local,
      { id: 'claim-a', statement: 'A supported Claim' },
      'project:current',
      'preview-1',
      'evidence:source-1'
    )
    expect(message).toEqual({
      type: 'sciforge.project-dag.preview-workspace-evidence',
      version: 1,
      requestId: 'preview-1',
      artifactVersionId: 'version-a',
      sourceAnchorId: 'anchor-a',
      graphNodeId: 'evidence:source-1',
      claim: { id: 'claim-a', snapshotDigest: 'project:current' }
    })
    expect(message).not.toHaveProperty('locator')
    expect(message).not.toHaveProperty('anchor')
    expect(message).not.toHaveProperty('contentDigest')
    expect(pure.workspacePreviewMessage(
      local,
      { id: 'claim-a' },
      'project:current',
      'preview-invalid',
      '../evidence source'
    )).toBeNull()
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
