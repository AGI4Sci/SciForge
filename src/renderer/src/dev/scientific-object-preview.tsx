import React from 'react'
import ReactDOM from 'react-dom/client'
import 'molstar/build/viewer/molstar.css'
import '../index.css'
import '../styles/base-shell.css'
import '../i18n'
import type { ScientificObjectRef } from '@shared/scientific-objects'
import { TimelineScientificObjectsPanel } from '../components/chat/TimelineScientificObjectsPanel'

const workspaceRoot = '/workspace/demo'
const hash = (character: string) => ({ algorithm: 'sha256' as const, digest: character.repeat(64) })

const objects: ScientificObjectRef[] = [
  {
    schemaVersion: 1,
    id: 'protein-7tim',
    modality: 'molecular',
    title: '7TIM protein structure',
    source: 'tool',
    path: `${workspaceRoot}/7tim.pdb`,
    workspaceRoot,
    mimeType: 'chemical/x-pdb',
    hash: hash('a'),
    selection: { kind: 'molecular', chains: ['A'], ligands: ['ATP'] },
    observation: {
      schemaVersion: 1,
      file: { path: `${workspaceRoot}/7tim.pdb`, workspaceRoot, mimeType: 'chemical/x-pdb' },
      view: { pluginId: 'molecular', modality: 'molecular', mode: 'preview', title: '7TIM' },
      molecular: { modelCount: 1, chains: ['A', 'B'], ligands: ['ATP'], representations: ['cartoon'] },
      visibleText: 'Dimeric protein structure with an ATP ligand selected in chain A.',
      actions: ['molecular.preview', 'molecular.workbench']
    },
    provenance: { toolName: 'workspace_molecular_preview', toolVersion: '1' }
  },
  {
    schemaVersion: 1,
    id: 'sequence-brca1',
    modality: 'sequence',
    title: 'BRCA1 reference sequence',
    source: 'workspace',
    path: `${workspaceRoot}/brca1.fasta`,
    workspaceRoot,
    mimeType: 'text/x-fasta',
    hash: hash('b'),
    observation: {
      schemaVersion: 1,
      file: { path: `${workspaceRoot}/brca1.fasta`, workspaceRoot, mimeType: 'text/x-fasta' },
      view: { pluginId: 'sequence-genomics', modality: 'sequence', mode: 'preview', title: 'BRCA1' },
      sequence: { sequenceCount: 1, totalLength: 81189, alphabet: 'dna', features: [] },
      visibleText: 'One DNA reference sequence with indexed genomic features.',
      actions: ['sequence.selectRegion']
    }
  },
  {
    schemaVersion: 1,
    id: 'spectra-run-42',
    modality: 'spectra',
    title: 'LC–MS/MS run 42',
    source: 'generated',
    path: `${workspaceRoot}/run-42.mgf`,
    workspaceRoot,
    mimeType: 'application/x-mgf',
    hash: hash('c'),
    observation: {
      schemaVersion: 1,
      file: { path: `${workspaceRoot}/run-42.mgf`, workspaceRoot, mimeType: 'application/x-mgf' },
      view: { pluginId: 'spectra', modality: 'spectra', mode: 'preview', title: 'Run 42' },
      spectra: { spectrumCount: 318, peakCount: 24812, xAxis: 'm/z', mzRange: { min: 100, max: 1500 } },
      visibleText: '318 tandem mass spectra across m/z 100–1500.',
      actions: ['spectra.selectPeaksByRange']
    }
  },
  {
    schemaVersion: 1,
    id: 'omics-pbmc',
    modality: 'omics',
    title: 'PBMC single-cell atlas',
    source: 'workspace',
    path: `${workspaceRoot}/pbmc.h5ad`,
    workspaceRoot,
    mimeType: 'application/x-hdf5',
    hash: hash('d'),
    observation: {
      schemaVersion: 1,
      file: { path: `${workspaceRoot}/pbmc.h5ad`, workspaceRoot, mimeType: 'application/x-hdf5' },
      view: { pluginId: 'omics', modality: 'omics', mode: 'preview', title: 'PBMC atlas' },
      omics: { format: 'h5ad', matrixShape: [12000, 24000], observationCount: 12000, variableCount: 24000, embeddings: ['X_umap'] },
      visibleText: '12,000 cells × 24,000 variables with a UMAP embedding.',
      actions: ['omics.selectDataset']
    }
  },
  {
    schemaVersion: 1,
    id: 'image-organoid',
    modality: 'bioimaging',
    title: 'Organoid confocal stack',
    source: 'workspace',
    path: `${workspaceRoot}/organoid.ome.tiff`,
    workspaceRoot,
    mimeType: 'image/tiff',
    hash: hash('e'),
    observation: {
      schemaVersion: 1,
      file: { path: `${workspaceRoot}/organoid.ome.tiff`, workspaceRoot, mimeType: 'image/tiff' },
      view: { pluginId: 'bioimaging', modality: 'bioimaging', mode: 'preview', title: 'Organoid stack' },
      bioimaging: { dimensions: { width: 2048, height: 2048, z: 32, t: 1 }, channels: ['DAPI', 'FITC', 'TRITC'] },
      visibleText: 'Three-channel OME-TIFF confocal Z-stack.',
      actions: ['bioimaging.selectRegion']
    }
  }
]

function Preview(): React.ReactElement {
  return (
    <main className="min-h-screen bg-ds-main px-6 py-8 text-ds-ink">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">SciForge UI smoke</p>
          <h1 className="mt-1 text-2xl font-semibold">Scientific object cards</h1>
          <p className="mt-2 text-sm text-ds-muted">Five modalities, selection-aware actions, comparison, and annotations.</p>
        </header>
        <TimelineScientificObjectsPanel
          blocks={[{ kind: 'assistant', id: 'preview', text: 'Scientific objects ready.', meta: { scientificObjects: objects } }]}
          workspaceRoot={workspaceRoot}
          onContinuePrompt={(prompt) => {
            const output = document.querySelector<HTMLElement>('[data-preview-prompt]')
            if (output) output.textContent = prompt
          }}
        />
        <pre data-preview-prompt className="mt-6 whitespace-pre-wrap rounded-xl border border-ds-border bg-ds-card p-4 text-xs text-ds-muted" />
      </div>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
