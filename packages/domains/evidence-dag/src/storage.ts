import { join } from 'node:path'

/** Select the profile-local Evidence owner; this confers no read authority. */
export function evidenceDagStorageRoot(
  userDataDir: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  return environment.EDAG_STORAGE_DIR?.trim() || join(userDataDir, 'evidence-dag', 'python')
}
