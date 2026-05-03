import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/report-viewer',
  moduleId: 'research-report-document',
  version: '1.0.0',
  title: 'Markdown report document',
  description: 'Readable Markdown/sectioned report renderer for research-report artifacts.',
  componentId: 'report-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['research-report'],
  acceptsArtifactTypes: ['research-report', 'markdown-report'],
  requiredAnyFields: [['markdown', 'sections', 'report', 'summary', 'content', 'dataRef']],
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
    readmePath: 'packages/ui-components/report-viewer/README.md',
    agentSummary: 'Use for research-report/markdown-report artifacts with markdown, sections, report, summary, content, or dataRef. Emits select-section/open-ref.',
  },
};
