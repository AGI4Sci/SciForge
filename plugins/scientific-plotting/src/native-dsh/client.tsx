import { useMemo, useState, type ComponentType } from 'react'
import { FiguresPanel, type FiguresClient } from '../ui/FiguresPanel.js'
import type { CodeRunsTransport } from '../ui/CodeRunsPanel.js'
import { createFiguresClient } from '../sciforge/figures-client.js'

/** Structural subset of the deployed DSH remote commands and slots contracts.
 * Slot evidence: acceptance/host-api-evidence/dsh-client-ui-conversation--lib--client.js,
 * conversation.composer.dock (session scope) and register({ inject(sessionId) }, Component).
 */
export interface ScientificFiguresClientContext {
  remote: {
    commands: {
      execute(sessionId: string, line: string, attachments: readonly unknown[]): Promise<
        | { ok: true; value?: { commandId: string; result: { kind: 'success' | 'error'; text?: string } } }
        | { ok: false; error: { code: string; message: string } }
      >
    }
  }
  slots: {
    inject(name: string, register: () => unknown): unknown
    register(options: { name: string; id: string; order: number; inject: (sessionId: string) => { sessionId: string } }, component: ComponentType<{ sessionId: string }>): unknown
  }
}

/** Uses the formal user-command path. No tool impersonation, transport, or confirmation token. */
export function createNativeFiguresClient(ctx: Pick<ScientificFiguresClientContext, 'remote'>, sessionId: string): FiguresClient & { call: CodeRunsTransport } {
  const invoke = async <T,>(action: string, input: unknown): Promise<T> => {
    const result = await ctx.remote.commands.execute(sessionId, `/scientific-figures ${JSON.stringify({ action, input })}`, [])
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    if (!result.value) throw new Error('DSH 未注册 /scientific-figures 命令。请检查插件是否启用。')
    const command = result.value.result
    if (command.kind === 'error') throw new Error(command.text ?? '科研图件命令失败。')
    if (command.text === undefined) throw new Error('科研图件命令没有返回结果。')
    return JSON.parse(command.text) as T
  }
  return createFiguresClient(invoke)
}

export default {
  inject: ['slots', 'remote'],
  apply(ctx: ScientificFiguresClientContext): void {
    function SessionFiguresDock({ sessionId }: { sessionId: string }): React.JSX.Element {
      const [open, setOpen] = useState(false)
      const client = useMemo(() => createNativeFiguresClient(ctx, sessionId), [sessionId])
      return <section aria-label="科研图件" style={{ width: '100%', minWidth: 0, color: 'inherit' }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} style={{ padding: '8px 12px', color: 'inherit', background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit' }}>科研图件 {open ? '▾' : '▸'}</button>
        {open && <div style={{ height: 'min(76vh, 850px)', minHeight: 380, overflow: 'auto' }}>
          <FiguresPanel key={sessionId} client={client} codeRunsCall={client.call} />
        </div>}
      </section>
    }
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock', id: 'scientific-figures', order: 30,
      inject: sessionId => ({ sessionId })
    }, SessionFiguresDock))
  }
}
