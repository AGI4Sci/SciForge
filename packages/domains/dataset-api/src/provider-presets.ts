import type { DatasetApiRegisterInput } from './contract.js'

export type ExecutableDatasetProviderPreset = {
  source: Omit<DatasetApiRegisterInput, 'workspaceRoot' | 'overwrite'>
  metadataExample: Record<string, unknown>
  rawDataExample: Record<string, unknown>
}

export const EXECUTABLE_DATASET_PROVIDER_PRESETS = {
  'ncbi-eutils': {
    source: {
      id: 'ncbi-eutils',
      name: 'NCBI E-utilities',
      description: 'Entrez summaries as metadata and EFetch records as raw data.',
      baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',
      metadataEndpoint: 'esummary.fcgi',
      rawDataEndpoint: 'efetch.fcgi',
      auth: {
        type: 'query',
        envVar: 'NCBI_API_KEY',
        queryName: 'api_key',
        required: false
      }
    },
    metadataExample: {
      sourceId: 'ncbi-eutils',
      query: { db: 'gene', id: '7157', retmode: 'json', tool: 'SciForge' }
    },
    rawDataExample: {
      sourceId: 'ncbi-eutils',
      query: { db: 'gene', id: '7157', rettype: 'fasta', retmode: 'text', tool: 'SciForge' },
      outputFileName: 'ncbi_gene_7157.fasta',
      expectedFormat: 'fasta'
    }
  },
  ensembl: {
    source: {
      id: 'ensembl',
      name: 'Ensembl REST',
      description: 'Ensembl gene/transcript lookup metadata and sequence raw data.',
      baseUrl: 'https://rest.ensembl.org/',
      metadataEndpoint: 'lookup/id/{identifier}?content-type=application/json',
      rawDataEndpoint: 'sequence/id/{identifier}?content-type=text/x-fasta'
    },
    metadataExample: {
      sourceId: 'ensembl',
      pathParameters: { identifier: 'ENSG00000157764' }
    },
    rawDataExample: {
      sourceId: 'ensembl',
      pathParameters: { identifier: 'ENSG00000157764' },
      outputFileName: 'ENSG00000157764.fasta',
      expectedFormat: 'fasta'
    }
  },
  uniprot: {
    source: {
      id: 'uniprot',
      name: 'UniProt REST',
      description: 'UniProtKB entry metadata and protein sequences.',
      baseUrl: 'https://rest.uniprot.org/',
      metadataEndpoint: 'uniprotkb/{identifier}.json',
      rawDataEndpoint: 'uniprotkb/{identifier}.fasta'
    },
    metadataExample: {
      sourceId: 'uniprot',
      pathParameters: { identifier: 'P04637' }
    },
    rawDataExample: {
      sourceId: 'uniprot',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'P04637.fasta',
      expectedFormat: 'fasta'
    }
  },
  'ucsc-genome-browser': {
    source: {
      id: 'ucsc-genome-browser',
      name: 'UCSC Genome Browser API',
      description: 'Genome assembly metadata and coordinate-based sequence access.',
      baseUrl: 'https://api.genome.ucsc.edu/',
      metadataEndpoint: 'list/chromosomes',
      rawDataEndpoint: 'getData/sequence'
    },
    metadataExample: {
      sourceId: 'ucsc-genome-browser',
      query: { genome: 'hg38' },
      responseMode: 'summary'
    },
    rawDataExample: {
      sourceId: 'ucsc-genome-browser',
      query: { genome: 'hg38', chrom: 'chr17', start: 7668401, end: 7668501 },
      outputFileName: 'hg38-chr17-7668401-7668501.json',
      expectedFormat: 'json'
    }
  },
  'pubchem-pug-rest': {
    source: {
      id: 'pubchem-pug-rest',
      name: 'PubChem PUG REST',
      description: 'Compound properties as metadata and chemical structure records as raw data.',
      baseUrl: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/',
      metadataEndpoint: 'compound/cid/{identifier}/property/Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,InChIKey/JSON',
      rawDataEndpoint: 'compound/cid/{identifier}/SDF'
    },
    metadataExample: {
      sourceId: 'pubchem-pug-rest',
      pathParameters: { identifier: '2244' }
    },
    rawDataExample: {
      sourceId: 'pubchem-pug-rest',
      pathParameters: { identifier: '2244' },
      outputFileName: 'pubchem-2244.sdf',
      expectedFormat: 'text'
    }
  },
  'clinicaltrials-gov': {
    source: {
      id: 'clinicaltrials-gov',
      name: 'ClinicalTrials.gov API',
      description: 'Clinical study records, protocol metadata, outcomes, and references.',
      baseUrl: 'https://clinicaltrials.gov/api/v2/',
      metadataEndpoint: 'studies/{identifier}',
      rawDataEndpoint: 'studies/{identifier}'
    },
    metadataExample: {
      sourceId: 'clinicaltrials-gov',
      pathParameters: { identifier: 'NCT04280705' },
      responseMode: 'summary'
    },
    rawDataExample: {
      sourceId: 'clinicaltrials-gov',
      pathParameters: { identifier: 'NCT04280705' },
      outputFileName: 'NCT04280705.json',
      expectedFormat: 'json'
    }
  },
  kegg: {
    source: {
      id: 'kegg',
      name: 'KEGG API',
      description: 'KEGG database entries as metadata and sequence exports as raw data.',
      baseUrl: 'https://rest.kegg.jp/',
      metadataEndpoint: 'get/{identifier}',
      rawDataEndpoint: 'get/{identifier}/aaseq'
    },
    metadataExample: {
      sourceId: 'kegg',
      pathParameters: { identifier: 'hsa:7157' }
    },
    rawDataExample: {
      sourceId: 'kegg',
      pathParameters: { identifier: 'hsa:7157' },
      outputFileName: 'kegg-hsa-7157.fasta',
      expectedFormat: 'fasta'
    }
  },
  reactome: {
    source: {
      id: 'reactome',
      name: 'Reactome Content Service',
      description: 'Reactome pathway metadata and contained event records.',
      baseUrl: 'https://reactome.org/ContentService/',
      metadataEndpoint: 'data/query/{identifier}',
      rawDataEndpoint: 'data/pathway/{identifier}/containedEvents'
    },
    metadataExample: {
      sourceId: 'reactome',
      pathParameters: { identifier: 'R-HSA-109581' },
      responseMode: 'summary'
    },
    rawDataExample: {
      sourceId: 'reactome',
      pathParameters: { identifier: 'R-HSA-109581' },
      outputFileName: 'R-HSA-109581-contained-events.json',
      expectedFormat: 'json'
    }
  },
  quickgo: {
    source: {
      id: 'quickgo',
      name: 'QuickGO',
      description: 'GO term metadata and annotation records searchable by geneProductId or goId.',
      baseUrl: 'https://www.ebi.ac.uk/QuickGO/services/',
      metadataEndpoint: 'ontology/go/terms/{identifier}',
      rawDataEndpoint: 'annotation/search'
    },
    metadataExample: {
      sourceId: 'quickgo',
      pathParameters: { identifier: 'GO:0006915' }
    },
    rawDataExample: {
      sourceId: 'quickgo',
      query: { geneProductId: 'UniProtKB:P04637', limit: 100 },
      outputFileName: 'P04637-annotations.json',
      expectedFormat: 'json'
    }
  },
  string: {
    source: {
      id: 'string',
      name: 'STRING API',
      description: 'Protein identifier mapping metadata and functional association networks.',
      baseUrl: 'https://string-db.org/api/',
      metadataEndpoint: 'json/get_string_ids',
      rawDataEndpoint: 'tsv/network'
    },
    metadataExample: {
      sourceId: 'string',
      query: { identifiers: 'TP53', species: 9606 }
    },
    rawDataExample: {
      sourceId: 'string',
      query: { identifiers: 'TP53\rBRCA1', species: 9606 },
      outputFileName: 'string-TP53-BRCA1.tsv',
      expectedFormat: 'text'
    }
  },
  'alphafold-db': {
    source: {
      id: 'alphafold-db',
      name: 'AlphaFold DB API',
      description: 'Prediction metadata and AlphaFold structure files resolved by UniProt accession.',
      baseUrl: 'https://alphafold.ebi.ac.uk/',
      metadataEndpoint: 'api/prediction/{identifier}',
      rawDataEndpoint: 'files/AF-{identifier}-F1-model_v6.cif'
    },
    metadataExample: {
      sourceId: 'alphafold-db',
      pathParameters: { identifier: 'P04637' },
      responseMode: 'summary'
    },
    rawDataExample: {
      sourceId: 'alphafold-db',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'AF-P04637-F1-model_v6.cif',
      expectedFormat: 'text'
    }
  }
} as const satisfies Record<string, ExecutableDatasetProviderPreset>
