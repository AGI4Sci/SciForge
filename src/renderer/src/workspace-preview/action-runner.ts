import type { WorkspaceObservation, WorkspaceStructuredSelection } from '@shared/workspace-preview'
import type {
  WorkspacePreviewActionContribution,
  WorkspacePreviewActionRunResult,
  WorkspacePreviewToolbarAction
} from './registry'
import type { WorkspacePreviewPanelShellContext } from './WorkspacePreviewPanelShell'

export type WorkspacePreviewActionInputBuilder = (
  observation: WorkspaceObservation
) => Record<string, unknown> | null

export type WorkspacePreviewSelectionExtractor = (result: unknown) => WorkspaceStructuredSelection | null

export function createInvokeWorkspacePreviewAction(input: {
  id: string
  label: string
  buildInput?: WorkspacePreviewActionInputBuilder
  extractSelection?: WorkspacePreviewSelectionExtractor
  requiresExplicitUi?: boolean
}): WorkspacePreviewActionContribution {
  return {
    id: input.id,
    label: input.label,
    requiresExplicitUi: input.requiresExplicitUi,
    run: async (context) => {
      const session = context.state.session
      if (!session) return missingSession(input.id)
      const observation = context.state.observation
      if (input.buildInput && !observation) {
        return failure(input.id, 'missing-observation', `Action ${input.id} needs a workspace observation before it can run.`)
      }
      const actionInput = input.buildInput && observation ? input.buildInput(observation) : {}
      if (!actionInput) {
        return failure(
          input.id,
          'missing-selection',
          `Action ${input.id} needs a current selection or visible preview detail before it can run.`
        )
      }

      const result = await context.host.invokeAction(session.id, {
        actionId: input.id,
        input: actionInput
      })
      if (!result.ok) return failure(input.id, 'bridge', result.message)

      const selection = input.extractSelection?.(result.result) ?? null
      const selectionResult = selection
        ? await context.host.setSelection(selection, { sessionId: session.id, path: session.path })
        : undefined
      if (selectionResult && !selectionResult.ok) {
        return failure(input.id, 'bridge', selectionResult.message)
      }

      return {
        ok: true,
        kind: 'invoke-action',
        actionId: input.id,
        result,
        selectionResult
      }
    }
  }
}

export function createSetSelectionWorkspacePreviewAction(
  id = 'workspace.setSelection',
  label = 'Select'
): WorkspacePreviewActionContribution {
  return {
    id,
    label,
    run: async (context) => {
      const session = context.state.session
      if (!session) return missingSession(id)
      const selection = context.state.observation?.selection ?? session.selection
      if (!selection) return failure(id, 'missing-selection', 'No structured selection is available to apply.')

      const result = await context.host.setSelection(selection, {
        sessionId: session.id,
        path: session.path
      })
      return result.ok
        ? { ok: true, kind: 'set-selection', actionId: id, result }
        : failure(id, 'bridge', result.message)
    }
  }
}

export function createExportWorkspacePreviewAction(format: string): WorkspacePreviewActionContribution {
  const id = `workspace.export:${format}`
  return {
    id,
    label: `Export ${format.toUpperCase()}`,
    run: async (context) => {
      const session = context.state.session
      if (!session) return missingSession(id)
      const result = await context.host.export(session.id, { kind: 'workspace-file', format })
      return result.ok
        ? { ok: true, kind: 'export', actionId: id, result }
        : failure(id, 'bridge', result.message)
    }
  }
}

export function createUiWorkspacePreviewAction(input: {
  id: string
  label: string
  run?: (context: WorkspacePreviewPanelShellContext) => void | Promise<void>
  requiresExplicitUi?: boolean
}): WorkspacePreviewActionContribution {
  return {
    id: input.id,
    label: input.label,
    requiresExplicitUi: input.requiresExplicitUi,
    run: async (context) => {
      if (input.requiresExplicitUi || !input.run) {
        return failure(input.id, 'unsupported', 'This action needs a dedicated editor control before it can run.')
      }
      await input.run(context)
      return { ok: true, kind: 'ui', actionId: input.id }
    }
  }
}

export async function runWorkspacePreviewToolbarAction(
  action: WorkspacePreviewToolbarAction,
  context: WorkspacePreviewPanelShellContext
): Promise<WorkspacePreviewActionRunResult> {
  if (!action.enabled) {
    return failure(action.id, 'unsupported', action.reason ?? `Action ${action.id} is disabled.`)
  }
  return action.contribution.run(context)
}

function missingSession(actionId: string): WorkspacePreviewActionRunResult {
  return failure(actionId, 'missing-session', 'Open a workspace preview session before running preview actions.')
}

function failure(
  actionId: string,
  reason: Extract<WorkspacePreviewActionRunResult, { ok: false }>['reason'],
  message: string
): WorkspacePreviewActionRunResult {
  return { ok: false, actionId, reason, message }
}
