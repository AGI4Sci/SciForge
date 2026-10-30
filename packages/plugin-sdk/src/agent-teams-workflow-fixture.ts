export type WorkflowTaskId = 'fixture.prepare' | 'fixture.synthesize'
export type WorkflowTaskStatus = 'blocked' | 'running' | 'completed' | 'failed' | 'cancelled'
export type WorkflowTeamStatus = 'active' | 'completed' | 'failed' | 'cancelled'

export type WorkflowTaskSnapshot = Readonly<{
  id: WorkflowTaskId
  subject: string
  dependencies: readonly WorkflowTaskId[]
  status: WorkflowTaskStatus
  output?: string
  failure?: string
}>

export type WorkflowEvent = Readonly<{
  sequence: number
  kind: 'team.created' | 'task.started' | 'task.completed' | 'task.failed' |
    'task.unblocked' | 'task.cancelled' | 'team.completed' | 'team.cancelled'
  taskId?: WorkflowTaskId
  detail: string
}>

export type WorkflowSnapshot = Readonly<{
  teamId: string
  generation: number
  revision: number
  status: WorkflowTeamStatus
  failTaskId?: WorkflowTaskId
  tasks: readonly WorkflowTaskSnapshot[]
  events: readonly WorkflowEvent[]
}>

export type WorkflowHandle = Readonly<{ teamId: string; generation: number }>

export class WorkflowFixtureError extends Error {
  readonly code: 'stale_generation' | 'disposed' | 'revision_mismatch' | 'terminal' | 'not_runnable'

  constructor(code: WorkflowFixtureError['code'], message: string) {
    super(message)
    this.name = 'WorkflowFixtureError'
    this.code = code
  }
}

type MutableTask = {
  -readonly [Key in keyof WorkflowTaskSnapshot]: WorkflowTaskSnapshot[Key]
}

type MutableSnapshot = {
  teamId: string
  generation: number
  revision: number
  status: WorkflowTeamStatus
  failTaskId?: WorkflowTaskId
  tasks: MutableTask[]
  events: WorkflowEvent[]
}

function clone(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return structuredClone(snapshot)
}

/**
 * Host-independent AgentTeams boundary used by the PR-2 compatibility study.
 * It deliberately has no Agent, model, network, filesystem, or scheduler input.
 */
export class AgentTeamsWorkflowFixture {
  #runs = new Map<string, MutableSnapshot>()
  #nextGeneration = new Map<string, number>()
  #disposed = false

  start(teamId: string, failTaskId?: WorkflowTaskId): { handle: WorkflowHandle; snapshot: WorkflowSnapshot } {
    this.#assertLive()
    const generation = (this.#nextGeneration.get(teamId) ?? 0) + 1
    this.#nextGeneration.set(teamId, generation)
    const snapshot: MutableSnapshot = {
      teamId,
      generation,
      revision: 0,
      status: 'active',
      ...(failTaskId === undefined ? {} : { failTaskId }),
      tasks: [
        { id: 'fixture.prepare', subject: 'Prepare local fixture', dependencies: [], status: 'running' },
        { id: 'fixture.synthesize', subject: 'Synthesize fixture', dependencies: ['fixture.prepare'], status: 'blocked' }
      ],
      events: [
        { sequence: 1, kind: 'team.created', detail: 'Created a deterministic two-task DAG.' },
        { sequence: 2, kind: 'task.started', taskId: 'fixture.prepare', detail: 'Started the dependency-free task.' }
      ]
    }
    this.#runs.set(teamId, snapshot)
    return { handle: { teamId, generation }, snapshot: clone(snapshot) }
  }

  status(handle: WorkflowHandle): WorkflowSnapshot {
    return clone(this.#current(handle))
  }

  advance(handle: WorkflowHandle, expectedRevision: number): WorkflowSnapshot {
    const current = this.#mutable(handle, expectedRevision)
    if (current.status !== 'active') throw new WorkflowFixtureError('terminal', `Workflow ${handle.teamId} is terminal.`)
    const running = current.tasks.find((task) => task.status === 'running')
    if (!running) throw new WorkflowFixtureError('not_runnable', `Workflow ${handle.teamId} has no runnable task.`)
    if (current.failTaskId === running.id) {
      running.status = 'failed'
      running.failure = 'Injected deterministic failure; dependent work was not dispatched.'
      current.events.push({ sequence: current.events.length + 1, kind: 'task.failed', taskId: running.id, detail: running.failure })
      const dependent = current.tasks.find((task) => task.status === 'blocked')
      if (dependent) dependent.failure = `Dependency ${running.id} failed.`
      current.status = 'failed'
      current.revision += 1
      return this.#save(current)
    }
    running.status = 'completed'
    running.output = running.id === 'fixture.prepare' ? 'fixture:prepared' : 'fixture:synthesized'
    current.events.push({ sequence: current.events.length + 1, kind: 'task.completed', taskId: running.id, detail: running.output })
    const dependent = current.tasks.find((task) => task.status === 'blocked')
    if (dependent) {
      dependent.status = 'running'
      current.events.push({ sequence: current.events.length + 1, kind: 'task.unblocked', taskId: dependent.id, detail: 'Dependency completed.' })
      current.events.push({ sequence: current.events.length + 1, kind: 'task.started', taskId: dependent.id, detail: 'Started after dependency validation.' })
    } else {
      current.status = 'completed'
      current.events.push({ sequence: current.events.length + 1, kind: 'team.completed', detail: 'All fixture tasks completed.' })
    }
    current.revision += 1
    return this.#save(current)
  }

  cancel(handle: WorkflowHandle, expectedRevision: number): WorkflowSnapshot {
    const current = this.#mutable(handle, expectedRevision)
    if (current.status !== 'active') throw new WorkflowFixtureError('terminal', `Workflow ${handle.teamId} is terminal.`)
    for (const task of current.tasks) {
      if (task.status === 'running' || task.status === 'blocked') {
        task.status = 'cancelled'
        current.events.push({ sequence: current.events.length + 1, kind: 'task.cancelled', taskId: task.id, detail: 'Cancelled by the fixture caller.' })
      }
    }
    current.status = 'cancelled'
    current.revision += 1
    current.events.push({ sequence: current.events.length + 1, kind: 'team.cancelled', detail: 'Workflow closed.' })
    return this.#save(current)
  }

  dispose(): void {
    this.#disposed = true
    this.#runs.clear()
  }

  #assertLive(): void {
    if (this.#disposed) throw new WorkflowFixtureError('disposed', 'Workflow fixture is disposed.')
  }

  #current(handle: WorkflowHandle): MutableSnapshot {
    this.#assertLive()
    const current = this.#runs.get(handle.teamId)
    if (current === undefined || current.generation !== handle.generation) {
      throw new WorkflowFixtureError('stale_generation', `Workflow ${handle.teamId} generation is stale.`)
    }
    return current
  }

  #mutable(handle: WorkflowHandle, expectedRevision: number): MutableSnapshot {
    const current = this.#current(handle)
    if (current.revision !== expectedRevision) {
      throw new WorkflowFixtureError('revision_mismatch', `Workflow ${handle.teamId} revision mismatch.`)
    }
    return clone(current) as MutableSnapshot
  }

  #save(snapshot: MutableSnapshot): WorkflowSnapshot {
    this.#runs.set(snapshot.teamId, snapshot)
    return clone(snapshot)
  }
}
