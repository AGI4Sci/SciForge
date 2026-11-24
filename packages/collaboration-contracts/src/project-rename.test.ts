import { describe, expect, it } from 'vitest'
import { restRequestSchema, agentInboxPayloadSchema } from './protocol.js'

const command = { protocolVersion: '1.0', requestId: 'req_RenameProject001', type: 'project.rename',
  idempotencyKey: 'idem_rename_project_001', projectId: 'prj_RenameProject001', expectedRevision: 1, displayName: '  Revised project  ' }

describe('Project rename protocol', () => {
  it('normalizes a nonempty bounded name with revision checking', () => {
    expect(restRequestSchema.parse(command)).toMatchObject({ displayName: 'Revised project' })
    for (const displayName of ['', '   ', 'x'.repeat(201)]) {
      expect(restRequestSchema.safeParse({ ...command, displayName }).success).toBe(false)
    }
    expect(restRequestSchema.safeParse({ ...command, expectedRevision: 0 }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...command, ownerUserId: 'usr_NotAllowed001' }).success).toBe(false)
  })
  it('announces a project refresh without starting work', () => {
    expect(agentInboxPayloadSchema.parse({ protocolVersion: '1.0', type: 'project.updated',
      projectId: command.projectId, revision: 2 })).toMatchObject({ type: 'project.updated' })
  })
})
