import { z } from 'zod'

/**
 * Local control-plane state for a Worker Task.  These states describe what
 * the Desktop can do with its local Worker Session; they are deliberately not
 * a second representation of the Cloud Task/Execution state.
 */
export const localTaskInteractionStateSchema = z.enum([
  'idle',
  'running',
  'waiting_human',
  'intervention_queued',
  'paused_local',
  'awaiting_cloud',
  'blocked_cloud',
  'completed'
])

export type LocalTaskInteractionState = z.infer<typeof localTaskInteractionStateSchema>

/**
 * Events accepted by the local controller.  Cloud-facing effects still have
 * to use an existing Cloud capability and are represented as
 * `await-cloud`/`cloud-*` events only after their local request is durable.
 */
export const localTaskInteractionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('execution-started') }).strict(),
  z.object({ type: z.literal('human-needed') }).strict(),
  z.object({ type: z.literal('intervention-queued') }).strict(),
  z.object({ type: z.literal('pause-local') }).strict(),
  z.object({ type: z.literal('resume-local') }).strict(),
  z.object({ type: z.literal('await-cloud') }).strict(),
  z.object({ type: z.literal('cloud-applied') }).strict(),
  z.object({ type: z.literal('cloud-rejected') }).strict(),
  z.object({ type: z.literal('cloud-blocked') }).strict(),
  z.object({ type: z.literal('execution-completed') }).strict(),
  z.object({ type: z.literal('execution-failed') }).strict()
])

export type LocalTaskInteractionEvent = z.infer<typeof localTaskInteractionEventSchema>

type EventType = LocalTaskInteractionEvent['type']

/*
 * Keep this transition table explicit.  In particular, a Cloud failure is
 * terminal for this local execution (`blocked_cloud`); it must not be
 * transitioned back to `running` by an ordinary chat turn.  A retry creates a
 * new local execution context and starts from `idle`/`running` instead.
 */
const transitions: Readonly<{
  [State in LocalTaskInteractionState]: Readonly<Partial<Record<EventType, LocalTaskInteractionState>>>
}> = {
  idle: {
    'execution-started': 'running',
    'intervention-queued': 'intervention_queued'
  },
  running: {
    'execution-started': 'running',
    'human-needed': 'waiting_human',
    'intervention-queued': 'intervention_queued',
    'pause-local': 'paused_local',
    'await-cloud': 'awaiting_cloud',
    'execution-completed': 'completed',
    'execution-failed': 'blocked_cloud'
  },
  waiting_human: {
    'human-needed': 'waiting_human',
    'intervention-queued': 'intervention_queued',
    'pause-local': 'paused_local',
    'await-cloud': 'awaiting_cloud',
    'execution-failed': 'blocked_cloud'
  },
  intervention_queued: {
    'intervention-queued': 'intervention_queued',
    'await-cloud': 'awaiting_cloud',
    'cloud-applied': 'running',
    'cloud-rejected': 'blocked_cloud',
    'cloud-blocked': 'blocked_cloud',
    'pause-local': 'paused_local',
    'execution-failed': 'blocked_cloud'
  },
  paused_local: {
    'pause-local': 'paused_local',
    'intervention-queued': 'intervention_queued',
    'resume-local': 'running',
    'execution-failed': 'blocked_cloud'
  },
  awaiting_cloud: {
    'await-cloud': 'awaiting_cloud',
    'cloud-applied': 'running',
    'cloud-rejected': 'blocked_cloud',
    'cloud-blocked': 'blocked_cloud',
    'execution-completed': 'completed',
    'execution-failed': 'blocked_cloud'
  },
  blocked_cloud: {
    'cloud-blocked': 'blocked_cloud',
    'execution-failed': 'blocked_cloud',
    'intervention-queued': 'intervention_queued'
  },
  completed: {
    'execution-completed': 'completed'
  }
}

/**
 * Apply one local control-plane event.  Replayed events that already describe
 * the current state are intentionally idempotent; every other invalid edge
 * fails closed so local UI input cannot revive a fenced Cloud execution.
 */
export function transitionLocalTaskInteractionState(
  current: LocalTaskInteractionState,
  event: LocalTaskInteractionEvent
): LocalTaskInteractionState {
  const state = localTaskInteractionStateSchema.parse(current)
  const parsedEvent = localTaskInteractionEventSchema.parse(event)
  const next = transitions[state][parsedEvent.type]
  if (!next) {
    throw new Error(
      `Local Task interaction cannot transition from ${state} on ${parsedEvent.type}.`
    )
  }
  return next
}

