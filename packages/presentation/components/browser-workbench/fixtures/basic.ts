import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicBrowserWorkbenchFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'browser-workbench',
    title: 'Browser workbench',
  },
  artifact: {
    id: 'browser-runtime-demo',
    type: 'browser-runtime-projection',
    producerScenario: 'browser-runtime',
    schemaVersion: '0.1.0',
    data: {
      session: {
        id: 'browser-session-demo',
        mode: 'agent-headless',
        providerId: 'sciforge.observe.browser-runtime',
        activeTabId: 'tab-1',
        tabs: [
          { id: 'tab-1', url: 'http://localhost:5173/', title: 'SciForge', status: 'ready' },
          { id: 'tab-2', url: 'https://example.org', title: 'Example', status: 'ready' },
        ],
      },
      snapshot: {
        schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
        url: 'http://localhost:5173/',
        title: 'SciForge',
        textPreview: 'SciForge browser runtime projection demo.',
        screenshotRef: 'blob://browser/demo-screenshot.png',
        domSnapshotRef: 'blob://browser/demo-dom.json',
        consoleLogRef: 'blob://browser/demo-console.jsonl',
      },
      traceRefs: [
        { kind: 'screenshot', ref: 'blob://browser/demo-screenshot.png' },
        { kind: 'dom-snapshot', ref: 'blob://browser/demo-dom.json' },
      ],
    },
  },
};
