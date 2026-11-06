/**
 * The single construction path for the Biology Room service.
 *
 * The built-in capability factory constructs its service here. Room state,
 * revisions, history, transaction recovery, and write locking all belong to
 * the one package-owned implementation in service.ts.
 */
import { BiologyRoomService } from './service.js'

export { BiologyRoomService }
export type { BiologyRoomServiceOptions } from './service.js'

export function createBiologyRoomService(): BiologyRoomService {
  return new BiologyRoomService()
}