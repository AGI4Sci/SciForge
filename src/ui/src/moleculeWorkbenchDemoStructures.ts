/// <reference types="vite/client" />
import cifText from '@molecule-workbench-demo/1crn.cif?raw';
import pdbText from '@molecule-workbench-demo/1crn.pdb?raw';

function toBase64Utf8(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  return btoa(text);
}

function structureDataUrl(content: string, kind: 'pdb' | 'mmcif'): string {
  const mime = kind === 'mmcif' ? 'chemical/x-mmcif' : 'chemical/x-pdb';
  return `data:${mime};base64,${toBase64Utf8(content)}`;
}

/** Workbench demo payload: real crambin (1CRN) coordinates; PDB primary, mmCIF bundled for format coverage. */
export function getMoleculeWorkbenchDemoArtifactData(): Record<string, unknown> {
  return {
    pdbId: '1CRN',
    title: 'Crambin (1CRN)',
    ligand: 'none',
    highlightResidues: ['1', '2', '3'],
    metrics: {
      resolution: '1.54 Å',
      method: 'X-ray diffraction',
      organism: 'Crambe abyssinica',
      rcsb: 'https://www.rcsb.org/structure/1CRN',
      embeddedFormats: 'PDB (structureUrl) + mmCIF (mmcifUrl)',
    },
    structureUrl: structureDataUrl(pdbText, 'pdb'),
    mmcifUrl: structureDataUrl(cifText, 'mmcif'),
  };
}
