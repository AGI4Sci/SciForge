import { createStore } from 'zustand/vanilla'

// Owned by one workbench. Only its composer subscribes; send actions read the
// current value synchronously, without making each keystroke render the shell.
export function createWorkbenchComposerInput() {
  return createStore<{
    input: string
    setInput: (input: string) => void
  }>((set) => ({
    input: '',
    setInput: (input) => set((state) => state.input === input ? state : { input })
  }))
}

export type WorkbenchComposerInput = ReturnType<typeof createWorkbenchComposerInput>
