import type { ComponentProps, ReactElement } from 'react'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useChatStore } from '../../store/chat-store'
import { collectComposerChangeSummary } from '../../lib/composer-change-summary'
import { FloatingComposer } from './FloatingComposer'
import type { WorkbenchComposerInput } from './workbench-composer-input'

type Props = Omit<
  ComponentProps<typeof FloatingComposer>,
  'input' | 'setInput' | 'changedFiles' | 'changedFileStats'
> & {
  composerInput: WorkbenchComposerInput
  /** Workspace root used to display paths in the changed-files summary. */
  changeSummaryWorkspaceRoot: string
}

export function WorkbenchComposer({
  composerInput,
  changeSummaryWorkspaceRoot,
  ...props
}: Props): ReactElement {
  const input = useStore(composerInput, (state) => state.input)
  // Subscribe here rather than in the Workbench root: `blocks` changes on
  // every streamed tool chunk and the summary is the only composer input
  // derived from it.
  const blocks = useChatStore((state) => state.blocks)
  // Session lock derives from the same subscription: the composer only
  // unbinds its execution runtime once a thread has actual content.
  const runtimeSessionLocked = useChatStore(
    (state) => Boolean(state.activeThreadId) && state.blocks.length > 0
  )
  const changeSummary = useMemo(
    () => collectComposerChangeSummary(blocks, changeSummaryWorkspaceRoot),
    [blocks, changeSummaryWorkspaceRoot]
  )
  return (
    <FloatingComposer
      {...props}
      runtimeSessionLocked={runtimeSessionLocked}
      input={input}
      setInput={composerInput.getState().setInput}
      changedFiles={changeSummary?.files}
      changedFileStats={changeSummary}
    />
  )
}
