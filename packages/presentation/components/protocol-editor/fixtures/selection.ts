import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionProtocolEditorFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'protocol-editor',
    props: { mode: 'edit', selectedStepId: 'stain', showParameters: true },
  },
  artifact: {
    id: 'protocol-if-staining-selection',
    type: 'protocol',
    producerScenario: 'protocol-draft-editor',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'if-staining-protocol-selection',
      title: 'Selected antibody incubation step',
      designType: 'protocol',
      revision: 'r1',
      steps: [
        { id: 'stain', order: 3, title: 'Primary antibody incubation', duration: '60 min', selected: true, params: { antibody: 'anti-Ki67', dilution: '1:500' } },
      ],
      pendingPatch: { op: 'replace', path: '/steps/stain/params/dilution', value: '1:250' },
    },
  },
};
