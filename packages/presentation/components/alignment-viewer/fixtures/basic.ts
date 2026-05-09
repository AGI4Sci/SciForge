import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicAlignmentViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'alignment-viewer',
    props: { colorScheme: 'clustal', showConsensus: true, highlightColumns: [14] },
  },
  artifact: {
    id: 'alignment-spike-rbd-mini',
    type: 'sequence-alignment',
    producerScenario: 'mafft-alignment-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'spike-rbd-mini-alignment',
      title: 'Spike RBD motif alignment',
      alphabet: 'protein',
      aligned: true,
      sequences: [
        { id: 'wuhan_hu_1', label: 'Wuhan-Hu-1', sequence: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV' },
        { id: 'variant_a', label: 'Variant A', sequence: 'NITNLCPFGEVFNASRFASVYAWNRKRISNCV' },
        { id: 'variant_b', label: 'Variant B', sequence: 'NITNLCPFGEVF---RFASVYAWNRKRISNCV' },
      ],
      consensus: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV',
      metadata: {
        method: 'MAFFT preview subset',
        selectedColumn: 14,
        note: 'One substitution and one gap block keep the fixture compact but biologically plausible.',
      },
    },
  },
};
