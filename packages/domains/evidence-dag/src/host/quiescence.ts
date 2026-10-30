/** A deadline reports FAILURE, never fabricated quiescence. The owner retains
 * the underlying operation and must retry before claiming disposal completed. */
export function awaitQuiescence<T>(work: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`Evidence ${label} quiescence deadline exceeded.`), { code: 'QUIESCENCE_TIMEOUT' })), milliseconds)
    work.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
