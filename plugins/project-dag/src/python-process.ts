import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { isAbsolute } from 'node:path'

export interface ProjectDagPythonOptions {
  /** Absolute, Host-approved interpreter with installed audited wheels. */
  python: string
  db: string
  evidence: string
  workspace: string
  /** Explicit allowlist only; never process.env or model credentials. */
  environment: Readonly<{ HOME?: string; TMPDIR?: string }>
  closeTimeoutMs?: number
}

/** Project-owned process adapter, not a plugin loader/DSH host or OS sandbox. */
export class ProjectDagPythonProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  readonly #exit: Promise<void>
  readonly #timeout: number
  #sequence = 0
  #closing = false
  #failed = false
  #failure: unknown
  #close: Promise<void> | undefined

  constructor(options: ProjectDagPythonOptions) {
    for (const value of [options.python, options.db, options.evidence, options.workspace]) {
      if (!value || !isAbsolute(value)) throw new Error('Project process requires absolute Host-bound paths')
    }
    this.#timeout = options.closeTimeoutMs ?? 10_000
    this.#child = spawn(options.python, ['-I', '-u', '-m', 'project_dag.runtime_stdio',
      '--db', options.db, '--evidence', options.evidence, '--workspace', options.workspace], {
      cwd: options.workspace, env: { HOME: options.environment.HOME, TMPDIR: options.environment.TMPDIR },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // Consume stderr without retaining model/fact payloads or blocking the pipe.
    this.#child.stderr.resume()
    const lines = createInterface({ input: this.#child.stdout })
    lines.on('line', line => {
      try {
        const response = JSON.parse(line)
        // Unattributable protocol noise (runtime_stdio reports malformed frames
        // with id null) is dropped: it must not reject unrelated in-flight
        // requests or execute a sidecar that is still protocol-sane.
        if (response === null || typeof response !== 'object' || response.id === null || response.id === undefined) return
        const pending = this.#pending.get(response.id)
        if (!pending) throw new Error('Unexpected Project process response identity')
        this.#pending.delete(response.id)
        if (response.ok === true) pending.resolve(response.data)
        else pending.reject(new Error(response.error?.message ?? 'Project process request failed'))
      } catch (error) { this.#fail(error); this.#child.kill('SIGKILL') }
    })
    this.#child.on('error', error => this.#fail(error))
    this.#child.stdin.on('error', error => this.#fail(error))
    this.#exit = new Promise(resolve => this.#child.once('close', (code, signal) => {
      if (this.#pending.size || code !== 0 || signal) {
        this.#fail(new Error(`Project process exited (${code ?? signal})`))
      }
      lines.close()
      resolve()
    }))
  }

  get pid(): number | undefined { return this.#child.pid }

  request(route: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    if (this.#closing) return Promise.reject(new Error('Project process is closing'))
    if (this.#failed) return Promise.reject(this.#failure)
    const id = ++this.#sequence
    return new Promise((resolve, reject) => {
      let line: string
      try { line = JSON.stringify({ id, route, method, ...(body === undefined ? {} : { body }) }) + '\n' }
      catch (error) { reject(error); return }
      this.#pending.set(id, { resolve, reject })
      this.#child.stdin.write(line, error => { if (error) this.#fail(error) })
    })
  }

  close(): Promise<void> {
    if (this.#close) return this.#close
    this.#closing = true
    this.#close = this.#closeOnce()
    return this.#close
  }

  async #closeOnce(): Promise<void> {
    this.#child.stdin.end()
    const timer = setTimeout(() => {
      this.#fail(new Error('Project drain timed out; accepted durable work may require recovery'))
      this.#child.kill('SIGKILL')
    }, this.#timeout)
    try {
      await this.#exit
      if (this.#failed) throw this.#failure
    } finally { clearTimeout(timer) }
  }

  #fail(error: unknown): void {
    if (!this.#failed) { this.#failed = true; this.#failure = error }
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}
