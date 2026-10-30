declare module 'node:sqlite' {
  export type SQLInputValue = string | number | bigint | boolean | null | Uint8Array

  export class DatabaseSync {
    constructor(path: string)
    close(): void
    exec(sql: string): void
    prepare(sql: string): StatementSync
  }

  export class StatementSync {
    run(...values: SQLInputValue[]): unknown
    get(...values: SQLInputValue[]): unknown
    all(...values: SQLInputValue[]): unknown[]
  }
}
