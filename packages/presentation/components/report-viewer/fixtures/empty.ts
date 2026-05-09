import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyReportViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'report-viewer', title: 'Empty report shell', props: {} },
  artifact: {
    id: 'report-empty',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'Report generated without inline markdown' },
    data: {},
  },
};

export default emptyReportViewerFixture;
