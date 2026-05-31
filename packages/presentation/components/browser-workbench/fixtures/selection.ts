import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionBrowserWorkbenchFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'browser-workbench',
    props: {
      previewUrl: 'http://localhost:5173/',
      commands: [
        { label: 'Open', command: '/browser open "http://localhost:5173/" --surface workbench', risk: 'allowed' },
        { label: 'Takeover', command: '/browser takeover --url "http://localhost:5173/" --approval required', risk: 'needs-approval' },
      ],
    },
  },
  artifact: {
    id: 'browser-runtime-selection',
    type: 'browser-session',
    producerScenario: 'browser-runtime',
    schemaVersion: '0.1.0',
    data: {
      session: {
        id: 'browser-session-selection',
        mode: 'visible-takeover',
        providerId: 'sciforge.observe.browser-runtime',
        activeTabId: 'tab-1',
        tabs: [
          { id: 'tab-1', url: 'http://localhost:5173/', title: 'SciForge', status: 'ready' },
        ],
      },
      notes: ['Visible takeover requires TUI-host approval before account or clipboard actions.'],
    },
  },
};
