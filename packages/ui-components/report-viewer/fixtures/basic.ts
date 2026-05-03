import type { UIComponentRendererProps } from '../../types';

export const emptyReportViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'report-viewer', props: {} },
};

export const basicReportViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'report-viewer' },
  artifact: {
    id: 'report-1',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      markdown: '# Literature Report\n\nA compact result summary.',
    },
  },
};
