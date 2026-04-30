import type { UIModuleManifest } from './domain';

export type PresentationDedupeScope = 'entity' | 'document' | 'collection' | 'none';

export type RuntimeUIModule = UIModuleManifest & {
  description: string;
  outputArtifactTypes?: string[];
  presentation?: {
    dedupeScope?: PresentationDedupeScope;
    identityFields?: string[];
  };
};

export const uiModuleRegistry: RuntimeUIModule[] = [
  {
    moduleId: 'research-report-document',
    version: '1.0.0',
    title: 'Markdown report document',
    description: 'Readable Markdown/sectioned report renderer for research-report artifacts.',
    componentId: 'report-viewer',
    lifecycle: 'published',
    outputArtifactTypes: ['research-report'],
    acceptsArtifactTypes: ['research-report', 'markdown-report'],
    requiredAnyFields: [['markdown', 'sections', 'report', 'summary', 'content', 'dataRef']],
    viewParams: ['layoutMode', 'sectionFilter'],
    interactionEvents: ['select-section', 'open-ref'],
    roleDefaults: ['experimental-biologist', 'pi', 'bioinformatician'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'primary',
    priority: 10,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
    presentation: {
      dedupeScope: 'document',
      identityFields: ['reportId', 'report_id', 'documentId', 'document_id', 'title', 'dataRef', 'path', 'outputRef', 'resultRef'],
    },
  },
  {
    moduleId: 'protein-structure-viewer',
    version: '1.0.0',
    title: 'Protein structure viewer',
    description: 'PDB/mmCIF/dataRef/HTML structure visualization bound to structure artifacts.',
    componentId: 'molecule-viewer',
    lifecycle: 'published',
    outputArtifactTypes: ['structure-summary'],
    acceptsArtifactTypes: ['structure-summary', 'structure-3d-html', 'pdb-file', 'structure-list', 'pdb-structure', 'protein-structure', 'mmcif-file', 'cif-file'],
    requiredAnyFields: [['pdbId', 'pdb_id', 'pdb', 'uniprotId', 'dataRef', 'structureUrl', 'html', 'htmlRef', 'structureHtml', 'path', 'filePath']],
    viewParams: ['colorBy', 'highlightSelection', 'highlightResidues', 'syncViewport'],
    interactionEvents: ['highlight-residue', 'select-chain'],
    roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'primary',
    priority: 8,
    safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
    presentation: {
      dedupeScope: 'entity',
      identityFields: ['pdbId', 'pdb_id', 'pdb', 'uniprotId', 'uniprot_id', 'accession', 'entityId', 'entity_id', 'targetId', 'target_id'],
    },
  },
  {
    moduleId: 'literature-paper-cards',
    version: '1.0.0',
    title: 'Evidence paper cards',
    description: 'Paper list renderer for literature evidence artifacts.',
    componentId: 'paper-card-list',
    lifecycle: 'published',
    outputArtifactTypes: ['paper-list'],
    acceptsArtifactTypes: ['paper-list'],
    requiredAnyFields: [['papers', 'rows']],
    viewParams: ['filter', 'sort', 'limit', 'colorBy'],
    interactionEvents: ['select-paper', 'select-target'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
    defaultSection: 'supporting',
    priority: 20,
    safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
    presentation: {
      dedupeScope: 'collection',
      identityFields: ['paperListId', 'paper_list_id', 'queryId', 'query_id', 'searchQuery', 'query', 'dataRef', 'outputRef', 'resultRef'],
    },
  },
  {
    moduleId: 'knowledge-network-graph',
    version: '1.0.0',
    title: 'Knowledge network graph',
    description: 'Network renderer for knowledge-graph nodes and edges.',
    componentId: 'network-graph',
    lifecycle: 'published',
    outputArtifactTypes: ['knowledge-graph'],
    acceptsArtifactTypes: ['knowledge-graph'],
    requiredFields: ['nodes', 'edges'],
    viewParams: ['colorBy', 'filter', 'highlightSelection'],
    interactionEvents: ['select-node', 'select-edge'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
    defaultSection: 'primary',
    priority: 25,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'omics-volcano-plot',
    version: '1.0.0',
    title: 'Volcano plot',
    description: 'Differential-expression volcano plot renderer.',
    componentId: 'volcano-plot',
    lifecycle: 'published',
    outputArtifactTypes: ['omics-differential-expression'],
    acceptsArtifactTypes: ['omics-differential-expression'],
    requiredFields: ['points'],
    viewParams: ['colorBy', 'filter', 'x', 'y', 'label'],
    interactionEvents: ['select-gene'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallbackModuleIds: ['generic-data-table'],
    defaultSection: 'primary',
    priority: 26,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'omics-heatmap-viewer',
    version: '1.0.0',
    title: 'Heatmap viewer',
    description: 'Matrix heatmap renderer for omics artifacts.',
    componentId: 'heatmap-viewer',
    lifecycle: 'published',
    outputArtifactTypes: ['omics-differential-expression'],
    acceptsArtifactTypes: ['omics-differential-expression'],
    requiredFields: ['heatmap'],
    viewParams: ['colorBy', 'splitBy', 'facetBy'],
    interactionEvents: ['select-gene-set'],
    roleDefaults: ['bioinformatician'],
    fallbackModuleIds: ['generic-data-table'],
    defaultSection: 'supporting',
    priority: 27,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'omics-umap-viewer',
    version: '1.0.0',
    title: 'UMAP viewer',
    description: 'Embedding coordinate renderer for single-cell or omics artifacts.',
    componentId: 'umap-viewer',
    lifecycle: 'published',
    outputArtifactTypes: ['omics-differential-expression'],
    acceptsArtifactTypes: ['omics-differential-expression'],
    requiredFields: ['umap'],
    viewParams: ['colorBy', 'splitBy', 'highlightSelection'],
    interactionEvents: ['select-cluster'],
    roleDefaults: ['bioinformatician', 'experimental-biologist'],
    fallbackModuleIds: ['generic-data-table'],
    defaultSection: 'primary',
    priority: 28,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'evidence-matrix-panel',
    version: '1.0.0',
    title: 'Evidence matrix panel',
    description: 'Claim/evidence matrix bound to session claims and supporting artifacts.',
    componentId: 'evidence-matrix',
    lifecycle: 'published',
    outputArtifactTypes: ['evidence-matrix'],
    acceptsArtifactTypes: ['evidence-matrix', 'paper-list', 'structure-summary', 'knowledge-graph', 'omics-differential-expression', 'research-report'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['select-claim'],
    roleDefaults: ['experimental-biologist', 'pi', 'clinical'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'supporting',
    priority: 30,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
    presentation: {
      dedupeScope: 'collection',
      identityFields: ['matrixId', 'matrix_id', 'evidenceSetId', 'evidence_set_id', 'claimSetId', 'claim_set_id', 'dataRef', 'outputRef', 'resultRef'],
    },
  },
  {
    moduleId: 'execution-provenance-table',
    version: '1.0.0',
    title: 'Execution provenance',
    description: 'Reproducible execution refs, code/log/output refs, and statuses.',
    componentId: 'execution-unit-table',
    lifecycle: 'published',
    acceptsArtifactTypes: ['*'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['open-code-ref', 'open-log-ref'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'provenance',
    priority: 80,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'notebook-research-timeline',
    version: '1.0.0',
    title: 'Research notebook timeline',
    description: 'Structured research notebook and decision timeline.',
    componentId: 'notebook-timeline',
    lifecycle: 'published',
    outputArtifactTypes: ['notebook-timeline'],
    acceptsArtifactTypes: ['*'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['select-timeline-event'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'provenance',
    priority: 85,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
  },
  {
    moduleId: 'generic-data-table',
    version: '1.0.0',
    title: 'Generic artifact table',
    description: 'Safe table renderer for array-like artifact payloads.',
    componentId: 'data-table',
    lifecycle: 'published',
    outputArtifactTypes: ['data-table'],
    acceptsArtifactTypes: ['paper-list', 'structure-summary', 'knowledge-graph', 'omics-differential-expression', 'sequence-alignment', 'inspection-summary', 'research-report', 'runtime-artifact'],
    viewParams: ['filter', 'sort', 'limit', 'group'],
    interactionEvents: ['select-row'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallbackModuleIds: ['generic-artifact-inspector'],
    defaultSection: 'raw',
    priority: 90,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
    presentation: {
      dedupeScope: 'collection',
      identityFields: ['datasetId', 'dataset_id', 'tableId', 'table_id', 'dataRef', 'outputRef', 'resultRef'],
    },
  },
  {
    moduleId: 'generic-artifact-inspector',
    version: '1.0.0',
    title: 'Artifact inspector',
    description: 'Safe fallback for any artifact, ref, file, log, or JSON payload.',
    componentId: 'unknown-artifact-inspector',
    lifecycle: 'published',
    acceptsArtifactTypes: ['*'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['open-ref'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallbackModuleIds: [],
    defaultSection: 'raw',
    priority: 100,
    safety: { sandbox: false, externalResources: 'none', executesCode: false },
    presentation: { dedupeScope: 'none' },
  },
];

export const componentArtifactTypes: Record<string, string[]> = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
  const current = acc[module.componentId] ?? [];
  acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
  return acc;
}, {});

componentArtifactTypes['molecule-viewer-3d'] = componentArtifactTypes['molecule-viewer'] ?? [];

export function artifactTypesForComponents(componentIds: string[]) {
  const componentOutputTypes = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
    const current = acc[module.componentId] ?? [];
    acc[module.componentId] = Array.from(new Set([...current, ...(module.outputArtifactTypes ?? [])]));
    return acc;
  }, {});
  return Array.from(new Set(componentIds.flatMap((componentId) => componentOutputTypes[componentId] ?? [])))
    .filter((type) => type && type !== '*');
}

export function acceptedArtifactTypesForComponent(componentId: string) {
  return componentArtifactTypes[componentId] ?? [];
}
