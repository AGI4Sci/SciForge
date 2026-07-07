import { AppErrorBoundary } from './components/AppErrorBoundary'
import AppShell from './AppShell'

export default function App(): React.ReactElement {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  )
}
