import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionAlignmentViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'alignment-viewer',
    props: { colorScheme: 'clustal', showConsensus: true, highlightColumns: [14] },
  },
  artifact: {
    id: 'alignment-spike-rbd-selection',
    type: 'sequence-alignment',
    producerScenario: 'mafft-alignment-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'spike-rbd-mini-selection',
      title: 'Spike RBD selected alignment column',
      alphabet: 'protein',
      aligned: true,
      sequences: [
        { id: 'wuhan_hu_1', label: 'Wuhan-Hu-1', sequence: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV' },
        { id: 'variant_a', label: 'Variant A', sequence: 'NITNLCPFGEVFNASRFASVYAWNRKRISNCV' },
        { id: 'variant_b', label: 'Variant B', sequence: 'NITNLCPFGEVF---RFASVYAWNRKRISNCV' },
      ],
      consensus: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV',
      metadata: { selectedColumn: 14, selectedSequenceId: 'variant_a' },
    },
  },
};
