import { createRoot } from 'react-dom/client'
import { FiguresPanel } from '../ui/FiguresPanel.js'
import { createFiguresClient } from './figures-client.js'
import { createPanelBridge, type PanelBinding } from './bridge.js'
import { plotRequestMessage } from './plot-request.js'
import './shell.css'

const container = document.getElementById('root')
if (!container) throw new Error('Scientific Figures root is missing.')
const root = createRoot(container)
let client: ReturnType<typeof createFiguresClient>
function render(binding: PanelBinding | null): void {
  if (!binding?.workspaceRoot) {
    root.render(<p className="sciforge-panel-status" role="status">请选择工作区以使用科研图件。</p>)
    return
  }
  // Remount on a host binding change so async work/drafts cannot cross workspaces.
  const key = JSON.stringify(binding)
  root.render(<FiguresPanel key={key} client={client} codeRunsCall={client.call} onPickFile={() => bridge.pickFile()} onSendRequest={input => bridge.sendMessage(
    plotRequestMessage(input),
    input.text
  )} onRequestAcceptance={input => bridge.sendMessage(
    `请通过已安装的 scientific-figures.operation 实际执行以下接受请求，等待宿主正式一次性审批；不得伪造审批字段。批准后读取文档核实结果。${JSON.stringify({ action: 'acceptCandidate', input })}`,
    '申请接受候选图：请在会话中确认审批。'
  )} />)
}
const bridge = createPanelBridge(window, render)
client = createFiguresClient(bridge.call)
render(null)
window.addEventListener('pagehide', () => { bridge.dispose(); root.unmount() }, { once: true })
