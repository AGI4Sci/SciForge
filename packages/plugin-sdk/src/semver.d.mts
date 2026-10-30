/** Only the standard semver APIs consumed by this SDK; no extra types dependency. */
export function valid(version: string): string | null
export function validRange(range: string): string | null
export function satisfies(version: string, range: string): boolean
