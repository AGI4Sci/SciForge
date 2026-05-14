import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/report-viewer',
  moduleId: 'research-report-document',
  version: '1.0.0',
  title: 'Markdown report document',
  description: 'Readable Markdown/sectioned report renderer for research-report artifacts.',
  componentId: 'report-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['research-report'],
  acceptsArtifactTypes: ['research-report', 'markdown-report', 'analysis-plan', 'figure-reproduction-report', 'claim-verdict', 'negative-result-report', 'trajectory-training-record'],
  consumes: [
    {
      kinds: ['markdown'],
      mediaTypes: ['text/markdown'],
      extensions: ['md', 'markdown'],
      previewPolicies: ['inline'],
    },
  ],
  viewParams: ['layoutMode', 'sectionFilter'],
  interactionEvents: ['select-section', 'open-ref'],
  roleDefaults: ['experimental-biologist', 'pi', 'bioinformatician'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 10,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['reportId', 'report_id', 'documentId', 'document_id', 'title', 'dataRef', 'path', 'outputRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/report-viewer/README.md',
    agentSummary: 'Use for report-like artifacts with markdown, sections, report, summary, content, or dataRef, including reproduction reports, claim verdicts, negative result reports, trajectory records, and analysis plans. Emits select-section/open-ref.',
  },
  workbenchDemo: {
    artifactType: 'research-report',
    artifactData: {
      title: 'Demo research report',
      markdown: ['# Demo report', '', '这是 **组件工作台** 内置示例，用于确认 Markdown 渲染可用。', '', '- 条目 A', '- 条目 B'].join('\n'),
      sections: [
        { title: '摘要', content: '结构化 sections 与 markdown 二选一或并存时，预览应仍能展示正文。' },
        { title: '方法', markdown: '示例流程：`QC → align → quantify`（演示用语）。' },
      ],
    },
  },
};
