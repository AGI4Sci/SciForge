type TurnOptions = {
  model?: string
  reasoningEffort?: string
  serviceTier?: string
  mode?: string
}

/** Resolve composer hints before admission and dispatch against the exact target runtime. */
export function effectiveTurnOptions<T extends TurnOptions>(runtimeId: string, options: T): T {
  if (runtimeId !== 'dsh' && runtimeId !== 'claude') return options
  const effective = { ...options }
  // These runtimes select their model outside the inherited composer hint.
  delete effective.model
  if (runtimeId === 'dsh') {
    delete effective.reasoningEffort
    delete effective.serviceTier
    // Retain nonneutral modes so unsupported requests still fail closed.
    if (!effective.mode || effective.mode === 'agent') delete effective.mode
  }
  return effective
}
