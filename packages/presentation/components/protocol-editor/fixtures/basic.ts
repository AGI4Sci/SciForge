import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicProtocolEditorFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'protocol-editor',
    props: { mode: 'edit', showMaterials: true, showParameters: true },
  },
  artifact: {
    id: 'protocol-if-staining',
    type: 'protocol',
    producerScenario: 'protocol-draft-editor',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'if-staining-protocol',
      title: 'Ki67 immunofluorescence staining',
      designType: 'protocol',
      revision: 'r1',
      materials: [
        { id: 'pfa', name: '4% paraformaldehyde', storage: '4 C' },
        { id: 'anti-ki67', name: 'anti-Ki67 primary antibody', dilution: '1:500' },
      ],
      parameters: { fixationMinutes: 10, primaryIncubationMinutes: 60, washBuffer: 'PBS-T' },
      steps: [
        { id: 'fix', order: 1, title: 'Fix cells', duration: '10 min', params: { reagent: '4% PFA' } },
        { id: 'block', order: 2, title: 'Block non-specific binding', duration: '30 min', params: { buffer: '5% BSA in PBS-T' } },
        { id: 'stain', order: 3, title: 'Primary antibody incubation', duration: '60 min', params: { antibody: 'anti-Ki67', dilution: '1:500' } },
      ],
    },
  },
};
