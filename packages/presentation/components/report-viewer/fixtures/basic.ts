import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
export { emptyReportViewerFixture } from './empty';

export const basicReportViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'report-viewer', title: 'Compact research report' },
  artifact: {
    id: 'report-ifnb-mini',
    type: 'research-report',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report-ifnb-mini',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/workbench/literature-report.md',
      previewPolicy: 'inline',
    },
  },
  input: {
    kind: 'markdown',
    ref: '.sciforge/workbench/literature-report.md',
    title: 'Literature Report',
    mediaType: 'text/markdown',
    extension: 'md',
    previewPolicy: 'inline',
  },
};

export default basicReportViewerFixture;
