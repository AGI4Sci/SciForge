/** A failed drain leaves the application alive and its lifecycle owners reachable. */
export async function requestManagedRuntimeQuit(options: {
  stop(): Promise<void>
  quit(): void
  onFailure(error: unknown): void
}): Promise<boolean> {
  try { await options.stop() }
  catch (error) { options.onFailure(error); return false }
  options.quit()
  return true
}
