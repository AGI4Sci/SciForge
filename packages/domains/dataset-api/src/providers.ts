import type { DatasetProvider } from './contract.js'

// This is a capability catalog, not a promise that every provider shares one URL shape.
// Provider-specific and SDK-backed entries require their own adapter before execution.
export const BIOLOGY_DATASET_PROVIDERS: readonly DatasetProvider[] = [
  {
    id: 'ncbi-eutils', name: 'NCBI E-utilities', category: 'core', transport: 'rest', auth: 'optional-api-key',
    metadata: 'Entrez search, summaries, database metadata, and ID links',
    rawData: 'Entrez record and sequence export through EFetch', adapter: 'generic-http',
    documentationUrl: 'https://www.ncbi.nlm.nih.gov/home/develop/api/'
  },
  {
    id: 'embl-ebi-search', name: 'EMBL-EBI Search', category: 'core', transport: 'rest', auth: 'none',
    metadata: 'Cross-database domains, fields, facets, and search results',
    rawData: 'Result records; bulk payloads remain database-specific', adapter: 'provider-specific',
    documentationUrl: 'https://www.ebi.ac.uk/ebisearch/documentation/rest-api'
  },
  {
    id: 'ensembl', name: 'Ensembl REST', category: 'core', transport: 'rest', auth: 'none',
    metadata: 'Gene, transcript, variation, homology, assembly, and lookup annotations',
    rawData: 'Sequence and region payloads; large dumps use Ensembl downloads', adapter: 'generic-http',
    documentationUrl: 'https://rest.ensembl.org/'
  },
  {
    id: 'uniprot', name: 'UniProt REST', category: 'core', transport: 'rest', auth: 'none',
    metadata: 'Protein entries, functions, GO annotations, and ID mapping',
    rawData: 'Protein records and sequence exports, including FASTA', adapter: 'generic-http',
    documentationUrl: 'https://www.uniprot.org/help/programmatic_access'
  },
  {
    id: 'ucsc-genome-browser', name: 'UCSC Genome Browser API', category: 'core', transport: 'rest', auth: 'none',
    metadata: 'Genome assemblies, tracks, schemas, and coordinate annotations',
    rawData: 'Region sequence/track payloads; bulk data uses downloads or public MySQL', adapter: 'generic-http',
    documentationUrl: 'https://genome.ucsc.edu/goldenPath/help/api.html'
  },
  {
    id: 'chembl', name: 'ChEMBL', category: 'drug-and-small-molecule', transport: 'rest', auth: 'none',
    metadata: 'Compounds, targets, assays, activities, mechanisms, and classifications',
    rawData: 'Paginated resource records and database release downloads', adapter: 'provider-specific',
    documentationUrl: 'https://chembl.gitbook.io/chembl-interface-documentation/web-services/chembl-data-web-services'
  },
  {
    id: 'pubchem-pug-rest', name: 'PubChem PUG REST', category: 'drug-and-small-molecule', transport: 'rest', auth: 'none',
    metadata: 'Compound, substance, assay, identifier, structure, and property queries',
    rawData: 'Compound/assay records and structure exports', adapter: 'generic-http',
    documentationUrl: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest'
  },
  {
    id: 'open-targets', name: 'Open Targets Platform', category: 'drug-and-small-molecule', transport: 'graphql', auth: 'none',
    metadata: 'Target, disease, drug, genetics, association, and evidence graph',
    rawData: 'GraphQL result payloads; full snapshots use platform downloads', adapter: 'provider-specific',
    documentationUrl: 'https://platform-docs.opentargets.org/data-access/graphql-api'
  },
  {
    id: 'kegg', name: 'KEGG API', category: 'drug-and-small-molecule', transport: 'rest', auth: 'none',
    metadata: 'Pathway, drug, disease, compound, network, BRITE, and cross-reference queries',
    rawData: 'KEGG flat-file records and supported image/file responses', adapter: 'generic-http',
    documentationUrl: 'https://www.kegg.jp/kegg/rest/keggapi.html'
  },
  {
    id: 'clinicaltrials-gov', name: 'ClinicalTrials.gov API', category: 'drug-and-small-molecule', transport: 'rest', auth: 'none',
    metadata: 'Study metadata, search fields, enums, and API version information',
    rawData: 'Study record payloads; not measured efficacy data', adapter: 'generic-http',
    documentationUrl: 'https://clinicaltrials.gov/data-api/api'
  },
  {
    id: 'reactome', name: 'Reactome Content Service', category: 'pathway-and-network', transport: 'rest', auth: 'none',
    metadata: 'Pathway, event, reaction, entity, hierarchy, and database metadata',
    rawData: 'Content records and pathway/diagram exports', adapter: 'generic-http',
    documentationUrl: 'https://reactome.org/dev/content-service'
  },
  {
    id: 'quickgo', name: 'QuickGO', category: 'pathway-and-network', transport: 'rest', auth: 'none',
    metadata: 'GO/ECO terms, GOA annotations, and gene products',
    rawData: 'Paginated annotation and gene-product result records', adapter: 'generic-http',
    documentationUrl: 'https://www.ebi.ac.uk/QuickGO/api/index.html'
  },
  {
    id: 'gene-ontology', name: 'Gene Ontology API', category: 'pathway-and-network', transport: 'rest', auth: 'none',
    metadata: 'Ontology entities, annotations, and GO-CAM model metadata',
    rawData: 'GO-CAM JSON and release downloads for ontology/annotations', adapter: 'provider-specific',
    documentationUrl: 'https://geneontology.org/docs/tools-guide/'
  },
  {
    id: 'string', name: 'STRING API', category: 'pathway-and-network', transport: 'rest', auth: 'none',
    metadata: 'Identifier mapping, enrichment, network, and interaction queries',
    rawData: 'Interaction tables, network payloads, and images', adapter: 'generic-http',
    documentationUrl: 'https://string-db.org/help/api/'
  },
  {
    id: 'biogrid', name: 'BioGRID REST', category: 'pathway-and-network', transport: 'rest', auth: 'api-key',
    metadata: 'Curated protein, genetic, and chemical interaction evidence',
    rawData: 'Interaction record payloads and BioGRID release files', adapter: 'provider-specific',
    documentationUrl: 'https://wiki.thebiogrid.org/doku.php/biogridrest'
  },
  {
    id: 'rcsb-pdb', name: 'RCSB PDB APIs', category: 'structure-and-single-cell', transport: 'rest-and-graphql', auth: 'none',
    metadata: 'Structure, polymer, ligand, experiment, sequence, and search metadata',
    rawData: 'PDB/mmCIF structure files from the structure file service', adapter: 'provider-specific',
    documentationUrl: 'https://www.rcsb.org/docs/programmatic-access/web-apis-overview'
  },
  {
    id: 'alphafold-db', name: 'AlphaFold DB API', category: 'structure-and-single-cell', transport: 'rest', auth: 'none',
    metadata: 'Prediction metadata resolved from UniProt accessions',
    rawData: 'Linked PDB/mmCIF structures and confidence files', adapter: 'generic-http',
    documentationUrl: 'https://alphafold.ebi.ac.uk/api-docs'
  },
  {
    id: 'cellxgene-census', name: 'CZ CELLxGENE Census', category: 'structure-and-single-cell', transport: 'sdk-object-store', auth: 'none',
    metadata: 'Census, organism, cell, gene, dataset, and experiment metadata',
    rawData: 'Sparse expression-matrix slices through TileDB-SOMA using Python/R APIs', adapter: 'sdk-required',
    documentationUrl: 'https://chanzuckerberg.github.io/cellxgene-census/'
  }
] as const
