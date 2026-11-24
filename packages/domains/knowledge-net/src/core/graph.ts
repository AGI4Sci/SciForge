import type { KnowledgeRecord } from '../contract.js'
import type { SealedResource } from '../resource-contract.js'

/**
 * A deterministic projection of the sealed records into a concept graph:
 * paper nodes joined to the concept nodes they explain or still target.
 * Everything comes from sealed records, so the graph is reproducible and never
 * invents a link that a record does not state.
 */

export type GraphRelation = 'explains' | 'targets' | 'uses' | 'produces' | 'mentions' | 'part_of'

export type GraphNode = Readonly<{
  id: string
  kind: 'paper' | 'concept' | 'resource'
  label: string
  /** Present on paper nodes only. */
  title?: string
  referenceOnly?: boolean
  resourceSnapshot?: SealedResource
}>

export type GraphEdge = Readonly<{ from: string; to: string; relation: GraphRelation }>

export type KnowledgeGraph = Readonly<{ nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }>

export const paperNodeId = (paperId: string): string => `paper:${paperId}`
export const conceptNodeId = (term: string): string => `concept:${term}`

function addEdge(edges: GraphEdge[], seen: Set<string>, from: string, to: string, relation: GraphRelation): void {
  const key = `${from}\u0000${to}\u0000${relation}`
  if (seen.has(key)) return
  seen.add(key)
  edges.push({ from, to, relation })
}

export function buildKnowledgeGraph(records: readonly KnowledgeRecord[], resources: readonly SealedResource[] = []): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const seen = new Set<string>()

  const concept = (term: string): string => {
    const id = conceptNodeId(term)
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'concept', label: term })
    return id
  }

  for (const record of records) {
    const paper = paperNodeId(record.paperId)
    if (!nodes.has(paper)) {
      nodes.set(paper, {
        id: paper, kind: 'paper', label: record.title ?? record.paperId,
        ...(record.title ? { title: record.title } : {})
      })
    }
    for (const excavated of record.concepts) {
      addEdge(edges, seen, paper, concept(excavated.term), 'explains')
      if (excavated.subConcept) {
        addEdge(edges, seen, paper, concept(excavated.subConcept.term), 'explains')
      }
    }
    for (const target of record.conceptTargets) {
      addEdge(edges, seen, paper, concept(target.term), 'targets')
    }
  }

  for (const item of resources) {
    const id = `resource:${item.resourceId}`
    nodes.set(id, { id, kind: 'resource', label: item.resource.name, resourceSnapshot: item })
  }
  for (const item of resources) {
    const id = `resource:${item.resourceId}`
    for (const link of item.resource.paperLinks) {
      const paper = paperNodeId(link.paperId)
      if (!nodes.has(paper)) nodes.set(paper, { id: paper, kind: 'paper', label: link.paperId, referenceOnly: true })
      addEdge(edges, seen, paper, id, { used: 'uses', produced: 'produces', mentioned: 'mentions' }[link.relation] as GraphRelation)
    }
    if (item.resource.parentResourceId) {
      const parent = `resource:${item.resource.parentResourceId}`
      if (!nodes.has(parent)) nodes.set(parent, { id: parent, kind: 'resource', label: item.resource.parentResourceId, referenceOnly: true })
      addEdge(edges, seen, id, parent, 'part_of')
    }
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges].sort((left, right) =>
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.relation.localeCompare(right.relation))
  }
}

export type GraphCounts = Readonly<{ papers: number; concepts: number; resources: number; explains: number; targets: number; uses: number; produces: number; mentions: number; part_of: number }>

export function countGraph(graph: KnowledgeGraph): GraphCounts {
  return {
    papers: graph.nodes.filter((node) => node.kind === 'paper').length,
    concepts: graph.nodes.filter((node) => node.kind === 'concept').length,
    resources: graph.nodes.filter((node) => node.kind === 'resource').length,
    explains: graph.edges.filter((edge) => edge.relation === 'explains').length,
    targets: graph.edges.filter((edge) => edge.relation === 'targets').length,
    uses: graph.edges.filter((edge) => edge.relation === 'uses').length,
    produces: graph.edges.filter((edge) => edge.relation === 'produces').length,
    mentions: graph.edges.filter((edge) => edge.relation === 'mentions').length,
    part_of: graph.edges.filter((edge) => edge.relation === 'part_of').length
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function graphToGraphML(graph: KnowledgeGraph): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="title" for="node" attr.name="title" attr.type="string"/>',
    '  <key id="relation" for="edge" attr.name="relation" attr.type="string"/>',
    '  <key id="referenceOnly" for="node" attr.name="referenceOnly" attr.type="boolean"/>',
    '  <key id="resourceSnapshot" for="node" attr.name="resourceSnapshot" attr.type="string"/>',
    '  <graph id="knowledge-net" edgedefault="directed">'
  ]
  for (const node of graph.nodes) {
    lines.push(`    <node id="${escapeXml(node.id)}">`)
    lines.push(`      <data key="kind">${node.kind}</data>`)
    lines.push(`      <data key="label">${escapeXml(node.label)}</data>`)
    if (node.title !== undefined) lines.push(`      <data key="title">${escapeXml(node.title)}</data>`)
    if (node.referenceOnly) lines.push('      <data key="referenceOnly">true</data>')
    if (node.resourceSnapshot) lines.push(`      <data key="resourceSnapshot">${escapeXml(JSON.stringify(node.resourceSnapshot))}</data>`)
    lines.push('    </node>')
  }
  for (const edge of graph.edges) {
    lines.push(`    <edge source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}">`)
    lines.push(`      <data key="relation">${edge.relation}</data>`)
    lines.push('    </edge>')
  }
  lines.push('  </graph>', '</graphml>')
  return `${lines.join('\n')}\n`
}

export function graphToJsonLd(graph: KnowledgeGraph): string {
  const relations = new Map<string, Partial<Record<GraphRelation, string[]>>>()
  for (const edge of graph.edges) {
    let bucket = relations.get(edge.from)
    if (!bucket) { bucket = {}; relations.set(edge.from, bucket) }
    ;(bucket[edge.relation] ??= []).push(edge.to)
  }

  const graphArray: unknown[] = []
  for (const node of graph.nodes) {
    graphArray.push({ '@type': { paper: 'ScholarlyArticle', concept: 'DefinedTerm', resource: 'Dataset' }[node.kind],
      '@id': node.id, name: node.label, ...(node.referenceOnly ? { referenceOnly: true } : {}),
      ...(node.resourceSnapshot ? { resourceSnapshot: node.resourceSnapshot } : {}),
      ...Object.fromEntries(Object.entries(relations.get(node.id) ?? {}).map(([relation, targets]) => [relation, targets.slice().sort()])) })
  }

  const document = {
    '@context': {
      '@vocab': 'http://schema.org/',
      explains: { '@id': 'https://sciforge.org/knowledge-net#explains', '@type': '@id' },
      ...Object.fromEntries(['targets', 'uses', 'produces', 'mentions', 'part_of'].map((relation) =>
        [relation, { '@id': `https://sciforge.org/knowledge-net#${relation}`, '@type': '@id' }]))
    },
    '@graph': graphArray
  }
  return `${JSON.stringify(document, null, 2)}\n`
}
