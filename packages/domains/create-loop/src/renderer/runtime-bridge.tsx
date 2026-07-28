import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
  type ReactElement
} from 'react'
import type {
  WorkflowApprovalDecision,
  WorkflowCodeLanguage,
  WorkflowSettingsPatchV1
} from '../contract.js'
import { mergeWorkflowSettings } from '../workflow-settings.js'
import type { CreateLoopCapabilityClient } from './capability-client.js'

export type CreateLoopRendererSettings = Readonly<{
  workspaceRoot: string
  workflow: import('../contract.js').WorkflowSettingsV1
}>

export type CreateLoopRuntimeBridge = Readonly<{
  getSettings: () => Promise<CreateLoopRendererSettings>
  setSettings: (patch: Readonly<{ workflow?: WorkflowSettingsPatchV1 }>) =>
    Promise<CreateLoopRendererSettings>
  getWorkflowStatus: () => ReturnType<CreateLoopCapabilityClient['status']>
  runWorkflow: (workflowId: string, input?: unknown) =>
    ReturnType<CreateLoopCapabilityClient['run']>
  stopWorkflow: (workflowId: string) => ReturnType<CreateLoopCapabilityClient['stop']>
  resolveWorkflowApproval: (token: string, decision: WorkflowApprovalDecision) =>
    Promise<{ ok: boolean }>
  runWorkflowNode: (workflowId: string, nodeId: string) =>
    ReturnType<CreateLoopCapabilityClient['runNode']>
  testWorkflowNode: (workflowId: string, nodeId: string, mockJson: string) =>
    ReturnType<CreateLoopCapabilityClient['testNode']>
  checkWorkflowCode: (language: WorkflowCodeLanguage, code: string) =>
    ReturnType<CreateLoopCapabilityClient['checkCode']>
}>

const RuntimeContext = createContext<CreateLoopRuntimeBridge | null>(null)

export function CreateLoopRuntimeProvider({
  children,
  client,
  workspaceRoot
}: PropsWithChildren<{
  client: CreateLoopCapabilityClient
  workspaceRoot: string
}>): ReactElement {
  const bridge = useMemo<CreateLoopRuntimeBridge>(() => {
    let revision: number | undefined
    return Object.freeze({
      getSettings: async () => {
        const snapshot = await client.read(workspaceRoot)
        revision = snapshot.revision
        return { workspaceRoot, workflow: snapshot.settings }
      },
      setSettings: async (patch) => {
        const current = await client.read(workspaceRoot)
        const next = mergeWorkflowSettings(current.settings, patch.workflow)
        const snapshot = await client.save(workspaceRoot, next, revision ?? current.revision)
        revision = snapshot.revision
        return { workspaceRoot, workflow: snapshot.settings }
      },
      getWorkflowStatus: () => client.status(workspaceRoot),
      runWorkflow: (workflowId, input) => client.run(workspaceRoot, workflowId, input),
      stopWorkflow: (workflowId) => client.stop(workspaceRoot, workflowId),
      resolveWorkflowApproval: async (token, decision) => {
        const result = await client.resolveApproval(workspaceRoot, token, decision)
        return { ok: result.resolved }
      },
      runWorkflowNode: (workflowId, nodeId) =>
        client.runNode(workspaceRoot, workflowId, nodeId),
      testWorkflowNode: (workflowId, nodeId, mockJson) =>
        client.testNode(workspaceRoot, workflowId, nodeId, mockJson),
      checkWorkflowCode: (language, code) =>
        client.checkCode(workspaceRoot, language, code)
    })
  }, [client, workspaceRoot])
  return <RuntimeContext.Provider value={bridge}>{children}</RuntimeContext.Provider>
}

export function useCreateLoopRuntime(): CreateLoopRuntimeBridge {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('Create Loop renderer is missing its runtime provider.')
  return runtime
}
