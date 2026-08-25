// @ts-expect-error The canonical JavaScript test adapter intentionally has no production declaration surface.
import { FakeCollaborationRepository } from '../../../../test-fixtures/collaboration/fake-adapters.mjs'

export class IdentityFakeRepository extends FakeCollaborationRepository {
  declare state: Record<string, any>
  private tail: Promise<unknown> = Promise.resolve()

  constructor() {
    super()
  }

  transaction<T>(work: (repository: this) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => super.transaction(work))
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

}
