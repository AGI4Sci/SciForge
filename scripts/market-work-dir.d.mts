export const DEFAULT_MARKET_WORK_DIR: string

export function resolveMarketWorkDir(): string

export function ensureMarketWorkDir(): Promise<string>

export function marketLogDir(): Promise<string>