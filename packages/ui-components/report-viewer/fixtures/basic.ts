import type { UIComponentRendererProps } from '../../types';
export { emptyReportViewerFixture } from './empty';

export const basicReportViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'report-viewer', title: 'Compact research report' },
  artifact: {
    id: 'report-ifnb-mini',
    type: 'research-report',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    data: {
      title: 'IFN beta response summary',
      markdown: [
        '# IFN beta response summary',
        '',
        'Three interferon-stimulated genes pass the mini-demo threshold of adjusted p-value < 0.05.',
        '',
        '| Gene | Direction | Interpretation |',
        '| --- | --- | --- |',
        '| IFIT1 | up | canonical interferon-stimulated marker |',
        '| MX1 | up | antiviral GTPase induced by type I interferon |',
      ].join('\n'),
    },
  },
};

export default basicReportViewerFixture;
