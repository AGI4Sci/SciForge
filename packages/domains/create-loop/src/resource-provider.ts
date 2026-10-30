import type { ReactElement } from 'react'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { WorkflowNodeRunResultV1, WorkflowNodeV1 } from './contract.js'

export const CREATE_LOOP_RESOURCE_PROVIDER_KIND =
  'renderer.extension' as const
export const CREATE_LOOP_RESOURCE_PALETTE_LOCATION =
  'create-loop.resource-palette' as const

export type CreateLoopResourceDescriptor = Readonly<{
  id: string
  name: string
  nameKey?: string
  description?: string
  detail?: string
  role?: 'data-source' | 'operation'
  paletteVisibility?: 'visible' | 'hidden'
  data: DomainPackageJsonValue
}>

export type CreateLoopResourceNode = Extract<WorkflowNodeV1, { type: 'resource' }>

export type CreateLoopResourceNodeConfigContext = Readonly<{
  node: CreateLoopResourceNode
  workspaceRoot: string
  lastResult: WorkflowNodeRunResultV1 | null
  onChange: (node: CreateLoopResourceNode) => void
}>

export type CreateLoopResourceProvider = Readonly<{
  id: string
  title: string
  loadResources: (workspaceRoot: string) => Promise<readonly CreateLoopResourceDescriptor[]>
  createNode: (
    resource: CreateLoopResourceDescriptor,
    position: Readonly<{ x: number; y: number }>
  ) => CreateLoopResourceNode
  renderNodeConfig: (context: CreateLoopResourceNodeConfigContext) => ReactElement
}>

export function isCreateLoopResourceProvider(
  value: unknown
): value is CreateLoopResourceProvider {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CreateLoopResourceProvider>
  return typeof candidate.id === 'string' && candidate.id.length > 0 &&
    typeof candidate.title === 'string' && candidate.title.length > 0 &&
    typeof candidate.loadResources === 'function' &&
    typeof candidate.createNode === 'function' &&
    typeof candidate.renderNodeConfig === 'function'
}
