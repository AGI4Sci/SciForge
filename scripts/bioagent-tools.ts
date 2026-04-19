import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

type Profile = 'literature' | 'structure' | 'omics' | 'knowledge';

interface ToolRequest {
  profile: Profile;
  prompt: string;
  workspacePath?: string;
  artifacts?: Array<Record<string, unknown>>;
}

interface ToolPayload {
  message: string;
  confidence: number;
  claimType: string;
  evidenceLevel: string;
  reasoningTrace: string;
  claims: Array<Record<string, unknown>>;
  uiManifest: Array<Record<string, unknown>>;
  executionUnits: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
}

const PROFILE_SET = new Set<Profile>(['literature', 'structure', 'omics', 'knowledge']);

export async function runBioAgentTool(body: Record<string, unknown>): Promise<ToolPayload> {
  const profile = String(body.profile || '') as Profile;
  if (!PROFILE_SET.has(profile)) throw new Error(`Unsupported BioAgent profile: ${String(body.profile || '')}`);
  const request: ToolRequest = {
    profile,
    prompt: String(body.prompt || ''),
    workspacePath: typeof body.workspacePath === 'string' ? body.workspacePath : undefined,
    artifacts: Array.isArray(body.artifacts) ? body.artifacts.filter(isRecord) : [],
  };
  if (profile === 'literature') return runLiterature(request);
  if (profile === 'structure') return runStructure(request);
  if (profile === 'omics') return runOmics(request);
  return runKnowledge(request);
}

async function runLiterature(request: ToolRequest): Promise<ToolPayload> {
  const query = literatureQuery(request);
  const retmax = 5;
  const esearch = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
  esearch.searchParams.set('db', 'pubmed');
  esearch.searchParams.set('term', query);
  esearch.searchParams.set('retmode', 'json');
  esearch.searchParams.set('retmax', String(retmax));
  const searchJson = await fetchJson(esearch);
  const ids = ((searchJson as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? []).filter(Boolean);
  const papers = ids.length ? await pubmedSummaries(ids) : [];
  return {
    message: papers.length
      ? `PubMed returned ${papers.length} paper records for: ${query}`
      : `PubMed returned no paper records for: ${query}`,
    confidence: papers.length ? 0.86 : 0.55,
    claimType: papers.length ? 'fact' : 'inference',
    evidenceLevel: 'database',
    reasoningTrace: `BioAgent project tool queried PubMed E-utilities from the BioAgent workspace service with retmax=${retmax}.`,
    claims: papers.map((paper) => ({
      text: `${paper.title} (${paper.year}) was retrieved from PubMed for ${query}.`,
      type: 'fact',
      confidence: 0.84,
      evidenceLevel: 'database',
      supportingRefs: [`PMID:${paper.pmid}`],
      opposingRefs: [],
    })),
    uiManifest: [
      { componentId: 'paper-card-list', title: 'PubMed papers', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', title: 'Evidence', artifactRef: 'paper-list', priority: 2 },
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'paper-list', priority: 3 },
    ],
    executionUnits: [executionUnit('literature', 'PubMed.eutils.esearch+esummary', {
      query,
      retmax,
      database: 'pubmed',
    }, 'done', ['PubMed E-utilities'], ['paper-list'])],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      producerAgent: 'literature',
      schemaVersion: '1',
      metadata: { query, retmax, source: 'PubMed', accessedAt: new Date().toISOString() },
      data: { query, papers },
    }],
  };
}

function literatureQuery(request: ToolRequest) {
  const fromArtifact = request.artifacts?.map((artifact) => {
    const data = isRecord(artifact.dataPreview) ? artifact.dataPreview : isRecord(artifact.data) ? artifact.data : {};
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    return stringValue(metadata.entity)
      || stringValue(metadata.accession)
      || stringValue(data.uniprotId)
      || rowValue(data.rows, 'entity')
      || nodeValue(data.nodes);
  }).find(Boolean);
  const prompt = request.prompt || fromArtifact || 'KRAS G12D pancreatic cancer targeted therapy';
  if (/clinical trials?/i.test(prompt) && fromArtifact) return `${fromArtifact} clinical trials`;
  return prompt
    .replace(/返回.*$/u, '')
    .replace(/请|文献|证据|近三年|三年|paper-list|JSON|artifact|claims|ExecutionUnit/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || String(fromArtifact || 'KRAS G12D pancreatic cancer targeted therapy');
}

async function pubmedSummaries(ids: string[]) {
  const esummary = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
  esummary.searchParams.set('db', 'pubmed');
  esummary.searchParams.set('id', ids.join(','));
  esummary.searchParams.set('retmode', 'json');
  const summaryJson = await fetchJson(esummary) as { result?: Record<string, Record<string, unknown>> };
  return ids.map((pmid) => {
    const record = summaryJson.result?.[pmid] ?? {};
    const authors = Array.isArray(record.authors)
      ? record.authors.map((author) => isRecord(author) ? stringValue(author.name) : undefined).filter(Boolean)
      : [];
    return {
      pmid,
      title: stringValue(record.title) || `PMID ${pmid}`,
      authors,
      journal: stringValue(record.fulljournalname) || stringValue(record.source) || 'PubMed',
      year: String(stringValue(record.pubdate)?.match(/\d{4}/)?.[0] || ''),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstract: stringValue(record.sorttitle) || stringValue(record.title) || '',
      evidenceLevel: 'database',
    };
  });
}

async function runStructure(request: ToolRequest): Promise<ToolPayload> {
  const accession = request.prompt.match(/\b[A-Z][A-Z0-9]{5,9}\b/)?.[0];
  const pdbId = request.prompt.match(/\b[0-9][A-Za-z0-9]{3}\b/)?.[0]?.toUpperCase();
  if (accession && !pdbId) return runAlphaFoldStructure(request, accession);
  const id = pdbId || '7BZ5';
  const url = `https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent(id)}`;
  const record = await fetchJson(url) as Record<string, unknown>;
  const info = isRecord(record.struct) ? record.struct : {};
  const exptl = Array.isArray(record.exptl) && isRecord(record.exptl[0]) ? record.exptl[0] : {};
  const refine = Array.isArray(record.refine) && isRecord(record.refine[0]) ? record.refine[0] : {};
  const resolution = numberValue(refine.ls_d_res_high);
  const residues = residueRanges(request.prompt);
  return {
    message: `RCSB returned structure metadata for PDB ${id}.`,
    confidence: 0.84,
    claimType: 'fact',
    evidenceLevel: 'database',
    reasoningTrace: `BioAgent project tool queried RCSB core entry API for ${id}.`,
    claims: [{
      text: `PDB ${id} metadata was retrieved from RCSB; method=${stringValue(exptl.method) || 'unknown'}.`,
      type: 'fact',
      confidence: 0.84,
      evidenceLevel: 'database',
      supportingRefs: [`RCSB:${id}`],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'molecule-viewer', title: 'Structure', artifactRef: 'structure-summary', priority: 1 },
      { componentId: 'evidence-matrix', title: 'Structure evidence', artifactRef: 'structure-summary', priority: 2 },
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'structure-summary', priority: 3 },
    ],
    executionUnits: [executionUnit('structure', 'RCSB.core.entry', { pdbId: id, url }, 'done', ['RCSB PDB current'], ['structure-summary'])],
    artifacts: [{
      id: 'structure-summary',
      type: 'structure-summary',
      producerAgent: 'structure',
      schemaVersion: '1',
      dataRef: `https://files.rcsb.org/download/${id}.cif`,
      metadata: { source: 'RCSB', pdbId: id, accessedAt: new Date().toISOString() },
      data: {
        pdbId: id,
        ligand: 'unknown',
        title: stringValue(info.title),
        highlightResidues: residues,
        metrics: {
          resolution,
          method: stringValue(exptl.method),
          pLDDT: undefined,
          mutationRisk: residues.length ? 'review-needed' : undefined,
        },
      },
    }],
  };
}

async function runAlphaFoldStructure(_request: ToolRequest, accession: string): Promise<ToolPayload> {
  const url = `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession)}`;
  const records = await fetchJson(url, { headers: { 'User-Agent': 'BioAgent/0.1 project-workspace-tool' } }) as Array<Record<string, unknown>>;
  const first = records.find(isRecord) ?? {};
  const modelUrl = stringValue(first.cifUrl) || stringValue(first.pdbUrl);
  return {
    message: `AlphaFold DB returned prediction metadata for UniProt ${accession}.`,
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'database',
    reasoningTrace: `BioAgent project tool queried AlphaFold DB prediction API for ${accession}.`,
    claims: [{
      text: `UniProt ${accession} has an AlphaFold prediction record.`,
      type: 'fact',
      confidence: 0.82,
      evidenceLevel: 'database',
      supportingRefs: [`AlphaFold:${accession}`],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'molecule-viewer', title: 'AlphaFold structure', artifactRef: 'structure-summary', priority: 1 },
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'structure-summary', priority: 2 },
    ],
    executionUnits: [executionUnit('structure', 'AlphaFoldDB.prediction', { accession, url }, 'done', ['AlphaFold DB current'], ['structure-summary'])],
    artifacts: [{
      id: 'structure-summary',
      type: 'structure-summary',
      producerAgent: 'structure',
      schemaVersion: '1',
      dataRef: modelUrl,
      metadata: { source: 'AlphaFold DB', accession, accessedAt: new Date().toISOString() },
      data: {
        uniprotId: accession,
        pdbId: stringValue(first.entryId) || `AF-${accession}-F1`,
        ligand: 'none',
        highlightResidues: [],
        metrics: {
          pLDDT: numberValue(first.confidenceAvgLocalDistanceTest) || numberValue(first.plddt),
          resolution: undefined,
          method: 'AlphaFold prediction',
        },
      },
    }],
  };
}

async function runKnowledge(request: ToolRequest): Promise<ToolPayload> {
  const entity = knowledgeEntity(request);
  const query = `(gene_exact:${entity}) AND (organism_id:9606) AND (reviewed:true)`;
  const url = new URL('https://rest.uniprot.org/uniprotkb/search');
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('size', '1');
  const json = await fetchJson(url) as { results?: Array<Record<string, unknown>> };
  const record = json.results?.find(isRecord) ?? {};
  const accession = stringValue(record.primaryAccession) || entity;
  const protein = isRecord(record.proteinDescription)
    && isRecord(record.proteinDescription.recommendedName)
    && isRecord(record.proteinDescription.recommendedName.fullName)
    ? stringValue(record.proteinDescription.recommendedName.fullName.value)
    : accession;
  const functionComment = Array.isArray(record.comments)
    ? record.comments.map((comment) => isRecord(comment) && Array.isArray(comment.texts) && isRecord(comment.texts[0]) ? stringValue(comment.texts[0].value) : undefined).find(Boolean)
    : undefined;
  return {
    message: `UniProt returned reviewed human entry ${accession} for ${entity}.`,
    confidence: record.primaryAccession ? 0.88 : 0.58,
    claimType: 'fact',
    evidenceLevel: 'database',
    reasoningTrace: `BioAgent project tool queried UniProt REST with exact reviewed human gene disambiguation.`,
    claims: [{
      text: `${entity} maps to UniProt accession ${accession}.`,
      type: 'fact',
      confidence: record.primaryAccession ? 0.88 : 0.58,
      evidenceLevel: 'database',
      supportingRefs: [`UniProt:${accession}`],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'network-graph', title: 'Knowledge graph', artifactRef: 'knowledge-graph', priority: 1 },
      { componentId: 'data-table', title: 'Knowledge cards', artifactRef: 'knowledge-graph', priority: 2 },
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'knowledge-graph', priority: 3 },
    ],
    executionUnits: [executionUnit('knowledge', 'UniProt.uniprotkb.search', { query, size: 1 }, 'done', ['UniProt current'], ['knowledge-graph'])],
    artifacts: [{
      id: 'knowledge-graph',
      type: 'knowledge-graph',
      producerAgent: 'knowledge',
      schemaVersion: '1',
      metadata: { entity, accession, source: 'UniProt', accessedAt: new Date().toISOString() },
      data: {
        nodes: [
          { id: entity, label: entity, type: 'gene', confidence: 0.9 },
          { id: accession, label: protein || accession, type: 'protein', confidence: 0.88 },
          { id: 'UniProt', label: 'UniProt', type: 'database', confidence: 0.95 },
        ],
        edges: [
          { source: entity, target: accession, relation: 'encodes', evidenceLevel: 'database' },
          { source: accession, target: 'UniProt', relation: 'sourced_from', evidenceLevel: 'database' },
        ],
        rows: [
          { key: 'entity', value: entity, source: 'prompt' },
          { key: 'uniprot_accession', value: accession, source: 'UniProt' },
          { key: 'protein_name', value: protein, source: 'UniProt' },
          { key: 'function', value: functionComment || 'review needed', source: 'UniProt' },
        ],
      },
    }],
  };
}

function knowledgeEntity(request: ToolRequest) {
  const fromPrompt = request.prompt.match(/\b[A-Z0-9]{2,12}\b/)?.[0];
  const fromArtifact = request.artifacts?.map((artifact) => {
    const data = isRecord(artifact.dataPreview) ? artifact.dataPreview : isRecord(artifact.data) ? artifact.data : {};
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    return stringValue(metadata.entity) || rowValue(data.rows, 'entity') || nodeValue(data.nodes);
  }).find(Boolean);
  return fromPrompt || String(fromArtifact || 'TP53');
}

async function runOmics(request: ToolRequest): Promise<ToolPayload> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const params = omicsParams(request.prompt);
  if (!params.matrixRef || !params.metadataRef) throw new Error('matrixRef and metadataRef are required for BioAgent omics project tool');
  const matrixPath = safeWorkspacePath(workspace, params.matrixRef);
  const metadataPath = safeWorkspacePath(workspace, params.metadataRef);
  const matrix = parseMatrix(await readFile(matrixPath, 'utf8'));
  const metadata = parseCsv(await readFile(metadataPath, 'utf8'));
  const run = differential(matrix, metadata, params);
  const runId = createHash('sha1').update(`${Date.now()}:${params.matrixRef}:${params.metadataRef}`).digest('hex').slice(0, 12);
  const outputDir = join(workspace, '.bioagent', 'omics');
  await mkdir(outputDir, { recursive: true });
  const outputRel = `.bioagent/omics/omics-differential-${runId}.json`;
  const logRel = `.bioagent/omics/omics-differential-${runId}.log.json`;
  const artifactData = {
    points: run.points,
    heatmap: {
      label: `${params.caseGroup} vs ${params.controlGroup}`,
      matrix: run.heatmap,
      genes: run.points.slice(0, 12).map((point) => point.gene),
      samples: matrix.samples,
    },
    umap: run.umap,
  };
  await writeFile(join(workspace, outputRel), JSON.stringify(artifactData, null, 2));
  await writeFile(join(workspace, logRel), JSON.stringify({
    runner: 'omics.local-csv-differential',
    params,
    inputFingerprints: {
      matrix: sha1(await readFile(matrixPath)),
      metadata: sha1(await readFile(metadataPath)),
    },
    note: 'Project-local bounded CSV differential runner. Install Scanpy/DESeq2 in the BioAgent workspace for publication-grade analysis.',
  }, null, 2));
  return {
    message: `BioAgent omics project tool identified ${run.significantCount} genes passing alpha=${params.alpha}.`,
    confidence: 0.78,
    claimType: 'inference',
    evidenceLevel: 'experimental',
    reasoningTrace: `Read matrix=${params.matrixRef} and metadata=${params.metadataRef} inside BioAgent workspace; wrote ${outputRel} and ${logRel}.`,
    claims: [{
      text: `${run.significantCount} genes pass alpha=${params.alpha} in the bounded CSV differential run.`,
      type: 'inference',
      confidence: 0.78,
      evidenceLevel: 'experimental',
      supportingRefs: ['omics-differential-expression'],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'volcano-plot', title: 'Volcano', artifactRef: 'omics-differential-expression', priority: 1 },
      { componentId: 'heatmap-viewer', title: 'Heatmap', artifactRef: 'omics-differential-expression', priority: 2 },
      { componentId: 'umap-viewer', title: 'UMAP', artifactRef: 'omics-differential-expression', priority: 3 },
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'omics-differential-expression', priority: 4 },
    ],
    executionUnits: [executionUnit('omics', 'omics.local-csv-differential', params, 'done', ['BioAgent project CSV runner'], ['omics-differential-expression'])],
    artifacts: [{
      id: 'omics-differential-expression',
      type: 'omics-differential-expression',
      producerAgent: 'omics',
      schemaVersion: '1',
      dataRef: outputRel,
      metadata: {
        runner: 'omics.local-csv-differential',
        normalizationMethod: 'log2(count + 1) group mean difference',
        statisticalModel: 'Welch t-test approximation with Benjamini-Hochberg FDR',
        designMatrix: params.designFormula,
        outputRef: outputRel,
        logRef: logRel,
      },
      data: artifactData,
    }],
  };
}

function omicsParams(prompt: string) {
  const get = (key: string) => prompt.match(new RegExp(`${key}=([^\\s]+)`))?.[1];
  return {
    matrixRef: get('matrixRef') || '',
    metadataRef: get('metadataRef') || '',
    groupColumn: get('groupColumn') || 'condition',
    caseGroup: get('caseGroup') || 'treated',
    controlGroup: get('controlGroup') || 'control',
    designFormula: get('designFormula') || '~condition',
    alpha: Number(get('alpha') || 0.05),
  };
}

function parseCsv(text: string) {
  const [headerLine = '', ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((item) => item.trim());
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',').map((item) => item.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function parseMatrix(text: string) {
  const rows = parseCsv(text);
  const headers = Object.keys(rows[0] ?? {});
  const geneKey = headers[0] || 'gene';
  const samples = headers.slice(1);
  return {
    samples,
    rows: rows.map((row) => ({
      gene: String(row[geneKey]),
      values: samples.map((sample) => Number(row[sample] || 0)),
    })).filter((row) => row.gene),
  };
}

function differential(matrix: ReturnType<typeof parseMatrix>, metadata: Array<Record<string, string>>, params: ReturnType<typeof omicsParams>) {
  const sampleGroups = new Map(metadata.map((row) => [row.sample || row.sampleId || row.id, row[params.groupColumn]]));
  const caseIndexes = matrix.samples.map((sample, index) => sampleGroups.get(sample) === params.caseGroup ? index : -1).filter((index) => index >= 0);
  const controlIndexes = matrix.samples.map((sample, index) => sampleGroups.get(sample) === params.controlGroup ? index : -1).filter((index) => index >= 0);
  if (!caseIndexes.length || !controlIndexes.length) throw new Error(`No samples found for caseGroup=${params.caseGroup} and controlGroup=${params.controlGroup}`);
  const points = matrix.rows.map((row) => {
    const cases = caseIndexes.map((index) => row.values[index]);
    const controls = controlIndexes.map((index) => row.values[index]);
    const logFC = mean(cases.map(log2p1)) - mean(controls.map(log2p1));
    const pValue = welchApproxP(cases, controls);
    return { gene: row.gene, logFC, pValue, fdr: pValue, significant: false };
  }).sort((a, b) => a.pValue - b.pValue);
  const m = points.length;
  for (let index = 0; index < points.length; index += 1) {
    points[index].fdr = Math.min(1, points[index].pValue * m / (index + 1));
    points[index].significant = points[index].fdr <= params.alpha;
  }
  return {
    points,
    significantCount: points.filter((point) => point.significant).length,
    heatmap: points.slice(0, 12).map((point) => matrix.rows.find((row) => row.gene === point.gene)?.values ?? []),
    umap: matrix.samples.map((sample, index) => ({
      x: index - (matrix.samples.length - 1) / 2,
      y: matrix.rows.reduce((sum, row) => sum + row.values[index], 0) / Math.max(1, matrix.rows.length),
      cluster: sampleGroups.get(sample) || 'unknown',
      sample,
    })),
  };
}

function executionUnit(agentId: Profile, tool: string, params: unknown, status: string, databaseVersions: string[], artifacts: string[]) {
  const hash = sha1(JSON.stringify({ tool, params })).slice(0, 10);
  return {
    id: `EU-${agentId}-${hash}`,
    tool,
    params: JSON.stringify(params),
    status,
    hash,
    time: new Date().toISOString(),
    environment: 'BioAgent project workspace service',
    databaseVersions,
    artifacts,
    outputArtifacts: artifacts,
  };
}

function safeWorkspacePath(workspace: string, ref: string) {
  const target = resolve(workspace, ref);
  if (!target.startsWith(workspace)) throw new Error(`Path escapes workspace: ${ref}`);
  return target;
}

async function fetchJson(input: string | URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${String(input)}`);
  return response.json();
}

function residueRanges(prompt: string) {
  return Array.from(prompt.matchAll(/\b(\d{1,4}\s*-\s*\d{1,4}|[A-Z]\d{1,4}[A-Z]?)\b/g)).map((match) => match[1].replace(/\s+/g, ''));
}

function rowValue(value: unknown, key: string) {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = rows.find((row) => stringValue(row.key)?.toLowerCase() === key.toLowerCase());
  return stringValue(found?.value);
}

function nodeValue(value: unknown) {
  const nodes = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = nodes.find((node) => ['gene', 'protein'].includes(String(node.type || '').toLowerCase())) ?? nodes[0];
  return stringValue(found?.id) || stringValue(found?.label);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function variance(values: number[]) {
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length - 1);
}

function welchApproxP(left: number[], right: number[]) {
  const denominator = Math.sqrt(variance(left) / Math.max(1, left.length) + variance(right) / Math.max(1, right.length)) || 1;
  const t = Math.abs((mean(left) - mean(right)) / denominator);
  return Math.max(1e-6, Math.min(1, Math.exp(-t)));
}

function log2p1(value: number) {
  return Math.log2(Math.max(0, value) + 1);
}

function sha1(value: string | Buffer) {
  return createHash('sha1').update(value).digest('hex');
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
