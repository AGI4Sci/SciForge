import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceObservationSchema } from '../../../../src/shared/workspace-preview/index.js'
import {
  WorkspaceMolecularService,
  workspaceMolecularObservationSchema,
  workspaceMolecularPreviewInputSchema
} from './index.js'
import { createWorkspaceMolecularPreview } from './workspace-molecular-engine.js'

const pdb = [
  'ATOM      1  N   MET A   1      11.104  13.207   9.447  1.00 20.00           N',
  'ATOM      2  CA  MET A   1      12.560  13.401   9.447  1.00 20.00           C',
  'ATOM      3  N   GLY B   2      14.104  16.207   8.447  1.00 20.00           N',
  'HETATM    4  P   ATP B 201      17.100  11.000   5.000  1.00 20.00           P'
].join('\n')

const cif = [
  'data_demo',
  '#',
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_atom_id',
  '_atom_site.label_comp_id',
  '_atom_site.auth_asym_id',
  '_atom_site.auth_seq_id',
  '_atom_site.pdbx_PDB_model_num',
  'ATOM 1 N N MET A 1 1',
  'ATOM 2 C CA MET A 1 1',
  'HETATM 3 C C1 ATP B 201 1'
].join('\n')

const sdf = [
  'Ligand A',
  '  SciForge',
  '',
  '  3  2  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -1.2000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0  0  0  0',
  '  1  3  1  0  0  0  0',
  'M  END',
  '$$$$',
  'Ligand B',
  '  SciForge',
  '',
  '  2  1  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 Cl  0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.2000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0  0  0  0',
  'M  END',
  '$$$$'
].join('\n')

const mol = [
  'Single Mol',
  '  SciForge',
  '',
  '  2  1  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  2  0  0  0  0',
  'M  END'
].join('\n')

const mol2 = [
  '@<TRIPOS>MOLECULE',
  'Ligand One',
  '5 4 1 0 0',
  'SMALL',
  'USER_CHARGES',
  '@<TRIPOS>ATOM',
  '1 C1 0.0000 0.0000 0.0000 C.ar 1 LIG1 0.100',
  '2 O1 1.2000 0.0000 0.0000 O.2 1 LIG1 -0.200',
  '3 N1 -1.2000 0.0000 0.0000 N.am 1 LIG1 -0.100',
  '4 CL1 0.0000 1.5000 0.0000 Cl 1 LIG1 -0.050',
  '5 H1 0.0000 -1.0000 0.0000 H 1 LIG1 0.250',
  '@<TRIPOS>BOND',
  '1 1 2 ar',
  '2 1 3 1',
  '3 1 4 1',
  '4 1 5 1',
  '@<TRIPOS>SUBSTRUCTURE',
  '1 LIG1 1 GROUP 0 A **** 0 ROOT',
  '@<TRIPOS>MOLECULE',
  'Peptide Fragment',
  '2 1 1 0 0',
  'PROTEIN',
  'NO_CHARGES',
  '@<TRIPOS>ATOM',
  '1 N 0.0000 0.0000 0.0000 N.3 1 ALA1 0.000',
  '2 CA 1.4500 0.0000 0.0000 C.3 1 ALA1 0.000',
  '@<TRIPOS>BOND',
  '1 1 2 1',
  '@<TRIPOS>SUBSTRUCTURE',
  '1 ALA 1 RESIDUE 0 B **** 0 ROOT'
].join('\n')

const xyz = [
  '3',
  'water',
  'O 0.0000 0.0000 0.0000',
  'H 0.7570 0.5860 0.0000',
  'H -0.7570 0.5860 0.0000',
  '2',
  'hydrogen',
  'H 0.0000 0.0000 0.0000',
  'H 0.7400 0.0000 0.0000'
].join('\n')

const geometryXyz = [
  '4',
  'geometry',
  'C 1.0000 0.0000 0.0000',
  'N 0.0000 0.0000 0.0000',
  'O 0.0000 1.0000 0.0000',
  'H 0.0000 1.0000 1.0000'
].join('\n')

describe('workspace molecular engine', () => {
  it('summarizes PDB chains, residues, atoms, and ligands', () => {
    const preview = createWorkspaceMolecularPreview(workspaceMolecularPreviewInputSchema.parse({
      text: pdb,
      path: 'protein.pdb',
      mimeType: 'chemical/x-pdb'
    }))

    assert.equal(preview.format, 'pdb')
    assert.equal(preview.atomCount, 4)
    assert.equal(preview.residueCount, 3)
    assert.equal(preview.chainCount, 2)
    assert.equal(preview.ligandCount, 1)
    assert.equal(preview.modelCount, 1)
    assert.deepEqual(preview.chainIds, ['A', 'B'])
    assert.deepEqual(preview.ligands, ['ATP'])
    assert.deepEqual(preview.chains.map((chain) => [chain.id, chain.atomCount, chain.residueCount, chain.ligandCount]), [
      ['A', 2, 1, 0],
      ['B', 2, 2, 1]
    ])
    assert.equal(preview.atoms[0]?.element, 'N')
    assert.equal(preview.residues.find((residue) => residue.name === 'ATP')?.ligand, true)

    const observation = workspaceMolecularObservationSchema.parse(preview.observation)
    assert.equal(workspaceObservationSchema.parse(observation).view.pluginId, 'molecular')
    assert.equal(observation.selection?.kind, 'molecular')
    assert.equal(observation.selection?.atoms?.length, 4)
    assert.deepEqual(observation.actions, ['molecular.preview', 'molecular.workbench'])
  })

  it('summarizes mmCIF/CIF atom_site loops', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: cif,
      path: 'structure.cif',
      mimeType: 'chemical/x-mmcif'
    })

    assert.equal(preview.format, 'cif')
    assert.equal(preview.atomCount, 3)
    assert.equal(preview.residueCount, 2)
    assert.equal(preview.chainCount, 2)
    assert.equal(preview.ligandCount, 1)
    assert.equal(preview.modelCount, 1)
    assert.deepEqual(preview.chainIds, ['A', 'B'])
    assert.deepEqual(preview.ligands, ['ATP'])
    assert.deepEqual(preview.elementCounts, [
      { element: 'C', count: 2 },
      { element: 'N', count: 1 }
    ])
    assert.equal(workspaceObservationSchema.parse(preview.observation).molecular?.chains?.length, 2)

    const mmcifPreview = service.preview({
      text: cif,
      path: 'structure.mmcif'
    })
    assert.equal(mmcifPreview.format, 'mmcif')
  })

  it('summarizes SDF and MOL molecule records without hard-coded samples', () => {
    const service = new WorkspaceMolecularService()
    const sdfPreview = service.preview({
      text: sdf,
      path: 'library.sdf'
    })

    assert.equal(sdfPreview.format, 'sdf')
    assert.equal(sdfPreview.moleculeCount, 2)
    assert.equal(sdfPreview.modelCount, 2)
    assert.equal(sdfPreview.atomCount, 5)
    assert.deepEqual(sdfPreview.molecules.map((molecule) => [molecule.title, molecule.atomCount, molecule.bondCount, molecule.formula]), [
      ['Ligand A', 3, 2, 'CNO'],
      ['Ligand B', 2, 1, 'CCl']
    ])
    assert.deepEqual(sdfPreview.elementCounts, [
      { element: 'C', count: 2 },
      { element: 'Cl', count: 1 },
      { element: 'N', count: 1 },
      { element: 'O', count: 1 }
    ])
    assert.equal(workspaceObservationSchema.parse(sdfPreview.observation).molecular?.modelCount, 2)

    const molPreview = service.preview({
      text: mol,
      path: 'single.mol'
    })
    assert.equal(molPreview.format, 'mol')
    assert.equal(molPreview.moleculeCount, 1)
    assert.deepEqual(molPreview.molecules[0], {
      index: 1,
      title: 'Single Mol',
      atomCount: 2,
      bondCount: 1,
      formula: 'CO'
    })
  })

  it('summarizes Tripos MOL2 molecule, atom, bond, and substructure sections', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: mol2,
      path: 'mixed.mol2',
      mimeType: 'chemical/x-mol2'
    })

    assert.equal(preview.format, 'mol2')
    assert.equal(preview.moleculeCount, 2)
    assert.equal(preview.modelCount, 2)
    assert.equal(preview.atomCount, 7)
    assert.equal(preview.residueCount, 2)
    assert.equal(preview.chainCount, 2)
    assert.equal(preview.ligandCount, 1)
    assert.deepEqual(preview.chainIds, ['A', 'B'])
    assert.deepEqual(preview.ligands, ['LIG1'])
    assert.deepEqual(preview.molecules.map((molecule) => ({
      title: molecule.title,
      type: molecule.type,
      chargeType: molecule.chargeType,
      atomCount: molecule.atomCount,
      bondCount: molecule.bondCount,
      substructureCount: molecule.substructureCount,
      formula: molecule.formula
    })), [
      {
        title: 'Ligand One',
        type: 'SMALL',
        chargeType: 'USER_CHARGES',
        atomCount: 5,
        bondCount: 4,
        substructureCount: 1,
        formula: 'CHClNO'
      },
      {
        title: 'Peptide Fragment',
        type: 'PROTEIN',
        chargeType: 'NO_CHARGES',
        atomCount: 2,
        bondCount: 1,
        substructureCount: 1,
        formula: 'CN'
      }
    ])
    assert.deepEqual(preview.elementCounts, [
      { element: 'C', count: 2 },
      { element: 'Cl', count: 1 },
      { element: 'H', count: 1 },
      { element: 'N', count: 2 },
      { element: 'O', count: 1 }
    ])
    assert.deepEqual(preview.ligandSummaries, [
      { name: 'LIG1', atomCount: 5, residueCount: 1, chain: 'A', moleculeIndex: 1 }
    ])
    assert.equal(preview.residues.find((residue) => residue.name === 'LIG1')?.ligand, true)
    assert.equal(preview.residues.find((residue) => residue.name === 'ALA')?.ligand, undefined)
    assert.equal(preview.atoms.find((atom) => atom.name === 'CL1')?.element, 'Cl')

    const observation = workspaceMolecularObservationSchema.parse(preview.observation)
    assert.equal(workspaceObservationSchema.parse(observation).view.pluginId, 'molecular')
    assert.match(observation.visibleText ?? '', /MOL2 molecular preview/)
  })

  it('summarizes multi-record XYZ atoms and molecule counts', () => {
    const preview = createWorkspaceMolecularPreview(workspaceMolecularPreviewInputSchema.parse({
      text: xyz,
      path: 'frames.xyz'
    }))

    assert.equal(preview.format, 'xyz')
    assert.equal(preview.moleculeCount, 2)
    assert.equal(preview.modelCount, 2)
    assert.equal(preview.atomCount, 5)
    assert.equal(preview.residueCount, 0)
    assert.equal(preview.chainCount, 0)
    assert.deepEqual(preview.molecules.map((molecule) => [molecule.title, molecule.atomCount, molecule.formula]), [
      ['water', 3, 'H2O'],
      ['hydrogen', 2, 'H2']
    ])
    assert.deepEqual(preview.elementCounts, [
      { element: 'H', count: 4 },
      { element: 'O', count: 1 }
    ])
    assert.match(preview.observation?.visibleText ?? '', /2 molecules/)
    assert.equal(workspaceObservationSchema.parse(preview.observation).view.modality, 'molecular')
  })

  it('recognizes trajectory and density formats as safe metadata placeholders', () => {
    const service = new WorkspaceMolecularService()
    const trajectory = service.preview({
      text: '',
      path: 'simulation.xtc',
      size: 1024
    })
    const density = service.preview({
      text: '',
      path: 'map.ccp4',
      size: 2048
    })

    assert.equal(trajectory.format, 'xtc')
    assert.equal(trajectory.atomCount, 0)
    assert.equal(trajectory.modelCount, 0)
    assert.deepEqual(trajectory.observation?.molecular.representations, ['trajectory-placeholder'])
    assert.deepEqual(trajectory.observation?.actions, ['molecular.preview'])
    assert.match(trajectory.observation?.visibleText ?? '', /XTC molecular preview/)
    assert.match(trajectory.warnings.join(' '), /recognized but not decoded/)
    assert.equal(workspaceObservationSchema.parse(trajectory.observation).annotations?.[0]?.kind, 'warning')

    assert.equal(density.format, 'ccp4')
    assert.deepEqual(density.observation?.molecular.representations, ['density-placeholder'])
    assert.deepEqual(density.observation?.actions, ['molecular.preview'])
    assert.match(density.observation?.visibleText ?? '', /CCP4 molecular preview/)
    assert.match(density.warnings.join(' '), /density map files are recognized/)
  })

  it('selects PDB chains, ligands, and elements from bounded preview summaries', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: pdb,
      path: 'protein.pdb'
    })

    const chainSelection = service.workbench({
      preview,
      selection: {
        chains: ['B']
      }
    })
    assert.equal(chainSelection.atomCount, 2)
    assert.equal(chainSelection.residueCount, 2)
    assert.deepEqual(chainSelection.state.selection?.chains, ['B'])
    assert.deepEqual(chainSelection.ligands.map((ligand) => ligand.name), ['ATP'])

    const ligandSelection = service.workbench({
      preview,
      selection: {
        ligands: ['ATP']
      }
    })
    assert.equal(ligandSelection.atomCount, 1)
    assert.equal(ligandSelection.residues[0]?.name, 'ATP')
    assert.equal(ligandSelection.chains[0]?.id, 'B')
    assert.deepEqual(ligandSelection.state.selection?.ligands, ['ATP'])

    const elementSelection = service.workbench({
      preview,
      selection: {
        atoms: [{ element: 'n' }]
      }
    })
    assert.equal(elementSelection.atomCount, 2)
    assert.deepEqual(elementSelection.atoms.map((atom) => atom.id), ['1', '3'])
    assert.deepEqual(elementSelection.atoms.map((atom) => atom.element), ['N', 'N'])
  })

  it('selects MOL2 ligand and element summaries without a viewer dependency', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: mol2,
      path: 'mixed.mol2'
    })

    const ligandSelection = service.workbench({
      preview,
      selection: {
        ligands: ['lig1']
      }
    })
    assert.equal(ligandSelection.atomCount, 5)
    assert.equal(ligandSelection.chainCount, 1)
    assert.deepEqual(ligandSelection.state.selection?.chains, ['A'])
    assert.deepEqual(ligandSelection.state.selection?.ligands, ['LIG1'])

    const chlorideSelection = service.workbench({
      preview,
      selection: {
        atoms: [{ element: 'cl' }]
      }
    })
    assert.equal(chlorideSelection.atomCount, 1)
    assert.equal(chlorideSelection.atoms[0]?.name, 'CL1')
    assert.deepEqual(chlorideSelection.ligands.map((ligand) => ligand.name), ['LIG1'])
    assert.match(chlorideSelection.visibleText ?? '', /Elements: Cl:1/)
  })

  it('returns an explicit distance fallback when atom summaries do not carry coordinates', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: pdb,
      path: 'protein.pdb'
    })
    const noCoordinatePreview = {
      ...preview,
      atoms: preview.atoms.map(({ coordinates: _coordinates, ...atom }) => atom)
    }

    const measurement = service.workbench({
      preview: noCoordinatePreview,
      measurement: {
        kind: 'distance',
        atoms: [{ id: '1' }, { index: 2 }]
      }
    })

    assert.equal(measurement.state.measurement?.coordinateAvailable, false)
    assert.equal(measurement.state.measurement?.value, undefined)
    assert.equal(measurement.state.measurement?.unit, 'angstrom')
    assert.deepEqual(measurement.state.measurement?.selection.atoms?.map((atom) => atom.index), [1, 2])
    assert.match(measurement.visibleText ?? '', /unavailable/)
    assert.match(measurement.warnings.join('\n'), /coordinates/)
  })

  it('measures distance, angle, and dihedral through unified workbench state', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: geometryXyz,
      path: 'geometry.xyz'
    })

    const distance = service.workbench({
      preview,
      measurement: {
        kind: 'distance',
        atoms: [{ id: '1:1' }, { id: '1:2' }]
      }
    })
    const angle = service.workbench({
      preview,
      measurement: {
        kind: 'angle',
        atoms: [{ id: '1:1' }, { id: '1:2' }, { id: '1:3' }]
      }
    })
    const dihedral = service.workbench({
      preview,
      measurement: {
        kind: 'dihedral',
        atoms: [{ id: '1:1' }, { id: '1:2' }, { id: '1:3' }, { id: '1:4' }]
      }
    })

    assert.equal(distance.state.measurement?.kind, 'distance')
    assert.equal(distance.state.measurement?.coordinateAvailable, true)
    assert.equal(distance.state.measurement?.unit, 'angstrom')
    assert.equal(distance.state.measurement?.value, 1)
    assert.deepEqual(distance.state.measurement?.selection.atoms?.map((atom) => atom.id), ['1:1', '1:2'])
    assert.match(distance.visibleText ?? '', /Molecular distance/)

    assert.equal(angle.state.measurement?.kind, 'angle')
    assert.equal(angle.state.measurement?.unit, 'degree')
    assert.ok(angle.state.measurement?.value !== undefined)
    assert.ok(Math.abs(angle.state.measurement.value - 90) < 0.001)

    assert.equal(dihedral.state.measurement?.kind, 'dihedral')
    assert.equal(dihedral.state.measurement?.unit, 'degree')
    assert.ok(dihedral.state.measurement?.value !== undefined)
    assert.ok(Math.abs(Math.abs(dihedral.state.measurement.value) - 90) < 0.001)
  })

  it('can omit observations for callers that only need structured counts', () => {
    const service = new WorkspaceMolecularService()
    const preview = service.preview({
      text: xyz,
      path: 'frames.xyz',
      includeObservation: false
    })

    assert.equal(preview.moleculeCount, 2)
    assert.equal(preview.observation, undefined)
  })
})
