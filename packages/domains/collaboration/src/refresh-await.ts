/** Bound the caller's wait even when an older transport ignores cancellation. */
export function waitForRefresh<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then((value) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}
