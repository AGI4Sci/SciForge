import React from 'react'
import { createRoot } from 'react-dom/client'
import { FolderOpen } from 'lucide-react'
import '../../../src/renderer/src/index.css'
import '../../../src/renderer/src/styles/base-shell.css'
import i18n from '../../../src/renderer/src/i18n'
import { RemoteWorkspaceSelectorView } from '../../../src/renderer/src/components/chat/RemoteWorkspaceSelector'
import { WorkbenchTopBar } from '../../../src/renderer/src/components/chat/WorkbenchTopBar'
import { InitialSessionUsageHeatmapView } from '../../../src/renderer/src/components/chat/InitialSessionUsageHeatmap'
Object.assign(window, { previewI18n: i18n })
i18n.changeLanguage('en')
const actions = Array.from({ length: 12 }, (_, i) => ({
  id: `test-${i}`,
  contribution: {
    commandId: `test-${i}`,
    label: `Tool ${i + 1}`,
    icon: FolderOpen,
    isAvailable: () => true,
    isActive: () => i === 9,
    attention: i === 11
  }
}))
function Preview() {
  return (
    <div className="ds-chat-stage" style={{ width: '100%', padding: 16 }}>
      <header className="chat-topbar">
        <div className="chat-topbar-grid grid w-full min-w-0 gap-2.5">
          <div className="chat-topbar-session">default</div>
          <div className="chat-topbar-actions flex gap-2 items-center">
            <RemoteWorkspaceSelectorView
              workspaces={[]}
              selectedWorkspaceHostId={null}
              onWorkspaceChange={() => {}}
            />
            <WorkbenchTopBar
              focusedRightPanelMode={null}
              onToggleFocusedRightPanelMode={(mode) => {
                Object.assign(window, { lastAction: mode })
              }}
              toolbarActions={actions}
              onExecuteToolbarCommand={(id) => {
                Object.assign(window, { lastAction: id })
              }}
              workspaceRoot="/workspace"
            />
          </div>
        </div>
      </header>
      <div id="card-host" style={{ maxWidth: 900, margin: '40px auto' }}>
        <InitialSessionUsageHeatmapView
          state={{ usage: null, loading: false, loaded: true, error: null }}
        />
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Preview />)
