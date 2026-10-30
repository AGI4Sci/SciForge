// Client-only projection fixtures; server authentication/repository fixtures remain in SciForge-cloud.
function copy(value) { return value === undefined ? undefined : structuredClone(value) }


export class FakeAgentExecutionHost {
  constructor() {
    this.requests = []
    this.pending = []
  }

  run = (request) => {
    this.requests.push(copy(request))
    const index = this.requests.length
    return new Promise((resolve, reject) => {
      this.pending.push({ request: copy(request), index, resolve, reject })
    })
  }

  completeNext({ text = 'fake final reply', state = 'completed', runtimeId, threadId } = {}) {
    const pending = this.pending.shift()
    if (!pending) throw new Error('fake execution host has no pending turn')
    pending.resolve({
      runtimeId: runtimeId ?? pending.request.runtimeId ?? 'fake-runtime',
      threadId: threadId ?? pending.request.threadId ?? 'fake-created-thread',
      turnId: `fake-turn-${pending.index}`,
      state,
      text
    })
  }

  failNext(error = new Error('fake execution failure')) {
    const pending = this.pending.shift()
    if (!pending) throw new Error('fake execution host has no pending turn')
    pending.reject(error)
  }
}

export class FakeProjectionOutbox {
  constructor() {
    this.deliveries = []
    this.failure = null
  }

  async enqueueProjectionDelivery(command, idempotencyKey) {
    if (this.failure) throw this.failure
    this.deliveries.push(copy({ command, idempotencyKey }))
  }
}

export class FakeAgentThreadsHost {
  constructor() {
    this.threads = new Map()
  }

  setTurn({ runtimeId, threadId, turnId, messages }) {
    const key = `${runtimeId}:${threadId}`
    const thread = this.threads.get(key) ?? {
      id: threadId,
      runtimeId,
      watermark: '0',
      turns: [],
      artifacts: []
    }
    const existing = thread.turns.findIndex((turn) => turn.id === turnId)
    const turn = { id: turnId, status: 'completed', messages: copy(messages), artifacts: [] }
    if (existing >= 0) thread.turns[existing] = turn
    else thread.turns.push(turn)
    thread.watermark = String(Number(thread.watermark) + 1)
    this.threads.set(key, thread)
  }

  async list() {
    return copy([...this.threads.values()].map(({ turns: _turns, artifacts: _artifacts, watermark: _watermark, ...thread }) => thread))
  }

  async read({ runtimeId, threadId }) {
    const thread = this.threads.get(`${runtimeId}:${threadId}`)
    if (!thread) throw new Error('fake canonical thread was not found')
    return copy(thread)
  }

  async *subscribeMessages() {}

  hasActiveTurns() {
    return false
  }
}

export class FakeCollaborationStateBackend {
  constructor(initial) {
    this.value = copy(initial)
    this.writes = []
  }

  async read() {
    return copy(this.value)
  }

  async write(value) {
    this.value = copy(value)
    this.writes.push(copy(value))
  }
}
