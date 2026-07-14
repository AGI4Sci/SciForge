import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_AGENT_ACCESS,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginManifest,
  extensionFromPreviewPath,
  normalizePreviewExtension
} from './contract'

export type LifeSciencePreviewPriority = 'p0' | 'p1' | 'p2'

export type LifeSciencePreviewFormat = {
  extension: string
  modality: Exclude<WorkspacePreviewModality, 'unknown'>
  pluginId: string
  priority: LifeSciencePreviewPriority
  description: string
}

export type DeferredSciencePreviewFormat = {
  extension: string
  modality: string
  reason: string
}

export type LifeSciencePreviewRoute =
  | {
      scope: 'life-science'
      status: 'planned'
      format: LifeSciencePreviewFormat
    }
  | {
      scope: 'deferred-non-life-science'
      status: 'deferred'
      format: DeferredSciencePreviewFormat
    }
  | {
      scope: 'unknown'
      status: 'unsupported'
      extension: string
    }

export const LIFE_SCIENCE_PREVIEW_FORMATS: readonly LifeSciencePreviewFormat[] = [
  { extension: '.pdb', modality: 'molecular', pluginId: 'molecular', priority: 'p0', description: 'Protein Data Bank structure' },
  { extension: '.cif', modality: 'molecular', pluginId: 'molecular', priority: 'p0', description: 'Crystallographic information structure' },
  { extension: '.mmcif', modality: 'molecular', pluginId: 'molecular', priority: 'p0', description: 'Macromolecular CIF structure' },
  { extension: '.sdf', modality: 'molecular', pluginId: 'molecular', priority: 'p1', description: 'Small molecule structure data file' },
  { extension: '.mol', modality: 'molecular', pluginId: 'molecular', priority: 'p1', description: 'Molecular structure file' },
  { extension: '.mol2', modality: 'molecular', pluginId: 'molecular', priority: 'p1', description: 'Tripos molecular structure file' },
  { extension: '.xyz', modality: 'molecular', pluginId: 'molecular', priority: 'p1', description: 'Atomic coordinate file' },
  { extension: '.xtc', modality: 'molecular', pluginId: 'molecular', priority: 'p2', description: 'Molecular dynamics trajectory' },
  { extension: '.dcd', modality: 'molecular', pluginId: 'molecular', priority: 'p2', description: 'Molecular dynamics trajectory' },
  { extension: '.trr', modality: 'molecular', pluginId: 'molecular', priority: 'p2', description: 'Molecular dynamics trajectory' },
  { extension: '.mrc', modality: 'molecular', pluginId: 'molecular', priority: 'p2', description: 'Cryo-EM density map' },
  { extension: '.ccp4', modality: 'molecular', pluginId: 'molecular', priority: 'p2', description: 'Electron density map' },
  { extension: '.fasta', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p0', description: 'FASTA sequence file' },
  { extension: '.fa', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p0', description: 'FASTA sequence file' },
  { extension: '.fna', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p0', description: 'FASTA nucleotide sequence file' },
  { extension: '.faa', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p0', description: 'FASTA amino-acid sequence file' },
  { extension: '.fastq', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'FASTQ sequencing reads' },
  { extension: '.gb', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'GenBank sequence record' },
  { extension: '.gbk', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'GenBank sequence record' },
  { extension: '.gff', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'Genome feature file' },
  { extension: '.gff3', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'Genome feature file' },
  { extension: '.gtf', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'Gene transfer format file' },
  { extension: '.bed', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'Genome interval file' },
  { extension: '.vcf', modality: 'sequence', pluginId: 'sequence-genomics', priority: 'p1', description: 'Variant call format file' },
  { extension: '.h5ad', modality: 'omics', pluginId: 'omics-matrix', priority: 'p1', description: 'AnnData single-cell matrix' },
  { extension: '.loom', modality: 'omics', pluginId: 'omics-matrix', priority: 'p1', description: 'Loom omics matrix' },
  { extension: '.mtx', modality: 'omics', pluginId: 'omics-matrix', priority: 'p1', description: 'Matrix Market omics matrix' },
  { extension: '.h5', modality: 'omics', pluginId: 'omics-matrix', priority: 'p2', description: 'HDF5 life-science matrix container' },
  { extension: '.hdf5', modality: 'omics', pluginId: 'omics-matrix', priority: 'p2', description: 'HDF5 life-science matrix container' },
  { extension: '.zarr', modality: 'omics', pluginId: 'omics-matrix', priority: 'p2', description: 'Chunked omics array store' },
  { extension: '.tif', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p1', description: 'Bioimage TIFF' },
  { extension: '.tiff', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p1', description: 'Bioimage TIFF' },
  { extension: '.ome.tiff', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p1', description: 'OME-TIFF bioimage' },
  { extension: '.ome.tif', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p1', description: 'OME-TIFF bioimage' },
  { extension: '.czi', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p2', description: 'Zeiss microscopy image' },
  { extension: '.svs', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p2', description: 'Whole-slide pathology image' },
  { extension: '.ndpi', modality: 'bioimaging', pluginId: 'bioimaging', priority: 'p2', description: 'Whole-slide pathology image' },
  { extension: '.mzml', modality: 'spectra', pluginId: 'proteomics-spectra', priority: 'p1', description: 'Mass spectrometry mzML' },
  { extension: '.mzxml', modality: 'spectra', pluginId: 'proteomics-spectra', priority: 'p1', description: 'Mass spectrometry mzXML' },
  { extension: '.mgf', modality: 'spectra', pluginId: 'proteomics-spectra', priority: 'p1', description: 'Mascot generic peak list' },
  { extension: '.fcs', modality: 'spectra', pluginId: 'proteomics-spectra', priority: 'p2', description: 'Flow cytometry standard data' }
] as const

export const DEFERRED_NON_LIFE_SCIENCE_FORMATS: readonly DeferredSciencePreviewFormat[] = [
  { extension: '.geojson', modality: 'geospatial', reason: 'Outside the current life-science preview scope.' },
  { extension: '.shp', modality: 'geospatial', reason: 'Outside the current life-science preview scope.' },
  { extension: '.nc', modality: 'geospatial', reason: 'Outside the current life-science preview scope.' },
  { extension: '.vtk', modality: 'engineering-simulation', reason: 'Outside the current life-science preview scope.' },
  { extension: '.vtu', modality: 'engineering-simulation', reason: 'Outside the current life-science preview scope.' },
  { extension: '.stl', modality: 'generic-3d', reason: 'Outside the current life-science preview scope.' },
  { extension: '.obj', modality: 'generic-3d', reason: 'Outside the current life-science preview scope.' },
  { extension: '.ply', modality: 'generic-3d', reason: 'Outside the current life-science preview scope.' }
] as const

export const LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'molecular',
    displayName: 'Molecular Structure Viewer',
    version: '0.1.0',
    modality: 'molecular',
    lifecycle: 'hybrid',
    priority: 900,
    extensions: LIFE_SCIENCE_PREVIEW_FORMATS.filter((format) => format.pluginId === 'molecular').map((format) => format.extension),
    mimeTypes: ['chemical/x-pdb', 'chemical/x-cif', 'chemical/x-mdl-sdfile'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: true,
      export: ['pdb', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'xtc', 'dcd', 'trr', 'mrc', 'ccp4'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-molecular'
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'sequence-genomics',
    displayName: 'Sequence and Genomics Viewer',
    version: '0.1.0',
    modality: 'sequence',
    lifecycle: 'hybrid',
    priority: 820,
    extensions: LIFE_SCIENCE_PREVIEW_FORMATS.filter((format) => format.pluginId === 'sequence-genomics').map((format) => format.extension),
    mimeTypes: ['text/x-fasta', 'application/gff3'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: true,
      export: ['fasta', 'fa', 'fastq', 'gb', 'gbk', 'gff', 'gtf', 'bed', 'vcf'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-sequence'
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'omics-matrix',
    displayName: 'Omics Matrix Viewer',
    version: '0.1.0',
    modality: 'omics',
    lifecycle: 'worker',
    priority: 760,
    extensions: LIFE_SCIENCE_PREVIEW_FORMATS.filter((format) => format.pluginId === 'omics-matrix').map((format) => format.extension),
    mimeTypes: ['application/x-hdf5'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: true,
      export: ['h5ad', 'loom', 'mtx', 'h5', 'hdf5', 'zarr'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-omics'
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'bioimaging',
    displayName: 'Bioimaging Viewer',
    version: '0.1.0',
    modality: 'bioimaging',
    lifecycle: 'worker',
    priority: 740,
    extensions: LIFE_SCIENCE_PREVIEW_FORMATS.filter((format) => format.pluginId === 'bioimaging').map((format) => format.extension),
    mimeTypes: ['image/tiff'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: true,
      export: ['tif', 'tiff', 'czi', 'svs', 'ndpi'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-bioimaging'
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'proteomics-spectra',
    displayName: 'Proteomics and Spectra Viewer',
    version: '0.1.0',
    modality: 'spectra',
    lifecycle: 'worker',
    priority: 700,
    extensions: LIFE_SCIENCE_PREVIEW_FORMATS.filter((format) => format.pluginId === 'proteomics-spectra').map((format) => format.extension),
    mimeTypes: ['application/mzml+xml'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: true,
      export: ['mzml', 'mzxml', 'mgf', 'fcs'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-spectra'
  }
] as const

const lifeScienceByExtension = new Map(
  LIFE_SCIENCE_PREVIEW_FORMATS.map((format) => [normalizePreviewExtension(format.extension), {
    ...format,
    extension: normalizePreviewExtension(format.extension)
  }])
)

const deferredByExtension = new Map(
  DEFERRED_NON_LIFE_SCIENCE_FORMATS.map((format) => [normalizePreviewExtension(format.extension), {
    ...format,
    extension: normalizePreviewExtension(format.extension)
  }])
)

export function resolveLifeSciencePreviewRoute(pathOrExtension: string): LifeSciencePreviewRoute {
  const knownExtensions = [
    ...LIFE_SCIENCE_PREVIEW_FORMATS.map((format) => format.extension),
    ...DEFERRED_NON_LIFE_SCIENCE_FORMATS.map((format) => format.extension)
  ]
  const trimmed = pathOrExtension.trim()
  const rawExtension = trimmed.startsWith('.')
    ? trimmed
    : extensionFromPreviewPath(trimmed, knownExtensions)
  const extension = normalizePreviewExtension(rawExtension)
  const lifeScience = lifeScienceByExtension.get(extension)
  if (lifeScience) {
    return {
      scope: 'life-science',
      status: 'planned',
      format: lifeScience
    }
  }

  const deferred = deferredByExtension.get(extension)
  if (deferred) {
    return {
      scope: 'deferred-non-life-science',
      status: 'deferred',
      format: deferred
    }
  }

  return {
    scope: 'unknown',
    status: 'unsupported',
    extension
  }
}

export function isLifeSciencePreviewExtension(pathOrExtension: string): boolean {
  return resolveLifeSciencePreviewRoute(pathOrExtension).scope === 'life-science'
}

export function isDeferredNonLifeScienceExtension(pathOrExtension: string): boolean {
  return resolveLifeSciencePreviewRoute(pathOrExtension).scope === 'deferred-non-life-science'
}
