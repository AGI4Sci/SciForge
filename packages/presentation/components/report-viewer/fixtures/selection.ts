import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionReportViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'report-viewer',
    title: 'Selected report section',
    props: {
      selectedSectionId: 'methods',
      selectionEvent: { type: 'select-section', sectionId: 'methods' },
    },
  },
  artifact: {
    id: 'report-selection',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'Mini literature synthesis' },
    data: {
      title: 'Mini literature synthesis',
      sections: [
        { id: 'summary', title: 'Summary', content: 'Type I interferon signaling consistently induces IFIT1 and MX1 across reviewed datasets.' },
        { id: 'methods', title: 'Methods', content: 'The demo combines two curated abstracts and one differential-expression table; no external resources are loaded.' },
      ],
      references: [{ id: 'paper:ifn-review-2024', title: 'Type I interferon response review' }],
    },
  },
};

export default selectionReportViewerFixture;
