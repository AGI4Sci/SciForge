/**
 * Port of packages/domains/life-science-preview/src/backend/
 * provider-contributions.ts + contract.ts: contribution declarations →
 * { contract, value: { manifest, provider } } pairs for the six
 * main.workspace-preview-plugin slots.
 *
 * The canonical manifest sources below mirror the trusted domain package's
 * sciforge.domain.json contributionContracts VERBATIM (same ids, priorities,
 * extension lists, capability flags, workerPackage pins). A test
 * (tests/contributions.test.ts) diffs this table against the domain JSON on
 * disk so the two cannot drift silently.
 */
import {
  workspacePreviewPluginManifestSchema,
  type WorkspacePreviewPluginManifest
} from '@sciforge/domain-sdk/workspace-preview'
import {
  type LifeScienceContributionDeclaration,
  type LifeSciencePorts,
  type LifeSciencePreviewContribution
} from '../ports/index.js'
import {
  createLifeScienceWorkspacePreviewProvider
} from '../core/provider.js'

export type LifeScienceWorkspacePreviewPluginContract = Readonly<{
  contributionId: string
  manifest: WorkspacePreviewPluginManifest
}>

const MANIFEST_SOURCES = [
  {
    contributionId: 'sciforge.life-science-preview.molecular',
    raw: {
      contractVersion: 1,
      id: 'molecular',
      displayName: 'Molecular Structure Viewer',
      version: '0.1.0',
      modality: 'sciforge.life-science-preview.molecular',
      lifecycle: 'hybrid',
      priority: 900,
      extensions: ['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz', '.xtc', '.dcd', '.trr', '.mrc', '.ccp4'],
      mimeTypes: ['chemical/x-pdb', 'chemical/x-cif', 'chemical/x-mdl-sdfile'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true,
        export: ['pdb', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'xtc', 'dcd', 'trr', 'mrc', 'ccp4']
      },
      workerPackage: '@sciforge/workspace-molecular'
    }
  },
  {
    contributionId: 'sciforge.life-science-preview.sequence-genomics',
    raw: {
      contractVersion: 1,
      id: 'sequence-genomics',
      displayName: 'Sequence and Genomics Viewer',
      version: '0.1.0',
      modality: 'sciforge.life-science-preview.sequence',
      lifecycle: 'hybrid',
      priority: 820,
      extensions: ['.fasta', '.fa', '.fna', '.faa', '.fastq', '.gb', '.gbk', '.gff', '.gff3', '.gtf', '.bed', '.vcf'],
      mimeTypes: ['text/x-fasta', 'application/gff3'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true,
        export: ['fasta', 'fa', 'fastq', 'gb', 'gbk', 'gff', 'gtf', 'bed', 'vcf']
      },
      workerPackage: '@sciforge/workspace-sequence'
    }
  },
  {
    contributionId: 'sciforge.life-science-preview.biology-index-transport',
    raw: {
      contractVersion: 1,
      id: 'biology-index-transport',
      displayName: 'Biology Index Transport',
      version: '0.1.0',
      modality: 'unknown',
      lifecycle: 'main',
      priority: 805,
      extensions: ['.fai', '.gzi', '.tbi', '.csi'],
      mimeTypes: [],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: false,
        export: []
      },
      notes: 'Passive byte-range transport for validated Biology Room companion indexes.'
    }
  },
  {
    contributionId: 'sciforge.life-science-preview.omics-matrix',
    raw: {
      contractVersion: 1,
      id: 'omics-matrix',
      displayName: 'Omics Matrix Viewer',
      version: '0.1.0',
      modality: 'sciforge.life-science-preview.omics',
      lifecycle: 'worker',
      priority: 760,
      extensions: ['.h5ad', '.loom', '.mtx', '.h5', '.hdf5', '.zarr'],
      mimeTypes: ['application/x-hdf5'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true,
        export: ['h5ad', 'loom', 'mtx', 'h5', 'hdf5', 'zarr']
      },
      workerPackage: '@sciforge/workspace-omics'
    }
  },
  {
    contributionId: 'sciforge.life-science-preview.bioimaging',
    raw: {
      contractVersion: 1,
      id: 'bioimaging',
      displayName: 'Bioimaging Viewer',
      version: '0.1.0',
      modality: 'sciforge.life-science-preview.bioimaging',
      lifecycle: 'worker',
      priority: 740,
      extensions: ['.tif', '.tiff', '.ome.tiff', '.ome.tif', '.czi', '.svs', '.ndpi'],
      mimeTypes: ['image/tiff'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true,
        export: ['tif', 'tiff', 'czi', 'svs', 'ndpi']
      },
      workerPackage: '@sciforge/workspace-bioimaging'
    }
  },
  {
    contributionId: 'sciforge.life-science-preview.proteomics-spectra',
    raw: {
      contractVersion: 1,
      id: 'proteomics-spectra',
      displayName: 'Proteomics and Spectra Viewer',
      version: '0.1.0',
      modality: 'sciforge.life-science-preview.spectra',
      lifecycle: 'worker',
      priority: 700,
      extensions: ['.mzml', '.mzxml', '.mgf', '.fcs'],
      mimeTypes: ['application/mzml+xml'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true,
        export: ['mzml', 'mzxml', 'mgf', 'fcs']
      },
      workerPackage: '@sciforge/workspace-spectra'
    }
  }
] as const

function canonicalManifestForContribution(raw: unknown, contributionId: string): WorkspacePreviewPluginManifest {
  const parsed = workspacePreviewPluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `Life Science Preview contribution ${contributionId} has an invalid canonical manifest: ${parsed.error.message}`
    )
  }
  return parsed.data
}

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS:
readonly LifeScienceWorkspacePreviewPluginContract[] = Object.freeze(
  MANIFEST_SOURCES.map((source) => Object.freeze({
    contributionId: source.contributionId,
    manifest: canonicalManifestForContribution(source.raw, source.contributionId)
  }))
)

export function createLifeScienceWorkspacePreviewContributions<Kind extends string>(
  declarations: readonly LifeScienceContributionDeclaration[],
  kind: Kind,
  processName: 'main' | 'workspace-server',
  ports: LifeSciencePorts
): LifeSciencePreviewContribution[] {
  const contractsByContributionId = new Map(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => [
      contract.contributionId,
      contract
    ])
  )
  return declarations.map((declaration) => {
    const contract = contractsByContributionId.get(declaration.id)
    if (!contract) {
      throw new Error(
        `Life Science Preview ${processName} contribution ${declaration.id} has no canonical manifest.`
      )
    }
    return Object.freeze({
      id: declaration.id,
      kind,
      contract: contract.manifest,
      value: Object.freeze({
        manifest: contract.manifest,
        provider: createLifeScienceWorkspacePreviewProvider(contract.manifest, ports)
      })
    })
  })
}
