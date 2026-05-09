import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicPaperCardListFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'paper-card-list',
    transform: [{ type: 'limit', value: 3 }],
  },
  artifact: {
    id: 'paper-list-interferon-single-cell',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      query: 'single-cell RNA-seq interferon response benchmarking',
      papers: [
        {
          id: 'paper-svensson-2018-exponential',
          title: 'Exponential scaling of single-cell RNA-seq in the past decade',
          source: 'Nature Protocols',
          year: 2018,
          authors: ['Valentine Svensson', 'Rosvall Lab'],
          evidenceLevel: 'review',
          target: 'single-cell RNA-seq',
          url: 'https://doi.org/10.1038/nprot.2017.149',
        },
        {
          id: 'paper-wolf-2018-scanpy',
          title: 'SCANPY: large-scale single-cell gene expression data analysis',
          source: 'Genome Biology',
          year: 2018,
          authors: ['F. Alexander Wolf', 'Philipp Angerer', 'Fabian J. Theis'],
          evidenceLevel: 'software',
          target: 'single-cell analysis',
          url: 'https://doi.org/10.1186/s13059-017-1382-0',
        },
        {
          id: 'paper-love-2014-deseq2',
          title: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
          source: 'Genome Biology',
          year: 2014,
          authors: ['Michael I. Love', 'Wolfgang Huber', 'Simon Anders'],
          evidenceLevel: 'method',
          target: 'differential expression',
          url: 'https://doi.org/10.1186/s13059-014-0550-8',
        },
      ],
    },
  },
};
