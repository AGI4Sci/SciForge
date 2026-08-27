import { randomUUID } from 'node:crypto'

export function collaborationRequestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}

