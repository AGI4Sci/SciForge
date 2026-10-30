import type { ReactElement } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { DomainWorkbenchMainAreaReturnTarget } from '@sciforge/domain-sdk/host'

/** The package supplies the label and opaque target; the Host owns Session navigation. */
export function WorkbenchSessionReturn({ target, onReturn }: {
  target: DomainWorkbenchMainAreaReturnTarget
  onReturn: (target: DomainWorkbenchMainAreaReturnTarget) => void
}): ReactElement {
  return <div className="ds-no-drag shrink-0 px-3 py-2 sm:px-4">
    <button
      type="button"
      data-testid="session-return-to-domain"
      className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-accent"
      onClick={() => onReturn(target)}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {target.label}
    </button>
  </div>
}
